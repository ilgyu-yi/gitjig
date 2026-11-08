import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';

test('actual governed role preparation failure settles its undelivered input before any capacity or model request',async t=>{
 const root=await temporaryDirectory('terminal-role-precapacity'),home=path.join(root,'home'),source=path.join(root,'project');
 const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}}),core=c.changeCore,s=c.store;
 let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root);});
 await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Original project bytes');await c.registerProject({id:'P',sourceRoot:source});
 const {workId}=await c.beginChange({projectId:'P',request:'Preserve original project bytes'});
 const original={admission:core.h.assertApplicationAdmission,capture:core.captureDiagnosticInput,capacity:core.h.acquireCapacity,runtime:core.h.options.runtimeProfile,tmp:process.env.TMPDIR};
 let preparation=0,capacity=0,modelCalls=0;
 // Admission is a controlled premise. Exercise the real operation, role
 // reservation, allocateRole, failure collector and cleanup without an engine.
 core.h.assertApplicationAdmission=()=>{};
 process.env.TMPDIR=path.join(home,'artifacts');
 core.h.acquireCapacity=()=>{capacity++;throw Error('Capacity must not be requested after failed preparation');};
 core.captureDiagnosticInput=async(work,launch)=>{
  preparation++;
  const input=s.one("SELECT i.* FROM conversation_inputs i JOIN conversation_state cs ON cs.conversation=i.conversation WHERE json_extract(cs.data,'$.runId')=(SELECT run FROM role_launches WHERE id=?)",launch);
  assert.equal(input.state,'INITIAL_RESERVED');assert.equal(input.text,null);assert.equal(input.work,work);
  throw Error('Diagnostic receipt/evidence exceeds256KiB; nothing clipped');
 };
 try{
  const deny=()=>{modelCalls++;throw Error('No model dispatch permitted');},model=scripted(deny,deny),options={workId,model};
  const result=await core.operation(options,'plan',async()=>{await core.role(options,'adjudicator',{stage:'planning-adjudication'});return core.inspect(workId);});
  assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Diagnostic receipt\/evidence exceeds256KiB/);assert.equal(preparation,1);assert.equal(capacity,0);assert.equal(modelCalls,0);
  const run=s.one('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1',workId),data=JSON.parse(run.data);
  assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(data.cleanup,'not-allocated');
  assert.equal(data.capacityId,undefined);assert.equal(data.modelDispatchAttempted,undefined);
  assert.equal(s.all('SELECT * FROM capacity_leases WHERE run=?',run.id).length,0);
  const launch=s.one('SELECT * FROM role_launches WHERE run=?',run.id),output=s.one('SELECT * FROM role_outputs WHERE launch=?',launch.id);
  assert.equal(launch.status,'UNUSABLE');assert.equal(output.raw,null);assert.equal(JSON.parse(output.data).providerRequests,0);
  assert.match(JSON.parse(output.data).issues.join(),/Diagnostic receipt\/evidence exceeds256KiB/);
  const input=s.one("SELECT i.* FROM conversation_inputs i JOIN conversation_state cs ON cs.conversation=i.conversation WHERE json_extract(cs.data,'$.runId')=?",run.id);
  assert.equal(input.state,'CONFLICTED');assert.equal(c.inspectConversation(input.conversation).state,'IDLE');
  const before=Object.fromEntries(['runs','role_launches','role_outputs','budgets'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
  await c.reclaimConversationResource({conversationId:input.conversation,expectedGeneration:input.generation});
  for(const [table,rows]of Object.entries(before))assert.deepEqual(s.all('SELECT * FROM '+table+' ORDER BY rowid'),rows);
  passed=true;
 }finally{core.h.assertApplicationAdmission=original.admission;core.captureDiagnosticInput=original.capture;core.h.acquireCapacity=original.capacity;core.h.options.runtimeProfile=original.runtime;if(original.tmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=original.tmp;}
});

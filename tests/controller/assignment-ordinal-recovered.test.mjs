/** Actual current coordinator recovery and original source authority; only ordinary
 * project scope is controlled. No engine, real provider or source task replay. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const root=await temporaryDirectory('assignment-ordinal-recovered'),shim=path.join(root,'scope.mjs'),scopes=[];
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__ordinalRecoveredScope(options)}');
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/ordinary.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
globalThis.__ordinalRecoveredScope=async options=>{
 const deny=()=>assert.fail('Recovered ordinal controls cannot execute project code');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-recovered-ordinal',validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(p),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};scopes.push(scope);return scope;
};
const {fixture}=await import('./assignment-recovery-worker.mjs');
const {effectiveAssignmentAuthority}=await import('../../dist/controller/assignment-authority.js');
let failed=false;
after(async()=>{assert.ok(scopes.length>0&&scopes.every(s=>s.closed));delete globalThis.__ordinalRecoveredScope;if(!failed)await fs.rm(root,{recursive:true,force:true});});
async function world(t){
 t.after(()=>{if(t.passed===false)failed=true;});
 return fixture(t,{startup:false,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)},async beforeFirstInput({c,cid,root}){
  const other=path.join(root,'ordinal-project-q');await fs.mkdir(other);await fs.writeFile(path.join(other,'other.txt'),'Owned Q source');await c.registerProject({id:'Q',sourceRoot:other});
  for(const projectId of ['P','Q','P'])c.setConversationProject({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,projectId});
 }});
}
const taskLedger=f=>JSON.stringify({assignment:f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),work:f.s.one('SELECT * FROM works WHERE id=?',f.a.work),sources:f.s.all('SELECT * FROM sources ORDER BY rowid'),runs:f.s.all('SELECT * FROM runs ORDER BY rowid'),inputs:f.s.all('SELECT * FROM conversation_inputs ORDER BY rowid'),budgets:f.s.all('SELECT * FROM budgets ORDER BY lineage,kind'),effects:f.s.all('SELECT * FROM effect_operations ORDER BY rowid')});
test('actual current recovered authority preserves distinct conversation and work ordinals without dispatch or renewed allowance',async t=>{
 const f=await world(t),child=f.s.one('SELECT * FROM works WHERE id=?',f.a.work),budgets=f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',child.lineage),originalInvocation=JSON.parse(child.data).invocation,drives=f.drives();
 await f.recover();assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');assert.equal(f.drives(),drives);
 const before=taskLedger(f),actor=effectiveAssignmentAuthority(f.s,f.a.id,true),run=f.s.one('SELECT work,epoch,generation FROM runs WHERE id=?',actor.runId),input=f.s.one('SELECT work,conversation,generation,state FROM conversation_inputs WHERE id=?',actor.initialInputId);
 assert.equal(actor.workId,f.wid);assert.equal(actor.conversationId,f.cid);assert.equal(actor.runId,f.identity().runId);assert.notEqual(actor.runId,f.originalIdentity.runId);
 assert.notEqual(run.generation,actor.generation,'Production P/Q/P transitions must actually separate ordinal domains');assert.equal(input.generation,actor.generation);assert.equal(input.work,actor.workId);assert.equal(input.conversation,actor.conversationId);assert.equal(input.state,'CONSUMED');
 assert.equal(run.work,actor.workId);assert.equal(taskLedger(f),before,'Reading authority cannot mutate any original ledger');assert.equal(f.drives(),drives);assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',child.lineage),budgets);assert.deepEqual(JSON.parse(f.s.one('SELECT data FROM works WHERE id=?',child.id).data).invocation,originalInvocation);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM effect_operations').n,0);
 assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id),/explicit same-assignment queued reentry/);
 const row=f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.a.id);
 // Large mutable progress is not a new immutable authority operand.
 const large={...JSON.parse(row.data),result:{fixture:'CONTROLLED_LARGE_PROGRESS',text:'x'.repeat(131072)}};f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(large),f.a.id);
 const largeBefore=taskLedger(f);assert.deepEqual(effectiveAssignmentAuthority(f.s,f.a.id,true),actor);assert.equal(taskLedger(f),largeBefore);
 f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',row.data,f.a.id);
 for(const raw of ['{"source":{},'+row.data.slice(1),'{"authorityRecovery":null,'+row.data.slice(1),row.data.slice(0,-1)+',"source":{}}']){
  f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',raw,f.a.id);const corrupt=taskLedger(f);assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id,true),/duplicate|assignment|source|authority/i);assert.equal(taskLedger(f),corrupt);f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',row.data,f.a.id);
 }
 const pointer=JSON.parse(row.data).authorityRecovery.sourceId,originRow=f.s.one('SELECT origin FROM sources WHERE id=?',pointer),origin=JSON.parse(originRow.origin);
 const originalGeneration=f.s.one('SELECT generation FROM conversation_inputs WHERE id=?',actor.initialInputId).generation;
 for(const generation of [0,1.5]){
  try{
   f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({...origin,actor:{...origin.actor,generation}}),pointer);
   f.s.run('UPDATE conversation_inputs SET generation=? WHERE id=?',generation,actor.initialInputId);
   const invalid=taskLedger(f);assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id,true),/ordinal|generation|caller|source/i);assert.equal(taskLedger(f),invalid);
  }finally{
   f.s.run('UPDATE sources SET origin=? WHERE id=?',originRow.origin,pointer);
   f.s.run('UPDATE conversation_inputs SET generation=? WHERE id=?',originalGeneration,actor.initialInputId);
  }
 }
 assert.deepEqual(effectiveAssignmentAuthority(f.s,f.a.id,true),actor);assert.equal(f.drives(),drives);f.pass();
});

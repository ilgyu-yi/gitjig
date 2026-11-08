import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {after} from 'node:test';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const root=await temporaryDirectory('assignment-ordinal-history'),shim=path.join(root,'scope.mjs'),scopes=[];
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__ordinalHistoryScope(options)}');
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/ordinary.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
globalThis.__ordinalHistoryScope=async options=>{
 const deny=()=>assert.fail('Ordinal history controls cannot execute project code');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-ordinal',validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(p),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};scopes.push(scope);return scope;
};
const {recordedResultWorld}=await import('./recorded-delegated-results-fixture.mjs');
after(async()=>{assert.ok(scopes.length>0&&scopes.every(s=>s.closed));delete globalThis.__ordinalHistoryScope;await fs.rm(root,{recursive:true,force:true});});
import {historicalGovernedAssignment,readAssignmentAuthority} from '../../dist/controller/assignment-recovery-history.js';
import {scripted} from './effect-fixture.mjs';

test('historical original actor retains its conversation ordinal independently of older work-run ordinal',async t=>{
 const f=await recordedResultWorld(t,{resultDependency:false,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)},async beforeAssignment(f){
  const other=path.join(f.root,'ordinal-other');await fs.mkdir(other);await fs.writeFile(path.join(other,'other.txt'),'Other');await f.c.registerProject({id:'Q',sourceRoot:other});
  for(const projectId of ['P','Q','P'])f.c.setConversationProject({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,projectId});
 }});
 const child=f.children[0],row=f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?',child.assignmentId),actor=JSON.parse(row.data).source;
 const run=f.c.store.one('SELECT generation FROM runs WHERE id=?',actor.runId);assert.notEqual(run.generation,actor.generation);
 assert.equal(historicalGovernedAssignment(f.c.store,child.assignmentId,true).work.id,child.workId);
 const model=scripted(()=>({text:'A later owner turn preserves the original task'}));model.provider='later-ordinal-history';model.definition.api='later-ordinal-history-api';
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Inspect later history without replacing the original assignment',mode:'idle'});
 await f.c.runConversation({conversationId:f.parent,model});
 assert.equal(historicalGovernedAssignment(f.c.store,child.assignmentId,true).work.id,child.workId,'Historical actor remains valid after a later ordinary run');
 const db=f.c.store,original=db.one('SELECT * FROM runs WHERE id=?',actor.runId),sourceWork=db.one('SELECT generation FROM works WHERE id=?',actor.workId);
 for(const generation of [0,1.5,sourceWork.generation+1]){
  db.run('UPDATE runs SET generation=? WHERE id=?',generation,actor.runId);assert.throws(()=>historicalGovernedAssignment(db,child.assignmentId,true),/ordinal correspondence/);
  db.run('UPDATE runs SET generation=? WHERE id=?',original.generation,actor.runId);
 }
 for(const raw of ['{"kind":"ordinary-conversation"}','{"kind":"native-effect","kind":"ordinary-conversation"}','{"kind":"ordinary-conversation","kind":"native-effect"}','{"kind":"unknown"}','{}','not JSON','{"kind":"native-effect"}']){
  const id=randomUUID();db.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',id,original.work,original.epoch,original.generation,'SETTLED',original.staging,'consumed',raw);
  if(raw==='{"kind":"native-effect"}')assert.equal(historicalGovernedAssignment(db,child.assignmentId,true).work.id,child.workId,'Other operation kinds can share the work ordinal');
  else assert.throws(()=>historicalGovernedAssignment(db,child.assignmentId,true),/ambiguous/);
  db.run('DELETE FROM runs WHERE id=?',id);
 }
 assert.equal(historicalGovernedAssignment(db,child.assignmentId,true).work.id,child.workId);
 const assignment=db.one('SELECT data FROM conversation_assignments WHERE id=?',child.assignmentId),authority=readAssignmentAuthority(db,child.assignmentId,false).actor;
 for(const raw of [assignment.data.replace('{','{"source":'+JSON.stringify(authority)+','),assignment.data.replace('{','{"authorityRecovery":null,"authorityRecovery":null,'),assignment.data.replace('{','{"delegationRoot":"same","delegationRoot":"same",')]){
  db.run('UPDATE conversation_assignments SET data=? WHERE id=?',raw,child.assignmentId);assert.throws(()=>readAssignmentAuthority(db,child.assignmentId,false),/duplicate/i);
 }
 for(const bytes of [131072,1048577]){
  const progress={...JSON.parse(assignment.data),result:{text:'x'.repeat(bytes),literal:'{"source":"opaque progress"}'}};
  db.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(progress),child.assignmentId);assert.deepEqual(readAssignmentAuthority(db,child.assignmentId,false).actor,authority);
 }
 db.run('UPDATE conversation_assignments SET data=? WHERE id=?',assignment.data,child.assignmentId);f.pass();
});

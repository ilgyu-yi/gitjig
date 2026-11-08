/** Original Controller/SDK coordination with real capture and planning records.
 * Physical planning scopes and later governed drive are controlled; no engine or live model. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';
const scratch=await temporaryDirectory('reentry-allowance'),shim=path.join(scratch,'scope.mjs'),scopes=[];
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__reentryAllowanceScope(options)}');
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/controller/change-core.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};
 return next(specifier,context);
}});
globalThis.__reentryAllowanceScope=async options=>{
 const deny=()=>assert.fail('No physical project execution in allowance controls');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};
 scopes.push(scope);return scope;
};
const {structuredAssignmentWorld}=await import('./structured-assignment-fixture.mjs');
let failed=false;
after(async()=>{assert.ok(scopes.every(scope=>scope.closed));delete globalThis.__reentryAllowanceScope;if(!failed)await fs.rm(scratch,{recursive:true,force:true});});
const receipt=(context,name)=>JSON.parse(context.messages.filter(message=>message.role==='toolResult'&&message.toolName===name).at(-1).content.filter(part=>part.type==='text').map(part=>part.text).join(''));
async function fixture(t,{plan=true,maxAssignments=8}={}){
 t.after(()=>{if(t.passed===false)failed=true;});
 const f=await structuredAssignmentWorld(t,{maxAssignments,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}}),c=f.c;
 await fs.writeFile(path.join(f.root,'source/consumer.cjs'),'module.exports=2;\n');
 await fs.writeFile(path.join(f.root,'source/check.cjs'),'// No check executes in this planning fixture.\n');
 let action,index=0;
 const model=scripted(context=>action(context,index++));model.provider='reentry-'+randomUUID();model.definition.api='reentry-api-'+randomUUID();
 const turn=async next=>{action=next;index=0;await c.queueConversationInput({conversationId:f.parent,expectedGeneration:c.inspectConversation(f.parent).generation,text:'Inspect original task; do not create a replacement or extend allowance',mode:'idle'});const result=await c.runConversation({conversationId:f.parent,model});await c.ordinaryCore.drain();return result;};
 f.onGoverned(()=>{throw Error('CONTROLLED_STOP_BEFORE_GOVERNED_DRIVE');});
 await turn((_context,step)=>step?{text:'Original task allocated.'}:{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Consumer exports3 using its existing consumer and checker.',operation:'change',resultDependency:true}}});
 assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignmentId).state,'UNAVAILABLE');
 if(plan){const view=await c.planChange({workId:f.child.workId,model:scripted()});assert.equal(view.phase,'PLAN_READY',JSON.stringify(view.blocked));}
 let launches=0;c.ordinaryCore.h.launchChange=async()=>{launches++;throw Error('CONTROLLED_NO_RESUMED_PROCEDURE');};
 const targetSnapshot=()=>JSON.stringify({
  sources:c.store.all('SELECT * FROM sources ORDER BY rowid'),
  inputs:c.store.all('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid',f.child.conversationId),
  directions:c.store.all('SELECT * FROM conversation_directions WHERE conversation=? ORDER BY rowid',f.child.conversationId),
  assignment:c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),
  dependencies:c.store.all('SELECT * FROM conversation_dependencies WHERE assignment=? ORDER BY rowid',f.child.assignmentId),
  work:c.store.one('SELECT * FROM works WHERE id=?',f.child.workId),
  change:c.store.one('SELECT * FROM change_state WHERE work=?',f.child.workId),
  versions:c.store.all('SELECT * FROM change_versions WHERE work=? ORDER BY rowid',f.child.workId),
  runs:c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.child.workId),
  roles:c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',f.child.workId),
  budgets:c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.child.workId),
  target:c.store.one('SELECT * FROM conversation_state WHERE conversation=?',f.child.conversationId),
 });
 return{...f,c,turn,targetSnapshot,launches:()=>launches,exhaust(kind,{reserved=false}={}){c.store.run('UPDATE budgets SET consumed=lim-?,reserved=? WHERE lineage=? AND kind=?',reserved?1:0,reserved?1:0,f.child.workId,kind);},assign(revision=c.inspectConversation(f.child.conversationId).directionRevision){return{tool:{name:'conversation_assign',arguments:{conversationId:f.child.conversationId,observedDirectionRevision:revision,projectId:'P',operation:'change',instructions:'Retain this exact requested continuation 한국어 ✓'}}};}};
}
test('new-assignment ceiling preserves remaining work allowance and exact explicit same-target reentry',async t=>{
 const f=await fixture(t,{plan:false,maxAssignments:1});let before,inventory,budgets,reentry,accepted;
 const allocations=()=>JSON.stringify(Object.fromEntries(['conversations','conversation_assignments','conversation_relations','works','runs'].map(table=>[table,f.c.store.all('SELECT '+(table==='conversation_relations'?'child,parent':'id')+' FROM '+table+' ORDER BY rowid')])));
 const result=await f.turn((context,step)=>{
  if(!step){
   before=f.targetSnapshot();inventory=allocations();budgets=f.c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.child.workId);
   assert.deepEqual(budgets.map(budget=>budget.kind),['execution','resolution']);
   assert.ok(budgets.every(budget=>budget.lim>budget.consumed+budget.reserved));
   return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Do not create a replacement task'}}};
  }
  if(step===1){
   const refusal=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='conversation_assign').at(-1);
   assert.equal(refusal.isError,true);const message=JSON.stringify(refusal.content);
   assert.match(message,/Captured assignment allowance exhausted/);assert.match(message,/new-assignment creation limit/);assert.match(message,/does not report execution or resolution allowance/);
   assert.match(message,/resume fields when the original instructions still apply/);
   assert.equal(f.targetSnapshot(),before);assert.equal(allocations(),inventory);
   return{tool:{name:'conversation_status',arguments:{conversationId:f.child.conversationId}}};
  }
  if(step===2){
   const status=receipt(context,'conversation_status').assignments[0];reentry=status.reentry;
   assert.equal(status.ownerAction,undefined);assert.equal(reentry.conversationId,f.child.conversationId);
   assert.match(reentry.nextAction,/explicit bounded instructions/);assert.match(reentry.nextAction,/remaining original work allowance/);
   assert.equal(f.targetSnapshot(),before);assert.equal(allocations(),inventory);
   const {tool,nextAction,...operands}=reentry;
   return{tool:{name:tool,arguments:{...operands,instructions:'Continue this original governed task; preserve original scope and authority'}}};
  }
  assert.equal(step,3);accepted=receipt(context,'conversation_assign');
  assert.equal(accepted.accepted,true);assert.equal(accepted.reentry,true);assert.equal(accepted.assignmentId,f.child.assignmentId);assert.equal(accepted.workId,f.child.workId);
  assert.deepEqual(accepted.wait,{resultHandles:[f.child.assignmentId]});return{text:'Same original task queued; no replacement or allowance extension.'};
 });
 assert.equal(result.status,'delivered');assert.ok(reentry&&accepted);assert.equal(f.launches(),1);
 assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);
 assert.deepEqual(f.c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',f.child.workId),budgets);
 f.pass();
});
for(const kind of ['execution','resolution','repeated-unavailable-check','repeated-material-check','workflow-changed','workflow-unavailable'])test(`actual coordinator refuses known ${kind} hold without accepting instructions or creating a wait`,async t=>{
 const f=await fixture(t);
 const repeat=kind.startsWith('repeated-');
 const criteria=kind.startsWith('workflow-');
 const s=f.c.store, work=f.child.workId;
 const originalState=s.one('SELECT data FROM change_state WHERE work=?',work).data;
 const contractsId=JSON.parse(originalState).contractsVersion;
 const originalHash=s.one('SELECT hash FROM change_versions WHERE id=?',contractsId).hash;
 if(repeat) {
  const core=f.c.changeCore, original=core.repeatedCheckReport;
  core.repeatedCheckReport=work=>{assert.equal(work,f.child.workId);return {checkId:'original-check',status:kind==='repeated-material-check'?'fail':'unavailable'};};
  t.after(()=>{core.repeatedCheckReport=original;});
 } else if(criteria) {
  if(kind==='workflow-changed') s.run('UPDATE change_versions SET hash=? WHERE id=?','0'.repeat(64),contractsId);
  else s.run("UPDATE change_state SET data=json_set(data,'$.contractsVersion',?) WHERE work=?",randomUUID(),work);
 } else f.exhaust(kind);
 const assertAction=action=>{
  if(repeat){
   assert.equal(action.kind,'repeated-check-report');assert.equal(action.checkId,'original-check');assert.equal(action.exhausted,undefined);
   assert.ok(action.nextAction.includes('/change resume '+f.child.workId));
   assert.ok(action.nextAction.includes(kind==='repeated-material-check'?'same material failure':'same unusable output'));
  } else if(criteria) {
   assert.equal(action.kind,'workflow-criteria');
   assert.equal(action.hold,kind.slice('workflow-'.length));
   assert.match(action.nextAction,kind==='workflow-changed'?/Review updated gitjig workflow rules/:/Restore the exact workflow rule files/);
   assert.ok(action.nextAction.includes('/work '+work));
  } else {
   assert.deepEqual(action.exhausted,[kind]);assert.equal(action.stage,'source-fit');
  }
 };
 let before,refusal,status,wait,quiesced=0;
 const quiesce=f.c.interactions.quiesceNative.bind(f.c.interactions);f.c.interactions.quiesceNative=identity=>{quiesced++;return quiesce(identity);};
 const result=await f.turn((context,turn)=>{
  if(!turn){before=f.targetSnapshot();return{tool:{name:'conversation_status',arguments:{conversationId:f.child.conversationId}}};}
  if(turn===1){status=receipt(context,'conversation_status').assignments[0];assert.equal(status.reentry,undefined);assert.equal(status.resume,undefined);assert.equal(status.nextAction,undefined);assertAction(status.ownerAction);assert.equal(f.targetSnapshot(),before);return f.assign();}
  if(turn===2){refusal=receipt(context,'conversation_assign');assert.equal(refusal.accepted,false);assert.equal(refusal.wait,undefined);assert.equal(refusal.instructionsAccepted,false);assert.equal(refusal.state,'owner-action-required');assert.equal(refusal.workId,f.child.workId);assertAction(refusal.ownerAction);assert.equal(f.targetSnapshot(),before);return{tool:{name:'conversation_wait',arguments:{resultHandles:[f.child.assignmentId]}}};}
  wait=receipt(context,'conversation_wait');assert.equal(wait.waiting,false);assertAction(wait.outcomes[0].ownerAction);assert.equal(f.targetSnapshot(),before);return{text:'The original task is retained and requires owner action.'};
 });
 assert.equal(result.status,'delivered');assert.ok(refusal&&status&&wait);assert.equal(f.launches(),0);assert.equal(quiesced,0);
 if(criteria) {
  s.run('UPDATE change_versions SET hash=? WHERE id=?',originalHash,contractsId);
  s.run('UPDATE change_state SET data=? WHERE work=?',originalState,work);
  let accepted;
  await f.turn((context,turn)=>turn?(accepted=receipt(context,'conversation_assign'),{text:'Original reentry becomes available.'}):f.assign());
  assert.equal(accepted.accepted,true);assert.equal(accepted.assignmentId,f.child.assignmentId);assert.equal(accepted.workId,work);
  assert.equal(f.launches(),1);
 }
 f.pass();
});
test('current reserved usage blocks reentry, then explicit owner extension permits the same original assignment',async t=>{
 const f=await fixture(t);f.exhaust('resolution',{reserved:true});let refused;
 await f.turn((context,turn)=>turn?(refused=receipt(context,'conversation_assign'),{text:'Reserved resolution usage leaves no next-role admission.'}):f.assign());
 assert.equal(refused.accepted,false);assert.equal(refused.ownerAction.resolution.reserved,1);assert.equal(f.launches(),0);
 f.c.store.run('UPDATE budgets SET reserved=0 WHERE lineage=? AND kind=?',f.child.workId,'resolution');
 assert.equal(f.c.changeCore.inspectAssignmentAllowance(f.child.workId),null,'A released unused reservation can restore availability without an extension');
 // The controlled reservation settles as consumed; the owner extends through the original public operation.
 f.c.store.run('UPDATE budgets SET consumed=lim,reserved=0 WHERE lineage=? AND kind=?',f.child.workId,'resolution');
 const old=f.c.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?',f.child.workId,'resolution');
 f.c.extendResolutionAllowance({workId:f.child.workId,additional:1,reason:'Owner permits one same-task source-fit judgment'});let accepted;
 await f.turn((context,turn)=>turn?(accepted=receipt(context,'conversation_assign'),{text:'Only the original continuation was queued.'}):f.assign());
 assert.equal(accepted.accepted,true);assert.deepEqual(accepted.wait,{resultHandles:[f.child.assignmentId]});assert.equal(accepted.reentry,true);assert.equal(accepted.workId,f.child.workId);assert.equal(accepted.assignmentId,f.child.assignmentId);assert.equal(f.launches(),1);
 const budget=f.c.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?',f.child.workId,'resolution');assert.equal(budget.lim,old.lim+1);assert.equal(budget.consumed,old.lim);assert.equal(budget.reserved,0);assert.ok(f.c.interactionCore.impacts(f.child.workId).some(input=>input.data.effectHold));
 f.exhaust('resolution');
 assert.equal(f.c.changeCore.inspectAssignmentAllowance(f.child.workId,false).stage,'source-fit','An already held direction still requires resolution even without prospective input');
 f.pass();
});
test('coordinator holds planning when mandatory adjudication has no remaining allowance',async t=>{
 const f=await fixture(t,{plan:false});f.exhaust('resolution');
 let before;
 const assertHold=hold=>{
  assert.equal(hold.stage,'plan');
  assert.equal(hold.role,'planner');
  assert.deepEqual(hold.exhausted,['resolution']);
 };
 assertHold(f.c.changeCore.inspectAssignmentAllowance(f.child.workId));
 const result=await f.turn((context,turn)=>{
  if(!turn){before=f.targetSnapshot();return{tool:{name:'conversation_status',arguments:{conversationId:f.child.conversationId}}};}
  if(turn===1){
   const status=receipt(context,'conversation_status').assignments[0];
   assertHold(status.ownerAction);assert.equal(status.reentry,undefined);assert.equal(f.targetSnapshot(),before);
   return f.assign();
  }
  const refused=receipt(context,'conversation_assign');
  assert.equal(refused.accepted,false);assert.equal(refused.instructionsAccepted,false);assert.equal(refused.wait,undefined);
  assertHold(refused.ownerAction);assert.equal(f.targetSnapshot(),before);
  return{text:'Independent planning needs an explicit resolution allowance decision.'};
 });
 assert.equal(result.status,'delivered');assert.equal(f.launches(),0);f.pass();
});
test('stale direction refuses before an allowance hint and preserves original task records',async t=>{
 const f=await fixture(t);f.exhaust('resolution');let before,error;
 await f.turn((context,turn)=>{if(!turn){before=f.targetSnapshot();return f.assign(f.c.inspectConversation(f.child.conversationId).directionRevision+1);}error=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='conversation_assign').at(-1);assert.equal(error.isError,true);assert.match(JSON.stringify(error.content),/binding stale/);assert.equal(f.targetSnapshot(),before);return{text:'Refresh the actual target direction before any continuation.'};});
 assert.equal(f.launches(),0);f.pass();
});
test('a stronger criteria hold is retained without replacing it with allowance guidance',async t=>{
 const f=await fixture(t);f.exhaust('resolution');
 const criteria=JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.child.workId).data).contractsVersion;
 const original=f.c.store.one('SELECT hash FROM change_versions WHERE id=?',criteria).hash;
 f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?','0'.repeat(64),criteria);
 try{
  const before=f.targetSnapshot();assert.equal(f.c.changeCore.inspectModelPrerequisites(f.child.workId).stage,'held');
  assert.equal(f.c.changeCore.inspectAssignmentAllowance(f.child.workId),null);assert.equal(f.targetSnapshot(),before);
 }finally{f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?',original,criteria);}
 f.pass();
});
for(const scenario of ['retained-evidence','incomplete-completion'])test(`prospective reentry preserves ${scenario} hold before allowance guidance`,async t=>{
 const f=await fixture(t);f.exhaust('resolution');
 const state=f.c.store.one('SELECT * FROM change_state WHERE work=?',f.child.workId);
 if(scenario==='retained-evidence'){
  const version=f.c.store.one('SELECT data FROM change_versions WHERE id=?',state.plan),data=JSON.parse(version.data);
  // A captured v2 judgment cannot authenticate this damaged retained v3 receipt.
  data.implementationCarryProfile={version:3,baselineVersion:state.base,baseSourceIds:['base:consumer.cjs']};
  f.c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(data),state.plan);
 }else f.c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BLOCKED',JSON.stringify({...JSON.parse(state.data),resumeStage:'complete'}),f.child.workId);
 const before=f.targetSnapshot();assert.equal(f.c.changeCore.inspectModelPrerequisites(f.child.workId).stage,'held');
 assert.equal(f.c.changeCore.inspectAssignmentAllowance(f.child.workId),null);assert.equal(f.targetSnapshot(),before);f.pass();
});
test('actual cancelled work retains cancellation recovery instead of an allowance prompt',async t=>{
 const f=await fixture(t);f.exhaust('resolution');
 await f.c.cancelWork({workId:f.child.workId,expectedEpoch:f.c.inspectWork(f.child.workId).epoch});
 const before=f.targetSnapshot();assert.equal(f.c.changeCore.inspectAssignmentAllowance(f.child.workId),null);assert.equal(f.targetSnapshot(),before);
 let status,wait;
 await f.turn((context,turn)=>{
  if(!turn)return{tool:{name:'conversation_status',arguments:{conversationId:f.child.conversationId}}};
  if(turn===1){status=receipt(context,'conversation_status').assignments[0];assert.equal(status.workState,'CANCELLED');assert.equal(status.ownerAction,undefined);return{tool:{name:'conversation_wait',arguments:{resultHandles:[f.child.assignmentId]}}};}
  wait=receipt(context,'conversation_wait');assert.equal(wait.waiting,false);assert.equal(wait.outcomes[0].ownerAction,undefined);return{text:'The owner must resolve the original cancellation before further work.'};
 });
 assert.ok(status&&wait);assert.equal(f.launches(),0);f.pass();
});

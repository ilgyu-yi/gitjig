import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const runtimeProfile = config.nested ? {dockerBinary:process.execPath,dockerContext:'CANCEL_CONTROLLED',image:'sha256:'+'a'.repeat(64)} : undefined;
if (runtimeProfile) {
 const shim=path.join(path.dirname(process.argv[2]),'owned-cancel-scope.mjs');
 fs.writeFileSync(shim,'export const createScope = options => globalThis.controlledCancelledScope(options); export class RuntimeHelperUnavailableError extends Error {}');
 registerHooks({resolve(specifier,context,next){
  if (context.parentURL?.endsWith('/controller/ordinary.js') && specifier.endsWith('/execution/container-scope.js'))
   return {url:pathToFileURL(shim).href,shortCircuit:true};
  return next(specifier,context);
 }});
 globalThis.controlledCancelledScope=async options=>{
  const unexpected=()=>assert.fail('Unexpected project execution');
  return {containerId:'cancel-fixture',workspaceRoot:options.workRoot,validatePath:name=>path.resolve(options.workRoot,name),
   readFile:name=>fs.promises.readFile(path.resolve(options.workRoot,name),'utf8'),access:async()=>{},
   exec:unexpected,mkdir:unexpected,writeFile:unexpected,close:async()=>({state:'removed'})};
 };
}
const {recordedResultWorld}=await import('../controller/recorded-delegated-results-fixture.mjs');
const {failedWaitWorld}=await import('../controller/original-failed-wait-fixture.mjs');
const {seedLocalRoleRequestLimit,seedNormalQuota}=await import('../controller/planning-failure-fixture.mjs');
const {startConversationUI}=await import('../../dist/ui/index.js');
const {captureWaitContinuationFailure}=await import('../../dist/controller/conversation-progress.js');
if(config.liveRelease) test('owner sees a stopped delegated role after actual publication or failure',async t=>{
 let diagnosticDispatches=0;
 const {nestedDiagnosis}=config;
 let ownerStatusReads=0, diagnosedCoordinator;
 const text=message=>typeof message?.content==='string'?message.content:
  message?.content?.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
 const f=await failedWaitWorld(t,{automatic:!!(config.dependencyDelivered || config.dependencyBlocked || nestedDiagnosis),retainRoot:true,originalGovernedDispatch:true,nested:config.nested,runtimeProfile,
  fixtureRoot:config.fixtureRoot,
  nestedCompletion:!!(config.dependencyBlocked && config.nested),
  ...(config.dependencyDelivered ? {onContinuation(){diagnosticDispatches++;return {text:'Received the original unavailable result; the child was not retried.'};}} : {}),
  ...(nestedDiagnosis ? {onOwnerPrompt(context,input,[leaf]){
   if (![nestedDiagnosis.ask,nestedDiagnosis.resume].includes(input)) return;
   const latest=context.messages.findLastIndex(message=>message.role==='user');
   const receipt=context.messages.find(message=>message.role==='toolResult'&&message.toolName==='conversation_assign');
   const coordinator=JSON.parse(text(receipt)).conversationId;
   const observed=context.messages.slice(latest+1).find(message=>message.role==='toolResult'&&message.toolName==='conversation_status');
   if (!observed) return {tool:{name:'conversation_status',arguments:{conversationId:coordinator}}};
   assert.equal(observed.isError,false);
   const status=JSON.parse(text(observed)), [entry]=status.descendantRecovery.entries;
   assert.equal(entry.coordinatorConversationId,coordinator);
   assert.equal(entry.workId,leaf.workId);
   assert.equal(entry.assignmentId,leaf.assignmentId);
   assert.equal(entry.kind,'provider-usage-limit');
   assert.equal(entry.temporalScope,'publication-only');
   assert.equal(entry.resume,undefined);
   assert.ok(status.assignments.every(assignment=>!assignment.resume));
   ownerStatusReads++;
   diagnosedCoordinator=entry.coordinatorConversationId;
   return {text:input===nestedDiagnosis.ask?nestedDiagnosis.explanation:nestedDiagnosis.direction+' '+diagnosedCoordinator};
  }} : {}),
  async prepareResult(c,child){
   if(config.cancelled){
    await c.cancelWork({workId:child.workId,expectedEpoch:c.inspectWork(child.workId).epoch,explicitOwnerRequest:true});
    throw Error('Controlled governed execution ended after cancellation');
   }
   if(config.missingResult){
    if(config.cleanupUnknown)c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",child.workId);
    throw Error('Controlled launch failure before an original publication');
   }
   if (config.quota) {
    const quota=seedNormalQuota(c,child.workId,'adjudicator','nested-quota');
    if (config.locale==='ko')
     c.store.run("UPDATE role_outputs SET data=json_remove(data,'$.providerFailure.resetsAt') WHERE id=?",quota.output);
    assert.ok(c.inspectChangeResult(child.workId).providerFailure);
    const {lineageRoot}=c.inspectWorkRecovery(child.workId);
    c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",lineageRoot);
    return;
   }
   seedLocalRoleRequestLimit(c,child.workId);assert.ok(c.inspectChangeResult(child.workId).roleRequestLimit);
  }});
 const {c,parent}=f,original=c.inspectConversation(parent);
 c.setConversationName({conversationId:parent,expectedGeneration:original.generation,name:'Original coordinator'});
 if(config.locale==='ko')c.setConversationLanguage({conversationId:parent,expectedGeneration:original.generation,expectedRevision:0,replyLanguage:'ko'});
 c.setDraft({conversationId:parent,expectedRevision:original.draft.revision,text:'Preserved owner draft'});
 const heldConversation=config.dependencyBlocked && config.nested
  ? c.store.one('SELECT target FROM conversation_assignments WHERE source_conversation=?',parent).target : parent;
 if (heldConversation!==parent) {
  const held=c.inspectConversation(heldConversation);
  c.setConversationName({conversationId:heldConversation,expectedGeneration:held.generation,name:'Middle coordinator'});
  c.setDraft({conversationId:heldConversation,expectedRevision:held.draft.revision,text:'Preserved middle draft'});
  c.setConversationLanguage({conversationId:heldConversation,expectedGeneration:held.generation,expectedRevision:0,replyLanguage:config.locale});
 }
 const other=c.createConversation();
 c.setConversationName({conversationId:other.conversationId,expectedGeneration:other.generation,name:'Unrelated workspace'});
 const retained=['conversation_inputs','conversation_assignments','conversation_results','works','runs','budgets'];
 const ledger=()=>retained.map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:c.store.all(sql).map(Object.values)};
 });
 let liveDependency,liveLedger;
 const settle=async()=>{
  for(let count=0;count<400;count++){
   if(fs.existsSync(config.liveRelease)){
    if (config.dependencyBlocked==='profile') c.ordinary.models.delete(heldConversation);
    if (config.dependencyBlocked==='startup') {
     const resolve=c.ordinary.h.resolveOperation.bind(c.ordinary.h);
     c.ordinary.h.resolveOperation=(request,...options)=>request.conversationId===heldConversation
      ? Promise.reject(Error('Private controlled startup refusal')) : resolve(request,...options);
    }
    await f.settle();
    if (config.unreadableLive) {
     liveLedger=ledger();
     liveDependency=c.store.one("SELECT id,data FROM conversation_dependencies WHERE assignment=? AND state='PENDING'",f.children[0].assignmentId);
     c.store.run("UPDATE conversation_dependencies SET data=json_set(data,'$.source.runId','unrelated-run') WHERE id=?",liveDependency.id);
     c.interactions.assignmentChanged(parent);
    }
    fs.writeFileSync(config.ready,'settled');
    return;
   }
   await new Promise(resolve=>setTimeout(resolve,15));
  }
  throw Error('Controlled child result was not released');
 };
 const pending=settle();void pending.catch(()=>{});
 await startConversationUI({controller:c,model:f.model,conversationId:parent});
 await pending;
 const originalStop=c.inspectRecordedDelegatedResults(parent).entries.find(entry=>entry.assignmentId===f.children[0].assignmentId);
 if(config.missingResult){
  assert.equal(originalStop,undefined);
  const child=f.children[0];
  const assignment=c.store.one('SELECT source_conversation,data FROM conversation_assignments WHERE id=?',child.assignmentId);
  assert.equal(c.inspectConversationWait(assignment.source_conversation)?.targets[0].state,config.cancelled?'CANCELLED':'UNAVAILABLE');
  assert.equal(c.inspectConversationWait(assignment.source_conversation)?.targets[0].cleanupUnconfirmed,config.cleanupUnknown?true:undefined);
  if (config.nested) assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops?.[0].assignmentId,
   config.unreadableLive?undefined:child.assignmentId);
  assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId)?.workId,config.unreadableLive?undefined:child.workId);
  if (liveDependency) {
   assert.deepEqual(ledger(),liveLedger);
   assert.equal(c.inspectRecordedDelegatedResults(parent).waitReviewUnavailable,true);
   c.store.run('UPDATE conversation_dependencies SET data=? WHERE id=?',liveDependency.data,liveDependency.id);
   assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId)?.workId,child.workId);
  }
  const dependency=c.store.one("SELECT id,data FROM conversation_dependencies WHERE assignment=? AND waiting=? AND state=?",child.assignmentId,assignment.source_conversation,
    config.cancelled?'CANCELLED':'PENDING');
  assert.ok(dependency);
  c.store.run("UPDATE conversation_dependencies SET data=json_set(data,'$.source.runId','unrelated-run') WHERE id=?",dependency.id);
  assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId),undefined);
  if (config.nested) assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops,undefined);
  if (config.nested) assert.equal(c.inspectRecordedDelegatedResults(parent).waitReviewUnavailable,true);
  c.store.run('UPDATE conversation_dependencies SET data=? WHERE id=?',dependency.data,dependency.id);
  if (config.nested && !config.cancelled) {
   const middle=c.store.one('SELECT data FROM conversation_state WHERE conversation=?',assignment.source_conversation);
   c.store.run("UPDATE conversation_state SET data=json_set(data,'$.continuationAuthorized',json('false')) WHERE conversation=?",assignment.source_conversation);
   assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId),undefined);
   assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops,undefined);
   c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',middle.data,assignment.source_conversation);
   c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.delegation.projectIds',json('[]')) WHERE id=?",child.assignmentId);
   assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops,undefined);
   assert.equal(c.inspectRecordedDelegatedResults(parent).waitReviewUnavailable,undefined);
   c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',assignment.data,child.assignmentId);
   if (!config.cleanupUnknown) {
    c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.resultId','retained-attempt-pointer') WHERE id=?",child.assignmentId);
    assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops?.[0].resultId,undefined);
    assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId)?.workId,child.workId);
    c.store.run("UPDATE conversation_assignments SET data=json_remove(data,'$.launchResultUnavailable') WHERE id=?",child.assignmentId);
    assert.equal(c.inspectRecordedDelegatedResults(parent).descendantWaitStops,undefined);
    assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId),undefined);
    c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',assignment.data,child.assignmentId);
    c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.reentries',json_array(json_object('actor',json('{}')),json_object('actor',json_extract(data,'$.source')))) WHERE id=?",child.assignmentId);
    c.store.run("INSERT INTO conversation_dependencies VALUES(?,?,?,?,'PENDING',?)",'malformed-prior-edge',assignment.source_conversation,
     child.conversationId,child.assignmentId,'{"source":{}}');
    assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId),undefined);
    c.store.run("DELETE FROM conversation_dependencies WHERE id='malformed-prior-edge'");
    c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',assignment.data,child.assignmentId);
   }
  }
  if (config.cancelled) {
   const id=JSON.parse(assignment.data).cancellationSource;
   const source=c.store.one('SELECT origin FROM sources WHERE id=?',id);
   const origin=JSON.parse(source.origin);
   assert.equal(origin.requestedWork.id,child.workId);
   c.store.run("UPDATE sources SET origin=json_set(origin,'$.requestedWork.toEpoch',0) WHERE id=?",id);
   assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId),undefined);
   c.store.run('UPDATE sources SET origin=? WHERE id=?',source.origin,id);
   if (config.nested) {
    await c.cancelWork({workId:child.workId,expectedEpoch:c.inspectWork(child.workId).epoch,explicitOwnerRequest:true});
    assert.equal(c.inspectDelegatedWaitWork(parent,child.assignmentId)?.workId,child.workId);
   }
  }
 }else if (config.dependencyBlocked) {
  assert.equal(c.inspectConversation(parent).state,'WAITING');
  const state=JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',heldConversation).data);
  assert.match(state.continuationError,config.dependencyBlocked==='profile'?/EXPLICIT_MODEL_REQUIRED/:/APPLICATION_CONTINUATION_UNAVAILABLE/);
  const hold=c.inspectConversationWait(heldConversation).continuationFailure;
  assert.equal(hold?.reason,config.dependencyBlocked==='profile'?'explicit-profile':'startup');
  assert.equal(c.inspectConversationWait(other.conversationId),undefined);
  assert.equal(f.continuations.length,0);
  assert.equal(c.store.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",parent).n,1);
  assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=?',parent).n,1);
  const leaf=c.store.one('SELECT state,data FROM conversation_assignments WHERE id=?',f.children[0].assignmentId);
  const resultId=JSON.parse(leaf.data).resultId;
  const publication=c.store.one('SELECT data FROM conversation_results WHERE id=?',resultId);
  c.store.run("UPDATE conversation_results SET data=json_set(data,'$.changed',1) WHERE id=?",resultId);
  assert.equal(c.inspectConversationWait(heldConversation).continuationFailure,undefined);
  assert.notEqual(captureWaitContinuationFailure(c.store,heldConversation,hold.reason)?.proof,hold.proof);
  c.store.run('UPDATE conversation_results SET data=? WHERE id=?',publication.data,resultId);
  assert.deepEqual(c.inspectConversationWait(heldConversation).continuationFailure,hold);
  if (config.nested) {
   assert.equal(leaf.state,'COMPLETE');
   const nested=c.inspectRecordedDelegatedResults(parent).descendantContinuationFailures;
   assert.equal(nested.length,1);
   assert.equal(nested[0].conversationId,heldConversation);
   assert.equal(nested[0].reason,hold.reason);
   assert.equal(c.inspectRecordedDelegatedResults(other.conversationId).descendantContinuationFailures,undefined);
   const edge=c.store.one("SELECT id,data FROM conversation_dependencies WHERE assignment=? AND waiting=? AND state='PENDING'",nested[0].assignmentId,parent);
   c.store.run("UPDATE conversation_dependencies SET data=json_set(data,'$.source.runId','unrelated-run') WHERE id=?",edge.id);
   assert.equal(c.inspectRecordedDelegatedResults(parent).descendantContinuationFailures,undefined);
   c.store.run('UPDATE conversation_dependencies SET data=? WHERE id=?',edge.data,edge.id);
   assert.equal(c.inspectConversation(heldConversation).draft.text,'Preserved middle draft');
   assert.equal(c.store.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",heldConversation).n,1);
   assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=?',heldConversation).n,1);
  }
 }else if (config.dependencyDelivered) {
  assert.equal(f.continuations.length,1);
  assert.equal(diagnosticDispatches,1);
  assert.equal(c.store.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",parent).n,2);
  assert.deepEqual(c.store.all("SELECT json_extract(data,'$.kind') AS kind FROM runs WHERE work=? ORDER BY rowid",f.children[0].workId)
   .map(row=>row.kind),['governed-change','governed-role']);
  assert.equal(c.inspectConversation(parent).state,'IDLE');
  assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.children[0].assignmentId).state,'UNAVAILABLE');
  assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=?',parent).n,2);
 }else if (nestedDiagnosis) {
  assert.equal(ownerStatusReads,2);
  const assignments=c.store.all('SELECT work,state FROM conversation_assignments ORDER BY rowid');
  assert.equal(assignments.length,2);
  assert.equal(assignments[0].state,'WAITING');
  assert.equal(assignments[1].state,'UNAVAILABLE');
  assert.equal(c.store.one("SELECT COUNT(*) n FROM runs WHERE work=?",assignments[0].work).n,1);
  assert.deepEqual(c.store.all("SELECT text FROM conversation_inputs WHERE conversation=? AND mode='idle' ORDER BY rowid",parent)
   .slice(1).map(row=>row.text),[nestedDiagnosis.ask,nestedDiagnosis.resume]);
  assert.equal(c.store.one("SELECT COUNT(*) n FROM conversation_inputs WHERE mode='reentry'").n,0);
 }else if (config.quota) {
  const stop=c.inspectRecordedDelegatedResults(parent).descendantStops?.[0];
  assert.equal(stop?.assignmentId,f.children[0].assignmentId);
  assert.equal(stop.stop,'provider-limit');
  assert.equal(stop.currentWait,true);
  assert.equal(stop.providerUsageLimitRole,'adjudicator');
  assert.equal(stop.providerUsageLimitReset,config.locale==='ko'?null:1794020400);
 }else {
  assert.equal(originalStop?.roleRequestLimit?.requestLimit.limit,16);
  const waiting=c.store.one('SELECT data FROM conversation_state WHERE conversation=?',parent);
  c.store.run("UPDATE conversation_state SET data=json_set(data,'$.waitHandles',json_array(null)) WHERE conversation=?",parent);
  const incomplete=c.inspectRecordedDelegatedResults(parent);
  assert.equal(incomplete.waitReviewUnavailable,true);
  assert.ok(incomplete.entries.some(entry=>entry.resultId===originalStop.resultId));
  c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',waiting.data,parent);
 }
 assert.equal(c.inspectRecordedDelegatedResults(other.conversationId).entries.length,0);
 assert.equal(c.inspectRecordedDelegatedResults(other.conversationId).descendantWaitStops,undefined);
 assert.equal(c.inspectRecordedDelegatedResults(other.conversationId).waitReviewUnavailable,undefined);
 assert.equal(c.inspectConversation(parent).draft.text,'Preserved owner draft');
 const queries=ledger();
 fs.writeFileSync(config.receipt,JSON.stringify({role:originalStop?.roleRequestLimit?.role,workId:f.children[0].workId,
  assignmentId:f.children[0].assignmentId,
  resultId:config.quota?c.inspectRecordedDelegatedResults(parent).descendantStops[0].resultId:undefined,
  quotaLineage:config.quota?c.inspectWorkRecovery(f.children[0].workId).lineageRoot:undefined,
  selected:c.store.one('SELECT selected FROM interaction_view').selected,
  heldConversation,
  diagnosedCoordinator,
  parent,home:f.home,queries,expectedInputs:c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n}));
 f.pass();
});
else test('owner sees original recorded partial work beside misleading parent prose',async t=>{
 const f=await recordedResultWorld(t,{retainRoot:true}),child=f.children[0];
 f.c.setConversationLanguage({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,expectedRevision:0,replyLanguage:config.locale});
 if(config.openNotice)f.c.setConversationLanguage({conversationId:child.conversationId,expectedGeneration:f.c.inspectConversation(child.conversationId).generation,expectedRevision:0,replyLanguage:config.locale});
 f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:'Retained 한글 draft'});
 const counts=()=>Object.fromEntries(['runs','conversation_inputs','conversation_results','conversation_notifications'].map(table=>[table,f.c.store.one('SELECT COUNT(*) AS n FROM '+table).n]));
 const before=counts(),recorded=f.c.inspectRecordedDelegatedResults(f.parent);
 assert.equal(recorded.entries.length,1);assert.ok(recorded.entries[0].candidateVersion);
 fs.writeFileSync(config.ready,JSON.stringify({parent:f.parent,target:child.conversationId,work:child.workId,assignment:child.assignmentId}));
 await import('./navigation-no-execution.mjs');
 await startConversationUI({controller:f.c,model:f.model,conversationId:f.parent});
 assert.equal(f.c.inspectConversation(f.parent).draft.text,'Retained 한글 draft');assert.deepEqual(counts(),before);assert.deepEqual(f.c.inspectRecordedDelegatedResults(f.parent),recorded);
 const openedNotice=f.c.inspectNotifications(f.parent).some(notice=>notice.resultId===recorded.entries[0].resultId&&notice.state==='ACKNOWLEDGED');
 assert.equal(openedNotice,config.openNotice);
 if(openedNotice)assert.equal(f.c.store.one('SELECT selected FROM interaction_view').selected,child.conversationId);
 fs.writeFileSync(config.receipt,JSON.stringify({noAdditionalWork:true,recordedUnchanged:true,draft:'Retained 한글 draft',openedNotice}));f.pass();
});

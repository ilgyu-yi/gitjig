/** Public controller/real capture/SDK/history recovery. Only physical Docker scope
 * creation is controlled; this does not qualify a real engine or provider. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';
import {changeResultText} from '../../dist/ui/change-result.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {workCommands} from '../../dist/ui/work-commands.js';
import {translator} from '../../dist/ui/i18n.js';
const root=await temporaryDirectory('planning-prefix'),home=path.join(root,'home'),source=path.join(root,'project'),shim=path.join(root,'scope.mjs');
await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),'// Controlled planning fixture: no check executes.\n');
const containerScope=import.meta.resolve('../../dist/execution/container-scope.js');
await fs.writeFile(shim,`export {RuntimeHelperUnavailableError} from ${JSON.stringify(containerScope)};export async function createScope(options){return globalThis.__planningPrefixScope(options)}`);
registerHooks({resolve(specifier,context,next){if((context.parentURL?.endsWith('/controller/change-core.js') || context.parentURL?.endsWith('/controller/ordinary.js')) && specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const scopes=[];globalThis.__planningPrefixScope=async options=>{
 const deny=()=>assert.fail('No physical project execution in planning controls');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full},readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'}}};scopes.push(scope);return scope;
};
const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('Network forbidden in controlled planning fixture')};
const originalTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
const {openController}=await import('../../dist/controller/index.js');
const {assignmentResumeFingerprint,blockedAssignmentResumeFingerprint,captureGovernedAssignmentInput,consumeGovernedAssignmentInput}=await import('../../dist/controller/assignment-authority.js');
let c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
await c.registerProject({id:'P',sourceRoot:source});let failures=0;
after(async()=>{await c.close();assert.equal(fetches,0);assert.ok(scopes.every(scope=>scope.closed));globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;delete globalThis.__planningPrefixScope;if(!failures)await fs.rm(root,{recursive:true,force:true});else console.error('RETAINED_PLANNING_PREFIX '+root);});
async function world(t,failedRole,prepare=()=>{},retainedCandidate=false){
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:20,resolutionLimit:12}),calls=[];let mode='fail',observe=()=>{};
 if(retainedCandidate){
  // Seed a retained candidate, not an author/check/review acceptance claim.
  // Both source snapshots are real captures before the original P/C execute.
  const candidateSource=path.join(root,randomUUID()),target=path.join(home,'inputs',randomUUID());
  await fs.cp(source,candidateSource,{recursive:true});await fs.writeFile(path.join(candidateSource,'consumer.cjs'),'module.exports=3;\n');
  const {freeze}=await import('../../dist/controller/change-files.js'),receipt=await freeze(candidateSource,target,JSON.parse(c.store.one('SELECT profile FROM projects WHERE id=?','P').profile));
  const base=c.store.one('SELECT base FROM change_state WHERE work=?',workId).base;
  const candidate=c.changes.newVersion(workId,'candidate',target,{manifest:receipt.manifest,producer:'controlled-retained-candidate'},receipt.digest,base);
  c.store.run('UPDATE change_state SET candidate=? WHERE work=?',candidate,workId);
 }
 const model=scripted(undefined,({role,body,result})=>{
  const live=c.store.one("SELECT l.data FROM role_launches l JOIN runs r ON r.id=l.run WHERE l.work=? AND l.status='RUNNING' AND r.phase='RUNNING' ORDER BY l.rowid DESC LIMIT 1",workId);
  assert.deepEqual(JSON.parse(live.data).bounds,{timeoutMs:null,maxProviderRequests:16},'Admitted bounds exist before the original provider callback');
  calls.push({mode,role,body:structuredClone(body)});
  if(mode==='fail')prepare({role,body,result});
  if(mode==='fail'&&role===failedRole){result.unexpected='Controlled unusable output';result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original failed producer concern must survive retry',evidence:['base:consumer.cjs exports2']}];}
  if(mode==='resume'){
   if(role==='adjudicator'){result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];result.summary='Independent negative judgment remains authoritative';}
   observe({role,body,result});
  }
 });
 const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');assert.equal(first.planVersion,null);
 const runs=()=>c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),launches=()=>c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId);
 const originals=launches(),outputs=c.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',workId),charges=first.execution.consumed;
 return {workId,model,calls,first,originals,outputs,runs,launches,charges,setObserver(fn){observe=fn},async resume(signal,bodyProfile){
  mode='resume';const core=c.changeCore,role=core.role;
  if(bodyProfile)core.role=function(options,kind,context,...rest){return role.call(this,options,kind,options.workId===workId&&kind==='adjudicator'&&context.stage==='planning-adjudication'?{...context,findingBodyInput:bodyProfile}:context,...rest)};
  try{return await c.driveChange({workId,model,maximumSteps:1,signal});}finally{if(bodyProfile)core.role=role;}
 }};
}

for (const resultDependency of [false,true]) test('coordinator resumes the original blocked planning suffix without adding directions, dependency='+resultDependency, {timeout: 30000}, async t => {
 t.after(() => { if (t.passed === false) failures++; });
 const parent=c.createConversation({projectId:'P'}).conversationId, s=c.store, calls=[];
 const launch=c.ordinary.h.launchChange;
 let first, firstPublication, directions, capturedPlanner, resumed, mutatedState, selectedRules, driftRefused=false, continuations=0;
 c.ordinary.h.launchChange=async (assignmentId,request)=>{
  const pending=s.one('SELECT work,data FROM conversation_assignments WHERE id=?',assignmentId);
  if (JSON.parse(pending.data).reentries?.at(-1)?.resumeResultId) {
   const work=pending.work, captured=captureGovernedAssignmentInput(s,assignmentId);
   const state=s.one('SELECT data FROM change_state WHERE work=?',work).data;
   s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...JSON.parse(state),resumeStage:'changed after queue'}),work);
   try {
    assert.throws(()=>consumeGovernedAssignmentInput(s,assignmentId,work,captured),/input changed before admission/);
    driftRefused=true;
   } finally {
    s.run('UPDATE change_state SET data=? WHERE work=?',state,work);
   }
  }
  return launch(assignmentId,request);
 };
 t.after(()=>{c.ordinary.h.launchChange=launch;});
 const model=scripted(context=>{
  const user=context.messages.findLastIndex(message=>message.role==='user');
  const latest=context.messages[user].content.map(part=>part.text).join('');
  const replies=context.messages.slice(user+1).filter(message=>message.role==='toolResult');
  const response=name=>{
   const match=replies.findLast(message=>message.toolName===name);
   return match && JSON.parse(match.content.map(part=>part.text).join(''));
  };
  if (!latest.startsWith('Explicitly resumed authorized dependency outcomes')) {
   first=response('conversation_assign');
   return first ? {tool:{name:'conversation_wait',arguments:first.wait}}
    : {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3',resultDependency}}};
  }
  if (resumed) {
   continuations++;
   return {text:'Independent planning stopped again. The task is still blocked.'};
  }
  const status=response('conversation_status');
  if (!status) {
   const original=s.one('SELECT work,data FROM conversation_assignments WHERE id=?',first.assignmentId);
   firstPublication=s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(original.data).resultId);
   directions=s.all('SELECT * FROM conversation_directions WHERE conversation=?',first.conversationId);
   capturedPlanner=s.one("SELECT * FROM role_launches WHERE work=? AND role='planner'",original.work);
   return {tool:{name:'conversation_status',arguments:{conversationId:first.conversationId}}};
  }
  const assignment=status.assignments.find(assignment=>assignment.assignmentId===first.assignmentId);
  assert.match(assignment.nextAction,/original instructions still apply.*conversation_resume_assignment/);
  assert.match(assignment.reentry.nextAction,/only when supplying new instructions/);
  const fields=Object.keys(assignment);
  assert.ok(fields.indexOf('nextAction')<fields.indexOf('resume') && fields.indexOf('resume')<fields.indexOf('reentry'));
  const {resume}=assignment;
  assert.deepEqual(Object.keys(resume).sort(),['assignmentId','checkpoint','conversationId','observedDirectionRevision','projectId','resultId']);
  assert.equal(resume?.resultId,firstPublication.id);
  if (!mutatedState) {
   mutatedState=s.one('SELECT data FROM change_state WHERE work=?',firstPublication.work).data;
   s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...JSON.parse(mutatedState),resumeStage:'changed after status'}),firstPublication.work);
   return {tool:{name:'conversation_resume_assignment',arguments:resume}};
  }
  const attempts=replies.filter(reply=>reply.toolName==='conversation_resume_assignment');
  const refusal=attempts[0];
  assert.ok(refusal.isError);
  assert.match(refusal.content.map(part=>part.text).join(''),/no longer eligible for resume/);
  if (attempts.length===1) {
   assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',first.assignmentId).state,'UNAVAILABLE');
   assert.equal(s.one("SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=? AND mode='reentry'",first.conversationId).n,0);
   s.run('UPDATE change_state SET data=? WHERE work=?',mutatedState,firstPublication.work);
   selectedRules=s.one("SELECT v.id,v.hash FROM change_state c JOIN change_versions v ON v.id=json_extract(c.data,'$.contractsVersion') WHERE c.work=?",firstPublication.work);
   s.run('UPDATE change_versions SET hash=? WHERE id=?','0'.repeat(64),selectedRules.id);
   return {tool:{name:'conversation_resume_assignment',arguments:resume}};
  }
  const receipt=response('conversation_resume_assignment');
  if (attempts.length===2) {
   try {
    assert.equal(receipt.accepted,false);
    assert.equal(receipt.instructionsAccepted,false);
    assert.equal(receipt.wait,undefined);
    assert.equal(receipt.ownerAction.kind,'workflow-criteria');
    assert.equal(receipt.ownerAction.hold,'changed');
    assert.equal(s.one("SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=? AND mode='reentry'",first.conversationId).n,0);
   } finally { s.run('UPDATE change_versions SET hash=? WHERE id=?',selectedRules.hash,selectedRules.id); }
   return {tool:{name:'conversation_resume_assignment',arguments:resume}};
  }
  assert.equal(receipt.assignmentId,first.assignmentId);
  assert.equal(receipt.workId,firstPublication.work);
  assert.equal(receipt.directionRevision,resume.observedDirectionRevision);
  resumed=receipt;
  return {tool:{name:'conversation_wait',arguments:resumed.wait}};
 },({role,body,result})=>{
  if (!role) return;
  calls.push(role);
  if (role==='challenger' && calls.length===2) result.unexpected='Controlled unusable challenger';
  if (role==='challenger' && calls.length===3) assert.equal(body.context.plannerInputScope.launchId,capturedPlanner.id);
  if (role==='adjudicator') {
   assert.equal(body.context.plannerInputScope.launchId,capturedPlanner.id);
   result.planAccepted=false;
   delete result.acceptedPlan;
   result.decisions=[];
  }
 });
 await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Assign the change and await its result',mode:'idle'});
 const initial=await c.runConversation({conversationId:parent,model});
 assert.equal(initial.status,'waiting',JSON.stringify(initial));
 await c.ordinary.drain();
 assert.ok(resumed);
 assert.equal(driftRefused,true);
 assert.equal(continuations,1);
 assert.deepEqual(calls,['planner','challenger','challenger','adjudicator']);
 assert.deepEqual(s.one('SELECT * FROM role_launches WHERE id=?',capturedPlanner.id),capturedPlanner);
 assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',firstPublication.id),firstPublication);
 assert.deepEqual(s.all('SELECT * FROM conversation_directions WHERE conversation=?',first.conversationId),directions);
 const assignment=s.one('SELECT * FROM conversation_assignments WHERE id=?',first.assignmentId),data=JSON.parse(assignment.data);
 assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=?',parent).n,1);
 assert.equal(assignment.state,'UNAVAILABLE');
 assert.notEqual(data.resultId,firstPublication.id);
 assert.equal(data.reentries.length,1);
 assert.equal(data.reentries[0].resumeResultId,firstPublication.id);
 const resumedInput=s.one('SELECT state,text FROM conversation_inputs WHERE id=?',data.reentries[0].inputId);
 assert.equal(resumedInput.state,'CONSUMED');
 assert.deepEqual(JSON.parse(resumedInput.text),{resumeResult:firstPublication.id});
 assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_dependencies WHERE assignment=?',first.assignmentId).n,resultDependency ? 2 : 0);
});

test('coordinator resumes consumed correction without changing planning inputs or original parent delivery',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const parent=c.createConversation({projectId:'P'}).conversationId,s=c.store,calls=[];
 const launch=c.ordinary.h.launchChange;
 let mode='initial',original,publication,direction,heldContext,resumed,delivered;
 const result=(context,name)=>{
  const last=context.messages.findLastIndex(message=>message.role==='user');
  const reply=context.messages.slice(last+1).findLast(message=>message.role==='toolResult'&&message.toolName===name);
  return reply && JSON.parse(reply.content.map(part=>part.text).join(''));
 };
 const rows=()=>s.all('SELECT * FROM conversation_directions WHERE conversation=? ORDER BY revision',original.target);
 const status=()=>s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent);
 const model=scripted(context=>{
  if(mode==='initial')return result(context,'conversation_assign')?{text:'Original assignment underway'}:
   {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3'}}};
  if(mode==='correction')return result(context,'conversation_assign')?{text:'Correction admitted on original assignment'}:
   {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',assignmentId:original.id,
    conversationId:original.target,observedDirectionRevision:0,instructions:'Keep the exact original requirement and verify repeated consumption.'}}};
  if(resumed){delivered=true;return{text:'Original assignment returned its new independent outcome.'};}
  const snapshot=result(context,'conversation_status');
  if(!snapshot)return{tool:{name:'conversation_status',arguments:{conversationId:original.target}}};
  const {resume}=snapshot.assignments[0];
  assert.equal(resume?.resultId,publication.id);
  const receipt=result(context,'conversation_resume_assignment');
  if(!receipt)return{tool:{name:'conversation_resume_assignment',arguments:resume}};
  assert.equal(receipt.accepted,true);assert.equal(receipt.assignmentId,original.id);
  assert.equal(receipt.directionRevision,direction.revision);
  resumed=receipt;
  return {tool:{name:'conversation_wait',arguments:receipt.wait}};
 },({role,body,result:output})=>{
  if(!role)return;
  calls.push([mode,role]);
  if(mode==='initial'&&role==='challenger')output.unexpected='Controlled first blocking output';
  if(mode==='correction'&&role==='adjudicator'){
   heldContext=body.context.sourceInputChain;
   assert.equal(heldContext.filter(input=>input.data.effectHold).length,1);
   output.unexpected='Controlled rejected plan judgment after owning correction';
  }
  if(mode==='resume'&&role==='adjudicator'){
   assert.deepEqual(body.context.sourceInputChain,heldContext);
   output.planAccepted=false;delete output.acceptedPlan;
  }
 });
 const turn=async text=>{
  await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text,mode:'idle'});
  await c.runConversation({conversationId:parent,model});
  await c.ordinary.drain();
 };
 await turn('Assign the original consumer task.');
 original=status();assert.equal(original.state,'UNAVAILABLE');
 mode='correction';await turn('Send the original work clarification.');
 original=status();assert.equal(original.state,'UNAVAILABLE');
 const {work,target,id}=original,resultId=JSON.parse(original.data).resultId;
 publication=s.one('SELECT * FROM conversation_results WHERE id=?',resultId);
 [direction]=rows();assert.ok(direction);
 const inputId=JSON.parse(direction.data).inputId;
 assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CONSUMED');
 const epoch=c.inspectChange(work).epoch, fingerprint=()=>assignmentResumeFingerprint(s,resultId,target,work,epoch);
 assert.equal(blockedAssignmentResumeFingerprint(s,resultId,target,work),null);
 const expected=fingerprint();assert.ok(expected);
 for(const [query,args] of [
  ["UPDATE conversation_inputs SET state='DISPATCHED_WORKFLOW' WHERE id=?",[inputId]],
  ["UPDATE sources SET raw=raw||' changed' WHERE id=?",[direction.source]],
  ["UPDATE conversation_directions SET data=json_set(data,'$.affectedAssignmentId','foreign') WHERE conversation=? AND revision=?",[target,direction.revision]],
  ["UPDATE conversation_directions SET data=json_set(data,'$.affectedGeneration',99) WHERE conversation=? AND revision=?",[target,direction.revision]],
  ["UPDATE conversation_directions SET data=json_set(data,'$.inherited',json('true')) WHERE conversation=? AND revision=?",[target,direction.revision]],
 ]) {
  s.run('SAVEPOINT invalid_held_scope');
  try{s.run(query,...args);assert.equal(fingerprint(),null);}
  finally{s.run('ROLLBACK TO invalid_held_scope');s.run('RELEASE invalid_held_scope');}
 }
 s.run('SAVEPOINT unrelated_pending_input');
 try{
  s.run('INSERT INTO conversation_inputs SELECT ?,conversation,generation,work,source,?,mode,text,data FROM conversation_inputs WHERE id=?',
   randomUUID(),'QUEUED',inputId);
  assert.equal(fingerprint(),null);
 }finally{s.run('ROLLBACK TO unrelated_pending_input');s.run('RELEASE unrelated_pending_input');}
 s.run('SAVEPOINT duplicated_source_direction');
 try{
  s.run('INSERT INTO conversation_directions VALUES(?,?,?,?)',target,direction.revision+1,direction.source,direction.data);
  s.run('UPDATE conversation_state SET direction=direction+1 WHERE conversation=?',target);
  assert.equal(fingerprint(),null);
 }finally{s.run('ROLLBACK TO duplicated_source_direction');s.run('RELEASE duplicated_source_direction');}
 assert.equal(fingerprint(),expected);
 let driftRefused=false;
 c.ordinary.h.launchChange=async(assignmentId,request)=>{
  if(assignmentId===id){
   const delivery=captureGovernedAssignmentInput(s,id);
   assert.deepEqual(rows(),[direction]);
   s.run("UPDATE conversation_directions SET data=json_set(data,'$.claim','changed after queue') WHERE conversation=? AND revision=?",target,direction.revision);
   try{
    assert.throws(()=>consumeGovernedAssignmentInput(s,id,work,delivery),/input changed before admission/);
    driftRefused=true;
   }finally{s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',direction.data,target,direction.revision);}
  }
  return launch(assignmentId,request);
 };
 try{mode='resume';await turn('Continue without another direction and await the original result.');}
 finally{c.ordinary.h.launchChange=launch;}
 assert.equal(driftRefused,true);assert.ok(resumed);assert.equal(delivered,true);
 assert.deepEqual(calls.filter(([where])=>where==='resume'),[['resume','adjudicator']]);
 assert.equal(status().id,id);
 assert.notEqual(JSON.parse(status().data).resultId,resultId);
 assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',resultId),publication);
 assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=?',parent).n,1);
});

test('unchanged resume admits the funded implementer while new directions require resolution allowance',{timeout:30000},async t=>{
 const parent=c.createConversation({projectId:'P'}).conversationId,s=c.store,core=c.changeCore,drive=core.drive;
 let original, publication, directions, resume, execution, admitted, recovered=false;
 t.after(()=>{core.drive=drive;if(t.passed===false)failures++;});
 core.drive=async options=>{
  if(original)return drive.call(core,{...options,maximumSteps:1});
  const planned=await core.plan(options);
  assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
  original=planned.workId;
  core.phase(original,'BLOCKED',{resumeStage:'implement',blocked:['Bounded drive step limit reached'],nextAction:'Explicit resume within retained allowance'});
  return core.inspect(original);
 };
 const statusCall=cid=>({tool:{name:'conversation_status',arguments:{conversationId:cid}}});
 const resumeCall=()=>({tool:{name:'conversation_resume_assignment',arguments:resume}});
 const directionsFor=cid=>s.all('SELECT * FROM conversation_directions WHERE conversation=?',cid);
 const ledger=()=>JSON.stringify(['sources','conversation_inputs','conversation_assignments','conversation_dependencies'].map(table=>s.all('SELECT * FROM '+table+' ORDER BY rowid')));
 const model=scripted(context=>{
  const user=context.messages.findLastIndex(m=>m.role==='user');
  const latest=context.messages[user].content.map(part=>part.text).join('');
  const replies=context.messages.slice(user+1).filter(m=>m.role==='toolResult'),turn=replies.length;
  const receipt=name=>JSON.parse(replies.findLast(m=>m.toolName===name).content.map(part=>part.text).join(''));
  if(latest==='Allocate original implementation task')return turn?{text:'Original task allocated.'}:
   {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3'}}};
  const assignment=s.one('SELECT * FROM conversation_assignments WHERE work=?',original);
  if(!turn)return statusCall(assignment.target);
  if(turn===1){
   const outcome=receipt('conversation_status').assignments[0];
   assert.equal(outcome.ownerAction,undefined,'The funded unchanged route is not globally blocked');
   assert.equal(outcome.reentry,undefined);
   assert.deepEqual(outcome.reentryOwnerAction.exhausted,['resolution']);
   assert.equal(outcome.reentryOwnerAction.stage,'source-fit');
   resume=outcome.resume;assert.equal(resume.resultId,publication.id);
   admitted=ledger();
   return {tool:{name:'conversation_assign',arguments:{assignmentId:assignment.id,conversationId:assignment.target,
    observedDirectionRevision:resume.observedDirectionRevision,projectId:'P',operation:'change',instructions:'New requirement controlled by test'}}};
  }
  if(turn===2){
   const denied=receipt('conversation_assign');assert.equal(denied.accepted,false);assert.deepEqual(denied.ownerAction.exhausted,['resolution']);
   assert.equal(ledger(),admitted);assert.equal(denied.wait,undefined);
   s.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='execution'",original);
   return resumeCall();
  }
  if(turn===3){
   const denied=receipt('conversation_resume_assignment');assert.equal(denied.accepted,false);assert.deepEqual(denied.ownerAction.exhausted,['execution']);
   assert.equal(denied.ownerAction.stage,'implement');assert.equal(ledger(),admitted);assert.equal(denied.wait,undefined);
   s.run("UPDATE budgets SET consumed=? WHERE lineage=? AND kind='execution'",execution.consumed,original);
   return resumeCall();
  }
  const accepted=receipt('conversation_resume_assignment');assert.equal(accepted.workId,original);assert.equal(accepted.assignmentId,assignment.id);
  assert.deepEqual(accepted.wait,{resultHandles:[assignment.id]});recovered=true;
  return {text:'Resumed exact original implementation.'};
 });
 async function turn(text){
  await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text,mode:'idle'});
  const response=await c.runConversation({conversationId:parent,model});
  assert.equal(response.status,'delivered',JSON.stringify(response));await c.ordinary.drain();
 }
 await turn('Allocate original implementation task');
 assert.ok(original);
 const assignment=s.one('SELECT * FROM conversation_assignments WHERE work=?',original);
 assert.equal(assignment.state,'UNAVAILABLE');
 publication=s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(assignment.data).resultId);
 directions=directionsFor(assignment.target);
 execution=s.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'",original);
 s.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='resolution'",original);
 await turn('Resume under original instructions');
 assert.equal(recovered,true);
 assert.deepEqual(directionsFor(assignment.target),directions);
 assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',publication.id),publication);
 assert.deepEqual(s.all('SELECT role FROM role_launches WHERE work=? ORDER BY rowid',original).map(row=>row.role),['planner','challenger','adjudicator','implementer']);
 assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE work=?',original).n,1);
});

for(const selection of ['identical','absent-to-changed','identical-to-changed'])test('implicit planning carry selection fences '+selection,{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:8,resolutionLimit:12}),core=c.changeCore;
 const base=core.version(c.inspectChange(workId).baseVersion);
 const identical=core.newVersion(workId,'candidate',base.artifact,{manifest:base.data.manifest,producer:'controlled-identical-candidate'},base.hash,base.id);
 const candidateSource=path.join(root,randomUUID()),target=path.join(home,'inputs',randomUUID());
 await fs.cp(source,candidateSource,{recursive:true});await fs.writeFile(path.join(candidateSource,'consumer.cjs'),'module.exports=3;\n');
 const {freeze}=await import('../../dist/controller/change-files.js'),receipt=await freeze(candidateSource,target,JSON.parse(c.store.one('SELECT profile FROM projects WHERE id=?','P').profile));
 const changed=core.newVersion(workId,'candidate',target,{manifest:receipt.manifest,producer:'controlled-changed-candidate'},receipt.digest,base.id);
 if(selection!=='absent-to-changed')c.store.run('UPDATE change_state SET candidate=? WHERE work=?',identical,workId);
 let judgeCalled=false,selectionChanged=false;const select=core.selectRoleModel;
 const model=scripted(undefined,({role,body})=>{if(role==='adjudicator'){judgeCalled=true;assert.equal(body.context.decisionCarry.version,2);assert.equal(body.context.decisionCarryInput,undefined);}});
 core.selectRoleModel=async function(options,role){const value=await select.call(this,options,role);if(role==='adjudicator'&&selection!=='identical'){if(selection==='absent-to-changed')c.store.run('UPDATE change_state SET candidate=? WHERE work=?',changed,workId);else{const row=core.version(changed);c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?',row.artifact,row.hash,JSON.stringify(row.data),identical);}selectionChanged=true;}return value;};
 let result;try{if(selection==='absent-to-changed'){await assert.rejects(c.planChange({workId,model,signal:t.signal}),/selected input versions changed/);result=c.inspectChange(workId);}else result=await c.planChange({workId,model,signal:t.signal});}finally{core.selectRoleModel=select;}
 if(selection==='identical'){assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.equal(judgeCalled,true);}
 else {assert.equal(selectionChanged,true);if(selection!=='absent-to-changed'){assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(' '),/retained planning BASE or candidate changed/);}assert.equal(judgeCalled,false);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='adjudicator'",workId).n,0);assert.equal(result.execution.consumed,3);assert.equal(result.execution.reserved,0);}
});
for(const failedRole of ['challenger','adjudicator'])test('retained successful prefix resumes only required suffix after '+failedRole+' failure',{timeout:30000},async t=>{
 const f=await world(t,failedRole),beforeP=f.originals.find(l=>l.role==='planner'),beforeC=f.originals.find(l=>l.role==='challenger');
 const longSummary='Reason\u001b[31m\u202e '+ '🙂'.repeat(140)+' END';
 f.setObserver(({role,body,result})=>{
  if(role==='challenger'||role==='adjudicator')assert.equal(body.context.plannerInputScope.launchId,beforeP.id);
  if(role==='adjudicator'&&failedRole==='adjudicator')assert.equal(body.context.challengerInputScope.launchId,beforeC.id);
  if(role==='adjudicator'&&failedRole==='adjudicator')result.summary=longSummary;
  for(const occurrence of f.first.occurrences)assert.ok(body.context.occurrences.some(current=>current.id===occurrence.id),'Fresh suffix must receive every original claim');
 });
 const resumed=await f.resume();assert.equal(resumed.phase,'BLOCKED');assert.equal(resumed.planVersion,null);assert.equal(resumed.candidateVersion,null);
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),failedRole==='challenger'?['challenger','adjudicator']:['adjudicator']);
 assert.equal(resumed.execution.consumed-f.charges,failedRole==='challenger'?2:1);assert.equal(resumed.execution.reserved,0);assert.equal(resumed.resolution.reserved,0);
 const failed=f.originals.find(l=>l.role===failedRole),diagnostic=c.store.all('SELECT data FROM obligations WHERE work=?',f.workId).map(row=>JSON.parse(row.data)).find(o=>o.kind==='diagnostic'&&o.launchId===failed.id);
 assert.ok(diagnostic?.replacementLaunch);const replacement=c.store.one('SELECT * FROM role_launches WHERE id=?',diagnostic.replacementLaunch);
 assert.equal(replacement.role,failedRole);assert.equal(replacement.run,diagnostic.reentryRun);assert.ok(!f.originals.some(l=>l.id===replacement.id));
 for(const output of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);
 for(const original of f.originals.filter(l=>l.status==='COMPLETE'))assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',original.id),original);
 assert.equal(resumed.planningFailure,undefined,'A usable negative decision is not a producer failure');
 const judge=c.store.one("SELECT o.id,o.data FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='adjudicator' AND o.status='usable' ORDER BY o.rowid DESC LIMIT 1",f.workId);
 const inspection=c.inspectChangeResult(f.workId),message=inspection.blocked[0];
 assert.ok(message.startsWith('Independent planning did not accept the proposal. Adjudicator output '+judge.id+': '));
 if(failedRole==='adjudicator'){
  assert.equal(JSON.parse(judge.data).protocol.summary,longSummary);
  assert.ok(message.includes('Reason\\u001b[31m\\u202e'));
  assert.ok(message.endsWith('[summary shortened]'));
  assert.ok(!message.includes(' END'));
 }else assert.ok(message.includes('Independent negative judgment remains authoritative'));
 for(const locale of ['en','ko'])assert.ok(changeResultText(inspection,locale).includes(message));
});

function acceptCandidateProposal({role,body,result}){
 if(role!=='adjudicator')return;
 assert.ok(body.context.candidateVersion);result.planAccepted=true;result.acceptedPlan=body.context.planProposal;
 result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'rejected',reason:'This BASE-only concern does not establish a defect in the captured candidate exporting3',witnesses:['candidate:consumer.cjs']}));
}
for(const failedRole of ['challenger','adjudicator'])test('unchanged captured candidate reuses the successful planning prefix after '+failedRole+' failure',{timeout:30000},async t=>{
 const f=await world(t,failedRole,()=>{},true),candidate=f.first.candidateVersion;
 assert.ok(candidate);const beforeCandidate=c.store.one('SELECT * FROM change_versions WHERE id=?',candidate);
 const p=f.originals.find(l=>l.role==='planner'),scope=JSON.parse(p.data).inputScope;
 assert.equal(scope.inputVersions.candidate,candidate);
 const baseSource=scope.selectedSources.find(s=>s.id==='base:consumer.cjs'),candidateSource=scope.selectedSources.find(s=>s.id==='candidate:consumer.cjs');
 assert.notEqual(baseSource.sha256,candidateSource.sha256);assert.equal(candidateSource.version,candidate);
 f.setObserver(({role,body})=>{
  assert.equal(body.context.candidateVersion,candidate);
  assert.equal(body.context.plannerInputScope.launchId,p.id);
  for(const occurrence of f.first.occurrences)assert.ok(body.context.occurrences.some(current=>current.id===occurrence.id));
 });
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.candidateVersion,candidate);assert.equal(after.planVersion,null);
 const expected=failedRole==='challenger'?['challenger','adjudicator']:['adjudicator'];
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),expected);
 assert.equal(after.execution.consumed-f.charges,expected.length);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
 assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',candidate),beforeCandidate);
 for(const output of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);
 for(const original of f.originals.filter(l=>l.status==='COMPLETE'))assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',original.id),original);
});

test('fresh independent J can adopt original P/C while preserving the unchanged candidate',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),candidate=f.first.candidateVersion;
 assert.equal(readFileSync(path.join(c.changes.version(candidate).artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');
 f.setObserver(acceptCandidateProposal);const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.equal(after.candidateVersion,candidate);
 const plan=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',after.planVersion).data);
 assert.equal(plan.authorLaunch,f.originals.find(l=>l.role==='planner').id);assert.equal(plan.challengeLaunch,f.originals.find(l=>l.role==='challenger').id);assert.notEqual(plan.decisionLaunch,f.originals.find(l=>l.role==='adjudicator').id);
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['adjudicator']);assert.equal(after.execution.consumed-f.charges,1);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
});

test('prospective subject actions reach original Controller adoption and cold replay while retaining encoded raw',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),core=c.changes,originalRole=core.role;
 core.role=function(options,role,context,...rest){return originalRole.call(this,options,role,options.workId===f.workId&&role==='adjudicator'&&context.stage==='planning-adjudication'?{...context,subjectActionsInput:{version:1}}:context,...rest)};
 f.setObserver(event=>{
  acceptCandidateProposal(event);
  if(event.role!=='adjudicator')return;
  const {body,result}=event,view=body.context.subjectActionsView;
  assert.equal(body.context.metadataIdentityInput.version,3);assert.ok(view);
  const keys=new Map(view.subjects.map(row=>[row.occurrenceId,row.key]));
  result.decisionActions=Object.fromEntries(result.decisions.map(({occurrenceId,...decision})=>[keys.get(occurrenceId),decision]));
  result.subjectActionsHash=view.responseHash;delete result.decisions;
 });
 let after;try{after=await f.resume();}finally{core.role=originalRole;}
 assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.equal(after.candidateVersion,f.first.candidateVersion);
 const plan=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',after.planVersion).data),launch=c.store.one('SELECT * FROM role_launches WHERE id=?',plan.decisionLaunch),metadata=JSON.parse(launch.data),output=c.store.one('SELECT * FROM role_outputs WHERE launch=?',launch.id);
 const raw=JSON.parse(output.raw),stored=JSON.parse(output.data);
 assert.ok(raw.decisionActions);assert.equal(raw.decisions,undefined);assert.equal(raw.subjectActionsHash,metadata.subjectActionsView.responseHash);assert.ok(metadata.subjectActionCaptureHash);
 assert.deepEqual(stored.protocol.decisions.map(row=>row.occurrenceId),f.first.occurrences.map(row=>row.id));
 assert.equal(stored.protocol.decisionActions,undefined);
 const beforeOutput=output,beforePlan=c.store.one('SELECT * FROM change_versions WHERE id=?',after.planVersion);
 await c.close();c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
 const replay=c.inspectChange(f.workId);assert.equal(replay.phase,'PLAN_READY');assert.equal(replay.planVersion,after.planVersion);
 assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),beforeOutput);assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',after.planVersion),beforePlan);
 // Reopen alone is not proof of decoding: resolve the actual retained producer.
 const origin=await c.changes.historicalPlanningProducer(f.workId,output.id);
 assert.ok(origin,'Original encoded adjudicator is replayable through its captured recipe');origin.assertCurrent();
 const {createSubjectActionProfile,subjectActionView,subjectActionFootprint}=await import('../../dist/workflow/subject-actions.js');
 const changed=structuredClone(metadata);changed.decisionReferences.occurrenceIds[0]='FOREIGN-SUBJECT';changed.occurrences[0].id='FOREIGN-SUBJECT';
 changed.subjectActionsProfile=createSubjectActionProfile('planning-adjudication',changed.decisionReferences);
 changed.subjectActionsView=subjectActionView(changed.subjectActionsProfile,changed.decisionReferences,changed.inputVersions.base);
 changed.subjectActionCaptureHash=subjectActionFootprint('adjudicator',changed);
 c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),launch.id);
 try{await assert.rejects(()=>c.changes.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_/);}
 finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);}
 assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),beforeOutput);
});

test('unusable prospective answer retains genuine new material without adopting its plan',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),core=c.changes,originalRole=core.role;
 core.role=function(options,role,context,...rest){return originalRole.call(this,options,role,options.workId===f.workId&&role==='adjudicator'&&context.stage==='planning-adjudication'?{...context,subjectActionsInput:{version:1}}:context,...rest)};
 const description='Independent actual concern survives an invalid subject recipe hash';
 f.setObserver(({role,result})=>{
  if(role!=='adjudicator')return;
  result.decisionActions={};result.subjectActionsHash='0'.repeat(64);delete result.decisions;
  result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description,evidence:['candidate:consumer.cjs']}];
 });
 let after;try{after=await f.resume();}finally{core.role=originalRole;}
 assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.candidateVersion,f.first.candidateVersion);
 assert.equal(after.execution.consumed-f.charges,1);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
 const newest=c.store.one('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid DESC LIMIT 1',f.workId);
 assert.equal(newest.status,'unusable');assert.equal(JSON.parse(newest.raw).subjectActionsHash,'0'.repeat(64));
 assert.ok(after.occurrences.some(row=>row.data.finding.description===description),'A failed codec cannot erase meaningful raw material');
 for(const output of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);
});

test('a different selected candidate cannot reuse the previous candidate planning prefix',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),old=c.store.one('SELECT * FROM change_versions WHERE id=?',f.first.candidateVersion),id=randomUUID();
 c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,old.work,old.kind,old.id,old.artifact,old.hash,old.data);c.store.run('UPDATE change_state SET candidate=? WHERE work=?',id,f.workId);
 const after=await f.resume();assert.equal(after.candidateVersion,id);assert.equal(after.planVersion,null);
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['planner','challenger','adjudicator']);assert.equal(after.execution.consumed-f.charges,3);
});

test('planning captured without a candidate cannot be reused after a candidate appears',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),base=c.store.one('SELECT * FROM change_versions WHERE id=?',f.first.baseVersion);
 assert.equal(f.first.candidateVersion,null);
 // Even identical captured bytes do not make the new selected identity old input.
 const candidate=c.changes.newVersion(f.workId,'candidate',base.artifact,JSON.parse(base.data),base.hash,base.id);
 c.store.run('UPDATE change_state SET candidate=? WHERE work=?',candidate,f.workId);
 const after=await f.resume();assert.equal(after.candidateVersion,candidate);assert.equal(after.planVersion,null);
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['planner','challenger','adjudicator']);assert.equal(after.execution.consumed-f.charges,3);
});

for(const field of ['work','kind'])test('inconsistent selected candidate '+field+' holds before any replacement producer',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),before=c.store.one('SELECT * FROM change_versions WHERE id=?',f.first.candidateVersion);
 const foreign=field==='work'?await c.beginChange({projectId:'P',request:'Independent foreign fixture work',executionLimit:4}):null;
 c.store.run('UPDATE change_versions SET '+field+'=? WHERE id=?',field==='work'?foreign.workId:'base',before.id);
 try{const after=await f.resume();assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.deepEqual(f.calls.filter(call=>call.mode==='resume'),[]);assert.match(after.blocked.join(),/selected source versions unavailable/);}
 finally{c.store.run('UPDATE change_versions SET '+field+'=? WHERE id=?',before[field],before.id);}
});

for(const side of ['base','candidate'])for(const mutation of ['manifest','artifact'])test('retained '+side+' '+mutation+' drift during prefix proof holds before a fresh reservation',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),core=c.changes,original=core.historicalPlanningProducer;
 const id=side==='base'?f.first.baseVersion:f.first.candidateVersion,before=c.store.one('SELECT * FROM change_versions WHERE id=?',id);let changed=false;
 core.historicalPlanningProducer=async function(...args){const value=await original.apply(this,args);if(!changed){changed=true;const data=JSON.parse(before.data);if(mutation==='manifest')data.manifest.files[0].sha256='f'.repeat(64);c.store.run('UPDATE change_versions SET artifact=?,data=? WHERE id=?',mutation==='artifact'?before.artifact+'-changed':before.artifact,JSON.stringify(data),id);}return value;};
 try{const after=await f.resume();assert.equal(changed,true);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);assert.deepEqual(f.calls.filter(call=>call.mode==='resume'),[]);assert.match(after.blocked.join(),/prefix inputs or selected producer changed/);}
 finally{core.historicalPlanningProducer=original;c.store.run('UPDATE change_versions SET artifact=?,data=? WHERE id=?',before.artifact,before.data,id);}
});

test('candidate record drift while fresh J runs retains its output without plan adoption',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),before=c.store.one('SELECT * FROM change_versions WHERE id=?',f.first.candidateVersion);
 f.setObserver(event=>{acceptCandidateProposal(event);if(event.role==='adjudicator')c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',before.artifact+'-changed',before.id);});
 try{const after=await f.resume();assert.equal(after.planVersion,null);assert.equal(after.candidateVersion,before.id);assert.equal(after.execution.consumed-f.charges,1);assert.match(after.blocked.join(),/retained planning BASE or candidate changed/);assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['adjudicator']);assert.equal(c.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=?',f.workId).length,f.outputs.length+1);}
 finally{c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',before.artifact,before.id);}
});

for(const scenario of ['model','runtime','base','criteria-version','epoch','protection','source-input','latest-unusable','legacy-scope'])test('changed or unsupported premise takes fresh planning: '+scenario,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),s=c.store,originalRuntime=c.options.runtimeProfile;
 const p=f.originals.find(l=>l.role==='planner');
 if(scenario==='model')f.model.definition.models[0].maxTokens--;
 if(scenario==='runtime')await c.applyRuntimeProfile({...originalRuntime,dockerContext:'controlled-changed'});
 if(scenario==='base'){
  const base=s.one('SELECT * FROM change_versions WHERE id=(SELECT base FROM change_state WHERE work=?)',f.workId),id=randomUUID();
  s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,base.work,base.kind,base.predecessor,base.artifact,base.hash,base.data);s.run('UPDATE change_state SET base=? WHERE work=?',id,f.workId);
 }
 if(scenario==='criteria-version'){const old=s.one("SELECT * FROM change_versions WHERE id=(SELECT json_extract(data,'$.contractsVersion') FROM change_state WHERE work=?)",f.workId),id=randomUUID(),row=s.one('SELECT data FROM change_state WHERE work=?',f.workId);s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,old.work,old.kind,old.predecessor,old.artifact,old.hash,old.data);s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...JSON.parse(row.data),contractsVersion:id}),f.workId);}
 if(scenario==='protection')await c.setProjectProtection({projectId:'P',expectedRevision:c.inspectProjectProtection('P').revision,protectedPaths:['check.cjs']});
 if(scenario==='source-input'){const run=s.one('SELECT data FROM runs WHERE id=?',p.run);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(run.data),sourceInputHash:'previous-input-chain'}),p.run);}
 if(scenario==='epoch')s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId);
 if(scenario==='latest-unusable')s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',randomUUID(),f.workId,p.run,'planner',p.epoch,'UNUSABLE','none',p.data);
 if(scenario==='legacy-scope'){const data=JSON.parse(p.data);delete data.inputScope;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 try{const after=await f.resume();assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['planner','challenger','adjudicator'],JSON.stringify(after.blocked));assert.equal(after.execution.consumed-f.charges,3);assert.equal(after.planVersion,null);}
 finally{if(scenario==='runtime')await c.applyRuntimeProfile(originalRuntime);}
});

for(const scenario of ['wrong-stage','duplicate-output','checkpoint','missing-history','truncated','unsettled','scope-census'])test('inconsistent complete prefix holds before fresh reservation: '+scenario,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),s=c.store,p=f.originals.find(l=>l.role==='planner'),data=JSON.parse(p.data),run=s.one('SELECT * FROM runs WHERE id=?',p.run),rd=JSON.parse(run.data),output=f.outputs.find(o=>o.launch===p.id);
 if(scenario==='wrong-stage'){data.stage='source-fit';s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 if(scenario==='duplicate-output')s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),output.launch,output.raw,output.status,output.data);
 if(scenario==='checkpoint'){rd.nativeCheckpoint.sha256='b'.repeat(64);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(rd),run.id);}
 if(scenario==='missing-history')await fs.rename(rd.historyRef,rd.historyRef+'.retained');
 if(scenario==='truncated'){const od=JSON.parse(output.data);od.rawFinalTruncated=true;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(od),output.id);}
 if(scenario==='unsettled')s.run("UPDATE runs SET phase='UNKNOWN' WHERE id=?",run.id);
 if(scenario==='scope-census'){data.inputScope.occurrenceIds.push('invented');s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);assert.ok(after.blocked.length);
 // This is a negative provenance fixture, not an actual unresolved physical run.
 if(scenario==='unsettled')s.run('UPDATE runs SET phase=? WHERE id=?',run.phase,run.id);
});

for(const changed of ['record','history'])test('all-prefix fence rejects P drift during later C evidence await: '+changed,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.historicalPlanningProducer,p=f.originals.find(l=>l.role==='planner'),ch=f.originals.find(l=>l.role==='challenger');let cReads=0,injected=false;
 core.historicalPlanningProducer=async function(work,outputId){
  const value=await original.call(this,work,outputId);
  if(work===f.workId&&value.launch.id===ch.id&&++cReads===1){
   injected=true;
   if(changed==='record')c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringProof:true}),p.id);
   else await fs.appendFile(JSON.parse(p.data).historyRef,'\n');
  }
  return value;
 };
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.phase,'BLOCKED');assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);assert.match(after.blocked.join(),/changed/);}
 finally{core.historicalPlanningProducer=original;}
});

function acceptWithRetainedDuties({role,body,result}){
 if(role!=='adjudicator')return;
 result.planAccepted=true;result.acceptedPlan=body.context.planProposal;
 result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'Retain actual baseline defect as implementation duty',witnesses:['base:consumer.cjs']}));
 assert.deepEqual(body.context.decisionCarry,{version:2});for(const decision of result.decisions)decision.implementation={kind:'assign-to-plan',baselineVersion:body.context.baseVersion,requirementIds:['R1']};
}
// Deliberately seeded historical closure; the current role/capture/adoption path
// is real, while these old verdicts do not claim learned or engine qualification.
async function retainedWorld(t){
 const f=await world(t,'adjudicator',({role,result})=>{
  if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Prior baseline concern',evidence:['base:consumer.cjs']}];
 });
 const [target,member]=f.first.occurrences;assert.ok(target&&member);
 const rows=[];
 for(const [occurrence,decision] of [[target,{disposition:'rejected'}],[member,{disposition:'equivalent',equivalentTo:target.id}]]){
  const id=randomUUID(),data={occurrenceId:occurrence.id,...decision,reason:'Controlled historical verdict',witnesses:['base:consumer.cjs']};
  c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',id,occurrence.id,f.originals.at(-1).id,decision.disposition,JSON.stringify(data));
  c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence:occurrence.id,state:'resolved',...decision}),occurrence.id);
  rows.push(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',id));
 }
 return {...f,target,member,rows};
}
test('original planning capture retains exact closed rows without replaying verdicts or carry',{timeout:30000},async t=>{
 const f=await retainedWorld(t);let captured;
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  acceptWithRetainedDuties(event);captured=event.body.context.decisionReferences;
  assert.equal(captured.version,3);assert.equal(captured.retentionChoices.length,2);
  event.result.retainedDispositions=captured.retentionChoices.map(row=>row.dispositionId);
  event.result.decisions=event.result.decisions.filter(row=>![f.target.id,f.member.id].includes(row.occurrenceId));
 });
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 for(const row of f.rows){assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',row.id),row);assert.equal(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',row.occurrence).length,1);}
 const judge=f.launches().at(-1);assert.deepEqual(JSON.parse(judge.data).decisionReferences,captured);
});
for(const drift of ['row','latest','pending'])test('retention '+drift+' drift refuses before criteria and source-fit effects',{timeout:30000},async t=>{
 const f=await retainedWorld(t),core=c.changeCore,originalAdopt=core.adoptCriteria,originalInput=core.prepareInputDecisions;let effects=0;
 core.adoptCriteria=()=>{effects++;assert.fail('Stale retention reached criteria adoption')};core.prepareInputDecisions=()=>{effects++;assert.fail('Stale retention reached source-fit preparation')};
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  acceptWithRetainedDuties(event);event.result.retainedDispositions=event.body.context.decisionReferences.retentionChoices.map(row=>row.dispositionId);
  event.result.decisions=event.result.decisions.filter(row=>![f.target.id,f.member.id].includes(row.occurrenceId));
  if(drift==='row')c.store.run('UPDATE finding_dispositions SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.rows[0].data),reason:'Changed after capture'}),f.rows[0].id);
  if(drift==='latest')c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',randomUUID(),f.target.id,f.rows[0].launch,'rejected',f.rows[0].data);
  if(drift==='pending')c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',state:'pending'}),f.target.id);
 });
 try{const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/Retained disposition changed/);assert.equal(f.launches().at(-1).status,'COMPLETE');assert.equal(effects,0);}
 finally{core.adoptCriteria=originalAdopt;core.prepareInputDecisions=originalInput;}
});
test('retained equivalent row reopens when its target acquires a new implementation duty',{timeout:30000},async t=>{
 const f=await retainedWorld(t);
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);
  event.result.retainedDispositions=[f.rows[1].id];event.result.decisions=event.result.decisions.filter(row=>row.occurrenceId!==f.member.id);
 });
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/unaccounted/);
 assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',f.rows[1].id),f.rows[1]);
 assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',f.member.id).data).state,'pending');
});
test('planning rechecks adjudication allowance after model selection and before reserving the planner',{timeout:30000},async t=>{
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3'});
 const {lineage}=c.store.one('SELECT lineage FROM works WHERE id=?',workId);
 const core=c.changeCore,select=core.selectRoleModel;
 const model=scripted(()=>assert.fail('Exhausted planning dispatched a provider'));
 let selected=false;
 core.selectRoleModel=async function(options,role){
  const value=await select.call(this,options,role);
  if(options.workId===workId&&role==='planner'){
   c.store.run("UPDATE budgets SET reserved=lim-consumed WHERE lineage=? AND kind='resolution'",lineage);
   selected=true;
  }
  return value;
 };
 const before=c.inspectChange(workId),runs=c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId);
 let result;
 try{result=await c.planChange({workId,model});}finally{core.selectRoleModel=select;}
 assert.equal(selected,true);
 assert.match(result.blocked.join('\n'),/Resolution allowance exhausted/);
 assert.deepEqual(result.execution,before.execution);
 assert.equal(result.resolution.consumed,before.resolution.consumed);
 assert.deepEqual(c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),runs);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM role_launches WHERE work=?',workId).n,0);
});

test('fresh J may adopt original P/C with one remaining resolution unit',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');
 const {lineage}=c.store.one('SELECT lineage FROM works WHERE id=?',f.workId);
 c.store.run("UPDATE budgets SET consumed=lim-1 WHERE lineage=? AND kind='resolution'",lineage);
 f.setObserver(acceptWithRetainedDuties);const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 assert.equal(after.resolution.consumed,after.resolution.limit);
 const plan=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',after.planVersion).data);
 assert.equal(plan.authorLaunch,f.originals.find(l=>l.role==='planner').id);assert.equal(plan.challengeLaunch,f.originals.find(l=>l.role==='challenger').id);assert.notEqual(plan.decisionLaunch,f.originals.find(l=>l.role==='adjudicator').id);assert.equal(after.execution.consumed-f.charges,1);
});

test('replacement planning producers receive bounded historical failure without adopting it as judgment',{timeout:30000},async t=>{
 const f=await world(t,'planner');
 for(const call of f.calls){assert.equal(call.body.context.priorPlanningFailure,undefined);assert.equal(call.body.context.currentPlanningDiagnostics,undefined);}
 const seen=[];
 f.setObserver(({role,body})=>{
  const feedback=body.context.priorPlanningFailure;assert.ok(feedback,role);
  assert.equal(feedback.workId,f.workId);assert.equal(feedback.epoch,f.first.epoch);
  assert.ok(feedback.messages.some(message=>message.includes('PROTOCOL:')));
  for(const message of feedback.messages)assert.ok(f.first.blocked.includes(message),'Feedback retains actual prior refusal; resolved recovery instructions may be removed');
  assert.ok(Buffer.byteLength(JSON.stringify(feedback))<=8192);
  assert.match(feedback.interpretation,/Historical diagnostics only/);
  const current=body.context.currentPlanningDiagnostics,original=f.outputs.find(output=>output.status==='unusable');
  assert.ok(current,role);assert.equal(current.kind,'current-planner-structural-diagnostics');
  assert.equal(current.outputId,original.id);assert.equal(current.launchId,original.launch);
  assert.equal(current.rawSha256,createHash('sha256').update(original.raw).digest('hex'));
  assert.match(current.issues.join(),/Unexpected or missing fields/);assert.equal(current.omittedIssues,0);
  assert.match(current.interpretation,/Separate from historical/);assert.ok(Buffer.byteLength(JSON.stringify(current))<=4096);seen.push(role);
 });
 const after=await f.resume();assert.deepEqual(seen,['planner','challenger','adjudicator'],JSON.stringify(after.blocked));
 assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null,'Negative independent judgment still refuses adoption');
 assert.equal(after.execution.consumed,f.charges+3);
 for(const output of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);
});

test('current planner diagnosis omits unavailable proof and never searches past a newer planning launch',{timeout:30000},async t=>{
 const f=await world(t,'planner'),core=c.changeCore,row=core.row(f.workId),failure=core.priorPlanningFailure(f.workId,row);
 const output=f.outputs.find(output=>output.status==='unusable'),metadata=JSON.parse(output.data);
 const diagnostic=c.store.one('SELECT * FROM obligations WHERE id=?','diagnostic-'+output.launch),duty=JSON.parse(diagnostic.data);
 const read=()=>core.currentPlanningDiagnostics(f.workId,failure);
 assert.ok(await read());
 for(const mutate of [m=>m.nativeEntryId='foreign',m=>m.rawFinalTruncated=true,m=>m.terminal='aborted',m=>m.issues=['Detached primary issue']]){
  const changed=structuredClone(metadata);mutate(changed);c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(changed),output.id);
  try{assert.equal(await read(),undefined);}finally{c.store.run('UPDATE role_outputs SET data=? WHERE id=?',output.data,output.id);}
 }
 for(const change of [{output:'foreign'},{rawComplete:false},{issues:['Unrelated failure']}]){
  c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...duty,...change}),diagnostic.id);
  try{assert.equal(await read(),undefined);}finally{c.store.run('UPDATE obligations SET data=? WHERE id=?',diagnostic.data,diagnostic.id);}
 }
 assert.equal(await core.currentPlanningDiagnostics(f.workId,{...failure,epoch:failure.epoch+1}),undefined);
 assert.equal(await core.currentPlanningDiagnostics(f.workId,{...failure,generation:failure.generation+1}),undefined);
 const original=f.originals.at(-1),later=randomUUID();
 c.store.run('INSERT INTO role_launches(id,work,run,role,epoch,status,resolution_reservation,data) VALUES(?,?,?,?,?,?,?,?)',later,f.workId,original.run,'adjudicator',original.epoch,'COMPLETE','none',JSON.stringify({stage:'planning-adjudication'}));
 try{assert.equal(await read(),undefined,'A newer planning judgment cannot resurrect an older planner failure');}finally{c.store.run('DELETE FROM role_launches WHERE id=?',later);}
});

test('current planner diagnostic source drift refuses before replacement reservation',{timeout:30000},async t=>{
 const f=await world(t,'planner'),core=c.changeCore,select=core.selectRoleModel,original=f.outputs.find(output=>output.status==='unusable');let changed=false;
 core.selectRoleModel=async function(options,role){const value=await select.call(this,options,role);if(options.workId===f.workId&&role==='planner'&&this.row(f.workId).phase==='PLANNING'&&!changed){changed=true;c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',original.raw+' ',original.id);}return value;};
 let after;try{after=await f.resume();}finally{core.selectRoleModel=select;c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',original.raw,original.id);}
 assert.equal(changed,true);assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/diagnostic source changed/);
 assert.equal(after.execution.consumed,f.charges);assert.equal(after.execution.reserved,0);
 assert.equal(f.calls.filter(call=>call.mode==='resume').length,0,'No provider dispatch with stale diagnostic source');
});

for(const boundary of ['body','capture'])test('current planner diagnostic '+boundary+' drift during capacity cannot dispatch',{timeout:30000},async t=>{
 const f=await world(t,'planner'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity;let current,injected=false;
 core.bundle=async function(...args){const value=await bundle.apply(this,args);if(value.bundle.context.currentPlanningDiagnostics)current=value.bundle;return value;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){injected=true;if(boundary==='body')current.context.currentPlanningDiagnostics.issues=['Invented verdict'];else{const row=c.store.one('SELECT id,data FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1',f.workId),data=JSON.parse(row.data);data.currentPlanningDiagnostics.issues=['Invented verdict'];c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);}}return lease;};
 let after;try{after=await f.resume();}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;}
 assert.equal(injected,true,JSON.stringify(after.blocked));assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/planning feedback changed/);
 assert.equal(after.execution.reserved,0);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);
});

test('cancellation during current planner diagnosis custody read cannot reserve a replacement',{timeout:30000},async t=>{
 const f=await world(t,'planner'),core=c.changeCore,diagnose=core.currentPlanningDiagnostics,entries=core.nativeEntries,abort=new AbortController();let reading=false,cancelled=false;
 core.currentPlanningDiagnostics=async function(...args){reading=true;try{return await diagnose.apply(this,args);}finally{reading=false;}};
 core.nativeEntries=async function(...args){const value=await entries.apply(this,args);if(reading){cancelled=true;abort.abort();}return value;};
 let after;try{after=await f.resume(abort.signal);}finally{core.currentPlanningDiagnostics=diagnose;core.nativeEntries=entries;}
 assert.equal(cancelled,true);assert.equal(after.phase,'BLOCKED');assert.equal(after.execution.consumed,f.charges);assert.equal(after.execution.reserved,0);
 assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);
});

test('planning retry supplies the prior host adoption refusal to fresh J',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');
 assert.equal(f.calls.find(call=>call.role==='adjudicator').body.context.priorPlanningFailure,undefined);
 f.setObserver(event=>{acceptWithRetainedDuties(event);if(event.role==='adjudicator')for(const decision of event.result.decisions)decision.implementation.requirementIds=['foreign-requirement'];});
 const refused=await f.resume();assert.equal(refused.phase,'BLOCKED');assert.equal(refused.planVersion,null);
 assert.match(refused.blocked.join(),/BASE|baseline|mapping/);
 const previous=f.launches().at(-1);assert.equal(previous.status,'COMPLETE','A usable producer is distinct from host plan adoption');
 const outputs=c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',previous.id);
 let received;
 f.setObserver(({role,body})=>{
  if(role!=='adjudicator')return;
  received=structuredClone(body.context);
 });
 const after=await f.resume();assert.ok(received);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,refused.execution.consumed+1);
 const strings=[];const visit=value=>{if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);};visit(received);
 for(const reason of refused.blocked)assert.ok(strings.includes(reason),'The next independent judge needs the actual host refusal, not only the previous producer success and pending findings');
 for(const occurrence of refused.occurrences)assert.ok(received.occurrences.some(current=>current.id===occurrence.id));
 assert.equal(received.priorPlanningFailure.workId,f.workId);assert.equal(received.priorPlanningFailure.epoch,refused.epoch);
 assert.equal(received.priorPlanningFailure.recordedPhase,'BLOCKED');assert.equal(received.priorPlanningFailure.omittedMessages,0);
 assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',previous.id),previous);
 assert.deepEqual(c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',previous.id),outputs);
});

for(const failure of ['carry','amendment','version-write'])test('rejected planning adoption retains the original owner source hold: '+failure,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),conversation=c.createConversation();
 const input=await c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:0,text:'Keep the requested export3 behavior and account for this owner direction',mode:'idle'});
 const direction=c.store.one('SELECT * FROM conversation_directions WHERE conversation=?',conversation.conversationId);
 assert.ok(direction);assert.equal(JSON.parse(direction.data).inputId,input.inputId);
 // Controlled binding of a real recorded owner input to this planning work;
 // the public planning, role capture and source-fit mutation remain real.
 c.store.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',JSON.stringify({...JSON.parse(direction.data),affectedWorkId:f.workId,effectHold:true}),direction.conversation,direction.revision);
 const before=c.store.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?',direction.conversation,direction.revision);
 const versions=()=>c.store.all("SELECT * FROM change_versions WHERE work=? AND kind IN ('plan','requirements','verification') ORDER BY rowid",f.workId),beforeVersions=versions();
 const requirements=()=>c.store.all('SELECT * FROM requirements WHERE work=? ORDER BY version',f.workId),beforeRequirements=requirements();
 f.setObserver(event=>{
  acceptWithRetainedDuties(event);if(event.role!=='adjudicator')return;
  if(failure==='carry')for(const decision of event.result.decisions)decision.implementation.requirementIds=['foreign-requirement'];
  if(failure==='amendment'){
   const check=event.result.acceptedPlan.verification.checks[0];
   event.result.acceptedPlan.verification.checkAmendments=[{obligationId:'missing-current-check',failedCheckRunId:'missing-failed-receipt',basis:'fixture-defect',correctedCheckId:check.id,fixturePaths:['check.cjs'],negativeAssertions:[check.assertions[0]],reason:'An amendment must identify an actual pending failed check'}];
  }
 });
 // Fail after the real plan and requirements inserts, without changing the
 // transaction implementation or bypassing earlier semantic checks.
 if(failure==='version-write')c.store.db.exec(`CREATE TEMP TRIGGER refuse_planning_verification BEFORE INSERT ON change_versions WHEN NEW.work='${f.workId}' AND NEW.kind='verification' BEGIN SELECT RAISE(ABORT,'Controlled verification version write refusal'); END`);
 let refused;
 try{refused=await f.resume();}finally{if(failure==='version-write')c.store.db.exec('DROP TRIGGER refuse_planning_verification');}
 assert.equal(refused.phase,'BLOCKED');assert.equal(refused.planVersion,null);assert.match(refused.blocked.join(),failure==='carry'?/BASE|baseline|mapping/:failure==='amendment'?/Amendment must name current pending check obligation/:/Controlled verification version write refusal/);
 assert.deepEqual(c.store.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?',direction.conversation,direction.revision),before,'A plan that was not adopted cannot release its owner source hold');
 assert.deepEqual(versions(),beforeVersions);assert.deepEqual(requirements(),beforeRequirements);
 const judgment=f.launches().at(-1),outputs=c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',judgment.id);
 assert.equal(judgment.status,'COMPLETE');assert.equal(refused.execution.consumed>f.charges,true);assert.equal(refused.execution.reserved,0);
 f.setObserver(acceptWithRetainedDuties);
 const adopted=await f.resume();assert.equal(adopted.phase,'PLAN_READY',JSON.stringify(adopted.blocked));
 const applied=JSON.parse(c.store.one('SELECT data FROM conversation_directions WHERE conversation=? AND revision=?',direction.conversation,direction.revision).data);
 assert.equal(applied.effectHold,false);assert.equal(applied.decision.launch,c.changeCore.version(adopted.planVersion).data.decisionLaunch);
 assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',judgment.id),judgment);assert.deepEqual(c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',judgment.id),outputs);
 assert.equal(adopted.execution.consumed>refused.execution.consumed,true);assert.equal(adopted.execution.reserved,0);
});

test('planning recovery feedback bounds serialized UTF8 and preserves current duties',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),row=c.store.one('SELECT * FROM change_state WHERE work=?',f.workId),data=JSON.parse(row.data);
 const messages=['가😀'.repeat(3000),'현재 검증에서 빠진 지적사항을 독립적으로 처리해야 합니다.'];
 c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...data,blocked:messages}),f.workId);
 let received;f.setObserver(({role,body})=>{if(role==='adjudicator')received=structuredClone(body.context);});
 const after=await f.resume();assert.ok(received);assert.equal(after.planVersion,null);
 assert.ok(Buffer.byteLength(JSON.stringify(received.priorPlanningFailure),'utf8')<=8192);
 assert.deepEqual(received.priorPlanningFailure.messages,[messages[1]]);assert.equal(received.priorPlanningFailure.omittedMessages,1);
 for(const occurrence of f.first.occurrences)assert.ok(received.occurrences.some(current=>current.id===occurrence.id));
 const entry={...row,data:{...data,blocked:messages}},core=c.changeCore;
 assert.equal(core.priorPlanningFailure(f.workId,{...entry,phase:'BASE_CAPTURED'}),undefined);
 assert.equal(core.priorPlanningFailure(f.workId,{...entry,data:{...entry.data,resumeStage:'implement'}}),undefined);
 const detached=core.priorPlanningFailure(f.workId,entry);detached.messages.push('Local projection mutation');assert.deepEqual(entry.data.blocked,messages);
});

test('coordinator continues the exact failed publication after one owner-reviewed rules update', {timeout:30000}, async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const payload=path.join(root,'assignment-rule-refresh-'+randomUUID()),shipped=path.dirname(await fs.realpath(fileURLToPath(new URL('../../dist/',import.meta.url))));
 await fs.mkdir(payload);await fs.cp(path.join(shipped,'dist'),path.join(payload,'dist'),{recursive:true});
 for(const name of ['package.json','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md'])await fs.copyFile(path.join(shipped,name),path.join(payload,name));
 for(const name of ['node_modules','runtime'])await fs.symlink(path.join(shipped,name),path.join(payload,name));
 const {openController:open}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')));
 const {assignmentResumeFingerprint}=await import(pathToFileURL(path.join(payload,'dist/controller/assignment-authority.js')));
 const selected=await open({installationHome:path.join(payload,'home'),runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(payload,'home/artifacts');
 t.after(async()=>{await selected.close();process.env.TMPDIR=previousTemp;});
 await selected.registerProject({id:'P',sourceRoot:source});
 const parent=selected.createConversation({projectId:'P'}).conversationId,s=selected.store,roles=[];
 let afterRefresh=false,refreshedCriteria,accepted;
 const get=(context,name)=>{
  const user=context.messages.findLastIndex(message=>message.role==='user');
  const result=context.messages.slice(user+1).findLast(message=>message.role==='toolResult'&&message.toolName===name);
  return result && JSON.parse(result.content.map(part=>part.text).join(''));
 };
 let assignment;
 const model=scripted(context=>{
  if(!afterRefresh)return get(context,'conversation_assign')?{text:'The original governed task is queued.'}:
   {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3 with observed cases',resultDependency:false}}};
  const status=get(context,'conversation_status');
  if(!status)return{tool:{name:'conversation_status',arguments:{conversationId:assignment.target}}};
  accepted=get(context,'conversation_resume_assignment');
  if(accepted)return{text:'Explicit continuation of the same task was queued.'};
  assert.equal(status.assignments[0].resume.resultId,JSON.parse(assignment.data).resultId);
  return{tool:{name:'conversation_resume_assignment',arguments:status.assignments[0].resume}};
 },({role,body,result})=>{
  if (!role) return;
  roles.push(role);
  if(!afterRefresh && role==='challenger')result.unexpected='Controlled original procedure failure';
  if(afterRefresh && role==='adjudicator'){
   refreshedCriteria=body.context.criteriaRefresh;
   assert.equal(body.context.sourceInputChain.some(input=>input.data.effectHold),false);
   result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];
  }
 });
 const turn=async text=>{
  await selected.queueConversationInput({conversationId:parent,expectedGeneration:selected.inspectConversation(parent).generation,text,mode:'idle'});
  assert.equal((await selected.runConversation({conversationId:parent,model})).status,'delivered');
  await selected.ordinaryCore.drain();
 };
 await turn('Delegate the original task.');
 assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent);
 assert.equal(assignment.state,'UNAVAILABLE');
 const {work,target,id}=assignment,resultId=JSON.parse(assignment.data).resultId;
 const old=s.one('SELECT * FROM conversation_results WHERE id=?',resultId);
 const directions=s.all('SELECT * FROM conversation_directions WHERE conversation=?',target);
 const before=selected.inspectChange(work);
 const oldFingerprint=assignmentResumeFingerprint(s,resultId,target,work,before.epoch);
 assert.ok(oldFingerprint);
 await fs.appendFile(path.join(payload,'DESIGN.md'),'\nOwned fixture rule clarification.\n');
 const tUi=translator('en'), back=tUi('workRecovery.backToSource');
 const choices=[tUi('criteria.entry'),tUi('criteria.reviewAdoption'),tUi('criteria.adopt'),back];
 const owner=workCommands({
  controller:selected,
  isCurrent:cid=>cid===parent,
  async choose(title,rows){
   const next=choices.shift();assert.ok(rows.includes(next));
   if(next===back){assert.ok(title.includes(work));assert.ok(title.includes(tUi('criteria.saved')));}
   return next;
  },
  async show(_title,_text,primary){assert.equal(primary?.label,tUi('criteria.reviewOptions'));await primary.run();},
  async input(){return 'Owner reviews the updated rules for the same task.';},
  activate:()=>assert.fail('Rules review must stay with the owner'),
  notice(){},
 })[0];
 assert.equal(await owner.run(work,parent),'completed');
 assert.deepEqual(choices,[]);
 afterRefresh=true;
 const current=selected.changeCore.row(work);
 assert.equal(current.phase,'BASE_CAPTURED');
 const after=assignmentResumeFingerprint(s,resultId,target,work,before.epoch);
 assert.ok(after);assert.notEqual(after,oldFingerprint);
 assert.equal(assignmentResumeFingerprint(s,resultId,target,work,current.epoch),null,'The publication does not belong to the post-refresh epoch');
 assert.equal(assignmentResumeFingerprint(s,resultId,target,work),after,'Dispatch reconstructs the same publication binding');
 const sourceId=current.data.criteriaRefresh.sourceId;
 const saved=s.one('SELECT origin FROM sources WHERE id=?',sourceId).origin;
 const mutateProof=origin=>{
  const value=JSON.parse(saved);origin(value);
  s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(value),sourceId);
 };
 const restoreProof=()=>s.run('UPDATE sources SET origin=? WHERE id=?',saved,sourceId);
 try{
  for(const edit of [origin=>{delete origin.assignmentResume;},origin=>{origin.assignmentResume.resultId=randomUUID();},
   origin=>{origin.assignmentResume.fromEpoch--;},origin=>{origin.fromContractsVersion=randomUUID();}]){
   mutateProof(edit);
   assert.equal(assignmentResumeFingerprint(s,resultId,target,work,before.epoch),null);
  }
 }finally{restoreProof();}
 const priorDirection=selected.inspectConversation(target).directionRevision;
 s.run('UPDATE conversation_state SET direction=direction+1 WHERE conversation=?',target);
 try{assert.equal(assignmentResumeFingerprint(s,resultId,target,work,before.epoch),null);}
 finally{s.run('UPDATE conversation_state SET direction=? WHERE conversation=?',priorDirection,target);}
 const unrelated=randomUUID(), targetView=selected.inspectConversation(target);
 s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',unrelated,target,targetView.generation,work,
  s.one('SELECT source FROM works WHERE id=?',work).source,'QUEUED','idle','Controlled unrelated target input','{}');
 try{assert.equal(assignmentResumeFingerprint(s,resultId,target,work,before.epoch),null);}
 finally{s.run('DELETE FROM conversation_inputs WHERE id=?',unrelated);}
 const launch=selected.ordinary.h.launchChange;
 let dispatchRefused=false;
 selected.ordinary.h.launchChange=async(assignmentId,options)=>{
  const delivery=captureGovernedAssignmentInput(s,assignmentId);
  mutateProof(origin=>{origin.toHash='0'.repeat(64);});
  try{
   assert.throws(()=>consumeGovernedAssignmentInput(s,assignmentId,work,delivery),/input changed before admission/);
   dispatchRefused=true;
  }finally{restoreProof();}
  return launch(assignmentId,options);
 };
 await turn('Continue the exact original task under the reviewed rules and unchanged instructions.');
 assert.equal(dispatchRefused,true);
 assert.equal(accepted.accepted,true);assert.equal(accepted.assignmentId,id);assert.equal(accepted.workId,work);
 assert.equal(refreshedCriteria.sourceId,sourceId);assert.equal(s.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=?',parent).n,1);
 assert.deepEqual(roles,['planner','challenger','planner','challenger','adjudicator']);
 assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',resultId),old);
 assert.deepEqual(s.all('SELECT * FROM conversation_directions WHERE conversation=?',target),directions);
 const [request]=JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?',id).data).reentries;
 assert.equal(request.resumeResultId,resultId);
 assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',request.inputId).state,'CONSUMED');
 assert.equal(selected.inspectChange(work).epoch,before.epoch+1);
});

for(const failure of ['adoption','producer','planner'])test('explicit criteria refresh retains previous '+failure+' failure through public recovery',{timeout:30000},async t=>{
 const producer=failure!=='adoption';
 t.after(()=>{if(t.passed===false)failures++});
 const isolated=path.join(root,'refresh-feedback-'+randomUUID()),payload=path.join(isolated,'payload');await fs.mkdir(payload,{recursive:true});
 const shipped=path.dirname(await fs.realpath(fileURLToPath(new URL('../../dist/', import.meta.url))));
 await fs.cp(path.join(shipped,'dist'),path.join(payload,'dist'),{recursive:true});
 for(const name of ['package.json','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md'])await fs.copyFile(path.join(shipped,name),path.join(payload,name));
 for(const name of ['node_modules','runtime'])await fs.symlink(path.join(shipped,name),path.join(payload,name));
 const {openController:open}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')));
 const options={installationHome:path.join(isolated,'home'),runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}};
 let selected=await open(options);t.after(()=>selected.close());await selected.registerProject({id:'P',sourceRoot:source});
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(options.installationHome,'artifacts');t.after(()=>{process.env.TMPDIR=previousTemp;});
 const {workId}=await selected.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:failure==='producer'?4:20,resolutionLimit:failure==='producer'?2:12});let refreshed=false,received,providerCalls=0;
 const model=scripted(undefined,({role,body,result})=>{
  providerCalls++;
  if(refreshed&&failure==='planner'){assert.ok(body.context.currentPlanningDiagnostics);assert.equal(body.context.currentPlanningDiagnostics.epoch,refused.epoch);assert.match(body.context.currentPlanningDiagnostics.issues.join(),/Unexpected or missing fields/);}
  if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original baseline exports2 instead of3',evidence:['base:consumer.cjs exports2']}];
  if(role===(failure==='planner'?'planner':'adjudicator')&&!refreshed){if(producer)result.unexpected='Controlled unusable producer with retained material';else{acceptWithRetainedDuties({role,body,result});for(const decision of result.decisions)decision.implementation.requirementIds=['foreign-requirement'];}}
  if(role==='adjudicator'&&refreshed){received=structuredClone(body.context);if(producer){acceptWithRetainedDuties({role,body,result});const {sourceId,fromContractsVersion,toContractsVersion}=body.context.criteriaRefresh;result.criteriaDecision={sourceId,fromContractsVersion,toContractsVersion,verdict:'adopt',reason:'Independently adopt the actual supplied updated criteria without changing the owner request or waiving retained findings'};}else{result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];}}
 });
 const refused=await selected.planChange({workId,model});assert.match(refused.blocked.join(),producer?/unexpected/i:/BASE|baseline|mapping/);
 const oldLaunches=selected.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId);
 const oldBudgets=selected.store.all('SELECT * FROM budgets ORDER BY rowid');
 await fs.appendFile(path.join(payload,'DESIGN.md'),'\nOwned isolated criteria clarification for recovery feedback.\n');
 await selected.refreshChangeCriteria({workId,expectedEpoch:refused.epoch,reason:'Explicitly adopt current rules while preserving the original failed task'});
 assert.equal(selected.inspectChange(workId).epoch,refused.epoch+1);assert.equal(selected.inspectChange(workId).recordedPhase,'BASE_CAPTURED');assert.equal(selected.inspectChange(workId).phase,producer?'BLOCKED':'BASE_CAPTURED');
 assert.deepEqual(selected.store.all('SELECT * FROM budgets ORDER BY rowid'),oldBudgets);
 const entry=selected.changeCore.row(workId),refresh=entry.data.criteriaRefresh,event=selected.store.one('SELECT * FROM sources WHERE id=?',refresh.sourceId),origin=JSON.parse(event.origin);
 assert.equal(event.raw,'Explicitly adopt current rules while preserving the original failed task');
 if(failure==='adoption')assert.deepEqual(origin.priorPlanningFailure.messages,refused.blocked);
 // Corrupt only controlled fixture correspondence; no invalid history is accepted or repaired.
 for(const change of [o=>{o.work='foreign'},o=>{o.toHash='0'.repeat(64)},o=>{o.fromContractsVersion=refresh.toContractsVersion},
  o=>{o.priorPlanningFailure.epoch--},o=>{o.priorPlanningFailure.generation++},o=>{o.priorPlanningFailure.messages=['가'.repeat(8192)]},
  o=>{o.priorPlanningFailure.omittedMessages=-1},o=>{o.priorPlanningFailure.authority='accept'}]){
  const changed=structuredClone(origin);change(changed);selected.store.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(changed),event.id);
  try{assert.equal(selected.changeCore.priorPlanningFailure(workId,entry),undefined);}finally{selected.store.run('UPDATE sources SET origin=? WHERE id=?',event.origin,event.id);}
 }
 const contracts=selected.store.one('SELECT * FROM change_versions WHERE id=?',refresh.toContractsVersion);
 selected.store.run('UPDATE change_versions SET predecessor=NULL WHERE id=?',contracts.id);
 try{assert.equal(selected.changeCore.priorPlanningFailure(workId,entry),undefined);}finally{selected.store.run('UPDATE change_versions SET predecessor=? WHERE id=?',contracts.predecessor,contracts.id);}
 await selected.close();selected=await open(options);refreshed=true;
 if(failure==='producer'){
  const beforeCalls=providerCalls,beforeRuns=selected.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),beforeOutputs=selected.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',workId),entry=selected.inspectChange(workId);
  assert.equal(selected.inspectWorkRecovery(workId).nextAction,entry.nextAction);assert.match(entry.nextAction,/Extend shared execution allowance/);assert.match(entry.nextAction,/Extend shared resolution allowance/);assert.match(entry.nextAction,/\/change resume/);
  await assert.rejects(selected.planChange({workId,model}),/explicit drive\/resume recovery/);
  const exhausted=await selected.driveChange({workId,model,maximumSteps:1});assert.equal(exhausted.phase,'BLOCKED');assert.equal(exhausted.execution.consumed,refused.execution.consumed);assert.equal(exhausted.execution.reserved,0);
  assert.equal(providerCalls,beforeCalls);assert.deepEqual(selected.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),beforeRuns);assert.deepEqual(selected.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',workId),beforeOutputs);
  const recovery=selected.store.one("SELECT * FROM sources WHERE json_extract(origin,'$.kind')='explicit-producer-recovery'");assert.ok(recovery);assert.ok(selected.inspectChange(workId).occurrences.every(o=>JSON.parse(selected.store.one('SELECT data FROM obligations WHERE id=?',o.id).data).state==='pending'));
  selected.extendExecutionAllowance({workId,additional:3,reason:'Authorize the three fresh planning producers after preserving original exhausted usage'});selected.extendResolutionAllowance({workId,additional:2,reason:'Authorize fresh challenge and independent planning adjudication'});
 }
 const after=producer?await selected.driveChange({workId,model,maximumSteps:1}):await selected.planChange({workId,model});assert.ok(received);assert.equal(after.execution.consumed,refused.execution.consumed+3);
 if(producer){assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(after.planVersion);assert.ok(after.occurrences.every(o=>JSON.parse(selected.store.one('SELECT data FROM obligations WHERE id=?',o.id).data).state==='pending'));}
 else{assert.equal(after.planVersion,null);for(const reason of refused.blocked)assert.ok(received.priorPlanningFailure?.messages.includes(reason),'An explicit owned rules refresh must not erase the previous host refusal from same-work recovery');assert.equal(received.priorPlanningFailure.epoch,refused.epoch,'The historical diagnostic keeps its actual older epoch');}
 assert.equal(received.priorPlanningFailure.workId,workId);
 if(failure==='adoption')assert.deepEqual(selected.changeCore.priorPlanningFailure(workId,selected.changeCore.row(workId)).messages,after.blocked,'The new blocked entry overrides older refresh feedback');
 for(const launch of oldLaunches)assert.deepEqual(selected.store.one('SELECT * FROM role_launches WHERE id=?',launch.id),launch);
});

test('prefix mutation during diagnosis await cannot adopt or resolve old duties',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.prevalidateDiagnoses,p=f.originals.find(l=>l.role==='planner');let injected=false;f.setObserver(acceptWithRetainedDuties);
 core.prevalidateDiagnoses=async function(work,j){const value=await original.call(this,work,j);if(work===f.workId){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringDiagnosis:true}),p.id);}return value;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.planVersion,null);assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/changed/i);assert.equal(c.store.one('SELECT count(*) n FROM finding_dispositions d JOIN finding_occurrences o ON o.id=d.occurrence WHERE o.work=?',f.workId).n,0);}
 finally{core.prevalidateDiagnoses=original;}
});

test('claim received during prefix validation enters fresh suffix without altering old input scope',{timeout:30000},async t=>{
 const f=await world(t,'challenger'),core=c.changeCore,original=core.historicalPlanningProducer,p=f.originals.find(l=>l.role==='planner'),savedScope=JSON.parse(p.data).inputScope;let reads=0,injected=false;
 const claimId=randomUUID(),claim={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Independent retained concern arriving before new suffix assembly',evidence:['base:consumer.cjs']};
 core.historicalPlanningProducer=async function(work,outputId){const value=await original.call(this,work,outputId);if(work===f.workId&&value.launch.id===p.id&&++reads===1){injected=true;const failed=f.originals.find(l=>l.role==='challenger'),output=f.outputs.find(o=>o.launch===failed.id);c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',claimId,output.id,1,work,JSON.stringify({finding:claim,launchId:failed.id,role:'challenger'}));c.store.run('INSERT INTO obligations VALUES(?,?,?)',claimId,work,JSON.stringify({kind:'finding',occurrence:claimId,state:'pending'}));}return value;};
 f.setObserver(({body})=>{assert.ok(body.context.pendingObligations.some(o=>o.id===claimId));assert.ok(!body.context.plannerInputScope.occurrenceIds.includes(claimId));});
 try{await f.resume();assert.equal(injected,true);assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['challenger','adjudicator']);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM role_launches WHERE id=?',p.id).data).inputScope,savedScope);}
 finally{core.historicalPlanningProducer=original;}
});

for(const dependency of ['plannerOutput','plannerInputScope'])test('challenge with changed exact dependency reruns C while retaining P: '+dependency,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),ch=f.originals.find(l=>l.role==='challenger'),data=JSON.parse(ch.data);data[dependency]={changed:true};c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),ch.id);
 const after=await f.resume();assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['challenger','adjudicator'],JSON.stringify(after.blocked));assert.equal(after.execution.consumed-f.charges,2);
});

test('original prefix drift during fresh suffix bundle await refuses before reservation',{timeout:30000},async t=>{
 const f=await world(t,'challenger'),core=c.changeCore,original=core.bundle,p=f.originals.find(l=>l.role==='planner');let injected=false;
 core.bundle=async function(work,context,...rest){const value=await original.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-challenge'){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringBundle:true}),p.id);}return value;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.execution.consumed,f.charges);assert.equal(after.phase,'BLOCKED');assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);}
 finally{core.bundle=original;}
});

test('original prefix drift while fresh J runs retains output without adopting',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),p=f.originals.find(l=>l.role==='planner');
 f.setObserver(input=>{acceptWithRetainedDuties(input);if(input.role==='adjudicator')c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringJudgment:true}),p.id);});
 const after=await f.resume();assert.equal(after.planVersion,null);assert.equal(after.phase,'BLOCKED');assert.equal(after.execution.consumed-f.charges,1);assert.match(after.blocked.join(),/changed/i);
 const fresh=f.launches().at(-1);assert.equal(fresh.role,'adjudicator');assert.equal(fresh.status,'COMPLETE');assert.equal(c.store.one('SELECT status FROM role_outputs WHERE launch=?',fresh.id).status,'usable');
});


test('cancellation during retained evidence read admits no replacement producer',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.historicalPlanningProducer,abort=new AbortController();let interrupted=false;
 core.historicalPlanningProducer=async function(work,output){const value=await original.call(this,work,output);if(work===f.workId){interrupted=true;abort.abort(Error('Controlled owner cancellation'));}return value;};
 try{const after=await f.resume(abort.signal);assert.equal(interrupted,true);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);}
 finally{core.historicalPlanningProducer=original;}
});

test('planning J keeps canonical latest and actual obligation state inline while full exact history leaves the eager view',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,occurrence=c.inspectChange(f.workId).occurrences.find(o=>o.data.finding.requirementId==='R1');assert.ok(occurrence);
 const old=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),producer=f.originals.find(l=>l.role==='adjudicator');let latestId;
 for(let i=0;i<100;i++){latestId=randomUUID();c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',latestId,occurrence.id,producer.id,'upheld',JSON.stringify({occurrenceId:occurrence.id,disposition:'upheld',reason:'Original historical independent BASE assessment '+i,witnesses:['base:consumer.cjs']}));}
 for(let i=0;i<100;i++)c.store.run('INSERT INTO obligations VALUES(?,?,?)','past-diagnostic-'+f.workId+'-'+i,f.workId,JSON.stringify({kind:'diagnostic',state:'resolved',issues:['Original resolved history '+i]}));
 const oldObligations=c.store.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',f.workId);
 const before=c.store.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences o ON o.id=d.occurrence WHERE o.work=? ORDER BY d.rowid',f.workId),inspect=core.inspect;
 core.inspect=function(...args){const view=inspect.apply(this,args);return {...view,dispositions:[...view.dispositions].reverse()};};
 let observed;f.setObserver(event=>{if(event.role!=='adjudicator')return;const body=event.body,manifest=body.context.dispositionHistory;observed=structuredClone(body.context);
  assert.equal(body.context.dispositions.filter(d=>d.occurrence===occurrence.id).length,1);assert.equal(body.context.dispositions.find(d=>d.occurrence===occurrence.id).id,latestId);
  assert.equal(manifest.records,before.length);assert.equal(manifest.workId,f.workId);assert.equal(manifest.stage,'planning-adjudication');const bytes=readFileSync(manifest.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.deepEqual(body.context.occurrences.map(o=>o.id),c.inspectChange(f.workId).occurrences.map(o=>o.id));const pending=new Set(core.pending(f.workId).map(o=>o.id));for(const row of body.context.obligationStates)assert.equal(row.currentPending,pending.has(row.id));assert.ok(body.context.obligationStates.every(o=>!o.id.startsWith('past-diagnostic-')));for(const id of pending)assert.ok(body.context.obligationStates.some(o=>o.id===id));
  assert.ok(JSON.stringify(body.context.dispositions).length<JSON.stringify(before).length/4);acceptWithRetainedDuties(event);
 });
 try{const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(observed);const judgment=f.launches().at(-1);assert.deepEqual(JSON.parse(judgment.data).dispositionHistory,observed.dispositionHistory);for(const row of before)assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',row.id),row);assert.equal(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',occurrence.id).length,old.length+101);for(const row of oldObligations.filter(o=>o.id.startsWith('past-diagnostic-')))assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?',row.id),row);}
 finally{core.inspect=inspect;}
});

test('oversized chronological evidence refuses before another role reservation or provider call without clipping records',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),occurrence=f.first.occurrences[0],producer=f.originals.find(l=>l.role==='adjudicator');assert.ok(occurrence);
 for(let i=0;i<40;i++)c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',randomUUID(),occurrence.id,producer.id,'upheld',JSON.stringify({occurrenceId:occurrence.id,disposition:'upheld',reason:'x'.repeat(32000),witnesses:[]}));
 const rows=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),launchCount=f.launches().length,files=await fs.readdir(path.join(home,'artifacts'));
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/Disposition history exceeds.*1MiB/);assert.equal(f.launches().length,launchCount);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),rows);assert.deepEqual(await fs.readdir(path.join(home,'artifacts')),files);
});
test('cancellation during original evidence open cannot write snapshot content or dispatch a role',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),abort=new AbortController(),open=fs.open;let target;
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('/role-dispositions-')){target=String(file);abort.abort(Error('CONTROLLED_EVIDENCE_OPEN_CANCEL'));}return handle;};
 try{await f.resume(abort.signal);assert.ok(target);assert.equal((await fs.stat(target)).size,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');}
 finally{fs.open=open;}
});

test('cancellation while evidence close settles cannot allocate a role conversation afterward',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),abort=new AbortController(),open=fs.open,allocate=c.changeCore.h.allocateRole;let target,allocations=0;
 c.changeCore.h.allocateRole=function(...args){allocations++;return allocate.apply(this,args);};
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(!String(file).includes('/role-dispositions-'))return handle;target=String(file);return {writeFile:handle.writeFile.bind(handle),async close(){await handle.close();abort.abort(Error('CONTROLLED_EVIDENCE_CLOSE_CANCEL'));}};};
 try{await f.resume(abort.signal);assert.ok(target);assert.ok((await fs.stat(target)).size>0);assert.equal(allocations,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);}
 finally{fs.open=open;c.changeCore.h.allocateRole=allocate;}
});

const largeHistoricalPlan=({role,result})=>{if(role==='planner')result.plan.approach='Original independently challengeable plan alternative. '.repeat(100);};
test('historical metadata identities preserve literal wire exposure and refuse lost original capture',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),launch=f.originals.find(row=>row.role==='planner'),output=f.outputs.find(row=>row.launch===launch.id&&row.status==='usable'),core=c.changeCore;
 const original=await core.historicalPlanningProducer(f.workId,output.id);original.assertCurrent();
 assert.ok(JSON.parse(launch.data).metadataIdentityHash);assert.equal(original.witness.initialView.metadataIdentities.version,1);
 assert.equal(original.context.metadataIdentityEncoding,undefined);
 const native=JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?',launch.run).data),entries=(await fs.readFile(native.historyRef,'utf8')).trim().split('\n').map(JSON.parse),user=entries.find(row=>row.type==='message'&&row.message.role==='user'),text=user.message.content.find(part=>part.type==='text').text,wire=JSON.parse(text.split('\n')[1]);
 assert.equal(original.witness.initialView.textSha256,createHash('sha256').update(text).digest('hex'));
 assert.deepEqual(wire.context.metadataIdentityInput,{version:1});
 if(wire.context.metadataIdentityEncoding)assert.ok(wire.context.metadataIdentityEncoding.ids.every(id=>typeof id==='string'));
 for(const change of [data=>delete data.metadataIdentityInput,data=>data.metadataIdentityHash='0'.repeat(64)]){
  const data=JSON.parse(launch.data);change(data);c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);
  await assert.rejects(core.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);
  assert.throws(original.assertCurrent,/HISTORICAL_METADATA_IDENTITIES_CHANGED/);
  c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);
 }
 original.assertCurrent();
});

test('metadata field drift after capacity await refuses before any resumed provider call',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity;let current,injected=false;
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=result.bundle;return result;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){current.context.occurrences[0].output=randomUUID();injected=true;}return lease;};
 try{const result=await f.resume();assert.equal(injected,true);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/metadata identity capture changed/i);assert.equal(f.calls.filter(row=>row.mode==='resume').length,0);assert.equal(result.planVersion,null);}
 finally{core.bundle=bundle;core.h.acquireCapacity=acquire;}
});

test('historical identity values remain bound after a structurally valid dictionary and checkpoint change',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',({role,result})=>{if(role==='planner')result.findings=Array.from({length:12},(_,i)=>({requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original retained concern '+i,evidence:['base:consumer.cjs']}));});
 const launch=f.originals.find(row=>row.role==='challenger'),output=f.outputs.find(row=>row.launch===launch.id&&row.status==='usable'),run=c.store.one('SELECT * FROM runs WHERE id=?',launch.run),data=JSON.parse(run.data),bytes=await fs.readFile(data.historyRef),entries=bytes.toString().trim().split('\n').map(JSON.parse),user=entries.find(row=>row.type==='message'&&row.message.role==='user'),text=user.message.content.find(part=>part.type==='text'),lines=text.text.split('\n'),body=JSON.parse(lines[1]);
 assert.ok(body.context.metadataIdentityEncoding);const ref=body.context.occurrences[0].output.ref;assert.ok(Number.isSafeInteger(ref));
 body.context.metadataIdentityEncoding.ids[ref]=randomUUID();lines[1]=JSON.stringify(body);text.text=lines.join('\n');
 try{
  await fs.writeFile(data.historyRef,entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  const {nativeCheckpoint}=await import('../../dist/controller/history.js'),checkpoint=await nativeCheckpoint(data.historyRef);
  c.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...data,nativeCheckpoint:checkpoint}),run.id);
  await assert.rejects(c.changeCore.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);
 }finally{await fs.writeFile(data.historyRef,bytes);c.store.run('UPDATE runs SET data=? WHERE id=?',run.data,run.id);}
 const restored=await c.changeCore.historicalPlanningProducer(f.workId,output.id);restored.assertCurrent();
});

test('controller reopen resolves original criteria delivery without rewriting initial exposure or usage',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),producer=f.originals.find(row=>row.role==='planner'),output=f.outputs.find(row=>row.launch===producer.id&&row.status==='usable');
 assert.ok(output,JSON.stringify(f.first.blocked));
 const before=c.inspectChange(f.workId),versions=c.store.all('SELECT * FROM change_versions WHERE work=? ORDER BY rowid',f.workId),raw=output.raw;
 await c.close();c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
 const origin=await c.changeCore.historicalPlanningProducer(f.workId,output.id);origin.assertCurrent();
 assert.ok(origin.criteriaDefinitions);assert.notEqual(origin.input.contracts,origin.criteriaDefinitions.current.text);
 assert.equal(origin.witness.initialView.workflowCriteria.profile,'planning-v3');
 assert.ok(origin.witness.initialView.workflowCriteria.readBoundRecordIds.includes('current:DESIGN.md:D7'));
 assert.deepEqual(c.inspectChange(f.workId).execution,before.execution);
 assert.deepEqual(c.inspectChange(f.workId).resolution,before.resolution);
 assert.deepEqual(c.store.all('SELECT * FROM change_versions WHERE work=? ORDER BY rowid',f.workId),versions);
 assert.equal(c.store.one('SELECT raw FROM role_outputs WHERE id=?',output.id).raw,raw);
});

for(const boundary of ['open','close','later-guard'])test('historical criteria read preserves the original settled Native history across '+boundary,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),producer=f.originals.find(row=>row.role==='planner'),output=f.outputs.find(row=>row.launch===producer.id&&row.status==='usable');
 const history=JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?',producer.run).data).historyRef,originalBytes=await fs.readFile(history),open=fs.open;let injected=false;
 const mutate=async()=>{await fs.appendFile(history,'\n');injected=true;};
 try{
  if(boundary==='later-guard'){
   const original=await c.changeCore.historicalPlanningProducer(f.workId,output.id);
   assert.ok(original.criteriaDefinitions);assert.notEqual(original.input.contracts,original.criteriaDefinitions.current.text);
   assert.ok(original.witness.initialView.workflowCriteria.readBoundRecordIds.includes('current:DESIGN.md:D7'));
   await mutate();assert.throws(original.assertCurrent,/HISTORICAL_NATIVE_SOURCE_CHANGED/);
  }else{
   fs.open=async function(file,...args){
    const handle=await open.call(this,file,...args);
    if(String(file).includes('/role-criteria-')&&!injected){
     if(boundary==='open')await mutate();
     else{const close=handle.close.bind(handle);handle.close=async()=>{await close();await mutate();};}
    }
    return handle;
   };
   await assert.rejects(c.changeCore.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_NATIVE_SOURCE_CHANGED/);
  }
  assert.equal(injected,true);
 }finally{fs.open=open;await fs.writeFile(history,originalBytes);}
});

test('planning recovery publishes its original exact plan body while retaining current proposal and every pending claim',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan),originalRows=f.outputs;let observed;
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  const context=event.body.context,historical=context.historicalPlanningOperands;observed=structuredClone(context);
  assert.ok(historical.planBodyEncoding);assert.equal(historical.planBodyEncoding.version,4);
  const manifest=historical.planBodyEncoding.manifest;assert.equal(manifest.workId,f.workId);assert.equal(manifest.epoch,f.first.epoch);
  const text=readFileSync(manifest.path,'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),manifest.sha256);
  assert.ok(context.planProposal.approach.startsWith('Original independently'),'Current proposal remains complete');
  const old=historical.plans[0];assert.equal(old.plan,undefined);assert.ok(old.inlinePlan);assert.deepEqual(old.inlinePlan.requirements,context.planProposal.requirements);assert.ok(old.readBoundFields.includes('/intent'));assert.equal(old.inlinePlan.intent,undefined);
  const full=JSON.parse(text.split('\n').slice(old.record.firstLine-1,old.record.lastLine).map(JSON.parse).map(x=>x.text).join(''));
  assert.equal(createHash('sha256').update(JSON.stringify(full.plan)).digest('hex'),old.planHash);assert.equal(full.plan.approach,context.planProposal.approach);
  assert.deepEqual(context.occurrences.map(x=>x.id),c.inspectChange(f.workId).occurrences.map(x=>x.id));
  acceptWithRetainedDuties(event);
 });
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(observed);
 const metadata=JSON.parse(f.launches().at(-1).data);assert.equal(metadata.inputEvidenceManifests.length,4);assert.ok(metadata.inputEvidenceManifests.some(m=>m.kind==='historical-producer-provenance'));assert.ok(metadata.inputEvidenceManifests.some(m=>m.kind==='historical-plans'));assert.ok(metadata.inputEvidenceManifests.some(m=>m.kind==='workflow-criteria'));assert.equal(metadata.historicalInputHash,createHash('sha256').update(JSON.stringify(observed.historicalPlanningOperands)).digest('hex'));
 for(const row of originalRows)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',row.id),row);
});

test('historical source drift after snapshot preparation cannot allocate a fresh role or supply changed evidence',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan),open=fs.open,old=f.originals.find(l=>l.role==='adjudicator'),allocate=c.changeCore.h.allocateRole;let injected=false,allocations=0;
 c.changeCore.h.allocateRole=function(...args){allocations++;return allocate.apply(this,args);};
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('/role-plans-')){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(old.data),changedAfterSnapshot:true}),old.id);}return handle;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.phase,'BLOCKED');assert.equal(allocations,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.match(after.blocked.join(),/historical producer records changed|HISTORICAL_CRITERIA_DELIVERY_CHANGED|HISTORICAL_METADATA_IDENTITIES_CHANGED/i);}
 finally{fs.open=open;c.changeCore.h.allocateRole=allocate;c.store.run('UPDATE role_launches SET data=? WHERE id=?',old.data,old.id);}
});

for(const boundary of ['snapshot-open','before-adoption'])test('planning4 retains governing duties without relying on a never-adopted census at '+boundary,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan),core=c.changeCore,open=fs.open,prevalidate=core.prevalidateDiagnoses;let injected=false;
 const originals=f.outputs;
 const inject=()=>{if(injected)return;injected=true;const old=c.store.one("SELECT * FROM change_versions WHERE work=? AND kind='contracts' LIMIT 1",f.workId);c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',randomUUID(),old.work,old.kind,old.predecessor,old.artifact,old.hash,old.data);};
 f.setObserver(event=>{if(event.role==='adjudicator'){const h=event.body.context.historicalPlanningOperands;assert.equal(h.planBodyEncoding.version,4);assert.ok(h.plans[0].inlinePlan.requirements.length);assert.equal(h.planBodyEncoding.neverAdoptedWork,undefined);}acceptWithRetainedDuties(event);});
 if(boundary==='snapshot-open')fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('/role-plans-'))inject();return handle;};
 else core.prevalidateDiagnoses=async function(...args){const result=await prevalidate.apply(this,args);inject();return result;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));for(const row of originals)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',row.id),row);}
 finally{fs.open=open;core.prevalidateDiagnoses=prevalidate;}
});

test('retained BASE carry requires the original received planning judgment, not divergent decoded metadata',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan);f.setObserver(acceptWithRetainedDuties);
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 const occurrence=c.store.one('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid LIMIT 1',f.workId);
 assert.equal(c.changeCore.carriedBaseline(f.workId,occurrence),after.baseVersion);
 const judge=f.launches().at(-1),output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id),received=JSON.parse(output.raw);
 const changed=structuredClone(received);changed.decisions.find(d=>d.occurrenceId===occurrence.id).implementation={kind:'none'};
 for(const raw of [JSON.stringify(changed),'{invalid',null]){
  c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',raw,output.id);
  assert.throws(()=>c.changeCore.carriedBaseline(f.workId,occurrence),/original.*planning.*output|received.*judgment/i);
  assert.throws(()=>c.changeCore.restoreAcceptedPlan(f.workId),/original.*planning.*output|received.*judgment/i);
  assert.equal(c.store.one('SELECT data FROM role_outputs WHERE id=?',output.id).data,output.data,'Checking cannot rewrite retained protocol metadata');
 }
 c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',output.raw,output.id);
 assert.equal(c.changeCore.carriedBaseline(f.workId,occurrence),after.baseVersion);
});


test('public planning v3 keeps tiny bodies literal with captured canonical identity and historical recovery',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');f.setObserver(acceptWithRetainedDuties);
 const result=await f.resume(undefined,{version:3});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 const launch=f.launches().at(-1),data=JSON.parse(launch.data);assert.deepEqual(data.findingBodyInput,{version:3});assert.match(data.findingBodyHash,/^[a-f0-9]{64}$/);
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id),historical=await c.changeCore.historicalPlanningProducer(f.workId,output.id);historical.assertCurrent();
 assert.deepEqual(historical.context.findingBodyInput,{version:3});assert.deepEqual(data.historicalRequirementsInput,{version:1});assert.match(data.historicalInputHash,/^[a-f0-9]{64}$/);assert.equal(historical.context.historicalPlanningOperands.requirementsEncoding,undefined);assert.deepEqual(data.latestDispositionInput,{version:1});assert.match(data.latestDispositionHash,/^[a-f0-9]{64}$/);assert.equal(historical.context.latestDispositionView,undefined);assert.deepEqual(historical.witness.initialView.latestDispositionExplanations,{version:1,delivery:'literal'});
 const entries=(await fs.readFile(data.historyRef,'utf8')).trim().split('\n').map(JSON.parse),text=entries.find(e=>e.type==='message'&&e.message.role==='user').message.content.find(p=>p.type==='text').text,wire=JSON.parse(text.split('\n')[1]);
 assert.equal(wire.context.findingBodyEncoding,undefined,'Net-negative sharing keeps literal input');
 assert.deepEqual(historical.context.occurrences.map(o=>o.id),result.occurrences.map(o=>o.id));
});

for(const bodyVersion of [3,5])for(const boundary of ['capacity-body','capacity-declaration','settled-hash','settled-declaration'])test('public planning v'+bodyVersion+' '+boundary+' drift refuses before adoption',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity,diagnose=core.prevalidateDiagnoses;
 const dispositions=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),versions=c.store.all("SELECT * FROM change_versions WHERE work=? AND kind IN ('plan','requirements') ORDER BY rowid",f.workId);let current,injected=false,record;
 f.setObserver(acceptWithRetainedDuties);
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=result.bundle;return result;};
 if(boundary.startsWith('capacity'))core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){assert.deepEqual(current.context.findingBodyInput,{version:bodyVersion});if(boundary==='capacity-body')current.context.occurrences[0].data.finding.description+=' mutated';else current.context.findingBodyInput={version:2};injected=true;}return lease;};
 else core.prevalidateDiagnoses=async function(work,judge){const result=await diagnose.call(this,work,judge);if(work===f.workId){await Promise.resolve();record=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);const data=JSON.parse(record.data);assert.equal(record.status,'COMPLETE');assert.deepEqual(data.findingBodyInput,{version:bodyVersion});c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,...(boundary==='settled-hash'?{findingBodyHash:'0'.repeat(64)}:{findingBodyInput:{version:2}})}),record.id);injected=true;}return result;};
 try{
  const result=await f.resume(undefined,{version:bodyVersion});assert.equal(injected,true);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/finding bodies changed|finding body declaration changed|presentation unavailable/i);
  assert.equal(result.planVersion,null);assert.equal(result.candidateVersion,null);assert.equal(result.execution.reserved,0);assert.equal(result.resolution.reserved,0);
  assert.equal(f.calls.filter(row=>row.mode==='resume').length,boundary.startsWith('capacity')?0:1);
  assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),dispositions);assert.deepEqual(c.store.all("SELECT * FROM change_versions WHERE work=? AND kind IN ('plan','requirements') ORDER BY rowid",f.workId),versions);
  const latest=f.launches().at(-1),raw=c.store.all('SELECT raw FROM role_outputs WHERE launch=?',latest.id);if(boundary.startsWith('settled'))assert.ok(raw.some(row=>row.raw.includes('Retain actual baseline defect')),'Original raw judgment remains retained');
 }finally{core.bundle=bundle;core.h.acquireCapacity=acquire;core.prevalidateDiagnoses=diagnose;if(record)c.store.run('UPDATE role_launches SET data=? WHERE id=?',record.data,record.id);}
});


test('public planning v3 pools distinct claim values and preserves literal canonical history',{timeout:30000},async t=>{
 const evidence='base:consumer.cjs exact retained evidence 한글🙂 '.repeat(100);
 const f=await world(t,'adjudicator',({role,result})=>{if(role==='planner')result.findings=[0,1,2].map(i=>({requirementId:'R1',severity:'blocking',repair:'substantive',description:'Distinct original BASE concern '+i,evidence:[evidence,evidence]}));});
 let observed;f.setObserver(event=>{if(event.role==='adjudicator'){observed=structuredClone(event.body.context);acceptWithRetainedDuties(event);}});
 const result=await f.resume(undefined,{version:3});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));assert.ok(observed.occurrences.slice(0,3).every(row=>row.data.finding.evidence[0]===evidence));
 const launch=f.launches().at(-1),data=JSON.parse(launch.data),entries=(await fs.readFile(data.historyRef,'utf8')).trim().split('\n').map(JSON.parse),text=entries.find(e=>e.type==='message'&&e.message.role==='user').message.content.find(p=>p.type==='text').text,wire=JSON.parse(text.split('\n')[1]);
 assert.equal(wire.context.findingBodyEncoding.version,3);assert.ok(wire.context.findingBodyEncoding.values.includes(evidence));
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id),historical=await c.changeCore.historicalPlanningProducer(f.workId,output.id);historical.assertCurrent();
 assert.equal(JSON.stringify(historical.context),JSON.stringify(observed));assert.deepEqual(historical.witness.initialView.findingBodySuppliedIds,observed.occurrences.map(row=>row.id));
});

async function explanationWorld(t){
 const f=await retainedWorld(t);
 for(const old of f.rows){const row=c.store.one('SELECT * FROM finding_dispositions WHERE id=?',old.id),data=JSON.parse(row.data);data.reason='Original full independent explanation 한글🙂 '.repeat(120);data.witnesses=['Original actual source witness '.repeat(120)];c.store.run('UPDATE finding_dispositions SET data=? WHERE id=?',JSON.stringify(data),row.id);}
 return f;
}
test('latest chronology source is captured before the first preparation await and remains fresh until effects',{timeout:30000},async t=>{
 const f=await explanationWorld(t),core=c.changeCore,row=c.store.one('SELECT * FROM finding_dispositions WHERE id=?',f.rows[0].id),context={stage:'planning-adjudication',latestDispositionInput:{version:1},dispositionHistoryInput:{version:1,id:randomUUID()}};
 const mutate=()=>c.store.run('UPDATE finding_dispositions SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),reason:'Changed during first await'}),row.id),restore=()=>c.store.run('UPDATE finding_dispositions SET data=? WHERE id=?',row.data,row.id);
 const before=f.runs();try{const pending=core.bundle(f.workId,context,'adjudicator');mutate();await assert.rejects(pending,/disposition history source changed/);}finally{restore();}
 const prepared=await core.bundle(f.workId,context,'adjudicator');assert.ok(prepared.bundle.context.latestDispositionView);prepared.assertCurrent();mutate();assert.throws(prepared.assertCurrent,/disposition history source changed/);restore();prepared.assertCurrent();assert.deepEqual(f.runs(),before);
});
test('latest explanation headers preserve full-row retention and truthful original partial exposure',{timeout:30000},async t=>{
 const f=await explanationWorld(t);let supplied;
 f.setObserver(event=>{if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);supplied=structuredClone(event.body.context);assert.ok(supplied.latestDispositionView);
  for(const choice of supplied.decisionReferences.retentionChoices){const row=c.store.one('SELECT * FROM finding_dispositions WHERE id=?',choice.dispositionId);assert.equal(choice.sha256,createHash('sha256').update(JSON.stringify(row)).digest('hex'));}
  event.result.retainedDispositions=supplied.decisionReferences.retentionChoices.map(x=>x.dispositionId);event.result.decisions=event.result.decisions.filter(x=>![f.target.id,f.member.id].includes(x.occurrenceId));
 });
 const result=await f.resume();assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 assert.ok(supplied.dispositions.every(row=>!Object.hasOwn(row.data,'reason')&&!Object.hasOwn(row.data,'witnesses')));
 const launch=f.launches().at(-1),data=JSON.parse(launch.data);assert.match(data.latestDispositionHash,/^[a-f0-9]{64}$/);assert.deepEqual(data.latestDispositionInput,{version:1});
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id),original=await c.changeCore.historicalPlanningProducer(f.workId,output.id);original.assertCurrent();assert.deepEqual(original.witness.initialView.latestDispositionExplanations,{version:1,delivery:'read-bound'});assert.deepEqual(original.context.dispositions,supplied.dispositions);
 const moved=data.dispositionHistory.path+'.held';await fs.rename(data.dispositionHistory.path,moved);try{const unavailable=await c.changeCore.historicalPlanningProducer(f.workId,output.id);assert.deepEqual(unavailable.context.dispositions,supplied.dispositions);assert.deepEqual(unavailable.witness.initialView.latestDispositionExplanations,{version:1,delivery:'read-bound'});}finally{await fs.rename(moved,data.dispositionHistory.path);}
 for(const row of c.inspectChange(f.workId).dispositions)assert.equal(typeof row.data.reason,'string','Stored evidence and public inspection retain full records');
});
for(const boundary of ['capacity-view','capacity-row','settled-hash','settled-view','settled-declaration'])test('latest explanation '+boundary+' drift refuses before planning effects',{timeout:30000},async t=>{
 const f=await explanationWorld(t),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity,diagnose=core.prevalidateDiagnoses,before=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');let current,injected=false,record;
 f.setObserver(acceptWithRetainedDuties);
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=result.bundle;return result;};
 if(boundary.startsWith('capacity'))core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){assert.ok(current.context.latestDispositionView);if(boundary==='capacity-view')current.context.latestDispositionView.indexLines.reverse();else current.context.dispositions[0].status='rejected-after-capture';injected=true;}return lease;};
 else core.prevalidateDiagnoses=async function(work,judge){const result=await diagnose.call(this,work,judge);if(work===f.workId){record=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);const data=JSON.parse(record.data);assert.equal(record.status,'COMPLETE');assert.ok(data.latestDispositionView);if(boundary==='settled-hash')data.latestDispositionHash='0'.repeat(64);else if(boundary==='settled-view')data.latestDispositionView.indexLines.reverse();else delete data.latestDispositionInput;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),record.id);injected=true;}return result;};
 try{const result=await f.resume();assert.equal(injected,true);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/latest disposition delivery/);assert.equal(result.planVersion,null);assert.equal(result.candidateVersion,null);assert.equal(result.execution.reserved,0);assert.equal(result.resolution.reserved,0);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),before);assert.equal(f.calls.filter(x=>x.mode==='resume').length,boundary.startsWith('capacity')?0:1);}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;core.prevalidateDiagnoses=diagnose;if(record)c.store.run('UPDATE role_launches SET data=? WHERE id=?',record.data,record.id);}
});

test('public accepted history shares exact old requirements and rejects lost or changed canonical capture',{timeout:30000},async t=>{
 const requirement='Consumer exports3. Preserve the exact consumer guarantee and original source. '.repeat(18);
 const f=await world(t,'adjudicator',({role,result})=>{if(role==='planner'){result.plan.requirements[0].text=requirement;result.plan.approach='Original independent approach A. '.repeat(100);result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Actual BASE exports2; first received concern',evidence:['base:consumer.cjs']}];}});let round=1,received;
 f.setObserver(event=>{
  if(event.role==='planner'){event.result.plan.requirements[0].text=requirement;event.result.plan.approach=('Independent approach '+round+'. ').repeat(120);}
  if(event.role==='challenger'&&round===2)event.result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Actual same BASE still exports2; separate received implementation concern',evidence:['base:consumer.cjs']}];
  if(event.role==='adjudicator'){acceptWithRetainedDuties(event);if(round===3)received=structuredClone(event.body.context);}
 });
 const first=await f.resume();assert.equal(first.phase,'PLAN_READY',JSON.stringify(first.blocked));round=2;const second=await c.planChange({workId:f.workId,model:f.model});assert.equal(second.phase,'PLAN_READY',JSON.stringify(second.blocked));round=3;const third=await c.planChange({workId:f.workId,model:f.model});assert.equal(third.phase,'PLAN_READY',JSON.stringify(third.blocked));
 const launch=f.launches().at(-1),data=JSON.parse(launch.data),entries=(await fs.readFile(data.historyRef,'utf8')).trim().split('\n').map(JSON.parse),text=entries.find(e=>e.type==='message'&&e.message.role==='user').message.content.find(p=>p.type==='text').text,wire=JSON.parse(text.split('\n')[1]);
 assert.deepEqual(data.historicalRequirementsInput,{version:1});assert.match(data.historicalInputHash,/^[a-f0-9]{64}$/);assert.ok(wire.context.historicalPlanningOperands.requirementsEncoding);assert.ok(wire.context.historicalPlanningOperands.requirementsEncoding.values.some(array=>array[0].text===requirement));assert.equal(wire.context.planProposal.verificationRequirements[0].text,requirement);assert.equal(wire.context.planProposal.requirements,undefined);
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id),core=c.changeCore,historical=await core.historicalPlanningProducer(f.workId,output.id);
 assert.equal(historical.context.historicalPlanningOperands.requirementsEncoding,undefined);assert.equal(createHash('sha256').update(JSON.stringify(historical.context.historicalPlanningOperands)).digest('hex'),data.historicalInputHash);assert.ok(historical.context.historicalPlanningOperands.plans.some(plan=>plan.inlinePlan?.requirements?.[0]?.text===requirement));
 for(const mutate of [d=>delete d.historicalRequirementsInput,d=>delete d.historicalInputHash,d=>d.historicalInputHash='0'.repeat(64)]){const changed=structuredClone(data);mutate(changed);c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),launch.id);try{await assert.rejects(core.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);}finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);}}
 historical.assertCurrent();
 const bundle=core.bundle,acquire=core.h.acquireCapacity;let current,injected=false;const before=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');round=4;
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=result.bundle;return result;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){const plan=current.context.historicalPlanningOperands.plans.find(p=>p.inlinePlan?.requirements?.length);assert.ok(plan);plan.inlinePlan.requirements[0].text+=' changed during capacity await';injected=true;}return lease;};
 try{const held=await c.planChange({workId:f.workId,model:f.model});assert.equal(injected,true);assert.equal(held.phase,'BLOCKED');assert.match(held.blocked.join(),/role input evidence changed/);assert.equal(held.planVersion,third.planVersion);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),before);assert.equal(held.execution.reserved,0);}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;}
});


test('historical requirement declaration is fenced even when initial sharing keeps literal fallback',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,diagnose=core.prevalidateDiagnoses,before=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');let record;
 f.setObserver(acceptWithRetainedDuties);core.prevalidateDiagnoses=async function(work,judge){const result=await diagnose.call(this,work,judge);if(work===f.workId){record=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);const data=JSON.parse(record.data);assert.equal(record.status,'COMPLETE');assert.deepEqual(data.historicalRequirementsInput,{version:1});delete data.historicalRequirementsInput;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),record.id);}return result;};
 try{const held=await f.resume();assert.ok(record);assert.equal(held.phase,'BLOCKED');assert.match(held.blocked.join(),/role input evidence declaration changed/);assert.equal(held.planVersion,null);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),before);assert.equal(held.execution.reserved,0);assert.equal(held.resolution.reserved,0);}finally{core.prevalidateDiagnoses=diagnose;if(record)c.store.run('UPDATE role_launches SET data=? WHERE id=?',record.data,record.id);}
});

for(const mutation of ['replace','remove','header','census','artifact'])test('historical provenance '+mutation+' drift before reservation cannot become a new baseline',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');
 if(mutation==='artifact'){
  // Distinct accepted proposals retain enough real producer records for this optional view.
  f.setObserver(acceptWithRetainedDuties);
  const accepted=await f.resume();assert.equal(accepted.phase,'PLAN_READY',JSON.stringify(accepted.blocked));
  let round=0;
  f.setObserver(event=>{
   if(event.role==='planner')event.result.plan.approach='Distinct historical proposal '+round;
   if(event.role==='planner'||event.role==='challenger')event.result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Distinct received BASE concern '+event.role+' '+round,evidence:['base:consumer.cjs']}];
   if(event.role==='adjudicator')acceptWithRetainedDuties(event);
  });
  for(round=0;round<3;round++){
   const result=await c.planChange({workId:f.workId,model:f.model});assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
  }
  f.calls.length=0;
 }
 const core=c.changeCore,bundle=core.bundle,allocate=core.h.allocateRole;let before=f.runs(),dispositions=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),injected=false,allocations=0;
 core.h.allocateRole=function(...args){allocations++;return allocate.apply(this,args);};
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication'){
  injected=true;
  // The artifact control permits fresh P/C, then measures absence of a new J allocation.
  if(mutation==='artifact'){before=f.runs();dispositions=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');allocations=0;f.calls.length=0;}
  const ctx=result.bundle.context;assert.equal(ctx.historicalProvenanceInput.version,2);assert.ok(ctx.historicalPlanningOperands.producers.length);
  if(mutation==='replace')ctx.historicalPlanningOperands={...structuredClone(ctx.historicalPlanningOperands),unknownReplacement:true};
  else if(mutation==='remove')delete ctx.historicalPlanningOperands;
  else if(mutation==='header')ctx.historicalPlanningOperands.producers[0].role='replacement-role';
  else if(mutation==='census')ctx.historicalPlanningOperands.censusEncoding={changed:true};
  else{const evidence=result.evidence.find(e=>e.manifest.kind==='historical-producer-provenance');assert.ok(evidence,'Actual original producer records must exercise the projected artifact');evidence.contents+='corrupt';}
 }return result;};
 try{const after=mutation==='artifact'?await c.planChange({workId:f.workId,model:f.model}):await f.resume();assert.equal(injected,true);assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/provenance/);assert.equal(allocations,0);assert.deepEqual(f.runs(),before);assert.equal(f.calls.filter(x=>x.mode==='resume').length,0);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),dispositions);}finally{core.bundle=bundle;core.h.allocateRole=allocate;}
});

for(const boundary of ['preparation-remove','capacity-remove','capacity-rebind'])test('prospective source-qualified carry '+boundary+' cannot replace its original receiver',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',()=>{},true),core=c.changeCore,role=core.role,bundle=core.bundle,acquire=core.h.acquireCapacity,historical=core.historicalPlanningOperands;let current,injected=false;
 core.role=function(options,assigned,context,...rest){return role.call(this,options,assigned,assigned==='adjudicator'&&context.stage==='planning-adjudication'?{...context,decisionCarryInput:{version:3}}:context,...rest)};
 core.bundle=async function(work,context,...rest){const value=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=value.bundle;return value;};
 if(boundary==='preparation-remove')core.historicalPlanningOperands=async function(work,context){const value=await historical.call(this,work,context);if(work===f.workId&&context.decisionCarryInput&&!injected){await Promise.resolve();delete context.decisionCarryInput;injected=true;}return value;};
 else core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){if(boundary==='capacity-remove')delete current.context.decisionCarryInput;else{current.context.decisionCarryInput={version:2};current.context.decisionCarry={version:2};}injected=true;}return lease;};
 try{
  const result=await f.resume();assert.equal(injected,true);assert.equal(result.planVersion,null);assert.equal(result.candidateVersion,f.first.candidateVersion);assert.match(result.blocked.join(),/carry.*declaration changed|carry original declaration changed/i);
  assert.deepEqual(f.calls.filter(call=>call.mode==='resume'),[],'The original receiver drift must stop before the controlled provider callback');
 }finally{core.role=role;core.bundle=bundle;core.h.acquireCapacity=acquire;core.historicalPlanningOperands=historical;}
});

test('normal public planning captures physical source scope and cold history refuses lost policy',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');f.setObserver(acceptWithRetainedDuties);
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 const launch=f.launches().at(-1),data=JSON.parse(launch.data);
 assert.deepEqual(data.sourceScopeInput,{version:2});
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",launch.id);
 const historical=await c.changeCore.historicalPlanningProducer(f.workId,output.id);historical.assertCurrent();
 assert.deepEqual(historical.context.sourceScopeInput,{version:2});
 const entries=(await fs.readFile(data.historyRef,'utf8')).trim().split('\n').map(JSON.parse);
 const text=entries.find(e=>e.type==='message'&&e.message.role==='user').message.content.find(p=>p.type==='text').text;
 const wire=JSON.parse(text.split('\n')[1]);
 assert.ok(wire.sources.length);assert.ok(wire.sources.every(s=>Number.isSafeInteger(s.assessedLineCount)));
 for(const row of wire.requiredScope){const s=wire.sources.find(s=>s.id===row.sourceId);assert.ok(row.endLine<=s.assessedLineCount);}
 for(const mutate of [d=>delete d.sourceScopeInput,d=>d.sourceScopeInput={version:1}]){
  const changed=structuredClone(data);mutate(changed);c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(changed),launch.id);
  try{await assert.rejects(c.changeCore.historicalPlanningProducer(f.workId,output.id),/source scope|HISTORICAL_INITIAL_INPUT_UNAVAILABLE/i);}finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);}
 }
 historical.assertCurrent();
});
for(const boundary of ['preparation-remove','capacity-remove','capacity-rebind'])test('physical source scope '+boundary+' cannot relabel a new producer',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity,historical=core.historicalPlanningOperands;
 let current,injected=false;
 core.bundle=async function(work,context,...rest){const value=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication')current=value.bundle;return value;};
 if(boundary==='preparation-remove')core.historicalPlanningOperands=async function(work,context){const value=await historical.call(this,work,context);if(work===f.workId&&context.stage==='planning-adjudication'&&!injected){delete context.sourceScopeInput;injected=true;}return value;};
 else core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){if(boundary==='capacity-remove')delete current.context.sourceScopeInput;else current.context.sourceScopeInput={version:1};injected=true;}return lease;};
 try{
  const result=await f.resume();assert.equal(injected,true);assert.equal(result.planVersion,null);assert.match(result.blocked.join(),/source scope/i);
  assert.deepEqual(f.calls.filter(call=>call.mode==='resume'),[]);
 }finally{core.bundle=bundle;core.h.acquireCapacity=acquire;core.historicalPlanningOperands=historical;}
});

for(const mutation of ['remove','unsupported'])test('physical source scope settled '+mutation+' cannot adopt completed output',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');f.setObserver(acceptWithRetainedDuties);
 const core=c.changeCore,diagnose=core.prevalidateDiagnoses;let record;
 core.prevalidateDiagnoses=async function(work,judge){const result=await diagnose.call(this,work,judge);if(work===f.workId){record=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);const d=JSON.parse(record.data);if(mutation==='remove')delete d.sourceScopeInput;else d.sourceScopeInput={version:1};c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(d),record.id);}return result;};
 try{
  const after=await f.resume();assert.ok(record);assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/source scope/i);
  assert.ok(c.store.one('SELECT raw FROM role_outputs WHERE launch=?',record.id).raw);
 }finally{core.prevalidateDiagnoses=diagnose;if(record)c.store.run('UPDATE role_launches SET data=? WHERE id=?',record.data,record.id);}
});

for(const boundary of ['bundle-declaration','capacity-declaration','settled-declaration','settled-footprint'])test('literal metadata4 '+boundary+' drift cannot adopt a planning judgment',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity,diagnose=core.prevalidateDiagnoses;let current,injected=false,record;
 const dispositions=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),versions=c.store.all("SELECT * FROM change_versions WHERE work=? AND kind IN ('plan','requirements') ORDER BY rowid",f.workId);
 f.setObserver(acceptWithRetainedDuties);
 core.bundle=async function(work,context,...rest){const result=await bundle.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-adjudication'){current=result.bundle;if(boundary==='bundle-declaration'){current.context.metadataIdentityInput={version:1};injected=true;}}return result;};
 if(boundary==='capacity-declaration')core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){assert.deepEqual(current.context.metadataIdentityInput,{version:4});current.context.metadataIdentityInput={version:1};injected=true;}return lease;};
 if(boundary.startsWith('settled'))core.prevalidateDiagnoses=async function(work,judge){const result=await diagnose.call(this,work,judge);if(work===f.workId){record=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);const data=JSON.parse(record.data);assert.equal(record.status,'COMPLETE');assert.deepEqual(data.metadataIdentityInput,{version:4});c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,...(boundary==='settled-declaration'?{metadataIdentityInput:{version:1}}:{metadataIdentityHash:'0'.repeat(64)} )}),record.id);injected=true;}return result;};
 try{
  const result=await f.resume();assert.equal(injected,true);assert.equal(result.phase,'BLOCKED');assert.equal(result.planVersion,null);assert.match(result.blocked.join(),/metadata identit|HISTORICAL_INITIAL_INPUT_UNAVAILABLE/i);
  assert.equal(f.calls.filter(x=>x.mode==='resume').length,boundary.startsWith('settled')?1:0);assert.equal(result.execution.reserved,0);assert.equal(result.resolution.reserved,0);
  assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),dispositions);assert.deepEqual(c.store.all("SELECT * FROM change_versions WHERE work=? AND kind IN ('plan','requirements') ORDER BY rowid",f.workId),versions);
 }finally{core.bundle=bundle;core.h.acquireCapacity=acquire;core.prevalidateDiagnoses=diagnose;if(record)c.store.run('UPDATE role_launches SET data=? WHERE id=?',record.data,record.id);}
});
test('explicit planning metadata declaration is detached before asynchronous model preparation',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,role=core.role,select=core.selectRoleModel,declaration={version:1};let armed=false,changed=false;
 f.setObserver(acceptWithRetainedDuties);
 core.role=function(options,kind,context,...rest){if(options.workId===f.workId&&kind==='adjudicator'&&context.stage==='planning-adjudication'){armed=true;context={...context,metadataIdentityInput:declaration};}return role.call(this,options,kind,context,...rest);};
 core.selectRoleModel=async function(options,kind,...rest){const result=await select.call(this,options,kind,...rest);if(armed&&kind==='adjudicator'&&!changed){declaration.version=4;changed=true;}return result;};
 try{const result=await f.resume();assert.equal(changed,true);assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));const judge=f.launches().at(-1),data=JSON.parse(judge.data);assert.deepEqual(data.metadataIdentityInput,{version:1});const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id),original=await core.historicalPlanningProducer(f.workId,output.id);original.assertCurrent();assert.deepEqual(original.context.metadataIdentityInput,{version:1});}
 finally{core.role=role;core.selectRoleModel=select;}
});

for(const stop of ['cancel','close'])test('governed '+stop+' joins a role with no default deadline after long elapsed time',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');
 const begun=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:4,resolutionLimit:4}),workId=begun.workId,model=scripted();
 const spent=c.inspectWork(workId).allowance.consumed;
 let ready,abortObserved=false;const started=new Promise(resolve=>{ready=resolve;});
 model.definition.streamSimple=(selected,context,options)=>{
  const stream=createAssistantMessageEventStream(),finish=()=>{abortObserved=true;const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'aborted',timestamp:Date.now()};stream.push({type:'done',reason:'aborted',message});stream.end(message);};
  if(options.signal.aborted)finish();else options.signal.addEventListener('abort',finish,{once:true});ready();return stream;
 };
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const pending=c.planChange({workId,model,signal:t.signal}).then(value=>({value}),error=>({error}));await started;await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(3600001);await new Promise(resolve=>setImmediate(resolve));assert.equal(abortObserved,false);
  const launch=c.store.one('SELECT * FROM role_launches WHERE work=?',workId),runId=launch.run;
  assert.deepEqual(JSON.parse(launch.data).bounds,{timeoutMs:null,maxProviderRequests:16});
  if(stop==='cancel')await c.cancelWork({workId,expectedEpoch:begun.epoch});else await c.close();
  const settled=await pending;if(stop==='close')assert.equal(settled.error?.code,'CONTROLLER_CLOSING');else assert.equal(settled.error,undefined);assert.equal(abortObserved,true);
  if(stop==='close')c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
  const owner=c.inspectWork(workId),run=c.store.one('SELECT * FROM runs WHERE id=?',runId),output=c.store.one('SELECT * FROM role_outputs WHERE launch=?',launch.id);
  if(stop==='cancel')assert.equal(owner.state,'CANCELLED');
  assert.equal(owner.allowance.consumed,spent+1);assert.equal(owner.allowance.reserved,0);assert.equal(run.phase,'SETTLED');assert.equal(JSON.parse(run.data).cleanup,'removed');
  assert.equal(output.status,'unusable');assert.equal(JSON.parse(output.data).terminal,'aborted');assert.ok(!JSON.parse(output.data).issues.some(issue=>issue.includes('Role deadline exceeded')));
  assert.equal(c.inspectChange(workId).planVersion,null);assert.ok(scopes.every(scope=>scope.closed));
 }finally{t.mock.timers.reset();}
});

// These controls reach real SDK output capture and the public planning consumer.
// Physical execution is controlled; no learned semantic judgment is claimed.
test('pending ordinary validity and equivalence need no invented witness prose',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',({role,result})=>{
  if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Independent BASE consumer observation',evidence:['base:consumer.cjs']}];
 });
 let decisions;
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);
  decisions=event.result.decisions;assert.equal(decisions.length,2);
  for(const d of decisions)d.witnesses=[];
  decisions[1].disposition='equivalent';decisions[1].equivalentTo=decisions[0].occurrenceId;
 });
 const result=await f.resume();assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 for(const d of decisions){
  const row=c.store.one('SELECT data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1',d.occurrenceId);
  assert.deepEqual(JSON.parse(row.data).witnesses,[]);
  assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',d.occurrenceId).data).state,'pending');
 }
 assert.equal(result.execution.consumed-f.charges,1);assert.equal(result.execution.reserved,0);
 // An unchanged old edge can inherit a later supported target closure. This
 // direct accounting control does not claim another independent provider run.
 const member=decisions[1].occurrenceId,old=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',member);
 c.store.tx(()=>c.changeCore.dispositions(f.workId,f.launches().at(-1).id,{decisions:[{occurrenceId:decisions[0].occurrenceId,disposition:'rejected',reason:'Controlled later current relevance judgment',witnesses:['base:consumer.cjs']}]}));
 assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',member),old);
 assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',member).data).state,'resolved');
});
for(const disposition of ['rejected','deferred','optional-upheld'])test('empty witnesses cannot obtain '+disposition+' closure',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',({role,result})=>{
  if(role==='planner')result.findings=[{requirementId:'R1',severity:disposition==='optional-upheld'?'optional':'blocking',repair:'substantive',description:'Controlled received concern',evidence:['base:consumer.cjs']}];
 });
 const before=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId);
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);
  const d=event.result.decisions[0];d.disposition=disposition==='optional-upheld'?'upheld':disposition;d.witnesses=[];delete d.implementation;if(disposition==='optional-upheld')d.implementation={kind:'none'};
 });
 const held=await f.resume();assert.equal(held.phase,'BLOCKED');assert.equal(held.planVersion,null);assert.match(held.blocked.join(),/Disposition needs retained reason\/witness/);
 assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId),before);
 const judge=f.launches().at(-1);assert.equal(judge.status,'UNUSABLE');assert.equal(held.execution.reserved,0);
 const output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable'",judge.id);assert.ok(output);
 assert.deepEqual(JSON.parse(output.raw).decisions[0].witnesses,[],'Earlier refusal preserves the original invalid judgment');
 assert.ok(JSON.parse(output.data).issues.some(issue=>issue.startsWith('DECISION_EVIDENCE:')));
});
for(const reverse of [false,true])for(const witnesses of [[],['base:consumer.cjs']])test('fresh resolved equivalence checks final graph '+JSON.stringify({reverse,witnesses}),{timeout:30000},async t=>{
 const f=await retainedWorld(t),before=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId);
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);
  event.result.decisions=[
   {occurrenceId:f.target.id,disposition:'rejected',reason:'Controlled current target rejection',witnesses:['base:consumer.cjs']},
   {occurrenceId:f.member.id,disposition:'equivalent',equivalentTo:f.target.id,reason:'Controlled same current condition',witnesses,implementation:{kind:'none'}}
  ];if(reverse)event.result.decisions.reverse();
 });
 const result=await f.resume();
 if(witnesses.length){assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));for(const id of [f.target.id,f.member.id])assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',id).data).state,'resolved');}
 else{assert.equal(result.phase,'BLOCKED');assert.equal(result.planVersion,null);assert.match(result.blocked.join(),/Resolved equivalence needs retained witness/);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId),before);}
 assert.equal(result.execution.reserved,0);
});

for(const witnesses of [[],['base:consumer.cjs']])test('transitive fresh equivalence cannot bypass closure evidence '+JSON.stringify(witnesses),{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',({role,result})=>{
  if(role==='planner')result.findings=[1,2].map(n=>({requirementId:'R1',severity:'blocking',repair:'substantive',description:'Independent original concern '+n,evidence:['base:consumer.cjs']}));
 });
 const before=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId);
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);const ids=event.body.context.occurrences.map(o=>o.id);assert.equal(ids.length,3);
  event.result.decisions=[
   {occurrenceId:ids[2],disposition:'equivalent',equivalentTo:ids[1],reason:'Same current condition through explicit middle member',witnesses,implementation:{kind:'none'}},
   {occurrenceId:ids[1],disposition:'equivalent',equivalentTo:ids[0],reason:'Same current condition as final target',witnesses:['base:consumer.cjs'],implementation:{kind:'none'}},
   {occurrenceId:ids[0],disposition:'rejected',reason:'Controlled current relevance judgment',witnesses:['base:consumer.cjs']}
  ];
 });
 const result=await f.resume();
 if(witnesses.length)assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 else{assert.equal(result.phase,'BLOCKED');assert.equal(result.planVersion,null);assert.match(result.blocked.join(),/Resolved equivalence needs retained witness/);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?) ORDER BY rowid',f.workId),before);}
});

function incompleteConsumerProposal({role,result}){
 if(role==='planner'){
  // A literal explicit empty declaration survives grammar5. Avoid the fixture's
  // exact-command auto case producer; no command executes in this planning lane.
  result.plan.verification.checks[0].command='node ./check.cjs';
  result.plan.verification.checks[0].cases=[];
 }
}
for (const rejectedAt of ['proposal', 'adoption']) test('managed planning catches a standalone Node command without a program at ' + rejectedAt, {timeout:30000}, async t => {
 t.after(() => { if (t.passed === false) failures++; });
 const {workId} = await c.beginChange({projectId:'P',request:'Export 3 using an executable managed verification command'});
 const issue = /Check "value" has no Node program.*runner supplies no standard input/;
 const inline = "node - <<'CHECK'\nconsole.log(JSON.stringify({version:1,assertions:[],cases:[]}));\nCHECK";
 const names = [];
 const model = scripted(undefined, ({role,body,result}) => {
  names.push(role);
  if (role === 'planner' && rejectedAt === 'proposal') {
   const check = result.plan.verification.checks[0];
   check.command = 'node -';
   check.cases = ['healthy','adverse'].map((kind,index) => ({
    id: 'node-' + kind, kind, guaranteeIds: ['R1'], consumerPaths: ['consumer.cjs'],
    derivation: 'Exercise the numeric consumer', input: {literalUtf8:String(index+3),fixturePaths:[]},
    expected: {kind:index?'rejection':'return',value:'3'},
   }));
  }
  if (role === 'challenger' || role === 'adjudicator') {
   if (rejectedAt === 'proposal') {
    assert.match(body.context.currentProposalDiagnostics.issue, issue);
    assert.equal(body.context.proposalApproval, undefined);
   } else assert.equal(body.context.currentProposalDiagnostics, undefined);
  }
  if (role === 'adjudicator') {
   result.acceptedPlan = structuredClone(body.context.planProposal);
   result.acceptedPlan.verification.checks[0].command = rejectedAt === 'proposal' ? inline : 'node';
  }
 });
 const result = await c.planChange({workId,model});
 assert.deepEqual(names, ['planner','challenger','adjudicator']);
 if (rejectedAt === 'proposal') {
  assert.equal(result.phase, 'PLAN_READY', JSON.stringify(result.blocked));
  assert.equal(c.changeCore.version(result.verificationVersion).data.verification.checks[0].command, inline);
 } else {
  assert.equal(result.phase, 'BLOCKED');
  assert.match(result.blocked.join(' '), issue);
  assert.equal(result.verificationVersion, null);
 }
 assert.equal(result.candidateVersion, null);
 assert.equal(result.checks.length, 0);
 assert.equal(result.execution.reserved, 0);
});
for(const conflictAt of ['proposal','adoption'])for(const input of ['check','review','entry'])
test('a planned '+input+' input outside manifest scope is reported before editing at '+conflictAt,{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:input==='review'?'Export 3 and restrict writes to the consumer and required test paths':'Export 3 and change only consumer.cjs'});
 const seen=[],script='test/group-records.test.cjs';
 const issue=input==='review'?/Required review source "test\/group-records\.test\.cjs" requires a directory "test".*manifest scope "scope"/:/Candidate check "value" requires a regular file "future-checker\.cjs".*manifest scope "scope"/;
 const createConflict=plan=>{
  if(input==='check')plan.verification.checks[0].expectationPaths=['future-checker.cjs'];
  else if(input==='entry'){
   const check=plan.verification.checks[0];
   check.command='node future-checker.cjs';
   check.expectationPaths=[];
   check.cases ??= ['healthy','adverse'].map((kind,index)=>({
    id:'entry-'+kind,kind,guaranteeIds:['R1'],consumerPaths:['consumer.cjs'],derivation:'Exercise the numeric consumer',
    input:{literalUtf8:String(index+3),fixturePaths:[]},
    expected:{kind:index?'rejection':'return',value:'3'},
   }));
  }
  else plan.verification.reviewRoles[0].requiredPaths.push(script);
 };
 const model=scripted(undefined,({role,body,result})=>{
  seen.push(role);
  if(role==='planner'){
   result.plan.requirements.push({id:'scope',text:'Change only consumer.cjs',source:body.context.ownerSource});
   result.plan.verification.strategies=[
    {requirementId:'R1',kind:'consumer-cases',checkIds:['value']},
    {requirementId:'scope',kind:'manifest-scope-duty',allowedChangePaths:input==='review'?['consumer.cjs',script]:['consumer.cjs'],unchangedPaths:['check.cjs'],reviewKey:'general'},
   ];
   if(conflictAt==='proposal')createConflict(result.plan);
  }
  if(role==='challenger'||role==='adjudicator'){
   if(conflictAt==='proposal'){
    assert.match(body.context.currentProposalDiagnostics.issue,issue);
    assert.equal(body.context.proposalApproval,undefined);
   }else assert.equal(body.context.currentProposalDiagnostics,undefined);
  }
  if(role==='adjudicator'){
   result.acceptedPlan=structuredClone(body.context.planProposal);
   if(conflictAt==='adoption')createConflict(result.acceptedPlan);
   else if(input==='check')result.acceptedPlan.verification.checks[0].expectationPaths=['check.cjs'];
   else if(input==='entry')result.acceptedPlan.verification.checks[0].command='node ./check.cjs';
   else result.acceptedPlan.verification.strategies.find(strategy=>strategy.requirementId==='scope').allowedChangePaths.push('test');
   if(conflictAt==='proposal'&&input==='check'){
    const core=c.changeCore,baseId=core.row(workId).base,version=core.version;
    for(const [patch,error] of [
     [{work:'foreign-work'},/Original BASE version does not belong/],
     [{kind:'candidate'},/Original BASE version does not belong/],
     [{data:{}},/Complete supported manifest unavailable/],
     [{hash:'0'.repeat(64)},/Complete manifest digest changed/],
    ]){
     core.version=function(id){const value=version.call(this,id);return id===baseId?{...value,...patch}:value;};
     try{assert.throws(()=>core.planningValid(result.acceptedPlan,workId,body.context.planningVerificationProfile),error);}
     finally{core.version=version;}
    }
   }
  }
 });
 const result=await c.planChange({workId,model});
 assert.deepEqual(seen,['planner','challenger','adjudicator']);
 if(conflictAt==='proposal'){
  assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
  const selected=c.changeCore.version(result.verificationVersion).data.verification;
  if(input==='check')assert.equal(selected.checks[0].expectationPaths[0],'check.cjs');
  else if(input==='entry')assert.equal(selected.checks[0].command,'node ./check.cjs');
  else assert.ok(selected.strategies.find(strategy=>strategy.requirementId==='scope').allowedChangePaths.includes('test'));
 }else{
  assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(' '),issue);
  assert.equal(result.planVersion,null);assert.equal(result.verificationVersion,null);
 }
 assert.equal(result.candidateVersion,null);assert.equal(result.checks.length,0);assert.equal(result.execution.reserved,0);
});
test('usable incomplete proposal supplies exact host facts to independent C/J and original inspection',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',incompleteConsumerProposal),planner=f.originals.find(l=>l.role==='planner'),output=f.outputs.find(o=>o.launch===planner.id);
 assert.equal(planner.status,'COMPLETE');assert.equal(output.status,'usable');
 const observations=f.calls.filter(call=>['challenger','adjudicator'].includes(call.role)).map(call=>call.body.context.currentProposalDiagnostics);
 assert.equal(observations.length,2);assert.deepEqual(observations[0],observations[1]);
 const facts=observations[0];assert.ok(facts);assert.equal(facts.kind,'current-proposal-validation');assert.equal(facts.outputId,output.id);assert.equal(facts.launchId,planner.id);assert.equal(facts.workId,f.workId);
 assert.equal(facts.proposalHash,createHash('sha256').update(JSON.stringify(JSON.parse(output.data).protocol.plan)).digest('hex'));
 assert.match(facts.issue,/lacks healthy actual consumer case/);assert.match(facts.interpretation,/No semantic verdict/);assert.equal(facts.omittedMessageCharacters,0);assert.ok(Buffer.byteLength(JSON.stringify(facts))<=4096);
 assert.deepEqual(facts.referenceDiagnostics.problems.filter(row=>row.kind.startsWith('consumer-case-')).map(row=>row.kind),['consumer-case-healthy-missing','consumer-case-adverse-missing']);
 for(const call of f.calls.filter(call=>call.role!=='planner')){assert.equal(call.body.context.proposalApproval,undefined);assert.equal(call.body.context.currentPlanningDiagnostics,undefined);}
 f.setObserver(({role,body})=>{assert.equal(role,'adjudicator');assert.deepEqual(body.context.currentProposalDiagnostics,facts);});
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.execution.consumed-f.charges,1,'Original successful P/C reused; only fresh J charged');
 assert.match(after.blocked.join(),/original proposal validation at handoff:.*lacks healthy actual consumer case/);
 for(const original of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',original.id),original);
});
for(const boundary of ['body','capture','planner-source'])test('current proposal '+boundary+' drift refuses before independent dispatch',{timeout:30000},async t=>{
 const f=await world(t,'challenger',incompleteConsumerProposal),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity;
 const original=f.outputs.find(o=>o.launch===f.originals.find(l=>l.role==='planner').id);let current,injected=false;
 core.bundle=async function(...args){const value=await bundle.apply(this,args);if(value.bundle.context.currentProposalDiagnostics)current=value.bundle;return value;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){injected=true;
  if(boundary==='body')current.context.currentProposalDiagnostics.issue='Invented clear verdict';
  else if(boundary==='planner-source')c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',original.raw+' ',original.id);
  else{const row=c.store.one('SELECT id,data FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1',f.workId),data=JSON.parse(row.data);data.currentProposalDiagnostics.issue='Invented clear verdict';c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);}
 }return lease;};
 let after;try{after=await f.resume();}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;if(boundary==='planner-source')c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',original.raw,original.id);}
 assert.equal(injected,true,JSON.stringify(after.blocked));assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
 assert.match(after.blocked.join(),boundary==='planner-source'?/Selected planner record changed|prefix original producer records/:/planning feedback changed/);
 assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);
});

test('independent full correction can adopt a valid plan without replacing the incomplete original proposal',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:8,resolutionLimit:8});let challenged=false,judged=false;
 const model=scripted(undefined,event=>{
  const {role,body,result}=event;incompleteConsumerProposal(event);
  if(role==='challenger'){challenged=true;assert.match(body.context.currentProposalDiagnostics.issue,/lacks healthy/);}
  if(role==='adjudicator'){
   judged=true;assert.match(body.context.currentProposalDiagnostics.issue,/lacks healthy/);assert.equal(body.context.proposalApproval,undefined);
   result.planAccepted=true;result.acceptedPlan=structuredClone(body.context.planProposal);
   result.acceptedPlan.verification.checks[0].cases=[
    {id:'value-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Actual numeric value3 claim must match the selected consumer',consumerPaths:['consumer.cjs'],input:{literalUtf8:'3',fixturePaths:[]},expected:{kind:'return',value:'3'}},
    {id:'value-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Contradictory numeric value4 claim must be rejected by the selected consumer',consumerPaths:['consumer.cjs'],input:{literalUtf8:'4',fixturePaths:[]},expected:{kind:'rejection',value:'3'}},
   ];
  }
 });
 const after=await c.planChange({workId,model});assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(challenged&&judged);assert.equal(after.candidateVersion,null);assert.equal(after.reviewReady,false,'Planning alone is not verified implementation');
 const original=c.store.one("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='planner'",workId);
 assert.deepEqual(JSON.parse(original.data).protocol.plan.verification.checks[0].cases,[]);
 const accepted=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',after.planVersion).data).plan;
 assert.equal(accepted.verification.checks[0].cases.length,2);assert.equal(c.store.one("SELECT COUNT(*) n FROM role_launches WHERE work=? AND role='planner'",workId).n,1);
 assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
});

test('fresh verification domain preserves complete operating owner intent through original P/C/J and canonical adoption',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const request='Consumer exports3. Use node check.cjs within2000ms. Finish independent review and report in Korean. Do not apply or publish.';
 const {workId}=await c.beginChange({projectId:'P',request,executionLimit:8,resolutionLimit:8});const seen=[];
 const model=scripted(undefined,({role,body,wireBody})=>{if(!role)return;seen.push(role);assert.equal(body.context.ownerRequest,request);assert.ok(body.requirements.some(row=>row.text===request));assert.equal(body.context.planningVerificationProfile.version,12);assert.equal(wireBody.context.planningVerificationProfile.baseline.newObservationAllowed,true);assert.equal(wireBody.context.planningVerificationProfile.baseline.newObservation,undefined);if(role!=='planner'){assert.ok(body.context.planProposal.requirements,'Independent test decoding restores the canonical proposal');assert.ok(wireBody.context.planProposal.verificationRequirements);assert.equal(wireBody.context.planProposal.requirements,undefined);}
  if(role==='challenger'){
   assert.equal(wireBody.context.plannerPlanReference,1);
   assert.deepEqual(wireBody.context.plannerOutput.plan,{$ref:'context.planProposal'});
   assert.deepEqual(body.context.plannerOutput.plan,body.context.planProposal);
  }
 });
 const view=await c.planChange({workId,model});assert.equal(view.phase,'PLAN_READY',JSON.stringify(view.blocked));assert.deepEqual(seen,['planner','challenger','adjudicator']);
 const output=c.store.one("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='planner'",workId),raw=JSON.parse(output.raw),canonical=JSON.parse(output.data).protocol.plan;
 assert.ok(raw.plan.verificationRequirements);assert.equal(raw.plan.requirements,undefined);assert.deepEqual(raw.plan.verificationRequirements,canonical.requirements);
 assert.deepEqual(canonical.requirements.map(row=>row.id),['R1']);assert.equal(canonical.verification.checks[0].command,'node check.cjs');assert.equal(canonical.verification.checks[0].timeoutMs,2000);assert.ok(canonical.verification.reviewRoles.length);assert.ok(canonical.verification.strategies.every(row=>row.kind==='consumer-cases'),'No invented before-edit or report consumer duty');assert.equal(view.candidateVersion,null);assert.equal(view.reviewReady,false);
});
for(const boundary of ['body','capture'])test('precise proposal reference '+boundary+' drift refuses before replacement dispatch',{timeout:30000},async t=>{
 const f=await world(t,'challenger',({role,result})=>{if(role==='planner'){const check=result.plan.verification.checks[0];check.command='node ./check.cjs';check.cases=[{id:'invalid-ref',kind:'adverse',guaranteeIds:['unknown-requirement'],derivation:'Controlled reference error, not missing consumer evidence',consumerPaths:['consumer.cjs'],input:{literalUtf8:'3',fixturePaths:[]},expected:{kind:'return',value:'3'}}];}}),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity;let current,injected=false;
 core.bundle=async function(...args){const value=await bundle.apply(this,args);if(value.bundle.context.currentProposalDiagnostics?.referenceDiagnostics)current=value.bundle;return value;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){injected=true;if(boundary==='body')current.context.currentProposalDiagnostics.referenceDiagnostics.problems[0].reference.value='Forged replacement';else{const row=c.store.one('SELECT id,data FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1',f.workId),data=JSON.parse(row.data);data.currentProposalDiagnostics.referenceDiagnostics.problems[0].pointer='/forged';c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);}}return lease;};
 let after;try{after=await f.resume();}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;}
 assert.equal(injected,true,JSON.stringify(after.blocked));assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/planning feedback changed/);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);assert.equal(f.calls.filter(row=>row.mode==='resume').length,0);
});

for(const boundary of ['root','capability','plan','capture','coherent-downgrade'])test('profile7 planning domain '+boundary+' drift refuses before provider entry',{timeout:30000},async t=>{
 const f=await world(t,'challenger'),core=c.changeCore,bundle=core.bundle,acquire=core.h.acquireCapacity;let current,injected=false;
 core.bundle=async function(...args){const value=await bundle.apply(this,args);if(args[2]==='challenger'&&value.bundle.context.planningVerificationProfile?.version===12)current=value.bundle;return value;};
 core.h.acquireCapacity=async function(...args){const lease=await acquire.apply(this,args);if(current&&!injected){injected=true;
  if(boundary==='root')current.requirements[0].text+=' late substituted task';
  else if(boundary==='capability')current.context.planningVerificationProfile.baseline.priorDuty=!current.context.planningVerificationProfile.baseline.priorDuty;
  else if(boundary==='plan')current.context.planProposal.requirements[0].text+=' late altered verification claim';
  else{const row=c.store.one('SELECT id,data FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1',f.workId),data=JSON.parse(row.data);
   if(boundary==='capture')data.planningDomainHash='0'.repeat(64);
   else{current.context.planningVerificationProfile.version=6;data.planningVerificationProfile.version=6;delete data.planningDomainHash;delete data.planningRequirementsHash;}
   c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);
  }
 }return lease;};
 let after;try{after=await f.resume();}finally{core.bundle=bundle;core.h.acquireCapacity=acquire;}
 assert.equal(injected,true,JSON.stringify(after.blocked));assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/planning domain presentation changed|Selected planner record changed|prefix original/);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);
});
test('original challenge input refuses missing footprint or plan reference without rewriting original output',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),launch=f.originals.find(row=>row.role==='challenger'),output=f.outputs.find(row=>row.launch===launch.id),core=c.changeCore;
 const receipt=await core.historicalPlanningProducer(f.workId,output.id);assert.ok(receipt.context.planProposal.requirements);
 assert.deepEqual(receipt.context.plannerOutput.plan,receipt.context.planProposal);
 const original=c.store.one('SELECT data FROM role_launches WHERE id=?',launch.id).data;
 assert.equal(JSON.parse(original).plannerPlanReference,1);
 for(const key of ['planningDomainHash','planningRequirementsHash','plannerPlanReference']){const data=JSON.parse(original);delete data[key];c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);try{await assert.rejects(core.historicalPlanningProducer(f.workId,output.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);}finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',original,launch.id);}}
 receipt.assertCurrent();assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);
});

for(const clarification of [false,true])test('declined planning preserves independent ordinary judgments and leaves new J claims pending: clarification='+clarification,{timeout:30000},async t=>{
 const f=await world(t,'no-controlled-failure',({role,body,result})=>{
  if(role==='planner')result.findings=['first','second','unjudged'].map(label=>({requirementId:'operating-'+label,severity:'blocking',repair:'substantive',description:'Original '+label+' claim about consumer behavior',evidence:['base:consumer.cjs']}));
  if(role==='adjudicator'){
   assert.equal(body.context.occurrences.length,3);
   result.planAccepted=false;delete result.acceptedPlan;
   if(clarification)result.ownerDecisionRequired=['Choose the intended consumer behavior'];
   result.decisions=[{occurrenceId:body.context.occurrences[0].id,disposition:'rejected',reason:'Actual original source does not establish this allegation',witnesses:['base:consumer.cjs']},{occurrenceId:body.context.occurrences[1].id,disposition:'upheld',reason:'Independent concern remains pending implementation',witnesses:[]}];
   result.findings=[{requirementId:'operating-new-independent-claim',severity:'blocking',repair:'substantive',description:'New independent J claim requires a later producer',evidence:['base:consumer.cjs']}];
  }
 });
 const after=f.first,judgment=f.originals.find(l=>l.role==='adjudicator');assert.equal(judgment.status,'COMPLETE',JSON.stringify(after.blocked));
 assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.verificationVersion,null);assert.equal(after.candidateVersion,null);
 const selected=c.store.one('SELECT * FROM role_outputs WHERE launch=? AND status=?',judgment.id,'usable');
 let reply,deliveredReply=false;
 if(clarification){
  const current=c.inspectChangeResult(f.workId);
  assert.equal(current.planningClarification.outputId,selected.id);
  assert.deepEqual(current.planningClarification.questions,{entries:['Choose the intended consumer behavior'],total:1,omitted:0});
  assert.match(current.nextAction,/Bring the questions to the owner/);
  assert.match(changeResultText(current,'ko'),/사용자 판단 요청[\s\S]*Choose the intended consumer behavior/);
  c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',selected.raw+' ',selected.id);
  try{assert.equal(c.inspectChangeResult(f.workId).planningClarification,undefined);}
  finally{c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',selected.raw,selected.id);}
  const run=c.store.one('SELECT data FROM runs WHERE id=?',judgment.run);
  c.store.run("UPDATE runs SET data=json_set(data,'$.sourceInputHash',?) WHERE id=?",'changed original source binding',judgment.run);
  try{assert.equal(c.inspectChangeResult(f.workId).planningClarification,undefined);}
  finally{c.store.run('UPDATE runs SET data=? WHERE id=?',run.data,judgment.run);}
  const target=current.planningClarification.reply?.conversationId;
  assert.ok(target);assert.equal(c.inspectConversation(target).role,'adjudicator');
  const reader=c.createConversation({projectId:'P'}).conversationId;
  for(const [id,text]of [[reader,'Keep reader draft'],[target,'Keep role draft']])c.setDraft({conversationId:id,expectedRevision:c.inspectConversation(id).draft.revision,text});
  let focused=reader,notice,stale=true,staleAfter=false;
  const roleState=c.store.one('SELECT data FROM conversation_state WHERE conversation=?',target).data;
  const activate=async id=>{focused=id;if(staleAfter)c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?',id);};
  const host={controller:c,show:async(_title,_text,action)=>{await action?.run();},isCurrent:id=>id===focused,activate,input:async()=>assert.fail('Navigation only'),
   notice:text=>{notice=text;},execute:(...args)=>commands.execute(...args),choose:async(title,rows)=>{
    if(title.startsWith('Work recovery'))return rows.find(row=>row==='View result');
    const reply=rows.find(row=>row==='Open reply pane for planning questions');assert.ok(reply);
    if(stale)c.store.run("UPDATE conversation_state SET data=json_set(data,'$.runId','different') WHERE conversation=?",target);
    return reply;
   }};
  const commands=new HostCommands([...workCommands(host),...changeCommands({...host,controls:{draft:()=>'',input:host.input,
    launch:()=>assert.fail('Navigation only'),activateSource:activate,notice:host.notice}})]);
  try{await assert.rejects(commands.execute('/change result '+f.workId,reader),/Original result changed/);assert.equal(focused,reader);}
  finally{c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',roleState,target);}
  stale=false;
  staleAfter=true;
  try{await assert.rejects(commands.execute('/change result '+f.workId,reader),/Original result changed/);assert.equal(notice,undefined);}
  finally{c.store.run('UPDATE conversations SET generation=generation-1 WHERE id=?',target);focused=reader;staleAfter=false;}
  await commands.execute('/work '+f.workId,reader);assert.equal(focused,target);
  assert.match(notice,/Keep feedback and inspect original task/);
  assert.equal(c.inspectConversation(reader).draft.text,'Keep reader draft');assert.equal(c.inspectConversation(target).draft.text,'Keep role draft');
  const answer='원래 동작은 그대로. Use the literal value 3.';
  reply=await c.queueConversationInputWithContext({conversationId:target,expectedGeneration:c.inspectConversation(target).generation,text:answer,mode:'idle'});
  const input=c.inspectConversationInputs(target).find(item=>item.inputId===reply.inputId);
  assert.equal(input.withdrawEligible,true);assert.equal(input.retryEligible,false);
  c.recoverConversationInput({conversationId:target,inputId:reply.inputId,expectedContext:input.fingerprint,action:'withdraw'});
  assert.equal(c.inspectChangeResult(f.workId).planningClarification,undefined);
  assert.equal(c.store.one('SELECT raw FROM sources WHERE id=?',reply.sourceId).raw,answer);
  assert.deepEqual(c.inspectChange(f.workId).execution,after.execution);
 }else assert.equal(c.inspectChangeResult(f.workId).planningClarification,undefined);
 const original=f.calls.find(call=>call.role==='adjudicator').body.context.occurrences;
 const decisions=c.store.all('SELECT * FROM finding_dispositions WHERE launch=?',judgment.id);assert.equal(decisions.length,2,JSON.stringify(after.blocked));
 const obligation=id=>JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',id).data);
 assert.equal(obligation(original[0].id).state,'resolved');assert.equal(obligation(original[1].id).state,'pending');assert.equal(obligation(original[2].id).state,'pending');
 const own=after.occurrences.find(o=>o.data.launchId===judgment.id);assert.ok(own);assert.equal(obligation(own.id).state,'pending');assert.ok(!decisions.some(d=>d.occurrence===own.id));
 assert.equal(after.execution.consumed,4,'Original BASE capture and three role runs remain charged');assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
 f.setObserver(({role,body})=>{if(role==='adjudicator'){
  assert.ok(body.context.occurrences.some(o=>o.id===own.id));assert.ok(body.context.dispositions.some(d=>d.occurrence===original[0].id));
  if(reply){const input=body.context.sourceInputChain.find(item=>item.input_id===reply.inputId);assert.equal(input.source,reply.sourceId);
   assert.equal(input.sourceOrigin,'owner-conversation-input');assert.equal(input.text,'원래 동작은 그대로. Use the literal value 3.');assert.equal(input.data.effectHold,true);deliveredReply=true;}
 }});
 const resumed=await f.resume();assert.equal(resumed.phase,'BLOCKED');assert.equal(resumed.planVersion,null);
 assert.equal(deliveredReply,clarification);
 assert.equal(resumed.planningClarification,undefined);
 assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',selected.id),selected);
});

for(const archived of [false,true])test('coordinator waits for an owner planning answer with reply pane archived='+archived, {timeout:30000}, async t=>{
 t.after(()=>{if(t.passed===false)failures++;});
 const parent=c.createConversation({projectId:'P'}).conversationId,s=c.store;
 const request='Consumer exports3',answer='값 3을 선택합니다. Keep the existing consumer behavior.';
 let reply,delivered=false,stopped=false,assignment,original,publication;
 const model=scripted(context=>{
  const user=context.messages.findLastIndex(message=>message.role==='user');
  const replies=context.messages.slice(user+1).filter(message=>message.role==='toolResult');
  if(!assignment)return replies.length?{text:'Original task assigned.'}:{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:request}}};
  const operands={assignmentId:assignment.id,conversationId:assignment.target,projectId:'P',observedDirectionRevision:c.inspectConversation(assignment.target).directionRevision};
  if(!replies.length)return{tool:{name:'conversation_status',arguments:{conversationId:assignment.target}}};
  const record=JSON.parse(replies.at(-1).content.filter(part=>part.type==='text').map(part=>part.text).join(''));
  const checkAction=value=>{
   assert.equal(value.kind,'planning-clarification');assert.equal(value.outputId,original.planningClarification.outputId);
   assert.equal(value.questionCount,1);assert.ok(value.nextAction.includes('/change result '+assignment.work));
   if(archived)assert.match(value.nextAction,/reply pane is unavailable/);
  };
  if(replies.length===1){
   const status=record.assignments[0];checkAction(status.ownerAction);assert.equal(status.resume,undefined);assert.equal(status.reentry,undefined);
   const checkpoint=blockedAssignmentResumeFingerprint(s,publication.id,assignment.target,assignment.work);assert.ok(checkpoint);
   return{tool:{name:'conversation_resume_assignment',arguments:{...operands,resultId:publication.id,checkpoint}}};
  }
  if(replies.length===2 || replies.length===3){
   assert.equal(record.accepted,false);assert.equal(record.wait,undefined);checkAction(record.ownerAction);
   if(replies.length===2)return{tool:{name:'conversation_assign',arguments:{...operands,operation:'change',instructions:'Continue from the original request'}}};
   return{tool:{name:'conversation_wait',arguments:{resultHandles:[assignment.id]}}};
  }
  assert.equal(record.waiting,false);checkAction(record.outcomes[0].ownerAction);stopped=true;
  return{text:'Waiting for the original owner decision.'};
 },({role,body,result})=>{
  if(role!=='adjudicator')return;
  if(!reply){result.planAccepted=false;delete result.acceptedPlan;result.ownerDecisionRequired=['Choose the intended consumer behavior'];return;}
  const direction=body.context.sourceInputChain.find(item=>item.input_id===reply.inputId);
  assert.equal(body.context.ownerRequest,request);assert.equal(direction.sourceOrigin,'owner-conversation-input');
  assert.equal(direction.source,reply.sourceId);assert.equal(direction.text,answer);assert.equal(direction.data.effectHold,true);
  delivered=true;
 });
 await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Delegate the original clarification task',mode:'idle'});
 assert.equal((await c.runConversation({conversationId:parent,model})).status,'delivered');await c.ordinary.drain();
 assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent);
 assert.equal(assignment.state,'UNAVAILABLE');
 original=c.inspectChange(assignment.work);
 const target=original.planningClarification.reply.conversationId;
 assert.equal(c.inspectConversation(target).parentId,assignment.target);
 publication=s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(assignment.data).resultId);
 if(archived){
  await c.archiveConversation({conversationId:target,expectedGeneration:c.inspectConversation(target).generation});
  const archivedResult=c.inspectChangeResult(assignment.work);
  assert.equal(archivedResult.planningClarification.reply,undefined);
  assert.match(changeResultText(archivedResult,'en'),/Reply pane unavailable/);
  assert.match(changeResultText(archivedResult,'ko'),/답변 대화를 열 수 없습니다/);
 }
 const ledger=()=>JSON.stringify([
  s.one('SELECT * FROM conversation_assignments WHERE id=?',assignment.id),
  ...s.all('SELECT * FROM conversation_inputs WHERE conversation IN (?,?) ORDER BY rowid',assignment.target,target),
  ...s.all('SELECT * FROM conversation_directions WHERE conversation IN (?,?) ORDER BY rowid',assignment.target,target),
  ...s.all('SELECT * FROM conversation_dependencies WHERE assignment=? ORDER BY rowid',assignment.id),
  ...s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',assignment.work),
  ...s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY rowid',assignment.work),
 ]);
 const before=ledger();
 await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Inspect the original planning question',mode:'idle'});
 const inspection=await c.runConversation({conversationId:parent,model});
 assert.equal(inspection.status,'delivered',JSON.stringify(inspection));await c.ordinary.drain();
 assert.equal(stopped,true);assert.equal(ledger(),before);
 if(archived)await c.restoreConversation({conversationId:target,expectedGeneration:c.inspectConversation(target).generation});
 reply=await c.queueConversationInputWithContext({conversationId:target,expectedGeneration:c.inspectConversation(target).generation,text:answer,mode:'idle'});
 const feedback=c.inspectConversationInputs(target).find(item=>item.inputId===reply.inputId);
 c.recoverConversationInput({conversationId:target,inputId:reply.inputId,expectedContext:feedback.fingerprint,action:'withdraw'});
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(assignment.work,false),null);
 assert.deepEqual(c.inspectChange(assignment.work).execution,original.execution);
 const owner=c.inspectConversation(assignment.target);
 const continued=await c.resumeConversationChange({conversationId:owner.conversationId,expectedGeneration:owner.generation,
  expectedModelRevision:c.getConversationModelChoice(owner.conversationId).revision,expectedEpoch:original.epoch,workId:assignment.work,model,maximumSteps:1,signal:t.signal});
 assert.equal(continued.phase,'PLAN_READY',JSON.stringify(continued.blocked));assert.equal(delivered,true);
 assert.equal(continued.workId,assignment.work);
 assert.equal(c.interactionCore.impacts(continued.workId).find(item=>item.input_id===reply.inputId).data.effectHold,false);
 assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',publication.id),publication);
});

for(const scenario of ['pending-target','cycle','witnessless-rejection','unproved-repair','positive-new-claim'])test('planning accounting preserves full subject graph and adoption boundary: '+scenario,{timeout:30000},async t=>{
 const f=await world(t,'no-controlled-failure',({role,body,result})=>{
  if(role==='planner')result.findings=['member','target'].map(label=>({requirementId:'historical-'+label,severity:'blocking',repair:'substantive',description:'Independent original '+label+' concern',evidence:['base:consumer.cjs']}));
  if(role!=='adjudicator')return;
  const [member,target]=body.context.occurrences;result.planAccepted=false;delete result.acceptedPlan;
  result.decisions=[{occurrenceId:member.id,disposition:'equivalent',equivalentTo:target.id,reason:'Same ordinary defect with still pending target',witnesses:[]}];
  if(scenario==='cycle')result.decisions.push({occurrenceId:target.id,disposition:'equivalent',equivalentTo:member.id,reason:'Would create an unsupported cycle',witnesses:[]});
  if(scenario==='witnessless-rejection')result.decisions.push({occurrenceId:target.id,disposition:'rejected',reason:'Unsupported closure must roll back the other decision',witnesses:[]});
  if(scenario==='unproved-repair')result.decisions.push({occurrenceId:target.id,disposition:'upheld',resolution:'repaired',reason:'No changed candidate or independent checks exist',witnesses:['base:consumer.cjs']});
  if(scenario==='positive-new-claim'){
   result.planAccepted=true;result.acceptedPlan=body.context.planProposal;
   result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'rejected',reason:'Original source does not establish this claim',witnesses:['base:consumer.cjs']}));
   result.findings=[{requirementId:'new-unaccounted-claim',severity:'blocking',repair:'substantive',description:'Independent new J concern cannot self-resolve',evidence:['base:consumer.cjs']}];
  }
 });
 const after=f.first,j=f.originals.find(l=>l.role==='adjudicator'),rows=c.store.all('SELECT * FROM finding_dispositions WHERE launch=?',j.id);
 assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.candidateVersion,null);
 assert.equal(rows.length,scenario==='pending-target'?1:scenario==='positive-new-claim'?2:0,JSON.stringify(after.blocked));
 if(scenario==='pending-target')for(const o of after.occurrences)assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',o.id).data).state,'pending');
 if(scenario==='positive-new-claim'){const own=after.occurrences.find(o=>o.data.launchId===j.id);assert.ok(own);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',own.id).data).state,'pending');assert.match(after.blocked.join(),/Raw occurrence unaccounted/);}
 assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
});

test('planning accounting refuses a changed original judgment after source authentication',{timeout:30000},async t=>{
 const core=c.changeCore,read=core.historicalPlanningProducer;let injected=false;
 core.historicalPlanningProducer=async function(work,output){
  const proof=await read.call(this,work,output);
  if(proof.launch.role==='adjudicator'&&proof.ld.stage==='planning-adjudication'&&!injected){injected=true;const metadata=JSON.parse(proof.output.data);metadata.protocol={...metadata.protocol,summary:'Changed derived judgment after original authentication'};c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(metadata),output);}
  return proof;
 };
 try{
  const f=await world(t,'no-controlled-failure',({role,body,result})=>{
   if(role==='planner')result.findings=[{requirementId:'historical-claim',severity:'blocking',repair:'substantive',description:'Original received claim',evidence:['base:consumer.cjs']}];
   if(role==='adjudicator'){result.planAccepted=false;delete result.acceptedPlan;result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'rejected',reason:'Independent original relevance judgment',witnesses:['base:consumer.cjs']}));}
  });
  assert.equal(injected,true);assert.equal(f.first.phase,'BLOCKED');assert.equal(f.first.planVersion,null);assert.match(f.first.blocked.join(),/judgment changed before accounting/);
  assert.equal(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence IN (SELECT id FROM finding_occurrences WHERE work=?)',f.workId).length,0);
 }finally{core.historicalPlanningProducer=read;}
});

for(const remedy of ['changed-plan','equivalent-plan','optional-plan','unchanged-plan','adoption-fails','code-finding'])test('plan-subject remedy '+remedy+' retains exact independent evidence',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:8,resolutionLimit:4});
 let subject,capturedSubjects,judgeCalls=0;
 const model=scripted(undefined,({role,body,result})=>{
  if(role==='challenger')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:remedy==='code-finding'?'Actual BASE consumer still exports2':'The proposal reviewer purpose does not explicitly include the check oracle',evidence:[remedy==='code-finding'?'base:consumer.cjs':'planProposal.verification.reviewRoles[0].purpose']}];
  if(role==='challenger'&&remedy==='equivalent-plan')result.findings.push({...structuredClone(result.findings[0]),description:'Equivalent independent observation of the same omitted oracle scope'});
  if(role==='challenger'&&remedy==='optional-plan')result.findings[0].severity='optional';
  if(role==='adjudicator'){
   judgeCalls++;capturedSubjects=body.context.planningRepair.subjects;subject=capturedSubjects[0];assert.ok(subject,'Original challenger proposal must be authenticated before repair is offered');
   result.decisions=[{occurrenceId:subject.occurrenceId,disposition:'upheld',resolution:'repaired',reason:'Review the corrected explicit oracle scope in this accepted plan',witnesses:['Original proposed review purpose and corrected accepted plan'],...(remedy==='code-finding'?{}:{repair:{kind:'plan',proposalHash:subject.proposalHash}})}];
   if(remedy==='equivalent-plan')result.decisions.push({occurrenceId:capturedSubjects[1].occurrenceId,disposition:'equivalent',equivalentTo:subject.occurrenceId,implementation:{kind:'none'},reason:'Same original plan scope omission, remedied by the explicit corrected plan',witnesses:['Same original proposal and independently assessed correction']});
   if(remedy!=='unchanged-plan')result.acceptedPlan.verification.reviewRoles[0].purpose+='; explicitly assess the executable oracle in check.cjs';
   if(remedy==='adoption-fails')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'New independent concern cannot be self-closed by this judge',evidence:['base:consumer.cjs']}];
  }
 });
 const view=await c.planChange({workId,model});assert.equal(judgeCalls,1);assert.equal(view.candidateVersion,null);assert.equal(view.execution.consumed,4);assert.equal(c.store.all('SELECT id FROM check_runs WHERE work=?',workId).length,0);
 const rows=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',subject.occurrenceId),obligation=JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',subject.occurrenceId).data);
 if(['changed-plan','equivalent-plan','optional-plan'].includes(remedy)){
  assert.equal(view.phase,'PLAN_READY',view.blocked.join());assert.ok(view.planVersion);assert.equal(obligation.state,'resolved');assert.equal(obligation.repairWitness.planVersion,view.planVersion);assert.equal(obligation.repairWitness.proposalHash,subject.proposalHash);assert.notEqual(obligation.repairWitness.acceptedPlanHash,subject.proposalHash);assert.equal(rows.length,2);assert.equal(JSON.parse(rows[0].data).repairPendingAdoption,true);assert.equal(JSON.parse(rows[1].data).repairWitness.planVersion,view.planVersion);
  const original=await c.changeCore.historicalPlanningProducer(workId,c.store.one("SELECT o.id FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='adjudicator'",workId).id);assert.equal(original.context.planningRepair.version,1);assert.deepEqual(original.context.planningRepair.subjects,capturedSubjects);
  if(remedy==='equivalent-plan')assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',capturedSubjects[1].occurrenceId).data).state,'resolved');
  const assertRepairCurrent=await c.changeCore.prevalidatePlanningRepairs(workId);
  const originalOccurrence=c.store.one('SELECT * FROM finding_occurrences WHERE id=?',subject.occurrenceId);
  const unusedOrdinal=c.store.one('SELECT MAX(ordinal) AS last FROM finding_occurrences WHERE output=?',originalOccurrence.output).last+1;
  for(const mutation of ['finding','ordinal']){
   const altered=JSON.parse(originalOccurrence.data);
   if(mutation==='finding')altered.finding.description+=' Changed after source authentication';
   c.store.run('UPDATE finding_occurrences SET ordinal=?,data=? WHERE id=?',mutation==='ordinal'?unusedOrdinal:originalOccurrence.ordinal,JSON.stringify(altered),subject.occurrenceId);
   try{assert.throws(assertRepairCurrent,/original|changed|subject|claim/i,'Retained plan repair must keep the exact original occurrence current');}
   finally{c.store.run('UPDATE finding_occurrences SET ordinal=?,data=? WHERE id=?',originalOccurrence.ordinal,originalOccurrence.data,subject.occurrenceId);}
   assertRepairCurrent();
  }
  const planRow=c.store.one('SELECT * FROM change_versions WHERE id=?',view.planVersion);
  for(const mutate of [data=>delete data.planningRepairs,data=>delete data.decisionLaunch,data=>data.planningRepairs=[],data=>data.planningRepairs[0].proposalHash='b'.repeat(64),data=>data.planningRepairs.push(structuredClone(data.planningRepairs[0]))]){
   const data=JSON.parse(planRow.data);mutate(data);c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(data),planRow.id);
   assert.throws(()=>c.changeCore.assertPlanningRepairs(workId),/Plan repair/);c.store.run('UPDATE change_versions SET data=? WHERE id=?',planRow.data,planRow.id);
  }
  const effective=rows[1];c.store.run('DELETE FROM finding_dispositions WHERE id=?',effective.id);assert.throws(()=>c.changeCore.assertPlanningRepairs(workId),/unique original effective/);c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',effective.id,effective.occurrence,effective.launch,effective.status,effective.data);
  const origin=c.store.one('SELECT * FROM role_outputs WHERE id=?',subject.producerOutputId);c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw+' ',origin.id);await assert.rejects(c.changeCore.prevalidatePlanningRepairs(workId));c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw,origin.id);
  await c.close();c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});assert.equal(c.inspectChange(workId).phase,'PLAN_READY');await c.changeCore.prevalidatePlanningRepairs(workId);assert.equal(c.changeCore.assertPlanningRepairs(workId).length,1);
  const core=c.changeCore,select=core.selectRoleModel,beforeRuns=c.store.all('SELECT id FROM runs WHERE work=?',workId);let attempted=false;
  core.selectRoleModel=async function(options,role){
   const selected=await select.call(this,options,role);
   if(role==='implementer'){
    attempted=true;
    if(remedy==='optional-plan')c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw+' ',origin.id);
    else{
     const altered=JSON.parse(originalOccurrence.data);
     if(remedy==='changed-plan')altered.finding.description+=' Changed across model selection';
     c.store.run('UPDATE finding_occurrences SET ordinal=?,data=? WHERE id=?',remedy==='equivalent-plan'?unusedOrdinal:originalOccurrence.ordinal,JSON.stringify(altered),subject.occurrenceId);
    }
   }
   return selected;
  };
  try{const held=await c.implementChange({workId,model});assert.equal(attempted,true);assert.equal(held.phase,'BLOCKED');assert.equal(held.candidateVersion,null);assert.deepEqual(c.store.all('SELECT id FROM runs WHERE work=?',workId),beforeRuns);assert.match(held.blocked.join(),/changed|unavailable|proof|source/i);}
  finally{core.selectRoleModel=select;c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw,origin.id);c.store.run('UPDATE finding_occurrences SET ordinal=?,data=? WHERE id=?',originalOccurrence.ordinal,originalOccurrence.data,subject.occurrenceId);}
  const authenticate=core.prevalidatePlanningRepairs,history=core.historicalPlanningProducer;let repairGuardPrepared=false,lateDrift=false;
  core.prevalidatePlanningRepairs=async function(work){const guard=await authenticate.call(this,work);repairGuardPrepared=true;return guard;};
  core.historicalPlanningProducer=async function(work,output){const result=await history.call(this,work,output);if(repairGuardPrepared&&!lateDrift){lateDrift=true;c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw+' ',origin.id);}return result;};
  try{await assert.rejects(core.prevalidateRetainedBaseClassifications(workId),/changed|unavailable/i);assert.equal(lateDrift,true);assert.deepEqual(c.store.all('SELECT id FROM runs WHERE work=?',workId),beforeRuns);}finally{core.prevalidatePlanningRepairs=authenticate;core.historicalPlanningProducer=history;c.store.run('UPDATE role_outputs SET raw=? WHERE id=?',origin.raw,origin.id);}



 }else{
  assert.equal(view.phase,'BLOCKED');assert.equal(view.planVersion,null);assert.equal(obligation.state,'pending');assert.equal(obligation.repairWitness,undefined);
  if(remedy==='adoption-fails'){assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].data).repairPendingAdoption,true);assert.match(view.blocked.join(),/Raw occurrence unaccounted/);}
  else {assert.equal(rows.length,0);assert.match(view.blocked.join(),remedy==='unchanged-plan'?/changed accepted plan/:/Repair closure needs/);}
 }
});

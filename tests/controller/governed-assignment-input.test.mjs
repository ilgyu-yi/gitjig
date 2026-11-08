/** Real Controller/SDK assignment admission; governed drive is held/failed without an engine or paid model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {scripted} from './effect-fixture.mjs';
import {assignmentDispatchToken,captureGovernedAssignmentInput,consumeGovernedAssignmentInput} from '../../dist/controller/assignment-authority.js';
import {roleFraming,nativeRoleFraming} from '../../dist/workflow/role-framing.js';

async function world(t) {
 const f=await structuredAssignmentWorld(t,{originalGovernedDispatch:true,maxAssignments:1}),s=f.c.store;
 let entered=()=>{},attempt=0;
 f.c.changeCore.drive=async({workId})=>{
  attempt++;const a=s.one('SELECT * FROM conversation_assignments WHERE work=?',workId),data=JSON.parse(a.data);
  const inputId=data.reentries?.at(-1)?.inputId??data.inputId;
  assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CONSUMED','Actual drive sees acknowledged workflow delivery');
  await entered({workId,inputId,attempt});
  return {workId,epoch:f.c.inspectWork(workId).epoch,reviewReady:false,phase:f.c.inspectChange(workId).phase};
 };
 await f.assign();
 const assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',f.parent);
 assert.ok(assignment?.work);assert.equal(assignment.state,'UNAVAILABLE');
 let beforeLaunch=async()=>{};
 const launch=f.c.ordinaryCore.h.launchChange;
 f.c.ordinaryCore.h.launchChange=async(...args)=>{await beforeLaunch(...args);return launch(...args);};
 const reenter=async()=>{
  let step=0;
  const model=scripted(()=>step++===0?{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:assignment.target,
   observedDirectionRevision:f.c.inspectConversation(assignment.target).directionRevision,instructions:'Continue the same original task; source fit must remain independent'}}}:{text:'Only the original workflow was addressed.'});
  const mode=JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?',assignment.id).data).modelBinding.mode;
  model.provider=mode.provider;model.modelId=mode.modelId;model.definition.api='input-admission-api-'+randomUUID();
  const v=f.c.inspectConversation(f.parent);
  await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:v.generation,text:'Reenter original task '+randomUUID(),mode:'idle'});
  await f.c.runConversation({conversationId:f.parent,model});await f.c.ordinaryCore.drain();
 };
 return {...f,s,assignment,reenter,onDrive(fn){entered=fn;},beforeLaunch(fn){beforeLaunch=fn;},attempts:()=>attempt};
}

test('initial and repeated same-task dispatch acknowledge only their original input before held drive',async t=>{
 const f=await world(t),{s,assignment:a}=f;
 const {bundle}=await f.c.changeCore.bundle(a.work,{stage:'planning'},'planner');
 assert.equal(bundle.context.ownerRequest,'Owned delegated task');
 assert.equal(bundle.context.sourceProvenance.kind,'agent-governed-assignment');
 assert.equal(bundle.context.delegatingOwnerSource.raw,'Delegate owned task');
 assert.notEqual(bundle.context.ownerSource,bundle.context.delegatingOwnerSource.id);
 assert.ok(bundle.context.requirementSourceIds.includes(bundle.context.ownerSource));
 assert.ok(bundle.context.requirementSourceIds.includes(bundle.context.delegatingOwnerSource.id));
 const before=structuredClone(bundle);
 for(const frame of [roleFraming('planner',bundle),nativeRoleFraming('planner',bundle,'authority-input',3)]){
  assert.ok(frame.prompt.includes('Owned delegated task'));assert.ok(frame.prompt.includes('Delegate owned task'));
  assert.match(frame.systemPrompt,/delegated scope/);assert.match(frame.systemPrompt,/recorded provenance/);assert.match(frame.systemPrompt,/within the assigned scope/);
 }
 assert.deepEqual(bundle,before,'Framing preserves received input and original upstream records');
 const initial=JSON.parse(a.data).inputId;assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',initial).state,'CONSUMED');
 const work=s.one('SELECT * FROM works WHERE id=?',a.work),budgets=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',work.lineage);
 let prior=[];
 for(let i=0;i<2;i++){
  f.onDrive(({workId,inputId})=>{
   assert.equal(workId,a.work);assert.notEqual(inputId,initial);
   const directions=f.c.interactions.impacts(a.work);assert.ok(directions.some(d=>d.input_id===inputId&&d.data.effectHold),'Delivery does not clear source-fit hold');
   for(const row of prior)assert.deepEqual(s.one('SELECT * FROM conversation_inputs WHERE id=?',row.id),row);
  });
  await f.reenter();
  const row=s.one('SELECT * FROM conversation_assignments WHERE id=?',a.id),data=JSON.parse(row.data),entry=data.reentries.at(-1);
  assert.equal(row.state,'UNAVAILABLE','Held outcome is not promoted to completion');assert.equal(data.reentries.length,i+1);
  const input=s.one('SELECT * FROM conversation_inputs WHERE id=?',entry.inputId);assert.equal(input.state,'CONSUMED');assert.equal(JSON.parse(input.data).governedWork,a.work);prior.push(input);
 }
 assert.equal(f.attempts(),3);assert.equal(s.one('SELECT COUNT(*) n FROM conversation_assignments').n,1);
 assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',work.lineage),budgets);
 assert.equal(s.one('SELECT source FROM works WHERE id=?',a.work).source,work.source);f.pass();
});

test('later drive failure preserves consumed delivery and the independent direction hold',async t=>{
 const f=await world(t);f.onDrive(()=>{throw Error('CONTROLLED_AFTER_WORKFLOW_INPUT_ADMISSION');});await f.reenter();
 const row=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.assignment.id),data=JSON.parse(row.data),inputId=data.reentries.at(-1).inputId;
 assert.equal(row.state,'UNAVAILABLE');assert.match(data.error,/CONTROLLED_AFTER_WORKFLOW_INPUT_ADMISSION/);
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CONSUMED');
 assert.ok(f.c.interactions.impacts(f.assignment.work).some(d=>d.input_id===inputId&&d.data.effectHold));f.pass();
});

for(const fault of ['model-route','foreign-source','actor-source','input-generation','direction-input'])test(`preadmission ${fault} refusal preserves exact undelivered input`,async t=>{
 const f=await world(t);let before,inputId;
 f.beforeLaunch((_id,request)=>{
  const data=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.assignment.id).data),entry=data.reentries.at(-1);
  inputId=entry.inputId;
  if(fault==='model-route')delete request.model;
  if(fault==='foreign-source')f.s.run('UPDATE conversation_inputs SET source=? WHERE id=?',JSON.parse(f.assignment.data).instructionsSource,inputId);
  if(fault==='actor-source'){
   const source=f.s.one('SELECT origin FROM sources WHERE id=?',entry.source),origin=JSON.parse(source.origin);origin.actor={...origin.actor,runId:randomUUID()};
   f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(origin),entry.source);
  }
  if(fault==='input-generation')f.s.run('UPDATE conversation_inputs SET generation=generation+1 WHERE id=?',inputId);
  if(fault==='direction-input')f.s.run("UPDATE conversation_directions SET data=json_set(data,'$.inputId',?) WHERE source=?",randomUUID(),entry.source);
  before=f.s.one('SELECT * FROM conversation_inputs WHERE id=?',inputId);
 });
 await f.reenter();assert.ok(inputId);assert.equal(before.state,'DISPATCHED_WORKFLOW');
 assert.deepEqual(f.s.one('SELECT * FROM conversation_inputs WHERE id=?',inputId),before);
 assert.equal(f.attempts(),1,'Refused delivery never reaches another governed drive');
 assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.assignment.id).state,'UNAVAILABLE');f.pass();
});

test('cancellation before owned reentry admission cannot acknowledge its input',async t=>{
 const f=await world(t);let inputId;
 f.beforeLaunch(async()=>{
  inputId=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.assignment.id).data).reentries.at(-1).inputId;
  await f.c.cancelWork({workId:f.assignment.work});
 });
 await f.reenter();assert.ok(inputId);assert.equal(f.attempts(),1);
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CANCELLED');
 assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.assignment.id).state,'CANCELLED');f.pass();
});

test('old dispatch token cannot consume a newer exact reentry input',async t=>{
 const f=await world(t);await f.reenter();
 const old=captureGovernedAssignmentInput(f.s,f.assignment.id);
 f.beforeLaunch(()=>{
  const before=f.s.all('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid',f.assignment.target);
  assert.notEqual(assignmentDispatchToken(f.s,f.assignment.id),old.dispatchToken);
  assert.throws(()=>consumeGovernedAssignmentInput(f.s,f.assignment.id,f.assignment.work,old),/input changed before admission/);
  assert.deepEqual(f.s.all('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid',f.assignment.target),before);
 });
 await f.reenter();assert.equal(f.attempts(),3);f.pass();
});


test('workflow acknowledgment preserves newer direct owner input and its source-fit direction',async t=>{
 const f=await world(t);let newer,before;
 f.beforeLaunch(async()=>{
  const v=f.c.inspectConversation(f.assignment.target);
  newer=await f.c.queueConversationInput({conversationId:v.conversationId,expectedGeneration:v.generation,text:'A later owner condition still requires independent source fit',mode:'idle'});
  before=f.s.one('SELECT * FROM conversation_inputs WHERE id=?',newer.inputId);
 });
 await f.reenter();assert.equal(f.attempts(),2);assert.ok(newer);
 assert.deepEqual(f.s.one('SELECT * FROM conversation_inputs WHERE id=?',newer.inputId),before);
 assert.ok(f.c.interactions.impacts(f.assignment.work).some(d=>d.input_id===newer.inputId&&d.data.effectHold));f.pass();
});

for(const fault of ['dispatch-token','cancellation','source-raw','input-text','delivery-bytes'])test(`actual initial capture await preserves input on ${fault} drift`,async t=>{
 const f=await structuredAssignmentWorld(t,{originalGovernedDispatch:true}),s=f.c.store,begin=f.c.changeCore.begin.bind(f.c.changeCore);
 let inputId,drives=0;
 f.c.changeCore.drive=async()=>{drives++;assert.fail('Changed initial capture cannot reach governed drive');};
 f.c.changeCore.begin=async(...args)=>{
  const begun=await begin(...args),a=s.one('SELECT * FROM conversation_assignments WHERE work=?',begun.workId),data=JSON.parse(a.data);inputId=data.inputId;
  if(fault==='dispatch-token')s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...data,inputId:randomUUID()}),a.id);
  else if(fault==='cancellation')await f.c.cancelWork({workId:begun.workId});
  else{
   if(fault!=='input-text')s.run('UPDATE sources SET raw=? WHERE id=?','Changed after original capture',data.instructionsSource);
   if(fault!=='source-raw')s.run('UPDATE conversation_inputs SET text=? WHERE id=?','Changed after original capture',inputId);
  }
  return begun;
 };
 await f.assign();assert.ok(inputId);assert.equal(drives,0);
 assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,fault==='cancellation'?'CANCELLED':'QUEUED');f.pass();
});

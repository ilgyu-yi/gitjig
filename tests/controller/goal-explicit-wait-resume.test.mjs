import test from 'node:test';
import assert from 'node:assert/strict';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';
import {openController} from '../../dist/controller/index.js';

async function retained(t){
 const f=await failedWaitWorld(t,{goal:true});let c;
 const active=f.c.inspectGoal(f.goal.goalId);await f.c.pauseGoal({goalId:active.goalId,expectedRevision:active.revision,reason:'Retain original WAIT for cold explicit resume'});await f.settle();await f.c.close();
 c=await openController({installationHome:f.home,interactionDelegation:{projectIds:['P'],maxAssignments:8}});t.after(()=>c.close());
 const wait=JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',f.parent).data),run=c.store.one('SELECT * FROM runs WHERE id=?',wait.runId),attempt=c.store.one('SELECT * FROM goal_attempts WHERE run=?',wait.runId);
 const counts=()=>({runs:c.store.one('SELECT COUNT(*) n FROM runs').n,inputs:c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n,budgets:c.store.all('SELECT * FROM budgets ORDER BY rowid'),spent:c.inspectGoal(f.goal.goalId).startedAttempts});
 const start=model=>{const g=c.inspectGoal(f.goal.goalId);return c.startGoal({goalId:g.goalId,expectedRevision:g.revision,model});};
 return{...f,c,run,attempt,counts,start};
}
async function valid(f){f.start(f.model);await f.c.ordinary.drain();const g=f.c.inspectGoal(f.goal.goalId);assert.equal(g.state,'WAITING_INPUT',g.reason);assert.equal(g.startedAttempts,2);assert.equal(f.continuations.length,1);f.pass();}

test('public cold explicit Goal resume validates source, membership and missing legacy identity before any admission', {timeout:20000},async t=>{
 const f=await retained(t),c=f.c,before=f.counts(),goalBefore=c.inspectGoal(f.goal.goalId);
 const changed={...f.model,definition:{...f.model.definition,baseUrl:'http://different.invalid'}};
 assert.throws(()=>f.start(changed),/exact original profile/);assert.deepEqual(f.counts(),before);assert.equal(c.inspectGoal(f.goal.goalId).revision,goalBefore.revision);
 assert.throws(()=>f.start({...f.model,runtime:{}}),/identifiable owned explicit profile/);assert.deepEqual(f.counts(),before);
 const data=JSON.parse(f.run.data);delete data.modelIdentity;c.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(data),f.run.id);
 assert.throws(()=>f.start(f.model),/identity unavailable/);assert.deepEqual(f.counts(),before);c.store.run('UPDATE runs SET data=? WHERE id=?',f.run.data,f.run.id);
 c.store.run('UPDATE goal_attempts SET state=? WHERE id=?','SETTLED',f.attempt.id);assert.throws(()=>f.start(f.model),/does not belong/);assert.deepEqual(f.counts(),before);c.store.run('UPDATE goal_attempts SET state=? WHERE id=?','WAITING',f.attempt.id);
 const other=c.createGoal({conversationId:c.createConversation().conversationId,objective:'Unrelated goal',criteria:['Separate source'],turnLimit:2});c.store.run('UPDATE goal_attempts SET goal=? WHERE id=?',other.goalId,f.attempt.id);assert.throws(()=>f.start(f.model),/does not belong/);assert.deepEqual(f.counts(),before);c.store.run('UPDATE goal_attempts SET goal=? WHERE id=?',f.goal.goalId,f.attempt.id);
 // Preserve a retained unavailable label on wrong-profile refusal; an accepted
 // resume must fingerprint the exact WAIT row it commits during activation.
 c.store.run('UPDATE goal_attempts SET state=? WHERE id=?','UNAVAILABLE',f.attempt.id);
 const unavailable=c.inspectGoal(f.goal.goalId);
 assert.throws(()=>f.start(changed),/exact original profile/);
 assert.deepEqual(c.inspectGoal(f.goal.goalId),unavailable);
 assert.deepEqual(f.counts(),before);
 await valid(f);assert.equal(c.inspectGoal(other.goalId).startedAttempts,0);
});

for(const fault of ['definition','runtime'])test('late caller '+fault+' mutation cannot replace the captured original WAIT model',{timeout:20000},async t=>{
 const f=await retained(t),c=f.c,before=f.counts(),original=c.validatePredecessor.bind(c),baseUrl=f.model.definition.baseUrl;
 const identity=JSON.parse(f.run.data).modelIdentity;
 let observed=false;
 c.validatePredecessor=async work=>{await original(work);observed=true;if(fault==='definition')f.model.definition.baseUrl='http://late-drift.invalid';else f.model.runtime={};};
 try{
  f.start(f.model);await c.ordinary.drain();
  assert.equal(observed,true);
  assert.equal(c.inspectGoal(f.goal.goalId).state,'WAITING_INPUT');
  assert.equal(c.inspectGoal(f.goal.goalId).startedAttempts,before.spent+1);
  assert.equal(f.continuations.length,1);
  const runs=c.store.all("SELECT data FROM runs WHERE work=? AND json_extract(data,'$.conversation')=? ORDER BY rowid",f.run.work,f.parent);
  assert.equal(runs.length,2);
  assert.equal(JSON.parse(runs[1].data).modelIdentity,identity);
  for(let index=0;index<3;index++)c.ordinary.resumeAuthorized();
  await c.ordinary.drain();assert.equal(f.continuations.length,1);f.pass();
 }finally{c.validatePredecessor=original;f.model.definition.baseUrl=baseUrl;delete f.model.runtime;}
});

for(const fault of ['model-identity','attempt'])test('late '+fault+' drift before original WAIT enqueue preserves input/run/spend and then valid source resumes once',{timeout:20000},async t=>{
 const f=await retained(t),c=f.c,before=f.counts(),original=c.validatePredecessor.bind(c),baseUrl=f.model.definition.baseUrl;
 c.validatePredecessor=async work=>{await original(work);if(fault==='model-identity')c.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.run.data),modelIdentity:'a'.repeat(64)}),f.run.id);else c.store.run('UPDATE goal_attempts SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.attempt.data),changedDuringHistory:true}),f.attempt.id);};
 try{f.start(f.model);await c.ordinary.drain();assert.deepEqual(f.counts(),before);assert.equal(c.inspectConversation(f.parent).state,'WAITING');}
 finally{c.validatePredecessor=original;f.model.definition.baseUrl=baseUrl;delete f.model.runtime;c.store.run('UPDATE goal_attempts SET data=? WHERE id=?',f.attempt.data,f.attempt.id);c.store.run('UPDATE runs SET data=? WHERE id=?',f.run.data,f.run.id);}
 await valid(f);
});

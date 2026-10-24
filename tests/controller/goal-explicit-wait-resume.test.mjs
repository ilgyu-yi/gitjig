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
 await valid(f);assert.equal(c.inspectGoal(other.goalId).startedAttempts,0);
});

for(const fault of ['definition','runtime','attempt'])test('late '+fault+' drift before original WAIT enqueue preserves input/run/spend and then valid source resumes once',{timeout:20000},async t=>{
 const f=await retained(t),c=f.c,before=f.counts(),original=c.validatePredecessor.bind(c),baseUrl=f.model.definition.baseUrl;
 c.validatePredecessor=async work=>{await original(work);if(fault==='definition')f.model.definition.baseUrl='http://late-drift.invalid';else if(fault==='runtime')f.model.runtime={};else c.store.run('UPDATE goal_attempts SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.attempt.data),changedDuringHistory:true}),f.attempt.id);};
 try{f.start(f.model);await c.ordinary.drain();assert.deepEqual(f.counts(),before);assert.equal(c.inspectConversation(f.parent).state,'WAITING');}
 finally{c.validatePredecessor=original;f.model.definition.baseUrl=baseUrl;delete f.model.runtime;c.store.run('UPDATE goal_attempts SET data=? WHERE id=?',f.attempt.data,f.attempt.id);}
 await valid(f);
});

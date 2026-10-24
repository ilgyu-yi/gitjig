import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getCurrentTools} from '@earendil-works/pi-ai/compat';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {scripted} from './effect-fixture.mjs';

// Actual original native goal/assignment/WAIT/review/acceptance. Governed standing is
// an explicit controlled premise, not engine execution or independent model judgment.
test('original linked native goal completes through the raw-source and selected-evidence final guards', {timeout:20000},async t=>{
 const f=await structuredAssignmentWorld(t),c=f.c;
 const goal=c.createGoal({conversationId:f.parent,objective:'Inspect one controlled delegated outcome',criteria:['The original assigned result is attributed and independently reviewed'],turnLimit:6});
 const core=c.goalCore;let delegated=false,proposed=false,reviewed=false;
 core.h.evidence=async workId=>{
  const w=c.store.one('SELECT epoch,generation FROM works WHERE id=?',workId),state=c.store.one('SELECT base,data FROM change_state WHERE work=?',workId),contracts=JSON.parse(state.data).contractsVersion;
  return{workId,epoch:w.epoch,generation:w.generation,versions:{base:state.base,candidate:state.base,plan:state.base,verification:state.base,requirements:null,contracts},candidateDigest:'controlled-procedure-premise',sourceChainDigest:'controlled',selectionDigest:'controlled',checkIds:[],reviewLaunchIds:[],dispositionDigest:'controlled',carryDigest:null,fingerprint:'controlled-standing-'+workId};
 };
 core.h.assertEvidence=value=>{assert.equal(c.store.one('SELECT epoch FROM works WHERE id=?',value.workId).epoch,value.epoch);};
 const model=scripted(context=>{
  if(getCurrentTools(context.messages).some(tool=>tool.name==='goal_review')){
   if(reviewed)return{text:'Controlled independent fixture assessment recorded.'};reviewed=true;
   return{tool:{name:'goal_review',arguments:{verdict:'pass',reason:'Controlled original attributed result reviewed',findings:[],resolvedFindingIds:[]}}};
  }
  if(!delegated){delegated=true;return{tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Controlled original task',operation:'change',resultDependency:true}}};}
  const a=c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid DESC LIMIT 1',f.parent);
  if(a?.state==='COMPLETE'){
   if(proposed)return{text:'The controlled original delegated result is ready for separate assessment.'};proposed=true;
   return{tool:{name:'goal_progress',arguments:{disposition:'propose-completion',plan:'Inspect exact original outcome',nextAction:'Separate independent assessment',reason:'Controlled original assignment settled',resultIds:[JSON.parse(a.data).resultId]}}};
  }
  return{tool:{name:'conversation_wait',arguments:{resultHandles:[a.id]}}};
 });model.provider='linked-goal-'+randomUUID();model.definition.api='linked-goal-api-'+randomUUID();
 c.startGoal({goalId:goal.goalId,expectedRevision:goal.revision,model});const done=await c.waitGoal(goal.goalId);
 assert.equal(done.state,'COMPLETED',done.reason);assert.equal(done.startedAttempts,3);assert.ok(done.acceptedReview);assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_assignments WHERE source_conversation=?',f.parent).n,1);
 const review=c.store.one('SELECT data FROM goal_reviews WHERE goal=?',goal.goalId),proof=JSON.parse(review.data);assert.equal(proof.evidenceVersion,2);assert.match(proof.selectedSourceHash,/^[a-f0-9]{64}$/);f.pass();
});

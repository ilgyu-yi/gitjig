import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
import {hash} from '../../dist/controller/change-files.js';

test('public replanning classifies BASE claims and reuses the retained candidate only after current checks and fresh review',{timeout:120000},async t=>{
 const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
 assert.ok(runtimeProfile.dockerBinary&&runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit private engine route required');
 const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;assert.ok(parent&&path.isAbsolute(parent));assert.equal(await fs.realpath(parent),parent);
 const checkout=await fs.realpath('.');assert.ok(parent!==checkout&&!parent.startsWith(checkout+path.sep));
 const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'qualified-base-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.chmod(root,0o700);await fs.mkdir(source);
 const priorTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
 const checker=withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3,actual:String(value)}]}));\n");
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),checker);
 let c,core,complete=false;const receipt={root,learnedModel:false,transport:'Controlled SDK streams; actual Controller, immutable captures, Docker checks and fresh independent review',complete:false};
 try{
  c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3; preserve original source/checker. Independently assess true BASE claims even when candidate is already corrected.',executionLimit:8,resolutionLimit:12});receipt.workId=workId;
  let mode='initial',reviewed=false,pendingReview=true;const claim=()=>({requirementId:'R1',severity:'blocking',repair:'substantive',description:'The initial BASE consumer exports2 instead of3; the corrected retained candidate is a separate subject',evidence:['base:consumer.cjs']});
  const model=scripted(undefined,({role,body,result})=>{
   if(mode==='initial'&&role==='implementer')result.findings=[claim()];
   if(mode==='replan'&&['planner','challenger'].includes(role))result.findings=[claim()];
   if(mode==='initial'&&role==='adjudicator'&&body.context.stage==='planning-adjudication'){assert.equal(body.context.decisionCarry.version,2);assert.equal(body.context.decisionCarryInput,undefined);}
   if(mode==='replan'&&role==='adjudicator'&&body.context.stage==='planning-adjudication'){
    assert.deepEqual(body.context.decisionCarryInput,{version:3});
    assert.equal(body.context.decisionCarry.version,3);assert.ok(body.context.decisionCarry.baseSourceIds.includes('base:consumer.cjs'));
    result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'Independently confirmed original BASE implementation duty. Candidate exports3 already; this is not an unresolved candidate or proposal objection. Current R1 repairs the same owner requirement; actual current checks and fresh review remain required.',witnesses:['base:consumer.cjs'],implementation:{kind:'assign-to-plan',baselineVersion:body.context.baseVersion,requirementIds:['R1'],baseSourceIds:['base:consumer.cjs']}}));
   }
   if(role==='reviewer')reviewed=true;
   if(role==='adjudicator'&&body.context.stage==='review-adjudication'){
    assert.deepEqual(body.context.reviewResolutionInput,{version:4});
    assert.equal(reviewed,true);const checks=body.context.checks.filter(x=>x.status==='pass'&&x.candidate===body.context.candidateVersion&&x.verification===body.context.verificationVersion).map(x=>x.id);assert.ok(checks.length);
    result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',resolution:pendingReview?'pending':'repaired',reason:'Candidate differs from independently classified BASE, passes this accepted plan actual consumer cases, and has fresh independent review; original claims remain retained',witnesses:checks}));
   }
  });
  let v=await c.planChange({workId,model,signal:t.signal});assert.equal(v.phase,'PLAN_READY',JSON.stringify(v.blocked));
  assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'implement',roles:['implementer']});
  v=await c.driveChange({workId,model,maximumSteps:1,signal:t.signal});assert.equal(v.phase,'CANDIDATE_CAPTURED',JSON.stringify(v.blocked));assert.ok(v.candidateVersion);const candidate=v.candidateVersion,baseline=v.baseVersion,oldPlan=v.planVersion;
  assert.equal(await fs.readFile(path.join(c.changeCore.version(candidate).artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');
  const authorCount=c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role IN ('implementer','repairer')",workId).n;
  core=c.changeCore;mode='replan';
  const select=core.selectRoleModel,candidateBeforeSelection=c.store.one('SELECT * FROM change_versions WHERE id=?',candidate);
  const judgeCount=c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='adjudicator'",workId).n,consumedBeforeDrift=v.execution.consumed;
  let selectionDrift=false;
  core.selectRoleModel=async function(options,role){
   const selected=await select.call(this,options,role);
   if(role==='adjudicator'&&!selectionDrift){
    selectionDrift=true;c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',candidateBeforeSelection.artifact+'.changed',candidate);
   }
   return selected;
  };
  try{
   v=await c.planChange({workId,model,signal:t.signal});assert.equal(v.phase,'BLOCKED');assert.match(v.blocked.join(' '),/retained planning BASE or candidate changed/);
   assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='adjudicator'",workId).n,judgeCount,'Selection-time drift must refuse before judge reservation/model execution');
   assert.equal(v.execution.consumed,consumedBeforeDrift+2,'Completed planner/challenger work remains charged after the refused judge');assert.equal(v.execution.reserved,0);
  }finally{core.selectRoleModel=select;c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',candidateBeforeSelection.artifact,candidate);}
  assert.equal(selectionDrift,true);receipt.selectionTimeDriftRefusedBeforeJudge=true;
  // A replan over an accepted plan has no resumable unaccepted P/C prefix.
  // Preserve their actual spend and authorize the negative control's extra work.
  c.extendExecutionAllowance({workId,additional:2,reason:'Retain completed planner/challenger spend from deliberate source drift, then retry public replanning'});
  v=await c.planChange({workId,model,signal:t.signal});assert.equal(v.phase,'PLAN_READY',JSON.stringify(v.blocked));assert.notEqual(v.planVersion,oldPlan);assert.equal(v.candidateVersion,candidate);assert.equal(v.reviewReady,false);
  const normalJudge=c.store.one("SELECT data FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",workId);
  assert.deepEqual(JSON.parse(normalJudge.data).decisionCarryInput,{version:3});receipt.normalPublicSelection=true;
  const planVersion=v.planVersion,carries=core.version(planVersion).data.implementationCarries;assert.equal(carries.length,5,'Initial author and both completed P/C pairs retain their received claims');assert.deepEqual(new Set(carries.map(x=>x.occurrenceId)),new Set(v.occurrences.map(x=>x.id)));assert.ok(carries.every(x=>x.baselineVersion===baseline&&x.baselineBasis.version===1));
  for(const carry of carries){assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',carry.occurrenceId).data).state,'pending');assert.throws(()=>core.repairedProof(workId,c.store.one('SELECT * FROM finding_occurrences WHERE id=?',carry.occurrenceId),[]),/freshly reauthenticated|current actual checks|fresh independent current review/);}
  receipt.classification={candidate,baseline,planVersion,originRoles:carries.map(x=>c.store.one('SELECT role FROM role_launches WHERE id=?',x.originLaunchId).role),sourceBindings:carries.map(x=>x.baselineBasis.sources)};
  const accepted=c.store.one('SELECT * FROM change_versions WHERE id=?',planVersion),altered=JSON.parse(accepted.data),member=altered.implementationCarries[0];
  member.baselineBasis.sources[0].sourceSha256='0'.repeat(64);
  member.baselineBasis.fingerprint=hash([core.baseClassificationFence(workId,member,altered.decisionLaunch),member.baselineBasis.sources]);
  try{
   c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(altered),planVersion);
   await assert.rejects(core.prevalidateRetainedBaseClassifications(workId),/receipt differs from authenticated original source/,'A coherent receipt/fingerprint edit is not original source authentication');
   receipt.recomputedReceiptEditRefused=true;
  }finally{c.store.run('UPDATE change_versions SET data=? WHERE id=?',accepted.data,planVersion);}
  await c.close();c=null;
  c=await openController({installationHome:home,runtimeProfile});core=c.changeCore;
  assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'checks',roles:[]});
  const beforeHold=c.store.one('SELECT * FROM change_state WHERE work=?',workId);
  const beforeRuns=c.store.one('SELECT COUNT(*) AS n FROM runs WHERE work=?',workId).n;
  try {
   c.store.run('UPDATE change_state SET candidate=NULL WHERE work=?',workId);
   assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'held',roles:[]});
   v=await c.driveChange({workId,maximumSteps:1,signal:t.signal});
   assert.equal(v.phase,'BLOCKED');assert.equal(v.recordedPhase,'PLAN_READY');assert.match(v.blocked.join(' '),/does not bind the selected candidate/);
  } finally { c.store.run('UPDATE change_state SET candidate=? WHERE work=?',candidate,workId); }
  v=await c.driveChange({workId,maximumSteps:1,signal:t.signal});
  assert.equal(v.phase,'PLAN_READY');assert.match(v.nextAction,/Extend execution allowance.*retained candidate/);
  assert.equal(c.inspectWorkRecovery(workId).nextAction,v.nextAction);
  assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),beforeHold);
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs WHERE work=?',workId).n,beforeRuns);
  c.extendExecutionAllowance({workId,additional:5,reason:'Run current retained-candidate checks, review, capture-drift refusal and explicit pending/repaired resolution in this fixture'});
  const candidateRow=c.store.one('SELECT * FROM change_versions WHERE id=?',candidate);
  const readOriginal=core.historicalPlanningProducer;
  let changedWhileReading=false;
  core.historicalPlanningProducer=async function(...args){
   const proof=await readOriginal.apply(this,args);
   c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',candidateRow.artifact+'.changed',candidate);
   changedWhileReading=true;
   return proof;
  };
  try {
   v=await c.driveChange({workId,maximumSteps:1,signal:t.signal});
   assert.equal(changedWhileReading,true);
   assert.equal(v.phase,'BLOCKED');assert.equal(v.recordedPhase,'PLAN_READY');
   assert.match(v.blocked.join(' '),/candidate changed while reading the original judgment/);
   assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),beforeHold);
   assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs WHERE work=?',workId).n,beforeRuns);
  } finally {
   core.historicalPlanningProducer=readOriginal;
   c.store.run('UPDATE change_versions SET artifact=? WHERE id=?',candidateRow.artifact,candidate);
  }
  v=await c.driveChange({workId,maximumSteps:1,signal:t.signal});
  assert.equal(v.phase,'CHECKED',JSON.stringify(v.blocked));assert.equal(v.candidateVersion,candidate);
  assert.ok(v.checks.some(x=>x.status==='pass'&&x.verification===v.verificationVersion),JSON.stringify(v.blocked));
  for(const carry of carries)assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',carry.occurrenceId).data).state,'pending');
  v=await c.reviewChange({workId,model,signal:t.signal});assert.equal(v.phase,'RESOLVING',JSON.stringify(v.blocked));assert.equal(v.candidateVersion,candidate);
  const acquire=core.h.acquireCapacity;
  let changedLaunch;
  core.h.acquireCapacity=async function(input){
   const lease=await acquire.call(this,input);
   const launch=c.store.one('SELECT * FROM role_launches WHERE run=?',input.runId);
   changedLaunch=launch;
   c.store.run("UPDATE role_launches SET data=json_remove(data,'$.reviewResolutionInput') WHERE id=?",launch.id);
   return lease;
  };
  try{
   v=await c.resolveChange({workId,model,signal:t.signal});
   assert.equal(v.phase,'BLOCKED');assert.match(v.blocked.join(' '),/review resolution capture changed/);
   const failedRun=JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?',changedLaunch.run).data);
   assert.equal(failedRun.cleanup,'not-allocated');assert.equal(failedRun.containerId,undefined);
  }finally{
   core.h.acquireCapacity=acquire;
   if(changedLaunch)c.store.run('UPDATE role_launches SET data=? WHERE id=?',changedLaunch.data,changedLaunch.id);
  }
  v=await c.driveChange({workId,model,maximumSteps:1,signal:t.signal});assert.equal(v.phase,'REPAIR_REQUIRED',JSON.stringify(v.blocked));assert.equal(v.reviewReady,false);
  const pendingJudge=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",workId);
  const pendingOutput=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",pendingJudge.id);
  assert.ok(pendingOutput);assert.ok(pendingOutput.raw.startsWith('```json\n'));assert.match(pendingOutput.raw,/"resolution":"pending"/);
  assert.ok(JSON.parse(pendingOutput.data).protocol.decisions.every(d=>d.resolution==='pending'));
  const restored=await core.historicalPlanningProducer(workId,pendingOutput.id);
  assert.deepEqual(restored.context.reviewResolutionInput,{version:4});assert.deepEqual(restored.context.subjectActionsInput,{version:2});assert.equal(restored.context.metadataIdentityInput,undefined);
  for(const carry of carries)assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',carry.occurrenceId).data).state,'pending');
  pendingReview=false;
  v=await c.resolveChange({workId,model,signal:t.signal});assert.equal(v.reviewReady,true,JSON.stringify(v.blocked));assert.equal(v.candidateVersion,candidate);
  const repairedJudge=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",workId);
  const repairedOutput=c.store.one("SELECT id FROM role_outputs WHERE launch=? AND status='usable'",repairedJudge.id);
  try{
   c.store.run("UPDATE role_launches SET data=json_remove(data,'$.reviewResolutionInput') WHERE id=?",repairedJudge.id);
   await assert.rejects(core.historicalPlanningProducer(workId,repairedOutput.id),/HISTORICAL_SELECTED_OUTPUT_UNAVAILABLE/);
  }finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',repairedJudge.data,repairedJudge.id);}
  assert.deepEqual((await core.historicalPlanningProducer(workId,repairedOutput.id)).context.reviewResolutionInput,{version:4});
  assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role IN ('implementer','repairer')",workId).n,authorCount,'No fabricated edit or second author run');
  for(const carry of carries)assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',carry.occurrenceId).data).state,'resolved');
  assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),checker);
  receipt.endpoint={phase:v.phase,candidate,planVersion,checks:v.checks.map(x=>({id:x.id,status:x.status})),reviewed,execution:v.execution,resolution:v.resolution};complete=true;
 }finally{
  try{await c?.close();receipt.ownerClosed=true;}finally{receipt.complete=complete;await fs.writeFile(path.join(root,'source-qualified-carry-evidence.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});if(priorTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=priorTemp;console.log('RETAINED_SOURCE_QUALIFIED_WORLD='+root);}
 }
});

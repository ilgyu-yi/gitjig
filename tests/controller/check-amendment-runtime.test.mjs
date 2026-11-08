import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {amendmentModel,wrong,correct} from './check-amendment-fixture.mjs';
import {fixtureRoleText} from '../workflow/current-verification-fixture.mjs';
const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
assert.ok(parent&&path.isAbsolute(parent),'Explicit shared runtime fixture root required');assert.equal(await fs.realpath(parent),parent);
const checkout=await fs.realpath('.');assert.ok(parent!==checkout&&!parent.startsWith(checkout+path.sep),'Runtime fixtures must be outside the checkout');
const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'check-amendment-'))),home=path.join(root,'home'),source=path.join(root,'source');
await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),wrong);process.env.TMPDIR=path.join(home,'artifacts');
const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker',dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
let passedCount=0;after(async()=>{if(passedCount===6)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);});
async function fixture(){assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image);const c=await openController({installationHome:home,runtimeProfile});if(!c.listProjects().length)await c.registerProject({id:'P',sourceRoot:source});const initial=await c.beginChange({projectId:'P',request:'Consumer must export3. Wrong checker expectations do not change this owner requirement.',executionLimit:48,resolutionLimit:24});return{root,home,source,c,workId:initial.workId};}
for(const weak of [false,true])test(weak?'always-green corrected fixture cannot satisfy base-derived adverse witness':'actual wrong fixture failure → corrected fixture → base-derived adverse + healthy → fresh review/final J closes SAME W', {timeout:30000},async()=>{
 const f=await fixture(),{c,workId}=f;let passed=false;
 try{
 const plannerFailureOperands=[];
 const observePlanner=model=>{const originalStream=model.definition.streamSimple;model.definition.streamSimple=(...args)=>{const context=args[1],text=context.messages.find(m=>m.role==='user')?.content.filter(p=>p.type==='text').map(p=>p.text).join('')??'';if(text.startsWith('Perform the assigned planner task')){const body=JSON.parse(text.split('\n')[1]);plannerFailureOperands.push(...(body.context.pendingObligations??[]).filter(o=>o.kind==='check'));}return originalStream(...args);};return model;};let model=observePlanner(amendmentModel({weak}));await c.planChange({workId,model});await c.implementChange({workId,model});let view=await c.checkChange({workId});assert.equal(view.phase,'REPAIR_REQUIRED',JSON.stringify(view.blocked));if(!weak){view=await c.checkChange({workId});assert.equal(view.checks.filter(check=>check.status==='fail').length,2);}const row=c.store.all('SELECT * FROM obligations WHERE work=?',workId).find(row=>JSON.parse(row.data).kind==='check');const old={id:row.id,...JSON.parse(row.data)};assert.ok(old);const consumed=view.execution.consumed;
 await c.repairChange({workId,model});view=await c.checkChange({workId});assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(),/changed\/unknown expectation/);
 if(!weak){const refused=await c.driveChange({workId,model:observePlanner(amendmentModel({wrongReceipt:true})),maximumSteps:1});assert.equal(refused.phase,'BLOCKED');assert.match(refused.blocked.join(),/actual old predicate/);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'pending');}
 view=await c.driveChange({workId,model:weak?model:observePlanner(amendmentModel({invalidResolution:true})),maximumSteps:weak?1:24});if(!weak){assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(),/actual healthy\/adverse witnesses/);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'pending');view=await c.driveChange({workId,model});}if(weak){assert.equal(view.phase,'PLAN_READY',JSON.stringify(view.blocked));assert.ok(view.planVersion);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'pending');view=await c.checkChange({workId});}
 if(weak){assert.equal(view.phase,'REPAIR_REQUIRED');assert.match(view.blocked.join(),/Base-derived probe/);assert.equal(view.reviewReady,false);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'pending');const repaired=await c.driveChange({workId,model:observePlanner(amendmentModel())});assert.equal(repaired.reviewReady,true,JSON.stringify(repaired.blocked));}
 else{assert.equal(view.phase,'REVIEW_READY',JSON.stringify(view.blocked));const probe=view.checks.find(c=>c.data.purpose==='fixture-amendment-negative');assert.ok(probe);assert.notEqual(probe.candidate,view.candidateVersion);assert.equal(probe.data.actual.exitCode,0);assert.equal(probe.data.parsed.value.assertions[0].passed,false);view=await c.driveChange({workId,model});assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));const resolved=JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data);assert.equal(resolved.resolution,'corrected-fixture');assert.equal(c.changeCore.version(view.planVersion).data.amendments[0].old.receipts.length,2);assert.equal(resolved.state,'resolved');assert.ok(resolved.witnesses.includes(probe.id));assert.ok(view.execution.consumed>consumed);assert.equal(view.execution.reserved,0);assert.equal(await fs.readFile(path.join(view.versions.find(v=>v.id===view.candidateVersion).artifact,'check.cjs'),'utf8'),correct);}
 assert.ok(old.failedReceipt);assert.ok(old.boundVersions);assert.ok(plannerFailureOperands.some(o=>o.id===old.id&&JSON.stringify(o.check)===JSON.stringify(old.check)&&o.failedReceipt===old.failedReceipt&&o.checkBinding===old.checkBinding&&JSON.stringify(o.boundVersions)===JSON.stringify(old.boundVersions)&&JSON.stringify(o.expectations)===JSON.stringify(old.expectations)),'Planning must retain exact actual failed-check operands');
 assert.equal(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.equal(await fs.readFile(path.join(f.source,'check.cjs'),'utf8'),wrong);passed=true;
 }finally{await c.close();if(passed)passedCount++;else console.error('Preserved '+f.root);}
});

for (const drift of ['adverse comparison', 'healthy source']) {
 test(`an amendment cannot use a changed ${drift}`, {timeout:30000}, async () => {
  const {c, workId} = await fixture();
  let passed = false;
  try {
   const model = amendmentModel();
   await c.planChange({workId, model});
   await c.implementChange({workId, model});
   assert.equal((await c.checkChange({workId})).phase, 'REPAIR_REQUIRED');
   await c.repairChange({workId, model});
   assert.equal((await c.checkChange({workId})).phase, 'BLOCKED');
   assert.equal((await c.driveChange({workId, model, maximumSteps:1})).phase, 'PLAN_READY');

   const affected = drift === 'adverse comparison'
    ? 'id = NEW.id'
    : "work = NEW.work AND verification = NEW.verification AND status = 'pass' AND json_extract(data, '$.purpose') = 'required'";
   c.store.db.exec(`
    CREATE TEMP TRIGGER alter_amendment_evidence AFTER INSERT ON check_runs
    WHEN json_extract(NEW.data, '$.purpose') = 'fixture-amendment-negative'
    BEGIN
     UPDATE check_runs SET data = json_set(data, '$.caseResults.complete', json('false')) WHERE ${affected};
    END
   `);
   const result = await c.checkChange({workId});
   const adverse = result.checks.find(check => check.data.purpose === 'fixture-amendment-negative');
   assert.equal(adverse?.status, 'fail');
   assert.equal(adverse.data.actual.exitCode, 0);
   assert.equal(result.reviewReady, false);
   if (drift === 'adverse comparison') {
    assert.equal(adverse.data.caseResults.complete, false);
    assert.match(result.blocked.join(), /probe producer unavailable/);
    const diagnostic = c.store.one('SELECT data FROM obligations WHERE id=?', `diagnostic-probe-${adverse.run}`);
    assert.equal(JSON.parse(diagnostic.data).receipt, adverse.id);
   } else {
    assert.equal(adverse.data.caseResults.complete, true);
    const healthy = result.checks.findLast(check => check.candidate === result.candidateVersion &&
     check.verification === adverse.verification && check.check_id === adverse.check_id && check.status === 'pass');
    assert.equal(healthy?.data.caseResults.complete, false);
    assert.match(result.blocked.join(), /lacks actual healthy current candidate/);
   }
   passed = true;
  } finally {
   await c.close();
   if (passed) passedCount++;
  }
 });
}

for (const weak of [false,true]) test('new consumer amendment keeps the old failed check and independently executes a genuine fault: '+weak,{timeout:45000},async()=>{
 const f=await fixture(), {workId}=f;
 let c=f.c, passed=false;
 const consumer='fresh-consumer.cjs', checkedStages=[];
 let repairRequired=false;
 const program=weak?correct.replaceAll("require('./consumer.cjs')",'3'):correct.replaceAll('consumer.cjs',consumer);
 const command="node -e '"+program.replaceAll("'","'\\''")+"'";
 const model=(replacementPath=consumer)=>amendmentModel({caseOnly:true,presentRole({role,result,tool,context}){
  if(tool?.arguments.path==='consumer.cjs')tool.arguments.path=consumer;
  if(role==='repairer' && repairRequired && tool){
   tool.arguments.path=consumer;
   tool.arguments.content="// Explain the exported value.\nmodule.exports=3;\n";
  }
  if(role==='planner'){
   const {verification}=result.plan, [check]=verification.checks;
   check.command=command;check.fixturePaths=[consumer];check.expectationPaths=[];
   check.consumerControl={path:consumer,failedAssertions:[],observations:[]};
   for(const entry of check.cases)entry.consumerPaths=[consumer];
   verification.requiredPaths=[consumer];verification.reviewRoles[0].requiredPaths=[consumer];
   for(const amendment of verification.checkAmendments??[]){
    amendment.negativeAssertions=['three'];
    if(replacementPath)amendment.negativeReplacement={path:replacementPath,text:'module.exports=2;\n'};
   }
  }
  if(context.stage==='consumer-control-proposal'){
   delete result.outcome;
   result.consumerReplacement="module.exports = Number('3');\n";
  }
  if(['fresh-review','review-adjudication'].includes(context.stage)){
   const proof=context.amendmentProofs[0];
   const ids=context.verificationReviewRequirements.flatMap(entry=>entry.witnessIds??[]);
   const probe=context.verificationEvidence.find(entry=>ids.includes(entry.id) && entry.data?.purpose==='fixture-amendment-negative')?.id;
   assert.ok(probe && ids.includes(probe));
   if(proof)assert.equal(probe,proof.probe);
   const control=context.verificationEvidence.find(entry=>entry.kind==='consumer-control-run');
   assert.ok(control && ids.includes(control.healthyReceiptId));
   if(proof)assert.equal(control.healthyReceiptId,proof.healthy);
   if(!weak && context.stage==='fresh-review' && !repairRequired){
    result.outcome='findings';
    result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Explain the exported value in the new file',evidence:['candidate:'+consumer]}];
   }
   if(context.stage==='review-adjudication'){
    const occurrence=context.occurrences.find(entry=>entry.data?.finding?.description==='Explain the exported value in the new file');
    assert.ok(occurrence);
    result.decisions=[{occurrenceId:occurrence.id,disposition:'upheld',resolution:repairRequired?'repaired':'pending',
     reason:repairRequired?'Current source includes the explanation':'The explanation is missing from this candidate',witnesses:repairRequired?[control.healthyReceiptId]:[]}];
    repairRequired=true;
   }
   checkedStages.push(context.stage);
  }
  return fixtureRoleText(result,context);
 }});
 try{
  await c.planChange({workId,model:model()});
  await c.implementChange({workId,model:model()});
  const failing=await c.checkChange({workId});
  assert.equal(failing.phase,'REPAIR_REQUIRED',JSON.stringify(failing.blocked));
  const failed=failing.checks.find(row=>row.status==='fail');
  assert.equal(failed.data.caseResults.mismatches.length,2);
  const refused=await c.planChange({workId,model:model(null)});
  assert.equal(refused.phase,'BLOCKED');
  assert.match(refused.blocked.join(),/BASE amendment probe lacks fixed captured inputs.*fresh-consumer\.cjs/);
  assert.deepEqual(refused.checks.map(row=>row.id),failing.checks.map(row=>row.id));
  if(!weak){
   const foreign=await c.planChange({workId,model:model('consumer.cjs')});
   assert.equal(foreign.phase,'BLOCKED');
   assert.match(foreign.blocked.join(),/declared adverse consumer/);
   assert.deepEqual(foreign.checks.map(row=>row.id),failing.checks.map(row=>row.id));
  }
  const planned=await c.planChange({workId,model:model()});
  assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
  const result=await c.driveChange({workId,model:model(),maximumSteps:weak?2:24});
  const probes=result.checks.filter(row=>row.data.purpose==='fixture-amendment-negative');
  const probe=probes.at(-1);
  assert.equal(probe?.status,weak?'pass':'fail',JSON.stringify(result.blocked));
  const subject=c.changeCore.version(probe.candidate);
  assert.equal(subject.data.recipe,'candidate-consumer-replacement');
  assert.equal(subject.predecessor,result.candidateVersion);
  assert.equal(await fs.readFile(path.join(subject.artifact,consumer),'utf8'),'module.exports=2;\n');
  const pending=()=>JSON.parse(c.store.all('SELECT data FROM obligations WHERE work=?',workId).find(({data})=>JSON.parse(data).failedReceipt===failed.id).data);
  if(weak){
   assert.equal(result.reviewReady,false);
   assert.match(result.blocked.join(),/Candidate-derived probe did not demonstrate exact named adverse/);
   assert.equal(pending().state,'pending');
   assert.deepEqual(checkedStages,[]);
  }else{
   assert.equal(result.reviewReady,true,JSON.stringify(result.blocked));
   assert.deepEqual(checkedStages,['fresh-review','review-adjudication','fresh-review','review-adjudication']);
   assert.equal(probes.length,2);
   assert.notEqual(probes[0].candidate,probe.candidate);
   assert.equal(pending().state,'resolved');
   assert.ok(pending().witnesses.includes(probes[0].id));
   await c.close();c=await openController({installationHome:home,runtimeProfile});
   assert.equal(c.inspectChange(workId).reviewReady,true);
   const original=c.store.one('SELECT data FROM change_versions WHERE id=?',subject.id).data;
   c.store.run("UPDATE change_versions SET data=json_set(data,'$.amendmentBinding','forged') WHERE id=?",subject.id);
   assert.equal(c.inspectChangeResult(workId).reviewReady,false);
   c.store.run('UPDATE change_versions SET data=? WHERE id=?',original,subject.id);
   assert.equal(c.inspectChangeResult(workId).reviewReady,true);
   const accepted=c.store.one('SELECT data FROM change_versions WHERE id=?',result.planVersion).data;
   c.store.run("UPDATE change_versions SET data=json_remove(data,'$.amendments') WHERE id=?",result.planVersion);
   assert.equal(c.inspectChangeResult(workId).reviewReady,false);
   c.store.run('UPDATE change_versions SET data=? WHERE id=?',accepted,result.planVersion);
   assert.equal(c.inspectChangeResult(workId).reviewReady,true);
  }
  await assert.rejects(fs.access(path.join(source,consumer)),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),wrong);
  passed=true;
 }finally{await c.close();if(passed)passedCount++;}
});

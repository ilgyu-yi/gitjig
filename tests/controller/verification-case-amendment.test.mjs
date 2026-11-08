import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';import {amendmentModel,correct} from './check-amendment-fixture.mjs';
const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,image:process.env.GITJIG_RUNTIME_IMAGE};
test('all ordinary assertions true + case-only wrong expected bytes retains actual failure; independent exact declaration amendment proves current C and distinct B probe',{timeout:20000},async()=>{
 assert.ok(runtimeProfile.image&&runtimeProfile.dockerContext&&runtimeProfile.dockerConfigDirectory&&path.isAbsolute(runtimeProfile.dockerConfigDirectory),'Actual explicit runtime with private Docker configuration required');await validateRuntimeProfile(runtimeProfile);const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT??path.resolve('.runtime-fixtures');assert.ok(path.isAbsolute(parent),'Absolute shared runtime fixture root required');await fs.mkdir(parent,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'case-only-amendment-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),correct.replace("require('./consumer.cjs')===3",'true'));process.env.TMPDIR=path.join(home,'artifacts');
 const c=await openController({installationHome:home,runtimeProfile});let success=false;try{
 await c.registerProject({id:'P',sourceRoot:source});const initial=await c.beginChange({projectId:'P',request:'Consumer must export3. A claim of4 must be rejected; case expected value4 is a fixture defect, not an owner requirement.',executionLimit:48,resolutionLimit:24}),workId=initial.workId,model=amendmentModel({caseOnly:true});
 await c.planChange({workId,model});await c.implementChange({workId,model});let v=await c.checkChange({workId});assert.equal(v.phase,'REPAIR_REQUIRED',JSON.stringify(v.blocked));const failed=v.checks.find(r=>r.status==='fail');assert.ok(failed.data.parsed.value.assertions.every(a=>a.passed));assert.equal(failed.data.caseResults.mismatches.length,2);v=await c.checkChange({workId});assert.equal(v.checks.filter(r=>r.status==='fail').length,2);const old=c.store.all('SELECT * FROM obligations WHERE work=?',workId).find(o=>JSON.parse(o.data).kind==='check');assert.equal(JSON.parse(old.data).caseMismatches.length,2);
 let proposedAmendments;
 const observed=new Set(), correction=amendmentModel({caseOnly:true,presentRole({role,result,context}) {
  if(role==='planner'){
   proposedAmendments=result.plan.verification.checkAmendments;
   assert.equal(proposedAmendments[0].obligationId,old.id);
   delete result.plan.verification.checkAmendments;
  }
  if(['planning-challenge','planning-adjudication'].includes(context.stage)){
   observed.add(role);
   assert.match(context.currentProposalDiagnostics.issue,/Planning cannot defer unaccounted obligations/);
   assert.ok(context.currentProposalDiagnostics.issue.includes(old.id));
   assert.equal(context.proposalApproval,undefined);
  }
  if(context.stage==='planning-adjudication')
   result.acceptedPlan={...result.acceptedPlan,verification:{...result.acceptedPlan.verification,checkAmendments:proposedAmendments}};
 }});
 const conversation=c.createConversation({projectId:'P'});
 const review=c.inspectChangeReplan(workId);
 assert.equal(review.kind,'check');
 assert.deepEqual(review.failures.map(failure=>failure.obligationId),[old.id]);
 const replan={conversationId:conversation.conversationId,expectedGeneration:conversation.generation,
  expectedModelRevision:c.getConversationModelChoice(conversation.conversationId).revision,workId,expectedEpoch:v.epoch,
  expectedCheckReplan:review.fingerprint,model:correction};
 const saved=c.store.one('SELECT data FROM check_runs WHERE id=?',review.failures[0].receiptId).data;
 c.store.run("UPDATE check_runs SET data=json_set(data,'$.durationMs',900) WHERE id=?",review.failures[0].receiptId);
 await assert.rejects(c.resumeConversationChange(replan),/check replan changed/);
 assert.equal(observed.size,0);
 assert.deepEqual(c.inspectChange(workId).execution,v.execution);
 assert.deepEqual(c.inspectChange(workId).resolution,v.resolution);
 c.store.run('UPDATE check_runs SET data=? WHERE id=?',saved,review.failures[0].receiptId);
 const originalRuntime=c.options.runtimeProfile;
 c.options.runtimeProfile={...originalRuntime,dockerContext:'changed-after-review'};
 await assert.rejects(c.resumeConversationChange(replan),/check replan changed/);
 assert.equal(observed.size,0);
 assert.deepEqual(c.inspectChange(workId).execution,v.execution);
 assert.deepEqual(c.inspectChange(workId).resolution,v.resolution);
 c.options.runtimeProfile=originalRuntime;
 const planned=await c.resumeConversationChange(replan);
 assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
 assert.deepEqual([...observed],['challenger','adjudicator']);
 v=await c.driveChange({workId,model});assert.equal(v.reviewReady,true,JSON.stringify(v.blocked));const amendment=c.changeCore.version(v.planVersion).data.amendments[0];assert.equal(amendment.old.receipts.length,2);assert.equal(amendment.old.obligation.failedReceipt,JSON.parse(old.data).failedReceipt);assert.deepEqual(amendment.old.obligation.caseMismatches,JSON.parse(old.data).caseMismatches);assert.deepEqual(amendment.fixturePaths,[]);assert.deepEqual(amendment.negativeAssertions,[]);assert.deepEqual(amendment.caseIds,['value-healthy','value-adverse']);const probe=v.checks.find(r=>r.data.purpose==='fixture-amendment-negative');assert.equal(probe.status,'fail');assert.equal(probe.data.caseResults.complete,true);assert.ok(probe.data.parsed.value.assertions.every(a=>a.passed));assert.deepEqual(probe.data.caseResults.mismatches.map(m=>m.id),amendment.negativeCaseIds);assert.notEqual(probe.candidate,v.candidateVersion);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'resolved');success=true;
 }finally{await c.close();if(success)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);}
});

import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {wholeJsonFence} from '../../dist/workflow/json.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker',dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};

// A single isolated test-file owner preserves Pi's process-bound artifact root.
export async function reviewInputBoundary(boundary,{subjectActions=false,bodyVersion=6}={}){
 assert.ok(['capacity-body','capacity-metadata','settled-capture','settled-criteria',...(subjectActions?['adoption']:[])].includes(boundary));const capacity=boundary.startsWith('capacity-'),currentCriteria=boundary==='settled-criteria';
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned runtime required');const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;assert.ok(parent&&path.isAbsolute(parent));assert.equal(await fs.realpath(parent),parent);const checkout=await fs.realpath('.');assert.ok(parent!==checkout&&!parent.startsWith(checkout+path.sep));
 const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'review-input-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.chmod(root,0o700);await fs.mkdir(source);const previousTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');console.log('RETAINED_REVIEW_INPUT_WORLD='+root);
 const checker=withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3,actual:String(value)}]}));\n");await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),checker);
 let c,complete=false,restoredCapture,originalCriteria,core,originalBundle,originalAcquire,originalDiagnose,roleCore,originalRole;const receipt={boundary,subjectActions,bodyVersion,root,home,learnedModel:false,scope:'Scripted judgments; real Controller, SDK, immutable candidate, Docker check and selected independent review; input drift is injected only at the named boundary.'};
 try{
  c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});const {workId}=await c.beginChange({projectId:'P',request:'Consumer must export3; preserve checker and original source.',executionLimit:16,resolutionLimit:8});receipt.workId=workId;let finalCalls=0;
  if(!currentCriteria){
   // These retained controls intentionally exercise the historical subject wire.
   roleCore=c.changeCore;originalRole=roleCore.role;
   roleCore.role=function(options,role,context,...rest){
    const reviewJudge=role==='adjudicator'&&context.stage==='review-adjudication';
    return originalRole.call(this,options,role,reviewJudge?{...context,subjectActionsInput:{version:1},
     ...(bodyVersion===3?{findingBodyInput:{version:3}}:{})}:context,...rest);
   };
  }
  const model=scripted(undefined,({role,body,result,context})=>{
   if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original BASE exports2 instead of3',evidence:['base:consumer.cjs']}];
   if(role==='adjudicator'&&body.context.stage==='planning-adjudication'){assert.equal(body.context.historicalProvenanceInput.version,2);assert.deepEqual(body.context.findingBodyInput,{version:5});result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'Actual baseline must be implemented against current R1; original exact explanation retained. '.repeat(16),witnesses:['base:consumer.cjs'],implementation:{kind:'assign-to-plan',baselineVersion:body.context.baseVersion,requirementIds:['R1']}}));}
   if(role==='adjudicator'&&body.context.stage==='review-adjudication'){
    finalCalls++;assert.equal(body.context.historicalProvenanceInput.version,1);assert.deepEqual(body.context.historicalRequirementsInput,{version:1});assert.deepEqual(body.context.latestDispositionInput,{version:1});assert.ok(body.context.latestDispositionView);assert.ok(body.context.dispositions.every(d=>!Object.hasOwn(d.data,'reason')&&!Object.hasOwn(d.data,'witnesses')));const servedSystem=context.systemPrompt??context.messages.filter(m=>m.role==='system').map(m=>[m.content,...Object.values(m.sections??{})].join('\n')).join('\n');if(bodyVersion===3)assert.match(servedSystem,/findingBodyInput version3/);else assert.match(servedSystem,/Current adjudication bodies are attached directly/);assert.match(servedSystem,/version2 dispositionHistory/);assert.doesNotMatch(servedSystem,/version1 dispositionHistory/);if(body.context.historicalPlanningOperands?.planBodyEncoding)assert.match(servedSystem,/version3 review-stage historicalPlanningOperands/);assert.deepEqual(body.context.findingBodyInput,{version:bodyVersion});assert.deepEqual(body.context.metadataIdentityInput,currentCriteria?undefined:{version:3});assert.deepEqual(body.context.subjectActionsInput,{version:currentCriteria?2:1});assert.equal(body.context.dispositionHistory.version,2);assert.equal(body.context.historicalPlansInput.version,3);
    result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',resolution:'repaired',reason:'Actual candidate, current checker and distinct selected review establish this remedy',witnesses:body.context.checks.filter(x=>x.status==='pass'&&x.candidate===body.context.candidateVersion).map(x=>x.id)}));
    if(subjectActions){const keys=new Map(body.context.subjectActionsView.subjects.map(row=>[row.occurrenceId,row.key]));result.decisionActions=Object.fromEntries(result.decisions.map(({occurrenceId,...decision})=>[keys.get(occurrenceId),decision]));result.subjectActionsHash=body.context.subjectActionsView.responseHash;delete result.decisions;}
   }
  });
  const selected=await c.driveChange({workId,model,maximumSteps:4});assert.equal(selected.phase,'RESOLVING',JSON.stringify(selected.blocked));assert.equal(selected.checks.filter(x=>x.status==='pass').length,1);assert.equal(selected.launches.filter(x=>x.role==='reviewer'&&x.status==='COMPLETE').length,1);assert.equal(selected.occurrences.length,1);assert.equal(finalCalls,0);
  const candidate=selected.candidateVersion,dispositions=c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid');
  const criteriaLedger=()=>Object.fromEntries(['check_runs','obligations','conversation_directions'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
  const beforeCriteriaEffects=currentCriteria?criteriaLedger():undefined;
  core=c.changeCore;originalBundle=core.bundle;originalAcquire=core.h.acquireCapacity;originalDiagnose=core.prevalidateDiagnoses;let current,injected=false;
  core.bundle=async function(work,context,...rest){const result=await originalBundle.call(this,work,context,...rest);if(work===workId&&context.stage==='review-adjudication')current=result.bundle;return result;};
  if(capacity)core.h.acquireCapacity=async function(...args){const lease=await originalAcquire.apply(this,args);if(current&&!injected){if(subjectActions){current.context.subjectActionsView={...current.context.subjectActionsView,implementationBaseVersion:'CHANGED-DURING-CAPACITY'};}else if(boundary==='capacity-metadata'){assert.deepEqual(current.context.metadataIdentityInput,{version:3});current.context.checks[0].data.inputHash='0'.repeat(64);}else current.context.occurrences[0].data.finding.description+=' changed during await';injected=true;}return lease;};
  else if(boundary==='settled-criteria')core.prevalidateDiagnoses=async function(work,judge){
   const result=await originalDiagnose.call(this,work,judge);
   const launch=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId);
   assert.equal(launch.status,'COMPLETE');
   assert.doesNotThrow(judge.assertInputCurrent);
   const criteria=JSON.parse(launch.data).workflowCriteria.current.id;
   originalCriteria=c.store.one('SELECT * FROM change_versions WHERE id=? AND work=?',criteria,work);
   assert.ok(originalCriteria);
   const data=JSON.parse(originalCriteria.data);
   c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify({...data,text:data.text+'\nChanged after the original diagnosis.\n'}),criteria);
   assert.throws(judge.assertInputCurrent,/Original workflow criteria source changed after capture/);
   receipt.criteriaDrift={launch:launch.id,run:launch.run,criteria};
   injected=true;
   return result;
  };
  else if(boundary!=='adoption')core.prevalidateDiagnoses=async function(work,judge){const result=await originalDiagnose.call(this,work,judge);await Promise.resolve();const row=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.launchId),data=JSON.parse(row.data);assert.equal(row.status,'COMPLETE');assert.match(data.findingBodyHash,/^[a-f0-9]{64}$/);restoredCapture=row;for(const key of ['dispositionHistoryInput','historicalPlansInput','dispositionHistory','historicalProvenanceInput']){assert.ok(data[key]);c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,[key]:{...data[key],id:'00000000-0000-4000-8000-000000000000'}}),row.id);assert.throws(judge.assertInputCurrent,/role input evidence declaration changed/i);c.store.run('UPDATE role_launches SET data=? WHERE id=?',row.data,row.id);assert.doesNotThrow(judge.assertInputCurrent);}c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,...(subjectActions?{subjectActionCaptureHash:'0'.repeat(64)}:{findingBodyHash:'0'.repeat(64)})}),row.id);injected=true;return result;};
  const held=await c.resolveChange({workId,model});
  assert.equal(held.candidateVersion,candidate);assert.equal(held.execution.reserved,0);assert.equal(held.resolution.reserved,0);assert.equal(held.execution.consumed,selected.execution.consumed+1);
  if(boundary==='adoption'){
   assert.equal(held.phase,'REVIEW_READY',JSON.stringify(held.blocked));assert.equal(finalCalls,1);assert.equal(injected,false);
   const judgment=c.store.one("SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role='adjudicator' ORDER BY o.rowid DESC LIMIT 1",workId),metadata=JSON.parse(judgment.data),raw=JSON.parse(wholeJsonFence(judgment.raw)?.body??judgment.raw);
   assert.ok(raw.decisionActions);assert.equal(raw.decisions,undefined);assert.equal(metadata.protocol.decisions.length,selected.occurrences.length);assert.ok(metadata.protocol.decisions.every(row=>row.resolution==='repaired'));
   assert.equal(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid').length,dispositions.length+selected.occurrences.length);
   const origin=await core.historicalPlanningProducer(workId,judgment.id);origin.assertCurrent();assert.equal(origin.context.metadataIdentityInput.version,3);
   receipt.encodedRawSha256=(await import('node:crypto')).createHash('sha256').update(judgment.raw).digest('hex');
  }else{
   const refusal=currentCriteria?/HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE/:subjectActions?/subject action|subject view/i:
    boundary==='capacity-metadata'?/metadata identity capture changed/i:/finding bodies changed/i;
   assert.equal(injected,true,JSON.stringify(held.blocked));assert.equal(held.phase,'BLOCKED');assert.match(held.blocked.join(),refusal);
   assert.equal(finalCalls,capacity?0:1);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions ORDER BY rowid'),dispositions);assert.equal(JSON.parse(c.store.one('SELECT data FROM change_state WHERE work=?',workId).data).verificationJudge,null);
   if(currentCriteria)assert.deepEqual(criteriaLedger(),beforeCriteriaEffects);
  }
  assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),checker);
  Object.assign(receipt,{phase:held.phase,candidate,finalCalls,budgets:{execution:held.execution,resolution:held.resolution},blocked:held.blocked});
  if(boundary==='settled-capture'){
   c.store.run('UPDATE role_launches SET data=? WHERE id=?',restoredCapture.data,restoredCapture.id);restoredCapture=null;core.bundle=originalBundle;core.h.acquireCapacity=originalAcquire;core.prevalidateDiagnoses=originalDiagnose;
   const records=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId),planner=records.find(row=>row.role==='planner'),judge=records.at(-1),selectedOutput=id=>c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",id);
   const oldOutput=selectedOutput(planner.id),newOutput=selectedOutput(judge.id);assert.ok(oldOutput&&newOutput);assert.deepEqual(JSON.parse(planner.data).metadataIdentityInput,{version:1});assert.deepEqual(JSON.parse(judge.data).metadataIdentityInput,{version:3});
   await c.close();c=await openController({installationHome:home,runtimeProfile});core=c.changeCore;
   const old=await core.historicalPlanningProducer(workId,oldOutput.id),current=await core.historicalPlanningProducer(workId,newOutput.id);old.assertCurrent();current.assertCurrent();assert.equal(old.context.metadataIdentityInput.version,1);assert.equal(current.context.metadataIdentityInput.version,3);assert.equal(current.witness.initialView.metadataIdentities.version,3);assert.deepEqual(current.witness.initialView.latestDispositionExplanations,{version:1,delivery:'read-bound'});assert.ok(current.context.latestDispositionView);assert.deepEqual(current.context.historicalRequirementsInput,{version:1});assert.equal(current.context.historicalProvenanceInput.version,1);assert.deepEqual(current.witness.initialView.historicalCustody,{version:1,delivery:current.context.historicalPlanningOperands?.producerProvenance?'read-bound':'literal'});assert.equal(c.inspectChange(workId).candidateVersion,candidate);
   const captured=c.store.one('SELECT * FROM role_launches WHERE id=?',judge.id),data=JSON.parse(captured.data);try{c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,metadataIdentityHash:'0'.repeat(64)}),judge.id);await assert.rejects(core.historicalPlanningProducer(workId,newOutput.id),/HISTORICAL_INITIAL_INPUT_UNAVAILABLE/);}finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',captured.data,judge.id);}const restored=await core.historicalPlanningProducer(workId,newOutput.id);restored.assertCurrent();receipt.sameProcessReopen={oldVersion:1,newVersion:3,identityCaptureMutationRefused:true};
   originalBundle=core.bundle;originalAcquire=core.h.acquireCapacity;originalDiagnose=core.prevalidateDiagnoses;
  }
  complete=true;
 }finally{
  if(roleCore)roleCore.role=originalRole;
  if(originalCriteria)c.store.run('UPDATE change_versions SET data=? WHERE id=?',originalCriteria.data,originalCriteria.id);
  if(core){core.bundle=originalBundle;core.h.acquireCapacity=originalAcquire;core.prevalidateDiagnoses=originalDiagnose;if(restoredCapture)c.store.run('UPDATE role_launches SET data=? WHERE id=?',restoredCapture.data,restoredCapture.id);}
  try{await c?.close();receipt.ownerClosed=true;}catch(error){complete=false;receipt.cleanupError=String(error);throw error;}finally{receipt.complete=complete;await fs.writeFile(path.join(root,'review-input-evidence.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;}
 }
}

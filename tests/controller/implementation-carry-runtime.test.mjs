import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('owned normal BASE carry preserves invalid optional raw duplicates and closes only after actual changed candidate/check/review',{timeout:60000},async()=>{
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned runtime required; unavailable is not PASS');
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/base-carry-058-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);process.env.TMPDIR=path.join(home,'artifacts');console.log('RETAINED_058_WORLD='+root);
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3,actual:String(value)}]}));\n"));
 let c,workId,complete=false,primaryError=null;const receipt={version:'gitjig-owned-base-carry-evidence/v1',root,home,complete:false,learnedModel:false,transport:'scripted official SDK streams; no HTTP provider configured',retained:true};
 try{
  c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});
  const initial=await c.beginChange({projectId:'P',request:'Consumer must export3. A true original baseline defect stays open until actual implementation and review.',executionLimit:32,resolutionLimit:12});workId=initial.workId;receipt.workId=workId;
  const rawClaim={requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'Bound original consumer exports2 while the owner requires3',evidence:['Actual base:consumer.cjs bytes export2'],mechanicalPatch:null};
  let mode='invalid-producer',planningPayloads=0,finalJudgments=0;
  const model=scripted(undefined,({role,body,result})=>{
   if(role==='planner'&&mode==='invalid-producer'){result.findings=[rawClaim];return;}
   if(role==='adjudicator'&&body.context.stage==='planning-adjudication'){
    planningPayloads++;const occurrences=body.context.occurrences;assert.equal(occurrences.length,2);assert.ok(occurrences.every(o=>o.data.finding.mechanicalPatch===null));
    const target=occurrences[0].id;result.decisions=occurrences.map(o=>({occurrenceId:o.id,disposition:o.id===target?'upheld':'equivalent',...(o.id===target?{}:{equivalentTo:target}),reason:'Same actual BASE export2 defect remains valid and is an implementation remedy under the original export3 requirement',witnesses:['base:consumer.cjs']}));
    result.implementationCarries=occurrences.map(o=>({occurrenceId:o.id,baselineVersion:body.context.baseVersion,requirementIds:['R1'],reason:'Historical owner-request maps to accepted R1 under the same retained owner source; the accepted consumer export3 plan remedies this bound BASE defect. Invalid optional patch is no mechanical authority.'}));
   }
   if(role==='implementer'&&!receipt.plan){
    const admitted=c.inspectChange(workId);assert.equal(admitted.phase,'PLAN_READY');assert.equal(admitted.candidateVersion,null);assert.equal(admitted.reviewReady,false);
    const accepted=c.changeCore.version(admitted.planVersion),carries=accepted.data.implementationCarries;assert.equal(carries.length,2);assert.ok(carries.every(item=>item.historicalRequirementId==='owner-request'&&item.requirementIds.includes('R1')&&item.originLaunchId!==item.planningJudge));
    for(const carry of carries)assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',carry.occurrenceId).data).state,'pending');
    receipt.plan={id:admitted.planVersion,hash:accepted.hash,decisionLaunch:accepted.data.decisionLaunch,requirementsVersion:c.changeCore.row(workId).data.requirementVersion,criteriaVersion:c.changeCore.row(workId).data.contractsVersion,carries};
    receipt.beforeAuthor={phase:admitted.phase,candidateVersion:admitted.candidateVersion,reviewReady:admitted.reviewReady,pendingOccurrenceIds:carries.map(item=>item.occurrenceId)};
   }
   if(role==='adjudicator'&&body.context.stage==='review-adjudication'){
    finalJudgments++;const occurrences=body.context.occurrences,target=occurrences[0].id,checks=body.context.checks.filter(check=>check.status==='pass'&&check.candidate===body.context.candidateVersion).map(check=>check.id);assert.ok(checks.length);
    result.decisions=occurrences.map(o=>({occurrenceId:o.id,disposition:o.id===target?'upheld':'equivalent',...(o.id===target?{resolution:'repaired'}:{equivalentTo:target}),reason:'Actual changed candidate exports3 and current paired consumer checks plus fresh independent review establish repair; duplicate retains its original identity',witnesses:checks}));
   }
  });
  const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');assert.equal(first.planVersion,null);
  const second=await c.driveChange({workId,model,maximumSteps:1});assert.equal(second.phase,'BLOCKED');assert.equal(second.planVersion,null);
  const oldOccurrences=c.store.all('SELECT * FROM finding_occurrences WHERE work=?',workId);assert.equal(oldOccurrences.length,2);
  const oldOutputs=oldOccurrences.map(o=>c.store.one('SELECT * FROM role_outputs WHERE id=?',o.output));assert.ok(oldOutputs.every(o=>o.status==='unusable'));for(const output of oldOutputs)assert.equal(parseRoleOutput(output.raw,'planner').value,null);
  const oldSnapshots=oldOutputs.map(row=>({id:row.id,bytes:JSON.stringify(row),sha256:sha(JSON.stringify(row))}));const occurrenceSnapshots=oldOccurrences.map(row=>({id:row.id,bytes:JSON.stringify(row),sha256:sha(JSON.stringify(row))}));
  const conversation=c.listConversations().find(v=>v.workId===workId);assert.ok(conversation);receipt.direction=await c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:conversation.generation,text:'The original export3 requirement remains unchanged. Independently account for both raw BASE findings; no optional patch or producer completion is authorized.',mode:'idle'});
  mode='explicit-carry';receipt.baseline={id:initial.baseVersion,hash:c.changeCore.version(initial.baseVersion).hash};
  const view=await c.driveChange({workId,model,maximumSteps:24});assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));assert.equal(planningPayloads,1);assert.equal(finalJudgments,1);assert.ok(receipt.plan);
  const candidate=c.changeCore.version(view.candidateVersion);assert.notEqual(candidate.hash,receipt.baseline.hash);assert.equal(await fs.readFile(path.join(candidate.artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
  assert.ok(view.checks.some(check=>check.status==='pass'&&check.candidate===view.candidateVersion));
  const obligations=oldOccurrences.map(o=>({id:o.id,...JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',o.id).data)}));assert.ok(obligations.every(o=>o.state==='resolved'));assert.equal(obligations.filter(o=>o.disposition==='equivalent').length,1);
  for(const row of oldSnapshots)assert.equal(JSON.stringify(c.store.one('SELECT * FROM role_outputs WHERE id=?',row.id)),row.bytes);for(const row of occurrenceSnapshots)assert.equal(JSON.stringify(c.store.one('SELECT * FROM finding_occurrences WHERE id=?',row.id)),row.bytes);
  receipt.oldOutputs=oldSnapshots.map(({id,sha256})=>({id,sha256,status:'unusable'}));receipt.oldOccurrences=occurrenceSnapshots.map(({id,sha256})=>({id,sha256}));receipt.candidate={id:view.candidateVersion,hash:candidate.hash};receipt.checks=view.checks.map(check=>({id:check.id,status:check.status,candidate:check.candidate,verification:check.verification}));receipt.reviewLaunches=view.launches.filter(l=>l.role==='reviewer'||l.role==='adjudicator').map(l=>({id:l.id,role:l.role,status:l.status,stage:l.data.stage,historyRef:l.data.historyRef,inputVersions:l.data.inputVersions}));receipt.dispositions=view.dispositions;receipt.obligations=obligations;receipt.finalPhase=view.phase;receipt.reviewReady=view.reviewReady;receipt.budget={execution:view.execution,resolution:view.resolution};
  const histories=[];for(const launch of view.launches){const ref=launch.data.historyRef;if(ref){const bytes=await fs.readFile(ref);histories.push({launchId:launch.id,file:ref,bytes:bytes.length,sha256:sha(bytes)});}}receipt.histories=histories;complete=true;
 }catch(error){primaryError=error;throw error;}finally{
  try{await c?.close();receipt.ownerClosed=true;}catch(error){receipt.ownerClosed=false;receipt.cleanupError=String(error);complete=false;if(!primaryError)throw error;}finally{
   receipt.complete=complete&&receipt.ownerClosed;receipt.error=primaryError?String(primaryError):null;receipt.source={file:fileURLToPath(import.meta.url),sha256:sha(await fs.readFile(fileURLToPath(import.meta.url)))};const ledger=path.join(home,'state/controller.sqlite');try{const bytes=await fs.readFile(ledger);receipt.ledger={file:ledger,bytes:bytes.length,sha256:sha(bytes)};}catch(error){receipt.ledgerUnavailable=String(error);receipt.complete=false;}
   await fs.writeFile(path.join(root,'evidence-index.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log('RETAINED_058_EVIDENCE='+path.join(root,'evidence-index.json'));if(!receipt.complete&&!primaryError)throw Error('Retained evidence index or owner cleanup is incomplete');
  }
 }
});

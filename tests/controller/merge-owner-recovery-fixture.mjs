import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {freeze,hash} from '../../dist/controller/change-files.js';
import {subject} from './merge-controller-fixture.mjs';
import {scripted} from './effect-fixture.mjs';
export async function recoveredMerge(t,options={}){
 const {candidate=false,beforeOriginal,...nativeOptions}=options,f=await subject(t,nativeOptions);if(candidate){
  // Declared successful-standing metadata over a real frozen native candidate,
  // solely for owner recovery mechanics. Actual procedure qualification is separate.
  const branch=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.branchOperationId),data=JSON.parse(branch.data),artifact=path.join(f.home,'inputs','controlled-owner-merge-candidate'),receipt=await freeze(f.native.checkout,artifact,JSON.parse(f.c.store.one("SELECT profile FROM projects WHERE id='P'").profile)),version=f.c.changes.newVersion(f.workId,'candidate',artifact,{manifest:receipt.manifest,producer:'controlled-standing'},receipt.digest),evidence={...data.evidence,versions:{...data.evidence.versions,candidate:version},candidateDigest:receipt.digest};
  const fingerprint=()=>{const {fingerprint,...value}=evidence;evidence.fingerprint=hash(value);};fingerprint();f.evidence=evidence;f.refreshEvidence=()=>{const work=f.c.store.one('SELECT epoch,generation FROM works WHERE id=?',f.workId);evidence.epoch=work.epoch;evidence.generation=work.generation;fingerprint();};f.c.changes.currentEvidence=async()=>structuredClone(evidence);f.c.changes.assertCurrentEvidence=value=>assert.deepEqual(value,evidence);
  const source=randomUUID(),request={workId:f.workId,targetId:branch.target,mode:'ordinary',scope:'work',operationLimit:1};f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)',source,null,JSON.stringify({kind:'owner-effect-grant',uid:process.getuid?.(),root:f.workId}),JSON.stringify(request));f.c.store.run("UPDATE effect_delegations SET data=json_set(data,'$.source',?) WHERE id=?",source,branch.grant_id);f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...data,evidence,grantEpoch:1,rootEpoch:1}),branch.id);
 }f.grant();beforeOriginal?.(f);const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);if(options.sent)await f.c.dispatchMerge(original.operationId);await f.c.cancelWork({workId:f.workId});const cancelled=f.c.inspectWork(f.workId);
 // Actual public original revival; successful procedure drive is controlled only
 // for grant-history/admission mechanics. Real workflow qualification is separate.
 f.c.options.runtimeProfile={dockerBinary:'/not-launched',dockerContext:'not-launched',image:'sha256:'+'0'.repeat(64)};const drive=f.c.changes.drive;let calls=0;f.c.changes.drive=async()=>{calls++;return f.c.inspectChange(f.workId);};const conversation=f.c.createConversation({projectId:'P'}).conversationId,view=f.c.inspectConversation(conversation),choice=f.c.getConversationModelChoice(conversation);
 await f.c.resumeConversationChange({conversationId:conversation,expectedGeneration:view.generation,expectedModelRevision:choice.revision,workId:f.workId,expectedEpoch:cancelled.epoch,resumeCancelled:true,maximumSteps:1,model:scripted()});assert.equal(calls,1);f.c.changes.drive=drive;f.refreshEvidence?.();
 return {...f,original,conversation,renew(validate=()=>{}){const context=f.c.inspectMergeGrantRenewal(f.workId,f.targetId);return f.c.renewOwnerMerge({workId:f.workId,targetId:f.targetId,expectedContext:context.fingerprint,reason:'Owner explicitly renews the same finite merge ceiling after original revival'},validate);},reauthorize(validate=()=>{},signal){const context=f.c.inspectMergeReauthorization(original.operationId);return f.c.reauthorizeOwnerMerge({operationId:original.operationId,expectedContext:context.fingerprint,reason:'Explicit same-original current candidate reauthorization',...signal?{signal}:{}},validate);}};
}

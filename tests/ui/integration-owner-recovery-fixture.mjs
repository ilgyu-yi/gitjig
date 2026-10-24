import assert from 'node:assert/strict';
import {candidateWorld,capturedSubject} from './integration-prepare-fixture.mjs';
export async function ownerRecoveryWorld(t,{initialized=false,hosted=false}={}){
 const f=await candidateWorld(t);
 if(hosted){
  const {fixture,policyFixture}=await import('../controller/hosted-integration-fixture.mjs'),{configureOwnedNormalHostedIntegrationFixture}=await import('../../.qualification/controller-testing.js'),{default:fs}=await import('node:fs/promises');
  const native=await fixture({files:{'file.txt':'Original source'}}),rest=await policyFixture(native,{normalNative:true});let passed=false;const pass=f.pass;f.pass=()=>{passed=true;pass();};t.after(async()=>{await f.c.close();await Promise.all([native.close(),rest.close()]);if(passed)await fs.rm(native.root,{recursive:true,force:true});else t.diagnostic('Retained hosted owner-recovery fixture: '+native.root);});
  const configure=token=>configureOwnedNormalHostedIntegrationFixture(f.c,{token,origin:rest.origin,https:{origin:native.origin,caFile:native.ca,execPath:native.execPath}});configure(native.token);
  const target=(await f.c.registerHostedIntegrationTarget({projectId:'P',repository:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},expectedUserId:7,ref:'refs/heads/main',basisCommit:native.B,publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']})).targetId;
  f.c.delegateHostedIntegration({workId:f.op.workId,targetId:target,mode:'ordinary',operationLimit:4});f.op={workId:f.op.workId,targetId:target,operationId:f.c.effects.allocate(f.op.workId,target,f.evidence)};f.target=target;f.native=native;f.rest=rest;
 }
 if(initialized){const context=f.c.inspectIntegrationPreparation(f.op.operationId);const outcome=await f.c.prepareRetainedIntegration({...f.op,model:f.model,expectedContext:context.contextFingerprint});assert.equal(outcome.phase,'RESERVED',JSON.stringify(outcome));}
 capturedSubject(f);f.c.installApplicationModelResolver({resolveRole(){throw Error('Successful-procedure fixture must not resolve a model');},resolveConversation(){throw Error('Recovery must not dispatch chat');}},{resumeAuthorized:false});
 const conversation=f.c.createConversation({projectId:'P'}).conversationId;await f.c.cancelWork({workId:f.op.workId});const cancelled=f.c.inspectWork(f.op.workId);assert.equal(cancelled.state,'CANCELLED');
 // Original public recovery is real. Its drive boundary is controlled, and
 // current successful-procedure evidence below is an explicit fixture.
 f.c.options.runtimeProfile={dockerBinary:'/not-launched',dockerContext:'not-launched',image:'sha256:'+'0'.repeat(64)};let drives=0;f.c.changes.drive=async()=>{drives++;return f.c.inspectChange(f.op.workId);};
 const view=f.c.inspectConversation(conversation),choice=f.c.getConversationModelChoice(conversation);
 await f.c.resumeConversationChange({conversationId:conversation,expectedGeneration:view.generation,expectedModelRevision:choice.revision,workId:f.op.workId,expectedEpoch:cancelled.epoch,resumeCancelled:true,maximumSteps:1});assert.equal(drives,1);
 const current=f.c.store.one('SELECT epoch,generation FROM works WHERE id=?',f.op.workId);f.evidence.epoch=current.epoch;f.evidence.generation=current.generation;
 return {...f,conversation,renew(){const context=f.c.inspectIntegrationGrantRenewal(f.op.workId,f.target);assert.equal(context.eligible,true,JSON.stringify(context.holds));return f.c.renewOwnerIntegration({workId:f.op.workId,targetId:f.target,expectedContext:context.fingerprint,reason:'Owner explicitly renews the same finite grant after original recovery'},()=>{});},reauthorize(){const context=f.c.inspectIntegrationReauthorization(f.op.operationId);return f.c.reauthorizeOwnerIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint,reason:'Owner reauthorizes the same definitely-unsent original'},()=>{});}};
}

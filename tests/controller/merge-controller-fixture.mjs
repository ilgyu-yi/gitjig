import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedContributionFixture,configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {mergeFixture} from '../platform/merge-fixture.mjs';

// Controlled current-procedure and previously confirmed branch premises isolate
// this controller admission/ledger/HTTP boundary. These are NOT evidence of
// actual agent procedures, hosted publication or installed goal completion.
export async function subject(t,options={}){
 const {registerMerge=true,...nativeOptions}=options;
 const native=await mergeFixture(t,nativeOptions),source=path.join(native.root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'value.cjs'),'module.exports=2;\n');
 const c=await openController({installationHome:path.join(native.root,'home')});t.after(()=>c.close());await c.registerProject({id:'P',sourceRoot:source});
 const work=await c.beginChange({projectId:'P',request:'Export three, publish and merge this exact PR',executionLimit:20,resolutionLimit:8});
 const evidence={workId:work.workId,epoch:1,generation:1,fingerprint:'controlled-current-standing',versions:{candidate:'controlled-native-candidate'},candidateDigest:'controlled-real-head-tree'};
 let current=true;c.changes.currentEvidence=async()=>{assert.ok(current,'Controlled current-standing premise');return structuredClone(evidence);};c.changes.assertCurrentEvidence=snapshot=>{if(!current||snapshot.fingerprint!==evidence.fingerprint)throw Error('Controlled current evidence changed');};
 const target=randomUUID(),grant=randomUUID(),operation=randomUUID(),repository=native.subject.target;
 c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',target,'P',JSON.stringify({kind:'github-existing-ref',repository,expectedUserId:7,target:{host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',ref:'refs/heads/feature/path'},basisCommit:native.subject.expectedBase,publicationInventory:['value.cjs'],authorizedDeltaPaths:['value.cjs']}));
 configureOwnedContributionFixture(c,{token:'owned-native-merge-only',origin:native.origin});configureOwnedMergeFixture(c,{token:'owned-native-merge-only',origin:native.origin,limits:{requestTimeoutMs:2000}});
 const resource=await c.trackRepositoryResource({repository:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9'},kind:'pull-request',number:12});
 const resourceId=resource.resourceId??resource.id;
 assert.ok(resourceId,JSON.stringify(resource));
 const registration={resourceId,sourceBranchTargetId:target,baseRef:'main'};
 const registered=registerMerge?await c.registerMergeTarget(registration):null;
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,0,'Target registration precedes publication and grants no standing');
 c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',grant,work.workId,target,1,JSON.stringify({kind:'github-existing-ref',mode:'ordinary',scope:'work',operationLimit:1,rootEpoch:1,projectId:'P'}));
 c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',operation,work.workId,target,grant,'CONFIRMED',JSON.stringify({kind:'github-existing-ref',evidence,integrationCommit:native.subject.expectedHead,tree:native.subject.expectedTree}));

 return {c,native,workId:work.workId,home:path.join(native.root,'home'),registration,targetId:registered?.targetId,branchOperationId:operation,invalidate:()=>{current=false;},grant:()=>c.delegateMerge({workId:work.workId,targetId:registered?.targetId,operationLimit:1,notifications:'allow-merge-notifications'})};
}

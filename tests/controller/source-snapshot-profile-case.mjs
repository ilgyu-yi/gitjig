import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';

// Called only after the original normal procedure has spent eight real units.
export async function qualifySourceProfile({controller,options,root,workId,git,setup,head,index,sourceBytes,status,source}) {
 let c=controller;
 const profile={gitBinary:git},selected={profile};
 const ledger=()=>JSON.stringify(['works','runs','budgets','effect_targets','effect_delegations','effect_operations','effect_receipts'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
 const priorWork=c.store.one('SELECT * FROM works WHERE id=?',workId),priorEvidence=await c.changeCore.currentEvidence(workId);
 delete options.effectsProfile;c.options.effectsProfile=undefined;
 try {
  const preparing=c.prepareSourceSnapshot({workId,destinationBranch:'profile-snapshot'},selected);
  profile.gitBinary='/bin/false';selected.profile={gitBinary:'/bin/false'};
  const prepared=await preparing;assert.equal(prepared.kind,'prepared',prepared.reason);assert.equal(c.options.effectsProfile,undefined);
  const row=c.store.one('SELECT * FROM change_versions WHERE id=?',prepared.proposalId),body=JSON.parse(await fs.readFile(row.artifact,'utf8'));
  const originalProfile={profile:{gitBinary:git}},request={workId,proposalId:prepared.proposalId};
  const publication=await c.openSourceSnapshotPublication({...request,expectedArtifactHash:row.hash});assert.equal((await publication.readFile({path:'consumer.cjs'})).text,'module.exports=3;\n');await publication.close();
  const unchanged=ledger();await assert.rejects(c.sourceActions.review(request),/Explicit trusted/);assert.equal(ledger(),unchanged);
  const bad=await c.prepareSourceSnapshot({workId,destinationBranch:'bad-profile'},{profile:{gitBinary:'/bin/false',commandTimeoutMs:0}});assert.equal(bad.kind,'held');assert.match(bad.reason,/Finite trusted/);assert.equal(ledger(),unchanged);
  const reviewing=c.sourceActions.review(request,originalProfile),otherReview=c.sourceActions.review(request,{profile:{gitBinary:git,commandTimeoutMs:2345}});void otherReview.catch(()=>{});originalProfile.profile.gitBinary='/bin/false';const review=await reviewing;await assert.rejects(otherReview,/profile.*changed/);assert.equal(c.options.effectsProfile,undefined);assert.equal(review.canAdopt,true,review.holds.join(';'));
  const stable={profile:{gitBinary:git}};
  await assert.rejects(c.sourceActions.adopt({...request,expectedReviewFingerprint:review.fingerprint},{profile:{gitBinary:git,commandTimeoutMs:2345},validate(){}}),/profile.*changed/);assert.equal(ledger(),unchanged);
  const adopting=c.sourceActions.adopt({...request,expectedReviewFingerprint:review.fingerprint},{...stable,validate(){c.options.effectsProfile={gitBinary:'/bin/false'};}});stable.profile.gitBinary='/bin/false';const adopted=await adopting;assert.equal(adopted.recordedPhase,'PREPARED');
  c.options.effectsProfile=undefined;
  const execute=c.sourceActions.executeDispatch.bind(c.sourceActions);let sends=0;
  c.sourceActions.executeDispatch=(dispatch,client,signal)=>execute(dispatch,{
   prepareSourceBranchCreate:client.prepareSourceBranchCreate.bind(client),preparedSourceReference:client.preparedSourceReference.bind(client),
   async spawnPreparedSourceBranchCreate(handle){sends++;const result=await client.spawnPreparedSourceBranchCreate(handle);if(result.handoff==='started')throw Error('CONTROLLED_LOST_PROFILE_SEND_REPLY');return result;},
   reconcileSourceBranchCreate:client.reconcileSourceBranchCreate.bind(client),
  },signal);
  const dispatchProfile={profile:{gitBinary:git}},sending=c.effects.dispatchSourceSnapshot(adopted.operationId,{...dispatchProfile,validate(){}});dispatchProfile.profile.gitBinary='/bin/false';await assert.rejects(sending,/CONTROLLED_LOST_PROFILE_SEND_REPLY/);const original=c.inspectSourceSnapshotOperation({operationId:adopted.operationId});assert.equal(original.recordedPhase,'UNKNOWN');assert.equal(sends,1);
  assert.equal((await setup(['rev-parse','refs/heads/profile-snapshot'])).stdout.trim(),body.projection.projectedCommit);
  const creation=structuredClone(original.nativeAttempt),spent=ledger();await c.close();c=await openController(options);assert.equal(c.options.effectsProfile,undefined);assert.equal(ledger(),spent);
  const readProfile={profile:{gitBinary:git,commandTimeoutMs:12000,maxOutputBytes:65536}},readingReview=c.sourceActions.reviewReconciliation(original.operationId,readProfile);readProfile.profile.gitBinary='/bin/false';const readReview=await readingReview;assert.equal(readReview.canRead,true,readReview.holds.join(';'));
  const readingControls={profile:{gitBinary:git,commandTimeoutMs:12000,maxOutputBytes:65536},validate(){}},reading=c.effects.reconcileSourceSnapshot({operationId:original.operationId,expectedReviewFingerprint:readReview.fingerprint},readingControls);readingControls.profile.gitBinary='/bin/false';const result=await reading;assert.equal(result.recordedPhase,'CONFIRMED');assert.deepEqual(result.nativeAttempt,creation);
  assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?',workId),priorWork);assert.deepEqual(await c.changeCore.currentEvidence(workId),priorEvidence);assert.deepEqual({...c.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId)},{lim:10,consumed:10,reserved:0});
  const finished=ledger();assert.deepEqual(await c.effects.reconcileSourceSnapshot({operationId:original.operationId,expectedReviewFingerprint:readReview.fingerprint},{validate(){assert.fail('Repeated read cannot send or query');}}),result);assert.equal(ledger(),finished);
  assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  await fs.writeFile(path.join(root,'source-profile-result.json'),JSON.stringify({workId,prepared,review,adopted,original,readReview,result,creation,sends,work:priorWork,spend:c.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId)},null,2));
 } finally {await c.close();}
}

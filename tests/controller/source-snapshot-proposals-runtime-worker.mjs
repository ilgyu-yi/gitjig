import {qualifySourceSaveTerminal} from './source-snapshot-terminal-case.mjs';
import {qualifySourceSaveUi} from './source-snapshot-ui-case.mjs';
import {qualifySourceProfile} from './source-snapshot-profile-case.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {writeSourceProposalArtifact} from '../../dist/controller/source-proposal-artifact.js';
import {retainLegacySourceCustody} from './source-snapshot-legacy-custody-fixture.mjs';
import fsSync from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const execute=promisify(execFile),git='/opt/homebrew/bin/git';

const activeCase=process.env.GITJIG_SOURCE_OWNER_RUNTIME_CASE;
const sourceDispatchCases=['dispatch9','refuse9','lost9','getter9','queue9','capture9'];
const sourceOwnerLifecycleCases=['closereentrant9','closepush9'];
const isOwnerLifecycle=sourceOwnerLifecycleCases.includes(activeCase);
const sourceReadCases=['read10','readbroken10','readcancel10','readpolicy10'];
const isReadCase=sourceReadCases.includes(activeCase);
if(!['limit8','limit9','child',...sourceDispatchCases,...sourceReadCases,...sourceOwnerLifecycleCases,'profile10','ui9en','ui9ko','uilost10ko','uipty9en','uipty9ko','uiptycancel9en','uiptycancel9ko','uiptylost10en','uiptylost10ko'].includes(activeCase))throw Error('Exact isolated source owner runtime case required');
for(const executionLimit of [8,9,10].filter(limit=>limit===((isReadCase||activeCase==='profile10'||activeCase==='uilost10ko'||['uiptylost10en','uiptylost10ko'].includes(activeCase))?10:activeCase==='limit8'?8:activeCase==='limit9'||sourceDispatchCases.includes(activeCase)||isOwnerLifecycle||['ui9en','ui9ko','uipty9en','uipty9ko','uiptycancel9en','uiptycancel9ko'].includes(activeCase)?9:null)))test('original REVIEW_READY source proposal and internal owner adoption at initial execution limit '+executionLimit,{timeout:180000},async t=>{
 const profile={dockerBinary:process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,image:process.env.GITJIG_RUNTIME_IMAGE};validateRuntimeProfile(profile);
 const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT??os.tmpdir();await fs.mkdir(parent,{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'source-proposal-runtime-'))),home=path.join(root,'app'),source=path.join(root,'source'),operator=path.join(root,'operator');
 await fs.mkdir(source,{mode:0o700});await fs.mkdir(operator,{mode:0o700});
 const env={PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:operator,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const setup=args=>execute(git,['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:source,env,timeout:5000});
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`));
 await setup(['init','--template=','--initial-branch=main']);await setup(['add','check.cjs']);await setup(['-c','commit.gpgsign=false','commit','-m','Original immutable basis']);
 await fs.writeFile(path.join(source,'private.env'),'UNCHANGED PRIVATE CONTEXT\n');
 const nativeTrace=path.join(root,'source-native-proxy.jsonl'),receiverMarker=path.join(root,'receiver-held.json'),proxyNonce=randomUUID();
 let sourceGit=git;
 if(['closepush9','uiptycancel9en','uiptycancel9ko'].includes(activeCase)){
  const directory=path.join(root,'trusted-git');await fs.mkdir(directory,{mode:0o700});sourceGit=path.join(directory,'git');
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'",realGit=await fs.realpath(git);
  // Fixed timing control only: real push execs the unchanged pinned Git. Its
  // explicitly selected receive-pack proxy waits BEFORE actual receiver startup.
  await fs.writeFile(sourceGit,`#!/bin/sh
kind=other
for arg in "$@"; do
 if [ "$arg" = receive-pack ]; then kind=receiver; break; fi
 if [ "$arg" = push ]; then kind=sender; fi
done
printf '{"pid":%s,"kind":"%s"}\n' "$$" "$kind" >> ${quote(nativeTrace)}
if [ "$kind" = receiver ]; then
 trap 'exit 143' TERM INT HUP
 printf '{"nonce":"${proxyNonce}","pid":%s}\n' "$$" > ${quote(receiverMarker)}
 while :; do /bin/sleep 0.05; done
fi
exec ${quote(realGit)} "$@"
`,{mode:0o700});
 }
 const options={installationHome:home,runtimeProfile:profile,effectsProfile:{gitBinary:sourceGit},sourceGitRoute:{kind:'available',environment:{home:operator}}};let c,abortedClose;
 // One owned Pi artifact root for this isolated test process, before any SDK session.
 const previousTemporary=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
 t.after(async()=>{try{await abortedClose;await c?.close();}finally{if(previousTemporary===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemporary;t.diagnostic(JSON.stringify({fixtureRoot:root,scope:'actual normal ChangeCore scripted Pi roles and Docker checks; zero paid model calls; retained owned evidence'}));}});
 c=await openController(options);
 const abort=()=>{abortedClose=c.close();void abortedClose.catch(()=>{});};t.signal.addEventListener('abort',abort,{once:true});
 await c.registerProject({id:'P',sourceRoot:source});const started=await c.beginChange({projectId:'P',request:'Consumer exports3 using exact original checker',executionLimit,resolutionLimit:8});
 const ready=await c.driveChange({workId:started.workId,model:scripted()});assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));
 const originalEvidence=await c.changeCore.currentEvidence(started.workId),execution=c.store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'",started.workId);assert.equal(execution.consumed,8,'original capture, complete roles and actual checks consume8');assert.equal(execution.lim,executionLimit);assert.equal(execution.reserved,0);
 const ledger=()=>JSON.stringify(['works','runs','budgets','change_state','effect_targets','effect_delegations','effect_operations','goal_attempts'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
 const before=ledger(),head=(await setup(['rev-parse','HEAD'])).stdout,index=await fs.readFile(path.join(source,'.git/index')),sourceBytes=await fs.readFile(path.join(source,'consumer.cjs')),status=(await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout;
 if(['uipty9en','uipty9ko','uiptycancel9en','uiptycancel9ko','uiptylost10en','uiptylost10ko'].includes(activeCase)){await qualifySourceSaveTerminal({c,options,root,workId:started.workId,git,setup,source,head,index,sourceBytes,status,locale:activeCase.endsWith('en')?'en':'ko',kind:activeCase.includes('cancel')?'cancel':activeCase.includes('lost')?'lost':'healthy',proxy:{nativeTrace,receiverMarker,nonce:proxyNonce}});return;}
 if(['ui9en','ui9ko','uilost10ko'].includes(activeCase)){await qualifySourceSaveUi({c,root,workId:started.workId,git,setup,source,head,index,sourceBytes,status,locale:activeCase==='ui9en'?'en':'ko',lost:activeCase==='uilost10ko'});return;}
 if(activeCase==='profile10'){await qualifySourceProfile({controller:c,options,root,workId:started.workId,git,setup,head,index,sourceBytes,status,source});return;}
 const prepared=await c.prepareSourceSnapshot({workId:started.workId,destinationBranch:'reviewed-snapshot'});assert.equal(prepared.kind,'prepared',prepared.reason);assert.equal(prepared.review.publicationConsent,'unconfirmed');assert.equal(prepared.review.initializedCustody,'recorded');assert.equal(prepared.review.currentness,'current');assert.equal(prepared.review.wholeFileAdditionCount,1);assert.equal(ledger(),before);assert.deepEqual(await c.changeCore.currentEvidence(started.workId),originalEvidence);
 const version=c.store.one('SELECT * FROM change_versions WHERE id=?',prepared.proposalId);assert.equal(version.kind,'source-snapshot-proposal');
 const originalBody=JSON.parse(await fs.readFile(version.artifact,'utf8'));assert.equal(originalBody.protocol,'source-snapshot-proposal/v2');assert.equal(originalBody.initialized.protocol,'owned-native-git-initialized/v1');assert.equal(JSON.parse(version.data).initializedDigest,createHash('sha256').update(JSON.stringify(originalBody.initialized)).digest('hex'));assert.deepEqual(originalBody.projection.wholeFileAdditions.map(a=>[a.path,a.capturedBasePresent]),[['consumer.cjs',true]]);assert.equal(originalBody.projection.projectedEntries.some(e=>e.path==='private.env'),false);
 // Actual retained publication review is free even with zero execution remaining.
 const publicationInput={workId:started.workId,proposalId:prepared.proposalId,expectedArtifactHash:version.hash};
 const publication=await c.openSourceSnapshotPublication(publicationInput);
 assert.equal(publication.review.currentness,'current');assert.equal(publication.review.publicationConsent,'unconfirmed');
 assert.deepEqual(publication.readPage({section:'whole-file'}).entries,originalBody.projection.wholeFileAdditions);
 assert.deepEqual(publication.readPage({section:'omissions'}).entries,originalBody.projection.effectiveDifferences);
 assert.ok(publication.readPage({section:'omissions'}).entries.some(e=>e.path==='private.env'));
 assert.equal((await publication.readFile({path:'consumer.cjs'})).text,await fs.readFile(path.join(originalBody.input.candidate.root,'consumer.cjs'),'utf8'));
 await assert.rejects(publication.readFile({path:'private.env'}),/published candidate file/);
 await assert.rejects(c.openSourceSnapshotPublication({...publicationInput,expectedArtifactHash:'0'.repeat(64)}),/artifact differs/);
 await assert.rejects(c.openSourceSnapshotPublication({...publicationInput,workId:'foreign'}),/scoped proposal/);
 const publicationAbort=new AbortController();publicationAbort.abort(Error('OWNER_BACK'));await assert.rejects(c.openSourceSnapshotPublication(publicationInput,{signal:publicationAbort.signal}),/OWNER_BACK/);
 assert.equal(ledger(),before);
 const proposalGit='--git-dir='+path.join(home,'effects','source-preview-'+prepared.previewId,'client/client.git');
 assert.equal((await setup([proposalGit,'cat-file','blob',originalBody.projection.projectedCommit+':consumer.cjs'])).stdout,await fs.readFile(path.join(originalBody.input.candidate.root,'consumer.cjs'),'utf8'));await fs.writeFile(path.join(root,'proposal-review.json'),JSON.stringify({prepared,version,originalEvidence},null,2));
 assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
 // Genuine controlled v1 host protocol remains readable without manufacturing initialized origin.
 const legacy=await retainLegacySourceCustody(c,home,started.workId,originalBody),legacyRow=c.store.one('SELECT * FROM change_versions WHERE id=?',legacy.proposalId);
 const legacyReview=await c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:legacy.proposalId});assert.equal(legacyReview.initializedCustody,'legacy-unbound');assert.equal(legacyReview.currentness,'current');assert.equal(ledger(),before);
 const legacyPublication=await c.openSourceSnapshotPublication({workId:started.workId,proposalId:legacy.proposalId,expectedArtifactHash:legacyRow.hash});
 assert.equal(legacyPublication.review.initializedCustody,'legacy-unbound');assert.equal((await legacyPublication.readFile({path:'consumer.cjs'})).text,(await publication.readFile({path:'consumer.cjs'})).text);await legacyPublication.close();
 // A newly stamped v2 original cannot be relabelled v1, even with internally matching new artifact/header bytes.
 for(const fault of ['downgrade','missing-proof','null-proof','missing-control','wrong-proof-protocol']){
  const changed=structuredClone(originalBody),changedHeader=JSON.parse(version.data);
  if(fault==='downgrade'){changed.protocol='source-snapshot-proposal/v1';delete changed.initialized;changedHeader.protocol=changed.protocol;delete changedHeader.initializedDigest;}
  else if(fault==='missing-proof')delete changed.initialized;
  else{if(fault==='null-proof')changed.initialized=null;else if(fault==='missing-control')delete changed.initialized.marker;else changed.initialized.protocol='unknown-initialized-proof';changedHeader.initializedDigest=createHash('sha256').update(JSON.stringify(changed.initialized)).digest('hex');}
  const ref=await writeSourceProposalArtifact(home,changed,()=>{});changedHeader.artifact=ref;
  c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?',path.join(home,'artifacts/source-snapshot-proposals',ref.hash+'.json'),ref.hash,JSON.stringify(changedHeader),prepared.proposalId);
  try{await assert.rejects(c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId}),/input digest|correspondence|[Ii]nitialized.*proof|proof.*shape/);}finally{c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?',version.artifact,version.hash,version.data,prepared.proposalId);}
 }
 assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',legacy.proposalId),legacyRow);
 // A second explicit preparation is another free observation, not reuse of a different proposal's identity.
 const second=await c.prepareSourceSnapshot({workId:started.workId,destinationBranch:'reviewed-snapshot-two'});assert.equal(second.kind,'prepared',second.reason);assert.equal(ledger(),before);
 const secondRow=c.store.one('SELECT * FROM change_versions WHERE id=?',second.proposalId);
 c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?',secondRow.artifact,secondRow.hash,secondRow.data,prepared.proposalId);
 await assert.rejects(c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId}),/reference unavailable|correspondence/);
 c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?',version.artifact,version.hash,version.data,prepared.proposalId);
 // Fault the retained version only after its artifact was read and capture validation has awaited.
 const originalOpen=fs.open;let mutated=false;
 fs.open=async(...args)=>{const h=await originalOpen(...args);if(!mutated&&String(args[0]).startsWith(c.store.one('SELECT artifact FROM change_versions WHERE id=?',originalEvidence.versions.base).artifact+path.sep)&&String(args[0]).endsWith('/consumer.cjs')){mutated=true;c.store.run('UPDATE change_versions SET hash=? WHERE id=?','0'.repeat(64),prepared.proposalId);}return h;};
 try{await assert.rejects(c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId}),/row changed/);}finally{fs.open=originalOpen;c.store.run('UPDATE change_versions SET hash=? WHERE id=?',version.hash,prepared.proposalId);}
 assert.equal(mutated,true);
 // A late change to original preview source bytes cannot be hidden by the same source ID.
 const header=JSON.parse(version.data),terminal=c.store.one('SELECT raw FROM sources WHERE id=?',header.terminalSourceId).raw;
 let sourceMutated=false;fs.open=async(...args)=>{const h=await originalOpen(...args);if(!sourceMutated&&String(args[0]).startsWith(c.store.one('SELECT artifact FROM change_versions WHERE id=?',originalEvidence.versions.base).artifact+path.sep)&&String(args[0]).endsWith('/consumer.cjs')){sourceMutated=true;const raw=JSON.parse(terminal);raw.receiptDigest='1'.repeat(64);c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify(raw),header.terminalSourceId);}return h;};
 try{await assert.rejects(c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId}),/preview sources changed/);}finally{fs.open=originalOpen;c.store.run('UPDATE sources SET raw=? WHERE id=?',terminal,header.terminalSourceId);}
 assert.equal(sourceMutated,true);
 // Actual artifact-await policy drift leaves an original held preview and no successful version.
 const configFile=path.join(source,'.git/config'),config=await fs.readFile(configFile),versionCount=c.store.one("SELECT count(*) AS n FROM change_versions WHERE kind='source-snapshot-proposal'").n;let configMutated=false;
 fs.open=async(...args)=>{const h=await originalOpen(...args);if(String(args[0]).endsWith('.tmp')){const write=h.writeFile.bind(h);h.writeFile=async(...a)=>{await write(...a);if(!configMutated){configMutated=true;await fs.appendFile(configFile,'\n# observed policy identity changed during artifact IO\n');}};}return h;};
 let held;try{held=await c.prepareSourceSnapshot({workId:started.workId,destinationBranch:'held-after-policy-drift'});}finally{fs.open=originalOpen;await fs.writeFile(configFile,config);}
 assert.equal(configMutated,true);assert.equal(held.kind,'held');assert.ok(held.previewId);assert.match(held.reason,/policy|identity/);assert.equal(c.store.one("SELECT count(*) AS n FROM change_versions WHERE kind='source-snapshot-proposal'").n,versionCount);assert.equal(ledger(),before);
 // Final host callback cannot invalidate an already verified artifact and still retain a version.
 let artifactReads=0,verifiedArtifact,artifactOriginal,artifactMutated=false;
 fs.open=async(...args)=>{const h=await originalOpen(...args);const file=String(args[0]);if(file.includes('/artifacts/source-snapshot-proposals/')&&/\/[a-f0-9]{64}\.json$/.test(file)){artifactReads++;if(artifactReads===2){const close=h.close.bind(h);h.close=async()=>{await close();verifiedArtifact=file;};}}return h;};
 let artifactHeld;try{artifactHeld=await c.prepareSourceSnapshot({workId:started.workId,destinationBranch:'held-after-artifact-drift'},{validate(){if(verifiedArtifact&&!artifactMutated){artifactMutated=true;artifactOriginal=fsSync.readFileSync(verifiedArtifact);fsSync.writeFileSync(verifiedArtifact,Buffer.alloc(artifactOriginal.length,120));}}});}finally{fs.open=originalOpen;if(artifactOriginal)await fs.writeFile(verifiedArtifact,artifactOriginal);}
 assert.equal(artifactMutated,true);assert.equal(artifactHeld.kind,'held');assert.ok(artifactHeld.previewId);assert.match(artifactHeld.reason,/artifact changed/);assert.equal(c.store.one("SELECT count(*) AS n FROM change_versions WHERE kind='source-snapshot-proposal'").n,versionCount);assert.equal(ledger(),before);
 // The original initialization marker can change without changing any target.identity file.
 // The newly retained initialized proof must still hold preparation before version COMMIT.
 let markerFile,markerOriginal,markerMutated=false;
 fs.open=async(...args)=>{const h=await originalOpen(...args);if(String(args[0]).endsWith('.tmp')){const write=h.writeFile.bind(h);h.writeFile=async(bytes,...a)=>{await write(bytes,...a);if(!markerMutated){const body=JSON.parse(Buffer.from(bytes).toString());markerFile=path.join(body.initialized.namespace.clientRoot,'native-owner.json');markerOriginal=await fs.readFile(markerFile);const altered=JSON.parse(markerOriginal);altered.metadataDate='2000-01-01T00:00:00.000Z';await fs.writeFile(markerFile,JSON.stringify(altered));markerMutated=true;}};}return h;};
 let markerHeld;try{markerHeld=await c.prepareSourceSnapshot({workId:started.workId,destinationBranch:'held-after-initialized-marker-drift'});}finally{fs.open=originalOpen;if(markerOriginal)await fs.writeFile(markerFile,markerOriginal);}
 assert.equal(markerMutated,true);assert.equal(markerHeld.kind,'held');assert.ok(markerHeld.previewId);assert.match(markerHeld.reason,/initialized|marker|control/);assert.equal(c.store.one("SELECT count(*) AS n FROM change_versions WHERE kind='source-snapshot-proposal'").n,versionCount);assert.equal(ledger(),before);
 await c.close();t.signal.throwIfAborted();c=await openController(options);t.signal.throwIfAborted();
 assert.throws(()=>publication.readPage({section:'product'}),/clos|abort/i);await publication.close();
 const reopened=await c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId});assert.equal(reopened.currentness,'current');assert.equal(reopened.initializedCustody,'recorded');
 const legacyReopened=await c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:legacy.proposalId});assert.equal(legacyReopened.initializedCustody,'legacy-unbound');assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',legacy.proposalId),legacyRow);assert.deepEqual(reopened.artifact,prepared.review.artifact);assert.equal(c.listSourceSnapshotProposals({workId:started.workId}).proposals[0].proposalId,prepared.proposalId);
 await assert.rejects(c.inspectSourceSnapshotProposal({workId:'foreign',proposalId:prepared.proposalId}),/scoped proposal/);
 const actionRequest={workId:started.workId,proposalId:prepared.proposalId},actionReview=await c.sourceActions.review(actionRequest);assert.equal(actionReview.kind,'review');
 if(executionLimit===8){
  assert.equal(actionReview.canAdopt,false);assert.match(actionReview.holds.join(';'),/allowance exhausted/);const originalLedger=ledger();
  await assert.rejects(c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){}}),/allowance exhausted/);assert.equal(ledger(),originalLedger);
 }else{
  assert.equal(actionReview.canAdopt,true,actionReview.holds.join(';'));
  const oldProfile=structuredClone(c.options.effectsProfile),profileLedger=ledger();
  try{await assert.rejects(c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){c.options.effectsProfile={...oldProfile,commandTimeoutMs:2345};}}),/profile recipe changed/);}finally{c.options.effectsProfile=oldProfile;}
  assert.equal(ledger(),profileLedger);
  let changedProfileDuringCapture=false;const actualOpen=fs.open;
  fs.open=async(...args)=>{const h=await actualOpen(...args);if(!changedProfileDuringCapture&&String(args[0])===path.join(originalBody.input.candidate.root,'consumer.cjs')){changedProfileDuringCapture=true;c.options.effectsProfile={...oldProfile,maxOutputBytes:12345};}return h;};
  try{await assert.rejects(c.sourceActions.review(actionRequest),/profile recipe changed/);}finally{fs.open=actualOpen;c.options.effectsProfile=oldProfile;}
  assert.equal(changedProfileDuringCapture,true);assert.equal(ledger(),profileLedger);
  await fs.writeFile(path.join(root,'adoption-before.json'),JSON.stringify({work:c.store.one('SELECT * FROM works WHERE id=?',started.workId),budgets:c.store.all('SELECT * FROM budgets'),runs:c.store.all('SELECT * FROM runs'),review:actionReview},null,2));
  await assert.rejects(c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){},onAllocated(){throw Error('Controlled postcommit presentation failure');}}),/retained after owner notification/);
  const retained=c.inspectSourceSnapshotOperation({operationId:originalBody.projection.operationId});assert.equal(retained.state,'RETAINED',retained.reason);assert.equal(retained.binding.proposalId,prepared.proposalId);assert.equal(retained.grantId,c.store.one('SELECT id FROM effect_delegations').id);assert.equal(retained.nativeOutcome,'not-inspected');
  const after=ledger();assert.deepEqual(await c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){throw Error('A repeat must not grant again');}}),retained);assert.equal(ledger(),after);
  assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_targets').n,1);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_delegations').n,1);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,1);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_receipts').n,1);assert.deepEqual(await c.changeCore.currentEvidence(started.workId),originalEvidence);
  await c.close();c=await openController(options);assert.equal(c.inspectSourceSnapshotOperation({operationId:retained.operationId}).state,'RETAINED');assert.deepEqual(await c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){throw Error('Reopen does not renew authority');}}),retained);
 }
 if(isOwnerLifecycle){
  const operationId=originalBody.projection.operationId,priorWork=c.store.one('SELECT * FROM works WHERE id=?',started.workId),priorEvidence=await c.changeCore.currentEvidence(started.workId);
  const priorGrant=c.store.one('SELECT * FROM effect_delegations'),priorTarget=c.store.one('SELECT * FROM effect_targets'),priorRuns=c.store.all('SELECT * FROM runs ORDER BY rowid');
  const originalBefore=c.inspectSourceSnapshotOperation({operationId});let closing,validationCloses=0,held;
  const pending=c.effects.dispatchSourceSnapshot(operationId,{validate(){if(activeCase==='closereentrant9'&&!closing){validationCloses++;closing=c.close();}}});
  void pending.catch(()=>{});
  try{
   if(activeCase==='closepush9'){
    const until=Date.now()+10000;let marker;
    while(Date.now()<until){try{marker=JSON.parse(await fs.readFile(receiverMarker,'utf8'));break;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(marker,'Original fixed receiver-start gate was not reached');assert.equal(marker.nonce,proxyNonce);assert.ok(Number.isSafeInteger(marker.pid)&&marker.pid>0);
    const trace=(await fs.readFile(nativeTrace,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),senders=trace.filter(row=>row.kind==='sender');assert.equal(senders.length,1);const senderPid=senders[0].pid;
    const observed=c.inspectSourceSnapshotOperation({operationId});assert.equal(observed.state,'RETAINED',observed.reason);assert.equal(observed.recordedPhase,'INVOKING');
    const run=c.store.one('SELECT * FROM runs WHERE id=?',observed.nativeAttempt.attempt.runId),lease=c.store.one('SELECT * FROM capacity_leases WHERE run=?',run.id);assert.equal(run.phase,'RUNNING');assert.equal(run.reservation,'reserved');assert.equal(lease.state,'ADMITTED');
    const prepared=observed.nativeAttempt.intent.prepared,command=path.join(prepared.clientRoot,'runs',prepared.commandId),start=JSON.parse(await fs.readFile(path.join(command,'git-start.json'),'utf8'));assert.equal(start.gitStarted,true);assert.equal(start.gitPid,senderPid);
    const sender=await execute('/bin/ps',['-p',String(senderPid),'-o','command='],{env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:2000});assert.ok(sender.stdout.includes(await fs.realpath(git)));assert.match(sender.stdout,/ push /);
    process.kill(marker.pid,0);held={marker,senderPid,senderCommand:sender.stdout.trim(),run,lease,prepared,start,traceCount:trace.length};closing=c.close();
   }
   const outcome=await Promise.allSettled([pending]);assert.ok(closing,'Reentrant validation did not initiate original close');await closing;
   if(outcome[0].status==='rejected')assert.match(String(outcome[0].reason),/clos|abort|interrupt/i);else{assert.equal(activeCase,'closepush9');assert.equal(outcome[0].value.recordedPhase,'UNKNOWN');}
  }finally{if(!closing)closing=c.close();await closing;}
  if(activeCase==='closereentrant9')assert.equal(validationCloses,1);
  const traceAfterClose=activeCase==='closepush9'?await fs.readFile(nativeTrace,'utf8'):null;
  c=await openController(options);const original=c.inspectSourceSnapshotOperation({operationId});assert.equal(original.state,'RETAINED',original.reason);
  assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?',started.workId),priorWork);assert.equal(priorWork.state,'DELIVERED');assert.deepEqual(await c.changeCore.currentEvidence(started.workId),priorEvidence);assert.deepEqual(c.store.one('SELECT * FROM effect_delegations'),priorGrant);assert.deepEqual(c.store.one('SELECT * FROM effect_targets'),priorTarget);
  const spend=c.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",started.workId);assert.deepEqual({...spend},{lim:9,consumed:activeCase==='closereentrant9'?8:9,reserved:0});
  if(activeCase==='closereentrant9'){assert.deepEqual(original,originalBefore);assert.equal(original.nativeAttempt,null);assert.deepEqual(c.store.all('SELECT * FROM runs ORDER BY rowid'),priorRuns);}
  else{
   assert.equal(original.recordedPhase,'UNKNOWN');assert.ok(original.nativeAttempt.attempt.intentId);assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.equal(original.nativeAttempt.settlement.cleanup,'removed');assert.equal(original.nativeAttempt.hold,null);
   const run=c.store.one('SELECT * FROM runs WHERE id=?',original.nativeAttempt.attempt.runId),lease=c.store.one('SELECT * FROM capacity_leases WHERE run=?',run.id);assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,'removed');assert.equal(lease.state,'RELEASED');
   for(const pid of [held.senderPid,-held.senderPid,held.marker.pid,held.start.pid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
   const after=ledger();assert.deepEqual(await c.effects.dispatchSourceSnapshot(operationId,{validate(){assert.fail('Reopen must not send this original again');}}),original);assert.equal(ledger(),after);assert.equal(await fs.readFile(nativeTrace,'utf8'),traceAfterClose);
  }
  await assert.rejects(setup(['show-ref','--verify','refs/heads/reviewed-snapshot']));assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  await fs.writeFile(path.join(root,'source-close-result.json'),JSON.stringify({activeCase,operationId,priorWork,workAfter:c.store.one('SELECT * FROM works WHERE id=?',started.workId),spend,originalBefore,original,held,traceAfterClose},null,2));
  return;
 }
 if(sourceDispatchCases.includes(activeCase)||isReadCase){
  const operationId=originalBody.projection.operationId,priorWork=c.store.one('SELECT * FROM works WHERE id=?',started.workId),priorEvidence=await c.changeCore.currentEvidence(started.workId);
  const priorGrant=c.store.one('SELECT * FROM effect_delegations'),priorTarget=c.store.one('SELECT * FROM effect_targets'),priorRuns=c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?',started.workId).n;
  const executeDispatch=c.sourceActions.executeDispatch.bind(c.sourceActions);let preparedForIntent=false,getterRefusal=false,sends=0,captureChanged=false;const captureFile=path.join(originalBody.input.candidate.root,'consumer.cjs'),captureBytes=await fs.readFile(captureFile);const queueAbort=new AbortController(),occupants=[];let cleanupQueue=async()=>{};
  if(activeCase==='queue9'){
   // Controlled other-work capacity occupancy only. The source's actual normal
   // procedure, candidate, owner permission and finite budget remain untouched.
   const capacity=c.capacity,acquire=capacity.acquire.bind(capacity),register=c.effects.h.register;
   c.effects.h.register=(work,handle)=>{register(work,handle);if(!handle.sourceSnapshotRun)return;for(let i=0;i<2;i++){const id='controlled-capacity-'+i,runId=id+'-run';c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',id,'P',priorWork.source,null,id,'ACTIVE',1,1,null,'{}');c.store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',id,'execution',1,0,1);c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,id,1,1,'CREATED',root,'reserved','{}');occupants.push(acquire({workId:id,runId,epoch:1,kind:'check'}));}};
   capacity.acquire=request=>{const pending=acquire(request);if(request.workId===started.workId){assert.equal(c.store.one('SELECT phase FROM runs WHERE id=?',request.runId).phase,'WAITING_CAPACITY');queueAbort.abort(Error('CONTROLLED_QUEUED_SOURCE_CANCEL'));}return pending;};
   cleanupQueue=async()=>{c.effects.h.register=register;capacity.acquire=acquire;for(const lease of await Promise.all(occupants)){c.settleBudget(lease.runId);c.patchRun(lease.runId,'SETTLED',{cleanup:'not-allocated'});lease.release({cleanup:'not-allocated',settled:true});}};
  }
  c.sourceActions.executeDispatch=(dispatch,client,signal)=>executeDispatch(dispatch,{
   prepareSourceBranchCreate:client.prepareSourceBranchCreate.bind(client),
   preparedSourceReference(handle){if(activeCase==='getter9')getterRefusal=true;const result=client.preparedSourceReference(handle);preparedForIntent=true;return result;},
   async spawnPreparedSourceBranchCreate(handle){sends++;const receipt=await client.spawnPreparedSourceBranchCreate(handle);if((activeCase==='lost9'||isReadCase) && receipt.handoff==='started')throw Error('CONTROLLED_LOST_ORIGINAL_SEND_REPLY');return receipt;},
   reconcileSourceBranchCreate:client.reconcileSourceBranchCreate.bind(client),
  },signal);
  const dispatch=()=>c.effects.dispatchSourceSnapshot(operationId,{signal:queueAbort.signal,validate(){if(activeCase==='capture9' && !captureChanged && c.store.one('SELECT phase FROM effect_operations WHERE id=?',operationId).phase==='INVOKING'){fsSync.writeFileSync(captureFile,'module.exports=999;\n');captureChanged=true;}if(activeCase==='getter9' && getterRefusal)throw Error('CONTROLLED_GETTER_ONLY_STALE · '+'한글🙂'.repeat(2000));if(activeCase==='refuse9' && preparedForIntent)throw 0;}});
  try{if(activeCase==='dispatch9')assert.equal((await dispatch()).recordedPhase,'CONFIRMED');
  else if(activeCase==='refuse9')await assert.rejects(dispatch(),error=>error===0);
  else if(activeCase==='getter9')await assert.rejects(dispatch(),/GETTER_ONLY_STALE/);
  else if(activeCase==='queue9')await assert.rejects(dispatch(),/interrupted before capacity/);
  else if(activeCase==='capture9')assert.equal((await dispatch()).recordedPhase,'REFUSED');
  else await assert.rejects(dispatch(),/LOST_ORIGINAL_SEND_REPLY/);
  }finally{await cleanupQueue();if(captureChanged)await fs.writeFile(captureFile,captureBytes);}
  const original=c.inspectSourceSnapshotOperation({operationId});assert.equal(original.state,'RETAINED',original.reason);
  assert.equal(original.recordedPhase,activeCase==='dispatch9'?'CONFIRMED':['refuse9','queue9','capture9'].includes(activeCase)?'REFUSED':'UNKNOWN');assert.equal(original.nativeOutcome,'not-inspected');
  assert.equal(sends,activeCase==='queue9'?0:1,'At most one handoff call; queued cancellation never enters Native');
  const run=c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',started.workId).at(-1);assert.equal(c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?',started.workId).n,priorRuns+1);assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,activeCase==='queue9'?'released':'consumed');assert.equal(run.staging,originalBody.initialized.namespace.clientRoot);assert.equal(JSON.parse(run.data).nativeFamily,'source-snapshot');assert.equal(JSON.parse(run.data).cleanup,activeCase==='queue9'?'not-allocated':'removed');
  assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?',started.workId),priorWork);assert.deepEqual(await c.changeCore.currentEvidence(started.workId),priorEvidence);assert.deepEqual(c.store.one('SELECT * FROM effect_delegations'),priorGrant);assert.deepEqual(c.store.one('SELECT * FROM effect_targets'),priorTarget);
  const spend=c.store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'",started.workId);assert.equal(spend.lim,executionLimit);assert.equal(spend.consumed,activeCase==='queue9'?8:9);assert.equal(spend.reserved,0);
  const native=original.nativeAttempt;assert.ok(native);assert.equal(native.attempt.runId,run.id);assert.ok(Buffer.byteLength(native.settlement.reason)<=2048);if(activeCase==='getter9'){assert.match(native.settlement.reason,/한글/);assert.equal(native.settlement.reason.includes('�'),false);}
  if(['refuse9','getter9','queue9','capture9'].includes(activeCase)){if(activeCase==='capture9'){assert.equal(captureChanged,true);assert.ok(native.attempt.intentId);}else assert.equal(native.attempt.intentId,null);assert.equal(native.settlement.classification,activeCase==='getter9'?'unknown':'definitely-unsent');if(activeCase==='queue9'){assert.equal(native.settlement.send,null);assert.equal(native.settlement.prepared,null);}else{assert.equal(native.settlement.send.handoff,'not-started');assert.ok(native.settlement.send.notStarted);if(activeCase==='getter9')assert.equal(native.settlement.prepared,null);}await assert.rejects(setup(['show-ref','--verify','refs/heads/reviewed-snapshot']));}
  else{assert.ok(native.attempt.intentId);assert.equal((await setup(['rev-parse','refs/heads/reviewed-snapshot'])).stdout.trim(),originalBody.projection.projectedCommit);assert.equal((await setup(['show','refs/heads/reviewed-snapshot:consumer.cjs'])).stdout,'module.exports=3;\n');assert.equal(native.settlement.classification,(activeCase==='lost9'||isReadCase)?'unknown':'confirmed');}
  assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  const spentLedger=ledger();assert.deepEqual(await c.effects.dispatchSourceSnapshot(operationId,{validate(){throw Error('A repeat must not authorize or send');}}),original);assert.equal(ledger(),spentLedger);
  await fs.writeFile(path.join(root,'dispatch-result.json'),JSON.stringify({activeCase,operationId,workId:started.workId,priorWork,original,spend,run,sends},null,2));
  await c.close();c=await openController(options);assert.equal(ledger(),spentLedger);assert.deepEqual(await c.effects.dispatchSourceSnapshot(operationId,{validate(){throw Error('Reopen never resends');}}),original);assert.equal(ledger(),spentLedger);
  if(isReadCase){
   const creation=structuredClone(original.nativeAttempt);const journalRestore=[];
   if(activeCase==='readcancel10')await c.cancelWork({workId:started.workId});
   if(activeCase==='readpolicy10'){const file=path.join(source,'.git/config');journalRestore.push([file,await fs.readFile(file)]);await setup(['config','gitjig.readmarker','owned-current-policy-b']);}
   if(activeCase==='readbroken10'){
    const directory=path.join(originalBody.initialized.namespace.clientRoot,'runs',creation.intent.prepared.commandId),stdoutFile=path.join(directory,'stdout.bin'),resultFile=path.join(directory,'result.json'),ackFile=path.join(directory,'parent-closed.json');
    for(const file of [stdoutFile,resultFile,ackFile])journalRestore.push([file,await fs.readFile(file)]);
    const stdout=(await fs.readFile(stdoutFile,'utf8')).replace('*\t','=\t').replace('[new branch]','[up to date]'),result=JSON.parse(await fs.readFile(resultFile,'utf8'));assert.match(stdout,/=\t/);result.stdout=stdout;result.stdoutBytes=Buffer.byteLength(stdout);result.stdoutSha256=createHash('sha256').update(stdout).digest('hex');const raw=JSON.stringify(result);await fs.writeFile(stdoutFile,stdout);await fs.writeFile(resultFile,raw);const ack=JSON.parse(await fs.readFile(ackFile,'utf8'));ack.resultHash=createHash('sha256').update(raw).digest('hex');await fs.writeFile(ackFile,JSON.stringify(ack));
   }
   const readWorkBefore=c.store.one('SELECT * FROM works WHERE id=?',started.workId),review=await c.sourceActions.reviewReconciliation(operationId);assert.equal(review.canRead,true,review.holds.join('; '));
   let reads=0;const executeRead=c.sourceActions.executeRead.bind(c.sourceActions);
   c.sourceActions.executeRead=(dispatch,client,signal)=>{assert.deepEqual(Object.keys(client).sort(),['observeSourceReadTarget','reconcileSourceBranchCreate']);reads++;return executeRead(dispatch,client,signal);};
   let result;try{result=await c.effects.reconcileSourceSnapshot({operationId,expectedReviewFingerprint:review.fingerprint},{validate(){}});}finally{for(const [file,bytes]of journalRestore)await fs.writeFile(file,bytes);}assert.equal(result.recordedPhase,activeCase==='readbroken10'?'UNKNOWN':'CONFIRMED');assert.equal(result.recordedOutcome,activeCase==='readbroken10'?'unknown':'confirmed');assert.deepEqual(result.nativeAttempt,creation);assert.equal(result.nativeReads.length,1);assert.equal(result.nativeReads[0].settlement.classification,activeCase==='readbroken10'?'unknown':'confirmed');if(activeCase==='readbroken10')assert.equal(result.nativeReads[0].settlement.readback.kind,'observed-desired-state');if(activeCase==='readpolicy10')assert.notEqual(result.nativeReads[0].settlement.policy.fingerprint,original.binding.policyFingerprint);assert.equal(reads,1);assert.equal(sends,1);
   assert.deepEqual(c.store.one('SELECT * FROM effect_delegations'),priorGrant);assert.deepEqual(c.store.one('SELECT * FROM effect_targets'),priorTarget);assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?',started.workId),readWorkBefore);if(activeCase!=='readcancel10')assert.deepEqual(await c.changeCore.currentEvidence(started.workId),priorEvidence);
   const finalSpend=c.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",started.workId);assert.deepEqual({...finalSpend},{lim:10,consumed:10,reserved:0});
   const afterRead=ledger();assert.deepEqual(await c.effects.reconcileSourceSnapshot({operationId,expectedReviewFingerprint:review.fingerprint},{validate(){throw Error('Repeated read confirmation must not query');}}),result);assert.equal(ledger(),afterRead);assert.equal(reads,1);
   await fs.writeFile(path.join(root,'reconciliation-result.json'),JSON.stringify({operationId,review,result,creation,finalSpend,reads,sends},null,2));await c.close();c=await openController(options);assert.equal(ledger(),afterRead);assert.deepEqual(await c.effects.reconcileSourceSnapshot({operationId,expectedReviewFingerprint:review.fingerprint},{validate(){throw Error('Reopen never repeats the original read');}}),result);assert.equal(ledger(),afterRead);
   assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  }

 }
 await c.cancelWork({workId:started.workId});const historical=await c.inspectSourceSnapshotProposal({workId:started.workId,proposalId:prepared.proposalId});assert.equal(historical.currentness,'held');assert.deepEqual(historical.artifact,prepared.review.artifact);
 if(executionLimit>=9){const retained=c.inspectSourceSnapshotOperation({operationId:originalBody.projection.operationId});assert.equal(retained.state,'RETAINED');assert.deepEqual(await c.sourceActions.adopt({...actionRequest,expectedReviewFingerprint:actionReview.fingerprint},{validate(){throw Error('Cancellation cannot authorize again');}}),retained);}
 const cancelledLedger=ledger(),historicalPublication=await c.openSourceSnapshotPublication(publicationInput);assert.equal(historicalPublication.review.currentness,'held');
 assert.equal((await historicalPublication.readFile({path:'consumer.cjs'})).text,await fs.readFile(path.join(originalBody.input.candidate.root,'consumer.cjs'),'utf8'));assert.equal(ledger(),cancelledLedger);await historicalPublication.close();
});

if(activeCase==='child')test('explicit internal owner adoption covers an actual reviewed delegated child only',{timeout:120000},async t=>{
 const profile={dockerBinary:process.env.GITJIG_DOCKER_BINARY??'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,image:process.env.GITJIG_RUNTIME_IMAGE};validateRuntimeProfile(profile);
 const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT??os.tmpdir(),root=await fs.realpath(await fs.mkdtemp(path.join(parent,'source-owner-child-'))),home=path.join(root,'app'),source=path.join(root,'source'),operator=path.join(root,'operator');await fs.mkdir(source,{mode:0o700});await fs.mkdir(operator,{mode:0o700});
 const env={PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:operator,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned child fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Owned child fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'},setup=args=>execute(git,['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:source,env,timeout:5000});
 await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`));await setup(['init','--template=','--initial-branch=main']);await setup(['add','check.cjs']);await setup(['-c','commit.gpgsign=false','commit','-m','Original child immutable basis']);await fs.writeFile(path.join(source,'private.env'),'UNCHANGED CHILD PRIVATE CONTEXT\n');
 const oldTemporary=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');let c,close;
 t.after(async()=>{try{await close;await c?.close();}finally{if(oldTemporary===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemporary;t.diagnostic(JSON.stringify({fixtureRoot:root,scope:'Genuine conversation assignment and normal child procedures; explicit exact-child internal owner adoption, no parent grant inheritance/send/model service'}));}});
 c=await openController({installationHome:home,runtimeProfile:profile,effectsProfile:{gitBinary:git},sourceGitRoute:{kind:'available',environment:{home:operator}},interactionDelegation:{projectIds:['P'],maxAssignments:2}});t.signal.addEventListener('abort',()=>{close=c.close();void close.catch(()=>{});},{once:true});await c.registerProject({id:'P',sourceRoot:source});
 let assignmentId,waited=false;const model=scripted(context=>{
  const result=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='conversation_assign').at(-1);
  if(!assignmentId&&result)assignmentId=JSON.parse(result.content.filter(p=>p.type==='text').map(p=>p.text).join('')).assignmentId;
  if(!assignmentId)return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3 using the exact original checker',resultDependency:true}}};
  if(!waited){waited=true;return{tool:{name:'conversation_wait',arguments:{resultHandles:[assignmentId]}}};}
  return{text:'Original reviewed child result retained; owner will separately inspect source delivery.'};
 });
 const conversation=c.createConversation({projectId:'P'}),view=c.inspectConversation(conversation.conversationId);await c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:view.generation,text:'Delegate the exact consumer change; retain its reviewed local result.',mode:'idle'});
 const parentResult=await c.runConversation({conversationId:conversation.conversationId,model});assert.equal(parentResult.status,'waiting');await c.ordinaryCore.drain();t.signal.throwIfAborted();
 const assignment=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignmentId);assert.equal(assignment.state,'COMPLETE',JSON.stringify(assignment));assert.notEqual(assignment.work,parentResult.workId);assert.equal(c.inspectChange(assignment.work).reviewReady,true);
 const work=c.store.one('SELECT * FROM works WHERE id=?',assignment.work);assert.ok(JSON.parse(work.data).invocation?.assignmentId,'actual child invocation remains attributed');const evidence=await c.changeCore.currentEvidence(work.id);
 const head=(await setup(['rev-parse','HEAD'])).stdout,index=await fs.readFile(path.join(source,'.git/index')),bytes=await fs.readFile(path.join(source,'consumer.cjs'));
 const prepared=await c.prepareSourceSnapshot({workId:work.id,destinationBranch:'reviewed-child'});assert.equal(prepared.kind,'prepared',prepared.reason);
 const request={workId:work.id,proposalId:prepared.proposalId},review=await c.sourceActions.review(request);assert.equal(review.kind,'review');assert.equal(review.canAdopt,true,review.holds.join(';'));
 const before={works:c.store.all('SELECT * FROM works'),runs:c.store.all('SELECT * FROM runs'),budgets:c.store.all('SELECT * FROM budgets'),assignment:c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignmentId)};
 await assert.rejects(c.sourceActions.adopt({...request,workId:parentResult.workId,expectedReviewFingerprint:review.fingerprint},{validate(){}}),/proposal unavailable/);
 const adopted=await c.sourceActions.adopt({...request,expectedReviewFingerprint:review.fingerprint},{validate(){}});assert.equal(adopted.state,'RETAINED',adopted.reason);assert.equal(adopted.workId,work.id);assert.equal(c.store.one('SELECT root FROM effect_delegations WHERE id=?',adopted.grantId).root,work.id);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_delegations WHERE root=?',parentResult.workId).n,0);
 assert.deepEqual({works:c.store.all('SELECT * FROM works'),runs:c.store.all('SELECT * FROM runs'),budgets:c.store.all('SELECT * FROM budgets'),assignment:c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignmentId)},before);assert.deepEqual(await c.changeCore.currentEvidence(work.id),evidence);
 await fs.writeFile(path.join(root,'child-adoption-before.json'),JSON.stringify({before,review,parentWork:parentResult.workId,childWork:work.id,adopted},null,2));
 const second=await c.prepareSourceSnapshot({workId:work.id,destinationBranch:'held-child-source'});assert.equal(second.kind,'prepared',second.reason);const secondRequest={workId:work.id,proposalId:second.proposalId},secondReview=await c.sourceActions.review(secondRequest);assert.equal(secondReview.kind,'review');assert.equal(secondReview.canAdopt,true,secondReview.holds.join(';'));
 const child=c.inspectConversation(assignment.target);await c.queueConversationInput({conversationId:child.conversationId,expectedGeneration:child.generation,text:'Owner now requires value4; previous result needs original fit and verification',mode:'idle'});
 await assert.rejects(c.sourceActions.adopt({...secondRequest,expectedReviewFingerprint:secondReview.fingerprint},{validate(){}}),/source|input|hold|ready|current|evidence|review|scope/i);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,1);
 assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),bytes);assert.deepEqual((await setup(['for-each-ref','--format=%(refname)','refs/heads'])).stdout.trim().split('\n'),['refs/heads/main']);
});

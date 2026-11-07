import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Capacity} from '../../dist/controller/capacity.js';
import {sourceReadWork} from '../../dist/controller/source-snapshot-read-records.js';
import {sourceGitArguments,sourcePushArguments} from '../../dist/effects/native-git.js';
import {openController} from '../../dist/controller/index.js';
import {hash} from '../../dist/controller/change-files.js';
import {SourceSnapshotActions} from '../../dist/controller/source-snapshot-actions.js';
import {SourcePreviewWriter} from '../../dist/controller/source-preview-writer.js';
import {SourceBranchPreviews,sourcePreviewFactoryProtocol} from '../../dist/controller/source-branch-previews.js';
import {inspectSourceSnapshotRecord,listSourceSnapshotRecords} from '../../dist/controller/source-snapshot-records.js';
import {receiverTransmissionHolds} from '../../dist/controller/integration-transmission.js';
import {listIntegrationTargets} from '../../dist/controller/integration-targets.js';
import {listRetainedIntegrations} from '../../dist/controller/integration-registry.js';

const sha='a'.repeat(64);
// Explicit controlled custody/standing premise. This exercises actual Store,
// owner lease, transaction and closed metadata grammar, NEVER native/standing
// qualification. The separate normal runtime uses the real custody producer.
async function world(t,format='sha1',executionLimit=9){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-adoption-'))),home=path.join(root,'app'),sourceRoot=path.join(root,'project');await fs.mkdir(sourceRoot,{mode:0o700});
 const c=await openController({installationHome:home});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'P',sourceRoot});
 const s=c.store,workId='controlled-work';s.run('INSERT INTO sources VALUES(?,?,?,?)','controlled-source',null,'{"kind":"controlled-original-not-a-procedure-proof"}','Original controlled scope');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',workId,'P','controlled-source',null,workId,'DELIVERED',1,1,null,'{"kind":"governed-change"}');
 for(const kind of ['execution','resolution'])s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',workId,kind,kind==='execution'?executionLimit:9,8,0);
 const writer=new SourcePreviewWriter(s,home,c.releaseOwner);writer.prepare();const registry=new SourceBranchPreviews(s,home,writer);
 const p=registry.admitDurable({workId,sourceId:'controlled-source',epoch:1,generation:1,profileDigest:sha,inputDigest:sha});
 const rooted=registry.attachRoot(p.id,{admissionSourceId:p.admission_source,protocol:sourcePreviewFactoryProtocol,clientRoot:p.admission.clientRoot,device:'10',inode:'11',ownerUid:process.getuid(),runsDirectory:path.join(p.admission.clientRoot,'runs'),runsDevice:'10',runsInode:'12',runsOwnerUid:process.getuid(),gitBinary:'/controlled/never-executed-git'});
 const preview=registry.settle(p.id,{admissionSourceId:p.admission_source,rootSourceId:rooted.root_source,kind:'joined-owned-native',cleanup:'confirmed',receiptDigest:sha});
 const proposalId=randomUUID(),artifact={hash:sha,bytes:2},operationId='source-preview-'+p.id;
 const header={protocol:'source-snapshot-proposal/v2',initializedDigest:sha,proposalId,status:'prepared',publicationConsent:'unconfirmed',workId,sourceId:'controlled-source',scopeDigest:sha,evidenceFingerprint:sha,previewId:p.id,admissionSourceId:p.admission_source,rootSourceId:preview.root_source,terminalSourceId:preview.terminal_source,operationId,previewDigest:hash(preview),artifact,destinationRef:'refs/heads/reviewed'};
 s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',proposalId,workId,'source-snapshot-proposal','candidate-original',path.join(home,'artifacts/source-snapshot-proposals',sha+'.json'),sha,JSON.stringify(header));
 const oid='1'.repeat(format==='sha1'?40:64),anchor={workId,projectId:'P',projectRoot:sourceRoot,sourceId:'controlled-source',epoch:1,generation:1,evidenceFingerprint:sha,scopeDigest:sha,baseVersion:'base-original',candidateVersion:'candidate-original',proposalId,previewId:p.id,artifact,versionDigest:hash(s.one('SELECT * FROM change_versions WHERE id=?',proposalId)),initializedDigest:sha,operationId,basisCommit:oid,projectedCommit:oid,projectedTree:oid,publicationBaselineProfile:'k-absent-whole-file/v1',objectFormat:format,commonDirectory:path.join(sourceRoot,'.git'),device:'20',inode:'21',destinationRef:header.destinationRef,policyFingerprint:sha,profileDigest:sha,routeDigest:sha};
 let invalid=false;
 const actions=new SourceSnapshotActions({store:s,home,owner:c.releaseOwner,proposals:{async captureActionProposal(){return{anchor:structuredClone(anchor),assertCurrent(){if(invalid)throw Error('CONTROLLED_SELECTED_DRIFT');}};}},capacityLimit:2,busy:()=>false,assertOpen:()=>c.assertOpen()});t.after(()=>actions.close());
 const request={workId,proposalId},rows=()=>JSON.stringify(['effect_targets','effect_delegations','effect_operations','effect_receipts','works','runs','budgets'].map(table=>s.all('SELECT * FROM '+table+' ORDER BY rowid')));
 return{c,s,home,root,anchor,actions,request,rows,invalidate(){invalid=true;}};
}

// These are intentionally synthetic recorded events. No Native command is
// executed and a recorded confirmation is not independently qualified success.
async function recordedAttempt(t,format='sha1',executionLimit=9){
 const f=await world(t,format,executionLimit),review=await f.actions.review(f.request);
 await f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){}});
 const op=f.s.one('SELECT * FROM effect_operations'),data=JSON.parse(op.data),runId=randomUUID(),admissionId=randomUUID();
 const {admissionSourceId,...namespace}=new SourceBranchPreviews(f.s,f.home).inspect(f.anchor.previewId).root;
 const writer=new SourcePreviewWriter(f.s,f.home,f.c.releaseOwner);writer.prepare();
 const common={protocol:'source-native-attempt/v1',operationId:f.anchor.operationId,adoptionId:data.adoption,bindingDigest:hash(f.anchor),revision:1,runId,writer:writer.assertCurrent()};
 const admission={...common,kind:'source-native-admission',initializedDigest:f.anchor.initializedDigest,namespace,originalWorkState:'DELIVERED',sourceId:f.anchor.sourceId,epoch:1,generation:1};
 const attempt={revision:1,runId,admissionId,intentId:null,settlementId:null};
 const runData={kind:'native-effect',nativeFamily:'source-snapshot',familyVersion:1,operationId:op.id,clientRoot:namespace.clientRoot,bindingDigest:hash(f.anchor),attemptRevision:1,nativeAdmissionId:admissionId,nativeGate:'unopened',controllerPid:process.pid};
 f.s.tx(()=>{f.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','RESERVED',JSON.stringify({...data,version:2,attempt}),op.id);f.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)',admissionId,op.id,admission.kind,JSON.stringify(admission));f.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?',f.request.workId,'execution');f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,f.request.workId,1,1,'CREATED',namespace.clientRoot,'reserved',JSON.stringify(runData));});
 const event=(id,value)=>f.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)',id,op.id,value.kind,JSON.stringify(value));
 const update=(phase='RESERVED')=>f.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?',phase,JSON.stringify({...data,version:2,attempt}),op.id);
 const run=(phase='CREATED',reservation='reserved')=>f.s.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?',phase,reservation,JSON.stringify(runData),runId);
 const admit=async()=>{const lease=await new Capacity(f.s,1,f.home,f.c.releaseOwner).acquire({workId:f.request.workId,runId,epoch:1,kind:'check'});Object.assign(runData,JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',runId).data));return lease;};
 const inspect=()=>inspectSourceSnapshotRecord(f.s,f.home,op.id);
 const prepared={protocol:'source-branch-prepared/v1',clientRoot:namespace.clientRoot,commandId:randomUUID(),descriptorSha256:sha,descriptorIdentity:'original-descriptor',commandDirectoryIdentity:'original-command-directory',operationId:op.id,integrationCommit:f.anchor.projectedCommit,destinationRef:f.anchor.destinationRef,tree:f.anchor.projectedTree,basisCommit:f.anchor.basisCommit};
 const command=(stdout,id=randomUUID())=>({argv:sourceGitArguments(f.anchor.commonDirectory,['show-ref','--verify','--hash',f.anchor.destinationRef]),exitCode:0,stdout,stderr:'',truncated:false,timedOut:false,aborted:false,settled:true,stdoutBytes:Buffer.byteLength(stdout),stdoutSha256:createHash('sha256').update(stdout).digest('hex'),stdoutExcerpted:false,commandId:id,journalPath:path.join(namespace.clientRoot,'runs',id),launcherPid:100,gitPid:101,gitStarted:true,cleanup:'confirmed'});
 return{...f,op,data,common,attempt,runId,admissionId,runData,event,update,run,inspect,prepared,command,namespace,admit};
}

test('source reserved run uses actual capacity without activating delivered work; malformed family cannot borrow ACTIVE fallback',async t=>{
 const f=await recordedAttempt(t),before=f.s.one('SELECT * FROM works WHERE id=?',f.request.workId);
 assert.equal(f.inspect().state,'RETAINED',f.inspect().reason);
 const capacity=new Capacity(f.s,1,f.home,f.c.releaseOwner),lease=await capacity.acquire({workId:f.request.workId,runId:f.runId,epoch:1,kind:'check'});
 assert.equal(f.s.one('SELECT state FROM capacity_leases WHERE id=?',lease.id).state,'ADMITTED');assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.request.workId),before);
 lease.release({cleanup:'not-allocated',settled:true});
 const f2=await recordedAttempt(t);f2.s.run("UPDATE works SET state='ACTIVE' WHERE id=?",f2.request.workId);const c2=new Capacity(f2.s,1,f2.home,f2.c.releaseOwner);
 for(const mutate of [d=>delete d.nativeFamily,d=>d.nativeFamily='unknown-source',d=>d.familyVersion=2,d=>d.attemptRevision=2,d=>d.nativeGate='enabled',d=>d.retainedIntegrationRead=true,d=>d.readOnlyObservation=false,d=>d.operationId='source-preview-'+randomUUID()]){
  const saved=structuredClone(f2.runData);mutate(f2.runData);f2.run();assert.throws(()=>c2.acquire({workId:f2.request.workId,runId:f2.runId,epoch:1,kind:'check'}),/stale work\/run/);Object.keys(f2.runData).forEach(k=>delete f2.runData[k]);Object.assign(f2.runData,saved);f2.run();assert.equal(f2.s.one('SELECT COUNT(*) n FROM capacity_leases').n,0);
 }
 f2.attempt.runId=randomUUID();f2.update();assert.throws(()=>c2.acquire({workId:f2.request.workId,runId:f2.runId,epoch:1,kind:'check'}),/stale work\/run/);
});

test('actual queued source cancellation atomically retains readable qualified no-birth cleanup and refunds once',async t=>{
 const f=await recordedAttempt(t),capacity=new Capacity(f.s,1,f.home,f.c.releaseOwner),signal=new AbortController();
 f.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','capacity-occupant','P','controlled-source',null,'capacity-occupant','ACTIVE',1,1,null,'{}');
 f.s.run('INSERT INTO budgets VALUES(?,?,?,?,?)','capacity-occupant','execution',1,0,1);
 f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','capacity-occupant-run','capacity-occupant',1,1,'CREATED',f.root,'reserved','{}');
 const occupied=await capacity.acquire({workId:'capacity-occupant',runId:'capacity-occupant-run',epoch:1,kind:'check'});
 const waiting=capacity.acquire({workId:f.request.workId,runId:f.runId,epoch:1,kind:'check',signal:signal.signal});
 assert.equal(f.s.one('SELECT phase FROM runs WHERE id=?',f.runId).phase,'WAITING_CAPACITY');signal.abort();await assert.rejects(waiting,/interrupted before capacity/);
 const original=f.inspect();assert.equal(original.state,'RETAINED',original.reason);assert.equal(original.recordedPhase,'RESERVED');assert.equal(original.nativeAttempt.attempt.intentId,null);
 const run=f.s.one('SELECT * FROM runs WHERE id=?',f.runId);assert.equal(run.phase,'INTERRUPTED');assert.equal(run.reservation,'released');assert.equal(JSON.parse(run.data).cleanup,'not-allocated');
 assert.equal(f.s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.request.workId).consumed,8);assert.equal(f.s.one("SELECT reserved FROM budgets WHERE lineage=? AND kind='execution'",f.request.workId).reserved,0);
 const before=f.rows();signal.abort();assert.equal(f.rows(),before);occupied.release({cleanup:'not-allocated',settled:true});
});

test('closed historical writer metadata cannot borrow a different current state-directory scope for admission',async t=>{
 const f=await recordedAttempt(t),capacity=new Capacity(f.s,1,f.home,f.c.releaseOwner);
 for(const row of f.s.all('SELECT * FROM effect_receipts WHERE operation=?',f.op.id)){
  const event=JSON.parse(row.data);event.writer.owner.stateInode='999999999999';f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(event),row.id);
 }
 assert.equal(f.inspect().state,'RETAINED','historical internal correspondence alone is insufficient');
 assert.throws(()=>capacity.acquire({workId:f.request.workId,runId:f.runId,epoch:1,kind:'check'}),/stale work\/run/);assert.equal(f.s.one('SELECT COUNT(*) n FROM capacity_leases').n,0);
});

test('bounded startup normalizes terminal source attempts without a settlement to UNKNOWN without replay or new facts',async t=>{
 for(const phase of ['RESERVED','INVOKING']){
  const f=await recordedAttempt(t),lease=await f.admit();f.runData.nativeGate='enabled';f.runData.cleanup='removed';
  if(phase==='INVOKING'){f.attempt.intentId=randomUUID();f.event(f.attempt.intentId,{...f.common,kind:'source-native-send-intent',admissionId:f.admissionId,prepared:f.prepared});f.update(phase);}
  f.c.settleBudget(f.runId);f.run('SETTLED','consumed');lease.release({cleanup:'removed',settled:true});
  const before={receipts:f.s.all('SELECT * FROM effect_receipts'),budgets:f.s.all('SELECT * FROM budgets'),runs:f.s.all('SELECT * FROM runs'),works:f.s.all('SELECT * FROM works'),operation:{...f.s.one('SELECT * FROM effect_operations')}};
  await f.actions.restorePhysicalHolds();const retained=f.inspect();assert.equal(retained.state,'RETAINED',retained.reason);assert.equal(retained.recordedPhase,'UNKNOWN');assert.equal(retained.nativeAttempt.settlement,null);
  assert.deepEqual({receipts:f.s.all('SELECT * FROM effect_receipts'),budgets:f.s.all('SELECT * FROM budgets'),runs:f.s.all('SELECT * FROM runs'),works:f.s.all('SELECT * FROM works'),operation:{...f.s.one('SELECT * FROM effect_operations'),phase:before.operation.phase}},before);
  const normalized=f.rows();await f.actions.restorePhysicalHolds();assert.equal(f.rows(),normalized);
 }
});

async function recordedRead(t){
 const f=await recordedAttempt(t,'sha1',10),createLease=await f.admit();f.runData.nativeGate='enabled';f.runData.cleanup='removed';
 f.attempt.intentId=randomUUID();f.event(f.attempt.intentId,{...f.common,kind:'source-native-send-intent',admissionId:f.admissionId,prepared:f.prepared});
 f.c.settleBudget(f.runId);f.run('SETTLED','consumed');createLease.release({cleanup:'removed',settled:true});
 f.attempt.settlementId=randomUUID();f.event(f.attempt.settlementId,{...f.common,kind:'source-native-settlement',admissionId:f.admissionId,intentId:f.attempt.intentId,prepared:f.prepared,send:null,readback:null,cleanup:'removed',classification:'unknown',reason:'Controlled original uncertainty'});f.update('UNKNOWN');
 const original=f.inspect(),pointer={id:randomUUID(),runId:randomUUID(),admissionId:randomUUID(),settlementId:null},work=sourceReadWork(f.s,f.request.workId);
 const admission={protocol:'source-native-read/v1',kind:'source-native-read-admission',operationId:f.op.id,adoptionId:f.data.adoption,bindingDigest:hash(f.anchor),readId:pointer.id,runId:pointer.runId,writer:f.common.writer,work,creationIntentId:f.attempt.intentId,prepared:f.prepared,originalAttemptDigest:hash(f.attempt),initializedDigest:f.anchor.initializedDigest,namespace:f.namespace,profileDigest:sha,reviewFingerprint:'b'.repeat(64)};
 const readData={kind:'native-effect',nativeFamily:'source-snapshot',familyVersion:1,sourcePurpose:'read',operationId:f.op.id,clientRoot:f.namespace.clientRoot,controllerPid:process.pid,bindingDigest:hash(f.anchor),nativeReadId:pointer.id,nativeReadAdmissionId:pointer.admissionId,readWorkDigest:hash(work),nativeGate:'unopened',admission:'never-admitted'};
 f.s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...f.data,version:3,attempt:f.attempt,creationPhase:'UNKNOWN',reads:[pointer]}),f.op.id);f.event(pointer.admissionId,admission);f.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?',work.lineage,'execution');f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',pointer.runId,work.id,work.epoch,work.generation,'CREATED',f.namespace.clientRoot,'reserved',JSON.stringify(readData));
 const capacity=new Capacity(f.s,1,f.home,f.c.releaseOwner),lease=await capacity.acquire({workId:work.id,runId:pointer.runId,epoch:work.epoch,kind:'check'});Object.assign(readData,JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',pointer.runId).data));readData.nativeGate='enabled';readData.cleanup='removed';f.c.settleBudget(pointer.runId);f.s.run('UPDATE runs SET phase=?,data=? WHERE id=?','SETTLED',JSON.stringify(readData),pointer.runId);lease.release({cleanup:'removed',settled:true});
 const settlement={protocol:'source-native-read/v1',kind:'source-native-read-settlement',operationId:f.op.id,adoptionId:f.data.adoption,bindingDigest:hash(f.anchor),readId:pointer.id,runId:pointer.runId,writer:f.common.writer,admissionId:pointer.admissionId,readback:{kind:'confirmed-creation',currentCommit:f.anchor.projectedCommit,commands:[f.command(f.anchor.projectedCommit+'\n')]},policy:{fingerprint:sha,commonDirectory:f.anchor.commonDirectory,device:f.anchor.device,inode:f.anchor.inode,ownerUid:process.getuid(),routeDigest:f.anchor.routeDigest},cleanup:'removed',classification:'confirmed',reason:'Controlled recorded read; not Native proof'};
 const complete=()=>{pointer.settlementId=randomUUID();f.event(pointer.settlementId,settlement);const data=JSON.parse(f.s.one('SELECT data FROM effect_operations WHERE id=?',f.op.id).data);f.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','CONFIRMED',JSON.stringify({...data,reads:[pointer]}),f.op.id);};
 return{...f,original,pointer,admission,readData,settlement,lease,complete};
}

test('closed recorded read resolution preserves creation uncertainty and rejects foreign/oversized read facts',async t=>{
 const f=await recordedRead(t);f.complete();const original=f.inspect();assert.equal(original.state,'RETAINED',original.reason);assert.equal(original.recordedPhase,'CONFIRMED');assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.equal(original.resolution.pointer.id,f.pointer.id);
 const event=f.s.one('SELECT * FROM effect_receipts WHERE id=?',f.pointer.settlementId),admission=f.s.one('SELECT * FROM effect_receipts WHERE id=?',f.pointer.admissionId),op=f.s.one('SELECT * FROM effect_operations'),lease=f.s.one('SELECT * FROM capacity_leases WHERE id=?',f.lease.id);
 for(const mutate of [v=>v.readback.kind='observed-desired-state',v=>v.readback.commands[0].argv[0]='--git-dir=/foreign',v=>v.readback.commands[0].aborted=true,v=>v.policy.routeDigest='c'.repeat(64),v=>v.readId=randomUUID(),v=>v.cleanup='quarantined',v=>v.send={handoff:'started'}]){const changed=JSON.parse(event.data);mutate(changed);f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(changed),event.id);assert.equal(f.inspect().state,'UNAVAILABLE');}f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',event.data,event.id);
 for(const mutate of [v=>v.prepared.descriptorSha256='c'.repeat(64),v=>v.work.epoch++,v=>v.originalAttemptDigest='c'.repeat(64),v=>v.writer.database.inode='foreign']){const changed=JSON.parse(admission.data);mutate(changed);f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(changed),admission.id);assert.equal(f.inspect().state,'UNAVAILABLE');}f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',admission.data,admission.id);
 f.s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(op.data),creationPhase:'CONFIRMED'}),op.id);assert.equal(f.inspect().state,'UNAVAILABLE');f.s.run('UPDATE effect_operations SET data=? WHERE id=?',op.data,op.id);
 const all=f.s.all.bind(f.s);let bounded=false;f.s.all=(sql,...args)=>{const rows=all(sql,...args);if(sql.includes('FROM capacity_leases WHERE run=?')&&args[0]===f.pointer.runId){bounded=true;assert.equal(rows[0].data,null);}return rows;};
 try{f.s.run('UPDATE capacity_leases SET data=? WHERE id=?','x'.repeat(65537),lease.id);assert.equal(f.inspect().state,'UNAVAILABLE');assert.equal(bounded,true);}finally{f.s.all=all;f.s.run('UPDATE capacity_leases SET data=? WHERE id=?',lease.data,lease.id);}
 assert.deepEqual(f.inspect(),original);
});

test('terminal read recovery retains UNKNOWN without query, and resolved source rows do not hide later receiver holds',async t=>{
 const f=await recordedRead(t),before={runs:f.s.all('SELECT * FROM runs'),budgets:f.s.all('SELECT * FROM budgets'),works:f.s.all('SELECT * FROM works')};await f.actions.restorePhysicalHolds();const recovered=f.inspect();assert.equal(recovered.state,'RETAINED',recovered.reason);assert.equal(recovered.recordedPhase,'UNKNOWN');assert.equal(recovered.nativeReads[0].settlement.classification,'unknown');assert.equal(recovered.nativeReads[0].settlement.readback,null);assert.deepEqual({runs:f.s.all('SELECT * FROM runs'),budgets:f.s.all('SELECT * FROM budgets'),works:f.s.all('SELECT * FROM works')},before);
 const g=await recordedRead(t);g.complete();const endpoint={family:'source-snapshot',target:{ref:g.anchor.destinationRef,canonicalPath:g.anchor.commonDirectory,device:g.anchor.device,inode:g.anchor.inode}};assert.deepEqual(receiverTransmissionHolds(g.s,endpoint,null,1),[]);
 const targetId=randomUUID(),grantId=randomUUID(),operationId='source-preview-'+randomUUID();g.s.run('INSERT INTO effect_targets VALUES(?,?,?)',targetId,'P',JSON.stringify({kind:'source-snapshot',version:1,targetId,binding:{...g.anchor,operationId}}));g.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',grantId,g.request.workId,targetId,1,JSON.stringify({kind:'source-snapshot'}));g.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',operationId,g.request.workId,targetId,grantId,'UNKNOWN',JSON.stringify({kind:'source-snapshot'}));assert.equal(receiverTransmissionHolds(g.s,endpoint,null,1)[0].id,operationId,'caller LIMIT follows full source correspondence');
 g.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','foreign-capacity','P',g.anchor.sourceId,null,'foreign-capacity','ACTIVE',1,1,null,'{}');g.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','foreign-capacity-run','foreign-capacity',1,1,'CREATED',g.root,'consumed','{}');g.s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',randomUUID(),'foreign-capacity','foreign-capacity-run',1,999,'UNRECOGNIZED','{}');assert.ok(g.actions.readContext(g.inspect()).holds.some(h=>h.includes('capacity provenance unavailable')));
});

for(const format of ['sha1','sha256'])test(format+' recorded source confirmation rejects failed/noncausal porcelain and broken readback',async t=>{
 const f=await recordedAttempt(t,format),lease=await f.admit();f.runData.nativeGate='enabled';f.runData.cleanup='removed';f.runData.admission='admitted';f.run('SETTLED','consumed');lease.release({cleanup:'removed',settled:true});
 f.attempt.intentId=randomUUID();f.event(f.attempt.intentId,{...f.common,kind:'source-native-send-intent',admissionId:f.admissionId,prepared:f.prepared});
 const stdout='To /controlled/source\n*\t'+f.anchor.projectedCommit+':'+f.anchor.destinationRef+'\t[new branch]\nDone\n';
 const settlement={...f.common,kind:'source-native-settlement',admissionId:f.admissionId,intentId:f.attempt.intentId,prepared:f.prepared,send:{operationId:f.op.id,handoff:'started',outcome:'created',integrationCommit:f.anchor.projectedCommit,destinationRef:f.anchor.destinationRef,command:f.command(stdout,f.prepared.commandId)},readback:{kind:'confirmed-creation',currentCommit:f.anchor.projectedCommit,commands:[f.command(f.anchor.projectedCommit+'\n')]},cleanup:'removed',classification:'confirmed',reason:'Controlled recorded correspondence only'};
 settlement.send.command.argv=sourceGitArguments(path.join(f.prepared.clientRoot,'client.git'),sourcePushArguments(f.namespace.gitBinary,{integrationCommit:f.anchor.projectedCommit,target:{canonicalPath:f.anchor.projectRoot,destinationRef:f.anchor.destinationRef}}));
 f.attempt.settlementId=randomUUID();f.event(f.attempt.settlementId,settlement);f.update('CONFIRMED');
 assert.equal(f.inspect().state,'RETAINED',f.inspect().reason);assert.equal(f.inspect().nativeOutcome,'not-inspected');assert.equal(f.inspect().recordedOutcome,'confirmed');
 const faults=[v=>v.send.command.argv=['unrelated-command'],v=>v.send.command.argv[0]='--git-dir=/foreign',v=>v.readback.commands[0].argv[0]='--git-dir=/foreign',v=>v.send.command.exitCode=1,v=>v.send.command.aborted=true,v=>v.send.command.timedOut=true,v=>v.send.command.truncated=true,v=>v.send.command.stdoutExcerpted=true,v=>v.send.command.settled=false,v=>v.send.command.gitStarted=false,v=>v.send.command.gitPid=null,v=>v.send.command.launcherPid=null,v=>v.send.command.commandId=randomUUID(),v=>v.send.command.extra='future',v=>v.send.operationId='foreign',v=>v.send.command.stdout=v.send.command.stdout.replace('*\t','=\t'),v=>v.send.command.stdout=v.send.command.stdout.replace('[new branch]','[up to date]'),v=>v.send.command.stdout=v.send.command.stdout.replace('[new branch]','[new branch]\textra'),v=>v.send.command.stdoutSha256='b'.repeat(64),v=>v.readback.commands=[],v=>v.readback.commands[0].stdout='2'.repeat(f.anchor.projectedCommit.length)+'\n',v=>v.readback.commands[0].argv=['show-ref','--verify','--hash','refs/heads/foreign'],v=>v.readback.kind='observed-desired-state',v=>v.prepared.descriptorIdentity='',v=>v.writer.database.inode='different'];
 for(const fault of faults){const changed=structuredClone(settlement);fault(changed);f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(changed),f.attempt.settlementId);assert.equal(f.inspect().state,'UNAVAILABLE',JSON.stringify(changed));}
 f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(settlement),f.attempt.settlementId);assert.equal(f.inspect().state,'RETAINED');
});

test('recorded unsent never overrides handoff contradictions, malformed proof or spent enabled gate',async t=>{
 const f=await recordedAttempt(t);f.runData.cleanup='not-allocated';f.runData.admission='never-admitted';f.run('INTERRUPTED','released');
 const settlement={...f.common,kind:'source-native-settlement',admissionId:f.admissionId,intentId:null,prepared:null,send:null,readback:null,cleanup:'not-allocated',classification:'definitely-unsent',reason:'Controlled unopened qualified writer premise; not Native evidence'};
 f.attempt.settlementId=randomUUID();f.event(f.attempt.settlementId,settlement);f.update('REFUSED');assert.equal(f.inspect().state,'RETAINED',f.inspect().reason);
 const started={operationId:f.op.id,handoff:'started',outcome:'created',integrationCommit:f.anchor.projectedCommit,destinationRef:f.anchor.destinationRef,command:f.command('')};
 for(const patch of [{send:started},{prepared:f.prepared},{send:{...started,handoff:'not-started',outcome:'refused',notStarted:{commandId:f.prepared.commandId,descriptorSha256:sha,terminalSha256:'bad'}}},{readback:{kind:'unknown',currentCommit:null,commands:[]}}]){f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify({...settlement,...patch}),f.attempt.settlementId);assert.equal(f.inspect().state,'UNAVAILABLE');}
 f.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(settlement),f.attempt.settlementId);f.runData.nativeGate='enabled';f.run('INTERRUPTED','released');assert.equal(f.inspect().state,'UNAVAILABLE');
 const g=await recordedAttempt(t,'sha1',10),lease=await g.admit();g.runData.nativeGate='enabled';g.runData.cleanup='removed';g.c.settleBudget(g.runId);g.run('SETTLED','consumed');lease.release({cleanup:'removed',settled:true});g.attempt.intentId=randomUUID();g.event(g.attempt.intentId,{...g.common,kind:'source-native-send-intent',admissionId:g.admissionId,prepared:g.prepared});
 const noLaunch={...g.common,kind:'source-native-settlement',admissionId:g.admissionId,intentId:g.attempt.intentId,prepared:g.prepared,readback:null,cleanup:'removed',classification:'definitely-unsent',reason:'Controlled no-launch reference',send:{operationId:g.op.id,handoff:'not-started',outcome:'refused',integrationCommit:g.anchor.projectedCommit,destinationRef:g.anchor.destinationRef,notStarted:{commandId:g.prepared.commandId,descriptorSha256:sha,terminalSha256:sha}}};g.attempt.settlementId=randomUUID();g.event(g.attempt.settlementId,noLaunch);g.update('REFUSED');assert.equal(g.inspect().state,'RETAINED',g.inspect().reason);
 const beforeReadReview=g.rows(),readContext=g.actions.readContext(g.inspect());assert.deepEqual(readContext.holds,['Original creation is neither uncertain nor confirmed; result check unavailable']);assert.equal(g.rows(),beforeReadReview,'Free read eligibility creates no query, reservation or receipt');
 for(const mutate of [v=>v.send.notStarted.terminalSha256='bad',v=>v.send.notStarted.extra=true,v=>v.send.notStarted.descriptorSha256='b'.repeat(64),v=>v.send.integrationCommit='2'.repeat(40),v=>v.send.destinationRef='refs/heads/foreign',v=>delete v.send.notStarted]){const changed=structuredClone(noLaunch);mutate(changed);g.s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(changed),g.attempt.settlementId);assert.equal(g.inspect().state,'UNAVAILABLE');}
});

test('resource restoration needs positive original cleanup and preserves historical send uncertainty',async t=>{
 const f=await recordedAttempt(t),lease=await f.admit();f.runData.nativeGate='enabled';f.runData.admission='admitted';f.runData.cleanup='quarantined';f.run('UNKNOWN','consumed');
 f.attempt.settlementId=randomUUID();const settlement={...f.common,kind:'source-native-settlement',admissionId:f.admissionId,intentId:null,prepared:null,send:null,readback:null,cleanup:'quarantined',classification:'unknown',reason:'Controlled physical uncertainty'};f.event(f.attempt.settlementId,settlement);f.update('UNKNOWN');
 const holdId=randomUUID(),restoredId=randomUUID();f.event(holdId,{...f.common,kind:'source-native-resource-hold',admissionId:f.admissionId,priorState:'DELIVERED'});f.event(restoredId,{...f.common,kind:'source-native-resource-restored',admissionId:f.admissionId,holdId});assert.equal(f.inspect().state,'UNAVAILABLE');
 f.runData.cleanup='removed';f.run('SETTLED','consumed');assert.equal(f.inspect().state,'UNAVAILABLE','run cleanup alone cannot restore held capacity');lease.release({cleanup:'removed',settled:true});const original=f.inspect();assert.equal(original.state,'RETAINED',original.reason);assert.equal(original.nativeAttempt.restored,true);assert.equal(original.nativeOutcome,'not-inspected');assert.equal(original.recordedOutcome,'unknown');assert.equal(original.recordedPhase,'UNKNOWN');assert.equal(f.s.one('SELECT data FROM effect_receipts WHERE id=?',f.attempt.settlementId).data,JSON.stringify(settlement));
 const capacity=f.s.one('SELECT * FROM capacity_leases WHERE id=?',lease.id);
 for(const receipt of [undefined,{cleanup:'removed',settled:false},{cleanup:'quarantined',settled:true}]){const changed={...JSON.parse(capacity.data),receipt};f.s.run('UPDATE capacity_leases SET data=? WHERE id=?',JSON.stringify(changed),lease.id);assert.equal(f.inspect().state,'UNAVAILABLE','a RELEASED label without positive original receipt is insufficient');}
 f.s.run('UPDATE capacity_leases SET data=? WHERE id=?',capacity.data,lease.id);assert.equal(f.inspect().state,'RETAINED');
 f.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)',randomUUID(),f.op.id,'future-source-event','{}');assert.equal(f.inspect().state,'UNAVAILABLE');
});

for(const format of ['sha1','sha256'])test(format+' actual atomic internal adoption binds one original and remains historical after cancellation',async t=>{
 const f=await world(t,format),review=await f.actions.review(f.request);assert.equal(review.kind,'review');assert.equal(review.canAdopt,true,review.holds.join(';'));
 const oldBudgets=f.s.all('SELECT * FROM budgets'),oldWork=f.s.one('SELECT * FROM works WHERE id=?',f.request.workId);
 const result=await f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){}});assert.equal(result.state,'RETAINED',result.reason);assert.equal(result.binding.operationId,f.anchor.operationId);assert.equal(result.nativeOutcome,'not-inspected');
 assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_targets').n,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_delegations').n,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_operations').n,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_receipts').n,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM runs').n,0);assert.deepEqual(f.s.all('SELECT * FROM budgets'),oldBudgets);assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.request.workId),oldWork);
 const before=f.rows();assert.deepEqual(await f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){throw Error('A repeat must not authorize again');}}),result);assert.equal(f.rows(),before);
 f.s.run("UPDATE works SET state='CANCELLED',epoch=epoch+1 WHERE id=?",f.request.workId);f.invalidate();assert.equal(f.actions.inspect(result.operationId).state,'RETAINED');assert.deepEqual(await f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){throw Error('No renewed owner permission');}}),result);
 await assert.rejects(f.actions.adopt({...f.request,expectedReviewFingerprint:'b'.repeat(64)},{validate(){}}),/already exists/);
 assert.equal(listSourceSnapshotRecords(f.s,f.home).operations[0].operationId,result.operationId);
 assert.deepEqual(listIntegrationTargets(f.s).targets,[]);assert.deepEqual(listRetainedIntegrations(f.s,{},()=>{throw Error('Old parser must not consume a source record');}).operations,[]);
});

test('exhausted review stays free and every insert rollback leaves no partial permission',async t=>{
 for(const fault of ['zero','async','falsey','drift','rollback-target','rollback-grant','rollback-operation','rollback-receipt']){
  const f=await world(t);if(fault==='zero')f.s.run("UPDATE budgets SET consumed=lim WHERE kind='execution'");const review=await f.actions.review(f.request),before=f.rows();
  if(fault==='zero')assert.equal(review.canAdopt,false);
  const run=f.s.run.bind(f.s);f.s.run=(sql,...args)=>{const table=fault.slice('rollback-'.length);if(fault.startsWith('rollback-')&&sql.startsWith('INSERT INTO effect_'+({target:'targets',grant:'delegations',operation:'operations',receipt:'receipts'}[table])))throw Error('CONTROLLED_TX_FAILURE');return run(sql,...args);};
  try{await assert.rejects(f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate: fault==='async'?async()=>{}:fault==='falsey'?()=>{throw 0;}:fault==='drift'?()=>{f.invalidate();}:()=>{}}));}finally{f.s.run=run;}
  assert.equal(f.rows(),before,fault);
 }
});

test('concurrent duplicate confirmation preserves one grant and one committed allocation notification',async t=>{
 const f=await world(t),review=await f.actions.review(f.request);let notices=0;
 const results=await Promise.all([1,2].map(()=>f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){},onAllocated(){notices++;}})));
 assert.deepEqual(results[0],results[1]);assert.equal(notices,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_operations').n,1);assert.equal(f.s.one('SELECT COUNT(*) n FROM effect_delegations').n,1);
});

test('committed notification failure preserves exact original, malformed tuple/phase/receipt never becomes native success',async t=>{
 const f=await world(t),review=await f.actions.review(f.request);
 await assert.rejects(f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){},onAllocated(){throw Error('PRESENTATION_FAILED');}}),/retained after owner notification/);
 const original=f.actions.inspect(f.anchor.operationId);assert.equal(original.state,'RETAINED');const op=f.s.one('SELECT * FROM effect_operations'),grant=f.s.one('SELECT * FROM effect_delegations'),event=f.s.one('SELECT * FROM effect_receipts'),version=f.s.one('SELECT * FROM change_versions');
 const alterations=[['effect_operations','data',JSON.stringify({...JSON.parse(op.data),version:2}),op.data],['effect_operations','phase','CONFIRMED',op.phase],['effect_delegations','data',JSON.stringify({...JSON.parse(grant.data),scope:'delegation-lineage'}),grant.data],['effect_receipts','data',JSON.stringify({...JSON.parse(event.data),workId:'sibling'}),event.data],['change_versions','data',JSON.stringify({...JSON.parse(version.data),initializedDigest:'0'.repeat(64)}),version.data]];
 for(const [table,column,changed,saved] of alterations){f.s.run('UPDATE '+table+' SET '+column+'=?',changed);assert.equal(inspectSourceSnapshotRecord(f.s,f.home,f.anchor.operationId).state,'UNAVAILABLE');f.s.run('UPDATE '+table+' SET '+column+'=?',saved);}
 assert.deepEqual(f.actions.inspect(f.anchor.operationId),original);
});

test('source common directory endpoint aliases normalize before LIMIT; broken initial scope remains held',async t=>{
 const f=await world(t),review=await f.actions.review(f.request);await f.actions.adopt({...f.request,expectedReviewFingerprint:review.fingerprint},{validate(){}});
 const endpoint={family:'source-snapshot',target:{canonicalPath:f.anchor.commonDirectory,device:f.anchor.device,inode:f.anchor.inode,ref:f.anchor.destinationRef}},holds=()=>receiverTransmissionHolds(f.s,endpoint,null,1);
 assert.deepEqual(holds(),[],'closed initial adoption has no attempt');
 const grant=f.s.one('SELECT * FROM effect_delegations'),target=f.s.one('SELECT * FROM effect_targets');
 f.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','sibling','P','controlled-source',null,'sibling','ACTIVE',1,1,null,'{}');
 for(const changed of [{root:'sibling'}, {data:JSON.stringify({...JSON.parse(grant.data),scope:'delegation-lineage'})}, {data:'x'.repeat(65537)}]){
  for(const [column,value]of Object.entries(changed))f.s.run('UPDATE effect_delegations SET '+column+'=? WHERE id=?',value,grant.id);
  assert.equal(holds()[0].id,f.anchor.operationId);assert.equal(receiverTransmissionHolds(f.s,{...endpoint,family:'local-git'},null,1)[0].id,f.anchor.operationId);
  f.s.run('UPDATE effect_delegations SET root=?,data=? WHERE id=?',grant.root,grant.data,grant.id);
 }
 for(const changed of ['{malformed',JSON.stringify({...JSON.parse(target.data),binding:{...f.anchor,commonDirectory:null}})]){f.s.run('UPDATE effect_targets SET data=? WHERE id=?',changed,target.id);assert.equal(holds()[0].unavailable,1);f.s.run('UPDATE effect_targets SET data=? WHERE id=?',target.data,target.id);}
 const original=f.s.one('SELECT * FROM effect_operations');f.s.db.exec('PRAGMA foreign_keys=OFF');try{f.s.run('UPDATE effect_operations SET target=? WHERE id=?','missing-target',original.id);assert.equal(holds()[0].unavailable,1);assert.equal(receiverTransmissionHolds(f.s,{...endpoint,family:'local-git'},null,1)[0].unavailable,1);}finally{f.s.run('UPDATE effect_operations SET target=? WHERE id=?',original.target,original.id);f.s.db.exec('PRAGMA foreign_keys=ON');}
 const corpus=(binding,kind='source-snapshot')=>{
  const tid=randomUUID(),gid=randomUUID(),id='source-preview-'+randomUUID(),data={kind,version:1,targetId:tid,binding:{...binding,operationId:id}};
  f.s.run('INSERT INTO effect_targets VALUES(?,?,?)',tid,'P',JSON.stringify(kind==='local-git'?{kind,target:{targetId:tid,canonicalPath:binding.commonDirectory,device:binding.device,inode:binding.inode,ref:binding.destinationRef}}:data));
  f.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',gid,f.request.workId,tid,1,JSON.stringify({...JSON.parse(grant.data),kind}));
  f.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',id,f.request.workId,tid,gid,'UNKNOWN',JSON.stringify({kind,dispatchRun:1}));return id;
 };
 // Controlled identity corpus, not source authority or native observations.
 for(let i=0;i<140;i++)corpus({...f.anchor,commonDirectory:path.join(f.root,'independent-'+i,'.git'),device:'999',inode:String(i+1)});
 const alias=corpus({...f.anchor,device:'different',inode:'different'});assert.equal(holds()[0].id,alias,'path alias after140 unrelated originals must not disappear behind LIMIT');
 const all=f.s.all.bind(f.s);f.s.all=(...args)=>{const rows=all(...args);if(String(args[0]).includes('native_targets'))assert.ok(rows.every(row=>!Object.hasOwn(row,'targetData')));return rows;};
 try{assert.equal(receiverTransmissionHolds(f.s,{...endpoint,family:'local-git'},null,1)[0].id,alias);}finally{f.s.all=all;}
 f.s.run('DELETE FROM effect_operations WHERE id=?',alias);
 const bare=corpus({...f.anchor,commonDirectory:path.join(f.root,'renamed.git')},'local-git');assert.equal(holds()[0].id,bare,'native directory dev/ino alias joins bare receiver');
 const different={...endpoint,target:{...endpoint.target,ref:'refs/heads/independent'}};assert.deepEqual(receiverTransmissionHolds(f.s,different,null,1),[]);
});

test('oversized pending identity is only an existence hold and malformed original pages remain bounded',async t=>{
 const f=await world(t),id='x'.repeat(65536);f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',id,f.request.workId,1,1,'UNKNOWN','/controlled-not-a-producer','reserved','{}');
 const review=await f.actions.review(f.request);assert.equal(review.canAdopt,false);assert.ok(Buffer.byteLength(JSON.stringify(review))<8192);f.s.run('DELETE FROM runs WHERE id=?',id);
 const healthy=await f.actions.review(f.request);await f.actions.adopt({...f.request,expectedReviewFingerprint:healthy.fingerprint},{validate(){}});
 const original=f.s.one('SELECT * FROM effect_operations');f.s.db.exec('PRAGMA foreign_keys=OFF');try{f.s.run('UPDATE effect_operations SET id=? WHERE id=?',id,original.id);}finally{f.s.db.exec('PRAGMA foreign_keys=ON');}
 const page=listSourceSnapshotRecords(f.s,f.home,{limit:1});assert.equal(page.operations[0].state,'UNAVAILABLE');assert.equal(page.operations[0].operationId,null);assert.match(page.operations[0].reason,/rowid/);assert.ok(Buffer.byteLength(JSON.stringify(page))<2048);
});

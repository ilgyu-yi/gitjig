import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runtimeFixtureConfig,runtimeFixtureProfile,runtimeFixtureRoot} from '../runtime/profile.mjs';
import {stageCheckAmendmentModel} from './check-amendment-model.mjs';
const execute=promisify(execFile);

test('owned installed Controller drives legitimate checker recovery with native SDK and captured checks, then reopens exact proof through installed CLI',{timeout:60000},async t=>{
 assert.ok(process.env.GITJIG_INSTALL_RECEIPT,'Explicit installed candidate required');
 const shared=await runtimeFixtureRoot();
 const runtimeProfile={...runtimeFixtureProfile(),dockerConfigDirectory:runtimeFixtureConfig()};
 const {home,payloadId}=JSON.parse(await fs.readFile(process.env.GITJIG_INSTALL_RECEIPT,'utf8'));
 const payload=path.join(home,'versions',payloadId),node=path.join(home,'bootstrap/node');
 const root=await fs.mkdtemp(path.join(shared,'installed-workflow-')),source=path.join(root,'source');
 t.diagnostic('Retained installed workflow '+root);
 await fs.mkdir(source);
 await stageCheckAmendmentModel(root,payload);
 const worker=path.join(root,'worker.mjs'),receiptPath=path.join(root,'receipt.json');
 await fs.writeFile(worker,`
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{pathToFileURL}from'node:url';
import{amendmentModel,wrong}from'./controller/check-amendment-fixture.mjs';
const home=${JSON.stringify(home)},source=${JSON.stringify(source)},payload=${JSON.stringify(payload)};
const {openController}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')).href);
await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\\n');await fs.writeFile(path.join(source,'check.cjs'),wrong);
const runtimeProfile=${JSON.stringify(runtimeProfile)};
let c=await openController({installationHome:home,runtimeProfile});let result;
try{
await c.registerProject({id:'installed-recovery',sourceRoot:source});const begin=await c.beginChange({projectId:'installed-recovery',request:'Consumer must export3. Correct the demonstrated incorrect checker without weakening the requirement.',executionLimit:48,resolutionLimit:24}),workId=begin.workId,model=amendmentModel();
await c.planChange({workId,model});await c.implementChange({workId,model});let view=await c.checkChange({workId});assert.equal(view.phase,'REPAIR_REQUIRED');const initialConsumed=view.execution.consumed;
const old=c.store.all('SELECT * FROM obligations WHERE work=?',workId).find(r=>JSON.parse(r.data).kind==='check');assert.ok(old);
await c.repairChange({workId,model});view=await c.checkChange({workId});assert.equal(view.phase,'BLOCKED');view=await c.driveChange({workId,model});assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));const proof=await c.changeCore.currentEvidence(workId);const probe=view.checks.find(r=>r.data.purpose==='fixture-amendment-negative');assert.ok(probe);assert.notEqual(probe.candidate,view.candidateVersion);assert.equal(probe.data.actual.exitCode,0);assert.equal(probe.data.parsed.value.assertions[0].passed,false);assert.ok(view.execution.consumed>initialConsumed);assert.equal(view.execution.reserved,0);assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',old.id).data).state,'resolved');
assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\\n');assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),wrong);
result={home,payloadId:${JSON.stringify(payloadId)},controllerModule:path.join(payload,'dist/controller/index.js'),sdk:path.join(payload,'node_modules/@earendil-works/pi-coding-agent'),workId,candidateVersion:view.candidateVersion,proof,negativeCheckId:probe.id,execution:view.execution,semanticProducer:'scripted deterministic fixture; no model accuracy claim'};
await c.close();c=await openController({installationHome:home,runtimeProfile});assert.equal(c.inspectChange(workId).reviewReady,true);assert.deepEqual(await c.changeCore.currentEvidence(workId),proof);result.reopened=true;await fs.writeFile(${JSON.stringify(receiptPath)},JSON.stringify(result,null,2));
}finally{await c.close();}
`);
 const env={...process.env,TMPDIR:path.join(home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:'',PI_PACKAGE_DIR:''};
 await execute(node,[worker],{cwd:root,env,timeout:45000,maxBuffer:2**20});
 const receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));assert.equal(receipt.reopened,true);
 const inspected=await execute(path.join(home,'gitjig'),['change','inspect','--work',receipt.workId],{cwd:root,env,timeout:10000,maxBuffer:2**20});const view=JSON.parse(inspected.stdout);assert.equal(view.reviewReady,true);assert.equal(view.candidateVersion,receipt.candidateVersion);
 if(process.env.GITJIG_WORKFLOW_RECEIPT)await fs.writeFile(process.env.GITJIG_WORKFLOW_RECEIPT,JSON.stringify({...receipt,root,publicInstalledInspect:true},null,2));
});

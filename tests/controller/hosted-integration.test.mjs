import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {subject,initial} from './hosted-core-fixture.mjs';
import {overrideSet} from './hosted-integration-fixture.mjs';
test('actual hosted ordinary S/C/K projection adopts C prime, reruns actual checks/review and commits one conditional native update',{timeout:90000},async t=>{
 const f=await subject();try{
  await assert.rejects(f.c.registerHostedIntegrationTarget(f.registration),/HOSTED_GIT_DISABLED/);assert.equal(f.native.requests.length,0);f.configure();const{targetId}=await f.c.registerHostedIntegrationTarget(f.registration),w=await f.begin();
  f.c.delegateHostedIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:2});const prepared=await f.c.prepareIntegration({workId:w.workId,targetId,model:f.model});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));
  const derived=f.c.inspectChange(w.workId);assert.notEqual(derived.candidateVersion,w.ready.candidateVersion);assert.ok(derived.checks.some(v=>v.candidate===derived.candidateVersion&&v.status==='pass'));assert.ok(derived.launches.some(v=>v.role==='reviewer'&&v.data.inputVersions.candidate===derived.candidateVersion));
  const v=derived.versions.find(v=>v.id===derived.candidateVersion);assert.equal(await fs.readFile(path.join(v.artifact,'consumer.cjs'),'utf8'),initial.replace('exports=2','exports=3'));
  const sent=await f.c.dispatchIntegration({operationId:prepared.operationId});assert.equal(sent.phase,'CONFIRMED',JSON.stringify(sent));assert.equal((await f.native.command(['show','refs/heads/main:consumer.cjs'])).toString(),initial.replace('exports=2','exports=3'));assert.equal(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),initial.replace('choice: 10','choice: 11'));assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,1);assert.ok(f.rest.requests.every(r=>r.authorized));assert.ok(f.native.requests.every(r=>r.authorized));
  t.diagnostic(JSON.stringify({operationId:sent.operationId,candidate:derived.candidateVersion,pushCount:1,transport:sent.transportOutcome,observed:sent.observedOutcome}));f.pass();
 }finally{await f.close();}
});

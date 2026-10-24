import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedNormalHostedIntegrationFixture} from '../../.qualification/controller-testing.js';
import {subject,initial} from './hosted-core-fixture.mjs';
test('normal public profile real S/C/K derived checks and review survive host restart then fresh same-op capture dispatch',{timeout:90000},async t=>{
 const f=await subject({normalNative:true,retainSuccess:true});let resumed;try{
  f.configure();const {targetId}=await f.c.registerHostedIntegrationTarget(f.registration),w=await f.begin();f.c.delegateIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:2});
  const prepared=await f.c.prepareIntegration({workId:w.workId,targetId,model:f.model});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));const before=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',prepared.operationId).data),selected=f.c.inspectChange(w.workId);assert.notEqual(selected.candidateVersion,w.ready.candidateVersion);assert.equal(selected.reviewReady,true);
  await f.c.close();resumed=await openController({installationHome:path.join(f.native.root,'home'),runtimeProfile:{dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE},effectsProfile:{gitBinary:'/opt/homebrew/bin/git'}});
  configureOwnedNormalHostedIntegrationFixture(resumed,{origin:f.rest.origin,token:f.native.token,https:{origin:f.native.origin,caFile:f.native.ca,execPath:f.native.execPath}});
  const sent=await resumed.dispatchIntegration({operationId:prepared.operationId});assert.equal(sent.phase,'CONFIRMED',JSON.stringify(sent));const after=JSON.parse(resumed.store.one('SELECT data FROM effect_operations WHERE id=?',prepared.operationId).data);assert.notEqual(after.authority.credentialSessionId,before.authority.credentialSessionId);assert.equal(after.authority.policy.fingerprint,before.authority.policy.fingerprint);assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,1);assert.equal((await f.native.command(['show','refs/heads/main:consumer.cjs'])).toString(),initial.replace('exports=2','exports=3'));assert.equal(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),initial.replace('choice: 10','choice: 11'));
  t.diagnostic(JSON.stringify({fixture:f.native.root,operationId:sent.operationId,phase:sent.phase,oldCapture:before.authority.credentialSessionId,newCapture:after.authority.credentialSessionId,checks:selected.checks.map(x=>x.status),pushes:1}));f.pass();
 }finally{await resumed?.close();await f.close();}
});

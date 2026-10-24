import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from './hosted-core-fixture.mjs';
import {overrideSet} from './hosted-integration-fixture.mjs';

test('hosted current session/policy/review and cancellation guards refuse before send; exact same operation can recover',{timeout:90000},async()=>{
 const options={sets:[]},f=await subject(options);try{f.configure();const{targetId}=await f.c.registerHostedIntegrationTarget(f.registration),duplicate=await f.c.registerHostedIntegrationTarget(f.registration);assert.equal(duplicate.targetId,targetId);const w=await f.begin();
 const generalized=f.c.delegateIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:4});assert.deepEqual(f.c.delegateHostedIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:4}),generalized);
 f.c.delegateHostedIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:4});const prepare=operationId=>f.c.prepareIntegration({workId:w.workId,targetId,model:f.model,...(operationId?{operationId}:{})});let p=await prepare();assert.equal(p.phase,'RESERVED',JSON.stringify(p));
 const cancelled=await f.c.dispatchIntegration({operationId:p.operationId,signal:AbortSignal.abort()});assert.equal(cancelled.phase,'REFUSED');assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,0);
 p=await prepare(p.operationId);assert.equal(p.phase,'RESERVED',JSON.stringify(p));options.sets=[overrideSet()];const policy=await f.c.dispatchIntegration({operationId:p.operationId});assert.equal(policy.phase,'REFUSED');assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,0);options.sets=[];
 p=await prepare(p.operationId);assert.equal(p.phase,'RESERVED',JSON.stringify(p));f.configure();const session=await f.c.dispatchIntegration({operationId:p.operationId});assert.equal(session.phase,'REFUSED');assert.match(session.blocked.join(' '),/credential session changed/);
 p=await prepare(p.operationId);assert.equal(p.phase,'RESERVED',JSON.stringify(p));const state=f.c.inspectChange(w.workId),review=state.launches.find(l=>l.role==='reviewer'&&l.data.inputVersions.candidate===state.candidateVersion);f.c.store.run('UPDATE role_launches SET status=? WHERE id=?','UNUSABLE',review.id);assert.equal((await f.c.dispatchIntegration({operationId:p.operationId})).phase,'REFUSED');f.c.store.run('UPDATE role_launches SET status=? WHERE id=?',review.status,review.id);
 p=await prepare(p.operationId);assert.equal(p.phase,'RESERVED',JSON.stringify(p));assert.equal((await f.c.dispatchIntegration({operationId:p.operationId})).phase,'CONFIRMED');assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,1);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',targetId).n,1);f.pass();
 }finally{await f.close();}
});

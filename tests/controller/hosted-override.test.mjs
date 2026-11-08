import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {subject,initial} from './hosted-core-fixture.mjs';
import {overrideSet} from './hosted-integration-fixture.mjs';
test('same-account intrinsic review cannot satisfy native PR rule; explicit ALL-set User always override is separately delegated',{timeout:90000},async()=>{
 const f=await subject({sets:[overrideSet(1),overrideSet(2)]});try{f.configure();const{targetId}=await f.c.registerHostedIntegrationTarget(f.registration),ordinary=await f.begin();f.c.delegateHostedIntegration({workId:ordinary.workId,targetId,mode:'ordinary',operationLimit:1});const denied=await f.c.prepareIntegration({workId:ordinary.workId,targetId,model:f.model});assert.equal(denied.phase,'REFUSED');assert.match(denied.blocked.join(' '),/ordinary|platform approval/);assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,0);
 const w=await f.begin();f.c.delegateHostedIntegration({workId:w.workId,targetId,mode:'owner-override',operationLimit:1});const prepared=await f.c.prepareIntegration({workId:w.workId,targetId,model:f.model});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));const sent=await f.c.dispatchIntegration({operationId:prepared.operationId});assert.equal(sent.phase,'CONFIRMED',JSON.stringify(sent));assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,1);assert.equal(f.rest.requests.some(r=>/reviews|statuses/.test(r.path)),false);f.pass();
 }finally{await f.close();}
});

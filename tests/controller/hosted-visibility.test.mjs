import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {subject,initial} from './hosted-core-fixture.mjs';
import {overrideSet} from './hosted-integration-fixture.mjs';
test('missing actual fixture policy visibility blocks the action despite review-ready and account operands',{timeout:90000},async()=>{
 const f=await subject({missingVisibility:true});try{f.configure();const{targetId}=await f.c.registerHostedIntegrationTarget(f.registration),w=await f.begin();f.c.delegateHostedIntegration({workId:w.workId,targetId,mode:'ordinary',operationLimit:1});const prepared=await f.c.prepareIntegration({workId:w.workId,targetId,model:f.model});assert.equal(prepared.phase,'REFUSED');assert.match(prepared.blocked.join(' '),/policy inputs unavailable/);assert.equal(f.native.requests.filter(r=>r.path.endsWith('/git-receive-pack')).length,0);f.pass();}finally{await f.close();}
});

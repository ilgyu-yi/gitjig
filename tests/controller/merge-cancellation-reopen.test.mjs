import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from './merge-controller-fixture.mjs';
import {openController} from '../../dist/controller/index.js';

for(const initialized of [false,true])test(`owner cancellation after reopen withdraws an unstarted merge with driver initialized=${initialized}`,async t=>{
    const f=await subject(t);f.grant();
    const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
    assert.equal(prepared.phase,'RESERVED');const allowance=f.c.inspectWork(f.workId).allowance;
    await f.c.close();const reopened=await openController({installationHome:f.home});t.after(()=>reopened.close());
    assert.equal(!!reopened.effects.mergeCore,false);
    if(initialized)assert.equal(reopened.inspectMerge(prepared.operationId).phase,'RESERVED');
    const requests=f.native.requests.length;
    await reopened.cancelWork({workId:f.workId,expectedEpoch:1});
    assert.equal(reopened.inspectWork(f.workId).state,'CANCELLED');assert.equal(reopened.inspectMerge(prepared.operationId).phase,'REFUSED');
    assert.deepEqual(reopened.inspectWork(f.workId).allowance,allowance);
    assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});

test('owner cancellation after reopen preserves a merge with possible transmission as UNKNOWN',async t=>{
    const f=await subject(t);f.grant();const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
    // Controlled retained transport uncertainty; cancellation must not claim absence.
    f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",prepared.operationId);
    await f.c.close();const reopened=await openController({installationHome:f.home});t.after(()=>reopened.close());
    assert.equal(!!reopened.effects.mergeCore,false);const requests=f.native.requests.length;
    await reopened.cancelWork({workId:f.workId,expectedEpoch:1});
    const result=reopened.inspectMerge(prepared.operationId);
    assert.equal(result.phase,'UNKNOWN');assert.ok(result.blocked.includes('Original work cancelled'));
    assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from './merge-controller-fixture.mjs';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
const snapshot=c=>JSON.stringify(['works','sources','effect_operations','effect_delegations','effect_receipts','runs','budgets'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
for(const mode of ['already-confirmed','replaced-session'])test('original merge send '+mode+' refuses before allowance or mutation',async t=>{
 const f=await subject(t);f.grant();const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);if(mode==='already-confirmed')await f.c.dispatchMerge(prepared.operationId);else configureOwnedMergeFixture(f.c,{token:'owned-native-merge-only',origin:f.native.origin});const before=snapshot(f.c),requests=f.native.requests.length;await assert.rejects(f.c.dispatchMerge(prepared.operationId));assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),mode==='already-confirmed'?1:0);f.native.pass();
});

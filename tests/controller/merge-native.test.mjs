import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from './merge-controller-fixture.mjs';

test('separate owner merge grant, actual native merge and exact ledger confirmation preserve original allowance', {timeout:30000},async t=>{
 const f=await subject(t);await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),/Separate current original ordinary merge grant/);assert.equal(f.native.puts(),0);
 const grant=f.grant();assert.deepEqual(f.grant(),grant);const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);assert.equal(prepared.phase,'RESERVED');assert.equal(f.native.puts(),0);
 const confirmed=await f.c.dispatchMerge(prepared.operationId);assert.equal(confirmed.phase,'CONFIRMED');assert.equal(confirmed.transportOutcome,'native-success');assert.equal(confirmed.observedOutcome,'merged-candidate-matches');assert.equal(await f.native.head(),confirmed.mergedCommit);assert.equal(f.native.puts(),1);
 const retained=f.c.inspectMergeDelegation(f.workId,f.targetId);assert.equal(retained.eligible,true,JSON.stringify(retained.holds));assert.equal(retained.existing.used,1);assert.equal(retained.existing.remaining,0);const beforeKeep=JSON.stringify(['sources','effect_delegations','effect_operations','runs','budgets'].map(name=>f.c.store.all('SELECT * FROM '+name+' ORDER BY rowid')));assert.deepEqual(f.grant(),grant);assert.equal(JSON.stringify(['sources','effect_delegations','effect_operations','runs','budgets'].map(name=>f.c.store.all('SELECT * FROM '+name+' ORDER BY rowid'))),beforeKeep);
 await assert.rejects(f.c.dispatchMerge(prepared.operationId),/reserved/);assert.equal(f.native.puts(),1);assert.equal(f.c.inspectMerge(prepared.operationId).phase,'CONFIRMED');
 await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),/Original merge exists/);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',grant.delegationId).n,1);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs WHERE reservation=?','reserved').n,0);f.native.pass();
});

test('lost native response retains original merge and uncertain causality after actual resource correspondence', {timeout:30000},async t=>{
 const f=await subject(t,{dropAcceptance:true});f.grant();const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),unknown=await f.c.dispatchMerge(prepared.operationId);assert.equal(unknown.phase,'UNKNOWN');assert.equal(unknown.transportOutcome,'uncertain');
 const reconciled=await f.c.reconcileMerge(prepared.operationId,await f.native.head());assert.equal(reconciled.phase,'UNKNOWN');assert.equal(reconciled.observedOutcome,'merged-candidate-matches');assert.equal(reconciled.transportOutcome,'uncertain');assert.equal(f.native.puts(),1);await assert.rejects(f.c.dispatchMerge(prepared.operationId));assert.equal(f.native.puts(),1);f.native.pass();
});

test('changed current evidence refuses original dispatch before native request and preserves grant use', {timeout:30000},async t=>{
 const f=await subject(t);const grant=f.grant(),prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);f.invalidate();await assert.rejects(f.c.dispatchMerge(prepared.operationId),/current evidence/);assert.equal(f.native.puts(),0);assert.equal(await f.native.head(),f.native.subject.expectedBase);assert.equal(f.c.inspectMerge(prepared.operationId).phase,'REFUSED');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',grant.delegationId).n,1);f.native.pass();
});


test('settled HTTP cleanup binds its original merge operation and phase before retaining authority',async t=>{
 const f=await subject(t);f.grant();const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);const original=f.c.store.one("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='merge-http'",f.workId),data=JSON.parse(original.data),other=await f.c.beginChange({projectId:'P',request:'Other independent owner root'});
 f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','foreign-operation',other.workId,f.targetId,f.c.delegateMerge({workId:other.workId,targetId:f.targetId,operationLimit:1,notifications:'allow-merge-notifications'}).delegationId,'CONFIRMED',JSON.stringify({kind:'github-merge'}));
 for(const patch of [{operationId:undefined},{operationId:'missing-operation'},{operationId:f.branchOperationId},{operationId:'foreign-operation'},{kind:'other-http'},{phase:'unavailable'}]){
  f.c.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...data,...patch}),original.id);const context=f.c.inspectMergeDelegation(f.workId,f.targetId);assert.equal(context.eligible,false,JSON.stringify(patch));assert.match(context.holds.join(' '),/producer/);assert.throws(()=>f.grant());
 }
 f.c.store.run('UPDATE runs SET data=? WHERE id=?',original.data,original.id);assert.equal(f.c.inspectMergeDelegation(f.workId,f.targetId).eligible,true);assert.equal(f.native.puts(),0);f.native.pass();
});

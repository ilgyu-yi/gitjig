// Fault seam only: actual SQLite commit and native HTTP, controlled procedure
// standing inherited from the owned branch fixture. No role-production claim.
import '../normal-hosted/no-external.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
const c=await openController({installationHome:process.env.TEST_MERGE_READ_HOME});
configureOwnedMergeFixture(c,{token:'owned-native-merge-only',origin:process.env.TEST_MERGE_READ_ORIGIN});
if(process.env.TEST_MERGE_READ_OPERATION){
 const operationId=process.env.TEST_MERGE_READ_OPERATION,context=c.inspectMergeReconciliation(operationId);
 globalThis[Symbol.for('gitjig.qualification.flushTrace')]?.();
 await c.reconcileOwnerMerge({operationId,expectedContext:context.fingerprint},()=>{});
 throw Error('Expected actual process termination during native GET');
}
const work=process.env.TEST_MERGE_READ_WORK,target=process.env.TEST_MERGE_READ_TARGET,branch=process.env.TEST_MERGE_READ_BRANCH;
const evidence=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',branch).data).evidence;
c.changes.currentEvidence=async id=>{assert.equal(id,work);return structuredClone(evidence);};
c.changes.assertCurrentEvidence=value=>assert.deepEqual(value,evidence);
const prepared=await c.prepareOwnerMerge(work,target,branch),run=c.store.run.bind(c.store);
c.store.run=(sql,...args)=>{
 const result=run(sql,...args);
 if(sql==='INSERT INTO effect_receipts VALUES(?,?,?,?)'&&args[2]==='merge-send'){
  assert.equal(c.store.db.isTransaction,false,'Actual receipt insert committed before the fault');
  const data=JSON.parse(c.store.one('SELECT data FROM effect_receipts WHERE id=?',args[0]).data);assert.equal(data.result?.causality,'native-success-response');
  globalThis[Symbol.for('gitjig.qualification.flushTrace')]?.();
  fs.writeSync(1,JSON.stringify({stage:'native-response-receipt-durable',operationId:args[1],receiptId:args[0]})+'\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
 }
 return result;
};
await c.dispatchMerge(prepared.operationId);
throw Error('Expected actual process termination at durable native-response receipt');

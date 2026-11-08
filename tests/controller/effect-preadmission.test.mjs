import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {integrationWorld} from './integration-registry-fixture.mjs';

for(const {unexpectedRoot,nativeMarker} of [{unexpectedRoot:false},{unexpectedRoot:true},{unexpectedRoot:false,nativeMarker:true}])test(`native capacity cancellation preserves ${unexpectedRoot?'uncertain existing scope':nativeMarker?'contradictory native evidence':'affirmative nonallocation'} without a producer`,async t=>{
 const f=await integrationWorld(t),original=await f.prepare(),s=f.c.store;
 // Occupied-capacity premise only: no process or procedure standing is claimed
 // for the blockers. Actual nativeRun/acquire/cancel/cleanup are exercised.
 for(let i=0;i<2;i++){
  s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','block-run-'+i,original.workId,1,1,'RUNNING',f.root,'consumed','{}');
  s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','block-lease-'+i,original.workId,'block-run-'+i,1,i+1,'ADMITTED',JSON.stringify({admitted:true}));
 }
 let bodyCalls=0;
 try{
  const before=s.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",original.workId),abort=new AbortController();
  const pending=f.c.effects.nativeRun(original.operationId,'projection',abort.signal,async()=>{bodyCalls++;throw Error('Unadmitted body must never run');});
  // The owned tail is registered before the reservation microtask starts.
  assert.equal(f.c.effects.nativeTasks.size,1);await Promise.resolve();
  const run=s.one("SELECT * FROM runs WHERE json_extract(data,'$.operationId')=?",original.operationId),data=JSON.parse(run.data);
  assert.equal(run.phase,'WAITING_CAPACITY');
  if(unexpectedRoot)await fs.mkdir(data.clientRoot,{recursive:true,mode:0o700});
  if(nativeMarker)s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...data,modelDispatchAttempted:true}),run.id);
  abort.abort(new Error('Owned cancellation before admission'));await assert.rejects(pending,/before capacity admission/);
  const settled=s.one('SELECT * FROM runs WHERE id=?',run.id),value=JSON.parse(settled.data);
  assert.equal(bodyCalls,0);assert.equal(value.admission,'never-admitted');assert.equal(settled.reservation,'released');assert.equal(s.one('SELECT state FROM capacity_leases WHERE run=?',run.id).state,'CANCELLED');
  assert.deepEqual({...s.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",original.workId)},{...before});
  if(unexpectedRoot||nativeMarker){assert.equal(settled.phase,'UNKNOWN');assert.equal(value.cleanup,'quarantined');assert.equal(s.one('SELECT state FROM works WHERE id=?',original.workId).state,'UNKNOWN');}
  else {assert.equal(settled.phase,'SETTLED');assert.equal(value.cleanup,'not-allocated');assert.notEqual(s.one('SELECT state FROM works WHERE id=?',original.workId).state,'UNKNOWN');await assert.rejects(fs.lstat(data.clientRoot),{code:'ENOENT'});assert.equal(s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='factory-failure-cleanup'",original.operationId).n,0);}
 }finally{
  for(let i=0;i<2;i++){s.run('DELETE FROM capacity_leases WHERE id=?','block-lease-'+i);s.run('DELETE FROM runs WHERE id=?','block-run-'+i);}
 }
 f.pass();
});

test('shared native envelope preserves falsey business and cleanup failures after factual quarantine',async t=>{
 const f=await integrationWorld(t),original=await f.prepare(),s=f.c.store,before=s.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",original.workId);
 const factory=f.c.effects.client;
 // Controlled client failure only: this qualifies actual ledger/envelope
 // ownership, not Native process or software-procedure success.
 f.c.effects.client=async()=>({async close(){throw false;}});
 try{
  await assert.rejects(f.c.effects.nativeRun(original.operationId,'controlled-failure',undefined,async()=>{throw 0;}),error=>error instanceof AggregateError && error.errors.length===2 && error.errors[0]===0 && error.errors[1]===false);
 }finally{f.c.effects.client=factory;}
 const run=s.all("SELECT * FROM runs WHERE json_extract(data,'$.operationId')=? ORDER BY rowid",original.operationId).at(-1);
 assert.equal(run.phase,'UNKNOWN');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,'quarantined');assert.equal(s.one('SELECT state FROM capacity_leases WHERE run=?',run.id).state,'QUARANTINED');
 assert.deepEqual({...s.one("SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",original.workId)},{consumed:before.consumed+1,reserved:before.reserved});assert.equal(f.c.effects.nativeTasks.size,0);assert.equal(f.c.active.has(original.workId),false);f.pass();
});

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

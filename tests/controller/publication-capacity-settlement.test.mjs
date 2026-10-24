import test from 'node:test';
import assert from 'node:assert/strict';
import {shared,target} from '../contributions/publication-fixture.mjs';

test('publication admits an affirmatively refunded queue but holds missing, admitted and uncertain cleanup proofs',async t=>{
 const f=await shared();t.after(()=>f.close());const c=f.c,s=c.store;
 const targetId=c.registerPublicationTarget({target,visibility:'public'}).targetId;
 const prepared=await c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Original publication after a settled unstarted queue'}});
 const work=s.one('SELECT * FROM works WHERE id=?',prepared.workId),run='owned-never-admitted-run',lease='owned-never-admitted-lease';
 // Controlled historical queue premise; the real Capacity cancellation owns the
 // refund and final reservation/lease labels. No producer or capture is invented.
 s.run("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'",work.lineage);
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,work.id,work.epoch,work.generation,'WAITING_CAPACITY',f.root,'reserved',JSON.stringify({kind:'native-effect',admission:'never-admitted',capacityId:lease,cleanup:'not-allocated'}));
 s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',lease,work.id,run,work.epoch,999,'QUEUED',JSON.stringify({admitted:false}));
 c.capacity.cancelQueued(lease,'Owned regression: caller stopped before capacity admission');
 assert.equal(s.one('SELECT reservation FROM runs WHERE id=?',run).reservation,'released');
 const originalRun=s.one('SELECT data FROM runs WHERE id=?',run).data,originalLease=s.one('SELECT data FROM capacity_leases WHERE id=?',lease).data;
 const unsettled=()=>c.publicationEngine.reconciliationContext(prepared.operationId).unsettled;
 assert.equal(unsettled(),false);
 for(const patch of [{cleanup:'unknown'},{cleanup:'quarantined'},{cleanup:undefined},{admission:'admitted'},{capacityId:'foreign-lease'},{attainedCapture:true},{nativeClientInitialized:true},{manifest:{files:[]}},{attainedNative:true},{modelDispatchAttempted:true},{nativeInputObserved:true},{nativeSessionId:'recorded-session'},{historyRef:'/retained-history'},{nativeCheckpoint:{sessionId:'recorded-session'}},{allocatedNative:0}]){
  const data={...JSON.parse(originalRun),...patch};s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(data),run);assert.equal(unsettled(),true,JSON.stringify(patch));
 }
 s.run('UPDATE runs SET data=? WHERE id=?',originalRun,run);
 for(const data of [JSON.stringify({admitted:true}),JSON.stringify({}),'{']){
  s.run('UPDATE capacity_leases SET data=? WHERE id=?',data,lease);assert.equal(unsettled(),true,data);
 }
 s.run('UPDATE capacity_leases SET data=? WHERE id=?',originalLease,lease);
 s.run("UPDATE capacity_leases SET state='RELEASED' WHERE id=?",lease);assert.equal(unsettled(),true,'released run without matching cancelled queue proof');
 s.run("UPDATE capacity_leases SET state='CANCELLED' WHERE id=?",lease);
 const before=JSON.stringify(s.all('SELECT * FROM runs WHERE id=?',run));
 assert.equal(unsettled(),false);assert.equal(JSON.stringify(s.all('SELECT * FROM runs WHERE id=?',run)),before,'inspection cannot rewrite history');
 const sent=await c.dispatchPublication({operationId:prepared.operationId});assert.equal(sent.phase,'CONFIRMED',JSON.stringify(sent));assert.equal(f.posts.length,1);
 assert.equal(s.one('SELECT reservation FROM runs WHERE id=?',run).reservation,'released');assert.equal(s.one('SELECT state FROM capacity_leases WHERE id=?',lease).state,'CANCELLED');
});

test('actual unbound publication judgment cancelled before capacity admission remains settled without a model dispatch',async t=>{
 const {scripted}=await import('./effect-fixture.mjs'),f=await shared();t.after(()=>f.close());const c=f.c,s=c.store;
 const targetId=c.registerPublicationTarget({target,visibility:'public'}).targetId;
 const prepared=await c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body:'Actual preadmission judgment cleanup'}});
 const op=JSON.parse(s.one('SELECT data FROM effect_operations WHERE id=?',prepared.operationId).data),work=s.one('SELECT * FROM works WHERE id=?',prepared.workId);
 // Controlled occupancy and selection are premises, not review evidence. The
 // actual publication judgment must exit its real queue/collector/finalizer
 // before it can dispatch the scripted model or allocate any native runtime.
 for(let i=0;i<2;i++){
  s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','judge-block-run-'+i,work.id,work.epoch,work.generation,'RUNNING',f.root,'consumed','{}');
  s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','judge-block-lease-'+i,work.id,'judge-block-run-'+i,work.epoch,i+1,'ADMITTED','{"admitted":true}');
 }
 const core=c.changeCore,admit=core.h.assertApplicationAdmission;core.h.assertApplicationAdmission=()=>{};
 let calls=0;
 try{
  const signal=new AbortController(),deny=()=>{calls++;throw Error('No model dispatch is permitted');},model=scripted(deny,deny);
  const pending=core.publicationJudgment({workId:work.id,model,signal:signal.signal,operationId:prepared.operationId,sourceFingerprint:op.sourceFingerprint,inputBundle:{requirements:[],contracts:[],context:{operationId:prepared.operationId,actionFamily:'bootstrap',payloadHash:op.payloadHash},sources:[],requiredScope:[]}});
  void pending.catch(()=>{});
  let run;for(let i=0;i<100;i++){run=s.one("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='publication-judgment'",work.id);if(run?.phase==='WAITING_CAPACITY')break;await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(run?.phase,'WAITING_CAPACITY');signal.abort();await pending;
  const actual=s.one('SELECT * FROM runs WHERE id=?',run.id),data=JSON.parse(actual.data);assert.equal(actual.reservation,'released');assert.equal(data.cleanup,'unbound');assert.equal(data.unbound,true);assert.equal(data.admission,'never-admitted');assert.equal(calls,0);assert.equal(data.modelDispatchAttempted,undefined);
  for(let i=0;i<2;i++){s.run('DELETE FROM capacity_leases WHERE id=?','judge-block-lease-'+i);s.run('DELETE FROM runs WHERE id=?','judge-block-run-'+i);}
  assert.equal(c.publicationEngine.reconciliationContext(prepared.operationId).unsettled,false);
 }finally{
  core.h.assertApplicationAdmission=admit;
  for(let i=0;i<2;i++){s.run('DELETE FROM capacity_leases WHERE id=?','judge-block-lease-'+i);s.run('DELETE FROM runs WHERE id=?','judge-block-run-'+i);}
 }
});

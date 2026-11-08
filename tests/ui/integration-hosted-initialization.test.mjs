import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hostedReadWorld} from './integration-hosted-read-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';
import {receiverSnapshot} from './integration-read-fixture.mjs';
for(const [stage,unknown] of [['--version',false],['init',false],['init',true]])test('hosted controller close aborts '+stage+' initialization; cleanup unknown='+unknown,{timeout:12000},async t=>{
 const f=await hostedReadWorld(t),held=await heldInitializer(f,stage),bytes=await receiverSnapshot(f.native.receiver),rest=f.rest.requests.length,native=f.native.requests.length;
 const context=f.c.inspectIntegrationReconciliation(f.op.operationId),task=f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint,gitProfile:{gitBinary:held.binary,commandTimeoutMs:20000}});void task.catch(()=>{});await waitFile(held.marker);
 const open=fsSync.openSync;if(unknown)fsSync.openSync=(file,...args)=>{if(String(file).startsWith(f.home+'/effects/')&&String(file).endsWith('/terminal.json')){const error=Error('Owned fixture denies terminal cleanup observation');error.code='EPERM';throw error;}return open(file,...args);};
 const started=Date.now();try{await f.c.close();await assert.rejects(task);}finally{fsSync.openSync=open;}
 assert.ok(Date.now()-started<3000,'Hosted close must abort rather than wait for20s command timeout');await assertGone(held.pids);
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
  const run=db.prepare("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='native-effect' ORDER BY rowid DESC LIMIT 1").get(f.op.workId);
  assert.equal(run.phase,unknown?'UNKNOWN':'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).cleanup,unknown?'quarantined':'removed');
  assert.equal(JSON.parse(run.data).retainedIntegrationRead,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM capacity_leases WHERE run=? AND state='QUARANTINED'").get(run.id).n,unknown?1:0);
  assert.equal(db.prepare('SELECT phase FROM effect_operations WHERE id=?').get(f.op.operationId).phase,'UNKNOWN');
 }finally{db.close();}
 assert.equal(f.rest.requests.length,rest);assert.equal(f.native.requests.length,native);assert.deepEqual(await receiverSnapshot(f.native.receiver),bytes);f.pass();
});
for(const mode of ['fresh','resumed','missing-resumed'])test('hosted CA trust cancellation preserves '+mode+' ownership',{timeout:12000},async t=>{
 const f=await hostedReadWorld(t),id=f.op.operationId;
 const body=async(client,_signal,_run,session)=>{session.assertClient(client);return 'same captured session';};
 let root,bytes;
 if(mode!=='fresh'){
  assert.equal(await f.c.effects.nativeRun(id,'reconcile',undefined,body),'same captured session');
  root=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',id).data).clientRoot;bytes=await receiverSnapshot(root);
  if(mode==='missing-resumed')await fs.rename(root,root+'.retained-fixture');
 }
 const abort=new AbortController(),realpath=fs.realpath;let trust=0;
 fs.realpath=async(file,...args)=>{const value=await realpath(file,...args);if(String(file)===f.native.ca){trust++;abort.abort(Error('Owner cancelled during captured HTTPS trust'));}return value;};
 try{await assert.rejects(f.c.effects.nativeRun(id,'reconcile',abort.signal,()=>{throw Error('No body after trust cancellation');}),/cancelled/);}finally{fs.realpath=realpath;}
 assert.equal(trust,1);
 const run=f.c.store.all("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='native-effect' ORDER BY rowid",f.op.workId).at(-1),data=JSON.parse(run.data);
 assert.equal(run.phase,mode==='missing-resumed'?'UNKNOWN':'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(data.cleanup,mode==='fresh'?'not-allocated':mode==='resumed'?'removed':'quarantined');
 if(mode==='fresh')await assert.rejects(fs.lstat(data.clientRoot),{code:'ENOENT'});
 else assert.deepEqual(await receiverSnapshot(mode==='resumed'?root:root+'.retained-fixture'),bytes);
 f.pass();
});

test('hosted registration close aborts its initializer before target admission or identity read',{timeout:12000},async t=>{
 const f=await hostedReadWorld(t),held=await heldInitializer(f,'--version'),target=f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.op.targetId),data=JSON.parse(target.data),rest=f.rest.requests.length,native=f.native.requests.length;
 const before=Object.fromEntries(['effect_targets','works','effect_delegations','effect_operations','budgets','runs','sources'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
 f.c.options.effectsProfile={gitBinary:held.binary,commandTimeoutMs:20000};
 const task=f.c.registerHostedIntegrationTarget({projectId:'P',repository:data.repository,expectedUserId:data.expectedUserId,ref:'refs/heads/registration-cancelled',basisCommit:data.basisCommit,publicationInventory:data.publicationInventory,authorizedDeltaPaths:data.authorizedDeltaPaths});void task.catch(()=>{});
 await waitFile(held.marker);const started=Date.now();await f.c.close();await assert.rejects(task);assert.ok(Date.now()-started<3000);await assertGone(held.pids);
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),rows,table);}finally{db.close();}
 assert.equal(f.rest.requests.length,rest);assert.equal(f.native.requests.length,native);f.pass();
});

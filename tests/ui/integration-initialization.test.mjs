import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {firstWorld,firstChoices} from './integration-start-fixture.mjs';
import {readCommand} from './integration-command-fixture.mjs';
import {receiverSnapshot} from './integration-read-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';
const request=f=>({workId:f.workId,targetId:f.target,model:f.model,expectedContext:f.c.inspectFirstIntegrationPreparation(f.workId,f.target).contextFingerprint});
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
for(const [stage,unknown] of [['--version',false],['init',false],['init',true]])test('host close aborts common '+stage+' initialization; cleanup unknown='+unknown,{timeout:12000},async t=>{
 const f=await firstWorld(t),held=await heldInitializer(f,stage),bytes=await receiverSnapshot(f.receiver);
 f.c.options.effectsProfile={gitBinary:held.binary,commandTimeoutMs:20000};
 f.c.changeCore.drive=()=>{throw Error('No model drive may follow closing initialization');};
 const h=readCommand(f,firstChoices(f),[],{model:f.model}),task=h.run();void task.catch(()=>{});await waitFile(held.marker);
 const open=fsSync.openSync;if(unknown)fsSync.openSync=(file,...args)=>{if(String(file).startsWith(f.home+'/effects/')&&String(file).endsWith('/terminal.json')){const error=Error('Owned fixture denies terminal cleanup observation');error.code='EPERM';throw error;}return open(file,...args);};
 const started=Date.now();try{await h.ui.close();await Promise.allSettled([task]);}finally{fsSync.openSync=open;}
 assert.ok(Date.now()-started<3000,'Close must abort initialization instead of waiting for20s timeout');await assertGone(held.pids);
 const op=f.c.store.one('SELECT id,data FROM effect_operations');assert.equal(f.c.inspectEffect(op.id).phase,'REFUSED');
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind IN ('send','projection')").n,0);
 const runs=f.c.store.all("SELECT id,phase,reservation,data FROM runs WHERE work=? AND json_extract(data,'$.kind')='native-effect'",f.workId);assert.equal(runs.length,1);
 assert.equal(runs[0].phase,unknown?'UNKNOWN':'SETTLED');assert.equal(runs[0].reservation,'consumed');assert.equal(JSON.parse(runs[0].data).cleanup,unknown?'quarantined':'removed');
 assert.equal(f.c.store.one('SELECT state FROM works WHERE id=?',f.workId).state,unknown?'UNKNOWN':'ACTIVE');
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM capacity_leases WHERE run=? AND state='QUARANTINED'",runs[0].id).n,unknown?1:0);
 if(unknown)assert.equal(JSON.parse(runs[0].data).clientRoot,JSON.parse(op.data).clientRoot);
 assert.deepEqual(await receiverSnapshot(f.receiver),bytes);f.pass();
});
for(const mode of ['fresh','resumed','missing-resumed','missing-pointer'])test('abort in common preownership trust preserves '+mode+' cleanup meaning',{timeout:12000},async t=>{
 const f=await firstWorld(t);let id,root,bytes;
 if(mode!=='fresh'){
  const result=await f.c.prepareFirstIntegration(request(f));assert.equal(result.phase,'RESERVED');id=result.operationId;
  root=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',id).data).clientRoot;
  bytes=await receiverSnapshot(root);
  if(mode==='missing-resumed'||mode==='missing-pointer')await fs.rename(root,root+'.retained-fixture');
  if(mode==='missing-pointer')f.c.store.run("UPDATE effect_operations SET data=json_remove(data,'$.clientRoot') WHERE id=?",id);
 }
 const trust=f.c.effects.trustedProfile.bind(f.c.effects);let enter,release;
 const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);
 f.c.effects.trustedProfile=async(...args)=>{const result=await trust(...args);if(f.c.store.one('SELECT COUNT(*) n FROM effect_operations').n){enter();await held;}return result;};
 const abort=new AbortController(),task=mode==='fresh'?f.c.prepareFirstIntegration(request(f)):f.c.effects.nativeRun(id,'reconcile',abort.signal,()=>{throw Error('No native body after cancelled initialization');});
 void task.catch(()=>{});await entered;
 let closing;if(mode==='fresh')closing=f.c.close();else abort.abort(Error('Owner cancelled resumed initialization'));
 release();await Promise.allSettled([task]);if(closing)await closing;
 const db=mode==='fresh'?new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true}):undefined;
 const store=db?{all:(sql,...args)=>db.prepare(sql).all(...args),one:(sql,...args)=>db.prepare(sql).get(...args)}:f.c.store;
 const runs=store.all("SELECT phase,reservation,data FROM runs WHERE work=? AND json_extract(data,'$.kind')='native-effect' ORDER BY rowid",f.workId),last=runs.at(-1);
 assert.equal(last.reservation,'consumed');assert.equal(last.phase,mode.startsWith('missing-')?'UNKNOWN':'SETTLED');
 assert.equal(JSON.parse(last.data).cleanup,mode==='fresh'?'not-allocated':mode==='resumed'?'removed':'quarantined');
 if(mode==='fresh'){root=JSON.parse(last.data).clientRoot;await assert.rejects(fs.lstat(root),{code:'ENOENT'});assert.notEqual(store.one('SELECT state FROM works WHERE id=?',f.workId).state,'UNKNOWN');}
 else {assert.deepEqual(await receiverSnapshot(mode==='resumed'?root:root+'.retained-fixture'),bytes);assert.equal(JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',id).data).clientInitialized,true);}
 assert.equal(store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);db?.close();f.pass();
});

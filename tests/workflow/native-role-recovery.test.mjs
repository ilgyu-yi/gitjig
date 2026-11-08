import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {initializePiHost} from '../../dist/pi/host.js';
import {acquireOwner} from '../../dist/controller/ownership.js';
import {readNativeHistorySnapshot} from '../../dist/controller/history.js';
import {recoverNativeRoleCapture} from '../../dist/workflow/native-role-recovery.js';
import {nativeRoleMaterial,nativeRoleEntries as kinds} from '../../dist/workflow/native-role-output.js';
import {expandNativeTransport,nativeCaptureBinding} from '../../dist/workflow/native-transport.js';
const root=await temporaryDirectory('native-role-recovery'),state=path.join(root,'state'),artifacts=path.join(root,'artifacts');for(const directory of [state,artifacts])await fs.mkdir(directory,{mode:0o700});process.env.TMPDIR=artifacts;
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts}),owner=await acquireOwner(state),sha=b=>createHash('sha256').update(b).digest('hex');
after(async()=>{await owner();await fs.rm(root,{recursive:true,force:true});});
async function fixture(t,mode='complete'){
 const directory=path.join(state,randomUUID());await fs.mkdir(directory,{mode:0o700});let child,exited;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(exited)await exited;await fs.rm(directory,{recursive:true,force:true});});
 child=fork(new URL('./native-recovery-worker.mjs',import.meta.url),[state,artifacts,directory,mode],{env:{TMPDIR:artifacts,HOME:root},stdio:['ignore','ignore','ignore','ipc']});
 exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const message=new Promise(resolve=>child.once('message',resolve)),request={version:2,carrier:'assistant-json/v1',requestId:randomUUID(),binding:{launchId:randomUUID(),role:'reviewer',stage:'fresh-review',inputDigest:sha('input'),nativeEvidencePolicy:'embedded-envelope/v2'},schema:{type:'object'},maxNativeTurns:4};child.send(request);
 const ready=await Promise.race([message,exited.then(exit=>{throw Error('Original fixture writer exited early '+JSON.stringify(exit));})]);
 const expected={sessionId:ready.sessionId,launchId:request.binding.launchId,role:'reviewer',writerPid:child.pid,intent:ready.intent,dispatchCheckpoint:ready.dispatchCheckpoint},stage=path.join(directory,ready.allocation.stagingName),before=await fs.readFile(ready.file);
 if(mode!=='live'){child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');}
 const read=()=>readNativeHistorySnapshot(ready.file,ready.dispatchCheckpoint),assertCurrent=()=>{owner.assertCurrent();},recover=async(overrides={})=>recoverNativeRoleCapture(ready.file,await read(),{...expected,...overrides},host,assertCurrent);
 return{...ready,directory,stage,before,read,recover,expected,assertCurrent};
}
test('original killed writer recovers exact owned packets once, without source success',{timeout:10000},async t=>{
 const f=await fixture(t),original=await f.read();assert.throws(()=>expandNativeTransport(original.entries),/capsule missing/);
 const recovered=await f.recover(),bytes=await fs.readFile(f.file);assert.ok(bytes.subarray(0,f.before.length).equals(f.before));assert.ok(bytes.length>f.before.length);
 const capsule=recovered.entries.find(e=>e.customType===kinds.capture);assert.equal(capsule.data.sealed,false);assert.equal(capsule.data.stopped,true);assert.equal(recovered.entries.filter(e=>e.customType===kinds.recovery).length,1);
 const intent=recovered.entries.find(e=>e.customType===kinds.intent);assert.ok(nativeRoleMaterial(recovered.entries,intent.id).materials.some(m=>m.raw===f.raw));assert.throws(()=>nativeCaptureBinding(expandNativeTransport(recovered.entries),intent,{}),/complete trace/);await assert.rejects(fs.stat(f.stage),{code:'ENOENT'});
 const repeated=await f.recover();assert.deepEqual(repeated.checkpoint,recovered.checkpoint);assert.deepEqual(await fs.readFile(f.file),bytes);
});
for(const mode of ['partial','corrupt','live','wrong-pid','wrong-request','missing-dispatch','linked-stage'])test('interrupted stage remains held without changing history: '+mode,{timeout:10000},async t=>{
 const f=await fixture(t,mode==='partial'?'partial':mode==='live'?'live':'complete');
 if(mode==='corrupt'){const bytes=await fs.readFile(f.stage),offset=12+bytes.readUInt32BE(8)+8;bytes[offset]^=1;await fs.writeFile(f.stage,bytes);}
 if(mode==='linked-stage')await fs.link(f.stage,f.stage+'.alias');
 const overrides=mode==='wrong-pid'?{writerPid:process.pid}:mode==='wrong-request'?{intent:{...f.intent,requestDigest:'0'.repeat(64)}}:mode==='missing-dispatch'?{dispatchCheckpoint:undefined}:{};
 await assert.rejects(f.recover(overrides),/HELD|ownership/);assert.deepEqual(await fs.readFile(f.file),f.before);assert.ok((await fs.stat(f.stage)).isFile());
});
test('atomic replacement failure keeps original bytes and stage, then retries once',{timeout:10000},async t=>{
 const f=await fixture(t),rename=fs.rename;fs.rename=async()=>{throw Error('Controlled recovery rename failure');};
 try{await assert.rejects(f.recover(),/Controlled recovery rename/);}finally{fs.rename=rename;}
 assert.deepEqual(await fs.readFile(f.file),f.before);assert.ok((await fs.stat(f.stage)).isFile());assert.deepEqual((await fs.readdir(f.directory)).filter(n=>n.endsWith('.tmp')),[]);
 const result=await f.recover();assert.equal(result.entries.filter(e=>e.customType===kinds.capture).length,1);
});
test('retry after persisted capsule before unlink reuses the original stopped source',{timeout:10000},async t=>{
 const f=await fixture(t),unlink=fs.unlink;let refused=false;fs.unlink=async file=>{if(file===f.stage&&!refused){refused=true;throw Error('Controlled recovery unlink failure');}return unlink(file);};
 try{await assert.rejects(f.recover(),/Controlled recovery unlink/);}finally{fs.unlink=unlink;}
 assert.equal(refused,true);const first=await f.read(),bytes=await fs.readFile(f.file);assert.equal(first.entries.filter(e=>e.customType===kinds.capture).length,1);assert.ok((await fs.stat(f.stage)).isFile());
 const result=await f.recover();assert.deepEqual(result.checkpoint,first.checkpoint);assert.deepEqual(await fs.readFile(f.file),bytes);await assert.rejects(fs.stat(f.stage),{code:'ENOENT'});
});
test('original owner revocation during copy refuses before replacing history',{timeout:10000},async t=>{
 const f=await fixture(t),open=fs.open;let revoked=false;
 fs.open=async(...args)=>{const handle=await open(...args);if(args[0]===f.file){const read=handle.read.bind(handle);handle.read=async(...values)=>{const result=await read(...values);revoked=true;return result;};}return handle;};
 const snapshot=await f.read();revoked=false;
 try{await assert.rejects(recoverNativeRoleCapture(f.file,snapshot,f.expected,host,()=>{owner.assertCurrent();if(revoked)throw Error('Controlled original owner revoked');}),/owner revoked/);}finally{fs.open=open;}
 assert.deepEqual(await fs.readFile(f.file),f.before);assert.ok((await fs.stat(f.stage)).isFile());
});

test('same-inode temporary tamper after prepared bytes are read refuses before rename',{timeout:10000},async t=>{
 const f=await fixture(t),open=fs.open,rename=fs.rename;let tampered=false,renames=0;
 fs.open=async(...args)=>{const handle=await open(...args);if(String(args[0]).endsWith('.tmp')&&args[1]===fsConstants.O_RDONLY+fsConstants.O_NOFOLLOW+fsConstants.O_NONBLOCK){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!tampered){tampered=true;const writer=await open(args[0],'r+');try{await writer.write(Buffer.from('!'),0,1,0);}finally{await writer.close();}}};}return handle;};
 fs.rename=async(...args)=>{renames++;return rename(...args);};
 try{await assert.rejects(f.recover(),/prepared|changed/);}finally{fs.open=open;fs.rename=rename;}
 assert.equal(tampered,true);assert.equal(renames,0);assert.deepEqual(await fs.readFile(f.file),f.before);assert.ok((await fs.stat(f.stage)).isFile());
});
test('history tamper during verified stage removal never becomes a fresh snapshot baseline',{timeout:10000},async t=>{
 const f=await fixture(t),unlink=fs.unlink;let tampered=false;
 fs.unlink=async file=>{if(file===f.stage){await fs.appendFile(f.file,'\n');tampered=true;}return unlink(file);};
 try{await assert.rejects(f.recover(),/history changed/);}finally{fs.unlink=unlink;}
 assert.equal(tampered,true);const retry=await f.recover();assert.equal(retry.entries.filter(e=>e.customType===kinds.capture).length,1);
});

test('history drift during final stage probes refuses before deleting original stage',{timeout:10000},async t=>{
 const f=await fixture(t),open=fs.open;let probes=0,tampered=false;
 fs.open=async(...args)=>{const handle=await open(...args);if(args[0]===f.stage){const stat=handle.stat.bind(handle);handle.stat=async(...values)=>{const info=await stat(...values);if(++probes===3){await fs.appendFile(f.file,'\n');tampered=true;}return info;};}return handle;};
 try{await assert.rejects(f.recover(),/history changed before stage removal/);}finally{fs.open=open;}
 assert.equal(tampered,true);assert.ok((await fs.stat(f.stage)).isFile());const retry=await f.recover();assert.equal(retry.entries.filter(e=>e.customType===kinds.capture).length,1);
});

/** Prepared only. Root selects this actual harmless process lane explicitly. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const subject=path.resolve('dist/pi/native-process.js');
const wait=async(fn,ms=8000)=>{const end=performance.now()+ms;for(;;){const value=await fn();if(value)return value;if(performance.now()>end)throw Error('Owned fixture deadline');await new Promise(r=>setTimeout(r,10));}};
const absent=pid=>{try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}};
const joined=child=>new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
const read=async f=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}};
test('host SIGKILL before configuration or during native group leaves durable truthful cleanup',{timeout:25000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig128-death-')));await fs.chmod(root,0o700);t.diagnostic('Retained owned death world: '+root);
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}),sentinelDone=joined(sentinel);
 try{
  for(const scenario of ['before-config','live-group','leader-exit']){
   const home=path.join(root,scenario);await fs.mkdir(home,{mode:0o700});
   const host=spawn(process.execPath,[fileURLToPath(new URL('./native-guardian-host.mjs',import.meta.url)),subject,home,scenario],{stdio:['ignore','pipe','pipe','ipc']});host.stdout.resume();host.stderr.resume();const hostDone=joined(host);
   let ready,leaderExited;host.on('message',message=>{if(message.type==='ready')ready=message;if(message.type==='leader-exited')leaderExited=message;});
   let admission,birth;
   try{
    await wait(()=>ready);const directory=path.join(ready.recordRoot,ready.nonce);
    admission=await wait(()=>read(path.join(directory,'admission.json')));
    if(scenario!=='before-config')birth=await wait(()=>read(path.join(directory,'birth.json')));
    if(scenario==='leader-exit'){await wait(()=>leaderExited);assert.equal(leaderExited.code,0);}
    host.kill('SIGKILL');assert.equal((await hostDone).signal,'SIGKILL');
    const terminal=await wait(()=>read(path.join(directory,'settlement.json')));
    assert.equal(terminal.cleanup,'confirmed');assert.equal(terminal.nativeCreated,scenario!=='before-config');assert.equal(terminal.exited,scenario!=='before-config');assert.equal(terminal.stdioReleased,true);assert.equal(terminal.groupAbsent,true);
    assert.equal(terminal.guardianPid,admission.guardianPid);await wait(()=>absent(admission.guardianPid));
    if(birth){await wait(()=>absent(-birth.pgid));assert.equal(terminal.nativePid,birth.nativePid);}
    assert.equal(absent(sentinel.pid),false,'Unrelated sentinel must survive');
    const {createOwnedNativeProducer}=await import(pathToFileURL(subject).href);const bytes=await fs.readFile(process.execPath);const {createHash}=await import('node:crypto');
    const reopened=await createOwnedNativeProducer({file:await fs.realpath(process.execPath),sha256:createHash('sha256').update(bytes).digest('hex')},undefined,home);assert.deepEqual(await reopened.close(),{cleanup:'confirmed'});
   }finally{
    if(host.exitCode===null&&host.signalCode===null){host.kill('SIGKILL');await hostDone;}
    if(birth&&!absent(-birth.pgid)){try{process.kill(-birth.pgid,'SIGKILL');}catch{}}
    if(admission&&!absent(admission.guardianPid)){try{process.kill(admission.guardianPid,'SIGKILL');}catch{}}
   }
  }
 }finally{try{process.kill(-sentinel.pid,'SIGKILL');}catch{}await sentinelDone;}
});

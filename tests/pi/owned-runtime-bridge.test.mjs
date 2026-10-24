// Actual current bridge/session consumers; no native query, credentials or paid service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const candidate=fileURLToPath(new URL('../../dist',import.meta.url));

for(const kind of ['foundation','early-close-failure'])test('common owner preserves current bridge '+kind,{timeout:12000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'gitjig-common-bridge-'))),home=join(root,'private-home');await mkdir(home,{mode:0o700});
 const guard=join(root,'no-forward.mjs');await writeFile(guard,`import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';let attempts=0;const deny=()=>{attempts++;throw Error('OWNED_TEST_NETWORK_FORBIDDEN');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;syncBuiltinESMExports();process.on('exit',()=>{if(attempts)process.exitCode=1;});`,{mode:0o600});
 const script=fileURLToPath(new URL(kind==='foundation'?'./claude-host-child.mjs':'./claude-close-failure-child.mjs',import.meta.url));
 const args=kind==='foundation'?['healthy',root,candidate]:[root,candidate];
 const child=spawn(process.execPath,['--import',guard,script,...args],{cwd:resolve(candidate,'..'),env:{PATH:'/usr/bin:/bin',HOME:home,USER:'owned',LOGNAME:'owned',LANG:'C',SHELL:'/bin/sh'},stdio:['ignore','pipe','pipe'],detached:true});
 let out='',err='',timedOut=false,escalation;
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
 const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),500);},8000);
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 try{
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  await writeFile(join(root,'stdout'),out);await writeFile(join(root,'stderr'),err);await writeFile(join(root,'result.json'),JSON.stringify({...result,timedOut}));console.log('retained '+root);
  assert.equal(timedOut,false,err);assert.equal(result.code,0,err);assert.equal(result.signal,null);
  assert.throws(()=>process.kill(-child.pid,0),error=>error.code==='ESRCH','Owned child process group must be absent');
  const receipt=JSON.parse(out.trim());assert.equal(receipt.complete,true);
  if(kind==='foundation'){assert.equal(receipt.owners,3);assert.equal(receipt.hostAuthFileCreated,false);}
  else{assert.equal(receipt.tailJoined,true);assert.equal(receipt.hostAdmissionClosed,true);assert.equal(receipt.originalErrorPreserved,true);}
 }finally{clearTimeout(timer);if(escalation)clearTimeout(escalation);if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');}
});

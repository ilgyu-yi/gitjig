import {nativeOwnerHistory} from './native-owner-history.mjs';
// Source qualification with original Pi/SDK/bridge; private fake native, never real Claude/auth.
import{createReadStream}from'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const source=fileURLToPath(new URL('../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
async function shaFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const absent=(pid,group=false)=>{try{process.kill(group?-pid:pid,0);return false;}catch(error){return error.code==='ESRCH';}};
const platform=process.platform==='darwin'&&process.arch==='arm64';
for(const mode of['healthy','eof'])test('actual shared-owner auxiliary '+mode,{timeout:35000,skip:platform?false:'Current source auxiliary fixture profile is Darwin arm64'},async t=>{
 const started=performance.now(),root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'gitjig-owned-aux-'+mode+'-'))),candidate=path.join(root,'candidate'),world=path.join(root,'world');await fs.mkdir(candidate,{mode:0o700});await fs.mkdir(world,{mode:0o700});
 t.diagnostic('Retained source auxiliary world: '+root);
 await fs.cp(path.join(source,'dist'),path.join(candidate,'dist'),{recursive:true});await fs.copyFile(path.join(source,'package.json'),path.join(candidate,'package.json'));
 const nm=path.join(candidate,'node_modules');await fs.mkdir(nm,{mode:0o700});const links=[];
 for(const entry of await fs.readdir(path.join(source,'node_modules'),{withFileTypes:true})){
  const original=path.join(source,'node_modules',entry.name),target=path.join(nm,entry.name);
  if(['@anthropic-ai','@gitjig'].includes(entry.name)){
   await fs.mkdir(target,{mode:0o700});
   for(const pkg of await fs.readdir(original)){
    const from=path.join(original,pkg),to=path.join(target,pkg);
    if(['claude-agent-sdk','pi-claude-bridge-host'].includes(pkg))await fs.cp(from,to,{recursive:true});
    else if(pkg==='claude-agent-sdk-darwin-arm64'){
     await fs.mkdir(to,{mode:0o700});for(const item of await fs.readdir(from))if(item!=='claude')await fs.cp(path.join(from,item),path.join(to,item),{recursive:true});
    }else{await fs.symlink(from,to);links.push({path:to,target:from});}
   }
  }else{await fs.symlink(original,target);links.push({path:target,target:original});}
 }
 const protocol=path.join(root,'protocol.mjs'),protocolBytes=await fs.readFile(new URL('./owned-runtime-auxiliary-protocol.mjs',import.meta.url));await fs.writeFile(protocol,protocolBytes,{mode:0o600});
 const executable=path.join(nm,'@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),originalNative=path.join(source,'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),nativeOriginal=await shaFile(originalNative);
 const wrapper='#!/bin/sh\nexec '+quote(await fs.realpath(process.execPath))+' '+quote(protocol)+' '+quote(mode)+' "$@"\n';await fs.writeFile(executable,wrapper,{mode:0o700,flag:'wx'});
 const bindings=[];
 const bindTree=async relative=>{for(const item of await fs.readdir(path.join(candidate,relative),{withFileTypes:true})){const child=path.join(relative,item.name);if(item.isDirectory())await bindTree(child);else if(item.isFile()){const bytes=await fs.readFile(path.join(candidate,child));assert.equal(sha(bytes),sha(await fs.readFile(path.join(source,child))));bindings.push({path:child,sha256:sha(bytes)});}else throw Error('Unexpected link in copied source package');}};
 for(const relative of['dist','node_modules/@anthropic-ai/claude-agent-sdk','node_modules/@gitjig/pi-claude-bridge-host'])await bindTree(relative);
 for(const relative of['package.json','package-lock.json'])bindings.push({path:relative,sha256:sha(await fs.readFile(path.join(source,relative)))});
 const trace=path.join(root,'trace.json'),guard=path.join(root,'guard.mjs');
 await fs.writeFile(guard,`import fs from 'node:fs';import net from 'node:net';import http from 'node:http';import https from 'node:https';import {registerHooks,syncBuiltinESMExports} from 'node:module';const urls=new Set();let attempts=0;const deny=()=>{attempts++;throw Error('AUX_TEST_NO_NETWORK');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const api of[http,https])for(const name of['request','get'])api[name]=deny;syncBuiltinESMExports();registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.includes('/dist/pi/')||result.url.includes('/@gitjig/pi-claude-bridge-host/')||result.url.includes('/@anthropic-ai/claude-agent-sdk/')){if(!result.url.startsWith(${JSON.stringify('file://'+candidate+'/')}))throw Error('AUX_WRONG_SOURCE_RESOLUTION');urls.add(result.url);}return result;}});process.on('exit',()=>{const bytes=JSON.stringify({urls:[...urls],attempts});if(bytes.length>1048576)process.exitCode=1;else fs.writeFileSync(${JSON.stringify(trace)},bytes,{mode:0o600});if(attempts)process.exitCode=1;});`,{mode:0o600});
 const guardProbe=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',"import net from 'node:net';import http from 'node:http';try{await fetch('http://127.0.0.1:1')}catch{}try{new net.Socket().connect(1,'127.0.0.1')}catch{}try{http.get('http://127.0.0.1:1')}catch{}"],{env:{PATH:'/usr/bin:/bin',HOME:world},timeout:2000,maxBuffer:4096});
 assert.equal(guardProbe.status,1);assert.equal(guardProbe.signal,null);assert.equal(guardProbe.error,undefined);const guardControl=JSON.parse(await fs.readFile(trace,'utf8'));assert.equal(guardControl.attempts,3);await fs.rename(trace,path.join(root,'tripwire-control.json'));
 const script=fileURLToPath(new URL(mode==='healthy'?'./claude-auxiliary-owned-child.mjs':'./owned-runtime-auxiliary-eof-child.mjs',import.meta.url)),scriptSha=sha(await fs.readFile(script));
 assert.ok(performance.now()-started<60000,'Selected setup budget60s');
 const setupMs=performance.now()-started,runStarted=performance.now();
 const child=spawn(process.execPath,['--import',guard,script,candidate,world],{cwd:source,env:{PATH:'/usr/bin:/bin',USER:'owned',LOGNAME:'owned',LANG:'C',SHELL:'/bin/sh',HOME:world},stdio:['ignore','pipe','pipe'],detached:true});let out='',err='',timedOut=false,overflow=false,bytes=0,escalation;
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
 const terminate=()=>{kill('SIGTERM');escalation??=setTimeout(()=>kill('SIGKILL'),500);};
 const timer=setTimeout(()=>{timedOut=true;terminate();},25000);
 const capture=which=>chunk=>{bytes+=chunk.length;if(bytes>262144){overflow=true;terminate();return;}if(which==='out')out+=chunk;else err+=chunk;};child.stdout.on('data',capture('out'));child.stderr.on('data',capture('err'));
 let terminal,receipt,problem;const journals=[],failureCleanup=[];
 try{
  terminal=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  await fs.writeFile(path.join(root,'stdout.log'),out);await fs.writeFile(path.join(root,'stderr.log'),err);
  assert.equal(timedOut,false,err);assert.equal(overflow,false);assert.equal(terminal.code,0,err);assert.equal(terminal.signal,null);assert.equal(absent(child.pid,true),true);
  receipt=JSON.parse(await fs.readFile(path.join(world,'receipt.json'),'utf8'));assert.equal(receipt.complete,true);assert.equal(receipt.cleanup,'joined');
  const loaded=JSON.parse(await fs.readFile(trace,'utf8'));assert.equal(loaded.attempts,0);
  for(const suffix of['/dist/pi/owned-runtime.js','/dist/pi/claude-runtime.js','/@anthropic-ai/claude-agent-sdk/sdk.mjs','/@gitjig/pi-claude-bridge-host/dist/index.js'])assert.ok(loaded.urls.some(url=>url.endsWith(suffix)),suffix);
  const ownerRoot=path.join(world,'state/runtime/native-owners/v1'),dirs=await nativeOwnerHistory(ownerRoot);
  for(const {nonce,dir} of dirs){const read=async name=>JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8'));const admission=await read('admission'),birth=await read('birth'),settlement=await read('settlement'),physical=await read('recovery');for(const row of[birth,settlement,physical])for(const key of['nonce','sessionId','guardianPid','executableSha256'])assert.equal(row[key],admission[key]);assert.equal(admission.nonce,nonce);assert.equal(admission.purpose,'summary');assert.equal(admission.executableSha256,sha(wrapper));assert.equal(settlement.nativePid,birth.nativePid);assert.equal(physical.nativePid,birth.nativePid);assert.equal(physical.outcome,'active-owner-scope-joined');assert.equal(settlement.cleanup,'confirmed');assert.equal(settlement.groupAbsent,true);assert.equal(settlement.stdioReleased,true);assert.equal(absent(birth.nativePid,true),true);assert.equal(absent(admission.guardianPid),true);journals.push({nonce,admission,birth,settlement,physical});}
  const observations=(await fs.readFile(path.join(world,'host/fixture-observation.json'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(journals.length,observations.length);for(const item of observations){assert.equal(journals.filter(j=>j.birth.nativePid===item.pid).length,1);assert.ok(item.maxInputFrameBytes>0&&item.maxInputFrameBytes<=1024*1024);}
  if(mode==='healthy'){assert.equal(journals.length,receipt.actualNativeChildren);assert.ok(receipt.repeatedSameOwnerCompact);assert.ok(receipt.actualThirdRequestRefused);}
  else{assert.equal(journals.length,1);assert.equal(journals[0].settlement.exitCode,0);assert.equal(journals[0].settlement.signal,null);assert.equal(journals[0].admission.sessionId,receipt.owner);assert.ok(receipt.notifications.some(item=>/BRIDGE_HOST_SUMMARY_RESULT_INCOMPLETE/.test(item.message)));assert.equal(receipt.historyCompactionsAfter,receipt.historyCompactionsBefore);}
  assert.equal(await shaFile(originalNative),nativeOriginal,'Working native binary unchanged');
 }catch(error){problem=error;throw error;}finally{
  clearTimeout(timer);if(escalation)clearTimeout(escalation);if(!absent(child.pid,true))kill('SIGKILL');
  // Guardian/native scopes are detached; reconcile only explicit owned records on failure.
  if(problem){
   const owners=path.join(world,'state/runtime/native-owners/v1');
   for(const nonce of await fs.readdir(owners).catch(()=>[])){
    const dir=path.join(owners,nonce);let a,b,physical;
    try{a=JSON.parse(await fs.readFile(path.join(dir,'admission.json'),'utf8'));b=JSON.parse(await fs.readFile(path.join(dir,'birth.json'),'utf8'));physical=JSON.parse(await fs.readFile(path.join(dir,'recovery.json'),'utf8'));}catch{}
    if(a?.hostPid!==child.pid||b?.nonce!==a.nonce)continue;
    if(physical?.outcome==='active-owner-scope-joined'){failureCleanup.push({nonce,status:'ALREADY_JOINED'});continue;}
    if(!absent(b.nativePid,true))try{process.kill(-b.nativePid,'SIGKILL');}catch{}
    if(!absent(a.guardianPid))try{process.kill(a.guardianPid,'SIGTERM');}catch{}
    const until=performance.now()+6000;while(performance.now()<until&&(!absent(b.nativePid,true)||!absent(a.guardianPid)))await new Promise(resolve=>setTimeout(resolve,20));
    failureCleanup.push({nonce,nativePid:b.nativePid,guardianPid:a.guardianPid,status:absent(b.nativePid,true)&&absent(a.guardianPid)?'ABSENT_AFTER_FAILED_TEST':'UNKNOWN'});
   }
  }
  const observation={mode,source,candidate,scope:'source qualification, linked unchanged deps; not installed acceptance',setupMs,operationCleanupMs:performance.now()-runStarted,bindings,links,script,scriptSha,protocolSha:sha(protocolBytes),driverSha:sha(await fs.readFile(fileURLToPath(import.meta.url))),guardSha:sha(await fs.readFile(guard)),helperSha:sha(await fs.readFile(new URL('../normal-hosted/no-external.mjs',import.meta.url))),nativeOriginal,substitute:sha(wrapper),terminal,timedOut,overflow,guardControl,receipt,journals,failureCleanup,failure:problem?String(problem):null};await fs.writeFile(path.join(root,'observation.json'),JSON.stringify(observation,null,2),{mode:0o600});
 }
});

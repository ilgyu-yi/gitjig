import {nativeOwnerHistory} from '../pi/native-owner-history.mjs';
// Installed original consumers; synthetic wire/native producers, no real account.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const execute=promisify(execFile),source=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex'),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const receipt=JSON.parse(await fs.readFile(process.env.GITJIG_INSTALL_RECEIPT,'utf8'));
const base=JSON.parse(await fs.readFile(path.join(receipt.bundleRoot,'bundle.json'),'utf8'));
const payload=path.join(receipt.home,'versions',receipt.payloadId),node=path.join(receipt.home,'bootstrap/node');
assert.equal(receipt.payloadId,base.payloadId);
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-installed-provider-')));
const adaptations=[];
const nativeWorlds=[],ownedPids=new Set();let execution=0;
async function observed(command,args,options){
 const number=execution++,promise=execute(command,args,options);if(promise.child?.pid)ownedPids.add(promise.child.pid);
 try{return await promise;}catch(error){await fs.writeFile(path.join(root,'failed-execution-'+number+'.json'),JSON.stringify({command,args,code:error.code,signal:error.signal,killed:error.killed,stdout:error.stdout,stderr:error.stderr},null,2));throw error;}
}
after(async()=>{
 const cleanup=[];const absent=(pid,group=false)=>{try{process.kill(group?-pid:pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 for(const world of nativeWorlds){const owners=path.join(world,'state/runtime/native-owners/v1');for(const nonce of await fs.readdir(owners).catch(()=>[])){
  const read=async name=>JSON.parse(await fs.readFile(path.join(owners,nonce,name+'.json'),'utf8'));let a,b,r;try{a=await read('admission');b=await read('birth');r=await read('recovery');}catch{}
  if(!a||!b||a.nonce!==nonce||b.nonce!==nonce||!ownedPids.has(a.hostPid)||r?.outcome==='active-owner-scope-joined')continue;
  if(!absent(b.nativePid,true))try{process.kill(-b.nativePid,'SIGKILL');}catch{}if(!absent(a.guardianPid))try{process.kill(a.guardianPid,'SIGTERM');}catch{}
  const deadline=performance.now()+6000;while(performance.now()<deadline&&(!absent(b.nativePid,true)||!absent(a.guardianPid)))await new Promise(resolve=>setTimeout(resolve,20));
  cleanup.push({world,nonce,status:absent(b.nativePid,true)&&absent(a.guardianPid)?'ABSENT_AFTER_FAILED_CONTROL':'UNKNOWN'});
 }}
 await fs.writeFile(path.join(root,'cleanup.json'),JSON.stringify(cleanup,null,2));assert.equal(cleanup.length,0,'Residual scopes remain a failed control even after targeted cleanup');
});
async function copyFixture(relative,target,change=s=>s){
 const original=await fs.readFile(path.join(source,relative),'utf8'),adapted=change(original),file=path.join(root,target);
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,adapted,{mode:0o600});
 adaptations.push({source:relative,target:file,originalSha256:sha(original),adaptedSha256:sha(adapted),changed:original!==adapted,original,adapted});return file;
}
function bindImports(text){return text.replace(/(['"])\.\.\/\.\.\/dist\/([^'"]+)\1/gu,(_match,_quote,relative)=>JSON.stringify(pathToFileURL(path.join(payload,'dist',relative)).href));}
async function guardFor(name,installed,fixtures){
 const trace=path.join(root,name+'-trace.json'),guard=path.join(root,name+'-guard.mjs');
 const bytes=`import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import http from 'node:http';import https from 'node:https';import dns from 'node:dns';import{registerHooks,syncBuiltinESMExports}from'node:module';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const payload=${JSON.stringify(installed)},allowed=new Set(${JSON.stringify([...fixtures,guard])}),manifest=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(path.dirname(installed), '..','manifests',path.basename(installed)+'.json'))})),assets=new Map(manifest.assets.filter(a=>a.kind==='file').map(a=>[a.path,a.sha256])),urls=new Set(),seen=new Set();let attempts=0;const deny=()=>{attempts++;throw Error('INSTALLED_TEST_NETWORK_REFUSED');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const api of[http,https])for(const key of['get','request'])api[key]=deny;for(const key of['lookup','resolve','resolve4','resolve6'])dns[key]=deny;syncBuiltinESMExports();
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('node:'))return result;if(!result.url.startsWith('file:'))throw Error('INSTALLED_MODULE_KIND_REFUSED');const file=fs.realpathSync(fileURLToPath(result.url));if(!allowed.has(file)){const rel=path.relative(payload,file);if(rel.startsWith('..')||path.isAbsolute(rel)||!assets.has(rel))throw Error('INSTALLED_SOURCE_FALLBACK_REFUSED');if(!seen.has(file)){if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==assets.get(rel))throw Error('INSTALLED_LOADED_HASH_MISMATCH');seen.add(file);}}urls.add(result.url);if(urls.size>4096)throw Error('INSTALLED_TRACE_LIMIT');return result;}});process.once('exit',()=>{const bytes=JSON.stringify({node:process.execPath,payload,urls:[...urls].sort(),attempts,verifiedInstalledFiles:seen.size});if(bytes.length>1048576)process.exitCode=1;else fs.writeFileSync(${JSON.stringify(trace)}+'.'+process.pid+'.json',bytes,{mode:0o600});if(attempts)process.exitCode=1;});`;
 await fs.writeFile(guard,bytes,{mode:0o600});return{guard,trace,sha256:sha(bytes)};
}
async function run(args,{cwd=root,env={},timeout=30000}={}){
 const result=await observed(node,args,{cwd,env:{PATH:'/usr/bin:/bin',HOME:root,USER:'owned',LOGNAME:'owned',LANG:'C',SHELL:'/bin/sh',...env},timeout,maxBuffer:2**20});return result;
}
async function traces(prefix){const records=[];for(const file of await fs.readdir(root))if(file.startsWith(path.basename(prefix)+'.'))records.push(JSON.parse(await fs.readFile(path.join(root,file),'utf8')));assert.ok(records.length);return{records,attempts:records.reduce((n,r)=>n+r.attempts,0),verifiedInstalledFiles:records.reduce((n,r)=>n+r.verifiedInstalledFiles,0),urls:[...new Set(records.flatMap(r=>r.urls))]};}
test('exact installed builtin profiles, official codecs and public ordinary/history consumers',{timeout:35000},async t=>{
 await fs.symlink(path.join(payload,'node_modules'),path.join(root,'node_modules'),'dir');
 const profiles=await copyFixture('tests/pi/builtin-provider-profiles.test.mjs','tests/pi/profiles.test.mjs',bindImports);
 const ordinary=await copyFixture('tests/controller/builtin-provider-ordinary.test.mjs','tests/controller/ordinary.test.mjs',bindImports);
 const wire=await copyFixture('tests/pi/provider-wire-fixture.mjs','tests/pi/provider-wire-fixture.mjs');
 const control=await guardFor('tripwire',payload,[]);let denied;
 try{await run(['--import',control.guard,'--input-type=module','-e',"import net from 'node:net';import http from 'node:http';import dns from 'node:dns';try{await fetch('http://127.0.0.1:1')}catch{}try{new net.Socket().connect(1,'127.0.0.1')}catch{}try{http.get('http://127.0.0.1:1')}catch{}try{dns.lookup('localhost',()=>{})}catch{}"]);}catch(error){denied=error;}
 assert.equal(denied?.code,1);assert.equal((await traces(control.trace)).attempts,4);
 const guard=await guardFor('direct',payload,[profiles,ordinary,wire]);
 const actual=await run(['--import',guard.guard,'--test','--test-concurrency=1',profiles,ordinary]);
 await fs.writeFile(path.join(root,'direct.log'),actual.stdout+actual.stderr);
 const trace=await traces(guard.trace);assert.equal(trace.attempts,0);assert.ok(trace.verifiedInstalledFiles>0);assert.ok(trace.urls.some(u=>u.endsWith('/dist/pi/native-provider.js')));assert.ok(trace.urls.some(u=>u.endsWith('/dist/controller/ordinary.js')));
 await fs.writeFile(path.join(root,'direct-receipt.json'),JSON.stringify({payloadId:base.payloadId,root,guard,trace,adaptations},null,2));t.diagnostic('Retained installed direct provider proof '+root);
});

for(const mode of['healthy','eof'])test('clean installed native-only '+mode+' variant exercises original auxiliary seam',{timeout:90000},async t=>{
 const variantRoot=path.join(root,'variant-'+mode),variantPayload=path.join(variantRoot,'payload');await fs.mkdir(variantRoot);
 const {copyAssetTree,inventoryTree,assetIdentity}=await import(pathToFileURL(path.join(payload,'dist/installation/tree.js')).href);
 await copyAssetTree(path.join(receipt.bundleRoot,'payload'),variantPayload);await copyAssetTree(path.join(receipt.bundleRoot,'bootstrap'),path.join(variantRoot,'bootstrap'));await fs.copyFile(path.join(receipt.bundleRoot,'install'),path.join(variantRoot,'install'));await fs.chmod(path.join(variantRoot,'install'),0o500);
 const protocol=await copyFixture('tests/pi/owned-runtime-auxiliary-protocol.mjs','protocol-'+mode+'.mjs');
 const nativeRelative='node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',native=path.join(variantPayload,nativeRelative);
 const wrapper='#!/bin/sh\nexec '+quote(node)+' '+quote(protocol)+' '+quote(mode)+' "$@"\n';await fs.chmod(native,0o700);await fs.writeFile(native,wrapper);await fs.chmod(native,0o500);
 const assets=await inventoryTree(variantPayload),manifest={...base,assets,payloadId:assetIdentity(assets)};
 const originalAssets=new Map(base.assets.map(a=>[a.path,a])),changed=assets.filter(a=>JSON.stringify(a)!==JSON.stringify(originalAssets.get(a.path))).map(a=>a.path);
 assert.deepEqual(changed,[nativeRelative]);assert.equal(assets.length,base.assets.length);await fs.writeFile(path.join(variantRoot,'bundle.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o400});
 const home=path.join(root,'installed-'+mode),activation=await observed(path.join(variantRoot,'install'),['activate','--bundle',variantRoot,'--home',home],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root},timeout:60000,maxBuffer:2**20});assert.equal(JSON.parse(activation.stdout).payloadId,manifest.payloadId);
 const installed=path.join(home,'versions',manifest.payloadId),world=path.join(root,'world-'+mode);await fs.mkdir(world,{mode:0o700});nativeWorlds.push(world);
 const child=await copyFixture(mode==='healthy'?'tests/pi/claude-auxiliary-owned-child.mjs':'tests/pi/owned-runtime-auxiliary-eof-child.mjs','tests/pi/'+mode+'-child.mjs');
 const noExternal=await copyFixture('tests/normal-hosted/no-external.mjs','tests/normal-hosted/no-external.mjs');
 const guard=await guardFor(mode,installed,[child,noExternal]);
 // Run the variant's pinned Node, not a checkout runtime; the base/variant Node hash is identical.
 assert.equal(sha(await fs.readFile(path.join(home,'bootstrap/node'))),base.platform.sha256);
 const actual=await observed(path.join(home,'bootstrap/node'),['--import',guard.guard,child,installed,world],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root,USER:'owned',LOGNAME:'owned',LANG:'C',SHELL:'/bin/sh'},timeout:30000,maxBuffer:2**20});await fs.writeFile(path.join(root,mode+'.log'),actual.stdout+actual.stderr);
 const result=JSON.parse(await fs.readFile(path.join(world,'receipt.json'),'utf8')),trace=await traces(guard.trace);assert.equal(result.complete,true);assert.equal(result.cleanup,'joined');assert.equal(trace.attempts,0);
 for(const suffix of['/dist/pi/owned-runtime.js','/dist/pi/claude-runtime.js','/@anthropic-ai/claude-agent-sdk/sdk.mjs','/@gitjig/pi-claude-bridge-host/dist/index.js'])assert.ok(trace.urls.some(url=>url.endsWith(suffix)),suffix);
 const absent=(pid,group=false)=>{try{process.kill(group?-pid:pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 const owners=path.join(world,'state/runtime/native-owners/v1'),journals=[],dirs=await nativeOwnerHistory(owners);
 for(const {dir} of dirs){
  const read=async name=>JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8'));const admission=await read('admission'),birth=await read('birth'),settlement=await read('settlement'),physical=await read('recovery');
  for(const item of[birth,settlement,physical])for(const key of['nonce','sessionId','guardianPid','executableSha256'])assert.equal(item[key],admission[key]);
  assert.equal(admission.executableSha256,sha(wrapper));assert.equal(admission.purpose,'summary');assert.equal(physical.outcome,'active-owner-scope-joined');assert.equal(settlement.cleanup,'confirmed');assert.equal(absent(birth.nativePid,true),true);assert.equal(absent(admission.guardianPid),true);journals.push({admission,birth,settlement,physical});
 }
 assert.equal(journals.length,mode==='healthy'?result.actualNativeChildren:1);
 if(mode==='eof'){assert.equal(journals[0].settlement.exitCode,0);assert.equal(journals[0].settlement.signal,null);assert.equal(result.historyCompactionsAfter,result.historyCompactionsBefore);}
 assert.equal(sha(await fs.readFile(path.join(payload,nativeRelative))),originalAssets.get(nativeRelative).sha256);
 await fs.writeFile(path.join(root,mode+'-receipt.json'),JSON.stringify({scope:'Native-substituted installed variant; all product/Pi/bridge/SDK JavaScript identical to base; no actual Claude service',basePayloadId:base.payloadId,variantPayloadId:manifest.payloadId,changed,home,guard,trace,result,journals,adaptations},null,2));t.diagnostic('Retained installed auxiliary variant '+home);
});

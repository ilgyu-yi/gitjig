// ROOT-only installed closure control: no prompt/native Claude query/real auth/model/engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('installed full Claude foundation owns three unprompted Pi sessions and closes without source fallback',{timeout:25000},async()=>{
 assert.ok(process.env.GITJIG_INSTALL_RECEIPT,'Exact independently accepted installed candidate receipt required');
 const receiptFile=await fs.realpath(process.env.GITJIG_INSTALL_RECEIPT),receiptBytes=await fs.readFile(receiptFile),{home,payloadId}=JSON.parse(receiptBytes);
 assert.ok(path.isAbsolute(home));assert.equal(await fs.realpath(home),home);assert.match(payloadId,/^[a-f0-9]{64}$/);
 const payload=await fs.realpath(path.join(home,'versions',payloadId)),node=await fs.realpath(path.join(home,'bootstrap/node'));
 const binding=JSON.parse(await fs.readFile(path.join(home,'binding.json'),'utf8'));assert.equal(binding.payloadId,payloadId);
 const manifestFile=path.join(home,'manifests',payloadId+'.json'),manifestBytes=await fs.readFile(manifestFile);assert.equal(sha(manifestBytes),binding.manifestSha256);
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'gitjig-installed-claude-foundation-')));await fs.chmod(root,0o700);
 const privateHome=path.join(root,'private-home');await fs.mkdir(privateHome,{mode:0o700});
 const workerSource=new URL('../pi/claude-host-child.mjs',import.meta.url),workerBytes=await fs.readFile(workerSource),worker=path.join(root,'claude-host-child.mjs'),traceFile=path.join(root,'installed-trace.json');
 await fs.writeFile(worker,workerBytes,{mode:0o600,flag:'wx'});assert.equal(sha(await fs.readFile(worker)),sha(workerBytes));
 // Only the unchanged worker's bare SessionManager import needs this ordinary Node resolution seam.
 await fs.symlink(path.join(payload,'node_modules'),path.join(root,'node_modules'),'dir');
 const guard=path.join(root,'installed-closure-guard.mjs');
 const guardText=`import {registerHooks,syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import dns from 'node:dns';import cp from 'node:child_process';
const payload=${JSON.stringify(payload)},subject=${JSON.stringify(root)},node=${JSON.stringify(node)},trace=${JSON.stringify(traceFile)},entry=${JSON.stringify(pathToFileURL(worker).href)},guard=${JSON.stringify(pathToFileURL(guard).href)};
const urls=new Set(),counts={networkRefused:0,processRefused:0,outsideReadRefused:0,resolveRefused:0};let traceLimit=false;
const originalWrite=fs.writeFileSync.bind(fs),realpath=fs.realpathSync.bind(fs),inside=(p,r)=>p===r||p.startsWith(r+path.sep);
function inputPath(p){if(p instanceof URL)return fileURLToPath(p);if(Buffer.isBuffer(p))return p.toString();return typeof p==='string'?p:null;}
function checkRead(p){const text=inputPath(p);if(text===null)return;const full=path.resolve(text);let actual=full;try{actual=realpath(full);}catch{}if(actual!==node&&!inside(actual,payload)&&!inside(actual,subject)){counts.outsideReadRefused++;throw Error('TEST_OUTSIDE_CONTENT_READ_REFUSED');}}
for(const name of ['readFileSync','readFile']){const original=fs[name].bind(fs);fs[name]=function(p,...a){checkRead(p);return original(p,...a);};}
const read=fsp.readFile.bind(fsp);fsp.readFile=async function(p,...a){checkRead(p);return read(p,...a);};
function deny(kind){return function(){counts[kind]++;throw Error('TEST_NO_FORWARD');};}
globalThis.fetch=deny('networkRefused');for(const api of [http,https])for(const name of ['request','get'])api[name]=deny('networkRefused');net.Socket.prototype.connect=deny('networkRefused');for(const name of ['lookup','resolve','resolve4','resolve6'])dns[name]=deny('networkRefused');
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny('processRefused');syncBuiltinESMExports();
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('node:'))return result;let allowed=result.url===entry||result.url===guard;if(result.url.startsWith('file:')){const file=realpath(fileURLToPath(result.url));allowed ||= inside(file,payload);}if(!allowed){counts.resolveRefused++;throw Error('TEST_UNINSTALLED_MODULE_REFUSED');}urls.add(result.url);if(urls.size>4096){traceLimit=true;throw Error('TEST_MODULE_TRACE_LIMIT');}return result;}});
process.once('exit',()=>{const record={node:process.execPath,entry:process.argv[1],urls:[...urls].sort(),counts,traceLimit,noPromptOrNativeQueryExpected:true};const text=JSON.stringify(record);if(Buffer.byteLength(text)>1048576){process.exitCode=1;return;}originalWrite(trace,text+'\\n',{mode:0o600,flag:'wx'});if(traceLimit||Object.values(counts).some(Boolean))process.exitCode=1;});
`;
 await fs.writeFile(guard,guardText,{mode:0o600,flag:'wx'});
 const env={PATH:'/usr/bin:/bin',HOME:privateHome,USER:process.env.USER??'owned',LOGNAME:process.env.LOGNAME??'owned',LANG:'C',SHELL:'/bin/sh'};
 const child=spawn(node,['--import',guard,worker,'healthy',root,path.join(payload,'dist')],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',capturedBytes=0,timedOut=false,captureExceeded=false,spawnError=null,escalate;
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
 const terminate=()=>{kill('SIGTERM');escalate??=setTimeout(()=>kill('SIGKILL'),500);};
 const timer=setTimeout(()=>{timedOut=true;terminate();},15000);
 const capture=key=>chunk=>{capturedBytes+=chunk.length;if(capturedBytes>262144){captureExceeded=true;terminate();return;}if(key==='out')stdout+=chunk.toString();else stderr+=chunk.toString();};
 child.stdout.on('data',capture('out'));child.stderr.on('data',capture('err'));child.once('error',error=>{spawnError=error.code??'UNKNOWN';});
 const terminal=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer);if(escalate)clearTimeout(escalate);
 const probeGroup=()=>{try{process.kill(-child.pid,0);return false;}catch(error){return error.code==='ESRCH'?true:null;}};
 const initiallyAbsent=probeGroup(),residualDetected=initiallyAbsent!==true;let groupAbsent=initiallyAbsent===true;
 const residualCleanup={residualDetected,termAttempted:false,killAttempted:false,status:groupAbsent?'JOINED':'UNKNOWN'};
 if(residualDetected){
  residualCleanup.termAttempted=true;kill('SIGTERM');const termDeadline=Date.now()+500;
  while(Date.now()<termDeadline&&probeGroup()!==true)await new Promise(resolve=>setTimeout(resolve,20));
  if(probeGroup()!==true){residualCleanup.killAttempted=true;kill('SIGKILL');const killDeadline=Date.now()+1000;while(Date.now()<killDeadline&&probeGroup()!==true)await new Promise(resolve=>setTimeout(resolve,20));}
  groupAbsent=probeGroup()===true;residualCleanup.status=groupAbsent?'JOINED_AFTER_RESIDUAL_FAILURE':'UNKNOWN';
 }
 const observation={scope:'Installed public unprompted full bridge/Pi/Controller foundation only; no learned/native Claude query/tool/helper/normalCLI/P7 claim',root,receipt:{file:receiptFile,sha256:sha(receiptBytes)},payloadId,payload,node,nodeSha256:sha(await fs.readFile(node)),manifestSha256:sha(manifestBytes),worker:{source:workerSource.href,sourceSha256:sha(workerBytes),copied:worker,copiedSha256:sha(await fs.readFile(worker))},guard:{file:guard,sha256:sha(Buffer.from(guardText))},terminal,stdout,stderr,capturedBytes,timedOut,captureExceeded,spawnError,groupAbsent,residualCleanup};
 await fs.writeFile(path.join(root,'child-observation.json'),JSON.stringify(observation,null,2)+'\n',{mode:0o600,flag:'wx'});
 assert.equal(timedOut,false);assert.equal(captureExceeded,false);assert.equal(spawnError,null);assert.equal(terminal.code,0,stderr);assert.equal(terminal.signal,null);assert.equal(groupAbsent,true);assert.equal(residualDetected,false,'Residual owned group remains a failed control even after cleanup');
 const result=JSON.parse(stdout.trim());assert.equal(result.mode,'healthy');assert.equal(result.complete,true);assert.equal(result.owners,3);assert.equal(result.hostAuthFileCreated,false);
 const trace=JSON.parse(await fs.readFile(traceFile,'utf8'));assert.equal(await fs.realpath(trace.node),node);assert.equal(trace.entry,worker);assert.equal(trace.traceLimit,false);assert.deepEqual(trace.counts,{networkRefused:0,processRefused:0,outsideReadRefused:0,resolveRefused:0});
 const urls=trace.urls;assert.ok(urls.some(u=>u.endsWith('/dist/pi/claude-host.js')));assert.ok(urls.some(u=>u.includes('/node_modules/@gitjig/pi-claude-bridge-host/')));assert.ok(urls.some(u=>u.includes('/node_modules/@earendil-works/pi-coding-agent/')));assert.ok(urls.some(u=>u.includes('/node_modules/@anthropic-ai/claude-agent-sdk/')));
 for(const url of urls)assert.ok(url===pathToFileURL(worker).href||url===pathToFileURL(guard).href||url.startsWith(pathToFileURL(payload+path.sep).href),'Uninstalled module resolved');
 console.log('RETAINED_INSTALLED_CLAUDE_FOUNDATION '+path.join(root,'child-observation.json'));
});

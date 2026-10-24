import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url));
for(const mode of ['management-admission','bridge-role-admission','closed-default','closed-role','closed-conversation','closed-new'])test('application bridge source '+mode,{timeout:18000},async()=>{
 const root=await realpath(await mkdtemp(join(repo,'.runtime-fixtures/bridge-app-')));
 for(const relative of ['home','tmp','host','agent','agent/home','state','artifacts','project','agent/extensions','host/.pi/extensions'])await mkdir(join(root,relative),{recursive:true,mode:0o700});
 await writeFile(join(root,'agent/claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
 for(const relative of ['agent/extensions/ambient.mjs','host/.pi/extensions/ambient.mjs'])await writeFile(join(root,relative),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root,'ambient-activated'))},'BAD');throw Error('AMBIENT_ACTIVATED');`);
 const guard=join(root,'guard.mjs');await writeFile(guard,`import fs from'node:fs';import net from'node:net';import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';let attempts=0;const deny=()=>{attempts++;throw Error('BRIDGE_TEST_IO_FORBIDDEN');};const ambient=${JSON.stringify(join(root,'home/.agents'))};for(const key of ['readdirSync','readFileSync','statSync','lstatSync','existsSync']){const original=fs[key];fs[key]=function(file,...args){if(String(file)===ambient||String(file).startsWith(ambient+'/'))return deny();return original.call(this,file,...args);};}globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;syncBuiltinESMExports();process.on('exit',()=>{if(attempts)process.exitCode=1;});`,{mode:0o600});
 const argv=['--import',guard,fileURLToPath(new URL('./bridge-models-worker.mjs',import.meta.url)),root,join(repo,'dist'),mode];
 const env={HOME:join(root,'agent/home'),TMPDIR:join(root,'artifacts'),PATH:'/usr/bin:/bin',USER:'owned',LOGNAME:'owned',LANG:'C',SHELL:'/bin/sh',PI_CODING_AGENT_DIR:join(root,'agent')};
 await writeFile(join(root,'invocation.json'),JSON.stringify({argv,cwd:join(root,'host'),env,scope:'zero generation',deadlineMs:12000},null,2));
 const child=spawn(process.execPath,argv,{cwd:join(root,'host'),env,stdio:['ignore','pipe','pipe'],detached:true});let out='',err='',expired=false,escalation;
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
 const timer=setTimeout(()=>{expired=true;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),500);},12000);
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 try{const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});await writeFile(join(root,'stdout'),out);await writeFile(join(root,'stderr'),err);await writeFile(join(root,'result.json'),JSON.stringify({...result,expired}));assert.equal(expired,false,root);assert.equal(result.code,0,err+' retained '+root);assert.equal(result.signal,null);assert.throws(()=>process.kill(-child.pid,0),error=>error.code==='ESRCH');const receipt=JSON.parse(out.trim());assert.equal(receipt.complete,true);if(mode==='management-admission')assert.equal(receipt.originalOrdinaryAdmission,true);else if(mode==='bridge-role-admission')assert.equal(receipt.originalRoleAdmission,true);else assert.equal(receipt.exactSnapshotUnchanged,true);console.log('retained '+root);
 }finally{clearTimeout(timer);if(escalation)clearTimeout(escalation);if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');}
});

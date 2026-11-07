import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
async function absent(file){try{await fs.stat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
for(const boundary of ['descriptor','stdin'])test('original Git supervisor rejects '+boundary+' FIFO before Git birth',{timeout:5000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-supervisor-input-'))),descriptor=path.join(root,'descriptor.json'),input=path.join(root,'stdin.bin'),marker=path.join(root,'unexpected-git-birth');
 if(boundary==='descriptor'){await exec('/usr/bin/mkfifo',[descriptor],{timeout:1000});await fs.chmod(descriptor,0o600);}else{
  await fs.writeFile(descriptor,JSON.stringify({version:1,parentPid:process.pid,commandId:'fifo-input',directory:root,binary:await fs.realpath(process.execPath),argv:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`],cwd:root,env:{PATH:'/usr/bin:/bin'},timeoutMs:1000,maxStdout:1024,excerptBytes:1024,inputBytes:0,inputSha256:createHash('sha256').update('').digest('hex')}),{mode:0o600});
  await exec('/usr/bin/mkfifo',[input],{timeout:1000});await fs.chmod(input,0o600);
 }
 const child=spawn(process.execPath,['dist/effects/git-process-child.js',descriptor],{stdio:['ignore','ignore','pipe','ipc']});let stderr='',expired=false;child.stderr.on('data',bytes=>{if(stderr.length<8192)stderr+=bytes;});
 const timer=setTimeout(()=>{expired=true;child.kill('SIGTERM');},2000);
 const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
 assert.equal(expired,false,'original supervisor FIFO read must refuse without harness termination');assert.equal(outcome.code,2,stderr);assert.equal(await absent(marker),true);assert.equal(await absent(path.join(root,'git-start.json')),true);
 if(boundary==='stdin'){const result=JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8'));assert.equal(result.gitStarted,false);assert.equal(result.gitPid,null);assert.equal(result.cleanup,'confirmed');assert.equal(result.settled,true);assert.equal(result.aborted,true);const terminal=JSON.parse(await fs.readFile(path.join(root,'terminal.json'),'utf8'));assert.equal(terminal.cleanup,'confirmed');assert.equal(terminal.gitStarted,false);}else{assert.equal(await absent(path.join(root,'result.json')),true);assert.equal(await absent(path.join(root,'terminal.json')),true);}
 t.diagnostic(JSON.stringify({fixture:root,boundary,originalSupervisorPid:child.pid,exit:outcome,actualGitBirth:false}));
});

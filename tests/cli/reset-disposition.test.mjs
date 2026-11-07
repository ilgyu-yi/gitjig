import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {parseInvocation} from '../../dist/cli/arguments.js';
const execute=promisify(execFile);
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-policy-cli-'))),home=path.join(root,'app');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset policy CLI '+root);});
 const c=await openController({installationHome:home});await c.close();await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/settings.json'),'original settings',{mode:0o600});
 const env={...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};delete env.NODE_TEST_CONTEXT;
 const command=['dist/cli/entry.js'];
 const run=async args=>{try{const result=await execute(process.execPath,[...command,...args,'--home',home],{env,timeout:10000});return {code:0,...result};}catch(error){return {code:error.code,stdout:error.stdout,stderr:error.stderr};}};
 return {root,home,env,run,pass(){passed=true;}};
}
test('reset policy and backup-management arguments retain exact explicit operands',()=>{
 for(const command of ['reset','reset preview','reset apply']){
  const args=[...command.split(' '),'--scope','all','--disposition','delete',...(command==='reset apply'?['--confirm','reviewed']:[])];
  const parsed=parseInvocation(args);assert.equal(parsed.command,command);assert.equal(parsed.options.get('disposition'),'delete');
 }
 for(const command of ['reset backups','reset backup-recover'])assert.equal(parseInvocation(command.split(' ')).command,command);
 const parsed=parseInvocation(['reset','backup-delete','--backup','original-id','--confirm','original-fingerprint']);assert.equal(parsed.options.get('backup'),'original-id');assert.equal(parsed.options.get('confirm'),'original-fingerprint');
 assert.throws(()=>parseInvocation(['reset','recover','--disposition','delete']),/Unsupported option/);
});
test('public reset CLI binds backup vs permanent deletion to separate previews',async t=>{
 const f=await fixture(t);const invalid=await f.run(['reset','preview','--scope','settings','--disposition','invalid']);assert.equal(invalid.code,2);assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');const preview=await f.run(['reset','preview','--scope','settings']);assert.equal(preview.code,0,preview.stderr);const original=JSON.parse(preview.stdout);assert.equal(original.disposition,'backup');
 const wrong=await f.run(['reset','apply','--scope','settings','--disposition','delete','--confirm',original.fingerprint]);assert.equal(wrong.code,2);assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');
 const selected=await f.run(['reset','preview','--scope','settings','--disposition','delete']);assert.equal(selected.code,0,selected.stderr);const deletion=JSON.parse(selected.stdout);assert.equal(deletion.disposition,'delete');assert.notEqual(deletion.fingerprint,original.fingerprint);
 const mismatch=await f.run(['reset','apply','--scope','settings','--confirm',deletion.fingerprint]);assert.equal(mismatch.code,2);
 const applied=await f.run(['reset','apply','--scope','settings','--disposition','delete','--confirm',deletion.fingerprint]);assert.equal(applied.code,0,applied.stderr);await assert.rejects(fs.stat(path.join(f.home,'config')),{code:'ENOENT'});f.pass();
});
test('public backup-management CLI lists, refuses stale confirmation and deletes only the selected saved backup',async t=>{
 const f=await fixture(t),preview=JSON.parse((await f.run(['reset','preview','--scope','settings'])).stdout),applied=await f.run(['reset','apply','--scope','settings','--confirm',preview.fingerprint]);assert.equal(applied.code,0,applied.stderr);
 const active=path.join(f.home,'inputs/active-sentinel'),other=path.join(f.home,'reset-backups/kept/sentinel');await fs.writeFile(active,'keep active input');await fs.mkdir(path.dirname(other),{mode:0o700});await fs.writeFile(other,'keep other retained path');
 const listed=await f.run(['reset','backups']);assert.equal(listed.code,0,listed.stderr);const backups=JSON.parse(listed.stdout).backups;assert.equal(backups.length,1);const backup=backups[0];assert.equal(typeof backup.fingerprint,'string');
 const original=path.join(f.home,'reset-backups',backup.backupId,'config/settings.json');assert.equal(await fs.readFile(original,'utf8'),'original settings');
 const refused=await f.run(['reset','backup-delete','--backup',backup.backupId,'--confirm','0'.repeat(64)]);assert.equal(refused.code,2);assert.equal(await fs.readFile(original,'utf8'),'original settings');
 const removed=await f.run(['reset','backup-delete','--backup',backup.backupId,'--confirm',backup.fingerprint]);assert.equal(removed.code,0,removed.stderr);await assert.rejects(fs.stat(path.dirname(path.dirname(original))),{code:'ENOENT'});
 assert.equal(await fs.readFile(active,'utf8'),'keep active input');assert.equal(await fs.readFile(other,'utf8'),'keep other retained path');
 const after=await f.run(['reset','backups']);assert.equal(after.code,0,after.stderr);assert.deepEqual(JSON.parse(after.stdout).backups,[]);const recovered=await f.run(['reset','backup-recover']);assert.equal(recovered.code,0,recovered.stderr);f.pass();
});
for(const [policy,answer] of [['backup','cancel'],['','cancel'],['delete','RESET'],['delete','DELETE'],['cancel',null]])test('standalone terminal chooses '+policy+' before preview; final answer '+answer,{timeout:15000},async t=>{
 const f=await fixture(t),chosen=policy||'backup',file=path.join(f.root,'pty.json'),steps=[{wait:'Reset data policy:',send:policy+'\n'},...(answer===null?[]:[{wait:chosen==='backup'?'Type RESET to confirm':'Type DELETE to confirm',send:answer+'\n'}])];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'dist/cli/entry.js','reset','--home',f.home,'--scope','settings'],env:f.env,steps,timeoutSeconds:9,gracefulShutdownSeconds:2,output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const output=await fs.readFile(file+'.terminal','utf8');if(answer==='DELETE'){await assert.rejects(fs.stat(path.join(f.home,'config')),{code:'ENOENT'});assert.match(output,/cannot be undone/);}else{assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');assert.match(output,/Reset cancelled/);}if(policy==='cancel')assert.doesNotMatch(output,/"fingerprint"/);f.pass();
});

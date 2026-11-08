import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {parseInvocation} from '../../dist/cli/arguments.js';
import {resetRecoveryCommand} from '../../dist/installation/reset-recovery-command.js';
const execute=promisify(execFile);
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-policy-cli-'))),home=path.join(root,'app');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset policy CLI '+root);});
 const c=await openController({installationHome:home});await c.close();await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/settings.json'),'original settings',{mode:0o600});
 const env={...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LC_ALL:'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};delete env.NODE_TEST_CONTEXT;
 const command=[cliEntry];
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
test('reset recovery displays one literal home operand and avoids control-bearing command text',()=>{
 const home="/private/test/owner's archive $final";
 assert.equal(resetRecoveryCommand(home,'recover'),"gitjig reset recover --home '/private/test/owner'\\''s archive $final'");
 for(const unsafe of ['\n','\x1b','\u202e'])
  assert.equal(resetRecoveryCommand('/private/test/'+unsafe+'home','backup-recover'),
   'gitjig reset backup-recover with --home set to the original application home');
});
test('public reset CLI binds backup vs permanent deletion to separate previews',async t=>{
 const f=await fixture(t);const invalid=await f.run(['reset','preview','--scope','settings','--disposition','invalid']);assert.equal(invalid.code,2);assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');const preview=await f.run(['reset','preview','--scope','settings']);assert.equal(preview.code,0,preview.stderr);const original=JSON.parse(preview.stdout);assert.equal(original.disposition,'backup');
 const wrong=await f.run(['reset','apply','--scope','settings','--disposition','delete','--confirm',original.fingerprint]);assert.equal(wrong.code,2);assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');
 const selected=await f.run(['reset','preview','--scope','settings','--disposition','delete']);assert.equal(selected.code,0,selected.stderr);const deletion=JSON.parse(selected.stdout);assert.equal(deletion.disposition,'delete');assert.notEqual(deletion.fingerprint,original.fingerprint);
 const mismatch=await f.run(['reset','apply','--scope','settings','--confirm',deletion.fingerprint]);assert.equal(mismatch.code,2);
 const applied=await f.run(['reset','apply','--scope','settings','--disposition','delete','--confirm',deletion.fingerprint]);assert.equal(applied.code,0,applied.stderr);await assert.rejects(fs.stat(path.join(f.home,'config')),{code:'ENOENT'});f.pass();
});
for(const disposition of ['backup','delete'])test('public reset apply reports no work for an exact empty review · '+disposition,async t=>{
 const f=await fixture(t);
 const preview=async policy=>JSON.parse((await f.run(['reset','preview','--scope','settings','--disposition',policy])).stdout);
 const apply=(plan,policy)=>f.run(['reset','apply','--scope','settings','--disposition',policy,'--confirm',plan.fingerprint]);
 const first=JSON.parse((await apply(await preview('backup'),'backup')).stdout);
 const backup=path.join(first.backup,'config/settings.json'),receipt=await fs.readFile(path.join(first.backup,'reset-receipt.json'));
 const before=await fs.readdir(path.join(f.home,'reset-backups'));
 const empty=await preview(disposition);
 assert.deepEqual(empty.paths,[]);
 assert.equal(empty.backupDirectory,null);
 const result=await apply(empty,disposition);
 assert.equal(result.code,0,result.stderr);
 const outcome=JSON.parse(result.stdout);
 assert.deepEqual([outcome.reset,outcome.reason,outcome.disposition,outcome.backup],[false,'nothing-to-reset',disposition,null]);
 assert.deepEqual(await fs.readdir(path.join(f.home,'reset-backups')),before);
 assert.deepEqual(await fs.readFile(path.join(first.backup,'reset-receipt.json')),receipt);
 assert.equal(await fs.readFile(backup,'utf8'),'original settings');
 for(const name of ['reset-deletions','reset-pending.json'])await assert.rejects(fs.lstat(path.join(f.home,name)),{code:'ENOENT'});
 const config=path.join(f.home,'config');
 await fs.mkdir(config,{mode:0o700});
 await fs.writeFile(path.join(config,'new-settings'),'created after review',{mode:0o600});
 const stale=await apply(empty,disposition);
 assert.equal(stale.code,2);assert.match(stale.stderr,/Reset preview changed/);
 assert.equal(await fs.readFile(path.join(config,'new-settings'),'utf8'),'created after review');
 f.pass();
});
for(const [locale,disposition] of [['en','backup'],['ko','delete']])test('standalone terminal skips destructive confirmation for an empty scope · '+locale,{timeout:15000},async t=>{
 const f=await fixture(t),preview=JSON.parse((await f.run(['reset','preview','--scope','settings'])).stdout);
 const first=await f.run(['reset','apply','--scope','settings','--confirm',preview.fingerprint]);
 assert.equal(first.code,0,first.stderr);
 const file=path.join(f.root,locale+'-empty.json'),output=file+'.terminal';
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,cliEntry,'reset','--home',f.home,'--scope','settings','--disposition',disposition],
  env:{...f.env,LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8'},steps:[],timeoutSeconds:7,gracefulShutdownSeconds:2,output}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);
 const terminal=await fs.readFile(output,'utf8');
 assert.match(terminal,locale==='ko'?/선택한 범위에 초기화할 데이터가 없습니다/:/No data to reset in the selected scope/);
 assert.doesNotMatch(terminal,/Type (RESET|DELETE)|확인하려면 (RESET|DELETE)|Reset complete|초기화 완료/);
 const listed=await f.run(['reset','backups']);assert.equal(listed.code,0,listed.stderr);
 assert.equal(JSON.parse(listed.stdout).backups.length,1);
 f.pass();
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
 const output=await fs.readFile(file+'.terminal','utf8');if(answer==='DELETE'){await assert.rejects(fs.stat(path.join(f.home,'config')),{code:'ENOENT'});assert.match(output,/cannot be undone/);assert.match(output,/Reset complete. The selected data was permanently deleted/);assert.match(output,/Launch gitjig again/);}else{assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');assert.match(output,/Reset cancelled/);assert.doesNotMatch(output,/Reset complete/);}if(policy==='cancel')assert.doesNotMatch(output,/"fingerprint"/);f.pass();
});

test('standalone reset follows Korean terminal locale and reports the actual retained backup', {timeout:15000}, async t => {
 const f=await fixture(t),file=path.join(f.root,'reset-ko.json'),output=file+'.terminal';
 const env={...f.env,LC_ALL:'ko_KR.UTF-8'};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'dist/cli/entry.js','reset','--home',f.home,'--scope','settings','--disposition','backup'],
    env,steps:[{wait:'RESET를 입력하세요',send:'RESET\n'}],timeoutSeconds:9,output}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,1);
 const text=await fs.readFile(output,'utf8');
 const listed=await f.run(['reset','backups']);assert.equal(listed.code,0,listed.stderr);
 const [backup]=JSON.parse(listed.stdout).backups;
 const retained=path.join(f.home,'reset-backups',backup.backupId);
 assert.match(text,/초기화 완료\. 비공개 백업/);
 assert.ok(text.includes(retained));assert.match(text,/gitjig를 다시 실행하세요/);
 assert.equal(await fs.readFile(path.join(retained,'config/settings.json'),'utf8'),'original settings');
 f.pass();
});

async function retainRecoveryObservation(t,f,value){
 await fs.writeFile(path.join(f.root,'recovery-observation.json'),JSON.stringify(value,null,2));
 if(process.env.GITJIG_RESET_EVIDENCE_ROOT){const destination=path.join(process.env.GITJIG_RESET_EVIDENCE_ROOT,t.name.replace(/[^a-zA-Z0-9-]/g,'_'));await fs.mkdir(destination,{recursive:true,mode:0o700});await fs.cp(f.root,path.join(destination,'closed-fixture'),{recursive:true,errorOnExist:true,force:false});}
}
for(const prior of ['fresh','backup','delete'])test('public reset recover is an explicit no-op after '+prior,async t=>{
 const f=await fixture(t);let applied;
 if(prior!=='fresh'){
  const preview=await f.run(['reset','preview','--scope','settings','--disposition',prior]);assert.equal(preview.code,0,preview.stderr);
  applied=await f.run(['reset','apply','--scope','settings','--disposition',prior,'--confirm',JSON.parse(preview.stdout).fingerprint]);assert.equal(applied.code,0,applied.stderr);
 }
 const before=await fs.readFile(path.join(f.home,'state/controller.sqlite')),result=await f.run(['reset','recover']);
 assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{recovered:'nothing-pending',reset:false});
 const after=await fs.readFile(path.join(f.home,'state/controller.sqlite'));assert.deepEqual(after,before);
 if(prior==='fresh')assert.equal(await fs.readFile(path.join(f.home,'config/settings.json'),'utf8'),'original settings');
 else if(prior==='backup'){const backup=JSON.parse(applied.stdout).backup;assert.equal(await fs.readFile(path.join(backup,'config/settings.json'),'utf8'),'original settings');}
 else await assert.rejects(fs.access(path.join(f.home,'config')),{code:'ENOENT'});
 await retainRecoveryObservation(t,f,{prior,applied,result,databaseBeforeSha256:createHash('sha256').update(before).digest('hex'),databaseAfterSha256:createHash('sha256').update(after).digest('hex')});
 f.pass();
});

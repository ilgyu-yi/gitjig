import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);

for(const [scope,disposition,answer] of [['settings','backup','cancel'],['settings','backup','RESET'],['all','backup','RESET'],['settings','delete','DELETE'],['all','delete','DELETE'],['settings','delete','RESET']])test('original terminal hands off reset '+scope+' '+disposition+' after close; final word '+answer,{timeout:20000},async t=>{
 const confirm=answer===(disposition==='backup'?'RESET':'DELETE');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-pty-'))),home=path.join(root,'app');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset terminal '+root);});
 const c=await openController({installationHome:home});const cid=c.createConversation().conversationId;await c.close();
 const config=path.join(home,'config');await fs.mkdir(config,{recursive:true,mode:0o700});const original='{"editorPaddingX":2}\n';await fs.writeFile(path.join(config,'settings.json'),original,{mode:0o600});
 const keptBackup=path.join(home,'reset-backups/kept');await fs.mkdir(keptBackup,{recursive:true,mode:0o700});await fs.writeFile(path.join(keptBackup,'sentinel'),'prior backup retained');
 const file=path.join(root,'pty.json');const steps=[
  {wait:'/ready',send:confirm?'/reset\r':'/settings\r'},
  ...(!confirm?[{wait:'Application preferences',send:'Reset local application data\r'}]:[]),
  {wait:'Reset local gitjig data',send:scope==='all'?'Reset all local\r':'Reset settings\r'},
  {wait:'Reset data policy',send:disposition==='backup'?'Keep a private backup\r':'Permanently delete selected data\r'},
  {wait:'Reset scope',send:'\x1b'},
  {wait:'Continue to reset review',send:'Close safely\r'},
  {wait:disposition==='backup'?'Type RESET to confirm':'Type DELETE to confirm',send:answer+'\n'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/cli/account-ui-no-network.mjs','dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid],env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:14,gracefulShutdownSeconds:3,output:file+'.terminal'}));
 const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
 assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
 const output=await fs.readFile(file+'.terminal','utf8');assert.ok(output.includes(home));
 assert.equal(await fs.readFile(path.join(keptBackup,'sentinel'),'utf8'),'prior backup retained');
 if(confirm){assert.equal(await fs.access(path.join(config,'settings.json')).then(()=>true,()=>false),false);if(disposition==='delete'){assert.match(output,/permanent deletion/);assert.deepEqual(await fs.readdir(path.dirname(keptBackup)),['kept']);}else{const ids=(await fs.readdir(path.dirname(keptBackup))).filter(id=>id!=='kept');assert.equal(ids.length,1);assert.equal(await fs.readFile(path.join(path.dirname(keptBackup),ids[0],'config/settings.json'),'utf8'),original);}}
 else{assert.equal(await fs.readFile(path.join(config,'settings.json'),'utf8'),original);assert.match(output,/Reset cancelled/);}
 const reopened=await openController({installationHome:home});if(scope==='all'&&confirm)assert.equal(reopened.listConversations().length,0);else assert.equal(reopened.inspectConversation(cid).conversationId,cid);await reopened.close();passed=true;
});

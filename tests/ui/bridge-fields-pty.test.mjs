import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
const execute=promisify(execFile);
test('actual terminal saves plain bridge fields and metadata-only relaunch exposes saved active sources without native execution',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-bridge-setup-ui-'))),home=path.join(root,'application'),executable=path.join(root,'native-fixture'),policyFile=path.join(root,'agent/claude-bridge.json'),account=path.join(root,'account');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained bridge setup terminal '+root);});for(const name of ['host','agent','agent/home','account','docker'])await fs.mkdir(path.join(root,name),{mode:0o700});await fs.writeFile(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});const digest=createHash('sha256').update(await fs.readFile(executable)).digest('hex'),policy='{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}';await fs.writeFile(policyFile,policy,{mode:0o600});await fs.writeFile(path.join(account,'private-token'),'PRIVATE_ACCOUNT_UNREAD',{mode:0o600});const c=await openController({installationHome:home});try{await ApplicationStartup.open(c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',dockerConfigDirectory:path.join(root,'docker'),image:'sha256:'+'0'.repeat(64),memoryMiB:768}});}finally{await c.close();}
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''},empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]}];
 const run=async(label,steps)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/PRIVATE_ACCOUNT_UNREAD/);return output;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-9000));throw error;}};
 await run('save',[
  {wait:'Model: not selected',send:'/setup bridge\x1b\r'},
  {wait:'Bridge prerequisites',send:'\x1b'},
  {wait:'Bridge setup · staged',send:'Edit bridge paths and executable pin\r'},
  {wait:'Bridge host directory',send:path.join(root,'host')+'\r'},
  {wait:'Bridge agent directory',send:path.join(root,'agent')+'\r'},
  {wait:'Native Claude Code account directory',send:account+'\r'},
  {wait:'Pinned Claude executable',send:executable+'\r'},
  {wait:'Executable SHA256',send:digest+'\r'},
  {wait:'Bridge setup · staged',send:'Review and save bridge\r'},
  {wait:'Review next-launch bridge setup',send:'\x1b'},
  {wait:'Explicit bridge setup action',send:'Save bridge for next launch\r'},
  {wait:'Bridge saved for next launch',queries:[...empty,{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ]);
 const file=path.join(home,'config/startup.json'),saved=JSON.parse(await fs.readFile(file));assert.equal(saved.runtime.memoryMiB,768);assert.equal(saved.bridge.profile.executable.sha256,digest);assert.equal(saved.bridge.nativeAccountDirectory,account);
 const output=await run('metadata-relaunch',[
  {wait:'Model: not selected',send:'/setup inspect\x1b\r'},
  {wait:'Sources · {"runtime":"saved","bridge":"saved"}',queries:empty,send:'\x1b'},
  {wait:'INPUT',queries:[...empty,{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ]);assert.match(output,/current process kept/);assert.deepEqual(JSON.parse(await fs.readFile(file)),saved);assert.equal(await fs.readFile(policyFile,'utf8'),policy);assert.equal(await fs.readFile(path.join(account,'private-token'),'utf8'),'PRIVATE_ACCOUNT_UNREAD');passed=true;
});

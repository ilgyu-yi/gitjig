import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
test('actual source local terminal refuses execution before work when active runtime is missing and preserves cancelled command draft',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-local-check-ui-'))),home=path.join(root,'home'),project=path.join(root,'project'),file=path.join(root,'terminal.json');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained no-runtime local check UI '+root);});await fs.mkdir(project);
 const c=await openController({installationHome:home});try{await c.registerProject({id:'p',sourceRoot:project});}finally{await c.close();}
 const steps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Run new isolated check\r'},
  {wait:'Local check unavailable',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM budgets',rows:[[0]]}],send:'\x1b'},
  {wait:'Choose a recovery entry',queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM budgets',rows:[[0]]}],assertDraft:'/local',send:'\x1b'},
  {wait:'Local development',send:'Retained local checks\r'},
  {wait:'Retained local checks',send:'Back\r'},
  {wait:'Local development',send:'Retained candidates and commit audit\r'},
  {wait:'Retained candidates',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['/local']]}],assertDraft:'/local',send:'\x15/quit\x1b\r'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.match(await fs.readFile(file+'.terminal','utf8'),/No active execution runtime/);await assert.rejects(fs.lstat(path.join(home,'local-candidates')),{code:'ENOENT'});passed=true;}finally{if(!passed)t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-12000));}
});

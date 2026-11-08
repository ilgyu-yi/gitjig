import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
const execute=promisify(execFile);
test('actual model-free terminal inspects route diagnostics, selects before login and cancels thinking without dispatch',{timeout:18000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-model-picker-ui-'))),home=path.join(root,'home'),file=path.join(root,'terminal.json');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained model picker terminal '+root);});const c=await openController({installationHome:home}),accounts=ApplicationAccounts.open(c);try{await accounts.configure({providers:{'picker-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'alpha',name:'Picker Alpha',reasoning:true}]}}});}finally{await c.close();}
 const choiceQuery={sql:"SELECT json_extract(data,'$.modelChoice.modelId') FROM conversation_state",rows:[['alpha']]},empty=[{sql:'SELECT COUNT(*) FROM works',rows:[[0]]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]}];
 const steps=[
  {wait:'Model: not selected',send:'/model\x1b\r'},
  {wait:'Model for this conversation',send:'Inspect model routes and application scope\r'},
  {wait:'Model routes and application scope',queries:empty,send:'\x1b'},
  {wait:'Model for this conversation',send:'picker-fixture/alpha\r'},
  {wait:'Model selected for this conversation',queries:[choiceQuery,...empty,{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/thinking\x1b\r'},
  {wait:'Thinking level',send:'\x1b'},
  {wait:'INPUT',queries:[choiceQuery,...empty,{sql:'SELECT draft FROM conversation_views',rows:[['/thinking']]}],assertDraft:'/thinking',send:'\x15/quit\x1b\r'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.match(output,/availability not checked/);assert.match(output,/claude-bridge/);assert.match(output,/restart/);assert.match(output,/Model: alpha/);const closingFile=path.join(root,'close-terminal.json'),closingSteps=[{wait:'Model: alpha',send:'\x15/model\x1b\r'},{wait:'Model for this conversation',queries:[choiceQuery,...empty],assertDraft:'/model',terminate:true,send:''}];await fs.writeFile(closingFile,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','dist/cli/entry.js'],env,steps:closingSteps,timeoutSeconds:5,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:closingFile+'.terminal',gracefulShutdownSeconds:3}));const closed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',closingFile],{timeout:9000,maxBuffer:2**20})).stdout);assert.equal(closed.exitCode,0);assert.equal(closed.stages,closingSteps.length);assert.equal(closed.terminalRestored,true);passed=true;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
});

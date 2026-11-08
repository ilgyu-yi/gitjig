import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
test('actual terminal restores and accounts close despite an original goal interruption storage failure',{timeout:14000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-goal-quiesce-ui-'))),home=path.join(root,'home'),file=path.join(root,'terminal.json'),marker=path.join(root,'account-closed');let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained goal quiescence terminal '+root);});const c=await openController({installationHome:home});let goal;try{goal=c.createGoal({conversationId:c.createConversation().conversationId,objective:'Retain original fixture',criteria:['Preserve unavailable interruption record'],turnLimit:2});}finally{await c.close();}
 const steps=[{wait:'Model: not selected',send:'/model\x1b\r'},{wait:'Model for this conversation',terminate:true,send:''}],env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_TEST_QUIESCE_GOAL:goal.goalId,GITJIG_TEST_ACCOUNT_CLOSED:marker};await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/local-no-execution.mjs','--import','./tests/ui/model-quiesce-failure.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,2);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(await fs.readFile(marker,'utf8'),'closed');const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT state FROM goals WHERE id=?').get(goal.goalId).state,'ACTIVE');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,0);}finally{db.close();}assert.match(await fs.readFile(file+'.terminal','utf8'),/CONTROLLED_GOAL_INTERRUPTION_WRITE/);passed=true;}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
});

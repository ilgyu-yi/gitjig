import os from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {registryWorld} from '../controller/change-registry-fixture.mjs';import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
test('actual source CLI finds original work from readiness and extends its budget without model, engine or goal turn changes',{timeout:22000},async t=>{
 // The shared fixture resolves its prefix against .runtime-fixtures. Use an
 // explicit relative prefix to place this owned world under the OS temp root.
 const prefix=path.relative(path.resolve('.runtime-fixtures'),path.join(os.tmpdir(),'gitjig-work-recovery-'));
 const f=await registryWorld(t,prefix),id=f.works[0].workId,cid=f.c.createConversation().conversationId,goal=f.c.createGoal({conversationId:cid,objective:'Retain goal allowance',criteria:['Original work recovery stays separate'],turnLimit:3}),snapshot=f.c.inspectWorkAllowance(id),draft='Retain unrelated 한국어 draft';f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});await f.c.close();
 const file=path.join(f.root,'work-ui.json'),steps=[
  {wait:'Model: not selected',send:'\x07e'},
  {wait:'Error recovery · choose a next step',send:'Open goal recovery\r'},
  {wait:'Goal · Not started',send:'Return without action\r'},
  {wait:'INPUT',assertDraft:draft,send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings and details\r'},
  {wait:'More settings and details',send:'Work recovery\r'},
  {wait:'Original work and allowances',send:id+'\r'},
  {wait:'Work recovery · #',send:'Inspect retained\r'},
  {wait:'Original work · inspection only',send:'\x1b'},
  {wait:'Work recovery · #',send:'Review managed change\r'},
  {wait:'Managed change · inspection only',send:'\x1b'},
  {wait:'Work recovery · #',send:'Review resume\r'},
  {wait:'Resume · A · #',send:'Cancel\r'},
  {wait:'Original work and allowances',assertDraft:draft,send:id+'\r'},
  {wait:'Work recovery · #',send:'Extend shared execution\r'},
  {wait:'Additional execution units',send:'\x153\r'},
  {wait:'Owner reason',send:'Owner confirms a bounded retry\r'},
  {wait:'Extend execution',send:'Add 3 execution\r'},
  {wait:'allowance extended',assertDraft:draft,queries:[{sql:'SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?',params:[snapshot.lineageRoot,'execution'],rows:[[snapshot.execution.limit+3,snapshot.execution.consumed,snapshot.execution.reserved]]},{sql:"SELECT json_extract(data,'$.turnLimit') FROM goals WHERE id=?",params:[goal.goalId],rows:[[3]]}],terminate:true,send:''},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/reopen-no-dispatch.mjs','dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:16,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:20000,maxBuffer:2**20}).catch(async error=>{const retained=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-work-recovery-failed-'));await fs.cp(f.root,path.join(retained,'fixture'),{recursive:true});t.diagnostic('Retained terminal failure '+retained);throw error;})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const c=await openController({installationHome:f.home});try{assert.equal(c.inspectConversation(cid).draft.text,draft);assert.equal(c.inspectGoal(goal.goalId).startedAttempts,0);assert.equal(c.inspectGoal(goal.goalId).turnLimit,3);assert.equal(c.inspectWorkAllowance(id).execution.limit,snapshot.execution.limit+3);assert.equal(c.inspectWork(id).runs.length,1);assert.deepEqual(c.inspectWorkAllowance(id).resolution,snapshot.resolution);}finally{await c.close();}
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
test('actual source CLI cancels scoped new, opens saved-default project context and searches commands without consuming menu draft',{timeout:14000},async t=>{
 const f=await managedWorld(t),draft='/model managed-fixture/future';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});await f.c.close();const file=path.join(f.root,'repeat.json'),steps=[
  {wait:'Model: original',send:'\x07n'},
  {wait:'New independent conversation',send:'Cancel\r'},
  {wait:draft,assertDraft:draft,queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[2]]}],send:'\x07n'},
  {wait:'New independent conversation',send:'Current project\r'},
  {wait:'Model: future',assertDraft:'',queries:[{sql:'SELECT COUNT(*) FROM conversations',rows:[[3]]},{sql:'SELECT c.project FROM conversations c JOIN interaction_view v ON c.id=v.selected',rows:[['P']]}],send:'/session\x07/'},
  {wait:'Gitjig commands · search',assertDraft:'/session',send:'/ready\r'},
  {wait:'Setup and next actions',assertDraft:'/session',send:'\x1b'},
  {wait:'/session',assertDraft:'/session',terminate:true,send:''},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/reopen-no-dispatch.mjs','dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',f.cid],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const r=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(r.exitCode,0);assert.equal(r.stages,steps.length);assert.equal(r.terminalRestored,true);
 const c=await openController({installationHome:f.home});try{const rows=c.listConversations();assert.equal(rows.length,3);const created=rows.find(v=>![f.cid,f.other].includes(v.conversationId));assert.equal(created.parentId,null);assert.equal(created.workId,null);assert.equal(created.historyRef,null);assert.equal(c.inspectConversation(f.cid).draft.text,draft);assert.equal(c.getConversationModelChoice(f.cid).modelId,'original');assert.equal(c.getConversationModelChoice(created.conversationId).modelId,'future');assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);}finally{await c.close();}f.pass();
});

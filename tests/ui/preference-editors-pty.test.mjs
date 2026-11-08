import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';import {ApplicationSettings} from '../../dist/app/settings.js';import {openController} from '../../dist/controller/index.js';
const execute=promisify(execFile);
test('actual source terminal stages scope edits, cancels without writes and saves plain thinking preferences without execution',{timeout:14000},async t=>{
 const f=await managedWorld(t);await f.accounts.setScope(['managed-fixture/original:high']);const pref=path.join(f.home,'config/settings.json'),before=await fs.readFile(pref,'utf8');await f.c.close();const file=path.join(f.root,'preferences.json'),steps=[
  {wait:'Model: original',send:'/scoped-models\x1b\r'},
  {wait:'Application model scope',send:'Add catalogue model\r'},
  {wait:'Add a model to the cycling pool',send:'managed-fixture/future\r'},
  {wait:'2 ordered patterns',send:'Cancel\r'},
  {wait:'Command cancelled; draft kept',assertDraft:'/scoped-models',textFiles:[{path:pref,value:before}],send:'\x15/scoped-models\x1b\r'},
  {wait:'Application model scope',send:'Add Pi pattern\r'},
  {wait:'Pi model pattern',send:'managed-fixture/future:off\r'},
  {wait:'2 ordered patterns',send:'Save application cycling pool\r'},
  {wait:'Model scope saved',send:'/settings modelThinkingLevels\x1b\r'},
  {wait:'Application per-model thinking',send:'Add catalogue model\r'},
  {wait:'choose catalogue reference',send:'managed-fixture/future\r'},
  {wait:'requested thinking; Pi clamps',send:'high\r'},
  {wait:'Application per-model thinking',send:'Save application thinking preferences\r'},
  {wait:'Saved application preference: modelThinkingLevels',queries:[{sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[f.cid],rows:[['']]},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],expectedChoice:{kind:'managed',modelId:'original'},assertDraft:'',terminate:true,send:''},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/reopen-no-dispatch.mjs','dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',f.cid],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const c=await openController({installationHome:f.home});try{const app=ApplicationSettings.open(c).inspect().global;assert.deepEqual(app.enabledModels,['managed-fixture/original:high','managed-fixture/future:off']);assert.deepEqual(app.modelThinkingLevels,{'managed-fixture/future':'high'});assert.equal(app.defaultModel,'future');assert.equal(c.getConversationModelChoice(f.cid).modelId,'original');assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n,0);}finally{await c.close();}f.pass();
});

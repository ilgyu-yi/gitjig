/** Cold original terminal over a controlled owner entry and explicitly seeded failure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';
import {seedPlanningFailure,seedPlanningQuota,seedNormalQuota} from '../controller/planning-failure-fixture.mjs';
const execute=promisify(execFile),packageRoot=process.env.GITJIG_TEST_PACKAGE_ROOT??path.resolve('.');
const load=file=>import(pathToFileURL(path.join(packageRoot,'dist',file)).href);
const {openController}=await load('controller/index.js'),{HostCommands}=await load('ui/host-commands.js'),{changeCommands}=await load('ui/change-commands.js'),{uiText}=await load('ui/i18n.js'),{planningFailurePresentation,providerFailurePresentation}=await load('ui/planning-failure-presentation.js');
const tables=['works','sources','requirements','change_state','change_versions','runs','budgets','obligations','effect_delegations','effect_operations','role_launches','role_outputs','check_runs'];
const ledger=c=>Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for(const locale of ['en','ko'])for(const mode of ['generic','planning-quota','implementer','reviewer'])test('cold '+locale+' '+mode+' terminal retains understandable planning failure across reopen',{timeout:30000},async t=>{
 const f=await managedWorld(t),tasks=[];
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>rows[0],show:async()=>{},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>{},launch(_cid,task){tasks.push(task);void task.catch(()=>{});}}}));
 await commands.execute('/change start Controlled cold failure presentation',f.cid);
 const initial=await tasks[0],seed=mode==='generic'?seedPlanningFailure(f.c,initial.workId):mode==='planning-quota'?seedPlanningQuota(f.c,initial.workId):seedNormalQuota(f.c,initial.workId,mode),current=f.c.inspectChange(seed.workId),expected=providerFailurePresentation(current.providerFailure?.usageLimit,seed.workId,locale)??planningFailurePresentation(current.planningFailure,seed.workId,locale);
 const cv=f.c.inspectConversation(f.cid);f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:cv.generation,expectedRevision:0,replyLanguage:locale});
 const draft='KEEP exact 한국어 draft';f.c.setDraft({conversationId:f.cid,expectedRevision:f.c.inspectConversation(f.cid).draft.revision,text:draft});
 const before=ledger(f.c);await f.c.close();
 const physical=[];
 for(const boot of [0,1]){
  const file=path.join(f.root,'planning-'+locale+'-'+boot+'.json'),output=file+'.terminal';
  const steps=[
   {wait:expected.summary,assertDraft:draft,send:'\x07r'},
   {wait:expected.title,send:'\x1b'},
   {wait:uiText(locale,'result.nextTitle'),send:uiText(locale,'result.recovery')+'\r'},
   {wait:'Work recovery · #',assertDraft:draft,send:'Review managed change\r'},
   {wait:expected.title,send:'\x1b'},
   {wait:'Work recovery · #',send:uiText(locale,'result.view')+'\r'},
   {wait:expected.title,send:'\x1b'},
   {wait:'Work recovery · #',send:'\x1b'},
   {wait:draft,assertDraft:draft,send:'\x07q'},
  ];
  await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',process.env.GITJIG_UI_NO_EXECUTION_GUARD??fileURLToPath(new URL('./planning-failure-no-execution.mjs',import.meta.url)),process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:f.root,env:{HOME:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:10,gracefulShutdownSeconds:3,noForceKill:true,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
  const pending=execute('/usr/bin/python3',[process.env.GITJIG_UI_PTY_DRIVER??fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:15000,maxBuffer:2**20});
  const pid=pending.child.pid,result=JSON.parse((await pending).stdout),progress=JSON.parse(await fs.readFile(output+'.progress.json'));
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(progress.forceKilled,false);
  for(const operand of [pid,progress.childPid,-progress.childPid]){assert.throws(()=>process.kill(operand,0),{code:'ESRCH'});physical.push(operand);}
  const c=await openController({installationHome:f.home});
  try{assert.deepEqual(ledger(c),before);assert.equal(c.inspectConversation(f.cid).draft.text,draft);assert.equal((c.inspectChangeResult(seed.workId).planningFailure??c.inspectChangeResult(seed.workId).providerFailure).launchId,seed.launch);}
  finally{await c.close();}
 }
 await fs.writeFile(path.join(f.root,'planning-failure-terminal-proof.json'),JSON.stringify({locale,workId:seed.workId,physical,boots:2,ledgerPreserved:true,limits:'Controlled retained failure; actual public cold UI inspection only. No model/engine/retry or accepted task evidence.'}));
 if(process.env.GITJIG_RETAIN_PLANNING_FAILURE_UI!=='1')f.pass();
});

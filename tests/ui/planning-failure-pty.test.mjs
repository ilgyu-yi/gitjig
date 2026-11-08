/** Cold original terminal over a controlled owner entry and explicitly seeded failure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,stripVTControlCharacters} from 'node:util';
import {managedWorld} from './managed-change-fixture.mjs';
import {seedEarlierFindings,seedPlanningFailure,seedPlanningQuota,seedNormalQuota,seedLocalRoleRequestLimit,seedPlanningToolMismatch} from '../controller/planning-failure-fixture.mjs';
const execute=promisify(execFile),packageRoot=process.env.GITJIG_TEST_PACKAGE_ROOT??path.resolve('.');
const load=file=>import(pathToFileURL(path.join(packageRoot,'dist',file)).href);
const {openController}=await load('controller/index.js'),{HostCommands}=await load('ui/host-commands.js'),{changeCommands}=await load('ui/change-commands.js'),{uiText}=await load('ui/i18n.js'),{producerFailurePresentation}=await load('ui/planning-failure-presentation.js');
const tables=['works','sources','requirements','change_state','change_versions','runs','budgets','obligations','finding_occurrences','effect_delegations','effect_operations','role_launches','role_outputs','check_runs'];
const ledger=c=>Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
const failures={
 generic:seedPlanningFailure,
 'planning-quota':seedPlanningQuota,
 'local-request-limit':(c,work)=>seedLocalRoleRequestLimit(c,work,'adjudicator'),
 'tool-mismatch':seedPlanningToolMismatch,
 implementer:(c,work)=>seedNormalQuota(c,work,'implementer'),
 reviewer:(c,work)=>seedNormalQuota(c,work,'reviewer'),
};
for(const locale of ['en','ko'])for(const [mode,seedFailure] of Object.entries(failures))test('cold '+locale+' '+mode+' terminal retains understandable planning failure across reopen',{timeout:30000},async t=>{
 const f=await managedWorld(t),tasks=[];
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,choose:async(_title,rows)=>rows.find(row=>row===uiText('en','change.startAccept')),show:async(_title,_text,primary)=>{await primary?.run();},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>{},launch(_cid,task){tasks.push(task);void task.catch(()=>{});}}}));
 await commands.execute('/change start Controlled cold failure presentation',f.cid);
 const {workId}=await tasks[0];
 const quota=mode==='planning-quota';
 if(quota)seedEarlierFindings(f.c,workId);
 const seed=seedFailure(f.c,workId);
 const expected=producerFailurePresentation(f.c.inspectChange(seed.workId),locale);
 if(mode==='tool-mismatch')assert.ok(expected.summary.includes(uiText(locale,'planningFailure.toolInvocationMismatch')));
 if(mode==='local-request-limit')assert.ok(expected.summary.startsWith(uiText(locale,'task.role.planningAdjudication')+' · '));
 const cv=f.c.inspectConversation(f.cid);f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:cv.generation,expectedRevision:0,replyLanguage:locale});
 const draft='KEEP exact 한국어 draft';f.c.setDraft({conversationId:f.cid,expectedRevision:f.c.inspectConversation(f.cid).draft.revision,text:draft});
 const before=ledger(f.c);await f.c.close();
 const physical=[];
 const workGuidance=uiText(locale,'workRecovery.readResult',{action:uiText(locale,'result.view')});
 for(const boot of [0,1]){
  const file=path.join(f.root,'planning-'+locale+'-'+boot+'.json'),output=file+'.terminal';
  const steps=[
   {wait:expected.summary,assertDraft:draft,send:'\x07r'},
   {wait:uiText(locale,'result.recovery'),send:'\r'},
   {wait:workGuidance,assertDraft:draft,send:uiText(locale,'workRecovery.inspectRoute',{id:seed.workId})+'\r'},
   {wait:expected.title,send:'\x1b'},
   {wait:uiText(locale,'workRecovery.title',{id:seed.workId,state:''}),send:uiText(locale,'result.view')+'\r'},
   {wait:expected.title,send:'\x1b'},
   {wait:uiText(locale,'workRecovery.title',{id:seed.workId,state:''}),send:boot===0?'\x1b':'\r'},
   {wait:uiText(locale,'result.recovery'),assertDraft:draft,send:'\x1b'},
   {wait:draft,assertDraft:draft,send:'\x07q'},
  ];
  await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',process.env.GITJIG_UI_NO_EXECUTION_GUARD??fileURLToPath(new URL('./planning-failure-no-execution.mjs',import.meta.url)),process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js'),'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:f.root,env:{HOME:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},...(['local-request-limit','tool-mismatch'].includes(mode)?{columns:80}:{}),steps,timeoutSeconds:10,gracefulShutdownSeconds:3,noForceKill:true,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
  const pending=execute('/usr/bin/python3',[process.env.GITJIG_UI_PTY_DRIVER??fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:15000,maxBuffer:2**20});
  const pid=pending.child.pid,result=JSON.parse((await pending).stdout),progress=JSON.parse(await fs.readFile(output+'.progress.json'));
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(progress.forceKilled,false);
  const bytes=await fs.readFile(output),offsets=progress.actionOutputOffsets;
  const firstWorkMenu=stripVTControlCharacters(bytes.subarray(offsets[1],offsets[2]).toString('utf8'));
  assert.ok(firstWorkMenu.includes(mode==='local-request-limit'?expected.summary:expected.title));
  assert.ok(firstWorkMenu.includes(workGuidance));
  if(quota)assert.ok((await fs.readFile(output,'utf8')).includes(uiText(locale,'result.pendingFindings',{count:2})));
  for(const operand of [pid,progress.childPid,-progress.childPid]){assert.throws(()=>process.kill(operand,0),{code:'ESRCH'});physical.push(operand);}
  const c=await openController({installationHome:f.home});
  try{
   assert.deepEqual(ledger(c),before);
   assert.equal(c.inspectConversation(f.cid).draft.text,draft);
   const result=c.inspectChangeResult(seed.workId);
   assert.equal((result.roleRequestLimit??result.providerFailure??result.planningFailure).launchId,seed.launch);
   if(mode==='tool-mismatch')assert.equal(result.planningFailure.cause,'tool-invocation-mismatch');
   assert.equal(result.pendingFindings,quota?2:undefined);
  }
  finally{await c.close();}
 }
 await fs.writeFile(path.join(f.root,'planning-failure-terminal-proof.json'),JSON.stringify({locale,workId:seed.workId,physical,boots:2,ledgerPreserved:true,limits:'Controlled retained failure; actual public cold UI inspection only. No model/engine/retry or accepted task evidence.'}));
 if(process.env.GITJIG_RETAIN_PLANNING_FAILURE_UI!=='1')f.pass();
});

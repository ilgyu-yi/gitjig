import os from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';import {openController} from '../../dist/controller/index.js';
import {translator} from '../../dist/ui/i18n.js';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
const execute=promisify(execFile);
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
for (const locale of ['en', 'ko']) test(`owner activation without a runtime has an original recovery path in ${locale}`, {timeout: 16000}, async t => {
 const f=await registryWorld(t,'owner-activation-guidance'), c=f.c, id=f.works[0].workId;
 const {conversationId:cid,generation}=c.createConversation({projectId:'A'});
 const cancelled=locale==='ko';
 if (cancelled) await c.cancelWork({workId:id});
 const work=c.inspectWork(id);
 c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?",id);
 assert.equal(c.inspectChange(id).ownerActivation,'pending');
 const queries=['works','runs','sources','budgets','effect_delegations','conversation_inputs'].map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:c.store.all(sql).map(Object.values)};
 });
 await c.close();
 const resume='/change resume '+id, view='/work '+id;
 const heading=locale==='ko'?'소유자 권한 활성화 대기':'Owner activation pending';
 const entry=locale==='ko'?'원래 작업 활성화 방법':'How to activate the original work';
 const tr=translator(locale), workTitle=tr('workRecovery.title',{id,state:work.state});
 const file=path.join(f.root,'owner-activation.json'),output=file+'.terminal';
 const step=(wait,send,assertDraft)=>({wait,send,assertDraft,queries,expectedSelected:cid});
 const steps=[
  step('/ready',resume+'\r',''), step(heading,'\x1b',resume),
  step(resume,'\x15'+view+'\r',resume), step(workTitle,entry+'\r',''),
  step(heading,'\x1b',''), step(workTitle,'\x1b',''), step('/ready','\x07q',''),
 ];
 await fs.writeFile(file,JSON.stringify({
  command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,timeoutSeconds:9,noForceKill:true,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:240,rows:40,
 }));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12500,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 const commandText=stripTerminalSequences(terminal).replace(/\s+/gu,' ');
 assert.ok(commandText.includes('change activate --home'));
 assert.ok(commandText.includes("--work '"+id+"' --epoch "+work.epoch));
 assert.equal(commandText.includes('--resume-cancelled true'),cancelled);
 assert.ok(!terminal.includes(tr('workRecovery.resumeRoute',{id})));
 assert.ok(!terminal.includes(tr('change.resumeAccept')));
 const command=[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',
  process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','change','activate','--home',f.home,'--work',id,'--epoch',String(work.epoch)];
 const activate=async flags=>execute(command[0],[...command.slice(1),...flags],{timeout:5000,env:{...process.env,TMPDIR:f.root}});
 if (cancelled) await assert.rejects(activate([]),error=>error.stderr.includes('--resume-cancelled'));
 const {stdout}=await activate(cancelled?['--resume-cancelled','true']:[]);
 const activated=JSON.parse(stdout);
 assert.equal(activated.workId,id);
 assert.equal(activated.ownerActivation,'complete');
 assert.equal(activated.epoch,work.epoch+Number(cancelled));
 assert.deepEqual(activated.execution,{...work.allowance});
});

test('opened work and result commands leave no submitted draft after terminal shutdown',{timeout:18000},async t=>{
 const f=await registryWorld(t,'inspection-draft'),id=f.works[0].workId,cid=f.c.createConversation({projectId:'A'}).conversationId;
 await f.c.close();
 const terminal=async (name,command,marker,draft,closeAndReopen=false)=>{
  const file=path.join(f.root,name+'.json'),output=file+'.terminal';
  const steps=[
   {wait:'Model: not selected',assertDraft:'',send:command+'\r'},
   ...(closeAndReopen ? [
    {wait:marker,assertDraft:draft,send:'\x1b'},
    {wait:'AI input',assertDraft:'',send:command+'\r'},
   ] : []),
   {wait:marker,assertDraft:draft,terminate:true,send:''},
  ];
  await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
   env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},
   steps,timeoutSeconds:6,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
  const report=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:8000,maxBuffer:2**20})).stdout);
  assert.equal(report.exitCode,0);
  assert.equal(report.stages,steps.length);
  assert.equal(report.terminalRestored,true);
 };
 await terminal('work','/work '+id,'Work recovery · #'+id,'',true);
 await terminal('result','/result '+id,'Task result','');
 await terminal('change-result','/change result '+id,'Task result','');
 await terminal('change-inspect','/change inspect '+id,'Managed change · inspection only','',true);
 const unknown='/work unknown-original-work';
 await terminal('unknown',unknown,'Unknown original work',unknown);
});

for(const locale of ['en','ko'])test('technical inspection shows exact held work before raw evidence in '+locale,{timeout:12000},async t=>{
 const f=await registryWorld(t,'inspection-held'), id=f.works[0].workId;
 const {conversationId:cid,generation}=f.c.createConversation({projectId:'A'});
 f.c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 const draft='Separate work discovery draft · 한글';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 f.c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",id);
 const queries=['works','runs','budgets','conversation_inputs'].map(table=>({
  sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values),
 }));
 await f.c.close();
 const tr=translator(locale),file=path.join(f.root,'held-inspection.json'),output=file+'.terminal';
 const step=(wait,send)=>({wait,send,queries,assertDraft:draft,expectedSelected:cid});
 const steps=[
  step(draft,'\x07t'),step(tr('ready.title'),tr('ready.more')+'\r'),
  step(tr('ready.detailsTitle'),tr('ready.work')+'\r'),
  step(tr('workRecovery.projectRegistryTitle',{project:'A'}),id+'\r'),
  step(tr('workRecovery.title',{id,state:'UNKNOWN'}),tr('workRecovery.inspectRoute',{id})+'\r'),
  step(tr('change.inspectRecovery',{id}),'\x1b'),step(tr('workRecovery.title',{id,state:'UNKNOWN'}),'\x1b'),
  step(tr('workRecovery.projectRegistryTitle',{project:'A'}),'\r'),
  step(tr('workRecovery.title',{id,state:'UNKNOWN'}),'\x1b'),
  step(tr('workRecovery.projectRegistryTitle',{project:'A'}),'\x1b'),
  step(tr('ready.detailsTitle'),'\x1b'),step(tr('ready.title'),tr('ready.returnRequest')+'\r'),
  step(draft,'\x07q'),
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',
  process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,timeoutSeconds:8,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:140,rows:38}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11500,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const bytes=await fs.readFile(output),progress=JSON.parse(await fs.readFile(output+'.progress.json'));
 const inspection=bytes.subarray(progress.actionOutputOffsets[4],progress.actionOutputOffsets[5]).toString();
 assert.ok(inspection.includes(tr('workRecovery.settlementUnconfirmed')));
 assert.ok(inspection.includes(tr('change.inspectRecorded',{phase:'BASE_CAPTURED'})));
 assert.ok(!inspection.includes('/change resume '+id));
 assert.ok(!inspection.includes('/change cancel '+id));
});

for(const locale of ['en','ko'])test('unavailable managed assessment keeps original readiness and result reachable in '+locale,{timeout:14000},async t=>{
 const f=await registryWorld(t,'assessment-unavailable'),c=f.c,id=f.works[0].workId;
 const {conversationId:cid,generation}=c.createConversation({projectId:'A'});
 const tr=translator(locale),draft='Keep the unsent draft · 한글';
 c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',id,cid);
 c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",id);
 assert.equal(c.inspectWorkRecovery(id).recoveryHold.kind,'unavailable');
 assert.match(c.inspectChangeResult(id).blocked.join('\n'),/Required immutable version absent/);
 const queries=['works','runs','budgets','change_state','conversation_inputs'].map(table=>({
  sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values),
 }));
 await c.close();
 const file=path.join(f.root,'assessment.json'),output=file+'.terminal';
 const step=(wait,send)=>({wait,send,queries,assertDraft:draft,expectedSelected:cid});
 const workTitle=tr('workRecovery.title',{id,state:'ACTIVE'});
 const steps=[
  step(draft,'\x07t'),step(tr('ready.assessmentUnavailable'),'\r'),
  step(tr('workRecovery.guidanceUnavailable'),tr('result.view')+'\r'),
  step('Required immutable version absent','\x1b'),step(workTitle,'\x1b'),
  step(tr('ready.assessmentUnavailable'),tr('ready.returnRequest')+'\r'),step(draft,'\x07q'),
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',
  process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:144,rows:38}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12500,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(!terminal.includes(tr('workRecovery.inspectRoute',{id})));
 assert.ok(!terminal.includes(tr('workRecovery.resumeRoute',{id})));
});

for(const locale of ['en','ko'])test('direct commands keep unavailable managed assessment readable in '+locale,{timeout:15000},async t=>{
 const f=await registryWorld(t,'direct-assessment'),c=f.c,id=f.works[0].workId;
 const {conversationId:cid,generation}=c.createConversation({projectId:'A'});
 const tr=translator(locale);
 c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",id);
 const queries=['works','runs','budgets','sources','change_state','conversation_inputs'].map(table=>({
  sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values),
 }));
 await c.close();
 const file=path.join(f.root,'direct-assessment.json'),output=file+'.terminal';
 const step=(wait,send,assertDraft)=>({wait,send,queries,assertDraft,expectedSelected:cid});
 const [inspect,resume,replan]=['inspect','resume','replan'].map(action=>'/change '+action+' '+id);
 const diagnostic='Required immutable version absent';
 const steps=[
  step('/ready',inspect+'\r',''),step(diagnostic,'\x1b',''),
  step('/ready',resume+'\r',''),step(diagnostic,'\r',resume),
  step(tr('workRecovery.title',{id,state:'ACTIVE'}),'\x1b',resume),
  step(resume,'\x15'+replan+'\r',resume),
  step(diagnostic,'\x1b',replan),step(replan,'\x07q',replan),
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',
  process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:144,rows:38}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12500,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(terminal.includes(tr('result.title')));
 assert.ok(terminal.includes(tr('workRecovery.guidanceUnavailable')));
 assert.ok(!terminal.includes(tr('change.runtimeRequired')));
 assert.ok(!terminal.includes(tr('change.scopeReplanAccept')));
});

for(const locale of ['en','ko'])test('work registry retains its scope after an unreadable original in '+locale,{timeout:16000},async t=>{
 const f=await registryWorld(t,'work-unreadable'),{c}=f,tr=translator(locale);
 const broken=f.works[0].workId,healthy=f.works[1].workId,draft='Keep this independent draft · 한글';
 const {conversationId:cid,generation}=c.createConversation({projectId:'A'});
 c.setConversationLanguage({conversationId:cid,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const lineage=c.inspectWorkAllowance(broken).lineageRoot;
 assert.notEqual(c.inspectWorkAllowance(healthy).lineageRoot,lineage);
 c.store.run('DELETE FROM budgets WHERE lineage=? AND kind=?',lineage,'resolution');
 assert.throws(()=>c.inspectWorkRecovery(broken),/Original shared allowance is missing/);
 const readable=c.inspectWorkRecovery(healthy);
 assert.equal(readable.projectId,'B');
 const queries=Object.entries({...workLedger(c),conversation_inputs:c.store.all('SELECT * FROM conversation_inputs ORDER BY rowid')})
  .map(([table,rows])=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:rows.map(Object.values)}));
 await c.close();
 const selectedScope=tr('workRecovery.registryTitle'),healthyTitle=tr('workRecovery.title',{id:healthy,state:readable.state});
 const unavailable=tr('workRecovery.recordUnavailableTitle',{id:broken});
 const step=(wait,send)=>({wait,send,queries,assertDraft:draft,expectedSelected:cid});
 const diagnostic=step(unavailable,'\x1b'),details=step(readable.request,'\x1b');
 const steps=[
  step(draft,'\x07/'),
  step(tr('command.discovery.title'),'/work\r'),
  step(tr('workRecovery.projectRegistryTitle',{project:'A'}),tr('workRecovery.allProjects')+'\r'),
  step(selectedScope,broken+'\r'),diagnostic,
  step(selectedScope,healthy+'\r'),
  step(healthyTitle,tr('workRecovery.details')+'\r'),details,
  step(healthyTitle,tr('workRecovery.back')+'\r'),
  step(selectedScope,tr('workRecovery.closeRegistry')+'\r'),
  step(draft,'\x07q'),
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY;
 const file=path.join(f.root,'unreadable-work.json'),output=file+'.terminal';
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/readiness-no-execution.mjs',
  entry??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
   LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}},
  steps,timeoutSeconds:9,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:154,rows:40,noForceKill:true,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const bytes=await fs.readFile(output),{actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const before=stage=>{const index=steps.indexOf(stage);return bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');};
  const unavailableScreen=before(diagnostic);
  for(const label of [tr('workRecovery.title',{id:broken,state:'ACTIVE'}),tr('workRecovery.resolution'),tr('workRecovery.cancelRoute',{id:broken})])
   assert.ok(!unavailableScreen.includes(label),'Unavailable original must not offer '+label);
  assert.ok(before(details).includes(readable.request),'Healthy work must show its own retained request');
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-11000));throw error;}
});

test('actual source CLI finds original work from readiness and extends its budget without model, engine or goal turn changes',{timeout:22000},async t=>{
 const f=await registryWorld(t,'work-recovery'),id=f.works[0].workId,foreign=f.works[1].workId,cid=f.c.createConversation({projectId:'A'}).conversationId,goal=f.c.createGoal({conversationId:cid,objective:'Retain goal allowance',criteria:['Original work recovery stays separate'],turnLimit:3}),snapshot=f.c.inspectWorkAllowance(id),draft='Retain unrelated 한국어 draft';f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});await f.c.close();
 const file=path.join(f.root,'work-ui.json'),steps=[
  {wait:'Model: not selected',send:'\x07e'},
  {wait:'Error recovery · choose a next step',send:'Open goal recovery\r'},
  {wait:'Goal · Not started',send:'Return without action\r'},
  {wait:'Error recovery · choose a next step',send:'Back to conversation\r'},
  {wait:'INPUT',assertDraft:draft,send:'\x07t'},
  {wait:'Setup and next actions',send:'More settings and details\r'},
  {wait:'More settings and details · current and saved configuration',send:'Work recovery\r'},
  {wait:'Original work and allowances · project A',send:'All projects · first page\r'},
  {wait:'Original work and allowances · all projects',send:foreign+'\r'},
  {wait:'Work recovery · #'+foreign,send:'\x1b'},
  {wait:'Original work and allowances · all projects',assertDraft:draft,send:'Current project only · A\r'},
  {wait:'Original work and allowances · project A',send:id+'\r'},
  {wait:'Work recovery · #'+id,mutations:[{sql:'UPDATE works SET epoch=epoch+1 WHERE id=?',params:[id]}],send:'Extend shared execution\r'},
  {wait:'Work changed while this menu was open',assertDraft:draft,send:'Inspect retained\r'},
  {wait:'Original work · inspection only',send:'\x1b'},
  {wait:'Work recovery · #',send:'Review managed change\r'},
  {wait:'Managed change · inspection only',send:'\x1b'},
  {wait:'Work recovery · #',send:'Review resume\r'},
  {wait:'Managed work needs an active runtime',send:'\r'},
  {wait:'Work recovery · #'+id,assertDraft:draft,send:'Extend shared execution\r'},
  {wait:'Additional execution units',send:'3\r'},
  {wait:'Owner reason',send:'Owner confirms a bounded retry\r'},
  {wait:'Review shared allowance change',send:'\r'},
  {wait:'Extend execution',send:'Add 3 execution\r'},
  {wait:'Work recovery · #'+id,assertDraft:draft,queries:[{sql:'SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?',params:[snapshot.lineageRoot,'execution'],rows:[[snapshot.execution.limit+3,snapshot.execution.consumed,snapshot.execution.reserved]]},{sql:"SELECT json_extract(data,'$.turnLimit') FROM goals WHERE id=?",params:[goal.goalId],rows:[[3]]}],terminate:true,send:''},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import','./tests/ui/reopen-no-dispatch.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],env:{...process.env,HOME:f.root,GITJIG_HOME:f.home,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:16,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:20000,maxBuffer:2**20}).catch(async error=>{const retained=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-work-recovery-failed-'));await fs.cp(f.root,path.join(retained,'fixture'),{recursive:true});t.diagnostic('Retained terminal failure '+retained);throw error;})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const c=await openController({installationHome:f.home});try{assert.equal(c.inspectConversation(cid).draft.text,draft);assert.equal(c.inspectGoal(goal.goalId).startedAttempts,0);assert.equal(c.inspectGoal(goal.goalId).turnLimit,3);assert.equal(c.inspectWorkAllowance(id).execution.limit,snapshot.execution.limit+3);assert.equal(c.inspectWork(id).runs.length,1);assert.deepEqual(c.inspectWorkAllowance(id).resolution,snapshot.resolution);}finally{await c.close();}
});

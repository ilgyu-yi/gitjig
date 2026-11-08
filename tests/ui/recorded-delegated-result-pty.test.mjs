import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify,stripVTControlCharacters} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import {randomUUID} from 'node:crypto';
import {recordedResultWorld} from '../controller/recorded-delegated-results-fixture.mjs';
import {failedWaitWorld} from '../controller/original-failed-wait-fixture.mjs';
import {seedNormalQuota} from '../controller/planning-failure-fixture.mjs';
import {scripted} from '../controller/effect-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);

for (const locale of ['en', 'ko']) test(`cold parent reads the recorded provider usage limit in ${locale}`, {timeout:16000}, async t => {
 const f = await failedWaitWorld(t, {
  originalGovernedDispatch:true,
  prepareResult(c, child) {
   seedNormalQuota(c, child.workId, 'adjudicator', randomUUID());
   assert.ok(c.inspectChangeResult(child.workId).providerFailure);
  },
 });
 await f.settle();
 const {c, root, home, parent} = f;
 c.setConversationLanguage({conversationId:parent, expectedGeneration:c.inspectConversation(parent).generation, expectedRevision:0, replyLanguage:locale});
 const result = c.inspectRecordedDelegatedResults(parent).entries.find(entry=>entry.assignmentId===f.children[0].assignmentId);
 assert.ok(result, 'Original delegated result was published');
 assert.equal(result.phase, 'BLOCKED');
 const draft = 'Draft stays with the original request';
 c.setDraft({conversationId:parent, expectedRevision:c.inspectConversation(parent).draft.revision, text:draft});
 const queries = ['conversation_inputs','conversation_assignments','conversation_results','runs','budgets'].map(table => {
  const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
  return {sql, rows:c.store.all(sql).map(Object.values)};
 });
 const expectedInputs = c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n;
 await c.close();
 const pick = (wait, send) => ({wait, send, assertDraft:draft, expectedSelected:parent, queries});
 const picker = locale === 'ko' ? '기록된 위임 결과' : 'Recorded delegated results';
 const reset = locale === 'ko' ? '제공자가 알린 한도 초기화 시각' : 'Provider-reported reset';
 const steps = [pick(draft,'\x07r'), pick(picker,'Owned original failed-WAIT\r'), pick(reset,'\x1b'),
  pick(picker,'\x1b'), pick(draft,'\x07q')];
 const file = path.join(root,'provider-result-'+locale+'.json'), output = file+'.terminal';
 await fs.writeFile(file, JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',parent],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TZ:'Asia/Seoul'},
  steps,columns:80,rows:28,timeoutSeconds:7,noForceKill:true,expectedInputs,database:path.join(home,'state/controller.sqlite'),output}));
 const observed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
 const text=await fs.readFile(output,'utf8');
 assert.ok(text.includes('/work '+result.workId));
 assert.ok(text.includes(locale==='ko'?'위임 작업 ':'continue assignment'));
 assert.ok(text.includes(result.assignmentId));
 assert.ok(text.includes('GMT+09:00'));
 f.pass();
});
for(const locale of ['en','ko'])for(const [columns,rows] of [[40,18],[40,36],[80,18],[80,36]])test(`recorded delegated result remains distinct from parent prose in ${locale} at ${columns}x${rows}`,{timeout:15000},async t=>{
 const root=await temporaryDirectory('recorded-result-screen');let passed=false;
 t.after(async()=>{if(passed&&process.env.GITJIG_RETAIN_UI_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained recorded result screen '+root);});
 const config=path.join(root,'config.json'),ready=path.join(root,'ready.json'),observation=path.join(root,'observation'),output=path.join(root,'terminal'),guard=path.join(root,'guard.json'),resultFile=path.join(root,'result.json');
 const candidate=locale==='ko'?'격리된 변경본 보관됨':'Isolated candidate retained',checks=locale==='ko'?'공식 검사 기록: 0건':'Formal check records: 0';
 const outcome=locale==='ko'?'기록된 결과: 진행 막힘':'Recorded result: blocked';
 const openNotice=columns===40&&rows===18,noticeHint=locale==='ko'?'F5 알림 1개':'F5 Notices: 1';
 const steps=[{wait:candidate,send:openNotice?'\x1b[15~':'\x07q',frame:{contains:['gitjig',candidate,checks,outcome,'/work','Retained 한글 draft',
  ...(rows>=24?[uiText(locale,'delegated.keepDraftCommand',{key:'Ctrl+G'})]:[]),
  ...(openNotice?[noticeHint]:[]),...(rows>=24?[uiText(locale,'pane.modelResponse'),'No candidate was produced.']:[])],draft:'Retained 한글 draft',editorFocused:true}}];
 if(openNotice)steps.push({wait:locale==='ko'?'대화 알림':'Conversation notices',send:'\r'},
  {wait:locale==='ko'?'알림에 기록된 결과':'Recorded notification result',send:'\x1b'},
  {wait:locale==='ko'?'입력 ·':'INPUT ·',frame:{contains:[],draft:'',editorFocused:true},send:'\x07q'});
 await fs.writeFile(config,JSON.stringify({locale,columns,rows,ready,observation,output,receipt:resultFile,timeoutSeconds:9,gracefulShutdownSeconds:2,
  steps,openNotice,
  command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('tests/ui/recorded-delegated-result-child.mjs'),config],
  env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation,GITJIG_NAVIGATION_RECEIPT:guard}}));
 const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:12000,maxBuffer:2**20})).stdout);
 await fs.writeFile(path.join(root,'driver-receipt.json'),JSON.stringify(receipt,null,2));assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);assert.equal(receipt.alternateEntered,true);assert.equal(receipt.alternateExited,true);
 const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.error,null);
 const frame=JSON.parse(await fs.readFile(output+'.frame-0.json','utf8')),identity=JSON.parse(await fs.readFile(ready,'utf8'));assert.equal(frame.selected,identity.parent);assert.equal(frame.draft,'Retained 한글 draft');
 const rendered=frame.frame.map(stripVTControlCharacters).map(line=>line.trim());
 assert.ok(rendered.includes(columns>=80?'/result --delegated · /work '+identity.work:'/result --delegated · /work'),'Visible routes open the delegated result picker or exact work');
 assert.deepEqual(JSON.parse(await fs.readFile(guard,'utf8')),{process:0,network:0,model:0,run:0});const verified=JSON.parse(await fs.readFile(resultFile,'utf8'));assert.equal(verified.recordedUnchanged,true);assert.equal(verified.openedNotice,openNotice);passed=true;
});

for (const locale of ['en','ko']) test('cold parent restores the selected delegated result in '+locale, {timeout:20000}, async t => {
 const f=await recordedResultWorld(t,{resultDependency:false}), {c,parent,root,home}=f;
 const instructions='그룹 집계 추가\nRetain the existing grouping module';
 const model=scripted((_context,turn)=>turn?{text:'A second task was delegated.'}:{tool:{name:'conversation_assign',arguments:{
  projectId:'P',operation:'change',instructions,resultDependency:false,
 }}});
 model.provider='picker-'+randomUUID();model.definition.api='picker-api-'+randomUUID();
 await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Delegate the distinct group count task',mode:'idle'});
 await c.runConversation({conversationId:parent,model});await c.ordinaryCore.drain();
 const view=c.inspectRecordedDelegatedResults(parent);
 assert.equal(view.entries.length,2);assert.ok(view.entries.every(row=>row.phase==='BLOCKED'));
 const target=view.entries.find(row=>row.instructionPreview===instructions);assert.ok(target);
 const other=view.entries.find(row=>row!==target);assert.ok(other);
 assert.equal(view.entries[0].resultId,target.resultId);
 const otherState=c.inspectWorkRecovery(other.workId).state;
 const draft='Preserve this new draft';
 const generation=c.inspectConversation(parent).generation;
 c.setConversationLanguage({conversationId:parent,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
 c.setDraft({conversationId:parent,expectedRevision:c.inspectConversation(parent).draft.revision,text:draft});
 const tables=['conversation_inputs','conversation_results','conversation_assignments','runs','budgets'];
 const queries=tables.map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values)}));
 const originalInputs=c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n;
 await c.close();
 const file=path.join(root,'picker.json'),output=file+'.terminal';
 const pick=(wait,send)=>({wait,send,assertDraft:draft,queries,expectedSelected:parent});
 const list=uiText(locale,'delegated.resultsTitle');
 const title=uiText(locale,'delegated.resultTitle');
 const workTitle=uiText(locale,'workRecovery.title',{id:other.workId,state:otherState});
 const steps=[pick(draft,'\x07/'),pick(uiText(locale,'command.discovery.title').split(locale==='ko'?' · ':',')[0],'/result --delegated\r'),
  pick(list,'Owned original failed-WAIT\r'),pick(other.workId,'\r'),
  pick(workTitle,'\x1b'),pick(title,'\x1b'),
  pick(list,'\r'),pick(other.workId,'\x1b'),
  pick(list,'그룹 집계 추가\r'),pick(target.workId,'\x1b'),
  pick(list,'\x1b'),pick(draft,'\x07q')];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',parent],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,columns:80,rows:28,timeoutSeconds:10,noForceKill:true,expectedInputs:originalInputs,database:path.join(home,'state/controller.sqlite'),output}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(terminal.includes('Owned original failed-WAIT task'));
 assert.ok(terminal.includes('그룹 집계 추가'));
 assert.ok(terminal.includes(uiText(locale,'delegated.originalRequest',{request:JSON.stringify(instructions)})));
 f.pass();
});

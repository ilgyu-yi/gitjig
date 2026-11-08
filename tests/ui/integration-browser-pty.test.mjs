import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {integrationWorld} from '../controller/integration-registry-fixture.mjs';
import {translator} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const locale of ['en','ko'])test(locale+' actual no-execution terminal shows retained status and preserves source draft and ledger',{timeout:12000},async t=>{
 const f=await integrationWorld(t),op=await f.prepare(),other=await f.prepare(),tr=translator(locale);
 assert.deepEqual(f.c.listIntegrations().operations.map(record=>record.operationId),[other.operationId,op.operationId]);
 const requested=locale==='ko'?'윤년 날짜 검사':'Handle leap day';
 const otherRequest=locale==='ko'?'청구 금액 반올림':'Round invoice amount';
 for(const [original,request] of [[op,requested],[other,otherRequest]]){
  f.c.store.run('UPDATE sources SET raw=? WHERE id=(SELECT source FROM works WHERE id=?)',request,original.workId);
  const {entry}=f.c.inspectRetainedIntegration(original.operationId);
  assert.deepEqual([entry.state,entry.endpoint,entry.ref,entry.recordedPhase],['RETAINED',f.receiver,'refs/heads/main','PREPARED']);
 }
 const conversation=f.c.createConversation().conversationId,file=path.join(f.root,'integration-ui.json'),output=file+'.terminal';
 const tables=['effect_operations','effect_targets','effect_delegations','effect_receipts','works','runs','budgets','sources','obligations'];
 const checks=tables.map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:f.c.store.all(sql).map(Object.values)};
 });
 if(locale==='ko'){
  const view=f.c.inspectConversation(conversation),language=f.c.getConversationLanguage(conversation);
  f.c.setConversationLanguage({conversationId:conversation,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});
 }
 await f.c.close();
 const draft='KEEP 한국어';
 const preserved={queries:checks,assertDraft:draft,expectedSelected:conversation};
 const workLabel=tr('integration.field.work')+': ';
 const operationLabel=tr('integration.field.operation')+': ';
 const menu=tr('integration.menu',{status:tr('integration.phase.prepared'),id:op.operationId});
 const menuContext=[
  tr('integration.field.work')+' · '+op.workId,
  tr('integration.field.ref')+' · refs/heads/main',
  tr('integration.field.receiver')+' · '+f.receiver,
 ];
 const inspect={wait:menuContext.at(-1),...preserved,send:tr('integration.choice.inspect')+'\r'};
 const narrowList={wait:tr('integration.list'),...preserved,resize:{columns:160,rows:44},send:''};
 const steps=[
  {wait:locale==='ko'?'모델: 선택되지 않음':'Model: not selected',send:draft+'\x07t'},
  {wait:locale==='ko'?'설정과 다음 동작':'Setup and next actions',send:locale==='ko'?'추가 설정\r':'More settings\r'},
  {wait:tr('ready.detailsTitle'),send:locale==='ko'?'저장소 관리\r':'Repository management\r'},
  {wait:tr('repository.menu.title'),send:tr('repository.menu.integrations')+'\r'},
  narrowList,
  {wait:requested,...preserved,send:requested+'\r'},
  inspect,
  {wait:workLabel+op.workId,...preserved,send:'\x1b'},
  {wait:menu,...preserved,send:tr('integration.choice.back')+'\r'},
  {wait:tr('integration.list'),...preserved,send:'\r'},
  {wait:menu,...preserved,send:tr('integration.choice.back')+'\r'},
  {wait:tr('integration.list'),...preserved,send:tr('integration.choice.listBack')+'\r'},
  {wait:tr('repository.menu.title'),send:tr('repository.menu.close')+'\r'},
  {wait:tr('ready.detailsTitle'),send:locale==='ko'?'요청으로 돌아가기\r':'Return to request\r'},
  {wait:draft,...preserved,send:'\x15/quit\x1b\r'},
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';
 const guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/readiness-no-execution.mjs',entry,'conversation','ui','--conversation',conversation],env,steps,timeoutSeconds:6,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output,columns:80,rows:44,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  const terminalBytes=await fs.readFile(output),terminal=terminalBytes.toString('utf8');
  const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
  const narrowStep=steps.indexOf(narrowList);
  const narrowPage=terminalBytes.subarray(offsets[narrowStep-1],offsets[narrowStep]).toString('utf8');
  assert.ok(narrowPage.includes(op.operationId)&&narrowPage.includes(other.operationId),'Both original IDs must be visible in the narrow list');
  const inspectStep=steps.indexOf(inspect);
  const actionPicker=terminalBytes.subarray(offsets[inspectStep-1],offsets[inspectStep]).toString('utf8');
  for(const line of [menu,...menuContext]) assert.ok(actionPicker.includes(line),'Action picker must show '+line+' before opening details');
  assert.ok(terminal.includes(otherRequest));
  assert.ok(terminal.includes(operationLabel+op.operationId));
  assert.ok(!terminal.includes(workLabel+other.workId));
  f.pass();
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-8000));throw error;}
});

for (const locale of ['en','ko']) for (const becomesUnavailable of [true,false]) test(`${locale} held result keeps its original branch delivery history after ${becomesUnavailable?'unavailable details':'a changed phase'}`, {timeout:16000}, async t => {
 const f=await integrationWorld(t), original=await f.prepare(), unrelated=await f.prepare();
 const cid=f.c.createConversation().conversationId, tr=translator(locale), phase=locale==='ko'?'UNKNOWN':'PREPARED';
 if (phase==='UNKNOWN')
  f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",original.operationId);
 f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 assert.equal(f.c.inspectChangeResult(original.workId).reviewReady,false);
 const snapshot=()=>['effect_operations','effect_targets','effect_delegations','effect_receipts','works','runs','budgets','sources'].map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:f.c.store.all(sql).map(Object.values)};
 });
 const queries=snapshot(), changed=becomesUnavailable?'{':'REFUSED';
 const property=becomesUnavailable?'data':'phase';
 const {value}=f.c.store.one(`SELECT ${property} AS value FROM effect_operations WHERE id=?`,original.operationId);
 const update=`UPDATE effect_operations SET ${property}=? WHERE id=?`;
 const replace=value=>({sql:update,params:[value,original.operationId]});
 f.c.store.run(update,changed,original.operationId);
 const observation=f.c.inspectRetainedIntegration(original.operationId).entry;
 assert.equal(becomesUnavailable?observation.state:observation.recordedPhase,becomesUnavailable?'UNAVAILABLE':changed);
 const changedQueries=snapshot();
 f.c.store.run(update,value,original.operationId);
 await f.c.close();
 const file=path.join(f.root,'held-result.json'),output=file+'.terminal';
 const history=locale==='ko'?'이 작업의 이전 브랜치 반영 확인':'Review prior branch delivery for this work';
 const list=locale==='ko'?'이 작업의 브랜치 반영 기록':'Retained branch delivery for this work';
 const direct='/repo deliver '+original.workId+' history';
 const step=(wait,send,expected=queries)=>({wait,send,queries:expected,assertDraft:'',expectedSelected:cid});
 const status=locale==='ko'?'원래 통합 요청':'Original integration';
 const current=becomesUnavailable?queries:changedQueries;
 const changedTitle=locale==='ko'?'선택한 통합 기록이 변경되었습니다':'Selected integration record changed';
 const closeDiagnostic={...step(becomesUnavailable?tr('integration.unavailableTitle'):changedTitle,'\x1b',changedQueries),
  ...(becomesUnavailable?{mutations:[replace(value)]}:{})};
 const refused=tr('integration.phase.refused');
 const reselect=step(becomesUnavailable?list:refused,original.operationId+'\r',current);
 const steps=[
  step('/ready','/result '+original.workId+'\r'),
  step(tr('result.title'),'\r'),
  step(tr('result.nextTitle'),history+'\r'),
  {...step(list,original.operationId+'\r'),mutations:[replace(changed)]},
  closeDiagnostic,reselect,
  step(status+' · '+original.operationId,tr('integration.choice.inspect')+'\r',current),
  step(tr('integration.details'),'\x1b',current),
  step(status,'\x1b',current),
  step(list,'\x1b',current),
  step(tr('result.title'),'\x1b',current),
  ...(locale==='ko' && becomesUnavailable ? [
   {
    ...step('/ready',direct+'\r'),
    mutations:[{sql:"UPDATE change_state SET data='{' WHERE work=?",params:[original.workId]}],
   },
   {...step(list,original.operationId+'\r'),assertDraft:direct},
   {...step(status,tr('integration.choice.inspect')+'\r'),assertDraft:direct},
   {...step(tr('integration.details'),'\x1b'),assertDraft:direct,
    queries:[...queries,{sql:'SELECT data FROM change_state WHERE work=?',params:[original.workId],rows:[['{']]}]},
   {...step(status,'\x1b'),assertDraft:direct},
   {...step(list,'\x1b'),assertDraft:direct},
   {...step('/ready','\x07q'),assertDraft:direct},
  ] : [step('/ready','\x07q',current)]),
 ];
 await fs.writeFile(file,JSON.stringify({
  command:[process.execPath,...process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],'--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',f.home,'--conversation',cid],
  env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,database:path.join(f.home,'state/controller.sqlite'),output,timeoutSeconds:9,columns:160,rows:44,noForceKill:true,
 }));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12500,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const bytes=await fs.readFile(output),terminal=bytes.toString('utf8');
 const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
 const diagnostic=steps.indexOf(closeDiagnostic), next=steps.indexOf(reselect);
 assert.ok(bytes.subarray(offsets[diagnostic-1],offsets[diagnostic]).toString('utf8').includes(original.operationId));
 const refreshedPage=bytes.subarray(offsets[next-1],offsets[next]).toString('utf8');
 assert.ok(refreshedPage.includes(list));
 if(!becomesUnavailable) assert.ok(refreshedPage.includes(refused));
 assert.ok(!terminal.includes(unrelated.operationId));
 assert.ok(!terminal.includes(tr('result.receiverTitle')));
 for(const key of ['result.receiverOpen','integration.choice.prepareReview','integration.choice.sendReview','integration.choice.reauthorizeReview'])
  assert.ok(!terminal.includes(tr(key)),key);
 assert.equal(terminal.includes(tr('integration.choice.readReview')),becomesUnavailable && phase==='UNKNOWN');
 f.pass();
});

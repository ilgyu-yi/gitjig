import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify,stripVTControlCharacters} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {recordedResultWorld} from '../controller/recorded-delegated-results-fixture.mjs';
import {failedWaitWorld} from '../controller/original-failed-wait-fixture.mjs';
import {seedLocalRoleRequestLimit,seedNormalQuota} from '../controller/planning-failure-fixture.mjs';
import {scripted} from '../controller/effect-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
import {explicitWaitResultPrefix} from '../../dist/controller/consumed-wait.js';
const execute=promisify(execFile);

for(const {navigate,locale,missingResult,cleanupUnknown,cancelled,nested,unreadableLive,quota,dependencyDelivered,dependencyBlocked,prompted} of [
 {navigate:false,locale:'en'}, {navigate:true,locale:'en'},
 {navigate:false,locale:'en',missingResult:true}, {navigate:false,locale:'ko',missingResult:true},
 {navigate:false,locale:'en',missingResult:true,cleanupUnknown:true},
 {navigate:false,locale:'en',missingResult:true,cancelled:true}, {navigate:false,locale:'ko',missingResult:true,cancelled:true},
 {navigate:false,locale:'ko',missingResult:true,cancelled:true,nested:true},
 {navigate:true,locale:'en',missingResult:true,nested:true},
 {navigate:false,locale:'ko',missingResult:true,nested:true},
 {navigate:false,locale:'ko',missingResult:true,cleanupUnknown:true,nested:true},
 {navigate:true,locale:'en',missingResult:true,nested:true,unreadableLive:true},
 {navigate:false,locale:'ko',missingResult:true,nested:true,unreadableLive:true},
 {navigate:true,locale:'en',nested:true,quota:true},
 {navigate:false,locale:'ko',nested:true,quota:true},
 {navigate:true,locale:'en',dependencyDelivered:true},
 {navigate:false,locale:'ko',dependencyDelivered:true},
 {navigate:true,locale:'en',dependencyBlocked:'profile'},
 {navigate:false,locale:'ko',dependencyBlocked:'startup'},
 {navigate:true,locale:'en',dependencyBlocked:'profile',nested:true},
 {navigate:false,locale:'ko',dependencyBlocked:'startup',nested:true},
 {navigate:false,locale:'en',nested:true,quota:true,prompted:true},
 {navigate:false,locale:'ko',nested:true,quota:true,prompted:true},
])test(prompted?'owner prompts the originating parent about an exact nested stop in '+locale
 : dependencyBlocked?'parent continuation startup hold appears in '+locale+(nested?' through an intermediate wait':'')
 : dependencyDelivered?'parent records automatic handoff of failed delegated outcomes in '+locale
 : quota?'nested provider quota and depleted execution allowance in '+locale
 : unreadableLive?'unverified wait after controlled launch failure in '+locale
 : cancelled?'cancelled original without a result remains reviewable in '+locale+(nested?' through an intermediate wait':''):cleanupUnknown?'unconfirmed delegated cleanup takes precedence over the missing result in '+locale+(nested?' through an intermediate wait':'')
 : missingResult?'delegated failure without publication refreshes the parent in '+locale+(nested?' through an intermediate wait':'')
 : 'delegated local cap appears '+(navigate?'when returning to its parent':'while its parent is visible'),{timeout:17000},async t=>{
 const root=await temporaryDirectory('live-delegated-cap');
 let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained live cap fixture '+root);});
 const file=path.join(root,'config.json'),output=path.join(root,'terminal'),ready=path.join(root,'settled'),liveRelease=path.join(root,'release'),receipt=path.join(root,'receipt');
 const copy=(id,values)=>uiText(locale,id,...(values?[values]:[]));
 const pick=(wait,send)=>({wait,send});
 const nestedDiagnosis=prompted ? (locale==='ko' ? {
  ask:'중간 코디네이터가 맡긴 원래 작업은 왜 멈췄나요?',
  resume:'그 원래 작업을 같은 지시로 이어서 해 주세요.',
  explanation:'당시 모델 제공자가 사용 한도 초과를 알렸습니다.',
  direction:'원래 코디네이터에서 현재 재개 가능 여부를 확인하세요.',
 } : {
  ask:'Why did the original task delegated through the coordinator stop?',
  resume:'Please continue that original task under the same instructions.',
  explanation:'The provider reported a usage limit on the original task.',
  direction:'Review current continuation with the original coordinator.',
 }) : undefined;
 const fixtureRoot=nestedDiagnosis ? path.join(root,'prompt-fixture') : undefined;
 const unavailableActions=[pick(copy('result.back'),'\x1b[B\r'),pick(copy('delegated.waitUnverifiedRecheck'),'\x1b'),
  pick(copy('delegated.waitUnverifiedAction'),'\x1b')];
 const quotaNote=locale==='ko'?copy('planningFailure.quotaUnknownReset'):copy('planningFailure.quotaReset',{reset:''}).trim();
 const executionKind=copy('workRecovery.executionKind');
 const quotaConfirmation=copy('workRecovery.confirmAllowance',{kind:executionKind,additional:1});
 const quotaActions=[pick(quotaNote,'\r'),pick(copy('delegated.ownerActions'),'\x1b[B\r'),pick(copy('workRecovery.title',{id:'',state:''}).split('#')[0].trim(),
  copy('workRecovery.execution')+'\r'),
  pick(copy('workRecovery.additional',{kind:executionKind,available:0}),'1\r'),
  pick(copy('workRecovery.allowanceReason'),'Nested allowance review\r'),
  pick(copy('review.openConfirmation'),'\r'),pick(quotaConfirmation,'\x1b'),
  pick(copy('workRecovery.title',{id:'',state:''}).split('#')[0].trim(),'\x1b'),pick(copy('result.openActions'),'\x1b')];
 const delivery=copy('pane.waitResumedFailure');
 const blockedTitle=copy(nested?'delegated.nestedContinuationBlocked':'delegated.continuationBlocked');
 const blockedNext=copy(dependencyBlocked==='profile'?
  (nested?'delegated.nestedContinuationProfile':'delegated.continuationProfile'):'delegated.continuationStart').split('.')[0];
 const nestedSteps=[
  pick(copy('delegated.nestedContinuationReview'),'\r'), pick('Middle coordinator','\x1b[B\r'),
 ];
 const blockedActions=nested ? [
  ...nestedSteps, pick(blockedNext,'\r'),
  {...pick(copy('ready.title'),'\x1b'),atMiddle:true},
  {...pick(copy('delegated.inputReturnKey',{key:'Ctrl+G',confirm:'enter'}),'\x07'),atMiddle:true},
  {...pick(copy('delegated.inputReturn'),'\r'),atMiddle:true},
 ] : [
  pick(copy('delegated.continuationReview'),'\r'), pick(blockedNext,'\r'),
  pick(copy('delegated.parentReadiness'),dependencyBlocked==='profile'?'\x1b[B\x1b[B\r':'\x1b[B\r'),
  pick(copy(dependencyBlocked==='profile'?'delegated.resultsTitle':'ready.title'),'\x1b'),
 ];
 const steps=[
  ...(navigate?[{wait:'Preserved owner draft',send:'\x07c'},{wait:'Conversations',send:'Unrelated workspace\r'},
   {wait:'Unrelated workspace',releaseFile:liveRelease,send:''},
   {wait:'',waitFiles:[{path:ready,value:'settled'}],send:'\x07c'},{wait:'Conversations',send:'Original coordinator\r'}]
   :[{wait:'Preserved owner draft',releaseFile:liveRelease,send:''}]),
  ...(nestedDiagnosis ? [
   {wait:copy('planningFailure.quotaTitle'),waitFiles:[{path:ready,value:'settled'}],send:'\x15'+nestedDiagnosis.ask+'\r'},
   {...pick(nestedDiagnosis.explanation,nestedDiagnosis.resume+'\r'),waitIdle:true},
   {...pick(nestedDiagnosis.direction,'Preserved owner draft'),waitIdle:true},
   pick('Preserved owner draft','\x07q'),
  ] : dependencyBlocked?[{wait:blockedTitle,waitFiles:[{path:ready,value:'settled'}],send:'\x07'},...blockedActions]
   :dependencyDelivered?[{wait:'Received the original unavailable result',waitFiles:[{path:ready,value:'settled'}],send:'\x07q'}]:[
  {wait:unreadableLive ? copy('delegated.waitUnverified') : copy(missingResult?'delegated.resultListKey':'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'}),
   waitFiles:[{path:ready,value:'settled'}],send:'\x07'},
  pick(copy(missingResult?'delegated.resultsTitle':'command.recovery'),'\r'),
  ...(quota?quotaActions:unreadableLive?unavailableActions
   :missingResult?[pick(copy('result.back'),copy(cancelled?'task.awaitedCancelled':cleanupUnknown?'workRecovery.settlementUnconfirmed':'task.awaitedUnavailable')+'\r'),
   pick(cancelled?copy('delegated.ownerCancellation').split('.')[0]:copy('delegated.waitWithoutResult'),'\r'),
   pick(copy('workRecovery.title',{id:'',state:''}).split('#')[0].trim(),'\x1b'),pick(copy('result.back'),'\x1b')]:[pick(copy('notice.inspectOriginal'),'\x1b')]),
  ]),
  ...(dependencyDelivered || nestedDiagnosis ? [] : [pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07q')]),
 ];
 await fs.writeFile(file,JSON.stringify({locale,missingResult,cleanupUnknown,cancelled,nested,unreadableLive,quota,nestedDiagnosis,fixtureRoot,dependencyDelivered,dependencyBlocked,steps,output,ready,liveRelease,receipt,timeoutSeconds:9,columns:100,rows:30,
  ...(fixtureRoot ? {database:path.join(fixtureRoot,'home','state/controller.sqlite')} : {}),
  command:[process.execPath,...nodePreloads(),path.resolve('tests/ui/recorded-delegated-result-child.mjs'),file],
  env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
 const observed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
 assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
 const result=JSON.parse(await fs.readFile(receipt,'utf8'));
 assert.equal(result.role,missingResult || quota || nested && dependencyBlocked ? undefined : 'challenger');
 assert.equal(result.selected,result.parent);
 const cancelWorkTitle=cancelled ? copy('workRecovery.title',{id:result.workId,state:'CANCELLED'}) : undefined;
 const expectUnavailable = async (terminal, actions) => {
  const {actionOutputOffsets}=JSON.parse(await fs.readFile(terminal+'.progress.json','utf8'));
  const open=actions.findIndex(step=>step.wait===copy('result.back'));
  const frame=(await fs.readFile(terminal)).subarray(actionOutputOffsets[open-1],actionOutputOffsets[open+1]);
  const screen=stripVTControlCharacters(frame.toString('utf8'));
  assert.ok(screen.includes(copy('delegated.waitUnverified')));
  assert.ok(screen.includes(result.parent));
  assert.ok(!screen.includes(copy('delegated.launchFailed')));
  assert.ok(!screen.includes(result.assignmentId));
  assert.ok(!screen.includes(result.workId));
 };
 const expectOriginal = async terminal => {
  const screen=stripVTControlCharacters(await fs.readFile(terminal,'utf8'));
  if (dependencyDelivered) {
   assert.ok(screen.includes(delivery));
   assert.ok(screen.includes('Received the original unavailable result'));
   assert.ok(!screen.includes(explicitWaitResultPrefix));
  }
  if (dependencyBlocked) {
   assert.ok(screen.includes(blockedTitle));
   assert.ok(!screen.includes(copy('pane.waitResumedFailure')));
   assert.ok(!screen.includes('Private controlled startup refusal'));
   if (nested) assert.ok(screen.includes('Middle coordinator'));
  }
  if (cancelWorkTitle) assert.ok(screen.includes(cancelWorkTitle));
  if (missingResult && !cancelled) {
   assert.ok(screen.includes(copy('delegated.launchFailed')));
   assert.ok(screen.includes(copy('delegated.assignmentIdentity',{id:result.assignmentId})));
  }
  if (quota && !nestedDiagnosis) {
   const allowance=screen.indexOf(copy('workRecovery.allowanceNeeded',{action:copy('workRecovery.execution')}));
   assert.ok(allowance>=0 && allowance<screen.indexOf(quotaNote));
   assert.ok(screen.includes(copy('planningFailure.quotaRole',{role:copy('model.roleName.adjudicator')})));
   assert.ok(screen.includes(copy('delegated.assignmentIdentity',{id:result.assignmentId})));
  }
  if (nestedDiagnosis) {
   const reply=screen.lastIndexOf(nestedDiagnosis.direction);
   assert.ok(reply>=0);
   assert.ok(screen.slice(reply,reply+180).includes(result.diagnosedCoordinator));
  }
 };
 if (unreadableLive) await expectUnavailable(output,steps);
 else await expectOriginal(output);
 if((missingResult && !unreadableLive) || quota && !nestedDiagnosis || dependencyDelivered || dependencyBlocked){
  const cold=path.join(root,'reopen.json');
  const [first,...actions]=steps.slice(navigate?5:1);
  const staleCancellation = cancelled && locale==='en' ? [
   pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07'),pick(copy('delegated.resultsTitle'),'\r'),
   pick(copy('result.back'),copy('task.awaitedCancelled')+'\r'),
   {...pick(copy('delegated.ownerCancellation').split('.')[0],'\r'),mutations:[{
    sql:"UPDATE sources SET origin=json_set(origin,'$.requestedWork.toEpoch',0) WHERE id=(SELECT json_extract(data,'$.cancellationSource') FROM conversation_assignments WHERE id=?)",
    params:[result.assignmentId],
   }]},
   pick(copy('delegated.resultChanged').split('.')[0],'\x07q'),
  ] : [];
  const staleNestedWait = missingResult && nested && !cancelled && locale==='en' ? [
   pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07'),pick(copy('delegated.resultsTitle'),'\r'),
   {...pick(copy('result.back'),copy('task.awaitedUnavailable')+'\r'),mutations:[{
    sql:"UPDATE conversation_dependencies SET data=json_set(data,'$.source.runId','stale-before-selection') WHERE assignment=? AND state='PENDING'",
    params:[result.assignmentId],
   }]},
   pick(copy('delegated.resultChanged').split('.')[0],'\x07q'),
  ] : [];
  const staleQuota = quota && locale==='en' ? [
   pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07'),pick(copy('command.recovery'),'\r'),
   {...pick(quotaNote,'\r'),mutations:[{
    sql:"UPDATE conversation_notifications SET data='{}' WHERE json_extract(data,'$.resultId')=?",
    params:[result.resultId],
   }]},
   pick(copy('delegated.resultChanged').split('.')[0],'\x07q'),
  ] : [];
  const staleContinuation = dependencyBlocked==='profile' ? [
   pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07'),
   ...(nested?nestedSteps:[pick(copy('delegated.continuationReview'),'\r')]),
   {...pick(blockedNext,'\r'),mutations:[{
    sql:"UPDATE conversation_state SET data=json_set(data,'$.continuationFailure.proof','changed') WHERE conversation=?",
    params:[result.heldConversation],
   }]},
   pick(copy('delegated.resultChanged').split('.')[0],'\x07q'),
  ] : [];
  const stale=[...staleCancellation,...staleNestedWait,...staleQuota,...staleContinuation];
  let reopenedActions=stale.length ? [...actions.slice(0,-1),...stale] : actions;
  if (quota && locale==='ko') {
   const confirmation=actions.findIndex(step=>step.wait===quotaConfirmation);
   const updated=result.queries.map(query=>query.sql==='SELECT * FROM budgets ORDER BY rowid'
    ? {...query,rows:query.rows.map(row=>row[0]===result.quotaLineage && row[1]==='execution'
     ? [row[0],row[1],row[2]+1,...row.slice(3)] : row)} : query);
   updated.push({sql:"SELECT json_extract(origin,'$.workId'),json_extract(origin,'$.lineage'),json_extract(origin,'$.additional'),raw FROM sources WHERE json_extract(origin,'$.kind')='owner-budget-extension'",
    rows:[[result.workId,result.quotaLineage,1,'Nested allowance review']]});
   const footer=copy('footer.leave',{key:'Ctrl+G'});
   reopenedActions=[...actions.slice(0,confirmation),pick(quotaConfirmation,'\x1b[B\r'),
    ...[pick(copy('workRecovery.extended',{kind:executionKind}),'\x1b'),pick(footer,'\x07'),
     pick(copy('command.recovery'),'\r'),pick(quotaNote,'\x1b'),pick(footer,'\x07q')].map(step=>({...step,queries:updated}))];
  }
  const reopened=(dependencyDelivered ? [pick(delivery,'\x07q')] : [{wait:first.wait,send:first.send},...reopenedActions])
   .map(step=>({assertDraft:step.atMiddle?'Preserved middle draft':'Preserved owner draft',
    expectedSelected:step.atMiddle?result.heldConversation:result.parent,queries:result.queries,...step}));
  await fs.writeFile(cold,JSON.stringify({steps:reopened,output:cold+'.terminal',database:path.join(result.home,'state/controller.sqlite'),
   expectedInputs:result.expectedInputs,columns:100,rows:30,timeoutSeconds:9,
   command:[process.execPath,'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
    process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',result.home,'--conversation',result.parent],
   env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
  const coldResult=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',cold],{timeout:13000,maxBuffer:2**20})).stdout);
  assert.deepEqual([coldResult.exitCode,coldResult.stages,coldResult.terminalRestored],[0,reopened.length,true]);
  await expectOriginal(cold+'.terminal');
  if (missingResult && !nested && !cancelled && !cleanupUnknown && locale==='en') {
   const cfg=JSON.parse(await fs.readFile(cold,'utf8'));
   const db=new DatabaseSync(cfg.database);
   const source=db.prepare('SELECT s.id,s.origin FROM works w JOIN sources s ON s.id=w.source WHERE w.id=?').get(result.workId);
   const update='UPDATE sources SET origin=? WHERE id=?';
   db.prepare(update).run('{}',source.id);
   db.close();
   const output=cold+'.unverifiable-work';
   const steps=[
    pick(copy('delegated.resultListKey',{key:'Ctrl+G',confirm:'enter'}),'\x07\r'),
    pick(copy('delegated.resultsTitle'),copy('task.awaitedUnavailable')+'\r'),
    pick(copy('delegated.supportConversation',{id:result.parent}),'\x1b'),
    pick(copy('delegated.resultsTitle'),'\x1b'),
    pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07q'),
   ].map(step=>({...step,assertDraft:'Preserved owner draft',expectedSelected:result.parent,queries:result.queries}));
   const proof=cold+'.unverifiable-work.json';
   try {
    await fs.writeFile(proof,JSON.stringify({...cfg,steps,output,columns:124}));
    const seen=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',proof],{timeout:13000,maxBuffer:2**20})).stdout);
    assert.deepEqual([seen.exitCode,seen.stages,seen.terminalRestored],[0,steps.length,true]);
    const screen=stripVTControlCharacters(await fs.readFile(output,'utf8'));
    assert.ok(screen.includes(copy('delegated.assignmentIdentity',{id:result.assignmentId})));
    assert.ok(screen.includes(copy('delegated.waitWorkUnavailable').split('.')[0]));
   } finally {
    const repair=new DatabaseSync(cfg.database);
    try { repair.prepare(update).run(source.origin,source.id); } finally { repair.close(); }
   }
  }
  if (!dependencyDelivered && !dependencyBlocked && !quota && !cancelled && !cleanupUnknown && (nested || locale==='en')) {
   const cfg=JSON.parse(await fs.readFile(cold,'utf8'));
   if (!staleNestedWait.length) {
    const db=new DatabaseSync(cfg.database);
    try {
     const waiting=nested ? db.prepare('SELECT source_conversation FROM conversation_assignments WHERE id=?').get(result.assignmentId).source_conversation : result.parent;
     db.prepare("UPDATE conversation_state SET data=json_set(data,'$.waitHandles',json_array(null)) WHERE conversation=?").run(waiting);
    } finally { db.close(); }
   }
   const steps=[pick(copy('delegated.waitUnverified'),'\x07'),pick(copy('delegated.resultsTitle'),'\r'),
    ...unavailableActions,pick(copy('footer.leave',{key:'Ctrl+G'}),'\x07q')]
    .map(step=>({...step,assertDraft:'Preserved owner draft',expectedSelected:result.parent,queries:result.queries}));
   const unreadable=path.join(root,'unreadable.json');
   await fs.writeFile(unreadable,JSON.stringify({...cfg,steps,rows:18,columns:72,output:unreadable+'.terminal'}));
   const seen=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',unreadable],{timeout:13000,maxBuffer:2**20})).stdout);
   assert.deepEqual([seen.exitCode,seen.stages,seen.terminalRestored],[0,steps.length,true]);
   await expectUnavailable(unreadable+'.terminal',steps);
  }
 }
 passed=true;
});

for (const locale of ['en','ko']) test('cold delegated local-cap recommendation opens only the exact original recovery in '+locale, {timeout:16000}, async t => {
 const f=await failedWaitWorld(t,{originalGovernedDispatch:true,prepareResult(c,child){seedLocalRoleRequestLimit(c,child.workId,'challenger',randomUUID());}});
 await f.settle();
 const {c,parent,root,home}=f, before=c.inspectConversation(parent);
 const stop=c.inspectRecordedDelegatedResults(parent).entries.find(entry=>entry.assignmentId===f.children[0].assignmentId);
 assert.equal(stop?.roleRequestLimit?.requestLimit.limit,16);
 const draft='  Keep the unsent 한국어 request  ';
 c.setConversationLanguage({conversationId:parent,expectedGeneration:before.generation,expectedRevision:0,replyLanguage:locale});
 c.setDraft({conversationId:parent,expectedRevision:before.draft.revision,text:draft});
 const retained=['conversation_inputs','conversation_assignments','conversation_results','works','runs','budgets'];
 const queries=retained.map(table=>{
  const sql='SELECT * FROM '+table+' ORDER BY rowid';
  return {sql,rows:c.store.all(sql).map(Object.values)};
 });
 const expectedInputs=c.store.one('SELECT COUNT(*) n FROM conversation_inputs').n;
 const action=uiText(locale,'notice.inspectOriginal');
 const work=uiText(locale,'workRecovery.title',{id:stop.workId,state:c.inspectWorkRecovery(stop.workId).state});
 await c.close();
 const pick=(wait,send)=>({wait,send,assertDraft:draft,expectedSelected:parent,queries});
 const hint=uiText(locale,'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'});
 const editor=uiText(locale,'footer.leave',{key:'Ctrl+G'});
 const menu=uiText(locale,'command.recovery');
 const stale=locale==='en' ? [
  pick(editor,'\x07'),pick(menu,'\r'),
  {...pick(action,'\r'),mutations:[{sql:"UPDATE conversation_notifications SET data='{}' WHERE target=? AND json_extract(data,'$.resultId')=?",params:[parent,stop.resultId]}]},
  pick('Delegated result changed','\x07q'),
 ] : [pick(editor,'\x07q')];
 const steps=[pick(hint,'\x07'),pick(menu,'\x1b'),pick(editor,'\x07'),pick(menu,'\r'),pick(action,'\r'),
  pick(work,'\x1b'),pick(action,'\x1b'),...stale];
 const file=path.join(root,'local-cap-'+locale+'.json'), output=file+'.terminal';
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',parent,
  '--docker-binary','/usr/bin/false','--docker-context','controlled','--image','sha256:'+'0'.repeat(64)],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,columns:100,rows:30,timeoutSeconds:9,noForceKill:true,expectedInputs,database:path.join(home,'state/controller.sqlite'),output}));
 const observed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
 assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
 f.pass();
});

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
 const originalWork = c.inspectWorkRecovery(result.workId);
 c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",originalWork.lineageRoot);
 const queries = ['conversation_inputs','conversation_assignments','conversation_results','runs','budgets'].map(table => {
  const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
  return {sql, rows:c.store.all(sql).map(Object.values)};
 });
 const expectedInputs = c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n;
 const coldWorkState = c.inspectWorkRecovery(result.workId).state;
 await c.close();
 const pick = (wait, send) => ({wait, send, assertDraft:draft, expectedSelected:parent, queries});
 const reset = locale === 'ko' ? '제공자가 알린 한도 초기화 시각' : 'Provider-reported reset';
 const hint = uiText(locale,'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'});
 const work = uiText(locale,'workRecovery.title',{id:result.workId,state:coldWorkState});
 const kind=uiText(locale,'workRecovery.executionKind');
 const steps = [pick(hint,'\x07'), pick(uiText(locale,'command.recovery'),'\r'), pick(reset,'\r'),
  pick(work,uiText(locale,'workRecovery.execution')+'\r'),
  pick(uiText(locale,'workRecovery.additional',{kind,available:0}),'1\r'),
  pick(uiText(locale,'workRecovery.allowanceReason'),'Controlled owner review\r'),
  pick(uiText(locale,'review.openConfirmation'),'\r'),
  pick(uiText(locale,'workRecovery.confirmAllowance',{kind,additional:1}),'\r'),
  pick(work,'\x1b'), pick(uiText(locale,'notice.inspectOriginal'),'\x1b'),
  pick(uiText(locale,'footer.leave',{key:'Ctrl+G'}),'\x07q')];
 const file = path.join(root,'provider-result-'+locale+'.json'), output = file+'.terminal';
 await fs.writeFile(file, JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',parent],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',TZ:'Asia/Seoul'},
  steps,columns:80,rows:28,timeoutSeconds:7,noForceKill:true,expectedInputs,database:path.join(home,'state/controller.sqlite'),output}));
 const observed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
 const text=await fs.readFile(output,'utf8');
 const allowance = uiText(locale,'workRecovery.allowanceNeeded',{action:uiText(locale,'workRecovery.execution')});
 assert.ok(text.includes(allowance), 'The current original allowance is shown in the parent');
 assert.ok(text.indexOf(allowance)<text.indexOf(reset), 'The current hold precedes the recorded quota reset');
 assert.ok(text.includes('/work '+result.workId));
 assert.ok(text.includes(uiText(locale,'planningFailure.quotaTitle')));
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
 const recovery=uiText(locale,'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'});
 const steps=[{wait:candidate,send:openNotice?'\x1b[15~':'\x07q',frame:{contains:['gitjig',candidate,checks,outcome,recovery,'Retained 한글 draft',
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
 assert.ok(rendered.includes(recovery),'The parent offers a keyboard route to the exact original work');
 assert.deepEqual(JSON.parse(await fs.readFile(guard,'utf8')),{process:0,network:0,model:0,run:0});const verified=JSON.parse(await fs.readFile(resultFile,'utf8'));assert.equal(verified.recordedUnchanged,true);assert.equal(verified.openedNotice,openNotice);passed=true;
});

for (const locale of ['en','ko']) test('cold parent restores the selected delegated result in '+locale, {timeout:20000}, async t => {
 const f=await recordedResultWorld(t,{resultDependency:false}), {c,parent,root,home}=f;
 const instructions='그룹 집계 추가\nRetain the existing grouping module';
 const model=scripted((_context,turn)=>turn?{text:'A second task was delegated.'}:{tool:{name:'conversation_assign',arguments:{
  projectId:'P',operation:'change',instructions,resultDependency:false,
 }}});
 model.provider=f.model.provider;model.modelId=f.model.modelId;model.definition.api='picker-api-'+randomUUID();
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
 const resultsKey=uiText(locale,'delegated.resultListKey',{key:'Ctrl+G',confirm:'enter'});
 const steps=[pick(resultsKey,'\x07'),pick(uiText(locale,'command.title',{key:'Ctrl+G'}),'\r'),
  pick(list,'Owned original failed-WAIT\r'),pick(other.workId,'\r'),
  pick(workTitle,'\x1b'),pick(title,'\x1b'),
  pick(list,'\r'),pick(other.workId,'\x1b'),
  pick(list,'그룹 집계 추가\r'),pick(target.workId,'\x1b'),
  pick(list,'\x1b'),pick(draft,'\x07q')];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),
  process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',parent,
  '--docker-binary','/usr/bin/false','--docker-context','controlled','--image','sha256:'+'0'.repeat(64)],
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

for (const [locale,kind] of [['en','runtime'],['ko','runtime'],['en','cancel'],['en','account'],['ko','account'],['en','stale'],['en','stale-editor']]) test(
    `delegated ${kind} setup returns to the same original result in ${locale}`, {timeout:20000}, async t => {
    const runtime = {dockerBinary:'/usr/bin/false',dockerContext:'owned-setup-context',image:'sha256:'+'0'.repeat(64)};
    const provider = 'owned-original-provider';
    const root = await temporaryDirectory('delegated-setup');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained delegated setup '+root);
    });
    const draft = 'Keep delegated setup 한국어 draft';
    const receipt = path.join(root,'receipt.json'), config=path.join(root,'setup.json');
    const child=path.resolve('tests/ui/delegated-setup-child.mjs');
    const env={HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await fs.writeFile(config,JSON.stringify({root,locale,kind,runtime,provider,receipt,draft}));
    await execute(process.execPath,[child,config,'prepare'],{env,timeout:7000});
    const {parent,home,stop,stable,inputs,blocker}=JSON.parse(await fs.readFile(receipt,'utf8'));
    const copy=(id,values)=>uiText(locale,id,...values?[values]:[]);
    const pick=(wait,send)=>({wait,send,queries:stable,assertDraft:draft,expectedSelected:parent,expectedInputs:inputs});
    const file=path.join(root,'delegated-setup.json'), output=file+'.terminal';
    const review=copy('delegated.resultTitle'), actions=copy('delegated.ownerActions');
    const open=copy('delegated.openRuntime');
    const backKey={key:'Ctrl+G',confirm:'enter'};
    const atBlocker=(wait,send,assertDraft='')=>({...pick(wait,send),expectedSelected:blocker,assertDraft});
    const clearedQueries=kind==='account' ? [
        ...stable.filter(query=>!query.sql.includes('conversation_inputs')),
        {sql:'SELECT state FROM conversation_inputs WHERE conversation=?',params:[blocker],rows:[['CONFLICTED']]},
        {sql:'SELECT * FROM conversation_inputs WHERE conversation<>? ORDER BY rowid',params:[blocker],
            rows:stable.find(query=>query.sql.includes('conversation_inputs')).rows.filter(row=>row[1]!==blocker)},
    ] : stable;
    const cleared=(step)=>({...step,queries:clearedQueries});
    const revokePublication = {sql:"UPDATE conversation_notifications SET data='{}' WHERE target=? AND json_extract(data,'$.resultId')=?",
        params:[parent,stop.resultId]};
    const steps=[
        pick(copy('delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'}),'\x07\r'),
        ...(kind==='account' ? [
            pick(copy('delegated.accountSetupHeld').split('.')[0],'\r'),
            pick(actions,copy('delegated.openAccountBlocker')+'\r'),
            atBlocker(uiText('en','delegated.inputReturnKey',backKey),'/inputs\x1b\r'),
            atBlocker(uiText('en','input.recoveryList'),'\r','/inputs'),
            atBlocker(uiText('en','input.recoveryOpenActions'),'\r','/inputs'),
            atBlocker(uiText('en','input.recoveryWithdraw'),uiText('en','input.recoveryWithdraw')+'\r','/inputs'),
            cleared(atBlocker(uiText('en','input.recoveryWithdrawn').split('.')[0],'\x07')),
            cleared(atBlocker(uiText('en','delegated.inputReturn'),'\r')),
            cleared(pick(copy('delegated.recoveryKey',backKey),'\x07\r')),
            cleared(pick(review,'\x1b')),
            cleared(pick(draft,'\x07q')),
        ] : kind==='stale' ? [
            pick(copy('result.openActions'),'\r'),
            {...pick(actions,open+'\r'),mutations:[revokePublication]},
            {...pick(copy('delegated.resultChanged'),'\x07q'),queries:undefined},
        ] : kind==='stale-editor' ? [
            pick(copy('result.openActions'),'\r'),
            pick(actions,open+'\r'),
            {...pick(copy('runtime.title'),copy('runtime.review')+'\r'),mutations:[revokePublication]},
            pick(copy('delegated.resultChanged'),'\x07q'),
        ] : [
            pick(copy('result.openActions'),'\r'),
            pick(actions,open+'\r'),
            ...(kind==='cancel' ? [
                pick(copy('runtime.title'),'\x1b'),
                pick(copy('result.openActions'),'\x1b'),
            ] : [
                pick(copy('runtime.title'),copy('runtime.review')+'\r'),
                pick(copy('runtime.reviewTitle'),'\r'),
                pick(copy('runtime.saveTitle'),copy('runtime.save')+'\r'),
                pick(copy('notice.inspectOriginal'),'\x1b'),
            ]),
            pick(draft,'\x07q'),
        ]),
    ];
    await fs.writeFile(file,JSON.stringify({steps,output,database:path.join(home,'state/controller.sqlite'),columns:126,rows:42,
        command:[process.execPath,child,config],env,noForceKill:true,timeoutSeconds:9}));
    const observed=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
    assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
    if (kind==='account') {
        const transcript = await fs.readFile(output,'utf8');
        assert.ok(transcript.includes(provider));
        assert.ok(transcript.includes(blocker));
        assert.ok(transcript.includes('/inputs'));
        assert.ok(!transcript.includes(copy('account.method',{provider})));
    }
    passed = true;
});

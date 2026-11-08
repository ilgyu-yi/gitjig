/** Owner entry is real; retained producer failure records are explicit synthetic premises. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {managedWorld} from './managed-change-fixture.mjs';
import {seedPlanningFailure,seedPlanningQuota,seedNormalQuota,seedLocalRoleRequestLimit,seedPlanningToolMismatch,normalQuotaStages} from '../controller/planning-failure-fixture.mjs';
import {workLedger} from '../controller/change-registry-fixture.mjs';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {changeResultText} from '../../dist/ui/change-result.js';
import {planningFailurePresentation,providerFailurePresentation,roleRequestLimitPresentation} from '../../dist/ui/planning-failure-presentation.js';
import {taskPresentation,managedChangeCompletionNotice} from '../../dist/ui/task-presentation.js';
import {uiText} from '../../dist/ui/i18n.js';

function failureCommands(f,locale,tasks,shown) {
 return new HostCommands(changeCommands({
  controller:f.c,isCurrent:()=>true,locale:()=>locale,
  choose:async(_title,rows)=>rows.find(row=>row===uiText(locale,'change.startAccept')),
  show:async(title,text,primary)=>{if(primary)await primary.run();else shown.push({title,text});},
  controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>{},launch(_cid,task){tasks.push(task);void task.catch(()=>{});}},
 }));
}


for(const locale of ['en','ko'])for(const role of ['planner','challenger','adjudicator'])test(locale+' owner can understand recorded '+role+' failure without dispatch',async t=>{
 const f=await managedWorld(t),tasks=[],shown=[];
 const draft='Preserve exact 한국어 draft';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 const commands=failureCommands(f,locale,tasks,shown);
 assert.equal(await commands.execute('/change start Controlled retained planning failure',f.cid),'started');
 const initial=await tasks[0],seed=seedPlanningFailure(f.c,initial.workId,role),current=f.c.inspectChange(seed.workId),activity=f.c.inspectChangeActivity(seed.workId),view=f.c.inspectConversation(f.cid),before=workLedger(f.c);
 const expected=planningFailurePresentation(current.planningFailure,seed.workId,locale);
 assert.ok(expected);assert.equal(view.workId,seed.workId);assert.equal(view.state,'IDLE');
 const presentation=taskPresentation({view,roster:[view],changeActivity:activity,locale});
 assert.equal(presentation.idleStatus,expected.summary);
 assert.equal(managedChangeCompletionNotice(current,current,activity,view,locale),expected.summary);
 const text=changeResultText(f.c.inspectChangeResult(seed.workId),locale);
 assert.ok(text.includes(expected.title));assert.ok(text.indexOf(expected.title)<text.indexOf(uiText(locale,'result.output')));
 assert.ok(text.includes('ControllerError:'));
 assert.ok(text.includes('/change inspect '+seed.workId));assert.ok(text.includes('/work '+seed.workId));assert.ok(text.includes('Role deadline exceeded'));
 await commands.execute('/change inspect '+seed.workId,f.cid);
 assert.equal(shown.at(-1).title,expected.title);assert.ok(shown.at(-1).text.includes(expected.details));
 assert.ok(shown.at(-1).text.indexOf(seed.workId)<shown.at(-1).text.indexOf(expected.details));
 assert.equal(tasks.length,1);assert.equal(f.calls.length,1);assert.equal(f.c.inspectConversation(f.cid).draft.text,draft);assert.deepEqual(workLedger(f.c),before);
 for(const state of ['UNKNOWN','RUNNING','SETTLING','QUEUED','WAITING']){
  assert.equal(managedChangeCompletionNotice(current,current,activity,{...view,state},locale),undefined);
  assert.doesNotMatch(taskPresentation({view:{...view,state},roster:[view],changeActivity:activity,locale}).navigatorSummary,new RegExp(expected.title));
 }
 for(const changed of [{...current,epoch:current.epoch+1},{...current,planningFailure:{role,launchId:'newer-launch'}}])assert.equal(managedChangeCompletionNotice(current,changed,activity,view,locale),undefined);
 assert.equal(managedChangeCompletionNotice(current,current,{...activity,recordedPlanningFailure:{role,launchId:'foreign-launch'}},view,locale),undefined);
 const criteria=f.c.changes.workflowCriteriaHold;f.c.changes.workflowCriteriaHold=()=> ({kind:'changed',reason:'Controlled current criteria hold'});
 try{const held=f.c.inspectChange(seed.workId);assert.equal(held.planningFailure,undefined);assert.equal(f.c.inspectChangeResult(seed.workId).planningFailure,undefined);assert.notEqual(managedChangeCompletionNotice(current,held,activity,view,locale),expected.summary);}
 finally{f.c.changes.workflowCriteriaHold=criteria;}
 if(role==='planner'){
  const originalWork=f.c.store.one('SELECT data FROM works WHERE id=?',seed.workId).data,workData=JSON.parse(originalWork);
  assert.equal(workData.ownerRootActivation.state,'COMPLETE');workData.ownerRootActivation.state='PENDING';
  f.c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify(workData),seed.workId);
  try{assert.equal(f.c.inspectChange(seed.workId).planningFailure,undefined);assert.equal(f.c.inspectChangeActivity(seed.workId).recordedPlanningFailure,undefined);}
  finally{f.c.store.run('UPDATE works SET data=? WHERE id=?',originalWork,seed.workId);}
  const original=f.c.store.one('SELECT data FROM change_state WHERE work=?',seed.workId).data,changed=JSON.parse(original);
  changed.blocked.unshift('ModelContextBudgetError: MODEL_CONTEXT_LIMIT: Controlled original host budget refusal');
  f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify(changed),seed.workId);
  try{const held=f.c.inspectChange(seed.workId);assert.equal(held.planningFailure,undefined);assert.equal(held.modelContextFailure,'MODEL_CONTEXT_LIMIT');}
  finally{f.c.store.run('UPDATE change_state SET data=? WHERE work=?',original,seed.workId);}
 }
 assert.deepEqual(workLedger(f.c),before);
 f.pass();
});

test('unknown planning attribution stays generic and makes no zero-cost promise',()=>{
 for(const locale of ['en','ko']){
  assert.equal(planningFailurePresentation(undefined,'W',locale),undefined);
  assert.equal(planningFailurePresentation({role:'reviewer',launchId:'unrelated'},'W',locale),undefined);
  const p=planningFailurePresentation({role:'planner',launchId:'L'},'W',locale);
  assert.doesNotMatch(p.details,/no (charge|request)|free|무료|과금되지/i);
 }
});

test('tool mismatch needs the original issue and matching native checkpoint', async t=>{
 const f=await managedWorld(t),tasks=[];
 await failureCommands(f,'en',tasks,[]).execute('/change start Controlled native tool mismatch',f.cid);
 const {workId}=await tasks[0],seed=seedPlanningToolMismatch(f.c,workId),store=f.c.store;
 const read=()=>f.c.inspectChange(workId).planningFailure;
 const current=f.c.inspectChange(workId),activity=f.c.inspectChangeActivity(workId),view=f.c.inspectConversation(f.cid);
 assert.equal(current.planningFailure.cause,'tool-invocation-mismatch');
 const generic={role:'adjudicator',launchId:seed.launch};
 assert.equal(managedChangeCompletionNotice(current,current,{...activity,recordedPlanningFailure:generic},view,'en'),undefined);
 const run=store.one('SELECT data FROM runs WHERE id=?',seed.run);
 for(const [key,value] of [['$.nativeCheckpoint.sessionId','foreign-session'],['$.cleanup','unknown']]){
  store.run('UPDATE runs SET data=json_set(data,?,?) WHERE id=?',key,value,seed.run);
  assert.deepEqual(read(),generic);
  store.run('UPDATE runs SET data=? WHERE id=?',run.data,seed.run);
 }
 const quoted='PROVIDER:Model mentioned BRIDGE_HOST_TOOL_INVOCATION_MISMATCH';
 const issues=JSON.stringify([quoted]);
 store.run("UPDATE role_outputs SET data=json_set(data,'$.issues',json(?)) WHERE id=?",issues,seed.output);
 store.run("UPDATE obligations SET data=json_set(data,'$.issues',json(?)) WHERE id=?",issues,'diagnostic-'+seed.launch);
 store.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['ControllerError: '+quoted]),workId);
 assert.deepEqual(read(),generic);
 f.pass();
});

for (const locale of ['en','ko']) test(locale+' inspection explains the same local request cap as the status and result',async t=>{
 const f=await managedWorld(t),tasks=[],shown=[];
 const commands=failureCommands(f,locale,tasks,shown);
 await commands.execute('/change start Controlled retained request limit',f.cid);
 const {workId}=await tasks[0],{launch,requestLimit}=seedLocalRoleRequestLimit(f.c,workId,'adjudicator');
 const current=f.c.inspectChange(workId),activity=f.c.inspectChangeActivity(workId),view=f.c.inspectConversation(f.cid),before=workLedger(f.c);
 assert.deepEqual(current.roleRequestLimit,{role:'adjudicator',roleStage:'planning-adjudication',launchId:launch,requestLimit});
 const expected=roleRequestLimitPresentation(current.roleRequestLimit,workId,locale);
 const planning=uiText(locale,'task.role.planningAdjudication'), review=uiText(locale,'task.role.adjudicator');
 assert.ok(expected.summary.startsWith(planning+' · '));
 assert.ok(expected.details.includes(planning));
 for(const stage of [undefined,'unsupported']){
  const generic=roleRequestLimitPresentation({...current.roleRequestLimit,roleStage:stage},workId,locale);
  assert.ok(generic.summary.startsWith(review+' · '));
 }
 assert.equal(taskPresentation({view,roster:[view],changeActivity:activity,locale}).idleStatus,expected.summary);
 assert.equal(managedChangeCompletionNotice(current,current,activity,view,locale),expected.summary);
 assert.ok(changeResultText(f.c.inspectChangeResult(workId),locale).includes(expected.details));
 await commands.execute('/change inspect '+workId,f.cid);
 assert.equal(shown.at(-1).title,expected.title);
 assert.ok(shown.at(-1).text.includes(expected.details));
 assert.equal(tasks.length,1);
 assert.deepEqual(workLedger(f.c),before);
 f.pass();
});


for(const locale of ['en','ko'])test(locale+' quota failure explains waiting across original owner surfaces',async t=>{
 const f=await managedWorld(t),tasks=[],shown=[];
 const commands=failureCommands(f,locale,tasks,shown);
 await commands.execute('/change start Controlled provider quota display',f.cid);
 const initial=await tasks[0],seed=seedPlanningQuota(f.c,initial.workId),current=f.c.inspectChange(seed.workId),activity=f.c.inspectChangeActivity(seed.workId),view=f.c.inspectConversation(f.cid),before=workLedger(f.c);
 const expected=planningFailurePresentation(current.planningFailure,seed.workId,locale),text=changeResultText(f.c.inspectChangeResult(seed.workId),locale);
 assert.match(expected.title,locale==='ko'?/사용 한도/:/usage limit/);
 assert.match(expected.details,locale==='ko'?/기다린 뒤 계정/:/Wait and check your account/);
 assert.match(expected.details,/2026/);assert.match(expected.details,/GMT/);assert.match(expected.details,locale==='ko'?/보장되지/:/does not guarantee/);
 assert.match(text,/Original account limit rejection/);assert.ok(text.includes(expected.details));
 assert.equal(taskPresentation({view,roster:[view],changeActivity:activity,locale}).idleStatus,expected.summary);
 assert.equal(managedChangeCompletionNotice(current,current,activity,view,locale),expected.summary);
 for(const operand of ['prior','activity']){
  const different=structuredClone(current.planningFailure);different.providerFailure.resetsAt++;
  assert.equal(managedChangeCompletionNotice(operand==='prior'?{...current,planningFailure:different}:current,current,operand==='activity'?{...activity,recordedPlanningFailure:different}:activity,view,locale),undefined);
 }
 await commands.execute('/change inspect '+seed.workId,f.cid);assert.equal(shown.at(-1).title,expected.title);assert.ok(shown.at(-1).text.includes(expected.details));
 const unknown=structuredClone(current.planningFailure);delete unknown.providerFailure.resetsAt;
 assert.match(planningFailurePresentation(unknown,seed.workId,locale).details,locale==='ko'?/시각을 알리지 않았습니다/:/did not supply/);
 f.c.changes.workflowCriteriaHold=()=> ({kind:'changed',reason:'Controlled current criteria hold'});
 assert.equal(f.c.inspectChange(seed.workId).planningFailure,undefined);
 assert.equal(tasks.length,1);assert.equal(f.calls.length,1);assert.deepEqual(workLedger(f.c),before);f.pass();
});


for(const locale of ['en','ko'])for(const [role]of normalQuotaStages)test(locale+' normal '+role+' quota is understandable at original owner surfaces',async t=>{
 const f=await managedWorld(t),tasks=[],shown=[];
 const commands=failureCommands(f,locale,tasks,shown);
 await commands.execute('/change start Controlled normal quota display',f.cid);
 const initial=await tasks[0],seed=seedNormalQuota(f.c,initial.workId,role),current=f.c.inspectChange(seed.workId),activity=f.c.inspectChangeActivity(seed.workId),view=f.c.inspectConversation(f.cid),before=workLedger(f.c);
 const expected=providerFailurePresentation(current.providerFailure.usageLimit,seed.workId,locale),text=changeResultText(f.c.inspectChangeResult(seed.workId),locale);
 assert.equal(current.planningFailure,undefined);assert.match(expected.title,locale==='ko'?/사용 한도/:/usage limit/);assert.match(expected.details,locale==='ko'?/기다린 뒤 계정/:/Wait and check your account/);
 assert.doesNotMatch(expected.details,/planning stage|계획 단계/);assert.match(expected.details,/2026/);assert.match(expected.details,/GMT/);assert.ok(text.includes(expected.details));assert.match(text,/Original account limit rejection/);
 assert.equal(taskPresentation({view,roster:[view],changeActivity:activity,locale}).idleStatus,expected.summary);assert.equal(managedChangeCompletionNotice(current,current,activity,view,locale),expected.summary);
 for(const operand of ['prior','activity'])for(const key of ['launchId','role','reset']){
  const different=structuredClone(current.providerFailure);if(key==='reset')different.usageLimit.resetsAt++;else different[key]='foreign';
  assert.equal(managedChangeCompletionNotice(operand==='prior'?{...current,providerFailure:different}:current,current,operand==='activity'?{...activity,recordedProviderFailure:different}:activity,view,locale),undefined);
 }
 await commands.execute('/change inspect '+seed.workId,f.cid);assert.equal(shown.at(-1).title,expected.title);assert.ok(shown.at(-1).text.includes(expected.details));
 assert.equal(tasks.length,1);assert.equal(f.calls.length,1);assert.deepEqual(workLedger(f.c),before);
 const originalWork=f.c.store.one('SELECT data FROM works WHERE id=?',seed.workId).data,workData=JSON.parse(originalWork);workData.ownerRootActivation.state='PENDING';
 f.c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify(workData),seed.workId);
 assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);assert.equal(f.c.inspectChangeActivity(seed.workId).recordedProviderFailure,undefined);
 f.c.store.run('UPDATE works SET data=? WHERE id=?',originalWork,seed.workId);assert.deepEqual(workLedger(f.c),before);f.pass();
});

import {changeResultText} from '../../dist/ui/change-result.js';
import {modelContextPresentation} from '../../dist/ui/model-context-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {managedWorld} from './managed-change-fixture.mjs';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {taskPresentation,managedChangeCompletionNotice} from '../../dist/ui/task-presentation.js';
import {workLedger} from '../controller/change-registry-fixture.mjs';
for(const locale of ['en','ko'])test('actual context refusal remains understandable in the idle '+locale+' owner pane',async t=>{
 const f=await managedWorld(t),tasks=[],shown=[];delete f.c.changes.drive; // Restore the real governed procedure, not its fixture stub.
 await f.accounts.configure({providers:{'managed-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED_MODEL_FIXTURE',models:[{id:'original',contextWindow:8192,maxTokens:1000},{id:'future'}]}}});
 let allocations=0;f.c.changes.h.acquireCapacity=async()=>{allocations++;throw Error('UNEXPECTED_CONTEXT_REFUSAL_ALLOCATION');};
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=>locale,choose:async(_title,rows)=>rows[0],show:async(title,text)=>{shown.push({title,text});},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice(){},activateSource:async()=>{},launch(_cid,task){tasks.push(task);void task.catch(()=>{});}}}));
 assert.equal(await commands.execute('/change start Preserve this original 한국어 request',f.cid),'started');assert.equal(tasks.length,1);
 const result=await tasks[0];assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(' '),/MODEL_CONTEXT_LIMIT/);assert.equal(allocations,0);assert.equal(result.execution.consumed,1);assert.equal(result.execution.reserved,0);
 const before=workLedger(f.c),view=f.c.inspectConversation(f.cid),activity=f.c.inspectChangeActivity(result.workId);
 assert.equal(view.workId,result.workId);
 const presentation=taskPresentation({view,roster:[view],changeActivity:activity,locale});
 assert.match(presentation.idleStatus,locale==='ko'?/모델.*한도/:/model.*context limit/i);
 assert.doesNotMatch(presentation.idleStatus,/MODEL_CONTEXT_LIMIT|BLOCKED|Stopped/);
 assert.equal(result.modelContextFailure,'MODEL_CONTEXT_LIMIT');assert.equal(activity.recordedModelContextFailure,'MODEL_CONTEXT_LIMIT');
 const selected=f.c.inspectChangeResult(result.workId);assert.equal(selected.modelContextFailure,'MODEL_CONTEXT_LIMIT');const text=changeResultText(selected,locale);assert.match(text,locale==='ko'?/출력에 필요한 여유/:/retaining response room/);assert.ok(text.includes('/work '+result.workId));assert.match(text,/MODEL_CONTEXT_LIMIT/,'Raw original diagnostics remain available separately');
 await commands.execute('/change inspect '+result.workId,f.cid);assert.equal(shown.length,1);assert.match(shown[0].title,locale==='ko'?/모델의 처리 한도/:/model.s context limit/);assert.ok(shown[0].text.includes('/work '+result.workId));assert.equal(tasks.length,1);
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(managedChangeCompletionNotice(result,result,activity,view,locale),presentation.idleStatus);
 for(const state of ['UNKNOWN','SETTLING','RUNNING','QUEUED','WAITING'])assert.equal(managedChangeCompletionNotice(result,result,activity,{...view,state},locale),undefined);
 for(const state of ['UNKNOWN','CANCELLED','INTERRUPTED'])assert.equal(managedChangeCompletionNotice(result,result,{...activity,state},view,locale),undefined);
 assert.equal(managedChangeCompletionNotice(result,{...result,phase:'PLANNING'},{...activity,recordedPhase:'PLANNING'},view,locale),undefined);
 assert.equal(managedChangeCompletionNotice(result,{...result,epoch:result.epoch+1},activity,view,locale),undefined);
 assert.equal(managedChangeCompletionNotice(result,result,activity,{...view,workId:'FOREIGN'},locale),undefined);
 assert.equal(managedChangeCompletionNotice(result,{...result,ownerActivation:'pending'},activity,view,locale),undefined);
 const criteria=f.c.changes.criteriaHoldReason;f.c.changes.criteriaHoldReason=()=> 'Controlled current criteria gate';
 try{const current=f.c.inspectChange(result.workId);assert.equal(current.modelContextFailure,undefined);assert.doesNotMatch(managedChangeCompletionNotice(result,current,activity,view,locale),locale==='ko'?/모델.*한도/:/model.*context limit/i);assert.equal(f.c.inspectChangeResult(result.workId).modelContextFailure,undefined);}finally{f.c.changes.criteriaHoldReason=criteria;}
 await commands.execute('/change cancel '+result.workId,f.cid);
 const cancelled=f.c.inspectChange(result.workId),cancelledView=f.c.inspectConversation(f.cid),cancelledActivity=f.c.inspectChangeActivity(result.workId);
 assert.equal(cancelled.modelContextFailure,undefined);assert.equal(managedChangeCompletionNotice(result,cancelled,cancelledActivity,cancelledView,locale),undefined);assert.deepEqual(cancelled.execution,result.execution);
 const cancelledPresentation=taskPresentation({view:cancelledView,roster:[cancelledView],changeActivity:cancelledActivity,locale});assert.doesNotMatch(cancelledPresentation.navigatorSummary,locale==='ko'?/모델.*한도/:/model.*context limit/i);
 f.pass();
});

test('budget-unavailable copy stays distinct from input-limit copy and unknown data stays generic',()=>{
 for(const locale of ['en','ko']){
  const limit=modelContextPresentation('MODEL_CONTEXT_LIMIT','W',locale),unavailable=modelContextPresentation('MODEL_CONTEXT_UNAVAILABLE','W',locale);assert.notEqual(limit.summary,unavailable.summary);assert.notEqual(limit.details,unavailable.details);assert.ok(unavailable.details.includes('/work W'));assert.doesNotMatch(unavailable.details,/no (request|charge)|무료|과금되지/);
  assert.equal(modelContextPresentation(undefined,'W',locale),undefined);assert.equal(modelContextPresentation('UNKNOWN','W',locale),undefined);
 }
});

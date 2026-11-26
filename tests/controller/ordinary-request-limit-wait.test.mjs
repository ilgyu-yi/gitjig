/** Original Controller/SDK accepted WAIT; controlled read-only scope, no engine or paid model. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAssistantMessageEventStream, getCurrentTools} from '@earendil-works/pi-ai/compat';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {seedNormalQuota} from './planning-failure-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const root=await temporaryDirectory('ordinary-limit-wait'),home=path.join(root,'home'),project=path.join(root,'project'),shim=path.join(root,'scope.mjs');
await fs.mkdir(project);await fs.writeFile(path.join(project,'original.txt'),'Original source retained.\n');
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__ordinaryLimitWaitScope(options)};export class RuntimeHelperUnavailableError extends Error {}');
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/ordinary.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const scopes=[];let allPassed=true;const oldTmp=process.env.TMPDIR;
globalThis.__ordinaryLimitWaitScope=async options=>{
 const deny=()=>assert.fail('No engine or writable project operation in controlled ordinary WAIT');
 const scope={containerId:'controlled-'+randomUUID(),workspaceRoot:options.workRoot,
  validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},
  readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,
  async close(){scope.closed=true;return{state:'removed'};}};scopes.push(scope);return scope;
};
const {openController}=await import('../../dist/controller/index.js');
const {originalFailedWaitOutcome}=await import('../../dist/controller/original-wait-outcome.js');
const {scripted}=await import('./effect-fixture.mjs');
after(async()=>{delete globalThis.__ordinaryLimitWaitScope;if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;assert.ok(scopes.every(scope=>scope.closed));if(allPassed)await fs.rm(root,{recursive:true,force:true});});
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};

async function world(t,{dependent=false,mixed=false,reportOnly=false,late,hold,projectSwitch=false,pausedGoal=false}={}){
 process.env.TMPDIR=path.join(home,'artifacts');let passed=false,release;
 const gate=new Promise(resolve=>release=resolve),c=await openController({installationHome:home,maxProviderRequests:16,
  runtimeProfile:{dockerBinary:process.execPath,dockerContext:'CONTROLLED_NO_ENGINE',image:'sha256:'+'b'.repeat(64)},
  interactionDelegation:{projectIds:['P'],maxAssignments:mixed?2:1}}),s=c.store;
 t.after(async()=>{release();await c.ordinary.drain();await c.close();if(!passed){allPassed=false;t.diagnostic('Retained ordinary limit WAIT '+root);}});
 if(!c.listProjects().some(p=>p.id==='P'))await c.registerProject({id:'P',sourceRoot:project});
 const parent=c.createConversation().conversationId,identity=randomUUID(),continuations=[];
 if(projectSwitch)c.setConversationProject({conversationId:parent,projectId:'P',expectedGeneration:0});
 let childCalls=0,parentCalls=0,lateInjected=false,holdInjected=false,originals,diagnosis;
 const assignments=()=>s.all('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid',parent);
 const capture=()=>assignments().map(a=>({assignment:a,runs:s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',a.work),
  publication:s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(a.data).resultId),budgets:s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',a.work)}));
 const model={provider:'ordinary-limit-wait-'+identity,modelId:'fixture',definition:{api:'ordinary-limit-wait-api-'+identity,
  apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:64000,maxTokens:2000,cost:usage.cost}],
  streamSimple(selected,context){const stream=createAssistantMessageEventStream();void(async()=>{try{
   let tool,text;
   if(getCurrentTools(context.messages).some(tool=>tool.name==='conversation_report')){
    childCalls++;await gate;
    if(JSON.stringify(context.messages.filter(message=>message.role==='user')).includes('REPORT_ONLY_FIXTURE'))text='사용자 답변은 남지만 영어 보고를 제출하지 않았습니다.';
    else tool={name:'conversation_status',arguments:{}};
   }else{
    parentCalls++;const latest=context.messages.filter(message=>message.role==='user').at(-1);
    const raw=typeof latest?.content==='string'?latest.content:latest?.content?.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
    const assigned=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='conversation_assign');
    if(raw.startsWith('Explicitly resumed authorized dependency outcomes')){if(!continuations.includes(raw))continuations.push(raw);text='The original investigation is unavailable; no retry or successful report is implied.';}
    else if(raw==='Why did the original delegated investigation stop?'){
     const user=context.messages.lastIndexOf(latest);
     const status=context.messages.slice(user+1).find(message=>message.role==='toolResult'&&message.toolName==='conversation_status');
     if(!status)tool={name:'conversation_status',arguments:{conversationId:assigned[0]
      ? JSON.parse(assigned[0].content[0].text).conversationId : assignments()[0].target}};
     else {
      assert.equal(status.isError,false);
      diagnosis=JSON.parse(status.content[0].text);
      text='The original delegated investigation remains stopped.';
     }
    }
    else if(raw==='A later direct owner request')text='The later owner request is handled.';
    else if(assigned.length<(mixed?2:1))tool={name:'conversation_assign',arguments:{projectId:'P',operation:'investigate',
     instructions:reportOnly||mixed&&assigned.length===1?'REPORT_ONLY_FIXTURE: Finish with a human answer only.':'Inspect retained source without changing it.',resultDependency:dependent}};
    else tool={name:'conversation_wait',arguments:{resultHandles:assigned.map(message=>JSON.parse(message.content.filter(part=>part.type==='text').map(part=>part.text).join('')).assignmentId)}};
   }
   const message={role:'assistant',content:tool?[{type:'toolCall',id:randomUUID(),name:tool.name,arguments:tool.arguments}]:[{type:'text',text}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:tool?'toolUse':'stop',timestamp:Date.now()};
   stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
  }catch(error){const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:message});stream.end(message);}})();return stream;}}};
 const beforeFresh=c.completed.beforeFresh.bind(c.completed);
 c.completed.beforeFresh=async cid=>{
  await beforeFresh(cid);const state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data);
  if(cid!==parent||!state.explicitContinuation?.ordinaryDiagnosticFence||lateInjected||!late)return;
  lateInjected=true;const a=assignments().find(row=>JSON.parse(row.data).result?.requestLimit),runId=JSON.parse(a.data).result.runId;
  const marker=s.one("SELECT * FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-request-limit'",runId);
  if(late==='delete')s.run('DELETE FROM observations WHERE id=?',marker.id);
  if(late==='mutate')s.run('UPDATE observations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(marker.data),limit:15}),marker.id);
  if(late==='extra')s.run('INSERT INTO observations(id,run,data) VALUES(?,?,?)',randomUUID(),runId,marker.data);
  if(late==='publication'){
   const publication=s.one('SELECT data FROM conversation_results WHERE id=?',JSON.parse(a.data).resultId);
   s.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify({...JSON.parse(publication.data),publicationHash:'c'.repeat(64)}),JSON.parse(a.data).resultId);
  }
  if(late==='roster')s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...state,explicitContinuation:{...state.explicitContinuation,
   ordinaryDiagnosticFence:{...state.explicitContinuation.ordinaryDiagnosticFence,requestLimitAssignmentIds:[]}}}),parent);
 };
 const observe=c.goals.observeDependencies.bind(c.goals);
 c.goals.observeDependencies=()=>{
  const rows=assignments();if(rows.length===(mixed?2:1)&&rows.every(a=>a.state==='UNAVAILABLE')&&!originals){
   originals=capture();
   if(hold){holdInjected=true;hold({c,s,parent,assignment:rows[0],runId:JSON.parse(rows[0].data).result.runId});}
  }
  return observe();
 };
 if(pausedGoal){
  const goal=c.createGoal({conversationId:parent,objective:'Inspect the original investigation outcome',criteria:['Do not invent a report'],turnLimit:8});
  c.startGoal({goalId:goal.goalId,expectedRevision:goal.revision,model});
  for(let n=0;n<1000&&c.inspectConversation(parent).state!=='WAITING';n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(c.inspectConversation(parent).state,'WAITING');const current=c.inspectGoal(goal.goalId);
  await c.pauseGoal({goalId:goal.goalId,expectedRevision:current.revision,reason:'Owner pauses original WAIT before result'});
 }else{
  await c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Delegate investigation and wait for its actual outcome.',mode:'idle'});
  assert.equal((await c.runConversation({conversationId:parent,model})).status,'waiting');assert.equal(c.inspectConversation(parent).state,'WAITING');
 }
 release();await c.ordinary.drain();assert.ok(originals);
 const parentWork=s.one('SELECT work FROM conversation_state WHERE conversation=?',parent).work;
 const shouldResume=!late&&!hold&&!pausedGoal;assert.equal(continuations.length,shouldResume?1:0);
 assert.equal(childCalls,reportOnly?1:mixed?17:16);
 assert.equal(s.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",parent).n,shouldResume?2:1);
 assert.equal(s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",parentWork).consumed,shouldResume?2:1);
 for(const a of assignments())assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',a.id)?.state,dependent?'PENDING':undefined);
 if(!hold&&late!=='publication')assert.deepEqual(capture(),originals,'Original child assignment/result/runs/allowances stay intact');
 for(let n=0;n<3;n++)c.ordinary.resumeAuthorized();await c.ordinary.drain();assert.equal(continuations.length,shouldResume?1:0);
 const state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data);
 if(late){
  assert.equal(lateInjected,true);assert.equal(parentCalls,mixed?3:2);assert.equal(state.explicitContinuation.newRunId,undefined);
  assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',state.explicitContinuation.inputId).state,'QUEUED');
  await assert.rejects(c.runConversation({conversationId:parent,model}),/Original (diagnostic|request-limit)/);assert.equal(parentCalls,mixed?3:2);
 }
 if(hold)assert.equal(holdInjected,true);
 assert.equal(await fs.readFile(path.join(project,'original.txt'),'utf8'),'Original source retained.\n');
 return{c,s,parent,parentWork,model,state,continuations,assignments,readDiagnosis:()=>diagnosis,pass:()=>passed=true};
}

test('a later owner diagnosis names the exact current ordinary cap and refuses corrupted outcome proof',async t=>{
 const f=await world(t,{dependent:true});
 const original=f.assignments()[0], resultId=JSON.parse(original.data).resultId;
 const raw=f.s.one('SELECT data FROM conversation_results WHERE id=?',resultId).data;
 const diagnose=async(conversationId=f.parent)=>{
  await f.c.queueConversationInput({conversationId,expectedGeneration:f.c.inspectConversation(conversationId).generation,
   text:'Why did the original delegated investigation stop?',mode:'idle'});
  assert.equal((await f.c.runConversation({conversationId,model:f.model})).status,'delivered');
  return f.readDiagnosis();
 };
 const status=await diagnose();
 assert.equal(status.originalRecovery?.kind,'local-model-request-limit');
 assert.equal(status.originalRecovery.limit,16);
 assert.equal(status.originalRecovery.assignmentId,original.id);
 assert.equal(status.originalRecovery.workId,original.work);
 assert.equal(status.originalRecovery.resultId,resultId);
 assert.equal(status.assignments[0].resume,undefined);
 f.s.run("UPDATE conversation_results SET data=json_set(data,'$.assignmentId','foreign') WHERE id=?",resultId);
 try {
  const unreadable=await diagnose();
  assert.equal(unreadable.originalRecovery?.kind,'current-result-unreadable');
  assert.equal(unreadable.originalRecovery.assignmentId,original.id);
 } finally { f.s.run('UPDATE conversation_results SET data=? WHERE id=?',raw,resultId); }
 f.s.run("UPDATE conversation_results SET data=json_remove(data,'$.result.requestLimit') WHERE id=?",resultId);
 try { assert.equal((await diagnose()).originalRecovery?.kind,'current-result-unreadable'); }
 finally { f.s.run('UPDATE conversation_results SET data=? WHERE id=?',raw,resultId); }
 const observation=f.s.one("SELECT id,data FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-request-limit'",
  JSON.parse(original.data).result.runId);
 f.s.run("UPDATE observations SET data=json_set(data,'$.limit',15) WHERE id=?",observation.id);
 try { assert.equal((await diagnose()).originalRecovery?.kind,'failure-cause-unverified'); }
 finally { f.s.run('UPDATE observations SET data=? WHERE id=?',observation.data,observation.id); }
 const outsider=f.c.createConversation().conversationId;
 const foreign=await diagnose(outsider);
 assert.deepEqual(foreign.assignments,[]);
 assert.equal(foreign.originalRecovery,undefined);
 assert.deepEqual(f.assignments(),[original]);
 f.pass();
});

test('named status does not mistake the original private-answer projection for a malformed cap publication',async t=>{
 const f=await world(t,{reportOnly:true});
 const original=f.assignments()[0];
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,
  text:'Why did the original delegated investigation stop?',mode:'idle'});
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');
 const status=f.readDiagnosis();
 assert.equal(status.originalRecovery,undefined);
 assert.equal(status.assignments[0].resultId,JSON.parse(original.data).resultId);
 assert.deepEqual(f.assignments(),[original]);
 f.pass();
});

for(const dependent of [false,true])test(`actual assigned host cap resumes original ${dependent?'dependent':'nondependent'} WAIT once`,async t=>{
 const f=await world(t,{dependent});assert.equal(f.state.explicitContinuation.ordinaryDiagnosticFence.kind,'ordinary-failed-wait/v2');
 const original=f.assignments()[0], report=f.c.inspectRecordedDelegatedResults(f.parent).requestFailures;
 assert.equal(report?.length,1);assert.equal(report[0].assignmentId,original.id);assert.equal(report[0].limit,16);
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'A later direct owner request',mode:'idle'});
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');f.pass();
});

for(const governed of [false,true])test('a nested original assignment exposes only the bound descendant '+(governed?'provider stop':'local cap')+' across reopen', {timeout:20000}, async t => {
 process.env.TMPDIR = path.join(home,'artifacts');
 const opening = {installationHome:home,maxProviderRequests:3,
  runtimeProfile:{dockerBinary:process.execPath,dockerContext:'CONTROLLED_NO_ENGINE',image:'sha256:'+'b'.repeat(64)},
  interactionDelegation:{projectIds:['P'],maxAssignments:4}};
 let c = await openController(opening);
 let passed = false;
 t.after(async()=>{await c.ordinary.drain();await c.close();if(!passed){allPassed=false;t.diagnostic('Retained nested limit fixture '+root);}});
 if (!c.listProjects().some(entry=>entry.id==='P')) await c.registerProject({id:'P',sourceRoot:project});
 const top = c.createConversation().conversationId;
 const outsider = c.createConversation({projectId:'P'}).conversationId;
 if(governed)c.changeCore.drive=async({workId})=>{
  seedNormalQuota(c,workId,'adjudicator',randomUUID());
  return c.inspectChange(workId);
 };
 const asText = message => typeof message?.content==='string'?message.content:message?.content
  ?.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
 let diagnosticTarget, diagnostic, rejectedResume;
 const model=scripted(context=>{
  const source = asText(context.messages.find(message=>message.role==='user'));
  const latest=context.messages.findLastIndex(message=>message.role==='user');
  if(asText(context.messages[latest])==='Why did the task delegated through the coordinator stop?'){
   const result=context.messages.slice(latest+1).find(message=>message.role==='toolResult'&&message.toolName==='conversation_status');
   if(!result)return{tool:{name:'conversation_status',arguments:{conversationId:diagnosticTarget}}};
   assert.equal(result.isError,false);
   diagnostic=JSON.parse(asText(result));
   return {text:'Read the retained outcome and preserve the original assignment.'};
  }
  if(asText(context.messages[latest])==='Try the exact nested assignment directly.'){
   const result=context.messages.slice(latest+1).find(message=>message.role==='toolResult'&&message.toolName==='conversation_resume_assignment');
   if (!result) return {tool:{name:'conversation_resume_assignment',arguments:{assignmentId:leaf.id,conversationId:leaf.target,
    projectId:'P',resultId:exact.resultId,observedDirectionRevision:c.inspectConversation(leaf.target).directionRevision,checkpoint:'0'.repeat(64)}}};
   assert.equal(result.isError,true);
   rejectedResume=asText(result);
   return {text:'The original direct coordinator owns continuation.'};
  }
  const assigned = context.messages.find(message=>message.role==='toolResult'&&message.toolName==='conversation_assign');
  if (source.includes('LEAF_FIXTURE')) return {tool:{name:'conversation_status',arguments:{}}};
  if (assigned) return {tool:{name:'conversation_wait',arguments:{resultHandles:[JSON.parse(asText(assigned)).assignmentId]}}};
  return {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:governed&&source.includes('MIDDLE_FIXTURE')?'change':'investigate',resultDependency:true,
   instructions:source.includes('MIDDLE_FIXTURE')?'LEAF_FIXTURE Inspect the original source.':'MIDDLE_FIXTURE Delegate and wait.'}}};
 });
 model.provider='nested-cap-'+randomUUID();
 model.definition.api='nested-cap-api-'+randomUUID();
 await c.queueConversationInput({conversationId:top,expectedGeneration:0,text:'Delegate the middle investigation.',mode:'idle'});
 const initial = await c.runConversation({conversationId:top,model});
 assert.equal(initial.status,'waiting',initial.failure);
 await c.ordinary.drain();
 const middle = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',top);
 const leaf = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',middle.target);
 assert.equal(leaf.state,'UNAVAILABLE');
 const exact = {assignmentId:leaf.id,conversationId:leaf.target,workId:leaf.work,resultId:JSON.parse(leaf.data).resultId};
 const field = governed?'descendantStops':'requestFailures';
 const child = c.inspectRecordedDelegatedResults(middle.target);
 const descendant = c.inspectRecordedDelegatedResults(top)[field];
 if(governed){
  assert.ok(child.entries.some(entry=>entry.resultId===exact.resultId && entry.providerUsageLimitReset));
  assert.equal(descendant?.length,1);
  assert.match(descendant[0].proof,/^[a-f0-9]{64}$/);
  assert.deepEqual(descendant,[{...exact,waitAssignmentId:middle.id,proof:descendant[0].proof,stop:'provider-limit',
   providerUsageLimitReset:1794020400,providerUsageLimitRole:'adjudicator',currentWait:true}]);
 }else{
  assert.deepEqual(child.requestFailures,[{...exact,limit:3}]);
  assert.deepEqual(descendant,[{...exact,limit:3,waitAssignmentId:middle.id,currentWait:true}]);
 }
 assert.equal(c.inspectRecordedDelegatedResults(outsider)[field],undefined);
 const route = c.inspectRecordedDelegatedResults(top).descendantCoordinatorRoutes?.[exact.resultId];
 assert.equal(route?.conversationId,middle.target);
 assert.match(route.proof,/^[a-f0-9]{64}$/);
 c.store.run('UPDATE conversations SET project=NULL WHERE id=?',middle.target);
 assert.deepEqual(c.inspectRecordedDelegatedResults(top)[field],descendant);
 assert.equal(c.inspectRecordedDelegatedResults(top).descendantCoordinatorRoutes,undefined);
 c.store.run("UPDATE conversations SET project='P' WHERE id=?",middle.target);
 const original = c.store.one('SELECT data FROM conversation_assignments WHERE id=?',middle.id).data;
 c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.source.runId','WRONG_RUN') WHERE id=?",middle.id);
 assert.equal(c.inspectRecordedDelegatedResults(top)[field],undefined);
 c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',original,middle.id);
 const waiting = c.store.one('SELECT data FROM conversation_state WHERE conversation=?',middle.target).data;
 const middleWaitRun=JSON.parse(waiting).runId;
 c.store.run("UPDATE runs SET phase='RUNNING' WHERE id=?",middleWaitRun);
 assert.equal(c.inspectRecordedDelegatedResults(top)[field]?.[0]?.currentWait,undefined);
 c.store.run("UPDATE runs SET phase='SETTLED' WHERE id=?",middleWaitRun);
 c.store.run("UPDATE conversation_state SET data=json_set(data,'$.waitHandles',json_array('different-assignment')) WHERE conversation=?",middle.target);
 assert.equal(c.inspectRecordedDelegatedResults(top)[field][0].currentWait,undefined);
 c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',waiting,middle.target);
 await c.close();
 c=await openController(opening);
 assert.deepEqual(c.inspectRecordedDelegatedResults(top)[field],descendant);
 const locale=governed?'ko':'en';
 if(governed)c.setConversationLanguage({conversationId:top,expectedGeneration:c.inspectConversation(top).generation,expectedRevision:0,replyLanguage:locale});
 const draft = 'Unsent owner draft';
 c.setDraft({conversationId:top,expectedRevision:c.inspectConversation(top).draft.revision,text:draft});
 const coordinatorDraft = 'Unsent coordinator draft';
 c.setDraft({conversationId:middle.target,expectedRevision:c.inspectConversation(middle.target).draft.revision,text:coordinatorDraft});
 const tables = ['conversation_inputs','conversation_assignments','conversation_results','runs','budgets'];
 const workTitle=uiText(locale,'workRecovery.title',{id:leaf.work,state:c.inspectWorkRecovery(leaf.work).state});
 const queries = tables.map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',
  rows:c.store.all('SELECT * FROM '+table+' ORDER BY rowid').map(Object.values)}));
 const expectedInputs = c.store.one('SELECT count(*) AS n FROM conversation_inputs').n;
 await c.close();
 const file = path.join(root,'nested-limit-'+locale+'-pty.json');
 const limit = governed?uiText(locale,'planningFailure.quotaTitle'):'Response reached its 3-request limit';
 const action=uiText(locale,'result.openActions');
 const options=uiText(locale,'delegated.ownerActions');
 const openCoordinator=governed?'원래 코디네이터 열기':'Open original coordinator';
 const returning={key:'Ctrl+G',confirm:'enter'};
 const step = (wait,send)=>({wait,send,assertDraft:draft,expectedSelected:top,queries});
 const steps = [step(uiText(locale,'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'}),'\x07'),step(uiText(locale,'command.recovery'),'\r'),
  step(action,'\r'),step(options,'\r'),step(action,'\r'),
  step(options,'\x1b[B\r'),step(workTitle,'\x1b'),
  step(action,'\r'),step(openCoordinator,'\x1b[B\x1b[B\r'),
  {...step(uiText('en','delegated.inputReturnKey',returning),'\x07'),assertDraft:coordinatorDraft,expectedSelected:middle.target},
  {...step(uiText('en','delegated.inputReturn'),'\r'),assertDraft:coordinatorDraft,expectedSelected:middle.target},
  step(uiText(locale,'delegated.recoveryKey',returning),'\x07'),step(uiText(locale,'command.recovery'),'\r'),step(action,'\r'),
  {...step(openCoordinator,'\x1b[B\x1b[B\r'),mutations:[{sql:'UPDATE conversations SET project=NULL WHERE id=?',params:[middle.target]}]},
  {...step(uiText(locale,'delegated.resultChanged').split('.')[0],'\x07q'),
   mutations:[{sql:"UPDATE conversations SET project='P' WHERE id=?",params:[middle.target]}]}];
 await fs.writeFile(file,JSON.stringify({steps,expectedInputs,columns:90,rows:28,timeoutSeconds:10,noForceKill:true,
  output:file+'.terminal',database:path.join(home,'state/controller.sqlite'),
  command:[process.execPath,'--import',path.resolve('tests/ui/reopen-no-dispatch.mjs'),path.resolve('dist/cli/entry.js'),
   'conversation','ui','--home',home,'--conversation',top],
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
 const observed=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
 assert.deepEqual([observed.exitCode,observed.stages,observed.terminalRestored],[0,steps.length,true]);
 c=await openController(opening);
 const childRecords=()=>['works','runs','conversation_inputs','conversation_results','budgets'].map(table=>
  c.store.all(`SELECT * FROM ${table} WHERE ${table==='works'?'id':table==='budgets'?'lineage':'work'} IN (?,?) ORDER BY rowid`,middle.work,leaf.work));
 const delegationRecords=()=>['conversation_assignments','conversation_dependencies'].map(table=>
  c.store.all('SELECT * FROM '+table+' ORDER BY rowid'));
 const before=childRecords();
 const delegationBefore=delegationRecords();
 diagnosticTarget=middle.target;
 const diagnose=async(source)=>{
  await c.queueConversationInput({conversationId:source,expectedGeneration:c.inspectConversation(source).generation,
   text:'Why did the task delegated through the coordinator stop?',mode:'idle'});
  assert.equal((await c.runConversation({conversationId:source,model})).status,'delivered');
  return diagnostic;
 };
 const status=await diagnose(top);
 assert.equal(c.inspectConversation(top).state,'IDLE');
 assert.equal(c.inspectConversationWait(top),undefined);
 const recovery=status.descendantRecovery;
 assert.equal(recovery?.entries.length,1);
 const [entry]=recovery.entries;
 assert.deepEqual({assignmentId:entry.assignmentId,conversationId:entry.conversationId,workId:entry.workId,resultId:entry.resultId},exact);
 assert.equal(entry.coordinatorConversationId,middle.target);
 assert.equal(entry.temporalScope,'publication-only');
 assert.equal(entry.kind,governed?'provider-usage-limit':'local-model-request-limit');
 assert.equal(entry.currentWait,undefined);
 assert.equal(entry.resume,undefined);
 assert.equal(entry.nextAction,undefined);
 assert.equal((await diagnose(outsider)).descendantRecovery,undefined);
 c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.launchResultUnavailable',json('true')) WHERE id=?",leaf.id);
 try { assert.equal((await diagnose(top)).descendantRecovery,undefined); }
 finally { c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',leaf.data,leaf.id); }
 c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.delegation.projectIds',json('[]')) WHERE id=?",leaf.id);
 try { assert.equal((await diagnose(top)).descendantRecovery,undefined); }
 finally { c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',leaf.data,leaf.id); }
 if(!governed){
  const sourceId=JSON.parse(leaf.data).instructionsSource;
  const {origin}=c.store.one('SELECT origin FROM sources WHERE id=?',sourceId);
  c.store.run("UPDATE sources SET origin=json_set(origin,'$.actor.runId','unrelated') WHERE id=?",sourceId);
  try { assert.equal((await diagnose(top)).descendantRecovery,undefined); }
  finally { c.store.run('UPDATE sources SET origin=? WHERE id=?',origin,sourceId); }
 }
 if(governed){
  const works=c.store.one('SELECT COUNT(*) n FROM works').n;
  await c.queueConversationInput({conversationId:top,expectedGeneration:c.inspectConversation(top).generation,
   text:'Try the exact nested assignment directly.',mode:'idle'});
  assert.equal((await c.runConversation({conversationId:top,model})).status,'delivered');
  assert.match(rejectedResume,/outside this current task, coordinator or project/);
  assert.equal(c.store.one('SELECT COUNT(*) n FROM works').n,works);
 }
 assert.deepEqual(childRecords(),before);
 assert.deepEqual(delegationRecords(),delegationBefore);
 passed=true;
});
test('actual missing-report legacy and mixed-family waits retain distinct fence recipes',async t=>{
 const legacy=await world(t,{reportOnly:true});assert.equal(legacy.state.explicitContinuation.ordinaryDiagnosticFence.kind,'ordinary-missing-report-wait/v1');legacy.pass();
 await legacy.c.close();
 const mixed=await world(t,{mixed:true,dependent:true});const fence=mixed.state.explicitContinuation.ordinaryDiagnosticFence;
 assert.equal(fence.kind,'ordinary-failed-wait/v2');assert.equal(fence.assignmentIds.length,2);assert.equal(fence.requestLimitAssignmentIds.length,1);mixed.pass();
});
test('a project switch preserves original WAIT and a later owner request across distinct work/conversation generations',async t=>{
 const f=await world(t,{projectSwitch:true});
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'A later direct owner request',mode:'idle'});
 const receipt=f.state.explicitContinuation,run=f.s.one('SELECT * FROM runs WHERE id=?',receipt.newRunId);
 assert.notEqual(run.generation,f.s.one('SELECT generation FROM conversation_inputs WHERE id=?',receipt.inputId).generation);
 for(const column of ['generation','epoch']){
  f.s.run(`UPDATE runs SET ${column}=${column}+1 WHERE id=?`,run.id);
  try{await assert.rejects(f.c.runConversation({conversationId:f.parent,model:f.model}),/Original diagnostic reservation correspondence/);}
  finally{f.s.run(`UPDATE runs SET ${column}=? WHERE id=?`,run[column],run.id);}
 }
 const saved=f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.parent).data;
 f.s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...JSON.parse(saved),explicitContinuation:{...receipt,runId:receipt.newRunId}}),f.parent);
 try{await assert.rejects(f.c.runConversation({conversationId:f.parent,model:f.model}),/Original diagnostic reservation correspondence/);}
 finally{f.s.run('UPDATE conversation_state SET data=? WHERE conversation=?',saved,f.parent);}
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'A later direct owner request',mode:'idle'});
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');f.pass();
});
for(const late of ['delete','mutate','extra','publication','roster'])test(`late ${late} cannot dispatch or recapture a queued original cap diagnostic`,async t=>{const f=await world(t,{late});f.pass();});
test('an owner can supersede a held cap diagnostic without recapturing changed child evidence',async t=>{
 const f=await world(t,{late:'delete'}),input=f.state.explicitContinuation.inputId;
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'A later direct owner request',mode:'idle'});
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',input).state,'CONFLICTED');f.pass();
});
test('a paused owner goal cannot dispatch the cap continuation',async t=>{const f=await world(t,{pausedGoal:true});f.pass();});
test('exhausted parent execution allowance cannot allocate or charge a cap continuation',async t=>{
 const f=await world(t,{hold:({s,parent})=>s.run("UPDATE budgets SET lim=consumed WHERE lineage=(SELECT work FROM conversation_state WHERE conversation=?) AND kind='execution'",parent)});f.pass();
});
for(const [name,hold]of [
 ['parent input',({c,parent})=>c.queueConversationInput({conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'New parent direction',mode:'idle'})],
 ['child input',({c,assignment})=>c.queueConversationInput({conversationId:assignment.target,expectedGeneration:c.inspectConversation(assignment.target).generation,text:'New child direction',mode:'idle'})],
 ['unknown cleanup',({s,runId})=>{const data=JSON.parse(s.one('SELECT data FROM runs WHERE id=?',runId).data);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...data,cleanup:'quarantined:client'}),runId);}],
 ['work epoch',({s,assignment})=>s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',assignment.work)],
 ['ambiguous host marker',({s,runId})=>{
  const marker=s.one("SELECT id,data FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-request-limit'",runId);
  s.run('UPDATE observations SET data=? WHERE id=?',marker.data.replace('{','{"limit":15,'),marker.id);
 }],
])test(`current ${name} holds the original cap continuation`,async t=>{const f=await world(t,{hold});assert.equal(originalFailedWaitOutcome(f.s,f.parent,f.assignments()[0].id).state,'held');f.pass();});

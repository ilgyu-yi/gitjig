/** Original Controller/SDK accepted WAIT; controlled read-only scope, no engine or paid model. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream, getCurrentTools} from '@earendil-works/pi-ai/compat';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
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
after(async()=>{delete globalThis.__ordinaryLimitWaitScope;if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;assert.ok(scopes.every(scope=>scope.closed));if(allPassed)await fs.rm(root,{recursive:true,force:true});});
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};

async function world(t,{dependent=false,mixed=false,reportOnly=false,late,hold,projectSwitch=false,pausedGoal=false}={}){
 process.env.TMPDIR=path.join(home,'artifacts');let passed=false,release;
 const gate=new Promise(resolve=>release=resolve),c=await openController({installationHome:home,
  runtimeProfile:{dockerBinary:process.execPath,dockerContext:'CONTROLLED_NO_ENGINE',image:'sha256:'+'b'.repeat(64)},
  interactionDelegation:{projectIds:['P'],maxAssignments:mixed?2:1}}),s=c.store;
 t.after(async()=>{release();await c.ordinary.drain();await c.close();if(!passed){allPassed=false;t.diagnostic('Retained ordinary limit WAIT '+root);}});
 if(!c.listProjects().some(p=>p.id==='P'))await c.registerProject({id:'P',sourceRoot:project});
 const parent=c.createConversation().conversationId,identity=randomUUID(),continuations=[];
 if(projectSwitch)c.setConversationProject({conversationId:parent,projectId:'P',expectedGeneration:0});
 let childCalls=0,parentCalls=0,lateInjected=false,holdInjected=false,originals;
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
 return{c,s,parent,parentWork,model,state,continuations,assignments,pass:()=>passed=true};
}

for(const dependent of [false,true])test(`actual assigned host cap resumes original ${dependent?'dependent':'nondependent'} WAIT once`,async t=>{
 const f=await world(t,{dependent});assert.equal(f.state.explicitContinuation.ordinaryDiagnosticFence.kind,'ordinary-failed-wait/v2');
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'A later direct owner request',mode:'idle'});
 assert.equal((await f.c.runConversation({conversationId:f.parent,model:f.model})).status,'delivered');f.pass();
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

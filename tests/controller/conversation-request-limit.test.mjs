/** Real Controller/Pi SDK turns with controlled local streams; no engine or paid provider. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {scripted} from './effect-fixture.mjs';
const tables=['works','runs','budgets','conversation_inputs','conversation_results','observations','conversation_state','sources'];
const snapshot=c=>JSON.stringify(Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')])));
let sharedRoot,allPassed=true;const previousTmp=process.env.TMPDIR;
after(async()=>{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;if(sharedRoot&&allPassed)await fs.rm(sharedRoot,{recursive:true,force:true});});
async function world(t,{maxProviderRequests}={maxProviderRequests:16}){
 sharedRoot??=await temporaryDirectory('conversation-request-limit');const root=sharedRoot,home=path.join(root,'home');let c=await openController({installationHome:home,maxProviderRequests}),passed=false;
 process.env.TMPDIR=path.join(home,'artifacts');const cid=c.createConversation().conversationId;
 t.after(async()=>{await c.close();if(!passed){allPassed=false;t.diagnostic('Retained request-limit world '+root);}});
 return{get c(){return c;},cid,home,async reopen(limit=maxProviderRequests){await c.close();c=await openController({installationHome:home,maxProviderRequests:limit});},pass(){passed=true;},async run(next,options={}){
  const v=c.inspectConversation(cid);const {captureText,...runOptions}=options;const queued=await (captureText?c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:v.generation,text:captureText,mode:'idle'}):c.queueConversationInput({conversationId:cid,expectedGeneration:v.generation,text:'원래 요청을 보존하고 현재 대화 상태를 확인하세요.',mode:'idle'}));let calls=0;
  const model=scripted((context,turn)=>{calls++;return next(context,turn);});model.provider='request-limit-'+randomUUID();model.definition.api='request-limit-api-'+randomUUID();
  const result=await c.runConversation({conversationId:cid,model,...runOptions});return{result,queued,calls};
 }};
}
const repeat=()=>({tool:{name:'conversation_status',arguments:{}}});
test('the default ordinary limit permits a response to finish beyond the former ceiling',async t=>{
 const saved=process.env.GITJIG_MAX_PROVIDER_REQUESTS;
 delete process.env.GITJIG_MAX_PROVIDER_REQUESTS;
 let f;
 try{f=await world(t,{});}finally{if(saved!==undefined)process.env.GITJIG_MAX_PROVIDER_REQUESTS=saved;}
 const {result,calls}=await f.run((_context,turn)=>turn<17?repeat():{text:'Response completed after 17 tool requests.'});
 assert.equal(calls,18);assert.equal(result.status,'delivered');assert.equal(result.requestLimit,undefined);f.pass();
});
test('exact ordinary request ceiling preserves a typed host fact and cold current-result inspection',async t=>{
 const f=await world(t),{result,queued,calls}=await f.run(repeat);
 assert.equal(calls,16);assert.equal(result.status,'unavailable');assert.deepEqual(result.requestLimit,{limit:16});assert.equal(result.answer,undefined);
 const run=f.c.store.one('SELECT * FROM runs WHERE id=?',result.runId);assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(JSON.parse(run.data).outcome,'unavailable');
 assert.equal(f.c.store.one('SELECT state FROM conversation_inputs WHERE id=?',queued.inputId).state,'CONSUMED');
 assert.equal(f.c.store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?',result.workId,'execution').consumed,1);
 const before=snapshot(f.c),view=f.c.inspectConversationRequestFailure(f.cid);assert.ok(view);assert.equal(view.runId,result.runId);assert.equal(view.workId,result.workId);assert.equal(view.limit,16);assert.equal(view.cleanup,result.cleanup);assert.equal(snapshot(f.c),before);
 await f.reopen(32);const reopened=snapshot(f.c);assert.deepEqual(f.c.inspectConversationRequestFailure(f.cid),view);assert.equal(snapshot(f.c),reopened);f.pass();
});
test('new pending owner input and a later successful response supersede the current limit diagnostic',async t=>{
 const f=await world(t);await f.run(repeat);assert.ok(f.c.inspectConversationRequestFailure(f.cid));
 await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'새 지시를 먼저 검토하세요.',mode:'idle'});
 assert.equal(f.c.inspectConversationRequestFailure(f.cid),null);
 const model=scripted(()=>({text:'새 응답을 정상적으로 마쳤습니다.'}));model.provider='after-limit-'+randomUUID();model.definition.api='after-limit-api-'+randomUUID();
 const result=await f.c.runConversation({conversationId:f.cid,model});assert.equal(result.status,'delivered');assert.equal(result.requestLimit,undefined);assert.equal(f.c.inspectConversationRequestFailure(f.cid),null);f.pass();
});
test('provider prose imitating the ceiling does not create a host limit observation',async t=>{
 const f=await world(t),{result}=await f.run(()=>({text:'Conversation request cancelled or finite16-request allowance exhausted'}));
 assert.equal(result.status,'delivered');assert.equal(result.requestLimit,undefined);assert.equal(f.c.inspectConversationRequestFailure(f.cid),null);f.pass();
});
test('a provider error imitating the limit remains an unclassified provider failure',async t=>{
 const f=await world(t),{result}=await f.run(()=>{throw Error('Conversation response reached its 16-request limit; the original request and work are retained.');});
 assert.equal(result.status,'unavailable');assert.equal(result.requestLimit,undefined);assert.equal(f.c.inspectConversationRequestFailure(f.cid),null);f.pass();
});
test('actual owner cancellation remains interrupted without a request-limit observation',async t=>{
 const f=await world(t),abort=new AbortController(),{result}=await f.run(()=>{abort.abort();return{text:'Cancelled before completion.'};},{signal:abort.signal});
 assert.equal(result.status,'interrupted');assert.equal(result.requestLimit,undefined);assert.equal(f.c.inspectConversationRequestFailure(f.cid),null);f.pass();
});
test('changed source, native binding, generation, project, observation or publication cannot be displayed as the current limit failure',async t=>{
 const f=await world(t),{result,queued}=await f.run(repeat),s=f.c.store;
 const input=s.one('SELECT * FROM conversation_inputs WHERE id=?',queued.inputId),observation=s.one("SELECT id,data FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-request-limit'",result.runId),view=f.c.inspectConversationRequestFailure(f.cid);
 assert.ok(view);
 const otherProject=path.join(f.home,'..','different-project');await fs.mkdir(otherProject);await f.c.registerProject({id:'OTHER_PROJECT',sourceRoot:otherProject});
 const otherSource=s.one('SELECT id FROM sources WHERE id!=? LIMIT 1',input.source).id;
 const cases=[
  ['conversation_state','data','conversation',f.cid,data=>JSON.stringify({...JSON.parse(data),runId:'OTHER_RUN'})],
  ['conversation_state','native_id','conversation',f.cid,()=> 'OTHER_NATIVE_SESSION'],
  ['conversations','history','id',f.cid,()=>'/other/history'],
  ['conversations','generation','id',f.cid,value=>value+1],
  ['conversations','project','id',f.cid,()=> 'OTHER_PROJECT'],
  ['works','epoch','id',result.workId,value=>value+1],
  ['works','generation','id',result.workId,value=>value+1],
  ['conversation_inputs','text','id',input.id,value=>value+' changed'],
  ['conversation_inputs','source','id',input.id,()=> otherSource],
  ['sources','raw','id',input.source,value=>value+' changed'],
  ['observations','data','id',observation.id,data=>JSON.stringify({...JSON.parse(data),limit:0})],
  ['observations','data','id',observation.id,data=>JSON.stringify({...JSON.parse(data),sourceId:'OTHER_SOURCE'})],
  ['conversation_results','data','id',view.resultId,data=>{const value=JSON.parse(data);value.result.failure='Changed retained diagnostic';return JSON.stringify(value);}],
 ];
 for(const[table,column,key,id,change]of cases){
  const old=s.one(`SELECT ${column} AS value FROM ${table} WHERE ${key}=?`,id).value;s.run(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,change(old),id);
  try{const before=snapshot(f.c);assert.equal(f.c.inspectConversationRequestFailure(f.cid),null,table+'.'+column);assert.equal(snapshot(f.c),before);}finally{s.run(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,old,id);}
 }
 assert.deepEqual(f.c.inspectConversationRequestFailure(f.cid),view);f.pass();
});

test('captured @@ input keeps its distinct original raw source through cap and cold inspection',async t=>{
 const f=await world(t),{result,queued}=await f.run(repeat,{captureText:'Check @@literal without changing its source.'});
 const input=f.c.store.one('SELECT text,source FROM conversation_inputs WHERE id=?',queued.inputId),raw=f.c.store.one('SELECT raw FROM sources WHERE id=?',input.source).raw;
 assert.notEqual(raw,input.text);assert.deepEqual(result.requestLimit,{limit:16});const view=f.c.inspectConversationRequestFailure(f.cid);assert.ok(view);await f.reopen();assert.deepEqual(f.c.inspectConversationRequestFailure(f.cid),view);f.pass();
});

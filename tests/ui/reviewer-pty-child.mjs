import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import fs from 'node:fs/promises';import {writeFileSync,renameSync} from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const {openController}=await import('../../dist/controller/index.js');
const c=await openController({installationHome:cfg.home,runtimeProfile:cfg.runtimeProfile});process.env.TMPDIR=path.join(cfg.home,'artifacts');
const {startConversationUI}=await import('../../dist/ui/index.js');const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},turns=new Map();
let phase='preparing',selected=null,parentId=null,reviewerId=null,registration,releaseReviewer,releaseParent,sameNative=false,sawDirect=false,focusStayed=false;
let parentEntered;const parentReady=new Promise(r=>parentEntered=r);let reviewerEntered;const reviewerReady=new Promise(r=>reviewerEntered=r);let parentClean;const parentCleaned=new Promise(r=>parentClean=r);const selections=[];
function control(){const list=c.listConversations().filter(v=>!v.archived);writeFileSync(cfg.control+'.tmp',JSON.stringify({phase,selected,parentId,reviewerId,parentIndex:list.findIndex(v=>v.conversationId===parentId),reviewerIndex:list.findIndex(v=>v.conversationId===reviewerId)}));renameSync(cfg.control+'.tmp',cfg.control);}
async function until(predicate,label){const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw Error('Missing actual barrier: '+label);await new Promise(r=>setTimeout(r,10));}}
const model={provider:'ui-governed-fixture',modelId:'fixture',definition:{api:'ui-governed-fixture',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:20000}],streamSimple(m,context,opts){
 const first=context.messages.find(message=>message.role==='user'),text=typeof first.content==='string'?first.content:first.content.filter(v=>v.type==='text').map(v=>v.text).join('');let tool,reply='Parent response continued independently',held=false;
 if(text.startsWith('Perform the assigned ')){
  const role=text.match(/assigned (\w+) task/)[1],body=JSON.parse(text.split('\n')[1]),turn=turns.get(text)??0;turns.set(text,turn+1);
  const result={version:1,summary:'Observed actual candidate/check source',findings:[],assessedScope:body.requiredScope};
  if(role==='planner')result.plan={intent:'Produce value3',requirements:[{id:'R1',text:'Consumer exports3',source:body.context.ownerSource}],approach:'Change existing literal export',simplerAlternative:'Existing one-line export',factualSources:['base:consumer.cjs'],verification:{checks:[{id:'value',guaranteeIds:['R1'],command:'node check.cjs',assertions:['three'],timeoutMs:1000,fixturePaths:['check.cjs','consumer.cjs'],expectationPaths:['check.cjs']}],requiredPaths:['consumer.cjs','check.cjs'],reviewRoles:[{key:'actual-behavior',kind:'reviewer',purpose:'Inspect actual value3 and checker',requiredPaths:['consumer.cjs','check.cjs']}]},ambiguities:[]};
  if(role==='planner')result.plan.verification.checks[0].cases=[
   {id:'value-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Required actual export3 accepts the expected claim',consumerPaths:['consumer.cjs'],input:{literalUtf8:'3',fixturePaths:[]},expected:{kind:'return',value:'3'}},
   {id:'value-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Actual export3 rejects the contradictory claim4',consumerPaths:['consumer.cjs'],input:{literalUtf8:'4',fixturePaths:[]},expected:{kind:'rejection',value:'3'}}];
  if(role==='challenger')result.alternatives=['Reuse existing literal export'];
  if(role==='adjudicator'){result.decisions=[];if(body.context.stage==='planning-adjudication'){result.planAccepted=true;result.acceptedPlan=body.context.planProposal;}}
  if(role==='implementer'&&turn===0)tool={name:'write',args:{path:'consumer.cjs',content:'module.exports=3;\n'}};
  if(role==='reviewer'){
   result.outcome='clear';if(turn===0){result.findings=[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'F1 retained before direct human reviewer question',evidence:['candidate:consumer.cjs']}];held=true;}
   else{const actual=context.messages.filter(message=>message.role==='user').map(message=>typeof message.content==='string'?message.content:message.content.filter(v=>v.type==='text').map(v=>v.text).join(''));sawDirect=actual.includes(cfg.question);sameNative=c.getNativeHandle(reviewerId)?.session===registration.session;result.summary='Received direct owner reviewer question on actual native session';releaseParent();}
  }
  applyCurrentVerificationFixture(result,body.context);
  reply=JSON.stringify(result);
  if(role==='reviewer'&&turn===0){registration=c.listConversations().map(v=>c.getNativeHandle(v.conversationId)).find(value=>value&&value.identity.launchId&&c.inspectConversation(value.identity.conversationId).label.startsWith('reviewer'));reviewerId=registration.identity.conversationId;reviewerEntered();}
 }else{held=true;parentEntered();}
 const stream=createAssistantMessageEventStream();let finished=false;const finish=(aborted=false)=>{if(finished)return;finished=true;const message={role:'assistant',content:aborted?[]:tool?[{type:'toolCall',id:'call-'+Math.random(),name:tool.name,arguments:tool.args}]:[{type:'text',text:reply}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:aborted?'aborted':tool?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end(message);};
 if(held){if(text.startsWith('Perform the assigned reviewer'))releaseReviewer=()=>finish();else releaseParent=()=>finish();opts.signal.addEventListener('abort',()=>finish(true),{once:true});}else queueMicrotask(()=>finish());return stream;
}}};
let receipt;try{
 await c.registerProject({id:'P',sourceRoot:cfg.source});const begun=await c.beginChange({projectId:'P',request:'Set consumer export3 and verify actual check'});parentId=c.createConversation({projectId:null}).conversationId;
 await c.planChange({workId:begun.workId,model});await c.implementChange({workId:begun.workId,model});await c.checkChange({workId:begun.workId});
 const epoch=c.inspectWork(begun.workId).epoch;
 const unsubscribe=c.subscribeInteraction(event=>{if(event.conversationId===parentId&&event.type==='cleanup')parentClean();});
 const background=(async()=>{
  await parentReady;const reviewTask=c.reviewChange({workId:begun.workId,model});await reviewerReady;
  c.setConversationParent({childId:reviewerId,parentId,expectedRevision:c.inspectConversation(reviewerId).relationRevision});assert.equal(c.inspectConversation(reviewerId).parentId,parentId);phase='reviewer-ready';control();
  await until(()=>c.store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND text=? AND state='NATIVE_PENDING'",reviewerId,cfg.question),'actual native pending direct input');releaseReviewer();
  await parentCleaned;focusStayed=selected===reviewerId;assert.equal(focusStayed,true,'Background parent completion must not steal focus');phase='parent-completed';control();
  await until(()=>selected===parentId,'human return to parent selection');const reviewed=await reviewTask;
  const input=c.store.one('SELECT * FROM conversation_inputs WHERE conversation=? AND text=?',reviewerId,cfg.question),f1=reviewed.occurrences.filter(o=>o.data.finding?.description==='F1 retained before direct human reviewer question');
  assert.equal(input.state,'CONSUMED');assert.ok(sawDirect&&sameNative);assert.equal(f1.length,1);assert.equal(reviewed.reviewReady,false);assert.ok(c.changeCore.pending(begun.workId).some(o=>o.kind==='finding'));assert.ok(c.interactionCore.impacts(begun.workId).some(i=>i.data.effectHold));
  receipt={workId:begun.workId,parentId,reviewerId,nativeSessionId:registration.sessionManager.getSessionId(),sameNative,sawDirect,focusStayed,input:{id:input.id,text:input.text,state:input.state},f1Occurrences:f1.map(o=>o.id),reviewReady:false,sourceHold:true,selections,epoch,actualChecks:reviewed.checks.map(check=>check.status),actualContainerRuntime:cfg.runtimeProfile,externalCalls:0,humanImeAcceptance:false};phase='complete';control();
 })();
 // Observe immediately; the original failure is rethrown after normal UI leave and close.
 void background.catch(error=>{phase='failed';writeFileSync(cfg.control+'.tmp',JSON.stringify({phase,error:String(error),selected,parentId,reviewerId}));renameSync(cfg.control+'.tmp',cfg.control);});
 await startConversationUI({controller:c,model,conversationId:parentId,onViewCacheState:value=>{selected=value.selectedConversationId;if(selections.at(-1)!==selected)selections.push(selected);control();}});await background;unsubscribe();receipt.workCancelled=c.inspectWork(begun.workId).state==='CANCELLED';receipt.epochAfter=c.inspectWork(begun.workId).epoch;assert.equal(receipt.workCancelled,false);assert.equal(receipt.epochAfter,epoch);await fs.writeFile(cfg.receipt,JSON.stringify(receipt));
}finally{await c.close();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {coordination} from '../../dist/controller/coordination.js';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {subject} from './merge-controller-fixture.mjs';

// Actual public Pi SDK/native actor/root activation/tool/alias/budget/native
// merge are exercised. Successful software procedures and prior branch delivery
// remain EXPLICIT CONTROLLED premises, not installed workflow qualification.
test('actual SDK coordinator uses its captured separate merge grant and discovers the native original result', {timeout:30000},async t=>{
 const f=await subject(t),oldTmp=process.env.TMPDIR;await f.c.close();
 const configs=[{projectId:'P',targetId:f.targetId,operationLimit:1,notifications:'allow-merge-notifications'}];
 let c=await openController({installationHome:f.home,mergeDelegations:configs,interactionDelegation:{projectIds:['P'],maxAssignments:2}});t.after(()=>c.close());
 configureOwnedMergeFixture(c,{token:'owned-native-merge-only',origin:f.native.origin,limits:{requestTimeoutMs:2000}});
 process.env.TMPDIR=path.join(f.home,'artifacts');t.after(()=>{if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;});
 const cid=c.createConversation().conversationId,provider='merge-sdk-'+randomUUID(),api='merge-sdk-api-'+randomUUID();let action=async()=>({text:'Retained original owner root'}),identity,child,queued,result,calls=0;
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const model={provider,modelId:'fixture',definition:{api,apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:20000}],streamSimple(m,context){const stream=createAssistantMessageEventStream();queueMicrotask(async()=>{try{calls++;identity={...c.getNativeHandle(cid).identity};const next=await action(context),message={role:'assistant',content:next.tool?[{type:'toolCall',id:randomUUID(),name:next.tool.name,arguments:next.tool.arguments}]:[{type:'text',text:next.text}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:next.tool?'toolUse':'stop',timestamp:Date.now()};stream.push({type:'done',reason:message.stopReason,message});stream.end(message);}catch(error){const message={role:'assistant',content:[],api:m.api,provider:m.provider,model:m.id,usage,stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:message});stream.end(message);}});return stream;}}};
 async function turn(text){await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text,mode:'idle'});const observed=await c.runConversation({conversationId:cid,model});assert.equal(observed.status,'delivered',JSON.stringify(observed));await c.ordinaryCore.drain();return observed;}
 const root=await turn('Owner explicitly permits one existing PR merge under the configured original finite grant');
 const grant=c.store.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',root.workId,f.targetId);assert.ok(grant);assert.equal(JSON.parse(grant.data).scope,'delegation-lineage');assert.equal(JSON.parse(c.store.one('SELECT data FROM works WHERE id=?',root.workId).data).ownerRootActivation.state,'COMPLETE');
 const resultRows=context=>context.messages.filter(message=>message.role==='toolResult').flatMap(message=>message.content.filter(value=>value.type==='text').map(value=>{try{return JSON.parse(value.text);}catch{return null;}})).filter(Boolean);
 let emitted=false;
 action=async context=>{
  if(emitted){queued=resultRows(context).findLast(row=>row.state==='QUEUED'&&row.operationId);assert.ok(queued,'Actual SDK merge result supplies original operation handle');return {text:'Original merge queued; native result not yet claimed'};}
  emitted=true;
  const controls=coordination({store:c.store,interactions:c.interactionCore,identity,entry(){c.entry(identity.runId);},delegation:JSON.parse(c.store.one('SELECT data FROM works WHERE id=?',root.workId).data).delegation,modelMode:{kind:'explicit',provider,modelId:'fixture'},launch(){},onWait(){}});
  const assignment=controls.assign({projectId:'P',instructions:'Controlled previously reviewed publication premise for native merge admission',operation:'change'}),row=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignment.assignmentId),data=JSON.parse(row.data);
  child=await c.changes.begin({projectId:'P',request:'Controlled previously reviewed publication premise for native merge admission'},{kind:'agent-governed-assignment',actor:data.source,delegationRoot:root.workId,sourceEvent:data.instructionsSource,conversationId:row.target,assignmentId:row.id});
  c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?','COMPLETE',row.id);c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',child.workId,row.target);
  const evidence={workId:child.workId,epoch:1,generation:1,versions:{candidate:'CONTROLLED-SDK-CANDIDATE'},fingerprint:'CONTROLLED-'+child.workId};
  c.changes.currentEvidence=async work=>{assert.equal(work,child.workId);return structuredClone(evidence);};c.changes.assertCurrentEvidence=value=>assert.deepEqual(value,evidence,'Only explicit controlled current software premise');
  const old=c.store.one('SELECT * FROM effect_operations WHERE id=?',f.branchOperationId),operation=randomUUID(),branchGrant=randomUUID();c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',branchGrant,root.workId,old.target,1,JSON.stringify({kind:'github-existing-ref',mode:'ordinary',scope:'delegation-lineage',operationLimit:1,rootEpoch:1,projectId:'P'}));c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',operation,child.workId,old.target,branchGrant,'CONFIRMED',JSON.stringify({...JSON.parse(old.data),evidence,reviewedAssignmentId:row.id}));
  return {tool:{name:'conversation_merge',arguments:{reviewedAssignmentId:row.id,targetId:f.targetId,branchOperationId:operation}}};
 };
 await turn('Use the controlled reviewed assignment/publication to exercise the real SDK merge entry');assert.ok(queued);assert.equal(f.native.puts(),1);assert.equal(c.inspectMerge(queued.operationId).phase,'CONFIRMED');
 emitted=false;action=async context=>{if(!emitted){emitted=true;return {tool:{name:'effect_inspect',arguments:{operationId:queued.operationId}}};}result=resultRows(context).findLast(row=>row.operationId===queued.operationId&&row.phase);assert.equal(result.phase,'CONFIRMED');return {text:'Actual original merge confirmation observed through the SDK'};};
 await turn('Inspect the original native merge result without another transmission');assert.equal(result.mergedCommit,await f.native.head());assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',grant.id).n,1);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM budgets WHERE reserved!=0').n,0);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')").n,0);assert.equal(f.native.puts(),1);assert.equal(calls,5);
 // A future process profile cannot issue another action grant on this original
 // root. It is selected for new roots; old spent authority remains historical.
 await c.close();c=await openController({installationHome:f.home,effectDelegations:[{projectId:'P',targetId:f.registration.sourceBranchTargetId,operationLimit:1}]});
 action=async()=>({text:'Existing root observes its original result without new authority'});await turn('Continue the original conversation after changing only future startup defaults');
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_delegations WHERE root=? AND target=?',root.workId,f.registration.sourceBranchTargetId).n,1,'Retain the controlled original publication grant without adding or resetting authority');
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',grant.id).n,1);assert.equal(f.native.puts(),1);assert.equal(calls,6);f.native.pass();
});

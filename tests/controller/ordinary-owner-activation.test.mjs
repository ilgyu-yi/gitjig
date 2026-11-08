import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';

// Actual unbound Pi SDK admissions; recorded target descriptors isolate startup
// authority. No project execution, native Git send or procedure standing claimed.
async function world(t) {
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ordinary-owner-activation-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'input.txt'),'original');
 const oldTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');t.after(()=>{if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;});
 let c=await openController({installationHome:home});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'P',sourceRoot:source});
 for(const target of ['a','b'])c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',target,'P',JSON.stringify({kind:'local-git',target:{targetId:target,canonicalPath:path.join(root,'recorded-'+target),device:'1',inode:target==='a'?'10':'11',ownerUid:process.getuid(),objectFormat:'sha1',ref:'refs/heads/main'},ownerUid:process.getuid(),basisCommit:'a'.repeat(40),publicationInventory:['input.txt'],authorizedDeltaPaths:['input.txt']}));
 let calls=0;const provider='activation-'+randomUUID(),api='activation-api-'+randomUUID(),usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const model={provider,modelId:'fixture',definition:{api,apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:2000}],streamSimple(m){calls++;const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:'Observed original owner conversation'}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:'stop',timestamp:Date.now()};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};
 const config=targets=>targets.map(targetId=>({projectId:'P',targetId,operationLimit:2}));
 async function reopen(targets){await c.close();c=await openController({installationHome:home,effectDelegations:config(targets)});}
 async function input(cid){await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text:'Original owner request',mode:'idle'});}
 async function run(cid){const result=await c.runConversation({conversationId:cid,model});assert.equal(result.status,'delivered',JSON.stringify({result,observations:c.store.all('SELECT data FROM observations WHERE run=?',result.runId)}));await c.ordinaryCore.drain();return result;}
 async function turn(cid){await input(cid);return run(cid);}
 return {model,get c(){return c;},get calls(){return calls;},reopen,input,run,turn};
}
const snapshot=c=>Object.fromEntries(['works','requirements','sources','budgets','runs','effect_delegations','conversation_inputs','conversations','conversation_state'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
const grants=(c,root)=>c.store.all('SELECT * FROM effect_delegations WHERE root=? ORDER BY rowid',root);

test('actual SDK ordinary startup captures authority, preserves old and legacy roots, and rolls back failed admission',async t=>{
 const f=await world(t);
 {
 const cid=f.c.createConversation().conversationId,original=await f.turn(cid);
 assert.deepEqual({...f.c.inspectWork(original.workId).allowance},{limit:32,consumed:1,reserved:0});
 assert.equal(f.c.inspectWorkAllowance(original.workId).resolution.limit,8);
 // Historical limit premise: retained databases are not migrated to the new default.
 f.c.store.run("UPDATE budgets SET lim=8 WHERE lineage=? AND kind='execution'",original.workId);
 await f.reopen([]);await f.turn(cid);
 assert.equal(f.c.inspectConversation(cid).workId,original.workId);
 assert.deepEqual({...f.c.inspectWork(original.workId).allowance},{limit:8,consumed:2,reserved:0});
 const fresh=f.c.createConversation().conversationId,next=await f.turn(fresh);
 assert.deepEqual({...f.c.inspectWork(next.workId).allowance},{limit:32,consumed:1,reserved:0});
 }
 const priorCalls=f.calls;
 {
 const cid=f.c.createConversation().conversationId,original=await f.turn(cid);
 const activation=JSON.parse(f.c.store.one('SELECT data FROM works WHERE id=?',original.workId).data).ownerRootActivation;assert.equal(activation.state,'COMPLETE');assert.deepEqual(activation.profile.integrations,[]);
 await f.reopen(['a']);await f.turn(cid);assert.deepEqual(grants(f.c,original.workId),[]);
 const fresh=f.c.createConversation().conversationId,result=await f.turn(fresh);assert.deepEqual(grants(f.c,result.workId).map(row=>row.target),['a']);const originalGrant=grants(f.c,result.workId);
 await f.reopen(['b']);await f.turn(fresh);assert.deepEqual(grants(f.c,result.workId),originalGrant);assert.equal(f.calls,priorCalls+4);
 }
 {
await f.reopen(['a']);const cid=f.c.createConversation().conversationId,result=await f.turn(cid),original=grants(f.c,result.workId);
 // Explicit legacy-schema premise: remove only the activation record.
 const work=f.c.store.one('SELECT data FROM works WHERE id=?',result.workId),data=JSON.parse(work.data);delete data.ownerRootActivation;f.c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify(data),result.workId);
 await f.reopen(['b']);await f.turn(cid);assert.deepEqual(grants(f.c,result.workId),original);assert.equal(f.calls,priorCalls+6);
 }
 {
await f.reopen(['a','b']);const cid=f.c.createConversation().conversationId;await f.input(cid);const before=snapshot(f.c),run=f.c.store.run.bind(f.c.store);let writes=0;
 f.c.store.run=(sql,...args)=>{const result=run(sql,...args);if(sql.startsWith('INSERT INTO effect_delegations')&&++writes===2)throw Error('Injected second grant failure');return result;};
 try{await assert.rejects(f.c.runConversation({conversationId:cid,model:f.model}),/Injected second grant failure/);}finally{f.c.store.run=run;}
 assert.equal(writes,2);assert.deepEqual(snapshot(f.c),before);assert.equal(f.calls,priorCalls+6);assert.equal(f.c.inspectConversation(cid).workId,null);
 // Reopen explicitly; this check concerns durable rollback, not resetting the
 // publication helper's conservative in-memory admission latch.
 await f.reopen(['a','b']);const result=await f.run(cid);assert.deepEqual(grants(f.c,result.workId).map(row=>row.target),['a','b']);assert.equal(f.calls,priorCalls+7);
 }
});

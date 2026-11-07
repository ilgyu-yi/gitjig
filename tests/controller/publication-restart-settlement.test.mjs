import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
let root,sequence=0,allPassed=true;const originalTmp=process.env.TMPDIR;
after(async()=>{if(originalTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmp;if(root&&allPassed)await fs.rm(root,{recursive:true,force:true});});
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
async function world(t){
    root??=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-pub-restart-')));const home=path.join(root,'home');let c=await openController({installationHome:home}),passed=false,receipt,calls=0;
    t.after(async()=>{await c.close();if(!passed){allPassed=false;t.diagnostic('Retained publication restart fixture '+root);}});
    process.env.TMPDIR=path.join(home,'artifacts');
    const target=c.registerPublicationTarget({target:{host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7},visibility:'public'});
    c.configurePublicationDelegations([{targetId:target.targetId,actions:['create-issue'],operationLimit:2}]);const parent=c.createConversation().conversationId,id=++sequence;
    // Original native publication allocation and result callbacks. Only the external
    // outcome is controlled; this test sends no HTTP, uses no engine or paid model.
    c.ordinary.h.launchEffect=async assignmentId=>{const a=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',assignmentId),data=JSON.parse(a.data);c.store.run("UPDATE effect_operations SET phase='CONFIRMED' WHERE id=?",data.effectOperationId);receipt={assignmentId,operationId:data.effectOperationId,conversationId:a.target};return c.inspectPublication(data.effectOperationId);};
    const model={provider:'pub-restart-'+id,modelId:'fixture',definition:{apiKey:'UNUSED',baseUrl:'http://unused.invalid',api:'pub-restart-api-'+id,models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(m){const s=createAssistantMessageEventStream(),call=++calls===1,message={role:'assistant',content:call?[{type:'toolCall',id:'pub-call-'+id,name:'conversation_publish',arguments:{targetId:target.targetId,action:{kind:'create-issue',title:'Owned crash-window fixture',body:'Controlled outcome; never sent'}}}]:[{type:'text',text:'Controlled publication allocated.'}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:call?'toolUse':'stop',timestamp:Date.now()};queueMicrotask(()=>{s.push({type:'done',reason:message.stopReason,message});s.end(message);});return s;}}};
    await c.queueConversationInput({conversationId:parent,expectedGeneration:0,text:'Create owned fixture issue',mode:'idle'});assert.equal((await c.runConversation({conversationId:parent,model})).status,'delivered');await c.ordinary.drain();assert.ok(receipt);
    const rows=()=>c.store.all("SELECT * FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",receipt.assignmentId);
    assert.equal(c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',receipt.assignmentId).state,'RESOLVED');
    // Persist the exact crash window after operation confirmation, before the
    // ordinary callback stores/publishes its assignment completion.
    const a=c.store.one('SELECT data FROM conversation_assignments WHERE id=?',receipt.assignmentId),data=JSON.parse(a.data);delete data.result;delete data.resultId;
    c.store.run("UPDATE conversation_assignments SET state='RUNNING',data=? WHERE id=?",JSON.stringify(data),receipt.assignmentId);c.store.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation=?",receipt.conversationId);
    c.store.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",receipt.assignmentId);c.store.run("DELETE FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",receipt.assignmentId);c.store.run("DELETE FROM conversation_notifications WHERE json_extract(data,'$.assignmentId')=?",receipt.assignmentId);
    return {get c(){return c;},parent,receipt,rows,get assignment(){return c.store.one('SELECT * FROM conversation_assignments WHERE id=?',receipt.assignmentId);},get dependency(){return c.store.one('SELECT * FROM conversation_dependencies WHERE assignment=?',receipt.assignmentId);},async reopen(){await c.close();c=await openController({installationHome:home});},pass(){passed=true;}};
}

test('restart atomically recovers a confirmed native publication result and resolves its parent wait',async t=>{
    const f=await world(t),before=f.c.store.all('SELECT * FROM budgets');await f.reopen();const data=JSON.parse(f.assignment.data);
    assert.equal(f.assignment.state,'COMPLETE');assert.equal(f.dependency.state,'RESOLVED');assert.equal(f.rows().length,1);assert.equal(data.resultId,f.rows()[0].id);
    const published=JSON.parse(f.rows()[0].data);assert.equal(published.assignmentId,f.receipt.assignmentId);assert.equal(published.result.operationId,f.receipt.operationId);assert.equal(published.result.phase,'CONFIRMED');assert.deepEqual(f.c.store.all('SELECT * FROM budgets'),before);
    await f.c.archiveConversation({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});f.pass();
});
for(const phase of ['UNKNOWN','REFUSED'])test(`restart publication ${phase} leaves its parent result dependency pending`,async t=>{
    const f=await world(t);f.c.store.run('UPDATE effect_operations SET phase=? WHERE id=?',phase,f.receipt.operationId);await f.reopen();
    assert.equal(f.assignment.state,'UNAVAILABLE');assert.equal(f.dependency.state,'PENDING');assert.equal(JSON.parse(f.assignment.data).result.phase,phase);assert.equal(f.c.inspectConversation(f.receipt.conversationId).state,phase==='UNKNOWN'?'UNKNOWN':'IDLE');f.pass();
});
test('restart publication recovery preserves explicit cancellation',async t=>{
    const f=await world(t);f.c.store.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?",f.receipt.assignmentId);f.c.store.run("UPDATE conversation_dependencies SET state='CANCELLED' WHERE assignment=?",f.receipt.assignmentId);await f.reopen();
    assert.equal(f.assignment.state,'CANCELLED');assert.equal(f.dependency.state,'CANCELLED');assert.equal(f.rows().length,0);f.pass();
});
test('restart publication recovery leaves another assignment dependency untouched',async t=>{
    const f=await world(t),other=f.c.createConversation().conversationId;f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','other-'+sequence,f.parent,other,null,'PENDING','{}');await f.reopen();
    assert.equal(f.dependency.state,'RESOLVED');assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE id=?','other-'+sequence).state,'PENDING');f.pass();
});
for(const mismatch of ['operation','work','target'])test(`restart publication recovery refuses mismatched alias ${mismatch}`,async t=>{
    const f=await world(t);if(mismatch==='operation'){const data=JSON.parse(f.assignment.data);data.effectOperationId='different-operation';f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),f.receipt.assignmentId);}
    if(mismatch==='work'){const other=f.c.store.one('SELECT id FROM works WHERE id!=? LIMIT 1',f.assignment.work);assert.ok(other);f.c.store.run('UPDATE conversation_assignments SET work=? WHERE id=?',other.id,f.receipt.assignmentId);}
    if(mismatch==='target'){const other=f.c.createConversation().conversationId;f.c.store.run('UPDATE conversation_assignments SET target=? WHERE id=?',other,f.receipt.assignmentId);}
    await f.reopen();assert.equal(f.assignment.state,'RUNNING');assert.equal(f.dependency.state,'PENDING');assert.equal(f.rows().length,0);f.pass();
});
test('publication recovery rolls back accepted publication when settlement persistence fails',async t=>{
    const f=await world(t),run=f.c.store.run.bind(f.c.store);let failed=false;
    f.c.store.run=(sql,...args)=>{const result=run(sql,...args);if(!failed&&sql.startsWith('INSERT INTO conversation_results')){failed=true;throw Error('OWNED_RECOVERY_PUBLICATION_FAILURE');}return result;};
    assert.throws(()=>f.c.publicationEngine.recoverAssignmentResults(),/OWNED_RECOVERY_PUBLICATION_FAILURE/);f.c.store.run=run;
    assert.equal(failed,true);assert.equal(f.assignment.state,'RUNNING');assert.equal(f.dependency.state,'PENDING');assert.equal(f.rows().length,0);assert.equal(JSON.parse(f.assignment.data).resultId,undefined);f.pass();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {structuredAssignmentWorld} from '../controller/structured-assignment-fixture.mjs';
import {scripted} from '../controller/effect-fixture.mjs';
import {inspectConversationResultDetail} from '../../dist/controller/conversation-results.js';
import {prepareGovernedResult,readGovernedDetail} from '../../dist/controller/governed-result.js';

test('actual ordinary public Pi reads original governed detail pages under current captured scope',async t=>{
    const f=await structuredAssignmentWorld(t),c=f.c;
    f.onGoverned((_child,result)=>{Object.assign(result,{blocked:['Retained 한국어🙂 blocker'],nextAction:'Inspect original evidence',launches:[{id:'old',data:{context:'한국어🙂'.repeat(2000)}}]});});await f.assign();
    const a=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),data=JSON.parse(a.data),original=JSON.parse(await (await import('../../dist/controller/governed-result.js')).readGovernedDetail(f.home,data.result.detailRef));
    let collected='',cursor=0,seen=0;
    const model=scripted((context,turn)=>{
        if(turn){const response=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='conversation_result').at(-1);assert.equal(response.isError,false);const page=JSON.parse(response.content.find(item=>item.type==='text').text);assert.equal(page.kind,'governed-work-detail-page/v1');assert.ok(Buffer.byteLength(JSON.stringify(page))<=8192);collected+=page.text;cursor=page.nextCursor;seen++;if(cursor===null)return{text:'Original immutable detail was read.'};}
        return{tool:{name:'conversation_result',arguments:{resultId:data.resultId,...data.result.detailRead,cursor}}};
    });model.provider='detail-'+randomUUID();model.definition.api='detail-api-'+randomUUID();
    await c.queueConversationInput({conversationId:f.parent,expectedGeneration:c.inspectConversation(f.parent).generation,text:'Read only the exact original retained result detail',mode:'idle'});
    const result=await c.runConversation({conversationId:f.parent,model});assert.equal(result.status,'delivered');assert.ok(seen>1);assert.deepEqual(JSON.parse(collected),original);
    const reader={identity:data.source,delegation:{rootWorkId:data.delegationRoot,projectIds:['P'],maxAssignments:8}};
    await assert.rejects(inspectConversationResultDetail(c.store,f.home,{resultId:data.resultId,cursor:0,fingerprint:'0'.repeat(64)},reader),/fingerprint/);
    await assert.rejects(inspectConversationResultDetail(c.store,f.home,{resultId:data.resultId,cursor:0,fingerprint:data.result.detailRef.sha256},{...reader,identity:{...reader.identity,conversationId:f.child.conversationId+'-foreign'}}),/scope/);
    f.pass();
});

test('original detail reader rechecks authority after IO and refuses forged raw row binding',async t=>{
    const f=await structuredAssignmentWorld(t),c=f.c;await f.assign();const a=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),data=JSON.parse(a.data);
    let guards=0;await assert.rejects(inspectConversationResultDetail(c.store,f.home,{resultId:data.resultId,cursor:0,fingerprint:data.result.detailRef.sha256},undefined,()=>{if(++guards===4)throw Error('Captured scope changed');}),/Captured scope changed/);
    const row=c.store.one('SELECT * FROM conversation_results WHERE id=?',data.resultId),publication=JSON.parse(row.data);publication.workId='other-work';c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(publication),row.id);
    await assert.rejects(inspectConversationResultDetail(c.store,f.home,{resultId:row.id,cursor:0,fingerprint:data.result.detailRef.sha256}),/reference unavailable/);c.store.run('UPDATE conversation_results SET data=? WHERE id=?',row.data,row.id);f.pass();
});

test('another valid same-work/epoch snapshot cannot be swapped under the original publication identity',async t=>{
    const f=await structuredAssignmentWorld(t),c=f.c;await f.assign();const a=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),data=JSON.parse(a.data);
    const row=c.store.one('SELECT * FROM conversation_results WHERE id=?',data.resultId),original=JSON.parse(row.data),full=JSON.parse(await readGovernedDetail(f.home,original.result.detailRef));
    const later=await prepareGovernedResult(f.home,{...full,nextAction:'A different later historical observation'},()=>{}),changed=JSON.parse(row.data);
    changed.result.detailRef=later.detailRef;changed.result.detailRead={...later.detailRead};
    c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(changed),row.id);
    try{await assert.rejects(c.inspectConversationResultDetail({resultId:row.id,cursor:0,fingerprint:later.detailRef.sha256}),/publication integrity unavailable/);}
    finally{c.store.run('UPDATE conversation_results SET data=? WHERE id=?',row.data,row.id);}
    assert.deepEqual(JSON.parse(await readGovernedDetail(f.home,original.result.detailRef)),full);f.pass();
});

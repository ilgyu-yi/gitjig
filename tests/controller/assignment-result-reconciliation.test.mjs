import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredAssignmentWorld as world} from './structured-assignment-fixture.mjs';

const assignment=(f,id)=>f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',id);
const dependency=(f,id)=>f.c.store.one('SELECT * FROM conversation_dependencies WHERE assignment=?',id);
const reclaim=f=>f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});
function legacy(f,id){
    const row=assignment(f,id),data=JSON.parse(row.data);delete data.resultId;
    f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);
    f.c.store.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",id);
    return data;
}
for(const family of ['governed','effect'])test(`explicit reclaim reconciles an accepted legacy ${family} publication without rerunning its producer`,async t=>{
    const f=await world(t);await f.assign();if(family==='effect')await f.integrate();
    const id=family==='effect'?f.effect.assignmentId:f.child.assignmentId;legacy(f,id);
    const before=f.c.store.all('SELECT * FROM works'),runs=f.c.store.all('SELECT * FROM runs'),results=f.c.store.all('SELECT * FROM conversation_results');
    await reclaim(f);assert.equal(dependency(f,id).state,'RESOLVED');assert.equal(assignment(f,id).state,'COMPLETE');
    assert.deepEqual(f.c.store.all('SELECT * FROM works'),before);assert.deepEqual(f.c.store.all('SELECT * FROM runs'),runs);assert.deepEqual(f.c.store.all('SELECT * FROM conversation_results'),results);f.pass();
});

for(const mutation of ['missing-publication','forged-publication','forged-source','wrong-recipient','wrong-result-pointer','changed-epoch'])test(`legacy governed reclaim preserves the hold with ${mutation}`,async t=>{
    const f=await world(t);await f.assign();const id=f.child.assignmentId,data=legacy(f,id);
    const publication=f.c.store.one("SELECT * FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);
    if(mutation==='missing-publication')f.c.store.run('DELETE FROM conversation_results WHERE id=?',publication.id);
    if(mutation==='forged-publication'){const value=JSON.parse(publication.data);value.publicationHash='forged';f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(value),publication.id);}
    if(mutation==='wrong-recipient'){const value=JSON.parse(publication.data);value.audience=value.audience.filter(item=>item.conversationId!==f.parent);f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(value),publication.id);}
    if(mutation==='forged-source'){data.source.runId='forged-run';f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);const dep=dependency(f,id),value=JSON.parse(dep.data);value.source=data.source;f.c.store.run('UPDATE conversation_dependencies SET data=? WHERE id=?',JSON.stringify(value),dep.id);}
    if(mutation==='wrong-result-pointer'){data.resultId='result-forged';f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);}
    if(mutation==='changed-epoch')f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.child.workId);
    await assert.rejects(reclaim(f),/LIFECYCLE_HELD/);assert.equal(dependency(f,id).state,'PENDING');assert.equal(assignment(f,id).state,'COMPLETE');f.pass();
});

test('legacy confirmed publication requires the actual operation still be CONFIRMED',async t=>{
    const f=await world(t);await f.assign();await f.integrate();const id=f.effect.assignmentId;legacy(f,id);
    f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",f.effect.operationId);
    await assert.rejects(reclaim(f),/LIFECYCLE_HELD/);assert.equal(dependency(f,id).state,'PENDING');f.pass();
});

test('a separate lifecycle hold rolls back legacy dependency reconciliation',async t=>{
    const f=await world(t);await f.assign();const id=f.child.assignmentId;legacy(f,id);
    await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Retained independent input',mode:'idle'});
    await assert.rejects(reclaim(f),/LIFECYCLE_HELD/);assert.equal(dependency(f,id).state,'PENDING');f.pass();
});

for(const resource of ['WAITING','UNKNOWN'])test(`resource ${resource} rolls back legacy dependency reconciliation`,async t=>{
    const f=await world(t);await f.assign();const id=f.child.assignmentId;legacy(f,id);
    f.c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?',resource,f.parent);
    await assert.rejects(reclaim(f),/LIFECYCLE_HELD/);assert.equal(dependency(f,id).state,'PENDING');
    assert.equal(f.c.inspectConversation(f.parent).state,resource);f.pass();
});

test('explicit owner cancellation withdraws false COMPLETE with no publication and retains its prior label',async t=>{
    const f=await world(t);await f.assign();const id=f.child.assignmentId,data=legacy(f,id);
    f.c.store.run("DELETE FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);
    await assert.rejects(reclaim(f),/LIFECYCLE_HELD/);
    await f.c.cancelWork({workId:f.child.workId});
    const after=assignment(f,id);assert.equal(after.state,'CANCELLED');assert.equal(JSON.parse(after.data).cancellationPreviousState,'COMPLETE');assert.deepEqual(JSON.parse(after.data).result,data.result);
    assert.equal(dependency(f,id).state,'CANCELLED');await reclaim(f);f.pass();
});

test('owner cancellation preserves already resolved COMPLETE assignment history',async t=>{
    const f=await world(t);await f.assign();const id=f.child.assignmentId,before=assignment(f,id);
    await f.c.cancelWork({workId:f.child.workId});assert.deepEqual(assignment(f,id),before);assert.equal(dependency(f,id).state,'RESOLVED');f.pass();
});

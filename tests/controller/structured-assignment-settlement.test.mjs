import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredAssignmentWorld as world} from './structured-assignment-fixture.mjs';

const row=(f,id)=>f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',id);
const dependency=(f,id)=>f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state;
const results=(f,id)=>f.c.store.all("SELECT * FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);

test('accepted governed completion publishes one bound result and resolves its pending parent wait',async t=>{
    const f=await world(t);assert.equal((await f.assign()).status,'delivered');
    const assignment=row(f,f.child.assignmentId),data=JSON.parse(assignment.data);
    assert.equal(assignment.state,'COMPLETE');assert.equal(dependency(f,assignment.id),'RESOLVED');assert.equal(results(f,assignment.id).length,1);
    assert.equal(data.resultId,results(f,assignment.id)[0].id);
    await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});f.pass();
});

test('accepted confirmed effect publishes one bound result and resolves only its own pending wait',async t=>{
    const f=await world(t);await f.assign();assert.equal((await f.integrate()).status,'delivered');
    const assignment=row(f,f.effect.assignmentId),data=JSON.parse(assignment.data);
    assert.equal(assignment.state,'COMPLETE');assert.equal(dependency(f,assignment.id),'RESOLVED');assert.equal(results(f,assignment.id).length,1);
    assert.equal(data.resultId,results(f,assignment.id)[0].id);assert.equal(dependency(f,f.child.assignmentId),'RESOLVED');
    await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});f.pass();
});

for(const family of ['governed','effect'])test(`${family} publication failure rolls back accepted result and leaves an unavailable pending task`,async t=>{
    const f=await world(t);if(family==='effect')await f.assign();
    const publish=f.c.ordinary.publishResult.bind(f.c.ordinary);let failed=false;
    f.c.ordinary.publishResult=(cid,id,result)=>{
        const resultId=publish(cid,id,result);
        if(!failed&&(family==='governed'?result.reviewReady===true:result.phase==='CONFIRMED')){failed=true;throw Error('OWNED_FAILURE_AFTER_PUBLICATION');}
        return resultId;
    };
    await(family==='governed'?f.assign():f.integrate());const id=family==='governed'?f.child.assignmentId:f.effect.assignmentId;
    assert.equal(failed,true);assert.equal(row(f,id).state,'UNAVAILABLE');assert.equal(dependency(f,id),'PENDING');
    for(const result of results(f,id)) {const value=JSON.parse(result.data).result;assert.notEqual(value.reviewReady,true);assert.notEqual(value.phase,'CONFIRMED');}
    f.pass();
});

for(const phase of ['REFUSED','UNKNOWN'])test(`effect ${phase} retains its unresolved dependency`,async t=>{
    const f=await world(t);await f.assign();f.onEffect((_effect,result)=>{result.phase=phase;});await f.integrate();
    assert.equal(row(f,f.effect.assignmentId).state,'UNAVAILABLE');assert.equal(dependency(f,f.effect.assignmentId),'PENDING');
    assert.equal(f.c.inspectConversation(f.effect.conversationId).state,phase==='UNKNOWN'?'UNKNOWN':'IDLE');f.pass();
});

for(const retained of ['UNKNOWN','INVOKING','work-UNKNOWN'])test(`a nonconfirmed effect result preserves retained ${retained} uncertainty`,async t=>{
    const f=await world(t);await f.assign();f.onEffect((effect,result)=>{
        result.phase='REFUSED';
        if(retained==='work-UNKNOWN')f.c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",effect.workId);
        return retained==='work-UNKNOWN'?'REFUSED':retained;
    });await f.integrate();
    assert.equal(row(f,f.effect.assignmentId).state,'UNAVAILABLE');assert.equal(dependency(f,f.effect.assignmentId),'PENDING');
    assert.equal(f.c.inspectConversation(f.effect.conversationId).state,'UNKNOWN');f.pass();
});

test('late cancelled governed completion cannot resurrect its assignment or parent dependency',async t=>{
    const f=await world(t);f.onGoverned(async child=>{await f.c.cancelAssignment({assignmentId:child.assignmentId,reason:'Owned cancel before controlled result'});});
    await f.assign();assert.equal(row(f,f.child.assignmentId).state,'CANCELLED');assert.equal(dependency(f,f.child.assignmentId),'CANCELLED');assert.equal(results(f,f.child.assignmentId).length,0);f.pass();
});

test('an effect alias rebound to a later source cannot be overwritten by an old completion',async t=>{
    const f=await world(t);await f.assign();f.onEffect(effect=>{const assignment=row(f,effect.assignmentId),data=JSON.parse(assignment.data);data.source={...data.source,runId:'later-owned-run'};f.c.store.run("UPDATE conversation_assignments SET state='QUEUED',data=? WHERE id=?",JSON.stringify(data),assignment.id);});
    await f.integrate();assert.equal(row(f,f.effect.assignmentId).state,'QUEUED');assert.equal(dependency(f,f.effect.assignmentId),'PENDING');assert.equal(results(f,f.effect.assignmentId).length,0);f.pass();
});

test('unavailable governed outcome retains its unresolved parent wait',async t=>{
    const f=await world(t);f.onGoverned((_child,result)=>{result.reviewReady=false;result.phase='BLOCKED';});await f.assign();
    assert.equal(row(f,f.child.assignmentId).state,'UNAVAILABLE');assert.equal(dependency(f,f.child.assignmentId),'PENDING');assert.equal(results(f,f.child.assignmentId).length,1);f.pass();
});

test('an effect result for a different subject cannot complete the original alias',async t=>{
    const f=await world(t);await f.assign();f.onEffect((_effect,result)=>{result.workId='different-owned-subject';});await f.integrate();
    assert.equal(row(f,f.effect.assignmentId).state,'UNAVAILABLE');assert.equal(dependency(f,f.effect.assignmentId),'PENDING');
    assert.match(JSON.parse(row(f,f.effect.assignmentId).data).error,/correspondence changed/);f.pass();
});

test('permanently unavailable effect publication records failure without completion or a running orphan',async t=>{
    const f=await world(t);await f.assign();f.expectBackgroundFailure();
    const original=f.c.ordinary.publishResult.bind(f.c.ordinary);
    f.c.ordinary.publishResult=(cid,id,result)=>{if(id===f.effect?.assignmentId)throw Error('OWNED_PERMANENT_PUBLICATION_FAILURE');return original(cid,id,result);};
    await assert.rejects(f.integrate(),/Ordinary background settlement failed/);
    const assignment=row(f,f.effect.assignmentId);
    assert.equal(assignment.state,'UNAVAILABLE');assert.equal(dependency(f,assignment.id),'PENDING');assert.equal(results(f,assignment.id).length,0);
    assert.match(JSON.parse(assignment.data).resultPublicationError,/OWNED_PERMANENT_PUBLICATION_FAILURE/);f.pass();
});

test('unknown effect publication failure preserves operation uncertainty on the alias',async t=>{
    const f=await world(t);await f.assign();f.onEffect((_effect,result)=>{result.phase='UNKNOWN';});
    const publish=f.c.ordinary.publishResult.bind(f.c.ordinary);let failed=false;
    f.c.ordinary.publishResult=(cid,id,result)=>{const resultId=publish(cid,id,result);if(!failed&&result.phase==='UNKNOWN'){failed=true;throw Error('OWNED_UNKNOWN_PUBLICATION_FAILURE');}return resultId;};
    await f.integrate();assert.equal(failed,true);assert.equal(row(f,f.effect.assignmentId).state,'UNAVAILABLE');assert.equal(dependency(f,f.effect.assignmentId),'PENDING');
    assert.equal(f.c.inspectConversation(f.effect.conversationId).state,'UNKNOWN');f.pass();
});

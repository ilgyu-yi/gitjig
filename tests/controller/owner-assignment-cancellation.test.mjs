import test from 'node:test';
import assert from 'node:assert/strict';
import {coordination} from '../../dist/controller/coordination.js';
import {inspectAssignedWorkObligations} from '../../dist/controller/assigned-work-provenance.js';
import {ownerAssignmentCancellationWorld as world,cancellationLedger} from './owner-assignment-cancellation-fixture.mjs';

test('explicit owner cancellation clears the exact unavailable task wait and permits only the parent project transition',async t=>{
    const f=await world(t),before=cancellationLedger(f.s),oldEpoch=f.c.inspectWork(f.child.work).epoch;
    await assert.rejects(f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:0}),/LIFECYCLE_HELD.*dependency/);
    const grandchild=await f.assign('WAITING',{...f.actor,conversationId:f.child.target,workId:f.child.work,runId:f.s.one('SELECT id FROM runs WHERE work=?',f.child.work).id});
    const budgets=f.s.all('SELECT * FROM budgets ORDER BY rowid');
    await f.c.cancelWork({workId:f.child.work,expectedEpoch:oldEpoch});
    for(const item of [f.child,grandchild]) {
        assert.equal(f.s.one('SELECT state FROM works WHERE id=?',item.work).state,'CANCELLED');
        assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',item.assignment).state,'CANCELLED');
        assert.equal(f.s.one('SELECT state FROM conversation_dependencies WHERE id=?',item.dependency).state,'CANCELLED');
    }
    assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.parentWork),before.works.find(row=>row.id===f.parentWork));
    assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),before.works.find(row=>row.id===f.sibling.work));
    assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.sibling.assignment),before.conversation_assignments.find(row=>row.id===f.sibling.assignment));
    assert.deepEqual(f.s.all('SELECT * FROM budgets ORDER BY rowid'),budgets);
    const event=f.s.one('SELECT origin FROM sources WHERE id=json_extract((SELECT data FROM conversation_assignments WHERE id=?),\'$.cancellationSource\')',f.child.assignment);
    assert.equal(JSON.parse(event.origin).requestedWork.id,f.child.work);
    await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:0});
    f.c.setConversationProject({conversationId:f.parent,expectedGeneration:0,projectId:'Q'});
    assert.equal(f.c.inspectConversation(f.parent).projectId,'Q');assert.equal(f.c.inspectConversation(f.child.target).projectId,'P');
    f.pass();
});

for(const damage of ['dependency target','assignment target','original work source kind','original work source identity','instruction actor'])
test(`contradictory ${damage} refuses owner cancellation atomically`,async t=>{
    const f=await world(t);
    if(damage==='dependency target')f.s.run('UPDATE conversation_dependencies SET target=? WHERE id=?',f.sibling.target,f.child.dependency);
    if(damage==='assignment target')f.s.run('UPDATE conversation_assignments SET target=? WHERE id=?',f.sibling.target,f.child.assignment);
    if(damage.startsWith('original work source')){
        const source=f.s.one('SELECT source FROM works WHERE id=?',f.child.work),origin=JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?',source.source).origin);
        if(damage==='original work source kind')origin.kind='owner-host-invocation';else origin.assignmentId=f.sibling.assignment;
        f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(origin),source.source);
    }
    if(damage==='instruction actor'){
        const origin=JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?',f.child.instruction).origin);origin.actor.workId=f.sibling.work;
        f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(origin),f.child.instruction);
    }
    const before=cancellationLedger(f.s);
    await assert.rejects(f.c.cancelWork({workId:f.child.work,expectedEpoch:1}),/assigned-task cancellation correspondence/);
    assert.deepEqual(cancellationLedger(f.s),before);f.pass();
});

test('stale work epoch and unscoped internal cancellation cannot cancel an incoming parent obligation',async t=>{
    const f=await world(t),before=cancellationLedger(f.s);
    await assert.rejects(f.c.cancelWork({workId:f.child.work,expectedEpoch:2}),/epoch changed/);
    assert.deepEqual(cancellationLedger(f.s),before);
    await f.c.cancelHandle({workId:f.child.work});
    assert.equal(f.s.one('SELECT state FROM conversation_dependencies WHERE id=?',f.child.dependency).state,'PENDING');
    assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignment).state,'UNAVAILABLE');f.pass();
});

test('completed incoming records and effect aliases remain outside the new task-only cancellation seed',async t=>{
    const f=await world(t),historical=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.sibling.assignment);
    assert.deepEqual(inspectAssignedWorkObligations(f.s,f.sibling.work),[]);
    const data=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.child.assignment).data);
    f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...data,operation:'effect-prepare'}),f.child.assignment);
    assert.deepEqual(inspectAssignedWorkObligations(f.s,f.child.work),[]);
    assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.sibling.assignment),historical);f.pass();
});

for(const corrupt of [false,true])test(`same-task reentry by another permitted coordinator ${corrupt?'refuses corrupted provenance':'cancels both actual recorded waits'}`,async t=>{
    const f=await world(t),other={...f.actor,conversationId:f.sibling.target,workId:f.sibling.work,runId:f.s.one('SELECT id FROM runs WHERE work=?',f.sibling.work).id};
    const control=coordination({store:f.s,interactions:f.c.interactions,identity:other,entry(){},delegation:{projectIds:['P'],maxAssignments:8,rootWorkId:f.parentWork},launch(){},onWait(){}});
    const accepted=control.assign({conversationId:f.child.target,observedDirectionRevision:0,projectId:'P',instructions:'Same original task from another permitted coordinator',operation:'change',resultDependency:true});
    assert.equal(accepted.assignmentId,f.child.assignment);
    const dependencies=f.s.all("SELECT * FROM conversation_dependencies WHERE assignment=? AND state='PENDING'",f.child.assignment);assert.equal(dependencies.length,2);
    if(corrupt){const data=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.child.assignment).data),reentry=data.reentries[0],event=JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?',reentry.source).origin);event.originalWork=f.sibling.work;f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(event),reentry.source);}
    const before=cancellationLedger(f.s);
    if(corrupt){await assert.rejects(f.c.cancelWork({workId:f.child.work,expectedEpoch:1}),/assigned-task cancellation correspondence/);assert.deepEqual(cancellationLedger(f.s),before);}
    else{await f.c.cancelWork({workId:f.child.work,expectedEpoch:1});assert.equal(f.s.one("SELECT COUNT(*) n FROM conversation_dependencies WHERE assignment=? AND state='CANCELLED'",f.child.assignment).n,2);assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),before.works.find(row=>row.id===f.sibling.work));}
    f.pass();
});


test('owner cancellation also closes an unfinished original assignment without a result dependency',async t=>{
    const f=await world(t);
    // Settle the fixture's first task, then create the same supported assignment
    // profile without requesting a result wait. Its assignment still owns a hold.
    await f.c.cancelWork({workId:f.child.work,expectedEpoch:1});
    const task=await f.assign('RUNNING',f.actor,false),before=cancellationLedger(f.s);
    assert.equal(f.s.one('SELECT COUNT(*) n FROM conversation_dependencies WHERE assignment=?',task.assignment).n,0);
    await assert.rejects(f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:0}),/LIFECYCLE_HELD.*assignment/);
    await f.c.cancelWork({workId:task.work,expectedEpoch:1});
    assert.equal(f.s.one('SELECT state FROM works WHERE id=?',task.work).state,'CANCELLED');
    assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',task.assignment).state,'CANCELLED');
    assert.equal(f.s.one('SELECT COUNT(*) n FROM conversation_dependencies WHERE assignment=?',task.assignment).n,0);
    assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.parentWork),before.works.find(row=>row.id===f.parentWork));
    assert.deepEqual(f.s.one('SELECT * FROM works WHERE id=?',f.sibling.work),before.works.find(row=>row.id===f.sibling.work));
    assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.sibling.assignment),before.conversation_assignments.find(row=>row.id===f.sibling.assignment));
    assert.deepEqual(f.s.all('SELECT * FROM budgets ORDER BY rowid'),before.budgets);
    await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:0});
    f.c.setConversationProject({conversationId:f.parent,expectedGeneration:0,projectId:'Q'});
    assert.equal(f.c.inspectConversation(f.parent).projectId,'Q');assert.equal(f.c.inspectConversation(task.target).projectId,'P');f.pass();
});

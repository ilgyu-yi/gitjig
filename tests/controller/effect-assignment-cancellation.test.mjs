import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredAssignmentWorld as world} from './structured-assignment-fixture.mjs';

const ledger=s=>Object.fromEntries(['works','sources','budgets','conversation_assignments','conversation_dependencies','conversation_state','effect_operations','effect_receipts'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for(const phase of ['PREPARED','CONFIRMED','INVOKING','UNKNOWN'])test(`cancelling original subject withdraws native alias without hiding ${phase} outcome`,async t=>{
    const f=await world(t);await f.assign();
    f.onEffect(async(effect,result)=>{
        const s=f.c.store;
        s.run('UPDATE effect_operations SET phase=? WHERE id=?',phase,effect.operationId);
        f.c.effects.receipt(effect.operationId,'owned-audit-record',{original:true});
        const op=s.one('SELECT * FROM effect_operations WHERE id=?',effect.operationId),receipts=s.all('SELECT * FROM effect_receipts WHERE operation=?',effect.operationId),budgets=s.all('SELECT * FROM budgets ORDER BY rowid');
        const parent=s.one('SELECT * FROM works WHERE id=?',f.c.inspectConversation(f.parent).workId);
        await f.c.cancelWork({workId:f.child.workId,expectedEpoch:f.c.inspectWork(f.child.workId).epoch});
        assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',effect.assignmentId).state,'CANCELLED');
        assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',effect.assignmentId).state,'CANCELLED');
        assert.equal(s.one('SELECT resource FROM conversation_state WHERE conversation=?',effect.conversationId).resource,['UNKNOWN','INVOKING'].includes(phase)?'UNKNOWN':'IDLE');
        assert.deepEqual(s.one('SELECT * FROM works WHERE id=?',parent.id),parent);assert.deepEqual(s.all('SELECT * FROM budgets ORDER BY rowid'),budgets);
        assert.deepEqual(s.all('SELECT * FROM effect_receipts WHERE operation=?',effect.operationId),receipts);
        if(phase==='CONFIRMED')assert.deepEqual(s.one('SELECT * FROM effect_operations WHERE id=?',effect.operationId),op);
        else assert.equal(s.one('SELECT phase FROM effect_operations WHERE id=?',effect.operationId).phase,['UNKNOWN','INVOKING'].includes(phase)?'UNKNOWN':'REFUSED');
        result.phase=s.one('SELECT phase FROM effect_operations WHERE id=?',effect.operationId).phase;
    });
    assert.equal((await f.integrate()).status,'delivered');
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.effect.assignmentId).state,'CANCELLED');
    if(['UNKNOWN','INVOKING'].includes(phase))await assert.rejects(f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation}),/LIFECYCLE_HELD.*effect/);
    else await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});
    f.pass();
});

for(const damage of ['origin missing','dependency actor run','dependency actor work','operation target','operation work'])test(`contradictory alias ${damage} refuses cancellation atomically`,async t=>{
    const f=await world(t);await f.assign();
    f.onEffect(async(effect,result)=>{
        const s=f.c.store;
        if(damage==='origin missing'||damage==='operation target'){
            const data=JSON.parse(s.one('SELECT data FROM effect_operations WHERE id=?',effect.operationId).data);
            if(damage==='origin missing')delete data.origin;else data.conversationId=f.parent;
            s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify(data),effect.operationId);
        }else if(damage==='operation work')s.run('UPDATE effect_operations SET work=? WHERE id=?',f.c.inspectConversation(f.parent).workId,effect.operationId);
        else{
            const dep=s.one('SELECT id,data FROM conversation_dependencies WHERE assignment=?',effect.assignmentId),data=JSON.parse(dep.data);
            if(damage.endsWith('run'))data.source.runId='other-run';else data.source.workId=f.child.workId;
            s.run('UPDATE conversation_dependencies SET data=? WHERE id=?',JSON.stringify(data),dep.id);
        }
        const before=ledger(s);await assert.rejects(f.c.cancelWork({workId:f.child.workId,expectedEpoch:1}),/native-task correspondence/);assert.deepEqual(ledger(s),before);
        // Do not publish a fabricated successful outcome from damaged fixture data.
        result.phase='REFUSED';
    });
    await f.integrate();f.pass();
});

for(const [operation,kind]of [['effect-publication','publication'],['effect-merge','github-merge']])test(`original-work cancellation includes retained ${operation} metadata`,async t=>{
    const f=await world(t);await f.assign();
    f.onEffect(async(effect,result)=>{
        const s=f.c.store,a=s.one('SELECT data FROM conversation_assignments WHERE id=?',effect.assignmentId),op=s.one('SELECT data FROM effect_operations WHERE id=?',effect.operationId);
        // Retained family metadata is controlled; allocation above is original.
        s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...JSON.parse(a.data),operation}),effect.assignmentId);
        s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...JSON.parse(op.data),kind}),effect.operationId);
        await f.c.cancelWork({workId:f.child.workId,expectedEpoch:1});
        assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',effect.assignmentId).state,'CANCELLED');
        assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',effect.assignmentId).state,'CANCELLED');
        assert.equal(s.one('SELECT phase FROM effect_operations WHERE id=?',effect.operationId).phase,'REFUSED');result.phase='REFUSED';
    });
    await f.integrate();f.pass();
});

test('explicit owner cancellation withdraws a legacy COMPLETE alias with no accepted publication, preserving confirmed operation history',async t=>{
    const f=await world(t);await f.assign();await f.integrate();const s=f.c.store,id=f.effect.assignmentId;
    const data=JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?',id).data);delete data.resultId;
    s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);
    s.run("DELETE FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);
    s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",id);
    const op=s.one('SELECT * FROM effect_operations WHERE id=?',f.effect.operationId),receipts=s.all('SELECT * FROM effect_receipts WHERE operation=?',f.effect.operationId);
    await f.c.cancelWork({workId:f.child.workId,expectedEpoch:1});
    const alias=s.one('SELECT state,data FROM conversation_assignments WHERE id=?',id);
    assert.equal(alias.state,'CANCELLED');assert.equal(JSON.parse(alias.data).cancellationPreviousState,'COMPLETE');
    assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state,'CANCELLED');
    assert.equal(s.one("SELECT COUNT(*) n FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id).n,0);
    assert.deepEqual(s.one('SELECT * FROM effect_operations WHERE id=?',f.effect.operationId),op);
    assert.deepEqual(s.all('SELECT * FROM effect_receipts WHERE operation=?',f.effect.operationId),receipts);
    await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});f.pass();
});

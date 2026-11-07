import test from 'node:test';import assert from 'node:assert/strict';
import {structuredAssignmentWorld as world} from './structured-assignment-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
import {settleRecoveredEffectAssignment} from '../../dist/controller/effect-assignment-settlement.js';
const assignment=(c,id)=>c.store.one('SELECT * FROM conversation_assignments WHERE id=?',id);
const dependency=(c,id)=>c.store.one('SELECT * FROM conversation_dependencies WHERE assignment=?',id);
const results=(c,id)=>c.store.all("SELECT * FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);
async function crashWorld(t){
    const f=await world(t);await f.assign();await f.integrate();const s=f.c.store,id=f.effect.assignmentId,data=JSON.parse(assignment(f.c,id).data);delete data.result;delete data.resultId;
    s.run("UPDATE conversation_assignments SET state='RUNNING',data=? WHERE id=?",JSON.stringify(data),id);s.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation=?",f.effect.conversationId);s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",id);
    s.run("DELETE FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?",id);s.run("DELETE FROM conversation_notifications WHERE json_extract(data,'$.assignmentId')=?",id);
    let reopened;t.after(()=>reopened?.close());return{f,id,async reopen(){await f.c.close();reopened=await openController({installationHome:f.home});return reopened;}};
}
for(const family of ['local-git','legacy-local','github-existing-ref','github-merge'])test(`restart publishes one retained confirmed ${family} alias without executing a producer`,async t=>{
    const x=await crashWorld(t),{f,id}=x,s=f.c.store;
    if(family!=='local-git'){
        // Local native allocation above is real. These additional profiles control
        // only persisted known-family premises and exercise their real readonly inspector.
        const op=s.one('SELECT * FROM effect_operations WHERE id=?',f.effect.operationId),metadata=JSON.parse(op.data),target=s.one('SELECT data FROM effect_targets WHERE id=?',op.target),td=JSON.parse(target.data);
        metadata.kind=family;td.kind=family;
        if(family==='legacy-local'){delete metadata.kind;delete td.kind;}
        if(family==='github-merge'){
            const repository={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo'};
            td.repository=repository;td.identity={target:repository,baseRef:'main'};td.target={...repository,ref:'refs/heads/main'};
            const a=JSON.parse(assignment(f.c,id).data);a.operation='effect-merge';s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(a),id);
            metadata.headCommit='a'.repeat(40);metadata.mergedCommit='b'.repeat(40);metadata.transportOutcome='native-success';metadata.correspondence={controlled:true};
        }
        s.run('UPDATE effect_targets SET data=? WHERE id=?',JSON.stringify(td),op.target);s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify(metadata),op.id);
    }
    const budgets=s.all('SELECT * FROM budgets'),runs=s.all('SELECT * FROM runs');const c=await x.reopen(),a=assignment(c,id),data=JSON.parse(a.data);
    assert.equal(a.state,'COMPLETE');assert.equal(dependency(c,id).state,'RESOLVED');assert.equal(results(c,id).length,1);assert.equal(data.resultId,results(c,id)[0].id);assert.equal(data.result.operationId,f.effect.operationId);
    assert.deepEqual(c.store.all('SELECT * FROM budgets'),budgets);assert.deepEqual(c.store.all('SELECT * FROM runs'),runs);
    const before=JSON.stringify(c.store.all('SELECT * FROM conversation_results'));c.effects.recover();assert.equal(JSON.stringify(c.store.all('SELECT * FROM conversation_results')),before);assert.equal(results(c,id).length,1);f.pass();
});
for(const state of ['CANCELLED','UNKNOWN'])test(`confirmed effect recovery does not complete an old active alias on ${state} subject`,async t=>{
    const x=await crashWorld(t),{f,id}=x;f.c.store.run('UPDATE works SET state=? WHERE id=?',state,f.child.workId);if(state==='UNKNOWN')f.c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",f.effect.conversationId);
    const c=await x.reopen();assert.equal(assignment(c,id).state,'RUNNING');assert.equal(dependency(c,id).state,'PENDING');assert.equal(results(c,id).length,0);assert.equal(c.inspectWork(f.child.workId).state,state);if(state==='UNKNOWN')assert.equal(c.inspectConversation(f.effect.conversationId).state,'UNKNOWN');f.pass();
});
for(const mismatch of ['cancelled-alias','source','operation','unknown-operation'])test(`confirmed effect recovery preserves ${mismatch} hold`,async t=>{
    const x=await crashWorld(t),{f,id}=x,s=f.c.store;
    if(mismatch==='cancelled-alias'){s.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?",id);s.run("UPDATE conversation_dependencies SET state='CANCELLED' WHERE assignment=?",id);}
    if(mismatch==='source'||mismatch==='operation'){const data=JSON.parse(assignment(f.c,id).data);if(mismatch==='source')data.source.runId='different-old-run';else data.effectOperationId='different-operation';s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);}
    if(mismatch==='unknown-operation')s.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",f.effect.operationId);
    const c=await x.reopen();assert.equal(assignment(c,id).state,mismatch==='cancelled-alias'?'CANCELLED':'RUNNING');assert.equal(dependency(c,id).state,mismatch==='cancelled-alias'?'CANCELLED':'PENDING');assert.equal(results(c,id).length,0);f.pass();
});
test('another operation cannot settle a valid alias selected only by forged reverse metadata',async t=>{
    const x=await crashWorld(t),{f,id}=x,s=f.c.store,op=s.one('SELECT * FROM effect_operations WHERE id=?',f.effect.operationId),metadata=JSON.parse(op.data),other='other-'+id;
    s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',other,op.work,op.target,op.grant_id,'CONFIRMED',JSON.stringify(metadata));
    assert.equal(settleRecoveredEffectAssignment(s,other,{operationId:other,workId:op.work,phase:'CONFIRMED'}),false);
    assert.equal(assignment(f.c,id).state,'RUNNING');assert.equal(dependency(f.c,id).state,'PENDING');assert.equal(results(f.c,id).length,0);f.pass();
});
for(const mismatch of ['family','false-confirmed'])test(`shared recovery rejects ${mismatch} before publication`,async t=>{
    const x=await crashWorld(t),{f,id}=x,s=f.c.store;
    if(mismatch==='family'){const data=JSON.parse(assignment(f.c,id).data);data.operation='effect-merge';s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);}
    else s.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",f.effect.operationId);
    assert.equal(settleRecoveredEffectAssignment(s,f.effect.operationId,{operationId:f.effect.operationId,workId:f.child.workId,phase:'CONFIRMED'}),false);
    assert.equal(assignment(f.c,id).state,'RUNNING');assert.equal(dependency(f.c,id).state,'PENDING');assert.equal(results(f.c,id).length,0);f.pass();
});

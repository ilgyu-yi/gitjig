import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../../dist/controller/store.js';
import {inspectConversationWait} from '../../dist/controller/conversation-progress.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';

test('actual coordinator corrects a conversation ID refusal using the returned assignment wait operands', async t => {
    let attempts = 0, native;
    const f = await failedWaitWorld(t, {automatic:false, resultDependency:false, waitArguments({context, assignments, controller, parent}) {
        assert.equal(assignments.length, 1);
        const assignment = assignments[0];
        assert.equal(assignment.accepted, true);
        assert.notEqual(assignment.assignmentId, assignment.conversationId);
        assert.deepEqual(assignment.wait, {resultHandles:[assignment.assignmentId]});
        assert.equal(controller.inspectConversation(parent).state, 'RUNNING');
        assert.equal(controller.inspectConversationWait(parent), undefined);
        if (attempts++ === 0) {
            native = controller.interactions.getHandle(parent);
            assert.ok(native);
            return {resultHandles:[assignment.conversationId]};
        }
        assert.equal(controller.interactions.getHandle(parent), native, 'Refusal must not quiesce or replace the original native handle');
        const refusal = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'conversation_wait').at(-1);
        assert.equal(refusal.isError, true);
        const text = refusal.content.filter(part => part.type === 'text').map(part => part.text).join('');
        assert.match(text, /Unknown result handle outside this coordinator/);
        assert.match(text, /assignmentId.*conversationId.*No wait was admitted/);
        return assignment.wait;
    }});
    assert.equal(attempts, 2);
    const wait = f.c.inspectConversationWait(f.parent);
    assert.equal(wait.targets.length, 1);
    assert.equal(wait.targets[0].assignmentId, f.children[0].assignmentId);
    assert.equal(wait.targets[0].conversationId, f.children[0].conversationId);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM conversation_assignments').n, 1);
    await f.settle();
    f.pass();
});

test('recorded wait projection follows exact handles and separate ordinal domains without ledger writes', async t => {
    const root = await temporaryDirectory('wait-projection'), s = new Store(path.join(root, 'state.sqlite'));
    let passed = false;
    t.after(async () => { s.close(); if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained '+root); });
    s.run("INSERT INTO sources VALUES('S',NULL,'{}','request')");
    s.run("INSERT INTO works VALUES('W',NULL,'S',NULL,'W','ACTIVE',3,5,NULL,'{}')");
    for (const cid of ['C', 'A', 'B', 'X']) {
        s.run("INSERT INTO conversations VALUES(?,NULL,NULL,?,'{}')", cid, cid === 'C' ? 7 : 0);
        s.run("INSERT INTO conversation_state(conversation,data) VALUES(?,'{}')", cid);
    }
    const actor = {conversationId:'C',workId:'W',runId:'R',launchId:null,generation:7,directionRevision:11,initialInputId:'I'};
    const data = {runId:'R',sourceIdentity:actor,continuationAuthorized:true,waitHandles:['a']};
    const run = {kind:'ordinary-conversation',conversation:'C',initialInputId:'I'};
    s.run("INSERT INTO conversation_inputs VALUES('I','C',7,'W','S','CONSUMED','idle','request','{}')");
    s.run("INSERT INTO runs VALUES('R','W',3,5,'RUNNING',?,'consumed',?)", root, JSON.stringify(run));
    s.run("UPDATE conversation_state SET work='W',resource='WAITING',direction=11,data=? WHERE conversation='C'",JSON.stringify(data));
    for (const [aid,cid] of [['a','A'],['b','B']]) s.run("INSERT INTO conversation_assignments VALUES(?,'C',?,NULL,'QUEUED','{}')",aid,cid);
    s.run("INSERT INTO conversation_dependencies VALUES('dep-b','C','B','b','PENDING','{}')");
    const read = () => inspectConversationWait(s, 'C');
    const snapshot = () => JSON.stringify(s.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,s.all('SELECT * FROM '+name+' ORDER BY rowid')]));
    const before = snapshot();
    assert.deepEqual(read(),{conversationId:'C',workId:'W',runId:'R',generation:7,directionRevision:11,targets:[{assignmentId:'a',conversationId:'A',workId:null,state:'QUEUED'}],omitted:0});
    assert.equal(snapshot(),before);
    s.run("UPDATE conversation_assignments SET source_conversation='X' WHERE id='a'"); assert.equal(read(),undefined);
    s.run("INSERT INTO conversation_dependencies VALUES('dep-a','C','B','a','PENDING','{}')"); assert.equal(read(),undefined);
    s.run("UPDATE conversation_dependencies SET target='A' WHERE id='dep-a'"); assert.equal(read().targets[0].assignmentId,'a');
    s.run("DELETE FROM conversation_dependencies WHERE id='dep-a'"); s.run("UPDATE conversation_assignments SET source_conversation='C' WHERE id='a'");
    for (const change of [
        {continuationAuthorized:false}, {runId:'missing'}, {lifecycle:{deleted:true}}, {waitHandles:['a','a']}, {waitHandles:['a',{}]},
        {waitHandles:Array.from({length:65},(_,i)=>'h'+i)}, {sourceIdentity:{...actor,generation:5}}, {sourceIdentity:{...actor,directionRevision:10}},
    ]) { s.run("UPDATE conversation_state SET data=? WHERE conversation='C'",JSON.stringify({...data,...change})); assert.equal(read(),undefined); }
    for (const raw of [JSON.stringify(data).replace('{','{"runId":"duplicate",'),JSON.stringify({...data,padding:'x'.repeat(65536)})]) {
        s.run("UPDATE conversation_state SET data=? WHERE conversation='C'",raw); assert.equal(read(),undefined);
    }
    s.run("UPDATE conversation_state SET data=? WHERE conversation='C'",JSON.stringify(data));
    for (const [sql,undo] of [
        ["UPDATE runs SET generation=7","UPDATE runs SET generation=5"],
        ["UPDATE works SET epoch=4","UPDATE works SET epoch=3"],
        ["UPDATE conversation_inputs SET generation=5","UPDATE conversation_inputs SET generation=7"],
        ["UPDATE conversation_state SET resource='SETTLING' WHERE conversation='C'","UPDATE conversation_state SET resource='WAITING' WHERE conversation='C'"],
        ["UPDATE conversation_state SET work='W' WHERE conversation='A'","UPDATE conversation_state SET work=NULL WHERE conversation='A'"],
    ]) { s.run(sql); assert.equal(read(),undefined); s.run(undo); }
    for(const raw of ['[]','{',JSON.stringify({lifecycle:{deleted:true}}),
        '{"lifecycle":{"deleted":false},"lifecycle":{"deleted":true}}',
        '{"lifecycle":{"deleted":true},"lifecycle":{"deleted":false}}',
        '{"lifecycle":{"deleted":false,"deleted":true}}',
        JSON.stringify({padding:'x'.repeat(65536)})]) {
        s.run("UPDATE conversation_state SET data=? WHERE conversation='A'",raw);assert.equal(read(),undefined);
    }
    s.run("UPDATE conversation_state SET data='{}' WHERE conversation='A'");
    const handles=[];
    for(let i=0;i<64;i++) {
        const cid='T'+i, aid='h'+i; handles.push(aid);
        s.run("INSERT INTO conversations VALUES(?,NULL,NULL,0,'{}')",cid); s.run("INSERT INTO conversation_state(conversation,data) VALUES(?,'{}')",cid);
        s.run("INSERT INTO conversation_assignments VALUES(?,'C',?,NULL,'QUEUED','{}')",aid,cid);
    }
    s.run("UPDATE conversation_state SET data=? WHERE conversation='C'",JSON.stringify({...data,waitHandles:handles}));
    assert.equal(read().targets.length,8); assert.equal(read().omitted,56);
    s.run("UPDATE conversation_assignments SET state='INVALID' WHERE id='h63'");assert.equal(read(),undefined,'The final undisplayed handle must also be valid');
    s.run("UPDATE conversation_assignments SET state='QUEUED' WHERE id='h63'");
    s.run('UPDATE conversation_state SET data=? WHERE conversation=?','{"lifecycle":{"deleted":false},"lifecycle":{"deleted":true}}','T63');
    assert.equal(read(),undefined,'Ambiguous target metadata beyond the displayed list invalidates the projection');
    s.run("UPDATE conversation_state SET data='{}' WHERE conversation='T63'");
    s.run("UPDATE conversation_assignments SET state='INVALID' WHERE id='h8'"); assert.equal(read(),undefined,'The undisplayed ninth handle must also be valid');
    passed=true;
});

for (const resultDependency of [false,true]) test(`actual accepted WAIT projects its original target, dependency=${resultDependency}`,async t=>{
    const f=await failedWaitWorld(t,{automatic:false,resultDependency});
    const child=f.children[0];
    // This controlled dispatch allocates a real work before its publication;
    // mirror production's work binding while its fake governed body is gated.
    f.c.store.run('UPDATE conversation_assignments SET work=? WHERE id=?',child.workId,child.assignmentId);
    const before=JSON.stringify(f.c.store.all('SELECT * FROM conversation_state ORDER BY rowid'));
    const wait=f.c.inspectConversationWait(f.parent);
    assert.ok(wait); assert.deepEqual(wait.targets,[{assignmentId:child.assignmentId,conversationId:child.conversationId,workId:child.workId,state:'RUNNING'}]);
    assert.equal(JSON.stringify(f.c.store.all('SELECT * FROM conversation_state ORDER BY rowid')),before);
    if(!resultDependency)assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_dependencies WHERE waiting=?',f.parent).n,0);
    await f.settle();f.pass();
});

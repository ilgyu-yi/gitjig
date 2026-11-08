// Controlled accepted WAIT and governed dispatch, never a Native/account/engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {failedWaitWorld} from '../controller/original-failed-wait-fixture.mjs';
import {startConversationUI} from '../../dist/ui/index.js';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
test('owned waiting screen',async t=>{
    const f=await failedWaitWorld(t,{automatic:false,resultDependency:false,retainRoot:true}),child=f.children[0];
    f.c.store.run('UPDATE conversation_assignments SET work=? WHERE id=?',child.workId,child.assignmentId);
    f.c.setConversationLanguage({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,expectedRevision:0,replyLanguage:config.locale});
    f.c.setConversationLanguage({conversationId:child.conversationId,expectedGeneration:f.c.inspectConversation(child.conversationId).generation,expectedRevision:0,replyLanguage:'en'});
    f.c.setDraft({conversationId:f.parent,expectedRevision:0,text:'Retained 한글 draft'});
    if (config.unconfirmed)
        f.c.store.run("UPDATE works SET state='QUARANTINED' WHERE id=?", f.c.inspectConversation(f.parent).workId);
    if (config.roleStage) {
        // Use normal role allocation. The optional live notice is a controlled
        // read projection, while the terminal remains forbidden from executing.
        const role = config.roleStage === 'planning-adjudication' ? 'adjudicator' : 'reviewer';
        const actor = f.c.interactions.allocateRole({workId:child.workId, runId:'display-only-run',
            launchId:'display-only-launch', role, stage:config.roleStage});
        assert.equal(f.c.inspectConversation(actor.conversationId).roleStage,config.roleStage);
        if (config.providerReport) {
            f.c.store.run("UPDATE conversation_state SET resource='RUNNING' WHERE conversation=?",actor.conversationId);
            const getHandle=f.c.getNativeHandle.bind(f.c);
            f.c.getNativeHandle=id=>id===actor.conversationId ? {identity:actor,
                providerActivity:{kind:'retry',attempt:2,maxAttempts:5,delayMs:1000}} : getHandle(id);
        }
    }
    const quiesce=f.c.quiesceInteractionHost.bind(f.c);
    f.c.quiesceInteractionHost=()=>{quiesce();f.release();}; // Join only the owned fake governed body on actual UI shutdown.
    fs.writeFileSync(config.ready,JSON.stringify({parent:f.parent,target:child.conversationId,work:child.workId}));
    const counts=()=>Object.fromEntries(['runs','conversation_inputs','conversations'].map(table=>[table,f.c.store.one('SELECT COUNT(*) AS n FROM '+table).n]));
    const before=counts();
    await import('./navigation-no-execution.mjs');
    try {await startConversationUI({controller:f.c,model:f.model,conversationId:f.parent});}
    finally {await f.settle();}
    assert.equal(f.c.inspectConversation(f.parent).draft.text,'Retained 한글 draft');
    assert.deepEqual(counts(),before);
    fs.writeFileSync(config.receipt,JSON.stringify({draft:f.c.inspectConversation(f.parent).draft.text,counts:before,noAdditionalWork:true}));
    f.pass();
});

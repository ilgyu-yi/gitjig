import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';

test('a cleanly refused manual action is handled without claiming success or blocking later history work', {timeout:10000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-failed-manual-'));
    let passed=false;
    const home = path.join(root,'home'); let c = await openController({installationHome:home});
    const priorTmp = process.env.TMPDIR; process.env.TMPDIR=path.join(home,'artifacts');
    let calls=0;
    const model={provider:'failed-manual-fixture',modelId:'fixture',definition:{api:'failed-manual-api',apiKey:'no-network',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1000}],streamSimple(m){calls++;const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'text',text:'Short current branch.'}],api:m.api,provider:m.provider,model:m.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};
    try {
        const id=c.createConversation().conversationId;
        await c.queueConversationInput({conversationId:id,expectedGeneration:0,text:'Short history',mode:'idle'});
        assert.equal((await c.runConversation({conversationId:id,model})).status,'delivered');
        const view=c.inspectConversation(id), history=await c.getConversationHistory(id);
        const bytes=await fs.readFile(view.historyRef), hash=createHash('sha256').update(bytes).digest('hex');
        const refused=await c.compactConversation({conversationId:id,expectedGeneration:view.generation,model});
        assert.equal(refused.status,'unavailable'); assert.match(refused.failure,/Nothing to compact/);
        assert.equal(calls,1,'An ineligible small branch does not dispatch a summary model');
        const run=c.inspectWork(refused.workId).runs.at(-1), inputId=run.data.initialInputId;
        const state={home,id,work:refused.workId,run:run.id,input:inputId,historyRef:view.historyRef,historyHash:hash,source:c.store.one('SELECT source FROM conversation_inputs WHERE id=?',inputId).source};
        await fs.writeFile(path.join(root,'identity.json'),JSON.stringify(state));
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CONSUMED','A settled failed attempt is handled, not left INITIAL_RESERVED');
        assert.deepEqual({...c.inspectWork(refused.workId).allowance},{limit:32,consumed:2,reserved:0});
        assert.equal(createHash('sha256').update(await fs.readFile(view.historyRef)).digest('hex'),hash);
        // A retained failed manual request can remain INITIAL_RESERVED.
        const inputBefore=c.store.one('SELECT * FROM conversation_inputs WHERE id=?',inputId);
        c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','INITIAL_RESERVED',inputId);
        await c.queueConversationInput({conversationId:id,expectedGeneration:c.inspectConversation(id).generation,text:'A later ordinary direction',mode:'idle'});
        assert.equal((await c.runConversation({conversationId:id,model})).status,'delivered');
        const queued=await c.queueConversationInput({conversationId:id,expectedGeneration:c.inspectConversation(id).generation,text:'Keep this later input pending',mode:'idle'});
        const laterGeneration=c.inspectConversation(id).generation;
        await c.close(); c=await openController({installationHome:home});
        assert.equal(c.inspectConversation(id).generation,laterGeneration);
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',queued.inputId).state,'QUEUED');
        assert.deepEqual({...c.inspectWork(refused.workId).allowance},{limit:32,consumed:3,reserved:0});
        const settledRun=c.store.one('SELECT * FROM runs WHERE id=?',run.id);
        for (const bad of [{phase:'UNKNOWN'},{phase:'INTERRUPTED'},{data:{cleanup:'quarantined'}},{data:{outcome:'interrupted'}}]) {
            c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','INITIAL_RESERVED',inputId);
            c.store.run('UPDATE runs SET phase=?,data=? WHERE id=?',bad.phase??settledRun.phase,JSON.stringify({...JSON.parse(settledRun.data),...bad.data}),run.id);
            assert.equal(c.store.tx(()=>c.interactions.settleManualInput(run.id)),false);
            assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'INITIAL_RESERVED');
        }
        c.store.run('UPDATE runs SET phase=?,data=? WHERE id=?',settledRun.phase,settledRun.data,run.id);
        assert.equal(c.store.tx(()=>c.interactions.settleManualInput(run.id)),true);
        assert.equal(c.store.one('SELECT source FROM conversation_inputs WHERE id=?',inputId).source,inputBefore.source);
        assert.equal(c.store.one('SELECT text FROM conversation_inputs WHERE id=?',inputId).text,inputBefore.text);
        assert.equal((await c.runConversation({conversationId:id,model})).status,'delivered');

        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',inputId).state,'CONSUMED');
        const target=(await c.getConversationHistory(id)).sessionManager.getBranch().find(e=>e.type==='message'&&e.message.role==='user').id;
        const next=await c.navigateConversationTree({conversationId:id,expectedGeneration:c.inspectConversation(id).generation,model,entryId:target});
        assert.equal(next.status,'delivered'); assert.equal(calls,3);
        assert.deepEqual({...c.inspectWork(refused.workId).allowance},{limit:32,consumed:5,reserved:0});
        assert.equal(c.store.one('SELECT source FROM conversation_inputs WHERE id=?',inputId).source,state.source);
        assert.equal(c.inspectWork(refused.workId).runs.find(r=>r.id===run.id).data.outcome,'unavailable');
        const early=await c.compactConversation({conversationId:id,expectedGeneration:c.inspectConversation(id).generation,model:{...model,modelId:'missing-owned-model'}});
        assert.equal(early.status,'unavailable'); assert.match(early.failure,/Explicit model is unavailable/);
        assert.equal(calls,3);
        const earlyRun=c.inspectWork(refused.workId).runs.at(-1);
        assert.equal(earlyRun.data.nativeManualAttempted,undefined,'Declaration must not claim a native attempt');
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',earlyRun.data.initialInputId).state,'CONSUMED','Failed setup must not strand the admitted manual input');
        assert.equal(earlyRun.data.manualAction.kind,'compact');
        const retry=await c.compactConversation({conversationId:id,expectedGeneration:c.inspectConversation(id).generation,model});
        assert.equal(retry.status,'unavailable'); assert.match(retry.failure,/Nothing to compact/);
        assert.deepEqual({...c.inspectWork(refused.workId).allowance},{limit:32,consumed:7,reserved:0});
        assert.equal(calls,3);
        passed=true;

    } finally {await c.close();if(priorTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=priorTmp;if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained failed manual settlement world: '+root);}
});

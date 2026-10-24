import {HostCommands} from '../../dist/ui/host-commands.js';
import {readinessCommands} from '../../dist/ui/readiness-commands.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openController } from '../../dist/controller/index.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import {getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {conversationLanguagePolicy} from '../../dist/controller/conversation-language.js';
let sequence = 0;
function model(onCall,reply='Prior F1 retained response') {
    const unique = ++sequence;
    return { provider: 'interaction-fixture-' + unique, modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'interaction-fixture-api-' + unique, models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m, context, options) {
                const stream = createAssistantMessageEventStream();
                void (async () => {
                    try { await onCall?.(context, options); }
                    catch(error) { const failed={role:'assistant',content:[],api:m.api,provider:m.provider,model:m.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:failed});stream.end(failed);return; }
                    const message = { role: 'assistant', content: [{ type: 'text', text: reply }], api: m.api, provider: m.provider, model: m.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: options?.signal?.aborted ? 'aborted' : 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: message.stopReason, message });
                    stream.end(message);
                })();
                return stream;
            } } };
}
let sharedRoot;
after(async () => {
    if (sharedRoot)
        await fs.rm(sharedRoot, { recursive: true, force: true });
});
async function fixture(t) {
    sharedRoot ??= await fs.realpath(await fs.mkdtemp(path.join('/tmp', 'gitjig-ordinary-')));
    const home = path.join(sharedRoot, 'home'), c = await openController({ installationHome: home });
    process.env.TMPDIR = path.join(home, 'artifacts');
    t.after(() => c.close());
    return { c, home };
}
test('native owner replies separate English working records from Korean conversation and retain later explicit reply preferences', {timeout:10000},async t=>{
 const {c}=await fixture(t),v=c.createConversation(),request='역할을 설명해줘. Widget과 src/한글.ts 이름은 그대로 써줘.',reply='Widget의 역할을 설명하겠습니다. src/한글.ts 이름은 유지합니다.';
 const input=await c.queueConversationInput({conversationId:v.conversationId,expectedGeneration:0,text:request,mode:'idle'});
 let seen=0;const first=await c.runConversation({conversationId:v.conversationId,model:model(context=>{
  const system=getCurrentSystemPrompt(context.messages);seen++;assert.match(system,/English is mandatory/);assert.match(system,/progress updates, clarification questions and final replies must use the human conversation language/);assert.match(system,/answer a Korean request in Korean/);assert.ok(system.includes(request));assert.ok(JSON.stringify(context.messages).includes(request));
  const assigned=conversationLanguagePolicy(c.store,v.conversationId,true,false);assert.match(assigned,/delegated task results and coordination reports must remain English, including after a human steers/);assert.match(assigned,/Use conversation_report/);assert.match(assigned,/final assistant reply is for the human/);assert.ok(assigned.includes(request));const review=conversationLanguagePolicy(c.store,v.conversationId,true,true);assert.match(review,/Internal audience:/);assert.ok(!review.includes(request));assert.ok(!review.includes('Conversation language:'));
 },reply)});
 assert.equal(first.status,'delivered',JSON.stringify(c.store.all('SELECT data FROM observations')));assert.equal(seen,1);assert.deepEqual(first.answer.text,[{type:'text',text:reply}]);assert.equal(c.store.one('SELECT raw FROM sources WHERE id=?',input.sourceId).raw,request);
 const history=c.inspectConversation(v.conversationId).historyRef,follow='Please reply in English from now on.';
 await c.queueConversationInput({conversationId:v.conversationId,expectedGeneration:c.inspectConversation(v.conversationId).generation,text:follow,mode:'idle'});
 const second=await c.runConversation({conversationId:v.conversationId,model:model(context=>{
  const system=getCurrentSystemPrompt(context.messages);assert.match(system,/explicit requested reply language/);assert.ok(system.includes(follow));assert.ok(JSON.stringify(context.messages).includes(reply));
 },'I will reply in English and keep the original identifiers.')});
 assert.equal(second.status,'delivered');assert.equal(c.inspectConversation(v.conversationId).historyRef,history);assert.equal(second.answer.text[0].text,'I will reply in English and keep the original identifiers.');
});
test('project-unbound real native conversation retains source/history/allowance across same-C turn', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: '한국어 원본 F1', mode: 'idle' });
    const first = await c.runConversation({ conversationId: v.conversationId, model: model() });
    assert.equal(first.status, 'delivered', JSON.stringify(c.store.all('SELECT data FROM observations')));
    assert.equal(first.cleanup, 'unbound');
    const one = c.inspectConversation(v.conversationId);
    assert.equal(one.state, 'IDLE');
    assert.ok(one.historyRef);
    let seen = false;
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: one.generation, text: 'Follow up', mode: 'idle' });
    const second = await c.runConversation({ conversationId: v.conversationId, model: model(ctx => {
            seen = JSON.stringify(ctx).includes('Prior F1 retained response');
        }) });
    assert.equal(second.status, 'delivered');
    assert.equal(second.workId, first.workId);
    assert.equal(seen, true);
    assert.equal(c.inspectWork(first.workId).allowance.consumed, 2);
    assert.equal(c.inspectConversation(v.conversationId).historyRef, one.historyRef);
    assert.equal(c.listProjects().length, 0);
});
test('exact response interruption settles without cancelling W; explicit cancel remains distinct', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'Wait for controlled provider', mode: 'idle' });
    let reached;
    const entered = new Promise(r => reached = r);
    let release;
    const barrier = new Promise(r => release = r);
    const task = c.runConversation({ conversationId: v.conversationId, model: model(async (ctx, opts) => {
            reached();
            await Promise.race([barrier, new Promise(resolve => opts.signal.addEventListener('abort', resolve, { once: true }))]);
        }) });
    await Promise.race([entered, task.then(result => {
            throw Error('Provider not reached: ' + JSON.stringify({ result, observations: c.store.all('SELECT data FROM observations') }));
        })]);
    await new HostCommands(readinessCommands({controller:c,isCurrent:()=>true,choose:async(_title,rows)=>{assert.match(rows[0],/Wait for the current response/);return undefined;},execute:async()=>assert.fail('Busy readiness dispatched')})).execute('/ready',v.conversationId);
    const current = c.inspectConversation(v.conversationId), epoch = c.inspectWork(current.workId).epoch;
    const interrupted = c.interruptConversation({ conversationId: v.conversationId, expectedGeneration: current.generation });
    release();
    await interrupted;
    const result = await task;
    assert.notEqual(c.inspectWork(result.workId).state, 'CANCELLED');
    assert.equal(c.inspectWork(result.workId).epoch, epoch);
    assert.equal(c.inspectConversation(v.conversationId).state, 'IDLE');
    const pending = c.inspectConversationInputs(v.conversationId)[0];
    assert.equal(pending.eligible, true); assert.equal(pending.interrupted, true);
    // Back from the routed inputs browser reopens /ready; the owner then closes it.
    let route,opened=0; await new HostCommands(readinessCommands({controller:c,isCurrent:()=>true,choose:async(_title,rows)=>++opened===1?rows[0]:undefined,execute:async command=>{route=command;return 'cancelled';}})).execute('/ready',v.conversationId);assert.equal(route,'/inputs');assert.equal(opened,2);
    const spent = c.inspectWork(result.workId).allowance.consumed;
    c.recoverConversationInput({conversationId:v.conversationId,inputId:pending.inputId,expectedContext:pending.fingerprint,action:'retry'});
    const retried = await c.runConversation({conversationId:v.conversationId,initialInputId:pending.inputId,model:model()});
    assert.equal(retried.status,'delivered'); assert.equal(retried.workId,result.workId);
    assert.equal(c.inspectWork(result.workId).allowance.consumed,spent+1);
    assert.equal(c.inspectConversationInputs(v.conversationId).length,0);
    await c.cancelWork({ workId: result.workId });
    assert.equal(c.inspectWork(result.workId).state, 'CANCELLED');
});
test('input arriving at native-ready preserves reserved first boundary; SETTLING input remains durable for next run', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'INITIAL exact owner request', mode: 'idle' });
    let injected = false, settling = false;
    const promises = [];
    const unsubscribe = c.subscribeInteraction(event => {
        if (event.conversationId !== v.conversationId)
            return;
        if (event.type === 'native-ready' && !injected) {
            injected = true;
            promises.push(c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: event.generation, text: 'STEER after initial boundary', mode: 'steer' }));
        }
        if (event.type === 'native-settling' && !settling) {
            settling = true;
            promises.push(c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: event.generation, text: 'LATE during SETTLING', mode: 'steer' }));
        }
    });
    const first = await c.runConversation({ conversationId: v.conversationId, model: model() });
    await Promise.all(promises);
    unsubscribe();
    assert.equal(first.status, 'delivered');
    const rows = c.store.all('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid', v.conversationId);
    assert.equal(rows[0].text, 'INITIAL exact owner request');
    assert.equal(rows[0].state, 'CONSUMED');
    assert.equal(rows.at(-1).text, 'LATE during SETTLING');
    assert.equal(rows.at(-1).state, 'QUEUED');
    const second = await c.runConversation({ conversationId: v.conversationId, model: model() });
    assert.equal(second.status, 'delivered');
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', rows.at(-1).id).state, 'CONSUMED');
});
test('same-C history-await race permits exactly one retained admission and no duplicate reservation', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'First history producer', mode: 'idle' });
    const first = await c.runConversation({ conversationId: v.conversationId, model: model() });
    const view = c.inspectConversation(v.conversationId);
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: view.generation, text: 'One selected continuation', mode: 'idle' });
    let entered, release;
    const reached = new Promise(r => entered = r), barrier = new Promise(r => release = r), interactions = c.interactionCore, original = interactions.history.bind(interactions);
    interactions.history = async (id) => {
        entered();
        await barrier;
        return original(id);
    };
    try {
        const next = c.runConversation({ conversationId: v.conversationId, model: model() });
        await reached;
        await assert.rejects(c.runConversation({ conversationId: v.conversationId, model: model() }), /already.*active/);
        assert.equal(c.inspectWork(first.workId).runs.length, 1);
        assert.equal(c.inspectWork(first.workId).allowance.reserved, 0);
        release();
        assert.equal((await next).status, 'delivered');
        assert.equal(c.inspectWork(first.workId).runs.length, 2);
        assert.equal(c.inspectWork(first.workId).allowance.consumed, 2);
        assert.equal(c.inspectWork(first.workId).allowance.reserved, 0);
    }
    finally {
        release();
        interactions.history = original;
    }
});
test('live follow-up shares the sole native slot with steering and consumes each durable input in order', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'INITIAL follow-up route', mode: 'idle' });
    let reached, release, calls = 0;
    const entered = new Promise(r => reached = r), barrier = new Promise(r => release = r), users = [];
    const off = c.subscribeInteraction(event => {
        if (event.conversationId === v.conversationId && event.type === 'native-ready')
            c.getNativeHandle(v.conversationId).session.subscribe(e => {
                if (e.type === 'message_end' && e.message.role === 'user')
                    users.push(e.message.content.filter(x => x.type === 'text').map(x => x.text).join(''));
            });
    });
    const task = c.runConversation({ conversationId: v.conversationId, model: model(async () => {
            if (calls++ === 0) {
                reached();
                await barrier;
            }
        }) });
    await entered;
    const view = c.inspectConversation(v.conversationId);
    const follow = await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: view.generation, text: 'FOLLOW-UP exact Korean 후속', mode: 'follow-up' }), steer = await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: view.generation, text: 'STEER after follow-up', mode: 'steer' });
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', follow.inputId).state, 'NATIVE_PENDING');
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', steer.inputId).state, 'QUEUED');
    release();
    assert.equal((await task).status, 'delivered');
    off();
    assert.deepEqual(users, ['INITIAL follow-up route', 'FOLLOW-UP exact Korean 후속', 'STEER after follow-up']);
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', follow.inputId).state, 'CONSUMED');
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', steer.inputId).state, 'CONSUMED');
    assert.equal(c.inspectConversation(v.conversationId).state, 'IDLE');
});
test('response interruption reconciles a pending native follow-up by its mode and preserves exact input for explicit continuation', { timeout: 10000 }, async (t) => {
    const { c } = await fixture(t), v = c.createConversation();
    await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'INITIAL interrupted follow-up', mode: 'idle' });
    let reached;
    const entered = new Promise(r => reached = r);
    const task = c.runConversation({ conversationId: v.conversationId, model: model(async (ctx, options) => {
            reached();
            await new Promise(r => options.signal.addEventListener('abort', r, { once: true }));
        }) });
    await entered;
    const view = c.inspectConversation(v.conversationId), input = await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: view.generation, text: 'FOLLOW-UP survives response interrupt', mode: 'follow-up' });
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.inputId).state, 'NATIVE_PENDING');
    await c.interruptConversation({ conversationId: v.conversationId, expectedGeneration: view.generation });
    await task;
    const retained = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId);
    assert.equal(retained.state, 'QUEUED');
    assert.deepEqual(JSON.parse(retained.data).clearReceipt, { steering: 0, followUp: 1 });
    assert.equal(c.inspectConversation(v.conversationId).state, 'IDLE');
    let observed = false;
    const next = await c.runConversation({ conversationId: v.conversationId, model: model(ctx => {
            observed = JSON.stringify(ctx).includes(retained.text);
        }) });
    assert.equal(next.status, 'delivered');
    assert.equal(observed, true);
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.inputId).state, 'CONSUMED');
});

test('failed startup retains visible original requests and supports explicit same-work recovery after restart', {timeout:10000}, async t => {
 const {c,home}=await fixture(t),v=c.createConversation(),cid=v.conversationId;
 const acquire=c.capacity.acquire;
 c.capacity.acquire=async()=>{throw Error('Controlled startup prerequisite unavailable');};
 const attempts=[];
 for(const text of ['First request retained','Second request retained']){
  await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text,mode:'idle'});
  const result=await c.runConversation({conversationId:cid,model:model()});attempts.push(result);
  assert.equal(result.status,'unavailable');assert.match(result.failure,/Controlled startup prerequisite/);
 }
 c.capacity.acquire=acquire;
 assert.equal(c.inspectConversation(cid).historyRef,null);
 const originals=c.inspectConversationInputs(cid);assert.equal(originals.length,2);assert.ok(originals.every(row=>row.eligible));
 const budget=c.inspectWork(attempts[0].workId).allowance.consumed;
 await c.close();const reopened=await openController({installationHome:home});t.after(()=>reopened.close());
 const pending=reopened.inspectConversationInputs(cid);assert.deepEqual(pending.map(row=>row.text),['First request retained','Second request retained']);
 // A newer admitted direction invalidates the review, even if this input is unchanged.
 await reopened.queueConversationInput({conversationId:cid,expectedGeneration:reopened.inspectConversation(cid).generation,text:'Third queued request',mode:'idle'});
 assert.throws(()=>reopened.recoverConversationInput({conversationId:cid,inputId:pending[0].inputId,expectedContext:pending[0].fingerprint,action:'withdraw'}),/changed/);
 for(const row of reopened.inspectConversationInputs(cid).slice(1)){
  const current=reopened.inspectConversationInputs(cid).find(p=>p.inputId===row.inputId);
  reopened.recoverConversationInput({conversationId:cid,inputId:row.inputId,expectedContext:current.fingerprint,action:'withdraw'});
 }
 const first=reopened.inspectConversationInputs(cid)[0];
 reopened.recoverConversationInput({conversationId:cid,inputId:first.inputId,expectedContext:first.fingerprint,action:'retry'});
 const result=await reopened.runConversation({conversationId:cid,initialInputId:first.inputId,model:model()});
 assert.equal(result.status,'delivered');assert.equal(result.workId,attempts[0].workId);
 assert.equal(reopened.inspectWork(result.workId).allowance.consumed,budget+1);
 assert.equal(reopened.inspectConversationInputs(cid).length,0);
 assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?',cid).n,3);
});

test('provider failure is returned and native-attempted input cannot be replayed through startup recovery', {timeout:10000}, async t=>{
 const {c}=await fixture(t),v=c.createConversation();
 await c.queueConversationInput({conversationId:v.conversationId,expectedGeneration:0,text:'Retain provider failure',mode:'idle'});
 const result=await c.runConversation({conversationId:v.conversationId,model:model(()=>{throw Error('Controlled provider unavailable');})});
 assert.equal(result.status,'unavailable');assert.match(result.failure,/Controlled provider unavailable/);
 // Simulate an unacknowledged native input while preserving the original attempted run.
 const run=c.store.one('SELECT data FROM runs WHERE id=?',result.runId),inputId=JSON.parse(run.data).initialInputId;
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','INITIAL_RESERVED',inputId);
 const pending=c.inspectConversationInputs(v.conversationId)[0];assert.equal(pending.eligible,false);
 assert.throws(()=>c.recoverConversationInput({conversationId:v.conversationId,inputId,expectedContext:pending.fingerprint,action:'retry'}),/not safe/);
});

import {inputCommands} from '../../dist/ui/input-commands.js';
test('undispatched failure held by earlier governed work has truthful inspection and no recovery bypass', {timeout:10000}, async t => {
 const {c}=await fixture(t),v=c.createConversation(),cid=v.conversationId;
 c.capacity.acquire=async()=>{throw Error('Controlled pre-dispatch capture refusal');};
 await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Why did the previous work stop?',mode:'idle'});
 const result=await c.runConversation({conversationId:cid,model:model()});
 assert.equal(result.status,'unavailable');assert.equal(c.inspectConversation(cid).state,'IDLE');
 const w=c.store.one('SELECT * FROM works WHERE id=?',result.workId);
 c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','BLOCKING',null,w.source,null,'BLOCKING','ACTIVE',1,1,null,JSON.stringify({kind:'governed-change',conversation:cid}));
 c.store.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)','BLOCKING','BLOCKED',null,null,null,null,1,JSON.stringify({nextAction:'capture',blocked:['Unsupported scratch link']}));
 const pending=c.inspectConversationInputs(cid)[0];
 assert.equal(pending.eligible,false);assert.equal(pending.undispatched,true);
 assert.deepEqual(pending.blockingWorkIds,['BLOCKING']);
 assert.match(pending.explanation,/Not dispatched to the model/);assert.match(pending.explanation,/governed:BLOCKING:BLOCKED/);
 for(const action of ['retry','withdraw'])assert.throws(()=>c.recoverConversationInput({conversationId:cid,inputId:pending.inputId,expectedContext:pending.fingerprint,action}),/not safe/);
 const before=c.store.all('SELECT * FROM runs'),inputs=c.store.all('SELECT * FROM conversation_inputs');let opened=0,detail;
 const host={controller:c,isCurrent:()=>true,notice(){},show:async(_title,text)=>{detail=text;},retry:async()=>assert.fail('Held request retried'),inspectWork:async(target,id)=>{assert.equal(target,cid);assert.equal(id,'BLOCKING');opened++;},choose:async(title,rows)=>{
  assert.ok(!rows.includes('Retry original request'));assert.ok(!rows.includes('Withdraw original request'));
  if(title.startsWith('Sent requests')){assert.match(rows[0],/Not sent to model · recovery held/);return rows[0];}
  assert.equal(title,'Retained request · recovery held');return rows[1];
 }};
 await new HostCommands(inputCommands(host)).execute('/inputs',cid);
 assert.equal(opened,1);assert.match(detail,/Controlled pre-dispatch capture refusal/);
 assert.deepEqual(c.store.all('SELECT * FROM runs'),before);assert.deepEqual(c.store.all('SELECT * FROM conversation_inputs'),inputs);
 // A changed blocker invalidates the reviewed held request before opening work.
 await assert.rejects(new HostCommands(inputCommands({...host,choose:async(title,rows)=>{
  if(title.startsWith('Sent requests'))return rows[0];
  c.store.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work='BLOCKING'");return rows[1];
 }})).execute('/inputs',cid),/Sent request changed/);
 assert.equal(opened,1);
 // A native attempt cannot be relabelled as definitely unsent even after cleanup.
 const run=c.store.one('SELECT data FROM runs WHERE id=?',result.runId);
 c.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(run.data),nativePromptAttempted:true}),result.runId);
 const uncertain=c.inspectConversationInputs(cid)[0];assert.equal(uncertain.undispatched,false);assert.equal(uncertain.eligible,false);
 let label;
 await new HostCommands(inputCommands({...host,choose:async(_title,rows)=>{label=rows[0];return'Back';}})).execute('/inputs',cid);
 assert.match(label,/Awaiting response or reconciliation/);
});

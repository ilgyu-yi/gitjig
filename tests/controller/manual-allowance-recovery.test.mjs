import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

test('explicit identical manual retry preserves refused input and same-W accounting after finite owner extension', {timeout: 15000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-manual-recovery-'));
    const c = await openController({installationHome: path.join(root, 'home')});
    const priorTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(root, 'home/artifacts');
    let passed = false;
    let calls = 0, outputText = 'Retained actual context. '.repeat(1600);
    const model = {provider: 'manual-recovery', modelId: 'fixture', definition: {api: 'manual-recovery-api', apiKey: 'no-network', baseUrl: 'http://unused.invalid', models: [{id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 300000, maxTokens: 50000}], streamSimple(m) {
        calls++;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
            const message = {role: 'assistant', content: [{type: 'text', text: outputText}], api: m.api, provider: m.provider, model: m.id, usage: {input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0, totalTokens: 2000, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: 'stop', timestamp: Date.now()};
            stream.push({type: 'done', reason: 'stop', message}); stream.end(message);
        });
        return stream;
    }}};
    try {
        const conversation = c.createConversation().conversationId;
        for (let i = 0; i < 8; i++) {
            await c.queueConversationInput({conversationId: conversation, expectedGeneration: c.inspectConversation(conversation).generation, text: 'Owned history ' + i, mode: 'idle'});
            assert.equal((await c.runConversation({conversationId: conversation, model})).status, 'delivered');
            // A retained legacy limit must remain finite and recoverable after default changes.
            if (i === 0) c.store.run("UPDATE budgets SET lim=8 WHERE lineage=? AND kind='execution'", c.inspectConversation(conversation).workId);
        }
        const view = c.inspectConversation(conversation), work = view.workId;
        const request = {conversationId: conversation, expectedGeneration: view.generation, model};
        const before = c.inspectWork(work), callsBefore = calls;
        await assert.rejects(c.compactConversation(request), /allowance exhausted/);
        assert.equal(calls, callsBefore);
        assert.deepEqual(c.inspectWork(work).allowance, before.allowance);
        const pending = c.store.all("SELECT * FROM conversation_inputs WHERE conversation=? AND state='QUEUED'", conversation);
        assert.equal(pending.length, 1);
        assert.equal(pending[0].mode, 'manual');
        await assert.rejects(async () => c.compactConversation({...request, instructions: 'Different owner summary request'}), /Pending input/);
        const target = (await c.getConversationHistory(conversation)).sessionManager.getBranch().find(e => e.type === 'message' && e.message.role === 'user').id;
        await assert.rejects(async () => c.navigateConversationTree({...request, entryId: target}), /Pending input/);
        assert.equal(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?', conversation).length, 9);
        c.extendExecutionAllowance({workId: work, additional: 4, reason: 'Owner explicitly extends this retained fixture for history/summary verification'});
        assert.deepEqual({...c.inspectWork(work).allowance}, {limit: 12, consumed: 8, reserved: 0});
        const result = await c.compactConversation(request);
        assert.equal(result.status, 'delivered');
        assert.equal(result.workId, work);
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', pending[0].id).state, 'CONSUMED');
        assert.equal(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?', conversation).length, 9);
        assert.deepEqual({...c.inspectWork(work).allowance}, {limit: 12, consumed: 9, reserved: 0});
        assert.equal(c.inspectWork(work).runs.at(-1).data.initialInputId, pending[0].id);
        assert.ok((await c.getConversationHistory(conversation)).sessionManager.getEntries().some(e => e.type === 'compaction'));
        // An ordinary owner prompt remains pending; a manual action cannot consume it.
        const now = c.inspectConversation(conversation);
        await c.queueConversationInput({conversationId: conversation, expectedGeneration: now.generation, text: 'Unrelated retained owner direction', mode: 'idle'});
        await assert.rejects(async () => c.compactConversation({...request, expectedGeneration: now.generation}), /Pending input/);
        assert.equal(c.inspectWork(work).allowance.consumed, 9);
        assert.equal(c.store.one("SELECT text FROM conversation_inputs WHERE conversation=? AND state='QUEUED'", conversation).text, 'Unrelated retained owner direction');
        assert.equal((await c.runConversation({conversationId: conversation, model})).status, 'delivered');
        // A later owner input arriving during client cleanup must also block admission.
        const cleanup = c.completed.beforeFresh.bind(c.completed);
        let entered, release;
        const atCleanup = new Promise(resolve => { entered = resolve; });
        const released = new Promise(resolve => { release = resolve; });
        c.completed.beforeFresh = async id => { await cleanup(id); entered(); await released; };
        const raceView = c.inspectConversation(conversation), callsAtRace = calls;
        const racingManual = c.compactConversation({...request, expectedGeneration: raceView.generation});
        await atCleanup;
        await c.queueConversationInput({conversationId: conversation, expectedGeneration: raceView.generation, text: 'New direct direction during cleanup', mode: 'idle'});
        release();
        await assert.rejects(racingManual, /APPLICATION_MODEL_UNAVAILABLE: conversation target\/model\/input changed during resolution/);
        c.completed.beforeFresh = cleanup;
        assert.equal(calls, callsAtRace);
        assert.deepEqual({...c.inspectWork(work).allowance}, {limit: 12, consumed: 10, reserved: 0});
        assert.equal(c.store.all("SELECT id FROM conversation_inputs WHERE conversation=? AND state='QUEUED'", conversation).length, 2);
        outputText = 'Short branch response';
        const small = c.createConversation().conversationId;
        await c.queueConversationInput({conversationId: small, expectedGeneration: 0, text: 'Short branch', mode: 'idle'});
        assert.equal((await c.runConversation({conversationId: small, model})).status, 'delivered');
        const callsBeforeSmall = calls;
        const refused = await c.compactConversation({conversationId: small, expectedGeneration: c.inspectConversation(small).generation, model});
        assert.equal(refused.status, 'unavailable');
        assert.match(refused.failure, /Nothing to compact/);
        assert.equal(calls, callsBeforeSmall, 'Small-history refusal must not call the model');
        passed = true;
    } finally {
        await c.close();
        if (priorTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = priorTmp;
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained failed manual recovery world: ' + root);
    }
});

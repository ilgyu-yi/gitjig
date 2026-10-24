import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
test('host leave quiesces queued/no-native and exact active generation, joins both, preserves W epochs/input without cancellation', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-leave-')), home = path.join(root, 'home'), c = await openController({ installationHome: home, capacityLimit: 1 });
    process.env.TMPDIR = path.join(home, 'artifacts');
    let entered;
    const barrier = new Promise(r => entered = r), identities = [];
    c.subscribeInteraction(event => {
        if (event.type === 'native-ready')
            identities.push(structuredClone(c.getNativeHandle(event.conversationId).identity));
    });
    let calls = 0;
    const model = { provider: 'leave-fixture', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'leave-fixture-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m, context, opts) {
                calls++;
                const stream = createAssistantMessageEventStream();
                entered();
                opts.signal.addEventListener('abort', () => {
                    const message = { role: 'assistant', content: [], api: m.api, provider: m.provider, model: m.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'aborted', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: 'aborted', message });
                    stream.end(message);
                }, { once: true });
                return stream;
            } } };
    try {
        const a = c.createConversation(), b = c.createConversation();
        await c.queueConversationInput({ conversationId: a.conversationId, expectedGeneration: 0, text: 'A response must survive leave', mode: 'idle' });
        await c.queueConversationInput({ conversationId: b.conversationId, expectedGeneration: 0, text: 'B queued before native-ready', mode: 'idle' });
        const first = c.runConversation({ conversationId: a.conversationId, model });
        await barrier;
        const second = c.runConversation({ conversationId: b.conversationId, model });
        for (let i = 0; i < 100 && !c.store.one("SELECT id FROM capacity_leases WHERE state='QUEUED'"); i++)
            await new Promise(r => setImmediate(r));
        assert.equal(identities.length, 1);
        const aw = c.inspectConversation(a.conversationId).workId, bw = c.inspectConversation(b.conversationId).workId;
        await c.settleInteractionHost({ identities });
        const results = await Promise.all([first, second]);
        assert.ok(results.every(result => result.status === 'interrupted'));
        assert.equal(calls, 1);
        assert.equal(c.inspectWork(aw).epoch, 1);
        assert.equal(c.inspectWork(bw).epoch, 1);
        assert.notEqual(c.inspectWork(aw).state, 'CANCELLED');
        assert.notEqual(c.inspectWork(bw).state, 'CANCELLED');
        assert.equal(c.inspectWork(aw).allowance.consumed, 1);
        assert.equal(c.inspectWork(bw).allowance.consumed, 0);
        assert.equal(c.inspectWork(bw).allowance.reserved, 0);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM conversation_inputs WHERE state='QUEUED'").n, 2);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n, 0);
        assert.throws(() => c.runConversation({ conversationId: a.conversationId, model }), /quiesced/);
        await c.close();
        const reopened = await openController({ installationHome: home });
        try {
            assert.notEqual(reopened.inspectWork(aw).state, 'CANCELLED');
            assert.equal(reopened.inspectConversation(b.conversationId).draft.text, '');
        }
        finally {
            await reopened.close();
        }
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

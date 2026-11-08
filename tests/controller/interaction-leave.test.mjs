import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';

const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-leave-'));
const home = path.join(root, 'home');
const previousTemp = process.env.TMPDIR;
// The Pi host binds one helper artifact root for the lifetime of the test process.
process.env.TMPDIR = path.join(home, 'artifacts');
test.after(async () => {
    if (previousTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTemp;
    await fs.rm(root, { recursive: true, force: true });
});
const modelFor = streamSimple => ({
    provider: 'leave-fixture', modelId: 'fixture', definition: {
        apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'leave-fixture-api',
        models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }],
        streamSimple,
    },
});
function finishResponse(stream, model, stopReason, text) {
    const message = { role: 'assistant', content: text === undefined ? [] : [{ type: 'text', text }],
        api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    stream.push({ type: 'done', reason: stopReason, message });
    stream.end(message);
}
test('host leave quiesces queued/no-native and exact active generation, joins both, preserves W epochs/input without cancellation', { timeout: 10000 }, async () => {
    const c = await openController({ installationHome: home, capacityLimit: 1 });
    let entered;
    const barrier = new Promise(r => entered = r), identities = [];
    c.subscribeInteraction(event => {
        if (event.type === 'native-ready')
            identities.push(structuredClone(c.getNativeHandle(event.conversationId).identity));
    });
    let calls = 0;
    const model = modelFor((m, _context, options) => {
        calls++;
        const stream = createAssistantMessageEventStream();
        options.signal.addEventListener('abort', () => finishResponse(stream, m, 'aborted'), { once: true });
        entered();
        return stream;
    });
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
    }
});

for (const phase of ['live', 'settling']) test(`controller close joins the ordinary ${phase} response without cancelling retained work`,
    { timeout: 10000 }, async () => {
        const c = await openController({ installationHome: home });
        const entered = Promise.withResolvers(), draining = Promise.withResolvers(), release = Promise.withResolvers();
        const applicationsClosed = Promise.withResolvers();
        const request = 'Original response must survive close', answer = 'Owned answer before close', draft = 'New unsent 한글 draft';
        const live = phase === 'live';
        c.adoptApplicationResource({ close: async () => applicationsClosed.resolve() });
        if (!live) {
            const drain = c.interactions.drainNativeInputs.bind(c.interactions);
            c.interactions.drainNativeInputs = async identity => {
                if (identity) {
                    draining.resolve();
                    await release.promise;
                }
                return drain(identity);
            };
        }
        let calls = 0;
        const model = modelFor((m, _context, options) => {
            calls++;
            const stream = createAssistantMessageEventStream();
            if (live) options.signal.addEventListener('abort', () => finishResponse(stream, m, 'aborted'), { once: true });
            else finishResponse(stream, m, 'stop', answer);
            entered.resolve();
            return stream;
        });
        try {
            const { conversationId } = c.createConversation();
            await c.queueConversationInput({ conversationId, expectedGeneration: 0, text: request, mode: 'idle' });
            const turn = c.runConversation({ conversationId, model });
            await Promise.race([
                live ? entered.promise : draining.promise,
                turn.then(result => assert.fail(`Turn settled before close: ${JSON.stringify(result)}`)),
            ]);
            const { workId } = c.inspectConversation(conversationId);
            const epoch = c.inspectWork(workId).epoch;
            c.setDraft({ conversationId, expectedRevision: 0, text: draft });
            const closing = c.close();
            await applicationsClosed.promise;
            await new Promise(resolve => setImmediate(resolve));
            release.resolve();
            const [result] = await Promise.all([turn, closing]);
            assert.equal(result.status, live ? 'interrupted' : 'delivered', JSON.stringify(result));
            assert.equal(calls, 1);
            const reopened = await openController({ installationHome: home });
            try {
                assert.equal(reopened.inspectWork(workId).epoch, epoch);
                assert.notEqual(reopened.inspectWork(workId).state, 'CANCELLED');
                assert.equal(reopened.inspectConversation(conversationId).draft.text, draft);
                const inputs = reopened.store.all('SELECT text,state FROM conversation_inputs WHERE conversation=?', conversationId);
                assert.deepEqual(inputs.map(row => [row.text, row.state]), [[request, live ? 'QUEUED' : 'CONSUMED']]);
                assert.equal(reopened.store.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.kind')='owner-task-cancel'").n, 0);
                const record = reopened.store.one('SELECT id FROM conversation_results WHERE conversation=? AND work=?', conversationId, workId);
                const retained = reopened.inspectConversationResult(record.id).result;
                assert.equal(retained.status, result.status);
                if (!live) assert.deepEqual(retained.answer?.text, [{ type: 'text', text: answer }]);
            } finally {
                await reopened.close();
            }
        } finally {
            release.resolve();
            await c.close();
        }
    });

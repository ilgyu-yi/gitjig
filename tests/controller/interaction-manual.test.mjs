import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
test('manual native compaction uses finite checkpointed dispatch; tree selection persists truthful public marker and reopens same branch', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-manual-')), home = path.join(root, 'home');
    let c = await openController({ installationHome: home });
    process.env.TMPDIR = path.join(home, 'artifacts');
    let ordinaryCalls = 0, summaryCalls = 0;
    const model = { provider: 'manual-fixture', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'manual-fixture-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 300000, maxTokens: 50000 }], streamSimple(m, context) {
                const summary = JSON.stringify(context).includes('context summarization assistant');
                if (summary)
                    summaryCalls++;
                else
                    ordinaryCalls++;
                const text = summary ? '## Goal\nRetain owner F1 and useful context.\n## Progress\nNative ordinary responses completed.\n## Next\nContinue from actual history.' : 'F1 actual ordinary response ' + ('word '.repeat(16000));
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    const message = { role: 'assistant', content: [{ type: 'text', text }], api: m.api, provider: m.provider, model: m.id, usage: { input: 50000, output: summary ? 100 : 30000, cacheRead: 0, cacheWrite: 0, totalTokens: summary ? 50100 : 80000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: 'stop', message });
                    stream.end(message);
                });
                return stream;
            } } };
    try {
        const view = c.createConversation();
        await assert.rejects(async () => c.compactConversation({ conversationId: view.conversationId, expectedGeneration: 0, model }), /MANUAL_NATIVE_UNAVAILABLE/);
        for (let i = 0; i < 3; i++) {
            await c.queueConversationInput({ conversationId: view.conversationId, expectedGeneration: c.inspectConversation(view.conversationId).generation, text: 'Generate genuine ordinary history turn ' + i, mode: 'idle' });
            assert.equal((await c.runConversation({ conversationId: view.conversationId, model })).status, 'delivered', JSON.stringify(c.store.all('SELECT data FROM observations')));
        }
        const before = c.inspectConversation(view.conversationId), history = await c.getConversationHistory(view.conversationId), target = history.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user').id;
        const compacted = await c.compactConversation({ conversationId: view.conversationId, expectedGeneration: before.generation, model, instructions: 'Preserve F1 and actual progress' });
        assert.equal(compacted.status, 'delivered', JSON.stringify(c.inspectWork(compacted.workId)));
        assert.ok(summaryCalls >= 1 && summaryCalls <= 2);
        assert.equal(ordinaryCalls, 3);
        const compactRun = c.inspectWork(compacted.workId).runs.at(-1);
        assert.equal(compactRun.data.modelDispatchAttempted, true);
        assert.equal(compactRun.data.nativeManualAttempted, 'compact');
        const current = c.inspectConversation(view.conversationId), navigated = await c.navigateConversationTree({ conversationId: view.conversationId, expectedGeneration: current.generation, model, entryId: target });
        assert.equal(navigated.status, 'delivered');
        assert.ok(summaryCalls >= 1 && summaryCalls <= 2);
        const branch = (await c.getConversationHistory(view.conversationId)).sessionManager.getBranch(), marker = branch.at(-1);
        assert.equal(marker.type, 'custom');
        assert.equal(marker.customType, 'gitjig.owner-tree-navigation');
        assert.equal(marker.data.targetEntryId, target);
        assert.equal(marker.data.runId, navigated.runId);
        const historyRef = c.inspectConversation(view.conversationId).historyRef;
        await c.close();
        c = await openController({ installationHome: home });
        const reopened = await c.getConversationHistory(view.conversationId);
        assert.equal(c.inspectConversation(view.conversationId).historyRef, historyRef);
        assert.equal(reopened.sessionManager.getBranch().at(-1).id, marker.id);
        assert.equal(c.inspectWork(navigated.workId).allowance.consumed, 5);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

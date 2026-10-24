import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
test('idle native !/!! retains exact owner source, zero model dispatch, owned runtime and sleeping-command response interrupt', { timeout: 10000 }, async () => {
    const runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/bash-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'owned.txt'), 'owner original');
    const c = await openController({ installationHome: home, runtimeProfile });
    await c.registerProject({ id: 'P', sourceRoot: source });
    process.env.TMPDIR = path.join(home, 'artifacts');
    let modelCalls = 0;
    const model = { provider: 'bash-only', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'bash-only-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m) {
                modelCalls++;
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    const message = { role: 'assistant', content: [{ type: 'text', text: 'Real initial ordinary response' }], api: m.api, provider: m.provider, model: m.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: 'stop', message });
                    stream.end(message);
                });
                return stream;
            } } };
    try {
        const v = c.createConversation({ projectId: 'P' }), raw = '  !!printf SECRET_COMMAND   ';
        await assert.rejects(c.executeConversationBash({ conversationId: v.conversationId, expectedGeneration: 0, command: 'printf forbidden-fresh', model }), /USER_BASH_HISTORY_REQUIRED/);
        assert.equal(c.store.all('SELECT * FROM runs').length, 0);
        await c.queueConversationInput({ conversationId: v.conversationId, expectedGeneration: 0, text: 'Real initial ordinary message', mode: 'idle' });
        assert.equal((await c.runConversation({ conversationId: v.conversationId, model })).status, 'delivered');
        const first = await c.executeConversationBash({ conversationId: v.conversationId, expectedGeneration: 1, command: 'printf SECRET_COMMAND', rawInput: raw, excludeFromContext: true, model });
        assert.equal(first.status, 'delivered', JSON.stringify(c.store.all('SELECT data FROM observations')));
        assert.equal(modelCalls, 1);
        const work = c.inspectWork(first.workId);
        assert.equal(c.store.one('SELECT raw FROM sources ORDER BY rowid DESC LIMIT 1').raw, raw);
        assert.equal(work.runs.at(-1).data.modelDispatchAttempted, undefined);
        const history = await fs.readFile(c.inspectConversation(v.conversationId).historyRef, 'utf8');
        assert.match(history, /SECRET_COMMAND/);
        assert.match(history, /excludeFromContext.*true/);
        let reached;
        const entered = new Promise(r => reached = r), observe = c.observeOperation.bind(c);
        c.observeOperation = (run, event) => {
            observe(run, event);
            if (event.type === 'bash_execution_update' && event.delta.includes('BASH_STARTED'))
                reached();
        };
        const view = c.inspectConversation(v.conversationId), second = c.executeConversationBash({ conversationId: v.conversationId, expectedGeneration: view.generation, command: 'printf BASH_STARTED; sleep 30', rawInput: '!printf BASH_STARTED; sleep 30', model });
        await entered;
        const current = c.inspectConversation(v.conversationId), epoch = c.inspectWork(current.workId).epoch;
        await assert.rejects(c.executeConversationBash({ conversationId: v.conversationId, expectedGeneration: current.generation, command: 'printf forbidden-active', model }), /USER_BASH_ACTIVE_UNAVAILABLE/);
        const start = performance.now();
        await c.interruptConversation({ conversationId: v.conversationId, expectedGeneration: current.generation });
        const interrupted = await second;
        assert.equal(interrupted.status, 'interrupted');
        assert.equal(interrupted.cleanup, 'removed');
        assert.ok(performance.now() - start < 2000);
        assert.equal(c.inspectWork(current.workId).epoch, epoch);
        assert.notEqual(c.inspectWork(current.workId).state, 'CANCELLED');
        assert.equal(modelCalls, 1);
        assert.equal(await fs.readFile(path.join(source, 'owned.txt'), 'utf8'), 'owner original');
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

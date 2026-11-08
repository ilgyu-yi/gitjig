import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import { ContainerScope } from '../../dist/execution/container-scope.js';
test('actual WAIT plus unavailable cleanup remains UNKNOWN/quarantined; exact restart reconciles owned runtime', { timeout: 10000 }, async () => {
    const runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/wait-cleanup-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'read.txt'), 'read');
    let c = await openController({ installationHome: home, runtimeProfile });
    await c.registerProject({ id: 'P', sourceRoot: source });
    process.env.TMPDIR = path.join(home, 'artifacts');
    const parent = c.createConversation({ projectId: 'P' }), child = c.createConversation({ projectId: 'P' });
    await c.queueConversationInput({ conversationId: parent.conversationId, expectedGeneration: 0, text: 'WAIT on retained pending assignment', mode: 'idle' });
    let calls = 0;
    const model = { provider: 'wait-cleanup', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'wait-cleanup-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m) {
                calls++;
                c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'A', parent.conversationId, child.conversationId, null, 'QUEUED', '{}');
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    const message = { role: 'assistant', content: [{ type: 'toolCall', id: 'wait', name: 'conversation_wait', arguments: { resultHandles: ['A'] } }], api: m.api, provider: m.provider, model: m.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: 'toolUse', message });
                    stream.end(message);
                });
                return stream;
            } } };
    const original = ContainerScope.prototype.close;
    try {
        ContainerScope.prototype.close = async function () {
            return { state: 'quarantined', containerId: this.containerId, reason: 'controlled cleanup observer unavailable' };
        };
        const result = await c.runConversation({ conversationId: parent.conversationId, model });
        ContainerScope.prototype.close = original;
        assert.equal(result.status, 'unavailable');
        assert.equal(c.inspectConversation(parent.conversationId).state, 'UNKNOWN');
        assert.equal(c.inspectWork(result.workId).state, 'UNKNOWN');
        assert.equal(c.store.one("SELECT state FROM capacity_leases WHERE run=?", result.runId).state, 'QUARANTINED');
        assert.equal(calls, 1);
        await c.close();
        c = await openController({ installationHome: home, runtimeProfile });
        assert.equal(c.inspectWork(result.workId).state, 'INTERRUPTED');
        assert.notEqual(c.inspectConversation(parent.conversationId).state, 'UNKNOWN');
        assert.equal(c.store.one('SELECT state FROM capacity_leases WHERE run=?', result.runId).state, 'RELEASED');
    }
    finally {
        ContainerScope.prototype.close = original;
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

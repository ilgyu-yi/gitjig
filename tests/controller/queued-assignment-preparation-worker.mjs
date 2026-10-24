import test from 'node:test';
import assert from 'node:assert/strict';

test('actual governed criteria read before allocation is held by transient preparation ownership', { timeout: 15000 }, async t => {
    const fs = (await import('node:fs/promises')).default, path = (await import('node:path')).default, os = (await import('node:os')).default;
    const { openController } = await import('../../dist/controller/index.js');
    const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/compat');
    const root = await fs.realpath(await fs.mkdtemp(path.join(await fs.realpath('/tmp'), 'gitjig-queued-preparing-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'file.txt'), 'Owned preparation source');
    const c = await openController({ installationHome: home, interactionDelegation: { projectIds: ['P'], maxAssignments: 1 } });
    const previousTmp = process.env.TMPDIR; process.env.TMPDIR = path.join(home, 'artifacts');
    const originalRead = fs.readFile; let release, entered, calls = 0, running, passed = false;
    const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source }); const parent = c.createConversation().conversationId;
        await c.queueConversationInput({ conversationId: parent, expectedGeneration: c.inspectConversation(parent).generation, text: 'Prepare one original task', mode: 'idle' });
        fs.readFile = async function(file, ...args) {
            if (file instanceof URL && file.pathname.endsWith('/MISSION.md')) { entered(); await gate; }
            return originalRead.call(this, file, ...args);
        };
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const model = { provider: 'queued-preparation-fixture', modelId: 'fixture', definition: { api: 'queued-preparation-api', apiKey: 'UNUSED', baseUrl: 'http://unused.invalid', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1024, cost: usage.cost }], streamSimple(m) {
            const stream = createAssistantMessageEventStream(), content = ++calls === 1 ? [{ type: 'toolCall', id: 'original-queued-preparation', name: 'conversation_assign', arguments: { projectId: 'P', operation: 'change', instructions: 'Owned preparation only', resultDependency: true } }] : [{ type: 'text', text: 'Original assignment queued.' }];
            const message = { role: 'assistant', content, api: m.api, provider: m.provider, model: m.id, usage, stopReason: calls === 1 ? 'toolUse' : 'stop', timestamp: Date.now() };
            queueMicrotask(() => { stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message); }); return stream;
        } } };
        running = c.runConversation({ conversationId: parent, model });
        let timer; try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Original criteria preparation did not start: ' + JSON.stringify({ assignments: c.store.all('SELECT * FROM conversation_assignments'), results: c.store.all('SELECT * FROM conversation_results') }))), 8000); })]); } finally { clearTimeout(timer); }
        const row = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', parent);
        assert.equal(row.state, 'QUEUED'); assert.equal(row.work, null); assert.equal(c.inspectConversation(row.target).workId, null);
        const input = { conversationId: row.target, expectedGeneration: c.inspectConversation(row.target).generation, assignmentId: row.id };
        assert.throws(() => c.inspectQueuedAssignmentCancellation(input), /preparation or execution is active/);
        assert.equal(c.store.one('SELECT COUNT(*) n FROM works WHERE project=?', 'P').n, 0);
        await c.cancelAssignment({ assignmentId: row.id, reason: 'Existing cancellation revokes the original before held criteria returns' });
        fs.readFile = originalRead; release(); await running; await c.ordinary.drain();
        assert.equal(c.store.one('SELECT COUNT(*) n FROM works WHERE project=?', 'P').n, 0);
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', row.id).state, 'CANCELLED'); passed = true;
    } finally {
        fs.readFile = originalRead; release(); await running?.catch(() => {}); await c.close();
        if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
        if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained original criteria preparation: ' + root);
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
test('two explicit projects and three ordinary C retain actual scope identity under cap2; queued control never borrows another root', { timeout: 10000 }, async () => {
    const runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
    assert.ok(runtimeProfile.dockerContext && runtimeProfile.image);
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/projects-'))), home = path.join(root, 'home'), p = path.join(root, 'P'), q = path.join(root, 'Q');
    await fs.mkdir(p);
    await fs.mkdir(q);
    await fs.writeFile(path.join(p, 'marker.txt'), 'P-WORKTREE-MARKER');
    await fs.writeFile(path.join(q, 'marker.txt'), 'Q-WORKTREE-MARKER');
    const c = await openController({ installationHome: home, runtimeProfile });
    await c.registerProject({ id: 'P', sourceRoot: p });
    await c.registerProject({ id: 'Q', sourceRoot: q });
    process.env.TMPDIR = path.join(home, 'artifacts');
    let releaseP, releaseQ, pEntered, qEntered;
    const pBarrier = new Promise(r => releaseP = r), qBarrier = new Promise(r => releaseQ = r), pe = new Promise(r => pEntered = r), qe = new Promise(r => qEntered = r), turns = new Map();
    const model = { provider: 'project-scopes', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'project-scopes-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m, context) {
                const first = context.messages.find(v => v.role === 'user'), text = typeof first.content === 'string' ? first.content : first.content.filter(v => v.type === 'text').map(v => v.text).join(''), turn = turns.get(text) ?? 0;
                turns.set(text, turn + 1);
                const stream = createAssistantMessageEventStream();
                void (async () => {
                    if (turn === 0 && text === 'P work') {
                        pEntered();
                        await pBarrier;
                    }
                    if (turn === 0 && text === 'Q work') {
                        qEntered();
                        await qBarrier;
                    }
                    let tool;
                    if (turn === 0)
                        tool = { name: 'read', arguments: { path: 'marker.txt' } };
                    if (text === 'P work' && turn === 1)
                        tool = { name: 'read', arguments: { path: path.join(q, 'marker.txt') } };
                    const message = { role: 'assistant', content: tool ? [{ type: 'toolCall', id: text + turn, name: tool.name, arguments: tool.arguments }] : [{ type: 'text', text: 'Actual scope receipts retained' }], api: m.api, provider: m.provider, model: m.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: tool ? 'toolUse' : 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: message.stopReason, message });
                    stream.end(message);
                })();
                return stream;
            } } };
    try {
        const pc = c.createConversation({ projectId: 'P' }), qc = c.createConversation({ projectId: 'Q' }), control = c.createConversation();
        for (const [view, text] of [[pc, 'P work'], [qc, 'Q work'], [control, 'Control no project']])
            await c.queueConversationInput({ conversationId: view.conversationId, expectedGeneration: 0, text, mode: 'idle' });
        const pt = c.runConversation({ conversationId: pc.conversationId, model }), qt = c.runConversation({ conversationId: qc.conversationId, model });
        await Promise.all([pe, qe]);
        const ct = c.runConversation({ conversationId: control.conversationId, model });
        for (let i = 0; i < 100 && !c.store.one("SELECT id FROM capacity_leases WHERE state='QUEUED'"); i++)
            await new Promise(r => setImmediate(r));
        assert.equal(c.getNativeHandle(control.conversationId), null);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state='ADMITTED'").n, 2);
        releaseP();
        const pr = await pt, cr = await ct;
        assert.equal(pr.status, 'delivered');
        assert.equal(cr.status, 'delivered');
        assert.ok(c.getNativeHandle(qc.conversationId));
        releaseQ();
        const qr = await qt;
        assert.equal(qr.status, 'delivered');
        const ph = await fs.readFile(c.inspectConversation(pc.conversationId).historyRef, 'utf8'), qh = await fs.readFile(c.inspectConversation(qc.conversationId).historyRef, 'utf8'), ch = await fs.readFile(c.inspectConversation(control.conversationId).historyRef, 'utf8');
        assert.match(ph, /P-WORKTREE-MARKER/);
        assert.doesNotMatch(ph, /Q-WORKTREE-MARKER/);
        assert.match(qh, /Q-WORKTREE-MARKER/);
        assert.match(ch, /PROJECT_UNBOUND/);
        const observations = c.store.all('SELECT data FROM observations WHERE run=?', pr.runId).map(r => JSON.parse(r.data));
        assert.ok(observations.some(o => o.type === 'tool_execution_end' && o.result?.isError) || observations.some(o => o.type === 'tool_execution_end' && JSON.stringify(o.result).includes('outside')));
        assert.equal(c.inspectWork(pr.workId).projectId, 'P');
        assert.equal(c.inspectWork(qr.workId).projectId, 'Q');
        assert.equal(c.inspectWork(cr.workId).projectId, null);
        assert.equal(await fs.readFile(path.join(p, 'marker.txt'), 'utf8'), 'P-WORKTREE-MARKER');
        assert.equal(await fs.readFile(path.join(q, 'marker.txt'), 'utf8'), 'Q-WORKTREE-MARKER');
    }
    finally {
        releaseP();
        releaseQ();
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

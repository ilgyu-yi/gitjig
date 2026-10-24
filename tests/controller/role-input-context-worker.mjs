import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { capture } from '../../dist/controller/capture.js';
import { assertCapturedInputRun, prepareCapturedInput } from '../../dist/controller/input-context.js';

initializeApplicationEnvironment();
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw Error('No model calls in role input fixture'); };
net.Socket.prototype.connect = function () { externalCalls++; throw Error('No sockets in role input fixture'); };
const root = process.argv[2], home = path.join(root, 'app'), project = path.join(root, 'project');
await fs.mkdir(project, { mode: 0o700 });
await fs.writeFile(path.join(project, 'file.txt'), 'IMMUTABLE_ROLE_CONTEXT');
const c = await openController({ installationHome: home });
let pi, identity;
try {
    await c.registerProject({ id: 'P', sourceRoot: project });
    const owner = c.createConversation({ projectId: 'P' });
    const source = await c.queueConversationInput({ conversationId: owner.conversationId, expectedGeneration: 0, text: 'Controlled unexecuted role fixture', mode: 'idle' });
    const workcopy = path.join(root, 'workcopy');
    await fs.mkdir(workcopy, { mode: 0o700 });
    const manifest = await capture(project, workcopy, { maxEntries: 100, maxBytes: 1048576, timeoutMs: 1000 }).result;
    // Controlled role admission/capture premise, not an engine execution or semantic review.
    // Conversation generation 1 and work generation 7 are intentionally independent.
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', source.sourceId, null, 'W', 'ACTIVE', 3, 7, null, '{}');
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 3, 7, 'RUNNING', workcopy, 'reserved', JSON.stringify({ kind: 'governed-role', role: 'reviewer', launchId: 'L', attainedCapture: true, manifest }));
    c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'L', 'W', 'R', 'reviewer', 3, 'RUNNING', 'none', '{}');
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W2', 'P', source.sourceId, null, 'W2', 'ACTIVE', 3, 7, null, '{}');
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R2', 'W2', 3, 7, 'RUNNING', workcopy, 'reserved', '{}');
    identity = c.interactionCore.allocateRole({ workId: 'W', runId: 'R', launchId: 'L', role: 'reviewer' });
    const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
    const forbidden = async () => { throw Error('No project operation'); };
    pi = await createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: forbidden, readFile: forbidden, access: forbidden, writeFile: forbidden, mkdir: forbidden },
        model: { provider: 'role-context-fixture', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_ONLY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } },
        systemPrompt: 'Queue-only fixture; no generation.', maxReadBytes: 1024 });
    c.interactionCore.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
    c.interactionCore.nativeBoundary(identity); // Controlled initial user observation, as in existing SDK queue fixture.
    const queued = c.interactionCore.enqueue({ conversationId: identity.conversationId, expectedGeneration: 1, text: 'inspect context', mode: 'steer' });
    assertCapturedInputRun(c.store, queued.inputId, identity, 'live');
    const originalLaunch = c.store.one('SELECT * FROM role_launches WHERE id=?', 'L');
    for (const bad of [{ run: 'R2' }, { work: 'W2' }, { epoch: 4 }, { role: 'implementer' }, { status: 'COMPLETE' }]) {
        const [field, value] = Object.entries(bad)[0];
        c.store.run(`UPDATE role_launches SET ${field}=? WHERE id=?`, value, 'L');
        assert.throws(() => assertCapturedInputRun(c.store, queued.inputId, identity, 'live'), /identity or generation/);
        c.store.run(`UPDATE role_launches SET ${field}=? WHERE id=?`, originalLaunch[field], 'L');
    }
    for (const bad of [{ ...identity, launchId: 'foreign' }, { ...identity, generation: 7 }, { ...identity, initialInputId: queued.inputId }])
        assert.throws(() => assertCapturedInputRun(c.store, queued.inputId, bad, 'live'), /identity or generation/);
    const runData = c.store.one('SELECT data FROM runs WHERE id=?', 'R').data;
    for (const change of [{ kind: 'publication-judgment' }, { launchId: 'other' }, { role: 'implementer' }]) {
        c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(runData), ...change }), 'R');
        assert.throws(() => assertCapturedInputRun(c.store, queued.inputId, identity, 'live'), /identity or generation/);
    }
    c.store.run('UPDATE runs SET data=? WHERE id=?', runData, 'R');
    const originalInput = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', identity.initialInputId);
    for (const change of [{ mode: 'steer' }, { state: 'INITIAL_RESERVED' }, { generation: 7 }, { data: '{"launchId":"other"}' }]) {
        const [field, value] = Object.entries(change)[0];
        c.store.run(`UPDATE conversation_inputs SET ${field}=? WHERE id=?`, value, identity.initialInputId);
        assert.throws(() => assertCapturedInputRun(c.store, queued.inputId, identity, 'live'), /identity or generation/);
        c.store.run(`UPDATE conversation_inputs SET ${field}=? WHERE id=?`, originalInput[field], identity.initialInputId);
    }
    assert.throws(() => assertCapturedInputRun(c.store, queued.inputId, identity, 'initial'), /identity or generation/);
    c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONFLICTED', queued.inputId);

    const live = await c.queueConversationInputWithContext({ conversationId: identity.conversationId, expectedGeneration: 1, text: 'steer @file.txt', mode: 'steer' });
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', live.inputId).state, 'NATIVE_PENDING');
    assert.match(pi.session.getSteeringMessages()[0], /IMMUTABLE_ROLE_CONTEXT/);
    const routed = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data).routedInputs.at(-1);
    assert.equal(routed.comparison.captureDigest, manifest.digest);
    assert.deepEqual(routed.comparison.files, [{ path: 'file.txt', status: 'same' }]);
    pi.session.clearQueue(); c.interactionCore.nativeBoundary(identity);

    const originalOpen = fs.open;
    let drifted = false;
    fs.open = async function (file, flags, ...rest) {
        const handle = await originalOpen.call(this, file, flags, ...rest);
        if (!drifted && typeof file === 'string' && file.startsWith(path.join(home, 'state/input-context') + path.sep) && flags !== 'wx') {
            drifted = true;
            c.store.run('UPDATE role_launches SET status=? WHERE id=?', 'COMPLETE', 'L');
        }
        return handle;
    };
    let stale;
    try { stale = await c.queueConversationInputWithContext({ conversationId: identity.conversationId, expectedGeneration: 1, text: 'late @file.txt', mode: 'steer' }); }
    finally { fs.open = originalOpen; }
    assert.equal(drifted, true);
    const staleRow = c.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', stale.inputId);
    assert.equal(staleRow.state, 'QUEUED');
    assert.match(JSON.parse(staleRow.data).routeError, /identity or generation/);
    assert.deepEqual(pi.session.getSteeringMessages(), []);
    await assert.rejects(prepareCapturedInput(c.store, path.join(home, 'state'), stale.inputId, { identity, kind: 'live' }), /identity or generation/);
    c.store.run('UPDATE role_launches SET status=? WHERE id=?', 'RUNNING', 'L');
    assert.equal(externalCalls, 0);
    process.stdout.write(JSON.stringify({ outcome: 'passed', externalCalls, driftRefused: true }));
} finally {
    if (identity && pi) { c.interactionCore.lifecycle.settling(identity); await c.interactionCore.drainNativeInputs(identity); c.interactionCore.lifecycle.released(identity); }
    await pi?.closeOwned();
    await c.close();
}

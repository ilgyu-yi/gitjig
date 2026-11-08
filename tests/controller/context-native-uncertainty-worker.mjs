import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { capture } from '../../dist/controller/capture.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
initializeApplicationEnvironment(); let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No requests in uncertainty fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No sockets in uncertainty fixture'); };
const root = process.argv[2], scenario = Number(process.argv[3]);
assert.ok(Number.isSafeInteger(scenario) && scenario >= 0 && scenario <= 5);
let serial = scenario;
const model = { provider: 'uncertainty-fixture', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } };
// A declared non-executable profile for a pre-aborted admission only. No engine operation is selected.
const runtimeProfile = { dockerBinary: '/usr/bin/false', dockerContext: 'never-dispatch', image: 'sha256:' + '0'.repeat(64) };
const tables = ['sources', 'conversation_inputs', 'conversation_directions', 'works', 'runs', 'budgets', 'capacity_leases', 'conversations', 'conversation_state'];
const snapshot = c => Object.fromEntries(tables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
async function session(home, project) {
    const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') }), deny = async () => { throw Error('No operations in original SDK queue fixture'); };
    return createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: deny, readFile: deny, access: deny, writeFile: deny, mkdir: deny }, model, systemPrompt: 'Unstarted non-authority queue controls; no model generation.', maxReadBytes: 1024 });
}
async function world() {
    const n = serial++, home = path.join(root, 'a' + n), project = path.join(root, 'user', 'p' + n), workcopy = path.join(root, 'w' + n);
    await fs.mkdir(project); await fs.mkdir(workcopy); await fs.writeFile(path.join(project, 'file'), 'CAPTURED');
    let c = await openController({ installationHome: home, runtimeProfile }); await c.registerProject({ id: 'P', sourceRoot: project });
    const v = c.createConversation({ projectId: 'P' }), cid = v.conversationId, initial = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: 'initial @file', mode: 'idle' });
    const manifest = await capture(project, workcopy, { maxEntries: 100, maxBytes: 1048576, timeoutMs: 1000 }).result;
    // Controlled UNSTARTED producer, never a successful engine/model/review record.
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', initial.sourceId, null, 'W', 'ACTIVE', 1, 1, null, '{"fixture":"unstarted native uncertainty"}');
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'INTERRUPTED', workcopy, 'consumed', JSON.stringify({ fixture: 'unstarted native uncertainty', unbound: true, conversation: cid, initialInputId: initial.inputId, attainedCapture: true, manifest }));
    c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', '{"runId":"R"}', cid);
    c.store.run('UPDATE conversation_inputs SET generation=1,work=?,state=? WHERE id=?', 'W', 'INITIAL_RESERVED', initial.inputId);
    const pi = await session(home, project), identity = { conversationId: cid, workId: 'W', runId: 'R', launchId: null, generation: 1, directionRevision: 1, initialInputId: initial.inputId };
    c.interactions.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
    c.interactions.nativeBoundary(identity); // Controlled callback, not a generated user/model event.
    // Original persisted native file and actual checkpoint support the healthy next-admission comparator.
    pi.sessionManager.appendMessage({ role: 'user', content: 'NON_AUTHORITY_QUEUE_FIXTURE', timestamp: Date.now() });
    const file = pi.sessionManager.getSessionFile(), checkpoint = await nativeCheckpoint(file);
    const data = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data);
    c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...data, historyRef: file, nativeSessionId: pi.sessionManager.getSessionId(), nativeCheckpoint: checkpoint, attainedNative: true }), 'R');
    const later = c.interactions.enqueue({ conversationId: cid, expectedGeneration: 1, text: 'NEXT_OWNER', mode: 'idle' });
    const sibling = c.createConversation();
    return { home, project, pi, identity, cid, later, sibling, get c() { return c; }, async reopen() { c = await openController({ installationHome: home, runtimeProfile }); } };
}
async function closeNative(f) {
    f.c.interactions.lifecycle.settling(f.identity); await f.c.interactions.drainNativeInputs(f.identity); f.c.interactions.lifecycle.released(f.identity);
    await f.pi.closeOwned(); f.c.interactions.cleanup(f.identity, { cleanup: 'unbound', settled: true });
}
async function refused(f) {
    const before = snapshot(f.c), abort = new AbortController(); abort.abort();
    assert.throws(() => f.c.queueConversationInput({ conversationId: f.cid, expectedGeneration: 1, text: 'FORBIDDEN', mode: 'idle' }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
    await assert.rejects(async () => f.c.runConversation({ conversationId: f.cid, initialInputId: f.later.inputId, model, signal: abort.signal }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
    assert.deepEqual(snapshot(f.c), before);
    assert.equal(f.c.inspectConversation(f.cid).state, 'UNKNOWN');
    assert.doesNotThrow(() => f.c.inspectConversationContext({ conversationId: f.cid, expectedGeneration: 1 }));
    assert.ok(await f.c.getConversationHistory(f.cid));
    assert.ok(f.c.inspectConversation(f.sibling.conversationId)); // Read-only unrelated access remains available.
    assert.doesNotThrow(()=>f.c.setConversationView({selectedId:f.cid,secondId:f.sibling.conversationId}));
    const viewed=snapshot(f.c);
    assert.throws(()=>f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:1,text:'VIEW_IS_NOT_RECOVERY',mode:'idle'}),/NATIVE_INPUT_RECOVERY_REQUIRED/);
    assert.deepEqual(snapshot(f.c),viewed);

}
for (const pending of [true, false]) for (const mode of ['quiesce', 'drain']) {
    if ((pending ? 0 : 2) + (mode === 'drain' ? 1 : 0) !== scenario) continue;
    const f = await world(); let nativeClosed = false;
    try {
        let owned, context;
        if (pending) { owned = await f.c.queueConversationInputWithContext({ conversationId: f.cid, expectedGeneration: 1, text: 'OWNED @file', mode: 'steer' }); context = JSON.parse(f.c.store.one('SELECT data FROM conversation_inputs WHERE id=?', owned.inputId).data).context; }
        await f.pi.session.steer('UNOWNED_PRIVATE_QUEUE_TEXT');
        assert.equal(f.pi.session.getSteeringMessages().length, pending ? 2 : 1);
        if (mode === 'quiesce') assert.throws(() => f.c.interactions.quiesceNative(f.identity), /NATIVE_INPUT_RECOVERY_REQUIRED/); else await f.c.interactions.drainNativeInputs(f.identity);
        assert.equal(f.pi.session.getSteeringMessages().length, 0);
        const state = JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.cid).data), marker = state.nativeInputRecovery;
        assert.deepEqual(marker, { format: 'gitjig-native-input-recovery-1', runId: 'R', generation: 1, reason: 'queue-disposition-uncertain', ...(owned ? { inputId: owned.inputId } : {}), clearCounts: { steering: pending ? 2 : 1, followUp: 0 } });
        assert.doesNotMatch(JSON.stringify(marker), /UNOWNED_PRIVATE_QUEUE_TEXT/);
        if (owned) { const row = f.c.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', owned.inputId); assert.equal(row.state, 'RECONCILIATION_REQUIRED'); assert.deepEqual(JSON.parse(row.data).context, context); assert.deepEqual(JSON.parse(row.data).clearReceipt, marker.clearCounts); }
        await closeNative(f); nativeClosed = true;
        const after = JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.cid).data); assert.deepEqual(after.nativeInputRecovery, marker); assert.deepEqual(after.cleanup, { cleanup: 'unbound', settled: true });
        await refused(f); await f.c.close(); await f.reopen(); await refused(f);
        assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.cid).data).nativeInputRecovery, marker);
        // Present malformed/null facts also fail closed; this is controlled corruption, never recovery.
        for (const invalid of [null, false, { format: 'wrong' }]) { f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...after, nativeInputRecovery: invalid }), f.cid); await refused(f); }
        f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(after), f.cid);
        const healthy = await f.c.queueConversationInput({ conversationId: f.sibling.conversationId, expectedGeneration: 0, text: 'UNRELATED', mode: 'idle' }); assert.ok(healthy.inputId);
    } finally { if (!nativeClosed) { await f.c.interactions.drainNativeInputs(f.identity); f.c.interactions.lifecycle.released(f.identity); await f.pi.closeOwned(); } await f.c.close(); }
}
if (scenario === 4) {
    const f = await world(); let closed = false;
    try {
        await closeNative(f); closed = true;
        const abort = new AbortController(); abort.abort(); const before = f.c.store.one('SELECT COUNT(*) AS n FROM runs').n;
        await assert.rejects(f.c.runConversation({ conversationId: f.cid, initialInputId: f.later.inputId, model, signal: abort.signal }), { name: 'AbortError' });
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, before, 'Pre-aborted admission cannot allocate or charge another run');
        assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state='ADMITTED'").n, 0);
    } finally { if (!closed) await closeNative(f); await f.c.close(); }
}
if (scenario === 5) {
    const f = await world(); let second;
    try {
        await closeNative(f);
        second = await session(f.home, f.project);
        f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R2', 'W', 1, 2, 'INTERRUPTED', root, 'consumed', '{"fixture":"unstarted distinct replacement","unbound":true}');
        f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', '{"runId":"R2"}', f.cid);
        const identity = { ...f.identity, runId: 'R2', generation: 2 };
        f.c.interactions.lifecycle.ready({ identity, session: second.session, sessionManager: second.sessionManager, executeUserBash: second.executeUserBash });
        await second.session.steer('REPLACEMENT_UNOWNED_FIXTURE'); const before = snapshot(f.c);
        f.c.interactions.lifecycle.settling(f.identity); f.c.interactions.lifecycle.released(f.identity); f.c.interactions.cleanup(f.identity, { cleanup: 'unbound', settled: true });
        assert.deepEqual(snapshot(f.c), before); assert.deepEqual(second.session.getSteeringMessages(), ['REPLACEMENT_UNOWNED_FIXTURE']);
        second.session.clearQueue(); // Explicit fixture cleanup, never a semantic recovery operation.
        f.c.interactions.lifecycle.settling(identity); await f.c.interactions.drainNativeInputs(identity); f.c.interactions.lifecycle.released(identity); await second.closeOwned(); second = undefined;
    } finally { if (second) await second.closeOwned(); await f.c.close(); }
}
assert.equal(requests, 0); console.log(JSON.stringify({ outcome: 'passed', requests, scenario }));

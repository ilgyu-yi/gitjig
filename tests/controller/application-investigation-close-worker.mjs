// NON_AUTHORITY unstarted original SDK registration; no model or engine execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { capture } from '../../dist/controller/capture.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), project = path.join(root, 'user', 'project'), workcopy = path.join(root, 'workcopy');
let requests = 0, fallback = false, pi, c, input, timer;
const events = [], activeAbort = new AbortController(), entered = Promise.withResolvers(), interrupted = Promise.withResolvers();
globalThis.fetch = async () => { requests++; throw Error('No request in close ordering fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No socket in close ordering fixture'); };
try {
    await fs.mkdir(project); await fs.mkdir(workcopy); await fs.writeFile(path.join(project, 'file'), 'ACTUAL_CAPTURE');
    c = await openController({ installationHome: home }); await c.registerProject({ id: 'P', sourceRoot: project });
    const cid = c.createConversation({ projectId: 'P' }).conversationId;
    const initial = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: 'Initial @file', mode: 'idle' });
    const manifest = await capture(project, workcopy, { maxEntries: 100, maxBytes: 1048576, timeoutMs: 1000 }).result;
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', initial.sourceId, null, 'W', 'ACTIVE', 1, 1, null, JSON.stringify({ fixture: 'NON_AUTHORITY unstarted close owner', conversation: cid }));
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'INTERRUPTED', workcopy, 'consumed', JSON.stringify({ fixture: 'NON_AUTHORITY unstarted original registration', unbound: true, conversation: cid, initialInputId: initial.inputId, attainedCapture: true, manifest }));
    c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', '{"runId":"R"}', cid);
    c.store.run('UPDATE conversation_inputs SET generation=1,work=?,state=? WHERE id=?', 'W', 'INITIAL_RESERVED', initial.inputId);
    const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
    const deny = async () => { throw Error('No project operation in unstarted fixture'); };
    pi = await createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: deny, readFile: deny, access: deny, writeFile: deny, mkdir: deny },
        model: { provider: 'close-fixture', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } },
        systemPrompt: 'Unstarted close ordering control; no generation.', maxReadBytes: 1024 });
    const identity = { conversationId: cid, workId: 'W', runId: 'R', launchId: null, generation: 1, directionRevision: 1, initialInputId: initial.inputId };
    c.interactions.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
    c.interactions.nativeBoundary(identity);
    pi.sessionManager.appendMessage({ role: 'user', content: 'NON_AUTHORITY unstarted user checkpoint', timestamp: Date.now() });
    const historyRef = pi.sessionManager.getSessionFile(), checkpoint = await nativeCheckpoint(historyRef);
    const data = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data);
    c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...data, historyRef, nativeSessionId: pi.sessionManager.getSessionId(), nativeCheckpoint: checkpoint, attainedNative: true }), 'R');
    activeAbort.signal.addEventListener('abort', () => { events.push('producer-abort'); interrupted.resolve(); }, { once: true });
    c.active.set('W', { abort: activeAbort, done: Promise.resolve() });
    const extension = pi.resourceLoader.getExtensions().extensions[0];
    extension.handlers.set('input', [async () => {
        events.push('sdk-handler-entered'); entered.resolve();
        await interrupted.promise;
        // A settling producer can leave the active map before the independently owned input tail.
        c.active.delete('W'); events.push('producer-settled');
        events.push('sdk-handler-settled'); return { action: 'continue' };
    }]);
    c.adoptApplicationResource({ close: async () => {
        events.push('application-close'); assert.ok(events.includes('input-tail-settled'));
        c.interactions.lifecycle.settling(identity); await c.interactions.drainNativeInputs(identity); c.interactions.lifecycle.released(identity);
        await pi.closeOwned(); pi = undefined; c.interactions.cleanup(identity, { cleanup: 'unbound', settled: true });
    } });
    input = c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'Routed @file', mode: 'steer' });
    void input.then(() => events.push('input-tail-settled'));
    await entered.promise;
    assert.equal(c.store.one("SELECT state FROM conversation_inputs WHERE text='Routed @file'").state, 'NATIVE_PENDING');
    // Only failure cleanup may release the discriminator. A pass must get the original active cancellation first.
    timer = setTimeout(() => { fallback = true; events.push('FAILURE_FALLBACK'); activeAbort.abort(); }, 750);
    await c.close(); clearTimeout(timer); await input;
    assert.equal(fallback, false); assert.equal(requests, 0);
    c = await openController({ installationHome: home });
    assert.equal(c.store.one('SELECT state FROM works WHERE id=?', 'W').state, 'CANCELLED');
    assert.equal(c.store.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.kind')='owner-task-cancel'").n, 1);
    assert.ok(events.indexOf('producer-abort') < events.indexOf('sdk-handler-settled'));
    assert.ok(events.indexOf('sdk-handler-settled') < events.indexOf('application-close'));
    await fs.writeFile(path.join(root, 'close-receipt.json'), JSON.stringify({ outcome: 'passed', requests, fallback, events, work: c.store.one('SELECT * FROM works WHERE id=?', 'W'), input: c.store.one("SELECT * FROM conversation_inputs WHERE text='Routed @file'") }));
} catch (error) {
    await fs.writeFile(path.join(root, 'close-failure.json'), JSON.stringify({ message: error.message, stack: error.stack, requests, fallback, events })); throw error;
} finally {
    clearTimeout(timer); activeAbort.abort(); await input?.catch(() => {}); await pi?.closeOwned(); await c?.close();
}
console.log(JSON.stringify({ outcome: 'passed', requests, fallback, events }));

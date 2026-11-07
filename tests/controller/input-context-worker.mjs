import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { capture } from '../../dist/controller/capture.js';
import { prepareCapturedInput, buildCapturedInput } from '../../dist/controller/input-context.js';

initializeApplicationEnvironment(); let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No fetch in captured queue fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No socket in captured queue fixture'); };
const root = process.argv[2], home = path.join(root, 'worker-app'), project = path.join(root, 'project');
const c = await openController({ installationHome: home }); let pi, deliberatelyFailedClose = false;
const deferred = () => Promise.withResolvers();
try {
    await c.registerProject({ id: 'P', sourceRoot: project }); await fs.writeFile(path.join(project, 'file.txt'), 'CAPTURED_BEFORE_LIVE_EDIT');
    const v = c.createConversation({ projectId: 'P' }), cid = v.conversationId;
    await fs.writeFile(path.join(project, 'AGENTS.md'), 'ROOT_SAME');
    await fs.writeFile(path.join(project, 'gone.txt'), 'SUBMITTED_THEN_REMOVED');
    const initial = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: 'initial @file.txt @gone.txt', mode: 'idle' });
    await fs.writeFile(path.join(project, 'file.txt'), 'ACTUAL_WORKCOPY'); await fs.rm(path.join(project, 'gone.txt'));
    const workcopy = path.join(root, 'comparison-workcopy'); await fs.mkdir(workcopy, { mode: 0o700 });
    const manifest = await capture(project, workcopy, { maxEntries: 100, maxBytes: 1048576, timeoutMs: 1000 }).result;
    assert.equal(await fs.readFile(path.join(workcopy, 'file.txt'), 'utf8'), 'ACTUAL_WORKCOPY');
    await fs.writeFile(path.join(project, 'file.txt'), 'CAPTURED_BEFORE_LIVE_EDIT');
    // Explicit unstarted, non-authority state-machine fixture, not a successful run or engine turn.
    c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', initial.sourceId, null, 'W', 'ACTIVE', 1, 1, null, '{"fixture":"non-authority queue controls"}');
    c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'CREATED', workcopy, 'reserved', JSON.stringify({ fixture: 'non-authority queue controls', conversation: cid, initialInputId: initial.inputId, attainedCapture: true, manifest }));
    c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', '{"runId":"R"}', cid);
    c.store.run('UPDATE conversation_inputs SET generation=1,work=?,state=? WHERE id=?', 'W', 'INITIAL_RESERVED', initial.inputId);
    const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
    const forbidden = async () => { throw Error('No project operation'); };
    pi = await createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: forbidden, readFile: forbidden, access: forbidden, writeFile: forbidden, mkdir: forbidden },
        model: { provider: 'context-fixture', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_CONTEXT_ONLY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } },
        systemPrompt: 'Queue semantics fixture. No model generation.', maxReadBytes: 1024 });
    const identity = { conversationId: cid, workId: 'W', runId: 'R', launchId: null, generation: 1, directionRevision: 1, initialInputId: initial.inputId };
    const interactions = c.interactions;
    interactions.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
    const beforePrepare = c.store.one('SELECT data FROM runs WHERE id=?', 'R').data;
    const prepared = await prepareCapturedInput(c.store, path.join(home, 'state'), initial.inputId, { identity, kind: 'initial' });
    const initialPrompt = prepared.text;
    assert.deepEqual(prepared.comparison.files, [{ path: 'AGENTS.md', status: 'same' }, { path: 'file.txt', status: 'different' }, { path: 'gone.txt', status: 'missing' }]);
    assert.equal(prepared.comparison.phase, 'prepared'); assert.equal(prepared.comparison.submissionGeneration, 0); assert.equal(prepared.comparison.generation, 1);
    assert.equal(prepared.comparison.captureDigest, manifest.digest); assert.equal(prepared.comparison.runId, 'R');
    assert.equal(prepared.comparison.inputId, initial.inputId); assert.equal(prepared.comparison.sourceId, initial.sourceId);
    assert.equal(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data, beforePrepare, 'Preparation has no persistence side effects');
    for (const bad of [{ ...identity, runId: 'OTHER' }, { ...identity, conversationId: 'OTHER' }, { ...identity, generation: 2 }, { ...identity, initialInputId: 'OTHER' }])
        await assert.rejects(prepareCapturedInput(c.store, path.join(home, 'state'), initial.inputId, { identity: bad, kind: 'initial' }), /identity or generation/);
    for (const bad of [{ ...JSON.parse(beforePrepare), attainedCapture: false }, { ...JSON.parse(beforePrepare), manifest: { ...manifest, digest: '0'.repeat(64) } },
        { ...JSON.parse(beforePrepare), manifest: { ...manifest, bytes: manifest.bytes + 1 } }]) {
        c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(bad), 'R');
        await assert.rejects(prepareCapturedInput(c.store, path.join(home, 'state'), initial.inputId, { identity, kind: 'initial' }), /capture.*(unavailable|invalid)/);
    }
    c.store.run('UPDATE runs SET data=? WHERE id=?', beforePrepare, 'R');
    // Controlled boundary callback injection; not a generated user/model event.
    interactions.nativeBoundary(identity);
    const extension = pi.resourceLoader.getExtensions().extensions[0], previous = extension.handlers.get('input');
    const entered = deferred(), release = deferred();
    extension.handlers.set('input', [async () => { entered.resolve(); await release.promise; return { action: 'continue' }; }]);
    const pending = c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'steer @file.txt', mode: 'steer' });
    await entered.promise;
    const currentReceipt = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data).routedInputs.at(-1);
    assert.equal(currentReceipt.comparison.phase, 'prepared'); assert.equal(currentReceipt.comparison.captureDigest, manifest.digest);
    assert.deepEqual(currentReceipt.comparison.files, [{ path: 'AGENTS.md', status: 'same' }, { path: 'file.txt', status: 'different' }]);
    assert.equal(pi.session.getSteeringMessages().length, 0, 'Original public handler really precedes SDK enqueue');
    const before = JSON.stringify([c.store.all('SELECT * FROM conversation_inputs'), c.store.all('SELECT * FROM sources'), c.store.all('SELECT * FROM conversation_directions')]);
    await assert.rejects(c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, text: 'too early', mode: 'idle' }), /delivery is settling/);
    assert.throws(() => interactions.quiesceNative(identity), /delivery is settling/);
    assert.equal(JSON.stringify([c.store.all('SELECT * FROM conversation_inputs'), c.store.all('SELECT * FROM sources'), c.store.all('SELECT * FROM conversation_directions')]), before);
    // An invalid release retains the ORIGINAL registration/tail and refuses clean completion.
    assert.throws(() => interactions.lifecycle.released(identity), /producer still active/); assert.equal(interactions.getHandle(cid).session, pi.session);
    interactions.lifecycle.settling(identity); let drained = false;
    const drain = interactions.drainNativeInputs(identity).then(() => { drained = true; }); await Promise.resolve(); assert.equal(drained, false);
    await fs.writeFile(path.join(project, 'file.txt'), 'NEW_LIVE_SOURCE'); release.resolve();
    const steer = await pending; await drain;
    const row = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', steer.inputId), data = JSON.parse(row.data);
    assert.equal(row.state, 'QUEUED'); assert.equal(data.clearReceipt.steering, 1); assert.ok(data.context); assert.equal(pi.session.getSteeringMessages().length, 0);
    assert.match(await buildCapturedInput(c.store, path.join(home, 'state'), steer.inputId), /CAPTURED_BEFORE_LIVE_EDIT/);
    assert.doesNotMatch(await buildCapturedInput(c.store, path.join(home, 'state'), steer.inputId), /NEW_LIVE_SOURCE/);
    assert.match(initialPrompt, /CAPTURED_BEFORE_LIVE_EDIT/);
    if (previous) extension.handlers.set('input', previous); else extension.handlers.delete('input');
    // Test-control reset only; not a claim the queued request was consumed.
    c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONFLICTED', steer.inputId);
    c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'RUNNING', cid);
    const follow = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'follow @file.txt', mode: 'follow-up' });
    const queued = pi.session.getFollowUpMessages(); assert.equal(queued.length, 1); assert.match(queued[0], /NEW_LIVE_SOURCE/); assert.match(queued[0], /gitjig-user-context-1/);
    assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data).routedInputs.at(-1).context, JSON.parse(c.store.one('SELECT data FROM conversation_inputs WHERE id=?', follow.inputId).data).context);
    assert.equal(JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', 'R').data).routedInputs.at(-1).comparison.captureDigest, manifest.digest);
    pi.session.clearQueue(); interactions.nativeBoundary(identity); // Controlled consumption after observing the actual original queue.
    const parent = interactions.queue({ conversationId: cid, expectedGeneration: 1, text: '@../PARENT_LITERAL', mode: 'steer' }, identity);
    const owner = c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, text: 'OWNER_AFTER_PREPARING', mode: 'follow-up' });
    await parent; await owner; await new Promise(resolve => setImmediate(resolve));
    const parentRow = c.store.one('SELECT * FROM conversation_inputs WHERE text=?', '@../PARENT_LITERAL'); assert.equal(parentRow.state, 'CONFLICTED');
    assert.deepEqual(pi.session.getFollowUpMessages(), ['OWNER_AFTER_PREPARING']); assert.equal(pi.session.getSteeringMessages().length, 0);
    pi.session.clearQueue(); interactions.nativeBoundary(identity);
    // Callback-only late-failure control: original queue completed, controlled boundary observed, wrapper then rejects.
    const originalSteer = pi.session.steer.bind(pi.session), observed = deferred(), late = deferred();
    pi.session.steer = async text => { await originalSteer(text); pi.session.clearQueue(); interactions.nativeBoundary(identity); observed.resolve(); await late.promise; throw Error('CONTROLLED_LATE_REJECT'); };
    const delayed = c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'late @file.txt', mode: 'steer' });
    await observed.promise; late.resolve(); const lateReceipt = await delayed;
    const terminal = c.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', lateReceipt.inputId);
    assert.equal(terminal.state, 'CONSUMED'); assert.ok(JSON.parse(terminal.data).context); assert.match(JSON.parse(terminal.data).routeError, /CONTROLLED_LATE_REJECT/);
    pi.session.steer = originalSteer;
    const stale = interactions.enqueue({ conversationId: cid, expectedGeneration: 1, text: 'STALE_QUEUED_GENERATION', mode: 'follow-up' });
    c.store.run('UPDATE conversation_inputs SET generation=0 WHERE id=?', stale.inputId);
    await c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, text: 'AFTER_STALE', mode: 'follow-up' });
    await new Promise(resolve => setImmediate(resolve));
    const staleRow = c.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', stale.inputId);
    assert.equal(staleRow.state, 'QUEUED'); assert.match(JSON.parse(staleRow.data).routeError, /generation changed/);
    assert.equal(pi.session.getFollowUpMessages().length, 0, 'No rebuild loop or SDK delivery for unchanged stale row');
    c.store.run("UPDATE conversation_inputs SET state='CONFLICTED' WHERE state='QUEUED'"); // Explicit fixture reset, no consumed claim.
    const held = deferred(), releaseClose = deferred(); let tailSettled = false, modelClosed = false, closeSettled = false;
    extension.handlers.set('input', [async () => { held.resolve(); await releaseClose.promise; return { action: 'continue' }; }]);
    const duringClose = c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'close @file.txt', mode: 'steer' });
    const duringTail = duringClose.then(value => { tailSettled = true; return value; }, error => { tailSettled = true; throw error; });
    await held.promise;
    c.closeApplicationResources = async () => { throw Error('CONTROLLED_EARLY_CLOSE_FAILURE'); };
    // Callback sentinel for dependent resource ordering, not a qualified provider host.
    c.modelResource = { close: async () => { assert.equal(tailSettled, true); modelClosed = true; } };
    const closing = c.close().then(() => assert.fail('Earlier close failure erased'), error => { closeSettled = true; assert.match(String(error), /CONTROLLED_EARLY_CLOSE_FAILURE/); });
    await Promise.resolve(); await Promise.resolve(); assert.equal(closeSettled, false); assert.equal(modelClosed, false);
    releaseClose.resolve(); await duringTail; await closing;
    assert.equal(tailSettled, true); assert.equal(modelClosed, true); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM conversations').n, 1);
    deliberatelyFailedClose = true;
    if (previous) extension.handlers.set('input', previous); else extension.handlers.delete('input');
    interactions.lifecycle.settling(identity); await interactions.drainNativeInputs(identity); interactions.lifecycle.released(identity);
    await pi.closeOwned(); pi = undefined; assert.equal(requests, 0);
    const failedJoin = await openController({ installationHome: path.join(root, 'join-failure-app') });
    failedJoin.createConversation(); let closedUnknownModel = false;
    failedJoin.modelResource = { close: async () => { closedUnknownModel = true; } }; // Callback ordering sentinel only.
    failedJoin.interactions.drainNativeInputs = async () => { throw Error('CONTROLLED_UNKNOWN_JOIN'); };
    await assert.rejects(failedJoin.close(), /Owned input cleanup unavailable/);
    assert.equal(closedUnknownModel, false); assert.equal(failedJoin.store.one('SELECT COUNT(*) AS n FROM conversations').n, 1);
    failedJoin.store.close(); await failedJoin.releaseOwner(); // Explicit fixture cleanup; no actual producer existed in this separate failure control.
} finally {
    if (pi) await pi.closeOwned();
    if (deliberatelyFailedClose) { c.store.close(); await c.releaseOwner(); } // Owned fixture recovery after actual tail settlement, not product recovery proof.
    else await c.close();
}
console.log(JSON.stringify({ outcome: 'passed', requests }));

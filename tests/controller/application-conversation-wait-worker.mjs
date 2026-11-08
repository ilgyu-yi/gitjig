import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { coordination } from '../../dist/controller/coordination.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
initializeApplicationEnvironment(); let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No requests in actual WAIT fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No sockets in actual WAIT fixture'); };
const root = process.argv[2], home = path.join(root, 'app'), project = path.join(root, 'user', 'project');
await fs.mkdir(project);
let c = await openController({ installationHome: home });
await c.registerProject({ id: 'P', sourceRoot: project });
await ApplicationAccounts.open(c).configure({ providers: { 'wait-fixture': { api: 'openai-completions', apiKey: 'DUMMY_WAIT_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } } });
await ApplicationAccounts.open(c).setDefault('wait-fixture', 'fixed');
const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
const deny = async () => { throw Error('No operations in original SDK WAIT fixture'); };
const records = [];
try {
    for (const scenario of ['current', 'stale', 'uncertain', 'throw-unowned', 'throw-owned']) {
        const models = new ApplicationModels(c), v = await models.newConversation({ projectId: 'P' }), cid = v.conversationId;
        const initial = await c.queueConversationInput({ conversationId: cid, expectedGeneration: 0, text: 'NON_AUTHORITY original unstarted WAIT control', mode: 'idle' });
        const work = 'W-' + scenario, run = 'R-' + scenario, handle = 'A-' + scenario;
        // Controlled UNSTARTED producer and dependency, never a successful engine/model/review event.
        c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', work, 'P', initial.sourceId, null, work, 'ACTIVE', 1, 1, null, '{"fixture":"NON_AUTHORITY unstarted WAIT"}');
        c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, work, 1, 1, 'INTERRUPTED', root, 'none', '{"fixture":"NON_AUTHORITY unstarted WAIT"}');
        c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', handle, cid, cid, null, 'WAITING', '{"fixture":"NON_AUTHORITY handle"}');
        const originalData = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
        const preserved = { ...originalData, runId: run, contextMarker: { original: true }, fixture: 'NON_AUTHORITY unstarted WAIT' };
        c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(preserved), cid);
        c.store.run('UPDATE conversation_inputs SET generation=1,work=?,state=? WHERE id=?', work, 'INITIAL_RESERVED', initial.inputId);
        const model = await models.resolve(cid), choice = c.getConversationModelChoice(cid);
        const pi = await createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: deny, readFile: deny, access: deny, writeFile: deny, mkdir: deny }, model, systemPrompt: 'Unstarted NON_AUTHORITY WAIT control. No generation.', maxReadBytes: 1024 });
        const identity = { conversationId: cid, workId: work, runId: run, launchId: null, generation: 1, directionRevision: 1, initialInputId: initial.inputId };
        let onWait = 0;
        const quiesce = c.interactions.quiesceNative.bind(c.interactions), clear = pi.session.clearQueue.bind(pi.session);
        try {
            c.interactions.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
            c.interactions.nativeBoundary(identity); // Controlled original boundary callback, no model turn.
            pi.sessionManager.appendMessage({ role: 'user', content: 'NON_AUTHORITY_WAIT_HISTORY', timestamp: Date.now() });
            const file = pi.sessionManager.getSessionFile(), checkpoint = await nativeCheckpoint(file);
            c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ fixture: 'NON_AUTHORITY unstarted WAIT', conversation: cid, initialInputId: initial.inputId, historyRef: file, nativeSessionId: pi.sessionManager.getSessionId(), nativeCheckpoint: checkpoint }), run);
            const api = coordination({ store: c.store, interactions: c.interactions, identity, entry() {}, delegation: { rootWorkId: work, projectIds: ['P'], maxAssignments: 1 }, launch() { throw Error('No child launch selected'); }, onWait() { onWait++; } });
            if (scenario === 'uncertain' || scenario.startsWith('throw-')) {
                let owned;
                if (scenario === 'throw-owned') {
                    owned = await c.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'OWNED_NATIVE_PENDING', mode: 'steer' });
                    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', owned.inputId).state, 'NATIVE_PENDING');
                    assert.deepEqual(pi.session.getSteeringMessages(), ['OWNED_NATIVE_PENDING']);
                }
                const pendingData = owned && c.store.one('SELECT data FROM conversation_inputs WHERE id=?', owned.inputId).data;
                await pi.session.steer('UNOWNED_NON_AUTHORITY_QUEUE');
                assert.deepEqual(pi.session.getSteeringMessages(), owned ? ['OWNED_NATIVE_PENDING', 'UNOWNED_NON_AUTHORITY_QUEUE'] : ['UNOWNED_NON_AUTHORITY_QUEUE']);
                if (scenario.startsWith('throw-')) pi.session.clearQueue = () => { clear(); throw Error('CONTROLLED_CLEAR_AFTER_PHYSICAL_OPERATION'); };
                await assert.rejects(scenario === 'throw-owned' ? c.interactions.drainNativeInputs(identity) : api.wait({ resultHandles: [handle] }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
                const state = c.inspectConversation(cid), data = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
                assert.equal(state.state, 'UNKNOWN'); assert.ok(data.nativeInputRecovery); assert.deepEqual(data.modelChoice, choice);
                assert.equal(Object.hasOwn(data, 'continuationAuthorized'), false); assert.equal(onWait, 0);
                if (scenario.startsWith('throw-')) {
                    assert.deepEqual(data.nativeInputRecovery, { format: 'gitjig-native-input-recovery-1', runId: run, generation: 1, reason: 'queue-clear-failed', ...(owned ? { inputId: owned.inputId } : {}) });
                    assert.doesNotMatch(JSON.stringify(data.nativeInputRecovery), /CONTROLLED|UNOWNED|clearCounts/);
                    if (owned) {
                        const row = c.store.one('SELECT state,data FROM conversation_inputs WHERE id=?', owned.inputId);
                        assert.equal(row.state, 'RECONCILIATION_REQUIRED'); assert.equal(row.data, pendingData);
                    }
                }
            } else {
                c.interactions.quiesceNative = owner => {
                    quiesce(owner);
                    if (scenario === 'current') {
                        const current = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
                        c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...current, contextMarker: { original: true, duringQuiesce: true } }), cid);
                    } else c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?', cid); // Explicit stale-owner fault injection.
                };
                if (scenario === 'stale') {
                    await assert.rejects(api.wait({ resultHandles: [handle] }), /Stale coordinator generation/);
                    assert.equal(onWait, 0); assert.notEqual(c.inspectConversation(cid).state, 'WAITING');
                    assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data), preserved);
                } else {
                    const result = await api.wait({ resultHandles: [handle] });
                    assert.equal(result.waiting, true); assert.equal(onWait, 1); assert.equal(c.inspectConversation(cid).state, 'WAITING');
                    assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data), { ...preserved, contextMarker: { original: true, duringQuiesce: true }, waitHandles: [handle], continuationAuthorized: true, sourceIdentity: identity });
                }
            }
            assert.deepEqual(c.getConversationModelChoice(cid), choice);
            records.push({ scenario, onWait, choicePreserved: true, generated: false });
        } finally {
            c.interactions.quiesceNative = quiesce; pi.session.clearQueue = clear;
            c.interactions.lifecycle.settling(identity); await c.interactions.drainNativeInputs(identity);
            c.interactions.lifecycle.released(identity); await pi.closeOwned();
        }
        if (scenario.startsWith('throw-')) {
            c.interactions.cleanup(identity, { cleanup: 'unbound', settled: true });
            assert.equal(c.inspectConversation(cid).state, 'UNKNOWN');
        }
        await c.close(); c = await openController({ installationHome: home });
        if (scenario.startsWith('throw-')) {
            const before = JSON.stringify(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?', cid));
            assert.throws(() => c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, text: 'REFUSE', mode: 'idle' }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
            await assert.rejects(async () => c.runConversation({ conversationId: cid, ...new ApplicationModels(c).conversationOperation(cid) }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
            assert.equal(JSON.stringify(c.store.all('SELECT * FROM conversation_inputs WHERE conversation=?', cid)), before);
            assert.equal(JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data).nativeInputRecovery.reason, 'queue-clear-failed');
        }
        assert.deepEqual(c.getConversationModelChoice(cid), choice);
        const reopened = await new ApplicationModels(c).resolve(cid);
        assert.equal(reopened.provider, model.provider); assert.equal(reopened.modelId, model.modelId);
    }
} finally { await c.close(); }
assert.equal(requests, 0); console.log(JSON.stringify({ outcome: 'passed', requests, records }));

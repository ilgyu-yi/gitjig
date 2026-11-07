import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { randomUUID } from 'node:crypto';
import { captureOrdinaryRoleBinding } from '../../dist/controller/application-model.js';
initializeApplicationEnvironment(); let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No requests in owner WAIT fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No sockets in owner WAIT fixture'); };
const root = process.argv[2], home = path.join(root, 'app'), project = path.join(root, 'user', 'project');
await fs.mkdir(project);
const c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) } });
await c.registerProject({ id: 'P', sourceRoot: project });
await ApplicationAccounts.open(c).configure({ providers: { 'owner-wait-fixture': { api: 'openai-completions', apiKey: 'DUMMY_OWNER_WAIT_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } } });
await ApplicationAccounts.open(c).setDefault('owner-wait-fixture', 'fixed');
const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
const models = new ApplicationModels(c), deny = async () => { throw Error('No operations in owner WAIT fixture'); };
const tables = ['conversations', 'conversation_state', 'sources', 'conversation_inputs', 'conversation_directions', 'works', 'runs', 'budgets', 'conversation_assignments', 'conversation_results'];
const snapshot = () => Object.fromEntries(tables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
let barrier; const install = c.installApplicationModelResolver.bind(c);
c.installApplicationModelResolver = resolver => install({ ...resolver, async resolveConversation(request) { const model = await resolver.resolveConversation(request); await barrier?.(); return model; } });
models.install();
let capacity = 0; c.capacity.acquire = async () => { capacity++; throw Error('CONTROLLED_OWNER_WAIT_CAPACITY_REFUSAL'); };
const records = [];
try {
    for (const scenario of ['owner', 'explicit-owner', 'budget', 'agent', 'source-drift']) {
        const cid = (await models.newConversation({ projectId: 'P' })).conversationId;
        const first = await c.queueConversationInput({ conversationId: cid, expectedGeneration: 0, text: 'NON_AUTHORITY initial native history', mode: 'idle' });
        const work = 'W-' + scenario, run = randomUUID(), assignment = 'A-' + scenario;
        const mode = { kind: 'application', version: 1, choiceRevision: 1 };
        const selected = c.getConversationModelChoice(cid);
        const ordinaryRoleBinding = captureOrdinaryRoleBinding({version:1,revision:1,sourceRunId:run,conversationId:cid,mode:{kind:'application',baseline:{version:1,revision:1,choice:{kind:'managed',provider:selected.provider,modelId:selected.modelId,thinkingLevel:selected.thinkingLevel},source:{kind:'conversation',conversationId:cid,choiceRevision:1}}}});
        const sourceData = {fixture:'NON_AUTHORITY controlled WAIT',outcome:'waiting',kind:'ordinary-conversation',conversation:cid,raw:'NON_AUTHORITY initial native history',initialInputId:first.inputId,conversationModelMode:mode,ordinaryRoleBinding};
        // Controlled WAIT/result ledger and user-only original SDK history. No generated result or completed model run.
        c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', work, 'P', first.sourceId, null, work, 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'ordinary-conversation', fixture: 'NON_AUTHORITY owner WAIT', conversation: cid, conversationModelMode: mode, ordinaryRoleBinding }));
        for (const kind of ['execution', 'resolution']) c.store.run('INSERT INTO budgets VALUES(?,?,8,1,0)', work, kind);
        c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, work, 1, 1, 'SETTLED', root, 'none', JSON.stringify(sourceData));
        c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignment, cid, cid, null, 'COMPLETE', '{"fixture":"NON_AUTHORITY controlled outcome"}');
        c.store.run('INSERT INTO conversation_results VALUES(?,?,?,?,?)', 'RESULT-' + scenario, cid, null, null, JSON.stringify({ fixture: 'NON_AUTHORITY', assignmentId: assignment }));
        const pi = await createPiSession({ host, operations: { workspaceRoot: project, validatePath: p => path.resolve(project, p), exec: deny, readFile: deny, access: deny, writeFile: deny, mkdir: deny }, model: await models.resolve(cid), systemPrompt: 'Unstarted original user-only history control. No generation.', maxReadBytes: 1024 });
        const identity = { conversationId: cid, workId: work, runId: run, launchId: null, generation: 1, directionRevision: 1, initialInputId: first.inputId };
        c.store.run('UPDATE conversation_inputs SET state=?,generation=?,work=? WHERE id=?', 'INITIAL_RESERVED', 1, work, first.inputId);
        try {
            c.interactions.lifecycle.ready({ identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
            c.interactions.nativeBoundary(identity);
            pi.sessionManager.appendMessage({ role: 'user', content: 'NON_AUTHORITY_OWNER_WAIT_HISTORY', timestamp: Date.now() });
            const file = pi.sessionManager.getSessionFile(), checkpoint = await nativeCheckpoint(file);
            c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...sourceData, historyRef: file, nativeSessionId: pi.sessionManager.getSessionId(), nativeCheckpoint: checkpoint }), run);
        } finally {
            c.interactions.lifecycle.settling(identity); await c.interactions.drainNativeInputs(identity); c.interactions.lifecycle.released(identity); await pi.closeOwned();
        }
        const data = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
        c.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'WAITING', JSON.stringify({ ...data, runId: run, sourceIdentity: identity, waitHandles: [assignment], continuationAuthorized: true, fixture: 'NON_AUTHORITY controlled WAIT' }), cid);
        const input = scenario === 'agent' ? c.interactions.enqueue({ conversationId: cid, expectedGeneration: 1, text: 'Agent direction cannot supersede WAIT', mode: 'idle' }, identity) : await c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, text: 'ACTUAL OWNER NEW DIRECTION', mode: 'idle' });
        if (scenario === 'budget') c.store.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?', work, 'execution');
        const before = snapshot(), oldCapacity = capacity;
        const entered = Promise.withResolvers(), release = Promise.withResolvers(); barrier = async () => { entered.resolve(); await release.promise; };
        const promise = c.runConversation({ conversationId: cid, ...models.conversationOperation(cid), ...(scenario === 'explicit-owner' || scenario === 'agent' ? { initialInputId: input.inputId } : {}) });
        const outcome = promise.then(value => ({ value }), error => ({ error })); await entered.promise;
        assert.deepEqual(snapshot(), before); // Resolution has no early authorization/input/reservation mutation.
        if (scenario === 'source-drift') {
            c.store.run('UPDATE sources SET origin=? WHERE id=?', '{"kind":"agent-conversation-input","fixture":"NON_AUTHORITY drift"}', input.sourceId);
        }
        const expectedRefusal = snapshot(); release.resolve(); barrier = undefined; const result = await outcome;
        if (['budget', 'agent', 'source-drift'].includes(scenario)) {
            assert.ok(result.error); assert.match(result.error.message, scenario === 'budget' ? /allowance exhausted/ : scenario === 'agent' ? /owner attribution/ : /changed during resolution/);
            assert.deepEqual(snapshot(), expectedRefusal); assert.equal(capacity, oldCapacity);
        } else {
            assert.ifError(result.error);
            assert.equal(result.value.status, 'unavailable'); assert.equal(result.value.workId, work); assert.equal(capacity, oldCapacity + 1);
            const current = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
            assert.equal(current.continuationAuthorized, false);
            assert.deepEqual(current.supersededContinuation, { runId: run, sourceIdentity: identity, waitHandles: [assignment], inputId: input.inputId, sourceId: input.sourceId, directionRevision: input.directionRevision, newRunId: result.value.runId });
            assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.inputId).state, 'INITIAL_RESERVED');
            assert.equal(c.store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?', work, 'execution').consumed, 2);
            const late = snapshot(); c.ordinaryCore.resumeAuthorized(); await new Promise(setImmediate); assert.deepEqual(snapshot(), late);
        }
        records.push({ scenario, admitted: !!result.value, generated: false });
    }
} finally { await c.close(); }
assert.equal(requests, 0); console.log(JSON.stringify({ outcome: 'passed', requests, records }));

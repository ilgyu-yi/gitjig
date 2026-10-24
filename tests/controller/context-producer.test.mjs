import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionManager, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { prepareNativeSeed } from '../../dist/controller/native-seed.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-producer-'))), home = path.join(root, 'app');
    let controller = await openController({ installationHome: home }), passed = false;
    t.after(async () => { await controller.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained producer world ' + root); });
    return { root, home, get controller() { return controller; }, pass() { passed = true; }, async restart() { await controller.close(); controller = await openController({ installationHome: home }); } };
}
const rows = store => Object.fromEntries(['works', 'runs', 'budgets', 'effect_delegations', 'conversation_assignments', 'conversation_inputs'].map(table => [table, store.all('SELECT * FROM ' + table + ' ORDER BY rowid').map(row => ({ ...row }))]));
const request = (controller, cid, extra = {}) => ({ conversationId: cid, expectedGeneration: controller.inspectConversation(cid).generation,
    expectedModelRevision: controller.getConversationModelChoice(cid).revision, kind: 'clone', ...extra });
async function seeded(f) {
    const c = f.controller, store = c.store, raw = c.createConversation(), source = c.createConversation(), directory = path.join(f.home, 'state', 'fixture-native-' + source.conversationId);
    await fs.mkdir(directory, { mode: 0o700 });
    // Original SDK fixture context, explicitly no model/run/review success.
    const manager = SessionManager.create(f.root, directory);
    manager.appendModelChange('fixture', 'not-executed');
    const message = text => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    const first = manager.appendMessage(message('first retained point'));
    manager.appendMessage(message('abandoned')); manager.branch(first); manager.appendMessage(message('current branch'));
    const seed = await prepareNativeSeed({ stateRoot: path.join(f.home, 'state'), cwd: f.root, kind: 'clone', destinationId: source.conversationId,
        source: { conversationId: raw.conversationId, generation: 0, projectId: null, modelRevision: 0, sessionId: manager.getSessionId(),
            historyRef: manager.getSessionFile(), checkpoint: await nativeCheckpoint(manager.getSessionFile()), selectedLeaf: manager.getLeafId() } });
    store.run('UPDATE conversations SET history=? WHERE id=?', seed.destination.historyRef, source.conversationId);
    store.run('UPDATE conversation_state SET native_id=?,data=? WHERE conversation=?', seed.destination.sessionId, JSON.stringify({ nativeSeed: seed, fixture: 'non-authority original SDK context' }), source.conversationId);
    return { cid: source.conversationId, first, file: seed.destination.historyRef, seed };
}
const texts = history => history.sessionManager.getBranch().filter(e => e.type === 'message').map(e => e.message.content[0].text);

test('actual public producer atomically registers empty and native branches with independent desired choice, no work or standing', async t => {
    const f = await fixture(t), c = f.controller, source = await seeded(f), before = rows(c.store), bytes = await fs.readFile(source.file);
    await c.setConversationModelChoice({ conversationId: source.cid, expectedGeneration: 0, expectedRevision: 0,
        choice: { kind: 'managed', provider: 'fixture', modelId: 'not-executed', thinkingLevel: 'low' } });
    const cloned = await c.forkConversation(request(c, source.cid));
    const forked = await c.forkConversation(request(c, source.cid, { kind: 'fork', entryId: source.first }));
    assert.deepEqual(rows(c.store), before);
    assert.notEqual(cloned.conversationId, source.cid); assert.notEqual(cloned.nativeSessionId, c.inspectConversation(source.cid).nativeSessionId);
    assert.equal(cloned.parentId, source.cid); assert.equal(cloned.workId, null); assert.equal(cloned.generation, 0);
    assert.deepEqual(texts(await c.getConversationHistory(cloned.conversationId)), ['first retained point', 'current branch']);
    assert.deepEqual(texts(await c.getConversationHistory(forked.conversationId)), ['first retained point']);
    assert.deepEqual(await fs.readFile(source.file), bytes);
    assert.deepEqual(c.getConversationModelChoice(cloned.conversationId), c.getConversationModelChoice(source.cid));
    const state = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cloned.conversationId).data);
    assert.equal(state.contextOrigin.continuation.kind, 'first-family-work'); assert.equal(state.contextOrigin.effects.ceiling, 'none');
    assert.equal(state.contextOrigin.sourceConversationId, source.cid); assert.equal(state.contextOrigin.sourceChoiceRevision, 1);
    assert.equal(Object.hasOwn(state, 'runId'), false); assert.equal(Object.hasOwn(state, 'role'), false);
    const empty = c.createConversation(), emptyClone = await c.forkConversation(request(c, empty.conversationId));
    assert.equal(emptyClone.historyRef, null); assert.equal(emptyClone.nativeSessionId, null); assert.equal(await c.getConversationHistory(emptyClone.conversationId), null);
    const family = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', empty.conversationId).data).contextFamily;
    assert.equal(family.budgetAnchorWorkId, null);
    const count = c.listConversations().length;
    await assert.rejects(c.forkConversation(request(c, source.cid, { kind: 'fork', entryId: 'missing-entry' })), /Selected native seed leaf unavailable/);
    await assert.rejects(c.forkConversation(request(c, empty.conversationId, { kind: 'fork', entryId: 'missing-entry' })), /requires verified native history/);
    assert.equal(c.listConversations().length, count); assert.deepEqual(rows(c.store), before);
    await f.restart();
    assert.deepEqual(texts(await f.controller.getConversationHistory(forked.conversationId)), ['first retained point']);
    assert.equal(f.controller.getConversationModelChoice(cloned.conversationId).modelId, 'not-executed');
    f.pass();
});

test('actual producer reservation blocks internal writers and preserves incomplete WAIT authorization after release', async t => {
    const f = await fixture(t), c = f.controller, source = c.createConversation(), unrelated = c.createConversation(), store = c.store;
    const ordinary = c.ordinary;
    // Incomplete NON_AUTHORITY dependency records lack retained work/source identity.
    // They exercise lifecycle exclusion and diagnosed refusal, never a valid resume.
    store.run('INSERT INTO conversation_assignments VALUES(?,?,?,NULL,?,?)', 'ready', unrelated.conversationId, unrelated.conversationId, 'COMPLETE', '{}');
    store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'WAITING', JSON.stringify({ continuationAuthorized: true, waitHandles: ['ready'], sourceIdentity: undefined }), source.conversationId);
    ordinary.models.set(source.conversationId, { provider: 'fixture', modelId: 'not-executed' });
    let release, entered; const barrier = new Promise(resolve => release = resolve), arrived = new Promise(resolve => entered = resolve);
    const reclaim = c.completed.reclaim.bind(c.completed);
    c.completed.reclaim = async (...args) => { await reclaim(...args); entered(); await barrier; return { outcome: 'absent' }; };
    const operation = c.forkConversation(request(c, source.conversationId)); await arrived;
    const before = rows(store), stateBefore = store.one('SELECT data,resource FROM conversation_state WHERE conversation=?', source.conversationId);
    assert.throws(() => c.interactions.enqueue({ conversationId: source.conversationId, expectedGeneration: 0, mode: 'idle', text: 'internal bypass' }), /lifecycle operation active/);
    await assert.rejects(ordinary.runInner({ conversationId: source.conversationId, model: { provider: 'fixture', modelId: 'not-executed' } }), /lifecycle operation active/);
    ordinary.resumeAuthorized();
    assert.deepEqual(store.one('SELECT data,resource FROM conversation_state WHERE conversation=?', source.conversationId), stateBefore);
    assert.deepEqual(rows(store), before);
    await assert.rejects(c.setConversationModelChoice({ conversationId: source.conversationId, expectedGeneration: 0, expectedRevision: 0, choice: { kind: 'unbound', reason: 'blocked' } }), /lifecycle operation active/);
    assert.throws(() => c.getConversationHistory(source.conversationId), /lifecycle operation active/);
    await c.queueConversationInput({ conversationId: unrelated.conversationId, expectedGeneration: 0, mode: 'idle', text: 'unrelated stays usable' });
    release(); await operation; await Promise.resolve();
    assert.equal(store.one("SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?", source.conversationId).n, 0);
    const retained=store.one('SELECT work,resource,data FROM conversation_state WHERE conversation=?',source.conversationId),data=JSON.parse(retained.data);
    assert.equal(retained.work,null);assert.equal(retained.resource,'WAITING');assert.equal(data.continuationAuthorized,true);assert.deepEqual(data.waitHandles,['ready']);assert.equal(data.sourceIdentity,undefined);
    assert.equal(data.continuationError,'APPLICATION_MODEL_UNAVAILABLE: repair the retained target model mode');
    c.completed.reclaim = reclaim;
    f.pass();
});

test('producer rejects source choice, work and full-checkpoint drift without publishing; old header is never migrated', async t => {
    const f = await fixture(t), c = f.controller, source = await seeded(f), store = c.store;
    const count = c.listConversations().length, bytes = await fs.readFile(source.file), originalHistory = c.interactions.history.bind(c.interactions);
    c.interactions.history = async cid => { const history = await originalHistory(cid); store.run("UPDATE conversation_state SET data=json_set(data,'$.modelChoice',json(?)) WHERE conversation=?", JSON.stringify({ kind: 'unbound', reason: 'injected drift', revision: 1 }), cid); return history; };
    await assert.rejects(c.forkConversation(request(c, source.cid)), /Stale fork source model revision/);
    assert.equal(c.listConversations().length, count);
    store.run("UPDATE conversation_state SET data=json_remove(data,'$.modelChoice') WHERE conversation=?", source.cid);
    c.interactions.history = async cid => { const history = await originalHistory(cid); await fs.appendFile(source.file, '\n'); return history; };
    await assert.rejects(c.forkConversation(request(c, source.cid)), /Fork source changed/);
    assert.equal(c.listConversations().length, count); await fs.writeFile(source.file, bytes);
    c.interactions.history = originalHistory;
    const lines = bytes.toString().split('\n'), header = JSON.parse(lines[0]); header.version = CURRENT_SESSION_VERSION - 1; lines[0] = JSON.stringify(header);
    const old = lines.join('\n'); await fs.writeFile(source.file, old);
    await assert.rejects(c.forkConversation(request(c, source.cid)), /requires current-format history/);
    assert.equal(await fs.readFile(source.file, 'utf8'), old); assert.equal(c.listConversations().length, count);
    await fs.writeFile(source.file, bytes); assert.deepEqual(rows(store), Object.fromEntries(Object.keys(rows(store)).map(key => [key, []])));
    f.pass();
});

test('settled governed obligations remain forkable, strict role gets none/zero and source epoch drift refuses atomically', async t => {
    const f = await fixture(t), c = f.controller, source = await seeded(f), role = await seeded(f), store = c.store;
    // Unexecuted governed/role controls provide retained authority operands, not
    // model responses, passing review or successful cleanup of a real producer.
    store.run('INSERT INTO sources VALUES(?,?,?,?)', 'control', source.cid, '{"kind":"unexecuted-fixture"}', 'Pending obligation control');
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'G', null, 'control', null, 'G', 'ACTIVE', 1, 1, null,
        JSON.stringify({ kind: 'governed-change', conversation: source.cid, delegation: { projectIds: [], maxAssignments: 8, rootWorkId: 'G' } }));
    store.run('INSERT INTO change_state VALUES(?,?,NULL,NULL,NULL,NULL,?,?)', 'G', 'PLAN_PENDING', 1, JSON.stringify({ unresolved: 'retained fixture finding' }));
    for (const kind of ['execution', 'resolution']) store.run('INSERT INTO budgets VALUES(?,?,8,2,0)', 'G', kind);
    store.run('UPDATE conversation_state SET work=? WHERE conversation=?', 'G', source.cid);
    const before = rows(store), clone = await c.forkConversation(request(c, source.cid));
    let origin = JSON.parse(store.one('SELECT data FROM conversation_state WHERE conversation=?', clone.conversationId).data).contextOrigin;
    assert.deepEqual(origin.continuation, { kind: 'governed', workId: 'G' }); assert.equal(origin.effects.ceiling, 'original-lineage');
    assert.equal(store.one('SELECT phase FROM change_state WHERE work=?', 'G').phase, 'PLAN_PENDING'); assert.deepEqual(rows(store), before);
    const roleData = JSON.parse(store.one('SELECT data FROM conversation_state WHERE conversation=?', role.cid).data);
    store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?', 'G', JSON.stringify({ ...roleData, role: 'reviewer', runId: 'role-run' }), role.cid);
    store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'role-run', 'G', 1, 1, 'SETTLED', f.root, 'consumed', JSON.stringify({ kind: 'unexecuted-fixture', conversation: role.cid, cleanup: 'unbound' }));
    store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'launch', 'G', 'role-run', 'reviewer', 1, 'FIXTURE_UNEXECUTED', 'none', '{}');
    store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'role-input', role.cid, 0, 'G', 'control', 'CONSUMED', 'initial', 'fixture role', '{"launchId":"launch"}');
    const strictBefore = rows(store), strict = await c.forkConversation(request(c, role.cid));
    origin = JSON.parse(store.one('SELECT data FROM conversation_state WHERE conversation=?', strict.conversationId).data).contextOrigin;
    assert.deepEqual(origin.continuation, { kind: 'governed', workId: 'G' }); assert.equal(origin.effects.ceiling, 'none');
    assert.equal(origin.delegationCeiling.maxAssignments, 0); assert.deepEqual(rows(store), strictBefore);
    const unrelated = c.createConversation();
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'U', null, 'control', null, 'U', 'ACTIVE', 1, 1, null,
        JSON.stringify({ kind: 'governed-change', conversation: unrelated.conversationId }));
    const fullRows = () => Object.fromEntries(['sources', 'works', 'runs', 'budgets', 'change_state', 'role_launches', 'conversation_assignments', 'conversation_inputs', 'conversation_state'].map(table => [table, store.all('SELECT * FROM ' + table + ' ORDER BY rowid').map(row => ({ ...row }))]));
    for (const held of [source.cid, role.cid]) {
        let release, arrived;
        const barrier = new Promise(resolve => release = resolve), entered = new Promise(resolve => arrived = resolve);
        const reclaim = c.completed.reclaim.bind(c.completed);
        c.completed.reclaim = async (...args) => { const result = await reclaim(...args); arrived(); await barrier; return result; };
        const copying = c.forkConversation(request(c, held)); await entered;
        const beforeHeld = fullRows(), model = { provider: 'fixture', modelId: 'not-executed' };
        let forbiddenBody = 0;
        assert.throws(() => c.planChange({ workId: 'G', model }), /lifecycle operation active/);
        assert.throws(() => c.driveChange({ workId: 'G', model }), /lifecycle operation active/);
        await assert.rejects(c.changes.operation({ workId: 'G' }, 'plan', async () => { forbiddenBody++; }), /lifecycle operation active/);
        assert.throws(() => c.changes.reserve('G', null, {}, f.root), /lifecycle operation active/);
        await assert.rejects(c.changes.drive({ workId: 'G', model }), /lifecycle operation active/);
        await assert.rejects(c.changes.refreshCriteria({ workId: 'G', reason: 'Blocked during copy' }), /lifecycle operation active/);
        await assert.rejects(c.changes.publicationJudgment({ workId: 'G' }), /lifecycle operation active/);
        assert.throws(() => c.changes.h.register('G', { abort: new AbortController() }), /lifecycle operation active/);
        assert.throws(() => c.entry('role-run'), /lifecycle operation active/);
        assert.equal(forbiddenBody, 0); assert.equal(c.active.has('G'), false); assert.deepEqual(fullRows(), beforeHeld);
        // Real operation/register/unregister with controlled stage prerequisites
        // proves scope; the callback is not a generated or accepted plan.
        const core = c.changes, saved = Object.fromEntries(['coverageHoldReason', 'criteriaHoldReason', 'pending', 'bindings'].map(key => [key, core[key]]));
        core.coverageHoldReason = core.criteriaHoldReason = () => null; core.pending = () => []; core.bindings = () => 'controlled-unexecuted-bindings';
        let unrelatedBody = 0;
        await core.operation({ workId: 'U' }, 'plan', async () => { assert.equal(c.active.has('U'), true); unrelatedBody++; return { fixture: 'unexecuted stage callback' }; });
        Object.assign(core, saved); assert.equal(unrelatedBody, 1); assert.deepEqual(fullRows(), beforeHeld);
        release(); await copying; c.completed.reclaim = reclaim;
    }
    const count = c.listConversations().length, originalHistory = c.interactions.history.bind(c.interactions);
    c.interactions.history = async cid => { const history = await originalHistory(cid); store.run('UPDATE works SET epoch=2 WHERE id=?', 'G'); return history; };
    await assert.rejects(c.forkConversation(request(c, source.cid)), /Fork source changed/);
    assert.equal(c.listConversations().length, count);
    assert.equal(JSON.parse(store.one('SELECT data FROM change_state WHERE work=?', 'G').data).unresolved, 'retained fixture finding');
    c.interactions.history = originalHistory; f.pass();
});

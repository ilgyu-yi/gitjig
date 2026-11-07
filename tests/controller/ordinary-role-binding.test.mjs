import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { subjectRoleModel, assertOrdinaryEffectSource } from '../../dist/controller/application-model.js';
const runtimeProfile = { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) };
const tables = ['works', 'runs', 'sources', 'budgets', 'role_launches', 'effect_operations', 'conversation_inputs', 'conversation_assignments', 'effect_targets', 'effect_delegations'];
const ledger = c => Object.fromEntries(tables.map(t => [t, c.store.all('SELECT * FROM ' + t + ' ORDER BY rowid')]));
async function world(t, explicit = false, adjudicatorOverride = false) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ordinary-binding-'))), home = path.join(root, 'app'), project = path.join(root, 'project');
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.txt'), 'NON_AUTHORITY controlled source');
    let c = await openController({ installationHome: home, runtimeProfile }); let passed = false, capacity = 0;
    t.after(async () => { await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained role binding world ' + root); });
    await c.registerProject({ id: 'P', sourceRoot: project });
    const accounts = ApplicationAccounts.open(c);
    await accounts.configure({ providers: { 'binding-fixture': { api: 'openai-completions', apiKey: 'DUMMY_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'alpha', contextWindow: 8192, maxTokens: 256 }, { id: 'beta', contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('binding-fixture', 'alpha'); const models = new ApplicationModels(c); models.install();
    if (adjudicatorOverride) await models.setRole('adjudicator', await models.choice('binding-fixture', 'beta'));
    const cid = (await models.newConversation({ projectId: 'P' })).conversationId;
    const recipe = await models.resolve(cid);
    if (explicit) await c.setConversationModelChoice({ conversationId: cid, expectedGeneration: 0, expectedRevision: 1, choice: { kind: 'legacy-external', provider: recipe.provider, modelId: recipe.modelId } });
    await c.queueConversationInput({ conversationId: cid, expectedGeneration: 0, mode: 'idle', text: 'Actual admission; capacity deliberately refuses before engine or SDK' });
    c.capacity.acquire = async () => { capacity++; throw Error('CONTROLLED_BINDING_CAPACITY_REFUSAL'); };
    const result = await c.runConversation({ conversationId: cid, ...(explicit ? { model: recipe } : models.conversationOperation(cid)) });
    assert.equal(result.status, 'unavailable'); assert.equal(capacity, 1);
    const run = c.store.one('SELECT * FROM runs WHERE id=?', result.runId), data = JSON.parse(run.data);
    assert.equal(run.reservation, 'consumed'); assert.equal(data.cleanup, 'not-allocated');
    assert.equal(c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n, 0);
    const identity = { workId: result.workId, runId: run.id, conversationId: cid, generation: c.inspectConversation(cid).generation, initialInputId: data.initialInputId };
    return { get c() { return c; }, models, recipe, cid, result, identity, run, async reopen() { await c.close(); c = await openController({ installationHome: home, runtimeProfile }); }, pass() { passed = true; } };
}

test('original ordinary admission persists finite shared role binding and restart preserves exact source', async t => {
    const f = await world(t), selected = subjectRoleModel(f.c.store, f.result.workId);
    assert.equal(selected.baseline.choice.modelId, 'alpha'); assert.equal(selected.baseline.revision, 1);
    assert.equal(selected.ordinary.sourceRunId, f.run.id); assert.equal(selected.baseline.source.conversationId, f.cid);
    assert.deepEqual(JSON.parse(f.run.data).ordinaryRoleBinding, selected.ordinary);
    assertOrdinaryEffectSource(f.c.store, f.result.workId, f.identity);
    const before = ledger(f.c); await f.reopen(); assert.deepEqual(ledger(f.c), before);
    assert.deepEqual(subjectRoleModel(f.c.store, f.result.workId), selected);
    assertOrdinaryEffectSource(f.c.store, f.result.workId, f.identity);
    assert.ok(!JSON.stringify(before).includes('DUMMY_NO_REQUEST'));
    const b = f.c.store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'", f.result.workId);
    assert.equal(b.consumed, 1); assert.equal(b.reserved, 0); f.pass();
});

test('ordinary source corruption and tag loss refuse without ledger changes or legacy fallback', async t => {
    const f = await world(t), wid = f.result.workId, original = f.c.store.one('SELECT data FROM works WHERE id=?', wid).data;
    for (const alter of [d => { delete d.ordinaryRoleBinding; }, d => { d.ordinaryRoleBinding = null; }, d => { d.ordinaryRoleBinding.revision++; }, d => { d.ordinaryRoleBinding.sourceRunId = f.cid; }]) {
        const data = JSON.parse(original); alter(data); f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(data), wid);
        const before = ledger(f.c); assert.throws(() => f.c.getWorkApplicationModelBaseline(wid), /APPLICATION_MODEL_UNAVAILABLE/);
        assert.throws(() => f.c.retainedWorkModelOperation(wid, f.recipe), /APPLICATION_MODEL_UNAVAILABLE/); assert.deepEqual(ledger(f.c), before);
    }
    f.c.store.run('UPDATE works SET data=? WHERE id=?', original, wid);
    for (const identity of [undefined, { ...f.identity, runId: f.cid }, { ...f.identity, generation: f.identity.generation + 1 }, { ...f.identity, initialInputId: f.cid }]) {
        const before = ledger(f.c); assert.throws(() => assertOrdinaryEffectSource(f.c.store, wid, identity), /APPLICATION_MODEL_UNAVAILABLE/); assert.deepEqual(ledger(f.c), before);
    }
    const input = f.c.store.one('SELECT * FROM conversation_inputs WHERE id=?', f.identity.initialInputId);
    f.c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?', 'changed owner source', input.id);
    const before = ledger(f.c); assert.throws(() => subjectRoleModel(f.c.store, wid), /APPLICATION_MODEL_UNAVAILABLE/); assert.deepEqual(ledger(f.c), before); f.pass();
});

test('deliberately explicit ordinary source stays explicit and rejects unrelated coordinator recipe', async t => {
    const f = await world(t, true), wid = f.result.workId, selected = subjectRoleModel(f.c.store, wid);
    assert.equal(selected.baseline, undefined); assert.deepEqual(selected.explicit, { provider: f.recipe.provider, modelId: f.recipe.modelId });
    assertOrdinaryEffectSource(f.c.store, wid, f.identity);
    const before = ledger(f.c); assert.throws(() => f.c.retainedWorkModelOperation(wid, { provider: f.recipe.provider, modelId: 'different-parent' }), /APPLICATION_MODEL_UNAVAILABLE/);
    assert.deepEqual(ledger(f.c), before); assert.ok(f.c.retainedWorkModelOperation(wid, f.recipe).model); f.pass();
});


test('original ordinary role selector applies adjudicator override and rejects changed source after resolver await', async t => {
    const f = await world(t, false, true), wid = f.result.workId;
    const operation = f.c.retainedWorkModelOperation(wid, f.recipe), before = ledger(f.c);
    const selection = await f.c.changes.selectRoleModel(operation, 'adjudicator', true);
    assert.equal(selection.model.modelId, 'beta'); assert.equal(selection.mode.kind, 'application'); selection.assertCurrent();
    assert.deepEqual(ledger(f.c), before); // Selection alone is not a generated role or authority.
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const original = f.models.resolveWorkRole.bind(f.models);
    f.models.resolveWorkRole = async request => { entered.resolve(); await release.promise; return original(request); };
    const pending = f.c.changes.selectRoleModel(operation, 'adjudicator', true), outcome = pending.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const input = f.c.store.one('SELECT * FROM conversation_inputs WHERE id=?', f.identity.initialInputId);
    f.c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?', 'Changed while original resolver was awaited', input.id);
    const changed = ledger(f.c); release.resolve(); const result = await outcome;
    assert.match(String(result.error), /APPLICATION_MODEL_UNAVAILABLE/); assert.deepEqual(ledger(f.c), changed); f.pass();
});

for (const drift of ['resolver-assignment', 'reservation-assignment']) test('original publication reservation refuses ' + drift + ' before new role or allowance', async t => {
    const f = await world(t, false, true), wid = f.result.workId, op = 'NON_AUTHORITY_PUBLICATION', aid = 'NON_AUTHORITY_ASSIGNMENT';
    const cid = f.c.createConversation({ projectId: 'P' }).conversationId;
    // These owned prerequisite rows confer NO platform capability, generated review, ready standing or send authorization.
    f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)', 'T', 'P', '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', 'G', wid, 'T', 1, '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', aid, f.cid, cid, wid, 'QUEUED', JSON.stringify({ operation: 'effect-publication', effectOperationId: op, source: f.identity, fixture: 'NON_AUTHORITY' }));
    f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', op, wid, 'T', 'G', 'PREPARED', JSON.stringify({ kind: 'publication', assignmentId: aid, conversationId: cid, origin: { identity: f.identity }, fixture: 'NON_AUTHORITY' }));
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = f.models.resolveWorkRole.bind(f.models), originalTx = f.c.store.tx.bind(f.c.store);
    let arm = false, changed;
    f.models.resolveWorkRole = async request => { entered.resolve(); await release.promise; const model = await original(request); arm = true; return model; };
    const mutate = () => { f.c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'CANCELLED', aid); changed = ledger(f.c); };
    if (drift === 'reservation-assignment') f.c.store.tx = fn => { if (arm) { arm = false; mutate(); } return originalTx(fn); };
    const options = { ...f.c.retainedWorkModelOperation(wid, f.recipe), operationId: op, sourceFingerprint: 'NON_AUTHORITY', inputBundle: { requirements: [], contracts: 'NON_AUTHORITY', sources: [], requiredScope: [], context: { operationId: op, actionFamily: 'fixture' } } };
    if (drift === 'resolver-assignment') {
        const originalData = f.c.store.one('SELECT data FROM effect_operations WHERE id=?', op).data;
        for (const invalid of [null, false, '']) {
            f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(originalData), assignmentId: invalid }), op);
            const before = ledger(f.c); await assert.rejects(f.c.changes.publicationJudgment(options), /malformed publication assignment/); assert.deepEqual(ledger(f.c), before);
        }
        f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?', originalData, op);
        f.c.store.run('UPDATE conversation_assignments SET source_conversation=? WHERE id=?', cid, aid);
        const before = ledger(f.c); await assert.rejects(f.c.changes.publicationJudgment(options), /originating assignment changed/); assert.deepEqual(ledger(f.c), before);
        f.c.store.run('UPDATE conversation_assignments SET source_conversation=? WHERE id=?', f.cid, aid);
    }
    const pending = f.c.changes.publicationJudgment(options), outcome = pending.then(value => ({ value }), error => ({ error }));
    await entered.promise; if (drift === 'resolver-assignment') mutate(); release.resolve();
    const result = await outcome; f.c.store.tx = originalTx;
    assert.match(String(result.error), /publication target changed/); assert.ok(changed); assert.deepEqual(ledger(f.c), changed);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM role_launches').n, 0);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, 1); f.pass();
});

for (const explicit of [false, true]) test('publication judgment refuses work registered during model resolution before any allowance or role; explicit=' + explicit, async t => {
    const f = await world(t, explicit, !explicit), wid = f.result.workId, op = 'NON_AUTHORITY_PUBLICATION', aid = 'NON_AUTHORITY_ASSIGNMENT';
    const cid = f.c.createConversation({ projectId: 'P' }).conversationId;
    f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)', 'T', 'P', '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', 'G', wid, 'T', 1, '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', aid, f.cid, cid, wid, 'QUEUED', JSON.stringify({ operation: 'effect-publication', effectOperationId: op, source: f.identity, fixture: 'NON_AUTHORITY' }));
    f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', op, wid, 'T', 'G', 'PREPARED', JSON.stringify({ kind: 'publication', assignmentId: aid, conversationId: cid, origin: { identity: f.identity }, fixture: 'NON_AUTHORITY' }));
    const operation = explicit ? { workId: wid, model: f.recipe } : f.c.retainedWorkModelOperation(wid, f.recipe);
    const options = { ...operation, operationId: op, sourceFingerprint: 'NON_AUTHORITY', inputBundle: { requirements: [], contracts: 'NON_AUTHORITY', sources: [], requiredScope: [], context: { operationId: op, actionFamily: 'fixture' } } };
    const before = ledger(f.c), outcome = f.c.changes.publicationJudgment(options).then(value => ({ value }), error => ({ error }));
    // The judgment is suspended at its model-resolution await; another producer registers the same work.
    f.c.changes.h.register(wid, { abort: new AbortController() });
    try {
        const result = await outcome;
        assert.match(String(result.error), /Work busy|changed during resolution/); assert.deepEqual(ledger(f.c), before);
    } finally { f.c.changes.h.unregister(wid); }
    f.pass();
});

test('publication judgment settles its reservation and registration when native role allocation fails', async t => {
    const f = await world(t, true), wid = f.result.workId, op = 'NON_AUTHORITY_PUBLICATION', aid = 'NON_AUTHORITY_ASSIGNMENT';
    const cid = f.c.createConversation({ projectId: 'P' }).conversationId;
    f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)', 'T', 'P', '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', 'G', wid, 'T', 1, '{"fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', aid, f.cid, cid, wid, 'QUEUED', JSON.stringify({ operation: 'effect-publication', effectOperationId: op, source: f.identity, fixture: 'NON_AUTHORITY' }));
    f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', op, wid, 'T', 'G', 'PREPARED', JSON.stringify({ kind: 'publication', assignmentId: aid, conversationId: cid, origin: { identity: f.identity }, fixture: 'NON_AUTHORITY' }));
    const reserved = () => f.c.store.all('SELECT kind,reserved,consumed FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind', wid);
    const before = reserved();
    f.c.changes.h.allocateRole = () => { throw Error('CONTROLLED_ROLE_ALLOCATION_REFUSAL'); };
    const options = { workId: wid, model: f.recipe, operationId: op, sourceFingerprint: 'NON_AUTHORITY', inputBundle: { requirements: [], contracts: 'NON_AUTHORITY', sources: [], requiredScope: [], context: { operationId: op, actionFamily: 'fixture' } } };
    const result = await f.c.changes.publicationJudgment(options).then(value => ({ value }), error => ({ error }));
    assert.equal(f.c.changes.h.busy(wid), false); assert.deepEqual(reserved().map(b => ({ ...b })), before.map(b => ({ ...b, consumed: b.consumed + (['execution', 'resolution'].includes(b.kind) ? 1 : 0) })));
    const launch = f.c.store.one('SELECT status,resolution_reservation AS reservation FROM role_launches');
    assert.notEqual(launch.reservation, 'reserved'); if (result.value) assert.equal(result.value.usable, false);
    f.pass();
});

test('a failed ordinary work registration releases the conversation for its next turn', async t => {
    const f = await world(t, true), cid = f.cid, host = f.c.ordinary.h, register = host.register;
    // Controlled in-process registration refusal after the admission transaction committed.
    host.register = () => { host.register = register; throw Error('CONTROLLED_REGISTRATION_REFUSAL'); };
    await f.c.queueConversationInput({ conversationId: cid, expectedGeneration: f.c.inspectConversation(cid).generation, mode: 'idle', text: 'Second admission' });
    const before = ledger(f.c);
    await assert.rejects(f.c.runConversation({ conversationId: cid, model: f.recipe }), /CONTROLLED_REGISTRATION_REFUSAL/);
    assert.equal(f.c.ordinary.isBusy(cid), false); assert.deepEqual(ledger(f.c), before);
    // The refused admission rolled back, so the same queued input runs (and meets the fixture's capacity refusal).
    const next = await f.c.runConversation({ conversationId: cid, model: f.recipe });
    assert.equal(next.status, 'unavailable');
    f.pass();
});

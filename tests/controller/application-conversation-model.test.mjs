import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { coordination } from '../../dist/controller/coordination.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { resolveManagedModel } from '../../dist/pi/managed-provider.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tables = ['conversations', 'conversation_state', 'conversation_inputs', 'conversation_directions', 'conversation_assignments', 'conversation_dependencies', 'conversation_results', 'sources', 'works', 'runs', 'budgets', 'capacity_leases'];
const snapshot = c => Object.fromEntries(tables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
async function fixture(t, barrier, install = true) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/c3a-'))), home = path.join(root, 'app'), project = path.join(root, 'project');
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'file.txt'), 'NON_AUTHORITY CONTROLLED SOURCE');
    const c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) } });
    let passed = false; t.after(async () => { await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained C3A world ' + root); });
    await c.registerProject({ id: 'P', sourceRoot: project });
    const accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c);
    await accounts.configure({ providers: { 'c3-fixture': { api: 'openai-completions', apiKey: 'DUMMY_C3_NO_DISPATCH', baseUrl: 'http://127.0.0.1:9/v1', models: [
        { id: 'alpha/slash', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 }, { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('c3-fixture', 'alpha/slash');
    const seen = [], originalInstall = c.installApplicationModelResolver.bind(c);
    c.installApplicationModelResolver = resolver => originalInstall({ ...resolver, resolveConversation: async request => { seen.push(structuredClone(request)); await barrier?.(request); return resolver.resolveConversation(request); } });
    if (install) models.install();
    let capacity = 0;
    c.capacity.acquire = async () => { capacity++; throw Error('CONTROLLED_C3_CAPACITY_REFUSAL_BEFORE_ENGINE_SDK'); };
    const conversation = await models.newConversation({ projectId: 'P', choice: await models.choice('c3-fixture', 'alpha/slash', 'high') });
    const queue = async (cid, text = 'NON_AUTHORITY original owner input') => c.queueConversationInput({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, text, mode: 'idle' });
    return { c, models, home, seen, conversation, queue, get capacity() { return capacity; }, pass() { passed = true; } };
}
function classifyFailedReservation(f, turn, expected, mode) {
    assert.equal(turn.status, 'unavailable');
    const run = f.c.store.one('SELECT * FROM runs WHERE id=?', turn.runId), data = JSON.parse(run.data), work = f.c.store.one('SELECT data FROM works WHERE id=?', turn.workId);
    assert.equal(run.phase, 'SETTLED'); assert.equal(data.cleanup, 'not-allocated'); assert.equal(run.reservation, 'consumed');
    assert.equal(data.modelIdentity, hash(modelConfigurationIdentity(expected))); assert.deepEqual(data.conversationModelMode, mode); assert.deepEqual(JSON.parse(work.data).conversationModelMode, mode);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n, 0); assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM role_launches').n, 0);
    for (const key of ['containerId', 'historyRef', 'nativeSessionId', 'modelDispatch']) assert.equal(Object.hasOwn(data, key), false, key);
}
async function controlledWait(f, kind = 'application') {
    const view = await f.models.newConversation({ projectId: 'P' }), cid = view.conversationId;
    if (kind === 'explicit') await f.c.setConversationModelChoice({ conversationId: cid, expectedGeneration: 0, expectedRevision: 1, choice: { kind: 'legacy-external', provider: 'c3-fixture', modelId: 'alpha/slash' } });
    const source = randomUUID(), work = randomUUID(), run = randomUUID(), assignment = randomUUID(), result = randomUUID(), target = f.c.createConversation({ projectId: 'P' }).conversationId;
    const identity = { conversationId: cid, workId: work, runId: run, launchId: null, generation: 0, directionRevision: 0, initialInputId: randomUUID() };
    const mode = kind === 'application' ? { kind: 'application', version: 1, choiceRevision: 1 } : { kind: 'explicit', provider: 'c3-fixture', modelId: 'alpha/slash' };
    // Controlled NON_AUTHORITY WAIT/result records are not a generated native WAIT, completed review or provider result.
    f.c.store.tx(() => {
        f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)', source, cid, '{"fixture":"NON_AUTHORITY"}', 'NON_AUTHORITY controlled wait');
        f.c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', work, 'P', source, null, work, 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'ordinary-conversation', fixture: 'NON_AUTHORITY', conversation: cid, conversationModelMode: mode }));
        for (const budget of ['execution', 'resolution']) f.c.store.run('INSERT INTO budgets VALUES(?,?,8,0,0)', work, budget);
        f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, work, 1, 1, 'SETTLED', path.join(f.home, 'inputs', run), 'none', '{"fixture":"NON_AUTHORITY","outcome":"waiting"}');
        f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignment, cid, target, null, 'COMPLETE', '{"fixture":"NON_AUTHORITY"}');
        f.c.store.run('INSERT INTO conversation_results VALUES(?,?,?,?,?)', result, target, null, null, JSON.stringify({ fixture: 'NON_AUTHORITY', assignmentId: assignment }));
        const data = JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
        f.c.store.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?', work, 'WAITING', JSON.stringify({ ...data, fixture: 'NON_AUTHORITY', runId: run, sourceIdentity: identity, waitHandles: [assignment], continuationAuthorized: true }), cid);
    });
    return { cid, work, run, assignment, result, identity };
}

test('actual ordinary app resolution binds mode and refuses tag loss; explicit legacy remains distinct', async t => {
    const f = await fixture(t), cid = f.conversation.conversationId;
    const expected = await f.models.resolve(cid), request = f.models.conversationOperation(cid);
    assert.throws(() => f.c.runConversation({ conversationId: cid, ...request, supersedeWait() { throw Error('untrusted callback'); } }), /not a public conversation option/);
    await f.queue(cid); const turn = await f.c.runConversation({ conversationId: cid, ...request });
    classifyFailedReservation(f, turn, expected, { kind: 'application', ...request.applicationConversation }); assert.equal(f.seen.length, 1); assert.equal(f.capacity, 1);
    const before = snapshot(f.c);
    await assert.rejects(f.c.runConversation({ conversationId: cid, model: expected }), /application target requires its exact binding/); assert.deepEqual(snapshot(f.c), before);
    for (const invalid of [undefined, null, false, { version: 1, choiceRevision: 0 }]) {
        assert.throws(() => f.c.runConversation({ conversationId: cid, applicationConversation: invalid }), /invalid conversation model binding/); assert.deepEqual(snapshot(f.c), before);
    }
    assert.throws(() => f.c.runConversation({ conversationId: cid, ...request, model: expected }), /choose application binding or explicit recipe/);
    const legacy = f.c.createConversation({ projectId: 'P' }), model = { provider: 'c3-fixture', modelId: 'alpha/slash', managed: await resolveManagedModel(f.home, 'c3-fixture', 'alpha/slash', 'high') };
    await f.queue(legacy.conversationId); const explicit = await f.c.runConversation({ conversationId: legacy.conversationId, model });
    classifyFailedReservation(f, explicit, model, { kind: 'explicit', provider: model.provider, modelId: model.modelId }); assert.equal(f.seen.length, 1);
    const view = f.c.inspectConversation(cid), choice = f.c.getConversationModelChoice(cid);
    // Failed pre-native attempts retain INITIAL_RESERVED input. Do not erase it to fabricate an idle rebind.
    await assert.rejects(f.c.setConversationModelChoice({ conversationId: cid, expectedGeneration: view.generation, expectedRevision: choice.revision, choice: { kind: 'legacy-external', provider: model.provider, modelId: model.modelId } }), /LIFECYCLE_HELD/);
    assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM runs WHERE id=?', turn.runId).data).conversationModelMode, { kind: 'application', ...request.applicationConversation });
    const raw = f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid), data = JSON.parse(raw.data); data.modelChoice = null;
    f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(data), cid); assert.throws(() => f.c.getConversationModelChoice(cid), /Invalid retained conversation model revision/);
    f.pass();
});

test('original assignment transaction inherits only new app targets, keeps distinct target choice, and actual child resolves target', async t => {
    const f = await fixture(t), cid = f.conversation.conversationId;
    await f.queue(cid); const parent = await f.c.runConversation({ conversationId: cid, ...f.models.conversationOperation(cid) });
    const view = f.c.inspectConversation(cid), identity = { conversationId: cid, workId: parent.workId, runId: parent.runId, launchId: null, generation: view.generation, directionRevision: view.directionRevision, initialInputId: parent.inputId ?? f.c.store.one('SELECT id FROM conversation_inputs WHERE conversation=?', cid).id };
    const mode = JSON.parse(f.c.store.one('SELECT data FROM runs WHERE id=?', parent.runId).data).conversationModelMode;
    // NON_AUTHORITY fixture entry: the parent never reached a native producer. This proves the real transaction, not agent tool execution.
    const controls = coordination({ store: f.c.store, interactions: f.c.interactions, identity, modelMode: mode, delegation: { projectIds: ['P'], maxAssignments: 8, rootWorkId: parent.workId }, entry() {}, launch() {}, onWait() {} });
    const sourceChoice = f.c.getConversationModelChoice(cid), originalRun = f.c.store.run.bind(f.c.store); let atomic = 0;
    f.c.store.run = (sql, ...args) => { const result = originalRun(sql, ...args); if (sql.startsWith('INSERT INTO conversation_assignments ')) { const target = f.c.getConversationModelChoice(args[2]); assert.equal(target.kind, 'managed'); assert.ok(target.revision > 0); atomic++; } return result; };
    const inherited = controls.assign({ projectId: 'P', instructions: 'NON_AUTHORITY inherited target' });
    assert.equal(f.c.getConversationModelChoice(inherited.conversationId).modelId, sourceChoice.modelId); assert.equal(atomic, 1);
    const distinct = await f.models.newConversation({ projectId: 'P', choice: await f.models.choice('c3-fixture', 'beta', 'off') }), beforeChoice = f.c.getConversationModelChoice(distinct.conversationId);
    const assigned = controls.assign({ projectId: 'P', conversationId: distinct.conversationId, observedDirectionRevision: f.c.inspectConversation(distinct.conversationId).directionRevision, instructions: 'NON_AUTHORITY distinct target' });
    f.c.store.run = originalRun; assert.equal(atomic, 2); assert.deepEqual(f.c.getConversationModelChoice(distinct.conversationId), beforeChoice);
    for (const kind of ['unbound', 'external', 'malformed']) {
        const target = f.c.createConversation({ projectId: 'P' });
        if (kind === 'external') await f.c.setConversationModelChoice({ conversationId: target.conversationId, expectedGeneration: 0, expectedRevision: 0, choice: { kind: 'legacy-external', provider: 'c3-fixture', modelId: 'beta' } });
        if (kind === 'malformed') f.c.store.run("UPDATE conversation_state SET data=json_set(data,'$.modelChoice',null) WHERE conversation=?", target.conversationId);
        const before = snapshot(f.c); assert.throws(() => controls.assign({ projectId: 'P', conversationId: target.conversationId, observedDirectionRevision: 0, instructions: 'refuse mode conflict' }), /application model|retained conversation model/); assert.deepEqual(snapshot(f.c), before);
    }
    const expected = await f.models.resolve(distinct.conversationId), body = JSON.parse(f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?', assigned.assignmentId).data);
    const child = await f.c.runConversation({ conversationId: distinct.conversationId, initialInputId: body.inputId, ...f.models.conversationOperation(distinct.conversationId) });
    classifyFailedReservation(f, child, expected, { kind: 'application', version: 1, choiceRevision: beforeChoice.revision }); assert.equal(f.seen.at(-1).conversationId, distinct.conversationId);
    const governedTarget = await f.models.newConversation({ projectId: 'P', choice: await f.models.choice('c3-fixture', 'beta', 'off') });
    const governed = controls.assign({ projectId: 'P', conversationId: governedTarget.conversationId, observedDirectionRevision: 0, operation: 'change', instructions: 'NON_AUTHORITY controlled governed target routing; no successful producer' });
    const governedChoice = f.c.getConversationModelChoice(governedTarget.conversationId); let atomicBaseline = false;
    f.c.store.run = (sql, ...args) => { const result = originalRun(sql, ...args); if (sql.startsWith('INSERT INTO works ')) {
        const baseline = f.c.getWorkApplicationModelBaseline(args[0]); assert.equal(baseline.choice.modelId, 'beta');
        assert.deepEqual(baseline.source, { kind: 'conversation', conversationId: governedTarget.conversationId, choiceRevision: governedChoice.revision }); atomicBaseline = true;
    } return result; };
    const operation = f.c.assignmentModelRequest(governed.assignmentId, expected, mode);
    const governedResult = await f.c.ordinaryCore.h.launchChange(governed.assignmentId, operation); f.c.store.run = originalRun;
    assert.equal(atomicBaseline, true); assert.match(governedResult.blocked.join(' '), /CONTROLLED_C3_CAPACITY/);
    const baseline = f.c.getWorkApplicationModelBaseline(governedResult.workId); assert.equal(baseline.choice.modelId, 'beta');
    const launch = f.c.store.one('SELECT * FROM role_launches WHERE work=?', governedResult.workId), roleRun = f.c.store.one('SELECT data FROM runs WHERE id=?', launch.run);
    assert.equal(launch.status, 'UNUSABLE'); assert.deepEqual(JSON.parse(roleRun.data).modelMode, { kind: 'application', version: 1, baselineRevision: baseline.revision });
    const expectedRole = await f.models.resolve(governedTarget.conversationId); assert.equal(JSON.parse(roleRun.data).modelIdentity, hash(modelConfigurationIdentity(expectedRole)));
    const beforeGovernedDrop = snapshot(f.c); await assert.rejects(f.c.ordinaryCore.h.launchChange(governed.assignmentId, { model: expected }), /retained governed model mode differs/); assert.deepEqual(snapshot(f.c), beforeGovernedDrop);
    const inheritedRow = f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?', inherited.assignmentId), inheritedData = JSON.parse(inheritedRow.data);
    assert.deepEqual(inheritedData.modelBinding.inheritedFrom, { conversationId: cid, choiceRevision: sourceChoice.revision });
    delete inheritedData.modelBinding; f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify(inheritedData), inherited.assignmentId);
    const beforeDrop = snapshot(f.c); await assert.rejects(f.c.runConversation({ conversationId: inherited.conversationId, initialInputId: inheritedData.inputId, ...f.models.conversationOperation(inherited.conversationId) }), /retained assignment requires its original explicit route/); assert.deepEqual(snapshot(f.c), beforeDrop);
    assert.ok(!JSON.stringify(snapshot(f.c)).includes('DUMMY_C3_NO_DISPATCH')); f.pass();
});

test('actual awaited conversation resolution refuses newer input and abort without allocation, and close joins it', async t => {
    for (const kind of ['direction', 'abort', 'close']) await t.test(kind, async st => {
        const entered = Promise.withResolvers(), release = Promise.withResolvers();
        const f = await fixture(st, async () => { entered.resolve(); await release.promise; }), cid = f.conversation.conversationId;
        await f.queue(cid); const abort = new AbortController(), run = f.c.runConversation({ conversationId: cid, ...f.models.conversationOperation(cid), signal: abort.signal });
        const result = run.then(value => ({ value }), error => ({ error })); await entered.promise;
        if (kind === 'direction') await f.queue(cid, 'ACTUAL newer owner input');
        if (kind === 'abort') abort.abort(Error('CONTROLLED_OWNER_ABORT'));
        const before = snapshot(f.c); let closed = false, close;
        if (kind === 'close') { close = f.c.close().then(() => { closed = true; }); await new Promise(setImmediate); assert.equal(closed, false); }
        release.resolve(); const outcome = await result; assert.ok(outcome.error); assert.equal(f.capacity, 0);
        if (close) await close; else assert.deepEqual(snapshot(f.c), before);
        f.pass();
    });
});

test('original continuation enqueue atomically claims one controlled wait token and rejects changed results', async t => {
    const f = await fixture(t), first = await controlledWait(f);
    const beforeRuns = f.c.store.one('SELECT COUNT(*) AS n FROM runs').n;
    const receipt = f.c.explicitWaitContinuation(first.cid, true); assert.ok(receipt); assert.equal(receipt.conversationId, first.cid);
    const row = f.c.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', first.cid);
    assert.equal(row.resource, 'IDLE'); assert.equal(JSON.parse(row.data).continuationAuthorized, false);
    assert.equal(f.c.explicitWaitContinuation(first.cid, true), null); assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?', first.cid).n, 1);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, beforeRuns); assert.equal(f.capacity, 0);
    const second = await controlledWait(f), original = f.c.interactions.enqueue.bind(f.c.interactions); let changed;
    f.c.interactions.enqueue = (...args) => { f.c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'UNAVAILABLE', second.assignment); changed = snapshot(f.c); return original(...args); };
    assert.throws(() => f.c.explicitWaitContinuation(second.cid, true), /WAIT continuation token\/source changed/); assert.deepEqual(snapshot(f.c), changed);
    f.c.interactions.enqueue = original;
    assert.equal(f.c.explicitWaitContinuation(second.cid, true), null); assert.ok(f.c.explicitWaitContinuation(second.cid, false));
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?', second.cid).n, 1);
    f.pass();
});

test('restart resolves persisted app wait before mutation and stale resolution cannot overwrite owner input', async t => {
    const f = await fixture(t), wait = await controlledWait(f); await f.c.close();
    const c = await openController({ installationHome: f.home, runtimeProfile: f.c.options.runtimeProfile }), models = new ApplicationModels(c);
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), install = c.installApplicationModelResolver.bind(c); let calls = 0;
    c.installApplicationModelResolver = resolver => install({ ...resolver, resolveConversation: async request => { calls++; entered.resolve(); await release.promise; return resolver.resolveConversation(request); } });
    try {
        const before = snapshot(c); models.install(); await entered.promise; assert.deepEqual(snapshot(c), before);
        c.ordinaryCore.resumeAuthorized(); assert.equal(calls, 1);
        await c.queueConversationInput({ conversationId: wait.cid, expectedGeneration: c.inspectConversation(wait.cid).generation, text: 'ACTUAL newer owner input must survive stale auto-resume', mode: 'idle' });
        const owned = snapshot(c); release.resolve(); await c.ordinaryCore.drain(); assert.deepEqual(snapshot(c), owned); assert.equal(calls, 1);
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n, before.runs.length);
    } finally { release.resolve(); await c.close(); }
    f.pass();
});

test('controlled wait without native history or explicit profile retains authorization after restart', async t => {
    const f = await fixture(t), app = await controlledWait(f), explicit = await controlledWait(f, 'explicit'), malformed = await controlledWait(f);
    const malformedData = JSON.parse(f.c.store.one('SELECT data FROM works WHERE id=?', malformed.work).data); malformedData.conversationModelMode = null;
    f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(malformedData), malformed.work); await f.c.close();
    const c = await openController({ installationHome: f.home, runtimeProfile: f.c.options.runtimeProfile });
    try {
        const count = c.store.one('SELECT COUNT(*) AS n FROM runs').n; new ApplicationModels(c).install(); await c.ordinaryCore.drain();
        for (const wait of [app, explicit, malformed]) {
            const row = c.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', wait.cid), data = JSON.parse(row.data);
            assert.equal(row.resource, 'WAITING'); assert.equal(data.continuationAuthorized, true); assert.deepEqual(data.waitHandles, [wait.assignment]);
            assert.equal(c.store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?', wait.cid).n, 0);
            assert.match(data.continuationError, wait === app ? /APPLICATION_CONTINUATION_UNAVAILABLE/ : wait === explicit ? /EXPLICIT_MODEL_REQUIRED/ : /APPLICATION_MODEL_UNAVAILABLE/);
        }
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM runs').n, count); assert.equal(c.store.one('SELECT COUNT(*) AS n FROM budgets WHERE consumed<>0 OR reserved<>0').n, 0);
    } finally { await c.close(); }
    f.pass();
});


test('actual original SDK coordinator WAIT retains current metadata and refuses stale/uncertain ownership', { timeout: 5000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/c3wait-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained original WAIT world ' + root); });
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/application-conversation-wait-worker.mjs', root], {
            timeout: 4000, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
        });
        await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ stdout, stderr }));
        const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.requests, 0);
        assert.deepEqual(result.records.map(x => [x.scenario, x.onWait]), [['current', 1], ['stale', 0], ['uncertain', 0], ['throw-unowned', 0], ['throw-owned', 0]]);
        assert.ok(result.records.every(x => x.choicePreserved && !x.generated)); passed = true;
    } catch (error) { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr })); throw error; }
});


test('actual owner WAIT reservation supersedes only current owner direction and rolls back refusal', { timeout: 6000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/c3ownerwait-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained owner WAIT world ' + root); });
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/application-conversation-owner-wait-worker.mjs', root], {
            timeout: 5000, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
        });
        await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ stdout, stderr }));
        const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.requests, 0);
        assert.deepEqual(result.records.map(x => [x.scenario, x.admitted]), [['owner', true], ['explicit-owner', true], ['budget', false], ['agent', false], ['source-drift', false]]);
        assert.ok(result.records.every(x => !x.generated)); passed = true;
    } catch (error) { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr })); throw error; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
const tables = ['sources', 'works', 'runs', 'role_launches', 'budgets', 'capacity_leases', 'effect_operations', 'conversation_assignments', 'conversation_state'];
const snapshot = c => Object.fromEntries(tables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
const runtime = { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) };
const parent = { provider: 'EXPLICIT_PARENT_ONLY', modelId: 'not-subject' };
async function world(t, install = true) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/c4a-'))), home = path.join(root, 'app'), project = path.join(root, 'project');
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.txt'), 'NON_AUTHORITY source capture');
    const c = await openController({ installationHome: home, runtimeProfile: runtime, effectsProfile: { gitBinary: '/usr/bin/false' } });
    let passed = false; t.after(async () => { await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained effect model fixture ' + root); });
    await c.registerProject({ id: 'P', sourceRoot: project });
    await ApplicationAccounts.open(c).configure({ providers: { 'effect-app-fixture': { api: 'openai-completions', apiKey: 'DUMMY_EFFECT_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'subject-beta', contextWindow: 8192, maxTokens: 256 }] } } });
    await ApplicationAccounts.open(c).setDefault('effect-app-fixture', 'subject-beta');
    const models = new ApplicationModels(c); if (install) models.install();
    const baseline = await models.baseline('P');
    const app = await c.beginChange({ projectId: 'P', request: 'Unreviewed source-only app subject', applicationModelBaseline: baseline });
    const legacy = await c.beginChange({ projectId: 'P', request: 'Unreviewed source-only explicit subject' });
    return { c, models, root, home, app, legacy, pass() { passed = true; } };
}
function alias(f, kind, workId) {
    const assignment = randomUUID(), op = randomUUID(), target = randomUUID(), grant = randomUUID(), cid = f.c.createConversation({ projectId: 'P' }).conversationId;
    // NON_AUTHORITY aliases/operation; no grant, review-ready or generated effect standing.
    f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)', target, 'P', '{"kind":"local-git","fixture":"NON_AUTHORITY"}');
    f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, workId, target, 1, '{"fixture":"NON_AUTHORITY no action grant"}');
    const operation = kind === 'publication' ? 'effect-publication' : 'effect-prepare';
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignment, cid, cid, workId, 'QUEUED', JSON.stringify({ operation, effectOperationId: op, fixture: 'NON_AUTHORITY' }));
    f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', op, workId, target, grant, 'PREPARED', JSON.stringify({ kind: kind === 'publication' ? 'publication' : 'local-git', assignmentId: assignment, conversationId: cid, fixture: 'NON_AUTHORITY' }));
    return { assignment, op, target, cid, workId };
}

test('subject retained model mode is strict and independent of explicit coordinator recipe', async t => {
    const f = await world(t), before = snapshot(f.c);
    const app = f.c.retainedWorkModelOperation(f.app.workId, parent);
    assert.deepEqual(app, { workId: f.app.workId, applicationModel: { version: 1, baselineRevision: 1 } });
    assert.deepEqual(f.c.retainedWorkModelOperation(f.legacy.workId, parent), { workId: f.legacy.workId, model: parent });
    assert.throws(() => f.c.retainedWorkModelOperation(f.legacy.workId), /explicit subject model profile/);
    for (const request of [{ workId: f.app.workId, model: parent }, { ...app, model: parent }, { ...app, applicationModel: null }, { ...app, applicationModel: { version: 1, baselineRevision: 2 } }, { workId: f.legacy.workId, applicationModel: app.applicationModel }]) {
        assert.throws(() => f.c.changes.captureModelOperation(request), /APPLICATION_MODEL_UNAVAILABLE/);
        assert.throws(() => f.c.prepareIntegration({ ...request, targetId: 'UNUSED' }), /APPLICATION_MODEL_UNAVAILABLE/);
    }
    assert.deepEqual(snapshot(f.c), before);
    for (const invalid of [null, false]) {
        f.c.store.run("UPDATE works SET data=json_set(data,'$.applicationModelBaseline',json(?)) WHERE id=?", JSON.stringify(invalid), f.app.workId);
        const fault = snapshot(f.c); assert.throws(() => f.c.retainedWorkModelOperation(f.app.workId, parent), /APPLICATION_MODEL_UNAVAILABLE/); assert.deepEqual(snapshot(f.c), fault);
    }
    f.pass();
});

test('missing app resolver refuses effect mode before operation or assignment mutation', async t => {
    const f = await world(t, false), a = alias(f, 'publication', f.app.workId), before = snapshot(f.c);
    assert.throws(() => f.c.retainedWorkModelOperation(f.app.workId, parent), /resolver is not installed/);
    await assert.rejects(f.c.publicationEngine.runQueued(a.assignment, { workId: f.app.workId, applicationModel: { version: 1, baselineRevision: 1 } }), /resolver is not installed/);
    assert.deepEqual(snapshot(f.c), before); f.pass();
});

test('original queued controller and effect entries forward actual subject operands at controlled preparation seams', async t => {
    const f = await world(t);
    for (const kind of ['integration', 'publication']) for (const work of [f.app, f.legacy]) {
        const a = alias(f, kind, work.workId), engine = kind === 'publication' ? f.c.publicationEngine : f.c.effects;
        const expected = f.c.retainedWorkModelOperation(work.workId, parent), original = engine.runQueued.bind(engine); let atController;
        engine.runQueued = async (id, operation) => { assert.equal(id, a.assignment); atController = operation; return { phase: 'REFUSED', fixture: 'NON_AUTHORITY forwarding boundary' }; };
        await f.c.ordinaryCore.h.launchEffect(a.assignment, parent); engine.runQueued = original;
        assert.deepEqual(atController, expected);
        const before = snapshot(f.c);
        await assert.rejects(original(a.assignment, { workId: work.workId, ...(work === f.app ? { model: parent } : { applicationModel: { version: 1, baselineRevision: 1 } }) }), /APPLICATION_MODEL_UNAVAILABLE/);
        assert.deepEqual(snapshot(f.c), before);
        let captured;
        if (kind === 'publication') {
            const prepare = engine.prepareAgent.bind(engine);
            engine.prepareAgent = async (id, operation) => { assert.equal(id, a.op); captured = operation; return { phase: 'REFUSED' }; };
            await original(a.assignment, expected); engine.prepareAgent = prepare;
        } else {
            const prepare = engine.prepare.bind(engine);
            engine.prepare = async operation => { captured = operation; return { phase: 'REFUSED' }; };
            await original(a.assignment, expected); engine.prepare = prepare;
        }
        assert.equal(captured.workId, work.workId);
        assert.deepEqual(captured.applicationModel, expected.applicationModel); assert.deepEqual(captured.model, expected.model);
        assert.equal(Object.hasOwn(captured, 'sessionPreferences'), false);
        // Controlled preparation callbacks above deliberately do not grant/drive/send effects.
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM role_launches').n, 0);
    }
    f.pass();
});

test('queued publication rechecks exact subject and assignment after prior producer settles', async t => {
    const f = await world(t);
    for (const fault of ['assignment', 'generation']) {
        const a = alias(f, 'publication', f.app.workId), release = Promise.withResolvers();
        // NON_AUTHORITY scheduling barrier, not an executing native/model producer.
        f.c.active.set(f.app.workId, { abort: new AbortController(), done: release.promise });
        let calls = 0; const original = f.c.publicationEngine.runQueued;
        f.c.publicationEngine.runQueued = async () => { calls++; throw Error('Must not cross drift'); };
        try {
            const pending = f.c.ordinaryCore.h.launchEffect(a.assignment, parent);
            if (fault === 'assignment') f.c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.fixture','NON_AUTHORITY changed') WHERE id=?", a.assignment);
            else f.c.store.run('UPDATE works SET generation=generation+1 WHERE id=?', f.app.workId);
            const current = snapshot(f.c); release.resolve(); await assert.rejects(pending, /changed while waiting/);
            assert.equal(calls, 0); assert.deepEqual(snapshot(f.c), current);
        } finally { release.resolve(); f.c.active.delete(f.app.workId); f.c.publicationEngine.runQueued = original; }
    }
    f.pass();
});

test('actual CLI effect preparation chooses retained mode before external profile reads', async t => {
    const f = await world(t), user = path.join(f.root, 'user'); await fs.mkdir(user); const before = snapshot(f.c); await f.c.close();
    let serial = 0;
    const env = { HOME: user, TMPDIR: path.join(f.home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' };
    const run = async (work, extra = []) => {
        const args = ['--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'effect', 'prepare-integration', '--home', f.home, '--work', work, '--target', 'UNAVAILABLE_NO_SEND', '--git-binary', '/usr/bin/false', '--docker-binary', runtime.dockerBinary, '--docker-context', runtime.dockerContext, '--image', runtime.image, ...extra];
        let outcome;
        try { outcome = { code: 0, ...await promisify(execFile)(process.execPath, args, { env, timeout: 2500 }) }; }
        catch (error) { if (typeof error.code === 'number') outcome = { code: error.code, stdout: error.stdout, stderr: error.stderr }; else throw error; }
        await fs.writeFile(path.join(f.root, 'cli-' + (++serial) + '.json'), JSON.stringify({ args, ...outcome }));
        t.diagnostic(JSON.stringify({ kind: 'C4 CLI exact outcome', args, ...outcome }));
        return outcome;
    };
    const bad = path.join(f.root, 'never-read-profile'); await fs.writeFile(bad, 'NOT A PROFILE');
    const conflict = await run(f.app.workId, ['--model-profile', bad]); assert.equal(conflict.code, 2); assert.match(conflict.stderr, /omit --model-profile/);
    const legacy = await run(f.legacy.workId); assert.equal(legacy.code, 2); assert.match(legacy.stderr, /requires its explicit --model-profile/);
    const app = await run(f.app.workId); assert.equal(app.code, 2); assert.doesNotMatch(app.stderr, /requires.*model-profile/);
    assert.equal(app.stdout, ''); const unavailable = JSON.parse(app.stderr);
    assert.equal(unavailable.error, 'UNAVAILABLE'); assert.match(unavailable.message, /Current governed standing unavailable/);
    const reopened = await openController({ installationHome: f.home });
    try {
        assert.deepEqual(snapshot(reopened), before);
        assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM runs').n, 2, 'Two original source captures retained; no extra model/effect runs');
        for (const table of ['effect_operations', 'role_launches', 'capacity_leases']) assert.equal(reopened.store.one('SELECT COUNT(*) AS n FROM ' + table).n, 0);
    } finally { await reopened.close(); }
    f.pass();
});

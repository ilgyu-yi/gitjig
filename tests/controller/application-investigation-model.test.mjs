import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
const runtime = { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) };
const tables = ['sources', 'works', 'requirements', 'runs', 'budgets', 'conversations', 'capacity_leases'];
const snapshot = c => Object.fromEntries(tables.map(table => [table, c.store.all('SELECT * FROM ' + table + ' ORDER BY rowid')]));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function world(t, install = true) {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/c4b-'))), home = path.join(root, 'app'), project = path.join(root, 'project');
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.txt'), 'NON_AUTHORITY investigation admission fixture');
    let c = await openController({ installationHome: home, runtimeProfile: runtime });
    let passed = false; t.after(async () => {
        let uncertain = true;
        try {
            uncertain = c.store.all('SELECT phase,data FROM runs').some(run => run.phase === 'UNKNOWN' || String(JSON.parse(run.data).cleanup ?? '').startsWith('quarantined')) ||
                c.store.all('SELECT state FROM works').some(work => ['UNKNOWN', 'QUARANTINED'].includes(work.state));
        } catch { /* Unavailable inspection cannot justify deleting retained journals. */ }
        await c.close();
        if (passed && !uncertain) await fs.rm(root, { recursive: true, force: true });
        else t.diagnostic(JSON.stringify({ retainedInvestigationWorld: root, passed, uncertain }));
    });
    await c.registerProject({ id: 'P', sourceRoot: project });
    const account = ApplicationAccounts.open(c);
    await account.configure({ providers: { 'investigation-fixture': { api: 'openai-completions', apiKey: 'DUMMY_NO_REQUEST', baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta'].map(id => ({ id, contextWindow: 8192, maxTokens: 256 })) } } });
    await account.setDefault('investigation-fixture', 'alpha');
    let models = new ApplicationModels(c); if (install) models.install();
    const baseline = await models.baseline('P');
    // Original admission/settlement, deliberately failed before capacity/engine/native dispatch.
    c.capacity.acquire = async () => { throw Error('CONTROLLED_PRE_CAPACITY_REFUSAL'); };
    return { get c() { return c; }, get models() { return models; }, root, home, baseline,
        async reopen() { await c.close(); c = await openController({ installationHome: home, runtimeProfile: runtime }); models = new ApplicationModels(c); models.install(); c.capacity.acquire = async () => { throw Error('CONTROLLED_PRE_CAPACITY_REFUSAL'); }; },
        pass() { passed = true; } };
}
const start = f => ({ projectId: 'P', message: 'Inspect selected project', applicationModelBaseline: f.baseline });
const retained = workId => ({ workId, applicationModel: { version: 1, baselineRevision: 1 } });

test('original investigation admission and restart resume retain baseline, roleless choice and shared allowance', async t => {
    const f = await world(t);
    await f.models.setRole('planner', await f.models.choice('investigation-fixture', 'beta', 'off'));
    const first = await f.c.startConversation(start(f));
    assert.equal(first.status, 'unavailable'); assert.match(first.stderr, /CONTROLLED_PRE_CAPACITY_REFUSAL/);
    const original = f.c.inspectWork(first.workId), initial = original.runs[0];
    assert.ok(f.c.store.one('SELECT conversation FROM conversation_state WHERE conversation=?', initial.data.conversation), 'Original admission registers lifecycle state without a later list/manage call');
    assert.ok(f.c.store.one('SELECT child FROM conversation_relations WHERE child=?', initial.data.conversation));
    assert.ok(f.c.store.one('SELECT conversation FROM conversation_views WHERE conversation=?', initial.data.conversation));
    assert.equal(initial.data.kind, 'investigation'); assert.equal(initial.data.modelIdentity.modelId, 'alpha');
    assert.deepEqual(initial.data.modelMode, { kind: 'application', version: 1, baselineRevision: 1 });
    assert.equal(original.allowance.consumed, 1); assert.equal(original.allowance.reserved, 0);
    assert.deepEqual(f.c.getWorkApplicationModelBaseline(first.workId), f.baseline);
    await ApplicationAccounts.open(f.c).setDefault('investigation-fixture', 'beta');
    await f.reopen();
    const second = await f.c.resumeWork({ ...retained(first.workId), message: 'Continue the same investigation' });
    assert.equal(second.workId, first.workId); assert.notEqual(second.runId, first.runId);
    const after = f.c.inspectWork(first.workId);
    assert.equal(after.runs[1].data.modelIdentity.modelId, 'alpha'); assert.equal(after.runs[1].data.conversation, initial.data.conversation);
    assert.equal(after.allowance.consumed, 2); assert.equal(after.allowance.reserved, 0);
    assert.deepEqual(after.runs[0], initial); assert.deepEqual(f.c.getWorkApplicationModelBaseline(first.workId), f.baseline);
    f.pass();
});

test('invalid modes and missing baseline resolver refuse before predecessor recovery or mutation', async t => {
    const f = await world(t), first = await f.c.startConversation(start(f));
    let recoveries = 0; const original = f.c.validatePredecessor.bind(f.c);
    f.c.validatePredecessor = async (...args) => { recoveries++; return original(...args); };
    const before = snapshot(f.c);
    for (const options of [
        { projectId: 'P', message: 'x', continuationCheckpoint: first.workId, model: { provider: 'legacy', modelId: 'x' } },
        { ...start(f), continuationCheckpoint: first.workId },
        { projectId: 'P', message: 'x', applicationModel: { version: 1, baselineRevision: 1 } },
        { ...start(f), model: undefined },
        { ...start(f), applicationModelBaseline: null },
        { projectId: 'P', message: 'x', continuationCheckpoint: first.workId, applicationModel: { version: 1, baselineRevision: 2 } },
    ]) await assert.rejects(f.c.startConversation(options), /APPLICATION_MODEL_UNAVAILABLE/);
    await assert.rejects(f.c.resumeWork({ ...retained(first.workId), model: undefined }), /APPLICATION_MODEL_UNAVAILABLE/);
    assert.equal(recoveries, 0); assert.deepEqual(snapshot(f.c), before); f.pass();
    const missing = await world(t, false), empty = snapshot(missing.c);
    await assert.rejects(missing.c.startConversation(start(missing)), /baseline resolver is not installed/);
    assert.deepEqual(snapshot(missing.c), empty); missing.pass();
});

test('actual baseline callback barriers refuse project or retained checkpoint drift before admission', async t => {
    const f = await world(t);
    for (const target of ['new', 'retained']) {
        const first = target === 'retained' ? await f.c.startConversation(start(f)) : undefined;
        const entered = deferred(), release = deferred(), original = f.models.resolveDesiredChoice.bind(f.models);
        f.models.resolveDesiredChoice = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
        const operation = first ? f.c.resumeWork(retained(first.workId)) : f.c.startConversation(start(f));
        const rejected = assert.rejects(operation, /changed during (investigation preparation|model resolution)/);
        await entered.promise;
        if (first) f.c.store.run("UPDATE runs SET data=json_set(data,'$.fixtureDrift',1) WHERE id=?", first.runId);
        else f.c.store.run('UPDATE projects SET profile=? WHERE id=?', '{"maxEntries":77}', 'P');
        const drifted = snapshot(f.c); release.resolve(); await rejected;
        assert.deepEqual(snapshot(f.c), drifted); f.models.resolveDesiredChoice = original;
    }
    f.pass();
});

test('close joins the real preparation tail and cancellation admits no phantom work', async t => {
    for (const action of ['abort', 'close']) {
        const f = await world(t), entered = deferred(), release = deferred(), original = f.models.resolveDesiredChoice.bind(f.models);
        f.models.resolveDesiredChoice = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
        const abort = new AbortController(), before = snapshot(f.c);
        const operation = f.c.startConversation({ ...start(f), signal: abort.signal });
        const rejected = assert.rejects(operation);
        await entered.promise;
        let closed = false, closing;
        if (action === 'abort') abort.abort();
        else { closing = f.c.close().then(() => { closed = true; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); }
        release.resolve(); await rejected;
        if (closing) { await closing; await f.reopen(); }
        assert.deepEqual(snapshot(f.c), before); f.pass();
    }
});

test('original recovery annotations survive refusal and final admit transaction rejects late project drift', async t => {
    const f = await world(t), first = await f.c.startConversation(start(f));
    // NON_AUTHORITY partial-history observation: original recovery checks the actual absent path.
    const prior = f.c.store.one('SELECT data FROM runs WHERE id=?', first.runId);
    f.c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(prior.data), nativeInputObserved: true, historyRef: path.join(f.root, 'NO_NATIVE_HISTORY'), nativeSessionId: 'unstarted-fixture' }), first.runId);
    const original = f.models.resolveDesiredChoice.bind(f.models);
    f.models.resolveDesiredChoice = async () => { throw Error('CONTROLLED_RESOLUTION_REFUSAL'); };
    await assert.rejects(f.c.resumeWork(retained(first.workId)), /CONTROLLED_RESOLUTION_REFUSAL/);
    const recovered = f.c.inspectWork(first.workId);
    assert.equal(recovered.runs.length, 1); assert.equal(recovered.allowance.consumed, 1);
    assert.equal(recovered.runs[0].data.nativeRecovery.kind, 'no-persisted-history-before-dispatch');
    const before = snapshot(f.c), tx = f.c.store.tx.bind(f.c.store); let injected = false;
    f.models.resolveDesiredChoice = async (...args) => {
        const model = await original(...args);
        f.c.store.tx = callback => {
            if (!injected) { injected = true; f.c.store.run('UPDATE projects SET profile=? WHERE id=?', '{"maxEntries":91}', 'P'); }
            return tx(callback);
        };
        return model;
    };
    await assert.rejects(f.c.startConversation(start(f)), /project or runtime changed/);
    assert.equal(injected, true); assert.deepEqual(snapshot(f.c), before); f.c.store.tx = tx; f.pass();
});

test('legacy investigation stays explicit and local command rejects own model operands', async t => {
    const f = await world(t), model = { provider: 'legacy-fixture', modelId: 'explicit-only' };
    const first = await f.c.startConversation({ projectId: 'P', message: 'Legacy investigation', model });
    assert.equal(f.c.getWorkApplicationModelBaseline(first.workId), undefined);
    await assert.rejects(f.c.resumeWork({ workId: first.workId }), /APPLICATION_MODEL_UNAVAILABLE/);
    const second = await f.c.resumeWork({ workId: first.workId, model });
    assert.equal(second.workId, first.workId); assert.equal(f.c.inspectWork(first.workId).allowance.consumed, 2);
    const command = await f.c.runLocalCheck({ projectId: 'P', command: 'NEVER_EXECUTE' });
    for (const key of ['model', 'applicationModel', 'applicationModelBaseline', 'sessionPreferences']) {
        const before = snapshot(f.c);
        await assert.rejects(f.c.runLocalCheck({ projectId: 'P', command: 'NEVER_EXECUTE', [key]: undefined }), /no model operand/);
        await assert.rejects(f.c.resumeWork({ workId: command.workId, [key]: undefined }), /cannot accept/);
        assert.deepEqual(snapshot(f.c), before);
    }
    f.pass();
});

test('actual CLI selects retained mode before profile reads and resumes application investigation without a profile', async t => {
    const f = await world(t), first = await f.c.startConversation(start(f)), before = f.c.inspectWork(first.workId);
    await f.c.close();
    const base = ['dist/cli/main.js', 'work', 'resume', '--home', f.home, '--work', first.workId, '--message', 'Continue app baseline', '--docker-binary', runtime.dockerBinary, '--docker-context', runtime.dockerContext, '--image', runtime.image];
    const invoke = async args => {
        const result = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', ...args], { timeout: 4000, maxBuffer: 1024 * 1024 }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
        t.diagnostic(JSON.stringify({ args, ...result })); return result;
    };
    const conflict = await invoke([...base, '--model-profile', path.join(f.root, 'MUST_NOT_READ')]);
    assert.equal(conflict.code, 2); assert.match(JSON.parse(conflict.stderr).message, /omit --model-profile/);
    await f.reopen(); assert.deepEqual(f.c.inspectWork(first.workId), before); await f.c.close();
    const resumed = await invoke(base);
    assert.equal(resumed.code, 2); const result = JSON.parse(resumed.stdout);
    assert.equal(result.workId, first.workId); assert.equal(result.status, 'unavailable');
    // Original /usr/bin/false engine refusal is an admitted failed attempt, not native success.
    await f.reopen(); const after = f.c.inspectWork(first.workId);
    assert.equal(after.allowance.consumed, 2); assert.equal(after.allowance.reserved, 0);
    assert.equal(after.runs[1].data.modelIdentity.modelId, 'alpha');
    assert.deepEqual(f.c.getWorkApplicationModelBaseline(first.workId), f.baseline); f.pass();
});

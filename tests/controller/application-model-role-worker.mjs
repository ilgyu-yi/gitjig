import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { resolveManagedModel } from '../../dist/pi/managed-provider.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
const root = process.argv[2], hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex'); let serial = 0, requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No request in application role admission fixture'); };
const authorityTables = ['sources', 'runs', 'role_launches', 'role_outputs', 'budgets', 'capacity_leases'];
const snapshot = c => Object.fromEntries(authorityTables.map(name => [name, c.store.all('SELECT * FROM ' + name + ' ORDER BY rowid')]));
async function world({ install = true, explicit = false, barrier, role = 'planner' } = {}) {
    const n = serial++, home = path.join(root, 'a' + n), project = path.join(root, 'user', 'p' + n);
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'file.txt'), 'SOURCE');
    const c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'never-executed', image: 'sha256:' + '0'.repeat(64) } });
    await c.registerProject({ id: 'P', sourceRoot: project });
    const accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c);
    await accounts.configure({ providers: { 'role-fixture': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'DUMMY_ROLE_NO_REQUEST',
        models: [{ id: 'alpha', reasoning: true, contextWindow: 8192, maxTokens: 256, compat: { supportsReasoningEffort: true } }, { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('role-fixture', 'alpha');
    await models.setRole(role, await models.choice('role-fixture', 'beta', 'off'));
    const baseline = await models.baseline('P'); const expected = structuredClone(baseline);
    const seen = [], installOriginal = c.installApplicationModelResolver.bind(c);
    c.installApplicationModelResolver = resolver => installOriginal({ ...resolver, resolveRole: async request => {
        seen.push(structuredClone(request)); await barrier?.(request); return resolver.resolveRole(request);
    } });
    if (install) models.install();
    const originalRun = c.store.run.bind(c.store); let atomic = false;
    c.store.run = (sql, ...args) => { const result = originalRun(sql, ...args); if (sql.startsWith('INSERT INTO works ')) {
        const data = JSON.parse(c.store.one('SELECT data FROM works WHERE id=?', args[0]).data);
        assert.equal(Object.hasOwn(data, 'applicationModelBaseline'), !explicit);
        if (!explicit) assert.deepEqual(data.applicationModelBaseline, expected); atomic = true;
    } return result; };
    const pending = c.beginChange({ projectId: 'P', request: 'A bounded source-only model admission fixture', ...(explicit ? {} : { applicationModelBaseline: baseline }) });
    baseline.choice.modelId = 'CALLER_MUTATION_AFTER_BEGIN';
    const work = await pending; c.store.run = originalRun; assert.equal(atomic, true); assert.ok(work.baseVersion);
    const options = explicit ? { workId: work.workId, model: { provider: 'role-fixture', modelId: 'alpha', managed: await resolveManagedModel(home, 'role-fixture', 'alpha', 'high') } } : { workId: work.workId, ...models.workOperation(work.workId) };
    let capacityCalls = 0;
    // Actual reserve occurs, then a controlled dependency refusal stops before any engine/SDK/model producer.
    c.changes.h.acquireCapacity = async () => { capacityCalls++; throw Error('CONTROLLED_CAPACITY_REFUSAL_BEFORE_ENGINE'); };
    return { c, models, work, options, home, project, expected, seen, get capacityCalls() { return capacityCalls; } };
}
async function noNewAuthority(f, action) {
    const before = snapshot(f.c); await action(); assert.deepEqual(snapshot(f.c), before); assert.equal(f.capacityCalls, 0);
}
{
    const f = await world();
    try {
        const initial = snapshot(f.c);
        for (const bad of [null, false, { ...f.expected, revision: 0 }, { ...f.expected, choice: { ...f.expected.choice, apiKey: 'NEVER_PERSIST' } }])
            await assert.rejects(f.c.beginChange({ projectId: 'P', request: 'invalid', applicationModelBaseline: bad }));
        assert.deepEqual(snapshot(f.c), initial);
        const view = await f.models.newConversation({ projectId: 'P' }), choice = f.c.getConversationModelChoice(view.conversationId),
            attributed = { ...f.expected, source: { kind: 'conversation', conversationId: view.conversationId, choiceRevision: choice.revision } };
        const beforeAttribution = snapshot(f.c);
        await assert.rejects(f.c.beginChange({ projectId: 'P', request: 'stale attribution', applicationModelBaseline: { ...attributed, source: { ...attributed.source, choiceRevision: choice.revision + 1 } } }), /baseline conversation choice changed/);
        assert.deepEqual(snapshot(f.c), beforeAttribution);
        const attributedWork = await f.c.beginChange({ projectId: 'P', request: 'actual model choice attribution', applicationModelBaseline: attributed });
        assert.deepEqual(f.c.getWorkApplicationModelBaseline(attributedWork.workId), attributed);
        assert.throws(() => f.models.install(), /install.*once/);
        for (const options of [{ workId: f.work.workId, model: { provider: 'unused', modelId: 'unused' } }, { ...f.options, applicationModel: null }, { ...f.options, applicationModel: false }, { ...f.options, applicationModel: undefined }, { ...f.options, applicationModel: { version: 1, baselineRevision: 2 } }])
            await noNewAuthority(f, () => assert.rejects(f.c.planChange(options), /APPLICATION_MODEL_UNAVAILABLE/));
        const row = f.c.store.one('SELECT data FROM works WHERE id=?', f.work.workId), data = JSON.parse(row.data);
        for (const baseline of [null, false, { ...f.expected, revision: -1 }]) {
            f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...data, applicationModelBaseline: baseline }), f.work.workId);
            await noNewAuthority(f, () => assert.rejects(f.c.planChange(f.options), /APPLICATION_MODEL_UNAVAILABLE/));
        }
        const { applicationModelBaseline, ...without } = data; f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(without), f.work.workId);
        await noNewAuthority(f, () => assert.rejects(f.c.planChange(f.options), /APPLICATION_MODEL_UNAVAILABLE/));
        f.c.store.run('UPDATE works SET data=? WHERE id=?', row.data, f.work.workId);
        assert.equal(f.seen.length, 0);
    } finally { await f.c.close(); }
}
{
    const f = await world({ install: false });
    try { await noNewAuthority(f, () => assert.rejects(f.c.planChange(f.options), /resolver is not installed/)); }
    finally { await f.c.close(); }
}
for (const kind of ['cancel', 'epoch', 'baseline', 'source-impacts', 'request-copy', 'companion-copy']) {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const f = await world({ barrier: async request => { entered.resolve(); await release.promise; if (kind === 'request-copy') { request.baseline.choice.modelId = 'UNAVAILABLE_COPY'; throw Error('CONTROLLED_REQUEST_COPY_REFUSAL'); } } });
    try {
        const abort = new AbortController(), options = { ...f.options, applicationModel: { ...f.options.applicationModel }, signal: abort.signal }, before = snapshot(f.c);
        const task = f.c.planChange(options); await entered.promise;
        assert.deepEqual(snapshot(f.c), before); assert.equal(f.capacityCalls, 0);
        const beforeChange = f.c.store.one('SELECT * FROM change_state WHERE work=?', f.work.workId);
        if (kind === 'cancel') abort.abort();
        if (kind === 'epoch') f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?', f.work.workId);
        if (kind === 'baseline') { const data = JSON.parse(f.c.store.one('SELECT data FROM works WHERE id=?', f.work.workId).data); data.applicationModelBaseline.choice.modelId = 'beta'; f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(data), f.work.workId); }
        if (kind === 'source-impacts') f.c.changes.h.sourceImpacts = () => [{ input_id: 'CONTROLLED_IMPACT', revision: 1, source: 'CONTROLLED_SOURCE', data: {} }];
        if (kind === 'companion-copy') options.applicationModel.baselineRevision = 99;
        const afterAllowed = snapshot(f.c);
        release.resolve(); const result = await task;
        assert.equal(f.seen.length, 1); assert.equal(f.seen[0].role, 'planner'); assert.deepEqual(f.seen[0].baseline, f.expected);
        if (kind === 'companion-copy') { assert.equal(f.capacityCalls, 1); assert.match(result.blocked.join(' '), /CONTROLLED_CAPACITY/); }
        else {
            assert.deepEqual(snapshot(f.c), afterAllowed); assert.equal(f.capacityCalls, 0);
            if (['cancel', 'epoch', 'source-impacts'].includes(kind)) {
                assert.deepEqual(f.c.store.one('SELECT * FROM change_state WHERE work=?', f.work.workId), beforeChange);
                const work = f.c.store.one('SELECT state,epoch FROM works WHERE id=?', f.work.workId);
                assert.equal(work.state, kind === 'cancel' ? 'CANCELLED' : 'ACTIVE');
                assert.equal(work.epoch, kind === 'source-impacts' ? 1 : 2);
            } else assert.match(result.blocked.join(' '), /APPLICATION_MODEL_UNAVAILABLE|CONTROLLED_REQUEST_COPY/u);
        }
        if (kind === 'request-copy') assert.deepEqual(f.c.getWorkApplicationModelBaseline(f.work.workId), f.expected);
    } finally { release.resolve(); await f.c.close(); }
}
{
    const f = await world();
    try {
        const original = f.c.changes.bundle.bind(f.c.changes), entered = Promise.withResolvers(), release = Promise.withResolvers();
        f.c.changes.bundle = async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; };
        const before = snapshot(f.c), task = f.c.planChange(f.options); await entered.promise;
        const data = JSON.parse(f.c.store.one('SELECT data FROM works WHERE id=?', f.work.workId).data); data.applicationModelBaseline.revision = 2;
        f.c.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(data), f.work.workId); release.resolve(); await task;
        assert.deepEqual(snapshot(f.c), before); assert.equal(f.capacityCalls, 0);
    } finally { await f.c.close(); }
}
{
    const f = await world();
    try {
        const result = await f.c.planChange(f.options); assert.equal(f.capacityCalls, 1); assert.equal(f.seen.length, 1);
        assert.match(result.blocked.join(' '), /CONTROLLED_CAPACITY/);
        const launch = f.c.store.one('SELECT * FROM role_launches WHERE work=?', f.work.workId), run = f.c.store.one('SELECT data FROM runs WHERE id=?', launch.run), selected = await resolveManagedModel(f.home, 'role-fixture', 'beta', 'off');
        const expected = hash(modelConfigurationIdentity({ provider: 'role-fixture', modelId: 'beta', managed: selected, sessionPreferences: f.options.sessionPreferences }));
        assert.equal(JSON.parse(launch.data).modelIdentity, expected); assert.equal(JSON.parse(run.data).modelIdentity, expected);
        assert.deepEqual(JSON.parse(run.data).modelMode, { kind: 'application', version: 1, baselineRevision: 1 }); assert.equal(launch.status, 'UNUSABLE');
        assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM budgets WHERE reserved<>0").n, 0);
    } finally { await f.c.close(); }
}
{
    const f = await world({ explicit: true });
    try {
        const result = await f.c.planChange(f.options); assert.equal(f.capacityCalls, 1); assert.equal(f.seen.length, 0); assert.match(result.blocked.join(' '), /CONTROLLED_CAPACITY/);
        const launch = f.c.store.one('SELECT data FROM role_launches WHERE work=?', f.work.workId);
        assert.equal(JSON.parse(launch.data).modelIdentity, hash(modelConfigurationIdentity(f.options.model))); assert.deepEqual(JSON.parse(launch.data).modelMode, { kind: 'explicit' });
    } finally { await f.c.close(); }
}
for (const kind of ['reject', 'target-drift', 'reserve']) {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const f = await world({ role: 'adjudicator', barrier: async () => { entered.resolve(); await release.promise; if (kind === 'reject') throw Error('CONTROLLED_ROLE_RESOLUTION_REFUSAL'); } });
    try {
        f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)', 'T', 'P', '{"fixture":"NON_AUTHORITY"}');
        f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', 'G', f.work.workId, 'T', 1, '{"fixture":"NON_AUTHORITY"}');
        f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', 'PUB', f.work.workId, 'T', 'G', 'PREPARED', '{"kind":"publication","fixture":"NON_AUTHORITY"}');
        const before = snapshot(f.c), task = f.c.changes.publicationJudgment({ ...f.options, inputBundle: { requirements: [], contracts: 'NON_AUTHORITY', sources: [], requiredScope: [], context: { operationId: 'PUB', actionFamily: 'fixture' } }, sourceFingerprint: 'NON_AUTHORITY', operationId: 'PUB' });
        const outcome = task.then(value => ({ value }), error => ({ error })); await entered.promise; assert.deepEqual(snapshot(f.c), before);
        if (kind === 'target-drift') f.c.store.run('UPDATE effect_operations SET phase=? WHERE id=?', 'CONTROLLED_CHANGED', 'PUB');
        release.resolve(); const result = await outcome; assert.equal(f.seen[0].role, 'adjudicator');
        if (kind !== 'reserve') assert.ok(result.error);
        if (kind === 'reject') assert.match(String(result.error), /CONTROLLED_ROLE_RESOLUTION_REFUSAL/);
        if (kind === 'target-drift') assert.match(String(result.error), /publication target changed/);
        if (kind === 'reserve') {
            assert.equal(result.error, undefined); assert.equal(result.value.usable, false); assert.equal(result.value.admitted, false); assert.equal(result.value.protocol, null);
            assert.ok(result.value.issues.some(issue => issue.includes('CONTROLLED_CAPACITY_REFUSAL_BEFORE_ENGINE')));
            assert.equal(f.capacityCalls, 1); const run = f.c.store.one("SELECT data FROM runs WHERE work=? AND json_extract(data,'$.kind')='publication-judgment'", f.work.workId), data = JSON.parse(run.data);
            const actualRun = f.c.store.one('SELECT * FROM runs WHERE id=?', result.value.runId), launch = f.c.store.one('SELECT * FROM role_launches WHERE id=?', result.value.launchId);
            assert.equal(actualRun.phase, 'SETTLED'); assert.equal(JSON.parse(actualRun.data).cleanup, 'unbound'); assert.equal(launch.status, 'UNUSABLE');
            assert.equal(launch.run, actualRun.id); assert.equal(launch.work, f.work.workId);
            assert.equal(JSON.parse(launch.data).modelIdentity, data.modelIdentity); assert.deepEqual(JSON.parse(launch.data).modelMode, data.modelMode);
            const selected = await resolveManagedModel(f.home, 'role-fixture', 'beta', 'off');
            assert.equal(data.modelIdentity, hash(modelConfigurationIdentity({ provider: 'role-fixture', modelId: 'beta', managed: selected, sessionPreferences: f.options.sessionPreferences })));
            assert.deepEqual(data.modelMode, { kind: 'application', version: 1, baselineRevision: 1 }); assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM budgets WHERE reserved<>0").n, 0);
        } else { assert.equal(f.capacityCalls, 0); assert.deepEqual(snapshot(f.c), before); }
    } finally { release.resolve(); await f.c.close(); }
}
assert.equal(requests, 0); console.log(JSON.stringify({ outcome: 'passed', requests, roleDispatches: 0, reservedOverride: 'beta', publicationOverride: 'beta' }));

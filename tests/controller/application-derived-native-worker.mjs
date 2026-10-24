import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import { runtimeFixtureProfile, runtimeFixtureConfig } from '../runtime/profile.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { withValueCases } from './effect-fixture.mjs';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), source = path.join(root, 'source'), seed = path.join(root, 'seed'), receiver = path.join(root, 'receiver.git');
const git = '/opt/homebrew/bin/git', execute = promisify(execFile), provider = 'derived-native-fixture', key = 'DUMMY_DERIVED_ONLY';
const runtimeProfile = { ...runtimeFixtureProfile(), uid: process.getuid(), gid: process.getgid() };
assert.equal(process.env.DOCKER_CONFIG, runtimeFixtureConfig());
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('');
const initial = '// User local choice: 10\n' + Array.from({ length: 8 }, (_, i) => '// Context ' + i + '\n').join('') + 'module.exports=2;\n', dirty = initial.replace('choice: 10', 'choice: 11');
const checker = withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n");
const stages = ['planning', 'planning-challenge', 'planning-adjudication', 'implementation', 'implementation', 'fresh-review', 'review-adjudication', 'fresh-review', 'review-adjudication'];
let c, requests = 0, served = 0, sockets = 0, failure, deadlineClose, phase = 'setup', workId;
const traffic = [], receipts = [], recipes = new Map(), owners = new Map(); let unsubscribe;
const abort = new AbortController(), timer = setTimeout(() => { const error = Error('Owned derived-native deadline'); failure = error; abort.abort(error); deadlineClose = c?.close(); deadlineClose?.catch(() => {}); }, 40000);
const save = () => fs.writeFile(path.join(root, 'traffic.json'), JSON.stringify({ requests, served, sockets, traffic, receipts }, null, 2));
net.Socket.prototype.connect = function () { sockets++; throw Error('No Node socket in derived native fixture'); };
const gitEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.HOME, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' };
const gitRun = async args => (await execute(git, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', ...args], { env: gitEnv, signal: abort.signal, timeout: 10000, maxBuffer: 1024 * 1024 })).stdout;
const sources = prompt => [...prompt.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(m => ({ metadata: JSON.parse(m[1]), content: m[2] }));
globalThis.fetch = async (url, init) => {
    const ordinal = ++requests; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ordinal, phase, entered: true })); await save();
    const body = JSON.parse(init.body), record = { ordinal, phase, url: String(url), body }; traffic.push(record); await save();
    assert.ok(ordinal <= 10, 'Hard safety ceiling'); assert.ok(ordinal <= 9, 'Tenth safety position UNSERVED'); abort.signal.throwIfAborted();
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
    const prompt = text(body.messages.find(m => m.role === 'user' && text(m).startsWith('Perform the assigned '))), bundle = JSON.parse(prompt.split('\n')[1]);
    const role = prompt.match(/assigned (\w+) task/)[1], expected = role === 'reviewer' ? 'beta' : role === 'adjudicator' ? 'gamma' : 'alpha';
    assert.equal(body.model, expected); assert.equal(bundle.context.stage, stages[ordinal - 1]); assert.equal(phase, ordinal <= 7 ? 'initial' : 'derived');
    const runs = c.store.all("SELECT * FROM runs WHERE phase='RUNNING'"); assert.equal(runs.length, 1);
    const run = runs[0], data = JSON.parse(run.data), launch = c.store.one('SELECT * FROM role_launches WHERE run=?', run.id), owner = owners.get(run.id);
    assert.ok(launch && owner); assert.equal(run.work, workId); assert.equal(launch.role, role); assert.equal(owner.modelId, expected); assert.equal(owner.provider, provider); assert.equal(owner.thinkingLevel, 'off');
    assert.equal(data.modelIdentity, hash(modelConfigurationIdentity(recipes.get(role)))); assert.equal(JSON.parse(launch.data).modelIdentity, data.modelIdentity);
    assert.deepEqual(data.modelMode, { kind: 'application', version: 1, baselineRevision: 1 }); assert.ok(data.modelDispatchAttempted);
    const exposed = sources(prompt), consumer = exposed.find(s => s.metadata.side === 'candidate' && s.metadata.path === 'consumer.cjs') ?? exposed.find(s => s.metadata.path === 'consumer.cjs'); assert.ok(consumer);
    if (ordinal >= 6) { assert.equal(consumer.content, (ordinal <= 7 ? dirty : initial).replace('exports=2', 'exports=3')); assert.ok(bundle.context.checks.some(row => row.status === 'pass' && row.candidate === JSON.parse(launch.data).inputVersions.candidate)); }
    const result = { version: 1, summary: 'Inspect actual supplied consumer and current verification context', findings: [], assessedScope: bundle.requiredScope };
    let tool = false;
    if (role === 'planner') result.plan = { intent: 'Export3 while keeping the user local comment out of publication', requirements: [{ id: 'R1', text: 'Consumer exports3', source: bundle.context.ownerSource }], approach: 'Change only the existing exported constant', simplerAlternative: 'Reuse the current module', factualSources: ['base:consumer.cjs'], ambiguities: [], verification: { checks: [{ id: 'value', guaranteeIds: ['R1'], command: 'node check.cjs', assertions: ['three'], timeoutMs: 2000, fixturePaths: ['check.cjs', 'consumer.cjs'], expectationPaths: ['check.cjs'], cases: [
        { id: 'value-healthy', kind: 'healthy', guaranteeIds: ['R1'], derivation: 'Required numeric value claim matches the actual consumer', consumerPaths: ['consumer.cjs'], input: { literalUtf8: '3', fixturePaths: [] }, expected: { kind: 'return', value: '3' } },
        { id: 'value-adverse', kind: 'adverse', guaranteeIds: ['R1'], derivation: 'Contradictory numeric claim is rejected against the actual consumer value', consumerPaths: ['consumer.cjs'], input: { literalUtf8: '4', fixturePaths: [] }, expected: { kind: 'rejection', value: '3' } }
    ] }], requiredPaths: ['consumer.cjs', 'check.cjs'], reviewRoles: [{ key: 'general', kind: 'reviewer', purpose: 'Inspect current actual consumer and real case results', requiredPaths: ['consumer.cjs', 'check.cjs'] }] } };
    if (role === 'challenger') result.alternatives = ['Use the existing simple export; a new abstraction adds no value'];
    if (role === 'adjudicator') { result.decisions = []; result.inputDecisions = (bundle.context.sourceInputChain ?? []).filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'explanation', reason: 'Supplied owner requirement remains export3 with local comment excluded from publication', requirementIds: ['R1'] })); if (bundle.context.stage === 'planning-adjudication') { result.planAccepted = true; result.acceptedPlan = bundle.context.planProposal; } }
    if (role === 'implementer' && ordinal === 4) tool = { name: 'write', arguments: { path: 'consumer.cjs', content: consumer.content.replace('exports=2', 'exports=3') } };
    if (role === 'implementer' && ordinal === 5) assert.ok(body.messages.some(m => m.role === 'tool' && text(m).includes('consumer.cjs')));
    if (role === 'reviewer') result.outcome = 'clear';
    applyCurrentVerificationFixture(result, bundle.context);
    record.actual = { runId: run.id, launchId: launch.id, workId, role, owner, modelIdentity: data.modelIdentity, modelMode: data.modelMode, inputVersions: JSON.parse(launch.data).inputVersions };
    served++; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    return wireResponse('openai-completions', expected, { text: JSON.stringify(result), tool });
};
const ledger = () => Object.fromEntries(['works', 'runs', 'budgets', 'effect_operations', 'effect_delegations', 'capacity_leases'].map(t => [t, c.store.all('SELECT * FROM ' + t + ' ORDER BY rowid')]));
try {
    for (const folder of [source, seed]) await fs.mkdir(folder, { mode: 0o700 });
    for (const [folder, content] of [[source, dirty], [seed, initial]]) { await fs.writeFile(path.join(folder, 'consumer.cjs'), content); await fs.writeFile(path.join(folder, 'check.cjs'), checker); }
    await gitRun(['init', '--initial-branch=main', seed]); await gitRun(['-C', seed, 'add', 'consumer.cjs', 'check.cjs']);
    await gitRun(['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Owned initial K']);
    const K = (await gitRun(['-C', seed, 'rev-parse', 'HEAD'])).trim(); await gitRun(['init', '--bare', receiver]); await gitRun(['-C', seed, 'push', receiver, 'HEAD:refs/heads/main']);
    c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git } }); const models = new ApplicationModels(c);
    const resolve = models.resolveWorkRole.bind(models); models.resolveWorkRole = async request => { const model = await resolve(request); recipes.set(request.role, model); return model; }; models.install();
    unsubscribe = c.subscribeInteraction(event => { if (event.type !== 'native-ready') return; const handle = c.getNativeHandle(event.conversationId); assert.ok(handle); owners.set(handle.identity.runId, { identity: handle.identity, provider: handle.session.model.provider, modelId: handle.session.model.id, thinkingLevel: handle.session.thinkingLevel }); });
    await c.registerProject({ id: 'P', sourceRoot: source });
    await ApplicationAccounts.open(c).configure({ providers: { [provider]: { api: 'openai-completions', apiKey: key, baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta', 'gamma'].map(id => ({ id, contextWindow: 100000, maxTokens: 16000 })) } } });
    await ApplicationAccounts.open(c).setDefault(provider, 'alpha'); for (const [role, model] of [['reviewer', 'beta'], ['adjudicator', 'gamma']]) await models.setRole(role, await models.choice(provider, model));
    const target = await c.registerLocalTarget({ projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: K, publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs'] });
    const baseline = await models.baseline('P'), begun = await c.beginChange({ projectId: 'P', request: 'Consumer exports3. Preserve the user local comment11 in local source; publish only the agent export delta onto initial K comment10.', applicationModelBaseline: baseline, executionLimit: 16, resolutionLimit: 8, signal: abort.signal }); workId = begun.workId;
    phase = 'initial'; const ready = await c.driveChange({ ...models.workOperation(workId), signal: abort.signal }); assert.equal(ready.reviewReady, true, JSON.stringify(ready.blocked)); assert.equal(requests, 7);
    const oldEvidence = await c.changes.currentEvidence(workId), oldLaunches = c.store.all('SELECT * FROM role_launches ORDER BY rowid'), oldChecks = c.store.all('SELECT * FROM check_runs ORDER BY rowid'), oldRuns = c.store.all('SELECT * FROM runs ORDER BY rowid');
    const initialCandidate = ready.versions.find(v => v.id === ready.candidateVersion); assert.equal(await fs.readFile(path.join(initialCandidate.artifact, 'consumer.cjs'), 'utf8'), dirty.replace('exports=2', 'exports=3'));
    const before = ledger(); await assert.rejects(c.prepareIntegration({ ...models.workOperation(workId), targetId: target.targetId, signal: abort.signal }), /No actual current owner grant/); assert.deepEqual(ledger(), before);
    const grant = c.delegateIntegration({ workId, targetId: target.targetId, mode: 'ordinary', operationLimit: 1 }), grantRow = c.store.one('SELECT * FROM effect_delegations');
    phase = 'derived'; const prepared = await c.prepareIntegration({ ...models.workOperation(workId), targetId: target.targetId, signal: abort.signal }); assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared)); assert.equal(requests, 9);
    const derived = c.inspectChange(workId), evidence = await c.changes.currentEvidence(workId); assert.equal(derived.reviewReady, true); assert.notEqual(derived.candidateVersion, ready.candidateVersion);
    assert.equal(derived.baseVersion, ready.baseVersion); assert.equal(derived.planVersion, ready.planVersion); assert.equal(derived.verificationVersion, ready.verificationVersion);
    assert.throws(() => c.changes.assertCurrentEvidence(oldEvidence), /changed|stale|candidate|evidence/i);
    const candidate = derived.versions.find(v => v.id === derived.candidateVersion);
    const candidateData = JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=? AND work=?', candidate.id, workId).data);
    assert.equal(candidateData.derived, 'publication-projection'); assert.equal(candidate.predecessor, ready.candidateVersion);
    assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), initial.replace('exports=2', 'exports=3')); assert.equal(await fs.readFile(path.join(candidate.artifact, 'check.cjs'), 'utf8'), checker);
    assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), dirty); assert.equal(await fs.readFile(path.join(source, 'check.cjs'), 'utf8'), checker); assert.equal((await gitRun(['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'])).trim(), K);
    for (const row of oldLaunches) assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?', row.id), row);
    for (const row of oldChecks) assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?', row.id), row);
    for (const row of oldRuns) assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', row.id), row);
    const checks = c.store.all('SELECT * FROM check_runs ORDER BY rowid'); assert.equal(checks.length, 2);
    for (const row of checks) { const data = JSON.parse(row.data); assert.equal(row.status, 'pass'); assert.equal(data.cleanup, 'removed'); assert.equal(data.caseResults.complete, true); assert.deepEqual(data.parsed.value.cases.map(x => x.observed), [{ kind: 'return', value: '3' }, { kind: 'rejection', value: '3' }]); }
    const oldDescriptor = JSON.parse(checks[0].data).caseDescriptor, newDescriptor = JSON.parse(checks[1].data).caseDescriptor;
    assert.equal(oldDescriptor.candidateDigest, oldEvidence.candidateDigest); assert.equal(newDescriptor.candidateDigest, evidence.candidateDigest);
    assert.notEqual(oldDescriptor.candidateDigest, newDescriptor.candidateDigest);
    for (const [descriptor, content] of [[oldDescriptor, dirty.replace('exports=2', 'exports=3')], [newDescriptor, initial.replace('exports=2', 'exports=3')]]) {
        const expectedSha = createHash('sha256').update(content).digest('hex');
        for (const item of descriptor.cases) assert.equal(item.consumerFiles.find(file => file.path === 'consumer.cjs').sha256, expectedSha);
    }
    assert.notEqual(oldDescriptor.cases[0].inputDigest, newDescriptor.cases[0].inputDigest); assert.equal(checks[1].candidate, derived.candidateVersion);
    const launches = c.store.all('SELECT * FROM role_launches ORDER BY rowid'); assert.equal(launches.length, 8);
    for (const row of launches.slice(-2)) { assert.equal(JSON.parse(row.data).inputVersions.candidate, derived.candidateVersion); assert.equal(row.status, 'COMPLETE'); }
    assert.deepEqual(c.getWorkApplicationModelBaseline(workId), baseline); assert.deepEqual(c.store.one('SELECT * FROM effect_delegations'), grantRow);
    const op = c.store.one('SELECT * FROM effect_operations'); assert.equal(op.work, workId); assert.equal(op.phase, 'RESERVED'); assert.equal(JSON.parse(op.data).evidence.versions.candidate, derived.candidateVersion);
    assert.equal(c.store.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='send'").n, 0);
    const runs = c.store.all('SELECT * FROM runs'); assert.equal(runs.length, 12); assert.ok(runs.every(r => r.phase === 'SETTLED'));
    const scoped = runs.filter(r => JSON.parse(r.data).containerId); assert.equal(scoped.length, 10); assert.ok(scoped.every(r => JSON.parse(r.data).cleanup === 'removed'));
    for (const row of launches) { const data = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', row.run).data); await nativeCheckpoint(data.historyRef, data.nativeCheckpoint); }
    const leases = c.store.all('SELECT * FROM capacity_leases'); assert.equal(leases.length, 11); assert.ok(leases.every(r => r.state === 'RELEASED'));
    assert.equal(derived.execution.consumed, 12); assert.equal(derived.execution.reserved, 0); assert.equal(derived.resolution.consumed, 6); assert.equal(derived.resolution.reserved, 0);
    const native = runs.find(r => JSON.parse(r.data).kind === 'native-effect'); assert.ok(native); assert.equal(JSON.parse(native.data).cleanup, 'removed');
    const commandResults = [];
    async function walk(folder) { for (const item of await fs.readdir(folder, { withFileTypes: true })) { const file = path.join(folder, item.name); if (item.isDirectory()) await walk(file); else if (item.name === 'result.json') { const data = JSON.parse(await fs.readFile(file, 'utf8')); if (Object.hasOwn(data, 'cleanup') && Object.hasOwn(data, 'gitStarted')) commandResults.push({ file, data }); } } }
    await walk(JSON.parse(native.data).clientRoot); assert.ok(commandResults.length > 0); assert.ok(commandResults.every(r => r.data.cleanup === 'confirmed' && r.data.settled === true));
    assert.equal(requests, 9); assert.equal(served, 9); assert.equal(sockets, 0);
    receipts.push({ kind: 'genuine-derived', K, baseline, grant, ready, oldEvidence, prepared, derived, evidence }); await save();
    await fs.writeFile(path.join(root, 'produced-scopes.json'), JSON.stringify(scoped.map(r => ({ runId: r.id, workId: r.work, containerId: JSON.parse(r.data).containerId, cleanup: JSON.parse(r.data).cleanup }))));
    await fs.writeFile(path.join(root, 'final-ledger.json'), JSON.stringify({ runs, launches, checks, leases, op, grantRow, commandResults, budgets: c.store.all('SELECT * FROM budgets'), works: c.store.all('SELECT * FROM works') }, null, 2));
} catch (error) { failure = failure ? new AggregateError([failure, error], 'Deadline and derived work failed') : error; await fs.writeFile(path.join(root, 'primary-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); }
finally { clearTimeout(timer); abort.abort(); try { await (deadlineClose ?? c?.close()); } catch (error) { await fs.writeFile(path.join(root, 'cleanup-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); failure = failure ? new AggregateError([failure, error]) : error; } unsubscribe?.(); await save(); }
if (failure) { await fs.writeFile(path.join(root, 'terminal-failure.json'), JSON.stringify({ message: failure.message, stack: failure.stack })); throw failure; }
console.log(JSON.stringify({ outcome: 'passed', requests, served, sockets, scopes: 10, runs: 12, leases: 11 }));

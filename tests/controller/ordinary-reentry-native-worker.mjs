import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { subjectRoleModel, assertOrdinaryEffectSource } from '../../dist/controller/application-model.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), provider = 'ordinary-reentry-native', key = 'DUMMY_REENTRY_ONLY';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('');
let c, models, stage = 'setup', requests = 0, served = 0, sockets = 0, failure, deadlineClose;
const traffic = [], receipts = [], owners = new Map(), recipes = new Map(), unsubscribers = [];
const abort = new AbortController(), timer = setTimeout(() => {
    const error = Error('Owned ordinary effect native deadline'); failure = error; abort.abort(error);
    // Background judgment is controller-owned, not a child of the parent's signal.
    deadlineClose = c?.close(); deadlineClose?.catch(() => {});
}, 35000);
const save = () => fs.writeFile(path.join(root, 'traffic.json'), JSON.stringify({ requests, served, sockets, traffic, receipts }, null, 2));
net.Socket.prototype.connect = function () { sockets++; throw Error('No socket in original-codec fixture'); };
let targetId, originalPublication;
const tables = ['sources', 'works', 'runs', 'budgets', 'conversation_assignments', 'effect_operations', 'effect_delegations', 'effect_receipts', 'role_launches', 'role_outputs', 'finding_occurrences', 'finding_dispositions', 'obligations', 'conversation_inputs'];
const ledger = () => Object.fromEntries(tables.map(t => [t, c.store.all('SELECT * FROM ' + t + ' ORDER BY rowid')]));
globalThis.fetch = async (url, init) => {
    const ordinal = ++requests;
    await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ordinal, stage, entered: true })); await save();
    const body = JSON.parse(init.body), record = { ordinal, stage, url: String(url), body }; traffic.push(record); await save();
    assert.ok(ordinal <= 7, 'Hard safety ceiling'); assert.ok(ordinal <= 6, 'Seventh position UNSERVED, not a retry'); abort.signal.throwIfAborted();
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
    const expected = ordinal % 3 === 0 ? 'beta' : 'alpha'; assert.equal(body.model, expected);
    assert.equal(stage, ordinal <= 3 ? 'publication-1' : 'publication-2');
    const runs = c.store.all("SELECT * FROM runs WHERE phase='RUNNING'"); assert.equal(runs.length, 1);
    const run = runs[0], data = JSON.parse(run.data), owner = owners.get(run.id); assert.ok(owner);
    assert.equal(owner.modelId, expected); assert.equal(owner.provider, provider);
    assert.equal(data.modelIdentity, hash(recipes.get(expected))); assert.ok(data.modelDispatchAttempted);
    const observations = c.store.all('SELECT data FROM observations WHERE run=?', run.id).map(r => JSON.parse(r.data));
    assert.ok(observations.some(o => o.type === 'resolved-model' && o.model.modelId === expected));
    let answer = 'OE_NATIVE_' + ordinal, tool = false;
    if (ordinal === 1 || ordinal === 4) {
        if (ordinal === 4) {
            const before = ledger();
            assert.throws(() => c.publicationEngine.operationWork(originalPublication.alias.id), /queued ordinary role source changed/);
            assert.deepEqual(ledger(), before);
            receipts.push({ kind: 'obsolete-origin-refused', sourceRunId: run.id, binding: data.ordinaryRoleBinding, snapshot: before });
        }
        assert.ok(body.tools.some(t => t.function.name === 'conversation_publish'));
        tool = { name: 'conversation_publish', arguments: { targetId, action: { kind: 'create-issue', title: 'Unreviewed bootstrap scope question ' + (ordinal === 1 ? 'initial' : 'reentry'), body: 'Unreviewed proposal version ' + (ordinal === 1 ? 'one' : 'two') + '; requires deciding whether broad publication is intended.' } } };
    }
    if (ordinal === 2 || ordinal === 5) {
        const result = body.messages.filter(m => m.role === 'tool').at(-1); assert.ok(result);
        const receipt = JSON.parse(text(result)); assert.equal(receipt.state, 'QUEUED'); if (ordinal === 5) { assert.equal(receipt.operationId, originalPublication.op.id); assert.equal(receipt.assignmentId, originalPublication.alias.id); assert.equal(receipt.conversationId, originalPublication.alias.target); }
        receipts.push({ kind: 'actual-publication-tool', receipt });
        answer = 'Queued the explicitly unreviewed proposal for independent scope review. No publication completion claimed.';
    }
    if (ordinal === 3 || ordinal === 6) {
        assert.equal(data.kind, 'publication-judgment'); assert.equal(data.modelMode.kind, 'application');
        const user = body.messages.find(m => m.role === 'user' && text(m).includes('assigned adjudicator task')); assert.ok(user);
        const bundle = JSON.parse(text(user).split('\n')[1]); assert.equal(bundle.context.stage, 'publication-payload-fit');
        assert.ok(bundle.context.originalSourceChain.some(s => s.raw.includes('OE_OWNER_AMBIGUOUS')));
        const op = c.store.one('SELECT * FROM effect_operations WHERE id=?', bundle.context.operationId); assert.equal(op.work, run.work);
        const od = JSON.parse(op.data), source = c.store.one('SELECT data FROM runs WHERE id=?', od.origin.identity.runId);
        assert.equal(JSON.parse(source.data).ordinaryRoleBinding.mode.baseline.choice.modelId, 'alpha');
        answer = JSON.stringify({ version: 1, summary: 'Unresolved owner scope prevents publication of the proposed bootstrap issue', findings: [{ requirementId: 'publication-intent', severity: 'blocking', repair: 'unknown', description: 'Owner has not decided whether this bootstrap proposal should be published broadly', evidence: ['OE_OWNER_AMBIGUOUS raw owner source and exact proposed action bytes'] }], assessedScope: bundle.requiredScope, decisions: bundle.context.occurrences.map(o => ({ occurrenceId: o.id, disposition: 'unresolved', reason: 'The revised proposal still lacks explicit owner publication scope', witnesses: [bundle.sources[0].id] })), inputDecisions: bundle.context.sourceInputChain.filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'explanation', reason: 'Preserve supplied unreviewed proposal intent while explicit scope remains unresolved', requirementIds: ['publication-intent'] })), payloadDecision: { payloadHash: bundle.context.payloadHash, sourceFingerprint: bundle.context.sourceFingerprint, verdict: 'needs-owner-scope', reason: 'Actual raw owner input explicitly leaves publication scope unresolved' } });
    } else {
        assert.equal(data.kind, 'ordinary-conversation');
        const binding = data.ordinaryRoleBinding;
        assert.equal(binding.sourceRunId, run.id); assert.equal(binding.conversationId, owner.identity.conversationId);
        assert.equal(binding.mode.kind, 'application'); assert.equal(binding.revision, ordinal <= 3 ? 1 : 2);
    }
    record.actual = { runId: run.id, workId: run.work, owner, modelIdentity: data.modelIdentity, modelMode: data.modelMode ?? data.conversationModelMode };
    served++; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    return wireResponse('openai-completions', expected, { text: answer, tool });
};
async function open() {
    c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) } }); models = new ApplicationModels(c);
    for (const method of ['resolve', 'resolveWorkRole']) {
        const original = models[method].bind(models);
        models[method] = async (...args) => { const model = await original(...args); recipes.set(model.modelId, modelConfigurationIdentity(model)); return model; };
    }
    models.install();
    unsubscribers.push(c.subscribeInteraction(event => {
        if (event.type !== 'native-ready') return;
        const handle = c.getNativeHandle(event.conversationId); assert.ok(handle);
        owners.set(handle.identity.runId, { identity: handle.identity, modelId: handle.session.model.id, provider: handle.session.model.provider });
    }));
}
const delivered = result => { assert.equal(result.status, 'delivered', JSON.stringify(result)); assert.equal(result.cleanup, 'unbound'); };
const runRow = id => c.store.one('SELECT * FROM runs WHERE id=?', id);
try {
    await open();
    await ApplicationAccounts.open(c).configure({ providers: { [provider]: { api: 'openai-completions', apiKey: key, baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta'].map(id => ({ id, contextWindow: 100000, maxTokens: 12000 })) } } });
    await ApplicationAccounts.open(c).setDefault(provider, 'alpha'); await models.setRole('adjudicator', await models.choice(provider, 'beta'));
    targetId = c.registerPublicationTarget({ target: { host: 'github.com', repositoryId: 9, repositoryNodeId: 'R9', owner: 'owner', repository: 'repo', actorUserId: 7 }, visibility: 'public' }).targetId;
    c.configurePublicationDelegations([{ targetId, actions: ['create-issue'], operationLimit: 1, projectIds: [null] }]);
    const pub = (await models.newConversation()).conversationId;
    const oldRuns = [], prefixes = [];
    let pubWork;
    for (let round = 1; round <= 2; round++) {
        stage = 'publication-' + round;
        await c.queueConversationInput({ conversationId: pub, expectedGeneration: c.inspectConversation(pub).generation, mode: 'idle', text: round === 1 ? 'OE_OWNER_AMBIGUOUS: prepare an explicitly unreviewed bootstrap issue, but whether it should be published broadly is undecided.' : 'OE_OWNER_REENTRY: revise the same unreviewed bootstrap proposal, retaining the original publication scope uncertainty; do not claim it resolved.' });
        const parent = await c.runConversation({ conversationId: pub, ...models.conversationOperation(pub), signal: abort.signal }); delivered(parent);
        await c.ordinaryCore.drain(); assert.equal(requests, round * 3);
        if (!pubWork) pubWork = parent.workId;
        assert.equal(parent.workId, pubWork);
        const op = c.store.one('SELECT * FROM effect_operations'); assert.equal(op.work, pubWork); assert.equal(op.phase, 'REFUSED');
        const od = JSON.parse(op.data), alias = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', od.assignmentId);
        assert.equal(alias.state, 'UNAVAILABLE'); assert.deepEqual(JSON.parse(alias.data).source, od.origin.identity);
        assert.equal(od.origin.identity.runId, parent.runId); assert.equal(c.publicationEngine.operationWork(alias.id), pubWork);
        assert.ok(!od.dispatchIntent); assert.ok(!od.judgedAuthorization);
        const launch = c.store.one('SELECT * FROM role_launches ORDER BY rowid DESC LIMIT 1'); assert.equal(launch.role, 'adjudicator'); assert.equal(launch.status, 'COMPLETE');
        assert.equal(JSON.parse(launch.data).operationId, op.id); assert.equal(JSON.parse(launch.data).modelMode.baselineRevision, round);
        const output = c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", launch.id); assert.ok(output);
        const protocol = JSON.parse(output.data).protocol; assert.equal(protocol.payloadDecision.verdict, 'needs-owner-scope');
        const view = c.inspectPublication(op.id); assert.equal(view.findingProjection.complete, true);
        assert.ok(view.findingProjection.rows.some(row => row.launchId === launch.id && row.nativeEntryId === JSON.parse(output.data).nativeEntryId && row.severity === 'blocking' && row.description.includes('Owner has not decided')));
        assert.ok(view.blocked.some(reason => reason.includes('Actual independent payload/source judgment incomplete or needs owner scope')));
        assert.ok(!JSON.stringify(view.blocked).includes('HOSTED_PUBLICATION_DISABLED'));
        if (round === 1) originalPublication = { op, alias, launch, output, view, grant: c.store.one('SELECT * FROM effect_delegations'), findings: c.store.all('SELECT * FROM finding_occurrences'), dispositions: c.store.all('SELECT * FROM finding_dispositions'), obligations: c.store.all('SELECT * FROM obligations') };
        else {
            assert.equal(op.id, originalPublication.op.id); assert.equal(op.grant_id, originalPublication.op.grant_id); assert.equal(alias.id, originalPublication.alias.id);
            assert.deepEqual(c.store.one('SELECT * FROM effect_delegations'), originalPublication.grant);
            assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?', originalPublication.launch.id), originalPublication.launch);
            assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?', originalPublication.output.id), originalPublication.output);
            for (const old of originalPublication.findings) {
                assert.deepEqual(c.store.one('SELECT * FROM finding_occurrences WHERE id=?', old.id), old);
                assert.ok(protocol.decisions.some(d => d.occurrenceId === old.id && d.disposition === 'unresolved'));
            }
            for (const old of originalPublication.obligations) assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?', old.id), old);
            assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions'), originalPublication.dispositions);
            assert.ok(view.findingProjection.rows.length > originalPublication.view.findingProjection.rows.length);
            assert.equal(c.store.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='explicit-agent-reentry'", op.id).n, 1);
        }
        for (const old of oldRuns) assert.deepEqual(runRow(old.id), old);
        for (const prefix of prefixes) await nativeCheckpoint(prefix.file, prefix.checkpoint);
        const nativeRuns = c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', pubWork);
        for (const row of nativeRuns) if (!oldRuns.some(old => old.id === row.id)) { oldRuns.push(row); const d = JSON.parse(row.data); prefixes.push({ file: d.historyRef, checkpoint: d.nativeCheckpoint }); }
        assert.equal(c.inspectWork(pubWork).allowance.consumed, round * 2);
        assert.equal(c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='resolution'", pubWork).consumed, round);
        receipts.push({ kind: 'actual-reentry-round', round, parent, op, alias, launch, output, view }); await save();
    }
    const sourceRoot = path.join(root, 'source'); await fs.mkdir(sourceRoot); await fs.writeFile(path.join(sourceRoot, 'source.txt'), 'NON_AUTHORITY capacity-refused project admission');
    await c.registerProject({ id: 'P', sourceRoot });
    const cid = (await models.newConversation()).conversationId;
    c.setConversationProject({ conversationId: cid, projectId: 'P', expectedGeneration: 0 }); assert.equal(c.inspectConversation(cid).generation, 1);
    await c.queueConversationInput({ conversationId: cid, expectedGeneration: 1, mode: 'idle', text: 'Actual scope transition before first work; no engine allocation requested by this controlled refusal.' });
    const originalAcquire = c.capacity.acquire.bind(c.capacity); let capacityCalls = 0, failed;
    c.capacity.acquire = async request => { capacityCalls++; const run = runRow(request.runId), work = c.store.one('SELECT * FROM works WHERE id=?', request.workId); assert.equal(work.project, 'P'); assert.equal(run.generation, 1); throw Error('CONTROLLED_REENTRY_FINAL_CAPACITY_REFUSAL'); };
    try { failed = await c.runConversation({ conversationId: cid, ...models.conversationOperation(cid), signal: abort.signal }); } finally { c.capacity.acquire = originalAcquire; }
    assert.equal(capacityCalls, 1); assert.equal(failed.status, 'unavailable');
    const run = runRow(failed.runId), data = JSON.parse(run.data), input = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', data.initialInputId);
    assert.equal(run.generation, 1); assert.equal(input.generation, 2); assert.equal(c.inspectConversation(cid).generation, 2);
    assert.equal(data.cleanup, 'not-allocated'); assert.equal(run.reservation, 'consumed');
    for (const key of ['containerId', 'historyRef', 'nativeSessionId', 'nativeCheckpoint', 'modelDispatchAttempted']) assert.equal(Object.hasOwn(data, key), false);
    const identity = { workId: run.work, runId: run.id, conversationId: cid, generation: 2, initialInputId: input.id };
    const before = ledger(), selected = subjectRoleModel(c.store, run.work);
    assertOrdinaryEffectSource(c.store, run.work, identity); assert.throws(() => assertOrdinaryEffectSource(c.store, run.work, { ...identity, generation: 1 }), /queued ordinary role source changed/); assert.deepEqual(ledger(), before);
    await c.close(); await open(); assert.deepEqual(ledger(), before); assert.deepEqual(subjectRoleModel(c.store, run.work), selected); assertOrdinaryEffectSource(c.store, run.work, identity); assert.deepEqual(ledger(), before);
    for (const old of oldRuns) assert.deepEqual(runRow(old.id), old);
    for (const prefix of prefixes) await nativeCheckpoint(prefix.file, prefix.checkpoint);
    receipts.push({ kind: 'actual-divergent-generation', failed, run, input, identity, selected });
    assert.equal(requests, 6); assert.equal(served, 6); assert.equal(sockets, 0);
    const budgets = c.store.all('SELECT * FROM budgets'); assert.equal(budgets.length, 4);
    for (const b of budgets) { assert.equal(b.reserved, 0); assert.equal(b.consumed, b.lineage === pubWork ? (b.kind === 'execution' ? 4 : 2) : (b.kind === 'execution' ? 1 : 0)); }
    const grants=c.store.all('SELECT * FROM effect_delegations');assert.equal(grants.length,2);assert.deepEqual(new Set(grants.map(grant=>grant.root)),new Set([pubWork,failed.workId]),'Each independent owner root captures its configured startup authority before run allocation');for(const grant of grants){assert.equal(JSON.parse(grant.data).operationLimit,1);assert.equal(JSON.parse(c.store.one('SELECT data FROM works WHERE id=?',grant.root).data).ownerRootActivation.state,'COMPLETE');}assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n, 1);
    const allRuns = c.store.all('SELECT * FROM runs'); assert.equal(allRuns.length, 5);
    for (const row of allRuns) { const d = JSON.parse(row.data); assert.equal(row.phase, 'SETTLED'); if (row.id !== failed.runId) { assert.equal(d.cleanup, 'unbound'); await nativeCheckpoint(d.historyRef, d.nativeCheckpoint); } }
    const leases = c.store.all('SELECT * FROM capacity_leases'); assert.equal(leases.length, 4); assert.ok(leases.every(l => l.state === 'RELEASED'));
    await fs.writeFile(path.join(root, 'final-ledger.json'), JSON.stringify({ runs: allRuns, works: c.store.all('SELECT * FROM works'), budgets, grants: c.store.all('SELECT * FROM effect_delegations'), operations: c.store.all('SELECT * FROM effect_operations'), assignments: c.store.all('SELECT * FROM conversation_assignments'), launches: c.store.all('SELECT * FROM role_launches'), outputs: c.store.all('SELECT * FROM role_outputs'), findings: c.store.all('SELECT * FROM finding_occurrences'), dispositions: c.store.all('SELECT * FROM finding_dispositions'), obligations: c.store.all('SELECT * FROM obligations'), leases }, null, 2));
} catch (error) { failure = failure ? new AggregateError([failure, error], 'Owned deadline and original work failed') : error; await fs.writeFile(path.join(root, 'primary-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); }
finally {
    clearTimeout(timer); abort.abort();
    try { await (deadlineClose ?? c?.close()); } catch (error) { await fs.writeFile(path.join(root, 'cleanup-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); failure = failure ? new AggregateError([failure, error]) : error; }
    for (const unsubscribe of unsubscribers) unsubscribe(); await save();
}
if (failure) { await fs.writeFile(path.join(root, 'terminal-failure.json'), JSON.stringify({ message: failure.message, stack: failure.stack })); throw failure; }
console.log(JSON.stringify({ outcome: 'passed', requests, served, sockets, runs: 5, leases: 4 }));

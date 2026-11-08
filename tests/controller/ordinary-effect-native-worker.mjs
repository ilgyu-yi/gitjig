import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { resolveManagedModel } from '../../dist/pi/managed-provider.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), provider = 'ordinary-effect-native', key = 'DUMMY_OE_ONLY';
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
let targetId;
globalThis.fetch = async (url, init) => {
    const ordinal = ++requests;
    await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ordinal, stage, entered: true })); await save();
    const body = JSON.parse(init.body), record = { ordinal, stage, url: String(url), body }; traffic.push(record); await save();
    assert.ok(ordinal <= 8, 'Hard safety ceiling'); assert.ok(ordinal <= 7, 'Eighth position UNSERVED, not a retry'); abort.signal.throwIfAborted();
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
    const expected = ordinal === 3 || ordinal === 5 || ordinal === 7 ? 'beta' : 'alpha'; assert.equal(body.model, expected);
    assert.equal(stage, ordinal <= 3 ? 'publication' : 'transition-' + (ordinal - 3));
    const runs = c.store.all("SELECT * FROM runs WHERE phase='RUNNING'"); assert.equal(runs.length, 1);
    const run = runs[0], data = JSON.parse(run.data), owner = owners.get(run.id); assert.ok(owner);
    assert.equal(owner.modelId, expected); assert.equal(owner.provider, provider);
    assert.equal(data.modelIdentity, hash(recipes.get(expected))); assert.ok(data.modelDispatchAttempted);
    const observations = c.store.all('SELECT data FROM observations WHERE run=?', run.id).map(r => JSON.parse(r.data));
    assert.ok(observations.some(o => o.type === 'resolved-model' && o.model.modelId === expected));
    let answer = 'OE_NATIVE_' + ordinal, tool = false;
    if (ordinal === 1) {
        assert.ok(body.tools.some(t => t.function.name === 'conversation_publish'));
        tool = { name: 'conversation_publish', arguments: { targetId, action: { kind: 'create-issue', title: 'Unreviewed bootstrap scope question', body: 'Unreviewed proposal only; requires deciding whether broad publication is intended.' } } };
    }
    if (ordinal === 2) {
        const result = body.messages.find(m => m.role === 'tool'); assert.ok(result);
        const receipt = JSON.parse(text(result)); assert.equal(receipt.state, 'QUEUED'); receipts.push({ kind: 'actual-publication-tool', receipt });
        answer = 'Queued the explicitly unreviewed proposal for independent scope review. No publication completion claimed.';
    }
    if (ordinal === 3) {
        assert.equal(data.kind, 'publication-judgment'); assert.equal(data.modelMode.kind, 'application');
        const user = body.messages.find(m => m.role === 'user' && text(m).includes('assigned adjudicator task')); assert.ok(user);
        const bundle = JSON.parse(text(user).split('\n')[1]); assert.equal(bundle.context.stage, 'publication-payload-fit');
        assert.ok(bundle.context.originalSourceChain.some(s => s.raw.includes('OE_OWNER_AMBIGUOUS')));
        const op = c.store.one('SELECT * FROM effect_operations WHERE id=?', bundle.context.operationId); assert.equal(op.work, run.work);
        const od = JSON.parse(op.data), source = c.store.one('SELECT data FROM runs WHERE id=?', od.origin.identity.runId);
        assert.equal(JSON.parse(source.data).ordinaryRoleBinding.mode.baseline.choice.modelId, 'alpha');
        answer = JSON.stringify({ version: 1, summary: 'Unresolved owner scope prevents publication of the proposed bootstrap issue', findings: [{ requirementId: 'publication-intent', severity: 'blocking', repair: 'unknown', description: 'Owner has not decided whether this bootstrap proposal should be published broadly', evidence: ['OE_OWNER_AMBIGUOUS raw owner source and exact proposed action bytes'] }], assessedScope: bundle.requiredScope, decisions: [], inputDecisions: bundle.context.sourceInputChain.filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'explanation', reason: 'Preserve supplied unreviewed proposal intent while explicit scope remains unresolved', requirementIds: ['publication-intent'] })), payloadDecision: { payloadHash: bundle.context.payloadHash, sourceFingerprint: bundle.context.sourceFingerprint, verdict: 'needs-owner-scope', reason: 'Actual raw owner input explicitly leaves publication scope unresolved' } });
    } else {
        assert.equal(data.kind, 'ordinary-conversation');
        const binding = data.ordinaryRoleBinding;
        assert.equal(binding.sourceRunId, run.id); assert.equal(binding.conversationId, owner.identity.conversationId);
        assert.equal(binding.mode.kind, ordinal === 6 ? 'explicit' : 'application');
    }
    record.actual = { runId: run.id, workId: run.work, owner, modelIdentity: data.modelIdentity, modelMode: data.modelMode ?? data.conversationModelMode };
    served++; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    return wireResponse('openai-completions', expected, { text: answer, tool });
};
async function open() {
    c = await openController({ installationHome: home }); models = new ApplicationModels(c);
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
const choose = async (cid, modelId) => models.select({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedRevision: c.getConversationModelChoice(cid).revision, provider, modelId, thinkingLevel: 'off' });
try {
    await open();
    await ApplicationAccounts.open(c).configure({ providers: { [provider]: { api: 'openai-completions', apiKey: key, baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta'].map(id => ({ id, contextWindow: 100000, maxTokens: 12000 })) } } });
    await ApplicationAccounts.open(c).setDefault(provider, 'alpha'); await models.setRole('adjudicator', await models.choice(provider, 'beta'));
    targetId = c.registerPublicationTarget({ target: { host: 'github.com', repositoryId: 9, repositoryNodeId: 'R9', owner: 'owner', repository: 'repo', actorUserId: 7 }, visibility: 'public' }).targetId;
    c.configurePublicationDelegations([{ targetId, actions: ['create-issue'], operationLimit: 1, projectIds: [null] }]);
    const pub = (await models.newConversation()).conversationId; stage = 'publication';
    await c.queueConversationInput({ conversationId: pub, expectedGeneration: 0, mode: 'idle', text: 'OE_OWNER_AMBIGUOUS: prepare this explicitly unreviewed bootstrap issue, but I have not decided whether it should be published broadly; independent review must resolve that scope first.' });
    const parent = await c.runConversation({ conversationId: pub, ...models.conversationOperation(pub), signal: abort.signal }); delivered(parent);
    await c.ordinaryCore.drain(); assert.equal(requests, 3);
    const op = c.store.one('SELECT * FROM effect_operations'); assert.equal(op.work, parent.workId); assert.equal(op.phase, 'REFUSED');
    assert.ok(!JSON.parse(op.data).dispatchIntent); assert.ok(!JSON.parse(op.data).judgedAuthorization);
    const launch = c.store.one('SELECT * FROM role_launches'); assert.equal(launch.role, 'adjudicator'); assert.equal(launch.status, 'COMPLETE');
    assert.equal(JSON.parse(launch.data).operationId, op.id);
    const output = c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", launch.id); assert.ok(output);
    assert.equal(JSON.parse(output.data).protocol.payloadDecision.verdict, 'needs-owner-scope');
    assert.ok(JSON.parse(output.data).nativeEntryId);
    const alias = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', JSON.parse(op.data).assignmentId); assert.equal(alias.state, 'UNAVAILABLE');
    const findings = c.store.all('SELECT * FROM finding_occurrences WHERE work=?', parent.workId); assert.ok(findings.some(f => JSON.parse(f.data).finding.description?.includes('Owner has not decided')));
    assert.equal(c.inspectWork(parent.workId).allowance.consumed, 2);
    assert.equal(c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='resolution'", parent.workId).consumed, 1);
    const view = c.inspectPublication(op.id); assert.equal(view.findingProjection.complete, true);
    assert.ok(view.findingProjection.rows.some(row => row.launchId === launch.id && row.nativeEntryId === JSON.parse(output.data).nativeEntryId && row.severity === 'blocking' && row.description.includes('Owner has not decided')));
    assert.ok(view.blocked.some(reason => reason.includes('Actual independent payload/source judgment incomplete or needs owner scope')));
    assert.ok(!JSON.stringify(view.blocked).includes('HOSTED_PUBLICATION_DISABLED'));
    receipts.push({ kind: 'actual-publication-inspection', view });
    receipts.push({ kind: 'actual-blocked-publication', parent, operation: op, launch, findings });
    const cid = (await models.newConversation()).conversationId, oldRuns = [], oldPrefixes = [];
    let workId, sessionId, stableGrants;
    for (let turn = 1; turn <= 4; turn++) {
        stage = 'transition-' + turn;
        if (turn === 2 || turn === 4) await choose(cid, 'beta');
        let operation;
        if (turn === 3) {
            const choice = c.getConversationModelChoice(cid);
            await c.setConversationModelChoice({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedRevision: choice.revision, choice: { kind: 'legacy-external', provider, modelId: 'alpha' } });
            const model = { provider, modelId: 'alpha', managed: await resolveManagedModel(home, provider, 'alpha', 'off') }; recipes.set('alpha', modelConfigurationIdentity(model)); operation = { model };
        } else operation = models.conversationOperation(cid);
        await c.queueConversationInput({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, mode: 'idle', text: 'OE_TRANSITION_' + turn + ': retain the same conversation and work obligations.' });
        const result = await c.runConversation({ conversationId: cid, ...operation, signal: abort.signal }); delivered(result);
        const run = runRow(result.runId), data = JSON.parse(run.data), work = c.store.one('SELECT * FROM works WHERE id=?', result.workId);
        if (!workId) { workId = work.id; sessionId = data.nativeSessionId; }
        assert.equal(work.id, workId); assert.equal(data.nativeSessionId, sessionId); assert.equal(data.ordinaryRoleBinding.revision, turn);
        assert.deepEqual(JSON.parse(work.data).ordinaryRoleBinding, data.ordinaryRoleBinding);
        for (const prior of oldRuns) assert.deepEqual(runRow(prior.id), prior);
        for (const prefix of oldPrefixes) await nativeCheckpoint(prefix.file, prefix.checkpoint);
        oldRuns.push(run); oldPrefixes.push({ file: data.historyRef, checkpoint: data.nativeCheckpoint });
        if (!stableGrants) stableGrants = c.store.all('SELECT * FROM effect_delegations ORDER BY rowid');
        assert.deepEqual(c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'), stableGrants);
        const budget = c.inspectWork(workId).allowance; assert.equal(budget.consumed, turn); assert.equal(budget.reserved, 0);
        receipts.push({ kind: 'actual-mode-turn', turn, result, run, binding: data.ordinaryRoleBinding, budget });
        if (turn === 2) {
            const grants = c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'); await c.close(); await open();
            assert.deepEqual(c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'), grants);
            for (const prior of oldRuns) assert.deepEqual(runRow(prior.id), prior);
        }
    }
    assert.equal(requests, 7); assert.equal(served, 7); assert.equal(sockets, 0);
    const budgets = c.store.all('SELECT * FROM budgets'); assert.equal(budgets.length, 4);
    for (const b of budgets) { assert.equal(b.reserved, 0); assert.equal(b.consumed, b.lineage === workId ? (b.kind === 'execution' ? 4 : 0) : (b.kind === 'execution' ? 2 : 1)); }
    assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_delegations').n, 2);
    const allRuns = c.store.all('SELECT * FROM runs'); assert.equal(allRuns.length, 6);
    for (const run of allRuns) { const d = JSON.parse(run.data); assert.equal(run.phase, 'SETTLED'); assert.equal(d.cleanup, 'unbound'); await nativeCheckpoint(d.historyRef, d.nativeCheckpoint); }
    const leases = c.store.all('SELECT * FROM capacity_leases'); assert.equal(leases.length, 6); assert.ok(leases.every(l => l.state === 'RELEASED'));
    await fs.writeFile(path.join(root, 'final-ledger.json'), JSON.stringify({ runs: allRuns, works: c.store.all('SELECT * FROM works'), budgets: c.store.all('SELECT * FROM budgets'), grants: c.store.all('SELECT * FROM effect_delegations'), operations: c.store.all('SELECT * FROM effect_operations'), launches: c.store.all('SELECT * FROM role_launches'), findings: c.store.all('SELECT * FROM finding_occurrences'), leases }, null, 2));
} catch (error) { failure = failure ? new AggregateError([failure, error], 'Owned deadline and original work failed') : error; await fs.writeFile(path.join(root, 'primary-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); }
finally {
    clearTimeout(timer); abort.abort();
    try { await (deadlineClose ?? c?.close()); } catch (error) { await fs.writeFile(path.join(root, 'cleanup-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); failure = failure ? new AggregateError([failure, error]) : error; }
    for (const unsubscribe of unsubscribers) unsubscribe(); await save();
}
if (failure) { await fs.writeFile(path.join(root, 'terminal-failure.json'), JSON.stringify({ message: failure.message, stack: failure.stack })); throw failure; }
console.log(JSON.stringify({ outcome: 'passed', requests, served, sockets, runs: 6, leases: 6 }));

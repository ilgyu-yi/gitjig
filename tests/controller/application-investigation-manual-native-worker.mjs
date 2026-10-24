import { runtimeFixtureProfile, runtimeFixtureConfig } from '../runtime/profile.mjs';
// Original Pi HTTP codec + actual restricted engine; finite synthetic decisions only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { ApplicationSettings } from '../../dist/app/settings.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), project = path.join(root, 'source');
const runtimeProfile = { ...runtimeFixtureProfile(), uid: process.getuid(), gid: process.getgid() };
assert.equal(process.env.DOCKER_CONFIG, runtimeFixtureConfig());
const provider = 'investigation-manual-native', key = 'DUMMY_N9_ONLY', sentinel = 'N9_CAPTURED_PROJECT_SENTINEL';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => typeof part.text === 'string').map(part => part.text).join('');
const stages = ['investigation-initial', 'investigation-resume', 'ordinary-1', 'ordinary-2', 'ordinary-3', 'compact'];
const longUser = 'N9_ORDINARY_3_LONG_USER\n' + 'x'.repeat(88000);
let c, models, stage = 'setup', cid, requests = 0, served = 0, sockets = 0, failure;
const traffic = [], receipts = [], recipes = new Map(), nativeOwners = new Map(), subscriptions = [];
const ownedAbort = new AbortController(), timer = setTimeout(() => ownedAbort.abort(Error('Owned native consumer deadline')), 35000);
const save = async () => fs.writeFile(path.join(root, 'traffic.json'), JSON.stringify({ requests, served, sockets, traffic, receipts }, null, 2));
net.Socket.prototype.connect = function () { sockets++; throw Error('No Node network in native consumer fixture'); };
globalThis.fetch = async (url, init) => {
    const ordinal = ++requests;
    await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ordinal, stage, entered: true }));
    await save();
    const body = JSON.parse(init.body), record = { ordinal, stage, url: String(url), body };
    traffic.push(record); await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    assert.ok(ordinal <= 7, 'Hard attempt safety ceiling');
    assert.ok(ordinal <= 6, 'Seventh position unallocated: never serve unexpected request');
    assert.equal(stage, stages[ordinal - 1]); ownedAbort.signal.throwIfAborted();
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
    const modelId = stage.startsWith('ordinary') ? 'beta' : 'alpha', thinking = modelId === 'alpha' ? 'high' : 'low';
    assert.equal(body.model, modelId); assert.equal(body.reasoning_effort, thinking);
    const runs = c.store.all("SELECT * FROM runs WHERE phase='RUNNING'"); assert.equal(runs.length, 1);
    const run = runs[0], data = JSON.parse(run.data), recipe = recipes.get(stage); assert.ok(recipe);
    if (stage.startsWith('investigation')) {
        assert.equal(data.kind, 'investigation'); assert.deepEqual(data.modelIdentity, recipe);
        assert.deepEqual(data.modelMode, { kind: 'application', version: 1, baselineRevision: 1 });
    } else {
        assert.equal(data.modelIdentity, hash(recipe));
        const native = c.getNativeHandle(cid); assert.ok(native); assert.equal(native.identity.runId, run.id);
        assert.equal(native.session.model.provider, provider); assert.equal(native.session.model.id, modelId);
        assert.equal(native.session.thinkingLevel, thinking);
        assert.deepEqual(data.conversationModelMode, { kind: 'application', version: 1, choiceRevision: c.getConversationModelChoice(cid).revision });
    }
    const evidence = c.store.all('SELECT data FROM observations WHERE run=?', run.id).map(row => JSON.parse(row.data)).find(row => row.type === 'resolved-model');
    assert.ok(evidence); assert.equal(evidence.model.modelId, modelId); assert.equal(evidence.model.thinkingLevel, thinking);
    assert.equal(evidence.model.source, 'gitjig'); assert.equal(evidence.model.api, 'openai-completions');
    const all = body.messages.map(text).join('\n');
    if (stage === 'investigation-resume') { assert.match(all, /N9_INVESTIGATION_INITIAL/); assert.match(all, /N9_INITIAL_NATIVE_RESULT/); assert.match(all, /N9_INVESTIGATION_RESUME/); }
    if (stage === 'ordinary-3') assert.ok(all.includes(longUser));
    if (stage === 'compact') { assert.match(all, /N9_ORDINARY_1/); assert.match(all, /N9_ORDINARY_2/); assert.ok(!all.includes('N9_ORDINARY_3_LONG_USER'), 'Third user must be retained, not summarized'); }
    const answer = stage === 'investigation-initial' ? 'N9_INITIAL_NATIVE_RESULT' : stage === 'investigation-resume' ? 'N9_RESUMED_NATIVE_RESULT' : stage === 'compact' ? '## Goal\nPreserve N9 original context.\n## Progress\nFirst two genuine turns completed.\n## Next\nRetain the large third user and project sentinel.' : 'N9_NATIVE_' + stage;
    record.actual = { runId: run.id, workId: run.work, nativeSessionId: data.nativeSessionId, modelIdentity: data.modelIdentity, evidence: evidence.model };
    served++; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    return wireResponse('openai-completions', modelId, { text: answer });
};
async function open() {
    c = await openController({ installationHome: home, runtimeProfile }); models = new ApplicationModels(c);
    const desired = models.resolveDesiredChoice.bind(models), conversation = models.resolve.bind(models);
    models.resolveDesiredChoice = async (...args) => { const model = await desired(...args); recipes.set(stage, modelConfigurationIdentity(model)); return model; };
    models.resolve = async (...args) => { const model = await conversation(...args); recipes.set(stage, modelConfigurationIdentity(model)); return model; };
    models.install();
    subscriptions.push(c.subscribeInteraction(event => {
        if (event.type !== 'native-ready') return;
        const native = c.getNativeHandle(event.conversationId); assert.ok(native);
        const owner = { stage, identity: native.identity, modelId: native.session.model.id, provider: native.session.model.provider, thinkingLevel: native.session.thinkingLevel, nativeSessionId: native.sessionManager.getSessionId() };
        nativeOwners.set(stage, owner); receipts.push({ kind: 'native-owner', ...owner });
    }));
}
const runData = runId => JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', runId).data);
const delivered = result => { assert.equal(result.status, 'delivered', JSON.stringify(result)); assert.equal(result.cleanup, 'removed'); };
try {
    await fs.mkdir(project); await fs.writeFile(path.join(project, 'owned.txt'), sentinel);
    await open(); await c.registerProject({ id: 'P', sourceRoot: project });
    await ApplicationAccounts.open(c).configure({ providers: { [provider]: { api: 'openai-completions', apiKey: key, baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta'].map(id => ({ id, reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 100000, maxTokens: 20000 })) } } });
    await ApplicationAccounts.open(c).setDefault(provider, 'alpha');
    await ApplicationSettings.open(c).setPreference('defaultThinkingLevel', 'high');
    const baseline = await models.baseline('P'); assert.equal(baseline.choice.modelId, 'alpha'); assert.equal(baseline.choice.thinkingLevel, 'high');
    stage = 'investigation-initial';
    const first = await c.startConversation({ projectId: 'P', message: 'N9_INVESTIGATION_INITIAL', applicationModelBaseline: baseline, signal: ownedAbort.signal }); delivered(first);
    const original = c.store.one('SELECT * FROM runs WHERE id=?', first.runId), originalData = runData(first.runId), initialBytes = await fs.readFile(first.historyRef);
    assert.equal(originalData.kind, 'investigation'); assert.ok(originalData.nativeCheckpoint && originalData.nativeSessionId);
    assert.ok(c.store.one('SELECT conversation FROM conversation_state WHERE conversation=?', originalData.conversation));
    assert.equal(c.inspectWork(first.workId).allowance.consumed, 1);
    await ApplicationAccounts.open(c).setDefault(provider, 'beta');
    await ApplicationSettings.open(c).setPreference('defaultThinkingLevel', 'low');
    await models.setRole('planner', await models.choice(provider, 'beta', 'low'));
    await c.close(); c = undefined; await open();
    stage = 'investigation-resume';
    const second = await c.resumeWork({ workId: first.workId, applicationModel: { version: 1, baselineRevision: 1 }, message: 'N9_INVESTIGATION_RESUME', signal: ownedAbort.signal }); delivered(second);
    assert.equal(second.workId, first.workId); assert.notEqual(second.runId, first.runId);
    const secondData = runData(second.runId), fullInvestigation = await fs.readFile(second.historyRef);
    assert.equal(secondData.conversation, originalData.conversation); assert.equal(secondData.nativeSessionId, originalData.nativeSessionId);
    assert.ok(fullInvestigation.subarray(0, initialBytes.length).equals(initialBytes));
    assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', first.runId), original);
    assert.deepEqual(c.getWorkApplicationModelBaseline(first.workId), baseline);
    assert.equal(c.inspectWork(first.workId).allowance.consumed, 2); assert.equal(c.inspectWork(first.workId).allowance.reserved, 0);
    receipts.push({ kind: 'investigation', first, second, original, baseline, initialBytes: initialBytes.length, initialSha256: createHash('sha256').update(initialBytes).digest('hex') });
    const view = await models.newConversation({ projectId: 'P' }); cid = view.conversationId;
    assert.equal(c.getConversationModelChoice(cid).modelId, 'beta'); assert.equal(c.getConversationModelChoice(cid).thinkingLevel, 'low');
    const ordinary = [];
    for (let turn = 1; turn <= 3; turn++) {
        stage = 'ordinary-' + turn;
        const raw = turn === 3 ? longUser : 'N9_ORDINARY_' + turn;
        const current = c.inspectConversation(cid);
        const input = await c.queueConversationInput({ conversationId: cid, expectedGeneration: current.generation, text: raw, mode: 'idle' });
        assert.equal(c.store.one('SELECT text FROM conversation_inputs WHERE id=?', input.inputId).text, raw);
        const result = await c.runConversation({ conversationId: cid, ...models.conversationOperation(cid), signal: ownedAbort.signal }); delivered(result); ordinary.push(result);
    }
    const history = await c.getConversationHistory(cid), beforeBranch = history.sessionManager.getBranch();
    const third = beforeBranch.find(entry => entry.type === 'message' && entry.message.role === 'user' && text(entry.message) === longUser);
    const firstUser = beforeBranch.find(entry => entry.type === 'message' && entry.message.role === 'user' && text(entry.message) === 'N9_ORDINARY_1');
    assert.ok(third && firstUser); assert.equal(longUser.length, 88024);
    const priorRuns = ordinary.map(result => c.store.one('SELECT * FROM runs WHERE id=?', result.runId));
    const beforeChoice = c.getConversationModelChoice(cid);
    await models.select({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedRevision: beforeChoice.revision, provider, modelId: 'alpha', thinkingLevel: 'high' });
    for (const run of priorRuns) assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', run.id), run);
    stage = 'compact';
    const compacted = await c.compactConversation({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, ...models.conversationOperation(cid), instructions: 'Preserve N9 first two turns', signal: ownedAbort.signal }); delivered(compacted);
    assert.equal(requests, 6); assert.equal(compacted.nativeResult.firstKeptEntryId, third.id);
    const compactHistory = await c.getConversationHistory(cid), compaction = compactHistory.sessionManager.getBranch().find(entry => entry.type === 'compaction'); assert.ok(compaction);
    assert.equal(compaction.firstKeptEntryId, third.id); assert.equal(compaction.summary, compacted.nativeResult.summary);
    await fs.writeFile(path.join(root, 'pre-tree-history.jsonl'), await fs.readFile(c.inspectConversation(cid).historyRef));
    receipts.push({ kind: 'compact', result: compacted, compaction, thirdUserId: third.id, userBytes: Buffer.byteLength(longUser), userSha256: createHash('sha256').update(longUser).digest('hex'), priorRuns });
    stage = 'tree';
    const navigated = await c.navigateConversationTree({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, ...models.conversationOperation(cid), entryId: firstUser.id, signal: ownedAbort.signal }); delivered(navigated); assert.equal(requests, 6);
    assert.equal(runData(navigated.runId).modelIdentity, hash(recipes.get('tree'))); assert.equal(runData(navigated.runId).modelDispatchAttempted, undefined);
    const marker = (await c.getConversationHistory(cid)).sessionManager.getBranch().at(-1);
    assert.equal(marker.type, 'custom'); assert.equal(marker.customType, 'gitjig.owner-tree-navigation'); assert.equal(marker.data.targetEntryId, firstUser.id); assert.equal(marker.data.runId, navigated.runId);
    stage = 'bash';
    const bash = await c.executeConversationBash({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, ...models.conversationOperation(cid), command: 'cat /work/owned.txt', signal: ownedAbort.signal }); delivered(bash); assert.equal(requests, 6);
    const bashObservation = c.store.all('SELECT data FROM observations WHERE run=?', bash.runId).map(row => JSON.parse(row.data)).find(row => row.kind === 'native-user-bash');
    assert.ok(bashObservation); assert.equal(bashObservation.receipt.exitCode, 0); assert.equal(bashObservation.receipt.output, sentinel);
    assert.equal(runData(bash.runId).modelDispatchAttempted, undefined);
    assert.equal(runData(bash.runId).modelIdentity, hash(recipes.get('bash')));
    for (const action of ['compact', 'tree', 'bash']) {
        const owner = nativeOwners.get(action); assert.ok(owner); assert.equal(owner.identity.conversationId, cid);
        assert.equal(owner.provider, provider); assert.equal(owner.modelId, 'alpha'); assert.equal(owner.thinkingLevel, 'high');
    }
    const finalHistory = await c.getConversationHistory(cid), bashEntry = finalHistory.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'bashExecution');
    assert.ok(bashEntry); assert.equal(bashEntry.message.output, sentinel);
    const finalLeaf = finalHistory.sessionManager.getLeafId(), finalRef = c.inspectConversation(cid).historyRef;
    receipts.push({ kind: 'tree-bash', navigated, marker, bash, bashObservation, finalLeaf, finalRef });
    const ordinaryWork = ordinary[0].workId; assert.ok(ordinary.every(result => result.workId === ordinaryWork));
    assert.equal(compacted.workId, ordinaryWork); assert.equal(navigated.workId, ordinaryWork); assert.equal(bash.workId, ordinaryWork);
    assert.equal(c.inspectWork(ordinaryWork).allowance.consumed, 6); assert.equal(c.inspectWork(ordinaryWork).allowance.reserved, 0);
    await c.close(); c = undefined; await open();
    assert.equal(c.inspectConversation(cid).historyRef, finalRef); assert.equal((await c.getConversationHistory(cid)).sessionManager.getLeafId(), finalLeaf);
    const produced = c.store.all('SELECT * FROM runs').filter(row => JSON.parse(row.data).containerId).map(row => ({ runId: row.id, workId: row.work, containerId: JSON.parse(row.data).containerId, cleanup: JSON.parse(row.data).cleanup }));
    assert.equal(produced.length, 8); assert.ok(produced.every(row => row.cleanup === 'removed'));
    assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state!='RELEASED'").n, 0);
    assert.equal(await fs.readFile(path.join(project, 'owned.txt'), 'utf8'), sentinel); assert.equal(requests, 6); assert.equal(served, 6); assert.equal(sockets, 0);
    await fs.writeFile(path.join(root, 'produced-scopes.json'), JSON.stringify(produced)); await save();
} catch (error) {
    failure = error; await fs.writeFile(path.join(root, 'primary-failure.json'), JSON.stringify({ message: error.message, stack: error.stack }));
} finally {
    clearTimeout(timer); ownedAbort.abort();
    try { await c?.close(); }
    catch (error) { await fs.writeFile(path.join(root, 'cleanup-failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); failure = failure ? new AggregateError([failure, error], 'Native qualification and cleanup failed') : error; }
    finally { for (const unsubscribe of subscriptions) unsubscribe(); await save(); }
}
if (failure) throw failure;
console.log(JSON.stringify({ outcome: 'passed', requests, served, sockets, scopes: 8 }));

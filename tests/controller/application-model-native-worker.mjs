import { runtimeFixtureProfile, runtimeFixtureConfig } from '../runtime/profile.mjs';
// Real qualified local engine + original Pi HTTP codec. Every response is finite synthetic data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { scripted, settledRoot } from './effect-fixture.mjs';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
import {assignedWireReply} from '../pi/assigned-report-fixture.mjs';
initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), project = path.join(root, 'source');
const runtimeProfile = { ...runtimeFixtureProfile(), uid: process.getuid(), gid: process.getgid() };
assert.equal(process.env.DOCKER_CONFIG, runtimeFixtureConfig());
const provider = 'native-app-fixture', key = 'DUMMY_NATIVE_APP_ONLY', expectedThinking = { alpha: 'high', beta: 'low', gamma: 'medium' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let c, models, parentId, existingId, parentCalls = 0, requests = 0, sockets = 0, served = 0, held = false, unsubscribe;
const entered = Promise.withResolvers(), release = Promise.withResolvers(), resumed = Promise.withResolvers();
const bodies = [], roles = [], receipts = [];
const resolvedRoles = new Map(), resolvedTargets = new Map();
const ownedAbort = new AbortController(), ownedTimer = setTimeout(() => ownedAbort.abort(Error('Owned native qualification deadline')), 25000);
const withAbort = async promise => {
    ownedAbort.signal.throwIfAborted(); let fail;
    try { return await Promise.race([promise, new Promise((_, reject) => { fail = () => reject(ownedAbort.signal.reason); ownedAbort.signal.addEventListener('abort', fail, { once: true }); })]); }
    finally { if (fail) ownedAbort.signal.removeEventListener('abort', fail); }
};
let saving = Promise.resolve();
const save = () => { const bytes = JSON.stringify({ requests, served, sockets, parentCalls, bodies, roles, receipts }, null, 2); saving = saving.then(() => fs.writeFile(path.join(root, 'traffic.json'), bytes)); return saving; };
const deadline = async (promise, milliseconds, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Timed out: ' + label)), milliseconds); })]); }
    finally { clearTimeout(timer); }
};
const text = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => typeof part.text === 'string').map(part => part.text).join('');
const originalProtocolText = scripted(() => { throw Error('No selected custom-stream ordinary execution'); }, info => roles.push(info.role));
net.Socket.prototype.connect = function () { sockets++; throw Error('No Node network connection in native model fixture'); };
globalThis.fetch = async (url, init) => {
    const ordinal = ++requests; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ordinal, stage: 'entered' })); await save(); assert.ok(ordinal <= 12, 'Hard twelve-request ceiling including distinct assigned reports; no extra response');
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
    const body = JSON.parse(init.body), users = body.messages.filter(message => message.role === 'user').map(text), all = users.join('\n');
    assert.ok(Object.hasOwn(expectedThinking, body.model)); assert.equal(body.reasoning_effort, expectedThinking[body.model]);
    const nativeRuns = c.store.all("SELECT id,work,data FROM runs WHERE phase='RUNNING'").map(row => ({ id: row.id, work: row.work, data: JSON.parse(row.data) }));
    const record = { request: ordinal, url: String(url), body, active: nativeRuns.map(row => ({ runId: row.id, workId: row.work, conversation: row.data.conversation, modelIdentity: row.data.modelIdentity })) }; bodies.push(record); await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify(record)); await save();
    let answer, requestCid;
    const roleText = users.find(value => value.startsWith('Perform the assigned '));
    if (roleText) {
        const role = roleText.match(/assigned (\w+) task/)[1], expected = { planner: 'beta', challenger: 'alpha', adjudicator: 'gamma' }[role]; assert.equal(body.model, expected);
        const launch = c.store.one('SELECT run FROM role_launches WHERE role=? ORDER BY rowid DESC LIMIT 1', role);
        requestCid = c.store.one("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", launch.run).conversation;
        const protocol = await originalProtocolText.definition.streamSimple({ api: 'openai-completions', provider, id: body.model }, { messages: [{ role: 'user', content: [{ type: 'text', text: roleText }] }] }).result();
        assert.equal(protocol.stopReason, 'stop'); answer = { text: protocol.content.find(part => part.type === 'text').text };
    } else if (all.includes('ROOT_PARENT_NATIVE')) {
        requestCid = parentId; parentCalls++; assert.equal(body.model, 'alpha');
        const assignments = c.store.all('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid', parentId);
        if (parentCalls === 1) answer = { tool: { name: 'conversation_assign', arguments: { projectId: 'P', instructions: 'NATIVE_NEW_TARGET', resultDependency: true } } };
        else if (parentCalls === 2) {
            assert.equal(assignments.length, 1);
            answer = { tool: { name: 'conversation_assign', arguments: { projectId: 'P', conversationId: receipts.find(r => r.kind === 'existing').cid, observedDirectionRevision: c.inspectConversation(receipts.find(r => r.kind === 'existing').cid).directionRevision, instructions: 'NATIVE_EXISTING_TARGET', resultDependency: true } } };
        } else if (parentCalls === 3) {
            assert.equal(assignments.length, 2); answer = { tool: { name: 'conversation_wait', arguments: { resultHandles: assignments.map(row => row.id) } } };
        } else {
            assert.equal(parentCalls, 4); assert.equal(held, true); assert.ok(all.includes('Explicitly resumed authorized dependency outcomes'));
            assert.equal(assignments.length, 2); assert.ok(assignments.every(row => row.state === 'COMPLETE'));
            answer = { text: 'PARENT_NATIVE_RESTART_COMPLETE' };
        }
    } else if (users.at(-1).includes('NATIVE_EXISTING_TARGET')) { requestCid = existingId; assert.equal(body.model, 'beta'); answer = { text: 'EXISTING_BETA_NATIVE_RESULT' }; }
    else if (users.at(-1).includes('NATIVE_NEW_TARGET')) { requestCid = c.store.one('SELECT target FROM conversation_assignments WHERE source_conversation=? AND target<>?', parentId, existingId).target; assert.equal(body.model, 'alpha'); answer = { text: 'NEW_ALPHA_NATIVE_RESULT' }; }
    else { requestCid = existingId; assert.ok(all.includes('NATIVE_PREPARE_EXISTING')); assert.equal(body.model, 'alpha'); answer = { text: 'EXISTING_ALPHA_NATIVE_HISTORY' }; }
    const native = c.getNativeHandle(requestCid); assert.ok(native);
    assert.equal(native.session.model.provider, provider); assert.equal(native.session.model.id, body.model); assert.equal(native.session.thinkingLevel, expectedThinking[body.model]);
    const actualRun = c.store.one('SELECT * FROM runs WHERE id=?', native.identity.runId), actualData = JSON.parse(actualRun.data);
    const selected = roleText ? resolvedRoles.get(roleText.match(/assigned (\w+) task/)[1]) : resolvedTargets.get(requestCid);
    assert.ok(selected?.sessionPreferences); assert.equal(actualData.modelIdentity, digest(modelConfigurationIdentity(selected)));
    assert.equal(native.session.steeringMode, selected.sessionPreferences.steeringMode); assert.equal(native.session.followUpMode, selected.sessionPreferences.followUpMode);
    const currentChoice = c.getConversationModelChoice(requestCid);
    if (!roleText) {
        assert.equal(currentChoice.kind, 'managed'); assert.deepEqual(actualData.conversationModelMode, { kind: 'application', version: 1, choiceRevision: currentChoice.revision });
        const input = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', actualData.initialInputId), source = c.store.one('SELECT * FROM sources WHERE id=?', input.source);
        assert.equal(input.conversation, requestCid); assert.equal(input.work, actualRun.work); assert.equal(source.conversation, requestCid);
        const assignmentId = JSON.parse(input.data).assignment;
        if (assignmentId) { const assignment = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId); assert.equal(assignment.target, requestCid); assert.equal(assignment.work, actualRun.work); assert.equal(JSON.parse(assignment.data).modelBinding.mode.choiceRevision, currentChoice.revision); }
    }
    if (!roleText) assert.equal(actualData.conversation, requestCid);
    assert.equal(c.store.one("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", native.identity.runId).conversation, requestCid);
    record.actual = { identity: native.identity, nativeSessionId: native.sessionManager.getSessionId(), model: native.session.model.id, thinkingLevel: native.session.thinkingLevel, steeringMode: native.session.steeringMode, followUpMode: native.session.followUpMode, modelIdentity: actualData.modelIdentity };
    served++; await fs.writeFile(path.join(root, 'request-' + ordinal + '.json'), JSON.stringify({ ...record, served: true })); await save(); return wireResponse('openai-completions', body.model, assignedWireReply(body,answer));
};
async function open(withBarrier) {
    c = await openController({ installationHome: home, runtimeProfile, interactionDelegation: { projectIds: ['P'], maxAssignments: 2 } }); models = new ApplicationModels(c);
    const install = c.installApplicationModelResolver.bind(c);
    c.installApplicationModelResolver = resolver => install({ ...resolver, async resolveRole(request) { const selected = await resolver.resolveRole(request); resolvedRoles.set(request.role, selected); return selected; }, async resolveConversation(request) {
        const selected = await resolver.resolveConversation(request); resolvedTargets.set(request.conversationId, selected);
        if (withBarrier && request.conversationId === parentId && c.inspectConversation(parentId).state === 'WAITING' && !held) {
            held = true; entered.resolve(); await withAbort(release.promise);
        }
        return selected;
    } });
    if (!withBarrier) unsubscribe = c.subscribeInteraction(event => {
        if (event.conversationId !== parentId || event.type !== 'cleanup') return;
        const row = c.store.one('SELECT * FROM runs WHERE id=(SELECT json_extract(data,\'$.runId\') FROM conversation_state WHERE conversation=?)', parentId);
        if (row && JSON.parse(row.data).outcome === 'delivered') resumed.resolve(row);
    });
    models.install();
}
try {
    await fs.mkdir(project, { mode: 0o700 }); await fs.writeFile(path.join(project, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(project, 'check.cjs'), "console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n");
    await open(true); await c.registerProject({ id: 'P', sourceRoot: project });
    await ApplicationAccounts.open(c).configure({ providers: { [provider]: { api: 'openai-completions', apiKey: key, baseUrl: 'http://127.0.0.1:9/v1', models: ['alpha', 'beta', 'gamma'].map(id => ({ id, reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 100000, maxTokens: 20000 })) } } });
    await ApplicationAccounts.open(c).setDefault(provider, 'alpha');
    for (const [role, id] of [['planner', 'beta'], ['adjudicator', 'gamma']]) await models.setRole(role, await models.choice(provider, id, expectedThinking[id]));
    const baseline = await models.baseline('P', await models.choice(provider, 'alpha', 'high', 'P'));
    const work = await c.beginChange({ projectId: 'P', request: 'Consumer must export3 using its existing simple implementation.', applicationModelBaseline: baseline });
    const plan = await c.planChange({ ...models.workOperation(work.workId), signal: ownedAbort.signal }); assert.equal(plan.phase, 'PLAN_READY', JSON.stringify(plan.blocked));
    assert.deepEqual(roles, ['planner', 'challenger', 'adjudicator']); assert.equal(requests, 3);
    for (const launch of c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid', work.workId)) {
        const data = JSON.parse(launch.data), run = c.store.one('SELECT * FROM runs WHERE id=?', launch.run), runData = JSON.parse(run.data);
        assert.equal(run.phase, 'SETTLED'); assert.ok(runData.nativeCheckpoint && runData.historyRef); assert.equal(runData.cleanup, 'removed');
        assert.equal(data.modelIdentity, runData.modelIdentity); assert.equal(data.modelMode.kind, 'application');
        assert.equal(data.modelIdentity, digest(modelConfigurationIdentity(resolvedRoles.get(launch.role))));
        receipts.push({ kind: 'role', role: launch.role, launchId: launch.id, runId: run.id, modelIdentity: data.modelIdentity });
    }
    const existing = await models.newConversation({ projectId: 'P', choice: await models.choice(provider, 'alpha', 'high', 'P') });
    existingId = existing.conversationId;
    await c.queueConversationInput({ conversationId: existing.conversationId, expectedGeneration: 0, text: 'NATIVE_PREPARE_EXISTING', mode: 'idle' });
    const prep = await c.runConversation({ conversationId: existing.conversationId, ...models.conversationOperation(existing.conversationId), signal: ownedAbort.signal }); assert.equal(prep.status, 'delivered');
    const oldRun = c.store.one('SELECT * FROM runs WHERE id=?', prep.runId), oldChoice = c.getConversationModelChoice(existing.conversationId);
    await models.select({ conversationId: existing.conversationId, expectedGeneration: c.inspectConversation(existing.conversationId).generation, expectedRevision: oldChoice.revision, provider, modelId: 'beta', thinkingLevel: 'low' });
    assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', prep.runId), oldRun);
    const betaChoice = c.getConversationModelChoice(existing.conversationId); receipts.push({ kind: 'existing', cid: existing.conversationId, oldRun, betaChoice });
    const parent = await models.newConversation({ choice: await models.choice(provider, 'alpha', 'high') }); parentId = parent.conversationId;
    const parentChoice = c.getConversationModelChoice(parentId);
    await c.queueConversationInput({ conversationId: parentId, expectedGeneration: 0, text: 'ROOT_PARENT_NATIVE', mode: 'idle' });
    const waiting = await c.runConversation({ conversationId: parentId, ...models.conversationOperation(parentId), signal: ownedAbort.signal }); assert.equal(waiting.status, 'waiting', JSON.stringify(waiting));
    await deadline(entered.promise, 7000, 'real WAIT continuation resolver');
    const waited = c.store.one('SELECT * FROM conversation_state WHERE conversation=?', parentId), waitData = JSON.parse(waited.data);
    assert.equal(waitData.continuationAuthorized, true); assert.deepEqual(c.getConversationModelChoice(parentId), parentChoice);
    const actualAssignments = c.store.all('SELECT * FROM conversation_assignments WHERE source_conversation=? ORDER BY rowid', parentId);
    assert.equal(actualAssignments.length, 2); assert.ok(actualAssignments.every(row => row.state === 'COMPLETE'));
    for (const assignment of actualAssignments) {
        const target = c.inspectConversation(assignment.target), choice = c.getConversationModelChoice(assignment.target), data = JSON.parse(assignment.data);
        assert.equal(target.parentId, target.conversationId === existing.conversationId ? null : parentId); assert.equal(choice.modelId, target.conversationId === existing.conversationId ? 'beta' : 'alpha');
        const result = c.store.one("SELECT * FROM conversation_results WHERE json_extract(data,'$.assignmentId')=?", assignment.id); assert.ok(result);
        assert.ok(data.modelBinding); assert.ok((await fs.readFile(target.historyRef, 'utf8')).includes(target.conversationId === existing.conversationId ? 'EXISTING_BETA_NATIVE_RESULT' : 'NEW_ALPHA_NATIVE_RESULT'));
    }
    assert.equal(requests, 11); assert.equal(parentCalls, 3); assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', prep.runId), oldRun);
    const oldParent = c.store.one('SELECT * FROM runs WHERE id=?', waiting.runId); assert.ok(JSON.parse(oldParent.data).nativeCheckpoint);
    const closing = c.close(); release.resolve(); await closing; c = undefined;
    await open(false); const continued = await deadline(resumed.promise, 7000, 'genuine persisted WAIT continuation');
    assert.equal(continued.work, waiting.workId); assert.notEqual(continued.id, waiting.runId); assert.equal(parentCalls, 4); assert.equal(requests, 12);
    // Native cleanup is earlier than result publication/unregistration. Observe
    // the original final delivered record and idle owner before closing.
    let observe;
    try {
        await deadline(new Promise(resolve => { const check = () => { if (settledRoot(c, parentId, waiting.workId, 2)) resolve(); }; observe = setInterval(check, 10); check(); }), 7000, 'original delivered continuation settlement');
    } finally { clearInterval(observe); }
    const delivered = JSON.parse(c.store.one('SELECT data FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1', parentId).data).result;
    assert.equal(delivered.runId, continued.id); assert.equal(delivered.status, 'delivered');
    const after = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', parentId).data);
    assert.equal(after.continuationAuthorized, false); assert.equal(after.explicitContinuation.runId, waiting.runId);
    assert.deepEqual(c.getConversationModelChoice(parentId), parentChoice); assert.deepEqual(c.getConversationModelChoice(existing.conversationId), betaChoice);
    assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', prep.runId), oldRun); assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?', waiting.runId), oldParent);
    assert.ok((await fs.readFile(c.inspectConversation(parentId).historyRef, 'utf8')).includes('PARENT_NATIVE_RESTART_COMPLETE'));
    assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('QUEUED','ADMITTED','SETTLING','QUARANTINED')").n, 0);
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n'); assert.equal(sockets, 0); assert.equal(served, 12);
    receipts.push({ kind: 'native-complete', roles: 3, assignments: actualAssignments, waitingRun: waiting.runId, continuationRun: continued.id, workId: waiting.workId });
    const produced = c.store.all('SELECT * FROM runs').filter(row => JSON.parse(row.data).containerId).map(row => ({ runId: row.id, workId: row.work, containerId: JSON.parse(row.data).containerId, cleanup: JSON.parse(row.data).cleanup }));
    assert.ok(produced.length > 0); assert.ok(produced.every(row => row.cleanup === 'removed'));
    await fs.writeFile(path.join(root, 'produced-scopes.json'), JSON.stringify(produced));
    await save(); await fs.writeFile(path.join(root, 'outcome.json'), JSON.stringify({ outcome: 'passed', requests, served, sockets, roles, parentCalls }));
} catch (error) {
    await fs.writeFile(path.join(root, 'primary-failure.json'), JSON.stringify({ name: error.name, message: error.message, stack: error.stack }));
    throw error;
} finally {
    clearTimeout(ownedTimer); ownedAbort.abort(); release.resolve(); unsubscribe?.();
    try { await c?.close(); }
    catch (error) { await fs.writeFile(path.join(root, 'cleanup-failure.json'), JSON.stringify({ name: error.name, message: error.message, stack: error.stack })); throw error; }
    finally { await save(); }
}
console.log(JSON.stringify({ outcome: 'passed', requests, served, sockets, roles, parentCalls }));

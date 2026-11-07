// Explicit qualified local engine only; three ORIGINAL codec requests, no external model service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

initializeApplicationEnvironment();
const root = await fs.realpath(process.argv[2]), home = path.join(root, 'app'), project = path.join(root, 'source');
const runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT,
    image: process.env.GITJIG_RUNTIME_IMAGE, uid: process.getuid(), gid: process.getgid() };
assert.ok(runtimeProfile.dockerContext && runtimeProfile.image && process.env.DOCKER_CONFIG, 'Explicit qualified engine/context configuration required');
await fs.mkdir(project, { mode: 0o700 }); await fs.writeFile(path.join(project, 'AGENTS.md'), 'ROOT_CONTEXT_ONLY');
await fs.writeFile(path.join(project, 'file.txt'), 'BASE_SUBMISSION');
let controller = await openController({ installationHome: home, runtimeProfile }), requests = 0, sockets = 0, unsubscribe;
// Docker is the original trusted Go executable subprocess, not a Node network client.
// Node provider traffic is entirely the finite fetch fixture; no project/network fallback.
net.Socket.prototype.connect = function () { sockets++; throw Error('No Node network connection in project context fixture'); };
const bodies = [], receipts = [], queuedFollow = Promise.withResolvers(), abort = new AbortController();
const timer = setTimeout(() => abort.abort(Error('Project context fixture deadline')), 25000);
const text = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(block => block.text ?? '').join('');
const userFrames = body => body.messages.filter(message => message.role === 'user').map(text).filter(value => value.startsWith('User-supplied project context follows as JSON data.')).map(value => JSON.parse(value.slice(value.indexOf('\n') + 1)));
const sha = value => createHash('sha256').update(value).digest('hex');
let cid, primaryError;
try {
    const accounts = ApplicationAccounts.open(controller), models = new ApplicationModels(controller);
    await accounts.configure({ providers: { 'project-context-fixture': { api: 'openai-completions', apiKey: 'DUMMY_CONTEXT_ENGINE_ONLY',
        baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'owned', contextWindow: 16384, maxTokens: 256 }] } } });
    await accounts.setDefault('project-context-fixture', 'owned');
    await controller.registerProject({ id: 'P', sourceRoot: project });
    cid = (await models.newConversation({ projectId: 'P' })).conversationId;
    receipts.push(await controller.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 0, text: 'INITIAL @file.txt', mode: 'idle' }));
    await fs.writeFile(path.join(project, 'file.txt'), 'WORKCOPY_EXECUTION');
    globalThis.fetch = async (url, options) => {
        requests++;
        await fs.writeFile(path.join(root, 'request-count.json'), JSON.stringify({ requests, sockets }));
        assert.ok(requests <= 3, 'Hard three-request ceiling; no fourth response');
        assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer DUMMY_CONTEXT_ENGINE_ONLY');
        const body = JSON.parse(options.body); bodies.push(body);
        await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(bodies)); assert.equal(body.model, 'owned');
        const frames = userFrames(body); assert.equal(frames[0].files.find(file => file.path === 'file.txt').text, 'BASE_SUBMISSION');
        assert.equal(frames[0].comparison.files.find(file => file.path === 'file.txt').status, 'different');
        for (const frame of frames) {
            assert.equal(frame.files.find(file => file.path === 'AGENTS.md').text, 'ROOT_CONTEXT_ONLY');
            assert.equal(frame.comparison.files.find(file => file.path === 'AGENTS.md').status, 'same');
        }
        if (requests === 1) {
            assert.equal(frames.length, 1);
            const native = controller.getNativeHandle(cid).session;
            const observeQueue = () => { if (native.getFollowUpMessages().some(value => value.includes('FOLLOW_SUBMISSION'))) queuedFollow.resolve(); };
            unsubscribe = native.subscribe(event => { if (event.type === 'queue_update') observeQueue(); });
            await fs.writeFile(path.join(project, 'file.txt'), 'STEER_SUBMISSION');
            receipts.push(await controller.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'STEER @file.txt', mode: 'steer' }));
            await fs.writeFile(path.join(project, 'file.txt'), 'FOLLOW_SUBMISSION');
            receipts.push(await controller.queueConversationInputWithContext({ conversationId: cid, expectedGeneration: 1, text: 'FOLLOW @file.txt', mode: 'follow-up' }));
            return wireResponse('openai-completions', 'owned', { tool: { name: 'read', arguments: { path: 'file.txt' } } });
        }
        assert.ok(body.messages.some(message => message.role === 'tool' && text(message).includes('WORKCOPY_EXECUTION')), 'Original read tool must reach genuine restricted workcopy');
        assert.equal(frames[1].files.find(file => file.path === 'file.txt').text, 'STEER_SUBMISSION');
        if (requests === 2) {
            assert.equal(frames.length, 2, 'Follow-up is queued, not substituted into the steering request');
            await new Promise((resolve, reject) => {
                const failed = () => reject(abort.signal.reason); abort.signal.addEventListener('abort', failed, { once: true });
                if (abort.signal.aborted) failed();
                queuedFollow.promise.then(() => { abort.signal.removeEventListener('abort', failed); resolve(); }, reject);
            });
            assert.ok(controller.getNativeHandle(cid).session.getFollowUpMessages().some(value => value.includes('FOLLOW_SUBMISSION')));
            return wireResponse('openai-completions', 'owned', { text: 'STEER_REPLY' });
        }
        assert.equal(frames.length, 3); assert.equal(frames[2].files.find(file => file.path === 'file.txt').text, 'FOLLOW_SUBMISSION');
        return wireResponse('openai-completions', 'owned', { text: 'FINAL_CONTEXT_REPLY' });
    };
    const outcome = await controller.runConversation({ conversationId: cid, model: await models.resolve(cid), signal: abort.signal });
    assert.equal(requests, 3); assert.equal(sockets, 0); assert.equal(outcome.status, 'delivered'); assert.equal(outcome.cleanup, 'removed');
    const run = controller.store.one('SELECT * FROM runs WHERE id=?', outcome.runId), data = JSON.parse(run.data);
    assert.equal(run.phase, 'SETTLED');
    assert.equal(data.attainedCapture, true); assert.equal(data.attainedNative, true); assert.equal(data.cleanup, 'removed');
    assert.equal(await fs.readFile(path.join(run.staging, 'file.txt'), 'utf8'), 'WORKCOPY_EXECUTION');
    assert.equal(data.manifest.files.find(file => file.path === 'file.txt').sha256, sha('WORKCOPY_EXECUTION'));
    const comparisons = [data.initialInputComparison, ...data.routedInputs.map(input => input.comparison)];
    assert.equal(comparisons.length, 3);
    const inputSnapshots = [];
    for (const [i, receipt] of receipts.entries()) {
        const input = controller.store.one('SELECT * FROM conversation_inputs WHERE id=?', receipt.inputId), context = JSON.parse(input.data).context;
        inputSnapshots.push({ input: { ...input }, source: { ...controller.store.one('SELECT * FROM sources WHERE id=?', input.source) } });
        assert.equal(input.state, 'CONSUMED'); assert.equal(input.generation, 1); assert.equal(input.conversation, cid);
        assert.equal(context.submissionGeneration, i === 0 ? 0 : 1);
        assert.equal(context.files.find(file => file.path === 'file.txt').sha256, sha(['BASE_SUBMISSION', 'STEER_SUBMISSION', 'FOLLOW_SUBMISSION'][i]));
        assert.equal(comparisons[i].inputId, input.id); assert.equal(comparisons[i].sourceId, input.source);
        assert.equal(comparisons[i].captureDigest, data.manifest.digest); assert.equal(comparisons[i].runId, run.id);
        assert.equal(comparisons[i].inputManifestSha256, sha(JSON.stringify(context)));
        assert.equal(comparisons[i].files.find(file => file.path === 'file.txt').status, 'different');
    }
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM runs').n, 1);
    assert.equal(run.reservation, 'consumed');
    assert.equal(controller.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state<>'RELEASED'").n, 0);
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n, 1);
    assert.equal(controller.store.one('SELECT SUM(reserved) AS n FROM budgets').n, 0);
    assert.equal(controller.store.one("SELECT SUM(consumed) AS n FROM budgets WHERE kind='execution'").n, 1);
    assert.equal(await fs.readFile(path.join(project, 'file.txt'), 'utf8'), 'FOLLOW_SUBMISSION');
    assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), 'ROOT_CONTEXT_ONLY');
    assert.notEqual(controller.inspectConversation(cid).state, 'UNKNOWN');
    const history = await controller.getConversationHistory(cid), historyBytes = await fs.readFile(data.historyRef);
    assert.equal(sha(historyBytes), data.nativeCheckpoint.sha256); assert.equal(historyBytes.length, data.nativeCheckpoint.bytes);
    assert.match(historyBytes.toString(), /FINAL_CONTEXT_REPLY/);
    assert.equal(history.sessionManager.getSessionId(), data.nativeCheckpoint.sessionId);
    const journals = await fs.readdir(path.join(home, 'state/runtime'));
    assert.ok(journals.length); for (const file of journals) { const journal = JSON.parse(await fs.readFile(path.join(home, 'state/runtime', file))); assert.equal(journal.state, 'removed'); assert.equal(journal.runId, run.id); assert.equal(journal.workId, run.work); assert.equal(journal.id, data.containerId); }
    unsubscribe?.(); unsubscribe = undefined;
    await controller.close(); controller = await openController({ installationHome: home, runtimeProfile });
    const reopened = await controller.getConversationHistory(cid); assert.equal(reopened.sessionManager.getSessionId(), data.nativeCheckpoint.sessionId);
    assert.deepEqual(await fs.readFile(data.historyRef), historyBytes);
    const persisted = JSON.parse(controller.store.one('SELECT data FROM runs WHERE id=?', run.id).data);
    assert.deepEqual([persisted.initialInputComparison, ...persisted.routedInputs.map(input => input.comparison)], comparisons);
    for (const snapshot of inputSnapshots) {
        assert.deepEqual({ ...controller.store.one('SELECT * FROM conversation_inputs WHERE id=?', snapshot.input.id) }, snapshot.input);
        assert.deepEqual({ ...controller.store.one('SELECT * FROM sources WHERE id=?', snapshot.source.id) }, snapshot.source);
    }
    await fs.writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ requests, sockets, cid, outcome, comparisons, nativeCheckpoint: data.nativeCheckpoint }));
    await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(bodies));
} catch (error) { primaryError = error; throw error; }
finally {
    clearTimeout(timer); unsubscribe?.();
    try { await controller.close(); }
    catch (error) { throw primaryError ? new AggregateError([primaryError, error], 'Project context fixture and cleanup failed') : error; }
    finally {
        await fs.writeFile(path.join(root, 'request-count.json'), JSON.stringify({ requests, sockets }));
        await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(bodies));
    }
}
console.log(JSON.stringify({ outcome: 'passed', requests, sockets }));

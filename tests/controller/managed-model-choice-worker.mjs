import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

const root = process.argv[2], home = path.join(root, 'app'), stock = path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json');
initializeApplicationEnvironment();
await fs.writeFile(stock, '{"defaultModel":"WRONG_STOCK_MODEL"}', { mode: 0o600 });
net.Socket.prototype.connect = function () { throw Error('No socket connection in model-choice fixture'); };
const requests = [];
globalThis.fetch = async (url, options) => {
    assert.ok(requests.length < 2, 'Two-dispatch ceiling');
    const body = JSON.parse(options.body); requests.push({ body, headers: new Headers(options.headers) });
    return wireResponse(String(url).endsWith('/responses') ? 'openai-responses' : 'openai-completions', body.model, { text: 'SYNTHETIC choice response' });
};
let controller = await openController({ installationHome: home, completedResources: { mode: 'finite', idleMs: 60000, maxRetained: 4 } });
const accounts = ApplicationAccounts.open(controller), models = new ApplicationModels(controller);
const config = { providers: { 'choice-fixture': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'DUMMY_CHOICE',
    models: [{ id: 'alpha', reasoning: true, contextWindow: 8192, maxTokens: 256, compat: { supportsReasoningEffort: true } },
        { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } };
let targetId, chosen, historyRef, sessionId;
try {
    await accounts.configure(config); await accounts.setDefault('choice-fixture', 'alpha');
    await accounts.setScope(['choice-fixture/alpha:high', 'choice-fixture/beta']);
    const old = controller.createConversation();
    assert.equal(controller.getConversationModelChoice(old.conversationId).kind, 'unbound');
    const sibling = await models.newConversation();
    assert.equal(controller.getConversationModelChoice(sibling.conversationId).thinkingLevel, 'high');
    await accounts.setDefault('choice-fixture', 'beta');
    assert.equal(controller.getConversationModelChoice(sibling.conversationId).modelId, 'alpha');
    assert.equal((await models.choice('choice-fixture', 'beta', 'high')).thinkingLevel, 'off');
    await models.setRole('reviewer', await models.choice('choice-fixture', 'alpha', 'high'));
    const baseline = await models.resolve(sibling.conversationId);
    assert.equal((await models.resolveRole('reviewer', baseline)).managed.thinkingLevel, 'high');
    const target = controller.createConversation(); targetId = target.conversationId;
    const authPath = path.join(root, 'legacy-auth.json'), profileFile = path.join(root, 'legacy-profile.json');
    await fs.writeFile(authPath, JSON.stringify({ openai: { type: 'api_key', key: 'DUMMY_LEGACY' } }), { mode: 0o600 });
    await fs.writeFile(profileFile, JSON.stringify({ provider: 'openai', modelId: 'gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
    const legacy = await selectControllerModel(profileFile, controller);
    await controller.setConversationModelChoice({ conversationId: targetId, expectedGeneration: 0, expectedRevision: 0,
        choice: { kind: 'legacy-external', provider: legacy.provider, modelId: legacy.modelId } });
    assert.equal(await models.resolveRole('reviewer', legacy), legacy, 'Role preferences do not silently convert explicit external profiles');
    await assert.rejects(models.resolve(targetId), /external runtime profile/);
    process.env.TMPDIR = path.join(home, 'artifacts');
    await controller.queueConversationInput({ conversationId: targetId, expectedGeneration: 0, text: 'Original legacy history survives model change', mode: 'idle' });
    assert.equal((await controller.runConversation({ conversationId: targetId, model: legacy })).status, 'delivered');
    assert.equal(requests[0].headers.get('authorization'), 'Bearer DUMMY_LEGACY');
    const before = controller.inspectConversation(targetId); historyRef = before.historyRef; sessionId = before.nativeSessionId;
    assert.equal(before.completedResource.state, 'retained');
    await assert.rejects(accounts.setDefault('choice-fixture', 'alpha'), /conversation reclaim/);
    const entry = controller.completedCore.entries.get(targetId), close = entry.pi.closeOwned.bind(entry.pi);
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
    entry.pi.closeOwned = async () => { entered(); await waiting; await close(); };
    const binding = models.select({ conversationId: targetId, expectedGeneration: before.generation, expectedRevision: 1, provider: 'choice-fixture', modelId: 'alpha', thinkingLevel: 'high' });
    await started;
    try {
        assert.equal(controller.getConversationModelChoice(targetId).kind, 'legacy-external');
        assert.throws(() => controller.queueConversationInput({ conversationId: targetId, expectedGeneration: before.generation, text: 'Must not queue during rebind', mode: 'idle' }), /lifecycle operation/);
        await assert.rejects(accounts.setDefault('choice-fixture', 'alpha'), /lifecycle\/model changes/);
        assert.equal(controller.getConversationModelChoice(sibling.conversationId).modelId, 'alpha');
    } finally { release(); }
    chosen = await binding; assert.equal(chosen.revision, 2); assert.equal(chosen.kind, 'managed');
    assert.equal(controller.inspectConversation(targetId).completedResource.state, 'absent');
    await assert.rejects(models.select({ conversationId: targetId, expectedGeneration: before.generation, expectedRevision: 1, provider: 'choice-fixture', modelId: 'beta' }), /Stale conversation model revision/);
    await controller.queueConversationInput({ conversationId: targetId, expectedGeneration: before.generation, text: 'Managed turn retains original history', mode: 'idle' });
    assert.equal((await controller.runConversation({ conversationId: targetId, model: await models.resolve(targetId) })).status, 'delivered');
    assert.equal(requests[1].body.model, 'alpha'); assert.equal(requests[1].body.reasoning_effort, 'high');
    assert.equal(requests[1].headers.get('authorization'), 'Bearer DUMMY_CHOICE');
    const after = controller.inspectConversation(targetId);
    assert.equal(after.nativeSessionId, sessionId); assert.equal(after.historyRef, historyRef);
    assert.match(await fs.readFile(historyRef, 'utf8'), /Original legacy history survives model change/);
    assert.match(await fs.readFile(historyRef, 'utf8'), /Managed turn retains original history/);
    await accounts.setDefault('choice-fixture', 'beta');
    assert.deepEqual(controller.getConversationModelChoice(targetId), chosen);
} finally { await controller.close(); }
controller = await openController({ installationHome: home });
try {
    assert.deepEqual(controller.getConversationModelChoice(targetId), chosen);
    assert.equal(controller.inspectConversation(targetId).nativeSessionId, sessionId);
    // Controlled close rejection at the actual CompletedResources ownership boundary.
    // The close-only candidate is injected; this does not claim a spontaneous Pi failure.
    const view = controller.inspectConversation(targetId);
    controller.completedCore.entries.set(targetId, { identity: { conversationId: targetId, generation: view.generation, runId: 'CONTROLLED_CLOSE_ONLY' },
        pi: { closeOwned: async () => { throw Error('CONTROLLED_CLOSE_REJECTION'); } }, completed: Date.now(), used: Date.now(), state: 'retained' });
    await assert.rejects(controller.setConversationModelChoice({ conversationId: targetId, expectedGeneration: view.generation, expectedRevision: chosen.revision,
        choice: { kind: 'managed', provider: 'choice-fixture', modelId: 'beta', thinkingLevel: 'off' } }), /CONTROLLED_CLOSE_REJECTION/);
    assert.deepEqual(controller.getConversationModelChoice(targetId), chosen);
    assert.equal(controller.inspectConversation(targetId).completedResource.state, 'UNKNOWN');
    assert.equal(controller.inspectConversation(targetId).state, 'UNKNOWN');
    await assert.rejects(controller.close(), /Completed cleanup remains UNKNOWN|Completed resource cleanup UNKNOWN/);
} finally { /* Injected UNKNOWN intentionally retains the owner until this isolated worker exits. */ }
assert.equal(await fs.readFile(stock, 'utf8'), '{"defaultModel":"WRONG_STOCK_MODEL"}');
console.log(JSON.stringify({ outcome: 'passed', syntheticDispatches: requests.length, services: 0, closeFailure: 'controlled-close-only-injection', roleExecution: 'pending' }));

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationSettings } from '../../dist/app/settings.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { captureNativeModelSelection, modelConfigurationIdentity } from '../../dist/pi/model-identity.js';

initializeApplicationEnvironment();
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('No fetch in preference fixture'); };
net.Socket.prototype.connect = function () { networkAttempts++; throw Error('No socket in preference fixture'); };
const root = process.argv[2], home = path.join(root, 'app'), project = path.join(root, 'project'), state = path.join(root, 'pi-state');
for (const folder of [project, state, path.join(project, '.gitjig')]) await fs.mkdir(folder, { mode: 0o700 });
const stockFile = path.join(root, 'stock/settings.json'), stock = '{"steeringMode":"one-at-a-time","followUpMode":"all"}';
await fs.writeFile(stockFile, stock, { mode: 0o600 });
const host = await initializePiHost({ stateRoot: state, artifactRoot: path.join(root, 'artifacts') });
const operations = { workspaceRoot: project, validatePath: value => path.resolve(project, value), async exec() { throw Error('No execution'); }, async readFile() { throw Error('No read'); }, async access() {}, async writeFile() { throw Error('No write'); }, async mkdir() { throw Error('No mkdir'); } };
const controller = await openController({ installationHome: home }), settings = ApplicationSettings.open(controller), models = new ApplicationModels(controller), sessions = [];
const open = async model => { const pi = await createPiSession({ host, operations, model, systemPrompt: 'Queue-selection fixture only.', maxReadBytes: 1024 }); sessions.push(pi); return pi; };
const assertQueue = (pi, steeringMode, followUpMode) => {
    assert.equal(pi.session.steeringMode, steeringMode); assert.equal(pi.session.followUpMode, followUpMode);
    assert.equal(pi.session.agent.steeringMode, steeringMode); assert.equal(pi.session.agent.followUpMode, followUpMode);
    for (const [method, mode] of [['steer', steeringMode], ['followUp', followUpMode]]) {
        pi.session.agent.clearAllQueues();
        const messages = ['first', 'second'].map(value => ({ role: 'user', content: method + '-' + value, timestamp: Date.now() }));
        for (const message of messages) pi.session.agent[method](message);
        assert.deepEqual(pi.session.agent.peekQueuedMessages(), mode === 'all' ? messages : messages.slice(0, 1));
        assert.deepEqual(pi.session.agent.peekQueuedMessages(), mode === 'all' ? messages : messages.slice(0, 1), 'Peek must not consume');
    }
    pi.session.agent.clearAllQueues();
};
try {
    await ApplicationAccounts.open(controller).configure({ providers: { 'prefs-fixture': { api: 'openai-completions', apiKey: 'DUMMY_PREFS', baseUrl: 'http://127.0.0.1:9/v1',
        models: [{ id: 'alpha', contextWindow: 8192, maxTokens: 256 }, { id: 'beta', contextWindow: 8192, maxTokens: 256 }] } } });
    await ApplicationAccounts.open(controller).setDefault('prefs-fixture', 'alpha');
    await settings.setPreference('steeringMode', 'all'); await settings.setPreference('followUpMode', 'one-at-a-time');
    const appConversation = await models.newConversation(), appSelection = await models.resolve(appConversation.conversationId), app = await open(appSelection);
    assertQueue(app, 'all', 'one-at-a-time');
    await controller.registerProject({ id: 'P', sourceRoot: project });
    await fs.writeFile(path.join(project, '.gitjig/settings.json'), '{"steeringMode":"one-at-a-time","followUpMode":"all"}', { mode: 0o600 });
    const target = await models.newConversation({ projectId: 'P' });
    assert.deepEqual((await models.resolve(target.conversationId)).sessionPreferences, { steeringMode: 'all', followUpMode: 'one-at-a-time' });
    settings.approveProject('P'); const projectSelection = await models.resolve(target.conversationId), scoped = await open(projectSelection);
    assertQueue(scoped, 'one-at-a-time', 'all');
    await models.setRole('reviewer', await models.choice('prefs-fixture', 'beta'));
    const role = await models.resolveRole('reviewer', projectSelection);
    assert.equal(role.modelId, 'beta'); assert.deepEqual(role.sessionPreferences, projectSelection.sessionPreferences);
    assertQueue(await open(role), 'one-at-a-time', 'all'); // Factory proof, not governed-role launch.
    const caller = { ...appSelection, sessionPreferences: { steeringMode: 'all', followUpMode: 'all' } };
    const captured = captureNativeModelSelection(caller), pending = open(caller);
    caller.sessionPreferences.steeringMode = 'one-at-a-time'; caller.sessionPreferences.followUpMode = 'one-at-a-time';
    assert.deepEqual(captured.sessionPreferences, { steeringMode: 'all', followUpMode: 'all' }); assertQueue(await pending, 'all', 'all');
    assert.notDeepEqual(modelConfigurationIdentity(caller), modelConfigurationIdentity(captured));
    const borrowed = { provider: appSelection.provider, modelId: appSelection.modelId, runtime: app.modelRuntime, sessionPreferences: { steeringMode: 'all', followUpMode: 'all' } };
    const borrowedCapture = captureNativeModelSelection(borrowed); borrowed.sessionPreferences.steeringMode = 'one-at-a-time';
    assert.equal(borrowedCapture.runtime, app.modelRuntime); assert.equal(borrowedCapture.sessionPreferences.steeringMode, 'all');
    for (const sessionPreferences of [null, {}, { steeringMode: 'all' }, { steeringMode: 'invalid', followUpMode: 'all' }, { steeringMode: 'all', followUpMode: 'all', authority: true }]) {
        assert.throws(() => captureNativeModelSelection({ ...appSelection, sessionPreferences }), /preferences|preference/);
        await assert.rejects(open({ ...appSelection, sessionPreferences }), /preferences|preference/);
    }
    await settings.setPreference('steeringMode', 'one-at-a-time'); await settings.setPreference('followUpMode', 'all');
    assertQueue(app, 'all', 'one-at-a-time'); assertQueue(await open(await models.resolve(appConversation.conversationId)), 'one-at-a-time', 'all');
    const legacy = { provider: 'legacy-prefs', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_LEGACY_PREFS', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } };
    assert.equal(await models.resolveRole('reviewer', legacy), legacy); assertQueue(await open(legacy), 'one-at-a-time', 'one-at-a-time');
    const explicit = { ...legacy, sessionPreferences: { steeringMode: 'all', followUpMode: 'all' } }, snap = captureNativeModelSelection(explicit);
    explicit.sessionPreferences.steeringMode = 'one-at-a-time'; assertQueue(await open(snap), 'all', 'all');
    const closedOwner = {}, bridgeShape = { provider: 'closed-shape', modelId: 'shape-only', sessionPreferences: { steeringMode: 'all', followUpMode: 'all' } };
    Object.defineProperty(bridgeShape, 'bridge', { value: closedOwner, enumerable: false });
    const shapeCapture = captureNativeModelSelection(bridgeShape);
    assert.equal(shapeCapture.bridge, closedOwner); assert.equal(Object.getOwnPropertyDescriptor(shapeCapture, 'bridge').enumerable, false);
    assert.equal((await models.resolveRole('reviewer', bridgeShape)).bridge, closedOwner); // Descriptor capture only, not real bridge qualification.
    await controller.queueConversationInput({ conversationId: appConversation.conversationId, expectedGeneration: 0, text: 'Retained pending input', mode: 'idle' });
    assert.throws(() => controller.beginApplicationMutation(), /Settle active/); assertQueue(app, 'all', 'one-at-a-time');
    assert.equal(settings.inspect().global.steeringMode, 'one-at-a-time');
    assert.equal(await fs.readFile(stockFile, 'utf8'), stock); assert.equal(networkAttempts, 0);
} finally { for (const session of sessions) await session.closeOwned(); await controller.close(); }
console.log(JSON.stringify({ outcome: 'passed', modelRequests: 0, networkAttempts }));

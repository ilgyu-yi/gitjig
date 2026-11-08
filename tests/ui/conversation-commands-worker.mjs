import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { conversationCommands } from '../../dist/ui/conversation-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

initializeApplicationEnvironment();
const root = process.argv[2], home = path.join(root, 'app'); let requests = 0, socketAttempts = 0;
net.Socket.prototype.connect = function () { socketAttempts++; throw Error('No socket in conversation command fixture'); };
globalThis.fetch = async (_url, options) => {
    assert.ok(requests < 2, 'Two original-codec setup turn ceiling'); requests++;
    const body = JSON.parse(options.body);
    return wireResponse('openai-completions', body.model, { text: 'GENUINE_COPY_TARGET_' + requests });
};
let controller = await openController({ installationHome: home });
let a, b, named;
try {
    const accounts = ApplicationAccounts.open(controller), models = new ApplicationModels(controller);
    await accounts.configure({ providers: { 'copy-fixture': { api: 'openai-completions', apiKey: 'DUMMY_COMMAND_KEY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'owned', contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('copy-fixture', 'owned'); a = await models.newConversation(); b = await models.newConversation();
    models.install({resumeAuthorized:false});
    for (const target of [a, b]) {
        await controller.queueConversationInput({ conversationId: target.conversationId, expectedGeneration: target.generation, text: 'Owned source history setup', mode: 'idle' });
        assert.equal((await controller.runConversation({ conversationId: target.conversationId, ...models.conversationOperation(target.conversationId) })).status, 'delivered');
        assert.ok((await controller.getConversationHistory(target.conversationId)).sessionManager.buildSessionProjection().messages.some(message => message.role === 'assistant'));
    }
    // Non-authority metadata canaries only; no forged role/run/checkpoint standing.
    named = controller.createConversation();
    const before = { role: 'reviewer', purpose: 'Visible role attribution', modelChoice: { kind: 'unbound', revision: 1, reason: 'Select a model' }, origin: { source: 'metadata-fixture' }, privateCanary: 'PRIVATE_SESSION_CANARY', obligationCanary: ['untouched'] };
    controller.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(before), named.conversationId);
    const afterName = controller.setConversationName({ conversationId: named.conversationId, expectedGeneration: 0, name: 'owner' });
    assert.match(afterName.label, /^reviewer · Visible role attribution · owner$/); assert.equal(afterName.role, 'reviewer');
    const row = JSON.parse(controller.store.one('SELECT data FROM conversation_state WHERE conversation=?', named.conversationId).data); delete row.userLabel; assert.deepEqual(row, before);
    for (const name of ['', 'a\nb', '\nname', 'name\t', '\x1b[31m', 'x'.repeat(121)]) assert.throws(() => controller.setConversationName({ conversationId: named.conversationId, expectedGeneration: 0, name }), /name/);
    assert.throws(() => controller.setConversationName({ conversationId: named.conversationId, expectedGeneration: 1, name: 'stale' }), /Stale/);
} finally { await controller.close(); }
controller = await openController({ installationHome: home });
try {
    assert.equal(controller.inspectConversation(named.conversationId).userLabel, 'owner');
    const copied = [], notices = []; let chosen, labels, entered;
    const registry = new HostCommands(conversationCommands({ controller, resume: async () => 'cancelled', choose: async (_title, values) => { labels = values; return chosen; }, input: async () => entered,
        copy: async text => { copied.push(text); }, notice: text => notices.push(text) }));
    assert.equal(await registry.execute('/name', named.conversationId), 'cancelled'); assert.equal(controller.inspectConversation(named.conversationId).userLabel, 'owner');
    assert.equal(await registry.execute('/session', named.conversationId), 'cancelled'); assert.match(labels.join('\n'), /Role · reviewer/); assert.doesNotMatch(labels.join('\n'), /PRIVATE_SESSION_CANARY|metadata-fixture|DUMMY_COMMAND_KEY|Owned source history setup|\/artifacts|auth\.json/);
    chosen = labels[0]; assert.equal(await registry.execute('/session', named.conversationId), 'completed');
    await registry.execute('/copy', a.conversationId); await registry.execute('/copy', b.conversationId);
    assert.deepEqual(copied, ['GENUINE_COPY_TARGET_1', 'GENUINE_COPY_TARGET_2']);
    await assert.rejects(registry.execute('/copy', named.conversationId), /no native history/);
    const failing = new HostCommands(conversationCommands({ controller, resume: async () => 'cancelled', choose: async () => undefined, input: async () => undefined,
        copy: async () => { throw Error('CONTROLLED_CLIPBOARD_FAILURE'); }, notice: () => assert.fail('Writer failure reported success') }));
    await assert.rejects(failing.execute('/copy', a.conversationId), /CONTROLLED_CLIPBOARD_FAILURE/);
    const read = controller.getConversationHistory.bind(controller);
    controller.getConversationHistory = async id => { const result = await read(id); await controller.archiveConversation({ conversationId: id, expectedGeneration: controller.inspectConversation(id).generation }); return result; };
    await assert.rejects(registry.execute('/copy', b.conversationId), /history changed/); assert.equal(copied.length, 2);
    controller.getConversationHistory = read;
    await controller.archiveConversation({ conversationId: named.conversationId, expectedGeneration: 0 });
    assert.throws(() => controller.setConversationName({ conversationId: named.conversationId, expectedGeneration: 0, name: 'archived' }), /ARCHIVED/);
    assert.equal(requests, 2); assert.equal(socketAttempts, 0);
} finally { await controller.close(); }
console.log(JSON.stringify({ outcome: 'passed', syntheticRequests: requests, socketAttempts }));

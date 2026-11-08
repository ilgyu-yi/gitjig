import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { createPiSession, initializePiHost } from '../../dist/pi/index.js';
import { recordedSessionUsage } from '../../dist/ui/session-usage.js';
import { conversationCommands } from '../../dist/ui/conversation-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { seedForkUI } from './fork-fixture.mjs';

initializeApplicationEnvironment();
let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('No requests in historical usage fixture'); };
net.Socket.prototype.connect = function () { requests++; throw Error('No sockets in historical usage fixture'); };
const root = process.argv[2], home = path.join(root, 'app'), workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { mode: 0o700 });
let controller = await openController({ installationHome: home }), native;
const usage = (n = 1) => ({ input: 2 * n, output: 3 * n, cacheRead: 5 * n, cacheWrite: 7 * n, totalTokens: 17 * n,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 * n } });
const assistant = (n, content = [{ type: 'text', text: 'NON_AUTHORITY_FIXTURE' }]) => ({ role: 'assistant', api: 'openai-completions', provider: 'history-fixture', model: 'fixed', timestamp: Date.now(), usage: usage(n), stopReason: 'stop', content });
try {
    const seeded = await seedForkUI(controller, workspace, home), cid = seeded.source.conversationId;
    // Append original SDK entries, never a generated turn or successful run/checkpoint.
    const manager = SessionManager.open(seeded.file), anchor = manager.getLeafId();
    manager.appendMessage(assistant(1, [{ type: 'toolCall', id: 'call', name: 'read', arguments: {} }]));
    manager.appendMessage({ role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'fixture' }], isError: false, timestamp: Date.now(), usage: usage(2) });
    manager.appendUsage('fixture', 'history-fixture', 'fixed', usage(3));
    manager.appendCompaction('fixture compaction', anchor, 17, undefined, false, usage(4));
    manager.branchWithSummary(manager.getLeafId(), 'fixture branch', undefined, false, usage(5));
    manager.appendMessage(assistant(6)); // An abandoned branch must still be counted.
    manager.branch(anchor);
    manager.appendMessage(assistant(7));
    const host = await initializePiHost({ stateRoot: path.join(home, 'state'), artifactRoot: path.join(home, 'artifacts') });
    const forbidden = async () => { throw Error('No project operations in read-only fixture'); };
    native = await createPiSession({ host, sessionManager: manager, operations: { workspaceRoot: workspace, validatePath: p => path.resolve(workspace, p),
        exec: forbidden, readFile: forbidden, access: forbidden, writeFile: forbidden, mkdir: forbidden },
        model: { provider: 'history-fixture', modelId: 'fixed', definition: { api: 'openai-completions', apiKey: 'DUMMY_HISTORY_ONLY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'fixed', contextWindow: 8192, maxTokens: 256 }] } },
        systemPrompt: 'Non-authority native stats fixture. No generation.', maxReadBytes: 1024 });
    const actual = native.session.getSessionStats(), reduced = recordedSessionUsage(native.sessionManager.getEntries());
    for (const key of ['userMessages', 'assistantMessages', 'toolResults', 'totalMessages', 'toolCalls', 'tokens', 'cost']) assert.deepEqual(reduced[key], actual[key], key);
    assert.equal(reduced.tokens.total, 476); assert.equal(reduced.cost, 7); assert.equal(reduced.records, 7);
    assert.equal(reduced.assistantMessages, 3); assert.equal(reduced.toolCalls, 1); assert.equal(reduced.toolResults, 1);
    await native.closeOwned(); native = undefined;
    const raw = await fs.readFile(seeded.file);
    await controller.close(); controller = await openController({ installationHome: home });
    const beforeView = controller.inspectConversation(cid), beforeChoice = controller.getConversationModelChoice(cid);
    let labels, chosen;
    const registry = new HostCommands(conversationCommands({ controller, resume: async () => 'cancelled', fork: async () => 'cancelled',
        choose: async (_title, values) => { labels = values; return chosen; }, input: async () => undefined, copy: forbidden, notice() {} }));
    assert.equal(await registry.execute('/session', cid), 'cancelled');
    assert.match(labels.join('\n'), /476 total · 56 input · 84 output · 140 cache read · 196 cache write/);
    assert.match(labels.join('\n'), /Recorded cost · 7/); assert.match(labels.join('\n'), /including copied context/);
    assert.match(labels.join('\n'), /Current context · unavailable/);
    assert.doesNotMatch(labels.join('\n'), /DUMMY_HISTORY_ONLY|native-forks|fixture-native|\/state\/|NON_AUTHORITY_FIXTURE/);
    chosen = labels[0]; assert.equal(await registry.execute('/session', cid), 'completed');
    assert.deepEqual(controller.inspectConversation(cid), beforeView); assert.deepEqual(controller.getConversationModelChoice(cid), beforeChoice);
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM conversation_inputs').n, 0);
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM works').n, 0);
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
    assert.deepEqual(await fs.readFile(seeded.file), raw);
    const empty = controller.createConversation(); await registry.execute('/session', empty.conversationId);
    assert.match(labels.join('\n'), /Recorded usage · unavailable \(no native history\)/);
    // Real source read with a controlled asynchronous choice change must refuse before presentation.
    const read = controller.getConversationHistory.bind(controller); let shown = false;
    controller.getConversationHistory = async id => { const result = await read(id); await controller.setConversationModelChoice({ conversationId: id, expectedGeneration: 0, expectedRevision: 0, choice: { kind: 'unbound', reason: 'controlled drift' } }); return result; };
    const stale = new HostCommands(conversationCommands({ controller, resume: async () => 'cancelled', fork: async () => 'cancelled', choose: async () => { shown = true; }, input: async () => undefined, copy: forbidden, notice() {} }));
    await assert.rejects(stale.execute('/session', cid), /history or model changed/); assert.equal(shown, false);
    controller.getConversationHistory = read;
    assert.equal(requests, 0);
    await fs.writeFile(path.join(root, 'usage-receipt.json'), JSON.stringify({ outcome: 'passed', requests, originalStats: { tokens: actual.tokens, cost: actual.cost }, cid, file: seeded.file }));
} finally { if (native) await native.closeOwned(); await controller.close(); }
console.log(JSON.stringify({ outcome: 'passed', requests }));

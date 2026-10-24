import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openController } from '../../dist/controller/index.js';
import { lastAssistantText } from '../../dist/ui/conversation-commands.js';

test('original current-branch projection follows Pi last-assistant text semantics', () => {
    const history = SessionManager.inMemory('/');
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const message = (content, stopReason = 'stop') => ({ role: 'assistant', api: 'openai-completions', provider: 'owned', model: 'owned', timestamp: Date.now(), usage, stopReason, content });
    const first = history.appendMessage(message([{ type: 'text', text: ' first answer ' }]));
    history.appendMessage(message([{ type: 'text', text: 'ABANDONED_BRANCH' }])); history.branch(first);
    assert.equal(lastAssistantText(history.buildSessionProjection().messages), 'first answer');
    history.appendMessage(message([{ type: 'thinking', thinking: 'NOT_TEXT' }, { type: 'text', text: ' second ' }, { type: 'text', text: 'answer ' }]));
    history.appendMessage(message([], 'aborted')); assert.equal(lastAssistantText(history.buildSessionProjection().messages), 'second answer');
    history.appendMessage(message([{ type: 'toolCall', id: 'tool', name: 'read', arguments: { secret: 'NOT_TEXT' } }], 'toolUse'));
    assert.equal(lastAssistantText(history.buildSessionProjection().messages), undefined); assert.equal(lastAssistantText([]), undefined);
});

test('controller-owned names, session whitelist and copy use genuine settled checkpointed histories', { timeout: 8000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/conversation-commands-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained command world: ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/ui/conversation-commands-worker.mjs', root], {
        timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    });
    assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', syntheticRequests: 2, socketAttempts: 0 }); passed = true;
});

test('actual no-model UI awaits resume cancellation/selection and preserves target drafts and durable names', { timeout: 9000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/session-command-ui-'))), home = path.join(root, 'app');
    for (const folder of ['user', 'tmp']) await fs.mkdir(path.join(root, folder), { mode: 0o700 });
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained session command PTY: ' + root); });
    let controller = await openController({ installationHome: home });
    const a = controller.createConversation(), b = controller.createConversation();
    controller.setConversationParent({ parentId: a.conversationId, childId: b.conversationId, expectedRevision: 0 });
    controller.setConversationName({ conversationId: a.conversationId, expectedGeneration: 0, name: 'SOURCE' });
    controller.setConversationName({ conversationId: b.conversationId, expectedGeneration: 0, name: 'DEST' });
    controller.setDraft({ conversationId: b.conversationId, expectedRevision: 0, text: 'DESTINATION_KEEP' }); await controller.close();
    const run = async (name, steps) => {
        const file = path.join(root, name + '.json');
        await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home, '--conversation', a.conversationId],
            env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath), TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
            database: path.join(home, 'state/controller.sqlite'), expectedInputs: 0, timeoutSeconds: 3, steps, output: file + '.terminal' }), { mode: 0o600 });
        return JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 4000, maxBuffer: 1024 * 1024 })).stdout);
    };
    const steps = [
        { wait: 'Model: not selected', send: '/name\u001b\r\u001bOQ' },
        { wait: 'Conversation display name', assertDraft: '/name', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/name', send: '\u0015/name 한국 이름\u001b\r' },
        { wait: 'Conversation name saved', send: '/session\u001b\r' },
        { wait: 'Gitjig session · inspection only', assertDraft: '/session', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/session', send: '\u0015/resume\u001b\r' },
        { wait: 'Conversations', assertDraft: '/resume', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/resume', send: '\u0015/resume\u001b\r' },
        { wait: 'Conversations', assertDraft: '/resume', send: 'DEST\r' },
        { wait: 'DESTINATION_KEEP', assertDraft: 'DESTINATION_KEEP', expectedSelected: b.conversationId, send: '\u0015/resume ' + a.conversationId + '\u001b\r' },
        { wait: '한국 이름', assertDraft: '', expectedSelected: a.conversationId, send: '/resume DOES_NOT_EXIST\u001b\r' },
        { wait: 'Choose an accessible conversation with /resume', assertDraft: '/resume DOES_NOT_EXIST', send: '\u0015/copy\u001b\r' },
        { wait: 'No assistant text to copy', assertDraft: '/copy', send: '\u0015/quit\u001b\r' },
    ];
    const first = await run('first', steps); assert.equal(first.exitCode, 0); assert.equal(first.stages, steps.length); assert.equal(first.terminalRestored, true);
    controller = await openController({ installationHome: home });
    assert.equal(controller.inspectConversation(a.conversationId).userLabel, '한국 이름'); assert.equal(controller.inspectConversation(b.conversationId).draft.text, ''); await controller.close();
    const reset = await run('restart', [{ wait: '한국 이름', send: '/name --reset\u001b\r' }, { wait: 'Conversation name reset', send: '/quit\u001b\r' }]);
    assert.equal(reset.exitCode, 0); assert.equal(reset.stages, 2); assert.equal(reset.terminalRestored, true);
    controller = await openController({ installationHome: home });
    try { assert.equal(controller.inspectConversation(a.conversationId).userLabel, undefined); assert.equal(controller.inspectConversation(b.conversationId).userLabel, 'DEST'); } finally { await controller.close(); }
    const closing = await run('close-selector', [{ wait: 'Model: not selected', send: '/resume\u001b\r' }, { wait: 'Conversations', assertDraft: '/resume', terminate: true, send: '' }]);
    assert.equal(closing.exitCode, 0); assert.equal(closing.stages, 2); assert.equal(closing.terminalRestored, true);
    controller = await openController({ installationHome: home });
    try { assert.equal(controller.inspectConversation(a.conversationId).draft.text, '/resume'); } finally { await controller.close(); }
    passed = true;
});

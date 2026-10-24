import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { ApplicationSettings } from '../../dist/app/settings.js';

test('source TUI saves scoped/default/settings, cycles actual models and preserves failed/cancelled drafts', { timeout: 13000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/config-ui-'))), home = path.join(root, 'app');
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained configuration UI: ' + root); });
    for (const name of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    const stockFile = path.join(root, 'stock/settings.json'), stock = '{"theme":"system","defaultModel":"WRONG_STOCK_MODEL"}';
    await fs.writeFile(stockFile, stock, { mode: 0o600 });
    const controller = await openController({ installationHome: home });
    try {
        await ApplicationAccounts.open(controller).configure({ providers: { 'ui-fixture': { api: 'openai-completions', apiKey: 'DUMMY_UI_SELECTED', baseUrl: 'http://127.0.0.1:9/v1', models: [
            { id: 'alpha', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 },
            { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } });
    } finally { await controller.close(); }
    const receipt = path.join(root, 'requests.json'), file = path.join(root, 'pty.json');
    const steps = [
        { wait: 'Model: not selected', send: '/model-next\u001b\r' },
        { wait: 'Configure a valid cycling pool', assertDraft: '/model-next', send: '\u0015/model-default ui-fixture/alpha\u001b\r' },
        { wait: 'Default model saved for new conversations', assertDraft: '', expectedChoice: { kind: 'unbound' }, send: '/scoped-models\u001b\r' },
        { wait: 'Application model scope', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/scoped-models', send: '\u0015/scoped-models ["ui-fixture/alpha:high","ui-fixture/beta"]\u001b\r' },
        { wait: 'Model scope saved', send: '/model-next\u001b\r' },
        { wait: 'Next scoped model selected', send: 'FIRST_ALPHA_MODEL\r' },
        { wait: 'SYNTHETIC_UI_MANAGED_COMPLETE_1', waitIdle: true, send: '/model-next\u001b\r' },
        { wait: 'Next scoped model selected', send: 'SECOND_BETA_MODEL\r' },
        { wait: 'SYNTHETIC_UI_MANAGED_COMPLETE_2', waitIdle: true, send: '/settings editorPaddingX 2\u001b\r' },
        { wait: 'Saved application preference: editorPaddingX', send: '/settings theme "light"\u001b\r' },
        { wait: 'Saved application preference: theme', send: '/settings hideThinkingBlock "wrong"\u001b\r' },
        { wait: 'Unsupported preference or invalid value', assertDraft: '/settings hideThinkingBlock "wrong"', expectedInputs: 2, send: '\u0015/settings hideThinkingBlock\u001b\r' },
        { wait: 'hideThinkingBlock · application false · effective source product default', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/settings hideThinkingBlock', expectedInputs: 2, expectedChoice: { modelId: 'beta', thinkingLevel: 'off' }, send: '\u0015/hotkeys\u001b\r' },
        { wait: 'F2 · conversations', send: '\r' },
        { wait: 'Keybindings closed', send: '/reload\u001b\r' },
        { wait: 'Application presentation reloaded', send: '/quit\u001b\r' },
    ];
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'),
        GITJIG_UI_WIRE_FILE: receipt, TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/managed-ui-wire.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home], env,
        steps, timeoutSeconds: 7, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal' }), { mode: 0o600 });
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 9000, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
    const requests = JSON.parse(await fs.readFile(receipt, 'utf8')); assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(request => request.model), ['alpha', 'beta']); assert.equal(requests[0].thinking, 'high'); assert.equal(requests[1].thinking, undefined);
    assert.ok(requests.every(request => request.authorization === 'Bearer DUMMY_UI_SELECTED'));
    const reopened = await openController({ installationHome: home });
    try {
        const [view] = reopened.listConversations(), settings = ApplicationSettings.open(reopened).inspect();
        assert.equal(reopened.getConversationModelChoice(view.conversationId).modelId, 'beta');
        assert.equal(settings.global.defaultModel, 'alpha'); assert.equal(settings.global.editorPaddingX, 2); assert.equal(settings.global.theme, 'light');
        assert.equal(settings.global.hideThinkingBlock, undefined);
        const history = await fs.readFile(view.historyRef, 'utf8'); assert.match(history, /FIRST_ALPHA_MODEL/); assert.match(history, /SECOND_BETA_MODEL/);
        const next = await new ApplicationModels(reopened).newConversation();
        assert.equal(reopened.getConversationModelChoice(next.conversationId).modelId, 'alpha'); assert.equal(reopened.getConversationModelChoice(next.conversationId).thinkingLevel, 'high');
    } finally { await reopened.close(); }
    assert.equal(await fs.readFile(stockFile, 'utf8'), stock); passed = true;
});

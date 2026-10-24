import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';

test('actual source CLI starts without profile/engine, retains setup draft and binds managed model', { timeout: 14000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/managed-ui-'))), home = path.join(root, 'app');
    for (const name of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    const stock = path.join(root, 'stock/settings.json'); await fs.writeFile(stock, '{"defaultModel":"WRONG_STOCK_MODEL"}', { mode: 0o600 });
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained UI fixture: ' + root); });
    const controller = await openController({ installationHome: home });
    try {
        await ApplicationAccounts.open(controller).configure({ providers: { 'ui-fixture': { api: 'openai-completions', apiKey: 'DUMMY_UI_SELECTED', baseUrl: 'http://127.0.0.1:9/v1',
            models: [{ id: 'alpha', reasoning: true, compat: { supportsReasoningEffort: true }, contextWindow: 8192, maxTokens: 256 }] } } });
    } finally { await controller.close(); }
    const receipt = path.join(root, 'requests.json'), file = path.join(root, 'pty.json');
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'),
        GITJIG_UI_WIRE_FILE: receipt, TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
    const steps = [
        { wait: 'Model: not selected', send: 'KEEP_SETUP_DRAFT\r' },
        { wait: 'Choose a model with /model', assertDraft: 'KEEP_SETUP_DRAFT', send: '\u0015/unknown-host-command\r' },
        { wait: 'Unknown command; use /help', assertDraft: '/unknown-host-command', send: '\u0015/hel' },
        { wait: 'Show available Gitjig commands', send: '\r' },
        { wait: 'Close', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/help ', expectedChoice: { kind: 'unbound', revision: 1 }, send: '\u0015/mod' },
        { wait: 'Select this conversation model', send: '\r' },
        { wait: 'Model for this conversation', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/model ', expectedChoice: { kind: 'unbound', revision: 1 }, send: '\u0015/model ui-fixture/alpha\u001b\r' },
        { wait: 'Model selected for this conversation', send: '/think' },
        { wait: 'Set this conversation reasoning level', send: '\r' },
        { wait: 'Thinking level (unsupported levels are clamped by Pi)', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/thinking ', expectedChoice: { modelId: 'alpha', thinkingLevel: 'off', revision: 2 }, send: '\u0015/thinking high\u001b\r' },
        { wait: 'Thinking: high', send: '//literal leading slash\r' },
        { wait: 'SYNTHETIC_UI_MANAGED_COMPLETE_1', send: '/tre' },
        { wait: 'Browse current conversation history', send: '\r' },
        { wait: 'Session Tree', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/tree ', expectedInputs: 1, expectedChoice: { modelId: 'alpha', thinkingLevel: 'high', revision: 3 }, send: '\u0015/quit\u001b\r' },
    ];
    await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/managed-ui-wire.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home],
        env, steps, database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal' }), { mode: 0o600 });
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 12000, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
    assert.equal(result.alternateEntered, true); assert.equal(result.alternateExited, true);
    const requests = JSON.parse(await fs.readFile(receipt, 'utf8'));
    assert.equal(requests.length, 1); assert.equal(requests[0].model, 'alpha'); assert.equal(requests[0].thinking, 'high');
    assert.equal(requests[0].authorization, 'Bearer DUMMY_UI_SELECTED');
    const prompt = requests[0].messages.filter(message => message.role === 'user').at(-1);
    const inputText = typeof prompt.content === 'string' ? prompt.content : prompt.content.filter(item => item.type === 'text').map(item => item.text).join('');
    assert.equal(inputText, '/literal leading slash');
    const reopened = await openController({ installationHome: home });
    try {
        const [conversation] = reopened.listConversations();
        assert.equal(reopened.getConversationModelChoice(conversation.conversationId).thinkingLevel, 'high');
        const inputs = reopened.store.all('SELECT text FROM conversation_inputs');
        assert.ok(!JSON.stringify(inputs).includes('KEEP_SETUP_DRAFT')); assert.ok(!JSON.stringify(inputs).includes('unknown-host-command'));
        const projectRoot = path.join(root, 'project'); await fs.mkdir(projectRoot, { mode: 0o700 });
        await reopened.registerProject({ id: 'no-engine', sourceRoot: projectRoot });
        const project = reopened.createConversation({ projectId: 'no-engine' });
        await reopened.setConversationModelChoice({ conversationId: project.conversationId, expectedGeneration: 0, expectedRevision: 0,
            choice: { kind: 'managed', provider: 'ui-fixture', modelId: 'alpha', thinkingLevel: 'off' } });
        const external = reopened.createConversation();
        await reopened.setConversationModelChoice({ conversationId: external.conversationId, expectedGeneration: 0, expectedRevision: 0,
            choice: { kind: 'legacy-external', provider: 'ui-fixture', modelId: 'external-B' } });
        await fs.writeFile(path.join(root, 'targets.json'), JSON.stringify({ project: project.conversationId, external: external.conversationId }));
    } finally { await reopened.close(); }
    const targets = JSON.parse(await fs.readFile(path.join(root, 'targets.json'), 'utf8'));
    const externalProfile = path.join(root, 'external-A.json');
    await fs.writeFile(externalProfile, JSON.stringify({ provider: 'ui-fixture', modelId: 'external-A', definition: {
        api: 'openai-completions', apiKey: 'DUMMY_EXTERNAL_NOT_SELECTED', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'external-A', reasoning: false,
            input: ['text'], contextWindow: 8192, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } }), { mode: 0o600 });
    for (const kind of ['project', 'external']) {
        const input = kind === 'project' ? 'KEEP_PROJECT_DRAFT' : 'KEEP_EXTERNAL_DRAFT';
        const check = path.join(root, kind + '.json');
        await fs.writeFile(check, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/managed-ui-wire.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home,
            '--conversation', targets[kind], ...(kind === 'external' ? ['--model-profile', externalProfile] : [])], env,
            steps: [{ wait: kind === 'project' ? 'Model: alpha' : 'external profile required', send: input + '\r' },
                { wait: kind === 'project' ? 'Project execution requires an explicit runtime profile' : 'requires its matching explicit external model profile', assertDraft: input, send: '\u0015/quit\r' }],
            database: path.join(home, 'state/controller.sqlite'), expectedInputs: 1, output: check + '.terminal' }), { mode: 0o600 });
        const outcome = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', check], { timeout: 12000, maxBuffer: 1024 * 1024 })).stdout);
        assert.equal(outcome.exitCode, 0); assert.equal(outcome.stages, 2); assert.equal(outcome.terminalRestored, true);
        assert.equal(JSON.parse(await fs.readFile(receipt, 'utf8')).length, 1, 'Prerequisite refusal must not dispatch');
    }
    assert.equal(await fs.readFile(stock, 'utf8'), '{"defaultModel":"WRONG_STOCK_MODEL"}'); passed = true;
});

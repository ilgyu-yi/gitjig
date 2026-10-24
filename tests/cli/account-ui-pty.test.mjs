import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('actual TUI original API-key login/status/logout and Esc/Ctrl+D protect secrets and app ownership', { timeout: 15000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/account-ui-')));
    for (const name of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    const stock = path.join(root, 'stock/auth.json'), stockBytes = '{"openai":{"type":"api_key","key":"DUMMY_STOCK_UNSELECTED"}}';
    await fs.writeFile(stock, stockBytes, { mode: 0o600 });
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained account UI fixture: ' + root); });
    for (const mode of ['success-cancel', 'leave', 'reject']) {
        const home = path.join(root, mode), controller = await openController({ installationHome: home }); await controller.close();
        const secret = mode === 'reject' ? '!DUMMY_FORBIDDEN_HELPER_NO_ECHO' : mode === 'leave' ? 'DUMMY_TUI_CANCEL_NO_ECHO' : 'DUMMY_TUI_SUCCESS_NO_ECHO', file = path.join(root, mode + '.json');
        const steps = mode === 'reject' ? [
            { wait: 'Model: not selected', send: '/login openai api_key\u001b\r' },
            { wait: 'Secret input (hidden)', send: secret },
            { wait: '••••', assertStored: false, send: '\r' },
            { wait: 'Account operation failed; inspect application account state', assertDraft: '/login openai api_key', assertStored: false, send: '\u0015/quit\u001b\r' },
        ] : mode === 'leave' ? [
            { wait: 'Model: not selected', send: '/login openai api_key\u001b\r' },
            { wait: 'Secret input (hidden)', send: secret },
            { wait: '••••', assertStored: false, send: '\u0004' },
        ] : [
            { wait: 'Model: not selected', send: '/login openai api_key\u001b\r' },
            { wait: 'Secret input (hidden)', send: secret },
            { wait: '••••', assertStored: false, send: '\r' },
            { wait: 'Account login stored', assertStored: true, send: '/accounts\u001b\r' },
            { wait: 'openai · stored api_key', assertStored: true, send: '\r' },
            { wait: 'Account status closed', send: '/logout openai\u001b\r' },
            { wait: 'Account logout stored', assertStored: false, send: '/login openai\u001b\r' },
            { wait: 'Login method', send: '\u001b' },
            { wait: 'Command cancelled; draft kept', assertDraft: '/login openai', assertStored: false, send: '\u0015/login openai api_key\u001b\r' },
            { wait: 'Secret input (hidden)', send: 'DUMMY_ESC_CANCEL_NO_ECHO' },
            { wait: '••••', assertStored: false, send: '\u001b' },
            { wait: 'Account login cancelled; current stored credential: none', assertDraft: '/login openai api_key', assertStored: false, send: '\u0015/quit\u001b\r' },
        ];
        const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'),
            TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '', OPENAI_API_KEY: 'DUMMY_AMBIENT_UNSELECTED' };
        await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home],
            env, steps, secret, timeoutSeconds: 5, authFile: path.join(home, 'config/auth.json'), database: path.join(home, 'state/controller.sqlite'), output: file + '.terminal' }), { mode: 0o600 });
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', file], { timeout: 7000, maxBuffer: 1024 * 1024 })).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        assert.equal(result.alternateEntered, true); assert.equal(result.alternateExited, true);
        const output = await fs.readFile(file + '.terminal', 'utf8');
        for (const value of [secret, 'DUMMY_ESC_CANCEL_NO_ECHO', 'DUMMY_STOCK_UNSELECTED', 'DUMMY_AMBIENT_UNSELECTED']) assert.ok(!output.includes(value), 'Sensitive input/source must never appear in terminal frames');
        const reopened = await openController({ installationHome: home });
        try {
            const [conversation] = reopened.listConversations(); assert.equal(reopened.store.all('SELECT id FROM conversation_inputs').length, 0);
            assert.equal(reopened.getConversationModelChoice(conversation.conversationId).kind, 'unbound');
            assert.ok(!(await fs.readFile(path.join(home, 'state/controller.sqlite'))).includes(Buffer.from(secret)));
        } finally { await reopened.close(); }
    }
    assert.equal(await fs.readFile(stock, 'utf8'), stockBytes); passed = true;
});

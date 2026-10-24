import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('actual CLI secret login and Ctrl+C restore the terminal without echo or Pi sharing', { timeout: 15000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/account-terminal-')));
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained terminal fixture: ' + root); });
    for (const folder of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, folder), { mode: 0o700 });
    const secret = 'DUMMY_TERMINAL_SECRET_NO_ECHO';
    for (const cancel of [false, true, 'eof']) {
        const name = cancel === 'eof' ? 'eof' : cancel ? 'cancel' : 'success';
        const home = path.join(root, name), file = path.join(root, name + '.json');
        const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'),
            TERM: 'xterm-256color', LANG: 'C.UTF-8', OPENAI_API_KEY: 'DUMMY_AMBIENT_NOT_SELECTED', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
        await fs.writeFile(file, JSON.stringify({ command: [process.execPath, '--import', './tests/normal-hosted/no-external.mjs', 'dist/cli/main.js', 'auth', 'login', '--home', home, '--provider', 'openai', '--method', 'api_key'], env, secret, cancel, output: file + '.result' }), { mode: 0o600 });
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/app/account-terminal.py', file], { timeout: 10000, maxBuffer: 1024 * 1024 })).stdout);
        assert.equal(result.sent, true); assert.equal(result.secretVisible, false); assert.equal(result.terminalRestored, true);
        assert.equal(result.exitCode, cancel ? 2 : 0);
        const auth = JSON.parse(await fs.readFile(path.join(home, 'config/auth.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; }));
        if (cancel) assert.equal(auth.openai, undefined);
        else assert.equal(auth.openai.key, secret);
    }
    assert.deepEqual(await fs.readdir(path.join(root, 'stock')), []);
    passed = true;
});

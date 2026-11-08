import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('actual native prompt and terminal hook wait behind the original setup command', { timeout: 22000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-native-modal-ownership-')));
    const home = path.join(root, 'home'), file = path.join(root, 'fixture.json');
    const config = { home, control: path.join(root, 'current.json'), receipt: path.join(root, 'receipt.json'),
        gate: path.join(root, 'inspect-gate'), draft: '  KEEP 한국어 exact unsent native request  ', output: path.join(root, 'terminal.output') };
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, { recursive: true, force: true });
        else t.diagnostic('Retained actual native modal terminal ' + root);
    });
    await fs.writeFile(file, JSON.stringify({ ...config,
        command: [process.execPath, path.resolve('tests/ui/native-modal-ownership-pty-child.mjs'), file],
        env: { PATH: path.dirname(process.execPath), HOME: root, TMPDIR: root,
            TERM: 'xterm-256color', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    }), { mode: 0o600 });
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/native-modal-ownership-pty.py', file], {
        timeout: 19000, maxBuffer: 2 ** 20,
    })).stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.terminalRestored, true);
    assert.equal(result.stages, 9);
    const receipt = JSON.parse(await fs.readFile(config.receipt, 'utf8'));
    assert.equal(receipt.answer, true);
    assert.equal(receipt.hookCalls, 1);
    assert.equal(receipt.requestCalls, 1);
    assert.equal(receipt.nativeRequests, 1);
    assert.equal(receipt.draft, config.draft);
    assert.equal(receipt.state, 'IDLE');
    passed = true;
});

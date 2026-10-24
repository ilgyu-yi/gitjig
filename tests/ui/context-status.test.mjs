import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('actual context inspection and restarted source session picker preserve attribution, bounds and cancellation', { timeout: 8000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-status-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 }); const setup = await openController({ installationHome: home }); await setup.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained context status world: ' + root); });
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' };
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/ui/context-status-worker.mjs', root], { timeout: 5000, maxBuffer: 1024 * 1024, env });
    assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', requests: 0 });
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'status-receipt.json'), 'utf8'));
    const config = path.join(root, 'pty.json'), steps = [
        { wait: 'Model: not selected', send: '/session\u001b\r' },
        { wait: 'Gitjig session · inspection only', assertDraft: '/session', send: 'different' },
        { wait: 'File · "file.txt" · different', assertDraft: '/session', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/session', send: '\u0015/session\u001b\r' },
        { wait: 'Gitjig session · inspection only', assertDraft: '/session', send: 'missing' },
        { wait: 'File · "gone.txt" · missing', assertDraft: '/session', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/session', send: '\u0015/quit\u001b\r' },
    ];
    await fs.writeFile(config, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home, '--conversation', receipt.cid], env: { ...env, TERM: 'xterm-256color' },
        database: path.join(home, 'state/controller.sqlite'), expectedInputs: receipt.inputs, timeoutSeconds: 2.5, steps, output: config + '.terminal' }));
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', config], { timeout: 3500, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
    const transcript = await fs.readFile(config + '.terminal', 'utf8'); assert.doesNotMatch(transcript, /PRIVATE_(ROOT|FILE|REMOVED)_CONTENT_CANARY|BOUND_PRIVATE|FORMAT_PRIVATE|gitjig-input-context|[a-f0-9]{64}/); assert.ok(!transcript.includes(root));
    assert.equal(createHash('sha256').update(await fs.readFile(receipt.historyFile)).digest('hex'), receipt.historyHash); passed = true;
});

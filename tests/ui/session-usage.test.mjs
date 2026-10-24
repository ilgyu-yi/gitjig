import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordedSessionUsage } from '../../dist/ui/session-usage.js';
import { openController } from '../../dist/controller/index.js';

test('recorded usage refuses malformed, overflowing and absent metrics without inventing zero', () => {
    const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 999, cost: { total: 0 } };
    const entry = value => ({ type: 'usage', usage: value });
    assert.deepEqual(recordedSessionUsage([entry(usage)]).tokens, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 });
    assert.equal(recordedSessionUsage([entry(usage)]).cost, 0);
    for (const value of [NaN, Infinity, -1, null, '3', 0.5, Number.MAX_SAFE_INTEGER]) {
        const result = recordedSessionUsage([entry({ ...usage, input: value })]);
        assert.equal(result.tokens, undefined); assert.equal(result.invalidTokens, true); assert.equal(result.cost, 0);
    }
    for (const cost of [NaN, Infinity, -1, null, '0']) {
        const result = recordedSessionUsage([entry({ ...usage, cost: { total: cost } })]);
        assert.equal(result.cost, undefined); assert.equal(result.invalidCost, true); assert.equal(result.tokens.total, 10);
    }
    assert.equal(recordedSessionUsage([]).tokens, undefined); assert.equal(recordedSessionUsage([]).cost, undefined);
    assert.equal(recordedSessionUsage([entry(undefined)]).invalidTokens, true);
    assert.equal(recordedSessionUsage([entry({ ...usage, input: Number.MAX_SAFE_INTEGER - 10 }), entry(usage), entry(usage)]).tokens, undefined);
});

test('original native stats equality and actual closed/restarted session command preserve historical seed usage without requests', { timeout: 7000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/session-usage-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained usage world: ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['tests/ui/session-usage-worker.mjs', root], { timeout: 4000, maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', requests: 0 });
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'usage-receipt.json'), 'utf8'));
    const config = path.join(root, 'pty.json'), steps = [
        { wait: 'Model: not selected', send: '/session\u001b\r' },
        { wait: 'Gitjig session · inspection only', assertDraft: '/session', send: 'Recorded tokens' },
        { wait: '476 total', assertDraft: '/session', send: '\u001b' },
        { wait: 'Command cancelled; draft kept', assertDraft: '/session', send: '\u0015/quit\u001b\r' },
    ];
    await fs.writeFile(config, JSON.stringify({ command: [process.execPath, '--import', './tests/cli/account-ui-no-network.mjs', 'dist/cli/main.js', 'conversation', 'ui', '--home', home, '--conversation', receipt.cid],
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), TERM: 'xterm-256color', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
        database: path.join(home, 'state/controller.sqlite'), expectedInputs: 0, timeoutSeconds: 2, steps, output: config + '.terminal' }), { mode: 0o600 });
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/managed-ui-pty.py', config], { timeout: 3000, maxBuffer: 1024 * 1024 })).stdout);
    assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
    passed = true;
});

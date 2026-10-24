import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('actual app-resolved Pi sessions consume immutable queue preferences and original next-batch selection', { timeout: 7000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/session-prefs-')));
    for (const name of ['user', 'artifacts', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained preference world: ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/pi/session-preferences-worker.mjs', root], {
        timeout: 5000, maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'artifacts'), PATH: path.dirname(process.execPath), PI_CODING_AGENT_DIR: path.join(root, 'stock'), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    });
    const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.modelRequests, 0); assert.equal(result.networkAttempts, 0); passed = true;
});

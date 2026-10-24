import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('actual concurrent Ordinary admissions share one context budget and preserve attribution/ceiling', { timeout: 6000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-budget-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const controller = await openController({ installationHome: home }); await controller.close();
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained failed context world: ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/context-budget-worker.mjs', root], {
        timeout: 5000, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    });
    assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', syntheticRequests: 3, socketAttempts: 0, registration: 'fixture metadata only', dispatch: 'actual Ordinary/original codec' });
    passed = true;
});

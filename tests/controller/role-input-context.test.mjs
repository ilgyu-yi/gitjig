import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('live governed role capture uses its original launch through the actual SDK queue', { timeout: 12000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-role-context-')));
    const home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const controller = await openController({ installationHome: home });
    await controller.close();
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained role context world ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['tests/controller/role-input-context-worker.mjs', root], {
        timeout: 10000, maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    });
    assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', externalCalls: 0, driftRefused: true });
    passed = true;
});

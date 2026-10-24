import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('original Pi settings use gitjig home ownership, approved project preferences and isolated restart', { timeout: 20000 }, async t => {
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/app-config-')));
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained fixture: ' + root); });
    const result = await execute(process.execPath, ['--import', './tests/normal-hosted/no-external.mjs', 'tests/app/configuration-worker.mjs', root], {
        timeout: 18000, maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: path.join(root, 'user'), PI_CODING_AGENT_DIR: path.join(root, 'stock'), PI_CODING_AGENT_SESSION_DIR: path.join(root, 'stock-sessions'), NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' },
    });
    assert.deepEqual(JSON.parse(result.stdout), { phase: 'configuration', outcome: 'passed', serviceCalls: 0 });
    passed = true;
});

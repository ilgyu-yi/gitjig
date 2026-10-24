import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('managed accounts use original Pi operations, isolated catalogue and joined cancellation', { timeout: 20000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/app-accounts-')));
    for (const folder of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, folder), { mode: 0o700 });
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained fixture: ' + root); });
    const result = await promisify(execFile)(process.execPath, ['--import', './tests/normal-hosted/no-external.mjs', 'tests/app/accounts-models-worker.mjs', root], {
        timeout: 18000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath),
            PI_CODING_AGENT_DIR: path.join(root, 'stock'), OPENAI_API_KEY: 'DUMMY_AMBIENT_UNADMITTED', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' },
    });
    assert.equal(JSON.parse(result.stdout).outcome, 'passed'); passed = true;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('durable choices preserve actual history and serialize retained-client rebind', { timeout: 12000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/model-choice-')));
    for (const name of ['user', 'tmp', 'stock']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained model-choice world: ' + root); });
    const result = await promisify(execFile)(process.execPath, ['--import', './tests/normal-hosted/no-external.mjs', 'tests/controller/managed-model-choice-worker.mjs', root], {
        timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(process.execPath),
            PI_CODING_AGENT_DIR: path.join(root, 'stock'), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' },
    });
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.outcome, 'passed'); assert.equal(outcome.syntheticDispatches, 2); passed = true;
});

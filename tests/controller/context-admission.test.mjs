import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
test('actual owned capture freshness, cancellation and completion close ownership', { timeout: 6500 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ca-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 }); const c = await openController({ installationHome: home }); await c.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained admission world ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/context-admission-worker.mjs', root], {
        timeout: 5500, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
    });
    const receipt = JSON.parse(stdout); assert.equal(receipt.outcome, 'passed'); assert.equal(receipt.requests, 0); assert.equal(receipt.openHandles, 0);
    assert.deepEqual(receipt.finalSignal, { classification: 'refused', enqueueAborted: true, admitted: false, callerAborted: true, inputs: 0 });
    await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt));
    passed = true;
    t.diagnostic(JSON.stringify(receipt));
});

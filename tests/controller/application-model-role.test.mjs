import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
test('actual application work admission and role/judgment callbacks retain model mode before reservation', { timeout: 9000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ar-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 }); const c = await openController({ installationHome: home }); await c.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained application role world ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/application-model-role-worker.mjs', root], {
        timeout: 8000, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
    });
    const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.requests, 0); assert.equal(result.roleDispatches, 0);
    assert.equal(result.reservedOverride, 'beta'); assert.equal(result.publicationOverride, 'beta'); passed = true;
});

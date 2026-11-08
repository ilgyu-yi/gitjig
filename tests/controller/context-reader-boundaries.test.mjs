import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { inside } from '../../dist/controller/ownership.js';

test('owned reader root, special-file, grammar and cooperative work bounds', { timeout: 6500 }, async t => {
    const checkout = await fs.realpath(new URL('../../', import.meta.url));
    const temporary = await fs.realpath(tmpdir());
    assert.equal(inside(checkout, temporary), false, 'Reader fixtures must stay outside the captured checkout');
    const root = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'gitjig-cr-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const c = await openController({ installationHome: home }); await c.close();
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained reader world: ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/context-reader-boundaries-worker.mjs', root], {
        timeout: 5500, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
    });
    const receipt = JSON.parse(stdout); assert.equal(receipt.outcome, 'passed'); assert.equal(receipt.requests, 0);
    assert.equal(receipt.rootEnumerations, 0); assert.equal(receipt.closedTimedDirectory, true); assert.equal(receipt.closedSocket, true);
    assert.equal(receipt.permissionDenial, 'unproven'); passed = true;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('public context producer hands real selected native context to normal execution and restart with one shared allowance', { timeout: 18000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-handoff-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const controller = await openController({ installationHome: home }); await controller.close();
    let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained actual handoff world ' + root); });
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/context-producer-handoff-worker.mjs', root], {
        timeout: 15000, maxBuffer: 1024 * 1024,
        env: { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' },
    });
    const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.syntheticRequests, 4); assert.equal(result.socketAttempts, 0);
    const receipt = JSON.parse(await fs.readFile(result.evidence, 'utf8'));
    assert.equal(receipt.status, 'passed'); assert.equal(receipt.requests.length, 4); assert.equal(receipt.works.length, 3); assert.equal(receipt.runs.length, 4);
    const archive = process.env.GITJIG_HANDOFF_EVIDENCE_DIR;
    if (archive) { await fs.mkdir(archive, { recursive: true, mode: 0o700 }); await fs.copyFile(result.evidence, path.join(archive, 'handoff-evidence.json')); }
    passed = true;
});

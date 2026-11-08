import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { openController } from '../../dist/controller/index.js';
const scenarios = ['admission', 'resolver-missing', 'cancel', 'epoch', 'baseline', 'source-impacts', 'request-copy', 'companion-copy',
    'bundle-drift', 'application-reserve', 'explicit-reserve', 'publication-reject', 'publication-target-drift', 'publication-reserve'];
test('actual application work admission and role/judgment callbacks retain model mode before reservation', { timeout: 30000 }, async t => {
    const root = await temporaryDirectory('application-role');
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained application role worlds ' + root); });
    for (const scenario of scenarios) {
        // Pi helper routing is fixed at startup: each world needs its own process.
        const world = path.join(root, scenario), home = path.join(world, 'app');
        await fs.mkdir(path.join(world, 'user'), { recursive: true, mode: 0o700 });
        const c = await openController({ installationHome: home }); await c.close();
        const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/application-model-role-worker.mjs', world, scenario], {
            timeout: 8000, maxBuffer: 1024 * 1024, env: { HOME: path.join(world, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
        });
        const result = JSON.parse(stdout); assert.equal(result.outcome, 'passed'); assert.equal(result.scenario, scenario);
        assert.equal(result.requests, 0);
    }
    passed = true;
});

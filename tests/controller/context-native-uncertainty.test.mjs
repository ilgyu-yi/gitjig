import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
test('actual original SDK queue uncertainty survives cleanup and blocks next admission/restart', { timeout: 8500 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/nu-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 }); const c = await openController({ installationHome: home }); await c.close();
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained native uncertainty world ' + root); });
    const records = [];
    for (let scenario = 0; scenario < 6; scenario++) {
        const app = path.join(root, 'a' + scenario), setup = await openController({ installationHome: app }); await setup.close();
    }
    for (let scenario = 0; scenario < 6; scenario++) {
        await fs.writeFile(path.join(root, 'stage.json'), JSON.stringify({ scenario, status: 'starting' }));
        try {
            const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/context-native-uncertainty-worker.mjs', root, String(scenario)], {
                timeout: 2500, maxBuffer: 1024 * 1024, env: { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'a' + scenario, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' }
            });
            const receipt = JSON.parse(stdout); assert.deepEqual(receipt, { outcome: 'passed', requests: 0, scenario });
            records.push({ scenario, exit: 0, stdout, stderr, receipt });
            await fs.writeFile(path.join(root, 'records.json'), JSON.stringify(records));
        } catch (error) {
            records.push({ scenario, exit: error.code, stdout: error.stdout, stderr: error.stderr });
            await fs.writeFile(path.join(root, 'records.json'), JSON.stringify(records)); t.diagnostic(JSON.stringify(records)); throw error;
        }
    }
    assert.equal(records.length, 6); t.diagnostic(JSON.stringify(records)); passed = true;
});

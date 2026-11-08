import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('original ordinary publication uses distinct adjudicator and native same-work mode transitions preserve history', { timeout: 55000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/oe-native-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' };
    await fs.writeFile(path.join(root, 'selection.json'), JSON.stringify({ worker: 'tests/controller/ordinary-effect-native-worker.mjs', env, timeout: 50000, healthyAttempts: 7, attemptCap: 8, safetyPosition: 'UNSERVED', engineProfile: null, platformSession: 'disabled' }));
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/ordinary-effect-native-worker.mjs', root], { env, timeout: 50000, maxBuffer: 2 * 1024 * 1024 });
        await fs.writeFile(path.join(root, 'execution.json'), JSON.stringify({ exit: 0, stdout, stderr }));
        assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', requests: 7, served: 7, sockets: 0, runs: 6, leases: 6 });
        const traffic = JSON.parse(await fs.readFile(path.join(root, 'traffic.json'), 'utf8'));
        assert.equal(traffic.traffic.length, 7); assert.deepEqual(traffic.traffic.map(r => r.body.model), ['alpha', 'alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta']);
        const ledger = JSON.parse(await fs.readFile(path.join(root, 'final-ledger.json'), 'utf8'));
        assert.equal(ledger.works.length, 2); assert.equal(ledger.operations.length, 1); assert.equal(ledger.operations[0].phase, 'REFUSED');
        assert.equal(ledger.runs.length, 6); assert.ok(ledger.leases.every(l => l.state === 'RELEASED'));
        const runtime = await fs.readdir(path.join(home, 'state', 'runtime')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
        assert.equal(runtime.length, 0, 'Projectless original path allocates no engine scope');
        t.diagnostic(JSON.stringify({ root, result: JSON.parse(stdout), scope: 'actual original codecs/ordinary publication queue and same-W native mode transitions; synthetic decisions; no platform session or engine' }));
    } catch (error) {
        await fs.writeFile(path.join(root, 'execution-failure.json'), JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr, message: error.message }));
        t.diagnostic('Retained actual ordinary effect world ' + root); throw error;
    }
});

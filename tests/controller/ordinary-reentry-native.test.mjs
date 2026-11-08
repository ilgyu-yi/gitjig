import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('original source reentry and divergent conversation/work generations preserve original authority', { timeout: 55000 }, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/oe-native-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const setup = await openController({ installationHome: home }); await setup.close();
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '' };
    await fs.writeFile(path.join(root, 'selection.json'), JSON.stringify({ worker: 'tests/controller/ordinary-reentry-native-worker.mjs', env, timeout: 50000, healthyAttempts: 6, attemptCap: 7, safetyPosition: 'UNSERVED', engineProfile: 'NEVER_EXECUTE, capacity refuses before scope', platformSession: 'disabled' }));
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/ordinary-reentry-native-worker.mjs', root], { env, timeout: 50000, maxBuffer: 2 * 1024 * 1024 });
        await fs.writeFile(path.join(root, 'execution.json'), JSON.stringify({ exit: 0, stdout, stderr }));
        assert.deepEqual(JSON.parse(stdout), { outcome: 'passed', requests: 6, served: 6, sockets: 0, runs: 5, leases: 4 });
        const traffic = JSON.parse(await fs.readFile(path.join(root, 'traffic.json'), 'utf8'));
        assert.equal(traffic.traffic.length, 6); assert.deepEqual(traffic.traffic.map(r => r.body.model), ['alpha', 'alpha', 'beta', 'alpha', 'alpha', 'beta']);
        const ledger = JSON.parse(await fs.readFile(path.join(root, 'final-ledger.json'), 'utf8'));
        assert.equal(ledger.works.length, 2); assert.equal(ledger.operations.length, 1); assert.equal(ledger.operations[0].phase, 'REFUSED');
        assert.equal(ledger.runs.length, 5); assert.ok(ledger.leases.every(l => l.state === 'RELEASED'));
        const runtime = await fs.readdir(path.join(home, 'state', 'runtime')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
        assert.equal(runtime.length, 0, 'Projectless original path allocates no engine scope');
        t.diagnostic(JSON.stringify({ root, result: JSON.parse(stdout), scope: 'actual original codecs/source reentry plus controlled pre-engine divergent-generation admission; synthetic decisions; no platform session or engine' }));
    } catch (error) {
        await fs.writeFile(path.join(root, 'execution-failure.json'), JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr, message: error.message }));
        t.diagnostic('Retained actual ordinary effect world ' + root); throw error;
    }
});

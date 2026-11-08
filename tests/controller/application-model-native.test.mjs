import { runtimeFixtureProfile, runtimeFixtureConfig } from '../runtime/profile.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { scopeJournalsRemoved } from '../runtime/fixture-cleanup.mjs';

test('application models reach original roles, child targets and genuine WAIT across restart', { timeout: 55000 }, async t => {
    const runtime = runtimeFixtureProfile(), dockerConfig = runtimeFixtureConfig();
    const parent = await fs.realpath(process.env.GITJIG_RUNTIME_FIXTURE_ROOT);
    assert.ok(path.isAbsolute(process.env.GITJIG_RUNTIME_FIXTURE_ROOT));
    assert.equal(parent, process.env.GITJIG_RUNTIME_FIXTURE_ROOT, 'Canonical already-shared fixture root required');
    const ownership = await fs.stat(parent); assert.equal(ownership.uid, process.getuid()); assert.equal(ownership.mode & 0o777, 0o700);
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'n8-'))), home = path.join(root, 'app');
    await fs.mkdir(path.join(root, 'user'), { mode: 0o700 });
    const c = await openController({ installationHome: home }); await c.close();
    const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath), LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', DOCKER_CONFIG: dockerConfig, GITJIG_DOCKER_CONFIG_DIRECTORY: dockerConfig, GITJIG_DOCKER_BINARY: runtime.dockerBinary, GITJIG_DOCKER_CONTEXT: runtime.dockerContext, GITJIG_RUNTIME_IMAGE: runtime.image };
    await fs.writeFile(path.join(root, 'selection.json'), JSON.stringify({ worker: 'tests/controller/application-model-native-worker.mjs', env, timeout: 50000, requests: 12 }));
    try {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/application-model-native-worker.mjs', root], { env, timeout: 50000, maxBuffer: 2 * 1024 * 1024 });
        await fs.writeFile(path.join(root, 'execution.json'), JSON.stringify({ exit: 0, stdout, stderr }));
        const result = JSON.parse(stdout); assert.deepEqual(result, { outcome: 'passed', requests: 12, served: 12, sockets: 0, roles: ['planner', 'challenger', 'adjudicator'], parentCalls: 4 });
        const stateRoot = path.join(home, 'state', 'runtime');
        assert.equal(await scopeJournalsRemoved(stateRoot), true, 'Actual returned owned scope journals must establish removed state');
        const produced = JSON.parse(await fs.readFile(path.join(root, 'produced-scopes.json'), 'utf8')), journals = [];
        assert.ok(produced.length > 0, 'Nonvacuous original engine-produced run records required');
        for (const name of await fs.readdir(stateRoot)) if (name.endsWith('.json')) journals.push(JSON.parse(await fs.readFile(path.join(stateRoot, name), 'utf8')));
        assert.equal(journals.length, produced.length);
        for (const run of produced) {
            const matching = journals.filter(row => row.runId === run.runId && row.workId === run.workId && row.id === run.containerId);
            assert.equal(matching.length, 1); assert.equal(matching[0].state, 'removed'); assert.equal(run.cleanup, 'removed');
        }
        await fs.writeFile(path.join(root, 'cleanup-correlation.json'), JSON.stringify({ produced, journals }));
        t.diagnostic(JSON.stringify({ root, result, scope: 'actual original codecs/local engine with synthetic model decisions; native files retained for binding' }));
    } catch (error) {
        const observedJournals = [];
        try {
            const state = path.join(home, 'state', 'runtime');
            for (const name of await fs.readdir(state)) {
                if (!name.endsWith('.json') && !name.endsWith('.json.next')) continue;
                const file = path.join(state, name), info = await fs.lstat(file);
                observedJournals.push({ name, regular: info.isFile() && !info.isSymbolicLink(), ...(info.isFile() && !info.isSymbolicLink() && info.size <= 65536 ? { raw: await fs.readFile(file, 'utf8') } : {}) });
            }
        } catch (journalError) { observedJournals.push({ unavailable: String(journalError) }); }
        await fs.writeFile(path.join(root, 'failure-runtime-disposition.json'), JSON.stringify({ disposition: 'UNKNOWN until exact owned journals and processes are reconciled; worker exit is not cleanup proof', observedJournals }));
        await fs.writeFile(path.join(root, 'execution-failure.json'), JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
        t.diagnostic('Retained actual native qualification world ' + root); throw error;
    }
});

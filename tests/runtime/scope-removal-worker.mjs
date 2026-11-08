// Copied unchanged beside installed evidence; imports only the selected payload.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {appendFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

const [payload, root, mode] = process.argv.slice(2);
registerHooks({load(url, context, next) {
    if (url.startsWith('file:')) {
        const file = fileURLToPath(url);
        assert.ok(file.startsWith(payload + path.sep), 'Selected payload module only: ' + file);
        appendFileSync(path.join(root, mode + '-modules.jsonl'), JSON.stringify({pid: process.pid, url}) + '\n', {mode: 0o600});
    }
    return next(url, context);
}});
const load = name => import(pathToFileURL(path.join(payload, 'dist', name)).href);
const {openController} = await load('controller/index.js');
const {ContainerScope, createScope, reconcileScope} = await load('execution/container-scope.js');
const runtime = JSON.parse(process.env.GITJIG_REMOVAL_RUNTIME);
const home = path.join(root, 'application'), source = path.join(root, 'project');
const options = {installationHome: home, runtimeProfile: runtime};
const write = (name, value) => fs.writeFile(path.join(root, name + '.json'), JSON.stringify(value, null, 2), {mode: 0o600});
let controller;
try {
    if (mode === 'crash') {
        for (const name of ['project', 'keeper-work', 'keeper-state']) await fs.mkdir(path.join(root, name), {mode: 0o700});
        await fs.writeFile(path.join(source, 'value.cjs'), 'module.exports=3;\n');
        const keeperConfig = {...runtime, workRoot: path.join(root, 'keeper-work'), stateRoot: path.join(root, 'keeper-state'),
            uid: process.getuid(), gid: process.getgid(), workId: 'unrelated-owned-work', runId: 'unrelated-owned-run'};
        const keeper = await createScope(keeperConfig);
        const keeperJournal = path.join(keeperConfig.stateRoot, (await fs.readdir(keeperConfig.stateRoot)).find(name => name.endsWith('.json')));
        await write('keeper', {config: keeperConfig, journal: keeperJournal, id: keeper.containerId});
        controller = await openController(options);
        await controller.registerProject({id: 'P', sourceRoot: source});
        const execute = ContainerScope.prototype.execute, record = ContainerScope.prototype.record;
        let observed;
        ContainerScope.prototype.execute = async function (...args) {
            const result = await execute.apply(this, args);
            if (this.containerId !== keeper.containerId) observed = result;
            return result;
        };
        ContainerScope.prototype.record = async function (state, ...args) {
            if (state === 'removed' && this.containerId !== keeper.containerId) {
                // cleanup() has already awaited actual native rm exit0. Do not commit removed.
                assert.equal(observed?.exitCode, 0);
                assert.equal(observed.stdout.trim(), 'REMOVAL_CHECK');
                const journal = this.journal, bytes = await fs.readFile(journal, 'utf8'), saved = JSON.parse(bytes);
                assert.equal(saved.creationBinding.state, 'VERIFIED');
                assert.equal(saved.id, this.containerId);
                await fs.writeFile(path.join(root, 'original-journal.json'), bytes, {mode: 0o600});
                await write('crash', {pid: process.pid, journal, saved, observed, state: controller.inspectWork(saved.workId)});
                process.kill(process.pid, 'SIGKILL');
                await new Promise(() => {});
            }
            return record.call(this, state, ...args);
        };
        await controller.runLocalCheck({projectId: 'P', command: "node -e \"require('node:assert/strict').equal(require('/work/value.cjs'),3); console.log('REMOVAL_CHECK')\""});
        assert.fail('Expected actual SIGKILL after native removal');
    } else if (mode === 'cleanup') {
        const journals = [], results = [], errors = [];
        const directory = path.join(home, 'state/runtime');
        try {for (const name of await fs.readdir(directory)) if (/^[a-f0-9-]{36}\.json$/.test(name)) journals.push(path.join(directory, name));}
        catch (error) {if (error.code !== 'ENOENT') throw error;}
        try {journals.push(JSON.parse(await fs.readFile(path.join(root, 'keeper.json'), 'utf8')).journal);}
        catch (error) {if (error.code !== 'ENOENT') throw error;}
        for (const journal of journals) {
            try {
                const result = await reconcileScope(journal, runtime.dockerBinary, runtime.dockerConfigDirectory);
                results.push({journal, ...result});
                assert.equal(result.state, 'removed', 'Exact owned journal cleanup remains uncertain: ' + journal);
            } catch (error) {errors.push(error); results.push({journal, error: String(error)});}
        }
        await write('cleanup', results);
        if (errors.length) throw new AggregateError(errors, 'Retained exact cleanup obligations; see cleanup.json');
    } else {
        const before = JSON.parse(await fs.readFile(path.join(root, 'crash.json'), 'utf8'));
        controller = await openController(options);
        const state = controller.inspectWork(before.saved.workId);
        assert.equal(state.currentResult, null);
        assert.equal(state.allowance.consumed, 1);
        assert.equal(state.allowance.reserved, 0);
        assert.equal(state.runs.length, 1);
        assert.equal(state.state, mode === 'hold' ? 'UNKNOWN' : 'INTERRUPTED');
        const originalRun = state.runs.find(run => run.id === before.saved.runId);
        assert.equal(originalRun.phase, mode === 'hold' ? 'UNKNOWN' : 'INTERRUPTED');
        const saved = JSON.parse(await fs.readFile(before.journal, 'utf8'));
        assert.equal(saved.state, mode === 'hold' ? 'quarantined' : 'removed');
        if (mode === 'hold') assert.equal(saved.absenceEvidence, undefined);
        else {
            assert.deepEqual(saved.creationBinding, before.saved.creationBinding);
            assert.equal(saved.absenceEvidence.kind, 'known-container-absent');
            assert.equal(saved.absenceEvidence.containerId, before.saved.id);
            assert.ok(saved.absenceEvidence.inventoryCount >= 1);
        }
        const keeper = JSON.parse(await fs.readFile(path.join(root, 'keeper.json'), 'utf8'));
        const journal = JSON.parse(await fs.readFile(keeper.journal, 'utf8'));
        const live = new ContainerScope(keeper.config, keeper.id, journal.nonce, keeper.journal, journal.creationBinding);
        const health = await live.execute('printf UNRELATED_HEALTHY');
        assert.equal(health.exitCode, 0); assert.equal(health.stdout, 'UNRELATED_HEALTHY');
        let result, final = state;
        if (mode === 'recover') {
            result = await controller.resumeWork({workId: before.saved.workId});
            assert.equal(result.status, 'succeeded', JSON.stringify(result));
            assert.equal(result.cleanup, 'removed');
            assert.equal(result.workId, before.saved.workId);
            assert.notEqual(result.runId, before.saved.runId);
            final = controller.inspectWork(result.workId);
            assert.equal(final.allowance.consumed, 2); assert.equal(final.allowance.reserved, 0);
            assert.equal(final.runs.length, 2);
            assert.equal(final.runs.find(run => run.id === before.saved.runId).phase, 'INTERRUPTED');
            assert.equal((await live.close()).state, 'removed');
        }
        await write(mode, {before: state, recoveredJournal: saved, keeperHealth: health, result, final});
    }
} finally {await controller?.close();}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCompatibleNode, requiredNodeRange } from '../../dist/app/runtime-requirements.js';

test('source CLI admits compatible Node without an engine; an explicitly missing engine is unavailable', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig node requirements '));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const env = { ...process.env, GITJIG_HOME: path.join(root, 'never-opened'), NODE_OPTIONS: '', NODE_PATH: '' };
    const run = promisify(execFile), entry = path.resolve('dist/cli/entry.js');
    const report = JSON.parse((await run(process.execPath, [entry, 'doctor'], { cwd: root, env })).stdout);
    assert.equal(report.node.expected, requiredNodeRange); assert.equal(report.node.compatible, true);
    assert.equal(report.sqliteApiAvailable, true); assert.equal(report.applicationReady, true);
    assert.equal(report.projectExecutionReady, false); assert.equal(report.prerequisitesReady, true);
    await assert.rejects(fs.access(env.GITJIG_HOME), { code: 'ENOENT' });
    await assert.rejects(run(process.execPath, [entry, 'doctor', '--docker-context', 'gitjig-nonexistent-context'], { cwd: root, env: { ...env, PATH: root } }), error => {
        const failed = JSON.parse(error.stdout); assert.equal(failed.applicationReady, true); assert.equal(failed.prerequisitesReady, false); return error.code === 2;
    });
});

test('source CLI launcher reports invocation errors as USAGE before opening a home', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig entry usage '));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const env = { ...process.env, GITJIG_HOME: path.join(root, 'never-opened'), NODE_OPTIONS: '', NODE_PATH: '' };
    const run = promisify(execFile), entry = path.resolve('dist/cli/entry.js');
    for (const args of [['change', 'list', '--bogus', 'x'], ['no-such-command'], ['conversation', 'ui', '--home'], ['goal', 'create', '--conversation', 'C', '--objective', 'O', '--criteria', '{not json'], ['reset', 'preview'], ['reset', 'apply', '--confirm', 'F']]) {
        await assert.rejects(run(process.execPath, [entry, ...args], { cwd: root, env }), error => {
            assert.equal(JSON.parse(error.stderr).error, 'USAGE', args.join(' ')); return error.code === 2;
        });
    }
    await assert.rejects(fs.access(env.GITJIG_HOME), { code: 'ENOENT' });
});

test('minimum Node policy matches package metadata and does not require one patch or major', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    assert.equal(pkg.engines.node, requiredNodeRange);
    for (const version of ['22.19.0', '22.20.0', '24.0.0', '24.22.1', '26.0.0']) assert.equal(isCompatibleNode(version), true, version);
    for (const version of ['20.20.0', '22.18.9', '24.0.0-rc.1', 'unknown']) assert.equal(isCompatibleNode(version), false, version);
});

test('doctor identifies its PATH and ambient Docker probe without claiming to check saved runtime setup', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig doctor route '));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const trace = path.join(root, 'probe.json'), home = path.join(root, 'not-opened');
    await fs.writeFile(path.join(root, 'docker'), '#!' + process.execPath + '\n' +
        `require('node:fs').writeFileSync(${JSON.stringify(trace)}, JSON.stringify({args:process.argv.slice(2),host:process.env.DOCKER_HOST,config:process.env.DOCKER_CONFIG}));console.log(JSON.stringify('fixture-version'));`, {mode: 0o700});
    const env = {...process.env, PATH: root, GITJIG_HOME: home, DOCKER_HOST: 'fixture-ambient-host',
        DOCKER_CONFIG: path.join(root, 'ambient-config'), NODE_OPTIONS: '', NODE_PATH: ''};
    const result = await promisify(execFile)(process.execPath, [path.resolve('dist/cli/entry.js'), 'doctor', '--docker-context', 'explicit-context'], {env});
    const report = JSON.parse(result.stdout), observed = JSON.parse(await fs.readFile(trace, 'utf8'));
    assert.deepEqual(observed, {args: ['--context', 'explicit-context', 'version', '--format', '{{json .Server.Version}}'],
        host: env.DOCKER_HOST, config: env.DOCKER_CONFIG});
    assert.equal(report.engine.version, 'fixture-version');
    assert.equal(report.projectExecutionReady, true);
    assert.deepEqual(report.engine.probe, {client: 'docker', resolution: 'PATH',
        configuration: 'ambient Docker configuration and environment', selectedRuntimeProfileChecked: false});
    await assert.rejects(fs.access(home), {code: 'ENOENT'});
});

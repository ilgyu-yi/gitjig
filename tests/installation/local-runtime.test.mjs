import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runtimeFixtureProfile, runtimeFixtureConfig} from '../runtime/profile.mjs';
import {localEvidenceRuntimeJourney} from '../cli/local-evidence-runtime-journey.mjs';

const execute = promisify(execFile);

test('fresh installed CLI executes actual local checks through candidate, native commit and historical audit', {timeout: 210000}, async t => {
    // Refuse before installation or resource allocation when no engine profile was selected.
    const runtime = runtimeFixtureProfile(), config = runtimeFixtureConfig();
    const shared = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(shared && path.isAbsolute(shared), 'Explicit absolute GITJIG_RUNTIME_FIXTURE_ROOT required');
    for (const directory of [shared, config]) {
        assert.equal(await fs.realpath(directory), directory, 'Canonical fixture/configuration directory');
        const info = await fs.lstat(directory);
        assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
            'Owned private fixture/configuration directory');
    }
    const checkout = await fs.realpath('.');
    assert.ok(shared !== checkout && !shared.startsWith(checkout + path.sep), 'Shared fixtures outside checkout');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-installed-local-runtime-')));
    const prefix = path.join(root, 'prefix with spaces'), user = path.join(root, 'user');
    await fs.mkdir(user, {mode: 0o700});
    const env = {
        HOME: user, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', LANG: 'C.UTF-8',
        PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', TMPDIR: root,
        NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '',
        GITJIG_DOCKER_BINARY: runtime.dockerBinary, GITJIG_DOCKER_CONTEXT: runtime.dockerContext,
        GITJIG_RUNTIME_IMAGE: runtime.image, GITJIG_DOCKER_CONFIG_DIRECTORY: config,
        GITJIG_RUNTIME_FIXTURE_ROOT: shared
    };
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained installed local runtime installation: ' + root);
    });
    const installed = await execute(process.execPath, [path.join(checkout, 'install.mjs'), '--prefix', prefix], {
        cwd: root, timeout: 100000, maxBuffer: 2 ** 22,
        env: {...env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
            npm_config_offline: 'true', npm_config_cache: process.env.npm_config_cache ?? path.join(os.homedir(), '.npm'),
            npm_config_userconfig: path.join(root, 'empty-user.npmrc'), npm_config_globalconfig: path.join(root, 'empty-global.npmrc')}
    });
    await fs.writeFile(path.join(root, 'installation.log'), installed.stdout + installed.stderr, {mode: 0o600});
    const entry = path.join(prefix, 'bin/gitjig'), payload = path.join(prefix, 'lib/node_modules/gitjig');
    assert.ok((await fs.realpath(entry)).startsWith(payload + path.sep));
    for (const name of ['src', 'tests', 'qualification', '.qualification', '.git', 'node_modules/typescript'])
        await assert.rejects(fs.access(path.join(payload, name)), {code: 'ENOENT'});
    for (const name of ['dist/cli/entry.js', 'dist/controller/local-checks.js', 'dist/controller/local-evidence.js',
        'dist/controller/local-candidate.js', 'dist/controller/capture-worker.js', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md'])
        assert.deepEqual(await fs.readFile(path.join(payload, name)), await fs.readFile(path.join(checkout, name)), name);
    const dependencies = ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-tui', '@gitjig/pi-claude-bridge-host'];
    const resolved = await execute(process.execPath, ['--input-type=module', '-e',
        'console.log(JSON.stringify(' + JSON.stringify(dependencies) + '.map(name=>import.meta.resolve(name))))'],
    {cwd: payload, env, timeout: 10000});
    for (const uri of JSON.parse(resolved.stdout))
        assert.ok((await fs.realpath(fileURLToPath(uri))).startsWith(payload + '/node_modules/'));
    await localEvidenceRuntimeJourney(t, {entry: [entry], environment: env, workingDirectory: root});
    passed = true;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeFixtureProfile, runtimeFixtureConfig, runtimeFixtureRoot} from '../runtime/profile.mjs';
import {localEvidenceRuntimeJourney} from '../cli/local-evidence-runtime-journey.mjs';
import {inventory, offlineSourceInstallation} from './offline-source-fixture.mjs';

test('fresh installed CLI executes actual local checks through candidate, native commit and historical audit', {timeout: 210000}, async t => {
    const runtime = runtimeFixtureProfile(), config = runtimeFixtureConfig(), shared = await runtimeFixtureRoot();
    assert.equal(await fs.realpath(config), config, 'Canonical Docker configuration directory');
    const info = await fs.lstat(config);
    assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
        'Owned private Docker configuration directory');

    const installed = await offlineSourceInstallation(t, 'local-runtime');
    const {command, cwd, env, payload, run} = installed;
    const dependencies = ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-tui', '@gitjig/pi-claude-bridge-host'];
    const resolved = await run(process.execPath, ['--input-type=module', '-e',
        'console.log(JSON.stringify(' + JSON.stringify(dependencies) + '.map(name=>import.meta.resolve(name))))'],
        'installed-dependencies', {workdir: payload});
    for (const uri of JSON.parse(resolved))
        assert.ok((await fs.realpath(fileURLToPath(uri))).startsWith(path.join(payload, 'node_modules') + path.sep));

    const environment = {...env, PI_PACKAGE_DIR: '',
        GITJIG_DOCKER_BINARY: runtime.dockerBinary, GITJIG_DOCKER_CONTEXT: runtime.dockerContext,
        GITJIG_RUNTIME_IMAGE: runtime.image, GITJIG_DOCKER_CONFIG_DIRECTORY: config, GITJIG_RUNTIME_FIXTURE_ROOT: shared};
    await localEvidenceRuntimeJourney(t, {entry: [command], environment, workingDirectory: cwd});
    await installed.assertCurrent();
    assert.deepEqual(await inventory(payload), installed.payloadBefore, 'Installed payload changed during local development');
    installed.pass();
});

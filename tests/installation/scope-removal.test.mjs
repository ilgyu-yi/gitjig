import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {managedFixtureInputs, assertCurrentBuild} from './managed-installed-fixture.mjs';
import {scopeRemovalJourney} from '../runtime/scope-removal-journey.mjs';

const execute = promisify(execFile);
test('fresh immutable installation recovers actual removed-ID crash with original work and consumed allowance', {timeout: 180000}, async t => {
    const {runtime, shared, built} = await managedFixtureInputs();
    const root = await fs.realpath(await fs.mkdtemp(path.join(shared, 'scope-removal-installed-')));
    t.diagnostic('Retained installed removal world: ' + root);
    const home = path.join(root, 'application'), user = path.join(root, 'user');
    await fs.mkdir(user, {mode: 0o700});
    const env = {HOME: user, PATH: '/usr/bin:/bin', TMPDIR: root, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture',
        LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: ''};
    await execute(path.join(built.destination, 'install'), ['activate', '--bundle', built.destination, '--home', home], {cwd: root, env, timeout: 60000, maxBuffer: 2 ** 20});
    const payload = path.join(home, 'versions', built.payloadId), node = path.join(home, 'bootstrap/node');
    for (const name of ['src', 'tests', '.git', 'node_modules/typescript'])
        await assert.rejects(fs.access(path.join(payload, name)), {code: 'ENOENT'});
    assert.deepEqual(await fs.readFile(path.join(payload, 'dist/execution/container-scope.js')),
        await fs.readFile(path.join(built.root, 'compiled-dist/execution/container-scope.js')));
    const receipt = await scopeRemovalJourney({root, payload, node, runtime, environment: env});
    await fs.writeFile(path.join(root, 'installed-receipt.json'), JSON.stringify({...receipt, buildReceipt: process.env.GITJIG_CLI_FINAL_BUILD_RECEIPT, payloadId: built.payloadId}, null, 2), {mode: 0o600});
    await assertCurrentBuild(built);
});

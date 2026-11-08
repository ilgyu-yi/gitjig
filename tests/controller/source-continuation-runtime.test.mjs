import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';

test('held owner source composes with final judgment and explicit checkpoint recovery', { timeout: 240000 }, async t => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent), 'Explicit engine-shared fixture root required');
    assert.equal(await fs.realpath(parent), parent);
    const checkout = await fs.realpath('.');
    assert.ok(parent !== checkout && !parent.startsWith(checkout + path.sep));
    const runtime = { dockerBinary: process.env.GITJIG_DOCKER_BINARY, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
    assert.ok(runtime.dockerBinary && runtime.dockerConfigDirectory && runtime.dockerContext && runtime.image?.startsWith('sha256:'));
    const root = await fs.mkdtemp(path.join(parent, 'source-continuation-'));
    await fs.chmod(root, 0o700);
    t.diagnostic('Retained source continuation controls ' + root);
    // Each Pi process must start with its own exact application artifacts route.
    const supported = ['explanation', 'scope', 'ambiguous', 'drift', 'checks', 'checks-scope', 'review', 'implement', 'author-failed', 'complete', 'complete-finding', 'complete-stale'];
    const scenarios = process.env.GITJIG_SOURCE_CONTINUATION_CASES ? JSON.parse(process.env.GITJIG_SOURCE_CONTINUATION_CASES) : supported;
    assert.ok(Array.isArray(scenarios) && scenarios.length && new Set(scenarios).size === scenarios.length && scenarios.every(s => supported.includes(s)), 'Select unique known continuation cases');
    for (const scenario of scenarios) {
        const world = path.join(root, scenario), home = path.join(world, 'home');
        await fs.mkdir(path.join(world, 'user'), { recursive: true, mode: 0o700 });
        const c = await openController({ installationHome: home });
        await c.close();
        const { stdout } = await promisify(execFile)(process.execPath, ['--import', './tests/cli/account-ui-no-network.mjs', 'tests/controller/source-continuation-runtime-worker.mjs', world, scenario], {
            timeout: 60000, maxBuffer: 1024 * 1024,
            env: { HOME: path.join(world, 'user'), TMPDIR: path.join(home, 'artifacts'), PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', GITJIG_SOURCE_CONTINUATION_RUNTIME: JSON.stringify(runtime) }
        });
        const report = JSON.parse(stdout);
        assert.equal(report.scenario, scenario);
        assert.equal(report.complete, true, report.error);
        assert.equal(report.closed, true);
    }
});

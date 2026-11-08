import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixtureProfile, runtimeFixtureConfig} from './profile.mjs';
import {scopeRemovalJourney} from './scope-removal-journey.mjs';

test('actual native removal then SIGKILL recovers the original charged work without touching another scope', {timeout: 150000}, async t => {
    const runtime = {...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig()};
    const shared = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(shared && path.isAbsolute(shared), 'Explicit already-shared fixture root required');
    const root = await fs.realpath(await fs.mkdtemp(path.join(shared, 'scope-removal-source-')));
    t.diagnostic('Retained actual removal world: ' + root);
    await scopeRemovalJourney({root, payload: await fs.realpath('.'), node: process.execPath, runtime});
});

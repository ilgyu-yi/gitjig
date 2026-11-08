import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixtureDirectoryOutsideCheckout} from '../helpers/temporary-directory.mjs';

// Explicit fixture selection, never a fallback to a developer's engine/account.
export function runtimeFixtureProfile(env = process.env) {
    const dockerBinary = env.GITJIG_DOCKER_BINARY;
    const dockerContext = env.GITJIG_DOCKER_CONTEXT;
    const image = env.GITJIG_RUNTIME_IMAGE;
    assert.ok(typeof dockerBinary === 'string' && path.isAbsolute(dockerBinary), 'Explicit absolute GITJIG_DOCKER_BINARY required');
    assert.ok(typeof dockerContext === 'string' && dockerContext.trim(), 'Explicit GITJIG_DOCKER_CONTEXT required');
    assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/, 'Explicit immutable GITJIG_RUNTIME_IMAGE required');
    return { dockerBinary, dockerContext, image };
}

export function runtimeFixtureConfig(env = process.env) {
    const directory = env.GITJIG_DOCKER_CONFIG_DIRECTORY;
    assert.ok(typeof directory === 'string' && path.isAbsolute(directory), 'Explicit absolute GITJIG_DOCKER_CONFIG_DIRECTORY required');
    return directory;
}

/** A real engine needs explicitly selected, already-shared storage. */
export async function runtimeFixtureRoot(env = process.env) {
    const root = env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(typeof root === 'string' && path.isAbsolute(root), 'Explicit absolute GITJIG_RUNTIME_FIXTURE_ROOT required');
    assert.equal(fixtureDirectoryOutsideCheckout(root), root, 'GITJIG_RUNTIME_FIXTURE_ROOT must be canonical');
    const info = await fs.stat(root);
    assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
        'GITJIG_RUNTIME_FIXTURE_ROOT must be an owned private directory (0700)');
    return root;
}

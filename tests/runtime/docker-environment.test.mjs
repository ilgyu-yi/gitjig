import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerEnvironment } from '../../dist/execution/container-scope.js';

test('Docker client environment drops ambient route overrides and keeps ordinary process variables', () => {
    const ambient = { PATH: '/usr/bin', HOME: '/home/owner', DOCKER_HOST: 'tcp://elsewhere:2375', DOCKER_CONTEXT: 'other', DOCKER_TLS_VERIFY: '0', DOCKER_CONFIG: '/ambient/config', BUILDX_BUILDER: 'b', COLIMA_PROFILE: 'p', NODE_OPTIONS: '--require=/x.js', NODE_PATH: '/x' };
    const routed = dockerEnvironment(['--config', '/explicit', '--context', 'owned', 'info'], ambient);
    assert.deepEqual(routed, { PATH: '/usr/bin', HOME: '/home/owner' });
    // Without an explicit configuration directory the owner's DOCKER_CONFIG still defines the named context.
    assert.deepEqual(dockerEnvironment(['--context', 'owned', 'info'], ambient), { PATH: '/usr/bin', HOME: '/home/owner', DOCKER_CONFIG: '/ambient/config' });
    // Payload arguments after the route never change the client environment.
    assert.deepEqual(dockerEnvironment(['--context', 'owned', 'exec', 'c1', 'tool', '--config', '/payload', '--context', 'default'], ambient), { PATH: '/usr/bin', HOME: '/home/owner', DOCKER_CONFIG: '/ambient/config' });
    // The built-in default context is defined by the ambient endpoint and TLS variables.
    assert.deepEqual(dockerEnvironment(['--config', '/explicit', '--context', 'default', 'info'], ambient), { PATH: '/usr/bin', HOME: '/home/owner', DOCKER_HOST: 'tcp://elsewhere:2375', DOCKER_TLS_VERIFY: '0' });
});

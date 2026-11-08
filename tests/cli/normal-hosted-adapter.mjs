import '../normal-hosted/no-external.mjs';
import { Controller } from '../../dist/controller/controller.js';
import { configureOwnedNormalHostedIntegrationFixture } from '../../.qualification/controller-testing.js';
// Explicit test preload: only native HTTP/TLS transport changes. The normal
// identity/policy/authority procedure and real CLI private-input parsing remain.
const origin = process.env.TEST_NORMAL_REST_ORIGIN;
const https = JSON.parse(process.env.TEST_NORMAL_HTTPS_PROFILE ?? 'null');
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !https) throw Error('Owned normal transport required');
Controller.prototype.configureHostedIntegrationCredential = function (options) {
  configureOwnedNormalHostedIntegrationFixture(this, { ...options, origin, https });
};

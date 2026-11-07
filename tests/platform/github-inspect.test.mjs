import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { GitHubReadClient } from '../../dist/platform/github-read-client.js';
import { nativeJsonTransport } from '../../dist/platform/github-transport.js';
import { fixedClassicTransport } from '../../dist/platform/github-classic.js';
import { inspectGitHubRepository } from '../../dist/platform/github-inspect.js';

test('repository inspection reaches fixed classic reads and retains unavailable/unknown observations', async () => {
  for (const mode of ['empty', 'partial-error', 'wrong-node', 'missing-node', 'cancel']) {
    const seen = [];
    const abort = new AbortController();
    const server = http.createServer(async (request, response) => {
      seen.push({ method: request.method, path: request.url });
      assert.equal(request.headers.authorization, 'Bearer fixture-only');
      let value;
      if (request.url === '/user') value = { id: 7, login: 'owner', type: 'User' };
      else if (request.url === '/repos/owner/repo') value = { id: 8, node_id: mode === 'missing-node' ? undefined : 'REPO', full_name: 'owner/repo', default_branch: 'main' };
      else if (request.url === '/graphql') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        assert.match(body.query, /^query GitjigClassicInventory/);
        assert.equal(body.variables.qualifiedName, 'refs/heads/main');
        value = { data: { repository: { __typename: 'Repository', id: mode === 'wrong-node' ? 'OTHER' : 'REPO', nameWithOwner: 'owner/repo',
          ref: { __typename: 'Ref', id: 'REF', name: 'main', prefix: 'refs/heads/', target: { __typename: 'Commit', oid: '1'.repeat(40) } },
          branchProtectionRules: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } } } };
        if (mode === 'partial-error') value.errors = [{ message: 'hidden' }];
        if (mode === 'cancel') abort.abort();
      } else value = request.url.endsWith('/protection') ? { message: 'Not Found' } : [];
      response.writeHead(request.url.endsWith('/protection') ? 404 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const limits = { requestTimeoutMs: 1000, responseBytes: 8192, pages: 10, collectionBytes: 65536, collectionItems: 100 };
    const start = nativeJsonTransport('fixture-only', limits);
    const client = new GitHubReadClient(origin, (url, signal) => start(url, { method: 'GET' }, signal).response, limits, fixedClassicTransport(origin, start));
    try {
      const pending = inspectGitHubRepository(client, 'owner', 'repo', undefined, abort.signal);
      if (mode === 'cancel') await assert.rejects(pending);
      else {
        const result = await pending;
        assert.equal(result.observations.classicTargetProtection.status, 404);
        const classic = result.observations.classicInventory;
        if (mode === 'empty') {
          assert.equal(classic.status, 'observed'); assert.equal(classic.value.completeVisibleConnections, true);
          assert.equal(classic.value.visibility, 'not-established'); assert.equal(classic.value.absence, 'unknown');
        } else { assert.equal(classic.status, 'unavailable'); assert.equal('value' in classic, false); }
        assert.equal('allowed' in result, false);
      }
      assert.equal(seen.filter(row => row.method === 'POST').length, mode === 'empty' ? 2 : mode === 'missing-node' ? 0 : 1);
      assert.ok(seen.every(row => row.method === 'GET' || row.path === '/graphql'));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

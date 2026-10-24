import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { GitHubReadClient } from '../../dist/platform/github-read-client.js';
import { nativeReadTransport } from '../../dist/platform/github-transport.js';
import { openGitHubReadClient } from '../../dist/platform/github.js';
import { inspectGitHubRepository } from '../../dist/platform/github-inspect.js';

const limits = { requestTimeoutMs: 1000, responseBytes: 4096, pages: 4, collectionBytes: 8192, collectionItems: 100 };
async function fixture(handler, overrides = {}) {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    assert.equal(request.headers.authorization, 'Bearer fixture-only-not-a-real-token');
    assert.equal(request.headers['x-github-api-version'], '2026-03-10');
    handler(request, response, origin);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = { ...limits, ...overrides };
  return { seen, sockets, client: new GitHubReadClient(origin, nativeReadTransport('fixture-only-not-a-real-token', profile), profile),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
function json(response, body, headers = {}, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

test('finite native HTTP reads retain exact data/status and completely consume two-page rulesets', async () => {
  const value = { id: 41, name: '한글\n,$(command) @literal' };
  const f = await fixture((request, response, origin) => {
    const url = new URL(request.url, origin);
    if (url.pathname.endsWith('/rulesets')) {
      if (url.searchParams.get('page') === '1') json(response, [value], { Link: `<${origin}${url.pathname}?includes_parents=true&per_page=100&page=2>; rel="next"`, 'X-GitHub-Request-Id': 'fixture-page1' });
      else json(response, [{ id: 42 }], { Link: `<${origin}${url.pathname}?includes_parents=true&per_page=100&page=1>; rel="prev"` });
    } else if (url.pathname.endsWith('/protection')) json(response, { message: 'Not Found' }, {}, 404);
    else json(response, value);
  });
  try {
    const result = await f.client.repositoryRulesets('owner', 'repo');
    assert.deepEqual(result.items, [value, { id: 42 }]); assert.equal(result.pages.length, 2);
    assert.equal(result.pages[0].requestId, 'fixture-page1'); assert.match(result.pages[0].bodyHash, /^[a-f0-9]{64}$/);
    assert.equal((await f.client.authenticatedUser()).data.name, value.name);
    assert.equal((await f.client.branchProtection('owner', 'repo', '한글/feature')).status, 404);
    assert.match(f.seen.at(-1), /%ED%95%9C%EA%B8%80%2Ffeature/);
    assert.throws(() => openGitHubReadClient({ token: 'unsafe\nheader' }), /credential/);
    assert.throws(() => openGitHubReadClient({ token: 'fixture', limits: { pages: Infinity } }), /finite/);
    assert.throws(() => f.client.repository('owner/elsewhere', 'repo'), /identity/);
    for (const name of ['.', '..']) {
      assert.throws(() => f.client.branchProtection('owner', 'repo', name), /branch name/);
      assert.throws(() => f.client.branchRules('owner', 'repo', name), /branch name/);
    }
  } finally { await f.close(); }
});

test('pagination fails closed on foreign/changed/ambiguous links, page errors and finite limits without a good-prefix result', async () => {
  for (const mode of ['foreign', 'path', 'query', 'repeat', 'duplicate', 'malformed', 'last-without-next', 'next-after-last', 'wrong-first', 'wrong-prev', 'page-error', 'page-shape', 'page-limit', 'byte-limit', 'item-limit']) {
    const f = await fixture((request, response, origin) => {
      const path = '/repos/owner/repo/rulesets';
      const next = `${origin}${path}?includes_parents=true&per_page=100&page=2`;
      if (request.url.includes('page=2')) {
        if (mode === 'page-error') json(response, { message: 'forbidden' }, {}, 403);
        else if (mode === 'page-shape') json(response, { items: [] });
        else json(response, [{ id: 2 }]);
        return;
      }
      const link = mode === 'foreign' ? `<https://elsewhere.invalid${path}?includes_parents=true&per_page=100&page=2>; rel="next"`
        : mode === 'path' ? `<${origin}/user?includes_parents=true&per_page=100&page=2>; rel="next"`
        : mode === 'query' ? `<${next}&actor=1>; rel="next"`
        : mode === 'repeat' ? `<${next.replace('page=2', 'page=1')}>; rel="next"`
        : mode === 'duplicate' ? `<${next}>; rel="next", <${next}>; rel="next"`
        : mode === 'last-without-next' ? `<${next.replace('page=2', 'page=3')}>; rel="last"`
        : mode === 'next-after-last' ? `<${next}>; rel="next", <${next.replace('page=2', 'page=1')}>; rel="last"`
        : mode === 'wrong-first' ? `<${next}>; rel="first"`
        : mode === 'wrong-prev' ? `<${next}>; rel="prev"`
        : mode === 'malformed' ? 'not-a-link' : `<${next}>; rel="next"`;
      json(response, [{ id: 1 }], { Link: link });
    }, { ...(mode === 'page-limit' ? { pages: 1 } : {}), ...(mode === 'byte-limit' ? { collectionBytes: 1 } : {}), ...(mode === 'item-limit' ? { collectionItems: 1 } : {}) });
    try {
      await assert.rejects(f.client.repositoryRulesets('owner', 'repo'), /pagination|collection/);
      assert.equal(f.seen.length, ['page-error', 'page-shape', 'item-limit'].includes(mode) ? 2 : 1, mode);
    } finally { await f.close(); }
  }
});

test('actual native response reader refuses malformed/truncated/oversize/encoded bytes and does not follow redirect', async () => {
  for (const mode of ['duplicate-json', 'utf8', 'oversize', 'truncated', 'encoding', 'media', 'redirect']) {
    const f = await fixture((request, response) => {
      if (mode === 'duplicate-json') json(response, '{"id":1,"\\u0069d":2}');
      else if (mode === 'utf8') json(response, Buffer.from([0x22, 0xc3, 0x28, 0x22]));
      else if (mode === 'oversize') json(response, { body: 'x'.repeat(5000) });
      else if (mode === 'truncated') { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 50 }); response.end('{}'); }
      else if (mode === 'encoding') json(response, {}, { 'Content-Encoding': 'gzip' });
      else if (mode === 'media') json(response, {}, { 'Content-Type': 'text/html' });
      else json(response, { message: 'redirect' }, { Location: 'https://elsewhere.invalid/credential-tripwire' }, 302);
    });
    try {
      if (mode === 'redirect') assert.equal((await f.client.authenticatedUser()).status, 302);
      else await assert.rejects(f.client.authenticatedUser(), /GitHub read/);
      assert.equal(f.seen.length, 1);
    } finally { await f.close(); }
  }
});

test('whole-request deadline and caller cancellation close a real streaming socket', async () => {
  for (const mode of ['deadline', 'cancel']) {
    let closed;
    const close = new Promise(resolve => { closed = resolve; });
    const f = await fixture((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('[');
      const interval = setInterval(() => response.write(' '), 5);
      response.on('close', () => { clearInterval(interval); closed(); });
    }, { requestTimeoutMs: mode === 'deadline' ? 40 : 1000 });
    try {
      const abort = new AbortController();
      const pending = f.client.authenticatedUser(abort.signal);
      if (mode === 'cancel') setTimeout(() => abort.abort(), 30);
      await assert.rejects(pending, mode === 'deadline' ? /deadline/ : /cancelled/);
      await Promise.race([close, new Promise((_, reject) => setTimeout(() => reject(Error('socket did not close')), 500).unref())]);
      assert.equal(f.seen.length, 1);
    } finally { await f.close(); }
  }
});

test('repository observation binds actual User/repository and exposes unknown classic status without granting authority', async () => {
  for (const mode of ['healthy', 'wrong-repo', 'wrong-user']) {
    const f = await fixture((request, response) => {
      if (request.url === '/user') json(response, { id: 7, login: 'owner', type: mode === 'wrong-user' ? 'Bot' : 'User' });
      else if (request.url === '/repos/owner/repo') json(response, { id: 8, full_name: mode === 'wrong-repo' ? 'other/repo' : 'owner/repo', default_branch: 'main' });
      else if (request.url.endsWith('/protection')) json(response, { message: 'Not Found' }, {}, 404);
      else json(response, []);
    });
    try {
      if (mode === 'healthy') {
        const value = await inspectGitHubRepository(f.client, 'owner', 'repo');
        assert.deepEqual(value.actor, { id: 7, login: 'owner' });
        assert.deepEqual(value.repository, { id: 8, fullName: 'owner/repo', branch: 'main' });
        assert.equal(value.observations.classicTargetProtection.status, 404);
        assert.match(value.limitations.join('\n'), /404 is not absence proof/);
        assert.equal('allowed' in value, false); assert.equal(f.seen.length, 5);
      } else {
        await assert.rejects(inspectGitHubRepository(f.client, 'owner', 'repo'), /identity unavailable/);
        assert.equal(f.seen.length, 2);
      }
    } finally { await f.close(); }
  }
});

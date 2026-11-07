import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { nativeJsonTransport } from '../../dist/platform/github-transport.js';
import { fixedClassicTransport, readClassicTarget } from '../../dist/platform/github-classic.js';

const limits = { requestTimeoutMs: 500, responseBytes: 8192, pages: 20, collectionBytes: 65536, collectionItems: 100 };
const input = { owner: 'owner', name: 'repo', branch: 'main', repositoryNodeId: 'REPO' };
const reference = (name, id = name) => ({ __typename: 'Ref', id, name, prefix: 'refs/heads/', target: { __typename: 'Commit', oid: '1'.repeat(40) } });
const rule = id => ({ __typename: 'BranchProtectionRule', id, pattern: id === 'R1' ? 'm*' : 'other', repository: { id: 'REPO' } });
const connection = (nodes, index) => ({ nodes: nodes.slice(index, index + 1), totalCount: nodes.length,
  pageInfo: { hasNextPage: index + 1 < nodes.length, endCursor: index + 1 < nodes.length ? `cursor-${index + 1}` : null } });
async function fixture(mode = 'healthy', overrides = {}) {
  const seen = [];
  let inventoryStarts = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/graphql');
    assert.equal(request.headers.authorization, 'Bearer fixture-only');
    const body = JSON.parse(Buffer.concat(chunks)); seen.push(body);
    assert.match(body.query, /^query GitjigClassic(?:Inventory|Matching)/);
    assert.equal(body.variables.qualifiedName, 'refs/heads/main');
    const isInventory = body.query.includes('query GitjigClassicInventory');
    const index = body.variables.after === null ? 0 : Number(body.variables.after.replace('cursor-', ''));
    if (isInventory && index === 0) inventoryStarts++;
    const rules = mode === 'empty' ? [] : [rule('R1'), rule('R2')];
    if (mode === 'duplicate-rule') rules[1].id = 'R1';
    if (mode === 'foreign-parent') rules[0].repository.id = 'OTHER';
    if (mode === 'wrong-rule-type') rules[0].__typename = 'Repository';
    if (mode === 'inventory-swap' && inventoryStarts > 1) rules[1].id = 'R3';
    if (mode === 'pattern-drift' && inventoryStarts > 1) rules[1].pattern = 'new-pattern';
    const refs = body.variables.id === 'R1' ? [reference('main-old'), reference('main')] : [];
    if (mode === 'duplicate-ref') refs[1] && (refs[1].id = refs[0].id);
    if (mode === 'wrong-matching-target') { const main = refs.find(value => value.name === 'main'); if (main) main.target.oid = '2'.repeat(40); }
    if (mode === 'wrong-ref-type') refs[0] && (refs[0].__typename = 'Repository');
    const ref = reference('main');
    if (mode === 'target-drift' && !isInventory) ref.target.oid = '2'.repeat(40);
    const page = connection(isInventory ? rules : refs, index);
    if (mode === 'count-drift' && !isInventory && index === 1) page.totalCount++;
    if (mode === 'repeat-cursor' && !isInventory && index === 1) page.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
    if (mode === 'missing-final-item' && !isInventory && index === 1) page.nodes = [];
    if (mode === 'missing-info') delete page.pageInfo;
    const data = isInventory ? { repository: { __typename: 'Repository', id: 'REPO', nameWithOwner: 'owner/repo', ref, branchProtectionRules: page } }
      : { node: { ...rule(body.variables.id), repository: { id: 'REPO', ref }, matchingRefs: page } };
    if (mode === 'wrong-repo') data.repository && (data.repository.id = 'OTHER');
    if (mode === 'null-repo') data.repository = null;
    if (mode === 'null-rule' && !isInventory) data.node = null;
    const envelope = { data };
    if (mode === 'partial-error' && seen.length === 2) envelope.errors = [{ message: 'unavailable page' }];
    if (mode === 'refresh-page-error' && isInventory && inventoryStarts > 1 && index === 1) envelope.errors = [{ message: 'unavailable final refresh page' }];
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(envelope));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const selectedLimits = { ...limits, ...overrides };
  return { seen, transport: fixedClassicTransport(`http://127.0.0.1:${server.address().port}`, nativeJsonTransport('fixture-only', selectedLimits)), limits: selectedLimits,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('fixed GraphQL native HTTP completely reads all rule/ref pages and rechecks the complete inventory', async () => {
  for (const mode of ['healthy', 'empty']) {
    const f = await fixture(mode);
    try {
      const result = await readClassicTarget(f.transport, f.limits, input);
      assert.equal(result.completeVisibleConnections, true);
      assert.equal(result.visibility, 'not-established');
      assert.equal(result.absence, mode === 'healthy' ? 'present' : 'unknown');
      assert.deepEqual(result.matchedRuleIds, mode === 'healthy' ? ['R1'] : []);
      assert.equal(f.seen.length, mode === 'healthy' ? 7 : 2);
      assert.equal(result.responses.length, f.seen.length);
      assert.ok(result.responses.every(response => /^[a-f0-9]{64}$/.test(response.queryHash)));
      assert.equal('allowed' in result, false);
    } finally { await f.close(); }
  }
});

test('GraphQL partial errors, identity/cursor/count drift and global exhaustion never return a complete prefix', async () => {
  for (const mode of ['duplicate-rule', 'foreign-parent', 'wrong-rule-type', 'inventory-swap', 'pattern-drift', 'duplicate-ref', 'wrong-ref-type', 'wrong-matching-target', 'target-drift', 'null-rule', 'refresh-page-error',
    'count-drift', 'repeat-cursor', 'missing-final-item', 'missing-info', 'wrong-repo', 'null-repo', 'partial-error', 'request-limit', 'byte-limit', 'item-limit']) {
    const f = await fixture(mode, mode === 'request-limit' ? { pages: 1 } : mode === 'byte-limit' ? { collectionBytes: 1 } : mode === 'item-limit' ? { collectionItems: 1 } : {});
    try {
      await assert.rejects(readClassicTarget(f.transport, f.limits, input), /Classic/);
      assert.ok(f.seen.length <= 7, mode);
      if (['request-limit', 'byte-limit', 'foreign-parent', 'missing-info', 'wrong-repo', 'null-repo'].includes(mode)) assert.equal(f.seen.length, 1, mode);
    } finally { await f.close(); }
  }
});

test('cancel after an actual first GraphQL page prevents the next native request', async () => {
  const abort = new AbortController();
  const f = await fixture('healthy');
  try {
    const transport = async (...args) => {
      const response = await f.transport(...args);
      assert.equal(response.status, 200);
      if (f.seen.length === 1) abort.abort();
      return response;
    };
    await assert.rejects(readClassicTarget(transport, f.limits, input, abort.signal), /cancelled/);
    assert.equal(f.seen.length, 1);
  } finally { await f.close(); }
});

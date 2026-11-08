import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
const execute = promisify(execFile);
const snapshot = file => { const db = new DatabaseSync(file, { readOnly: true }); try { return { schema: db.prepare('PRAGMA user_version').get().user_version, tables: Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()])) }; } finally { db.close(); } };
test('fresh immutable installed update preserves7 data and drives managed goal author/reviewer through CLI', { timeout: 120000 }, async t => {
  assert.ok(process.env.GITJIG_GOAL_BUNDLE_RECEIPT && process.env.GITJIG_GOAL_OLD_BUNDLE, 'explicit frozen current and actual old bundle required');
  const built = JSON.parse(await fs.readFile(process.env.GITJIG_GOAL_BUNDLE_RECEIPT, 'utf8')), old = process.env.GITJIG_GOAL_OLD_BUNDLE;
  const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/goal-installed-'))), home = path.join(root, 'home'), launcher = path.join(home, 'gitjig'), records = [], requests = [], sockets = new Set();
  let server, incoming = 0;
  const serverErrors = [];
  await fs.mkdir(path.join(root, 'user'), { mode: 0o700 }); await fs.mkdir(path.join(root, 'tmp'), { mode: 0o700 });
  const env = { HOME: path.join(root, 'user'), TMPDIR: path.join(root, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', SHELL: '/bin/sh', USER: 'owned', LOGNAME: 'owned', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
  const run = async (file, args, code = 0, timeout = 10000) => { let result; try { result = await execute(file, args, { cwd: root, env, timeout, maxBuffer: 2 ** 20 }); } catch (error) { result = error; } records.push({ file, args, code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr }); assert.equal(result.code ?? 0, code, result.stderr); return JSON.parse(result.stdout); };
  const cli = (args, code = 0) => run(launcher, args, code);
  try {
    assert.equal((await run(path.join(old, 'install'), ['activate', '--home', home, '--bundle', old], 0, 45000)).active, true);
    env.TMPDIR = path.join(home, 'artifacts');
    const retained = await cli(['conversation', 'create']);
    const before = snapshot(path.join(home, 'state/controller.sqlite')); assert.equal(before.schema, 7);
    assert.equal((await run(path.join(built.destination, 'install'), ['activate', '--home', home, '--bundle', built.destination], 0, 45000)).payloadId, built.payloadId);
    const after = snapshot(path.join(home, 'state/controller.sqlite')); assert.equal(after.schema, 8);
    for (const [table, rows] of Object.entries(before.tables)) assert.deepEqual(after.tables[table], rows, 'Preserved original7 table ' + table);
    assert.deepEqual(Object.keys(after.tables).filter(x => !(x in before.tables)).sort(), ['goals', 'goal_attempts', 'goal_events', 'goal_reviews'].sort());
    assert.equal((await cli(['conversation', 'inspect', '--conversation', retained.conversationId])).conversationId, retained.conversationId);
    server = http.createServer(async (req, res) => {
      const attempt = ++incoming;
      try {
        assert.ok(attempt <= 6); assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer DUMMY-INSTALLED-GOAL');
        let data = ''; for await (const part of req) { data += part; assert.ok(data.length <= 1048576); }
        const body = JSON.parse(data); requests.push(body); assert.ok(['alpha', 'beta'].includes(body.model));
        const review = body.model === 'beta', last = body.messages.at(-1); let response;
        if (last.role === 'tool') response = { text: review ? 'Independent installed review settled' : 'Installed author result observed' };
        else if (review) { assert.deepEqual(body.tools.map(x => x.function.name).sort(), ['goal_review', 'goal_status', 'read']); response = { tool: { name: 'goal_review', arguments: { verdict: 'pass', reason: 'Current installed evidence meets criterion', findings: [], resolvedFindingIds: [] } } }; }
        else response = { tool: { name: 'goal_progress', arguments: { disposition: 'propose-completion', plan: 'Observe installed path', nextAction: 'Independent review', reason: 'Actual original installed turn', resultIds: [] } } };
        const stream = wireResponse('openai-completions', body.model, response); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(Buffer.from(await stream.arrayBuffer()));
      } catch (error) { serverErrors.push({ attempt, error: String(error) }); res.destroy(error); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = path.join(root, 'models.json'); await fs.writeFile(config, JSON.stringify({ providers: { 'goal-installed': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'DUMMY-INSTALLED-GOAL', models: [{ id: 'alpha', reasoning: false, contextWindow: 8192, maxTokens: 256 }, { id: 'beta', reasoning: false, contextWindow: 8192, maxTokens: 256 }] } } }), { mode: 0o600 });
    await cli(['models', 'configure', '--file', config]); await cli(['models', 'default', '--provider', 'goal-installed', '--model', 'alpha']); await cli(['models', 'role-set', '--role', 'reviewer', '--provider', 'goal-installed', '--model', 'beta']);
    // Original installed application creation, not SQL model/standing injection.
    const worker = path.join(root, 'conversation.mjs'), payload = path.join(home, 'versions', built.payloadId);
    await fs.writeFile(worker, `const{initializeApplicationEnvironment}=await import(${JSON.stringify('file://' + payload + '/dist/app/environment.js')});initializeApplicationEnvironment();const{openController}=await import(${JSON.stringify('file://' + payload + '/dist/controller/index.js')});const{ApplicationModels}=await import(${JSON.stringify('file://' + payload + '/dist/app/models.js')});const c=await openController({installationHome:${JSON.stringify(home)}});try{console.log(JSON.stringify(await new ApplicationModels(c).newConversation()));}finally{await c.close();}`);
    const conversation = await run(path.join(home, 'bootstrap/node'), [worker]);
    const make = async limit => cli(['goal', 'create', '--conversation', conversation.conversationId, '--objective', 'Verify installed goal execution', '--criteria', '["Actual installed author and independent reviewer settle"]', '--turn-limit', String(limit)]);
    const goal = await make(4), done = await cli(['goal', 'run', '--goal', goal.goalId, '--revision', String(goal.revision)]);
    assert.equal(done.state, 'COMPLETED'); assert.equal(done.startedAttempts, 2); assert.deepEqual(requests.map(x => x.model), ['alpha', 'alpha', 'beta', 'beta']);
    assert.equal((await cli(['goal', 'inspect', '--goal', goal.goalId])).acceptedReview.runId, done.acceptedReview.runId);
    const bounded = await make(1), exhausted = await cli(['goal', 'run', '--goal', bounded.goalId, '--revision', String(bounded.revision)], 2);
    assert.equal(exhausted.state, 'BUDGET_EXHAUSTED'); assert.equal(exhausted.startedAttempts, 1); assert.equal(requests.length, 6); assert.equal(incoming, 6); assert.deepEqual(serverErrors, []);
    const health = await cli(['health']); assert.equal(health.payloadId, built.payloadId);
    await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({ complete: true, root, home, payloadId: built.payloadId, schema: [before.schema, after.schema], oldTablesPreserved: Object.keys(before.tables).length, records, models: requests.map(x => x.model), goal: done, exhausted, health }, null, 2));
    t.diagnostic('Retained installed goal acceptance: ' + root);
  } finally { for (const socket of sockets) socket.destroy(); if (server) await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(root, 'invocations.json'), JSON.stringify({ records, incoming, requests, serverErrors }, null, 2)); t.diagnostic('Installed fixture retained: ' + root); }
});

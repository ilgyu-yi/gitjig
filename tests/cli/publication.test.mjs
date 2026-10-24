import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
const execute = promisify(execFile);

test('actual owner publication CLI preserves exact intent and same operation across SDK-free offline prepare/reopen', async t => {
  await fs.mkdir('.runtime-fixtures', { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/publication-cli-')));
  let accepted = false;
  t.after(async () => { if (accepted) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic(`Publication CLI failure retained: ${root}`); });
  const home = path.join(root, 'home'), targetFile = path.join(root, 'target.json'), payloadFile = path.join(root, 'payload.json');
  const target = { target: { host: 'github.com', repositoryId: 8, repositoryNodeId: 'REPO', owner: 'owner', repository: 'repo', actorUserId: 7 }, visibility: 'private' };
  const action = { kind: 'create-issue', title: '한국어 exact $() title', body: 'Original owner text\n{"literal":"한글, newline\\n"}' };
  await fs.writeFile(targetFile, JSON.stringify(target), { mode: 0o600 });
  await fs.writeFile(payloadFile, JSON.stringify(action), { mode: 0o600 });
  const run = async args => {
    try { const value = await execute(process.execPath, ['--import', path.resolve('tests/cli/no-sdk-loader.mjs'), path.resolve('dist/cli/main.js'), ...args], { timeout: 5000 }); return { code: 0, ...value }; }
    catch (error) { if (typeof error.code === 'number') return { code: error.code, stdout: error.stdout, stderr: error.stderr }; throw error; }
  };
  const registered = await run(['publication', 'register-target', '--home', home, '--target-profile', targetFile]);
  assert.equal(registered.code, 0, registered.stderr); const targetId = JSON.parse(registered.stdout).targetId;
  const prepare = ['publication', 'prepare', '--home', home, '--target', targetId, '--payload-file', payloadFile];
  const first = await run(prepare); assert.equal(first.code, 2, first.stdout + first.stderr);
  const view = JSON.parse(first.stdout); assert.equal(view.activation, 'disabled'); assert.equal(view.phase, 'REFUSED');
  assert.ok(view.blocked.length); assert.match(view.payloadHash, /^[a-f0-9]{64}$/); assert.ok(view.workId && view.operationId);
  const inspected = await run(['publication', 'inspect', '--home', home, '--operation', view.operationId]);
  assert.equal(inspected.code, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).payloadHash, view.payloadHash);
  const resumed = await run([...prepare, '--operation', view.operationId]);
  assert.equal(resumed.code, 2, resumed.stdout + resumed.stderr); const again = JSON.parse(resumed.stdout);
  assert.equal(again.workId, view.workId); assert.equal(again.operationId, view.operationId); assert.equal(again.payloadHash, view.payloadHash);
  const db = new DatabaseSync(path.join(home, 'state', 'controller.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM effect_operations').get().n, 1);
    const source = db.prepare('SELECT s.raw,w.project FROM sources s JOIN works w ON w.source=s.id WHERE w.id=?').get(view.workId);
    assert.equal(source.project, null); assert.deepEqual(JSON.parse(source.raw), action);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='publication-send'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM role_launches').get().n, 0);
  } finally { db.close(); }
  assert.deepEqual(JSON.parse(await fs.readFile(payloadFile, 'utf8')), action);
  accepted = true;
});

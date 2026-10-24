import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));
const tripwire = fileURLToPath(new URL('./no-sdk-loader.mjs', import.meta.url));
test('offline conversation graph survives separate CLI owners without SDK or artificial project', async t => {
  const base = path.resolve('.runtime-fixtures'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'cli-conversation-'));
  const home = path.join(root, 'home'); let accepted = false;
  t.after(async () => { if (accepted) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic(`Failure fixture retained: ${root}`); });
  async function run(words) {
    const result = await exec(process.execPath, ['--import', tripwire, cli, 'conversation', ...words, '--home', home], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout);
  }
  const a = await run(['create']), b = await run(['create']);
  assert.equal(a.projectId, null); assert.equal(b.projectId, null); assert.notEqual(a.conversationId, b.conversationId);
  const related = await run(['parent', '--conversation', b.conversationId, '--parent', a.conversationId, '--revision', String(b.relationRevision)]);
  assert.equal(related.parentId, a.conversationId);
  await assert.rejects(run(['parent', '--conversation', a.conversationId, '--parent', b.conversationId, '--revision', String(a.relationRevision)]), error => {
    assert.equal(error.code, 2); assert.ok(error.stderr); return true;
  });
  const reopened = await run(['inspect', '--conversation', b.conversationId]);
  assert.equal(reopened.parentId, a.conversationId); assert.equal(reopened.workId, null);
  const detached = await run(['parent', '--conversation', b.conversationId, '--revision', String(reopened.relationRevision)]);
  assert.equal(detached.parentId, null);
  const listed = await run(['list']); assert.deepEqual(listed.map(c => c.conversationId).sort(), [a.conversationId, b.conversationId].sort());
  const projects = await exec(process.execPath, ['--import', tripwire, cli, 'project', 'list', '--home', home], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(projects.stdout), []);
  t.diagnostic(JSON.stringify({ sdkImportTripwire: true, separateOwnerReopens: true, artificialProjects: 0, modelCalls: 0 }));
  const source = path.join(root, 'source'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'owner.txt'), 'registered scope input');
  await exec(process.execPath, ['--import', tripwire, cli, 'project', 'register', '--home', home, '--id', 'P', '--root', source], { timeout: 10_000 });
  const scoped = await run(['project', '--conversation', a.conversationId, '--project', 'P', '--generation', String(a.generation)]);
  assert.equal(scoped.projectId, 'P'); assert.equal(scoped.workId, null); assert.equal(scoped.generation, a.generation + 1);
  assert.equal((await run(['inspect', '--conversation', a.conversationId])).projectId, 'P');
  await assert.rejects(run(['project', '--conversation', a.conversationId, '--project', 'P', '--generation', String(a.generation)]));
  accepted = true;
});

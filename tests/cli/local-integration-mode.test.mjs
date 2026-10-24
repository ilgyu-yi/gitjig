import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
const execute = promisify(execFile);

test('public local target needs no hosted credential and refuses owner override before creating a grant or source', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/local-owner-mode-')));
  const source = path.join(root, 'source'), home = path.join(root, 'home'), receiver = path.join(root, 'receiver.git');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=1;\n');
  const git = '/opt/homebrew/bin/git', env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '' };
  delete env.NODE_TEST_CONTEXT;
  const command = args => execute(git, ['-c', 'core.hooksPath=/dev/null', ...args], { env, timeout: 5000 });
  await command(['init', '--quiet', '--template=', '--initial-branch=main', source]);
  await command(['-C', source, 'add', '--', 'consumer.cjs']);
  await command(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'Synthetic baseline']);
  const basisCommit = (await command(['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
  await command(['init', '--bare', '--quiet', '--template=', receiver]);
  await command(['-C', source, 'push', '--quiet', receiver, 'HEAD:refs/heads/main']);
  let c = await openController({ installationHome: home }); let workId;
  try { await c.registerProject({ id: 'P', sourceRoot: source }); workId = (await c.beginChange({ projectId: 'P', request: 'Owner delegation fixture; no agent execution' })).workId; }
  finally { await c.close(); }
  const profile = path.join(root, 'target.json');
  await fs.writeFile(profile, JSON.stringify({ projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit, publicationInventory: ['consumer.cjs'], authorizedDeltaPaths: ['consumer.cjs'] }), { mode: 0o600 });
  const calls = [], call = async args => {
    let result;
    try { result = { code: 0, ...await execute(process.execPath, ['--import', path.resolve('tests/cli/no-sdk-loader.mjs'), '--import', path.resolve('tests/normal-hosted/no-external.mjs'), path.resolve('dist/cli/main.js'), args[0], args[1], '--home', home, ...args.slice(2)], { cwd: source, env, timeout: 10000 }) }; }
    catch (error) { if (typeof error.code !== 'number') throw error; result = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    calls.push({ args, ...result }); return result;
  };
  const registered = await call(['effect', 'register-target', '--target-profile', profile, '--git-binary', git]);
  assert.equal(registered.code, 0, registered.stderr + registered.stdout); const { targetId } = JSON.parse(registered.stdout);
  const counts = async () => { c = await openController({ installationHome: home }); try { return { sources: c.store.one('SELECT COUNT(*) n FROM sources').n, grants: c.store.one('SELECT COUNT(*) n FROM effect_delegations').n }; } finally { await c.close(); } };
  const before = await counts();
  const denied = await call(['effect', 'delegate-integration', '--work', workId, '--target', targetId, '--operation-limit', '1', '--mode', 'owner-override']);
  assert.notEqual(denied.code, 0); assert.match(denied.stderr + denied.stdout, /Invalid finite ordinary integration grant/);
  assert.deepEqual(await counts(), before);
  const ordinary = await call(['effect', 'delegate-integration', '--work', workId, '--target', targetId, '--operation-limit', '1']);
  assert.equal(ordinary.code, 0, ordinary.stderr + ordinary.stdout); assert.ok(JSON.parse(ordinary.stdout).delegationId);
  assert.deepEqual(await counts(), { sources: before.sources + 1, grants: before.grants + 1 });
  assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=1;\n');
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({ root, home, workId, targetId, before, after: await counts(), calls, externalCalls: 0, modelCalls: 0 }, null, 2));
  t.diagnostic('Retained local override refusal ' + root);
});

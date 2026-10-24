import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openController } from '../../dist/controller/index.js';
import { subject, initial } from '../controller/hosted-core-fixture.mjs';
import { modelServer } from './normal-hosted-model.mjs';
const execute = promisify(execFile);

test('public normal hosted CLI registers, checks and reviews through HTTP SDK, then renews the same operation in a distinct dispatch process', { timeout: 90000 }, async t => {
  assert.ok(process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'Explicit actual engine required');
  const f = await subject({ normalNative: true, retainSuccess: true }), model = await modelServer();
  const home = path.join(f.native.root, 'home'), calls = [], env = {
    ...process.env, TMPDIR: path.join(home, 'artifacts'), NODE_OPTIONS: '', NODE_PATH: '', PI_PACKAGE_DIR: '',
    TEST_NORMAL_REST_ORIGIN: f.rest.origin,
    TEST_NORMAL_HTTPS_PROFILE: JSON.stringify({ origin: f.native.origin, caFile: f.native.ca, execPath: f.native.execPath }),
  };
  delete env.NODE_TEST_CONTEXT;
  const write = async (name, value) => { const file = path.join(f.native.root, name); await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file; };
  const runtime = ['--docker-binary', '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--image', process.env.GITJIG_RUNTIME_IMAGE];
  const git = ['--git-binary', '/opt/homebrew/bin/git'];
  const call = async (args, sdk = false) => {
    const argv = [...(!sdk ? ['--import', path.resolve('tests/cli/no-sdk-loader.mjs')] : []), '--import', path.resolve('tests/cli/normal-hosted-adapter.mjs'), path.resolve('dist/cli/main.js'), args[0], args[1], '--home', home, ...args.slice(2)];
    let result;
    try { result = { ...await execute(process.execPath, argv, { env, timeout: 45000, maxBuffer: 4 * 2 ** 20 }), code: 0 }; }
    catch (error) { if (typeof error.code !== 'number') throw error; result = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    calls.push({ command: args.slice(0, 2), code: result.code, stdout: result.stdout, stderr: result.stderr });
    await fs.writeFile(path.join(f.native.root, 'normal-cli-calls.json'), JSON.stringify(calls, null, 2));
    return result;
  };
  const good = result => { assert.equal(result.code, 0, result.stdout + result.stderr); return JSON.parse(result.stdout); };
  const capture = async operation => { const c = await openController({ installationHome: home }); try { const row = c.store.one('SELECT * FROM effect_operations WHERE id=?', operation); return { ...row, data: JSON.parse(row.data) }; } finally { await c.close(); } };
  t.diagnostic('Retained actual normal hosted CLI world ' + f.native.root);
  try {
    await f.c.close();
    const targetFile = await write('normal-target.json', { kind: 'github-existing-ref', ...f.registration });
    const credential = await write('normal-credential.json', { token: f.native.token });
    const modelFile = await write('normal-model.json', model.profile);
    const { targetId } = good(await call(['effect', 'register-target', '--target-profile', targetFile, '--credential-profile', credential, ...git]));
    const ready = good(await call(['change', 'start', '--project', 'P', '--message', 'Consumer must export3; publish only agent delta and keep the preexisting owner choice local.', '--model-profile', modelFile, ...runtime], true));
    assert.equal(ready.reviewReady, true);
    const prepare = ['effect', 'prepare-integration', '--work', ready.workId, '--target', targetId, '--model-profile', modelFile, '--credential-profile', credential, ...git, ...runtime];
    const rolesBefore = model.requests.length, denied = await call(prepare, true);
    assert.notEqual(denied.code, 0); assert.equal(model.requests.length, rolesBefore); assert.equal(f.native.requests.filter(r => r.path.endsWith('/git-receive-pack')).length, 0);
    good(await call(['effect', 'delegate-integration', '--work', ready.workId, '--target', targetId, '--operation-limit', '1']));
    const prepared = good(await call(prepare, true)); assert.equal(prepared.phase, 'RESERVED'); assert.notEqual(prepared.candidateVersion, ready.candidateVersion);
    const old = await capture(prepared.operationId);
    const sent = good(await call(['effect', 'dispatch', '--operation', prepared.operationId, '--credential-profile', credential, ...git]));
    assert.equal(sent.phase, 'CONFIRMED'); const current = await capture(prepared.operationId);
    assert.equal(current.id, old.id); assert.equal(current.work, old.work); assert.equal(current.grant_id, old.grant_id);
    assert.notEqual(current.data.authority.credentialSessionId, old.data.authority.credentialSessionId);
    assert.equal(current.data.authority.policy.fingerprint, old.data.authority.policy.fingerprint);
    assert.equal(f.native.requests.filter(r => r.path.endsWith('/git-receive-pack')).length, 1);
    assert.equal((await f.native.command(['show', 'refs/heads/main:consumer.cjs'])).toString(), initial.replace('exports=2', 'exports=3'));
    assert.equal(await fs.readFile(path.join(f.source, 'consumer.cjs'), 'utf8'), initial.replace('choice: 10', 'choice: 11'));
    assert.equal(good(await call(['effect', 'inspect', '--operation', sent.operationId])).phase, 'CONFIRMED');
    const receipt = { root: f.native.root, home, operationId: sent.operationId, workId: sent.workId, targetId, phase: sent.phase, nativePushes: 1, oldCapture: old.data.authority.credentialSessionId, newCapture: current.data.authority.credentialSessionId, fingerprint: current.data.authority.policy.fingerprint, actualOfficialHttpRoles: model.requests, separateCliProcesses: true, sourcePreserved: true, externalCalls: 0 };
    await fs.writeFile(path.join(f.native.root, 'normal-cli-receipt.json'), JSON.stringify(receipt, null, 2));
    t.diagnostic(JSON.stringify(receipt));
  } finally { await model.close(); await f.close(); }
});

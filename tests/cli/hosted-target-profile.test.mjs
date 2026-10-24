import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseInvocation } from '../../dist/cli/arguments.js';
const exec = promisify(execFile);

test('hosted target profile accepts only literal public identity/scope and keeps legacy local input, without SDK or network', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/hosted-target-profile-')));
  t.diagnostic('Retained hosted target profiles ' + root);
  const project = path.join(root, 'project'); await fs.mkdir(project);
  const file = path.join(root, 'target.json');
  const hosted = {
    kind: 'github-existing-ref', projectId: 'P',
    repository: { owner: 'owner', repository: 'repo', repositoryId: 12, repositoryNodeId: 'R12', visibility: 'public' },
    expectedUserId: 7, ref: 'refs/heads/main', basisCommit: 'a'.repeat(40),
    publicationInventory: ['한국어 공백.txt', 'literal$().txt'], authorizedDeltaPaths: ['한국어 공백.txt'],
  };
  const script = `import {readTargetProfile} from ${JSON.stringify(path.resolve('dist/cli/target-profile.js'))};console.log(JSON.stringify(await readTargetProfile(process.argv[1],[process.argv[2]])));`;
  const read = async value => {
    await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
    return exec(process.execPath, ['--import', path.resolve('tests/cli/no-sdk-loader.mjs'), '--import', path.resolve('tests/normal-hosted/no-external.mjs'), '--input-type=module', '-e', script, file, project], { timeout: 5000 });
  };
  assert.deepEqual(JSON.parse((await read(hosted)).stdout), hosted);
  const local = { projectId: 'P', path: path.join(root, 'receiver'), ref: hosted.ref, basisCommit: hosted.basisCommit,
    publicationInventory: hosted.publicationInventory, authorizedDeltaPaths: hosted.authorizedDeltaPaths };
  assert.deepEqual(JSON.parse((await read(local)).stdout), local);
  for (const value of [
    { ...hosted, kind: 'local-git' }, { ...hosted, path: local.path },
    { ...local, repository: hosted.repository },
    { ...hosted, repository: { ...hosted.repository, origin: 'https://attacker.invalid' } },
    { ...hosted, repository: { ...hosted.repository, canWrite: true } },
    { ...hosted, repository: { ...hosted.repository, visibility: 'private' } },
    { ...hosted, repository: { ...hosted.repository, repositoryId: '12' } },
    { ...hosted, expectedUserId: 0 }, { ...hosted, ref: 'refs/heads/../main' },
    { ...hosted, ref: ['refs/heads/main'] }, { ...hosted, basisCommit: ['a'.repeat(40)] },
    { ...hosted, publicationInventory: ['../outside'] },
    { ...hosted, publicationInventory: ['dir\\outside'] },
    { ...hosted, authorizedDeltaPaths: ['same', 'same'] },
    { ...hosted, authority: { accepted: true } },
  ]) await assert.rejects(read(value));
});

test('hosted credentials and explicit owner mode are finite CLI options; offline inspect and model-like authority flags refuse', () => {
  for (const words of [['effect', 'register-target'], ['effect', 'prepare-integration'], ['effect', 'dispatch'], ['effect', 'reconcile']]) {
    assert.equal(parseInvocation([...words, '--credential-profile', '/owner/credential']).options.get('credential-profile'), '/owner/credential');
  }
  assert.equal(parseInvocation(['effect', 'delegate-integration', '--mode', 'owner-override']).options.get('mode'), 'owner-override');
  assert.throws(() => parseInvocation(['effect', 'inspect', '--credential-profile', '/owner/credential']));
  assert.throws(() => parseInvocation(['effect', 'dispatch', '--mode', 'owner-override']));
  assert.throws(() => parseInvocation(['effect', 'dispatch', '--authority', 'accepted']));
});

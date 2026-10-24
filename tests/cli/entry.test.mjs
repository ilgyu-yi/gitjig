import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));
const tripwire = fileURLToPath(new URL('./no-sdk-loader.mjs', import.meta.url));
function launch(args) {
  const child = spawn(process.execPath, ['--import', tripwire, cli, ...args], { shell: false });
  const result = new Promise((resolve, reject) => {
    const stdout = [], stderr = []; let bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
      bytes += chunk.length; if (bytes > 4 * 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk);
    });
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }); });
  });
  return { child, result };
}
async function run(args) { return launch(args).result; }
async function waitForScratchBarrier(workId) {
  const binary = process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker';
  const prefix = ['--context', process.env.GITJIG_DOCKER_CONTEXT];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const listing = await execFileAsync(binary, [...prefix, 'ps', '--filter', `label=gitjig.work=${workId}`, '--format', '{{.ID}}'], { timeout: 3000 });
    const id = listing.stdout.trim();
    if (id) {
      try {
        await execFileAsync(binary, [...prefix, 'exec', id, '/bin/bash', '-lc', 'test -f /scratch/ready'], { timeout: 3000 });
        return id;
      } catch { /* Actual readiness predicate, not an elapsed-time race assumption. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Resumed command never reached actual scratch barrier for ${workId}`);
}

async function fixture(t) {
  const base = path.resolve('.runtime-fixtures'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'cli-controller-'));
  let accepted = false;
  t.after(async () => {
    if (accepted) await fs.rm(root, { recursive: true, force: true });
    else t.diagnostic(`Failure fixture retained for exact producer reconciliation: ${root}`);
  });
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  await fs.mkdir(project, { mode: 0o700 });
  return { root, home, project, accept: () => { accepted = true; } };
}
test('CLI syntax refusals do not allocate state; help loads no Pi', async t => {
  const { home, accept } = await fixture(t);
  assert.equal((await run(['--help'])).code, 0);
  for (const args of [
    ['local', 'check', '--home', home, '--project', 'p'],
    ['local', 'git', '--home', home, '--project', 'p'],
    ['local', 'git', '--home', home, '--project', 'p', '--git-binary', 'git'],
    ['local', 'git', '--home', home, '--git-binary', '/unused'],
    ['local', 'conventions', '--home', home],
    ['local', 'configure', '--home', home, '--project', 'p', '--revision', '-1', '--profile', '/unused'],
    ['local', 'configure', '--home', home, '--project', 'p', '--revision', '0'],
    ['local', 'prepare', '--home', home, '--project', 'p', '--git-binary', '/unused'],
    ['local', 'evidence', '--home', home, '--project', 'p', '--git-binary', '/unused'],
    ['local', 'candidate', '--home', home, '--project', 'p', '--git-binary', '/unused', '--message-file', '/unused'],
    ['local', 'candidate', '--home', home, '--project', 'p', '--work', 'w', '--git-binary', '/unused'],
    ['local', 'candidate', '--home', home, '--project', 'p', '--work', 'w', '--git-binary', '/unused', '--message-file', 'relative'],
    ['local', 'audit', '--home', home, '--project', 'p', '--candidate', 'id', '--git-binary', '/unused'],
    ['local', 'audit', '--home', home, '--project', 'p', '--commit', 'HEAD', '--git-binary', '/unused'],
    ['local', 'candidates', '--home', home],
    ['local', 'evidence', '--home', home, '--project', 'p', '--work', 'w', '--git-binary', 'git'],
    ['project', 'list', '--home', home, '--home', home],
    ['project', 'register', '--home', home, '--id', 'p', '--root'],
    ['project', 'list', '--home', home, '--actor', 'human'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo', '--credential-profile', '/unused', '--provider', 'other'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo', '--credential-profile', '/unused', '--provider', 'gitea'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo', '--credential-profile', '/unused', '--api-base', 'https://forge.example/api/v1'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo', '--credential-profile', '/unused', '--provider', 'gitea', '--api-base', 'http://forge.example/api/v1'],
    ['repo', 'inspect', '--home', home, '--owner', 'group/..', '--repo', 'repo', '--credential-profile', '/unused', '--provider', 'gitlab', '--api-base', 'https://forge.example/api/v4'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--credential-profile', '/unused'],
    ['repo', 'inspect', '--home', home, '--owner', 'owner', '--repo', 'repo', '--credential-profile', '/unused', '--actor', 'human'],
    ['work', 'cancel', '--home', home, '--work', 'w', '--epoch', '-1'],
    ['work', 'resume', '--home', home, '--work', 'w', '--command', 'true', '--model-profile', '/unused'],
    ['work', 'extend', '--home', home, '--work', 'w', '--units', '0', '--reason', 'invalid'],
    ['change', 'prepare', '--home', home, '--project', 'p', '--message', 'intent', '--resolution-limit', '0'],
    ['change', 'replan', '--home', home, '--work', 'w', '--model-profile', '/unused', '--maximum-steps', '1'],
    ['change', 'extend-resolution', '--home', home, '--work', 'w', '--units', '101', '--reason', 'invalid'],
    ['conversation', 'inspect', '--home', home],
    ['conversation', 'parent', '--home', home, '--conversation', 'c', '--revision', '-1'],
    ['conversation', 'project', '--home', home, '--conversation', 'c', '--project', 'p'],
    ['conversation', 'project', '--home', home, '--conversation', 'c', '--project', 'p', '--generation', '-1'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--project', 'p', '--conversation', 'c'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--delegate-projects', 'P,P'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--delegate-projects', 'P,'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--max-assignments', '101'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--completed-view-limit', '101'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--view-idle-grace-ms', '-1'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--view-idle-grace-ms', '86400001'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--delegate-integrations', 'P:T:0'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--delegate-integrations', 'P:T:1,P:T:2'],
    ['conversation', 'ui', '--home', home, '--model-profile', '/unused', '--delegate-integrations', 'P:T:1'],
    ['effect', 'register-target', '--home', home, '--target-profile', '/unused'],
    ['effect', 'register-target', '--home', home, '--target-profile', '/unused', '--git-binary', 'git'],
    ['effect', 'inspect', '--home', home],
    ['effect', 'dispatch', '--home', home, '--operation', 'O'],
    ['effect', 'dispatch', '--home', home, '--operation', 'O', '--git-binary', '/unused', '--git-timeout-ms', '0'],
    ['effect', 'reconcile', '--home', home, '--operation', 'O', '--git-binary', '/unused', '--git-output-bytes', '16777217'],
    ['effect', 'delegate-integration', '--home', home, '--work', 'W', '--target', 'T', '--operation-limit', '101'],
    ['effect', 'delegate-integration', '--home', home, '--work', 'W', '--target', 'T', '--operation-limit', '1', '--scope', 'all'],
    ['effect', 'delegate-integration', '--home', home, '--work', 'W', '--target', 'T', '--operation-limit', '1', '--actor', 'owner'],
    ['publication', 'register-target', '--home', home],
    ['publication', 'delegate', '--home', home, '--work', 'W', '--target', 'T', '--grant-profile', '/unused', '--operation-limit', '0'],
    ['publication', 'delegate', '--home', home, '--work', 'W', '--target', 'T', '--grant-profile', '/unused', '--operation-limit', '1', '--scope', 'all'],
    ['publication', 'prepare', '--home', home, '--target', 'T'],
    ['publication', 'prepare', '--home', home, '--target', 'T', '--payload-file', '/unused', '--actor', 'owner'],
    ['publication', 'dispatch', '--home', home, '--operation', 'O'],
    ['publication', 'reconcile', '--home', home, '--credential-profile', '/unused'],
    ['publication', 'inspect', '--home', home],
  ]) {
    const result = await run(args); assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stderr).error, 'USAGE');
    await assert.rejects(fs.stat(home), { code: 'ENOENT' },JSON.stringify(args));
  }
  accept();
});
test('valid execution syntax without saved runtime opens owned setup but allocates no work or execution',async t=>{
 const {home,accept}=await fixture(t);
 for(const args of [
  ['work','resume','--home',home,'--work','w','--message','new instruction'],
  ['change','start','--home',home,'--project','p','--message','intent'],
  ['change','run','--home',home,'--work','w','--model-profile','/unused'],
  ['change','replan','--home',home,'--work','w'],
  ['change','replan','--home',home,'--work','w','--model-profile','/unused'],
  ['effect','prepare-integration','--home',home,'--work','W','--target','T','--git-binary','/unused'],
 ]){const result=await run(args);assert.equal(result.code,2,result.stderr);const error=JSON.parse(result.stderr);assert.equal(error.error,'USAGE');assert.match(error.message,/saved setup or complete RUNTIME options/);}
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});
 try{for(const table of ['works','sources','runs','role_launches','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
 accept();
});
test('CLI actual local consumer survives SDK import tripwire, preserves original source and retained failed observation', { timeout: 90_000 }, async t => {
  assert.ok(process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'Actual selected engine/image required');
  const { home, project, accept } = await fixture(t);
  const original = 'dirty/generated owner input\n'; await fs.writeFile(path.join(project, 'owner.txt'), original);
  const register = await run(['project', 'register', '--home', home, '--id', 'p', '--root', project]);
  assert.equal(register.code, 0, register.stderr);
  const listed = await run(['project', 'list', '--home', home]);
  assert.equal(listed.code, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout)[0].sourceRoot, project);
  const runtime = ['--docker-binary', process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--image', process.env.GITJIG_RUNTIME_IMAGE];
  const command = 'if printf forbidden > /work/owner.txt 2>/dev/null; then exit 91; fi; cp /work/owner.txt /scratch/copied.txt; printf changed >> /scratch/copied.txt; test -s /scratch/copied.txt; printf ACTUAL_LOCAL_OK';
  const healthy = await run(['local', 'check', '--home', home, '--project', 'p', '--command', command, ...runtime]);
  assert.equal(healthy.code, 0, healthy.stdout + healthy.stderr);
  const observation = JSON.parse(healthy.stdout);
  assert.equal(observation.kind, 'command-observation'); assert.equal(observation.exitCode, 0);
  assert.equal(observation.scratchInput, 'mutable-or-unknown'); assert.match(observation.stdout, /ACTUAL_LOCAL_OK/);
  assert.equal(await fs.readFile(path.join(project, 'owner.txt'), 'utf8'), original);
  const failure = await run(['local', 'check', '--home', home, '--project', 'p', '--command', 'printf REAL_FAILURE >&2; exit 37', ...runtime]);
  assert.equal(failure.code, 1, failure.stdout + failure.stderr);
  const failed = JSON.parse(failure.stdout); assert.equal(failed.exitCode, 37); assert.equal(failed.status, 'failed');
  const inspected = await run(['work', 'inspect', '--home', home, '--work', failed.workId]);
  assert.equal(inspected.code, 0, inspected.stderr);
  const reopened = JSON.parse(inspected.stdout);
  assert.equal(reopened.currentResult.exitCode, 37); assert.equal(reopened.allowance.consumed, 1); assert.equal(reopened.allowance.reserved, 0);
  assert.equal(await fs.readFile(path.join(project, 'owner.txt'), 'utf8'), original);
  const resumed = launch(['work', 'resume', '--home', home, '--work', failed.workId, '--command', 'printf READY > /scratch/ready; while :; do sleep 1; done', ...runtime]);
  await waitForScratchBarrier(failed.workId);
  assert.equal(resumed.child.kill('SIGINT'), true);
  const cancelled = await resumed.result;
  assert.equal(cancelled.code, 2, cancelled.stdout + cancelled.stderr);
  const afterCancel = await run(['work', 'inspect', '--home', home, '--work', failed.workId]);
  assert.equal(afterCancel.code, 0, afterCancel.stderr);
  const cancelledWork = JSON.parse(afterCancel.stdout);
  assert.equal(cancelledWork.state, 'CANCELLED');
  assert.equal(cancelledWork.allowance.consumed, 2); assert.equal(cancelledWork.allowance.reserved, 0);
  assert.notEqual(cancelledWork.currentResult?.status, 'succeeded');
  const extended = await run(['work', 'extend', '--home', home, '--work', failed.workId, '--units', '1', '--reason', 'Bounded follow-up after cancellation']);
  assert.equal(extended.code, 0, extended.stderr);
  const extension = JSON.parse(extended.stdout);
  assert.equal(extension.allowance.limit, 9); assert.equal(extension.allowance.consumed, 2);
  assert.equal(extension.state, 'CANCELLED');
  const remaining = await execFileAsync(process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', ['--context', process.env.GITJIG_DOCKER_CONTEXT, 'ps', '-aq', '--filter', `label=gitjig.work=${failed.workId}`], { timeout: 3000 });
  assert.equal(remaining.stdout.trim(), '');
  t.diagnostic(JSON.stringify({ consumer: 'real CLI → SQLite/capture → restricted runtime → retained result → reopen', sdkImportTripwire: true, liveModelCalls: 0 }));
  accept();
});
test('CLI default continuation retains the owner command scratch cwd', { timeout: 45_000 }, async t => {
  assert.ok(process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'Actual selected engine/image required');
  const { home, project, accept } = await fixture(t);
  await fs.writeFile(path.join(project, 'original.txt'), 'unchanged');
  assert.equal((await run(['project', 'register', '--home', home, '--id', 'p', '--root', project])).code, 0);
  const runtime = ['--docker-binary', process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', '--docker-context', process.env.GITJIG_DOCKER_CONTEXT, '--image', process.env.GITJIG_RUNTIME_IMAGE];
  const initial = await run(['local', 'check', '--home', home, '--project', 'p', '--cwd', 'scratch', '--command', 'printf SCRATCH > retained.txt; cat retained.txt', ...runtime]);
  assert.equal(initial.code, 0, initial.stdout + initial.stderr);
  const first = JSON.parse(initial.stdout); assert.equal(first.actualCwd, '/scratch');
  const resumed = await run(['work', 'resume', '--home', home, '--work', first.workId, ...runtime]);
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  const second = JSON.parse(resumed.stdout); assert.equal(second.actualCwd, '/scratch'); assert.match(second.stdout, /SCRATCH/);
  assert.equal(second.workId, first.workId); assert.notEqual(second.runId, first.runId);
  await assert.rejects(fs.stat(path.join(project, 'retained.txt')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(project, 'original.txt'), 'utf8'), 'unchanged');
  accept();
});
test('CLI governed preparation and resolution allowance are offline, source-preserving and do not imply review-ready', async t => {
  const { home, project, accept } = await fixture(t);
  const original = 'owner dirty input survives activation';
  await fs.writeFile(path.join(project, 'source.txt'), original);
  const registered = await run(['project', 'register', '--home', home, '--id', 'p', '--root', project]);
  assert.equal(registered.code, 0, registered.stderr);
  const prepared = await run(['change', 'prepare', '--home', home, '--project', 'p', '--message', '중복 요청이 한 번만 처리되도록 고쳐라.', '--resolution-limit', '5', '--execution-limit', '12']);
  assert.equal(prepared.code, 0, prepared.stdout + prepared.stderr);
  const work = JSON.parse(prepared.stdout);
  assert.equal(work.phase, 'BASE_CAPTURED'); assert.equal(work.reviewReady, false); assert.ok(work.baseVersion);
  assert.equal(work.resolution.limit, 5); assert.equal(work.resolution.consumed, 0);
  const inspected = await run(['change', 'inspect', '--home', home, '--work', work.workId]);
  assert.equal(inspected.code, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).baseVersion, work.baseVersion);
  const extended = await run(['change', 'extend-resolution', '--home', home, '--work', work.workId, '--units', '2', '--reason', 'Owner authorizes two bounded resolution invocations']);
  assert.equal(extended.code, 0, extended.stdout + extended.stderr);
  const extension = JSON.parse(extended.stdout);
  assert.equal(extension.resolution.limit, 7); assert.equal(extension.resolution.consumed, 0); assert.equal(extension.reviewReady, false);
  const raw = await run(['work', 'inspect', '--home', home, '--work', work.workId]);
  assert.equal(raw.code, 0, raw.stderr);
  assert.match(JSON.stringify(JSON.parse(raw.stdout).source), /중복 요청/);
  assert.equal(await fs.readFile(path.join(project, 'source.txt'), 'utf8'), original);
  accept();
});

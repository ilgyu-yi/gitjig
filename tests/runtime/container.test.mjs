import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as wait} from 'node:timers/promises';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {scopeJournalsRemoved} from './fixture-cleanup.mjs';
import {createScope, reconcileScope} from '../../dist/execution/container-scope.js';

const exec = promisify(execFile);
const context = process.env.GITJIG_DOCKER_CONTEXT;
const image = process.env.GITJIG_RUNTIME_IMAGE;
const dockerBinary = '/opt/homebrew/bin/docker';
const fixtureRoot = path.resolve(process.env.GITJIG_RUNTIME_FIXTURE_ROOT ?? '.runtime-fixtures');

async function docker(...args) {
  assert.ok(context, 'Set GITJIG_DOCKER_CONTEXT to the explicit provisioned engine');
  return exec(dockerBinary, ['--context', context, ...args], {timeout: 15000, maxBuffer: 1024 * 1024});
}

async function fixture(t, extra = {}) {
  assert.ok(context && image, 'Actual engine context and immutable image are required; unavailable is not a pass');
  await fs.mkdir(fixtureRoot, {recursive: true});
  const root = await fs.mkdtemp(path.join(fixtureRoot, 'runtime-'));
  const workRoot = path.join(root, 'work');
  const stateRoot = path.join(root, 'state');
  await fs.mkdir(workRoot); await fs.mkdir(stateRoot);
  const scopes = [];
  t.after(async () => {
    const results = await Promise.allSettled(scopes.map(scope => scope.close()));
    const journalsRemoved = await scopeJournalsRemoved(stateRoot);
    const complete = results.every(result => result.status === 'fulfilled' && result.value.state === 'removed') && journalsRemoved;
    if (complete) await fs.rm(root, {recursive: true, force: true});
    assert.equal(complete, true, `Cleanup unavailable; retained owned journals at ${root}`);
  });
  const config = {
    dockerContext: context, image, dockerBinary, workRoot, stateRoot,
    workId: 'runtime-acceptance', runId: path.basename(root),
    uid: process.getuid(), gid: process.getgid(), ...extra,
  };
  return {root, workRoot, stateRoot, config, async start(options = {}) {
    const scope = await createScope({...config, ...options}); scopes.push(scope); return scope;
  }};
}

test('actual helper, useful test, protected aliases, inherited resources and outside state', {timeout: 30000}, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.workRoot, '.env'), 'owner-config');
  await fs.mkdir(path.join(f.workRoot, 'settings'));
  await fs.writeFile(path.join(f.workRoot, 'settings', '.env'), 'nested-owner-config');
  await fs.symlink('.env', path.join(f.workRoot, 'innocent-alias'));
  await fs.writeFile(path.join(f.stateRoot, 'authority'), 'controller-only');
  await fs.symlink(path.join(f.stateRoot, 'authority'), path.join(f.workRoot, 'outside'));
  const scope = await f.start({protectedPaths: ['.env', 'settings/.env']});
  const odd = path.join(f.workRoot, "한글 ' quoted\n-name.txt");
  await scope.writeFile(odd, 'alpha');
  assert.equal((await scope.readFile(odd, {maxBytes: 1024})).toString(), 'alpha');
  await assert.rejects(scope.writeFile(path.join(f.workRoot, 'innocent-alias'), 'bad'));
  await assert.rejects(scope.readFile(path.join(f.workRoot, 'outside'), {maxBytes: 1024}));
  const useful = await scope.execute("set -euo pipefail; [[ 1 == 1 ]]; node -e \"require('node:assert/strict').equal(6*7,42); require('node:fs').writeFileSync('/work/result','42'); console.log('TEST_OK')\"");
  assert.equal(useful.exitCode, 0); assert.match(useful.stdout, /TEST_OK/);
  for (const command of [
    'printf bad > /work/innocent-alias',
    'mv /work/.env /work/renamed',
    'ln /work/.env /work/new-link',
    'cat /work/outside',
    'test -S /var/run/docker.sock',
  ]) assert.notEqual((await scope.execute(command)).exitCode, 0, command);
  // A parent rename may be refused or may move the mounted child. Either way,
  // it must not make the protected inode writable through its new location.
  await scope.execute('mv /work/settings /work/settings-renamed');
  const nestedParent = await fs.access(path.join(f.workRoot, 'settings-renamed')).then(() => 'settings-renamed', () => 'settings');
  assert.notEqual((await scope.execute(`printf bad > /work/${nestedParent}/.env`)).exitCode, 0);
  assert.equal(await fs.readFile(path.join(f.workRoot, nestedParent, '.env'), 'utf8'), 'nested-owner-config');
  assert.equal(await fs.readFile(path.join(f.workRoot, '.env'), 'utf8'), 'owner-config');
  assert.equal(await fs.readFile(path.join(f.stateRoot, 'authority'), 'utf8'), 'controller-only');
  assert.equal(await fs.readFile(path.join(f.workRoot, 'result'), 'utf8'), '42');
  const inspected = JSON.parse((await docker('inspect', scope.containerId)).stdout)[0];
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspected.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(inspected.HostConfig.NanoCpus, 1000000000);
  assert.equal(inspected.HostConfig.PidsLimit, 128);
  const actual = await scope.execute('cat /proc/self/status /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max');
  assert.equal(actual.exitCode, 0);
  assert.match(actual.stdout, /CapEff:\s+0+\b/);
  assert.match(actual.stdout, /NoNewPrivs:\s+1\b/);
  assert.match(actual.stdout, /536870912/);
  t.diagnostic(JSON.stringify({scope: 'actual engine restrictions', image, engineContext: context, hostMaxRssKiB: process.resourceUsage().maxRSS}));
});

test('the actual preexisting-hardlink counterexample refuses before scope creation', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const protectedFile = path.join(f.workRoot, '.env');
  await fs.writeFile(protectedFile, 'owner-config');
  await fs.link(protectedFile, path.join(f.workRoot, 'innocent-hardlink'));
  await assert.rejects(f.start({protectedPaths: ['.env']}), /hardlink/i);
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'owner-config');
  assert.deepEqual(await fs.readdir(f.stateRoot), []);
  await fs.unlink(path.join(f.workRoot, 'innocent-hardlink'));
  const scope = await f.start({protectedPaths: ['.env']});
  assert.equal((await scope.execute('printf healthy > /work/normal')).exitCode, 0);
  assert.notEqual((await scope.execute('printf bad > /work/.env')).exitCode, 0);
});

test('a project-created FIFO cannot block file reads, while ordinary reads remain usable', {timeout: 10000}, async t => {
  const f = await fixture(t); const scope = await f.start();
  assert.equal((await scope.execute('mkfifo /work/pipe')).exitCode, 0);
  await assert.rejects(scope.readFile(path.join(f.workRoot, 'pipe'), {maxBytes: 1024}), /unsupported|IO_ERROR/i);
  await scope.writeFile(path.join(f.workRoot, 'normal'), 'still-readable');
  assert.equal((await scope.readFile(path.join(f.workRoot, 'normal'), {maxBytes: 1024})).toString(), 'still-readable');
});

test('detached TERM-ignoring child stops with its exact owned scope; history journal remains', {timeout: 20000}, async t => {
  const f = await fixture(t);
  const scope = await f.start();
  const launched = await scope.execute("setsid sh -c 'trap \"\" TERM; echo ready > /work/ready; while :; do echo x >> /work/heartbeat; sleep 0.02; done' >/dev/null 2>&1 & for i in $(seq 1 200); do test -f /work/ready && exit 0; sleep 0.01; done; exit 1");
  assert.equal(launched.exitCode, 0);
  assert.equal((await fs.readFile(path.join(f.workRoot, 'ready'), 'utf8')).trim(), 'ready');
  assert.equal((await scope.close()).state, 'removed');
  const before = await fs.readFile(path.join(f.workRoot, 'heartbeat'), 'utf8');
  await wait(120); // Real descendant canary observation after confirmed native scope teardown.
  assert.equal(await fs.readFile(path.join(f.workRoot, 'heartbeat'), 'utf8'), before);
  await assert.rejects(docker('inspect', scope.containerId));
  assert.ok((await fs.readdir(f.stateRoot)).some(name => name.endsWith('.json')));
  await assert.rejects(scope.execute('echo cannot-reuse'));
});

test('frozen PID1 cannot run the graceful handler; exact native stop fallback still removes descendants', {timeout: 15000}, async t => {
  const f = await fixture(t), scope = await f.start();
  const child = await scope.execute("setsid sh -c 'trap \"\" TERM; echo ready > /work/ready; while :; do echo x >> /work/heartbeat; sleep 0.02; done' >/dev/null 2>&1 & for i in $(seq 1 200); do test -f /work/ready && exit 0; sleep 0.01; done; exit 1");
  assert.equal(child.exitCode, 0);
  await docker('kill', '--signal=SIGSTOP', scope.containerId);
  const status = await docker('exec', scope.containerId, '/bin/cat', '/proc/1/status');
  assert.match(status.stdout, /^State:\s+T/m, 'Actual PID1 is stopped before cleanup');
  const began = performance.now();
  assert.equal((await scope.close()).state, 'removed');
  const before = await fs.readFile(path.join(f.workRoot, 'heartbeat'), 'utf8');
  await wait(120);
  assert.equal(await fs.readFile(path.join(f.workRoot, 'heartbeat'), 'utf8'), before);
  await assert.rejects(docker('inspect', scope.containerId));
  t.diagnostic(JSON.stringify({actualFrozenPid1: true, cleanupMs: performance.now() - began, detachedCanaryStopped: true}));
});

test('timeout, already-aborted operation and output flood cannot return successful reusable work', {timeout: 25000}, async t => {
  const f = await fixture(t);
  const timeoutScope = await f.start();
  const timed = await timeoutScope.execute('sleep 10', {timeoutMs: 100});
  assert.equal(timed.termination, 'timeout'); assert.notEqual(timed.exitCode, 0);
  assert.equal((await timeoutScope.close()).state, 'removed');
  const abortScope = await f.start();
  const aborted = await abortScope.execute('printf bad > /work/after-abort', {signal: AbortSignal.abort()});
  assert.equal(aborted.termination, 'aborted'); assert.notEqual(aborted.exitCode, 0);
  await assert.rejects(fs.access(path.join(f.workRoot, 'after-abort')));
  const floodScope = await f.start({maxOutputBytes: 4096});
  const flooded = await floodScope.execute("node -e \"process.stdout.write('x'.repeat(1000000))\"");
  assert.equal(flooded.termination, 'output-limit'); assert.notEqual(flooded.exitCode, 0);
  assert.ok(Buffer.byteLength(flooded.stdout) <= 4096);
  assert.equal((await floodScope.close()).state, 'removed');
});

test('restart cleanup reconciles the retained exact scope without touching unrelated containers', {timeout: 20000}, async t => {
  const f = await fixture(t);
  const owned = await f.start();
  const unrelated = await f.start({workId: 'unrelated'});
  const journals = await fs.readdir(f.stateRoot);
  const records = await Promise.all(journals.filter(n => n.endsWith('.json')).map(async n => ({file: path.join(f.stateRoot, n), body: JSON.parse(await fs.readFile(path.join(f.stateRoot, n), 'utf8'))})));
  const journal = records.find(item => item.body.id === owned.containerId);
  assert.ok(journal);
  const cleaned = await reconcileScope(journal.file, dockerBinary);
  assert.equal(cleaned.state, 'removed');
  assert.equal((await unrelated.execute('printf unrelated-healthy')).stdout, 'unrelated-healthy');
  // The original in-memory owner also observes the removed exact scope through idempotent close.
  assert.equal((await owned.close()).state, 'removed');
});

test('an existing host relay socket is refused before mounting; removing it recovers ordinary work', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const socket = path.join(f.workRoot, 'relay.sock');
  const server = createServer(connection => connection.end('host-relay'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  try {
    assert.equal((await fs.lstat(socket)).isSocket(), true);
    await assert.rejects(f.start(), /special|socket/i);
    assert.deepEqual(await fs.readdir(f.stateRoot), []);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const scope = await f.start();
  assert.equal((await scope.execute('echo normal-after-relay-removal')).exitCode, 0);
});

test('the same reachable harmless external sink is unreachable from project/test/child execution', {timeout: 25000}, async t => {
  const f = await fixture(t);
  const suffix = randomUUID();
  const network = `gitjig-fixture-${suffix}`, receiver = `gitjig-sink-${suffix}`;
  await docker('network', 'create', network);
  t.after(async () => {
    await docker('rm', '--force', receiver).catch(() => {});
    await docker('network', 'rm', network);
  });
  const program = "require('node:http').createServer((q,s)=>s.end('REACHABLE_FIXTURE')).listen(8123,'0.0.0.0')";
  await docker('run', '--detach', '--name', receiver, '--network', network, image, 'node', '-e', program);
  const receiverInfo = JSON.parse((await docker('inspect', receiver)).stdout)[0];
  const address = receiverInfo.NetworkSettings.Networks[network].IPAddress;
  assert.match(address, /^\d+\.\d+\.\d+\.\d+$/);
  const url = `http://${address}:8123`;
  const positive = await docker('run', '--rm', '--network', network, image, 'curl', '--retry', '10', '--retry-connrefused', '--retry-delay', '0', '--max-time', '2', '--silent', '--fail', url);
  assert.equal(positive.stdout, 'REACHABLE_FIXTURE');
  const scope = await f.start();
  for (const command of [
    `curl --silent --show-error --fail --max-time 1 ${url}`,
    `sh -c 'curl --silent --fail --max-time 1 ${url}'`,
    `node -e "require('node:http').get('${url}',()=>process.exit(0)).on('error',()=>process.exit(17))"`,
  ]) assert.notEqual((await scope.execute(command, {timeoutMs: 4000})).exitCode, 0, command);
  const legitimateFixture = await scope.execute("node -e \"const http=require('node:http'),s=http.createServer((q,r)=>r.end('OWNED_OK'));s.listen(0,'127.0.0.1',()=>http.get({host:'127.0.0.1',port:s.address().port},r=>{r.resume();r.on('end',()=>{console.log('OWNED_OK');s.close()})}));\"");
  assert.equal(legitimateFixture.exitCode, 0); assert.match(legitimateFixture.stdout, /OWNED_OK/);
});

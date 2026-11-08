import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createScope} from '../../dist/execution/container-scope.js';
import {initializePiHost} from '../../dist/pi/index.js';
import {PiArtifacts} from '../../dist/pi/host.js';
import {createProjectTools} from '../../dist/pi/tools.js';
import {runtimeFixtureProfile, runtimeFixtureConfig} from './profile.mjs';
import {scopeJournalsRemoved} from './fixture-cleanup.mjs';
import {freeze} from '../../dist/controller/change-files.js';
import {manifestScopeEvidence} from '../../dist/controller/verification-strategies.js';

const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let suiteRoot, allPassed = true;
after(async () => {
    if (suiteRoot && allPassed && process.env.GITJIG_RETAIN_RUNTIME_FIXTURE !== '1')
        await fs.rm(suiteRoot, {recursive: true, force: true});
});

async function fixture(t) {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent), 'Explicit external runtime fixture root required');
    assert.equal(await fs.realpath(parent), parent);
    const checkout = await fs.realpath('.');
    assert.ok(parent !== checkout && !parent.startsWith(checkout + path.sep));
    if (!suiteRoot) {
        suiteRoot = await fs.mkdtemp(path.join(parent, 'shell-observation-'));
        await fs.chmod(suiteRoot, 0o700);
        await fs.mkdir(path.join(suiteRoot, 'artifacts'), {mode: 0o700});
    }
    const root = await fs.mkdtemp(path.join(suiteRoot, 'case-'));
    await fs.chmod(root, 0o700);
    const workRoot = path.join(root, 'work'), stateRoot = path.join(root, 'state');
    const artifactRoot = path.join(suiteRoot, 'artifacts'), user = path.join(root, 'user');
    for (const directory of [workRoot, stateRoot, user]) await fs.mkdir(directory, {mode: 0o700});
    const oldTemp = process.env.TMPDIR;
    process.env.TMPDIR = artifactRoot;
    let scope, passed = false;
    t.after(async () => {
        try {
            if (scope) assert.equal((await scope.close()).state, 'removed');
            assert.equal(await scopeJournalsRemoved(stateRoot), true);
            if (passed && process.env.GITJIG_RETAIN_RUNTIME_FIXTURE !== '1') await fs.rm(root, {recursive: true, force: true});
            else t.diagnostic('Retained shell observation fixture: ' + root);
        } catch (error) {
            allPassed = false;
            throw error;
        } finally {
            if (!passed) allPassed = false;
            if (oldTemp === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = oldTemp;
        }
    });
    return {root, workRoot, stateRoot, artifactRoot, user, done() { passed = true; }, async start(protectedPaths = []) {
        scope = await createScope({...runtimeFixtureProfile(), dockerConfigDirectory: runtimeFixtureConfig(),
            workRoot, stateRoot, workId: 'shell-observation', runId: path.basename(root),
            uid: process.getuid(), gid: process.getgid(), protectedPaths});
        return scope;
    }};
}

test('invalid shell arguments preserve the owned scope; dispatched timeout still closes it', {timeout: 60000}, async t => {
    const f = await fixture(t), scope = await f.start();
    const host = await initializePiHost({stateRoot: f.stateRoot, artifactRoot: f.artifactRoot});
    const bash = createProjectTools(scope, new PiArtifacts(host, 1024 * 1024), 1024 * 1024).find(tool => tool.name === 'bash');
    await assert.rejects(bash.execute('invalid-seconds', {command: 'echo MUST_NOT_RUN', timeout: 5000}), /timeout/);
    assert.match((await scope.execute('printf RECOVERED')).stdout, /RECOVERED/);
    for (const options of [{timeoutMs: 0}, {timeoutMs: Infinity}, {timeoutMs: 3600001}, {cwd: '/outside-project'}]) {
        await assert.rejects(scope.execute('echo MUST_NOT_RUN', options), /timeout|outside workspace/);
        assert.equal((await scope.execute('printf STILL_USABLE')).stdout, 'STILL_USABLE');
    }
    const options = {timeoutMs: 5000, cwd: f.workRoot};
    const pending = scope.execute('printf CAPTURED_OPTIONS', options);
    options.timeoutMs = Infinity;
    options.cwd = '/outside-project';
    assert.equal((await pending).stdout, 'CAPTURED_OPTIONS');
    const timed = await scope.execute('sleep 10', {timeoutMs: 100});
    assert.equal(timed.termination, 'timeout');
    await assert.rejects(scope.execute('echo MUST_NOT_RUN'), /scope is not reusable/);
    f.done();
});

test('project Git observations preserve the index while explicit staging remains a change', {timeout: 60000}, async t => {
    const f = await fixture(t);
    const env = {PATH: '/usr/bin:/bin', HOME: f.user, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
    const git = async (...args) => execute('/usr/bin/git', args, {cwd: f.workRoot, env, timeout: 10000});
    await fs.writeFile(path.join(f.workRoot, 'protected.txt'), 'UNCHANGED\n');
    await fs.writeFile(path.join(f.workRoot, 'editable.txt'), 'BASE\n');
    await git('init', '--quiet');
    await git('config', 'user.name', 'Owned fixture');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('add', '--', 'protected.txt', 'editable.txt');
    await git('commit', '--quiet', '-m', 'Initial fixture');
    const index = path.join(f.workRoot, '.git', 'index');
    const before = hash(await fs.readFile(index));
    const captured = await freeze(f.workRoot, path.join(f.root, 'baseline'), {});
    const base = {id: 'base', hash: captured.digest, data: {manifest: captured.manifest}};
    const strategy = {requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: ['editable.txt'], unchangedPaths: ['protected.txt'], reviewKey: 'scope-review'};
    const observation = async name => {
        const captured = await freeze(f.workRoot, path.join(f.root, name), {});
        return manifestScopeEvidence(base, {id: name, hash: captured.digest, data: {manifest: captured.manifest}}, strategy, {});
    };
    await fs.utimes(path.join(f.workRoot, 'protected.txt'), 1000000000, 1000000000);
    const scope = await f.start(['protected.txt']);
    const host = await initializePiHost({stateRoot: f.stateRoot, artifactRoot: f.artifactRoot});
    const bash = createProjectTools(scope, new PiArtifacts(host, 1024 * 1024), 1024 * 1024).find(tool => tool.name === 'bash');
    assert.equal((await scope.execute('printf CHANGED > editable.txt')).exitCode, 0);
    const observed = await bash.execute('observe-changed-git', {command: 'printf "%s\\n" "$GIT_OPTIONAL_LOCKS"; git config --get diff.autoRefreshIndex; git status --short; git diff --stat; git diff --stat HEAD; git diff -- protected.txt', timeout: 10});
    const text = observed.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert.match(text, /^0\nfalse\n M editable\.txt\n/);
    assert.match(text, /editable\.txt \|/);
    assert.equal(hash(await fs.readFile(index)), before);
    assert.equal((await observation('observed')).actual.satisfied, true);
    const write = await scope.execute('git add -- editable.txt');
    assert.equal(write.exitCode, 0, write.stderr);
    assert.notEqual(hash(await fs.readFile(index)), before);
    assert.equal((await observation('explicit-staging')).actual.satisfied, false);
    assert.notEqual((await scope.execute('printf WRONG > protected.txt')).exitCode, 0);
    assert.equal(await fs.readFile(path.join(f.workRoot, 'protected.txt'), 'utf8'), 'UNCHANGED\n');
    f.done();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-runtime-apply-')));
    const a = path.join(root, 'route-a'), b = path.join(root, 'route-b'), project = path.join(root, 'project');
    for (const directory of [a, b, project]) await fs.mkdir(directory, {mode: 0o700});
    const profile = directory => ({dockerBinary: '/usr/bin/false', dockerContext: 'owned', dockerConfigDirectory: directory, image: 'sha256:' + '1'.repeat(64)});
    const c = await openController({installationHome: path.join(root, 'home'), runtimeProfile: profile(a)});
    await c.registerProject({id: 'P', sourceRoot: project});
    t.after(async () => { await c.close(); await fs.rm(root, {recursive: true, force: true}); });
    return {c, root, a, b, profile};
}

test('reviewed runtime replacement is immutable and a failed save or validation preserves the active route', async t => {
    const {c, b, profile} = await fixture(t), original = c.options.runtimeProfile;
    await assert.rejects(c.applyRuntimeProfile({...profile(b), image: 'mutable:latest'}), /immutable/);
    assert.equal(c.options.runtimeProfile, original);
    await assert.rejects(c.applyRuntimeProfile(profile(b), () => { throw Error('SAVE_REFUSED'); }), /SAVE_REFUSED/);
    assert.equal(c.options.runtimeProfile, original);
    const candidate = profile(b), pending = c.applyRuntimeProfile(candidate);
    candidate.dockerContext = 'changed-after-review';
    await pending;
    assert.equal(c.options.runtimeProfile.dockerContext, 'owned');
    assert.equal(c.options.runtimeProfile.dockerConfigDirectory, b);
    assert.equal(Object.isFrozen(c.options.runtimeProfile), true);
});

test('competing runtime reviews and closing reject stale commits', async t => {
    const {c, a, b, profile} = await fixture(t);
    const results = await Promise.allSettled([c.applyRuntimeProfile(profile(b)), c.applyRuntimeProfile(profile(a))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(String(results.find(result => result.status === 'rejected').reason), /changed during runtime review/);
    let committed = false;
    const pending = c.applyRuntimeProfile(profile(b), () => { committed = true; });
    const refused = assert.rejects(pending, /closed or closing/);
    await c.close(); await refused;
    assert.equal(committed, false);
});

test('local admission keeps its route and retired interrupted cleanup protects authority paths', async t => {
    const {c, a, b, profile} = await fixture(t);
    const admitted = c.admit('P', 'command-observation', 'Original local command');
    const snapshot = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', admitted.runId).data).profile;
    await c.applyRuntimeProfile(profile(b));
    assert.deepEqual(admitted.runtimeProfile, snapshot);
    assert.equal(admitted.runtimeProfile.dockerConfigDirectory, a);
    const next = c.admit('P', 'command-observation', 'Next local command');
    assert.equal(next.runtimeProfile.dockerConfigDirectory, b);
    c.store.run("UPDATE runs SET phase='INTERRUPTED',data=? WHERE id=?", JSON.stringify({profile: snapshot, cleanup: 'quarantined'}), admitted.runId);
    await assert.rejects(c.registerProject({id: 'OLD', sourceRoot: a}), /disjoint/);
    c.store.run("UPDATE runs SET data=? WHERE id=?", JSON.stringify({profile: snapshot, cleanup: 'removed'}), admitted.runId);
    await c.registerProject({id: 'OLD', sourceRoot: a});
});

test('settled unbound runtime metadata does not retain an unused authority path', async t => {
    const {c, a, b, profile} = await fixture(t);
    const admitted = c.admit('P', 'command-observation', 'Retained metadata only');
    const original = admitted.runtimeProfile;
    await c.applyRuntimeProfile(profile(b));
    c.store.run("UPDATE runs SET phase='SETTLED',data=? WHERE id=?", JSON.stringify({runtimeProfile: original, cleanup: 'unbound'}), admitted.runId);
    await c.registerProject({id: 'RELEASED', sourceRoot: a});
});

test('original cleanup uses the recorded route after replacement', async t => {
    const {c, a, b, profile} = await fixture(t);
    const admitted = c.admit('P', 'command-observation', 'Original local command');
    await c.applyRuntimeProfile(profile(b));
    const nonce = '12345678-1234-1234-1234-123456789abc';
    await fs.writeFile(path.join(c.options.installationHome, 'state/runtime', nonce + '.json'), JSON.stringify({version: 1, workId: admitted.w.id, runId: admitted.runId, context: 'owned', dockerConfigDirectory: a, nonce, name: 'gitjig-' + nonce, state: 'quarantined'}), {mode: 0o600});
    // The owned false client cannot establish removal. It must reach A rather than reject a B/A route mismatch.
    assert.equal(await c.reconcileRun(admitted.runId, admitted.w.id), 'quarantined');
    const original = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', admitted.runId).data);
    const {profile: _profile, ...legacy} = original;
    c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(legacy), admitted.runId);
    assert.equal(await c.reconcileRun(admitted.runId, admitted.w.id), 'quarantined', 'Legacy cleanup remains on the initial A route after a live replacement');
    c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(original), admitted.runId);
    const data = JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?', admitted.runId).data);
    c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({...data, profile: {...data.profile, dockerBinary: path.join(a, 'unavailable-client')}}), admitted.runId);
    assert.equal(await c.reconcileRun(admitted.runId, admitted.w.id), 'quarantined-runtime-unavailable');
    assert.equal(c.options.runtimeProfile.dockerConfigDirectory, b);
});

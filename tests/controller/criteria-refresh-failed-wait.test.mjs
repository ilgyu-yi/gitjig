import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

async function world(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-refresh-wait-'))), payload = path.join(root, 'payload');
    await fs.mkdir(payload);
    for (const name of ['dist', 'tests/controller']) await fs.cp(name, path.join(payload, name), {recursive: true});
    await fs.mkdir(path.join(payload, 'tests/workflow'), {recursive: true});
    await fs.copyFile('tests/workflow/current-verification-fixture.mjs', path.join(payload, 'tests/workflow/current-verification-fixture.mjs'));
    for (const name of ['package.json', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md']) await fs.copyFile(name, path.join(payload, name));
    await fs.symlink(path.resolve('node_modules'), path.join(payload, 'node_modules'));
    await fs.symlink(path.resolve('runtime'), path.join(payload, 'runtime'));
    const {failedWaitWorld} = await import(pathToFileURL(path.join(payload, 'tests/controller/original-failed-wait-fixture.mjs')));
    const {originalFailedWaitOutcome} = await import(pathToFileURL(path.join(payload, 'dist/controller/original-wait-outcome.js')));
    const f = await failedWaitWorld(t, {goal: true, retainRoot: true});
    const goal = f.c.inspectGoal(f.goal.goalId);
    await f.c.pauseGoal({goalId: goal.goalId, expectedRevision: goal.revision, reason: 'Review workflow definitions before diagnostic inspection'});
    await f.settle();
    const child = f.children[0], s = f.c.store;
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'deliverable');
    const runs = s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', child.workId), budgets = s.all('SELECT * FROM budgets ORDER BY rowid');
    await fs.appendFile(path.join(payload, 'CONTRACTS.md'), '\nOwned fixture provenance clarification; original task requirements remain unchanged.\n');
    const epoch = f.c.inspectWork(child.workId).epoch;
    await f.c.refreshChangeCriteria({workId: child.workId, expectedEpoch: epoch, reason: 'Adopt reviewed workflow definitions; preserve original failed observation and task'});
    let passed = false, reopened;
    t.after(async () => { await reopened?.close(); if (passed) {await fs.rm(root, {recursive: true, force: true}); await fs.rm(f.root, {recursive: true, force: true});} else t.diagnostic('Retained refresh WAIT payload ' + root); });
    return {...f, payload, s, child, epoch, runs, budgets, outcome: () => originalFailedWaitOutcome(s, f.parent, child.assignmentId),
        async reopen() {await f.c.close(); const {openController} = await import(pathToFileURL(path.join(payload, 'dist/controller/index.js'))); reopened = await openController({installationHome: f.home, interactionDelegation: {projectIds: ['P'], maxAssignments: 8}}); return reopened;},
        pass() {passed = true; f.pass();}};
}

test('public owner criteria refresh preserves one charged original diagnostic continuation without child retry', {timeout: 20000}, async t => {
    const f = await world(t);
    assert.equal(f.c.inspectWork(f.child.workId).epoch, f.epoch + 1);
    assert.equal(f.outcome().state, 'deliverable');
    const refresh = JSON.parse(f.s.one('SELECT data FROM change_state WHERE work=?', f.child.workId).data).criteriaRefresh;
    const origin = JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?', refresh.sourceId).origin);
    assert.equal(origin.failedWaitDiagnostic.fromEpoch, f.epoch);
    assert.equal(origin.failedWaitDiagnostic.toEpoch, f.epoch + 1);
    const historical = f.outcome().historicalDiagnostic;
    assert.deepEqual(historical, {observationEpoch: f.epoch, currentMetadataEpoch: f.epoch + 1,
        criteriaRefreshSourceId: refresh.sourceId,
        meaning: 'Previously settled failure retained across owner workflow-rule adoption. No current-epoch execution, successful standing or task retry is granted by this historical observation alone.'});
    // The reviewed UI metadata action and later public CLI resume may be different processes.
    const c = await f.reopen(), paused = c.inspectGoal(f.goal.goalId);
    c.startGoal({goalId: paused.goalId, expectedRevision: paused.revision, model: f.model});
    await c.ordinary.drain();
    await fs.writeFile(path.join(f.payload, 'post-reopen.json'), JSON.stringify({goal: c.inspectGoal(f.goal.goalId), outcome: c.store.all('SELECT * FROM conversation_state'), runs: c.store.all('SELECT * FROM runs'), attempts: c.store.all('SELECT * FROM goal_attempts')}, null, 2));
    assert.equal(f.continuations.length, 1);
    const delivered = JSON.parse(f.continuations[0].slice(f.continuations[0].indexOf(': ') + 2));
    assert.deepEqual(delivered[0].historicalDiagnostic, historical);
    assert.equal(c.inspectGoal(f.goal.goalId).startedAttempts, 2);
    assert.equal(c.inspectGoal(f.goal.goalId).state, 'WAITING_INPUT');
    assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.child.assignmentId).state, 'UNAVAILABLE');
    assert.equal(c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', f.child.assignmentId).state, 'PENDING');
    assert.deepEqual(c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', f.child.workId), f.runs);
    assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_assignments WHERE source_conversation=?', f.parent).n, 1);
    for (let n = 0; n < 3; n++) c.ordinary.resumeAuthorized();
    await c.ordinary.drain(); assert.equal(f.continuations.length, 1); f.pass();
});

test('missing or changed exact refresh receipt, result, source and run census cannot release historical failure', {timeout: 20000}, async t => {
    const f = await world(t), s = f.s;
    assert.equal(f.outcome().state, 'deliverable');
    const change = s.one('SELECT data FROM change_state WHERE work=?', f.child.workId), refresh = JSON.parse(change.data).criteriaRefresh;
    const source = s.one('SELECT origin FROM sources WHERE id=?', refresh.sourceId), original = JSON.parse(source.origin);
    for (const mutate of [o => {delete o.failedWaitDiagnostic;}, o => {o.uid = process.getuid() + 1;}, o => {o.failedWaitDiagnostic.resultId = 'another-result';}, o => {o.failedWaitDiagnostic.fromEpoch--;}, o => {o.failedWaitDiagnostic.waitDigest = 'wrong';}, o => {o.failedWaitDiagnostic.runSetDigest = 'wrong';}, o => {o.failedWaitDiagnostic.toHash = 'a'.repeat(64);}]) {
        const next = structuredClone(original); mutate(next);
        s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify(next), refresh.sourceId);
        assert.equal(f.outcome().state, 'held');
    }
    s.run('UPDATE sources SET origin=? WHERE id=?', source.origin, refresh.sourceId);
    s.run('UPDATE sources SET conversation=? WHERE id=?', f.parent, refresh.sourceId); assert.equal(f.outcome().state, 'held');
    s.run('UPDATE sources SET conversation=NULL WHERE id=?', refresh.sourceId);
    const work = s.one('SELECT source,epoch FROM works WHERE id=?', f.child.workId);
    s.run('UPDATE works SET epoch=epoch+1 WHERE id=?', f.child.workId); assert.equal(f.outcome().state, 'held');
    s.run('UPDATE works SET epoch=? WHERE id=?', work.epoch, f.child.workId);
    s.run('UPDATE works SET source=? WHERE id=?', refresh.sourceId, f.child.workId); assert.equal(f.outcome().state, 'held');
    s.run('UPDATE works SET source=? WHERE id=?', work.source, f.child.workId);
    const run = f.runs[0];
    s.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({...JSON.parse(run.data), laterExecution: true}), run.id); assert.equal(f.outcome().state, 'held');
    s.run('UPDATE runs SET data=? WHERE id=?', run.data, run.id);
    assert.equal(f.outcome().state, 'deliverable');
    assert.deepEqual(s.all('SELECT * FROM budgets ORDER BY rowid'), f.budgets);
    assert.equal(f.continuations.length, 0);
    // A second legitimate refresh remains possible, but does not invent a chain
    // of historical diagnostic exceptions for an observation two epochs earlier.
    await fs.appendFile(path.join(f.payload, 'CONTRACTS.md'), '\nAnother reviewed fixture clarification.\n');
    await f.c.refreshChangeCriteria({workId: f.child.workId, expectedEpoch: f.epoch + 1, reason: 'Second metadata refresh cannot renew historical diagnostic proof'});
    assert.equal(f.c.inspectWork(f.child.workId).epoch, f.epoch + 2);
    assert.equal(f.outcome().state, 'held');
    assert.deepEqual(s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', f.child.workId), f.runs);
    assert.deepEqual(s.all('SELECT * FROM budgets ORDER BY rowid'), f.budgets);
    f.pass();
});

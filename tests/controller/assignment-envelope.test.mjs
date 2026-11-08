import {adoptLegacyInlineOutcome} from './legacy-assignment-outcome-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {inspectAssignedWorkObligations} from '../../dist/controller/assigned-work-provenance.js';
const diagnostic = 'Retained independent procedure evidence. '.repeat(2400);

test('a retained legacy large original failed publication resumes its native Pi goal WAIT exactly once', async t => {
    const f = await failedWaitWorld(t, {goal: true, resultDiagnostic: diagnostic});
    const pausedBefore = f.c.inspectGoal(f.goal.goalId);
    await f.c.pauseGoal({goalId: pausedBefore.goalId, expectedRevision: pausedBefore.revision, reason: 'Inspect a genuine pre-compact inline publication fixture'});
    await f.settle();
    await adoptLegacyInlineOutcome(f, f.children[0]);
    const paused = f.c.inspectGoal(f.goal.goalId);
    f.c.startGoal({goalId: paused.goalId, expectedRevision: paused.revision, model: f.model});
    await f.c.ordinary.drain();
    const child = f.children[0], row = f.c.store.one('SELECT state,data FROM conversation_assignments WHERE id=?', child.assignmentId), data = JSON.parse(row.data);
    assert.ok(Buffer.byteLength(row.data) > 65536);
    assert.ok(Buffer.byteLength(JSON.stringify(data.result)) < 128 * 1024);
    assert.equal(f.continuations.length, 1);
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts, 2);
    assert.equal(f.c.inspectGoal(f.goal.goalId).state, 'WAITING_INPUT');
    assert.equal(row.state, 'UNAVAILABLE');
    assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', child.assignmentId).state, 'PENDING');
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?', child.workId).n, 1);
    f.pass();
});

test('large original publication preserves cancellation provenance checks and owner withdrawal', async t => {
    const f = await failedWaitWorld(t, {automatic: false, resultDiagnostic: diagnostic});
    await f.settle();
    await adoptLegacyInlineOutcome(f, f.children[0]);
    const child = f.children[0], s = f.c.store, row = s.one('SELECT data FROM conversation_assignments WHERE id=?', child.assignmentId), data = JSON.parse(row.data);
    assert.deepEqual(inspectAssignedWorkObligations(s, child.workId), [child.assignmentId]);
    const instruction = s.one('SELECT origin FROM sources WHERE id=?', data.instructionsSource), forged = {...JSON.parse(instruction.origin), event: 'different-assignment'};
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify(forged), data.instructionsSource);
    await assert.rejects(f.c.cancelWork({workId: child.workId}), /cancellation correspondence/);
    assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'UNAVAILABLE');
    s.run('UPDATE sources SET origin=? WHERE id=?', instruction.origin, data.instructionsSource);
    // Individual provenance retains its original64KiB bound even with a valid large envelope.
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({...JSON.parse(instruction.origin), extra: 'x'.repeat(65536)}), data.instructionsSource);
    assert.throws(() => inspectAssignedWorkObligations(s, child.workId), /provenance is unavailable/);
    s.run('UPDATE sources SET origin=? WHERE id=?', instruction.origin, data.instructionsSource);
    s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...data, extra: 'x'.repeat(1024 * 1024)}), child.assignmentId);
    assert.throws(() => inspectAssignedWorkObligations(s, child.workId), /provenance is unavailable/);
    s.run('UPDATE conversation_assignments SET data=? WHERE id=?', row.data, child.assignmentId);
    await f.c.cancelWork({workId: child.workId});
    assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'CANCELLED');
    assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?', child.assignmentId).state, 'CANCELLED');
    assert.deepEqual(JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?', child.assignmentId).data).result, data.result);
    f.pass();
});

test('accepted large legacy result reconciles only its exact pending dependency', async t => {
    const f = await structuredAssignmentWorld(t);
    f.onGoverned((_child, result) => { result.diagnostic = diagnostic; });
    await f.assign();
    await adoptLegacyInlineOutcome(f, f.child);
    const s = f.c.store, id = f.child.assignmentId, row = s.one('SELECT data FROM conversation_assignments WHERE id=?', id), data = JSON.parse(row.data);
    assert.ok(Buffer.byteLength(row.data) > 65536);
    delete data.resultId;
    s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify(data), id);
    s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?", id);
    const publications = s.all('SELECT * FROM conversation_results'), runs = s.all('SELECT * FROM runs');
    const otherDependencies = s.all('SELECT * FROM conversation_dependencies WHERE assignment<>? ORDER BY rowid', id);
    await f.c.reclaimConversationResource({conversationId: f.parent, expectedGeneration: f.c.inspectConversation(f.parent).generation});
    assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?', id).state, 'RESOLVED');
    assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?', id).state, 'COMPLETE');
    assert.deepEqual(s.all('SELECT * FROM conversation_results'), publications);
    assert.deepEqual(s.all('SELECT * FROM runs'), runs);
    assert.deepEqual(s.all('SELECT * FROM conversation_dependencies WHERE assignment<>? ORDER BY rowid', id), otherDependencies);
    f.pass();
});

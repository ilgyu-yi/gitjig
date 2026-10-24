import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { queuedAssignmentWorld as queued } from './queued-assignment-fixture.mjs';


test('actual native queued delegation can be withdrawn without canceling its parent or allocating work', async t => {
    const f = await queued(t), c = f.c, reviewed = f.snapshot();
    assert.equal(reviewed.pendingDependencyCount, 1); assert.equal(reviewed.instructions, 'Owned delegated task');
    const parent = c.store.one('SELECT * FROM works WHERE id=?', c.inspectConversation(f.parent).workId);
    const runs = c.store.all('SELECT * FROM runs'), works = c.store.all('SELECT * FROM works');
    const canceled = await c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: reviewed.fingerprint, reason: 'Owner withdraws only this unsent task' });
    assert.deepEqual(canceled.workIds, []); assert.deepEqual(canceled.assignmentIds, [f.assignment.id]);
    assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'CANCELLED');
    assert.equal(c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', f.assignment.id).state, 'CANCELLED');
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', reviewed.inputId).state, 'CANCELLED');
    assert.deepEqual(c.store.all('SELECT * FROM runs'), runs); assert.deepEqual(c.store.all('SELECT * FROM works'), works);
    assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?', parent.id), parent);
    await f.finish(); f.pass();
});

test('withdrawing an unallocated child preserves the original unknown parent and its cleanup hold', async t => {
    const f = await queued(t), c = f.c;
    const deadline = Date.now() + 3000;
    while (c.inspectConversation(f.parent).state !== 'IDLE') {
        assert.ok(Date.now() < deadline, 'Original parent did not settle'); await new Promise(resolve => setTimeout(resolve, 5));
    }
    const parentWork = c.inspectConversation(f.parent).workId;
    c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?", parentWork);
    c.store.run("UPDATE conversations SET state='UNKNOWN' WHERE id=?", f.parent);
    c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?", f.parent);
    const parent = c.store.one('SELECT * FROM works WHERE id=?', parentWork), source = c.store.one('SELECT * FROM conversation_state WHERE conversation=?', f.parent);
    const reviewed = f.snapshot();
    const result = await c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: reviewed.fingerprint, reason: 'Withdraw only the unallocated child; preserve uncertain parent' });
    assert.deepEqual(result.workIds, []); assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?', parentWork), parent);
    assert.deepEqual(c.store.one('SELECT * FROM conversation_state WHERE conversation=?', f.parent), source);
    assert.equal(c.inspectConversation(f.parent).state, 'UNKNOWN');
    await f.finish(); f.pass();
});

test('review can be opened only by the original source or target at the current generation', async t => {
    const f = await queued(t), c = f.c;
    assert.equal(c.inspectQueuedAssignmentCancellation({ ...f.input, conversationId: f.parent, expectedGeneration: c.inspectConversation(f.parent).generation }).assignmentId, f.assignment.id);
    const unrelated = c.createConversation().conversationId;
    assert.throws(() => c.inspectQueuedAssignmentCancellation({ ...f.input, conversationId: unrelated, expectedGeneration: 0 }), /changed|admitted/);
    assert.throws(() => c.inspectQueuedAssignmentCancellation({ ...f.input, expectedGeneration: f.input.expectedGeneration + 1 }), /changed|admitted/);
    await c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: f.snapshot().fingerprint, reason: 'Withdraw tested task' }); await f.finish(); f.pass();
});

for (const mutation of ['source-direction', 'assignment-data', 'hidden-input', 'hidden-dependency', 'unknown-resource', 'native-preparation']) {
    test('queued cancellation refuses final '+mutation+' drift without canceling any original', async t => {
        const f = await queued(t), c = f.c, reviewed = f.snapshot();
        const before = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.assignment.id);
        const validate = () => {
            if (mutation === 'source-direction') c.store.run('UPDATE conversation_state SET direction=direction+1 WHERE conversation=?', f.parent);
            if (mutation === 'assignment-data') c.store.run("UPDATE conversation_assignments SET data=json_set(data,'$.ownerNote','changed') WHERE id=?", f.assignment.id);
            if (mutation === 'hidden-input') { const row = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', reviewed.inputId); c.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), row.conversation, row.generation, null, row.source, 'QUEUED', 'idle', row.text, row.data); }
            if (mutation === 'hidden-dependency') c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), f.parent, f.assignment.target, f.assignment.id, 'PENDING', JSON.stringify({ source: JSON.parse(before.data).source }));
            if (mutation === 'unknown-resource') c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?", f.assignment.target);
            if (mutation === 'native-preparation') c.contextInputs.add(Promise.resolve());
        };
        assert.throws(() => c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: reviewed.fingerprint, reason: 'Stale review must refuse', validate }), /changed|admitted|active/);
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'QUEUED');
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?', reviewed.inputId).state, 'QUEUED');
        c.contextInputs.clear();
        await c.cancelAssignment({ assignmentId: f.assignment.id, reason: 'Fixture closes original task after negative control' }); await f.finish(); f.pass();
    });
}

test('owner guard throws or returns an asynchronous value before original cancellation', async t => {
    const f = await queued(t), c = f.c, reviewed = f.snapshot();
    for (const validate of [() => { throw Error('Owner source changed'); }, () => Promise.resolve()])
        assert.throws(() => c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: reviewed.fingerprint, reason: 'Must refuse', validate }), /source changed|Synchronous/);
    assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'QUEUED');
    await c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: reviewed.fingerprint, reason: 'Withdraw tested task' }); await f.finish(); f.pass();
});

test('original governed criteria preparation refuses cancellation before any allocation', { timeout: 20000 }, async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', 'tests/controller/queued-assignment-preparation-worker.mjs'], { env, timeout: 17000, maxBuffer: 2 ** 20 }).catch(error => { throw Error(error.stdout + '\n' + error.stderr, { cause: error }); });
    assert.match(result.stdout, /tests 1/); assert.match(result.stdout, /pass 1/); assert.match(result.stdout, /fail 0/); assert.match(result.stdout, /skipped 0/);
});

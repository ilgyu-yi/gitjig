import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { structuredAssignmentWorld } from './structured-assignment-fixture.mjs';
import { scripted } from './effect-fixture.mjs';
import { createCoordinationTools } from '../../dist/pi/coordination.js';
import { queuedAssignmentWorld } from './queued-assignment-fixture.mjs';

const receipt = (context, name) => {
    const result = context.messages.filter(message => message.role === 'toolResult' && message.toolName === name).at(-1);
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join(''));
};
async function failedAssignment(t, cancel = false) {
    const f = await structuredAssignmentWorld(t);
    f.onGoverned(() => { throw new Error('Owned controlled governed producer unavailable'); });
    await f.assign();
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.child.assignmentId).state, 'UNAVAILABLE');
    if (cancel) await f.c.cancelWork({ workId: f.child.workId, expectedEpoch: 1 });
    return f;
}
async function run(f, next) {
    await f.c.queueConversationInput({ conversationId: f.parent, expectedGeneration: f.c.inspectConversation(f.parent).generation, text: 'Inspect retained original outcomes without replacing the task', mode: 'idle' });
    const model = scripted(next); model.provider = 'wait-outcome-' + randomUUID(); model.definition.api = 'wait-outcome-api-' + randomUUID();
    return f.c.runConversation({ conversationId: f.parent, model });
}

for (const cancel of [false, true]) test(`original ${cancel ? 'cancelled' : 'unavailable'} assignment returns actionable non-wait outcome and the actual Pi turn continues`, async t => {
    const f = await failedAssignment(t, cancel), c = f.c;
    const quiesce = c.interactions.quiesceNative.bind(c.interactions); let quiesced = 0, observed;
    c.interactions.quiesceNative = identity => { quiesced++; return quiesce(identity); };
    const before = c.store.one('SELECT * FROM works WHERE id=?', f.child.workId);
    const result = await run(f, (context, turn) => {
        if (turn === 0) return { tool: { name: 'conversation_status', arguments: { conversationId: f.child.conversationId } } };
        if (turn === 1) {
            const status = receipt(context, 'conversation_status');
            assert.equal(status.state, 'IDLE'); assert.equal(status.workState, cancel ? 'CANCELLED' : 'ACTIVE');
            assert.equal(status.assignments.length, 1); assert.equal(status.assignments[0].assignmentId, f.child.assignmentId);
            assert.equal(status.assignments[0].state, cancel ? 'CANCELLED' : 'UNAVAILABLE');
            if (cancel) assert.deepEqual(status.assignments[0].recovery, { tool: 'conversation_recover_assignment', assignmentId: f.child.assignmentId, expectedWorkEpoch: 2, observedDirectionRevision: 0, nextAction: 'Explicitly recover this original assignment, then separately reenter the same target using the returned direction revision; recovery eligibility is checked by the tool' });
            else assert.equal(status.assignments[0].recovery, undefined);
            assert.equal(JSON.stringify(status.assignments).includes('Owned delegated task'), false);
            return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } };
        }
        observed = receipt(context, 'conversation_wait');
        assert.equal(observed.waiting, false); assert.equal(observed.state, 'original-recovery');
        assert.equal(observed.outcomes[0].assignmentId, f.child.assignmentId);
        return { text: 'Retain the original and deliberately inspect its recovery requirements.' };
    });
    assert.equal(result.status, 'delivered'); assert.ok(observed); assert.equal(quiesced, 0);
    assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?', f.child.workId), before);
    const state = c.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', f.parent);
    assert.equal(state.resource, 'IDLE'); assert.equal(JSON.parse(state.data).waitHandles, undefined);
    f.pass();
});

test('a COMPLETE original with cancelled work cannot admit a new wait', async t => {
    const f = await structuredAssignmentWorld(t); await f.assign();
    await f.c.cancelWork({ workId: f.child.workId, expectedEpoch: 1 });
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.child.assignmentId).state, 'COMPLETE');
    let observed;
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } };
        observed = receipt(context, 'conversation_wait'); return { text: 'Cancelled original work remains held.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(observed.waiting, false); assert.equal(observed.outcomes[0].workState, 'CANCELLED'); f.pass();
});

test('healthy COMPLETE accepted result retains original wait admission', async t => {
    const f = await structuredAssignmentWorld(t); await f.assign();
    const assignment = f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.child.assignmentId);
    assert.equal(assignment.state, 'COMPLETE'); assert.ok(JSON.parse(assignment.data).resultId);
    const result = await run(f, (_context, turn) => turn ? { text: 'Original accepted result remains available.' } : { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } });
    assert.equal(result.status, 'waiting'); await f.c.ordinary.drain(); f.pass();
});

test('Pi wait wrapper rejects malformed receipts and terminates only an admitted wait', async () => {
    let waiting = 0, value;
    const callbacks = { status() {}, address() {}, assign() {}, acknowledgeInput() {}, async wait() { return value; } };
    const tool = createCoordinationTools(callbacks, () => { waiting++; }).find(tool => tool.name === 'conversation_wait');
    value = { waiting: false, state: 'original-recovery' };
    assert.equal((await tool.execute('refused', { resultHandles: ['original'] })).terminate, undefined); assert.equal(waiting, 0);
    for (const invalid of [undefined, {}, { waiting: 'true' }]) { value = invalid; await assert.rejects(tool.execute('invalid', { resultHandles: ['original'] }), /receipt unavailable/); }
    assert.equal(waiting, 0); value = { waiting: true };
    assert.equal((await tool.execute('admitted', { resultHandles: ['original'] })).terminate, true); assert.equal(waiting, 1);
});

test('all mixed wait handles are checked before quiescing, including an unknown handle after a cancelled original', async t => {
    const f = await failedAssignment(t, true), c = f.c;
    let quiesced = 0, observed;
    c.interactions.quiesceNative = () => { quiesced++; throw new Error('Unexpected native quiesce'); };
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId, randomUUID()] } } };
        observed = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'conversation_wait').at(-1);
        return { text: 'Unknown handle has no authority and no wait was admitted.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(observed.isError, true); assert.match(JSON.stringify(observed.content), /Unknown result handle/);
    assert.equal(quiesced, 0); f.pass();
});

test('post-quiesce outcome drift throws without rolling back physical SETTLING or committing WAIT', async t => {
    const f = await structuredAssignmentWorld(t); await f.assign();
    const c = f.c, quiesce = c.interactions.quiesceNative.bind(c.interactions); let observed, during;
    c.interactions.quiesceNative = identity => {
        quiesce(identity);
        c.store.run("UPDATE conversation_assignments SET state='UNAVAILABLE' WHERE id=?", f.child.assignmentId);
    };
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } };
        observed = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'conversation_wait').at(-1);
        during = c.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', f.parent);
        return { text: 'Retain the original changed outcome and observe physical settlement.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(observed.isError, true); assert.match(JSON.stringify(observed.content), /outcome changed while quiescing/);
    assert.equal(during.resource, 'SETTLING'); assert.equal(JSON.parse(during.data).waitHandles, undefined);
    f.pass();
});

test('status retains the exact cancelled original that never allocated work', async t => {
    const f = await queuedAssignmentWorld(t), c = f.c;
    await c.cancelQueuedAssignment({ ...f.input, expectedFingerprint: f.snapshot().fingerprint, reason: 'Owner withdraws only original queued task' });
    await f.finish();
    let status;
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_status', arguments: { conversationId: f.assignment.target } } };
        status = receipt(context, 'conversation_status'); return { text: 'The unallocated task was explicitly cancelled.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(status.workState, null); assert.equal(status.workEpoch, null);
    assert.equal(status.assignments.length, 1); assert.equal(status.assignments[0].assignmentId, f.assignment.id);
    assert.equal(status.assignments[0].state, 'CANCELLED'); assert.equal(status.assignments[0].workId, null); assert.equal(status.assignments[0].recovery, undefined);
    f.pass();
});

test('status does not disclose another actual coordinator assignment merely because its project is permitted', async t => {
    const f = await failedAssignment(t), original = { ...f.child };
    const otherParent = f.c.createConversation().conversationId;
    await run({ ...f, parent: otherParent }, (_context, turn) => turn ? { text: 'Other original coordinator retains its own task.' } : { tool: { name: 'conversation_assign', arguments: { projectId: 'P', instructions: 'Separate actual coordinator task', operation: 'change', resultDependency: true } } });
    await f.c.ordinary.drain();
    const other = { ...f.child }; assert.notEqual(other.assignmentId, original.assignmentId);
    let status;
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_status', arguments: { conversationId: other.conversationId } } };
        status = receipt(context, 'conversation_status'); return { text: 'Project metadata does not grant access to another coordinator assignment.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(status.workId, other.workId);
    assert.deepEqual(status.assignments, []); assert.equal(JSON.stringify(status).includes(other.assignmentId), false);
    f.pass();
});

test('actual original recovery restores admission but wait returns explicit reentry guidance without launching a child', async t => {
    const world = await structuredAssignmentWorld(t, { originalGovernedDispatch: true }), c = world.c;
    const changes = c.changes;
    changes.drive = async input => changes.inspect(input.workId);
    await world.assign();
    const assignment = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', world.parent);
    assert.equal(assignment.state, 'UNAVAILABLE');
    const f = { ...world, child: { assignmentId: assignment.id, conversationId: assignment.target, workId: assignment.work } };
    await c.cancelWork({ workId: assignment.work, expectedEpoch: 1 });
    const before = c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', f.child.workId);
    let recovered, status, refused;
    const runs = c.store.all('SELECT id FROM runs WHERE work=?', f.child.workId);
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_recover_assignment', arguments: { assignmentId: f.child.assignmentId, expectedWorkEpoch: 2, observedDirectionRevision: 0, reason: 'Explicitly restore this same original task admission only; no launch' } } };
        if (turn === 1) {
            recovered = receipt(context, 'conversation_recover_assignment');
            assert.equal(recovered.state, 'RECOVERY_READY');
            return { tool: { name: 'conversation_status', arguments: { conversationId: f.child.conversationId } } };
        }
        if (turn === 2) {
            status = receipt(context, 'conversation_status');
            return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } };
        }
        refused = receipt(context, 'conversation_wait');
        return { text: 'Admission is recovered; separately reenter this same task before waiting.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(recovered.workId, f.child.workId); assert.equal(recovered.epoch, 3);
    assert.equal(status.workState, 'ACTIVE'); assert.equal(status.assignments[0].state, 'RECOVERY_READY');
    assert.equal(refused.waiting, false); assert.deepEqual(refused.outcomes[0].reentry, status.assignments[0].reentry);
    assert.equal(refused.outcomes[0].reentry.conversationId, f.child.conversationId); assert.equal(refused.outcomes[0].reentry.observedDirectionRevision, recovered.directionRevision);
    assert.deepEqual(c.store.all('SELECT id FROM runs WHERE work=?', f.child.workId), runs);
    assert.deepEqual(c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', f.child.workId), before);
    assert.equal(c.store.one('SELECT resource FROM conversation_state WHERE conversation=?', f.parent).resource, 'IDLE'); f.pass();
});

for (const mutation of ['missing', 'wrong-work', 'wrong-target', 'wrong-assignment']) test(`COMPLETE with ${mutation} original publication returns a non-wait outcome`, async t => {
    const f = await structuredAssignmentWorld(t); await f.assign();
    const c = f.c, row = c.store.one('SELECT data FROM conversation_assignments WHERE id=?', f.child.assignmentId), data = JSON.parse(row.data);
    if (mutation === 'missing') c.store.run('DELETE FROM conversation_results WHERE id=?', data.resultId);
    if (mutation === 'wrong-work') c.store.run('UPDATE conversation_results SET work=? WHERE id=?', c.inspectConversation(f.parent).workId, data.resultId);
    if (mutation === 'wrong-target') c.store.run('UPDATE conversation_results SET conversation=? WHERE id=?', f.parent, data.resultId);
    if (mutation === 'wrong-assignment') c.store.run("UPDATE conversation_results SET data=json_set(data,'$.assignmentId',?) WHERE id=?", randomUUID(), data.resultId);
    const before = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.child.assignmentId);
    let refused;
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } };
        refused = receipt(context, 'conversation_wait'); return { text: 'Original result is unavailable; no new wait or result was fabricated.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(refused.waiting, false); assert.equal(refused.outcomes[0].resultAvailable, false);
    assert.deepEqual(c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.child.assignmentId), before); f.pass();
});

test('genuine legacy COMPLETE publication without its convenience result pointer remains waitable', async t => {
    const f = await structuredAssignmentWorld(t); await f.assign();
    f.c.store.run("UPDATE conversation_assignments SET data=json_remove(data,'$.resultId') WHERE id=?", f.child.assignmentId);
    const result = await run(f, (_context, turn) => turn ? { text: 'Original accepted legacy publication remains available.' } : { tool: { name: 'conversation_wait', arguments: { resultHandles: [f.child.assignmentId] } } });
    assert.equal(result.status, 'waiting'); await f.c.ordinary.drain(); f.pass();
});

test('same-project result work cannot be spoofed through top-level publication metadata', async t => {
    const world = await structuredAssignmentWorld(t); await world.assign();
    const original = { ...world.child }, f = { ...world, child: original }, c = f.c;
    const otherParent = c.createConversation().conversationId;
    await run({ ...world, parent: otherParent }, (_context, turn) => turn ? { text: 'Distinct original same-project producer completed.' } : { tool: { name: 'conversation_assign', arguments: { projectId: 'P', instructions: 'Other original governed producer', operation: 'change' } } });
    await c.ordinary.drain();
    const other = world.child; assert.notEqual(other.workId, original.workId);
    assert.equal(c.store.one('SELECT project FROM works WHERE id=?', other.workId).project, 'P');
    const data = JSON.parse(c.store.one('SELECT data FROM conversation_assignments WHERE id=?', original.assignmentId).data);
    c.store.run("UPDATE conversation_results SET work=?,data=json_set(data,'$.workId',?) WHERE id=?", other.workId, original.workId, data.resultId);
    let refused;
    const result = await run(f, (context, turn) => {
        if (!turn) return { tool: { name: 'conversation_wait', arguments: { resultHandles: [original.assignmentId] } } };
        refused = receipt(context, 'conversation_wait'); return { text: 'Stored result metadata cannot replace its original producer work binding.' };
    });
    assert.equal(result.status, 'delivered'); assert.equal(refused.waiting, false); assert.equal(refused.outcomes[0].resultAvailable, false); f.pass();
});

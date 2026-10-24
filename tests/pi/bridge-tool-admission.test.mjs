// Production per-query admission primitive; full Pi + SDK transport is reviewed separately.
import test from 'node:test';
import assert from 'node:assert/strict';
const entry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const { QueryContext } = await import(new URL('./query-state.js', entry));
const model = { api: 'owned', provider: 'owned', id: 'owned' };

test('streamed proposals remain inert until matching native handler reservation', () => {
    const c = new QueryContext(); let ready = 0; c.onNativeToolsReady = () => ready++;
    c.stageNativeTool('a', 'owned', { value: 1 }); assert.deepEqual(c.takeAdmittedNativeTools(), []);
    c.reserveNativeTool('a', 'owned', { value: 1 }); assert.equal(ready, 2);
    assert.deepEqual(c.takeAdmittedNativeTools(), [{ id: 'a', name: 'owned', input: { value: 1 } }]);
    assert.deepEqual(c.takeAdmittedNativeTools(), []);
});

test('native handler reservation before complete proposal remains inert', () => {
    const c = new QueryContext(); c.reserveNativeTool('a', 'owned', { value: 1 }); assert.deepEqual(c.takeAdmittedNativeTools(), []);
    c.stageNativeTool('a', 'owned', { value: 1 }); assert.equal(c.takeAdmittedNativeTools().length, 1);
});

test('serial A and deferred B survive Pi output reset without awaiting all handlers', () => {
    const c = new QueryContext(); c.resetTurnState(model);
    c.stageNativeTool('a', 'owned', { value: 1 }); c.stageNativeTool('b', 'owned', { value: 2 });
    c.reserveNativeTool('a', 'owned', { value: 1 }); assert.deepEqual(c.takeAdmittedNativeTools().map(call => call.id), ['a']);
    c.resetTurnState(model); assert.deepEqual(c.takeAdmittedNativeTools(), []);
    c.reserveNativeTool('b', 'owned', { value: 2 }); assert.deepEqual(c.takeAdmittedNativeTools().map(call => call.id), ['b']);
    assert.doesNotThrow(() => c.assertNativeToolsInvoked());
    assert.throws(() => c.reserveNativeTool('a', 'owned', { value: 1 }), /DUPLICATE/);
});

for (const mismatch of ['name', 'input']) test('native '+mismatch+' mismatch signals refusal before any executable call', () => {
    const c = new QueryContext(); const failures = []; c.onNativeToolFailure = error => failures.push(error);
    c.stageNativeTool('a', 'owned', { value: 1 });
    assert.throws(() => c.reserveNativeTool('a', mismatch === 'name' ? 'other' : 'owned', { value: mismatch === 'input' ? 100 : 1 }), /MISMATCH/);
    assert.equal(failures.length, 1); assert.throws(() => c.takeAdmittedNativeTools(), /MISMATCH/);
});

test('argument capture is immutable and object key order alone is not a mismatch', () => {
    const c = new QueryContext(), input = { b: [2, 3], a: { value: 1 } };
    c.stageNativeTool('a', 'owned', input); input.a.value = 100;
    c.reserveNativeTool('a', 'owned', { a: { value: 1 }, b: [2, 3] });
    assert.deepEqual(c.takeAdmittedNativeTools()[0].input, { a: { value: 1 }, b: [2, 3] });
});

test('close or native terminal without invocation cannot promote a pending proposal', () => {
    const c = new QueryContext(); c.stageNativeTool('a', 'owned', { value: 1 });
    assert.throws(() => c.assertNativeToolsInvoked(), /NOT_INVOKED/); c.closeNativeTools();
    assert.deepEqual(c.takeAdmittedNativeTools(), []); assert.throws(() => c.reserveNativeTool('a', 'owned', { value: 1 }), /CLOSED/);
});

test('abandoned uninvoked proposal remains a non-executable tombstone', () => {
    const c = new QueryContext(); c.stageNativeTool('old', 'owned', { value: 1 }, 'abandoned'); c.discardNativeProposals('abandoned');
    c.stageNativeTool('new', 'owned', { value: 2 }, 'replacement'); c.reserveNativeTool('new', 'owned', { value: 2 });
    assert.deepEqual(c.takeAdmittedNativeTools().map(call => call.id), ['new']); assert.doesNotThrow(() => c.assertNativeToolsInvoked());
    assert.throws(() => c.reserveNativeTool('old', 'owned', { value: 1 }), /MISMATCH/);
});


test('stream cohort completion waits for trailing prose without waiting for a deferred handler', () => {
    const c = new QueryContext(); c.reserveNativeTool('a', 'owned', { value: 1 });
    c.stageNativeTool('a', 'owned', { value: 1 }, 'cohort', false);
    c.stageNativeTool('b', 'owned', { value: 2 }, 'cohort', false);
    assert.deepEqual(c.takeAdmittedNativeTools(), []);
    c.completeNativeCohort('cohort'); assert.deepEqual(c.takeAdmittedNativeTools().map(call => call.id), ['a']);
    assert.deepEqual([...c.nativeResultsOutstanding], ['a']); c.consumeNativeResults(['foreign']); assert.equal(c.nativeResultsOutstanding.size, 1);
    c.consumeNativeResults(['a']); assert.equal(c.nativeResultsOutstanding.size, 0);
    c.resetTurnState(model); c.reserveNativeTool('b', 'owned', { value: 2 }); assert.deepEqual(c.takeAdmittedNativeTools().map(call => call.id), ['b']);
});

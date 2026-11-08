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

test('native admission distinguishes a literal escape sequence from its Unicode character', () => {
    const tool = 'gitjig_submit_role_result';
    const character = JSON.parse(String.raw`{"summary":"Checks passed \u2014 retained"}`);
    const literal = JSON.parse(String.raw`{"summary":"Checks passed \\u2014 retained"}`);
    const matching = new QueryContext();
    matching.stageNativeTool('call', tool, character, 'message', false);
    matching.stageNativeTool('call', tool, {summary: 'Checks passed — retained'}, 'message', false);
    matching.reserveNativeTool('call', tool, character);
    matching.completeNativeCohort('message');
    assert.deepEqual(matching.takeAdmittedNativeTools().map(row => row.input), [character]);
    const mismatched = new QueryContext();
    mismatched.stageNativeTool('call', tool, character, 'message', false);
    assert.throws(() => mismatched.stageNativeTool('call', tool, literal, 'message', false), /BRIDGE_HOST_TOOL_INVOCATION_MISMATCH/);
    assert.throws(() => mismatched.takeAdmittedNativeTools(), /BRIDGE_HOST_TOOL_INVOCATION_MISMATCH/);
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

test('abandonment preserves a published tool and an unrelated reservation, and refuses a late buffered call', () => {
    const c = new QueryContext();
    c.stageNativeTool('published', 'owned', {value:1}, 'closed');
    c.reserveNativeTool('published', 'owned', {value:1});
    assert.equal(c.takeAdmittedNativeTools().length, 1);
    c.reserveNativeTool('next', 'owned', {value:2});
    c.nativeStreamMessageId = 'abandoned';
    c.nativeStreamTools.set(0, {id:'late',name:'owned',input:{},partial:''});
    c.discardNativeProposals('abandoned');
    c.stageNativeTool('next', 'owned', {value:2}, 'next-message');
    assert.deepEqual(c.takeAdmittedNativeTools().map(call=>call.id), ['next']);
    assert.deepEqual([...c.nativeResultsOutstanding], ['published','next']);
    assert.throws(() => c.reserveNativeTool('late','owned',{value:3}), /BRIDGE_HOST_TOOL_INVOCATION_MISMATCH/);
});

test('exact completed fallback can take a reserved call from an unclosed raw block', () => {
    const c = new QueryContext();
    c.nativeStreamMessageId = 'old';
    c.nativeStreamTools.set(0, {id:'call',name:'owned',input:{},partial:''});
    c.reserveNativeTool('call','owned',{value:1});
    c.replaceNativeCohort('old','replacement',[{id:'call',name:'owned',input:{value:1}}]);
    assert.deepEqual(c.takeAdmittedNativeTools().map(call=>call.id), ['call']);
    assert.doesNotThrow(() => c.assertNativeToolsInvoked());
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

test('a completed packet cannot assign a pending call to a different message', () => {
    const c = new QueryContext();
    c.stageNativeTool('a', 'owned', {value:1}, 'open-message', false);
    c.reserveNativeTool('a', 'owned', {value:1});
    assert.throws(() => c.stageNativeTool('a', 'owned', {value:1}, 'different-message'), /BRIDGE_HOST_TOOL_INVOCATION_MISMATCH/);
    assert.throws(() => c.takeAdmittedNativeTools(), /BRIDGE_HOST_TOOL_INVOCATION_MISMATCH/);
});

test('completed fallback transfers exact proposals atomically and still requires actual invocation', () => {
    const c = new QueryContext();
    c.stageNativeTool('same', 'owned', { value: 1 }, 'old', false);
    c.replaceNativeCohort('old', 'replacement', [{ id: 'same', name: 'owned', input: { value: 1 } }]);
    assert.equal(c.isSupersededNativeMessage('old'), true);
    assert.deepEqual(c.takeAdmittedNativeTools(), []);
    c.reserveNativeTool('same', 'owned', { value: 1 });
    assert.deepEqual(c.takeAdmittedNativeTools(), [{ id: 'same', name: 'owned', input: { value: 1 } }]);
    assert.deepEqual(c.takeAdmittedNativeTools(), []);
});
for (const defect of ['name', 'input', 'duplicate', 'discarded']) test('completed fallback refuses whole roster for ' + defect, () => {
    const c = new QueryContext(); let notifications = 0;
    c.stageNativeTool('old-call', 'owned', { value: 1 }, 'old', false);
    if (defect === 'discarded') c.discardNativeProposals('old');
    c.reserveNativeTool('fresh', 'owned', { value: 2 });
    c.onNativeToolsReady = () => notifications++;
    const prior = { id: 'old-call', name: defect === 'name' ? 'other' : 'owned', input: { value: defect === 'input' ? 100 : 1 } };
    const roster = [{ id: 'fresh', name: 'owned', input: { value: 2 } }, prior];
    if (defect === 'duplicate') roster.push(prior);
    assert.throws(() => c.replaceNativeCohort('old', 'replacement', roster), /MISMATCH|IDENTITY_UNAVAILABLE/);
    assert.equal(notifications, 0, 'No partial roster readiness notification');
    assert.equal(c.isSupersededNativeMessage('old'), false, 'Rejected replacement did not commit');
    assert.throws(() => c.takeAdmittedNativeTools(), /MISMATCH|IDENTITY_UNAVAILABLE/);
});
test('completed fallback preserves exact reserved calls and closes unmatched reservations', () => {
    const c = new QueryContext();
    c.stageNativeTool('a', 'owned', { value: 1 }, 'old', false);
    c.reserveNativeTool('a', 'owned', { value: 1 });
    c.replaceNativeCohort('old', 'replacement', [{ id: 'a', name: 'owned', input: { value: 1 } }]);
    assert.deepEqual(c.takeAdmittedNativeTools().map(v => v.id), ['a']);
    assert.throws(() => c.reserveNativeTool('a', 'owned', { value: 1 }), /DUPLICATE/);
    const unmatched = new QueryContext();
    unmatched.stageNativeTool('a', 'owned', { value: 1 }, 'old', false);
    unmatched.reserveNativeTool('a', 'owned', { value: 1 });
    assert.throws(() => unmatched.replaceNativeCohort('old', 'replacement', []), /MISMATCH/);
    assert.throws(() => unmatched.takeAdmittedNativeTools(), /MISMATCH/);
});
test('fallback cannot reuse published IDs, superseded messages or closed admission', () => {
    for (const mode of ['published', 'superseded', 'closed']) {
        const c = new QueryContext();
        c.stageNativeTool('a', 'owned', { value: 1 }, 'old', false);
        if (mode === 'published') { c.reserveNativeTool('a', 'owned', { value: 1 }); c.completeNativeCohort('old'); c.takeAdmittedNativeTools(); }
        if (mode === 'superseded') c.replaceNativeCohort('old', 'replacement', [{ id: 'a', name: 'owned', input: { value: 1 } }]);
        if (mode === 'closed') c.closeNativeTools();
        assert.throws(() => c.replaceNativeCohort('old', 'another', [{ id: 'a', name: 'owned', input: { value: 1 } }]), /MISMATCH|CLOSED/);
    }
});

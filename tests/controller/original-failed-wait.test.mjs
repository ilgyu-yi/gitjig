import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';
import {originalFailedWaitOutcome} from '../../dist/controller/original-wait-outcome.js';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {reviewConversationInputs} from '../../dist/ui/input-commands.js';
import {uiText} from '../../dist/ui/i18n.js';

test('the original queued WAIT result can be delivered from retained-input recovery once', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t);
    const completed = f.c.ordinary.h.completed;
    const beforeFresh = completed.beforeFresh;
    completed.beforeFresh = async () => { throw Error('Simulated stop before dispatch'); };
    try { await f.settle(); }
    finally { completed.beforeFresh = beforeFresh; }
    const store = f.c.store;
    const [input] = f.c.inspectConversationInputs(f.parent);
    assert.equal(input.waitDelivery, true);
    assert.equal(input.retryEligible, true);
    assert.equal(input.withdrawEligible, false);
    const recovery = {conversationId: f.parent, inputId: input.inputId, expectedContext: input.fingerprint};
    assert.throws(() => f.c.recoverConversationInput({...recovery, action: 'withdraw'}), /not safe to recover/);
    const saved = store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId);
    const state = store.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent);
    const incomplete = JSON.parse(state.data);
    delete incomplete.explicitContinuation.sourceIdentity;
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(incomplete), f.parent);
    await assert.rejects(f.c.runConversation({conversationId: f.parent, initialInputId: input.inputId, model: f.model}), /Retained dependency result changed/);
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', state.data, f.parent);
    const [result] = store.all('SELECT * FROM conversation_results WHERE conversation=?', f.children[0].conversationId);
    store.run('UPDATE conversation_results SET data=? WHERE id=?', JSON.stringify({...JSON.parse(result.data), recoveryProbe: true}), result.id);
    assert.throws(() => f.c.recoverConversationInput({...recovery, action: 'retry'}), /not safe to recover/);
    store.run('UPDATE conversation_results SET data=? WHERE id=?', result.data, result.id);
    const draft = 'Keep this new draft';
    f.c.setDraft({conversationId: f.parent, expectedRevision: f.c.inspectConversation(f.parent).draft.revision, text: draft});
    const refreshed = f.c.inspectConversationInputs(f.parent)[0];
    const copy = key => uiText('ko', 'input.' + key);
    const outcome = await reviewConversationInputs({controller: f.c, isCurrent: () => true, locale: () => 'ko',
        show: async (_title, detail, advance) => { assert.ok(detail.includes(copy('recoveryWaitDeliveryNext'))); await advance.run(); },
        choose: async (_title, choices) => {
            assert.deepEqual(choices, [copy('recoveryBackUnchanged'), copy('recoveryWaitDeliver')]);
            return choices[1];
        },
        retry: async (conversationId, reviewed) => {
            assert.deepEqual([conversationId, reviewed.inputId], [f.parent, input.inputId]);
            const selected = f.c.recoverConversationInput({...recovery, expectedContext: reviewed.fingerprint, action: 'retry'});
            assert.deepEqual(store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId), saved);
            await f.c.runConversation({conversationId, initialInputId: selected.inputId, model: f.model});
        },
        inspectWork: async () => assert.fail('No unrelated work should open'), notice: () => {},
    }, f.parent, {originalInput: refreshed, blockedDraft: true});
    assert.equal(outcome, 'started');
    assert.equal(f.c.inspectConversation(f.parent).draft.text, draft);
    assert.deepEqual(f.continuations, [saved.text]);
    const receipt = JSON.parse(store.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data).explicitContinuation;
    assert.equal(receipt.inputId, input.inputId);
    assert.ok(receipt.newRunId);
    assert.equal(store.one('SELECT state FROM conversation_inputs WHERE id=?', input.inputId).state, 'CONSUMED');
    assert.throws(() => f.c.recoverConversationInput({...recovery, action: 'retry'}), /not safe to recover/);
    f.pass();
});

test('accepted WAIT on a default nondependent task delivers its original failure once without creating a dependency', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {resultDependency: false});
    const child = f.children[0], s = f.c.store;
    const runs = s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', child.workId);
    await f.settle();
    assert.equal(f.continuations.length, 1);
    assert.ok(f.continuations[0].includes('UNAVAILABLE'));
    assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'UNAVAILABLE');
    assert.equal(s.one('SELECT COUNT(*) n FROM conversation_dependencies WHERE assignment=?', child.assignmentId).n, 0);
    assert.deepEqual(s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', child.workId), runs);
    assert.equal(s.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?", f.parent).n, 2);
    const state = JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data);
    assert.equal(state.continuationAuthorized, false);
    for (let index = 0; index < 3; index++) f.c.ordinary.resumeAuthorized();
    await f.c.ordinary.drain();
    assert.equal(f.continuations.length, 1);
    f.pass();
});

test('nondependent failure still requires exact accepted WAIT and unambiguous dependency provenance', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {resultDependency: false, automatic: false});
    await f.settle();
    const child = f.children[0], s = f.c.store;
    const assignment = s.one('SELECT data FROM conversation_assignments WHERE id=?', child.assignmentId);
    const original = JSON.parse(assignment.data);
    assert.equal(original.resultDependency, false);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'deliverable');
    for (const flag of [undefined, true, 'false']) {
        s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...original, resultDependency: flag}), child.assignmentId);
        assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
    }
    s.run('UPDATE conversation_assignments SET data=? WHERE id=?', assignment.data, child.assignmentId);
    const state = s.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent);
    const data = JSON.parse(state.data);
    s.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({...data, waitHandles: []}), f.parent);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
    s.run('UPDATE conversation_state SET data=? WHERE conversation=?', state.data, f.parent);
    const edge = randomUUID();
    s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', edge, f.parent, child.conversationId, child.assignmentId, 'PENDING', '{}');
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
    s.run('UPDATE conversation_dependencies SET target=?,data=? WHERE id=?', f.parent, JSON.stringify({source: data.sourceIdentity}), edge);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
    s.run('DELETE FROM conversation_dependencies WHERE id=?', edge);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'deliverable');
    assert.equal(f.continuations.length, 0);
    f.pass();
});

for (const mixed of [false, true]) test('accepted original WAIT delivers failed diagnostic once without retry/success; mixed=' + mixed, {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {mixed});
    const childRuns = f.c.store.all('SELECT id FROM runs WHERE work IN (SELECT work FROM conversation_assignments WHERE source_conversation=?)', f.parent);
    await f.settle();
    assert.equal(f.continuations.length, 1);
    assert.ok(f.continuations[0].includes('UNAVAILABLE'));
    assert.ok(f.publications.length > 0);
    const failed = f.children[mixed ? 1 : 0];
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', failed.assignmentId).state, 'UNAVAILABLE');
    assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', failed.assignmentId).state, 'PENDING');
    assert.equal(f.c.inspectWork(failed.workId).state, 'ACTIVE');
    assert.deepEqual(f.c.store.all('SELECT id FROM runs WHERE work IN (SELECT work FROM conversation_assignments WHERE source_conversation=?)', f.parent), childRuns);
    const data = JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data);
    assert.equal(data.continuationAuthorized, false); assert.equal(data.waitHandles, undefined);
    assert.ok(data.explicitContinuation.inputId);
    assert.equal(f.c.store.one("SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=? AND text LIKE 'Explicitly resumed authorized dependency outcomes%'", f.parent).n, 1);
    assert.equal(f.c.store.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?", f.parent).n, 2);
    for (let index = 0; index < 3; index++) f.c.ordinary.resumeAuthorized();
    await f.c.ordinary.drain(); assert.equal(f.continuations.length, 1); f.pass();
});

test('original goal WAIT charges its failed-result inspection turn, preserving child and completion holds', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {goal: true});
    assert.equal(f.c.inspectGoal(f.goal.goalId).startedAttempts, 1);
    await f.settle();
    const goal = f.c.inspectGoal(f.goal.goalId);
    assert.equal(f.continuations.length, 1); assert.equal(goal.startedAttempts, 2); assert.equal(goal.state, 'WAITING_INPUT');
    assert.match(goal.reason, /Actual UNAVAILABLE/);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.children[0].assignmentId).state, 'UNAVAILABLE');
    assert.ok(f.c.goals.links(f.goal.goalId).some(link => link.id === f.children[0].assignmentId && link.state === 'UNAVAILABLE'));
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?', f.children[0].workId).n, 1);
    f.pass();
});

for (const mutation of ['wrong-row-work-spoof', 'missing-publication', 'stale-epoch', 'foreign-source', 'cancelled', 'unknown', 'quarantined-work', 'ready', 'effect', 'reconciliation', 'wait-input', 'context', 'wait-launch', 'missing-current-dependency', 'wrong-root', 'native-operation', 'capacity-quarantine', 'missing-cleanup']) test('failed WAIT proof holds ' + mutation + ' without changing original records', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {automatic: false}); await f.settle();
    const child = f.children[0], s = f.c.store, row = s.one('SELECT * FROM conversation_assignments WHERE id=?', child.assignmentId), data = JSON.parse(row.data);
    let cleanup = () => {};
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'deliverable');
    if (mutation === 'wrong-row-work-spoof') {
        const raw = s.one('SELECT data FROM conversation_results WHERE id=?', data.resultId);
        const wrongWork = randomUUID();
        s.run('INSERT INTO works SELECT ?,project,source,NULL,?,state,epoch,generation,current_result,data FROM works WHERE id=?', wrongWork, wrongWork, child.workId);
        s.run('UPDATE conversation_results SET work=?,data=? WHERE id=?', wrongWork, JSON.stringify({...JSON.parse(raw.data), workId: child.workId}), data.resultId);
    }
    if (mutation === 'missing-publication') s.run('DELETE FROM conversation_results WHERE id=?', data.resultId);
    if (mutation === 'stale-epoch') s.run('UPDATE works SET epoch=epoch+1 WHERE id=?', child.workId);
    if (mutation === 'foreign-source') s.run('UPDATE conversation_assignments SET source_conversation=? WHERE id=?', f.c.createConversation().conversationId, child.assignmentId);
    if (mutation === 'cancelled') s.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?", child.assignmentId);
    if (mutation === 'unknown') s.run("UPDATE works SET state='UNKNOWN' WHERE id=?", child.workId);
    if (mutation === 'quarantined-work') s.run("UPDATE works SET state='QUARANTINED' WHERE id=?", child.workId);
    if (mutation === 'ready') s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...data, result: {...data.result, reviewReady: true}}), child.assignmentId);
    if (mutation === 'effect') s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...data, operation: 'effect-integrate'}), child.assignmentId);
    if (mutation === 'reconciliation') s.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id=?", JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data).sourceIdentity.initialInputId);
    if (mutation === 'wait-input') {
        const parent = s.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent), d = JSON.parse(parent.data);
        d.sourceIdentity.initialInputId = randomUUID(); s.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(d), f.parent);
    }
    if (mutation === 'context') { const work = s.one('SELECT data FROM works WHERE id=?', child.workId); s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({...JSON.parse(work.data), contextOrigin: {kind: 'fork'}}), child.workId); }
    if (mutation === 'wait-launch') {
        const parent = s.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent), d = JSON.parse(parent.data);
        d.sourceIdentity.launchId = randomUUID(); s.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(d), f.parent);
    }
    if (mutation === 'missing-current-dependency') s.run("UPDATE conversation_dependencies SET data='{}' WHERE assignment=?", child.assignmentId);
    if (mutation === 'wrong-root') s.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...data, delegationRoot: randomUUID()}), child.assignmentId);
    if (mutation === 'missing-cleanup') {
        const run = s.one('SELECT id,data FROM runs WHERE work=?', child.workId), d = JSON.parse(run.data); delete d.cleanup;
        s.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify(d), run.id);
    }
    if (mutation === 'native-operation') {
        const target = randomUUID(), grant = randomUUID(), operation = randomUUID();
        s.run('INSERT INTO effect_targets VALUES(?,?,?)', target, 'P', '{}');
        s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, child.workId, target, 1, '{}');
        s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', operation, child.workId, target, grant, 'UNKNOWN', '{}');
        cleanup = () => {s.run('DELETE FROM effect_operations WHERE id=?', operation);s.run('DELETE FROM effect_delegations WHERE id=?', grant);s.run('DELETE FROM effect_targets WHERE id=?', target);};
    }
    if (mutation === 'capacity-quarantine') {
        const id = randomUUID(), run = s.one('SELECT id,epoch FROM runs WHERE work=?', child.workId);
        s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', id, child.workId, run.id, run.epoch, s.one('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM capacity_leases').n, 'QUARANTINED', '{}');
        cleanup = () => s.run('DELETE FROM capacity_leases WHERE id=?', id);
    }
    try {
        assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
        if (['wrong-row-work-spoof', 'unknown', 'quarantined-work'].includes(mutation))
            assert.equal(f.c.explicitWaitContinuation(f.parent, false), null);
        assert.equal(f.continuations.length, 0); f.pass();
    } finally {cleanup();}
});

for (const workState of ['UNKNOWN', 'QUARANTINED']) test(`an accepted WAIT preserves unconfirmed ${workState} owner work`, {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {resultDependency: false});
    const child = f.children[0], workId = f.c.inspectConversation(f.parent).workId;
    f.c.store.run('UPDATE works SET state=? WHERE id=?', workState, workId);
    await f.settle();
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'UNAVAILABLE');
    const destination = 'wait-' + workState.toLowerCase();
    const sourceRoot = await fs.mkdtemp(path.join(f.root, destination + '-'));
    await f.c.registerProject({id: destination, sourceRoot});
    const snapshot = () => ['works', 'runs', 'budgets', 'conversation_state', 'conversation_inputs', 'conversation_results'].map(
        table => f.c.store.all(`SELECT * FROM ${table} ORDER BY rowid`));
    const before = snapshot();
    assert.equal(f.c.inspectConversationWait(f.parent)?.settlementUnconfirmed, true);
    assert.equal(originalFailedWaitOutcome(f.c.store, f.parent, child.assignmentId).state, 'held');
    assert.equal(f.c.explicitWaitContinuation(f.parent), null);
    await assert.rejects(f.c.runConversation({conversationId: f.parent, model: f.model}),
        error => error.code === 'WAIT_SETTLEMENT_UNCONFIRMED' && error.workId === workId);
    const [project] = projectCommands({controller: f.c, isCurrent: () => true,
        notice: () => assert.fail('Held project reported success'), refresh: async () => assert.fail('Held project refreshed'),
        input: async () => undefined, choose: async () => undefined});
    await assert.rejects(project.run(destination, f.parent), error => error.code === 'PROJECT_WORK_PENDING' &&
        error.workId === workId && error.projectTarget.id === destination);
    f.c.ordinary.resumeAuthorized();
    assert.equal(f.continuations.length, 0);
    assert.deepEqual(snapshot(), before);
    f.pass();
});

test('known unfinished cleanup stays pending, quarantined cleanup stays held', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {automatic: false}); await f.settle(); const child = f.children[0], s = f.c.store;
    const run = s.one('SELECT * FROM runs WHERE work=?', child.workId), original = JSON.parse(run.data);
    s.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?', 'SETTLING', 'reserved', JSON.stringify({...original, cleanup: undefined}), run.id);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'pending');
    s.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({...original, cleanup: 'quarantined'}), run.id);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'held');
    s.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?', run.phase, run.reservation, run.data, run.id);
    assert.equal(originalFailedWaitOutcome(s, f.parent, child.assignmentId).state, 'deliverable'); f.pass();
});

test('explicit owner resume from retained BLOCKED checkpoint consumes the same WAIT once at a newer goal revision', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {goal: true});
    const initial = f.c.inspectGoal(f.goal.goalId);
    await f.c.pauseGoal({goalId: initial.goalId, expectedRevision: initial.revision, reason: 'Owner holds this exact dependency checkpoint'});
    await f.settle(); assert.equal(f.continuations.length, 0);
    // Controlled retained old-observer checkpoint, not a replacement WAIT/input or producer.
    f.c.store.run("UPDATE goals SET state='BLOCKED' WHERE id=?", f.goal.goalId);
    const checkpoint = f.c.inspectGoal(f.goal.goalId), waitingRun = f.c.store.one("SELECT run FROM goal_attempts WHERE goal=? AND state='WAITING'", f.goal.goalId).run;
    f.c.startGoal({goalId: checkpoint.goalId, expectedRevision: checkpoint.revision, model: f.model});
    await f.c.ordinary.drain();
    assert.equal(f.continuations.length, 1);
    const resumed = f.c.inspectGoal(f.goal.goalId);
    assert.equal(resumed.startedAttempts, 2); assert.ok(resumed.revision > initial.revision);
    assert.notEqual(f.c.store.one('SELECT state FROM goal_attempts WHERE run=?', waitingRun).state, 'WAITING');
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.children[0].assignmentId).state, 'UNAVAILABLE');
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?', f.children[0].workId).n, 1); f.pass();
});

test('goal observer waits for a known physical tail, but blocks unknown cleanup', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {goal: true, automatic: false}); await f.settle();
    const run = f.c.store.one('SELECT * FROM runs WHERE work=?', f.children[0].workId), data = JSON.parse(run.data);
    f.c.store.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?', 'SETTLING', 'reserved', JSON.stringify({...data, cleanup: undefined}), run.id);
    f.c.goals.observeDependencies(); assert.equal(f.c.inspectGoal(f.goal.goalId).state, 'WAITING_DEPENDENCY');
    f.c.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({...data, cleanup: 'unknown'}), run.id);
    f.c.goals.observeDependencies(); assert.equal(f.c.inspectGoal(f.goal.goalId).state, 'BLOCKED');
    f.c.store.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?', run.phase, run.reservation, run.data, run.id); f.pass();
});

test('mismatched investigation label cannot authorize automatic governed diagnostic; explicit inspection remains available', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {automatic: false}); await f.settle();
    const child = f.children[0], row = f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?', child.assignmentId);
    f.c.store.run('UPDATE conversation_assignments SET data=? WHERE id=?', JSON.stringify({...JSON.parse(row.data), operation: 'investigate'}), child.assignmentId);
    assert.equal(originalFailedWaitOutcome(f.c.store, f.parent, child.assignmentId).state, 'held');
    const receipt = f.c.explicitWaitContinuation(f.parent, false);
    assert.ok(receipt.inputId);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'UNAVAILABLE');
    assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?', child.assignmentId).state, 'PENDING');
    assert.equal(f.continuations.length, 0); f.pass();
});

test('a diagnostic delivery cannot bypass an exhausted original goal turn allowance', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {goal: true, goalTurnLimit: 1}); await f.settle();
    const current = f.c.inspectGoal(f.goal.goalId);
    assert.equal(current.state, 'BUDGET_EXHAUSTED'); assert.equal(current.startedAttempts, 1); assert.equal(f.continuations.length, 0);
    const child = f.children[0];
    assert.equal(originalFailedWaitOutcome(f.c.store, f.parent, child.assignmentId).state, 'deliverable');
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs WHERE work=?', child.workId).n, 1);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', child.assignmentId).state, 'UNAVAILABLE');
    assert.equal(JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data).continuationAuthorized, true); f.pass();
});

for (const historicalState of ['UNAVAILABLE', 'CANCELLED']) test('historical ' + historicalState + ' stays in goal evidence while current wait retains its own scope', {timeout: 20000}, async t => {
    const f = await failedWaitWorld(t, {goal: true});
    const first = f.c.inspectGoal(f.goal.goalId);
    await f.c.pauseGoal({goalId: first.goalId, expectedRevision: first.revision, reason: 'Owner pauses before observing current publication'});
    await f.settle();
    const source = JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?', f.parent).data).sourceIdentity;
    const historicalId = randomUUID(), historicalTarget = f.c.createConversation({projectId: 'P'}).conversationId;
    // Controlled retained historical link: no result is fabricated or made eligible for delivery.
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', historicalId, f.parent, historicalTarget, null, historicalState, JSON.stringify({source, operation: 'change'}));
    const paused = f.c.inspectGoal(first.goalId);
    f.c.startGoal({goalId: paused.goalId, expectedRevision: paused.revision, model: f.model});
    await f.c.ordinary.drain();
    assert.ok(f.c.goals.links(first.goalId).some(link => link.id === historicalId && link.state === historicalState));
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', historicalId).state, historicalState);
    assert.notEqual(f.c.inspectGoal(first.goalId).state, 'COMPLETED');
    if (historicalState === 'UNAVAILABLE') {
        assert.equal(f.continuations.length, 1); assert.equal(f.c.inspectGoal(first.goalId).startedAttempts, 2);
        const author = f.c.store.one('SELECT * FROM goal_attempts WHERE goal=? ORDER BY ordinal DESC LIMIT 1', first.goalId);
        await assert.rejects(f.c.goals.evidence(author), /Required original goal assignment remains UNAVAILABLE/);
    } else {
        assert.equal(f.continuations.length, 0); assert.equal(f.c.inspectGoal(first.goalId).state, 'BLOCKED');
    }
    f.pass();
});

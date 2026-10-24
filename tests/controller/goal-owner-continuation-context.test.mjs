import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getCurrentTools, getCurrentSystemPrompt } from '@earendil-works/pi-ai/compat';
import { structuredAssignmentWorld } from './structured-assignment-fixture.mjs';
import { failedWaitWorld } from './original-failed-wait-fixture.mjs';
import { scripted } from './effect-fixture.mjs';

const report = disposition => ({ tool: { name: 'goal_progress', arguments: {
    disposition, plan: 'Inspect original observations under the retained goal', nextAction: 'Owner inspection remains separate',
    reason: 'Controlled original goal context observation', resultIds: [],
} } });
const content = message => message?.content?.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
const systemText = context => getCurrentSystemPrompt(context.messages);
function counts(c) {
    return { runs: c.store.one('SELECT count(*) n FROM runs').n, inputs: c.store.one('SELECT count(*) n FROM conversation_inputs').n,
        attempts: c.store.one('SELECT count(*) n FROM goal_attempts').n, assignments: c.store.one('SELECT count(*) n FROM conversation_assignments').n,
        grants: c.store.one('SELECT count(*) n FROM effect_delegations').n, operations: c.store.one('SELECT count(*) n FROM effect_operations').n,
        budgets: c.store.all('SELECT * FROM budgets ORDER BY rowid') };
}
function observer(c, goalId, { proseFirst = false, beforeStatus, afterStatus } = {}) {
    const turns = new Map(), records = [], before = new Map();
    const model = scripted(context => {
        const goal = c.inspectGoal(goalId), attempt = goal.attempts.at(-1), turn = turns.get(attempt.attemptId) ?? 0;
        turns.set(attempt.attemptId, turn + 1);
        if (turn === 0) {
            const prompt = systemText(context); assert.ok(prompt.includes('Retained owner goal'));
            records.push({ attempt, prompt });
            beforeStatus?.(attempt, context);
            before.set(attempt.attemptId, counts(c));
            return { tool: { name: 'goal_status', arguments: {} } };
        }
        if (turn === 1) {
            const result = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'goal_status').at(-1);
            assert.equal(result.isError, false, content(result));
            const record = records.at(-1); record.status = JSON.parse(content(result));
            assert.deepEqual(counts(c), before.get(attempt.attemptId), 'Inspection itself admits no work/input/grant or spend');
            afterStatus?.(record);
            return proseFirst && attempt.ordinal === 1 ? { text: 'Progress observation only; the bounded goal continues.' } : report('need-owner');
        }
        return { text: 'Original observations retained; no execution eligibility was inferred.' };
    });
    model.provider = 'goal-owner-context-' + randomUUID(); model.definition.api = 'goal-owner-context-api-' + randomUUID();
    return { model, records };
}

test('public author attempts bind one exact owner continuation event across automatic turns and a distinct public resume', { timeout: 20000 }, async t => {
    const f = await structuredAssignmentWorld(t), c = f.c;
    const g = c.createGoal({ conversationId: f.parent, objective: 'Continue the original finite owner objective', criteria: ['Preserve source and accounting'], turnLimit: 6 });
    const seen = observer(c, g.goalId, { proseFirst: true });
    c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: seen.model });
    const first = await c.waitGoal(g.goalId);
    assert.equal(first.state, 'WAITING_INPUT', first.reason); assert.equal(first.startedAttempts, 2);
    assert.equal(seen.records.length, 2);
    const [a, b] = seen.records;
    assert.equal(a.status.ownerContinuation.eventId, b.status.ownerContinuation.eventId);
    assert.equal(a.status.ownerContinuation.goalRevision, first.revision);
    assert.match(a.prompt, /owner explicitly continued/i); assert.match(a.status.reason, /turn 1 is running/);
    assert.match(b.status.reason, /turn 2 is running/);
    assert.equal(a.status.currentTasks.tasks.length, 0);
    assert.equal(Object.hasOwn(a.status, 'kind'), false, 'Small status remains an ordinary complete object');
    const event = c.store.one('SELECT * FROM goal_events WHERE id=?', a.status.ownerContinuation.eventId), source = JSON.parse(event.data);
    assert.equal(source.acceptedGoalRevision, first.revision); assert.equal(source.turnLimit, 6);
    assert.equal(source.conversationId, f.parent); assert.equal(source.definitionHash, a.status.ownerContinuation.definitionHash);
    assert.equal(c.store.one('SELECT count(*) n FROM goal_events WHERE goal=? AND kind=?', g.goalId, 'owner-resume').n, 1);
    await c.goalCore.drain(g.goalId);
    c.startGoal({ goalId: g.goalId, expectedRevision: first.revision, model: seen.model });
    const resumed = await c.waitGoal(g.goalId), last = seen.records.at(-1);
    assert.equal(resumed.state, 'WAITING_INPUT', resumed.reason); assert.equal(resumed.startedAttempts, 3);
    assert.notEqual(last.status.ownerContinuation.eventId, a.status.ownerContinuation.eventId);
    assert.equal(last.status.ownerContinuation.goalRevision, resumed.revision);
    assert.equal(c.store.one('SELECT count(*) n FROM conversation_assignments').n, 0);
    f.pass();
});

test('current linked metadata stays distinct from its scoped original historical publication', { timeout: 20000 }, async t => {
    const f = await failedWaitWorld(t, { goal: true }), c = f.c;
    await f.settle();
    const goal = c.inspectGoal(f.goal.goalId); assert.equal(goal.state, 'WAITING_INPUT', goal.reason);
    const assignment = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.children[0].assignmentId);
    const data = JSON.parse(assignment.data), publication = c.store.one('SELECT * FROM conversation_results WHERE id=?', data.resultId);
    const oldEpoch = JSON.parse(publication.data).result.epoch;
    // Controlled metadata-observation premise only; not an owner adoption/recovery receipt or standing proof.
    c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?', assignment.work);
    c.store.run('UPDATE change_state SET phase=? WHERE work=?', 'BASE_CAPTURED', assignment.work);
    const unrelated = await c.beginChange({ projectId: 'P', request: 'Unrelated same-project work for the observation-scope negative' });
    const unrelatedTarget = c.createConversation({ projectId: 'P' }).conversationId;
    const seen = observer(c, goal.goalId, { afterStatus(record) {
        for (const [field, value] of [['work', unrelated.workId], ['target', unrelatedTarget], ['source_conversation', unrelatedTarget]]) {
            c.store.run(`UPDATE conversation_assignments SET ${field}=? WHERE id=?`, value, assignment.id);
            try {
                const current = c.goalCore.context(record.attempt.data.identity).controls.status();
                const item = current.currentTasks.tasks.find(task => task.assignmentId === assignment.id);
                assert.equal(item.state, 'unavailable'); assert.equal(Object.hasOwn(item, 'recordedPhase'), false);
            } finally { c.store.run(`UPDATE conversation_assignments SET ${field}=? WHERE id=?`, assignment[field], assignment.id); }
        }
        const originalSource = c.store.one('SELECT id,origin FROM sources WHERE id=(SELECT source FROM works WHERE id=?)', assignment.work);
        c.store.run('UPDATE sources SET origin=? WHERE id=?', '{malformed', originalSource.id);
        try {
            const current = c.goalCore.context(record.attempt.data.identity).controls.status();
            assert.equal(current.currentTasks.tasks.find(task => task.assignmentId === assignment.id).state, 'unavailable');
        } finally { c.store.run('UPDATE sources SET origin=? WHERE id=?', originalSource.origin, originalSource.id); }
    } });
    c.startGoal({ goalId: goal.goalId, expectedRevision: goal.revision, model: seen.model });
    const done = await c.waitGoal(goal.goalId), facts = seen.records.at(-1).status.currentTasks;
    assert.equal(done.state, 'WAITING_INPUT', done.reason);
    const fact = facts.tasks.find(item => item.assignmentId === assignment.id);
    assert.equal(fact.currentWorkEpoch, oldEpoch + 1); assert.equal(fact.recordedPhase, 'BASE_CAPTURED');
    assert.equal(fact.admittedRunRecordsAtCurrentEpoch, 0);
    assert.deepEqual(fact.publishedObservation, { resultId: publication.id, observationEpoch: oldEpoch,
        meaning: 'Historical publication; distinct from current work metadata and eligibility' });
    assert.match(seen.records.at(-1).prompt, /Historical diagnostics do not themselves authorize a retry/);
    assert.deepEqual(c.store.one('SELECT * FROM conversation_results WHERE id=?', publication.id), publication, 'Original publication bytes are unchanged');
    f.pass();
});

test('public finite extension and definition revision obtain fresh attribution only on separate Start', { timeout: 20000 }, async t => {
    const f = await structuredAssignmentWorld(t), c = f.c;
    const g = c.createGoal({ conversationId: f.parent, objective: 'Original objective', criteria: ['Keep original accounting'], turnLimit: 3 });
    const seen = observer(c, g.goalId);
    const start = async goal => { c.startGoal({ goalId: goal.goalId, expectedRevision: goal.revision, model: seen.model }); return c.waitGoal(goal.goalId); };
    const first = await start(g), original = seen.records.at(-1).status.ownerContinuation;
    const extended = c.extendGoal({ goalId: g.goalId, expectedRevision: first.revision, units: 2, reason: 'Owner reviewed two additional finite turns' });
    assert.equal(extended.startedAttempts, 1); assert.equal(extended.turnLimit, 5);
    assert.equal(c.store.one('SELECT count(*) n FROM goal_events WHERE goal=? AND kind=?', g.goalId, 'owner-resume').n, 1);
    const second = await start(extended), extensionProof = seen.records.at(-1).status.ownerContinuation;
    assert.equal(second.state, 'WAITING_INPUT', second.reason); assert.equal(extensionProof.turnLimit, 5);
    assert.notEqual(extensionProof.eventId, original.eventId); assert.equal(extensionProof.definitionHash, original.definitionHash);
    const revised = c.reviseGoal({ goalId: g.goalId, expectedRevision: second.revision, objective: 'Separately revised objective', criteria: ['Retain spent turns and review new intent'], reason: 'Owner revised the objective explicitly' });
    assert.equal(revised.startedAttempts, 2);
    const third = await start(revised), revisedProof = seen.records.at(-1).status.ownerContinuation;
    assert.equal(third.state, 'WAITING_INPUT', third.reason); assert.equal(third.startedAttempts, 3);
    assert.equal(revisedProof.turnLimit, 5); assert.notEqual(revisedProof.definitionHash, original.definitionHash);
    f.pass();
});

test('original-format owner event remains explicitly unattributed rather than becoming a new grant', { timeout: 20000 }, async t => {
    const f = await structuredAssignmentWorld(t), c = f.c;
    const g = c.createGoal({ conversationId: f.parent, objective: 'Retained legacy definition', criteria: ['Do not invent a historical owner proof'], turnLimit: 3 });
    const originalRun = c.goalCore.h.run;
    // Controlled old-writer journal premise before native admission. No qualification app is changed.
    c.goalCore.h.run = input => {
        const row = c.store.one('SELECT data FROM goals WHERE id=?', g.goalId), data = JSON.parse(row.data);
        const event = c.store.one('SELECT * FROM goal_events WHERE id=?', data.ownerContinuation.eventId), payload = JSON.parse(event.data);
        delete data.ownerContinuation;
        for (const key of ['version', 'acceptedGoalRevision', 'definitionHash', 'conversationId', 'turnLimit']) delete payload[key];
        c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify(data), g.goalId);
        c.store.run('UPDATE goal_events SET data=? WHERE id=?', JSON.stringify(payload), event.id);
        return originalRun(input);
    };
    try {
        const seen = observer(c, g.goalId);
        c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: seen.model });
        const done = await c.waitGoal(g.goalId);
        assert.equal(done.state, 'WAITING_INPUT', done.reason);
        assert.equal(seen.records[0].status.ownerContinuation.state, 'unavailable');
        assert.equal(Object.hasOwn(seen.records[0].status.ownerContinuation, 'eventId'), false);
        assert.equal(Object.hasOwn(done.attempts[0].data, 'ownerContinuation'), false);
        f.pass();
    } finally { c.goalCore.h.run = originalRun; }
});

for (const fault of ['missing-attempt-proof', 'changed-event', 'foreign-pointer', 'deleted-new-proof', 'deleted-proof-version2', 'deleted-proof-version-null', 'deleted-proof-version-missing']) {
    test('original public status refuses ' + fault + ' without admitting a replacement operation', { timeout: 20000 }, async t => {
        const f = await structuredAssignmentWorld(t), c = f.c;
        const g = c.createGoal({ conversationId: f.parent, objective: 'Keep exact owner event provenance', criteria: ['No inferred replacement authority'], turnLimit: 3 });
        let originalGoal, originalAttempt, originalEvent, before;
        const seen = observer(c, g.goalId, { beforeStatus(attempt) {
            originalGoal = c.store.one('SELECT * FROM goals WHERE id=?', g.goalId);
            originalAttempt = c.store.one('SELECT * FROM goal_attempts WHERE id=?', attempt.attemptId);
            const ad = JSON.parse(originalAttempt.data), gd = JSON.parse(originalGoal.data);
            originalEvent = c.store.one('SELECT * FROM goal_events WHERE id=?', ad.ownerContinuation.eventId);
            if (fault === 'missing-attempt-proof' || fault.startsWith('deleted-')) {
                delete ad.ownerContinuation; c.store.run('UPDATE goal_attempts SET data=? WHERE id=?', JSON.stringify(ad), attempt.attemptId);
            }
            if (fault === 'changed-event') c.store.run('UPDATE goal_events SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(originalEvent.data), turnLimit: 999 }), originalEvent.id);
            if (fault === 'foreign-pointer') { gd.ownerContinuation.eventId = randomUUID(); c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify(gd), g.goalId); }
            if (fault.startsWith('deleted-')) { delete gd.ownerContinuation; c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify(gd), g.goalId); }
            if (fault.startsWith('deleted-proof-version')) {
                const payload = JSON.parse(originalEvent.data);
                if (fault.endsWith('missing')) delete payload.version;
                else payload.version = fault.endsWith('null') ? null : 2;
                c.store.run('UPDATE goal_events SET data=? WHERE id=?', JSON.stringify(payload), originalEvent.id);
            }
            before = counts(c);
        } });
        try {
            c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model: seen.model });
            const done = await c.waitGoal(g.goalId);
            assert.notEqual(done.state, 'COMPLETED'); assert.equal(done.startedAttempts, 1);
            const after = counts(c);
            assert.deepEqual({ ...after, budgets: undefined }, { ...before, budgets: undefined });
            assert.equal(after.budgets.reduce((n, budget) => n + budget.reserved, 0), 0);
            assert.equal(after.budgets.reduce((n, budget) => n + budget.consumed, 0), before.budgets.reduce((n, budget) => n + budget.consumed, 0) + 1,
                'Only the already admitted original turn is charged');
            const handle = c.getNativeHandle(f.parent); assert.equal(handle, null);
            assert.match(JSON.stringify(c.store.all('SELECT data FROM observations WHERE run=?', originalAttempt.run)), /owner continuation|Owner continuation/);
        } finally {
            if (originalEvent) c.store.run('UPDATE goal_events SET data=? WHERE id=?', originalEvent.data, originalEvent.id);
            if (originalAttempt) c.store.run('UPDATE goal_attempts SET data=? WHERE id=?', originalAttempt.data, originalAttempt.id);
            // Retain actual final state/accounting; restore only controlled provenance corruption.
            if (originalGoal) {
                const current = c.store.one('SELECT data FROM goals WHERE id=?', originalGoal.id);
                c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(current.data), ownerContinuation: JSON.parse(originalGoal.data).ownerContinuation }), originalGoal.id);
            }
        }
        f.pass();
    });
}

test('native status bounds escaped definitions and all pending findings without a stale author-context pointer', { timeout: 20000 }, async t => {
    const f = await structuredAssignmentWorld(t), c = f.c;
    const criteria = Array.from({ length: 16 }, (_, i) => 'Criterion ' + i + ' "한\\'.repeat(240));
    const g = c.createGoal({ conversationId: f.parent, objective: 'Inspect exact large retained definition', criteria, turnLimit: 6 });
    const turns = new Map(), records = []; let restoredFindings;
    const model = scripted(context => {
        const goal = c.inspectGoal(g.goalId), attempt = goal.attempts.at(-1), turn = turns.get(attempt.attemptId) ?? 0;
        turns.set(attempt.attemptId, turn + 1);
        if (getCurrentTools(context.messages).some(tool => tool.name === 'goal_review')) {
            assert.ok(!systemText(context).includes('Owner continuation attribution'));
            if (turn === 0) return { tool: { name: 'goal_status', arguments: {} } };
            if (turn === 1) {
                const failed = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'goal_status').at(-1);
                assert.equal(failed.isError, true); assert.match(content(failed), /8KiB/);
                return { tool: { name: 'goal_review', arguments: { verdict: 'reject', reason: 'Controlled independent unresolved findings', resolvedFindingIds: [],
                    findings: Array.from({ length: 20 }, (_, i) => ({ criterion: i % 16, description: 'Retained finding ' + i + ' "한\\'.repeat(240) })) } } };
            }
            return { text: 'Independent rejection remains provisional until original settlement.' };
        }
        if (turn === 0) {
            records.push({ prompt: systemText(context) });
            if (attempt.ordinal === 3) {
                restoredFindings = goal.findings;
                const row = c.store.one('SELECT data FROM goals WHERE id=?', g.goalId), data = JSON.parse(row.data);
                data.findings[0].description += ' CONTROLLED_LATE_FINDING_CHANGE';
                c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify(data), g.goalId);
            }
            return { tool: { name: 'goal_status', arguments: {} } };
        }
        if (turn === 1) {
            const result = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'goal_status').at(-1), text = content(result);
            assert.equal(result.isError, false, text); assert.ok(Buffer.byteLength(text) <= 8192);
            const status = JSON.parse(text); records.at(-1).status = status;
            assert.equal(status.complete, false); assert.equal(status.omitted.criteria.count, 16);
            assert.equal(status.omitted.criteria.capturedContext.kind, 'goal-author-system-context/v1');
            if (attempt.ordinal === 3) {
                assert.equal(status.omitted.findings.count, 20); assert.equal(status.omitted.findings.state, 'unavailable');
                assert.equal(Object.hasOwn(status.omitted.findings, 'capturedContext'), false);
                assert.ok(records.at(-1).prompt.includes(JSON.stringify(restoredFindings.at(-1).description)));
                const row = c.store.one('SELECT data FROM goals WHERE id=?', g.goalId);
                c.store.run('UPDATE goals SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(row.data), findings: restoredFindings }), g.goalId);
            } else if (attempt.ordinal === 4) {
                assert.equal(status.omitted.findings.count, 20);
                assert.equal(status.omitted.findings.capturedContext.kind, 'goal-author-system-context/v1');
            }
            return report(attempt.ordinal === 1 ? 'propose-completion' : 'need-owner');
        }
        return { text: 'Bounded status omissions do not satisfy completion criteria.' };
    });
    model.provider = 'goal-context-overflow-' + randomUUID(); model.definition.api = 'goal-context-overflow-api-' + randomUUID();
    c.startGoal({ goalId: g.goalId, expectedRevision: g.revision, model });
    const done = await c.waitGoal(g.goalId);
    assert.equal(done.state, 'WAITING_INPUT', done.reason); assert.equal(done.startedAttempts, 3);
    assert.equal(done.findings.filter(finding => finding.state === 'pending').length, 20);
    await c.goalCore.drain(g.goalId);
    c.startGoal({ goalId: g.goalId, expectedRevision: done.revision, model });
    const resumed = await c.waitGoal(g.goalId);
    assert.equal(resumed.state, 'WAITING_INPUT', resumed.reason); assert.equal(resumed.startedAttempts, 4);
    assert.equal(records.length, 3); assert.equal(c.store.one('SELECT count(*) n FROM effect_operations').n, 0);
    f.pass();
});

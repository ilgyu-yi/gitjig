import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {scripted} from './effect-fixture.mjs';

/** Actual Pi assignment, WAIT, publication and continuation; governed outcome is controlled.
 * No engine, service endpoint or semantic procedure qualification is claimed. */
export async function failedWaitWorld(t, {goal = false, automatic = true, mixed = false, goalTurnLimit = 6, resultDiagnostic = '', retainRoot = false} = {}) {
    const cleanup = [], f = await structuredAssignmentWorld({after: action => cleanup.push(action), diagnostic: message => t.diagnostic(message)}, {retainRoot});
    let release; const gate = new Promise(resolve => { release = resolve; });
    const children = [], continuations = [], publications = [];
    let reported = false;
    f.onGoverned(async (child, result) => {
        children.push(child); await gate;
        const state = f.c.store.one('SELECT data FROM change_state WHERE work=?', child.workId);
        const healthy = mixed && children[0].workId === child.workId;
        if (!healthy) {
            f.c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?', 'BLOCKED', JSON.stringify({...JSON.parse(state.data), blocked: ['Controlled original source-fit diagnostic'], nextAction: 'Inspect retained owner requirements'}), child.workId);
            Object.assign(result, f.c.inspectChange(child.workId), {reviewReady: false});
            if (resultDiagnostic) result.diagnostic = resultDiagnostic;
        }
    });
    const model = scripted((context, turn) => {
        const latest = context.messages.filter(message => message.role === 'user').at(-1);
        const text = typeof latest?.content === 'string' ? latest.content : latest?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
        if (text.startsWith('Explicitly resumed authorized dependency outcomes (outcome is not success):')) {
            if (!continuations.includes(text)) continuations.push(text);
            if (goal && !reported) {
                reported = true;
                return {tool: {name: 'goal_progress', arguments: {disposition: 'need-owner', plan: 'Inspect original failed child without retrying it', nextAction: 'Owner review of the actual child diagnostic', reason: 'Actual UNAVAILABLE result is not success', resultIds: []}}};
            }
            return {text: 'The original child is unavailable; its diagnostic was inspected without retry or success claims.'};
        }
        const assignments = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'conversation_assign').map(message => JSON.parse(message.content.filter(part => part.type === 'text').map(part => part.text).join('')));
        if (!turn || mixed && assignments.length < 2)
            return {tool: {name: 'conversation_assign', arguments: {projectId: 'P', instructions: 'Owned original failed-WAIT task ' + assignments.length, operation: 'change', resultDependency: true}}};
        return {tool: {name: 'conversation_wait', arguments: {resultHandles: assignments.map(assignment => assignment.assignmentId)}}};
    });
    model.provider = 'failed-wait-' + randomUUID(); model.definition.api = 'failed-wait-api-' + randomUUID();
    let definition;
    if (goal) {
        definition = f.c.createGoal({conversationId: f.parent, objective: 'Inspect the original unavailable task outcome', criteria: ['The diagnostic is not treated as completed work'], turnLimit: goalTurnLimit});
        f.c.startGoal({goalId: definition.goalId, expectedRevision: definition.revision, model});
    } else {
        await f.c.queueConversationInput({conversationId: f.parent, expectedGeneration: f.c.inspectConversation(f.parent).generation, text: 'Assign and wait for the original governed task', mode: 'idle'});
        assert.equal((await f.c.runConversation({conversationId: f.parent, model})).status, 'waiting');
    }
    for (let count = 0; count < 500; count++) {
        if (f.c.inspectConversation(f.parent).state === 'WAITING' && children.length === (mixed ? 2 : 1) && (!goal || f.c.inspectGoal(definition.goalId).state === 'WAITING_DEPENDENCY')) break;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(f.c.inspectConversation(f.parent).state, 'WAITING');
    assert.equal(children.length, mixed ? 2 : 1);
    if (!automatic) f.c.ordinary.quiesce();
    const observe = f.c.goals.observeDependencies.bind(f.c.goals);
    f.c.goals.observeDependencies = () => {
        const rows = f.c.store.all("SELECT id,data FROM conversation_assignments WHERE source_conversation=? AND state='UNAVAILABLE'", f.parent);
        for (const row of rows) {
            const id = JSON.parse(row.data).resultId;
            if (id) { assert.ok(f.c.store.one('SELECT id FROM conversation_results WHERE id=?', id), 'publication commits before goal observation'); publications.push(id); }
        }
        return observe();
    };
    t.after(async () => { try { release(); await f.c.ordinary.drain(); } finally { for (const action of cleanup) await action(); } });
    return {...f, model, goal: definition, children, continuations, publications, release, async settle() {release(); await f.c.ordinary.drain();}};
}

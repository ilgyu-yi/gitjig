import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {scripted} from './effect-fixture.mjs';

/** Actual Pi assignment, WAIT, publication and continuation; governed outcome is controlled.
 * No engine, service endpoint or semantic procedure qualification is claimed. */
export async function failedWaitWorld(t, {goal = false, automatic = true, mixed = false, goalTurnLimit = 6, resultDiagnostic = '', retainRoot = false, resultDependency = true, originalGovernedDispatch = false, runtimeProfile, beforeAssignment, prepareResult, onContinuation, onOwnerPrompt, waitArguments, fixtureRoot, waitForResult = true, nested = false, nestedCompletion = false} = {}) {
    const cleanup = [], f = await structuredAssignmentWorld({after: action => cleanup.push(action), diagnostic: message => t.diagnostic(message)}, {retainRoot, originalGovernedDispatch, runtimeProfile, fixtureRoot});
    await beforeAssignment?.(f);
    let release; const gate = new Promise(resolve => { release = resolve; });
    const children = [], continuations = [], publications = [];
    let reported = false;
    const governedBody = async (child, result) => {
        children.push(child); await gate;
        const state = f.c.store.one('SELECT data FROM change_state WHERE work=?', child.workId);
        const healthy = mixed && children[0].workId === child.workId;
        if (!healthy) {
            f.c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?', 'BLOCKED', JSON.stringify({...JSON.parse(state.data), blocked: ['Controlled original source-fit diagnostic'], nextAction: 'Inspect retained owner requirements'}), child.workId);
            await prepareResult?.(f.c, child);
            Object.assign(result, f.c.inspectChange(child.workId), {reviewReady: false});
            if (resultDiagnostic) result.diagnostic = resultDiagnostic;
        }
    };
    if (originalGovernedDispatch) f.c.changeCore.drive = async ({workId}) => {
        const assignment=f.c.store.one('SELECT id,target FROM conversation_assignments WHERE work=?',workId);
        const child={assignmentId:assignment.id,conversationId:assignment.target,workId},result={workId};
        await governedBody(child,result);return result;
    };
    else f.onGoverned(governedBody);
    const leafInstructions = 'OWNED_NESTED_WAIT_LEAF Complete the original investigation.';
    const model = scripted((context, turn) => {
        const latest = context.messages.filter(message => message.role === 'user').at(-1);
        const text = typeof latest?.content === 'string' ? latest.content : latest?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
        const ownerReply = onOwnerPrompt?.(context,text,children);
        if (ownerReply) return ownerReply;
        if (nestedCompletion && text.includes(leafInstructions))
            return {text:'The original delegated investigation finished.'};
        if (text.startsWith('Explicitly resumed authorized dependency outcomes (outcome is not success):')) {
            if (!continuations.includes(text)) continuations.push(text);
            if (onContinuation) return onContinuation(context, turn, text, children);
            if (goal && !reported) {
                reported = true;
                return {tool: {name: 'goal_progress', arguments: {disposition: 'need-owner', plan: 'Inspect original failed child without retrying it', nextAction: 'Owner review of the actual child diagnostic', reason: 'Actual UNAVAILABLE result is not success', resultIds: []}}};
            }
            return {text: 'The original child is unavailable; its diagnostic was inspected without retry or success claims.'};
        }
        const assignments = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'conversation_assign').map(message => JSON.parse(message.content.filter(part => part.type === 'text').map(part => part.text).join('')));
        if (!turn || mixed && assignments.length < 2) {
            const firstHop = nested && !text.includes('OWNED_NESTED_WAIT_COORDINATOR');
            return {tool: {name: 'conversation_assign', arguments: {projectId: 'P',
                instructions: firstHop ? 'OWNED_NESTED_WAIT_COORDINATOR Delegate and wait.' : nestedCompletion ? leafInstructions : 'Owned original failed-WAIT task ' + assignments.length,
                operation: firstHop || nestedCompletion ? 'investigate' : 'change', ...(resultDependency ? {resultDependency: true} : {})}}};
        }
        if (!waitForResult) return {text:'The original task was delegated.'};
        return {tool: {name: 'conversation_wait', arguments: waitArguments
            ? waitArguments({context, assignments, controller: f.c, parent: f.parent})
            : {resultHandles: assignments.map(assignment => assignment.assignmentId)}}};
    });
    if (nestedCompletion) {
        const stream = model.definition.streamSimple.bind(model.definition);
        model.definition.streamSimple = async (selected, context, options) => {
            const user = context.messages.find(message => message.role === 'user');
            const text = typeof user?.content === 'string' ? user.content : user?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
            if (!children.length && text.includes(leafInstructions)) {
                const leaf=f.c.store.one(`SELECT a.id,a.target,a.work FROM conversation_assignments a JOIN sources s
                    ON s.id=json_extract(a.data,'$.instructionsSource') WHERE s.raw=?`,leafInstructions);
                assert.ok(leaf?.work);
                children.push({assignmentId:leaf.id,conversationId:leaf.target,workId:leaf.work});
                await gate;
            }
            return stream(selected, context, options);
        };
    }
    model.provider = 'failed-wait-' + randomUUID(); model.definition.api = 'failed-wait-api-' + randomUUID();
    let definition;
    if (goal) {
        definition = f.c.createGoal({conversationId: f.parent, objective: 'Inspect the original unavailable task outcome', criteria: ['The diagnostic is not treated as completed work'], turnLimit: goalTurnLimit});
        f.c.startGoal({goalId: definition.goalId, expectedRevision: definition.revision, model});
    } else {
        await f.c.queueConversationInput({conversationId: f.parent, expectedGeneration: f.c.inspectConversation(f.parent).generation, text: 'Assign and wait for the original governed task', mode: 'idle'});
        const result = await f.c.runConversation({conversationId:f.parent, model});
        assert.equal(result.status,waitForResult?'waiting':'delivered',result.failure);
    }
    const state = waitForResult ? 'WAITING' : 'IDLE';
    const middleWaiting = () => !nested || f.c.store.one("SELECT state FROM conversation_assignments WHERE source_conversation=?",f.parent)?.state==='WAITING';
    for (let count = 0; count < 500; count++) {
        if (f.c.inspectConversation(f.parent).state === state && middleWaiting() && children.length === (mixed ? 2 : 1) && (!goal || f.c.inspectGoal(definition.goalId).state === 'WAITING_DEPENDENCY')) break;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(f.c.inspectConversation(f.parent).state, state);
    assert.ok(middleWaiting());
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

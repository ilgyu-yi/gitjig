import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Type, validateToolArguments } from '@earendil-works/pi-ai';
import { createCoordinationTools } from '../../dist/pi/coordination.js';
import { createGoalTools } from '../../dist/pi/goal-tools.js';
import { structuredAssignmentWorld } from '../controller/structured-assignment-fixture.mjs';
import { scripted } from '../controller/effect-fixture.mjs';

const validate = (tool, args) => validateToolArguments(tool, { type: 'toolCall', id: 'integer-guard', name: tool.name, arguments: args });
const latest = (context, name) => context.messages.filter(message => message.role === 'toolResult' && message.toolName === name).at(-1);
async function run(f, action) {
    const c = f.c, model = scripted(action); model.provider = 'integer-guard-' + randomUUID(); model.definition.api = 'integer-guard-api-' + randomUUID();
    await c.queueConversationInput({ conversationId: f.parent, expectedGeneration: c.inspectConversation(f.parent).generation, text: 'Inspect this original integer-guard fixture only', mode: 'idle' });
    return c.runConversation({ conversationId: f.parent, model });
}

test('public integer wire contracts reject fractional operands without changing existing SDK canonicalization', async () => {
    let calls = 0;
    const callback = () => { calls++; return {}; };
    const tools = createCoordinationTools({ status: callback, address: callback, assign: callback, acknowledgeInput: callback, recoverAssignment: callback, parent: callback, publish: callback }, () => assert.fail('Unexpected wait'));
    const tool = name => tools.find(tool => tool.name === name), properties = name => tool(name).parameters.properties;
    const json = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(json(properties('conversation_address').expectedGeneration), json(Type.Integer({ minimum: 0 })));
    assert.deepEqual(json(properties('conversation_address').observedDirectionRevision), json(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })));
    assert.deepEqual(json(properties('conversation_recover_assignment').expectedWorkEpoch), json(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })));
    assert.deepEqual(json(properties('conversation_parent').expectedRelationRevision), json(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })));
    assert.deepEqual(json(properties('conversation_publish').action.anyOf[2].properties.parent.properties.number), json(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })));
    const address = { conversationId: 'target', expectedGeneration: 0, observedDirectionRevision: 0, text: 'Owned input', mode: 'follow-up' };
    for (const field of ['expectedGeneration', 'observedDirectionRevision']) for (const value of [0.5, -0.5, '0.5']) assert.throws(() => validate(tool('conversation_address'), { ...address, [field]: value }));
    for (const field of ['expectedWorkEpoch', 'observedDirectionRevision']) assert.throws(() => validate(tool('conversation_recover_assignment'), { assignmentId: 'original', expectedWorkEpoch: 2, observedDirectionRevision: 0, reason: 'Owned recovery', [field]: field === 'expectedWorkEpoch' ? 2.9 : 0.9 }));
    assert.throws(() => validate(tool('conversation_parent'), { childId: 'child', parentId: null, expectedRelationRevision: 0.9 }));
    assert.throws(() => validate(tool('conversation_publish'), { targetId: 'target', action: { kind: 'create-comment', parent: { kind: 'issue', number: 1.9, nodeId: 'node' }, purpose: 'reviewed-summary', body: 'Owned comment' } }));
    // The existing plain-object anyOf assignment policy is independently intact.
    assert.throws(() => validate(tool('conversation_assign'), { projectId: 'P', instructions: 'Owned task', conversationId: 'target', observedDirectionRevision: 0.9 }));
    assert.equal(calls, 0);
    for (const representation of [0, '0', false, null]) {
        const normalized = validate(tool('conversation_address'), { ...address, expectedGeneration: representation });
        assert.equal(normalized.expectedGeneration, 0);
    }
    await tool('conversation_address').execute('valid', validate(tool('conversation_address'), address), new AbortController().signal);
    assert.equal(calls, 1);
    const review = createGoalTools({ status: callback, review: callback }).find(tool => tool.name === 'goal_review');
    assert.deepEqual(json(review.parameters.properties.findings.items.properties.criterion), json(Type.Integer({ minimum: 0, maximum: 15 })));
    const verdict = { verdict: 'reject', reason: 'Owned finding', findings: [{ criterion: 0, description: 'Owned criterion' }], resolvedFindingIds: [] };
    assert.throws(() => validate(review, { ...verdict, findings: [{ criterion: 0.9, description: 'Malformed index' }] }));
    await review.execute('valid-review', validate(review, verdict), new AbortController().signal); assert.equal(calls, 2);
});

test('actual ordinary Pi refuses fractional target freshness without queuing input, then admits exact observed integers', async t => {
    const f = await structuredAssignmentWorld(t), c = f.c, target = c.createConversation({ projectId: 'P' }).conversationId;
    const before = c.inspectConversation(target); let accepted;
    const result = await run(f, (context, turn) => {
        const args = { conversationId: target, expectedGeneration: 0, observedDirectionRevision: 0, text: 'Exact valid attributed input only', mode: 'follow-up' };
        if (turn) {
            const response = latest(context, 'conversation_address');
            if (turn < 3) {
                assert.equal(response.isError, true); assert.deepEqual(c.inspectConversation(target), before);
                assert.equal(c.store.one('SELECT COUNT(*) n FROM conversation_inputs WHERE conversation=?', target).n, 0);
            } else { assert.equal(response.isError, false); accepted = response; return { text: 'Only the exact observed integer request was admitted.' }; }
        }
        return { tool: { name: 'conversation_address', arguments: { ...args, ...(turn === 0 ? { expectedGeneration: -0.5 } : turn === 1 ? { observedDirectionRevision: 0.5 } : {}) } } };
    });
    assert.equal(result.status, 'delivered'); assert.ok(accepted);
    const after = c.inspectConversation(target), inputs = c.store.all('SELECT state,text FROM conversation_inputs WHERE conversation=?', target);
    assert.equal(after.generation, before.generation); assert.equal(after.directionRevision, before.directionRevision + 1);
    assert.deepEqual(inputs.map(row => ({ ...row })), [{ state: 'QUEUED', text: 'Exact valid attributed input only' }]); f.pass();
});

test('actual original recovery refuses fractional epochs and direction before restoring that same task with exact integers', async t => {
    const f = await structuredAssignmentWorld(t, { originalGovernedDispatch: true }), c = f.c, changes = c.changes;
    changes.drive = async input => changes.inspect(input.workId); await f.assign();
    const assignment = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', f.parent);
    assert.equal(assignment.state, 'UNAVAILABLE'); await c.cancelWork({ workId: assignment.work, expectedEpoch: 1 });
    const before = c.store.one('SELECT * FROM works WHERE id=?', assignment.work), runs = c.store.all('SELECT id FROM runs WHERE work=?', assignment.work), budgets = c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', assignment.work);
    let recovered;
    const result = await run(f, (context, turn) => {
        const args = { assignmentId: assignment.id, expectedWorkEpoch: 2, observedDirectionRevision: 0, reason: 'Restore only the same original admission' };
        if (turn) {
            const response = latest(context, 'conversation_recover_assignment');
            if (turn < 3) {
                assert.equal(response.isError, true); assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?', assignment.work), before);
                assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', assignment.id).state, 'CANCELLED');
            } else { assert.equal(response.isError, false); recovered = JSON.parse(response.content[0].text); return { text: 'Exact original task admission restored; no execution requested.' }; }
        }
        return { tool: { name: 'conversation_recover_assignment', arguments: { ...args, ...(turn === 0 ? { expectedWorkEpoch: 2.9 } : turn === 1 ? { observedDirectionRevision: 0.9 } : {}) } } };
    });
    assert.equal(result.status, 'delivered'); assert.equal(recovered.workId, assignment.work); assert.equal(recovered.state, 'RECOVERY_READY'); assert.equal(recovered.epoch, 3);
    assert.deepEqual(c.store.all('SELECT id FROM runs WHERE work=?', assignment.work), runs);
    assert.deepEqual(c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', assignment.work), budgets); f.pass();
});

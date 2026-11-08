/** Original SDK/tool/controller admission; governed procedure is controlled, no engine or service. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {structuredAssignmentWorld} from './structured-assignment-fixture.mjs';
import {scripted} from './effect-fixture.mjs';

test('rejected operation consumes no assignment resources and preserves the sole child grant', {timeout:20000}, async t => {
    const f = await structuredAssignmentWorld(t, {maxAssignments:1}), s = f.c.store;
    const census = () => Object.fromEntries(['conversations','sources','conversation_inputs','conversation_assignments','conversation_dependencies'].map(table => [table,s.one(`SELECT COUNT(*) n FROM ${table}`).n]));
    let before, rejected = 0;
    const model = scripted((context, turn) => {
        if (turn === 0) before = census();
        if (turn === 1 || turn === 2) {
            assert.deepEqual(census(), before, 'Refused native call allocates no child, source, input, assignment or wait');
            const result = context.messages.filter(message => message.role === 'toolResult').at(-1);
            assert.equal(result.toolName, 'conversation_assign');
            assert.equal(result.isError, true);
            rejected++;
        }
        if (turn < 3) return {tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Owned bounded governed task',...(turn === 0 ? {} : {operation:turn === 1 ? 'bypass' : 'change'})}}};
        return {text:'The one explicitly selected governed task was admitted.'};
    });
    model.provider = 'assignment-operation-' + randomUUID();
    model.definition.api = 'assignment-operation-api-' + randomUUID();
    await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:0,text:'Delegate exactly one governed code change',mode:'idle'});
    const result = await f.c.runConversation({conversationId:f.parent,model});
    await f.c.ordinary.drain();
    assert.equal(result.status,'delivered');
    assert.equal(rejected,2);
    const assignments = s.all('SELECT * FROM conversation_assignments');
    assert.equal(assignments.length,1);
    assert.equal(JSON.parse(assignments[0].data).operation,'change');
    assert.ok(assignments[0].work);
    assert.equal(s.one('SELECT COUNT(*) n FROM conversations').n,before.conversations+1);
    f.pass();
});

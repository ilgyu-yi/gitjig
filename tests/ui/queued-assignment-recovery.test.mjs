import test from 'node:test';
import assert from 'node:assert/strict';
import {queuedAssignmentWorld} from '../controller/queued-assignment-fixture.mjs';
import {errorCommands} from '../../dist/ui/error-commands.js';
import {inspectQueuedTaskRecovery, recoverQueuedTask} from '../../dist/ui/queued-assignment-recovery.js';

// Original Pi assignment creation; only its subsequent governed launch is held by an owned gate.
async function world(t) {
    const f = await queuedAssignmentWorld(t);
    for (let count = 0; count < 200; count++) {
        if (['IDLE', 'WAITING'].includes(f.c.inspectConversation(f.parent).state)) return f;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Original fixture coordinator did not settle');
}
async function finish(f) {
    if (f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state !== 'CANCELLED')
        await f.c.cancelAssignment({assignmentId: f.assignment.id, reason: 'Owned UI fixture cleanup'});
    await f.finish(); f.pass();
}

for (const locale of ['en', 'ko']) for (const caller of ['parent', 'child']) test('original queued task has reviewed ' + locale + ' cancellation from its ' + caller + ' error menu', async t => {
    const f = await world(t), target = caller === 'parent' ? f.parent : f.input.conversationId;
    f.c.setConversationLanguage({conversationId: target, expectedGeneration: f.c.inspectConversation(target).generation, replyLanguage: locale, expectedRevision: f.c.getConversationLanguage(target).revision});
    const works = f.c.store.all('SELECT * FROM works'), runs = f.c.store.all('SELECT * FROM runs'), budgets = f.c.store.all('SELECT * FROM budgets ORDER BY rowid');
    const shown = [], notices = []; let choices = 0;
    const command = errorCommands({controller: f.c, isCurrent: () => true, assertAvailable() {}, failure: () => null,
        choose: async (_title, rows) => {
            choices++;
            if (choices === 1) {
                const selected = rows.find(row => row.includes(f.assignment.id)); assert.ok(selected); return selected;
            }
            assert.match(rows[0], locale === 'ko' ? /취소하지 않고/u : /Back without cancellation/u);
            return rows[1];
        }, showDetails: async text => shown.push(text), notice: text => notices.push(text),
        execute: async () => assert.fail('Queued cancellation dispatched another command'),
    })[0];
    assert.equal(await command.run('', target), 'completed');
    assert.ok(shown.some(text => text.includes('Owned delegated task') && text.includes(f.assignment.id) && text.includes(f.parent) && text.includes(f.input.conversationId)));
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'CANCELLED');
    assert.equal(f.c.store.one('SELECT state FROM conversation_inputs WHERE id=?', JSON.parse(f.assignment.data).inputId).state, 'CANCELLED');
    assert.deepEqual(f.c.store.all('SELECT * FROM works'), works);
    assert.deepEqual(f.c.store.all('SELECT * FROM runs'), runs);
    assert.deepEqual(f.c.store.all('SELECT * FROM budgets ORDER BY rowid'), budgets);
    assert.equal(notices.length, 1);
    await finish(f);
});

test('default Back after full review preserves the exact assignment and queue', async t => {
    const f = await world(t), review = inspectQueuedTaskRecovery(f.c, f.input.conversationId, f.input.expectedGeneration)[0];
    const before = f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.assignment.id);
    const result = await recoverQueuedTask({controller: f.c, locale: 'en', guard() {}, show: async () => {}, notice: () => assert.fail('Back reported cancellation'),
        choose: async () => assert.fail('Use stable action values'), chooseItems: async (_title, items) => { assert.equal(items[0].value, 'back'); return 'back'; },
    }, review);
    assert.equal(result, 'cancelled');
    assert.deepEqual(f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.assignment.id), before);
    await finish(f);
});

test('instruction or dependency drift while exact review is open refuses before confirmation/cancel', async t => {
    const f = await world(t), entry = inspectQueuedTaskRecovery(f.c, f.input.conversationId, f.input.expectedGeneration)[0];
    await assert.rejects(recoverQueuedTask({controller: f.c, locale: 'en', guard() {},
        show: async () => f.c.store.run('UPDATE sources SET raw=? WHERE id=?', 'Changed delegated task', JSON.parse(f.assignment.data).instructionsSource),
        choose: async () => assert.fail('Stale task reached confirmation'), notice: () => assert.fail('Stale task reported cancellation'),
    }, entry), /changed|admitted/u);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'QUEUED');
    await finish(f);
});

test('language changes in queued cancellation confirmation cannot mutate the task', async t => {
    const f = await world(t), target = f.input.conversationId;
    await assert.rejects(errorCommands({controller: f.c, isCurrent: () => true, assertAvailable() {}, failure: () => null,
        choose: async (_title, rows) => {
            if (rows.some(row => row.includes(f.assignment.id))) return rows.find(row => row.includes(f.assignment.id));
            f.c.setConversationLanguage({conversationId: target, expectedGeneration: f.c.inspectConversation(target).generation, replyLanguage: 'ko', expectedRevision: f.c.getConversationLanguage(target).revision});
            return rows[1];
        }, showDetails: async () => {}, notice: () => assert.fail('Stale language reported cancellation'),
        execute: async () => assert.fail('Stale language dispatched another command'),
    })[0].run('', target), /Error source changed/u);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'QUEUED');
    await finish(f);
});

test('an ambiguous queued task exposes inspection of the hold without a cancellation action', async t => {
    const f = await world(t);
    f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', 'extra-ui-wait', f.parent, f.input.conversationId, f.assignment.id, 'PENDING', '{}');
    const entry = inspectQueuedTaskRecovery(f.c, f.input.conversationId, f.input.expectedGeneration)[0];
    assert.ok(entry.unavailable); assert.equal(entry.review, undefined);
    const shown = [];
    assert.equal(await recoverQueuedTask({controller: f.c, locale: 'en', guard() {}, show: async (_title, text) => shown.push(text),
        choose: async () => assert.fail('Held task offered cancellation'), notice: () => assert.fail('Held task reported cancellation'),
    }, entry), 'cancelled');
    assert.equal(shown.length, 1);
    assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?', f.assignment.id).state, 'QUEUED');
    await finish(f);
});

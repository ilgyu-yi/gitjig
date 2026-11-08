import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';

test('a goal task failure blocks only the revision it was scheduled for', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-stale-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const g = c.createGoal({ conversationId: c.createConversation().conversationId, objective: 'Stale task fixture', criteria: ['Fixture criterion'], turnLimit: 2 });
        const goals = c.goals, state = () => c.store.one('SELECT state,revision FROM goals WHERE id=?', g.goalId);
        // Controlled stand-ins for an owner pause then restart while an older task is still awaiting.
        c.store.run("UPDATE goals SET state='ACTIVE' WHERE id=?", g.goalId);
        const stale = Promise.withResolvers();
        goals.schedule(async () => { await stale.promise; throw Error('STALE_TASK_FAILURE'); }, g.goalId);
        c.store.run("UPDATE goals SET revision=revision+2,state='ACTIVE' WHERE id=?", g.goalId);
        stale.resolve(); await Promise.allSettled([...goals.tasks]);
        assert.equal(state().state, 'ACTIVE');
        goals.schedule(async () => { throw Error('CURRENT_TASK_FAILURE'); }, g.goalId);
        await Promise.allSettled([...goals.tasks]);
        assert.equal(state().state, 'BLOCKED');
    } finally { await c.close(); }
});

test('admitting a dependency continuation retires the waiting attempt so goal wait can observe the new one', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-continued-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const cid = c.createConversation().conversationId, g = c.createGoal({ conversationId: cid, objective: 'Continuation fixture', criteria: ['Fixture criterion'], turnLimit: 4 });
        const goals = c.goals, s = c.store, generation = c.inspectConversation(cid).generation;
        // Controlled ledger premise: a settled attempt waited on a dependency; its continuation input is then admitted.
        s.run('PRAGMA foreign_keys=OFF');
        const data = JSON.parse(s.one('SELECT data FROM goals WHERE id=?', g.goalId).data);
        s.run("UPDATE goals SET state='WAITING_DEPENDENCY',data=? WHERE id=?", JSON.stringify({ ...data, startedAttempts: 1 }), g.goalId);
        s.run('INSERT INTO goal_attempts VALUES(?,?,?,?,?,?,?,?,?,?)', 'A1', g.goalId, 1, 'author', cid, 'I1', 'R1', 'WAITING', g.revision, '{}');
        s.run('INSERT INTO sources VALUES(?,?,?,?)', 'S2', cid, JSON.stringify({ kind: 'agent-conversation-input', actor: { conversationId: cid, runId: 'R1' } }), 'continuation');
        s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'I2', cid, generation, null, 'S2', 'QUEUED', 'idle', 'continuation', '{}');
        goals.admit({ conversationId: cid, runId: 'R2', initialInputId: 'I2', directionRevision: data.expectedDirection }, { provider: 'fixture', modelId: 'fixture' });
        assert.deepEqual(s.all('SELECT id,state FROM goal_attempts ORDER BY ordinal').map(r => [r.id === 'A1' ? 'A1' : 'new', r.state]), [['A1', 'CONTINUED'], ['new', 'RUNNING']]);
        assert.equal(s.one('SELECT state FROM goals WHERE id=?', g.goalId).state, 'ACTIVE');
        // The continuation delivers and reports wait-external without itself waiting natively.
        s.run("UPDATE goal_attempts SET state='SETTLED' WHERE run='R2'");
        s.run("UPDATE goals SET state='WAITING_DEPENDENCY' WHERE id=?", g.goalId);
        const settled = await Promise.race([goals.wait(g.goalId), new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), 2000))]);
        assert.notEqual(settled, 'TIMEOUT'); assert.equal(settled.state, 'WAITING_DEPENDENCY');
    } finally { await c.close(); }
});

test('goal observers are notified only after the owning transaction commits', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-notify-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const g = c.createGoal({ conversationId: c.createConversation().conversationId, objective: 'Notify fixture', criteria: ['Fixture criterion'], turnLimit: 2 });
        const observed = [];
        c.goals.subscribe(() => observed.push(c.store.db.isTransaction));
        // Controlled premise: a goal waiting on a dependency is extended by its owner.
        c.store.run("UPDATE goals SET state='WAITING_DEPENDENCY' WHERE id=?", g.goalId);
        c.extendGoal({ goalId: g.goalId, expectedRevision: g.revision, units: 1, reason: 'Fixture extension' });
        assert.ok(observed.length > 0); assert.deepEqual([...new Set(observed)], [false]);
    } finally { await c.close(); }
});

test('goal progress refuses duplicate, empty or oversized result references before retaining the report', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-results-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const cid = c.createConversation().conversationId, g = c.createGoal({ conversationId: cid, objective: 'Result fixture', criteria: ['Fixture criterion'], turnLimit: 2 }), s = c.store, view = c.inspectConversation(cid);
        // Controlled ledger premise: an admitted author attempt reports progress through its owned controls.
        s.run('PRAGMA foreign_keys=OFF');
        const identity = { conversationId: cid, workId: view.workId ?? null, runId: 'R1', launchId: null, generation: view.generation, directionRevision: view.directionRevision, initialInputId: 'I1' };
        s.run("UPDATE goals SET state='ACTIVE' WHERE id=?", g.goalId);
        s.run('INSERT INTO goal_attempts VALUES(?,?,?,?,?,?,?,?,?,?)', 'A1', g.goalId, 1, 'author', cid, 'I1', 'R1', 'RUNNING', g.revision, JSON.stringify({ identity, report: null }));
        const progress = c.goals.context(identity).controls.progress, base = { disposition: 'continue', plan: 'p', nextAction: 'n', reason: 'r' };
        for (const resultIds of [['same', 'same'], [''], ['x'.repeat(151)], [7]])
            assert.throws(() => progress({ ...base, resultIds }), /Invalid goal progress/, JSON.stringify(resultIds));
        assert.equal(JSON.parse(s.one('SELECT data FROM goal_attempts WHERE id=?', 'A1').data).report, null);
    } finally { await c.close(); }
});

test('an interrupted dependency continuation is re-admitted against its retired waiting attempt', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-goal-readmit-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const cid = c.createConversation().conversationId, g = c.createGoal({ conversationId: cid, objective: 'Re-admission fixture', criteria: ['Fixture criterion'], turnLimit: 4 });
        const goals = c.goals, s = c.store, generation = c.inspectConversation(cid).generation;
        s.run('PRAGMA foreign_keys=OFF');
        const data = JSON.parse(s.one('SELECT data FROM goals WHERE id=?', g.goalId).data);
        s.run("UPDATE goals SET state='WAITING_DEPENDENCY',data=? WHERE id=?", JSON.stringify({ ...data, startedAttempts: 1 }), g.goalId);
        s.run('INSERT INTO goal_attempts VALUES(?,?,?,?,?,?,?,?,?,?)', 'A1', g.goalId, 1, 'author', cid, 'I1', 'R1', 'WAITING', g.revision, '{}');
        s.run('INSERT INTO sources VALUES(?,?,?,?)', 'S2', cid, JSON.stringify({ kind: 'agent-conversation-input', actor: { conversationId: cid, runId: 'R1' } }), 'continuation');
        s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'I2', cid, generation, null, 'S2', 'QUEUED', 'idle', 'continuation', '{}');
        const identity = runId => ({ conversationId: cid, runId, initialInputId: 'I2', directionRevision: data.expectedDirection });
        goals.admit(identity('R2'), { provider: 'fixture', modelId: 'fixture' });
        // Controlled premise: the continuation run stopped before its input was consumed; the goal waits again.
        s.run("UPDATE goal_attempts SET state='UNAVAILABLE' WHERE run='R2'");
        s.run("UPDATE goals SET state='WAITING_DEPENDENCY' WHERE id=?", g.goalId);
        goals.admit(identity('R3'), { provider: 'fixture', modelId: 'fixture' });
        assert.equal(s.one("SELECT state FROM goal_attempts WHERE run='R3'").state, 'RUNNING');
        // Once a later attempt waits, another stale input from the retired run cannot start a second continuation.
        s.run("UPDATE goal_attempts SET state='WAITING' WHERE run='R3'");
        s.run("UPDATE goals SET state='WAITING_DEPENDENCY' WHERE id=?", g.goalId);
        s.run('INSERT INTO sources VALUES(?,?,?,?)', 'S4', cid, JSON.stringify({ kind: 'agent-conversation-input', actor: { conversationId: cid, runId: 'R1' } }), 'stale continuation');
        s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', 'I4', cid, generation, null, 'S4', 'QUEUED', 'idle', 'stale continuation', '{}');
        assert.throws(() => goals.admit({ ...identity('R4'), initialInputId: 'I4' }, { provider: 'fixture', modelId: 'fixture' }), /Goal input\/direction differs/);
        assert.equal(s.one("SELECT state FROM goal_attempts WHERE run='R3'").state, 'WAITING');
    } finally { await c.close(); }
});

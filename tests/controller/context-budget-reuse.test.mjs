import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../../dist/controller/store.js';
import { admitContextWork } from '../../dist/controller/context-origin.js';

test('real context admission transaction never widens retained original supervisor or branch delegation', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-reuse-'))), store = new Store(path.join(root, 'fixture.sqlite'));
    let passed = false;
    t.after(async () => { store.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained failed reuse fixture: ' + root); });
    // Controlled ACTIVE rows, no run/review success or model dispatch is invented.
    for (const project of ['P', 'Q']) store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)', project, path.join(root, project), '{}');
    for (const cid of ['root', 'child']) {
        store.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', cid, null, 'IDLE');
        store.run('INSERT INTO conversation_state(conversation,data) VALUES(?,?)', cid, '{}');
    }
    store.run('INSERT INTO sources VALUES(?,?,?,?)', 'fixture-source', 'root', JSON.stringify({ kind: 'fixture-unexecuted-control' }), 'No actual successful work claimed');
    const old = { kind: 'ordinary-conversation', conversation: 'root', delegation: { projectIds: ['P'], maxAssignments: 2, rootWorkId: 'D' } };
    for (const [wid, data] of [['W', old], ['D', { kind: 'fixture-delegation-root' }]])
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', wid, null, 'fixture-source', null, wid, 'ACTIVE', 1, 1, null, JSON.stringify(data));
    for (const kind of ['execution', 'resolution']) store.run('INSERT INTO budgets VALUES(?,?,8,0,0)', 'W', kind);
    const family = { version: 1, rootConversationId: 'root', budgetAnchorWorkId: 'W', budgetLineage: 'W', delegationRootWorkId: 'D' };
    store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?', 'W', JSON.stringify({ contextFamilyRoot: 'root', contextFamily: family }), 'root');
    const baseline = { projectIds: ['P', 'Q'], maxAssignments: 8, rootWorkId: 'W' };
    // This is the SAME real resolver/Store.tx and persisted returned delegation.
    // Ordinary's unchanged call+write integration is separately source-bound;
    // this zero-call regression does not claim an executed reused model turn.
    const reuse = (cid, wid, profile) => store.tx(() => {
        const work = store.one('SELECT * FROM works WHERE id=?', wid);
        const result = admitContextWork(store, cid, wid, profile, work);
        store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(work.data), ...result.metadata, delegation: result.delegation }), wid);
        return result;
    });
    let result = reuse('root', 'W', baseline);
    assert.equal(result.lineage, 'W'); assert.equal(result.initializeBudgets, false);
    assert.deepEqual(result.delegation, { projectIds: ['P'], maxAssignments: 2, rootWorkId: 'D' });
    assert.deepEqual(JSON.parse(store.one('SELECT data FROM works WHERE id=?', 'W').data).delegation, result.delegation);
    result = reuse('root', 'W', { ...baseline, projectIds: ['Q'], maxAssignments: 1 });
    assert.deepEqual(result.delegation, { projectIds: [], maxAssignments: 1, rootWorkId: 'D' });
    assert.deepEqual(reuse('root', 'W', baseline).delegation, result.delegation);
    const origin = { version: 1, kind: 'clone', familyRoot: 'root', sourceConversationId: 'root', sourceGeneration: 0, sourceWorkId: 'W', sourceChoiceRevision: 0,
        sourceEventId: 'unexecuted-fixture-event', effects: { ceiling: 'original-lineage', sourceEpoch: 1 }, continuation: { kind: 'ordinary-source', workId: 'W' }, delegationCeiling: { projectIds: ['P', 'Q'], maxAssignments: 8, rootWorkId: 'D' } };
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ contextFamilyRoot: 'root', contextOrigin: origin }), 'child');
    store.run('INSERT INTO sources VALUES(?,?,?,?)', origin.sourceEventId, 'child', JSON.stringify({ kind: 'unexecuted-fixture-event', contextOrigin: origin }), 'Controlled source snapshot');
    store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'B', null, 'fixture-source', null, 'W', 'ACTIVE', 1, 1, null,
        JSON.stringify({ kind: 'ordinary-conversation', conversation: 'child', contextOrigin: origin, contextContinuation: { version: 1, sourceWorkId: 'W', sourceConversationId: 'root', sourceEventId: origin.sourceEventId, effects: 'original-lineage', sourceEpoch: 1 }, delegation: { projectIds: ['P'], maxAssignments: 0, rootWorkId: 'D' } }));
    assert.deepEqual(reuse('child', 'B', baseline).delegation, { projectIds: ['P'], maxAssignments: 0, rootWorkId: 'D' });
    const before = store.one('SELECT data FROM works WHERE id=?', 'W').data;
    store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(before), delegation: { projectIds: [], maxAssignments: 1, rootWorkId: 'W' } }), 'W');
    const mismatch = store.one('SELECT data FROM works WHERE id=?', 'W').data;
    assert.throws(() => reuse('root', 'W', baseline), /captured delegation root W/);
    assert.equal(store.one('SELECT data FROM works WHERE id=?', 'W').data, mismatch);
    store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ kind: 'ordinary-conversation', conversation: 'root' }), 'W');
    assert.throws(() => reuse('root', 'W', baseline), /retained delegation W/);
    store.run('UPDATE works SET data=? WHERE id=?', before, 'W');
    assert.deepEqual(store.all('SELECT lineage,kind,lim,consumed,reserved FROM budgets ORDER BY kind').map(v => ({ ...v })),
        [{ lineage: 'W', kind: 'execution', lim: 8, consumed: 0, reserved: 0 }, { lineage: 'W', kind: 'resolution', lim: 8, consumed: 0, reserved: 0 }]);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
    passed = true;
});

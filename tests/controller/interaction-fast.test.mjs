import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openController } from '../../dist/controller/index.js';
import { Store } from '../../dist/controller/store.js';
test('V2 nullable migration preserves actual W/source/check data and enables ordinary graph/reopen', async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-interaction-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'a.txt'), 'original');
    let c = await openController({ installationHome: home });
    await c.registerProject({ id: 'P', sourceRoot: source });
    const w = await c.beginChange({ projectId: 'P', request: '실제 원본 지시' });
    await c.close();
    const file = path.join(home, 'state/controller.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=OFF');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'conversation_%' OR name='capacity_leases')").all();
    for (const { name } of tables)
        db.exec(`DROP TABLE ${name}`);
    db.exec(`CREATE TABLE oldworks(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),source TEXT NOT NULL REFERENCES sources(id),predecessor TEXT,lineage TEXT NOT NULL,state TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL,current_result TEXT,data TEXT NOT NULL);INSERT INTO oldworks SELECT * FROM works;DROP TABLE works;ALTER TABLE oldworks RENAME TO works;PRAGMA user_version=2`);
    const before = db.prepare('SELECT * FROM works WHERE id=?').get(w.workId);
    const versions = db.prepare('SELECT * FROM change_versions WHERE work=?').all(w.workId);
    db.close();
    c = await openController({ installationHome: home });
    try {
        assert.deepEqual(c.inspectWork(w.workId).workId, w.workId);
        const a = c.createConversation(), b = c.createConversation();
        assert.equal(a.projectId, null);
        assert.equal(c.listProjects().length, 1);
        assert.equal(c.setConversationParent({ childId: b.conversationId, parentId: a.conversationId, expectedRevision: 0 }).revision, 1);
        assert.throws(() => c.setConversationParent({ childId: a.conversationId, parentId: b.conversationId, expectedRevision: 0 }), /cycle/);
        assert.throws(() => c.createConversation({ projectId: '' }), /Unknown/);
        c.setDraft({ conversationId: b.conversationId, expectedRevision: 0, text: '한글 draft' });
        await c.close();
        c = await openController({ installationHome: home });
        assert.equal(c.inspectConversation(b.conversationId).draft.text, '한글 draft');
        assert.equal(c.inspectConversation(b.conversationId).parentId, a.conversationId);
        const read = new DatabaseSync(file);
        assert.equal(read.prepare('PRAGMA user_version').get().user_version, 8);
        assert.deepEqual(read.prepare('SELECT * FROM works WHERE id=?').get(w.workId), before);
        assert.deepEqual(read.prepare('SELECT * FROM change_versions WHERE work=?').all(w.workId), versions);
        assert.equal(read.prepare('PRAGMA foreign_key_check').all().length, 0);
        read.close();
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('cap2 FIFO holds actual admitted cleanup, refunds only affirmed never-admitted queue', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join('/tmp', 'gitjig-capacity-'))), store = new Store(path.join(root, 'state.sqlite'));
    const { Capacity } = await import('../../dist/controller/capacity.js');
    try {
        store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)', 'P', root, '{}');
        const capacity = new Capacity(store, 2);
        for (const n of [1, 2, 3, 4]) {
            store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S' + n, null, '{}', 'input');
            store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W' + n, 'P', 'S' + n, null, 'W' + n, 'ACTIVE', 1, 1, null, '{}');
            store.run('INSERT INTO budgets VALUES(?,?,8,0,1)', 'W' + n, 'execution');
            store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R' + n, 'W' + n, 1, 1, 'CREATED', root, 'reserved', '{}');
        }
        const one = await capacity.acquire({ workId: 'W1', runId: 'R1', epoch: 1, kind: 'check' }), two = await capacity.acquire({ workId: 'W2', runId: 'R2', epoch: 1, kind: 'check' });
        let admitted = false;
        const third = capacity.acquire({ workId: 'W3', runId: 'R3', epoch: 1, kind: 'check' }).then(lease => {
            admitted = true;
            return lease;
        });
        await Promise.resolve();
        assert.equal(admitted, false);
        one.release({ cleanup: 'quarantined', settled: true });
        await Promise.resolve();
        assert.equal(admitted, false);
        two.release({ cleanup: 'removed', settled: true });
        const three = await third;
        assert.equal(admitted, true);
        const abort = new AbortController(), four = capacity.acquire({ workId: 'W4', runId: 'R4', epoch: 1, kind: 'check', signal: abort.signal });
        abort.abort();
        await assert.rejects(four, /interrupted/);
        assert.equal(store.one('SELECT reserved FROM budgets WHERE lineage=?', 'W4').reserved, 0);
        assert.equal(store.one('SELECT reservation FROM runs WHERE id=?', 'R4').reservation, 'released');
        assert.equal(store.one('SELECT reserved FROM budgets WHERE lineage=?', 'W1').reserved, 1);
        three.release({ cleanup: 'removed', settled: true });
    }
    finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('native disposal remains SETTLING until exact actual cleanup; unknown receipt protects capacity state', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join('/tmp', 'gitjig-lifecycle-'))), store = new Store(path.join(root, 'state.sqlite'));
    const { Interactions } = await import('../../dist/controller/interaction.js');
    try {
        store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S', null, '{}', 'raw');
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', null, 'S', null, 'W', 'ACTIVE', 1, 1, null, '{}');
        const interactions = new Interactions(store, () => {
        }), identity = interactions.allocateRole({ workId: 'W', runId: 'R', launchId: 'L', role: 'reviewer' }), registration = { identity, session: { subscribe: () => () => {
                }, clearQueue: () => ({ steering: [], followUp: [] }) }, sessionManager: { getSessionFile: () => '/bound/history', getSessionId: () => 'native-id' } };
        interactions.lifecycle.ready(registration);
        interactions.lifecycle.settling(identity);
        interactions.lifecycle.released(identity);
        assert.equal(interactions.inspect(identity.conversationId).state, 'SETTLING');
        interactions.cleanup({ ...identity, runId: 'wrong' }, { cleanup: 'removed', settled: true });
        assert.equal(interactions.inspect(identity.conversationId).state, 'SETTLING');
        interactions.cleanup(identity, { cleanup: 'quarantined', settled: true });
        assert.equal(interactions.inspect(identity.conversationId).state, 'UNKNOWN');
        interactions.cleanup(identity, { cleanup: 'removed', settled: true });
        assert.equal(interactions.inspect(identity.conversationId).state, 'IDLE');
    }
    finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('captured assignment validates before atomic child/edge creation and retains cumulative delegation root across descendants', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join('/tmp', 'gitjig-assign-'))), store = new Store(path.join(root, 'state.sqlite'));
    const { Interactions } = await import('../../dist/controller/interaction.js'), { coordination } = await import('../../dist/controller/coordination.js');
    try {
        store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)', 'P', root, '{}');
        store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S', null, '{}', 'owner instructions');
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', null, 'S', null, 'W', 'ACTIVE', 1, 1, null, '{}');
        const interactions = new Interactions(store, () => {
        }), parent = interactions.create(), identity = { conversationId: parent.conversationId, workId: 'W', runId: 'R', launchId: null, generation: 0, directionRevision: 0, initialInputId: 'I' }, launched = [], delegation = { projectIds: ['P'], maxAssignments: 1, rootWorkId: 'W' }, callbacks = coordination({ store, interactions, identity, entry: () => {
            }, delegation, launch: (...args) => launched.push(args), onWait: () => {
            } });
        const before = interactions.list().length;
        assert.throws(() => callbacks.assign({ projectId: 'missing', instructions: 'bad' }), /delegation/);
        assert.equal(interactions.list().length, before);
        assert.equal(store.all('SELECT * FROM conversation_assignments').length, 0);
        const assigned = callbacks.assign({ projectId: 'P', instructions: 'Scoped child' });
        assert.equal(assigned.accepted, true);
        assert.equal(interactions.inspect(assigned.conversationId).parentId, parent.conversationId);
        assert.equal(launched.length, 1);
        const childIdentity = { ...identity, conversationId: assigned.conversationId }, childCallbacks = coordination({ store, interactions, identity: childIdentity, entry: () => {
            }, delegation, launch: () => {
            }, onWait: () => {
            } });
        assert.throws(() => childCallbacks.assign({ projectId: 'P', instructions: 'Try reset via descendant' }), /allowance/);
        assert.equal(interactions.list().length, before + 1);
        await assert.rejects(() => callbacks.address({ conversationId: assigned.conversationId, expectedGeneration: 0, text: 'stale', mode: 'steer', observedDirectionRevision: 99 }), /stale/);
        assert.equal(store.all('SELECT * FROM conversation_inputs').length, 1);
    }
    finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('author explanation claim cannot release governing hold; exact nonauthor decision consumes raw source and wrong revision refuses', async () => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-impact-')), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'code.txt'), 'actual');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const w = await c.beginChange({ projectId: 'P', request: 'Original R1' }), core = c.changeCore, store = core.s, run = c.inspectWork(w.workId).runs[0], identity = c.interactionCore.allocateRole({ workId: w.workId, runId: run.id, launchId: 'L-author', role: 'implementer' });
        await c.queueConversationInput({ conversationId: identity.conversationId, expectedGeneration: identity.generation, text: '왜 이 접근을 선택했나?', mode: 'follow-up' });
        const input = c.interactionCore.impacts(w.workId)[0];
        const { coordination } = await import('../../dist/controller/coordination.js');
        const callbacks = coordination({ store, interactions: c.interactionCore, identity, entry: () => {
            }, delegation: { projectIds: ['P'], maxAssignments: 1, rootWorkId: w.workId }, launch: () => {
            }, onWait: () => {
            } });
        callbacks.acknowledgeInput({ inputId: input.input_id, classification: 'explanation', requirementIds: [], summary: 'Question only' });
        assert.equal(c.interactionCore.impacts(w.workId)[0].data.effectHold, true);
        store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'L-judge', w.workId, run.id, 'adjudicator', w.epoch, 'COMPLETE', 'none', '{}');
        const protocol = { version: 1, summary: 'Independent source-fit', findings: [], assessedScope: [], inputDecisions: [{ inputId: input.input_id, directionRevision: input.revision + 1, impact: 'explanation', reason: 'Read actual raw question', requirementIds: [] }] };
        assert.throws(() => core.inputDecisions(w.workId, 'L-judge', protocol), /omitted/);
        assert.equal(c.interactionCore.impacts(w.workId)[0].data.effectHold, true);
        protocol.inputDecisions[0].directionRevision = input.revision;
        core.inputDecisions(w.workId, 'L-judge', protocol);
        assert.equal(c.interactionCore.impacts(w.workId)[0].data.effectHold, false);
        assert.equal(c.interactionCore.impacts(w.workId)[0].text, '왜 이 접근을 선택했나?');
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('dependency cycles refuse independently of parent graph; new direct input conflicts queued agent source without erasing raw', async () => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-graph-direction-')), store = new Store(path.join(root, 'state.sqlite'));
    const { Interactions } = await import('../../dist/controller/interaction.js'), { coordination } = await import('../../dist/controller/coordination.js');
    try {
        store.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)', 'P', root, '{}');
        store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S', null, '{}', 'actual owner');
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', 'S', null, 'W', 'ACTIVE', 1, 1, null, '{}');
        const interactions = new Interactions(store, () => {
        }), a = interactions.create({ projectId: 'P' }), b = interactions.create({ projectId: 'P' }), identity = { conversationId: a.conversationId, workId: 'W', runId: 'R', launchId: null, generation: 0, directionRevision: 0, initialInputId: 'I' }, create = id => coordination({ store, interactions, identity: { ...identity, conversationId: id }, entry: () => {
            }, delegation: { projectIds: ['P'], maxAssignments: 4, rootWorkId: 'W' }, launch: () => {
            }, onWait: () => {
            } }), ac = create(a.conversationId), bc = create(b.conversationId);
        ac.assign({ conversationId: b.conversationId, observedDirectionRevision: 0, projectId: 'P', instructions: 'A waits for B', resultDependency: true });
        assert.throws(() => bc.assign({ conversationId: a.conversationId, observedDirectionRevision: 0, projectId: 'P', instructions: 'B cannot wait for A', resultDependency: true }), /dependency cycle/);
        assert.equal(store.all('SELECT * FROM conversation_assignments').length, 1);
        await ac.address({ conversationId: b.conversationId, expectedGeneration: 0, observedDirectionRevision: 0, text: 'Queued old parent direction', mode: 'steer' });
        await interactions.queue({ conversationId: b.conversationId, expectedGeneration: 0, text: 'Direct owner changed this direction', mode: 'idle' });
        const old = store.one('SELECT * FROM conversation_inputs WHERE text=?', 'Queued old parent direction');
        assert.equal(old.state, 'CONFLICTED');
        assert.equal(store.one('SELECT raw FROM sources WHERE id=?', old.source).raw, 'Queued old parent direction');
        await assert.rejects(ac.address({ conversationId: b.conversationId, expectedGeneration: 0, observedDirectionRevision: 0, text: 'Stale parent again', mode: 'steer' }), /stale/);
        assert.equal(store.one('SELECT COUNT(*) AS n FROM conversation_dependencies').n, 1);
    }
    finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('one provenance cancellation closure ignores reparenting, cancels queued no-W descendants and refuses their later work admission', async () => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-cancel-origin-')), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'input.txt'), 'retained');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const wa = await c.beginChange({ projectId: 'P', request: 'WA origin' }), wb = await c.beginChange({ projectId: 'P', request: 'WB unrelated' }), wc = await c.beginChange({ projectId: 'P', request: 'WC assigned child' }), wd = await c.beginChange({ projectId: 'P', request: 'WD assigned grandchild' }), a = c.createConversation({ projectId: 'P' }), b = c.createConversation({ projectId: 'P' }), d = c.createConversation({ projectId: 'P' }), store = c.store, actor = workId => ({ conversationId: a.conversationId, workId, runId: c.inspectWork(workId).runs[0].id, launchId: null, generation: 1, directionRevision: 0, initialInputId: 'I' });
        for (const [id, parent, work] of [['A1', wa.workId, wc.workId], ['A2', wc.workId, wd.workId], ['A3', wc.workId, null]])
            store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', id, a.conversationId, b.conversationId, work, 'QUEUED', JSON.stringify({ source: actor(parent), delegationRoot: wa.workId }));
        c.setConversationParent({ childId: b.conversationId, parentId: d.conversationId, expectedRevision: 0 });
        const sourceBefore = c.inspectWork(wc.workId).source;
        const cancelled = await c.cancelAssignment({ assignmentId: 'A1', reason: 'Cancel original assigned subtree after reparent' });
        assert.deepEqual(new Set(cancelled.workIds), new Set([wc.workId, wd.workId]));
        assert.equal(c.inspectWork(wa.workId).state, 'ACTIVE');
        assert.equal(c.inspectWork(wb.workId).state, 'ACTIVE');
        assert.equal(c.inspectWork(wc.workId).state, 'CANCELLED');
        assert.equal(c.inspectWork(wd.workId).epoch, 2);
        assert.equal(store.one('SELECT state FROM conversation_assignments WHERE id=?', 'A3').state, 'CANCELLED');
        assert.deepEqual(c.inspectWork(wc.workId).source, sourceBefore);
        store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'queued-before-W', a.conversationId, b.conversationId, null, 'QUEUED', JSON.stringify({ source: actor(wa.workId), delegationRoot: wa.workId }));
        const originalActor = actor(wa.workId), count = store.all('SELECT * FROM works').length;
        await c.cancelWork({ workId: wa.workId });
        assert.equal(store.one('SELECT state FROM conversation_assignments WHERE id=?', 'queued-before-W').state, 'CANCELLED');
        await assert.rejects(c.changeCore.begin({ projectId: 'P', request: 'Cancelled queued work must not allocate' }, { kind: 'agent-governed-assignment', actor: originalActor, assignmentId: 'queued-before-W', conversationId: b.conversationId }), /cancelled/);
        assert.equal(store.all('SELECT * FROM works').length, count);
        assert.equal(c.inspectWork(wb.workId).epoch, 1);
        assert.equal(c.inspectConversation(b.conversationId).parentId, d.conversationId);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('actual admitted base-copy cancellation uses atomic assignment-W attachment before native producer completion', async t => {
    const root = await fs.realpath(await fs.mkdtemp('/tmp/gitjig-copy-cancel-')), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'large.txt'), Buffer.alloc(16 * 1024 * 1024, 65));
    const c = await openController({ installationHome: home }); let passed = false;
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const parent = await c.beginChange({ projectId: 'P', request: 'Parent retains cancellation origin' }), unrelated = await c.beginChange({ projectId: 'P', request: 'Unrelated W survives' }), a = c.createConversation({ projectId: 'P' }), target = c.createConversation({ projectId: 'P' }), actor = { conversationId: a.conversationId, workId: parent.workId, runId: c.inspectWork(parent.workId).runs[0].id, launchId: null, generation: 1, directionRevision: 0, initialInputId: 'I' }, store = c.store;
        store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'capture-assignment', a.conversationId, target.conversationId, null, 'QUEUED', JSON.stringify({ source: actor, projectId: 'P', delegationRoot: parent.workId }));
        let observed;
        const entered = new Promise(r => observed = r), host = c.changeCore.h, patch = host.patchRun;
        host.patchRun = (id, phase, data) => {
            patch(id, phase, data);
            if (phase === 'CAPTURING')
                observed(id);
        };
        const pending = c.changeCore.begin({ projectId: 'P', request: 'Capture actual child' }, { kind: 'agent-governed-assignment', actor, assignmentId: 'capture-assignment', conversationId: target.conversationId, delegationRoot: parent.workId });
        const runId = await entered;
        let copied = false;
        const row = store.one('SELECT * FROM runs WHERE id=?', runId);
        for (let i = 0; i < 10000; i++) {
            try {
                if ((await fs.stat(path.join(row.staging, 'large.txt'))).size > 0) {
                    copied = true;
                    break;
                }
            }
            catch {
            }
            await new Promise(r => setImmediate(r));
        }
        assert.equal(copied, true);
        const assigned = store.one('SELECT * FROM conversation_assignments WHERE id=?', 'capture-assignment');
        assert.equal(assigned.work, row.work);
        assert.equal(c.inspectWork(row.work).state, 'ACTIVE');
        await c.cancelAssignment({ assignmentId: 'capture-assignment', reason: 'Cancel actual copy before base publication' });
        await pending;
        host.patchRun = patch;
        assert.equal(c.inspectWork(row.work).state, 'CANCELLED');
        assert.equal(c.inspectWork(row.work).epoch, 2);
        assert.equal(c.inspectWork(row.work).allowance.reserved, 0);
        assert.equal(c.inspectWork(parent.workId).state, 'ACTIVE');
        assert.equal(c.inspectWork(unrelated.workId).state, 'ACTIVE');
        assert.equal(store.one('SELECT state FROM conversation_assignments WHERE id=?', 'capture-assignment').state, 'CANCELLED');
        passed = true;
    }
    finally {
        await c.close();
        if (passed) await fs.rm(root, { recursive: true, force: true });
        else t.diagnostic('Retained base-copy cancellation world: ' + root);
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { coordination } from '../../dist/controller/coordination.js';
import { admitContextWork, captureContextEffects } from '../../dist/controller/context-origin.js';
import { validateContextAssignmentLaunch } from '../../dist/controller/context-coordination.js';

test('actual source incarnation lookup preserves distinct queued children and exact governed references', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-source-lookup-'))), c = await openController({ installationHome: path.join(root, 'app') }), s = c.store;
    let passed = false;
    t.after(async () => { await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained failed source lookup world: ' + root); });
    for (const project of ['P', 'Q']) { const directory = path.join(root, project); await fs.mkdir(directory); await c.registerProject({ id: project, sourceRoot: directory }); }
    const create = () => c.createConversation({ projectId: 'P' }).conversationId, A = create();
    s.run('INSERT INTO sources VALUES(?,?,?,?)', 'fixture-source', A, JSON.stringify({ kind: 'UNEXECUTED_SOURCE_FIXTURE' }), 'Controlled unstarted state, no standing or successful review');
    const state = cid => JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
    const workData = wid => JSON.parse(s.one('SELECT data FROM works WHERE id=?', wid).data);
    const write = (cid, data, work = null) => s.run('UPDATE conversation_state SET data=?,work=? WHERE conversation=?', JSON.stringify(data), work, cid);
    const delegation = { projectIds: ['P', 'Q'], maxAssignments: 8, rootWorkId: 'W1' };
    const identity = (cid, wid) => ({ conversationId: cid, workId: wid, runId: 'run-' + wid, launchId: null, generation: 0, directionRevision: 0, initialInputId: 'input-' + wid });
    const insert = (wid, cid, lineage = wid, predecessor = null, metadata = {}) => {
        s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', wid, 'P', 'fixture-source', predecessor, lineage, 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'ordinary-conversation', conversation: cid, delegation, ...metadata }));
        s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'run-' + wid, wid, 1, 1, 'FIXTURE_UNSTARTED', root, 'fixture-no-reservation', JSON.stringify({ kind: 'unexecuted-fixture' }));
    };
    const budgets = wid => { for (const kind of ['execution', 'resolution']) s.run('INSERT INTO budgets VALUES(?,?,8,0,0)', wid, kind); };
    const bindFamily = (cid, wid) => write(cid, { contextFamilyRoot: cid, contextFamily: { version: 1, rootConversationId: cid, budgetAnchorWorkId: wid, budgetLineage: wid, delegationRootWorkId: 'W1' } }, wid);
    insert('W1', A); budgets('W1'); bindFamily(A, 'W1');
    const admit = (wid, cid) => s.tx(() => {
        const prior = s.one('SELECT work FROM conversation_state WHERE conversation=?', cid).work, ctx = admitContextWork(s, cid, wid, delegation);
        insert(wid, cid, ctx.lineage, prior, ctx.metadata); write(cid, state(cid), wid); return ctx;
    });
    const branch = (wid, sourceCid, sourceWid, familyRoot, reference) => {
        const cid = create(), origin = { version: 1, kind: 'clone', familyRoot, sourceConversationId: sourceCid, sourceGeneration: 0, sourceWorkId: sourceWid, sourceChoiceRevision: 0,
            sourceEventId: 'event-' + wid, effects: captureContextEffects(s, sourceCid, sourceWid), continuation: reference, delegationCeiling: delegation };
        write(cid, { contextFamilyRoot: familyRoot, contextOrigin: origin });
        s.run('INSERT INTO sources VALUES(?,?,?,?)', origin.sourceEventId, cid, JSON.stringify({ kind: 'UNEXECUTED_CONTEXT_FIXTURE', contextOrigin: origin }), 'Controlled immutable source');
        admit(wid, cid); return cid;
    };
    const launches = [], controls = (cid, wid) => coordination({ store: s, interactions: c.interactionCore, identity: identity(cid, wid), delegation, entry() {}, onWait() {}, launch(target, assignmentId) { launches.push({ target, assignmentId }); } });
    const B = branch('B', A, 'W1', A, { kind: 'ordinary-source', workId: 'W1' }), root1 = controls(A, 'W1'), b = controls(B, 'B');
    const p1 = root1.assign({ projectId: 'P', instructions: 'Original P child', operation: 'change' });
    admit('W2', A); const root2 = controls(A, 'W2');
    const q2 = root2.assign({ projectId: 'Q', instructions: 'New source incarnation original Q child', operation: 'change' });
    const qRow = s.one('SELECT * FROM conversation_assignments WHERE id=?', q2.assignmentId);
    assert.equal(JSON.parse(qRow.data).source.workId, 'W2'); assert.equal(Object.hasOwn(JSON.parse(qRow.data), 'continuationSourceWorkId'), false);
    const snapshot = () => ({ assignments: s.all('SELECT * FROM conversation_assignments ORDER BY id'), inputs: s.all('SELECT * FROM conversation_inputs ORDER BY id'), works: s.all('SELECT * FROM works ORDER BY id'), sources: s.all('SELECT * FROM sources ORDER BY id'), launches: launches.length });
    const beforeForward = snapshot(), forward = b.assign({ projectId: 'Q', instructions: 'Find W2 original without a fresh task', operation: 'change' });
    assert.equal(forward.assignmentId, q2.assignmentId); assert.equal(forward.state, 'queued-original'); assert.deepEqual(snapshot(), beforeForward);
    const B2 = branch('B2', A, 'W2', A, { kind: 'ordinary-source', workId: 'W2' }), b2 = controls(B2, 'B2');
    const beforeReverse = snapshot(), reverse = b2.assign({ projectId: 'P', instructions: 'Find earlier W1 original', operation: 'change' });
    assert.equal(reverse.assignmentId, p1.assignmentId); assert.deepEqual(snapshot(), beforeReverse);
    const p2 = root2.assign({ projectId: 'P', instructions: 'Legitimate distinct P child', operation: 'change' });
    assert.notEqual(p2.assignmentId, p1.assignmentId);
    const beforeAmbiguous = snapshot(); assert.throws(() => b.assign({ projectId: 'P', instructions: 'No arbitrary distinct child choice', operation: 'change' }), /ambiguous original targets/);
    assert.deepEqual(snapshot(), beforeAmbiguous);
    for (const [who, child] of [[b, p1], [b2, p2]]) {
        const before = snapshot(), explicit = who.assign({ projectId: 'P', conversationId: child.conversationId, observedDirectionRevision: 0, instructions: 'Inspect this exact pending child', operation: 'change' });
        assert.equal(explicit.assignmentId, child.assignmentId); assert.deepEqual(snapshot(), before);
    }
    const govern = (receipt, wid, actor) => {
        insert(wid, receipt.conversationId, wid, null, { kind: 'governed-change', invocation: { assignmentId: receipt.assignmentId, actor } }); budgets(wid);
        s.run('INSERT INTO change_state VALUES(?,?,NULL,NULL,NULL,NULL,?,?)', wid, 'PLAN_PENDING', 1, JSON.stringify({ pendingFindingCanary: 'UNRESOLVED_FIXTURE' }));
        s.run('UPDATE conversation_assignments SET work=?,state=? WHERE id=?', wid, 'UNAVAILABLE', receipt.assignmentId);
        write(receipt.conversationId, state(receipt.conversationId), wid);
    };
    govern(p1, 'G1', identity(A, 'W1'));
    const targetOrigin = { ...state(B).contextOrigin, sourceEventId: 'target-event', continuation: { kind: 'governed', workId: 'G1' } };
    write(p1.conversationId, { contextFamilyRoot: A, contextOrigin: targetOrigin }, 'G1');
    s.run('INSERT INTO sources VALUES(?,?,?,?)', targetOrigin.sourceEventId, p1.conversationId, JSON.stringify({ kind: 'UNEXECUTED_TARGET_FIXTURE', contextOrigin: targetOrigin }), 'Controlled target-only constraint');
    const targetOnly = root2.assign({ projectId: 'P', conversationId: p1.conversationId, observedDirectionRevision: 0, instructions: 'Unbound source obeys exact target', operation: 'change' });
    assert.equal(targetOnly.workId, 'G1'); assert.equal(targetOnly.assignmentId, p1.assignmentId);
    const mixed = b.assign({ projectId: 'P', conversationId: p1.conversationId, observedDirectionRevision: 1, instructions: 'Intersect ordinary incarnations and exact target', operation: 'change' });
    assert.equal(mixed.workId, 'G1'); assert.equal(validateContextAssignmentLaunch(s, p1.assignmentId).work, 'G1');
    const bState = state(B), bWork = workData('B'), bEvent = s.one('SELECT origin FROM sources WHERE id=?', bState.contextOrigin.sourceEventId).origin;
    const wrongKind = { ...bState.contextOrigin, continuation: { kind: 'ordinary-source', workId: 'G1' } };
    write(B, { ...bState, contextOrigin: wrongKind }, 'B'); s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...bWork, contextOrigin: wrongKind }), 'B');
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({ kind: 'UNEXECUTED_CONTEXT_FIXTURE', contextOrigin: wrongKind }), wrongKind.sourceEventId);
    assert.throws(() => b.assign({ projectId: 'P', instructions: 'Governed work is not an ordinary identity set', operation: 'change' }), /ordinary reference kind G1/);
    write(B, bState, 'B'); s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(bWork), 'B'); s.run('UPDATE sources SET origin=? WHERE id=?', bEvent, wrongKind.sourceEventId);
    // Governed -> ordinary effects ancestry is NOT ordinary task identity.
    const governed = root2.assign({ projectId: 'P', instructions: 'Distinct original governed parent', operation: 'change' }); govern(governed, 'H', identity(A, 'W2')); bindFamily(governed.conversationId, 'H');
    const BG = branch('BG', governed.conversationId, 'H', governed.conversationId, { kind: 'governed', workId: 'H' });
    admit('H2', governed.conversationId); const h2 = controls(governed.conversationId, 'H2');
    const newChild = h2.assign({ projectId: 'P', instructions: 'Fresh ordinary supervisor child after governed predecessor', operation: 'change' });
    const exact = controls(BG, 'BG').assign({ projectId: 'P', instructions: 'Remain exact original H', operation: 'change' });
    assert.equal(exact.assignmentId, governed.assignmentId); assert.equal(exact.workId, 'H'); assert.notEqual(exact.assignmentId, newChild.assignmentId);
    const BH2 = branch('BH2', governed.conversationId, 'H2', governed.conversationId, { kind: 'ordinary-source', workId: 'H2' });
    assert.equal(controls(BH2, 'BH2').assign({ projectId: 'P', instructions: 'Ordinary H2 stops before governed H', operation: 'change' }).assignmentId, newChild.assignmentId);
    const w2Data = workData('W2'), { contextContinuation: removed, ...missing } = w2Data;
    s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(missing), 'W2'); const beforeMissing = snapshot();
    assert.throws(() => b.assign({ projectId: 'Q', instructions: 'Reciprocal retained event finds missing edge', operation: 'change' }), /missing retained family source/); assert.deepEqual(snapshot(), beforeMissing);
    s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(w2Data), 'W2');
    const w1Data = workData('W1'), loop = { version: 1, kind: 'family-source', familyRoot: A, sourceWorkId: 'W2', sourceConversationId: A, sourceEventId: 'cycle-event', effects: 'original-lineage', sourceEpoch: 1 };
    s.run('INSERT INTO sources VALUES(?,?,?,?)', loop.sourceEventId, A, JSON.stringify({ kind: 'controller-family-source-continuation', targetWorkId: 'W1', familyRoot: A, contextContinuation: loop }), 'Controlled invalid directed cycle');
    s.run('UPDATE works SET predecessor=?,data=? WHERE id=?', 'W2', JSON.stringify({ ...w1Data, contextFamilyRoot: A, contextContinuation: loop }), 'W1'); const beforeCycle = snapshot();
    assert.throws(() => b.assign({ projectId: 'Q', instructions: 'Cycle cannot create fresh original', operation: 'change' }), /cyclic ordinary source incarnations/); assert.deepEqual(snapshot(), beforeCycle);
    s.run('UPDATE works SET predecessor=NULL,data=? WHERE id=?', JSON.stringify(w1Data), 'W1'); s.run('DELETE FROM sources WHERE id=?', loop.sourceEventId);
    s.run('UPDATE works SET epoch=2 WHERE id=?', 'W1'); const beforeEpoch = snapshot();
    assert.throws(() => b2.assign({ projectId: 'Q', instructions: 'Changed family predecessor epoch remains unavailable', operation: 'change' }), /family source event\/epoch/); assert.deepEqual(snapshot(), beforeEpoch);
    t.diagnostic('Real Store/admission/coordination/retained validator; controlled unstarted rows and callbacks, no live-host authority, review or model execution');
    passed = true;
});

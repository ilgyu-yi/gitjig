import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';
import {inspectAssignmentResultMetadata} from '../../dist/controller/conversation-results.js';
import {coordination} from '../../dist/controller/coordination.js';
import {createCoordinationTools} from '../../dist/pi/coordination.js';
import {openController} from '../../dist/controller/index.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receipt = message => JSON.parse(message.content.filter(part => part.type === 'text').map(part => part.text).join(''));
function candidate(c, child) {
    const base = c.store.one("SELECT * FROM change_versions WHERE work=? AND kind='base'", child.workId), id = randomUUID();
    // A controlled retained candidate reuses frozen BASE bytes. This qualifies
    // metadata delivery, not implementation or semantic procedure completion.
    c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', id, child.workId, 'candidate', base.id, base.artifact, base.hash, base.data);
    c.store.run('UPDATE change_state SET candidate=? WHERE work=?', id, child.workId);
}

test('actual accepted-WAIT continuation receives retained candidate facts through named Pi status only', async t => {
    let f, observed, originalPublication, childBudget;
    f = await failedWaitWorld(t, {prepareResult: candidate, onContinuation(context, _turn, _text, children) {
        const lastUser = context.messages.findLastIndex(message => message.role === 'user');
        const results = context.messages.slice(lastUser + 1).filter(message => message.role === 'toolResult' && message.toolName === 'conversation_status');
        if (!results.length) {
            const assignment = f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', children[0].assignmentId);
            originalPublication = f.c.store.one('SELECT * FROM conversation_results WHERE id=?', JSON.parse(assignment.data).resultId);
            childBudget = f.c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', children[0].workId);
            return {tool: {name: 'conversation_status', arguments: {conversationId: children[0].conversationId}}};
        }
        if (results.length === 1) {
            const status = receipt(results[0]); observed = status.recordedResult;
            assert.equal(status.assignments.length, 1);
            assert.equal(observed.state, 'available');
            assert.equal(observed.temporalScope, 'publication-only');
            assert.equal(observed.assignmentId, children[0].assignmentId);
            assert.equal(observed.resultId, originalPublication.id);
            const publication = JSON.parse(originalPublication.data);
            assert.equal(observed.publicationHash, publication.publicationHash);
            assert.deepEqual(observed.snapshot, publication.result);
            assert.ok(observed.snapshot.candidateVersion);
            assert.equal(observed.snapshot.phase, 'BLOCKED');
            assert.equal(observed.snapshot.reviewReady, false);
            assert.equal(observed.snapshot.counts.checks, 0);
            assert.deepEqual(observed.snapshot.selectedEvidence.reviewLaunchIds, []);
            return {tool: {name: 'conversation_status', arguments: {}}};
        }
        assert.ok(receipt(results[1]).every(view => !Object.hasOwn(view, 'recordedResult')));
        return {text: 'An isolated candidate is retained; formal checks and review are not complete. This is one original assigned task.'};
    }});
    await f.settle();
    assert.equal(f.continuations.length, 1); assert.ok(observed);
    assert.deepEqual(f.c.store.one('SELECT * FROM conversation_results WHERE id=?', originalPublication.id), originalPublication);
    assert.deepEqual(f.c.store.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', f.children[0].workId), childBudget);
    assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=?', f.parent).n, 1);
    // The original automatically generated input keeps its old outcome shape.
    assert.equal(f.continuations[0].includes('recordedResult'), false);
    const assignment = f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?', f.children[0].assignmentId);
    const reader = {identity: {conversationId: f.parent}, delegation: {rootWorkId: f.c.inspectConversation(f.parent).workId, projectIds: ['P'], maxAssignments: 8}};
    const before = JSON.stringify(f.c.store.all('SELECT * FROM conversation_results ORDER BY rowid'));
    const read = () => inspectAssignmentResultMetadata(f.c.store, assignment, originalPublication.id, reader);
    assert.equal(read().state, 'available');
    assert.equal(JSON.stringify(f.c.store.all('SELECT * FROM conversation_results ORDER BY rowid')), before);
    const original = JSON.parse(originalPublication.data);
    for (const mutate of [
        value => { value.audience = []; },
        value => { value.publicationHash = '0'.repeat(64); },
        value => { value.result.workId = randomUUID(); value.publicationHash = hash(value.result); },
        value => { value.result.counts.checks = '0'; value.publicationHash = hash(value.result); },
        value => { value.result.padding = 'x'.repeat(8 * 1024); value.publicationHash = hash(value.result); },
        value => { value.padding = 'x'.repeat(128 * 1024); },
    ]) {
        const changed = structuredClone(original); mutate(changed);
        const data = JSON.stringify(changed);
        f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?', data, originalPublication.id);
        assert.equal(read().state, 'unavailable');
        assert.equal(f.c.store.one('SELECT data FROM conversation_results WHERE id=?', originalPublication.id).data, data);
    }
    f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?', originalPublication.data.replace('{', '{"assignmentId":"duplicate",'), originalPublication.id);
    assert.equal(read().state, 'unavailable');
    f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?', originalPublication.data, originalPublication.id);
    f.c.store.run('UPDATE conversation_results SET work=? WHERE id=?', reader.delegation.rootWorkId, originalPublication.id);
    assert.equal(read().state, 'unavailable');
    f.c.store.run('UPDATE conversation_results SET work=? WHERE id=?', assignment.work, originalPublication.id);
    assert.equal(inspectAssignmentResultMetadata(f.c.store, {...assignment, target: f.parent}, originalPublication.id, reader).state, 'unavailable');
    assert.equal(inspectAssignmentResultMetadata(f.c.store, assignment, randomUUID(), reader).state, 'unavailable');
    assert.equal(read().state, 'available');
    const parent = f.c.inspectConversation(f.parent);
    const controls = coordination({store: f.c.store, interactions: f.c.interactions,
        identity: {...reader.identity, generation: parent.generation}, delegation: reader.delegation,
        entry() {}, launch() { throw Error('Status must not launch'); }, onWait() { throw Error('Status must not wait'); }});
    const statusTool = createCoordinationTools(controls, () => { throw Error('Status must not wait'); }).find(tool => tool.name === 'conversation_status');
    const status = async () => receipt(await statusTool.execute('owned-readonly-status', {conversationId: assignment.target}));
    const ledger = () => JSON.stringify(Object.fromEntries(['works', 'budgets', 'conversation_inputs', 'conversation_assignments', 'conversation_results', 'sources'].map(table => [table, f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));
    const ledgerBefore = ledger(); assert.equal((await status()).recordedResult.state, 'available'); assert.equal(ledger(), ledgerBefore);
    const priorEpoch = f.c.store.one('SELECT epoch FROM works WHERE id=?', assignment.work).epoch;
    f.c.store.run('UPDATE works SET epoch=? WHERE id=?', priorEpoch + 1, assignment.work);
    const historical = await status(); assert.equal(historical.workEpoch, priorEpoch + 1);
    assert.equal(historical.recordedResult.temporalScope, 'publication-only');
    assert.equal(historical.recordedResult.snapshot.epoch, priorEpoch);
    f.c.store.run('UPDATE works SET epoch=? WHERE id=?', priorEpoch, assignment.work);
    const duplicate = randomUUID();
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', duplicate, assignment.source_conversation, assignment.target, assignment.work, assignment.state, assignment.data);
    assert.equal((await status()).recordedResult.reason, 'ambiguous-original-assignment');
    f.c.store.run('DELETE FROM conversation_assignments WHERE id=?', duplicate);
    // Fill existing base metadata, without enlarging the published snapshot, to
    // exercise the actual Pi output bound and both optional omission paths.
    f.c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', '', assignment.id);
    const empty = await status(); delete empty.recordedResult;
    const overhead = Buffer.byteLength(JSON.stringify(empty));
    for (const room of [200, 1]) {
        f.c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'X'.repeat(128 * 1024 - overhead - room), assignment.id);
        const result = await status(); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
        if (room === 200) assert.equal(result.recordedResult.reason, 'status-output-bound');
        else assert.equal(Object.hasOwn(result, 'recordedResult'), false);
    }
    f.c.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', assignment.state, assignment.id);
    assert.equal(ledger(), ledgerBefore);
    await f.c.close();
    const reopened = await openController({installationHome: f.home});
    try {
        const cold = inspectAssignmentResultMetadata(reopened.store, assignment, originalPublication.id, reader);
        assert.equal(cold.state, 'available'); assert.deepEqual(cold.snapshot, observed.snapshot);
        assert.equal(reopened.store.one('SELECT data FROM conversation_results WHERE id=?', originalPublication.id).data, originalPublication.data);
    } finally { await reopened.close(); }
    f.pass();
});

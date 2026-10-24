import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { contextBinding } from '../../dist/controller/context-origin.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';

initializeApplicationEnvironment();
let requests = 0, sockets = 0;
net.Socket.prototype.connect = function () { sockets++; throw Error('No socket in context budget fixture'); };
globalThis.fetch = async (_url, options) => {
    assert.ok(requests < 3, 'Three original-codec fixture request ceiling'); requests++;
    const body = JSON.parse(options.body);
    return wireResponse('openai-completions', body.model, { text: 'ACTUAL_CONTEXT_TURN_' + requests });
};
const root = process.argv[2], controller = await openController({ installationHome: path.join(root, 'app') });
try {
    const accounts = ApplicationAccounts.open(controller), models = new ApplicationModels(controller), store = controller.store;
    await accounts.configure({ providers: { 'context-fixture': { api: 'openai-completions', apiKey: 'DUMMY_CONTEXT_KEY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'owned', contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('context-fixture', 'owned');
    const views = [await models.newConversation(), await models.newConversation(), await models.newConversation()];
    const [source, strict, branch] = views;
    const data = cid => JSON.parse(store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
    const write = (cid, value) => store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(value), cid);
    // Explicit non-authority metadata fixtures, not public fork registration,
    // role allocation, successful review, or source-origin producer evidence.
    write(source.conversationId, { ...data(source.conversationId), contextFamilyRoot: source.conversationId, contextFamily: {
        version: 1, rootConversationId: source.conversationId, budgetAnchorWorkId: null, budgetLineage: null, delegationRootWorkId: null,
    } });
    for (const [view, max] of [[strict, 0], [branch, 8]]) write(view.conversationId, { ...data(view.conversationId), contextFamilyRoot: source.conversationId, contextOrigin: {
        version: 1, kind: 'clone', familyRoot: source.conversationId, sourceConversationId: source.conversationId, sourceGeneration: 0, sourceWorkId: null,
        sourceChoiceRevision: controller.getConversationModelChoice(source.conversationId).revision, sourceEventId: 'fixture-context-' + max,
        effects: { ceiling: 'none', sourceEpoch: null }, continuation: { kind: 'first-family-work' }, delegationCeiling: { projectIds: [], maxAssignments: max, rootWorkId: null },
    } });
    for (const view of [strict, branch]) { const origin = data(view.conversationId).contextOrigin; store.run('INSERT INTO sources VALUES(?,?,?,?)', origin.sourceEventId, view.conversationId, JSON.stringify({ kind: 'unexecuted-fixture-context', contextOrigin: origin }), 'Controlled origin snapshot'); }
    models.install({resumeAuthorized:false});
    for (const view of views) await controller.queueConversationInput({ conversationId: view.conversationId, expectedGeneration: 0, text: 'Actual separately attributable context turn', mode: 'idle' });
    const outcomes = await Promise.all(views.map(view => controller.runConversation({ conversationId: view.conversationId, ...models.conversationOperation(view.conversationId) })));
    assert.deepEqual(outcomes.map(o => o.status), ['delivered', 'delivered', 'delivered']);
    const works = views.map(v => store.one('SELECT * FROM works WHERE id=?', controller.inspectConversation(v.conversationId).workId));
    const family = data(source.conversationId).contextFamily;
    assert.equal(new Set(works.map(w => w.id)).size, 3);
    assert.equal(new Set(works.map(w => w.lineage)).size, 1);
    assert.ok(works.some(w => w.id === family.budgetAnchorWorkId));
    assert.equal(works[0].lineage, family.budgetLineage);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM budgets').n, 2);
    assert.deepEqual({ ...store.one('SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, 'execution') }, { lim: 32, consumed: 3, reserved: 0 });
    assert.equal(new Set(works.map(w => JSON.parse(w.data).delegation.rootWorkId)).size, 1);
    assert.equal(JSON.parse(works[1].data).delegation.maxAssignments, 0);
    assert.equal(JSON.parse(works[2].data).delegation.maxAssignments, 8);
    assert.equal(JSON.parse(works[1].data).continuationSourceWorkId, family.budgetAnchorWorkId);
    const histories = await Promise.all(views.map(v => controller.getConversationHistory(v.conversationId)));
    assert.equal(new Set(histories.map(h => h.sessionManager.getSessionId())).size, 3);
    for (const history of histories) assert.ok(history.sessionManager.buildSessionProjection().messages.some(m => m.role === 'assistant'));
    const target = branch.conversationId, targetData = data(target), anchor = store.one('SELECT * FROM works WHERE id=?', family.budgetAnchorWorkId);
    await controller.queueConversationInput({ conversationId: target, expectedGeneration: controller.inspectConversation(target).generation, text: 'Must stay queued when original admission is unavailable', mode: 'idle' });
    const rejected = async pattern => {
        const before = store.one('SELECT COUNT(*) AS n FROM runs').n;
        await assert.rejects(controller.runConversation({ conversationId: target, ...models.conversationOperation(target) }), pattern);
        assert.equal(requests, 3); assert.equal(store.one('SELECT COUNT(*) AS n FROM runs').n, before);
    };
    store.run('UPDATE budgets SET lim=3 WHERE lineage=? AND kind=?', family.budgetLineage, 'execution');
    await rejected(/allowance exhausted/); store.run('UPDATE budgets SET lim=8 WHERE lineage=? AND kind=?', family.budgetLineage, 'execution');
    for (const state of ['UNKNOWN', 'CANCELLED']) { store.run('UPDATE works SET state=? WHERE id=?', state, anchor.id); await rejected(/recover original work/); }
    store.run('UPDATE works SET state=? WHERE id=?', anchor.state, anchor.id);
    const resolution = store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, 'resolution');
    store.run('UPDATE budgets SET reserved=? WHERE lineage=? AND kind=?', resolution.lim + 1, family.budgetLineage, 'resolution'); await rejected(/recover original budget/);
    store.run('UPDATE budgets SET reserved=? WHERE lineage=? AND kind=?', resolution.reserved, family.budgetLineage, 'resolution');
    store.run('DELETE FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, 'resolution'); await rejected(/recover original budget/);
    store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', resolution.lineage, resolution.kind, resolution.lim, resolution.consumed, resolution.reserved);
    for (const malformed of [null, false]) { write(target, { ...targetData, contextOrigin: malformed }); await rejected(/recover original record shape/); }
    write(target, { ...targetData, contextFamilyRoot: 'missing-family' }); await rejected(/recover original root reference/);
    const cycle = structuredClone(targetData); cycle.contextOrigin.sourceConversationId = target; write(target, cycle); await rejected(/recover original source conversation/);
    write(target, targetData);
    const originalRun = store.one('SELECT id,data FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1', anchor.id);
    store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(originalRun.data), cleanup: 'quarantined-fixture' }), originalRun.id);
    await rejected(/recover original quarantined work/); store.run('UPDATE runs SET data=? WHERE id=?', originalRun.data, originalRun.id);
    const work = works[2], workData = JSON.parse(work.data);
    store.run('UPDATE works SET lineage=? WHERE id=?', 'missing-lineage', work.id); await rejected(/retained work lineage/);
    store.run('UPDATE works SET lineage=? WHERE id=?', work.lineage, work.id);
    assert.deepEqual(JSON.parse(store.one('SELECT data FROM works WHERE id=?', work.id).data), workData);
    assert.equal(contextBinding(store, (await models.newConversation()).conversationId), null);
    assert.equal(store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, 'execution').consumed, 3);
    assert.equal(store.one('SELECT reserved FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, 'execution').reserved, 0);
    assert.equal(sockets, 0);
} finally { await controller.close(); }
console.log(JSON.stringify({ outcome: 'passed', syntheticRequests: requests, socketAttempts: sockets, registration: 'fixture metadata only', dispatch: 'actual Ordinary/original codec' }));

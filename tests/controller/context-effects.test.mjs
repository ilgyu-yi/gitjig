import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openController } from '../../dist/controller/index.js';
import { Effects } from '../../dist/controller/effects.js';
import { coordination } from '../../dist/controller/coordination.js';
import { admitContextWork, captureContextEffects, contextWorkContinuation } from '../../dist/controller/context-origin.js';

test('actual effect consumers preserve original grants, source capabilities and immutable context paths', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/context-effects-'))), source = path.join(root, 'project');
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'value.txt'), 'original pending baseline');
    const c = await openController({ installationHome: path.join(root, 'app') }), s = c.store;
    let effects, passed = false;
    t.after(async () => { await effects?.close(); await c.close(); if (passed) await fs.rm(root, { recursive: true, force: true }); else t.diagnostic('Retained failed context effect world: ' + root); });
    await c.registerProject({ id: 'P', sourceRoot: source });
    const create = () => c.createConversation({ projectId: 'P' }).conversationId, A = create();
    const state = cid => JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
    const setState = (cid, data, work = null) => s.run('UPDATE conversation_state SET data=?,work=? WHERE conversation=?', JSON.stringify(data), work, cid);
    const wdata = wid => JSON.parse(s.one('SELECT data FROM works WHERE id=?', wid).data);
    const setWork = (wid, data) => s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify(data), wid);
    // Actual Effects factory/Store/Interactions; only startup configuration and
    // finite local target descriptors are controlled. No Git adapter/send.
    s.run('INSERT INTO effect_targets VALUES(?,?,?)', 'local', 'P', JSON.stringify({kind:'local-git',target:{targetId:'local',canonicalPath:path.join(root,'recorded-local'),device:'1',inode:'10',ownerUid:process.getuid(),objectFormat:'sha1',ref:'refs/heads/main'},ownerUid:process.getuid(),basisCommit:'a'.repeat(40),publicationInventory:['input.txt'],authorizedDeltaPaths:['input.txt']}));
    s.run('INSERT INTO effect_targets VALUES(?,?,?)', 'work-only', 'P', JSON.stringify({kind:'local-git',target:{targetId:'work-only',canonicalPath:path.join(root,'recorded-work-only'),device:'1',inode:'11',ownerUid:process.getuid(),objectFormat:'sha1',ref:'refs/heads/main'},ownerUid:process.getuid(),basisCommit:'a'.repeat(40),publicationInventory:['input.txt'],authorizedDeltaPaths:['input.txt']}));
    const originalEffects = c.effects;
    effects = new Effects({ ...originalEffects.h, options: { ...originalEffects.h.options, effectDelegations: [{ targetId: 'local', projectId: 'P', operationLimit: 2 }] } });
    await originalEffects.close(); c.effectsCore = effects; // Configure before ACTUAL owner admission, never clear a captured profile flag.
    const pub = effects.publications;
    const pubTarget = pub.register({ projectId: 'P', visibility: 'public', target: { host: 'github.com', repositoryId: 9, repositoryNodeId: 'R9', owner: 'owner', repository: 'repo', actorUserId: 7 } }).targetId;
    pub.configureDelegations([{ targetId: pubTarget, actions: ['create-issue'], operationLimit: 2 }]);
    const begun = await c.beginChange({ projectId: 'P', request: 'Unreviewed owner baseline; no delivery claim' }), W = begun.workId;
    const delegation = { projectIds: ['P'], maxAssignments: 8, rootWorkId: W };
    setWork(W, { ...wdata(W), conversation: A, delegation });
    const family = cid => ({ version: 1, rootConversationId: cid, budgetAnchorWorkId: W, budgetLineage: W, delegationRootWorkId: W });
    setState(A, { contextFamilyRoot: A, contextFamily: family(A) }, W);
    effects.activateOwnerRoot(W); effects.activateOwnerRoot(W);
    assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_delegations').n, 2);
    const grant = effects.grant(W, 'local'), pubGrant = pub.grant(W, pubTarget, 'create-issue');
    effects.delegate({ workId: W, targetId: 'work-only', mode: 'ordinary', operationLimit: 1, scope: 'work' });
    assert.equal(captureContextEffects(s, A, W).ceiling, 'original-lineage');
    const originFor = (from, wid, familyRoot = A, override) => ({ version: 1, kind: 'clone', familyRoot, sourceConversationId: from, sourceGeneration: c.inspectConversation(from).generation,
        sourceWorkId: wid, sourceChoiceRevision: 0, sourceEventId: 'event-' + from + '-' + Math.random().toString(16).slice(2), effects: override ?? captureContextEffects(s, from, wid),
        continuation: state(from).contextOrigin?.continuation ?? (wid && s.one('SELECT work FROM change_state WHERE work=?', wid) ? { kind: 'governed', workId: wid } : { kind: 'ordinary-source', workId: wid ?? W }), delegationCeiling: delegation });
    const registerOrigin = (cid, origin) => {
        setState(cid, { contextFamilyRoot: origin.familyRoot, contextOrigin: origin });
        s.run('INSERT INTO sources VALUES(?,?,?,?)', origin.sourceEventId, cid, JSON.stringify({ kind: 'unexecuted-context-fixture', contextOrigin: origin }), 'Controlled origin, no successful procedure');
    };
    const admit = (cid, wid) => s.tx(() => {
        const prior = s.one('SELECT work FROM conversation_state WHERE conversation=?', cid).work;
        const context = admitContextWork(s, cid, wid, delegation);
        s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', wid, 'P', s.one('SELECT source FROM works WHERE id=?', W).source, prior, context.lineage, 'ACTIVE', 1, 1, null,
            JSON.stringify({ kind: 'ordinary-conversation', conversation: cid, delegation: context.delegation, ...context.metadata }));
        if (context.initializeBudgets) for (const kind of ['execution', 'resolution']) s.run('INSERT INTO budgets VALUES(?,?,8,0,0)', context.lineage, kind);
        setState(cid, state(cid), wid); return context;
    });
    const B = create(), bOrigin = originFor(A, W); registerOrigin(B, bOrigin); admit(B, 'B');
    const activeRoot = wdata(W);
    setWork(W, {...activeRoot, ownerRootActivation:{...activeRoot.ownerRootActivation,state:'PENDING'}});
    for (const subject of [W, 'B']) {
        assert.throws(() => effects.grantContext(subject), /activation is incomplete/);
        assert.throws(() => pub.grantContext(subject), /activation is incomplete/);
    }
    setWork(W, activeRoot);
    const rowsBeforeBranch = s.all('SELECT * FROM effect_delegations ORDER BY id');
    effects.activateOwnerRoot('B'); pub.activateOwnerRoot('B');
    assert.deepEqual(s.all('SELECT * FROM effect_delegations ORDER BY id'), rowsBeforeBranch);
    assert.equal(Object.hasOwn(wdata('B'), 'publicationDelegationCaptured'), false);
    assert.throws(() => effects.delegate({ workId: 'B', targetId: 'local', mode: 'ordinary', operationLimit: 2 }), /retained original owner/);
    assert.throws(() => pub.delegate({ workId: 'B', targetId: pubTarget, actions: ['create-issue'], operationLimit: 2 }), /retained original owner/);
    assert.equal(effects.grant('B', 'local').id, grant.id); assert.equal(pub.grant('B', pubTarget, 'create-issue').id, pubGrant.id);
    assert.throws(() => effects.grant('B', 'work-only'), /No actual current owner grant/);
    assert.equal(effects.grantContext('B').some(g => g.targetId === 'work-only'), false);
    const pubWorkTarget = pub.register({ projectId: 'P', visibility: 'public', target: { host: 'github.com', repositoryId: 10, repositoryNodeId: 'R10', owner: 'owner', repository: 'other', actorUserId: 7 } }).targetId;
    pub.delegate({ workId: W, targetId: pubWorkTarget, actions: ['create-issue'], operationLimit: 1, scope: 'work' });
    assert.equal(pub.grantContext('B').some(g => g.targetId === pubWorkTarget), false);
    assert.throws(() => pub.grant('B', pubWorkTarget, 'create-issue'), /Explicit current publication grant/);
    const I = create(), iOrigin = originFor(B, 'B'); registerOrigin(I, iOrigin); admit(I, 'I');
    assert.deepEqual(effects.ancestry('I'), ['I', 'B', W]);
    // This is the real finite ledger allocator with explicitly NON-evidence
    // input; it does not assert reviewed standing or call prepare/dispatch.
    const ledgerInput = { fixture: 'UNEXECUTED_LEDGER_INPUT_NOT_REVIEW_EVIDENCE' };
    effects.allocate('B', 'local', ledgerInput); effects.allocate('I', 'local', ledgerInput);
    assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n, 2);
    assert.equal(effects.grantContext('I').find(g => g.grantId === grant.id).remainingOperations, 0);
    assert.throws(() => effects.allocate('I', 'local', ledgerInput), /allowance exhausted/);
    // The real publication queue/count transaction, with an explicitly
    // controlled entry handle (NOT proof of a live native actor). No send.
    const identityFor = (cid, wid) => ({conversationId:cid,workId:wid,runId:'UNEXECUTED_TOKEN_FIXTURE',launchId:null,generation:0,directionRevision:0,initialInputId:'UNEXECUTED_INPUT'});
    const identities = new Map();
    const queuedIdentityFor = (cid, wid) => {
        const key = cid + ':' + wid;
        if (!identities.has(key)) {
            const runId = randomUUID(), initialInputId = randomUUID(), sourceId = randomUUID(), text = 'UNEXECUTED identity fixture; no model or review evidence';
            // Source admission provenance is required even for this controlled queue-only fixture.
            s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, cid, JSON.stringify({kind:'unexecuted-context-input'}), text);
            s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', initialInputId, cid, 1, wid, sourceId, 'HANDLED', 'prompt', text, '{}');
            s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, wid, 1, 1, 'SETTLED', root, 'released', JSON.stringify({kind:'ordinary-conversation',conversation:cid,initialInputId,raw:text,cleanup:'not-allocated'}));
            identities.set(key, {conversationId:cid,workId:wid,runId,launchId:null,generation:1,directionRevision:0,initialInputId});
        }
        return identities.get(key);
    };
    const oldHandle = effects.h.interactions.getHandle;
    try {
        effects.h.interactions.getHandle = cid => ({ identity: queuedIdentityFor(cid, s.one('SELECT work FROM conversation_state WHERE conversation=?', cid).work) });
        for (const [cid, wid] of [[I, 'I'], [B, 'B']]) pub.queue({ targetId: pubTarget, action: { kind: 'create-issue', title: 'Unreviewed fixture', body: 'Controlled queued bootstrap; no remote send' } }, queuedIdentityFor(cid, wid), () => {});
        assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', pubGrant.id).n, 2);
        const J = create(); registerOrigin(J, originFor(B, 'B')); admit(J, 'J');
        assert.throws(() => pub.queue({ targetId: pubTarget, action: { kind: 'create-issue', title: 'Another unreviewed fixture', body: 'No reset' } }, queuedIdentityFor(J, 'J'), () => {}), /limit exhausted/);
    } finally { effects.h.interactions.getHandle = oldHandle; }
    // Actual source role allocation: an owner view and reviewer view SHARE W.
    s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'strict-run', W, 1, 1, 'CREATED', root, 'reserved', JSON.stringify({ kind: 'governed-role', role: 'reviewer' }));
    s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'strict-launch', W, 'strict-run', 'reviewer', 1, 'CREATED', 'none', JSON.stringify({ stage: 'unexecuted-role-fixture' }));
    const strict = c.interactionCore.allocateRole({ workId: W, runId: 'strict-run', launchId: 'strict-launch', role: 'reviewer' });
    const strictCap = captureContextEffects(s, strict.conversationId, W, strict);
    assert.deepEqual(strictCap, { ceiling: 'none', sourceEpoch: 1 });
    assert.equal(captureContextEffects(s, A, W).ceiling, 'original-lineage');
    const ownerBefore = wdata(W); setWork(W, { ...ownerBefore, delegation: { ...delegation, maxAssignments: 0 } });
    assert.equal(captureContextEffects(s, A, W).ceiling, 'original-lineage'); setWork(W, ownerBefore);
    setState(strict.conversationId, { ...state(strict.conversationId), contextFamilyRoot: strict.conversationId, contextFamily: family(strict.conversationId) }, W);
    const N = create(), none = originFor(strict.conversationId, W, strict.conversationId, strictCap); registerOrigin(N, none); admit(N, 'N');
    assert.deepEqual(effects.ancestry('N'), ['N']); assert.deepEqual(effects.grantContext('N'), []); assert.deepEqual(pub.grantContext('N'), []);
    const NN = create(), inheritedNone = originFor(N, 'N', strict.conversationId); registerOrigin(NN, inheritedNone); admit(NN, 'NN');
    assert.equal(contextWorkContinuation(s, 'NN').effects, 'none'); assert.deepEqual(effects.ancestry('NN'), ['NN']);
    const investigationLaunches = [];
    const investigating = coordination({ store: s, interactions: c.interactionCore, identity: identityFor(N, 'N'), delegation,
        entry() {}, onWait() {}, launch(cid, assignmentId) { investigationLaunches.push({ cid, assignmentId }); } });
    const investigation = investigating.assign({ projectId: 'P', instructions: 'Controlled unstarted none-capability investigation', operation: 'investigate' });
    assert.equal(state(investigation.conversationId).contextOrigin.effects.ceiling, 'none');
    assert.equal(state(investigation.conversationId).contextOrigin.sourceWorkId, 'N'); assert.equal(investigationLaunches.length, 1);
    const E = create(), EF = create(); setState(E, { contextFamilyRoot: E, contextFamily: { version: 1, rootConversationId: E, budgetAnchorWorkId: null, budgetLineage: null, delegationRootWorkId: null } });
    const empty = { ...originFor(E, null, E), continuation: { kind: 'first-family-work' }, delegationCeiling: { ...delegation, rootWorkId: null } };
    registerOrigin(EF, empty); admit(EF, 'EMPTY'); assert.equal(contextWorkContinuation(s, 'EMPTY').effects, 'none'); assert.deepEqual(effects.ancestry('EMPTY'), ['EMPTY']);
    // A valid assignment must be checked BEFORE a none ceiling stops ancestry.
    s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'none-assignment', A, N, 'N', 'CANCELLED', JSON.stringify({ operation: 'investigate', source: { workId: W } }));
    const nBefore = wdata('N'); setWork('N', { ...nBefore, assignmentId: 'none-assignment' });
    assert.throws(() => effects.ancestry('N'), /Original admitted assignment unavailable/); setWork('N', nBefore);
    const identity = identityFor(I, 'I');
    s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', 'progress-assignment', B, I, 'I', 'QUEUED', JSON.stringify({ operation: 'investigate', source: identityFor(B, 'B') }));
    setWork('I', { ...wdata('I'), assignmentId: 'progress-assignment' });
    const token = effects.sourceToken(identity), pubToken = pub.origin(identity), rootToken = pub.ownerRoot(W);
    s.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'RUNNING', 'progress-assignment');
    assert.equal(effects.sourceToken(identity).contextFingerprint, token.contextFingerprint);
    assert.ok(token.contextFingerprint); assert.ok(effects.ownerToken('I').contextFingerprint); assert.ok(pub.ownerRoot('I').contextFingerprint);
    assert.equal(Object.hasOwn(effects.sourceToken({ ...identity, conversationId: A, workId: W }), 'contextFingerprint'), false);
    assert.equal(Object.hasOwn(pub.ownerRoot(W), 'contextFingerprint'), false);
    const guardOnly = { work: 'I', data: { subjectContextFingerprint: token.contextFingerprint } }; effects.validateOrigin(guardOnly);
    pub.checkOrigin({ work: 'I', data: { origin: pubToken, ownerRoot: rootToken } });
    const bBefore = wdata('B'), bState = state(B), bEvent = s.one('SELECT origin FROM sources WHERE id=?', bOrigin.sourceEventId).origin;
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({ ...JSON.parse(bEvent), kind: 'changed-retained-origin-event' }), bOrigin.sourceEventId);
    assert.throws(() => effects.validateOrigin(guardOnly), /subject context changed/);
    s.run('UPDATE sources SET origin=? WHERE id=?', bEvent, bOrigin.sourceEventId);
    const narrower = { ...bOrigin, effects: { ...bOrigin.effects, ceiling: 'none' } };
    setState(B, { ...bState, contextOrigin: narrower }, 'B'); setWork('B', { ...bBefore, contextOrigin: narrower, contextContinuation: { ...bBefore.contextContinuation, effects: 'none' } });
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({ kind: 'unexecuted-context-fixture', contextOrigin: narrower }), bOrigin.sourceEventId);
    assert.throws(() => effects.validateOrigin(guardOnly), /subject context changed/);
    assert.throws(() => pub.checkOrigin({ work: 'I', data: { origin: pubToken, ownerRoot: rootToken } }), /Original coordinator\/owner source changed/);
    setState(B, bState, 'B'); setWork('B', bBefore); s.run('UPDATE sources SET origin=? WHERE id=?', bEvent, bOrigin.sourceEventId);
    for (const damaged of [null, { ...bBefore.contextContinuation, sourceWorkId: 'missing' }]) { setWork('B', { ...bBefore, contextContinuation: damaged }); assert.throws(() => effects.activateOwnerRoot('B'), /retained effect continuation/); }
    setWork('B', bBefore);
    setState(B, { ...bState, contextOrigin: { ...bOrigin, sourceConversationId: B } }, 'B');
    assert.throws(() => effects.ancestry('I'), /source conversation|cyclic\/deep source chain/); setState(B, bState, 'B');
    const late = create(); registerOrigin(late, originFor(A, W)); const workCount = s.one('SELECT COUNT(*) AS n FROM works').n;
    s.run('UPDATE works SET epoch=epoch+1 WHERE id=?', W);
    assert.throws(() => admit(late, 'LATE'), /effect source epoch/); assert.equal(s.one('SELECT COUNT(*) AS n FROM works').n, workCount);
    assert.throws(() => effects.ancestry('I'), /effect source epoch/); s.run('UPDATE works SET epoch=1 WHERE id=?', W);
    assert.equal(effects.grant(W, 'local').id, grant.id);
    // CE-R1: the SAME original source CID creates a new ordinary W from an
    // unreviewed nonordinary predecessor. Real admission must retain that edge.
    const grantsBeforeRoot = s.all('SELECT * FROM effect_delegations ORDER BY id'), budgetsBeforeRoot = s.all('SELECT * FROM budgets ORDER BY lineage,kind');
    const next = admit(A, 'NEXT');
    assert.equal(next.lineage, W); assert.equal(next.initializeBudgets, false);
    assert.equal(contextWorkContinuation(s, 'NEXT').kind, 'family-source');
    assert.equal(contextWorkContinuation(s, 'NEXT').sourceWorkId, W);
    assert.equal(s.one('SELECT predecessor FROM works WHERE id=?', 'NEXT').predecessor, W);
    effects.activateOwnerRoot('NEXT'); pub.activateOwnerRoot('NEXT');
    assert.deepEqual(s.all('SELECT * FROM effect_delegations ORDER BY id'), grantsBeforeRoot);
    assert.deepEqual(s.all('SELECT * FROM budgets ORDER BY lineage,kind'), budgetsBeforeRoot);
    assert.equal(effects.grant('NEXT', 'local').id, grant.id); assert.equal(pub.grant('NEXT', pubTarget, 'create-issue').id, pubGrant.id);
    assert.throws(() => effects.allocate('NEXT', 'local', ledgerInput), /allowance exhausted/);
    assert.throws(() => effects.delegate({ workId: 'NEXT', targetId: 'local', mode: 'ordinary', operationLimit: 2 }), /retained original owner/);
    assert.throws(() => pub.delegate({ workId: 'NEXT', targetId: pubTarget, actions: ['create-issue'], operationLimit: 2 }), /retained original owner/);
    const nextRow = s.one('SELECT * FROM works WHERE id=?', 'NEXT'), nextBefore = wdata('NEXT');
    const reused = s.tx(() => admitContextWork(s, A, 'NEXT', delegation, nextRow));
    setWork('NEXT', { ...nextBefore, ...reused.metadata, delegation: reused.delegation });
    assert.deepEqual(contextWorkContinuation(s, 'NEXT'), nextBefore.contextContinuation);
    const nextToken = effects.sourceToken(identityFor(A, 'NEXT'));
    assert.ok(nextToken.contextFingerprint);
    setWork('NEXT', { ...nextBefore, contextContinuation: null }); assert.throws(() => effects.activateOwnerRoot('NEXT'), /retained effect continuation/);
    const { contextContinuation: removedEdge, ...withoutEdge } = nextBefore; setWork('NEXT', withoutEdge);
    assert.throws(() => effects.activateOwnerRoot('NEXT'), /missing retained family source/); setWork('NEXT', nextBefore);
    s.run('UPDATE works SET predecessor=NULL WHERE id=?', 'NEXT'); assert.throws(() => effects.ancestry('NEXT'), /family source continuation/); s.run('UPDATE works SET predecessor=? WHERE id=?', W, 'NEXT');
    const rootEvent = s.one('SELECT origin FROM sources WHERE id=?', removedEdge.sourceEventId).origin;
    s.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({ ...JSON.parse(rootEvent), targetWorkId: 'another-work' }), removedEdge.sourceEventId);
    assert.throws(() => effects.ancestry('NEXT'), /family source event\/epoch/); s.run('UPDATE sources SET origin=? WHERE id=?', rootEvent, removedEdge.sourceEventId);
    s.run('UPDATE works SET epoch=2 WHERE id=?', W); assert.throws(() => effects.ancestry('NEXT'), /family source event\/epoch/); s.run('UPDATE works SET epoch=1 WHERE id=?', W);
    setState(A, state(A), null); const beforeMissing = s.one('SELECT COUNT(*) AS n FROM sources').n;
    assert.throws(() => s.tx(() => admitContextWork(s, A, 'MISSING_PRIOR', delegation)), /missing original family source linkage/);
    assert.equal(s.one('SELECT COUNT(*) AS n FROM sources').n, beforeMissing); setState(A, state(A), 'NEXT');
    admit(A, 'NEXT2'); assert.deepEqual(effects.ancestry('NEXT2'), ['NEXT2', 'NEXT', W]);
    assert.equal(effects.grant('NEXT2', 'local').id, grant.id);
    const beforeRollback = s.one('SELECT COUNT(*) AS n FROM sources').n;
    assert.throws(() => s.tx(() => { admitContextWork(s, A, 'ROLLBACK', delegation); throw Error('controlled transaction rollback'); }), /controlled transaction rollback/);
    assert.equal(s.one('SELECT COUNT(*) AS n FROM sources').n, beforeRollback);
    // Branch-first budget claim is not an effect owner: E has NEVER owned W.
    assert.equal(s.one('SELECT work FROM conversation_state WHERE conversation=?', E).work, null);
    admit(E, 'FIRST_SOURCE'); assert.equal(contextWorkContinuation(s, 'FIRST_SOURCE'), null);
    const beforeLegacyActivation=s.all('SELECT * FROM effect_delegations ORDER BY id');effects.activateOwnerRoot('FIRST_SOURCE');assert.deepEqual(s.all('SELECT * FROM effect_delegations ORDER BY id'),beforeLegacyActivation,'Recordless ordinary fixture cannot receive fresh startup authority');assert.throws(()=>effects.grant('FIRST_SOURCE','local'),/grant|delegation/i);
    // A root strict-role view can become ordinary context only with NONE.
    admit(strict.conversationId, 'STRICT_NEXT'); assert.equal(contextWorkContinuation(s, 'STRICT_NEXT').effects, 'none');
    assert.deepEqual(effects.ancestry('STRICT_NEXT'), ['STRICT_NEXT']);
    const independent = await c.beginChange({ projectId: 'P', request: 'Genuinely independent blank owner entry' });
    effects.activateOwnerRoot(independent.workId);
    assert.notEqual(effects.grant(independent.workId, 'local').id, grant.id);
    t.diagnostic('Actual activation/delegate/admission/ancestry/ledger/token guards; controlled unstarted records and non-evidence ledger input, no reviewed delivery/remote/model/engine action');
    passed = true;
});

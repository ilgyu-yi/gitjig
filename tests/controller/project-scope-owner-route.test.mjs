import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {wireResponse} from '../pi/provider-wire-fixture.mjs';
import {openController} from '../../dist/controller/index.js';
import {ownerChangeRoute, ContextAssignmentUnavailable} from '../../dist/controller/context-coordination.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {readinessCommands} from '../../dist/ui/readiness-commands.js';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';

// One real unbound dialogue through the original codec; only model wire data is
// controlled. Managed drive below is deliberately not engine/model qualification.
test('root project transitions retain ordinary history without inventing a managed-work hold', {timeout: 20000}, async t => {
    const root = await temporaryDirectory('project-owner-route'), home = path.join(root, 'app');
    const c = await openController({installationHome: home, runtimeProfile: {
        dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE_SCOPE_ROUTE', image: 'sha256:' + '0'.repeat(64),
    }});
    const originalTemp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let passed = false, requests = 0;
    t.after(async () => {
        try {await c.close();} finally {
            if (originalTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTemp;
            if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained owner scope route: ' + root);
        }
    });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions');
        assert.equal(++requests, 1, 'Only original ordinary dialogue may request a response');
        assert.equal(JSON.parse(options.body).model, 'original');
        return wireResponse('openai-completions', 'original', {text: 'SYNTHETIC retained ordinary history'});
    });
    for (const id of ['P', 'Q']) {
        const directory = path.join(root, id); await fs.mkdir(directory, {mode: 0o700});
        await fs.writeFile(path.join(directory, 'source.txt'), 'Owned project ' + id);
        await c.registerProject({id, sourceRoot: directory});
    }
    const accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c);
    await accounts.configure({providers: {'scope-route': {api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'DUMMY_SCOPE_ROUTE', models: [{id: 'original'}]}}});
    await accounts.setDefault('scope-route', 'original'); models.install();
    const conversation = await models.newConversation(), cid = conversation.conversationId;
    await c.queueConversationInput({conversationId: cid, expectedGeneration: 0, text: 'An ordinary original with retained history', mode: 'idle'});
    const turn = await c.runConversation({conversationId: cid, ...models.conversationOperation(cid)});
    assert.equal(turn.status, 'delivered');
    const originalGeneration = c.inspectConversation(cid).generation;
    await c.reclaimConversationResource({conversationId: cid, expectedGeneration: originalGeneration});
    const original = turn.workId, history = await fs.readFile(c.inspectConversation(cid).historyRef);
    const clone = await c.forkConversation({kind: 'clone', conversationId: cid, expectedGeneration: originalGeneration, expectedModelRevision: c.getConversationModelChoice(cid).revision});
    const ledger = () => Object.fromEntries(['works', 'runs', 'budgets', 'conversation_inputs', 'capacity_leases', 'obligations'].map(table => [table, c.store.all('SELECT * FROM ' + table + ' ORDER BY rowid')]));
    const move = async (target, projectId) => {
        const before = c.inspectConversation(target);
        await c.reclaimConversationResource({conversationId: target, expectedGeneration: before.generation});
        c.setConversationProject({conversationId: target, expectedGeneration: before.generation, projectId});
    };
    await t.test('actual three-step owner transition supports read-only discovery and readiness', async () => {
        for (const project of ['P', 'Q', 'P']) await move(cid, project);
        const before = ledger();
        assert.equal(c.conversationChange(cid).workId, null);
        const route = ownerChangeRoute(c.store, cid, 'P'), proof = route.snapshot.receipts.find(row => row.kind === 'historical-owner-scope');
        assert.equal(proof.conversation.generation, originalGeneration + 3);
        assert.equal(proof.conversation.project, 'P');
        assert.equal(proof.transition.priorWorkId, original);
        assert.equal(JSON.parse(proof.source.origin).kind, 'owner-scope-transition');
        const rows = [];
        await new HostCommands(readinessCommands({controller: c, accounts, models, isCurrent: () => true,
            chooseItems: async (_title, items) => {rows.push(...items); return 'return-request';},
            execute: async () => assert.fail('Inspection dispatched an action'),
        })).execute('/ready', cid);
        assert.ok(rows.some(row => row.label.includes('Active runtime')));
        assert.deepEqual(ledger(), before);
        assert.deepEqual(await fs.readFile(c.inspectConversation(cid).historyRef), history);
    });
    const state = c.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid), data = JSON.parse(state.data);
    const source = c.store.one('SELECT * FROM sources WHERE id=?', data.scopeTransition.sourceId);
    const refuses = () => assert.throws(() => c.conversationChange(cid), error => error instanceof ContextAssignmentUnavailable && error.workId === original);
    for (const defect of ['missing', 'source-id', 'uid', 'raw', 'generation', 'cursor']) await t.test('unproven scope remains held: ' + defect, () => {
        try {
            const changed = structuredClone(data);
            if (defect === 'missing') delete changed.scopeTransition;
            if (defect === 'source-id') delete changed.scopeTransition.sourceId;
            if (defect === 'cursor') changed.scopeTransition.priorWorkId = randomUUID();
            if (['missing', 'source-id', 'cursor'].includes(defect)) c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify(changed), cid);
            if (defect === 'uid') c.store.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({...JSON.parse(source.origin), uid: (process.getuid?.() ?? 0) + 1}), source.id);
            if (defect === 'raw') c.store.run('UPDATE sources SET raw=? WHERE id=?', JSON.stringify({...data.scopeTransition, priorWorkId: randomUUID()}), source.id);
            if (defect === 'generation') c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?', cid);
            const before = ledger(); refuses(); assert.deepEqual(ledger(), before);
        } finally {
            c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', state.data, cid);
            c.store.run('UPDATE sources SET origin=?,raw=? WHERE id=?', source.origin, source.raw, source.id);
            c.store.run('UPDATE conversations SET generation=? WHERE id=?', data.scopeTransition.toGeneration, cid);
        }
    });
    for (const status of ['UNKNOWN', 'CANCELLED']) await t.test(status + ' original cleanup cannot become fresh work', () => {
        const old = c.store.one('SELECT state FROM works WHERE id=?', original).state;
        try {
            c.store.run('UPDATE works SET state=? WHERE id=?', status, original);
            assert.throws(() => c.conversationChange(cid), error => error.message === 'Context origin unavailable; recover original work ' + original);
        }
        finally {c.store.run('UPDATE works SET state=? WHERE id=?', old, original);}
    });
    await t.test('an inherited clone cannot use the root-owner exception', async () => {
        await move(clone.conversationId, 'P');
        assert.throws(() => c.conversationChange(clone.conversationId), error => error instanceof ContextAssignmentUnavailable && error.workId === original);
    });
    const choice = c.getConversationModelChoice(cid);
    const options = {conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedModelRevision: choice.revision,
        projectId: 'P', request: 'Explicit new governed owner intent', applicationModelBaseline: {
            ...await models.baseline('P', choice), source: {kind: 'conversation', conversationId: cid, choiceRevision: choice.revision},
        }};
    await t.test('actual admission binds a valid-looking replacement transition event into its fingerprint', async () => {
        const begin = c.changes.begin.bind(c.changes), before = ledger();
        c.changes.begin = async (...args) => {
            c.store.run('UPDATE sources SET origin=? WHERE id=?', JSON.stringify({...JSON.parse(source.origin), event: randomUUID()}), source.id);
            return begin(...args);
        };
        try {await assert.rejects(c.startConversationChange(options), /original continuation changed before admission/); assert.deepEqual(ledger(), before);}
        finally {c.changes.begin = begin; c.store.run('UPDATE sources SET origin=? WHERE id=?', source.origin, source.id);}
    });
    let managedWork;
    await t.test('explicit managed admission retains predecessor, family spend and delegation without model or engine drive', async () => {
        let driven;
        c.changes.drive = async input => {driven = input; return c.inspectChange(input.workId);};
        const work = await c.startConversationChange(options), row = c.store.one('SELECT * FROM works WHERE id=?', work.workId);
        managedWork = work.workId;
        assert.equal(row.predecessor, original); assert.equal(row.lineage, original);
        assert.equal(c.conversationChange(cid).workId, work.workId);
        assert.equal(c.store.one('SELECT consumed FROM budgets WHERE lineage=? AND kind=?', original, 'execution').consumed, 2);
        assert.equal(JSON.parse(row.data).ownerRootActivation, undefined);
        assert.equal(driven.workId, work.workId);
        assert.equal(requests, 1);
    });
    await t.test('a retained governed original in another project stays identified and held', async () => {
        const before = ledger();
        await assert.rejects(move(cid, 'Q'), error => error.message.includes('LIFECYCLE_HELD: governed:' + managedWork));
        assert.equal(c.inspectConversation(cid).projectId, 'P');
        assert.throws(() => ownerChangeRoute(c.store, cid, 'Q'), error => error instanceof ContextAssignmentUnavailable && error.workId === managedWork);
        assert.equal(c.conversationChange(cid).workId, managedWork);
        assert.deepEqual(ledger(), before);
    });
    for (const locale of ['en', 'ko']) for (const state of ['ACTIVE', 'UNKNOWN']) await t.test('original ' + state + ' governed project hold has actionable ' + locale + ' guidance without mutation', async () => {
        const originalState = c.store.one('SELECT state FROM works WHERE id=?', managedWork).state;
        c.store.run('UPDATE works SET state=? WHERE id=?', state, managedWork);
        try {
        const before = ledger(), view = c.inspectConversation(cid);
        const registry = new HostCommands(projectCommands({controller: c, hostLanguage: locale, isCurrent: () => true,
            notice: () => assert.fail('Held change cannot announce success'), refresh: async () => assert.fail('Held change cannot refresh'),
            input: async () => undefined, choose: async () => undefined}));
        await assert.rejects(registry.execute('/project Q', cid), error => {
            assert.equal(error.code, 'PROJECT_WORK_PENDING');
            assert.equal(error.workId, managedWork);
            assert.ok(error.message.includes(state === 'UNKNOWN' ? (locale === 'ko' ? '상태 확인' : 'reconciliation') : (locale === 'ko' ? '완료되지 않은 작업' : 'unfinished work')));
            assert.ok(error.recovery.includes('/work ' + managedWork));
            assert.ok(error.recovery.includes('/new root'));
            assert.ok(error.recovery.includes('LIFECYCLE_HELD: governed:' + managedWork));
            return true;
        });
        assert.deepEqual(c.inspectConversation(cid), view);
        assert.deepEqual(ledger(), before);
        assert.deepEqual(await fs.readFile(c.inspectConversation(cid).historyRef), history);
        assert.equal(requests, 1);
        } finally {c.store.run('UPDATE works SET state=? WHERE id=?', originalState, managedWork);}
    });
    await t.test('unrelated and mismatched hold diagnostics retain their original identity', async () => {
        const reclaim = c.reclaimConversationResource.bind(c), before = ledger();
        const registry = new HostCommands(projectCommands({controller: c, isCurrent: () => true, notice() {}, refresh: async () => {},
            input: async () => undefined, choose: async () => undefined}));
        try {
            for (const message of ['LIFECYCLE_HELD: run:other:UNKNOWN', 'LIFECYCLE_HELD: governed:other:BASE_CAPTURED',
                'LIFECYCLE_HELD: governed:' + managedWork + ':WRONG_PHASE', 'PROJECT_SCOPE_UNAVAILABLE: governed:' + managedWork + ':BASE_CAPTURED']) {
                const original = Error(message);
                c.reclaimConversationResource = async () => {throw original;};
                await assert.rejects(registry.execute('/project Q', cid), error => error === original);
                assert.deepEqual(ledger(), before);
            }
        } finally {c.reclaimConversationResource = reclaim;}
    });
    passed = true;
});

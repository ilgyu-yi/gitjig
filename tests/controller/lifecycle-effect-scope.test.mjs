import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';

async function fixture(t) {
    const root = await temporaryDirectory('lifecycle-effect-scope');
    const home = path.join(root, 'home');
    let controller = await openController({installationHome: home});
    for (const id of ['P', 'Q']) {
        const sourceRoot = path.join(root, id);
        await fs.mkdir(sourceRoot, {mode: 0o700});
        await controller.registerProject({id, sourceRoot});
    }
    const selected = controller.createConversation({projectId: 'P'});
    const foreign = controller.createConversation({projectId: 'P'});
    // Synthetic retained records exercise lifecycle isolation, not native success.
    const work = (id, conversation) => {
        controller.store.run('INSERT INTO sources VALUES(?,?,?,?)', 'S-' + id, conversation, '{}', 'Controlled retained lifecycle record');
        controller.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', id, null, 'S-' + id, null, id, 'ACTIVE', 1, 1, null, JSON.stringify({kind: 'ordinary-conversation', conversation}));
    };
    work('selected-work', selected.conversationId);
    work('foreign-work', foreign.conversationId);
    controller.store.run('INSERT INTO effect_targets VALUES(?,?,?)', 'T', null, '{}');
    for (const id of ['selected-work', 'foreign-work'])
        controller.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', 'G-' + id, id, 'T', 1, '{}');
    t.after(async () => { await controller.close(); await fs.rm(root, {recursive: true, force: true}); });
    return {
        get c() { return controller; }, selected, foreign,
        async reopen() { await controller.close(); controller = await openController({installationHome: home}); },
        operation(id, data, {work = 'foreign-work', grant = 'G-' + work, phase = 'UNKNOWN'} = {}) {
            controller.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, work, 'T', grant, phase, data);
        },
        reclaim() { return controller.reclaimConversationResource({conversationId: selected.conversationId, expectedGeneration: controller.inspectConversation(selected.conversationId).generation}); },
        project(id) { return controller.setConversationProject({conversationId: selected.conversationId, expectedGeneration: controller.inspectConversation(selected.conversationId).generation, projectId: id}); },
    };
}

test('unrelated unreadable effects do not obstruct public reclaim or project switch, including after reopen', async t => {
    const f = await fixture(t);
    assert.equal((await f.reclaim()).outcome, 'absent');
    for (const [index, data] of ['{', 'null', '[]', '17', '"text"'].entries())
        f.operation('foreign-' + index, data);
    f.operation('confirmed', '{', {work: 'selected-work', phase: 'CONFIRMED'});
    const before = f.c.store.all('SELECT * FROM effect_operations ORDER BY id');
    for (const project of ['Q', 'P']) {
        assert.equal((await f.reclaim()).outcome, 'absent');
        f.project(project);
        assert.equal(f.c.inspectConversation(f.selected.conversationId).projectId, project);
        assert.deepEqual(f.c.store.all('SELECT * FROM effect_operations ORDER BY id'), before);
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n, 0);
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM capacity_leases').n, 0);
        await f.reopen();
    }
});

test('own unreadable effects and child operations under the original owner grant retain named holds', async t => {
    const f = await fixture(t);
    for (const data of ['{', 'null', '[]', '17', '"text"']) {
        f.operation('own', data, {work: 'selected-work'});
        await assert.rejects(f.reclaim(), /LIFECYCLE_HELD: effect:own:unavailable/);
        f.c.store.run('DELETE FROM effect_operations WHERE id=?', 'own');
    }
    f.operation('child', '{', {grant: 'G-selected-work'});
    await assert.rejects(f.reclaim(), /LIFECYCLE_HELD: effect:child:unavailable/);
    await f.reopen();
    await assert.rejects(f.reclaim(), /LIFECYCLE_HELD: effect:child:unavailable/);
    assert.equal(f.c.store.one('SELECT data FROM effect_operations WHERE id=?', 'child').data, '{');
});

test('original origin and ownerRoot identity preserve UNKNOWN holds independently of work ownership', async t => {
    const f = await fixture(t);
    for (const data of [{origin: {identity: {conversationId: f.selected.conversationId}}}, {ownerRoot: {conversationId: f.selected.conversationId}}]) {
        f.operation('related', JSON.stringify(data));
        await assert.rejects(f.reclaim(), /LIFECYCLE_HELD: effect:related:UNKNOWN/);
        f.c.store.run('DELETE FROM effect_operations WHERE id=?', 'related');
    }
});

test('related cancellation and no-handoff exceptions require readable original receipt evidence', async t => {
    const f = await fixture(t);
    f.c.store.run('UPDATE works SET state=? WHERE id=?', 'CANCELLED', 'selected-work');
    f.operation('refused', JSON.stringify({rootEpoch: 1, dispatchRun: 'original-run'}), {work: 'selected-work', phase: 'REFUSED'});
    await assert.rejects(f.reclaim(), /effect:refused:REFUSED/);
    f.c.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', 'receipt', 'refused', 'send', '{');
    await assert.rejects(f.reclaim(), /effect:refused:unavailable/);
    f.c.store.run('UPDATE effect_receipts SET data=? WHERE id=?', 'null', 'receipt');
    await assert.rejects(f.reclaim(), /effect:refused:unavailable/);
    f.c.store.run('UPDATE effect_receipts SET data=? WHERE id=?', JSON.stringify({handoff: 'started'}), 'receipt');
    await assert.rejects(f.reclaim(), /effect:refused:REFUSED/);
    f.c.store.run('UPDATE effect_receipts SET data=? WHERE id=?', JSON.stringify({handoff: 'not-started'}), 'receipt');
    assert.equal((await f.reclaim()).outcome, 'absent');
    f.operation('configuration', JSON.stringify({kind: 'configuration', steps: [{state: 'UNKNOWN'}]}), {work: 'selected-work', phase: 'CANCELLED'});
    await assert.rejects(f.reclaim(), /effect:configuration:CANCELLED/);
    f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?', JSON.stringify({kind: 'configuration', steps: [null]}), 'configuration');
    await assert.rejects(f.reclaim(), /effect:configuration:unavailable/);
    f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?', JSON.stringify({kind: 'configuration', steps: [{state: 'CONFIRMED'}]}), 'configuration');
    assert.equal((await f.reclaim()).outcome, 'absent');
});


test('original publication and configuration recovery keeps possible handoff UNKNOWN beside unreadable neighbors', async t => {
    const f = await fixture(t);
    const {configureOwnedPublicationFixture, configureOwnedRepositoryConfigurationFixture} = await import('../../.qualification/controller-testing.js');
    const {publicationServer, target, issue} = await import('./publication-fixture.mjs');
    const {configurationServer, configurationTarget, configurationProfile} = await import('./configuration-fixture.mjs');
    const publication = await publicationServer(), configuration = await configurationServer();
    t.after(async () => { await publication.close(); await configuration.close(); });
    const pt = f.c.registerPublicationTarget({target, visibility: 'public'});
    configureOwnedPublicationFixture(f.c, {origin: publication.origin, token: 'fixture-original'});
    const prepared = await f.c.prepareOwnerPublication({targetId: pt.targetId, action: issue()});
    const ct = f.c.registerRepositoryConfigurationTarget({target: configurationTarget});
    configureOwnedRepositoryConfigurationFixture(f.c, {origin: configuration.origin, token: 'fixture-original'});
    const preview = await f.c.previewRepositoryConfiguration({targetId: ct.targetId, profile: configurationProfile()});
    // Complete original preparations, with controlled interrupted phase premises;
    // no claim that a native write actually happened.
    f.c.store.run('UPDATE effect_operations SET phase=? WHERE id=?', 'INVOKING', prepared.operationId);
    f.c.store.run('UPDATE effect_operations SET phase=? WHERE id=?', 'APPLYING', preview.planId);
    f.operation('unreadable', '{');
    const budgets = f.c.store.all('SELECT * FROM budgets ORDER BY lineage,kind');
    const runs = f.c.store.all('SELECT * FROM runs ORDER BY id');
    const requests = [publication.requests.length, configuration.requests.length];
    await f.reopen();
    for (const id of [prepared.operationId, preview.planId])
        assert.equal(f.c.store.one('SELECT phase FROM effect_operations WHERE id=?', id).phase, 'UNKNOWN');
    assert.equal(f.c.store.one('SELECT data FROM effect_operations WHERE id=?', 'unreadable').data, '{');
    assert.deepEqual(f.c.store.all('SELECT * FROM budgets ORDER BY lineage,kind'), budgets);
    assert.deepEqual(f.c.store.all('SELECT * FROM runs ORDER BY id'), runs);
    assert.deepEqual([publication.requests.length, configuration.requests.length], requests);
    assert.equal((await f.reclaim()).outcome, 'absent');
});

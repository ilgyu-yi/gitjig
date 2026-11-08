import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { criteriaWorld } from './criteria-refresh-fixture.mjs';
import {seedPlanningFailure} from './planning-failure-fixture.mjs';
import {changeResultText} from '../../dist/ui/change-result.js';
import {uiText} from '../../dist/ui/i18n.js';

function fullLedger(c) {
    return Object.fromEntries(c.store.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map(({name}) => [name, c.store.all('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid')]));
}

test('hash-only criteria reads detect changed contents with the same size and timestamps', async t => {
    const f = await criteriaWorld(t);
    const {loadCriteria, loadCriteriaSync, loadCriteriaHashSync} =
        await import(pathToFileURL(path.join(f.payload, 'dist/controller/criteria.js')).href);
    const file = path.join(f.payload, 'DESIGN.md'), original = await fs.readFile(file, 'utf8');
    const stamped = new Date(Math.floor(Date.now() / 1000) * 1000);
    await fs.utimes(file, stamped, stamped);
    const baseline = loadCriteriaSync(), oldHash = loadCriteriaHashSync();
    assert.equal(oldHash, baseline.hash);
    baseline.assets['DESIGN.md'].selected = 'Caller-owned copy';
    assert.equal(loadCriteriaHashSync(), oldHash);
    assert.notEqual(loadCriteriaSync().assets['DESIGN.md'].selected, 'Caller-owned copy');

    const changed = original.replace('## D2.', '## X2.');
    assert.notEqual(changed, original);
    const rewrite = async text => {
        await fs.writeFile(file, text);
        await fs.utimes(file, stamped, stamped);
        const stat = await fs.stat(file);
        assert.equal(stat.size, Buffer.byteLength(original));
        assert.equal(stat.mtimeMs, stamped.getTime());
    };
    await rewrite(changed);
    assert.throws(loadCriteriaHashSync, /missing\/duplicate: D2/);
    await rewrite(original.replace(/^#/u, ' '));
    const current = await loadCriteria();
    assert.notEqual(current.hash, oldHash);
    assert.equal(loadCriteriaHashSync(), current.hash);
    assert.equal(loadCriteriaSync().hash, current.hash);
    await rewrite(original);
    assert.equal(loadCriteriaHashSync(), oldHash);
    f.pass();
});

test('malformed current rules direct restoration and preserve the loader diagnostic', async t => {
    const f = await criteriaWorld(t), c = f.c;
    await fs.writeFile(path.join(f.payload,'CONTRACTS.md'),'Incomplete rules\n');
    const before = fullLedger(c);
    const view = c.inspectChange(f.workId), result = c.inspectChangeResult(f.workId), recovery = c.inspectWorkRecovery(f.workId);
    assert.equal(view.workflowCriteriaHold,'unavailable');
    assert.equal(recovery.recoveryHold.workflowCriteriaHold,'unavailable');
    assert.equal(result.workflowCriteriaHold,'unavailable');
    assert.match(view.nextAction,/Restore exact owned workflow rule definitions/);
    assert.doesNotMatch(view.nextAction,/refresh-criteria/);
    assert.match(result.blocked[0],/Required owned workflow criteria section missing\/duplicate/);
    for (const locale of ['en','ko']) {
        const text = changeResultText(result,locale);
        const heading = uiText(locale,'criteria.recovery.unavailable');
        assert.ok(text.includes(heading));
        assert.ok(text.includes(uiText(locale,'criteria.recovery.unavailableAction')));
        assert.ok(text.indexOf(result.blocked[0]) > text.indexOf(heading));
        assert.ok(!text.includes(uiText(locale,'criteria.entry')));
    }
    assert.deepEqual(fullLedger(c),before);
    f.pass();
});

for (const exhausted of [[], ['execution'], ['resolution'], ['execution', 'resolution']])
test('refreshed planning entry explains retained diagnosis and ' + (exhausted.join('/') || 'available') + ' allowance without execution', async t => {
    const f = await criteriaWorld(t), c = f.c;
    const original = seedPlanningFailure(c, f.workId);
    const lineage = c.store.one('SELECT lineage FROM works WHERE id=?', f.workId).lineage;
    for (const kind of exhausted) c.store.run('UPDATE budgets SET consumed=lim WHERE lineage=? AND kind=?', lineage, kind);
    await f.change();
    const snapshot = f.snapshot();
    await c.refreshChangeCriteria({workId:f.workId, expectedEpoch:snapshot.epoch, expectedFingerprint:snapshot.fingerprint,
        reason:'Review current rules while retaining the original failed producer and finite allowance'});
    let modelSelections = 0, allocations = 0;
    c.changeCore.selectRoleModel = async () => { modelSelections++; assert.fail('Inspection must not resolve a model'); };
    c.changeCore.h.acquireCapacity = async () => { allocations++; assert.fail('Inspection must not allocate an execution'); };
    const before = fullLedger(c), view = c.inspectChange(f.workId), result = c.inspectChangeResult(f.workId), summary = c.inspectWorkRecovery(f.workId);
    assert.equal(view.recordedPhase, 'BASE_CAPTURED'); assert.equal(view.phase, 'BLOCKED'); assert.equal(view.reviewReady, false);
    assert.match(view.nextAction, /retained producer failure/); assert.match(view.nextAction, new RegExp('/change resume ' + f.workId));
    assert.doesNotMatch(view.nextAction, /planChange/);
    for (const kind of ['execution', 'resolution']) {
        assert.equal(view.nextAction.includes('Extend shared ' + kind + ' allowance'), exhausted.includes(kind));
        if (exhausted.includes(kind)) assert.ok(view.nextAction.indexOf('Extend shared ' + kind + ' allowance') < view.nextAction.indexOf('/change resume'));
    }
    assert.equal(summary.nextAction, view.nextAction); assert.equal(result.nextAction, view.nextAction);
    assert.equal(view.planningFailure, undefined, 'The old epoch diagnosis does not become a current producer attribution');
    await assert.rejects(c.planChange({workId:f.workId}), /explicit drive\/resume recovery/);
    assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?', 'diagnostic-' + original.launch).data).state, 'pending');
    assert.equal(modelSelections, 0); assert.equal(allocations, 0); assert.deepEqual(fullLedger(c), before);
    for (const state of ['UNKNOWN', 'CANCELLED']) {
        c.store.run('UPDATE works SET state=? WHERE id=?', state, f.workId);
        const held = c.inspectChange(f.workId);
        assert.equal(c.inspectWorkRecovery(f.workId).nextAction, held.nextAction);
        assert.doesNotMatch(held.nextAction, /Extend shared/);
        if (state === 'UNKNOWN') assert.match(held.nextAction, /original execution ownership/);
    }
    c.store.run('UPDATE works SET state=? WHERE id=?', 'ACTIVE', f.workId);
    await f.change('PRINCIPLES.md', '\nAnother owned clarification requires review before recovery.\n');
    const held = c.inspectChange(f.workId);
    assert.match(held.nextAction, /refresh-criteria/); assert.doesNotMatch(held.nextAction, /Extend shared/);
    assert.equal(c.inspectWorkRecovery(f.workId).nextAction, held.nextAction);
    assert.equal(modelSelections, 0); assert.equal(allocations, 0);
    f.pass();
});

for (const unavailable of ['consumed', 'reserved']) {
    test(`planning with all resolution allowance ${unavailable} admits no planner`, async t => {
        const f = await criteriaWorld(t), c = f.c;
        const lineage = c.store.one('SELECT lineage FROM works WHERE id=?', f.workId).lineage;
        c.store.run(`UPDATE budgets SET ${unavailable}=lim WHERE lineage=? AND kind='resolution'`, lineage);
        const before = f.ledger();
        assert.deepEqual(c.inspectChangeContinuationPrerequisites(f.workId), {
            stage:'plan', roles:['planner','challenger','adjudicator'], allowanceHold:'resolution',
        });
        assert.deepEqual(c.changeCore.inspectAssignmentAllowance(f.workId, false).exhausted, ['resolution']);
        c.changeCore.selectRoleModel = async () => assert.fail('Planning selected a role without allowance for adjudication');
        const result = await c.planChange({workId:f.workId});
        assert.equal(result.phase,'BLOCKED');
        assert.match(result.blocked.join('\n'),/Resolution allowance exhausted/);
        const after = f.ledger();
        for (const key of ['budgets', 'runs', 'obligations']) assert.deepEqual(after[key], before[key], key);
        c.store.run(`UPDATE budgets SET ${unavailable}=lim-1 WHERE lineage=? AND kind='resolution'`, lineage);
        assert.equal(c.inspectChangeContinuationPrerequisites(f.workId).allowanceHold,undefined);
        f.pass();
    });
}

test('reviewed owner criteria refresh keeps original identity, candidate, history, purpose and spend without a native run', async t => {
    const f = await criteriaWorld(t), c = f.c;
    const row = c.changeCore.row(f.workId), base = c.changeCore.version(row.base);
    // Controlled selection metadata over actual captured bytes; no acceptance claim.
    const candidate = c.changeCore.newVersion(f.workId, 'candidate', base.artifact, base.data, base.hash, base.id);
    const plan = c.changeCore.newVersion(f.workId, 'plan', null, { fixture: 'Controlled old selector only' }, 'a'.repeat(64));
    const verification = c.changeCore.newVersion(f.workId, 'verification', null, { fixture: 'Controlled old selector only' }, 'b'.repeat(64));
    c.store.run('UPDATE change_state SET candidate=?,plan=?,verification=? WHERE work=?', candidate, plan, verification, f.workId);
    await f.change(); const reviewed = f.snapshot(), before = f.ledger();
    assert.equal(reviewed.eligible, true); assert.equal(reviewed.assets.find(asset => asset.name === 'DESIGN.md').selectedChanged, true);
    let guards = 0;
    const result = await c.refreshChangeCriteria({ workId: f.workId, expectedEpoch: reviewed.epoch, expectedFingerprint: reviewed.fingerprint, reason: 'Owner reviews exact selected definitions' }, () => { guards++; });
    const after = f.ledger(), fresh = f.snapshot(); assert.ok(guards >= 3);
    assert.equal(result.workId, f.workId); assert.equal(result.epoch, reviewed.epoch + 1); assert.equal(result.phase, 'BASE_CAPTURED'); assert.equal(result.reviewReady, false);
    assert.equal(result.candidateVersion, candidate); assert.equal(result.planVersion, null); assert.equal(result.verificationVersion, null);
    assert.equal(fresh.previousHash, reviewed.currentHash); assert.notEqual(fresh.fromContractsVersion, reviewed.fromContractsVersion); assert.equal(fresh.changed, false);
    for (const table of ['budgets', 'runs', 'goals', 'obligations']) assert.deepEqual(after[table], before[table], table);
    assert.equal(c.changeCore.version(reviewed.fromContractsVersion).hash, reviewed.previousHash);
    const event = c.store.one("SELECT * FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'");
    assert.equal(event.raw, 'Owner reviews exact selected definitions'); assert.equal(JSON.parse(event.origin).fromContractsVersion, reviewed.fromContractsVersion);
    assert.equal(JSON.parse(c.store.one('SELECT data FROM works WHERE id=?', f.workId).data).request, JSON.parse(before.works[0].data).request);
    assert.equal(await fs.readFile(path.join(f.root, 'project/file.txt'), 'utf8'), 'Original owner bytes'); f.pass();
});

test('snapshot distinguishes full-file provenance changes from selected rule text changes', async t => {
    const f = await criteriaWorld(t);
    await f.change('CONTRACTS.md'); const snapshot = f.snapshot(), asset = snapshot.assets.find(asset => asset.name === 'CONTRACTS.md');
    assert.equal(snapshot.changed, true); assert.equal(asset.provenanceChanged, true); assert.equal(asset.selectedChanged, false);
    assert.equal(asset.previousSelected, asset.currentSelected); assert.notEqual(asset.previousSha256, asset.currentSha256); f.pass();
});

for (const drift of ['work', 'model-baseline', 'selected-version', 'assets-final', 'owner-close']) test('final reviewed criteria refresh refuses ' + drift + ' drift atomically', async t => {
    const f = await criteriaWorld(t); await f.change(); const reviewed = f.snapshot(), before = f.ledger(); let calls = 0;
    const refresh = f.c.refreshChangeCriteria({ workId: f.workId, expectedFingerprint: reviewed.fingerprint, reason: 'Stale reviewed change must refuse' }, () => {
        if (++calls !== 3) return;
        if (drift === 'work') f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?', f.workId);
        if (drift === 'model-baseline') f.c.store.run("UPDATE works SET data=json_set(data,'$.applicationModelBaseline',json('{}')) WHERE id=?", f.workId);
        if (drift === 'selected-version') f.c.store.run('UPDATE change_state SET base=NULL WHERE work=?', f.workId);
        if (drift === 'assets-final') fsSync.appendFileSync(path.join(f.payload, 'DESIGN.md'), '\nChanged after final callback\n');
        if (drift === 'owner-close') throw new Error('Owned UI source closed');
    });
    await assert.rejects(refresh, /changed|baseline|closed|model/i); assert.equal(calls, 3); assert.deepEqual(f.ledger(), before); f.pass();
});

test('rule changes after the awaited native file read refuse even for the original CLI-style refresh', async t => {
    const f = await criteriaWorld(t); await f.change(); const before = f.ledger(), read = fs.readFile; let injected = false;
    fs.readFile = async function(file, ...args) {
        const bytes = await read.call(this, file, ...args);
        if (!injected && String(file).endsWith('/payload/CONTRACTS.md')) { injected = true; await fs.appendFile(path.join(f.payload, 'PRINCIPLES.md'), '\nChanged after async read\n'); }
        return bytes;
    };
    try { await assert.rejects(f.c.refreshChangeCriteria({ workId: f.workId, reason: 'Explicit CLI owner refresh' }), /input changed/); }
    finally { fs.readFile = read; }
    assert.equal(injected, true); assert.deepEqual(f.ledger(), before); f.pass();
});

test('no-op still checks the exact reviewed source inside commit and rejects asynchronous guards', async t => {
    const f = await criteriaWorld(t), reviewed = f.snapshot(), before = f.ledger(); let calls = 0;
    await assert.rejects(f.c.refreshChangeCriteria({ workId: f.workId, expectedFingerprint: reviewed.fingerprint, reason: 'No-op is still guarded' }, () => { if (++calls === 3) throw new Error('Late owner source changed'); }), /source changed/);
    assert.equal(calls, 3); assert.deepEqual(f.ledger(), before);
    await assert.rejects(f.c.refreshChangeCriteria({ workId: f.workId, reason: 'No async validation' }, async () => {}), /Synchronous owner/);
    await assert.rejects(f.c.refreshChangeCriteria({ workId: f.workId, reason: 'Rejected async validation is observed' }, async () => { throw new Error('Owned asynchronous guard rejection'); }), /Synchronous owner/);
    const result = await f.c.refreshChangeCriteria({ workId: f.workId, expectedFingerprint: reviewed.fingerprint, reason: 'Already current' });
    assert.equal(result.epoch, reviewed.epoch); assert.deepEqual(f.ledger(), before); f.pass();
});

test('two prepared reviews cannot both refresh the same original work', async t => {
    const f = await criteriaWorld(t); await f.change(); const reviewed = f.snapshot(), before = f.ledger();
    const results = await Promise.allSettled(['First owned reason', 'Competing owned reason'].map(reason => f.c.refreshChangeCriteria({ workId: f.workId, expectedFingerprint: reviewed.fingerprint, reason })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(f.snapshot().epoch, reviewed.epoch + 1);
    assert.equal(f.c.store.one("SELECT COUNT(*) n FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'").n, 1);
    const after = f.ledger(); for (const table of ['budgets', 'runs', 'goals', 'obligations']) assert.deepEqual(after[table], before[table]); f.pass();
});

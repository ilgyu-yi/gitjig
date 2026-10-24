import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { criteriaWorld } from './criteria-refresh-fixture.mjs';

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

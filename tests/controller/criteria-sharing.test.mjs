import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaWorld} from './criteria-refresh-fixture.mjs';

test('current Controller bundle retains full old/current criteria without repeating their unchanged clauses', async t => {
    const f = await criteriaWorld(t);
    const {restorePreviousCriteriaText} = await import(new URL('../../dist/workflow/criteria-text.js', import.meta.url));
    const prior = f.c.changes.version(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?', f.workId).data).contractsVersion);
    await f.change('PRINCIPLES.md', '\nPrior and current intent remain separate; this is a controlled owned revision.\n');
    await f.c.refreshChangeCriteria({workId: f.workId, reason: 'Inspect exact lossless criteria assembly'});
    const before = f.ledger();
    for (const role of ['planner', 'challenger', 'adjudicator']) {
        const stage = role === 'planner' ? 'planning' : role === 'challenger' ? 'planning-challenge' : 'planning-adjudication';
        const body = await f.c.changes.bundle(f.workId, {stage}, role);
        const refresh = body.context.criteriaRefresh, current = f.c.changes.version(refresh.toContractsVersion);
        assert.equal(body.contracts, current.data.text);
        assert.equal(restorePreviousCriteriaText(refresh.previous.text, body.contracts), prior.data.text);
        assert.equal(refresh.previous.hash, prior.hash);
        assert.equal(refresh.current.hash, current.hash);
        for (const [side, version] of [['previous', prior], ['current', current]])
            for (const [name, asset] of Object.entries(version.data.assets)) assert.deepEqual(refresh[side].assets[name], {sha256: asset.sha256});
        assert.equal(refresh.current.text, undefined);
        assert.equal(typeof refresh.previous.text, 'object');
        assert.ok(Buffer.byteLength(JSON.stringify(refresh.previous.text)) < Buffer.byteLength(prior.data.text) / 4);
        assert.deepEqual(f.ledger(), before);
    }
    f.pass();
});

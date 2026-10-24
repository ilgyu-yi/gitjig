import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { criteriaWorld } from '../controller/criteria-refresh-fixture.mjs';
import { workCommands } from '../../dist/ui/work-commands.js';
import { reviewCriteriaRefresh } from '../../dist/ui/criteria-refresh.js';
import { translator } from '../../dist/ui/i18n.js';

function hostFor(f, locale, decisions = ['adopt', 'adopt'], hooks = {}) {
    const shown = [], notices = [], choices = []; let active = true;
    const host = { controller: f.c, locale, guard() { if (!active) throw new Error('Owner pane closed'); },
        isCurrent() { return active; }, activate: async () => assert.fail('Unexpected navigation'),
        async choose(title, labels) { const entry = translator(locale)('criteria.entry'); assert.ok(labels.includes(entry)); return entry; },
        async chooseItems(title, items) { choices.push({ title, items }); return decisions.shift(); },
        async show(title, text) { shown.push({ title, text }); await hooks.show?.(title, text); },
        async input(title, value) { return hooks.input ? hooks.input(title, value) : 'Owner adopts the exact reviewed workflow update'; },
        notice(text) { notices.push(text); } };
    return { host, shown, notices, choices, closePane() { active = false; } };
}

for (const locale of ['en', 'ko']) test(`/work exposes localized exact workflow-rule adoption with default Back and no automatic resume (${locale})`, async t => {
    const f = await criteriaWorld(t); await f.change(); const reviewed = f.snapshot(), before = f.ledger(), tUi = translator(locale), h = hostFor(f, locale);
    const command = workCommands({ ...h.host, locale: () => locale })[0];
    assert.equal(await command.run(f.workId, f.target, {}), 'completed');
    const after = f.ledger(); assert.equal(f.snapshot().epoch, reviewed.epoch + 1); assert.equal(f.snapshot().previousHash, reviewed.currentHash);
    for (const table of ['runs', 'budgets', 'goals', 'obligations']) assert.deepEqual(after[table], before[table]);
    assert.ok(h.choices.every(choice => choice.items[0].value === 'back'));
    assert.equal(h.choices.at(-1).items[0].label, tUi('criteria.back'));
    assert.ok(h.shown.some(page => page.text.includes(tUi('criteria.explanation'))));
    const fresh = f.snapshot();
    assert.deepEqual(h.notices, [tUi('criteria.savedNotice', { work: f.workId, epoch: fresh.epoch, version: fresh.fromContractsVersion, hash: fresh.previousHash })]);
    assert.equal(h.shown.length, 1, 'No duplicate confirmation or saved-result modal is required');
    assert.ok(h.choices.at(-1).title.includes(reviewed.currentHash)); assert.ok(h.choices.at(-1).title.length < 1000); f.pass();
});

test('default Back, cancelled reason and already-current inspection do not change criteria or spend', async t => {
    const f = await criteriaWorld(t), initial = f.ledger();
    const same = hostFor(f, 'en'); assert.equal(await reviewCriteriaRefresh(same.host, f.workId, f.target), 'cancelled'); assert.deepEqual(f.ledger(), initial);
    await f.change(); const before = f.ledger();
    assert.equal(await reviewCriteriaRefresh(hostFor(f, 'en', ['back']).host, f.workId, f.target), 'cancelled'); assert.deepEqual(f.ledger(), before);
    assert.equal(await reviewCriteriaRefresh(hostFor(f, 'en', ['adopt'], { input: async () => undefined }).host, f.workId, f.target), 'cancelled'); assert.deepEqual(f.ledger(), before); f.pass();
});

test('inspection distinguishes provenance-only changes and exposes complete retained selected text without reconstructing old unselected content', async t => {
    const f = await criteriaWorld(t); await f.change('CONTRACTS.md'); const old = f.snapshot(), h = hostFor(f, 'en', ['changes', 'complete', 'back']);
    assert.equal(await reviewCriteriaRefresh(h.host, f.workId, f.target), 'cancelled');
    assert.ok(h.shown[0].text.includes(translator('en')('criteria.provenanceOnly')));
    const complete = h.shown.filter(page => page.title.startsWith(translator('en')('criteria.inspectComplete'))).map(page => page.text).join('');
    assert.ok(complete.includes('MISSION.md')); assert.ok(complete.includes('CONTRACTS.md'));
    for (const asset of old.assets) for (const line of asset.previousSelected.split('\n').filter(line => line.length > 20).slice(0, 1)) assert.ok(complete.includes(JSON.stringify(line).slice(1, -1)));
    assert.equal(complete.includes('Owned fixture clarification'), false, 'Unselected old/current content is not invented'); f.pass();
});

for (const drift of ['language', 'direction', 'pane', 'installed-rules', 'work']) test('criteria UI refuses ' + drift + ' drift while owner reason is open', async t => {
    const f = await criteriaWorld(t); await f.change(); const before = f.snapshot(), count = f.c.store.one('SELECT COUNT(*) n FROM change_versions').n;
    let h;
    h = hostFor(f, 'en', ['adopt'], { input: async () => {
        if (drift === 'language') f.c.setConversationLanguage({ conversationId: f.target, expectedGeneration: 0, expectedRevision: 0, replyLanguage: 'ko' });
        if (drift === 'direction') await f.c.queueConversationInput({ conversationId: f.target, expectedGeneration: 0, text: 'Original owner changes direction while review is open', mode: 'idle' });
        if (drift === 'pane') h.closePane();
        if (drift === 'installed-rules') await f.change();
        if (drift === 'work') f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?', f.workId);
        return 'Stale owner confirmation';
    } });
    await assert.rejects(reviewCriteriaRefresh(h.host, f.workId, f.target), /changed|closed|변경/);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM change_versions').n, count);
    assert.equal(f.snapshot().fromContractsVersion, before.fromContractsVersion); assert.equal(f.c.store.one("SELECT COUNT(*) n FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'").n, 0); f.pass();
});

test('unavailable current rules remain inspectable and cannot enter adoption', async t => {
    const f = await criteriaWorld(t); await fs.unlink(path.join(f.payload, 'DESIGN.md')); const before = f.ledger(), h = hostFor(f, 'ko');
    assert.equal(await reviewCriteriaRefresh(h.host, f.workId, f.target), 'cancelled');
    assert.equal(h.choices.length, 0); assert.ok(h.shown.some(page => page.text.includes(translator('ko')('criteria.currentUnavailable'))));
    assert.equal(h.shown[0].text.includes(translator('ko')('criteria.unchanged')), false, 'Unavailable rule sources cannot be described as unchanged');
    assert.deepEqual(f.ledger(), before); f.pass();
});

test('navigation after committed adoption reports the saved result and does not pretend to roll it back', async t => {
    const f = await criteriaWorld(t); await f.change(); const before = f.snapshot(); let h;
    h = hostFor(f, 'en', ['adopt', 'adopt']);
    const refresh = f.c.refreshChangeCriteria.bind(f.c);
    f.c.refreshChangeCriteria = async (...args) => { const result = await refresh(...args); h.closePane(); return result; };
    await assert.rejects(reviewCriteriaRefresh(h.host, f.workId, f.target), error => error.message.includes('were adopted') && error.message.includes(f.workId) && error.message.includes(before.currentHash));
    assert.equal(f.snapshot().epoch, before.epoch + 1); assert.equal(f.snapshot().previousHash, before.currentHash); assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n, 1); f.pass();
});

test('long owner reasons keep confirmation actions compact while the exact reason is retained', async t => {
    const f = await criteriaWorld(t); await f.change(); const reviewed = f.snapshot(), reason = '명시적인 소유자 검토 사유 '.repeat(90), h = hostFor(f, 'ko', ['adopt', 'adopt'], { input: async () => reason });
    assert.ok(Buffer.byteLength(reason) <= 4096);
    assert.equal(await reviewCriteriaRefresh(h.host, f.workId, f.target), 'completed');
    const title = h.choices.at(-1).title; assert.ok(title.includes(f.workId)); assert.ok(title.includes(reviewed.currentHash));
    assert.ok(title.length < 1000); assert.equal(title.includes(reason), false);
    assert.equal(f.c.store.one("SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'").raw, reason); f.pass();
});

test('invalid owner reason retries only that field and keeps its raw value and original reviewed context', async t => {
    const f = await criteriaWorld(t); await f.change(); let calls = 0;
    const h = hostFor(f, 'en', ['adopt', 'adopt'], { input: async (_title, value) => {
        if (!calls++) { assert.equal(value, ''); return '   '; }
        assert.equal(value, '   '); return 'Owner corrects the same retained reason';
    } });
    assert.equal(await reviewCriteriaRefresh(h.host, f.workId, f.target), 'completed'); assert.equal(calls, 2);
    assert.equal(f.c.store.one("SELECT raw FROM sources WHERE json_extract(origin,'$.kind')='owner-criteria-refresh'").raw, 'Owner corrects the same retained reason'); f.pass();
});

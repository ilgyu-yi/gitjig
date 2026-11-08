import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { registryWorld } from '../controller/change-registry-fixture.mjs';
import { translator } from '../../dist/ui/i18n.js';

const execute = promisify(execFile);
const ledgerTables = ['works', 'sources', 'requirements', 'change_state', 'change_versions', 'runs', 'budgets',
    'obligations', 'effect_operations', 'effect_delegations', 'effect_receipts', 'source_branch_previews', 'conversation_inputs'];
const ledgerDigest = read => {
    const digest = createHash('sha256');
    for (const table of ledgerTables)
        digest.update(JSON.stringify(read('SELECT * FROM ' + table + ' ORDER BY rowid')));
    return digest.digest('hex');
};

for (const locale of ['en', 'ko']) test(`save discovery restores the original older work page after an unreadable result in ${locale}`, {timeout: 30000}, async t => {
    const f = await registryWorld(t, 'save-discovery'), {c} = f, tr = translator(locale);
    const broken = f.works[0].workId, healthy = f.works[1].workId;
    for (let i = 0; i < 24; i++) await c.beginChange({projectId: 'A', request: 'Newer retained work ' + i});
    const first = c.listWorks({limit: 25});
    assert.ok(first.nextCursor);
    assert.deepEqual(c.listWorks({limit: 25, before: first.nextCursor}).works.map(work => work.workId), [healthy, broken]);
    const {conversationId: cid, generation} = c.createConversation({projectId: 'A'});
    const draft = 'Keep this separate draft · 한글';
    c.setConversationLanguage({conversationId: cid, expectedGeneration: generation, expectedRevision: 0, replyLanguage: locale});
    c.setDraft({conversationId: cid, expectedRevision: 0, text: draft});
    const originalData = c.store.one('SELECT data FROM change_state WHERE work=?', broken).data;
    const invalidData = '!' + originalData;
    c.store.run('UPDATE change_state SET data=? WHERE work=?', invalidData, broken);
    assert.equal(c.inspectChangeActivity(broken).recordedPhase, 'BASE_CAPTURED');
    assert.throws(() => c.inspectChangeResult(broken), SyntaxError);
    c.store.run('UPDATE change_state SET data=? WHERE work=?', originalData, broken);
    assert.equal(c.inspectChangeResult(healthy).projectId, 'B');
    const baseline = ledgerDigest(sql => c.store.all(sql));
    const stable = ['works', 'runs', 'budgets', 'effect_operations', 'source_branch_previews'].map(table => {
        const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
        return {sql, rows: c.store.all(sql).map(Object.values)};
    });
    await c.close();

    const retained = data => [...stable, {sql: 'SELECT data FROM change_state WHERE work=?', params: [broken], rows: [[data]]}];
    const replace = data => [{sql: 'UPDATE change_state SET data=? WHERE work=?', params: [data, broken]}];
    const step = (wait, send, data = originalData) => ({wait, send, queries: retained(data), assertDraft: draft, expectedSelected: cid});
    const previous = tr('save.previousPage'), back = tr('save.back');
    const unavailable = (locale === 'ko' ? '작업 결과를 읽을 수 없습니다' : 'Work result unavailable') + ' · ' + broken;
    const inspectHealthy = step(tr('save.foreignScope'), '\x1b', invalidData);
    const reselectHealthy = step(previous, healthy + '\r', invalidData);
    const healthyMenu = step(tr('save.workMenu', {work: healthy, project: 'B', conversationProject: 'A'}), back + '\r', invalidData);
    const steps = [
        step(draft, '\x07/'),
        step(tr('command.discovery.title'), '/save\r'),
        step(tr('save.operations'), tr('save.findWork') + '\r'),
        step(tr('save.findWork'), tr('save.nextPage') + '\r'),
        {...step(previous, broken + '\r'), mutations: replace(invalidData)},
        step(unavailable, '\x1b', invalidData),
        step(previous, '\r', invalidData),
        step(unavailable, '\x1b', invalidData),
        step(previous, healthy + '\r', invalidData),
        inspectHealthy,
        reselectHealthy,
        step(tr('save.foreignOpen'), '\r', invalidData),
        healthyMenu,
        {...step(previous, back + '\r', invalidData), mutations: replace(originalData)},
        step(draft, '\x07q'),
    ];
    const entry = process.env.GITJIG_TEST_CLI_ENTRY;
    const guard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];
    const file = path.join(f.root, 'save-discovery.json'), output = file + '.terminal';
    const database = path.join(f.home, 'state/controller.sqlite');
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, ...guard, '--import', './tests/ui/readiness-no-execution.mjs',
            entry ?? 'dist/cli/entry.js', 'conversation', 'ui', '--home', f.home, '--conversation', cid],
        env: {HOME: f.root, GITJIG_HOME: f.home, TMPDIR: f.root, PATH: path.dirname(process.execPath), TERM: 'xterm-256color',
            LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', ...(entry ? {GITJIG_TEST_CLI_ENTRY: path.resolve(entry)} : {})},
        steps, timeoutSeconds: 10, expectedInputs: 0, database, output, columns: 154, rows: 40,
        gracefulShutdownSeconds: 3, noForceKill: true,
    }));
    try {
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 13500, maxBuffer: 2 ** 20})).stdout);
        assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
        const bytes = await fs.readFile(output);
        const {actionOutputOffsets: offsets} = JSON.parse(await fs.readFile(output + '.progress.json', 'utf8'));
        const before = stage => {
            const index = steps.indexOf(stage);
            return bytes.subarray(offsets[index - 1], offsets[index]).toString('utf8');
        };
        assert.ok(before(inspectHealthy).includes(healthy));
        assert.ok(!before(reselectHealthy).includes(tr('save.workMenu', {work: healthy, project: 'B', conversationProject: 'A'})));
        assert.ok(!before(healthyMenu).includes(tr('save.new')), 'Readable, incomplete result must not offer preparation');
        const db = new DatabaseSync(database, {readOnly: true});
        try { assert.equal(ledgerDigest(sql => db.prepare(sql).all()), baseline); }
        finally { db.close(); }
    } catch (error) {
        t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-12000));
        throw error;
    }
});

for (const locale of ['en', 'ko']) test(`save discovery keeps the original proposal page when its selected artifact is unreadable in ${locale}`, {timeout: 30000}, async t => {
    const {c, root, home, works} = await registryWorld(t, 'save-preview-unreadable');
    const workId = works[0].workId, tr = translator(locale);
    const {conversationId: cid, generation} = c.createConversation({projectId: 'A'});
    const draft = 'Keep this preview draft · 한글';
    c.setConversationLanguage({conversationId: cid, expectedGeneration: generation, expectedRevision: 0, replyLanguage: locale});
    c.setDraft({conversationId: cid, expectedRevision: 0, text: draft});
    // These are catalogue headers only. The exact selected artifact has the wrong size.
    const hash = 'a'.repeat(64), artifact = path.join(home, 'artifacts/source-snapshot-proposals', hash + '.json');
    await fs.mkdir(path.dirname(artifact), {recursive: true, mode: 0o700});
    await fs.writeFile(artifact, '!', {mode: 0o600});
    const ids = Array.from({length: 27}, (_, i) => `03f40000-8c95-43c3-8de2-${String(i).padStart(12, '0')}`);
    for (const [i, proposalId] of ids.entries()) {
        const data = JSON.stringify({protocol: 'source-snapshot-proposal/v2', proposalId, workId,
            previewId: proposalId, operationId: 'source-preview-' + proposalId,
            status: 'prepared', publicationConsent: 'unconfirmed', destinationRef: `refs/heads/preview-${i}`, artifact: {hash, bytes: 2}});
        c.store.run('INSERT INTO change_versions VALUES (?,?,?,?,?,?,?)', proposalId, workId, 'source-snapshot-proposal', 'candidate', artifact, hash, data);
    }
    const selected = ids.at(-1);
    assert.deepEqual(c.listSourceSnapshotProposals({workId, after: ids[24]}).proposals.map(row => row.proposalId), ids.slice(25));
    await assert.rejects(c.openSourceSnapshotPublication({workId, proposalId: selected, expectedArtifactHash: hash}), /artifact file unavailable/);
    const baseline = ledgerDigest(sql => c.store.all(sql));
    await c.close();
    const row = tr('save.proposalRow', {branch: JSON.stringify('refs/heads/preview-26'), id: selected});
    const title = tr('save.previewUnavailable', {id: JSON.stringify(selected)});
    const step = (wait, send) => ({wait, send, assertDraft: draft, expectedSelected: cid});
    const closeDiagnostic = step(title, '\x1b');
    const restoredPage = step(tr('save.previousPage'), '\r');
    const back = tr('save.back') + '\r';
    const steps = [step(draft, '\x07/'), step(tr('command.discovery.title'), '/save\r'),
        step(tr('save.operations'), tr('save.findWork') + '\r'), step(tr('save.findWork'), workId + '\r'),
        step(ids[0], tr('save.nextPage') + '\r'), step(selected, selected + '\r'),
        closeDiagnostic, restoredPage, step(title, '\x1b'),
        step(tr('save.previousPage'), tr('save.previousPage') + '\r'), step(ids[0], back), step(tr('save.findWork'), back),
        step(draft, '\x07q')];
    const entry = process.env.GITJIG_TEST_CLI_ENTRY;
    const guard = process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : [];
    const file = path.join(root, 'save-preview-unreadable.json'), output = file + '.terminal', database = path.join(home, 'state/controller.sqlite');
    await fs.writeFile(file, JSON.stringify({
        command: [process.execPath, ...guard, '--import', './tests/ui/readiness-no-execution.mjs',
            entry ?? 'dist/cli/entry.js', 'conversation', 'ui', '--home', home, '--conversation', cid],
        env: {HOME: root, GITJIG_HOME: home, TMPDIR: root, PATH: path.dirname(process.execPath), TERM: 'xterm-256color',
            LANG: 'C.UTF-8', NODE_OPTIONS: '', NODE_PATH: '', ...(entry ? {GITJIG_TEST_CLI_ENTRY: path.resolve(entry)} : {})},
        steps, timeoutSeconds: 10, expectedInputs: 0, database, output, columns: 154, rows: 40,
        gracefulShutdownSeconds: 3, noForceKill: true,
    }));
    try {
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout: 13500, maxBuffer: 2 ** 20})).stdout);
        assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
        const bytes = await fs.readFile(output);
        const {actionOutputOffsets: offsets} = JSON.parse(await fs.readFile(output + '.progress.json', 'utf8'));
        assert.ok(bytes.subarray(offsets[steps.indexOf(closeDiagnostic)], offsets[steps.indexOf(restoredPage)]).toString('utf8').includes(row));
        const db = new DatabaseSync(database, {readOnly: true});
        try { assert.equal(ledgerDigest(sql => db.prepare(sql).all()), baseline); }
        finally { db.close(); }
    } catch (error) {
        t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-8500));
        throw error;
    }
});

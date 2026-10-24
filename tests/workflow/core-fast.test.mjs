import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openController } from '../../dist/controller/index.js';
import { Store } from '../../dist/controller/store.js';
import { rawFindings } from '../../dist/controller/raw-findings.js';
const model = { provider: 'unused', modelId: 'unused' };
test('duplicate raw findings retained independently of unusable protocol', () => {
    const finding = { severity: 'blocking', description: 'Actual F1' };
    const raw = `{"findings":${JSON.stringify([finding])},"findings":[]}`;
    assert.deepEqual(rawFindings(raw), { findings: [finding], complete: true });
    assert.equal(rawFindings('{"findings":[{"severity":"blocking"}],"bad":').findings.length, 1);
});
test('failed capture corrected source retries same W with cumulative allowance and O1', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-core-fast-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ok.txt'), 'ok');
    await fs.symlink('ok.txt', path.join(source, 'unsupported'));
    let c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const first = await c.beginChange({ projectId: 'P', request: 'Preserve useful scope', executionLimit: 3, resolutionLimit: 2 });
        assert.equal(first.phase, 'BLOCKED');
        assert.equal(first.execution.consumed, 1);
        await fs.unlink(path.join(source, 'unsupported'));
        const retried = await c.driveChange({ workId: first.workId, model, maximumSteps: 1 });
        assert.ok(retried.baseVersion);
        assert.equal(retried.workId, first.workId);
        assert.equal(retried.execution.consumed, 2);
        assert.equal(retried.execution.reserved, 0);
        assert.equal(retried.resolution.consumed, 0);
        assert.equal(retried.reviewReady, false);
        await c.cancelWork({ workId: first.workId });
        const cancelled = c.inspectChange(first.workId);
        assert.equal(cancelled.reviewReady, false);
        await assert.rejects(c.planChange({ workId: first.workId, model }), /Explicit drive/);
        await c.close();
        c = await openController({ installationHome: home });
        assert.equal(c.inspectChange(first.workId).execution.consumed, 2);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('v1 metadata migration preserves retained source and work; locked migration rollback/reopen', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-migration-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ok.txt'), 'retained');
    let c = await openController({ installationHome: home });
    await c.registerProject({ id: 'P', sourceRoot: source });
    const w = await c.beginChange({ projectId: 'P', request: 'Original non-English 요청' });
    await c.close();
    const file = path.join(home, 'state', 'controller.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=OFF');
    for (const name of ['remedy_confirmations', 'check_runs', 'finding_dispositions', 'finding_occurrences', 'role_outputs', 'role_launches', 'change_versions', 'change_state'])
        db.exec(`DROP TABLE ${name}`);
    db.exec('PRAGMA user_version=1');
    const original = db.prepare('SELECT * FROM works WHERE id=?').get(w.workId), raw = db.prepare('SELECT raw FROM sources WHERE id=?').get(original.source).raw;
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => new Store(file), /locked/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    db.exec('ROLLBACK');
    db.close();
    const migrated = new Store(file);
    try {
        assert.equal(migrated.one('PRAGMA user_version').user_version, 8);
        assert.deepEqual(migrated.one('SELECT * FROM works WHERE id=?', w.workId), original);
        assert.equal(migrated.one('SELECT raw FROM sources WHERE id=?', original.source).raw, raw);
        assert.equal(migrated.all('SELECT * FROM change_state').length, 0);
    }
    finally {
        migrated.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('raw null/duplicate occurrences remain addressable; independently optional equivalence closes and cycle refuses', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-occurrences-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ok.txt'), 'ok');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const w = await c.beginChange({ projectId: 'P', request: 'Keep all observations' }), core = c.changeCore, store = core.s, run = c.inspectWork(w.workId).runs[0];
        store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'fixture-review', w.workId, run.id, 'reviewer', w.epoch, 'UNUSABLE', 'none', JSON.stringify({ inputVersions: { candidate: null } }));
        const raw = '{"findings":[{"severity":"optional"},null,{"severity":"optional"}],"findings":[]}';
        core.collect(w.workId, 'fixture-review', { role: 'reviewer', rawFinal: raw, issues: ['duplicate findings key'], events: [], exposures: [], terminal: 'complete', historyRef: null, providerRequests: 0, rawFinalTruncated: false }, false);
        const occurrences = c.inspectChange(w.workId).occurrences;
        assert.equal(occurrences.length, 4);
        assert.equal(await core.nitPreview(w.workId), null);
        const decisions = occurrences.map((o, i) => ({ occurrenceId: o.id, disposition: i === 0 ? 'upheld' : i === 2 ? 'equivalent' : 'rejected', ...(i === 2 ? { equivalentTo: occurrences[0].id } : {}), reason: 'Independent fixture observation judgment', witnesses: ['retained-raw-output'] }));
        core.dispositions(w.workId, 'fixture-review', { decisions });
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'finding').length, 0);
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'diagnostic').length, 1);
        assert.throws(() => core.dispositions(w.workId, 'fixture-review', { decisions: [{ ...decisions[0], disposition: 'equivalent', equivalentTo: occurrences[2].id }] }), /cycle/);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('declared reproduction consumer refuses truncated/missing native binding and preserves unknown expectation scope', { timeout: 10000 }, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-repro-consumer-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'check.cjs'), 'fixture bytes');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const w = await c.beginChange({ projectId: 'P', request: 'Actual failure binding' }), core = c.changeCore, store = core.s, run = c.inspectWork(w.workId).runs[0], plan = { requirements: [{ id: 'R1' }], verification: { requiredPaths: ['check.cjs'] } }, p = core.newVersion(w.workId, 'plan', null, { plan }, 'fixture-plan'), v = core.newVersion(w.workId, 'verification', null, { verification: {} }, 'fixture-verification');
        store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', 'fixture-repro', w.workId, run.id, 'reviewer', w.epoch, 'COMPLETE', 'none', JSON.stringify({ inputVersions: { candidate: w.baseVersion, plan: p, verification: v }, cleanup: 'removed' }));
        const finding = { requirementId: 'R1', severity: 'optional', reproduction: { toolCallId: 'T1', command: 'node check.cjs', assertions: ['once'] } }, events = [{ type: 'tool_execution_start', toolCallId: 'T1', toolName: 'bash', args: { command: 'node check.cjs' } }, { type: 'tool_execution_end', toolCallId: 'T1', toolName: 'bash', isError: false, result: { structuredContent: { exit_code: 0, output: '{"version":1,"assertions":[{"id":"once","passed":false}]}', truncated: true } } }];
        core.registerReproduction(w.workId, 'fixture-repro', 'occurrence-unknown', finding, { events });
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'check').length, 0);
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'reproduction-unresolved').length, 1);
        events[1].result.structuredContent.truncated = false;
        core.registerReproduction(w.workId, 'fixture-repro', 'occurrence-known', finding, { events });
        const actualFailure = core.pending(w.workId).find(o => o.kind === 'check');
        assert.ok(actualFailure);
        assert.equal(actualFailure.expectations, null);
        assert.equal(actualFailure.checkBinding.length, 64);
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'reproduction-unresolved').length, 0);
        const receipt = store.one('SELECT * FROM check_runs WHERE id=?', actualFailure.receipt);
        assert.equal(receipt.status, 'fail');
        assert.equal(JSON.parse(receipt.data).actual.exit_code, 0);
        assert.equal(core.expectations(w.baseVersion, { expectationPaths: [] }).length, 0);
        assert.equal(core.expectations(w.baseVersion, { expectationPaths: ['missing.cjs'] }), null);
        core.registerReproduction(w.workId, 'fixture-repro', 'occurrence-missing', { ...finding, reproduction: { ...finding.reproduction, toolCallId: 'missing' } }, { events });
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'reproduction-unresolved').length, 1);
        assert.equal(store.all('SELECT * FROM check_runs WHERE work=?', w.workId).length, 1);
        core.registerReproduction(w.workId, 'fixture-repro', 'occurrence-duplicate', finding, { events: [...events, events[0], events[1]] });
        assert.equal(store.all('SELECT * FROM check_runs WHERE work=?', w.workId).length, 1);
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'reproduction-unresolved').length, 2);
        events[1].isError = true;
        events[1].result.structuredContent.exit_code = 37;
        core.registerReproduction(w.workId, 'fixture-repro', 'occurrence-nonzero', finding, { events });
        assert.equal(store.all('SELECT * FROM check_runs WHERE work=?', w.workId).length, 2);
        assert.equal(core.pending(w.workId).filter(o => o.kind === 'check').length, 1);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('real retained W completeness prerequisite refuses direct public paid plan and review without run or budget growth', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-completeness-entry-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.txt'), 'real captured input');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const begun = await c.beginChange({ projectId: 'P', request: 'Keep received findings' }), before = c.inspectChange(begun.workId);
        c.store.run('INSERT INTO obligations VALUES(?,?,?)', 'fixture-incomplete', begun.workId, JSON.stringify({ kind: 'raw-findings-incomplete', state: 'pending', nativeEntryId: 'fixture-received-entry', historyRef: 'fixture-retained-native-file', omittedFindingCount: 1 }));
        await assert.rejects(c.planChange({ workId: begun.workId, model }), /bounded extraction profile/);
        await assert.rejects(c.reviewChange({ workId: begun.workId, model }), /bounded extraction profile/);
        const after = c.inspectChange(begun.workId);
        assert.deepEqual(after.execution, before.execution);
        assert.deepEqual(after.resolution, before.resolution);
        assert.equal(after.launches.length, 0);
        assert.equal(c.inspectWork(begun.workId).runs.length, 1);
        assert.equal(after.reviewReady, false);
        await c.changeCore.recoverRoleEvidence({ workId: begun.workId, model });
        assert.equal(c.changeCore.pending(begun.workId).filter(o => o.kind === 'raw-findings-incomplete').length, 1);
        assert.equal(c.inspectWork(begun.workId).runs.length, 1);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

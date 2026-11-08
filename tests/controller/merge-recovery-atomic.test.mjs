import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';

test('interrupted merge producer recovery settles allowance, run and operation together', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-merge-recovery-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'consumer.txt'), 'merge recovery');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const { workId } = await c.beginChange({ projectId: 'P', request: 'Merge recovery fixture' }), s = c.store, work = s.one('SELECT * FROM works WHERE id=?', workId);
        // Controlled ledger premise: a merge HTTP producer died holding one reservation while its operation was INVOKING.
        s.run('PRAGMA foreign_keys=OFF');
        s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', 'M1', workId, 'T', 'G', 'INVOKING', JSON.stringify({ kind: 'github-merge' }));
        s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'MR1', workId, work.epoch, work.generation, 'RUNNING', root, 'reserved', JSON.stringify({ kind: 'merge-http', operationId: 'M1' }));
        s.run("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'", work.lineage);
        const ledger = () => [s.all('SELECT kind,reserved,consumed FROM budgets WHERE lineage=? ORDER BY kind', work.lineage).map(r => ({ ...r })), { ...s.one('SELECT phase,reservation FROM runs WHERE id=?', 'MR1') }, s.one('SELECT phase FROM effect_operations WHERE id=?', 'M1').phase];
        const before = ledger(), merges = c.effects.merges, host = merges.h, patchRun = host.patchRun;
        // Target identity and view assembly are outside this ledger-atomicity premise.
        merges.target = () => ({}); merges.inspect = id => ({ operationId: id });
        host.patchRun = () => { throw Error('CONTROLLED_RECOVERY_WRITE_FAILURE'); };
        assert.throws(() => merges.recoverRun(s.one('SELECT * FROM runs WHERE id=?', 'MR1')), /CONTROLLED_RECOVERY_WRITE_FAILURE/);
        assert.deepEqual(ledger(), before);
        host.patchRun = patchRun;
        merges.recoverRun(s.one('SELECT * FROM runs WHERE id=?', 'MR1'));
        const [budgets, run, phase] = ledger();
        assert.equal(budgets.find(b => b.kind === 'execution').reserved, before[0].find(b => b.kind === 'execution').reserved - 1);
        assert.deepEqual(run, { phase: 'INTERRUPTED', reservation: 'consumed' }); assert.equal(phase, 'UNKNOWN');
    } finally { await c.close(); }
});

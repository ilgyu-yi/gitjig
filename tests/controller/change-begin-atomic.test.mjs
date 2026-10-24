import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';

test('base capture commits its version, phase and run settlement together', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-begin-atomic-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'consumer.txt'), 'captured');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        // Controlled stand-in for a crash or write failure after the base version insert.
        const host = c.changeCore.h, patchRun = host.patchRun;
        let failed = false;
        host.patchRun = (run, phase, patch) => { if (phase === 'SETTLED' && patch.base && !failed) { failed = true; throw Error('CONTROLLED_SETTLEMENT_FAILURE'); } return patchRun(run, phase, patch); };
        const begun = await c.beginChange({ projectId: 'P', request: 'Atomic base capture' });
        assert.equal(failed, true);
        const bases = c.store.all("SELECT id FROM change_versions WHERE work=? AND kind='base'", begun.workId), state = c.store.one('SELECT base,phase FROM change_state WHERE work=?', begun.workId);
        assert.equal(bases.length, 0); assert.equal(state.base, null); assert.notEqual(state.phase, 'BASE_CAPTURED');
        assert.equal(c.store.one('SELECT phase FROM runs WHERE work=?', begun.workId).phase, 'SETTLED');
        // Controlled stand-in for a crash right after the capture commit: no later transaction ever commits.
        const tx = c.store.tx.bind(c.store), captured = () => c.store.one("SELECT COUNT(*) AS n FROM runs WHERE json_extract(data,'$.attainedCapture')=1").n;
        let crashed = false;
        c.store.tx = fn => { if (crashed) throw Error('CONTROLLED_CRASH_AFTER_CAPTURE'); const before = captured(), value = tx(fn); if (captured() > before) { crashed = true; throw Error('CONTROLLED_CRASH_AFTER_CAPTURE'); } return value; };
        await assert.rejects(c.beginChange({ projectId: 'P', request: 'Atomic base capture with settlement' }), /CONTROLLED_CRASH_AFTER_CAPTURE/);
        c.store.tx = tx;
        // A real crash ends the process; release the in-process registration so this controller can close.
        for (const w of c.store.all('SELECT id FROM works')) host.unregister(w.id);
        const run = c.store.one("SELECT phase,reservation FROM runs WHERE json_extract(data,'$.attainedCapture')=1 ORDER BY rowid DESC LIMIT 1");
        assert.equal(run.reservation, 'consumed');
    } finally { await c.close(); }
});

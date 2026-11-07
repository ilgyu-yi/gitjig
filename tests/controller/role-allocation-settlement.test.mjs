import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { selectControllerModel } from '../../dist/cli/selected-model.js';

test('a governed role settles its reservation and work registration when native role allocation fails', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-role-allocation-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'consumer.txt'), 'role allocation');
    const profile = path.join(root, 'model.json'), authPath = path.join(root, 'auth.json');
    await fs.writeFile(authPath, JSON.stringify({ openrouter: { type: 'api_key', key: 'DUMMY-NO-REQUEST' } }), { mode: 0o600 });
    await fs.writeFile(profile, JSON.stringify({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', native: { kind: 'pi-stored', credentialType: 'api_key', authPath } }), { mode: 0o600 });
    const c = await openController({ installationHome: home, runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'NEVER_EXECUTE', image: 'sha256:' + '0'.repeat(64) } });
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const { workId } = await c.beginChange({ projectId: 'P', request: 'Role allocation fixture' }), s = c.store, lineage = s.one('SELECT lineage FROM works WHERE id=?', workId).lineage;
        const budgets = () => s.all('SELECT kind,reserved,consumed FROM budgets WHERE lineage=? ORDER BY kind', lineage).map(r => ({ ...r }));
        const before = budgets(), model = await selectControllerModel(profile, c);
        // Controlled native allocation refusal before any capacity, engine or provider request.
        c.changeCore.h.allocateRole = () => { throw Error('CONTROLLED_ROLE_ALLOCATION_REFUSAL'); };
        const outcome = await c.planChange({ workId, model }).then(value => ({ value }), error => ({ error }));
        assert.match(String(outcome.error ?? JSON.stringify(outcome.value?.blocked)), /CONTROLLED_ROLE_ALLOCATION_REFUSAL|ROLE_UNAVAILABLE/);
        assert.equal(c.changeCore.h.busy(workId), false);
        assert.deepEqual(budgets(), before.map(b => ({ ...b, consumed: b.consumed + (b.kind === 'execution' ? 1 : 0) })));
        const launch = s.one('SELECT status,run FROM role_launches WHERE work=?', workId);
        assert.equal(launch.status, 'UNUSABLE'); assert.equal(s.one('SELECT phase FROM runs WHERE id=?', launch.run).phase, 'SETTLED');
        assert.ok(s.all('SELECT resolution_reservation AS r FROM role_launches WHERE work=?', workId).every(row => row.r !== 'reserved'));
    } finally { await c.close(); }
});

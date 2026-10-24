import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scopeJournalsRemoved } from './fixture-cleanup.mjs';

test('owned runtime journal cleanup retains pre-return uncertainty and incomplete records', async t => {
    const root = await fs.mkdtemp(path.resolve('.runtime-fixtures/journal-retention-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'authority'), 'controller-only'); assert.equal(await scopeJournalsRemoved(root), true);
    const nonce = 'c4e0bf28-51b6-492b-a9a9-31f46107ea0e', file = path.join(root, nonce + '.json');
    const record = { version: 1, context: 'colima-gitjig-dev', nonce, workId: 'runtime-acceptance', runId: 'retention-control', id: 'a'.repeat(64), state: 'removed' };
    await fs.writeFile(file, JSON.stringify(record)); assert.equal(await scopeJournalsRemoved(root), true);
    for (const state of ['creating', 'created', 'quarantined']) {
        await fs.writeFile(file, JSON.stringify({ ...record, state })); assert.equal(await scopeJournalsRemoved(root), false); assert.equal((await fs.lstat(file)).isFile(), true);
    }
    await fs.writeFile(file, '{'); assert.equal(await scopeJournalsRemoved(root), false);
    await fs.writeFile(file, JSON.stringify({ state: 'removed' })); assert.equal(await scopeJournalsRemoved(root), false);
    await fs.writeFile(file, JSON.stringify(record)); await fs.writeFile(file + '.next', '{}'); assert.equal(await scopeJournalsRemoved(root), false);
    await fs.rm(file + '.next'); await fs.rm(file); await fs.symlink('authority', file); assert.equal(await scopeJournalsRemoved(root), false);
    await fs.rm(file); assert.equal(await scopeJournalsRemoved(root), true);
});

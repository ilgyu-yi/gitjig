import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createOwnedAcceptanceSetup} from '../../dist/platform/hosted-context.js';
import { fixture } from './acceptance-fixture.mjs';

test('v1 encoding of actual owned creation migrates zero never-available native allowance without resetting API facts', async () => {
    const f = await fixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup(f.setupOptions); await setup.create();
        const before = setup.inspect(); await setup.close();
        const file = path.join(f.root, 'setup.json'), encoded = JSON.parse(await fs.readFile(file, 'utf8'));
        // Schema compatibility fixture: actual producer facts retained, only old encoding selected.
        encoded.version = 1; delete encoded.nativeOperationLimit; delete encoded.setupSteps; delete encoded.counters.nativeOperations; delete encoded.counters.nativePushes;
        await fs.writeFile(file, JSON.stringify(encoded), { mode: 0o600 });
        setup = await createOwnedAcceptanceSetup(f.setupOptions); await setup.reopen();
        assert.equal(setup.inspect().version, 3); assert.equal(setup.inspect().nativeOperationLimit, 64);
        assert.equal(setup.inspect().counters.repositoryCreates, 1);
        assert.equal(setup.inspect().counters.reads, before.counters.reads + 2);
        assert.equal(setup.inspect().counters.nativeOperations, 0); assert.equal(setup.inspect().counters.nativePushes, 0);
        assert.equal(f.state.calls.filter(row => row.method === 'POST').length, 1);
        await setup.close();
        encoded.counters.nativePushes = 1; await fs.writeFile(file, JSON.stringify(encoded));
        await assert.rejects(createOwnedAcceptanceSetup(f.setupOptions), /Malformed legacy/);
    } finally { await setup?.close(); await f.close(); }
});

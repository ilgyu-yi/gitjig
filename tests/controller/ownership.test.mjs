import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {acquireOwner} from '../../dist/controller/ownership.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-ownership-'));
    t.after(() => fs.rm(root, {recursive:true, force:true}));
    return root;
}

for (const leaf of ['recovery.guard', 'owner.json']) {
    for (const operation of ['writeFile', 'sync', 'close']) {
        test(`failed ${leaf} ${operation} closes owned handles and permits retry`, async t => {
            const root = await fixture(t), originalOpen = fs.open;
            const handles = [];
            let injected = false;
            const failure = new Error(`injected ${leaf} ${operation}`);
            t.mock.method(fs, 'open', async (...args) => {
                const handle = await originalOpen(...args), record = {closed:false};
                handles.push(record);
                const close = handle.close.bind(handle);
                handle.close = async () => { await close(); record.closed = true; };
                if (path.basename(String(args[0])) === leaf && !injected) {
                    injected = true;
                    const original = handle[operation].bind(handle);
                    handle[operation] = async (...values) => {
                        if (operation === 'close') await original(...values);
                        throw failure;
                    };
                }
                return handle;
            });
            await assert.rejects(acquireOwner(root), error => error === failure);
            assert.ok(handles.every(handle => handle.closed));
            assert.deepEqual(await fs.readdir(root), []);
            const release = await acquireOwner(root);
            await assert.rejects(acquireOwner(root), error => error.code === 'OWNER_BUSY');
            await release();
            assert.deepEqual(await fs.readdir(root), []);
        });
    }
}

test('initialization and cleanup failures remain available together', async t => {
    const root = await fixture(t), originalOpen = fs.open;
    const writeFailure = new Error('injected write'), closeFailure = new Error('injected close');
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args), close = handle.close.bind(handle);
        handle.writeFile = async () => { throw writeFailure; };
        handle.close = async () => { await close(); throw closeFailure; };
        return handle;
    });
    await assert.rejects(acquireOwner(root), error => error instanceof AggregateError &&
        error.errors.includes(writeFailure) && error.errors.includes(closeFailure));
    assert.deepEqual(await fs.readdir(root), []);
});

for (const leaf of ['recovery.guard', 'owner.json']) {
    test(`failed initialization preserves replaced ${leaf}`, async t => {
        const root = await fixture(t), originalOpen = fs.open, file = path.join(root, leaf);
        t.mock.method(fs, 'open', async (...args) => {
            const handle = await originalOpen(...args);
            if (String(args[0]) === file) {
                handle.sync = async () => {
                    await fs.rename(file, file + '.original');
                    await fs.writeFile(file, 'replacement', {flag:'wx', mode:0o600});
                    throw new Error('injected replacement');
                };
            }
            return handle;
        });
        await assert.rejects(acquireOwner(root), /injected replacement/);
        assert.equal(await fs.readFile(file, 'utf8'), 'replacement');
    });
}

test('existing live and malformed owners remain protected', async t => {
    const root = await fixture(t), file = path.join(root, 'owner.json');
    for (const raw of [JSON.stringify({pid:process.pid, nonce:'live'}), '{incomplete']) {
        await fs.writeFile(file, raw, {mode:0o600});
        await assert.rejects(acquireOwner(root), error => error.code === 'OWNER_BUSY');
        assert.equal(await fs.readFile(file, 'utf8'), raw);
        assert.deepEqual(await fs.readdir(root), ['owner.json']);
    }
});

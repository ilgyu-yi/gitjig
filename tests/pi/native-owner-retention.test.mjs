/** Local durable-owner census only: no engine, model, network or native child. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OWNER_LIMIT, ownerRoot, ownerDirectory, writeRecord, inspectOwners } from '../../dist/pi/native-owner-records.js';

function world(t) {
    const state = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitjig-owner-retention-')));
    fs.chmodSync(state, 0o700);
    t.after(() => fs.rmSync(state, {recursive:true, force:true}));
    return ownerRoot(state);
}
function owner(root, {acknowledged = true} = {}) {
    const nonce = randomUUID(), dir = ownerDirectory(root, nonce);
    const binding = {version:1, nonce, sessionId:'local-retention-fixture', purpose:'provider', uid:process.getuid(), hostPid:process.pid, guardianPid:process.pid, executableSha256:'a'.repeat(64), createdAt:1};
    writeRecord(dir, 'admission.json', binding);
    writeRecord(dir, 'settlement.json', {...binding, nativeCreated:false, nativePid:null, pgid:null, exitCode:null, signal:null, exited:false, stdioReleased:true, groupAbsent:true, cleanup:'confirmed', reason:'REJECTED', finishedAt:2});
    if (acknowledged) writeRecord(dir, 'recovery.json', {...binding, nativeCreated:false, nativePid:null, pgid:null, observerPid:process.pid, observedAt:3, outcome:'active-owner-scope-joined'});
    return {nonce, dir, archive:path.join(path.dirname(root), 'archive-v1', nonce.slice(0,2), nonce, 'records')};
}
function bytes(dir) {
    return Object.fromEntries(fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir,name),'utf8')]));
}

test('acknowledged history exceeds 1024 lifetime owners without losing receipt bytes', {timeout:120000}, t => {
    const root = world(t);
    for (let i=0; i<OWNER_LIMIT+2; i++) {
        const record = owner(root), before = bytes(record.dir);
        inspectOwners(root);
        assert.deepEqual(bytes(record.archive), before);
        assert.equal(fs.existsSync(record.dir), false);
    }
    assert.deepEqual(fs.readdirSync(root), []);
    const active = owner(root, {acknowledged:false});
    inspectOwners(root, new Set([active.nonce]));
    assert.ok(fs.existsSync(active.dir));
    assert.throws(() => inspectOwners(root), /NATIVE_OWNER_UNACCOUNTED/);
});

test('existing full census migrates with bounded progress and preserves every record', {timeout:120000}, t => {
    const root = world(t), records = [];
    for (let i=0; i<OWNER_LIMIT; i++) {
        const record = owner(root);
        records.push({...record, before:bytes(record.dir)});
    }
    // The one-second IO budget may require another explicit census on slow disks.
    let remaining = OWNER_LIMIT;
    for (;;) {
        try { inspectOwners(root); break; }
        catch (error) {
            assert.match(error.message, /NATIVE_OWNER_RETENTION_LIMIT/);
            const next = fs.readdirSync(root).length;
            assert.ok(next < remaining, 'A bounded historical migration must make durable progress');
            remaining = next;
        }
    }
    assert.deepEqual(fs.readdirSync(root), []);
    for (const record of records) assert.deepEqual(bytes(record.archive), record.before);
});

test('local active acknowledged owners stay in the census and retain the capacity limit', t => {
    const root = world(t), record = owner(root), before = bytes(record.dir);
    inspectOwners(root, new Set([record.nonce]));
    assert.deepEqual(bytes(record.dir), before);
    assert.equal(fs.existsSync(record.archive), false);
    const active = new Set(Array.from({length:OWNER_LIMIT}, () => randomUUID()));
    active.add(record.nonce);
    assert.throws(() => inspectOwners(root, active), /NATIVE_OWNER_RETENTION_LIMIT/);
});

for (const kind of ['unresolved', 'malformed', 'unlinked', 'extra-file']) {
    test(`${kind} owner refuses admission even beside archived acknowledged history`, t => {
        const root = world(t), historical = owner(root);
        inspectOwners(root);
        const record = owner(root, {acknowledged:kind !== 'unresolved'});
        if (kind === 'malformed') fs.writeFileSync(path.join(record.dir,'recovery.json'), '{}\n');
        if (kind === 'unlinked') fs.unlinkSync(path.join(record.dir,'settlement.json'));
        if (kind === 'extra-file') fs.writeFileSync(path.join(record.dir,'unexpected'), 'extra', {mode:0o600});
        const before = bytes(record.dir), old = bytes(historical.archive);
        assert.throws(() => inspectOwners(root), /NATIVE_OWNER_/);
        assert.deepEqual(bytes(record.dir), before);
        assert.deepEqual(bytes(historical.archive), old);
        assert.equal(fs.existsSync(record.archive), false);
    });
}

test('interrupted empty archive reservation resumes without losing receipts', t => {
    const root = world(t), record = owner(root), before = bytes(record.dir);
    fs.mkdirSync(path.dirname(record.archive), {recursive:true, mode:0o700});
    inspectOwners(root);
    assert.deepEqual(bytes(record.archive), before);
    assert.equal(fs.existsSync(record.dir), false);
});

for (const kind of ['archive-symlink', 'shard-symlink', 'slot-collision']) {
    test(`${kind} refuses without replacing the destination or losing source receipts`, t => {
        const root = world(t), record = owner(root), before = bytes(record.dir);
        const archiveRoot = path.join(path.dirname(root),'archive-v1');
        const shard = path.dirname(path.dirname(record.archive));
        if (kind === 'archive-symlink') fs.symlinkSync(root, archiveRoot);
        else {
            fs.mkdirSync(archiveRoot, {mode:0o700});
            if (kind === 'shard-symlink') fs.symlinkSync(root, shard);
            else {
                fs.mkdirSync(shard, {mode:0o700});
                fs.mkdirSync(path.dirname(record.archive), {mode:0o700});
                fs.mkdirSync(record.archive, {mode:0o700});
            }
        }
        assert.throws(() => inspectOwners(root));
        assert.deepEqual(bytes(record.dir), before);
        if (kind === 'slot-collision') assert.deepEqual(fs.readdirSync(record.archive), []);
    });
}

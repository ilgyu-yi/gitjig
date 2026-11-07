import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const sourceProposalLimit = 16 * 1024 * 1024;
export interface SourceProposalArtifact { hash: string; bytes: number }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (s: Stats) => JSON.stringify([s.dev, s.ino, s.uid, s.mode]);
const leaf = (s: Stats) => JSON.stringify([s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs]);
function owned(s: Stats) {
    if (s.uid !== process.getuid?.() || s.isSymbolicLink() || s.mode & 0o077) throw Error('Private source proposal artifact required');
}
async function directory(file: string) {
    const s = await fs.lstat(file); owned(s);
    if (!s.isDirectory() || await fs.realpath(file) !== file) throw Error('Original source proposal directory unavailable');
    return identity(s);
}
async function namespace(home: string, create: boolean) {
    const paths = [home, path.join(home, 'artifacts'), path.join(home, 'artifacts/source-snapshot-proposals')];
    const snapshots: string[] = [];
    const assert = async () => { for (let i = 0; i < snapshots.length; i++) if (await directory(paths[i]!) !== snapshots[i]) throw Error('Source proposal namespace changed'); };
    for (const file of paths) {
        await assert();
        if (create && file !== home) try { await fs.mkdir(file, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        snapshots.push(await directory(file));
    }
    return { root: paths[2]!, assert, assertSync() {
        for (let i = 0; i < paths.length; i++) { const current = fsSync.lstatSync(paths[i]!); owned(current); if (!current.isDirectory() || fsSync.realpathSync(paths[i]!) !== paths[i] || identity(current) !== snapshots[i]) throw Error('Source proposal namespace changed'); }
    } };
}
async function sync(directory: string) {
    const h = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await h.sync(); } finally { await h.close(); }
}
function observedGuard(guard: () => void) {
    const started = performance.now();
    return () => { guard(); if (performance.now() - started > 5000) throw Error('Source proposal artifact IO exceeded 5 seconds; owned tail joined'); };
}
export async function verifySourceProposalArtifact(home: string, ref: SourceProposalArtifact, guard: () => void): Promise<{ body: unknown; assertCurrentMetadata(): void }> {
    if (!/^[a-f0-9]{64}$/u.test(ref.hash) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 2 || ref.bytes > sourceProposalLimit) throw Error('Source proposal artifact reference invalid');
    const check = observedGuard(guard); check();
    const ns = await namespace(home, false); check();
    const file = path.join(ns.root, ref.hash + '.json'); await ns.assert();
    const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const initial = await h.stat(); owned(initial);
        if (!initial.isFile() || initial.nlink !== 1 || initial.size !== ref.bytes) throw Error('Source proposal artifact file unavailable');
        const bytes = Buffer.alloc(ref.bytes + 1); let n = 0;
        while (n < bytes.length) { check(); const got = await h.read(bytes, n, bytes.length - n, null); if (!got.bytesRead) break; n += got.bytesRead; }
        const current = await fs.lstat(file);
        if (n !== ref.bytes || leaf(await h.stat()) !== leaf(initial) || leaf(current) !== leaf(initial) || digest(bytes.subarray(0, n)) !== ref.hash) throw Error('Source proposal artifact bytes changed');
        await ns.assert(); check();
        return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, n))), assertCurrentMetadata() { ns.assertSync(); const current = fsSync.lstatSync(file); owned(current); if (leaf(current) !== leaf(initial)) throw Error('Verified source proposal artifact changed'); } };
    } finally { await h.close(); }
}
export async function readSourceProposalArtifact(home: string, ref: SourceProposalArtifact, guard: () => void): Promise<unknown> {
    return (await verifySourceProposalArtifact(home, ref, guard)).body;
}
export async function writeSourceProposalArtifact(home: string, value: unknown, guard: () => void): Promise<SourceProposalArtifact> {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > sourceProposalLimit) throw Error('Source proposal artifact exceeds 16 MiB');
    const ref = { hash: digest(bytes), bytes: bytes.length }, check = observedGuard(guard); check();
    const ns = await namespace(home, true); check(); await ns.assert();
    const temporary = path.join(ns.root, '.' + randomUUID() + '.tmp'), final = path.join(ns.root, ref.hash + '.json');
    const h = await fs.open(temporary, 'wx', 0o600); let original: Stats | undefined, failure: unknown, failed = false;
    try {
        original = await h.stat();
        if (!original.isFile() || original.uid !== process.getuid?.() || original.nlink !== 1) throw Error('Exclusive source proposal temporary FD unavailable');
        await ns.assert(); check(); await h.chmod(0o600);
        const ready = await h.stat(); owned(ready); if (!ready.isFile() || ready.nlink !== 1) throw Error('Source proposal temporary FD changed');
        await h.writeFile(bytes); check(); await h.sync(); check();
        original = await h.stat();
        if (!original.isFile() || original.nlink !== 1 || original.size !== bytes.length || original.uid !== process.getuid?.()) throw Error('Source proposal temporary FD differs');
    } catch (e) { failure = e; failed = true; }
    try { await h.close(); } catch (e) { failure = failed ? new AggregateError([failure, e], 'Source proposal write/close failed') : e; failed = true; }
    try {
        if (failed) throw failure;
        await ns.assert(); check();
        if (!original || leaf(await fs.lstat(temporary)) !== leaf(original)) throw Error('Original source proposal temporary path changed');
        try { await fs.link(temporary, final); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    } catch (e) { failure = e; failed = true; }
    finally {
        try {
            await ns.assert(); const s = await fs.lstat(temporary);
            if (!original || s.dev !== original.dev || s.ino !== original.ino || s.uid !== original.uid || !s.isFile()) throw Error('Original source proposal temporary file changed; retained');
            await fs.unlink(temporary); await sync(ns.root); await sync(path.dirname(ns.root));
        } catch (e) { failure = failed ? new AggregateError([failure, e], 'Source proposal preparation and owned cleanup failed') : e; failed = true; }
    }
    if (failed) throw failure;
    check(); await readSourceProposalArtifact(home, ref, check); check(); return ref;
}

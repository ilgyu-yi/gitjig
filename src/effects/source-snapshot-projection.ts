import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest } from '../controller/capture.js';
import { effective } from '../controller/change-files.js';
import { validateDependencyLinks } from '../controller/capture-links.js';
import type { CapturedTree, ObjectFormat, SourceBasisEntry, SourceSnapshotBlob, SourceWholeFileAddition } from './types.js';

export const sourceCaptureLimits = Object.freeze({ maxEntries: 100000, maxBytes: 512 * 1024 * 1024 });
export const sourceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceStat = (s: Stats) => JSON.stringify([s.dev, s.ino, s.uid, s.nlink, s.mode, s.size, s.mtimeMs, s.ctimeMs]);
export const administration = (name: string) => name === '.git' || name.startsWith('.git/');
export interface SourceCaptureFile {
    path: string; sha256: string; size: number; effectiveMode: number; opaque: boolean; identity: string;
}
export interface SourceCapture {
    input: CapturedTree;
    files: Map<string, SourceCaptureFile>;
    identities: Map<string, string>;
}
function owned(stat: Stats) {
    if (stat.uid !== process.getuid?.() || stat.isSymbolicLink() || stat.mode & 0o022)
        throw Error('Source capture ownership/type changed');
}
/** Strict original full capture validation, independently of product selection. */
export async function inspectSourceCapture(input: CapturedTree, maxEntries: number, maxBytes: number, signal: AbortSignal): Promise<SourceCapture> {
    validateManifest(input.manifest);
    if (sourceHash(effective(input.manifest)) !== input.digest || input.manifest.entries > maxEntries || input.manifest.bytes > maxBytes)
        throw Error('Source capture effective identity/limit differs');
    if (!path.isAbsolute(input.root) || await fs.realpath(input.root) !== input.root) throw Error('Canonical source capture required');
    const identities = new Map<string, string>(), files = new Map<string, SourceCaptureFile>();
    const expectedFiles = new Map(input.manifest.files.map(f => [f.path, f]));
    const expectedDirs = new Map(input.manifest.directories.map(d => [d.path, d]));
    const links = new Map((input.manifest.dependencyLinks ?? []).map(l => [l.path, l.target]));
    const walk = async (relative: string) => {
        signal.throwIfAborted();
        const directory = path.join(input.root, relative), stat = await fs.lstat(directory);
        owned(stat);
        if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw Error('Captured directory type/mode differs');
        identities.set(relative, sourceStat(stat));
        const iterator = await fs.opendir(directory);
        for await (const entry of iterator) {
            signal.throwIfAborted();
            const name = entry.name;
            const rel = relative ? `${relative}/${name}` : name, file = path.join(input.root, rel), current = await fs.lstat(file);
            if (expectedDirs.has(rel)) {
                await walk(rel);
            } else if (links.has(rel)) {
                if (!current.isSymbolicLink() || current.uid !== process.getuid?.() || await fs.readlink(file) !== links.get(rel)) throw Error('Captured dependency link differs');
                identities.set(rel, sourceStat(current));
            } else {
                const expected = expectedFiles.get(rel);
                owned(current);
                if (!expected || !current.isFile() || current.nlink !== 1 || (current.mode & 0o777) !== expected.effectiveMode) throw Error('Captured file type/mode differs');
                const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                const hash = createHash('sha256'), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
                let size = 0, opaque = false;
                try {
                    if (sourceStat(await handle.stat()) !== sourceStat(current)) throw Error('Captured file identity differs');
                    const buffer = Buffer.alloc(64 * 1024);
                    while (true) {
                        signal.throwIfAborted();
                        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
                        if (!bytesRead) break;
                        size += bytesRead;
                        if (size > expected.size || size > maxBytes) throw Error('Captured file grew beyond original bound');
                        const chunk = buffer.subarray(0, bytesRead);
                        hash.update(chunk);
                        if (chunk.includes(0)) opaque = true;
                        if (!opaque) try { decoder.decode(chunk, { stream: true }); } catch { opaque = true; }
                    }
                    if (!opaque) try { decoder.decode(); } catch { opaque = true; }
                    if (sourceStat(await handle.stat()) !== sourceStat(current) || sourceStat(await fs.lstat(file)) !== sourceStat(current) ||
                        size !== expected.size || hash.digest('hex') !== expected.sha256) throw Error('Captured file bytes/identity changed');
                } finally { await handle.close(); }
                identities.set(rel, sourceStat(current));
                files.set(rel, { ...expected, opaque, identity: sourceStat(current) });
            }
            if (identities.size - 1 > maxEntries) throw Error('Source capture census exceeds bound');
        }
        if (sourceStat(await fs.lstat(directory)) !== sourceStat(stat)) throw Error('Captured directory changed during inspection');
    };
    await walk('');
    if (identities.size !== input.manifest.entries + 1 || files.size !== expectedFiles.size || [...expectedDirs.keys(), ...links.keys()].some(p => !identities.has(p)))
        throw Error('Source capture census incomplete');
    validateDependencyLinks(input.manifest.dependencyLinks ?? [], input.manifest.files, input.manifest.directories);
    return { input, files, identities };
}
export async function assertSourceCapture(capture: SourceCapture, signal: AbortSignal) {
    for (const [relative, identity] of capture.identities) {
        signal.throwIfAborted();
        if (sourceStat(await fs.lstat(path.join(capture.input.root, relative))) !== identity) throw Error('Original source capture changed');
    }
}
/** Final synchronous metadata correspondence after a host callback; bytes were already fully verified. */
export function assertSourceCaptureMetadata(capture: SourceCapture): void {
    for (const [relative, identity] of capture.identities)
        if (sourceStat(fsSync.lstatSync(path.join(capture.input.root, relative))) !== identity) throw Error('Original source capture changed before retention');
}
/** Copy only original bytes into a newly owned spool FD; no caller path reaches Git. */
export async function copySourceBlob(capture: SourceCapture, file: SourceCaptureFile, destination: string, signal: AbortSignal, assertDestination: () => Promise<void>) {
    const name = path.join(capture.input.root, file.path), source = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let output: Awaited<ReturnType<typeof fs.open>> | undefined, complete = false, failed = false, failure: unknown;
    try {
        if (sourceStat(await source.stat()) !== file.identity) throw Error('Original selected file changed');
        // Source FD preparation awaited: recheck the captured destination
        // namespace for EVERY new leaf, then again before writing its bytes.
        await assertDestination();
        output = await fs.open(destination, 'wx', 0o600);
        await assertDestination();
        await output.chmod(0o600);
        const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
        let size = 0;
        while (true) {
            signal.throwIfAborted();
            const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            size += bytesRead;
            if (size > file.size) throw Error('Original selected file grew');
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk); await output.writeFile(chunk);
        }
        if (size !== file.size || hash.digest('hex') !== file.sha256 || sourceStat(await source.stat()) !== file.identity || sourceStat(await fs.lstat(name)) !== file.identity)
            throw Error('Original selected file bytes changed');
        await output.sync();
        const stat = await output.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size !== file.size)
            throw Error('Owned spool file differs');
        complete = true;
        return sourceStat(stat);
    } catch (error) { failed = true; failure = error; throw error; } finally {
        try {
            if (output) {
                let stat: Stats;
                try { stat = await output.stat(); } finally { await output.close(); }
                if (!complete) {
                    await assertDestination();
                    const current = await fs.lstat(destination);
                    if (sourceStat(current) !== sourceStat(stat)) throw Error('Failed spool residue identity changed');
                    await fs.unlink(destination);
                }
            }
        } catch (cleanupError) {
            throw new AggregateError(failed ? [failure, cleanupError] : [cleanupError],
                'Owned spool file cleanup failed; ' + (failed ? 'original: ' + String(failure).slice(0, 2048) + '; ' : '') +
                'inert residue: ' + String(cleanupError).slice(0, 2048));
        } finally { await source.close(); }
    }
}
export function parseSourceOids(bytes: Buffer, count: number, format: ObjectFormat): string[] {
    const output = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const rows = output.endsWith('\n') ? output.slice(0, -1).split('\n') : [];
    const pattern = format === 'sha1' ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u;
    if (rows.length !== count || rows.some(row => !pattern.test(row))) throw Error('Incomplete or malformed ordered native object response');
    return rows;
}
/** All-tree listing is used only by the new projection to detect unsupported empty subtrees. */
export function parseSourceTree(bytes: Buffer, format: ObjectFormat, maxEntries: number): SourceBasisEntry[] {
    if (bytes.length && bytes.at(-1) !== 0) throw Error('Source tree listing truncated');
    const rows = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).split('\0').slice(0, -1);
    const leaves: SourceBasisEntry[] = [], directories: string[] = [], seen = new Set<string>();
    for (const row of rows) {
        const match = /^(040000|100644|100755|120000|160000) (tree|blob|commit) ([a-f0-9]+) +([0-9]+|-)\t([\s\S]+)$/u.exec(row);
        if (!match || seen.size >= maxEntries) throw Error('Unsupported source tree metadata/limit');
        const [, mode, type, oid, length, name] = match;
        const valid = format === 'sha1' ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u;
        if (!valid.test(oid!) || !name || Buffer.byteLength(name) > 4096 || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || seen.has(name))
            throw Error('Unsafe/duplicate source tree path');
        seen.add(name);
        if (mode === '040000') {
            if (type !== 'tree' || length !== '-') throw Error('Source directory metadata differs');
            directories.push(name);
        } else {
            const size = length === '-' ? null : Number(length);
            if (mode === '160000' ? type !== 'commit' || size !== null : type !== 'blob' || size === null || !Number.isSafeInteger(size) || size < 0)
                throw Error('Source leaf type/size differs');
            leaves.push({ path: name, mode: mode as SourceBasisEntry['mode'], type: type as SourceBasisEntry['type'], objectId: oid!, size });
        }
    }
    const populated = new Set<string>();
    for (const leaf of leaves) {
        const parts = leaf.path.split('/'); parts.pop();
        let parent = '';
        for (const part of parts) { parent = parent ? parent + '/' + part : part; populated.add(parent); }
    }
    if (directories.some(dir => !populated.has(dir))) throw Error('Explicit empty source subtree unsupported');
    return leaves;
}

/** Full retained-C namespace relation. It never repairs or materializes a changed view. */
export function sourceContextRelation(candidate: CapturedTree, product: ReadonlySet<string>, projected: readonly SourceBasisEntry[],
    candidateOids: ReadonlyMap<string, string>) {
    const files = new Map(candidate.manifest.files.map(f => [f.path, f]));
    const dirs = new Set(candidate.manifest.directories.map(d => d.path));
    const links = new Set((candidate.manifest.dependencyLinks ?? []).map(l => l.path));
    const h = new Map(projected.map(f => [f.path, f]));
    const differences: { path: string; reason: string }[] = [];
    let conflict = false;
    for (const entry of projected) {
        if (!product.has(entry.path)) throw Error('Projected leaf outside exact product domain');
        const parents = entry.path.split('/').slice(0, -1);
        let prefix = '';
        for (const part of parents) {
            prefix = prefix ? `${prefix}/${part}` : part;
            if (files.has(prefix) || links.has(prefix)) {
                conflict = true; differences.push({ path: prefix, reason: 'Product parent collides with retained C leaf' });
            } else if (!dirs.has(prefix)) differences.push({ path: prefix, reason: 'Product requires directory absent from C' });
        }
        if (dirs.has(entry.path) || links.has(entry.path)) {
            conflict = true; differences.push({ path: entry.path, reason: 'Product leaf collides with retained C directory/link' });
        }
        const c = files.get(entry.path);
        if (!c || candidateOids.get(entry.path) !== entry.objectId || c.size !== entry.size || !!(c.effectiveMode & 0o111) !== (entry.mode === '100755'))
            differences.push({ path: entry.path, reason: !c ? 'Basis product absent from C' : 'Product bytes or Git executable bit differ from C' });
    }
    for (const name of product) if (files.has(name) && !h.has(name)) differences.push({ path: name, reason: 'Product removes C file' });
    // In the identical case the entire effective D namespace is exactly C, so
    // its original complete graph is the prospective graph, not a partial list.
    if (!differences.length) validateDependencyLinks(candidate.manifest.dependencyLinks ?? [], candidate.manifest.files, candidate.manifest.directories);
    return { kind: conflict ? 'structural-conflict' as const : differences.length ? 'nonidentity' as const : 'identical' as const, differences };
}

/** Publication baseline is not the original capture: absent K paths are new Git files. */
export function sourcePublicationBaseline(product: ReadonlySet<string>, tracked: ReadonlySet<string>, blobs: readonly SourceSnapshotBlob[]) {
    const base = new Map(blobs.filter(blob => blob.side === 'base').map(blob => [blob.path, blob]));
    const candidate = new Map(blobs.filter(blob => blob.side === 'candidate').map(blob => [blob.path, blob]));
    const omittedBasePaths = new Set([...product].filter(name => !tracked.has(name)).sort());
    const wholeFileAdditions: SourceWholeFileAddition[] = [];
    for (const name of omittedBasePaths) {
        const after = candidate.get(name), before = base.get(name);
        if (after) wholeFileAdditions.push({ path: name, capturedBasePresent: !!before,
            baseBlob: before?.objectId ?? null, baseSha256: before?.sha256 ?? null,
            candidateBlob: after.objectId, candidateSha256: after.sha256, size: after.size, effectiveMode: after.effectiveMode });
    }
    return { omittedBasePaths, wholeFileAdditions };
}

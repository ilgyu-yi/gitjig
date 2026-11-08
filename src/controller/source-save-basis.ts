import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest } from './capture.js';
import { effective, hash } from './change-files.js';
import type { SourceSaveInputSnapshot } from './effect-types.js';
import type { ObjectFormat } from '../effects/types.js';

export const capturedGitBasisLimits = Object.freeze({ headBytes: 4096, referenceBytes: 4096, packedBytes: 1024 * 1024 });
export interface CapturedGitBasis {
    baseVersionId: string;
    baseDigest: string;
    objectFormat: ObjectFormat;
    commit: string;
    reference: string | null;
    metadata: readonly { path: string; sha256: string; size: number }[];
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const utf8 = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const sameDirectory = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
function branchReference(value: string): boolean {
    return value.startsWith('refs/heads/') && !/[\x00-\x20\x7f~^:?*\[\\]/u.test(value) && !value.includes('..') && !value.includes('@{') &&
        value.split('/').every(part => !!part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}
/** Read original capture facts only. Never invokes Git, loads its config or reads a later source tree. */
export async function resolveCapturedGitBasis(base: SourceSaveInputSnapshot['base'], objectFormat?: ObjectFormat, signal?: AbortSignal): Promise<CapturedGitBasis> {
    const input = structuredClone(base);
    signal?.throwIfAborted();
    if (input.kind !== 'base' || !input.versionId || (objectFormat !== undefined && !['sha1', 'sha256'].includes(objectFormat)) || !path.isAbsolute(input.root) || path.resolve(input.root) !== input.root)
        throw Error('Original selected base capture required');
    const manifest = validateManifest(input.manifest);
    if (hash(effective(manifest)) !== input.digest) throw Error('Original base effective digest differs');
    const files = new Map(manifest.files.map(file => [file.path, file])), directories = new Set(manifest.directories.map(directory => directory.path));
    if (files.has('.git') || !directories.has('.git') || [...files.keys(), ...directories].some(name => name === '.git/commondir' || name === '.git/gitdir' || name === '.git/reftable' || name.startsWith('.git/reftable/')) ||
        ['.git/objects/info/alternates', '.git/shallow', '.git/info/grafts'].some(name => (files.get(name)?.size ?? 0) > 0))
        throw Error('Captured Git layout is outside the supported root-repository profile');
    const root = await fs.lstat(input.root);
    signal?.throwIfAborted();
    if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || (root.mode & 0o777) !== 0o700 || await fs.realpath(input.root) !== input.root)
        throw Error('Original base artifact root unavailable');
    const metadata: { path: string; sha256: string; size: number }[] = [];
    const read = async (relative: string, limit: number) => {
        signal?.throwIfAborted();
        const entry = files.get(relative);
        if (!entry || entry.size > limit) throw Error('Original captured Git metadata missing or exceeds its finite byte limit');
        const ancestors: { file: string; stat: Stats }[] = [{ file: input.root, stat: root }];
        let ancestor = input.root;
        for (const part of relative.split('/').slice(0, -1)) {
            ancestor = path.join(ancestor, part);
            const name = path.relative(input.root, ancestor);
            if (!directories.has(name)) throw Error('Captured Git metadata ancestor is not recorded');
            const stat = await fs.lstat(ancestor);
            signal?.throwIfAborted();
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== root.uid || (stat.mode & 0o777) !== 0o700 || await fs.realpath(ancestor) !== ancestor)
                throw Error('Captured Git metadata ancestor unavailable');
            ancestors.push({ file: ancestor, stat });
        }
        const file = path.join(input.root, relative), handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let bytes: Buffer;
        try {
            signal?.throwIfAborted();
            const before = await handle.stat();
            if (!before.isFile() || before.nlink !== 1 || before.uid !== root.uid || before.mode & 0o066 || before.size !== entry.size ||
                (before.mode & 0o111) !== (entry.effectiveMode & 0o111)) throw Error('Captured Git metadata is not its original regular file');
            const buffer = Buffer.alloc(entry.size + 1);
            let count = 0;
            while (count < buffer.length) {
                signal?.throwIfAborted();
                const result = await handle.read(buffer, count, buffer.length - count, count);
                if (!result.bytesRead) break;
                count += result.bytesRead;
            }
            const after = await handle.stat(), current = await fs.lstat(file);
            if (count !== entry.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
                !current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino || current.uid !== before.uid ||
                current.nlink !== 1 || current.mode !== before.mode || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs)
                throw Error('Captured Git metadata changed during read');
            bytes = buffer.subarray(0, count);
            if (sha(bytes) !== entry.sha256) throw Error('Captured Git metadata hash differs');
        } finally { await handle.close(); }
        for (const captured of ancestors) {
            const current = await fs.lstat(captured.file);
            if (!sameDirectory(captured.stat, current) || current.isSymbolicLink() || await fs.realpath(captured.file) !== captured.file)
                throw Error('Captured Git metadata namespace changed');
        }
        signal?.throwIfAborted();
        metadata.push({ path: relative, sha256: entry.sha256, size: entry.size });
        return utf8(bytes);
    };
    const oid = (value: string, format = objectFormat) => {
        if (!(format === 'sha1' ? /^[a-f0-9]{40}$/u : format === 'sha256' ? /^[a-f0-9]{64}$/u : /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).test(value) || /^0+$/u.test(value))
            throw Error('Captured Git object ID does not match the observed source format');
        return value;
    };
    const line = (value: string) => {
        const stripped = value.endsWith('\n') ? value.slice(0, -1) : value;
        if (!stripped || /[\r\n\0]/u.test(stripped)) throw Error('Captured Git metadata is not one authoritative line');
        return stripped;
    };
    const packedObjects: string[] = [];
    const head = line(await read('.git/HEAD', capturedGitBasisLimits.headBytes));
    let commit: string, reference: string | null = null;
    if (head.startsWith('ref: ')) {
        reference = head.slice(5);
        if (!branchReference(reference)) throw Error('Captured Git HEAD reference is unsafe or unsupported');
        const loose = '.git/' + reference;
        if (files.has(loose)) commit = oid(line(await read(loose, capturedGitBasisLimits.referenceBytes)));
        else {
            const packed = await read('.git/packed-refs', capturedGitBasisLimits.packedBytes), matches: string[] = [];
            for (const record of packed.split('\n')) {
                if (!record || record.startsWith('#')) continue;
                if (record.startsWith('^')) { packedObjects.push(oid(record.slice(1))); continue; }
                const separator = record.indexOf(' ');
                if (separator < 1 || record.indexOf(' ', separator + 1) >= 0 || /[\r\0]/u.test(record)) throw Error('Captured packed references malformed');
                const object = oid(record.slice(0, separator)), ref = record.slice(separator + 1);
                packedObjects.push(object);
                if (ref === reference) matches.push(object);
            }
            if (matches.length !== 1) throw Error('Captured selected packed reference is missing or ambiguous');
            commit = matches[0]!;
        }
    } else commit = oid(head);
    // Only the selected captured OID supplies inference. Other packed objects
    // corroborate that classification; they never choose it. Native observation
    // must still verify the actual repository format and selected commit.
    const selectedFormat: ObjectFormat = commit.length === 40 ? 'sha1' : 'sha256';
    for (const object of packedObjects) oid(object, selectedFormat);
    return { baseVersionId: input.versionId, baseDigest: input.digest, objectFormat: selectedFormat, commit, reference, metadata };
}

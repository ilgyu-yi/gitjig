import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export type Asset = {
    path: string;
    kind: 'directory';
    mode: number;
} | {
    path: string;
    kind: 'file';
    mode: number;
    bytes: number;
    sha256: string;
} | {
    path: string;
    kind: 'symlink';
    mode: number;
    target: string;
};
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
function name(value: string) {
    if (!value || value === '.' || value === '..' || value.normalize('NFC') !== value || /[\x00-\x1f\x7f\\]/u.test(value))
        throw Error('Unsupported installation asset name');
}
/** Bounded full-tree inventory, independent of git tracking. Symlinks must resolve within this tree. */
export async function inventoryTree(root: string): Promise<Asset[]> {
    if (!path.isAbsolute(root) || await fs.realpath(root) !== root)
        throw Error('Canonical asset root required');
    const assets: Asset[] = [];
    const buffer = Buffer.alloc(128 * 1024);
    let bytes = 0;
    async function walk(directory: string) {
        const names = (await fs.readdir(directory)).sort();
        const folded = new Set<string>();
        for (const leaf of names) {
            name(leaf);
            const key = leaf.toLowerCase();
            if (folded.has(key))
                throw Error('Case-colliding installation asset');
            folded.add(key);
            if (assets.length >= 100000)
                throw Error('Installation asset count limit exceeded');
            const file = path.join(directory, leaf), relative = path.relative(root, file).split(path.sep).join('/'), stat = await fs.lstat(file), mode = stat.mode & 0o777;
            if (stat.isSymbolicLink()) {
                const target = await fs.readlink(file);
                if (path.isAbsolute(target) || !inside(root, path.resolve(directory, target)) || !inside(root, await fs.realpath(file)))
                    throw Error('Installation symlink escapes owned tree');
                assets.push({ path: relative, kind: 'symlink', mode, target });
            }
            else if (stat.isDirectory()) {
                assets.push({ path: relative, kind: 'directory', mode });
                await walk(file);
            }
            else if (stat.isFile()) {
                if (stat.size > 256 * 1024 * 1024)
                    throw Error('Installation single-asset byte limit exceeded');
                bytes += stat.size;
                if (bytes > 1024 * 1024 * 1024)
                    throw Error('Installation asset byte limit exceeded');
                const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try {
                    const opened = await h.stat();
                    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev)
                        throw Error('Installation asset changed during inventory');
                    const digest = createHash('sha256');
                    let read = 0;
                    while (read <= stat.size) {
                        const length = Math.min(buffer.length, stat.size + 1 - read);
                        const { bytesRead } = await h.read(buffer, 0, length, read);
                        if (!bytesRead)
                            break;
                        digest.update(buffer.subarray(0, bytesRead));
                        read += bytesRead;
                    }
                    const end = await h.stat();
                    if (read !== stat.size || end.size !== opened.size || end.mtimeMs !== opened.mtimeMs || end.ctimeMs !== opened.ctimeMs)
                        throw Error('Installation asset changed during read');
                    assets.push({ path: relative, kind: 'file', mode, bytes: read, sha256: digest.digest('hex') });
                }
                finally {
                    await h.close();
                }
            }
            else
                throw Error('Unsupported installation asset type');
        }
    }
    await walk(root);
    return assets;
}
export const assetIdentity = (assets: readonly Asset[]) => hash(JSON.stringify(assets));

export function matchesAssetInventory(actual: readonly Asset[], expected: readonly Asset[], identity: string): boolean {
    const encoded = JSON.stringify(actual);
    return hash(encoded) === identity && encoded === JSON.stringify(expected);
}
type CreatedAsset = { file: string; stat: BigIntStats };

function recordCreated(created: CreatedAsset[], file: string, kind: Asset['kind'], stat: BigIntStats) {
    const expected = kind === 'directory' ? stat.isDirectory() : kind === 'file' ? stat.isFile() : stat.isSymbolicLink();
    if (!expected || stat.uid !== BigInt(process.getuid?.() ?? -1) ||
        !stat.isSymbolicLink() && (stat.mode & 0o077n) !== 0n || stat.isFile() && stat.nlink !== 1n)
        throw Error('Unable to verify created installation entry: ' + file);
    created.push({ file, stat });
}

function assertCreatedAsset(asset: CreatedAsset, actual: BigIntStats) {
    const {stat} = asset;
    if (!sameEntry(stat, actual) ||
        !actual.isSymbolicLink() && (actual.mode & 0o077n) !== 0n || actual.isFile() && actual.nlink !== 1n)
        throw Error('Staged installation entry changed during cleanup: ' + asset.file);
}
function sameEntry(expected: BigIntStats, actual: BigIntStats) {
    return expected.dev === actual.dev && expected.ino === actual.ino && expected.uid === actual.uid &&
        (expected.mode & 0o170000n) === (actual.mode & 0o170000n);
}

/** Restore write access only on known directories. A foreign child prevents rmdir. */
async function rollbackCopy(created: readonly CreatedAsset[], anchor: CreatedAsset) {
    const directories = new Map(created.filter(asset => asset.stat.isDirectory()).map(asset => [asset.file, asset]));
    async function assertParents(file: string) {
        let parent = path.dirname(file);
        if (await fs.realpath(parent) !== parent || !sameEntry(anchor.stat, await fs.lstat(anchor.file, { bigint: true })))
            throw Error('Staged installation parent changed during cleanup: ' + parent);
        while (parent !== anchor.file) {
            const owned = directories.get(parent);
            if (!owned) throw Error('Unverified staged installation parent: ' + parent);
            assertCreatedAsset(owned, await fs.lstat(parent, { bigint: true }));
            parent = path.dirname(parent);
        }
    }
    for (const asset of created) {
        if (!asset.stat.isDirectory()) continue;
        await assertParents(asset.file);
        const directory = await fs.open(asset.file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
            assertCreatedAsset(asset, await directory.stat({ bigint: true }));
            await directory.chmod(0o700);
        } finally {
            await directory.close();
        }
    }
    for (const asset of [...created].reverse()) {
        await assertParents(asset.file);
        assertCreatedAsset(asset, await fs.lstat(asset.file, { bigint: true }));
        if (asset.stat.isDirectory()) await fs.rmdir(asset.file);
        else await fs.unlink(asset.file);
    }
}
/** Copy into a fresh owned tree and optionally promote it under the same parent. */
export async function copyAssetTree(source: string, destination: string, promotion?: {
    destination: string;
    expectedIdentity: string;
}): Promise<Asset[]> {
    const parent = path.dirname(destination);
    if (promotion && (path.resolve(promotion.destination) !== promotion.destination || path.dirname(promotion.destination) !== parent || promotion.destination === destination))
        throw Error('Installation promotion requires a distinct destination under the staging parent');
    const original = await inventoryTree(source);
    if (promotion && assetIdentity(original) !== promotion.expectedIdentity)
        throw Error('Bundle assets changed before copying. Review the bundle and retry staging.');
    const anchor = { file: parent, stat: await fs.lstat(parent, { bigint: true }) };
    if (!anchor.stat.isDirectory() || await fs.realpath(parent) !== parent)
        throw Error('Canonical installation destination parent required');
    await fs.mkdir(destination, { mode: 0o700 });
    const created: CreatedAsset[] = [];
    try {
        const stage = await fs.lstat(destination, { bigint: true });
        recordCreated(created, destination, 'directory', stage);
        const copied = await copyInventoriedAssets(source, destination, original, created);
        if (promotion) {
            if (assetIdentity(copied) !== promotion.expectedIdentity)
                throw Error('Copied bundle assets differ from the verified manifest. Review the bundle and retry staging.');
            try {
                await fs.lstat(promotion.destination);
                throw Error('Installation promotion destination already exists: ' + promotion.destination);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            if (!sameEntry(anchor.stat, await fs.lstat(parent, { bigint: true })) ||
                !sameEntry(stage, await fs.lstat(destination, { bigint: true })))
                throw Error('Owned installation stage changed before promotion');
            await fs.rename(destination, promotion.destination);
        }
        return copied;
    } catch (error) {
        if (!created.length) throw error;
        try {
            await rollbackCopy(created, anchor);
        } catch (cleanup) {
            throw new AggregateError([error, cleanup], 'Unable to copy installation assets and clean the unfinished stage. ' + String(error) + ' · ' + String(cleanup), { cause: error });
        }
        throw error;
    }
}

async function copyInventoriedAssets(source: string, destination: string, original: readonly Asset[], created: CreatedAsset[]): Promise<Asset[]> {
    for (const asset of original) {
        const from = path.join(source, asset.path), to = path.join(destination, asset.path);
        if (asset.kind === 'directory') {
            await fs.mkdir(to, { mode: 0o700 });
            recordCreated(created, to, asset.kind, await fs.lstat(to, { bigint: true }));
        }
        else if (asset.kind === 'symlink') {
            await fs.symlink(asset.target, to);
            const link = await fs.lstat(to, { bigint: true });
            recordCreated(created, to, asset.kind, link);
            // On filesystems with mutable symlink modes, creation inherits the caller's umask.
            if ((link.mode & 0o777n) !== BigInt(asset.mode)) {
                await fs.lchmod(to, asset.mode);
                if (!sameEntry(link, await fs.lstat(to, { bigint: true })))
                    throw Error('Staged installation symlink changed while restoring mode: ' + to);
            }
        }
        else {
            const handle = await fs.open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const opened = await handle.stat();
                if (!opened.isFile() || opened.size !== asset.bytes)
                    throw Error('Installation source changed type or size during copy');
                const buffer = Buffer.alloc(asset.bytes + 1);
                let read = 0;
                while (read < buffer.length) {
                    const n = await handle.read(buffer, read, buffer.length - read, read);
                    if (!n.bytesRead)
                        break;
                    read += n.bytesRead;
                }
                const data = buffer.subarray(0, read);
                if (data.length !== asset.bytes || hash(data) !== asset.sha256)
                    throw Error('Installation source changed during copy');
                const output = await fs.open(to, 'wx', asset.mode & 0o111 ? 0o500 : 0o400);
                try {
                    recordCreated(created, to, asset.kind, await output.stat({ bigint: true }));
                    await output.writeFile(data);
                } finally {
                    await output.close();
                }
            }
            finally {
                await handle.close();
            }
        }
    }
    // Directories stay writable until every child has been created.
    for (const asset of [...original].reverse())
        if (asset.kind === 'directory')
            await fs.chmod(path.join(destination, asset.path), 0o500);
    await fs.chmod(destination, 0o500);
    const copied = await inventoryTree(destination);
    for (let i = 0; i < original.length; i++) {
        const a = original[i]!, b = copied[i]!;
        if (a.path !== b.path || a.kind !== b.kind || (a.kind === 'file' && (b.kind !== 'file' || a.sha256 !== b.sha256 || a.bytes !== b.bytes)) || (a.kind === 'symlink' && (b.kind !== 'symlink' || a.target !== b.target || a.mode !== b.mode)))
            throw Error('Copied installation assets differ');
    }
    if (copied.length !== original.length)
        throw Error('Copied installation inventory differs');
    return copied;
}

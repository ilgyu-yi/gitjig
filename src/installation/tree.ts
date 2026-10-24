import fs from 'node:fs/promises';
import { constants } from 'node:fs';
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
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
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
                    const data = Buffer.alloc(stat.size + 1);
                    let read = 0;
                    while (read < data.length) {
                        const n = await h.read(data, read, data.length - read, read);
                        if (!n.bytesRead)
                            break;
                        read += n.bytesRead;
                    }
                    const contents = data.subarray(0, read);
                    const end = await h.stat();
                    if (contents.length !== stat.size || end.size !== opened.size || end.mtimeMs !== opened.mtimeMs || end.ctimeMs !== opened.ctimeMs)
                        throw Error('Installation asset changed during read');
                    assets.push({ path: relative, kind: 'file', mode, bytes: contents.length, sha256: hash(contents) });
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
export const assetIdentity = (assets: readonly Asset[]) => hash(Buffer.from(JSON.stringify(assets)));
/** Copy bytes into a fresh owned tree. Never preserve source/cache hardlinks. */
export async function copyAssetTree(source: string, destination: string): Promise<Asset[]> {
    const original = await inventoryTree(source);
    await fs.mkdir(destination, { mode: 0o700 });
    for (const asset of original) {
        const from = path.join(source, asset.path), to = path.join(destination, asset.path);
        if (asset.kind === 'directory')
            await fs.mkdir(to, { mode: 0o700 });
        else if (asset.kind === 'symlink')
            await fs.symlink(asset.target, to);
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
                await fs.writeFile(to, data, { flag: 'wx', mode: asset.mode & 0o111 ? 0o500 : 0o400 });
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
        if (a.path !== b.path || a.kind !== b.kind || (a.kind === 'file' && (b.kind !== 'file' || a.sha256 !== b.sha256 || a.bytes !== b.bytes)) || (a.kind === 'symlink' && (b.kind !== 'symlink' || a.target !== b.target)))
            throw Error('Copied installation assets differ');
    }
    if (copied.length !== original.length)
        throw Error('Copied installation inventory differs');
    return copied;
}

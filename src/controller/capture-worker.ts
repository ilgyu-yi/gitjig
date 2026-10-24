import { captureNormalization, dependencyLinkNormalization, validateDependencyLinks, type DependencyLink } from './capture-links.js';
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { source, target, maxEntries, maxBytes } = workerData as {
    source: string;
    target: string;
    maxEntries: number;
    maxBytes: number;
};
async function scan(copy: boolean) {
    let entries = 0, bytes = 0;
    const dependencyLinks: DependencyLink[] = [];
    const files: {
        path: string;
        sha256: string;
        size: number;
        mode: number;
        effectiveMode: number;
    }[] = [], directories: {
        path: string;
        mode: number;
        effectiveMode: number;
    }[] = [];
    async function walk(relative: string) {
        const directory = path.join(source, relative);
        const iterator = await fs.opendir(directory);
        for await (const entry of iterator) {
            if (++entries > maxEntries)
                throw new Error(`capture entries exceed ${maxEntries}`);
            const rel = path.join(relative, entry.name), name = path.join(source, rel), stat = await fs.lstat(name);
            if (stat.isSymbolicLink()) {
                if (!rel.split(path.sep).slice(0, -1).includes('node_modules'))
                    throw new Error(`unsupported capture entry: ${JSON.stringify(rel)} (symbolic link outside node_modules). Full project capture includes Git-ignored files. Move temporary evidence outside the project, or replace this link with supported project files, then retry the original request. The link target was not followed.`);
                const link = await fs.readlink(name), after = await fs.lstat(name);
                if (!after.isSymbolicLink() || stat.ino !== after.ino || stat.dev !== after.dev ||
                    stat.ctimeMs !== after.ctimeMs || link !== await fs.readlink(name)) {
                    throw Error(`source changed during capture: ${rel}`);
                }
                bytes += Buffer.byteLength(link);
                if (bytes > maxBytes)
                    throw new Error(`capture bytes exceed ${maxBytes}`);
                dependencyLinks.push({ path: rel, target: link });
                if (copy)
                    await fs.symlink(link, path.join(target, rel));
                continue;
            }
            if (!stat.isFile() && !stat.isDirectory())
                throw new Error(`unsupported capture entry: ${rel}`);
            if (stat.isDirectory()) {
                directories.push({ path: rel, mode: stat.mode & 0o777, effectiveMode: 0o700 });
                if (copy)
                    await fs.mkdir(path.join(target, rel), { mode: 0o700 });
                await walk(rel);
                continue;
            }
            const file = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            let output;
            try {
                const before = await file.stat();
                if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev)
                    throw new Error(`capture identity changed: ${rel}`);
                if (copy)
                    output = await fs.open(path.join(target, rel), 'wx', 0o600 | (before.mode & 0o111));
                const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
                let size = 0;
                while (true) {
                    const read = await file.read(buffer, 0, buffer.length, null);
                    if (!read.bytesRead)
                        break;
                    bytes += read.bytesRead;
                    if (bytes > maxBytes)
                        throw new Error(`capture bytes exceed ${maxBytes}`);
                    size += read.bytesRead;
                    const chunk = buffer.subarray(0, read.bytesRead);
                    hash.update(chunk);
                    if (output)
                        await output.writeFile(chunk);
                }
                const after = await file.stat(), now = await fs.lstat(name);
                if (after.size !== size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || now.ino !== before.ino || now.dev !== before.dev)
                    throw new Error(`source changed during capture: ${rel}`);
                files.push({ path: rel, sha256: hash.digest('hex'), size, mode: before.mode & 0o777, effectiveMode: 0o600 | (before.mode & 0o111) });
            }
            finally {
                await output?.close();
                await file.close();
            }
        }
    }
    await walk('');
    files.sort((a, b) => a.path.localeCompare(b.path));
    directories.sort((a, b) => a.path.localeCompare(b.path));
    dependencyLinks.sort((a, b) => a.path.localeCompare(b.path));
    validateDependencyLinks(dependencyLinks, files, directories);
    return { entries, bytes, files, directories, ...(dependencyLinks.length ? { dependencyLinks } : {}), normalization: dependencyLinks.length ? dependencyLinkNormalization : captureNormalization };
}
parentPort!.once('message', async (message) => {
    if (message !== 'GO')
        return;
    try {
        const first = await scan(true), second = await scan(false);
        if (JSON.stringify(first) !== JSON.stringify(second))
            throw new Error('source census/content changed');
        const digest = createHash('sha256').update(JSON.stringify(first)).digest('hex');
        parentPort!.postMessage({ ok: true, manifest: { ...first, digest, passes: 2 } });
    }
    catch (error) {
        parentPort!.postMessage({ ok: false, error: String(error) });
    }
    finally {
        parentPort!.close();
    }
});

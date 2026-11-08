/** Builtins-only storage checks shared by the owned bootstrap child runner. */
import fs from 'node:fs/promises';
export async function privateDirectory(directory: string) {
    try {
        await fs.mkdir(directory, { mode: 0o700 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || await fs.realpath(directory) !== directory)
        throw Error('Installation storage is not canonical owner-only directory: ' + directory);
}
export async function privateFile(file: string) {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
            throw Error('Unsafe installation metadata leaf: ' + file);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
}
export async function readPrivateJson(file: string, maxBytes = 16384) {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0 || stat.size > maxBytes)
            throw Error('Unsafe or oversized installation metadata: ' + file);
        const bytes = Buffer.alloc(maxBytes + 1);
        let size = 0;
        while (size < bytes.length) {
            const n = await handle.read(bytes, size, bytes.length - size, null);
            if (!n.bytesRead)
                break;
            size += n.bytesRead;
        }
        if (size > maxBytes)
            throw Error('Installation metadata byte limit');
        return JSON.parse(bytes.subarray(0, size).toString('utf8'));
    }
    finally {
        await handle.close();
    }
}

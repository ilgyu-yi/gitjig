import { constants } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { parseUniqueJson } from '../workflow/json.js';
/** Host configuration is read once, outside mutable project inputs. No SDK import. */
export async function readOwnerJson(file: string, projectRoots: readonly string[], label: string, limit: number): Promise<unknown> {
    if (!isAbsolute(file) || await realpath(file) !== file)
        throw new Error(`${label} must be an explicit canonical absolute path`);
    for (const root of projectRoots) {
        const rel = relative(root, file);
        if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
            throw new Error(`${label} belongs outside registered project input`);
        }
    }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > limit) {
            throw new Error(`${label} requires an owner-only regular file within its byte limit`);
        }
        const buffer = Buffer.alloc(limit + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
            const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
            if (!read.bytesRead)
                break;
            bytesRead += read.bytesRead;
        }
        if (bytesRead > limit)
            throw new Error(`${label} exceeds its byte limit`);
        if (!isUtf8(buffer.subarray(0, bytesRead)))
            throw new Error(`${label} requires valid UTF-8`);
        try {
            return parseUniqueJson(buffer.subarray(0, bytesRead).toString('utf8'));
        }
        catch {
            throw new Error(`${label} contains invalid or ambiguous JSON`);
        }
    }
    finally {
        await handle.close();
    }
}

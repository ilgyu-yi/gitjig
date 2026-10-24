import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
export class InvalidConfigurationJsonError extends Error {
    constructor() { super('Application configuration requires valid JSON; repair the selected file'); }
}
export function directory(file: string, privateMode: boolean, create = false): void {
    if (create)
        try {
            mkdirSync(file, { mode: privateMode ? 0o700 : 0o755 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
    const info = lstatSync(file);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(file) !== file ||
        (process.getuid && info.uid !== process.getuid()) || (info.mode & (privateMode ? 0o077 : 0o022)))
        throw new Error('Unsafe gitjig settings directory');
}
/** No default Pi paths, helper execution, symlink following or unbounded reads. */
export function readObject(file: string, privateMode: boolean, snapshot?: (bytes: Buffer) => void): JsonObject {
    let handle: number;
    try {
        handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            snapshot?.(Buffer.alloc(0));
            return {};
        }
        throw error;
    }
    try {
        const info = fstatSync(handle);
        if (!info.isFile() || info.nlink !== 1 || info.size > 128 * 1024 ||
            (process.getuid && info.uid !== process.getuid()) || (info.mode & (privateMode ? 0o077 : 0o022)))
            throw new Error('Unsafe or oversized gitjig settings file');
        const buffer = Buffer.alloc(128 * 1024 + 1);
        let count = 0, next = 0;
        while (count < buffer.length && (next = readSync(handle, buffer, count, buffer.length - count, null)) > 0)
            count += next;
        if (count > 128 * 1024)
            throw new Error('Oversized gitjig settings file');
        snapshot?.(buffer.subarray(0, count));
        let value: unknown;
        try {
            value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
        }
        catch {
            throw new InvalidConfigurationJsonError();
        }
        if (!object(value))
            throw new InvalidConfigurationJsonError();
        return value;
    }
    finally {
        closeSync(handle);
    }
}
export function encodeObject(value: JsonObject): string {
    const encoded = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(encoded, 'utf8') > 128 * 1024)
        throw new Error('Settings update exceeds the 128KiB storage limit; use a smaller value');
    return encoded;
}
export function writeObject(file: string, value: JsonObject, assertOwner: () => void): void {
    assertOwner();
    const encoded = encodeObject(value);
    const temporary = file + '.' + randomUUID() + '.tmp';
    let handle: number | undefined;
    try {
        handle = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(handle, encoded);
        fsyncSync(handle);
        closeSync(handle);
        handle = undefined;
        assertOwner();
        renameSync(temporary, file);
    }
    finally {
        if (handle !== undefined)
            closeSync(handle);
        try {
            unlinkSync(temporary);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ControllerError } from './types.js';
/** ROOT-FIRST containment for canonical absolute paths, including filesystem roots. */
export const inside = (root: string, target: string) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
export async function privateDirectory(directory: string) {
    try {
        await fs.mkdir(directory, { mode: 0o700 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
        throw new ControllerError('UNOWNED_STATE', `State directory ${directory} is not an owner-private directory`, `Inspect this path's type, owner and permissions. Use a dedicated directory owned by the current user with no group/other access; do not replace or chmod unrelated storage`);
    const canonical = await fs.realpath(directory);
    if (canonical !== directory)
        throw new ControllerError('UNOWNED_STATE', `State directory ${directory} is not canonical`, `The resolved path is ${canonical}. Use the canonical path for this directory. For the application home, supply its canonical path with --home; do not substitute an internal state/artifacts directory. Leaf symlinks remain unsupported`);
}
export async function privateFile(file: string) {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
            throw new Error('unowned/linked file');
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new ControllerError('UNOWNED_STATE', `Unsafe state leaf ${file}`, 'Restore an exclusively owned regular state file');
    }
}
export async function acquireOwner(state: string) {
    const lock = path.join(state, 'owner.json'), guard = path.join(state, 'recovery.guard'), nonce = randomUUID();
    let guardHandle;
    try {
        guardHandle = await fs.open(guard, 'wx', 0o600);
    }
    catch {
        throw new ControllerError('OWNER_BUSY', `Recovery guard ${guard} is held or unresolved`, `Verify old controller/guard producer stopped before explicit maintenance of ${guard}`);
    }
    type Identity = {
        dev: number;
        ino: number;
    };
    let guardIdentity: Identity | undefined, ownerIdentity: Identity | undefined;
    let ownerHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<unknown>) => {
        try {
            await action();
        }
        catch (error) {
            failures.push(error);
        }
    };
    const removeOwned = async (file: string, expected: Identity | undefined) => {
        if (!expected)
            return;
        try {
            const actual = await fs.lstat(file);
            if (actual.dev === expected.dev && actual.ino === expected.ino)
                await fs.unlink(file);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    };
    try {
        guardIdentity = await guardHandle.stat();
        await guardHandle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
        await guardHandle.sync();
        await privateFile(lock);
        try {
            const old = JSON.parse(await fs.readFile(lock, 'utf8'));
            if (!Number.isSafeInteger(old.pid) || old.pid < 1 || typeof old.nonce !== 'string')
                throw new Error('invalid owner');
            let dead = false;
            try {
                process.kill(old.pid, 0);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'ESRCH')
                    dead = true;
                else
                    throw e;
            }
            if (!dead)
                throw new Error('owner alive or PID reused');
            const again = JSON.parse(await fs.readFile(lock, 'utf8'));
            if (again.nonce !== old.nonce || again.pid !== old.pid)
                throw new Error('owner changed');
            await fs.unlink(lock);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw new ControllerError('OWNER_BUSY', `Application home owner at ${lock} is live or unresolved`, `Close the live owner or inspect ${lock} and verify its producer has stopped before explicit maintenance. Do not delete ownership records for a running process`);
        }
        ownerHandle = await fs.open(lock, 'wx', 0o600);
        ownerIdentity = await ownerHandle.stat();
        await ownerHandle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
        await ownerHandle.sync();
    }
    catch (error) {
        failures.push(error);
    }
    finally {
        if (ownerHandle)
            await attempt(() => ownerHandle!.close());
        await attempt(() => guardHandle.close());
        await attempt(() => removeOwned(guard, guardIdentity));
    }
    if (failures.length) {
        // Initialization never returned ownership. Remove only our exclusive leaf;
        // an older unresolved owner or a replacement remains protected.
        await attempt(() => removeOwned(lock, ownerIdentity));
        if (failures.length === 1)
            throw failures[0];
        throw new AggregateError(failures, 'Application home ownership initialization failed');
    }
    return async () => {
        try {
            const stat = await fs.lstat(lock), saved = JSON.parse(await fs.readFile(lock, 'utf8'));
            if (stat.dev === ownerIdentity!.dev && stat.ino === ownerIdentity!.ino && saved.nonce === nonce && saved.pid === process.pid)
                await fs.unlink(lock);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    };
}

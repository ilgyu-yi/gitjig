/** Fixed native-owner evidence. No workflow authority, argv, environment or protocol. */
import fs from 'node:fs';
import path from 'node:path';
export const OWNER_LIMIT = 1024, RECORD_LIMIT = 4096;
export type Purpose = 'provider' | 'summary';
export interface OwnerBinding {
    version: 1;
    nonce: string;
    sessionId: string;
    purpose: Purpose;
    uid: number;
    hostPid: number;
    guardianPid: number;
    executableSha256: string;
    createdAt: number;
}
export interface Birth extends OwnerBinding {
    nativePid: number;
    pgid: number;
    startedAt: number;
}
export interface Terminal extends OwnerBinding {
    nativeCreated: boolean;
    nativePid: number | null;
    pgid: number | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    exited: boolean;
    stdioReleased: boolean;
    groupAbsent: boolean;
    cleanup: 'confirmed' | 'unknown';
    reason: string;
    finishedAt: number;
}
export const names = ['admission.json', 'birth.json', 'settlement.json', 'recovery.json'] as const;
const baseKeys = ['version', 'nonce', 'sessionId', 'purpose', 'uid', 'hostPid', 'guardianPid', 'executableSha256', 'createdAt'];
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export function validBinding(v: any): boolean {
    return v && v.version === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.nonce) && typeof v.sessionId === 'string' && v.sessionId.length > 0 && v.sessionId.length <= 200 &&
        ['provider', 'summary'].includes(v.purpose) && Number.isSafeInteger(v.uid) && v.uid >= 0 && positive(v.hostPid) && positive(v.guardianPid) &&
        /^[a-f0-9]{64}$/.test(v.executableSha256) && positive(v.createdAt);
}
export function validateRecord(name: typeof names[number], v: any, binding?: OwnerBinding): void {
    if (!validBinding(v))
        throw Error('NATIVE_OWNER_RECORD_INVALID');
    if (binding && baseKeys.some(k => v[k] !== (binding as any)[k]))
        throw Error('NATIVE_OWNER_RECORD_BINDING');
    const legacyRecovery = name === 'recovery.json' && !Object.hasOwn(v, 'nativeCreated');
    const extra = name === 'admission.json' ? [] : name === 'birth.json' ? ['nativePid', 'pgid', 'startedAt'] : name === 'recovery.json' ? ['nativePid', 'pgid', 'observerPid', 'observedAt', 'outcome', ...(legacyRecovery ? [] : ['nativeCreated'])] : ['nativeCreated', 'nativePid', 'pgid', 'exitCode', 'signal', 'exited', 'stdioReleased', 'groupAbsent', 'cleanup', 'reason', 'finishedAt'];
    if (Object.keys(v).length !== baseKeys.length + extra.length || Object.keys(v).some(k => !baseKeys.includes(k) && !extra.includes(k)))
        throw Error('NATIVE_OWNER_RECORD_KEYS');
    if (name === 'birth.json' && (!positive(v.nativePid) || v.pgid !== v.nativePid || !positive(v.startedAt)))
        throw Error('NATIVE_OWNER_BIRTH_INVALID');
    if (name === 'recovery.json') {
        if (!positive(v.observerPid) || !positive(v.observedAt) || !['recorded-scope-absent-original-exit-unknown', 'active-owner-scope-joined'].includes(v.outcome))
            throw Error('NATIVE_OWNER_RECOVERY_INVALID');
        if (legacyRecovery ? v.outcome !== 'recorded-scope-absent-original-exit-unknown' || !positive(v.nativePid) || v.pgid !== v.nativePid : typeof v.nativeCreated !== 'boolean' || (v.nativeCreated ? !positive(v.nativePid) || v.pgid !== v.nativePid : v.nativePid !== null || v.pgid !== null))
            throw Error('NATIVE_OWNER_RECOVERY_INVALID');
    }
    if (name === 'settlement.json') {
        if (typeof v.nativeCreated !== 'boolean' || typeof v.exited !== 'boolean' || typeof v.stdioReleased !== 'boolean' || typeof v.groupAbsent !== 'boolean' || !['confirmed', 'unknown'].includes(v.cleanup) || !/^[A-Z_]{1,64}$/.test(v.reason) || !positive(v.finishedAt) || !(v.exitCode === null || Number.isSafeInteger(v.exitCode)) || !(v.signal === null || /^SIG[A-Z0-9]{1,10}$/.test(v.signal)))
            throw Error('NATIVE_OWNER_TERMINAL_INVALID');
        if (v.nativeCreated ? !positive(v.nativePid) || v.pgid !== v.nativePid : v.nativePid !== null || v.pgid !== null || v.exited || v.exitCode !== null || v.signal !== null)
            throw Error('NATIVE_OWNER_CREATION_INVALID');
        if (v.cleanup === 'confirmed' && (!v.stdioReleased || !v.groupAbsent || v.nativeCreated && !v.exited))
            throw Error('NATIVE_OWNER_FALSE_CONFIRMATION');
    }
}
function privateDirectory(file: string) {
    const info = fs.lstatSync(file);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) || fs.realpathSync(file) !== file)
        throw Error('NATIVE_OWNER_DIRECTORY_UNAVAILABLE');
}
export function ownerRoot(stateRoot: string): string {
    if (!path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot)
        throw Error('NATIVE_OWNER_STATE_UNAVAILABLE');
    privateDirectory(stateRoot);
    let current = stateRoot;
    for (const part of ['runtime', 'native-owners', 'v1']) {
        current = path.join(current, part);
        try {
            fs.mkdirSync(current, { mode: 0o700 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
        privateDirectory(current);
    }
    return current;
}
export function ownerDirectory(root: string, nonce: string): string {
    privateDirectory(root);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce))
        throw Error('NATIVE_OWNER_NONCE_INVALID');
    const dir = path.join(root, nonce);
    fs.mkdirSync(dir, { mode: 0o700 });
    privateDirectory(dir);
    return dir;
}
export function readRecord(dir: string, name: typeof names[number], binding?: OwnerBinding): any | undefined {
    privateDirectory(dir);
    let fd: number;
    try {
        fd = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o077) || s.size > RECORD_LIMIT)
            throw Error('NATIVE_OWNER_RECORD_UNAVAILABLE');
        const buffer = Buffer.alloc(RECORD_LIMIT + 1);
        const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (n > RECORD_LIMIT || n !== s.size)
            throw Error('NATIVE_OWNER_RECORD_CHANGED');
        const after = fs.fstatSync(fd);
        if (after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs)
            throw Error('NATIVE_OWNER_RECORD_CHANGED');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, n)));
        validateRecord(name, value, binding);
        return value;
    }
    finally {
        fs.closeSync(fd);
    }
}
export function writeRecord(dir: string, name: typeof names[number], value: unknown): void {
    privateDirectory(dir);
    validateRecord(name, value);
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    if (bytes.length > RECORD_LIMIT)
        throw Error('NATIVE_OWNER_RECORD_LIMIT');
    const fd = fs.openSync(path.join(dir, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    const parent = fs.openSync(dir, fs.constants.O_RDONLY);
    try {
        fs.fsyncSync(parent);
    }
    finally {
        fs.closeSync(parent);
    }
}
export function absent(pid: number, group = false): boolean {
    try {
        process.kill(group ? -pid : pid, 0);
        return false;
    }
    catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
}
/** Preserve acknowledged evidence outside the bounded outstanding-owner census.
 * An exclusive slot prevents rename from replacing even an empty destination.
 * An interrupted empty reservation is reusable; receipts are never deleted. */
function archiveOwner(root: string, dir: string, nonce: string): void {
    const parent = path.dirname(root);
    privateDirectory(parent);
    privateDirectory(root);
    privateDirectory(dir);
    let destination = parent;
    for (const part of ['archive-v1', nonce.slice(0, 2)]) {
        destination = path.join(destination, part);
        try {
            fs.mkdirSync(destination, { mode: 0o700 });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
        privateDirectory(destination);
    }
    const slot = path.join(destination, nonce);
    try {
        fs.mkdirSync(slot, { mode: 0o700 });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error;
    }
    privateDirectory(destination);
    privateDirectory(slot);
    privateDirectory(root);
    privateDirectory(dir);
    const contents = fs.opendirSync(slot);
    try {
        if (contents.readSync())
            throw Error('NATIVE_OWNER_ARCHIVE_COLLISION');
    }
    finally {
        contents.closeSync();
    }
    // Another census can win this rename, but its nonempty records directory
    // cannot be replaced by rename. Such a race fails conservatively.
    fs.renameSync(dir, path.join(slot, 'records'));
    // Persist the full destination chain before the source-directory removal.
    for (const directory of [slot, destination, path.dirname(destination), parent, root]) {
        const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
}
export function inspectOwners(root: string, local = new Set<string>()): void {
    privateDirectory(root);
    const deadline = performance.now() + 1000;
    let count = 0;
    const iterator = fs.opendirSync(root), seen = new Set<string>();
    try {
        for (let item = iterator.readSync(); item; item = iterator.readSync()) {
            if (++count > OWNER_LIMIT || performance.now() > deadline)
                throw Error('NATIVE_OWNER_RETENTION_LIMIT');
            if (!item.isDirectory() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.name))
                throw Error('NATIVE_OWNER_ENTRY_INVALID');
            const dir = path.join(root, item.name);
            privateDirectory(dir);
            if (local.has(item.name)) {
                seen.add(item.name);
                continue;
            }
            const entries = fs.opendirSync(dir);
            let files = 0;
            try {
                for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
                    if (++files > names.length || !(names as readonly string[]).includes(entry.name))
                        throw Error('NATIVE_OWNER_ENTRY_INVALID');
                }
            }
            finally {
                entries.closeSync();
            }
            const binding = readRecord(dir, 'admission.json');
            if (!binding || binding.uid !== process.getuid?.())
                throw Error('NATIVE_OWNER_UNACCOUNTED');
            const birth = readRecord(dir, 'birth.json', binding), terminal = readRecord(dir, 'settlement.json', binding), recovery = readRecord(dir, 'recovery.json', binding);
            if (recovery) {
                validatePhysicalLink(recovery, birth, terminal);
                archiveOwner(root, dir, item.name);
                continue;
            }
            if (terminal)
                validatePhysicalLink(terminal, birth, terminal);
            const neverCreated = terminal?.nativeCreated === false && terminal.cleanup === 'confirmed' && !birth;
            if (absent(binding.guardianPid) && (birth && absent(birth.nativePid) && absent(birth.pgid, true) || neverCreated)) {
                writeRecord(dir, 'recovery.json', { ...binding, nativeCreated: !!birth, nativePid: birth?.nativePid ?? null, pgid: birth?.pgid ?? null, observerPid: process.pid, observedAt: Date.now(), outcome: 'recorded-scope-absent-original-exit-unknown' });
                archiveOwner(root, dir, item.name);
                continue;
            }
            throw Error('NATIVE_OWNER_UNACCOUNTED');
        }
    }
    finally {
        iterator.closeSync();
    }
    if (new Set([...seen, ...local]).size >= OWNER_LIMIT)
        throw Error('NATIVE_OWNER_RETENTION_LIMIT');
}
/** Historical physical receipts are trusted only with exact admitted birth, or
 * an explicit complete never-created terminal. Never probe acknowledged old IDs. */
export function validatePhysicalLink(receipt: any, birth: any, terminal: any): void {
    const created = Object.hasOwn(receipt, 'nativeCreated') ? receipt.nativeCreated : true;
    if (terminal && (terminal.nativeCreated !== created || created && (terminal.nativePid !== receipt.nativePid || terminal.pgid !== receipt.pgid)))
        throw Error('NATIVE_OWNER_PHYSICAL_LINK_INVALID');
    if (created ? !birth || receipt.nativePid !== birth.nativePid || receipt.pgid !== birth.pgid : !!birth || terminal?.nativeCreated !== false || terminal?.cleanup !== 'confirmed')
        throw Error('NATIVE_OWNER_PHYSICAL_LINK_INVALID');
}
export function acknowledgeJoined(dir: string, binding: OwnerBinding, created: boolean, nativePid: number | undefined): void {
    const birth = readRecord(dir, 'birth.json', binding), terminal = readRecord(dir, 'settlement.json', binding);
    const value = { ...binding, nativeCreated: created, nativePid: created ? nativePid! : null, pgid: created ? nativePid! : null, observerPid: process.pid, observedAt: Date.now(), outcome: 'active-owner-scope-joined' };
    validateRecord('recovery.json', value, binding);
    validatePhysicalLink(value, birth, terminal);
    const previous = readRecord(dir, 'recovery.json', binding);
    if (previous) {
        validatePhysicalLink(previous, birth, terminal);
        return;
    }
    writeRecord(dir, 'recovery.json', value);
}

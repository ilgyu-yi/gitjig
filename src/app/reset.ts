import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { acquireOwner, inside } from '../controller/ownership.js';
import { inspectOwners } from '../pi/native-owner-records.js';
import { writeOwnedJson } from '../installation/transaction.js';
export type ResetScope = 'settings' | 'all';
export type ResetDisposition = 'backup' | 'delete';
export const backupDeletionPendingName = 'reset-backup-delete-pending.json';
type Entry = {
    path: string;
    dev: number;
    ino: number;
    size: number;
    mtime: number;
    kind: 'directory' | 'file' | 'symlink';
    target?: string;
    sha256?: string;
};
export interface ResetPreview {
    home: string;
    scope: ResetScope;
    paths: string[];
    backupScope: string;
    fingerprint: string;
    backupPolicy: string;
    backupDirectory: string | null;
    disposition: ResetDisposition;
    preserved: string[];
}
type LegacyPlan = {
    format: 1;
    home: string;
    scope: ResetScope;
    paths: string[];
    inventory: Entry[];
    fingerprint: string;
    backup: string;
};
type CompactPlan = Omit<LegacyPlan, 'format' | 'inventory'> & {
    format: 2;
    roots: {
        path: string;
        sha256: string;
    }[];
    manifestDigest: string;
};
export interface RootIdentity {
    device: string;
    inode: string;
    owner: string;
    mode: number;
    kind: 'directory' | 'file';
}
type RootPlan = {
    format: 3 | 4;
    disposition?: ResetDisposition;
    phase?: 'moving' | 'deleting';
    stagingIdentity?: RootIdentity;
    home: string;
    scope: ResetScope;
    paths: string[];
    roots: { path: string; identity: RootIdentity }[];
    anchors: { home: RootIdentity; state: RootIdentity };
    fingerprint: string;
    backup: string;
    manifestDigest: string;
};
type Plan = LegacyPlan | CompactPlan | RootPlan;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pendingName = 'reset-pending.json';
const maxLegacyInventoryEntries = 100000;
const maxManifestBytes = 16 * 1024 * 1024;
function rootPlan(home: string, scope: ResetScope, paths: string[], roots: RootPlan['roots'], anchors: RootPlan['anchors'], fingerprint: string, backup: string, disposition: ResetDisposition, stagingIdentity: RootIdentity, phase: 'moving' | 'deleting' = 'moving'): RootPlan {
    const body = { format: 4 as const, home, scope, paths, roots, anchors, fingerprint, backup, disposition, phase, stagingIdentity };
    return { ...body, manifestDigest: digest(body) };
}
function assertManifestFits(p: Plan): void {
    // Receipt adds a completion field; both files use the same durable JSON writer.
    if (Buffer.byteLength(JSON.stringify({ ...p, complete: true }, null, 2) + '\n') > maxManifestBytes)
        throw Error('Reset manifest exceeds 16 MiB; no active data moved');
}
function validResetPath(relative: unknown): relative is string {
    return typeof relative === 'string' && (['config', 'inputs', 'artifacts'].includes(relative) ||
        /^state\/[^/]+$/.test(relative) && !['state/.', 'state/..', 'state/owner.json', 'state/recovery.guard'].includes(relative));
}
export function validResetPlan(p: Plan, home: string): boolean {
    if (!p || p.home !== home || !['settings', 'all'].includes(p.scope) || typeof p.backup !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(p.backup) || !Array.isArray(p.paths) || !p.paths.every(validResetPath))
        return false;
    if (p.format === 1)
        return digest({ home, scope: p.scope, paths: p.paths, rows: p.inventory }) === p.fingerprint;
    if (p.format !== 2 && p.format !== 3 && p.format !== 4 || !Array.isArray(p.roots) || p.roots.length !== p.paths.length ||
        new Set(p.paths).size !== p.paths.length || !/^[a-f0-9]{64}$/.test(p.fingerprint))
        return false;
    if (p.format === 2 && p.roots.some((root, i) => !root || root.path !== p.paths[i] || typeof root.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(root.sha256)))
        return false;
    if ((p.format === 3 || p.format === 4) && (!p.anchors || !validRootIdentity(p.anchors.home) || !validRootIdentity(p.anchors.state) ||
        p.anchors.home.kind !== 'directory' || p.anchors.state.kind !== 'directory' ||
        p.scope === 'settings' && p.paths.some(relative => relative !== 'config') ||
        p.roots.some((root, i) => !root || root.path !== p.paths[i] || !validRootIdentity(root.identity)) ||
        p.fingerprint !== digest({ home, scope: p.scope, paths: p.paths, roots: p.roots, anchors: p.anchors, ...(p.format === 4 ? { disposition: p.disposition } : {}) })))
        return false;
    if (p.format === 4 && (!['backup', 'delete'].includes(p.disposition!) || !['moving', 'deleting'].includes(p.phase!) ||
        p.phase === 'deleting' && p.disposition !== 'delete' || !p.stagingIdentity || !validRootIdentity(p.stagingIdentity) || p.stagingIdentity.kind !== 'directory'))
        return false;
    const { manifestDigest, ...body } = p;
    return digest(body) === manifestDigest;
}
async function syncDirectory(directory: string) {
    const handle = await fs.open(directory, 'r');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function exists(file: string) {
    try {
        await fs.lstat(file);
        return true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return false;
        throw error;
    }
}
export async function assertPrivateResetDirectory(file: string) {
    const s = await fs.lstat(file);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) || await fs.realpath(file) !== file)
        throw Error('Reset requires a canonical private directory: ' + file);
}
export async function readResetMetadata(file: string, snapshot?: (bytes: Buffer) => void) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o022) || info.size > maxManifestBytes)
            throw Error('Unsafe reset metadata: ' + file);
        const bytes = Buffer.alloc(info.size + 1);
        let size = 0;
        while (size < bytes.length) {
            const read = await handle.read(bytes, size, bytes.length - size, size);
            if (!read.bytesRead) break;
            size += read.bytesRead;
        }
        const after = await handle.stat();
        if (size !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
            throw Error('Reset metadata changed: ' + file);
        const raw = bytes.subarray(0, size), value = JSON.parse(raw.toString('utf8'));
        snapshot?.(raw);
        return value;
    } finally { await handle.close(); }
}

export async function withResetOwner<T>(home: string, task: () => Promise<T>) {
    await assertPrivateResetDirectory(home);
    await assertPrivateResetDirectory(path.join(home, 'state'));
    if ((await readResetMetadata(path.join(home, 'controller.json'))).format !== 'gitjig-controller-1')
        throw Error('Foreign application home');
    const release = await acquireOwner(path.join(home, 'state'));
    try {
        if (await exists(path.join(home, 'activation.json')))
            throw Error('Recover installation activation before reset');
        return await task();
    }
    finally {
        await release();
    }
}
/** Historical formats 1/2 alone retain their original full-content recovery proof. */
async function legacyInventory(home: string, roots: string[]): Promise<Entry[]> {
    const rows: Entry[] = [];
    async function visit(relative: string) {
        if (rows.length >= maxLegacyInventoryEntries)
            throw Error('Legacy reset inventory exceeds 100000 entries');
        const file = path.join(home, relative), s = await fs.lstat(file);
        if (s.uid !== process.getuid?.())
            throw Error('Foreign reset entry: ' + file);
        const kind = s.isDirectory() ? 'directory' : s.isFile() ? 'file' : s.isSymbolicLink() ? 'symlink' : undefined;
        if (!kind)
            throw Error('Unsupported reset entry: ' + file);
        let sha256: string | undefined;
        if (kind === 'file') {
            const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const opened = await handle.stat();
                if (!opened.isFile() || opened.ino !== s.ino || opened.dev !== s.dev)
                    throw Error('Reset file changed');
                const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
                let bytes = 0;
                for (;;) {
                    const read = await handle.read(buffer, 0, buffer.length, null);
                    if (!read.bytesRead)
                        break;
                    bytes += read.bytesRead;
                    if (bytes > s.size)
                        throw Error('Reset file grew during review');
                    hash.update(buffer.subarray(0, read.bytesRead));
                }
                const end = await handle.stat();
                if (bytes !== s.size || end.mtimeMs !== s.mtimeMs || end.ctimeMs !== s.ctimeMs)
                    throw Error('Reset file changed during review');
                sha256 = hash.digest('hex');
            }
            finally {
                await handle.close();
            }
        }
        rows.push({ path: relative, dev: s.dev, ino: s.ino, size: kind === 'directory' ? 0 : s.size, mtime: kind === 'directory' ? 0 : s.mtimeMs, kind, ...kind === 'symlink' ? { target: await fs.readlink(file) } : {}, ...sha256 ? { sha256 } : {} });
        if (kind === 'directory')
            for (const leaf of (await fs.readdir(file)).sort())
                await visit(path.join(relative, leaf));
    }
    for (const root of roots)
        await visit(root);
    return rows;
}
async function safeToReset(home: string) {
    const dbFile = path.join(home, 'state/controller.sqlite');
    if (await exists(dbFile)) {
        await assertOwnedDatabaseFile(dbFile);
        // Inspect an owned copy so SQLite's shared-memory bookkeeping cannot change the active reset roots.
        const scratch = await fs.mkdtemp(path.join(tmpdir(), 'gitjig-reset-inspect-'));
        let db: DatabaseSync | undefined;
        try {
            const copy = path.join(scratch, 'controller.sqlite');
            await fs.copyFile(dbFile, copy);
            if (await exists(dbFile + '-wal')) {
                await assertOwnedDatabaseFile(dbFile + '-wal');
                await fs.copyFile(dbFile + '-wal', copy + '-wal');
            }
            db = new DatabaseSync(copy, { readOnly: true });
            for (const row of db.prepare('SELECT root FROM projects').all()) {
                const root = String(row.root);
                for (const selected of ['config', 'state', 'artifacts', 'inputs'])
                    if (inside(path.join(home, selected), root) || inside(root, home))
                        throw Error('Reset overlaps registered project source: ' + root);
            }
            for (const [sql, reason] of [["SELECT id FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED') LIMIT 1", 'unsettled run'], ["SELECT id FROM capacity_leases WHERE state!='RELEASED' LIMIT 1", 'reserved execution'], ["SELECT id FROM works WHERE state IN ('UNKNOWN','QUARANTINED') LIMIT 1", 'unknown work cleanup']])
                if (db.prepare(sql!).get())
                    throw Error('Reset held by ' + reason + '. Reopen the original home, inspect /work, and resolve its recovery before reset.');
        }
        finally {
            db?.close();
            await fs.rm(scratch, { recursive: true, force: true });
        }
    }
    const runtime = path.join(home, 'state/runtime');
    if (!await exists(runtime))
        return;
    await assertPrivateResetDirectory(runtime);
    for (const name of await fs.readdir(runtime))
        if (name.endsWith('.json')) {
            const record = await readResetMetadata(path.join(runtime, name));
            if (record.state !== 'removed' || record.nativeCleanupUnknown || typeof record.nonce !== 'string' || typeof record.workId !== 'string' || typeof record.runId !== 'string')
                throw Error('Unsettled runtime journal ' + name + '. Restore its runtime and reopen the original home for cleanup.');
        }
    const owners = path.join(runtime, 'native-owners/v1');
    if (await exists(owners))
        inspectOwners(owners);
}
async function assertOwnedDatabaseFile(file: string) {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o022))
        throw Error('Unsafe application database');
}
function validRootIdentity(value: RootIdentity): boolean {
    return !!value && (['device', 'inode', 'owner'] as const).every(key => typeof value[key] === 'string' && /^[0-9]{1,30}$/.test(value[key])) &&
        Number.isSafeInteger(value.mode) && value.mode >= 0 && value.mode <= 0xffff && ['directory', 'file'].includes(value.kind);
}
/** Root metadata only. Descendant files, links and special entries remain opaque. */
export async function resetRootIdentity(file: string): Promise<RootIdentity> {
    const info = await fs.lstat(file, { bigint: true });
    if (info.uid !== BigInt(process.getuid!()) || info.mode & 0o022n || !info.isDirectory() && !info.isFile())
        throw Error('Reset requires an owned regular file or directory root: ' + file);
    return { device: String(info.dev), inode: String(info.ino), owner: String(info.uid), mode: Number(info.mode), kind: info.isDirectory() ? 'directory' : 'file' };
}
async function resetAnchors(home: string): Promise<RootPlan['anchors']> {
    await assertPrivateResetDirectory(home);
    await assertPrivateResetDirectory(path.join(home, 'state'));
    return { home: await resetRootIdentity(home), state: await resetRootIdentity(path.join(home, 'state')) };
}
async function selectedResetPaths(home: string, scope: ResetScope): Promise<string[]> {
    const paths: string[] = [];
    if (await exists(path.join(home, 'config')))
        paths.push('config');
    if (scope === 'all') {
        for (const name of (await fs.readdir(path.join(home, 'state'))).sort())
            if (!['owner.json', 'recovery.guard'].includes(name))
                paths.push(path.join('state', name));
        for (const name of ['artifacts', 'inputs'])
            if (await exists(path.join(home, name)))
                paths.push(name);
    }
    return paths;
}
async function plan(home: string, scope: ResetScope, disposition: ResetDisposition) {
    if (disposition !== 'backup' && disposition !== 'delete')
        throw Error('Reset disposition must be backup or delete');
    if (await exists(path.join(home, backupDeletionPendingName)))
        throw Error('Backup deletion interrupted; run gitjig reset backup-recover --home ' + home);
    if (scope !== 'settings' && scope !== 'all')
        throw Error('Reset scope must be settings or all');
    if (await exists(path.join(home, pendingName)))
        throw Error('Reset interrupted; run gitjig reset recover --home ' + home);
    await safeToReset(home);
    const anchors = await resetAnchors(home), paths = await selectedResetPaths(home, scope);
    const roots: RootPlan['roots'] = [];
    for (const relative of paths)
        roots.push({ path: relative, identity: await resetRootIdentity(path.join(home, relative)) });
    const fingerprint = digest({ home, scope, paths, roots, anchors, disposition });
    assertManifestFits(rootPlan(home, scope, paths, roots, anchors, fingerprint, '00000000-0000-0000-0000-000000000000', disposition, anchors.home));
    return { paths, roots, anchors, fingerprint };
}
export async function prepareApplicationReset(home: string, scope: ResetScope, disposition: ResetDisposition = 'backup'): Promise<ResetPreview> {
    return withResetOwner(home, async () => {
        const p = await plan(home, scope, disposition);
        return { home, scope, disposition, paths: p.paths, backupScope: 'Each selected root includes all current contents. Nested files are not individually scanned, counted or compared.', fingerprint: p.fingerprint, backupDirectory: disposition === 'backup' ? path.join(home, 'reset-backups') : null, backupPolicy: disposition === 'backup' ? 'Original data, including credentials, is retained in a private reset-backups directory. Reset is not secure erasure.' : 'Selected application data is permanently deleted without a retained backup. This is not secure erasure.', preserved: ['Registered project source and project settings', 'Installed binaries and installation metadata', 'Shared Docker/Colima and native provider accounts', 'Previous reset backups'] };
    });
}
async function assertRootContext(home: string, p: RootPlan) {
    if (digest(await resetAnchors(home)) !== digest(p.anchors))
        throw Error('Reset home or state directory changed; retain the pending reset for inspection');
}
async function backupParent(backup: string, relative: string, create = false) {
    await assertPrivateResetDirectory(backup);
    const parent = path.dirname(path.join(backup, relative));
    if (parent !== backup) {
        if (create && !await exists(parent))
            await fs.mkdir(parent, { mode: 0o700 });
        if (await exists(parent))
            await assertPrivateResetDirectory(parent);
    }
}
async function assertRootLocations(home: string, backup: string, p: RootPlan) {
    await assertRootContext(home, p);
    const remaining: string[] = [];
    for (const root of p.roots) {
        await backupParent(backup, root.path);
        const source = path.join(home, root.path), destination = path.join(backup, root.path);
        if (await exists(source)) {
            if (await exists(destination))
                throw Error('Reset source and backup both exist; retained for inspection');
            if (digest(await resetRootIdentity(source)) !== digest(root.identity))
                throw Error('Reset source root changed; retained for inspection: ' + root.path);
            remaining.push(root.path);
        }
        else if (!await exists(destination) || digest(await resetRootIdentity(destination)) !== digest(root.identity))
            throw Error('Reset backup root differs; retained for inspection: ' + root.path);
    }
    if (digest(await selectedResetPaths(home, p.scope)) !== digest(remaining))
        throw Error('Reset root selection changed; retain the pending reset for inspection');
}
async function finishRoots(home: string, p: RootPlan) {
    if (p.format === 4 && p.disposition === 'delete' && p.phase === 'deleting')
        return finishPermanentReset(home, p);
    const backup = path.join(home, p.format === 4 && p.disposition === 'delete' ? 'reset-deletions' : 'reset-backups', p.backup);
    await assertPrivateResetDirectory(path.dirname(backup));
    await assertPrivateResetDirectory(backup);
    if (p.format === 4 && digest(await resetRootIdentity(backup)) !== digest(p.stagingIdentity))
        throw Error('Reset staging directory changed; retain the pending reset');
    await assertRootLocations(home, backup, p);
    for (const root of p.roots) {
        const source = path.join(home, root.path), destination = path.join(backup, root.path);
        await assertRootContext(home, p);
        if (p.format === 4 && digest(await resetRootIdentity(backup)) !== digest(p.stagingIdentity))
            throw Error('Reset staging directory changed; retain the pending reset');
        await backupParent(backup, root.path, true);
        if (await exists(source)) {
            if (await exists(destination))
                throw Error('Reset source and backup both exist; retained for inspection');
            if (digest(await resetRootIdentity(source)) !== digest(root.identity))
                throw Error('Reset source root changed; retained for inspection: ' + root.path);
            await fs.rename(source, destination);
            await syncDirectory(path.dirname(destination));
            await syncDirectory(path.dirname(source));
            await syncDirectory(backup);
        }
        if (digest(await resetRootIdentity(destination)) !== digest(root.identity))
            throw Error('Reset moved root differs; retained for inspection: ' + root.path);
    }
    await assertRootLocations(home, backup, p);
    if (p.format === 4 && p.disposition === 'delete') {
        const deleting = rootPlan(home, p.scope, p.paths, p.roots, p.anchors, p.fingerprint, p.backup, 'delete', p.stagingIdentity!, 'deleting');
        await writeOwnedJson(path.join(home, pendingName), deleting);
        return finishPermanentReset(home, deleting);
    }
    await writeOwnedJson(path.join(backup, 'reset-receipt.json'), { ...p, complete: true });
    await assertRootLocations(home, backup, p);
    await fs.unlink(path.join(home, pendingName));
    await syncDirectory(home);
    return { scope: p.scope, backup, reset: true, nextAction: 'Launch gitjig again to configure the fresh active data. Original data remains in the private backup.' };
}
/** Deletion intent is durable before rm; absence is accepted only in this phase. */
async function finishPermanentReset(home: string, p: RootPlan) {
    if (p.format !== 4 || p.disposition !== 'delete' || p.phase !== 'deleting')
        throw Error('Original permanent deletion intent is unavailable');
    await assertRootContext(home, p);
    if ((await selectedResetPaths(home, p.scope)).length)
        throw Error('New active data appeared during deletion; retain the pending reset');
    const parent = path.join(home, 'reset-deletions'), staging = path.join(parent, p.backup);
    await assertPrivateResetDirectory(parent);
    if (await exists(staging)) {
        if (digest(await resetRootIdentity(staging)) !== digest(p.stagingIdentity))
            throw Error('Reset deletion staging changed; retain the pending reset');
        await fs.rm(staging, { recursive: true });
        await syncDirectory(parent);
    }
    await assertRootContext(home, p);
    if ((await selectedResetPaths(home, p.scope)).length)
        throw Error('New active data appeared during deletion; retain the pending reset');
    await fs.unlink(path.join(home, pendingName));
    await syncDirectory(home);
    return { scope: p.scope, disposition: 'delete' as const, backup: null, reset: true, nextAction: 'Selected application data was permanently deleted without a backup. Launch gitjig for fresh active data.' };
}
async function finish(home: string, p: Plan) {
    if (p.format === 1 || p.format === 2)
        return finishLegacy(home, p);
    return finishRoots(home, p);
}
async function finishLegacy(home: string, p: LegacyPlan | CompactPlan) {
    const backup = path.join(home, 'reset-backups', p.backup);
    await assertPrivateResetDirectory(backup);
    for (const [index, relative] of p.paths.entries()) {
        const source = path.join(home, relative), destination = path.join(backup, relative);
        const original = p.format === 1 ? digest(p.inventory.filter(row => row.path === relative || row.path.startsWith(relative + path.sep))) : p.roots[index]!.sha256;
        if (await exists(source)) {
            if (await exists(destination))
                throw Error('Reset source and backup both exist; retained for inspection');
            if (digest(await legacyInventory(home, [relative])) !== original)
                throw Error('Reset source changed; retained for inspection: ' + relative);
            await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            await fs.rename(source, destination);
            await syncDirectory(path.dirname(destination));
            await syncDirectory(path.dirname(source));
            await syncDirectory(backup);
        }
        else if (!await exists(destination) || digest(await legacyInventory(backup, [relative])) !== original)
            throw Error('Reset backup differs; retained for inspection: ' + relative);
    }
    await writeOwnedJson(path.join(backup, 'reset-receipt.json'), { ...p, complete: true });
    await fs.unlink(path.join(home, pendingName));
    await syncDirectory(home);
    return { scope: p.scope, backup, reset: true, nextAction: 'Launch gitjig again to configure the fresh active data. Original data remains in the private backup.' };
}
export async function applyApplicationReset(home: string, scope: ResetScope, expectedFingerprint: string, disposition: ResetDisposition = 'backup') {
    return withResetOwner(home, async () => {
        const p = await plan(home, scope, disposition);
        if (p.fingerprint !== expectedFingerprint)
            throw Error('Reset preview changed; review a new preview before confirming');
        const backup = randomUUID();
        const backups = path.join(home, disposition === 'delete' ? 'reset-deletions' : 'reset-backups');
        if (!await exists(backups))
            await fs.mkdir(backups, { mode: 0o700 });
        await assertPrivateResetDirectory(backups);
        await fs.mkdir(path.join(backups, backup), { mode: 0o700 });
        const pending = rootPlan(home, scope, p.paths, p.roots, p.anchors, p.fingerprint, backup, disposition, await resetRootIdentity(path.join(backups, backup)));
        assertManifestFits(pending);
        await syncDirectory(backups);
        await syncDirectory(home);
        await writeOwnedJson(path.join(home, pendingName), pending);
        return finish(home, pending);
    });
}
export async function recoverApplicationReset(home: string) {
    return withResetOwner(home, async () => {
        const p = await readResetMetadata(path.join(home, pendingName)) as Plan;
        if (!validResetPlan(p, home))
            throw Error('Invalid reset recovery manifest');
        return finish(home, p);
    });
}

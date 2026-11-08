import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeOwnedJson } from '../installation/transaction.js';
import { resetRecoveryCommand } from '../installation/reset-recovery-command.js';
import { assertPrivateResetDirectory, backupDeletionPendingName, readResetMetadata, resetRootIdentity, validResetPlan, withResetOwner, withResetRecovery, type RootIdentity } from './reset.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
async function exists(file: string) {
    try { await fs.lstat(file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function sync(directory: string) {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
async function noActiveReset(home: string) {
    if (await exists(path.join(home, 'reset-pending.json')))
        throw Error('Finish the interrupted application reset before deleting backups');
}
async function inspectBackup(home: string, backupId: string, selectedRoot = path.join(home, 'reset-backups', backupId)) {
    if (!uuid(backupId)) throw Error('Choose an exact retained reset backup ID');
    const root = selectedRoot, parent = path.dirname(root);
    await assertPrivateResetDirectory(parent);
    await assertPrivateResetDirectory(root);
    const identity = await resetRootIdentity(root);
    let receiptHash = '', receiptModifiedAt: string | null = null;
    const receipt = await readResetMetadata(path.join(root, 'reset-receipt.json'), (bytes, modifiedAt) => {
        receiptHash = createHash('sha256').update(bytes).digest('hex');
        if (Number.isFinite(modifiedAt.getTime())) receiptModifiedAt = modifiedAt.toISOString();
    });
    const { complete, ...manifest } = receipt;
    if (complete !== true || receipt.backup !== backupId || receipt.home !== home ||
        !validResetPlan(manifest as Parameters<typeof validResetPlan>[0], home) ||
        (receipt.format === 4 || receipt.format === 5) && (receipt.disposition !== 'backup' || digest(receipt.stagingIdentity) !== digest(identity)))
        throw Error('Backup has no matching completed reset receipt; inspect its original reset');
    const fingerprint = digest({ home, backupId, identity, receiptHash });
    return { backupId, scope: receipt.scope as 'settings' | 'all', paths: receipt.paths as string[], fingerprint, receiptModifiedAt, identity, receiptHash };
}
export async function listResetBackups(home: string, { includeReceiptTime = false } = {}) {
    return withResetOwner(home, async () => {
        const parent = path.join(home, 'reset-backups'), backups = [], held = [];
        if (await exists(parent)) {
            await assertPrivateResetDirectory(parent);
            for (const id of (await fs.readdir(parent)).sort()) {
                if (!uuid(id)) continue;
                try {
                    const { identity: _identity, receiptHash: _receiptHash, receiptModifiedAt, ...backup } = await inspectBackup(home, id);
                    backups.push({ ...backup, ...(includeReceiptTime ? { receiptModifiedAt } : {}) });
                } catch (error) { held.push({ backupId: id, reason: error instanceof Error ? error.message : 'Backup unavailable' }); }
            }
        }
        const pendingFile = path.join(home, backupDeletionPendingName);
        return { home, backupDirectory: parent, backups, held, ...(await exists(pendingFile) ? { pendingDeletion: { recovery: resetRecoveryCommand(home, 'backup-recover') } } : {}) };
    });
}
interface Deletion {
    format: 'gitjig-reset-backup-deletion-1';
    home: string;
    backupId: string;
    transactionId: string;
    identity: RootIdentity;
    homeIdentity: RootIdentity;
    receiptHash: string;
    fingerprint: string;
    phase: 'moving' | 'deleting';
    manifestDigest: string;
}
function deletion(value: Omit<Deletion, 'manifestDigest'>): Deletion {
    return { ...value, manifestDigest: digest(value) };
}
function validDeletion(home: string, pending: Deletion): boolean {
    if (!pending) return false;
    const { manifestDigest, ...body } = pending;
    return pending.format === 'gitjig-reset-backup-deletion-1' && pending.home === home && uuid(pending.backupId) && uuid(pending.transactionId) &&
        ['moving', 'deleting'].includes(pending.phase) && digest(body) === manifestDigest &&
        pending.fingerprint === digest({ home, backupId: pending.backupId, identity: pending.identity, receiptHash: pending.receiptHash });
}
function markDeleting(pending: Deletion): Deletion {
    const { manifestDigest: _manifestDigest, ...body } = pending;
    return deletion({ ...body, phase: 'deleting' });
}
function withPendingDeletion<T>(home: string, pending: Deletion, attempt: () => Promise<T>): Promise<T> {
    return withResetRecovery(home, 'backup-recover', attempt, journal => {
        const current = journal as Deletion;
        return validDeletion(home, current) && (current.manifestDigest === pending.manifestDigest ||
            pending.phase === 'moving' && current.manifestDigest === markDeleting(pending).manifestDigest);
    });
}
async function finishDeletion(home: string, pending: Deletion) {
    await noActiveReset(home);
    if (digest(await resetRootIdentity(home)) !== digest(pending.homeIdentity))
        throw Error('Backup deletion home changed; retain its pending intent');
    const sourceParent = path.join(home, 'reset-backups'), source = path.join(sourceParent, pending.backupId);
    const stageParent = path.join(home, 'reset-deletions'), stage = path.join(stageParent, pending.transactionId);
    await assertPrivateResetDirectory(sourceParent);
    await assertPrivateResetDirectory(stageParent);
    if (pending.phase === 'moving') {
        if (await exists(source)) {
            if (await exists(stage)) throw Error('Backup source and deletion staging both exist');
            const current = await inspectBackup(home, pending.backupId);
            if (current.fingerprint !== pending.fingerprint) throw Error('Reviewed reset backup changed; no deletion performed');
            await fs.rename(source, stage);
            await sync(sourceParent);
            await sync(stageParent);
        }
        if (!await exists(stage) || digest(await resetRootIdentity(stage)) !== digest(pending.identity))
            throw Error('Original backup deletion staging is unavailable');
        if ((await inspectBackup(home, pending.backupId, stage)).fingerprint !== pending.fingerprint)
            throw Error('Reviewed reset backup receipt changed before deletion');
        pending = markDeleting(pending);
        await writeOwnedJson(path.join(home, backupDeletionPendingName), pending);
    }
    const currentContext = async () => {
        await noActiveReset(home);
        if (digest(await resetRootIdentity(home)) !== digest(pending.homeIdentity))
            throw Error('Backup deletion home changed; retain its pending intent');
        await assertPrivateResetDirectory(sourceParent);
        await assertPrivateResetDirectory(stageParent);
        if (await exists(source)) throw Error('A backup with the original name appeared; retain deletion intent for inspection');
    };
    await currentContext();
    if (await exists(stage)) {
        if (digest(await resetRootIdentity(stage)) !== digest(pending.identity))
            throw Error('Backup deletion staging changed; no deletion performed');
        await fs.rm(stage, { recursive: true });
        await sync(stageParent);
    }
    await currentContext();
    if (await exists(stage)) throw Error('Backup deletion staging remains; retain its pending intent');
    await fs.unlink(path.join(home, backupDeletionPendingName));
    await sync(home);
    return { backupId: pending.backupId, deleted: true, permanent: true, backup: null };
}
export async function deleteResetBackup(home: string, backupId: string, fingerprint: string) {
    return withResetOwner(home, async () => {
        await noActiveReset(home);
        if (await exists(path.join(home, backupDeletionPendingName)))
            throw Error(`Backup deletion interrupted. Run ${resetRecoveryCommand(home, 'backup-recover')}`);
        const current = await inspectBackup(home, backupId);
        if (current.fingerprint !== fingerprint) throw Error('Reviewed reset backup changed; review its current identity before deletion');
        const stageParent = path.join(home, 'reset-deletions');
        if (!await exists(stageParent)) await fs.mkdir(stageParent, { mode: 0o700 });
        await assertPrivateResetDirectory(stageParent);
        const pending = deletion({ format: 'gitjig-reset-backup-deletion-1', home, backupId, transactionId: randomUUID(), identity: current.identity,
            homeIdentity: await resetRootIdentity(home), receiptHash: current.receiptHash, fingerprint, phase: 'moving' });
        return withPendingDeletion(home, pending, async () => {
            await writeOwnedJson(path.join(home, backupDeletionPendingName), pending);
            return finishDeletion(home, pending);
        });
    });
}
export async function recoverResetBackupDeletion(home: string) {
    return withResetOwner(home, async () => {
        const file = path.join(home, backupDeletionPendingName);
        if (!await exists(file)) return { recovered: 'nothing-pending' as const, deleted: false };
        const pending = await readResetMetadata(file) as Deletion;
        if (!validDeletion(home, pending)) throw Error('Invalid retained backup deletion intent');
        return withPendingDeletion(home, pending, () => finishDeletion(home, pending));
    });
}

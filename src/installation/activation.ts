import { assertNoPendingReset } from './gate.js';
import { runInstallationCommand, reconcileInstallationChildren } from './child.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { acquireOwner, privateDirectory, privateFile } from '../controller/ownership.js';
import { stageBundle, validateBundle, writeOwnedJson, backupOwnedDatabase } from './transaction.js';
import { copyAssetTree, inventoryTree } from './tree.js';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
interface Binding {
    format: 1;
    payloadId: string;
    manifestSha256: string;
    generation: number;
    previous: string | null;
}
type Phase = 'PREPARED' | 'SNAPSHOT' | 'VERIFIED' | 'PROMOTING_DB' | 'DB_PROMOTED' | 'BOUND' | 'COMMITTED' | 'ROLLBACK';
interface Journal {
    oldControllerMarker?: Record<string, unknown>;
    childProfile?: 'installation-child/v1';
    format: 1;
    id: string;
    phase: Phase;
    payloadId: string;
    oldBinding: Binding | null;
    hadDatabase: boolean;
    databasePromoted: boolean;
    snapshotSha256: string | null;
    cloneSha256?: string;
    originalSha256?: string;
    failure?: string;
}
async function optionalJson(file: string) {
    await privateFile(file);
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return null;
        throw e;
    }
}
async function syncDirectory(directory: string) {
    const h = await fs.open(directory, 'r');
    try {
        await h.sync();
    }
    finally {
        await h.close();
    }
}
async function exists(file: string) {
    try {
        await fs.lstat(file);
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return false;
        throw e;
    }
}
const journalFile = (home: string) => path.join(home, 'activation.json');
const parts = (home: string, j: Journal) => ({ directory: path.join(home, 'state', 'activation-' + j.id), live: path.join(home, 'state/controller.sqlite'), snapshot: path.join(home, 'state', 'activation-' + j.id, 'snapshot.sqlite'), clone: path.join(home, 'state', 'activation-' + j.id, 'candidate.sqlite'), original: path.join(home, 'state', 'activation-' + j.id, 'original.sqlite') });
function validateJournal(value: unknown): Journal {
    const j = value as Journal;
    if (!j || j.format !== 1 || typeof j.id !== 'string' || !/^[a-f0-9-]{36}$/.test(j.id) || typeof j.payloadId !== 'string' || !/^[a-f0-9]{64}$/.test(j.payloadId) || !['PREPARED', 'SNAPSHOT', 'VERIFIED', 'PROMOTING_DB', 'DB_PROMOTED', 'BOUND', 'COMMITTED', 'ROLLBACK'].includes(j.phase) || typeof j.hadDatabase !== 'boolean' || typeof j.databasePromoted !== 'boolean')
        throw Error('Unrecognized activation journal; retain for explicit repair');
    return j;
}
async function checkpoint(home: string, j: Journal, phase: Phase) { j.phase = phase; await writeOwnedJson(journalFile(home), j); }
async function namespace(home: string, id: string) {
    const root = path.join(home, 'state', 'health-' + id);
    await privateDirectory(root);
    for (const name of ['state', 'work', 'artifacts'])
        await privateDirectory(path.join(root, name));
    return root;
}
async function candidateCommand(home: string, payloadId: string, module: string, args: readonly string[], temp?: string) {
    if (args.length !== 1 || !['migrate.js', 'handshake.js'].includes(module))
        throw Error('Fixed installation child command required');
    const kind = module === 'migrate.js' ? 'migrate' : 'handshake', name = path.basename(kind === 'migrate' ? path.dirname(args[0]!) : args[0]!), id = kind === 'migrate' ? name.slice('activation-'.length) : name.slice('health-'.length, ('health-'.length) + 36), namespace = kind === 'handshake' ? name.slice('health-'.length) : undefined;
    const expected = kind === 'migrate' ? path.join(home, 'state', 'activation-' + id, 'candidate.sqlite') : path.join(home, 'state', 'health-' + namespace);
    if (args[0] !== expected || kind === 'handshake' && temp !== path.join(expected, 'artifacts'))
        throw Error('Installation child input scope differs');
    return runInstallationCommand({ home, ownerId: id, payloadId, kind, ...(namespace ? { namespace } : {}) });
}
async function handshake(home: string, payloadId: string, id: string) {
    const root = await namespace(home, id);
    const output = await candidateCommand(home, payloadId, 'handshake.js', [root], path.join(root, 'artifacts'));
    const receipt = JSON.parse(output.stdout);
    if (receipt.liveStanding !== false || receipt.sdk?.version !== '1.3.0' || receipt.roles?.length !== 7)
        throw Error('Incomplete actual installed handshake');
    await writeOwnedJson(path.join(root, 'receipt.json'), receipt);
    return root;
}
async function archive(home: string, j: Journal, suffix: string) { const directory = path.join(home, 'activation-history'); await privateDirectory(directory); await writeOwnedJson(path.join(directory, j.id + '-' + suffix + '.json'), j); await fs.unlink(journalFile(home)); }
async function settleChildren(home: string, j: Journal) {
    if (j.childProfile !== 'installation-child/v1' && !['PREPARED', 'COMMITTED'].includes(j.phase) && !(j.phase === 'ROLLBACK' && j.hadDatabase && !j.databasePromoted && j.snapshotSha256 === null))
        throw Error('Legacy activation child lifetime unobserved; retain gate for explicit owned-child inspection');
    const proof = await reconcileInstallationChildren(home, j.id);
    if (proof.cleanup !== 'confirmed')
        throw Error('Installation child cleanup UNKNOWN; retain activation gate: ' + JSON.stringify(proof));
}
async function restoreBeforeAdmission(home: string, j: Journal) {
    await settleChildren(home, j);
    const p = parts(home, j), originalPhase = j.phase;
    await privateDirectory(p.directory);
    await checkpoint(home, j, 'ROLLBACK');
    if (await exists(p.original)) {
        await privateFile(p.live);
        if (await exists(p.live))
            await fs.rename(p.live, path.join(p.directory, 'failed-promoted.sqlite'));
        for (const suffix of ['-wal', '-shm']) {
            await privateFile(p.live + suffix);
            if (await exists(p.live + suffix))
                await fs.rename(p.live + suffix, path.join(p.directory, 'failed-promoted.sqlite' + suffix));
        }
        await fs.rename(p.original, p.live);
    }
    else if (!j.hadDatabase && (j.databasePromoted || ['PROMOTING_DB', 'DB_PROMOTED', 'BOUND', 'ROLLBACK'].includes(originalPhase))) {
        await privateFile(p.live);
        if (await exists(p.live)) {
            if (!j.cloneSha256 || hash(await fs.readFile(p.live)) !== j.cloneSha256)
                throw Error('First promoted database changed; retain instead of deleting unknown state');
            await fs.rename(p.live, path.join(p.directory, 'failed-first.sqlite'));
        }
    }
    else if (j.hadDatabase && j.databasePromoted && (!j.originalSha256 || !await exists(p.live) || hash(await fs.readFile(p.live)) !== j.originalSha256))
        throw Error('Original live database is missing; refuse stale snapshot restoration');
    await syncDirectory(path.dirname(p.live));
    await syncDirectory(p.directory);
    if (j.oldControllerMarker)
        await writeOwnedJson(path.join(home, 'controller.json'), j.oldControllerMarker);
    if (j.oldBinding) {
        await writeOwnedJson(path.join(home, 'binding.json'), j.oldBinding);
        await handshake(home, j.oldBinding.payloadId, j.id + '-rollback');
    }
    else if (await exists(path.join(home, 'binding.json')))
        await fs.rename(path.join(home, 'binding.json'), path.join(p.directory, 'failed-binding.json'));
    await archive(home, j, 'rolled-back');
    return { recovered: 'pre-admission-rollback', previousPayload: j.oldBinding?.payloadId ?? null, previousInstalledHandshake: j.oldBinding ? 'passed' : 'no-prior-installed-version', stateRetained: true };
}
/** Explicit recovery, never background work replay. Holds the existing owner lock. */
export async function recoverActivation(home: string) {
    await privateDirectory(home);
    await privateDirectory(path.join(home, 'state'));
    const release = await acquireOwner(path.join(home, 'state'));
    try {
        await assertNoPendingReset(home);
        const saved = await optionalJson(journalFile(home));
        if (!saved)
            return { recovered: 'nothing-pending' };
        const j = validateJournal(saved);
        if (j.phase === 'COMMITTED') {
            await settleChildren(home, j);
            await handshake(home, j.payloadId, j.id + '-committed-recovery');
            await archive(home, j, 'committed-recovered');
            return { recovered: 'committed-activation-finalized', payloadId: j.payloadId, stateRetained: true };
        }
        return await restoreBeforeAdmission(home, j);
    }
    finally {
        await release();
    }
}
/** Activate one prebuilt owned version; no remote requests or system installation. */
export async function activateBundle(input: {
    bundleRoot: string;
    installationHome: string;
}) {
    const staged = await stageBundle(input), home = input.installationHome, manifest = await validateBundle(input.bundleRoot), release = await acquireOwner(path.join(home, 'state'));
    let journal: Journal | undefined;
    try {
        await assertNoPendingReset(home);
        if (await exists(journalFile(home)))
            throw Error('Recover undecided activation before activation');
        const oldBinding = await optionalJson(path.join(home, 'binding.json')) as Binding | null;
        const oldControllerMarker = await optionalJson(path.join(home, 'controller.json')) as Record<string, unknown>;
        if (!oldControllerMarker || oldControllerMarker.format !== 'gitjig-controller-1')
            throw Error('Actual Controller marker unavailable');
        if (oldBinding && (oldBinding.format !== 1 || !Number.isSafeInteger(oldBinding.generation) || oldBinding.generation < 1 || !/^[a-f0-9]{64}$/.test(oldBinding.payloadId) || !/^[a-f0-9]{64}$/.test(oldBinding.manifestSha256)))
            throw Error('Existing binding is invalid; no activation attempted');
        if (oldBinding?.payloadId === manifest.payloadId && (oldControllerMarker.installation as {
            state?: string;
        } | undefined)?.state !== 'removed') {
            journal = { oldControllerMarker, childProfile: 'installation-child/v1', format: 1, id: randomUUID(), phase: 'PREPARED', payloadId: manifest.payloadId, oldBinding, hadDatabase: await exists(path.join(home, 'state/controller.sqlite')), databasePromoted: false, snapshotSha256: null };
            await privateDirectory(parts(home, journal).directory);
            await writeOwnedJson(journalFile(home), journal);
            const observed = await runInstallationCommand({ home, ownerId: journal.id, payloadId: manifest.payloadId, kind: 'stable-health' });
            const health = JSON.parse(observed.stdout);
            if (health.payloadId !== manifest.payloadId || health.installed !== 'matching-manifest' || health.activation?.id !== journal.id)
                throw Error('Repeated activation lacks actual current installed identity');
            await handshake(home, manifest.payloadId, journal.id + '-repeat');
            await writeOwnedJson(path.join(home, 'controller.json'), { ...oldControllerMarker, installation: { format: 1, state: 'active' } });
            await checkpoint(home, journal, 'COMMITTED');
            await archive(home, journal, 'committed-repeat');
            return { active: true, payloadId: manifest.payloadId, unchanged: true, installedHandshake: 'passed', liveEligibility: 'not-established-by-installation' };
        }
        journal = { oldControllerMarker, childProfile: 'installation-child/v1', format: 1, id: randomUUID(), phase: 'PREPARED', payloadId: manifest.payloadId, oldBinding, hadDatabase: await exists(path.join(home, 'state/controller.sqlite')), databasePromoted: false, snapshotSha256: null };
        const p = parts(home, journal);
        await privateDirectory(p.directory);
        await writeOwnedJson(journalFile(home), journal);
        const bootstrap = path.join(home, 'bootstrap');
        if (await exists(bootstrap)) {
            if (JSON.stringify(await inventoryTree(bootstrap)) !== JSON.stringify(manifest.bootstrap))
                throw Error('Bootstrap update is a separately declared operation; current pinned bootstrap differs');
        }
        else {
            const temporary = path.join(home, '.bootstrap-' + journal.id);
            const copied = await copyAssetTree(path.join(input.bundleRoot, 'bootstrap'), temporary);
            if (JSON.stringify(copied) !== JSON.stringify(manifest.bootstrap))
                throw Error('Bootstrap bundle changed during copy');
            await fs.rename(temporary, bootstrap);
            await syncDirectory(home);
        }
        const launcher = path.join(home, 'gitjig');
        if (await exists(launcher)) {
            await privateFile(launcher);
            if (hash(await fs.readFile(launcher)) !== hash(await fs.readFile(path.join(bootstrap, 'launcher'))))
                throw Error('Owned launcher was changed; retain it for explicit repair');
        }
        else {
            await fs.copyFile(path.join(bootstrap, 'launcher'), launcher, fs.constants.COPYFILE_EXCL);
            await fs.chmod(launcher, 0o500);
        }
        const snapshot = await backupOwnedDatabase(p.live, p.snapshot);
        journal.snapshotSha256 = snapshot.sha256;
        await checkpoint(home, journal, 'SNAPSHOT');
        if (snapshot.exists) {
            await fs.copyFile(p.snapshot, p.clone, fs.constants.COPYFILE_EXCL);
            await fs.chmod(p.clone, 0o600);
        }
        else {
            const db = new DatabaseSync(p.clone);
            db.close();
            await fs.chmod(p.clone, 0o600);
        }
        const migration = await candidateCommand(home, manifest.payloadId, 'migrate.js', [p.clone]);
        await writeOwnedJson(path.join(p.directory, 'migration.json'), JSON.parse(migration.stdout));
        await handshake(home, manifest.payloadId, journal.id + '-candidate');
        journal.cloneSha256 = hash(await fs.readFile(p.clone));
        await checkpoint(home, journal, 'VERIFIED');
        // Flush old WAL under the sole owner before renaming the main database. No new task can enter.
        if (journal.hadDatabase) {
            const db = new DatabaseSync(p.live);
            try {
                const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
                if (result && Object.values(result)[0] !== 0)
                    throw Error('Live database checkpoint busy; refuse promotion');
            }
            finally {
                db.close();
            }
        }
        if (journal.hadDatabase)
            journal.originalSha256 = hash(await fs.readFile(p.live));
        await checkpoint(home, journal, 'PROMOTING_DB');
        if (journal.hadDatabase)
            await fs.rename(p.live, p.original);
        await fs.rename(p.clone, p.live);
        await syncDirectory(path.dirname(p.live));
        await syncDirectory(p.directory);
        journal.databasePromoted = true;
        await checkpoint(home, journal, 'DB_PROMOTED');
        const manifestFile = path.join(home, 'manifests', manifest.payloadId + '.json'), binding: Binding = { format: 1, payloadId: manifest.payloadId, manifestSha256: hash(await fs.readFile(manifestFile)), generation: (oldBinding?.generation ?? 0) + 1, previous: oldBinding?.payloadId ?? null };
        await writeOwnedJson(path.join(home, 'binding.json'), binding);
        await checkpoint(home, journal, 'BOUND');
        await handshake(home, manifest.payloadId, journal.id + '-bound');
        const stable = await runInstallationCommand({ home, ownerId: journal.id, payloadId: manifest.payloadId, kind: 'stable-health' });
        const observation = JSON.parse(stable.stdout);
        if (observation.payloadId !== manifest.payloadId || observation.installed !== 'matching-manifest')
            throw Error('Bound installed assets not observed');
        await writeOwnedJson(path.join(home, 'controller.json'), { ...oldControllerMarker, installation: { format: 1, state: 'active' } });
        await checkpoint(home, journal, 'COMMITTED');
        await archive(home, journal, 'committed');
        return { active: true, payloadId: manifest.payloadId, generation: binding.generation, source: staged.version, preAdmissionSnapshot: snapshot, installedHandshake: 'passed', liveEligibility: 'not-established-by-installation' };
    }
    catch (error) {
        if (journal && journal.phase !== 'COMMITTED') {
            journal.failure = (error as Error).message;
            await writeOwnedJson(journalFile(home), journal);
            try {
                await restoreBeforeAdmission(home, journal);
            }
            catch (recovery) {
                throw new AggregateError([error, recovery], 'Activation failed; undecided journal retained and live admission stays blocked');
            }
        }
        throw error;
    }
    finally {
        await release();
    }
}

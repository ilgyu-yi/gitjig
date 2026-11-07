import fs from 'node:fs/promises';
import fsSync, { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openNativeGit, reconcileOwnedGitProcesses, type NativeGitClient } from '../effects/native-git.js';
import type { NativeGitNamespaceProof, NativeGitProfile } from '../effects/types.js';
import { privateDirectory, type OwnerLease } from './ownership.js';
import { SourcePreviewWriter, samePreviewDatabaseScope } from './source-preview-writer.js';
import { SourceBranchPreviews, sourcePreviewFactoryProtocol, type UnopenedGateEvidence } from './source-branch-previews.js';
import type { Store } from './store.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gateHolds = {
    'admission-unavailable': 'Original durable admission cannot be validated',
    'writer-unavailable': 'Actual owner or WAL/FULL writer is unavailable',
    'owner-or-database-changed': 'Original state-directory or database identity changed',
    'gate-state-changed': 'Original gate state or root pointer changed',
    'orphan-root-receipt': 'Reserved root receipt exists without its projection pointer',
    'live-invocation-unavailable': 'Exact joined live invocation is unavailable',
    'former-owner-active': 'Former owner PID is alive or reused',
    'former-owner-unavailable': 'Former owner inactivity cannot be established',
    'unsafe-namespace': 'Original namespace is linked, unowned or has unsafe permissions',
    'observed-native-entry': 'Unexpected native artifact or nonempty command namespace exists',
    'namespace-changed': 'Namespace observations changed before settlement',
    'namespace-read-unavailable': 'Bounded original namespace observation is unavailable',
    'gate-commit-unavailable': 'Final durable-gate correspondence could not commit'
} as const;
class GateHold extends Error {
    constructor(readonly code: keyof typeof gateHolds) { super(gateHolds[code]); }
}
type Preview = ReturnType<SourceBranchPreviews['inspect']>;
type Profile = Omit<NativeGitProfile, 'ownedClientRoot' | 'resumeOwned'>;
export interface SourceBranchPreviewInput {
    workId: string;
    sourceId: string;
    epoch: number;
    generation: number;
    inputDigest: string;
    profile: Profile;
    validate(): void;
    signal?: AbortSignal;
}
/** Closed factual/private operations. The native client and source-write methods never escape. */
export interface SourceBranchPreviewTools {
    initializedProof: () => ReturnType<NativeGitClient['initializedProof']>;
    observeSourceBranchTarget: (...args: [Parameters<NativeGitClient['observeSourceBranchTarget']>[0], Parameters<NativeGitClient['observeSourceBranchTarget']>[1]]) => ReturnType<NativeGitClient['observeSourceBranchTarget']>;
    fetchSourceBasis: (...args: [Parameters<NativeGitClient['fetchSourceBasis']>[0], string]) => ReturnType<NativeGitClient['fetchSourceBasis']>;
    inspectSourceBasis: (...args: [Parameters<NativeGitClient['inspectSourceBasis']>[0], string]) => ReturnType<NativeGitClient['inspectSourceBasis']>;
    projectSourceSnapshot: (input: Omit<Parameters<NativeGitClient['projectSourceSnapshot']>[0], 'operationId' | 'previewId' | 'sourceInputDigest'>) => ReturnType<NativeGitClient['projectSourceSnapshot']>;
    project: (input: Parameters<NativeGitClient['project']>[0]) => ReturnType<NativeGitClient['project']>;
    buildIntegration: (input: Parameters<NativeGitClient['buildIntegration']>[0]) => ReturnType<NativeGitClient['buildIntegration']>;
}
function namespace(row: Preview): NativeGitNamespaceProof | undefined {
    if (row.admission.factoryProtocol !== sourcePreviewFactoryProtocol || !row.root || !('protocol' in row.root)) return undefined;
    const { admissionSourceId: _, ...proof } = row.root as NativeGitNamespaceProof & { admissionSourceId: string };
    return proof;
}
function synchronous(validate: () => void) {
    const result: unknown = validate();
    if (result !== undefined) {
        // Observe rejected async guards without treating their eventual result as admission.
        void Promise.resolve(result).catch(() => {});
        throw Error('Source preview guard must complete synchronously without a return value');
    }
}
async function syncDirectory(directory: string) {
    const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
}

/** Internal foundation only. Construction is inert; no public action or permission is created. */
export class SourceBranchPreviewRuntime {
    private readonly registry: SourceBranchPreviews;
    private readonly shutdown = new AbortController();
    private readonly active = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
    private startup: Promise<void> | undefined;
    private recovered = false;
    private closed: Promise<void> | undefined;
    private readonly writer: SourcePreviewWriter;
    private readonly releaseClaim: () => void;
    constructor(private readonly store: Store, private readonly installationHome: string, owner: OwnerLease) {
        this.writer = new SourcePreviewWriter(store, installationHome, owner);
        this.registry = new SourceBranchPreviews(store, installationHome, this.writer);
        this.releaseClaim = owner.claimSourcePreviewRuntime();
    }
    /** Read-only original writer identity; startup must already have qualified it. */
    assertCurrentWriter() {
        if (!this.recovered || this.shutdown.signal.aborted) throw Error('Original source preview writer unavailable');
        return this.writer.assertCurrent();
    }
    recover(): Promise<void> {
        if (this.startup) return this.startup;
        if (this.shutdown.signal.aborted) return Promise.reject(Error('Source preview host is closing'));
        this.startup = Promise.resolve().then(async () => {
            // Qualify THIS writer once; historical durability comes only from admission evidence.
            this.writer.prepare();
            let after: string | undefined;
            do {
                this.shutdown.signal.throwIfAborted();
                const page = this.registry.active({ ...after ? { after } : {}, limit: 25 });
                for (const row of page.previews) {
                    this.shutdown.signal.throwIfAborted();
                    await this.reconcile(row);
                }
                after = page.nextCursor ?? undefined;
            } while (after);
            this.recovered = true;
        }).catch(async error => {
            this.quiesce();
            await Promise.allSettled([...this.active.values()].map(task => task.done));
            this.releaseClaim();
            throw error;
        });
        void this.startup.catch(() => {});
        return this.startup;
    }
    private async reconcile(row: Preview, joinedLive = false) {
        const proof = namespace(row);
        if (!proof) {
            if (row.admission.durableGate && row.root_source === null && row.state === 'UNRESOLVED') {
                try {
                    const observations = this.unopened(row, joinedLive);
                    this.registry.settleNeverEnabled(row.id, { boundary: joinedLive ? 'joined-live' : 'former-owner-inactive', evidence: observations }, () => { if (JSON.stringify(this.unopened(row, joinedLive)) !== JSON.stringify(observations)) throw new GateHold('namespace-changed'); });
                    return true;
                } catch (error) {
                    const hold = error instanceof GateHold ? error : new GateHold('gate-commit-unavailable');
                    this.registry.markUnknown(row.id, `durable-gate/${hold.code}: ${hold.message}`);
                    return false;
                }
            }
            this.registry.markUnknown(row.id, row.state === 'UNKNOWN' ? 'prior-uncertainty: Original UNKNOWN retained without automatic promotion' : 'unsupported-admission-protocol: Original factory namespace proof unavailable');
            return false;
        }
        // Native reconciliation verifies the admitted root/runs identities before AND after reads.
        const result = await reconcileOwnedGitProcesses(proof.clientRoot, 2500, proof);
        if (result.cleanup !== 'confirmed') {
            this.registry.markUnknown(row.id, 'Original native namespace or process cleanup remains UNKNOWN');
            return false;
        }
        this.registry.settle(row.id, { admissionSourceId: row.admission_source, rootSourceId: row.root_source!, kind: 'joined-owned-native', cleanup: 'confirmed', receiptDigest: hash(result) });
        return true;
    }
    private unopened(row: Preview, joinedLive: boolean): UnopenedGateEvidence {
        try {
            let current: Preview, writer;
            try { current = this.registry.inspect(row.id); } catch { throw new GateHold('admission-unavailable'); }
            try { writer = this.writer.assertCurrent(); } catch { throw new GateHold('writer-unavailable'); }
            const gate = current.admission.durableGate;
            if (!gate || current.state !== 'UNRESOLVED' || current.root_source !== null || current.admission_source !== row.admission_source) throw new GateHold('gate-state-changed');
            if (!samePreviewDatabaseScope(gate.writer, writer)) throw new GateHold('owner-or-database-changed');
            if (this.store.one('SELECT id FROM sources WHERE id=?', gate.rootReceiptId)) throw new GateHold('orphan-root-receipt');
            if (joinedLive) {
                if (!this.active.has(row.id) || JSON.stringify(writer) !== JSON.stringify(gate.writer)) throw new GateHold('live-invocation-unavailable');
            } else {
                let inactive = false;
                try { process.kill(gate.writer.owner.pid, 0); }
                catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') inactive = true; else throw new GateHold('former-owner-unavailable'); }
                if (!inactive) throw new GateHold('former-owner-active');
            }
            // Absence is only an observation. Durable unopened-gate ordering is the proof.
            const evidence: UnopenedGateEvidence = { currentWriter: writer, owner: { boundary: joinedLive ? 'joined-live' : 'former-owner-inactive', formerPid: gate.writer.owner.pid, result: joinedLive ? 'factory-tail-joined' : 'ESRCH' }, namespace: [], clientEntries: null, emptyChildren: [] };
            const observations = evidence.namespace;
            const directory = (file: string): boolean => {
                let stat;
                try { stat = fsSync.lstatSync(file); }
                catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { observations.push({ file, absent: true }); return false; } throw error; }
                if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || fsSync.realpathSync(file) !== file)
                    throw new GateHold('unsafe-namespace');
                observations.push({ file, device: String(stat.dev), inode: String(stat.ino), ownerUid: stat.uid, mode: stat.mode & 0o777 });
                return true;
            };
            for (const file of [this.installationHome, path.join(this.installationHome, 'effects'), path.dirname(current.admission.clientRoot), current.admission.clientRoot]) {
                if (!directory(file)) return evidence;
            }
            const children: string[] = [], entries = fsSync.opendirSync(current.admission.clientRoot);
            try {
                for (let n = 0; n < 4; n++) {
                    const entry = entries.readSync();
                    if (!entry) break;
                    children.push(entry.name);
                }
            } finally { entries.closeSync(); }
            if (children.length > 3 || children.some(name => !['home', 'no-hooks', 'runs'].includes(name))) throw new GateHold('observed-native-entry');
            children.sort();
            evidence.clientEntries = children;
            for (const name of children) {
                const file = path.join(current.admission.clientRoot, name);
                if (!directory(file)) throw new GateHold('namespace-changed');
                const dir = fsSync.opendirSync(file);
                try { if (dir.readSync() !== null) throw new GateHold('observed-native-entry'); }
                finally { dir.closeSync(); }
                evidence.emptyChildren.push(name);
            }
            for (const item of observations as { file: string; absent?: boolean; device?: string; inode?: string }[]) {
                if (item.absent) { if (fsSync.existsSync(item.file)) throw new GateHold('namespace-changed'); continue; }
                const stat = fsSync.lstatSync(item.file);
                if (String(stat.dev) !== item.device || String(stat.ino) !== item.inode || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.() || fsSync.realpathSync(item.file) !== item.file) throw new GateHold('namespace-changed');
            }
            return evidence;
        } catch (error) { if (error instanceof GateHold) throw error; throw new GateHold('namespace-read-unavailable'); }
    }
    run<T>(input: SourceBranchPreviewInput, prepare: (tools: Readonly<SourceBranchPreviewTools>, signal: AbortSignal) => Promise<T>, onAdmitted?: (previewId: string) => void): Promise<{ previewId: string; value: T }> {
        if (!this.recovered || this.shutdown.signal.aborted) throw Error('Original source preview discovery must finish before admission');
        const profile = structuredClone(input.profile), allowed = ['gitBinary', 'objectFormat', 'maxEntries', 'maxBytes', 'commandTimeoutMs', 'operationTimeoutMs', 'maxOutputBytes'];
        if (!profile || Object.keys(profile).some(key => !allowed.includes(key)) || typeof profile.gitBinary !== 'string' || Buffer.byteLength(JSON.stringify(profile)) > 16384)
            throw Error('Closed bounded source preview native profile required');
        const captured = { workId: input.workId, sourceId: input.sourceId, epoch: input.epoch, generation: input.generation, inputDigest: input.inputDigest, profile: Object.freeze(profile), validate: input.validate };
        const abort = new AbortController(), signal = AbortSignal.any([abort.signal, this.shutdown.signal, ...input.signal ? [input.signal] : []]);
        let original: Preview | undefined, expectedRoot: string | null = null;
        const sourceGuard = () => {
            signal.throwIfAborted();
            synchronous(captured.validate);
            signal.throwIfAborted();
            this.writer.assertCurrent();
            const work = this.store.one('SELECT source,epoch,generation,state FROM works WHERE id=?', captured.workId);
            if (!work || work.source !== captured.sourceId || work.epoch !== captured.epoch || work.generation !== captured.generation || !['ACTIVE', 'DELIVERED'].includes(work.state))
                throw Error('Original source preview work identity changed');
        };
        const guard = () => {
            sourceGuard();
            if (original) {
                const row = this.store.one('SELECT admission_source,root_source,state FROM source_branch_previews WHERE id=?', original.id);
                if (!row || row.state !== 'UNRESOLVED' || row.admission_source !== original.admission_source || row.root_source !== expectedRoot) throw Error('Original preview ownership changed before native admission');
            }
        };
        guard();
        const row = this.registry.admitDurable({ workId: captured.workId, sourceId: captured.sourceId, epoch: captured.epoch, generation: captured.generation, inputDigest: captured.inputDigest, profileDigest: hash(profile) });
        original = row;
        // Register the ENTIRE ownership tail synchronously, before any async filesystem/factory work.
        const done = Promise.resolve().then(() => this.perform(row, captured.profile, guard, signal, prepare, root => { expectedRoot = root; }, sourceGuard, onAdmitted));
        this.active.set(row.id, { abort, done });
        void done.then(() => this.active.delete(row.id), () => this.active.delete(row.id));
        return done;
    }
    private async perform<T>(row: Preview, profile: Readonly<Profile>, guard: () => void, signal: AbortSignal, prepare: (tools: Readonly<SourceBranchPreviewTools>, signal: AbortSignal) => Promise<T>, rootAttached: (root: string) => void, completedGuard: () => void, onAdmitted?: (previewId: string) => void) {
        let client: NativeGitClient | undefined, value: T | undefined, failure: unknown, failed = false, settled = false;
        try {
            if (onAdmitted) synchronous(() => onAdmitted(row.id));
            guard();
            await privateDirectory(this.installationHome);
            guard();
            await privateDirectory(path.join(this.installationHome, 'effects'));
            guard();
            await syncDirectory(this.installationHome);
            guard();
            await fs.mkdir(path.dirname(row.admission.clientRoot), { mode: 0o700 });
            await privateDirectory(path.dirname(row.admission.clientRoot));
            await syncDirectory(path.join(this.installationHome, 'effects'));
            guard();
            client = await openNativeGit({ ...profile, ownedClientRoot: row.admission.clientRoot }, signal, {
                exclusiveRoot: true,
                beforeFirstCommand: proof => {
                    guard();
                    const rooted = this.registry.attachRoot(row.id, { ...proof, admissionSourceId: row.admission_source });
                    rootAttached(rooted.root_source!);
                },
                assertCurrent: guard
            });
            guard();
            const owned = client;
            const tools = Object.freeze<SourceBranchPreviewTools>({
                initializedProof: () => { guard(); const result = owned.initializedProof(); guard(); return result; },
                observeSourceBranchTarget: async (target, environment) => { guard(); const result = await owned.observeSourceBranchTarget(target, environment, signal); guard(); return result; },
                fetchSourceBasis: async (target, basis) => { guard(); await owned.fetchSourceBasis(target, basis, signal); guard(); },
                inspectSourceBasis: async (target, basis) => { guard(); const result = await owned.inspectSourceBasis(target, basis, signal); guard(); return result; },
                projectSourceSnapshot: async input => {
                    guard();
                    const result = await owned.projectSourceSnapshot({ ...input, operationId: 'source-preview-' + row.id, previewId: row.id, sourceInputDigest: row.admission.inputDigest }, signal);
                    guard();
                    if (result.kind === 'projected' && (result.receipt.operationId !== 'source-preview-' + row.id || result.receipt.previewId !== row.id || result.receipt.sourceInputDigest !== row.admission.inputDigest))
                        throw Error('Original source projection receipt identity differs');
                    return result;
                },
                project: async input => { guard(); const result = await owned.project(input, signal); guard(); return result; },
                buildIntegration: async input => { guard(); const result = await owned.buildIntegration(input, signal); guard(); return result; }
            });
            value = await prepare(tools, signal);
            guard();
        } catch (error) { failure = error; failed = true; }
        finally {
            // Physical cleanup is independent of obsolete navigation/source guards.
            try { await client?.close(); }
            catch (error) { if (!failed) { failure = error; failed = true; } }
            settled = await this.reconcile(this.registry.inspect(row.id), true);
        }
        if (!settled) throw Error('Original source preview cleanup UNKNOWN: ' + row.id, { cause: failure });
        if (failed) throw failure;
        completedGuard();
        return { previewId: row.id, value: value as T };
    }
    quiesce(): void {
        this.shutdown.abort(Error('Source preview host closing'));
        for (const task of this.active.values()) task.abort.abort();
    }
    close(): Promise<void> {
        if (this.closed) return this.closed;
        this.quiesce();
        this.closed = (async () => {
            if (this.startup) await Promise.allSettled([this.startup]);
            await Promise.allSettled([...this.active.values()].map(task => task.done));
            const remaining = this.registry.active({ limit: 25 });
            if (remaining.previews.length) throw Error('Original source preview cleanup UNKNOWN; retain originals: ' + remaining.previews.map(row => row.id).join(', ') + (remaining.nextCursor ? ' (more retained)' : ''));
            this.releaseClaim();
        })();
        return this.closed;
    }
}

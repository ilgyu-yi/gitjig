import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { NativeGitNamespaceProof } from '../effects/types.js';
import { durablePreviewProtocol, samePreviewDatabaseScope, validPreviewWriterWitness, type PreviewWriterWitness, type SourcePreviewWriter } from './source-preview-writer.js';

export const sourcePreviewFactoryProtocol = 'owned-native-git-prebirth/v1' as const;

type State = 'UNRESOLVED' | 'UNKNOWN' | 'SETTLED';
interface Projection {
    id: string;
    work: string;
    admission_source: string;
    root_source: string | null;
    state: State;
    terminal_source: string | null;
}
interface Admission {
    version: 1;
    previewId: string;
    workId: string;
    sourceId: string;
    projectId: string | null;
    epoch: number;
    generation: number;
    clientRoot: string;
    ownerUid: number;
    profileDigest: string;
    inputDigest: string;
    factoryProtocol?: typeof sourcePreviewFactoryProtocol;
    durableGate?: { rootReceiptId: string; writer: PreviewWriterWitness };
}
interface RootProof {
    admissionSourceId: string;
    clientRoot: string;
    device: string;
    inode: string;
    ownerUid: number;
}
type FactoryRootProof = NativeGitNamespaceProof & { admissionSourceId: string };
export interface UnopenedGateEvidence {
    currentWriter: PreviewWriterWitness;
    owner: { boundary: 'joined-live' | 'former-owner-inactive'; formerPid: number; result: 'factory-tail-joined' | 'ESRCH' };
    namespace: ({ file: string; absent: true } | { file: string; device: string; inode: string; ownerUid: number; mode: number })[];
    clientEntries: string[] | null;
    emptyChildren: string[];
}
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096 && !/[\x00-\x1f\x7f]/u.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const previewIdentity = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const keys = (value: object, expected: string[]) => Object.keys(value).sort().join('\0') === expected.sort().join('\0');
const evidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Private ownership projection only. Callers must obtain actual native cleanup evidence.
 * This data cut neither starts processes nor qualifies pre-initialization no-birth settlement.
 */
export class SourceBranchPreviews {
    constructor(private readonly store: Store, private readonly installationHome: string, private readonly writer?: SourcePreviewWriter) {
        if (!identity(installationHome) || !path.isAbsolute(installationHome) || path.normalize(installationHome) !== installationHome)
            throw Error('Canonical installation-home path required for preview ownership');
    }
    private source(id: string, purpose: string, row: Projection): any {
        const source = this.store.one("SELECT conversation,origin,raw FROM sources WHERE id=? AND length(CAST(origin AS BLOB))<=16384 AND length(CAST(raw AS BLOB))<=16384", id);
        if (!source || source.conversation !== null) throw Error('Original bounded preview source unavailable');
        let origin;
        try { origin = JSON.parse(source.origin); }
        catch { throw Error('Original preview source purpose or ownership differs'); }
        if (!origin || typeof origin !== 'object' || Array.isArray(origin) || !keys(origin, ['kind', 'purpose', 'previewId', 'workId']) || origin.kind !== 'source-branch-preview' || origin.purpose !== purpose || origin.previewId !== row.id || origin.workId !== row.work)
            throw Error('Original preview source purpose or ownership differs');
        let raw;
        try { raw = JSON.parse(source.raw); }
        catch { throw Error('Original preview source payload unavailable'); }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Original preview source payload unavailable');
        return raw;
    }
    inspect(previewId: string) {
        if (!previewIdentity(previewId)) throw Error('Original preview ID required');
        const row = this.store.one('SELECT * FROM source_branch_previews WHERE id=?', previewId) as Projection | undefined;
        if (!row) throw Error('Original preview ownership unavailable');
        const admission = this.source(row.admission_source, 'admission', row) as Admission;
        const stamped = Object.hasOwn(admission, 'factoryProtocol');
        const durable = Object.hasOwn(admission, 'durableGate');
        if (!keys(admission, ['version', 'previewId', 'workId', 'sourceId', 'projectId', 'epoch', 'generation', 'clientRoot', 'ownerUid', 'profileDigest', 'inputDigest', ...stamped ? ['factoryProtocol'] : [], ...durable ? ['durableGate'] : []]) || stamped && admission.factoryProtocol !== sourcePreviewFactoryProtocol || admission.version !== 1 || admission.previewId !== row.id || admission.workId !== row.work || !identity(admission.sourceId) || !this.store.one('SELECT id FROM sources WHERE id=?', admission.sourceId) || admission.projectId !== null && !identity(admission.projectId) || !counter(admission.epoch) || !counter(admission.generation) || admission.clientRoot !== path.join(this.installationHome, 'effects', 'source-preview-' + row.id, 'client') || admission.ownerUid !== process.getuid?.() || !digest(admission.profileDigest) || !digest(admission.inputDigest) || durable && (!admission.durableGate || !keys(admission.durableGate, ['rootReceiptId', 'writer']) || !previewIdentity(admission.durableGate.rootReceiptId) || !validPreviewWriterWitness(admission.durableGate.writer, this.installationHome) || !stamped || admission.durableGate.writer.owner.ownerUid !== admission.ownerUid))
            throw Error('Original preview admission binding unavailable');
        if (durable && row.root_source !== null && row.root_source !== admission.durableGate!.rootReceiptId)
            throw Error('Original durable preview root receipt differs');
        const root = row.root_source ? this.source(row.root_source, 'root', row) as RootProof | FactoryRootProof : null;
        if (root && !this.rootMatches(admission, row.admission_source, root))
            throw Error('Original preview root binding differs');
        const terminal = row.terminal_source ? this.source(row.terminal_source, 'terminal', row) : null;
        const neverEnabled = terminal?.kind === 'durable-gate-never-enabled';
        if (neverEnabled && admission.durableGate && this.store.one('SELECT id FROM sources WHERE id=?', admission.durableGate.rootReceiptId))
            throw Error('Observed root receipt contradicts unopened durable gate');
        if (terminal && (neverEnabled ? !durable || !!root || !keys(terminal, ['admissionSourceId', 'rootSourceId', 'kind', 'protocol', 'boundary', 'rootReceiptId', 'clientRoot', 'evidence', 'receiptDigest']) || terminal.protocol !== durablePreviewProtocol || terminal.rootReceiptId !== admission.durableGate?.rootReceiptId || terminal.clientRoot !== admission.clientRoot || !this.validUnopenedEvidence(admission, terminal.boundary, terminal.evidence) || terminal.receiptDigest !== evidenceHash(terminal.evidence) : !root || !keys(terminal, ['admissionSourceId', 'rootSourceId', 'kind', 'cleanup', 'receiptDigest']) || terminal.kind !== 'joined-owned-native' || terminal.cleanup !== 'confirmed') || terminal && (terminal.admissionSourceId !== row.admission_source || terminal.rootSourceId !== row.root_source || !digest(terminal.receiptDigest)))
            throw Error('Original preview terminal binding differs');
        if (!['UNRESOLVED', 'UNKNOWN', 'SETTLED'].includes(row.state) || (row.state === 'SETTLED') !== !!terminal)
            throw Error('Original preview cleanup state differs');
        return { ...row, admission, root, terminal };
    }
    private rootMatches(admission: Admission, sourceId: string, root: RootProof | FactoryRootProof) {
        const stamped = admission.factoryProtocol === sourcePreviewFactoryProtocol;
        if (!keys(root, ['admissionSourceId', 'clientRoot', 'device', 'inode', 'ownerUid', ...stamped ? ['protocol', 'runsDirectory', 'runsDevice', 'runsInode', 'runsOwnerUid', 'gitBinary'] : []]) || root.admissionSourceId !== sourceId || root.clientRoot !== admission.clientRoot || !identity(root.device) || !identity(root.inode) || root.ownerUid !== admission.ownerUid) return false;
        if (!stamped) return true;
        const proof = root as FactoryRootProof;
        return proof.protocol === sourcePreviewFactoryProtocol && proof.runsDirectory === path.join(admission.clientRoot, 'runs') && identity(proof.runsDevice) && identity(proof.runsInode) && proof.runsOwnerUid === admission.ownerUid && identity(proof.gitBinary) && path.isAbsolute(proof.gitBinary) && path.normalize(proof.gitBinary) === proof.gitBinary;
    }
    private assertWriter(admission: Admission) {
        if (!this.writer || !admission.durableGate || JSON.stringify(this.writer.assertCurrent()) !== JSON.stringify(admission.durableGate.writer))
            throw Error('Original durable preview writer differs');
    }
    private validUnopenedEvidence(admission: Admission, boundary: unknown, evidence: any): evidence is UnopenedGateEvidence {
        const gate = admission.durableGate;
        if (!gate || !evidence || !keys(evidence, ['currentWriter', 'owner', 'namespace', 'clientEntries', 'emptyChildren']) || !validPreviewWriterWitness(evidence.currentWriter, this.installationHome) || !samePreviewDatabaseScope(gate.writer, evidence.currentWriter) || !evidence.owner || !keys(evidence.owner, ['boundary', 'formerPid', 'result']) || evidence.owner.boundary !== boundary || evidence.owner.formerPid !== gate.writer.owner.pid || !['joined-live', 'former-owner-inactive'].includes(String(boundary)) || evidence.owner.result !== (boundary === 'joined-live' ? 'factory-tail-joined' : 'ESRCH') || boundary === 'joined-live' && JSON.stringify(evidence.currentWriter) !== JSON.stringify(gate.writer) || !Array.isArray(evidence.namespace) || !evidence.namespace.length || evidence.namespace.length > 7 || !Array.isArray(evidence.emptyChildren)) return false;
        const allowed = [this.installationHome, path.join(this.installationHome, 'effects'), path.dirname(admission.clientRoot), admission.clientRoot, ...['home', 'no-hooks', 'runs'].map(name => path.join(admission.clientRoot, name))], seen = new Set<string>();
        if (!evidence.namespace.every((item: any) => {
            if (!item || !allowed.includes(item.file) || seen.has(item.file)) return false;
            seen.add(item.file);
            return item.absent === true ? keys(item, ['file', 'absent']) : keys(item, ['file', 'device', 'inode', 'ownerUid', 'mode']) && identity(item.device) && identity(item.inode) && item.ownerUid === admission.ownerUid && Number.isSafeInteger(item.mode) && item.mode >= 0 && item.mode <= 0o777 && !(item.mode & 0o077);
        })) return false;
        const absent = evidence.namespace.findIndex((item: any) => item.absent === true);
        if (absent >= 0) return absent > 0 && absent < 4 && absent === evidence.namespace.length - 1 && evidence.namespace.every((item: any, index: number) => item.file === allowed[index]) && evidence.clientEntries === null && evidence.emptyChildren.length === 0;
        if (!Array.isArray(evidence.clientEntries) || evidence.clientEntries.length > 3 || new Set(evidence.clientEntries).size !== evidence.clientEntries.length || evidence.clientEntries.some((name: unknown) => !['home', 'no-hooks', 'runs'].includes(String(name))) || evidence.namespace.length !== 4 + evidence.clientEntries.length || !evidence.namespace.slice(0, 4).every((item: any, index: number) => item.file === allowed[index])) return false;
        return JSON.stringify([...evidence.emptyChildren].sort()) === JSON.stringify([...evidence.clientEntries].sort()) && evidence.namespace.slice(4).every((item: any, index: number) => item.file === path.join(admission.clientRoot, evidence.clientEntries[index]));
    }
    private record(row: Pick<Projection, 'id' | 'work'>, purpose: string, raw: object, sourceId: string = randomUUID()) {
        this.writer?.assertCurrent();
        const bytes = JSON.stringify(raw);
        if (Buffer.byteLength(bytes) > 16384) throw Error('Preview source exceeds bounded16KiB profile');
        this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'source-branch-preview', purpose, previewId: row.id, workId: row.work }), bytes);
        return sourceId;
    }
    admit(input: { workId: string; sourceId: string; epoch: number; generation: number; profileDigest: string; inputDigest: string; factoryProtocol?: typeof sourcePreviewFactoryProtocol }) {
        return this.admitBound(input);
    }
    admitDurable(input: { workId: string; sourceId: string; epoch: number; generation: number; profileDigest: string; inputDigest: string }) {
        if (!this.writer) throw Error('Actual qualified preview writer required');
        return this.admitBound({ ...input, factoryProtocol: sourcePreviewFactoryProtocol }, { rootReceiptId: randomUUID(), writer: this.writer.prepare() });
    }
    private admitBound(input: { workId: string; sourceId: string; epoch: number; generation: number; profileDigest: string; inputDigest: string; factoryProtocol?: typeof sourcePreviewFactoryProtocol }, durableGate?: Admission['durableGate']) {
        if (!identity(input.workId) || !identity(input.sourceId) || !counter(input.epoch) || !counter(input.generation) || !digest(input.profileDigest) || !digest(input.inputDigest) || Object.hasOwn(input, 'factoryProtocol') && input.factoryProtocol !== sourcePreviewFactoryProtocol)
            throw Error('Exact bounded preview admission operands required');
        this.writer?.assertCurrent();
        return this.store.tx(() => {
            const work = this.store.one('SELECT id,source,project,epoch,generation FROM works WHERE id=?', input.workId);
            if (!work || work.source !== input.sourceId || work.epoch !== input.epoch || work.generation !== input.generation)
                throw Error('Original work/source changed before preview admission');
            const id = randomUUID(), ownerUid = process.getuid?.();
            if (!Number.isSafeInteger(ownerUid) || ownerUid! < 0) throw Error('Actual local owner required');
            const admission: Admission = { version: 1, previewId: id, workId: work.id, sourceId: work.source, projectId: work.project,
                epoch: work.epoch, generation: work.generation, clientRoot: path.join(this.installationHome, 'effects', 'source-preview-' + id, 'client'), ownerUid: ownerUid!, profileDigest: input.profileDigest, inputDigest: input.inputDigest, ...input.factoryProtocol ? { factoryProtocol: input.factoryProtocol } : {}, ...durableGate ? { durableGate } : {} };
            const sourceId = this.record({ id, work: work.id }, 'admission', admission);
            this.writer?.assertCurrent();
            this.store.run("INSERT INTO source_branch_previews VALUES(?,?,?,?,?,?)", id, work.id, sourceId, null, 'UNRESOLVED', null);
            const result = this.inspect(id);
            if (durableGate) {
                this.assertWriter(admission);
                if (this.store.one('SELECT id FROM sources WHERE id=?', durableGate.rootReceiptId)) throw Error('Reserved durable root receipt already exists');
            }
            this.writer?.assertCurrent();
            return result;
        });
    }
    attachRoot(previewId: string, input: RootProof | FactoryRootProof) {
        this.writer?.assertCurrent();
        return this.store.tx(() => {
            const row = this.inspect(previewId);
            if (row.state === 'SETTLED' || row.root_source || !input || !this.rootMatches(row.admission, row.admission_source, input))
                throw Error('Exact original active preview root proof required');
            if (row.admission.durableGate) this.assertWriter(row.admission);
            const sourceId = this.record(row, 'root', input, row.admission.durableGate?.rootReceiptId);
            this.writer?.assertCurrent();
            this.store.run('UPDATE source_branch_previews SET root_source=? WHERE id=?', sourceId, previewId);
            const result = this.inspect(previewId);
            if (row.admission.durableGate) {
                this.assertWriter(row.admission);
                if (result.root_source !== row.admission.durableGate.rootReceiptId || result.state !== 'UNRESOLVED') throw Error('Durable root transaction correspondence changed');
            }
            this.writer?.assertCurrent();
            return result;
        });
    }
    markUnknown(previewId: string, reason: string) {
        if (!identity(reason)) throw Error('Bounded preview cleanup reason required');
        this.writer?.assertCurrent();
        return this.store.tx(() => {
            const row = this.inspect(previewId);
            if (row.state === 'SETTLED') throw Error('Settled preview ownership cannot reopen');
            const sourceId = this.record(row, 'unknown', { admissionSourceId: row.admission_source, rootSourceId: row.root_source, reason });
            this.writer?.assertCurrent();
            this.store.run("UPDATE source_branch_previews SET state='UNKNOWN' WHERE id=?", previewId);
            const result = { ...this.inspect(previewId), observationSourceId: sourceId };
            this.writer?.assertCurrent();
            return result;
        });
    }
    settle(previewId: string, input: { admissionSourceId: string; rootSourceId: string; kind: 'joined-owned-native'; cleanup: 'confirmed'; receiptDigest: string }) {
        this.writer?.assertCurrent();
        return this.store.tx(() => {
            const row = this.inspect(previewId);
            if (this.writer && row.admission.durableGate && !samePreviewDatabaseScope(row.admission.durableGate.writer, this.writer.assertCurrent())) throw Error('Original joined preview database scope differs');
            if (row.state === 'SETTLED' || !row.root_source || !input || !keys(input, ['admissionSourceId', 'rootSourceId', 'kind', 'cleanup', 'receiptDigest']) || input.admissionSourceId !== row.admission_source || input.rootSourceId !== row.root_source || input.kind !== 'joined-owned-native' || input.cleanup !== 'confirmed' || !digest(input.receiptDigest))
                throw Error('Exact joined original preview cleanup receipt required; no-birth settlement is unavailable');
            const sourceId = this.record(row, 'terminal', input);
            this.writer?.assertCurrent();
            this.store.run("UPDATE source_branch_previews SET state='SETTLED',terminal_source=? WHERE id=?", sourceId, previewId);
            const result = this.inspect(previewId);
            this.writer?.assertCurrent();
            return result;
        });
    }
    settleNeverEnabled(previewId: string, input: { boundary: 'joined-live' | 'former-owner-inactive'; evidence: UnopenedGateEvidence }, validate: () => void) {
        this.writer?.assertCurrent();
        return this.store.tx(() => {
            const row = this.inspect(previewId), gate = row.admission.durableGate;
            if (!this.writer || !gate || row.state !== 'UNRESOLVED' || row.root_source !== null || !this.validUnopenedEvidence(row.admission, input.boundary, input.evidence) || this.store.one('SELECT id FROM sources WHERE id=?', gate.rootReceiptId))
                throw Error('Qualified unopened durable gate required; historical uncertainty remains held');
            const witness = this.writer.assertCurrent();
            if (!samePreviewDatabaseScope(gate.writer, witness) || JSON.stringify(witness) !== JSON.stringify(input.evidence.currentWriter)) throw Error('Original durable database identity differs');
            const validation: unknown = validate();
            if (validation !== undefined) { void Promise.resolve(validation).catch(() => {}); throw Error('Durable gate validation must be synchronous'); }
            const latest = this.store.one('SELECT admission_source,root_source,state FROM source_branch_previews WHERE id=?', previewId);
            if (!latest || latest.state !== 'UNRESOLVED' || latest.admission_source !== row.admission_source || latest.root_source !== null || this.store.one('SELECT id FROM sources WHERE id=?', gate.rootReceiptId)) throw Error('Final unopened gate correspondence changed');
            if (JSON.stringify(this.inspect(previewId).admission) !== JSON.stringify(row.admission)) throw Error('Final unopened gate admission changed');
            this.writer.assertCurrent();
            const sourceId = this.record(row, 'terminal', { admissionSourceId: row.admission_source, rootSourceId: null, kind: 'durable-gate-never-enabled', protocol: durablePreviewProtocol, boundary: input.boundary, rootReceiptId: gate.rootReceiptId, clientRoot: row.admission.clientRoot, evidence: input.evidence, receiptDigest: evidenceHash(input.evidence) });
            this.writer.assertCurrent();
            this.store.run("UPDATE source_branch_previews SET state='SETTLED',terminal_source=? WHERE id=?", sourceId, previewId);
            const result = this.inspect(previewId);
            this.writer.assertCurrent();
            return result;
        });
    }
    active(options: { after?: string; limit?: number } = {}) {
        const limit = options.limit ?? 25;
        if (!keys(options, Object.keys(options).filter(key => ['after', 'limit'].includes(key))) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || options.after !== undefined && (!previewIdentity(options.after) || !this.store.one('SELECT id FROM source_branch_previews WHERE id=?', options.after)))
            throw Error('Preview ownership paging requires limit1..100 and an exact cursor');
        const rows = this.store.all("SELECT id FROM source_branch_previews INDEXED BY source_branch_preview_active_id WHERE state!='SETTLED' AND id>? ORDER BY id LIMIT ?", options.after ?? '', limit + 1);
        return { previews: rows.slice(0, limit).map(row => this.inspect(row.id)), nextCursor: rows.length > limit ? rows[limit - 1]!.id as string : null };
    }
}

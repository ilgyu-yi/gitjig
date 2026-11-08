import { captureSourceNativeProfile, type SourceNativeProfileControls } from './source-native-profile.js';
import { assertInitializedProofShape } from '../effects/native-initialized.js';
import path from 'node:path';
import { assertInitializedNativeGitProof } from '../effects/native-git.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { OwnerLease } from './ownership.js';
import type { ChangeCore } from './change-core.js';
import type { EffectsProfile, SourceSaveInputSnapshot } from './effect-types.js';
import { SourceBranchPreviews } from './source-branch-previews.js';
import { SourceBranchPreviewRuntime } from './source-branch-preview-runtime.js';
import { SourcePreviewWriter } from './source-preview-writer.js';
import { sourcePublicationReader } from './source-publication-reader.js';
import type { SourceSnapshotAnchor } from './source-snapshot-records.js';
import { resolveCapturedGitBasis, type CapturedGitBasis } from './source-save-basis.js';
import { writeSourceProposalArtifact, verifySourceProposalArtifact, type SourceProposalArtifact } from './source-proposal-artifact.js';
import { assertObservedSourcePolicy, type SourceGitRoute } from '../effects/source-policy.js';
import { inspectSourceCapture, assertSourceCaptureMetadata, sourceCaptureLimits } from '../effects/source-snapshot-projection.js';
import type { NativeGitInitializedProof, SourceBranchTarget, SourceSnapshotProjectionReceipt } from '../effects/types.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const recipeDigest = (proposalId: string, snapshot: SourceSaveInputSnapshot, basis: CapturedGitBasis, profile: EffectsProfile, route: SourceBranchTarget['environment'], destinationRef: string, proposedDeltaPaths: string[], protocol: Body['protocol'] = 'source-snapshot-proposal/v1') =>
    hash({ proposalId, snapshot, basis, profile, route, destinationRef, proposedDeltaPaths, publicationConsent: 'unconfirmed', ...(protocol === 'source-snapshot-proposal/v2' ? { proposalProtocol: protocol } : {}) });
const brief = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 2048);
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id);
const exact = (v: unknown, fields: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === fields.sort().join();
const boundedHeader = (v: unknown) => Buffer.byteLength(JSON.stringify(v)) <= 16384;
interface BodyFacts {
    proposalId: string; publicationConsent: 'unconfirmed';
    input: SourceSaveInputSnapshot; basis: CapturedGitBasis; target: SourceBranchTarget; profile: EffectsProfile;
    proposedDeltaPaths: string[]; admissionSourceId: string; rootSourceId: string;
    projection: SourceSnapshotProjectionReceipt;
}
type Body = BodyFacts & ({ protocol: 'source-snapshot-proposal/v1' } | { protocol: 'source-snapshot-proposal/v2'; initialized: NativeGitInitializedProof });
interface HeaderFacts {
    proposalId: string; status: 'prepared'; publicationConsent: 'unconfirmed';
    workId: string; sourceId: string; scopeDigest: string; evidenceFingerprint: string;
    previewId: string; admissionSourceId: string; rootSourceId: string; terminalSourceId: string;
    operationId: string; previewDigest: string; artifact: SourceProposalArtifact; destinationRef: string;
}
type Header = HeaderFacts & ({ protocol: 'source-snapshot-proposal/v1' } | { protocol: 'source-snapshot-proposal/v2'; initializedDigest: string });
export interface SourceSnapshotProposalReview {
    nativeProfile: EffectsProfile;
    sourceRoot: string; projectId: string;
    initializedCustody: 'recorded' | 'legacy-unbound';
    proposalId: string; workId: string; previewId: string; artifact: SourceProposalArtifact;
    publicationConsent: 'unconfirmed'; destinationRef: string; basisCommit: string; projectedCommit: string;
    currentness: 'current' | 'held'; reason?: string;
    productCount: number; wholeFileAdditionCount: number; omissionCount: number;
    nativeFacts: 'historical-observation; later action requires fresh native policy/ref checks';
}
interface Host {
    store: Store; home: string; owner: OwnerLease; changes: ChangeCore; previews: SourceBranchPreviewRuntime;
    route: SourceGitRoute; profile(input?: EffectsProfile): Promise<EffectsProfile>; profileRecipe(): unknown; assertOpen(): void;
}
/** Private preparation/custody only. This core has no effect allocation, grant or source-write method. */
export class SourceSnapshotProposals {
    private readonly shutdown = new AbortController();
    private readonly tails = new Set<Promise<unknown>>();
    private readonly writer: SourcePreviewWriter;
    private readonly registry: SourceBranchPreviews;
    constructor(private readonly h: Host) {
        this.writer = new SourcePreviewWriter(h.store, h.home, h.owner);
        this.registry = new SourceBranchPreviews(h.store, h.home);
    }
    private open() { this.h.assertOpen(); this.shutdown.signal.throwIfAborted(); this.h.owner.assertCurrent(); this.h.previews.assertCurrentWriter(); }
    private track<T>(task: () => Promise<T>): Promise<T> {
        this.open(); const pending = Promise.resolve().then(task); this.tails.add(pending);
        void pending.then(() => this.tails.delete(pending), () => this.tails.delete(pending)); return pending;
    }
    private profileScope(controls: SourceNativeProfileControls) {
        const selected = captureSourceNativeProfile(controls), explicit = Object.hasOwn(selected, 'profile');
        const recipe = explicit ? undefined : hash(this.h.profileRecipe());
        return {
            resolve: () => this.h.profile(selected.profile),
            check: () => { if (!explicit && hash(this.h.profileRecipe()) !== recipe) throw Error('Selected source native profile recipe changed'); },
        };
    }
    prepare(input: { workId: string; destinationBranch: string }, controls: SourceNativeProfileControls & { signal?: AbortSignal; validate?: () => void } = {}) {
        const request = structuredClone(input), validate = controls.validate;
        const profileScope = this.profileScope(controls);
        const signal = AbortSignal.any([this.shutdown.signal, ...controls.signal ? [controls.signal] : []]);
        return this.track(async () => {
            let previewId: string | undefined;
            const check = () => {
                if (validate) { const result: unknown = validate(); if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('Source proposal guard must be synchronous without a return value'); } }
                signal.throwIfAborted(); this.open(); this.writer.assertCurrent();
                profileScope.check();
            };
            try {
                this.writer.prepare(); check();
                if (Object.keys(request).some(k => !['workId', 'destinationBranch'].includes(k)) || typeof request.workId !== 'string' || !request.workId || Buffer.byteLength(request.workId) > 128 || /[\x00-\x1f\x7f]/u.test(request.workId) || typeof request.destinationBranch !== 'string' ||
                    Buffer.byteLength(request.destinationBranch) > 1000 || !request.destinationBranch || /[\x00-\x20\x7f~^:?*\[\\]/u.test(request.destinationBranch) || request.destinationBranch.includes('..') || request.destinationBranch.includes('@{') ||
                    request.destinationBranch.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.') || p.endsWith('.lock')))
                    throw Error('Choose one bounded literal new branch name');
                if (this.h.route.kind !== 'available') throw Error('Original operator Git route unavailable; reopen from a supported operator environment');
                const route = this.h.route.environment;
                const snapshot = await this.h.changes.captureSourceSaveInput(request.workId); check();
                const profile = Object.freeze(await profileScope.resolve()); check();
                const current = () => { check(); this.h.changes.assertSourceSaveInput(snapshot); };
                const basis = await resolveCapturedGitBasis(snapshot.base, undefined, signal); current();
                const before = new Map(snapshot.base.manifest.files.map(f => [f.path, f])), after = new Map(snapshot.candidate.manifest.files.map(f => [f.path, f]));
                const proposedDeltaPaths = [...new Set([...before.keys(), ...after.keys()])].filter(name => name !== '.git' && !name.startsWith('.git/') &&
                    (before.get(name)?.sha256 !== after.get(name)?.sha256 || before.get(name)?.effectiveMode !== after.get(name)?.effectiveMode)).sort();
                const proposalId = randomUUID();
                const inputDigest = recipeDigest(proposalId, snapshot, basis, profile, route, 'refs/heads/' + request.destinationBranch, proposedDeltaPaths, 'source-snapshot-proposal/v2');
                const prepared = await this.h.previews.run({ workId: snapshot.workId, sourceId: snapshot.sourceId, epoch: snapshot.evidence.epoch, generation: snapshot.evidence.generation,
                    inputDigest, profile: { ...profile, objectFormat: basis.objectFormat }, validate: current, signal }, async (tools, nativeSignal) => {
                    const target = await tools.observeSourceBranchTarget({ targetId: 'source-proposal', path: snapshot.projectRoot, destinationRef: 'refs/heads/' + request.destinationBranch }, route);
                    current(); await tools.fetchSourceBasis(target, basis.commit); current();
                    const result = await tools.projectSourceSnapshot({ base: snapshot.base, candidate: snapshot.candidate, basisCommit: basis.commit, authorizedDeltaPaths: proposedDeltaPaths });
                    current();
                    if (result.kind !== 'projected' || result.receipt.relation.kind !== 'identical') return { kind: 'held' as const, reason: result.kind === 'projected' ? 'Projected execution view differs; derived qualification required' : result.reason };
                    const receipt = result.receipt; previewId = receipt.previewId;
                    const row = this.registry.inspect(previewId);
                    if (!row.root_source || !row.root || !('protocol' in row.root) || !('gitBinary' in row.root) || row.root.gitBinary !== profile.gitBinary) throw Error('Original initialized preview root unavailable');
                    const initialized = tools.initializedProof(); current();
                    const body: Body = { protocol: 'source-snapshot-proposal/v2', initialized, proposalId, publicationConsent: 'unconfirmed', input: snapshot, basis, target, profile,
                        proposedDeltaPaths, admissionSourceId: row.admission_source, rootSourceId: row.root_source, projection: receipt };
                    const guard = () => { nativeSignal.throwIfAborted(); current(); assertObservedSourcePolicy(target); assertInitializedNativeGitProof(initialized, { clientRoot: row.admission.clientRoot, gitBinary: profile.gitBinary, objectFormat: basis.objectFormat }); };
                    const artifact = await writeSourceProposalArtifact(this.h.home, body, guard); guard();
                    return { kind: 'prepared' as const, artifact, body };
                }, id => { previewId = id; });
                previewId = prepared.previewId; current();
                if (prepared.value.kind === 'held') return { kind: 'held' as const, workId: snapshot.workId, previewId, reason: prepared.value.reason, nextAction: 'Inspect original work/preview; no usable proposal or publication permission was created' };
                const { artifact, body } = prepared.value, row = this.registry.inspect(previewId);
                const header: Header = { protocol: 'source-snapshot-proposal/v2', initializedDigest: hash(body.initialized), proposalId, status: 'prepared', publicationConsent: 'unconfirmed', workId: snapshot.workId, sourceId: snapshot.sourceId,
                    scopeDigest: snapshot.scopeDigest, evidenceFingerprint: snapshot.evidence.fingerprint, previewId, admissionSourceId: body.admissionSourceId,
                    rootSourceId: body.rootSourceId, terminalSourceId: row.terminal_source!, operationId: body.projection.operationId, previewDigest: hash(row), artifact, destinationRef: body.target.destinationRef };
                const artifactProof = await verifySourceProposalArtifact(this.h.home, artifact, current); current();
                // Original native validation precedes artifact IO; verify the complete captures again after that boundary.
                const baseProof = await inspectSourceCapture(snapshot.base, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal); current();
                const candidateProof = await inspectSourceCapture(snapshot.candidate, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal); current();
                this.correspondence(header, body); if (!boundedHeader(header)) throw Error('Source proposal header exceeds 16 KiB');
                this.h.store.tx(() => {
                    current(); this.initializedCurrent(body); artifactProof.assertCurrentMetadata(); assertSourceCaptureMetadata(baseProof); assertSourceCaptureMetadata(candidateProof); assertObservedSourcePolicy(body.target); this.correspondence(header, body);
                    this.h.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', proposalId, snapshot.workId, 'source-snapshot-proposal', snapshot.candidate.versionId,
                        path.join(this.h.home, 'artifacts/source-snapshot-proposals', artifact.hash + '.json'), artifact.hash, JSON.stringify(header));
                    this.writer.assertCurrent(); this.h.changes.assertSourceSaveInput(snapshot); signal.throwIfAborted(); this.h.assertOpen();
                });
                return { kind: 'prepared' as const, workId: snapshot.workId, previewId, proposalId, review: this.review(proposalId, header, body, 'current') };
            } catch (error) {
                return { kind: 'held' as const, workId: request.workId, ...(previewId ? { previewId } : {}), reason: brief(error), nextAction: 'Inspect the original work and preview; no publication consent or branch write occurred' };
            }
        });
    }
    private correspondence(header: Header, body: Body) {
        if (!exact(header, ['protocol','proposalId','status','publicationConsent','workId','sourceId','scopeDigest','evidenceFingerprint','previewId','admissionSourceId','rootSourceId','terminalSourceId','operationId','previewDigest','artifact','destinationRef', ...(header?.protocol === 'source-snapshot-proposal/v2' ? ['initializedDigest'] : [])]) ||
            !exact(body, ['protocol','proposalId','publicationConsent','input','basis','target','profile','proposedDeltaPaths','admissionSourceId','rootSourceId','projection', ...(header?.protocol === 'source-snapshot-proposal/v2' ? ['initialized'] : [])]) || !exact(header.artifact, ['hash','bytes']) || !['source-snapshot-proposal/v1','source-snapshot-proposal/v2'].includes(header.protocol) || body.protocol !== header.protocol || header.status !== 'prepared' || header.publicationConsent !== 'unconfirmed' || body.publicationConsent !== 'unconfirmed' ||
            !uuid(header.proposalId) || body.proposalId !== header.proposalId || !uuid(header.previewId) || header.operationId !== 'source-preview-' + header.previewId || body.projection.protocol !== 'source-context-projection/v2' || body.projection.publicationBaselineProfile !== 'k-absent-whole-file/v1' || body.projection.relation.kind !== 'identical' ||
            body.projection.previewId !== header.previewId || body.projection.operationId !== header.operationId || body.projection.basisCommit !== body.basis.commit || header.workId !== body.input.workId || header.sourceId !== body.input.sourceId ||
            header.scopeDigest !== body.input.scopeDigest || header.evidenceFingerprint !== body.input.evidence.fingerprint || body.target.canonicalPath !== body.input.projectRoot || header.destinationRef !== body.target.destinationRef ||
            body.target.kind !== 'source-new-branch' || body.target.targetId !== 'source-proposal' || body.target.gitDirectory !== path.join(body.input.projectRoot, '.git') || body.target.commonDirectory !== body.target.gitDirectory || body.target.objectFormat !== body.basis.objectFormat || body.projection.objectFormat !== body.basis.objectFormat || body.input.base.versionId !== body.basis.baseVersionId || body.input.base.digest !== body.basis.baseDigest)
            throw Error('Original proposal body/header correspondence unavailable');
        const expectedInput = recipeDigest(body.proposalId, body.input, body.basis, body.profile, body.target.environment, body.target.destinationRef, body.proposedDeltaPaths, body.protocol);
        if (expectedInput !== body.projection.sourceInputDigest || body.projection.sourceDigests.base !== body.input.base.digest || body.projection.sourceDigests.candidate !== body.input.candidate.digest ||
            body.projection.sourceVersions.base !== body.input.base.versionId || body.projection.sourceVersions.candidate !== body.input.candidate.versionId || body.projection.manifestDigests.base !== body.input.base.manifest.digest || body.projection.manifestDigests.candidate !== body.input.candidate.manifest.digest ||
            body.input.evidence.candidateDigest !== body.input.candidate.digest || body.input.evidence.versions.base !== body.input.base.versionId || body.input.evidence.versions.candidate !== body.input.candidate.versionId) throw Error('Original proposal input digest differs');
        const row = this.registry.inspect(header.previewId);
        if (hash(row) !== header.previewDigest) throw Error('Original proposal preview sources changed');
        if (row.work !== header.workId || row.state !== 'SETTLED' || !row.root || !('protocol' in row.root) || row.admission_source !== header.admissionSourceId || row.root_source !== header.rootSourceId || row.terminal_source !== header.terminalSourceId ||
            row.terminal?.kind !== 'joined-owned-native' || row.terminal.cleanup !== 'confirmed' || row.admission.inputDigest !== body.projection.sourceInputDigest || row.admission.sourceId !== header.sourceId ||
            row.admission.profileDigest !== hash({ ...body.profile, objectFormat: body.basis.objectFormat }) || row.admission.epoch !== body.input.evidence.epoch || row.admission.generation !== body.input.evidence.generation || !('gitBinary' in row.root) || row.root.gitBinary !== body.profile.gitBinary || body.admissionSourceId !== header.admissionSourceId || body.rootSourceId !== header.rootSourceId)
            throw Error('Original proposal rooted cleanup correspondence unavailable');
        if (body.protocol === 'source-snapshot-proposal/v2' && header.protocol === 'source-snapshot-proposal/v2') {
            const { admissionSourceId: _, ...namespace } = row.root;
            const repo = body.target.identity.find(f => f.path === path.join(row.admission.clientRoot, 'client.git')), config = body.target.identity.find(f => f.path === path.join(row.admission.clientRoot, 'client.git/config'));
            const binary = body.target.identity.find(f => f.path === body.profile.gitBinary), proof = body.initialized;
            assertInitializedProofShape(proof, { clientRoot: row.admission.clientRoot, gitBinary: body.profile.gitBinary, objectFormat: body.basis.objectFormat });
            if (!proof || proof.protocol !== 'owned-native-git-initialized/v1' || hash(proof) !== header.initializedDigest || hash(proof.namespace) !== hash(namespace) ||
                proof.owner.gitBinary !== body.profile.gitBinary || proof.owner.objectFormat !== body.basis.objectFormat || proof.owner.root !== row.admission.clientRoot ||
                repo?.kind !== 'directory' || repo.device !== proof.owner.repoDevice || repo.inode !== proof.owner.repoInode || config?.kind !== 'file' || config.sha256 !== proof.owner.configHash ||
                binary?.kind !== 'file' || binary.device !== proof.owner.binaryDevice || binary.inode !== proof.owner.binaryInode) throw Error('Original initialized proposal proof differs');
        }
    }
    private initializedCurrent(body: Body) {
        if (body.protocol === 'source-snapshot-proposal/v2') {
            const row = this.registry.inspect(body.projection.previewId);
            assertInitializedNativeGitProof(body.initialized, { clientRoot: row.admission.clientRoot, gitBinary: body.profile.gitBinary, objectFormat: body.basis.objectFormat });
        }
    }
    private review(id: string, h: Header, b: Body, currentness: 'current' | 'held', reason?: string): SourceSnapshotProposalReview {
        return { sourceRoot: b.input.projectRoot, projectId: b.input.projectId, nativeProfile: structuredClone(b.profile), initializedCustody: b.protocol === 'source-snapshot-proposal/v2' ? 'recorded' : 'legacy-unbound', proposalId: id, workId: h.workId, previewId: h.previewId, artifact: { ...h.artifact }, publicationConsent: 'unconfirmed', destinationRef: h.destinationRef,
            basisCommit: b.basis.commit, projectedCommit: b.projection.projectedCommit, currentness, ...(reason ? { reason } : {}), productCount: b.projection.product.length,
            wholeFileAdditionCount: b.projection.wholeFileAdditions.length, omissionCount: b.projection.effectiveDifferences.length,
            nativeFacts: 'historical-observation; later action requires fresh native policy/ref checks' };
    }
    private workOperand(workId: string) {
        if (typeof workId !== 'string' || !workId || Buffer.byteLength(workId) > 128 || /[\x00-\x1f\x7f]/u.test(workId)) throw Error('Exact bounded original work required');
    }
    private versionRow(workId: string, proposalId: string) {
        return this.h.store.one("SELECT * FROM change_versions WHERE id=? AND work=? AND kind='source-snapshot-proposal' AND typeof(data)='text' AND length(CAST(data AS BLOB))<=16384 AND typeof(hash)='text' AND length(CAST(hash AS BLOB))=64 AND typeof(artifact)='text' AND length(CAST(artifact AS BLOB))<=4096 AND typeof(predecessor)='text' AND length(CAST(predecessor AS BLOB)) BETWEEN 1 AND 128", proposalId, workId);
    }
    private async original(input: { workId: string; proposalId: string }, check: () => void) {
        this.workOperand(input.workId); if (!uuid(input.proposalId)) throw Error('Exact original proposal ID required');
        check(); const row = this.versionRow(input.workId, input.proposalId);
        if (!row) throw Error('Original scoped proposal unavailable');
        const header = JSON.parse(row.data) as Header;
        if (!boundedHeader(header) || !/^[a-f0-9]{64}$/u.test(row.hash) || row.id !== header.proposalId || row.hash !== header.artifact?.hash || row.artifact !== path.join(this.h.home, 'artifacts/source-snapshot-proposals', row.hash + '.json') || header.workId !== input.workId)
            throw Error('Original proposal version reference unavailable');
        const artifactProof = await verifySourceProposalArtifact(this.h.home, header.artifact, check), body = artifactProof.body as Body;
        check(); this.correspondence(header, body);
        if (row.predecessor !== body.input.candidate.versionId) throw Error('Original proposal candidate predecessor differs');
        const assertOriginal = () => {
            check();
            if (JSON.stringify(this.versionRow(input.workId, row.id)) !== JSON.stringify(row)) throw Error('Original proposal row changed during inspection');
            artifactProof.assertCurrentMetadata();
            if (hash(this.registry.inspect(header.previewId)) !== header.previewDigest) throw Error('Original proposal preview sources changed');
        };
        assertOriginal(); return { row, header, body, assertOriginal };
    }
    openPublication(input: { workId: string; proposalId: string; expectedArtifactHash: string }, controls: { signal?: AbortSignal } = {}) {
        const captured = structuredClone(input);
        const signal = AbortSignal.any([this.shutdown.signal, ...controls.signal ? [controls.signal] : []]);
        return this.track(async () => {
            const check = () => { signal.throwIfAborted(); this.open(); };
            if (!exact(captured, ['workId', 'proposalId', 'expectedArtifactHash']) || !/^[a-f0-9]{64}$/u.test(captured.expectedArtifactHash)) throw Error('Exact original publication artifact required');
            const { row, header, body, assertOriginal } = await this.original(captured, check);
            if (header.artifact.hash !== captured.expectedArtifactHash) throw Error('Reviewed publication artifact differs; reopen original proposal');
            // Historical standing can be held, but every disclosed byte still
            // requires complete original capture verification independent of it.
            const base = await inspectSourceCapture(body.input.base, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
            const candidate = await inspectSourceCapture(body.input.candidate, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
            assertSourceCaptureMetadata(base); assertSourceCaptureMetadata(candidate); assertOriginal();
            let reason: string | undefined;
            try { this.h.changes.assertSourceSaveInput(body.input); assertObservedSourcePolicy(body.target); this.initializedCurrent(body); } catch (e) { reason = brief(e); }
            assertOriginal();
            const reader = sourcePublicationReader({ candidate, projection: body.projection, signal,
                assertCurrent: assertOriginal, track: task => this.track(task) });
            return Object.freeze({ review: this.review(row.id, header, body, reason ? 'held' : 'current', reason), ...reader });
        });
    }
    /** Internal owner-action input. A publication read scope never supplies this proof. */
    captureActionProposal(input: { workId: string; proposalId: string }, signal: AbortSignal, controls: SourceNativeProfileControls = {}) {
        const captured = structuredClone(input);
        const profileScope = this.profileScope(controls);
        return this.track(async () => {
            const check = () => { signal.throwIfAborted(); this.open(); profileScope.check(); };
            if (!exact(captured, ['workId', 'proposalId'])) throw Error('Exact original action proposal required');
            const { row, header, body, assertOriginal } = await this.original(captured, check);
            if (body.protocol !== 'source-snapshot-proposal/v2' || header.protocol !== body.protocol) throw Error('Original initialized custody is unbound; inspect the historical proposal');
            const selected = await this.h.changes.captureSourceSaveInput(captured.workId); assertOriginal();
            if (hash(selected) !== hash(body.input)) throw Error('Reviewed source proposal no longer matches normal current standing');
            const profile = await profileScope.resolve(); assertOriginal();
            if (hash(profile) !== hash(body.profile) || this.h.route.kind !== 'available' || hash(this.h.route.environment) !== hash(body.target.environment)) throw Error('Original trusted native profile or operator route changed');
            const base = await inspectSourceCapture(body.input.base, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
            const candidate = await inspectSourceCapture(body.input.candidate, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
            const anchor=this.actionAnchor(row,header,body,selected);
            const fingerprint = hash(anchor);
            const native = { profile: structuredClone(body.profile), initialized: structuredClone(body.initialized),
                input: { operationId: anchor.operationId, target: structuredClone(body.target), integrationCommit: anchor.projectedCommit,
                    expectedSnapshot: { tree: anchor.projectedTree, basisCommit: anchor.basisCommit } } };
            const nativeDigest = hash(native);
            const assertScope = () => {
                assertOriginal();
                this.h.changes.assertSourceSaveInput(selected);
                if (hash(anchor) !== fingerprint || hash(native) !== nativeDigest) throw Error('Detached action proposal facts changed');
            };
            const assertCurrent = () => {
                assertScope(); assertObservedSourcePolicy(body.target); this.initializedCurrent(body);
                assertSourceCaptureMetadata(base); assertSourceCaptureMetadata(candidate);
            };
            assertCurrent(); return { anchor, native, assertCurrent, assertScope };
        });
    }
    private actionAnchor(row:Record<string,any>,header:Header & {protocol:'source-snapshot-proposal/v2'},body:Body & {protocol:'source-snapshot-proposal/v2'},selected:SourceSaveInputSnapshot){
        const directory = body.target.identity.find(e => e.path === body.target.commonDirectory && e.kind === 'directory');
        if (!directory?.device || !directory.inode) throw Error('Original common Git directory identity unavailable');
        const anchor: SourceSnapshotAnchor = {
            workId: selected.workId, projectId: selected.projectId, projectRoot: selected.projectRoot, sourceId: selected.sourceId,
            epoch: selected.evidence.epoch, generation: selected.evidence.generation, evidenceFingerprint: selected.evidence.fingerprint,
            scopeDigest: selected.scopeDigest, baseVersion: selected.base.versionId, candidateVersion: selected.candidate.versionId,
            proposalId: row.id, previewId: header.previewId, artifact: { ...header.artifact }, versionDigest: hash(row), initializedDigest: header.initializedDigest,
            operationId: body.projection.operationId, basisCommit: body.basis.commit, projectedCommit: body.projection.projectedCommit, projectedTree: body.projection.projectedTree,
            publicationBaselineProfile: body.projection.publicationBaselineProfile, objectFormat: body.basis.objectFormat,
            commonDirectory: body.target.commonDirectory, device: directory.device, inode: directory.inode, destinationRef: body.target.destinationRef,
            policyFingerprint: body.target.policyFingerprint, profileDigest: hash(body.profile), routeDigest: hash(body.target.environment),
        };
        return anchor;
    }
    /** Historical native read input; no current candidate standing or S/C IO. */
    captureReadProposal(input:{workId:string;proposalId:string},binding:SourceSnapshotAnchor,signal:AbortSignal,controls:SourceNativeProfileControls={}){
        const captured=structuredClone(input),expected=structuredClone(binding),profileScope=this.profileScope(controls);
        return this.track(async()=>{
            const check=()=>{signal.throwIfAborted();this.open();profileScope.check();};
            const {row,header,body,assertOriginal}=await this.original(captured,check);
            if(body.protocol!=='source-snapshot-proposal/v2'||header.protocol!==body.protocol)throw Error('Original initialized source read custody unavailable');
            const anchor=this.actionAnchor(row,header,body,body.input);
            if(hash(anchor)!==hash(expected))throw Error('Original source read artifact/binding differs');
            const current=await profileScope.resolve();assertOriginal();
            if(current.gitBinary!==body.initialized.owner.gitBinary||this.h.route.kind!=='available'||hash(this.h.route.environment)!==anchor.routeDigest)throw Error('Original source read binary/operator route unavailable');
            const native={profile:{...current,maxOutputBytes:Math.min(current.maxOutputBytes??16384,16384)},initialized:structuredClone(body.initialized),
                input:{operationId:anchor.operationId,target:structuredClone(body.target),integrationCommit:anchor.projectedCommit,expectedSnapshot:{tree:anchor.projectedTree,basisCommit:anchor.basisCommit}}};
            const digest=hash({anchor,native});
            const assertScope=()=>{assertOriginal();this.initializedCurrent(body);if(hash({anchor,native})!==digest||this.h.route.kind!=='available'||hash(this.h.route.environment)!==anchor.routeDigest)throw Error('Original source read proof changed');};
            assertScope();return {anchor,native,assertScope,assertCurrent:assertScope};
        });
    }
    /** Original bytes for normal semantic recovery; grants no UNKNOWN standing exemption. */
    recoveryInput(input: { workId: string; proposalId: string }) {
        const captured = structuredClone(input);
        return this.track(async () => {
            const { body, assertOriginal } = await this.original(captured, () => this.open());
            if (body.protocol !== 'source-snapshot-proposal/v2') throw Error('Original source recovery custody unavailable');
            assertOriginal();
            return { input: structuredClone(body.input), assertOriginal };
        });
    }
    inspect(input: { workId: string; proposalId: string }, controls: { signal?: AbortSignal } = {}) {
        const signal = AbortSignal.any([this.shutdown.signal, ...controls.signal ? [controls.signal] : []]);
        const captured = structuredClone(input); this.workOperand(captured.workId); if (!uuid(captured.proposalId)) throw Error('Exact original proposal ID required');
        return this.track(async () => {
            const check = () => { signal.throwIfAborted(); this.open(); }; check();
            const { row, header, body, assertOriginal } = await this.original(captured, check);
            let reason: string | undefined;
            try {
                this.h.changes.assertSourceSaveInput(body.input); assertObservedSourcePolicy(body.target); this.initializedCurrent(body);
                const baseProof = await inspectSourceCapture(body.input.base, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
                const candidateProof = await inspectSourceCapture(body.input.candidate, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxBytes, signal);
                assertSourceCaptureMetadata(baseProof); assertSourceCaptureMetadata(candidateProof);
                this.h.changes.assertSourceSaveInput(body.input); assertObservedSourcePolicy(body.target); this.initializedCurrent(body);
            } catch (e) { reason = brief(e); }
            assertOriginal(); this.correspondence(header, body);
            return this.review(row.id, header, body, reason ? 'held' : 'current', reason);
        });
    }
    list(input: { workId: string; after?: string; limit?: number }) {
        this.open(); this.workOperand(input.workId); const limit = input.limit ?? 25;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || input.after !== undefined && !uuid(input.after)) throw Error('Bounded exact proposal cursor required');
        const cursor = input.after && this.h.store.one("SELECT rowid FROM change_versions WHERE id=? AND work=? AND kind='source-snapshot-proposal'", input.after, input.workId);
        if (input.after && !cursor) throw Error('Original scoped proposal cursor unavailable');
        const rows = this.h.store.all("SELECT CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))<=128 THEN id ELSE NULL END AS id,rowid,length(CAST(data AS BLOB)) AS bytes FROM change_versions WHERE work=? AND kind='source-snapshot-proposal' AND rowid>? ORDER BY rowid LIMIT ?", input.workId, cursor?.rowid ?? 0, limit + 1);
        for (const row of rows) if (!uuid(row.id)) throw Error('Retained proposal at rowid ' + row.rowid + ' has unavailable bounded identity');
        return { proposals: rows.slice(0, limit).map(r => ({ proposalId: r.id as string, metadata: r.bytes <= 16384 ? 'retained' as const : 'unavailable' as const })), nextCursor: rows.length > limit ? rows[limit - 1]!.id as string : null };
    }
    quiesce() { this.shutdown.abort(Error('Source proposal host closing')); }
    async close() { this.quiesce(); await Promise.allSettled([...this.tails]); }
}

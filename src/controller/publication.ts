import { softwareEvidenceIdentity } from './effect-types.js';
import { cancelledCapacitySettlement } from './capacity-settlement.js';
import { assertOwnerRootActivated, ownerRootActivation } from './owner-activation.js';
import { retainedPublication, listRetainedPublications } from './publication-registry.js';
import { assertOrdinaryEffectSource } from './application-model.js';
import { createdAcceptanceSession, type CreatedAcceptanceContext } from '../platform/hosted-context.js';
import { settleRecoveredEffectAssignment } from './effect-assignment-settlement.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { hash } from './change-files.js';
import { contextWorkContinuation, contextAuthoritySnapshot } from './context-origin.js';
import { loadCriteriaSync } from './criteria.js';
import type { NativeIdentity } from './interaction-types.js';
import type { ChangeOperation } from './change-types.js';
import type { InputBundle } from '../workflow/types.js';
import type { EffectHost } from './effects.js';
import type { RegisterPublicationTarget, DelegatePublication, PrepareOwnerPublication, PublicationView, PublicationCredential, PublicationActionClass, PublicationDelegationConfig } from './publication-types.js';
import type { PublicationAction, PublicationInput } from '../platform/github-publication.js';
import { sealPublicationPayload, validatePublicationTargetPolicy } from '../platform/github-publication.js';
import { openPublicationSession, createOwnedPublicationSession, createOwnedPublicOwnerPublicationSession, type PublicationSession } from '../platform/github-publication-session.js';
const parse = (value: string) => JSON.parse(value);
const actionClass = (a: PublicationAction): PublicationActionClass => a.kind === 'create-comment' ? `create-comment:${a.purpose}` : a.kind;
const classes = new Set<PublicationActionClass>(['create-issue', 'create-draft-pr', 'create-comment:bootstrap', 'create-comment:reviewed-summary', 'create-comment:contribution-summary']);
type ReconciliationCaller = {
    runId: string;
    capacityId: string;
    assert(): void;
};
const defaultPolicy = { version: 'publication-carrier/v1', allowedMentions: [], knownPrivateLiterals: [], maxTitleBytes: 1024, maxBodyBytes: 128 * 1024 };
/** Same controller/Store/operation ledger; this helper owns no scheduler or separate authority DB. */
export class Publications {
    private session: PublicationSession | undefined;
    private configuredDelegations: readonly PublicationDelegationConfig[] = [];
    private rootAdmissionStarted = false;
    configureDelegations(configs: readonly PublicationDelegationConfig[]) {
        this.h.assertOpen();
        if (this.rootAdmissionStarted)
            throw Error('Publication delegation configuration must precede owner-root admission');
        const captured = structuredClone(configs);
        if (!Array.isArray(captured) || captured.length > 100 || new Set(captured.map(c => c.targetId)).size !== captured.length)
            throw Error('Finite distinct publication target configuration required');
        for (const c of captured) {
            this.target(c.targetId);
            if (!Array.isArray(c.actions) || !c.actions.length || new Set(c.actions).size !== c.actions.length || c.actions.some((a: PublicationActionClass) => !classes.has(a)) || !Number.isSafeInteger(c.operationLimit) || c.operationLimit < 1 || c.operationLimit > 100 || c.projectIds?.some((p: string | null) => p !== null && !this.s.one('SELECT id FROM projects WHERE id=?', p)))
                throw Error('Invalid original-root publication delegation profile');
        }
        this.configuredDelegations = Object.freeze(captured.map(c => Object.freeze({ ...c, actions: Object.freeze([...c.actions]), ...(c.projectIds ? { projectIds: Object.freeze([...c.projectIds]) } : {}) })));
        return { configuredTargets: captured.length, activation: 'disabled' as const };
    }
    ownerRootProfile(): readonly PublicationDelegationConfig[] { return structuredClone(this.configuredDelegations); }
    activateOwnerRoot(workId: string, insideAtomicActivation = false) {
        this.h.assertOpen();
        if (contextWorkContinuation(this.s, workId))
            return;
        const w = this.work(workId), data = parse(w.data), source = this.s.one('SELECT origin FROM sources WHERE id=?', w.source);
        if (ownerRootActivation(data)?.state === 'PENDING' && !insideAtomicActivation)
            throw Error('Use the atomic original owner activation entry');
        if (!parse(source.origin).kind.startsWith('owner-') || data.publicationDelegationCaptured)
            return;
        this.rootAdmissionStarted = true;
        for (const config of this.configuredDelegations)
            this.delegateInner({ ...config, workId, scope: 'delegation-lineage' });
        this.s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...data, publicationDelegationCaptured: true, publicationDelegationProfile: hash(this.configuredDelegations) }), workId);
    }
    private tasks = new Set<Promise<unknown>>();
    private aborts = new Map<string, AbortController>();
    constructor(private h: EffectHost, private ancestry: (work: string) => string[], private inheritSources: (op: any) => void) { }
    private get s() { return this.h.store; }
    configure(input: PublicationCredential) { this.h.assertOpen(); this.session = openPublicationSession(structuredClone(input)); return { credentialSessionId: this.session.credentialSessionId, activation: this.session.activation }; }
    // Used only by the internal owned-fixture helper, never by CLI/model configuration.
    configureOwned(input: PublicationCredential & {
        origin: string;
    }) { this.h.assertOpen(); this.session = createOwnedPublicationSession(structuredClone(input)); return { credentialSessionId: this.session.credentialSessionId, activation: this.session.activation }; }
    configureOwnedPublicOwner(input: PublicationCredential & {
        origin: string;
    }) { this.h.assertOpen(); this.session = createOwnedPublicOwnerPublicationSession(structuredClone(input)); return { credentialSessionId: this.session.credentialSessionId, activation: this.session.activation }; }
    configureCreatedAcceptance(context: CreatedAcceptanceContext) { this.h.assertOpen(); this.session = createdAcceptanceSession(context); return { credentialSessionId: this.session.credentialSessionId, activation: this.session.activation }; }
    private target(id: string) {
        const row = this.s.one('SELECT * FROM effect_targets WHERE id=?', id);
        if (!row || parse(row.data).kind !== 'github-publication')
            throw Error('Registered finite publication target required');
        return { ...row, data: parse(row.data) };
    }
    private work(id: string) {
        const row = this.s.one('SELECT * FROM works WHERE id=?', id);
        if (!row)
            throw Error('Retained publication work required');
        return row;
    }
    private op(id: string) {
        const row = this.s.one('SELECT * FROM effect_operations WHERE id=?', id);
        if (!row || parse(row.data).kind !== 'publication')
            throw Error('Publication operation required');
        return { ...row, data: parse(row.data) };
    }
    private receipt(id: string, kind: string, data: unknown) { const rid = randomUUID(); this.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', rid, id, kind, JSON.stringify(data)); return rid; }
    private patch(id: string, phase: PublicationView['phase'], data: Record<string, unknown>) { const op = this.op(id); this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', phase, JSON.stringify({ ...op.data, ...data }), id); return this.inspectInternal(id); }
    private descriptor(action: PublicationAction) { return { version: 'publication-actions/v1', action: actionClass(action), criteriaHash: loadCriteriaSync().hash, prerequisites: ['retained-current-source-and-explicit-action-scope', 'exact-owner-bytes-or-fresh-independent-payload-judgment', 'current-owner-grant-and-native-same-credential-account-action-observation', 'sealed-final-carrier-bytes-and-explicit-payload-scope', ...(action.kind === 'create-comment' && action.purpose === 'reviewed-summary' ? ['sole-current-software-evidence-and-host-assembled-summary'] : action.kind === 'create-comment' && action.purpose === 'contribution-summary' ? ['current-complete-host-catalogue-snapshot-and-exact-native-resource'] : action.kind === 'create-draft-pr' ? ['native-exact-head-base-identity-and-explicit-unreviewed-draft-status'] : ['explicit-unreviewed-bootstrap-status'])] }; }
    private sourceFingerprint(work: string) { const w = this.work(work); return hash({ source: w.source, epoch: w.epoch, generation: w.generation, requirements: this.s.all('SELECT * FROM requirements WHERE work=? ORDER BY version', work), directions: this.h.interactions.impacts(work), ...this.contextToken(work) }); }
    register(input: RegisterPublicationTarget) {
        this.h.assertOpen();
        const captured = structuredClone(input), project = captured.projectId ?? null;
        if (project !== null && !this.s.one('SELECT id FROM projects WHERE id=?', project))
            throw Error('Registered project required');
        if (!['public', 'private'].includes(captured.visibility))
            throw Error('Publication visibility required');
        const policy = captured.carrierPolicy ?? defaultPolicy;
        validatePublicationTargetPolicy(captured.target, policy);
        const id = randomUUID();
        this.s.run('INSERT INTO effect_targets VALUES(?,?,?)', id, project, JSON.stringify({ kind: 'github-publication', target: captured.target, visibility: captured.visibility, carrierPolicy: policy }));
        return { targetId: id, projectId: project, activation: 'disabled' as const };
    }
    listTargets() {
        this.h.assertOpen();
        const where = "CASE WHEN json_valid(data) THEN COALESCE(json_extract(data,'$.kind') NOT IN ('github-configuration','native-repository-configuration','local-git','github-existing-ref'),1) ELSE 1 END";
        const size = this.s.one(`SELECT COUNT(*) n,COALESCE(SUM(MIN(length(CAST(data AS BLOB)),131072)),0) bytes FROM effect_targets WHERE ${where}`);
        if (size.n > 256 || size.bytes > 2097152)
            throw Error('Publication target discovery exceeds bounded profile; no targets were silently omitted');
        return { scope: 'Retained publication identity and policy only; no current account authority or requests', targets: this.s.all(`SELECT id,project,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM effect_targets WHERE ${where} ORDER BY rowid`).map(row => {
                const unavailable = { state: 'UNAVAILABLE' as const, targetId: row.id as string };
                try {
                    const data = parse(row.data);
                    if (data.kind !== 'github-publication' || !['public', 'private'].includes(data.visibility) || row.project !== null && !this.s.one('SELECT id FROM projects WHERE id=?', row.project))
                        return unavailable;
                    validatePublicationTargetPolicy(data.target, data.carrierPolicy);
                    return { state: 'RETAINED' as const, targetId: row.id as string, projectId: row.project as string | null, target: data.target as RegisterPublicationTarget['target'], visibility: data.visibility as RegisterPublicationTarget['visibility'], carrierPolicy: data.carrierPolicy as NonNullable<RegisterPublicationTarget['carrierPolicy']> };
                }
                catch {
                    return unavailable;
                }
            }) };
    }
    delegate(input: DelegatePublication) {
        for (const work of this.ancestry(input.workId))
            assertOwnerRootActivated(this.s, work);
        return this.delegateInner(input);
    }
    private delegateInner(input: DelegatePublication) {
        this.h.assertOpen();
        if (contextWorkContinuation(this.s, input.workId))
            throw Error('Context work cannot create a publication grant; use the retained original owner root/delegate entry');
        const w = this.work(input.workId), t = this.target(input.targetId), source = this.s.one('SELECT origin FROM sources WHERE id=?', w.source);
        if (!parse(source.origin).kind.startsWith('owner-'))
            throw Error('Publication grant requires original owner work, not an agent role label');
        if (!Array.isArray(input.actions) || !input.actions.length || new Set(input.actions).size !== input.actions.length || input.actions.some(a => !classes.has(a)) || !Number.isSafeInteger(input.operationLimit) || input.operationLimit < 1 || input.operationLimit > 100)
            throw Error('Finite publication action/operation grant required');
        const projects = [...(input.projectIds ?? [t.project])];
        if (!projects.length || projects.some(p => p !== null && !this.s.one('SELECT id FROM projects WHERE id=?', p)))
            throw Error('Publication grant project scope invalid');
        const value = { kind: 'publication', actions: [...input.actions].sort(), projectIds: projects, scope: input.scope ?? 'work', rootEpoch: w.epoch, operationLimit: input.operationLimit, ownerUid: process.getuid?.() ?? null };
        const old = this.s.one("SELECT * FROM effect_delegations WHERE root=? AND target=? AND json_extract(data,'$.kind')='publication'", w.id, t.id);
        if (old) {
            if (hash(parse(old.data)) !== hash(value))
                throw Error('Existing publication grant cannot reset counters/scope; explicit revision required');
            return { grantId: old.id, operationLimit: input.operationLimit };
        }
        const id = randomUUID();
        this.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', id, w.id, t.id, 1, JSON.stringify(value));
        return { grantId: id, operationLimit: input.operationLimit };
    }
    /** Called only inside the admission transaction: work and operation become visible together. */
    private insertOwnerWork(action: PublicationAction, target: string, work: string, contribution?: {
        request: unknown;
        proof: ReturnType<EffectHost['contributionSnapshot']>;
    }) {
        const source = randomUUID();
        this.s.run('INSERT INTO sources VALUES(?,?,?,?)', source, null, JSON.stringify({ kind: contribution ? 'owner-contribution-summary-request' : 'owner-publication-exact', uid: process.getuid?.() ?? null, targetId: target }), JSON.stringify(contribution ? { request: contribution.request, hostGeneratedAction: action, catalogueProof: contribution.proof, bodyOrigin: 'host-generated-not-owner-authored' } : action));
        this.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', work, this.target(target).project, source, null, work, 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'publication', raw: JSON.stringify(action) }));
        this.s.run('INSERT INTO requirements VALUES(?,?,?,?)', work, 1, JSON.stringify(action), JSON.stringify({ status: 'owner-exact-action', sourceId: source }));
        for (const kind of ['execution', 'resolution'])
            this.s.run('INSERT INTO budgets VALUES(?,?,8,0,0)', work, kind);
        return this.work(work);
    }
    private grant(work: string, target: string, action: PublicationActionClass) {
        const w = this.work(work), ancestors = this.ancestry(work);
        for (const row of this.s.all("SELECT * FROM effect_delegations WHERE target=? AND json_extract(data,'$.kind')='publication'", target)) {
            const data = parse(row.data), root = this.work(row.root);
            if ((row.root === work || data.scope === 'delegation-lineage' && ancestors.includes(row.root)) && data.rootEpoch === root.epoch && !['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(root.state) && data.actions.includes(action) && data.projectIds.includes(w.project))
                return { ...row, data };
        }
        throw Error('Explicit current publication grant/action/project/original lineage required');
    }
    private input(op: any): PublicationInput { return { operationId: op.id, target: op.data.target, action: op.data.action, carrierPolicy: op.data.carrierPolicy }; }
    private async summary(work: string, action: PublicationAction, operationId?: string) {
        if (action.kind !== 'create-comment' || action.purpose !== 'reviewed-summary')
            return { action, evidence: null, normalEvidence: false };
        let evidence, normalEvidence = true;
        try {
            evidence = await this.h.changes.currentEvidence(work);
        }
        catch (error) {
            if (!operationId)
                throw error;
            normalEvidence = false;
            evidence = await this.h.changes.tentativePublicationEvidence(operationId);
        }
        const body = action.body + '\n\nController verification: review-ready (not landed).\nCandidate ' + evidence.candidateDigest + '\nChecks ' + evidence.checkIds.join(', ') + '\nIndependent reviews ' + evidence.reviewLaunchIds.join(', ');
        return { action: { ...action, body }, evidence, normalEvidence };
    }
    private noContributionUncertainty(proof: ReturnType<EffectHost['contributionSnapshot']>, exceptId?: string) {
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='publication'")) {
            if (row.id === exceptId)
                continue;
            const d = parse(row.data);
            if (d.contributionSnapshot?.lineageKey !== proof.lineageKey || !['INVOKING', 'UNKNOWN'].includes(row.phase) || !d.dispatchIntent)
                continue;
            const send = this.s.one("SELECT data FROM effect_receipts WHERE operation=? AND kind='publication-send' ORDER BY rowid DESC LIMIT 1", row.id);
            if (send) {
                const actual = parse(send.data), resource = actual.resource;
                if (actual.handoff === 'not-started')
                    continue;
                if (actual.handoff === 'request-created' && actual.outcome === 'confirmed' && actual.operationId === row.id && actual.payloadHash === d.payloadHash && Number.isSafeInteger(resource?.id) && resource.id > 0 && typeof resource.nodeId === 'string' && resource.nodeId.length > 0 && typeof resource.url === 'string' && resource.url.startsWith('https://github.com/'))
                    continue;
            }
            throw Error('Original contribution-summary send uncertain on this native resource lineage; readonly reconcile ' + row.id + ' before new revision/work/target alias');
        }
    }
    private contributionTarget(proof: ReturnType<EffectHost['contributionSnapshot']>, target: any) {
        const r = proof.repository;
        if (target.host !== 'github.com' || target.repositoryId !== r.repositoryId || target.repositoryNodeId !== r.repositoryNodeId || target.owner !== r.owner || target.repository !== r.repository)
            throw Error('Contribution native parent/publication repository mismatch');
    }
    private contributionDuplicate(proof: ReturnType<EffectHost['contributionSnapshot']>, exceptId?: string) {
        return this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='publication'").find(row => { const prior = parse(row.data).contributionSnapshot; return row.id !== exceptId && prior?.lineageKey === proof.lineageKey && prior.revisionId === proof.revisionId; });
    }
    prepareContributionOwner(input: {
        resourceId: string;
        revisionId: string;
        targetId: string;
        operationId?: string;
        signal?: AbortSignal;
    }) {
        this.h.assertOpen();
        const { signal, ...request } = input, captured = structuredClone(request), proof = this.h.contributionSnapshot(captured), target = this.target(captured.targetId);
        this.contributionTarget(proof, target.data.target);
        this.noContributionUncertainty(proof, captured.operationId);
        if (captured.operationId) {
            const prior = this.op(captured.operationId);
            this.assertPreparationAdmission(prior.id);
            const duplicate = this.contributionDuplicate(proof, prior.id);
            if (duplicate)
                throw Error('Current summary revision already belongs to original publication ' + duplicate.id + '; inspect that original instead of replacing identity');
            if (!prior.data.contributionSnapshot || prior.data.contributionSnapshot.lineageKey !== proof.lineageKey || prior.data.dispatchIntent)
                throw Error('Contribution continuation differs or may have sent; readonly reconcile original operation');
        }
        else {
            const duplicate = this.contributionDuplicate(proof);
            if (duplicate) {
                const d = parse(duplicate.data);
                if (hash(d.target) !== hash(target.data.target) || hash(d.carrierPolicy) !== hash(target.data.carrierPolicy))
                    throw Error('Existing contribution publication uses different target/carrier scope; inspect original operation');
                return Promise.resolve(this.inspectInternal(duplicate.id));
            }
        }
        const action: PublicationAction = { kind: 'create-comment', purpose: 'contribution-summary', parent: proof.parent, body: proof.body };
        return this.own(this.prepareOwnerInner({ targetId: captured.targetId, action, ...(captured.operationId ? { operationId: captured.operationId } : {}), ...(signal ? { signal } : {}) }, { request: captured, proof }));
    }
    prepareOwner(input: PrepareOwnerPublication) {
        this.h.assertOpen();
        if (input.action.kind === 'create-comment' && input.action.purpose === 'contribution-summary')
            throw Error('Contribution summary requires dedicated host catalogue producer; supplied body/proof refused');
        const { signal, ...rest } = input, captured = structuredClone(rest);
        return this.own(this.prepareOwnerInner({ ...captured, ...(signal ? { signal } : {}) }));
    }
    private assertPreparationAdmission(id: string) {
        const context = this.reconciliationContext(id);
        if (context.unsettled)
            throw Error('Original publication producer is unsettled; resolve its original recovery/cleanup before preparation');
        if (context.execution.consumed + context.execution.reserved >= context.execution.limit)
            throw Error('Original publication execution allowance exhausted before preparation');
        if (context.workState !== 'ACTIVE')
            throw Error('Original work requires explicit recovery before preparation; no work revival');
    }
    private async prepareOwnerInner(input: PrepareOwnerPublication, contribution?: {
        request: unknown;
        proof: ReturnType<EffectHost['contributionSnapshot']>;
    }): Promise<PublicationView> {
        const t = this.target(input.targetId), prior = input.operationId ? this.op(input.operationId) : null;
        if (prior && ['INVOKING', 'UNKNOWN', 'CONFIRMED'].includes(prior.phase))
            throw Error('Uncertain/confirmed publication cannot be re-prepared or resent');
        const existing = input.workId ? this.work(input.workId) : prior ? this.work(prior.work) : null;
        if (prior && (prior.work !== existing?.id || prior.target !== t.id))
            throw Error('Publication continuation identity differs');
        if (existing && this.h.interactions.impacts(existing.id).some(i => i.data.effectHold)) {
            if (prior)
                return this.patch(prior.id, 'REFUSED', { blocked: ['Held consequential source requires actual independent fit or explicit scoped supersession'], nextAction: 'Resolve ALL actual retained source directions before owner-exact continuation' });
            throw Error('Held consequential source requires actual independent fit before publication');
        }
        if (prior)
            this.assertPreparationAdmission(prior.id);
        const requested = structuredClone(input.action);
        // Bootstrap admission has no await. Reviewed summaries consume an already addressable governed W.
        if (!existing && requested.kind === 'create-comment' && requested.purpose === 'reviewed-summary')
            throw Error('Reviewed summary requires an existing governed work');
        const resolved = requested.kind === 'create-comment' && requested.purpose === 'reviewed-summary'
            ? await this.summary(existing!.id, requested) : { action: requested, evidence: null };
        const action = resolved.action, id = prior?.id ?? randomUUID(), carrierPolicy = t.data.carrierPolicy;
        // Invalid bytes/policy fail before any durable W, grant, source authorization or operation exists.
        const sealed = sealPublicationPayload({ operationId: id, target: t.data.target, action, carrierPolicy });
        const workId = existing?.id ?? randomUUID(), authorization = randomUUID();
        this.s.tx(() => {
            this.h.assertOpen();
            if (prior) {
                this.assertPreparationAdmission(prior.id);
                if (hash(this.op(prior.id)) !== hash(prior))
                    throw Error('Original publication changed before preparation admission');
            }
            if (contribution) {
                if (hash(this.h.contributionSnapshot(contribution.proof)) !== hash(contribution.proof))
                    throw Error('Contribution catalogue changed before admission');
                this.noContributionUncertainty(contribution.proof, id);
                const duplicate = this.contributionDuplicate(contribution.proof, id);
                if (duplicate)
                    throw Error('Current summary revision already belongs to original publication ' + duplicate.id + '; inspect that original instead of replacing identity');
            }
            const work = existing ? this.work(existing.id) : this.insertOwnerWork(action, t.id, workId, contribution);
            if (this.h.interactions.impacts(work.id).some(i => i.data.effectHold))
                throw Error('Held consequential source requires actual independent fit before publication');
            if (!existing)
                this.delegate({ workId, targetId: t.id, actions: [actionClass(action)], operationLimit: 1, scope: 'work' });
            const grant = this.grant(work.id, t.id, actionClass(action)), fingerprint = this.sourceFingerprint(work.id);
            if (!prior && this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n >= grant.data.operationLimit)
                throw Error('Cumulative publication operation limit exhausted');
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', authorization, null, JSON.stringify({ kind: 'owner-publication-action', uid: process.getuid?.() ?? null, workId: work.id, payloadHash: sealed.payloadHash }), JSON.stringify({ targetId: t.id, action, ...(contribution ? { request: contribution.request, catalogueProof: contribution.proof, bodyOrigin: 'host-generated-not-owner-authored' } : {}) }));
            const data = { kind: 'publication', ...(contribution ? { contributionSnapshot: contribution.proof } : {}), target: t.data.target, visibility: t.data.visibility, action, carrierPolicy, payloadBase64: Buffer.from(sealed.payloadUtf8).toString('base64'), payloadHash: sealed.payloadHash, ownerAuthorization: { sourceId: authorization, payloadHash: sealed.payloadHash, sourceFingerprint: fingerprint }, sourceFingerprint: fingerprint, epoch: work.epoch, generation: work.generation, grantEpoch: grant.epoch, evidence: resolved.evidence, descriptorVersion: 'publication-actions/v1', actionDescriptor: this.descriptor(action), activation: 'disabled', blocked: [], nextAction: 'dispatchPublication' };
            if (prior) {
                this.receipt(id, 'payload-revision', { previous: prior.data.payloadHash, authorization: prior.data.ownerAuthorization, ...(prior.data.contributionSnapshot ? { catalogueProof: prior.data.contributionSnapshot, payloadBase64: prior.data.payloadBase64 } : {}) });
                this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', 'PREPARED', JSON.stringify({ ...data, history: [...(prior.data.history ?? []), prior.data.ownerAuthorization] }), id);
            }
            else
                this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, work.id, t.id, grant.id, 'PREPARED', JSON.stringify(data));
        });
        if (input.signal?.aborted)
            return this.patch(id, 'REFUSED', { blocked: ['Owner publication preparation cancelled before send'], nextAction: 'Explicit same-operation preparation' });
        if (!this.session || this.session.activation === 'disabled')
            return this.patch(id, 'REFUSED', { blocked: ['HOSTED_PUBLICATION_DISABLED: actual authorized per-action capability acceptance absent'], nextAction: 'Use offline/local work or obtain the separately authorized real profile; no POST was sent' });
        try {
            await this.run(id, 'preflight', input.signal, async (session, signal) => {
                await this.capability(id, session, signal);
                const handle = await session.preparePublication(this.input(this.op(id)), signal), copy = session.inspectPreparedPayload(handle);
                if (copy.sha256 !== sealed.payloadHash || !Buffer.from(copy.jsonUtf8).equals(Buffer.from(sealed.payloadUtf8)))
                    throw Error('Native final payload differs from owner authorization');
            });
            return this.patch(id, 'RESERVED', { activation: this.session.activation, blocked: [], nextAction: 'dispatchPublication' });
        }
        catch (error) {
            return this.patch(id, 'REFUSED', { blocked: [String(error)], nextAction: 'Restore exact prerequisite and explicitly prepare same retained operation' });
        }
    }
    grantContext(work: string) { const ancestors = this.ancestry(work); return this.s.all("SELECT * FROM effect_delegations WHERE json_extract(data,'$.kind')='publication'").filter(g => g.root === work || parse(g.data).scope === 'delegation-lineage' && ancestors.includes(g.root)).map(g => ({ grantId: g.id, targetId: g.target, ...parse(g.data) })); }
    operationWork(assignmentId: string) {
        const a = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!a || parse(a.data).operation !== 'effect-publication')
            throw Error('Publication assignment required');
        const op = this.op(parse(a.data).effectOperationId);
        if (a.state === 'CANCELLED' || a.work !== op.work || op.data.assignmentId !== a.id || op.data.conversationId !== a.target)
            throw Error('Publication subject assignment binding changed');
        if (parse(this.work(op.work).data).kind === 'ordinary-conversation') {
            if (hash(parse(a.data).source) !== hash(op.data.origin?.identity))
                throw Error('Publication originating assignment source changed');
            assertOrdinaryEffectSource(this.s, op.work, op.data.origin?.identity);
        }
        return op.work as string;
    }
    private origin(identity: NativeIdentity) {
        const w = this.work(identity.workId), view = this.h.interactions.inspect(identity.conversationId);
        return { identity: structuredClone(identity), epoch: w.epoch, workEpoch: w.epoch, source: w.source, rootSource: w.source, direction: view.directionRevision, sourceFingerprint: this.sourceFingerprint(w.id), ...this.contextToken(w.id) };
    }
    private contextToken(work: string): {
        contextFingerprint?: string;
    } { const snapshot = contextAuthoritySnapshot(this.s, this.ancestry(work)); return snapshot ? { contextFingerprint: hash(snapshot) } : {}; }
    private ownerRoot(root: string) {
        const w = this.work(root), conversation = parse(w.data).conversation;
        return { workId: root, epoch: w.epoch, source: w.source, sourceFingerprint: this.sourceFingerprint(root), conversationId: conversation ?? null, direction: conversation ? this.h.interactions.inspect(conversation).directionRevision : null, ...this.contextToken(root) };
    }
    private checkOrigin(op: any) {
        if (!op.data.origin)
            return;
        if (op.data.assignmentId)
            this.operationWork(op.data.assignmentId);
        if (hash(this.origin(op.data.origin.identity)) !== hash(op.data.origin) || hash(this.ownerRoot(op.data.ownerRoot.workId)) !== hash(op.data.ownerRoot))
            throw Error('Original coordinator/owner source changed; renew independent publication fit before send');
        if (op.data.assignmentId && this.s.one('SELECT state FROM conversation_assignments WHERE id=?', op.data.assignmentId)?.state === 'CANCELLED')
            throw Error('Publication assignment cancelled');
        if (op.data.reviewedAssignmentId) {
            const a = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', op.data.reviewedAssignmentId);
            if (!a || a.work !== op.work || a.state !== 'COMPLETE' || parse(a.data).operation !== 'change')
                throw Error('Original reviewed assignment no longer current');
        }
    }
    queue(input: {
        targetId: string;
        action: PublicationAction;
        reviewedAssignmentId?: string;
    }, identity: NativeIdentity, entry: () => void) {
        if (input.action.kind === 'create-comment' && input.action.purpose === 'contribution-summary')
            throw Error('Dedicated captured contribution-summary path required; generic body/proof refused');
        return this.queueInner(input, identity, entry);
    }
    queueContribution(input: {
        resourceId: string;
        revisionId: string;
        targetId: string;
    }, identity: NativeIdentity, entry: () => void) {
        this.h.assertInteractionAdmission();
        entry();
        const captured = structuredClone(input), proof = this.h.contributionSnapshot(captured), t = this.target(captured.targetId);
        this.contributionTarget(proof, t.data.target);
        this.noContributionUncertainty(proof);
        return this.queueInner({ targetId: captured.targetId, action: { kind: 'create-comment', purpose: 'contribution-summary', parent: proof.parent, body: proof.body } }, identity, entry, proof);
    }
    private queueInner(input: {
        targetId: string;
        action: PublicationAction;
        reviewedAssignmentId?: string;
    }, identity: NativeIdentity, entry: () => void, contribution?: ReturnType<EffectHost['contributionSnapshot']>) {
        this.h.assertInteractionAdmission();
        entry();
        const live = this.h.interactions.getHandle(identity.conversationId);
        if (!live || live.identity.runId !== identity.runId || live.identity.generation !== identity.generation)
            throw Error('Exact current ordinary coordinator required');
        const t = this.target(input.targetId), action = structuredClone(input.action), id = randomUUID();
        const initialSeal = sealPublicationPayload({ operationId: id, target: t.data.target, action, carrierPolicy: t.data.carrierPolicy });
        let subject = this.work(identity.workId);
        if (action.kind === 'create-comment' && action.purpose === 'reviewed-summary') {
            const a = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', input.reviewedAssignmentId ?? '');
            if (!a || a.state !== 'COMPLETE' || parse(a.data).operation !== 'change' || !a.work)
                throw Error('Actual completed original governed assignment required for reviewed summary');
            subject = this.work(a.work);
            const invocation = parse(subject.data).invocation;
            if (invocation?.assignmentId !== a.id || invocation.actor?.workId !== parse(a.data).source.workId)
                throw Error('Original reviewed invocation differs before publication alias');
        }
        else if (input.reviewedAssignmentId)
            throw Error('Reviewed assignment is only applicable to reviewed-summary action');
        assertOrdinaryEffectSource(this.s, subject.id, identity);
        const grant = this.grant(subject.id, t.id, actionClass(action));
        if (!this.ancestry(identity.workId).includes(grant.root))
            throw Error('Coordinator outside original publication grant lineage');
        const retained = this.s.all("SELECT * FROM effect_operations WHERE work=? AND target=? AND json_extract(data,'$.kind')='publication' AND json_extract(data,'$.assignmentId') IS NOT NULL ORDER BY rowid DESC", subject.id, t.id).map(row => ({ ...row, data: parse(row.data) }));
        const family = (row: any) => actionClass(row.data.requestedAction) === actionClass(action) && (action.kind !== 'create-comment' || hash(row.data.requestedAction.parent) === hash(action.parent)) && (row.data.reviewedAssignmentId ?? null) === (input.reviewedAssignmentId ?? null);
        const duplicate = retained.find(row => row.phase === 'CONFIRMED' && family(row) && hash(row.data.requestedAction) === hash(action));
        if (duplicate)
            return { operationId: duplicate.id as string, assignmentId: duplicate.data.assignmentId as string, conversationId: duplicate.data.conversationId as string, state: 'COMPLETE' as const, reused: true, result: this.inspectInternal(duplicate.id) };
        if (retained.some(row => row.phase !== 'CONFIRMED' && (['UNKNOWN', 'INVOKING'].includes(row.phase) || row.data.dispatchIntent)))
            throw Error('Uncertain original publication on this W/target prevents a new identity across payload/class/parent changes; inspect/reconcile');
        if (retained.some(row => !['REFUSED', 'CONFIRMED'].includes(row.phase)))
            throw Error('Existing publication preparation is active');
        const previous = retained.find(row => row.phase === 'REFUSED' && family(row));
        if (previous) {
            const old = previous;
            if (old.phase === 'CONFIRMED' || old.phase === 'UNKNOWN' || old.phase === 'INVOKING' || old.data.dispatchIntent)
                throw Error('Existing publication is confirmed or uncertain; inspect/reconcile without new POST');
            if (old.phase !== 'REFUSED')
                throw Error('Existing publication task is active');
            if (old.grant_id !== grant.id || old.data.ownerRoot.epoch !== this.work(grant.root).epoch || old.data.origin.epoch !== this.work(old.data.origin.identity.workId).epoch)
                throw Error('Cancellation/grant identity cannot be renewed by a new payload');
            if (old.data.reviewedAssignmentId !== (input.reviewedAssignmentId ?? null))
                throw Error('Original reviewed subject identity differs');
            const a = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', old.data.assignmentId);
            if (!a || a.state === 'CANCELLED')
                throw Error('Original publication assignment cancelled');
            this.s.tx(() => {
                entry();
                assertOrdinaryEffectSource(this.s, subject.id, identity);
                if (contribution) {
                    if (hash(this.h.contributionSnapshot(contribution)) !== hash(contribution))
                        throw Error('Contribution catalogue changed');
                    this.noContributionUncertainty(contribution, old.id);
                }
                this.receipt(old.id, 'explicit-agent-reentry', { previousAction: old.data.requestedAction, previousOrigin: old.data.origin, source: identity, action });
                this.patch(old.id, 'PREPARED', { ...(contribution ? { contributionSnapshot: contribution } : {}), requestedAction: action, action, epoch: subject.epoch, generation: subject.generation, actionDescriptor: this.descriptor(action), origin: this.origin(identity), ownerRoot: this.ownerRoot(grant.root), judgedAuthorization: null, sourceFingerprint: this.sourceFingerprint(subject.id), blocked: [] });
                this.s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'QUEUED', JSON.stringify({ ...parse(a.data), source: identity }), a.id);
                this.s.run('UPDATE conversation_dependencies SET state=? WHERE assignment=?', 'PENDING', a.id);
                this.s.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'QUEUED', a.target);
            });
            return { operationId: old.id as string, assignmentId: a.id as string, conversationId: a.target as string, state: 'QUEUED' as const };
        }
        const assignmentId = randomUUID(), conversationId = randomUUID();
        this.s.tx(() => {
            entry();
            assertOrdinaryEffectSource(this.s, subject.id, identity);
            if (contribution) {
                if (hash(this.h.contributionSnapshot(contribution)) !== hash(contribution))
                    throw Error('Contribution catalogue changed');
                this.noContributionUncertainty(contribution, id);
            }
            if (this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n >= grant.data.operationLimit)
                throw Error('Cumulative publication operation limit exhausted');
            this.s.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', conversationId, subject.project, 'QUEUED');
            this.s.run('INSERT INTO conversation_state(conversation,work,resource,data) VALUES(?,?,?,?)', conversationId, subject.id, 'QUEUED', JSON.stringify({ role: 'Publication', purpose: 'Action-specific payload/source judgment and conditional publication' }));
            this.s.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)', conversationId, identity.conversationId);
            this.s.run('INSERT INTO conversation_views(conversation) VALUES(?)', conversationId);
            this.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignmentId, identity.conversationId, conversationId, subject.id, 'QUEUED', JSON.stringify({ operation: 'effect-publication', effectOperationId: id, source: identity, delegationRoot: grant.root }));
            this.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), identity.conversationId, conversationId, assignmentId, 'PENDING', JSON.stringify({ source: identity }));
            this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, subject.id, t.id, grant.id, 'PREPARED', JSON.stringify({ kind: 'publication', ...(contribution ? { contributionSnapshot: contribution } : {}), target: t.data.target, visibility: t.data.visibility, action, carrierPolicy: t.data.carrierPolicy, requestedAction: action, actionDescriptor: this.descriptor(action), payloadHash: initialSeal.payloadHash, payloadBase64: Buffer.from(initialSeal.payloadUtf8).toString('base64'), grantEpoch: grant.epoch, epoch: subject.epoch, generation: subject.generation, sourceFingerprint: this.sourceFingerprint(subject.id), origin: this.origin(identity), ownerRoot: this.ownerRoot(grant.root), assignmentId, conversationId, reviewedAssignmentId: input.reviewedAssignmentId ?? null, blocked: [], nextAction: 'Action-specific independent judgment before conditional publication' }));
        });
        return { operationId: id, assignmentId, conversationId, state: 'QUEUED' as const };
    }
    async runQueued(assignmentId: string, operation: ChangeOperation): Promise<PublicationView> {
        operation = this.h.changes.captureModelOperation(operation);
        if (this.operationWork(assignmentId) !== operation.workId)
            throw Error('Publication model operation subject changed');
        this.h.assertInteractionAdmission();
        const assignment = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!assignment || assignment.state === 'CANCELLED' || parse(assignment.data).operation !== 'effect-publication')
            throw Error('Retained active publication assignment required');
        const op = this.op(parse(assignment.data).effectOperationId), work = this.work(op.work);
        if (work.state === 'INTERRUPTED') {
            const r = this.s.one("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='publication-judgment' AND json_extract(data,'$.operationId')=? ORDER BY rowid DESC LIMIT 1", work.id, op.id), proof = r ? parse(r.data) : null;
            if (!r || r.phase !== 'INTERRUPTED' || !['actual-native-entries-collected', 'observed-no-model-dispatch-before-interruption'].includes(proof.publicationHistoryRecovery) || work.epoch !== op.data.epoch || work.generation !== op.data.generation)
                throw Error('Actual interrupted publication producer recovery required before reentry');
            this.s.run('UPDATE works SET state=? WHERE id=?', 'ACTIVE', work.id);
        }
        return this.own(this.prepareAgent(op.id, operation).then(p => p.phase === 'RESERVED' ? this.dispatch({ operationId: p.operationId }) : p));
    }
    holdInheritedSource(id: string) { const op = this.op(id); return this.patch(id, ['INVOKING', 'UNKNOWN'].includes(op.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Original owner source changed; exact inherited sources held on original governed W'], nextAction: 'Same original child source-fit/replan before explicit publication recovery' }); }
    scopedInspect(id: string, identity: NativeIdentity, entry: () => void) {
        entry();
        const op = this.op(id), grant = this.grant(op.work, op.target, actionClass(op.data.action));
        if (!this.ancestry(identity.workId).includes(grant.root))
            throw Error('Publication outside captured original grant lineage');
        return this.inspect(id);
    }
    async scopedReconcile(id: string, identity: NativeIdentity, entry: () => void, signal?: AbortSignal) {
        this.scopedInspect(id, identity, entry);
        if (this.op(id).work !== identity.workId)
            return this.reconcile({ operationId: id, ...signal ? { signal } : {} });
        // Read under the exact live coordinator; never replace its active ownership.
        const originalRun = this.s.one('SELECT data FROM runs WHERE id=?', identity.runId), capacityId = originalRun ? parse(originalRun.data).capacityId : null;
        if (typeof capacityId !== 'string')
            throw Error('Actual admitted ordinary caller capacity required');
        const caller: ReconciliationCaller = { runId: identity.runId, capacityId, assert: () => {
                entry();
                signal?.throwIfAborted();
                const live = this.h.interactions.getHandle(identity.conversationId), run = this.s.one('SELECT * FROM runs WHERE id=?', identity.runId), work = this.work(identity.workId), data = run ? parse(run.data) : null;
                const lease = this.s.one('SELECT * FROM capacity_leases WHERE id=?', capacityId);
                if (data?.capacityId !== capacityId || !lease || lease.run !== identity.runId || lease.work !== work.id || lease.epoch !== work.epoch || !['ADMITTED', 'ACTIVE'].includes(lease.state) || parse(lease.data).admitted !== true ||
                    !live || hash(live.identity) !== hash(identity) || this.h.interactions.inspect(identity.conversationId).generation !== identity.generation || !this.h.busy(work.id) ||
                    !run || run.work !== work.id || run.phase !== 'RUNNING' || run.reservation !== 'reserved' || run.epoch !== work.epoch || run.generation !== work.generation ||
                    data.kind !== 'ordinary-conversation' || data.conversation !== identity.conversationId || data.initialInputId !== identity.initialInputId ||
                    data.cleanup && !['not-allocated', 'removed', 'unbound'].includes(data.cleanup))
                    throw Error('Actual healthy live ordinary reconciliation caller required');
            } };
        caller.assert();
        return this.own(this.reconcileInner({ operationId: id, ...signal ? { signal } : {} }, caller));
    }
    private async prepareAgent(id: string, operation: ChangeOperation): Promise<PublicationView> {
        operation = this.h.changes.captureModelOperation(operation);
        if (this.op(id).work !== operation.workId)
            throw Error('Publication model operation subject changed');
        try {
            let op = this.op(id);
            if (this.h.changes.publicationBlockers(op.work, id).length)
                throw Error('Another retained publication operation has unresolved findings/producer obligations; resolve that original operation first');
            this.inheritSources(op);
            op = this.op(id);
            this.checkOrigin(op);
            if (hash(op.data.actionDescriptor ?? null) !== hash(this.descriptor(op.data.action)))
                throw Error('Installed publication action descriptor changed');
            const work = this.work(op.work), criteria = loadCriteriaSync();
            const resolved = await this.summary(work.id, op.data.requestedAction, id), action = resolved.action;
            this.checkOrigin(this.op(id));
            if (resolved.evidence && resolved.normalEvidence) {
                this.patch(id, op.phase, { procedureBaseline: resolved.evidence, procedureBaselineDelivered: work.state === 'DELIVERED' || !!op.data.procedureBaselineDelivered && hash(softwareEvidenceIdentity(op.data.procedureBaseline)) === hash(softwareEvidenceIdentity(resolved.evidence)) });
            }
            const sealed = sealPublicationPayload({ operationId: id, target: op.data.target, action, carrierPolicy: op.data.carrierPolicy }), fingerprint = this.sourceFingerprint(work.id);
            const chain = this.h.interactions.impacts(work.id), source = this.s.one('SELECT raw,origin FROM sources WHERE id=?', work.source), payload = Buffer.from(sealed.payloadUtf8).toString('utf8');
            const sourceWorks = [...new Set([...this.ancestry(work.id), ...this.ancestry(op.data.origin.identity.workId), op.data.ownerRoot.workId])];
            const originalSourceChain = sourceWorks.map(id => { const w = this.work(id), s = this.s.one('SELECT * FROM sources WHERE id=?', w.source); return { workId: id, sourceId: w.source, raw: s.raw, origin: parse(s.origin), requirements: this.s.all('SELECT * FROM requirements WHERE work=? ORDER BY version', id), directions: this.h.interactions.impacts(id) }; });
            const content = JSON.stringify({ target: op.data.target, action, ...(op.data.contributionSnapshot ? { contributionSnapshot: op.data.contributionSnapshot } : {}), payloadJson: payload, ownerSource: { id: work.source, raw: source.raw, origin: parse(source.origin) }, originalSourceChain, sourceInputChain: chain, origin: op.data.origin, ownerRoot: op.data.ownerRoot }, null, 2), sourceId = 'candidate:publication-action.json';
            const occurrences = this.s.all("SELECT f.* FROM finding_occurrences f JOIN role_launches l ON l.id=json_extract(f.data,'$.launchId') WHERE f.work=? AND json_extract(l.data,'$.stage')='publication-payload-fit' AND json_extract(l.data,'$.operationId')=?", work.id, id);
            const bundle: InputBundle = { requirements: [{ id: 'publication-intent', text: 'Publish only these final bytes when they fit every actual owner source, delegated action/target scope, explicit unreviewed bootstrap/draft or current verified-summary status. Consequential ambiguity requires owner input. Do not claim landing/review completion from publication.', source: work.source }], contracts: criteria.text, sources: [{ id: sourceId, version: sealed.payloadHash, side: 'candidate', path: 'publication-action.json', content, sha256: hash(content), exposeInPrompt: true }], requiredScope: [{ sourceId, startLine: 1, endLine: content.split('\n').length }], context: { operationId: id, actionFamily: actionClass(action), originalSourceChain, stage: 'publication-payload-fit', payloadHash: sealed.payloadHash, sourceFingerprint: fingerprint, sourceInputChain: chain, occurrences: occurrences.map(o => ({ id: o.id, ...parse(o.data) })), instructions: 'Return payloadDecision bound to exact payloadHash/sourceFingerprint. Account ALL held inputs using inputDecisions against publication-intent; classify consequential scope changes/ambiguity honestly. Disposition each prior publication occurrence independently; your own new findings remain pending for a later independent judgment. This action judgment does not clear software proof obligations or global source holds.' } };
            if (work.state === 'DELIVERED')
                this.s.run('UPDATE works SET state=? WHERE id=?', 'ACTIVE', work.id);
            const judgment = await this.h.changes.publicationJudgment({ ...this.h.changes.captureModelOperation(operation), inputBundle: bundle, sourceFingerprint: fingerprint, operationId: id });
            this.checkOrigin(this.op(id));
            if (this.sourceFingerprint(work.id) !== fingerprint)
                throw Error('Publication source changed during independent judgment');
            if (!this.findingProjection(this.op(id)).complete)
                throw Error('Complete exact-operation finding inspection unavailable under bounded profile');
            const p = judgment.protocol, decision = p?.payloadDecision;
            if (!judgment.usable || !p || decision?.verdict !== 'fit' || decision.payloadHash !== sealed.payloadHash || decision.sourceFingerprint !== fingerprint || p.ownerDecisionRequired?.length)
                throw Error('Actual independent payload/source judgment incomplete or needs owner scope');
            const held = chain.filter(i => i.data.effectHold), decisions = p.inputDecisions ?? [];
            if (decisions.length !== held.length || held.some(i => !decisions.some(d => d.inputId === i.input_id && d.directionRevision === i.revision && d.impact === 'explanation' && d.requirementIds.includes('publication-intent'))))
                throw Error('ALL held consequential sources need exact action-specific independent accounting; changed scope requires new bounded action');
            if (this.h.changes.publicationDispositions(work.id, judgment.launchId, p, sealed.payloadHash, id).length)
                throw Error('Publication raw findings/producer obligations remain pending');
            if (resolved.evidence) {
                resolved.evidence = await this.h.changes.currentEvidence(work.id);
                this.checkOrigin(this.op(id));
                if (this.op(id).data.procedureBaselineDelivered)
                    this.s.run("UPDATE works SET state='DELIVERED' WHERE id=? AND epoch=? AND generation=? AND state='ACTIVE'", work.id, work.epoch, work.generation);
            }
            this.patch(id, 'PREPARED', { action, payloadHash: sealed.payloadHash, payloadBase64: Buffer.from(sealed.payloadUtf8).toString('base64'), sourceFingerprint: fingerprint, evidence: resolved.evidence, judgedAuthorization: { launchId: judgment.launchId, payloadHash: sealed.payloadHash, sourceFingerprint: fingerprint, criteriaHash: criteria.hash, heldDirections: held.map(i => [i.input_id, i.revision, i.source]) }, blocked: [] });
            if (!this.session || this.session.activation === 'disabled')
                return this.patch(id, 'REFUSED', { blocked: ['HOSTED_PUBLICATION_DISABLED'], nextAction: 'Retain original operation; authorized actual profile acceptance remains unavailable' });
            await this.run(id, 'preflight', undefined, async (session, signal) => {
                await this.capability(id, session, signal);
                const handle = await session.preparePublication(this.input(this.op(id)), signal), copy = session.inspectPreparedPayload(handle);
                if (copy.sha256 !== sealed.payloadHash)
                    throw Error('Final native bytes differ from independently judged payload');
            });
            return this.patch(id, 'RESERVED', { activation: this.session.activation, blocked: [], nextAction: 'dispatchPublication' });
        }
        catch (error) {
            return this.patch(id, 'REFUSED', { blocked: [String(error)], nextAction: 'Inspect exact retained finding/source/prerequisite; explicit same-operation recovery only' });
        }
    }
    private async capability(id: string, session: PublicationSession, signal: AbortSignal) {
        const op = this.op(id), t = this.target(op.target), target = { owner: op.data.target.owner, repository: op.data.target.repository, repositoryId: op.data.target.repositoryId, repositoryNodeId: op.data.target.repositoryNodeId, visibility: op.data.visibility };
        const observation = await session.observePublicationCapability({ expectedUserId: op.data.target.actorUserId, target, action: op.data.action.kind }, signal);
        if (this.session !== session)
            throw Error('Configured credential instance changed during native preflight');
        const receipt = this.receipt(id, 'capability', { credentialSessionId: session.credentialSessionId, observation });
        this.s.run('INSERT INTO authority_observations VALUES(?,?,?)', randomUUID(), op.target, JSON.stringify({ kind: 'publication', operationId: id, receiptId: receipt, credentialSessionId: session.credentialSessionId, observation }));
        if (observation.state !== 'matched' || !['owned-fixture-only', 'created-private-local-acceptance', 'public-personal-owner/v1'].includes(session.activation))
            throw Error('Actual same-session scope/account/action operands or installed activation unavailable');
        if (hash(t.data.target) !== hash(op.data.target) || t.data.visibility !== op.data.visibility)
            throw Error('Publication target registration changed');
        return { receiptId: receipt, credentialSessionId: session.credentialSessionId, credentialInstanceId: observation.credentialInstanceId };
    }
    private validate(id: string) {
        const op = this.op(id), w = this.work(op.work), t = this.target(op.target), g = this.grant(w.id, t.id, actionClass(op.data.action));
        if (op.data.action.kind === 'create-comment' && op.data.action.purpose === 'contribution-summary') {
            const proof = op.data.contributionSnapshot;
            if (!proof || hash(this.h.contributionSnapshot(proof)) !== hash(proof) || op.data.action.body !== proof.body || hash(op.data.action.parent) !== hash(proof.parent))
                throw Error('Current complete host contribution snapshot missing/stale');
            this.contributionTarget(proof, t.data.target);
            this.noContributionUncertainty(proof, id);
        }
        this.checkOrigin(op);
        if (hash(op.data.actionDescriptor ?? null) !== hash(this.descriptor(op.data.action)))
            throw Error('Missing/stale/action-mismatched installed publication descriptor');
        if (w.epoch !== op.data.epoch || w.generation !== op.data.generation || g.id !== op.grant_id || g.epoch !== op.data.grantEpoch || this.sourceFingerprint(w.id) !== op.data.sourceFingerprint)
            throw Error('Publication source/work/grant tuple changed; renewed explicit fit required');
        if (hash(t.data.target) !== hash(op.data.target) || hash(t.data.carrierPolicy) !== hash(op.data.carrierPolicy))
            throw Error('Publication target/carrier policy changed');
        if (this.h.interactions.impacts(w.id).some(i => i.data.effectHold) && !op.data.judgedAuthorization)
            throw Error('Held publication source has no independent disposition');
        const authorization = op.data.ownerAuthorization ?? op.data.judgedAuthorization;
        if (op.data.judgedAuthorization) {
            const j = this.s.one('SELECT * FROM role_launches WHERE id=?', authorization.launchId);
            if (!j || j.work !== w.id || j.role !== 'adjudicator' || j.status !== 'COMPLETE' || authorization.criteriaHash !== loadCriteriaSync().hash)
                throw Error('Actual current publication judgment missing');
        }
        const sealed = sealPublicationPayload(this.input(op));
        if (sealed.payloadHash !== op.data.payloadHash || Buffer.from(sealed.payloadUtf8).toString('base64') !== op.data.payloadBase64 || authorization?.payloadHash !== sealed.payloadHash || authorization?.sourceFingerprint !== op.data.sourceFingerprint)
            throw Error('Exact owner source/final payload authorization missing or changed');
        if (op.data.evidence)
            this.h.changes.assertCurrentEvidence(op.data.evidence);
        return op;
    }
    dispatch(input: {
        operationId: string;
        signal?: AbortSignal;
    }) { this.h.assertOpen(); return this.own(this.dispatchInner(input)); }
    private async dispatchInner(input: {
        operationId: string;
        signal?: AbortSignal;
    }) {
        const id = input.operationId;
        if (this.op(id).phase === 'CONFIRMED')
            return this.inspectInternal(id);
        if (this.reconciliationContext(id).unsettled)
            throw Error('Original publication producer is unsettled; resolve its original recovery/cleanup before sending');
        try {
            this.inheritSources(this.op(id));
            const op = this.validate(id);
            if (!['RESERVED', 'PREPARED', 'REFUSED'].includes(op.phase))
                throw Error('Publication cannot be blindly resent; inspect/reconcile');
            return await this.run(id, 'dispatch', input.signal, async (session, signal) => {
                const cap = await this.capability(id, session, signal), current = this.validate(id), handle = await session.preparePublication(this.input(current), signal), sealed = session.inspectPreparedPayload(handle);
                if (sealed.sha256 !== current.data.payloadHash || Buffer.from(sealed.jsonUtf8).toString('base64') !== current.data.payloadBase64)
                    throw Error('Fresh native handle changed approved bytes');
                this.s.tx(() => {
                    this.validate(id);
                    if (this.session !== session)
                        throw Error('Configured credential session changed before durable intent');
                    signal.throwIfAborted();
                    this.patch(id, 'INVOKING', { dispatchIntent: Date.now(), credentialSessionId: session.credentialSessionId, capability: cap });
                });
                signal.throwIfAborted();
                this.validate(id);
                if (this.session !== session)
                    throw Error('Configured credential session changed before HTTP handoff');
                const attempted = session.invokePreparedPublication(handle);
                const receipt = await attempted;
                this.receipt(id, 'publication-send', receipt);
                if (receipt.handoff === 'not-started')
                    return this.patch(id, 'REFUSED', { blocked: [receipt.reason], nextAction: 'Explicit current preparation' });
                return this.patch(id, receipt.outcome === 'confirmed' ? 'CONFIRMED' : 'UNKNOWN', { creationHint: receipt.creationHint, resource: receipt.resource, blocked: receipt.outcome === 'confirmed' ? [] : [receipt.reason], nextAction: receipt.outcome === 'confirmed' ? 'Confirmed publication resource only; no landing claim' : 'reconcilePublication READ ONLY; never blindly POST again' });
            });
        }
        catch (error) {
            const op = this.op(id);
            this.inheritSources(op);
            if (op.phase === 'CONFIRMED')
                return this.inspectInternal(id);
            return this.patch(id, op.phase === 'INVOKING' || op.phase === 'UNKNOWN' ? 'UNKNOWN' : 'REFUSED', { blocked: [String(error)], nextAction: 'Restore prerequisite or reconcile possible publication without resend' });
        }
    }
    reconcile(input: {
        operationId: string;
        signal?: AbortSignal;
    }) { this.h.assertOpen(); return this.own(this.reconcileInner(input)); }
    private async reconcileInner(input: {
        operationId: string;
        signal?: AbortSignal;
    }, caller?: ReconciliationCaller) {
        caller?.assert();
        const op = this.op(input.operationId);
        if (op.phase === 'CONFIRMED')
            return this.inspectInternal(op.id);
        if (!['INVOKING', 'UNKNOWN'].includes(op.phase))
            throw Error('Only an actual uncertain publication can reconcile');
        if (this.reconciliationContextFor(op.id, caller).unsettled)
            throw Error('Original publication producer is unsettled; resolve its original recovery/cleanup before another request');
        return this.run(op.id, 'reconcile', input.signal, async (session, signal) => { const result = await session.reconcilePublication({ input: this.input(op), payloadUtf8: Buffer.from(op.data.payloadBase64, 'base64'), payloadHash: op.data.payloadHash, ...(op.data.creationHint ? { creationHint: op.data.creationHint } : {}) }, signal); this.receipt(op.id, 'publication-reconciliation', result); return this.patch(op.id, result.outcome === 'confirmed' ? 'CONFIRMED' : 'UNKNOWN', { resource: result.resource, blocked: result.outcome === 'confirmed' ? [] : [result.reason], nextAction: result.outcome === 'confirmed' ? 'Exact resource observed; original causal transport evidence retained' : 'Bounded targeted read/operator recovery; no POST retry' }); }, caller);
    }
    private findingProjection(op: any) {
        const rows = this.s.all("SELECT f.*,l.data AS launch_data,o.data AS output_data FROM finding_occurrences f JOIN role_launches l ON l.id=json_extract(f.data,'$.launchId') JOIN role_outputs o ON o.id=f.output WHERE f.work=? AND json_extract(l.data,'$.stage')='publication-payload-fit' AND json_extract(l.data,'$.operationId')=? ORDER BY f.rowid", op.work, op.id);
        const all = rows.map(row => { const d = parse(row.data), latest = this.s.one('SELECT status,data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', row.id), obligation = this.s.one('SELECT data FROM obligations WHERE id=?', row.id); return { occurrenceId: row.id, launchId: d.launchId, nativeEntryId: parse(row.output_data).nativeEntryId ?? null, requirementId: d.finding?.requirementId ?? null, severity: d.finding?.severity ?? null, description: d.finding?.description ?? null, evidence: d.finding?.evidence ?? [], disposition: latest ? { kind: latest.status, ...parse(latest.data) } : null, state: obligation ? parse(obligation.data).state : 'unknown' }; });
        const complete = Buffer.byteLength(JSON.stringify(all)) <= 256 * 1024;
        return { complete, total: all.length, omitted: complete ? 0 : all.length, rows: complete ? all : [], unavailable: complete ? null : 'Exact finding projection exceeds256KiB; use retained validated native history for complete inspection; no strings/observations were silently truncated', retainedLaunchIds: [...new Set(rows.map(r => parse(r.data).launchId))] };
    }
    inspect(id: string) { this.h.assertOpen(); return this.inspectInternal(id); }
    list(options: {
        limit?: number;
        before?: string;
    } = {}) { this.h.assertOpen(); return listRetainedPublications(this.s, options, id => this.inspectInternal(id)); }
    inspectRetained(id: string) { this.h.assertOpen(); return retainedPublication(this.s, id, operation => this.inspectInternal(operation)); }
    preparationContext(id: string) {
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded publication unavailable for preparation recovery');
        const op = this.op(id), target = this.target(op.target), work = this.work(op.work);
        if (op.phase !== 'REFUSED' || op.data.dispatchIntent || !op.data.ownerAuthorization || op.data.origin || !op.data.contributionSnapshot)
            throw Error('Only an unsent REFUSED owner summary can resume preparation; uncertain sends require original read reconciliation');
        if (work.state !== 'ACTIVE')
            throw Error('Original work requires its explicit recovery; preparation cannot revive cancelled/interrupted/unknown work');
        const source = (sourceId: string) => this.s.one("SELECT conversation,CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END origin,CASE WHEN length(CAST(raw AS BLOB))<=1048576 THEN raw ELSE NULL END raw FROM sources WHERE id=?", sourceId);
        const decode = (value: unknown) => {
            if (typeof value !== 'string')
                throw Error('Original bounded owner source unavailable');
            let parsed;
            try {
                parsed = parse(value);
            }
            catch {
                throw Error('Original owner source unavailable; inspect its retained source record');
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                throw Error('Original owner source unavailable');
            return parsed;
        };
        if (typeof op.data.ownerAuthorization.sourceId !== 'string')
            throw Error('Original owner authorization source unavailable');
        const root = source(work.source), authorization = source(op.data.ownerAuthorization.sourceId);
        if (!root || !authorization)
            throw Error('Original owner summary sources unavailable');
        const rootOrigin = decode(root.origin), rootRequest = decode(root.raw), origin = decode(authorization.origin), request = decode(authorization.raw), uid = process.getuid?.() ?? null;
        if (!root || root.conversation !== null || rootOrigin.kind !== 'owner-contribution-summary-request' || rootOrigin.uid !== uid || rootOrigin.targetId !== op.target || rootRequest?.request?.resourceId !== op.data.contributionSnapshot.resourceId || rootRequest?.request?.targetId !== op.target || rootRequest?.catalogueProof?.lineageKey !== op.data.contributionSnapshot.lineageKey || rootRequest.bodyOrigin !== 'host-generated-not-owner-authored' ||
            !authorization || authorization.conversation !== null || origin.kind !== 'owner-publication-action' || origin.uid !== uid || origin.workId !== op.work || origin.payloadHash !== op.data.payloadHash || op.data.ownerAuthorization.payloadHash !== op.data.payloadHash || op.data.ownerAuthorization.sourceFingerprint !== op.data.sourceFingerprint || request.targetId !== op.target || hash(request.action) !== hash(op.data.action) || hash(request.catalogueProof) !== hash(op.data.contributionSnapshot) || request.bodyOrigin !== 'host-generated-not-owner-authored' || request.request?.resourceId !== op.data.contributionSnapshot.resourceId || request.request?.revisionId !== op.data.contributionSnapshot.revisionId)
            throw Error('Original owner summary source/authorization correspondence unavailable');
        const grant = this.s.one('SELECT root,data FROM effect_delegations WHERE id=?', op.grant_id), grantData = grant && parse(grant.data);
        if (!grant || grant.root !== op.work || grantData.scope !== 'work' || grantData.ownerUid !== uid || parse(work.data).kind !== 'publication')
            throw Error('Original owner summary grant correspondence unavailable');
        if (hash(target.data.target) !== hash(op.data.target) || hash(target.data.carrierPolicy) !== hash(op.data.carrierPolicy) || target.data.visibility !== op.data.visibility)
            throw Error('Original publication target or carrier policy changed; preparation cannot replace its scope');
        const proof = this.h.currentContributionSnapshot(op.data.contributionSnapshot.resourceId);
        if (proof.lineageKey !== op.data.contributionSnapshot.lineageKey)
            throw Error('Original summary native parent lineage changed');
        this.contributionTarget(proof, target.data.target);
        this.noContributionUncertainty(proof, id);
        const duplicate = this.contributionDuplicate(proof, id);
        if (duplicate)
            throw Error('Current summary revision already belongs to original publication ' + duplicate.id + '; inspect that original instead of replacing identity');
        if (this.grant(op.work, op.target, actionClass(op.data.action)).id !== op.grant_id)
            throw Error('Original publication grant changed');
        if (this.h.interactions.impacts(op.work).some(i => i.data.effectHold))
            throw Error('Original consequential source requires independent disposition before preparation');
        return { operationId: id, workId: op.work, targetId: op.target, target: target.data.target, visibility: target.data.visibility, carrierPolicy: target.data.carrierPolicy,
            previous: op.data.contributionSnapshot, current: proof, context: this.reconciliationContext(id) };
    }
    dispatchContext(id: string) {
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded publication unavailable for complete carrier review');
        const op = this.validate(id);
        if (op.phase !== 'RESERVED' || op.data.dispatchIntent)
            throw Error('Only an unsent RESERVED original can enter reviewed dispatch; uncertain originals require read-only reconciliation');
        const payloadUtf8 = Buffer.from(op.data.payloadBase64, 'base64').toString('utf8');
        return { operationId: id, workId: op.work, targetId: op.target, target: op.data.target, action: op.data.action, visibility: op.data.visibility,
            payloadUtf8, payloadBytes: Buffer.byteLength(payloadUtf8), payloadHash: op.data.payloadHash,
            authorization: op.data.ownerAuthorization ?? op.data.judgedAuthorization, carrierPolicyFingerprint: hash(op.data.carrierPolicy), allowedMentions: op.data.carrierPolicy.allowedMentions,
            context: this.reconciliationContext(id) };
    }
    reconciliationContext(id: string) { return this.reconciliationContextFor(id); }
    private reconciliationContextFor(id: string, caller?: ReconciliationCaller) {
        caller?.assert();
        this.h.assertOpen();
        const op = this.op(id), w = this.s.one('SELECT id,lineage,state,epoch,generation FROM works WHERE id=?', op.work), budget = w && this.s.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'execution');
        if (!w || !budget || ![budget.limit, budget.consumed, budget.reserved].every(n => Number.isSafeInteger(n) && n >= 0) || budget.consumed + budget.reserved > budget.limit)
            throw Error('Original publication allowance unavailable');
        return { operationId: id, workId: w.id, targetId: op.target, payloadHash: op.data.payloadHash, workState: w.state, epoch: w.epoch, generation: w.generation, lineage: w.lineage, execution: budget,
            // A refunded queue is settled only with the matching never-admitted
            // run and cancelled, non-admitted lease. Neither label alone is proof.
            unsettled: (!caller && this.h.busy(w.id)) || !!this.s.one(`${cancelledCapacitySettlement} SELECT id FROM runs WHERE work=? AND id<>? AND
                ((reservation<>'consumed' AND NOT EXISTS(SELECT 1 FROM cancelled WHERE run=runs.id)) OR phase NOT IN ('SETTLED','INTERRUPTED') OR
                 CASE WHEN json_valid(data) THEN json_extract(data,'$.cleanup') LIKE 'quarantined%' OR json_extract(data,'$.cleanup') IN ('unknown','unavailable') ELSE 1 END)
            UNION ALL SELECT id FROM capacity_leases WHERE work=? AND state<>'RELEASED'
                AND NOT EXISTS(SELECT 1 FROM cancelled WHERE lease=capacity_leases.id)
                AND NOT (id=? AND run=? AND state IN ('ADMITTED','ACTIVE')) LIMIT 1`, w.id, w.id, caller?.runId ?? '', w.id, caller?.capacityId ?? '', caller?.runId ?? '') };
    }
    private inspectInternal(id: string): PublicationView { const op = this.op(id), send = this.s.one("SELECT data FROM effect_receipts WHERE operation=? AND kind='publication-send' ORDER BY rowid DESC LIMIT 1", id), transport = send ? parse(send.data) : null; return { operationId: id, workId: op.work, targetId: op.target, action: op.data.action.kind, purpose: op.data.action.kind === 'create-draft-pr' ? 'draft' : op.data.action.kind === 'create-comment' ? op.data.action.purpose : 'bootstrap', phase: op.phase, findingProjection: this.findingProjection(op), relatedBlockerIds: this.h.changes.publicationBlockers(op.work, op.id).map(o => o.id), payloadHash: op.data.payloadHash, receiptIds: this.s.all('SELECT id FROM effect_receipts WHERE operation=? ORDER BY rowid', id).map(r => r.id), resource: op.data.resource ?? null, transportOutcome: transport ? (transport.handoff === 'not-started' ? 'not-started' : transport.outcome === 'confirmed' ? 'native-success' : 'uncertain') : op.data.dispatchIntent ? 'uncertain' : null, observedOutcome: op.data.resource ? 'resource-matches' : op.phase === 'UNKNOWN' ? 'unknown' : 'not-observed', activation: op.data.activation ?? 'disabled', blocked: op.data.blocked ?? [], nextAction: op.data.nextAction ?? '' }; }
    private own<T>(task: Promise<T>): Promise<T> { this.tasks.add(task); void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task)); return task; }
    private async run<T>(id: string, phase: string, outer: AbortSignal | undefined, body: (session: PublicationSession, signal: AbortSignal) => Promise<T>, caller?: ReconciliationCaller): Promise<T> {
        this.h.assertInteractionAdmission();
        const op = this.op(id), w = this.work(op.work), session = this.session;
        if (!session || !['owned-fixture-only', 'created-private-local-acceptance', 'public-personal-owner/v1'].includes(session.activation))
            throw Error('HOSTED_PUBLICATION_DISABLED: supported actual activation absent');
        caller?.assert();
        if (caller && phase !== 'reconcile')
            throw Error('Borrowed caller only permits original reconciliation reads');
        if (this.aborts.has(id))
            throw Error('Original publication request already active');
        if (!caller && this.h.busy(w.id))
            throw Error('Publication work busy');
        if (['UNKNOWN', 'CANCELLED', 'INTERRUPTED'].includes(w.state) && phase !== 'reconcile')
            throw Error('Publication work unavailable');
        const abort = new AbortController(), stop = () => abort.abort(outer?.reason);
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), run = randomUUID();
        this.s.tx(() => {
            caller?.assert();
            if (caller && this.reconciliationContextFor(id, caller).unsettled)
                throw Error('Original publication producer is unsettled');
            const budget = this.s.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'", w.lineage);
            if (budget.consumed + budget.reserved >= budget.lim)
                throw Error('Retained publication execution allowance exhausted');
            this.s.run("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'", w.lineage);
            this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, w.id, w.epoch, w.generation, 'RUNNING', path.join(this.h.options.installationHome, 'state'), 'reserved', JSON.stringify({ kind: 'publication-http', operationId: id, phase, controllerPid: process.pid }));
        });
        if (!caller)
            this.h.register(w.id, { abort });
        this.aborts.set(id, abort);
        outer?.addEventListener('abort', stop, { once: true });
        if (outer?.aborted)
            stop();
        let result: T;
        try {
            result = await body(session, signal);
            return result;
        }
        finally {
            this.s.tx(() => { this.h.settleBudget(run); this.h.patchRun(run, 'SETTLED', { cleanup: 'in-process-http-settled' }); });
            this.aborts.delete(id);
            if (!caller)
                this.h.unregister(w.id);
            outer?.removeEventListener('abort', stop);
        }
    }
    cancel(workIds: ReadonlySet<string>) {
        for (const row of this.s.all("SELECT id,work,phase FROM effect_operations WHERE json_extract(data,'$.kind')='publication'")) {
            if (!workIds.has(row.work))
                continue;
            this.aborts.get(row.id)?.abort();
            if (row.phase !== 'CONFIRMED')
                this.patch(row.id, ['INVOKING', 'UNKNOWN'].includes(row.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Publication work cancelled'], nextAction: 'Reconcile possible effect; cancellation cannot prove absence' });
        }
    }
    recoverRun(run: any) {
        const data = parse(run.data), op = this.op(data.operationId);
        this.s.tx(() => {
            this.h.settleBudget(run.id);
            this.h.patchRun(run.id, 'INTERRUPTED', { cleanup: 'owner-process-ended-http-outcome-unknown' });
            if (this.work(run.work).state !== 'CANCELLED')
                this.s.run('UPDATE works SET state=? WHERE id=?', 'INTERRUPTED', run.work);
            if (op.phase === 'INVOKING')
                this.patch(op.id, 'UNKNOWN', { blocked: ['Owner restarted after durable HTTP intent'], nextAction: 'Read-only reconciliation without POST' });
        });
    }
    recover() {
        for (const run of this.s.all("SELECT * FROM runs WHERE json_extract(data,'$.kind')='publication-judgment' AND phase='INTERRUPTED'")) {
            const rd = parse(run.data);
            if (rd.operationId) {
                const op = this.op(rd.operationId);
                if (!['CONFIRMED', 'INVOKING', 'UNKNOWN'].includes(op.phase))
                    this.patch(op.id, 'REFUSED', { blocked: ['Interrupted actual publication judgment; retained raw history/diagnosis requires explicit same-operation retry'], nextAction: 'Reconcile retained native finding records then explicitly re-enter SAME operation' });
            }
        }
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='publication' AND phase!='CONFIRMED'"))
            this.inheritSources({ ...row, data: parse(row.data) });
        for (const row of this.s.all("SELECT id FROM effect_operations WHERE phase='INVOKING' AND json_extract(data,'$.kind')='publication'"))
            this.patch(row.id, 'UNKNOWN', { blocked: ['Owner restarted after durable publication intent'], nextAction: 'reconcilePublication READ ONLY; no POST retry' });
        this.recoverAssignmentResults();
    }
    private recoverAssignmentResults() {
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='publication' AND json_extract(data,'$.assignmentId') IS NOT NULL")) {
            const op = { ...row, data: parse(row.data) }, a = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', op.data.assignmentId);
            if (!a || !['QUEUED', 'RUNNING'].includes(a.state))
                continue;
            const assignment = parse(a.data);
            if (a.work !== op.work || a.target !== op.data.conversationId || assignment.operation !== 'effect-publication' || assignment.effectOperationId !== op.id ||
                this.s.one('SELECT work FROM conversation_state WHERE conversation=?', a.target)?.work !== op.work)
                continue;
            if (['PREPARED', 'RESERVED'].includes(op.phase))
                this.patch(op.id, 'REFUSED', { blocked: ['Owner restarted before durable publication handoff; retained task requires explicit reentry'], nextAction: 'Explicit same-operation continuation; no automatic paid retry' });
            settleRecoveredEffectAssignment(this.s, op.id, this.inspectInternal(op.id));
        }
    }
    async close() {
        for (const abort of this.aborts.values())
            abort.abort();
        while (this.tasks.size)
            await Promise.allSettled([...this.tasks]);
    }
}

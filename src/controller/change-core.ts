import { retainedDispositionRequests } from '../workflow/adjudication-accounting.js';
import { buildDispositionHistory, relevantObligationStates } from '../workflow/disposition-history.js';
import { historicalPlanInputId, prepareHistoricalPlans } from '../workflow/historical-plans.js';
import { roleInputEvidenceManifests, type RoleInputEvidenceSnapshot } from '../workflow/role-input-evidence.js';
import { restoreFindingBodies } from '../workflow/finding-body-presentation.js';
import { nativeAdministrativeScopeView } from './scope-projection.js';
import { projectHistoricalCensus } from './historical-census.js';
import { roleFraming } from '../workflow/role-framing.js';
import { ModelContextBudgetError, modelContextFailureCode, type ModelContextFailureCode } from '../pi/context-budget-error.js';
import { captureCriteriaRefreshFailure } from './original-wait-outcome.js';
import { softwareEvidenceIdentity } from './effect-types.js';
import { finiteVerificationSupport, manifestScopeEvidence, validateScopeManifest, type ScopeStrategy } from './verification-strategies.js';
import { recordedResultChanges, resultEntries } from './change-result.js';
import { defaultConversationExecutionLimit } from './work-recovery.js';
import { nextChangeStage, changeStageRoles } from './change-stage.js';
import { adjudicationDecisionReferences, planningDecisionCarry, historicalRoleInputBody, planningProposalApproval as readProposalApproval, planningVerificationProfile as readPlanningVerificationProfile } from '../workflow/role-input.js';
import { ownerRootActivation } from './owner-activation.js';
import { captureApplicationModelOperation, captureWorkModelBaseline, subjectRoleModel, assertOrdinaryEffectSource, type ApplicationModelOperation, type ApplicationRoleModelRequest, type WorkModelBaseline } from './application-model.js';
import type { PiModelSelection } from '../pi/session.js';
import { captureSessionPreferences } from '../pi/session-preferences.js';
import { captureNativeModelSelection, modelConfigurationIdentity } from '../pi/model-identity.js';
import { parseUniqueJson } from '../workflow/json.js';
import { coverageIssue, caseDescriptor, compareCases, changedCaseIds } from './check-cases.js';
import { projectProtection, scopeProtection } from './protection.js';
import type { CapacityRequest, CapacityLease, NativeIdentity, NativeLifecycle } from './interaction-types.js';
import fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { parseCheckOutput, parseRoleOutput, assertApprovedProposal, implementationCarryProposals, assertFindingCore, assertFinding } from '../workflow/protocol.js';
import { rawFindings } from './raw-findings.js';
import { roleMaterialFindings } from './role-material-findings.js';
import type { CurrentEvidence, DerivedCandidateInput, SourceSaveInputSnapshot } from './effect-types.js';
import { loadCriteria, loadCriteriaSync } from './criteria.js';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createScope, type ContainerScope } from '../execution/container-scope.js';
import { validateManifest, type Manifest } from './capture.js';
import { privateDirectory, privateFile, inside } from './ownership.js';
import { hash, effective, freeze, materialize, delta, sources, safePath } from './change-files.js';
import { nativeCheckpoint, readSelectedRoleOutput } from './history.js';
import { nativeRoleEntries, nativeRoleMaterial, nativeRoleIntentReceipt, unownedNativeSelector, readUnownedNativeMaterial, readUnownedNativeMaterials, type NativeRoleIntentReceipt } from '../workflow/native-role-output.js';
import { assertNativeFormatterSchema, structuredOutputContext, type StructuredOutputIntent } from '../pi/structured-output.js';
import { projectSelectedReview, boundSelectedReviews, reviewEvidenceHold, REVIEW_EVIDENCE_LIMITS } from './selected-review-evidence.js';
import { ControllerError, type ControllerOptions } from './types.js';
import { sharePreviousCriteriaText } from '../workflow/criteria-text.js';
import type { Store } from './store.js';
import { providerUsageLimit } from '../workflow/provider-failure.js';
import { defaultRoleBounds } from '../workflow/execution-bounds.js';
import type { BeginChangeOptions, ChangeOperation, ChangeView, DriveChangeOptions, ChangeResultView, VerificationEvidenceView, PlanningFailureView } from './change-types.js';
import type { Role, RoleResult, RoleExecution, InputBundle, PlanProposal, ImplementationCarry, VerificationStrategy, PlanningVerificationProfile } from '../workflow/types.js';
interface VerificationRead {
    strategies(): VerificationStrategy[] | undefined;
}
const uncertainSettlementInspection = (workId: string) => ({
    blocker: 'Original execution cleanup is unconfirmed; planning and further execution remain held.',
    nextAction: `Inspect original execution ownership and cleanup in /work ${workId}. ` +
        'Restore the original runtime route and confirm settlement before explicitly continuing this same work. ' +
        'A current missing-container response alone cannot clear an uncertain creation or native process. Original history and consumed allowance remain retained.',
});
interface Handle {
    abort: AbortController;
    scope?: ContainerScope;
    done?: Promise<unknown>;
}
export interface ChangeHost {
    assertApplicationSource?(model: PiModelSelection): void;
    /** Application account mutation must exclude new governed producers too. */
    assertApplicationAdmission?(work?: string): void;
    resolveApplicationRole?(request: ApplicationRoleModelRequest): Promise<PiModelSelection>;
    applicationModelResolverInstalled?(): boolean;
    acquireCapacity(request: CapacityRequest): Promise<CapacityLease>;
    allocateRole(options: {
        workId: string;
        runId: string;
        launchId: string;
        role: string;
        purpose?: string;
    }): NativeIdentity;
    nativeLifecycle: NativeLifecycle;
    coordination(identity: NativeIdentity): Omit<import('../pi/coordination.js').PiCoordination, 'wait'>;
    sourceImpacts(work: string): any[];
    nativeCleanup(identity: NativeIdentity, receipt: {
        cleanup: string;
        settled: boolean;
    }): void;
    store: Store;
    options: ControllerOptions;
    state: string;
    assertOpen(): void;
    admit(project: string, kind: string, raw: string, invocation?: Record<string, unknown>, baseline?: WorkModelBaseline, initialize?: (workId: string) => void): any;
    entry(runId: string): void;
    patchRun(id: string, phase: string, data: Record<string, unknown>): void;
    settleBudget(id: string): void;
    register(work: string, handle: Handle): void;
    unregister(work: string): void;
    busy(work: string): boolean;
    cancel(work: string): Promise<void>;
    reconcile(run: string, work: string): Promise<string>;
    recordHistory(run: string, ref: string, id: string): void;
    recordModelDispatch(run: string, cp: any): void;
    observe(run: string, data: Record<string, unknown>): void;
}
const parse = (v: string) => JSON.parse(v);
const bounded = (n: number, label: string) => {
    if (!Number.isSafeInteger(n) || n < 1 || n > 1000)
        throw new ControllerError('INVALID_LIMIT', `Invalid ${label}`, 'Use a finite1..1000 limit');
    return n;
};
/** Only reserve can produce this pre-admission execution-budget refusal. */
class ExecutionAdmissionRefusal extends ControllerError {
}
const resolutionRoles = new Set<Role>(['challenger', 'adjudicator', 'reviewer', 'confirmer']);
const materialDiagnosisFinding = (output: string) => ({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: 'Exact unowned public material requires independent raw assessment; original claims remain separately accountable', evidence: [output] });
const producerDiagnosisFinding = (output: string) => ({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: 'Unusable producer raw output requires independent diagnosis; ambiguous material observations cannot be erased by a replacement', evidence: [output] });
/** Decode each producer with its original captured decision grammar and identities. */
function capturedRoleConstraints(role: Role, metadata: Record<string, unknown>) {
    const decisionCarry = planningDecisionCarry(role, metadata);
    const decisionReferences = adjudicationDecisionReferences(role, metadata);
    return { ...(decisionCarry ? { decisionCarry } : {}), ...(decisionReferences ? { decisionReferences } : {}) };
}
/** Invalid capture is an unusable decoder, never legacy grammar or lost raw material. */
function parseCapturedRoleOutput(raw: string, role: Role, metadata: Record<string, unknown>) {
    try { return parseRoleOutput(raw, role, [], capturedRoleConstraints(role, metadata)); }
    catch { return { value: null, issues: ['Original role carry/decision format unavailable'] }; }
}
export class ChangeCore {
    private executionAdmissionHolds = new WeakSet<ChangeView>();
    constructor(private h: ChangeHost) {
    }
    private operations = new Map<string, {
        epoch: number;
        generation: number;
        admittedState: 'ACTIVE' | 'DELIVERED';
        versions: string;
        sourceVersion: string;
        handle: Handle;
    }>();
    private captureCompanion<T extends {
        applicationModel?: ApplicationModelOperation;
    }>(options: T): T {
        return { ...options, ...(Object.hasOwn(options, 'applicationModel') ? { applicationModel: captureApplicationModelOperation(options.applicationModel) } : {}) };
    }
    private captureOperation<T extends {
        applicationModel?: ApplicationModelOperation;
        model?: PiModelSelection;
        sessionPreferences?: import('../pi/session-preferences.js').SessionQueuePreferences;
    }>(options: T): T {
        const captured = this.captureCompanion(options);
        if (Object.hasOwn(captured, 'applicationModel') && Object.hasOwn(captured, 'model'))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: application operation cannot contain an explicit recipe');
        if (!Object.hasOwn(captured, 'applicationModel') && Object.hasOwn(captured, 'sessionPreferences'))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: queue preferences require an application operation');
        if (Object.hasOwn(captured, 'model') && !captured.model)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: missing explicit model recipe');
        return { ...captured, ...(captured.model ? { model: captureNativeModelSelection(captured.model) } : {}),
            ...(Object.hasOwn(captured, 'sessionPreferences') ? { sessionPreferences: captureSessionPreferences(captured.sessionPreferences) } : {}) };
    }
    /** Validate a retained subject's mode before an effect mutates its ledger. */
    captureModelOperation<T extends ChangeOperation>(options: T): T {
        this.h.assertOpen();
        const captured = this.captureOperation(options);
        this.applicationBinding(captured);
        if (!Object.hasOwn(captured, 'applicationModel') && !captured.model)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit subject model recipe required');
        return captured;
    }
    private applicationBinding(options: {
        workId: string;
        applicationModel?: ApplicationModelOperation;
        model?: PiModelSelection;
    }) {
        const subject = subjectRoleModel(this.s, options.workId), hasBaseline = !!subject.baseline, hasTag = Object.hasOwn(options, 'applicationModel');
        if (subject.explicit && (!options.model || options.model.provider !== subject.explicit.provider || options.model.modelId !== subject.explicit.modelId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit recipe differs from ordinary subject');
        if (!hasBaseline && !hasTag)
            return undefined;
        if (!hasBaseline || !hasTag)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: retained application work requires its exact operation binding');
        const baseline = subject.baseline!, tag = captureApplicationModelOperation(options.applicationModel);
        if (baseline.revision !== tag.baselineRevision)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: work model revision changed');
        if (!this.h.resolveApplicationRole || this.h.applicationModelResolverInstalled?.() === false)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: application resolver is not installed');
        return { baseline, tag };
    }
    private async selectRoleModel(options: ChangeOperation, role: Role, requireIdle = false) {
        const binding = this.applicationBinding(options);
        if (!binding) {
            if (!options.model)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit model recipe is required');
            return { model: captureNativeModelSelection(options.model), mode: { kind: 'explicit' } as Record<string, unknown>, assertCurrent: () => { this.applicationBinding(options); } };
        }
        const before = this.work(options.workId), baseline = JSON.stringify(binding.baseline), versions = this.roleModelBindings(options.workId), impacts = hash(this.h.sourceImpacts(options.workId).map(input => [input.input_id, input.revision, input.source]));
        const assertCurrent = () => {
            this.h.assertOpen();
            this.h.assertApplicationAdmission?.(options.workId);
            options.signal?.throwIfAborted();
            const now = this.work(options.workId), current = this.applicationBinding(options);
            if (!current || JSON.stringify(current.baseline) !== baseline || now.epoch !== before.epoch || now.generation !== before.generation || now.state !== before.state ||
                this.roleModelBindings(options.workId) !== versions || hash(this.h.sourceImpacts(options.workId).map(input => [input.input_id, input.revision, input.source])) !== impacts || requireIdle && this.h.busy(options.workId))
                throw Error('APPLICATION_MODEL_UNAVAILABLE: role target or captured baseline changed during resolution');
            this.guard(options.workId);
        };
        assertCurrent();
        const sessionPreferences = captureSessionPreferences(options.sessionPreferences);
        const selected = await this.h.resolveApplicationRole!({ workId: options.workId, epoch: before.epoch, generation: before.generation, role,
            baseline: structuredClone(binding.baseline), ...(sessionPreferences ? { sessionPreferences } : {}) });
        assertCurrent();
        const model = captureNativeModelSelection(selected);
        const assertSource = () => {
            if (this.h.assertApplicationSource)
                this.h.assertApplicationSource(model);
            else if (!model.managed || model.managed.home !== this.h.options.installationHome)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: resolver returned an incompatible application source');
        };
        assertSource();
        return { model, mode: { kind: 'application', version: 1, baselineRevision: binding.baseline.revision } as Record<string, unknown>,
            assertCurrent: () => { assertCurrent(); assertSource(); } };
    }
    private bindings(work: string) {
        const r = this.row(work);
        return hash([r.base, r.candidate, r.plan, r.verification, r.data.contractsVersion, r.data.requirementVersion ?? null]);
    }
    private roleModelBindings(work: string) {
        const subject = subjectRoleModel(this.s, work);
        return subject.ordinary ? hash(subject.fingerprint) : this.bindings(work);
    }
    private guard(work: string) {
        const op = this.operations.get(work);
        if (!op)
            return;
        const w = this.work(work);
        if (op.handle.abort.signal.aborted || w.state !== op.admittedState || w.epoch !== op.epoch || w.generation !== op.generation || this.bindings(work) !== op.versions || op.sourceVersion !== hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])))
            throw new Error('Operation interrupted or selected input versions changed; late artifacts are history only');
    }
    private sameNonCandidateBindings(work: string, input: any) {
        const r = this.row(work);
        return input?.base === r.base && input?.contracts === r.data.contractsVersion && (input?.requirements ?? null) === (r.data.requirementVersion ?? null) && input?.plan === r.plan && input?.verification === r.verification;
    }
    private acceptOwnVersions(work: string) {
        const op = this.operations.get(work);
        if (op)
            op.versions = this.bindings(work);
    }
    private async operation(options: {
        workId: string;
        signal?: AbortSignal;
        applicationModel?: ApplicationModelOperation;
    }, stage: string, body: () => Promise<ChangeView>, deliveredCoverage?: {epoch:number;generation:number;versions:string;sourceVersion:string}) {
        const work = options.workId;
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(work);
        this.applicationBinding(options);
        if (this.h.busy(work) || this.operations.has(work))
            throw new Error('Work busy');
        if (stage !== 'recover') {
            if (!await this.restoreSettledRoleMaterial(options)) return this.inspect(work);
            this.h.assertOpen(); this.applicationBinding(options); this.h.assertApplicationAdmission?.(work);
            options.signal?.throwIfAborted();
            if (this.h.busy(work) || this.operations.has(work)) throw Error('Work busy');
        }
        if (!['recover', 'plan', 'source-fit'].includes(stage) && this.coverageHoldReason(work))
            return this.inspect(work);
        if (stage !== 'recover' && this.criteriaHoldReason(work))
            return this.inspect(work);
        if (stage !== 'recover' && this.pending(work).some(o => o.kind === 'raw-findings-incomplete'))
            throw new Error('Known native findings exceed the initial bounded extraction profile; restore supported extraction from exact native history before any new paid stage');
        if (stage !== 'recover' && this.pending(work).some(o => o.kind === 'diagnostic' || o.kind === 'interrupted-producer'))
            throw new Error('Unusable producer diagnosis requires explicit drive/resume recovery');
        const owner = this.work(work);
        if (deliveredCoverage && (stage !== 'recover' || owner.state !== 'DELIVERED' || owner.epoch !== deliveredCoverage.epoch || owner.generation !== deliveredCoverage.generation || this.bindings(work) !== deliveredCoverage.versions || hash(this.h.sourceImpacts(work).map(i=>[i.input_id,i.revision,i.source])) !== deliveredCoverage.sourceVersion))
            throw Error('Delivered material coverage source changed before admission');
        if (owner.state !== 'ACTIVE' && !deliveredCoverage)
            throw new Error('Explicit drive/resume required for inactive work');
        const handle: Handle = { abort: new AbortController() }, op = { epoch: owner.epoch, generation: owner.generation, admittedState: (deliveredCoverage ? 'DELIVERED' : 'ACTIVE') as 'ACTIVE'|'DELIVERED', versions: this.bindings(work), sourceVersion: hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])), handle };
        this.operations.set(work, op);
        this.h.register(work, handle);
        const stop = () => {
            if (deliveredCoverage) handle.abort.abort();
            else void this.h.cancel(work).catch(() => handle.abort.abort());
        };
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        try {
            this.guard(work);
            return await body();
        }
        catch (error) {
            if (deliveredCoverage) throw error;
            return this.blocked(work, String(error), stage);
        }
        finally {
            options.signal?.removeEventListener('abort', stop);
            this.operations.delete(work);
            this.h.unregister(work);
        }
    }
    async plan(options: ChangeOperation) {
        options = this.captureOperation(options);
        return this.operation(options, 'plan', () => this.planInner(options));
    }
    async implement(options: ChangeOperation, repair = false) {
        options = this.captureOperation(options);
        return this.operation(options, repair ? 'repair' : 'implement', () => this.implementInner(options, repair));
    }
    private restoreBoundedPlan(work: string) {
        const r = this.row(work), owner = this.work(work);
        if (r.phase !== 'BLOCKED' || r.data.resumeStage !== 'implement' || r.data.nextAction !== 'Explicit resume within retained allowance' || hash(r.data.blocked) !== hash(['Bounded drive step limit reached']))
            throw new Error('Exact retained bounded planning checkpoint required');
        if (owner.state !== 'ACTIVE' || !r.base || !r.plan || !r.verification || !r.data.requirementVersion || r.candidate || r.data.criteriaRefresh || this.h.sourceImpacts(work).some(input => input.data.effectHold))
            throw new Error('Bounded planning checkpoint no longer current');
        this.restoreAcceptedPlan(work);
    }
    private restoreAcceptedPlan(work: string, sourceCorresponds = (digest: string) => digest === hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]))) {
        const r = this.row(work), owner = this.work(work);
        if (owner.state !== 'ACTIVE' || !r.base || !r.plan || !r.verification || !r.data.requirementVersion || r.candidate || r.data.criteriaRefresh || this.h.sourceImpacts(work).some(input => input.data.effectHold))
            throw new Error('Accepted planning checkpoint no longer current');
        const base = this.version(r.base), plan = this.version(r.plan), verification = this.version(r.verification), requirements = this.version(r.data.requirementVersion);
        if ([base, plan, verification, requirements].some(v => v.work !== work) || base.kind !== 'base' || plan.kind !== 'plan' || verification.kind !== 'verification' || requirements.kind !== 'requirements' || hash(plan.data.plan) !== plan.hash || hash(verification.data.verification) !== verification.hash || hash(plan.data.plan.verification) !== verification.hash || hash({ requirements: plan.data.plan.requirements, intent: plan.data.plan.intent }) !== requirements.hash || requirements.data.decisionLaunch !== plan.data.decisionLaunch || hash({ requirements: requirements.data.requirements, intent: requirements.data.intent }) !== requirements.hash)
            throw new Error('Bounded planning checkpoint selected versions mismatch');
        let proposed: any, challenge: any;
        for (const [id, role, stage] of [[plan.data.authorLaunch, 'planner', 'planning'], [plan.data.challengeLaunch, 'challenger', 'planning-challenge'], [plan.data.decisionLaunch, 'adjudicator', 'planning-adjudication']]) {
            const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', id), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = launch && parse(launch.data), rd = run && parse(run.data);
            const outputs = launch ? this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", id) : [];
            const output = outputs.length === 1 ? outputs[0] : null, metadata = output && parse(output.data), protocol = output && parseCapturedRoleOutput(output.raw, role as Role, ld).value;
            if (!launch || !run || !output || launch.work !== work || run.work !== work || launch.role !== role || ld.stage !== stage || launch.status !== 'COMPLETE' || launch.epoch !== owner.epoch || run.epoch !== owner.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !sourceCorresponds(rd.sourceInputHash) || ld.inputVersions?.base !== r.base || ld.inputVersions?.candidate !== null || ld.inputVersions?.contracts !== r.data.contractsVersion || !metadata.nativeEntryId || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.historyRef !== rd.historyRef || ld.historyRef !== rd.historyRef || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || hash(metadata.protocol) !== hash(protocol))
                throw new Error('Bounded planning checkpoint selected producer unavailable or stale');
            if (role === 'planner')
                proposed = protocol.plan;
            if (role === 'challenger') {
                if (hash(ld.planProposal) !== hash(proposed))
                    throw new Error('Bounded planning checkpoint challenge selected another proposal');
                challenge = protocol;
            }
            if (role === 'adjudicator' && (hash(ld.planProposal) !== hash(proposed) || hash(ld.challenge) !== hash(challenge) || !protocol.planAccepted || protocol.ownerDecisionRequired?.length || hash(this.acceptedPlanningProposal(work, id, protocol, plan.data.authorLaunch) ?? null) !== plan.hash))
                throw new Error('Bounded planning checkpoint lacks matching independent acceptance');
        }
        this.planningValid(plan.data.plan, work);
        this.guard(work);
        this.phase(work, 'PLAN_READY', { blocked: [], resumeStage: null, nextAction: 'implementChange' });
    }
    /** Later directions may preserve a plan only through their actual independent explanation receipts. */
    private retrySourceCorresponds(work: string, digest: string) {
        const inputs = this.h.sourceImpacts(work), tuples = inputs.map(input => [input.input_id, input.revision, input.source]);
        const prefixes = Array.from({ length: inputs.length + 1 }, (_, size) => hash(tuples.slice(0, size)));
        const prefix = prefixes.indexOf(digest);
        if (prefix < 0) return false;
        const owner = this.work(work), requirements = this.version(this.row(work).plan).data.plan.requirements;
        return inputs.slice(prefix).every((input, offset) => {
            const { launch: id, ...decision } = input.data.decision ?? {};
            if (input.data.effectHold || decision.impact !== 'explanation' || decision.inputId !== input.input_id || decision.directionRevision !== input.revision || !Array.isArray(decision.requirementIds) || decision.requirementIds.some((id: string) => !requirements.some((r: any) => r.id === id))) return false;
            const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', id), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = launch && parse(launch.data), rd = run && parse(run.data);
            const outputs = launch ? this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", id) : [];
            const output = outputs.length === 1 ? outputs[0] : null, metadata = output && parse(output.data), protocol = output && parseCapturedRoleOutput(output.raw, 'adjudicator', ld).value;
            if (!launch || !run || !output || launch.work !== work || run.work !== work || launch.role !== 'adjudicator' || ld.stage !== 'source-fit' || rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== 'adjudicator') return false;
            if (launch.status !== 'COMPLETE' || launch.epoch !== owner.epoch || run.epoch !== owner.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed') return false;
            if (!this.sameNonCandidateBindings(work, ld.inputVersions) || ld.inputVersions.candidate !== null || !prefixes.slice(prefix + offset + 1).includes(rd.sourceInputHash)) return false;
            if (!metadata.nativeEntryId || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.historyRef !== rd.historyRef || ld.historyRef !== rd.historyRef || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId) return false;
            return hash(metadata.protocol) === hash(protocol) && !protocol?.ownerDecisionRequired?.length && !!protocol?.inputDecisions?.some((d: any) => hash(d) === hash(decision));
        });
    }
    private restoreUnusableAuthorPlan(work: string) {
        const r = this.row(work), owner = this.work(work);
        if (r.phase !== 'BLOCKED' || r.data.resumeStage !== 'implement' || r.candidate)
            throw new Error('Retained first-author retry checkpoint required');
        const launch = this.s.one("SELECT * FROM role_launches WHERE work=? AND role='implementer' ORDER BY rowid DESC LIMIT 1", work), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = launch && parse(launch.data), rd = run && parse(run.data);
        const diagnostic = launch && this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', 'diagnostic-' + launch.id, work), recovered = diagnostic && parse(diagnostic.data);
        const output = recovered && this.s.one('SELECT * FROM role_outputs WHERE id=?', recovered.output);
        const source = recovered?.recoverySource && this.s.one('SELECT origin FROM sources WHERE id=?', recovered.recoverySource), origin = source && parse(source.origin);
        if (!launch || !run || !output || launch.work !== work || run.work !== work || launch.status !== 'UNUSABLE' || launch.epoch !== owner.epoch || run.epoch !== owner.epoch || ld.stage !== 'implementation' || rd.role !== 'implementer' || rd.kind !== 'governed-role' || rd.launchId !== launch.id || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed'
            || !this.sameNonCandidateBindings(work, ld.inputVersions) || ld.inputVersions.candidate !== null || !r.plan || hash(ld.acceptedPlan) !== this.version(r.plan).hash
            || recovered?.kind !== 'diagnostic' || recovered.launchId !== launch.id || recovered.state !== 'resolved' || recovered.method !== 'retain-output-and-raw-obligations-before-charged-reentry' || !recovered.recoverySource || recovered.replacementLaunch || recovered.reentryRun
            || origin?.kind !== 'explicit-producer-recovery' || origin.work !== work || origin.launchId !== launch.id || origin.output !== output.id
            || output.launch !== launch.id || output.status !== 'unusable' || !this.retrySourceCorresponds(work, rd.sourceInputHash))
            throw new Error('Original unusable author, accepted plan or source correspondence unavailable; inspect original evidence before retry');
        this.restoreAcceptedPlan(work, digest => this.retrySourceCorresponds(work, digest));
    }
    async checks(options: {
        workId: string;
        signal?: AbortSignal;
        applicationModel?: ApplicationModelOperation;
    }, only?: string[]) {
        options = this.captureCompanion(options);
        return this.operation(options, 'checks', () => this.checksInner(options, only));
    }
    async review(options: ChangeOperation) {
        options = this.captureOperation(options);
        return this.operation(options, 'review', () => this.reviewInner(options));
    }
    async resolve(options: ChangeOperation) {
        options = this.captureOperation(options);
        return this.operation(options, 'resolve', () => this.resolveInner(options));
    }
    async confirm(options: ChangeOperation) {
        options = this.captureOperation(options);
        return this.operation(options, 'confirm', () => this.confirmInner(options));
    }
    private get s() {
        return this.h.store;
    }
    private row(work: string) {
        const row = this.s.one('SELECT * FROM change_state WHERE work=?', work);
        if (!row)
            throw new ControllerError('MISSING_CHANGE', 'No governed change checkpoint', 'Begin a governed change or inspect correct W', work);
        return { ...row, data: parse(row.data) };
    }
    private version(id: string) {
        const r = this.s.one('SELECT * FROM change_versions WHERE id=?', id);
        if (!r)
            throw new Error('Required immutable version absent');
        return { ...r, data: parse(r.data) };
    }
    private work(id: string) {
        const w = this.s.one('SELECT * FROM works WHERE id=?', id);
        if (!w)
            throw new Error('Missing governed work');
        return w;
    }
    private phase(work: string, phase: string, patch: Record<string, unknown> = {}) {
        this.guard(work);
        const r = this.row(work);
        this.s.run('UPDATE change_state SET phase=?,data=? WHERE work=?', phase, JSON.stringify({ ...r.data, ...patch }), work);
    }
    private blocked(work: string, reason: string, nextAction: string) {
        const op = this.operations.get(work);
        if (op && (this.work(work).epoch !== op.epoch || this.work(work).state !== 'ACTIVE' || op.handle.abort.signal.aborted || op.sourceVersion !== hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source]))))
            return this.inspect(work);
        const stage = nextAction.startsWith('plan') ? 'plan' : nextAction.startsWith('implement') ? 'implement' : nextAction.startsWith('repair') ? 'repair' : nextAction.startsWith('check') ? 'checks' : nextAction.startsWith('review') ? 'review' : nextAction.startsWith('resolve') ? 'resolve' : nextAction.startsWith('confirm') ? 'confirm' : !this.row(work).base ? 'capture' : null;
        this.phase(work, 'BLOCKED', { blocked: [reason], nextAction, resumeStage: stage ?? this.row(work).data.resumeStage ?? null });
        return this.inspect(work);
    }
    private newVersion(work: string, kind: string, artifact: string | null, content: Record<string, unknown>, digest: string, predecessor: string | null = null) {
        this.guard(work);
        const id = randomUUID();
        this.s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', id, work, kind, predecessor, artifact, digest, JSON.stringify(content));
        return id;
    }
    private budget(work: string, kind: string) {
        return this.s.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', this.work(work).lineage, kind);
    }
    private criteriaHoldReason(work: string): string | null {
        try {
            if (loadCriteriaSync().hash !== this.version(this.row(work).data.contractsVersion).hash)
                return 'Active workflow criteria changed: explicit owner refresh-criteria and independent replan, or restore exact owned definitions';
            return null;
        }
        catch (error) {
            return 'Owned workflow criteria unavailable or malformed: restore exact owned definitions before admission: ' + String(error);
        }
    }
    /** A retained failed producer explains recovery; it does not authorize a retry. */
    private linkedProducerFailure(work: string, row: any, owner: any): { presentation: Pick<ChangeView, 'planningFailure' | 'providerFailure'>; nextAction: string } | null {
        if (row.phase !== 'BLOCKED') return null;
        try {
            const launch = this.s.one(`SELECT l.id,l.work,l.run,l.role,l.epoch,l.status,
                json_object('stage',json_extract(l.data,'$.stage'),'inputVersions',json_extract(l.data,'$.inputVersions'),
                    'cleanup',json_extract(l.data,'$.cleanup'),'nativeSessionId',json_extract(l.data,'$.nativeSessionId')) AS data,
                r.phase AS run_phase,json_extract(r.data,'$.cleanup') AS run_cleanup,json_extract(r.data,'$.nativeCheckpoint.sha256') AS checkpoint_hash,
                r.work AS run_work,r.epoch AS run_epoch,json_extract(r.data,'$.kind') AS run_kind,json_extract(r.data,'$.launchId') AS run_launch,
                json_object('kind',json_extract(d.data,'$.kind'),'state',json_extract(d.data,'$.state'),
                    'launchId',json_extract(d.data,'$.launchId'),'output',json_extract(d.data,'$.output'),'issues',json_extract(d.data,'$.issues')) AS diagnostic,
                p.id AS output_id,p.status AS output_status,json_object('issues',json_extract(p.data,'$.issues'),
                    'terminal',json_extract(p.data,'$.terminal'),'providerFailure',CASE WHEN length(json_extract(p.data,'$.providerFailure'))<=4096 THEN json_extract(p.data,'$.providerFailure') ELSE NULL END) AS output
                FROM role_launches l JOIN runs r ON r.id=l.run
                LEFT JOIN obligations d ON d.id='diagnostic-'||l.id AND d.work=l.work
                LEFT JOIN role_outputs p ON p.id=json_extract(d.data,'$.output') AND p.launch=l.id
                WHERE l.work=? ORDER BY l.rowid DESC LIMIT 1`, work);
            if (!launch || launch.status !== 'UNUSABLE' || launch.epoch !== owner.epoch || launch.run_work !== work || launch.run_epoch !== owner.epoch || launch.run_kind !== 'governed-role' || launch.run_launch !== launch.id ||
                !launch.diagnostic || !launch.output || launch.output_status !== 'unusable') return null;
            const data = parse(launch.data), diagnostic = parse(launch.diagnostic), output = parse(launch.output);
            const stages: Record<string, { role: Role; resume: string }> = {
                planning: { role: 'planner', resume: 'plan' }, 'planning-challenge': { role: 'challenger', resume: 'plan' },
                'planning-adjudication': { role: 'adjudicator', resume: 'plan' }, implementation: { role: 'implementer', resume: 'implement' },
                'substantive-repair': { role: 'repairer', resume: 'repair' }, 'fresh-review': { role: 'reviewer', resume: 'review' },
                'review-adjudication': { role: 'adjudicator', resume: 'resolve' }, 'exact-nit-confirmation': { role: 'confirmer', resume: 'confirm' },
            };
            const stage = stages[data.stage];
            if (!stage || stage.resume !== row.data.resumeStage || stage.role !== launch.role || diagnostic.kind !== 'diagnostic' || diagnostic.state !== 'pending' ||
                diagnostic.launchId !== launch.id || diagnostic.output !== launch.output_id || !Array.isArray(output.issues) || !output.issues.length ||
                output.issues.some((issue: unknown) => typeof issue !== 'string') || !Array.isArray(diagnostic.issues) || hash(diagnostic.issues) !== hash(output.issues)) return null;
            const role = stage.role;
            const versions = { contracts: row.data.contractsVersion, requirements: row.data.requirementVersion ?? null, base: row.base, candidate: row.candidate, plan: row.plan, verification: row.verification };
            if (!data.inputVersions || Object.entries(versions).some(([key, value]) => data.inputVersions[key] !== value) ||
                !Array.isArray(row.data.blocked) || !row.data.blocked.includes('ControllerError: ' + output.issues.join('; '))) return null;
            const reported = providerUsageLimit(output.providerFailure);
            const providerFailure = reported && output.terminal === 'error' && launch.run_phase === 'SETTLED' &&
                data.cleanup === 'removed' && launch.run_cleanup === 'removed' &&
                typeof launch.checkpoint_hash === 'string' && /^[a-f0-9]{64}$/.test(launch.checkpoint_hash) &&
                reported.ownerSessionId === data.nativeSessionId ? reported : undefined;
            const planningFailure: PlanningFailureView | undefined = stage.resume === 'plan' &&
                (role === 'planner' || role === 'challenger' || role === 'adjudicator')
                ? { role, launchId: launch.id, ...(providerFailure ? { providerFailure } : {}) } : undefined;
            let presentation: Pick<ChangeView, 'planningFailure' | 'providerFailure'>;
            if (planningFailure) presentation = { planningFailure };
            else if (providerFailure && role !== 'planner' && role !== 'challenger')
                presentation = { providerFailure: { role, launchId: launch.id, usageLimit: providerFailure } };
            else return null;
            const nextAction = (providerFailure
                ? 'The provider reported a usage-limit rejection during this failed role. Wait and check the account limits before explicitly continuing the same work. A reported reset does not guarantee renewed access. ' : '') +
                `Inspect original ${planningFailure ? 'planning role' : 'role'} ${launch.id} and its retained diagnostics in /work ${work}. ` +
                `No usable ${planningFailure ? 'planning ' : ''}result was received. Resolve the recorded producer failure and other holds before explicitly continuing this same work. ` +
                'A retry consumes remaining original allowance; retain original evidence and consumed usage.';
            return { presentation, nextAction };
        } catch { return null; } // Unavailable attribution cannot establish a producer cause.
    }
    /** Recorded provenance only; no criteria, history, model or admission reads. */
    recordedProducerFailures(work: string): Pick<ChangeView, 'planningFailure' | 'providerFailure'> | undefined {
        this.h.assertOpen();
        return this.linkedProducerFailure(work, this.row(work), this.work(work))?.presentation;
    }
    recordedPlanningFailure(work: string): PlanningFailureView | undefined {
        return this.recordedProducerFailures(work)?.planningFailure;
    }
    private coverageHoldReason(work: string, read = this.createVerificationRead(work)): string | null {
        const r = this.row(work);
        if (!r.plan)
            return null;
        const issue = coverageIssue(this.version(r.plan).data.plan);
        if (issue) return issue;
        try { read.strategies(); return null; }
        catch (error) { return String(error); }
    }
    /** Local inspection only: never resolves a model or advances a retained checkpoint. */
    inspectModelPrerequisites(workId: string): {
        stage: string;
        roles: readonly Role[];
    } {
        this.h.assertOpen();
        const r = this.row(workId), w = this.work(workId), pending = this.pending(workId);
        if (this.h.busy(workId))
            return { stage: 'busy', roles: [] };
        if (w.state === 'UNKNOWN' || ownerRootActivation(parse(w.data))?.state === 'PENDING' || this.criteriaHoldReason(workId) ||
            this.materialAccountingHoldReason(workId) || pending.some(item => ['raw-findings-incomplete', 'interrupted-producer'].includes(item.kind))) {
            return { stage: 'held', roles: [] };
        }
        if (r.plan && this.h.sourceImpacts(workId).some(input => input.data.effectHold)) {
            return { stage: 'source-fit', roles: changeStageRoles('source-fit') };
        }
        const coverageHeld = !!r.plan && !!this.coverageHoldReason(workId);
        if (r.phase === 'REVIEW_READY' && pending.some(item=>item.kind==='finding')) return {stage:'resolve',roles:changeStageRoles('resolve')};
        if (r.phase === 'REVIEW_READY' && !coverageHeld && !this.strategyHoldReason(workId))
            return { stage: 'complete', roles: [] };
        const stage = coverageHeld ? 'plan' : nextChangeStage(r, r.phase === 'BLOCKED' ? r.data.resumeStage ?? null : null);
        if (stage === 'plan' && pending.some(item => !['check', 'finding', 'diagnostic'].includes(item.kind))) {
            return { stage: 'held', roles: [] };
        }
        return { stage: stage ?? 'held', roles: changeStageRoles(stage) };
    }
    inspect(workId: string): ChangeView {
        this.h.assertOpen();
        const r = this.row(workId), w = this.work(workId), read = this.createVerificationRead(workId);
        const activation = ownerRootActivation(parse(w.data)), activationHold = activation?.state === 'PENDING';
        const criteriaReason = this.criteriaHoldReason(workId);
        const coverageReason = criteriaReason && activationHold ? null : this.coverageHoldReason(workId, read);
        const strategyReason = r.phase === 'REVIEW_READY' ? this.strategyHoldReason(workId, read) : null;
        const criteriaHold = criteriaReason ?? coverageReason ?? strategyReason, materialCoverageReason = this.materialAccountingHoldReason(workId), materialReason = materialCoverageReason ??
            (r.phase === 'REVIEW_READY' && this.pending(workId).some(o=>o.kind==='finding') ? 'Received findings require independent accounting before current standing' : null);
        const execution = this.budget(workId, 'execution'), resolution = this.budget(workId, 'resolution');
        const settlementHold = w.state === 'UNKNOWN' ? uncertainSettlementInspection(workId) : null;
        const producerFailure = this.linkedProducerFailure(workId, r, w);
        let nextAction = r.phase === 'BLOCKED' && r.data.resumeStage === 'plan'
            ? `Inspect original planning blockers and role records in /work ${workId} before explicitly continuing this same work. Preserve original evidence and consumed allowance.`
            : r.data.nextAction ?? '';
        let modelContextFailure: ModelContextFailureCode | undefined;
        if (settlementHold) {
            nextAction = settlementHold.nextAction;
        }
        else if (activationHold) {
            nextAction = 'Restore the captured delegation profile; use change activate --work ' + workId +
                ' --epoch ' + w.epoch + (['CANCELLED', 'INTERRUPTED'].includes(w.state) ? ' --resume-cancelled true' : '');
        }
        else if (criteriaHold) {
            nextAction = strategyReason ? 'Inspect current typed verification witnesses and repeat the original independent review/adjudication; no readiness or effect authority is inferred' : coverageReason
                ? 'Explicit change run/resume replans same W with supported verification strategies and actual healthy/adverse consumer evidence; retain old evidence and allowances'
                : '/work ' + workId + ' → Review updated gitjig workflow rules; CLI: change refresh-criteria --work ' + workId + ' --reason TEXT, or restore exact owned definitions';
        }
        else if (materialReason) {
            nextAction = materialCoverageReason
                ? `Explicit change resume --work ${workId} restores original received material coverage before further governed work. Preserve original history, selected output and spent allowance; subsequent admitted stages may consume remaining allowance.`
                : `Explicit change resume --work ${workId} independently resolves retained findings on the same selected candidate. Preserve original history, inputs and spent allowance; the admitted assessment may consume remaining allowance.`;
        }
        else if (r.phase === 'BLOCKED') {
            const contextHeld = (Array.isArray(r.data.blocked) ? r.data.blocked : []).map(modelContextFailureCode).find((code: ModelContextFailureCode | undefined) => code !== undefined);
            const formatterHeld = w.state === 'ACTIVE' && !contextHeld && (Array.isArray(r.data.blocked) ? r.data.blocked : []).some((cause: unknown) =>
                typeof cause === 'string' && cause.startsWith('Error: NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: '));
            if (w.state === 'ACTIVE')
                modelContextFailure = contextHeld;
            if (contextHeld)
                nextAction = `Review the selected role model's context/output limits and retained required inputs in /work ${workId}. ` +
                    `For application-managed work, inspect eligible role choices with /role-model; explicit profiles retain their original model route and configuration. ` +
                    `Resolve the model/input capacity mismatch before explicitly /change resume ${workId}. ` +
                    'Preserve required inputs, original evidence and consumed allowance; an unchanged retry does not add context capacity.';
            else if (formatterHeld)
                nextAction = `Update gitjig or correct its native formatter schema before explicitly resuming the same work in /work ${workId}. ` +
                    'This is an application compatibility failure; more execution or resolution allowance does not repair the schema. ' +
                    'Preserve the original request, diagnostics, findings and consumed usage.';
            else if (producerFailure)
                nextAction = producerFailure.nextAction;
            const allowances = { execution, resolution };
            const exhausted = (['execution', 'resolution'] as const).filter(kind => {
                const budget = allowances[kind];
                return budget.consumed + budget.reserved >= budget.limit;
            });
            if (exhausted.length && !formatterHeld) {
                const actions = exhausted.map(kind => 'Extend shared ' + kind + ' allowance').join('; ');
                nextAction = `${nextAction || 'Inspect original blockers'}. Allowance recovery: open /work ${workId}; ` +
                    `explicitly ${actions} after settlement, then /change resume ${workId}. ` +
                    'Original identity, consumed usage and findings remain retained.';
            }
        }
        return {
            workId,
            state: w.state,
            recordedPhase: r.phase,
            ...(Object.hasOwn(r.data, 'verificationProfileMode') || r.plan && Object.hasOwn(this.version(r.plan).data.plan.verification, 'strategies') ? { verificationEvidence: this.verificationView(workId, read) } : {}),
            ownerActivation: activation ? activationHold ? 'pending' : 'complete' : 'not-recorded',
            phase: settlementHold || activationHold || criteriaHold || materialReason ? 'BLOCKED' : r.phase,
            epoch: w.epoch,
            baseVersion: r.base, candidateVersion: r.candidate, planVersion: r.plan, verificationVersion: r.verification,
            resolution, execution,
            blocked: [
                ...(settlementHold ? [settlementHold.blocker] : []),
                ...(r.data.blocked ?? []),
                ...(activationHold ? ['Original owner delegation activation is incomplete'] : []),
                ...(criteriaHold ? [criteriaHold] : []),
                ...(materialReason ? [materialReason] : []),
                ...(producerFailure ? [producerFailure.nextAction] : []),
            ],
            nextAction,
            ...(modelContextFailure ? { modelContextFailure } : {}),
            ...(producerFailure && w.state === 'ACTIVE' && !settlementHold && !activationHold && !criteriaHold && !materialReason && !modelContextFailure
                ? producerFailure.presentation : {}),
            versions: this.s.all('SELECT id,kind,predecessor,artifact,hash FROM change_versions WHERE work=?', workId),
            launches: this.s.all('SELECT * FROM role_launches WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            checks: this.s.all('SELECT * FROM check_runs WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            occurrences: this.s.all('SELECT * FROM finding_occurrences WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            dispositions: this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=?', workId)
                .map(x => ({ ...x, data: parse(x.data) })),
            reviewReady: !settlementHold && !activationHold && !criteriaHold && !materialReason && this.checksCurrent(workId, read) && r.phase === 'REVIEW_READY' &&
                w.state === 'DELIVERED' && r.epoch === w.epoch && !this.h.sourceImpacts(workId).some(input => input.data.effectHold),
            limitations: [
                'Local agent procedure only; no account approval, publication or merge authority.',
                'Semantic judgments and test adequacy remain fallible.',
                'Initial text-only captured input and normalized modes profile.',
                ...(settlementHold || criteriaHold || materialReason ? ['Retained historical phase: ' + r.phase + '; readiness held without rewriting history or consuming allowance.'] : []),
            ],
        };
    }
    /** Read retained selected results without materializing artifacts or invoking a producer. */
    inspectResult(workId: string): ChangeResultView {
        this.h.assertOpen();
        const w = this.work(workId), r = this.row(workId);
        const project = this.s.one('SELECT root FROM projects WHERE id=?', w.project);
        const source = this.s.one('SELECT raw FROM sources WHERE id=?', w.source);
        if (!project || !source) throw Error('Original result project or owner request unavailable');
        const clip = (value: unknown, length = 4096) => typeof value === 'string' ? value.slice(0, length) : '';
        const reason = (error: unknown) => clip(error instanceof Error ? error.message : 'Retained result unavailable', 1024);
        let assessment: ChangeView | undefined, assessmentFailure: string | undefined;
        try { assessment = this.inspect(workId); } catch (error) { assessmentFailure = reason(error); }
        const settlementHold = w.state === 'UNKNOWN' ? uncertainSettlementInspection(workId) : null;
        const blockers = [...(settlementHold && !assessment ? [settlementHold.blocker] : []),
            ...(assessment?.blocked ?? (Array.isArray(r.data.blocked) ? r.data.blocked : [])),
            ...(assessmentFailure ? ['Current procedure assessment unavailable: ' + assessmentFailure] : [])];
        const result: ChangeResultView = {
            ...(assessment?.modelContextFailure ? { modelContextFailure: assessment.modelContextFailure } : {}),
            ...(assessment?.planningFailure ? { planningFailure: assessment.planningFailure } : {}),
            ...(assessment?.providerFailure ? { providerFailure: assessment.providerFailure } : {}),
            ...(assessment?.verificationEvidence ? { verificationEvidence: assessment.verificationEvidence } : {}),
            workId, projectId: w.project, request: clip(source.raw, 32768), requestTruncated: source.raw.length > 32768,
            registeredSourceRoot: project.root, state: w.state, recordedPhase: r.phase, reviewReady: assessment?.reviewReady ?? false,
            blocked: blockers.slice(0, 16).map((item: unknown) => clip(item, 1024)), blockedOmitted: Math.max(0, blockers.length - 16),
            nextAction: clip(assessment?.nextAction ?? settlementHold?.nextAction ?? r.data.nextAction ?? 'Inspect original work and retained evidence'),
            candidate: null,
            changes: {availability: r.candidate ? 'unavailable' : 'no-candidate', entries: [], total: null, omitted: 0},
            checks: {availability: 'not-planned', entries: [], total: null, omitted: 0},
            reviews: {availability: 'not-planned', entries: [], total: null, omitted: 0},
            provenance: {baseVersion: r.base, candidateVersion: r.candidate, planVersion: r.plan, verificationVersion: r.verification},
            limitations: [
                'Recorded candidate snapshot and retained execution evidence only; this view reads no project or artifact contents.',
                'The registered original project folder has not been compared with the candidate. This view applies no files.',
                'Artifact location is recorded metadata; existence and current content are not verified.',
                'Selected reviewer outcomes remain attributed judgments. Native history/checkpoint contents are not reread or independently revalidated by this view.',
                'Retained metadata is not account approval or native delivery authority.',
                'Review-ready is a local procedure assessment. Publication, integration, merge and their current native endpoints are not observed here.',
            ],
        };
        const selectedVersion = (id: string | null, kind: string) => {
            if (!id) throw Error('Selected ' + kind + ' version is absent');
            const version = this.version(id);
            if (version.work !== workId || version.kind !== kind) throw Error('Selected ' + kind + ' belongs to another work or version kind');
            return version;
        };
        if (r.candidate) {
            try {
                const candidate = selectedVersion(r.candidate, 'candidate');
                if (typeof candidate.artifact !== 'string' || !path.isAbsolute(candidate.artifact) || candidate.artifact.length > 8192 || !/^[a-f0-9]{64}$/u.test(candidate.hash))
                    throw Error('Recorded candidate location or digest unavailable');
                result.candidate = {versionId: candidate.id, path: candidate.artifact, hash: candidate.hash};
                result.changes = recordedResultChanges(selectedVersion(r.base, 'base'), candidate);
            } catch (error) { result.changes.reason = reason(error); }
        }
        let selectedChecksUsable = false;
        if (r.verification) {
            try {
                if (r.candidate) selectedVersion(r.candidate, 'candidate');
                const version = selectedVersion(r.verification, 'verification'), verification = version.data.verification;
                if (hash(verification) !== version.hash) throw Error('Required check declaration identity differs');
                if (!Array.isArray(verification?.checks) || verification.checks.length > 1024) throw Error('Required check roster unavailable');
                const entries: ChangeResultView['checks']['entries'] = verification.checks.map((check: any) => {
                    if (typeof check?.id !== 'string') throw Error('Required check identity unavailable');
                    const baseline = this.baselineCheckIds(workId).has(check.id);
                    const row = baseline ? this.selectedBaselineCheck(workId, check) : r.candidate ? this.selectedCheck(workId, r.candidate, r.verification, check) : undefined;
                    const observed = baseline && !!this.baselineReceipt(workId, check);
                    const data = row ? parse(row.data) : null;
                    return {checkId: check.id, receiptId: row?.id ?? null, runId: row?.run ?? null,
                        status: row ? baseline && observed ? 'baseline-observed' : ['pass', 'fail', 'unavailable', 'stale'].includes(row.status) ? row.status : 'unavailable' : 'missing',
                        ...(baseline ? { target: 'base' as const, purpose: 'baseline' as const, observed } : {}),
                        passed: !baseline && this.checkReceiptPassed(workId, row, check), cleanup: typeof data?.cleanup === 'string' ? clip(data.cleanup) : null,
                        durationMs: typeof data?.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0 ? data.durationMs : null};
                });
                selectedChecksUsable = entries.length > 0 && entries.every(entry => entry.target === 'base' ? entry.observed === true : entry.passed);
                result.checks = {availability: 'recorded', ...resultEntries(entries)};
            } catch (error) { result.checks = {availability: 'unavailable', entries: [], total: null, omitted: 0, reason: reason(error)}; }
        }
        let selectedReviewsUsable = false;
        if (r.plan) {
            try {
                if (r.candidate) selectedVersion(r.candidate, 'candidate');
                const version = selectedVersion(r.plan, 'plan'), plan = version.data.plan;
                if (hash(plan) !== version.hash) throw Error('Required review declaration identity differs');
                const roster = plan?.verification?.reviewRoles;
                if (!Array.isArray(roster) || roster.length > 1024) throw Error('Required review roster unavailable');
                const entries: ChangeResultView['reviews']['entries'] = roster.map((position: any) => {
                    const key = typeof position === 'string' ? position : position?.key;
                    const purpose = typeof position === 'string' ? 'general' : position?.purpose;
                    const requiredPaths = typeof position === 'string' ? [] : position?.requiredPaths;
                    if (typeof key !== 'string' || !key) throw Error('Required review position unavailable');
                    const id = r.data.selection?.[key];
                    const entry: ChangeResultView['reviews']['entries'][number] = {key, launchId: typeof id === 'string' ? id : null,
                        runId: null, state: id ? 'unavailable' : 'missing', outcome: 'unavailable', findingCount: null, outputId: null};
                    if (!id || !r.candidate) return entry;
                    try {
                        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', id);
                        if (!launch || launch.work !== workId || launch.role !== 'reviewer') return entry;
                        entry.runId = launch.run;
                        const data = parse(launch.data), input = data.inputVersions;
                        const carried = input?.candidate !== r.candidate && r.data.carry?.after === r.candidate && r.data.carry?.before === input?.candidate &&
                            !!this.s.one('SELECT id FROM remedy_confirmations WHERE work=? AND before_version=? AND after_version=? AND launch=?', workId, r.data.carry.before, r.candidate, r.data.carry.confirmation);
                        if (!this.sameNonCandidateBindings(workId, input) || input?.candidate !== r.candidate && !carried) {
                            entry.state = 'stale'; return entry;
                        }
                        if (carried) selectedVersion(input.candidate, 'candidate');
                        if (launch.status !== 'COMPLETE' || data.stage !== 'fresh-review' || data.reviewKey !== key || data.purpose !== purpose || hash(data.requiredPaths) !== hash(requiredPaths) || data.cleanup !== 'removed') return entry;
                        const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), rd = run ? parse(run.data) : null;
                        // Recovery can advance current authority while retaining the exact selected evidence.
                        // Validate the original producer correspondence, not equality to the revived work.
                        if (!run || run.work !== workId || run.epoch !== launch.epoch || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > w.epoch ||
                            !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > w.generation ||
                            run.phase !== 'SETTLED' || run.reservation !== 'consumed' || rd.cleanup !== 'removed') return entry;
                        const checkpoint = rd.nativeCheckpoint;
                        if (checkpoint?.sessionId !== rd.nativeSessionId || typeof checkpoint?.leafId !== 'string' || !checkpoint.leafId || !Number.isSafeInteger(checkpoint.bytes) || checkpoint.bytes < 1 || checkpoint.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/u.test(checkpoint.sha256)) return entry;
                        const outputs = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", id);
                        if (outputs.length !== 1) return entry;
                        const output = outputs[0], metadata = parse(output.data);
                        if (!rd.historyRef || metadata.historyRef !== rd.historyRef || data.historyRef !== rd.historyRef || !rd.nativeSessionId || data.nativeSessionId !== rd.nativeSessionId || typeof metadata.nativeEntryId !== 'string' || !metadata.nativeEntryId) return entry;
                        if (typeof output.raw !== 'string' || Buffer.from(output.raw, 'utf8').toString('utf8') !== output.raw || Buffer.byteLength(output.raw) > REVIEW_EVIDENCE_LIMITS.rawBytes || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !Array.isArray(metadata.issues) || metadata.issues.length) return entry;
                        const protocol = parseRoleOutput(output.raw, 'reviewer');
                        if (!protocol.value || protocol.issues.length || hash(protocol.value) !== hash(metadata.protocol)) return entry;
                        entry.state = carried ? 'carried' : 'selected';
                        entry.outputId = output.id;
                        entry.findingCount = protocol.value.findings.length;
                        entry.outcome = protocol.value.findings.length || protocol.value.outcome === 'findings' ? 'findings' : 'clear';
                        return entry;
                    } catch { return entry; }
                });
                selectedReviewsUsable = entries.length > 0 && entries.every(entry => ['selected', 'carried'].includes(entry.state) && entry.outcome !== 'unavailable');
                result.reviews = {availability: 'recorded', ...resultEntries(entries)};
            } catch (error) { result.reviews = {availability: 'unavailable', entries: [], total: null, omitted: 0, reason: reason(error)}; }
        }
        if (result.reviewReady) {
            const holds = [
                ...(result.changes.availability !== 'recorded' || !result.candidate ? ['Selected candidate provenance is unavailable'] : []),
                ...(!selectedChecksUsable ? ['Required selected check evidence is unavailable or inconsistent'] : []),
                ...(!selectedReviewsUsable ? ['Required selected review evidence is unavailable or stale'] : []),
            ];
            if (holds.length) {
                result.reviewReady = false;
                for (const hold of holds) {
                    if (result.blocked.length < 16) result.blocked.push(hold);
                    else result.blockedOmitted++;
                }
                result.nextAction = 'Inspect the original selected result records. Restore exact evidence or perform explicitly authorized affected verification/review; the recorded ready phase is not sufficient.';
            }
        }
        return result;
    }
    async begin(options: BeginChangeOptions, invocation?: Record<string, unknown>) {
        options = { ...options, ...(Object.hasOwn(options, 'applicationModelBaseline') ? { applicationModelBaseline: captureWorkModelBaseline(options.applicationModelBaseline) } : {}) };
        bounded(options.resolutionLimit ?? 8, 'resolution allowance');
        bounded(options.executionLimit ?? defaultConversationExecutionLimit, 'execution allowance');
        if (!options.request.trim())
            throw new Error('Owner request required');
        options.signal?.throwIfAborted();
        const criteria = await loadCriteria();
        options.signal?.throwIfAborted();
        const a = this.h.admit(options.projectId, 'governed-change', options.request, invocation, options.applicationModelBaseline, work => {
            // The owning admission transaction also installs discoverable governed state.
            const w = this.work(work);
            if (w.lineage === w.id) {
                this.s.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?', options.resolutionLimit ?? 8, w.lineage, 'resolution');
                this.s.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?', options.executionLimit ?? defaultConversationExecutionLimit, w.lineage, 'execution');
            }
            else if (options.resolutionLimit !== undefined && options.resolutionLimit !== this.budget(w.id, 'resolution').limit || options.executionLimit !== undefined && options.executionLimit !== this.budget(w.id, 'execution').limit) {
                throw Error('Shared family allowances cannot be reset by managed entry; use an explicit original-work extension');
            }
            this.s.run('INSERT INTO change_state VALUES(?,?,NULL,NULL,NULL,NULL,?,?)', w.id, 'BASE_CAPTURING', w.epoch, JSON.stringify({ blocked: [], nextAction: 'planChange', ownerRequirements: options.ownerRequirements ?? [], request: options.request, selection: {}, pendingNit: null }));
            const contracts = this.newVersion(w.id, 'contracts', null, { text: criteria.text, assets: criteria.assets }, criteria.hash);
            this.phase(w.id, 'BASE_CAPTURING', { contractsVersion: contracts });
        });
        const handle: Handle = { abort: new AbortController() };
        this.h.register(a.w.id, handle);
        const stop = () => {
            void this.h.cancel(a.w.id).catch(() => handle.abort.abort());
        };
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        try {
            this.h.entry(a.runId);
            this.h.patchRun(a.runId, 'CAPTURING', {});
            const receipt = await freeze(a.project.root, a.staging, parse(a.project.profile), handle.abort.signal);
            this.h.entry(a.runId);
            // Restart recovery removes an unsettled run's staging, which is the base artifact once committed.
            this.s.tx(() => {
                const base = this.newVersion(a.w.id, 'base', a.staging, { manifest: receipt.manifest, producer: a.runId }, receipt.digest);
                this.s.run('UPDATE change_state SET base=?,phase=? WHERE work=?', base, 'BASE_CAPTURED', a.w.id);
                this.h.patchRun(a.runId, 'SETTLED', { manifest: receipt.manifest, attainedCapture: true, base, cleanup: 'not-allocated' });
                // Recovery skips SETTLED runs, so the reservation must settle with the phase (the finally settle is then a no-op).
                this.h.settleBudget(a.runId);
            });
        }
        catch (error) {
            this.h.patchRun(a.runId, 'SETTLED', { error: String(error), cleanup: 'not-allocated' });
            this.blocked(a.w.id, String(error), 'capture');
        }
        finally {
            this.s.tx(() => this.h.settleBudget(a.runId));
            this.h.unregister(a.w.id);
            options.signal?.removeEventListener('abort', stop);
        }
        return this.inspect(a.w.id);
    }
    private producerDiagnostics(work: string) {
        const r = this.row(work);
        const currentInputVersions = { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification };
        const occurrences: {
            occurrenceId: string;
            outputId: string;
            launchId: string;
        }[] = [], outputs: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        const hold = (id: string, reason: string): never => { throw new Error(`Producer diagnostic unavailable: ${id}: ${reason}; restore the exact retained same-W record/completeness before adjudication; do not fabricate prior raw output`); };
        for (const pending of this.pending(work)) {
            if (pending.kind !== 'finding')
                continue;
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=?', pending.id);
            if (!occurrence || occurrence.work !== work)
                hold(pending.id, 'missing or foreign occurrence');
            const data = parse(occurrence.data);
            if (data.finding?.requirementId !== 'producer-integrity')
                continue;
            if (occurrences.length >= 64)
                hold(occurrence.id, 'diagnostic occurrence limit64 exceeded; no evidence omitted');
            const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', occurrence.output);
            const launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch);
            if (!output || !launch || launch.work !== work || data.launchId !== launch.id || data.role !== launch.role)
                hold(occurrence.id, 'output/origin/evidence provenance mismatch');
            const material = parse(output.data).harvestedFindings ?? rawFindings(output.raw).findings;
            if (Array.isArray(material) && occurrence.ordinal >= 0 && occurrence.ordinal < material.length && hash(material[occurrence.ordinal]) === hash(data.finding))
                continue; // A model's ordinary claim with this label has no synthetic diagnosis privilege.
            if (!Array.isArray(data.finding.evidence) || !data.finding.evidence.includes(output.id))
                hold(occurrence.id, 'output/origin/evidence provenance mismatch');
            occurrences.push({ occurrenceId: occurrence.id, outputId: output.id, launchId: launch.id });
            if (seen.has(output.id))
                continue;
            const metadata = parse(output.data), origin = parse(launch.data);
            if (!['unusable', 'accounted-intermediate'].includes(output.status) || !Number.isSafeInteger(launch.epoch) || typeof origin.stage !== 'string' || !origin.inputVersions || typeof origin.inputVersions !== 'object' || Array.isArray(origin.inputVersions))
                hold(output.id, 'unsupported producer metadata');
            const inputVersions: Record<string, string | null> = {};
            for (const kind of ['contracts', 'requirements', 'base', 'candidate', 'plan', 'verification']) {
                const id = origin.inputVersions[kind];
                if (id !== null && (typeof id !== 'string' || !id))
                    hold(output.id, 'missing origin input tuple');
                if (id !== null) {
                    const version = this.s.one('SELECT work,kind FROM change_versions WHERE id=?', id);
                    if (!version || version.work !== work || version.kind !== kind)
                        hold(output.id, 'foreign or mismatched origin input version');
                }
                inputVersions[kind] = id;
            }
            if (output.raw === null)
                hold(output.id, 'raw=NULL; no complete raw operand retained');
            if (typeof output.raw !== 'string' || Buffer.byteLength(output.raw, 'utf8') > 128 * 1024 || Buffer.from(output.raw, 'utf8').toString('utf8') !== output.raw)
                hold(output.id, 'raw exceeds128KiB supported evidence bound');
            if (metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0)
                hold(output.id, 'known or unknown raw/extraction loss; partial evidence cannot establish completeness');
            if (!Array.isArray(metadata.issues) || metadata.issues.length > 64 || metadata.issues.some((issue: unknown) => typeof issue !== 'string' || Buffer.byteLength(issue, 'utf8') > 8192) || !['complete', 'incomplete', 'aborted', 'error'].includes(metadata.terminal) || (metadata.nativeEntryId !== null && (typeof metadata.nativeEntryId !== 'string' || metadata.nativeEntryId.length > 256)))
                hold(output.id, 'unsupported bounded validation metadata');
            outputs.push({ outputId: output.id, launchId: launch.id, status: output.status, ...(metadata.materialAssessment ? {materialSource:metadata.materialAssessment} : {}), raw: output.raw, rawUtf8Bytes: Buffer.byteLength(output.raw, 'utf8'), rawSha256: createHash('sha256').update(output.raw, 'utf8').digest('hex'), rawFinalTruncated: metadata.rawFinalTruncated, omittedFindingCount: metadata.omittedFindingCount, terminal: metadata.terminal, validationIssues: [...metadata.issues], nativeEntryId: metadata.nativeEntryId, origin: { role: launch.role, epoch: launch.epoch, stage: origin.stage, inputVersions } });
            seen.add(output.id);
            if (Buffer.byteLength(JSON.stringify({ currentInputVersions, occurrences, outputs }), 'utf8') > 256 * 1024)
                hold(output.id, 'serialized diagnostic evidence exceeds256KiB; no evidence silently omitted');
        }
        const projection = { semantics: 'Historical exact received raw for independent diagnosis only, from an unusable producer or an unowned public frame; not current source facts, valid RoleOutput, repair authority, semantic-completeness certification or automatic disposition', currentInputVersions, occurrences, outputs };
        if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > 256 * 1024)
            hold(work, 'serialized diagnostic evidence exceeds256KiB; no evidence silently omitted');
        return projection;
    }
    /** Exact normal collect suffix, never a model-controlled requirement label. */
    private collectorDiagnosis(work: string, occurrenceId: string) {
        const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=?', occurrenceId);
        const output = occurrence && this.s.one('SELECT * FROM role_outputs WHERE id=?', occurrence.output);
        const launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch);
        const data = occurrence && parse(occurrence.data), metadata = output && parse(output.data), assessment = metadata?.materialAssessment;
        if (!occurrence || occurrence.work !== work || !output || !launch || launch.work !== work || data.launchId !== launch.id || data.role !== launch.role ||
            typeof output.raw !== 'string' || !output.raw || metadata.omittedFindingCount !== 0 || metadata.rawFinalTruncated !== false)
            throw new Error('Unsupported collector diagnosis origin');
        let findings:unknown[], expectedFinding:unknown;
        if (assessment) {
            const read = roleMaterialFindings(output.raw,launch.role), source = assessment.source;
            const locations = read.claims.map(({finding,...location})=>location);
            if (assessment.version !== 1 || !source || !unownedNativeSelector(source.selector) || source.sourceEntryId !== metadata.nativeEntryId ||
                source.rawSha256 !== hash(output.raw) || source.rawUtf8Bytes !== Buffer.byteLength(output.raw) ||
                output.status !== 'accounted-intermediate' || metadata.protocol !== null || metadata.nativeSource !== null || read.complete ||
                hash(metadata.harvestedFindings) !== hash(read.claims.map(claim=>claim.finding)) ||
                hash(metadata.materialSources) !== hash(locations.length ? locations.map(location=>({...source,...location})) : [source]) ||
                metadata.accountingKey !== hash({source,locations}))
                throw new Error('Unsupported exact public material assessment origin');
            findings = metadata.harvestedFindings; expectedFinding = materialDiagnosisFinding(output.id);
        } else {
            const raw = rawFindings(output.raw);
            if (output.status !== 'unusable' || metadata.harvestedFindings !== null ||
                raw.complete && !metadata.issues?.some((issue: unknown) => typeof issue === 'string' && /duplicate|JSON/i.test(issue)))
                throw new Error('Occurrence is not the actual host collector diagnosis suffix');
            findings = raw.findings; expectedFinding = producerDiagnosisFinding(output.id);
        }
        if (occurrence.ordinal !== findings.length || hash(data.finding) !== hash(expectedFinding))
            throw new Error('Occurrence is not the actual host collector diagnosis suffix');
        const siblings = this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal', output.id);
        if (siblings.length !== findings.length + 1 || siblings.some((row: any, i: number) => row.ordinal !== i || row.work !== work || parse(row.data).launchId !== launch.id || parse(row.data).role !== launch.role || hash(parse(row.data).finding) !== hash(i === findings.length ? expectedFinding : findings[i])))
            throw new Error('Collector diagnosis material roster changed or incomplete');
        return { occurrence, output, launch, metadata, material: siblings.slice(0, -1) };
    }
    private materialAssessmentFence(outputId:string) {
        const output = this.s.one('SELECT * FROM role_outputs WHERE id=?',outputId), launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?',output.launch), run = launch && this.s.one('SELECT * FROM runs WHERE id=?',launch.run);
        const historyIdentity = this.materialHistoryIdentity(parse(run?.data).historyRef);
        if (!output || !launch || !run || !historyIdentity) throw Error('Public material assessment original source unavailable');
        return {historyIdentity,rows:hash([output,launch,run,this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',outputId)])};
    }
    private async diagnosisOrigin(work: string, occurrenceId: string) {
        const origin = this.collectorDiagnosis(work, occurrenceId), { output, launch, metadata } = origin;
        const assessment = metadata.materialAssessment;
        const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = parse(launch.data), rd = run && parse(run.data);
        if (!run || run.id !== launch.run || run.work !== work || run.epoch !== launch.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
            !(assessment ? ['COMPLETE','UNUSABLE'].includes(launch.status) && metadata.terminal === 'incomplete' : launch.status === 'UNUSABLE' && metadata.terminal === 'complete') ||
            ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !metadata.nativeEntryId || !rd.nativeCheckpoint || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || !rd.historyRef || ld.historyRef !== rd.historyRef || metadata.historyRef !== rd.historyRef)
            throw new Error('Diagnosis origin native producer is incomplete or unsettled');
        if (Buffer.byteLength(output.raw, 'utf8') > 128 * 1024 || Buffer.from(output.raw, 'utf8').toString('utf8') !== output.raw || !Array.isArray(metadata.issues) || metadata.issues.length > 64 || metadata.issues.some((issue: unknown) => typeof issue !== 'string' || Buffer.byteLength(issue, 'utf8') > 8192))
            throw new Error('Diagnosis origin exceeds supported complete evidence bounds');
        const before = assessment ? this.materialAssessmentFence(output.id) : undefined;
        const entries = await this.nativeEntries(run.id);
        if (assessment && hash(before) !== hash(this.materialAssessmentFence(output.id))) throw Error('Public material assessment source changed during read');
        let materialSource:unknown;
        if (assessment) {
            if (rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role || ld.nativeRoleIntent?.stage !== ld.stage)
                throw Error('Public material assessment original dispatch unavailable');
            const material = readUnownedNativeMaterial(entries,{sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent},metadata.nativeEntryId,assessment.source.selector);
            const {raw,...source} = material;
            materialSource = {...source,rawSha256:hash(raw),rawUtf8Bytes:Buffer.byteLength(raw)};
            if (raw !== output.raw || hash(materialSource) !== hash(assessment.source)) throw Error('Public material assessment original entry/raw mismatch');
        } else if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage,allowLegacyString:true}, metadata.nativeSource) !== output.raw)
            throw new Error('Diagnosis origin selected native entry/raw mismatch');
        const operand = { occurrenceId, outputId: output.id, originLaunchId: launch.id, originRunId: run.id, nativeEntryId: metadata.nativeEntryId, rawSha256: hash(output.raw), rawUtf8Bytes: Buffer.byteLength(output.raw, 'utf8'),
            ...(assessment ? {materialSource:{version:1,source:materialSource,fence:before}} : {}),
            validationMetadataHash: hash({ issues: metadata.issues, terminal: metadata.terminal, rawFinalTruncated: metadata.rawFinalTruncated, omittedFindingCount: metadata.omittedFindingCount }), origin: { role: launch.role, epoch: launch.epoch, inputVersions: ld.inputVersions, nativeSessionId: rd.nativeSessionId, checkpoint: rd.nativeCheckpoint }, materialOccurrences: origin.material.map((o: any) => ({ id: o.id, findingHash: hash(parse(o.data).finding) })) };
        return { ...origin, operand };
    }
    private async captureDiagnosticInput(work: string, launchId: string, bundle: InputBundle) {
        this.guard(work);
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId), ld = launch && parse(launch.data), projection = bundle.context.producerDiagnostics as any;
        if (!launch || launch.work !== work || launch.role !== 'adjudicator' || !['planning-adjudication', 'review-adjudication'].includes(ld.stage) || !projection)
            throw new Error('Diagnostic receipt requires the actual assigned adjudication input');
        const operands: any[] = [], unavailableOccurrenceIds: string[] = [];
        for (const link of projection.occurrences) {
            let proof;
            try {
                proof = await this.diagnosisOrigin(work, link.occurrenceId);
            }
            catch {
                unavailableOccurrenceIds.push(link.occurrenceId);
                continue;
            }
            const supplied = projection.outputs.find((o: any) => o.outputId === proof.output.id);
            if (!supplied || supplied.raw !== proof.output.raw || supplied.rawSha256 !== proof.operand.rawSha256 || supplied.nativeEntryId !== proof.operand.nativeEntryId || hash(supplied.validationIssues) !== hash(proof.metadata.issues) || hash(supplied.materialSource ?? null) !== hash(proof.metadata.materialAssessment ?? null))
                throw new Error('Actual supplied diagnostic operand differs from retained origin');
            operands.push({ ...proof.operand, suppliedOutputHash: hash(supplied) });
        }
        const snapshot = { version: operands.some(o=>o.materialSource) ? 2 : 1, workId: work, launchId, runId: launch.run, epoch: launch.epoch, stage: ld.stage, inputVersions: ld.inputVersions, sourceInputHash: hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])), projectionHash: hash(projection), operands, unavailableOccurrenceIds };
        const receiptHash = hash(snapshot), suppliedReceipt = { receiptHash, semantics: 'Host-supplied diagnosis operands only. materialOccurrenceIds is exactly the original output collector-retained sibling set, not a semantic-completeness or current-materiality census; later findings never enlarge it. Later already-retained claims keep their own occurrence and producer origins and require separate independent current decisions, not insertion into this original set. Assess whether a true historical flaw in a discarded proposal still affects the current task or plan; diagnosis does not require repairing a never-adopted artifact merely because that old proposal was flawed. Genuinely new unretained meaningful current claims still require normal retention and accountable decisions. No comprehension, producer rehabilitation, task repair or automatic disposition is certified', eligible: operands.map(o => ({ occurrenceId: o.occurrenceId, outputId: o.outputId, rawSha256: o.rawSha256, ...(o.materialSource ? {materialSource:o.materialSource} : {}), materialOccurrenceIds: o.materialOccurrences.map((m: any) => m.id) })), unavailableOccurrenceIds };
        if (Buffer.byteLength(JSON.stringify({ projection, snapshot, suppliedReceipt }), 'utf8') > 256 * 1024)
            throw new Error('Diagnostic receipt/evidence exceeds256KiB; nothing clipped');
        this.guard(work);
        this.s.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({ ...ld, producerDiagnosticInput: { ...snapshot, receiptHash } }), launchId);
        bundle.context.producerDiagnosticReceipt = suppliedReceipt;
        bundle.context.diagnosisEligibility = { version: 1 };
    }
    /** Exact collector origins and applied diagnosis boundaries, never a model-chosen label. */
    private diagnosisSubjectIds(work: string) {
        const all = this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work), synthetic = new Set<string>();
        for (const occurrence of all) {
            try {
                this.collectorDiagnosis(work, occurrence.id);
                synthetic.add(occurrence.id);
            }
            catch { }
            // A damaged old operand must not erase a previously applied diagnosis boundary.
            if (this.s.all('SELECT data FROM finding_dispositions WHERE occurrence=?', occurrence.id).some(d => parse(d.data).resolution === 'diagnosed'))
                synthetic.add(occurrence.id);
        }
        return synthetic;
    }
    /** New closure requests and full historical/proposed equivalence need separate guards. */
    private diagnosisDecisionGuard(work: string, protocol: RoleResult) {
        const all = this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work), synthetic = this.diagnosisSubjectIds(work);
        for (const decision of protocol.decisions ?? [])
            if (synthetic.has(decision.occurrenceId) && decision.resolution === 'repaired')
                throw new Error('Synthetic producer diagnosis cannot be repaired by candidate changes or checks; preserve committed diagnoses or assess an exact current diagnosis operand');
        const latest = new Map<string, any>();
        for (const occurrence of all) {
            const row = this.s.one('SELECT data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', occurrence.id);
            if (row)
                latest.set(occurrence.id, parse(row.data));
        }
        for (const d of protocol.decisions ?? [])
            latest.set(d.occurrenceId, d);
        for (const [id, d] of latest) {
            if (d.disposition !== 'equivalent')
                continue;
            const seen = new Set<string>();
            let current = id;
            while (latest.get(current)?.disposition === 'equivalent') {
                if (seen.has(current))
                    throw new Error('Finding equivalence cycle remains unresolved');
                seen.add(current);
                const target = latest.get(current).equivalentTo;
                if (synthetic.has(current) || synthetic.has(target))
                    throw new Error('Synthetic diagnosis duties require their own explicit diagnosis; semantic equivalence cannot waive them or material findings');
                current = target;
            }
        }
    }
    private async prevalidateDiagnoses(work: string, judgment: {
        launchId: string;
        runId: string;
        output: string;
        protocol: RoleResult;
        execution: RoleExecution;
    }) {
        this.guard(work);
        this.assertRetainedDispositions(work, judgment.launchId, judgment.protocol);
        this.diagnosisDecisionGuard(work, judgment.protocol);
        const requests = (judgment.protocol.decisions ?? []).filter(d => d.resolution === 'diagnosed'), proofs = new Map<string, any>();
        if (!requests.length)
            return proofs;
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', judgment.launchId), output = this.s.one('SELECT * FROM role_outputs WHERE id=?', judgment.output), run = this.s.one('SELECT * FROM runs WHERE id=?', judgment.runId), r = this.row(work), owner = this.work(work);
        const ld = launch && parse(launch.data), metadata = output && parse(output.data), rd = run && parse(run.data), receipt = ld?.producerDiagnosticInput;
        const tuple = { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification };
        if (!launch || !output || !run || launch.work !== work || run.work !== work || launch.run !== run.id || run.id !== judgment.runId || output.launch !== launch.id || launch.role !== 'adjudicator' || launch.status !== 'COMPLETE' || !['planning-adjudication', 'review-adjudication'].includes(ld.stage) || launch.epoch !== owner.epoch || run.epoch !== owner.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || !rd.historyRef || ld.historyRef !== rd.historyRef || metadata.historyRef !== rd.historyRef || judgment.execution.historyRef !== rd.historyRef || output.status !== 'usable' || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !judgment.execution.selectedFinalEntryId || metadata.nativeEntryId !== judgment.execution.selectedFinalEntryId || hash(metadata.protocol) !== hash(judgment.protocol) || hash(parseCapturedRoleOutput(output.raw, 'adjudicator', ld).value) !== hash(judgment.protocol) || !receipt || receipt.launchId !== launch.id || receipt.runId !== run.id || receipt.workId !== work || receipt.epoch !== owner.epoch || receipt.stage !== ld.stage || hash(receipt.inputVersions) !== hash(tuple) || hash(ld.inputVersions) !== hash(tuple) || receipt.sourceInputHash !== hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])) || rd.sourceInputHash !== receipt.sourceInputHash || judgment.protocol.ownerDecisionRequired?.length)
            throw new Error('Diagnosis requires the actual current settled usable independent J and pre-adoption input receipt');
        const { receiptHash, ...snapshot } = receipt;
        if (hash(snapshot) !== receiptHash || receipt.version !== (receipt.operands.some((operand:any)=>operand.materialSource) ? 2 : 1))
            throw new Error('Diagnosis input receipt changed');
        const entries = await this.nativeEntries(run.id);
        if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== output.raw)
            throw new Error('Diagnosis J selected native output mismatch');
        const decisions = judgment.protocol.decisions ?? [], ids = new Set(decisions.map(d => d.occurrenceId));
        if (ids.size !== decisions.length || this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work).some(o => parse(o.data).launchId === launch.id && !ids.has(o.id)))
            throw new Error('Diagnosis cannot omit newly retained J claims or guess future occurrence IDs');
        const projection = this.producerDiagnostics(work);
        if (hash(projection) !== receipt.projectionHash)
            throw new Error('Diagnosis pending/raw input changed after dispatch');
        for (const decision of requests) {
            const operand = receipt.operands.find((o: any) => o.occurrenceId === decision.occurrenceId), proof = await this.diagnosisOrigin(work, decision.occurrenceId), d = decision.diagnosis;
            const supplied = projection.outputs.find((o: any) => o.outputId === proof.output.id);
            if (!operand || !d || launch.id === proof.launch.id || !supplied || hash({ ...proof.operand, suppliedOutputHash: hash(supplied) }) !== hash(operand) || d.outputId !== proof.output.id || d.rawSha256 !== proof.operand.rawSha256 || d.inputReceiptHash !== receiptHash || hash([...d.materialOccurrenceIds].sort()) !== hash(proof.material.map((o: any) => o.id).sort()) || proof.material.some((o: any) => !ids.has(o.id)))
                throw new Error('Diagnosis needs exact supplied origin/raw/current receipt and every separate material decision');
            proofs.set(decision.occurrenceId, { judgeLaunchId: launch.id, judgeRunId: run.id, judgeOutputId: output.id, judgeNativeEntryId: metadata.nativeEntryId, inputReceiptHash: receiptHash, origin: operand });
        }
        this.guard(work);
        this.assertRetainedDispositions(work, judgment.launchId, judgment.protocol);
        return proofs;
    }
    private captureInputScope(work: string, launchId: string, bundle: InputBundle) {
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId), data = launch && parse(launch.data);
        if (!launch || launch.work !== work || bundle.context.stage !== data.stage || !((launch.role === 'planner' && data.stage === 'planning') || (launch.role === 'challenger' && data.stage === 'planning-challenge')))
            throw new Error('Role input scope requires the assigned current planning producer');
        const occurrences = bundle.context.occurrences;
        if (!Array.isArray(occurrences))
            throw new Error('Role input scope occurrence census unavailable');
        const snapshot = { version: 1, semantics: 'Host-supplied initial input at this producer launch, not a later role census or proof of finding validity/read comprehension. Later roles may receive additional occurrences and different body visibility.', workId: work, launchId, runId: launch.run, role: launch.role, stage: data.stage, epoch: launch.epoch, inputVersions: structuredClone(data.inputVersions), occurrenceIds: occurrences.map(o => o.id), findingBodyOmittedIds: occurrences.filter(o => o.findingBodyOmitted === true).map(o => o.id), findingBodySuppliedIds: occurrences.filter(o => o.data && Object.hasOwn(o.data, 'finding')).map(o => o.id), selectedSources: bundle.sources.map(source => ({ id: source.id, version: source.version, side: source.side, path: source.path, sha256: source.sha256 })), promptIncludedSourceIds: bundle.sources.filter(source => source.exposeInPrompt).map(source => source.id) };
        if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 2 * 1024 * 1024)
            throw new Error('Role input scope exceeds existing2MiB role-input profile; no metadata clipped');
        this.s.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({ ...data, inputScope: snapshot }), launchId);
    }
    private inputScopeReceipt(work: string, launchId: string, outputId: string, role: Role, stage: string, selectedEntryId: string | null) {
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId), output = this.s.one('SELECT * FROM role_outputs WHERE id=?', outputId);
        const data = launch && parse(launch.data), snapshot = data?.inputScope, metadata = output && parse(output.data);
        const run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run), current = this.row(work), owner = this.work(work);
        const currentVersions = { contracts: current.data.contractsVersion, requirements: current.data.requirementVersion ?? null, base: current.base, candidate: current.candidate, plan: current.plan, verification: current.verification };
        if (!((role === 'planner' && stage === 'planning') || (role === 'challenger' && stage === 'planning-challenge')) || !launch || !output || !run || launch.work !== work || run.work !== work || run.id !== launch.run || run.epoch !== launch.epoch || owner.epoch !== launch.epoch || output.launch !== launchId || launch.role !== role || data.stage !== stage || launch.status !== 'COMPLETE' || data.cleanup !== 'removed' || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || output.status !== 'usable' || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !metadata.nativeEntryId || metadata.nativeEntryId !== selectedEntryId || !snapshot || snapshot.workId !== work || snapshot.launchId !== launchId || snapshot.runId !== launch.run || snapshot.role !== role || snapshot.stage !== stage || snapshot.epoch !== launch.epoch || hash(snapshot.inputVersions) !== hash(data.inputVersions) || hash(snapshot.inputVersions) !== hash(currentVersions))
            throw new Error('Current planning producer input scope/output provenance unavailable');
        return { ...structuredClone(snapshot), outputId };
    }
    /** Derived original initial-message evidence, never a retroactive capture receipt. */
    private async historicalPlanningProducer(work: string, outputId: string) {
        const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', outputId), launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
        if (!output || !launch || !run || launch.work !== work || run.work !== work || run.id !== launch.run || run.epoch !== launch.epoch || !['COMPLETE', 'UNUSABLE'].includes(launch.status) || !['usable', 'unusable'].includes(output.status) || run.phase !== 'SETTLED' || run.reservation !== 'consumed')
            throw new Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE');
        const ld = parse(launch.data), rd = parse(run.data), metadata = parse(output.data), tuple: Record<string, string | null> = {};
        if (ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !rd.nativeCheckpoint || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || !rd.historyRef || ld.historyRef !== rd.historyRef || metadata.historyRef !== rd.historyRef || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !metadata.nativeEntryId || typeof output.raw !== 'string' || Buffer.byteLength(output.raw) > 128 * 1024)
            throw new Error('HISTORICAL_NATIVE_PROOF_UNAVAILABLE');
        for (const kind of ['contracts', 'requirements', 'base', 'candidate', 'plan', 'verification']) {
            const id = ld.inputVersions?.[kind], version = typeof id === 'string' && this.s.one('SELECT work,kind FROM change_versions WHERE id=?', id);
            if (id !== null && (!version || version.work !== work || version.kind !== kind))
                throw new Error('HISTORICAL_INPUT_TUPLE_UNAVAILABLE');
            tuple[kind] = id;
        }
        let entries: any[];
        try {
            entries = await this.nativeEntries(run.id);
        }
        catch {
            throw new Error('HISTORICAL_NATIVE_PROOF_UNAVAILABLE');
        }
        if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== output.raw)
            throw new Error('HISTORICAL_SELECTED_OUTPUT_UNAVAILABLE');
        if (metadata.protocol !== null && metadata.protocol !== undefined) {
            try {
                if (hash(parseUniqueJson(output.raw)) !== hash(metadata.protocol))
                    throw new Error();
            }
            catch {
                throw new Error('HISTORICAL_SELECTED_OUTPUT_UNAVAILABLE');
            }
        }
        const user = entries.find(entry => entry.type === 'message' && entry.message.role === 'user'), content = user?.message.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && content[0].type === 'text' ? content[0].text : null;
        if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024)
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        const body = historicalRoleInputBody(text, launch.role);
        if (body === null)
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        let input: any;
        try {
            input = parseUniqueJson(body);
            if (input && typeof input === 'object' && input.context && typeof input.context === 'object' && !Array.isArray(input.context))
                input.context = restoreFindingBodies(input.context, launch.role);
        }
        catch {
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        }
        const context = input?.context, occurrences = context?.occurrences;
        if (!context || context.stage !== ld.stage || !Array.isArray(occurrences) || !Array.isArray(input.sources) || occurrences.some((item: any) => !item || typeof item.id !== 'string' || item.work !== work || (item.findingBodyOmitted !== undefined && typeof item.findingBodyOmitted !== 'boolean')) || new Set(occurrences.map((item: any) => item.id)).size !== occurrences.length)
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        for (const [field, kind] of [['baseVersion', 'base'], ['candidateVersion', 'candidate'], ['planVersion', 'plan'], ['verificationVersion', 'verification']] as const)
            if (context[field] !== tuple[kind])
                throw new Error('HISTORICAL_INPUT_TUPLE_UNAVAILABLE');
        const sources: { id: string; version: string; side: string; path: string; sha256: string; exposeInPrompt: boolean }[] = input.sources.map((source: any) => {
            const version = source && this.s.one('SELECT work,kind FROM change_versions WHERE id=?', source.version);
            if (!version || version.work !== work || !['base', 'candidate'].includes(source.side) || version.kind !== source.side || path.isAbsolute(source.path ?? '') || typeof source.path !== 'string' || path.posix.normalize(source.path) !== source.path || source.path.split('/').includes('..') || source.id !== `${source.side}:${source.path}` || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '') || ['id', 'version', 'side', 'path', 'sha256'].some(key => typeof source[key] !== 'string') || typeof source.exposeInPrompt !== 'boolean')
                throw new Error('HISTORICAL_SOURCE_METADATA_UNAVAILABLE');
            return { id: source.id, version: source.version, side: source.side, path: source.path, sha256: source.sha256, exposeInPrompt: source.exposeInPrompt };
        });
        return { output, launch, ld, run, rd, input, context, witness: { outputId: output.id, launchId: launch.id, runId: run.id, role: launch.role, stage: ld.stage, epoch: launch.epoch, producerStatus: output.status, launchStatus: launch.status, inputVersions: tuple, nativeSessionId: rd.nativeSessionId, nativeEntryId: metadata.nativeEntryId, outputRawSha256: hash(output.raw), checkpoint: { sessionId: rd.nativeCheckpoint.sessionId, leafId: rd.nativeCheckpoint.leafId, bytes: rd.nativeCheckpoint.bytes, sha256: rd.nativeCheckpoint.sha256 }, initialView: { userEntryId: user.id, textUtf8Bytes: Buffer.byteLength(text), textSha256: hash(text), occurrenceIds: occurrences.map((item: any) => item.id), findingBodyOmittedIds: occurrences.filter((item: any) => item.findingBodyOmitted === true).map((item: any) => item.id), findingBodySuppliedIds: occurrences.filter((item: any) => item.data && Object.hasOwn(item.data, 'finding')).map((item: any) => item.id), sources } } };
    }
    /** Select retained proposals, never old acceptance or a reconstructed initial census. */
    private async planningPrefix(options: ChangeOperation, role: 'planner' | 'challenger', planner?: { protocol: NonNullable<RoleExecution['protocol']>; inputScope: unknown }) {
        const work = options.workId, stage = role === 'planner' ? 'planning' : 'planning-challenge';
        const latest = () => this.s.one('SELECT * FROM role_launches WHERE work=? AND epoch=? AND role=? ORDER BY rowid DESC LIMIT 1', work, this.work(work).epoch, role);
        const launch = latest(), current = this.row(work), owner = this.work(work);
        if (!launch || launch.status !== 'COMPLETE' || current.plan || current.candidate) return null;
        const ld = parse(launch.data), run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), rd = run && parse(run.data);
        // Older profiles without captured premises continue through normal fresh planning.
        if (!ld.inputScope || !ld.modelIdentity || !ld.modelMode || !rd?.runtimeProfile || !rd.projectProtection || !rd.manifest || !rd.modelIdentity || !rd.modelMode) return null;
        const sourceHash = () => hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]));
        const protection = () => projectProtection(this.s, this.work(work).project);
        if (!this.sameNonCandidateBindings(work, ld.inputVersions) || ld.inputVersions.candidate !== null ||
            hash(rd.runtimeProfile) !== hash(this.h.options.runtimeProfile) || hash(rd.projectProtection) !== hash(protection()) ||
            hash(effective(rd.manifest)) !== hash(effective(this.version(current.base).data.manifest)) || rd.sourceInputHash !== sourceHash()) return null;
        if (role === 'challenger' && (!planner || hash(ld.planProposal ?? null) !== hash(planner.protocol.plan) ||
            hash(ld.plannerOutput ?? null) !== hash(planner.protocol) || hash(ld.plannerInputScope ?? null) !== hash(planner.inputScope))) return null;
        const premises = () => {
            this.h.assertOpen(); this.h.assertApplicationAdmission?.(work); options.signal?.throwIfAborted(); this.guard(work);
            if (this.criteriaHoldReason(work)) throw Error('Planning prefix criteria changed; explicit current-criteria planning is required');
            const row = this.row(work), w = this.work(work);
            return hash({ epoch: w.epoch, generation: w.generation, source: w.source, state: w.state,
                versions: this.bindings(work), sourceHash: sourceHash(), protection: protection(), runtime: this.h.options.runtimeProfile,
                request: row.data.request, ownerRequirements: row.data.ownerRequirements ?? [], criteriaRefresh: row.data.criteriaRefresh ?? null,
                verificationProfile: this.verificationSupport(work).capability });
        };
        const before = premises(), selection = await this.selectRoleModel(options, role);
        let assertModel = () => {};
        if (selection.model.bridge || selection.model.bridgeProfile) {
            const { admitOwnedClaudeSelection } = await import('../pi/claude-host.js');
            assertModel = () => { admitOwnedClaudeSelection(selection.model); };
        }
        const modelIdentity = hash(modelConfigurationIdentity(selection.model));
        const assertPremises = () => {
            selection.assertCurrent(); assertModel();
            if (premises() !== before || latest()?.id !== launch.id || hash(modelConfigurationIdentity(selection.model)) !== modelIdentity)
                throw Error('Planning prefix inputs or selected producer changed during validation');
        };
        assertPremises();
        if (owner.state !== 'ACTIVE' || run.generation !== owner.generation || ld.modelIdentity !== modelIdentity ||
            rd.modelIdentity !== modelIdentity || hash(ld.modelMode) !== hash(selection.mode) || hash(rd.modelMode) !== hash(selection.mode)) return null;
        const outputs = this.s.all('SELECT * FROM role_outputs WHERE launch=? AND status=?', launch.id, 'usable');
        if (outputs.length !== 1 || ld.stage !== stage || rd.kind !== 'governed-role' || rd.role !== role || rd.launchId !== launch.id)
            throw Error('Planning prefix original producer correspondence unavailable; restore its retained evidence');
        const output = outputs[0]!, metadata = parse(output.data);
        const records = () => hash([this.s.one('SELECT * FROM role_launches WHERE id=?', launch.id), this.s.one('SELECT * FROM runs WHERE id=?', run.id), this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id)]);
        const recordHash = records();
        const historyIdentity = () => {
            const stat = lstatSync(rd.historyRef, { bigint: true });
            if (!stat.isFile() || stat.nlink !== 1n) throw Error('Planning prefix original history is unavailable');
            return hash([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String));
        };
        const historyHash = historyIdentity();
        const assertRecorded = () => {
            assertPremises();
            if (records() !== recordHash || historyIdentity() !== historyHash)
                throw Error('Planning prefix original producer records or history changed');
        };
        const origin = await this.historicalPlanningProducer(work, output.id);
        assertRecorded();
        if (!Array.isArray(metadata.issues) || metadata.issues.length || hash(origin.input.contracts ?? null) !== hash(this.version(current.data.contractsVersion).data.text) ||
            origin.context.ownerSource !== owner.source || origin.context.ownerRequest !== current.data.request ||
            hash(origin.context.ownerRequirements ?? null) !== hash(current.data.ownerRequirements ?? []) ||
            hash(origin.input.requirements ?? null) !== hash([{ id: 'owner-request', text: current.data.request, source: owner.source }, ...(current.data.ownerRequirements ?? []).map((text: string, i: number) => ({ id: `owner-constraint-${i}`, text, source: owner.source }))]) ||
            hash(origin.context.projectProtection ?? null) !== hash(protection()) ||
            hash(origin.context.planningVerificationProfile ?? null) !== hash(this.verificationSupport(work).capability))
            throw Error('Planning prefix captured input or complete result unavailable; restore its original evidence');
        if (role === 'challenger' && (hash(origin.context.planProposal ?? null) !== hash(ld.planProposal ?? null) ||
            hash(origin.context.plannerOutput ?? null) !== hash(ld.plannerOutput ?? null) || hash(origin.context.plannerInputScope ?? null) !== hash(ld.plannerInputScope ?? null)))
            throw Error('Planning prefix challenger initial input does not match its selected planner');
        const framing = roleFraming(role, { ...origin.input, sources: [] });
        const parsed = parseRoleOutput(output.raw, role, framing.sourceFit, framing.constraints);
        if (!parsed.value || parsed.issues.length) throw Error('Planning prefix fails the current strict result contract; retain its original claims');
        if (ld.nativeRoleIntent && ld.nativeRoleIntent.schemaDigest !== hash(framing.schema)) return null;
        const inputScope = this.inputScopeReceipt(work, launch.id, output.id, role, stage, metadata.nativeEntryId);
        if (hash(inputScope.occurrenceIds) !== hash(origin.witness.initialView.occurrenceIds) ||
            hash(inputScope.findingBodyOmittedIds) !== hash(origin.witness.initialView.findingBodyOmittedIds) ||
            hash(inputScope.findingBodySuppliedIds) !== hash(origin.witness.initialView.findingBodySuppliedIds) ||
            hash(inputScope.selectedSources) !== hash(origin.witness.initialView.sources.map(({ exposeInPrompt, ...source }) => source)) ||
            hash(inputScope.promptIncludedSourceIds) !== hash(origin.witness.initialView.sources.filter(source => source.exposeInPrompt).map(source => source.id)) ||
            inputScope.selectedSources.some((source: { version: string; path: string; sha256: string }) => source.version !== current.base ||
                this.version(current.base).data.manifest.files.find((file: any) => file.path === source.path)?.sha256 !== source.sha256))
            throw Error('Planning prefix original input-scope receipt does not match its recorded initial input');
        return { value: { launchId: launch.id, runId: run.id, output: output.id, protocol: parsed.value, inputScope }, assertCurrent: assertRecorded };
    }
    private async historicalPlanningOperands(work: string, current: Record<string, any>) {
        const links: any[] = [], plans = new Map<string, any>(), producers = new Map<string, any>(), unavailable: any[] = [], native = new Map<string, ReturnType<ChangeCore['historicalPlanningProducer']>>();
        const sourceGuards = new Map<string, () => void>();
        const witness = async (id: string) => {
            if (!native.has(id))
                native.set(id, this.historicalPlanningProducer(work, id));
            const original = await native.get(id)!;
            const assertCurrent = () => {
                if (hash(this.s.one('SELECT * FROM role_outputs WHERE id=?', original.output.id)) !== hash(original.output) ||
                    hash(this.s.one('SELECT * FROM role_launches WHERE id=?', original.launch.id)) !== hash(original.launch) ||
                    hash(this.s.one('SELECT * FROM runs WHERE id=?', original.run.id)) !== hash(original.run))
                    throw Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE: Original historical producer records changed after capture');
            };
            assertCurrent();
            sourceGuards.set(id, assertCurrent);
            return original;
        };
        const selectedNow = new Set([current.plannerInputScope?.launchId, current.challengerInputScope?.launchId].filter(Boolean));
        const semantics = 'Derived recorded HISTORICAL INITIAL MESSAGE views only, not retroactive inputScope receipts, complete provider context, comprehension or current census. Discarded plans are evidence, not current requirements or adopted implementation. Independently assess historical facts and present materiality; an accurate obsolete criticism need not require repairing a never-adopted proposal. No verdict or closure is supplied.';
        for (const pending of this.pending(work)) {
            if (pending.kind !== 'finding')
                continue;
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?', pending.id, work), output = occurrence && this.s.one('SELECT * FROM role_outputs WHERE id=?', occurrence.output), launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch);
            if (!occurrence || !launch) {
                unavailable.push({ occurrenceId: pending.id, code: 'HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE', recovery: 'Restore the exact retained same-W occurrence/output/origin; no historical witness supplied.' });
                continue;
            }
            let ld: any;
            try {
                ld = parse(launch.data);
            }
            catch {
                unavailable.push({ occurrenceId: occurrence.id, code: 'HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE', recovery: 'Restore the exact retained same-W origin metadata; no historical witness supplied.' });
                continue;
            }
            if (!((launch.role === 'challenger' && ld.stage === 'planning-challenge') || (launch.role === 'adjudicator' && ld.stage === 'planning-adjudication')) || selectedNow.has(launch.id))
                continue;
            try {
                const data = parse(occurrence.data);
                if (launch.work !== work || data.launchId !== launch.id || data.role !== launch.role)
                    throw new Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE');
                const claims = rawFindings(output.raw).findings;
                if (occurrence.ordinal < claims.length) {
                    if (hash(claims[occurrence.ordinal]) !== hash(data.finding))
                        throw new Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE');
                }
                else {
                    try {
                        this.collectorDiagnosis(work, occurrence.id);
                    }
                    catch {
                        throw new Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE');
                    }
                }
                const origin = await witness(output.id), plan = origin.context.planProposal;
                if (!plan || typeof plan !== 'object' || Array.isArray(plan) || hash(plan) !== hash(ld.planProposal) || (ld.plannerOutput !== undefined && hash(origin.context.plannerOutput) !== hash(ld.plannerOutput)) || (ld.challenge !== undefined && hash(origin.context.challenge) !== hash(ld.challenge)))
                    throw new Error('HISTORICAL_PLAN_SOURCE_UNAVAILABLE');
                const candidates = this.s.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role=?', work, 'planner').filter(candidate => {
                    if (!['usable', 'unusable'].includes(candidate.status) || typeof candidate.raw !== 'string' || Buffer.byteLength(candidate.raw) > 128 * 1024)
                        return false;
                    const metadata = parse(candidate.data);
                    if (metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false)
                        return false;
                    try {
                        const protocol: any = parseUniqueJson(candidate.raw);
                        return protocol && hash(protocol.plan) === hash(plan) && (ld.plannerOutput === undefined || hash(protocol) === hash(ld.plannerOutput));
                    }
                    catch {
                        return false;
                    }
                });
                if (candidates.length !== 1)
                    throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                const planner = await witness(candidates[0].id);
                if (planner.launch.role !== 'planner' || planner.ld.stage !== 'planning' || hash(planner.ld.inputVersions) !== hash(ld.inputVersions))
                    throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                const planHash = hash(plan), candidateLink = { occurrenceId: occurrence.id, observationOutputId: output.id, producerOutputId: output.id, planHash, plannerOutputId: planner.output.id, pairSemantics: ld.plannerOutput === undefined ? 'Unique exact plan equality; not a historical host-assigned pair' : 'Unique exact retained plannerOutput/plan equality; not a historical host-assigned pair' };
                const nextPlans = new Map(plans).set(planHash, { planHash, plan: structuredClone(plan) }), nextProducers = new Map(producers).set(origin.output.id, origin.witness).set(planner.output.id, planner.witness);
                if (Buffer.byteLength(JSON.stringify({ semantics, links: [...links, candidateLink], plans: [...nextPlans.values()], producers: [...nextProducers.values()], unavailable })) > 2 * 1024 * 1024)
                    throw new Error('HISTORICAL_EVIDENCE_BOUND_UNAVAILABLE');
                links.push(candidateLink);
                plans.set(planHash, nextPlans.get(planHash));
                producers.set(origin.output.id, origin.witness);
                producers.set(planner.output.id, planner.witness);
            }
            catch (error) {
                const code = error instanceof Error && /^HISTORICAL_[A-Z_]+_UNAVAILABLE$/.test(error.message) ? error.message : 'HISTORICAL_OPERAND_UNAVAILABLE';
                unavailable.push({ occurrenceId: occurrence.id, code, recovery: 'Restore the exact retained same-W native checkpoint/selected output and initial input, or independently re-establish current applicability without inventing past scope. No historical witness is supplied for this link.' });
            }
        }
        const result = { semantics, links, plans: [...plans.values()], producers: [...producers.values()], unavailable };
        const assertCurrent = () => { for (const check of sourceGuards.values()) check(); };
        assertCurrent();
        return { value: projectHistoricalCensus(result), assertCurrent };
    }
    private reviewEvidenceBinding(work: string) {
        const w = this.work(work), r = this.row(work), selection = r.data.selection ?? {};
        return hash({ workId: work, epoch: w.epoch, generation: w.generation, source: w.source,
            versions: { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification },
            plan: r.plan ? this.version(r.plan) : null, selection, sourceInputs: this.h.sourceImpacts(work),
            selected: Object.values(selection).map(id => {
                const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', String(id));
                return { launch, run: launch ? this.s.one('SELECT * FROM runs WHERE id=?', launch.run) : null, outputs: this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', String(id)) };
            }) });
    }
    private assertReviewEvidence(work: string, evidence: any) {
        if (evidence && evidence.binding !== this.reviewEvidenceBinding(work))
            reviewEvidenceHold('current selection/tuple/retained records changed during preparation');
    }
    private async selectedReviewEvidence(work: string, context: Record<string, unknown>) {
        try {
            const binding = this.reviewEvidenceBinding(work), w = this.work(work), r = this.row(work);
            const plan = r.plan ? this.version(r.plan).data.plan as PlanProposal : null;
            if (!plan || hash(context.reviews) !== hash(r.data.selection ?? {}))
                reviewEvidenceHold('current accepted roster/selection missing');
            const roster = plan.verification.reviewRoles, keys = roster.map(role => typeof role === 'string' ? role : role.key);
            if (!keys.length || keys.length > REVIEW_EVIDENCE_LIMITS.references || new Set(keys).size !== keys.length || hash([...keys].sort()) !== hash(Object.keys(r.data.selection ?? {}).sort()) || new Set(Object.values(r.data.selection)).size !== keys.length)
                reviewEvidenceHold('current selected roster incomplete/ambiguous/exceeds64');
            const versions = { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification };
            const reviews = [];
            for (const entry of roster) {
                const reviewKey = typeof entry === 'string' ? entry : entry.key, purpose = typeof entry === 'string' ? 'general' : entry.purpose, requiredPaths = typeof entry === 'string' ? [] : entry.requiredPaths;
                const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', r.data.selection[reviewKey]), run = launch ? this.s.one('SELECT * FROM runs WHERE id=?', launch.run) : null;
                if (!launch || !run)
                    reviewEvidenceHold('current selected launch/run missing');
                const metadata = parse(launch.data), execution = parse(run.data);
                if (launch.work !== work || run.work !== work || launch.run !== run.id || run.epoch !== launch.epoch ||
                    !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > w.epoch || !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > w.generation ||
                    launch.role !== 'reviewer' || launch.status !== 'COMPLETE' || metadata.stage !== 'fresh-review' || metadata.reviewKey !== reviewKey || metadata.purpose !== purpose ||
                    hash(metadata.requiredPaths) !== hash(requiredPaths) || hash(metadata.inputVersions) !== hash(versions) || metadata.cleanup !== 'removed' ||
                    run.phase !== 'SETTLED' || run.reservation !== 'consumed' || execution.kind !== 'governed-role' || execution.role !== 'reviewer' || execution.launchId !== launch.id || execution.cleanup !== 'removed')
                    reviewEvidenceHold('current selected semantic inputs or original producer correspondence changed');
                const outputs = this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id);
                const { bundle } = await this.bundle(work, { stage: 'fresh-review', reviewKey, purpose, requiredPaths }, 'reviewer');
                this.assertReviewEvidence(work, { binding });
                let entries;
                try {
                    entries = await this.nativeEntries(run.id);
                }
                catch {
                    reviewEvidenceHold('current selected native checkpoint/history unavailable');
                }
                this.assertReviewEvidence(work, { binding });
                // Selected semantic evidence can survive pure owner recovery. These are
                // the exact original dispatch coordinates, never current action authority.
                const projected = projectSelectedReview({ workId: work, epoch: launch.epoch, generation: run.generation, versions, reviewKey, purpose, requiredPaths, launch, run, outputs, entries, bundle });
                reviews.push(projected);
                boundSelectedReviews(binding, reviews);
                this.assertReviewEvidence(work, { binding });
            }
            const evidence = boundSelectedReviews(binding, reviews);
            this.assertReviewEvidence(work, evidence);
            return evidence;
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith('SELECTED_REVIEW_EVIDENCE_UNAVAILABLE:'))
                throw error;
            reviewEvidenceHold('malformed or unavailable current selected review');
        }
    }
    private dispositionHistory(work: string, context: Record<string, unknown>) {
        const declaration = context.dispositionHistoryInput as { version?: unknown; id?: unknown } | undefined;
        if (declaration === undefined) return undefined;
        if (context.stage !== 'planning-adjudication' || !declaration || declaration.version !== 1 || typeof declaration.id !== 'string' || Object.keys(declaration).some(k => !['version', 'id'].includes(k))) throw Error('Disposition history capture unavailable');
        const records = this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work).map(row => ({ ...row, data: parse(row.data) }));
        return buildDispositionHistory({ id: declaration.id, workId: work, epoch: this.work(work).epoch, artifactRoot: path.join(this.h.options.installationHome, 'artifacts'), records });
    }
    private adjudicationReferences(work: string, occurrences: { id: string; data: any }[]): import('../workflow/types.js').DecisionReferences {
        const synthetic = new Set(this.diagnosisSubjectIds(work)), pending = new Set(this.pending(work).map(item => item.id));
        const ids = occurrences.map(row => row.id), latest = new Map<string, any>();
        for (const row of this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work)) latest.set(row.occurrence, row);
        const retentionChoices = [...latest.values()].filter(row => ids.includes(row.occurrence) && !pending.has(row.occurrence) &&
            parse(this.s.one('SELECT data FROM obligations WHERE id=?', row.occurrence)?.data ?? '{}').state === 'resolved')
            .map(row => ({ dispositionId: row.id, occurrenceId: row.occurrence, sha256: hash(row) }));
        return { version: 3, occurrenceIds: ids, diagnosisOccurrenceIds: [...synthetic],
            pendingOrdinaryIndexes: occurrences.flatMap((row, index) => !synthetic.has(row.id) && pending.has(row.id) ? [index] : []),
            blockingOrdinaryIndexes: occurrences.flatMap((row, index) => !synthetic.has(row.id) && row.data?.finding?.severity !== 'optional' ? [index] : []), retentionChoices };
    }
    private assertRetainedDispositions(work: string, launch: string, protocol: RoleResult) {
        if (protocol.retainedDispositions === undefined) return;
        const producer = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', launch, work);
        if (!producer || producer.role !== 'adjudicator') throw Error('Original retained disposition producer unavailable');
        const references = adjudicationDecisionReferences('adjudicator', parse(producer.data));
        const pending = new Set(this.pending(work).map(item => item.id));
        for (const choice of retainedDispositionRequests(protocol, references)) {
            const row = this.s.one('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE d.id=? AND f.work=?', choice.dispositionId, work);
            const latest = this.s.one('SELECT id FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', choice.occurrenceId);
            const obligation = this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', choice.occurrenceId, work);
            if (!row || row.occurrence !== choice.occurrenceId || hash(row) !== choice.sha256 || latest?.id !== row.id ||
                pending.has(row.occurrence) || parse(obligation?.data ?? '{}').state !== 'resolved') throw Error('Retained disposition changed or is no longer a resolved original row');
        }
    }
    private async bundle(work: string, context: Record<string, unknown> = {}, role?: Role, model?: PiModelSelection): Promise<{ bundle: InputBundle; evidence: RoleInputEvidenceSnapshot[]; assertCurrent: () => void }> {
        const r = this.row(work), criteria = this.version(r.data.contractsVersion), current = await loadCriteria();
        const diagnostics = role === 'adjudicator' && ['planning-adjudication', 'review-adjudication'].includes(String(context.stage)) ? this.producerDiagnostics(work) : null;
        const historical = role === 'adjudicator' && ['planning-adjudication', 'review-adjudication'].includes(String(context.stage)) ? await this.historicalPlanningOperands(work, context) : null;
        const evidence: RoleInputEvidenceSnapshot[] = [];
        if (current.hash !== criteria.hash)
            throw new Error('Active workflow criteria changed: refresh criteria and replan retaining obligations');
        const b = this.version(r.base), c = r.candidate ? this.version(r.candidate) : null;
        const p = r.plan ? this.version(r.plan).data.plan as PlanProposal : null;
        const difference = c ? delta(b.data.manifest, c.data.manifest) : undefined;
        const changed = (difference?.files ?? []).map(f => f.path).filter(p => !p.startsWith('.git/'));
        const rolePaths = Array.isArray(context.requiredPaths) ? context.requiredPaths as string[] : [];
        const forced = [...(p?.verification.requiredPaths ?? []), ...(p?.verification.checks.flatMap(check => check.fixturePaths) ?? []), ...changed, ...rolePaths];
        const seedBytes = c ? 16 * 1024 : 32 * 1024;
        const inputSources = [...await sources(b, 'base', forced, !!p, seedBytes), ...(c ? await sources(c, 'candidate', forced, !!p, seedBytes) : [])];
        for (const required of forced)
            if (!inputSources.some(source => source.path === required))
                throw new Error('Required text source unavailable: ' + required);
        if (inputSources.reduce((size, source) => size + Buffer.byteLength(source.content, 'utf8'), 0) > 1024 * 1024)
            throw new Error('Selected base/candidate text exceeds supported1MiB role input; narrow accepted source scope');
        const requiredPaths = new Set(forced);
        const requiredScope = inputSources.filter(s => requiredPaths.has(s.path)).map(s => ({ sourceId: s.id, startLine: 1, endLine: s.content.split('\n').length }));
        const selectedReviewEvidence = role === 'adjudicator' && context.stage === 'review-adjudication' ? await this.selectedReviewEvidence(work, context) : null;
        // Failed, unadjudicated predecessor advocacy is not a factual prerequisite
        // for a fresh planner. The ledger and every other role's full claims remain.
        const occurrences = this.inspect(work).occurrences.map((occurrence: any) => {
            if (role !== 'planner' || context.stage !== 'planning')
                return occurrence;
            const producer = this.s.one('SELECT status FROM role_outputs WHERE id=?', occurrence.output);
            if (!producer || !['unusable', 'accounted-intermediate'].includes(producer.status) ||
                this.s.one('SELECT id FROM finding_dispositions WHERE occurrence=? LIMIT 1', occurrence.id))
                return occurrence;
            const { finding: _claim, ...metadata } = occurrence.data;
            return { ...occurrence, data: metadata, producerStatus: producer.status, findingBodyOmitted: true };
        });
        // Current normative text already appears in InputBundle.contracts. Retain
        // the prior text and both asset identities without copying selected text
        // through every immutable snapshot representation into the native prompt.
        const assetIdentities = (assets: Record<string, {
            sha256: string;
        }>) => Object.fromEntries(Object.entries(assets).map(([name, asset]) => [name, { sha256: asset.sha256 }]));
        const refresh = r.data.criteriaRefresh;
        const previousCriteria = refresh ? this.version(refresh.fromContractsVersion) : null;
        const criteriaRefresh = refresh ? { ...refresh,
            previous: { hash: previousCriteria!.hash, text: sharePreviousCriteriaText(previousCriteria!.data.text, criteria.data.text), assets: assetIdentities(previousCriteria!.data.assets) },
            current: { hash: criteria.hash, textSource: 'inputBundle.contracts', assets: assetIdentities(criteria.data.assets) }
        } : null;
        const planningProfile = ['planning', 'planning-challenge', 'planning-adjudication'].includes(String(context.stage)) ? this.verificationSupport(work).capability : undefined;
        const baselinePlan = planningProfile && this.verificationMode(work)?.baselinePlanId;
        const retainedBaselineDuties = baselinePlan ? { planId: baselinePlan, requirements: (this.version(baselinePlan).data.plan as PlanProposal).requirements.filter(requirement =>
            (this.version(baselinePlan).data.plan as PlanProposal).verification.strategies?.some(strategy => strategy.kind === 'base-execution-duty' && strategy.requirementId === requirement.id)),
            meaning: 'Actual historical independently accepted before-edit duties. Preserve their meaning/source; no cross-plan historical witness mapping or implicit removal is supported.' } : undefined;
        const verificationWitnesses = p && Object.hasOwn(p.verification, 'strategies') && ['fresh-review', 'review-adjudication'].includes(String(context.stage)) ? this.strategyWitnesses(work) : undefined;
        const verificationReviewRequirements = verificationWitnesses ? context.stage === 'fresh-review'
            ? verificationWitnesses.filter(item => item.reviewKey === null || item.reviewKey === context.reviewKey)
            : this.strategyReviewEvidence(work).map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] })) : undefined;
        const verificationEvidence = verificationWitnesses?.flatMap(witness => witness.witnessIds.map(id => this.verificationRecord(work, id)));
        const bundle: InputBundle = { requirements: p?.requirements ?? [{ id: 'owner-request', text: r.data.request, source: this.work(work).source }, ...(r.data.ownerRequirements as string[]).map((text, i) => ({ id: `owner-constraint-${i}`, text, source: this.work(work).source }))], contracts: criteria.data.text, sources: inputSources, sourceCatalogue: { format: 1, version: (c ?? b).id, side: c ? 'candidate' : 'base', files: (c ?? b).data.manifest.files.map((file: any) => ({ path: file.path, sha256: file.sha256, size: file.size })) }, requiredScope, context: { requirementSourceIds: this.requirementSources(work), projectProtection: projectProtection(this.s, this.work(work).project), sourceProvenance: parse(this.s.one('SELECT origin FROM sources WHERE id=?', this.work(work).source).origin), delegatingOwnerSource: this.ownerSource(work), sourceInputChain: this.h.sourceImpacts(work), derivedCandidateContext: c?.data.derived ? { kind: c.data.derived, native: c.data.native, effectiveDifferences: c.data.effectiveDifferences, publicationInventory: c.data.publicationInventory, predecessor: c.predecessor } : null, ownerRequest: r.data.request, ownerSource: this.work(work).source, baseVersion: r.base, candidateVersion: r.candidate, planVersion: r.plan, verificationVersion: r.verification, ownerRequirements: r.data.ownerRequirements, sourceInventory: { baseSample: b.data.manifest.files.slice(0, 100), candidateSample: (c?.data.manifest.files ?? []).slice(0, 100), baseCount: b.data.manifest.files.length, candidateCount: c?.data.manifest.files.length ?? 0, baseDependencyLinkSample: (b.data.manifest.dependencyLinks ?? []).slice(0, 20), candidateDependencyLinkSample: (c?.data.manifest.dependencyLinks ?? []).slice(0, 20), baseDependencyLinkCount: b.data.manifest.dependencyLinks?.length ?? 0, candidateDependencyLinkCount: c?.data.manifest.dependencyLinks?.length ?? 0, dependencyLinkDeltaSample: (difference?.dependencyLinks ?? []).slice(0, 20), dependencyLinkDeltaCount: difference?.dependencyLinks?.length ?? 0, inventoryComplete: b.data.manifest.files.length <= 100 && (c?.data.manifest.files.length ?? 0) <= 100 && (b.data.manifest.dependencyLinks?.length ?? 0) <= 20 && (c?.data.manifest.dependencyLinks?.length ?? 0) <= 20, completeManifestRefs: [b.id, ...(c ? [c.id] : [])], selectionProfile: 'named-text-v3 at most32KiB optional seeds with captured-model assembly preflight; staged captured workspace metadata enables actual native-read discovery; VCS/dependency/build metadata not prompt-exposed by default; after plan only accepted requiredPaths, checker fixture paths, position-specific paths and all non-VCS changed files are selected', excluded: [...b.data.manifest.files.map((f: any) => `base:${f.path}`), ...(c?.data.manifest.files ?? []).map((f: any) => `candidate:${f.path}`)].filter(id => !inputSources.some(s => s.id === id)).slice(0, 100), exclusionListMayBePartial: true }, ...(context.stage === 'fresh-review' ? { openObligations: this.pending(work).map(o => {
                        const raw = this.inspect(work).occurrences.find((f: any) => f.id === o.id) as any;
                        return { id: o.id, kind: o.kind, state: o.state, requirementId: raw?.data.finding?.requirementId ?? null, evidence: raw?.data.finding?.evidence ?? [], ...(o.kind === 'reproduction-unresolved' ? { command: o.command, assertions: o.assertions, candidateHash: o.candidateHash } : {}), ...(o.kind === 'check' ? { actualFailure: o, amendment: this.currentAmendments(work).find(a => a.obligationId === o.id), proofs: r.data.amendmentProofs ?? [] } : {}), severity: raw?.data.finding?.severity ?? null };
                    }) } : { occurrences, dispositions: this.inspect(work).dispositions, pendingObligations: this.pending(work) }), checkAmendments: this.currentAmendments(work), amendmentProofs: r.data.amendmentProofs ?? [], criteriaRefresh, checks: this.inspect(work).checks, ...context, ...(planningProfile ? { planningVerificationProfile: planningProfile, ...(retainedBaselineDuties ? { retainedBaselineDuties } : {}) } : {}), ...(verificationReviewRequirements ? { verificationReviewRequirements, verificationEvidence } : {}), ...(diagnostics ? { producerDiagnostics: diagnostics, decisionReferences: this.adjudicationReferences(work, occurrences) } : {}), ...(historical ? { historicalPlanningOperands: historical.value } : {}), ...(selectedReviewEvidence ? { selectedReviewEvidence } : {}) } };
        if (role === 'adjudicator' && context.stage === 'planning-adjudication') {
            const history = this.dispositionHistory(work, context);
            if (history) {
                const pending = new Set(this.pending(work).map(item => item.id));
                bundle.context.dispositions = history.latest;
                bundle.context.dispositionHistory = history.manifest;
                evidence.push({ manifest: history.manifest, contents: history.contents });
                const referenced = new Set([...occurrences.map((row: any) => row.id), ...history.latest.map(row => row.occurrence)]);
                bundle.context.obligationStates = relevantObligationStates(this.s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid', work).map(row => ({ ...row, data: parse(row.data) })), referenced, pending);
            }
        }
        const historicalId = historicalPlanInputId(context);
        if (historical && historicalId) {
            const prepared = prepareHistoricalPlans(historical.value, { id: historicalId, workId: work, epoch: this.work(work).epoch, artifactRoot: path.join(this.h.options.installationHome, 'artifacts') });
            bundle.context.historicalPlanningOperands = prepared.value;
            if (prepared.evidence) evidence.push(prepared.evidence);
        }
        if (role) {
            const { assertModelContextBudget } = await import('../pi/context-budget.js');
            let capabilities: unknown = model?.managed?.evidence.capabilities;
            if (model?.bridge || model?.bridgeProfile) {
                const {admitOwnedClaudeSelection} = await import('../pi/claude-host.js');
                const selected = admitOwnedClaudeSelection(model);
                const catalog = await selected.bridge!.models();
                this.guard(work);
                const entry = catalog.find(item=>item.id===selected.modelId);
                capabilities = entry ? {contextWindow:entry.contextWindow,maxTokens:entry.maxTokens} : null;
            }
            const estimate = () => {
                const framing = roleFraming(role, bundle, Boolean(model?.bridge || model?.bridgeProfile));
                if (model?.bridge || model?.bridgeProfile) assertNativeFormatterSchema(framing.schema);
                // This is a lower bound; native system/tool projection is checked
                // again at the actual SDK stream boundary, never guessed here.
                if (capabilities === undefined)
                    return undefined;
                if (!capabilities || typeof capabilities !== 'object')
                    throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'Captured model capacities are invalid; resolve the original selection before retrying.');
                const framingContext = { systemPrompt: framing.systemPrompt, messages: [{ role: 'user' as const, content: framing.prompt, timestamp: 0 }] };
                const intent: StructuredOutputIntent = {version:1,requestId:'preallocation-estimate',binding:{role},schema:framing.schema,maxNativeTurns:16};
                return assertModelContextBudget(
                    capabilities as Parameters<typeof assertModelContextBudget>[0],
                    model?.bridge || model?.bridgeProfile ? structuredOutputContext(framingContext,intent) : framingContext);
            };
            const optional = bundle.sources.some(source => !requiredPaths.has(source.path));
            let omitOptional = false;
            try {
                const budget = estimate();
                // Leave native/tool headroom when selecting optional seeds only.
                omitOptional = optional && budget !== undefined && budget.availableInput - budget.estimatedInput < 8192;
            }
            catch (error) {
                if (!optional || !(error instanceof ModelContextBudgetError && error.code === 'MODEL_CONTEXT_LIMIT' ||
                    error instanceof Error && error.message === 'Role prompt exceeds2MiB profile'))
                    throw error;
                omitOptional = true;
            }
            if (omitOptional) {
                bundle.sources = bundle.sources.filter(source => requiredPaths.has(source.path));
                const inventory = bundle.context.sourceInventory as Record<string, unknown>;
                inventory.excluded = [...b.data.manifest.files.map((file: any) => `base:${file.path}`), ...(c?.data.manifest.files ?? []).map((file: any) => `candidate:${file.path}`)]
                    .filter(id => !bundle.sources.some(source => source.id === id)).slice(0, 100);
                // Never refuse mandatory inputs merely for lacking speculative
                // headroom. An unavoidable known lower-bound overflow does hold
                // before INITIAL, reservation or any native allocation.
                estimate();
            }
        }
        historical?.assertCurrent();
        return { bundle, evidence, assertCurrent: historical?.assertCurrent ?? (() => {}) };
    }
    private reserve(work: string, role: Role | null, context: Record<string, unknown>, staging: string, captureOnly = false) {
        if (this.operations.get(work)?.admittedState === 'DELIVERED') throw Error('Delivered material coverage recovery cannot allocate execution');
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(work);
        if (this.h.busy(work) && !this.operations.has(work))
            throw new Error('Work busy');
        this.guard(work);
        const runtimeProfile = this.h.options.runtimeProfile ? Object.freeze({ ...this.h.options.runtimeProfile }) : undefined;
        if (!captureOnly && !runtimeProfile)
            throw new ControllerError('MISSING_RUNTIME', 'Role/check requires runtime profile', 'Supply trusted client/context/image', work);
        return this.s.tx(() => {
            const w = this.work(work);
            if (w.state === 'UNKNOWN')
                throw new Error('Cleanup unknown');
            if (w.state !== 'ACTIVE')
                throw new Error('Explicit drive/resume required; stages cannot reactivate work');
            const current = this.work(work);
            const e = this.budget(work, 'execution'), resolution = role && resolutionRoles.has(role);
            if (e.consumed + e.reserved >= e.limit)
                throw new ExecutionAdmissionRefusal('BUDGET_EXHAUSTED', 'Execution allowance exhausted', 'Extend retained execution allowance', work);
            if (resolution) {
                const b = this.budget(work, 'resolution');
                if (b.consumed + b.reserved >= b.limit)
                    throw new ControllerError('RESOLUTION_EXHAUSTED', 'Resolution allowance exhausted', 'Extend retained resolution allowance; pending findings remain', work);
                this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', current.lineage, 'resolution');
            }
            this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', current.lineage, 'execution');
            const runId = randomUUID(), launchId = randomUUID();
            this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, work, current.epoch, current.generation, 'CREATED', staging, 'reserved', JSON.stringify({ kind: role ? 'governed-role' : 'governed-check', projectProtection: projectProtection(this.s, current.project), runtimeProfile, role, launchId, controllerPid: process.pid, ...(role ? { modelIdentity: context.modelIdentity, modelMode: context.modelMode } : {}) }));
            if (role)
                this.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', launchId, work, runId, role, current.epoch, 'CREATED', resolution ? 'reserved' : 'none', JSON.stringify({ inputVersions: { contracts: this.row(work).data.contractsVersion, requirements: this.row(work).data.requirementVersion ?? null, base: this.row(work).base, candidate: this.row(work).candidate, plan: this.row(work).plan, verification: this.row(work).verification }, ...context }));
            for (const row of this.s.all('SELECT * FROM obligations WHERE work=?', work)) {
                const o = parse(row.data);
                if (o.kind === 'diagnostic' && o.recoverySource && !o.replacementLaunch && !o.reentryRun) {
                    if (o.launchId) {
                        const old = this.s.one('SELECT role FROM role_launches WHERE id=?', o.launchId);
                        if (old?.role === role)
                            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, replacementLaunch: launchId, reentryRun: runId }), row.id);
                    }
                    else if (!role && o.checkId === context.checkId)
                        this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, reentryRun: runId }), row.id);
                }
            }
            return { runId, launchId, epoch: current.epoch, resolution, runtimeProfile };
        });
    }
    private settleRole(launchId: string) {
        const l = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId);
        if (l?.resolution_reservation === 'reserved') {
            this.s.run('UPDATE budgets SET reserved=reserved-1,consumed=consumed+1 WHERE lineage=? AND kind=?', this.work(l.work).lineage, 'resolution');
            this.s.run('UPDATE role_launches SET resolution_reservation=? WHERE id=?', 'consumed', launchId);
        }
    }
    private expectations(candidate: string, check: any) {
        if (!Array.isArray(check.expectationPaths))
            return null;
        const manifest = this.version(candidate).data.manifest as Manifest;
        const inputs = [];
        for (const path of check.expectationPaths) {
            const file = manifest.files.find(file => file.path === path);
            if (!file)
                return null;
            inputs.push({ path, sha256: file.sha256, executable: file.effectiveMode & 0o111 });
        }
        return inputs;
    }
    private registerReproduction(work: string, launchId: string, occurrence: string, finding: any, execution: {
        events: RoleExecution['events'];
    }) {
        if (!finding?.reproduction)
            return;
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId);
        const unverified = (reason: string) => {
            const metadata = { status: 'unverified', profile: 'reviewer-frozen-candidate-only', reason, recovery: 'Run actual required checks on the produced immutable candidate and independently disposition the original finding' };
            const original = this.s.one('SELECT data FROM finding_occurrences WHERE id=?', occurrence);
            if (original)
                this.s.run('UPDATE finding_occurrences SET data=? WHERE id=?', JSON.stringify({ ...parse(original.data), reproductionEvidence: metadata }), occurrence);
            this.h.observe(launch.run, { type: 'unverified-reproduction', launchId, occurrence, ...metadata });
        };
        if (launch.role !== 'reviewer') {
            unverified('Nonreviewer execution evidence is not certified against an immutable reviewed candidate');
            return;
        }
        let validFinding = true;
        try { assertFinding(finding); } catch { validFinding = false; }
        if (!validFinding) {
            unverified('Malformed original finding cannot certify reproduction; retain the raw claim for independent diagnosis');
            return;
        }
        const input = parse(launch.data).inputVersions, repro = finding.reproduction, plan = input.plan ? this.version(input.plan).data.plan : null;
        const starts = execution.events.filter(e => e.type === 'tool_execution_start' && e.toolCallId === repro.toolCallId), ends = execution.events.filter(e => e.type === 'tool_execution_end' && e.toolCallId === repro.toolCallId), start = starts[0], end = ends[0], actual = end?.result as any, args = start?.args as any, structured = actual?.structuredContent;
        const parsed = typeof structured?.output === 'string' ? parseCheckOutput(structured.output) : null;
        const bound = starts.length === 1 && ends.length === 1 && launch.role === 'reviewer' && input.candidate && plan?.requirements.some((r: any) => r.id === finding.requirementId) && start?.toolName === 'bash' && args?.command === repro.command && end?.toolName === 'bash' && !structured?.truncated && Number.isInteger(structured?.exit_code) && parsed?.value && !parsed.issues.length && repro.assertions.length && repro.assertions.every((id: string) => parsed.value!.assertions.some(a => a.id === id));
        if (!bound) {
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `repro-diagnostic-${occurrence}`, work, JSON.stringify({ kind: 'reproduction-unresolved', occurrence, launchId, candidateHash: input.candidate ? this.version(input.candidate).hash : null, command: repro.command, assertions: repro.assertions, guaranteeId: finding.requirementId, state: 'pending', reason: 'Declared reproduction lacks actual untruncated bound assertion receipt' }));
            return;
        }
        const check = { id: `review-repro-${hash({ command: repro.command, guaranteeId: finding.requirementId, assertions: repro.assertions, expectationPaths: repro.expectationPaths ?? null })}`, command: repro.command, guaranteeIds: [finding.requirementId], assertions: repro.assertions, timeoutMs: 30000, fixturePaths: plan.verification.requiredPaths, ...(repro.expectationPaths === undefined ? {} : { expectationPaths: repro.expectationPaths }) }, expectations = this.expectations(input.candidate, check), status = repro.assertions.some((id: string) => parsed.value!.assertions.some(a => a.id === id && !a.passed)) ? 'fail' : 'pass', receipt = randomUUID();
        this.s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)', receipt, work, launch.run, input.candidate, input.verification, check.id, status, JSON.stringify({ producer: 'native-review-reproduction', toolCallId: repro.toolCallId, launchId, actual: structured, parsed, check, expectations, cleanup: parse(launch.data).cleanup ?? 'not-recorded-in-launch; see owned run cleanup receipt' }));
        for (const old of this.pending(work).filter(o => o.kind === 'reproduction-unresolved' && o.candidateHash === this.version(input.candidate).hash && o.command === repro.command && hash(o.assertions) === hash(repro.assertions) && o.guaranteeId === finding.requirementId))
            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...old, state: 'resolved', receipt, replacementOccurrence: occurrence }), old.id);
        if (status === 'fail')
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `check-${input.candidate}-${check.id}-${hash(check)}`, work, JSON.stringify({ kind: 'check', checkId: check.id, candidate: input.candidate, verification: input.verification, checkBinding: hash(check), check, expectations, guaranteeIds: check.guaranteeIds, occurrence, receipt, state: 'pending' }));
    }
    private collect(work: string, launchId: string, execution: Pick<RoleExecution, 'evidenceReads' | 'role' | 'rawFinal' | 'issues' | 'exposures' | 'terminal' | 'historyRef' | 'rawFinalTruncated' | 'protocol' | 'events' | 'nativeSource' | 'providerFailure'> & {
        providerRequests: number | null;
        nativeEntryId?: string;
        harvestedFindings?: unknown[];
        omittedFindingCount?: number;
        materialSources?: unknown[];
        accountingKey?: string;
        materialAssessment?: {version:1; source:unknown};
    }, usable: boolean, accountingOnly = false) {
        if (execution.nativeEntryId) {
            const previous = execution.accountingKey
                ? this.s.one("SELECT * FROM role_outputs WHERE launch=? AND json_extract(data,'$.accountingKey')=?", launchId, execution.accountingKey)
                : this.s.one("SELECT * FROM role_outputs WHERE launch=? AND json_extract(data,'$.nativeEntryId')=? AND json_extract(data,'$.accountingKey') IS NULL", launchId, execution.nativeEntryId);
            if (previous) {
                if (execution.accountingKey) {
                    const metadata = parse(previous.data), findings = execution.harvestedFindings ?? [];
                    const occurrences = this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal', previous.id);
                    if (previous.status !== 'accounted-intermediate' || previous.raw !== execution.rawFinal ||
                        hash(metadata.harvestedFindings) !== hash(findings) || metadata.nativeEntryId !== execution.nativeEntryId ||
                        hash(metadata.materialSources ?? null) !== hash(execution.materialSources ?? null) ||
                        metadata.rawFinalTruncated !== execution.rawFinalTruncated || metadata.omittedFindingCount !== (execution.omittedFindingCount ?? 0) ||
                        hash(metadata.materialAssessment ?? null) !== hash(execution.materialAssessment ?? null) ||
                        occurrences.length !== findings.length + (execution.omittedFindingCount ? 1 : 0) + (execution.materialAssessment ? 1 : 0) ||
                        findings.some((finding, index) => occurrences[index]?.ordinal !== index || occurrences[index]?.work !== work ||
                            parse(occurrences[index].data).launchId !== launchId || parse(occurrences[index].data).role !== execution.role ||
                            hash(parse(occurrences[index].data).finding) !== hash(finding)) ||
                        execution.materialAssessment && hash(parse(occurrences.at(-1).data).finding) !== hash(materialDiagnosisFinding(previous.id)))
                        throw Error('Original material accounting changed or is incomplete');
                }
                return previous.id;
            }
        }
        const output = randomUUID();
        this.s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', output, launchId, execution.rawFinal, accountingOnly ? 'accounted-intermediate' : usable ? 'usable' : 'unusable', JSON.stringify({ ...(execution.accountingKey ? { accountingKey: execution.accountingKey } : {}), ...(execution.materialAssessment ? {materialAssessment:execution.materialAssessment} : {}), ...(execution.providerFailure && !accountingOnly && execution.terminal === 'error' ? { providerFailure: execution.providerFailure } : {}), ...(execution.evidenceReads ? { evidenceReads: execution.evidenceReads } : {}), protocol: execution.protocol, issues: execution.issues, exposures: execution.exposures, terminal: execution.terminal, historyRef: execution.historyRef, providerRequests: execution.providerRequests, rawFinalTruncated: execution.rawFinalTruncated, nativeEntryId: execution.nativeEntryId ?? null, nativeSource: accountingOnly ? null : execution.nativeSource ?? null, harvestedFindings: execution.harvestedFindings ?? null, materialSources: execution.materialSources ?? null, omittedFindingCount: execution.omittedFindingCount ?? 0 }));
        if (execution.omittedFindingCount)
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `raw-incomplete-${launchId}-${execution.nativeEntryId}`, work, JSON.stringify({ kind: 'raw-findings-incomplete', state: 'pending', launchId, output, nativeEntryId: execution.nativeEntryId, historyRef: execution.historyRef, omittedFindingCount: execution.omittedFindingCount, recovery: 'Known findings exceed the initial bounded extraction profile; retain exact native history and restore a supported bounded extraction before eligibility. Replacement clear output or ordinary disposition cannot discharge this producer completeness obligation.' }));
        const raw = rawFindings(execution.rawFinal);
        const findings = [...(execution.harvestedFindings ?? raw.findings)];
        if (execution.omittedFindingCount)
            findings.push({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: `Intermediate native entry contains ${execution.omittedFindingCount} findings exceeding the bounded extraction profile; required diagnosis must inspect the retained full native entry before claiming those observations resolved`, evidence: [output, execution.historyRef ?? 'missing-native-history', execution.nativeEntryId ?? 'missing-native-entry'] });
        if (execution.materialAssessment) findings.push(materialDiagnosisFinding(output));
        if (!accountingOnly && !usable && execution.rawFinal && (!raw.complete || execution.issues.some(i => /duplicate|JSON/i.test(i))))
            findings.push(producerDiagnosisFinding(output));
        for (const [ordinal, finding] of findings.entries()) {
            const occurrence = randomUUID();
            this.s.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)', occurrence, output, ordinal, work, JSON.stringify({ finding, launchId, role: execution.role }));
            this.s.run('INSERT INTO obligations VALUES(?,?,?)', occurrence, work, JSON.stringify({ kind: 'finding', occurrence, state: 'pending' }));
            this.registerReproduction(work, launchId, occurrence, finding, execution);
        }
        if (!usable && !accountingOnly)
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `diagnostic-${launchId}`, work, JSON.stringify({ kind: 'diagnostic', launchId, output, state: 'pending', issues: execution.issues, rawComplete: raw.complete }));
        return output;
    }
    private captureNativeRoleIntent(launchId: string, receipt: Readonly<NativeRoleIntentReceipt> | undefined, checkpoint: unknown) {
        if (!receipt) return;
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', launchId), data = launch && parse(launch.data);
        if (!launch || receipt.launchId !== launchId || receipt.role !== launch.role || receipt.stage !== data.stage ||
            data.nativeRoleIntent && hash(data.nativeRoleIntent) !== hash(receipt))
            throw Error('Native role original dispatch intent changed');
        this.s.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({...data,nativeRoleIntent:receipt,nativeRoleDispatchCheckpoint:data.nativeRoleDispatchCheckpoint ?? checkpoint}), launchId);
    }
    private harvestEntries(work: string, launchId: string, role: Role, entries: any[], execution: any, selected: string | null) {
        const intent = entries.find(e=>e.type==='custom' && e.customType===nativeRoleEntries.intent && e.data?.request?.binding?.launchId===launchId && e.data?.request?.binding?.role===role);
        const sources: Array<{id:string;raw:string;findings:unknown[];materialSources?:unknown[];accountingKey?:string;retainEmpty?:boolean;materialAssessment?:{version:1;source:unknown}}> = [];
        const extractionIssues: Array<{entryId:string;reason:string}> = [];
        let extractionIssueCount = 0;
        const launch = this.s.one('SELECT data FROM role_launches WHERE id=?', launchId);
        const launchData = launch && parse(launch.data);
        try { capturedRoleConstraints(role, launchData ?? {}); }
        catch {
            extractionIssueCount++;
            extractionIssues.push({ entryId: selected ?? launchId, reason: 'Original role carry format unavailable' });
        }
        if (intent) {
            // These records are projections of the original SDK trace. Derive on
            // recovery too: a crash need not have reached materialization.
            const prefixConflicts = new Set<string | null>();
            const original = nativeRoleMaterial(entries,intent.id, (entryId,reason) => {
                if (extractionIssues.length < 64) extractionIssues.push({entryId,reason});
                extractionIssueCount++;
            }, sourceEntryId => prefixConflicts.add(sourceEntryId)), proof = execution.nativeSource;
            const argument = proof && entries.find(e=>e.id===proof.argumentEntryId);
            // Selection alone does not prove that the flat final collector owns
            // every literal claim in the original formatter envelope.
            let selectedProven = false, terminalAlias: string | null = null;
            const flat = rawFindings(execution.rawFinal ?? null);
            const decoded = typeof execution.rawFinal === 'string' ? parseCapturedRoleOutput(execution.rawFinal, role, launchData ?? {}) : null;
            const selectedRead = typeof execution.rawFinal === 'string' ? roleMaterialFindings(execution.rawFinal) : null;
            // A strict unique, closed role root already proves its complete
            // claim domain. Do not impose malformed-envelope node bounds on it.
            const selectedCovered = flat.complete && (decoded?.value && hash(decoded.value.findings) === hash(flat.findings) ||
                selectedRead?.complete && selectedRead.claims.every(claim => claim.findingPath === '/findings' && claim.memberPath.length === 1) &&
                hash(selectedRead.claims.map(claim => claim.finding)) === hash(flat.findings));
            if (proof && selected) {
                try {
                    selectedProven = !execution.rawFinalTruncated && typeof execution.rawFinal === 'string' &&
                        readSelectedRoleOutput(entries, {entryId:selected,sessionId:execution.nativeSessionId,launchId,role,
                            checkpointLeafId:execution.nativeCheckpoint?.leafId,nativeIntent:launchData?.nativeRoleIntent,stage:launchData?.stage}, proof) === execution.rawFinal;
                } catch { /* Unproven selection retains all original material. */ }
                if (!selectedProven) {
                    extractionIssueCount++;
                    if (extractionIssues.length < 64) extractionIssues.push({entryId:selected,reason:'Original selected formatter provenance unavailable'});
                } else {
                    if (decoded?.value && execution.protocol && hash(decoded.value) === hash(execution.protocol))
                        terminalAlias = JSON.stringify(decoded.value);
                }
            }
            const isSelectedFormatter = (material: typeof original[number]) => selectedProven &&
                material.selector === 'formatter-arguments' && material.sourceEntryId === argument?.data.sourceEntryId && material.toolUseId === argument?.data.toolUseId;
            const unownedProofs = new Map<string,typeof original[number]>();
            if (original.some(material=>unownedNativeSelector(material.selector))) {
                try {
                    for (const material of readUnownedNativeMaterials(entries,{sessionId:execution.nativeSessionId,launchId,role,intent:launchData.nativeRoleIntent}))
                        unownedProofs.set(JSON.stringify([material.sourceEntryId,material.selector]),material);
                } catch { /* Exact public source proof is required separately from byte retention. */ }
            }
            const aggregateFrames = new Map<string,typeof original>();
            for (const material of original) if (['formatter-arguments','stream-text'].includes(material.selector))
                for (const frame of material.frames ?? []) aggregateFrames.set(frame,[...(aggregateFrames.get(frame) ?? []),material]);
            const groups = new Map<string,typeof original>();
            for (const material of original) {
                // The same original delta can already be a fully covered view
                // in an old invalid-index formatter aggregate. Prove its frame
                // membership and complete literal coverage, never dedup by text.
                const proved = unownedProofs.get(JSON.stringify([material.sourceEntryId,material.selector]));
                const copySelector = material.selector === 'unowned-input-json-delta' ? 'formatter-arguments' : material.selector === 'unowned-text-delta' ? 'stream-text' : null;
                if (copySelector && proved && hash(proved) === hash(material) && aggregateFrames.get(material.sourceEntryId)?.some(other=>other.selector === copySelector && other.raw === material.raw)) {
                    const read = roleMaterialFindings(material.raw,role);
                    if (read.complete && (copySelector === 'formatter-arguments' || read.claims.every(claim=>claim.findingPath === '/findings' && claim.memberPath.length === 1))) continue;
                }
                if (selectedProven && (material.selector === 'decoded-result-value' && material.sourceEntryId === proof.resultEntryId ||
                    selectedCovered && isSelectedFormatter(material))) continue;
                // Only an exact second representation from this proven terminal
                // result can be omitted. Historical accounting stays immutable
                // and must still pass its original correspondence checks.
                if (terminalAlias !== null && material.selector === 'result-text' && material.sourceEntryId === proof.resultEntryId && material.raw === terminalAlias &&
                    !this.s.one("SELECT id FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=?", launchId, material.sourceEntryId)) continue;
                groups.set(material.sourceEntryId,[...groups.get(material.sourceEntryId) ?? [],material]);
            }
            for (const [id, materials] of groups) {
                const reads = materials.map(material => {
                    let read = roleMaterialFindings(material.raw, role), expanded = false;
                    if (!read.complete && (prefixConflicts.has(null) || prefixConflicts.has(material.sourceEntryId))) read = { ...read, receivedClaimsComplete: false };
                    if (!read.complete) {
                        const decoded = parseCapturedRoleOutput(material.raw, role, launchData ?? {}), flat = rawFindings(material.raw);
                        if (decoded.value && flat.complete && hash(decoded.value.findings) === hash(flat.findings)) {
                            // Unique closed role decoding proves exact root
                            // locations without enlarging malformed-input bounds.
                            read = {complete:true,receivedClaimsComplete:true,claims:flat.findings.map((finding,index) => ({finding,findingPath:'/findings',memberPath:[{key:'findings',ordinal:0}],index}))};
                            expanded = true;
                        }
                    }
                    return {material,read,expanded,
                        source: (({raw, ...source}) => ({...source, rawSha256: hash(raw), rawUtf8Bytes: Buffer.byteLength(raw)}))(material)};
                });
                const covered = new Set<string>();
                const legacy = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=? AND json_extract(data,'$.accountingKey') IS NULL", launchId, id);
                let legacyValid = true;
                for (const row of legacy) {
                    const metadata = parse(row.data), expectedRaw = materials.length === 1 ? materials[0]!.raw : JSON.stringify({format:'native-material/v1',materials});
                    const previousClaims = materials.flatMap(material => rawFindings(material.raw).findings);
                    if (metadata.rawFinalTruncated || metadata.omittedFindingCount || row.raw !== expectedRaw ||
                        hash(metadata.materialSources ?? null) !== hash(reads.map(value => value.source)) ||
                        hash(metadata.harvestedFindings ?? null) !== hash(previousClaims)) { legacyValid = false; break; }
                    const occurrences = this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal', row.id);
                    if (occurrences.length !== previousClaims.length || previousClaims.some((finding, index) => occurrences[index]?.ordinal !== index || occurrences[index]?.work !== work ||
                        parse(occurrences[index].data).launchId !== launchId || parse(occurrences[index].data).role !== role ||
                        hash(parse(occurrences[index].data).finding) !== hash(finding))) { legacyValid = false; break; }
                    for (const value of reads) {
                        const flat = value.read.claims.filter(claim => claim.findingPath === '/findings');
                        const previous = rawFindings(value.material.raw), decoded = parseCapturedRoleOutput(value.material.raw, role, launchData ?? {});
                        const strictFlat = previous.complete && decoded.value && hash(decoded.value.findings) === hash(previous.findings);
                        if (!strictFlat && hash(flat.map(claim => claim.finding)) !== hash(previous.findings)) { legacyValid = false; break; }
                        for (const claim of flat) covered.add(hash({source:value.source,memberPath:claim.memberPath,index:claim.index}));
                    }
                }
                if (!legacyValid) {
                    extractionIssueCount++;
                    if (extractionIssues.length < 64) extractionIssues.push({entryId:id,reason:'Original partial material accounting correspondence unavailable'});
                    continue;
                }
                if (reads.some(value => value.expanded)) {
                    const keyed = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=? AND json_extract(data,'$.accountingKey') IS NOT NULL", launchId, id);
                    const locationKey = (claim: {findingPath:string;memberPath:unknown;index:number}) => hash({findingPath:claim.findingPath,memberPath:claim.memberPath,index:claim.index});
                    const lookups = reads.map(value => new Map(value.read.claims.map(claim => [locationKey(claim),claim])));
                    for (const row of keyed) {
                        const metadata = parse(row.data);
                        if (!Array.isArray(metadata.materialSources)) throw Error('Original material accounting source locations unavailable');
                        const locations = metadata.materialSources.filter((value:any) => value.findingPath !== undefined)
                            .map((value:any) => ({findingPath:value.findingPath,memberPath:value.memberPath,index:value.index}));
                        const matches = reads.map((value,index) => ({...value,index})).filter(value => hash({source:value.source,locations}) === metadata.accountingKey);
                        if (matches.length !== 1) throw Error('Original material accounting source key changed');
                        const value = matches[0]!;
                        if (!value.expanded) continue;
                        const keys: string[] = locations.map(locationKey), lookup = lookups[value.index]!;
                        if (new Set(keys).size !== keys.length || keys.some((key:string) => !lookup.has(key)))
                            throw Error('Original material accounting source locations changed');
                        const claims = keys.map((key:string) => lookup.get(key)!);
                        // Revalidate original rows through the same collector;
                        // only proved locations are covered by old partial rows.
                        this.collect(work,launchId,{...execution,role,protocol:null,rawFinal:value.material.raw,rawFinalTruncated:false,
                            nativeEntryId:id,accountingKey:metadata.accountingKey,harvestedFindings:claims.map(claim=>claim.finding),omittedFindingCount:0,
                            materialSources:locations.length ? locations.map((location:any)=>({...value.source,...location})) : [value.source]},false,true);
                        for (const claim of claims) covered.add(hash({source:value.source,memberPath:claim.memberPath,index:claim.index}));
                    }
                }
                for (const {material, read, source} of reads) {
                    const unowned = unownedNativeSelector(material.selector);
                    let unownedProven = false;
                    if (unowned) {
                        const proved = unownedProofs.get(JSON.stringify([id,material.selector]));
                        unownedProven = !!proved && hash(proved) === hash(material);
                        if (!unownedProven) {
                            extractionIssueCount++;
                            if (extractionIssues.length < 64) extractionIssues.push({entryId:id,reason:'Unowned public source provenance unavailable'});
                        }
                    }
                    const formatter = unowned || material.selector === 'formatter-arguments' || material.selector.startsWith('decoded-formatter-input:') || material.selector === 'decoded-result-value';
                    const literal = formatter ? read.claims : read.claims.filter(claim => claim.findingPath === '/findings');
                    let rootIndex = 0, rootPrefix = true;
                    const claims = literal.filter(claim => {
                        // The legacy flat collector retains only a prefix when a
                        // later array is incomplete. Match direct-root locations
                        // in order; an equal nested value is never covered.
                        if (isSelectedFormatter(material) && claim.findingPath === '/findings' && claim.memberPath.length === 1) {
                            const owned = rootPrefix && rootIndex < flat.findings.length && hash(claim.finding) === hash(flat.findings[rootIndex]);
                            rootIndex++;
                            if (owned) return false;
                            rootPrefix = false;
                        }
                        return !covered.has(hash({source,memberPath:claim.memberPath,index:claim.index}));
                    });
                    const materialAssessment = unownedProven && !read.complete && Buffer.byteLength(material.raw) <= 128 * 1024 && Buffer.from(material.raw).toString('utf8') === material.raw
                        ? {version:1 as const,source} : undefined;
                    if (formatter && !read.receivedClaimsComplete && !materialAssessment) {
                        extractionIssueCount++;
                        if (extractionIssues.length < 64) extractionIssues.push({entryId:id,reason:'Original formatter envelope or literal findings are incomplete or unsupported'});
                    }
                    const locations = claims.map(({finding,...location}) => location);
                    sources.push({id,raw:material.raw,findings:claims.map(claim=>claim.finding),
                        materialSources:locations.length ? locations.map(location=>({...source,...location})) : [source],
                        accountingKey:hash({source,locations}),retainEmpty:formatter && !read.complete,...(materialAssessment ? {materialAssessment} : {})});
                }
            }
        } else for (const entry of entries) {
            if (entry.type!=='message' || entry.message.role!=='assistant' || entry.id===selected) continue;
            const raw = typeof entry.message.content==='string'?entry.message.content:entry.message.content.filter((item:any)=>item.type==='text').map((item:any)=>item.text).join('\n');
            sources.push({id:entry.id,raw,findings:rawFindings(raw).findings});
        }
        if (extractionIssueCount) {
            execution.usable = false;
            execution.issues ??= [];
            execution.issues.push('NATIVE_FINDING_HARVEST: original material extraction unavailable');
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `raw-incomplete-${launchId}-native-material`, work,
                JSON.stringify({kind:'raw-findings-incomplete',state:'pending',launchId,historyRef:execution.historyRef,
                    extractionIssueCount,extractionIssues,recovery:'Restore complete original native material extraction; retain original history and already extracted claims. A replacement clear result cannot discharge this hold.'}));
        }
        for (const entry of sources) {
            const raw = entry.raw, received = entry.findings;
            if (!received.length && !entry.retainEmpty) continue;
            const extractedFits = Buffer.byteLength(JSON.stringify(received)) <= 128 * 1024;
            const tooLarge = Buffer.byteLength(raw) > 128 * 1024, retained = tooLarge ? Buffer.from(raw).subarray(0, 128 * 1024).toString('utf8') : raw;
            this.collect(work, launchId, { ...execution, role, protocol: null, rawFinal: retained, rawFinalTruncated: tooLarge, harvestedFindings: extractedFits ? received : [], omittedFindingCount: extractedFits ? 0 : received.length, nativeEntryId: entry.id, issues: [], exposures: [], terminal: 'incomplete',
                ...(entry.materialSources ? {materialSources:entry.materialSources} : {}), ...(entry.accountingKey ? {accountingKey:entry.accountingKey} : {}), ...(entry.materialAssessment ? {materialAssessment:entry.materialAssessment} : {}) }, false, true);
        }
        return extractionIssueCount === 0;
    }

    private async nativeEntries(runId: string) {
        const run = this.s.one('SELECT data FROM runs WHERE id=?', runId), data = parse(run.data);
        if (!data.historyRef)
            return [];
        const cp = await nativeCheckpoint(data.historyRef, data.nativeCheckpoint);
        if (cp.sessionId !== data.nativeSessionId)
            throw new Error('Native harvested session identity changed');
        const text = await fs.readFile(data.historyRef, 'utf8');
        if (hash(text) !== cp.sha256)
            throw new Error('Native history changed during finding harvest');
        const { parseSessionEntries } = await import('@earendil-works/pi-coding-agent');
        return parseSessionEntries(text);
    }
    private async role(options: ChangeOperation, role: Role, context: Record<string, unknown> = {}, writable = false, assertPrefix?: () => void) {
        options = this.captureOperation(options);
        if (role === 'adjudicator' && context.stage === 'planning-adjudication') context = { ...context, decisionCarry: { version: 2 }, dispositionHistoryInput: { version: 1, id: randomUUID() }, historicalPlansInput: { version: 1, id: randomUUID() } };
        if (writable || role === 'implementer' || role === 'repairer') this.assertEditingVerification(options.workId);
        const selection = await this.selectRoleModel(options, role);
        selection.assertCurrent();
        let model = selection.model;
        if (model.bridge || model.bridgeProfile) {
            const { admitOwnedClaudeSelection } = await import('../pi/claude-host.js');
            model = admitOwnedClaudeSelection(model);
        }
        const r = this.row(options.workId), input = this.version(r.candidate ?? r.base), project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(options.workId).project), staging = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        if (writable && this.h.sourceImpacts(options.workId).some(input => input.data.effectHold))
            throw new Error('New source input requires independent source-fit decision before candidate writes');
        const { bundle: inputBundle, evidence, assertCurrent: assertInputCurrent } = await this.bundle(options.workId, context, role, model);
        const inputEvidenceManifests = roleInputEvidenceManifests(inputBundle.context);
        const historicalInputHash = historicalPlanInputId(context) ? hash(inputBundle.context.historicalPlanningOperands) : undefined;
        assertInputCurrent();
        const decisionReferences = adjudicationDecisionReferences(role, inputBundle.context);
        assertPrefix?.();
        this.guard(options.workId);
        selection.assertCurrent();
        this.assertReviewEvidence(options.workId, inputBundle.context.selectedReviewEvidence);
        const verificationInputBinding = inputBundle.context.verificationReviewRequirements !== undefined
            ? this.verificationInputBinding(options.workId, String(context.stage), context.reviewKey, inputBundle.context.verificationReviewRequirements as { requirementId: string; strategyDigest: string; witnessIds: string[] }[]) : undefined;
        const bounds = defaultRoleBounds;
        const a = this.reserve(options.workId, role, { ...context, inputEvidenceManifests, ...(historicalInputHash ? { historicalInputHash } : {}), ...(decisionReferences ? { decisionReferences } : {}), ...(inputBundle.context.dispositionHistory ? { dispositionHistory: inputBundle.context.dispositionHistory } : {}), ...(inputBundle.context.planningVerificationProfile ? { planningVerificationProfile: inputBundle.context.planningVerificationProfile } : {}), ...(verificationInputBinding ? { verificationInputBinding } : {}), modelMode: selection.mode, modelIdentity: hash(modelConfigurationIdentity(model)), bounds }, staging), handle = this.operations.get(options.workId)!.handle;
        const assertRoleCapture = () => {
            this.h.entry(a.runId);
            const captured = parse(this.s.one('SELECT data FROM role_launches WHERE id=?', a.launchId).data);
            if (hash(adjudicationDecisionReferences(role, inputBundle.context) ?? null) !== hash(decisionReferences ?? null) ||
                hash(adjudicationDecisionReferences(role, captured) ?? null) !== hash(decisionReferences ?? null))
                throw Error('Original role decision references changed after capture');
            if (hash(roleInputEvidenceManifests(inputBundle.context)) !== hash(inputEvidenceManifests) ||
                hash(captured.inputEvidenceManifests) !== hash(inputEvidenceManifests) ||
                historicalInputHash && (hash(inputBundle.context.historicalPlanningOperands) !== historicalInputHash || captured.historicalInputHash !== historicalInputHash))
                throw Error('Original role input evidence changed after capture');
        };
        const captureScope = (role === 'planner' && context.stage === 'planning') || (role === 'challenger' && context.stage === 'planning-challenge');
        const onAbort = () => handle.abort.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.signal?.aborted)
            onAbort();
        let lease: CapacityLease | undefined, identity: NativeIdentity | undefined;
        let scope: ContainerScope | undefined, execution: RoleExecution | undefined, cleanup = 'not-allocated', runtimeAttempted = false, providerAdmissions = 0;
        try {
            const { initializePiHost } = await import('../pi/index.js');
            const host = await initializePiHost({ stateRoot: this.h.state, artifactRoot: path.join(this.h.options.installationHome, 'artifacts') });
            this.h.entry(a.runId); handle.abort.signal.throwIfAborted();
            for (const snapshot of evidence) {
                assertRoleCapture(); assertInputCurrent(); handle.abort.signal.throwIfAborted();
                if (hash(snapshot.contents) !== snapshot.manifest.sha256 || Buffer.byteLength(snapshot.contents) !== snapshot.manifest.bytes)
                    throw Error('Original role input evidence content changed');
                const file = await fs.open(snapshot.manifest.path, 'wx', 0o600);
                try { assertRoleCapture(); assertInputCurrent(); handle.abort.signal.throwIfAborted(); await file.writeFile(snapshot.contents); } finally { await file.close(); }
            }
            assertRoleCapture(); assertInputCurrent(); handle.abort.signal.throwIfAborted();
            identity = this.h.allocateRole({ workId: options.workId, runId: a.runId, launchId: a.launchId, role, ...(typeof context.purpose === 'string' ? { purpose: context.purpose } : typeof context.reviewKey === 'string' ? { purpose: context.reviewKey } : {}) });
            if (captureScope)
                this.captureInputScope(options.workId, a.launchId, inputBundle);
            if (role === 'adjudicator' && ['planning-adjudication', 'review-adjudication'].includes(String(context.stage)))
                await this.captureDiagnosticInput(options.workId, a.launchId, inputBundle);
            lease = await this.h.acquireCapacity({ workId: options.workId, runId: a.runId, epoch: this.work(options.workId).epoch, kind: 'role', signal: handle.abort.signal });
            this.h.entry(a.runId);
            this.h.patchRun(a.runId, 'CAPTURING', { sourceInputHash: hash(this.h.sourceImpacts(options.workId).map(i => [i.input_id, i.revision, i.source])) });
            const copied = await materialize(input.artifact, staging, parse(project.profile), input.hash, handle.abort.signal);
            this.h.patchRun(a.runId, 'CAPTURED', { manifest: copied.manifest, attainedCapture: true });
            const protectedPaths = await scopeProtection(this.s, a.runId, staging);
            this.h.patchRun(a.runId, 'RUNTIME_CREATING', {});
            runtimeAttempted = true;
            scope = await createScope({ ...a.runtimeProfile!, workRoot: staging, stateRoot: path.join(this.h.state, 'runtime'), workId: options.workId, runId: a.runId, protectedPaths, readOnlyWork: !writable, signal: handle.abort.signal });
            handle.scope = scope;
            this.h.patchRun(a.runId, 'RUNNING', { containerId: scope.containerId });
            this.s.run('UPDATE role_launches SET status=? WHERE id=?', 'RUNNING', a.launchId);
            const { runRole } = await import('../workflow/index.js');
            const sourceHash = parse(this.s.one('SELECT data FROM runs WHERE id=?', a.runId).data).sourceInputHash;
            const writeEntry = () => {
                this.h.entry(a.runId);
                if (sourceHash !== hash(this.h.sourceImpacts(options.workId).map(i => [i.input_id, i.revision, i.source])))
                    throw new Error('Changed owner source holds candidate writes until independent source-fit');
            };
            const operations = writable ? { ...(scope.executionContext ? { executionContext: scope.executionContext } : {}), workspaceRoot: scope.workspaceRoot, validatePath: (p: string) => scope!.validatePath(p), readFile: scope.readFile.bind(scope), access: scope.access.bind(scope), exec: (...args: Parameters<ContainerScope['exec']>) => {
                    writeEntry();
                    return scope!.exec(...args);
                }, writeFile: (...args: Parameters<ContainerScope['writeFile']>) => {
                    writeEntry();
                    return scope!.writeFile(...args);
                }, mkdir: (...args: Parameters<ContainerScope['mkdir']>) => {
                    writeEntry();
                    return scope!.mkdir(...args);
                } } : scope;
            execution = await runRole({ nativeIdentity: identity, nativeLifecycle: this.h.nativeLifecycle, coordination: this.h.coordination(identity), launchId: a.launchId, role, ...(inputEvidenceManifests.length ? { inputEvidence: { launchId: a.launchId, manifests: inputEvidenceManifests } } : {}), ...bounds, inputBundle, operations, host, model: model, signal: handle.abort.signal, assertEntry: assertRoleCapture, beforeModelRequest: async (manager, nativeIntent) => {
                    assertRoleCapture();
                    assertInputCurrent();
                    this.assertReviewEvidence(options.workId, inputBundle.context.selectedReviewEvidence);
                    const cp = await nativeCheckpoint(manager.getSessionFile()!);
                    this.assertReviewEvidence(options.workId, inputBundle.context.selectedReviewEvidence);
                    const leafId = manager.getLeafId();
                    if (!leafId)
                        throw new Error('Native role checkpoint absent');
                    assertRoleCapture();
                    assertInputCurrent();
                    this.captureNativeRoleIntent(a.launchId, nativeIntent, {...cp,leafId});
                    this.h.recordModelDispatch(a.runId, { ...cp, leafId });
                    providerAdmissions++;
                }, onHistory: (ref, id) => this.h.recordHistory(a.runId, ref, id), onObservation: event => this.h.observe(a.runId, { ...event, launchId: a.launchId }) });
        }
        catch (error) {
            execution = { launchId: a.launchId, role, rawFinal: null, selectedFinalEntryId: null, rawFinalTruncated: false, providerRequests: providerAdmissions, protocol: null, usable: false, issues: [String(error)], historyRef: null, nativeSessionId: null, nativeCheckpoint: null, terminal: handle.abort.signal.aborted ? 'aborted' : 'error', events: [], exposures: [] };
        }
        finally {
            if (scope) {
                try {
                    cleanup = (await scope.close()).state;
                }
                catch {
                    cleanup = 'quarantined';
                }
            }
            else if (runtimeAttempted) {
                try {
                    cleanup = await this.h.reconcile(a.runId, options.workId);
                }
                catch {
                    cleanup = 'quarantined-unreturned-scope';
                }
            }
            options.signal?.removeEventListener('abort', onAbort);
        }
        let entries: any[] = [], harvestedIdentity:string|null = null;
        try {
            const before = this.materialHistoryIdentity(execution!.historyRef);
            entries = await this.nativeEntries(a.runId);
            if (before !== this.materialHistoryIdentity(execution!.historyRef)) throw Error('Native history changed during role material collection');
            harvestedIdentity = before;
        }
        catch (error) {
            execution!.usable = false;
            execution!.issues.push('NATIVE_FINDING_HARVEST:' + String(error));
        }
        let usable = execution!.usable && cleanup === 'removed' && parse(this.s.one('SELECT data FROM runs WHERE id=?', a.runId).data).sourceInputHash === hash(this.h.sourceImpacts(options.workId).map(i => [i.input_id, i.revision, i.source]));
        try {
            assertRoleCapture();
        }
        catch (error) {
            usable = false;
            execution!.issues.push(String(error));
        }
        const output = this.s.tx(() => {
            this.h.settleBudget(a.runId);
            this.settleRole(a.launchId);
            this.h.patchRun(a.runId, cleanup.startsWith('quarantined') ? 'UNKNOWN' : 'SETTLED', { cleanup, roleOutput: true, ...(execution!.nativeCheckpoint ? {nativeCheckpoint:execution!.nativeCheckpoint} : {}) });
            const selected = execution!.selectedFinalEntryId;
            const complete = this.harvestEntries(options.workId, a.launchId, role, entries, execution!, selected);
            usable = complete && usable;
            this.s.run('UPDATE role_launches SET status=?,data=? WHERE id=?', usable ? 'COMPLETE' : 'UNUSABLE', JSON.stringify({ ...parse(this.s.one('SELECT data FROM role_launches WHERE id=?', a.launchId).data), cleanup, historyRef: execution!.historyRef, nativeSessionId: execution!.nativeSessionId }), a.launchId);
            const output = this.collect(options.workId, a.launchId, { ...execution!, ...(selected ? { nativeEntryId: selected } : {}) }, usable);
            const launch = this.s.one('SELECT * FROM role_launches WHERE id=?',a.launchId);
            if (complete && cleanup === 'removed' && harvestedIdentity && parse(launch.data).nativeRoleIntent)
                this.recordMaterialAccounting(launch,harvestedIdentity);
            return output;
        });
        if (identity)
            this.h.nativeCleanup(identity, { cleanup, settled: true });
        lease?.release({ cleanup, settled: true });
        delete handle.scope;
        if (cleanup.startsWith('quarantined'))
            this.s.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', options.workId);
        if (!usable)
            throw new ControllerError('ROLE_UNAVAILABLE', execution!.issues.join('; ') || cleanup, `Inspect role ${a.launchId}; explicit charged retry`, options.workId, a.runId);
        return { launchId: a.launchId, runId: a.runId, output, protocol: execution!.protocol!, staging, execution: execution!, inputScope: captureScope ? this.inputScopeReceipt(options.workId, a.launchId, output, role, String(context.stage), execution!.selectedFinalEntryId) : null };
    }
    async recoverPublicationJudgment(run: any) {
        const launch = this.s.one('SELECT * FROM role_launches WHERE run=?', run.id), data = parse(run.data);
        if (!launch)
            throw Error('Retained publication judgment registry missing');
        let entries: any[] = [], error: string | null = null;
        try {
            if (data.historyRef && data.modelDispatchAttempted)
                entries = await this.nativeEntries(run.id);
            else if (data.modelDispatchAttempted)
                throw Error('Required publication judgment history absent');
        }
        catch (e) {
            error = String(e);
        }
        this.s.tx(() => {
            this.h.settleBudget(run.id);
            this.settleRole(launch.id);
            this.h.patchRun(run.id, 'INTERRUPTED', { cleanup: 'unbound', publicationHistoryRecovery: error ?? (data.modelDispatchAttempted ? 'actual-native-entries-collected' : 'observed-no-model-dispatch-before-interruption') });
            this.s.run('UPDATE role_launches SET status=? WHERE id=?', 'UNUSABLE', launch.id);
            this.harvestEntries(run.work, launch.id, 'adjudicator', entries, { historyRef: data.historyRef, providerRequests: null, events: this.s.all('SELECT data FROM observations WHERE run=?', run.id).map(o => parse(o.data)) }, null);
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `diagnostic-${launch.id}`, run.work, JSON.stringify({ kind: error ? 'raw-findings-incomplete' : 'diagnostic', launchId: launch.id, state: 'pending', issues: [error ?? 'Actual publication judgment interrupted; explicit charged independent retry retains all raw observations'] }));
            if (this.work(run.work).state !== 'CANCELLED')
                this.s.run('UPDATE works SET state=? WHERE id=?', 'INTERRUPTED', run.work);
        });
        return { runId: run.id, historyCollected: !error };
    }
    publicationBlockers(work: string, exceptOperation?: string) {
        return this.pending(work).filter(o => {
            const occurrence = o.occurrence ? this.s.one('SELECT data FROM finding_occurrences WHERE id=?', o.occurrence) : null, launchId = o.launchId ?? (occurrence ? parse(occurrence.data).launchId : null), launch = launchId ? this.s.one('SELECT data FROM role_launches WHERE id=?', launchId) : null;
            if (!launch)
                return false;
            const data = parse(launch.data);
            return data.stage === 'publication-payload-fit' && (!exceptOperation || data.operationId !== exceptOperation);
        });
    }
    publicationDispositions(work: string, launch: string, protocol: RoleResult, payloadHash: string, operationId: string) {
        const actual = this.s.one('SELECT * FROM role_launches WHERE id=?', launch);
        if (!actual || actual.work !== work || actual.role !== 'adjudicator' || actual.status !== 'COMPLETE' || parse(actual.data).stage !== 'publication-payload-fit' || parse(actual.data).operationId !== operationId)
            throw Error('Actual completed publication adjudicator required');
        const scope = this.s.all("SELECT id FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='publication-payload-fit' AND json_extract(data,'$.operationId')=?", work, operationId).map(l => l.id);
        for (const d of protocol.decisions ?? []) {
            const origin = this.s.one('SELECT data FROM finding_occurrences WHERE id=?', d.occurrenceId);
            if (origin && parse(origin.data).launchId === launch)
                throw Error('Adjudicator cannot disposition its own new findings');
        }
        this.s.tx(() => {
            this.dispositions(work, launch, protocol, scope, (occurrence) => {
                const origin = this.s.one('SELECT * FROM role_launches WHERE id=?', parse(occurrence.data).launchId);
                const before = parse(origin.data).inputVersions?.payloadHash, after = parse(actual.data).inputVersions?.payloadHash;
                if (!before || before === payloadHash || after !== payloadHash || origin.id === launch || parse(origin.data).operationId !== operationId || parse(origin.data).actionFamily !== parse(actual.data).actionFamily)
                    throw Error('Payload repair needs changed exact sealed bytes and a distinct current completed judgment');
                return true;
            });
            // An explicit complete independent retry may supersede producer unavailability, never omitted raw findings.
            for (const row of this.s.all('SELECT * FROM obligations WHERE work=?', work)) {
                const o = parse(row.data), producer = o.launchId ? this.s.one('SELECT * FROM role_launches WHERE id=?', o.launchId) : null;
                if (o.kind === 'diagnostic' && o.state !== 'resolved' && o.launchId !== launch && scope.includes(o.launchId) && producer && ['UNUSABLE', 'INTERRUPTED'].includes(producer.status))
                    this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, state: 'resolved', replacementLaunch: launch, method: 'explicit-complete-independent-retry-with-raw-occurrence-accounting' }), row.id);
            }
        });
        return this.s.all('SELECT * FROM obligations WHERE work=?', work).map(o => ({ id: o.id, ...parse(o.data) })).filter(o => o.state !== 'resolved' && (scope.includes(o.launchId) || o.occurrence && this.s.one('SELECT data FROM finding_occurrences WHERE id=?', o.occurrence) && scope.includes(parse(this.s.one('SELECT data FROM finding_occurrences WHERE id=?', o.occurrence).data).launchId)));
    }
    /** Action-scoped fresh judgment shares registry/collector; it grants no software completion. */
    async publicationJudgment(options: ChangeOperation & {
        inputBundle: InputBundle;
        sourceFingerprint: string;
        operationId: string;
    }) {
        options = this.captureOperation({ ...options, inputBundle: structuredClone(options.inputBundle) });
        this.applicationBinding(options);
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(options.workId);
        if (!await this.restoreSettledRoleMaterial(options)) throw Error('Original role material restoration remains incomplete');
        this.h.assertOpen(); this.applicationBinding(options); this.h.assertApplicationAdmission?.(options.workId);
        options.signal?.throwIfAborted();
        const work = this.work(options.workId);
        if (this.h.busy(work.id) || work.state !== 'ACTIVE')
            throw Error('Publication judgment requires an idle active retained work');
        if (this.pending(work.id).some(o => o.kind === 'raw-findings-incomplete'))
            throw Error('Restore supported raw finding extraction before paid judgment');
        const owned = this.s.one('SELECT * FROM effect_operations WHERE id=?', options.operationId);
        if (!owned || owned.work !== work.id || parse(owned.data).kind !== 'publication' || options.inputBundle.context.operationId !== options.operationId)
            throw Error('Host-bound exact publication operation required before native judgment');
        const ownedData = parse(owned.data), hasAssignment = Object.hasOwn(ownedData, 'assignmentId');
        if (hasAssignment && (typeof ownedData.assignmentId !== 'string' || !ownedData.assignmentId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: malformed publication assignment');
        const assignment = hasAssignment ? this.s.one('SELECT * FROM conversation_assignments WHERE id=?', ownedData.assignmentId) : undefined;
        if (hasAssignment && (!assignment || assignment.source_conversation !== ownedData.origin?.identity?.conversationId || assignment.state === 'CANCELLED' || assignment.work !== work.id || assignment.target !== ownedData.conversationId ||
            parse(assignment.data).effectOperationId !== owned.id || parse(assignment.data).operation !== 'effect-publication' || hash(parse(assignment.data).source) !== hash(ownedData.origin?.identity)))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: publication originating assignment changed');
        const ownedBefore = JSON.stringify([owned, assignment]);
        const assertOwnedCurrent = () => {
            if (JSON.stringify([this.s.one('SELECT * FROM effect_operations WHERE id=?', options.operationId), hasAssignment ? this.s.one('SELECT * FROM conversation_assignments WHERE id=?', ownedData.assignmentId) : undefined]) !== ownedBefore)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: publication target changed during resolution or before reservation');
            if (hasAssignment)
                assertOrdinaryEffectSource(this.s, work.id, ownedData.origin?.identity);
        };
        assertOwnedCurrent();
        const selection = await this.selectRoleModel(options, 'adjudicator', true);
        selection.assertCurrent();
        assertOwnedCurrent();
        const model = selection.model;
        const bundle = structuredClone(options.inputBundle), runId = randomUUID(), launchId = randomUUID(), bounds = defaultRoleBounds;
        const staging = path.join(this.h.options.installationHome, 'control', 'publication', launchId), handle: Handle = { abort: new AbortController() };
        const role = 'adjudicator' as const;
        if (model?.bridge || model?.bridgeProfile) assertNativeFormatterSchema(roleFraming(role, bundle, true).schema);
        let registered = false;
        try {
            this.s.tx(() => {
                selection.assertCurrent();
                assertOwnedCurrent();
                for (const kind of ['execution', 'resolution']) {
                    const b = this.budget(work.id, kind);
                    if (!b || b.consumed + b.reserved >= b.limit)
                        throw Error('Retained publication judgment allowance exhausted');
                    this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', work.lineage, kind);
                }
                this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, work.id, work.epoch, work.generation, 'CREATED', staging, 'reserved', JSON.stringify({ kind: 'publication-judgment', bounds, modelMode: selection.mode, modelIdentity: hash(modelConfigurationIdentity(model)), operationId: options.operationId, controllerPid: process.pid, sourceFingerprint: options.sourceFingerprint, unbound: true }));
                this.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', launchId, work.id, runId, role, work.epoch, 'CREATED', 'reserved', JSON.stringify({ stage: 'publication-payload-fit', bounds, modelMode: selection.mode, modelIdentity: hash(modelConfigurationIdentity(model)), operationId: options.operationId, actionFamily: bundle.context.actionFamily, inputVersions: { contracts: hash(bundle.contracts), sourceFingerprint: options.sourceFingerprint, payloadHash: bundle.context.payloadHash }, bundleHash: hash(bundle) }));
                this.h.register(work.id, handle);
                registered = true;
            });
        }
        catch (error) {
            // A failed COMMIT after registration must not leave the work busy.
            if (registered)
                this.h.unregister(work.id);
            throw error;
        }
        const stop = () => handle.abort.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        let identity: NativeIdentity | undefined, lease: CapacityLease | undefined, execution: RoleExecution | undefined, admitted = false, providerRequests = 0;
        const entry = () => { this.h.entry(runId); handle.abort.signal.throwIfAborted(); };
        try {
            identity = this.h.allocateRole({ workId: work.id, runId, launchId, role, purpose: 'Publication payload/source fit only' });
            lease = await this.h.acquireCapacity({ workId: work.id, runId, epoch: work.epoch, kind: 'role', signal: handle.abort.signal });
            admitted = true;
            entry();
            await privateDirectory(path.join(this.h.options.installationHome, 'control'));
            await privateDirectory(path.dirname(staging));
            await privateDirectory(staging);
            const deny = (): never => { throw Error('PUBLICATION_PAYLOAD_SCOPE: project/host operations unavailable; use actual supplied payload/source evidence'); };
            const operations = { workspaceRoot: staging, validatePath: (p: string): string => path.resolve(p) === staging ? staging : deny(), exec: async (): Promise<{
                    exitCode: number | null;
                }> => deny(), readFile: async (): Promise<Buffer> => deny(), access: async (): Promise<void> => deny(), writeFile: async (): Promise<void> => deny(), mkdir: async (): Promise<void> => deny() };
            this.h.patchRun(runId, 'RUNNING', { unbound: true });
            this.s.run('UPDATE role_launches SET status=? WHERE id=?', 'RUNNING', launchId);
            const { initializePiHost } = await import('../pi/index.js'), { runRole } = await import('../workflow/index.js');
            const host = await initializePiHost({ stateRoot: this.h.state, artifactRoot: path.join(this.h.options.installationHome, 'artifacts') });
            execution = await runRole({ launchId, role, inputBundle: bundle, operations, host, model: model, signal: handle.abort.signal, ...bounds, nativeIdentity: identity, nativeLifecycle: this.h.nativeLifecycle, assertEntry: entry, beforeModelRequest: async (manager, nativeIntent) => {
                    entry();
                    const cp = await nativeCheckpoint(manager.getSessionFile()!);
                    const leafId = manager.getLeafId();
                    if (!leafId)
                        throw Error('Actual publication judgment native checkpoint absent');
                    entry();
                    this.captureNativeRoleIntent(launchId, nativeIntent, {...cp,leafId});
                    this.h.recordModelDispatch(runId, { ...cp, leafId });
                    providerRequests++;
                }, onHistory: (ref, id) => this.h.recordHistory(runId, ref, id), onObservation: event => this.h.observe(runId, { ...event, launchId }) });
        }
        catch (error) {
            execution = { launchId, role, rawFinal: null, selectedFinalEntryId: null, rawFinalTruncated: false, providerRequests, protocol: null, usable: false, issues: [String(error)], historyRef: null, nativeSessionId: null, nativeCheckpoint: null, terminal: handle.abort.signal.aborted ? 'aborted' : 'error', events: [], exposures: [] };
        }
        let entries: any[] = [];
        try {
            entries = await this.nativeEntries(runId);
        }
        catch (error) {
            execution!.usable = false;
            execution!.issues.push('NATIVE_FINDING_HARVEST:' + String(error));
        }
        let usable = execution!.usable;
        try {
            entry();
        }
        catch {
            usable = false;
        }
        let output: string;
        try {
            output = this.s.tx(() => {
                this.h.settleBudget(runId);
                this.settleRole(launchId);
                this.h.patchRun(runId, 'SETTLED', { cleanup: 'unbound', roleOutput: true, ...(execution!.nativeCheckpoint ? {nativeCheckpoint:execution!.nativeCheckpoint} : {}) });
                usable = this.harvestEntries(work.id, launchId, role, entries, execution!, execution!.selectedFinalEntryId) && usable;
                this.s.run('UPDATE role_launches SET status=?,data=? WHERE id=?', usable ? 'COMPLETE' : 'UNUSABLE', JSON.stringify({ ...parse(this.s.one('SELECT data FROM role_launches WHERE id=?', launchId).data), cleanup: 'unbound', historyRef: execution!.historyRef, nativeSessionId: execution!.nativeSessionId }), launchId);
                return this.collect(work.id, launchId, { ...execution!, ...(execution!.selectedFinalEntryId ? { nativeEntryId: execution!.selectedFinalEntryId } : {}) }, usable);
            });
        }
        finally {
            if (identity)
                this.h.nativeCleanup(identity, { cleanup: 'unbound', settled: true });
            lease?.release({ cleanup: 'unbound', settled: true });
            options.signal?.removeEventListener('abort', stop);
            this.h.unregister(work.id);
        }
        return { launchId, runId, output, usable, admitted, protocol: execution!.protocol, issues: execution!.issues };
    }
    /** Resolve only immutable initial-BASE meaning; optional raw extras remain untrusted. */
    private resolveImplementationCarry(work: string, proposal: ImplementationCarry, plan: PlanProposal, judge: string) {
        const r = this.row(work), occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?', proposal.occurrenceId, work);
        if (!occurrence)
            throw new Error('Implementation carry requires an actual same-work occurrence');
        const data = parse(occurrence.data);
        assertFindingCore(data.finding);
        if (data.finding.severity !== 'blocking')
            throw new Error('Implementation carry requires a blocking core claim');
        const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', occurrence.output);
        const origin = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', data.launchId, work);
        const adjudicator = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', judge, work);
        if (!output || !origin || output.launch !== origin.id || !['usable', 'unusable', 'accounted-intermediate'].includes(output.status) ||
            !adjudicator || adjudicator.role !== 'adjudicator' || adjudicator.status !== 'COMPLETE' || origin.id === judge)
            throw new Error('Implementation carry requires distinct actual origin and completed independent judge');
        const input = parse(origin.data), judgment = parse(adjudicator.data);
        const stages: Record<string, string> = { planner: 'planning', challenger: 'planning-challenge', adjudicator: 'planning-adjudication' };
        if (!stages[origin.role] || input.stage !== stages[origin.role] || input.inputVersions?.candidate !== null ||
            !input.inputVersions.base || judgment.stage !== 'planning-adjudication' || judgment.inputVersions?.base !== r.base ||
            judgment.inputVersions?.contracts !== r.data.contractsVersion)
            throw new Error('Implementation carry requires bound initial BASE and current planning judgment');
        const baseline = this.version(proposal.baselineVersion);
        if (baseline.work !== work || baseline.kind !== 'base' || baseline.id !== input.inputVersions.base || baseline.id !== r.base)
            throw new Error('Implementation carry baseline is foreign, stale or not the actual origin BASE');
        const strategies = plan.verification.strategies;
        const repairConsumer = (id: string) => plan.verification.checks.some(check => check.guaranteeIds.includes(id) &&
            (!strategies || strategies.some(strategy => strategy.requirementId === id && strategy.kind === 'consumer-cases' && strategy.checkIds.includes(check.id))));
        if (!proposal.requirementIds.length || new Set(proposal.requirementIds).size !== proposal.requirementIds.length ||
            proposal.requirementIds.some(id => !plan.requirements.some(requirement => requirement.id === id) ||
                (strategies ? !strategies.some(strategy => strategy.requirementId === id) : !repairConsumer(id))) ||
            (strategies && !proposal.requirementIds.some(repairConsumer)) || coverageIssue(plan))
            throw new Error('Implementation carry needs explicit current requirement mapping and actual planned coverage');
        if (!proposal.reason.trim())
            throw new Error('Implementation carry needs independent mapping and remedy rationale');
        return { ...proposal, historicalRequirementId: data.finding.requirementId, originLaunchId: origin.id, originOutputId: output.id,
            baselineHash: baseline.hash, planningJudge: judge, planHash: hash(plan), requirementsHash: hash(plan.requirements), contractsVersion: r.data.contractsVersion };
    }
    /** Every pending duplicate is explicit; this never deduplicates the raw ledger. */
    private carryDecisionChains(proposals: ImplementationCarry[], decisions: NonNullable<RoleResult['decisions']>) {
        const ids = new Set(proposals.map(item => item.occurrenceId));
        if (ids.size !== proposals.length)
            throw new Error('Duplicate implementation carry occurrence');
        const byId = new Map(decisions.map(item => [item.occurrenceId, item]));
        if (byId.size !== decisions.length)
            throw new Error('Duplicate implementation carry decision');
        for (const proposal of proposals) {
            let id = proposal.occurrenceId;
            const seen = new Set<string>();
            while (true) {
                if (!ids.has(id) || seen.has(id))
                    throw new Error('Every pending equivalent member needs an explicit acyclic carry');
                seen.add(id);
                const decision = byId.get(id);
                if (!decision || decision.resolution)
                    throw new Error('Implementation carry needs current independent validity without repair');
                if (decision.disposition === 'upheld')
                    break;
                if (decision.disposition !== 'equivalent' || !decision.equivalentTo)
                    throw new Error('Implementation carry needs an upheld root or explicit equivalent chain');
                id = decision.equivalentTo;
            }
        }
    }
    private acceptedImplementationCarries(work: string, plan: PlanProposal, judge: string, protocol: RoleResult) {
        const proposals = implementationCarryProposals(protocol, planningDecisionCarry('adjudicator', parse(this.s.one('SELECT data FROM role_launches WHERE id=?', judge).data)));
        if (!proposals.length)
            return [];
        if (!protocol.planAccepted || protocol.ownerDecisionRequired?.length)
            throw new Error('Implementation carry requires an accepted independent current plan');
        this.carryDecisionChains(proposals, protocol.decisions ?? []);
        const pending = this.pending(work);
        return proposals.map(proposal => {
            if (!pending.some(item => item.id === proposal.occurrenceId && item.kind === 'finding'))
                throw new Error('Implementation carry must name each actual still-pending finding');
            return { ...this.resolveImplementationCarry(work, proposal, plan, judge),
                sourceInputFingerprint: hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source])) };
        });
    }
    private planningOutputHash(output: any) {
        return hash([output.id, output.launch, output.raw, output.status, output.data]);
    }
    /** Resolve the literal amendment or its explicitly bound original proposal. */
    private acceptedPlanningProposal(work: string, judgeId: string, protocol: RoleResult, plannerLaunch?: string): PlanProposal | undefined {
        if (Object.hasOwn(protocol, 'acceptedPlan')) return protocol.acceptedPlan;
        const judge = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', judgeId, work), metadata = judge && parse(judge.data);
        const approval = metadata && readProposalApproval('adjudicator', metadata);
        if (!approval) return metadata?.planningVerificationProfile?.supported ? undefined : metadata?.planProposal;
        const original = this.s.one('SELECT * FROM role_outputs WHERE id=?', approval.plannerOutputId);
        const producer = original && this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', original.launch, work);
        const run = producer && this.s.one('SELECT * FROM runs WHERE id=?', producer.run);
        const origin = producer && parse(producer.data), scope = metadata.plannerInputScope, originalMetadata = original && parse(original.data), runData = run && parse(run.data);
        const parsed = original?.status === 'usable' && typeof original.raw === 'string' ? parseRoleOutput(original.raw, 'planner').value : null;
        const proposal = parsed?.plan, { outputId, ...capturedScope } = scope;
        if (!plannerLaunch || !producer || producer.id !== plannerLaunch || producer.id === judgeId || producer.role !== 'planner' || producer.status !== 'COMPLETE' ||
            producer.epoch !== judge.epoch || origin.stage !== 'planning' || origin.cleanup !== 'removed' ||
            !run || run.work !== work || run.epoch !== producer.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || !runData || runData.cleanup !== 'removed' ||
            runData.kind !== 'governed-role' || runData.role !== 'planner' || runData.launchId !== producer.id ||
            scope.workId !== work || scope.launchId !== producer.id || scope.runId !== producer.run || scope.epoch !== producer.epoch ||
            !origin.inputScope || hash(capturedScope) !== hash(origin.inputScope) || hash(scope.inputVersions) !== hash(origin.inputVersions) ||
            origin.inputVersions?.base !== metadata.inputVersions?.base || origin.inputVersions?.contracts !== metadata.inputVersions?.contracts ||
            !proposal || hash(proposal) !== approval.proposalHash || !originalMetadata || !originalMetadata.protocol || hash(originalMetadata.protocol) !== hash(parsed) ||
            originalMetadata.terminal !== 'complete' || originalMetadata.rawFinalTruncated !== false || originalMetadata.omittedFindingCount !== 0 ||
            !originalMetadata.nativeEntryId || this.planningOutputHash(original) !== approval.plannerOutputHash)
            throw Error('Bound proposal approval lost its selected original planner/input correspondence');
        const capability = readPlanningVerificationProfile('adjudicator', metadata);
        if (!capability) throw Error('Bound proposal approval lost its captured planning capability');
        assertApprovedProposal(approval, { planningProfile: capability, sourceIds: this.requirementSources(work) });
        return approval.proposal;
    }
    /** Only a host-validated current plan carry enables an origin BASE closure. */
    private carriedBaseline(work: string, occurrence: any): string | null {
        const r = this.row(work);
        if (!r.plan)
            return null;
        const version = this.version(r.plan), stored = version.data.implementationCarries ?? [];
        const record = stored.find((item: any) => item.occurrenceId === occurrence.id);
        if (!record)
            return null;
        const plan = version.data.plan as PlanProposal, judge = version.data.decisionLaunch;
        const outputs = this.s.all('SELECT * FROM role_outputs WHERE launch=? AND status=?', judge, 'usable');
        if (version.work !== work || version.kind !== 'plan' || version.hash !== hash(plan) || outputs.length !== 1)
            throw new Error('Implementation carry lacks its actual current plan and independent output');
        const protocol = parse(outputs[0].data).protocol as RoleResult;
        const proposals = implementationCarryProposals(protocol, planningDecisionCarry('adjudicator', parse(this.s.one('SELECT data FROM role_launches WHERE id=?', judge).data)));
        const effectivePlan = this.acceptedPlanningProposal(work, judge, protocol, version.data.authorLaunch);
        if (!protocol?.planAccepted || protocol.ownerDecisionRequired?.length || !effectivePlan || hash(effectivePlan) !== hash(plan) ||
            proposals.length !== stored.length ||
            proposals.some(item => !stored.some((other: any) => item.occurrenceId === other.occurrenceId &&
                hash(item) === hash({ occurrenceId: other.occurrenceId, baselineVersion: other.baselineVersion, requirementIds: other.requirementIds, reason: other.reason }))))
            throw new Error('Implementation carry is not bound to the retained independent accepted plan');
        this.carryDecisionChains(proposals, protocol.decisions ?? []);
        const resolved = this.resolveImplementationCarry(work, record, plan, judge);
        const requirements = r.data.requirementVersion ? this.version(r.data.requirementVersion) : null;
        if (!requirements || requirements.work !== work || requirements.kind !== 'requirements' || requirements.data.decisionLaunch !== judge ||
            hash(requirements.data.requirements) !== resolved.requirementsHash ||
            ['historicalRequirementId', 'originLaunchId', 'originOutputId', 'baselineHash', 'planningJudge', 'planHash', 'requirementsHash', 'contractsVersion'].some(key => record[key] !== resolved[key as keyof typeof resolved]))
            throw new Error('Implementation carry origin, baseline or current requirement lineage changed');
        return resolved.baselineVersion;
    }
    private repairedProof(work: string, occurrence: any, witnesses: string[]) {
        const r = this.row(work), origin = this.s.one('SELECT * FROM role_launches WHERE id=?', parse(occurrence.data).launchId);
        let old = parse(origin.data).inputVersions.candidate;
        if (origin.role === 'implementer' || origin.role === 'repairer') {
            const produced = this.s.all("SELECT id FROM change_versions WHERE work=? AND kind='candidate' AND json_extract(data,'$.producer')=?", work, origin.id);
            if (produced.length !== 1)
                throw new Error('Author finding needs its unique actual produced immutable candidate');
            old = produced[0].id;
        }
        if (old === null && origin.role !== 'implementer' && origin.role !== 'repairer')
            old = this.carriedBaseline(work, occurrence);
        if (!old || !r.candidate || old === r.candidate || this.version(old).hash === this.version(r.candidate).hash || !this.checksCurrent(work))
            throw new Error('Repair closure needs changed candidate content and current actual checks');
        const ids = Object.values(r.data.selection ?? {}) as string[];
        if (!ids.length || ids.some(id => {
            const l = this.s.one('SELECT * FROM role_launches WHERE id=?', id);
            return !l || l.status !== 'COMPLETE' || parse(l.data).inputVersions.candidate !== r.candidate;
        }))
            throw new Error('Repair closure needs fresh independent current review');
        const checks = this.s.all('SELECT id FROM check_runs WHERE work=? AND candidate=? AND verification=? AND status=?', work, r.candidate, r.verification, 'pass');
        if (!witnesses.some(w => checks.some(c => c.id === w)))
            throw new Error('Repair closure missing actual current-check witness: include a separate unchanged passing context.checks[].id for this candidate and verification; a logical check_id or case-qualified locator cannot substitute');
        return true;
    }
    private dispositions(work: string, launch: string, protocol: RoleResult, scope?: readonly string[], payloadRepair?: (occurrence: any) => boolean, diagnosisProofs = new Map<string, any>()) {
        this.guard(work);
        const all = this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work).filter(o => !scope || scope.includes(parse(o.data).launchId));
        this.assertRetainedDispositions(work, launch, protocol);
        this.diagnosisDecisionGuard(work, protocol);
        const decisions = protocol.decisions ?? [];
        for (const proof of diagnosisProofs.values()) if (proof.origin?.materialSource &&
            hash(proof.origin.materialSource.fence) !== hash(this.materialAssessmentFence(proof.origin.outputId)))
            throw Error('Public material assessment source changed before disposition commit');
        if (decisions.some(d => d.resolution === 'diagnosed' && !diagnosisProofs.has(d.occurrenceId)))
            throw new Error('Diagnosis proof must be prevalidated before disposition mutation');
        const ids = new Set<string>();
        for (const d of decisions) {
            if (ids.has(d.occurrenceId) || !all.some(o => o.id === d.occurrenceId))
                throw new Error('Disposition duplicate/unknown occurrence');
            ids.add(d.occurrenceId);
            if (!d.reason.trim() || !d.witnesses.length)
                throw new Error('Disposition needs retained reason/witness');
            if (d.disposition === 'equivalent' && (!d.equivalentTo || d.equivalentTo === d.occurrenceId || !all.some(o => o.id === d.equivalentTo)))
                throw new Error('Equivalence target invalid');
            this.s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)', randomUUID(), d.occurrenceId, launch, d.disposition, JSON.stringify({ ...d, ...(diagnosisProofs.has(d.occurrenceId) ? { diagnosisWitness: diagnosisProofs.get(d.occurrenceId) } : {}) }));
            const finding = parse(all.find(o => o.id === d.occurrenceId)!.data).finding ?? { severity: 'blocking' };
            const done = (d.disposition === 'upheld' && d.resolution === 'diagnosed' && diagnosisProofs.has(d.occurrenceId)) || (d.disposition === 'upheld' && finding.severity === 'optional') || d.disposition === 'rejected' || (d.disposition === 'deferred' && finding.severity === 'optional') || (d.disposition === 'upheld' && d.resolution === 'repaired' && (payloadRepair ? payloadRepair(all.find(o => o.id === d.occurrenceId)!) : this.repairedProof(work, all.find(o => o.id === d.occurrenceId)!, d.witnesses)));
            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ kind: 'finding', occurrence: d.occurrenceId, state: done ? 'resolved' : 'pending', disposition: d.disposition, ...(diagnosisProofs.has(d.occurrenceId) ? { resolution: 'diagnosed', diagnosisWitness: diagnosisProofs.get(d.occurrenceId) } : {}) }), d.occurrenceId);
        }
        for (const occurrence of all) {
            const latest = this.s.one('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', occurrence.id);
            if (!latest)
                throw new Error(`Raw occurrence unaccounted: ${occurrence.id}`);
        }
        const latest = new Map(all.map(o => [o.id, parse(this.s.one('SELECT data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', o.id).data)]));
        const resolved = (id: string, seen = new Set<string>()): boolean => {
            if (seen.has(id))
                throw new Error('Finding equivalence cycle remains unresolved');
            const d = latest.get(id);
            if (d?.disposition !== 'equivalent')
                return parse(this.s.one('SELECT data FROM obligations WHERE id=?', id).data).state === 'resolved';
            seen.add(id);
            return resolved(d.equivalentTo, seen);
        };
        for (const [id, d] of latest)
            if (d.disposition === 'equivalent')
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ kind: 'finding', occurrence: id, state: resolved(id) ? 'resolved' : 'pending', disposition: 'equivalent', equivalentTo: d.equivalentTo }), id);
    }
    private inputDecisions(work: string, launch: string, protocol: RoleResult) {
        this.guard(work);
        const producer = this.s.one('SELECT * FROM role_launches WHERE id=?', launch);
        if (!producer || producer.work !== work || producer.role !== 'adjudicator' || producer.status !== 'COMPLETE')
            throw new Error('Source-fit requires actual completed non-author adjudicator producer');
        const stage = parse(producer.data).stage, pending = this.h.sourceImpacts(work).filter(input => input.data.effectHold), pendingDigest = hash(pending);
        const currentPlan = this.row(work).plan, accepted = stage === 'planning-adjudication' ? (protocol.acceptedPlan?.requirements ?? (currentPlan ? this.version(currentPlan).data.plan.requirements : [])) : (currentPlan ? this.version(currentPlan).data.plan.requirements : []);
        const decisions = pending.map(input => {
            const decision = protocol.inputDecisions?.find(d => d.inputId === input.input_id && d.directionRevision === input.revision);
            if (!decision)
                throw new Error('Independent source-fit decision omitted actual input ' + input.input_id);
            if (decision.requirementIds.some(id => !accepted.some((r: any) => r.id === id)))
                throw new Error('Source-fit decision names unknown requirement');
            if (decision.impact === 'ambiguous')
                throw new Error('Consequential source interpretation needs owner clarification');
            if (decision.impact === 'scope-change' && !['source-fit', 'planning-adjudication'].includes(stage))
                throw new Error('Accepted source scope change requires source-fit/retained planning stage before mutation');
            return { input, decision };
        });
        this.s.tx(() => {
            this.guard(work);
            if (hash(this.h.sourceImpacts(work).filter(input => input.data.effectHold)) !== pendingDigest)
                throw new Error('Pending source tuple changed before source-fit application');
            for (const { input, decision } of decisions)
                this.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?', JSON.stringify({ ...input.data, effectHold: false, decision: { ...decision, launch } }), input.conversation, input.revision);
            if (stage === 'source-fit' && decisions.some(({ decision }) => decision.impact === 'scope-change')) {
                this.s.run('UPDATE change_state SET plan=NULL,verification=NULL WHERE work=?', work);
                this.acceptOwnVersions(work);
                this.phase(work, 'BASE_CAPTURED', { resumeStage: 'plan', selection: {}, pendingNit: null, carry: null, nextAction: 'Replan retained changed owner source' });
            }
        });
    }
    private ownerSource(work: string) {
        const origin = parse(this.s.one('SELECT origin FROM sources WHERE id=?', this.work(work).source).origin), root = origin.delegationRoot;
        if (!root)
            return null;
        const row = this.s.one('SELECT s.id,s.raw,s.origin FROM works w JOIN sources s ON s.id=w.source WHERE w.id=?', root);
        return row ? { ...row, origin: parse(row.origin) } : null;
    }
    private requirementSources(work: string): string[] {
        return [...new Set([this.work(work).source, ...(this.ownerSource(work) ? [this.ownerSource(work).id] : []), ...this.h.sourceImpacts(work).map(input => input.source), 'owner-request', ...(this.row(work).data.ownerRequirements as string[]).map((_, index) => `owner-constraint-${index}`)])];
    }
    private verificationMode(work: string): { version: 1; kind: 'finite-mixed'; baselinePlanId?: string } | undefined {
        const data = this.row(work).data;
        if (!Object.hasOwn(data, 'verificationProfileMode')) {
            // These versions are committed atomically with owned adoption below;
            // rejected role proposals never create an accepted plan version.
            if (this.s.one("SELECT id FROM change_versions WHERE work=? AND kind='plan' AND (json_type(data,'$.verificationProfile') IS NOT NULL OR json_type(data,'$.plan.verification.strategies') IS NOT NULL) LIMIT 1", work))
                throw new Error('Owned typed verification mode was lost; retained accepted typed plans cannot become legacy');
            return undefined;
        }
        const mode = data.verificationProfileMode;
        if (!mode || typeof mode !== 'object' || Array.isArray(mode) || mode.version !== 1 || mode.kind !== 'finite-mixed' ||
            Object.keys(mode).some(key => !['version', 'kind', 'baselinePlanId'].includes(key)) ||
            Object.hasOwn(mode, 'baselinePlanId') && (typeof mode.baselinePlanId !== 'string' || !mode.baselinePlanId)) throw new Error('Owned verification profile mode unavailable or unsupported');
        if (mode.baselinePlanId) {
            const original = this.version(mode.baselinePlanId);
            if (original.work !== work || original.kind !== 'plan' || hash(original.data.plan) !== original.hash || !original.data.verificationProfile ||
                !Array.isArray(original.data.plan?.verification?.strategies) || !original.data.plan.verification.strategies.some((strategy: VerificationStrategy) => strategy.kind === 'base-execution-duty'))
                throw new Error('Original accepted baseline-duty history unavailable');
        }
        return mode;
    }
    private verificationSupport(work: string) {
        const mode = this.verificationMode(work), r = this.row(work);
        if (!mode && r.plan && Object.hasOwn(this.version(r.plan).data, 'verificationProfile')) throw new Error('Owned typed verification mode was lost; no legacy fallback');
        return finiteVerificationSupport(this.work(work), !!this.s.one("SELECT id FROM role_launches WHERE work=? AND role IN ('implementer','repairer') LIMIT 1", work), mode !== undefined, !!mode?.baselinePlanId);
    }
    /** One synchronous evaluation only; never retain this read across an await or action boundary. */
    private createVerificationRead(work: string): VerificationRead {
        let outcome: { kind: 'value'; value: VerificationStrategy[] | undefined } | { kind: 'error'; error: unknown } | undefined;
        return { strategies: () => {
            if (!outcome) {
                try { outcome = { kind: 'value', value: this.strategies(work) }; }
                catch (error) { outcome = { kind: 'error', error }; }
            }
            if (outcome.kind === 'error') throw outcome.error;
            return outcome.value;
        } };
    }
    private strategies(work: string) {
        const r = this.row(work);
        const mode = this.verificationMode(work);
        if (!r.plan) { if (mode) throw new Error('Current accepted typed verification plan unavailable'); return undefined; }
        const selected = this.version(r.plan), plan = selected.data.plan as PlanProposal, verification = plan.verification;
        const savedVerification = r.verification ? this.version(r.verification) : null;
        const judge = typeof selected.data.decisionLaunch === 'string' ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', selected.data.decisionLaunch, work) : null;
        const output = judge ? this.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", judge.id) : null;
        const declared = Object.hasOwn(verification, 'strategies'), marked = Object.hasOwn(selected.data, 'verificationProfile') || !!savedVerification && Object.hasOwn(savedVerification.data, 'verificationProfile');
        const metadata = judge ? parse(judge.data) : null;
        const capability = judge && Object.hasOwn(metadata, 'planningVerificationProfile') ? readPlanningVerificationProfile('adjudicator', { stage: 'planning-adjudication', planningVerificationProfile: metadata.planningVerificationProfile }) : undefined;
        const approval = metadata && readProposalApproval('adjudicator', metadata);
        const parsed = output ? parseRoleOutput(output.raw, 'adjudicator', [], { ...capturedRoleConstraints('adjudicator', metadata ?? {}), ...(approval ? { proposalApproval: approval, ...(capability ? { planningProfile: capability } : {}), sourceIds: this.requirementSources(work) } : {}) }).value : null;
        const effectivePlan = parsed && judge ? this.acceptedPlanningProposal(work, judge.id, parsed, selected.data.authorLaunch) : undefined;
        if (judge && Object.hasOwn(metadata, 'planningVerificationProfile') && (!capability || capability.version !== 1 || typeof capability.supported !== 'boolean')) throw new Error('Original planning capability metadata unavailable');
        const producerTyped = capability?.supported === true || !!effectivePlan && Object.hasOwn(effectivePlan.verification, 'strategies');
        if (!declared && !marked && !producerTyped && !mode) return undefined;
        const marker = selected.data.verificationProfile;
        if (!mode || !declared || !Array.isArray(verification.strategies) || !judge || !output || !marker || typeof marker !== 'object' || Array.isArray(marker) ||
            Object.keys(marker).some(key => !['version', 'kind', 'strategyDigest', 'decisionLaunch'].includes(key)) || typeof marker.decisionLaunch !== 'string' || !marker.decisionLaunch || marker.version !== 1 || marker.kind !== 'finite-mixed' ||
            marker.decisionLaunch !== judge?.id || marker.strategyDigest !== hash(verification.strategies) || !savedVerification || !Object.hasOwn(savedVerification.data, 'verificationProfile') || !Object.hasOwn(savedVerification.data, 'verification') ||
            hash(savedVerification.data.verificationProfile) !== hash(marker) || hash(verification) !== savedVerification.hash || hash(savedVerification.data.verification) !== savedVerification.hash || hash(plan) !== selected.hash)
            throw new Error('Typed verification profile or selected plan/verification binding is unavailable');
        const run = this.s.one('SELECT * FROM runs WHERE id=?', judge.run), runData = run ? parse(run.data) : null;
        if (judge.role !== 'adjudicator' || judge.status !== 'COMPLETE' || metadata.stage !== 'planning-adjudication' || metadata.planningVerificationProfile?.version !== 1 || metadata.planningVerificationProfile.supported !== true || metadata.cleanup !== 'removed' ||
            !run || run.work !== work || run.epoch !== judge.epoch || runData.kind !== 'governed-role' || runData.role !== 'adjudicator' || runData.launchId !== judge.id || metadata.inputVersions?.base !== r.base || metadata.inputVersions?.contracts !== r.data.contractsVersion ||
            run.phase !== 'SETTLED' || run.reservation !== 'consumed' || !runData || runData.cleanup !== 'removed' || !parsed?.planAccepted || !effectivePlan ||
            hash(effectivePlan) !== selected.hash || hash(parse(output.data).protocol) !== hash(parsed)) throw new Error('Typed verification lacks its actual independent planning producer');
        if (verification.strategies.some(strategy => strategy.kind === 'base-execution-duty') && !mode.baselinePlanId) throw new Error('Owned before-edit baseline duty binding was lost');
        if (!this.verificationSupport(work).originalIndependent) throw new Error('Finite mixed verification requires original independent work; inherited before-edit history is unsupported');
        const issue = coverageIssue(plan);
        if (issue) throw new Error(issue);
        return verification.strategies;
    }
    private verificationPremises(work: string, candidate = true) {
        const r = this.row(work), w = this.work(work);
        // Verification facts retain their original dispatch authority. Pure owner recovery
        // changes current action authority, not these exact selected semantic inputs.
        return { workId: work, sourceId: w.source, base: r.base, baseDigest: this.version(r.base).hash,
            ...(candidate ? { candidate: r.candidate, candidateDigest: r.candidate ? this.version(r.candidate).hash : null } : {}),
            contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, plan: r.plan, verification: r.verification };
    }
    private baselineCheckIds(work: string, read = this.createVerificationRead(work)) {
        return new Set((read.strategies() ?? []).filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
    }
    private selectedBaselineCheck(work: string, check: any) {
        const r = this.row(work);
        return this.s.all('SELECT * FROM check_runs WHERE work=? AND candidate=? AND verification=? AND check_id=? ORDER BY rowid DESC', work, r.base, r.verification, check.id)
            .find(row => { const data = parse(row.data); return data.purpose === 'baseline' && hash(data.check) === hash(check); });
    }
    private baselineReceipt(work: string, check: any) {
        const r = this.row(work), base = this.version(r.base), premises = this.verificationPremises(work, false);
        const row = this.selectedBaselineCheck(work, check);
        if (!row) return undefined;
        try {
            const data = parse(row.data), run = this.s.one('SELECT * FROM runs WHERE id=?', row.run);
            if (row.status !== 'baseline-observed' || data.purpose !== 'baseline' || data.target?.kind !== 'base' || data.target.versionId !== r.base || data.target.digest !== base.hash ||
                !Object.hasOwn(data.target, 'candidateAtDispatch') || data.target.candidateAtDispatch !== null && typeof data.target.candidateAtDispatch !== 'string' ||
                hash(data.boundVersions) !== hash({ base: r.base, candidate: r.base, plan: r.plan, verification: r.verification, requirements: r.data.requirementVersion, contracts: r.data.contractsVersion }) ||
                hash(data.verificationPremises) !== hash(premises) || hash(data.check) !== hash(check) || data.cleanup !== 'removed' || !run || run.work !== work || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > this.work(work).epoch ||
                !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > this.work(work).generation || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || parse(run.data).kind !== 'governed-check' || parse(run.data).cleanup !== 'removed' ||
                hash(data.argv) !== hash(['/bin/bash', '-lc', check.command]) || data.cwd !== '/work' ||
                data.actual?.exitCode !== 0 || data.actual.termination || data.parsed?.issues?.length || !data.parsed?.value) return undefined;
            const actualParsed = parseCheckOutput(data.actual.stdout);
            if (!actualParsed.value || actualParsed.issues.length || hash(actualParsed) !== hash(data.parsed) ||
                this.s.one("SELECT l.id FROM role_launches l JOIN runs r ON r.id=l.run WHERE l.work=? AND l.role IN ('implementer','repairer') AND r.rowid<(SELECT rowid FROM runs WHERE id=?) LIMIT 1", work, row.run)) return undefined;
            if (data.target.candidateAtDispatch !== null) {
                const atDispatch = this.version(data.target.candidateAtDispatch);
                if (atDispatch.work !== work || atDispatch.kind !== 'candidate') return undefined;
            }
            const runData = parse(run.data);
            if (hash(data.dispatchAuthority) !== hash({ workId: work, sourceId: this.work(work).source, runId: run.id, epoch: run.epoch, generation: run.generation }) || hash(runData.dispatchAuthority) !== hash(data.dispatchAuthority) ||
                runData.purpose !== 'baseline' || runData.checkBinding !== hash(check) || hash(runData.checkTarget) !== hash(data.target) ||
                hash(runData.verificationPremises) !== hash(premises) || hash(runData.boundVersions) !== hash(data.boundVersions) ||
                data.inputHash !== hash({ candidate: base.hash, verification: r.verification, check, runtime: runData.runtimeProfile })) return undefined;
            const descriptor = caseDescriptor(check, base, data.boundVersions, row.run), comparison = compareCases(check, descriptor, data.parsed.value);
            const valid = hash(data.caseDescriptor) === hash(descriptor) && hash(comparison) === hash(data.caseResults) && comparison.complete && !comparison.mismatches.length &&
                data.parsed.value.assertions.length === check.assertions.length && check.assertions.every((id: string) => data.parsed.value.assertions.some((assertion: any) => assertion.id === id && assertion.passed));
            return valid ? row : undefined;
        } catch { return undefined; }
    }
    private assertEditingVerification(work: string) {
        if (this.strategies(work) === undefined) return;
        const r = this.row(work), plan = this.version(r.plan).data.plan as PlanProposal;
        for (const id of this.baselineCheckIds(work)) {
            const check = plan.verification.checks.find(check => check.id === id)!;
            if (!this.baselineReceipt(work, check)) throw new Error('Editing refused before the required original baseline witness is established');
        }
    }
    private strategyHoldReason(work: string, read = this.createVerificationRead(work)) {
        try { this.strategyEvidenceDigest(work, read); return null; }
        catch (error) { return 'Current independent verification strategy evidence unavailable: ' + String(error); }
    }
    private async beforeAuthorVerification(options: ChangeOperation) {
        const work = options.workId, r = this.row(work), strategies = this.strategies(work);
        if (!strategies) return;
        const plan = this.version(r.plan).data.plan as PlanProposal;
        for (const id of this.baselineCheckIds(work)) {
            const check = plan.verification.checks.find(check => check.id === id)!;
            if (this.baselineReceipt(work, check)) continue;
            if (!this.verificationSupport(work).beforeFirstAuthor)
                throw new Error('Original before-first-edit baseline witness unavailable; historical editing cannot be retroactively observed');
            const result = await this.executeCheck(work, check, options, r.base, 'baseline');
            this.guard(work);
            if (result.status !== 'baseline-observed' || !this.baselineReceipt(work, check))
                throw new Error('Required original baseline observation unavailable or expected subject defect not demonstrated; inspect the retained receipt. Unavailable producers may be corrected by explicit independent pre-author planning; changing a material failed baseline premise requires an unsupported qualified baseline amendment');
        }
    }
    private scopeEvidence(work: string, strategy: ScopeStrategy) {
        const r = this.row(work), profile = parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile);
        const version = (id: string) => {
            const value = this.version(id);
            validateScopeManifest(value, profile);
            return value;
        };
        const base = version(r.base), candidate = version(r.candidate);
        const premises = this.verificationPremises(work);
        const ordinary = manifestScopeEvidence(base, candidate, strategy, premises, profile);
        const view = nativeAdministrativeScopeView(this.s, work, base, candidate, version, ordinary.actual.satisfied);
        return view ? manifestScopeEvidence(base, candidate, strategy, premises, profile, view) : ordinary;
    }
    private scopeRecord(work: string, strategy: ScopeStrategy) {
        const r = this.row(work);
        if (!r.candidate) return undefined;
        const expectedDigest = hash(this.scopeEvidence(work, strategy));
        return this.s.all("SELECT * FROM change_versions WHERE work=? AND kind='scope-evidence' ORDER BY rowid DESC", work).find(row => {
            try { return row.hash === expectedDigest && hash(parse(row.data).evidence) === expectedDigest; }
            catch { return false; }
        });
    }
    private scopeReceipt(work: string, strategy: ScopeStrategy) {
        const row = this.scopeRecord(work, strategy);
        return row && parse(row.data).evidence.actual.satisfied ? row : undefined;
    }
    private observeScopeStrategies(work: string): boolean {
        for (const strategy of this.strategies(work) ?? []) {
            if (strategy.kind !== 'manifest-scope-duty' || this.scopeReceipt(work, strategy)) continue;
            const evidence = this.scopeEvidence(work, strategy);
            const id = this.newVersion(work, 'scope-evidence', null, { evidence }, hash(evidence));
            const obligation = `scope-${work}-${hash(strategy)}`;
            if (!evidence.actual.satisfied) {
                const old = this.s.one('SELECT data FROM obligations WHERE id=?', obligation), previous = old && parse(old.data);
                const prior = previous?.evidenceId && this.version(previous.evidenceId).data.evidence;
                const repeated = previous?.state === 'pending' && hash(previous.premises) === hash(this.verificationPremises(work, false)) && prior?.candidate.digest === evidence.candidate.digest && hash(prior.actual) === hash(evidence.actual);
                this.s.run('INSERT OR REPLACE INTO obligations VALUES(?,?,?)', obligation, work, JSON.stringify({ kind: 'verification-scope', strategy, strategyDigest: hash(strategy), evidenceId: id, premises: this.verificationPremises(work, false), state: 'pending', ...(repeated ? { previousEvidenceId: previous.evidenceId } : {}) }));
                if (repeated) this.phase(work, 'BLOCKED', { blocked: ['Unchanged candidate repeats the same complete manifest scope failure'], nextAction: 'Inspect original scope evidence and native projection; repeat checks after a meaningful correction, no automatic author retry', resumeStage: 'checks' });
                else this.phase(work, 'REPAIR_REQUIRED', { blocked: ['Complete current manifest violates independently accepted scope'], nextAction: 'Repair the original candidate scope and repeat current verification' });
                return false;
            }
            const old = this.s.one('SELECT data FROM obligations WHERE id=?', obligation);
            if (old) {
                const data = parse(old.data);
                if (hash(data.premises) !== hash(this.verificationPremises(work, false))) throw new Error('Scope predicate premise changed; original failed obligation requires independent resolution');
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...data, state: 'resolved', currentEvidenceId: id }), obligation);
            }
        }
        return true;
    }
    private strategyWitness(work: string, strategy: VerificationStrategy) {
        const r = this.row(work), plan = this.version(r.plan).data.plan as PlanProposal;
        let witnessIds: string[];
        if (strategy.kind === 'consumer-cases') witnessIds = strategy.checkIds.map(id => {
            const check = plan.verification.checks.find(check => check.id === id)!;
            const row = this.selectedCheck(work, r.candidate, r.verification, check);
            if (!this.checkReceiptPassed(work, row, check)) throw new Error('Required current consumer witness unavailable');
            return row.id;
        });
        else if (strategy.kind === 'base-execution-duty') {
            const check = plan.verification.checks.find(check => check.id === strategy.checkId)!;
            const row = this.baselineReceipt(work, check);
            if (!row) throw new Error('Required original baseline witness unavailable');
            witnessIds = [row.id];
        }
        else {
            const row = this.scopeReceipt(work, strategy);
            if (!row) throw new Error('Required complete manifest scope witness unavailable');
            witnessIds = [row.id];
        }
        return { requirementId: strategy.requirementId, strategyDigest: hash(strategy), kind: strategy.kind,
            reviewKey: strategy.kind === 'consumer-cases' ? null : strategy.reviewKey, witnessIds };
    }
    private strategyWitnesses(work: string, read = this.createVerificationRead(work)) {
        return (read.strategies() ?? []).map(strategy => this.strategyWitness(work, strategy));
    }
    private verificationView(work: string, read = this.createVerificationRead(work)): VerificationEvidenceView {
        let strategies: VerificationStrategy[];
        try { strategies = read.strategies() ?? []; }
        catch (error) { return { availability: 'unavailable', reason: String(error), requirements: [] }; }
        let proof: ReturnType<ChangeCore['inspectVerificationEvidence']>, unavailable: string | undefined;
        try { proof = this.verificationEvidence(work, read); }
        catch (error) { unavailable = String(error); }
        const requirements: VerificationEvidenceView['requirements'] = strategies.map(strategy => {
            const entry: VerificationEvidenceView['requirements'][number] = { requirementId: strategy.requirementId, kind: strategy.kind, strategyDigest: hash(strategy),
                reviewKey: strategy.kind === 'consumer-cases' ? null : strategy.reviewKey, witnessAvailability: 'unavailable', witnessIds: [], reviewLaunchIds: [] };
            try { entry.witnessIds = this.strategyWitness(work, strategy).witnessIds; entry.witnessAvailability = 'recorded'; }
            catch (error) { entry.reason = String(error); }
            entry.reviewLaunchIds = proof?.requirements.find(item => item.requirementId === strategy.requirementId)?.reviews.map(review => review.launchId) ?? [];
            if (strategy.kind === 'manifest-scope-duty') {
                try {
                    const row = this.scopeRecord(work, strategy), evidence = row ? parse(row.data).evidence : null;
                    if (row && evidence) entry.scope = { witnessId: row.id, predicate: evidence.predicate,
                        actual: { satisfied: evidence.actual.satisfied, changedCount: evidence.actual.changedCount, violationCount: evidence.actual.violationCount },
                        adverse: { satisfied: evidence.adverse.observation.satisfied } };
                } catch { /* The unavailable witness reason above remains authoritative. */ }
            }
            return entry;
        });
        return proof ? { availability: 'available', digest: proof.digest, requirements }
            : { availability: 'unavailable', reason: unavailable ?? 'Current typed verification evidence unavailable', requirements };
    }
    private verificationRecord(work: string, id: string) {
        const check = this.s.one('SELECT * FROM check_runs WHERE id=? AND work=?', id, work);
        if (check) return { kind: 'check-run', ...check, data: parse(check.data) };
        const version = this.s.one("SELECT * FROM change_versions WHERE id=? AND work=? AND kind='scope-evidence'", id, work);
        if (version) return { kind: 'scope-evidence', ...version, data: parse(version.data) };
        const launch = this.s.one("SELECT * FROM role_launches WHERE id=? AND work=? AND role='reviewer'", id, work);
        if (launch) return { kind: 'independent-review', launch, run: this.s.one('SELECT * FROM runs WHERE id=?', launch.run), outputs: this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', id) };
        throw new Error('Typed verification witness identity unavailable');
    }
    private verificationInputBinding(work: string, stage: string, reviewKey: unknown, requirements: readonly { requirementId: string; strategyDigest: string; witnessIds: readonly string[] }[]) {
        return hash({ premises: this.verificationPremises(work), stage, reviewKey: reviewKey ?? null,
            requirements: requirements.map(item => ({ requirementId: item.requirementId, strategyDigest: item.strategyDigest, witnessIds: item.witnessIds })),
            evidence: [...new Set(requirements.flatMap(item => [...item.witnessIds]))].sort().map(id => this.verificationRecord(work, id)) });
    }
    private verificationDecisions(work: string, output: RoleResult, expected: readonly { requirementId: string; strategyDigest: string; witnessIds: readonly string[] }[], read = this.createVerificationRead(work)) {
        if (!read.strategies()) return;
        if (!Array.isArray(output.verificationDecisions) || output.verificationDecisions.length !== expected.length) throw new Error('Independent verification fit decisions incomplete');
        for (const requirement of expected) {
            const entries = output.verificationDecisions.filter(decision => decision.requirementId === requirement.requirementId);
            if (entries.length !== 1 || entries[0]!.strategyDigest !== requirement.strategyDigest || entries[0]!.verdict !== 'satisfied' ||
                hash([...entries[0]!.witnessIds].sort()) !== hash([...requirement.witnessIds].sort())) throw new Error('Independent verification fit unavailable or witness binding changed');
        }
    }
    private strategyReviewer(work: string, position: PlanProposal['verification']['reviewRoles'][number], id: string | undefined, witnesses?: ReturnType<ChangeCore['strategyWitnesses']>, read = this.createVerificationRead(work)) {
        const currentWitnesses = witnesses === undefined ? this.strategyWitnesses(work, read) : witnesses;
        const r = this.row(work), launch = id ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', id, work) : null;
        if (!launch || launch.role !== 'reviewer' || launch.status !== 'COMPLETE' || !this.sameNonCandidateBindings(work, parse(launch.data).inputVersions) || parse(launch.data).inputVersions.candidate !== r.candidate)
            throw new Error('Required strategy reviewer unavailable or stale');
        const output = this.s.one("SELECT * FROM role_outputs WHERE launch=? AND status='usable'", launch.id), expected = currentWitnesses.filter(item => item.reviewKey === null || item.reviewKey === position.key);
        if (!output) throw new Error('Required strategy reviewer output unavailable');
        const metadata = parse(launch.data), run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), collected = parse(output.data);
        if (metadata.stage !== 'fresh-review' || metadata.reviewKey !== position.key || metadata.purpose !== position.purpose || hash(metadata.requiredPaths) !== hash(position.requiredPaths) ||
            metadata.cleanup !== 'removed' || !run || run.work !== work || run.epoch !== launch.epoch ||
            !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > this.work(work).epoch || !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > this.work(work).generation ||
            parse(run.data).kind !== 'governed-role' || parse(run.data).launchId !== launch.id || parse(run.data).role !== 'reviewer' || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || parse(run.data).cleanup !== 'removed' ||
            metadata.verificationInputBinding !== this.verificationInputBinding(work, 'fresh-review', position.key, expected)) throw new Error('Required strategy reviewer input/provenance changed');
        const parsed = parseRoleOutput(output.raw, 'reviewer', [], { verificationFit: expected });
        if (!parsed.value || parsed.issues.length || hash(parsed.value) !== hash(collected.protocol)) throw new Error('Required strategy reviewer raw protocol changed');
        this.verificationDecisions(work, parsed.value, expected, read);
        return { launchId: id!, protocol: parsed.value };
    }
    private strategyReviewEvidence(work: string, read = this.createVerificationRead(work)) {
        const r = this.row(work), witnesses = this.strategyWitnesses(work, read), plan = this.version(r.plan).data.plan as PlanProposal;
        if (!plan.verification.strategies) return [];
        const reviews = plan.verification.reviewRoles.map(position => ({ position, ...this.strategyReviewer(work, position, r.data.selection?.[position.key], witnesses, read) }));
        if (new Set(reviews.map(review => review.launchId)).size !== reviews.length) throw new Error('Required strategy reviews must remain distinct selected executions');
        return witnesses.map(witness => ({ ...witness, reviews: reviews.filter(review => witness.reviewKey === null || review.position.key === witness.reviewKey).map(review => ({
            launchId: review.launchId, decision: review.protocol.verificationDecisions!.find(decision => decision.requirementId === witness.requirementId)!,
        })) }));
    }
    inspectVerificationEvidence(work: string) {
        return this.verificationEvidence(work, this.createVerificationRead(work));
    }
    private verificationEvidence(work: string, read: VerificationRead) {
        this.h.assertOpen();
        if (!read.strategies()) return undefined;
        const r = this.row(work), reviews = this.strategyReviewEvidence(work, read), judgeId = r.data.verificationJudge;
        const judge = judgeId ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', judgeId, work) : null;
        if (!judge || judge.role !== 'adjudicator' || judge.status !== 'COMPLETE' || !this.sameNonCandidateBindings(work, parse(judge.data).inputVersions) || parse(judge.data).inputVersions.candidate !== r.candidate)
            throw new Error('Current independent verification adjudication missing');
        const output = this.s.one('SELECT data FROM role_outputs WHERE launch=?', judge.id);
        const protocol = output ? parse(output.data).protocol as RoleResult : null;
        if (!protocol) throw new Error('Current verification adjudication unavailable');
        const expected = reviews.map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] }));
        const metadata = parse(judge.data), run = this.s.one('SELECT * FROM runs WHERE id=?', judge.run);
        if (metadata.stage !== 'review-adjudication' || metadata.cleanup !== 'removed' || !run || run.work !== work || run.epoch !== judge.epoch ||
            !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > this.work(work).epoch || !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > this.work(work).generation ||
            parse(run.data).kind !== 'governed-role' || parse(run.data).launchId !== judge.id || parse(run.data).role !== 'adjudicator' || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || parse(run.data).cleanup !== 'removed' ||
            metadata.verificationInputBinding !== this.verificationInputBinding(work, 'review-adjudication', undefined, expected)) throw new Error('Current verification adjudication input/provenance changed');
        const parsed = parseRoleOutput(this.s.one("SELECT raw FROM role_outputs WHERE launch=? AND status='usable'", judge.id)?.raw ?? '', 'adjudicator', [], { ...capturedRoleConstraints('adjudicator', metadata), verificationFit: expected });
        if (!parsed.value || parsed.issues.length || hash(parsed.value) !== hash(protocol)) throw new Error('Current verification adjudication raw protocol changed');
        this.verificationDecisions(work, protocol, expected, read);
        const adjudication = { launchId: judge.id as string, decisions: protocol.verificationDecisions! };
        const digest = hash({ premises: this.verificationPremises(work), strategies: read.strategies(), reviews, judge: adjudication,
            witnessInputs: this.verificationInputBinding(work, 'review-adjudication', undefined, expected) });
        return { digest, requirements: reviews, adjudication };
    }
    private strategyEvidenceDigest(work: string, read = this.createVerificationRead(work)) {
        return this.verificationEvidence(work, read)?.digest;
    }
    /** Material failed baseline observations retain their exact historical premise.
     * Unavailable producers supply no subject observation and do not enter this set.
     */
    private materialBaselineFailures(work: string) {
        const failures: { requirement: PlanProposal['requirements'][number]; check: any; base: string }[] = [];
        for (const row of this.s.all("SELECT * FROM check_runs WHERE work=? AND status='fail' ORDER BY rowid", work)) {
            const data = parse(row.data);
            if (data.purpose !== 'baseline' || data.cleanup !== 'removed' || !data.actual || data.actual.termination) continue;
            const parsed = parseCheckOutput(data.actual.stdout), run = this.s.one('SELECT * FROM runs WHERE id=?', row.run);
            if (!parsed.value || parsed.issues.length || !run || run.work !== work || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
                !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > this.work(work).epoch || !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > this.work(work).generation) continue;
            const metadata = parse(run.data), binding = data.boundVersions;
            if (!binding || metadata.kind !== 'governed-check' || metadata.cleanup !== 'removed' || metadata.purpose !== 'baseline' ||
                hash(data.dispatchAuthority) !== hash({ workId: work, sourceId: this.work(work).source, runId: run.id, epoch: run.epoch, generation: run.generation }) ||
                hash(metadata.dispatchAuthority) !== hash(data.dispatchAuthority) || hash(metadata.boundVersions) !== hash(binding) || hash(metadata.checkTarget) !== hash(data.target) ||
                metadata.checkBinding !== hash(data.check) || hash(metadata.verificationPremises) !== hash(data.verificationPremises)) continue;
            const base = this.version(binding.base), oldPlan = this.version(binding.plan), verification = this.version(binding.verification), requirements = this.version(binding.requirements), contracts = this.version(binding.contracts);
            if (requirements.work !== work || requirements.kind !== 'requirements' || contracts.work !== work || contracts.kind !== 'contracts' ||
                hash(requirements.data.requirements) !== hash(oldPlan.data.plan.requirements) || hash(data.verificationPremises) !== hash({ workId: work, sourceId: this.work(work).source, base: base.id, baseDigest: base.hash, contracts: contracts.id, requirements: requirements.id, plan: oldPlan.id, verification: verification.id }) ||
                base.work !== work || base.kind !== 'base' || oldPlan.work !== work || oldPlan.kind !== 'plan' || verification.work !== work || verification.kind !== 'verification' ||
                hash(oldPlan.data.plan) !== oldPlan.hash || hash(oldPlan.data.plan.verification) !== verification.hash || hash(verification.data.verification) !== verification.hash ||
                row.candidate !== base.id || row.verification !== verification.id || data.target?.kind !== 'base' || data.target.versionId !== base.id || data.target.digest !== base.hash || binding.candidate !== base.id ||
                hash(data.argv) !== hash(['/bin/bash', '-lc', data.check.command]) || data.cwd !== '/work' ||
                data.inputHash !== hash({ candidate: base.hash, verification: verification.id, check: data.check, runtime: metadata.runtimeProfile }) ||
                hash(parsed) !== hash(data.parsed) || !oldPlan.data.plan.verification.checks.some((check: any) => hash(check) === hash(data.check))) continue;
            const descriptor = caseDescriptor(data.check, base, binding, row.run), comparison = compareCases(data.check, descriptor, parsed.value);
            if (!comparison.complete || hash(descriptor) !== hash(data.caseDescriptor) || hash(comparison) !== hash(data.caseResults) ||
                parsed.value.assertions.length !== data.check.assertions.length || !data.check.assertions.every((id: string) => parsed.value!.assertions.some(assertion => assertion.id === id)) ||
                !comparison.mismatches.length && parsed.value.assertions.every(assertion => assertion.passed) ||
                this.s.one("SELECT l.id FROM role_launches l JOIN runs r ON r.id=l.run WHERE l.work=? AND l.role IN ('implementer','repairer') AND r.rowid<(SELECT rowid FROM runs WHERE id=?) LIMIT 1", work, row.run)) continue;
            for (const strategy of oldPlan.data.plan.verification.strategies ?? []) if (strategy.kind === 'base-execution-duty' && strategy.checkId === data.check.id) {
                const requirement = oldPlan.data.plan.requirements.find((requirement: any) => requirement.id === strategy.requirementId);
                if (requirement) failures.push({ requirement, check: data.check, base: base.id });
            }
        }
        return failures;
    }
    private planningValid(plan: PlanProposal, work: string, freshProfile?: PlanningVerificationProfile) {
        const mode = freshProfile ? this.verificationMode(work) : undefined;
        if (freshProfile && mode && !Object.hasOwn(plan.verification, 'strategies')) throw new Error('Owned typed verification cannot downgrade to legacy during replanning');
        if (freshProfile && plan.verification.strategies?.some(strategy => !freshProfile.allowedKinds.includes(strategy.kind))) throw new Error('Verification strategy kind unavailable in current planning capability');
        if (freshProfile) for (const failure of this.materialBaselineFailures(work)) {
            const requirement = plan.requirements.find(requirement => requirement.text === failure.requirement.text && requirement.source === failure.requirement.source);
            const strategy = requirement && plan.verification.strategies?.find(strategy => strategy.requirementId === requirement.id && strategy.kind === 'base-execution-duty');
            if (failure.base !== this.row(work).base || !strategy || strategy.kind !== 'base-execution-duty' ||
                !plan.verification.checks.some(check => check.id === strategy.checkId && hash(check) === hash(failure.check)))
                throw new Error('Material failed baseline premise amendment is unsupported; retain the original requirement, base and exact check declaration. No qualified baseline-amendment or authorized requirement mapping is available.');
        }
        if (freshProfile && mode?.baselinePlanId) {
            if (!freshProfile.baseline.newObservation) throw new Error('Original before-edit witness mapping across a new plan is unsupported; retain the original duty and evidence');
            const old = this.version(mode.baselinePlanId).data.plan as PlanProposal;
            for (const strategy of old.verification.strategies ?? []) if (strategy.kind === 'base-execution-duty') {
                const original = old.requirements.find(requirement => requirement.id === strategy.requirementId)!;
                if (!plan.requirements.some(requirement => requirement.text === original.text && requirement.source === original.source && plan.verification.strategies?.some(next => next.requirementId === requirement.id && next.kind === 'base-execution-duty')))
                    throw new Error('Original before-edit duty cannot be removed or relabelled without qualified historical/owner-source mapping');
            }
        }
        if (freshProfile && (freshProfile.supported ? !Object.hasOwn(plan.verification, 'strategies') : Object.hasOwn(plan.verification, 'strategies')))
            throw new Error(freshProfile.supported ? 'New supported planning acceptance requires explicit complete strategy accounting' : 'Fresh mixed verification capability is unavailable; no historical migration');
        if (plan.ambiguities.length)
            throw new Error('Owner clarification required: ' + plan.ambiguities.join(';'));
        if (!plan.requirements.length || !plan.verification.checks.length || !plan.verification.reviewRoles.length)
            throw new Error('Accepted plan lacks requirements/checks/review roster');
        const missingCases = coverageIssue(plan);
        if (missingCases)
            throw new Error(missingCases);
        const allowed = new Set(this.requirementSources(work));
        for (const r of plan.requirements)
            if (!allowed.has(r.source))
                throw new Error('Requirement source is not retained owner intent');
        for (const c of plan.verification.checks)
            if (!c.guaranteeIds.length || c.guaranteeIds.some(id => !plan.requirements.some(r => r.id === id)))
                throw new Error('Check guarantee source missing');
    }
    /** Recover the actual failed predicate; callers cannot nominate a different successful receipt. */
    private failedPredicate(work: string, obligation: any) {
        if (obligation.kind !== 'check' || !obligation.check || (!obligation.expectations?.length && !obligation.caseMismatches?.length))
            throw new Error('Check amendment requires known expectation operands or actual failed case observations');
        const receipts = this.s.all('SELECT * FROM check_runs WHERE work=? AND candidate=? AND verification=? AND status=?', work, obligation.candidate, obligation.verification, 'fail')
            .map(row => ({ ...row, data: parse(row.data) }))
            .filter(row => hash(row.data.check) === obligation.checkBinding && hash(row.data.expectations) === hash(obligation.expectations));
        if (!receipts.length)
            throw new Error('Actual failed predicate receipt unavailable');
        const origin = receipts.find(row => row.id === obligation.failedReceipt);
        if ((obligation.failedReceipt && !origin) || (obligation.caseMismatches?.length && (!origin || hash(origin.data.caseResults?.mismatches) !== hash(obligation.caseMismatches))))
            throw new Error('Original failed receipt/case observations do not bind this obligation');
        const resolve = (receipt: any) => {
            if (receipt.data.boundVersions)
                return receipt.data.boundVersions;
            // Legacy rows are recovered through their unique accepted verification/plan/J chain.
            const verification = this.version(obligation.verification);
            const plans = this.s.all('SELECT * FROM change_versions WHERE work=? AND kind=?', work, 'plan').map(row => ({ ...row, data: parse(row.data) }))
                .filter(row => hash(row.data.plan.verification) === hash(verification.data.verification));
            if (plans.length !== 1)
                throw new Error('Legacy failed check has ambiguous accepted plan; re-establish exact baseline');
            const plan = plans[0], launch = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', plan.data.decisionLaunch, work);
            if (!launch || launch.role !== 'adjudicator' || launch.status !== 'COMPLETE' || parse(launch.data).stage !== 'planning-adjudication')
                throw new Error('Legacy failed check lacks accepted planning producer');
            const requirements = this.s.all('SELECT * FROM change_versions WHERE work=? AND kind=?', work, 'requirements').filter(row => parse(row.data).decisionLaunch === launch.id);
            if (requirements.length !== 1)
                throw new Error('Legacy failed check requirements are ambiguous');
            return { ...parse(launch.data).inputVersions, candidate: obligation.candidate, plan: plan.id, verification: verification.id, requirements: requirements[0].id };
        };
        const canonical = (input: any) => ({ base: input.base, candidate: input.candidate, plan: input.plan, verification: input.verification, requirements: input.requirements, contracts: input.contracts });
        const versions = canonical(resolve(receipts[0]));
        if (!versions.base || !versions.requirements || !versions.contracts || receipts.some(receipt => hash(canonical(resolve(receipt))) !== hash(versions)))
            throw new Error('Failed predicate producer operands are ambiguous');
        for (const [kind, id] of Object.entries({ base: versions.base, requirements: versions.requirements, contracts: versions.contracts, plan: versions.plan, verification: versions.verification, candidate: versions.candidate })) {
            const input = this.version(id as string);
            if (input.work !== work || input.kind !== kind)
                throw new Error('Foreign or malformed failed predicate input');
        }
        if (versions.candidate !== obligation.candidate || versions.verification !== obligation.verification || hash(this.version(versions.plan).data.plan.verification) !== hash(this.version(versions.verification).data.verification))
            throw new Error('Failed predicate versions do not bind accepted verification');
        return { obligation, receipts: receipts.map(row => row.id), versions };
    }
    private acceptedAmendments(work: string, plan: PlanProposal, judge: string, carriedFindings: ReadonlySet<string> = new Set()) {
        const pending = this.pending(work), proposals = plan.verification.checkAmendments ?? [];
        const amendments = proposals.map(proposal => {
            const obligation = pending.find(o => o.id === proposal.obligationId);
            if (!obligation)
                throw new Error('Amendment must name current pending check obligation');
            const old = this.failedPredicate(work, obligation);
            if (!old.receipts.includes(proposal.failedCheckRunId))
                throw new Error('Amendment failed receipt does not belong to actual old predicate');
            const corrected = plan.verification.checks.find(check => check.id === proposal.correctedCheckId);
            const withoutId = (check: any) => ({ guaranteeIds: check.guaranteeIds, command: check.command, assertions: check.assertions, timeoutMs: check.timeoutMs, fixturePaths: check.fixturePaths, ...(check.expectationPaths === undefined ? {} : { expectationPaths: check.expectationPaths }) });
            if (!corrected || hash(withoutId(corrected)) !== hash(withoutId(obligation.check)))
                throw new Error('Initial amendment profile preserves command, guarantees, assertions and declared inputs');
            const caseChanges = changedCaseIds(obligation.check, corrected);
            if (hash([...caseChanges].sort()) !== hash([...(proposal.caseIds ?? [])].sort()))
                throw new Error('Amendment must name exact changed case operands');
            if (proposal.fixturePaths.some(file => !obligation.check.expectationPaths?.includes(file) || !corrected.expectationPaths?.includes(file)) || (!proposal.fixturePaths.length && !caseChanges.length) || proposal.negativeAssertions.some(id => !corrected.assertions.includes(id)) || (proposal.negativeCaseIds ?? []).some(id => !corrected.cases?.some(c => c.id === id)))
                throw new Error('Amendment fixture/assertion scope is not the known predicate');
            if (proposal.basis === 'fixture-defect') {
                if (hash(plan.requirements) !== hash(this.version(old.versions.requirements).data.requirements))
                    throw new Error('Fixture defect cannot revise owner requirements');
            }
            else {
                const input = this.h.sourceImpacts(work).find(input => input.input_id === proposal.ownerInputId);
                const source = input && this.s.one('SELECT * FROM sources WHERE id=?', input.source);
                const origin = source && parse(source.origin);
                if (!input || origin?.kind !== 'owner-conversation-input' || input.data.effectHold || input.data.decision?.impact !== 'scope-change' || !plan.requirements.some(requirement => requirement.source === input.source))
                    throw new Error('Requirement amendment needs actual independently accounted owner scope-change input');
            }
            return { id: randomUUID(), ...proposal, old, corrected, planningJudge: judge };
        });
        const unaccounted = pending.filter(o => !(o.kind === 'finding' && carriedFindings.has(o.id)) && (o.kind !== 'check' || !amendments.some(amendment => amendment.obligationId === o.id)));
        if (unaccounted.length) {
            const details = unaccounted.slice(0, 16).map(o => ({ id: o.id, kind: o.kind,
                ...(o.disposition ? { disposition: o.disposition } : {}),
                missing: o.kind === 'finding' ? 'independent resolution or eligible explicit BASE implementation carry'
                    : o.kind === 'check' ? 'eligible check amendment; original failure remains pending'
                        : 'required diagnosis or recovery before planning admission' }));
            throw new Error(`Planning cannot defer unaccounted obligations: ${JSON.stringify({ total: unaccounted.length, obligations: details, omitted: Math.max(0, unaccounted.length - details.length) })}. Producer completion is not plan adoption. Inspect retained findings and dispositions; independently account for each listed obligation before requesting continuation. No retry or allowance renewal is implied.`);
        }
        return amendments;
    }
    private currentAmendments(work: string): any[] {
        const r = this.row(work);
        return r.plan ? this.version(r.plan).data.amendments ?? [] : [];
    }
    private async amendmentProbes(work: string, options: {
        signal?: AbortSignal;
    }) {
        const r = this.row(work), current = this.version(r.candidate), profile = parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile);
        const proofs: any[] = [];
        for (const amendment of this.currentAmendments(work).filter(a => this.pending(work).some(o => o.id === a.obligationId))) {
            const old = this.failedPredicate(work, amendment.old.obligation);
            if (hash(old) !== hash(amendment.old))
                throw new Error('Amended old predicate binding changed');
            const before = amendment.old.obligation.expectations ?? [], after = this.expectations(r.candidate, amendment.corrected) ?? [];
            if ((amendment.fixturePaths.length && (!Array.isArray(amendment.old.obligation.expectations) || !Array.isArray(amendment.corrected.expectationPaths))) || before.length !== after.length)
                throw new Error('Missing corrected expectation input');
            const changed = after.filter((file: any) => hash(file) !== hash(before.find((old: any) => old.path === file.path))).map((file: any) => file.path);
            if ((!changed.length && !(amendment.caseIds ?? []).length) || hash([...changed].sort()) !== hash([...amendment.fixturePaths].sort()))
                throw new Error('Exact nonempty changed expectation overlay required');
            const healthy = this.s.one('SELECT * FROM check_runs WHERE work=? AND candidate=? AND verification=? AND check_id=? ORDER BY rowid DESC LIMIT 1', work, r.candidate, r.verification, amendment.corrected.id);
            if (!healthy || healthy.status !== 'pass')
                throw new Error('Corrected predicate lacks actual healthy current candidate');
            const base = this.version(old.versions.base), staging = path.join(this.h.options.installationHome, 'inputs', randomUUID());
            await materialize(base.artifact, staging, profile, base.hash, this.operations.get(work)!.handle.abort.signal);
            for (const file of amendment.fixturePaths) {
                const source = safePath(current.artifact, file), destination = safePath(staging, file);
                const stat = await fs.lstat(source);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
                    throw new Error('Fixture overlay must be exact regular captured bytes');
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.writeFile(destination, await fs.readFile(source), { mode: stat.mode & 0o777 });
                await fs.chmod(destination, stat.mode & 0o777);
            }
            const target = path.join(this.h.options.installationHome, 'inputs', randomUUID()), receipt = await freeze(staging, target, profile, this.operations.get(work)!.handle.abort.signal);
            this.guard(work);
            const probe = this.newVersion(work, 'fixture-probe', target, { manifest: receipt.manifest, amendmentId: amendment.id, base: base.id, overlayCandidate: r.candidate, fixturePaths: amendment.fixturePaths }, receipt.digest, base.id);
            const result = await this.executeCheck(work, amendment.corrected, options, probe, 'fixture-amendment-negative');
            const actual = result.data.actual, parsed = result.data.parsed;
            const complete = actual?.exitCode === 0 && !actual.termination && !parsed?.issues?.length && result.data.caseResults?.complete && parsed?.value?.assertions.length === amendment.corrected.assertions.length && amendment.corrected.assertions.every((id: string) => parsed.value.assertions.some((a: any) => a.id === id));
            if (!complete || !['pass', 'fail'].includes(result.status)) {
                this.s.run('INSERT INTO obligations VALUES(?,?,?)', `diagnostic-probe-${result.runId}`, work, JSON.stringify({ kind: 'diagnostic', producer: 'check', runId: result.runId, receipt: result.id, amendmentId: amendment.id, state: 'pending', issues: 'Adverse checker producer unavailable; no adequacy claim' }));
                throw new Error('Base-derived probe producer unavailable; diagnose exact receipt before explicit retry');
            }
            if (receipt.digest === current.hash || result.status !== 'fail' || hash(result.data.caseResults.mismatches.map((c: any) => c.id).sort()) !== hash([...(amendment.negativeCaseIds ?? [])].sort()) || !amendment.corrected.assertions.every((id: string) => parsed.value.assertions.some((a: any) => a.id === id && a.passed === !amendment.negativeAssertions.includes(id)))) {
                const error = new Error('Base-derived probe did not demonstrate exact named adverse assertions/case mismatches; repair checker before repeating healthy/adverse verification');
                Object.assign(error, { repairableProbe: true });
                throw error;
            }
            proofs.push({ amendmentId: amendment.id, candidate: r.candidate, plan: r.plan, verification: r.verification, healthy: healthy.id, probe: result.id, probeVersion: probe, probeDigest: receipt.digest });
        }
        this.phase(work, 'CHECKED', { amendmentProofs: proofs });
    }
    private resolveAmendments(work: string, launch: string, result: RoleResult) {
        const r = this.row(work), amendments = this.currentAmendments(work), proofs = r.data.amendmentProofs ?? [];
        const updates: {
            id: string;
            data: any;
        }[] = [];
        for (const decision of result.checkResolutions ?? []) {
            const amendment = amendments.find(a => a.id === decision.amendmentId), proof = proofs.find((p: any) => p.amendmentId === decision.amendmentId);
            if (!amendment || !proof || proof.candidate !== r.candidate || proof.plan !== r.plan || proof.verification !== r.verification || !decision.witnesses.includes(proof.healthy) || !decision.witnesses.includes(proof.probe) || decision.disposition !== (amendment.basis === 'fixture-defect' ? 'corrected-fixture' : 'authorized-requirement-revision'))
                throw new Error('Check resolution requires exact current amendment and actual healthy/adverse witnesses');
            const old = this.pending(work).find(o => o.id === amendment.obligationId);
            if (!old)
                throw new Error('Check resolution obligation not pending');
            const requiredReviews = this.version(r.plan).data.plan.verification.reviewRoles;
            if (!this.checksCurrent(work) || requiredReviews.some((position: any) => {
                const review = this.s.one('SELECT * FROM role_launches WHERE id=?', r.data.selection?.[position.key]);
                return !review || review.status !== 'COMPLETE' || review.role !== 'reviewer' || !this.sameNonCandidateBindings(work, parse(review.data).inputVersions) || parse(review.data).inputVersions.candidate !== r.candidate;
            }))
                throw new Error('Amendment resolution requires all fresh non-author review and current checks');
            updates.push({ id: old.id, data: { ...old, state: 'resolved', resolution: decision.disposition, amendmentId: amendment.id, planningJudge: amendment.planningJudge, resolutionJudge: launch, witnesses: decision.witnesses, proof, reason: decision.reason } });
        }
        this.s.tx(() => {
            this.guard(work);
            for (const update of updates)
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify(update.data), update.id);
        });
    }
    /** A bounded historical diagnostic, never an adoption decision or a carry. */
    private priorPlanningFailure(work: string, row: ReturnType<ChangeCore['row']>) {
        if (row.phase === 'BASE_CAPTURED' && row.data.resumeStage === 'plan') {
            try {
                const refresh = row.data.criteriaRefresh;
                if (!refresh || refresh.toContractsVersion !== row.data.contractsVersion) return;
                const current = this.version(refresh.toContractsVersion), previous = this.version(refresh.fromContractsVersion);
                const source = this.s.one('SELECT * FROM sources WHERE id=?', refresh.sourceId), origin = source && parse(source.origin);
                const recorded = origin?.priorPlanningFailure, owner = this.work(work);
                if (current.work !== work || previous.work !== work || current.kind !== 'contracts' || previous.kind !== 'contracts' ||
                    current.predecessor !== previous.id || current.data.refreshSource !== source?.id ||
                    origin?.kind !== 'owner-criteria-refresh' || origin.work !== work || origin.fromContractsVersion !== previous.id || origin.toHash !== current.hash ||
                    !recorded || recorded.version !== 1 || recorded.workId !== work || recorded.epoch !== owner.epoch - 1 || recorded.generation !== owner.generation ||
                    recorded.recordedPhase !== 'BLOCKED' || !Array.isArray(recorded.messages) || recorded.messages.length > 16 ||
                    recorded.messages.some((message: unknown) => typeof message !== 'string') ||
                    !Number.isSafeInteger(recorded.omittedMessages) || recorded.omittedMessages < 0 || typeof recorded.interpretation !== 'string' ||
                    Object.keys(recorded).some(key => !['version', 'workId', 'epoch', 'generation', 'recordedPhase', 'messages', 'omittedMessages', 'interpretation'].includes(key)) ||
                    Buffer.byteLength(JSON.stringify(recorded), 'utf8') > 8192) return;
                return structuredClone(recorded);
            } catch { return; } // Optional historical feedback never creates a new standing hold.
        }
        if (row.phase !== 'BLOCKED' || row.data.resumeStage !== 'plan' || !Array.isArray(row.data.blocked)) return;
        const messages = row.data.blocked.filter((value: unknown): value is string => typeof value === 'string');
        if (!messages.length) return;
        const owner = this.work(work);
        let captured = { version: 1, workId: work, epoch: owner.epoch, generation: owner.generation,
            recordedPhase: 'BLOCKED', messages: [] as string[], omittedMessages: messages.length,
            interpretation: 'Recorded host failures before this planning entry. Historical diagnostics only: use current evidence and pending obligations; these messages grant no verdict, carry, retry or action authority.' };
        for (const message of messages.slice(0, 16)) {
            const next = { ...captured, messages: [...captured.messages, message], omittedMessages: messages.length - captured.messages.length - 1 };
            if (Buffer.byteLength(JSON.stringify(next), 'utf8') <= 8192) captured = next;
        }
        return captured;
    }
    private async planInner(options: ChangeOperation) {
        const work = options.workId;
        const planningProfile = this.verificationSupport(work).capability;
        try {
            if (planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation) throw new Error('Original before-first-edit duty has no supported cross-plan mapping; no new planning producer admitted');
            const r = this.row(work);
            if (!r.base)
                throw new Error('Base unavailable');
            for (const obligation of this.pending(work)) {
                if (obligation.kind === 'check')
                    this.failedPredicate(work, obligation);
                else if (obligation.kind !== 'finding')
                    throw new Error('Unsupported planning hold remains unresolved');
            }
            const priorPlanningFailure = this.priorPlanningFailure(work, r);
            this.phase(work, 'PLANNING', { blocked: [], nextAction: 'planChange' });
            const reused = [] as NonNullable<Awaited<ReturnType<ChangeCore['planningPrefix']>>>[];
            let assertPlanner = () => {};
            const assertPrefix = () => { for (const producer of reused) producer.assertCurrent(); assertPlanner(); };
            const planner = await this.planningPrefix(options, 'planner');
            if (planner) reused.push(planner);
            const a = planner?.value ?? await this.role(options, 'planner', { stage: 'planning' });
            if (!a.protocol.plan)
                throw new Error('Planner omitted plan');
            let proposalApproval: { version: 1; plannerOutputId: string; proposalHash: string; plannerOutputHash: string } | undefined;
            if (planningProfile.supported && a.inputScope?.version === 1 && a.inputScope.workId === work &&
                a.inputScope.outputId === a.output && a.inputScope.launchId === a.launchId && a.inputScope.role === 'planner' && a.inputScope.stage === 'planning') {
                const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', a.output), metadata = output && parse(output.data);
                const selectedEntryId = 'execution' in a ? (a.execution as RoleExecution).selectedFinalEntryId : metadata?.nativeEntryId;
                if (!output || output.launch !== a.launchId || output.status !== 'usable' || typeof output.raw !== 'string' ||
                    hash(parseRoleOutput(output.raw, 'planner').value) !== hash(a.protocol) || !metadata?.protocol || hash(metadata.protocol) !== hash(a.protocol) ||
                    hash(this.inputScopeReceipt(work, a.launchId, a.output, 'planner', 'planning', selectedEntryId)) !== hash(a.inputScope))
                    throw Error('Selected planner record changed before independent challenge');
                const outputHash = this.planningOutputHash(output), scopeHash = hash(a.inputScope);
                const originalRun = this.s.one('SELECT * FROM runs WHERE id=?', a.runId), sourceHash = originalRun && parse(originalRun.data).sourceInputHash;
                assertPlanner = () => {
                    const current = this.s.one('SELECT * FROM role_outputs WHERE id=?', a.output), run = this.s.one('SELECT * FROM runs WHERE id=?', a.runId), data = run && parse(run.data);
                    if (!current || this.planningOutputHash(current) !== outputHash || !run || !data || data.kind !== 'governed-role' || data.role !== 'planner' ||
                        data.launchId !== a.launchId || data.sourceInputHash !== sourceHash ||
                        hash(this.inputScopeReceipt(work, a.launchId, a.output, 'planner', 'planning', selectedEntryId)) !== scopeHash)
                        throw Error('Selected planner record changed at the planning handoff');
                };
                assertPlanner();
                try {
                    this.planningValid(a.protocol.plan, work, planningProfile);
                    proposalApproval = { version: 1, plannerOutputId: a.output, proposalHash: hash(a.protocol.plan), plannerOutputHash: this.planningOutputHash(output) };
                } catch { /* A partial proposal still reaches independent correction; no omission capability is declared. */ }
            }
            const challenger = await this.planningPrefix(options, 'challenger', a);
            if (challenger) reused.push(challenger);
            assertPrefix();
            const b = challenger?.value ?? await this.role(options, 'challenger', { stage: 'planning-challenge', planProposal: a.protocol.plan, plannerOutput: a.protocol, plannerInputScope: a.inputScope }, false, assertPrefix);
            assertPrefix();
            const j = await this.role(options, 'adjudicator', { stage: 'planning-adjudication', ...(priorPlanningFailure ? { priorPlanningFailure } : {}), planProposal: a.protocol.plan, ...(proposalApproval ? { proposalApproval } : {}), challenge: b.protocol, plannerInputScope: a.inputScope, challengerInputScope: b.inputScope, occurrences: this.inspect(work).occurrences }, false, assertPrefix);
            assertPrefix();
            if (j.protocol.ownerDecisionRequired?.length) throw new Error('Independent planning requires an explicit owner decision: ' + j.protocol.ownerDecisionRequired.join('; '));
            if (!j.protocol.planAccepted) throw new Error('Independent planning did not accept a supported complete plan; inspect retained blocking findings and unavailable oracle limits');
            if (hash(this.verificationSupport(work).capability) !== hash(planningProfile)) throw new Error('Planning verification capability changed');
            const accepted = this.acceptedPlanningProposal(work, j.launchId, j.protocol, a.launchId);
            if (!accepted) throw new Error('New finite planning acceptance requires an explicit plan or qualified bound approval');
            const diagnosisProofs = await this.prevalidateDiagnoses(work, j);
            assertPrefix();
            if (hash(this.acceptedPlanningProposal(work, j.launchId, j.protocol, a.launchId) ?? null) !== hash(accepted) || hash(this.verificationSupport(work).capability) !== hash(planningProfile)) throw Error('Selected planning approval changed before adoption');
            // No asynchronous work follows before the plan and its dispositions are committed.
            this.assertRetainedDispositions(work, j.launchId, j.protocol);
            this.adoptCriteria(work, j.protocol);
            this.inputDecisions(work, j.launchId, { ...j.protocol, acceptedPlan: accepted });
            this.planningValid(accepted, work, planningProfile);
            this.s.tx(() => this.dispositions(work, j.launchId, j.protocol, undefined, undefined, diagnosisProofs));
            const implementationCarries = this.acceptedImplementationCarries(work, accepted, j.launchId, j.protocol);
            const amendments = this.acceptedAmendments(work, accepted, j.launchId, new Set(implementationCarries.map(item => item.occurrenceId)));
            const previousMode = this.verificationMode(work);
            this.s.tx(() => {
                const verificationProfile = Object.hasOwn(accepted.verification, 'strategies') ? { version: 1, kind: 'finite-mixed', strategyDigest: hash(accepted.verification.strategies), decisionLaunch: j.launchId } : undefined;
                const plan = this.newVersion(work, 'plan', null, { ...(verificationProfile ? { verificationProfile } : {}), plan: accepted, amendments, implementationCarries, criteriaDecision: j.protocol.criteriaDecision ?? null, authorLaunch: a.launchId, challengeLaunch: b.launchId, decisionLaunch: j.launchId }, hash(accepted));
                const requirements = this.newVersion(work, 'requirements', null, { requirements: accepted.requirements, intent: accepted.intent, source: this.work(work).source, decisionLaunch: j.launchId }, hash({ requirements: accepted.requirements, intent: accepted.intent }));
                const requirementNumber = this.s.one('SELECT MAX(version) AS v FROM requirements WHERE work=?', work).v + 1;
                this.s.run('INSERT INTO requirements VALUES(?,?,?,?)', work, requirementNumber, this.row(work).data.request, JSON.stringify({ status: 'independently-adjudicated', english: accepted.intent, requirementsVersion: requirements, decision: j.launchId }));
                const verification = this.newVersion(work, 'verification', null, { verification: accepted.verification, ...(verificationProfile ? { verificationProfile } : {}) }, hash(accepted.verification));
                this.s.run('UPDATE change_state SET plan=?,verification=?,phase=?,data=? WHERE work=?', plan, verification, 'PLAN_READY', JSON.stringify({ ...this.row(work).data, ...(verificationProfile ? { verificationProfileMode: { version: 1, kind: 'finite-mixed', ...(previousMode?.baselinePlanId ? { baselinePlanId: previousMode.baselinePlanId } : accepted.verification.strategies?.some(strategy => strategy.kind === 'base-execution-duty') ? { baselinePlanId: plan } : {}) } } : {}), blocked: [], nextAction: 'implementChange', requirementVersion: requirements, selection: {}, authorLaunches: [], verificationJudge: null, pendingNit: null, carry: null, amendmentProofs: [], criteriaRefresh: null }), work);
            });
            this.acceptOwnVersions(work);
            return this.inspect(work);
        }
        catch (error) {
            this.phase(work, 'BLOCKED', { blocked: [String(error)], resumeStage: 'plan', nextAction: `Inspect original planning blockers and role records in /work ${work} before explicitly continuing this same work. Preserve original evidence and consumed allowance.` });
            return this.inspect(work);
        }
    }
    private async implementInner(options: ChangeOperation, repair = false) {
        const work = options.workId, r = this.row(options.workId);
        try {
            if (!r.plan || (!repair && r.phase !== 'PLAN_READY') || (repair && !r.candidate))
                throw new Error('Accepted current plan required before authoring');
            await this.beforeAuthorVerification(options);
            this.guard(work);
            const author = await this.role(options, repair ? 'repairer' : 'implementer', { stage: repair ? 'substantive-repair' : 'implementation', acceptedPlan: this.version(r.plan).data.plan, openObligations: this.pending(work) }, true);
            const id = randomUUID(), target = path.join(this.h.options.installationHome, 'inputs', id), project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project);
            const receipt = await freeze(author.staging, target, parse(project.profile), this.operations.get(work)!.handle.abort.signal);
            this.guard(work);
            const before = r.candidate ? this.version(r.candidate) : this.version(r.base), candidate = this.newVersion(work, 'candidate', target, { manifest: receipt.manifest, producer: author.launchId, delta: delta(this.version(r.base).data.manifest, receipt.manifest) }, receipt.digest, before.id);
            this.s.run('UPDATE change_state SET candidate=?,phase=?,data=? WHERE work=?', candidate, 'CANDIDATE_CAPTURED', JSON.stringify({ ...r.data, blocked: [], nextAction: 'checkChange', selection: {}, verificationJudge: null, authorLaunches: [...(r.data.authorLaunches ?? []), author.launchId], pendingNit: null }), work);
            this.acceptOwnVersions(work);
            return this.inspect(work);
        }
        catch (error) {
            if (!repair && r.phase === 'PLAN_READY' && error instanceof ExecutionAdmissionRefusal && error.workId === work) {
                // Budget admission failed before any run/launch/reservation. Recheck
                // the registered epoch/source/version binding; never restore BLOCKED.
                this.guard(work);
                this.phase(work, 'PLAN_READY', { blocked: ['Execution allowance exhausted'], nextAction: 'Extend retained execution allowance; explicit resume implementChange', resumeStage: null });
                const held = this.inspect(work);
                this.executionAdmissionHolds.add(held);
                return held;
            }
            return this.blocked(work, String(error), repair ? 'repairChange' : 'implementChange');
        }
    }
    private pending(work: string) {
        return this.s.all('SELECT * FROM obligations WHERE work=?', work).filter(o => parse(o.data).state !== 'resolved').map(o => ({ id: o.id, ...parse(o.data) }));
    }
    private async executeCheck(work: string, check: any, options: {
        signal?: AbortSignal;
    }, candidateId: string, purpose = 'required') {
        const r = this.row(work), candidate = this.version(candidateId), receiptId = randomUUID();
        const target = purpose === 'baseline' ? { kind: 'base', versionId: candidateId, digest: candidate.hash, candidateAtDispatch: r.candidate } : { kind: 'candidate', versionId: candidateId, digest: candidate.hash };
        const verificationPremises = purpose === 'baseline' ? this.verificationPremises(work, false) : undefined;
        if (purpose === 'baseline' && (candidateId !== r.base || candidate.kind !== 'base')) throw new Error('Baseline execution requires the original immutable base');
        const boundVersions = { base: r.base, candidate: candidateId, plan: r.plan, verification: r.verification, requirements: r.data.requirementVersion, contracts: r.data.contractsVersion };
        const staging = path.join(this.h.options.installationHome, 'inputs', randomUUID()), a = this.reserve(work, null, { checkId: check.id, purpose, boundVersions }, staging), handle = this.operations.get(work)!.handle;
        const dispatchAuthority = purpose === 'baseline' ? { workId: work, sourceId: this.work(work).source, runId: a.runId, epoch: this.work(work).epoch, generation: this.work(work).generation } : undefined;
        if (purpose === 'baseline') this.h.patchRun(a.runId, 'CREATED', { dispatchAuthority, purpose, checkBinding: hash(check), checkTarget: target, verificationPremises, boundVersions });
        const stop = () => handle.abort.abort();
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        let lease: CapacityLease | undefined;
        let scope: ContainerScope | undefined, status = 'unavailable', data: any = {}, cleanup = 'not-allocated', runtimeAttempted = false;
        try {
            lease = await this.h.acquireCapacity({ workId: work, runId: a.runId, epoch: this.work(work).epoch, kind: 'check', signal: handle.abort.signal });
            this.h.entry(a.runId);
            const project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project);
            await materialize(candidate.artifact, staging, parse(project.profile), candidate.hash, handle.abort.signal);
            const descriptor = caseDescriptor(check, candidate, boundVersions, a.runId);
            const inputRoot = path.join(this.h.options.installationHome, 'inputs', randomUUID());
            await privateDirectory(inputRoot);
            await fs.writeFile(path.join(inputRoot, 'verification-cases.json'), JSON.stringify(descriptor) + '\n', { flag: 'wx', mode: 0o444 });
            await fs.chmod(inputRoot, 0o755);
            const protectedPaths = await scopeProtection(this.s, a.runId, staging);
            this.h.patchRun(a.runId, 'RUNTIME_CREATING', {});
            runtimeAttempted = true;
            scope = await createScope({ ...a.runtimeProfile!, workRoot: staging, stateRoot: path.join(this.h.state, 'runtime'), workId: work, runId: a.runId, inputRoot, protectedPaths, readOnlyWork: true, signal: handle.abort.signal });
            handle.scope = scope;
            this.h.patchRun(a.runId, 'RUNNING', { containerId: scope.containerId });
            this.h.entry(a.runId);
            const began = performance.now(), actual = await scope.execute(check.command, { cwd: '/work', timeoutMs: check.timeoutMs, signal: handle.abort.signal });
            const { parseCheckOutput } = await import('../workflow/index.js');
            const parsed = parseCheckOutput(actual.stdout);
            const assertions = parsed.value?.assertions ?? [];
            const caseResults = compareCases(check, descriptor, parsed.value);
            status = actual.exitCode === 0 && !actual.termination && !parsed.issues.length && caseResults.complete && !caseResults.mismatches.length && check.assertions.length === assertions.length && check.assertions.every((id: string) => assertions.some((v: any) => v.id === id && v.passed)) ? 'pass' : actual.termination || parsed.issues.length || !caseResults.complete ? 'unavailable' : 'fail';
            data = { actual, parsed, caseResults, caseDescriptor: descriptor, caseInputRoot: inputRoot, expectations: this.expectations(candidateId, check), durationMs: performance.now() - began, argv: ['/bin/bash', '-lc', check.command], cwd: '/work', inputHash: hash({ candidate: candidate.hash, verification: r.verification, check, runtime: a.runtimeProfile }), check };
        }
        catch (error) {
            data = { error: String(error), check };
        }
        finally {
            if (scope) {
                try {
                    cleanup = (await scope.close()).state;
                }
                catch {
                    cleanup = 'quarantined';
                }
            }
            else if (runtimeAttempted) {
                try {
                    cleanup = await this.h.reconcile(a.runId, work);
                }
                catch {
                    cleanup = 'quarantined';
                }
            }
            if (cleanup !== 'removed')
                status = 'unavailable';
            else if (purpose === 'baseline' && status === 'pass') status = 'baseline-observed';
            try {
                this.h.entry(a.runId);
            }
            catch {
                status = 'stale';
            }
            this.s.tx(() => {
                this.h.settleBudget(a.runId);
                this.h.patchRun(a.runId, cleanup.startsWith('quarantined') ? 'UNKNOWN' : 'SETTLED', { cleanup });
                this.s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)', receiptId, work, a.runId, candidateId, r.verification, check.id, status, JSON.stringify({ ...data, cleanup, purpose, boundVersions, target, ...(verificationPremises ? { verificationPremises, dispatchAuthority } : {}) }));
            });
            lease?.release({ cleanup, settled: true });
            delete handle.scope;
            if (cleanup.startsWith('quarantined'))
                this.s.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', work);
            options.signal?.removeEventListener('abort', stop);
        }
        this.guard(work);
        return { id: receiptId, status, data: { ...data, boundVersions, target, ...(verificationPremises ? { verificationPremises, dispatchAuthority } : {}) }, runId: a.runId };
    }
    private async checksInner(options: {
        workId: string;
        signal?: AbortSignal;
    }, only?: string[]) {
        const work = options.workId;
        try {
            const r = this.row(work);
            if (!r.candidate || !r.verification)
                throw new Error('Current candidate and accepted verification required');
            this.version(r.candidate);
            const verification = this.version(r.verification).data.verification;
            if (!this.observeScopeStrategies(work)) return this.inspect(work);
            const baseChecks = this.baselineCheckIds(work);
            const checkSet = new Map<string, any>(verification.checks.filter((c: any) => !baseChecks.has(c.id) && (!only || only.includes(c.id))).map((check: any) => [hash(check), check]));
            for (const obligation of this.pending(work).filter(o => o.kind === 'check' && o.check && !this.currentAmendments(work).some(a => a.obligationId === o.id)))
                checkSet.set(obligation.checkBinding, obligation.check);
            for (const check of checkSet.values()) {
                const result = await this.executeCheck(work, check, options, r.candidate);
                const { status, data } = result;
                this.guard(work);
                if (status === 'unavailable') {
                    const receipt = this.s.one('SELECT id FROM check_runs WHERE work=? AND run=?', work, result.runId).id;
                    this.s.run('INSERT INTO obligations VALUES(?,?,?)', `diagnostic-check-${result.runId}`, work, JSON.stringify({ kind: 'diagnostic', producer: 'check', runId: result.runId, receipt, checkId: check.id, checkBinding: hash(check), state: 'pending', issues: data.error ?? data.parsed?.issues ?? data.actual?.termination ?? 'Unavailable checker output' }));
                    // A timeout naturally has no complete case roster. It is not evidence
                    // that editing the checker (and paying an author) is necessary.
                    const caseOutputRepair = data.actual?.exitCode === 0 && !data.actual.termination && !data.parsed?.issues?.length && data.caseResults && !data.caseResults.complete;
                    this.phase(work, 'BLOCKED', { blocked: [`Required check ${check.id} producer unavailable; no material assertion failure inferred`], nextAction: caseOutputRepair ? 'Diagnose retained case output; explicit run/resume repairs the output fixture then repeats current verification' : 'Diagnose retained checker receipt; explicit run/resume retries the current check without inferring a software failure', resumeStage: caseOutputRepair ? 'repair' : 'checks' });
                    return this.inspect(work);
                }
                if (status !== 'pass') {
                    const obligation = `check-${r.candidate}-${check.id}-${hash(check)}`;
                    this.s.run('INSERT OR REPLACE INTO obligations VALUES(?,?,?)', obligation, work, JSON.stringify({ kind: 'check', checkId: check.id, candidate: r.candidate, verification: r.verification, checkBinding: hash(check), check, failedReceipt: result.id, boundVersions: data.boundVersions, expectations: this.expectations(r.candidate, check), guaranteeIds: check.guaranteeIds, caseMismatches: data.caseResults?.mismatches ?? [], state: 'pending' }));
                    this.phase(work, 'REPAIR_REQUIRED', { blocked: [`Required check ${check.id}: ${status}`], nextAction: 'repairChange' });
                    return this.inspect(work);
                }
                for (const o of this.pending(work).filter(o => o.kind === 'check' && o.checkId === check.id && o.checkBinding === hash(check) && !this.currentAmendments(work).some(a => a.obligationId === o.id))) {
                    const currentExpectations = this.expectations(r.candidate, check);
                    if (o.expectations !== null && o.expectations !== undefined && currentExpectations !== null && hash(currentExpectations) === hash(o.expectations))
                        this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, state: 'resolved', currentCandidate: r.candidate, rerun: this.s.one('SELECT id FROM check_runs WHERE work=? AND candidate=? AND check_id=? ORDER BY rowid DESC LIMIT 1', work, r.candidate, check.id).id }), o.id);
                    else {
                        this.phase(work, 'BLOCKED', { blocked: ['Observed failure cannot be cleared by changed/unknown expectation inputs'], nextAction: 'Explicit drive/resume admits bounded amendment planning; retain old failure until exact independent amendment and healthy/adverse proof', resumeStage: this.pending(work).every(item => item.kind === 'check' && (() => {
                                try {
                                    this.failedPredicate(work, item);
                                    return true;
                                }
                                catch {
                                    return false;
                                }
                            })()) ? 'plan' : 'checks' });
                        return this.inspect(work);
                    }
                }
            }
            if (!only)
                await this.amendmentProbes(work, options);
            this.phase(work, only ? 'NIT_CHECKED' : 'CHECKED', { blocked: [], nextAction: only ? 'confirmNit' : 'reviewChange' });
            return this.inspect(work);
        }
        catch (error) {
            if ((error as any)?.repairableProbe) {
                this.phase(work, 'REPAIR_REQUIRED', { blocked: [String(error)], nextAction: 'Explicit drive/resume repairs checker then repeats actual healthy/adverse verification', resumeStage: 'repair' });
                return this.inspect(work);
            }
            return this.blocked(work, String(error), 'checkChange');
        }
    }
    private async reviewInner(options: ChangeOperation) {
        const work = options.workId;
        try {
            const r = this.row(work);
            if (!this.checksCurrent(work))
                throw new Error('Required current checks incomplete/failed');
            const plan = this.version(r.plan).data.plan, selected = { ...(r.data.selection ?? {}) };
            for (const roster of plan.verification.reviewRoles) {
                const key = typeof roster === 'string' ? roster : roster.key;
                if (selected[key]) {
                    if (this.strategies(work) === undefined) continue;
                    try { this.strategyReviewer(work, roster, selected[key]); continue; }
                    catch { delete selected[key]; } // Explicit review action replaces a stale selection, retaining its original history.
                }
                const review = await this.role(options, 'reviewer', { stage: 'fresh-review', reviewKey: key, purpose: typeof roster === 'string' ? 'general' : roster.purpose, requiredPaths: typeof roster === 'string' ? [] : roster.requiredPaths, delta: this.version(r.candidate).data.delta });
                if (this.pending(work).some(o => o.kind === 'reproduction-unresolved'))
                    throw new Error('Declared reproduction needs exact actual receipt on retained candidate before review replacement can complete');
                if (this.strategies(work)) {
                    const expected = this.strategyWitnesses(work).filter(item => item.reviewKey === null || item.reviewKey === key);
                    this.verificationDecisions(work, review.protocol, expected);
                }
                selected[key] = review.launchId;
                this.phase(work, 'REVIEWING', { selection: selected });
            }
            this.phase(work, 'RESOLVING', { blocked: [], selection: selected, nextAction: 'resolveChange' });
            return this.inspect(work);
        }
        catch (error) {
            return this.blocked(work, String(error), 'reviewChange');
        }
    }
    /** The exact latest receipt matching this declaration; unrelated attempts remain history. */
    private selectedCheck(work: string, candidate: string, verification: string, check: any) {
        return this.s.all('SELECT * FROM check_runs WHERE work=? AND candidate=? AND verification=? AND check_id=? ORDER BY rowid DESC', work, candidate, verification, check.id)
            .find(row => hash(parse(row.data).check) === hash(check));
    }
    private checkReceiptPassed(work: string, row: any, check: any): boolean {
        if (!row || row.status !== 'pass') return false;
        const data = parse(row.data);
        try {
            const descriptor = caseDescriptor(check, this.version(this.row(work).candidate), data.boundVersions, row.run);
            const comparison = compareCases(check, descriptor, data.parsed?.value ?? null);
            return data.caseResults?.version === 1 && hash(data.caseDescriptor) === hash(descriptor) && hash(comparison) === hash(data.caseResults) && comparison.complete && !comparison.mismatches.length && data.cleanup === 'removed';
        }
        catch {
            return false;
        }
    }
    private checksCurrent(work: string, read = this.createVerificationRead(work)) {
        const r = this.row(work);
        if (!r.candidate || !r.verification)
            return false;
        const v = this.version(r.verification).data.verification;
        if (this.coverageHoldReason(work, read))
            return false;
        const baseChecks = this.baselineCheckIds(work, read);
        if (!v.checks.every((check: any) => baseChecks.has(check.id) ? !!this.baselineReceipt(work, check) : this.checkReceiptPassed(work, this.selectedCheck(work, r.candidate, r.verification, check), check))) return false;
        try { this.strategyWitnesses(work, read); return true; } catch { return false; }
    }
    private async nitPreview(work: string) {
        if (this.strategies(work) !== undefined) return null; // Mixed evidence requires fresh candidate-bound review; no legacy review carry.
        const r = this.row(work), pending = this.pending(work).filter(o => o.kind === 'finding'), occurrences = pending.map(o => this.s.one('SELECT * FROM finding_occurrences WHERE id=?', o.id));
        if (!occurrences.length)
            return null;
        const rawPatches = occurrences.map(o => parse(o.data).finding?.mechanicalPatch);
        if (rawPatches.some(p => !p))
            return null;
        const patches = [...new Map(rawPatches.map(p => [hash(p), p])).values()];
        const before = this.version(r.candidate), project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project), target = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        await materialize(before.artifact, target, parse(project.profile), before.hash);
        for (const patch of patches) {
            if (!/\.(md|txt|json)$/.test(patch.path))
                return null;
            const file = safePath(target, patch.path), text = await fs.readFile(file, 'utf8');
            if (!patch.oldText || text.split(patch.oldText).length !== 2)
                throw new Error('Exact nit before bytes not unique');
            await fs.writeFile(file, text.replace(patch.oldText, () => patch.newText));
        }
        const frozen = path.join(this.h.options.installationHome, 'inputs', randomUUID()), receipt = await freeze(target, frozen, parse(project.profile));
        const difference = delta(before.data.manifest, receipt.manifest), changed = difference.files.map(f => f.path), verification = this.version(r.verification).data.verification, consumers = verification.checks.filter((c: any) => changed.some(p => c.fixturePaths.includes(p))).map((c: any) => c.id);
        if (difference.dependencyLinks?.length)
            return null;
        if (!changed.every(p => verification.checks.some((c: any) => c.fixturePaths.includes(p))))
            return null;
        return { beforeCandidate: r.candidate, beforeDigest: before.hash, afterDigest: receipt.digest, deltaHash: hash(difference), consumerCheckIds: consumers, artifact: frozen, manifest: receipt.manifest, delta: difference, occurrences: pending.map(o => o.id), patches };
    }
    private async resolveInner(options: ChangeOperation) {
        const work = options.workId;
        try {
            const r = this.row(work);
            if (this.pending(work).some(o => o.kind === 'raw-findings-incomplete'))
                return this.blocked(work, 'Known native findings exceed the initial bounded extraction profile; full retained entry remains incomplete', 'Restore supported bounded finding extraction from exact native history; replacement clear or ordinary disposition cannot establish completeness');
            if (!Object.keys(r.data.selection ?? {}).length)
                throw new Error('All required fresh review outputs required');
            const nit = await this.nitPreview(work);
            const judge = await this.role(options, 'adjudicator', { stage: 'review-adjudication', reviews: r.data.selection, nitProposal: nit, occurrences: this.inspect(work).occurrences });
            this.assertRetainedDispositions(work, judge.launchId, judge.protocol);
            if (this.strategies(work)) {
                const expected = this.strategyReviewEvidence(work).map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] }));
                this.verificationDecisions(work, judge.protocol, expected);
            }
            const diagnosisProofs = await this.prevalidateDiagnoses(work, judge);
            this.assertRetainedDispositions(work, judge.launchId, judge.protocol);
            if (this.strategies(work)) this.phase(work, r.phase, { verificationJudge: judge.launchId });
            this.inputDecisions(work, judge.launchId, judge.protocol);
            this.s.tx(() => this.dispositions(work, judge.launchId, judge.protocol, undefined, undefined, diagnosisProofs));
            if (judge.protocol.ownerDecisionRequired?.length)
                throw new Error('Owner decision required');
            this.resolveAmendments(work, judge.launchId, judge.protocol);
            if (nit && judge.protocol.nitAuthorization) {
                const authorized = judge.protocol.nitAuthorization;
                if (this.pending(work).some(o => o.kind !== 'finding' || !nit.occurrences.includes(o.id)))
                    throw new Error('Nit authorization cannot omit newly required or other unresolved obligations');
                if (authorized.beforeCandidate !== nit.beforeCandidate || authorized.afterDigest !== nit.afterDigest || authorized.deltaHash !== nit.deltaHash || hash([...authorized.consumerCheckIds].sort()) !== hash([...nit.consumerCheckIds].sort()))
                    throw new Error('Nit authorization binding mismatch');
                this.phase(work, 'NIT_AUTHORIZED', { pendingNit: { ...nit, authorization: judge.launchId, originalReview: r.data.selection }, blocked: [], nextAction: 'confirmNit' });
                return this.inspect(work);
            }
            if (this.pending(work).length) {
                this.phase(work, 'REPAIR_REQUIRED', { blocked: this.pending(work).map(o => o.id), nextAction: 'repairChange' });
                return this.inspect(work);
            }
            return this.ready(work);
        }
        catch (error) {
            return this.blocked(work, String(error), 'resolveChange');
        }
    }
    private evidenceAt(work: string, criteriaHash: string, requireReady = false, tentativePublicationOperation?: string): CurrentEvidence {
        this.h.assertOpen();
        this.guard(work);
        this.assertMaterialAccountingCurrent(work);
        const w = this.work(work), read = this.createVerificationRead(work);
        if (!['ACTIVE', 'DELIVERED'].includes(w.state) || (requireReady && (!['ACTIVE', 'DELIVERED'].includes(w.state) || this.row(work).phase !== 'REVIEW_READY' || this.row(work).epoch !== w.epoch)))
            throw new Error('Current governed standing unavailable');
        if (criteriaHash !== this.version(this.row(work).data.contractsVersion).hash)
            throw new Error('Active criteria changed; replan required');
        const r = this.row(work), plan = r.plan ? this.version(r.plan).data.plan : null;
        if (this.h.sourceImpacts(work).some(input => input.data.effectHold))
            throw new Error('Actual source input remains independently unconsumed');
        if (!plan || !r.candidate || !this.checksCurrent(work, read) || this.pending(work).some(o => !tentativePublicationOperation || !this.tentativePublicationObligation(tentativePublicationOperation, o)))
            throw new Error('Required current planning/checks/findings incomplete');
        for (const role of plan.verification.reviewRoles) {
            const key = typeof role === 'string' ? role : role.key, launch = this.s.one('SELECT * FROM role_launches WHERE id=?', r.data.selection?.[key] ?? '');
            if (!launch || launch.role !== 'reviewer' || launch.status !== 'COMPLETE' || !this.sameNonCandidateBindings(work, parse(launch.data).inputVersions) || (parse(launch.data).inputVersions.candidate !== r.candidate && !(r.data.carry?.after === r.candidate && r.data.carry?.before === parse(launch.data).inputVersions.candidate && this.s.one('SELECT id FROM remedy_confirmations WHERE work=? AND before_version=? AND after_version=? AND launch=?', work, r.data.carry.before, r.candidate, r.data.carry.confirmation))))
                throw new Error('Required current review missing/stale');
        }
        const reviews = Object.values(r.data.selection ?? {}) as string[];
        const checks = this.s.all('SELECT id,status,data FROM check_runs WHERE work=? AND candidate=? AND verification=?', work, r.candidate, r.verification);
        const dispositions = this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work);
        const sourceChainDigest = hash(this.h.sourceImpacts(work)), selectionDigest = hash({ selection: r.data.selection, reviews: reviews.map(id => this.s.one('SELECT * FROM role_launches WHERE id=?', id)) });
        const verificationStrategyDigest = this.strategyEvidenceDigest(work, read);
        const value = { ...(verificationStrategyDigest ? { verificationStrategyDigest } : {}), projectProtection: projectProtection(this.s, w.project), workId: work, epoch: w.epoch, generation: w.generation, versions: { base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification, requirements: r.data.requirementVersion ?? null, contracts: r.data.contractsVersion }, candidateDigest: this.version(r.candidate).hash, sourceChainDigest, selectionDigest, checkIds: checks.map(c => c.id), reviewLaunchIds: reviews, dispositionDigest: hash(dispositions), carryDigest: r.data.carry ? hash(r.data.carry) : null };
        return { ...value, fingerprint: hash({ ...value, checks }) };
    }
    private tentativePublicationObligation(operationId: string, obligation: any): boolean {
        let launchId = obligation.launchId;
        if (obligation.kind === 'finding') {
            const row = this.s.one('SELECT data FROM finding_occurrences WHERE id=?', obligation.occurrence);
            if (!row)
                return false;
            const actual = parse(row.data);
            if (actual.finding?.requirementId !== 'publication-intent')
                return false;
            launchId = actual.launchId;
        }
        else if (obligation.kind !== 'diagnostic')
            return false;
        const l = launchId ? this.s.one('SELECT * FROM role_launches WHERE id=?', launchId) : null;
        if (!l || parse(l.data).stage !== 'publication-payload-fit' || parse(l.data).operationId !== operationId)
            return false;
        const run = this.s.one('SELECT * FROM runs WHERE id=?', l.run);
        const data = parse(run.data);
        return ['SETTLED', 'INTERRUPTED'].includes(run.phase) && (!data.modelDispatchAttempted || !!data.historyRef) && (!data.publicationHistoryRecovery || ['actual-native-entries-collected', 'observed-no-model-dispatch-before-interruption'].includes(data.publicationHistoryRecovery));
    }
    /** Private action-bound tentative construction, never dispatch evidence or a caller ignore list. */
    async tentativePublicationEvidence(operationId: string): Promise<CurrentEvidence> {
        const op = this.s.one('SELECT * FROM effect_operations WHERE id=?', operationId), data = op ? parse(op.data) : null;
        if (!op || data.kind !== 'publication' || data.action.kind !== 'create-comment' || data.action.purpose !== 'reviewed-summary' || !data.procedureBaseline)
            throw Error('Retained normal reviewed-summary baseline required for tentative payload recovery');
        const baseline = data.procedureBaseline;
        for (const l of this.s.all("SELECT * FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='publication-payload-fit' AND json_extract(data,'$.operationId')=?", op.work, operationId)) {
            const r = this.s.one('SELECT data FROM runs WHERE id=?', l.run), rd = parse(r.data);
            if (rd.modelDispatchAttempted && !rd.historyRef)
                throw Error('Required publication judgment history missing');
            if (rd.historyRef && rd.publicationHistoryRecovery !== 'observed-no-model-dispatch-before-interruption')
                await this.nativeEntries(l.run);
        }
        const current = this.evidenceAt(op.work, loadCriteriaSync().hash, true, operationId);
        if (hash(softwareEvidenceIdentity(current)) !== hash(softwareEvidenceIdentity(baseline)))
            throw Error('Software/source tuple changed; normal same-work verification required before payload recovery');
        return current;
    }
    async currentEvidence(work: string): Promise<CurrentEvidence> {
        this.assertMaterialAccountingCurrent(work);
        const current = await loadCriteria();
        return this.evidenceAt(work, current.hash, true);
    }
    private sourceSaveSelection(workId: string) {
            const work = this.work(workId), state = this.row(workId);
            const project = this.s.one('SELECT * FROM projects WHERE id=?', work.project);
            const source = this.s.one('SELECT * FROM sources WHERE id=?', work.source);
            if (!project || typeof project.root !== 'string' || !path.isAbsolute(project.root) || path.resolve(project.root) !== project.root ||
                !source || !state.base || !state.candidate) throw Error('Original source-save scope unavailable');
            const base = this.version(state.base), candidate = this.version(state.candidate);
            if (base.work !== workId || candidate.work !== workId || base.kind !== 'base' || candidate.kind !== 'candidate')
                throw Error('Selected source-save versions belong to another work or kind');
            return { work: { id: work.id, source: work.source, project: work.project, epoch: work.epoch, generation: work.generation, state: work.state },
                project, source, selection: { base: state.base, candidate: state.candidate, epoch: state.epoch }, base, candidate };
    }
    async captureSourceSaveInput(workId: string): Promise<SourceSaveInputSnapshot> {
        this.h.assertOpen();
        const before = this.sourceSaveSelection(workId), fingerprint = hash(before), evidence = await this.currentEvidence(workId);
        this.h.assertOpen();
        const current = this.sourceSaveSelection(workId);
        if (hash(current) !== fingerprint || evidence.workId !== workId || evidence.epoch !== before.work.epoch || evidence.generation !== before.work.generation ||
            evidence.versions.base !== before.base.id || evidence.versions.candidate !== before.candidate.id)
            throw Error('Original source-save scope changed during evidence inspection');
        this.assertCurrentEvidence(evidence);
        const captured = (version: typeof before.base) => {
            const manifest = validateManifest(version.data.manifest);
            if (hash(effective(manifest)) !== version.hash || typeof version.artifact !== 'string' || !path.isAbsolute(version.artifact) || path.resolve(version.artifact) !== version.artifact ||
                !inside(this.h.options.installationHome, version.artifact) || version.artifact === this.h.options.installationHome)
                throw Error('Selected source-save capture identity unavailable');
            return { versionId: version.id as string, digest: version.hash as string, root: version.artifact, manifest };
        };
        const base = captured(current.base), candidate = captured(current.candidate);
        if (candidate.digest !== evidence.candidateDigest) throw Error('Selected source-save candidate digest differs');
        return structuredClone({ scopeDigest: fingerprint, workId, projectId: current.project.id, projectRoot: current.project.root, sourceId: current.work.source, evidence,
            base: { ...base, kind: 'base' as const }, candidate: { ...candidate, kind: 'candidate' as const } });
    }
    assertSourceSaveInput(snapshot: SourceSaveInputSnapshot): void {
        this.h.assertOpen();
        if (hash(this.sourceSaveSelection(snapshot.workId)) !== snapshot.scopeDigest) throw Error('Original source-save scope changed');
        this.assertCurrentEvidence(snapshot.evidence);
    }
    assertCurrentEvidence(snapshot: CurrentEvidence): void {
        const current = this.evidenceAt(snapshot.workId, loadCriteriaSync().hash, true);
        if (current.fingerprint !== snapshot.fingerprint || hash(softwareEvidenceIdentity(current)) !== hash(softwareEvidenceIdentity(snapshot)))
            throw new Error('Selected current evidence changed before dispatch');
    }
    async adoptDerivedCandidate(input: DerivedCandidateInput, controls?: {
        validate: () => void;
        signal?: AbortSignal;
    }) {
        this.h.assertOpen();
        if (this.h.busy(input.workId))
            throw new Error('Work busy');
        controls?.signal?.throwIfAborted();
        controls?.validate();
        this.assertCurrentEvidence(input.expectedEvidence);
        if (input.expectedEvidence.versions.candidate !== input.predecessorCandidate)
            throw new Error('Derived candidate predecessor differs');
        if (input.native.baseVersion !== input.expectedEvidence.versions.base)
            throw new Error('Derived candidate original base version differs');
        const op = this.s.one('SELECT * FROM effect_operations WHERE id=? AND work=?', input.producerOperationId, input.workId);
        if (!op)
            throw new Error('Derived candidate lacks actual owned effect operation');
        const project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(input.workId).project), target = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        const receipt = await freeze(input.artifact, target, parse(project.profile), controls?.signal);
        if (receipt.digest !== input.digest || hash(effective(receipt.manifest)) !== hash(effective(input.manifest)))
            throw new Error('Derived materialization bytes/manifest differ');
        this.s.tx(() => {
            controls?.signal?.throwIfAborted();
            controls?.validate();
            this.assertCurrentEvidence(input.expectedEvidence);
            const before = this.version(input.predecessorCandidate), candidate = this.newVersion(input.workId, 'candidate', target, { manifest: receipt.manifest, producer: input.producerOperationId, native: input.native, effectiveDifferences: input.effectiveDifferences, publicationInventory: input.publicationInventory, delta: delta(this.version(this.row(input.workId).base).data.manifest, receipt.manifest), derived: input.kind }, receipt.digest, before.id);
            this.s.run('UPDATE works SET state=? WHERE id=?', 'ACTIVE', input.workId);
            this.s.run('UPDATE change_state SET candidate=? WHERE work=?', candidate, input.workId);
            this.phase(input.workId, 'CANDIDATE_CAPTURED', { selection: {}, carry: null, pendingNit: null, blocked: [], nextAction: 'checkChange actual derived Git context' });
        });
        return this.inspect(input.workId);
    }
    private async ready(work: string) {
        const current = await loadCriteria();
        this.evidenceAt(work, current.hash);
        this.s.tx(() => {
            this.evidenceAt(work, loadCriteriaSync().hash);
            this.phase(work, 'REVIEW_READY', { blocked: [], nextAction: 'local review-ready only' });
            this.s.run('UPDATE change_state SET epoch=? WHERE work=?', this.work(work).epoch, work);
            this.s.run('UPDATE works SET state=? WHERE id=?', 'DELIVERED', work);
        });
        return this.inspect(work);
    }
    private async confirmInner(options: ChangeOperation) {
        const work = options.workId;
        try {
            const r = this.row(work), nit = r.data.pendingNit;
            if (!nit)
                throw new Error('Independent concrete nit authorization required');
            const authorization = this.s.one('SELECT * FROM role_launches WHERE id=?', nit.authorization), authorizedInput = authorization ? parse(authorization.data).inputVersions : null;
            if (!authorization || authorization.role !== 'adjudicator' || authorization.status !== 'COMPLETE' || !this.sameNonCandidateBindings(work, authorizedInput) || authorizedInput.candidate !== nit.beforeCandidate)
                throw new Error('Nit authorization is stale for selected requirements/plan/verification/source');
            const currentCandidate = this.version(r.candidate);
            if (r.candidate !== nit.beforeCandidate && !(currentCandidate.predecessor === nit.beforeCandidate && currentCandidate.hash === nit.afterDigest && currentCandidate.data.mechanical && currentCandidate.data.producer === nit.authorization))
                throw new Error('Nit authorization before-candidate no longer current');
            const before = this.version(nit.beforeCandidate);
            const actual = await freeze(nit.artifact, path.join(this.h.options.installationHome, 'inputs', randomUUID()), parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile));
            if (actual.digest !== nit.afterDigest || hash(delta(before.data.manifest, actual.manifest)) !== nit.deltaHash)
                throw new Error('Unauthorized extra nit delta');
            this.guard(work);
            const candidate = this.newVersion(work, 'candidate', nit.artifact, { manifest: nit.manifest, producer: nit.authorization, delta: delta(this.version(r.base).data.manifest, nit.manifest), mechanical: true }, nit.afterDigest, nit.beforeCandidate);
            this.s.run('UPDATE change_state SET candidate=? WHERE work=?', candidate, work);
            this.acceptOwnVersions(work);
            await this.checksInner({ workId: work, ...(options.signal ? { signal: options.signal } : {}) });
            if (!this.checksCurrent(work))
                throw new Error('Nit consumer/check failed');
            const confirmation = await this.role(options, 'confirmer', { stage: 'exact-nit-confirmation', nitProposal: nit, currentChecks: this.inspect(work).checks });
            this.guard(work);
            if (!confirmation.protocol.confirmed || confirmation.protocol.findings.length)
                throw new Error('Independent nit confirmation incomplete');
            for (const occurrence of nit.occurrences)
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ kind: 'finding', occurrence, state: 'resolved', confirmation: confirmation.launchId }), occurrence);
            this.s.run('INSERT INTO remedy_confirmations VALUES(?,?,?,?,?,?,?)', randomUUID(), work, JSON.stringify(nit.originalReview), nit.beforeCandidate, candidate, confirmation.launchId, JSON.stringify({ deltaHash: nit.deltaHash, consumerCheckIds: nit.consumerCheckIds, authorization: nit.authorization }));
            this.phase(work, 'NIT_CONFIRMED', { selection: nit.originalReview, pendingNit: null, carry: { before: nit.beforeCandidate, after: candidate, confirmation: confirmation.launchId } });
            return this.ready(work);
        }
        catch (error) {
            return this.blocked(work, String(error), 'confirmNit / affected fresh review');
        }
    }
    private criteriaRefreshContext(work: string) {
        const owner = this.work(work), change = this.row(work);
        return { work: owner, change, bindings: this.bindings(work),
            source: this.s.one('SELECT * FROM sources WHERE id=?', owner.source),
            inputs: this.h.sourceImpacts(work), budgets: this.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind', owner.lineage),
            busy: this.h.busy(work) || this.operations.has(work) };
    }
    inspectCriteriaRefresh(work: string) {
        this.h.assertOpen();
        const context = this.criteriaRefreshContext(work), version = this.version(context.change.data.contractsVersion);
        let current: ReturnType<typeof loadCriteriaSync> | null = null, unavailable: string | null = null;
        try {
            current = loadCriteriaSync();
            if (Buffer.byteLength(JSON.stringify(current.assets)) > 2 * 1024 * 1024) throw new Error('Selected workflow rules exceed the review bound');
        } catch (error) { current = null; unavailable = String(error); }
        const names = ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md'];
        const retained = version.data.assets as Record<string, { sha256: string; selected: string }> | undefined;
        const retainedAvailable = !!retained && names.every(name => typeof retained[name]?.selected === 'string' && /^[a-f0-9]{64}$/u.test(retained[name]!.sha256)) && Buffer.byteLength(JSON.stringify(retained)) <= 2 * 1024 * 1024 && hash(retained) === version.hash;
        const holds = [context.busy ? 'busy' : null, ['CANCELLED', 'UNKNOWN'].includes(context.work.state) ? 'work-state' : null,
            !current ? 'current-unavailable' : null, !retainedAvailable ? 'retained-unavailable' : null].filter((value): value is string => !!value);
        const changed = !!current && current.hash !== version.hash;
        return { workId: work, projectId: context.work.project, sourceId: context.work.source, epoch: context.work.epoch,
            state: context.work.state, fromContractsVersion: version.id, previousHash: version.hash, currentHash: current?.hash ?? null,
            fingerprint: hash({ context, version, currentHash: current?.hash ?? null, unavailable }),
            changed, eligible: changed && !holds.length, holds, unavailable,
            assets: retainedAvailable ? names.map(name => ({ name, previousSha256: retained![name]!.sha256, previousSelected: retained![name]!.selected,
                currentSha256: current?.assets[name]?.sha256 ?? null, currentSelected: current?.assets[name]?.selected ?? null,
                selectedChanged: !!current && retained![name]!.selected !== current.assets[name]!.selected,
                provenanceChanged: !!current && retained![name]!.sha256 !== current.assets[name]!.sha256 })) : [] };
    }
    async refreshCriteria(options: {
        workId: string;
        reason: string;
        expectedEpoch?: number;
        expectedFingerprint?: string;
    }, validate?: () => void) {
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(options.workId);
        const guard = () => {
            const returned: unknown = validate?.();
            if (returned !== undefined) {
                // An invalid async guard grants no admission; observe its rejection
                // without allowing it to become an unhandled background failure.
                void Promise.resolve(returned).catch(() => {});
                throw new Error('Synchronous owner criteria validation required');
            }
        };
        guard();
        const work = options.workId, old = this.row(work), before = this.work(work), captured = this.criteriaRefreshContext(work), token = hash(captured);
        if (!options.reason.trim() || options.reason.length > 32768 || this.h.busy(work) || this.operations.has(work) || ['CANCELLED', 'UNKNOWN'].includes(before.state) || (options.expectedEpoch !== undefined && options.expectedEpoch !== before.epoch))
            throw new Error('Idle retained work, current epoch and bounded owner reason required');
        const reviewed = options.expectedFingerprint === undefined ? null : this.inspectCriteriaRefresh(work);
        if (reviewed && (reviewed.fingerprint !== options.expectedFingerprint || reviewed.holds.length))
            throw new Error('Reviewed workflow rules or original work changed; reopen /work');
        const current = await loadCriteria();
        const fresh = () => {
            this.h.assertOpen();
            this.h.assertApplicationAdmission?.(work);
            guard();
            this.h.assertOpen();
            this.h.assertApplicationAdmission?.(work);
            // Validation is trusted but may itself observe or change the source.
            // Re-read after it, including on no-op and inside the existing commit.
            if (hash(this.criteriaRefreshContext(work)) !== token || loadCriteriaSync().hash !== current.hash || reviewed && this.inspectCriteriaRefresh(work).fingerprint !== reviewed.fingerprint)
                throw new Error('Criteria refresh input changed');
        };
        fresh();
        return this.s.tx(() => {
            fresh();
            if (current.hash === this.version(old.data.contractsVersion).hash)
                return this.inspect(work);
            const sourceId = randomUUID();
            const failedWaitDiagnostic = captureCriteriaRefreshFailure(this.s, work, before.epoch + 1, current.hash, old.data.contractsVersion);
            const priorPlanningFailure = old.phase === 'BLOCKED' ? this.priorPlanningFailure(work, old) : undefined;
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'owner-criteria-refresh', uid: process.getuid?.(), pid: process.pid, work, fromContractsVersion: old.data.contractsVersion, toHash: current.hash, ...(failedWaitDiagnostic ? { failedWaitDiagnostic } : {}), ...(priorPlanningFailure ? { priorPlanningFailure } : {}) }), options.reason);
            const next = this.newVersion(work, 'contracts', null, { text: current.text, assets: current.assets, refreshSource: sourceId }, current.hash, old.data.contractsVersion);
            this.s.run('UPDATE works SET epoch=epoch+1,state=?,current_result=NULL WHERE id=?', 'ACTIVE', work);
            this.s.run('UPDATE change_state SET epoch=?,plan=NULL,verification=NULL,phase=?,data=? WHERE work=?', before.epoch + 1, 'BASE_CAPTURED', JSON.stringify({ ...old.data, contractsVersion: next, criteriaRefresh: { sourceId, fromContractsVersion: old.data.contractsVersion, toContractsVersion: next }, selection: {}, pendingNit: null, carry: null, amendmentProofs: [], blocked: [], nextAction: 'planChange', resumeStage: 'plan' }), work);
            return this.inspect(work);
        });
    }
    private adoptCriteria(work: string, result: RoleResult) {
        const refresh = this.row(work).data.criteriaRefresh;
        if (!refresh) {
            if (result.criteriaDecision)
                throw new Error('No owned criteria refresh to adopt');
            return;
        }
        const decision = result.criteriaDecision;
        if (!decision || decision.sourceId !== refresh.sourceId || decision.fromContractsVersion !== refresh.fromContractsVersion || decision.toContractsVersion !== refresh.toContractsVersion || decision.verdict !== 'adopt')
            throw new Error('Owned criteria refresh needs exact independent planning adoption');
    }
    extend(work: string, additional: number, reason: string, validate?: () => void) {
        this.h.assertOpen();
        this.row(work);
        if (!Number.isSafeInteger(additional) || additional < 1 || additional > 100 || !reason.trim())
            throw new Error('Finite owner extension1..100 and reason required');
        return this.s.tx(() => {
            validate?.();
            const w = this.work(work);
            const budget = this.s.one('SELECT lim FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'resolution');
            if (!budget || !Number.isSafeInteger(budget.lim + additional))
                throw Error('Resolution allowance extension exceeds safe finite limit');
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', randomUUID(), null, JSON.stringify({ kind: 'owner-resolution-extension', uid: process.getuid?.(), work, lineage: w.lineage, additional }), reason);
            this.s.run('UPDATE budgets SET lim=lim+? WHERE lineage=? AND kind=?', additional, w.lineage, 'resolution');
            return this.inspect(work);
        });
    }
    private materialHistoryIdentity(history: unknown): string | null {
        try {
            if (typeof history !== 'string') return null;
            const stat = lstatSync(history,{bigint:true});
            if (stat.isFile() && stat.nlink === 1n) return hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String));
        } catch { /* Missing/replaced owned evidence is never current coverage. */ }
        return null;
    }
    private materialAccountingSnapshot(launch: any) {
        const {materialAccounting, ...data} = parse(launch.data), run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
        const historyIdentity = this.materialHistoryIdentity(parse(run?.data).historyRef);
        return {
            historyIdentity,
            producerDigest: hash([{...launch,data},run]),
            claimsDigest: hash([this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id),
                this.s.all('SELECT o.* FROM finding_occurrences o JOIN role_outputs r ON r.id=o.output WHERE r.launch=? ORDER BY r.rowid,o.ordinal', launch.id)]),
        };
    }
    private materialAccountingCandidates(work:string) {
        return this.s.all("SELECT * FROM role_launches WHERE work=? AND status IN ('COMPLETE','UNUSABLE') AND json_extract(data,'$.nativeRoleIntent') IS NOT NULL ORDER BY rowid",work).filter(launch=>{
            const receipt = parse(launch.data).materialAccounting, current = this.materialAccountingSnapshot(launch);
            return receipt?.version !== 4 || current.historyIdentity === null || receipt.historyIdentity !== current.historyIdentity ||
                receipt.producerDigest !== current.producerDigest || receipt.claimsDigest !== current.claimsDigest;
        });
    }
    private materialAccountingHoldReason(work:string):string|null {
        return this.materialAccountingCandidates(work).length ? 'Original role material coverage requires same-work drive/resume before current standing' : null;
    }
    private assertMaterialAccountingCurrent(work:string) {
        const reason = this.materialAccountingHoldReason(work);
        if (reason) throw Error(reason);
    }
    private recordMaterialAccounting(launch:any,identity:string) {
        const receipt = this.materialAccountingSnapshot(launch), ld = parse(launch.data), run = this.s.one('SELECT data FROM runs WHERE id=?',launch.run), rd = parse(run.data);
        if (receipt.historyIdentity !== identity) throw Error('Original settled producer history changed during accounting commit');
        this.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:{version:4,originalCheckpoint:rd.nativeCheckpoint,nativeSessionId:rd.nativeSessionId,...receipt}}),launch.id);
    }
    /** Explicit recovery restores literal claim accounting before a paid replacement. */
    private async restoreSettledRoleMaterial(options: {workId:string;signal?:AbortSignal;applicationModel?:ApplicationModelOperation}) {
        const work = options.workId, candidates = () => this.materialAccountingCandidates(work);
        if (!candidates().length) return true;
        const owner = this.work(work), deliveredCoverage = owner.state === 'DELIVERED' ? {epoch:owner.epoch,generation:owner.generation,versions:this.bindings(work),sourceVersion:hash(this.h.sourceImpacts(work).map(i=>[i.input_id,i.revision,i.source]))} : undefined;
        await this.operation(options, 'recover', async () => {
            for (const launch of candidates()) {
                const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = parse(launch.data), rd = run && parse(run.data), owner = this.work(work);
                if (!run || run.work !== work || run.epoch !== launch.epoch || launch.epoch > owner.epoch || run.generation > owner.generation ||
                    run.phase !== 'SETTLED' || run.reservation !== 'consumed' || rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role ||
                    rd.cleanup !== 'removed' || ld.cleanup !== 'removed' || !rd.historyRef || rd.historyRef !== ld.historyRef ||
                    !rd.nativeCheckpoint || !rd.nativeSessionId || rd.nativeSessionId !== ld.nativeSessionId)
                    throw Error('Original settled producer evidence unavailable; restore its exact history and cleanup before reentry');
                const rows = () => hash([this.s.one('SELECT * FROM role_launches WHERE id=?', launch.id), this.s.one('SELECT * FROM runs WHERE id=?', run.id), this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id)]);
                const history = () => {
                    const stat = lstatSync(rd.historyRef, {bigint:true});
                    if (!stat.isFile() || stat.nlink !== 1n) throw Error('Original settled producer history is unavailable');
                    return hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String));
                };
                const before = rows(), identity = history(), entries = await this.nativeEntries(run.id);
                this.guard(work);
                if (rows() !== before || history() !== identity) throw Error('Original settled producer changed during accounting restoration');
                const intents = entries.filter(entry => entry.type === 'custom' && entry.customType === nativeRoleEntries.intent);
                const intent = intents.length === 1 ? intents[0] : undefined;
                const dispatch: any = intent?.type === 'custom' ? intent.data : null;
                if (!dispatch || dispatch.sessionId !== rd.nativeSessionId ||
                    hash(nativeRoleIntentReceipt(dispatch.request)) !== hash(ld.nativeRoleIntent))
                    throw Error('Original settled producer dispatch intent unavailable');
                const finals = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status IN ('usable','unusable') AND json_extract(data,'$.nativeSource') IS NOT NULL", launch.id);
                if (finals.length > 1) throw Error('Original selected final role material is ambiguous');
                const final = finals[0], metadata = final && parse(final.data);
                if (final && (metadata.rawFinalTruncated !== false || !metadata.nativeEntryId ||
                    readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
                        checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== final.raw))
                    throw Error('Original selected final role material is unavailable');
                this.s.tx(() => {
                    this.guard(work);
                    if (rows() !== before || history() !== identity) throw Error('Original settled producer changed before accounting commit');
                    const complete = this.harvestEntries(work, launch.id, launch.role, entries, {historyRef:rd.historyRef,providerRequests:null,issues:[],events:[],nativeSource:metadata?.nativeSource,rawFinalTruncated:false,
                        rawFinal:final?.raw ?? null,protocol:metadata?.protocol ?? null,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint}, metadata?.nativeEntryId ?? null);
                    if (!complete) return;
                    const holdId = `raw-incomplete-${launch.id}-native-material`, hold = this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', holdId, work);
                    if (hold) {
                        const data = parse(hold.data);
                        if (data.kind !== 'raw-findings-incomplete' || data.launchId !== launch.id) throw Error('Original material completeness duty changed');
                        this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({...data,state:'resolved',method:'original-native-material-accounting-restored',checkpoint:rd.nativeCheckpoint}), holdId);
                    }
                    this.recordMaterialAccounting(launch,identity);
                });
            }
            return this.inspect(work);
        },deliveredCoverage);
        return !candidates().length;
    }
    private resumeDiagnostics(work: string) {
        for (const o of this.pending(work).filter(o => o.kind === 'diagnostic')) {
            const source = randomUUID();
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', source, null, JSON.stringify({ kind: 'explicit-producer-recovery', work, launchId: o.launchId, runId: o.runId, checkId: o.checkId, receipt: o.receipt, output: o.output, uid: process.getuid?.() }), 'Explicit resume retains raw occurrences and consumes next admitted attempt; transport/protocol failure recorded, no findings waived');
            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, state: 'resolved', recoverySource: source, method: 'retain-output-and-raw-obligations-before-charged-reentry' }), o.id);
        }
    }
    private async recapture(options: ChangeOperation) {
        const work = options.workId;
        return this.operation(options, 'capture', async () => {
            const project = this.s.one('SELECT * FROM projects WHERE id=?', this.work(work).project), staging = path.join(this.h.options.installationHome, 'inputs', randomUUID()), a = this.reserve(work, null, { stage: 'base-recapture' }, staging, true);
            try {
                this.h.patchRun(a.runId, 'CAPTURING', {});
                const receipt = await freeze(project.root, staging, parse(project.profile), this.operations.get(work)!.handle.abort.signal);
                this.h.entry(a.runId);
                this.guard(work);
                const base = this.newVersion(work, 'base', staging, { manifest: receipt.manifest, producer: a.runId }, receipt.digest);
                this.s.run('UPDATE change_state SET base=?,phase=?,epoch=? WHERE work=?', base, 'BASE_CAPTURED', this.work(work).epoch, work);
                this.acceptOwnVersions(work);
                this.phase(work, 'BASE_CAPTURED', { blocked: [], nextAction: 'planChange', resumeStage: null });
                this.h.patchRun(a.runId, 'SETTLED', { manifest: receipt.manifest, attainedCapture: true, base });
                return this.inspect(work);
            }
            catch (error) {
                this.h.patchRun(a.runId, 'SETTLED', { error: String(error) });
                return this.blocked(work, String(error), 'capture');
            }
            finally {
                this.s.tx(() => this.h.settleBudget(a.runId));
            }
        });
    }
    private async recoverRoleEvidence(options: ChangeOperation) {
        const work = options.workId;
        return this.operation(options, 'recover', async () => {
            for (const obligation of this.pending(work).filter(o => o.kind === 'interrupted-producer')) {
                const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', obligation.launchId), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
                if (!launch || !run || launch.work !== work || run.work !== work || obligation.runId !== run.id || run.epoch !== launch.epoch || launch.status !== 'INTERRUPTED' || run.reservation !== 'consumed' || run.phase !== 'INTERRUPTED')
                    throw Error('Original interrupted producer/run correspondence unavailable');
                const data = parse(run.data), metadata = parse(launch.data), selected = this.row(work);
                const unallocated = data.cleanup === 'not-allocated' && ['containerId', 'historyRef', 'nativeSessionId', 'nativeCheckpoint'].every(key => data[key] === undefined || data[key] === null) && ['allocatedNative', 'attainedNative', 'modelDispatchAttempted'].every(key => data[key] === undefined || data[key] === null || data[key] === false);
                if (data.kind === 'governed-role' && (data.launchId !== launch.id || data.cleanup !== 'removed' && !unallocated))
                    throw Error('Interrupted governed producer cleanup/correspondence unavailable');
                const replan = launch.role === 'implementer' && metadata.stage === 'implementation' && data.kind === 'governed-role' && data.launchId === launch.id && !selected.candidate && metadata.inputVersions?.candidate === null && selected.plan && this.sameNonCandidateBindings(work, metadata.inputVersions) && hash(metadata.acceptedPlan) === this.version(selected.plan).hash;
                let entries: any[] = [], checkpoint: any = null;
                if (data.modelDispatchAttempted && (!data.nativeCheckpoint || !data.historyRef))
                    throw new Error('Required interrupted native history/checkpoint absent; restore exact producer before replacement');
                if (data.historyRef) {
                    let absent = false;
                    try {
                        await privateFile(data.historyRef);
                        const stat = await fs.stat(data.historyRef);
                        absent = stat.size === 0;
                    }
                    catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                            absent = true;
                        else
                            throw error;
                    }
                    if (absent) {
                        if (data.attainedNative || data.modelDispatchAttempted)
                            throw new Error('Required interrupted native history missing/empty');
                    }
                    else {
                        checkpoint = await nativeCheckpoint(data.historyRef, data.nativeCheckpoint);
                        if (checkpoint.sessionId !== data.nativeSessionId)
                            throw new Error('Interrupted native identity mismatch');
                        const text = await fs.readFile(data.historyRef, 'utf8');
                        if (hash(text) !== checkpoint.sha256)
                            throw new Error('Interrupted native history changed during collection');
                        const { parseSessionEntries } = await import('@earendil-works/pi-coding-agent');
                        entries = parseSessionEntries(text);
                    }
                }
                else if (data.attainedNative)
                    throw new Error('Required interrupted native history reference absent');
                this.guard(work);
                this.s.tx(() => {
                    this.guard(work);
                    this.harvestEntries(work, launch.id, launch.role, entries, { role: launch.role, providerRequests: null, historyRef: data.historyRef, events: this.s.all('SELECT data FROM observations WHERE run=?', run.id).map(row => parse(row.data)) }, null);
                    this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...obligation, state: 'resolved', method: checkpoint ? 'validated-native-entries-collected-before-replacement' : 'observed-no-persisted-native-producer-before-dispatch', checkpoint, entryIds: entries.filter(e => e.type === 'message' && e.message.role === 'assistant' || e.type==='custom' && e.customType===nativeRoleEntries.material).map(e => e.id) }), obligation.id);
                    // An interrupted first author has no accepted candidate. Recover
                    // its raw producer first, then use normal current-epoch planning;
                    // the old plan and partial staging remain historical evidence.
                    if (replan && !this.pending(work).some(item => item.kind === 'interrupted-producer')) {
                        this.guard(work);
                        this.phase(work, 'BASE_CAPTURED', { blocked: [], resumeStage: 'plan', nextAction: 'Replan same work after retained interrupted author recovery' });
                    }
                });
            }
            return this.inspect(work);
        });
    }
    private async fitSource(options: ChangeOperation) {
        return this.operation(options, 'source-fit', async () => {
            const judge = await this.role(options, 'adjudicator', { stage: 'source-fit', purpose: 'Consume actual held owner input before affected action' });
            if (judge.protocol.ownerDecisionRequired?.length)
                throw new Error('Consequential source ambiguity requires owner clarification');
            this.inputDecisions(options.workId, judge.launchId, judge.protocol);
            return this.inspect(options.workId);
        });
    }
    async drive(options: DriveChangeOptions) {
        options = this.captureOperation(options);
        options.signal?.throwIfAborted();
        const limit = bounded(options.maximumSteps ?? 24, 'drive steps'), work = options.workId;
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(work);
        this.applicationBinding(options);
        if (this.criteriaHoldReason(work))
            return this.inspect(work);
        if (this.h.busy(work))
            throw new Error('Work busy');
        const initial = this.work(work);
        if (initial.state === 'UNKNOWN')
            return this.inspect(work);
        if (initial.state === 'CANCELLED' || initial.state === 'INTERRUPTED' || initial.state === 'DELIVERED' && this.h.sourceImpacts(work).some(input => input.data.effectHold))
            this.s.run('UPDATE works SET state=?,epoch=epoch+1,generation=generation+1 WHERE id=?', 'ACTIVE', work);
        if (!await this.restoreSettledRoleMaterial(options)) return this.inspect(work);
        this.h.assertOpen(); this.applicationBinding(options); this.h.assertApplicationAdmission?.(work);
        options.signal?.throwIfAborted();
        if (this.criteriaHoldReason(work)) return this.inspect(work);
        if (this.pending(work).some(o => o.kind === 'raw-findings-incomplete'))
            return this.blocked(work, 'Known native findings exceed the supported extraction profile; retained entry remains incomplete', 'Restore supported bounded finding extraction from exact native history; replacement clear or ordinary disposition cannot establish completeness');
        if (this.coverageHoldReason(work) && this.row(work).plan) {
            if (this.work(work).state === 'DELIVERED')
                this.s.run('UPDATE works SET state=?,epoch=epoch+1,generation=generation+1 WHERE id=?', 'ACTIVE', work);
            this.phase(work, 'BLOCKED', { blocked: [this.coverageHoldReason(work)], resumeStage: 'plan', nextAction: 'Explicit same-W planning of actual healthy/adverse cases' });
        }
        if (this.row(work).phase === 'REVIEW_READY' && this.work(work).state === 'DELIVERED') {
            if (!this.pending(work).some(item=>item.kind==='finding')) return this.inspect(work);
            const selected = this.row(work);
            if (!selected.plan || !selected.candidate || !Object.keys(selected.data.selection ?? {}).length)
                return this.inspect(work);
            // Explicit continuation reopens only the current finding resolution.
            // Original inputs, epoch, judgments and spent allowance stay exact.
            this.s.run('UPDATE works SET state=? WHERE id=?','ACTIVE',work);
            this.phase(work,'BLOCKED',{blocked:['Restored original findings require independent current accounting'],resumeStage:'resolve',nextAction:'Resolve retained original findings on the same selected candidate'});
        }
        if (this.pending(work).some(o => o.kind === 'interrupted-producer')) {
            await this.recoverRoleEvidence(options);
            this.h.assertApplicationAdmission?.(work);
            if (this.pending(work).some(o => o.kind === 'interrupted-producer') || this.work(work).state !== 'ACTIVE')
                return this.inspect(work);
        }
        this.resumeDiagnostics(work);
        const epoch = this.work(work).epoch;
        let resume = this.row(work).phase === 'BLOCKED' ? this.row(work).data.resumeStage : null;
        for (let i = 0; i < limit; i++) {
            this.h.assertApplicationAdmission?.(work);
            if (options.signal?.aborted || this.work(work).epoch !== epoch || this.work(work).state !== 'ACTIVE')
                return this.inspect(work);
            if (this.row(work).plan && this.h.sourceImpacts(work).some(input => input.data.effectHold)) {
                await this.fitSource(options);
                this.h.assertApplicationAdmission?.(work);
                if (this.h.sourceImpacts(work).some(input => input.data.effectHold))
                    return this.inspect(work);
            }
            const r = this.row(work);
            if (r.phase === 'REVIEW_READY')
                return this.work(work).state === 'ACTIVE' ? this.operation(options, 'source-fit-ready', () => this.ready(work)) : this.inspect(work);
            const stage = nextChangeStage(r, resume);
            resume = null;
            if (stage === 'capture')
                await this.recapture(options);
            else if (stage === 'plan')
                await this.plan(options);
            else if (stage === 'implement') {
                const outcome = r.phase === 'BLOCKED'
                    ? await this.operation(options, 'implement', async () => {
                        if (r.data.nextAction === 'Explicit resume within retained allowance' && hash(r.data.blocked) === hash(['Bounded drive step limit reached'])) this.restoreBoundedPlan(work);
                        else this.restoreUnusableAuthorPlan(work);
                        return this.implementInner(options);
                    })
                    : await this.implement(options);
                // Return only the exact host-created pre-admission hold, before
                // ordinary no-progress handling can destroy its attained checkpoint.
                if (this.executionAdmissionHolds.has(outcome))
                    return outcome;
            }
            else if (stage === 'repair')
                await this.implement(options, true);
            else if (stage === 'checks')
                await this.checks(options);
            else if (stage === 'review')
                await this.review(options);
            else if (stage === 'resolve')
                await this.resolve(options);
            else if (stage === 'confirm')
                await this.confirm(options);
            else
                return this.inspect(work);
            const after = this.row(work);
            if (after.phase === 'BLOCKED' || this.work(work).state !== 'ACTIVE')
                return this.inspect(work);
            if (after.phase === r.phase)
                return this.blocked(work, 'No observed stage progress', stage);
        }
        const r = this.row(work);
        this.phase(work, r.phase, { nextAction: `Bounded drive step limit reached; explicit resume: ${r.data.nextAction}`, resumeStage: null });
        return this.inspect(work);
    }
    recover() {
        for (const l of this.s.all("SELECT * FROM role_launches WHERE status IN ('CREATED','RUNNING')")) {
            this.s.tx(() => {
                this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `interrupted-${l.id}`, l.work, JSON.stringify({ kind: 'interrupted-producer', launchId: l.id, runId: l.run, state: 'pending' }));
                this.settleRole(l.id);
                this.s.run('UPDATE role_launches SET status=? WHERE id=?', 'INTERRUPTED', l.id);
                this.phase(l.work, 'BLOCKED', { blocked: [`Interrupted producer ${l.id}; retained history/obligations require inspection`], nextAction: `Reconcile role ${l.id}; explicit charged retry`, resumeStage: ({ planner: 'plan', challenger: 'plan', adjudicator: parse(l.data).stage === 'planning-adjudication' ? 'plan' : 'resolve', implementer: 'implement', repairer: 'repair', reviewer: 'review', confirmer: 'confirm' } as Record<string, string>)[l.role] });
            });
        }
    }
}

import { isPlanningGrammar } from '../workflow/types.js';
import {expandNativeTransport} from '../workflow/native-transport.js';
import { capturePlanningRepair, changedPlanningRepairHash, isVerificationPlanRepair, planningRepairProfile, verificationCaseAdditions, type PlanningRepairProfile } from '../workflow/planning-repair.js';
import { captureScopeAmendment, scopeAmendmentProfile, scopeStrategyDigest, validateScopeAmendmentDecisions } from '../workflow/scope-amendment.js';
import { planningDomainFootprint, restorePlanningDomains } from '../workflow/planning-domains.js';
import {consumerControlInputConflict,fixedCheckInputRoles,pendingCheckForAmendment,verificationStrategyLeaves,verificationStrategySupported} from '../workflow/verification-strategy.js';
import { assessedLineCount, sourceScopeVersion } from '../workflow/source-scope.js';
import { producerEvidence, type ProducerEvidenceView } from './producer-evidence.js';
import { historicalProvenanceInputId, historicalProvenanceManifest, prepareHistoricalProvenance } from '../workflow/historical-provenance.js';
import { retainedDispositionRequests, equivalenceAccounting, assertResolvedEquivalenceEvidence, captureCurrentPendingSubjects, assertCurrentPendingAccounting } from '../workflow/adjudication-accounting.js';
import { qualifyInitialInlineBaseSource } from './initial-base-source.js';

import { buildDispositionHistory, relevantObligationStates, prepareLatestDispositions, latestDispositionFootprint } from '../workflow/disposition-history.js';
import { historicalPlanInputId, prepareHistoricalPlans, historicalRequirementsInput, restoreHistoricalRequirements } from '../workflow/historical-plans.js';
import { roleInputEvidenceManifests, type RoleInputEvidenceSnapshot } from '../workflow/role-input-evidence.js';
import { criteriaOperatingProfile, freshCriteriaDeliveryVersion, prepareCriteriaDelivery, resolveCriteriaDelivery, workflowCriteriaManifest, type CriteriaDeliveryView, type CriteriaDefinition } from '../workflow/criteria-delivery.js';
import { restoreFindingBodies, findingBodyFootprint } from '../workflow/finding-body-presentation.js';
import { metadataIdentityInput, metadataIdentityFootprint, restoreMetadataIdentities } from '../workflow/metadata-identities.js';
import { adjudicationSubjectActions, prepareSubjectActionInput, subjectActionFootprint, subjectActionInputVersion } from '../workflow/subject-actions.js';
import { nativeAdministrativeScopeView } from './scope-projection.js';
import { projectHistoricalCensus } from './historical-census.js';
import { roleFraming, nativeRoleFraming } from '../workflow/role-framing.js';
import { reviewResolutionInput, sourceFitAuthorityIssue, sourceFitInput, sourceFitReferencesInput } from '../workflow/role-input.js';
import { ModelContextBudgetError, modelContextFailureCode, type ModelContextFailureCode } from '../pi/context-budget-error.js';
import { captureCriteriaRefreshFailure } from './original-wait-outcome.js';
import { captureCriteriaResume } from './assignment-authority.js';
import { softwareEvidenceIdentity } from './effect-types.js';
import { assertVerificationScopeFeasible, finiteVerificationSupport, manifestScopeComparison, validateScopeManifest, verificationSourcePaths, type ScopeStrategy, type ScopeViolationSample } from './verification-strategies.js';
import { createResultChangesReader, recordedCheckProduction, resultEntries } from './change-result.js';
import { defaultConversationExecutionLimit, defaultConversationResolutionLimit, workCleanupUnconfirmed } from './work-recovery.js';
import { nextChangeStage, changeStageRoles, roleUsesResolutionAllowance, rolePreparesCandidate } from './change-stage.js';
import { assertSupportedRoleProfile, captureDecisionCarry, adjudicationDecisionReferences, planningDecisionCarry, historicalRoleInputBody, planningProposalApproval as readProposalApproval, planningVerificationProfile as readPlanningVerificationProfile, requirementSourceIds as readRequirementSourceIds } from '../workflow/role-input.js';
import { ownerRootActivation } from './owner-activation.js';
import { captureApplicationModelOperation, captureWorkModelBaseline, subjectRoleModel, assertOrdinaryEffectSource, type ApplicationModelOperation, type ApplicationRoleModelRequest, type WorkModelBaseline } from './application-model.js';
import type { PiModelSelection } from '../pi/session.js';
import { captureSessionPreferences } from '../pi/session-preferences.js';
import { captureNativeModelSelection, modelConfigurationIdentity } from '../pi/model-identity.js';
import { parseUniqueJson, wholeJsonFence } from '../workflow/json.js';
import { verificationReferenceDiagnostics, coverageIssue, caseDescriptor, compareCases, observeCheckOutput, changedCaseIds, baselineAssertionsMatch, bindCheckExpectations, CheckExpectationInputError } from './check-cases.js';
import { assertCheckHasProgram, buildAssertionRoster, consumerControlExpectsPass, verificationCommandContract } from '../workflow/verification-contract.js';
import { projectProtection, scopeProtection } from './protection.js';
import { rolePresentationStage, type CapacityRequest, type CapacityLease, type NativeIdentity, type NativeLifecycle } from './interaction-types.js';
import fs from 'node:fs/promises';
import { lstatSync, realpathSync, constants } from 'node:fs';
import { parseCheckOutput, parseRoleOutput, assertApprovedProposal, implementationCarryProposals, assertFindingCore, assertFinding, assertDispositionEvidence, dispositionAccountingState } from '../workflow/protocol.js';
import { rawFindings } from './raw-findings.js';
import { roleMaterialFindings, nativeTextFindingProjection, settledFormatterPrefixWithoutFindings, type NativeTextFindingRegion, type RoleMaterialProfile } from './role-material-findings.js';
import type { CurrentEvidence, DerivedCandidateInput, SourceSaveInputSnapshot } from './effect-types.js';
import { loadCriteria, loadCriteriaHashSync, loadCriteriaSync } from './criteria.js';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createScope, type ContainerScope } from '../execution/container-scope.js';
import { validateManifest, type Manifest } from './capture.js';
import { privateDirectory, privateFile, inside } from './ownership.js';
import { hash, effective, freeze, materialize, delta, sources, safePath } from './change-files.js';
import { nativeCheckpoint, readNativeHistorySnapshot, readNativeHistoryWitness, nativeHistoryIdentity, readNativeCheckpointEntries, readSelectedRoleOutput } from './history.js';
import { nativeRoleEntries, nativeRoleMaterial, nativeRoleIntentReceipt, nativeRoleSourceMaterialId, unownedNativeSelector, readUnownedNativeMaterial, readUnownedNativeMaterials, readHistoricalFormatterAttempt, readHistoricalSubmissionAttempt, readReceivedSubmissionArguments, readRejectedSubmissionAttempt, readRejectedFormatterAttempt, readTerminatedFormatterPrefix, readStoppedSubmissionPrefix, type NativeRoleIntentReceipt, type NativeRoleSource } from '../workflow/native-role-output.js';
import { assertNativeResponseSchema, structuredOutputContext } from '../pi/structured-output.js';
import { projectSelectedReview, boundSelectedReviews, reviewEvidenceHold, REVIEW_EVIDENCE_LIMITS } from './selected-review-evidence.js';
import { ControllerError, ManagedReviewChanged, type ControllerOptions } from './types.js';
import { sharePreviousCriteriaText } from '../workflow/criteria-text.js';
import type { Store } from './store.js';
import { providerUsageLimit } from '../workflow/provider-failure.js';
import { defaultRoleBounds, nativeRoleTurnLimit, roleRequestLimit } from '../workflow/execution-bounds.js';
import type { BeginChangeOptions, ChangeOperation, CheckChangeOperation, ChangeView, DriveChangeOptions, ChangeResultOptions, ChangeResultView, VerificationEvidenceView, PlanningFailureView, AssignmentAllowanceHold, AssignmentOwnerAction, WorkflowCriteriaHold } from './change-types.js';
import type { Role, RoleResult, RoleExecution, InputBundle, PlanProposal, ImplementationCarry, VerificationStrategy, PlanningVerificationProfile, SourceFitReferences, CheckSpec, CheckAmendmentProposal } from '../workflow/types.js';
class SourceScopeChangeRequiresPlanning extends Error {
    constructor() {
        super('Accepted source scope change requires fresh planning; resume this same work with planChange');
    }
}
interface VerificationRead {
    strategies(): VerificationStrategy[] | undefined;
}
/** Reuse one read within a synchronous inspection, including an unavailable result. */
function readOnce<T>(read: () => T): () => T {
    let outcome: { value: T } | { error: unknown } | undefined;
    return () => {
        if (!outcome) {
            try { outcome = { value: read() }; }
            catch (error) { outcome = { error }; }
        }
        if ('error' in outcome) throw outcome.error;
        return outcome.value;
    };
}
const recoveryGuidanceUnavailable = 'Current recovery guidance is unavailable. Inspect retained evidence before resuming.';
const uncertainSettlementInspection = (workId: string) => ({
    blocker: 'Original execution cleanup is unconfirmed; planning and further execution remain held.',
    nextAction: `Inspect original execution ownership and cleanup in /work ${workId}. ` +
        'Restore the original runtime route and confirm settlement before explicitly continuing this same work. ' +
        'A current missing-container response alone cannot clear an uncertain creation or native process. Original history and consumed allowance remain retained.',
});
type PlanningRepairEvidence = PlanningRepairProfile['subjects'][number] & {
    version: 1;
    kind: 'plan';
    acceptedPlanHash: string;
    judgeLaunchId: string;
};
type VerificationPlanRepair = {
    subject: PlanningRepairProfile['subjects'][number];
    requirementId: string;
    checkIds: string[];
    originalPlan: string;
    originalVerification: string;
    candidate: string;
};
interface Handle {
    abort: AbortController;
    scope?: ContainerScope;
    done?: Promise<unknown>;
    check?: {
        id: string;
        phase: 'preparing' | 'running' | 'settling';
    };
}
export interface ChangeHost {
    assertOwner?():void;
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
        stage?: unknown;
    }): NativeIdentity;
    nativeLifecycle: NativeLifecycle;
    coordination(identity: NativeIdentity): Omit<import('../pi/coordination.js').PiCoordination, 'wait'>;
    sourceImpacts(work: string, presentOrigin?: boolean): any[];
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
const selectedRoleMetadataUnavailable = 'Original selected role output metadata is unavailable';
const bounded = (n: number, label: string) => {
    if (!Number.isSafeInteger(n) || n < 1 || n > 1000)
        throw new ControllerError('INVALID_LIMIT', `Invalid ${label}`, 'Use a finite1..1000 limit');
    return n;
};
/** Host preflight and atomic reservation produce this pre-admission refusal. */
class ExecutionAdmissionRefusal extends ControllerError {
}
const materialDiagnosisFinding = (output: string, recipe:1|2|3|4=1) => ({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: recipe === 4 ? 'Exact stopped submission prefix requires independent diagnosis; original claims remain separately accountable' : recipe === 3 ? 'Exact rejected submission material requires independent diagnosis; original claims remain separately accountable' : recipe === 2 ? 'Exact rejected formatter public material requires independent diagnosis; original claims remain separately accountable' : 'Exact unowned public material requires independent raw assessment; original claims remain separately accountable', evidence: [output] });
const producerDiagnosisFinding = (output: string) => ({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: 'Unusable producer raw output requires independent diagnosis; ambiguous material observations cannot be erased by a replacement', evidence: [output] });
/** Decode each producer with its original captured decision grammar and identities. */
function capturedRoleConstraints(role: Role, metadata: Record<string, unknown>) {
    assertSupportedRoleProfile(metadata);
    const decisionCarry = planningDecisionCarry(role, metadata), decisionReferences = adjudicationDecisionReferences(role, metadata);
    const subjectActions = adjudicationSubjectActions(role, metadata), reviewResolution = reviewResolutionInput(role, metadata);
    const planningRepair = planningRepairProfile(role, metadata);
    const scopeAmendment = scopeAmendmentProfile(role, metadata);
    const planningProfile = readPlanningVerificationProfile(role,metadata);
    const sourceFitReferences = sourceFitReferencesInput(role, metadata);
    const sourceIds = sourceFitReferences ? readRequirementSourceIds(metadata) : undefined;
    if (sourceFitReferences && !sourceIds) throw Error('Original source-fit requirement source domain unavailable');
    const approval = sourceFitReferences?.stage === 'planning-adjudication' ? readProposalApproval(role, metadata) : undefined;
    if (approval && !planningProfile) throw Error('Original bound proposal capability unavailable');
    if (subjectActions && metadata.subjectActionCaptureHash !== subjectActionFootprint(role,metadata)) throw Error('Original subject action capture unavailable');
    return { ...(role === 'reviewer' && metadata.stage === 'consumer-control-proposal' ? {consumerControlProposal: consumerControlExpectsPass(metadata.consumerControlProposal) ? 'pass' as const : true as const} : {}),
        ...(sourceFitReferences ? {sourceFitReferences} : {}), ...(sourceIds ? {sourceIds} : {}), ...(approval && planningProfile ? {proposalApproval:approval, planningProfile} : {}), ...(planningRepair ? {planningRepair} : {}), ...(scopeAmendment ? {scopeAmendment} : {}), ...(planningProfile ? {strategyGrammarVersion:planningProfile.version} : {}), ...(decisionCarry ? { decisionCarry } : {}), ...(decisionReferences ? { decisionReferences } : {}), ...(subjectActions ? { subjectActions } : {}), ...(reviewResolution ? { reviewResolution } : {}) };
}
/** Invalid capture is an unusable decoder, never legacy grammar or lost raw material. */
function parseCapturedRoleOutput(raw: string, role: Role, metadata: Record<string, unknown>) {
    try { return parseRoleOutput(raw, role, [], capturedRoleConstraints(role, metadata)); }
    catch { return { value: null, issues: ['Original role carry/decision format unavailable'] }; }
}
/** Only declared wire recipes may differ from the canonical stored result. */
function capturedOutputNeedsDecoding(role: Role, metadata: Record<string, unknown>) {
    return !!(sourceFitReferencesInput(role, metadata) || scopeAmendmentProfile(role, metadata) || adjudicationSubjectActions(role, metadata) || reviewResolutionInput(role, metadata) ||
        (readPlanningVerificationProfile(role, metadata)?.version ?? 0) >= 6);
}
/** A captured wire envelope changes JSON location, never the original raw source. */
function capturedRoleBody(raw: string, role: Role, metadata: Record<string, unknown>): string {
    return (reviewResolutionInput(role, metadata)?.version ?? 0) >= 2 ? wholeJsonFence(raw)?.body ?? raw : raw;
}
function capturedRawFindings(raw: string | null, role: Role, metadata: Record<string, unknown>) {
    return rawFindings(raw === null ? null : capturedRoleBody(raw, role, metadata));
}
type NativeMaterialSource = Omit<ReturnType<typeof nativeRoleMaterial>['materials'][number], 'raw'> & {rawSha256:string; rawUtf8Bytes:number};
type SelectedSubmissionReference = {nativeEntryId:string; source:Extract<NativeRoleSource,{kind:'claude-sdk-tool-submission/v1'}>; rawSha256:string};
type MaterialAssessment = {version:1; source:NativeMaterialSource} | {version:2; source:NativeMaterialSource; rejectionEntryId:string; coveredOutputs:Array<{id:string;sha256:string}>} |
    {version:3; source:NativeMaterialSource; rejectionEntryId:string; coveredOutputs:Array<{id:string;sha256:string}>; selected:SelectedSubmissionReference} |
    {version:4; source:NativeMaterialSource; coveredOutputs:Array<{id:string;sha256:string}>};
function hasRejectedMaterial(outputs:readonly Record<string,unknown>[]) {
    return outputs.some(output=>{
        const source=output.materialSource;
        return source!==null && typeof source==='object' && !Array.isArray(source) && 'version' in source && (source.version===2||source.version===3);
    });
}
function hasStoppedSubmission(outputs:readonly Record<string,unknown>[]) {return outputs.some(output=>(output.materialSource as {version?:number}|undefined)?.version===4);}
function hasRejectedSubmission(outputs:readonly Record<string,unknown>[]) {return outputs.some(output=>(output.materialSource as {version?:number}|undefined)?.version===3);}
function materialAssessmentKey(source:unknown, locations:unknown[], assessment?:MaterialAssessment) {
    return hash({source,locations,...(assessment?.version === 2 ? {rejectedFormatter:assessment.rejectionEntryId,coveredOutputs:assessment.coveredOutputs} : assessment?.version === 3 ? {rejectedSubmission:assessment.rejectionEntryId,coveredOutputs:assessment.coveredOutputs,selected:assessment.selected} : assessment?.version === 4 ? {stoppedSubmissionPrefix:true,coveredOutputs:assessment.coveredOutputs} : {})});
}
function capturedMaterialFindings(raw: string, role: Role, metadata: Record<string, unknown>, formatterArguments = false, formatterProfile: RoleMaterialProfile = 1) {
    const body = capturedRoleBody(raw, role, metadata);
    return roleMaterialFindings(body, role, formatterArguments && body === raw, formatterProfile);
}
/** Stored interpretation cannot replace the literal received judgment. Keep
 * lifecycle, proposal selection and current semantic checks with each caller. */
function originalPlanningProtocol(output: any, metadata: Record<string, unknown>): RoleResult {
    const decoded = typeof output?.raw === 'string' ? parseCapturedRoleOutput(output.raw, 'adjudicator', metadata).value : null;
    const stored = output && parse(output.data), source = stored?.nativeSource;
    if (!decoded || !stored?.protocol || hash(decoded) !== hash(stored.protocol) ||
        Object.hasOwn(metadata, 'nativeRoleIntent') && source == null || source != null &&
        (!['claude-sdk-formatter/v1','claude-sdk-assistant-json/v1','claude-sdk-tool-submission/v1'].includes(source.kind) || typeof source.rawDigest !== 'string' || source.rawDigest !== hash(output.raw)))
        throw Error('Original retained planning output does not match received judgment');
    return decoded;
}
interface StrategyWitness {
    requirementId: string;
    strategyDigest: string;
    kind: VerificationStrategy['kind'];
    witnessIds: string[];
    reviewKey?: string | null;
    reviewKeys?: string[];
    parts?: StrategyWitness[];
    strategy?: import('../workflow/types.js').AtomicVerificationStrategy;
}
interface BaseClassificationProof {
    version: 1;
    sources: ReturnType<typeof qualifyInitialInlineBaseSource>[];
    fingerprint: string;
}
function controlIds(ids: readonly string[]) {
    return {count: ids.length, ids: ids.filter(id => Buffer.byteLength(JSON.stringify(id)) <= 160).slice(0, 8)};
}
class ConsumerControlMismatch extends Error {
    readonly feedback;
    constructor(readonly fingerprint: string, receiptId: string, differences: Record<string, ReturnType<typeof controlIds>>, replacement?: string) {
        const details = Object.entries(differences).flatMap(([kind, group]) => group.count ?
            [`${kind} (${group.count})${group.ids.length ? ' ' + group.ids.map(id => JSON.stringify(id)).join(', ') : ''}`] : []);
        super('Required consumer control did not show the exact predicted observations. ' + details.join('. '));
        this.feedback = {receiptId, differences, ...(replacement === undefined ? {} : {replacement})};
    }
}

export class ChangeCore {
    private executionAdmissionHolds = new WeakSet<ChangeView>();
    private readonly readResultChanges = createResultChangesReader();
    private roleBounds() {
        return { ...defaultRoleBounds, maxProviderRequests: this.h.options.maxProviderRequests ?? defaultRoleBounds.maxProviderRequests };
    }
    constructor(private h: ChangeHost) {
    }
    hasActiveOperation(work: string): boolean { return this.operations.has(work); }
    inspectActiveOperation(work: string) {
        const operation = this.operations.get(work);
        if (!operation || operation.handle.abort.signal.aborted) return undefined;
        const current = this.s.one('SELECT state,epoch,generation FROM works WHERE id=?', work);
        if (current?.state !== 'ACTIVE' || current.epoch !== operation.epoch || current.generation !== operation.generation)
            return undefined;
        const check = operation.handle.check;
        return { check: check && { id: check.id, phase: check.phase } };
    }
    private operations = new Map<string, {
        epoch: number;
        generation: number;
        admittedState: 'ACTIVE' | 'DELIVERED';
        versions: string;
        sourceVersion: string;
        handle: Handle;
        assertReservation?: () => void;
        rawAssessmentActor?: string;
    }>();
    private stopCapturedWork(work: { id: string; epoch: number; generation: number }, handle: Handle) {
        const current = this.s.one('SELECT state,epoch,generation FROM works WHERE id=?', work.id);
        // The supervisor also aborts this signal after durable cancellation has already advanced the epoch.
        if (current?.state !== 'ACTIVE' || current.epoch !== work.epoch || current.generation !== work.generation) {
            handle.abort.abort();
            return;
        }
        void this.h.cancel(work.id).catch(() => handle.abort.abort());
    }
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
    private sameNonCandidateBindings(work: string, input: any, r = this.row(work)) {
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
    }, stage: string, body: () => Promise<ChangeView>, deliveredCoverage?: {epoch:number;generation:number;versions:string;sourceVersion:string}, assessment?: {assertCurrent():void}, replan?: {scope?: true; assertCurrent():void; assertReservation():void}) {
        const work = options.workId;
        const assertPlanningScope = () => {
            if (stage !== 'plan') return;
            replan?.assertCurrent();
            if (!replan?.scope && this.pending(work).some(obligation => obligation.kind === 'verification-scope'))
                throw Error(`The retained file-scope failure requires an explicit scope replan. Inspect the original scope and recovery options in /work ${work}.`);
        };
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(work);
        this.applicationBinding(options);
        if (this.h.busy(work) || this.operations.has(work))
            throw new Error('Work busy');
        if ((stage === 'raw-assessment') !== !!assessment) throw Error('Exact raw assessment admission required');
        assessment?.assertCurrent();
        assertPlanningScope();
        if (stage !== 'recover' && !assessment) {
            if (!await this.restoreSettledRoleMaterial(options)) return this.inspect(work);
            this.h.assertOpen(); this.applicationBinding(options); this.h.assertApplicationAdmission?.(work);
            options.signal?.throwIfAborted();
            if (this.h.busy(work) || this.operations.has(work)) throw Error('Work busy');
            assertPlanningScope();
        }
        if (!['recover', 'plan', 'source-fit', 'raw-assessment'].includes(stage) && this.coverageHoldReason(work))
            return this.inspect(work);
        if (stage !== 'recover' && this.workflowCriteriaHold(work))
            return this.inspect(work);
        if (stage !== 'recover' && !assessment && this.pending(work).some(o => o.kind === 'raw-findings-incomplete'))
            throw new Error(`Original producer material is incomplete or unsupported; inspect retained history and extraction issues in /work ${work}. Supported source accounting is required before ordinary task stages continue; a replacement result cannot reconstruct missing material`);
        if (stage !== 'recover' && !assessment && this.pending(work).some(o => o.kind === 'diagnostic' || o.kind === 'interrupted-producer'))
            throw new Error('Unusable producer diagnosis requires explicit drive/resume recovery');
        const owner = this.work(work);
        if (deliveredCoverage && (stage !== 'recover' || owner.state !== 'DELIVERED' || owner.epoch !== deliveredCoverage.epoch || owner.generation !== deliveredCoverage.generation || this.bindings(work) !== deliveredCoverage.versions || hash(this.h.sourceImpacts(work).map(i=>[i.input_id,i.revision,i.source])) !== deliveredCoverage.sourceVersion))
            throw Error('Delivered material coverage source changed before admission');
        if (owner.state !== 'ACTIVE' && !deliveredCoverage)
            throw new Error('Explicit drive/resume required for inactive work');
        const handle: Handle = { abort: new AbortController() }, op = { epoch: owner.epoch, generation: owner.generation, admittedState: (deliveredCoverage ? 'DELIVERED' : 'ACTIVE') as 'ACTIVE'|'DELIVERED', versions: this.bindings(work), sourceVersion: hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])), handle,
            ...(replan ? { assertReservation: replan.assertReservation } : {}) };
        this.operations.set(work, op);
        this.h.register(work, handle);
        const stop = () => {
            if (deliveredCoverage) handle.abort.abort();
            else this.stopCapturedWork(owner, handle);
        };
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        try {
            this.guard(work);
            return await body();
        }
        catch (error) {
            if (deliveredCoverage || error instanceof ManagedReviewChanged) throw error;
            return this.blocked(work, String(error), stage);
        }
        finally {
            options.signal?.removeEventListener('abort', stop);
            this.operations.delete(work);
            this.h.unregister(work);
        }
    }
    async plan(options: ChangeOperation, explicit = false, expectedScopeReplan?: string, expectedCheckReplan?: string, expectedVerificationReplan?: string) {
        options = this.captureOperation(options);
        this.h.assertOpen();
        const scopeReplan = explicit ? this.captureScopeReplan(options.workId) : undefined;
        if (expectedScopeReplan !== undefined && scopeReplan?.checkpoint !== expectedScopeReplan)
            throw Error('Original scope replan changed; reopen its review');
        const checkReplan = expectedCheckReplan === undefined ? undefined : this.checkReplanReview(options.workId);
        if (expectedCheckReplan !== undefined && checkReplan?.fingerprint !== expectedCheckReplan)
            throw Error('Original check replan changed; reopen its review');
        const coverageReplan = explicit && !scopeReplan && !checkReplan ? this.captureVerificationReplan(options.workId) : undefined;
        if (expectedVerificationReplan !== undefined && coverageReplan?.fingerprint !== expectedVerificationReplan)
            throw Error('Original verification gap changed; reopen its review');
        if (!coverageReplan && this.pendingVerificationPlanRepair(options.workId))
            throw Error('Resume the accepted verification correction before replanning this unchanged owner request');
        const review = scopeReplan ? {scope:true as const, assertCurrent: scopeReplan.assertCurrent} : checkReplan ?? coverageReplan;
        const runtime = review && structuredClone(this.h.options.runtimeProfile);
        const assertRuntime = () => {
            if (review && !isDeepStrictEqual(this.h.options.runtimeProfile, runtime))
                throw new ManagedReviewChanged(options.workId, 'runtime');
        };
        return this.operation(options, 'plan', () => this.planInner(options, scopeReplan, checkReplan?.assertEvidenceCurrent, coverageReplan), undefined, undefined,
            review && { ...review, assertCurrent: () => { assertRuntime(); review.assertCurrent(); }, assertReservation: assertRuntime });
    }
    async implement(options: ChangeOperation, repair = false) {
        options = this.captureOperation(options);
        this.h.assertOpen();
        const scope = repair ? this.currentScopeFailure(options.workId) : undefined;
        const assertScopeCurrent = () => {
            if (scope && this.currentScopeFailure(options.workId)?.fingerprint !== scope.fingerprint) throw Error('Original failed scope changed before repair admission');
        };
        return this.operation(options, repair ? 'repair' : 'implement', () => {
            assertScopeCurrent();
            return this.implementInner(options, repair, assertScopeCurrent, scope?.diagnostic);
        });
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
            const output = outputs.length === 1 ? outputs[0] : null, metadata = output && parse(output.data),
                protocol = output && (role === 'adjudicator' ? originalPlanningProtocol(output, ld) : parseCapturedRoleOutput(output.raw, role as Role, ld).value);
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
        this.assertPlanningRepairs(work,plan);
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
    /** No-author is only a selector: the original acceptance and source proofs still gate restoration. */
    private hasUnstartedAcceptedPlan(work: string): boolean {
        const row = this.row(work);
        if (!row.plan || row.candidate) return false;
        const plan = this.version(row.plan), decision = this.s.one('SELECT rowid AS sequence,* FROM role_launches WHERE id=? AND work=?', plan.data.decisionLaunch, work);
        if (!decision || decision.role !== 'adjudicator' || decision.status !== 'COMPLETE' || parse(decision.data).stage !== 'planning-adjudication') return false;
        return !this.s.one("SELECT id FROM role_launches WHERE work=? AND rowid>? AND role IN ('implementer','repairer') LIMIT 1", work, decision.sequence);
    }
    async checks(options: CheckChangeOperation, only?: string[]) {
        options = this.captureCompanion(options);
        return this.operation(options, 'checks', () => this.checksInner(options, only));
    }
    private async checkRetainedCandidate(options: ChangeOperation) {
        const work = options.workId, owner = this.work(work), versions = this.bindings(work);
        const sourceVersion = () => hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]));
        const source = sourceVersion();
        let admitted = false;
        const outcome = await this.operation(options, 'checks', async () => {
            const current = () => {
                const target = this.work(work), execution = this.budget(work, 'execution');
                return target.epoch === owner.epoch && target.generation === owner.generation && this.bindings(work) === versions &&
                    sourceVersion() === source && this.retainedCandidateStage(work) === 'checks' && execution.consumed + execution.reserved < execution.limit;
            };
            if (!current()) return this.inspect(work);
            try {
                const selected = this.sourceQualifiedPlan(work);
                if (!selected) throw new Error('Accepted source-qualified planning judgment unavailable');
                const row = this.row(work);
                const versions = () => [this.version(row.candidate), this.version(row.verification)];
                const evidence = hash([selected, ...versions()]);
                const original = await this.historicalPlanningProducer(work, selected.output.id);
                original.assertCurrent();
                if (hash(original.output) !== hash(selected.output) || hash(original.launch) !== hash(selected.launch) ||
                    hash([this.sourceQualifiedPlan(work), ...versions()]) !== evidence)
                    throw new Error('Accepted planning evidence or candidate changed while reading the original judgment');
                if (original.context.candidateVersion !== this.row(work).candidate)
                    throw new Error('Original planning judged a different candidate');
            } catch (error) {
                const view = this.inspect(work);
                return { ...view, phase: 'BLOCKED', blocked: [...view.blocked, String(error)],
                    nextAction: 'Inspect the accepted planning evidence and retained candidate before resuming' };
            }
            this.guard(work);
            if (!current() || this.workflowCriteriaHold(work)) return this.inspect(work);
            admitted = true;
            return this.checksInner(options);
        });
        return { outcome, admitted };
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
    private versionRecord(id: string) {
        const r = this.s.one('SELECT * FROM change_versions WHERE id=?', id);
        if (!r)
            throw new Error('Required immutable version absent');
        return r;
    }
    private version(id: string) {
        const r = this.versionRecord(id);
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
    private blocked(work: string, reason: string, nextAction: string, continuation?: string | null) {
        const op = this.operations.get(work);
        if (op && (this.work(work).epoch !== op.epoch || this.work(work).state !== 'ACTIVE' || op.handle.abort.signal.aborted || op.sourceVersion !== hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source]))))
            return this.inspect(work);
        const stage = nextAction.startsWith('plan') ? 'plan' : nextAction.startsWith('implement') ? 'implement' : nextAction.startsWith('repair') ? 'repair' : nextAction.startsWith('check') ? 'checks' : nextAction.startsWith('review') ? 'review' : nextAction.startsWith('resolve') ? 'resolve' : nextAction.startsWith('confirm') ? 'confirm' : !this.row(work).base ? 'capture' : null;
        this.phase(work, 'BLOCKED', { blocked: [reason], nextAction, resumeStage: continuation === undefined ? stage ?? this.row(work).data.resumeStage ?? null : continuation });
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
    private workflowCriteriaHold(work: string): {kind: WorkflowCriteriaHold; reason: string} | null {
        try {
            if (loadCriteriaHashSync() !== this.version(this.row(work).data.contractsVersion).hash)
                return {kind:'changed',reason:'Active workflow criteria changed: explicit owner refresh-criteria and independent replan, or restore exact owned definitions'};
            return null;
        }
        catch (error) {
            return {kind:'unavailable',reason:'Owned workflow criteria unavailable or malformed: restore exact owned definitions before admission: ' + String(error)};
        }
    }
    /** A retained failed producer explains recovery; it does not authorize a retry. */
    private linkedProducerFailure(work: string, row: any, owner: any): {
        launchId: string; issues: string[]; recordedReason: string;
        presentation?: Pick<ChangeView, 'planningFailure' | 'providerFailure' | 'roleRequestLimit'>; nextAction?: string;
    } | null {
        if (row.phase !== 'BLOCKED') return null;
        try {
            const launch = this.s.one(`SELECT l.id,l.work,l.run,l.role,l.epoch,l.status,
                json_object('stage',json_extract(l.data,'$.stage'),'inputVersions',json_extract(l.data,'$.inputVersions'),
                    'cleanup',json_extract(l.data,'$.cleanup'),'nativeSessionId',json_extract(l.data,'$.nativeSessionId'),'maxProviderRequests',json_extract(l.data,'$.bounds.maxProviderRequests')) AS data,
                r.phase AS run_phase,r.reservation AS run_reservation,json_extract(r.data,'$.cleanup') AS run_cleanup,json_extract(r.data,'$.nativeCheckpoint.sha256') AS checkpoint_hash,
                json_extract(r.data,'$.nativeCheckpoint.sessionId') AS checkpoint_session,
                r.work AS run_work,r.epoch AS run_epoch,json_extract(r.data,'$.kind') AS run_kind,json_extract(r.data,'$.launchId') AS run_launch,
                json_object('kind',json_extract(d.data,'$.kind'),'state',json_extract(d.data,'$.state'),
                    'launchId',json_extract(d.data,'$.launchId'),'output',json_extract(d.data,'$.output'),'issues',json_extract(d.data,'$.issues')) AS diagnostic,
                p.id AS output_id,p.status AS output_status,json_object('issues',json_extract(p.data,'$.issues'),
                    'terminal',json_extract(p.data,'$.terminal'),'requestLimit',CASE WHEN length(json_extract(p.data,'$.requestLimit'))<=256 THEN json_extract(p.data,'$.requestLimit') ELSE NULL END,'providerRequests',json_extract(p.data,'$.providerRequests'),'providerFailure',CASE WHEN length(json_extract(p.data,'$.providerFailure'))<=4096 THEN json_extract(p.data,'$.providerFailure') ELSE NULL END) AS output
                FROM role_launches l JOIN runs r ON r.id=l.run
                LEFT JOIN obligations d ON d.id='diagnostic-'||l.id AND d.work=l.work
                LEFT JOIN role_outputs p ON p.id=json_extract(d.data,'$.output') AND p.launch=l.id
                WHERE l.work=? ORDER BY l.rowid DESC LIMIT 1`, work);
            if (!launch || launch.status !== 'UNUSABLE' || launch.epoch !== owner.epoch || launch.run_work !== work || launch.run_epoch !== owner.epoch || launch.run_kind !== 'governed-role' || launch.run_launch !== launch.id ||
                !launch.diagnostic || !launch.output || launch.output_status !== 'unusable') return null;
            const data = parse(launch.data), diagnostic = parse(launch.diagnostic), output = parse(launch.output);
            const local = roleRequestLimit(output.requestLimit);
            const requestLimit = local && output.terminal === 'error' && launch.run_phase === 'SETTLED' && launch.run_reservation === 'consumed' &&
                launch.run_cleanup === 'removed' && data.cleanup === 'removed' &&
                data.maxProviderRequests === local.limit && output.providerRequests === local.used ? local : undefined;
            const stages: Record<string, { role: Role; resume: string }> = {
                planning: { role: 'planner', resume: 'plan' }, 'planning-challenge': { role: 'challenger', resume: 'plan' },
                'planning-adjudication': { role: 'adjudicator', resume: 'plan' }, implementation: { role: 'implementer', resume: 'implement' },
                'substantive-repair': { role: 'repairer', resume: 'repair' }, 'fresh-review': { role: 'reviewer', resume: 'review' },
                'consumer-control-proposal': { role: 'reviewer', resume: 'review' },
                'review-adjudication': { role: 'adjudicator', resume: 'resolve' }, 'exact-nit-confirmation': { role: 'confirmer', resume: 'confirm' },
            };
            const stage = stages[data.stage];
            const auxiliaryLocal = requestLimit && launch.role === 'adjudicator' && ['source-fit', 'raw-assessment'].includes(data.stage);
            if ((!stage || stage.resume !== row.data.resumeStage || stage.role !== launch.role) && !auxiliaryLocal || diagnostic.kind !== 'diagnostic' || diagnostic.state !== 'pending' ||
                diagnostic.launchId !== launch.id || diagnostic.output !== launch.output_id || !Array.isArray(output.issues) || !output.issues.length ||
                output.issues.some((issue: unknown) => typeof issue !== 'string') || !Array.isArray(diagnostic.issues) || hash(diagnostic.issues) !== hash(output.issues)) return null;
            const role = (stage?.role ?? launch.role) as Role;
            const versions = { contracts: row.data.contractsVersion, requirements: row.data.requirementVersion ?? null, base: row.base, candidate: row.candidate, plan: row.plan, verification: row.verification };
            const recordedReason = 'ControllerError: ' + output.issues.join('; ');
            if (!data.inputVersions || Object.entries(versions).some(([key, value]) => data.inputVersions[key] !== value) ||
                !Array.isArray(row.data.blocked) || !row.data.blocked.includes(recordedReason)) return null;
            const linked = { launchId: launch.id, issues: output.issues as string[], recordedReason };
            const reported = providerUsageLimit(output.providerFailure);
            const settledNativeFailure = output.terminal === 'error' && launch.run_phase === 'SETTLED' &&
                data.cleanup === 'removed' && launch.run_cleanup === 'removed' &&
                typeof launch.checkpoint_hash === 'string' && /^[a-f0-9]{64}$/.test(launch.checkpoint_hash);
            const providerFailure = stage && reported && settledNativeFailure &&
                reported.ownerSessionId === data.nativeSessionId ? reported : undefined;
            const toolInvocationMismatch = settledNativeFailure && launch.run_reservation === 'consumed' &&
                typeof data.nativeSessionId === 'string' && data.nativeSessionId.length > 0 && launch.checkpoint_session === data.nativeSessionId &&
                linked.issues.includes('PROVIDER:BRIDGE_HOST_TOOL_INVOCATION_MISMATCH');
            const planningFailure: PlanningFailureView | undefined = stage?.resume === 'plan' &&
                (role === 'planner' || role === 'challenger' || role === 'adjudicator')
                ? { role, launchId: launch.id, ...(providerFailure ? { providerFailure } : {}),
                    ...(toolInvocationMismatch ? { cause: 'tool-invocation-mismatch' } : {}) } : undefined;
            let presentation: Pick<ChangeView, 'planningFailure' | 'providerFailure' | 'roleRequestLimit'>;
            if (planningFailure) presentation = { planningFailure };
            else if (providerFailure && role !== 'planner' && role !== 'challenger')
                presentation = { providerFailure: { role, launchId: launch.id, usageLimit: providerFailure } };
            else if (requestLimit) presentation = {};
            else return linked;
            if (requestLimit) {
                const roleStage = rolePresentationStage(role, data.stage);
                presentation.roleRequestLimit = {role, ...(roleStage ? {roleStage} : {}), launchId: launch.id, requestLimit};
            }
            const nextAction = (requestLimit ? `This role reached gitjig's local model-request limit (${requestLimit.used}/${requestLimit.limit}); the next provider request was not dispatched. A fresh role attempt uses remaining original work allowance. ` : '') + (providerFailure
                ? 'The provider reported a usage-limit rejection during this failed role. Wait and check the account limits before explicitly continuing the same work. A reported reset does not guarantee renewed access. ' : '') +
                `Inspect original ${planningFailure ? 'planning role' : 'role'} ${launch.id} and its retained diagnostics in /work ${work}. ` +
                `No usable ${planningFailure ? 'planning ' : ''}result was received. Resolve the recorded producer failure and other holds before explicitly continuing this same work. ` +
                'A retry consumes remaining original allowance; retain original evidence and consumed usage.';
            return { ...linked, presentation, nextAction };
        } catch { return null; } // Unavailable attribution cannot establish a producer cause.
    }
    private restoredProducerReason(work: string, failure: NonNullable<ReturnType<ChangeCore['linkedProducerFailure']>>, accountingCandidates: {id:string}[]): string | undefined {
        const extractionIssue = 'NATIVE_FINDING_HARVEST: original material extraction unavailable';
        if (!failure.issues.includes(extractionIssue) || accountingCandidates.some(launch => launch.id === failure.launchId))
            return;
        const source = this.s.one(`SELECT l.data AS launch_data,r.data AS run_data,d.data AS duty_data FROM role_launches l
            JOIN runs r ON r.id=l.run AND r.work=l.work
            JOIN obligations d ON d.work=l.work AND d.id='raw-incomplete-'||l.id||'-native-material'
            WHERE l.id=? AND l.work=? AND r.phase='SETTLED' AND r.reservation='consumed'
                AND json_valid(l.data) AND json_valid(r.data) AND json_valid(d.data)`, failure.launchId, work);
        if (!source) return;
        const launch = parse(source.launch_data), run = parse(source.run_data), duty = parse(source.duty_data);
        const receipt = launch.materialAccounting;
        if (duty?.kind !== 'raw-findings-incomplete' || duty.state !== 'resolved' || duty.launchId !== failure.launchId ||
            duty.method !== 'original-native-material-accounting-restored' || !launch.nativeRoleIntent ||
            !duty.checkpoint?.sha256 || !receipt || receipt.nativeSessionId !== run.nativeSessionId ||
            hash(duty.checkpoint) !== hash(run.nativeCheckpoint) || hash(receipt.originalCheckpoint) !== hash(run.nativeCheckpoint))
            return;
        const activeIssues = failure.issues.filter(issue => issue !== extractionIssue);
        return activeIssues.length ? 'ControllerError: ' + activeIssues.join('; ') : 'The original role ended without a usable result.';
    }
    /** Recorded provenance only; no criteria, history, model or admission reads. */
    recordedProducerFailures(work: string): Pick<ChangeView, 'planningFailure' | 'providerFailure' | 'roleRequestLimit'> | undefined {
        this.h.assertOpen();
        return this.linkedProducerFailure(work, this.row(work), this.work(work))?.presentation;
    }
    recordedPlanningFailure(work: string): PlanningFailureView | undefined {
        return this.recordedProducerFailures(work)?.planningFailure;
    }
    private currentPlanningClarification(work: string, row: ReturnType<ChangeCore['row']>, owner: ReturnType<ChangeCore['work']>): ChangeView['planningClarification'] {
        const reference = row.data.planningClarification;
        if (!reference || row.phase !== reference.phase || owner.state !== 'ACTIVE') return;
        try {
            const launch = this.s.one('SELECT * FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1', work);
            if (launch?.id !== reference.launchId || launch.role !== 'adjudicator' || launch.status !== 'COMPLETE' || launch.epoch !== owner.epoch) return;
            const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = parse(launch.data), rd = run && parse(run.data);
            if (!run || run.work !== work || run.epoch !== owner.epoch || run.generation !== owner.generation || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
                ld.stage !== 'planning-adjudication' || ld.cleanup !== 'removed' || rd.kind !== 'governed-role' || rd.cleanup !== 'removed' || rd.launchId !== launch.id ||
                !this.sameNonCandidateBindings(work, ld.inputVersions) || ld.inputVersions.candidate !== row.candidate ||
                rd.sourceInputHash !== hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]))) return;
            const output = this.s.one('SELECT * FROM role_outputs WHERE id=? AND launch=? AND status=?', reference.outputId, launch.id, 'usable');
            if (!output || this.planningOutputHash(output) !== reference.outputHash) return;
            const questions = parse(output.data).protocol?.ownerDecisionRequired;
            if (!Array.isArray(questions) || !questions.length || questions.some(question => typeof question !== 'string')) return;
            const state = "CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
            const replies = typeof rd.nativeSessionId === 'string' && rd.nativeSessionId ? this.s.all(`SELECT c.id AS conversationId,c.generation,s.direction AS directionRevision FROM conversations c
                JOIN conversation_state s ON s.conversation=c.id
                WHERE c.project=? AND s.work=? AND s.native_id=? AND s.resource='IDLE' AND s.archived=0
                AND json_extract(${state},'$.role')='adjudicator' AND json_extract(${state},'$.runId')=?
                AND json_extract(${state},'$.lifecycle.deleted') IS NOT 1 LIMIT 2`, owner.project, work, rd.nativeSessionId, run.id) : [];
            return {outputId: output.id, questions: resultEntries(questions, 8, 2048),
                ...(replies.length === 1 ? {reply: replies[0]} : {})};
        } catch { /* Missing current attribution leaves the historical blocker readable. */ }
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
    inspectModelPrerequisites(workId: string, prospectiveHeldInput = false): {
        stage: string;
        roles: readonly Role[];
    } {
        this.h.assertOpen();
        const r = this.row(workId), w = this.work(workId), pending = this.pending(workId);
        if (this.h.busy(workId))
            return { stage: 'busy', roles: [] };
        const rawHolds=pending.filter(item=>item.kind === 'raw-findings-incomplete');
        if (w.state === 'ACTIVE' && ownerRootActivation(parse(w.data))?.state !== 'PENDING' && !this.workflowCriteriaHold(workId) && rawHolds.length === 1 &&
            !pending.some(item=>item.kind === 'interrupted-producer')) {
            const producer=this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',rawHolds[0]!.launchId,workId);
            if ((producer && this.hasMalformedSelectedRoleMetadata(producer.id)) || this.hasUnreadableRoleMaterial(workId)) return { stage: 'held', roles: [] };
            const selected=producer && this.historicalSelectedOutputs(producer.id), run=producer && this.s.one('SELECT * FROM runs WHERE id=?',producer.run);
            if (producer?.status === 'UNUSABLE' && producer.epoch <= w.epoch && run?.generation <= w.generation && run.phase === 'SETTLED' &&
                parse(producer.data).cleanup === 'removed' && parse(run.data).cleanup === 'removed' && selected?.length === 1 && parse(selected[0].data).nativeSource?.kind === 'claude-sdk-assistant-json/v1')
                return {stage:'raw-assessment',roles:changeStageRoles('raw-assessment')};
        }
        if (workCleanupUnconfirmed(this.s, w) || ownerRootActivation(parse(w.data))?.state === 'PENDING' || this.workflowCriteriaHold(workId) ||
            this.materialAccountingHoldReason(workId) || pending.some(item => ['raw-findings-incomplete', 'interrupted-producer'].includes(item.kind))) {
            return { stage: 'held', roles: [] };
        }
        const stage = this.sourceAwareStage(workId, r, prospectiveHeldInput);
        if (stage === 'plan' && pending.some(item => !['check', 'finding', 'diagnostic'].includes(item.kind))) {
            return { stage: 'held', roles: [] };
        }
        return { stage: stage ?? 'held', roles: changeStageRoles(stage) };
    }
    /** Only a known charge at the selected continuation boundary. Admission remains transactional. */
    inspectContinuationAllowance(workId: string, { stage, roles }: ReturnType<ChangeCore['inspectModelPrerequisites']>): 'execution' | 'resolution' | undefined {
        if (!roles.length && stage !== 'capture' && stage !== 'checks') return;
        const execution = this.budget(workId, 'execution');
        if (execution.consumed + execution.reserved >= execution.limit &&
            (roles.length || stage === 'capture' || this.checkContinuationChargesExecution(workId)))
            return 'execution';
        if (roles.some(roleUsesResolutionAllowance)) {
            const resolution = this.budget(workId, 'resolution');
            if (resolution.consumed + resolution.reserved >= resolution.limit) return 'resolution';
        }
    }
    private checkContinuationChargesExecution(work: string): boolean {
        try {
            const row = this.row(work);
            // The retained-candidate route checks the allowance before reading its original judgment.
            if (this.retainedCandidateStage(work, row) === 'checks') return true;
            if (!row.candidate || !row.verification || this.checkOutputRecovery(work).hold) return false;
            const candidate = this.version(row.candidate), verification = this.version(row.verification);
            if (candidate.work !== work || candidate.kind !== 'candidate' || verification.work !== work || verification.kind !== 'verification') return false;
            const [check] = this.requiredCandidateChecks(work);
            if (!check || typeof check.command !== 'string' || !check.command.trim()) return false;
            for (const strategy of (this.strategies(work) ?? []).flatMap(verificationStrategyLeaves)) {
                if (strategy.kind !== 'manifest-scope-duty') continue;
                const comparison = this.scopeEvidence(work, strategy);
                if (!comparison.evidence.actual.satisfied) return false;
                if (!this.scopeRecord(work, strategy, comparison)) this.pendingScopePremise(work, strategy);
            }
            this.assertCheckExpectations(row, check, candidate.id, 'required');
            return true;
        } catch {
            // Preserve the existing evidence recovery when the selected check cannot be read.
            return false;
        }
    }
    /** Inspect the first producer and unavoidable stage charges without admitting work. */
    inspectAssignmentAllowance(workId: string, prospectiveHeldInput = true): AssignmentAllowanceHold | null {
        this.h.assertOpen();
        if (!['ACTIVE', 'DELIVERED'].includes(this.work(workId).state)) return null;
        const { stage, roles } = this.inspectModelPrerequisites(workId, prospectiveHeldInput), role = roles[0];
        if (!role) return null; // Preserve stronger holds and stages without a model producer.
        const execution = this.budget(workId, 'execution'), resolution = this.budget(workId, 'resolution');
        const budgets = { execution, resolution };
        const needsResolution = roles.some(roleUsesResolutionAllowance);
        const exhausted = (['execution', 'resolution'] as const).filter(kind => {
            const budget = budgets[kind];
            return (kind === 'execution' || needsResolution) && budget.consumed + budget.reserved >= budget.limit;
        });
        if (!exhausted.length) return null;
        return { stage, role, exhausted, execution, resolution,
            nextAction: `After settlement, inspect /work ${workId}. If shared ${exhausted.join(' and ')} allowance is still exhausted, the owner must explicitly extend it before ${prospectiveHeldInput ? 'sending new instructions' : 'resuming this work'}. ` +
                'Report the retained outcome and this hold to the owner. A continuation does not extend allowance, and asking the child to extend it supplies no authority.' };
    }
    inspectAssignmentOwnerAction(work: string, prospectiveHeldInput: boolean): AssignmentOwnerAction | null {
        const criteria = this.workflowCriteriaHold(work);
        if (criteria)
            return {kind: 'workflow-criteria', hold: criteria.kind, nextAction: criteria.kind === 'changed'
                ? `The installed gitjig workflow rules changed. Ask the owner to open /work ${work} and choose Review updated gitjig workflow rules, or restore the selected rules exactly. Inspect the original assignment again afterward.`
                : `The workflow rules for this work could not be verified. Ask the owner to inspect /work ${work}. Restore the exact workflow rule files before continuing.`};
        const row = this.row(work);
        if (row.data.planningClarification?.kind === 'planning') {
            const clarification = this.currentPlanningClarification(work, row, this.work(work));
            if (clarification && this.inspectModelPrerequisites(work).stage === 'plan')
                return {kind: 'planning-clarification', outputId: clarification.outputId, questionCount: clarification.questions.total,
                    nextAction: `Ask the owner to review the recorded questions in /change result ${work}. ` + (clarification.reply
                        ? 'Open the reply pane and inspect the original assignment again after the owner answer is recorded.'
                        : 'The reply pane is unavailable. The owner can restore it if archived or explicitly reconsider from the original work.')};
        }
        const allowance = this.inspectAssignmentAllowance(work, prospectiveHeldInput);
        if (allowance) return allowance;
        const repeat = this.repeatedCheckReport(work);
        return repeat && this.inspectModelPrerequisites(work, prospectiveHeldInput).stage !== 'held'
            ? {kind: 'repeated-check-report', checkId: repeat.checkId, nextAction: this.repeatedCheckReportAction(work, repeat.status)} : null;
    }
    private repeatedCheckReport(work: string): {checkId: string; status: 'unavailable' | 'fail'} | undefined {
        const row = this.row(work);
        if (row.phase !== 'BLOCKED' || row.data.resumeStage !== 'repair' || !row.candidate || !row.verification ||
            !['ACTIVE', 'DELIVERED'].includes(this.work(work).state)) return;
        for (const check of this.requiredCandidateChecks(work))
            for (const status of ['unavailable', 'fail'] as const)
                if (this.repeatsCheckFailure(work, check, status))
                    return {checkId: check.id, status};
    }
    private repeatedCheckReportAction(work: string, status: 'unavailable' | 'fail') {
        const result = status === 'unavailable' ? 'produced the same unusable output' : 'reported the same material failure';
        return `Repair left the candidate unchanged and the required check ${result}. Inspect /work ${work} and review the retained evidence. The owner can authorize another attempt with /change resume ${work}.`;
    }
    /** Logical continuation is retained independently of a temporary source-fit failure. */
    private continuationStage(work: string, row = this.row(work)): string | undefined {
        if (row.plan && this.coverageHoldReason(work)) return 'plan';
        if (row.phase === 'REVIEW_READY' || row.phase === 'BLOCKED' && row.data.resumeStage === 'complete') {
            if (this.pending(work).some(item => item.kind === 'finding')) return 'resolve';
            return this.strategyHoldReason(() => this.inspectVerificationEvidence(work)) ? undefined : 'complete';
        }
        const stage = nextChangeStage(row, row.phase === 'BLOCKED' ? row.data.resumeStage ?? null : null, this.retainedCandidateStage(work, row));
        // Old retry checkpoints retain their bytes; current source-qualified
        // rejected output selects diagnosis instead of another unchanged check.
        if (stage === 'checks' || stage === 'repair' || stage === 'plan' && row.phase === 'BLOCKED' && row.candidate) {
            try {
                if (row.phase === 'BLOCKED' && stage !== 'repair' && this.currentScopeFailure(work)) return 'repair';
                if (stage === 'plan') return stage;
                const recovery = this.checkOutputRecovery(work);
                recovery.assertAvailable();
                if (recovery.view) return 'repair';
            } catch {
                // A fresh check may retry unavailable execution, but an author
                // needs the same source proof as the actual repair boundary.
                if (stage === 'repair') return undefined;
            }
        }
        return stage;
    }
    /** Existing planning/final adjudication can judge their own held source inputs. */
    private sourceAwareStage(work: string, row = this.row(work), prospectiveHeldInput = false): string | undefined {
        const stage = this.continuationStage(work, row);
        const heldInput = row.plan && this.h.sourceImpacts(work).some(input => input.data.effectHold);
        const healthy = changeStageRoles(stage).length > 0 || stage === 'capture' || stage === 'checks' || stage === 'complete';
        if (prospectiveHeldInput && !healthy) return stage;
        return row.plan && (heldInput || prospectiveHeldInput) && stage !== 'plan' && stage !== 'resolve'
            ? 'source-fit' : stage;
    }
    private inspectRecovery(workId: string, r: ReturnType<ChangeCore['row']>, w: ReturnType<ChangeCore['work']>, read: VerificationRead,
        evidence = () => this.verificationEvidence(workId, read)) {
        const activation = ownerRootActivation(parse(w.data)), activationHold = activation?.state === 'PENDING';
        const workflowCriteria = this.workflowCriteriaHold(workId);
        const criteriaReason = workflowCriteria?.reason ?? null;
        const coverageReason = criteriaReason && activationHold ? null : this.coverageHoldReason(workId, read);
        const strategyReason = r.phase === 'REVIEW_READY' ? this.strategyHoldReason(evidence) : null;
        const accountingCandidates = this.materialAccountingCandidates(workId);
        const criteriaHold = criteriaReason ?? coverageReason ?? strategyReason, materialCoverageReason = this.materialAccountingHoldReason(workId, accountingCandidates), materialReason = materialCoverageReason ??
            (r.phase === 'REVIEW_READY' && this.pending(workId).some(o=>o.kind==='finding') ? 'Received findings require independent accounting before current standing' : null);
        const execution = this.budget(workId, 'execution'), resolution = this.budget(workId, 'resolution');
        const allowances = { execution, resolution };
        const exhausted = (['execution', 'resolution'] as const).filter(kind => {
            const budget = allowances[kind];
            return budget.consumed + budget.reserved >= budget.limit;
        });
        const allowanceActions = exhausted.map(kind => 'Extend shared ' + kind + ' allowance');
        const planningDiagnosis = r.phase === 'BASE_CAPTURED' && !r.plan && this.pending(workId).some(item => item.kind === 'diagnostic');
        const planningEntryHold = w.state === 'ACTIVE' && r.phase === 'BASE_CAPTURED' && !r.plan && (planningDiagnosis || exhausted.length > 0);
        const settlementHold = workCleanupUnconfirmed(this.s, w) ? uncertainSettlementInspection(workId) : null;
        const producerFailure = this.linkedProducerFailure(workId, r, w);
        const recordedReasons = r.data.blocked ?? [];
        const restoredReason = producerFailure && this.restoredProducerReason(workId, producerFailure, accountingCandidates);
        const currentReasons = restoredReason
            ? recordedReasons.map((reason:string) => reason === producerFailure.recordedReason ? restoredReason : reason)
            : recordedReasons;
        const retainedStage = this.retainedCandidateStage(workId, r, read);
        const retainedHold = retainedStage === 'held' ? 'The accepted planning evidence does not bind the selected candidate' : null;
        let nextAction = r.phase === 'BLOCKED' && r.data.resumeStage === 'plan'
            ? `Inspect original planning blockers and role records in /work ${workId} before explicitly continuing this same work. Preserve original evidence and consumed allowance.`
            : this.retainedStageNextAction(workId, retainedStage) ?? r.data.nextAction ?? '';
        let modelContextFailure: ModelContextFailureCode | undefined;
        let scopeFailure: ChangeView['scopeFailure'];
        let checkRecoveryHold: string | undefined;
        if (settlementHold) {
            nextAction = settlementHold.nextAction;
        }
        else if (activationHold) {
            nextAction = 'Restore the captured delegation profile; use change activate --work ' + workId +
                ' --epoch ' + w.epoch + (['CANCELLED', 'INTERRUPTED'].includes(w.state) ? ' --resume-cancelled true' : '');
        }
        else if (criteriaHold) {
            if (workflowCriteria)
                nextAction = workflowCriteria.kind === 'unavailable' ? 'Restore exact owned workflow rule definitions before resuming this work.'
                    : '/work ' + workId + ' → Review updated gitjig workflow rules; CLI: change refresh-criteria --work ' + workId + ' --reason TEXT, or restore exact owned definitions';
            else
                nextAction = strategyReason ? 'Inspect current typed verification witnesses and repeat the original independent review/adjudication; no readiness or effect authority is inferred'
                    : 'Explicit change run/resume replans same W with supported verification strategies and actual healthy/adverse consumer evidence; retain old evidence and allowances';
        }
        else if (materialReason) {
            if (materialCoverageReason === selectedRoleMetadataUnavailable)
                nextAction = `Restore the original selected role output metadata before resuming this work. Inspect the retained role records in /work ${workId}.`;
            else if (materialCoverageReason) {
                nextAction = `Review the original response and retained findings in /work ${workId}. Use change resume --work ${workId} to validate the original evidence. Restore unavailable original records before retrying.`;
                if (this.inspectModelPrerequisites(workId).stage === 'raw-assessment') {
                    nextAction += allowanceActions.length
                        ? ` If independent assessment is needed after validation, open /work ${workId} and select ${allowanceActions.join(' and ')} after settlement before resuming that assessment.`
                        : ' If the original response qualifies after validation, resume may run one independent read-only assessment using the remaining allowance.';
                }
            }
            else
                nextAction = `Explicit change resume --work ${workId} independently resolves retained findings on the same selected candidate. Preserve original history, inputs and spent allowance; the admitted assessment may consume remaining allowance.`;
        }
        else if (planningEntryHold) {
            nextAction = planningDiagnosis
                ? `Review the retained producer failure in /work ${workId}. `
                : `Review the retained planning entry in /work ${workId}. `;
            if (allowanceActions.length)
                nextAction += `After settlement, explicitly ${allowanceActions.join('; ')} in /work ${workId}. `;
            nextAction += `Then use /change resume ${workId} to recover this same work before new planning. ` +
                'Original diagnostics, findings, evidence and consumed usage remain retained; inspection does not retry or resolve them.';
        }
        else if (r.phase === 'BLOCKED' || r.phase === 'REPAIR_REQUIRED') {
            const contextHeld = (Array.isArray(r.data.blocked) ? r.data.blocked : []).map(modelContextFailureCode).find((code: ModelContextFailureCode | undefined) => code !== undefined);
            const formatterHeld = w.state === 'ACTIVE' && !contextHeld && (Array.isArray(r.data.blocked) ? r.data.blocked : []).some((cause: unknown) =>
                typeof cause === 'string' && cause.startsWith('Error: NATIVE_FORMATTER_SCHEMA_UNSUPPORTED: '));
            if (w.state === 'ACTIVE')
                modelContextFailure = contextHeld;
            if (contextHeld) {
                let modelGuidance = 'Explicit profiles retain their original model route and configuration.';
                try {
                    if (subjectRoleModel(this.s, workId).baseline) {
                        const stage = this.sourceAwareStage(workId, r);
                        const roles = changeStageRoles(stage);
                        const roleCommand = roles.length === 1 ? `/role-model ${roles[0]}` : '/role-model';
                        modelGuidance = `Inspect model choices with ${roleCommand}. A saved override applies to future launches of that role across the application.`;
                    }
                } catch {
                    modelGuidance = 'Restore the saved model configuration for this work before retrying.';
                }
                nextAction = `Review the selected role model's context/output limits and retained required inputs in /work ${workId}. ` +
                    `${modelGuidance} ` +
                    'Preserve required inputs, original evidence and consumed allowance; an unchanged retry does not add context capacity.';
                if (allowanceActions.length)
                    nextAction += ` After resolving the context capacity mismatch and settling the current work, open /work ${workId} and select ${allowanceActions.join(' and ')}.`;
                nextAction += ` Once the model and inputs fit and allowance is available, use /change resume ${workId}.`;
            }
            else if (formatterHeld)
                nextAction = `Update gitjig or correct its native formatter schema before explicitly resuming the same work in /work ${workId}. ` +
                    'This is an application compatibility failure; more execution or resolution allowance does not repair the schema. ' +
                    'Preserve the original request, diagnostics, findings and consumed usage.';
            else if (producerFailure?.nextAction)
                nextAction = producerFailure.nextAction;
            else if (r.phase === 'REPAIR_REQUIRED' || ['checks', 'repair'].includes(r.data.resumeStage) || r.data.resumeStage === 'plan' && r.candidate) {
                try {
                    const recovery = r.data.resumeStage === 'plan' ? undefined : this.checkOutputRecovery(workId);
                    checkRecoveryHold = recovery?.hold;
                    if (recovery?.view) nextAction = this.repeatedCheckReport(workId)?.status === 'unavailable'
                        ? this.repeatedCheckReportAction(workId, 'unavailable')
                        : recovery.view.nextAction + ` Inspect /work ${workId}; original evidence and consumed allowance remain retained.`;
                    else {
                        const scope = this.currentScopeFailure(workId);
                        if (scope && w.state === 'ACTIVE') {
                            const { evidenceId, requirementId } = scope.diagnostic;
                            let replanAvailable = false;
                            try { replanAvailable = !!this.captureScopeReplan(workId); } catch { /* A displayed failure alone supplies no replan admission. */ }
                            scopeFailure = { evidenceId, requirementId,
                                allowedChangePaths: resultEntries(scope.strategy.allowedChangePaths, 12, 2048),
                                unchangedPaths: resultEntries(scope.strategy.unchangedPaths, 12, 2048),
                                ...(replanAvailable ? { replanAvailable: true } : {}) };
                            nextAction = `Explicit /change resume ${workId} admits a charged repair within the accepted file scope. ` +
                                (replanAvailable ? `If the accepted scope conflicts with the original request, use /change replan ${workId} for independent correction within the remaining allowance.`
                                    : 'Inspect the original failure evidence and settle current holds before requesting a scope replan.');
                        }
                    }
                } catch { checkRecoveryHold = 'Selected verification evidence cannot substantiate repair; inspect the retained evidence before retrying'; }
                if (checkRecoveryHold) nextAction = checkRecoveryHold + ` in /work ${workId}. No diagnostic authoring is admitted from unavailable source.`;
            }
            if (allowanceActions.length && !contextHeld && !formatterHeld) {
                nextAction = `${nextAction || 'Inspect original blockers'}. Allowance recovery: open /work ${workId}; ` +
                    `explicitly ${allowanceActions.join('; ')} after settlement, then /change resume ${workId}. ` +
                    'Original identity, consumed usage and findings remain retained.';
            }
        }
        const readinessHeld = Boolean(settlementHold || activationHold || criteriaHold || materialReason);
        const planningClarification = !settlementHold && !activationHold && !criteriaHold && !materialReason
            ? this.currentPlanningClarification(workId, r, w) : undefined;
        if (planningClarification && r.data.resumeStage === 'plan')
            nextAction = `Review the independent planning questions in /result or /work ${workId}. Bring the questions to the owner before continuing the same task.`;
        const status = {
            ownerActivation: activation ? activationHold ? 'pending' : 'complete' : 'not-recorded',
            phase: settlementHold || activationHold || criteriaHold || materialReason || retainedHold || planningEntryHold || checkRecoveryHold ? 'BLOCKED' : r.phase,
            resolution, execution,
            blocked: [
                ...(settlementHold ? [settlementHold.blocker] : []),
                ...(activationHold ? ['Original owner delegation activation is incomplete'] : []),
                ...(criteriaHold ? [criteriaHold] : []),
                ...(materialReason ? [materialReason] : []),
                ...(planningEntryHold ? [planningDiagnosis ? 'A retained producer failure requires explicit recovery before new planning' : 'Shared planning allowance is exhausted'] : []),
                ...currentReasons,
                ...(retainedHold ? [retainedHold] : []),
                ...(producerFailure?.nextAction ? [producerFailure.nextAction] : []),
                ...(checkRecoveryHold ? [checkRecoveryHold] : []),
            ],
            nextAction,
            ...(workflowCriteria && !settlementHold && !activationHold ? { workflowCriteriaHold: workflowCriteria.kind,
                ...(!materialCoverageReason && !this.h.busy(workId) ? { workflowCriteriaBlocksResume: true as const } : {}) } : {}),
            ...(restoredReason ? {restoredRoleMaterialLaunchId:producerFailure.launchId} : {}),
            ...(modelContextFailure ? { modelContextFailure } : {}),
            ...(scopeFailure ? { scopeFailure } : {}),
            ...(planningClarification ? { planningClarification } : {}),
            ...(producerFailure && w.state === 'ACTIVE' && !settlementHold && !activationHold && !criteriaHold && !materialReason && !modelContextFailure
                ? producerFailure.presentation : {}),
        } satisfies Pick<ChangeView, 'ownerActivation' | 'phase' | 'resolution' | 'execution' | 'blocked' | 'nextAction' |
            'modelContextFailure' | 'workflowCriteriaHold' | 'workflowCriteriaBlocksResume' | 'planningFailure' | 'planningClarification' |
            'providerFailure' | 'roleRequestLimit' | 'scopeFailure' | 'restoredRoleMaterialLaunchId'>;
        return { status, readinessHeld, historicalPhaseHeld: Boolean(settlementHold || criteriaHold || materialReason) };
    }
    private replanReview(workId: string, scopeAvailable: boolean) {
        if (!this.pendingVerificationPlanRepair(workId)) {
            if (scopeAvailable) return {kind:'scope' as const};
            const check = this.checkReplanReview(workId);
            if (check) return {kind:'check' as const, check};
        }
        const verification = this.captureVerificationReplan(workId);
        if (verification) return {kind:'verification' as const, verification};
    }
    private recoveryGuidance(workId: string) {
        this.h.assertOpen();
        const w = this.work(workId);
        if (workCleanupUnconfirmed(this.s, w)) return {nextAction: uncertainSettlementInspection(workId).nextAction,
            recoveryHold: {kind:'settlement' as const}};
        try {
            const status = this.inspectRecovery(workId, this.row(workId), w, this.createVerificationRead(workId)).status;
            const { phase, blocked, modelContextFailure, workflowCriteriaHold, workflowCriteriaBlocksResume, planningFailure, providerFailure, roleRequestLimit } = status;
            const recoveryHold = phase === 'BLOCKED' || phase === 'REPAIR_REQUIRED' ? {
                kind: 'blocked' as const, blocker: blocked.find(reason => typeof reason === 'string' && reason.trim())?.slice(0, 1024),
                ...(workflowCriteriaHold ? {workflowCriteriaHold} : {}),
                ...(workflowCriteriaBlocksResume ? {workflowCriteriaBlocksResume} : {}),
                ...(modelContextFailure ? {modelContextFailure} : {}), ...(planningFailure ? {planningFailure} : {}),
                ...(providerFailure ? {providerFailure} : {}), ...(roleRequestLimit ? {roleRequestLimit} : {}),
            } : undefined;
            return {nextAction:status.nextAction, replan:this.replanReview(workId, !!status.scopeFailure?.replanAvailable), recoveryHold,
                activationPending: status.ownerActivation === 'pending'};
        } catch {
            return {nextAction:recoveryGuidanceUnavailable, recoveryHold: {kind:'unavailable' as const}};
        }
    }
    inspectRecoveryGuidance(workId: string) {
        const {replan, ...guidance} = this.recoveryGuidance(workId);
        return {...guidance, replanKind:replan?.kind};
    }
    inspectScopeReplan(workId: string) {
        if (this.inspectRecoveryGuidance(workId).replanKind !== 'scope')
            throw Error('Original scope replan is unavailable; inspect this work and its current holds');
        return this.readScopeReplan(workId);
    }
    private readScopeReplan(workId: string) {
        const replan = this.captureScopeReplan(workId);
        if (!replan) throw Error('Original scope replan evidence unavailable');
        return {fingerprint:replan.checkpoint, failures:replan.evidence, heldDirections:replan.heldDirections};
    }
    inspectChangeReplan(workId: string) {
        const {replan, recoveryHold} = this.recoveryGuidance(workId);
        const review = replan ?? (recoveryHold?.kind === 'unavailable' ? this.replanReview(workId, false) : undefined);
        if (!review) throw Error('Original replan is unavailable; inspect this work and its current holds');
        if (review.kind === 'scope') return {kind:'scope' as const, ...this.readScopeReplan(workId)};
        if (review.kind === 'verification') {
            const { fingerprint, context } = review.verification;
            const {originalPlan, witnessDigest, ...gap} = context;
            return { kind:'verification' as const, fingerprint, failures:[gap], heldDirections:[] };
        }
        const {fingerprint, failures, heldDirections} = review.check;
        return {kind:'check' as const, fingerprint, failures, heldDirections};
    }
    inspect(workId: string): ChangeView {
        this.h.assertOpen();
        const r = this.row(workId), w = this.work(workId), read = this.createVerificationRead(workId);
        const evidence = readOnce(() => this.verificationEvidence(workId, read));
        const { status, readinessHeld, historicalPhaseHeld } = this.inspectRecovery(workId, r, w, read, evidence);
        return {
            ...status,
            workId,
            state: w.state,
            recordedPhase: r.phase,
            epoch: w.epoch,
            baseVersion: r.base, candidateVersion: r.candidate, planVersion: r.plan, verificationVersion: r.verification,
            ...(status.phase === 'CANDIDATE_CAPTURED' && r.plan && this.version(r.plan).data.coverageRepair
                ? { verificationReplanAccepted: true as const } : {}),
            ...(Object.hasOwn(r.data, 'verificationProfileMode') || r.plan && Object.hasOwn(this.version(r.plan).data.plan.verification, 'strategies') ? { verificationEvidence: this.verificationView(workId, read, evidence) } : {}),
            versions: this.s.all('SELECT id,kind,predecessor,artifact,hash FROM change_versions WHERE work=?', workId),
            launches: this.s.all('SELECT * FROM role_launches WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            checks: this.s.all('SELECT * FROM check_runs WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            occurrences: this.s.all('SELECT * FROM finding_occurrences WHERE work=?', workId).map(x => ({ ...x, data: parse(x.data) })),
            dispositions: this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=?', workId)
                .map(x => ({ ...x, data: parse(x.data) })),
            // inspectRecovery has already checked typed strategy evidence for REVIEW_READY.
            reviewReady: !readinessHeld && this.candidateChecksCurrent(workId, read) && r.phase === 'REVIEW_READY' &&
                w.state === 'DELIVERED' && r.epoch === w.epoch && !this.h.sourceImpacts(workId).some(input => input.data.effectHold),
            limitations: [
                'Local agent procedure only; no account approval, publication or merge authority.',
                'Semantic judgments and test adequacy remain fallible.',
                'Initial text-only captured input and normalized modes profile.',
                ...(historicalPhaseHeld ? ['Retained historical phase: ' + r.phase + '; readiness held without rewriting history or consuming allowance.'] : []),
            ],
        };
    }
    /** Read retained selected results without materializing artifacts or invoking a producer. */
    inspectResult(workId: string, options: ChangeResultOptions = {}): ChangeResultView {
        this.h.assertOpen();
        const w = this.work(workId), r = this.row(workId);
        const project = this.s.one('SELECT root FROM projects WHERE id=?', w.project);
        const source = this.s.one('SELECT raw FROM sources WHERE id=?', w.source);
        if (!project || !source) throw Error('Original result project or owner request unavailable');
        const clip = (value: unknown, length = 4096) => typeof value === 'string' ? value.slice(0, length) : '';
        const reason = (error: unknown) => clip(error instanceof Error ? error.message : 'Retained result unavailable', 1024);
        let assessment: ChangeView | undefined, assessmentFailure: string | undefined;
        try { assessment = this.inspect(workId); } catch (error) { assessmentFailure = reason(error); }
        const settlementHold = workCleanupUnconfirmed(this.s, w) ? uncertainSettlementInspection(workId) : null;
        const blockers = [...(settlementHold && !assessment ? [settlementHold.blocker] : []),
            ...(assessment?.blocked ?? (Array.isArray(r.data.blocked) ? r.data.blocked : [])),
            ...(assessmentFailure ? ['Current procedure assessment unavailable: ' + assessmentFailure] : [])];
        const heldDirections = this.h.sourceImpacts(workId, true).filter(input => input.data.effectHold);
        const findingState = "CASE WHEN json_valid(o.data) THEN o.data ELSE '{}' END";
        const pendingFindings = this.s.one(`SELECT COUNT(*) AS n FROM obligations o
            JOIN finding_occurrences f ON f.id=o.id AND f.work=o.work
            WHERE o.work=? AND json_extract(${findingState},'$.kind')='finding'
            AND json_extract(${findingState},'$.state')='pending' AND json_extract(${findingState},'$.occurrence')=f.id`, workId).n;
        const retainedCheckFailures = options.retainedChecks && r.plan === null && r.verification === null
            ? this.retainedCheckFailures(workId, options.caseValues) : undefined;
        const replan = options.retainedChecks && assessment ? this.replanReview(workId, !!assessment.scopeFailure?.replanAvailable) : undefined;
        const replanKind = replan?.kind;
        const verificationGap = assessment && !assessment.workflowCriteriaHold && !settlementHold && !heldDirections.length && w.state === 'ACTIVE' &&
            r.phase === 'BLOCKED' && r.data.resumeStage === null
            ? this.inspectConsumerVerificationGap(workId, replan?.kind === 'verification' ? replan.verification.selected : undefined) : undefined;
        const result: ChangeResultView = {
            ...(assessment?.workflowCriteriaHold ? {workflowCriteriaHold:assessment.workflowCriteriaHold} : {}),
            ...(assessment?.modelContextFailure ? { modelContextFailure: assessment.modelContextFailure } : {}),
            ...(assessment?.planningFailure ? { planningFailure: assessment.planningFailure } : {}),
            ...(assessment?.planningClarification ? { planningClarification: assessment.planningClarification } : {}),
            ...(assessment?.providerFailure ? { providerFailure: assessment.providerFailure } : {}),
            ...(assessment?.roleRequestLimit ? {roleRequestLimit: assessment.roleRequestLimit} : {}),
            ...(assessment?.restoredRoleMaterialLaunchId ? {restoredRoleMaterialLaunchId:assessment.restoredRoleMaterialLaunchId} : {}),
            ...(assessment?.scopeFailure ? { scopeFailure: assessment.scopeFailure } : {}),
            ...(assessment?.verificationEvidence ? { verificationEvidence: assessment.verificationEvidence } : {}),
            ...(verificationGap ? { verificationGap } : {}),
            ...(assessment?.verificationReplanAccepted
                ? { verificationReplanAccepted: true as const } : {}),
            workId, projectId: w.project, request: clip(source.raw, 32768), requestTruncated: source.raw.length > 32768,
            registeredSourceRoot: project.root, state: w.state, recordedPhase: r.phase, reviewReady: assessment?.reviewReady ?? false,
            blocked: blockers.slice(0, 16).map((item: unknown) => clip(item, 1024)), blockedOmitted: Math.max(0, blockers.length - 16),
            ...(assessment ? {sharedAllowance:{execution:assessment.execution,resolution:assessment.resolution}} : {}),
            ...(pendingFindings ? {pendingFindings} : {}),
            ...(retainedCheckFailures ? {retainedCheckFailures} : {}),
            ...(replanKind ? {replanKind} : {}),
            nextAction: clip(assessment?.nextAction ?? this.inspectRecoveryGuidance(workId).nextAction),
            ...(heldDirections.length ? { heldDirections: { entries: heldDirections.slice(-4).map(input => ({
                inputId: input.input_id, directionRevision: input.revision, sourceOrigin: input.sourceOrigin ?? 'unknown',
            })), omitted: Math.max(0, heldDirections.length - 4) } } : {}),
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
        const selectedRecord = (id: string | null, kind: string) => {
            if (!id) throw Error('Selected ' + kind + ' version is absent');
            const row = this.versionRecord(id);
            if (row.work !== workId || row.kind !== kind) throw Error('Selected ' + kind + ' belongs to another work or version kind');
            return row;
        };
        const selectedVersion = (id: string | null, kind: string) => {
            const row = selectedRecord(id, kind);
            return { ...row, data: parse(row.data) };
        };
        const candidateRecord = readOnce(() => selectedRecord(r.candidate, 'candidate'));
        const selectedCandidate = readOnce(() => {
            const row = candidateRecord();
            return { ...row, data: parse(row.data) };
        });
        if (r.candidate) {
            try {
                const candidate = selectedCandidate();
                if (typeof candidate.artifact !== 'string' || !path.isAbsolute(candidate.artifact) || candidate.artifact.length > 8192 || !/^[a-f0-9]{64}$/u.test(candidate.hash))
                    throw Error('Recorded candidate location or digest unavailable');
                result.candidate = {versionId: candidate.id, path: candidate.artifact, hash: candidate.hash};
                result.changes = this.readResultChanges(selectedRecord(r.base, 'base'), candidateRecord(), candidate.data);
            } catch (error) { result.changes.reason = reason(error); }
        }
        let selectedChecksUsable = false;
        if (r.verification) {
            try {
                const candidate = r.candidate ? selectedCandidate() : undefined;
                const version = selectedVersion(r.verification, 'verification'), verification = version.data.verification;
                const bound = {base:r.base, candidate:r.candidate, plan:r.plan, verification:version.id,
                    requirements:r.data.requirementVersion, contracts:r.data.contractsVersion};
                if (hash(verification) !== version.hash) throw Error('Required check declaration identity differs');
                if (!Array.isArray(verification?.checks) || verification.checks.length > 1024) throw Error('Required check roster unavailable');
                const output = this.describeCheckOutput(workId, r, this.checkOutputSources(workId, r));
                const outputFailures = new Map(output.view?.failures.map(failure => [failure.receiptId, failure]));
                let baselineIds: Set<string> | undefined;
                const entries: ChangeResultView['checks']['entries'] = verification.checks.map((check: any) => {
                    if (typeof check?.id !== 'string') throw Error('Required check identity unavailable');
                    const baseline = (baselineIds ??= this.baselineCheckIds(workId)).has(check.id);
                    const row = baseline ? this.selectedBaselineCheck(workId, check) : r.candidate ? this.selectedCheck(workId, r.candidate, r.verification, check) : undefined;
                    const observed = baseline && !!this.baselineReceipt(workId, check);
                    const data = row ? parse(row.data) : null;
                    const outputFailure = row ? outputFailures.get(row.id) : undefined;
                    const outputIssues = outputFailure?.production.report === 'accepted' ? {...outputFailure.diagnosis.counts} : undefined;
                    const stderr = options.checkStderr === true && outputFailure?.production.report === 'rejected' &&
                        typeof data?.actual?.stderr === 'string' ? data.actual.stderr.trim() : '';
                    const stderrExcerpt = stderr.slice(0, 600).split('\n', 8).join('\n');
                    const outputIssueIds: NonNullable<ChangeResultView['checks']['entries'][number]['outputIssueIds']> = {};
                    if (outputFailure && outputIssues) {
                        delete outputIssues['assertion-roster-size'];
                        delete outputIssues['case-roster-size'];
                        for (const {kind, id, omittedIdCharacters} of outputFailure.diagnosis.problems) {
                            if (!id || omittedIdCharacters !== undefined || kind === 'assertion-roster-size' || kind === 'case-roster-size') continue;
                            const ids = outputIssueIds[kind] ??= [];
                            if (ids.length < 2) ids.push(id);
                        }
                    }
                    const passed = !baseline && this.checkReceiptPassed(row, check, selectedCandidate);
                    const observations = candidate && !baseline && (passed || row?.status === 'fail') ?
                        this.recordedCheckObservations(check, candidate, bound, row, options.caseValues) : undefined;
                    return {checkId: check.id, receiptId: row?.id ?? null, runId: row?.run ?? null,
                        ...(row ? {production: recordedCheckProduction(data)} : {}),
                        ...(check.consumerControl ? this.recordedConsumerControl(workId, check, passed ? row : undefined) : {}),
                        ...observations,
                        ...(outputFailure ? {unavailableReason:'output-contract' as const} : {}),
                        ...(stderrExcerpt ? {stderrExcerpt: {text: stderrExcerpt, shortened: stderr.length > stderrExcerpt.length}} : {}),
                        ...(outputIssues && Object.keys(outputIssues).length ? {outputIssues} : {}),
                        ...(Object.keys(outputIssueIds).length ? {outputIssueIds} : {}),
                        status: row ? baseline && observed ? 'baseline-observed' : ['pass', 'fail', 'unavailable', 'stale'].includes(row.status) ? row.status : 'unavailable' : 'missing',
                        ...(baseline ? { target: 'base' as const, purpose: 'baseline' as const, observed } : {}),
                        passed, cleanup: typeof data?.cleanup === 'string' ? clip(data.cleanup) : null,
                        durationMs: typeof data?.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0 ? data.durationMs : null};
                });
                selectedChecksUsable = entries.length > 0 && entries.every(entry => entry.target === 'base' ? entry.observed === true : entry.passed);
                result.checks = {availability: 'recorded', ...resultEntries(entries)};
            } catch (error) { result.checks = {availability: 'unavailable', entries: [], total: null, omitted: 0, reason: reason(error)}; }
        }
        let selectedReviewsUsable = false;
        if (r.plan) {
            try {
                if (r.candidate) selectedCandidate();
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
        bounded(options.resolutionLimit ?? defaultConversationResolutionLimit, 'resolution allowance');
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
                this.s.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?', options.resolutionLimit ?? defaultConversationResolutionLimit, w.lineage, 'resolution');
                this.s.run('UPDATE budgets SET lim=? WHERE lineage=? AND kind=?', options.executionLimit ?? defaultConversationExecutionLimit, w.lineage, 'execution');
            }
            else if (options.resolutionLimit !== undefined && options.resolutionLimit !== this.budget(w.id, 'resolution').limit || options.executionLimit !== undefined && options.executionLimit !== this.budget(w.id, 'execution').limit) {
                throw Error('Shared family allowances cannot be reset by managed entry; use an explicit original-work extension');
            }
            this.s.run('INSERT INTO change_state VALUES(?,?,NULL,NULL,NULL,NULL,?,?)', w.id, 'BASE_CAPTURING', w.epoch, JSON.stringify({ blocked: [], nextAction: 'planChange', ownerRequirements: options.ownerRequirements ?? [], request: options.request, selection: {}, pendingNit: null, candidateAmendmentProbe: true }));
            const contracts = this.newVersion(w.id, 'contracts', null, { text: criteria.text, assets: criteria.assets }, criteria.hash);
            this.phase(w.id, 'BASE_CAPTURING', { contractsVersion: contracts });
        });
        const handle: Handle = { abort: new AbortController() };
        this.h.register(a.w.id, handle);
        const stop = () => this.stopCapturedWork(a.w, handle);
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
    private producerDiagnostics(work: string, subjects?: readonly string[], receiverLaunchId?: string) {
        const r = this.row(work);
        const currentInputVersions = { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification };
        const occurrences: {
            occurrenceId: string;
            outputId: string;
            launchId: string;
        }[] = [], outputs: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        const hold = (id: string, reason: string): never => { throw new Error(`Producer diagnostic unavailable: ${id}: ${reason}; restore the exact retained same-W record/completeness before adjudication; do not fabricate prior raw output`); };
        for (const pending of subjects ? subjects.map(id=>({id,kind:'finding'})) : this.pending(work)) {
            if (pending.kind !== 'finding' || subjects && !subjects.includes(pending.id))
                continue;
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=?', pending.id);
            if (!occurrence || occurrence.work !== work)
                hold(pending.id, 'missing or foreign occurrence');
            const data = parse(occurrence.data);
            if (data.finding?.requirementId !== 'producer-integrity')
                continue;
            const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', occurrence.output);
            const launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch);
            if (!output || !launch || launch.work !== work || data.launchId !== launch.id || data.role !== launch.role)
                hold(occurrence.id, 'output/origin/evidence provenance mismatch');
            // Receiver additions are retained duties, not retroactive inputs to
            // this receiver's independent assessment. Foreign input drift still
            // participates in the original projection and its receipt hash.
            if (launch.id === receiverLaunchId)
                continue;
            if (occurrences.length >= 64)
                hold(occurrence.id, 'diagnostic occurrence limit64 exceeded; no evidence omitted');
            const material = parse(output.data).harvestedFindings ?? capturedRawFindings(output.raw, launch.role, parse(launch.data)).findings;
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
        const projection = { semantics: hasStoppedSubmission(outputs) ? 'Historical exact received stopped submission prefixes for independent diagnosis only; no valid role output, selected source, semantic-completeness certification or automatic disposition' : hasRejectedSubmission(outputs) ? 'Historical exact received raw for independent diagnosis only, including complete rejected submission material; not current source facts, valid RoleOutput, repair authority, semantic-completeness certification or automatic disposition' : hasRejectedMaterial(outputs) ? 'Historical exact received raw for independent diagnosis only, including complete rejected formatter public material; not current source facts, valid RoleOutput, repair authority, semantic-completeness certification or automatic disposition' : 'Historical exact received raw for independent diagnosis only, from an unusable producer or an unowned public frame; not current source facts, valid RoleOutput, repair authority, semantic-completeness certification or automatic disposition', currentInputVersions, occurrences, outputs };
        if (Buffer.byteLength(JSON.stringify(projection), 'utf8') > 256 * 1024)
            hold(work, 'serialized diagnostic evidence exceeds256KiB; no evidence silently omitted');
        return projection;
    }
    /** Reuse only exact plain receipts from this call; never assessment chains. */
    private literalMaterialCoverage(work:string, launch:any, raw:string, source:NativeMaterialSource,
        claims:ReturnType<typeof capturedMaterialFindings>['claims']) {
        const byLocation = new Map<string,{claim:typeof claims[number];occurrence:any}>();
        const lookup = new Map(claims.map(claim => { const {finding,...location}=claim; return [hash(location),claim]; }));
        const references:Array<{id:string;sha256:string}>=[];
        const rows=this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=? ORDER BY rowid",launch.id,source.sourceEntryId);
        for (const output of rows) {
            const md=parse(output.data);
            if (Object.hasOwn(md,'materialAssessment')) continue;
            if (md.materialSources?.[0]?.selector !== source.selector) continue;
            const refuse=():never=>{throw Error('Rejected formatter prior literal correspondence unavailable');};
            if (output.raw!==raw || md.protocol!==null || md.nativeSource!==null || md.rawFinalTruncated!==false || md.omittedFindingCount!==0 || Object.hasOwn(md,'nativeTextProjection')) refuse();
            if (!Array.isArray(md.materialSources) || !Array.isArray(md.harvestedFindings)) refuse();
            const locations=md.harvestedFindings.length ? md.materialSources.map(({findingPath,memberPath,index}:any)=>({findingPath,memberPath,index})) : [];
            if (md.accountingKey !== undefined ? md.accountingKey!==hash({source,locations}) :
                locations.some((location:any)=>location.findingPath!=='/findings'||location.memberPath?.length!==1)) refuse();
            const expectedSources=locations.length ? locations.map((location:object)=>({...source,...location})) : [source];
            if (hash(md.materialSources)!==hash(expectedSources)) refuse();
            const occurrences=this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output.id);
            if (occurrences.length!==locations.length) refuse();
            let prior=-1;
            for (const [ordinal,location] of locations.entries()) {
                const key=hash(location), claim=lookup.get(key), occurrence=occurrences[ordinal];
                const position=claim ? claims.indexOf(claim) : -1;
                if (!claim || position<=prior || byLocation.has(key) || occurrence.ordinal!==ordinal || occurrence.work!==work ||
                    parse(occurrence.data).launchId!==launch.id || parse(occurrence.data).role!==launch.role ||
                    hash(parse(occurrence.data).finding)!==hash(claim.finding) || hash(md.harvestedFindings[ordinal])!==hash(claim.finding)) refuse();
                prior=position;byLocation.set(key,{claim:claim!,occurrence});
            }
            references.push({id:output.id,sha256:hash([output,occurrences])});
        }
        return {references,byLocation};
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
        let materialOrder:Array<{occurrence:any}|{ordinal:number}>|undefined;
        if (assessment) {
            const rejected = assessment.version === 2 || assessment.version === 3;
            const read = capturedMaterialFindings(output.raw,launch.role,parse(launch.data),rejected,rejected ? 2 : 1), source = assessment.source;
            const coverage = rejected || assessment.version===4 ? this.literalMaterialCoverage(work,launch,output.raw,source,read.claims) : undefined;
            if (coverage && hash(assessment.coveredOutputs)!==hash(coverage.references)) throw Error('Rejected formatter referenced claims changed');
            const local = read.claims.filter(({finding,...location})=>!coverage?.byLocation.has(hash(location)));
            const locations = local.map(({finding,...location})=>location);
            if (coverage) { let ordinal=0; materialOrder=read.claims.map(({finding,...location})=>{
                const previous=coverage.byLocation.get(hash(location));return previous ? {occurrence:previous.occurrence} : {ordinal:ordinal++};
            }); }
            if (![1,2,3,4].includes(assessment.version) || !source || (assessment.version===4 ? source.selector!=='submission-arguments'||source.complete!==false||source.invalid!==true : rejected ? source.selector !== (assessment.version===3?'submission-arguments':'formatter-arguments') || source.complete !== true || typeof assessment.rejectionEntryId !== 'string' || !assessment.rejectionEntryId : !unownedNativeSelector(source.selector)) || source.sourceEntryId !== metadata.nativeEntryId ||
                source.rawSha256 !== hash(output.raw) || source.rawUtf8Bytes !== Buffer.byteLength(output.raw) ||
                output.status !== 'accounted-intermediate' || metadata.protocol !== null || metadata.nativeSource !== null || read.complete ||
                hash(metadata.harvestedFindings) !== hash(local.map(claim=>claim.finding)) ||
                hash(metadata.materialSources) !== hash(locations.length ? locations.map(location=>({...source,...location})) : [source]) ||
                metadata.accountingKey !== materialAssessmentKey(source,locations,assessment))
                throw new Error('Unsupported exact public material assessment origin');
            if (assessment.version===3) this.selectedSubmissionForAssessment(launch,assessment.selected);
            findings = metadata.harvestedFindings; expectedFinding = materialDiagnosisFinding(output.id,assessment.version);
        } else {
            const raw = capturedRawFindings(output.raw, launch.role, parse(launch.data));
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
        return { occurrence, output, launch, metadata, material: materialOrder ? materialOrder.map(item=>'occurrence' in item ? item.occurrence : siblings[item.ordinal]) : siblings.slice(0, -1) };
    }
    private materialAssessmentFence(outputId:string) {
        const output = this.s.one('SELECT * FROM role_outputs WHERE id=?',outputId), launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?',output.launch), run = launch && this.s.one('SELECT * FROM runs WHERE id=?',launch.run);
        const historyIdentity = this.materialHistoryIdentity(parse(run?.data).historyRef);
        if (!output || !launch || !run || !historyIdentity) throw Error('Public material assessment original source unavailable');
        const assessment=parse(output.data).materialAssessment;
        const covered=assessment?.version===2||assessment?.version===3||assessment?.version===4 ? assessment.coveredOutputs.map((reference:{id:string})=>[
            this.s.one('SELECT * FROM role_outputs WHERE id=?',reference.id),this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',reference.id)]) : [];
        return {historyIdentity,rows:hash([output,launch,run,this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',outputId),...covered,...(assessment?.version===3?[this.selectedSubmissionForAssessment(launch,assessment.selected)]:[])])};
    }
    /** After collector validation and a fenced history read; never a selected output. */
    private materialSourceFromEntries(output: any, launch: any, run: any, entries: any[]) {
        const metadata = parse(output.data), ld = parse(launch.data), rd = parse(run.data);
        if (rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role || ld.nativeRoleIntent?.stage !== ld.stage)
            throw Error('Public material assessment original dispatch unavailable');
        const assessment = metadata.materialAssessment as MaterialAssessment;
        let material;
        if (assessment.version === 2 || assessment.version === 3) {
            if (assessment.version===3) {
                const primary=this.selectedSubmissionForAssessment(launch,assessment.selected);
                if (readSelectedRoleOutput(entries,{entryId:assessment.selected.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,checkpointLeafId:rd.nativeCheckpoint?.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage},assessment.selected.source)!==primary.raw) throw Error('Selected submission original source changed');
            }
            const readRejected=assessment.version===3?readRejectedSubmissionAttempt:readRejectedFormatterAttempt;
            const rejected = readRejected(entries,{sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint?.leafId},metadata.nativeEntryId);
            if (rejected.rejectionEntryId !== assessment.rejectionEntryId) throw Error('Rejected formatter original rejection changed');
            material = rejected.material;
        } else if(assessment.version===4) material=readStoppedSubmissionPrefix(entries,{sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint?.leafId},metadata.nativeEntryId);
        else material = readUnownedNativeMaterial(entries, {sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent}, metadata.nativeEntryId, assessment.source.selector);
        const {raw,...source} = material;
        const proof = {...source,rawSha256:hash(raw),rawUtf8Bytes:Buffer.byteLength(raw)};
        if (raw !== output.raw || hash(proof) !== hash(metadata.materialAssessment.source)) throw Error('Public material assessment original entry/raw mismatch');
        return proof;
    }
    private selectedSubmissionForAssessment(launch:any,reference:SelectedSubmissionReference) {
        const selected=this.historicalSelectedOutputs(launch.id),primary=selected[0],md=parse(primary?.data);
        const refuse=():never=>{throw Error('Original selected submission eligibility changed');};
        if (selected.length!==1 || typeof primary.raw!=='string' || !reference || reference.source?.kind!=='claude-sdk-tool-submission/v1' ||
            typeof reference.nativeEntryId!=='string' || md.nativeEntryId!==reference.nativeEntryId || hash(md.nativeSource??null)!==hash(reference.source) ||
            md.terminal!=='complete' || md.rawFinalTruncated!==false || md.omittedFindingCount!==0 || hash(primary.raw)!==reference.rawSha256 || reference.source.rawDigest!==reference.rawSha256)
            refuse();
        const parsed=parseCapturedRoleOutput(primary.raw,launch.role,parse(launch.data));
        if (!parsed.value || hash(parsed.value)!==hash(md.protocol??null)) refuse();
        return primary;
    }
    private historicalSelectedOutputs(launch: string) {
        return this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status IN ('usable','unusable') ORDER BY rowid", launch);
    }
    /** A retained complete attempt is a literal source, never a selected result. */
    private historicalArgumentOrigin(work:string,output:any,launch:any) {
        const md=parse(output.data),submission=md.materialSources?.[0]?.selector==='submission-arguments',stopped=submission&&md.materialSources?.[0]?.complete===false&&md.materialSources?.[0]?.invalid===true,read=capturedMaterialFindings(output.raw,launch.role,parse(launch.data),submission&&!stopped,submission&&!stopped?2:1);
        const refuse=():never=>{throw Error(submission?'Historical submission literal source/roster unavailable':'Historical formatter literal source/roster unavailable');};
        if (Object.hasOwn(md,'materialAssessment')||Object.hasOwn(md,'nativeTextProjection')||md.protocol!==null||md.nativeSource!==null||
            !read.claims.length||!Array.isArray(md.materialSources)||!md.materialSources.length||
            md.materialSources.some((source:any)=>!source||typeof source!=='object'||Array.isArray(source))||Buffer.from(output.raw).toString('utf8')!==output.raw) refuse();
        let claims=read.claims,source:Record<string,any>;
        if (Object.hasOwn(md,'accountingKey')) {
            const {findingPath,memberPath,index,...original}=md.materialSources[0];source=original;
            const locations=md.materialSources.map(({findingPath,memberPath,index}:any)=>({findingPath,memberPath,index}));
            const positionsByLocation=new Map(read.claims.map((claim,index)=>{const {finding,...location}=claim;return[hash(location),index]}));
            const positions=locations.map((location:unknown)=>positionsByLocation.get(hash(location))??-1);
            if (positions.some((position:number,index:number)=>position<0||index>0&&position<=positions[index-1])||
                md.accountingKey!==hash({source,locations})||hash(md.materialSources)!==hash(locations.map((location:object)=>({...source,...location})))) refuse();
            claims=positions.map((position:number)=>read.claims[position]!);
        } else {
            if (md.materialSources.length!==1||claims.some(claim=>claim.findingPath!=='/findings'||claim.memberPath.length!==1)) refuse();
            source=md.materialSources[0];
        }
        if (source.selector!==(submission?'submission-arguments':'formatter-arguments')||(stopped ? source.complete!==false||source.invalid!==true : source.complete!==true)||source.sourceEntryId!==md.nativeEntryId||
            source.rawSha256!==hash(output.raw)||source.rawUtf8Bytes!==Buffer.byteLength(output.raw)||hash(md.harvestedFindings)!==hash(claims.map(claim=>claim.finding))) refuse();
        const rows=this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output.id);
        if (rows.length!==claims.length||claims.some((claim,index)=>rows[index]?.ordinal!==index||rows[index]?.work!==work||
            parse(rows[index].data).launchId!==launch.id||parse(rows[index].data).role!==launch.role||hash(parse(rows[index].data).finding)!==hash(claim.finding))) refuse();
        let assessmentOutputId:string|undefined;
        if (!read.complete || !read.receivedClaimsComplete) {
            const candidates=this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.materialAssessment.version')=? ORDER BY rowid",launch.id,stopped?4:submission?3:2)
                .filter(row=>parse(row.data).materialAssessment.coveredOutputs?.some((reference:any)=>reference.id===output.id));
            if (candidates.length!==1) refuse();
            const assessment=candidates[0], suffix=this.s.one('SELECT id FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1',assessment.id);
            const origin=this.collectorDiagnosis(work,suffix?.id);
            if (assessment.raw!==output.raw || hash(origin.metadata.materialAssessment.source)!==hash(source)) refuse();
            assessmentOutputId=assessment.id;
        }
        return {source,claims,...(assessmentOutputId?{assessmentOutputId}:{})};
    }
    /** Exact complete received material with original selected-source corroboration;
     * this recovers INITIAL exposure, never a new collection or selected result. */
    private corroboratedNativeMaterialOrigin(work: string, output: any, launch: any, allowEmpty = false) {
        const metadata = parse(output.data);
        let read = capturedMaterialFindings(output.raw, launch.role, parse(launch.data));
        const refuse = (): never => { throw Error('Unsupported exact result-text accounting'); };
        const selected = this.historicalSelectedOutputs(launch.id);
        if (selected.length !== 1) refuse();
        const textCarrier = parse(selected[0]!.data).nativeSource?.kind === 'claude-sdk-assistant-json/v1';
        const projection = Object.hasOwn(metadata,'nativeTextProjection') ? metadata.nativeTextProjection : undefined;
        if (Object.hasOwn(metadata,'nativeTextProjection')) {
            const actual = textCarrier ? nativeTextFindingProjection(output.raw, launch.role) : undefined;
            if (!actual?.region?.innerLiteralComplete || hash(projection) !== hash({version:1,source:parse(selected[0]!.data).nativeSource,region:actual.region})) refuse();
            read = actual!.read;
        }
        if (Object.hasOwn(metadata, 'materialAssessment') || metadata.protocol !== null || metadata.nativeSource !== null ||
            (!projection && (!read.complete || !read.receivedClaimsComplete)) || !read.claims.length && !allowEmpty ||
            (textCarrier ? !read.roleAttempt || !Object.hasOwn(metadata,'accountingKey') : read.claims.some(claim => claim.findingPath !== '/findings' || claim.memberPath.length !== 1)) ||
            !Array.isArray(metadata.materialSources) || !metadata.materialSources.length ||
            metadata.materialSources.some((source: any) => !source || typeof source !== 'object' || Array.isArray(source)) ||
            Buffer.from(output.raw, 'utf8').toString('utf8') !== output.raw) refuse();
        let claims = read.claims, source: Record<string, any>;
        if (Object.hasOwn(metadata, 'accountingKey')) {
            if (allowEmpty && !read.claims.length) {
                source = metadata.materialSources[0];
                if (!projection || metadata.materialSources.length !== 1 || metadata.accountingKey !== hash({source,locations:[],nativeTextProjection:projection})) refuse();
            } else {
            const {findingPath,memberPath,index,...originalSource} = metadata.materialSources[0];
            source = originalSource;
            const locations = metadata.materialSources.map(({findingPath,memberPath,index}: any) => ({findingPath,memberPath,index}));
            const locationsOf = (claim: typeof read.claims[number]) => { const {finding,...location} = claim; return location; };
            const positionsByLocation = new Map(read.claims.map((claim, index) => [hash(locationsOf(claim)), index]));
            const positions = locations.map((location: unknown) => positionsByLocation.get(hash(location)) ?? -1);
            if (positions.some((position: number, i: number) => position < 0 || i > 0 && position <= positions[i - 1]) ||
                metadata.accountingKey !== hash({source,locations,...(projection?{nativeTextProjection:projection}:{})}) ||
                hash(metadata.materialSources) !== hash(locations.map((location: unknown) => ({...source,...(location as object)})))) refuse();
            claims = positions.map((position: number) => read.claims[position]!);
            }
        } else {
            if (metadata.materialSources.length !== 1) refuse();
            source = metadata.materialSources[0];
        }
        if ((textCarrier ? !(source.selector === 'result-text' || /^assistant-text:[0-9]+$/.test(source.selector)) || output.raw !== selected[0]!.raw : source.selector !== 'result-text') || source.sourceEntryId !== metadata.nativeEntryId ||
            source.rawSha256 !== hash(output.raw) || source.rawUtf8Bytes !== Buffer.byteLength(output.raw) ||
            hash(metadata.harvestedFindings) !== hash(claims.map(claim => claim.finding))) refuse();
        const rows = this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal', output.id);
        if (rows.length !== claims.length || claims.some((claim, index) => rows[index]?.ordinal !== index || rows[index]?.work !== work ||
            parse(rows[index].data).launchId !== launch.id || parse(rows[index].data).role !== launch.role || hash(parse(rows[index].data).finding) !== hash(claim.finding))) refuse();
        return { selected: selected[0]!, source, claims, ...(projection?{projection}: {}) };
    }
    private corroboratedNativeMaterialFromEntries(output: any, launch: any, run: any, origin: ReturnType<ChangeCore['corroboratedNativeMaterialOrigin']>, entries: any[]) {
        const rd = parse(run.data), ld = parse(launch.data), selected = origin.selected, metadata = parse(selected.data);
        const entryId = metadata.nativeSource?.kind === 'claude-sdk-assistant-json/v1' && origin.source.selector.startsWith('assistant-text:')
            ? metadata.nativeSource.assistantEntryId : metadata.nativeSource?.resultEntryId;
        if (metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 ||
            metadata.historyRef !== rd.historyRef || !metadata.nativeEntryId || typeof selected.raw !== 'string' || Buffer.byteLength(selected.raw) > 128 * 1024 ||
            entryId !== parse(output.data).nativeEntryId ||
            rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role || ld.nativeRoleIntent?.stage !== ld.stage)
            throw Error('Result-text original selected corroboration unavailable');
        if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== selected.raw ||
            metadata.protocol != null && hash(capturedOutputNeedsDecoding(launch.role,ld) ? parseCapturedRoleOutput(selected.raw,launch.role,ld).value : parseUniqueJson(selected.raw)) !== hash(metadata.protocol)) throw Error('Result-text selected corroboration changed');
        const matches = nativeRoleMaterial(entries, metadata.nativeSource.intentEntryId).materials.filter(material => material.selector === origin.source.selector && material.sourceEntryId === entryId);
        if (matches.length !== 1) throw Error('Result-text original material unavailable');
        const {raw,...source} = matches[0]!, proof = {...source,rawSha256:hash(raw),rawUtf8Bytes:Buffer.byteLength(raw)};
        if (raw !== output.raw || hash(proof) !== hash(origin.source)) throw Error('Result-text original source/raw mismatch');
        return proof;
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
            materialSource = this.materialSourceFromEntries(output, launch, run, entries);
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
        if (!launch || launch.work !== work || launch.role !== 'adjudicator' || !['planning-adjudication', 'review-adjudication', 'raw-assessment'].includes(ld.stage) || !projection)
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
        const rawAssessment = ld.stage === 'raw-assessment' ? {targetHash:hash(ld.rawAssessment),targetOutputId:ld.rawAssessment.targetOutputId,subjectIds:ld.rawAssessment.knownOccurrenceIds as string[]} : undefined;
        if (rawAssessment && hash(ld.rawAssessment) !== hash(bundle.context.rawAssessment)) throw Error('Captured raw assessment target changed');
        const snapshot = { version: rawAssessment ? 3 : operands.some(o=>o.materialSource) ? 2 : 1, ...(rawAssessment ? {rawAssessment} : {}), workId: work, launchId, runId: launch.run, epoch: launch.epoch, stage: ld.stage, inputVersions: ld.inputVersions, sourceInputHash: hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])), projectionHash: hash(projection), operands, unavailableOccurrenceIds };
        const receiptHash = hash(snapshot), suppliedReceipt = { receiptHash, semantics: (hasStoppedSubmission(projection.outputs)
            ? 'Host-supplied diagnosis operands only. Recipe4 stopped submission prefix custody binds exact received bytes and joined query census, never a complete call or successful role. materialOccurrenceIds is the source-location ordered literal roster across referenced plain receipts and the current assessment. Give every bound claim its separate current decision; custody does not certify semantic completeness. '
            : hasRejectedSubmission(projection.outputs)
            ? 'Host-supplied diagnosis operands only. Recipe3 rejected submission assessment binds original rejected-call custody and exact successful selected source3; materialOccurrenceIds is the source-location ordered literal roster including referenced original receipts. These facts grant neither semantic completeness nor a current verdict. '
            : hasRejectedMaterial(projection.outputs) ? 'Host-supplied diagnosis operands only. For recipe2 rejected formatter assessment, materialOccurrenceIds is the exact source-location ordered literal roster across the referenced earlier plain receipts and this assessment output. For other recipes it is the original output collector-retained sibling set. Neither roster certifies semantic completeness or current materiality; later findings never enlarge it. '
            : 'Host-supplied diagnosis operands only. materialOccurrenceIds is exactly the original output collector-retained sibling set, not a semantic-completeness or current-materiality census; later findings never enlarge it. ') + 'Later already-retained claims keep their own occurrence and producer origins and require separate independent current decisions, not insertion into this original set. Assess whether a true historical flaw in a discarded proposal still affects the current task or plan; diagnosis does not require repairing a never-adopted artifact merely because that old proposal was flawed. Genuinely new unretained meaningful current claims still require normal retention and accountable decisions. No comprehension, producer rehabilitation, task repair or automatic disposition is certified', eligible: operands.map(o => ({ occurrenceId: o.occurrenceId, outputId: o.outputId, rawSha256: o.rawSha256, ...(o.materialSource ? {materialSource:o.materialSource} : {}), materialOccurrenceIds: o.materialOccurrences.map((m: any) => m.id) })), unavailableOccurrenceIds };
        // Custody stays in the launch record. Charge only the canonical fields
        // actually delivered to this judge; the complete role still has its
        // independent model-context admission check.
        if (Buffer.byteLength(JSON.stringify({ producerDiagnostics: projection, producerDiagnosticReceipt: suppliedReceipt }), 'utf8') > 256 * 1024)
            throw new Error('Diagnostic receipt/evidence exceeds256KiB; nothing clipped');
        this.guard(work);
        const diagnosisEligibility = { version: 2 };
        this.s.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({ ...ld, diagnosisEligibility, producerDiagnosticInput: { ...snapshot, receiptHash } }), launchId);
        bundle.context.producerDiagnosticReceipt = suppliedReceipt;
        bundle.context.diagnosisEligibility = diagnosisEligibility;
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
            if (this.s.all('SELECT launch,data FROM finding_dispositions WHERE occurrence=?', occurrence.id).some(row => {
                const d = parse(row.data), witness = d.diagnosisWitness;
                return d.resolution === 'diagnosed' || d.disposition === 'rejected' &&
                    witness?.assessment === 'rejected-raw-assessment/v1' && witness.judgeLaunchId === row.launch &&
                    witness.origin?.occurrenceId === occurrence.id && witness.origin.outputId === occurrence.output;
            }))
                synthetic.add(occurrence.id);
        }
        return synthetic;
    }
    /** New closure requests and full historical/proposed equivalence need separate guards. */
    private diagnosisDecisionSubjects(work: string, launch: string) {
        const synthetic = this.diagnosisSubjectIds(work);
        const data = parse(this.s.one('SELECT data FROM role_launches WHERE id=? AND work=?',launch,work)?.data ?? '{}');
        for (const id of adjudicationDecisionReferences('adjudicator',data)?.diagnosisOccurrenceIds ?? []) synthetic.add(id);
        return synthetic;
    }
    private diagnosisOriginFence(work: string, occurrence: string) {
        const subject = this.collectorDiagnosis(work,occurrence), run = this.s.one('SELECT * FROM runs WHERE id=?',subject.launch.run);
        return {rows:hash([subject.occurrence,subject.output,subject.launch,run,
            this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',subject.output.id)]),
            historyIdentity:this.materialHistoryIdentity(parse(run?.data).historyRef)};
    }
    private diagnosisDecisionGuard(work: string, protocol: RoleResult, synthetic = this.diagnosisSubjectIds(work)) {
        const all = this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work);
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
    private diagnosisJudgeFence(work:string, launchId:string, outputId:string, view:ProducerEvidenceView = 'exact') {
        const launch=this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',launchId,work);
        const run=launch && this.s.one('SELECT * FROM runs WHERE id=?',launch.run), output=this.s.one('SELECT * FROM role_outputs WHERE id=?',outputId);
        return {rows:hash([producerEvidence(launch,view),run,output]),historyIdentity:this.materialHistoryIdentity(parse(run?.data).historyRef)};
    }
    private assertDiagnosticInputCurrent(work: string, receiverLaunchId: string, receipt: any) {
        const projection = receipt && this.producerDiagnostics(work,receipt.rawAssessment?.subjectIds,receiverLaunchId);
        if (!receipt || hash(projection) !== receipt.projectionHash)
            throw new Error('Diagnosis pending/raw input changed after dispatch');
        return projection!;
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
        const synthetic = this.diagnosisDecisionSubjects(work,judgment.launchId);
        this.diagnosisDecisionGuard(work, judgment.protocol,synthetic);
        const requests = (judgment.protocol.decisions ?? []).filter(d => d.resolution === 'diagnosed' ||
            d.disposition === 'rejected' && synthetic.has(d.occurrenceId)), proofs = new Map<string, any>();
        if (!requests.length)
            return proofs;
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=?', judgment.launchId), output = this.s.one('SELECT * FROM role_outputs WHERE id=?', judgment.output), run = this.s.one('SELECT * FROM runs WHERE id=?', judgment.runId), r = this.row(work), owner = this.work(work);
        const ld = launch && parse(launch.data), metadata = output && parse(output.data), rd = run && parse(run.data), receipt = ld?.producerDiagnosticInput;
        const tuple = { contracts: r.data.contractsVersion, requirements: r.data.requirementVersion ?? null, base: r.base, candidate: r.candidate, plan: r.plan, verification: r.verification };
        if (!launch || !output || !run || launch.work !== work || run.work !== work || launch.run !== run.id || run.id !== judgment.runId || output.launch !== launch.id || launch.role !== 'adjudicator' || launch.status !== 'COMPLETE' || !['planning-adjudication', 'review-adjudication', 'raw-assessment'].includes(ld.stage) || launch.epoch !== owner.epoch || run.epoch !== owner.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || !rd.historyRef || ld.historyRef !== rd.historyRef || metadata.historyRef !== rd.historyRef || judgment.execution.historyRef !== rd.historyRef || output.status !== 'usable' || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !judgment.execution.selectedFinalEntryId || metadata.nativeEntryId !== judgment.execution.selectedFinalEntryId || hash(metadata.protocol) !== hash(judgment.protocol) || hash(parseCapturedRoleOutput(output.raw, 'adjudicator', ld).value) !== hash(judgment.protocol) || !receipt || receipt.launchId !== launch.id || receipt.runId !== run.id || receipt.workId !== work || receipt.epoch !== owner.epoch || receipt.stage !== ld.stage || hash(receipt.inputVersions) !== hash(tuple) || hash(ld.inputVersions) !== hash(tuple) || receipt.sourceInputHash !== hash(this.h.sourceImpacts(work).map(i => [i.input_id, i.revision, i.source])) || rd.sourceInputHash !== receipt.sourceInputHash || judgment.protocol.ownerDecisionRequired?.length)
            throw new Error('Diagnosis requires the actual current settled usable independent J and pre-adoption input receipt');
        const { receiptHash, ...snapshot } = receipt;
        if (hash(snapshot) !== receiptHash || receipt.version !== (receipt.rawAssessment ? 3 : receipt.operands.some((operand:any)=>operand.materialSource) ? 2 : 1) || receipt.rawAssessment && (ld.stage !== 'raw-assessment' || hash(ld.rawAssessment) !== receipt.rawAssessment.targetHash))
            throw new Error('Diagnosis input receipt changed');
        const judgeFence=this.diagnosisJudgeFence(work,launch.id,output.id);
        const entries = await this.nativeEntries(run.id);
        if (hash(judgeFence) !== hash(this.diagnosisJudgeFence(work,launch.id,output.id))) throw Error('Independent judge source changed during read');
        if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== output.raw)
            throw new Error('Diagnosis J selected native output mismatch');
        const decisions = judgment.protocol.decisions ?? [], ids = new Set(decisions.map(d => d.occurrenceId));
        if (ids.size !== decisions.length)
            throw new Error('Diagnosis requires unique original subject decisions');
        const projection = this.assertDiagnosticInputCurrent(work,launch.id,receipt);
        for (const decision of requests) {
            const originFence = this.diagnosisOriginFence(work,decision.occurrenceId);
            const operand = receipt.operands.find((o: any) => o.occurrenceId === decision.occurrenceId), proof = await this.diagnosisOrigin(work, decision.occurrenceId), d = decision.diagnosis;
            if (hash(originFence) !== hash(this.diagnosisOriginFence(work,decision.occurrenceId)))
                throw Error('Producer assessment origin changed during source read');
            const supplied = projection.outputs.find((o: any) => o.outputId === proof.output.id);
            if (!operand || launch.id === proof.launch.id || !supplied || hash({ ...proof.operand, suppliedOutputHash: hash(supplied) }) !== hash(operand) || proof.material.some((o: any) => !ids.has(o.id)) ||
                decision.disposition !== 'rejected' && (!d || d.outputId !== proof.output.id || d.rawSha256 !== proof.operand.rawSha256 || d.inputReceiptHash !== receiptHash || hash([...d.materialOccurrenceIds].sort()) !== hash(proof.material.map((o: any) => o.id).sort())))
                throw new Error('Diagnosis needs exact supplied origin/raw/current receipt and every separate material decision');
            proofs.set(decision.occurrenceId, { ...(decision.disposition === 'rejected' ? {assessment:'rejected-raw-assessment/v1'} : {}),
                judgeLaunchId: launch.id, judgeRunId: run.id, judgeOutputId: output.id, judgeNativeEntryId: metadata.nativeEntryId, inputReceiptHash: receiptHash, origin: operand,originFence,judgeFence });
        }
        this.guard(work);
        if (hash(judgeFence) !== hash(this.diagnosisJudgeFence(work,launch.id,output.id))) throw Error('Independent judge source changed before validation completed');
        for (const [id,proof] of proofs) if (hash(proof.originFence) !== hash(this.diagnosisOriginFence(work,id)))
            throw Error('Producer assessment origin changed before validation completed');
        this.assertDiagnosticInputCurrent(work,launch.id,receipt);
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
    /** Resolve full criteria separately from literal initially supplied text. */
    private async historicalCriteria(work: string, launch: any, input: InputBundle) {
        const ld = parse(launch.data), manifest = workflowCriteriaManifest(input.context);
        if (!manifest) {
            if (Object.hasOwn(ld,'workflowCriteriaInput') || Object.hasOwn(ld,'workflowCriteriaHash')) throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
            return null;
        }
        const view = input.context.workflowCriteria as CriteriaDeliveryView;
        if (manifest.workId !== work || manifest.epoch !== launch.epoch || manifest.role !== launch.role || manifest.stage !== ld.stage ||
            path.dirname(manifest.path) !== path.join(this.h.options.installationHome,'artifacts') ||
            hash(ld.workflowCriteriaInput) !== hash(input.context.workflowCriteriaInput) || hash(ld.workflowCriteria) !== hash(view) ||
            ld.workflowCriteriaHash !== hash({view,operating:input.contracts,refresh:input.context.criteriaRefresh}) ||
            !Array.isArray(ld.inputEvidenceManifests) || ld.inputEvidenceManifests.filter((item:any)=>item.kind==='workflow-criteria').length !== 1 ||
            hash(ld.inputEvidenceManifests.find((item:any)=>item.kind==='workflow-criteria')) !== hash(manifest))
            throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
        const identity = () => {
            const stat = lstatSync(manifest.path,{bigint:true});
            if (!stat.isFile() || realpathSync(manifest.path) !== manifest.path || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o077n) !== 0n || stat.size !== BigInt(manifest.bytes))
                throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
            return hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String));
        };
        const originalIdentity = identity(), launchHash = hash(launch), handle = await fs.open(manifest.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        let contents: string;
        try {
            const stat = await handle.stat({bigint:true});
            if (hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String)) !== originalIdentity) throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
            const buffer = Buffer.alloc(manifest.bytes+1); let bytes = 0;
            while (bytes < buffer.length) {
                const {bytesRead} = await handle.read(buffer,bytes,buffer.length-bytes,bytes);
                if (!bytesRead) break;
                bytes += bytesRead;
            }
            const after = await handle.stat({bigint:true});
            if (bytes !== manifest.bytes || hash([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].map(String)) !== originalIdentity || identity() !== originalIdentity)
                throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
            contents = buffer.subarray(0,bytes).toString('utf8');
            if (!buffer.subarray(0,bytes).equals(Buffer.from(contents))) throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
        } finally { await handle.close(); }
        const resolved = resolveCriteriaDelivery(contents,view);
        if (resolved.operating !== input.contracts || resolved.current.id !== ld.inputVersions.contracts) throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
        const versions = [resolved.current,...(resolved.prior?[resolved.prior]:[])].map(definition=>{
            const version = this.version(definition.id);
            if (version.work !== work || version.kind !== 'contracts' || hash({id:version.id,hash:version.hash,text:version.data.text,assets:version.data.assets}) !== hash(definition))
                throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
            return version;
        });
        const refresh = input.context.criteriaRefresh as {fromContractsVersion?:string;toContractsVersion?:string}|null;
        if (resolved.prior ? !refresh || refresh.fromContractsVersion !== resolved.prior.id || refresh.toContractsVersion !== resolved.current.id : !!refresh)
            throw Error('HISTORICAL_CRITERIA_DELIVERY_UNAVAILABLE');
        const assertCurrent = () => {
            if (identity() !== originalIdentity || hash(this.s.one('SELECT * FROM role_launches WHERE id=?',launch.id)) !== launchHash ||
                versions.some(version=>hash(this.version(version.id)) !== hash(version))) throw Error('HISTORICAL_CRITERIA_DELIVERY_CHANGED');
        };
        assertCurrent();
        return {resolved,assertCurrent,exposure:{version:view.version,profile:view.profile,manifestId:manifest.id,sha256:manifest.sha256,operatingSha256:view.operatingSha256,
            meaning:'Recorded initial operating text and available exact criteria records; no assertion of rendered reads or comprehension.',
            eagerRecordIds:view.catalogue.filter(row=>row.delivery==='eager').map(row=>row.id),sharedCurrentRecords:view.catalogue.filter(row=>row.delivery==='shared-current').map(row=>({id:row.id,sharedWith:row.sharedWith})),readBoundRecordIds:view.catalogue.filter(row=>row.delivery==='read').map(row=>row.id)}};
    }
    /** Derived original initial-message evidence, never a retroactive capture receipt. */
    private async historicalPlanningProducer(work: string, outputId: string) {
        const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', outputId), launch = output && this.s.one('SELECT * FROM role_launches WHERE id=?', output.launch), run = launch && this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
        if (!output || !launch || !run || launch.work !== work || run.work !== work || run.id !== launch.run || run.epoch !== launch.epoch || !['COMPLETE', 'UNUSABLE'].includes(launch.status) || !['usable', 'unusable', 'accounted-intermediate'].includes(output.status) || run.phase !== 'SETTLED' || run.reservation !== 'consumed')
            throw new Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE');
        const ld = parse(launch.data), rd = parse(run.data), metadata = parse(output.data), tuple: Record<string, string | null> = {};
        assertSupportedRoleProfile(ld);
        const identityCaptureHash = metadataIdentityInput(launch.role,ld) || Object.hasOwn(ld,'subjectActionsInput') ||
            sourceScopeVersion(ld) === 2 || scopeAmendmentProfile(launch.role, ld) ? hash(launch) : undefined;
        const assertIdentityCapture = () => {
            if (identityCaptureHash && hash(this.s.one('SELECT * FROM role_launches WHERE id=?',launch.id)) !== identityCaptureHash)
                throw Error('HISTORICAL_METADATA_IDENTITIES_CHANGED');
        };
        const nativeHistoryIdentity = () => {
            const stat = lstatSync(rd.historyRef, { bigint: true });
            if (!stat.isFile() || stat.nlink !== 1n) throw Error('HISTORICAL_NATIVE_PROOF_UNAVAILABLE');
            return hash([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String));
        };
        const nativeHistoryHash = nativeHistoryIdentity();

        const assertNativeHistory = () => {
            if (nativeHistoryIdentity() !== nativeHistoryHash) throw Error(output.status === 'accounted-intermediate' ? 'HISTORICAL_MATERIAL_PROOF_UNAVAILABLE' : 'HISTORICAL_NATIVE_SOURCE_CHANGED');
        };
        const assessment = metadata.materialAssessment, accounted = output.status === 'accounted-intermediate';
        if (!accounted && assessment) throw Error('HISTORICAL_MATERIAL_PROOF_UNAVAILABLE');
        if (ld.cleanup !== 'removed' || rd.cleanup !== 'removed' || !rd.nativeCheckpoint || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId || !rd.historyRef || ld.historyRef !== rd.historyRef || metadata.historyRef !== rd.historyRef || metadata.terminal !== (accounted ? 'incomplete' : 'complete') || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 || !metadata.nativeEntryId || typeof output.raw !== 'string' || Buffer.byteLength(output.raw) > 128 * 1024)
            throw new Error('HISTORICAL_NATIVE_PROOF_UNAVAILABLE');
        for (const kind of ['contracts', 'requirements', 'base', 'candidate', 'plan', 'verification']) {
            const id = ld.inputVersions?.[kind], version = typeof id === 'string' && this.s.one('SELECT work,kind FROM change_versions WHERE id=?', id);
            if (id !== null && (!version || version.work !== work || version.kind !== kind))
                throw new Error('HISTORICAL_INPUT_TUPLE_UNAVAILABLE');
            tuple[kind] = id;
        }
        let materialOrigin: ReturnType<ChangeCore['collectorDiagnosis']> | undefined, corroborated: ReturnType<ChangeCore['corroboratedNativeMaterialOrigin']> | undefined, argumentOrigin: ReturnType<ChangeCore['historicalArgumentOrigin']>|undefined,
            argumentSettlement:'verified'|'not-attested'|undefined,materialFence: string | undefined;
        const materialFenceNow = () => {
            if (corroborated && hash(this.historicalSelectedOutputs(launch.id)) !== hash([corroborated.selected])) throw Error('Result-text selected source changed');
            return hash(argumentOrigin?.assessmentOutputId ? [this.materialAssessmentFence(output.id),this.materialAssessmentFence(argumentOrigin.assessmentOutputId)] : this.materialAssessmentFence(output.id));
        };
        if (accounted) {
            try {
                if (assessment) {
                    const suffix = this.s.one('SELECT id FROM finding_occurrences WHERE output=? ORDER BY ordinal DESC LIMIT 1', output.id);
                    materialOrigin = this.collectorDiagnosis(work, suffix?.id);
                } else if (['formatter-arguments','submission-arguments'].includes(metadata.materialSources?.[0]?.selector)) argumentOrigin=this.historicalArgumentOrigin(work,output,launch);
                else corroborated = this.corroboratedNativeMaterialOrigin(work, output, launch);
                materialFence = materialFenceNow();
            } catch { throw Error('HISTORICAL_MATERIAL_PROOF_UNAVAILABLE'); }
        }
        let entries: any[];
        try {
            entries = await this.nativeEntries(run.id);
        }
        catch {
            throw new Error('HISTORICAL_NATIVE_PROOF_UNAVAILABLE');
        }
        let materialSource: ReturnType<ChangeCore['materialSourceFromEntries']> | undefined;
        if (accounted) {
            try {
                if (materialFence !== materialFenceNow()) throw Error('Material source changed during read');
                if (argumentOrigin) {
                    if (rd.kind!=='governed-role'||rd.launchId!==launch.id||rd.role!==launch.role||ld.nativeRoleIntent?.stage!==ld.stage)
                        throw Error('Historical formatter dispatch unavailable');
                    const readAttempt=argumentOrigin.source.selector==='submission-arguments'?readHistoricalSubmissionAttempt:readHistoricalFormatterAttempt;
                    const expected={sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,intent:ld.nativeRoleIntent,checkpointLeafId:rd.nativeCheckpoint.leafId};
                    const result=argumentOrigin.source.selector==='submission-arguments'&&argumentOrigin.source.complete===false
                        ? {material:readStoppedSubmissionPrefix(entries,expected,metadata.nativeEntryId),querySettlement:'verified' as const}
                        : readAttempt(entries,expected,metadata.nativeEntryId);
                    const {raw,...source}=result.material,proof={...source,rawSha256:hash(raw),rawUtf8Bytes:Buffer.byteLength(raw)};
                    if (raw!==output.raw||hash(proof)!==hash(argumentOrigin.source)) throw Error('Historical formatter exact source/raw changed');
                    if (argumentOrigin.assessmentOutputId) {
                        const assessment=this.s.one('SELECT * FROM role_outputs WHERE id=?',argumentOrigin.assessmentOutputId);
                        this.materialSourceFromEntries(assessment,launch,run,entries);
                    }
                    materialSource=proof;argumentSettlement=result.querySettlement;
                } else materialSource = corroborated ? this.corroboratedNativeMaterialFromEntries(output, launch, run, corroborated, entries) : this.materialSourceFromEntries(output, launch, run, entries);
            } catch { throw Error('HISTORICAL_MATERIAL_PROOF_UNAVAILABLE'); }
        } else if (readSelectedRoleOutput(entries, {entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage}, metadata.nativeSource) !== output.raw)
            throw new Error('HISTORICAL_SELECTED_OUTPUT_UNAVAILABLE');
        if (metadata.protocol !== null && metadata.protocol !== undefined) {
            try {
                const original = capturedOutputNeedsDecoding(launch.role,ld)
                    ? parseCapturedRoleOutput(output.raw,launch.role,ld).value : parseUniqueJson(output.raw);
                if (!original || hash(original) !== hash(metadata.protocol))
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
            assertSupportedRoleProfile(input?.context ?? {});
            if (sourceScopeVersion(ld) !== sourceScopeVersion(input?.context ?? {})) throw Error('Original source scope capture changed');
            if (input && typeof input === 'object' && input.context && typeof input.context === 'object' && !Array.isArray(input.context)) {
                input.context = restorePlanningDomains(launch.role, input.context, readPlanningVerificationProfile(launch.role, ld)?.version,
                    ld.inputVersions?.plan, ld.plannerPlanReference);
                const captured = metadataIdentityInput(launch.role,ld);
                if (captured) {
                    if (hash(captured) !== hash(metadataIdentityInput(launch.role,input.context) ?? null)) throw Error('Original metadata identity declaration changed');
                    input.context = restoreMetadataIdentities(launch.role,input.context);
                    if (metadataIdentityFootprint(launch.role,input.context) !== ld.metadataIdentityHash) throw Error('Original metadata identity fields changed');
                } else if (Object.hasOwn(input.context,'metadataIdentityInput')) throw Error('Original metadata identity capture unavailable');
                if (subjectActionInputVersion(launch.role,ld) === 2 && metadataIdentityFootprint(launch.role,input.context) !== ld.metadataIdentityHash)
                    throw Error('Original literal subject metadata fields changed');
                const subjectProfile = adjudicationSubjectActions(launch.role,ld);
                if (hash(reviewResolutionInput(launch.role, ld) ?? null) !== hash(reviewResolutionInput(launch.role, input.context) ?? null))
                    throw Error('Original review resolution input unavailable');
                if (hash(sourceFitInput(launch.role, ld) ?? null) !== hash(sourceFitInput(launch.role, input.context) ?? null))
                    throw Error('Original source-fit input unavailable');
                if (hash(sourceFitReferencesInput(launch.role, ld) ?? null) !== hash(sourceFitReferencesInput(launch.role, input.context) ?? null))
                    throw Error('Original source-fit requirement references unavailable');
                if (sourceFitReferencesInput(launch.role, ld) && hash(readRequirementSourceIds(ld) ?? null) !== hash(readRequirementSourceIds(input.context) ?? null))
                    throw Error('Original source-fit requirement source domain unavailable');
                if (subjectProfile) {
                    if (hash(subjectProfile)!==hash(adjudicationSubjectActions(launch.role,input.context)??null) || subjectActionFootprint(launch.role,ld)!==ld.subjectActionCaptureHash || subjectActionFootprint(launch.role,input.context)!==ld.subjectActionCaptureHash)
                        throw Error('Original subject action input unavailable');
                } else if (Object.hasOwn(input.context,'subjectActionsInput')) throw Error('Original subject action capture unavailable');
                input.context = restoreFindingBodies(input.context, launch.role);
                if (Object.hasOwn(input.context,'historicalRequirementsInput') || Object.hasOwn(ld,'historicalRequirementsInput')) {
                    input.context = restoreHistoricalRequirements(input.context,launch.role);
                    if (hash(input.context.historicalRequirementsInput ?? null) !== hash(ld.historicalRequirementsInput ?? null) || typeof ld.historicalInputHash !== 'string' || hash(input.context.historicalPlanningOperands ?? null) !== ld.historicalInputHash) throw Error('Original historical requirement definitions changed');
                }
                if (Object.hasOwn(input.context,'historicalProvenanceInput') || Object.hasOwn(ld,'historicalProvenanceInput')) {
                    const proof = historicalProvenanceManifest(input.context), originals = ld.inputEvidenceManifests;
                    if (launch.role !== 'adjudicator' || hash(input.context.historicalProvenanceInput ?? null) !== hash(ld.historicalProvenanceInput ?? null) || typeof ld.historicalInputHash !== 'string' || hash(input.context.historicalPlanningOperands ?? null) !== ld.historicalInputHash ||
                        proof && (proof.workId !== work || proof.epoch !== launch.epoch || proof.role !== launch.role || path.dirname(proof.path) !== path.join(this.h.options.installationHome,'artifacts') || !Array.isArray(originals) || originals.filter((m:any)=>m.kind==='historical-producer-provenance').length !== 1 || hash(originals.find((m:any)=>m.kind==='historical-producer-provenance')) !== hash(proof))) throw Error('Original historical producer provenance changed');
                }
                const domains = planningDomainFootprint(launch.role, input.context, hash(input.requirements), input.context.planVersion);
                if (domains !== undefined && (domains !== ld.planningDomainHash || hash(input.requirements) !== ld.planningRequirementsHash || input.context.planVersion !== ld.inputVersions?.plan))
                    throw Error('Original planning domain fields changed');
                if (latestDispositionFootprint(input.context,launch.role) !== ld.latestDispositionHash || hash(input.context.latestDispositionInput ?? null) !== hash(ld.latestDispositionInput ?? null) || ld.latestDispositionHash && hash(input.context.latestDispositionView ?? null) !== hash(ld.latestDispositionView ?? null)) throw Error('Original latest disposition delivery changed');
                if (findingBodyFootprint(input.context,launch.role) !== ld.findingBodyHash || hash(input.context.findingBodyInput ?? null) !== hash(ld.findingBodyInput ?? null)) throw Error('Original finding bodies changed');
            }
        }
        catch {
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        }
        const context = input?.context;
        // Fresh review produces findings without receiving the planning occurrence census.
        const occurrences = launch.role === 'reviewer' && ld.stage === 'fresh-review' && context && !Object.hasOwn(context, 'occurrences')
            ? [] : context?.occurrences;
        if (!context || context.stage !== ld.stage || !Array.isArray(occurrences) || !Array.isArray(input.sources) || occurrences.some((item: any) => !item || typeof item.id !== 'string' || item.work !== work || (item.findingBodyOmitted !== undefined && typeof item.findingBodyOmitted !== 'boolean')) || new Set(occurrences.map((item: any) => item.id)).size !== occurrences.length)
            throw new Error('HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
        if (ld.decisionCarry?.version===3 || context.decisionCarry?.version===3) {
            try {
                if (hash(planningDecisionCarry(launch.role,ld)??null)!==hash(planningDecisionCarry(launch.role,context)??null) ||
                    hash(ld.decisionCarryInput??null)!==hash(context.decisionCarryInput??null)) throw Error('Original carry input differs');
            } catch { throw Error('HISTORICAL_INITIAL_CARRY_SOURCE_UNAVAILABLE'); }
        }
        if (hash(planningRepairProfile(launch.role,ld) ?? null) !== hash(planningRepairProfile(launch.role,context) ?? null))
            throw Error('HISTORICAL_INITIAL_PLANNING_REPAIR_UNAVAILABLE');
        if (hash(scopeAmendmentProfile(launch.role,ld) ?? null) !== hash(scopeAmendmentProfile(launch.role,context) ?? null))
            throw Error('HISTORICAL_INITIAL_SCOPE_AMENDMENT_UNAVAILABLE');
        const criteria = await this.historicalCriteria(work,launch,input);
        assertIdentityCapture();
        assertNativeHistory();

        for (const [field, kind] of [['baseVersion', 'base'], ['candidateVersion', 'candidate'], ['planVersion', 'plan'], ['verificationVersion', 'verification']] as const)
            if (context[field] !== tuple[kind])
                throw new Error('HISTORICAL_INPUT_TUPLE_UNAVAILABLE');
        const sources: { id: string; version: string; side: string; path: string; sha256: string; exposeInPrompt: boolean }[] = input.sources.map((source: any) => {
            const version = source && this.s.one('SELECT work,kind FROM change_versions WHERE id=?', source.version);
            if (!version || version.work !== work || !['base', 'candidate'].includes(source.side) || version.kind !== source.side || path.isAbsolute(source.path ?? '') || typeof source.path !== 'string' || path.posix.normalize(source.path) !== source.path || source.path.split('/').includes('..') || source.id !== `${source.side}:${source.path}` || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '') || ['id', 'version', 'side', 'path', 'sha256'].some(key => typeof source[key] !== 'string') || typeof source.exposeInPrompt !== 'boolean')
                throw new Error('HISTORICAL_SOURCE_METADATA_UNAVAILABLE');
            return { id: source.id, version: source.version, side: source.side, path: source.path, sha256: source.sha256, exposeInPrompt: source.exposeInPrompt };
        });
        const assertCurrent = () => {
            assertIdentityCapture();
            assertNativeHistory();
            criteria?.assertCurrent();
            try { if (materialFence && materialFence !== materialFenceNow()) throw Error('Material source changed'); }
            catch { throw Error('HISTORICAL_MATERIAL_PROOF_UNAVAILABLE'); }
        };
        assertCurrent();
        const receivedFindings = argumentOrigin ? argumentOrigin.claims.map(claim=>claim.finding) : corroborated ? corroborated.claims.map(claim => claim.finding) : materialOrigin?.metadata.harvestedFindings;
        return {
            output, launch, ld, run, rd, input, context, initialText:text, assertCurrent, criteriaDefinitions:criteria?.resolved,
            ...(receivedFindings ? { receivedFindings: structuredClone(receivedFindings) } : {}),
            witness: {
                outputId: output.id, launchId: launch.id, runId: run.id, role: launch.role, stage: ld.stage, epoch: launch.epoch,
                producerStatus: output.status, launchStatus: launch.status, inputVersions: tuple,
                nativeSessionId: rd.nativeSessionId, nativeEntryId: metadata.nativeEntryId, outputRawSha256: hash(output.raw),
                ...(materialSource ? { materialSource: {
                    version: 1, source: materialSource,
                    ...(argumentOrigin ? argumentOrigin.source.selector==='submission-arguments' ? {submissionAttempt:{querySettlement:argumentSettlement,checkpointLeafId:rd.nativeCheckpoint.leafId,
                        interpretation:argumentOrigin.source.complete===false&&!argumentOrigin.assessmentOutputId
                            ? 'Exact received literal material from a stopped submission stream only; no complete call, selected final, producer acceptance, diagnosis, semantic census or standing. Original query settlement proves received-byte custody, not a successful role.'
                            : 'Exact complete received submission call only; no selected final, producer acceptance, diagnosis, semantic census or standing. Original query settlement proves custody, not a successful role.'}} : {formatterAttempt:{querySettlement:argumentSettlement,checkpointLeafId:rd.nativeCheckpoint.leafId,
                        interpretation:'Exact complete received formatter call only; no selected final, query/producer completion, diagnosis, semantic census or standing. Native owner lifecycle admission remains separate.'}} : {}),
                    ...(corroborated ? { corroboratingOutputId: corroborated.selected.id,
                        claimLocations: corroborated.claims.map(({finding,...location}) => location),
                        ...('projection' in corroborated ? {partialTextProjection:corroborated.projection,interpretation:'Individual literal observations only; narration, semantic completeness and accepted RoleOutput remain unassessed.'}: {}) } : {})
                } } : {}),
                checkpoint: { sessionId: rd.nativeCheckpoint.sessionId, leafId: rd.nativeCheckpoint.leafId,
                    bytes: rd.nativeCheckpoint.bytes, sha256: rd.nativeCheckpoint.sha256 },
                initialView: {
                    ...(metadataIdentityInput(launch.role,ld) ? {metadataIdentities:{version:metadataIdentityInput(launch.role,ld)!.version,fieldFootprintSha256:ld.metadataIdentityHash,meaning:'Original wire identities used the declared lossless metadata presentation; literal initial text digest and reconstructed identity fields remain separate.'}} : {}),
                    ...(criteria ? {workflowCriteria:criteria.exposure} : {}),
                    ...(Object.hasOwn(context,'historicalProvenanceInput') ? {historicalCustody:{version:context.historicalProvenanceInput.version,delivery:historicalProvenanceManifest(context)?context.historicalProvenanceInput.version===2?'read-bound-memberships':'read-bound':'literal'}} : {}),
                    ...(latestDispositionFootprint(context,launch.role) ? {latestDispositionExplanations:{version:1,delivery:context.latestDispositionView?'read-bound':'literal'}} : {}),
                    userEntryId: user.id, textUtf8Bytes: Buffer.byteLength(text), textSha256: hash(text),
                    occurrenceIds: occurrences.map((item: any) => item.id),
                    findingBodyOmittedIds: occurrences.filter((item: any) => item.findingBodyOmitted === true).map((item: any) => item.id),
                    findingBodySuppliedIds: occurrences.filter((item: any) => item.data && Object.hasOwn(item.data, 'finding')).map((item: any) => item.id),
                    sources
                }
            }
        };
    }
    /** Select retained proposals, never old acceptance or a reconstructed initial census. */
    private async planningPrefix(options: ChangeOperation, role: 'planner' | 'challenger', planner?: { protocol: NonNullable<RoleExecution['protocol']>; inputScope: unknown }, proposalDiagnostics?: Record<string, unknown>) {
        const work = options.workId, stage = role === 'planner' ? 'planning' : 'planning-challenge';
        const latest = () => this.s.one('SELECT * FROM role_launches WHERE work=? AND epoch=? AND role=? ORDER BY rowid DESC LIMIT 1', work, this.work(work).epoch, role);
        const launch = latest(), current = this.row(work), owner = this.work(work);
        if (!launch || launch.status !== 'COMPLETE' || current.plan) return null;
        const ld = parse(launch.data), run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), rd = run && parse(run.data);
        if (role === 'challenger' && hash(ld.currentProposalDiagnostics ?? null) !== hash(proposalDiagnostics ?? null)) return null;
        // Older profiles without captured premises continue through normal fresh planning.
        if (!ld.inputScope || !ld.modelIdentity || !ld.modelMode || !rd?.runtimeProfile || !rd.projectProtection || !rd.manifest || !rd.modelIdentity || !rd.modelMode) return null;
        const sourceHash = () => hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]));
        const protection = () => projectProtection(this.s, this.work(work).project);
        const sourceVersions = () => {
            const row = this.row(work), base = this.s.one('SELECT * FROM change_versions WHERE id=? AND work=?', row.base, work);
            const candidate = row.candidate ? this.s.one('SELECT * FROM change_versions WHERE id=? AND work=?', row.candidate, work) : null;
            if (!base || base.kind !== 'base' || row.candidate && (!candidate || candidate.kind !== 'candidate'))
                throw Error('Planning prefix selected source versions unavailable');
            return { base, candidate };
        };
        const selected = sourceVersions(), baseManifest = parse(selected.base.data).manifest,
            candidateManifest = selected.candidate ? parse(selected.candidate.data).manifest : null;
        if (!this.sameNonCandidateBindings(work, ld.inputVersions) || ld.inputVersions.candidate !== current.candidate ||
            hash(rd.runtimeProfile) !== hash(this.h.options.runtimeProfile) || hash(rd.projectProtection) !== hash(protection()) ||
            hash(effective(rd.manifest)) !== hash(effective(candidateManifest ?? baseManifest)) || rd.sourceInputHash !== sourceHash()) return null;
        if (role === 'challenger' && (!planner || hash(ld.planProposal ?? null) !== hash(planner.protocol.plan) ||
            hash(ld.plannerOutput ?? null) !== hash(planner.protocol) || hash(ld.plannerInputScope ?? null) !== hash(planner.inputScope))) return null;
        const premises = () => {
            this.h.assertOpen(); this.h.assertApplicationAdmission?.(work); options.signal?.throwIfAborted(); this.guard(work);
            if (this.workflowCriteriaHold(work)) throw Error('Planning prefix criteria changed; explicit current-criteria planning is required');
            const row = this.row(work), w = this.work(work);
            return hash({ epoch: w.epoch, generation: w.generation, source: w.source, state: w.state,
                versions: this.bindings(work), sourceVersions: sourceVersions(), sourceHash: sourceHash(), protection: protection(), runtime: this.h.options.runtimeProfile,
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
        if (!Array.isArray(metadata.issues) || metadata.issues.length || hash(origin.criteriaDefinitions?.current.text ?? origin.input.contracts ?? null) !== hash(this.version(current.data.contractsVersion).data.text) ||
            origin.context.ownerSource !== owner.source || origin.context.ownerRequest !== current.data.request ||
            hash(origin.context.ownerRequirements ?? null) !== hash(current.data.ownerRequirements ?? []) ||
            hash(origin.input.requirements ?? null) !== hash([{ id: 'owner-request', text: current.data.request, source: owner.source }, ...(current.data.ownerRequirements ?? []).map((text: string, i: number) => ({ id: `owner-constraint-${i}`, text, source: owner.source }))]) ||
            hash(origin.context.projectProtection ?? null) !== hash(protection()) ||
            hash(origin.context.planningVerificationProfile ?? null) !== hash(this.verificationSupport(work).capability))
            throw Error('Planning prefix captured input or complete result unavailable; restore its original evidence');
        if (role === 'challenger' && (hash(origin.context.planProposal ?? null) !== hash(ld.planProposal ?? null) ||
            hash(origin.context.plannerOutput ?? null) !== hash(ld.plannerOutput ?? null) || hash(origin.context.plannerInputScope ?? null) !== hash(ld.plannerInputScope ?? null) ||
            hash(origin.context.currentProposalDiagnostics ?? null) !== hash(ld.currentProposalDiagnostics ?? null)))
            throw Error('Planning prefix challenger initial input does not match its selected planner');
        const framing = roleFraming(role, { ...origin.input, sources: [] });
        const parsed = parseRoleOutput(output.raw, role, framing.sourceFit, framing.constraints);
        if (!parsed.value || parsed.issues.length) throw Error('Planning prefix fails the current strict result contract; retain its original claims');
        if (ld.nativeRoleIntent && ld.nativeRoleIntent.schemaDigest !== hash(framing.schema)) return null;
        const inputScope = this.inputScopeReceipt(work, launch.id, output.id, role, stage, metadata.nativeEntryId);
        const sourceFiles = {
            base: new Map<string, string>(baseManifest.files.map((file: any) => [file.path, file.sha256])),
            candidate: new Map<string, string>((candidateManifest?.files ?? []).map((file: any) => [file.path, file.sha256])),
        };
        if (hash(inputScope.occurrenceIds) !== hash(origin.witness.initialView.occurrenceIds) ||
            hash(inputScope.findingBodyOmittedIds) !== hash(origin.witness.initialView.findingBodyOmittedIds) ||
            hash(inputScope.findingBodySuppliedIds) !== hash(origin.witness.initialView.findingBodySuppliedIds) ||
            hash(inputScope.selectedSources) !== hash(origin.witness.initialView.sources.map(({ exposeInPrompt, ...source }) => source)) ||
            hash(inputScope.promptIncludedSourceIds) !== hash(origin.witness.initialView.sources.filter(source => source.exposeInPrompt).map(source => source.id)) ||
            inputScope.selectedSources.some((source: { id: string; side: string; version: string; path: string; sha256: string }) => {
                if (source.side !== 'base' && source.side !== 'candidate') return true;
                const version = selected[source.side];
                return !version || source.version !== version.id || source.id !== `${source.side}:${source.path}` ||
                    sourceFiles[source.side].get(source.path) !== source.sha256;
            }))
            throw Error('Planning prefix original input-scope receipt does not match its recorded initial input');
        return { value: { launchId: launch.id, runId: run.id, output: output.id, protocol: parsed.value, inputScope }, assertCurrent: () => { assertRecorded(); origin.assertCurrent(); } };
    }
    /** A sufficient whole-work condition, not a semantic classification of old
     * claims. After any adoption (even one whose pointers were cleared), retain
     * eager definitions. Unknown history also keeps the existing delivery. */
    private preAdoptionHistory(work: string) {
        const read = () => {
            const state = this.row(work), owner = this.work(work);
            const versions = this.s.all('SELECT * FROM change_versions WHERE work=? ORDER BY id', work);
            const bindings = { candidate: state.candidate, plan: state.plan, verification: state.verification,
                requirements: state.data.requirementVersion ?? null };
            let eligible = owner.predecessor === null && versions.length > 0 &&
                versions.every(row => ['base', 'contracts'].includes(row.kind)) && Object.values(bindings).every(value => value === null) &&
                !state.data.verificationProfileMode && !state.data.carry && !state.data.pendingNit &&
                !this.s.one('SELECT id FROM check_runs WHERE work=? LIMIT 1', work) &&
                !this.s.one('SELECT id FROM remedy_confirmations WHERE work=? LIMIT 1', work);
            for (const launch of this.s.all('SELECT role,data FROM role_launches WHERE work=?', work)) {
                try {
                    const data = parse(launch.data), tuple = data.inputVersions;
                    if (!['planner', 'challenger', 'adjudicator'].includes(launch.role) || !tuple ||
                        ['candidate', 'plan', 'verification', 'requirements'].some(key => !Object.hasOwn(tuple, key) || tuple[key] !== null) ||
                        Object.hasOwn(data, 'acceptedPlan')) eligible = false;
                } catch { eligible = false; }
            }
            return { eligible, censusSha256: hash({ versions, bindings, predecessor: owner.predecessor, epoch: owner.epoch, generation: owner.generation }) };
        };
        const captured = read();
        if (!captured.eligible) return;
        return { proof: { version: 1 as const, censusSha256: captured.censusSha256 }, assertCurrent: () => {
            const current = read();
            if (!current.eligible || current.censusSha256 !== captured.censusSha256)
                throw Error('Historical plan pre-adoption census changed after capture');
        } };
    }
    /** One currentness guard for original history AND its owning records. */
    private async guardedPlanningProducer(work:string, outputId:string) {
        const original=await this.historicalPlanningProducer(work,outputId);
        const assertCurrent=()=>{
            original.assertCurrent();
            if (hash(this.s.one('SELECT * FROM role_outputs WHERE id=?',original.output.id))!==hash(original.output) ||
                hash(this.s.one('SELECT * FROM role_launches WHERE id=?',original.launch.id))!==hash(original.launch) ||
                hash(this.s.one('SELECT * FROM runs WHERE id=?',original.run.id))!==hash(original.run))
                throw Error('HISTORICAL_PRODUCER_PROVENANCE_UNAVAILABLE: Original historical producer records changed after capture');
        };
        assertCurrent();
        return {...original,assertCurrent};
    }
    private async historicalPlanningOperands(work: string, current: Record<string, any>) {
        const preAdoption = current.stage === 'planning-adjudication' && current.historicalPlansInput?.version === 2 ? this.preAdoptionHistory(work) : undefined;
        const links: any[] = [], plans = new Map<string, any>(), producers = new Map<string, any>(), unavailable: any[] = [], native = new Map<string, ReturnType<ChangeCore['historicalPlanningProducer']>>();
        const sourceGuards = new Map<string, () => void>();
        const witness = async (id: string) => {
            if (!native.has(id))
                native.set(id, this.guardedPlanningProducer(work, id));
            const original = await native.get(id)!;
            original.assertCurrent();
            sourceGuards.set(id, original.assertCurrent);
            return original;
        };
        const selectedNow = new Set([current.plannerInputScope?.launchId, current.challengerInputScope?.launchId].filter(Boolean));
        const semantics = 'Derived recorded HISTORICAL INITIAL MESSAGE views only, not retroactive inputScope receipts, complete provider context, comprehension or current census. Discarded plans are evidence, not current requirements or adopted implementation. Independently assess historical facts and present materiality; an accurate obsolete criticism need not require repairing a never-adopted proposal. No verdict or closure is supplied.';

        const subjects = this.pending(work);
        for (const pending of subjects) {
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
                const origin = await witness(output.id);
                const claims = origin.receivedFindings ?? capturedRawFindings(output.raw,launch.role,origin.ld).findings;
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
                const plan = origin.context.planProposal;
                if (!plan || typeof plan !== 'object' || Array.isArray(plan) || hash(plan) !== hash(ld.planProposal) || (ld.plannerOutput !== undefined && hash(origin.context.plannerOutput) !== hash(ld.plannerOutput)) || (ld.challenge !== undefined && hash(origin.context.challenge) !== hash(ld.challenge)))
                    throw new Error('HISTORICAL_PLAN_SOURCE_UNAVAILABLE');
                const capturedPair = Object.hasOwn(origin.context, 'plannerInputScope') || Object.hasOwn(ld, 'plannerInputScope');
                const selectedScope = origin.context.plannerInputScope;
                if (capturedPair && (!selectedScope || typeof selectedScope !== 'object' || Array.isArray(selectedScope) || selectedScope.version !== 1 ||
                    !Object.hasOwn(ld, 'plannerInputScope') || hash(selectedScope) !== hash(ld.plannerInputScope)))
                    throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                const matching = () => this.s.all('SELECT o.*,l.data AS plannerLaunchData FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? AND l.role=? ORDER BY o.rowid', work, 'planner').filter(candidate => {
                    if (capturedPair && candidate.id !== selectedScope.outputId)
                        return false;
                    if (!['usable', 'unusable'].includes(candidate.status) || typeof candidate.raw !== 'string' || Buffer.byteLength(candidate.raw) > 128 * 1024)
                        return false;
                    const metadata = parse(candidate.data);
                    if (metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false)
                        return false;
                    try {
                        const candidateLaunch = parse(candidate.plannerLaunchData);
                        if (candidateLaunch.stage !== 'planning' || hash(candidateLaunch.inputVersions) !== hash(ld.inputVersions))
                            return false;
                        const protocol: any = capturedOutputNeedsDecoding('planner',candidateLaunch) ? parseCapturedRoleOutput(candidate.raw,'planner',candidateLaunch).value : parseUniqueJson(candidate.raw);
                        return protocol && hash(protocol.plan) === hash(plan) && (ld.plannerOutput === undefined || hash(protocol) === hash(ld.plannerOutput));
                    }
                    catch {
                        return false;
                    }
                });
                const candidates = matching();
                if (candidates.length !== 1)
                    throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                // Preserve legacy uniqueness across the witness await and later
                // consumers; selected-row guards cannot detect an appended peer.
                const candidateIds = hash(candidates.map(candidate => candidate.id));
                const assertPairCurrent = () => {
                    if (hash(matching().map(candidate => candidate.id)) !== candidateIds)
                        throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE: Original planner selection changed after capture');
                };
                sourceGuards.set('planner-pair:' + occurrence.id, assertPairCurrent);
                const planner = await witness(candidates[0].id);
                assertPairCurrent();
                if (planner.launch.role !== 'planner' || planner.ld.stage !== 'planning' || hash(planner.ld.inputVersions) !== hash(ld.inputVersions))
                    throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                if (capturedPair) {
                    const scope = planner.ld.inputScope, view = planner.witness.initialView;
                    if (!scope || scope.version !== 1 || scope.workId !== work || scope.launchId !== planner.launch.id || scope.runId !== planner.run.id ||
                        scope.role !== 'planner' || scope.stage !== 'planning' || scope.epoch !== planner.launch.epoch ||
                        hash(scope.inputVersions) !== hash(planner.ld.inputVersions) || hash(selectedScope) !== hash({ ...scope, outputId: planner.output.id }) ||
                        hash(scope.occurrenceIds) !== hash(view.occurrenceIds) || hash(scope.findingBodyOmittedIds) !== hash(view.findingBodyOmittedIds) ||
                        hash(scope.findingBodySuppliedIds) !== hash(view.findingBodySuppliedIds) ||
                        hash(scope.selectedSources) !== hash(view.sources.map(({ exposeInPrompt, ...source }) => source)) ||
                        hash(scope.promptIncludedSourceIds) !== hash(view.sources.filter(source => source.exposeInPrompt).map(source => source.id)))
                        throw new Error('HISTORICAL_PLAN_PAIR_UNAVAILABLE');
                }
                const planHash = hash(plan), candidateLink = { occurrenceId: occurrence.id, observationOutputId: output.id, producerOutputId: output.id, planHash, plannerOutputId: planner.output.id, pairSemantics: capturedPair ? 'Original host-captured planner identity and initial scope; not current eligibility or plan acceptance' : ld.plannerOutput === undefined ? 'Unique exact plan equality within original input versions; not a historical host-assigned pair' : 'Unique exact retained plannerOutput/plan equality within original input versions; not a historical host-assigned pair' };
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
        const assertCurrent = () => { preAdoption?.assertCurrent(); for (const check of sourceGuards.values()) check(); };
        assertCurrent();
        return { value: projectHistoricalCensus(result), assertCurrent, neverAdoptedWork: preAdoption?.proof };
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
                const { bundle } = await this.bundle(work, { stage: 'fresh-review', reviewKey, purpose, requiredPaths, ...(Object.hasOwn(metadata, 'sourceScopeInput') ? { sourceScopeInput: structuredClone(metadata.sourceScopeInput) } : {}) }, 'reviewer');
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
        if (!declaration || !(context.stage === 'planning-adjudication' && declaration.version === 1 || context.stage === 'review-adjudication' && declaration.version === 2) || typeof declaration.id !== 'string' || Object.keys(declaration).some(k => !['version', 'id'].includes(k))) throw Error('Disposition history capture unavailable');
        const read = () => this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work);
        const original = read(), sourceHash = hash(original), epoch = this.work(work).epoch;
        const records = original.map(row => ({ ...row, data: parse(row.data) }));
        return {...buildDispositionHistory({ id: declaration.id, workId: work, epoch, artifactRoot: path.join(this.h.options.installationHome, 'artifacts'), stage: context.stage as 'planning-adjudication' | 'review-adjudication', records }),
            assertCurrent: () => { if (this.work(work).epoch !== epoch || hash(read()) !== sourceHash) throw Error('Original disposition history source changed during preparation'); }};
    }
    private adjudicationReferences(work: string, occurrences: { id: string; data: any }[]): import('../workflow/types.js').DecisionReferences {
        const synthetic = new Set(this.diagnosisSubjectIds(work)), pending = new Set(this.pending(work).map(item => item.id));
        const ids = occurrences.map(row => row.id), latest = new Map<string, any>();
        for (const row of this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work)) latest.set(row.occurrence, row);
        const retentionChoices = [...latest.values()].filter(row => ids.includes(row.occurrence) && !pending.has(row.occurrence) &&
            parse(this.s.one('SELECT data FROM obligations WHERE id=?', row.occurrence)?.data ?? '{}').state === 'resolved')
            .map(row => ({ dispositionId: row.id, occurrenceId: row.occurrence, sha256: hash(row) }));
        return { version: 3, occurrenceIds: ids, diagnosisOccurrenceIds: ids.filter(id=>synthetic.has(id)),
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
        if (Object.hasOwn(context, 'sourceScopeInput')) context = { ...context, sourceScopeInput: structuredClone(context.sourceScopeInput) };
        const scopeVersion = sourceScopeVersion(context);
        if (!role && Object.hasOwn(context, 'reviewResolutionInput')) throw Error('Review resolution requires an assigned role');
        const reviewResolution = role ? reviewResolutionInput(role, context) : undefined;
        const planningRepair = role ? planningRepairProfile(role,context) : undefined;
        if (!role && Object.hasOwn(context,'planningRepair')) throw Error('Planning repair requires its assigned role');
        const assertPlanningRepair = (receiver:Record<string,unknown>) => {
            if (hash(role ? planningRepairProfile(role,receiver) ?? null : null) !== hash(planningRepair ?? null)) throw Error('Original planning repair subjects changed');
        };
        const assertReviewResolution = (receiver: Record<string, unknown>) => {
            if (hash(role ? reviewResolutionInput(role, receiver) ?? null : null) !== hash(reviewResolution ?? null))
                throw Error('Original review resolution declaration changed');
        };
        if (!role && Object.hasOwn(context, 'sourceFitInput')) throw Error('Source-fit requires an assigned role');
        const sourceFitReceiver = role ? sourceFitInput(role, context) : undefined;
        const assertSourceFitReceiver = (receiver: Record<string, unknown>) => {
            if (hash(role ? sourceFitInput(role, receiver) ?? null : null) !== hash(sourceFitReceiver ?? null))
                throw Error('Original source-fit declaration changed');
        };
        const carryRequested = Object.hasOwn(context,'decisionCarryInput'), carryDeclaration = hash(context.decisionCarryInput??null), carryStage=context.stage;
        const assertCarryDeclaration = (receiver?:Record<string,unknown>) => {
            for (const value of [context,...(receiver?[receiver]:[])]) if (Object.hasOwn(value,'decisionCarryInput')!==carryRequested ||
                hash(value.decisionCarryInput??null)!==carryDeclaration || carryRequested&&value.stage!==carryStage)
                throw Error('Source-qualified carry original declaration changed');
        };
        if (carryRequested) {
            const declaration=context.decisionCarryInput as {version?:unknown}|null;
            if (role!=='adjudicator'||carryStage!=='planning-adjudication'||!declaration||Object.keys(declaration).join(',')!=='version'||declaration.version!==3)
                throw Error('Source-qualified carry requires its explicit planning adjudicator');
        }
        const r = this.row(work), criteria = this.version(r.data.contractsVersion);
        const history = role === 'adjudicator' && (context.stage === 'planning-adjudication' || context.stage === 'review-adjudication') ? this.dispositionHistory(work, context) : undefined;
        if (Object.hasOwn(context,'latestDispositionInput') && !history) throw Error('Latest disposition delivery requires its original adjudicator history');
        const provenanceId = historicalProvenanceInputId(context);
        if (provenanceId && role !== 'adjudicator') throw Error('Historical producer provenance requires its original adjudicator');
        const sourceInputChain = this.h.sourceImpacts(work, true), sourceInputChainHash = hash(sourceInputChain);
        const current = await loadCriteria();
        assertCarryDeclaration();
        history?.assertCurrent();
        const rawAssessment = context.stage === 'raw-assessment' ? context.rawAssessment as {knownOccurrenceIds:string[]} : undefined;
        const diagnostics = role === 'adjudicator' && ['planning-adjudication', 'review-adjudication','raw-assessment'].includes(String(context.stage)) ? this.producerDiagnostics(work,rawAssessment?.knownOccurrenceIds) : null;
        const historical = role === 'adjudicator' && ['planning-adjudication', 'review-adjudication'].includes(String(context.stage)) ? await this.historicalPlanningOperands(work, context) : null;
        const evidence: RoleInputEvidenceSnapshot[] = [];
        if (current.hash !== criteria.hash)
            throw new Error('Active workflow criteria changed: refresh criteria and replan retaining obligations');
        const b = this.version(r.base), c = r.candidate ? this.version(r.candidate) : null;
        const p = r.plan ? this.version(r.plan).data.plan as PlanProposal : null;
        const difference = c ? delta(b.data.manifest, c.data.manifest) : undefined;
        const changed = (difference?.files ?? []).map(f => f.path).filter(p => !p.startsWith('.git/'));
        const rolePaths = Array.isArray(context.requiredPaths) ? context.requiredPaths as string[] : [];
        const planned = [...verificationSourcePaths(p?.verification), ...(p?.verification.checks.flatMap(check =>
            check.consumerControl?.replacementPath ? [check.consumerControl.replacementPath] : []) ?? [])];
        const present = new Set([...b.data.manifest.files, ...(c?.data.manifest.files ?? [])].map((file: {path: string}) => file.path));
        const prospective = rolePreparesCandidate(role, context.stage) || role === 'adjudicator' && !!(sourceFitReceiver || rawAssessment) &&
            ['plan', 'implement', 'repair'].includes(this.continuationStage(work, r) ?? '');
        // A declared future output is not existing text. Existing immutable
        // inputs, changed files and explicit receiver requirements stay strict.
        const forced = [...planned.filter(file => !prospective || present.has(file)), ...changed, ...rolePaths];
        const seedBytes = c ? 16 * 1024 : 32 * 1024;
        const inputSources = [...await sources(b, 'base', forced, !!p, seedBytes), ...(c ? await sources(c, 'candidate', forced, !!p, seedBytes) : [])];
        for (const required of forced)
            if (!inputSources.some(source => source.path === required))
                throw new Error('Required text source unavailable: ' + required);
        if (inputSources.reduce((size, source) => size + Buffer.byteLength(source.content, 'utf8'), 0) > 1024 * 1024)
            throw new Error('Selected base/candidate text exceeds supported1MiB role input; narrow accepted source scope');
        const requiredPaths = new Set(forced);
        const requiredScope = inputSources.filter(s => requiredPaths.has(s.path)).map(s => ({ sourceId: s.id, startLine: 1, endLine: assessedLineCount(s.content, context) }));
        const selectedReviewEvidence = role === 'adjudicator' && context.stage === 'review-adjudication' ? await this.selectedReviewEvidence(work, context) : null;
        // Failed, unadjudicated predecessor advocacy is not a factual prerequisite
        // for a fresh planner. The ledger and every other role's full claims remain.
        const occurrences = this.inspect(work).occurrences.filter((occurrence:any)=>!rawAssessment || rawAssessment.knownOccurrenceIds.includes(occurrence.id)).map((occurrence: any) => {
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
            (this.version(baselinePlan).data.plan as PlanProposal).verification.strategies?.flatMap(verificationStrategyLeaves).some(strategy => strategy.kind === 'base-execution-duty' && strategy.requirementId === requirement.id)),
            meaning: 'Actual historical independently accepted before-edit duties. Preserve their meaning/source; no cross-plan historical witness mapping or implicit removal is supported.' } : undefined;
        const verificationWitnesses = p && Object.hasOwn(p.verification, 'strategies') && ['fresh-review', 'review-adjudication'].includes(String(context.stage)) ? this.strategyWitnesses(work) : undefined;
        const verificationReviewRequirements = verificationWitnesses ? context.stage === 'fresh-review'
            ? verificationWitnesses.filter(item => this.strategyReviewApplies(item,context.reviewKey))
            : this.strategyReviewEvidence(work, 'accounting').map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] })) : undefined;
        const verificationEvidence = verificationWitnesses?.flatMap(witness => witness.witnessIds.map(id => this.verificationRecord(work, id, true)));
        const sourceFitReferences: SourceFitReferences | undefined = role === 'adjudicator' &&
            ['planning-adjudication', 'source-fit', 'review-adjudication'].includes(String(context.stage)) && sourceInputChain.some(input => input.data.effectHold)
            ? {version: 1, stage: context.stage as SourceFitReferences['stage'], inputs: sourceInputChain.filter(input => input.data.effectHold).map(input => ({inputId:input.input_id,directionRevision:input.revision})), requirementIds: (p?.requirements ?? []).map(requirement => requirement.id)} : undefined;
        const bundle: InputBundle = { requirements: p?.requirements ?? [{ id: 'owner-request', text: r.data.request, source: this.work(work).source }, ...(r.data.ownerRequirements as string[]).map((text, i) => ({ id: `owner-constraint-${i}`, text, source: this.work(work).source }))], contracts: criteria.data.text, sources: inputSources, sourceCatalogue: { format: 1, version: (c ?? b).id, side: c ? 'candidate' : 'base', files: (c ?? b).data.manifest.files.map((file: any) => ({ path: file.path, sha256: file.sha256, size: file.size })) }, requiredScope, context: { requirementSourceIds: this.requirementSources(work), projectProtection: projectProtection(this.s, this.work(work).project), sourceProvenance: parse(this.s.one('SELECT origin FROM sources WHERE id=?', this.work(work).source).origin), delegatingOwnerSource: this.ownerSource(work), derivedCandidateContext: c?.data.derived ? { kind: c.data.derived, native: c.data.native, effectiveDifferences: c.data.effectiveDifferences, publicationInventory: c.data.publicationInventory, predecessor: c.predecessor } : null, ownerRequest: r.data.request, ownerSource: this.work(work).source, baseVersion: r.base, candidateVersion: r.candidate, planVersion: r.plan, verificationVersion: r.verification, ownerRequirements: r.data.ownerRequirements, sourceInventory: { baseSample: b.data.manifest.files.slice(0, 100), candidateSample: (c?.data.manifest.files ?? []).slice(0, 100), baseCount: b.data.manifest.files.length, candidateCount: c?.data.manifest.files.length ?? 0, baseDependencyLinkSample: (b.data.manifest.dependencyLinks ?? []).slice(0, 20), candidateDependencyLinkSample: (c?.data.manifest.dependencyLinks ?? []).slice(0, 20), baseDependencyLinkCount: b.data.manifest.dependencyLinks?.length ?? 0, candidateDependencyLinkCount: c?.data.manifest.dependencyLinks?.length ?? 0, dependencyLinkDeltaSample: (difference?.dependencyLinks ?? []).slice(0, 20), dependencyLinkDeltaCount: difference?.dependencyLinks?.length ?? 0, inventoryComplete: b.data.manifest.files.length <= 100 && (c?.data.manifest.files.length ?? 0) <= 100 && (b.data.manifest.dependencyLinks?.length ?? 0) <= 20 && (c?.data.manifest.dependencyLinks?.length ?? 0) <= 20, completeManifestRefs: [b.id, ...(c ? [c.id] : [])], selectionProfile: 'named-text-v3 at most32KiB optional seeds with captured-model assembly preflight; staged captured workspace metadata enables actual native-read discovery; VCS/dependency/build metadata not prompt-exposed by default; after plan only accepted requiredPaths, checker fixture paths, position-specific paths and all non-VCS changed files are selected', excluded: [...b.data.manifest.files.map((f: any) => `base:${f.path}`), ...(c?.data.manifest.files ?? []).map((f: any) => `candidate:${f.path}`)].filter(id => !inputSources.some(s => s.id === id)).slice(0, 100), exclusionListMayBePartial: true }, ...(context.stage === 'fresh-review' ? { openObligations: this.pending(work).map(o => {
                        const raw = this.inspect(work).occurrences.find((f: any) => f.id === o.id) as any;
                        return { id: o.id, kind: o.kind, state: o.state, ...(Object.hasOwn(o, 'disposition') ? { disposition: o.disposition } : {}), ...(Object.hasOwn(o, 'equivalentTo') ? { equivalentTo: o.equivalentTo } : {}), requirementId: raw?.data.finding?.requirementId ?? null, evidence: raw?.data.finding?.evidence ?? [], ...(o.kind === 'reproduction-unresolved' ? { command: o.command, assertions: o.assertions, candidateHash: o.candidateHash } : {}), ...(o.kind === 'check' ? { actualFailure: o, amendment: this.currentAmendments(work).find(a => a.obligationId === o.id), proofs: r.data.amendmentProofs ?? [] } : {}), severity: raw?.data.finding?.severity ?? null };
                    }) } : { occurrences, dispositions: this.inspect(work).dispositions, pendingObligations: this.pending(work) }), checkAmendments: this.currentAmendments(work), amendmentProofs: r.data.amendmentProofs ?? [], criteriaRefresh, checks: this.inspect(work).checks, ...context, sourceInputChain, ...(sourceFitReferences ? {sourceFitReferences} : {}), ...(planningProfile ? { planningVerificationProfile: planningProfile, ...(retainedBaselineDuties ? { retainedBaselineDuties } : {}) } : {}), ...(verificationReviewRequirements ? { verificationReviewRequirements, verificationEvidence } : {}), ...(diagnostics ? { producerDiagnostics: diagnostics, decisionReferences: this.adjudicationReferences(work, occurrences) } : {}), ...(historical ? { historicalPlanningOperands: historical.value } : {}), ...(selectedReviewEvidence ? { selectedReviewEvidence } : {}) } };
        if (rawAssessment) {
            const subjects = new Set(rawAssessment.knownOccurrenceIds);
            bundle.context.dispositions = this.inspect(work).dispositions.filter((row:any)=>subjects.has(row.occurrence));
            bundle.context.pendingObligations = this.pending(work).filter(row=>subjects.has(row.id));
        }
        if (role === 'adjudicator' && ['planning-adjudication','review-adjudication'].includes(String(context.stage))) {
            if (history) {
                const pending = new Set(this.pending(work).map(item => item.id));
                bundle.context.dispositions = history.latest;
                bundle.context.dispositionHistory = history.manifest;
                bundle.context = prepareLatestDispositions(bundle.context, role, history);
                evidence.push({ manifest: history.manifest, contents: history.contents });
                const referenced = new Set([...occurrences.map((row: any) => row.id), ...history.latest.map(row => row.occurrence)]);
                bundle.context.obligationStates = relevantObligationStates(this.s.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid', work).map(row => ({ ...row, data: parse(row.data) })), referenced, pending);
            }
        }
        const historicalId = historicalPlanInputId(context);
        if (historical && historicalId) {
            const prepared = prepareHistoricalPlans(historical.value, { id: historicalId, workId: work, epoch: this.work(work).epoch,
                artifactRoot: path.join(this.h.options.installationHome, 'artifacts'), stage: context.stage as 'planning-adjudication' | 'review-adjudication',
                ...((context.historicalPlansInput as {version:number}).version===4?{deliveryVersion:4 as const}:{}), ...(historical.neverAdoptedWork ? { neverAdoptedWork: historical.neverAdoptedWork } : {}) });
            bundle.context.historicalPlanningOperands = prepared.value;
            if (prepared.evidence) evidence.push(prepared.evidence);
        }
        let assertProvenanceCurrent = () => {};
        if (provenanceId) {
            const prepared = prepareHistoricalProvenance(bundle.context.historicalPlanningOperands,{id:provenanceId,workId:work,epoch:this.work(work).epoch,stage:String(context.stage),artifactRoot:path.join(this.h.options.installationHome,'artifacts'),version:(context.historicalProvenanceInput as {version:1|2}).version});
            bundle.context.historicalPlanningOperands = prepared.value;
            assertProvenanceCurrent = () => prepared.assertCurrent(bundle.context.historicalPlanningOperands);
            if (prepared.evidence) evidence.push(prepared.evidence);
        }
        let assertCriteriaCurrent = () => {};
        if (Object.hasOwn(context, 'workflowCriteriaInput')) {
            const declaration = context.workflowCriteriaInput as {version?:unknown;id?:unknown} | null;
            if (!role || !declaration || typeof declaration.version !== 'number' || !criteriaOperatingProfile(role, context.stage, declaration.version) || typeof declaration.id !== 'string' ||
                Object.keys(declaration).sort().join(',') !== 'id,version') throw Error('Original workflow criteria declaration unavailable');
            const definition = (version: typeof criteria): CriteriaDefinition => ({id:version.id,hash:version.hash,text:version.data.text,assets:version.data.assets});
            const prepared = prepareCriteriaDelivery(definition(criteria), previousCriteria ? definition(previousCriteria) : null,
                {id:declaration.id,workId:work,epoch:this.work(work).epoch,role,stage:String(context.stage),artifactRoot:path.join(this.h.options.installationHome,'artifacts'),version:declaration.version as CriteriaDeliveryView['version']});
            const sourceHash = hash([criteria,previousCriteria]), epoch = this.work(work).epoch, refreshHash = hash(refresh ?? null);
            assertCriteriaCurrent = () => {
                if (this.work(work).epoch !== epoch || this.row(work).data.contractsVersion !== criteria.id || hash(this.row(work).data.criteriaRefresh ?? null) !== refreshHash ||
                    hash([this.version(criteria.id),previousCriteria ? this.version(previousCriteria.id) : null]) !== sourceHash || loadCriteriaSync().hash !== criteria.hash)
                    throw Error('Original workflow criteria source changed after capture');
            };
            bundle.contracts = prepared.operating;
            bundle.context.workflowCriteria = prepared.view;
            if (criteriaRefresh) bundle.context.criteriaRefresh = {...criteriaRefresh,
                previous:{hash:previousCriteria!.hash,textSource:'context.workflowCriteria prior records',assets:assetIdentities(previousCriteria!.data.assets)},
                current:{hash:criteria.hash,textSource:'context.workflowCriteria current records',assets:assetIdentities(criteria.data.assets)}};
            evidence.push(prepared.evidence);
            assertCriteriaCurrent();
        }
        let carryHash:string|undefined, carrySourcesHash:string|undefined;
        const prepareCarry = () => {
            assertCarryDeclaration(bundle.context);
            if (!carryRequested) return;
            bundle.context.decisionCarry = captureDecisionCarry({version:3,baselineVersion:b.id,
                baseSourceIds:bundle.sources.filter(source=>source.side==='base'&&source.version===b.id&&source.exposeInPrompt).map(source=>source.id)});
            carryHash=hash(bundle.context.decisionCarry);carrySourcesHash=hash(bundle.sources);
        };
        prepareCarry();
        const assertCarryCurrent = () => {
            assertCarryDeclaration(bundle.context);
            if (carryRequested&&(hash(bundle.context.decisionCarry??null)!==carryHash||hash(bundle.sources)!==carrySourcesHash))
                throw Error('Source-qualified carry original input changed');
        };
        if (Object.hasOwn(context,'subjectActionsInput')) {
            if (!role) throw Error('Subject actions require an assigned role');
            bundle.context = prepareSubjectActionInput(role,bundle.context);
        }
        const preparedSubjectDeclaration = hash(bundle.context.subjectActionsInput ?? null);
        const preparedSubjectFootprint = role ? subjectActionFootprint(role,bundle.context) : undefined;
        const assertSubjectCurrent = () => {
            if (hash(bundle.context.subjectActionsInput ?? null) !== preparedSubjectDeclaration ||
                (role ? subjectActionFootprint(role,bundle.context) : undefined) !== preparedSubjectFootprint)
                throw Error('Original subject action recipe changed during preparation');
        };
        const findingDeclared = Object.hasOwn(bundle.context,'findingBodyInput'), findingDeclaration = hash(bundle.context.findingBodyInput ?? null), findingStage = bundle.context.stage;
        if (findingDeclared && !role) throw Error('Finding body declaration requires an assigned role');
        const preparedFindingFootprint = role ? findingBodyFootprint(bundle.context,role) : undefined;
        const assertFindingCurrent = () => {
            if (Object.hasOwn(bundle.context,'findingBodyInput') !== findingDeclared || hash(bundle.context.findingBodyInput ?? null) !== findingDeclaration ||
                findingDeclared && bundle.context.stage !== findingStage || (role ? findingBodyFootprint(bundle.context,role) : undefined) !== preparedFindingFootprint)
                throw Error('Original finding bodies changed during preparation');
        };
        if (role) {
            const { assertModelContextBudget, declaredModelContextLimits } = await import('../pi/context-budget.js');
            let capabilities: unknown = model?.managed?.evidence.capabilities;
            if (model?.definition) capabilities = declaredModelContextLimits(model.definition, model.modelId);
            if (model?.bridge || model?.bridgeProfile) {
                const {admitOwnedClaudeSelection} = await import('../pi/claude-host.js');
                const selected = admitOwnedClaudeSelection(model);
                const catalog = await selected.bridge!.models();
                this.guard(work);
                const entry = catalog.find(item=>item.id===selected.modelId);
                capabilities = entry ? {contextWindow:entry.contextWindow,maxTokens:entry.maxTokens} : null;
            }
            const bounds = this.roleBounds();
            const estimate = () => {
                assertCarryCurrent();
                assertFindingCurrent();
                const native = model?.bridge || model?.bridgeProfile
                    ? nativeRoleFraming(role,bundle,'preallocation-estimate',nativeRoleTurnLimit(bounds.maxProviderRequests),undefined,bounds.maxProviderRequests) : undefined;
                const framing = native ?? roleFraming(role,bundle,false,bounds);
                if (native) assertNativeResponseSchema(native.intent);
                // This is a lower bound; native system/tool projection is checked
                // again at the actual SDK stream boundary, never guessed here.
                if (capabilities === undefined)
                    return undefined;
                if (!capabilities || typeof capabilities !== 'object')
                    throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'Captured model capacities are invalid; resolve the original selection before retrying.');
                const framingContext = { systemPrompt: framing.systemPrompt, messages: [{ role: 'user' as const, content: framing.prompt, timestamp: 0 }] };
                return assertModelContextBudget(
                    capabilities as Parameters<typeof assertModelContextBudget>[0],
                    native ? structuredOutputContext(framingContext,native.intent) : framingContext);
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
                prepareCarry();
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
        const assertCurrent = () => {
            if (sourceScopeVersion(context) !== scopeVersion || sourceScopeVersion(bundle.context) !== scopeVersion)
                throw Error('Original source scope declaration changed');
            assertReviewResolution(context); assertReviewResolution(bundle.context);
            assertPlanningRepair(context); assertPlanningRepair(bundle.context);
            assertSourceFitReceiver(context); assertSourceFitReceiver(bundle.context);
            if (hash(bundle.context.sourceInputChain) !== sourceInputChainHash || hash(this.h.sourceImpacts(work, true)) !== sourceInputChainHash)
                throw Error('Original source direction or provenance changed during role preparation');
            assertCarryCurrent();
            assertFindingCurrent(); assertSubjectCurrent(); assertProvenanceCurrent(); history?.assertCurrent(); historical?.assertCurrent(); assertCriteriaCurrent();
        };
        assertCurrent();
        return { bundle, evidence, assertCurrent };
    }
    /** Read-only preflight; reservation must repeat this under its transaction. */
    private assertAvailableAllowance(work: string, role: Role | null, stage?: unknown) {
        const execution = this.budget(work, 'execution');
        if (execution.consumed + execution.reserved >= execution.limit)
            throw new ExecutionAdmissionRefusal('BUDGET_EXHAUSTED', 'Execution allowance exhausted', 'Extend retained execution allowance', work);
        if (roleUsesResolutionAllowance(role) || role === 'planner' && stage === 'planning') {
            const resolution = this.budget(work, 'resolution');
            if (resolution.consumed + resolution.reserved >= resolution.limit)
                throw new ControllerError('RESOLUTION_EXHAUSTED', 'Resolution allowance exhausted', 'Extend retained resolution allowance; pending findings remain', work);
        }
    }
    private reserve(work: string, role: Role | null, context: Record<string, unknown>, staging: string, captureOnly = false) {
        if (this.operations.get(work)?.admittedState === 'DELIVERED') throw Error('Delivered material coverage recovery cannot allocate execution');
        this.h.assertOpen();
        this.h.assertApplicationAdmission?.(work);
        if (this.h.busy(work) && !this.operations.has(work))
            throw new Error('Work busy');
        this.guard(work);
        this.operations.get(work)?.assertReservation?.();
        const runtimeProfile = this.h.options.runtimeProfile ? Object.freeze({ ...this.h.options.runtimeProfile }) : undefined;
        if (!captureOnly && !runtimeProfile)
            throw new ControllerError('MISSING_RUNTIME', 'Role/check requires runtime profile', 'Supply trusted client/context/image', work);
        return this.s.tx(() => {
            const w = this.work(work);
            if (workCleanupUnconfirmed(this.s, w))
                throw new Error('Cleanup unknown');
            if (w.state !== 'ACTIVE')
                throw new Error('Explicit drive/resume required; stages cannot reactivate work');
            const current = this.work(work);
            this.assertAvailableAllowance(work, role, context.stage);
            const resolution = roleUsesResolutionAllowance(role);
            if (resolution) {
                this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', current.lineage, 'resolution');
            }
            this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', current.lineage, 'execution');
            const runId = randomUUID(), launchId = randomUUID();
            this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, work, current.epoch, current.generation, 'CREATED', staging, 'reserved', JSON.stringify({ kind: role ? 'governed-role' : 'governed-check', projectProtection: projectProtection(this.s, current.project), runtimeProfile, role, launchId, controllerPid: process.pid, ...(role ? { modelIdentity: context.modelIdentity, modelMode: context.modelMode } : {}) }));
            if (role)
                this.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', launchId, work, runId, role, current.epoch, 'CREATED', resolution ? 'reserved' : 'none', JSON.stringify({ inputVersions: { contracts: this.row(work).data.contractsVersion, requirements: this.row(work).data.requirementVersion ?? null, base: this.row(work).base, candidate: this.row(work).candidate, plan: this.row(work).plan, verification: this.row(work).verification }, ...context }));
            // Assessing retained raw is not a replacement attempt for an earlier
            // task-stage producer, even when both actors are adjudicators.
            for (const row of context.stage === 'raw-assessment' ? [] : this.s.all('SELECT * FROM obligations WHERE work=?', work)) {
                const o = parse(row.data);
                if (o.kind === 'diagnostic' && o.recoverySource && !o.replacementLaunch && !o.reentryRun) {
                    if (o.launchId) {
                        const old = this.s.one('SELECT role,data FROM role_launches WHERE id=?', o.launchId);
                        if (old?.role === role && (parse(old.data).stage === 'consumer-control-proposal') === (context.stage === 'consumer-control-proposal'))
                            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, replacementLaunch: launchId, reentryRun: runId }), row.id);
                    }
                    else if (!role && o.checkId === context.checkId)
                        this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...o, reentryRun: runId }), row.id);
                }
            }
            return { runId, launchId, epoch: current.epoch, generation: current.generation, resolution, runtimeProfile };
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
        if (!Array.isArray(check.expectationPaths)) return null;
        return bindCheckExpectations(this.version(candidate).data.manifest as Manifest, check);
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
    private collect(work: string, launchId: string, execution: Pick<RoleExecution, 'evidenceReads' | 'role' | 'rawFinal' | 'issues' | 'exposures' | 'terminal' | 'historyRef' | 'rawFinalTruncated' | 'protocol' | 'events' | 'nativeSource' | 'providerFailure' | 'requestLimit'> & {
        providerRequests: number | null;
        nativeEntryId?: string;
        harvestedFindings?: unknown[];
        omittedFindingCount?: number;
        materialSources?: unknown[];
        accountingKey?: string;
        materialAssessment?: MaterialAssessment;
        nativeTextProjection?: {version:1;source:unknown;region:NativeTextFindingRegion};
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
                        hash(metadata.nativeTextProjection ?? null) !== hash(execution.nativeTextProjection ?? null) ||
                        occurrences.length !== findings.length + (execution.omittedFindingCount ? 1 : 0) + (execution.materialAssessment ? 1 : 0) ||
                        findings.some((finding, index) => occurrences[index]?.ordinal !== index || occurrences[index]?.work !== work ||
                            parse(occurrences[index].data).launchId !== launchId || parse(occurrences[index].data).role !== execution.role ||
                            hash(parse(occurrences[index].data).finding) !== hash(finding)) ||
                        execution.materialAssessment && hash(parse(occurrences.at(-1).data).finding) !== hash(materialDiagnosisFinding(previous.id,execution.materialAssessment.version)))
                        throw Error('Original material accounting changed or is incomplete');
                }
                return previous.id;
            }
        }
        const output = randomUUID();
        this.s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', output, launchId, execution.rawFinal, accountingOnly ? 'accounted-intermediate' : usable ? 'usable' : 'unusable', JSON.stringify({ ...(execution.accountingKey ? { accountingKey: execution.accountingKey } : {}), ...(execution.nativeTextProjection ? {nativeTextProjection:execution.nativeTextProjection} : {}), ...(execution.materialAssessment ? {materialAssessment:execution.materialAssessment} : {}), ...(execution.providerFailure && !accountingOnly && execution.terminal === 'error' ? { providerFailure: execution.providerFailure } : {}), ...(execution.requestLimit && !accountingOnly && execution.terminal === 'error' ? {requestLimit: execution.requestLimit} : {}), ...(execution.evidenceReads ? { evidenceReads: execution.evidenceReads } : {}), protocol: execution.protocol, issues: execution.issues, exposures: execution.exposures, terminal: execution.terminal, historyRef: execution.historyRef, providerRequests: execution.providerRequests, rawFinalTruncated: execution.rawFinalTruncated, nativeEntryId: execution.nativeEntryId ?? null, nativeSource: accountingOnly ? null : execution.nativeSource ?? null, harvestedFindings: execution.harvestedFindings ?? null, materialSources: execution.materialSources ?? null, omittedFindingCount: execution.omittedFindingCount ?? 0 }));
        if (execution.omittedFindingCount)
            this.s.run('INSERT OR IGNORE INTO obligations VALUES(?,?,?)', `raw-incomplete-${launchId}-${execution.nativeEntryId}`, work, JSON.stringify({ kind: 'raw-findings-incomplete', state: 'pending', launchId, output, nativeEntryId: execution.nativeEntryId, historyRef: execution.historyRef, omittedFindingCount: execution.omittedFindingCount, recovery: 'Known findings exceed the initial bounded extraction profile; retain exact native history and restore a supported bounded extraction before eligibility. Replacement clear output or ordinary disposition cannot discharge this producer completeness obligation.' }));
        const raw = capturedRawFindings(execution.rawFinal, execution.role, parse(this.s.one('SELECT data FROM role_launches WHERE id=?', launchId)?.data ?? '{}'));
        const findings = [...(execution.harvestedFindings ?? raw.findings)];
        if (execution.omittedFindingCount)
            findings.push({ requirementId: 'producer-integrity', severity: 'blocking', repair: 'unknown', description: `Intermediate native entry contains ${execution.omittedFindingCount} findings exceeding the bounded extraction profile; required diagnosis must inspect the retained full native entry before claiming those observations resolved`, evidence: [output, execution.historyRef ?? 'missing-native-history', execution.nativeEntryId ?? 'missing-native-entry'] });
        if (execution.materialAssessment) findings.push(materialDiagnosisFinding(output,execution.materialAssessment.version));
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
    private harvestEntries(work: string, launchId: string, role: Role, entries: any[], execution: any, selected: string | null, settledPrefixCheckpoint?: string) {
        const intent = entries.find(e=>e.type==='custom' && e.customType===nativeRoleEntries.intent && e.data?.request?.binding?.launchId===launchId && e.data?.request?.binding?.role===role);
        const sources: Array<{id:string;raw:string;findings:unknown[];materialSources?:unknown[];accountingKey?:string;retainEmpty?:boolean;nativeTextProjection?:{version:1;source:unknown;region:NativeTextFindingRegion};materialAssessment?:MaterialAssessment}> = [];
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
            const declaredSubmission = intent.data.request.version === 3 && intent.data.request.carrier === 'tool-submission/v1';
            const declaredNarrativeRole = intent.data.request.version === 2 && intent.data.request.carrier === 'assistant-json/v1' || declaredSubmission;
            const argumentSelector = declaredSubmission ? 'submission-arguments' : 'formatter-arguments';
            // These records are projections of the original SDK trace. Derive on
            // recovery too: a crash need not have reached materialization.
            const {materials:original,diagnostics} = nativeRoleMaterial(entries,intent.id), proof = execution.nativeSource;
            const prefixConflicts = diagnostics.prefix.sources;
            extractionIssues.push(...diagnostics.extraction.sample.slice(0,Math.max(0,64-extractionIssues.length)));
            extractionIssueCount += diagnostics.extraction.count;
            const argument = proof && entries.find(e=>e.id===nativeRoleSourceMaterialId(proof));
            // Selection alone does not prove that the flat final collector owns
            // every literal claim in the original formatter envelope.
            let selectedProven = false, terminalAlias: string | null = null;
            const flat = capturedRawFindings(execution.rawFinal ?? null, role, launchData ?? {});
            const decoded = typeof execution.rawFinal === 'string' ? parseCapturedRoleOutput(execution.rawFinal, role, launchData ?? {}) : null;
            const selectedRead = typeof execution.rawFinal === 'string' ? capturedMaterialFindings(execution.rawFinal, role, launchData ?? {}) : null;
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
                    if (extractionIssues.length < 64) extractionIssues.push({entryId:selected,reason:'Original selected native role provenance unavailable'});
                } else {
                    if (decoded?.value && execution.protocol && hash(decoded.value) === hash(execution.protocol))
                        terminalAlias = proof.kind === 'claude-sdk-assistant-json/v1' ? execution.rawFinal! : JSON.stringify(decoded.value);
                }
            }
            const isSelectedMaterial = (material: typeof original[number]) => selectedProven &&
                material.selector === argument?.data.selector && material.sourceEntryId === argument?.data.sourceEntryId &&
                (proof.kind === 'claude-sdk-assistant-json/v1' || material.toolUseId === argument?.data.toolUseId);
            const textProjection = selectedProven && proof?.kind === 'claude-sdk-assistant-json/v1'
                ? nativeTextFindingProjection(execution.rawFinal, role) : undefined;
            const projectionReceipt = textProjection?.region ? {version:1 as const,source:proof,region:textProjection.region} : undefined;
            const unownedProofs = new Map<string,typeof original[number]>();
            if (original.some(material=>unownedNativeSelector(material.selector))) {
                try {
                    for (const material of readUnownedNativeMaterials(entries,{sessionId:execution.nativeSessionId,launchId,role,intent:launchData.nativeRoleIntent}))
                        unownedProofs.set(JSON.stringify([material.sourceEntryId,material.selector]),material);
                } catch { /* Exact public source proof is required separately from byte retention. */ }
            }
            const stoppedSubmissionProofs=new Map<string,typeof original[number]>();
            if(declaredSubmission&&execution.nativeCheckpoint?.leafId)for(const material of original){
                if(material.selector!=='submission-arguments'||material.complete!==false||material.invalid!==true)continue;
                try{
                    const proved=readStoppedSubmissionPrefix(entries,{sessionId:execution.nativeSessionId,launchId,role,intent:launchData.nativeRoleIntent,checkpointLeafId:execution.nativeCheckpoint.leafId},material.sourceEntryId);
                    if(hash(proved)===hash(material))stoppedSubmissionProofs.set(material.sourceEntryId,proved);
                }catch{ /* Unproved stopped material remains held, never an empty-claims verdict. */ }
            }
            const aggregateFrames = new Map<string,typeof original>();
            for (const material of original) if (['formatter-arguments','submission-arguments','stream-text'].includes(material.selector))
                for (const frame of material.frames ?? []) aggregateFrames.set(frame,[...(aggregateFrames.get(frame) ?? []),material]);
            const groups = new Map<string,typeof original>();
            for (const material of original) {
                // The same original delta can already be a fully covered view
                // in an old invalid-index formatter aggregate. Prove its frame
                // membership and complete literal coverage, never dedup by text.
                const proved = unownedProofs.get(JSON.stringify([material.sourceEntryId,material.selector]));
                const copySelector = material.selector === 'unowned-input-json-delta' ? argumentSelector : material.selector === 'unowned-text-delta' ? 'stream-text' : null;
                if (copySelector && proved && hash(proved) === hash(material) && aggregateFrames.get(material.sourceEntryId)?.some(other=>other.selector === copySelector && other.raw === material.raw)) {
                    const read = capturedMaterialFindings(material.raw,role,launchData ?? {});
                    if (read.complete && (copySelector === argumentSelector || read.claims.every(claim=>claim.findingPath === '/findings' && claim.memberPath.length === 1))) continue;
                }
                if (selectedProven && (proof.kind === 'claude-sdk-formatter/v1' && material.selector === 'decoded-result-value' && material.sourceEntryId === proof.resultEntryId ||
                    selectedCovered && isSelectedMaterial(material))) continue;
                // Only an exact second representation from this proven terminal
                // result can be omitted. Historical accounting stays immutable
                // and must still pass its original correspondence checks.
                if (terminalAlias !== null && material.selector === 'result-text' && material.sourceEntryId === proof.resultEntryId && material.raw === terminalAlias &&
                    !this.s.one("SELECT id FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=?", launchId, material.sourceEntryId)) continue;
                // The exact selected Source2 already proves this result string
                // is a transport copy of its original assistant bytes. This is
                // confined to the new partial projection, not arbitrary text.
                if (projectionReceipt && material.selector === 'result-text' && material.sourceEntryId === proof.resultEntryId && material.raw === execution.rawFinal) continue;
                groups.set(material.sourceEntryId,[...groups.get(material.sourceEntryId) ?? [],material]);
            }
            for (const [id, materials] of groups) {
                const reads = materials.map(material => {
                    const projected = isSelectedMaterial(material) ? textProjection : undefined;
                    const nativeTextProjection = projected?.region ? projectionReceipt : undefined;
                    // Streamed arguments need their original close. A decoded SDK
                    // formatter input is already a whole serialized object.
                    // Text carriers retain their separate accounting policy.
                    const formatterArguments = intent.data.request.version === 1 &&
                        (material.selector === 'formatter-arguments' && material.complete === true || material.selector.startsWith('decoded-formatter-input:'));
                    const submissionArguments = declaredSubmission && (material.selector === 'submission-arguments' && material.complete === true || material.selector.startsWith('decoded-submission-input:'));
                    const structuredArguments = formatterArguments || submissionArguments;
                    let rejectionEntryId: string | undefined;
                    let read = projected?.read ?? capturedMaterialFindings(material.raw, role, launchData ?? {}, structuredArguments, structuredArguments ? 2 : 1), expanded = false;
                    if (submissionArguments && material.selector === 'submission-arguments' && !material.invalid &&
                        !read.receivedClaimsComplete && !diagnostics.extraction.count && !diagnostics.prefix.count &&
                        execution.nativeCheckpoint?.leafId && launchData?.nativeRoleIntent) {
                        const received = capturedMaterialFindings(material.raw, role, launchData, true, 'received-submission/v1');
                        if (received.receivedClaimsComplete) {
                            try {
                                const original = readReceivedSubmissionArguments(entries, {sessionId:execution.nativeSessionId,launchId,role,
                                    intent:launchData.nativeRoleIntent,checkpointLeafId:execution.nativeCheckpoint.leafId}, material.sourceEntryId);
                                if (hash(original) === hash(material)) read = received;
                            } catch { /* Unproved received bytes retain their completeness hold. */ }
                        }
                    }
                    if (formatterArguments && material.selector === 'formatter-arguments' && selectedProven && !isSelectedMaterial(material) &&
                        !read.receivedClaimsComplete && execution.nativeCheckpoint?.leafId) {
                        try {
                            const rejected = readRejectedFormatterAttempt(entries,{sessionId:execution.nativeSessionId,launchId,role,
                                intent:launchData!.nativeRoleIntent,checkpointLeafId:execution.nativeCheckpoint.leafId},material.sourceEntryId);
                            if (hash(rejected.material) === hash(material)) {
                                rejectionEntryId = rejected.rejectionEntryId;
                                read = capturedMaterialFindings(material.raw,role,launchData ?? {},true,3);
                            }
                        } catch { /* Unknown, foreign or unproved rejected material stays held. */ }
                    }
                    if (submissionArguments && material.selector==='submission-arguments' && selectedProven && !isSelectedMaterial(material) && !read.receivedClaimsComplete && execution.nativeCheckpoint?.leafId) {
                        try {
                            const rejected=readRejectedSubmissionAttempt(entries,{sessionId:execution.nativeSessionId,launchId,role,intent:launchData!.nativeRoleIntent,checkpointLeafId:execution.nativeCheckpoint.leafId},material.sourceEntryId);
                            if (hash(rejected.material)===hash(material)) {rejectionEntryId=rejected.rejectionEntryId;read=capturedMaterialFindings(material.raw,role,launchData??{},true,'rejected-submission/v1');}
                        } catch { /* No original rejected source means no independent-assessment admission. */ }
                    }
                    if (!read.complete && (prefixConflicts.has(null) || prefixConflicts.has(material.sourceEntryId))) read = { ...read, receivedClaimsComplete: false };
                    if (settledPrefixCheckpoint && intent.data.request.version === 1 && material.selector === 'formatter-arguments' &&
                        !prefixConflicts.has(null) && !prefixConflicts.has(material.sourceEntryId) &&
                        settledFormatterPrefixWithoutFindings(material.raw,role)) {
                        try {
                            const source=readTerminatedFormatterPrefix(entries,{sessionId:execution.nativeSessionId,launchId,role,
                                intent:launchData.nativeRoleIntent,checkpointLeafId:settledPrefixCheckpoint},material.sourceEntryId);
                            if (hash(source.material) === hash(material)) read={...read,receivedClaimsComplete:true,roleAttempt:true};
                        } catch { /* Unsupported original source retains its extraction hold. */ }
                    }
                    if (!read.complete) {
                        const decoded = parseCapturedRoleOutput(material.raw, role, launchData ?? {}), flat = capturedRawFindings(material.raw, role, launchData ?? {});
                        if (decoded.value && flat.complete && hash(decoded.value.findings) === hash(flat.findings)) {
                            // Unique closed role decoding proves exact root
                            // locations without enlarging malformed-input bounds.
                            read = {complete:true,receivedClaimsComplete:true,roleAttempt:true,claims:flat.findings.map((finding,index) => ({finding,findingPath:'/findings',memberPath:[{key:'findings',ordinal:0}],index}))};
                            expanded = true;
                        }
                    }
                    return {material,read,expanded,nativeTextProjection,rejectionEntryId,
                        source: (({raw, ...source}) => ({...source, rawSha256: hash(raw), rawUtf8Bytes: Buffer.byteLength(raw)}))(material)};
                });
                const covered = new Set<string>();
                const legacy = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='accounted-intermediate' AND json_extract(data,'$.nativeEntryId')=? AND json_extract(data,'$.accountingKey') IS NULL", launchId, id);
                let legacyValid = true;
                for (const row of legacy) {
                    const metadata = parse(row.data), expectedRaw = materials.length === 1 ? materials[0]!.raw : JSON.stringify({format:'native-material/v1',materials});
                    const previousClaims = materials.flatMap(material => capturedRawFindings(material.raw, role, launchData ?? {}).findings);
                    if (metadata.rawFinalTruncated || metadata.omittedFindingCount || row.raw !== expectedRaw ||
                        hash(metadata.materialSources ?? null) !== hash(reads.map(value => value.source)) ||
                        hash(metadata.harvestedFindings ?? null) !== hash(previousClaims)) { legacyValid = false; break; }
                    const occurrences = this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal', row.id);
                    if (occurrences.length !== previousClaims.length || previousClaims.some((finding, index) => occurrences[index]?.ordinal !== index || occurrences[index]?.work !== work ||
                        parse(occurrences[index].data).launchId !== launchId || parse(occurrences[index].data).role !== role ||
                        hash(parse(occurrences[index].data).finding) !== hash(finding))) { legacyValid = false; break; }
                    for (const value of reads) {
                        const flat = value.read.claims.filter(claim => claim.findingPath === '/findings');
                        const previous = capturedRawFindings(value.material.raw, role, launchData ?? {}), decoded = parseCapturedRoleOutput(value.material.raw, role, launchData ?? {});
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
                for (const {material, read, source, nativeTextProjection, rejectionEntryId} of reads) {
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
                    // A declared JSON-text role can fail with a wrapped or partial
                    // role root. Preserve its bounded literal claims just as for
                    // formatter arguments; this grants no selected-output authority.
                    const formatter = unowned || material.selector === 'formatter-arguments' || material.selector.startsWith('decoded-formatter-input:') || material.selector === 'decoded-result-value' ||
                        declaredSubmission && (material.selector === 'submission-arguments' || material.selector.startsWith('decoded-submission-input:')) ||
                        declaredNarrativeRole && read.roleAttempt && (material.selector.startsWith('assistant-text:') || material.selector === 'stream-text' || material.selector === 'result-text');
                    const literal = formatter ? read.claims : read.claims.filter(claim => claim.findingPath === '/findings');
                    let rootIndex = 0, rootPrefix = true;
                    let claims = literal.filter(claim => {
                        // The legacy flat collector retains only a prefix when a
                        // later array is incomplete. Match direct-root locations
                        // in order; an equal nested value is never covered.
                        if (isSelectedMaterial(material) && claim.findingPath === '/findings' && claim.memberPath.length === 1) {
                            const owned = rootPrefix && rootIndex < flat.findings.length && hash(claim.finding) === hash(flat.findings[rootIndex]);
                            rootIndex++;
                            if (owned) return false;
                            rootPrefix = false;
                        }
                        return !covered.has(hash({source,memberPath:claim.memberPath,index:claim.index}));
                    });
                    // Complete rejected public bytes can require semantic diagnosis even
                    // when their findings member is malformed. Custody supplies no
                    // empty-claims verdict and never validates the role protocol.
                    let materialAssessment: MaterialAssessment | undefined;
                    if (!read.complete && Buffer.byteLength(material.raw)<=128*1024 && Buffer.from(material.raw).toString('utf8')===material.raw) {
                        if (unownedProven) materialAssessment={version:1,source};
                        else if(stoppedSubmissionProofs.has(material.sourceEntryId)) materialAssessment={version:4,source,coveredOutputs:[]};
                        else if (!read.receivedClaimsComplete && rejectionEntryId && !prefixConflicts.has(null) && !prefixConflicts.has(material.sourceEntryId)) {
                            if (!declaredSubmission) materialAssessment={version:2,source,rejectionEntryId,coveredOutputs:[]};
                            else if (material.selector==='submission-arguments' && selectedProven && selected && proof?.kind==='claude-sdk-tool-submission/v1')
                                materialAssessment={version:3,source,rejectionEntryId,coveredOutputs:[],selected:{nativeEntryId:selected,source:proof,rawSha256:hash(execution.rawFinal)}};
                        }
                    }
                    if (materialAssessment?.version===2||materialAssessment?.version===3||materialAssessment?.version===4) {
                        const prior=this.literalMaterialCoverage(work,this.s.one('SELECT * FROM role_launches WHERE id=?',launchId),material.raw,source,read.claims);
                        materialAssessment.coveredOutputs=prior.references;
                        claims=claims.filter(({finding,...location})=>!prior.byLocation.has(hash(location)));
                    }
                    if (formatter && !read.receivedClaimsComplete && !materialAssessment) {
                        extractionIssueCount++;
                        if (extractionIssues.length < 64) extractionIssues.push({entryId:id,reason:declaredSubmission&&(material.selector==='submission-arguments'||material.selector.startsWith('decoded-submission-input:'))?'Original submission envelope or literal findings are incomplete or unsupported':'Original formatter envelope or literal findings are incomplete or unsupported'});
                    }
                    const locations = claims.map(({finding,...location}) => location);
                    sources.push({id,raw:material.raw,findings:claims.map(claim=>claim.finding),
                        materialSources:locations.length ? locations.map(location=>({...source,...location})) : [source],
                        accountingKey:nativeTextProjection ? hash({source,locations,nativeTextProjection}) : materialAssessmentKey(source,locations,materialAssessment),retainEmpty:formatter && !read.complete,...(nativeTextProjection?{nativeTextProjection}:{}),...(materialAssessment ? {materialAssessment} : {})});
                }
            }
        } else for (const entry of entries) {
            if (entry.type!=='message' || entry.message.role!=='assistant' || entry.id===selected) continue;
            const raw = typeof entry.message.content==='string'?entry.message.content:entry.message.content.filter((item:any)=>item.type==='text').map((item:any)=>item.text).join('\n');
            sources.push({id:entry.id,raw,findings:capturedRawFindings(raw, role, launchData ?? {}).findings});
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
                ...(entry.materialSources ? {materialSources:entry.materialSources} : {}), ...(entry.accountingKey ? {accountingKey:entry.accountingKey} : {}), ...(entry.materialAssessment ? {materialAssessment:entry.materialAssessment} : {}), ...(entry.nativeTextProjection?{nativeTextProjection:entry.nativeTextProjection}:{}) }, false, true);
        }
        return extractionIssueCount === 0;
    }

    private async nativeEntries(runId: string) {
        const run = this.s.one('SELECT data FROM runs WHERE id=?', runId), data = parse(run.data);
        if (!data.historyRef)
            return [];
        const snapshot = await readNativeHistorySnapshot(data.historyRef, data.nativeCheckpoint);
        if (snapshot.checkpoint.sessionId !== data.nativeSessionId)
            throw new Error('Native harvested session identity changed');
        return expandNativeTransport(snapshot.entries);
    }
    private async role(options: ChangeOperation, role: Role, context: Record<string, unknown> = {}, writable = false, assertPrefix?: () => void) {
        context = { ...context, sourceScopeInput: Object.hasOwn(context, 'sourceScopeInput') ? structuredClone(context.sourceScopeInput) : { version: 2 } };
        const scopeVersion = sourceScopeVersion(context);
        const checkRecoveryHash=hash(context.checkOutputRecovery??null);
        const scopeDiagnosticHash = hash(context.scopeDiagnostic ?? null);
        assertSupportedRoleProfile(context);
        reviewResolutionInput(role, context);
        if (role === 'adjudicator' && context.stage === 'review-adjudication') context = { ...context, reviewResolutionInput: { version: 4 }, subjectActionsInput: Object.hasOwn(context, 'subjectActionsInput') ? context.subjectActionsInput : { version: 2 } };
        const literalSubjectActions = (context.subjectActionsInput as any)?.version === 2;
        const reviewResolution = reviewResolutionInput(role, context);
        const planningRepair = planningRepairProfile(role,context);
        if (planningRepair) context = {...context,planningRepair};
        const scopeAmendment = scopeAmendmentProfile(role, context);
        if (scopeAmendment) context = { ...context, scopeAmendment };
        const scopeEvidenceHash = hash([context.scopeReplanEvidence ?? null, context.scopeReplanOriginalPlan ?? null]);
        const assertScopeAmendment = (receiver: Record<string, unknown>) => {
            if (hash(scopeAmendmentProfile(role, receiver) ?? null) !== hash(scopeAmendment ?? null) ||
                hash([receiver.scopeReplanEvidence ?? null, receiver.scopeReplanOriginalPlan ?? null]) !== scopeEvidenceHash)
                throw Error('Original scope amendment declaration changed');
        };
        const sourceFitReceiver = sourceFitInput(role, context);
        // Request source-qualified classification on normal replanning. The
        // captured tuple is a prerequisite, never proof of candidate reuse.
        let assertRetainedPlanningSource = () => {};
        if (role === 'adjudicator' && context.stage === 'planning-adjudication' && !Object.hasOwn(context,'decisionCarryInput')) {
            const selected = this.row(options.workId);
            const identity = () => {
                const now = this.row(options.workId);
                return hash([now.base,now.candidate,
                    this.s.one('SELECT * FROM change_versions WHERE id=?',selected.base),
                    selected.candidate ? this.s.one('SELECT * FROM change_versions WHERE id=?',selected.candidate) : null]);
            };
            const captured = identity();
            assertRetainedPlanningSource = () => {
                if (identity() !== captured) throw Error('Original retained planning BASE or candidate changed');
            };
            if (selected.candidate) {
                const base = this.version(selected.base), candidate = this.version(selected.candidate);
                if ([base,candidate].some(version => version.work !== options.workId || typeof version.artifact !== 'string' ||
                    !path.isAbsolute(version.artifact) || typeof version.hash !== 'string' || !/^[a-f0-9]{64}$/.test(version.hash)) || base.kind !== 'base' || candidate.kind !== 'candidate')
                    throw Error('Retained planning source requires owned immutable BASE and candidate versions');
                if (base.hash !== candidate.hash) {
                    context = {...context,decisionCarryInput:{version:3}};
                }
            }
        }
        const carryRequested=Object.hasOwn(context,'decisionCarryInput'),carryDeclaration=hash(context.decisionCarryInput??null),carryStage=context.stage;
        if (carryRequested) context={...context,decisionCarryInput:structuredClone(context.decisionCarryInput)};
        const assertCarryReceiver = (value:Record<string,unknown>) => {
            if (sourceScopeVersion(value) !== scopeVersion) throw Error('Original source scope declaration changed');
            assertRetainedPlanningSource();
            if (Object.hasOwn(value,'decisionCarryInput')!==carryRequested || hash(value.decisionCarryInput??null)!==carryDeclaration || carryRequested&&value.stage!==carryStage)
                throw Error('Original implementation carry declaration changed');
        };
        options = this.captureOperation(options);

        if (role === 'adjudicator' && context.stage === 'planning-adjudication') context = { ...context, decisionCarry: { version: 2 }, dispositionHistoryInput: { version: 1, id: randomUUID() }, historicalPlansInput: { version: 4, id: randomUUID() } };
        if (role === 'adjudicator' && context.stage === 'review-adjudication') context = { ...context, ...(!literalSubjectActions ? {metadataIdentityInput:{version:2}} : {}), dispositionHistoryInput: { version: 2, id: randomUUID() }, historicalPlansInput: { version: 3, id: randomUUID() } };
        if (role === 'adjudicator' && (context.stage === 'planning-adjudication' || context.stage === 'review-adjudication'))
            context = {...context,findingBodyInput:Object.hasOwn(context,'findingBodyInput')?context.findingBodyInput:{version:context.stage==='planning-adjudication'?5:6},latestDispositionInput:{version:1},historicalRequirementsInput:{version:1},historicalProvenanceInput:{version:context.stage==='planning-adjudication'?2:1,id:randomUUID()}};
        if ((role === 'planner' && context.stage === 'planning' || role === 'challenger' && context.stage === 'planning-challenge') &&
            !Object.hasOwn(context,'findingBodyInput')) context = {...context,findingBodyInput:{version:4}};
        const criteriaVersion = freshCriteriaDeliveryVersion(role, context.stage);
        if (criteriaVersion)
            context = {...context,workflowCriteriaInput:{version:criteriaVersion,id:randomUUID()}};
        if (!literalSubjectActions && ['planning','planning-challenge','planning-adjudication'].includes(String(context.stage))) {
            const planningJudge = role === 'adjudicator' && context.stage === 'planning-adjudication';
            context = {...context,metadataIdentityInput:planningJudge && Object.hasOwn(context,'metadataIdentityInput') ? context.metadataIdentityInput : {version:planningJudge?4:1}};
        }
        if (Object.hasOwn(context,'subjectActionsInput')) {
            if (!literalSubjectActions) context = {...context,metadataIdentityInput:{version:3}};
            subjectActionInputVersion(role,context);
        }
        const metadataDeclared = Object.hasOwn(context,'metadataIdentityInput'), metadataStage = context.stage;
        if (metadataDeclared) context = {...context,metadataIdentityInput:structuredClone(context.metadataIdentityInput)};
        const metadataDeclaration = hash(context.metadataIdentityInput ?? null);
        const assertMetadataDeclaration = (value:Record<string,unknown> = context) => {
            if (Object.hasOwn(value,'metadataIdentityInput') !== metadataDeclared || hash(value.metadataIdentityInput ?? null) !== metadataDeclaration ||
                metadataDeclared && value.stage !== metadataStage) throw Error('Original metadata identity declaration changed');
        };
        const findingDeclared = Object.hasOwn(context,'findingBodyInput'), findingStage = context.stage;
        if (findingDeclared) context = {...context,findingBodyInput:structuredClone(context.findingBodyInput)};
        const findingDeclaration = hash(context.findingBodyInput ?? null);
        const assertFindingDeclaration = (value:Record<string,unknown> = context) => {
            if (Object.hasOwn(value,'findingBodyInput') !== findingDeclared || hash(value.findingBodyInput ?? null) !== findingDeclaration ||
                findingDeclared && value.stage !== findingStage) throw Error('Original finding body declaration changed');
        };

        this.guard(options.workId);
        if (writable || role === 'implementer' || role === 'repairer') this.assertEditingVerification(options.workId);
        const assertSourceFit = () => {
            if (writable && this.h.sourceImpacts(options.workId).some(input => input.data.effectHold))
                throw new Error('New source input requires independent source-fit decision before candidate writes');
        };
        assertSourceFit();
        this.assertAvailableAllowance(options.workId, role, context.stage);
        const selection = await this.selectRoleModel(options, role);
        if (hash(reviewResolutionInput(role, context) ?? null) !== hash(reviewResolution ?? null)) throw Error('Original review resolution declaration changed');
        if (hash(sourceFitInput(role, context) ?? null) !== hash(sourceFitReceiver ?? null)) throw Error('Original source-fit declaration changed');
        if (hash(planningRepairProfile(role,context) ?? null) !== hash(planningRepair ?? null)) throw Error('Original planning repair declaration changed');
        assertScopeAmendment(context);
        assertCarryReceiver(context);
        assertMetadataDeclaration();
        assertFindingDeclaration();
        selection.assertCurrent();
        let model = selection.model;
        if (model.bridge || model.bridgeProfile) {
            const { admitOwnedClaudeSelection } = await import('../pi/claude-host.js');
            model = admitOwnedClaudeSelection(model);
        }
        const r = this.row(options.workId), input = this.version(r.candidate ?? r.base), project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(options.workId).project), staging = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        assertSourceFit();
        const { bundle: inputBundle, evidence, assertCurrent: assertInputCurrent } = await this.bundle(options.workId, context, role, model);
        assertScopeAmendment(inputBundle.context);
        const sourceFitReferenceCapture = sourceFitReferencesInput(role, inputBundle.context);
        const sourceFitSourceIds = sourceFitReferenceCapture ? readRequirementSourceIds(inputBundle.context) : undefined;
        if (sourceFitReferenceCapture) context = {...context, sourceFitReferences: sourceFitReferenceCapture, requirementSourceIds: sourceFitSourceIds};
        assertCarryReceiver(context);assertCarryReceiver(inputBundle.context);
        assertMetadataDeclaration();assertMetadataDeclaration(inputBundle.context);
        assertFindingDeclaration();assertFindingDeclaration(inputBundle.context);
        if (hash(sourceFitInput(role, inputBundle.context) ?? null) !== hash(sourceFitReceiver ?? null)) throw Error('Original source-fit receiver changed before reservation');
        if (Object.hasOwn(context,'decisionCarryInput')) context = {...context,decisionCarry:inputBundle.context.decisionCarry};
        const inputEvidenceManifests = roleInputEvidenceManifests(inputBundle.context);
        if (inputEvidenceManifests.some(manifest=>manifest.workId!==options.workId || manifest.epoch!==this.work(options.workId).epoch || manifest.role!==role || manifest.stage!==context.stage))
            throw Error('Original role evidence receiver changed before reservation');
        const compositeInput = (context: Record<string,unknown>) => {
            const rows=context.verificationReviewRequirements as StrategyWitness[]|undefined;
            const parts=rows?.filter(row=>row.kind==='all-of');
            return parts?.length ? hash({parts,evidence:context.verificationEvidence}) : undefined;
        };
        const compositeInputHash=compositeInput(inputBundle.context);
        const planningFeedback = (context: Record<string, unknown>) => hash([
            context.priorPlanningFailure ?? null, context.currentPlanningDiagnostics ?? null,
            // Preserve the historical two-operand recipe when this prospective feedback is absent.
            ...(Object.hasOwn(context, 'currentProposalDiagnostics') ? [context.currentProposalDiagnostics] : []),
        ]);
        const planningFeedbackHash = planningFeedback(inputBundle.context);
        const workflowCriteriaHash = inputBundle.context.workflowCriteria ? hash({view:inputBundle.context.workflowCriteria,operating:inputBundle.contracts,refresh:inputBundle.context.criteriaRefresh}) : undefined;
        const planningRequirementsHash = hash(inputBundle.requirements);
        const planningDomainHash = planningDomainFootprint(role, inputBundle.context, planningRequirementsHash, inputBundle.context.planVersion);
        const metadataIdentityHash = metadataIdentityFootprint(role,inputBundle.context);
        const subjectActionHash = subjectActionFootprint(role,inputBundle.context);
        const findingBodyHash = findingBodyFootprint(inputBundle.context,role);
        const latestDispositionHash = latestDispositionFootprint(inputBundle.context,role);
        const historicalInputHash = historicalPlanInputId(context) || historicalRequirementsInput(role,context) || historicalProvenanceInputId(context) ? hash(inputBundle.context.historicalPlanningOperands ?? null) : undefined;
        assertInputCurrent();
        const decisionReferences = adjudicationDecisionReferences(role, inputBundle.context);
        const planningSubjects = role === 'adjudicator' && context.stage === 'planning-adjudication' && decisionReferences
            ? () => hash(decisionReferences.occurrenceIds.map(id => [
                this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?', id, options.workId),
                this.s.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid', id),
                this.s.one('SELECT * FROM obligations WHERE id=? AND work=?', id, options.workId),
            ])) : undefined;
        const planningSubjectsHash = planningSubjects?.();

        assertPrefix?.();
        this.guard(options.workId);
        selection.assertCurrent();
        this.assertReviewEvidence(options.workId, inputBundle.context.selectedReviewEvidence);
        const verificationInputBinding = inputBundle.context.verificationReviewRequirements !== undefined
            ? this.verificationInputBinding(options.workId, String(context.stage), context.reviewKey, inputBundle.context.verificationReviewRequirements as { requirementId: string; strategyDigest: string; witnessIds: string[] }[]) : undefined;
        const bounds = this.roleBounds();
        const a = this.reserve(options.workId, role, { ...context, ...(planningDomainHash ? { planningDomainHash, planningRequirementsHash } : {}), ...(subjectActionHash?{subjectActionCaptureHash:subjectActionHash,subjectActionsProfile:inputBundle.context.subjectActionsProfile,subjectActionsView:inputBundle.context.subjectActionsView,occurrences:inputBundle.context.occurrences}:{}), ...(findingBodyHash?{findingBodyHash}:{}), ...(latestDispositionHash?{latestDispositionHash,latestDispositionView:inputBundle.context.latestDispositionView??null}:{}), ...(metadataIdentityHash?{metadataIdentityHash}:{}), ...(workflowCriteriaHash?{workflowCriteriaHash,workflowCriteria:inputBundle.context.workflowCriteria}:{}), inputEvidenceManifests, ...(historicalInputHash ? { historicalInputHash } : {}), ...(decisionReferences ? { decisionReferences } : {}), ...(inputBundle.context.dispositionHistory ? { dispositionHistory: inputBundle.context.dispositionHistory } : {}), ...(inputBundle.context.planningVerificationProfile ? { planningVerificationProfile: inputBundle.context.planningVerificationProfile } : {}), ...(verificationInputBinding ? { verificationInputBinding } : {}), ...(compositeInputHash?{compositeInputHash}:{}), modelMode: selection.mode, modelIdentity: hash(modelConfigurationIdentity(model)), bounds }, staging), handle = this.operations.get(options.workId)!.handle;
        if (context.stage === 'raw-assessment') this.operations.get(options.workId)!.rawAssessmentActor = a.launchId;
        const assertCapturedInput = () => {
            const captured = parse(this.s.one('SELECT data FROM role_launches WHERE id=?', a.launchId).data);
            if (hash(captured.diagnosisEligibility ?? null) !== hash(inputBundle.context.diagnosisEligibility ?? null))
                throw Error('Original diagnosis eligibility changed after capture');
            if ([context,inputBundle.context,captured].some(value=>hash(value.checkOutputRecovery??null)!==checkRecoveryHash)) throw Error('Original check-output recovery assignment changed');
            if ([context,inputBundle.context,captured].some(value=>hash(value.scopeDiagnostic ?? null)!==scopeDiagnosticHash)) throw Error('Original scope diagnostic changed');
            if (compositeInputHash && (compositeInput(inputBundle.context)!==compositeInputHash || captured.compositeInputHash!==compositeInputHash)) throw Error('Original composite verification parts changed after capture');
            if (planningFeedback(inputBundle.context) !== planningFeedbackHash || planningFeedback(captured) !== planningFeedbackHash) throw Error('Original planning feedback changed after capture');
            if (planningDomainFootprint(role, inputBundle.context, hash(inputBundle.requirements), inputBundle.context.planVersion) !== planningDomainHash ||
                planningDomainFootprint(role, captured, captured.planningRequirementsHash, captured.inputVersions?.plan) !== planningDomainHash ||
                planningDomainHash !== undefined && captured.planningDomainHash !== planningDomainHash)
                throw Error('Original planning domain presentation changed after capture');
            if (hash(reviewResolutionInput(role, captured) ?? null) !== hash(reviewResolution ?? null) ||
                hash(reviewResolutionInput(role, inputBundle.context) ?? null) !== hash(reviewResolution ?? null))
                throw Error('Original review resolution capture changed');
            if (hash(sourceFitInput(role, captured) ?? null) !== hash(sourceFitReceiver ?? null) ||
                hash(sourceFitInput(role, inputBundle.context) ?? null) !== hash(sourceFitReceiver ?? null))
                throw Error('Original source-fit capture changed');
            if ([context, inputBundle.context, captured].some(value => hash(sourceFitReferencesInput(role, value) ?? null) !== hash(sourceFitReferenceCapture ?? null)))
                throw Error('Original source-fit requirement references changed');
            if (sourceFitReferenceCapture && [context, inputBundle.context, captured].some(value => hash(readRequirementSourceIds(value) ?? null) !== hash(sourceFitSourceIds ?? null)))
                throw Error('Original source-fit requirement source domain changed');
            assertCarryReceiver(captured);assertCarryReceiver(inputBundle.context);
            assertMetadataDeclaration();assertMetadataDeclaration(captured);assertMetadataDeclaration(inputBundle.context);
            assertFindingDeclaration();assertFindingDeclaration(captured);assertFindingDeclaration(inputBundle.context);
            if (hash(planningDecisionCarry(role,captured)??null)!==hash(planningDecisionCarry(role,inputBundle.context)??null) ||
                hash(captured.decisionCarryInput??null)!==hash(inputBundle.context.decisionCarryInput??null))
                throw Error('Original implementation carry recipe changed after capture');
            if (hash(planningRepairProfile(role,captured) ?? null) !== hash(planningRepair ?? null) || hash(planningRepairProfile(role,inputBundle.context) ?? null) !== hash(planningRepair ?? null))
                throw Error('Original planning repair recipe changed after capture');
            assertScopeAmendment(context);
            assertScopeAmendment(captured);
            assertScopeAmendment(inputBundle.context);
            if (subjectActionFootprint(role,inputBundle.context) !== subjectActionHash || subjectActionFootprint(role,captured) !== subjectActionHash ||
                captured.subjectActionCaptureHash !== subjectActionHash || hash(captured.subjectActionsInput??null) !== hash(inputBundle.context.subjectActionsInput??null))
                throw Error('Original subject action recipe changed after preparation');
            if (context.stage === 'raw-assessment' && hash(captured.rawAssessment) !== hash(inputBundle.context.rawAssessment)) throw Error('Original raw assessment target changed after capture');
            if (hash(metadataIdentityInput(role,captured) ?? null) !== hash(metadataIdentityInput(role,inputBundle.context) ?? null) ||
                metadataIdentityFootprint(role,inputBundle.context) !== metadataIdentityHash || captured.metadataIdentityHash !== metadataIdentityHash)
                throw Error('Original metadata identity capture changed after preparation');
            if (latestDispositionFootprint(inputBundle.context,role) !== latestDispositionHash || captured.latestDispositionHash !== latestDispositionHash || latestDispositionHash && hash(captured.latestDispositionView ?? null) !== hash(inputBundle.context.latestDispositionView ?? null) || hash(captured.latestDispositionInput ?? null) !== hash(inputBundle.context.latestDispositionInput ?? null)) throw Error('Original latest disposition delivery changed after preparation');
            if (findingBodyFootprint(inputBundle.context,role) !== findingBodyHash || captured.findingBodyHash !== findingBodyHash || hash(captured.findingBodyInput ?? null) !== hash(inputBundle.context.findingBodyInput ?? null)) throw Error('Original finding bodies changed after preparation');
            if (workflowCriteriaHash && (captured.workflowCriteriaHash !== workflowCriteriaHash || hash(captured.workflowCriteria) !== hash(inputBundle.context.workflowCriteria) ||
                hash(workflowCriteriaManifest(captured)) !== hash(workflowCriteriaManifest(inputBundle.context)) ||
                hash({view:inputBundle.context.workflowCriteria,operating:inputBundle.contracts,refresh:inputBundle.context.criteriaRefresh}) !== workflowCriteriaHash))
                throw Error('Original workflow criteria delivery changed after capture');
            if (hash(adjudicationDecisionReferences(role, inputBundle.context) ?? null) !== hash(decisionReferences ?? null) ||
                hash(adjudicationDecisionReferences(role, captured) ?? null) !== hash(decisionReferences ?? null))
                throw Error('Original role decision references changed after capture');

            for (const key of ['dispositionHistoryInput','historicalPlansInput','dispositionHistory','historicalRequirementsInput','historicalProvenanceInput'])
                if (hash(captured[key] ?? null) !== hash(inputBundle.context[key] ?? null)) throw Error('Original role input evidence declaration changed after capture');
            if (hash(roleInputEvidenceManifests(inputBundle.context)) !== hash(inputEvidenceManifests) ||
                hash(captured.inputEvidenceManifests) !== hash(inputEvidenceManifests) ||
                historicalInputHash && (hash(inputBundle.context.historicalPlanningOperands ?? null) !== historicalInputHash || captured.historicalInputHash !== historicalInputHash))
                throw Error('Original role input evidence changed after capture');
        };
        const assertRoleCapture = () => { this.h.entry(a.runId); assertCapturedInput(); if (writable || context.stage === 'raw-assessment' || context.currentPlanningDiagnostics !== undefined || context.currentProposalDiagnostics !== undefined) assertPrefix?.(); };
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
            identity = this.h.allocateRole({ workId: options.workId, runId: a.runId, launchId: a.launchId, role, stage: context.stage, ...(typeof context.purpose === 'string' ? { purpose: context.purpose } : typeof context.reviewKey === 'string' ? { purpose: context.reviewKey } : {}) });
            if (captureScope)
                this.captureInputScope(options.workId, a.launchId, inputBundle);
            if (role === 'adjudicator' && ['planning-adjudication', 'review-adjudication','raw-assessment'].includes(String(context.stage)))
                await this.captureDiagnosticInput(options.workId, a.launchId, inputBundle);
            assertRoleCapture();

            lease = await this.h.acquireCapacity({ workId: options.workId, runId: a.runId, epoch: this.work(options.workId).epoch, kind: 'role', signal: handle.abort.signal });
            assertRoleCapture();
            this.h.patchRun(a.runId, 'CAPTURING', { sourceInputHash: hash(this.h.sourceImpacts(options.workId).map(i => [i.input_id, i.revision, i.source])) });
            const copied = await materialize(input.artifact, staging, parse(project.profile), input.hash, handle.abort.signal);
            this.h.patchRun(a.runId, 'CAPTURED', { manifest: copied.manifest, attainedCapture: true });
            const protectedPaths = await scopeProtection(this.s, a.runId, staging);
            scope = await createScope({ ...a.runtimeProfile!, workRoot: staging, stateRoot: path.join(this.h.state, 'runtime'), workId: options.workId, runId: a.runId, protectedPaths, readOnlyWork: !writable, signal: handle.abort.signal }, () => {
                this.h.entry(a.runId);
                this.h.patchRun(a.runId, 'RUNTIME_CREATING', {});
                runtimeAttempted = true;
            });
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
        lease?.release({ cleanup, settled: true });
        if (identity)
            this.h.nativeCleanup(identity, { cleanup, settled: true });
        delete handle.scope;
        if (cleanup.startsWith('quarantined'))
            this.s.setWorkStateAt(options.workId, 'UNKNOWN', a.epoch, a.generation);
        if (!usable)
            throw new ControllerError('ROLE_UNAVAILABLE', execution!.issues.join('; ') || cleanup, `Inspect role ${a.launchId}; explicit charged retry`, options.workId, a.runId);
        return { launchId: a.launchId, runId: a.runId, output, protocol: execution!.protocol!, staging, execution: execution!, assertInputCurrent:()=>{
            assertCapturedInput();
            if (planningSubjects) {
                this.assertRetainedDispositions(options.workId, a.launchId, execution!.protocol!);
                if (planningSubjects() !== planningSubjectsHash) throw Error('Original planning decision subjects changed after capture');
            }
            assertInputCurrent();assertPrefix?.();
        },
            inputScope: captureScope ? this.inputScopeReceipt(options.workId, a.launchId, output, role, String(context.stage), execution!.selectedFinalEntryId) : null };
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
            this.s.setWorkStateAt(run.work, 'INTERRUPTED', run.epoch, run.generation);
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
        const bundle = structuredClone(options.inputBundle), runId = randomUUID(), launchId = randomUUID(), bounds = this.roleBounds();
        const staging = path.join(this.h.options.installationHome, 'control', 'publication', launchId), handle: Handle = { abort: new AbortController() };
        const role = 'adjudicator' as const;
        if (model?.bridge || model?.bridgeProfile) assertNativeResponseSchema(nativeRoleFraming(role,bundle,launchId,nativeRoleTurnLimit(bounds.maxProviderRequests),undefined,bounds.maxProviderRequests).intent);
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
            try {
                lease?.release({ cleanup: 'unbound', settled: true });
                if (identity)
                    this.h.nativeCleanup(identity, { cleanup: 'unbound', settled: true });
            } finally {
                options.signal?.removeEventListener('abort', stop);
                this.h.unregister(work.id);
            }
        }
        return { launchId, runId, output, usable, admitted, protocol: execution!.protocol, issues: execution!.issues };
    }
    /** Existing records and physical source identities, never a worker assertion. */
    private baseClassificationFence(work: string, proposal: ImplementationCarry, judge: string): string | null {
        try {
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',proposal.occurrenceId,work);
            const origin = occurrence && this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',parse(occurrence.data).launchId,work);
            const adjudicator = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',judge,work);
            const output = occurrence && this.s.one('SELECT * FROM role_outputs WHERE id=?',occurrence.output);
            const judged = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge);
            const base = this.version(proposal.baselineVersion);
            if (!occurrence || !origin || !adjudicator || !output || judged.length!==1 || base.work!==work || base.kind!=='base' || !proposal.baseSourceIds?.length) return null;
            const runs = [origin,adjudicator].map(launch=>this.s.one('SELECT * FROM runs WHERE id=?',launch.run));
            if (runs.some(run=>!run||run.work!==work)) return null;
            const histories = runs.map(run=>this.materialHistoryIdentity(parse(run.data).historyRef));
            const files = proposal.baseSourceIds.map(id=>{
                const matches = base.data.manifest.files.filter((file:any)=>id===`base:${file.path}`);
                if (matches.length!==1) return null;
                return this.materialHistoryIdentity(safePath(base.artifact,matches[0].path));
            });
            if ([...histories,...files].some(identity=>identity===null)) return null;
            const capture = (launch:any) => { const {materialAccounting,...data}=parse(launch.data); return {...launch,data}; };
            return hash({occurrence,origin:capture(origin),adjudicator:capture(adjudicator),output,judged,runs,base,histories,files});
        } catch { return null; }
    }
    /** Authenticate raw claim and CURRENT independent judge's BASE input before effects. */
    private async prevalidateBaseClassifications(work: string, judge: string, protocol: RoleResult) {
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',judge,work), metadata=launch&&parse(launch.data);
        const format = metadata && planningDecisionCarry('adjudicator',metadata);
        const proofs = new Map<string,BaseClassificationProof>();
        if (format?.version!==3) return proofs;
        const proposals = implementationCarryProposals(protocol,format);
        if (!proposals.length) return proofs;
        const snapshots = new Map(proposals.map(proposal=>[proposal.occurrenceId,this.baseClassificationFence(work,proposal,judge)]));
        const assertCurrent = () => {
            for (const proposal of proposals) if (!snapshots.get(proposal.occurrenceId) || this.baseClassificationFence(work,proposal,judge)!==snapshots.get(proposal.occurrenceId))
                throw Error('Original BASE classification operands changed or unavailable');
        };
        assertCurrent();
        const judged = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge);
        if (judged.length!==1) throw Error('BASE classification needs one actual independent judgment');
        const j = await this.historicalPlanningProducer(work,judged[0].id);
        assertCurrent();j.assertCurrent();
        if (hash(originalPlanningProtocol(j.output,j.ld))!==hash(protocol) || j.launch.role!=='adjudicator' || j.ld.stage!=='planning-adjudication' || j.launch.status!=='COMPLETE')
            throw Error('BASE classification lost its exact completed independent judgment');
        const base = this.version(format.baselineVersion), ids=[...new Set(proposals.flatMap(proposal=>proposal.baseSourceIds??[]))];
        const selectedPaths = ids.map(id=>{
            const source = j.witness.initialView.sources.find(source=>source.id===id);
            if (!source || source.side!=='base' || source.version!==base.id || !source.exposeInPrompt || source.id!==`base:${source.path}`)
                throw Error('BASE classification source is not original inline BASE');
            safePath(base.artifact,source.path);
            return source.path;
        });
        const text = await sources(base,'base',selectedPaths,true);
        assertCurrent();j.assertCurrent();
        const qualified = new Map(ids.map(id=>{
            const source = j.witness.initialView.sources.find(source=>source.id===id)!, content=text.find(source=>source.id===id);
            if (!content) throw Error('BASE classification bytes unavailable');
            return [id,qualifyInitialInlineBaseSource({workId:work,role:'adjudicator',originalBaseVersion:j.ld.inputVersions.base,
                initialText:j.initialText,initialTextSha256:j.witness.initialView.textSha256,source,
                base:{...base,manifest:base.data.manifest},sourceText:content.content})] as const;
        }));
        const origins = new Map<string,Awaited<ReturnType<ChangeCore['historicalPlanningProducer']>>>();
        for (const proposal of proposals) {
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',proposal.occurrenceId,work);
            if (!occurrence) throw Error('BASE classification original claim missing');
            if (!origins.has(occurrence.output)) origins.set(occurrence.output,await this.historicalPlanningProducer(work,occurrence.output));
            assertCurrent();j.assertCurrent();for (const original of origins.values()) original.assertCurrent();
            const original=origins.get(occurrence.output)!,data=parse(occurrence.data);
            const claims=original.receivedFindings??capturedRawFindings(original.output.raw,original.launch.role,original.ld).findings;
            if (original.launch.id===judge || original.launch.id!==data.launchId || original.ld.inputVersions.base!==base.id ||
                !Number.isSafeInteger(occurrence.ordinal) || claims[occurrence.ordinal]===undefined || hash(claims[occurrence.ordinal])!==hash(data.finding))
                throw Error('BASE classification does not bind the exact independent original claim');
            const bindings=proposal.baseSourceIds!.map(id=>qualified.get(id)!);
            proofs.set(proposal.occurrenceId,{version:1,sources:bindings,fingerprint:hash([snapshots.get(proposal.occurrenceId),bindings])});
        }
        assertCurrent();j.assertCurrent();for (const original of origins.values()) original.assertCurrent();
        return proofs;
    }
    /** Resolve only immutable initial-BASE meaning; optional raw extras remain untrusted. */
    private resolveImplementationCarry(work: string, proposal: ImplementationCarry, plan: PlanProposal, judge: string, basis?: BaseClassificationProof) {
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
        const format = planningDecisionCarry('adjudicator',judgment), qualified = format?.version===3;
        if (qualified && (!basis || basis.version!==1 || !proposal.baseSourceIds?.length ||
            hash(basis.sources.map(source=>source.sourceId))!==hash(proposal.baseSourceIds) ||
            basis.sources.some(source=>source.baseVersion!==r.base || source.workId!==work) ||
            basis.fingerprint!==hash([this.baseClassificationFence(work,proposal,judge),basis.sources])))
            throw Error('Implementation carry requires its prevalidated current BASE classification source proof');
        const stages: Record<string, string> = { planner: 'planning', challenger: 'planning-challenge', adjudicator: 'planning-adjudication' };
        if ((!qualified && (!stages[origin.role] || input.stage !== stages[origin.role] || input.inputVersions?.candidate !== null)) ||
            !input.inputVersions.base || judgment.stage !== 'planning-adjudication' || judgment.inputVersions?.base !== r.base ||
            judgment.inputVersions?.contracts !== r.data.contractsVersion) {
            const reason = !stages[origin.role] || input.stage !== stages[origin.role]
                ? `origin ${origin.id} has unsupported role/stage ${JSON.stringify([origin.role, input.stage])}`
                : input.inputVersions?.candidate !== null || !input.inputVersions.base
                ? `origin ${origin.id} is not an initial BASE execution (candidate=${JSON.stringify(input.inputVersions?.candidate === undefined ? 'unavailable' : input.inputVersions.candidate)}, base=${JSON.stringify(input.inputVersions?.base === undefined ? 'unavailable' : input.inputVersions.base)})`
                : `judge ${judge} does not bind the current planning stage, BASE and contracts`;
            throw new Error(`Implementation carry requires bound initial BASE and current planning judgment: occurrence ${proposal.occurrenceId}; ${reason}. No carry was accepted; obtain a supported independent disposition or retain the hold.`);
        }
        const baseline = this.version(proposal.baselineVersion);
        if (baseline.work !== work || baseline.kind !== 'base' || baseline.id !== input.inputVersions.base || baseline.id !== r.base)
            throw new Error('Implementation carry baseline is foreign, stale or not the actual origin BASE');
        const strategies = plan.verification.strategies;
        const repairConsumer = (id: string) => plan.verification.checks.some(check => check.guaranteeIds.includes(id) &&
            (!strategies || strategies.flatMap(verificationStrategyLeaves).some(strategy => strategy.requirementId === id && strategy.kind === 'consumer-cases' && strategy.checkIds.includes(check.id))));
        const display = (id: string) => JSON.stringify(id.slice(0, 96)) + (id.length > 96 ? ' [truncated]' : '');
        const refuseMapping = (reason: string): never => {
            throw new Error(`Implementation carry needs explicit current requirement mapping and actual planned coverage: occurrence ${display(proposal.occurrenceId)}; ${reason}. ` +
                'Map only genuinely relevant repaired requirements, not every plan requirement; adding unrelated IDs supplies no semantic repair proof. ' +
                'An objection only to proposed plan or declared-case data is not a BASE implementation defect. Obtain a supported independent disposition or retain the hold; no carry was accepted. ' +
                'A retained judgment is not an adopted plan or accepted remedy; do not rewrite its historical row.');
        };
        if (!proposal.requirementIds.length)
            refuseMapping('requirementIds must be nonempty');
        const duplicate = proposal.requirementIds.find((id, index, ids) => ids.indexOf(id) !== index);
        if (duplicate !== undefined)
            refuseMapping(`duplicate mapped requirement ${display(duplicate)}`);
        for (const id of proposal.requirementIds) {
            if (!plan.requirements.some(requirement => requirement.id === id))
                refuseMapping(`unknown current requirement ${display(id)}`);
            if (strategies ? !strategies.some(strategy => strategy.requirementId === id) : !repairConsumer(id))
                refuseMapping(`mapped requirement ${display(id)} has no ${strategies ? 'verification strategy' : 'consumer check'}`);
        }
        if (strategies && !proposal.requirementIds.some(repairConsumer)) {
            const mapped = proposal.requirementIds.slice(0, 8).map(display).join(', ') + (proposal.requirementIds.length > 8 ? ', [additional IDs omitted]' : '');
            refuseMapping(`no mapped requirement has a candidate consumer check (mapped: ${mapped}); BASE observation and scope duties alone cannot establish code repair`);
        }
        const coverage = coverageIssue(plan);
        if (coverage)
            refuseMapping(`plan coverage is incomplete: ${coverage.slice(0, 512)}${coverage.length > 512 ? ' [truncated]' : ''}`);
        if (!proposal.reason.trim())
            throw new Error('Implementation carry needs independent mapping and remedy rationale');
        return { ...proposal, historicalRequirementId: data.finding.requirementId, originLaunchId: origin.id, originOutputId: output.id,
            baselineHash: baseline.hash, planningJudge: judge, planHash: hash(plan), requirementsHash: hash(plan.requirements), contractsVersion: r.data.contractsVersion,
            ...(qualified?{baselineBasis:basis!}:{}) };
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
    private acceptedImplementationCarries(work: string, plan: PlanProposal, judge: string, protocol: RoleResult, proofs = new Map<string,BaseClassificationProof>()) {
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
            return { ...this.resolveImplementationCarry(work, proposal, plan, judge,proofs.get(proposal.occurrenceId)),
                sourceInputFingerprint: hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source])) };
        });
    }
    private planningOutputHash(output: any) {
        return hash([output.id, output.launch, output.raw, output.status, output.data]);
    }
    /** Resolve the literal amendment or its explicitly bound original proposal. */
    private acceptedPlanningProposal(work: string, judgeId: string, protocol: RoleResult, plannerLaunch?: string): PlanProposal | undefined {
        const judge = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', judgeId, work), metadata = judge && parse(judge.data);
        assertSupportedRoleProfile(metadata ?? {});
        if (Object.hasOwn(protocol,'assessment') || Object.hasOwn(protocol,'integration')) throw Error('Unsupported retired planning output; original records retained');

        if (Object.hasOwn(protocol, 'acceptedPlan')) return protocol.acceptedPlan;
        const approval = metadata && readProposalApproval('adjudicator', metadata);
        if (!approval) return metadata?.planningVerificationProfile?.supported ? undefined : metadata?.planProposal;
        const original = this.s.one('SELECT * FROM role_outputs WHERE id=?', approval.plannerOutputId);
        const producer = original && this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', original.launch, work);
        const run = producer && this.s.one('SELECT * FROM runs WHERE id=?', producer.run);
        const origin = producer && parse(producer.data), scope = metadata.plannerInputScope, originalMetadata = original && parse(original.data), runData = run && parse(run.data);
        const parsed = original?.status === 'usable' && typeof original.raw === 'string' ? parseCapturedRoleOutput(original.raw, 'planner', origin).value : null;
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
    private carriedBaseline(work: string, occurrence: any, currentProof?:BaseClassificationProof): string | null {
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
        const judgment = parse(this.s.one('SELECT data FROM role_launches WHERE id=?', judge).data);
        if (judgment.decisionCarry?.version===3 && (!currentProof || hash(currentProof)!==hash(record.baselineBasis)))
            throw Error('Source-qualified BASE repair needs freshly reauthenticated original classification');
        const protocol = originalPlanningProtocol(outputs[0], judgment);
        const proposals = implementationCarryProposals(protocol, planningDecisionCarry('adjudicator', judgment));
        const effectivePlan = this.acceptedPlanningProposal(work, judge, protocol, version.data.authorLaunch);
        if (!protocol?.planAccepted || protocol.ownerDecisionRequired?.length || !effectivePlan || hash(effectivePlan) !== hash(plan) ||
            proposals.length !== stored.length ||
            proposals.some(item => !stored.some((other: any) => item.occurrenceId === other.occurrenceId &&
                hash(item) === hash({ occurrenceId: other.occurrenceId, baselineVersion: other.baselineVersion, requirementIds: other.requirementIds, reason: other.reason,
                    ...(judgment.decisionCarry?.version===3?{baseSourceIds:other.baseSourceIds}:{}) }))))
            throw new Error('Implementation carry is not bound to the retained independent accepted plan');
        this.carryDecisionChains(proposals, protocol.decisions ?? []);
        const resolved = this.resolveImplementationCarry(work, record, plan, judge,currentProof??record.baselineBasis);
        const requirements = r.data.requirementVersion ? this.version(r.data.requirementVersion) : null;
        if (!requirements || requirements.work !== work || requirements.kind !== 'requirements' || requirements.data.decisionLaunch !== judge ||
            hash(requirements.data.requirements) !== resolved.requirementsHash ||
            ['historicalRequirementId', 'originLaunchId', 'originOutputId', 'baselineHash', 'planningJudge', 'planHash', 'requirementsHash', 'contractsVersion'].some(key => record[key] !== resolved[key as keyof typeof resolved]))
            throw new Error('Implementation carry origin, baseline or current requirement lineage changed');
        return resolved.baselineVersion;
    }
    private sourceQualifiedPlan(work:string) {
        const r=this.row(work),plan=r.plan?this.version(r.plan):null;
        if (!plan) return null;
        const stored=plan.data.implementationCarries??[],judge=plan.data.decisionLaunch;
        const launch=this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',judge,work),metadata=launch&&parse(launch.data);
        const outputs=this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge);
        if (!launch||outputs.length!==1) throw Error('Accepted planning original judgment unavailable');
        const protocol=originalPlanningProtocol(outputs[0],metadata);
        if (plan.data.implementationCarryProfile?.version!==3 && metadata?.decisionCarry?.version!==3 &&
            !stored.some((record:any)=>Object.hasOwn(record,'baseSourceIds')||Object.hasOwn(record,'baselineBasis'))) return null;
        const format=metadata&&planningDecisionCarry('adjudicator',metadata);
        if (format?.version!==3||hash(plan.data.implementationCarryProfile??null)!==hash(format))
            throw Error('Source-qualified carry lost its original captured plan format');
        const proposals=implementationCarryProposals(protocol,format);
        if (stored.length!==proposals.length || proposals.some(proposal=>!stored.some((record:any)=>record.occurrenceId===proposal.occurrenceId &&
            hash(proposal)===hash({occurrenceId:record.occurrenceId,baselineVersion:record.baselineVersion,requirementIds:record.requirementIds,reason:record.reason,baseSourceIds:record.baseSourceIds}))))
            throw Error('Source-qualified carry members differ from original captured judgment');
        if (stored.some((record:any)=>record.baselineBasis?.version!==1)) throw Error('Source-qualified carry original BASE receipt missing or unsupported');
        return {plan,stored,judge,launch,metadata,protocol,proposals,output:outputs[0]};
    }
    private retainedCandidateStage(work: string, row = this.row(work), read = this.createVerificationRead(work)): 'checks' | 'held' | undefined {
        if (row.phase !== 'PLAN_READY' || !row.plan) return;
        try {
            const plan = this.version(row.plan);
            if (!Object.hasOwn(row.data, 'verificationProfileMode') && !Object.hasOwn(plan.data, 'verificationProfile') &&
                !Object.hasOwn(plan.data, 'implementationCarryProfile')) return;
            const selected = this.sourceQualifiedPlan(work);
            if (!selected) return;
            if (selected.metadata.inputVersions?.candidate !== row.candidate) return 'held';
            if (!row.candidate) return;
            const strategies = read.strategies();
            const candidate = this.version(row.candidate), base = this.version(row.base);
            if (!strategies || !row.verification || candidate.kind !== 'candidate' || candidate.work !== work || !candidate.artifact ||
                base.kind !== 'base' || base.work !== work ||
                selected.plan.data.implementationCarryProfile.baselineVersion !== base.id) return 'held';
            if (!selected.stored.length || candidate.hash === base.hash || this.verificationMode(work)?.baselinePlanId ||
                strategies.flatMap(verificationStrategyLeaves).some(strategy => strategy.kind === 'base-execution-duty')) return;
            return 'checks';
        } catch {
            return 'held';
        }
    }
    private retainedStageNextAction(work: string, stage: 'checks' | 'held' | undefined): string | undefined {
        if (stage === 'held') return 'Inspect the accepted planning evidence and retained candidate before resuming';
        if (stage !== 'checks') return;
        const execution = this.budget(work, 'execution');
        if (execution.consumed + execution.reserved >= execution.limit)
            return 'Extend execution allowance, then resume current checks on the retained candidate';
        return 'Resume current checks on the retained candidate';
    }
    /** Retained plan repair is an original adoption receipt, not today's verdict. */
    private assertPlanningRepairs(work:string, plan=this.row(work).plan ? this.version(this.row(work).plan) : null) {
        if (!plan) return [];
        const judgeId=plan.data.decisionLaunch;
        const judge=typeof judgeId==='string' ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',judgeId,work) : null;
        const metadata=judge&&parse(judge.data),profile=metadata ? planningRepairProfile('adjudicator',metadata) : undefined;
        const stored=plan.data.planningRepairs;
        if (!profile && stored===undefined) return [];
        const outputs=judge ? this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judge.id) : [];
        if (!judge || judge.role!=='adjudicator' || judge.status!=='COMPLETE' || metadata.stage!=='planning-adjudication' ||
            !profile || plan.work!==work || plan.kind!=='plan' || hash(plan.data.plan)!==plan.hash || outputs.length!==1)
            throw Error('Plan repair lost its original adopted plan and independent judge');
        const protocol=originalPlanningProtocol(outputs[0],metadata),decisions=(protocol.decisions??[]).filter(decision=>decision.repair?.kind==='plan');
        const records=stored??[];
        if (!Array.isArray(records) || records.length!==decisions.length || new Set(records.map((record:any)=>record.occurrenceId)).size!==records.length ||
            !protocol.planAccepted || protocol.ownerDecisionRequired?.length ||
            hash(this.acceptedPlanningProposal(work,judge.id,protocol,plan.data.authorLaunch)??null)!==plan.hash)
            throw Error('Plan repair adoption receipt differs from its original judgment');
        for (const decision of decisions) {
            const subject=profile.subjects.find(subject=>subject.occurrenceId===decision.occurrenceId&&subject.proposalHash===decision.repair!.proposalHash);
            const occurrence=this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',decision.occurrenceId,work);
            const origin=occurrence&&this.s.one('SELECT * FROM role_outputs WHERE id=?',occurrence.output);
            const producer=origin&&this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',origin.launch,work);
            const record=records.find((record:any)=>record.occurrenceId===decision.occurrenceId);
            const expected=subject&&{version:1,kind:'plan',...subject,acceptedPlanHash:plan.hash,judgeLaunchId:judge.id};
            if (!subject || !occurrence || occurrence.output!==subject.producerOutputId || !producer || producer.id===judge.id ||
                subject.proposalHash===plan.hash || decision.disposition!=='upheld' || decision.resolution!=='repaired' ||
                !decision.witnesses.length || decision.implementation || decision.implementationCarry || hash(record)!==hash(expected))
                throw Error('Plan repair original subject or accepted-plan binding changed');
            const witness={...record,planVersion:plan.id};
            const effective=this.s.all('SELECT * FROM finding_dispositions WHERE occurrence=? AND launch=?',occurrence.id,judge.id)
                .filter(row=>hash(parse(row.data).repairWitness??null)===hash(witness));
            if (effective.length!==1 || effective[0].status!=='upheld' ||
                hash(parse(effective[0].data))!==hash({...decision,repairWitness:witness}))
                throw Error('Plan repair lacks its unique original effective adoption witness');
        }
        return records as PlanningRepairEvidence[];
    }
    /** Source custody is reauthenticated before authoring or current resolution. */
    private async prevalidatePlanningRepairs(work:string) {
        const selected=this.row(work).plan,plan=selected?this.version(selected):null,records=this.assertPlanningRepairs(work,plan);
        if (!records.length) return () => {};
        const snapshot=hash(plan),judgeOutputs=this.s.all("SELECT id FROM role_outputs WHERE launch=? AND status='usable'",plan!.data.decisionLaunch);
        const judge=await this.guardedPlanningProducer(work,judgeOutputs[0].id),origins=new Map<string,Awaited<ReturnType<ChangeCore['historicalPlanningProducer']>>>();
        const occurrences=new Map<string,string>();
        const assertCurrent=()=>{
            judge.assertCurrent();for (const origin of origins.values()) origin.assertCurrent();
            for (const [id,fingerprint] of occurrences)
                if (hash(this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',id,work) ?? null)!==fingerprint)
                    throw Error('Plan repair original subject changed after source authentication');
            if (this.row(work).plan!==selected || hash(this.version(selected!))!==snapshot) throw Error('Plan repair selected adoption changed during source authentication');
            this.assertPlanningRepairs(work);
        };
        for (const record of records) {
            if (!origins.has(record.producerOutputId)) origins.set(record.producerOutputId,await this.guardedPlanningProducer(work,record.producerOutputId));
            const origin=origins.get(record.producerOutputId)!;
            const occurrence=this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',record.occurrenceId,work);
            const claims=origin.receivedFindings??capturedRawFindings(origin.output.raw,origin.launch.role,origin.ld).findings;
            if (!occurrence || occurrence.output!==origin.output.id || hash(origin.context.planProposal)!==record.proposalHash ||
                !Number.isSafeInteger(occurrence.ordinal) || occurrence.ordinal<0 || occurrence.ordinal>=claims.length ||
                hash(claims[occurrence.ordinal])!==hash(parse(occurrence.data).finding)) throw Error('Plan repair lost its original authenticated proposal or claim');
            occurrences.set(occurrence.id,hash(occurrence));
            assertCurrent();
        }
        if (hash(planningRepairProfile('adjudicator',judge.context)??null)!==hash(planningRepairProfile('adjudicator',judge.ld)??null))
            throw Error('Plan repair original source domain changed');
        assertCurrent();
        return assertCurrent;
    }
    private async prevalidateVerificationPlanRepair(work: string) {
        const r = this.row(work), plan = r.plan ? this.version(r.plan) : null;
        if (!plan) return;
        const repair = plan.data.coverageRepair as VerificationPlanRepair | undefined;
        const launchId = plan.data.decisionLaunch;
        const judge = typeof launchId === 'string' ?
            this.s.one("SELECT data FROM role_launches WHERE id=? AND work=? AND role='adjudicator'", launchId, work) : null;
        const profile = judge && planningRepairProfile('adjudicator', parse(judge.data));
        if (!repair && profile?.version !== 2) return;
        if (!repair || profile?.version !== 2 || hash(repair.subject) !== hash(profile.verification))
            throw Error('Verification correction lost its independently adopted subject');
        const outputs = this.s.all("SELECT id FROM role_outputs WHERE launch=? AND status='usable' LIMIT 2", plan.data.decisionLaunch);
        if (outputs.length !== 1) throw Error('Verification correction needs its original independent judgment');
        const originalJudge = await this.guardedPlanningProducer(work, outputs[0].id);
        const context = originalJudge.context.verificationReplan;
        const judgment = originalPlanningProtocol(originalJudge.output, originalJudge.ld);
        const decision = judgment.decisions?.find(item => isVerificationPlanRepair(item, profile));
        const old = this.version(repair.originalPlan), oldVerification = this.version(repair.originalVerification);
        if (!context || !Array.isArray(context.witnessIds) || !decision || !judgment.planAccepted || judgment.ownerDecisionRequired?.length ||
            hash(context.originalPlan) !== old.hash || old.hash !== repair.subject.proposalHash ||
            old.work !== work || oldVerification.work !== work || hash(oldVerification.data.verification) !== hash(old.data.plan.verification) ||
            originalJudge.ld.inputVersions?.candidate !== repair.candidate || originalJudge.ld.inputVersions?.plan !== old.id ||
            originalJudge.ld.inputVersions?.verification !== oldVerification.id || context.requirementId !== repair.requirementId ||
            hash(verificationCaseAdditions(old.data.plan, plan.data.plan, repair.requirementId)) !== hash(repair.checkIds) ||
            hash(this.acceptedPlanningProposal(work, originalJudge.launch.id, judgment, plan.data.authorLaunch)) !== plan.hash)
            throw Error('Verification correction declaration or original plan changed');
        const source = () => {
            const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE work=? AND id=?', work, repair.subject.occurrenceId);
            const output = this.s.one("SELECT * FROM role_outputs WHERE id=? AND status='usable'", repair.subject.producerOutputId);
            const launch = output && this.s.one("SELECT * FROM role_launches WHERE id=? AND work=? AND role='reviewer' AND status='COMPLETE'", output.launch, work);
            const run = launch && this.s.one("SELECT * FROM runs WHERE id=? AND work=? AND phase='SETTLED' AND reservation='consumed'", launch.run, work);
            if (!occurrence || occurrence.output !== output?.id || !launch || !run)
                throw Error('Verification correction original reviewer evidence unavailable');
            return { occurrence, output, launch, run };
        };
        const oldSource = source(), sourceHash = hash(oldSource);
        const { occurrence, output, launch, run } = oldSource, od = parse(output.data), ld = parse(launch.data), rd = parse(run.data);
        const historyIdentity = this.materialHistoryIdentity(rd.historyRef);
        if (!historyIdentity) throw Error('Original verification reviewer history unavailable');
        const planInputs = hash([old, oldVerification, this.version(repair.candidate)]);
        const entries = await this.nativeEntries(run.id);
        const raw = readSelectedRoleOutput(entries, {entryId:od.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:'reviewer',
            checkpointLeafId:rd.nativeCheckpoint?.leafId,nativeIntent:ld.nativeRoleIntent,stage:'fresh-review',strictLegacyBlocks:true}, od.nativeSource);
        const protocol = raw ? parseRoleOutput(raw, 'reviewer').value : undefined;
        if (raw !== output.raw || ld.stage !== 'fresh-review' || rd.cleanup !== 'removed' || ld.cleanup !== 'removed' ||
            ld.inputVersions?.candidate !== repair.candidate || ld.inputVersions?.plan !== old.id || ld.inputVersions?.verification !== oldVerification.id ||
            !protocol || !this.matchesVerificationGapFinding(protocol, occurrence, launch.id, repair.requirementId) ||
            !protocol.verificationDecisions?.some(item => item.verdict === 'unavailable' && hash(item) === hash(context.assessment)))
            throw Error('Verification correction original reviewer judgment changed');
        const witnessDigest = () => hash((context.witnessIds as string[]).map(id => this.verificationRecord(work, id)));
        const planHash = hash(plan);
        const assertCurrent = () => {
            this.guard(work); originalJudge.assertCurrent();
            if (this.row(work).plan !== plan.id || hash(this.version(plan.id)) !== planHash || hash(source()) !== sourceHash ||
                this.materialHistoryIdentity(rd.historyRef) !== historyIdentity ||
                witnessDigest() !== context.witnessDigest ||
                hash([this.version(old.id), this.version(oldVerification.id), this.version(repair.candidate)]) !== planInputs)
                throw Error('Verification correction source changed during verification');
        };
        assertCurrent();
        return { repair, assertCurrent };
    }
    private pendingVerificationPlanRepair(work: string): string | undefined {
        const plan = this.row(work).plan;
        const repair = plan ? this.version(plan).data.coverageRepair as VerificationPlanRepair | undefined : undefined;
        if (!repair) return;
        const obligation = this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', repair.subject.occurrenceId, work);
        if (!obligation || parse(obligation.data).state !== 'resolved') return repair.subject.occurrenceId;
    }
    private async prevalidateRetainedBaseClassifications(work:string) {
        const assertCurrent = await this.prevalidatePlanningRepairs(work);
        const finish = (proofs:Map<string,BaseClassificationProof>) => { assertCurrent(); return {proofs,assertCurrent}; };
        const r=this.row(work),planBefore=r.plan?this.version(r.plan):null;
        if (!planBefore) return finish(new Map<string,BaseClassificationProof>());
        const judgeBefore=planBefore.data.decisionLaunch,outputsBefore=this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable'",judgeBefore);
        if (outputsBefore.length!==1) throw Error('Accepted planning original judgment unavailable');
        const original=await this.historicalPlanningProducer(work,outputsBefore[0].id);
        original.assertCurrent();
        if (this.row(work).plan!==planBefore.id||hash(this.version(planBefore.id))!==hash(planBefore))
            throw Error('Accepted plan changed before original format authentication');
        const selected=this.sourceQualifiedPlan(work),proofs=new Map<string,BaseClassificationProof>();
        if (!selected) return finish(proofs);
        const {plan,stored,judge,protocol}=selected,planHash=hash(plan);
        const fresh=await this.prevalidateBaseClassifications(work,judge,protocol);
        original.assertCurrent();
        if (this.row(work).plan!==plan.id||hash(this.version(plan.id))!==planHash) throw Error('Source-qualified accepted plan changed during source replay');
        for (const record of stored) {
            const proof=fresh.get(record.occurrenceId);
            if (!proof||hash(proof)!==hash(record.baselineBasis)) throw Error('Source-qualified retained BASE receipt differs from authenticated original source');
            proofs.set(record.occurrenceId,proof);
        }
        return finish(proofs);
    }
    private repairedProof(work: string, occurrence: any, witnesses: string[], currentProof?:BaseClassificationProof) {
        const r = this.row(work), origin = this.s.one('SELECT * FROM role_launches WHERE id=?', parse(occurrence.data).launchId);
        let old = parse(origin.data).inputVersions.candidate;
        const qualified=this.sourceQualifiedPlan(work);
        if (qualified?.proposals.some(proposal=>proposal.occurrenceId===occurrence.id)) old = this.carriedBaseline(work,occurrence,currentProof);
        else if (origin.role === 'implementer' || origin.role === 'repairer') {
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
    private dispositions(work: string, launch: string, protocol: RoleResult, scope?: readonly string[] | {occurrenceIds:readonly string[]; pendingUnjudged?: 'planning-accounting'}, subjectRepair?: (occurrence: any) => boolean | Record<string,unknown>, diagnosisProofs = new Map<string, any>(), baseProofs = new Map<string,BaseClassificationProof>()) {
        this.guard(work);
        const pendingUnjudged = scope && 'occurrenceIds' in scope && scope.pendingUnjudged === 'planning-accounting';
        if (pendingUnjudged) {
            const producer = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', launch, work);
            const data = producer && parse(producer.data), references = data && adjudicationDecisionReferences('adjudicator', data);
            if (!producer || producer.role !== 'adjudicator' || producer.status !== 'COMPLETE' || data.stage !== 'planning-adjudication' ||
                !references || hash(references.occurrenceIds) !== hash(scope.occurrenceIds))
                throw Error('Planning accounting requires the complete original subject domain');
        }
        const all = this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work).filter(o => !scope ||
            ('occurrenceIds' in scope ? scope.occurrenceIds.includes(o.id) : scope.includes(parse(o.data).launchId)));
        if (scope && 'occurrenceIds' in scope && (new Set(scope.occurrenceIds).size !== scope.occurrenceIds.length ||
            scope.occurrenceIds.some(id=>!all.some(row=>row.id === id)))) throw Error('Exact disposition subject scope is unavailable');
        this.assertRetainedDispositions(work, launch, protocol);
        const synthetic = this.diagnosisDecisionSubjects(work,launch);
        this.diagnosisDecisionGuard(work, protocol,synthetic);
        const decisions = protocol.decisions ?? [];
        // A later effect may reuse the enclosing judgment's proof map. Only
        // this batch's actual diagnosis requests consume those proofs.
        const diagnosisRequests = decisions.filter(d => d.resolution === 'diagnosed' || d.disposition === 'rejected' && synthetic.has(d.occurrenceId));
        const diagnosisSubjects = new Set(diagnosisRequests.map(d => d.occurrenceId));
        const usedDiagnosisProofs = new Map([...diagnosisProofs].filter(([id]) => diagnosisSubjects.has(id)));
        for (const proof of usedDiagnosisProofs.values()) if (proof.origin?.materialSource &&
            hash(proof.origin.materialSource.fence) !== hash(this.materialAssessmentFence(proof.origin.outputId)))
            throw Error('Public material assessment source changed before disposition commit');
        for (const d of diagnosisRequests) {
            const proof = usedDiagnosisProofs.get(d.occurrenceId);
            if (!proof || proof.judgeLaunchId !== launch || proof.origin?.occurrenceId !== d.occurrenceId ||
                (d.disposition === 'rejected' ? proof.assessment !== 'rejected-raw-assessment/v1' : proof.assessment !== undefined) ||
                hash(proof.originFence) !== hash(this.diagnosisOriginFence(work,d.occurrenceId)) ||
                hash(proof.judgeFence) !== hash(this.diagnosisJudgeFence(work,launch,proof.judgeOutputId)))
                throw new Error('Diagnosis assessment proof must be prevalidated and current before disposition mutation');
        }
        const launchData = parse(this.s.one('SELECT data FROM role_launches WHERE id=?', launch)?.data ?? '{}');
        const optionalObservation = reviewResolutionInput('adjudicator', launchData)?.version === 4;
        if (usedDiagnosisProofs.size)
            this.assertDiagnosticInputCurrent(work, launch, launchData.producerDiagnosticInput);
        const ids = new Set<string>();
        for (const d of decisions) {
            if (ids.has(d.occurrenceId) || !all.some(o => o.id === d.occurrenceId))
                throw new Error('Disposition duplicate/unknown occurrence');
            ids.add(d.occurrenceId);
            const finding = parse(all.find(o => o.id === d.occurrenceId)!.data).finding;
            if (optionalObservation && d.disposition === 'upheld' && d.resolution === undefined) {
                assertFindingCore(finding);
                if (finding.severity !== 'optional' || synthetic.has(d.occurrenceId))
                    throw Error('Upheld review without further action requires a current ordinary optional observation');
            }
            // A pending validity judgment does not claim completion. Its exact
            // occurrence/reason and any BASE assignment remain independently checked.
            // Equivalence closure is checked against the complete graph below.
            const proof = launchData.diagnosisEligibility?.version === 2 ? usedDiagnosisProofs.get(d.occurrenceId) : undefined;
            assertDispositionEvidence(d, finding, synthetic.has(d.occurrenceId), proof && {
                outputId: proof.origin.outputId, rawSha256: proof.origin.rawSha256, inputReceiptHash: proof.inputReceiptHash,
                materialOccurrenceIds: proof.origin.materialOccurrences.map((material: {id: string}) => material.id),
            });
            if (d.disposition === 'equivalent' && (!d.equivalentTo || d.equivalentTo === d.occurrenceId || !all.some(o => o.id === d.equivalentTo)))
                throw new Error('Equivalence target invalid');
            const repairEvidence = d.disposition==='upheld' && d.resolution==='repaired' && (optionalObservation || d.repair || finding?.severity!=='optional')
                ? subjectRepair ? subjectRepair(all.find(o=>o.id===d.occurrenceId)!) : this.repairedProof(work,all.find(o=>o.id===d.occurrenceId)!,d.witnesses,baseProofs.get(d.occurrenceId)) : undefined;
            const repairReceipt = repairEvidence && typeof repairEvidence==='object' ? {repairWitness:repairEvidence} :
                d.repair?.kind === 'plan' ? {repairPendingAdoption:true} : {};
            this.s.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)', randomUUID(), d.occurrenceId, launch, d.disposition, JSON.stringify({ ...d, ...repairReceipt, ...(usedDiagnosisProofs.has(d.occurrenceId) ? { diagnosisWitness: usedDiagnosisProofs.get(d.occurrenceId) } : {}) }));
            const done = dispositionAccountingState(d,finding,{diagnosis:usedDiagnosisProofs.has(d.occurrenceId),repair:!!repairEvidence}) === 'resolved';
            this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ kind: 'finding', occurrence: d.occurrenceId, state: done ? 'resolved' : 'pending', disposition: d.disposition, ...repairReceipt, ...(usedDiagnosisProofs.has(d.occurrenceId) ? { ...(d.resolution === 'diagnosed' ? {resolution:'diagnosed'} : {}), diagnosisWitness: usedDiagnosisProofs.get(d.occurrenceId) } : {}) }), d.occurrenceId);
        }
        for (const occurrence of all) {
            const latest = this.s.one('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', occurrence.id);
            if (!latest && !pendingUnjudged)
                throw new Error(`Raw occurrence unaccounted: ${occurrence.id}`);
            if (!latest && parse(this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', occurrence.id, work)?.data ?? '{}').state !== 'pending')
                throw Error('Unjudged planning subject must remain pending');
        }
        const latest = new Map(all.map(o => {
            const row = this.s.one('SELECT data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', o.id);
            return [o.id, row ? parse(row.data) : undefined];
        }));
        const accounting = equivalenceAccounting(latest, (id, head) => !head ? 'pending' :
            parse(this.s.one('SELECT data FROM obligations WHERE id=?', id).data).state === 'resolved' ? 'resolved' : 'pending');
        // Retained pending edges may inherit their target's proven closure;
        // only this producer's new resolving judgments acquire a witness duty.
        assertResolvedEquivalenceEvidence(protocol.decisions ?? [], accounting);
        for (const [id, d] of latest)
            if (d?.disposition === 'equivalent') {
                const done = accounting.get(id) === 'resolved';
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ kind: 'finding', occurrence: id, state: done ? 'resolved' : 'pending', disposition: 'equivalent', equivalentTo: d.equivalentTo }), id);
            }
    }
    private inputDecisions(work: string, launch: string, protocol: RoleResult) {
        this.s.tx(this.prepareInputDecisions(work, launch, protocol));
    }
    /** Validate without clearing source holds. The caller owns the apply transaction. */
    private prepareInputDecisions(work: string, launch: string, protocol: RoleResult, scopeReplan = false) {
        this.guard(work);
        const producer = this.s.one('SELECT * FROM role_launches WHERE id=?', launch);
        if (!producer || producer.work !== work || producer.role !== 'adjudicator' || producer.status !== 'COMPLETE')
            throw new Error('Source-fit requires actual completed non-author adjudicator producer');
        const stage = parse(producer.data).stage;
        const heldInputs = () => this.h.sourceImpacts(work, true).filter(input => input.data.effectHold);
        const pending = heldInputs(), pendingDigest = hash(pending);
        const currentPlan = this.row(work).plan, accepted = stage === 'planning-adjudication' ? (protocol.acceptedPlan?.requirements ?? (currentPlan ? this.version(currentPlan).data.plan.requirements : [])) : (currentPlan ? this.version(currentPlan).data.plan.requirements : []);
        const decisions = pending.map(input => {
            const decision = protocol.inputDecisions?.find(d => d.inputId === input.input_id && d.directionRevision === input.revision);
            if (!decision)
                throw new Error('Independent source-fit decision omitted actual input ' + input.input_id);
            if (decision.requirementIds.some(id => !accepted.some((r: any) => r.id === id)))
                throw new Error('Source-fit decision names unknown requirement');
            if (decision.impact === 'ambiguous')
                throw new Error('Consequential source interpretation needs owner clarification');
            const sourceIssue = sourceFitAuthorityIssue(decision.impact, input.sourceOrigin);
            if (sourceIssue) throw new Error(sourceIssue);
            if (scopeReplan && decision.impact !== 'explanation')
                throw new Error('Scope replan cannot adopt a change to the original requirements. The direction and original scope remain pending.');
            if (decision.impact === 'scope-change' && !['source-fit', 'planning-adjudication'].includes(stage))
                throw new SourceScopeChangeRequiresPlanning();
            return { input, decision };
        });
        return () => {
            this.guard(work);
            if (hash(heldInputs()) !== pendingDigest)
                throw new Error('Pending source tuple changed before source-fit application');
            for (const { input, decision } of decisions)
                this.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?', JSON.stringify({ ...input.data, effectHold: false, decision: { ...decision, launch } }), input.conversation, input.revision);
            if (stage === 'source-fit' && decisions.some(({ decision }) => decision.impact === 'scope-change')) {
                this.s.run('UPDATE change_state SET plan=NULL,verification=NULL WHERE work=?', work);
                this.acceptOwnVersions(work);
                this.phase(work, 'BASE_CAPTURED', { resumeStage: 'plan', selection: {}, pendingNit: null, carry: null, nextAction: 'Replan retained changed owner source' });
            }
        };
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
                !Array.isArray(original.data.plan?.verification?.strategies) || !original.data.plan.verification.strategies.flatMap(verificationStrategyLeaves).some((strategy: VerificationStrategy) => strategy.kind === 'base-execution-duty'))
                throw new Error('Original accepted baseline-duty history unavailable');
        }
        return mode;
    }
    private verificationSupport(work: string) {
        const mode = this.verificationMode(work), r = this.row(work);
        if (!mode && r.plan && Object.hasOwn(this.version(r.plan).data, 'verificationProfile')) throw new Error('Owned typed verification mode was lost; no legacy fallback');
        // A retained BASE duty can require an exact old check declaration. Do not
        // add oracle coverage to that history merely to fit a new grammar.
        const baselinePlan = mode?.baselinePlanId ? this.version(mode.baselinePlanId).data.plan as PlanProposal : undefined;
        const baselineIds = new Set((baselinePlan?.verification.strategies ?? []).flatMap(verificationStrategyLeaves)
            .filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
        const legacyBaselineDeclarations = baselinePlan?.verification.checks.some(check => baselineIds.has(check.id) && !Array.isArray(check.expectationPaths)) ?? false;
        return finiteVerificationSupport(this.work(work), !!this.s.one("SELECT id FROM role_launches WHERE work=? AND role IN ('implementer','repairer') LIMIT 1", work), mode !== undefined, !!mode?.baselinePlanId, legacyBaselineDeclarations, r.data.candidateAmendmentProbe === true ? 12 : r.data.consumerControlPass === true ? 11 : 10);
    }
    /** One synchronous evaluation only; never retain this read across an await or action boundary. */
    private createVerificationRead(work: string): VerificationRead {
        return { strategies: readOnce(() => this.strategies(work)) };
    }
    private strategies(work: string) {
        this.assertPlanningRepairs(work);
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
        if (judge && Object.hasOwn(metadata, 'planningVerificationProfile') && (!capability || !isPlanningGrammar(capability.version) || typeof capability.supported !== 'boolean')) throw new Error('Original planning capability metadata unavailable');
        const producerTyped = capability?.supported === true || !!effectivePlan && Object.hasOwn(effectivePlan.verification, 'strategies');
        if (!declared && !marked && !producerTyped && !mode) return undefined;
        if (output && metadata) originalPlanningProtocol(output, metadata);
        const marker = selected.data.verificationProfile;
        if (!mode || !declared || !Array.isArray(verification.strategies) || !judge || !output || !marker || typeof marker !== 'object' || Array.isArray(marker) ||
            Object.keys(marker).some(key => !['version', 'kind', 'strategyDigest', 'decisionLaunch'].includes(key)) || typeof marker.decisionLaunch !== 'string' || !marker.decisionLaunch || marker.version !== 1 || marker.kind !== 'finite-mixed' ||
            marker.decisionLaunch !== judge?.id || marker.strategyDigest !== hash(verification.strategies) || !savedVerification || !Object.hasOwn(savedVerification.data, 'verificationProfile') || !Object.hasOwn(savedVerification.data, 'verification') ||
            hash(savedVerification.data.verificationProfile) !== hash(marker) || hash(verification) !== savedVerification.hash || hash(savedVerification.data.verification) !== savedVerification.hash || hash(plan) !== selected.hash)
            throw new Error('Typed verification profile or selected plan/verification binding is unavailable');
        const run = this.s.one('SELECT * FROM runs WHERE id=?', judge.run), runData = run ? parse(run.data) : null;
        if (judge.role !== 'adjudicator' || judge.status !== 'COMPLETE' || metadata.stage !== 'planning-adjudication' || !isPlanningGrammar(metadata.planningVerificationProfile?.version) || metadata.planningVerificationProfile.supported !== true || metadata.cleanup !== 'removed' ||
            !run || run.work !== work || run.epoch !== judge.epoch || runData.kind !== 'governed-role' || runData.role !== 'adjudicator' || runData.launchId !== judge.id || metadata.inputVersions?.base !== r.base || metadata.inputVersions?.contracts !== r.data.contractsVersion ||
            run.phase !== 'SETTLED' || run.reservation !== 'consumed' || !runData || runData.cleanup !== 'removed' || !parsed?.planAccepted || !effectivePlan ||
            hash(effectivePlan) !== selected.hash || hash(parse(output.data).protocol) !== hash(parsed)) throw new Error('Typed verification lacks its actual independent planning producer');
        if (verification.strategies.flatMap(verificationStrategyLeaves).some(strategy => strategy.kind === 'base-execution-duty') && !mode.baselinePlanId) throw new Error('Owned before-edit baseline duty binding was lost');
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
        return new Set((read.strategies() ?? []).flatMap(verificationStrategyLeaves).filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
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
            const valid = hash(data.caseDescriptor) === comparison.descriptorHash && hash(comparison) === hash(data.caseResults) && comparison.complete && !comparison.mismatches.length &&
                baselineAssertionsMatch(check, data.parsed.value.assertions);
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
    private strategyHoldReason(evidence: () => unknown) {
        try { evidence(); return null; }
        catch (error) { return 'Current independent verification strategy evidence unavailable: ' + String(error); }
    }
    private async beforeAuthorVerification(options: ChangeOperation) {
        const assertRepairCurrent = await this.prevalidatePlanningRepairs(options.workId);
        const work = options.workId, r = this.row(work), strategies = this.strategies(work);
        if (!strategies) return assertRepairCurrent;
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
        assertRepairCurrent();
        return assertRepairCurrent;
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
        const ordinary = manifestScopeComparison(base, candidate, strategy, premises, profile);
        const view = nativeAdministrativeScopeView(this.s, work, base, candidate, version, ordinary.evidence.actual.satisfied);
        return view ? manifestScopeComparison(base, candidate, strategy, premises, profile, view) : ordinary;
    }
    private scopeRecord(work: string, strategy: ScopeStrategy, comparison?: ReturnType<typeof manifestScopeComparison>) {
        const r = this.row(work);
        if (!r.candidate) return undefined;
        const {evidence, violationSample} = comparison ?? this.scopeEvidence(work, strategy);
        const expectedDigest = hash(evidence);
        const record = this.s.all("SELECT * FROM change_versions WHERE work=? AND kind='scope-evidence' ORDER BY rowid DESC", work).find(row => {
            try { return row.hash === expectedDigest && hash(parse(row.data).evidence) === expectedDigest; }
            catch { return false; }
        });
        return record && {record, violationSample};
    }
    /** A current host predicate selects explicit recovery, never another automatic drive loop. */
    private *currentScopeFailures(work: string) {
        const {candidate, plan, verification} = this.row(work);
        if (!candidate || plan === null && verification === null) return;
        for (const strategy of (this.strategies(work) ?? []).flatMap(verificationStrategyLeaves)) {
            if (strategy.kind !== 'manifest-scope-duty') continue;
            const row = this.s.one('SELECT * FROM obligations WHERE id=? AND work=?', `scope-${work}-${hash(strategy)}`, work);
            const data = row && parse(row.data);
            if (!data || data.kind !== 'verification-scope' || data.state !== 'pending' || data.strategyDigest !== hash(strategy) ||
                hash(data.strategy) !== hash(strategy) || hash(data.premises) !== hash(this.verificationPremises(work, false))) continue;
            const current = this.scopeRecord(work, strategy);
            if (current && data.evidenceId === current.record.id && parse(current.record.data).evidence.actual.satisfied === false)
                yield {fingerprint: hash([row, current.record]), row, data, strategy, diagnostic: {evidenceId: current.record.id,
                    requirementId: strategy.requirementId, ...current.violationSample}};
        }
    }
    private currentScopeFailure(work: string) {
        return this.currentScopeFailures(work).next().value;
    }
    private captureScopeReplan(work: string) {
        const read = () => {
            const pending = this.pending(work).filter(item => item.kind === 'verification-scope');
            if (!pending.length) return;
            const selected = this.row(work), owner = this.work(work), directions = this.h.sourceImpacts(work, true);
            if (owner.state !== 'ACTIVE' || !selected.plan || !selected.verification || selected.data.criteriaRefresh)
                throw Error('Scope replan needs current work with an accepted plan and verification');
            const failures = [...this.currentScopeFailures(work)];
            if (failures.length !== pending.length || pending.some(item => !failures.some(entry => entry.row.id === item.id)))
                throw Error('Original failed scope evidence is unavailable for replan');
            const prior = this.version(selected.plan), original = prior.data.plan as PlanProposal;
            const requirements = this.version(selected.data.requirementVersion);
            if (hash(original) !== prior.hash || hash(requirements.data.requirements) !== hash(original.requirements))
                throw Error('Original scope replan requirements changed');
            const source = this.s.one('SELECT * FROM sources WHERE id=?', owner.source);
            if (!source) throw Error('Original scope replan source unavailable');
            const checkpoint = hash([owner.state, owner.epoch, owner.generation, source, directions, this.bindings(work),
                original, requirements, failures.map(entry => entry.fingerprint)]);
            const heldDirections = directions.filter(input => input.data.effectHold).map(input => ({
                inputId:input.input_id, sourceId:input.source, directionRevision:input.revision,
                sourceOrigin:input.sourceOrigin ?? 'unknown', text:input.text,
            }));
            return { failures, original, priorPlan: prior.id, checkpoint, heldDirections };
        };
        const captured = read();
        if (!captured) return;
        const profile = captureScopeAmendment({ version: 1, checkpoint: captured.checkpoint, subjects: captured.failures.map(entry => ({
            evidenceId: entry.diagnostic.evidenceId, requirementId: entry.diagnostic.requirementId, strategyDigest: scopeStrategyDigest(entry.strategy),
        })) });
        const evidence = captured.failures.map(({strategy, diagnostic}) => ({ ...diagnostic, strategy }));
        if (Buffer.byteLength(JSON.stringify([captured.original, evidence, captured.heldDirections])) > 128 * 1024)
            throw Error('Original scope replan evidence exceeds its bounded input');
        return { ...captured, profile, evidence, assertCurrent: () => {
            if (read()?.checkpoint !== captured.checkpoint) throw Error('Original failed scope changed before replan');
        } };
    }
    private planScopeAmendments(replan: NonNullable<ReturnType<ChangeCore['captureScopeReplan']>>, plan: PlanProposal,
        context: Record<string, unknown>, protocol: RoleResult) {
        if (hash(scopeAmendmentProfile('adjudicator', context)) !== hash(replan.profile) ||
            hash(context.scopeReplanEvidence) !== hash(replan.evidence) || hash(context.scopeReplanOriginalPlan) !== hash(replan.original))
            throw Error('Independent adjudication lost its original failed scope evidence');
        validateScopeAmendmentDecisions(protocol.scopeAmendments, replan.profile, plan);
        const affected = new Set(replan.profile.subjects.map(subject => subject.requirementId));
        const retained = (candidate: PlanProposal) => {
            const { strategies, ...verification } = candidate.verification;
            const unchanged = strategies?.flatMap(verificationStrategyLeaves).filter(strategy =>
                strategy.kind !== 'manifest-scope-duty' || !affected.has(strategy.requirementId));
            return { requirements: candidate.requirements, verification, unchanged };
        };
        if (hash(retained(plan)) !== hash(retained(replan.original)))
            throw Error('Scope replan must keep original requirements, checks, review and all other verification duties');
        const acceptedScopes = plan.verification.strategies!.flatMap(verificationStrategyLeaves);
        return replan.failures.map(failure => {
            const decision = protocol.scopeAmendments!.find(item => item.evidenceId === failure.diagnostic.evidenceId)!;
            if (decision.action === 'retain' && hash(acceptedScopes.find(item => item.kind === 'manifest-scope-duty' &&
                item.requirementId === failure.strategy.requirementId)) !== hash(failure.strategy))
                throw Error('Retaining a failed scope requires its exact original strategy');
            return { decision, failure };
        });
    }
    private applyScopeAmendments(work: string, plan: string, amendments: ReturnType<ChangeCore['planScopeAmendments']>) {
        const premises = this.verificationPremises(work, false);
        for (const { decision, failure } of amendments) {
            const data = decision.action === 'retain'
                ? { ...failure.data, premises, evidenceId: null, previousEvidenceId: failure.diagnostic.evidenceId }
                : { ...failure.data, state: 'resolved', resolution: 'scope-amendment' };
            this.s.run('UPDATE obligations SET data=? WHERE id=? AND work=?',
                JSON.stringify({ ...data, scopeAmendmentPlan: plan }), failure.row.id, work);
        }
    }
    private scopeReceipt(work: string, strategy: ScopeStrategy) {
        const row = this.scopeRecord(work, strategy)?.record;
        return row && parse(row.data).evidence.actual.satisfied ? row : undefined;
    }
    private pendingScopePremise(work: string, strategy: ScopeStrategy) {
        const id = `scope-${work}-${hash(strategy)}`;
        const old = this.s.one('SELECT data FROM obligations WHERE id=?', id);
        if (!old) return;
        const data = parse(old.data);
        if (data.state === 'resolved') return;
        if (hash(data.premises) !== hash(this.verificationPremises(work, false))) throw new Error('Scope predicate premise changed; original failed obligation requires independent resolution');
        return { id, data };
    }
    private observeScopeStrategies(work: string): boolean {
        for (const strategy of (this.strategies(work) ?? []).flatMap(verificationStrategyLeaves)) {
            if (strategy.kind !== 'manifest-scope-duty') continue;
            const comparison = this.scopeEvidence(work, strategy);
            const {evidence, violationSample} = comparison;
            if (evidence.actual.satisfied && this.scopeRecord(work, strategy, comparison)) continue;
            const id = this.newVersion(work, 'scope-evidence', null, { evidence }, hash(evidence));
            const obligation = `scope-${work}-${hash(strategy)}`;
            if (!evidence.actual.satisfied) {
                const old = this.s.one('SELECT data FROM obligations WHERE id=?', obligation), previous = old && parse(old.data);
                const prior = previous?.evidenceId && this.version(previous.evidenceId).data.evidence;
                const repeated = previous?.state === 'pending' && hash(previous.premises) === hash(this.verificationPremises(work, false)) && prior?.candidate.digest === evidence.candidate.digest && hash(prior.actual) === hash(evidence.actual);
                this.s.run('INSERT OR REPLACE INTO obligations VALUES(?,?,?)', obligation, work, JSON.stringify({ kind: 'verification-scope', strategy, strategyDigest: hash(strategy), evidenceId: id, premises: this.verificationPremises(work, false), state: 'pending', ...(repeated ? { previousEvidenceId: previous.evidenceId } : {}) }));
                const details = violationSample.entries.map(entry => {
                    const subject = `${JSON.stringify(entry.path)} (${entry.before} → ${entry.after})`;
                    if (entry.reason === 'protected-missing') return `${subject} must exist on both sides of the scope comparison`;
                    return entry.reason === 'protected-changed' ? `${subject} must remain unchanged` : `${subject} is outside the accepted change scope`;
                });
                if (violationSample.omitted) details.push(`${violationSample.omitted} more scope violation paths omitted`);
                if (repeated) this.phase(work, 'BLOCKED', { blocked: ['Unchanged candidate repeats the same complete manifest scope failure', ...details], nextAction: 'Inspect original scope evidence and native projection; repeat checks after a meaningful correction, no automatic author retry', resumeStage: 'checks' });
                else this.phase(work, 'REPAIR_REQUIRED', { blocked: ['Complete current manifest violates independently accepted scope', ...details], nextAction: 'Repair the original candidate scope and repeat current verification' });
                return false;
            }
            const pending = this.pendingScopePremise(work, strategy);
            if (pending) {
                this.s.run('UPDATE obligations SET data=? WHERE id=?', JSON.stringify({ ...pending.data, state: 'resolved', currentEvidenceId: id }), pending.id);
            }
        }
        return true;
    }
    private strategyReviewApplies(witness: StrategyWitness, key: unknown) {
        return witness.reviewKeys ? witness.reviewKeys.includes(String(key)) : witness.reviewKey === null || witness.reviewKey === key;
    }
    private strategyWitness(work: string, strategy: VerificationStrategy): StrategyWitness {
        const r = this.row(work), plan = this.version(r.plan).data.plan as PlanProposal;
        if (strategy.kind === 'all-of') {
            const parts = verificationStrategyLeaves(strategy).map(part => ({...this.strategyWitness(work,part),strategy:part}));
            const reviewKeys=this.compositeReviewKeys(work,strategy);
            return {requirementId:strategy.requirementId,strategyDigest:hash(strategy),kind:strategy.kind,reviewKeys,
                witnessIds:[...new Set(parts.flatMap(part=>part.witnessIds))],parts};
        }
        let witnessIds: string[];
        if (strategy.kind === 'consumer-cases') witnessIds = strategy.checkIds.flatMap(id => {
            const check = plan.verification.checks.find(check => check.id === id)!;
            const row = this.selectedCheck(work, r.candidate, r.verification, check);
            if (row?.status !== 'pass') throw new Error('Required current consumer witness unavailable');
            if (!check.consumerControl) this.requireConsumerPass(r, check, this.version(r.candidate), row);
            const amendments = (plan.verification.checkAmendments ?? []).filter(a => a.negativeReplacement && a.correctedCheckId === id);
            const accepted = amendments.length ? this.currentAmendments(work) : [];
            const adverse = amendments.map(declaration => {
                const amendment = accepted.find(entry => entry.obligationId === declaration.obligationId);
                if (!amendment) throw new Error('Accepted candidate-derived amendment unavailable');
                return this.candidateAmendmentWitness(work, amendment).id;
            });
            return [row.id, ...(check.consumerControl ? [this.consumerControlWitness(work, check, row).id] : []), ...adverse];
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
    private scopeWitnessView(work:string,strategy:ScopeStrategy) {
        const row=this.scopeRecord(work,strategy)?.record,evidence=row?parse(row.data).evidence:null;
        return row&&evidence?{witnessId:row.id,predicate:evidence.predicate,
            actual:{satisfied:evidence.actual.satisfied,changedCount:evidence.actual.changedCount,violationCount:evidence.actual.violationCount},
            adverse:{satisfied:evidence.adverse.observation.satisfied}}:undefined;
    }
    private compositeReviewKeys(work:string,strategy:Extract<VerificationStrategy,{kind:'all-of'}>) {
        const roster=(this.version(this.row(work).plan).data.plan as PlanProposal).verification.reviewRoles;
        const keys=[...new Set(verificationStrategyLeaves(strategy).flatMap(part=>part.kind==='consumer-cases'?roster.map(role=>role.key):[part.reviewKey]))];
        if (!keys.length || keys.some(key=>!roster.some(role=>role.key===key))) throw Error('Required composite reviewer position unavailable');
        return keys;
    }
    private verificationView(work: string, read = this.createVerificationRead(work),
        evidence = () => this.verificationEvidence(work, read)): VerificationEvidenceView {
        let strategies: VerificationStrategy[];
        try { strategies = read.strategies() ?? []; }
        catch (error) { return { availability: 'unavailable', reason: String(error), requirements: [] }; }
        let proof: ReturnType<ChangeCore['inspectVerificationEvidence']>, unavailable: string | undefined;
        try { proof = evidence(); }
        catch (error) { unavailable = String(error); }
        const requirements: VerificationEvidenceView['requirements'] = strategies.map(strategy => {
            const verified = proof?.requirements.find(item => item.requirementId === strategy.requirementId);
            const entry: VerificationEvidenceView['requirements'][number] = { requirementId: strategy.requirementId, kind: strategy.kind, strategyDigest: verified?.strategyDigest ?? hash(strategy),
                ...(strategy.kind === 'all-of' ? {reviewKeys:verified?.reviewKeys ?? this.compositeReviewKeys(work,strategy)} : {reviewKey: strategy.kind === 'consumer-cases' ? null : strategy.reviewKey}), witnessAvailability: 'unavailable', witnessIds: [], reviewLaunchIds: [] };
            try {
                const witness = verified ?? this.strategyWitness(work, strategy);
                entry.witnessIds = witness.witnessIds;
                if (witness.reviewKeys) entry.reviewKeys = witness.reviewKeys;
                entry.witnessAvailability = 'recorded';
            }
            catch (error) { entry.reason = String(error); }
            entry.reviewLaunchIds = verified?.reviews.map(review => review.launchId) ?? [];
            if (strategy.kind === 'all-of') {
                entry.parts = verificationStrategyLeaves(strategy).map((part, index) => {
                    const verifiedPart = verified?.parts?.[index];
                    const view: NonNullable<typeof entry.parts>[number] = {kind:part.kind,strategyDigest:verifiedPart?.strategyDigest ?? hash(part),reviewKeys:part.kind==='consumer-cases'?this.version(this.row(work).plan).data.plan.verification.reviewRoles.map((role:{key:string})=>role.key):[part.reviewKey],witnessAvailability:'unavailable',witnessIds:[]};
                    try {
                        view.witnessIds = (verifiedPart ?? this.strategyWitness(work, part)).witnessIds;
                        view.witnessAvailability = 'recorded';
                    } catch (error) { view.reason = String(error); }
                    if(part.kind==='manifest-scope-duty')try{const scope=this.scopeWitnessView(work,part);if(scope)view.scope=scope;}catch{/* Existing missing-witness reason remains authoritative. */}
                    return view;
                });
            }
            if (strategy.kind === 'manifest-scope-duty') {
                try {
                    const scope=this.scopeWitnessView(work,strategy);if(scope)entry.scope=scope;
                } catch { /* The unavailable witness reason above remains authoritative. */ }
            }
            return entry;
        });
        return proof ? { availability: 'available', digest: proof.digest, requirements }
            : { availability: 'unavailable', reason: unavailable ?? 'Current typed verification evidence unavailable', requirements };
    }
    private verificationRecord(work: string, id: string, forReview = false) {
        const check = this.s.one('SELECT * FROM check_runs WHERE id=? AND work=?', id, work);
        if (check) {
            const data = parse(check.data);
            const target = data.purpose === 'consumer-control' ? this.version(check.candidate) : undefined;
            const proposal = target?.data.controlProposal;
            const output = proposal && this.s.one("SELECT raw FROM role_outputs WHERE id=? AND launch=? AND status='usable'", proposal.output, proposal.launchId);
            if (proposal && (!output || hash(output.raw) !== proposal.rawHash))
                throw new Error('Original consumer replacement source is unavailable');
            const receipt = {kind:'check-run', ...check, data,
                ...(output ? {consumerReplacementSource:{...proposal, raw:output.raw}} : {})};
            if (!target || !forReview) return receipt;
            const checkpoint = this.row(work), candidate = this.version(checkpoint.candidate);
            const healthy = this.selectedCheck(work, candidate.id, checkpoint.verification, data.check);
            if (!healthy || target.kind !== 'consumer-control' || target.predecessor !== candidate.id ||
                this.consumerControlWitness(work, data.check, healthy).id !== id)
                throw new Error('Consumer control witness has no authenticated current candidate pair');
            return {
                kind: 'consumer-control-run', id,
                reviewedCandidate: {versionId:candidate.id,digest:candidate.hash},
                healthyReceiptId: healthy.id,
                isolatedTarget: {versionId:target.id,digest:target.hash},
                expectedOutcome: consumerControlExpectsPass(data.check.consumerControl) ? 'planned-conforming-pass-matched' : 'planned-adverse-observations-matched',
                executionReceipt: receipt,
            };
        }
        const version = this.s.one("SELECT * FROM change_versions WHERE id=? AND work=? AND kind='scope-evidence'", id, work);
        if (version) return { kind: 'scope-evidence', ...version, data: parse(version.data) };
        const launch = this.s.one("SELECT * FROM role_launches WHERE id=? AND work=? AND role='reviewer'", id, work);
        if (launch) return { kind: 'independent-review', launch, run: this.s.one('SELECT * FROM runs WHERE id=?', launch.run), outputs: this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', id) };
        throw new Error('Typed verification witness identity unavailable');
    }
    private verificationInputBinding(work: string, stage: string, reviewKey: unknown, requirements: readonly { requirementId: string; strategyDigest: string; witnessIds: readonly string[];parts?:StrategyWitness[] }[], premises = this.verificationPremises(work)) {
        return hash({ premises, stage, reviewKey: reviewKey ?? null,
            requirements: requirements.map(item => ({ requirementId: item.requirementId, strategyDigest: item.strategyDigest, witnessIds: item.witnessIds, ...(item.parts?{parts:item.parts}:{}) })),
            evidence: [...new Set(requirements.flatMap(item => [...item.witnessIds]))].sort().map(id => this.verificationRecord(work, id)) });
    }
    private verificationDecisions(work: string, output: RoleResult, expected: readonly { requirementId: string; strategyDigest: string; witnessIds: readonly string[] }[], read = this.createVerificationRead(work), purpose: 'acceptance' | 'accounting' = 'acceptance') {
        if (!read.strategies()) return;
        if (!Array.isArray(output.verificationDecisions) || output.verificationDecisions.length !== expected.length) throw new Error('Independent verification fit decisions incomplete');
        let unavailable: NonNullable<RoleResult['verificationDecisions']>[number] | undefined;
        for (const requirement of expected) {
            const entries = output.verificationDecisions.filter(decision => decision.requirementId === requirement.requirementId);
            const decision = entries[0];
            if (entries.length !== 1 || !decision || decision.strategyDigest !== requirement.strategyDigest ||
                new Set(decision.witnessIds).size !== decision.witnessIds.length ||
                decision.witnessIds.some(id => !requirement.witnessIds.includes(id)) ||
                (decision.verdict === 'satisfied' ? decision.witnessIds.length !== requirement.witnessIds.length : decision.verdict !== 'unavailable'))
                throw new Error('Independent verification fit witness binding changed');
            if (decision.verdict === 'unavailable')
                unavailable ??= decision;
        }
        if (unavailable && purpose === 'acceptance') throw new Error(this.verificationFitReason(unavailable));
        return unavailable;
    }
    private verificationFitReason(decision: NonNullable<RoleResult['verificationDecisions']>[number]) {
        const excerpt = (value: string, limit: number) =>
            JSON.stringify(value.slice(0, limit).replace(/[\p{Cc}\p{Cf}]/gu, ' ') + (value.length > limit ? '…' : ''));
        return `Independent review could not establish verification for ${excerpt(decision.requirementId, 96)}. Reviewer reason: ${excerpt(decision.reason, 280)}`;
    }
    private pendingReviewFindingId(work: string, launches: readonly string[]): string | undefined {
        for (const launch of launches) {
            const finding = this.s.one(`SELECT f.id FROM finding_occurrences f
            JOIN role_outputs r ON r.id=f.output JOIN obligations o ON o.id=f.id AND o.work=f.work
            WHERE f.work=? AND r.launch=? AND json_extract(o.data,'$.state')='pending'
            AND json_extract(f.data,'$.finding.severity')='blocking' ORDER BY f.rowid LIMIT 1`, work, launch);
            if (finding) return finding.id;
        }
    }
    private settledStrategyRun(work: string, launch: { id: string; run: string; epoch: number }, role: 'reviewer' | 'adjudicator') {
        const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
        if (!run || run.work !== work || run.epoch !== launch.epoch || !Number.isSafeInteger(run.epoch) || run.epoch < 1)
            return false;
        const current = this.work(work);
        if (run.epoch > current.epoch || !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > current.generation)
            return false;
        const data = parse(run.data);
        return data.kind === 'governed-role' && data.launchId === launch.id && data.role === role &&
            run.phase === 'SETTLED' && run.reservation === 'consumed' && data.cleanup === 'removed';
    }
    private strategyReviewer(work: string, position: PlanProposal['verification']['reviewRoles'][number], id: string | undefined, witnesses?: ReturnType<ChangeCore['strategyWitnesses']>, read = this.createVerificationRead(work), purpose: 'acceptance' | 'accounting' = 'acceptance', premises?: ReturnType<ChangeCore['verificationPremises']>) {
        const currentWitnesses = witnesses === undefined ? this.strategyWitnesses(work, read) : witnesses;
        const r = this.row(work), launch = id ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', id, work) : null;
        const metadata = launch?.role === 'reviewer' && launch.status === 'COMPLETE' ? parse(launch.data) : undefined;
        if (metadata === undefined || !this.sameNonCandidateBindings(work, metadata.inputVersions, r) || metadata.inputVersions.candidate !== r.candidate)
            throw new Error('Required strategy reviewer unavailable or stale');
        const outputs = this.s.all("SELECT * FROM role_outputs WHERE launch=? AND status='usable' LIMIT 2", launch.id), expected = currentWitnesses.filter(item => this.strategyReviewApplies(item,position.key));
        if (outputs.length !== 1) throw new Error('Required strategy reviewer output missing or ambiguous');
        const output = outputs[0]!;
        const collected = parse(output.data);
        if (metadata.stage !== 'fresh-review' || metadata.reviewKey !== position.key || metadata.purpose !== position.purpose || hash(metadata.requiredPaths) !== hash(position.requiredPaths) ||
            metadata.cleanup !== 'removed' || !this.settledStrategyRun(work, launch, 'reviewer') ||
            metadata.verificationInputBinding !== this.verificationInputBinding(work, 'fresh-review', position.key, expected, premises)) throw new Error('Required strategy reviewer input/provenance changed');
        const parsed = parseRoleOutput(output.raw, 'reviewer', [], { verificationFit: expected });
        if (!parsed.value || parsed.issues.length || hash(parsed.value) !== hash(collected.protocol)) throw new Error('Required strategy reviewer raw protocol changed');
        const unavailable = this.verificationDecisions(work, parsed.value, expected, read, purpose);
        return { launchId: id!, outputId: output.id as string, protocol: parsed.value, unavailable };
    }
    private selectedStrategyReviews(work: string, witnesses: ReturnType<ChangeCore['strategyWitnesses']>, read: VerificationRead,
        purpose: 'acceptance' | 'accounting', premises?: ReturnType<ChangeCore['verificationPremises']>) {
        const r = this.row(work), plan = this.version(r.plan).data.plan as PlanProposal;
        if (!plan.verification.strategies) return [];
        const reviews = plan.verification.reviewRoles.map(position => ({ position, ...this.strategyReviewer(work, position, r.data.selection?.[position.key], witnesses, read, purpose, premises) }));
        if (new Set(reviews.map(review => review.launchId)).size !== reviews.length) throw new Error('Required strategy reviews must remain distinct selected executions');
        return reviews;
    }
    private strategyReviewEvidence(work: string, purpose: 'acceptance' | 'accounting' = 'acceptance', read = this.createVerificationRead(work), premises?: ReturnType<ChangeCore['verificationPremises']>) {
        const witnesses = this.strategyWitnesses(work, read), reviews = this.selectedStrategyReviews(work, witnesses, read, purpose, premises);
        return witnesses.map(witness => ({ ...witness, reviews: reviews.filter(review => this.strategyReviewApplies(witness,review.position.key)).map(review => ({
            launchId: review.launchId, decision: review.protocol.verificationDecisions!.find(decision => decision.requirementId === witness.requirementId)!,
        })) }));
    }
    inspectVerificationEvidence(work: string) {
        return this.verificationEvidence(work, this.createVerificationRead(work));
    }
    private verificationEvidence(work: string, read: VerificationRead) {
        this.h.assertOpen();
        if (!read.strategies()) return undefined;
        const premises = this.verificationPremises(work);
        const r = this.row(work), reviews = this.strategyReviewEvidence(work, 'acceptance', read, premises), judgeId = r.data.verificationJudge;
        const judge = judgeId ? this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', judgeId, work) : null;
        const metadata = judge?.role === 'adjudicator' && judge.status === 'COMPLETE' ? parse(judge.data) : undefined;
        if (metadata === undefined || !this.sameNonCandidateBindings(work, metadata.inputVersions, r) || metadata.inputVersions.candidate !== r.candidate)
            throw new Error('Current independent verification adjudication missing');
        const output = this.s.one('SELECT data FROM role_outputs WHERE launch=?', judge.id);
        const protocol = output ? parse(output.data).protocol as RoleResult : null;
        if (!protocol) throw new Error('Current verification adjudication unavailable');
        const expected = reviews.map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] }));
        if (metadata.stage !== 'review-adjudication' || metadata.cleanup !== 'removed' || !this.settledStrategyRun(work, judge, 'adjudicator') ||
            typeof metadata.verificationInputBinding !== 'string' || metadata.verificationInputBinding !== this.verificationInputBinding(work, 'review-adjudication', undefined, expected, premises)) throw new Error('Current verification adjudication input/provenance changed');
        const parsed = parseRoleOutput(this.s.one("SELECT raw FROM role_outputs WHERE launch=? AND status='usable'", judge.id)?.raw ?? '', 'adjudicator', [], { ...capturedRoleConstraints('adjudicator', metadata), verificationFit: expected });
        if (!parsed.value || parsed.issues.length || hash(parsed.value) !== hash(protocol)) throw new Error('Current verification adjudication raw protocol changed');
        this.verificationDecisions(work, protocol, expected, read);
        const adjudication = { launchId: judge.id as string, decisions: protocol.verificationDecisions! };
        const digest = hash({ premises, strategies: read.strategies(), reviews, judge: adjudication,
            witnessInputs: metadata.verificationInputBinding });
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
            if (!comparison.complete || comparison.descriptorHash !== hash(data.caseDescriptor) || hash(comparison) !== hash(data.caseResults) ||
                parsed.value.assertions.length !== data.check.assertions.length || !data.check.assertions.every((id: string) => parsed.value!.assertions.some(assertion => assertion.id === id)) ||
                !comparison.mismatches.length && baselineAssertionsMatch(data.check, parsed.value.assertions) ||
                this.s.one("SELECT l.id FROM role_launches l JOIN runs r ON r.id=l.run WHERE l.work=? AND l.role IN ('implementer','repairer') AND r.rowid<(SELECT rowid FROM runs WHERE id=?) LIMIT 1", work, row.run)) continue;
            for (const strategy of (oldPlan.data.plan.verification.strategies ?? []).flatMap(verificationStrategyLeaves)) if (strategy.kind === 'base-execution-duty' && strategy.checkId === data.check.id) {
                const requirement = oldPlan.data.plan.requirements.find((requirement: any) => requirement.id === strategy.requirementId);
                if (requirement) failures.push({ requirement, check: data.check, base: base.id });
            }
        }
        return failures;
    }
    private validateConsumerControls(work: string, plan: PlanProposal) {
        const checks = plan.verification.checks.filter(check => check.consumerControl);
        const lastPlan = this.s.one("SELECT data FROM change_versions WHERE work=? AND kind='plan' ORDER BY rowid DESC LIMIT 1", work);
        const prior = lastPlan && (parse(lastPlan.data).plan as PlanProposal).verification.checks.find(check => check.consumerControl);
        const original = prior?.consumerControl;
        if (original && !checks.some(check => check.id === prior.id &&
            check.consumerControl?.path === original.path &&
            check.consumerControl?.replacementPath === original.replacementPath &&
            consumerControlExpectsPass(check.consumerControl) === consumerControlExpectsPass(original)))
            throw new Error('Replanning must retain the independently accepted consumer control');
        if (!checks.length) return;
        if (checks.length !== 1) throw new Error('A plan supports one consumer control');
        const check = checks[0]!, control = check.consumerControl!;
        const leaves = (plan.verification.strategies ?? []).flatMap(verificationStrategyLeaves);
        if (!leaves.some(strategy => strategy.kind === 'consumer-cases' && strategy.checkIds.includes(check.id)) ||
            leaves.some(strategy => strategy.kind === 'base-execution-duty' && strategy.checkId === check.id))
            throw new Error('A consumer control needs a required candidate check');
        const conflict = consumerControlInputConflict(plan);
        if (conflict) throw new Error(conflict);
        const replacementPath = control.replacementPath;
        if (replacementPath !== undefined) {
            const base = this.version(this.row(work).base);
            const replacement = base.data.manifest.files.find((file: {path:string; size:number}) => file.path === replacementPath);
            if (!replacement || replacement.size > 64 * 1024)
                throw new Error('A consumer control needs a captured BASE replacement file at most 64KiB');
        }
        if (control.failedAssertions.some(id => !check.assertions.includes(id)))
            throw new Error('Control failure predictions must name declared assertions');
        if (consumerControlExpectsPass(control) && !check.cases?.some(entry => entry.consumerPaths.includes(control.path)))
            throw new Error('A conforming control must replace a declared consumer for the selected check');
        for (const observation of control.observations) {
            const declared = check.cases?.find(entry => entry.id === observation.id);
            if (!declared?.consumerPaths.includes(control.path) ||
                declared.expected.kind === observation.observed.kind && declared.expected.value === observation.observed.value)
                throw new Error('Each control prediction needs a changed observation for the named consumer');
        }
    }
    private planningValid(plan: PlanProposal, work: string, freshProfile?: PlanningVerificationProfile) {
        if (freshProfile && freshProfile.version >= 4 && plan.verification.checks.some(check => !Array.isArray(check.expectationPaths)))
            throw new Error('Current planning requires explicit expectationPaths for every check; use [] only for no file-based oracle');
        if (freshProfile && freshProfile.version >= 5 && plan.verification.checks.some(check => !Array.isArray(check.cases)))
            throw new Error('Current planning requires an explicit cases array for every check; consumer coverage still needs actual healthy/adverse observations');
        const mode = freshProfile ? this.verificationMode(work) : undefined;
        if (freshProfile && mode && !Object.hasOwn(plan.verification, 'strategies')) throw new Error('Owned typed verification cannot downgrade to legacy during replanning');
        if (freshProfile && plan.verification.strategies?.some(strategy => !verificationStrategySupported(strategy,freshProfile))) throw new Error('Verification strategy kind unavailable in current planning capability');
        if (freshProfile) for (const failure of this.materialBaselineFailures(work)) {
            const requirement = plan.requirements.find(requirement => requirement.text === failure.requirement.text && requirement.source === failure.requirement.source);
            const strategy = requirement && plan.verification.strategies?.flatMap(verificationStrategyLeaves).find(strategy => strategy.requirementId === requirement.id && strategy.kind === 'base-execution-duty');
            if (failure.base !== this.row(work).base || !strategy || strategy.kind !== 'base-execution-duty' ||
                !plan.verification.checks.some(check => check.id === strategy.checkId && hash(check) === hash(failure.check)))
                throw new Error('Material failed baseline premise amendment is unsupported; retain the original requirement, base and exact check declaration. No qualified baseline-amendment or authorized requirement mapping is available.');
        }
        if (freshProfile && mode?.baselinePlanId) {
            if (!freshProfile.baseline.newObservation) throw new Error('Original before-edit witness mapping across a new plan is unsupported; retain the original duty and evidence');
            const old = this.version(mode.baselinePlanId).data.plan as PlanProposal;
            for (const strategy of (old.verification.strategies ?? []).flatMap(verificationStrategyLeaves)) if (strategy.kind === 'base-execution-duty') {
                const original = old.requirements.find(requirement => requirement.id === strategy.requirementId)!;
                if (!plan.requirements.some(requirement => requirement.text === original.text && requirement.source === original.source && plan.verification.strategies?.flatMap(verificationStrategyLeaves).some(next => next.requirementId === requirement.id && next.kind === 'base-execution-duty')))
                    throw new Error('Original before-edit duty cannot be removed or relabelled without qualified historical/owner-source mapping');
            }
        }
        if (freshProfile && (freshProfile.supported ? !Object.hasOwn(plan.verification, 'strategies') : Object.hasOwn(plan.verification, 'strategies')))
            throw new Error(freshProfile.supported ? 'New supported planning acceptance requires explicit complete strategy accounting' : 'Fresh mixed verification capability is unavailable; no historical migration');
        if (freshProfile && freshProfile.version >= 4) {
            const baselineIds = new Set((plan.verification.strategies ?? []).flatMap(verificationStrategyLeaves)
                .filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
            for (const check of plan.verification.checks)
                if (baselineIds.has(check.id) && this.expectations(this.row(work).base, check) === null)
                    throw new CheckExpectationInputError('base');
        }
        if (plan.ambiguities.length)
            throw new Error('Owner clarification required: ' + plan.ambiguities.join(';'));
        if (!plan.requirements.length || !plan.verification.checks.length || !plan.verification.reviewRoles.length)
            throw new Error('Accepted plan lacks requirements/checks/review roster');
        this.validateConsumerControls(work, plan);
        if (freshProfile && freshProfile.version >= 12 && plan.verification.checkAmendments?.length) {
            const base = this.version(this.row(work).base);
            for (const amendment of plan.verification.checkAmendments) {
                const check = plan.verification.checks.find(row => row.id === amendment.correctedCheckId);
                if (check) this.validateAmendmentProbe(base, check, amendment, plan);
            }
        }
        const missingCases = coverageIssue(plan);
        if (missingCases)
            throw new Error(missingCases);
        const allowed = new Set(this.requirementSources(work));
        for (const r of plan.requirements)
            if (!allowed.has(r.source))
                throw new Error('Requirement source is not retained owner intent');
        for (const c of plan.verification.checks) {
            if (!c.guaranteeIds.length || c.guaranteeIds.some(id => !plan.requirements.some(r => r.id === id)))
                throw new Error('Check guarantee source missing');
            if (freshProfile)
                assertCheckHasProgram(c);
        }
        if (freshProfile) {
            const leaves = (plan.verification.strategies ?? []).flatMap(verificationStrategyLeaves);
            const scopes = leaves.filter(strategy => strategy.kind === 'manifest-scope-duty');
            if (scopes.length) {
                const baselineIds = new Set(leaves.flatMap(strategy => strategy.kind === 'base-execution-duty' ? [strategy.checkId] : []));
                const base = this.version(this.row(work).base);
                if (base.work !== work || base.kind !== 'base') throw new Error('Original BASE version does not belong to this work');
                const profile = parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile);
                const manifest = validateScopeManifest(base, profile);
                assertVerificationScopeFeasible(manifest, plan.verification, baselineIds, scopes);
            }
        }
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
    private acceptedAmendments(work: string, plan: PlanProposal, judge: string, accounted: ReadonlySet<string> = new Set()) {
        const pending = this.pending(work), proposals = plan.verification.checkAmendments ?? [];
        const amendments = proposals.map(proposal => {
            const obligation = pendingCheckForAmendment(pending, proposal.obligationId);
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
        const unaccounted = pending.filter(o => !accounted.has(o.id) && (o.kind !== 'check' || !amendments.some(amendment => amendment.obligationId === o.id)));
        this.rejectUnaccountedPlanningObligations(unaccounted);
        return amendments;
    }
    private rejectUnaccountedPlanningObligations(unaccounted: ReturnType<ChangeCore['pending']>) {
        if (!unaccounted.length) return;
        const details = unaccounted.slice(0, 16).map(o => ({ id: o.id, kind: o.kind,
            ...(o.disposition ? { disposition: o.disposition } : {}),
            missing: o.kind === 'finding' ? 'independent resolution or eligible explicit BASE implementation carry'
                : o.kind === 'check' ? 'eligible check amendment; original failure remains pending'
                    : 'required diagnosis or recovery before planning admission' }));
        throw new Error(`Planning cannot defer unaccounted obligations: ${JSON.stringify({ total: unaccounted.length, obligations: details, omitted: Math.max(0, unaccounted.length - details.length) })}. Producer completion is not plan adoption. Inspect retained findings and dispositions; independently account for each listed obligation before requesting continuation. No retry or allowance renewal is implied.`);
    }
    private currentAmendments(work: string): ReturnType<ChangeCore['acceptedAmendments']> {
        const r = this.row(work);
        return r.plan ? this.version(r.plan).data.amendments ?? [] : [];
    }
    private amendmentCheckTargets(work: string) {
        const pending = new Set(this.pending(work).map(obligation => obligation.id));
        return this.currentAmendments(work)
            .map(amendment => ({amendment, pendingResolution: pending.has(amendment.obligationId)}))
            .filter(({amendment, pendingResolution}) => pendingResolution || amendment.negativeReplacement);
    }
    private validateAmendmentProbe(base: ReturnType<ChangeCore['version']>, check: CheckSpec, amendment: CheckAmendmentProposal, plan: PlanProposal) {
        const present = new Set<string>(base.data.manifest.files.map((entry: {path:string}) => entry.path));
        for (const overlay of amendment.fixturePaths) present.add(overlay);
        const cases = check.cases ?? [];
        const missing = [...new Set([...(check.expectationPaths ?? []), ...cases.flatMap(entry => [...entry.consumerPaths, ...entry.input.fixturePaths])])]
            .filter(path => !present.has(path));
        const replacement = amendment.negativeReplacement;
        if (missing.length && !replacement)
            throw new Error(`BASE amendment probe lacks fixed captured inputs: ${JSON.stringify(missing.slice(0, 4).map(path => path.slice(0, 96)))} (${missing.length} missing). Independently plan an exact faulty consumer replacement for a fixture defect, or retain the failure.`);
        if (!replacement) return;
        if (!missing.length || amendment.basis !== 'fixture-defect' || !(plan.verification.strategies ?? []).flatMap(verificationStrategyLeaves)
            .some(strategy => strategy.kind === 'consumer-cases' && strategy.checkIds.includes(check.id)))
            throw new Error('Candidate-derived amendment probe requires a required consumer check with missing BASE inputs and a fixture defect');
        const relevant = amendment.negativeCaseIds?.length ? cases.filter(entry => amendment.negativeCaseIds!.includes(entry.id)) : cases;
        if (!relevant.some(entry => entry.consumerPaths.includes(replacement.path)) ||
            fixedCheckInputRoles(plan.verification.checks, replacement.path).length)
            throw new Error('Amendment replacement must use a declared adverse consumer while keeping oracle and case fixtures fixed');
    }
    private assertAmendmentSubstitution(candidate: ReturnType<ChangeCore['version']>, probe: {hash:string; data:{manifest:Manifest}},
        replacement: NonNullable<CheckAmendmentProposal['negativeReplacement']>) {
        const difference = delta(candidate.data.manifest, probe.data.manifest), file = difference.files[0];
        if (candidate.hash !== hash(effective(candidate.data.manifest)) || probe.hash !== hash(effective(probe.data.manifest)) ||
            difference.files.length !== 1 || file?.path !== replacement.path || !file.before || file.after !== hash(replacement.text) ||
            file.beforeExec !== file.afterExec || difference.dependencyLinks ||
            hash(difference.directories.before) !== hash(difference.directories.after))
            throw new Error('Adverse amendment probe does not match the accepted one-file substitution');
    }
    private candidateAmendmentWitness(work: string, amendment: ReturnType<ChangeCore['acceptedAmendments']>[number]) {
        const r = this.row(work), candidate = this.version(r.candidate);
        const plan = this.version(r.plan), verification = this.version(r.verification);
        const {id, old, corrected, planningJudge, ...proposal} = amendment;
        const declaration = (plan.data.plan as PlanProposal).verification.checkAmendments?.find(row => row.obligationId === proposal.obligationId);
        if (!declaration || hash(declaration) !== hash(proposal) || hash(plan.data.plan) !== plan.hash ||
            verification.hash !== hash(plan.data.plan.verification) || verification.hash !== hash(verification.data.verification) ||
            !(verification.data.verification.checks as CheckSpec[]).some(check => hash(check) === hash(corrected)) ||
            plan.data.decisionLaunch !== planningJudge || hash(this.failedPredicate(work, old.obligation)) !== hash(old))
            throw new Error('Candidate-derived probe lost its accepted amendment or original failure');
        const selected = this.s.one(`SELECT id FROM change_versions WHERE work=? AND kind='fixture-probe' AND predecessor=?
            AND json_extract(data,'$.amendmentId')=? AND json_extract(data,'$.verification')=? ORDER BY rowid DESC LIMIT 1`,
            work, candidate.id, id, r.verification);
        if (!selected || !amendment.negativeReplacement)
            throw new Error('Candidate-derived amendment witness unavailable');
        const probe = this.version(selected.id);
        if (probe.data.recipe !== 'candidate-consumer-replacement' || probe.data.amendmentBinding !== hash(amendment) ||
            probe.data.base !== old.versions.base || probe.data.overlayCandidate !== candidate.id ||
            hash(probe.data.fixturePaths) !== hash(amendment.fixturePaths))
            throw new Error('Candidate-derived probe lost its accepted amendment binding');
        this.assertAmendmentSubstitution(candidate, probe, amendment.negativeReplacement);
        const healthy = this.amendmentCheckReport(work, r, amendment.corrected, candidate, 'required');
        const adverse = this.amendmentCheckReport(work, r, amendment.corrected, probe, 'fixture-amendment-negative');
        if (healthy?.status !== 'pass' || adverse?.status !== 'fail' || adverse.runtime !== healthy.runtime ||
            hash(adverse.failedAssertions) !== hash([...amendment.negativeAssertions].sort()) ||
            hash(adverse.mismatchedCases) !== hash([...(amendment.negativeCaseIds ?? [])].sort()))
            throw new Error('Candidate-derived amendment probe lacks exact passing and adverse reports');
        return adverse;
    }
    private async amendmentProbes(work: string, options: {
        signal?: AbortSignal;
    }) {
        const r = this.row(work), current = this.version(r.candidate), profile = parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile);
        const proofs: any[] = [];
        const witnesses: Array<{amendment: ReturnType<ChangeCore['acceptedAmendments']>[number]; probe: ReturnType<ChangeCore['version']>; healthySource: string; adverseSource: string}> = [];
        for (const {amendment, pendingResolution} of this.amendmentCheckTargets(work)) {
            const old = this.failedPredicate(work, amendment.old.obligation);
            if (hash(old) !== hash(amendment.old))
                throw new Error('Amended old predicate binding changed');
            const before = amendment.old.obligation.expectations ?? [], after = this.expectations(r.candidate, amendment.corrected) ?? [];
            if ((amendment.fixturePaths.length && (!Array.isArray(amendment.old.obligation.expectations) || !Array.isArray(amendment.corrected.expectationPaths))) || before.length !== after.length)
                throw new Error('Missing corrected expectation input');
            const changed = after.filter((file: any) => hash(file) !== hash(before.find((old: any) => old.path === file.path))).map((file: any) => file.path);
            if ((!changed.length && !(amendment.caseIds ?? []).length) || hash([...changed].sort()) !== hash([...amendment.fixturePaths].sort()))
                throw new Error('Exact nonempty changed expectation overlay required');
            const check = amendment.corrected;
            const healthy = this.amendmentCheckReport(work, r, check, current, 'required');
            if (!healthy || healthy.status !== 'pass')
                throw new Error('Corrected predicate lacks actual healthy current candidate');
            const base = this.version(old.versions.base), staging = path.join(this.h.options.installationHome, 'inputs', randomUUID());
            const replacement = amendment.negativeReplacement, parent = replacement ? current : base;
            const targetLabel = replacement ? 'Candidate-derived' : 'Base-derived';
            await materialize(parent.artifact, staging, profile, parent.hash, this.operations.get(work)!.handle.abort.signal);
            if (replacement) {
                if (!current.data.manifest.files.some((file: {path:string}) => file.path === replacement.path))
                    throw new Error('Amendment consumer replacement requires a captured regular candidate file');
                await fs.writeFile(safePath(staging, replacement.path), replacement.text);
            }
            for (const file of replacement ? [] : amendment.fixturePaths) {
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
            if (replacement) this.assertAmendmentSubstitution(current, {hash:receipt.digest, data:{manifest:receipt.manifest}}, replacement);
            const probe = this.newVersion(work, 'fixture-probe', target, { manifest: receipt.manifest, amendmentId: amendment.id, base: base.id, overlayCandidate: r.candidate, fixturePaths: amendment.fixturePaths,
                ...(replacement ? {recipe:'candidate-consumer-replacement', amendmentBinding:hash(amendment), verification:r.verification} : {}) }, receipt.digest, parent.id);
            const result = await this.executeCheck(work, check, options, probe, 'fixture-amendment-negative');
            const targetVersion = this.version(probe);
            const adverse = this.amendmentCheckReport(work, r, check, targetVersion, 'fixture-amendment-negative');
            if (adverse?.id !== result.id || adverse.run !== result.runId || adverse.runtime !== healthy.runtime) {
                this.s.run('INSERT INTO obligations VALUES(?,?,?)', `diagnostic-probe-${result.runId}`, work, JSON.stringify({ kind: 'diagnostic', producer: 'check', runId: result.runId, receipt: result.id, amendmentId: amendment.id, state: 'pending', issues: 'Adverse checker producer unavailable; no adequacy claim' }));
                throw new Error(targetLabel + ' probe producer unavailable; diagnose exact receipt before explicit retry');
            }
            if (receipt.digest === current.hash || adverse.status !== 'fail' ||
                hash(adverse.mismatchedCases) !== hash([...(amendment.negativeCaseIds ?? [])].sort()) ||
                hash(adverse.failedAssertions) !== hash([...amendment.negativeAssertions].sort())) {
                const error = new Error(targetLabel + ' probe did not demonstrate exact named adverse assertions/case mismatches; repair checker before repeating healthy/adverse verification');
                Object.assign(error, { repairableProbe: true });
                throw error;
            }
            witnesses.push({amendment, probe: targetVersion, healthySource: healthy.source, adverseSource: adverse.source});
            if (pendingResolution)
                proofs.push({ amendmentId: amendment.id, candidate: r.candidate, plan: r.plan, verification: r.verification, healthy: healthy.id, probe: result.id, probeVersion: probe, probeDigest: receipt.digest });
        }
        if (witnesses.length) {
            const latest = this.row(work);
            if (hash(this.checkBoundVersions(latest, latest.candidate)) !== hash(this.checkBoundVersions(r, current.id)))
                throw new Error('Amendment verification bindings changed during the probes');
            for (const {amendment, probe, healthySource, adverseSource} of witnesses) {
                const check = amendment.corrected;
                if (this.amendmentCheckReport(work, latest, check, current, 'required')?.source !== healthySource)
                    throw new Error('Corrected predicate lacks actual healthy current candidate');
                const adverse = amendment.negativeReplacement ? this.candidateAmendmentWitness(work, amendment)
                    : this.amendmentCheckReport(work, latest, check, probe, 'fixture-amendment-negative');
                if (adverse?.source !== adverseSource)
                    throw new Error('Adverse probe evidence changed during amendment verification');
            }
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
            if (amendment.negativeReplacement && this.candidateAmendmentWitness(work, amendment).id !== proof.probe)
                throw new Error('Check resolution no longer names the original candidate-derived adverse receipt');
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
    /** A current structural observation of one authenticated failed planner, not a new verdict. */
    private async currentPlanningDiagnostics(work: string, failure: ReturnType<ChangeCore['priorPlanningFailure']>) {
        if (!failure || failure.version !== 1 || failure.workId !== work) return;
        const newest = () => this.s.one("SELECT * FROM role_launches WHERE work=? AND json_extract(data,'$.stage') IN ('planning','planning-challenge','planning-adjudication') ORDER BY rowid DESC LIMIT 1", work);
        const launch = newest(), owner = this.work(work);
        if (!launch || launch.role !== 'planner' || launch.status !== 'UNUSABLE' || launch.epoch !== failure.epoch || owner.generation !== failure.generation) return;
        const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = parse(launch.data), rd = run && parse(run.data);
        const selected = this.historicalSelectedOutputs(launch.id), output = selected.length === 1 ? selected[0] : undefined, md = output && parse(output.data);
        const diagnostic = this.s.one('SELECT * FROM obligations WHERE work=? AND id=?', work, `diagnostic-${launch.id}`), duty = diagnostic && parse(diagnostic.data);
        if (!run || run.work !== work || run.epoch !== launch.epoch || run.generation !== failure.generation || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
            ld.stage !== 'planning' || rd.kind !== 'governed-role' || rd.role !== 'planner' || rd.launchId !== launch.id || ld.cleanup !== 'removed' || rd.cleanup !== 'removed' ||
            !rd.historyRef || ld.historyRef !== rd.historyRef || !rd.nativeCheckpoint || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId ||
            !output || output.status !== 'unusable' || typeof output.raw !== 'string' || md.protocol !== null || md.historyRef !== rd.historyRef || !md.nativeEntryId || md.terminal !== 'complete' || md.rawFinalTruncated !== false ||
            duty?.kind !== 'diagnostic' || duty.launchId !== launch.id || duty.output !== output.id || duty.rawComplete !== true || !Array.isArray(duty.issues) ||
            !duty.issues.length || duty.issues.some((issue: unknown) => typeof issue !== 'string' || !issue.length) ||
            !Array.isArray(md.issues) || hash(md.issues) !== hash(duty.issues) || !failure.messages.includes('ControllerError: ' + duty.issues.join('; '))) return;
        const rows = () => hash([this.s.one('SELECT * FROM role_launches WHERE id=?', launch.id), this.s.one('SELECT * FROM runs WHERE id=?', run.id), this.historicalSelectedOutputs(launch.id)]);
        const history = () => {
            const stat = lstatSync(rd.historyRef, {bigint:true});
            if (!stat.isFile() || stat.nlink !== 1n) throw Error('Retained planning diagnostic history unavailable');
            return hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String));
        };
        let identity: string;
        try { identity = history(); } catch { return; }
        const before = rows();
        const assertCurrent = () => {
            this.guard(work);
            if (rows() !== before || history() !== identity) throw Error('Retained planning diagnostic source changed');
        };
        let entries: Awaited<ReturnType<ChangeCore['nativeEntries']>>;
        try { entries = await this.nativeEntries(run.id); } catch { assertCurrent(); return; }
        assertCurrent();
        if (hash(newest()) !== hash(launch) || hash(this.s.one('SELECT * FROM obligations WHERE id=? AND work=?', diagnostic.id, work)) !== hash(diagnostic))
            throw Error('Retained planning diagnostic selection changed');
        try {
            if (readSelectedRoleOutput(entries, {entryId:md.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:'planner',
                checkpointLeafId:rd.nativeCheckpoint.leafId,nativeIntent:ld.nativeRoleIntent,stage:'planning',strictLegacyBlocks:true}, md.nativeSource) !== output.raw) return;
        } catch { return; } // Unsupported custody supplies no supplemental diagnosis.
        const issues = parseCapturedRoleOutput(output.raw, 'planner', ld).issues;
        if (!issues.length) return;
        let view = {version:1,kind:'current-planner-structural-diagnostics',workId:work,launchId:launch.id,runId:run.id,outputId:output.id,
            epoch:launch.epoch,generation:run.generation,rawSha256:hash(output.raw),checkpointSha256:rd.nativeCheckpoint.sha256,
            issues:[] as string[],omittedIssues:issues.length,
            interpretation:'Current structural parser observation of the exact retained failed planner output. Separate from historical host failures; no semantic judgment, repaired plan, finding disposition, retry or action authority. Original raw, status and diagnostics remain unchanged.'};
        for (const issue of issues.slice(0,16)) {
            const next = {...view,issues:[...view.issues,issue],omittedIssues:issues.length-view.issues.length-1};
            if (Buffer.byteLength(JSON.stringify(next),'utf8') <= 4096) view = next;
        }
        if (!view.issues.length) return;
        return {view,assertCurrent};
    }
    private async planInner(options: ChangeOperation, scopeReplan?: ReturnType<ChangeCore['captureScopeReplan']>, assertCheckReplan?: () => void,
        coverageReplan?: ReturnType<ChangeCore['captureVerificationReplan']>) {
        const work = options.workId;
        const originalCheckpoint = this.row(work);
        const planningProfile = this.verificationSupport(work).capability;
        const blockPlanning = (blocked: string[], planningClarification?: {launchId: string; outputId: string; outputHash: string}) => {
            const preserveCheckpoint = scopeReplan || coverageReplan;
            const phase = preserveCheckpoint ? originalCheckpoint.phase : 'BLOCKED';
            const clarification = planningClarification ? {...planningClarification, phase, kind: scopeReplan ? 'scope-replan' : 'planning'} : null;
            if (preserveCheckpoint) this.phase(work, phase, {
                blocked: [...new Set([...blocked, ...(originalCheckpoint.data.blocked ?? [])])].slice(0, 16),
                planningClarification: clarification,
                resumeStage: originalCheckpoint.data.resumeStage ?? null, nextAction: originalCheckpoint.data.nextAction,
            });
            else this.phase(work, phase, { blocked, planningClarification: clarification, resumeStage: 'plan', nextAction: `Inspect original planning blockers and role records in /work ${work} before explicitly continuing this same work. Preserve original evidence and consumed allowance.` });
            return this.inspect(work);
        };
        try {
            if (coverageReplan) {
                const evidence = await this.selectedReviewEvidence(work, { reviews: originalCheckpoint.data.selection });
                this.guard(work);
                coverageReplan.assertCurrent();
                if (!evidence.reviews.some(review => review.outputId === coverageReplan.subject.producerOutputId))
                    throw Error('Original verification finding has no selected native reviewer evidence');
            }
            if (planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation) throw new Error('Original before-first-edit duty has no supported cross-plan mapping; no new planning producer admitted');
            const r = this.row(work);
            if (!r.base)
                throw new Error('Base unavailable');
            for (const obligation of this.pending(work)) {
                if (obligation.kind === 'check')
                    this.failedPredicate(work, obligation);
                else if (obligation.kind !== 'finding' && !scopeReplan?.failures.some(entry => entry.row.id === obligation.id))
                    throw new Error('Unsupported planning hold remains unresolved');
            }
            const priorPlanningFailure = this.priorPlanningFailure(work, r);
            const diagnostics = await this.currentPlanningDiagnostics(work, priorPlanningFailure);
            this.guard(work);
            // Prefix recovery can reuse a challenge, but adoption always needs a new adjudicator.
            this.assertAvailableAllowance(work, 'planner', 'planning');
            this.phase(work, 'PLANNING', { blocked: [], planningClarification: null, nextAction: 'planChange' });
            const reused = [] as NonNullable<Awaited<ReturnType<ChangeCore['planningPrefix']>>>[];
            let assertPlanner = () => {}, assertRepairSources = () => {};
            const scopeInput = scopeReplan ? { scopeReplanEvidence: scopeReplan.evidence, scopeReplanOriginalPlan: scopeReplan.original } : {};
            const coverageInput = coverageReplan ? { verificationReplan: coverageReplan.context } : {};
            const assertPrefix = () => { scopeReplan?.assertCurrent(); coverageReplan?.assertCurrent(); assertCheckReplan?.(); assertRepairSources(); diagnostics?.assertCurrent(); for (const producer of reused) producer.assertCurrent(); assertPlanner(); };
            const planner = scopeReplan || coverageReplan ? undefined : await this.planningPrefix(options, 'planner');
            if (planner) reused.push(planner);
            const a = planner?.value ?? await this.role(options, 'planner', { stage: 'planning', ...scopeInput, ...coverageInput, ...(priorPlanningFailure ? { priorPlanningFailure } : {}), ...(diagnostics ? { currentPlanningDiagnostics: diagnostics.view } : {}) }, false, assertPrefix);
            if (!a.protocol.plan)
                throw new Error('Planner omitted plan');
            let proposalDiagnostics: Record<string, unknown> | undefined;
            let proposalApproval: { version: 1; plannerOutputId: string; proposalHash: string; plannerOutputHash: string } | undefined;
            if (planningProfile.supported && a.inputScope?.version === 1 && a.inputScope.workId === work &&
                a.inputScope.outputId === a.output && a.inputScope.launchId === a.launchId && a.inputScope.role === 'planner' && a.inputScope.stage === 'planning') {
                const output = this.s.one('SELECT * FROM role_outputs WHERE id=?', a.output), metadata = output && parse(output.data);
                const selectedEntryId = 'execution' in a ? (a.execution as RoleExecution).selectedFinalEntryId : metadata?.nativeEntryId;
                if (!output || output.launch !== a.launchId || output.status !== 'usable' || typeof output.raw !== 'string' ||
                    hash(parseCapturedRoleOutput(output.raw, 'planner', parse(this.s.one('SELECT data FROM role_launches WHERE id=?',a.launchId).data)).value) !== hash(a.protocol) || !metadata?.protocol || hash(metadata.protocol) !== hash(a.protocol) ||
                    hash(this.inputScopeReceipt(work, a.launchId, a.output, 'planner', 'planning', selectedEntryId)) !== hash(a.inputScope))
                    throw Error('Selected planner record changed before independent challenge');
                const outputHash = this.planningOutputHash(output), scopeHash = hash(a.inputScope);
                const originalRun = this.s.one('SELECT * FROM runs WHERE id=?', a.runId), sourceHash = originalRun && parse(originalRun.data).sourceInputHash;
                const pendingChecks = () => this.pending(work).filter(item => item.kind === 'check');
                const premises = () => hash({
                    launch: this.s.one('SELECT * FROM role_launches WHERE id=?', a.launchId),
                    run: this.s.one('SELECT * FROM runs WHERE id=?', a.runId),
                    bindings: this.bindings(work), source: this.h.sourceImpacts(work),
                    profile: this.verificationSupport(work).capability,
                    pendingChecks: pendingChecks().map(item => item.id),
                });
                const premisesHash = premises();
                assertPlanner = () => {
                    const current = this.s.one('SELECT * FROM role_outputs WHERE id=?', a.output), run = this.s.one('SELECT * FROM runs WHERE id=?', a.runId), data = run && parse(run.data);
                    if (premises() !== premisesHash || !current || this.planningOutputHash(current) !== outputHash || !run || !data || data.kind !== 'governed-role' || data.role !== 'planner' ||
                        data.launchId !== a.launchId || data.sourceInputHash !== sourceHash ||
                        hash(this.inputScopeReceipt(work, a.launchId, a.output, 'planner', 'planning', selectedEntryId)) !== scopeHash)
                        throw Error('Selected planner record changed at the planning handoff');
                };
                assertPlanner();
                try {
                    this.planningValid(a.protocol.plan, work, planningProfile);
                    const proposed = new Set(a.protocol.plan.verification.checkAmendments?.map(amendment => amendment.obligationId));
                    this.rejectUnaccountedPlanningObligations(pendingChecks().filter(item => !proposed.has(item.id)));
                    proposalApproval = { version: 1, plannerOutputId: a.output, proposalHash: hash(a.protocol.plan), plannerOutputHash: this.planningOutputHash(output) };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    proposalDiagnostics = {
                        version: 2, kind: 'current-proposal-validation', workId: work, launchId: a.launchId, outputId: a.output,
                        proposalHash: hash(a.protocol.plan), plannerOutputHash: outputHash, inputScopeHash: scopeHash,
                        planningProfileHash: hash(planningProfile), premisesHash,
                        issue: message.slice(0, 1024), omittedMessageCharacters: Math.max(0, message.length - 1024),
                        interpretation: 'Host validation observation of this exact current proposal at the planning handoff. Independent challenge and adjudication remain required. No semantic verdict, corrected plan, finding disposition, retry or action authority is supplied.',
                    };
                    const remaining = 8192 - Buffer.byteLength(JSON.stringify(proposalDiagnostics)) - 64;
                    const references = verificationReferenceDiagnostics(a.protocol.plan, Math.min(4096, remaining));
                    if (references) proposalDiagnostics.referenceDiagnostics = references;
                    if (Buffer.byteLength(JSON.stringify(proposalDiagnostics)) > 8192) throw Error('Current proposal diagnostics exceed bounded profile');
                }
            }
            const proposalFeedback = proposalDiagnostics ? { currentProposalDiagnostics: proposalDiagnostics } : {};
            const challenger = scopeReplan || coverageReplan ? undefined : await this.planningPrefix(options, 'challenger', a, proposalDiagnostics);
            if (challenger) reused.push(challenger);
            assertPrefix();
            const b = challenger?.value ?? await this.role(options, 'challenger', { stage: 'planning-challenge', ...scopeInput, ...coverageInput, ...proposalFeedback, ...(priorPlanningFailure ? { priorPlanningFailure } : {}), ...(diagnostics ? { currentPlanningDiagnostics: diagnostics.view } : {}), planProposal: a.protocol.plan, plannerOutput: a.protocol, plannerInputScope: a.inputScope,
                ...(planningProfile.version >= 8 ? {plannerPlanReference: 1} : {}) }, false, assertPrefix);
            assertPrefix();
            const repairSources = await this.historicalPlanningOperands(work, {});
            assertRepairSources = repairSources.assertCurrent;
            assertPrefix();
            const syntheticRepairSubjects = new Set(this.diagnosisSubjectIds(work));
            const repairSubjects = repairSources.value.links.filter(link=>!syntheticRepairSubjects.has(link.occurrenceId)).map(link=>({
                occurrenceId:link.occurrenceId,proposalHash:link.planHash,producerOutputId:link.producerOutputId,
            }));
            const planningRepair = capturePlanningRepair(coverageReplan ? {version:2,subjects:repairSubjects,verification:coverageReplan.subject}
                : {version:1,subjects:repairSubjects});
            const j = await this.role(options, 'adjudicator', { stage: 'planning-adjudication', planningRepair, ...scopeInput, ...coverageInput,
                ...(scopeReplan ? { scopeAmendment: scopeReplan.profile } : {}), ...proposalFeedback, ...(priorPlanningFailure ? { priorPlanningFailure } : {}), ...(diagnostics ? { currentPlanningDiagnostics: diagnostics.view } : {}), planProposal: a.protocol.plan, ...(proposalApproval ? { proposalApproval } : {}), challenge: b.protocol, plannerInputScope: a.inputScope, challengerInputScope: b.inputScope, occurrences: this.inspect(work).occurrences }, false, assertPrefix);
            assertPrefix();
            j.assertInputCurrent();
            const judgeRows = () => hash([
                this.s.one('SELECT * FROM role_launches WHERE id=?', j.launchId),
                this.s.one('SELECT * FROM runs WHERE id=?', j.runId),
                this.s.one('SELECT * FROM role_outputs WHERE id=?', j.output),
            ]), judgeHash = judgeRows();
            const originalJudge = await this.historicalPlanningProducer(work, j.output);
            const references = adjudicationDecisionReferences('adjudicator', originalJudge.ld);
            if (!references || originalJudge.launch.id !== j.launchId || originalJudge.launch.role !== 'adjudicator' ||
                originalJudge.launch.status !== 'COMPLETE' || originalJudge.output.status !== 'usable' || originalJudge.ld.stage !== 'planning-adjudication' ||
                hash(originalPlanningProtocol(originalJudge.output, originalJudge.ld)) !== hash(j.protocol) ||
                hash(adjudicationDecisionReferences('adjudicator', originalJudge.context)) !== hash(references) ||
                hash(originalJudge.context.occurrences.map((o: any) => o.id)) !== hash(references.occurrenceIds) ||
                references.occurrenceIds.some(id => {
                    const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?', id, work);
                    return !occurrence || parse(occurrence.data).launchId === j.launchId;
                })) throw Error('Independent planning accounting lost its original supplied subjects');
            const assertAccountingCurrent = () => {
                assertPrefix();j.assertInputCurrent();originalJudge.assertCurrent();
                if (judgeRows() !== judgeHash) throw Error('Independent planning judgment changed before accounting');
            };
            assertAccountingCurrent();
            const originalPending = captureCurrentPendingSubjects(references, originalJudge.context.producerDiagnostics);
            const diagnosisProofs = await this.prevalidateDiagnoses(work, j);
            const baseClassifications = await this.prevalidateBaseClassifications(work,j.launchId,j.protocol);
            assertAccountingCurrent();
            const coveragePlan = coverageReplan && this.acceptedPlanningProposal(work, j.launchId, j.protocol, a.launchId);
            const coverageDecision = coverageReplan && (j.protocol.decisions ?? []).find(decision => isVerificationPlanRepair(decision, planningRepair));
            let coverageRepair: VerificationPlanRepair | undefined;
            if (coverageReplan) {
                if (!j.protocol.planAccepted || j.protocol.ownerDecisionRequired?.length || !coverageDecision || !coveragePlan)
                    return blockPlanning(['Independent planning did not adopt a correction for the original verification gap.']);
                if (hash(originalJudge.context.verificationReplan ?? null) !== hash(coverageReplan.context) ||
                    hash(planningRepairProfile('adjudicator', originalJudge.context) ?? null) !== hash(planningRepair) ||
                    !coverageDecision.witnesses.some(id => coverageReplan.context.witnessIds.includes(id)))
                    throw Error('Verification correction needs its original retained witness and independent pending decision');
                const {originalPlan, originalVerification, candidate, subject, context} = coverageReplan;
                const prior = this.pendingVerificationPlanRepair(work);
                if (prior && prior !== subject.occurrenceId && !(j.protocol.decisions ?? []).some(decision =>
                    decision.occurrenceId === prior && decision.disposition === 'equivalent' && decision.equivalentTo === subject.occurrenceId))
                    throw Error('A further verification correction must preserve the previous finding as an independently equivalent pending duty');
                coverageRepair = { originalPlan, originalVerification, candidate, subject, requirementId: context.requirementId,
                    checkIds: verificationCaseAdditions(context.originalPlan, coveragePlan, context.requirementId) };
            }
            const planRepairs = new Map<string, PlanningRepairEvidence>();
            const repairDecisions = (j.protocol.decisions ?? []).filter(decision=>decision.repair?.kind==='plan');
            if (repairDecisions.length) {
                if (hash(planningRepairProfile('adjudicator',originalJudge.context) ?? null) !== hash(planningRepair) ||
                    hash(planningRepairProfile('adjudicator',originalJudge.ld) ?? null) !== hash(planningRepair)) throw Error('Planning repair lost its original captured source domain');
                const repairedPlan = this.acceptedPlanningProposal(work,j.launchId,j.protocol,a.launchId);
                if (!j.protocol.planAccepted || j.protocol.ownerDecisionRequired?.length || !repairedPlan) throw Error('Plan repair needs actual independent accepted-plan adoption');
                this.planningValid(repairedPlan,work,planningProfile);
                const acceptedPlanHash = changedPlanningRepairHash(repairedPlan, repairDecisions);
                for (const decision of repairDecisions) {
                    const subject = planningRepair.subjects.find(subject=>subject.occurrenceId===decision.occurrenceId && subject.proposalHash===decision.repair!.proposalHash);
                    const occurrence = this.s.one('SELECT * FROM finding_occurrences WHERE id=? AND work=?',decision.occurrenceId,work);
                    const origin = occurrence && this.s.one('SELECT * FROM role_outputs WHERE id=?',occurrence.output);
                    if (!subject || !occurrence || occurrence.output!==subject.producerOutputId || !origin || origin.launch===j.launchId ||
                        decision.disposition!=='upheld' || decision.resolution!=='repaired' || !decision.witnesses.length ||
                        decision.implementation || decision.implementationCarry)
                        throw Error('Plan repair needs distinct original proposal, independent current judgment and changed accepted plan');
                    planRepairs.set(decision.occurrenceId,{version:1,kind:'plan',...subject,acceptedPlanHash,judgeLaunchId:j.launchId});
                }
            }
            // Judge only the original supplied domain. New independent J claims
            // remain pending; omitted negative decisions do not fabricate closure.
            const accountPlanning = () => {
                assertAccountingCurrent();
                this.dispositions(work, j.launchId, j.protocol, { occurrenceIds: references.occurrenceIds, pendingUnjudged: 'planning-accounting' }, occurrence=>planRepairs.has(occurrence.id) ? false : this.repairedProof(work,occurrence,(j.protocol.decisions??[]).find(d=>d.occurrenceId===occurrence.id)!.witnesses,baseClassifications.get(occurrence.id)), diagnosisProofs, baseClassifications);
            };
            if (!coverageRepair) this.s.tx(accountPlanning);
            assertCurrentPendingAccounting(j.protocol, originalPending);
            if (j.protocol.ownerDecisionRequired?.length) {
                const output = this.s.one('SELECT * FROM role_outputs WHERE id=? AND launch=? AND status=?', j.output, j.launchId, 'usable');
                return blockPlanning(['Error: Independent planning requires an explicit owner decision: ' + j.protocol.ownerDecisionRequired.join('; ')],
                    output ? {launchId:j.launchId, outputId:j.output, outputHash:this.planningOutputHash(output)} : undefined);
            }
            if (!j.protocol.planAccepted) {
                const points = Array.from(j.protocol.summary);
                const preview = JSON.stringify(points.slice(0, 128).join('')).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
                    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
                const omitted = points.length > 128 ? ' [summary shortened]' : '';
                return blockPlanning([
                    `Independent planning did not accept the proposal. Adjudicator output ${j.output}: ${preview}${omitted}`,
                    ...(proposalDiagnostics ? ['Host: original proposal validation at handoff: ' + proposalDiagnostics.issue + (proposalDiagnostics.omittedMessageCharacters ? ' [message truncated]' : '')] : []),
                ]);
            }
            if (hash(this.verificationSupport(work).capability) !== hash(planningProfile)) throw new Error('Planning verification capability changed');
            const accepted = this.acceptedPlanningProposal(work, j.launchId, j.protocol, a.launchId);
            if (!accepted) throw new Error('New finite planning acceptance requires an explicit plan or qualified bound approval');
            assertPrefix();
            originalJudge.assertCurrent();
            if (judgeRows() !== judgeHash) throw Error('Selected planning judgment changed before adoption');
            if (hash(this.acceptedPlanningProposal(work, j.launchId, j.protocol, a.launchId) ?? null) !== hash(accepted) || hash(this.verificationSupport(work).capability) !== hash(planningProfile)) throw Error('Selected planning approval changed before adoption');
            const scopeAmendments = scopeReplan && this.planScopeAmendments(scopeReplan, accepted, originalJudge.context, j.protocol);
            // No asynchronous work follows before the plan and its dispositions are committed.
            this.adoptCriteria(work, j.protocol);
            const applyInputDecisions = this.prepareInputDecisions(work, j.launchId, { ...j.protocol, acceptedPlan: accepted }, !!scopeReplan);
            this.planningValid(accepted, work, planningProfile);
            // Adoption still requires the complete post-harvest census. In
            // particular, a J cannot independently account for its own new claim.
            const assertOccurrenceCensus = () => {
                for (const occurrence of this.s.all('SELECT * FROM finding_occurrences WHERE work=?', work))
                    if (!this.s.one('SELECT id FROM finding_dispositions WHERE occurrence=?', occurrence.id))
                        throw Error(`Raw occurrence unaccounted: ${occurrence.id}`);
            };
            if (!coverageRepair) assertOccurrenceCensus();
            this.s.tx(() => {
                scopeReplan?.assertCurrent();
                if (coverageRepair) {
                    accountPlanning();
                    assertOccurrenceCensus();
                }
                applyInputDecisions();
                const implementationCarries = this.acceptedImplementationCarries(work, accepted, j.launchId, j.protocol,baseClassifications);
                const adoptionRemedies = new Set(implementationCarries.map(item => item.occurrenceId));
                const plannedRepair = (id:string,seen=new Set<string>()):boolean => {
                    if (seen.has(id)) throw Error('Planning repair equivalence cycle');
                    seen.add(id);
                    if (planRepairs.has(id) || coverageRepair?.subject.occurrenceId === id) return true;
                    const decision=(j.protocol.decisions??[]).find(decision=>decision.occurrenceId===id);
                    return decision?.disposition==='equivalent' && !!decision.equivalentTo && plannedRepair(decision.equivalentTo,seen);
                };
                for (const decision of j.protocol.decisions??[]) if (plannedRepair(decision.occurrenceId)) adoptionRemedies.add(decision.occurrenceId);
                if (coverageRepair && (implementationCarries.length || this.pending(work).some(duty => !adoptionRemedies.has(duty.id))))
                    throw Error('Retained candidate cannot skip outstanding implementation or other unrelated duties');
                for (const amendment of scopeAmendments ?? []) adoptionRemedies.add(amendment.failure.row.id);
                const amendments = this.acceptedAmendments(work, accepted, j.launchId, adoptionRemedies);
                const previousMode = this.verificationMode(work);
                const verificationProfile = Object.hasOwn(accepted.verification, 'strategies') ? { version: 1, kind: 'finite-mixed', strategyDigest: hash(accepted.verification.strategies), decisionLaunch: j.launchId } : undefined;
                const carryProfile=planningDecisionCarry('adjudicator',parse(this.s.one('SELECT data FROM role_launches WHERE id=?',j.launchId).data));
                const scopeTransition = scopeReplan && scopeAmendments ? { profile: scopeReplan.profile, originalPlan: scopeReplan.priorPlan,
                    adjudicatorOutput: j.output, amendments: scopeAmendments.map(({decision, failure}) => ({decision, originalDuty: failure.row})) } : undefined;
                const plan = this.newVersion(work, 'plan', null, { ...(verificationProfile ? { verificationProfile } : {}), ...(carryProfile?.version===3?{implementationCarryProfile:carryProfile}:{}), plan: accepted, amendments, implementationCarries, ...(scopeTransition ? { scopeTransition } : {}), ...(planRepairs.size ? {planningRepairs:[...planRepairs.values()]} : {}), ...(coverageRepair ? {coverageRepair} : {}), criteriaDecision: j.protocol.criteriaDecision ?? null, authorLaunch: a.launchId, challengeLaunch: b.launchId, decisionLaunch: j.launchId }, hash(accepted));
                if (planRepairs.size) {
                    this.dispositions(work,j.launchId,{...j.protocol,decisions:repairDecisions,retainedDispositions:[]},
                        {occurrenceIds:references.occurrenceIds,pendingUnjudged:'planning-accounting'},occurrence=>{
                            const proof=planRepairs.get(occurrence.id);
                            if (!proof || proof.acceptedPlanHash!==hash(accepted)) throw Error('Plan repair adoption binding changed');
                            return {...proof,planVersion:plan};
                        },diagnosisProofs,baseClassifications);
                }
                const requirements = this.newVersion(work, 'requirements', null, { requirements: accepted.requirements, intent: accepted.intent, source: this.work(work).source, decisionLaunch: j.launchId }, hash({ requirements: accepted.requirements, intent: accepted.intent }));
                const requirementNumber = this.s.one('SELECT MAX(version) AS v FROM requirements WHERE work=?', work).v + 1;
                this.s.run('INSERT INTO requirements VALUES(?,?,?,?)', work, requirementNumber, this.row(work).data.request, JSON.stringify({ status: 'independently-adjudicated', english: accepted.intent, requirementsVersion: requirements, decision: j.launchId }));
                const verification = this.newVersion(work, 'verification', null, { verification: accepted.verification, ...(verificationProfile ? { verificationProfile } : {}) }, hash(accepted.verification));
                this.s.run('UPDATE change_state SET plan=?,verification=?,phase=?,data=? WHERE work=?', plan, verification, coverageRepair ? 'CANDIDATE_CAPTURED' : 'PLAN_READY', JSON.stringify({ ...this.row(work).data, ...(verificationProfile ? { verificationProfileMode: { version: 1, kind: 'finite-mixed', ...(previousMode?.baselinePlanId ? { baselinePlanId: previousMode.baselinePlanId } : accepted.verification.strategies?.flatMap(verificationStrategyLeaves).some(strategy => strategy.kind === 'base-execution-duty') ? { baselinePlanId: plan } : {}) } } : {}), blocked: [], ...(coverageRepair ? { resumeStage:null } : {}), nextAction: coverageRepair ? 'checkChange' : 'implementChange', requirementVersion: requirements, selection: {}, authorLaunches: coverageRepair ? originalCheckpoint.data.authorLaunches ?? [] : [], verificationJudge: null, pendingNit: null, carry: null, amendmentProofs: [], criteriaRefresh: null }), work);
                if (scopeAmendments) this.applyScopeAmendments(work, plan, scopeAmendments);
            });
            this.acceptOwnVersions(work);
            return this.inspect(work);
        }
        catch (error) {
            if (error instanceof ManagedReviewChanged) {
                const {blocked, planningClarification, nextAction} = originalCheckpoint.data;
                this.phase(work, originalCheckpoint.phase, { blocked, planningClarification, nextAction });
                throw error;
            }
            return blockPlanning([String(error)]);
        }
    }
    private matchesVerificationGapFinding(protocol: RoleResult, occurrence: { ordinal: number; data: string }, launchId: string, requirementId: string) {
        const finding = protocol.findings?.[occurrence.ordinal];
        if (finding?.requirementId !== requirementId || finding.severity !== 'blocking' || finding.repair !== 'substantive') return false;
        const origin = parse(occurrence.data);
        return origin.launchId === launchId && origin.role === 'reviewer' && hash(origin.finding) === hash(finding);
    }
    private selectedVerificationGap(work: string) {
        const row = this.row(work);
        const read = this.createVerificationRead(work);
        if (!this.pendingReviewFindingId(work, Object.values(row.data.selection ?? {})) || !read.strategies() || !this.candidateChecksCurrent(work, read))
            return;
        const witnesses = this.strategyWitnesses(work, read), reviews = this.selectedStrategyReviews(work, witnesses, read, 'accounting');
        for (const witness of witnesses) {
            for (const review of reviews) {
                const decision = review.protocol.verificationDecisions?.find(item => item.requirementId === witness.requirementId && item.verdict === 'unavailable');
                if (!decision) continue;
                const pending = this.s.all(`SELECT f.id,f.ordinal,f.data FROM finding_occurrences f JOIN obligations o ON o.id=f.id AND o.work=f.work
                    WHERE f.work=? AND f.output=? AND json_extract(o.data,'$.kind')='finding'
                    AND json_extract(o.data,'$.occurrence')=f.id AND json_extract(o.data,'$.state')='pending' ORDER BY f.ordinal`, work, review.outputId);
                for (const occurrence of pending) {
                    if (this.matchesVerificationGapFinding(review.protocol, occurrence, review.launchId, witness.requirementId))
                        return { findingId: occurrence.id as string, outputId: review.outputId, decision, witness };
                }
            }
        }
    }
    private inspectConsumerVerificationGap(work: string, selected?: ReturnType<ChangeCore['selectedVerificationGap']>): ChangeResultView['verificationGap'] {
        try {
            const gap = selected ?? this.selectedVerificationGap(work);
            if (!gap || gap.witness.kind !== 'consumer-cases') return;
            const row = this.row(work), plan = this.version(row.plan);
            const strategy = (plan.data.plan as PlanProposal).verification.strategies?.find(item => item.requirementId === gap.decision.requirementId);
            if (strategy?.kind !== 'consumer-cases' || strategy.requirementId.length > 96) return;
            const passingChecks = strategy.checkIds.filter(id => id.length <= 96).slice(0, 8);
            if (passingChecks.length) return { requirementId: strategy.requirementId, findingId: gap.findingId,
                passingChecks, omittedChecks: strategy.checkIds.length - passingChecks.length };
        } catch {
            // The result still carries its original blocker if current attribution cannot be established.
        }
    }
    private captureVerificationReplan(work: string) {
        const r = this.row(work), owner = this.work(work);
        if (r.phase !== 'BLOCKED' || r.data.resumeStage !== null || owner.state !== 'ACTIVE' ||
            !r.plan || !r.verification || !r.candidate || this.workflowCriteriaHold(work) || this.hasPendingSourceInput(work) ||
            this.pending(work).some(item => item.kind !== 'finding')) return;
        try {
            const selected = this.selectedVerificationGap(work), plan = this.version(r.plan);
            if (!selected || selected.witness.kind !== 'consumer-cases') return;
            const subject = { occurrenceId: selected.findingId, producerOutputId: selected.outputId, proposalHash: plan.hash };
            const witnessIds = selected.witness.witnessIds;
            const context = { originalPlan: plan.data.plan as PlanProposal, requirementId: selected.decision.requirementId,
                assessment: selected.decision, witnessIds, witnessDigest: hash(witnessIds.map(id => this.verificationRecord(work, id))), ...subject };
            if (hash(context.originalPlan) !== plan.hash || Buffer.byteLength(JSON.stringify(context)) > 128 * 1024) return;
            const original = this.s.one('SELECT t.data FROM role_outputs o JOIN role_launches l ON l.id=o.launch JOIN runs t ON t.id=l.run WHERE o.id=?', selected.outputId);
            const history = original && parse(original.data).historyRef;
            const historyIdentity = this.materialHistoryIdentity(history);
            if (!historyIdentity) return;
            const operands = (gap: ReturnType<ChangeCore['selectedVerificationGap']>, identity: string | null) =>
                hash([this.reviewEvidenceBinding(work), gap, this.version(r.candidate), this.version(r.verification), identity]);
            const expected = operands(selected, historyIdentity);
            const fingerprint = hash([expected, this.budget(work, 'execution'), this.budget(work, 'resolution')]);
            return { subject, context, selected, candidate: r.candidate as string, originalPlan: r.plan as string, originalVerification: r.verification as string,
                fingerprint,
                assertCurrent: () => {
                    if (this.hasPendingSourceInput(work) || operands(this.selectedVerificationGap(work), this.materialHistoryIdentity(history)) !== expected)
                        throw Error('Original verification gap changed before planning');
                } };
        } catch { return; }
    }
    private unchangedRepairHold(work: string) {
        const row = this.row(work);
        if (row.data.verificationJudge && this.verificationView(work).availability === 'available')
            return { reason: 'The current verification remains recorded and findings still need an independent decision.',
                nextAction: `Inspect the open findings in /work ${work}. Resume to adjudicate the unchanged candidate.`, continuation: 'resolve' };
        const gap = this.selectedVerificationGap(work);
        if (gap) return { reason: this.verificationFitReason(gap.decision),
            nextAction: `Inspect the retained verification finding and passing check in /work ${work}. Repeating the unchanged repair does not change this evidence.`,
            continuation: null, evidence: hash(gap) };
    }
    private async implementInner(options: ChangeOperation, repair = false, assertScopeCurrent: () => void = () => {},
        scopeDiagnostic?: ScopeViolationSample & {evidenceId: string; requirementId: string}) {
        const work = options.workId, r = this.row(options.workId);
        try {
            if (!r.plan || (!repair && r.phase !== 'PLAN_READY') || (repair && !r.candidate))
                throw new Error('Accepted current plan required before authoring');
            const recovery=repair ? this.checkOutputRecovery(work) : undefined;
            recovery?.assertAvailable();
            recovery?.assertCurrent();
            const assertVerification = await this.beforeAuthorVerification(options);
            const assertRepairCurrent=()=>{assertVerification();recovery?.assertCurrent();assertScopeCurrent();};
            this.guard(work);assertRepairCurrent();
            const author = await this.role(options, repair ? 'repairer' : 'implementer', { stage: repair ? 'substantive-repair' : 'implementation', acceptedPlan: this.version(r.plan).data.plan, openObligations: this.pending(work), ...(scopeDiagnostic ? {scopeDiagnostic} : {}), ...(recovery?.view?{purpose:recovery.view.purpose,checkOutputRecovery:recovery.view}:{}) }, true, assertRepairCurrent);
            const id = randomUUID(), target = path.join(this.h.options.installationHome, 'inputs', id), project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project);
            const receipt = await freeze(author.staging, target, parse(project.profile), this.operations.get(work)!.handle.abort.signal);
            this.guard(work);
            const before = r.candidate ? this.version(r.candidate) : this.version(r.base);
            const unchangedHold = repair && !scopeDiagnostic && !recovery?.view && receipt.digest === before.hash &&
                !this.s.one('SELECT f.id FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE f.work=? AND o.launch=? LIMIT 1', work, author.launchId)
                ? this.unchangedRepairHold(work) : undefined;
            if (unchangedHold) {
                await fs.rm(target, { recursive: true });
                this.guard(work); assertRepairCurrent();
                if (hash(this.unchangedRepairHold(work) ?? null) !== hash(unchangedHold))
                    throw Error('Original unchanged repair evidence changed before retention');
                return this.blocked(work, 'Repair left the candidate unchanged. ' + unchangedHold.reason, unchangedHold.nextAction, unchangedHold.continuation);
            }
            const candidate = this.newVersion(work, 'candidate', target, { manifest: receipt.manifest, producer: author.launchId, delta: delta(this.version(r.base).data.manifest, receipt.manifest) }, receipt.digest, before.id);
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
            return this.blocked(work, String(error), error instanceof CheckExpectationInputError && error.target === 'base'
                ? 'planChange' : repair ? 'repairChange' : 'implementChange');
        }
    }
    private pending(work: string) {
        return this.s.all('SELECT * FROM obligations WHERE work=?', work).filter(o => parse(o.data).state !== 'resolved').map(o => ({ id: o.id, ...parse(o.data) }));
    }
    private checkBoundVersions(row: ReturnType<ChangeCore['row']>, candidate: string) {
        return {base: row.base, candidate, plan: row.plan, verification: row.verification,
            requirements: row.data.requirementVersion, contracts: row.data.contractsVersion};
    }
    private assertCheckExpectations(r: ReturnType<ChangeCore['row']>, check: CheckSpec, candidateId: string, purpose: string) {
        if (purpose !== 'baseline' && Object.hasOwn(check, 'baselineExpectedFailures'))
            throw new Error('Expected assertion failures belong only to the original BASE observation');
        if (r.plan) {
            const plan = this.version(r.plan), judge = plan.data.decisionLaunch && this.s.one('SELECT data FROM role_launches WHERE id=? AND work=?', plan.data.decisionLaunch, r.work);
            const profile = judge && readPlanningVerificationProfile('adjudicator', parse(judge.data));
            if (profile && profile.version >= 4 && this.expectations(candidateId, check) === null)
                throw new CheckExpectationInputError(purpose === 'baseline' ? 'base' : 'candidate');
        }
    }
    private async executeCheck(work: string, check: CheckSpec, options: {
        signal?: AbortSignal;
    }, candidateId: string, purpose = 'required') {
        check = structuredClone(check);
        const r = this.row(work), candidate = this.version(candidateId), receiptId = randomUUID();
        this.assertCheckExpectations(r, check, candidateId, purpose);
        const target = purpose === 'baseline' ? { kind: 'base', versionId: candidateId, digest: candidate.hash, candidateAtDispatch: r.candidate } : { kind: 'candidate', versionId: candidateId, digest: candidate.hash };
        const verificationPremises = purpose === 'baseline' ? this.verificationPremises(work, false) : undefined;
        if (purpose === 'baseline' && (candidateId !== r.base || candidate.kind !== 'base')) throw new Error('Baseline execution requires the original immutable base');
        const boundVersions = this.checkBoundVersions(r, candidateId);
        const staging = path.join(this.h.options.installationHome, 'inputs', randomUUID()), a = this.reserve(work, null, { checkId: check.id, purpose, boundVersions }, staging), handle = this.operations.get(work)!.handle;
        const dispatchAuthority = purpose === 'baseline' ? { workId: work, sourceId: this.work(work).source, runId: a.runId, epoch: this.work(work).epoch, generation: this.work(work).generation } : undefined;
        if (purpose === 'baseline') this.h.patchRun(a.runId, 'CREATED', { dispatchAuthority, purpose, checkBinding: hash(check), checkTarget: target, verificationPremises, boundVersions });
        const stop = () => handle.abort.abort();
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        let lease: CapacityLease | undefined;
        let scope: ContainerScope | undefined, status = 'unavailable', data: any = {}, cleanup = 'not-allocated', runtimeAttempted = false;
        const activity: NonNullable<Handle['check']> = { id: check.id, phase: 'preparing' };
        handle.check = activity;
        try {
            lease = await this.h.acquireCapacity({ workId: work, runId: a.runId, epoch: this.work(work).epoch, kind: 'check', signal: handle.abort.signal });
            this.h.entry(a.runId);
            const project = this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project);
            await materialize(candidate.artifact, staging, parse(project.profile), candidate.hash, handle.abort.signal);
            const descriptor = caseDescriptor(check, candidate, boundVersions, a.runId);
            const assertionRoster = JSON.stringify(buildAssertionRoster(check, descriptor)) + '\n';
            const assertionRosterSha256 = createHash('sha256').update(assertionRoster).digest('hex');
            const inputRoot = path.join(this.h.options.installationHome, 'inputs', randomUUID());
            await privateDirectory(inputRoot);
            await fs.writeFile(path.join(inputRoot, path.basename(verificationCommandContract.descriptorPath)), JSON.stringify(descriptor) + '\n', { flag: 'wx', mode: 0o444 });
            await fs.writeFile(path.join(inputRoot, path.basename(verificationCommandContract.assertionRosterPath)), assertionRoster, { flag: 'wx', mode: 0o444 });
            await fs.chmod(inputRoot, 0o755);
            const protectedPaths = await scopeProtection(this.s, a.runId, staging);
            scope = await createScope({ ...a.runtimeProfile!, workRoot: staging, stateRoot: path.join(this.h.state, 'runtime'), workId: work, runId: a.runId, inputRoot, protectedPaths, readOnlyWork: true, signal: handle.abort.signal }, () => {
                this.h.entry(a.runId);
                this.h.patchRun(a.runId, 'RUNTIME_CREATING', { assertionRosterSha256 });
                runtimeAttempted = true;
            });
            handle.scope = scope;
            this.h.patchRun(a.runId, 'RUNNING', { containerId: scope.containerId });
            this.h.entry(a.runId);
            activity.phase = 'running';
            const began = performance.now(), actual = await scope.execute(check.command, { cwd: '/work', timeoutMs: check.timeoutMs, signal: handle.abort.signal });
            const { parseCheckOutput } = await import('../workflow/index.js');
            const parsed = parseCheckOutput(actual.stdout);
            const assertions = parsed.value?.assertions ?? [];
            const { comparison: caseResults, diagnosis: outputDiagnosis } = observeCheckOutput(check, descriptor, parsed.value);
            const assertionsMatch = purpose === 'baseline' ? baselineAssertionsMatch(check, assertions) : check.assertions.length === assertions.length && check.assertions.every((id: string) => assertions.some((v: any) => v.id === id && v.passed));
            status = actual.exitCode === 0 && !actual.termination && !parsed.issues.length && outputDiagnosis.complete && !caseResults.mismatches.length && assertionsMatch ? 'pass' : actual.termination || parsed.issues.length || !caseResults.complete || actual.exitCode === 0 && !outputDiagnosis.complete ? 'unavailable' : 'fail';
            data = { actual, parsed, caseResults, outputDiagnosis, caseDescriptor: descriptor, caseInputRoot: inputRoot, expectations: this.expectations(candidateId, check), durationMs: performance.now() - began, argv: ['/bin/bash', '-lc', check.command], cwd: '/work', inputHash: hash({ candidate: candidate.hash, verification: r.verification, check, runtime: a.runtimeProfile }), check };
        }
        catch (error) {
            data = { error: String(error), check };
        }
        finally {
            activity.phase = 'settling';
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
                this.s.setWorkStateAt(work, 'UNKNOWN', a.epoch, a.generation);
            options.signal?.removeEventListener('abort', stop);
            if (handle.check === activity)
                delete handle.check;
        }
        this.guard(work);
        return { id: receiptId, status, data: { ...data, boundVersions, target, ...(verificationPremises ? { verificationPremises, dispatchAuthority } : {}) }, runId: a.runId };
    }
    private requireConsumerPass(checkpoint: ReturnType<ChangeCore['row']>, check: CheckSpec,
        candidate: ReturnType<ChangeCore['version']>, row: {data:string; run:string; work:string; status:string}) {
        try {
            const report = this.completeBoundCheckReport(check, candidate, this.checkBoundVersions(checkpoint, candidate.id), row);
            if (row.status !== 'pass' || report.failedAssertions.length || report.mismatchedCases.length)
                throw new Error('Original report contains failed assertions or mismatched cases');
            return report;
        } catch (error) {
            throw new Error(`Required consumer check ${JSON.stringify(check.id.slice(0, 96))} lacks an authenticated passing report`, {cause: error});
        }
    }
    private selectedConsumerControl(work: string, check: CheckSpec, healthyId?: string) {
        const r = this.row(work);
        const receipt = check.consumerControl?.replacementPath === undefined ? healthyId ?? null : null;
        return this.s.one(`SELECT * FROM change_versions WHERE work=? AND kind='consumer-control' AND predecessor=?
            AND json_extract(data,'$.checkBinding')=? AND json_extract(data,'$.verification')=?
            AND (? IS NULL OR json_extract(data,'$.controlProposal.healthyReceipt')=?) ORDER BY rowid DESC LIMIT 1`,
            work, r.candidate, hash(check), r.verification, receipt, receipt);
    }
    private recordedConsumerControl(work: string, check: CheckSpec, healthy: {id:string; data:string; run:string; work:string; status:string} | undefined):
        Pick<ChangeResultView['checks']['entries'][number], 'consumerControl' | 'consumerControlExpectedPass' | 'consumerControlReceiptId'> {
        const expected = consumerControlExpectsPass(check.consumerControl) ? {consumerControlExpectedPass: true as const} : {};
        try {
            if (!this.selectedConsumerControl(work, check, healthy?.id)) return {...expected, consumerControl: 'pending'};
            if (!healthy) return {...expected, consumerControl: 'held'};
            const receipt = this.consumerControlWitness(work, check, healthy);
            return {...expected, consumerControl: 'matched', consumerControlReceiptId: receipt.id};
        } catch (error) {
            return {...expected, consumerControl: error instanceof ConsumerControlMismatch ? 'prediction-mismatch' : 'held'};
        }
    }
    private consumerProposalSource?: {fingerprint:string; raw:string};
    private reviewerControlText(work: string, check: CheckSpec, healthy: {id:string; run:string; source:string},
        locator: {launchId:string; output:string; rawHash:string}) {
        const r = this.row(work);
        if (!locator) throw new Error('Independent consumer replacement record is missing');
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?', locator.launchId, work);
        const output = launch && this.s.one("SELECT * FROM role_outputs WHERE id=? AND launch=? AND status='usable'", locator.output, launch.id);
        const run = launch && this.s.one('SELECT * FROM runs WHERE id=? AND work=?', launch.run, work);
        const metadata = launch && parse(launch.data), producer = run && parse(run.data);
        const binding = hash({versions:this.checkBoundVersions(r,r.candidate), check, healthy});
        if (launch?.role !== 'reviewer' || launch.status !== 'COMPLETE' ||
            metadata.stage !== 'consumer-control-proposal' || metadata.consumerControlProposal?.binding !== binding ||
            metadata.cleanup !== 'removed' || !this.sameNonCandidateBindings(work, metadata.inputVersions) ||
            metadata.inputVersions.candidate !== r.candidate ||
            !run || launch.epoch !== run.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
            !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.epoch > this.work(work).epoch ||
            !Number.isSafeInteger(run.generation) || run.generation < 1 || run.generation > this.work(work).generation ||
            producer?.kind !== 'governed-role' || producer.role !== 'reviewer' || producer.launchId !== launch.id || producer.cleanup !== 'removed' ||
            !output || hash(output.raw) !== locator.rawHash)
            throw new Error('Independent consumer replacement no longer matches its original inputs and output');
        const collected = parse(output.data);
        if (collected.terminal !== 'complete' || collected.rawFinalTruncated !== false || collected.omittedFindingCount !== 0 ||
            !collected.nativeEntryId || !producer.nativeSessionId || !producer.nativeCheckpoint ||
            metadata.nativeSessionId !== producer.nativeSessionId || !producer.historyRef ||
            metadata.historyRef !== producer.historyRef || collected.historyRef !== producer.historyRef)
            throw new Error('Original independent consumer replacement was not completely captured');
        const identity = nativeHistoryIdentity(producer.historyRef);
        if (!identity) throw new Error('Original independent consumer replacement history is unavailable');
        const selection = {entryId:collected.nativeEntryId, sessionId:producer.nativeSessionId,
            launchId:launch.id, role:'reviewer', checkpointLeafId:producer.nativeCheckpoint.leafId,
            stage:metadata.stage, nativeIntent:metadata.nativeRoleIntent};
        const fingerprint = hash([identity,producer.nativeCheckpoint,selection,collected.nativeSource]);
        if (this.consumerProposalSource?.fingerprint !== fingerprint) {
            const entries = expandNativeTransport(readNativeCheckpointEntries(producer.historyRef, producer.nativeCheckpoint));
            const raw = readSelectedRoleOutput(entries, selection, collected.nativeSource);
            if (nativeHistoryIdentity(producer.historyRef) !== identity)
                throw new Error('Original independent consumer replacement history changed during validation');
            this.consumerProposalSource = {fingerprint, raw};
        }
        if (this.consumerProposalSource.raw !== output.raw)
            throw new Error('Original independent consumer replacement differs from its native output');
        const parsed = parseRoleOutput(output.raw, 'reviewer', [], {consumerControlProposal:consumerControlExpectsPass(check.consumerControl) ? 'pass' : true});
        if (parsed.issues.length || !parsed.value?.consumerReplacement || hash(parsed.value) !== hash(collected.protocol))
            throw new Error('Independent consumer replacement report is unavailable');
        return parsed.value.consumerReplacement;
    }
    private async prepareReviewerControl(options: ChangeOperation, check: CheckSpec) {
        const work = options.workId, r = this.row(work);
        const candidate = this.version(r.candidate), control = check.consumerControl!;
        const row = this.selectedCheck(work, candidate.id, r.verification, check);
        if (!row || !this.candidateChecksCurrent(work))
            throw new Error('Current candidate checks must pass before requesting a consumer replacement');
        const original = this.requireConsumerPass(r, check, candidate, row);
        const priorMismatch = () => {
            try { this.consumerControlWitness(work, check, row); }
            catch (error) {
                if (error instanceof ConsumerControlMismatch) return error;
                throw error;
            }
        };
        const attempt = this.selectedConsumerControl(work, check, row.id);
        const previous = attempt ? priorMismatch() : undefined;
        if (attempt && !previous) return;
        const healthy = {id:row.id,run:row.run,source:hash([row.data,original.run])};
        const versions = this.checkBoundVersions(r,candidate.id);
        const assertInputs = () => {
            const current = this.row(work), receipt = this.selectedCheck(work, current.candidate, current.verification, check);
            if (!receipt || receipt.id !== healthy.id || receipt.run !== healthy.run ||
                hash(this.checkBoundVersions(current,current.candidate)) !== hash(versions) ||
                hash([receipt.data,this.requireConsumerPass(current,check,candidate,receipt).run]) !== healthy.source)
                throw new Error('Healthy consumer report changed while obtaining an independent replacement');
            if (previous && priorMismatch()?.fingerprint !== previous.fingerprint)
                throw new Error('Previous consumer control observations changed while obtaining a new proposal');
        };
        const binding = hash({versions, check, healthy});
        const proposal = await this.role(options, 'reviewer', {stage:'consumer-control-proposal', purpose:consumerControlExpectsPass(control) ? 'Propose an isolated conforming variation for the required check' : 'Propose an isolated faulty replacement for the required check',
            requiredPaths:[control.path], consumerControlProposal:{binding, checkId:check.id, checkCommand:check.command, ...control,
                ...(previous ? {previousAttempt:previous.feedback} : {})}},
            false, assertInputs);
        proposal.assertInputCurrent();
        const output = this.s.one('SELECT raw FROM role_outputs WHERE id=? AND launch=?', proposal.output, proposal.launchId);
        if (!output) throw new Error('Independent consumer replacement output unavailable');
        const locator = {launchId:proposal.launchId, output:proposal.output, rawHash:hash(output.raw), healthyReceipt:healthy.id};
        const replacement = this.reviewerControlText(work, check, healthy, locator);
        const assertCurrent = () => {
            assertInputs();
            if (this.reviewerControlText(work, check, healthy, locator) !== replacement)
                throw new Error('Original independent consumer replacement changed before execution');
        };
        await this.runConsumerControl(work, check, options, {locator, replacement, assertCurrent});
    }
    private consumerControlWitness(work: string, check: CheckSpec, healthy: {id:string; data:string; run:string; work:string; status:string}) {
        const r = this.row(work), candidate = this.version(r.candidate), base = this.version(r.base);
        const control = check.consumerControl!;
        const original = this.requireConsumerPass(r, check, candidate, healthy);
        const target = this.selectedConsumerControl(work, check, healthy.id);
        if (!target) throw new Error('Required consumer control has no current execution');
        const version = this.version(target.id);
        const adverse = this.selectedCheck(work, version.id, r.verification, check);
        if (!adverse || !['pass', 'fail'].includes(adverse.status))
            throw new Error('Required consumer control has no usable current report');
        const difference = delta(candidate.data.manifest, version.data.manifest);
        const file = difference.files[0];
        const replacement = base.data.manifest.files.find((item: {path:string}) => item.path === control.replacementPath);
        const proposedText = control.replacementPath === undefined ?
            this.reviewerControlText(work, check, {id:healthy.id,run:healthy.run,source:hash([healthy.data,original.run])}, version.data.controlProposal) : undefined;
        const digest = proposedText === undefined ? replacement?.sha256 : hash(proposedText);
        if (!digest || candidate.hash === version.hash || version.hash !== hash(effective(version.data.manifest)) ||
            difference.files.length !== 1 ||
            file?.path !== control.path || !file.before || file.after !== digest || file.beforeExec !== file.afterExec ||
            difference.dependencyLinks || hash(difference.directories.before) !== hash(difference.directories.after))
            throw new Error('Required consumer control changed outside the accepted replacement');
        const report = this.completeBoundCheckReport(check, version, this.checkBoundVersions(r, version.id), adverse, 'consumer-control');
        if (hash(parse(original.run.data).runtimeProfile) !== hash(parse(report.run.data).runtimeProfile))
            throw new Error('Required consumer control used a different runtime');
        if (adverse.status !== (report.failedAssertions.length || report.mismatchedCases.length ? 'fail' : 'pass'))
            throw new Error('Required consumer control verdict differs from its report');
        const expected = new Map(control.observations.map(entry => [entry.id, entry.observed]));
        const observed = new Map(report.output.cases?.map(entry => [entry.id, entry.observed]));
        const failed = new Set(report.failedAssertions), plannedFailed = new Set(control.failedAssertions);
        const mismatches = new Set(report.mismatchedCases);
        const differences = {
            'missing case failures': controlIds([...expected.keys()].filter(id => !mismatches.has(id))),
            'additional case failures': controlIds([...mismatches].filter(id => !expected.has(id))),
            'different predicted observations': controlIds([...mismatches].filter(id => {
                const prediction = expected.get(id), actual = observed.get(id);
                return !!prediction && (prediction.kind !== actual?.kind || prediction.value !== actual.value);
            })),
            'missing false assertions': controlIds([...plannedFailed].filter(id => !failed.has(id))),
            'additional false assertions': controlIds([...failed].filter(id => !plannedFailed.has(id))),
        };
        if (Object.values(differences).some(group => group.count))
            throw new ConsumerControlMismatch(hash([target,adverse,report.run]), adverse.id, differences, proposedText);
        return adverse;
    }
    private async runConsumerControl(work: string, check: CheckSpec, options: {signal?: AbortSignal},
        proposal?: {locator:{launchId:string;output:string;rawHash:string; healthyReceipt:string}; replacement:string; assertCurrent:()=>void}) {
        const r = this.row(work), candidate = this.version(r.candidate), base = this.version(r.base);
        const control = check.consumerControl!, staging = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        const profile = parse(this.s.one('SELECT profile FROM projects WHERE id=?', this.work(work).project).profile);
        const signal = this.operations.get(work)!.handle.abort.signal;
        const original = candidate.data.manifest.files.find((file: {path:string}) => file.path === control.path);
        let bytes: Buffer;
        if (proposal) {
            bytes = Buffer.from(proposal.replacement, 'utf8');
        } else {
            if (!control.replacementPath) throw new Error('Required independent consumer replacement unavailable');
            const replacement = base.data.manifest.files.find((file: {path:string}) => file.path === control.replacementPath);
            const source = safePath(base.artifact, control.replacementPath);
            const stat = await fs.lstat(source);
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024)
                throw new Error('Consumer control replacement must be a captured regular file within 64KiB');
            bytes = await fs.readFile(source);
            const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
            if (bytes.includes(0) || hash(text) !== replacement?.sha256)
                throw new Error('Consumer control replacement must match the captured UTF-8 text');
        }
        if (!original || original.sha256 === hash(bytes.toString('utf8')))
            throw new Error('Required consumer control needs distinct captured replacement and candidate bytes');
        await materialize(candidate.artifact, staging, profile, candidate.hash, signal);
        await fs.writeFile(safePath(staging, control.path), bytes);
        const target = path.join(this.h.options.installationHome, 'inputs', randomUUID());
        const captured = await freeze(staging, target, profile, signal);
        this.guard(work);
        proposal?.assertCurrent();
        const version = this.newVersion(work, 'consumer-control', target,
            {manifest: captured.manifest, checkBinding: hash(check), verification: r.verification,
                ...(proposal ? {controlProposal:proposal.locator} : {})}, captured.digest, candidate.id);
        const result = await this.executeCheck(work, check, options, version, 'consumer-control');
        const healthy = this.selectedCheck(work, candidate.id, r.verification, check);
        if (!healthy || this.consumerControlWitness(work, check, healthy).id !== result.id)
            throw new Error('Current consumer control receipt unavailable');
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
            const coverage = await this.prevalidateVerificationPlanRepair(work);
            this.version(r.candidate);
            if (!only && r.plan) {
                const plan = this.version(r.plan).data.plan as PlanProposal;
                for (const {amendment} of this.amendmentCheckTargets(work))
                    this.validateAmendmentProbe(this.version(amendment.old.versions.base), amendment.corrected, amendment, plan);
            }
            if (!this.observeScopeStrategies(work)) return this.inspect(work);
            for (const check of this.requiredCandidateChecks(work, only)) {
                coverage?.assertCurrent();
                const result = await this.executeCheck(work, check, options, r.candidate);
                const { status, data } = result;
                this.guard(work); coverage?.assertCurrent();
                if (status === 'unavailable') {
                    const receipt = this.s.one('SELECT id FROM check_runs WHERE work=? AND run=?', work, result.runId).id;
                    this.s.run('INSERT INTO obligations VALUES(?,?,?)', `diagnostic-check-${result.runId}`, work, JSON.stringify({ kind: 'diagnostic', producer: 'check', runId: result.runId, receipt, checkId: check.id, checkBinding: hash(check), state: 'pending', issues: data.error || (data.parsed?.issues?.length ? data.parsed.issues : undefined) || (data.outputDiagnosis && !data.outputDiagnosis.complete ? data.outputDiagnosis : undefined) || data.actual?.termination || 'Unavailable checker output' }));
                    const recovery = this.checkOutputRecovery(work).view;
                    const repeated = recovery && this.repeatsCheckFailure(work, check, 'unavailable');
                    this.phase(work, 'BLOCKED', { blocked: [repeated ? `Required check ${check.id} produced the same unusable output after an unchanged repair` :
                        `Required check ${check.id} producer unavailable; no material assertion failure inferred`],
                        nextAction: repeated ? this.repeatedCheckReportAction(work, 'unavailable') : recovery?.nextAction ??
                            'Diagnose retained checker receipt; explicit run/resume retries the current check without inferring a software failure',
                        resumeStage: recovery ? 'repair' : 'checks' });
                    return this.inspect(work);
                }
                if (status !== 'pass') {
                    const obligation = `check-${r.candidate}-${check.id}-${hash(check)}`;
                    this.s.run('INSERT OR REPLACE INTO obligations VALUES(?,?,?)', obligation, work, JSON.stringify({ kind: 'check', checkId: check.id, candidate: r.candidate, verification: r.verification, checkBinding: hash(check), check, failedReceipt: result.id, boundVersions: data.boundVersions, expectations: this.expectations(r.candidate, check), guaranteeIds: check.guaranteeIds, caseMismatches: data.caseResults?.mismatches ?? [], state: 'pending' }));
                    if (status === 'fail' && this.repeatsCheckFailure(work, check, 'fail'))
                        return this.blocked(work, `Unchanged candidate repeats the same material failure in required check ${check.id}`,
                            this.repeatedCheckReportAction(work, 'fail'), 'repair');
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
            if (!only) {
                const control = (this.version(r.verification).data.verification.checks as CheckSpec[]).find(check => check.consumerControl);
                if (control?.consumerControl?.replacementPath) {
                    try { await this.runConsumerControl(work, control, options); }
                    catch (error) {
                        return this.blocked(work, String(error),
                            'Inspect the consumer control receipt. Correct the checker or independently replan the predicted observations before repeating verification.', 'checks');
                    }
                }
                await this.amendmentProbes(work, options);
            }
            coverage?.assertCurrent();
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
            const pendingControl = r.verification && (this.version(r.verification).data.verification.checks as CheckSpec[])
                .find(check => check.consumerControl && check.consumerControl.replacementPath === undefined);
            this.phase(work, 'REVIEWING', { blocked: [], nextAction: 'reviewChange' });
            if (pendingControl) {
                try { await this.prepareReviewerControl(options, pendingControl); }
                catch (error) {
                    const nextAction = error instanceof ConsumerControlMismatch ?
                        `Inspect the observed differences in /work ${work}. Use /change resume ${work} to request one new independent replacement on the same passing candidate.` :
                        'Inspect the independent consumer replacement and its check before repeating review.';
                    return this.blocked(work, String(error), nextAction, 'review');
                }
            }
            if (!this.checksCurrent(work))
                throw new Error('Required current checks incomplete/failed');
            const plan = this.version(r.plan).data.plan, selected = { ...(r.data.selection ?? {}) };
            const read = this.createVerificationRead(work);
            const typedReview = !!read.strategies();
            let unavailable: NonNullable<RoleResult['verificationDecisions']>[number] | undefined;
            for (const roster of plan.verification.reviewRoles) {
                const key = typeof roster === 'string' ? roster : roster.key;
                if (selected[key]) {
                    if (!typedReview) continue;
                    try {
                        const prior = this.strategyReviewer(work, roster, selected[key], undefined, read, 'accounting');
                        unavailable ??= prior.unavailable;
                        continue;
                    }
                    catch { delete selected[key]; } // Explicit review action replaces a stale selection, retaining its original history.
                }
                const review = await this.role(options, 'reviewer', { stage: 'fresh-review', reviewKey: key, purpose: typeof roster === 'string' ? 'general' : roster.purpose, requiredPaths: typeof roster === 'string' ? [] : roster.requiredPaths, delta: this.version(r.candidate).data.delta });
                if (this.pending(work).some(o => o.kind === 'reproduction-unresolved'))
                    throw new Error('Declared reproduction needs exact actual receipt on retained candidate before review replacement can complete');
                if (typedReview) {
                    const expected = this.strategyWitnesses(work, read).filter(item => this.strategyReviewApplies(item, key));
                    const decision = this.verificationDecisions(work, review.protocol, expected, read, 'accounting');
                    unavailable ??= decision;
                }
                selected[key] = review.launchId;
                this.phase(work, 'REVIEWING', { selection: selected });
            }
            if (unavailable && !this.pendingReviewFindingId(work, Object.values(selected)))
                return this.blocked(work, this.verificationFitReason(unavailable), `Inspect the retained verification assessment in /work ${work} before changing the evidence or method.`, 'review');
            this.phase(work, 'RESOLVING', { blocked: [], selection: selected, nextAction: 'resolveChange' });
            return this.inspect(work);
        }
        catch (error) {
            return this.blocked(work, String(error), 'reviewChange');
        }
    }
    /** Execution and recovery share current declarations and retained, unamended check duties. */
    private requiredCandidateChecks(work: string, only?: string[]) {
        const r = this.row(work), verification = this.version(r.verification).data.verification;
        const baseChecks = this.baselineCheckIds(work);
        const checks = new Map<string, any>(verification.checks
            .filter((check: any) => !baseChecks.has(check.id) && (!only || only.includes(check.id)))
            .map((check: any) => [hash(check), check]));
        const amendments = this.currentAmendments(work);
        for (const obligation of this.pending(work).filter(o => o.kind === 'check' && o.check && !amendments.some(a => a.obligationId === o.id)))
            checks.set(obligation.checkBinding, obligation.check);
        return [...checks.values()];
    }
    /** The exact latest receipt matching this declaration; unrelated attempts remain history. */
    private selectedCheck(work: string, candidate: string, verification: string, check: any) {
        return this.s.all('SELECT * FROM check_runs WHERE work=? AND candidate=? AND verification=? AND check_id=? ORDER BY rowid DESC', work, candidate, verification, check.id)
            .find(row => hash(parse(row.data).check) === hash(check));
    }
    private settledCheckSource(check: CheckSpec, candidate: {id: string; hash: string}, bound: {verification: string}, row: {data: string}, run: {phase: string; reservation: string; data: string} | undefined,
        purpose: 'required' | 'fixture-amendment-negative' | 'consumer-control' = 'required') {
        if (!run || run.phase !== 'SETTLED' || run.reservation !== 'consumed')
            throw Error('Original check execution is not settled');
        const data = parse(row.data), producer = parse(run.data);
        if (data.purpose !== purpose || data.cleanup !== 'removed' || producer.cleanup !== 'removed' ||
            producer.kind !== 'governed-check' || producer.role !== null || !producer.runtimeProfile ||
            data.inputHash !== hash({candidate:candidate.hash, verification:bound.verification, check, runtime:producer.runtimeProfile}) ||
            hash(data.boundVersions) !== hash(bound) ||
            hash(data.target) !== hash({kind:'candidate', versionId:candidate.id, digest:candidate.hash}) ||
            hash(data.argv) !== hash(['/bin/bash','-lc',check.command]) || data.cwd !== '/work')
            throw Error('Original check source binding is unavailable');
        if (Object.hasOwn(data,'error')) throw Error('Original check attempt has an unresolved execution error');
        return data;
    }
    private readBoundCheckReport(check: CheckSpec, candidate: Parameters<typeof caseDescriptor>[1],
        bound: unknown, runId: string, data: {actual?: {stdout?: unknown}; parsed?: unknown; caseDescriptor?: unknown; caseResults?: unknown}) {
        if (typeof data.actual?.stdout !== 'string')
            throw Error('Original check execution output is unavailable');
        const parsed = parseCheckOutput(data.actual.stdout);
        if (hash(parsed) !== hash(data.parsed))
            throw Error('Original parsed check output does not match its source');
        const descriptor = caseDescriptor(check, candidate, bound, runId);
        const { comparison, diagnosis } = observeCheckOutput(check, descriptor, parsed.value);
        if (comparison.descriptorHash !== hash(data.caseDescriptor) || hash(comparison) !== hash(data.caseResults))
            throw Error('Original check descriptor or comparison is unavailable');
        return {parsed, comparison, descriptor, diagnosis};
    }
    private completeBoundCheckReport(check: CheckSpec, candidate: Parameters<typeof caseDescriptor>[1] & {id:string},
        bound: {verification:string}, row: {data:string; run:string; work:string},
        purpose: 'required' | 'fixture-amendment-negative' | 'consumer-control' = 'required') {
        const run = this.s.one('SELECT * FROM runs WHERE id=? AND work=?', row.run, row.work);
        const data = this.settledCheckSource(check, candidate, bound, row, run, purpose);
        if (data.actual?.exitCode !== 0 || data.actual.termination !== undefined)
            throw new Error('Original check did not complete with exit zero');
        const {parsed, comparison, diagnosis} = this.readBoundCheckReport(check, candidate, bound, row.run, data);
        if (!parsed.value || parsed.issues.length || !diagnosis.complete)
            throw new Error('Original check report is incomplete');
        const failedAssertions = parsed.value.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.id);
        const mismatchedCases = comparison.mismatches.map(({id}) => id);
        return {run, output: parsed.value, failedAssertions, mismatchedCases, mismatches: comparison.mismatches};
    }
    private amendmentCheckReport(work: string, checkpoint: ReturnType<ChangeCore['row']>, check: CheckSpec,
        candidate: ReturnType<ChangeCore['version']>,
        purpose: 'required' | 'fixture-amendment-negative') {
        try {
            const bound = this.checkBoundVersions(checkpoint, candidate.id);
            const row = this.selectedCheck(work, candidate.id, bound.verification, check);
            if (!row || (row.status !== 'pass' && row.status !== 'fail')) return;
            const {run, failedAssertions, mismatchedCases} = this.completeBoundCheckReport(check, candidate, bound, row, purpose);
            if (row.status !== (failedAssertions.length || mismatchedCases.length ? 'fail' : 'pass')) return;
            return {id: row.id, run: row.run, status: row.status, source: hash([row, run]),
                runtime: hash(parse(run.data).runtimeProfile), failedAssertions: failedAssertions.sort(), mismatchedCases: mismatchedCases.sort()};
        } catch {
            return undefined;
        }
    }
    private recordedCheckObservations(check: CheckSpec, candidate: Parameters<typeof caseDescriptor>[1] & {id:string},
        bound: {verification:string}, row: {data:string; run:string; work:string; status:string}, includeCaseValues = false):
        Pick<ChangeResultView['checks']['entries'][number], 'observedCounts' | 'failures'> | undefined {
        try {
            const {output, failedAssertions: assertions, mismatchedCases: cases, mismatches} = this.completeBoundCheckReport(check, candidate, bound, row);
            if (row.status === 'pass') {
                if (assertions.length || cases.length || !Array.isArray(check.cases) || !Array.isArray(output.cases)) return;
                return {observedCounts: {assertions: output.assertions.length, cases: output.cases.length}};
            }
            if (!assertions.length && !cases.length) return;
            // Retain exact IDs and room for both kinds of evidence in bounded views.
            const visible = (ids: readonly string[]) =>
                ids.filter(id => Buffer.byteLength(JSON.stringify(id)) <= 160).slice(0, 2);
            const assertionIds = visible(assertions), caseIds = visible(cases);
            const boundedValue = ({kind, value}: typeof mismatches[number]['expected']) =>
                ({kind, value: Buffer.byteLength(JSON.stringify(value)) <= 400 ? value : null});
            const caseValues = includeCaseValues && caseIds.length ? mismatches.filter(({id}) => caseIds.includes(id))
                .map(({id, expected, observed}) => ({id, expected: boundedValue(expected), observed: boundedValue(observed)})) : undefined;
            return {failures: {assertionIds, caseIds, omitted:assertions.length + cases.length - assertionIds.length - caseIds.length,
                ...(caseValues ? {caseValues} : {})}};
        } catch {
            return undefined; // A retained verdict may lack trustworthy item details.
        }
    }
    private readFailedCheck(work: string, {obligation, versions, receipts}: ReturnType<ChangeCore['failedPredicate']>, includeCaseValues?: boolean) {
        const {check, failedReceipt} = obligation;
        if (!receipts.includes(failedReceipt)) throw Error('Original receipt absent');
        const verification = this.version(versions.verification), declaration = verification.data.verification;
        const declaredCheck = declaration.checks.find((entry: CheckSpec) => entry.id === check.id);
        if (hash(declaration) !== verification.hash || !declaredCheck || hash(declaredCheck) !== hash(check))
            throw Error('Original check declaration unavailable');
        const row = this.s.one('SELECT * FROM check_runs WHERE id=? AND work=? AND check_id=?', failedReceipt, work, check.id);
        const failures = row && this.recordedCheckObservations(check, this.version(versions.candidate), versions, row, includeCaseValues)?.failures;
        if (!failures) throw Error('Original failed report unavailable');
        return {checkId:check.id as string, receiptId:failedReceipt as string, failures};
    }
    private checkReplanReview(work: string) {
        const evidence = () => {
            const owner = this.work(work), row = this.row(work), pending = this.pending(work);
            const obligations = pending.filter(item => item.kind === 'check');
            if (owner.state !== 'ACTIVE' || !obligations.length || pending.some(item => !['check', 'finding'].includes(item.kind))) return;
            const impacts = this.h.sourceImpacts(work, true);
            const checks = obligations.map(item => this.failedPredicate(work, item));
            const records = checks.map(({obligation}) => {
                const receipt = this.s.one('SELECT * FROM check_runs WHERE id=? AND work=?', obligation.failedReceipt, work);
                const run = receipt && this.s.one('SELECT * FROM runs WHERE id=? AND work=?', receipt.run, work);
                return [obligation, receipt, run];
            });
            const source = this.s.one('SELECT * FROM sources WHERE id=?', owner.source);
            if (!source) return;
            const versionIds = new Set([row.base, row.candidate, row.plan, row.verification, row.data.requirementVersion, row.data.contractsVersion,
                ...checks.flatMap(item => Object.values(item.versions))].filter((id): id is string => typeof id === 'string'));
            const versions = [...versionIds].map(id => this.s.one('SELECT id,kind,hash,data FROM change_versions WHERE id=? AND work=?', id, work));
            return {checks, impacts, fingerprint:hash([owner.epoch, owner.generation, source, this.bindings(work), impacts, records, versions])};
        };
        const checkpoint = () => {
            const row = this.row(work);
            if (row.phase !== 'REPAIR_REQUIRED' && row.phase !== 'BASE_CAPTURED' &&
                !(row.phase === 'BLOCKED' && ['checks', 'repair', 'plan'].includes(row.data.resumeStage))) return;
            if (row.phase === 'BASE_CAPTURED' && (row.plan !== null || row.verification !== null)) return;
            if ((row.plan === null) !== (row.verification === null)) return;
            if (row.plan && row.verification) this.strategies(work);
            if (this.workflowCriteriaHold(work) || ownerRootActivation(parse(this.work(work).data))?.state === 'PENDING') return;
            if (this.inspectContinuationAllowance(work, {stage:'plan', roles:changeStageRoles('plan')})) return;
            const value = evidence();
            return value && {...value, key:hash([value.fingerprint, this.h.options.runtimeProfile ?? null, row.phase, row.data.resumeStage ?? null, this.budget(work, 'execution'), this.budget(work, 'resolution')])};
        };
        try {
            const captured = checkpoint();
            if (!captured) return;
            const failures = captured.checks.map(item => ({obligationId: item.obligation.id, ...this.readFailedCheck(work, item)}));
            const heldDirections = captured.impacts.filter(input => input.data.effectHold).map(input => ({
                inputId:input.input_id, sourceId:input.source, directionRevision:input.revision,
                sourceOrigin:input.sourceOrigin ?? 'unknown', text:input.text,
            }));
            if (Buffer.byteLength(JSON.stringify([failures, heldDirections])) > 128 * 1024) return;
            return {fingerprint:captured.key, failures, heldDirections, assertCurrent: () => {
                if (checkpoint()?.key !== captured.key) throw Error('Original check replan changed; reopen its review');
            }, assertEvidenceCurrent: () => {
                if (evidence()?.fingerprint !== captured.fingerprint) throw Error('Original check replan evidence changed before planning');
            }};
        } catch { return; }
    }
    private retainedCheckFailures(work: string, includeCaseValues?: boolean): ChangeResultView['retainedCheckFailures'] {
        const pending = this.s.all(`SELECT id,data,count(*) OVER() AS total FROM obligations WHERE work=? AND CASE WHEN json_valid(data)
            THEN json_extract(data,'$.kind')='check' AND json_extract(data,'$.state')='pending' ELSE 0 END
            ORDER BY rowid DESC LIMIT 16`, work);
        if (!pending.length) return;
        const entries: NonNullable<ChangeResultView['retainedCheckFailures']>['entries'] = [];
        let unavailable = 0;
        for (const item of pending) {
            try {
                entries.push(this.readFailedCheck(work, this.failedPredicate(work, { ...parse(item.data), id: item.id }), includeCaseValues));
            } catch { unavailable++; }
        }
        const bounded = resultEntries(entries, 16, 8192);
        return {entries:bounded.entries, omitted:pending[0].total - pending.length + bounded.omitted, unavailable};
    }
    /** Compare real reports on successive versions without transferring a receipt between them. */
    private repeatsCheckFailure(work: string, check: CheckSpec, status: 'fail' | 'unavailable'): boolean {
        const row = this.row(work);
        if (!row.candidate || !row.verification) return false;
        try {
            const selected = this.version(row.candidate);
            if (!selected.predecessor) return false;
            const before = this.version(selected.predecessor);
            if (before.work !== work || before.kind !== 'candidate' || before.hash !== selected.hash)
                return false;
            const launch = this.s.one("SELECT data,run FROM role_launches WHERE id=? AND work=? AND role='repairer' AND status='COMPLETE' AND json_extract(data,'$.inputVersions.candidate')=?",
                selected.data.producer, work, before.id);
            if (!launch) return false;
            const read = (candidate: typeof selected) => {
                const receipt = this.selectedCheck(work, candidate.id, row.verification, check);
                if (receipt?.status !== status) return;
                const bindings = this.checkBoundVersions(row, candidate.id);
                const run = this.s.one('SELECT * FROM runs WHERE id=? AND work=?', receipt.run, work);
                const data = this.settledCheckSource(check, candidate, bindings, receipt, run);
                const actual = data.actual;
                if (!Number.isSafeInteger(actual?.exitCode) || actual.exitCode < 0 || actual.exitCode > 255 ||
                    actual.termination !== undefined) return;
                const {parsed, diagnosis, descriptor} = this.readBoundCheckReport(check, candidate, bindings, receipt.run, data);
                if (diagnosis.complete !== (status === 'fail')) return;
                const value = parsed.value;
                let resultHash: string;
                if (actual.exitCode === 0 && value && !parsed.issues.length) {
                    // Only a digest authenticated for this case in its own run is run-relative.
                    resultHash = hash({kind:'parsed', assertions:value.assertions,
                        cases:value.cases?.map(({id, inputDigest, observed}) => ({id, observed,
                            inputDigest: descriptor.cases.some(item => item.id === id && item.inputDigest === inputDigest)
                                ? null : inputDigest}))});
                } else if (status === 'unavailable' && actual.exitCode !== 0 && !value && parsed.issues.length &&
                    typeof actual.stdout === 'string' && typeof actual.stderr === 'string' && (actual.stdout || actual.stderr)) {
                    // Nonzero client output can recur without proving why it failed.
                    resultHash = hash({kind:'unparsed', exitCode:actual.exitCode, stdout:actual.stdout, stderr:actual.stderr});
                } else return;
                return {receipt, inputHash:data.inputHash, bindings, resultHash};
            };
            const previous = read(before), current = read(selected);
            if (!previous || !current || previous.inputHash !== current.inputHash) return false;
            if (status === 'unavailable') {
                const repair = parse(launch.data);
                const run = this.s.one('SELECT * FROM runs WHERE id=? AND work=?', launch.run, work);
                const recovery = repair.checkOutputRecovery;
                if (repair.cleanup !== 'removed' || run?.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
                    parse(run.data).cleanup !== 'removed' || Object.entries(previous.bindings).some(([key, value]) => repair.inputVersions?.[key] !== value) ||
                    recovery?.kind !== 'check-output-contract' || !recovery.failures?.some((failure: any) =>
                        failure.receiptId === previous.receipt.id && failure.runId === previous.receipt.run &&
                        failure.checkBinding === hash(check) && failure.candidateVersion === before.id &&
                        failure.verificationVersion === row.verification)) return false;
            }
            return previous.resultHash === current.resultHash;
        } catch {
            return false;
        }
    }
    private checkOutputSources(work: string, r: ReturnType<ChangeCore['row']>) {
        if (!r.candidate || !r.verification) return [];
        return this.requiredCandidateChecks(work).map(check => {
            const row = this.selectedCheck(work, r.candidate, r.verification, check);
            return { check, row, run: row && this.s.one('SELECT * FROM runs WHERE id=? AND work=?', row.run, work) };
        });
    }
    /** Current diagnostic for a single synchronous read of the selected sources. */
    private describeCheckOutput(work: string, r: ReturnType<ChangeCore['row']>, checks: ReturnType<ChangeCore['checkOutputSources']>) {
        const failures:{receiptId:string;runId:string;checkId:string;checkBinding:string;candidateVersion:string;verificationVersion:string;production:ReturnType<typeof recordedCheckProduction>;diagnosis:ReturnType<typeof observeCheckOutput>['diagnosis']}[]=[];
        const unavailable: string[] = [];
        for (const {check,row,run} of checks) {
            if (!row || row.status!=='unavailable') continue;
            try {
                const candidate=this.version(r.candidate);
                const bound={base:r.base,candidate:r.candidate,plan:r.plan,verification:r.verification,requirements:r.data.requirementVersion,contracts:r.data.contractsVersion};
                const data=this.settledCheckSource(check,candidate,bound,row,run);
                if (!data.actual || typeof data.actual.stdout!=='string') throw Error('Original check execution output is unavailable');
                if (data.actual.termination!==undefined) continue;
                if (!Number.isSafeInteger(data.actual.exitCode) || data.actual.exitCode<0 || data.actual.exitCode>255) throw Error('Original check exit status is unavailable');
                const {diagnosis}=this.readBoundCheckReport(check,candidate,bound,row.run,data);
                if (diagnosis.complete) throw Error('Unavailable check has no supported output-contract failure');
                failures.push({receiptId:row.id,runId:row.run,checkId:check.id,checkBinding:hash(check),candidateVersion:r.candidate,
                    verificationVersion:r.verification,production:recordedCheckProduction(data),diagnosis});
            } catch { unavailable.push(row.id); /* Missing source proof cannot authorize a cause-less repair. */ }
        }
        const hold=unavailable.length ? 'Selected unavailable check source cannot substantiate repair; inspect the retained checker receipt before retrying' : undefined;
        const view=!hold && failures.length ? {kind:'check-output-contract',purpose:'Diagnose the retained rejected verification report and repair only what its original receipt and actual source support. Report rejection does not establish target-command start, infrastructure cause or a subject defect; passing assertions alone do not establish valid check evidence.',
            nextAction:'Explicit run/resume uses a charged repair role to diagnose the retained rejected report, then repeats current verification and independent review; it does not simply rerun the unchanged check.',
            runtimeDescriptor:'/input/verification-cases.json',
            instruction:'The check command must consume the runtime descriptor and return its exact case IDs/inputDigest unchanged with actual observations. Do not compute inputDigest from literals or reconstruct it. Emit exactly the declared assertion IDs; case IDs are separate. Preserve owner requirements and current verification declarations.',failures} : undefined;
        return { view, hold };
    }
    /** Repair keeps a full original fingerprint for checks across action boundaries. */
    private checkOutputRecovery(work: string) {
        const capture = () => {
            const r = this.row(work);
            const checks = this.checkOutputSources(work, r);
            if (!r.candidate || !r.verification) return { state: this.bindings(work), checks };
            return { state: this.bindings(work), candidate: this.s.one('SELECT * FROM change_versions WHERE id=? AND work=?', r.candidate, work),
                verification: this.s.one('SELECT * FROM change_versions WHERE id=? AND work=?', r.verification, work), checks };
        };
        const original = capture(), fingerprint = hash(original);
        const { view, hold } = this.describeCheckOutput(work, this.row(work), original.checks);
        const viewHash=hash(view??null);
        const assertCurrent=()=>{if(hash(capture())!==fingerprint||hash(view??null)!==viewHash)throw Error('Selected check-output recovery source changed');};
        const assertAvailable=()=>{if(hold)throw Error(hold);};
        assertCurrent();return {view,hold,assertCurrent,assertAvailable};
    }
    private checkReceiptPassed(row: any, check: any, candidate: () => ReturnType<ChangeCore['version']>): boolean {
        if (!row || row.status !== 'pass') return false;
        const data = parse(row.data);
        try {
            const descriptor = caseDescriptor(check, candidate(), data.boundVersions, row.run);
            const comparison = compareCases(check, descriptor, data.parsed?.value ?? null);
            return data.caseResults?.version === 1 && hash(data.caseDescriptor) === comparison.descriptorHash && hash(comparison) === hash(data.caseResults) && comparison.complete && !comparison.mismatches.length && data.cleanup === 'removed';
        }
        catch {
            return false;
        }
    }
    private candidateChecksCurrent(work: string, read = this.createVerificationRead(work)) {
        const r = this.row(work);
        if (!r.candidate || !r.verification)
            return false;
        const v = this.version(r.verification).data.verification;
        if (this.coverageHoldReason(work, read))
            return false;
        const baseChecks = this.baselineCheckIds(work, read);
        const candidate = readOnce(() => this.version(r.candidate));
        return v.checks.every((check: any) => baseChecks.has(check.id) ? !!this.baselineReceipt(work, check) :
            this.checkReceiptPassed(this.selectedCheck(work, r.candidate, r.verification, check), check, candidate));
    }
    private checksCurrent(work: string, read = this.createVerificationRead(work)) {
        if (!this.candidateChecksCurrent(work, read)) return false;
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
                return this.blocked(work, 'Original producer material is incomplete or unsupported; complete finding accounting is unavailable', `Inspect retained producer history and extraction issues in /work ${work}. Ordinary task continuation requires complete source accounting; a replacement result cannot reconstruct missing material`);
            const coverage = await this.prevalidateVerificationPlanRepair(work);
            if (!Object.keys(r.data.selection ?? {}).length)
                throw new Error('All required fresh review outputs required');
            const nit = await this.nitPreview(work);
            const judge = await this.role(options, 'adjudicator', { stage: 'review-adjudication', reviews: r.data.selection, nitProposal: nit, occurrences: this.inspect(work).occurrences });
            this.assertRetainedDispositions(work, judge.launchId, judge.protocol);
            const applyInputDecisions = this.prepareInputDecisions(work, judge.launchId, judge.protocol);
            const read = this.createVerificationRead(work);
            const typedReview = !!read.strategies();
            let unavailable: NonNullable<RoleResult['verificationDecisions']>[number] | undefined;
            if (typedReview) {
                const reviews = this.strategyReviewEvidence(work, 'accounting', read);
                const expected = reviews.map(item => ({ ...item, witnessIds: [...item.witnessIds, ...item.reviews.map(review => review.launchId)] }));
                const judgment = this.verificationDecisions(work, judge.protocol, expected, read, 'accounting');
                unavailable = reviews.flatMap(item => item.reviews).find(review => review.decision.verdict === 'unavailable')?.decision ?? judgment;
            }
            const diagnosisProofs = await this.prevalidateDiagnoses(work, judge);
            const retainedBase = await this.prevalidateRetainedBaseClassifications(work);
            const retainedBaseProofs = retainedBase.proofs;
            judge.assertInputCurrent();
            this.assertRetainedDispositions(work, judge.launchId, judge.protocol);
            const applyAssessment = () => {
                retainedBase.assertCurrent();
                if (typedReview && !unavailable) this.phase(work, r.phase, { verificationJudge: judge.launchId });
                applyInputDecisions();
            };
            if (!coverage) this.s.tx(applyAssessment);
            this.s.tx(() => {
                retainedBase.assertCurrent(); coverage?.assertCurrent();
                if (coverage && this.pending(work).some(item => item.id === coverage.repair.subject.occurrenceId)) {
                    const decision = judge.protocol.decisions?.find(item => item.occurrenceId === coverage.repair.subject.occurrenceId);
                    if (decision && (decision.disposition !== 'upheld' || !['pending', 'repaired'].includes(decision.resolution ?? '')))
                        throw Error('The adopted verification finding needs a pending assessment or an authenticated repair');
                }
                if (coverage) applyAssessment();
                this.dispositions(work, judge.launchId, judge.protocol, undefined, occurrence => {
                    const witnesses = (judge.protocol.decisions ?? []).find(item => item.occurrenceId === occurrence.id)!.witnesses;
                    const repair = coverage?.repair;
                    if (!repair || repair.subject.occurrenceId !== occurrence.id)
                        return this.repairedProof(work, occurrence, witnesses, retainedBaseProofs.get(occurrence.id));
                    if (unavailable || judge.protocol.ownerDecisionRequired?.length) return false;
                    const verified = this.verificationEvidence(work, read);
                    const evidence = verified?.requirements.find(item => item.requirementId === repair.requirementId);
                    const verification = this.version(r.verification).data.verification as PlanProposal['verification'];
                    const receipts = repair.checkIds.map(id => {
                        const check = verification.checks.find(check => check.id === id)!;
                        const pass = this.selectedCheck(work, r.candidate, r.verification, check);
                        return pass?.status === 'pass' && evidence?.witnessIds.includes(pass.id) && witnesses.includes(pass.id) ? pass.id : null;
                    });
                    if (!verified || receipts.some(id => !id)) throw Error('Verification correction needs actual passing receipts from every amended check and independent current fit');
                    return { kind: 'verification-plan', plan: r.plan, verification: r.verification, receipts, verificationEvidence: verified.digest };
                }, diagnosisProofs,retainedBaseProofs);
            });
            if (judge.protocol.ownerDecisionRequired?.length)
                throw new Error('Owner decision required');
            if (!unavailable) this.resolveAmendments(work, judge.launchId, judge.protocol);
            if (nit && judge.protocol.nitAuthorization) {
                const authorized = judge.protocol.nitAuthorization;
                if (this.pending(work).some(o => o.kind !== 'finding' || !nit.occurrences.includes(o.id)))
                    throw new Error('Nit authorization cannot omit newly required or other unresolved obligations');
                if (authorized.beforeCandidate !== nit.beforeCandidate || authorized.afterDigest !== nit.afterDigest || authorized.deltaHash !== nit.deltaHash || hash([...authorized.consumerCheckIds].sort()) !== hash([...nit.consumerCheckIds].sort()))
                    throw new Error('Nit authorization binding mismatch');
                this.phase(work, 'NIT_AUTHORIZED', { pendingNit: { ...nit, authorization: judge.launchId, originalReview: r.data.selection }, blocked: [], nextAction: 'confirmNit' });
                return this.inspect(work);
            }
            const pending = this.pending(work);
            if (unavailable && !this.pendingReviewFindingId(work, Object.values(r.data.selection)))
                return this.blocked(work, this.verificationFitReason(unavailable), `Inspect the retained verification assessment in /work ${work} before changing the evidence or method.`, 'review');
            if (pending.length) {
                this.phase(work, 'REPAIR_REQUIRED', { blocked: pending.map(o => o.id), nextAction: 'repairChange' });
                return this.inspect(work);
            }
            return this.ready(work);
        }
        catch (error) {
            if (error instanceof SourceScopeChangeRequiresPlanning)
                return this.blocked(work, String(error), 'planChange', 'plan');
            return this.blocked(work, String(error), 'resolveChange');
        }
    }
    hasPendingSourceInput(work: string): boolean {
        return this.h.sourceImpacts(work).some(input => input.data.effectHold);
    }
    private evidenceAt(work: string, criteriaHash: string, requireReady = false, tentativePublicationOperation?: string): CurrentEvidence {
        this.h.assertOpen();
        this.guard(work);
        this.assertMaterialAccountingCurrent(work);
        const w = this.work(work), read = this.createVerificationRead(work);
        if (!['ACTIVE', 'DELIVERED'].includes(w.state))
            throw new Error('Current governed standing unavailable');
        const r = this.row(work);
        if (requireReady && (r.phase !== 'REVIEW_READY' || r.epoch !== w.epoch))
            throw new Error('Current governed standing unavailable');
        if (criteriaHash !== this.version(r.data.contractsVersion).hash)
            throw new Error('Active criteria changed; replan required');
        const plan = r.plan ? this.version(r.plan).data.plan : null;
        const sourceInputs = this.h.sourceImpacts(work);
        if (sourceInputs.some(input => input.data.effectHold))
            throw new Error(`A request affecting this work is still pending. Use /work ${work} to inspect the affected work.`);
        // The typed verification digest below validates the strategy witnesses.
        if (!plan || !r.candidate || !this.candidateChecksCurrent(work, read) || this.pending(work).some(o => !tentativePublicationOperation || !this.tentativePublicationObligation(tentativePublicationOperation, o)))
            throw new Error('Required current planning/checks/findings incomplete');
        for (const role of plan.verification.reviewRoles) {
            const key = typeof role === 'string' ? role : role.key, launch = this.s.one('SELECT * FROM role_launches WHERE id=?', r.data.selection?.[key] ?? '');
            const input = launch?.role === 'reviewer' && launch.status === 'COMPLETE' ? parse(launch.data).inputVersions : undefined;
            const carry = r.data.carry;
            if (!input || !this.sameNonCandidateBindings(work, input, r) ||
                (input.candidate !== r.candidate && (carry?.after !== r.candidate || carry.before !== input.candidate ||
                    !this.s.one('SELECT id FROM remedy_confirmations WHERE work=? AND before_version=? AND after_version=? AND launch=?', work, carry.before, r.candidate, carry.confirmation))))
                throw new Error('Required current review missing/stale');
        }
        const reviews = Object.values(r.data.selection ?? {}) as string[];
        const checks = this.s.all('SELECT id,status,data FROM check_runs WHERE work=? AND candidate=? AND verification=?', work, r.candidate, r.verification);
        const dispositions = this.s.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences f ON f.id=d.occurrence WHERE f.work=? ORDER BY d.rowid', work);
        const sourceChainDigest = hash(sourceInputs), selectionDigest = hash({ selection: r.data.selection, reviews: reviews.map(id => this.s.one('SELECT * FROM role_launches WHERE id=?', id)) });
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
        const current = this.evidenceAt(snapshot.workId, loadCriteriaHashSync(), true);
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
        const allowance = (kind: 'execution' | 'resolution') => {
            const row = context.budgets.find(row => row.kind === kind);
            return row && {limit: row.lim, consumed: row.consumed, reserved: row.reserved};
        };
        const execution = allowance('execution'), resolution = allowance('resolution');
        return { workId: work, projectId: context.work.project, sourceId: context.work.source, epoch: context.work.epoch,
            state: context.work.state, fromContractsVersion: version.id, previousHash: version.hash, currentHash: current?.hash ?? null,
            fingerprint: hash({ context, version, currentHash: current?.hash ?? null, unavailable }),
            ...(execution && resolution ? {sharedAllowance:{execution,resolution}} : {}),
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
            const assignmentResume = captureCriteriaResume(this.s, work);
            const priorPlanningFailure = old.phase === 'BLOCKED' ? this.priorPlanningFailure(work, old) : undefined;
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'owner-criteria-refresh', uid: process.getuid?.(), pid: process.pid, work, fromContractsVersion: old.data.contractsVersion, toHash: current.hash, ...(failedWaitDiagnostic ? { failedWaitDiagnostic } : {}), ...(assignmentResume ? { assignmentResume } : {}), ...(priorPlanningFailure ? { priorPlanningFailure } : {}) }), options.reason);
            const next = this.newVersion(work, 'contracts', null, { text: current.text, assets: current.assets, refreshSource: sourceId }, current.hash, old.data.contractsVersion);
            this.s.run('UPDATE works SET epoch=epoch+1,state=?,current_result=NULL WHERE id=?', 'ACTIVE', work);
            this.s.run('UPDATE change_state SET epoch=?,plan=NULL,verification=NULL,phase=?,data=? WHERE work=?', before.epoch + 1, 'BASE_CAPTURED', JSON.stringify({ ...old.data, candidateAmendmentProbe: true, contractsVersion: next, criteriaRefresh: { sourceId, fromContractsVersion: old.data.contractsVersion, toContractsVersion: next }, selection: {}, pendingNit: null, carry: null, amendmentProofs: [], blocked: [], nextAction: 'planChange', resumeStage: 'plan' }), work);
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
        return nativeHistoryIdentity(history);
    }
    private materialAccountingSnapshot(launch: any) {
        const {materialAccounting, ...data} = parse(launch.data), run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run);
        const historyIdentity = this.materialHistoryIdentity(parse(run?.data).historyRef);
        return {
            historyIdentity,
            producerDigest: hash([{...launch,data},run,...(data.rawAssessmentReceipt ? [this.rawAssessmentReceiptCurrent(launch)] : [])]),
            claimsDigest: hash([this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id),
                this.s.all('SELECT o.* FROM finding_occurrences o JOIN role_outputs r ON r.id=o.output WHERE r.launch=? ORDER BY r.rowid,o.ordinal', launch.id)]),
        };
    }
    private materialAccountingVersion(launch: any) {
        const selected=this.historicalSelectedOutputs(launch.id);
        if (selected.some(output=>parse(output.data).nativeSource?.kind==='claude-sdk-tool-submission/v1')) return 11;
        return selected.some(output => parse(output.data).nativeSource?.kind === 'claude-sdk-assistant-json/v1') ? 6 : 10;
    }
    private hasMalformedSelectedRoleMetadata(launchId: string): boolean {
        return Boolean(this.s.one(`SELECT 1 FROM role_outputs WHERE launch=? AND status IN ('usable','unusable')
            AND CASE WHEN json_valid(data) THEN json_type(data) <> 'object' ELSE 1 END LIMIT 1`, launchId));
    }
    private materialAccountingProducers(work: string) {
        return this.s.all(`SELECT l.* FROM role_launches l WHERE l.work=? AND l.status IN ('COMPLETE','UNUSABLE') AND (
            CASE WHEN json_valid(l.data) THEN json_extract(l.data,'$.nativeRoleIntent') END IS NOT NULL OR
            CASE WHEN json_valid(l.data) THEN json_extract(l.data,'$.rawAssessmentReceipt') END IS NOT NULL OR
            EXISTS (SELECT 1 FROM role_outputs o WHERE o.launch=l.id AND
                CASE WHEN json_valid(o.data) THEN json_extract(o.data,'$.nativeSource.kind') END IN ('claude-sdk-formatter/v1','claude-sdk-assistant-json/v1','claude-sdk-tool-submission/v1')) OR
            EXISTS (SELECT 1 FROM obligations d WHERE d.work=l.work AND d.id='raw-incomplete-' || l.id || '-native-material' AND
                CASE WHEN json_valid(d.data) THEN json_extract(d.data,'$.method') END='independent-raw-assessment/v1')) ORDER BY l.rowid`, work);
    }
    private hasUnreadableRoleMaterial(work: string): boolean {
        return this.materialAccountingProducers(work).some(launch => this.hasMalformedSelectedRoleMetadata(launch.id));
    }
    private materialAccountingCandidates(work: string) {
        return this.materialAccountingProducers(work).filter(launch => {
            if (this.hasMalformedSelectedRoleMetadata(launch.id)) return true;
            const receipt = parse(launch.data).materialAccounting, current = this.materialAccountingSnapshot(launch);
            return receipt?.version !== this.materialAccountingVersion(launch) || current.historyIdentity === null || receipt.historyIdentity !== current.historyIdentity ||
                receipt.producerDigest !== current.producerDigest || receipt.claimsDigest !== current.claimsDigest;
        });
    }
    private materialAccountingHoldReason(work:string, candidates = this.materialAccountingCandidates(work)):string|null {
        if (candidates.some(launch => this.hasMalformedSelectedRoleMetadata(launch.id))) return selectedRoleMetadataUnavailable;
        return candidates.length ? 'Original role material coverage requires same-work drive/resume before current standing' : null;
    }
    /** Read-only original material for a prospective scoped assessment.
     * Availability is not paid admission, parser completeness or a verdict. */
    async rawAssessmentMaterial(work: string, holdId: string) {
        const refuse = (): never => { throw Error('RAW_ASSESSMENT_SOURCE_UNAVAILABLE: restore the exact bounded original source and claim records'); };
        const hold = this.s.one('SELECT * FROM obligations WHERE id=? AND work=?',holdId,work), duty = parse(hold?.data);
        const launch = this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',duty.launchId ?? '',work);
        const run = launch && this.s.one('SELECT * FROM runs WHERE id=?',launch.run), ld = parse(launch?.data), rd = parse(run?.data);
        if (!hold || duty.kind !== 'raw-findings-incomplete' || !launch || holdId !== `raw-incomplete-${launch.id}-native-material` ||
            duty.extractionIssueCount !== 1 || !Array.isArray(duty.extractionIssues) || duty.extractionIssues.length !== 1 ||
            !run || run.work !== work || run.epoch !== launch.epoch || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
            launch.status !== 'UNUSABLE' || ld.cleanup !== 'removed' || rd.cleanup !== 'removed' ||
            rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role ||
            !rd.historyRef || ld.historyRef !== rd.historyRef || !rd.nativeSessionId || ld.nativeSessionId !== rd.nativeSessionId) refuse();
        const outputs = () => this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',launch.id);
        const original = outputs(), selected = original.filter(row=>['usable','unusable'].includes(row.status));
        const primary = selected[0], metadata = parse(primary?.data);
        const projected = original.filter(row=>row.status === 'accounted-intermediate' && parse(row.data).nativeTextProjection);
        if (selected.length !== 1 || primary.status !== 'unusable' || metadata.nativeSource?.kind !== 'claude-sdk-assistant-json/v1' ||
            metadata.protocol !== null || metadata.terminal !== 'complete' || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 ||
            typeof primary.raw !== 'string' || !primary.raw || Buffer.byteLength(primary.raw) > 128 * 1024 || Buffer.from(primary.raw).toString('utf8') !== primary.raw ||
            projected.length !== 1 || original.length !== 2 || metadata.historyRef !== rd.historyRef) refuse();
        const projection = projected[0]!, origin = this.corroboratedNativeMaterialOrigin(work,projection,launch,true);
        if (!origin.projection || duty.extractionIssues[0]?.entryId !== parse(projection.data).nativeEntryId) refuse();
        const literalRead = nativeTextFindingProjection(primary.raw,launch.role);
        if (!literalRead?.region?.innerLiteralComplete || hash(origin.claims) !== hash(literalRead.read.claims)) refuse();
        const occurrences = () => this.s.all('SELECT f.* FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=? ORDER BY o.rowid,f.ordinal',launch.id);
        const known = occurrences(), primaryClaims = known.filter(row=>row.output === primary.id);
        const synthetic = primaryClaims.filter(row=>{
            try { return this.collectorDiagnosis(work,row.id).output.id === primary.id; } catch { return false; }
        });
        if (synthetic.length !== 1 || known.some(row=>row.work !== work || parse(row.data).launchId !== launch.id || parse(row.data).role !== launch.role)) refuse();
        const diagnosis = this.collectorDiagnosis(work,synthetic[0]!.id);
        const literal = known.filter(row=>row.output === projection.id);
        if (literal.length !== origin.claims.length || primaryClaims.length !== diagnosis.material.length + 1 ||
            known.length !== primaryClaims.length + literal.length) refuse();
        const snapshot = () => ({rows:hash([this.s.one('SELECT * FROM obligations WHERE id=? AND work=?',holdId,work),
            this.s.one('SELECT * FROM role_launches WHERE id=?',launch.id),this.s.one('SELECT * FROM runs WHERE id=?',run.id),outputs(),occurrences()]),
            historyIdentity:this.materialHistoryIdentity(rd.historyRef)});
        const before = snapshot();
        if (before.historyIdentity === null) refuse();
        const entries = await this.nativeEntries(run.id);
        if (hash(before) !== hash(snapshot())) refuse();
        if (readSelectedRoleOutput(entries,{entryId:metadata.nativeEntryId,sessionId:rd.nativeSessionId,launchId:launch.id,role:launch.role,
            checkpointLeafId:rd.nativeCheckpoint?.leafId,nativeIntent:ld.nativeRoleIntent,stage:ld.stage},metadata.nativeSource) !== primary.raw) refuse();
        this.corroboratedNativeMaterialFromEntries(projection,launch,run,origin,entries);
        const assertCurrent = () => { if (hash(before) !== hash(snapshot())) refuse(); };
        assertCurrent();
        return {version:1 as const,workId:work,holdId,launchId:launch.id,primaryOutputId:primary.id,projectionOutputId:projection.id,
            diagnosisOccurrenceId:synthetic[0]!.id,originalMaterialOccurrenceIds:diagnosis.material.map(row=>row.id),
            projectedOccurrenceIds:literal.map(row=>row.id),originOccurrenceIds:known.map(row=>row.id),
            occurrences:known.map(row=>({...row,data:parse(row.data)})),raw:primary.raw,rawSha256:hash(primary.raw),
            source:metadata.nativeSource,partialTextProjection:origin.projection,sourceFence:before,assertCurrent};
    }
    /** Stable source projection: only these derived fields may change on assessment. */
    private rawAssessmentEvidence(launch: any) {
        const {materialAccounting,rawAssessmentReceipt,...data} = parse(launch.data);
        const run = this.s.one('SELECT * FROM runs WHERE id=?',launch.run), rd = parse(run?.data);
        const hold = this.s.one('SELECT * FROM obligations WHERE id=? AND work=?',`raw-incomplete-${launch.id}-native-material`,launch.work);
        const {state,method,semanticAssessment,...duty} = parse(hold?.data);
        return {version:1,rows:hash([{...launch,data},run,hold && {...hold,data:duty},
            this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',launch.id),
            this.s.all('SELECT f.* FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=? ORDER BY o.rowid,f.ordinal',launch.id)]),
            historyIdentity:this.materialHistoryIdentity(rd.historyRef)};
    }
    private rawAssessmentCohort(work:string, origin:any, except?:string) {
        const primary = this.historicalSelectedOutputs(origin.id)[0];
        const assessors = this.s.all("SELECT * FROM role_launches WHERE work=? AND (json_extract(data,'$.stage')='raw-assessment' OR json_extract(data,'$.nativeRoleIntent.stage')='raw-assessment' OR json_extract(data,'$.producerDiagnosticInput.stage')='raw-assessment') ORDER BY rowid",work).filter(row=>row.id !== except);
        for (const row of assessors) {
            const data=parse(row.data), capture=data.producerDiagnosticInput?.rawAssessment;
            if (data.stage !== 'raw-assessment' || !data.rawAssessment || data.rawAssessment.version !== 1 || !capture ||
                capture.targetOutputId !== data.rawAssessment.targetOutputId || capture.targetHash !== hash(data.rawAssessment))
                throw Error('Prior raw assessor target correspondence is unavailable');
        }
        const prior=assessors.filter(row=>parse(row.data).rawAssessment.targetOutputId === primary?.id);
        for (const row of prior) {
            const data=parse(row.data), run=this.s.one('SELECT * FROM runs WHERE id=?',row.run), rd=parse(run?.data), receipt=data.producerDiagnosticInput;
            if (!['COMPLETE','UNUSABLE'].includes(row.status) || !run || run.work !== work || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
                data.cleanup !== 'removed' || rd.cleanup !== 'removed' || this.materialHistoryIdentity(data.historyRef) === null || receipt?.version !== 3 || receipt.rawAssessment?.targetHash !== hash(data.rawAssessment))
                throw Error('Prior raw assessor source is unsettled or unavailable');
        }
        for (const row of prior) {
            const outputs=this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',row.id), output=outputs[0], metadata=parse(output?.data);
            const raw=rawFindings(output?.raw), retained=output && this.s.all('SELECT * FROM finding_occurrences WHERE output=? ORDER BY ordinal',output.id);
            if (outputs.length !== 1 || output.status !== 'usable' || !raw.complete || metadata.rawFinalTruncated !== false || metadata.omittedFindingCount !== 0 ||
                hash(metadata.protocol?.findings) !== hash(raw.findings) || retained.length !== raw.findings.length ||
                raw.findings.some((finding,index)=>retained[index]?.ordinal !== index || retained[index]?.work !== work ||
                    parse(retained[index].data).launchId !== row.id || parse(retained[index].data).role !== 'adjudicator' || hash(parse(retained[index].data).finding) !== hash(finding)))
                throw Error('Prior raw assessor received claims are incomplete or unsupported');
        }
        const launches = [origin.id,...prior.map(row=>row.id)];
        const owned=new Map(this.s.all('SELECT id,launch FROM role_outputs WHERE launch IN ('+launches.map(()=>'?').join(',')+')',...launches).map(row=>[row.id,row.launch]));
        const claims = this.s.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',work).filter(row=>owned.has(row.output));
        if (claims.some(row=>parse(row.data).launchId !== owned.get(row.output))) throw Error('Raw assessor occurrence ownership changed');
        const previous = prior.map(row=>({row,run:this.s.one('SELECT * FROM runs WHERE id=?',row.run),
            outputs:this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',row.id),
            historyIdentity:this.materialHistoryIdentity(parse(row.data).historyRef)}));
        return {claims,previous};
    }
    private rawAssessmentCacheSnapshot(origin:any, receipt:any, view:ProducerEvidenceView = 'exact') {
        const judge=this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',receipt.judgeLaunchId,origin.work), jd=parse(judge?.data);
        const run=judge && this.s.one('SELECT * FROM runs WHERE id=?',judge.run), output=this.s.one('SELECT * FROM role_outputs WHERE id=?',receipt.judgeOutputId);
        const cohort=this.rawAssessmentCohort(origin.work,origin,judge?.id);
        const projected = view === 'exact' ? cohort : {...cohort,previous:cohort.previous.map(item=>({...item,row:producerEvidence(item.row,view)}))};
        return {source:this.rawAssessmentEvidence(origin),cohort:hash(projected),judge:hash([producerEvidence(judge,view),run,output,this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',receipt.judgeLaunchId),
            this.s.all('SELECT f.* FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=? ORDER BY o.rowid,f.ordinal',receipt.judgeLaunchId),
            this.s.all('SELECT * FROM finding_dispositions WHERE launch=? ORDER BY rowid',receipt.judgeLaunchId)]),
            judgeHistoryIdentity:this.materialHistoryIdentity(jd.historyRef)};
    }
    private rawAssessmentReceiptCurrent(origin:any):boolean {
        try {
            const receipt=parse(origin.data).rawAssessmentReceipt;
            if (!receipt || ![1,2].includes(receipt.version) || typeof receipt.id !== 'string' ||
                Object.keys(receipt).sort().join(',') !== 'id,judgeLaunchId,judgeOutputId,judgeSourceFence,snapshot,target,version') return false;
            const judge=this.s.one('SELECT * FROM role_launches WHERE id=? AND work=?',receipt.judgeLaunchId,origin.work), jd=parse(judge?.data);
            const run=judge && this.s.one('SELECT * FROM runs WHERE id=?',judge.run), rd=parse(run?.data), output=this.s.one('SELECT * FROM role_outputs WHERE id=?',receipt.judgeOutputId), md=parse(output?.data);
            const duty=parse(this.s.one('SELECT data FROM obligations WHERE id=? AND work=?',receipt.target?.holdId,origin.work)?.data);
            if (!judge || judge.id === origin.id || judge.role !== 'adjudicator' || judge.status !== 'COMPLETE' || jd.stage !== 'raw-assessment' ||
                !run || run.work !== origin.work || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || jd.cleanup !== 'removed' || rd.cleanup !== 'removed' ||
                !output || output.launch !== judge.id || output.status !== 'usable' || md.terminal !== 'complete' || md.rawFinalTruncated !== false || md.omittedFindingCount !== 0 ||
                hash(parseCapturedRoleOutput(output.raw,'adjudicator',jd).value) !== hash(md.protocol) ||
                hash(jd.rawAssessment) !== hash(receipt.target) || receipt.target.targetOutputId !== this.historicalSelectedOutputs(origin.id)[0]?.id ||
                jd.producerDiagnosticInput?.version !== 3 || jd.producerDiagnosticInput.rawAssessment?.targetHash !== hash(receipt.target) ||
                duty.state !== 'resolved' || duty.method !== 'independent-raw-assessment/v1' || duty.semanticAssessment !== receipt.id) return false;
            const decision=md.protocol?.decisions?.find((d:any)=>d.occurrenceId === receipt.target.diagnosisOccurrenceId);
            if (decision?.disposition !== 'upheld' || decision.resolution !== 'diagnosed' ||
                hash(md.protocol.decisions.map((d:any)=>d.occurrenceId).sort()) !== hash([...receipt.target.knownOccurrenceIds].sort())) return false;
            const views:ProducerEvidenceView[] = receipt.version === 2 ? ['semantic-v2'] : ['exact','formatter-v4','formatter-v5','formatter-v7','formatter-v8','formatter-v9'];
            return views.some(view=>{
                const snapshot=this.rawAssessmentCacheSnapshot(origin,receipt,view);
                return hash(receipt.judgeSourceFence) === hash(this.diagnosisJudgeFence(origin.work,judge.id,output.id,view)) &&
                    snapshot.source.historyIdentity !== null && snapshot.judgeHistoryIdentity !== null && hash(snapshot) === hash(receipt.snapshot);
            });
        } catch { return false; }
    }
    private async assessRetainedRaw(options:ChangeOperation) {
        const work=options.workId, pending=this.pending(work), holds=pending.filter(o=>o.kind === 'raw-findings-incomplete');
        if (this.work(work).state !== 'ACTIVE' || holds.length !== 1 || pending.some(o=>o.kind === 'interrupted-producer')) return this.inspect(work);
        let material:Awaited<ReturnType<ChangeCore['rawAssessmentMaterial']>>;
        try { material=await this.rawAssessmentMaterial(work,holds[0]!.id); } catch { return this.inspect(work); }
        const origin=this.s.one('SELECT * FROM role_launches WHERE id=?',material.launchId), sourceRun=this.s.one('SELECT * FROM runs WHERE id=?',origin.run), owner=this.work(work);
        if (origin.epoch > owner.epoch || sourceRun.generation > owner.generation) return this.inspect(work);
        const cohort=this.rawAssessmentCohort(work,origin);
        const priorFence=hash(cohort);
        for (const previous of cohort.previous) {
            const data=parse(previous.row.data), rd=parse(previous.run.data), entries=await this.nativeEntries(previous.row.run);
            const users=entries.flatMap(entry=>entry.type === 'message' && entry.message.role === 'user' ? [entry.message] : []);
            const content=users[0]?.content, first=Array.isArray(content) && content.length === 1 ? content[0] : undefined;
            const text=typeof content === 'string' ? content : first?.type === 'text' ? first.text : null;
            const body=typeof text === 'string' ? historicalRoleInputBody(text,'adjudicator') : null;
            if (users.length !== 1 || body === null || hash((parseUniqueJson(body) as {context?:{rawAssessment?:unknown}}).context?.rawAssessment) !== hash(data.rawAssessment))
                throw Error('Prior raw assessor captured input is unavailable or changed');
            if (sourceScopeVersion(data) !== sourceScopeVersion((parseUniqueJson(body) as {context:Record<string,unknown>}).context))
                throw Error('Prior raw assessor source scope capture changed');
            const selected=previous.outputs.filter(row=>['usable','unusable'].includes(row.status));
            const meta=parse(selected[0]?.data);
            if (selected.length !== 1 || readSelectedRoleOutput(entries,{entryId:meta.nativeEntryId,sessionId:rd.nativeSessionId,
                launchId:previous.row.id,role:'adjudicator',checkpointLeafId:rd.nativeCheckpoint?.leafId,nativeIntent:data.nativeRoleIntent,stage:'raw-assessment'},meta.nativeSource) !== selected[0].raw)
                throw Error('Prior raw assessor source is unavailable');
        }
        material.assertCurrent();
        if (hash(this.rawAssessmentCohort(work,origin)) !== priorFence) throw Error('Prior raw assessor changed during source read');

        if (pending.some(o=>o.kind === 'diagnostic' && ![origin.id,...cohort.previous.map(p=>p.row.id)].includes(o.launchId)) ||
            this.materialAccountingCandidates(work).some(row=>row.id !== origin.id)) return this.inspect(work);
        const target={version:1,holdId:material.holdId,targetOutputId:material.primaryOutputId,originLaunchId:origin.id,
            diagnosisOccurrenceId:material.diagnosisOccurrenceId,originalMaterialOccurrenceIds:material.originalMaterialOccurrenceIds,
            projectedOccurrenceIds:material.projectedOccurrenceIds,knownOccurrenceIds:cohort.claims.map(row=>row.id),evidence:this.rawAssessmentEvidence(origin)};
        const freeze=(value:any):void=>{if(value && typeof value === 'object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(target);
        const targetHash=hash(target), before=hash(cohort);
        const assertCurrent=()=>{
            material.assertCurrent();
            if (hash(target) !== targetHash || hash(this.rawAssessmentCohort(work,origin,this.operations.get(work)?.rawAssessmentActor)) !== before)
                throw Error('Original raw assessment target or current claim roster changed');
        };
        return this.operation(options,'raw-assessment',async()=>{
            const judgment=await this.role(options,'adjudicator',{stage:'raw-assessment',rawAssessment:target},false,assertCurrent);
            const allowed=new Set(['version','summary','findings','assessedScope','decisions','ownerDecisionRequired']);
            if (Object.keys(judgment.protocol).some(key=>!allowed.has(key)) || judgment.protocol.ownerDecisionRequired?.length ||
                judgment.protocol.decisions?.some(d=>d.resolution === 'repaired' || d.implementation || d.implementationCarry))
                throw Error('Raw assessment cannot authorize task/plan/criteria/repair/effect actions');
            const decisions=judgment.protocol.decisions ?? [], primary=decisions.find(d=>d.occurrenceId === target.diagnosisOccurrenceId);
            if (primary?.disposition !== 'upheld' || primary.resolution !== 'diagnosed' ||
                hash(decisions.map(d=>d.occurrenceId).sort()) !== hash([...target.knownOccurrenceIds].sort()))
                throw Error('Raw assessment needs its exact primary diagnosis and every known subject');
            const proofs=await this.prevalidateDiagnoses(work,judgment);
            judgment.assertInputCurrent();assertCurrent();this.h.assertApplicationAdmission?.(work);this.applicationBinding(options);
            if (this.workflowCriteriaHold(work)) throw Error('Current criteria changed during raw assessment');
            const judge=this.s.one('SELECT * FROM role_launches WHERE id=?',judgment.launchId), judgeHistory=this.materialHistoryIdentity(parse(judge.data).historyRef);
            if (!judgeHistory) throw Error('Actual raw assessor history is unavailable');
            this.s.tx(()=>{
                judgment.assertInputCurrent();assertCurrent();this.guard(work);
                // Original source proof excludes this receiver's new claims;
                // independent closure still requires a complete post-harvest census.
                if (this.s.one('SELECT f.id FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE f.work=? AND o.launch=? LIMIT 1',work,judgment.launchId))
                    throw Error('New raw assessor findings require another explicit independent assessment with their assigned IDs');
                this.dispositions(work,judgment.launchId,judgment.protocol,{occurrenceIds:target.knownOccurrenceIds},undefined,proofs);
                const receipt:any={version:2,id:randomUUID(),target,judgeLaunchId:judgment.launchId,judgeOutputId:judgment.output,judgeSourceFence:this.diagnosisJudgeFence(work,judge.id,judgment.output,'semantic-v2')};
                const hold=this.s.one('SELECT * FROM obligations WHERE id=? AND work=?',target.holdId,work);
                if (!hold || parse(hold.data).state !== 'pending') throw Error('Original raw duty changed before assessment commit');
                this.s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...parse(hold.data),state:'resolved',method:'independent-raw-assessment/v1',semanticAssessment:receipt.id}),target.holdId);
                receipt.snapshot=this.rawAssessmentCacheSnapshot(origin,receipt,'semantic-v2');
                if (receipt.snapshot.judgeHistoryIdentity !== judgeHistory) throw Error('Raw assessor history changed before semantic receipt');
                this.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...parse(this.s.one('SELECT data FROM role_launches WHERE id=?',origin.id).data),rawAssessmentReceipt:receipt}),origin.id);
                const updated=this.s.one('SELECT * FROM role_launches WHERE id=?',origin.id);
                if (!this.rawAssessmentReceiptCurrent(updated)) throw Error('Raw assessment receipt is not current');
                this.recordMaterialAccounting(updated,receipt.snapshot.source.historyIdentity);
            });
            return this.blocked(work,'Original raw response independently assessed; other task duties remain','Explicit resume within retained allowance');
        },undefined,{assertCurrent});
    }
    private assertMaterialAccountingCurrent(work:string) {
        const reason = this.materialAccountingHoldReason(work);
        if (reason) throw Error(reason);
    }
    private recordMaterialAccounting(launch:any,identity:string) {
        const receipt = this.materialAccountingSnapshot(launch), ld = parse(launch.data), run = this.s.one('SELECT data FROM runs WHERE id=?',launch.run), rd = parse(run.data);
        if (receipt.historyIdentity !== identity) throw Error('Original settled producer history changed during accounting commit');
        this.s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...ld,materialAccounting:{version:this.materialAccountingVersion(launch),originalCheckpoint:rd.nativeCheckpoint,nativeSessionId:rd.nativeSessionId,...receipt}}),launch.id);
    }
    /** Explicit recovery restores literal claim accounting before a paid replacement. */
    private async restoreSettledRoleMaterial(options: {workId:string;signal?:AbortSignal;applicationModel?:ApplicationModelOperation}) {
        const work = options.workId, candidates = () => this.materialAccountingCandidates(work);
        const initialCandidates = candidates();
        if (!initialCandidates.length) return true;
        if (initialCandidates.some(launch => this.hasMalformedSelectedRoleMetadata(launch.id))) return false;
        const owner = this.work(work), deliveredCoverage = owner.state === 'DELIVERED' ? {epoch:owner.epoch,generation:owner.generation,versions:this.bindings(work),sourceVersion:hash(this.h.sourceImpacts(work).map(i=>[i.input_id,i.revision,i.source]))} : undefined;
        await this.operation(options, 'recover', async () => {
            for (const launch of candidates()) {
                const run = this.s.one('SELECT * FROM runs WHERE id=?', launch.run), ld = parse(launch.data), rd = run && parse(run.data), owner = this.work(work);
                if (!run || run.work !== work || run.epoch !== launch.epoch || launch.epoch > owner.epoch || run.generation > owner.generation ||
                    run.phase !== 'SETTLED' || run.reservation !== 'consumed' || rd.kind !== 'governed-role' || rd.launchId !== launch.id || rd.role !== launch.role ||
                    rd.cleanup !== 'removed' || ld.cleanup !== 'removed' || !rd.historyRef || rd.historyRef !== ld.historyRef ||
                    !rd.nativeCheckpoint || !rd.nativeSessionId || rd.nativeSessionId !== ld.nativeSessionId)
                    throw Error('Original settled producer evidence unavailable; restore its exact history and cleanup before reentry');
                const rows = () => hash([this.s.one('SELECT * FROM role_launches WHERE id=?', launch.id), this.s.one('SELECT * FROM runs WHERE id=?', run.id), this.s.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid', launch.id),
                    this.s.all('SELECT f.* FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output WHERE o.launch=? ORDER BY o.rowid,f.ordinal',launch.id),
                    this.s.one('SELECT * FROM obligations WHERE id=? AND work=?',`raw-incomplete-${launch.id}-native-material`,work)]);
                const history = () => {
                    const stat = lstatSync(rd.historyRef, {bigint:true});
                    if (!stat.isFile() || stat.nlink !== 1n) throw Error('Original settled producer history is unavailable');
                    return hash([stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String));
                };
                const semanticHoldId=`raw-incomplete-${launch.id}-native-material`, semanticHold=this.s.one('SELECT data FROM obligations WHERE id=? AND work=?',semanticHoldId,work);
                if ((ld.rawAssessmentReceipt || parse(semanticHold?.data ?? '{}').method === 'independent-raw-assessment/v1') && !this.rawAssessmentReceiptCurrent(launch)) {
                    if (semanticHold) this.s.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({...parse(semanticHold.data),state:'pending'}),semanticHoldId);
                }
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
                const selectedOutputs=this.historicalSelectedOutputs(launch.id),primary=selectedOutputs.length===1?selectedOutputs[0]:undefined,primaryData=parse(primary?.data);
                const settledPrefixCheckpoint=launch.status==='UNUSABLE'&&dispatch.request.version===1&&rd.allocatedNative===true&&rd.attainedNative===true&&
                    primary?.status==='unusable'&&primary.raw===null&&primaryData.protocol===null&&primaryData.nativeSource===null&&primaryData.terminal==='aborted'&&
                    primaryData.rawFinalTruncated===false&&primaryData.omittedFindingCount===0&&primaryData.historyRef===rd.historyRef&&ld.nativeRoleIntent.stage===ld.stage
                    ? rd.nativeCheckpoint.leafId : undefined;
                this.s.tx(() => {
                    this.guard(work);
                    if (rows() !== before || history() !== identity) throw Error('Original settled producer changed before accounting commit');
                    const complete = this.harvestEntries(work, launch.id, launch.role, entries, {historyRef:rd.historyRef,providerRequests:null,issues:[],events:[],nativeSource:metadata?.nativeSource,rawFinalTruncated:false,
                        rawFinal:final?.raw ?? null,protocol:metadata?.protocol ?? null,nativeSessionId:rd.nativeSessionId,nativeCheckpoint:rd.nativeCheckpoint}, metadata?.nativeEntryId ?? null,settledPrefixCheckpoint);
                    if (!complete && !this.rawAssessmentReceiptCurrent(this.s.one('SELECT * FROM role_launches WHERE id=?',launch.id))) return;
                    const holdId = `raw-incomplete-${launch.id}-native-material`, hold = this.s.one('SELECT data FROM obligations WHERE id=? AND work=?', holdId, work);
                    if (hold && complete) {
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
                const originalRows=hash([launch,run,this.s.one('SELECT * FROM obligations WHERE id=?',obligation.id)]);
                const assertOriginal=()=>{this.h.assertOpen();this.h.assertOwner?.();this.h.assertApplicationAdmission?.(work);this.guard(work);if(hash([this.s.one('SELECT * FROM role_launches WHERE id=?',launch.id),this.s.one('SELECT * FROM runs WHERE id=?',run.id),this.s.one('SELECT * FROM obligations WHERE id=?',obligation.id)])!==originalRows)throw Error('Original interrupted producer changed during recovery');};
                assertOriginal();
                const unallocated = data.cleanup === 'not-allocated' && ['containerId', 'historyRef', 'nativeSessionId', 'nativeCheckpoint'].every(key => data[key] === undefined || data[key] === null) && ['allocatedNative', 'attainedNative', 'modelDispatchAttempted'].every(key => data[key] === undefined || data[key] === null || data[key] === false);
                if (data.kind === 'governed-role' && (data.launchId !== launch.id || data.cleanup !== 'removed' && !unallocated))
                    throw Error('Interrupted governed producer cleanup/correspondence unavailable');
                const replan = launch.role === 'implementer' && metadata.stage === 'implementation' && data.kind === 'governed-role' && data.launchId === launch.id && !selected.candidate && metadata.inputVersions?.candidate === null && selected.plan && this.sameNonCandidateBindings(work, metadata.inputVersions) && hash(metadata.acceptedPlan) === this.version(selected.plan).hash;
                let entries: any[] = [], checkpoint: any = null, recoveredHistory:string|null=null;
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
                        let snapshot = await readNativeHistoryWitness(data.historyRef, data.nativeCheckpoint);
                        assertOriginal();
                        if((snapshot.entries as any[]).some(e=>e.customType===nativeRoleEntries.intent&&e.data?.request?.binding?.nativeEvidencePolicy==='embedded-envelope/v2')){
                            if(!this.h.assertOwner)throw Error('Original recovery requires held controller ownership');
                            const [{initializePiHost},{recoverNativeRoleCapture}]=await Promise.all([
                                import('../pi/host.js'),import('../workflow/native-role-recovery.js'),
                            ]);
                            assertOriginal();
                            const host=await initializePiHost({stateRoot:this.h.state,artifactRoot:path.join(this.h.options.installationHome,'artifacts')});assertOriginal();
                            snapshot=await recoverNativeRoleCapture(data.historyRef,snapshot,{sessionId:data.nativeSessionId,launchId:launch.id,role:launch.role,writerPid:data.controllerPid,intent:metadata.nativeRoleIntent,dispatchCheckpoint:metadata.nativeRoleDispatchCheckpoint},host,assertOriginal);assertOriginal();
                        }
                        checkpoint = snapshot.checkpoint;
                        recoveredHistory=snapshot.historyIdentity;
                        if (checkpoint.sessionId !== data.nativeSessionId)
                            throw new Error('Interrupted native identity mismatch');
                        entries = expandNativeTransport(snapshot.entries);
                    }
                }
                else if (data.attainedNative)
                    throw new Error('Required interrupted native history reference absent');
                assertOriginal();
                this.s.tx(() => {
                    assertOriginal();
                    if(data.historyRef&&(!recoveredHistory||recoveredHistory!==this.materialHistoryIdentity(data.historyRef)))throw Error('Recovered history changed before collection');
                    this.harvestEntries(work, launch.id, launch.role, entries, { role: launch.role, providerRequests: null, historyRef: data.historyRef, nativeSessionId:data.nativeSessionId,nativeCheckpoint:checkpoint, events: this.s.all('SELECT data FROM observations WHERE run=?', run.id).map(row => parse(row.data)) }, null);
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
            const row = this.row(options.workId);
            this.phase(options.workId, row.phase, { resumeStage: this.continuationStage(options.workId, row) ?? null });
            const judge = await this.role(options, 'adjudicator', { stage: 'source-fit', sourceFitInput: {version: 1}, purpose: 'Assess held directions before affected action' });
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
        if (this.hasUnreadableRoleMaterial(work)) return this.inspect(work);
        if (this.workflowCriteriaHold(work)) {
            // Preserve observations under their original captured rules without
            // adopting current rules, activating an owner or entering a new stage.
            const owner = this.work(work);
            if (['ACTIVE','DELIVERED'].includes(owner.state) && !this.h.busy(work))
                await this.restoreSettledRoleMaterial(options);
            return this.inspect(work);
        }
        if (this.h.busy(work))
            throw new Error('Work busy');
        const initial = this.work(work);
        if (workCleanupUnconfirmed(this.s, initial))
            return this.inspect(work);
        if (initial.state === 'CANCELLED' || initial.state === 'INTERRUPTED' || initial.state === 'DELIVERED' && this.h.sourceImpacts(work).some(input => input.data.effectHold))
            this.s.run('UPDATE works SET state=?,epoch=epoch+1,generation=generation+1 WHERE id=?', 'ACTIVE', work);
        if (!await this.restoreSettledRoleMaterial(options)) {
            if (this.materialAccountingHoldReason(work) === selectedRoleMetadataUnavailable) return this.inspect(work);
            if (initial.state === 'ACTIVE' && !this.workflowCriteriaHold(work)) return this.assessRetainedRaw(options).catch(error=>this.work(work).state === 'ACTIVE' ? this.blocked(work,String(error),'Inspect the assessment blockers and retained findings before explicitly resuming this same work') : this.inspect(work));
            return this.inspect(work);
        }
        this.h.assertOpen(); this.applicationBinding(options); this.h.assertApplicationAdmission?.(work);
        options.signal?.throwIfAborted();
        if (this.workflowCriteriaHold(work)) return this.inspect(work);
        if (this.pending(work).some(o => o.kind === 'raw-findings-incomplete'))
            return this.blocked(work, 'Original producer material is incomplete or unsupported; complete finding accounting is unavailable', `Inspect retained producer history and extraction issues in /work ${work}. Ordinary task continuation requires complete source accounting; a replacement result cannot reconstruct missing material`);
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
        for (let i = 0; i < limit; i++) {
            this.h.assertApplicationAdmission?.(work);
            if (options.signal?.aborted || this.work(work).epoch !== epoch || this.work(work).state !== 'ACTIVE')
                return this.inspect(work);
            if (this.sourceAwareStage(work) === 'source-fit') {
                await this.fitSource(options);
                this.h.assertApplicationAdmission?.(work);
                if (this.h.sourceImpacts(work).some(input => input.data.effectHold))
                    return this.inspect(work);
            }
            const r = this.row(work);
            const stage = this.continuationStage(work, r);
            if (stage === 'complete')
                return this.work(work).state === 'ACTIVE' ? this.operation(options, 'source-fit-ready', () => this.ready(work)) : this.inspect(work);
            const retainedStage = this.retainedCandidateStage(work, r);
            const sourceVersion = hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source]));
            if (stage === 'capture')
                await this.recapture(options);
            else if (stage === 'plan')
                await this.plan(options);
            else if (stage === 'implement') {
                const outcome = r.phase === 'BLOCKED'
                    ? await this.operation(options, 'implement', async () => {
                        if (r.data.nextAction === 'Explicit resume within retained allowance' && hash(r.data.blocked) === hash(['Bounded drive step limit reached'])) this.restoreBoundedPlan(work);
                        else if (this.hasUnstartedAcceptedPlan(work)) this.restoreAcceptedPlan(work, digest => this.retrySourceCorresponds(work, digest));
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
            else if (stage === 'checks') {
                if (retainedStage === 'checks') {
                    const { outcome, admitted } = await this.checkRetainedCandidate(options);
                    if (!admitted) return outcome;
                }
                else await this.checks(options);
            }
            else if (stage === 'review')
                await this.review(options);
            else if (stage === 'resolve')
                await this.resolve(options);
            else if (stage === 'confirm')
                await this.confirm(options);
            else
                return this.inspect(work);
            const after = this.row(work);
            // A late owner input belongs to the next explicit continuation. The
            // admitted stage already rejected stale effects; do not overwrite
            // its checkpoint with a synthetic no-progress failure.
            if (sourceVersion !== hash(this.h.sourceImpacts(work).map(input => [input.input_id, input.revision, input.source])))
                return this.inspect(work);
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

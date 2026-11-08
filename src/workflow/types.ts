import type { RoleRequestLimit } from './execution-bounds.js';
import type { NativeRoleSource } from './native-role-output.js';
import type { ProviderUsageLimit } from './provider-failure.js';
import type { PiCoordination } from '../pi/coordination.js';
import type { NativeIdentity, NativeLifecycle } from '../controller/interaction-types.js';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { PiHostEnvironment } from '../pi/host.js';
import type { PiProjectOperations } from '../pi/operations.js';
import type { PiModelSelection } from '../pi/session.js';
export type Role = 'planner' | 'challenger' | 'adjudicator' | 'implementer' | 'reviewer' | 'repairer' | 'confirmer';
export interface Requirement {
    id: string;
    text: string;
    source: string;
}
export interface VerificationCase {
    id: string;
    kind: 'healthy' | 'adverse';
    guaranteeIds: string[];
    derivation: string;
    consumerPaths: string[];
    input: {
        literalUtf8: string;
        fixturePaths: string[];
    };
    expected: {
        kind: 'return' | 'rejection';
        value: string;
    };
}
export interface CheckOutputCase {
    id: string;
    inputDigest: string;
    observed: {
        kind: 'return' | 'rejection';
        value: string;
    };
}
export interface CheckSpec {
    id: string;
    guaranteeIds: string[];
    command: string;
    assertions: string[];
    /** Captured grammar3, original BASE observation only; every other assertion must pass. */
    baselineExpectedFailures?: string[];
    timeoutMs: number;
    fixturePaths: string[];
    expectationPaths?: string[];
    cases?: VerificationCase[];
    consumerControl?: {
        path: string;
        replacementPath?: string;
        failedAssertions: string[];
        observations: {id: string; observed: CheckOutputCase['observed']}[];
    };
}
export interface CheckAmendmentProposal {
    obligationId: string;
    failedCheckRunId: string;
    basis: 'fixture-defect' | 'owner-requirement-revision';
    correctedCheckId: string;
    fixturePaths: string[];
    negativeAssertions: string[];
    caseIds?: string[];
    negativeCaseIds?: string[];
    negativeReplacement?: { path: string; text: string };
    ownerInputId?: string;
    reason: string;
}
export interface CheckResolution {
    amendmentId: string;
    disposition: 'corrected-fixture' | 'authorized-requirement-revision';
    reason: string;
    witnesses: string[];
}
export interface CriteriaDecision {
    sourceId: string;
    fromContractsVersion: string;
    toContractsVersion: string;
    verdict: 'adopt' | 'needs-owner';
    reason: string;
}
export type CriteriaRefreshRequirement = Readonly<Pick<CriteriaDecision, 'sourceId' | 'fromContractsVersion' | 'toContractsVersion'>>;
export interface CheckOutput {
    version: 1;
    cases?: CheckOutputCase[];
    assertions: {
        id: string;
        passed: boolean;
        actual?: string;
    }[];
}
export type AtomicVerificationStrategy =
    | { requirementId: string; kind: 'consumer-cases'; checkIds: string[] }
    | { requirementId: string; kind: 'base-execution-duty'; checkId: string; caseIds: string[]; reviewKey: string }
    | { requirementId: string; kind: 'manifest-scope-duty'; allowedChangePaths: string[]; unchangedPaths: string[]; reviewKey: string };
type InheritedRequirement<S> = S extends { requirementId: string } ? Omit<S, 'requirementId'> : never;
export type VerificationStrategyPart = InheritedRequirement<AtomicVerificationStrategy>;
export type VerificationStrategy = AtomicVerificationStrategy | {
    requirementId: string;
    kind: 'all-of';
    parts: VerificationStrategyPart[];
};
export interface VerificationDecision {
    requirementId: string;
    strategyDigest: string;
    witnessIds: string[];
    verdict: 'satisfied' | 'unavailable';
    reason: string;
}
const planningGrammars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type PlanningGrammar = typeof planningGrammars[number];
export function isPlanningGrammar(value: unknown): value is PlanningGrammar {
    return planningGrammars.some(version => value === version);
}
export interface PlanningVerificationProfile {
    version: PlanningGrammar;
    supported: boolean;
    allowedKinds: readonly VerificationStrategy['kind'][];
    baseline: { newObservation: boolean; crossPlanReuse: false; priorDuty: boolean };
    reason?: string;
}
export interface ProposalApproval {
    readonly version: 1;
    readonly plannerOutputId: string;
    readonly proposalHash: string;
    readonly plannerOutputHash: string;
    readonly proposal: PlanProposal;
}
export interface RoleOutputConstraints {
    consumerControlProposal?: true | 'pass';
    /** Original captured strategy grammar only; does not confer contextual acceptance. */
    strategyGrammarVersion?: PlanningGrammar;
    /** Contextual schema guidance; actual repair/source eligibility remains host-validated. */
    currentRepairWitnessIds?: readonly string[];
    reviewResolution?: { readonly version: 1 | 2 | 3 | 4; readonly stage: 'review-adjudication' };
    subjectActions?: import('./subject-actions.js').SubjectActionProfile;
    verificationFit?: readonly VerificationReviewRequirement[];
    sourceIds?: readonly string[];
    planningProfile?: PlanningVerificationProfile;
    criteriaRefresh?: CriteriaRefreshRequirement;
    sourceFitReferences?: SourceFitReferences;
    decisionReferences?: DecisionReferences;
    diagnosisEligibility?: DiagnosisEligibility;
    proposalApproval?: ProposalApproval;
    decisionCarry?: { readonly version: 1 | 2 } | { readonly version: 3; readonly baselineVersion: string; readonly baseSourceIds: readonly string[] };
    planningRepair?: import('./planning-repair.js').PlanningRepairProfile;
    scopeAmendment?: import('./scope-amendment.js').ScopeAmendmentProfile;
}
interface DecisionReferenceDomain {
    readonly occurrenceIds: readonly string[];
    readonly diagnosisOccurrenceIds: readonly string[];
}
export type DecisionReferences = DecisionReferenceDomain & ({ readonly version: 1 | 2 } | {
    readonly version: 3;
    readonly pendingOrdinaryIndexes: readonly number[];
    readonly blockingOrdinaryIndexes: readonly number[];
    readonly retentionChoices: readonly { readonly dispositionId: string; readonly occurrenceId: string; readonly sha256: string }[];
});
export interface DiagnosisEligibility {
    readonly version: 1 | 2;
    readonly receiptHash: string;
    readonly eligible: readonly {
        readonly occurrenceId: string;
        readonly outputId: string;
        readonly rawSha256: string;
        readonly materialOccurrenceIds: readonly string[];
    }[];
}
export interface VerificationReviewRequirement {
    requirementId: string;
    strategyDigest: string;
    witnessIds: readonly string[];
}
export interface ReviewRequirement {
    key: string;
    kind: 'reviewer';
    purpose: string;
    requiredPaths: string[];
}
export interface PlanProposal {
    intent: string;
    requirements: Requirement[];
    approach: string;
    simplerAlternative: string;
    factualSources: string[];
    verification: {
        checks: CheckSpec[];
        strategies?: VerificationStrategy[];
        checkAmendments?: CheckAmendmentProposal[];
        requiredPaths: string[];
        reviewRoles: ReviewRequirement[];
    };
    ambiguities: string[];
}
export interface Finding {
    requirementId: string;
    severity: 'blocking' | 'optional';
    repair: 'mechanical' | 'substantive' | 'unknown';
    description: string;
    evidence: string[];
    mechanicalPatch?: {
        path: string;
        oldText: string;
        newText: string;
    };
    reproduction?: {
        toolCallId: string;
        command: string;
        assertions: string[];
        expectationPaths?: string[];
    };
}
export interface Disposition {
    occurrenceId: string;
    disposition: 'upheld' | 'rejected' | 'deferred' | 'unresolved' | 'equivalent';
    reason: string;
    witnesses: string[];
    equivalentTo?: string;
    implementationCarry?: { baselineVersion: string; requirementIds: string[] };
    implementation?: { kind: 'none' } | { kind: 'assign-to-plan'; baselineVersion: string; requirementIds: string[]; baseSourceIds?: string[] };
    resolution?: 'pending' | 'repaired' | 'diagnosed';
    repair?: { kind: 'plan' | 'verification-plan'; proposalHash: string };
    diagnosis?: {
        outputId: string;
        rawSha256: string;
        inputReceiptHash: string;
        materialOccurrenceIds: string[];
    };
}
export interface InputDecision {
    inputId: string;
    directionRevision: number;
    impact: 'explanation' | 'scope-change' | 'ambiguous';
    reason: string;
    requirementIds: string[];
}
export interface PayloadDecision {
    payloadHash: string;
    sourceFingerprint: string;
    verdict: 'fit' | 'needs-owner-scope';
    reason: string;
}
export interface NitAuthorization {
    beforeCandidate: string;
    afterDigest: string;
    deltaHash: string;
    consumerCheckIds: string[];
}
export interface AssessedScope {
    sourceId: string;
    startLine: number;
    endLine: number;
}
export interface SourceInput {
    id: string;
    version: string;
    side: 'base' | 'candidate';
    path: string;
    /** Trusted captured UTF-8 bytes represented losslessly as text; not model supplied. */
    content: string;
    sha256: string;
    exposeInPrompt: boolean;
    toolPath?: string;
}
/** Metadata for the one immutable version actually staged in the native workspace. */
export interface SourceCatalogue {
    format: 1;
    version: string;
    side: 'base' | 'candidate';
    files: { path: string; sha256: string; size: number }[];
}
export interface ObservedSourceIdentity {
    id: string;
    version: string;
    side: 'base' | 'candidate';
    path: string;
    sha256: string;
    /** Assessment coordinates of the captured source-scope policy, derived from authenticated full text. */
    lineCount: number;
}
export interface InputBundle {
    requirements: Requirement[];
    contracts: string;
    context: Record<string, unknown>;
    sources: SourceInput[];
    sourceCatalogue?: SourceCatalogue;
    requiredScope: AssessedScope[];
}
/** Captured producer obligations; classifications remain independent judgments. */
export interface SourceFitRequirement {
    inputId: string;
    directionRevision: number;
}
/** Explicit prospective reference domain; original absence preserves old decoding. */
export interface SourceFitReferences {
    readonly version: 1;
    readonly stage: 'planning-adjudication' | 'source-fit' | 'review-adjudication';
    readonly inputs: readonly SourceFitRequirement[];
    readonly requirementIds: readonly string[];
}
/** Independent planning classification; this never resolves the retained finding. */
export interface ImplementationCarry {
    occurrenceId: string;
    baselineVersion: string;
    requirementIds: string[];
    reason: string;
    baseSourceIds?: string[];
}
export interface ImplementationCarryGroup {
    occurrenceIds: string[];
    baselineVersion: string;
    requirementIds: string[];
    reason: string;
}
export interface RoleResult {
    version: 1;
    summary: string;
    findings: Finding[];
    assessedScope: AssessedScope[];
    plan?: PlanProposal;
    alternatives?: string[];
    decisions?: Disposition[];
    retainedDispositions?: string[];
    planAccepted?: boolean;
    implementationCarries?: ImplementationCarry[];
    implementationCarryGroups?: ImplementationCarryGroup[];
    acceptedPlan?: PlanProposal;
    inputDecisions?: InputDecision[];
    payloadDecision?: PayloadDecision;
    checkResolutions?: CheckResolution[];
    scopeAmendments?: import('./scope-amendment.js').ScopeAmendmentDecision[];
    criteriaDecision?: CriteriaDecision;
    ownerDecisionRequired?: string[];
    nitAuthorization?: NitAuthorization;
    outcome?: 'clear' | 'findings';
    verificationDecisions?: VerificationDecision[];
    consumerReplacement?: string;
    confirmed?: boolean;
    witnesses?: string[];
}
export interface SourceExposure extends AssessedScope {
    launchId: string;
    version: string;
    side: 'base' | 'candidate';
    path: string;
    sourceSha256: string;
    rangeSha256: string;
    producer: 'prompt' | 'read';
    toolCallId?: string;
}
export interface RoleObservation {
    type: string;
    [key: string]: unknown;
}
export interface NativeCheckpoint {
    sessionId: string;
    leafId: string;
    bytes: number;
    sha256: string;
}
export interface RunRoleOptions {
    launchId: string;
    role: Role;
    inputBundle: InputBundle;
    inputEvidence?: { launchId: string; manifests: readonly import('./role-input-evidence.js').RoleInputEvidenceManifest[] };
    operations: PiProjectOperations;
    host: PiHostEnvironment;
    model: PiModelSelection;
    signal?: AbortSignal;
    maxReadBytes?: number;
    maxProviderRequests?: number;
    /** Explicit producer experiment; current Controller defaults remain captured separately. */
    nativeCarrier?: 'tool-submission/v1';
    /** Native conversation turns, distinct from Pi/provider invocations. Owned Claude roles only. */
    maxNativeTurns?: number;
    /** Optional whole-role deadline. Null (the default) waits until completion or cancellation. */
    timeoutMs?: number | null;
    /** Required trusted dispatch/selection guard; throwing prevents new project operations. */
    assertEntry(): void;
    /** Required durable controller checkpoint before each provider invocation. */
    beforeModelRequest(manager: SessionManager, nativeIntent?: Readonly<import('./native-role-output.js').NativeRoleIntentReceipt>): Promise<void>;
    /** Optional paired trusted interactive registration; not model-selected identity. */
    nativeIdentity?: NativeIdentity;
    nativeLifecycle?: NativeLifecycle;
    /** Strict roles can acknowledge/address, but never yield with coordinator WAIT. */
    coordination?: Omit<PiCoordination, 'wait'>;
    onHistory?(historyRef: string, nativeSessionId: string): void;
    onObservation?(observation: RoleObservation): void;
}
export interface RoleExecution {
    requestLimit?: RoleRequestLimit;
    evidenceReads?: { boundary: 'host-rendered'; launchId: string; manifestId: string; sha256: string; toolCallId: string; startLine: number; endLine: number; rangeSha256: string }[];
    providerFailure?: ProviderUsageLimit;
    launchId: string;
    role: Role;
    selectedFinalEntryId: string | null;
    nativeSource?: NativeRoleSource;
    rawFinal: string | null;
    rawFinalTruncated: boolean;
    protocol: RoleResult | null;
    usable: boolean;
    issues: string[];
    historyRef: string | null;
    nativeSessionId: string | null;
    nativeCheckpoint: NativeCheckpoint | null;
    terminal: 'complete' | 'error' | 'aborted' | 'incomplete';
    providerRequests: number;
    events: RoleObservation[];
    exposures: SourceExposure[];
}

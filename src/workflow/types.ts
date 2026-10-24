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
    timeoutMs: number;
    fixturePaths: string[];
    expectationPaths?: string[];
    cases?: VerificationCase[];
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
export type VerificationStrategy =
    | { requirementId: string; kind: 'consumer-cases'; checkIds: string[] }
    | { requirementId: string; kind: 'base-execution-duty'; checkId: string; caseIds: string[]; reviewKey: string }
    | { requirementId: string; kind: 'manifest-scope-duty'; allowedChangePaths: string[]; unchangedPaths: string[]; reviewKey: string };
export interface VerificationDecision {
    requirementId: string;
    strategyDigest: string;
    witnessIds: string[];
    verdict: 'satisfied' | 'unavailable';
    reason: string;
}
export interface PlanningVerificationProfile {
    version: 1;
    supported: boolean;
    allowedKinds: readonly VerificationStrategy['kind'][];
    baseline: { newObservation: boolean; crossPlanReuse: false; priorDuty: boolean };
    reason?: string;
}
export interface RoleOutputConstraints {
    verificationFit?: readonly VerificationReviewRequirement[];
    sourceIds?: readonly string[];
    planningProfile?: PlanningVerificationProfile;
    criteriaRefresh?: CriteriaRefreshRequirement;
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
    resolution?: 'repaired' | 'diagnosed';
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
export interface InputBundle {
    requirements: Requirement[];
    contracts: string;
    context: Record<string, unknown>;
    sources: SourceInput[];
    requiredScope: AssessedScope[];
}
/** Captured producer obligations; classifications remain independent judgments. */
export interface SourceFitRequirement {
    inputId: string;
    directionRevision: number;
}
/** Independent planning classification; this never resolves the retained finding. */
export interface ImplementationCarry {
    occurrenceId: string;
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
    planAccepted?: boolean;
    implementationCarries?: ImplementationCarry[];
    acceptedPlan?: PlanProposal;
    inputDecisions?: InputDecision[];
    payloadDecision?: PayloadDecision;
    checkResolutions?: CheckResolution[];
    criteriaDecision?: CriteriaDecision;
    ownerDecisionRequired?: string[];
    nitAuthorization?: NitAuthorization;
    outcome?: 'clear' | 'findings';
    verificationDecisions?: VerificationDecision[];
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
    operations: PiProjectOperations;
    host: PiHostEnvironment;
    model: PiModelSelection;
    signal?: AbortSignal;
    maxReadBytes?: number;
    maxProviderRequests?: number;
    timeoutMs?: number;
    /** Required trusted dispatch/selection guard; throwing prevents new project operations. */
    assertEntry(): void;
    /** Required durable controller checkpoint before each provider invocation. */
    beforeModelRequest(manager: SessionManager): Promise<void>;
    /** Optional paired trusted interactive registration; not model-selected identity. */
    nativeIdentity?: NativeIdentity;
    nativeLifecycle?: NativeLifecycle;
    /** Strict roles can acknowledge/address, but never yield with coordinator WAIT. */
    coordination?: Omit<PiCoordination, 'wait'>;
    onHistory?(historyRef: string, nativeSessionId: string): void;
    onObservation?(observation: RoleObservation): void;
}
export interface RoleExecution {
    launchId: string;
    role: Role;
    selectedFinalEntryId: string | null;
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

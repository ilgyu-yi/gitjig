import type { RoleRequestLimit } from '../workflow/execution-bounds.js';
import type { ModelContextFailureCode } from '../pi/context-budget-error.js';
import type { Role } from '../workflow/types.js';
import type { ProviderUsageLimit } from '../workflow/provider-failure.js';
import type { SessionQueuePreferences } from '../pi/session-preferences.js';
import type { ApplicationModelOperation, WorkModelBaseline } from './application-model.js';
import type { PiModelSelection } from '../pi/session.js';
import type { CheckOutputProblemCounts } from './check-cases.js';
import type { BudgetView } from './work-recovery.js';
import type { RolePresentationStage } from './interaction-types.js';
import type { RuntimeProfile } from './types.js';
type RecordedCheckOutputIssue = Exclude<keyof CheckOutputProblemCounts, 'assertion-roster-size' | 'case-roster-size'>;
export type WorkflowCriteriaHold = 'changed' | 'unavailable';
/** Controller-linked display attribution, never permission to resume. */
export interface PlanningFailureView {
    providerFailure?: ProviderUsageLimit;
    cause?: 'tool-invocation-mismatch';
    role: 'planner' | 'challenger' | 'adjudicator';
    launchId: string;
}
export interface PlanningClarificationView {
    outputId: string;
    questions: {entries: string[]; total: number; omitted: number};
    reply?: {conversationId: string; generation: number; directionRevision: number};
}
/** Original local role request count; display attribution grants no continuation. */
export interface RoleRequestLimitView {
    role: Role;
    roleStage?: RolePresentationStage;
    launchId: string;
    requestLimit: RoleRequestLimit;
}
/** Recorded quota in a normal nonplanning role; no current execution eligibility. */
export interface ProviderFailureView {
    role: Exclude<Role, 'planner' | 'challenger'>;
    launchId: string;
    usageLimit: ProviderUsageLimit;
}
/** Read-only projection of the exact current failed predicate. */
export interface ScopeFailureView {
    evidenceId: string;
    requirementId: string;
    allowedChangePaths: { entries: string[]; omitted: number };
    unchangedPaths: { entries: string[]; omitted: number };
    replanAvailable?: true;
}
/** Current first-role observation only; neither task acceptance nor extension authority. */
export interface AssignmentAllowanceHold {
    stage: string;
    role: Role;
    exhausted: ('execution' | 'resolution')[];
    execution: ChangeView['execution'];
    resolution: ChangeView['resolution'];
    nextAction: string;
}
export type AssignmentOwnerAction = AssignmentAllowanceHold | {
    kind: 'workflow-criteria';
    hold: WorkflowCriteriaHold;
    nextAction: string;
} | {
    kind: 'repeated-check-report';
    checkId: string;
    nextAction: string;
} | {
    kind: 'planning-clarification';
    outputId: string;
    questionCount: number;
    nextAction: string;
};
export interface BeginChangeOptions {
    projectId: string;
    request: string;
    resolutionLimit?: number;
    executionLimit?: number;
    ownerRequirements?: string[];
    applicationModelBaseline?: WorkModelBaseline;
    signal?: AbortSignal;
}
export type ChangeOperation = {
    workId: string;
    signal?: AbortSignal;
} & ({
    model: PiModelSelection;
    applicationModel?: never;
    sessionPreferences?: never;
} | {
    applicationModel: ApplicationModelOperation;
    sessionPreferences?: SessionQueuePreferences;
    model?: never;
});
/** Checks keep an application's retained binding without selecting a model.
 * Only legacy work without a captured model binding accepts a bare request. */
export type CheckChangeOperation = ChangeOperation | {
    workId: string;
    signal?: AbortSignal;
    model?: never;
    applicationModel?: never;
    sessionPreferences?: never;
};
export interface VerificationEvidenceView {
    availability: 'available' | 'unavailable';
    digest?: string;
    reason?: string;
    requirements: {
        requirementId: string;
        kind: 'consumer-cases' | 'base-execution-duty' | 'manifest-scope-duty' | 'all-of';
        strategyDigest: string;
        reviewKey?: string | null;
        reviewKeys?: string[];
        parts?: {kind:'consumer-cases'|'base-execution-duty'|'manifest-scope-duty';strategyDigest:string;reviewKeys:string[];witnessAvailability:'recorded'|'unavailable';witnessIds:string[];reason?:string;scope?:{witnessId:string;predicate:string;actual:{satisfied:boolean;changedCount:number;violationCount:number};adverse:{satisfied:boolean}}}[];
        witnessAvailability: 'recorded' | 'unavailable';
        witnessIds: string[];
        reviewLaunchIds: string[];
        reason?: string;
        scope?: { witnessId: string; predicate: string; actual: { satisfied: boolean; changedCount: number; violationCount: number }; adverse: { satisfied: boolean } };
    }[];
}
export interface ChangeView {
    ownerActivation: 'pending' | 'complete' | 'not-recorded';
    workId: string;
    /** Current work state, separate from the retained procedure stage. */
    state: string;
    recordedPhase: string;
    phase: string;
    epoch: number;
    baseVersion: string | null;
    candidateVersion: string | null;
    planVersion: string | null;
    verificationVersion: string | null;
    verificationReplanAccepted?: true;
    resolution: {
        limit: number;
        consumed: number;
        reserved: number;
    };
    execution: {
        limit: number;
        consumed: number;
        reserved: number;
    };
    /** Current original host budget cause; display metadata grants no admission. */
    modelContextFailure?: ModelContextFailureCode;
    workflowCriteriaHold?: WorkflowCriteriaHold;
    /** A criteria hold leaves no retained original material for resume to restore. */
    workflowCriteriaBlocksResume?: true;
    planningFailure?: PlanningFailureView;
    planningClarification?: PlanningClarificationView;
    providerFailure?: ProviderFailureView;
    roleRequestLimit?: RoleRequestLimitView;
    scopeFailure?: ScopeFailureView;
    restoredRoleMaterialLaunchId?: string;
    blocked: string[];
    nextAction: string;
    versions: unknown[];
    launches: unknown[];
    checks: unknown[];
    occurrences: unknown[];
    dispositions: unknown[];
    verificationEvidence?: VerificationEvidenceView;
    reviewReady: boolean;
    limitations: string[];
}
export type DriveChangeOptions = ChangeOperation & {
    maximumSteps?: number;
};
export interface ChangeSummary {
    workId: string;
    projectId: string;
    state: string;
    recordedPhase: string;
    requestPreview: string;
    originConversationId: string | null;
    model: {
        provider: string;
        modelId: string;
    } | null;
}
export interface ChangePage {
    changes: ChangeSummary[];
    nextCursor: string | null;
}
export type StartConversationChangeOptions = BeginChangeOptions & {
    conversationId: string;
    expectedGeneration: number;
    expectedModelRevision: number;
    model?: PiModelSelection;
    maximumSteps?: number;
};
export interface ResumeConversationChangeOptions {
    conversationId: string;
    expectedGeneration: number;
    expectedModelRevision: number;
    workId: string;
    expectedEpoch: number;
    expectedReview?: {
        runtime: RuntimeProfile;
        draftRevision: number;
        execution: BudgetView;
        resolution: BudgetView;
    };
    expectedResumeDirections?: string;
    expectedScopeReplan?: string;
    expectedCheckReplan?: string;
    expectedVerificationReplan?: string;
    resumeCancelled?: boolean;
    model?: PiModelSelection;
    maximumSteps?: number;
    signal?: AbortSignal;
}

/** Bounded historical presentation. It neither reads project/artifact contents nor grants an action. */
export interface RecordedCheckFailures {
    assertionIds: string[];
    caseIds: string[];
    omitted: number;
    caseValues?: {
        id: string;
        expected: RecordedCheckCaseValue;
        observed: RecordedCheckCaseValue;
    }[];
}

export type RecordedCheckCaseValue = {kind: 'return' | 'rejection'; value: string | null};

export interface ChangeResultOptions {
    caseValues?: boolean;
    retainedChecks?: boolean;
    checkStderr?: boolean;
}

export interface ChangeResultView {
    workId: string;
    projectId: string;
    request: string;
    requestTruncated: boolean;
    registeredSourceRoot: string;
    state: string;
    recordedPhase: string;
    verificationEvidence?: VerificationEvidenceView;
    /** Passing check identities for a requirement still held by the selected independent review. */
    verificationGap?: { requirementId: string; findingId: string; passingChecks: string[]; omittedChecks: number };
    verificationReplanAccepted?: true;
    reviewReady: boolean;
    /** Current original host budget cause; display metadata grants no admission. */
    modelContextFailure?: ModelContextFailureCode;
    workflowCriteriaHold?: WorkflowCriteriaHold;
    planningFailure?: PlanningFailureView;
    planningClarification?: PlanningClarificationView;
    providerFailure?: ProviderFailureView;
    roleRequestLimit?: RoleRequestLimitView;
    scopeFailure?: ScopeFailureView;
    restoredRoleMaterialLaunchId?: string;
    replanKind?: 'scope' | 'check' | 'verification';
    blocked: string[];
    blockedOmitted: number;
    sharedAllowance?: { execution: BudgetView; resolution: BudgetView };
    pendingFindings?: number;
    nextAction: string;
    heldDirections?: {entries: {inputId: string; directionRevision: number; sourceOrigin: string}[]; omitted: number};
    candidate: {versionId: string; path: string; hash: string} | null;
    changes: {
        availability: 'recorded' | 'no-candidate' | 'unavailable';
        entries: {path: string; kind: 'added' | 'modified' | 'removed' | 'mode-changed' | 'link-added' | 'link-modified' | 'link-removed' | 'directory-added' | 'directory-removed'}[];
        total: number | null;
        omitted: number;
        reason?: string;
    };
    checks: {
        availability: 'recorded' | 'not-planned' | 'unavailable';
        entries: {checkId: string; receiptId: string | null; runId: string | null; status: 'pass' | 'fail' | 'unavailable' | 'stale' | 'missing' | 'baseline-observed'; passed: boolean; target?: 'base' | 'candidate'; purpose?: 'baseline' | 'required'; observed?: boolean; unavailableReason?: 'output-contract'; outputIssues?: Partial<Record<RecordedCheckOutputIssue, number>>; outputIssueIds?: Partial<Record<RecordedCheckOutputIssue, string[]>>; stderrExcerpt?: { text: string; shortened: boolean }; observedCounts?: {assertions: number; cases: number}; failures?: RecordedCheckFailures; consumerControl?: 'pending' | 'matched' | 'prediction-mismatch' | 'held'; consumerControlExpectedPass?: true; consumerControlReceiptId?: string; production?: {exitCode: number | null; termination: 'timeout' | 'aborted' | 'output-limit' | null; report: 'accepted' | 'rejected' | 'unknown'}; cleanup: string | null; durationMs: number | null}[];
        total: number | null;
        omitted: number;
        reason?: string;
    };
    retainedCheckFailures?: {
        entries: {checkId: string; receiptId: string; failures: RecordedCheckFailures}[];
        omitted: number;
        unavailable: number;
    };
    reviews: {
        availability: 'recorded' | 'not-planned' | 'unavailable';
        entries: {key: string; launchId: string | null; runId: string | null; state: 'selected' | 'carried' | 'stale' | 'missing' | 'unavailable'; outcome: 'clear' | 'findings' | 'unavailable'; findingCount: number | null; outputId: string | null}[];
        total: number | null;
        omitted: number;
        reason?: string;
    };
    provenance: {baseVersion: string | null; candidateVersion: string | null; planVersion: string | null; verificationVersion: string | null};
    limitations: string[];
}

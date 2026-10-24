import type { SessionQueuePreferences } from '../pi/session-preferences.js';
import type { ApplicationModelOperation, WorkModelBaseline } from './application-model.js';
import type { PiModelSelection } from '../pi/session.js';
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
export interface VerificationEvidenceView {
    availability: 'available' | 'unavailable';
    digest?: string;
    reason?: string;
    requirements: {
        requirementId: string;
        kind: 'consumer-cases' | 'base-execution-duty' | 'manifest-scope-duty';
        strategyDigest: string;
        reviewKey: string | null;
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
    phase: string;
    epoch: number;
    baseVersion: string | null;
    candidateVersion: string | null;
    planVersion: string | null;
    verificationVersion: string | null;
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
    resumeCancelled?: boolean;
    model?: PiModelSelection;
    maximumSteps?: number;
    signal?: AbortSignal;
}

/** Bounded historical presentation. It neither reads project/artifact contents nor grants an action. */
export interface ChangeResultView {
    workId: string;
    projectId: string;
    request: string;
    requestTruncated: boolean;
    registeredSourceRoot: string;
    state: string;
    recordedPhase: string;
    verificationEvidence?: VerificationEvidenceView;
    reviewReady: boolean;
    blocked: string[];
    blockedOmitted: number;
    nextAction: string;
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
        entries: {checkId: string; receiptId: string | null; runId: string | null; status: 'pass' | 'fail' | 'unavailable' | 'stale' | 'missing' | 'baseline-observed'; passed: boolean; target?: 'base' | 'candidate'; purpose?: 'baseline' | 'required'; observed?: boolean; cleanup: string | null; durationMs: number | null}[];
        total: number | null;
        omitted: number;
        reason?: string;
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

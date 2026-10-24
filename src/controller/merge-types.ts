import type { NativeMergeIdentity } from '../platform/github-merge-session.js';
import type { ReadLimits } from '../platform/github-transport.js';
export interface MergeCredential {
    token: string;
    limits?: Partial<ReadLimits>;
}
export interface RegisterMergeTarget {
    resourceId: string;
    sourceBranchTargetId: string;
    baseRef: string;
}
export interface DelegateMerge {
    workId: string;
    targetId: string;
    operationLimit: number;
    scope?: 'work' | 'delegation-lineage';
    notifications: 'allow-merge-notifications';
}
export interface MergeDelegationConfig {
    projectId: string;
    targetId: string;
    operationLimit: number;
    notifications: 'allow-merge-notifications';
}
export interface MergeView {
    operationId: string;
    workId: string;
    targetId: string;
    phase: 'PREPARED' | 'RESERVED' | 'INVOKING' | 'CONFIRMED' | 'REFUSED' | 'UNKNOWN';
    headCommit: string;
    mergedCommit: string | null;
    receiptIds: readonly string[];
    transportOutcome: 'not-started' | 'native-success' | 'native-rejection' | 'uncertain' | null;
    observedOutcome: 'not-observed' | 'merged-candidate-matches';
    blocked: readonly string[];
    nextAction: string;
}
/** Bounded retained operands only; this is not a native observation or authority. */
export interface MergeRegistrationContext {
    readonly version: 1;
    readonly fingerprint: string;
    readonly project: Readonly<{
        id: string;
        sourceRoot: string;
    }>;
    readonly sourceBranchTargetId: string;
    readonly resourceId: string;
    readonly identity: Readonly<NativeMergeIdentity>;
}

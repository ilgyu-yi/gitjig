import type { Manifest } from './capture.js';
import type { ChangeOperation } from './change-types.js';
export interface CurrentEvidence {
    workId: string;
    epoch: number;
    generation: number;
    versions: {
        base: string;
        candidate: string;
        plan: string;
        verification: string;
        requirements: string | null;
        contracts: string;
    };
    candidateDigest: string;
    sourceChainDigest: string;
    selectionDigest: string;
    checkIds: readonly string[];
    reviewLaunchIds: readonly string[];
    verificationStrategyDigest?: string;
    dispositionDigest: string;
    carryDigest: string | null;
    fingerprint: string;
}
export interface DerivedCandidateInput {
    workId: string;
    expectedEvidence: CurrentEvidence;
    kind: 'publication-projection' | 'base-integration';
    artifact: string;
    manifest: Manifest;
    digest: string;
    producerOperationId: string;
    predecessorCandidate: string;
    native: {
        baseVersion: string;
        targetId: string;
        targetFingerprint: string;
        basisCommit: string;
        headCommit: string;
        integrationCommit?: string;
        tree: string;
        receiptId: string;
    };
    effectiveDifferences: readonly {
        path: string;
        reason: string;
    }[];
    publicationInventory: readonly string[];
}
export interface EffectsProfile {
    gitBinary: string;
    commandTimeoutMs?: number;
    maxOutputBytes?: number;
}
export interface RegisterLocalTarget {
    projectId: string;
    path: string;
    ref: string;
    basisCommit: string;
    publicationInventory: readonly string[];
    authorizedDeltaPaths: readonly string[];
}
export interface DelegateIntegration {
    workId: string;
    targetId: string;
    mode: 'ordinary';
    operationLimit: number;
    scope?: 'work' | 'delegation-lineage';
}
export type PrepareIntegration = ChangeOperation & {
    targetId: string;
    operationId?: string;
};
export interface EffectView {
    operationId: string;
    workId: string;
    targetId: string;
    phase: 'PREPARED' | 'REFRESHED' | 'RESERVED' | 'INVOKING' | 'CONFIRMED' | 'REFUSED' | 'UNKNOWN';
    candidateVersion: string | null;
    expectedBase: string | null;
    headCommit: string | null;
    integrationCommit: string | null;
    receiptIds: readonly string[];
    transportOutcome: 'not-started' | 'native-success' | 'native-rejection' | 'uncertain' | null;
    observedOutcome: 'contains-integration' | 'not-observed' | 'unknown';
    blocked: readonly string[];
    nextAction: string;
}
export interface EffectDelegationConfig {
    projectId: string;
    targetId: string;
    operationLimit: number;
}

/** Software correspondence excludes later payload dispositions, never typed verification identity. */
export function softwareEvidenceIdentity(evidence: CurrentEvidence | null | undefined) {
    if (!evidence) return null;
    if (Object.hasOwn(evidence, 'verificationStrategyDigest') && (typeof evidence.verificationStrategyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.verificationStrategyDigest)))
        throw new Error('Present typed verification identity is invalid');
    return { workId: evidence.workId, epoch: evidence.epoch, generation: evidence.generation, versions: evidence.versions,
        candidateDigest: evidence.candidateDigest, sourceChainDigest: evidence.sourceChainDigest, selectionDigest: evidence.selectionDigest,
        checkIds: evidence.checkIds, reviewLaunchIds: evidence.reviewLaunchIds, carryDigest: evidence.carryDigest,
        ...(Object.hasOwn(evidence, 'verificationStrategyDigest') ? { verificationStrategyDigest: evidence.verificationStrategyDigest } : {}) };
}

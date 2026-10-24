import type { ConfigurationAttempt } from '../platform/github-configuration-types.js';
import type { RepositoryTarget as ConfigurationTarget, RepositoryProfile as ConfigurationProfile, RepositoryPlan as ConfigurationPlan, RepositoryActivation } from '../platform/configuration-session.js';
import type { ReadLimits } from '../platform/github-transport.js';
export interface RepositoryConfigurationCredential {
    token: string;
    limits?: Partial<ReadLimits>;
}
export interface RegisterRepositoryConfigurationTarget {
    target: ConfigurationTarget;
}
export interface PreviewRepositoryConfiguration {
    targetId: string;
    profile: ConfigurationProfile;
    continuationPlanId?: string;
    ownedCreationOperationId?: string;
    signal?: AbortSignal;
}
export interface RepositoryConfigurationOperation {
    planId: string;
    signal?: AbortSignal;
}
export interface RepositoryConfigurationView {
    planId: string;
    operationId: string;
    workId: string;
    targetId: string;
    revision: number;
    phase: 'PREVIEWING' | 'PREVIEWED' | 'APPLYING' | 'PARTIAL' | 'CONFIRMED' | 'REFUSED' | 'UNKNOWN' | 'CANCELLED';
    plan: ConfigurationPlan | null;
    steps: readonly {
        journalId: string;
        revision: number;
        stepId: string;
        kind: string;
        state: 'PENDING' | 'INVOKING' | 'CONFIRMED' | 'REFUSED' | 'UNKNOWN';
        transportOutcome: 'not-started' | 'native-success' | 'native-rejection' | 'uncertain' | null;
        observations: ConfigurationAttempt['fieldObservations'];
        nativeResource?: import('../platform/configuration-session.js').NativeProtectionResource;
        creationHint: {
            id: number;
            nodeId: string;
        } | null;
        receiptIds: readonly string[];
    }[];
    receiptIds: readonly string[];
    activation: RepositoryActivation;
    blocked: readonly string[];
    nextAction: string;
}
export interface RepositoryConfigurationAudit {
    planId: string;
    targetId: string;
    view: RepositoryConfigurationView;
    steps: readonly {
        journalId: string;
        result: unknown;
    }[];
    complete: boolean;
    unknowns: readonly string[];
}
export interface RepositoryConfigurationGuidance {
    targetId: string;
    branch: string;
    observation: unknown;
    limitations: readonly string[];
}

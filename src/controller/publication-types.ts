import type { PublicationAction, PublicationTarget, CarrierPolicy, PublicationResource } from '../platform/github-publication.js';
import type { ReadLimits } from '../platform/github-transport.js';
export type PublicationActionClass = 'create-issue' | 'create-draft-pr' | 'create-comment:bootstrap' | 'create-comment:reviewed-summary' | 'create-comment:contribution-summary';
export interface RegisterPublicationTarget {
    projectId?: string | null;
    target: PublicationTarget;
    visibility: 'public' | 'private';
    carrierPolicy?: CarrierPolicy;
}
export interface PublicationDelegationConfig {
    targetId: string;
    actions: readonly PublicationActionClass[];
    operationLimit: number;
    projectIds?: readonly (string | null)[];
}
export interface DelegatePublication extends PublicationDelegationConfig {
    workId: string;
    scope?: 'work' | 'delegation-lineage';
}
export interface PublicationCredential {
    token: string;
    limits?: Partial<ReadLimits>;
}
export interface PrepareOwnerPublication {
    targetId: string;
    action: PublicationAction;
    workId?: string;
    operationId?: string;
    signal?: AbortSignal;
}
export interface PublicationView {
    operationId: string;
    workId: string;
    targetId: string;
    action: PublicationAction['kind'];
    purpose: 'bootstrap' | 'reviewed-summary' | 'contribution-summary' | 'draft';
    phase: 'PREPARED' | 'RESERVED' | 'INVOKING' | 'CONFIRMED' | 'REFUSED' | 'UNKNOWN';
    relatedBlockerIds: readonly string[];
    findingProjection: {
        complete: boolean;
        total: number;
        omitted: number;
        rows: readonly {
            occurrenceId: string;
            launchId: string;
            nativeEntryId: string | null;
            requirementId: string | null;
            severity: string | null;
            description: string | null;
            evidence: readonly string[];
            disposition: unknown;
            state: string;
        }[];
        unavailable: string | null;
        retainedLaunchIds: readonly string[];
    };
    payloadHash: string;
    receiptIds: readonly string[];
    resource: PublicationResource | null;
    transportOutcome: 'not-started' | 'native-success' | 'uncertain' | null;
    observedOutcome: 'resource-matches' | 'not-observed' | 'unknown';
    activation: 'disabled' | 'owned-fixture-only' | 'created-private-local-acceptance' | 'public-personal-owner/v1';
    blocked: readonly string[];
    nextAction: string;
}

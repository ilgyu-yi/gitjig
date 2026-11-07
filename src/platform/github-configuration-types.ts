import type { CapabilityObservation } from './github-capability.js';
import type { PublicationTarget } from './github-publication.js';
export interface ConfigurationReceipt {
    route: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    status: number;
    bodyHash: string;
    bodyBytes: number;
    requestId: string | null;
}
export interface ConfigurationProfile {
    version: string;
    ruleset?: {
        name: string;
        enforcement: 'active' | 'disabled';
        include: readonly string[];
        exclude: readonly string[];
        pullRequest?: {
            approvingCount: number;
            dismissStale: boolean;
            lastPushApproval: boolean;
            codeOwner: boolean;
            threadResolution: boolean;
        } | null;
        statusChecks?: {
            contexts: readonly {
                context: string;
                integrationId?: number;
            }[];
            strict: boolean;
        } | null;
        nonFastForward: boolean;
        deletion: boolean;
        bypassUsers: readonly {
            userId: number;
            mode: 'always' | 'pull_request';
        }[];
    };
    mergeMethods?: {
        merge?: boolean;
        squash?: boolean;
        rebase?: boolean;
    };
}
export interface ConfigurationTarget extends PublicationTarget {
    visibility: 'public' | 'private';
}
export interface OwnedRulesetIdentity {
    id: number;
    nodeId: string;
}
export interface ConfigurationField {
    path: string;
    before: unknown;
    intended: unknown;
}
export type ConfigurationStepKind = 'create-ruleset' | 'update-owned-ruleset' | 'patch-merge-methods';
export interface ConfigurationStep {
    id: string;
    kind: ConfigurationStepKind;
    route: string;
    method: 'POST' | 'PUT' | 'PATCH';
    basis: unknown;
    basisHash: string;
    payload: Readonly<Record<string, unknown>>;
    payloadHash: string;
    fields: readonly ConfigurationField[];
    ownedRuleset?: OwnedRulesetIdentity;
}
export interface ConfigurationPlan {
    operationId: string;
    target: ConfigurationTarget;
    profile: ConfigurationProfile;
    profileHash: string;
    steps: readonly ConfigurationStep[];
    preserved: readonly string[];
    manual: readonly string[];
    limitations: readonly string[];
    receipts: readonly ConfigurationReceipt[];
    activation: 'disabled' | 'owned-fixture-only' | 'created-private-local-acceptance' | 'public-personal-owner/v1';
}
export interface ConfigurationPreviewInput {
    operationId: string;
    target: ConfigurationTarget;
    desired: ConfigurationProfile;
    ownedRuleset?: OwnedRulesetIdentity;
}
/** Identity projection only; native implementation retains actual private request. */
export interface PreparedConfigurationStep {
    readonly operationId: string;
    readonly stepId: string;
    readonly payloadHash: string;
    readonly credentialSessionId: string;
    readonly revisionId: string;
}
export interface ConfigurationResourceHint {
    id: number;
    nodeId: string;
}
/** Actual validated native resource support, separate from desired-state equality. */
export interface ConfigurationResourceObservation {
    version: 'configuration-resource-observation/v1';
    kind: 'ruleset';
    identity: ConfigurationResourceHint;
    identitySource: 'retained-post-hint' | 'owned-plan' | 'name-correlation';
    sourceType: 'Repository';
    source: string;
    target: 'branch';
    repository: {
        id: number;
        nodeId: string;
        fullName: string;
        visibility: string;
        ownerId: number;
    };
    supported: true;
}
export interface ConfigurationAttempt {
    operationId: string;
    stepId: string;
    handoff: 'not-started' | 'request-created';
    outcome: 'confirmed' | 'refused' | 'unknown';
    creationHint: ConfigurationResourceHint | null;
    fieldObservations: readonly {
        path: string;
        state: 'matching' | 'conflicting' | 'unknown';
        actual: unknown;
    }[];
    observed: unknown;
    resourceObservation?: ConfigurationResourceObservation;
    receipts: readonly ConfigurationReceipt[];
    reason: string;
}
export interface RetainedConfigurationStep {
    plan: ConfigurationPlan;
    stepId: string;
    creationHint?: ConfigurationResourceHint;
}
export interface ConfigurationReconciliation {
    operationId: string;
    stepId: string;
    outcome: 'confirmed' | 'unknown';
    fieldObservations: readonly {
        path: string;
        state: 'matching' | 'conflicting' | 'unknown';
        actual: unknown;
    }[];
    observed: unknown;
    creationHint: ConfigurationResourceHint | null;
    resourceObservation?: ConfigurationResourceObservation;
    receipts: readonly ConfigurationReceipt[];
    reason: string;
}
export interface ConfigurationAccountObservation {
    kind: 'configuration-account-operands';
    credentialSessionId: string;
    native: CapabilityObservation;
    writeAcceptance: 'unestablished';
    activation: 'disabled';
}

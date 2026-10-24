/** Type-only protocol for optional external qualification tooling. */
import type { NativeGitProfile } from '../effects/types.js';
import type { NativeGitClient, PreparedHttpsSend } from '../effects/native-git.js';
import type { PublicationTarget, createContextPublicationClient } from './github-publication.js';
import type { createContextConfigurationClient } from './github-configuration.js';
import type { PublicationSession } from './github-publication-session.js';
import type { CreatedAcceptanceContext, AcceptanceGitClient } from './hosted-context.js';
import type { createNativePolicyObserver } from './github-policy.js';
type Counter = 'reads' | 'writes' | 'repositoryCreates' | 'issueCreates' | 'draftCreates' | 'comments' | 'ruleCreates' | 'ruleWrites' | 'mergePatches' | 'nativeOperations' | 'nativePushes';
type Phase = 'fresh' | 'creating' | 'created' | 'unknown';
export interface CreationReceipt {
    status: number;
    bodyHash: string;
    bodyBytes: number;
    requestId: string | null;
    data: Record<string, unknown>;
}
export interface SetupJournal {
    version: 1 | 2 | 3;
    nativeOperationLimit?: 64 | 96;
    setupSteps?: Record<string, {
        state: 'prepared' | 'invoking' | 'observed' | 'unknown';
        commit: string;
        tree?: string;
        root?: string;
        expectedBase?: string;
        transport?: string;
        nodeId?: string;
        profile?: NativeGitProfile;
    }>;
    kind: 'external-acceptance-setup-only';
    manifestHash: string;
    startedAt: number;
    lastAt: number;
    lifetimeMs: number;
    phase: Phase;
    counters: Record<Counter, number>;
    sequence: number;
    identity: PublicationTarget | null;
    creation: CreationReceipt | null;
    readback: CreationReceipt | null;
    records: {
        sequence: number;
        method: string;
        route: string;
        outcome: string;
        status?: number;
        bodyHash?: string;
        bodyBytes?: number;
    }[];
}
export interface QualificationSetup {
    inspect(): SetupJournal & {
        credentialSessionId: string;
        scope: string;
    };
    create(): Promise<CreatedAcceptanceContext>;
    reopen(): Promise<CreatedAcceptanceContext>;
    close(): Promise<void>;
    openNativeGit(context: CreatedAcceptanceContext, profile: NativeGitProfile, signal?: AbortSignal): Promise<AcceptanceGitClient>;
    prepareBootstrapMain(context: CreatedAcceptanceContext, input: {
        clientProfile: NativeGitProfile;
    }): Promise<PreparedHttpsSend & {
        tree: string;
    }>;
    prepareRacePeer(context: CreatedAcceptanceContext, input: {
        clientProfile: NativeGitProfile;
        expectedBase: string;
    }): Promise<PreparedHttpsSend & {
        tree: string;
    }>;
    invokePreparedSetup(handle: PreparedHttpsSend): ReturnType<NativeGitClient['spawnPreparedHttpsForwardSend']>;
    reconcileSetupStep(context: CreatedAcceptanceContext, step: 'bootstrap-main' | 'race-peer'): Promise<Awaited<ReturnType<NativeGitClient['reconcileHttpsForward']>> & {
        transport: string;
        cleanup: 'confirmed';
    }>;
    createFixtureBranches(context: CreatedAcceptanceContext): Promise<unknown>;
    clients(context: CreatedAcceptanceContext): Readonly<{
        publication: ReturnType<typeof createContextPublicationClient>;
        configuration: ReturnType<typeof createContextConfigurationClient>;
        observePublicationCapability: PublicationSession['observePublicationCapability'];
        observeTargetPolicy: ReturnType<typeof createNativePolicyObserver>['observeTargetPolicy'];
    }>;
    negativeCapability(context: CreatedAcceptanceContext, options: {
        token: string;
    }): Readonly<{
        credentialSessionId: string;
        scope: 'read-only-negative-never-sending-fallback';
        observePublicationCapability: PublicationSession['observePublicationCapability'];
    }>;
}

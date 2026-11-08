import type { PiModelSelection } from '../pi/session.js';
export interface RuntimeProfile {
    dockerBinary: string;
    dockerContext: string;
    dockerConfigDirectory?: string;
    image: string;
    uid?: number;
    gid?: number;
    memoryMiB?: number;
    cpus?: number;
    pidsLimit?: number;
    scratchMiB?: number;
    maxOutputBytes?: number;
    defaultTimeoutMs?: number;
}
export interface CaptureProfile {
    maxEntries?: number;
    maxBytes?: number;
    timeoutMs?: number;
}
export interface ControllerOptions {
    /** Trusted explicit resource: ownership transfers after successful open to this controller. No ambient host lookup. */
    modelResource?: import('../pi/claude-host.js').OwnedClaudeHost;
    installationHome: string;
    runtimeProfile?: RuntimeProfile;
    captureProfile?: CaptureProfile;
    interactionDelegation?: {
        projectIds?: readonly string[];
        maxAssignments?: number;
    };
    capacityLimit?: number;
    completedResources?: import('./completed-resources.js').CompletedResourcePolicy;
    /** Original host route captured before application HOME projection. */
    sourceGitRoute?: import('../effects/source-policy.js').SourceGitRoute;
    effectsProfile?: import('./effect-types.js').EffectsProfile;
    effectDelegations?: readonly import('./effect-types.js').EffectDelegationConfig[];
    mergeDelegations?: readonly import('./merge-types.js').MergeDelegationConfig[];
}
/** Trusted application startup composition; never read from project/JSON callbacks. */
export interface ControllerOpening {
    managementOnly?: boolean;
    prepareStartup?: (context: Readonly<{
        installationHome: string;
        projectRoots: readonly string[];
    }>) => Promise<Readonly<{
        runtimeProfile?: RuntimeProfile;
    }>>;
}
export interface Project {
    id: string;
    sourceRoot: string;
    captureProfile: CaptureProfile;
}
export interface LocalCheckOptions {
    projectId: string;
    command: string;
    cwd?: 'work' | 'scratch';
    continuationCheckpoint?: string;
    signal?: AbortSignal;
}
export type ConversationOptions = {
    projectId: string;
    message: string;
    continuationCheckpoint?: string;
    signal?: AbortSignal;
} & ({
    model: PiModelSelection;
    applicationModelBaseline?: never;
    applicationModel?: never;
    sessionPreferences?: never;
} | {
    applicationModelBaseline: import('./application-model.js').WorkModelBaseline;
    applicationModel?: never;
    model?: never;
    sessionPreferences?: import('../pi/session-preferences.js').SessionQueuePreferences;
} | {
    applicationModel: import('./application-model.js').ApplicationModelOperation;
    applicationModelBaseline?: never;
    model?: never;
    sessionPreferences?: import('../pi/session-preferences.js').SessionQueuePreferences;
});
export type InvestigationExecutionOptions = Pick<ConversationOptions, 'projectId' | 'message' | 'continuationCheckpoint' | 'signal'> & {
    model: PiModelSelection;
};
export interface ObservationResult {
    workId: string;
    runId: string;
    kind: 'command-observation' | 'investigation';
    status: 'succeeded' | 'failed' | 'unavailable' | 'cancelled' | 'delivered';
    exitCode: number | null;
    captureRef: string | null;
    actualCwd: string;
    scratchInput: 'mutable-or-unknown';
    cleanup: string;
    limitations: string[];
    stdout: string;
    stderr: string;
    historyRef?: string;
}
export interface WorkView {
    workId: string;
    projectId: string | null;
    state: string;
    epoch: number;
    lineageRoot: string;
    source: unknown;
    interpretation: unknown;
    allowance: {
        limit: number;
        consumed: number;
        reserved: number;
    };
    obligations: unknown[];
    runs: unknown[];
    currentResult: ObservationResult | null;
}
export class ControllerError extends Error {
    constructor(readonly code: string, message: string, readonly recovery: string, readonly workId?: string, readonly runId?: string) {
        super(message);
        this.name = 'ControllerError';
    }
}
export class ManagedReviewChanged extends ControllerError {
    constructor(workId: string, readonly reason: 'runtime' | 'draft' | 'allowance') {
        const subject = {runtime: 'Active runtime', draft: 'Original draft', allowance: 'Shared allowances'}[reason];
        super('MANAGED_REVIEW_CHANGED', `${subject} changed before resume or replan`, 'Reopen the original work review before confirming again', workId);
    }
}
export class InterruptedInputBindingChanged extends ControllerError {
    constructor(readonly reason: 'model' | 'runtime' | 'protection', readonly inputId: string, workId: string, runId: string) {
        const subject = { model: 'Original model', runtime: 'Original runtime', protection: 'Project protection' }[reason];
        super('INTERRUPTED_INPUT_BINDING_CHANGED', `${subject} binding changed`,
            'Original request retained. Inspect its recorded attempt in /work or reopen the request from /inputs.', workId, runId);
    }
}
/** The owner input was committed before a subsequent routing operation failed. */
export class InputRoutingUnavailable extends ControllerError {
    constructor(readonly inputId: string, readonly conversationId: string, cause: unknown) {
        super('INPUT_ROUTING_UNAVAILABLE', 'Request recorded · delivery needs review',
            'Review the accepted request in /inputs before sending a replacement.\n' + String(cause));
    }
}
export class ManagedConversationOperationActive extends ControllerError {
    constructor(workId: string | undefined, readonly isOriginalActive: () => boolean) {
        super('MANAGED_CONVERSATION_OPERATION_ACTIVE', 'Managed conversation operation active',
            'Wait for the original managed task to settle before retrying this operation', workId);
    }
}
export type LifecycleEffectHold = Readonly<{
    operationId: string;
    workId: string;
    targetId: string;
    grantId: string;
    phase: string | null;
}>;

export class ConversationLifecycleHeld extends ControllerError {
    readonly reasons: readonly string[];

    constructor(reasons: readonly string[], readonly effect?: LifecycleEffectHold) {
        super('LIFECYCLE_HELD', 'LIFECYCLE_HELD: ' + reasons.join(';'),
            'Inspect the original conversation and retained work before retrying the lifecycle action');
        this.reasons = Object.freeze([...reasons]);
    }
}

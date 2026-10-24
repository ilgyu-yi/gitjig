import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { PiModelSelection, PiSession } from '../pi/session.js';
export interface NativeIdentity {
    conversationId: string;
    workId: string;
    runId: string;
    launchId: string | null;
    generation: number;
    directionRevision: number;
    initialInputId: string;
}
export interface NativeRegistration {
    identity: NativeIdentity;
    session: AgentSession;
    sessionManager: SessionManager;
    executeUserBash: PiSession['executeUserBash'];
}
export interface NativeLifecycle {
    ready(registration: NativeRegistration): void;
    settling(identity: NativeIdentity): void;
    released(identity: NativeIdentity): void;
}
export type ConversationResourceState = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SETTLING' | 'WAITING' | 'UNKNOWN' | 'ARCHIVED';
export interface ConversationView {
    conversationId: string;
    label: string;
    userLabel?: string;
    role?: string;
    projectId: string | null;
    generation: number;
    state: ConversationResourceState;
    historyRef: string | null;
    nativeSessionId: string | null;
    workId: string | null;
    parentId: string | null;
    relationRevision: number;
    directionRevision: number;
    draft: {
        revision: number;
        text: string;
    };
    scroll: {
        entryId: string | null;
        offset: number;
        followEnd: boolean;
    };
    humanLastUsed: number;
    inputNeeded: boolean;
    archived: boolean;
    deleted: boolean;
    lifecycle?: {
        deleted?: {
            conversationId: string;
            generation: number;
            actionId: string;
            uid: number | null;
            at: number;
        };
        lastAction?: {
            kind: string;
            actionId: string;
            at: number;
        };
    };
    coordinationDelivery?: {
        cursor: number;
        visited: number;
        morePending: boolean;
        queuedCount: number;
        byteLimitHit: boolean;
    };
}
export interface RelationView {
    childId: string;
    parentId: string | null;
    revision: number;
}
export interface DraftReceipt {
    conversationId: string;
    revision: number;
    text: string;
}
export interface InputOptions {
    conversationId: string;
    expectedGeneration: number;
    text: string;
    attachments?: readonly {
        path: string;
        sha256: string;
        mimeType: string;
    }[];
    draftRevision?: number;
    mode: 'idle' | 'steer' | 'follow-up';
}
export interface InputReceipt {
    inputId: string;
    conversationId: string;
    generation: number;
    sourceId: string;
    state: string;
    directionRevision: number;
}
export interface ApplicationConversationOperation {
    version: 1;
    choiceRevision: number;
}
export type ConversationModelRequest = {
    model: PiModelSelection;
    applicationConversation?: never;
} | {
    applicationConversation: ApplicationConversationOperation;
    model?: never;
};
export type ConversationModelMode = {
    kind: 'application';
    version: 1;
    choiceRevision: number;
} | {
    kind: 'explicit';
    provider: string;
    modelId: string;
};
export type RunConversationOptions = ConversationModelRequest & {
    conversationId: string;
    signal?: AbortSignal;
    initialInputId?: string;
    manual?: {
        kind: 'compact';
        instructions?: string;
    } | {
        kind: 'navigate-tree';
        entryId: string;
    };
    userBash?: {
        command: string;
        excludeFromContext: boolean;
    };
};
/** Transient admitted recipe; never persisted or accepted as a public request. */
export type ResolvedConversationOptions = Omit<RunConversationOptions, 'model' | 'applicationConversation'> & {
    model: PiModelSelection;
    modelMode: ConversationModelMode;
    assertModelCurrent(): void;
    supersedeWait?(inputId: string, newRunId: string): void;
};
export interface ConversationTurnResult {
    /** Actual runner error for a failed conversation or manual action; never a passing result. */
    failure?: string;
    conversationId: string;
    workId: string;
    runId: string;
    status: 'delivered' | 'interrupted' | 'cancelled' | 'waiting' | 'unavailable';
    cleanup: string;
    nativeResult?: unknown;
    answer?: import('./conversation-results.js').AnswerObservation;
    coordinatorReport?: import('./conversation-results.js').CoordinatorReportObservation;
}
export interface InteractionEvent {
    conversationId: string;
    generation: number;
    type: string;
    data?: unknown;
}
export interface CapacityRequest {
    workId: string;
    runId: string;
    epoch: number;
    kind: 'role' | 'check' | 'conversation' | 'local-check';
    signal?: AbortSignal;
}
export interface CapacityLease {
    id: string;
    runId: string;
    release(receipt: {
        cleanup: string;
        settled: boolean;
    }): void;
}

export type GoalState = 'READY' | 'ACTIVE' | 'REVIEWING' | 'PAUSED' | 'WAITING_INPUT' | 'WAITING_DEPENDENCY' | 'BLOCKED' | 'BUDGET_EXHAUSTED' | 'INTERRUPTED' | 'COMPLETED' | 'CANCELLED';
export interface GoalProgress {
    disposition: 'continue' | 'need-owner' | 'wait-external' | 'propose-completion';
    plan: string;
    nextAction: string;
    reason: string;
    resultIds: string[];
}
export interface GoalVerdict {
    verdict: 'pass' | 'reject';
    reason: string;
    findings: {
        criterion: number;
        description: string;
    }[];
    resolvedFindingIds: string[];
}
export interface GoalFinding {
    id: string;
    attemptId: string;
    criterion: number;
    description: string;
    state: 'pending' | 'resolved' | 'owner-superseded';
    resolution?: {
        attemptId?: string;
        reason: string;
    };
}
export interface GoalView {
    goalId: string;
    conversationId: string;
    projectId: string | null;
    revision: number;
    state: GoalState;
    objective: string;
    criteria: string[];
    turnLimit: number;
    startedAttempts: number;
    nextAction: string;
    reason: string;
    plan: string;
    findings: GoalFinding[];
    pendingInputId: string | null;
    reviewConversationId: string | null;
    attempts: {
        attemptId: string;
        ordinal: number;
        kind: 'author' | 'reviewer';
        conversationId: string;
        inputId: string;
        runId: string;
        state: string;
        data: unknown;
    }[];
    events: {
        eventId: string;
        kind: string;
        data: unknown;
    }[];
    acceptedReview?: {
        attemptId: string;
        runId: string;
        proposalHash: string;
    };
}
export type GoalSummary = Omit<GoalView, 'attempts' | 'events'>;

import type { Role } from '../workflow/types.js';
/** Stage selection shared by execution and read-only prerequisite inspection. */
export function nextChangeStage(row: {
    phase: string;
    base: unknown;
    plan: unknown;
}, resume: string | null): string | undefined {
    return !row.plan && row.base ? 'plan' : resume ?? ({
        BASE_CAPTURED: 'plan',
        PLANNING: 'plan',
        PLAN_READY: 'implement',
        CANDIDATE_CAPTURED: 'checks',
        CHECKED: 'review',
        REVIEWING: 'review',
        RESOLVING: 'resolve',
        REPAIR_REQUIRED: 'repair',
        NIT_AUTHORIZED: 'confirm',
    } as Record<string, string>)[row.phase];
}
/** Mandatory model producers within a healthy stage; checks and capture use no model. */
export function changeStageRoles(stage: string | undefined): readonly Role[] {
    return ({
        plan: ['planner', 'challenger', 'adjudicator'],
        implement: ['implementer'],
        repair: ['repairer'],
        review: ['reviewer'],
        resolve: ['adjudicator'],
        confirm: ['confirmer'],
        'source-fit': ['adjudicator'],
    } as Record<string, Role[]>)[stage ?? ''] ?? [];
}

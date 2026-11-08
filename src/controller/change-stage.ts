import type { Role } from '../workflow/types.js';
const resolutionRoles = new Set<Role>(['challenger', 'adjudicator', 'reviewer', 'confirmer']);
const candidatePreparationRoles: Readonly<Record<string, Role>> = Object.freeze({
    planning: 'planner',
    'planning-challenge': 'challenger',
    'planning-adjudication': 'adjudicator',
    implementation: 'implementer',
    'substantive-repair': 'repairer',
});
/** Only an actual planning/authoring receiver may treat absent plan paths as future outputs. */
export function rolePreparesCandidate(role: Role | undefined, stage: unknown): boolean {
    const assigned = typeof stage === 'string' ? candidatePreparationRoles[stage] : undefined;
    return assigned !== undefined && assigned === role;
}
export function roleUsesResolutionAllowance(role: Role | null): boolean {
    return role !== null && resolutionRoles.has(role);
}
/** Stage selection shared by execution and read-only prerequisite inspection. */
export function nextChangeStage(row: {
    phase: string;
    base: unknown;
    plan: unknown;
}, resume: string | null, retainedCandidateStage?: 'checks' | 'held'): string | undefined {
    return !row.plan && row.base ? 'plan' : resume ?? ({
        BASE_CAPTURED: 'plan',
        PLANNING: 'plan',
        PLAN_READY: retainedCandidateStage ?? 'implement',
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
        'raw-assessment': ['adjudicator'],
    } as Record<string, Role[]>)[stage ?? ''] ?? [];
}

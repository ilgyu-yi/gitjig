import type { Controller } from '../controller/controller.js';
import { inspectDepletedContinuationAllowance } from './work-allowance-presentation.js';

export function workOriginLifecycle(origin: ReturnType<Controller['inspectConversation']> | undefined) {
    return origin && [origin.conversationId, origin.generation, origin.projectId, origin.archived, origin.deleted, origin.lifecycle?.lastAction?.actionId];
}

/** Observe the original work for navigation. The resume command owns confirmation and admission. */
export function inspectWorkResumeEntry(controller: Controller, work: ReturnType<Controller['inspectWorkRecovery']>, canExecute: boolean) {
    let origin: ReturnType<Controller['inspectConversation']> | undefined;
    if (work.conversationId) {
        try { origin = controller.inspectConversation(work.conversationId); }
        catch { /* Original evidence stays readable when its conversation is unavailable. */ }
    }
    const originOpen = !!origin && !origin.archived && !origin.deleted;
    const originBlocked = !!work.conversationId && !originOpen;
    const originHeld = !!work.sourceConversationId && originBlocked;
    const live = work.governed && controller.hasLiveChangeOperation(work.workId);
    const eligible = canExecute && work.governed && work.recoveryHold?.kind !== 'unavailable' &&
        !work.recoveryHold?.workflowCriteriaBlocksResume &&
        (['ACTIVE', 'BLOCKED', 'INTERRUPTED', 'CANCELLED'].includes(work.state) ||
            work.state === 'DELIVERED' && work.heldDirectionCount > 0);
    const allowanceHold = eligible && !live ? inspectDepletedContinuationAllowance(controller, work.workId, work) : undefined;
    const activationGuide = !live && work.activationPending && ['ACTIVE', 'INTERRUPTED', 'CANCELLED'].includes(work.state);
    const runtime = activationGuide ? controller.options.runtimeProfile : undefined;
    const resumeAvailable = eligible && !live && !originHeld && !allowanceHold && (!activationGuide || !!runtime);
    return { origin, originOpen, originBlocked, originHeld, live, allowanceHold, activationGuide, runtime, resumeAvailable };
}

import { modelContextPresentation } from './model-context-presentation.js';
import { isDeepStrictEqual } from 'node:util';
import { planningFailurePresentation, producerFailurePresentation, providerFailurePresentation, roleRequestLimitPresentation, rolePresentationLabel } from './planning-failure-presentation.js';
import type { ChangeView } from '../controller/change-types.js';
import type { Controller } from '../controller/controller.js';
import { isWorkSettlementUnconfirmed } from '../controller/work-recovery.js';
import type { GoalSummary } from '../controller/goal-types.js';
import type { ConversationView, NativeRegistration } from '../controller/interaction-types.js';
import { providerActivityLabel } from './conversation-activity.js';
import { uiText, type UiLocale, type MessageId } from './i18n.js';
import { stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui';
import type { ConversationWait } from '../controller/conversation-progress.js';

export interface TaskPresentationInput {
    view: ConversationView;
    roster: readonly ConversationView[];
    changeActivity?: ReturnType<Controller['inspectChangeActivity']>;
    goal?: GoalSummary | null;
    locale: UiLocale;
    wait?: ConversationWait | undefined;
    waitActivities?: readonly NonNullable<ReturnType<Controller['inspectChangeActivity']>>[];
    activeChildWorks?: ReadonlySet<string>;
    managedPending?: boolean;
    standaloneManagedWork?: string | undefined;
    managedPreparation?: ReturnType<Controller['inspectConversationChangePreparation']>;
    showResultShortcut?: boolean;
    navigatorRequestLabel?: string | undefined;
    roleNative?: ((conversationId: string) => Pick<NativeRegistration, 'identity' | 'providerActivity'> | null) | undefined;
}
export interface TaskPresentation {
    resourceLabel: string;
    preparationStatus?: string;
    /** Context for an idle composer only; never execution eligibility. */
    idleStatus?: string;
    /** Current conversation and work, without related-conversation fallback. */
    idleOwnStatus?: string;
    lines: string[];
    navigatorSummary: string;
    attention: boolean;
    waitingStatus?: string;
    waitAttention?: boolean;
}
export const isActiveTaskConversation = (view: ConversationView) => ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state);
const plain = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');
const recordedStages: Readonly<Record<string, Extract<MessageId, `task.stage.${string}`>>> = {
    BASE_CAPTURING: 'task.stage.capture', BASE_CAPTURED: 'task.stage.captured', PLANNING: 'task.stage.planning',
    PLAN_READY: 'task.stage.planned', CANDIDATE_CAPTURED: 'task.stage.candidate', CHECKED: 'task.stage.checked',
    REVIEWING: 'task.stage.reviewing', RESOLVING: 'task.stage.resolving', NIT_AUTHORIZED: 'task.stage.correction', NIT_CHECKED: 'task.stage.checked',
};
function recordedStopLabel(phase: string, locale: UiLocale): string | undefined {
    if (phase === 'BLOCKED')
        return uiText(locale, 'task.change.blocked');
    if (phase === 'REPAIR_REQUIRED')
        return uiText(locale, 'task.change.repairNeeded');
}
function inspectStoppedResult(status: string, locale: UiLocale): string {
    return uiText(locale, 'task.change.inspectStoppedResult', { status });
}
function changeLabel(activity: NonNullable<TaskPresentationInput['changeActivity']>, locale: UiLocale,
    { contextVisible, managedPending, showResultShortcut }: { contextVisible: boolean; managedPending: boolean; showResultShortcut: boolean }): string {
    if (activity.activationPending)
        return uiText(locale, 'task.change.activation');
    if (isWorkSettlementUnconfirmed(activity.state) || ['INTERRUPTED', 'CANCELLED'].includes(activity.state))
        return uiText(locale, 'task.change.attention');
    const context = contextVisible && activity.recordedPhase === 'BLOCKED'
        ? modelContextPresentation(activity.recordedModelContextFailure, activity.workId, locale)
            ?? producerFailurePresentation({ workId: activity.workId, roleRequestLimit: activity.recordedRoleRequestLimit,
                providerFailure: activity.recordedProviderFailure, planningFailure: activity.recordedPlanningFailure }, locale) : undefined;
    if (context)
        return context.summary;
    if (activity.state === 'BLOCKED')
        return uiText(locale, 'task.change.attention');
    if (activity.recordedPhase === 'REVIEW_READY')
        return uiText(locale, managedPending ? 'task.change.finalizing' : 'task.change.reviewRecorded');
    if (activity.state === 'DELIVERED')
        return uiText(locale, 'task.change.resultRecorded');
    const stopped = recordedStopLabel(activity.recordedPhase, locale);
    if (stopped)
        return showResultShortcut ? inspectStoppedResult(stopped, locale) : stopped;
    const stageKey = recordedStages[activity.recordedPhase];
    if (stageKey)
        return uiText(locale, 'task.change.stage', { stage: uiText(locale, stageKey) });
    return uiText(locale, 'task.change.recorded');
}
function goalLabel(goal: GoalSummary, locale: UiLocale): string {
    return uiText(locale, `task.goal.${goal.state}`);
}

/** Pure display over supplied observations. Relationships are not dependencies,
 * recorded phases are not current standing, and no label grants admission. */
export function taskPresentation({ view, roster, changeActivity, goal, locale, wait, waitActivities, activeChildWorks,
    managedPending = false, standaloneManagedWork, managedPreparation, showResultShortcut = false, navigatorRequestLabel, roleNative }: TaskPresentationInput): TaskPresentation {
    const lines: string[] = [];
    const displayedWork = view.workId ?? standaloneManagedWork;
    const activity = changeActivity?.workId === displayedWork ? changeActivity : undefined;
    const ownGoal = goal?.conversationId === view.conversationId ? goal : undefined;
    const others = roster.filter(other => other.conversationId !== view.conversationId && !other.archived && !other.deleted);
    const sameWorkRole = (other: ConversationView) => displayedWork != null && other.workId === displayedWork && !!other.role;
    const roles = others.filter(other => isActiveTaskConversation(other) && sameWorkRole(other));
    const related = new Set(others.filter(other => other.parentId === view.conversationId && !sameWorkRole(other) &&
        (isActiveTaskConversation(other) || (other.state === 'IDLE' && !other.role && other.workId !== null &&
            other.workId !== view.workId && activeChildWorks?.has(other.workId)))).map(other => other.workId ?? other.conversationId));
    const unknownRelated = others.filter(other => other.state === 'UNKNOWN' && (sameWorkRole(other) || other.parentId === view.conversationId));
    const roleSummary = roles.length ? uiText(locale, 'task.change.activeRoles', { roles: [...new Set(roles.map(other => {
        const role = rolePresentationLabel(other, locale) ?? plain(other.role ?? '');
        if (other.state === 'QUEUED') return uiText(locale, 'task.roleQueued', { role });
        if (other.state === 'SETTLING') return uiText(locale, 'task.roleSettling', { role });
        const native = roleNative?.(other.conversationId), identity = native?.identity;
        const provider = identity?.launchId && identity.conversationId === other.conversationId && identity.workId === other.workId &&
            identity.generation === other.generation && identity.directionRevision === other.directionRevision
            ? providerActivityLabel(locale, native?.providerActivity) : undefined;
        return provider ? `${role} (${provider})` : role;
    }))].join(' · ') }) : undefined;
    const relatedSummary = related.size ? uiText(locale, 'task.relatedActive', { count: related.size }) : undefined;
    const recordedHold = activity && ['BLOCKED', 'REPAIR_REQUIRED'].includes(activity.recordedPhase);
    // A live role can be repairing a checkpoint that still records the prior hold.
    const roleActive = roles.length > 0 || !!view.role && isActiveTaskConversation(view);
    const startingCapture = managedPreparation === 'capture' && activity?.state === 'ACTIVE' && activity.recordedPhase === 'BASE_CAPTURING';
    const preparationStatus = (managedPreparation === 'rules' || startingCapture) && view.state === 'IDLE' && !view.inputNeeded && !view.archived && !view.deleted && !roleActive
        ? uiText(locale, `task.preparing.${managedPreparation}`) : undefined;
    const liveInitialCapture = startingCapture && !!preparationStatus;
    const eligibleLiveDisplay = activity?.state === 'ACTIVE' && !activity.activationPending &&
        !view.inputNeeded && !view.archived && !view.deleted && view.state !== 'UNKNOWN';
    const check = !view.role && view.state === 'IDLE' && eligibleLiveDisplay && !roleActive ? activity.activeCheck : undefined;
    const checkSummary = check ? uiText(locale, `task.check.${check.phase}`, { id: truncateToWidth(plain(check.id), 40, '…') }) : undefined;
    const resuming = recordedHold && eligibleLiveDisplay && (roleActive || !!checkSummary);
    const changeAttention = activity && (!liveInitialCapture && activity.activationPending || isWorkSettlementUnconfirmed(activity.state) ||
        ['INTERRUPTED', 'CANCELLED', 'BLOCKED'].includes(activity.state) || (recordedHold && !resuming));
    const changeSummary = activity && !liveInitialCapture && !resuming && !checkSummary && (!view.role || changeAttention)
        ? changeLabel(activity, locale, {
            contextVisible: view.state === 'IDLE',
            managedPending,
            showResultShortcut: showResultShortcut && view.state === 'IDLE' && !view.role && !view.inputNeeded && !managedPending,
        }) : undefined;
    const resourceLabel = uiText(locale, checkSummary ? 'task.resource.managed' : `task.resource.${view.state}`);
    const goalSummary = ownGoal ? goalLabel(ownGoal, locale) : undefined;
    const relatedAttention = unknownRelated.length ? uiText(locale, 'task.relatedAttention', { count: unknownRelated.length }) : undefined;
    if (relatedAttention) lines.push(relatedAttention);
    if (roleSummary) lines.push(roleSummary);
    if (checkSummary) lines.push(checkSummary);
    if (changeSummary) lines.push(changeSummary);
    if (goalSummary) {
        lines.push(goalSummary);
        const {state, startedAttempts: used, turnLimit: limit, nextAction} = ownGoal!;
        lines.push(state === 'BLOCKED' || state === 'BUDGET_EXHAUSTED'
            ? uiText(locale, 'task.goal.inspect', {used, limit})
            : uiText(locale, 'task.goal.next', {used, limit, next: plain(nextAction)}));
    }
    if (relatedSummary) lines.push(relatedSummary);

    const currentWait = view.state === 'WAITING' && !view.archived && !view.deleted && wait?.conversationId === view.conversationId &&
        wait.workId === view.workId && wait.generation === view.generation && wait.directionRevision === view.directionRevision ? wait : undefined;
    const awaited: { label: string; status: string; attention: boolean }[] = [];
    for (const item of currentWait?.targets ?? []) {
        const target = roster.find(other => other.conversationId === item.conversationId && other.workId === item.workId && !other.archived && !other.deleted);
        const label = '#' + item.conversationId.slice(0, 8) + (target ? ' ' + truncateToWidth(plain(target.userLabel ?? target.label), 20, '…') : '');
        if (!target) { awaited.push({label, status: uiText(locale, 'task.awaitedUnknown'), attention: false}); continue; }
        // Reuse current task/role presentation once, without a wait projection or
        // unrelated relationships. This does not walk a dependency graph.
        const summary = taskPresentation({view: target, roster: roster.filter(other => other.conversationId === target.conversationId ||
            !!item.workId && other.workId === item.workId && !!other.role),
            changeActivity: waitActivities?.find(activity => activity.workId === item.workId), locale, roleNative});
        const outcome = item.state === 'UNAVAILABLE' ? 'task.awaitedUnavailable' : item.state === 'CANCELLED' ? 'task.awaitedCancelled' : item.state === 'RECOVERY_READY' ? 'task.awaitedRecovery' : undefined;
        const physical = ['UNKNOWN', 'SETTLING'].includes(target.state);
        awaited.push({label, status: physical ? summary.resourceLabel : target.inputNeeded ? summary.navigatorSummary : outcome ? uiText(locale, outcome) :
            item.state === 'QUEUED' ? uiText(locale, 'task.awaitedQueued') : summary.idleStatus ?? summary.navigatorSummary,
            attention: summary.attention || !!outcome});
    }
    for (const item of awaited) lines.push(uiText(locale, 'task.awaitedTarget', {target: item.label, status: item.status}));
    if (currentWait?.omitted) lines.push(uiText(locale, 'task.awaitedMore', {count: currentWait.omitted}));

    const goalAttention = ownGoal && ['WAITING_INPUT', 'BLOCKED', 'BUDGET_EXHAUSTED', 'INTERRUPTED'].includes(ownGoal.state);
    const waitAttention = !!currentWait?.settlementUnconfirmed || awaited.some(item => item.attention) || !!goalAttention || !!changeAttention || view.inputNeeded;
    const attention = view.state === 'UNKNOWN' || view.inputNeeded || !!goalAttention || !!changeAttention || !!relatedAttention || waitAttention;
    const waitingStatus = view.state !== 'WAITING' ? undefined : currentWait?.settlementUnconfirmed ? uiText(locale, 'task.waitSettlementUnconfirmed') :
        changeAttention ? changeSummary! : goalAttention ? goalSummary! : awaited.length ?
        uiText(locale, 'task.awaiting', {targets: awaited.map(item => item.label).join(' · ')}) +
            (awaited.length === 1 ? ' · ' + awaited[0]!.status : '') +
            (currentWait?.omitted ? ' · ' + uiText(locale, 'task.awaitedMore', {count: currentWait.omitted}) : '') : uiText(locale, 'activity.waiting');
    // Keep physical/resource state first. A completed goal or old review-ready
    // record cannot replace unknown cleanup, a live response or archived state.
    const continuingGoal = ownGoal && !['COMPLETED', 'CANCELLED'].includes(ownGoal.state) ? goalSummary : undefined;
    const currentContext = changeAttention ? changeSummary : goalAttention ? goalSummary :
        roleSummary ?? checkSummary ?? preparationStatus ?? continuingGoal ?? (awaited.length ? waitingStatus : undefined);
    const recordedContext = changeSummary ?? goalSummary;
    const context = currentWait?.settlementUnconfirmed ? waitingStatus : relatedAttention ?? currentContext ?? relatedSummary ?? recordedContext;
    const idle = view.state === 'IDLE' && !view.archived && !view.deleted;
    const idleStatus = idle ? context : undefined;
    const idleOwnStatus = idle ? currentContext ?? recordedContext : undefined;
    const activeResponse = view.state === 'QUEUED' || view.state === 'RUNNING';
    const navigatorResource = !view.archived && !view.deleted && !view.inputNeeded && !checkSummary &&
        (activeResponse || view.state === 'IDLE' && !attention)
        ? navigatorRequestLabel ?? preparationStatus ?? resourceLabel : resourceLabel;
    return {
        resourceLabel,
        ...(preparationStatus ? { preparationStatus } : {}),
        ...(idleStatus ? { idleStatus } : {}),
        ...(idleOwnStatus ? { idleOwnStatus } : {}),
        lines,
        navigatorSummary: [navigatorResource, ...(view.inputNeeded ? [uiText(locale, 'pane.inputNeeded')] : []), ...(context && context !== navigatorResource ? [context] : [])].join(' · '),
        attention,
        ...(waitingStatus === undefined ? {} : {waitAttention, waitingStatus}),
    };
}

/** Re-read current facts once at settlement; never let an older outcome claim a newer state. */
export function managedChangeCompletionNotice(prior: Pick<ChangeView, 'workId' | 'epoch' | 'phase' | 'planVersion' | 'planningFailure' | 'providerFailure' | 'roleRequestLimit'>, current: ChangeView,
    activity: TaskPresentationInput['changeActivity'], resource: ConversationView, locale: UiLocale, standaloneManagedWork?: string): string | undefined {
    if (prior.workId !== current.workId || prior.epoch !== current.epoch || prior.phase !== current.phase ||
        !activity || activity.workId !== current.workId || activity.recordedPhase !== current.phase ||
        (resource.workId ?? standaloneManagedWork) !== current.workId || resource.state !== 'IDLE' || resource.inputNeeded || activity.activationPending ||
        current.ownerActivation === 'pending' || !['ACTIVE', 'DELIVERED'].includes(activity.state))
        return undefined;
    const context = modelContextPresentation(current.modelContextFailure, current.workId, locale);
    if (context) return context.summary;
    if (current.roleRequestLimit) {
        if (JSON.stringify(prior.roleRequestLimit) !== JSON.stringify(current.roleRequestLimit) ||
            JSON.stringify(activity.recordedRoleRequestLimit) !== JSON.stringify(current.roleRequestLimit)) return undefined;
        return roleRequestLimitPresentation(current.roleRequestLimit, current.workId, locale)?.summary;
    }
    if (current.providerFailure) {
        if (JSON.stringify(prior.providerFailure) !== JSON.stringify(current.providerFailure) ||
            JSON.stringify(activity.recordedProviderFailure) !== JSON.stringify(current.providerFailure)) return undefined;
        return providerFailurePresentation(current.providerFailure.usageLimit, current.workId, locale)?.summary;
    }
    if (current.planningFailure) {
        if (!isDeepStrictEqual(prior.planningFailure, current.planningFailure) ||
            !isDeepStrictEqual(activity.recordedPlanningFailure, current.planningFailure))
            return undefined;
        return planningFailurePresentation(current.planningFailure, current.workId, locale)?.summary;
    }
    if (current.phase === 'PLAN_READY' && current.blocked.length === 0)
        return current.planVersion && current.planVersion === prior.planVersion ? uiText(locale, 'task.change.planAccepted') : undefined;
    return current.reviewReady ? uiText(locale, 'task.change.reviewRecorded') :
        inspectStoppedResult(recordedStopLabel(current.phase, locale) ?? uiText(locale, 'task.change.stopped'), locale);
}

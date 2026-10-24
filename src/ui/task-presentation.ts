import type { Controller } from '../controller/controller.js';
import type { GoalSummary } from '../controller/goal-types.js';
import type { ConversationView } from '../controller/interaction-types.js';
import { uiText, type UiLocale, type MessageId } from './i18n.js';
import { stripTerminalSequences } from '@earendil-works/pi-tui';

export interface TaskPresentationInput {
    view: ConversationView;
    roster: readonly ConversationView[];
    changeActivity?: ReturnType<Controller['inspectChangeActivity']>;
    goal?: GoalSummary | null;
    locale: UiLocale;
}
export interface TaskPresentation {
    resourceLabel: string;
    /** Context for an idle composer only; never execution eligibility. */
    idleStatus?: string;
    lines: string[];
    navigatorSummary: string;
    attention: boolean;
}
const active = (view: ConversationView) => ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state);
const plain = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');
const recordedStages: Readonly<Record<string, Extract<MessageId, `task.stage.${string}`>>> = {
    BASE_CAPTURING: 'task.stage.capture', BASE_CAPTURED: 'task.stage.captured', PLANNING: 'task.stage.planning',
    PLAN_READY: 'task.stage.planned', CANDIDATE_CAPTURED: 'task.stage.candidate', CHECKED: 'task.stage.checked',
    REVIEWING: 'task.stage.reviewing', RESOLVING: 'task.stage.resolving', NIT_AUTHORIZED: 'task.stage.correction', NIT_CHECKED: 'task.stage.checked',
};
function roleLabel(role: string, locale: UiLocale): string {
    switch (role) {
        case 'planner': return uiText(locale, 'task.role.planner');
        case 'challenger': return uiText(locale, 'task.role.challenger');
        case 'implementer': return uiText(locale, 'task.role.implementer');
        case 'repairer': return uiText(locale, 'task.role.repairer');
        case 'reviewer': return uiText(locale, 'task.role.reviewer');
        case 'adjudicator': return uiText(locale, 'task.role.adjudicator');
        case 'confirmer': return uiText(locale, 'task.role.confirmer');
        default: return plain(role);
    }
}
function changeLabel(activity: NonNullable<TaskPresentationInput['changeActivity']>, locale: UiLocale): string {
    if (activity.activationPending)
        return uiText(locale, 'task.change.activation');
    if (['UNKNOWN', 'INTERRUPTED', 'CANCELLED', 'BLOCKED'].includes(activity.state))
        return uiText(locale, 'task.change.attention');
    if (activity.recordedPhase === 'REVIEW_READY')
        return uiText(locale, 'task.change.reviewRecorded');
    if (activity.state === 'DELIVERED')
        return uiText(locale, 'task.change.resultRecorded');
    if (['BLOCKED', 'REPAIR_REQUIRED'].includes(activity.recordedPhase))
        return uiText(locale, 'task.change.stageAttention');
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
export function taskPresentation({ view, roster, changeActivity, goal, locale }: TaskPresentationInput): TaskPresentation {
    const resourceLabel = uiText(locale, `task.resource.${view.state}`);
    const lines: string[] = [];
    const activity = view.workId !== null && changeActivity?.workId === view.workId ? changeActivity : undefined;
    const ownGoal = goal?.conversationId === view.conversationId ? goal : undefined;
    const others = roster.filter(other => other.conversationId !== view.conversationId && !other.archived && !other.deleted);
    const sameWorkRole = (other: ConversationView) => view.workId !== null && other.workId === view.workId && !!other.role;
    const roles = others.filter(other => active(other) && sameWorkRole(other));
    const related = others.filter(other => active(other) && other.parentId === view.conversationId && !sameWorkRole(other));
    const unknownRelated = others.filter(other => other.state === 'UNKNOWN' && (sameWorkRole(other) || other.parentId === view.conversationId));
    const roleSummary = roles.length ? uiText(locale, 'task.change.activeRoles', { roles: [...new Set(roles.map(other => {
        const role = roleLabel(other.role!, locale);
        return other.state === 'QUEUED' ? uiText(locale, 'task.roleQueued', { role }) : other.state === 'SETTLING' ? uiText(locale, 'task.roleSettling', { role }) : role;
    }))].join(' · ') }) : undefined;
    const relatedSummary = related.length ? uiText(locale, 'task.relatedActive', { count: related.length }) : undefined;
    const changeSummary = activity ? changeLabel(activity, locale) : undefined;
    const goalSummary = ownGoal ? goalLabel(ownGoal, locale) : undefined;
    const relatedAttention = unknownRelated.length ? uiText(locale, 'task.relatedAttention', { count: unknownRelated.length }) : undefined;
    if (relatedAttention) lines.push(relatedAttention);
    if (roleSummary) lines.push(roleSummary);
    if (changeSummary) lines.push(changeSummary);
    if (goalSummary) {
        lines.push(goalSummary);
        lines.push(uiText(locale, 'task.goal.next', { used: ownGoal!.startedAttempts, limit: ownGoal!.turnLimit, next: plain(ownGoal!.nextAction) }));
    }
    if (relatedSummary) lines.push(relatedSummary);

    const goalAttention = ownGoal && ['WAITING_INPUT', 'BLOCKED', 'BUDGET_EXHAUSTED', 'INTERRUPTED'].includes(ownGoal.state);
    const changeAttention = activity && (activity.activationPending || ['UNKNOWN', 'INTERRUPTED', 'CANCELLED', 'BLOCKED'].includes(activity.state) || ['BLOCKED', 'REPAIR_REQUIRED'].includes(activity.recordedPhase));
    const attention = view.state === 'UNKNOWN' || view.state === 'WAITING' || view.inputNeeded || !!goalAttention || !!changeAttention || !!relatedAttention;
    // Keep physical/resource state first. A completed goal or old review-ready
    // record cannot replace unknown cleanup, a live response or archived state.
    const continuingGoal = ownGoal && !['COMPLETED', 'CANCELLED'].includes(ownGoal.state) ? goalSummary : undefined;
    const context = relatedAttention ?? (changeAttention ? changeSummary : goalAttention ? goalSummary : roleSummary ?? continuingGoal ?? relatedSummary ?? changeSummary ?? goalSummary);
    const idleStatus = view.state === 'IDLE' && !view.archived && !view.deleted ? context : undefined;
    return {
        resourceLabel,
        ...(idleStatus ? { idleStatus } : {}),
        lines,
        navigatorSummary: [resourceLabel, ...(view.inputNeeded ? [uiText(locale, 'pane.inputNeeded')] : []), ...(context ? [context] : [])].join(' · '),
        attention,
    };
}

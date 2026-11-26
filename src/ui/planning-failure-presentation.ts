import type { ConversationView } from '../controller/interaction-types.js';
import { roleRequestLimit } from '../workflow/execution-bounds.js';
import type { ChangeView, PlanningFailureView, RoleRequestLimitView } from '../controller/change-types.js';
import type { ProviderUsageLimit } from '../workflow/provider-failure.js';
import type { Role } from '../workflow/types.js';
import { providerUsageLimit } from '../workflow/provider-failure.js';
import { uiText, type UiLocale } from './i18n.js';

export function rolePresentationLabel(view: Pick<ConversationView, 'role' | 'roleStage'>, locale: UiLocale): string | undefined {
    const {role, roleStage} = view;
    if (role === 'adjudicator' && roleStage === 'planning-adjudication')
        return uiText(locale, 'task.role.planningAdjudication');
    if (role === 'reviewer' && roleStage === 'consumer-control-proposal')
        return uiText(locale, 'task.role.consumerControlProposal');
    switch (role) {
        case 'planner': return uiText(locale, 'task.role.planner');
        case 'challenger': return uiText(locale, 'task.role.challenger');
        case 'implementer': return uiText(locale, 'task.role.implementer');
        case 'repairer': return uiText(locale, 'task.role.repairer');
        case 'reviewer': return uiText(locale, 'task.role.reviewer');
        case 'adjudicator': return uiText(locale, 'task.role.adjudicator');
        case 'confirmer': return uiText(locale, 'task.role.confirmer');
        default: return undefined;
    }
}

/** Display an owned attribution; original diagnostics and action admission stay separate. */
export function planningFailurePresentation(failure: PlanningFailureView | undefined, work: string, locale: UiLocale) {
    if (!failure || !['planner', 'challenger', 'adjudicator'].includes(failure.role)) return undefined;
    const provider = providerFailurePresentation(failure.providerFailure, work, locale);
    if (provider) return provider;
    const title = uiText(locale, `planningFailure.${failure.role}`);
    if (failure.cause === 'tool-invocation-mismatch') {
        const reason = uiText(locale, 'planningFailure.toolInvocationMismatch');
        return { title: `${title} · ${reason}`, summary: uiText(locale, 'planningFailure.summary', { stage: reason }),
            details: uiText(locale, 'planningFailure.toolInvocationMismatchDetails') + '\n' + uiText(locale, 'planningFailure.details', { work }) };
    }
    return { title, summary: uiText(locale, 'planningFailure.summary', { stage: title }),
        details: uiText(locale, 'planningFailure.details', { work }) };
}

/** Shared recorded quota copy; callers preserve current ownership/hold precedence. */
export function providerFailurePresentation(failure: ProviderUsageLimit | undefined, work: string, locale: UiLocale) {
    const quota = providerUsageLimit(failure);
    if (quota) return recordedQuotaPresentation(quota.resetsAt ?? null, work, locale);
}

/** Format the original provider observation for an exact, read-only result. */
export function recordedQuotaPresentation(resetsAt: number | null, work: string, locale: UiLocale, role?: Role) {
    const reset = resetsAt === null ? undefined : new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).format(new Date(resetsAt * 1000));
    const timing = reset ? uiText(locale, 'planningFailure.quotaReset', { reset }) : uiText(locale, 'planningFailure.quotaUnknownReset');
    const label = role && uiText(locale, `model.roleName.${role}`);
    return {title: uiText(locale, 'planningFailure.quotaTitle'), summary: uiText(locale, 'planningFailure.quotaSummary'),
        details: [...(label ? [uiText(locale, 'planningFailure.quotaRole', {role: label})] : []),
            timing, uiText(locale, 'planningFailure.quotaDetails', { work })].join('\n')};
}

export function roleRequestLimitPresentation(failure: RoleRequestLimitView | undefined, work: string, locale: UiLocale) {
    const limit = roleRequestLimit(failure?.requestLimit);
    if (!limit) return;
    const stage = failure && rolePresentationLabel(failure, locale);
    const counts = {used: limit.used, limit: limit.limit};
    return {title: uiText(locale, 'roleRequestLimit.title'), summary: stage
        ? uiText(locale, 'roleRequestLimit.stageSummary', {stage, ...counts})
        : uiText(locale, 'roleRequestLimit.summary', counts),
        details: (stage ? uiText(locale, 'roleRequestLimit.stageDetail', {stage}) + '\n' : '') +
            uiText(locale, 'roleRequestLimit.details', {...counts, work})};
}

export function producerFailurePresentation(
    recorded: {
        workId: string;
        roleRequestLimit?: ChangeView['roleRequestLimit'];
        providerFailure?: ChangeView['providerFailure'];
        planningFailure?: ChangeView['planningFailure'];
    },
    locale: UiLocale,
) {
    const { workId, roleRequestLimit, providerFailure, planningFailure } = recorded;
    return roleRequestLimitPresentation(roleRequestLimit, workId, locale)
        ?? providerFailurePresentation(providerFailure?.usageLimit, workId, locale)
        ?? planningFailurePresentation(planningFailure, workId, locale);
}

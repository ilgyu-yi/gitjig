import type { ProviderUsageLimit } from '../workflow/provider-failure.js';
import { providerUsageLimit } from '../workflow/provider-failure.js';
import type { PlanningFailureView } from '../controller/change-types.js';
import { uiText, type UiLocale } from './i18n.js';

/** Display an owned attribution; original diagnostics and action admission stay separate. */
export function planningFailurePresentation(failure: PlanningFailureView | undefined, work: string, locale: UiLocale) {
    if (!failure || !['planner', 'challenger', 'adjudicator'].includes(failure.role)) return undefined;
    const provider = providerFailurePresentation(failure.providerFailure, work, locale);
    if (provider) return provider;
    const title = uiText(locale, `planningFailure.${failure.role}`);
    return { title, summary: uiText(locale, 'planningFailure.summary', { stage: title }),
        details: uiText(locale, 'planningFailure.details', { work }) };
}

/** Shared recorded quota copy; callers preserve current ownership/hold precedence. */
export function providerFailurePresentation(failure: ProviderUsageLimit | undefined, work: string, locale: UiLocale) {
    const quota = providerUsageLimit(failure);
    if (quota) {
        const reset = quota.resetsAt === undefined ? undefined : new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
        }).format(new Date(quota.resetsAt * 1000));
        return { title: uiText(locale, 'planningFailure.quotaTitle'), summary: uiText(locale, 'planningFailure.quotaSummary'),
            details: uiText(locale, 'planningFailure.quotaDetails', { work }) + '\n' + (reset
                ? uiText(locale, 'planningFailure.quotaReset', { reset }) : uiText(locale, 'planningFailure.quotaUnknownReset')) };
    }
}

import type { BudgetView } from '../controller/work-recovery.js';
import { showReviewText, type ReviewPageHost } from './exact-review.js';
import { uiText, type UiLocale } from './i18n.js';
import { escapeJsonControls, quoteText } from './inspection-text.js';
import { workAllowanceText } from './work-allowance-presentation.js';

export function showMergeReview(host: ReviewPageHost, locale: UiLocale, mode: 'first' | 'prepare' | 'send' | 'read', target: {
    repository: { owner: string; repository: string };
    pullNumber: number;
    baseRef: string;
    operationId?: string;
    headCommit?: string;
}, context: { scope: string; workId: string; execution: BudgetView | null; eligible: boolean; holds: readonly string[] }, fresh: () => void) {
    const { repository, pullNumber, baseRef, operationId, headCommit } = target;
    const summary = [
        uiText(locale, 'merge.record.title', {
            repository: quoteText(repository.owner + '/' + repository.repository), pull: pullNumber, base: quoteText(baseRef),
        }),
        uiText(locale, `merge.reviewEffect.${mode === 'first' ? 'prepare' : mode}`),
        workAllowanceText(locale, 'execution', context.execution),
        ...context.holds.map(quoteText),
        uiText(locale, 'merge.reviewStanding'),
        ...(headCommit ? [uiText(locale, 'merge.reviewHead', { commit: quoteText(headCommit) })] : []),
        ...(operationId ? [uiText(locale, 'merge.record.operation', { id: quoteText(operationId) })] : []),
        uiText(locale, 'merge.reviewWork', { id: quoteText(context.workId) }),
    ].join('\n');
    return showReviewText(host, uiText(locale, `merge.reviewTitle.${mode}`),
        summary + '\n\n' + escapeJsonControls(JSON.stringify(context, null, 2)), fresh, uiText(locale, 'review.only'), locale, {
            next: uiText(locale, 'review.next'),
            finish: uiText(locale, context.eligible ? 'review.confirm' : 'review.recovery'),
        });
}

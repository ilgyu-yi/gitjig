import type { ModelContextFailureCode } from '../pi/context-budget-error.js';
import { uiText, type UiLocale } from './i18n.js';

/** Translate owned display facts only; original diagnostics and admission stay separate. */
export function modelContextPresentation(code: ModelContextFailureCode | undefined, work: string, locale: UiLocale) {
    if (code === 'MODEL_CONTEXT_LIMIT')
        return { summary: uiText(locale, 'task.change.contextLimit'), title: uiText(locale, 'modelContext.limitTitle'),
            details: uiText(locale, 'modelContext.limitDetails', { work }) };
    if (code === 'MODEL_CONTEXT_UNAVAILABLE')
        return { summary: uiText(locale, 'task.change.contextUnavailable'), title: uiText(locale, 'modelContext.unavailableTitle'),
            details: uiText(locale, 'modelContext.unavailableDetails', { work }) };
    return undefined;
}

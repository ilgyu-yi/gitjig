import type { ConversationRequestFailure } from '../controller/conversation-results.js';
import { uiText, type UiLocale } from './i18n.js';
import { hasCleanCleanup } from './conversation-activity.js';
import { failurePresentation } from './failure-details.js';

/** App-attributed recovery, separate from a missing assistant final answer. */
export function conversationRequestFailurePresentation(failure: ConversationRequestFailure, locale: UiLocale) {
    const cleanup = hasCleanCleanup(failure.cleanup) ? '' : '\n' + uiText(locale, 'history.cleanupSuffix', { cleanup: failure.cleanup });
    const original = failure.failure ? '\n\n' + uiText(locale, 'requestLimit.original') + '\n' + failure.failure : '';
    const related = failure.relatedWorkIds.length ? '\n\n' + uiText(locale, 'requestLimit.related') + '\n' + failure.relatedWorkIds.map(id => '/work ' + id).join('\n') : '';
    const incomplete = failure.relatedWorkIncomplete ? '\n' + uiText(locale, 'requestLimit.relatedIncomplete') : '';
    const title = uiText(locale, 'requestLimit.title', { limit: failure.limit });
    const shown = failurePresentation(Object.assign(new Error(title), {
        code: 'CONVERSATION_REQUEST_LIMIT', workId: failure.workId, runId: failure.runId, relatedWorkIds: failure.relatedWorkIds,
        recovery: uiText(locale, 'requestLimit.recovery', { work: failure.workId }) + cleanup + related + incomplete + original,
    }));
    return { ...shown, summary: '/error · ' + title };
}

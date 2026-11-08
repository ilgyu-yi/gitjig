import { plainTerminalText } from './chrome.js';
import { hasCleanCleanup, responseOutcome } from './conversation-activity.js';
import { escapeJsonControls } from './inspection-text.js';
import { recordedQuotaPresentation } from './planning-failure-presentation.js';
import { validProviderReset } from '../workflow/provider-failure.js';
import { uiText, type UiLocale } from './i18n.js';
import type { ConversationTurnResult } from '../controller/interaction-types.js';

interface PublishedNoticeResult {
    resultId: string;
    conversationId: string;
    workId: string | null;
    result: unknown;
}

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const identity = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(value);
const ordinaryStatuses: ReadonlySet<unknown> = new Set<ConversationTurnResult['status']>(['delivered', 'interrupted', 'cancelled', 'waiting', 'unavailable']);
const effectPhases: ReadonlySet<unknown> = new Set(['PREPARED', 'REFRESHED', 'RESERVED', 'INVOKING', 'CONFIRMED', 'REFUSED', 'UNKNOWN']);
const summaryLine = (value: unknown): string => typeof value === 'string' && value.length <= 240
    ? plainTerminalText(value).replace(/\n/gu, ' ').trim() : '';

export function recordedGovernedOutcome(phase: string, reviewReady: boolean, uncertain: boolean, locale: UiLocale): string {
    return uiText(locale, uncertain ? 'task.resource.UNKNOWN' : phase === 'BLOCKED' ? 'delegated.blocked' :
        phase === 'REVIEW_READY' && reviewReady ? 'delegated.ready' : 'delegated.partial');
}

/** The summary describes the captured publication and links to existing inspection only. */
export function noticeResultPresentation(publication: PublishedNoticeResult, locale: UiLocale, continuation?: string) {
    const body = record(publication.result);
    const work = identity(publication.workId) ? publication.workId : undefined;
    let outcome = uiText(locale, 'notice.outcomeUnavailable');
    let command = work ? '/work ' + work : undefined;
    const inspection = [uiText(locale, 'notice.inspectWork'), work ? '/work ' + work : '/work'];
    const notes: string[] = [];
    let reason: unknown;
    if (body && work && body.workId === work && (body.conversationId === undefined || body.conversationId === publication.conversationId)) {
        if (body.kind === 'governed-work-observation/v1' && typeof body.phase === 'string' && typeof body.reviewReady === 'boolean') {
            const summary = record(body.recordedResult);
            const matchingSummary = summary?.workId === work && summary.recordedPhase === body.phase ? summary : undefined;
            const unknown = body.state === 'UNKNOWN' || matchingSummary?.state === 'UNKNOWN';
            outcome = recordedGovernedOutcome(body.phase, body.reviewReady, unknown, locale);
            const reset = matchingSummary?.providerUsageLimitReset;
            const quota = !unknown && body.phase === 'BLOCKED' && !body.reviewReady && (reset === null || validProviderReset(reset))
                ? recordedQuotaPresentation(reset, work, locale) : undefined;
            const blockers = matchingSummary?.blocked ?? body.blocked;
            if (quota)
                notes.push(quota.title, quota.details);
            else
                reason = Array.isArray(blockers) ? blockers[0] : undefined;
            const pendingFindings = matchingSummary?.pendingFindings;
            if (typeof pendingFindings === 'number' && Number.isSafeInteger(pendingFindings) && pendingFindings > 0)
                notes.push(uiText(locale, 'result.pendingFindings', {count:pendingFindings}));
            const clarification = record(matchingSummary?.planningClarification), count = clarification?.questionCount;
            if (identity(clarification?.outputId) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0)
                notes.push(uiText(locale, 'result.planningClarification', {count}),
                    uiText(locale, 'result.planningClarificationSource', {id:clarification.outputId}));
            const guidance = unknown || quota ? '' : summaryLine(matchingSummary?.nextAction ?? body.nextAction);
            if (guidance)
                notes.push(uiText(locale, 'result.recordedNextAction', {action: guidance}));
        } else if (body.kind === undefined && body.operationId === undefined && body.conversationId === publication.conversationId && identity(body.runId) &&
            ordinaryStatuses.has(body.status) && identity(body.cleanup)) {
            const status = body.status as ConversationTurnResult['status'];
            const clean = hasCleanCleanup(body.cleanup);
            const contradictsDelivery = status === 'delivered' && (
                (typeof body.failure === 'string' && !!body.failure.trim()) ||
                record(body.answer)?.state === 'unavailable' || record(body.coordinatorReport)?.state === 'unavailable');
            if (!clean || !contradictsDelivery)
                outcome = status === 'unavailable' && clean
                    ? uiText(locale, 'notice.responseUnavailable') : responseOutcome({status, cleanup: body.cleanup}, locale);
            reason = body.failure;
        } else if (body.kind === undefined && body.runId === undefined && identity(body.operationId) && effectPhases.has(body.phase)) {
            command = `/repo operation ${body.operationId} ${work}`;
            if (body.phase === 'CONFIRMED' && body.observedOutcome !== 'unknown') {
                outcome = uiText(locale, 'notice.operationConfirmed');
            } else {
                outcome = uiText(locale, body.phase === 'REFUSED' ? 'notice.operationRefused' : 'notice.operationUnconfirmed');
            }
            if (body.transportOutcome === 'uncertain')
                inspection.unshift(uiText(locale, 'notice.transportUncertain'));
            inspection.unshift(uiText(locale, 'notice.inspectOperation'), body.operationId);
            reason = Array.isArray(body.blocked) ? body.blocked[0] : undefined;
        }
    }
    const diagnostic = summaryLine(reason);
    if (diagnostic) notes.unshift(uiText(locale, 'notice.recordedReason', {reason: diagnostic}));
    const text = [outcome, ...inspection, ...(continuation ? [continuation] : []), ...notes, '', uiText(locale, 'notice.resultIdentity', {id: publication.resultId}), '',
        uiText(locale, 'notice.rawDetails'), escapeJsonControls(JSON.stringify(publication.result, null, 2) ?? '')].join('\n');
    return {text, command};
}

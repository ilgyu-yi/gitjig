import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { DelegatedRequestFailure, DescendantGovernedStop, RecordedDelegatedResults } from '../controller/conversation-results.js';
import type { Controller } from '../controller/controller.js';
import { uiText, type UiLocale } from './i18n.js';
import { recordedGovernedOutcome } from './notice-result.js';
import { recordedQuotaPresentation, roleRequestLimitPresentation } from './planning-failure-presentation.js';
import { plainTerminalText } from './chrome.js';

export type DelegatedStop = DelegatedRequestFailure | DescendantGovernedStop;
export type DelegatedRecovery = DelegatedStop | RecordedDelegatedResults['entries'][number];
type WaitTargets = NonNullable<ReturnType<Controller['inspectConversationWait']>>['targets'];
const isStoppedResult = (entry: RecordedDelegatedResults['entries'][number]) => entry.uncertain || entry.phase === 'BLOCKED' && !entry.reviewReady;

export function hasRecordedDelegatedStop(view: RecordedDelegatedResults | undefined): boolean {
    return !!(view?.requestFailures?.length || view?.descendantStops?.length || view?.descendantWaitStops?.length ||
        view?.descendantContinuationFailures?.length || view?.entries.some(isStoppedResult));
}
export function stoppedDelegatedWaitTargets(wait: ReturnType<Controller['inspectConversationWait']>, recorded?: RecordedDelegatedResults): WaitTargets {
    return wait && !wait.settlementUnconfirmed
        ? [...wait.targets.filter(target => target.cleanupUnconfirmed || ['UNAVAILABLE', 'CANCELLED', 'RECOVERY_READY'].includes(target.state)),
            ...(recorded?.descendantWaitStops ?? []).filter(target => !wait.targets.some(item => item.assignmentId === target.assignmentId))] : [];
}

export function delegatedWaitStatus(target: WaitTargets[number], locale: UiLocale): string {
    return uiText(locale, target.cleanupUnconfirmed ? 'workRecovery.settlementUnconfirmed' : target.state === 'CANCELLED' ? 'task.awaitedCancelled'
        : target.state === 'RECOVERY_READY' ? 'task.awaitedRecovery' : 'task.awaitedUnavailable');
}

/** An exact current wait takes priority over unrelated retained results. */
export function recommendedDelegatedRecovery(view: RecordedDelegatedResults | undefined, targets: WaitTargets | undefined): DelegatedRecovery | undefined {
    if (!view || view.unavailable || view.omitted || view.waitReviewUnavailable) return;
    const candidates: DelegatedRecovery[] = [
        ...(view.requestFailures ?? []), ...(view.descendantStops ?? []), ...view.entries.filter(isStoppedResult),
    ];
    const unique = [...new Map(candidates.map(entry => [entry.resultId, entry])).values()];
    if (targets) {
        if (view.descendantWaitStops?.length || view.descendantContinuationFailures?.length || targets.some(target => target.cleanupUnconfirmed)) return;
        const matching = unique.filter(entry => targets.some(target => {
            const firstHop = 'waitAssignmentId' in entry && entry.waitAssignmentId;
            return firstHop ? 'currentWait' in entry && entry.currentWait === true && target.assignmentId === firstHop && target.state === 'WAITING'
                : target.assignmentId === entry.assignmentId && target.conversationId === entry.conversationId && target.workId === entry.workId &&
                    target.resultId === entry.resultId && target.state === 'UNAVAILABLE';
        }));
        return matching.length === 1 ? matching[0] : undefined;
    }
    return unique.length === 1 ? unique[0] : undefined;
}
export function recordedDelegatedEvidence(entry: RecordedDelegatedResults['entries'][number], locale: UiLocale, includeQuotaTitle = true) {
    return [
        roleRequestLimitPresentation(entry.roleRequestLimit, entry.workId, locale)?.summary,
        includeQuotaTitle && entry.providerUsageLimitReset !== undefined ? uiText(locale, 'planningFailure.quotaTitle') : undefined,
        uiText(locale, entry.candidateVersion ? 'delegated.candidate' : 'delegated.noCandidate'),
        uiText(locale, 'delegated.checks', {count: entry.formalChecks}),
    ].filter((line): line is string => line !== undefined);
}
export function delegatedStopText(entry: DelegatedStop, locale: UiLocale) {
    if ('stop' in entry) {
        const status = uiText(locale, entry.stop === 'unconfirmed' ? 'delegated.recordedUnconfirmed'
            : entry.stop === 'provider-limit' ? 'planningFailure.quotaTitle' : 'delegated.blocked');
        const quota = entry.stop === 'provider-limit' && entry.providerUsageLimitReset !== undefined
            ? recordedQuotaPresentation(entry.providerUsageLimitReset, entry.workId, locale, entry.providerUsageLimitRole) : undefined;
        return {label: status + ' · #' + entry.assignmentId.slice(0, 8),
            details: quota?.details ?? ''};
    }
    const role = 'roleRequestLimit' in entry ? roleRequestLimitPresentation(entry.roleRequestLimit, entry.workId, locale) : undefined;
    const summary = role?.summary ?? uiText(locale, 'requestLimit.title', {limit: 'limit' in entry ? entry.limit : entry.roleRequestLimit.requestLimit.limit});
    const name = entry.label ? truncateToWidth(plainTerminalText(entry.label).replace(/\s+/gu, ' ').trim(), 18, '…') : '';
    return {label: summary + ' · ' + (name ? name + ' · ' : '') + '#' + entry.assignmentId.slice(0, 8),
        details: role?.details ?? uiText(locale, 'requestLimit.recovery', {work: entry.workId})};
}
/** Host-owned recorded facts, independent of assistant prose and current eligibility. */
export function recordedDelegatedResultText(view: RecordedDelegatedResults | undefined, locale: UiLocale, width: number, compact = false, commandKey?: string,
    recovery?: {record?: DelegatedRecovery | undefined; input?: boolean; interrupted?: boolean | undefined; planningQuestion?: boolean;
        stoppedWait?: WaitTargets[number] | undefined; continuationBlocked?: 'parent' | 'delegated' | undefined; confirm: string}): string {
    const selected = recovery?.record;
    const entry = selected && 'assignmentProof' in selected ? selected : view?.entries.find(item => item.roleRequestLimit) ?? view?.entries[0];
    const lines: string[] = [];
    const failure = selected && !('assignmentProof' in selected) ? selected : view?.requestFailures?.[0] ?? view?.descendantStops?.[0];
    const action = commandKey && recovery && uiText(locale, recovery.interrupted ? 'delegated.inputInterruptedKey' : recovery.input ? 'delegated.inputKey'
        : recovery.continuationBlocked === 'parent' ? 'delegated.continuationBlockedKey'
        : recovery.continuationBlocked === 'delegated' ? 'delegated.nestedContinuationKey'
        : selected ? 'delegated.recoveryKey' : 'delegated.resultListKey', { key: commandKey, confirm: recovery.confirm });
    if (recovery?.interrupted) lines.push(uiText(locale, 'delegated.inputInterrupted'));
    if (recovery?.planningQuestion) lines.push(uiText(locale, 'delegated.planningQuestion'));
    if (recovery?.stoppedWait)
        lines.push(delegatedWaitStatus(recovery.stoppedWait, locale) + ' · #' + recovery.stoppedWait.assignmentId.slice(0,8));
    if (view?.waitReviewUnavailable) lines.push(uiText(locale, 'delegated.waitUnverified'));
    if (failure && (failure === selected || !entry?.roleRequestLimit)) {
        lines.push(delegatedStopText(failure, locale).label, action || '/result --delegated');
    } else if (entry) {
        const title = uiText(locale, 'delegated.recorded', {id: entry.assignmentId.slice(0, 8)});
        const evidence = recordedDelegatedEvidence(entry, locale);
        const stage = recordedGovernedOutcome(entry.phase, entry.reviewReady, entry.uncertain, locale);
        const joinedTitle = title + ' · ' + stage, joinedFacts = evidence.join(' · ');
        const heading = !compact && visibleWidth(joinedTitle) <= width ? joinedTitle : 'gitjig · ' + stage;
        lines.push(heading);
        if (!compact && heading !== joinedTitle) lines.push(title);
        lines.push(...(visibleWidth(joinedFacts) <= width ? [joinedFacts] : evidence));
        const routes = '/result --delegated · /work ' + entry.workId;
        lines.push(action || (visibleWidth(routes) <= width ? routes : '/result --delegated · /work'));
        if (!action && commandKey && !compact)
            lines.push(uiText(locale, 'delegated.keepDraftCommand', { key: commandKey }));
    }
    if (!view) lines.push(uiText(locale, 'delegated.listUnavailable'));
    else if (view.unavailable) lines.push(uiText(locale, 'delegated.unavailable'));
    if (view && (view.omitted || view.entries.length + (view.requestFailures?.length ?? 0) + (view.descendantStops?.length ?? 0) +
        (view.descendantWaitStops?.length ?? 0) > 1)) lines.push(uiText(locale, 'delegated.more'));
    if (!entry && !failure && (action || !view || view.unavailable || view.omitted || view.waitReviewUnavailable))
        lines.push(action || (view?.waitReviewUnavailable ? '/result --delegated' : '/work'));
    return lines.map(line => truncateToWidth(line, Math.max(1, width), '…')).join('\n');
}

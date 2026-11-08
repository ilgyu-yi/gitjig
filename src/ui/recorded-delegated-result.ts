import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { RecordedDelegatedResults } from '../controller/conversation-results.js';
import { uiText, type UiLocale } from './i18n.js';
import { recordedGovernedOutcome } from './notice-result.js';
export function recordedDelegatedEvidence(entry: RecordedDelegatedResults['entries'][number], locale: UiLocale) {
    return [
        uiText(locale, entry.candidateVersion ? 'delegated.candidate' : 'delegated.noCandidate'),
        uiText(locale, 'delegated.checks', {count: entry.formalChecks}),
    ];
}
/** Host-owned recorded facts, independent of assistant prose and current eligibility. */
export function recordedDelegatedResultText(view: RecordedDelegatedResults | undefined, locale: UiLocale, width: number, compact = false, commandKey?: string): string {
    const entry = view?.entries[0], lines: string[] = [];
    if (entry) {
        const title = uiText(locale, 'delegated.recorded', {id: entry.assignmentId.slice(0, 8)});
        const evidence = recordedDelegatedEvidence(entry, locale);
        const stage = recordedGovernedOutcome(entry.phase, entry.reviewReady, entry.uncertain, locale);
        const joinedTitle = title + ' · ' + stage, joinedFacts = evidence.join(' · ');
        const heading = !compact && visibleWidth(joinedTitle) <= width ? joinedTitle : 'gitjig · ' + stage;
        lines.push(heading);
        if (!compact && heading !== joinedTitle) lines.push(title);
        lines.push(...(visibleWidth(joinedFacts) <= width ? [joinedFacts] : evidence));
        const routes = '/result --delegated · /work ' + entry.workId;
        lines.push(visibleWidth(routes) <= width ? routes : '/result --delegated · /work');
        if (commandKey && !compact)
            lines.push(uiText(locale, 'delegated.keepDraftCommand', { key: commandKey }));
    }
    if (!view) lines.push(uiText(locale, 'delegated.listUnavailable'));
    else if (view.unavailable) lines.push(uiText(locale, 'delegated.unavailable'));
    if (view && (view.omitted || view.entries.length > 1)) lines.push(uiText(locale, 'delegated.more'));
    if (!entry && (!view || view.unavailable || view.omitted)) lines.push('/work');
    return lines.map(line => truncateToWidth(line, Math.max(1, width), '…')).join('\n');
}

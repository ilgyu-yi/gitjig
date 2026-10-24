import type { ChangeResultView } from '../controller/change-types.js';
import { uiText, type UiLocale } from './i18n.js';
import { quoteText } from './inspection-text.js';
import { plainTerminalText } from './chrome.js';

/** Readable recorded output. This view neither probes files nor delivers a candidate. */
export function changeResultText(result: ChangeResultView, locale: UiLocale): string {
    // Leave space for every section within InspectionDetails' 65,536-character bound.
    // Omit whole entries rather than corrupting a path or evidence identity.
    const location = (path: string) => {
        const text = quoteText(path);
        return text.length <= 8192 ? text : uiText(locale, 'result.longLocation');
    };
    const lines = [
        uiText(locale, result.reviewReady ? 'result.ready' : 'result.attention'),
        uiText(locale, 'result.delivery'),
        '', uiText(locale, 'result.output'),
        result.candidate ? location(result.candidate.path) : uiText(locale, 'result.noCandidate'),
        uiText(locale, 'result.recordedPath'),
        uiText(locale, 'result.source', { path: location(result.registeredSourceRoot) }),
        uiText(locale, 'result.sourceUncompared'),
        '', uiText(locale, 'result.next'),
        uiText(locale, result.reviewReady ? 'result.nextReady' : 'result.nextAttention', { id: result.workId }),
        uiText(locale, 'result.details', { id: result.workId }),
        '', uiText(locale, 'result.changes'),
    ];
    const entries = (items: string[], alreadyOmitted = 0, budget = 6000) => {
        let length = 0, omitted = alreadyOmitted;
        for (const item of items) {
            if (length + item.length + 1 > budget) { omitted++; continue; }
            length += item.length + 1;
            lines.push(item);
        }
        if (omitted) lines.push(uiText(locale, 'result.omitted', { count: omitted }));
    };
    if (result.changes.availability === 'recorded') {
        entries(result.changes.entries.map(entry => `${uiText(locale, `result.path.${entry.kind}`)} · ${quoteText(entry.path)}`), result.changes.omitted);
        if (result.changes.total === 0) lines.push(uiText(locale, 'result.noChanges'));
    } else lines.push(plainTerminalText(result.changes.reason ?? uiText(locale, 'result.unavailable')));
    lines.push('', uiText(locale, result.checks.entries.some(check => check.target === 'base') ? 'result.checksWithBaseline' : 'result.checks'));
    if (result.checks.availability === 'recorded') {
        entries(result.checks.entries.map(check => {
            const baseline = check.target === 'base' && check.purpose === 'baseline';
            const status = check.status === 'baseline-observed'
                ? baseline && check.observed ? 'baseline-observed' : 'unavailable'
                : check.status === 'pass' && (baseline || !check.passed) ? 'unavailable' : check.status;
            return `${baseline ? uiText(locale, 'result.baseline') + ' · ' : ''}${uiText(locale, `result.check.${status}`)} · ${quoteText(check.checkId)}`;
        }), result.checks.omitted);
        if (result.checks.total === 0) lines.push(uiText(locale, 'result.noChecks'));
    } else lines.push(plainTerminalText(result.checks.reason ?? uiText(locale, 'result.unavailable')));
    if (result.verificationEvidence) {
        const evidence = result.verificationEvidence;
        lines.push('', uiText(locale, 'result.verificationEvidence'));
        const observations = evidence.requirements.map(requirement => {
            const rows = [`${uiText(locale, `result.strategy.${requirement.kind}`)} · ${quoteText(requirement.requirementId)} · ${uiText(locale, requirement.witnessAvailability === 'recorded' ? 'result.observationRecorded' : 'result.unavailable')}`];
            if (requirement.scope) rows.push(`${uiText(locale, requirement.scope.actual.satisfied ? 'result.scopeWithin' : 'result.scopeViolation')} · ${uiText(locale, requirement.scope.adverse.satisfied ? 'result.scopeAdverseFailed' : 'result.scopeAdverseRejected')}`);
            if (requirement.reviewKey && !requirement.reviewLaunchIds.length) rows.push(uiText(locale, 'result.verificationReviewPending'));
            if (requirement.reason) rows.push(plainTerminalText(requirement.reason));
            return rows.join('\n');
        });
        if (evidence.availability === 'unavailable') {
            lines.push(uiText(locale, 'result.verificationPending'));
            if (evidence.reason) observations.unshift(plainTerminalText(evidence.reason));
        }
        entries(observations, 0, 4000);
    }
    lines.push('', uiText(locale, 'result.reviews'));
    if (result.reviews.availability === 'recorded') {
        entries(result.reviews.entries.map(review => {
            const applicable = review.state === 'selected' || review.state === 'carried';
            return `${uiText(locale, applicable ? `result.review.${review.outcome}` : 'result.unavailable')} · ${quoteText(review.key)}${review.findingCount ? ' · ' + uiText(locale, 'result.findings', { count: review.findingCount }) : ''}${review.state === 'carried' ? ' · ' + uiText(locale, 'result.carried') : ''}`;
        }), result.reviews.omitted);
        if (result.reviews.total === 0) lines.push(uiText(locale, 'result.noReview'));
    } else lines.push(plainTerminalText(result.reviews.reason ?? uiText(locale, 'result.unavailable')));
    if (result.blocked.length || result.blockedOmitted) {
        lines.push('', uiText(locale, 'result.blockers'));
        entries(result.blocked.map(plainTerminalText), result.blockedOmitted);
    }
    lines.push('', uiText(locale, 'result.request'), plainTerminalText(result.request.slice(0, 4000)),
        ...(result.requestTruncated || result.request.length > 4000 ? [uiText(locale, 'result.shortened')] : []),
        '', uiText(locale, 'result.limits'));
    entries(result.limitations.map(plainTerminalText));
    lines.push(
        '', uiText(locale, 'result.provenance'), `Work: ${result.workId}`, `State: ${result.state}`, `Recorded stage: ${result.recordedPhase}`, `Recorded next action: ${plainTerminalText(result.nextAction)}`,
        `Candidate: ${result.candidate?.versionId ?? 'none'}`, `Verification: ${result.provenance.verificationVersion ?? 'none'}`);
    return lines.join('\n');
}

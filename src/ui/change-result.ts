import { modelContextPresentation } from './model-context-presentation.js';
import { producerFailurePresentation } from './planning-failure-presentation.js';
import type { ChangeResultView, RecordedCheckCaseValue, RecordedCheckFailures } from '../controller/change-types.js';
import { recordedCheckStatus } from '../controller/change-result.js';
import { uiText, type UiLocale } from './i18n.js';
import { quoteText } from './inspection-text.js';
import { plainTerminalText } from './chrome.js';
import { limitedSharedAllowanceText, type ContinuationAllowanceHold } from './work-allowance-presentation.js';
import { workflowCriteriaNextAction } from './criteria-refresh.js';

const failedChecks = (result: ChangeResultView) => [
    ...result.checks.entries.filter(check => check.status === 'fail'),
    ...(result.retainedCheckFailures?.entries ?? []),
];

export function showsCaseComparison(result: ChangeResultView): boolean {
    return failedChecks(result).some(check => !!check.failures?.caseIds.length);
}

const failureLines = (failures: RecordedCheckFailures, locale: UiLocale) => [
    ...(failures.assertionIds.length ? [uiText(locale, 'result.check.failedAssertions', {ids: failures.assertionIds.map(quoteText).join(', ')})] : []),
    ...(failures.caseIds.length ? [uiText(locale, 'result.check.mismatchedCases', {ids: failures.caseIds.map(quoteText).join(', ')})] : []),
    ...(failures.omitted ? [uiText(locale, 'result.check.failureIdsOmitted', {count: failures.omitted})] : []),
];

export function changeCaseValuesText(result: ChangeResultView, locale: UiLocale): string {
    const quote = (value: string) => quoteText(value).replace(/[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
        character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    const outcome = ({kind, value}: RecordedCheckCaseValue) => uiText(locale, `result.check.caseValue.${kind}`, {
        value: value === null ? uiText(locale, 'result.check.largeCaseValue') : quote(value),
    });
    const lines: string[] = [];
    const retained = result.retainedCheckFailures;
    let length = 0, omitted = result.checks.omitted + (retained?.omitted ?? 0);
    for (const check of failedChecks(result)) {
        const failures = check.failures;
        if (!failures?.caseValues?.length) continue;
        const text = [
            'status' in check ? quote(check.checkId) : uiText(locale, 'result.retainedCheckReceipt', {
                check: quote(check.checkId), receipt: quote(check.receiptId),
            }),
            ...failures.caseValues.flatMap(({id, expected, observed}) => [
                uiText(locale, 'result.check.caseMismatch', {id: quote(id)}),
                uiText(locale, 'result.check.caseExpected', {value: outcome(expected)}),
                uiText(locale, 'result.check.caseObserved', {value: outcome(observed)}),
            ]),
            ...(failures.omitted ? [uiText(locale, 'result.check.failureIdsOmitted', {count: failures.omitted})] : []),
        ].join('\n');
        if (length + text.length > 8000) { omitted++; continue; }
        lines.push(text);
        length += text.length;
    }
    if (!lines.length) lines.push(uiText(locale, 'result.unavailable'));
    if (retained) lines.unshift(uiText(locale, 'result.retainedChecks'));
    if (retained?.unavailable) lines.push(uiText(locale, 'result.retainedChecksUnavailable', {count:retained.unavailable}));
    if (omitted) lines.push(uiText(locale, 'result.omitted', {count: omitted}));
    return lines.join('\n\n');
}

export function scopeFailureText(scope: NonNullable<ChangeResultView['scopeFailure']>, workId: string, locale: UiLocale, showRecovery = true): string {
    const paths = ({ entries, omitted }: typeof scope.allowedChangePaths) => [
        ...entries.map(quoteText),
        ...(omitted ? [uiText(locale, 'result.omitted', { count: omitted })] : entries.length ? [] : [uiText(locale, 'value.none')]),
    ];
    return [
        uiText(locale, 'result.scopeFailure', { requirement: quoteText(scope.requirementId), evidence: quoteText(scope.evidenceId) }),
        uiText(locale, 'result.scopeAllowed'), ...paths(scope.allowedChangePaths),
        uiText(locale, 'result.scopeUnchanged'), ...paths(scope.unchangedPaths),
        ...(showRecovery ? [uiText(locale, 'result.scopeRecovery'),
            ...(scope.replanAvailable ? [uiText(locale, 'result.scopeReplan', { work: workId })] : []),
        ] : []),
    ].join('\n');
}

/** A recorded plan can lead to resume review. Admission still belongs to the original command. */
export function showsAcceptedPlan(result: ChangeResultView): boolean {
    return result.state === 'ACTIVE' &&
        (result.recordedPhase === 'PLAN_READY' || result.recordedPhase === 'CANDIDATE_CAPTURED' && result.verificationReplanAccepted === true) &&
        !!result.provenance.planVersion && !!result.provenance.verificationVersion &&
        !result.reviewReady && result.blocked.length === 0 && result.blockedOmitted === 0 && !result.heldDirections;
}

export function showsPendingResultFollowup(result: ChangeResultView): boolean {
    return result.state === 'DELIVERED' && result.recordedPhase === 'REVIEW_READY' && !result.reviewReady && !!result.heldDirections;
}

/** Readable recorded output. This view neither probes files nor delivers a candidate. */
export function changeResultText(result: ChangeResultView, locale: UiLocale, fromWork = false, comparisonAvailable = false,
    { live, allowanceHold, directRecovery, deliveryAvailable, saveHistoryAvailable, deliveryHistoryAvailable, heldResumeAvailable }: {
        live?: boolean; allowanceHold?: ContinuationAllowanceHold; directRecovery?: boolean; deliveryAvailable?: boolean; saveHistoryAvailable?: boolean;
        deliveryHistoryAvailable?: boolean; heldResumeAvailable?: boolean;
    } = {}): string {
    // Leave space for every section within InspectionDetails' 65,536-character bound.
    // Omit whole entries rather than corrupting a path or evidence identity.
    const location = (path: string) => {
        const text = quoteText(path);
        return text.length <= 8192 ? text : uiText(locale, 'result.longLocation');
    };
    // Project the same recorded outcomes once for both the overview and full rows.
    const checks = result.checks.entries.map(check => {
        const baseline = check.target === 'base' && check.purpose === 'baseline';
        const status = recordedCheckStatus(check);
        return {check, status, label: `${baseline ? uiText(locale, 'result.baseline') + ' · ' : ''}${uiText(locale, `result.check.${status}`)}`};
    });
    const checkDetail = ({check, status, label}: (typeof checks)[number]) => {
        const production = check.production;
        const failures = status === 'fail' ? check.failures : undefined;
        const facts = production ? [
            ...(production.termination ? [uiText(locale, `result.check.${production.termination}`)] : []),
            ...(production.exitCode !== null ? [uiText(locale, 'result.check.exited', {code: production.exitCode})] : production.termination ? [] : [uiText(locale, 'result.check.processUnknown')]),
            uiText(locale, `result.check.report.${production.report}`),
        ] : [];
        if (status === 'pass' && check.observedCounts) facts.push(uiText(locale, 'result.check.observedCounts', check.observedCounts));
        if (status === 'unavailable' && check.unavailableReason === 'output-contract') {
            const issues = (['case-missing', 'assertion-missing', 'case-unexpected', 'assertion-unexpected', 'case-input-digest'] as const)
                .flatMap(kind => {
                    const count = check.outputIssues?.[kind];
                    if (!count) return [];
                    const label = uiText(locale, `result.check.outputIssue.${kind}`, {count});
                    const ids = check.outputIssueIds?.[kind] ?? [];
                    return [ids.length ? `${label} · ${ids.map(quoteText).join(', ')}${ids.length < count ? ', …' : ''}` : label];
                });
            facts.push(...(issues.length ? issues : [uiText(locale, 'result.check.outputContract')]));
        }
        const stderr = check.stderrExcerpt && plainTerminalText(check.stderrExcerpt.text)
            .replace(/[\p{Bidi_Control}\u2028\u2029]/gu, ' ').trim();
        const control = check.consumerControl ?
            [uiText(locale, `result.check.${check.consumerControlExpectedPass ? 'conformingControl' : 'consumerControl'}.${check.consumerControl}`, {id: quoteText(check.checkId)})] : [];
        return [[`${label} · ${quoteText(check.checkId)}`, ...facts].join(' · '), ...control,
            ...(failures ? failureLines(failures, locale) : []),
            ...(stderr ? [uiText(locale, 'result.check.stderr'), ...stderr.split('\n').map(line => '  ' + line),
                ...(check.stderrExcerpt?.shortened ? [uiText(locale, 'result.check.stderrShortened')] : [])] : [])].join('\n');
    };
    const reviews = result.reviews.entries.map(review => ({review,
        label: uiText(locale, review.state === 'selected' || review.state === 'carried' ? `result.review.${review.outcome}` : 'result.unavailable'),
        carried: review.state === 'carried',
    }));
    const unrecorded = {
        'not-planned': uiText(locale, 'result.notPlanned'),
        unavailable: uiText(locale, 'result.unavailable'),
    };
    const summary = (
        evidence: Pick<ChangeResultView['checks'], 'availability' | 'total' | 'omitted'>,
        labels: readonly string[],
        empty: 'result.noChecks' | 'result.noReview',
    ) => {
        if (evidence.availability !== 'recorded') return unrecorded[evidence.availability];
        const counts = new Map<string, number>();
        for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
        const parts = [...counts].map(([label, count]) => `${label}: ${count}`);
        const omitted = Math.max(evidence.omitted, evidence.total === null ? 0 : evidence.total - labels.length);
        if (omitted) parts.push(uiText(locale, 'result.summaryOmitted', {count: omitted}));
        return parts.join(' · ') || (evidence.total === 0 ? uiText(locale, empty) : unrecorded.unavailable);
    };
    const acceptedPlan = showsAcceptedPlan(result);
    const cancelled = result.state === 'CANCELLED';
    const pendingFollowup = showsPendingResultFollowup(result);
    const historicalCriteriaHold = result.state === 'DELIVERED' && result.recordedPhase === 'REVIEW_READY' && !result.reviewReady
        ? result.workflowCriteriaHold : undefined;
    const recoveryRoute = fromWork ? uiText(locale, 'result.nextFromWork') :
        directRecovery ? uiText(locale, 'result.nextDirectRecovery') : uiText(locale, 'result.nextAttention', { id: result.workId });
    const allowanceHint = allowanceHold && uiText(locale, 'workRecovery.allowanceNeeded', { action: uiText(locale, `workRecovery.${allowanceHold}`) });
    const lines = [
        uiText(locale, cancelled ? 'result.cancelled' : result.reviewReady ? 'result.ready'
            : historicalCriteriaHold ? 'result.readyUnderEarlierCriteria'
            : acceptedPlan ? 'result.planAccepted' : pendingFollowup ? 'result.followupPending' : 'result.attention'),
        ...(historicalCriteriaHold ? [uiText(locale, `criteria.recovery.${historicalCriteriaHold}`)] : []),
        uiText(locale, 'result.project', {id: quoteText(result.projectId)}),
        uiText(locale, 'result.readOnly'),
        '', uiText(locale, 'result.next'),
        historicalCriteriaHold ? workflowCriteriaNextAction(locale, historicalCriteriaHold, result.workId)
            : cancelled ? recoveryRoute : result.reviewReady
            ? deliveryAvailable ? uiText(locale, 'result.nextReadyActions')
                : fromWork ? uiText(locale, 'result.nextReadyFromWork') : uiText(locale, 'result.nextReady', { id: result.workId })
            : live ? uiText(locale, 'workRecovery.live') + '\n' + recoveryRoute
                : heldResumeAvailable ? uiText(locale, 'result.nextHeldResume', {action: uiText(locale, 'result.reviewResume')})
                : acceptedPlan && !allowanceHint ? uiText(locale, result.verificationReplanAccepted ? 'result.nextAcceptedVerificationPlan' : 'result.nextAcceptedPlan') : recoveryRoute,
        ...(saveHistoryAvailable ? [uiText(locale, 'result.nextSaveHistory', {action: uiText(locale, 'save.workHistory')})] : []),
        ...(deliveryHistoryAvailable ? [uiText(locale, 'result.nextDeliveryHistory', {action: uiText(locale, 'result.deliveryHistory')})] : []),
    ];
    const entries = (items: string[], alreadyOmitted = 0, budget = 6000) => {
        let length = 0, omitted = alreadyOmitted;
        for (const item of items) {
            if (length + item.length + 1 > budget) { omitted++; continue; }
            length += item.length + 1;
            lines.push(item);
        }
        if (omitted) lines.push(uiText(locale, 'result.omitted', { count: omitted }));
        return length;
    };
    const showRecovery = cancelled || !result.reviewReady && (result.blocked.length > 0 || result.blockedOmitted > 0 || !!result.modelContextFailure || !!historicalCriteriaHold);
    const criteriaHold = showRecovery ? result.workflowCriteriaHold : undefined;
    const nextAction = historicalCriteriaHold ? '' : criteriaHold ? workflowCriteriaNextAction(locale, criteriaHold, result.workId)
        : live || cancelled || acceptedPlan && allowanceHint ? '' : plainTerminalText(result.nextAction);
    const [recordedBlocker, ...otherBlockers] = result.blocked.map(plainTerminalText);
    const firstBlocker = historicalCriteriaHold ? undefined
        : criteriaHold ? uiText(locale,`criteria.recovery.${criteriaHold}`) : recordedBlocker;
    if (criteriaHold === 'unavailable' && recordedBlocker !== undefined) otherBlockers.unshift(recordedBlocker);
    if (firstBlocker !== undefined || otherBlockers.length || result.blockedOmitted)
        lines.push('', uiText(locale, live ? 'result.recordedBlockers' : 'result.blockers'));
    if (firstBlocker !== undefined) lines.push(firstBlocker);
    if (showRecovery && !live && !cancelled && result.verificationGap) {
        const gap = result.verificationGap;
        lines.push(plainTerminalText(uiText(locale, 'result.verificationGap', {
            requirement: quoteText(gap.requirementId),
            checks: gap.passingChecks.map(quoteText).join(', '),
        })));
        if (gap.omittedChecks) lines.push(uiText(locale, 'result.omitted', {count: gap.omittedChecks}));
    }
    if (showRecovery && nextAction)
        lines.push(uiText(locale, 'result.recordedNextAction', {action: nextAction}));
    if (allowanceHint && !cancelled && !result.reviewReady && !live)
        lines.push(allowanceHint);
    if (comparisonAvailable)
        lines.push(uiText(locale, 'result.openActions') + ' → ' + uiText(locale, 'result.check.caseValuesAction'));
    const allowance = (showRecovery || allowanceHold) && result.sharedAllowance ? limitedSharedAllowanceText(locale, result.sharedAllowance) : [];
    if (allowance.length)
        lines.push('', uiText(locale, fromWork ? 'result.sharedAllowance' : 'result.sharedAllowanceInWork', {id: result.workId}), ...allowance, '');
    const attentionChecks = !result.reviewReady && result.checks.availability === 'recorded'
        ? checks.filter(({check, status}) => !(check.target === 'base' && check.purpose === 'baseline') &&
            (status === 'fail' || status === 'unavailable' && check.unavailableReason === 'output-contract'))
        : [];
    const otherChecks = checks.filter(check => !attentionChecks.includes(check));
    let attentionLength = 0;
    if (attentionChecks.length) {
        lines.push('', uiText(locale, 'result.checkAttention'));
        attentionLength = entries(attentionChecks.map(checkDetail));
    }
    entries(otherBlockers, result.blockedOmitted, 6000 - (firstBlocker === undefined ? 0 : firstBlocker.length + 1));

    const context = modelContextPresentation(result.modelContextFailure, result.workId, locale)
        ?? (result.state === 'ACTIVE' && result.recordedPhase === 'BLOCKED' && !result.reviewReady
            ? producerFailurePresentation(result, locale) : undefined);
    if (context)
        lines.push('', context.title, context.details);
    if (result.planningClarification) {
        const {outputId, questions, reply} = result.planningClarification;
        lines.push('', uiText(locale, 'result.planningClarification', {count:questions.total}),
            ...questions.entries.map(plainTerminalText),
            ...(questions.omitted ? [uiText(locale, 'result.omitted', {count:questions.omitted})] : []),
            uiText(locale, 'result.planningClarificationSource', {id:quoteText(outputId)}),
            ...(!reply ? [uiText(locale, 'result.planningClarificationReplyUnavailable')] : []));
    }
    if (result.scopeFailure)
        lines.push('', scopeFailureText(result.scopeFailure, result.workId, locale, !live));
    if (result.retainedCheckFailures) {
        const {entries: failures, omitted, unavailable} = result.retainedCheckFailures;
        lines.push('', uiText(locale, 'result.retainedChecks'));
        entries(failures.map(({checkId, receiptId, failures}) => [
            uiText(locale, 'result.retainedCheckReceipt', {check: quoteText(checkId), receipt: quoteText(receiptId)}),
            ...failureLines(failures, locale),
        ].join('\n')), omitted);
        if (unavailable) lines.push(uiText(locale, 'result.retainedChecksUnavailable', {count:unavailable}));
    }
    if (result.heldDirections) {
        lines.push('', uiText(locale, 'result.heldDirections'));
        entries(result.heldDirections.entries.map(({sourceOrigin, directionRevision}) => {
            const author = sourceOrigin === 'owner-conversation-input' ? 'owner' : sourceOrigin.startsWith('agent-') ? 'agent'
                : sourceOrigin === 'goal-continuation' ? 'system' : 'unknown';
            return uiText(locale, `result.direction.${author}`, {revision: directionRevision});
        }), result.heldDirections.omitted);
    }
    lines.push('', uiText(locale, 'result.checkSummary') + ' · ' +
        summary(result.checks, checks.map(row => row.label), 'result.noChecks'),
        uiText(locale, 'result.reviewSummary') + ' · ' +
        summary(result.reviews, reviews.map(row => row.carried
            ? row.label + ' · ' + uiText(locale, 'result.carried') : row.label), 'result.noReview'));
    if (result.verificationEvidence?.availability === 'unavailable') lines.push(uiText(locale, 'result.verificationPending'));
    if (result.pendingFindings) lines.push(uiText(locale, 'result.pendingFindings', {count:result.pendingFindings}));
    lines.push('', uiText(locale, 'result.output'),
        result.candidate ? location(result.candidate.path) : uiText(locale, 'result.noCandidate'),
        uiText(locale, 'result.recordedPath'),
        uiText(locale, 'result.source', { path: location(result.registeredSourceRoot) }),
        uiText(locale, 'result.sourceUncompared'),
        '', uiText(locale, 'result.changes'));
    if (result.changes.availability === 'recorded') {
        entries(result.changes.entries.map(entry => `${uiText(locale, `result.path.${entry.kind}`)} · ${quoteText(entry.path)}`), result.changes.omitted);
        if (result.changes.total === 0) lines.push(uiText(locale, 'result.noChanges'));
    } else lines.push(plainTerminalText(result.changes.reason ?? uiText(locale, 'result.unavailable')));
    if (otherChecks.length || !attentionChecks.length || result.checks.omitted) {
        lines.push('', uiText(locale, result.checks.entries.some(check => check.target === 'base') ? 'result.checksWithBaseline' : 'result.checks'));
        if (result.checks.availability === 'recorded') {
            entries(otherChecks.map(checkDetail), result.checks.omitted, 6000 - attentionLength);
            if (result.checks.total === 0) lines.push(uiText(locale, 'result.noChecks'));
        } else lines.push(plainTerminalText(result.checks.reason ?? unrecorded[result.checks.availability]));
    }
    if (result.verificationEvidence) {
        const evidence = result.verificationEvidence;
        lines.push('', uiText(locale, 'result.verificationEvidence'));
        const observations = evidence.requirements.map(requirement => {
            const rows = [`${uiText(locale, `result.strategy.${requirement.kind}`)} · ${quoteText(requirement.requirementId)} · ${uiText(locale, requirement.witnessAvailability === 'recorded' ? 'result.observationRecorded' : 'result.unavailable')}`];
            if (requirement.scope) rows.push(`${uiText(locale, requirement.scope.actual.satisfied ? 'result.scopeWithin' : 'result.scopeViolation')} · ${uiText(locale, requirement.scope.adverse.satisfied ? 'result.scopeAdverseFailed' : 'result.scopeAdverseRejected')}`);
            for (const part of requirement.parts ?? []) {
                rows.push(`${uiText(locale, `result.strategy.${part.kind}`)} · ${uiText(locale, part.witnessAvailability === 'recorded' ? 'result.observationRecorded' : 'result.unavailable')}`);
                if(part.scope)rows.push(`${uiText(locale,part.scope.actual.satisfied?'result.scopeWithin':'result.scopeViolation')} · ${uiText(locale,part.scope.adverse.satisfied?'result.scopeAdverseFailed':'result.scopeAdverseRejected')}`);
            }
            if ((requirement.reviewKey || requirement.reviewKeys?.length) && !requirement.reviewLaunchIds.length) rows.push(uiText(locale, 'result.verificationReviewPending'));
            if (requirement.reason) rows.push(plainTerminalText(requirement.reason));
            return rows.join('\n');
        });
        if (evidence.availability === 'unavailable') {
            if (evidence.reason) observations.unshift(plainTerminalText(evidence.reason));
        }
        entries(observations, 0, 4000);
    }
    lines.push('', uiText(locale, 'result.reviews'));
    if (result.reviews.availability === 'recorded') {
        entries(reviews.map(({review, label, carried}) =>
            `${label} · ${quoteText(review.key)}${review.findingCount ? ' · ' + uiText(locale, 'result.findings', { count: review.findingCount }) : ''}${carried ? ' · ' + uiText(locale, 'result.carried') : ''}`
        ), result.reviews.omitted);
        if (result.reviews.total === 0) lines.push(uiText(locale, 'result.noReview'));
    } else lines.push(plainTerminalText(result.reviews.reason ?? unrecorded[result.reviews.availability]));
    lines.push('', uiText(locale, 'result.request'), plainTerminalText(result.request.slice(0, 4000)),
        ...(result.requestTruncated || result.request.length > 4000 ? [uiText(locale, 'result.shortened')] : []),
        '', uiText(locale, 'result.limits'), uiText(locale, 'result.delivery'));
    entries(result.limitations.map(plainTerminalText));
    lines.push(
        '', uiText(locale, 'result.provenance'), uiText(locale, 'result.details', {id: result.workId}), `Work: ${result.workId}`, `State: ${result.state}`, `Recorded stage: ${result.recordedPhase}`,
        ...(result.restoredRoleMaterialLaunchId ? [uiText(locale, 'result.originalMaterialRestored', {id:quoteText(result.restoredRoleMaterialLaunchId)})] : []),
        ...(!showRecovery && nextAction ? [uiText(locale, 'result.recordedNextAction', {action: nextAction})] : []),
        `Candidate: ${result.candidate?.versionId ?? 'none'}`, `Verification: ${result.provenance.verificationVersion ?? 'none'}`);
    return lines.join('\n');
}

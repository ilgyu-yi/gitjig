import { truncateToWidth } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
import type { WorkflowCriteriaHold } from '../controller/change-types.js';
import { isWorkSettlementUnconfirmed } from '../controller/work-recovery.js';
import { plainTerminalText } from './chrome.js';
import { translator, type UiLocale } from './i18n.js';
import { escapeDisplayControls } from './inspection-text.js';
import { modelContextPresentation } from './model-context-presentation.js';
import { producerFailurePresentation, roleRequestLimitPresentation } from './planning-failure-presentation.js';
import { limitedSharedAllowanceText, type ContinuationAllowanceHold } from './work-allowance-presentation.js';
import { managedModelGuidance, managedModelRepairDirections } from './managed-model-guidance.js';
import type { inspectWorkResumeEntry } from './work-resume-entry.js';

export function inspectOriginalPrerequisites(host: Parameters<typeof managedModelGuidance>[0],
    work: ReturnType<Controller['inspectWorkRecovery']>, entry: ReturnType<typeof inspectWorkResumeEntry>, locale: UiLocale) {
    if (!entry.resumeAvailable || entry.originBlocked || work.activationPending || !host.models || work.recoveryHold?.kind === 'settlement') return;
    const t = translator(locale);
    const assessment = managedModelGuidance(host, work.workId, locale);
    if (['busy', 'held', 'complete', 'unavailable'].includes(assessment.stage) || assessment.allowanceHold) return;
    const baseline = host.controller.getWorkApplicationModelBaseline(work.workId);
    const roleChoices = baseline && assessment.roles?.length ? host.models.workRoleChoices(work.workId, assessment.roles) : undefined;
    const mutationBlocker = baseline && assessment.issues.some(issue => issue.kind !== 'external')
        ? host.controller.inspectApplicationMutationBlocker() : undefined;
    const accountBlocker = assessment.issues.some(issue => issue.kind === 'account') ? mutationBlocker : undefined;
    const needsRuntime = !host.controller.options.runtimeProfile;
    const directions = needsRuntime ? [t('delegated.runtimePrerequisite')] : [];
    if (accountBlocker) {
        const next = accountBlocker.kind === 'conversation'
            ? t(`delegated.accountBlocker.${accountBlocker.next}`, {conversation: escapeDisplayControls(accountBlocker.conversationId)})
            : t(`delegated.accountBlocker.${accountBlocker.kind}`);
        directions.push(...assessment.messages, t('delegated.accountSetupHeld'), next, t('delegated.accountSetupRetry'));
    } else if (baseline && !mutationBlocker) {
        directions.push(...managedModelRepairDirections(assessment, locale));
    }
    return {
        directions, needsRuntime, accountBlocker,
        checkpoint: [work.workId, work.epoch, work.generation, work.state, work.sourceId, work.projectId,
            entry.origin?.generation, entry.origin?.directionRevision, baseline, roleChoices, assessment],
    };
}

export function workOriginGuidance(work: ReturnType<Controller['inspectWorkRecovery']>, origin: ReturnType<Controller['inspectConversation']> | undefined,
    originBlocked: boolean, locale: UiLocale) {
    if (!originBlocked) return;
    return translator(locale)(origin?.deleted ? 'workRecovery.originDeleted' : origin?.archived
        ? 'workRecovery.originArchived' : 'workRecovery.originUnavailable', {conversation: work.conversationId});
}

export function workRecoveryGuidance(work: ReturnType<Controller['inspectWorkRecovery']>, locale: UiLocale, allowanceHold: ContinuationAllowanceHold, live: boolean,
    surface: 'work' | 'delegated-result' = 'work') {
    const hold = work.recoveryHold, t = translator(locale);
    const settlementUnconfirmed = isWorkSettlementUnconfirmed(work.state);
    if (!hold && !allowanceHold && !live && !settlementUnconfirmed && !work.heldDirectionCount) return [];
    const continuationGuidance = [
        ...(live ? [t('workRecovery.live')] : []),
        ...(work.heldDirectionCount ? [t('workRecovery.heldDirections', {count:work.heldDirectionCount})] : []),
        ...(allowanceHold ? [t('workRecovery.allowanceNeeded', { action: t(`workRecovery.${allowanceHold}`) })] : []),
        ...(work.governed ? limitedSharedAllowanceText(locale, work) : []),
    ];
    if (!hold) return settlementUnconfirmed
        ? [t('workRecovery.settlementUnconfirmed'), ...continuationGuidance] : continuationGuidance;
    const criteriaHold: WorkflowCriteriaHold | undefined = hold.kind === 'blocked' ? hold.workflowCriteriaHold : undefined;
    let reason: string;
    if (hold.kind === 'blocked') {
        const { roleRequestLimit, ...otherDiagnostics } = hold;
        const failure = modelContextPresentation(hold.modelContextFailure, work.workId, locale)?.title
            ?? roleRequestLimitPresentation(roleRequestLimit, work.workId, locale)?.summary
            ?? producerFailurePresentation({ workId: work.workId, ...otherDiagnostics }, locale)?.title;
        const preview = surface === 'work' ? truncateToWidth(plainTerminalText(hold.blocker ?? '').replace(/\s+/gu, ' ').trim(), 100, '…') : '';
        reason = work.activationPending ? t('workRecovery.activationPending') : criteriaHold ? t(`criteria.recovery.${criteriaHold}`)
            : failure ?? (preview ? t('workRecovery.blocker', {reason:preview}) : t('workRecovery.blocked'));
    } else {
        reason = t(hold.kind === 'settlement' ? 'workRecovery.settlementUnconfirmed' : 'workRecovery.guidanceUnavailable');
    }
    return [reason, ...(criteriaHold === 'unavailable' ? [t('criteria.recovery.unavailableAction')] : []),
        ...continuationGuidance, ...(surface === 'work' ? [t('workRecovery.readResult', {action:t('result.view')})] : [])];
}

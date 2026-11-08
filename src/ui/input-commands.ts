import { translator, type UiLocale } from './i18n.js';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { isDeepStrictEqual } from 'node:util';
import { showInspectionText, showReviewText, type ReviewPageHost } from './exact-review.js';
import { quoteText } from './inspection-text.js';
import { conversationStartupFailure, runtimeRepairAction } from './failure-details.js';
import type { Controller } from '../controller/controller.js';
import { inputDeliveryCheckStopped, type ConversationView } from '../controller/interaction-types.js';
import type { HostCommand, HostCommandContext, HostCommandOutcome } from './host-commands.js';
import { observeRecovery } from './recovery-navigation.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
export interface RetainedInputHost extends ReviewPageHost, UiChoiceHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    retry(target: string, input: RetainedInput, interruptedFingerprint?: string): Promise<void | boolean>;
    inputWithdrawn?(target: string, receipt: RetainedInput): void;
    configureRuntime?(target: string, focus?: HostCommandContext['runtimeSetupFocus']): Promise<boolean>;
    configureModel?(target: string, assertCurrent: () => void): Promise<boolean>;
    inspectWork(target: string, workId: string, context?: HostCommandContext): Promise<void | HostCommandOutcome>;
    notice(text: string, wrap?: boolean): void;
    locale?(target: string): UiLocale;
}
export type RetainedInput = ReturnType<Controller['inspectConversationInputs']>[number];
export type ReviewRetainedInput = (target: string, input: RetainedInput, context?: HostCommandContext) => Promise<HostCommandOutcome>;
type InterruptedContinuation = Awaited<ReturnType<Controller['inspectInterruptedConversationInputRetry']>>;
const inputPresentation = ({ fingerprint: _fingerprint, ...record }: RetainedInput) => record;

/** Identify the current held request for inspection. Retry still requires the original proof. */
export function interruptedOriginalInput(view: Pick<ConversationView, 'state' | 'workId'>, inputs: readonly RetainedInput[]) {
    if (view.state !== 'UNKNOWN' || !view.workId) return;
    const [input, another] = inputs.filter(row => row.state === 'RECONCILIATION_REQUIRED');
    if (!another && input?.workId === view.workId && input.runId && input.interruptedBoundary)
        return input;
}

export function inputDeliveryDiagnostic(reason: string, locale: UiLocale): string {
    return reason === inputDeliveryCheckStopped ? translator(locale)('input.deliveryCheckStopped') : reason;
}

/** Presentation of the Controller's current closed-role withdrawal proof, not admission. */
export function isClosedRoleFeedback(input: RetainedInput | undefined): boolean {
    return !!input && input.eligible && input.retryEligible === false && input.withdrawEligible === true && typeof input.workId === 'string' && !!input.workId;
}

function inputStatus(input: RetainedInput, continuation?: InterruptedContinuation) {
    if (continuation?.inputId === input.inputId)
        return continuation.state === 'exhausted' ? 'input.recoveryAllowanceRequired' : 'input.recoveryUnsent';
    if (input.waitDelivery) return 'input.recoveryWaitDelivery';
    if (isClosedRoleFeedback(input)) return 'input.recoveryFeedback';
    if (input.interruptedBoundary === 'captureChanged') return 'input.recoveryCaptureChanged';
    if (input.interruptedBoundary === 'protectionChanged') return 'input.recoveryBinding.protection';
    if (input.state === 'RECONCILIATION_REQUIRED') return 'input.recoveryReconciliation';
    if (input.legacyHistory === 'held') return 'input.recoveryLegacyHeld';
    if (input.legacyHistory && input.eligible) return 'input.recoveryUnsent';
    if (input.interrupted && input.eligible) return 'input.recoveryInterrupted';
    if (input.queuedDeliveryIssue) return 'input.recoveryQueuedDeliveryIssue';
    if (input.eligible) return 'input.recoveryUnsent';
    if (input.undispatched) return 'input.recoveryHeld';
    if (input.state === 'QUEUED') return 'input.recoveryQueued';
    return 'input.recoveryAwaiting';
}

export function inputCommands(host: RetainedInputHost): HostCommand[] {
    return [{ name: 'inputs', descriptionId: 'command.description.inputs',
        run: (_argument, target, context) => reviewConversationInputs(host, target, {context}) }];
}

export async function reviewConversationInputs(host: RetainedInputHost, target: string, {
    context, submittedFeedback, originalInput, blockedDraft = false,
}: {context?: HostCommandContext | undefined; submittedFeedback?: RetainedInput; originalInput?: RetainedInput; blockedDraft?: boolean} = {}): Promise<HostCommandOutcome> {
    const currentLocale = () => host.locale?.(target) ?? 'en';
    const locale = currentLocale();
    const t = translator(locale);
    const current = () => {
        if (!host.isCurrent(target))
            throw Error(t('input.recoveryTargetChanged'));
        if (currentLocale() !== locale)
            throw Error(t('input.recoveryLanguageChanged'));
    };
    const back = t('input.recoveryBack'), noChanges = t('input.recoveryBackUnchanged');
    const inspectContinuation = (inputs: readonly RetainedInput[]) => inputs.some(input => input.interruptedBoundary === 'sessionInput')
        ? host.controller.inspectInterruptedConversationInputRetry(target) : undefined;
    let withdrew = false;
    let completedAction = false;
    let focusedInput: string | undefined;
    const dismissal = () => completedAction ? 'completed' as const : 'cancelled' as const;
    let exactEntry = originalInput;
    let returnToReview: { input: RetainedInput; continuation: InterruptedContinuation } | undefined;
    while (true) {
        current();
        const inspectExactEntry = !submittedFeedback && !!exactEntry;
        let input = submittedFeedback ?? returnToReview?.input ?? exactEntry;
        let continuation = returnToReview?.continuation;
        returnToReview = undefined;
        exactEntry = undefined;
        if (!input) {
            if (originalInput)
                return dismissal();
            const inputs = observeRecovery(() => host.controller.inspectConversationInputs(target));
            if (!inputs) {
                const unavailable = t('input.recoveryListUnavailable');
                const refresh = t('input.recoveryRefresh');
                const title = blockedDraft ? unavailable + '\n' + t('input.recoveryBlockedDraft') : unavailable;
                const choice = await host.choose(title, [back, refresh]);
                current();
                if (choice === refresh)
                    continue;
                return dismissal();
            }
            continuation = await inspectContinuation(inputs);
            current();
            if (!inputs.length) {
                if (withdrew && blockedDraft)
                    host.notice(t('input.recoveryWithdrawnDraft'));
                else if (!completedAction)
                    host.notice(t('input.recoveryEmpty'));
                return 'completed';
            }
            const rows = inputs.map((input, i) => {
                const preview = stripTerminalSequences(input.text ?? t('input.recoveryRequest'))
                    .replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ').slice(0, 80);
                return { value: 'input:' + input.inputId, label: `${i + 1}. ${t(inputStatus(input, continuation))} · ${preview}` };
            });
            const selected = await chooseUiItem(host, t(blockedDraft ? 'input.recoveryBlockedDraft' : 'input.recoveryList'),
                [...rows, { value: 'back', label: back }], focusedInput);
            current();
            if (!selected || selected === 'back')
                return dismissal();
            input = inputs.find(row => 'input:' + row.inputId === selected);
            if (!input)
                throw Error(t('input.recoveryUnknown'));
            focusedInput = selected;
        }
        const reviewed = input;
        const diagnostic = reviewed.queuedDeliveryIssue ?? reviewed.failure;
        const previousFailure = reviewed.failure !== diagnostic ? reviewed.failure : undefined;
        const fresh = () => {
            current();
            const row = host.controller.inspectConversationInputs(target).find(row => row.inputId === reviewed.inputId);
            if (!row || row.fingerprint !== reviewed.fingerprint || row.failure !== reviewed.failure ||
                (submittedFeedback && (!isClosedRoleFeedback(reviewed) || !isClosedRoleFeedback(row))))
                throw Error(t('input.recoveryChanged'));
            return row;
        };
        fresh();
        if (inspectExactEntry) {
            continuation = await inspectContinuation([reviewed]);
            fresh();
        }
        if (continuation?.inputId !== reviewed.inputId)
            continuation = undefined;
        const refreshReview = async (keepRetryToken = false) => {
            current();
            const observed = continuation ? await inspectContinuation([reviewed]) : undefined;
            const input = fresh();
            if (continuation && (observed?.inputId !== input.inputId || observed.witness !== continuation.witness ||
                keepRetryToken && continuation.state === 'ready' && observed.state === 'ready' && observed.fingerprint !== continuation.fingerprint))
                throw Error(t('input.recoveryChanged'));
            return { input, continuation: observed };
        };
        const returnFromRecovery = async (applied: boolean, notice: 'input.recoveryWorkReturn' | 'input.recoverySettingsReturn', keepRetryToken = false) => {
            completedAction ||= applied;
            if (!host.isCurrent(target)) return;
            try {
                return await refreshReview(keepRetryToken);
            } catch (error) {
                if (!completedAction) throw error;
                if (host.isCurrent(target) && observeRecovery(currentLocale) === locale)
                    host.notice(t(applied ? notice : 'input.recoveryChanged'), true);
            }
        };
        const interruptedAllowance = continuation?.state === 'exhausted' ? continuation : undefined;
        const canContinue = continuation?.state === 'ready' ? continuation : undefined;
        const runtimeChanged = continuation?.state === 'runtime-changed' ? continuation : undefined;
        const feedback = isClosedRoleFeedback(input);
        const exhaustedWork = interruptedAllowance?.workId ?? input.exhaustedRetryWorkId;
        const canRetry = !exhaustedWork && (!!canContinue || input.eligible && input.retryEligible !== false);
        const configureRuntime = host.configureRuntime;
        const needsRuntime = () => !!configureRuntime && (!!runtimeChanged || canRetry &&
            !!host.controller.inspectConversation(target).projectId && !host.controller.options.runtimeProfile);
        const configureModel = host.configureModel;
        const needsModel = () => canRetry && !!configureModel && host.controller.canSelectFirstRetainedModel(target);
        const runtimeRepair = () => {
            if (!canRetry || !configureRuntime || !host.controller.options.runtimeProfile) return;
            const failure = host.controller.inspectConversationStartupFailure(target);
            if (!failure || failure.workId !== reviewed.workId || failure.runId !== reviewed.runId) return;
            const action = runtimeRepairAction(conversationStartupFailure(failure, locale).recoveryRoute);
            if (action) return { action, failure };
        };
        const focusedRepair = runtimeRepair();
        const scopeChanged = input.interruptedBoundary === 'captureChanged' || input.interruptedBoundary === 'protectionChanged';
        const verifiesProjectCapture = !!canContinue && !!host.controller.inspectConversation(target).projectId;
        const openActions = input.eligible || !!canContinue || !!interruptedAllowance || !!runtimeChanged && !!configureRuntime;
        const originalWork = !openActions &&
            (input.state === 'RECONCILIATION_REQUIRED' || input.legacyHistory === 'held') ? input.workId : undefined;
        const attemptedWork = exhaustedWork ?? ((input.interrupted || input.interruptedBoundary) ? input.workId : undefined);
        const directWork = input.blockingWorkIds.length === 0 ? originalWork : undefined;
        const workRoutes = input.blockingWorkIds.map(id => '/work ' + id);
        const next = exhaustedWork ? t('input.recoveryAllowanceNext') :
            runtimeChanged ? t('input.recoveryBinding.runtimeNext') : needsRuntime() ? t('input.recoveryRuntimeNext') :
            needsModel() ? t('input.recoveryModelNext') :
            focusedRepair ? t('input.recoveryRuntimeRepairNext', { action: t(focusedRepair.action.label) }) :
            input.waitDelivery ? t('input.recoveryWaitDeliveryNext') :
            canContinue ? t('input.recoveryPreDispatchNext') : feedback ? t('input.recoveryFeedbackNext') :
            input.legacyHistory === 'held' ? t('input.recoveryLegacyHeldNext') :
            input.legacyHistory && input.eligible ? t('input.recoveryLegacyNext') :
            input.interruptedBoundary ? t(`input.recoveryAbrupt.${input.interruptedBoundary}`) :
            input.eligible ? t(input.interrupted ? 'input.recoveryInterruptedNext' : 'input.recoveryRetryNext') :
            workRoutes.length ? t('input.recoveryBlockers', { routes: workRoutes.map(quoteText).join(' · ') }) :
            originalWork ? t('input.recoveryInspectOriginalNext') :
            t('input.recoveryInspectNext');
        const text = [
            t(inputStatus(input, continuation)),
            ...(input.lastInterruption ? [
                t(input.lastInterruption.modelAttemptRecorded ? 'input.recoveryAttemptRecorded' : 'input.recoveryNoAttemptRecorded'),
                t(input.lastInterruption.executionCharged ? 'input.recoveryAttemptCharged' : 'input.recoveryAttemptReleased'),
            ] : []),
            next,
            ...(openActions && attemptedWork ? [t('input.recoveryAttemptNext')] : []),
            ...(verifiesProjectCapture ? [t('input.recoveryPreDispatchCapture')] : []),
            `${t('input.recoveryDiagnostic')}\n${diagnostic ? quoteText(inputDeliveryDiagnostic(diagnostic, locale)) : t('input.recoveryNoFailure')}`,
            `${t('input.recoveryRequest')}\n${input.text === null ? '—' : quoteText(input.text)}`,
            ...(previousFailure ? [`${t('input.recoveryPreviousFailure')}\n${quoteText(previousFailure)}`] : []),
            `${t('input.recoveryDetails')}\n${canContinue || scopeChanged ? '' : quoteText(input.explanation) + '\n'}${t('input.recoveryReference', {
                input: quoteText(input.inputId), work: input.workId ? quoteText(input.workId) : '—',
                run: input.runId ? quoteText(input.runId) : '—',
            })}`,
        ].join('\n\n');
        const finish = directWork ? t('input.recoveryInspectOriginal') :
            openActions || input.blockingWorkIds.length ? t('input.recoveryOpenActions') : undefined;
        if (!finish) {
            await showInspectionText(host, t('input.recoveryReview'), text, fresh, t('input.recoveryNoAction'), locale, t('input.recoveryNextPage'));
            if (submittedFeedback)
                return 'cancelled';
            continue;
        }
        const proceed = await showReviewText(host, t('input.recoveryReview'), text, fresh, t('input.recoveryNoAction'), locale,
            { next: t('input.recoveryNextPage'), finish });
        if (!proceed) {
            if (submittedFeedback)
                return 'cancelled';
            continue;
        }
        if (!openActions) {
            if (directWork) {
                const outcome = await host.inspectWork(target, directWork, context);
                if (outcome !== 'cancelled' || !host.isCurrent(target))
                    return outcome === 'cancelled' ? dismissal() : outcome ?? 'completed';
                fresh();
            } else if (input.blockingWorkIds.length) {
                const routes = new Map(input.blockingWorkIds.map(id => [t('input.recoveryInspectWork', { id }), id]));
                if (originalWork && !input.blockingWorkIds.includes(originalWork))
                    routes.set(t('input.recoveryInspectOriginal') + ' · ' + originalWork, originalWork);
                while (true) {
                    const action = await host.choose(t('input.recoveryHeldMenu'), [noChanges, ...routes.keys()]);
                    fresh();
                    if (!action || action === noChanges)
                        break;
                    const id = routes.get(action);
                    if (!id)
                        throw Error(t('input.recoveryUnknownWork'));
                    const outcome = await host.inspectWork(target, id, context);
                    if (outcome !== 'cancelled' || !host.isCurrent(target))
                        return outcome === 'cancelled' ? dismissal() : outcome ?? 'completed';
                    fresh();
                }
            }
            returnToReview = { input: reviewed, continuation };
            continue;
        }
        const retry = t(canContinue ? 'input.recoveryPreDispatchRetry' : input.waitDelivery ? 'input.recoveryWaitDeliver' : 'input.recoveryRetry');
        const withdraw = t(feedback ? 'input.keepFeedback' : 'input.recoveryWithdraw');
        const repair = needsRuntime();
        const firstModel = !repair && needsModel();
        const nextAction = repair ? t('requestSetup.openRuntime') : firstModel ? t('input.recoveryChooseModel') : retry;
        const repairLabel = !repair && focusedRepair ? t(focusedRepair.action.label) : undefined;
        const title = t(exhaustedWork ? 'input.recoveryAllowanceRequired' : runtimeChanged ? 'input.recoveryBinding.runtime'
            : repair ? 'input.recoveryRuntimeRequired' : firstModel ? 'input.recoveryModelRequired' : feedback ? 'input.feedbackTitle' : 'input.recoveryChoose');
        const canWithdraw = !continuation && input.withdrawEligible !== false;
        const inspectAttempt = t(exhaustedWork ? 'input.recoveryReviewAllowance' : 'input.recoveryInspectOriginal');
        const action = await host.choose(title, [noChanges, ...(attemptedWork ? [inspectAttempt] : []), ...(repairLabel ? [repairLabel] : []), ...(canRetry || repair ? [nextAction] : []), ...(canWithdraw ? [withdraw] : [])]);
        const observed = continuation && action && action !== noChanges
            ? await refreshReview() : { input: fresh(), continuation };
        if (observed.input.exhaustedRetryWorkId !== input.exhaustedRetryWorkId ||
            !isDeepStrictEqual(observed.continuation, continuation)) {
            returnToReview = observed;
            continue;
        }
        if (attemptedWork && action === inspectAttempt) {
            const outcome = await host.inspectWork(target, attemptedWork, context);
            if (outcome === 'started') return outcome;
            returnToReview = await returnFromRecovery(outcome === 'completed', 'input.recoveryWorkReturn');
            if (!returnToReview) return dismissal();
            continue;
        }
        if (!feedback && (!action || action === noChanges)) {
            returnToReview = { input: reviewed, continuation };
            continue;
        }
        const selectedRepair = repairLabel && action === repairLabel ? focusedRepair : undefined;
        if (firstModel && action === nextAction) {
            const assertSelection = () => {
                fresh();
                if (needsRuntime() || !needsModel())
                    throw Error(t('input.recoveryChanged'));
            };
            assertSelection();
            const source = host.controller.inspectConversation(target);
            const modelRevision = host.controller.getConversationModelChoice(target).revision;
            const languageRevision = host.controller.getConversationLanguage(target).revision;
            const retained = host.controller.inspectConversationInputs(target).map(inputPresentation);
            if (await configureModel!(target, assertSelection)) {
                completedAction = true;
                try {
                    const now = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
                    if (!host.isCurrent(target) || currentLocale() !== locale || now.generation !== source.generation ||
                        now.projectId !== source.projectId || now.workId !== source.workId || now.role !== source.role ||
                        now.parentId !== source.parentId || now.state !== 'IDLE' || now.inputNeeded || now.archived || now.deleted ||
                        host.controller.getConversationLanguage(target).revision !== languageRevision ||
                        choice.kind !== 'managed' || choice.revision !== modelRevision + 1)
                        return dismissal();
                    const pending = host.controller.inspectConversationInputs(target);
                    const refreshed = pending.find(row => row.inputId === reviewed.inputId);
                    // This comparison routes to a new read-only review. The old fingerprint is spent.
                    if (!refreshed || !isDeepStrictEqual(pending.map(inputPresentation), retained))
                        return dismissal();
                    returnToReview = { input: refreshed, continuation: undefined };
                } catch {
                    // The settings command completed even if the optional return path is unavailable.
                    return dismissal();
                }
                host.notice(t('model.selected'));
            } else {
                assertSelection();
                returnToReview = { input, continuation: canContinue };
            }
            continue;
        }
        if (selectedRepair || (canRetry || repair) && action === nextAction) {
            const runtimeRequired = needsRuntime();
            if (selectedRepair || repair || runtimeRequired) {
                let applied = false;
                if (selectedRepair) {
                    if (!isDeepStrictEqual(runtimeRepair(), selectedRepair))
                        throw Error(t('input.recoveryChanged'));
                    applied = !!await configureRuntime?.(target, selectedRepair.action.focus);
                } else if (repair && runtimeRequired && configureRuntime) {
                    applied = await configureRuntime(target);
                }
                returnToReview = await returnFromRecovery(applied, 'input.recoverySettingsReturn', true);
                if (!returnToReview) return dismissal();
                continue;
            }
            if (await host.retry(target, input, canContinue?.fingerprint) === false)
                return dismissal();
            context?.acknowledgeSubmission?.();
            return 'started';
        }
        if (action === withdraw) {
            const feedbackGeneration = feedback ? host.controller.inspectConversation(target).generation : undefined;
            const receipt = host.controller.recoverConversationInput({ conversationId: target, inputId: input.inputId, expectedContext: input.fingerprint, action: 'withdraw' });
            if (feedback) {
                const work = receipt.workId!;
                const assertFeedbackFocus = () => {
                    if (!host.isCurrent(target) || currentLocale() !== locale)
                        throw Error(t('input.feedbackWorkSourceChanged'));
                };
                try {
                    context?.acknowledgeSubmission?.();
                    assertFeedbackFocus();
                    host.notice(t('input.feedbackKept', { work }));
                    assertFeedbackFocus();
                    const source = host.controller.inspectConversation(target);
                    if (source.generation !== feedbackGeneration || source.workId !== work || source.archived || source.deleted)
                        throw Error(t('input.feedbackWorkSourceChanged'));
                    const inspection = await host.inspectWork(target, work, context);
                    return inspection === 'started' ? 'started' : 'completed';
                } catch (error) {
                    const reason = error instanceof Error && error.message ? '\n\n' + error.message : '';
                    throw Object.assign(Error(t('input.feedbackWorkStopped', { work }) + reason, { cause: error }), { workId: work });
                }
            }
            host.inputWithdrawn?.(target, receipt);
            withdrew = true;
            completedAction = true;
            host.notice(t('input.recoveryWithdrawn'));
        }
        if (submittedFeedback) return 'cancelled';
    }
}

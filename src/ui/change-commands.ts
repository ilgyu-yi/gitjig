import { matchesExternalModel } from '../controller/model-choice.js';
import { isDeepStrictEqual } from 'node:util';
import { stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui';
import { modelContextPresentation } from './model-context-presentation.js';
import { producerFailurePresentation } from './planning-failure-presentation.js';
import type { Controller } from '../controller/controller.js';
import type { ApplicationModels } from '../app/models.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { PiModelSelection } from '../pi/session.js';
import type { ChangeView } from '../controller/change-types.js';
import { isWorkSettlementUnconfirmed, managedStartExecutionHold } from '../controller/work-recovery.js';
import type { HostCommand, HostCommandContext, HostCommandExecutor, HostCommandOutcome } from './host-commands.js';
import { captureResultDelivery } from './result-delivery.js';
import { ContextAssignmentUnavailable } from '../controller/context-coordination.js';
import { inspectDepletedContinuationAllowance, workAllowanceText } from './work-allowance-presentation.js';
import { workflowCriteriaNextAction } from './criteria-refresh.js';
import { changeCaseValuesText, changeResultText, scopeFailureText, showsAcceptedPlan, showsCaseComparison, showsPendingResultFollowup } from './change-result.js';
import { showInspectionText, showReviewAction, showReviewText, type ReviewPageHost } from './exact-review.js';
import { translator, uiText, type UiLocale } from './i18n.js';
import { conversationDisplayIdentity, plainTerminalText } from './chrome.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { noticeResultPresentation, recordedGovernedOutcome } from './notice-result.js';
import { delegatedStopText, delegatedWaitStatus, recordedDelegatedEvidence, stoppedDelegatedWaitTargets, type DelegatedStop } from './recorded-delegated-result.js';
import { escapeDisplayControls, escapeJsonControls, quoteText } from './inspection-text.js';
import { ProjectSourceError, readProjectSource, type ProjectSourceIdentity } from './project-source.js';
import { ownerActivationGuidance } from './startup-guidance.js';
import { inspectWorkResumeEntry, workOriginLifecycle } from './work-resume-entry.js';
import { inspectOriginalPrerequisites, workOriginGuidance, workRecoveryGuidance } from './work-recovery-guidance.js';
import { ApplicationStartup } from '../app/startup.js';
import { observeRecovery } from './recovery-navigation.js';
import { acceptsSingleLineInput } from './product-input.js';
interface ChangeHost extends UiChoiceHost, ReviewPageHost {
    execute?: HostCommandExecutor;
    controller: Controller;
    isCurrent(target: string): boolean;
    locale?(target: string): UiLocale;
    controls?: {
        models?: ApplicationModels;
        accounts?: ApplicationAccounts;
        model?: PiModelSelection;
        input(title: string, value: string, description?: string): Promise<string | undefined>;
        draft(target: string): string;
        notice(text: string): void;
        prepareProjectSourceCheck?(target: string): (() => void) | undefined;
        activateSource(target: string): Promise<void>;
        activateDelegatedReply?(target: string, source: string): Promise<void>;
        activateDelegatedReview?(target: string, source: string): Promise<void>;
        launch(target: string, task: Promise<ChangeView>, workId?: string, submission?: HostCommandContext['submission']): void;
    };
}
type ResultHost = Omit<ChangeHost, 'controls'> & {
    controls?: Pick<NonNullable<ChangeHost['controls']>, 'activateSource' | 'activateDelegatedReply' | 'notice'>;
};

/** Read and route one exact recorded result without nesting its containing work menu. */
export async function reviewChangeResult(host: ResultHost, id: string, target: string, sourceGuard: () => void, {
    context, fromWork = false, capture, explicitId = false, delegatedPlanning = false,
}: { context?: HostCommandContext | undefined; fromWork?: boolean; capture?: ReturnType<typeof captureResultDelivery>; explicitId?: boolean;
    delegatedPlanning?: boolean } = {}) {
    const locale = host.locale?.(target) ?? 'en', t = translator(locale);
    let captured = capture;
    try {
        captured ??= captureResultDelivery(host.controller, id, { checkStderr: true, locale });
    } catch (error) {
        if (explicitId && observeRecovery(() => Boolean(host.controller.inspectChangeActivity(id))) === false)
            throw error;
    }
    if (!captured) {
        sourceGuard();
        await host.show(t('result.workUnavailable', { work: escapeDisplayControls(id) }), t('result.workUnavailableBody'));
        sourceGuard();
        return 'cancelled';
    }
    if (captured.workId !== id)
        throw Error(t('result.changed'));
    const { execute, controls } = host;
    const acceptedPlan = showsAcceptedPlan(captured.result);
    const pendingFollowup = execute && controls && showsPendingResultFollowup(captured.result);
    const resumable = !captured.result.reviewReady && !captured.result.workflowCriteriaHold &&
        ['ACTIVE', 'BLOCKED', 'INTERRUPTED'].includes(captured.result.state);
    const inspectContinuation = () => {
        if (pendingFollowup) {
            const work = host.controller.inspectWorkRecovery(id);
            const entry = inspectWorkResumeEntry(host.controller, work, true);
            return { live: entry.live, allowanceHold: entry.allowanceHold,
                heldResumeAvailable: work.state === 'DELIVERED' && entry.resumeAvailable,
                originLifecycle: workOriginLifecycle(entry.origin) };
        }
        const live = resumable && host.controller.hasLiveChangeOperation(id);
        const allowanceHold = resumable && !live
            ? inspectDepletedContinuationAllowance(host.controller, id, captured.result.sharedAllowance) : undefined;
        return { live, allowanceHold };
    };
    const continuation = inspectContinuation();
    const fresh = () => {
        sourceGuard();
        captured.assertCurrent();
        if (!isDeepStrictEqual(inspectContinuation(), continuation))
            throw Error(t('result.changed'));
    };
    const comparisonAvailable = showsCaseComparison(captured.result);
    const replyTarget = captured.result.planningClarification?.reply?.conversationId;
    const item = (value: string, label: string) => ({ value, label });
    const openWork = item('/work ' + id, t('result.recovery'));
    const deliveryActions = execute && captured.result.reviewReady ? [
        item('/save ' + id, t('result.saveBranch')), item('/repo deliver ' + id, t('result.reviewDelivery')),
    ] : [];
    const saveHistory = execute &&
        host.controller.listSourceSnapshotOperations({workId: id, limit: 1}).operations.length
        ? item('/save history ' + id, t('save.workHistory')) : undefined;
    const deliveryHistory = execute &&
        host.controller.listIntegrations({workId: id, limit: 1}).operations.length
        ? item('/repo deliver ' + id + ' history', t('result.deliveryHistory')) : undefined;
    const reply = item('reply', t('result.planningClarificationReply'));
    const canReply = () => !!controls && !!replyTarget && !host.controller.getNativeHandle(replyTarget);
    const actions = () => delegatedPlanning && execute ? [...(canReply() ? [reply] : []), openWork] : [
        ...(comparisonAvailable
            ? [item('case-values', t('result.check.caseValuesAction'))] : []),
        ...(execute ? [
            ...(canReply() ? [reply] : []),
            ...deliveryActions,
            ...(saveHistory ? [saveHistory] : []),
            ...(deliveryHistory ? [deliveryHistory] : []),
            ...(controls && !continuation.live && captured.result.replanKind
                ? [item('/change replan ' + id, t(`change.${captured.result.replanKind}ReplanAction`))] : []),
            ...(controls && (continuation.heldResumeAvailable || acceptedPlan && !continuation.live && !continuation.allowanceHold)
                ? [item('/change resume ' + id, t('result.reviewResume'))] : []),
            ...(!fromWork ? [openWork] : []),
        ] : []),
    ];
    const soleWorkInspection = (available: ReturnType<typeof actions>) =>
        !acceptedPlan && available.length === 1 && available[0] === openWork;
    const position = { scrollTop: 0 };
    while (true) {
        fresh();
        const offered = actions();
        const directRecovery = soleWorkInspection(offered);
        const text = changeResultText(captured.result, locale, fromWork, comparisonAvailable, {
            ...continuation,
            directRecovery, deliveryAvailable: deliveryActions.length > 0, saveHistoryAvailable: !!saveHistory,
            deliveryHistoryAvailable: !!deliveryHistory,
        });
        let openActions = false;
        await host.show(t('result.title'), text, offered.length ? {
            label: directRecovery ? openWork.label : t('result.openActions'),
            run: async () => { openActions = true; },
        } : undefined, position);
        if (!openActions)
            return;
        fresh();
        const available = actions();
        if (!available.length || directRecovery && !soleWorkInspection(available))
            continue;
        const action = directRecovery ? openWork.value :
            await chooseUiItem(host, t('result.nextTitle') + '\n' + t('result.nextScope', { work: id, project: captured.projectId }),
                [item('back', t('result.returnToResult')), ...available]);
        fresh();
        if (!action || action === 'back')
            continue;
        if (action === 'case-values') {
            const details = captureResultDelivery(host.controller, id, { caseValues: true, locale });
            fresh();
            details.assertCurrent();
            await host.show(t('result.check.caseValuesAction'), changeCaseValuesText(details.result, locale), {
                label: t('result.returnToResult'),
                run: async () => { details.assertCurrent(); },
            });
            continue;
        }
        if (!execute)
            return;
        if (action === 'reply') {
            if (!replyTarget || !controls || host.controller.getNativeHandle(replyTarget))
                throw Error(t('result.planningClarificationReplyChanged'));
            if (delegatedPlanning && controls.activateDelegatedReply) await controls.activateDelegatedReply(replyTarget, target);
            else await controls.activateSource(replyTarget);
            captured.assertCurrent();
            if (!host.isCurrent(replyTarget) || host.controller.getNativeHandle(replyTarget))
                throw Error(t('result.planningClarificationReplyChanged'));
            const replyLocale = host.locale?.(replyTarget) ?? locale;
            controls.notice(uiText(replyLocale, 'result.planningClarificationReplyHint', { action: uiText(replyLocale, 'input.keepFeedback') }));
            return 'completed';
        }
        const outcome = await execute(action, target, context);
        if (outcome !== 'cancelled' || !host.isCurrent(target))
            return outcome;
    }
}

/** Inspection is read-only; execution requires a separate, snapshot-bound owner action. */
function parseChangeArgument(argument: string) {
    if (argument === 'result --delegated')
        return { kind: 'browse' as const, action: 'result' as const, delegatedOnly: true };
    const match = /^(result|inspect|resume|replan|cancel)\s+(\S+)$/u.exec(argument);
    if (match)
        return { kind: 'work' as const, action: match[1] as 'result' | 'inspect' | 'resume' | 'replan' | 'cancel', workId: match[2]! };
    const beginning = /^start(?:\s+([\s\S]+))?$/u.exec(argument);
    if (beginning)
        return { kind: 'start' as const, request: beginning[1] };
    if (argument === 'result' || argument === 'resume' || argument === 'cancel' || !argument)
        return { kind: 'browse' as const, action: (argument || 'inspect') as 'inspect' | 'result' | 'resume' | 'cancel' };
}

export function changeCommands(host: ChangeHost): HostCommand[] {
    const delegatedResult = async (target: string, sourceGuard: () => void, locale: UiLocale, context?: HostCommandContext, showEmpty = false): Promise<HostCommandOutcome | 'registry' | undefined> => {
        const read = () => host.controller.inspectRecordedDelegatedResults(target);
        const readWait = () => observeRecovery(() => host.controller.inspectConversationWait(target));
        const t = translator(locale), execute = host.execute;
        const recommended = showEmpty ? context?.delegatedRecovery : undefined;
        type Entry = ReturnType<typeof read>['entries'][number];
        type CoordinatorRoute = NonNullable<ReturnType<typeof read>['descendantCoordinatorRoutes']>[string];
        const coordinatorRoute = (resultId: string) => observeRecovery(read)?.descendantCoordinatorRoutes?.[resultId];
        const samePublication = (entry: Entry, chosen: Entry) =>
            entry.resultId === chosen.resultId && entry.assignmentId === chosen.assignmentId &&
            entry.conversationId === chosen.conversationId && entry.workId === chosen.workId &&
            entry.publicationHash === chosen.publicationHash && entry.assignmentProof === chosen.assignmentProof;
        const inspectSetup = (entry: Pick<Entry, 'workId' | 'conversationId'>) => observeRecovery(() => {
            const work = host.controller.inspectWorkRecovery(entry.workId);
            if (work.workId !== entry.workId || work.conversationId !== entry.conversationId) return;
            const resume = inspectWorkResumeEntry(host.controller, work, !!execute);
            return inspectOriginalPrerequisites({controller:host.controller, ...host.controls, ...host.controls?.model
                ? {externalModel:host.controls.model} : {}}, work, resume, locale);
        });
        const currentWorkGuidance = (entry: Pick<Entry, 'workId' | 'conversationId'>) => observeRecovery(() => {
            const work = host.controller.inspectWorkRecovery(entry.workId);
            if (work.workId !== entry.workId || work.conversationId !== entry.conversationId) return;
            const { allowanceHold, live, origin, originBlocked } = inspectWorkResumeEntry(host.controller, work, !!execute);
            const originGuidance = workOriginGuidance(work, origin, originBlocked, locale);
            return [t('delegated.currentWork', { state: work.state }), ...(originGuidance ? [originGuidance] : []),
                ...workRecoveryGuidance(work, locale, allowanceHold, live, 'delegated-result')];
        });
        const visitAccountBlocker = (setup: ReturnType<typeof inspectSetup>) => {
            const blocker = setup?.accountBlocker;
            return blocker?.kind === 'conversation' && blocker.conversationId !== target && host.controls?.activateDelegatedReview
                ? blocker : undefined;
        };
        const openOriginal = async (entry: Pick<Entry, 'workId' | 'conversationId'>, command: string, fresh: () => unknown,
            setup: ReturnType<typeof inspectSetup>, route?: CoordinatorRoute & {resultId: string}) => {
            if (!execute) return 'cancelled';
            const accountBlocker = visitAccountBlocker(setup);
            if (!setup?.needsRuntime && !route && !accountBlocker) return execute(command, target, context);
            const choices = [{value:'back',label:t('result.back')},{value:command,label:t('notice.inspectOriginal')},
                ...(route ? [{value:'coordinator',label:t('delegated.openCoordinator')}] : []),
                ...(accountBlocker ? [{value:'account-blocker',label:t('delegated.openAccountBlocker')}] : []),
                ...(setup?.needsRuntime ? [{value:'/setup runtime',label:t('delegated.openRuntime')}] : [])];
            const action = await chooseUiItem(host, t('delegated.ownerActions'), choices);
            if (!action || action === 'back') return 'cancelled';
            if (action === command) {
                fresh();
                return execute(command, target, context);
            }
            if (action === 'coordinator' && route && host.controls?.activateDelegatedReview) {
                fresh();
                const latest = coordinatorRoute(route.resultId);
                if (latest?.proof !== route.proof || latest.conversationId !== route.conversationId)
                    throw Error(t('delegated.resultChanged'));
                await host.controls.activateDelegatedReview(route.conversationId, target);
                return 'completed';
            }
            const guard = () => {
                fresh();
                if (!isDeepStrictEqual(setup, inspectSetup(entry))) throw Error(t('delegated.resultChanged'));
            };
            if (action === 'account-blocker' && accountBlocker && host.controls?.activateDelegatedReview) {
                guard();
                await host.controls.activateDelegatedReview(accountBlocker.conversationId, target);
                return 'completed';
            }
            if (action !== '/setup runtime') return 'cancelled';
            guard();
            const startup = await ApplicationStartup.open(host.controller).captureInspection();
            guard();
            const delegatedSetupGuard = () => {
                guard();
                if (!startup.isCurrent()) throw Error(t('delegated.resultChanged'));
            };
            await execute('/setup runtime', target, {delegatedSetupGuard});
            fresh();
            return 'cancelled';
        };
        const reviewPlanningQuestion = async (entry: Entry | Extract<DelegatedStop, {stop: string}>, fresh: () => unknown) => {
            if (!entry.planningQuestion || !host.controller.hasCurrentDelegatedPlanningQuestion(entry))
                return undefined;
            const guard = () => {
                fresh();
                if (!host.controller.hasCurrentDelegatedPlanningQuestion(entry)) throw Error(t('delegated.resultChanged'));
            };
            guard();
            const capture = captureResultDelivery(host.controller, entry.workId, {checkStderr:true, locale});
            if (capture.result.planningClarification?.outputId !== entry.planningQuestion.outputId)
                throw Error(t('delegated.resultChanged'));
            return await reviewChangeResult(host, entry.workId, target, guard, {context, capture, delegatedPlanning:true}) ?? 'cancelled';
        };
        const inspect = async (chosen: Entry): Promise<HostCommandOutcome | undefined> => {
            const fresh = () => {
                sourceGuard();
                if (!(recommended ? recommended.isCurrent() : observeRecovery(read)?.entries.some(entry => samePublication(entry, chosen))))
                    throw Error(t('delegated.resultChanged'));
                const publication = host.controller.inspectConversationResult(chosen.resultId);
                if (publication.workId !== chosen.workId || publication.conversationId !== chosen.conversationId ||
                    publication.assignmentId !== chosen.assignmentId || publication.publicationHash !== chosen.publicationHash)
                    throw Error(t('delegated.resultChanged'));
                return publication;
            };
            const clarification = recommended ? await reviewPlanningQuestion(chosen, fresh) : undefined;
            if (clarification) return clarification;
            const position = { scrollTop: 0 };
            while (true) {
                const {text: recorded, command} = noticeResultPresentation(fresh(), locale);
                const setup = !chosen.reviewReady && chosen.phase === 'BLOCKED' && !chosen.uncertain ? inspectSetup(chosen) : undefined;
                const needsGuidance = !chosen.reviewReady && (chosen.phase === 'BLOCKED' || chosen.uncertain);
                const current = needsGuidance ? currentWorkGuidance(chosen) : undefined;
                const guidance = current ? [...current, ...(setup?.directions ?? []), t('delegated.currentNext'),
                    ...(!chosen.uncertain ? [t('delegated.askCoordinator')] : [])]
                    : needsGuidance ? [t('workRecovery.guidanceUnavailable'), t('delegated.currentNext')] : [];
                const text = [
                    ...(chosen.instructionPreview ? [t('delegated.originalRequest', { request: quoteText(chosen.instructionPreview) })] : []),
                    ...(guidance.length ? [t('delegated.assignmentIdentity', {id: chosen.assignmentId})] : []),
                    ...guidance,
                    ...(guidance.length ? [t('delegated.recordedStop')] : []),
                    ...recordedDelegatedEvidence(chosen, locale, false), recorded,
                ].join('\n');
                const title = t('delegated.resultTitle');
                if (!execute || !command) {
                    await host.show(title, text, undefined, position);
                    return;
                }
                if (!await showReviewAction(host, title, text, t(setup?.needsRuntime || visitAccountBlocker(setup) ? 'result.openActions' : 'notice.inspectOriginal'), position))
                    return;
                fresh();
                const outcome = await reviewPlanningQuestion(chosen, fresh) ?? await openOriginal(chosen, command, fresh, setup);
                if (outcome !== 'cancelled' || !host.isCurrent(target))
                    return outcome;
            }
        };
        const inspectFailure = async (failed: DelegatedStop): Promise<HostCommandOutcome | undefined> => {
            const assertFailure = () => {
                sourceGuard();
                const latest = recommended ? undefined : observeRecovery(read);
                const stops = 'stop' in failed ? latest?.descendantStops : latest?.requestFailures;
                if (!(recommended ? recommended.isCurrent() : stops?.some(entry => isDeepStrictEqual(entry, failed))))
                    throw Error(t('delegated.resultChanged'));
            };
            if (recommended && 'stop' in failed) {
                const clarification = await reviewPlanningQuestion(failed, assertFailure);
                if (clarification) return clarification;
            }
            const {label: title, details: text} = delegatedStopText(failed, locale);
            const position = { scrollTop: 0 };
            while (true) {
                assertFailure();
                const route = host.controls?.activateDelegatedReview ? coordinatorRoute(failed.resultId) : undefined;
                const assigningView = route && observeRecovery(() => host.controller.inspectConversation(route.conversationId));
                const assigningName = assigningView && conversationDisplayIdentity(assigningView);
                const setup = 'stop' in failed && failed.stop === 'blocked' ? inspectSetup(failed) : undefined;
                const recorded = 'stop' in failed ? [
                    t('delegated.assignmentIdentity', {id: failed.assignmentId}), ...(currentWorkGuidance(failed) ?? [t('workRecovery.guidanceUnavailable')]),
                    ...(setup?.directions ?? []), t('delegated.currentNext'),
                    ...(text ? [t('delegated.recordedStop'), text] : []),
                ].join('\n') : text;
                const detail = [recorded, ...(route ? [t('delegated.originalCoordinator', {id:escapeDisplayControls(assigningName || route.conversationId)})]
                    : failed.waitAssignmentId ? [t('delegated.coordinatorUnavailable')] : [])].filter(Boolean).join('\n');
                if (!execute) {
                    await host.show(title, detail);
                    return 'completed';
                }
                const hasActions = route || setup?.needsRuntime || visitAccountBlocker(setup);
                if (!await showReviewAction(host, title, detail, t(hasActions ? 'result.openActions' : 'notice.inspectOriginal'), position)) return;
                assertFailure();
                const clarification = 'stop' in failed ? await reviewPlanningQuestion(failed, assertFailure) : undefined;
                const outcome = clarification ?? await openOriginal(failed, '/work ' + failed.workId, assertFailure, setup,
                    route ? {...route, resultId:failed.resultId} : undefined);
                if (hasActions && outcome === 'cancelled' && host.isCurrent(target)) continue;
                if (clarification === 'cancelled' && host.isCurrent(target)) continue;
                if (!recommended || outcome !== 'cancelled' || !host.isCurrent(target))
                    return outcome;
            }
        };
        if (recommended) {
            const {record} = recommended;
            const outcome = await ('assignmentProof' in record ? inspect(record) : inspectFailure(record));
            return outcome ?? 'cancelled';
        }
        let focused: Entry | undefined;
        while (host.isCurrent(target)) {
            sourceGuard();
            const view = observeRecovery(read);
            const entries = view?.entries ?? [];
            const failures = [...(view?.requestFailures ?? []), ...(view?.descendantStops ?? [])];
            const wait = readWait();
            const hasCurrentResult = (item: ReturnType<typeof stoppedDelegatedWaitTargets>[number]) =>
                [...entries, ...failures].some(result => result.assignmentId === item.assignmentId &&
                    result.conversationId === item.conversationId && result.workId === item.workId && result.resultId === item.resultId);
            const stops = stoppedDelegatedWaitTargets(wait,view).filter(item => item.cleanupUnconfirmed || !hasCurrentResult(item));
            const readWork = (id: string) => observeRecovery(() => host.controller.inspectDelegatedWaitWork(target, id));
            const originals = new Map(stops.map(item => [item.assignmentId, readWork(item.assignmentId)]));
            const hasChoices = entries.length || failures.length || stops.length;
            if (!showEmpty && view && !hasChoices && !view.unavailable && !view.omitted && !view.waitReviewUnavailable)
                return focused ? 'cancelled' : undefined;
            const warning = !view ? t('delegated.listUnavailable') : view.unavailable ? t('delegated.unavailable')
                : !hasChoices && !view.omitted && !view.waitReviewUnavailable ? t('delegated.empty') : undefined;
            const waitUnavailable = view?.waitReviewUnavailable;
            const title = [t('delegated.resultsTitle'), ...(waitUnavailable ? [t('delegated.waitUnverified')] : []), ...(warning ? [warning] : []),
                ...(view?.omitted ? [t('delegated.more')] : [])].join('\n');
            const choices = entries.map((entry, index) => {
                const prefix = entry.assignmentId.slice(0, 8);
                const shared = entries.some(other => other !== entry && other.assignmentId.startsWith(prefix));
                const instruction = stripTerminalSequences(truncateToWidth(plainTerminalText(entry.instructionPreview).replace(/\s+/gu, ' ').trim(), 34, '…'));
                const outcome = recordedGovernedOutcome(entry.phase, entry.reviewReady, entry.uncertain, locale);
                const label = `#${prefix}${shared ? '/' + (index + 1) : ''} · ${instruction ? instruction + ' · ' : ''}${outcome}`;
                return {value: entry.resultId, label};
            });
            const initialValue = entries.find(entry => focused && samePublication(entry, focused))?.resultId;
            const picked = await chooseUiItem(host, title, [{value: 'back', label: t('result.back')},
                ...(waitUnavailable ? [{value: 'wait-unverified', label: t('delegated.waitUnverifiedAction')}] : []),
                ...stops.map(item => ({value: 'wait:' + item.assignmentId,
                    label: delegatedWaitStatus(item, locale) + ' · #' + escapeDisplayControls(item.assignmentId)})),
                ...failures.map(entry => ({value: 'failure:' + entry.resultId, label: delegatedStopText(entry, locale).label})),
                ...choices, {value: 'registry', label: t('delegated.browseChanges')}], initialValue);
            sourceGuard();
            if (picked === 'registry') return 'registry';
            if (!picked || picked === 'back') return 'cancelled';
            if (picked === 'wait-unverified') {
                if (!observeRecovery(read)?.waitReviewUnavailable) throw Error(t('delegated.resultChanged'));
                await host.show(t('delegated.waitUnverified'), [
                    t('delegated.waitUnverifiedRecheck'), t('delegated.waitUnverifiedSupport'), escapeDisplayControls(target),
                ].join('\n'));
                continue;
            }
            const stopped = stops.find(item => 'wait:' + item.assignmentId === picked);
            if (stopped) {
                const assertWait = () => {
                    sourceGuard();
                    if (!isDeepStrictEqual(wait, readWait())) throw Error(t('delegated.resultChanged'));
                };
                assertWait();
                const original = originals.get(stopped.assignmentId);
                const assertOriginal = () => {
                    if (!isDeepStrictEqual(original, readWork(stopped.assignmentId))) throw Error(t('delegated.resultChanged'));
                };
                assertOriginal();
                const heading = delegatedWaitStatus(stopped, locale);
                const details = [
                    t('delegated.assignmentIdentity', {id: escapeDisplayControls(stopped.assignmentId)}),
                    ...(original?.cancellation ? [t('delegated.ownerCancellation')] : []),
                    ...(original?.launchFailed ? [t('delegated.launchFailed')] : []),
                    ...(!hasCurrentResult(stopped) ? [t('delegated.waitWithoutResult')] : []),
                    ...(original?.cleanupUnconfirmed && !stopped.cleanupUnconfirmed ? [t('workRecovery.settlementUnconfirmed')] : []),
                    t(original ? 'delegated.currentNext' : 'delegated.waitWorkUnavailable'),
                    ...(!original ? [t('delegated.supportConversation', {id:escapeDisplayControls(target)})] : []),
                ].join('\n');
                if (!original || !execute) {
                    await host.show(heading, details);
                    continue;
                }
                if (!await showReviewAction(host, heading, details, t('notice.inspectOriginal'))) continue;
                assertWait();
                assertOriginal();
                const outcome = await execute('/work ' + original.workId, target, context);
                if (outcome !== 'cancelled') return outcome;
                continue;
            }
            const failed = failures.find(entry => 'failure:' + entry.resultId === picked);
            if (failed) {
                const outcome = await inspectFailure(failed);
                if (outcome && outcome !== 'cancelled') return outcome;
                continue;
            }
            const chosen = entries.find(entry => entry.resultId === picked)!;
            focused = chosen;
            const outcome = await inspect(chosen);
            if (outcome) return outcome;
        }
        return 'cancelled';
    };
    const readAssessment = (id: string) => {
        try { return { change: host.controller.inspectChange(id) }; }
        catch (error) {
            // A failed corroborating read cannot justify treating the original as a known hold.
            try {
                if (host.controller.inspectWorkRecovery(id).recoveryHold?.kind === 'unavailable')
                    return { error };
            } catch { /* Preserve the original error below. */ }
            throw error;
        }
    };
    const readRetainedResult = (id: string, locale: UiLocale, assessmentError: unknown) => {
        try { return captureResultDelivery(host.controller, id, { checkStderr: true, locale }); }
        catch { throw assessmentError; }
    };
    const inspect = async (id: string, target: string, guard: () => void, locale: UiLocale) => {
        const t = translator(locale);
        const { change, error } = readAssessment(id);
        if (!change) {
            const capture = readRetainedResult(id, locale, error);
            const { execute: _execute, controls: _controls, ...reader } = host;
            await reviewChangeResult(reader, id, target, guard, { capture });
            return;
        }
        const work = host.controller.inspectWork(id), baseline = host.controller.getWorkApplicationModelBaseline(id);
        const request = work.source as { raw?: string };
        const display = (text: string, limit: number) => {
            const safe = text.split('\n').map(escapeDisplayControls).join('\n');
            return safe.length <= limit ? safe : safe.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '') + '\n' + t('workRecovery.shortened');
        };
        const settlementHeld = isWorkSettlementUnconfirmed(work.state);
        const live = host.controller.hasLiveChangeOperation(id);
        const criteria = change.workflowCriteriaHold;
        const allowanceHold = !settlementHeld && !criteria && !live && change.ownerActivation !== 'pending' &&
            ['ACTIVE', 'BLOCKED', 'INTERRUPTED', 'CANCELLED'].includes(work.state)
            ? inspectDepletedContinuationAllowance(host.controller, id, change) : undefined;
        const currentHold = settlementHeld ? t('workRecovery.settlementUnconfirmed')
            : change.ownerActivation === 'pending' ? t('task.change.activation')
            : criteria ? [t(`criteria.recovery.${criteria}`), workflowCriteriaNextAction(locale, criteria, id)].join('\n')
            : live ? t('workRecovery.live')
            : allowanceHold ? t(`managedRepair.allowance.${allowanceHold}`, {command: '/work ' + id}) : undefined;
        const context = modelContextPresentation(change.modelContextFailure, id, locale)
            ?? producerFailurePresentation(change, locale);
        const failure = change.scopeFailure ? scopeFailureText(change.scopeFailure, id, locale, false) : context?.details;
        const text = [
            t('change.inspectIdentity', {id, project: work.projectId ?? t('value.none'), state: work.state,
                activation: change.ownerActivation, phase: change.phase}),
            ...(change.recordedPhase && change.recordedPhase !== change.phase ? [t('change.inspectRecorded', {phase: change.recordedPhase})] : []),
            ...(currentHold ? [currentHold] : []),
            t('change.inspectRecovery', {id}),
            ...(failure ? [failure] : []),
            t(change.reviewReady ? 'result.ready' : 'result.attention'),
            t('change.inspectModel', {
                model: baseline ? baseline.choice.provider + '/' + baseline.choice.modelId + ' · ' + baseline.choice.thinkingLevel : t('change.externalRequired'),
                origin: baseline?.source.kind === 'conversation' ? baseline.source.conversationId : t('change.inspectOwnerOrigin'),
            }),
            [workAllowanceText(locale, 'execution', change.execution), workAllowanceText(locale, 'resolution', change.resolution)].join('\n'),
            t('change.inspectFindings', {occurrences: change.occurrences.length, dispositions: change.dispositions.length}),
            t('change.inspectBlockers') + '\n' + (change.blocked.length ? display(change.blocked.join('\n'), 8192) : t('workRecovery.none')),
            t('result.recordedNextAction', {action: display(change.nextAction, 4096)}),
            t('change.inspectLimits') + '\n' + display(change.limitations.join('\n'), 8192),
            t('input.recoveryRequest') + '\n' + display(request.raw ?? t('change.requestUnavailable'), 32768),
        ].join('\n\n');
        await host.show((!currentHold && context?.title) || t('change.inspectTitle'), text);
    };
    const command: HostCommand = { name: 'change', descriptionId: 'command.description.change', argumentHint: '[start [REQUEST] | result/resume/cancel [WORK_ID] | inspect/replan WORK_ID]', acceptsArgument: argument => !!parseChangeArgument(argument),
        opensInspection: argument => {
            const parsed = parseChangeArgument(argument);
            return !!parsed && parsed.kind !== 'start' && (parsed.action === 'result' || parsed.kind === 'work' && parsed.action === 'inspect');
        },
        run: async (argument, target, context) => {
                const before = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target), language = host.controller.getConversationLanguage(target);
                const locale = host.locale?.(target) ?? 'en', t = translator(locale);
                const sourceIsCurrent = () => {
                    if (!host.isCurrent(target)) return false;
                    const now = host.controller.inspectConversation(target);
                    return now.generation === before.generation && now.projectId === before.projectId && !now.archived && !now.deleted &&
                        host.controller.getConversationLanguage(target).revision === language.revision;
                };
                const assertCurrent = () => {
                    if (!sourceIsCurrent() || host.controller.getConversationModelChoice(target).revision !== choice.revision)
                        throw Error(t('change.sourceChanged'));
                };
                assertCurrent();
                const controls = host.controls;
                const cancel = t('change.cancel');
                const confirmAfterWorkReview = async (title: string, details: string, finish: string, accept: string, fresh: () => void, {
                    runtimeReview, back = t('change.reviewBack'), beforeConfirm,
                }: { runtimeReview?: string | undefined; back?: string | undefined; beforeConfirm?: () => Promise<boolean> } = {}) => {
                    fresh();
                    const text = runtimeReview === undefined
                        ? details : details + '\n\n' + t('change.runtimeSettings') + '\n' + escapeJsonControls(runtimeReview);
                    if (!await showReviewText(host, title, text, fresh, t('review.only'), locale,
                        { next: t('review.next'), finish }))
                        return false;
                    if (beforeConfirm && !await beforeConfirm())
                        return false;
                    fresh();
                    const selected = await chooseUiItem(host, title,
                        [{ value: 'back', label: back }, { value: 'confirm', label: accept }]);
                    fresh();
                    return selected === 'confirm';
                };
                const repairRuntime = async (fresh: () => void, afterSetup = fresh) => {
                    if (!controls?.models || !host.execute)
                        throw Error('Configure the execution runtime with /setup runtime and choose Save and apply runtime before starting managed work');
                    const action = await chooseUiItem(host, t('change.runtimeRequired'), [
                        { value: 'back', label: cancel },
                        { value: 'runtime', label: t('requestSetup.openRuntime') },
                    ]);
                    fresh();
                    if (action !== 'runtime')
                        return;
                    const outcome = await host.execute('/setup runtime', target);
                    if (outcome === 'started')
                        return outcome;
                    afterSetup();
                    return outcome === 'completed' ? host.controller.options.runtimeProfile : undefined;
                };
                const start = async (request?: string) => {
                    if (!controls)
                        throw Error('Work controls are not available in this host');
                    if (!before.projectId)
                        throw Error('Select a project with /project before starting managed work');
                    const draft = controls.draft(target);
                    const draftIsCurrent = () => host.controller.inspectConversation(target).draft.revision === before.draft.revision && controls.draft(target) === draft;
                    const assertStartSource = () => {
                        assertCurrent();
                        if (!draftIsCurrent())
                            throw Error(t('change.sourceChanged'));
                        const {workId: original, allowance} = host.controller.inspectConversationChangeStart(target);
                        if (original)
                            throw Error(t('change.startRetained', { work: original }));
                        if (!allowance)
                            throw Error(t('change.sourceChanged'));
                        const allowanceHold = managedStartExecutionHold(allowance);
                        if (allowanceHold)
                            throw allowanceHold;
                        return allowance;
                    };
                    assertStartSource();
                    const project = host.controller.listProjects().find(project => project.id === before.projectId);
                    if (!project)
                        throw Error(t('change.sourceChanged'));
                    const sourceChecked = controls.prepareProjectSourceCheck?.(target);
                    let reviewedDirectory: ProjectSourceIdentity | undefined = await readProjectSource(project.sourceRoot, locale);
                    assertStartSource();
                    sourceChecked?.();
                    const managed = choice.kind === 'managed' && controls.models ? { models: controls.models, choice } : undefined;
                    const explicit = controls.model;
                    if (!managed && (!explicit || choice.kind === 'legacy-external' && !matchesExternalModel(choice, explicit))) {
                        const reason = t(choice.kind === 'legacy-external' ? 'change.startExternalRequired' : 'change.startModelRequired');
                        if (!controls.models || !host.execute)
                            throw Error(reason);
                        const selected = await chooseUiItem(host, reason, [
                            { value: 'back', label: t('change.reviewBack') },
                            { value: 'model', label: t('model.title') },
                        ]);
                        if (selected === 'model') {
                            assertStartSource();
                            const outcome = await host.execute('/model', target);
                            if (outcome === 'completed' && sourceIsCurrent() && draftIsCurrent())
                                controls.notice(t('change.startModelKept'));
                        }
                        return 'cancelled' as const;
                    }
                    const runtime = host.controller.options.runtimeProfile ?? await repairRuntime(assertStartSource);
                    if (runtime === 'started')
                        return runtime;
                    if (!runtime)
                        return 'cancelled' as const;
                    const runtimeReview = JSON.stringify(runtime, null, 2);
                    const assertStart = () => {
                        const allowance = assertStartSource();
                        if (JSON.stringify(host.controller.options.runtimeProfile, null, 2) !== runtimeReview)
                            throw Error(t('change.startRuntimeChanged'));
                        return allowance;
                    };
                    let writeRequest = false;
                    if (!request) {
                        const useDraft = uiText(locale, 'change.useDraft');
                        const write = t('change.writeRequest');
                        const picked = await host.choose(t('change.requestChoice'), [...(!draft.trimStart().startsWith('/') && draft.trim() ? [useDraft] : []), write, cancel]);
                        assertStart();
                        if (!picked || picked === cancel)
                            return 'cancelled' as const;
                        if (picked === useDraft)
                            request = draft;
                        else if (picked === write)
                            writeRequest = true;
                        else
                            throw Error('Unknown request source');
                    }
                    let issue: string | undefined;
                    const checkDirectory = async (expected?: ProjectSourceIdentity) => {
                        try {
                            return await readProjectSource(project.sourceRoot, locale, expected);
                        } catch (error) {
                            if (!writeRequest || !(error instanceof ProjectSourceError))
                                throw error;
                            issue = t(error.reason === 'replaced' ? 'change.requestFolderReplaced' : 'change.requestFolderUnavailable');
                        }
                    };
                    while (true) {
                        if (writeRequest) {
                            const value = await controls.input(t('change.requestInput'), request ?? '', issue);
                            assertStart();
                            if (value === undefined)
                                return 'cancelled' as const;
                            if (!value.trim() || !acceptsSingleLineInput(value)) {
                                issue = t('change.requestSingleLine');
                                continue;
                            }
                            request = value;
                            issue = undefined;
                        }
                        if (!request?.trim())
                            throw Error('An explicit owner request is required');
                        if (!reviewedDirectory) {
                            reviewedDirectory = await checkDirectory();
                            assertStart();
                            if (!reviewedDirectory)
                                continue;
                        }
                        const baseline = managed ? { ...await managed.models.baseline(before.projectId, managed.choice), source: { kind: 'conversation' as const, conversationId: target, choiceRevision: choice.revision } } : undefined;
                        const allowance = assertStart();
                        const model = baseline?.choice ?? explicit!, label = model.provider + '/' + model.modelId;
                        const details = t('change.startDetails', { project: before.projectId, model: label, request: quoteText(request),
                            source: quoteText(project.sourceRoot), context: quoteText(runtime.dockerContext), image: quoteText(runtime.image),
                            allowance: [
                                allowance.sourceWorkId ? t('change.startSharedAllowance', {work: allowance.sourceWorkId}) : t('change.startFreshAllowance'),
                                workAllowanceText(locale, 'execution', allowance.execution), workAllowanceText(locale, 'resolution', allowance.resolution),
                            ].join('\n') });
                        const title = t('change.startTitle', { project: before.projectId, model: label });
                        const assertReviewCurrent = () => {
                            if (!isDeepStrictEqual(assertStart(), allowance))
                                throw Error(t('change.startAllowanceChanged'));
                        };
                        const confirmDirectory = async () => {
                            reviewedDirectory = await checkDirectory(reviewedDirectory);
                            assertReviewCurrent();
                            return reviewedDirectory !== undefined;
                        };
                        const back = writeRequest ? t('change.backToRequest') : undefined;
                        if (!await confirmAfterWorkReview(title, details, t('change.openStartConfirmation'), t('change.startAccept'),
                            assertReviewCurrent, { runtimeReview, back, beforeConfirm: confirmDirectory })) {
                            if (writeRequest)
                                continue;
                            return 'cancelled' as const;
                        }
                        if (!await confirmDirectory())
                            continue;
                        const task = host.controller.startConversationChange({ conversationId: target, expectedGeneration: before.generation, expectedModelRevision: choice.revision, projectId: before.projectId, request, ...(baseline ? { applicationModelBaseline: baseline } : { model: explicit! }) });
                        controls.launch(target, task, undefined, context?.submission);
                        return 'started' as const;
                    }
                };
                const act = async (action: 'resume' | 'replan' | 'cancel', id: string) => {
                    if (!controls)
                        throw Error('Work controls are not available in this host');
                    const work = host.controller.inspectWork(id), baseline = host.controller.getWorkApplicationModelBaseline(id), source = work.source as {
                        raw?: string;
                        origin?: {
                            conversationId?: string;
                        };
                    };
                    const project = work.projectId ?? t('value.none');
                    const model = baseline ? baseline.choice.provider + '/' + baseline.choice.modelId : controls.model ? controls.model.provider + '/' + controls.model.modelId : t('change.externalRequired');
                    const values = { id, project, state: work.state, model };
                    const reviewDetails = ({nextAction, execution, resolution}: Pick<ChangeView, 'nextAction' | 'execution' | 'resolution'>,
                        effects: string, runtime?: typeof host.controller.options.runtimeProfile) => t('change.retainedDetails', {
                        ...values, modelTitle: t(baseline ? 'change.originalModel' : 'change.externalModel'), epoch: work.epoch, next: nextAction,
                        runtime: runtime ? t('change.resumeRuntime', { context: quoteText(runtime.dockerContext), image: quoteText(runtime.image) }) + '\n' : '',
                        execution: workAllowanceText(locale, 'execution', execution),
                        resolution: workAllowanceText(locale, 'resolution', resolution),
                        request: source.raw === undefined ? t('change.requestUnavailable') : action === 'cancel' ? source.raw : quoteText(source.raw),
                        effects,
                    });
                    const originalSource = JSON.stringify(source);
                    const assertWorkSource = () => {
                        assertCurrent();
                        const now = host.controller.inspectWork(id);
                        if (now.epoch !== work.epoch || now.projectId !== work.projectId || JSON.stringify(now.source) !== originalSource)
                            throw Error(t('change.workChanged'));
                        return now;
                    };
                    if (action === 'cancel') {
                        // Stopping owned work needs its custody and original scope, even if its plan cannot be read.
                        const recovery = host.controller.inspectWorkRecovery(id);
                        if (!recovery.governed)
                            throw Error(t('change.workChanged'));
                        const live = host.controller.hasLiveChangeOperation(id);
                        const assertCancellation = () => {
                            const now = assertWorkSource();
                            if (now.state !== work.state || host.controller.inspectChangeActivity(id)?.recordedPhase !== recovery.recordedPhase ||
                                host.controller.hasLiveChangeOperation(id) !== live)
                                throw Error(t('change.workChanged'));
                        };
                        if (!await confirmAfterWorkReview(t('change.cancelReview', values), reviewDetails(recovery, t('change.cancelEffects')),
                            t('change.openCancelConfirmation'), t('change.cancelAccept'), assertCancellation))
                            return 'cancelled' as const;
                        await host.controller.cancelWork({ workId: id, expectedEpoch: work.epoch });
                        controls.notice(t('change.cancelled', { id }));
                        return 'completed' as const;
                    }
                    const { change, error } = readAssessment(id);
                    if (!change) {
                        const captured = readRetainedResult(id, locale, error);
                        let openWork = false;
                        const details = [t('change.inspectRecovery', {id}), ...captured.result.blocked.map(plainTerminalText)].join('\n\n');
                        await host.show(t('workRecovery.guidanceUnavailable'), details, host.execute ? {
                            label: t('result.recovery'), run: async () => { openWork = true; },
                        } : undefined);
                        if (!openWork || !host.execute)
                            return 'cancelled' as const;
                        assertWorkSource();
                        captured.assertCurrent();
                        if (host.controller.inspectWorkRecovery(id).recoveryHold?.kind !== 'unavailable')
                            throw Error(t('change.workChanged'));
                        return host.execute('/work ' + id, target, context);
                    }
                    if (action === 'resume' && change.ownerActivation === 'pending' && !host.controller.options.runtimeProfile &&
                        !host.controller.hasLiveChangeOperation(id) && ['ACTIVE', 'INTERRUPTED', 'CANCELLED'].includes(work.state)) {
                        await showInspectionText(host, t('workRecovery.activationPending'), ownerActivationGuidance(host.controller.applicationHome(), work, locale),
                            assertWorkSource, t('review.only'), locale);
                        return 'cancelled' as const;
                    }
                    const replan = action === 'replan' ? host.controller.inspectChangeReplan(id) : undefined;
                    const scope = replan?.kind === 'scope';
                    const replanKind = replan?.kind ?? 'check';
                    const replanRuntime = replan ? structuredClone(host.controller.options.runtimeProfile) : undefined;
                    const assertReplan = () => {
                        if (!replan) return;
                        if (!isDeepStrictEqual(host.controller.options.runtimeProfile, replanRuntime))
                            throw Error(t('change.startRuntimeChanged'));
                        const latest = host.controller.inspectChangeReplan(id);
                        if (latest.kind !== replan.kind || latest.fingerprint !== replan.fingerprint)
                            throw Error(t(`change.${replanKind}ReplanChanged`));
                    };
                    const resuming = action === 'resume';
                    const assertWork = () => { assertWorkSource(); assertReplan(); };
                    if (source.origin?.conversationId && source.origin.conversationId !== target) {
                        const cid = source.origin.conversationId, view = host.controller.inspectConversation(cid);
                        if (view.deleted || view.archived) {
                            let openWork = false;
                            await host.show(t(view.deleted ? 'workRecovery.originDeleted' : 'workRecovery.originArchived', {
                                conversation: conversationDisplayIdentity(view),
                            }), t('workRecovery.originHoldNext'), host.execute ? {
                                label: t('result.recovery'), run: async () => { openWork = true; },
                            } : undefined);
                            assertWork();
                            return openWork && host.execute ? host.execute('/work ' + id, target, context) : 'cancelled' as const;
                        }
                        if (view.projectId !== work.projectId)
                            throw Error(t('change.restoreOriginProject', { project }));
                        const modelRevision = host.controller.getConversationModelChoice(cid).revision;
                        const languageRevision = host.controller.getConversationLanguage(cid).revision;
                        const assertOrigin = () => {
                            const now = host.controller.inspectConversation(cid);
                            if (now.deleted || now.archived || now.generation !== view.generation || now.projectId !== view.projectId ||
                                host.controller.getConversationModelChoice(cid).revision !== modelRevision ||
                                host.controller.getConversationLanguage(cid).revision !== languageRevision)
                                throw Error(t('change.originChanged'));
                        };
                        const selected = await chooseUiItem(host, t(replan ? `change.${replanKind}ReplanHandoff` : 'change.resumeHandoff', { project, conversation: cid }), [
                            { value: 'back', label: t('change.reviewBack') },
                            { value: 'open', label: t(replan ? `change.${replanKind}ReplanOpenOrigin` : 'change.openOrigin', { conversation: conversationDisplayIdentity(view) }) },
                        ]);
                        assertWork();
                        if (selected !== 'open')
                            return 'cancelled' as const;
                        assertOrigin();
                        await controls.activateSource(cid);
                        assertOrigin();
                        assertReplan();
                        if (!host.isCurrent(cid) || host.controller.inspectWork(id).epoch !== work.epoch)
                            throw Error(t('change.originChanged'));
                        // Carry the chosen intent, never the prior form's permission or draft acknowledgement.
                        // The original owner gets a fresh review and final admission checks.
                        return command.run(action + ' ' + id, cid);
                    }
                    const cleanupHeld = isWorkSettlementUnconfirmed(work.state);
                    const currentAllowanceHold = () => host.controller.inspectChangeContinuationPrerequisites(id).allowanceHold;
                    const allowanceHold = resuming ? currentAllowanceHold() : undefined;
                    const canConfigureRuntime = resuming && !cleanupHeld && !allowanceHold &&
                        change.ownerActivation !== 'pending' && !change.execution.reserved && !change.resolution.reserved;
                    const reviewKey = (current: ChangeView, originalModel: typeof baseline, hold: typeof allowanceHold) =>
                        JSON.stringify([current.state, current.epoch, current.recordedPhase, current.phase, current.nextAction,
                            current.ownerActivation, current.baseVersion, current.candidateVersion, current.planVersion, current.verificationVersion,
                            current.execution, current.resolution, originalModel, hold, current.workflowCriteriaHold, current.workflowCriteriaBlocksResume]);
                    const originalReview = resuming ? reviewKey(change, baseline, allowanceHold) : undefined;
                    const directions = resuming ? host.controller.inspectChangeResumeDirections(id) : undefined;
                    const draft = resuming || replan ? controls.draft(target) : undefined;
                    const assertPaneDraft = () => {
                        const current = host.controller.inspectConversation(target);
                        if (current.workId !== before.workId || current.draft.revision !== before.draft.revision || controls.draft(target) !== draft)
                            throw Error(t('change.sourceChanged'));
                    };
                    const assertResumeSource = () => {
                        assertWork();
                        assertPaneDraft();
                        const latest = host.controller.inspectChange(id);
                        if (reviewKey(latest, host.controller.getWorkApplicationModelBaseline(id), currentAllowanceHold()) !== originalReview ||
                            host.controller.inspectChangeResumeDirections(id).fingerprint !== directions?.fingerprint)
                            throw Error(t('change.workChanged'));
                    };
                    const criteriaHold = resuming && !cleanupHeld && change.workflowCriteriaBlocksResume ? change.workflowCriteriaHold : undefined;
                    if (criteriaHold) {
                        let inspectWork = false;
                        await host.show(t(`criteria.recovery.${criteriaHold}`), workflowCriteriaNextAction(locale, criteriaHold, id),
                            host.execute ? { label: t('result.recovery'), run: async () => { inspectWork = true; } } : undefined);
                        assertResumeSource();
                        return inspectWork && host.execute ? host.execute('/work ' + id, target) : 'cancelled' as const;
                    }
                    const runtime = resuming ? structuredClone(host.controller.options.runtimeProfile ?? (canConfigureRuntime ? await repairRuntime(assertResumeSource) : undefined))
                        : replanRuntime;
                    if (runtime === 'started')
                        return runtime;
                    if (canConfigureRuntime && !runtime)
                        return 'cancelled' as const;
                    const runtimeReview = JSON.stringify(runtime ?? null, null, 2);
                    const assertRuntimeReview = () => {
                        assertResumeSource();
                        if (!isDeepStrictEqual(host.controller.options.runtimeProfile, runtime))
                            throw Error(t('change.startRuntimeChanged'));
                    };
                    const effects = t(replan ? `change.${replanKind}ReplanEffects` : 'change.resumeEffects');
                    const allowance = replan ? host.controller.inspectWorkAllowance(id) : change;
                    const details = reviewDetails({nextAction: change.nextAction, execution: allowance.execution, resolution: allowance.resolution}, directions?.count ? [
                        t(directions.count === 1 ? 'change.resumeDirection' : 'change.resumeDirections', {count:directions.count}),
                        effects,
                    ].join('\n\n') : effects, resuming ? runtime : undefined);
                    const recover = ['CANCELLED', 'INTERRUPTED'].includes(work.state);
                    const accept = t(replan ? 'change.scopeReplanAccept' : recover ? 'change.recoverAccept' : 'change.resumeAccept');
                    const title = t(replan ? `change.${replanKind}ReplanReview` : 'change.resumeReview', values);
                    if (replan) {
                        const assertCorrection = () => {
                            assertWork();
                            assertPaneDraft();
                            const {execution, resolution} = host.controller.inspectWorkAllowance(id);
                            if (!isDeepStrictEqual(execution, allowance.execution) || !isDeepStrictEqual(resolution, allowance.resolution))
                                throw Error(t('change.workChanged'));
                        };
                        const proof = escapeJsonControls(JSON.stringify({
                            heldDirections: replan.heldDirections,
                            [scope ? 'scopeFailures' : replan.kind === 'verification' ? 'verificationGap' : 'checkFailures']: replan.failures,
                        }, null, 2));
                        const review = details + '\n\n' + t('change.replanEvidence') + '\n' + proof;
                        if (!runtime) {
                            if (!controls.models || !host.execute) {
                                await showInspectionText(host, title, review, assertCorrection, t('change.replanRuntimeRequired'), locale);
                                return 'cancelled' as const;
                            }
                            if (!await showReviewText(host, title, review, assertCorrection, t('review.only'), locale,
                                { next: t('review.next'), finish: t('change.replanReviewRuntimeSetup') }))
                                return 'cancelled' as const;
                            const applied = await repairRuntime(assertCorrection,
                                () => { assertWorkSource(); assertPaneDraft(); });
                            if (applied === 'started') return applied;
                            if (!applied) return 'cancelled' as const;
                            controls.notice(t('change.replanRuntimeApplied', { id }));
                            return 'completed' as const;
                        }
                        if (!await confirmAfterWorkReview(title, review, t('change.openReplanConfirmation'), accept, assertCorrection, { runtimeReview }))
                            return 'cancelled' as const;
                    }
                    else {
                        assertRuntimeReview();
                        if (cleanupHeld || allowanceHold || !runtime) {
                            const hold = cleanupHeld ? t('change.resumeCleanupHeld', { id }) :
                                allowanceHold ? t(`managedRepair.allowance.${allowanceHold}`, { command: `/work ${id}` }) :
                                t('change.resumeRuntimeHeld', { id });
                            const text = hold + '\n\n' + details;
                            if ((cleanupHeld || allowanceHold) && host.execute) {
                                const recover = await showReviewText(host, title, text, assertResumeSource, t('review.only'), locale, {
                                    next: t('review.next'), finish: t('result.recovery'),
                                });
                                return recover ? host.execute('/work ' + id, target, context) : 'cancelled' as const;
                            }
                            await showInspectionText(host, title, text, assertResumeSource, t('review.only'), locale);
                            return 'cancelled' as const;
                        }
                        if (!await confirmAfterWorkReview(title, details, t('change.openResumeConfirmation'), accept, assertRuntimeReview, { runtimeReview }))
                            return 'cancelled' as const;
                    }
                    if (!runtime)
                        return 'cancelled' as const;
                    const task = host.controller.resumeConversationChange({ conversationId: target, expectedGeneration: before.generation, expectedModelRevision: choice.revision, workId: id, expectedEpoch: work.epoch,
                        expectedReview: { runtime, draftRevision: before.draft.revision, execution: allowance.execution, resolution: allowance.resolution },
                        ...(replan?.kind === 'scope' ? { expectedScopeReplan:replan.fingerprint }
                            : replan?.kind === 'verification' ? {expectedVerificationReplan:replan.fingerprint}
                            : replan ? { expectedCheckReplan:replan.fingerprint } : { resumeCancelled:recover, expectedResumeDirections:directions!.fingerprint }),
                        ...(!baseline && controls.model ? { model: controls.model } : {}) });
                    controls.launch(target, task, id, context?.submission);
                    return 'started' as const;
                };
                const parsed = parseChangeArgument(argument);
                if (!parsed)
                    throw Error('Use /change to find work, or /change start, result, inspect, resume, replan or cancel');
                if (parsed.kind === 'start')
                    return start(parsed.request);
                if (parsed.kind === 'work') {
                    if (parsed.action === 'result')
                        return reviewChangeResult(host, parsed.workId, target, assertCurrent, { context, explicitId: true });
                    if (parsed.action === 'inspect') {
                        await inspect(parsed.workId, target, assertCurrent, locale);
                        return;
                    }
                    return act(parsed.action, parsed.workId);
                }
                let action = parsed.action;
                let resultLinkUnavailable = false;
                if (action === 'result') {
                    const showResult = (id: string) => reviewChangeResult(host, id, target, assertCurrent, { context });
                    const currentWork = before.workId;
                    let linked: string | null = null;
                    if (!parsed.delegatedOnly) {
                        if (currentWork && observeRecovery(() => Boolean(host.controller.inspectChangeActivity(currentWork))) !== false)
                            return showResult(currentWork);
                        if (!before.role) {
                            try {
                                const route = host.controller.conversationChange(target);
                                linked = route.workId;
                                if (linked && route.capturedContinuation) return showResult(linked);
                            }
                            catch (error) {
                                if (error instanceof ContextAssignmentUnavailable && error.workId)
                                    return showResult(error.workId);
                                resultLinkUnavailable = true;
                            }
                        }
                    }
                    const delegated = await delegatedResult(target, assertCurrent, locale, context, parsed.delegatedOnly);
                    if (delegated !== 'registry') {
                        if (delegated) return delegated;
                        if (linked) return showResult(linked);
                    }
                }
                let projectId: string | undefined = action === 'result' ? before.projectId ?? undefined : undefined, cursor: string | undefined;
                let focusedResult: string | undefined;
                const newer: (string | undefined)[] = [];
                while (true) {
                    assertCurrent();
                    const page = host.controller.listChanges({ limit: 50, ...(projectId ? { projectId } : {}), ...(cursor ? { before: cursor } : {}) });
                    const returnToInspection = parsed.action === 'inspect' && action !== 'inspect';
                    const listTitle = [
                        t(action === 'result' ? 'result.title' : `change.registry.${action}`),
                        projectId ?? t('change.registry.allScope'),
                        ...(cursor ? [t('change.registry.olderPage')] : []),
                        ...(!page.changes.length ? [t('change.registry.empty')] : []),
                    ].join(' · ');
                    const title = resultLinkUnavailable ? listTitle + '\n' + t('result.originalLinkUnavailable') : listTitle;
                    const selected = await chooseUiItem(host, title, [
                        ...page.changes.map(work => ({
                            value: 'work:' + work.workId,
                            label: t('change.registry.work', {
                                project: work.projectId, id: work.workId, state: work.state, phase: work.recordedPhase,
                                preview: escapeDisplayControls(work.requestPreview.replace(/\s+/gu, ' ')).slice(0, 90),
                            }),
                        })),
                        ...(controls && action === 'inspect' ? [
                            { value: 'start', label: t('change.registry.start') },
                            { value: 'resume', label: t('change.registry.chooseResume') },
                            { value: 'cancel', label: t('change.registry.chooseCancel') },
                        ] : []),
                        ...(page.nextCursor ? [{ value: 'older', label: t('change.registry.older') }] : []),
                        ...(newer.length ? [{ value: 'newer', label: t('change.registry.newer') }] : []),
                        { value: 'refresh', label: t('change.registry.refresh') },
                        ...(before.projectId && projectId !== before.projectId ? [{ value: 'current', label: t('change.registry.current') }] : []),
                        ...(projectId || cursor ? [{ value: 'all', label: t('change.registry.all') }] : []),
                        { value: 'close', label: t(returnToInspection ? 'workRecovery.backToSource' : 'change.registry.close') },
                    ], focusedResult);
                    if (!selected || selected === 'close') {
                        if (returnToInspection && host.isCurrent(target)) {
                            action = 'inspect';
                            continue;
                        }
                        return 'cancelled';
                    }
                    assertCurrent();
                    if (selected === 'start')
                        return start();
                    if (selected === 'resume' || selected === 'cancel') {
                        action = selected;
                        continue;
                    }
                    if (selected === 'older' && page.nextCursor) {
                        newer.push(cursor);
                        cursor = page.nextCursor;
                        focusedResult = undefined;
                        continue;
                    }
                    if (selected === 'refresh')
                        continue;
                    if (selected === 'newer') {
                        cursor = newer.pop();
                        focusedResult = undefined;
                        continue;
                    }
                    if (selected === 'current' || selected === 'all') {
                        projectId = selected === 'current' ? before.projectId ?? undefined : undefined;
                        cursor = undefined;
                        newer.length = 0;
                        focusedResult = undefined;
                        continue;
                    }
                    const chosen = page.changes.find(work => 'work:' + work.workId === selected);
                    if (!chosen)
                        throw Error('Unknown retained change selection; reopen /change');
                    if (action === 'inspect') {
                        await inspect(chosen.workId, target, assertCurrent, locale);
                        if (!host.isCurrent(target))
                            return 'cancelled';
                        continue;
                    }
                    if (action === 'result') focusedResult = selected;
                    const outcome = action === 'result'
                        ? await reviewChangeResult(host, chosen.workId, target, assertCurrent, { context })
                        : await act(action, chosen.workId);
                    if (outcome === 'started' || outcome === 'completed' || !host.isCurrent(target))
                        return outcome ?? 'cancelled';
                }
            } };
    return [command, { name: 'result', descriptionId: 'command.description.result', argumentHint: '[WORK_ID | --delegated]', opensInspection: () => true,
        acceptsArgument: argument => !!parseChangeArgument('result ' + argument),
        run: (argument, target, context) => command.run(argument ? 'result ' + argument : 'result', target, context) }];
}

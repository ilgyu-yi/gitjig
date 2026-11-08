import { isDeepStrictEqual } from 'node:util';
import { showReviewAction, type ReviewPageHost } from './exact-review.js';
import type { Controller } from '../controller/controller.js';
import { runtimeRepairAction, type FailurePresentation } from './failure-details.js';
import type { HostCommand, HostCommandExecutor, HostCommandOutcome } from './host-commands.js';
import { interruptedOriginalInput, type RetainedInput, type ReviewRetainedInput } from './input-commands.js';
import { inspectQueuedTaskRecovery, recoverQueuedTask } from './queued-assignment-recovery.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
import { captureProjectDependencies, isProjectChangeHold, projectAssignmentReasons, ProjectChangeHeld, sameProjectDependency } from './project-commands.js';
import type { IndependentProjectTarget } from './new-conversation.js';
import { conversationDisplayIdentity } from './chrome.js';
import { retainedOperationCommand } from './repository-commands.js';
import { quoteIdentity } from './inspection-text.js';
import { projectSourceUnavailableCode } from './project-source.js';
import { observeRecovery } from './recovery-navigation.js';
interface ErrorHost {
    controller: Controller;
    commandKeyLabel?: string;
    isCurrent(target: string): boolean;
    assertAvailable(): void;
    failure(target: string): FailurePresentation | null;
    draftRecovery?(target: string): { summary: string; detail: string; retry(): 'saved' | 'failed' | 'changed' } | undefined;
    failureStatus?(target: string): { active: boolean; revision: number; retrying?: boolean } | undefined;
    reportProjectHold?(target: string, hold: ProjectChangeHeld): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    showReview: ReviewPageHost['show'];
    notice(text: string, wrap?: boolean): void;
    execute: HostCommandExecutor;
    openProject(target: string, project: IndependentProjectTarget, validateSource: () => void): Promise<'completed' | 'cancelled'>;
    openConversation?(target: string): Promise<void>;
    reviewInput?: ReviewRetainedInput;
}
class ErrorReviewChanged extends Error {}

/** Original facts select existing recovery controls; this command never invents a remedy. */
export function errorCommands(host: ErrorHost): HostCommand[] {
    return [{ name: 'error', descriptionId: 'command.description.error', run: async (_argument, target, context) => {
        let projectRecoveryUpdate: 'retried' | 'occurrence' | 'observation' | 'relationship' | undefined;
        let historicalDependency: {failure: FailurePresentation; revision: number | undefined} | undefined;
        let recoveredDependencies: { failure: FailurePresentation; revision: number | undefined; items: ReturnType<typeof captureProjectDependencies> } | undefined;
        recovery: while (true) {
            try {
                host.assertAvailable();
                const failure = host.failure(target), draft = host.draftRecovery?.(target);
                const detail = draft ? [failure?.detail, draft.summary + '\n' + draft.detail].filter(Boolean).join('\n\n') : failure?.detail;
                const status = host.failureStatus?.(target), previous = !!failure && status?.active === false;
                const view = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
                const language = host.controller.getConversationLanguage(target);
                const locale = resolveUiLanguage(language.replyLanguage, hostUiLanguage()).locale, t = translator(locale);
                const sameSource = () => {
                    if (!host.isCurrent(target))
                        return false;
                    const now = host.controller.inspectConversation(target);
                    return now.generation === view.generation && now.projectId === view.projectId && now.workId === view.workId &&
                        !now.archived && !now.deleted && host.controller.getConversationModelChoice(target).revision === choice.revision &&
                        host.controller.getConversationLanguage(target).revision === language.revision;
                };
                const sameOccurrence = () => {
                    const latest = host.failureStatus?.(target);
                    return host.failure(target) === failure && latest?.revision === status?.revision &&
                        latest?.active === status?.active && latest?.retrying === status?.retrying;
                };
                const current = () => {
                    if (!sameSource() || !sameOccurrence())
                        throw new ErrorReviewChanged(t('error.sourceChanged'));
                };
                const returnToChoices = (outcome: HostCommandOutcome) => {
                    if (outcome !== 'cancelled' || !host.isCurrent(target)) return false;
                    current();
                    return true;
                };
                const readPending = () => observeRecovery(() => host.controller.inspectConversationInputs(target));
                const pending = readPending();
                const reviewInput = host.reviewInput;
                const findOriginal = (inputs: RetainedInput[], conversation = view) => {
                    if (status?.retrying || !reviewInput) return;
                    if (failure?.inputId)
                        return inputs.find(row => row.inputId === failure.inputId);
                    if (!failure)
                        return interruptedOriginalInput(conversation, inputs);
                    const [input, duplicate] = inputs.filter(row => failure.workId && failure.runId &&
                        row.workId === failure.workId && row.runId === failure.runId);
                    if (!duplicate) return input;
                };
                const original = pending && findOriginal(pending);
                const originalStillMatches = (reviewed: RetainedInput) => {
                    const inputs = readPending();
                    const input = inputs && findOriginal(inputs, failure ? view : host.controller.inspectConversation(target));
                    return input?.inputId === reviewed.inputId && input.fingerprint === reviewed.fingerprint && input.failure === reviewed.failure;
                };
                const goal = host.controller.conversationGoal(target);
                const readQueued = () => observeRecovery(() => inspectQueuedTaskRecovery(host.controller, target, view.generation));
                const queued = readQueued();
                const unavailable = [pending === undefined ? t('error.inputsUnavailable') : undefined,
                    queued === undefined ? t('error.queuedUnavailable') : undefined].filter(Boolean);
                const details = t('error.details'), back = t('error.back');
                const retryDraft = t('error.draftRetry');
                const reviewOriginal = t('error.originalInput');
                const queuedRoutes = new Map(queued?.map(entry => [t(entry.review ? 'queuedTask.entry' : 'queuedTask.unavailable', { id: entry.assignmentId }), entry]));
                current();
                const held = isProjectChangeHold(failure?.code);
                const project = held ? failure?.projectTarget : undefined;
                const openSelected = project ? t('error.independentSelectedProject', { project: project.id }) : undefined;
                const retrySwitch = project ? t('error.retryProjectSwitch', { project: project.id }) : undefined;
                const dependency = failure?.code === 'PROJECT_DEPENDENCY_PENDING' ? failure.projectDependency : undefined;
                const effectHold = project && failure?.code === 'PROJECT_EFFECT_PENDING';
                const effect = effectHold ? failure.projectEffect : undefined;
                const originalEffectCommand = (): string | null | undefined => {
                    if (!effect || effect.sourceConversationId !== target || effect.sourceGeneration !== view.generation ||
                        effect.sourceProjectId !== view.projectId) return;
                    try {
                        if (!host.controller.matchesProjectEffectHold(target, view.generation, effect)) return;
                    } catch {
                        return null; // The original proof could not be read.
                    }
                    return retainedOperationCommand(host.controller, effect.operationId, effect.workId, effect.targetId);
                };
                const originalEffect = originalEffectCommand();
                const inspectEffect = originalEffect ? t('error.originalRepositoryOperation') : undefined;
                let captured = dependency?.relationships ?? (recoveredDependencies && recoveredDependencies.failure === failure &&
                    recoveredDependencies.revision === status?.revision ? recoveredDependencies.items : undefined);
                const pendingRelationships = () => {
                    if (!dependency || dependency.sourceConversationId !== target || dependency.sourceGeneration !== view.generation ||
                        dependency.sourceProjectId !== view.projectId) return { kind: 'inapplicable' } as const;
                    const lifecycleHolds = captured?.flatMap(item => item.dependencyId
                        ? ['dependency:' + item.dependencyId]
                        : projectAssignmentReasons(item.assignmentId)) ?? dependency.originalReasons ?? [];
                    try {
                        const { items } = host.controller.inspectConversationProjectDependencies({
                            conversationId: target, expectedGeneration: view.generation, lifecycleHolds,
                            exactRelationshipReasons: true,
                        });
                        const latest = captureProjectDependencies(items);
                        const current = captured?.flatMap(original => latest.filter(item => sameProjectDependency(original, item))) ?? latest;
                        return { kind: 'observed', items: current } as const;
                    } catch { return { kind: 'unavailable' } as const; }
                };
                const observed = pendingRelationships();
                if (observed.kind === 'observed' && !captured && failure) {
                    captured = observed.items;
                    recoveredDependencies = { failure, revision: status?.revision, items: captured };
                }
                const originalRelationship = captured?.[0];
                const originalNow = observed.kind === 'observed' && originalRelationship
                    ? observed.items.find(item => sameProjectDependency(originalRelationship, item)) : undefined;
                if (observed.kind === 'observed')
                    historicalDependency = failure && (captured?.length === 0 || !isDeepStrictEqual(originalRelationship, originalNow))
                        ? {failure, revision:status?.revision} : undefined;
                const dependencyChanged = !!historicalDependency && historicalDependency.failure === failure && historicalDependency.revision === status?.revision;
                const dependencyState = originalNow?.assignmentState;
                const currentDependency = dependencyChanged && (dependencyState === 'QUEUED' || dependencyState === 'RUNNING' || dependencyState === 'WAITING')
                    ? t('error.projectDependencyCurrent', { state: t(`state.${dependencyState}`) }) : undefined;
                const dependencyViewChanged = (needsObservation = false) => {
                    if (observed.kind !== 'observed') return false;
                    const latest = pendingRelationships();
                    return latest.kind === 'observed' ? !isDeepStrictEqual(observed, latest) : needsObservation;
                };
                const originalWorkIds = [failure?.workId, ...(failure?.relatedWorkIds ?? [])];
                const exactWorkHold = failure?.code === 'PROJECT_WORK_PENDING' ||
                    failure?.workId && ['CONTEXT_WORK_SETTLEMENT_HELD', 'MANAGED_START_EXECUTION_EXHAUSTED'].includes(failure.code ?? '');
                const workIds = dependency ? observed.kind === 'observed' ? observed.items.map(item => item.workId) : [] :
                    exactWorkHold ? originalWorkIds : [...originalWorkIds, view.workId, ...(pending?.flatMap(input => input.blockingWorkIds) ?? [])];
                const readWorkEpoch = (id: string) => observeRecovery(() => host.controller.inspectWork(id).epoch);
                const works = new Map<string, number>();
                let unavailableWork = false;
                for (const id of new Set(workIds)) {
                    if (!id) continue;
                    const epoch = readWorkEpoch(id);
                    if (epoch !== undefined) works.set(id, epoch);
                    else unavailableWork = true;
                }
                if (!detail && pending?.length === 0 && !works.size && !goal && queued?.length === 0) {
                    host.notice(t(view.state === 'UNKNOWN' ? 'error.unresolvedWithoutRecord' : 'error.empty'));
                    return;
                }
                const lookupRelated = (id: string) => {
                    try {
                        const view = host.controller.inspectConversation(id);
                        return view.archived || view.deleted ? { kind: 'inactive' } as const : { kind: 'available', view } as const;
                    } catch { return { kind: 'unavailable' } as const; }
                };
                const openConversation = host.openConversation;
                const created = failure?.createdConversation;
                const createdDestination = () => {
                    if (!created || created.sourceConversationId !== target || created.conversationId === target) return;
                    try {
                        const destination = host.controller.inspectConversation(created.conversationId);
                        if (!destination.archived && !destination.deleted && destination.projectId === created.projectId)
                            return destination;
                    } catch { /* The exact destination is no longer readable. */ }
                };
                const createdView = openConversation && createdDestination();
                const openCreated = createdView ? t('error.openCreatedConversation') : undefined;
                const relatedIds = observed.kind === 'observed' && openConversation
                    ? [...new Set(observed.items.map(item => item.conversationId).filter(id => id !== target))] : [];
                const relatedViews = relatedIds.map(lookupRelated);
                const related = new Map(relatedViews.flatMap(entry => entry.kind === 'available'
                    ? [[t('error.openProjectDependency', { conversation: conversationDisplayIdentity(entry.view) }), entry.view] as const] : []));
                const relationshipNotice = observed.kind === 'unavailable' ? t('error.projectDependenciesUnavailable') :
                    relatedViews.some(entry => entry.kind === 'unavailable') ? t('error.relatedConversationsUnavailable') : undefined;
                const workNotice = project && unavailableWork ? t('error.projectWorkUnavailable') : undefined;
                const refresh = relationshipNotice || workNotice || unavailable.length ? t('error.refreshProjectRecovery') : undefined;
                const setupRoute = previous || status?.retrying ? undefined : failure?.recoveryRoute;
                const projectSourceUnavailable = !previous && !status?.retrying && !!view.projectId && failure?.code === projectSourceUnavailableCode;
                const runtimeRepair = runtimeRepairAction(setupRoute);
                const setupActions = new Map<string, string>(setupRoute === 'claude-bridge' ? [
                    [t('error.bridgeSettings'), '/bridge'], [t('error.bridgeModel'), '/model'],
                ] : runtimeRepair ? [
                    [t(runtimeRepair.label), '/setup runtime'],
                ] : []);
                const routes = new Map<string, string>([
                    ...(projectSourceUnavailable ? [[t('error.projectSource'), '/project'] as [string, string]] : []),
                    ...(held && !project ? [[t('error.independentProject'), '/new root'] as [string, string]] : []),
                    ...(effectHold ? [[t('error.repositoryOperations'), '/repo'] as [string, string]] : []),
                    [t('error.ready'), '/ready'],
                    ...(pending?.length ? [[t('error.inputs'), '/inputs'] as [
                            string,
                            string
                        ]] : []),
                    ...[...works.keys()].map(id => [t('error.work', { id }), '/work ' + id] as [
                        string,
                        string
                    ]),
                    [t('error.allWork'), '/work'],
                    ...(goal ? [[t('error.goal'), '/goal'] as [
                            string,
                            string
                        ]] : []),
                ]);
                const choices = [
                    ...(detail ? [details] : []),
                    ...(draft ? [retryDraft] : []),
                    ...(openCreated ? [openCreated] : []),
                    ...(openSelected ? [openSelected] : []), ...(retrySwitch ? [retrySwitch] : []), ...(inspectEffect ? [inspectEffect] : []),
                    ...setupActions.keys(),
                    ...(original ? [reviewOriginal] : []), ...related.keys(), ...(refresh ? [refresh] : []), ...queuedRoutes.keys(), ...routes.keys(), back,
                ];
                const heading = t(previous || dependencyChanged ? 'error.previousTitle' : projectRecoveryUpdate === 'retried' ? 'error.projectRetryHeld' : 'error.title');
                const recoveryUpdated = !!projectRecoveryUpdate && projectRecoveryUpdate !== 'retried';
                const title = [heading, ...(recoveryUpdated ? [t('error.recoveryUpdated')] : []),
                    ...(project ? [t('error.requestedProject', { project: quoteIdentity(project.id) })] : []),
                    ...(draft ? [draft.summary] : []),
                    ...(dependencyChanged ? [currentDependency ?? t('error.projectDependencyChanged')] :
                        failure && projectRecoveryUpdate !== 'relationship' ? [failure.summary] : []),
                    ...(originalEffect === null ? [t('error.originalRepositoryOperationUnavailable')] : []),
                    ...(relationshipNotice ? [relationshipNotice] : []), ...(workNotice ? [workNotice] : []), ...unavailable].join('\n');
                let action: string;
                while (true) {
                    const selected = await host.choose(title, choices);
                    if (!selected || selected === back)
                        return 'cancelled';
                    if (draft && selected === retryDraft) {
                        const outcome = sameSource() ? draft.retry() : 'changed';
                        if (outcome === 'changed')
                            throw new ErrorReviewChanged(t('error.draftChanged'));
                        if (outcome === 'failed')
                            continue recovery;
                        host.notice(t('error.draftSaved'));
                        return 'completed';
                    }
                    if (project && !sameOccurrence() && sameSource()) {
                        projectRecoveryUpdate = 'occurrence';
                        continue recovery;
                    }
                    current();
                    if (refresh && selected === refresh)
                        continue recovery;
                    const needsDependency = related.has(selected) || routes.get(selected)?.startsWith('/work ') === true;
                    if (dependencyViewChanged(needsDependency)) {
                        projectRecoveryUpdate = 'observation';
                        continue recovery;
                    }
                    action = selected;
                    if (action === reviewOriginal && original && reviewInput) {
                        const assertOriginal = () => {
                            if (!originalStillMatches(original))
                                throw new ErrorReviewChanged(t('error.originalInputChanged'));
                        };
                        assertOriginal();
                        const outcome = await reviewInput(target, original, context);
                        if (!returnToChoices(outcome)) return outcome;
                        assertOriginal();
                        continue;
                    }
                    if (action === details && detail) {
                        await showReviewAction({ show: host.showReview }, t(previous || dependencyChanged ? 'error.previousDetailsTitle' : 'error.detailsTitle'), detail, t('error.returnToChoices'));
                        current();
                        if (dependencyViewChanged())
                            projectRecoveryUpdate = 'observation';
                        continue recovery;
                    }
                    if (originalEffect && action === inspectEffect) {
                        const assertEffect = () => {
                            if (originalEffectCommand() !== originalEffect)
                                throw new ErrorReviewChanged(t('error.originalRepositoryOperationChanged'));
                        };
                        assertEffect();
                        const outcome = await host.execute(originalEffect, target, context);
                        if (!returnToChoices(outcome)) return outcome;
                        assertEffect();
                        continue;
                    }
                    const queuedEntry = queuedRoutes.get(action);
                    if (queuedEntry) {
                        const assertQueuedEntry = () => {
                            const latest = readQueued()?.find(entry => entry.assignmentId === queuedEntry.assignmentId);
                            if (!latest || latest.review?.fingerprint !== queuedEntry.review?.fingerprint || latest.unavailable !== queuedEntry.unavailable)
                                throw new ErrorReviewChanged(t('queuedTask.changed'));
                        };
                        assertQueuedEntry();
                        const outcome = await recoverQueuedTask({ controller: host.controller, locale, guard: current, choose: host.choose,
                            show: host.showReview, notice: host.notice }, queuedEntry);
                        if (!returnToChoices(outcome)) return outcome;
                        assertQueuedEntry();
                        continue;
                    }
                    const command = setupActions.get(action) ?? routes.get(action);
                    if (!command)
                        break;
                    const workId = command.startsWith('/work ') ? command.slice('/work '.length) : undefined;
                    const refreshStaleProjectWork = () => {
                        if (!project || !workId || readWorkEpoch(workId) === works.get(workId)) return false;
                        projectRecoveryUpdate = 'observation';
                        return true;
                    };
                    const routeChange = () => {
                        if (!project && workId && host.controller.inspectWork(workId).epoch !== works.get(workId))
                            return t('error.workChanged');
                        if (command === '/goal') {
                            const latest = host.controller.conversationGoal(target);
                            if (latest?.goalId !== goal?.goalId || latest?.revision !== goal?.revision)
                                return t('error.goalChanged');
                        }
                    };
                    if (refreshStaleProjectWork()) continue recovery;
                    const changed = routeChange();
                    if (changed) throw Error(changed);
                    const repairingRuntime = command === '/setup runtime';
                    const originalBeforeSetup = repairingRuntime && original && originalStillMatches(original) ? original : undefined;
                    const previousRuntime = host.controller.options.runtimeProfile;
                    const outcome = await host.execute(command, target, repairingRuntime && runtimeRepair ? { ...context, runtimeSetupFocus: runtimeRepair.focus } : context);
                    if (outcome === 'cancelled') {
                        if (!returnToChoices(outcome)) return outcome;
                        if (workId && dependencyViewChanged(true)) {
                            projectRecoveryUpdate = 'observation';
                            continue recovery;
                        }
                        if (refreshStaleProjectWork()) continue recovery;
                        const changed = routeChange();
                        if (changed) throw new ErrorReviewChanged(changed);
                        continue;
                    }
                    const runtime = host.controller.options.runtimeProfile;
                    if (outcome !== 'completed' || !reviewInput || !originalBeforeSetup || !runtime || runtime === previousRuntime)
                        return outcome;
                    if (!observeRecovery(() => sameSource() && sameOccurrence() && originalStillMatches(originalBeforeSetup)))
                        return outcome;
                    const reviewOutcome = await reviewInput(target, originalBeforeSetup, context);
                    return reviewOutcome === 'started' ? 'started' : outcome;
                }
                if (project && action === openSelected)
                    return await host.openProject(target, project, current);
                if (openConversation && createdView && action === openCreated) {
                    const latest = createdDestination();
                    if (!latest || latest.generation !== createdView.generation)
                        throw new ErrorReviewChanged(t('error.createdConversationChanged'));
                    try {
                        await openConversation(createdView.conversationId);
                    } catch {
                        throw new ErrorReviewChanged(t('error.createdConversationOpenFailed'));
                    }
                    if (!host.isCurrent(createdView.conversationId))
                        return 'cancelled';
                    host.notice(t('newConversation.returnToSource', { conversation: target }), true);
                    return 'completed';
                }
                const selected = related.get(action);
                if (openConversation && selected) {
                    const relationships = pendingRelationships();
                    const currentRelation = relationships.kind === 'observed' &&
                        relationships.items.some(item => item.conversationId === selected.conversationId) ? lookupRelated(selected.conversationId) : undefined;
                    if (currentRelation?.kind !== 'available' || currentRelation.view.generation !== selected.generation || currentRelation.view.projectId !== selected.projectId) {
                        projectRecoveryUpdate = 'relationship';
                        continue recovery;
                    }
                    await openConversation(selected.conversationId);
                    if (!host.isCurrent(selected.conversationId))
                        return 'cancelled';
                    host.notice(t('error.returnToProjectSource', { key: host.commandKeyLabel ?? 'Ctrl+G', conversation: target }), true);
                    return 'completed';
                }
                if (project && action === retrySwitch) {
                    const assertDestination = () => {
                        if (!host.controller.listProjects().some(p => p.id === project.id && p.sourceRoot === project.sourceRoot))
                            throw Error(t('project.targetChanged'));
                    };
                    assertDestination();
                    try {
                        return await host.execute('/project ' + project.id, target);
                    } catch (error) {
                        if (!(error instanceof ProjectChangeHeld) || !host.reportProjectHold) throw error;
                        current();
                        assertDestination();
                        if (error.projectTarget.id !== project.id || error.projectTarget.sourceRoot !== project.sourceRoot)
                            throw Error(t('project.targetChanged'));
                        host.reportProjectHold(target, error);
                        projectRecoveryUpdate = 'retried';
                        continue;
                    }
                }
                throw Error(t('error.unknownAction'));
            }
            catch (error) {
                if (!(error instanceof ErrorReviewChanged))
                    throw error;
                if (host.isCurrent(target))
                    host.notice(error.message);
                return 'cancelled';
            }
        }
    } }];
}

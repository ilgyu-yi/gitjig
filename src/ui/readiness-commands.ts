import { matchesExternalModel } from '../controller/model-choice.js';
import { isDeepStrictEqual } from 'node:util';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator, type UiLocale } from './i18n.js';
import { managedModelGuidance, managedModelRepairDetail, managedModelRepairState } from './managed-model-guidance.js';
import { ContextAssignmentUnavailable } from '../controller/context-coordination.js';
import { ContextWorkSettlementHeld } from '../controller/context-origin.js';
import type { Controller } from '../controller/controller.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { ApplicationModels } from '../app/models.js';
import { ApplicationStartup } from '../app/startup.js';
import { restartCommand, startupComponentLabel } from './startup-guidance.js';
import type { RuntimeProfile } from '../controller/types.js';
import type { HostCommand, HostCommandOutcome, HostCommandContext } from './host-commands.js';
import { bridgeCatalogueLabel, directModelAccount, providerLoginCommand, type ExternalModelReference } from './model-route-presentation.js';
import { isPlainRequest } from './entry-guidance.js';
import { submitKeyLabel } from './native-editor.js';
import type { ConversationView } from '../controller/interaction-types.js';
import { readProjectSource } from './project-source.js';
import { observeRecovery } from './recovery-navigation.js';
import { preparationLabel } from './conversation-activity.js';
import { inspectQueuedTaskRecovery, recoverQueuedTask, type QueuedTaskRecovery } from './queued-assignment-recovery.js';
import { interruptedOriginalInput, type RetainedInput, type ReviewRetainedInput } from './input-commands.js';
type QueueRecovery = { kind: 'review'; entry: QueuedTaskRecovery } | { kind: 'held' | 'unavailable' | 'lookup-unavailable' };
type OriginalWorkRoute = { kind: 'work'; workId: string; epoch: number; state: string } |
    { kind: 'held'; workId: string } | { kind: 'none' | 'unavailable' };

interface ReadinessHost extends UiChoiceHost {
    controller: Controller;
    hostLanguage?: string;
    restartArguments?: readonly string[] | undefined;
    accounts?: ApplicationAccounts;
    models?: ApplicationModels;
    externalModel?: ExternalModelReference;
    isCurrent(target: string): boolean;
    show?(title: string, text: string): Promise<void>;
    notice?(text: string): void;
    reviewInput?: ReviewRetainedInput;
    localRequest?(view: ConversationView, locale: UiLocale): { owner: object; label: string } | undefined;
    execute(command: string, target: string, context?: HostCommandContext): Promise<HostCommandOutcome | 'not-command'>;
}
const runtimeLabel = (runtime: RuntimeProfile | undefined, t: ReturnType<typeof translator>) => runtime ? t('value.configured', { value: runtime.dockerContext + ' · ' + runtime.image }) : t('value.notConfigured');

function readinessWorkflow(controller: Controller, view: ConversationView) {
    const id = view.conversationId, goal = controller.conversationGoal(id);
    const inputs = observeRecovery(() => controller.inspectConversationInputs(id));
    const [first, another] = inputs ?? [];
    const reviewableQueued = first?.state === 'QUEUED' && (first.failure || first.interrupted && first.eligible);
    const failedBeforeDispatch = first?.state === 'INITIAL_RESERVED' && !!view.workId && first.workId === view.workId &&
        first.eligible && first.undispatched && !!first.failure;
    const originalIdle = view.state === 'IDLE' && !another && (reviewableQueued || failedBeforeDispatch) ? first : undefined;
    return {
        state: view.state,
        role: view.role,
        live: controller.inspectConversationChangeOperation(id),
        progress: ['QUEUED', 'RUNNING'].includes(view.state) ? controller.inspectConversationProgress(id) : undefined,
        activeProducer: controller.hasActiveConversationProducer(id),
        goal: goal && { id: goal.goalId, revision: goal.revision, state: goal.state },
        inputsUnavailable: inputs === undefined,
        hasInputs: !!inputs?.length,
        eligibleInput: inputs?.some(input => input.eligible) ?? false,
        unresolvedDelivery: inputs?.some(input => input.state === 'RECONCILIATION_REQUIRED') ?? false,
        originalInput: inputs && (interruptedOriginalInput(view, inputs) ?? originalIdle),
    };
}

/** Metadata and explicit existing actions only: opening this surface never starts or resumes work. */
export function readinessCommands(host: ReadinessHost): HostCommand[] {
    return [{
            name: 'ready', descriptionId: 'command.description.ready', run: async (_argument, target, context) => {
                let completedAction = false;
                let details: boolean = false;
                let refreshNotice = false;
                const systemLanguage = host.hostLanguage ?? hostUiLanguage();
                while (host.isCurrent(target)) {
                    const selectedView = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
                    const language = host.controller.getConversationLanguage(target);
                    const interfaceLanguage = resolveUiLanguage(language.replyLanguage, systemLanguage), t = translator(interfaceLanguage.locale);
                    const externalRoute = choice.kind === 'legacy-external' || choice.kind === 'unbound' && !!host.externalModel;
                    const externalAvailable = !!host.externalModel && (choice.kind === 'unbound' || choice.kind === 'legacy-external' && matchesExternalModel(choice, host.externalModel));
                    const changed = 'Readiness target changed; return to the intended conversation and reopen /ready';
                    const readCurrentScope = () => {
                        const now = host.controller.inspectConversation(target);
                        if (!host.isCurrent(target) || now.projectId !== selectedView.projectId || now.role !== selectedView.role ||
                            now.parentId !== selectedView.parentId || now.deleted || now.archived ||
                            host.controller.getConversationLanguage(target).revision !== language.revision ||
                            host.controller.getConversationModelChoice(target).revision !== choice.revision)
                            throw Error(changed);
                        return now;
                    };
                    const sameSnapshot = (now: ConversationView) =>
                        now.generation === selectedView.generation && now.workId === selectedView.workId;
                    const assertCurrent = () => {
                        const now = readCurrentScope();
                        if (!sameSnapshot(now)) throw Error(changed);
                        return now;
                    };
                    readCurrentScope();
                    const [startup, accounts, catalogue] = await Promise.allSettled([
                        ApplicationStartup.open(host.controller).captureInspection(), host.accounts?.status() ?? Promise.resolve([]), host.models?.list() ?? Promise.resolve(undefined),
                    ]);
                    const view = readCurrentScope();
                    if (!sameSnapshot(view)) continue;
                    const promptDraft = isPlainRequest(view.draft.text);
                    const startupSelection = startup.status === 'fulfilled' ? startup.value : undefined;
                    const startupView = startupSelection?.view;
                    const activeRuntime = startupSelection ? startupSelection.activeRuntime : host.controller.options.runtimeProfile;
                    const startupUnavailable = !startupView || !!startupView.diagnostic;
                    const savedRuntimePending = startupView?.activation.runtime === 'apply';
                    const missingRuntimeAction = {
                        label: t(startupUnavailable ? 'ready.setupNext' : savedRuntimePending ? 'ready.applyRuntime' : 'ready.runtimeNext'),
                        command: host.models ? startupUnavailable ? '/setup' : '/setup runtime' : undefined,
                    };
                    const modelList = catalogue.status === 'fulfilled' ? catalogue.value : undefined;
                    const configured = accounts.status === 'fulfilled' ? accounts.value.filter(account => account.stored || account.configured) : undefined;
                    const directAccount = choice.kind === 'managed' && choice.provider !== 'claude-bridge' && host.accounts
                        ? directModelAccount(choice.provider, accounts.status === 'fulfilled' ? accounts.value : undefined, t) : undefined;
                    const accountLabel = externalRoute || !host.accounts ? t('model.route.external') : choice.kind === 'managed' && choice.provider === 'claude-bridge' ? t('model.route.claudeAccount') :
                        directAccount?.label ?? (configured ? configured.length ? configured.map(account => `${account.provider}: ${account.stored ?? t('model.route.account.configured')}`).join(', ') + ' · ' + t('value.unchecked') : t('value.noneAccounts') : t('value.statusUnavailable'));
                    const currentModel = choice.kind === 'unbound' ? host.externalModel ? t('ready.externalInvocation', { model: `${host.externalModel.provider}/${host.externalModel.modelId}` }) : t('value.unselected') + ' · ' + choice.reason : `${choice.provider}/${choice.modelId}`;
                    const future = modelList?.default;
                    const workflow = readinessWorkflow(host.controller, view);
                    const { live, progress, goal, activeProducer, inputsUnavailable, hasInputs, eligibleInput, unresolvedDelivery, originalInput } = workflow;
                    const localRequest = host.localRequest?.(view, interfaceLanguage.locale);
                    const localRequestCurrent = (now: ConversationView) => {
                        const current = host.localRequest?.(now, interfaceLanguage.locale);
                        return current?.owner === localRequest?.owner && current?.label === localRequest?.label;
                    };
                    const unfinishedGoal = goal && !['COMPLETED', 'CANCELLED'].includes(goal.state);
                    const goalOwnsContinuation = unfinishedGoal && (hasInputs || goal.state !== 'READY');
                    type Row = {
                        label: string;
                        command?: string | undefined;
                        detail?: string;
                        alternatives?: {
                            label: string;
                            command: string;
                        }[];
                        requestMethods?: true;
                        returnToRequest?: true;
                        accountConnection?: true;
                        queuedTask?: QueuedTaskRecovery;
                        retainedInput?: RetainedInput;
                    };
                    const heldInput: Row = { label: t('ready.heldNext'), command: '/inputs' };
                    const unavailableInput = t('ready.inputsUnavailable');
                    const unavailableQueue = t('ready.queuedUnavailable');
                    const reviewInput = host.reviewInput;
                    const currentRequest = (): Row | undefined => {
                        if (view.role) return;
                        if (view.state === 'UNKNOWN') {
                            if (reviewInput && originalInput)
                                return {label: t('ready.interruptedRequestNext'), retainedInput: originalInput};
                            return inputsUnavailable ? { label: unavailableInput, command: '/error' } : unresolvedDelivery ? heldInput : undefined;
                        }
                        if (view.state === 'SETTLING')
                            return { label: t('ready.cleanupNext'), returnToRequest: true };
                        if (['QUEUED', 'RUNNING'].includes(view.state)) {
                            const label = progress && progress.stage !== 'model'
                                ? t('ready.localRequestNext', { status: preparationLabel(interfaceLanguage.locale, progress.stage) })
                                : t('ready.waitNext');
                            return { label, returnToRequest: true };
                        }
                        if (localRequest && !unresolvedDelivery)
                            return { label: t('ready.localRequestNext', { status: localRequest.label }), returnToRequest: true };
                        if (activeProducer)
                            return { label: t('ready.waitNext'), returnToRequest: true };
                        if (inputsUnavailable)
                            return { label: unavailableInput, command: '/error' };
                        if (reviewInput && originalInput)
                            return { label: t(originalInput.failure ? 'ready.failedRequestNext' : 'ready.interruptedRequestNext'), retainedInput: originalInput };
                        if (hasInputs)
                            return eligibleInput && !unresolvedDelivery ? { label: t('ready.inputsNext'), command: '/inputs' } : heldInput;
                    };
                    const currentRequestNext = currentRequest();
                    const readQueue = (): QueueRecovery | undefined => {
                        if (live || goalOwnsContinuation || activeProducer || localRequest || view.role ||
                            inputsUnavailable || unresolvedDelivery || !['IDLE', 'WAITING'].includes(view.state))
                            return;
                        const entries = observeRecovery(() => inspectQueuedTaskRecovery(host.controller, target, view.generation));
                        if (!entries)
                            return { kind: 'lookup-unavailable' };
                        const [entry, another] = entries;
                        if (!entry)
                            return;
                        if (host.show && host.notice && !another && entry.review && (!hasInputs || entry.review.targetConversationId === target))
                            return { kind: 'review', entry };
                        return { kind: entries.some(item => !item.review) ? 'unavailable' : 'held' };
                    };
                    const queue = readQueue();
                    const queuedTask = queue?.kind === 'review' ? queue.entry : undefined;
                    const delegatedLookupUnavailable = queue?.kind === 'lookup-unavailable';
                    const queueIssue = delegatedLookupUnavailable || queue?.kind === 'unavailable' ? unavailableQueue :
                        queue?.kind === 'held' ? t('ready.queuedHeld') : undefined;
                    const inspectOriginal = !live && !goalOwnsContinuation && !currentRequestNext && (!queue || delegatedLookupUnavailable);
                    const readOriginalRoute = (): OriginalWorkRoute | undefined => {
                        if (!inspectOriginal)
                            return;
                        try {
                            if (view.role) {
                                const work = view.workId ? host.controller.inspectChangeActivity(view.workId) : undefined;
                                if (work)
                                    return { kind: 'work', workId: work.workId, epoch: work.epoch, state: work.state };
                                return;
                            }
                            const { workId, workEpoch, workState } = host.controller.conversationChange(target);
                            if (workId === null)
                                return { kind: 'none' };
                            if (typeof workId !== 'string' || !workId)
                                return { kind: 'unavailable' };
                            return workEpoch !== undefined && workState !== undefined
                                ? { kind: 'work', workId, epoch: workEpoch, state: workState }
                                : { kind: 'held', workId };
                        }
                        catch (error) {
                            if ((error instanceof ContextAssignmentUnavailable || error instanceof ContextWorkSettlementHeld) && error.workId)
                                return { kind: 'held', workId: error.workId };
                            return { kind: 'unavailable' };
                        }
                    };
                    const originalRoute = readOriginalRoute();
                    const original = originalRoute?.kind === 'work' ? originalRoute.workId : undefined;
                    const accountConnection: Pick<Row, 'command' | 'accountConnection'> = host.models
                        ? { accountConnection: true } : { command: '/login' };
                    const restart = t('ready.restartBody', { command: restartCommand(host.controller.applicationHome(), target, undefined, undefined, ApplicationStartup.open(host.controller).continuationArguments(host.restartArguments ?? [])) });
                    const idleOwner = !view.role && ['IDLE', 'WAITING'].includes(view.state);
                    const assessOriginal = idleOwner && !delegatedLookupUnavailable && originalRoute?.kind === 'work' ? originalRoute : undefined;
                    const readAssessment = () => assessOriginal && observeRecovery(() => {
                        const prerequisites = managedModelGuidance(host, assessOriginal.workId, interfaceLanguage.locale);
                        return { prerequisites, repairState: managedModelRepairState(host.controller, assessOriginal.state, prerequisites) };
                    });
                    const assessment = readAssessment();
                    const { prerequisites: managedPrerequisites, repairState = 'available' } = assessment ?? {};
                    const originalCurrent = () => {
                        if (!inspectOriginal)
                            return true;
                        if (readQueue()?.kind !== queue?.kind || !isDeepStrictEqual(originalRoute, readOriginalRoute()))
                            return false;
                        if (!original || delegatedLookupUnavailable)
                            return true;
                        return host.controller.options.runtimeProfile === activeRuntime &&
                            isDeepStrictEqual(assessment, readAssessment());
                    };
                    const assertOriginalRepairCurrent = () => {
                        if (!originalCurrent())
                            throw Error(t('managedRepair.changed'));
                    };
                    const originalRepairs = (workId: string, assessment: NonNullable<typeof managedPrerequisites>): NonNullable<Row['alternatives']> => {
                        const actions = [{ label: t('managedRepair.inspect'), command: `/work ${workId}` }];
                        if (repairState === 'held')
                            actions.push({ label: t('managedRepair.cancel'), command: `/change cancel ${workId}` });
                        if (repairState !== 'available')
                            return actions;
                        for (const issue of assessment.issues) {
                            if (issue.kind === 'account' && host.accounts) {
                                const command = providerLoginCommand(issue.provider);
                                actions.push({ label: t(command === '/login' ? 'managedRepair.accountPicker' : 'managedRepair.account', { provider: issue.provider }), command });
                            }
                            if (issue.kind === 'account-config' && host.models)
                                actions.push({ label: t('managedRepair.accountConfig'), command: '/model-repair' });
                            if (issue.kind === 'bridge' && host.models)
                                actions.push({ label: t('managedRepair.bridge'), command: '/bridge' });
                            if (issue.kind === 'role-config' && host.models)
                                actions.push({ label: t('managedRepair.roleConfig'), command: '/role-model' });
                        }
                        return actions.filter((action, index) => actions.findIndex(other => other.command === action.command) === index);
                    };
                    const inspectProjectFolder = async (id: string) => {
                        const root = host.controller.listProjects().find(project => project.id === id)?.sourceRoot;
                        const available = !!root && await readProjectSource(root, interfaceLanguage.locale).then(() => true, () => false);
                        return { id, root, available };
                    };
                    let projectFolder: Awaited<ReturnType<typeof inspectProjectFolder>> | undefined;
                    const existingWorkflowAction = (): Row | undefined => {
                        if (live)
                            return live.workId ? { label: t('ready.inspectRunningWork'), command: `/work ${live.workId}` }
                                : { label: t('ready.followManagedPreparation'), returnToRequest: true };
                        if (originalRoute?.kind === 'held') {
                            return { label: t('managedRepair.cleanupNext'), command: `/work ${originalRoute.workId}` };
                        }
                        if (originalRoute?.kind === 'unavailable')
                            return { label: t('ready.originalWorkUnavailable'), command: '/work' };
                        if (original && delegatedLookupUnavailable)
                            return { label: t('ready.originalNext'), command: `/work ${original}` };
                        if (goalOwnsContinuation)
                            return { label: t('ready.goalNext'), command: '/goal' };
                        if (queuedTask)
                            return { label: t('ready.queuedTask'), queuedTask };
                        return currentRequestNext ?? (queueIssue ? { label: queueIssue, command: '/error' } : undefined);
                    };
                    const recommendNextAction = async (): Promise<Row> => {
                        if (original && (assessOriginal && !assessment || managedPrerequisites?.stage === 'unavailable'))
                            return { label: t('ready.assessmentUnavailable'), command: `/work ${original}` };
                        if (original && managedPrerequisites?.allowanceHold)
                            return { label: t(`managedRepair.allowance.${managedPrerequisites.allowanceHold}`, { command: `/work ${original}` }), command: `/work ${original}` };
                        if (managedPrerequisites && !['held', 'busy', 'complete'].includes(managedPrerequisites.stage) && view.projectId && !activeRuntime)
                            return missingRuntimeAction;
                        if (original && managedPrerequisites?.issues.length) {
                            if (managedPrerequisites.issues.every(issue => issue.kind === 'bridge') && startupView?.activation.bridge === 'relaunch')
                                return { label: t('ready.restartBridge'), detail: restart };
                            return {
                                label: t('managedRepair.next'),
                                detail: managedModelRepairDetail(original, managedPrerequisites, repairState, interfaceLanguage.locale),
                                alternatives: originalRepairs(original, managedPrerequisites),
                            };
                        }
                        if (original)
                            return { label: t('ready.originalNext'), command: `/work ${original}` };
                        else if (view.role)
                            return { label: 'Next step · Inspect the original task; return to its owner for continuation', ...(view.workId ? { command: `/work ${view.workId}` } : { detail: 'This role view cannot start owner work. Return to the parent conversation with Shift+Up and inspect its /goal or /change.' }) };
                        else if (view.state === 'UNKNOWN') {
                            if (view.workId && !unresolvedDelivery)
                                return { label: t('ready.unknownWorkNext'), command: `/work ${view.workId}` };
                            if (hasInputs) return heldInput;
                            return { label: t('ready.unknownNext'), command: '/error' };
                        }
                        if (view.projectId && view.state === 'IDLE' && !unfinishedGoal) {
                            projectFolder = await inspectProjectFolder(view.projectId);
                            if (!projectFolder.available)
                                return { label: t('ready.projectSourceNext'), command: '/project' };
                        }
                        if (language.diagnostic)
                            return { label: t('ready.languageNext'), command: '/language' };
                        else if (externalRoute && !externalAvailable)
                            return {
                                label: t('ready.externalNext'),
                                detail: t('ready.externalBody', { command: restartCommand(host.controller.applicationHome(), target, undefined, undefined, ApplicationStartup.open(host.controller).continuationArguments(host.restartArguments ?? [])) + " --model-profile '/absolute/path/to/original-profile.json'" })
                            };
                        else if (!externalRoute && (host.models && catalogue.status === 'rejected' || host.accounts && accounts.status === 'rejected'))
                            return { label: t('ready.repairNext'), command: '/model-repair' };
                        else if (choice.kind === 'managed' && choice.provider === 'claude-bridge' && !host.controller.applicationModelResource())
                            return startupView?.activation.bridge === 'relaunch' ? { label: t('ready.restartBridge'), detail: restart } : { label: t('ready.bridgeNext'), ...(host.models ? { alternatives: [{ label: t('ready.restoreBridge'), command: '/bridge' }, { label: t('ready.replaceModel'), command: '/model' }] } : {}) };
                        else if (choice.kind === 'managed' && host.models && modelList && !modelList.models.some(model => model.provider === choice.provider && model.id === choice.modelId))
                            return { label: t('ready.replaceModelNext', { model: `${choice.provider}/${choice.modelId}` }), command: '/model' };
                        else if (choice.kind === 'unbound' && !host.externalModel) {
                            if (startupView?.activation.bridge === 'relaunch' && !startupView.effective?.bridge)
                                return { label: t('ready.restartBridge'), detail: restart };
                            else if (future?.provider && future.model && modelList?.models.some(model => model.provider === future.provider && model.id === future.model))
                                return { label: t('ready.defaultNext', { model: future.provider + '/' + future.model }), command: `/model ${future.provider}/${future.model}` };
                            else if (host.accounts && configured?.length === 0 && !startupView?.effective?.bridge && !startupView?.saved?.bridge)
                                return { label: t('ready.loginNext'), ...accountConnection };
                            else
                                return { label: t('ready.modelNext'), command: host.models ? '/model' : undefined };
                        }
                        else if (choice.kind === 'managed' && directAccount?.needsLogin)
                            return { label: t(/\s/u.test(choice.provider) ? 'ready.chooseAccountFor' : 'ready.connectAccountFor', { provider: choice.provider }), command: providerLoginCommand(choice.provider) };
                        else if (unfinishedGoal && !view.projectId)
                            return { label: t('ready.goalNext'), command: '/goal' };
                        else if (view.projectId && !activeRuntime)
                            return missingRuntimeAction;
                        else
                            return unfinishedGoal ? { label: t('ready.goalNext'), command: '/goal' } :
                                { label: t(view.projectId ? 'request.next' : promptDraft ? 'request.chatDraftNext' : 'request.chatNext'), requestMethods: true };
                    };
                    const workflowNext = existingWorkflowAction();
                    const next = await (workflowNext ?? recommendNextAction());
                    const workflowCurrent = (now: ConversationView) => localRequestCurrent(now) &&
                        isDeepStrictEqual(workflow, readinessWorkflow(host.controller, now)) &&
                        (inspectOriginal || queue === undefined || queue.kind === 'review' || readQueue()?.kind === queue.kind);
                    const currentRecommendationScope = readCurrentScope();
                    if (!sameSnapshot(currentRecommendationScope) ||
                        (projectFolder ? !workflowCurrent(currentRecommendationScope) : !localRequestCurrent(currentRecommendationScope)))
                        continue;
                    if (startupSelection && !startupSelection.isCurrent())
                        continue;
                    const catalogueUnavailable = catalogue.status === 'rejected';
                    const accountAction: Row = externalRoute || !host.accounts ? {
                        label: t('ready.externalAccount'), command: undefined,
                    } : accounts.status === 'rejected' ? {
                        label: t('value.repair'), command: '/model-repair',
                    } : choice.kind === 'managed' && choice.provider === 'claude-bridge' ? {
                        label: t(startupUnavailable ? 'ready.inspectBridge' : 'ready.manageBridge'),
                        command: host.models ? startupUnavailable ? '/setup inspect' : '/bridge' : undefined,
                    } : choice.kind === 'unbound' && host.models ? {
                        label: t('ready.chooseAccountSource'), ...accountConnection,
                    } : { label: t('value.login'), command: '/login' };
                    const modelAction = externalRoute ? {
                        label: t('ready.useExternal'), command: undefined,
                    } : !host.models ? { label: '', command: undefined } : {
                        label: catalogueUnavailable ? t('value.repairAction') : t('value.select'),
                        command: catalogueUnavailable ? '/model-repair' : '/model',
                    };
                    const defaultAction = !host.models ? { label: '', command: undefined } : {
                        label: catalogueUnavailable ? t('value.repairAction') : t('value.select'),
                        command: catalogueUnavailable ? '/model-repair' : '/model-default',
                    };
                    const item = (id: string, row: Row) => ({ id, ...row });
                    const projectRow = item('project', { label: t('ready.project', { project: view.projectId ?? t('value.none') }), command: '/project' });
                    const modelRow = item('model', { label: t('ready.model', { model: currentModel, action: modelAction.label }), command: modelAction.command });
                    const accountRow = item('accounts', { ...accountAction, label: t('ready.accounts', { accounts: accountLabel, action: accountAction.label }) });
                    const setupMissingRuntime = !activeRuntime && missingRuntimeAction.command === '/setup runtime';
                    const editActiveRuntime = !!activeRuntime && !!host.models && !startupUnavailable;
                    const runtimeRow = item('runtime-active', {
                        label: editActiveRuntime ? t('ready.runtimeEditable', { runtime: runtimeLabel(activeRuntime, t) }) : t('ready.runtime', {
                            runtime: runtimeLabel(activeRuntime, t),
                            action: setupMissingRuntime ? t(savedRuntimePending ? 'ready.reviewRuntimeAction' : 'ready.prepareRuntimeAction') :
                                host.models ? t('value.inspect') : ' · CLI setup inspect',
                        }),
                        command: editActiveRuntime ? '/setup runtime current' : setupMissingRuntime ? '/setup runtime' : host.models ? '/setup inspect' : undefined,
                    });
                    const activation = startupView?.activation;
                    const unknownActivation = !activation || Object.values(activation).includes('unknown');
                    const startupInspection = host.models ? '/setup inspect' : undefined;
                    const startupRow = item('startup', {
                        label: t('ready.startup', { status: startupView?.diagnostic ?? t(unknownActivation ? 'value.activationUnknown' : 'value.currentProcess'), action: host.models ? t('value.inspect') : ' · CLI setup inspect' }),
                        command: startupInspection,
                    });
                    const startupActions = unknownActivation ? [startupRow] :
                        (['runtime', 'bridge'] as const).flatMap(component => {
                            const action = activation[component];
                            if (action === 'current')
                                return [];
                            const detail = action === 'relaunch' && host.show ? restart : undefined;
                            return [item(`${component}-activation`, {
                                label: startupComponentLabel(component, action, t) + (host.models || detail ? '' : ' · CLI setup inspect'),
                                ...(detail ? { detail } :
                                    { command: action === 'apply' && host.models ? '/setup runtime' : startupInspection }),
                            })];
                        });
                    const detailRows = [
                        projectRow,
                        item('reply-language', { label: t('ready.reply', { language: language.diagnostic ?? language.replyLanguage ?? t('language.auto') }), command: '/language' }),
                        accountRow, modelRow,
                        ...(choice.kind === 'managed' && host.models ? [item('remember-model', { label: t('ready.remember'), command: `/model-default ${choice.provider}/${choice.modelId}` })] : []),
                        item('model-default', {
                            label: t('ready.future', { model: future?.provider && future.model ? future.provider + '/' + future.model : t('value.unselected'), action: defaultAction.label }), command: defaultAction.command
                        }),
                        runtimeRow,
                        item('runtime-saved', {
                            label: t('ready.savedRuntime', { runtime: startupView?.diagnostic ? t('value.savedRepair') : startupView ? runtimeLabel(startupView.saved?.runtime, t) : t('value.statusUnavailable'), action: host.models ? t('value.edit') : ' · CLI setup' }), command: host.models ? startupView?.diagnostic || !startupView ? '/setup inspect' : '/setup runtime' : undefined
                        }),
                        ...(startupActions.length ? startupActions : [startupRow]),
                        item('bridge-active', {
                            label: t('ready.bridge', { status: t(startupView?.effective?.bridge ? 'value.bridgeConfigured' : 'value.notConfigured') }), command: host.models ? '/setup inspect' : undefined
                        }),
                        item('bridge-saved', {
                            label: t('ready.savedBridge', { status: t(startupView?.diagnostic ? 'value.savedRepair' : startupView?.saved?.bridge ? 'value.savedBridge' : 'value.notConfigured'), action: host.models ? t('value.edit') : '' }), command: host.models ? startupView?.diagnostic || !startupView ? '/setup inspect' : '/bridge' : undefined
                        }),
                        item('local', { label: t('ready.local'), command: '/local' }),
                        item('repository', { label: t('ready.repo'), command: '/repo' }),
                        item('changes', { label: t('ready.changes'), command: '/change' }),
                        item('work', { label: t('ready.work'), command: '/work' }),
                        ...(!host.models ? [item('external-profile', { label: t('ready.externalDetails') })] : []),
                        ...(modelList ? [item('bridge-catalogue', { label: bridgeCatalogueLabel(modelList.bridgeCatalogue, t), command: '/model' })] : []),
                        ...(!modelList && host.models ? [item('catalogue-repair', { label: t('ready.catalogueRepair'), command: '/model-repair' })] : []),
                        item('interface-language', { label: t('language.interface', { locale: interfaceLanguage.locale, source: t(`language.source.${interfaceLanguage.source}`), requested: interfaceLanguage.requested }), command: '/language' }),
                    ];
                    const rows: (Row & {id: string})[] = details ? [
                        ...detailRows,
                        item('back-current', { label: t('ready.backCurrent') }),
                        item('return-request', { label: t('ready.returnRequest') }),
                    ] : [
                        item('next', next),
                        ...(host.show ? [item('getting-started', { label: t('ready.gettingStarted'), detail: t('ready.gettingStartedBody', { home: host.controller.applicationHome() }) })] : []),
                        projectRow, modelRow,
                        ...(host.accounts || externalRoute ? [accountRow] : []),
                        ...(view.projectId || activeRuntime || startupView?.saved?.runtime ? [runtimeRow] : []),
                        ...startupActions,
                        item('more-settings', { label: t('ready.more') }),
                        item('return-request', { label: t('ready.returnRequest') }),
                    ];
                    const title = [t(details ? 'ready.detailsTitle' : 'ready.title'),
                        ...(refreshNotice ? [t('ready.updated')] : []),
                        ...(inputsUnavailable && (details || next.label !== unavailableInput) ? [unavailableInput] : []),
                        ...(queueIssue && (details || next.label !== queueIssue) ? [queueIssue] : []),
                    ].join('\n');
                    const selected: string | undefined = await chooseUiItem(host, title,
                        rows.map(row => ({ value: row.id, label: row.label })));
                    if (!selected) {
                        if (details) { details = false; continue; }
                        return completedAction ? 'completed' : 'cancelled';
                    }
                    const row: (Row & {id: string}) | undefined = rows.find(row => row.id === selected);
                    if (!row)
                        throw Error('Unknown readiness action; reopen /ready');
                    if (row.id === 'return-request') return completedAction ? 'completed' : 'cancelled';
                    const current = readCurrentScope();
                    if (!sameSnapshot(current)) {
                        refreshNotice = true;
                        continue;
                    }
                    const recommendationCurrent = async (now: ConversationView, readScope: () => ConversationView = assertCurrent): Promise<boolean> => {
                        if (row.id !== 'next') return true;
                        if (projectFolder) {
                            const folder = await inspectProjectFolder(projectFolder.id);
                            now = readScope();
                            if (!sameSnapshot(now) || !isDeepStrictEqual(projectFolder, folder)) return false;
                        }
                        return row.requestMethods ? localRequestCurrent(now) : workflowCurrent(now);
                    };
                    const startupCurrent = () => {
                        const dependsOnStartup = (row.id === 'next' && !workflowNext) ||
                            /^(startup$|runtime-|bridge-(active|saved|activation)$)/u.test(row.id) || row.accountConnection || row.command === '/bridge';
                        if (dependsOnStartup && startupSelection && !startupSelection.isCurrent()) {
                            refreshNotice = true;
                            return false;
                        }
                        return true;
                    };
                    const nextActionOriginalCurrent = () => row.id !== 'next' || row.requestMethods || originalCurrent();
                    const recommendationStillCurrent = await recommendationCurrent(current, readCurrentScope);
                    if (!sameSnapshot(readCurrentScope()) || !recommendationStillCurrent || !nextActionOriginalCurrent()) {
                        refreshNotice = true;
                        continue;
                    }
                    if (!startupCurrent()) continue;
                    refreshNotice = false;
                    if (row.retainedInput && reviewInput) {
                        // The recommendation check awaits. Recheck the captured workflow before opening its record.
                        if (!workflowCurrent(assertCurrent())) continue;
                        const outcome = await reviewInput(target, row.retainedInput, context);
                        if (outcome !== 'cancelled') return outcome;
                        continue;
                    }
                    if (row.queuedTask && host.show && host.notice) {
                        const freshQueue = readQueue();
                        const entry = freshQueue?.kind === 'review' ? freshQueue.entry : undefined;
                        if (!entry?.review || entry.assignmentId !== row.queuedTask.assignmentId ||
                            entry.review.fingerprint !== row.queuedTask.review?.fingerprint)
                            continue;
                        const outcome = await recoverQueuedTask({
                            controller: host.controller, locale: interfaceLanguage.locale, choose: host.choose,
                            ...(host.chooseItems ? { chooseItems: host.chooseItems } : {}),
                            show: host.show, notice: host.notice,
                            guard: afterCommit => {
                                const now = assertCurrent();
                                if (!afterCommit && !workflowCurrent(now)) throw Error(t('queuedTask.changed'));
                            },
                        }, entry);
                        if (outcome === 'completed') return outcome;
                        continue;
                    }
                    if (row.id === 'more-settings' || row.id === 'back-current') {
                        details = row.id === 'more-settings';
                        continue;
                    }
                    if (row.returnToRequest)
                        return completedAction ? 'completed' : 'cancelled';
                    const originalRepair = row.id === 'next' && !!original && !!row.alternatives;
                    if (row.detail && host.show) {
                        await host.show(row.label, row.detail);
                        const now = assertCurrent();
                        if (!row.alternatives || !await recommendationCurrent(now) || !startupCurrent())
                            continue;
                        if (originalRepair) assertOriginalRepairCurrent();
                    }
                    let command = row.command;
                    if (row.accountConnection) {
                        const source = await chooseUiItem(host, t('bridge.accountChoice'), [
                            { value: 'native', label: t('bridge.nativeAccount') },
                            { value: 'direct', label: t('bridge.directAccount') },
                            { value: 'back', label: t('request.back') },
                        ]);
                        const now = assertCurrent();
                        if (!source || source === 'back')
                            continue;
                        if (!await recommendationCurrent(now) || !nextActionOriginalCurrent() || !startupCurrent())
                            continue;
                        command = source === 'native' ? '/bridge' : '/login';
                    }
                    if (row.requestMethods) {
                        const currentEntry = () => {
                            const now = assertCurrent();
                            const pending = observeRecovery(() => host.controller.inspectConversationInputs(target));
                            const original = pending && readQueue() === undefined ? readOriginalRoute() : undefined;
                            if (!pending || !original || original.kind === 'unavailable') {
                                refreshNotice = true;
                                return false;
                            }
                            const currentGoal = host.controller.conversationGoal(target);
                            if (!localRequestCurrent(now) || now.state !== view.state || host.controller.inspectConversationChangeOperation(target) || host.controller.hasActiveConversationProducer(target) ||
                                pending.length ||
                                currentGoal && !['COMPLETED', 'CANCELLED'].includes(currentGoal.state) ||
                                original.kind !== 'none')
                                throw Error('Readiness changed; reopen /ready to inspect current requests and work');
                            if (isPlainRequest(now.draft.text) !== promptDraft)
                                throw Error(t('request.draftChanged'));
                            return true;
                        };
                        if (!currentEntry())
                            continue;
                        if (!view.projectId)
                            return 'completed';
                        while (true) {
                            const method = await chooseUiItem(host, t('request.title'), [
                                { value: 'prompt', label: promptDraft ? t('request.promptDraft', { submit: submitKeyLabel() }) : t('request.prompt') },
                                { value: 'managed', label: t('request.managed') },
                                ...(host.show ? [{ value: 'help', label: t('request.help') }] : []),
                                { value: 'back', label: t('request.back') },
                            ]);
                            if (!method || method === 'back')
                                break;
                            if (!await recommendationCurrent(assertCurrent()) || !startupCurrent())
                                break;
                            if (!currentEntry())
                                break;
                            if (method === 'prompt')
                                return 'completed';
                            if (method === 'help' && host.show) {
                                await host.show(t('request.helpTitle'), t('request.helpBody'));
                                if (!currentEntry())
                                    break;
                                continue;
                            }
                            if (method !== 'managed')
                                throw Error('Unknown request method');
                            command = '/change start';
                            break;
                        }
                    }
                    if (row.alternatives) {
                        const selected = await chooseUiItem(host, t('ready.chooseRecovery'), [
                            { value: 'back', label: t('request.back') },
                            ...row.alternatives.map(action => ({ value: action.command, label: action.label })),
                        ]);
                        const now = assertCurrent();
                        if (!selected || selected === 'back')
                            continue;
                        if (!await recommendationCurrent(now) || !startupCurrent())
                            continue;
                        command = selected;
                        if (originalRepair) assertOriginalRepairCurrent();
                    }
                    if (!command)
                        continue;
                    const outcome = await host.execute(command, target, context);
                    if (outcome === 'started')
                        return 'started';
                    if (outcome === 'cancelled')
                        continue;
                    if (outcome !== 'completed')
                        return 'cancelled';
                    completedAction = true;
                    // The chosen action can legitimately change scope/model or complete a global save.
                    // A fresh iteration captures the new state; it never rolls back completed outcomes.
                }
                return completedAction ? 'completed' : 'cancelled';
            }
        }];
}

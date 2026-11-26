import { noticeResultPresentation } from './notice-result.js';
import { recordedDelegatedResultText } from './recorded-delegated-result.js';
import { sourceSaveCommands } from './source-save-commands.js';
import { resetCommands, type ResetHandoff } from './reset-commands.js';
import { errorCommands } from './error-commands.js';
import type { UiChoice } from './choices.js';
import { uiText, hostUiLanguage, resolveUiLanguage, translator, type UiLocale } from './i18n.js';
import { managedModelGuidance } from './managed-model-guidance.js';
import { matchesExternalModel } from '../controller/model-choice.js';
import { entryIssues, isPlainRequest, type EntryIssue } from './entry-guidance.js';
import { inputCommands, inputDeliveryDiagnostic, isClosedRoleFeedback, reviewConversationInputs, type RetainedInput, type RetainedInputHost, type ReviewRetainedInput } from './input-commands.js';
import { modelCommands } from './model-commands.js';
import { languageCommands } from './language-commands.js';
import { localCommands } from './local-commands.js';
import { repositoryCommands, type RepositoryInterruptHint } from './repository-commands.js';
import { newConversationAction, type NewConversationScope } from './new-conversation.js';
import { commandDiscovery } from './command-discovery.js';
import { workCommands } from './work-commands.js';
import type { ChangeView } from '../controller/change-types.js';
import { changeCommands } from './change-commands.js';
import { projectSourceUnavailableCode, readProjectSource } from './project-source.js';
import { InspectionDetails } from './inspection-details.js';
import type { ReviewPageHost } from './exact-review.js';
import { readinessCommands } from './readiness-commands.js';
import { acceptsDialogKeyEvent, hostFunctionKey, matchesHostKey } from './command-input.js';
import { productInput } from './product-input.js';
import { conversationStartupFailure, failurePresentation, ordinaryResponseFailure, type FailurePresentation } from './failure-details.js';
import { isProjectChangeHold, ProjectChangeHeld, projectCommands } from './project-commands.js';
import { goalCommands } from './goal-commands.js';
import type { Controller } from '../controller/controller.js';
import { ContextWorkSettlementHeld } from '../controller/context-origin.js';
import { ControllerError, InputRoutingUnavailable, InterruptedInputBindingChanged, ManagedReviewChanged } from '../controller/types.js';
import { managedStartExecutionHold } from '../controller/work-recovery.js';
import { observeRecovery } from './recovery-navigation.js';
import type { PiModelSelection } from '../pi/session.js';
import type { ConversationView, ConversationTurnResult, InputReceipt, LiveConversationTurnResult, NativeIdentity, NativeRegistration } from '../controller/interaction-types.js';
import { initTheme, DynamicBorder, copyToClipboard, TreeSelectorComponent } from '@earendil-works/pi-coding-agent';
import { HStack, VStack, Text, getKeybindings, matchesKey, isKeyRelease, isKeyRepeat, truncateToWidth, stripTerminalSequences, visibleWidth, type Component } from '@earendil-works/pi-tui';
import { completionCancelKeyLabel, createNativeEditorFactory, nativeHostDefinitions, prepareHostEditorSubmit, submitKeyLabel } from './native-editor.js';
import { chrome, conversationDisplayIdentity, plainTerminalText } from './chrome.js';
import { NativePane } from './native-pane.js';
import { hasCleanCleanup, responseOutcome, shellOutcome, preparationLabel, providerActivityLabel, type RequestPreparationStatus } from './conversation-activity.js';
import type { ConversationProgress } from '../controller/conversation-progress.js';
import { conversationRequestFailurePresentation } from './conversation-failure.js';
import { taskPresentation, isActiveTaskConversation, managedChangeCompletionNotice } from './task-presentation.js';
import { PreparationProgress } from './preparation-progress.js';
import { createNativeScreen, NativeTerminal } from './native-screen.js';
import { NativeDialogs } from './native-dialogs.js';
import { ConversationNavigator, compactConversationPath, conversationRelations, isNavigationTarget, type ConversationNavigationMode } from './conversation-navigator.js';
import { CommandMenu } from './command-menu.js';
import { commandKeyLabel, defaultCommandKey, isCommandKey, type CommandKey, type ConversationCommand } from './command-key.js';
import { commandInputNotice, HostCommandInputError, settleHostCommands, HostCommands, type HostCommand, type HostCommandExecutor, type HostCommandContext, type HostCommandOutcome } from './host-commands.js';
import { AccountDialog } from './account-dialog.js';
import { configurationCommands } from './configuration-commands.js';
import { ApplicationSettings } from '../app/settings.js';
import { ApplicationStartup } from '../app/startup.js';
import { HostPicker } from './host-picker.js';
import { conversationCommands as sessionCommands } from './conversation-commands.js';
import { ApplicationKeybindings } from '../app/keybindings.js';
import { forkCommand } from './fork-command.js';
import { projectAutocomplete } from './project-autocomplete.js';
export interface StartConversationUIOptions {
    initialDirectory?: string;
    restartArguments?: readonly string[];
    operatorClaude?: Readonly<import('../app/bridge-connection.js').ClaudeOperatorEnvironment>;
    controller: Controller;
    model?: PiModelSelection;
    models?: import('../app/models.js').ApplicationModels;
    conversationId: string;
    restoreView?: boolean;
    entryNotice?: string;
    onReset?: (handoff: ResetHandoff, locale: UiLocale, conversation: string) => void;
    commandKey?: CommandKey;
    signal?: AbortSignal;
    retention?: {
        completedLimit: number;
        idleGraceMs: number;
    };
    onViewCacheState?: (receipt: {
        conversationIds: readonly string[];
        limit: number;
        selectedConversationId: string;
        secondConversationId: string | null;
        visibleSecondConversationId: string | null;
        columns: number;
        paneWidth: number;
    }) => void;
}
type RetryFailure = { workId: string; runId: string; revision: number };
class DraftPersistenceHeld extends Error {}
interface SendPreparation {
    readonly abort: AbortController;
    readonly signal: AbortSignal;
    readonly retryFailure?: RetryFailure;
    stage?: 'source' | 'model' | 'context' | 'received' | 'routing';
    acknowledgeDraft?(input: InputReceipt): void;
}
interface ViewCache {
    pane: NativePane;
    dialogs: NativeDialogs;
    revision: number;
    localRevision: number;
    generation: number;
    registration: NativeRegistration | null;
    historyRead?: symbol | undefined;
    applying: boolean;
    error: string | null;
    interruptedPreview?: boolean;
    errorRevision?: number;
    failureRevision?: number;
    draftError: { summary: string; detail: string } | null;
    failure: FailurePresentation | null;
    humanSequence: number;
    idleSince: number | null;
    manualPending: boolean;
    manualAbort?: AbortController | undefined;
    manualLocale?: UiLocale;
    manualStatus: string | null;
    submitting?: boolean;
    preparingSend?: SendPreparation | undefined;
    startingResponse?: SendPreparation | undefined;
    cancellingResponse?: { runId: string | undefined; inputId: string | undefined } | undefined;
    plainDraft?: boolean;
    /** Current render description only; submission rechecks Controller state. */
    retainedReviewEntry?: boolean;
    roleFeedbackEntry?: boolean;
    roleFeedbackDraft?: boolean;
    /** Dispatched responses not yet settled; their own requests are progress, not retained input. */
    dispatching?: number;
    startingInputId?: string | undefined;
    recentAcceptedInputId?: string;
    responseStatus?: (Pick<LiveConversationTurnResult, 'status' | 'cleanup' | 'workId' | 'runId' | 'generation'> & { directionRevision?: number }) | undefined;
    standaloneOutcome?: { text: string; generation: number; projectId: string | null } | undefined;
}
function matchesRunAttempt(candidate: Pick<RetainedInput, 'workId' | 'runId'>,
    attempt: { workId?: string; runId?: string } | null): candidate is { workId: string; runId: string } {
    return !!candidate.workId && !!candidate.runId && candidate.workId === attempt?.workId && candidate.runId === attempt.runId;
}
function escapeOwner(cache: ViewCache, state: ConversationView['state'], waitingToStart: () => boolean) {
    if (cache.preparingSend)
        return { kind: 'send', abort: cache.preparingSend.abort, preparation: cache.preparingSend } as const;
    if (cache.manualAbort)
        return { kind: 'history', abort: cache.manualAbort } as const;
    if (cache.cancellingResponse || cache.startingResponse?.abort.signal.aborted)
        return;
    if (state === 'QUEUED' || state === 'RUNNING' || state === 'IDLE' && waitingToStart())
        return { kind: 'response', abort: cache.startingResponse?.abort } as const;
}
const sendHasReceipt = (preparation: SendPreparation) => preparation.stage === 'received' || preparation.stage === 'routing';
const sendCancellationLabel = (preparation: SendPreparation, locale: UiLocale) =>
    uiText(locale, sendHasReceipt(preparation) ? 'input.stoppingReceived' : 'input.cancelling');
function canReviewRetainedInputOnSend(cache: ViewCache, getNative: () => NativeRegistration | null) {
    return !cache.dispatching && !getNative();
}
function responseStopping(cache: ViewCache | undefined, progress?: ConversationProgress): boolean {
    if (!cache) return false;
    const stopping = cache.cancellingResponse;
    const aborted = cache.startingResponse?.abort.signal.aborted;
    if (!progress) return !!stopping || !!aborted;
    return stopping?.runId === progress.runId || stopping?.inputId === progress.initialInputId ||
        !!aborted && cache.startingInputId === progress.initialInputId;
}
/** Keep the failure cause and any unresolved physical cleanup visible together. */
export function summaryOutcome(result: Pick<ConversationTurnResult, 'status' | 'cleanup' | 'failure'>, locale: UiLocale = 'en'): string {
    const clean = hasCleanCleanup(result.cleanup);
    if (result.status === 'delivered' && clean)
        return uiText(locale, 'history.summaryComplete');
    const status = uiText(locale, `history.status.${result.status}`);
    if (result.failure)
        return uiText(locale, 'history.summaryFailure', { status, failure: result.failure, cleanup: clean ? '' : uiText(locale, 'history.cleanupSuffix', { cleanup: result.cleanup }) });
    return uiText(locale, 'history.summaryResult', { status, cleanup: result.cleanup });
}
/** One native terminal over the same controller and actual ordinary/role sessions. */
export async function startConversationUI(options: StartConversationUIOptions): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error('Conversation UI requires an actual interactive terminal');
    const { controller, model } = options;
    const applicationSettings = options.models ? ApplicationSettings.open(controller) : undefined;
    const applicationAccounts = options.models ? (await import('../app/accounts.js')).ApplicationAccounts.open(controller) : undefined;
    const bridgeRecoveryAvailable = !!applicationAccounts;
    const resolveTargetModel = async (target: string): Promise<PiModelSelection> => {
        const view = controller.inspectConversation(target);
        if (view.projectId && !controller.options.runtimeProfile)
            throw new Error('Project execution needs a runtime. Open /ready for the next setup step, choose Save and apply runtime, then retry this preserved draft.');
        const choice = controller.getConversationModelChoice(target);
        if (options.models && choice.kind === 'managed')
            return options.models.resolve(target);
        if (choice.kind === 'legacy-external' && !matchesExternalModel(choice, model))
            throw new Error('This conversation requires its matching explicit external model profile; select /model to rebind deliberately');
        if (model)
            return model;
        if (options.models)
            return options.models.resolve(target);
        throw new Error('Choose a model before sending input');
    };
    const resolveTargetRequest = async (target: string): Promise<import('../controller/interaction-types.js').ConversationModelRequest> => {
        const choice = controller.getConversationModelChoice(target);
        // Readiness preflight keeps setup errors in the editor; actual admission resolves afresh.
        const explicit = await resolveTargetModel(target);
        if (options.models && choice.kind === 'managed') {
            const request = options.models.conversationOperation(target);
            if (request.applicationConversation.choiceRevision !== choice.revision)
                throw Error('Conversation model changed during input preparation');
            return request;
        }
        return { model: explicit };
    };
    const newConversation = async (projectId: string | null = null, validate?: () => void) => { validate?.(); return options.models ? options.models.newConversation({ projectId }, validate) : controller.createConversation({ projectId }); };
    const commandKey = options.commandKey ?? defaultCommandKey;
    if (!isCommandKey(commandKey))
        throw new Error('Command key must be ctrl+g, ctrl+q or ctrl+p in this fixed profile');
    const keyLabel = commandKeyLabel(commandKey);
    const retention = options.retention ?? { completedLimit: 2, idleGraceMs: 60000 };
    if (!Number.isSafeInteger(retention.completedLimit) || retention.completedLimit < 0 || retention.completedLimit > 100 || !Number.isSafeInteger(retention.idleGraceMs) || retention.idleGraceMs < 0 || retention.idleGraceMs > 86400000)
        throw new Error('Retention requires completedLimit0..100 and idleGraceMs0..86400000');
    const completedLimit = retention.completedLimit, idleGraceMs = retention.idleGraceMs;
    let retentionTimer: ReturnType<typeof setTimeout> | undefined;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    type ManagedTask = {
        task: Promise<void>;
        workId?: string;
        standalone?: { workId: string; projectId: string | null };
        priorWork: string | null;
        generation: number;
        boundGeneration: number | undefined;
        noticeRevision: number;
        cache: ViewCache;
        command?: {
            text: string;
            revision: number;
        };
    };
    const managedTasks = new Map<string, ManagedTask>();
    const label = (view: ConversationView) => 'label' in view && typeof view.label === 'string' ? view.label : 'Conversation';
    const hostLanguage = hostUiLanguage();
    const localeFor = (id: string) => resolveUiLanguage(controller.getConversationLanguage(id).replyLanguage, hostLanguage).locale;
    const initialView = controller.inspectConversation(options.conversationId);
    if (initialView.deleted || initialView.archived)
        throw Error('Restore an archived conversation or choose a nondeleted conversation before UI entry');
    const presentation = new Map<string, ReturnType<ApplicationSettings['manager']>>();
    const loadPresentation = (view: ConversationView) => {
        if (!applicationSettings)
            return;
        let manager;
        try {
            manager = applicationSettings.manager(view.projectId ?? undefined);
        }
        catch (error) {
            const failure = error as NodeJS.ErrnoException;
            if (failure?.code !== 'ENOENT' || !view.projectId || !controller.listProjects().some(project =>
                project.id === view.projectId && project.sourceRoot === failure.path))
                throw error;
            manager = applicationSettings.manager();
        }
        presentation.set(view.conversationId, manager);
        return manager;
    };
    let currentTheme = loadPresentation(initialView)?.getTheme() ?? 'dark';
    initTheme(currentTheme, false);
    const terminal = new NativeTerminal(), screen = createNativeScreen(terminal);
    const applicationKeybindings = options.models ? new ApplicationKeybindings(controller) : undefined;
    const editors = createNativeEditorFactory(applicationKeybindings?.load(nativeHostDefinitions, commandKey)), views = new Map<string, ViewCache>(), owned = new Map<string, NativeIdentity>();
    const historyReads = new Set<Promise<void>>();
    const footerText = new Text('', 0, 0);
    let describeFooter = () => '';
    const footer: Component = {
        invalidate: () => footerText.invalidate(),
        render(width) {
            footerText.setText(describeFooter());
            return footerText.render(width);
        },
    };
    const editorKeyOwner = (cache: ViewCache) => {
        if (screen.hasOverlay() || screen.getFocusedComponent() !== cache.pane.editor)
            return;
        return cache.pane.editor.isShowingAutocomplete() ? 'completion' as const : 'composer' as const;
    };
    const notice = new Text('', 0, 0);
    let modelUI: ReturnType<typeof modelCommands> | undefined;
    let localUI: ReturnType<typeof localCommands> | undefined;
    let sourceSaveUI: ReturnType<typeof sourceSaveCommands> | undefined;
    let repositoryUI: ReturnType<typeof repositoryCommands> | undefined;
    const guidance = (view: ConversationView, managed: boolean) => {
        const choice = controller.getConversationModelChoice(view.conversationId);
        let account: 'present' | 'missing' | 'unavailable' | undefined;
        const idleOwner = !view.role && ['IDLE', 'WAITING'].includes(view.state);
        if (!managed && idleOwner && choice.kind === 'managed' && choice.provider !== 'claude-bridge' && applicationAccounts) {
            try {
                account = applicationAccounts.accountPresence(choice.provider) ? 'present' : 'missing';
            }
            catch {
                account = 'unavailable';
            }
        }
        const issues = entryIssues(view, choice, {
            runtime: !!controller.options.runtimeProfile,
            bridge: !!controller.applicationModelResource(),
            managed,
            ...(account ? { account } : {}),
            ...(model ? { externalModel: model } : {}),
        }, localeFor(view.conversationId));
        if (managed && view.workId && idleOwner) {
            try {
                const assessment = managedModelGuidance({
                    controller,
                    ...(options.models ? { models: options.models } : {}),
                    ...(applicationAccounts ? { accounts: applicationAccounts } : {}),
                    ...(model ? { externalModel: model } : {}),
                }, view.workId, localeFor(view.conversationId));
                issues.push(...assessment.messages.map(message => ({ kind: 'recovery' as const, message })));
            }
            catch {
                issues.push({ kind: 'recovery', message: uiText(localeFor(view.conversationId), 'managedRepair.inspectUnavailable') });
            }
        }
        return issues;
    };
    const isFeedbackDraft = (text: string): boolean => !text.trim() || isPlainRequest(text);
    const canOfferRequestSetup = (view: ConversationView, goal = controller.conversationGoal(view.conversationId)): boolean => {
        if (view.role || view.state !== 'IDLE' || view.inputNeeded || view.archived || view.deleted ||
            managedTasks.has(view.conversationId) || controller.getNativeHandle(view.conversationId)) return false;
        return (!goal || ['COMPLETED', 'CANCELLED'].includes(goal.state)) &&
            !controller.inspectConversationInputStatus(view.conversationId) &&
            (!view.workId || controller.isOrdinaryOwnerWork(view.conversationId, view.workId));
    };
    const standaloneManagedWork = (view: ConversationView) => {
        const entry = managedTasks.get(view.conversationId);
        return entry?.standalone && entry.generation === view.generation && entry.standalone.projectId === view.projectId &&
            view.workId === null && view.state === 'IDLE' && !view.role && !view.inputNeeded && !view.archived && !view.deleted
            ? entry.standalone.workId : undefined;
    };
    const observeTasks = (settledConversation?: string) => {
        const roster = controller.listConversations();
        const byId = new Map(roster.map(view => [view.conversationId, view]));
        const changes = new Map<string, ReturnType<Controller['inspectChangeActivity']>>();
        const recordedResults = new Map<string, ReturnType<Controller['inspectRecordedDelegatedResults']> | undefined>();
        const goals = new Map<string, ReturnType<Controller['conversationGoal']>>();
        const summaries = new Map<string, ReturnType<typeof taskPresentation>>();
        const waits = new Map<string, ReturnType<Controller['inspectConversationWait']>>();
        const stages = new Map<string, ConversationProgress | undefined>();
        const managedPreparations = new Map<string, ReturnType<Controller['inspectConversationChangePreparation']>>();
        const children = new Map<string, ConversationView[]>(), roles = new Map<string, ConversationView[]>();
        const activeRoleWorks = new Set<string>();
        const managedActivity = new Map<string, boolean>();
        for (const view of roster) {
            if (view.archived || view.deleted) continue;
            if (view.parentId) { const group = children.get(view.parentId) ?? []; group.push(view); children.set(view.parentId, group); }
            if (view.workId && view.role) {
                const group = roles.get(view.workId) ?? [];
                group.push(view);
                roles.set(view.workId, group);
                if (isActiveTaskConversation(view)) activeRoleWorks.add(view.workId);
            }
        }
        const change = (workId: string | null) => {
            if (!workId) return undefined;
            if (!changes.has(workId)) changes.set(workId, controller.inspectChangeActivity(workId));
            return changes.get(workId);
        };
        const goal = (view: ConversationView) => {
            if (!goals.has(view.conversationId)) goals.set(view.conversationId, controller.conversationGoal(view.conversationId));
            return goals.get(view.conversationId) ?? null;
        };
        const activeChildWorks = (view: ConversationView) => {
            const live = new Set<string>();
            for (const child of children.get(view.conversationId) ?? []) {
                if (child.state !== 'IDLE' || child.role || !child.workId || child.workId === view.workId) continue;
                if (!managedActivity.has(child.workId)) managedActivity.set(child.workId, controller.hasLiveChangeOperation(child.workId));
                if (activeRoleWorks.has(child.workId) || managedActivity.get(child.workId)) live.add(child.workId);
            }
            return live;
        };
        const progress = (view: ConversationView) => {
            if (view.state !== 'QUEUED' && view.state !== 'RUNNING' || views.get(view.conversationId)?.manualPending) return;
            if (!stages.has(view.conversationId)) stages.set(view.conversationId, controller.inspectConversationProgress(view.conversationId));
            return stages.get(view.conversationId);
        };
        const summary = (view: ConversationView, locale: UiLocale = localeFor(view.conversationId)) => {
            const key = view.conversationId + ':' + locale;
            let result = summaries.get(key);
            if (!result) {
                const standaloneWork = view.conversationId !== settledConversation ? standaloneManagedWork(view) : undefined;
                const workId = view.workId ?? standaloneWork ?? null;
                const related = new Map([...(children.get(view.conversationId) ?? []), ...(roles.get(workId ?? '') ?? [])].map(other => [other.conversationId, other]));
                if (view.state === 'WAITING' && !waits.has(view.conversationId)) waits.set(view.conversationId, controller.inspectConversationWait(view.conversationId));
                const wait = waits.get(view.conversationId);
                const waitActivities: NonNullable<ReturnType<Controller['inspectChangeActivity']>>[] = [];
                for (const target of wait?.targets ?? []) {
                    const other = byId.get(target.conversationId);
                    if (other) related.set(other.conversationId, other);
                    for (const role of roles.get(target.workId ?? '') ?? []) related.set(role.conversationId, role);
                    const activity = change(target.workId);
                    if (activity) waitActivities.push(activity);
                }
                const cache = views.get(view.conversationId);
                let navigatorRequestLabel: string | undefined;
                if (hostDialog instanceof ConversationNavigator && !view.inputNeeded) {
                    const stage = progress(view);
                    if (stage) {
                        const native = controller.getNativeHandle(view.conversationId);
                        const report = native?.identity.runId === stage.runId ? native.providerActivity : undefined;
                        navigatorRequestLabel = responseStopping(cache, stage) ? uiText(locale, 'activity.cancelling') :
                            providerActivityLabel(locale, report) ?? cache?.pane.activity.observedPhaseLabel(stage.runId, locale) ?? preparationLabel(locale, stage.stage);
                    } else if (view.state === 'IDLE' && cache && (cache.preparingSend || cache.dispatching)) {
                        navigatorRequestLabel = requestEntry(cache, view, locale, !!cache.dispatching || !!controller.getNativeHandle(view.conversationId)).label;
                    }
                }
                const cid = view.conversationId;
                if (!managedPreparations.has(cid))
                    managedPreparations.set(cid, controller.inspectConversationChangePreparation(cid));
                result = taskPresentation({ view, roster: [...related.values()], changeActivity: change(workId), goal: goal(view), wait, standaloneManagedWork: standaloneWork,
                    waitActivities, activeChildWorks: activeChildWorks(view), managedPending: view.conversationId !== settledConversation && managedTasks.has(view.conversationId),
                    managedPreparation: managedPreparations.get(cid), showResultShortcut: view.conversationId === selected, navigatorRequestLabel,
                    roleNative: id => controller.getNativeHandle(id), locale });
                summaries.set(key, result);
            }
            return result;
        };
        return { roster, change, goal, progress, summary, activeChildWorks, recorded: (view: ConversationView) => {
            if (!recordedResults.has(view.conversationId))
                recordedResults.set(view.conversationId, observeRecovery(() => controller.inspectRecordedDelegatedResults(view.conversationId)));
            return recordedResults.get(view.conversationId);
        } };
    };
    const initiallyRetained = initialView.state === 'IDLE' && !!controller.inspectConversationInputStatus(initialView.conversationId);
    let noticeMessage = !initiallyRetained && guidance(initialView, !!initialView.workId && !!controller.inspectChangeActivity(initialView.workId)).length
        ? uiText(localeFor(initialView.conversationId), 'pane.firstRun') : '';
    let noticeRevision = 0, wrapNotice = false;
    const setNotice = (message: string, wrap = false) => { noticeMessage = message; wrapNotice = wrap; noticeRevision++; render(); };
    let selected = options.conversationId, second: string | null = null, closing = false, sequence = 0, terminalStarted = false;
    const menuBorder = new DynamicBorder();
    const modelStatus: Component = {
        invalidate() { },
        render(width) {
            const registration = controller.getNativeHandle(selected);
            const current = registration?.session.model;
            const choice = controller.getConversationModelChoice(selected);
            const t = translator(localeFor(selected));
            const identity = (model: string, provider: string) => t('model.footer', { model, provider });
            const text = registration
                ? current ? identity(current.id, current.provider) : t('model.footerUnavailable')
                : choice.kind === 'managed' ? identity(choice.modelId, choice.provider) + ' · ' + t('model.footerThinking', { level: choice.thinkingLevel })
                    : choice.kind === 'legacy-external' ? identity(choice.modelId, choice.provider) + ' · ' + t(matchesExternalModel(choice, model) ? 'model.footerExternal' : 'model.footerExternalRequired')
                        : model ? identity(model.modelId, model.provider) : t('model.unselected');
            return [chrome(current || !registration ? 'model' : 'attention', truncateToWidth(stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '), Math.max(1, width), '…'))];
        },
    };
    let leftId = selected;
    const lastChild = new Map<string, string>();
    if (initialView.parentId)
        lastChild.set(initialView.parentId, selected);
    let hierarchyPending = false;
    let forcedDraftFailure: Error | undefined;
    let switchPending = false;
    let hostDialog: Component | undefined, hostDialogCancel: (() => void) | undefined;
    // One user-opened command owns input through its nested menus and asynchronous reads.
    // This is presentation ownership only; controller operations keep their original guards.
    type HostInteraction = { locale: UiLocale; action: string; source: string; conversationId: string; acknowledgeInspection?: () => void; interrupt: AbortController | undefined; interruptHint: RepositoryInterruptHint | undefined };
    let hostInteraction: HostInteraction | undefined;
    let hostWait: { owner: HostInteraction; timer: ReturnType<typeof setTimeout> | undefined } | undefined;
    const clearHostWait = () => {
        clearTimeout(hostWait?.timer);
        hostWait = undefined;
    };
    const composerAcceptsInput = () => !closing && !hostDialog && !hostInteraction && !switchPending;
    const interactionTasks = new Set<Promise<unknown>>();
    const interactionWaiting = new Text('', 0, 0);
    const releaseHostInteraction = (owner: object | undefined) => {
        if (owner && hostInteraction === owner) {
            hostInteraction = undefined;
            render();
        }
    };
    const describeHostInteraction = (owner: HostInteraction | undefined, action: string) => {
        if (owner && hostInteraction === owner && !closing) {
            owner.action = action;
            render();
        }
    };
    const withHostActivity = async <T>(target: string, describe: (locale: UiLocale) => string, task: () => Promise<T>, interrupt?: AbortController, interruptHint?: RepositoryInterruptHint): Promise<T> => {
        const owner = hostInteraction;
        if (!owner || owner.conversationId !== target || selected !== target || closing)
            return task();
        const previous = owner.action, previousInterrupt = owner.interrupt, previousHint = owner.interruptHint, action = describe(owner.locale);
        try {
            owner.interrupt = interrupt;
            owner.interruptHint = interruptHint;
            describeHostInteraction(owner, action);
            return await task();
        }
        finally {
            owner.interrupt = previousInterrupt;
            owner.interruptHint = previousHint;
            if (owner.action === action)
                describeHostInteraction(owner, previous);
        }
    };
    const runHostInteraction = <T>(action: () => Promise<T>, actionLabel: string, source = selected, acknowledgeInspection?: () => void): Promise<T | undefined> => {
        if (closing || hostInteraction) return Promise.resolve(undefined);
        const owner: HostInteraction = { locale: localeFor(source), action: actionLabel, source: conversationDisplayIdentity(controller.inspectConversation(source)), conversationId: source, interrupt: undefined, interruptHint: undefined,
            ...(acknowledgeInspection ? {acknowledgeInspection} : {}) };
        hostInteraction = owner;
        const task = Promise.resolve().then(() => { render(); return action(); }).finally(() => releaseHostInteraction(owner));
        interactionTasks.add(task);
        void task.then(() => interactionTasks.delete(task), () => interactionTasks.delete(task));
        return task;
    };
    let done: () => void;
    const leaving = new Promise<void>(resolve => done = resolve);
    const requestClose = (forced = false) => {
        if (closing)
            return;
        for (const cache of views.values()) {
            persist(cache);
            if (cache.draftError) {
                setNotice(`Draft for ${cache.pane.conversationId} is not saved. Keep this view open, restore state storage and retry.`);
                screen.requestRender();
                if (!forced)
                    return;
                forcedDraftFailure = new Error(`Forced terminal shutdown: conversation ${cache.pane.conversationId}, unsaved editor revision ${cache.localRevision}, last acknowledged durable revision ${cache.revision}; exact current text was not saved`);
            }
        }
        closing = true;
        clearHostWait();
        for (const cache of views.values()) { cache.preparingSend?.abort.abort(); cache.manualAbort?.abort(); cache.startingResponse?.abort.abort(); }
        controller.quiesceInteractionHost();
        hostDialogCancel?.();
        interactionWaiting.setText(uiText(localeFor(selected), 'interaction.closing'));
        screen.setLayoutRoot(interactionWaiting);
        screen.setFocus(interactionWaiting);
        screen.requestRender();
        done();
    };
    const onAbort = () => requestClose(true);
    const setError = (cache: ViewCache, error: string | FailurePresentation | null) => {
        if (error !== null || cache.error !== null) cache.errorRevision = (cache.errorRevision ?? 0) + 1;
        if (error && typeof error === 'object') {
            cache.failure = error;
            cache.failureRevision = cache.errorRevision!;
            cache.error = error.summary;
        } else cache.error = error;
    };
    const failureIsActive = (cache: ViewCache) => cache.error !== null && cache.failure !== null && cache.failureRevision === cache.errorRevision;
    const prepareProjectSourceCheck = (target: string) => {
        const cache = views.get(target), failure = cache?.failure, revision = cache?.errorRevision;
        if (!cache || failure?.code !== projectSourceUnavailableCode || !failureIsActive(cache))
            return;
        return () => {
            if (views.get(target) === cache && cache.failure === failure && cache.errorRevision === revision && failureIsActive(cache))
                setError(cache, null);
        };
    };
    const setResponseFailure = (cache: ViewCache, failure: FailurePresentation) => setError(cache, { ...failure, submittedRequest: true });
    const retryingFailure = (cache: ViewCache) => {
        const retry = cache.startingResponse?.retryFailure;
        return !!retry && failureIsActive(cache) && retry.revision === cache.failureRevision && matchesRunAttempt(retry, cache.failure);
    };
    const retireStaleResponseFailure = (cache: ViewCache) => {
        const failure = cache.failure;
        if (!failure || !failureIsActive(cache) || retryingFailure(cache)) return;
        const target = cache.pane.conversationId;
        if (failure.inputId) {
            try {
                if (!controller.inspectConversationInputs(target).some(input => input.inputId === failure.inputId))
                    setError(cache, null);
            } catch { /* A failed read cannot establish that this input resolved. */ }
            return;
        }
        if (failure.code === 'CONVERSATION_REQUEST_LIMIT' && controller.inspectConversationRequestFailure(target)?.runId !== failure.runId ||
            (failure.code === 'CAPTURE_UNSUPPORTED_LINK' || failure.code === 'RUNTIME_HELPER_UNAVAILABLE' || failure.code === 'RUNTIME_CONTEXT_MISSING') &&
                controller.inspectConversationStartupFailure(target)?.runId !== failure.runId)
            setError(cache, null);
    };
    const presentFailure = (cache: ViewCache, error: unknown) => {
        if (error instanceof InputRoutingUnavailable && error.conversationId === cache.pane.conversationId)
            return {
                ...failurePresentation({ code: error.code, message: uiText(localeFor(error.conversationId), 'error.inputRouting'),
                    recovery: error.recovery + '\nInput: ' + error.inputId }),
                inputId: error.inputId,
            };
        if (error instanceof InterruptedInputBindingChanged) {
            const locale = localeFor(cache.pane.conversationId);
            return { ...failurePresentation({ code: error.code, workId: error.workId, runId: error.runId,
                message: uiText(locale, `input.recoveryBinding.${error.reason}`),
                recovery: uiText(locale, `input.recoveryBinding.${error.reason}Next`) }), inputId: error.inputId };
        }
        if (error instanceof ControllerError && error.code === 'DRAFT_ACKNOWLEDGEMENT_UNAVAILABLE')
            return failurePresentation({ code: error.code, message: uiText(localeFor(cache.pane.conversationId), 'error.draftAdmission'), recovery: error.recovery });
        if (error instanceof ContextWorkSettlementHeld) return failurePresentation({
            code: error.code, workId: error.workId,
            message: uiText(localeFor(cache.pane.conversationId), 'error.contextSettlement'),
            recovery: uiText(localeFor(cache.pane.conversationId), 'error.contextSettlementRecovery', {work: error.workId!}),
        });
        if (error instanceof ControllerError && error.code === 'MANAGED_START_EXECUTION_EXHAUSTED' && error.workId) {
            const conversation = cache.pane.conversationId, workId = error.workId;
            const locale = localeFor(conversation);
            const message = uiText(locale, 'change.startExecutionExhausted');
            return {...failurePresentation({code: error.code, workId, message,
                recovery: uiText(locale, 'change.startExecutionRecovery', {work: workId})}), summary: message,
                originalHoldIsActive: () => {
                    const allowance = observeRecovery(() => controller.inspectConversationChangeStart(conversation).allowance);
                    return allowance?.sourceWorkId !== workId || !!managedStartExecutionHold(allowance);
                }};
        }
        if (error instanceof ControllerError && error.code === 'MANAGED_START_ALLOWANCE_CHANGED')
            return failurePresentation({code: error.code, message: uiText(localeFor(cache.pane.conversationId), 'change.startAllowanceChanged')});
        if (error instanceof ManagedReviewChanged) {
            const key = {runtime: 'change.startRuntimeChanged', draft: 'change.sourceChanged', allowance: 'change.workChanged'} as const;
            return failurePresentation({code: error.code, workId: error.workId, message: uiText(localeFor(cache.pane.conversationId), key[error.reason])});
        }
        return failurePresentation(error);
    };
    const report = (cache: ViewCache, error: unknown) => {
        if (error instanceof DraftPersistenceHeld) {
            if (selected === cache.pane.conversationId)
                setNotice(error.message);
            return;
        }
        const failure = presentFailure(cache, error);
        setError(cache, failure);
        render();
    };
    const reportDraftFailure = (cache: ViewCache, error: unknown) => {
        const { code, errcode } = (error instanceof Error ? error : {}) as NodeJS.ErrnoException & { errcode?: number };
        const full = code === 'ENOSPC' || code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' &&
            Number.isInteger(errcode) && errcode >= 0 && errcode <= 0x7fffffff && (errcode & 0xff) === 13;
        const locale = localeFor(cache.pane.conversationId);
        cache.draftError = {
            summary: uiText(locale, full ? 'error.draftStorageFull' : 'error.draftNotSaved'),
            detail: failurePresentation(error).detail,
        };
        render();
    };
    const saveScroll = (cache: ViewCache) => {
        const anchor = cache.pane.scrollAnchor();
        if (anchor.entryId !== null)
            controller.setScroll({ conversationId: cache.pane.conversationId, ...anchor });
    };
    const visibleSecond = () => terminal.columns >= 100 && second !== selected ? second : null;
    const narrowSplitNotice = () => uiText(localeFor(selected), 'navigation.splitNarrow', { key: keyLabel });
    const paneWidth = () => visibleSecond() ? Math.max(1, Math.floor(terminal.columns / 2)) : terminal.columns;
    const applyActivePresentation = () => {
        const manager = presentation.get(selected);
        if (!manager)
            return;
        const theme = manager.getTheme() ?? 'dark';
        if (theme !== currentTheme) {
            currentTheme = theme;
            initTheme(theme, false);
        }
        screen.setCopyOnSelect(manager.getFullscreenCopyOnSelect());
        screen.setWheelScrollLines(manager.getFullscreenWheelScrollLines());
    };
    const applyPanePresentation = (pane: NativePane, view: ConversationView) => {
        const manager = loadPresentation(view);
        if (manager)
            pane.setPresentation({ hideThinking: manager.getHideThinkingBlock(), padding: manager.getEditorPaddingX(),
                autocomplete: manager.getAutocompleteMaxVisible(), scrollbar: manager.getFullscreenScrollbar() });
    };
    const assertPresentationChange = () => { if (screen.hasActiveSelection())
        throw new Error('Copy or clear the active text selection before changing presentation'); };
    const reloadPresentation = () => {
        assertPresentationChange();
        if (hostDialog || screen.hasOverlay() || [...views.values()].some(cache => cache.dialogs.component))
            throw new Error('Finish the active dialog before reloading application settings');
        const bindings = applicationKeybindings?.load(nativeHostDefinitions, commandKey);
        for (const [id, cache] of views)
            applyPanePresentation(cache.pane, controller.inspectConversation(id));
        if (bindings)
            editors.bindings.setUserBindings(bindings);
        applyActivePresentation();
        render();
    };
    const persist = (cache: ViewCache) => {
        if (cache.applying)
            return;
        try {
            const receipt = controller.setDraft({ conversationId: cache.pane.conversationId, expectedRevision: cache.revision, text: cache.pane.editor.getExpandedText() });
            const responseFailure = failureIsActive(cache) && cache.failure?.submittedRequest;
            if (!cache.draftError && !responseFailure && receipt.revision !== cache.revision)
                setError(cache, null);
            cache.revision = receipt.revision;
            cache.draftError = null;
        }
        catch (error) {
            reportDraftFailure(cache, error);
        }
    };
    const requestOwnerFor = (cache: ViewCache, inputId: string | undefined) =>
        inputId && cache.startingInputId === inputId ? cache.startingResponse?.abort : undefined;
    type RequestObservation = {
        progress?: ConversationProgress | undefined;
        hasRun: boolean;
        pending: ReturnType<Controller['inspectConversationInputStatus']>;
    };
    const waitingForRequestAdmission = (cache: ViewCache, view: ConversationView): boolean => {
        // An additional owner input changes direction while the current request is acquiring a run.
        const owner = cache.startingResponse;
        return !!owner && !cache.registration && (view.state === 'IDLE' || view.state === 'WAITING') &&
            !cache.pane.activity.hasBoundRequest(owner.abort) &&
            !!controller.inspectConversationInputStatus(view.conversationId, cache.startingInputId)?.activeInputQueued;
    };
    const awaitingResponseStart = (cache: ViewCache, view: ConversationView, observation?: RequestObservation): boolean => {
        if (view.state !== 'IDLE' || view.archived || view.deleted || view.inputNeeded || !cache.startingResponse ||
            cache.startingResponse.abort.signal.aborted || cache.cancellingResponse)
            return false;
        const { hasRun, pending } = observation ?? {
            hasRun: !!controller.inspectConversationProgress(view.conversationId) || !!controller.getNativeHandle(view.conversationId),
            pending: controller.inspectConversationInputStatus(view.conversationId, cache.startingInputId),
        };
        // The issued request can be an explicit retry of a later queue entry.
        return !hasRun && !!pending?.activeInputQueued;
    };
    // Dispatch remains owned after resource cleanup until the result handoff completes.
    const finalizingResponse = (cache: ViewCache, view: ConversationView): boolean => {
        const owner = cache.startingResponse;
        return view.state === 'IDLE' && !view.inputNeeded && !!owner && cache.pane.activity.hasBoundRequest(owner.abort);
    };
    const retainInputForReview = (cache: ViewCache, view: ConversationView): boolean =>
        view.state === 'SETTLING' || finalizingResponse(cache, view);
    const requestEntry = (cache: ViewCache, view: ConversationView, locale: UiLocale, responseActive: boolean, observation?: RequestObservation) => {
        const primarySend = responseActive ? undefined : cache.preparingSend;
        const stage = cache.preparingSend?.stage;
        const sendStatus = stage ? `input.stage.${stage}` as const : 'activity.preparing';
        const awaitingRun = awaitingResponseStart(cache, view, observation);
        const preparingStatus: RequestPreparationStatus | undefined = awaitingRun ? 'activity.queued' :
            finalizingResponse(cache, view) ? 'activity.finishing' : primarySend ? sendStatus : undefined;
        const cancellingSend = primarySend?.abort.signal.aborted ? sendCancellationLabel(primarySend, locale) : undefined;
        const cancellingResponse = responseStopping(cache, observation?.progress);
        const preparing = !!preparingStatus && !['RUNNING', 'SETTLING'].includes(view.state) ||
            view.state === 'IDLE' && !!cache.startingResponse && cancellingResponse;
        const stoppingLabel = cancellingResponse ? uiText(locale, 'activity.cancelling') : undefined;
        const managed = managedTasks.get(view.conversationId);
        const label = preparing && !view.archived && !view.deleted && ['IDLE', 'QUEUED', 'WAITING'].includes(view.state) &&
            !cache.manualPending && !(managed && !managed.workId)
            ? stoppingLabel ?? cancellingSend ?? (preparingStatus && uiText(locale, preparingStatus)) : undefined;
        return { primarySend, preparing, sendStageLabel: uiText(locale, sendStatus), awaitingRun, preparingStatus,
            cancellingSend, cancellingResponse, label };
    };
    const localRequestStatus = (view: ConversationView, locale: UiLocale) => {
        const cache = views.get(view.conversationId);
        if (!cache || cache.generation !== view.generation || view.role || view.inputNeeded ||
            (view.state !== 'IDLE' && view.state !== 'WAITING')) return;
        const owner = cache.startingResponse ?? cache.preparingSend;
        if (!owner || controller.getNativeHandle(view.conversationId) || controller.inspectConversationProgress(view.conversationId))
            return;
        const pending = controller.inspectConversationInputStatus(view.conversationId, cache.startingInputId);
        const { label } = requestEntry(cache, view, locale, !!cache.dispatching, { hasRun: false, pending });
        if (label) return { owner, label };
    };
    const bind = (cache: ViewCache, registration: NativeRegistration) => {
        if (!registration.session || cache.registration === registration)
            return;
        cache.dialogs.dispose();
        cache.dialogs = new NativeDialogs(screen, editors.bindings, () => {
            if (cache.registration && controller.getNativeHandle(cache.pane.conversationId)?.session === cache.registration.session)
                controller.updateNativeDialogs({ identity: cache.registration.identity, requestIds: cache.dialogs.requestIds });
            render();
        });
        cache.registration = registration;
        cache.historyRead = undefined;
        cache.interruptedPreview = false;
        cache.generation = registration.identity.generation;
        owned.set(registration.identity.runId, structuredClone(registration.identity));
        cache.pane.attach(registration.session, registration.sessionManager, registration.identity.runId, requestOwnerFor(cache, registration.identity.initialInputId));
        const base = registration.session.extensionRunner.getUIContext();
        const ui = cache.dialogs.context(base, cache.pane.editor, message => { setError(cache, message); render(); }, handler => screen.addInputListener(data => !closing && !hostDialog && !hostInteraction && selected === cache.pane.conversationId ? handler(data) : undefined));
        // Public synchronous native UI binding at ready; do not rerun session_start
        // or replace installed request/checkpoint/finishTurn hooks during streaming.
        registration.session.extensionRunner.setUIContext(ui, 'tui');
    };
    const activityRefreshes = new WeakSet<NativeRegistration>();
    const cacheFor = (view: ConversationView, observations = observeTasks()): ViewCache => {
        let cache = views.get(view.conversationId);
        if (!cache) {
            const pane = new NativePane(view.conversationId, screen, editors, (sessionId, entryId, nativeText) =>
                controller.inspectNativeInputPresentation(view.conversationId, sessionId, entryId, nativeText),
                (details, content) => controller.inspectCoordinationNoticePresentation(view.conversationId, details, content), session => {
                    const current = cache, registration = current?.registration;
                    if (!current || !registration || registration.session !== session || activityRefreshes.has(registration))
                        return;
                    activityRefreshes.add(registration);
                    queueMicrotask(() => {
                        activityRefreshes.delete(registration);
                        if (closing || views.get(view.conversationId) !== current || controller.getNativeHandle(view.conversationId) !== registration)
                            return;
                        try { render(); } catch (error) { report(current, error); }
                    });
                });
            applyPanePresentation(pane, view);
            cache = { pane, dialogs: new NativeDialogs(screen, editors.bindings, () => render()), revision: view.draft.revision, localRevision: view.draft.revision, generation: view.generation, registration: null, applying: true, error: null, draftError: null, failure: null, humanSequence: view.humanLastUsed, idleSince: null, manualPending: false, manualStatus: null };
            sequence = Math.max(sequence, view.humanLastUsed);
            views.set(view.conversationId, cache);
            const retained = controller.inspectRetainedConversationResponse(view.conversationId, view.state === 'IDLE');
            const locale = localeFor(view.conversationId);
            switch (retained?.kind) {
                case 'request-limit':
                    setResponseFailure(cache, conversationRequestFailurePresentation(retained.value, locale));
                    break;
                case 'startup-failure':
                    setResponseFailure(cache, conversationStartupFailure(retained.value, locale));
                    break;
                case 'response-failure':
                    setResponseFailure(cache, ordinaryResponseFailure(retained.value, locale, bridgeRecoveryAvailable));
                    break;
                case 'interruption':
                    cache.responseStatus = { ...retained.value, generation: view.generation };
                    break;
                case 'completion':
                    cache.responseStatus = retained.value;
                    break;
            }
            pane.editor.setText(view.draft.text);
            const autocomplete = projectAutocomplete({ controller, conversationId: view.conversationId, slash: slash.autocompleteFor(() => localeFor(view.conversationId)),
                locale: () => localeFor(pane.conversationId), isCurrent: () => ownsRequestNotice(cache!) && !!editorKeyOwner(cache!),
                revision: () => cache!.localRevision,
                captureNotice: () => {
                    const revision = noticeRevision, cursor = pane.editor.getCursor(), text = pane.editor.getText();
                    return message => {
                        const current = pane.editor.getCursor();
                        if (revision === noticeRevision && cursor.line === current.line && cursor.col === current.col && text === pane.editor.getText())
                            requestNotice(cache!, message);
                    };
                },
            });
            pane.editor.setAutocompleteProvider(autocomplete);
            cache.applying = false;
            pane.editor.disableSubmit = true;
            const captured = cache;
            pane.editor.onChange = () => {
                if (captured.applying)
                    return;
                captured.localRevision++;
                const hadNotice = !!noticeMessage || !!captured.standaloneOutcome;
                captured.standaloneOutcome = undefined;
                noticeMessage = '';
                noticeRevision++;
                persist(captured);
                if (hadNotice || captured.plainDraft !== isPlainRequest(captured.pane.editor.getExpandedText()) ||
                    captured.roleFeedbackDraft !== isFeedbackDraft(captured.pane.editor.getExpandedText()))
                    render();
            };
            pane.editor.onEscape = () => {
                // Pi dismisses visible suggestions itself. Cancel an in-flight lookup before its list exists.
                pane.editor.setAutocompleteProvider(autocomplete);
                const view = controller.inspectConversation(pane.conversationId);
                const owner = escapeOwner(captured, view.state, () => awaitingResponseStart(captured, view));
                if (!owner)
                    return;
                owner.abort?.abort();
                // Before a run is observed, the exact local dispatch signal owns cancellation.
                if (owner.kind !== 'response' || view.state === 'IDLE') {
                    if (owner.kind === 'history')
                        captured.manualStatus = uiText(captured.manualLocale ?? localeFor(pane.conversationId), 'history.cancelling');
                    render();
                    return;
                }
                const runId = controller.inspectConversationProgress(pane.conversationId)?.runId;
                captured.cancellingResponse = { runId, inputId: runId ? undefined : captured.startingInputId };
                render();
                void controller.interruptConversation({ conversationId: pane.conversationId, expectedGeneration: captured.generation }).catch(error => report(captured, error)).finally(() => { captured.cancellingResponse = undefined; render(); });
            };
            pane.editor.onCtrlD = () => requestClose();
            const nativeMouse = pane.editor.handleMouse.bind(pane.editor);
            pane.editor.handleMouse = event => {
                if (hostDialog || hostInteraction || switchPending)
                    return { handled: true, focus: false };
                const result = nativeMouse(event);
                if (result?.focus && pane.conversationId !== selected) {
                    try {
                        if (closing || hostDialog || pane.conversationId !== visibleSecond())
                            return { ...result, focus: false };
                        activateConversation(pane.conversationId);
                        render();
                        pruneViews();
                    }
                    catch (error) {
                        const current = views.get(selected);
                        if (current)
                            report(current, error);
                        return { ...result, focus: false };
                    }
                }
                return result;
            };
        }
        const registration = controller.getNativeHandle(view.conversationId);
        if (registration)
            bind(cache, registration);
        else if (cache.registration) {
            cache.pane.detach();
            cache.registration = null;
            cache.dialogs.dispose();
        }
        if (cache.generation !== view.generation)
            cache.historyRead = undefined;
        cache.generation = view.generation;
        const task = observations.summary(view), goal = observations.goal(view);
        const managed = managedTasks.get(view.conversationId), preparingTask = task.preparationStatus;
        const notices = observeRecovery(() => controller.inspectNotifications(view.conversationId, { unreadOnly: true }));
        const roster = observations.roster;
        const related = !!view.parentId || roster.some(other => !other.archived && !other.deleted && other.parentId === view.conversationId);
        const simpleEntry = !related && !view.workId && !goal && !view.historyRef && !view.role && !roster.some(other => other.conversationId !== view.conversationId && !other.archived && !other.deleted);
        const progress = observations.progress(view);
        const activeInputId = progress?.initialInputId ?? cache.startingInputId;
        const previewInputId = cache.recentAcceptedInputId ?? activeInputId;
        const pendingInputs = controller.inspectConversationInputStatus(view.conversationId, activeInputId, previewInputId);
        const responseActive = !!cache.dispatching || !!registration || ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state);
        if (failureIsActive(cache) && (cache.failure?.originalHoldIsActive?.() === false ||
            !responseActive && cache.failure?.code === 'PROJECT_RESPONSE_ACTIVE' && !controller.hasActiveConversationProducer(view.conversationId))) {
            // Retire the notice while preserving the same failure and its open review.
            cache.error = null;
        }
        const additionalSend = responseActive ? cache.preparingSend : undefined;
        const paneLocale = localeFor(view.conversationId);
        cache.pane.setLocale(paneLocale);
        const { primarySend, preparing, sendStageLabel, awaitingRun, preparingStatus, cancellingSend, cancellingResponse,
            label: entry } = requestEntry(cache, view, paneLocale, responseActive,
            { progress, hasRun: !!progress || !!registration, pending: pendingInputs });
        const relations = related ? conversationRelations(roster, view.conversationId, paneWidth(), id => {
            const other = roster.find(entry => entry.conversationId === id);
            if (other?.role) return uiText(paneLocale, `state.${other.state}`);
            const context = other ? observations.summary(other, paneLocale) : undefined;
            return context?.idleStatus ?? context?.resourceLabel ?? '';
        }, localeFor(view.conversationId)).map(text => chrome('context', text)) : [];
        if (!notices) {
            relations.push(chrome('context', truncateToWidth(uiText(paneLocale, 'notice.listUnavailable'), paneWidth(), '…')));
        } else if (notices.length) {
            const key = view.conversationId === selected ? 'pane.noticeShortcut' : 'pane.notifications';
            relations.push(chrome('context', truncateToWidth(uiText(localeFor(view.conversationId), key, { count: notices.length }), paneWidth(), '…')));
        }
        cache.plainDraft = isPlainRequest(cache.pane.editor.getExpandedText());
        cache.roleFeedbackDraft = isFeedbackDraft(cache.pane.editor.getExpandedText());
        // A request the current response is processing is progress, not attention; only retained or unreconciled inputs ask for /inputs.
        const processing = !!cache.submitting || !!cache.dispatching || ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state);
        const retainedInputs = !!pendingInputs && (pendingInputs.deliveryIssue !== undefined || pendingInputs.reconciliationCount > 0 ||
            view.state === 'SETTLING' && pendingInputs.waiting > 0 || !processing);
        const reviewBeforeSend = retainedInputs && view.state === 'IDLE' && !view.archived && !view.deleted &&
            !view.inputNeeded && canReviewRetainedInputOnSend(cache, () => registration);
        cache.retainedReviewEntry = reviewBeforeSend && composerAcceptsInput() && view.conversationId === selected &&
            cache.plainDraft && !cache.submitting && !cache.draftError && !cache.dialogs.component;
        const managedWork = !!managed || !!observations.change(view.workId);
        const retainedEntry = reviewBeforeSend && !view.role && !managedWork && !task.idleStatus && !cache.error &&
            !cache.manualPending && !cache.manualAbort && !cache.dialogs.requestIds.length;
        const issues = retainedEntry ? [] : guidance(view, managedWork);
        const setupNeeded = issues.some(issue => issue.kind === 'setup');
        for (const issue of issues)
            relations.push(chrome('attention', truncateToWidth(issue.message, paneWidth(), '…')));
        const cancellingHistory = !!cache.manualAbort?.signal.aborted;
        const safePreview = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');
        const outgoing = pendingInputs?.activeOwnerPreview;
        let outgoingLine = '';
        if (outgoing && !retainedInputs && !view.archived && !view.deleted) {
            const chars = Array.from(outgoing);
            const preview = safePreview(chars.slice(0, 160).join('')) + (chars.length > 160 ? '…' : '');
            outgoingLine = chrome('context', truncateToWidth(uiText(paneLocale, 'pane.outgoing', {preview}), paneWidth(), '…'));
        }
        cache.pane.outgoing.setText(outgoingLine);
        cache.roleFeedbackEntry = cache.roleFeedbackDraft && !!view.role && !!view.workId && view.state === 'IDLE' && !view.archived && !view.deleted &&
            !registration && !pendingInputs && !cache.submitting && !cache.dispatching && !cache.preparingSend && !cache.startingResponse &&
            !cache.cancellingResponse && !cache.manualPending && !cache.manualAbort && !preparingTask && !view.inputNeeded &&
            !cache.dialogs.requestIds.length && !cache.dialogs.component && !cache.error && !cache.draftError;
        if (cache.roleFeedbackEntry && view.workId)
            relations.push(chrome('context', truncateToWidth(uiText(localeFor(view.conversationId), 'input.roleFeedbackHint', { work: safePreview(view.workId) }), paneWidth(), '…')));
        const failure = failureIsActive(cache) ? cache.failure : null;
        const heldProject = isProjectChangeHold(failure?.code) ? failure?.projectTarget : undefined;
        const errorStatus = !cache.error && !cache.draftError ? undefined : view.conversationId !== selected ? uiText(paneLocale, 'activity.error') :
            heldProject ? uiText(paneLocale, 'activity.projectRecovery', { key: keyLabel, project: safePreview(heldProject.id) }) :
                keyLabel + ' e · ' + uiText(paneLocale, 'command.e');
        if ((responseActive || managed) && heldProject && errorStatus && view.conversationId === selected)
            relations.push(chrome('attention', truncateToWidth(errorStatus, paneWidth(), '…')));
        const activityOperation = cache.manualPending ? cache.manualStatus : !responseActive && !cache.dialogs.requestIds.length ? preparingTask ?? null : null;
        const responseStatus = cache.responseStatus;
        const current = responseStatus?.generation === view.generation && responseStatus.workId === view.workId ? responseStatus : undefined;
        const outcome = current?.directionRevision === undefined ? current : undefined;
        const activityContext = outcome ? task.idleOwnStatus : task.idleStatus;
        cache.pane.activity.update(view.state, { runId: progress?.runId ?? registration?.identity.runId, requestOwner: requestOwnerFor(cache, progress?.initialInputId ?? registration?.identity.initialInputId), preparationOwner: primarySend?.abort, preparing, preparingStatus, stage: progress?.stage, cancelling: cancellingResponse || cancellingHistory, cancellationLabel: cancellingHistory && !cancellingResponse ? uiText(cache.manualLocale ?? localeFor(view.conversationId), 'history.cancelling') : undefined, cancellingSend, editorKeyOwner: () => editorKeyOwner(cache!), showResponseInterrupt: view.conversationId === selected && escapeOwner(cache, view.state, () => awaitingRun)?.kind === 'response', operation: activityOperation,
            providerActivity: registration?.providerActivity, waitingStatus: task.waitingStatus, waitAttention: task.waitAttention, locale: paneLocale, context: activityContext ?? null, setupNeeded, setupHandoff: setupNeeded && cache.plainDraft && canOfferRequestSetup(view, goal), outcome, pending: retainedInputs, inputNeeded: view.inputNeeded || cache.dialogs.requestIds.length > 0, error: errorStatus });
        if (cache.interruptedPreview)
            relations.push(chrome('context', uiText(paneLocale, 'pane.interruptedPreview')));
        if (view.cancelledSendPreview && !cache.preparingSend && !view.archived && !view.deleted) {
            relations.push(chrome('context', truncateToWidth(uiText(paneLocale, 'input.cancelled'), paneWidth(), '…')));
            relations.push(chrome('context', truncateToWidth(uiText(paneLocale, 'input.cancelledBeforeReceipt', { request: view.cancelledSendPreview }), paneWidth(), '…')));
        }
        if (current?.directionRevision === view.directionRevision && view.state === 'IDLE' && !view.inputNeeded && !errorStatus && !pendingInputs)
            relations.push(chrome('context', uiText(paneLocale, 'pane.lastResponseCompleted')));
        if (cache.historyRead && view.historyRef)
            relations.push(chrome('context', uiText(paneLocale, 'history.loading')));
        if (additionalSend)
            relations.push(chrome('context', uiText(paneLocale, 'input.concurrentStage', {
            stage: additionalSend.abort.signal.aborted ? sendCancellationLabel(additionalSend, paneLocale) : sendStageLabel,
            })));
        if (pendingInputs?.reconciliationCount)
            relations.push(chrome('attention', truncateToWidth(uiText(paneLocale, 'pane.deliveryUncertain', { count: pendingInputs.reconciliationCount }), paneWidth(), '…')));
        else if (pendingInputs?.deliveryIssue)
            relations.push(chrome('attention', truncateToWidth(uiText(localeFor(view.conversationId), 'pane.deliveryIssue', {count: pendingInputs.deliveryIssue.count, reason: inputDeliveryDiagnostic(safePreview(pendingInputs.deliveryIssue.reason).trim(), localeFor(view.conversationId)) || uiText(localeFor(view.conversationId), 'pane.deliveryIssueReason')}), paneWidth(), '…')));
        else if (retainedInputs)
            relations.push(chrome('attention', truncateToWidth(uiText(localeFor(view.conversationId), 'pane.pending', { count: pendingInputs!.count, preview: safePreview(pendingInputs!.preview) }), paneWidth(), '…')));
        else if (pendingInputs) {
            // Exclude the exact active request, never an unrelated failed reservation.
            const primary = progress?.initialInputId ?? cache.startingInputId;
            const primaryIndex = primary ? pendingInputs.waitingInputIds.indexOf(primary) : -1;
            const queued = pendingInputs.waiting - (pendingInputs.activeInputWaiting ? 1 : 0);
            const nextIndex = primaryIndex === 0 ? 1 : 0;
            const next = pendingInputs.waitingPreviews[nextIndex];
            const nextMode = pendingInputs.waitingModes[nextIndex];
            const modeLabel = uiText(localeFor(view.conversationId), nextMode === 'steer' ? 'input.mode.steer' : nextMode === 'follow-up' ? 'input.mode.follow-up' : 'input.mode.idle');
            if (queued > 0 && next !== undefined) {
                const notice = outgoingLine && pendingInputs.waitingInputIds[nextIndex] === previewInputId
                    ? uiText(paneLocale, 'pane.queuedNextStatus', { count: queued, mode: modeLabel })
                    : uiText(paneLocale, 'pane.queuedNext', { count: queued, mode: modeLabel, preview: safePreview(next) });
                relations.push(chrome('context', truncateToWidth(notice, paneWidth(), '…')));
            }
        }
        const activityLabel = cache.pane.activity.statusLabel();
        const headingStatus = (progress || preparingTask === activityLabel || retainedEntry) && !view.inputNeeded && !cache.dialogs.requestIds.length
            ? activityLabel : entry ?? task.resourceLabel;
        const prefix = uiText(paneLocale, view.conversationId === selected ? 'pane.input' : 'pane.view') + ' · ';
        const visibleStatus = headingStatus === activityLabel ? cache.pane.activity.statusLabelForWidth(paneWidth() - visibleWidth(prefix)) : headingStatus;
        const header = `${prefix}${visibleStatus}${simpleEntry ? '' : ' · #' + view.conversationId.slice(0, 8)}${view.inputNeeded ? ' · ' + uiText(paneLocale, 'pane.inputNeeded') : ''}${cache.dialogs.requestIds.length ? ' · ' + uiText(paneLocale, 'pane.dialogPending') : ''} · ${label(view)} · ${view.projectId ?? uiText(paneLocale, 'pane.noProject')}`;
        const attention = task.attention || retainedEntry || cache.dialogs.requestIds.length > 0;
        const heading = chrome(attention ? 'attention' : view.conversationId === selected ? 'active' : 'secondary', truncateToWidth(header.replace(/[\r\n]/g, ' '), paneWidth(), '…'));
        cache.pane.recordedResultStatus.setText(recordedDelegatedResultText(observations.recorded(view), paneLocale, paneWidth(), terminal.rows < 24,
            view.conversationId === selected ? keyLabel : undefined));
        cache.pane.status.setText([heading, ...(simpleEntry ? [] : [chrome('secondary', compactConversationPath(roster, view.conversationId, paneWidth(), paneLocale))]), ...relations,
            ...task.lines.filter(text => text !== activityLabel).map(text => chrome(task.attention ? 'attention' : 'context', truncateToWidth(text, paneWidth(), '…'))),
            ...(cache.manualStatus ? [chrome(cache.manualPending ? 'attention' : 'context', cache.manualStatus)] : []),
            ...(cache.draftError ? [chrome('attention', truncateToWidth(keyLabel + ' e · ' + cache.draftError.summary, paneWidth(), '…'))] : []),
            ...(cache.error ? [chrome('error', truncateToWidth(cache.error, paneWidth(), '…'))] : [])].join('\n'));
        return cache;
    };
    const loadHistory = async (view: ConversationView, cache: ViewCache, strict: boolean) => {
        if (closing || cache.registration)
            return;
        const read = Symbol(), locale = localeFor(view.conversationId);
        cache.historyRead = read;
        const ownsRead = () => !closing && views.get(view.conversationId) === cache && cache.historyRead === read &&
            !cache.registration && cache.generation === view.generation;
        try {
            const history = await controller.getConversationHistory(view.conversationId);
            const preview = ownsRead() && !history && view.state === 'UNKNOWN' && !view.historyRef ?
                await controller.getInterruptedConversationPreview(view.conversationId) : undefined;
            if (ownsRead()) {
                cache.interruptedPreview = !!preview;
                cache.pane.setHistory(history?.sessionManager ?? preview);
                cache.pane.restoreScroll(view.scroll);
                return;
            }
        }
        catch (error) {
            if (ownsRead()) {
                if (error instanceof Error && error.message === 'Required native history checkpoint unavailable' &&
                    controller.inspectConversationInputs(view.conversationId).some(input => input.legacyHistory)) {
                    const guidance = uiText(locale, 'input.recoveryLegacyOpen');
                    setError(cache, guidance);
                    if (strict)
                        throw Error(guidance, { cause: error });
                    return;
                }
                report(cache, error);
                if (strict)
                    throw error;
                return;
            }
        }
        finally {
            const redraw = ownsRead();
            if (cache.historyRead === read)
                cache.historyRead = undefined;
            if (redraw)
                render();
        }
        if (strict)
            throw Error(uiText(locale, 'history.viewChanged'));
    };
    const refreshHistory = (view: ConversationView, cache: ViewCache, strict = false) => {
        const task = loadHistory(view, cache, strict);
        historyReads.add(task);
        const finished = () => historyReads.delete(task);
        void task.then(finished, finished);
        return task;
    };
    const render = () => {
        if (closing || !views.has(selected))
            return;
        if (hostInteraction && !hostDialog) {
            const owner = hostInteraction;
            if (hostWait?.owner !== owner) {
                clearHostWait();
                const timer = setTimeout(() => {
                    if (closing || hostDialog || hostInteraction !== owner || hostWait?.timer !== timer) return;
                    hostWait.timer = undefined;
                    try { render(); } catch (error) { report(views.get(selected)!, error); }
                }, 150);
                hostWait = { owner, timer };
            }
            if (hostWait.timer) {
                // Keep the last layout during a short transition. NativeTerminal blocks viewport input too.
                screen.setFocus(interactionWaiting);
                return;
            }
        } else clearHostWait();
        const observations = observeTasks(), selectedView = controller.inspectConversation(selected), primary = cacheFor(selectedView, observations);
        // The send can own the response before the controller exposes its queued state.
        const trackProgress = managedTasks.size > 0 || observations.roster.some(view => !view.archived && !view.deleted &&
            (!!views.get(view.conversationId)?.startingResponse || ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state) ||
                [selected, visibleSecond()].includes(view.conversationId) &&
                    (!!observations.change(view.workId) || observations.activeChildWorks(view).size > 0)));
        if (trackProgress && !progressTimer)
            progressTimer = setInterval(() => { if (!closing) { try { updateManaged(); } catch (error) { report(views.get(selected)!, error); } } }, 1000);
        else if (!trackProgress && progressTimer) {
            clearInterval(progressTimer);
            progressTimer = undefined;
        }
        if (hostDialog instanceof ConversationNavigator)
            hostDialog.updateRoster(observations.roster, new Map(observations.roster.map(view => [view.conversationId, observations.summary(view).navigatorSummary])));
        primary.pane.setActive(true);
        const primaryComponent = primary.dialogs.component ?? primary.pane.layout;
        let component: Component = primaryComponent;
        const split = visibleSecond();
        if (split) {
            const alternate = cacheFor(controller.inspectConversation(split), observations);
            alternate.pane.setActive(false);
            const alternateComponent = alternate.dialogs.component ?? alternate.pane.layout;
            const panes = leftId === selected ? [primaryComponent, alternateComponent] : [alternateComponent, primaryComponent];
            const leftWidth = paneWidth();
            component = new HStack([
                { component: panes[0]!, basis: leftWidth },
                { component: panes[1]!, basis: terminal.columns - leftWidth },
            ]);
        }
        const available = observations.roster.filter(view => !view.archived && !view.deleted);
        const owner = escapeOwner(primary, selectedView.state, () => awaitingResponseStart(primary, selectedView));
        const inputForReview = retainInputForReview(primary, selectedView);
        const inputShortcut = (primary.registration || primary.dispatching || inputForReview) && !primary.preparingSend && selectedView.state !== 'UNKNOWN'
            ? waitingForRequestAdmission(primary, selectedView) ? 'input.waitForAdmission' :
                inputForReview ? 'footer.retainInput' :
                controller.hasLiveInputTarget(selected) ? 'footer.liveInput' : 'footer.queueInput'
            : undefined;
        describeFooter = () => {
            const keyOwner = editorKeyOwner(primary);
            const locale = localeFor(selected);
            const completionCancel = keyOwner === 'completion' ? completionCancelKeyLabel() : '';
            const shortcutOwner = keyOwner === 'composer' ? owner : undefined;
            return [
                ...(keyOwner === 'composer' && primary.retainedReviewEntry ? [uiText(locale, 'input.reviewBeforeSend', { submit: submitKeyLabel() })] : []),
                keyOwner === 'composer' && primary.roleFeedbackEntry ? uiText(locale, 'footer.roleFeedback', { submit: submitKeyLabel() }) : uiText(locale, 'footer.setup'),
                uiText(locale, 'footer.commands', { key: keyLabel }),
                ...(available.some(view => view.conversationId === selectedView.parentId) ? [uiText(locale, 'footer.parent')] : []),
                ...(available.some(view => view.parentId === selected) ? [uiText(locale, 'footer.child')] : []),
                ...(completionCancel ? [uiText(locale, 'footer.closeSuggestions', { key: completionCancel })] : []),
                ...(shortcutOwner?.kind === 'send' ? [shortcutOwner.abort.signal.aborted ? sendCancellationLabel(shortcutOwner.preparation, locale) :
                    uiText(locale, sendHasReceipt(shortcutOwner.preparation) ? 'footer.stopReceivedSend' : 'footer.cancelSend')] :
                    shortcutOwner?.kind === 'history' ? [uiText(primary.manualLocale ?? locale, shortcutOwner.abort.signal.aborted ? 'history.cancelling' : 'history.interrupt')] :
                    shortcutOwner?.kind === 'response' ? [uiText(locale, 'footer.interrupt')] : []),
                ...(keyOwner === 'composer' && inputShortcut ? [uiText(locale, inputShortcut, { submit: submitKeyLabel() })] : []),
                uiText(locale, 'footer.leave', { key: keyLabel })].map(text => chrome('key', text)).join(chrome('secondary', ' · '));
        };
        const paneOutcome = primary.standaloneOutcome;
        const standaloneNotice = paneOutcome && selectedView.generation === paneOutcome.generation && selectedView.projectId === paneOutcome.projectId &&
            selectedView.workId === null && selectedView.state === 'IDLE' && !selectedView.inputNeeded ? paneOutcome.text : '';
        const visibleNotice = noticeMessage || standaloneNotice, wraps = noticeMessage ? wrapNotice : !!standaloneNotice;
        const noticeText = (wraps ? visibleNotice.split('\n') : [visibleNotice])
            .map(line => line.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')).join('\n');
        notice.setText(chrome('attention', wraps ? noticeText : truncateToWidth(noticeText, Math.max(1, terminal.columns), '…')));
        const commands = hostDialog instanceof CommandMenu ? hostDialog : undefined;
        const modal = hostDialog ?? (hostInteraction ? interactionWaiting : undefined);
        if (hostInteraction) {
            const { locale, action, source, interrupt, interruptHint } = hostInteraction;
            const status = uiText(locale, interrupt?.signal.aborted ? 'interaction.interrupting' : interrupt ? interruptHint ?? 'interaction.interruptible' : 'interaction.waitForNext');
            interactionWaiting.setText(uiText(locale, 'interaction.waiting', { action, conversation: source, status }));
        }
        const tail = [...(visibleNotice ? [{ component: notice, basis: 'auto' as const, shrink: 0 }] : []), ...(commands ? [{ component: menuBorder, basis: 'auto' as const, shrink: 0 }, { component: commands, basis: 'auto' as const, shrink: 0 }] : []), ...(modal ? [] : [{ component: footer, basis: 'auto' as const, shrink: 0 }]), { component: modelStatus, basis: 'auto' as const, shrink: 0 }];
        screen.setLayoutRoot(new VStack([{ component: component, basis: 0, grow: 1, minSize: 1 }, ...tail]));
        screen.setFocus(modal ?? primary.dialogs.component ?? primary.pane.editor);
        if (modal && !commands)
            screen.setLayoutRoot(new VStack([{ component: modal, basis: 0, grow: 1, minSize: 1 }, ...tail]));
        screen.requestRender();
    };
    let pruning = false;
    const pruneViews = () => {
        if (pruning || closing)
            return;
        pruning = true;
        if (retentionTimer)
            clearTimeout(retentionTimer);
        retentionTimer = undefined;
        let nextExpiry = Infinity;
        try {
            for (const [otherId, other] of [...views].sort((a, b) => a[1].humanSequence - b[1].humanSequence)) {
                const state = controller.inspectConversation(otherId).state;
                const protectedView = otherId === selected || otherId === second || other.submitting || other.dispatching || other.manualPending || managedTasks.has(otherId) || !!other.registration || !!other.dialogs.requestIds.length || !!other.error || !!other.draftError || state === 'SETTLING' || state === 'UNKNOWN' || state === 'RUNNING';
                if (protectedView) {
                    other.idleSince = null;
                    continue;
                }
                other.idleSince ??= Date.now();
                const expires = other.idleSince + idleGraceMs;
                if (views.size <= completedLimit && expires > Date.now()) {
                    nextExpiry = Math.min(nextExpiry, expires);
                    continue;
                }
                persist(other);
                if (other.draftError)
                    continue;
                saveScroll(other);
                other.dialogs.dispose();
                other.pane.dispose();
                views.delete(otherId);
                presentation.delete(otherId);
            }
        }
        finally {
            pruning = false;
            if (Number.isFinite(nextExpiry))
                retentionTimer = setTimeout(() => {
                    try {
                        pruneViews();
                        render();
                    }
                    catch (error) {
                        const cache = views.get(selected);
                        if (cache)
                            report(cache, error);
                    }
                }, Math.max(1, nextExpiry - Date.now()));
            try {
                options.onViewCacheState?.({ conversationIds: Object.freeze([...views.keys()]), limit: completedLimit, selectedConversationId: selected, secondConversationId: second, visibleSecondConversationId: visibleSecond(), columns: terminal.columns, paneWidth: paneWidth() });
            }
            catch { /* Trusted observation has no authority. */ }
        }
    };
    const onResize = () => {
        if (closing)
            return;
        try {
            render();
            pruneViews();
        }
        catch (error) {
            const cache = views.get(selected);
            if (cache)
                report(cache, error);
        }
    };
    const activateConversation = (id: string) => {
        const previous = views.get(selected);
        if (previous) {
            persist(previous);
            if (previous.draftError)
                throw new DraftPersistenceHeld(uiText(localeFor(selected), 'error.draftActionHeld'));
            saveScroll(previous);
        }
        const nextSecond = second === id ? selected : second;
        controller.setConversationView({ selectedId: id, secondId: nextSecond });
        if (!nextSecond || leftId === selected && second !== id)
            leftId = id;
        if (selected !== id) {
            noticeMessage = '';
            noticeRevision++;
        }
        selected = id;
        second = nextSecond;
        const view = controller.inspectConversation(id), cache = cacheFor(view);
        applyActivePresentation();
        cache.humanSequence = ++sequence;
        if (view.parentId)
            lastChild.set(view.parentId, id);
        return { view, cache };
    };
    const selectConversation = async (id: string, strictHistory = false) => {
        if (closing)
            return;
        const { view, cache } = activateConversation(id);
        const loading = refreshHistory(view, cache, strictHistory);
        // Set actual editor focus before another key from this input batch can arrive.
        render();
        // Same bounded presentation cache policy also runs on background settlement.
        pruneViews();
        if (strictHistory)
            await loading;
    };
    // These callers continue with an acknowledged notice or a governed action.
    const openHistoryBoundConversation = (id: string) => selectConversation(id, true);
    const createAndSelectConversation = (argument: NewConversationScope = '', target = selected) => newConversationAction({
        controller, hostLanguage, chooseItems: chooseHost, isCurrent: id => !closing && selected === id,
        ready: () => { if (closing || hostDialog || switchPending)
            return false; const cache = views.get(target); if (cache) {
            persist(cache);
            if (cache.draftError)
                throw new DraftPersistenceHeld(uiText(localeFor(target), 'error.draftActionHeld'));
        } return true; },
        choose: chooseHost, activate: selectConversation, notice: setNotice,
        create: async (projectId, validate) => { if (closing || hostDialog || switchPending)
            throw Error('Finish the current conversation operation first'); switchPending = true; try {
            validate();
            return await newConversation(projectId, validate);
        }
        finally {
            switchPending = false;
        } },
    }, argument, target);
    const reportConversationResult = (cache: ViewCache, result: LiveConversationTurnResult, errorRevision: number,
        retriedFailure?: RetryFailure) => {
        const requestFailure = result.requestLimit ? controller.inspectConversationRequestFailure(cache.pane.conversationId) : null;
        const startup = result.unsupportedCaptureLink || result.runtimeHelperUnavailable || result.missingRuntimeContext
            ? controller.inspectConversationStartupFailure(cache.pane.conversationId) : null;
        if (result.requestLimit && (!requestFailure || requestFailure.runId !== result.runId)) return;
        const { status, cleanup, workId, runId, generation } = result;
        cache.responseStatus = { status, cleanup, workId, runId, generation };
        if (result.status === 'unavailable') {
            const projectHold = cache.failureRevision === cache.errorRevision ? cache.failure : null;
            const replacesOwnHold = projectHold?.code === 'PROJECT_RESPONSE_ACTIVE' &&
                result.conversationId === cache.pane.conversationId && matchesRunAttempt(result, projectHold);
            if ((cache.errorRevision ?? 0) !== errorRevision && !replacesOwnHold) { render(); return; }
            if (requestFailure) {
                setResponseFailure(cache, conversationRequestFailurePresentation(requestFailure, localeFor(cache.pane.conversationId)));
            } else if (startup && result.conversationId === cache.pane.conversationId &&
                startup.workId === workId && startup.runId === runId) {
                setResponseFailure(cache, conversationStartupFailure(startup, localeFor(cache.pane.conversationId)));
            } else setResponseFailure(cache, ordinaryResponseFailure(result, localeFor(cache.pane.conversationId), bridgeRecoveryAvailable));
        } else if (result.status === 'delivered' && hasCleanCleanup(result.cleanup) && retriedFailure &&
            result.conversationId === cache.pane.conversationId && result.workId === retriedFailure.workId &&
            result.runId !== retriedFailure.runId && cache.errorRevision === retriedFailure.revision && failureIsActive(cache)) {
            setError(cache, null);
        }
        render();
    };
    const hasRetainedInput = (cache: ViewCache): boolean => {
        const target = cache.pane.conversationId;
        return canReviewRetainedInputOnSend(cache, () => controller.getNativeHandle(target)) && !!controller.inspectConversationInputStatus(target);
    };
    const prepareSend = (cache: ViewCache, retryFailure?: RetryFailure): SendPreparation => {
        if (cache.preparingSend)
            throw Error(uiText(localeFor(cache.pane.conversationId), 'input.preparingExisting'));
        const abort = new AbortController();
        const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
        const preparation = { abort, signal, ...(retryFailure ? { retryFailure } : {}) };
        cache.preparingSend = preparation;
        cache.submitting = true;
        cache.pane.activity.beginPreparation(abort);
        return preparation;
    };
    const ownsRequestNotice = (cache: ViewCache): boolean => !closing && !switchPending && !hostDialog && !hostInteraction &&
        selected === cache.pane.conversationId && views.get(selected) === cache;
    const requestNotice = (cache: ViewCache, message: string) => {
        if (ownsRequestNotice(cache)) setNotice(message);
    };
    const receivedCancellationNotice = (cache: ViewCache, inputId: string) => {
        if (!ownsRequestNotice(cache)) return;
        const target = cache.pane.conversationId;
        let queued = false;
        try { queued = controller.inspectConversationInputStatus(target, inputId)?.activeInputQueued === true; }
        catch { /* A receipt alone does not establish current delivery. */ }
        setNotice(uiText(localeFor(target), queued ? 'input.receivedCancelled' : 'input.receivedCheckDelivery'));
    };
    const dispatchResponse = (cache: ViewCache, preparation: SendPreparation, inputId: string,
        run: () => Promise<LiveConversationTurnResult>) => {
        const { abort, signal, retryFailure } = preparation;
        cache.startingResponse = preparation;
        cache.startingInputId = inputId;
        cache.pane.activity.bindPreparation(abort);
        cache.dispatching = (cache.dispatching ?? 0) + 1;
        const errorRevision = cache.errorRevision ?? 0;
        const finish = () => {
            cache.dispatching = (cache.dispatching ?? 1) - 1;
            if (cache.startingResponse === preparation) {
                cache.startingResponse = undefined;
                cache.startingInputId = undefined;
                if (retryFailure && !closing) retireStaleResponseFailure(cache);
            }
            pruneViews();
            render();
        };
        let response: Promise<LiveConversationTurnResult>;
        try {
            response = run();
        } catch (error) {
            finish();
            throw error;
        }
        void response.then(result => reportConversationResult(cache, result, errorRevision, retryFailure)).catch(error => {
            if (closing || views.get(cache.pane.conversationId) !== cache || (cache.errorRevision ?? 0) !== errorRevision)
                return;
            if (signal.aborted) receivedCancellationNotice(cache, inputId);
            else report(cache, error);
        }).finally(finish);
    };
    const submit = async (mode: 'idle' | 'steer' | 'follow-up') => {
        if (!composerAcceptsInput())
            return;
        const cache = views.get(selected);
        if (!cache || cache.dialogs.component || cache.submitting)
            return;
        const target = cache.pane.conversationId, text = cache.pane.editor.getExpandedText();
        if (!text.trim())
            return;
        persist(cache);
        if (cache.draftError)
            return;
        cache.humanSequence = ++sequence;
        const revision = cache.revision, generation = cache.generation, editRevision = cache.localRevision;
        const clearSubmittedDraft = () => {
            // Acknowledge only the captured editor submission. Same-text persistence
            // is idempotent; any newer edit still prevents clearing.
            if (cache.localRevision !== editRevision || cache.pane.editor.getExpandedText() !== text)
                return;
            const receipt = controller.setDraft({ conversationId: target, expectedRevision: cache.revision, text: '' });
            cache.revision = receipt.revision;
            cache.localRevision = Math.max(cache.localRevision, receipt.revision);
            cache.applying = true;
            cache.pane.editor.setText('');
            cache.applying = false;
        };
        const commandInput = text.trimStart();
        if (commandInput.startsWith('/') && !commandInput.startsWith('//')) {
            const locale = localeFor(target);
            let prepared: ReturnType<HostCommands['prepare']>;
            try {
                prepared = slash.prepare(text);
            }
            catch (error) {
                if (error instanceof HostCommandInputError)
                    setNotice(commandInputNotice(error.issue, locale, keyLabel), true);
                else
                    report(cache, error);
                return;
            }
            if (!prepared)
                return;
            try {
                const beforeNotice = noticeRevision, request = prepared;
                let heldProject: string | undefined;
                const context = { submission: { conversationId: target, text, revision: editRevision }, acknowledgeSubmission: clearSubmittedDraft };
                const outcome = await runHostInteraction(
                    () => runSelectedCommand(request, target, context, destination => { heldProject = destination; }),
                    '/' + request.name, target, request.opensInspection ? () => {
                        if (views.get(target) === cache && cache.generation === generation)
                            clearSubmittedDraft();
                    } : undefined);
                // Recovery may finish by navigating away while this project selection is still held.
                if (outcome === 'completed' && (heldProject === undefined || !closing && selected === target &&
                    views.get(target) === cache && controller.inspectConversation(target).projectId === heldProject))
                    clearSubmittedDraft();
                else if (outcome === 'cancelled' && !closing && selected === target && views.get(target) === cache &&
                    cache.generation === generation && cache.localRevision === editRevision && cache.pane.editor.getExpandedText() === text &&
                    (!noticeMessage || noticeRevision === beforeNotice))
                    setNotice(uiText(locale, 'interaction.commandCancelled', { submit: submitKeyLabel() }));
            }
            catch (error) {
                report(cache, error);
            }
            render();
            return;
        }
        const setupView = controller.inspectConversation(target);
        if (waitingForRequestAdmission(cache, setupView)) {
            render();
            return;
        }
        if (commandInput.startsWith('!')) {
            const excludeFromContext = commandInput.startsWith('!!'), command = commandInput.slice(excludeFromContext ? 2 : 1);
            if (cache.manualPending)
                return;
            const preparation = prepareSend(cache);
            cache.manualPending = true;
            cache.manualStatus = 'Preparing shell command';
            render();
            try {
                const selectedModel = await resolveTargetRequest(target);
                preparation.signal.throwIfAborted();
                cache.manualStatus = 'Running shell command';
                render();
                const outcome = await controller.executeConversationBash({ conversationId: target, expectedGeneration: generation, rawInput: text, command, excludeFromContext, ...selectedModel, signal: preparation.signal });
                if (outcome && typeof outcome === 'object' && 'status' in outcome && outcome.status === 'unavailable')
                    throw new Error('Native Bash unavailable; inspect the retained command diagnostic and retry explicitly');
                const presentation = shellOutcome(outcome);
                cache.manualStatus = presentation.message;
                if (!presentation.completed)
                    return;
                if (cache.revision === revision && cache.pane.editor.getExpandedText() === text) {
                    const receipt = controller.setDraft({ conversationId: target, expectedRevision: revision, text: '' });
                    cache.revision = receipt.revision;
                    cache.localRevision = Math.max(cache.localRevision, receipt.revision);
                    cache.applying = true;
                    cache.pane.editor.setText('');
                    cache.applying = false;
                    cache.pane.editor.addToHistory(text);
                }
            }
            catch (error) {
                if (preparation.signal.aborted) cache.manualStatus = uiText(localeFor(target), 'input.cancelled');
                else { cache.manualStatus = 'Shell command failed · inspect error details'; report(cache, error); }
            }
            finally {
                cache.submitting = false;
                cache.manualPending = false;
                if (cache.preparingSend === preparation) cache.preparingSend = undefined;
                render();
            }
            return;
        }
        const currentDraft = () => {
            if (closing || switchPending || selected !== target || views.get(target) !== cache ||
                cache.localRevision !== editRevision || cache.pane.editor.getExpandedText() !== text) return undefined;
            const current = controller.inspectConversation(target);
            if (current.generation === generation && current.projectId === setupView.projectId &&
                current.workId === setupView.workId && current.directionRevision === setupView.directionRevision &&
                current.draft.revision === revision && current.draft.text === text) return current;
        };
        if (hasRetainedInput(cache)) {
            const locale = localeFor(target);
            if (mode !== 'idle' || setupView.state !== 'IDLE') {
                setNotice(uiText(locale, 'input.reviewRetained'));
                return;
            }
            const languageRevision = controller.getConversationLanguage(target).revision;
            const isCurrent = (id: string) => id === target && currentDraft()?.state === 'IDLE' &&
                canReviewRetainedInputOnSend(cache, () => controller.getNativeHandle(target)) &&
                controller.getConversationLanguage(target).revision === languageRevision;
            // Read and act on the earlier receipt without giving its review any draft acknowledgement.
            // The receipt fingerprint owns model binding, including a fresh review after first-model selection.
            await runHostInteraction(() => reviewConversationInputs({ ...retainedInputHost, isCurrent }, target, { blockedDraft: true }),
                uiText(locale, 'input.recoveryReview'), target);
            return;
        }
        const retainForReview = retainInputForReview(cache, setupView);
        const newRequest = mode === 'idle' && !retainForReview;
        if (newRequest) {
            try { controller.assertConversationRequestContext(target); }
            catch (error) { report(cache, error); return; }
        }
        const inputMode = retainForReview ? 'idle' : mode;
        const preparation = prepareSend(cache);
        let acknowledgedErrorRevision: number | undefined;
        let acceptedInputId: string | undefined;
        const retainPreReceiptCancellation = () => {
            const line = plainTerminalText(text).replace(/\s+/gu, ' ').trim();
            const preview = line.length <= 160 ? line : line.slice(0, 159).replace(/[\uD800-\uDBFF]$/u, '') + '…';
            if (preview && cache.preparingSend === preparation)
                controller.recordCancelledSend({ conversationId: target, expectedGeneration: generation,
                    expectedDirection: setupView.directionRevision, preview });
        };
        const releasePreparation = () => {
            if (cache.preparingSend === preparation) {
                cache.preparingSend = undefined;
                cache.submitting = false;
            }
        };
        try {
            if (newRequest && setupView.projectId && canOfferRequestSetup(setupView)) {
                const project = controller.listProjects().find(project => project.id === setupView.projectId);
                const choice = controller.getConversationModelChoice(target);
                const language = controller.getConversationLanguage(target);
                const currentSource = () => {
                    const view = currentDraft();
                    return view && canOfferRequestSetup(view) && controller.getConversationModelChoice(target).revision === choice.revision &&
                        controller.getConversationLanguage(target).revision === language.revision;
                };
                const sourceChecked = prepareProjectSourceCheck(target);
                preparation.stage = 'source';
                render();
                try {
                    if (!project)
                        throw Error(uiText(localeFor(target), 'change.sourceChanged'));
                    await readProjectSource(project.sourceRoot, localeFor(target));
                    preparation.signal.throwIfAborted();
                    if (!currentSource())
                        return;
                    sourceChecked?.();
                } catch (error) {
                    if (preparation.signal.aborted) throw error;
                    if (currentSource()) report(cache, error);
                    return;
                }
            }
            // This handoff concerns the unsent draft. Original recovery stays with its retained input or work.
            const currentSetupIssues = () => guidance(controller.inspectConversation(target), false).filter(issue => issue.kind === 'setup');
            const setupIssues = newRequest && canOfferRequestSetup(setupView) ? currentSetupIssues() : [];
            if (setupIssues.length) {
                const choiceRevision = controller.getConversationModelChoice(target).revision;
                const language = controller.getConversationLanguage(target), locale = localeFor(target);
                const runtimeOnly = (issues: readonly EntryIssue[]) => issues.length === 1 && issues[0]?.repair === 'runtime';
                const directRuntime = runtimeOnly(setupIssues) && slash.commands.some(command => command.name === 'setup');
                const setupLabel = uiText(locale, directRuntime ? 'requestSetup.openRuntime' : 'requestSetup.open');
                const currentRequest = () => {
                    const current = currentDraft();
                    return current && canOfferRequestSetup(current) &&
                        controller.getConversationLanguage(target).revision === language.revision;
                };
                const currentSource = () => currentRequest() && controller.getConversationModelChoice(target).revision === choiceRevision;
                releasePreparation();
                await runHostInteraction(async () => { try {
                    if (!currentSource()) return;
                    const action = await chooseHost(uiText(locale, 'requestSetup.title') + '\n' + setupIssues.map(issue => issue.message).join('\n'), [
                        { value: 'request', label: uiText(locale, 'requestSetup.back') },
                        { value: 'setup', label: setupLabel },
                    ]);
                    if (!currentSource()) return;
                    if (action === 'setup') {
                        const issues = currentSetupIssues();
                        if (!issues.length || directRuntime && !runtimeOnly(issues)) return;
                    }
                    const beforeSetupNotice = noticeRevision;
                    const outcome = action === 'setup' ? await slash.execute(directRuntime ? '/setup runtime' : '/ready', target) : 'cancelled';
                    if (outcome === 'started' || !currentRequest())
                        return;
                    const settingsNotice = noticeRevision !== beforeSetupNotice ? noticeMessage : '';
                    // A settings action may deliberately change the model. The original draft still needs its own send.
                    if (outcome === 'completed' && !currentSetupIssues().length) {
                        const kept = uiText(locale, 'requestSetup.submitKept', { submit: submitKeyLabel() });
                        setNotice([settingsNotice, kept].filter(Boolean).join('\n'), true);
                    } else if (currentSource() && !settingsNotice)
                        setNotice(uiText(locale, 'requestSetup.kept'));
                } catch (error) { report(cache, error); } }, directRuntime ? setupLabel : uiText(locale, 'command.t'), target);
                render();
                return;
            }
            // Recording direction for an existing role does not select a new
            // producer. Keep this submission source-only across all later awaits.
            const source = controller.inspectConversation(target);
            const sourceOnly = !!source.role && !controller.getNativeHandle(target);
            const resolvesModel = !sourceOnly && !retainForReview;
            if (resolvesModel) {
                if (source.projectId && !controller.options.runtimeProfile)
                    throw Object.assign(new Error('Project runtime is not configured. Your request is kept in the editor.'), { recovery: 'Open /ready to configure and apply the runtime, then send this request again.' });
                preparation.stage = 'model';
                render();
            }
            const selectedModel = resolvesModel ? await resolveTargetRequest(target) : undefined;
            preparation.signal.throwIfAborted();
            if (hasRetainedInput(cache)) {
                if (currentDraft()) requestNotice(cache, uiText(localeFor(target), 'input.reviewRetained'));
                return;
            }
            preparation.stage = 'context';
            render();
            let acknowledgedEditorRevision: number | undefined;
            preparation.acknowledgeDraft = input => {
                const receipt = input.acknowledgedDraft;
                if (input.generation !== generation || !receipt || receipt.conversationId !== target ||
                    receipt.revision !== revision + 1 || receipt.text !== '')
                    return;
                acceptedInputId = input.inputId;
                cache.recentAcceptedInputId = input.inputId;
                if (cache.revision !== revision)
                    return;
                preparation.stage = 'received';
                acknowledgedErrorRevision = cache.errorRevision ?? 0;
                cache.revision = receipt.revision;
                if (cache.localRevision === editRevision && cache.pane.editor.getExpandedText() === text) {
                    cache.localRevision = Math.max(cache.localRevision, receipt.revision);
                    cache.applying = true;
                    try {
                        cache.pane.editor.setText('');
                        cache.pane.editor.addToHistory(text);
                        cache.draftError = null;
                        acknowledgedEditorRevision = cache.localRevision;
                    } finally {
                        cache.applying = false;
                    }
                }
                // A display observation cannot invalidate the durable input acknowledgement.
                if (inputMode !== 'idle')
                    try { if (controller.hasLiveInputTarget(target)) preparation.stage = 'routing'; }
                    catch { /* Keep the exact receipt label when the live target is unavailable to inspect. */ }
            };
            const received = await controller.queueConversationInputWithContext({ conversationId: target, expectedGeneration: generation,
                text, draftRevision: revision, mode: inputMode },
                preparation.signal, newRequest ? 'dispatch' : 'retain', true);
            if (!retainForReview) {
                setError(cache, null);
                cache.responseStatus = undefined;
            }
            releasePreparation();
            if (preparation.signal.aborted) {
                receivedCancellationNotice(cache, received.inputId);
                return;
            }
            if (retainForReview) {
                requestNotice(cache, uiText(localeFor(target), 'input.receivedReview'));
                return;
            }
            if (!cache.dispatching && !controller.getNativeHandle(target)) {
                // A role view cannot start an ordinary owner response. Keep the
                // exact feedback and use the Controller's existing recovery proof.
                if (sourceOnly || controller.inspectConversation(target).role) {
                    const input = controller.inspectConversationInputs(target).find(row => row.inputId === received.inputId);
                    if (ownsRequestNotice(cache) && controller.inspectConversation(target).generation === generation && !preparation.signal.aborted) {
                        const feedback = isClosedRoleFeedback(input) ? input : undefined;
                        requestNotice(cache, uiText(localeFor(target), feedback ? 'input.feedbackReceived' : 'input.receivedReview'));
                        if (acknowledgedEditorRevision !== undefined && cache.localRevision === acknowledgedEditorRevision &&
                            cache.pane.editor.getExpandedText() === '')
                            await runHostInteraction(() => feedback
                                ? reviewConversationInputs(retainedInputHost, target, {submittedFeedback: feedback})
                                : slash.execute('/inputs', target), feedback ? uiText(localeFor(target), 'input.recoveryReview') : '/inputs', target);
                    }
                    return;
                }
                if (!selectedModel) {
                    requestNotice(cache, uiText(localeFor(target), 'input.receivedReview'));
                    return;
                }
                const pending = controller.inspectConversationInputStatus(target);
                // Context capture and native routing can outlive the earlier response.
                // Never let a fresh send implicitly replay another retained original.
                if (!pending) return;
                if (pending.count !== 1 || pending.firstQueuedInputId !== received.inputId) {
                    requestNotice(cache, uiText(localeFor(target), 'input.receivedReview'));
                    return;
                }
                dispatchResponse(cache, preparation, received.inputId, () =>
                    controller.runConversation({ conversationId: target, initialInputId: received.inputId, ...selectedModel, signal: preparation.signal }));
            }
        }
        catch (error) {
            if (error instanceof InputRoutingUnavailable && error.conversationId === target) {
                if (acknowledgedErrorRevision === (cache.errorRevision ?? 0)) {
                    setResponseFailure(cache, presentFailure(cache, error));
                    retireStaleResponseFailure(cache);
                }
                else requestNotice(cache, uiText(localeFor(target), 'error.inputRouting'));
            }
            else if (preparation.signal.aborted) {
                if (acceptedInputId) receivedCancellationNotice(cache, acceptedInputId);
                else retainPreReceiptCancellation();
            }
            else report(cache, error);
        }
        finally {
            releasePreparation();
            render();
        }
    };
    const submitAndTrack = (mode: 'idle' | 'steer' | 'follow-up') => {
        const cache = views.get(selected), task = submit(mode);
        interactionTasks.add(task);
        void task.then(() => interactionTasks.delete(task), error => { interactionTasks.delete(task); if (cache) report(cache, error); });
    };
    const switchDialog = async (mode: ConversationNavigationMode = 'select'): Promise<'completed' | 'cancelled'> => {
        if (hostDialog || switchPending || closing)
            return 'cancelled';
        const target = selected;
        const candidates = controller.listConversations();
        const locale = localeFor(target);
        const initialFocus = mode === 'select' ? target : candidates.find(view => isNavigationTarget(view, target, mode))?.conversationId;
        if (!initialFocus) {
            setNotice(mode === 'split' ? uiText(locale, 'navigation.splitUnavailable') : uiText(locale, 'navigation.childrenUnavailable', { key: keyLabel }));
            return 'cancelled';
        }
        switchPending = true;
        try {
            return await new Promise<'completed' | 'cancelled'>((resolve, reject) => {
                let settled = false;
                const complete = async (id?: string) => {
                    if (settled)
                        return;
                    settled = true;
                    try {
                        if (hostDialog !== component) {
                            resolve('cancelled');
                            return;
                        }
                        hostDialog = undefined;
                        hostDialogCancel = undefined;
                        render();
                        if (!id || closing) {
                            resolve('cancelled');
                            return;
                        }
                        const current = controller.listConversations();
                        if (selected !== target || !current.some(view => view.conversationId === target && isNavigationTarget(view, target)) ||
                            !current.some(view => view.conversationId === id && isNavigationTarget(view, target, mode)))
                            throw new Error(uiText(locale, 'navigation.reopen'));
                        if (mode === 'split') {
                            controller.setConversationView({ selectedId: target, secondId: id });
                            selected = target;
                            second = id;
                            leftId = target;
                            const alternate = controller.inspectConversation(id);
                            void refreshHistory(alternate, cacheFor(alternate));
                            if (!visibleSecond())
                                setNotice(narrowSplitNotice(), true);
                            pruneViews();
                            render();
                        }
                        else
                            await selectConversation(id);
                        resolve(closing ? 'cancelled' : 'completed');
                    }
                    catch (error) {
                        reject(error);
                    }
                };
                const component = new ConversationNavigator(candidates, target, Math.max(1, terminal.rows - 9),
                    id => { void complete(id); }, () => { void complete(); }, { mode, locale, initialFocusId: initialFocus });
                hostDialog = component;
                hostDialogCancel = () => { void complete(); };
                render();
            });
        }
        finally {
            switchPending = false;
        }
    };
    const navigateHierarchy = async (direction: 'parent' | 'child') => {
        if (hierarchyPending || closing || hostDialog || switchPending)
            return;
        hierarchyPending = true;
        try {
            const roster = controller.listConversations().filter(view => !view.archived && !view.deleted);
            const current = controller.inspectConversation(selected);
            if (direction === 'parent') {
                if (current.parentId && roster.some(view => view.conversationId === current.parentId))
                    await selectConversation(current.parentId);
                else {
                    setNotice(uiText(localeFor(current.conversationId), 'navigation.parentUnavailable', { key: keyLabel }));
                }
                return;
            }
            const children = roster.filter(view => view.parentId === current.conversationId);
            const remembered = children.find(view => view.conversationId === lastChild.get(current.conversationId));
            const target = remembered ?? (children.length === 1 ? children[0] : undefined);
            if (target)
                await selectConversation(target.conversationId);
            else
                await switchDialog('children');
        }
        finally {
            hierarchyPending = false;
        }
    };
    const lifecycleDialog = async () => {
        if (hostDialog || switchPending || closing)
            return;
        const cache = views.get(selected), interaction = hostInteraction;
        if (!cache)
            return;
        persist(cache);
        if (cache.draftError)
            return;
        saveScroll(cache);
        const captured = controller.inspectConversation(selected);
        switchPending = true;
        try {
            const { ExtensionSelectorComponent } = await import('@earendil-works/pi-coding-agent');
            if (closing || hostDialog || selected !== captured.conversationId)
                return;
            const restores = new Map(controller.listConversations().filter(v => v.archived && !v.deleted).map(v => [
                `Restore ${stripTerminalSequences(label(v)).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ').slice(0, 120)} · ${v.conversationId}`, v.conversationId
            ]));
            const labels = ['Reclaim completed resource', 'Archive conversation', 'Delete conversation permanently', ...restores.keys()];
            const value = await new Promise<string | undefined>(resolve => {
                let settled = false;
                const complete = (value?: string) => {
                    if (settled)
                        return;
                    settled = true;
                    if (hostDialog !== component) {
                        resolve(undefined);
                        return;
                    }
                    hostDialog = undefined;
                    hostDialogCancel = undefined;
                    component.dispose();
                    render();
                    resolve(closing ? undefined : value);
                };
                const component = new ExtensionSelectorComponent('Conversation lifecycle', labels, v => complete(v), () => complete(), { tui: screen });
                hostDialog = component;
                hostDialogCancel = () => complete();
                render();
            });
            if (!value || closing)
                return;
            const restoredId = restores.get(value);
            if (restoredId) {
                const cid = restoredId, v = controller.inspectConversation(cid);
                if (interaction)
                    describeHostInteraction(interaction, uiText(interaction.locale, 'interaction.restore', { conversation: conversationDisplayIdentity(v) }));
                await controller.restoreConversation({ conversationId: cid, expectedGeneration: v.generation });
                if (selected === captured.conversationId && !closing)
                    await selectConversation(cid);
                setNotice('Restored ' + cid);
                return;
            }
            if (value === 'Delete conversation permanently' && !await confirmDelete(captured.conversationId))
                return;
            const input = { conversationId: captured.conversationId, expectedGeneration: captured.generation };
            if (interaction)
                describeHostInteraction(interaction, uiText(interaction.locale, value === 'Reclaim completed resource' ? 'interaction.reclaim' : value === 'Archive conversation' ? 'interaction.archive' : 'interaction.delete', { conversation: conversationDisplayIdentity(captured) }));
            const receipt = value === 'Reclaim completed resource' ? await controller.reclaimConversationResource(input) : value === 'Archive conversation' ? await controller.archiveConversation(input) : await controller.deleteConversation(input);
            if (value !== 'Reclaim completed resource') {
                const current = () => !closing && selected === captured.conversationId;
                if (!current()) return;
                const retained = controller.inspectConversationEntry();
                const fallback = retained?.reason === 'last-view' ? retained.conversationId :
                    controller.listConversations().find(view => isNavigationTarget(view, captured.conversationId, 'split'))?.conversationId;
                const destination = fallback ?? (await newConversation(null, () => {
                    if (!current()) throw Error('Conversation lifecycle view changed before creating a replacement');
                })).conversationId;
                if (!current()) return;
                // The outgoing draft and scroll were saved before lifecycle admission.
                cache.dialogs.dispose();
                cache.pane.dispose();
                views.delete(captured.conversationId);
                presentation.delete(captured.conversationId);
                second = null;
                await selectConversation(destination);
            }
            setNotice('Conversation ' + receipt.outcome + ' · ' + captured.conversationId);
            render();
        }
        finally {
            switchPending = false;
        }
    };
    const confirmDelete = async (cid: string) => {
        const { ExtensionSelectorComponent } = await import('@earendil-works/pi-coding-agent');
        // This private child modal belongs to lifecycleDialog's held reservation.
        if (closing || hostDialog)
            return false;
        return new Promise<boolean>(resolve => {
            let settled = false;
            const finish = (yes: boolean) => { if (settled)
                return; settled = true; if (hostDialog !== component) {
                resolve(false);
                return;
            } hostDialog = undefined; hostDialogCancel = undefined; component.dispose(); resolve(!closing && yes); render(); };
            const component = new ExtensionSelectorComponent('Retain evidence; permanently deny execution for ' + cid, ['Cancel', 'Delete ' + cid], v => finish(v === 'Delete ' + cid), () => finish(false), { tui: screen });
            hostDialog = component;
            hostDialogCancel = () => finish(false);
            render();
        });
    };
    const notificationDialog = async () => {
        if (hostDialog || switchPending || closing)
            return;
        const source = selected, locale = localeFor(source);
        const notices = observeRecovery(() => controller.inspectNotifications(source, { unreadOnly: true }));
        if (!notices) {
            setNotice(uiText(locale, 'notice.listUnavailable'));
            return;
        }
        if (!notices.length) {
            setNotice(uiText(locale, 'notice.empty'));
            return;
        }
        const conversations = new Map(controller.listConversations().map(view => [view.conversationId, view]));
        const available = (view: ConversationView | undefined): view is ConversationView => !!view && !view.archived && !view.deleted;
        const items = notices.map(notice => {
            if (notice.unavailable)
                return { value: notice.id, label: `${uiText(locale, 'notice.recordUnavailable')} · #${notice.id.slice(-6)}` };
            const destination = conversations.get(notice.conversationId);
            const kind = notice.resultId ? 'notice.result' : notice.kind === 'parent-changed' ? 'notice.parent' :
                notice.kind === 'owner-direction-changed' ? 'notice.direction' : 'notice.event';
            const name = available(destination) ? label(destination) : uiText(locale, 'notice.unavailable');
            return { value: notice.id, label: `${uiText(locale, kind)} · #${notice.id.slice(-6)} · ${name}` };
        });
        const id = await chooseHost(uiText(locale, 'notice.title'), items);
        if (id === undefined || closing || selected !== source)
            return;
        const original = notices.find(notice => notice.id === id);
        if (original?.unavailable) {
            setNotice(uiText(locale, 'notice.recordUnavailable'));
            return;
        }
        if (!original) {
            setNotice(uiText(locale, 'notice.changed'));
            return;
        }
        const unchanged = () => {
            const notice = observeRecovery(() => controller.inspectNotifications(source, { unreadOnly: true, notificationId: id })[0]);
            return notice && !notice.unavailable && notice.conversationId === original.conversationId && notice.resultId === original.resultId &&
                notice.kind === original.kind && notice.eventKey === original.eventKey && notice.assignmentId === original.assignmentId;
        };
        if (!unchanged()) {
            setNotice(uiText(locale, 'notice.changed'));
            return;
        }
        const target = observeRecovery(() => controller.inspectConversation(original.conversationId));
        if (!available(target)) {
            setNotice(uiText(locale, 'notice.unavailable'));
            return;
        }
        const readResult = () => observeRecovery(() => controller.inspectConversationResult(original.resultId));
        const result = original.resultId ? readResult() : undefined;
        if (original.resultId && (!result || result.resultId !== original.resultId || result.conversationId !== original.conversationId ||
            result.assignmentId !== original.assignmentId)) {
            setNotice(uiText(locale, 'notice.changed'));
            return;
        }
        const captured = JSON.stringify(result);
        const resultCurrent = () => !result || JSON.stringify(readResult()) === captured;
        await openHistoryBoundConversation(original.conversationId);
        if (closing || selected !== original.conversationId)
            return;
        if (!unchanged() || !resultCurrent()) {
            setNotice(uiText(locale, 'notice.changed'));
            return;
        }
        const destination = controller.inspectConversation(original.conversationId);
        if (!available(destination)) {
            setNotice(uiText(locale, 'notice.unavailable'));
            return;
        }
        if (destination.generation !== target.generation || destination.projectId !== target.projectId) {
            setNotice(uiText(locale, 'notice.changed'));
            return;
        }
        controller.acknowledgeNotification({ conversationId: source, notificationId: original.id });
        if (result) {
            const {text, command} = noticeResultPresentation(result, locale);
            const language = controller.getConversationLanguage(destination.conversationId).revision;
            await showInspection(uiText(locale, 'notice.resultTitle'), text, command ? {
                label: uiText(locale, 'notice.inspectOriginal'),
                run: async () => {
                    const current = controller.inspectConversation(destination.conversationId);
                    if (!available(current) || selected !== current.conversationId || current.generation !== destination.generation ||
                        current.projectId !== destination.projectId || controller.getConversationLanguage(current.conversationId).revision !== language) {
                        setNotice(uiText(locale, 'notice.changed'));
                        return;
                    }
                    if (!resultCurrent()) {
                        setNotice(uiText(locale, 'notice.changed'));
                        return;
                    }
                    try {
                        await executeHostCommand(command, current.conversationId);
                    } catch (error) {
                        const cache = views.get(current.conversationId);
                        if (cache) report(cache, error);
                    }
                },
            } : undefined);
        } else
            render();
    };
    const beginManual = (cache: ViewCache, locale: UiLocale) => {
        if (cache.preparingSend)
            throw Error(uiText(localeFor(cache.pane.conversationId), 'input.preparingExisting'));
        const abort = new AbortController();
        cache.manualAbort = abort;
        cache.manualLocale = locale;
        cache.manualPending = true;
        const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
        return { abort, signal };
    };
    const manualHistory = async (kind: 'tree' | 'compact'): Promise<'completed' | 'cancelled'> => {
        if (hostDialog || switchPending || closing)
            return 'cancelled';
        const target = selected, cache = views.get(target)!, interaction = hostInteraction, locale = localeFor(target);
        if (cache.manualPending)
            return 'cancelled';
        persist(cache);
        if (cache.draftError)
            return 'cancelled';
        const generation = cache.generation, revision = cache.revision, text = cache.pane.editor.getExpandedText();
        if (kind === 'compact') {
            const manual = beginManual(cache, locale);
            let handedOff = false;
            cache.manualStatus = uiText(locale, 'history.summaryProgress');
            // Native execution exposes its existing progress and interrupt controls.
            releaseHostInteraction(interaction);
            render();
            try {
                const selectedModel = await resolveTargetRequest(target);
                manual.signal.throwIfAborted();
                handedOff = true;
                const result = await controller.compactConversation({ conversationId: target, expectedGeneration: generation, ...selectedModel, signal: manual.signal });
                await refreshHistory(controller.inspectConversation(target), cache);
                cache.manualStatus = summaryOutcome(result, locale);
                return result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? 'completed' : 'cancelled';
            }
            catch (error) {
                if (!handedOff && manual.signal.aborted) {
                    cache.manualStatus = uiText(locale, 'history.cancelled');
                    return 'cancelled';
                }
                cache.manualStatus = uiText(locale, 'history.summaryFailed', { failure: String(error) });
                report(cache, error);
                throw error;
            }
            finally {
                if (cache.manualAbort === manual.abort) cache.manualAbort = undefined;
                cache.manualPending = false;
                render();
                pruneViews();
            }
        }
        switchPending = true;
        let ownsSwitch = true;
        const releaseSwitch = () => {
            if (!ownsSwitch) return;
            ownsSwitch = false;
            switchPending = false;
        };
        try {
            const history = await controller.getConversationHistory(target);
            if (!history)
                throw new Error('Native tree unavailable: first create genuine conversation history');
            if (closing)
                return 'cancelled';
            let finish: (result: 'completed' | 'cancelled') => void, fail: (error: unknown) => void;
            const outcome = new Promise<'completed' | 'cancelled'>((resolve, reject) => { finish = resolve; fail = reject; });
            const complete = (entryId?: string) => {
                hostDialog = undefined;
                hostDialogCancel = undefined;
                render();
                if (!entryId) {
                    finish('cancelled');
                    return;
                }
                let manual: ReturnType<typeof beginManual>;
                try { manual = beginManual(cache, locale); }
                catch (error) { fail(error); return; }
                let handedOff = false;
                cache.manualStatus = uiText(locale, 'history.opening');
                releaseSwitch();
                releaseHostInteraction(interaction);
                render();
                void (async () => {
                    const selectedModel = await resolveTargetRequest(target);
                    manual.signal.throwIfAborted();
                    handedOff = true;
                    const result = await controller.navigateConversationTree({ conversationId: target, expectedGeneration: generation, ...selectedModel, entryId, signal: manual.signal });
                    const native = result.nativeResult;
                    if (native && typeof native === 'object' && 'editorText' in native && typeof native.editorText === 'string' && views.get(target) === cache && cache.revision === revision && cache.pane.editor.getExpandedText() === text && !text) {
                        const receipt = controller.setDraft({ conversationId: target, expectedRevision: revision, text: native.editorText });
                        cache.revision = receipt.revision;
                        cache.applying = true;
                        cache.pane.editor.setText(native.editorText);
                        cache.applying = false;
                    }
                    await refreshHistory(controller.inspectConversation(target), cache);
                    cache.manualStatus = result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? uiText(locale, 'history.opened') : uiText(locale, 'history.navigation', { outcome: responseOutcome(result, locale) });
                    render();
                    finish(result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? 'completed' : 'cancelled');
                })().catch(error => {
                    if (!handedOff && manual.signal.aborted) {
                        cache.manualStatus = uiText(locale, 'history.cancelled');
                        finish('cancelled');
                    } else { cache.manualStatus = uiText(locale, 'history.navigationFailed'); report(cache, error); fail(error); }
                }).finally(() => {
                    if (cache.manualAbort === manual.abort) cache.manualAbort = undefined;
                    cache.manualPending = false;
                    render();
                });
            };
            hostDialog = new TreeSelectorComponent(history.sessionManager.getTree(), history.sessionManager.getLeafId(), terminal.rows, entryId => complete(entryId), () => complete());
            hostDialogCancel = () => complete();
            render();
            return await outcome;
        }
        finally {
            releaseSwitch();
        }
    };
    const mountHostInspection = (component: Component & { dispose(): void }, cancel: () => void) => {
        const owner = hostInteraction;
        try {
            if (owner?.conversationId === selected && owner.acknowledgeInspection) {
                owner.acknowledgeInspection();
                delete owner.acknowledgeInspection;
            }
        }
        catch (error) {
            component.dispose();
            throw error;
        }
        hostDialog = component;
        hostDialogCancel = cancel;
        render();
    };
    const chooseHost = async (title: string, labels: readonly (string | UiChoice)[], initialValue?: string): Promise<string | undefined> => {
        if (hostDialog || closing || switchPending)
            throw new Error('Finish the current dialog or conversation operation before opening another');
        if (closing)
            return undefined;
        const dialogTarget = selected, languageRevision = controller.getConversationLanguage(selected).revision;
        return new Promise((resolve, reject) => {
            const complete = (value?: string) => {
                hostDialog = undefined;
                hostDialogCancel = undefined;
                component.dispose();
                render();
                if (value !== undefined && (selected !== dialogTarget || controller.getConversationLanguage(dialogTarget).revision !== languageRevision)) {
                    reject(Error('Interface language or conversation changed; reopen this choice'));
                    return;
                }
                resolve(value);
            };
            const component = new HostPicker(title, labels, value => complete(value), () => complete(), () => terminal.rows - 8, localeFor(dialogTarget), initialValue);
            mountHostInspection(component, () => complete());
        });
    };
    const runPreparation = async <T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T> => {
        if (hostDialog || closing || switchPending)
            throw Error('Finish the current dialog before preparation');
        const abort = new AbortController();
        const component = new PreparationProgress(title, () => abort.abort(), () => screen.requestRender(), presentation, hostInteraction?.locale ?? localeFor(selected));
        hostDialog = component;
        hostDialogCancel = () => component.requestCancel();
        render();
        try {
            return await task(abort.signal, text => component.append(text));
        }
        finally {
            component.dispose();
            if (hostDialog === component) {
                hostDialog = undefined;
                hostDialogCancel = undefined;
            }
            render();
        }
    };
    const accountArguments = (operation: 'login' | 'logout', argument: string) => {
        const words = argument.split(/\s+/u).filter(Boolean);
        const method = words[1];
        if (operation === 'logout' ? words.length <= 1
            : words.length <= 2 && (method === undefined || method === 'oauth' || method === 'api_key'))
            return words;
    };
    const accountCommand = async (operation: 'login' | 'logout', argument: string): Promise<'completed' | 'cancelled'> => {
        if (!applicationAccounts)
            throw new Error('Account management requires the Gitjig application entry');
        const source = controller.inspectConversation(selected), languageRevision = controller.getConversationLanguage(selected).revision, modelRevision = controller.getConversationModelChoice(selected).revision;
        const assertAccountSource = () => {
            const now = controller.inspectConversation(source.conversationId);
            if (closing || selected !== source.conversationId || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted ||
                controller.getConversationLanguage(source.conversationId).revision !== languageRevision || controller.getConversationModelChoice(source.conversationId).revision !== modelRevision)
                throw Error('Account dialog source changed; reopen the account command in the intended conversation');
        };
        assertAccountSource();
        const authLocale = localeFor(selected);
        const words = accountArguments(operation, argument);
        if (!words)
            throw new Error(`Use /${operation} with provider${operation === 'login' ? ' and optional method' : ''}; enter credentials only in the protected prompt`);
        const accounts = await applicationAccounts.status();
        assertAccountSource();
        const provider = words[0] || await chooseHost(uiText(authLocale, 'account.title', { operation: uiText(authLocale, `account.${operation}`) }), accounts.filter(account => operation === 'logout' || account.methods.length).map(account => account.provider));
        assertAccountSource();
        if (!provider)
            return 'cancelled';
        const account = accounts.find(account => account.provider === provider);
        if (!account)
            throw new Error('Unknown account provider; use /accounts');
        let method: 'api_key' | 'oauth' | undefined;
        if (operation === 'login') {
            const selected = words[1] || await chooseHost(uiText(authLocale, 'account.method', { provider }), account.methods.map(method => `${method.type} · ${method.label}`));
            assertAccountSource();
            if (!selected)
                return 'cancelled';
            const type = selected.split(' · ')[0];
            if (!account.methods.some(method => method.type === type))
                throw new Error('Unsupported login method; select a listed account method');
            method = type as 'api_key' | 'oauth';
        }
        if (hostDialog || closing || switchPending)
            return 'cancelled';
        assertAccountSource();
        const dialog = new AccountDialog(screen, render, { locale: authLocale, forceSecret: method === 'api_key', onLeave: () => requestClose(), ...(options.signal ? { signal: options.signal } : {}) });
        hostDialog = dialog;
        hostDialogCancel = () => dialog.cancel();
        render();
        try {
            const result = operation === 'login' ? await applicationAccounts.login(provider, method!, dialog.interaction) : await applicationAccounts.logout(provider, dialog.signal);
            setNotice(`Account ${operation} stored · ${provider}${result.account.configured ? ' · literal model source remains configured' : ''}${result.synchronized ? '' : ' · local synchronization unavailable'} · availability not checked`);
            return 'completed';
        }
        catch (error) {
            if (dialog.signal.aborted && !closing) {
                const current = (await applicationAccounts.status()).find(account => account.provider === provider);
                throw new Error(`Account ${operation} cancelled; current stored credential: ${current?.stored ?? 'none'}. Use /accounts before retrying`);
            }
            if (closing)
                return 'cancelled';
            throw error;
        }
        finally {
            dialog.dispose();
            if (hostDialog === dialog) {
                hostDialog = undefined;
                hostDialogCancel = undefined;
            }
            render();
        }
    };
    const inputHost = async (title: string, value: string, description?: string): Promise<string | undefined> => {
        if (hostDialog || closing || switchPending)
            return undefined;
        return new Promise(resolve => {
            const complete = (value?: string) => { hostDialog = undefined; hostDialogCancel = undefined; component.dispose(); render(); resolve(value); };
            const component = productInput(title, value, value => complete(value), () => complete(), screen, description);
            hostDialog = component;
            hostDialogCancel = () => complete();
            render();
        });
    };
    const forkContext = async (kind: 'fork' | 'clone', target: string): ReturnType<typeof forkCommand> => {
        if (closing || hostDialog || switchPending)
            return 'cancelled';
        const cache = views.get(target);
        if (!cache || selected !== target)
            throw new Error('Return to the intended conversation before creating a context copy');
        switchPending = true;
        try {
            return await forkCommand({ controller, isCurrent: () => !closing && selected === target && views.get(target) === cache,
                activate: selectConversation, notice: setNotice,
                chooseEntry: history => new Promise(resolve => {
                    if (closing || hostDialog || selected !== target || views.get(target) !== cache) {
                        resolve(undefined);
                        return;
                    }
                    let settled = false, guidanceRevision: number | undefined;
                    const complete = (entryId?: string) => {
                        if (settled)
                            return;
                        settled = true;
                        if (hostDialog !== component) {
                            resolve(undefined);
                            return;
                        }
                        hostDialog = undefined;
                        hostDialogCancel = undefined;
                        if (noticeRevision === guidanceRevision) {
                            noticeMessage = '';
                            noticeRevision++;
                        }
                        render();
                        resolve(closing ? undefined : entryId);
                    };
                    const component = new TreeSelectorComponent(history.sessionManager.getTree(), history.sessionManager.getLeafId(), terminal.rows, entryId => complete(entryId), () => complete());
                    hostDialog = component;
                    hostDialogCancel = () => complete();
                    setNotice(uiText(localeFor(target), 'interaction.forkGuide', { confirm: getKeybindings().getKeys('tui.select.confirm').join('/'), cancel: getKeybindings().getKeys('tui.select.cancel').join('/') }));
                    guidanceRevision = noticeRevision;
                }),
            }, kind, target);
        }
        finally {
            switchPending = false;
        }
    };
    const showInspection: ReviewPageHost['show'] = async (title, text, action, position) => {
        if (hostDialog || closing || switchPending)
            throw Error('Finish the current dialog before opening details');
        const confirmed = await new Promise<boolean>(resolve => {
            const complete = (confirmed = false) => {
                if (position)
                    position.scrollTop = component.scrollTop;
                component.dispose();
                hostDialog = undefined;
                hostDialogCancel = undefined;
                render();
                resolve(confirmed);
            };
            const component = new InspectionDetails(title, text, () => complete(), localeFor(selected),
                action ? {label: action.label, confirm: () => complete(true)} : undefined, position?.scrollTop);
            mountHostInspection(component, complete);
        });
        if (confirmed && !closing)
            await action?.run();
    };
    const executeHostCommand: HostCommandExecutor = async (command, target, context) => {
        const outcome = await slash.execute(command, target, context);
        return outcome === 'not-command' ? 'cancelled' : outcome;
    };
    const runProjectSelection = async (target: string, invoke: () => Promise<HostCommandOutcome>,
        onHeld?: (destination: string) => void): Promise<HostCommandOutcome> => {
        const owner = hostInteraction, cache = views.get(target);
        try {
            return await invoke();
        } catch (error) {
            if (!(error instanceof ProjectChangeHeld) || owner?.conversationId !== target || !cache || closing || switchPending ||
                hostInteraction !== owner || selected !== target || views.get(target) !== cache)
                throw error;
            onHeld?.(error.projectTarget.id);
            report(cache, error);
            return failureIsActive(cache) ? executeHostCommand('/error', target) : 'cancelled';
        }
    };
    const runSelectedCommand = (request: NonNullable<ReturnType<HostCommands['prepare']>>, target: string,
        context?: HostCommandContext, onHeld?: (destination: string) => void) => {
        const invoke = () => request.run(target, context);
        return request.name === 'project' ? runProjectSelection(target, invoke, onHeld) : invoke();
    };
    const executeSelectedCommand: HostCommandExecutor = async (command, target, context) => {
        const request = slash.prepare(command);
        return request ? runSelectedCommand(request, target, context) : 'cancelled';
    };
    const updateManaged = () => {
        for (const [cid, entry] of managedTasks) {
            const current = controller.inspectConversation(cid);
            if (!entry.workId && current.workId && (current.workId !== entry.priorWork || current.generation !== entry.generation))
                entry.workId = current.workId;
            if (entry.workId) {
                if (entry.boundGeneration === undefined && current.workId === entry.workId)
                    entry.boundGeneration = current.generation;
                if (entry.command && entry.cache.localRevision === entry.command.revision && entry.cache.pane.editor.getExpandedText() === entry.command.text) {
                    try {
                        const receipt = controller.setDraft({ conversationId: cid, expectedRevision: entry.cache.revision, text: '' });
                        entry.cache.revision = receipt.revision;
                        entry.cache.localRevision = receipt.revision;
                        entry.cache.applying = true;
                        entry.cache.pane.editor.setText('');
                        entry.cache.applying = false;
                    }
                    catch (error) {
                        reportDraftFailure(entry.cache, error);
                    }
                }
                delete entry.command;
            }
        }
        render();
    };
    const launchManaged = (target: string, task: Promise<ChangeView>, workId?: string, submission?: HostCommandContext['submission']) => {
        void task.catch(() => { }); // The controller owns settlement even if presentation setup fails.
        const view = controller.inspectConversation(target), cache = cacheFor(view), text = cache.pane.editor.getExpandedText();
        const command = submission?.conversationId === target && submission.text === text && submission.revision === cache.localRevision
            ? { text: submission.text, revision: submission.revision } : undefined;
        cache.standaloneOutcome = undefined;
        const entry: ManagedTask = {
            task: undefined as unknown as Promise<void>, ...(workId ? { workId } : {}), priorWork: view.workId, generation: view.generation, boundGeneration: undefined as number | undefined, noticeRevision, cache,
            ...(workId && !view.workId ? { standalone: { workId, projectId: view.projectId } } : {}),
            ...(!workId && command ? { command } : {}) };
        const ownsTask = () => !closing && managedTasks.get(target) === entry;
        const canShowLinked = (resource: ConversationView, id: string) =>
            ownsTask() && selected === target && noticeRevision === entry.noticeRevision &&
            resource.workId === id && resource.generation === entry.boundGeneration;
        // Attach both outcomes to this exact owned task before any UI yield.
        entry.task = task.then(result => {
            entry.workId = result.workId;
            // A retained work ID belongs to the original task. Only this attempt's result acknowledges its command.
            if (workId && command)
                entry.command = command;
            updateManaged();
            const currentResource = controller.inspectConversation(target);
            if (ownsTask() && (standaloneManagedWork(currentResource) === result.workId || canShowLinked(currentResource, result.workId))) {
                // A single rich current inspection belongs to settlement, not hot rendering.
                const current = controller.inspectChange(result.workId), activity = controller.inspectChangeActivity(result.workId);
                const resource = controller.inspectConversation(target);
                const locale = localeFor(target);
                const standaloneWork = standaloneManagedWork(resource);
                const notice = managedChangeCompletionNotice(result, current, activity, resource, locale, standaloneWork);
                // The settled pane already carries its recorded status. A footer notice adds only distinct guidance.
                if (notice && standaloneWork === result.workId && ownsTask()) {
                    cache.standaloneOutcome = { text: uiText(locale, 'task.change.standaloneOutcome', { outcome: notice, work: result.workId }),
                        generation: resource.generation, projectId: resource.projectId };
                } else if (notice && canShowLinked(resource, result.workId) && !observeTasks(target).summary(resource, locale).lines.includes(notice)) {
                    setNotice(notice);
                }
            }
        }, error => {
            // A diagnostic can point at the original blocker or a rolled-back
            // allocation. Only the committed managed cursor acknowledges a start.
            updateManaged();
            setError(cache, presentFailure(cache, error));
        }).catch(error => { setError(cache, failurePresentation(error)); }).finally(() => {
            if (managedTasks.get(target) === entry)
                managedTasks.delete(target);
            if (!closing) {
                render();
                pruneViews();
            }
        });
        managedTasks.set(target, entry);
        render();
    };
    const externalModel = model ? { externalModel: { provider: model.provider, modelId: model.modelId } } : {};
    modelUI = modelCommands({ controller, hostLanguage, chooseItems: chooseHost, ...externalModel, ...applicationAccounts ? { accounts: applicationAccounts } : {}, ...options.models ? { models: options.models } : {}, choose: chooseHost, show: showInspection, notice: setNotice, isCurrent: target => !closing && selected === target });
    localUI = localCommands({ controller, execute: executeHostCommand, choose: chooseHost, chooseItems: chooseHost, input: inputHost, show: showInspection, notice: setNotice, locale: localeFor, runPreparation, isCurrent: target => !closing && selected === target });
    sourceSaveUI = sourceSaveCommands({ controller, locale: localeFor, isCurrent: target => !closing && selected === target, choose: chooseHost, chooseItems: chooseHost, input: inputHost, show: showInspection, notice: message => setNotice(message, true), runPreparation });
    repositoryUI = repositoryCommands({ controller, uiLocale: localeFor, chooseItems: chooseHost, execute: executeHostCommand, ...model ? { model } : {}, choose: chooseHost, input: inputHost, show: showInspection, notice: setNotice, withActivity: withHostActivity, isCurrent: target => !closing && selected === target });
    const configureRuntime = options.models ? async (target: string, focus?: HostCommandContext['runtimeSetupFocus']) =>
        await executeHostCommand('/setup runtime', target, focus ? { runtimeSetupFocus: focus } : undefined) === 'completed' : undefined;
    const retainedInputHost: RetainedInputHost = {
        controller, choose: chooseHost, chooseItems: chooseHost, show: showInspection, notice: setNotice, locale: localeFor,
        inspectWork: (target, workId, context) => executeHostCommand('/work ' + workId, target, context),
        isCurrent: target => !closing && selected === target,
        ...(configureRuntime ? { configureRuntime } : {}),
        ...(options.models && !model ? {
            configureModel: async (target, modelSelectionGuard) =>
                await executeHostCommand('/model', target, { modelSelectionGuard }) === 'completed',
        } : {}),
        inputWithdrawn: (target, receipt) => {
            const cache = views.get(target);
            if (!cache) return;
            if (failureIsActive(cache) && (receipt.inputId === cache.failure?.inputId || matchesRunAttempt(receipt, cache.failure)))
                setError(cache, null);
            const outcome = cache.responseStatus;
            if (outcome && matchesRunAttempt(receipt, outcome) && hasCleanCleanup(outcome.cleanup) &&
                (outcome.status === 'unavailable' || outcome.status === 'interrupted'))
                cache.responseStatus = undefined;
        },
        retry: async (target, input, interruptedFingerprint) => {
            const cache = views.get(target)!;
            if (cache.preparingSend) {
                setNotice(uiText(localeFor(target), 'input.preparingExisting'));
                return false;
            }
            const retriedFailure = failureIsActive(cache) && matchesRunAttempt(input, cache.failure)
                ? { workId: input.workId, runId: input.runId, revision: cache.errorRevision! } : undefined;
            const { inputId, fingerprint } = input;
            const requireRuntime = () => {
                if (!interruptedFingerprint && controller.inspectConversation(target).projectId && !controller.options.runtimeProfile)
                    throw Error('Configure the project runtime through /ready before retrying. The sent request is retained.');
            };
            requireRuntime();
            const preparation = prepareSend(cache, retriedFailure);
            preparation.stage = 'model';
            // Review is finished; allow drafting while this original prepares.
            releaseHostInteraction(hostInteraction);
            render();
            try {
                const choice = interruptedFingerprint ? controller.getConversationModelChoice(target) : undefined;
                const selectedModel = choice?.kind === 'managed' && options.models ? options.models.conversationOperation(target)
                    : choice && model ? { model } : await resolveTargetRequest(target);
                preparation.signal.throwIfAborted();
                requireRuntime();
                cache.preparingSend = undefined;
                const request = { conversationId: target, ...selectedModel, signal: preparation.signal };
                dispatchResponse(cache, preparation, inputId, () => {
                    if (interruptedFingerprint)
                        return controller.retryInterruptedConversationInput({ ...request, inputId, expectedContext: interruptedFingerprint });
                    controller.recoverConversationInput({ conversationId: target, inputId, expectedContext: fingerprint, action: 'retry' });
                    return controller.runConversation({ ...request, initialInputId: inputId });
                });
            } catch (error) {
                if (!preparation.signal.aborted) throw error;
                requestNotice(cache, uiText(localeFor(target), 'input.retryCancelled'));
                return false;
            } finally {
                cache.submitting = false;
                if (cache.preparingSend === preparation) cache.preparingSend = undefined;
                render();
            }
        },
    };
    const reviewInput: ReviewRetainedInput = (target, originalInput, context) =>
        reviewConversationInputs(retainedInputHost, target, {context, originalInput});
    const slash: HostCommands = new HostCommands([
        ...modelUI.commands,
        ...(options.onReset ? resetCommands({ controller, locale: localeFor, isCurrent: target => !closing && selected === target,
            choose: chooseHost, chooseItems: chooseHost, show: showInspection,
            request: (handoff, locale) => {
                const conversation = selected;
                requestClose();
                if (!closing) return false;
                options.onReset!(handoff, locale, conversation);
                return true;
            },
        }) : []),
        ...languageCommands({ controller, hostLanguage, input: inputHost, notice: setNotice, isCurrent: target => !closing && selected === target }),
        ...localUI.commands,
        ...repositoryUI.commands,
        ...sourceSaveUI.commands,
        ...inputCommands(retainedInputHost),
        ...workCommands({ controller, locale: localeFor, execute: executeHostCommand, choose: chooseHost, chooseItems: chooseHost, input: inputHost, show: showInspection, notice: setNotice, activate: selectConversation, isCurrent: target => !closing && selected === target }),
        ...changeCommands({ controller, execute: executeHostCommand, locale: localeFor, choose: chooseHost, chooseItems: chooseHost, show: showInspection, isCurrent: target => !closing && selected === target,
            controls: { ...(options.models ? { models: options.models } : {}), ...(model ? { model } : {}), input: inputHost, draft: target => views.get(target)?.pane.editor.getExpandedText() ?? controller.inspectConversation(target).draft.text, notice: setNotice, prepareProjectSourceCheck, activateSource: openHistoryBoundConversation, launch: launchManaged } }),
        ...readinessCommands({ controller, reviewInput, localRequest: localRequestStatus, restartArguments: options.restartArguments, hostLanguage, chooseItems: chooseHost, ...externalModel, ...(applicationAccounts ? { accounts: applicationAccounts } : {}), ...(options.models ? { models: options.models } : {}),
            isCurrent: target => !closing && selected === target, choose: chooseHost, show: showInspection, notice: setNotice, execute: executeSelectedCommand }),
        ...errorCommands({ controller, commandKeyLabel: keyLabel, isCurrent: target => !closing && selected === target,
            assertAvailable: () => { if (hostDialog || closing || switchPending)
                throw Error('Finish the current dialog before opening error details'); },
            failure: target => views.get(target)?.failure ?? null,
            draftRecovery: target => {
                const cache = views.get(target), problem = cache?.draftError;
                if (!cache || !problem) return;
                const revision = cache.localRevision, text = cache.pane.editor.getExpandedText();
                return { ...problem, retry: () => {
                    if (closing || selected !== target || views.get(target) !== cache || cache.draftError !== problem ||
                        cache.localRevision !== revision || cache.pane.editor.getExpandedText() !== text)
                        return 'changed';
                    persist(cache);
                    return cache.draftError ? 'failed' : 'saved';
                } };
            },
            failureStatus: target => {
                const cache = views.get(target);
                return cache && { active: failureIsActive(cache), revision: cache.errorRevision ?? 0, retrying: retryingFailure(cache) };
            },
            reportProjectHold: (target, error) => report(views.get(target)!, error),
            choose: chooseHost, showReview: showInspection, notice: setNotice, execute: executeHostCommand,
            openConversation: selectConversation,
            reviewInput,
            openProject: (target, project, validateSource) => createAndSelectConversation({ project, validateSource }, target) }),
        ...projectCommands({ controller, initialDirectory: options.initialDirectory, show: showInspection, hostLanguage, chooseItems: chooseHost, choose: chooseHost, input: inputHost, notice: setNotice,
            isCurrent: target => !closing && selected === target, refresh: async target => {
                const cache = views.get(target);
                if (cache?.failure && (isProjectChangeHold(cache.failure.code) || cache.failure.code === projectSourceUnavailableCode)) {
                    if (failureIsActive(cache)) setError(cache, null);
                    cache.failure = null;
                }
                await selectConversation(target);
            } }),
        ...goalCommands({ controller, show: showInspection, locale: localeFor, isCurrent: target => !closing && selected === target, input: inputHost, choose: chooseHost, resolve: resolveTargetRequest, notice: setNotice, ...(configureRuntime ? { configureRuntime } : {}), work: (target, context, workId) => executeHostCommand(workId ? '/work ' + workId : '/work', target, context),
            inputs: (target, context) => executeHostCommand('/inputs', target, context) }),
        ...sessionCommands({ controller, choose: chooseHost, input: inputHost, copy: copyToClipboard, notice: setNotice, fork: forkContext,
            resume: async (id) => {
                if (!id)
                    return switchDialog();
                if (!controller.listConversations().some(view => view.conversationId === id && !view.archived && !view.deleted))
                    throw new Error('Choose an accessible conversation with /resume');
                await selectConversation(id);
                return 'completed';
            } }),
        commandDiscovery({ controller, hostLanguage, registry: () => slash, choose: chooseHost, chooseItems: chooseHost, isCurrent: target => !closing && selected === target }),
        ...(applicationSettings && applicationAccounts && options.models ? configurationCommands({ controller, settings: applicationSettings, accounts: applicationAccounts, models: options.models, ...externalModel,
            choose: chooseHost, chooseItems: chooseHost, uiLocale: localeFor, show: showInspection, runPreparation,
            operatorClaude: options.operatorClaude, restartArguments: options.restartArguments, execute: executeHostCommand,
            ...(options.onReset ? { reset: (target: string) => executeHostCommand('/reset', target) } : {}), input: inputHost, isCurrent: target => !closing && selected === target, notice: setNotice, apply: reloadPresentation, assertPresentationChange, commandKey: keyLabel, ...(applicationKeybindings ? { keybindingsFile: applicationKeybindings.file } : {}) }).map(command => ({ ...command, run: (...args: Parameters<HostCommand['run']>) => modelUI!.track(Promise.resolve(command.run(...args))) })) : []),
        { name: 'login', descriptionId: 'command.description.login', argumentHint: '[provider [api_key|oauth]]', acceptsArgument: argument => !!accountArguments('login', argument), run: argument => accountCommand('login', argument) },
        { name: 'logout', descriptionId: 'command.description.logout', argumentHint: '[provider]', acceptsArgument: argument => !!accountArguments('logout', argument), run: argument => accountCommand('logout', argument) },
        { name: 'accounts', descriptionId: 'command.description.accounts', run: async () => {
                if (!applicationAccounts)
                    throw new Error('Account management requires the Gitjig application entry');
                const accounts = (await applicationAccounts.status()).filter(account => account.stored || account.configured);
                const labels = accounts.map(account => `${account.provider} · stored ${account.stored ?? 'none'} · configured ${account.configured ? 'yes' : 'no'}`);
                if (!await chooseHost('Pi accounts · availability not checked · Claude Code identity is managed separately', labels.length ? labels : ['No application credentials configured']))
                    return 'cancelled';
                setNotice('Account status closed; availability not checked');
                return 'completed';
            } },
        { name: 'new', descriptionId: 'command.description.new', argumentHint: '[project|root]', run: createAndSelectConversation },
        { name: 'tree', descriptionId: 'command.description.tree', run: async () => manualHistory('tree') },
        { name: 'compact', descriptionId: 'command.description.compact', run: async () => manualHistory('compact') },
        { name: 'notifications', descriptionId: 'command.description.notifications', run: async () => notificationDialog() },
        { name: 'reclaim', descriptionId: 'command.description.reclaim', run: async (_argument, target) => {
                const view = controller.inspectConversation(target);
                await controller.reclaimConversationResource({ conversationId: target, expectedGeneration: view.generation });
                setNotice('Completed client reclaimed');
            } },
        { name: 'quit', descriptionId: 'command.description.quit', run: async () => { requestClose(); } },
    ]);
    const unsubscribeGoals = controller.subscribeGoals(() => render());
    const unsubscribe = controller.subscribeInteraction(event => {
        if (event.type === 'native-settling')
            views.get(event.conversationId)?.dialogs.dispose();
        if (closing)
            return;
        try {
            if (event.type === 'input-queued') {
                const input = event.data as InputReceipt | undefined;
                if (input?.acknowledgedDraft)
                    views.get(event.conversationId)?.preparingSend?.acknowledgeDraft?.(input);
            }
            const view = controller.inspectConversation(event.conversationId);
            const cache = cacheFor(view);
            retireStaleResponseFailure(cache);
            if (!cache.registration && (view.conversationId === selected || view.conversationId === second))
                void refreshHistory(view, cache);
            pruneViews();
            render();
        }
        catch (error) {
            const cache = views.get(event.conversationId);
            if (cache)
                report(cache, error);
        }
    });
    const toggleSplit = async () => {
        if (closing || hostDialog || switchPending)
            return;
        if (!second) {
            await switchDialog('split');
            return;
        }
        persist(views.get(second)!);
        saveScroll(views.get(second)!);
        if (views.get(second)!.draftError)
            throw new DraftPersistenceHeld(uiText(localeFor(selected), 'error.draftSplitHeld'));
        controller.setConversationView({ selectedId: selected, secondId: null });
        second = null;
        leftId = selected;
        pruneViews();
        render();
    };
    const runCommand = async (command: ConversationCommand) => {
        if (closing || hostDialog || switchPending)
            return;
        switch (command) {
            case 'c': return switchDialog();
            case 'd': return switchDialog('children');
            case 'p': return navigateHierarchy('parent');
            case 's': return toggleSplit();
            case 'w':
                if (second) {
                    activateConversation(second);
                    render();
                    pruneViews();
                }
                else {
                    setNotice(uiText(localeFor(selected), 'navigation.secondUnavailable', { key: keyLabel }));
                }
                return;
            case 'j': return executeSelectedCommand('/project', selected);
            case 'e': return executeHostCommand('/error', selected);
            case 't': return slash.execute('/ready', selected);
            case '/': return slash.execute('/help', selected);
            case 'n': return createAndSelectConversation();
            case 'r': return slash.execute('/result', selected);
            case 'h': return manualHistory('tree');
            case 'm': return manualHistory('compact');
            case 'l': return lifecycleDialog();
            case 'q': return requestClose();
        }
    };
    const commandMenu = () => {
        if (closing || hostDialog || switchPending)
            return;
        noticeMessage = '';
        noticeRevision++;
        const complete = (command?: ConversationCommand) => {
            hostDialog = undefined;
            hostDialogCancel = undefined;
            if (command) {
                const cache = views.get(selected)!;
                void runHostInteraction(() => runCommand(command), command === '/' ? '/help' : uiText(localeFor(selected), `command.${command}`)).catch(error => report(cache, error));
            }
            else render();
        };
        hostDialog = new CommandMenu(command => complete(command), () => complete(), commandKey, localeFor(selected));
        hostDialogCancel = () => complete();
        render();
    };
    terminal.interceptInput = data => {
        if (closing) return true;
        if (!hostInteraction || hostDialog) return false;
        // Own input before Pi can route mouse or viewport shortcuts to the previous layout.
        const press = !isKeyRelease(data) && !isKeyRepeat(data);
        if (press && matchesHostKey(data, 'ctrl+d')) {
            try { requestClose(); }
            catch (error) { report(views.get(selected)!, error); }
        }
        else if (press && hostInteraction.interrupt && !hostInteraction.interrupt.signal.aborted && getKeybindings().matches(data, 'app.interrupt')) {
            hostInteraction.interrupt.abort();
            render();
        }
        return true;
    };
    const removeInput = screen.addInputListener(data => {
        try {
            if (closing)
                return { consume: true };
            const cache = views.get(selected);
            if (!cache)
                return undefined;
            if (hostDialog instanceof CommandMenu) {
                hostDialog.handleInput(data);
                screen.requestRender();
                return { consume: true };
            }
            if (hostDialog)
                return acceptsDialogKeyEvent(data) ? undefined : { consume: true };
            // Legacy terminal bytes contain no repeat/release distinction.
            const press = !isKeyRelease(data) && !isKeyRepeat(data);
            if (cache.dialogs.component)
                return acceptsDialogKeyEvent(data) ? undefined : { consume: true };
            if (!press && getKeybindings().matches(data, 'app.interrupt') && editorKeyOwner(cache))
                return { consume: true };
            const functionKey = hostFunctionKey(data);
            if (functionKey && !functionKey.press)
                return { consume: true };
            if (switchPending && (functionKey || ([commandKey, 'shift+up', 'shift+down', 'alt+enter'] as const).some(key => matchesHostKey(data, key)) || getKeybindings().matches(data, 'tui.input.submit')))
                return { consume: true };
            if (matchesKey(data, 'shift+up') || matchesKey(data, 'shift+down')) {
                if (screen.hasOverlay() || screen.getFocusedComponent() !== cache.pane.editor || cache.pane.editor.isShowingAutocomplete())
                    return undefined;
                if (press)
                    void navigateHierarchy(matchesKey(data, 'shift+up') ? 'parent' : 'child').catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesHostKey(data, commandKey)) {
                if (press) commandMenu();
                return { consume: true };
            }
            if (functionKey?.key === 'f2') {
                void runHostInteraction(() => switchDialog(), uiText(localeFor(selected), 'command.c')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f3') {
                void runHostInteraction(() => createAndSelectConversation(), uiText(localeFor(selected), 'command.n')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f6') {
                if (!cache.manualPending)
                    void runHostInteraction(() => manualHistory('tree'), uiText(localeFor(selected), 'command.h')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f7') {
                if (!cache.manualPending)
                    void runHostInteraction(() => manualHistory('compact'), uiText(localeFor(selected), 'command.m')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f8') {
                void runHostInteraction(() => lifecycleDialog(), uiText(localeFor(selected), 'command.l')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f5') {
                void runHostInteraction(() => notificationDialog(), '/notifications').catch(error => report(cache, error));
                return { consume: true };
            }
            if (functionKey?.key === 'f4') {
                void runHostInteraction(() => toggleSplit(), uiText(localeFor(selected), 'command.s')).catch(error => report(cache, error));
                return { consume: true };
            }
            const followUp = matchesKey(data, 'alt+enter');
            if (followUp || getKeybindings().matches(data, 'tui.input.submit')) {
                const keyOwner = editorKeyOwner(cache);
                if (!keyOwner)
                    return undefined;
                if (!press)
                    return { consume: true };
                if (followUp ? keyOwner === 'composer' : prepareHostEditorSubmit(cache.pane.editor, data, slash.commands))
                    submitAndTrack(cache.registration || cache.dispatching ? followUp ? 'follow-up' : 'steer' : 'idle');
                return { consume: true };
            }
            return undefined;
        }
        catch (error) {
            const cache = views.get(selected);
            if (cache)
                report(cache, error);
            return { consume: true };
        }
    });
    process.stdout.on('resize', onResize);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const retained = options.restoreView ? controller.inspectConversationEntry() : undefined;
        if (retained?.conversationId === selected)
            second = retained.secondConversationId ?? null;
        for (const view of controller.listConversations()) {
            const handle = controller.getNativeHandle(view.conversationId);
            if (handle)
                cacheFor(view);
        }
        const initial = activateConversation(selected);
        void refreshHistory(initial.view, initial.cache);
        if (second) {
            const alternate = controller.inspectConversation(second);
            void refreshHistory(alternate, cacheFor(alternate));
        }
        if (second && !visibleSecond())
            setNotice([options.entryNotice, narrowSplitNotice()].filter(Boolean).join('\n'), true);
        else if (options.entryNotice)
            setNotice(options.entryNotice);
        else
            render();
        pruneViews();
        screen.start();
        terminalStarted = true;
        if (options.signal?.aborted)
            onAbort();
        await leaving;
        if (forcedDraftFailure)
            throw forcedDraftFailure;
        for (const cache of views.values()) {
            persist(cache);
            if (cache.draftError)
                throw new Error(`Draft persistence unavailable: ${cache.draftError.summary}`);
            saveScroll(cache);
        }
    }
    finally {
        closing = true;
        clearHostWait();
        controller.quiesceInteractionHost();
        hostDialogCancel?.();
        if (progressTimer)
            clearInterval(progressTimer);
        process.stdout.removeListener('resize', onResize);
        if (retentionTimer)
            clearTimeout(retentionTimer);
        options.signal?.removeEventListener('abort', onAbort);
        removeInput();
        try {
            await settleHostCommands([() => applicationAccounts ? ApplicationStartup.open(controller).close() : Promise.resolve(), () => modelUI?.close() ?? Promise.resolve(), () => localUI?.close() ?? Promise.resolve(), () => repositoryUI?.close() ?? Promise.resolve(), () => sourceSaveUI?.close() ?? Promise.resolve()], () => controller.settleInteractionHost({ identities: [...owned.values()] }));
        }
        finally {
            await Promise.allSettled([...interactionTasks, ...historyReads]);
            try {
                await controller.settleConversationChanges();
                await Promise.allSettled([...managedTasks.values()].map(entry => entry.task));
            }
            finally {
                try {
                    await applicationAccounts?.close();
                }
                finally {
                    unsubscribeGoals();
                    unsubscribe();
                    try {
                        for (const cache of views.values()) {
                            cache.dialogs.dispose();
                            cache.pane.dispose();
                        }
                    }
                    finally {
                        if (terminalStarted)
                            screen.stop({ preserveScreen: true });
                    }
                }
            }
        }
    }
}

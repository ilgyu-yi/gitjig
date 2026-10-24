import type { ResetScope, ResetDisposition } from '../app/reset.js';
import { resetCommands } from './reset-commands.js';
import { errorCommands } from './error-commands.js';
import type { UiChoice } from './choices.js';
import { uiText, hostUiLanguage, resolveUiLanguage } from './i18n.js';
import { managedModelGuidance } from './managed-model-guidance.js';
import { entryIssues, type EntryIssue } from './entry-guidance.js';
import { inputCommands } from './input-commands.js';
import { modelCommands } from './model-commands.js';
import { languageCommands } from './language-commands.js';
import { localCommands } from './local-commands.js';
import { repositoryCommands } from './repository-commands.js';
import { newConversationAction } from './new-conversation.js';
import { commandDiscovery } from './command-discovery.js';
import { workCommands } from './work-commands.js';
import type { ChangeView } from '../controller/change-types.js';
import { changeCommands } from './change-commands.js';
import { InspectionDetails } from './inspection-details.js';
import { readinessCommands } from './readiness-commands.js';
import { matchesHostKey, normalizeHostKeyEvent } from './command-input.js';
import { productInput } from './product-input.js';
import { FailureDetails, failurePresentation, type FailurePresentation } from './failure-details.js';
import { projectCommands } from './project-commands.js';
import { goalCommands } from './goal-commands.js';
import type { Controller } from '../controller/controller.js';
import type { PiModelSelection } from '../pi/session.js';
import type { ConversationView, ConversationTurnResult, NativeIdentity, NativeRegistration } from '../controller/interaction-types.js';
import { initTheme, DynamicBorder, copyToClipboard, TreeSelectorComponent } from '@earendil-works/pi-coding-agent';
import { ProcessTerminal, HStack, VStack, Text, getKeybindings, matchesKey, isKeyRelease, isKeyRepeat, truncateToWidth, stripTerminalSequences, type Component } from '@earendil-works/pi-tui';
import { createNativeEditorFactory, nativeHostDefinitions, prepareHostEditorSubmit, submitKeyLabel } from './native-editor.js';
import { chrome } from './chrome.js';
import { NativePane } from './native-pane.js';
import { hasCleanCleanup, responseOutcome, shellOutcome, preparationLabel } from './conversation-activity.js';
import { taskPresentation } from './task-presentation.js';
import { PreparationProgress } from './preparation-progress.js';
import { createNativeScreen } from './native-screen.js';
import { NativeDialogs } from './native-dialogs.js';
import { ConversationNavigator, compactConversationPath, conversationRelations } from './conversation-navigator.js';
import { CommandMenu, type ConversationCommand } from './command-menu.js';
import { commandKeyLabel, defaultCommandKey, isCommandKey, type CommandKey } from './command-key.js';
import { settleHostCommands, HostCommands, type HostCommand, type HostCommandExecutor, type HostCommandContext } from './host-commands.js';
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
    entryNotice?: string;
    onReset?: (scope: ResetScope, locale: import('./i18n.js').UiLocale, disposition: ResetDisposition) => void;
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
interface ViewCache {
    pane: NativePane;
    dialogs: NativeDialogs;
    revision: number;
    localRevision: number;
    generation: number;
    registration: NativeRegistration | null;
    applying: boolean;
    error: string | null;
    draftError: string | null;
    failure: FailurePresentation | null;
    humanSequence: number;
    idleSince: number | null;
    manualPending: boolean;
    manualStatus: string | null;
    submitting?: boolean;
    preparingSend?: AbortController | undefined;
    startingResponse?: AbortController | undefined;
    cancellingResponse?: boolean;
    entryIssues?: EntryIssue[];
    setupDraft?: boolean;
    /** Dispatched responses not yet settled; their own requests are progress, not retained input. */
    dispatching?: number;
    startingInputId?: string | undefined;
    responseStatus?: Pick<ConversationTurnResult, 'status' | 'cleanup'> | undefined;
}
/** Keep the failure cause and any unresolved physical cleanup visible together. */
export function summaryOutcome(result: Pick<ConversationTurnResult, 'status' | 'cleanup' | 'failure'>): string {
    const clean = hasCleanCleanup(result.cleanup);
    if (result.status === 'delivered' && clean)
        return 'Summary complete.';
    if (result.failure)
        return `Summary ${result.status}: ${result.failure}${clean ? '' : `; cleanup: ${result.cleanup}.`}`;
    return `Summary ${result.status}; cleanup: ${result.cleanup}.`;
}
/** One native terminal over the same controller and actual ordinary/role sessions. */
export async function startConversationUI(options: StartConversationUIOptions): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error('Conversation UI requires an actual interactive terminal');
    const { controller, model } = options;
    const applicationSettings = options.models ? ApplicationSettings.open(controller) : undefined;
    const applicationAccounts = options.models ? (await import('../app/accounts.js')).ApplicationAccounts.open(controller) : undefined;
    const resolveTargetModel = async (target: string): Promise<PiModelSelection> => {
        const view = controller.inspectConversation(target);
        if (view.projectId && !controller.options.runtimeProfile)
            throw new Error('Project execution needs a runtime. Open /ready for the next setup step, choose Save and apply runtime, then retry this preserved draft.');
        const choice = controller.getConversationModelChoice(target);
        if (options.models && choice.kind === 'managed')
            return options.models.resolve(target);
        if (choice.kind === 'legacy-external' && (!model || model.provider !== choice.provider || model.modelId !== choice.modelId))
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
    let managedTimer: ReturnType<typeof setInterval> | undefined;
    const managedTasks = new Map<string, {
        task: Promise<void>;
        workId?: string;
        priorWork: string | null;
        generation: number;
        cache: ViewCache;
        command?: {
            text: string;
            revision: number;
        };
    }>();
    const label = (view: ConversationView) => 'label' in view && typeof view.label === 'string' ? view.label : 'Conversation';
    const hostLanguage = hostUiLanguage();
    const localeFor = (id: string) => resolveUiLanguage(controller.getConversationLanguage(id).replyLanguage, hostLanguage).locale;
    const initialView = controller.inspectConversation(options.conversationId);
    if (initialView.deleted || initialView.archived)
        throw Error('Restore an archived conversation or choose a nondeleted conversation before UI entry');
    const presentation = new Map<string, ReturnType<ApplicationSettings['manager']>>();
    const loadPresentation = (view: ConversationView) => {
        const manager = applicationSettings?.manager(view.projectId ?? undefined);
        if (manager)
            presentation.set(view.conversationId, manager);
        return manager;
    };
    let currentTheme = loadPresentation(initialView)?.getTheme() ?? 'dark';
    initTheme(currentTheme, false);
    const terminal = new ProcessTerminal(), screen = createNativeScreen(terminal);
    // Register before native dialog listeners so all consumers share key identity.
    const removeKeyNormalization = screen.addInputListener(data => ({ data: normalizeHostKeyEvent(data) }));
    const applicationKeybindings = options.models ? new ApplicationKeybindings(controller) : undefined;
    const editors = createNativeEditorFactory(applicationKeybindings?.load(nativeHostDefinitions, commandKey)), views = new Map<string, ViewCache>(), owned = new Map<string, NativeIdentity>();
    const footer = new Text('', 0, 0);
    const notice = new Text('', 0, 0);
    let modelUI: ReturnType<typeof modelCommands> | undefined;
    let localUI: ReturnType<typeof localCommands> | undefined;
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
                }, view.workId);
                issues.push(...assessment.messages.map(message => ({ kind: 'recovery' as const, message })));
            }
            catch {
                issues.push({ kind: 'recovery', message: 'Original work prerequisites need inspection · /change' });
            }
        }
        return issues;
    };
    const isPlainRequest = (text: string): boolean => {
        const trimmed = text.trimStart();
        return !!trimmed.trim() && !trimmed.startsWith('!') && (!trimmed.startsWith('/') || trimmed.startsWith('//'));
    };
    const canOfferRequestSetup = (view: ConversationView, goal = controller.conversationGoal(view.conversationId)): boolean => {
        if (view.role || view.workId || view.state !== 'IDLE') return false;
        return (!goal || ['COMPLETED', 'CANCELLED'].includes(goal.state)) &&
            !controller.inspectConversationInputStatus(view.conversationId);
    };
    const observeTasks = () => {
        const roster = controller.listConversations();
        const changes = new Map<string, ReturnType<Controller['inspectChangeActivity']>>();
        const goals = new Map<string, ReturnType<Controller['conversationGoal']>>();
        const summaries = new Map<string, ReturnType<typeof taskPresentation>>();
        const children = new Map<string, ConversationView[]>(), roles = new Map<string, ConversationView[]>();
        for (const view of roster) {
            if (view.archived || view.deleted) continue;
            if (view.parentId) { const group = children.get(view.parentId) ?? []; group.push(view); children.set(view.parentId, group); }
            if (view.workId && view.role) { const group = roles.get(view.workId) ?? []; group.push(view); roles.set(view.workId, group); }
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
        const summary = (view: ConversationView) => {
            let result = summaries.get(view.conversationId);
            if (!result) {
                const related = new Map([...(children.get(view.conversationId) ?? []), ...(roles.get(view.workId ?? '') ?? [])].map(other => [other.conversationId, other]));
                result = taskPresentation({ view, roster: [...related.values()], changeActivity: change(view.workId), goal: goal(view), locale: localeFor(view.conversationId) });
                summaries.set(view.conversationId, result);
            }
            return result;
        };
        return { roster, change, goal, summary };
    };
    let noticeMessage = guidance(initialView, !!initialView.workId && !!controller.inspectChangeActivity(initialView.workId)).length ? uiText(localeFor(initialView.conversationId), 'pane.firstRun') : '';
    const setNotice = (message: string) => { noticeMessage = message; render(); };
    let selected = options.conversationId, second: string | null = null, closing = false, sequence = 0, terminalStarted = false;
    const menuBorder = new DynamicBorder();
    const modelStatus: Component = {
        invalidate() { },
        render(width) {
            const registration = controller.getNativeHandle(selected);
            const current = registration?.session.model;
            const choice = controller.getConversationModelChoice(selected);
            const text = registration
                ? current ? `Model: ${current.id} · ${current.provider}` : 'Model: unavailable'
                : choice?.kind === 'managed' ? `Model: ${choice.modelId} · ${choice.provider} · thinking ${choice.thinkingLevel}`
                    : choice.kind === 'legacy-external' ? `Model: ${choice.modelId} · ${choice.provider} · ${model?.provider === choice.provider && model.modelId === choice.modelId ? 'external profile' : 'external profile required'}`
                        : model ? `Model: ${model.modelId} · ${model.provider}` : uiText(localeFor(selected), 'model.unselected');
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
    let hostInteraction: object | undefined;
    const interactionTasks = new Set<Promise<unknown>>();
    const interactionWaiting = new Text('', 0, 0);
    const releaseHostInteraction = (owner: object | undefined) => {
        if (owner && hostInteraction === owner) {
            hostInteraction = undefined;
            render();
        }
    };
    const runHostInteraction = <T>(action: () => Promise<T>): Promise<T | undefined> => {
        if (closing || hostInteraction) return Promise.resolve(undefined);
        const owner = {};
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
        for (const cache of views.values()) { cache.preparingSend?.abort(); cache.startingResponse?.abort(); }
        controller.quiesceInteractionHost();
        hostDialogCancel?.();
        interactionWaiting.setText(uiText(localeFor(selected), 'interaction.closing'));
        screen.setLayoutRoot(interactionWaiting);
        screen.setFocus(interactionWaiting);
        screen.requestRender();
        done();
    };
    const onAbort = () => requestClose(true);
    const report = (cache: ViewCache, error: unknown, draftFailure = false) => {
        const failure = failurePresentation(error);
        cache.error = failure.summary;
        cache.failure = failure;
        if (draftFailure)
            cache.draftError = failure.summary;
        render();
    };
    const saveScroll = (cache: ViewCache) => controller.setScroll({ conversationId: cache.pane.conversationId, ...cache.pane.scrollAnchor(paneWidth()) });
    const visibleSecond = () => terminal.columns >= 100 && second !== selected ? second : null;
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
                autocomplete: manager.getAutocompleteMaxVisible(), scrollbar: manager.getFullscreenScrollbar() }, () => paneWidth());
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
            cache.revision = receipt.revision;
            cache.error = null;
            cache.draftError = null;
        }
        catch (error) {
            report(cache, error, true);
        }
    };
    const bind = (cache: ViewCache, registration: NativeRegistration) => {
        if (cache.registration?.session === registration.session)
            return;
        cache.dialogs.dispose();
        cache.dialogs = new NativeDialogs(screen, editors.bindings, () => {
            if (cache.registration && controller.getNativeHandle(cache.pane.conversationId)?.session === cache.registration.session)
                controller.updateNativeDialogs({ identity: cache.registration.identity, requestIds: cache.dialogs.requestIds });
            render();
        });
        cache.registration = registration;
        cache.generation = registration.identity.generation;
        owned.set(registration.identity.runId, structuredClone(registration.identity));
        cache.pane.attach(registration.session, registration.sessionManager);
        const base = registration.session.extensionRunner.getUIContext();
        const ui = cache.dialogs.context(base, cache.pane.editor, message => { cache.error = message; render(); }, handler => screen.addInputListener(data => !closing && !hostDialog && !hostInteraction && selected === cache.pane.conversationId ? handler(data) : undefined));
        // Public synchronous native UI binding at ready; do not rerun session_start
        // or replace installed request/checkpoint/finishTurn hooks during streaming.
        registration.session.extensionRunner.setUIContext(ui, 'tui');
    };
    const cacheFor = (view: ConversationView, observations = observeTasks()): ViewCache => {
        let cache = views.get(view.conversationId);
        if (!cache) {
            const pane = new NativePane(view.conversationId, screen, editors);
            applyPanePresentation(pane, view);
            cache = { pane, dialogs: new NativeDialogs(screen, editors.bindings, () => render()), revision: view.draft.revision, localRevision: view.draft.revision, generation: view.generation, registration: null, applying: true, error: null, draftError: null, failure: null, humanSequence: view.humanLastUsed, idleSince: null, manualPending: false, manualStatus: null };
            sequence = Math.max(sequence, view.humanLastUsed);
            views.set(view.conversationId, cache);
            pane.editor.setText(view.draft.text);
            pane.editor.setAutocompleteProvider(projectAutocomplete({ controller, conversationId: view.conversationId, slash: slash.autocomplete,
                isCurrent: () => !closing && !hostDialog && !hostInteraction && !switchPending && selected === pane.conversationId && views.get(pane.conversationId) === cache,
                revision: () => cache!.localRevision, notice: message => { cache!.error = message; render(); } }));
            cache.applying = false;
            pane.editor.disableSubmit = true;
            const captured = cache;
            pane.editor.onChange = () => {
                if (captured.applying)
                    return;
                captured.localRevision++;
                const hadNotice = !!noticeMessage;
                noticeMessage = '';
                persist(captured);
                if (hadNotice || captured.setupDraft !== isPlainRequest(captured.pane.editor.getExpandedText()))
                    render();
            };
            pane.editor.onEscape = () => {
                if (captured.preparingSend) {
                    captured.preparingSend.abort();
                    render();
                    return;
                }
                if (captured.startingResponse || ['QUEUED', 'RUNNING'].includes(controller.inspectConversation(pane.conversationId).state)) {
                    captured.startingResponse?.abort();
                    captured.cancellingResponse = true;
                    render();
                    void controller.interruptConversation({ conversationId: pane.conversationId, expectedGeneration: captured.generation }).catch(error => report(captured, error)).finally(() => { captured.cancellingResponse = false; render(); });
                }
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
        cache.generation = view.generation;
        const task = observations.summary(view), goal = observations.goal(view);
        const managed = managedTasks.get(view.conversationId), preparingTask = !!managed && !managed.workId;
        const notices = controller.inspectNotifications(view.conversationId).filter(notice => notice.state !== 'ACKNOWLEDGED');
        const roster = observations.roster;
        const related = !!view.parentId || roster.some(other => !other.archived && !other.deleted && other.parentId === view.conversationId);
        const simpleEntry = !related && !view.workId && !goal && !view.historyRef && !view.role && !roster.some(other => other.conversationId !== view.conversationId && !other.archived && !other.deleted);
        const progress = cache.manualPending ? undefined : controller.inspectConversationProgress(view.conversationId);
        const startup = progress && !cache.pane.activity.hasNativeActivity ? preparationLabel(localeFor(view.conversationId), progress.stage) : undefined;
        const header = `${uiText(localeFor(view.conversationId), view.conversationId === selected ? 'pane.input' : 'pane.view')} · ${startup ?? task.resourceLabel}${simpleEntry ? '' : ' · #' + view.conversationId.slice(0, 8)}${view.inputNeeded ? ' · ' + uiText(localeFor(view.conversationId), 'pane.inputNeeded') : ''}${cache.dialogs.requestIds.length ? ' · ' + uiText(localeFor(view.conversationId), 'pane.dialogPending') : ''}${notices.length ? ' · ' + uiText(localeFor(view.conversationId), 'pane.notifications', { count: notices.length }) : ''} · ${label(view)} · ${view.projectId ?? uiText(localeFor(view.conversationId), 'pane.noProject')}`;
        const attention = task.attention || cache.dialogs.requestIds.length > 0;
        const heading = chrome(attention ? 'attention' : view.conversationId === selected ? 'active' : 'secondary', truncateToWidth(header.replace(/[\r\n]/g, ' '), paneWidth(), '…'));
        const relations = related ? conversationRelations(roster, view.conversationId, paneWidth(), id => {
            const other = roster.find(entry => entry.conversationId === id);
            return other ? observations.summary(other).resourceLabel : '';
        }).map(text => chrome('context', text)) : [];
        cache.entryIssues = guidance(view, !!managed || !!observations.change(view.workId));
        cache.setupDraft = isPlainRequest(cache.pane.editor.getExpandedText());
        for (const issue of cache.entryIssues)
            relations.push(chrome('attention', truncateToWidth(issue.message, paneWidth(), '…')));
        const pendingInputs = controller.inspectConversationInputStatus(view.conversationId, progress?.initialInputId ?? cache.startingInputId);
        // A request the current response is processing is progress, not attention; only retained or unreconciled inputs ask for /inputs.
        const processing = !!cache.submitting || !!cache.dispatching || ['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state);
        const retainedInputs = !!pendingInputs && (pendingInputs.deliveryIssue !== undefined || pendingInputs.reconciliation || !processing);
        const safePreview = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');
        cache.pane.activity.update(view.state, { preparing: (!!cache.submitting || !!cache.dispatching) && !['RUNNING', 'SETTLING'].includes(view.state), stage: progress?.stage, cancelling: !!cache.cancellingResponse || !!cache.startingResponse?.signal.aborted, cancellingSend: !!cache.preparingSend?.signal.aborted, interruptible: !!cache.preparingSend || !!cache.startingResponse || view.state === 'QUEUED', operation: cache.manualPending ? cache.manualStatus : preparingTask ? uiText(localeFor(view.conversationId), 'task.preparing') : null,
            locale: localeFor(view.conversationId), context: preparingTask ? uiText(localeFor(view.conversationId), 'task.preparing') : task.idleStatus ?? null, setupNeeded: cache.entryIssues.some(issue => issue.kind === 'setup'), setupHandoff: cache.setupDraft && canOfferRequestSetup(view, goal), outcome: cache.responseStatus ? responseOutcome(cache.responseStatus, localeFor(view.conversationId)) : null, pending: retainedInputs, inputNeeded: view.inputNeeded || cache.dialogs.requestIds.length > 0, error: !!cache.error });
        if (cache.preparingSend)
            relations.push(chrome('context', uiText(localeFor(view.conversationId), cache.preparingSend.signal.aborted ? 'input.cancelling' : 'input.preparing')));
        if (pendingInputs?.deliveryIssue)
            relations.push(chrome('attention', truncateToWidth(uiText(localeFor(view.conversationId), 'pane.deliveryIssue', {count: pendingInputs.deliveryIssue.count, reason: safePreview(pendingInputs.deliveryIssue.reason).trim() || uiText(localeFor(view.conversationId), 'pane.deliveryIssueReason')}), paneWidth(), '…')));
        else if (retainedInputs)
            relations.push(chrome('attention', truncateToWidth(uiText(localeFor(view.conversationId), 'pane.pending', { count: pendingInputs!.count, preview: safePreview(pendingInputs!.preview) }), paneWidth(), '…')));
        else if (pendingInputs) {
            // Exclude the exact active request, never an unrelated failed reservation.
            const primary = progress?.initialInputId ?? cache.startingInputId;
            const primaryIndex = primary ? pendingInputs.waitingInputIds.indexOf(primary) : -1;
            const queued = pendingInputs.waiting - (pendingInputs.activeInputWaiting ? 1 : 0);
            const next = pendingInputs.waitingPreviews[primaryIndex === 0 ? 1 : 0];
            const nextMode = pendingInputs.waitingModes[primaryIndex === 0 ? 1 : 0];
            const modeLabel = uiText(localeFor(view.conversationId), nextMode === 'steer' ? 'input.mode.steer' : nextMode === 'follow-up' ? 'input.mode.follow-up' : 'input.mode.idle');
            if (queued > 0 && next !== undefined)
                relations.push(chrome('context', truncateToWidth(uiText(localeFor(view.conversationId), 'pane.queuedNext', { count: queued, mode: modeLabel, preview: safePreview(next) }), paneWidth(), '…')));
        }
        const taskLines = preparingTask ? [uiText(localeFor(view.conversationId), 'task.preparing')] : task.lines;
        cache.pane.goalStatus.setText('');
        cache.pane.status.setText([heading, ...(simpleEntry ? [] : [chrome('secondary', compactConversationPath(roster, view.conversationId, paneWidth()))]), ...relations,
            ...taskLines.map(text => chrome(task.attention ? 'attention' : 'context', truncateToWidth(text, paneWidth(), '…'))),
            ...(cache.manualStatus ? [chrome(cache.manualPending ? 'attention' : 'context', cache.manualStatus)] : []),
            ...(cache.error ? [chrome('error', truncateToWidth(cache.error, paneWidth(), '…'))] : [])].join('\n'));
        return cache;
    };
    const refreshHistory = async (view: ConversationView, cache: ViewCache, strict = false) => {
        if (cache.registration)
            return;
        try {
            const history = await controller.getConversationHistory(view.conversationId);
            if (views.get(view.conversationId) === cache && !cache.registration && cache.generation === view.generation) {
                cache.pane.setHistory(history?.sessionManager);
                cache.pane.resolveScroll(view.scroll.entryId, view.scroll.offset, view.scroll.followEnd, paneWidth());
            }
        }
        catch (error) {
            report(cache, error);
            if (strict)
                throw error;
        }
    };
    const render = () => {
        if (closing || !views.has(selected))
            return;
        const observations = observeTasks(), selectedView = controller.inspectConversation(selected), primary = cacheFor(selectedView, observations);
        const trackProgress = managedTasks.size > 0 || observations.roster.some(view => !view.archived && !view.deleted &&
            (['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state) || [selected, visibleSecond()].includes(view.conversationId) && !!observations.change(view.workId)));
        if (trackProgress && !managedTimer)
            managedTimer = setInterval(() => { if (!closing) { try { updateManaged(); } catch (error) { report(views.get(selected)!, error); } } }, 1000);
        else if (!trackProgress && managedTimer) {
            clearInterval(managedTimer);
            managedTimer = undefined;
        }
        if (hostDialog instanceof ConversationNavigator)
            hostDialog.updateSummaries(new Map(observations.roster.map(view => [view.conversationId, observations.summary(view).navigatorSummary])));
        primary.pane.setActive(true);
        const primaryComponent = primary.dialogs.component ?? primary.pane.layout;
        let component: Component = primaryComponent;
        const split = visibleSecond();
        if (split) {
            const alternate = cacheFor(controller.inspectConversation(split), observations);
            alternate.pane.setActive(false);
            const alternateComponent = alternate.dialogs.component ?? alternate.pane.layout;
            const panes = leftId === selected ? [primaryComponent, alternateComponent] : [alternateComponent, primaryComponent];
            component = new HStack(panes.map(pane => ({ component: pane, basis: 0, grow: 1, minSize: 1 })));
        }
        const available = observations.roster.filter(view => !view.archived && !view.deleted);
        footer.setText([uiText(localeFor(selected), 'footer.setup'), uiText(localeFor(selected), 'footer.commands', { key: keyLabel }),
            ...(available.some(view => view.conversationId === selectedView.parentId) ? [uiText(localeFor(selected), 'footer.parent')] : []),
            ...(available.some(view => view.parentId === selected) ? [uiText(localeFor(selected), 'footer.child')] : []),
            ...(primary.preparingSend ? [uiText(localeFor(selected), primary.preparingSend.signal.aborted ? 'input.cancelling' : 'footer.cancelSend')] :
                ['QUEUED', 'RUNNING'].includes(selectedView.state) || primary.startingResponse || primary.manualPending ? [uiText(localeFor(selected), 'footer.interrupt')] : []),
            ...((primary.registration || primary.dispatching) && !primary.preparingSend ? [uiText(localeFor(selected), 'footer.liveInput', { submit: submitKeyLabel() })] : []),
            uiText(localeFor(selected), 'footer.leave', { key: keyLabel })].map(text => chrome('key', text)).join(chrome('secondary', ' · ')));
        notice.setText(chrome('attention', truncateToWidth(noticeMessage.replace(/[\x00-\x1f\x7f-\x9f]/g, ' '), Math.max(1, terminal.columns), '…')));
        const commands = hostDialog instanceof CommandMenu ? hostDialog : undefined;
        const modal = hostDialog ?? (hostInteraction ? interactionWaiting : undefined);
        interactionWaiting.setText(uiText(localeFor(selected), 'interaction.waiting'));
        const tail = [...(noticeMessage ? [{ component: notice, basis: 'auto' as const, shrink: 0 }] : []), ...(commands ? [{ component: menuBorder, basis: 'auto' as const, shrink: 0 }, { component: commands, basis: 'auto' as const, shrink: 0 }] : []), ...(modal ? [] : [{ component: footer, basis: 'auto' as const, shrink: 0 }]), { component: modelStatus, basis: 'auto' as const, shrink: 0 }];
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
                const protectedView = otherId === selected || otherId === second || other.submitting || other.manualPending || managedTasks.has(otherId) || !!other.registration || !!other.dialogs.requestIds.length || !!other.error || state === 'SETTLING' || state === 'UNKNOWN' || state === 'RUNNING';
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
                resizeAnchors.delete(otherId);
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
    let renderedColumns = terminal.columns;
    const resizeAnchors = new Map<string, ReturnType<NativePane['scrollAnchor']>>();
    const onResize = () => {
        if (closing)
            return;
        try {
            const oldSplit = renderedColumns >= 100 && second !== selected ? second : null;
            const oldWidth = oldSplit ? Math.max(1, Math.floor(renderedColumns / 2)) : renderedColumns;
            for (const id of [selected, ...(oldSplit ? [oldSplit] : [])]) {
                const cache = views.get(id);
                if (cache)
                    resizeAnchors.set(id, cache.pane.scrollAnchor(oldWidth));
            }
            renderedColumns = terminal.columns;
            render();
            for (const id of [selected, ...(visibleSecond() ? [visibleSecond()!] : [])]) {
                const cache = views.get(id), anchor = resizeAnchors.get(id);
                if (cache && anchor)
                    cache.pane.resolveScroll(anchor.entryId, anchor.offset, anchor.followEnd, paneWidth());
            }
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
                throw new Error(`Draft persistence unavailable: ${previous.draftError}`);
            saveScroll(previous);
        }
        const nextSecond = second === id ? selected : second;
        controller.setConversationView({ selectedId: id, secondId: nextSecond });
        if (!nextSecond || leftId === selected && second !== id)
            leftId = id;
        if (selected !== id)
            noticeMessage = '';
        selected = id;
        second = nextSecond;
        const view = controller.inspectConversation(id), cache = cacheFor(view);
        applyActivePresentation();
        cache.humanSequence = ++sequence;
        if (view.parentId)
            lastChild.set(view.parentId, id);
        return { view, cache };
    };
    const selectConversation = async (id: string) => {
        if (closing)
            return;
        const { view, cache } = activateConversation(id);
        // Set actual editor focus before another key from this input batch can arrive.
        render();
        await refreshHistory(view, cache, true);
        render();
        // Same bounded presentation cache policy also runs on background settlement.
        pruneViews();
    };
    const createAndSelectConversation = (argument = '', target = selected) => newConversationAction({
        controller, isCurrent: id => !closing && selected === id,
        ready: () => { if (closing || hostDialog || switchPending)
            return false; const cache = views.get(target); if (cache) {
            persist(cache);
            if (cache.draftError)
                throw Error('Draft persistence unavailable: ' + cache.draftError);
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
    const reportConversationResult = (cache: ViewCache, result: ConversationTurnResult) => {
        cache.responseStatus = { status: result.status, cleanup: result.cleanup };
        if (result.status === 'unavailable') {
            report(cache, Object.assign(new Error(result.failure ?? 'The response could not be completed.'), {
                workId: result.workId,
                runId: result.runId,
                recovery: 'Your sent request and attempts are retained. Open /inputs to inspect pending requests and review safe retry or withdrawal. Use /ready to check setup; /work shows original work diagnostics.',
            }));
        }
        render();
    };
    const needsSentInputReview = (cache: ViewCache): boolean => {
        const target = cache.pane.conversationId;
        if (cache.dispatching || controller.getNativeHandle(target) || !controller.inspectConversationInputStatus(target)) return false;
        setNotice(uiText(localeFor(target), 'input.reviewRetained'));
        return true;
    };
    const prepareSend = (cache: ViewCache) => {
        const abort = new AbortController();
        cache.preparingSend = abort;
        const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
        return { abort, signal };
    };
    const finishStartingResponse = (cache: ViewCache, abort: AbortController) => {
        cache.dispatching = (cache.dispatching ?? 1) - 1;
        if (cache.startingResponse === abort) cache.startingResponse = undefined;
        if (!cache.dispatching) cache.startingInputId = undefined;
        render();
    };
    const submit = async (mode: 'idle' | 'steer' | 'follow-up') => {
        if (closing || hostDialog || switchPending)
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
            // Navigation persists the same source draft again. Its receipt revision
            // can advance without an edit; only a newer editor change prevents clearing.
            if (cache.localRevision !== editRevision || cache.pane.editor.getExpandedText() !== text)
                return;
            const receipt = controller.setDraft({ conversationId: target, expectedRevision: cache.revision, text: '' });
            cache.revision = receipt.revision;
            cache.localRevision = Math.max(cache.localRevision, receipt.revision);
            cache.applying = true;
            cache.pane.editor.setText('');
            cache.applying = false;
        };
        if (text.trimStart().startsWith('/') && !text.trimStart().startsWith('//')) {
            try {
                const outcome = await runHostInteraction(() => slash.execute(text, target, { submission: { conversationId: target, text, revision: editRevision }, acknowledgeSubmission: clearSubmittedDraft }));
                if (outcome === 'completed')
                    clearSubmittedDraft();
                else if (outcome === 'cancelled')
                    setNotice(`Command cancelled; draft kept · ${target.slice(0, 8)}`);
            }
            catch (error) {
                report(cache, error);
            }
            render();
            return;
        }
        const commandInput = text.trimStart();
        if (commandInput.startsWith('!')) {
            const excludeFromContext = commandInput.startsWith('!!'), command = commandInput.slice(excludeFromContext ? 2 : 1);
            if (cache.manualPending)
                return;
            cache.submitting = true;
            cache.manualPending = true;
            const preparation = prepareSend(cache);
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
                if (cache.preparingSend === preparation.abort) cache.preparingSend = undefined;
                render();
            }
            return;
        }
        // This is a presentation handoff for a fresh request, never an admission permit.
        // Existing work, goals and retained input keep their own recovery/continuation routes.
        const setupIssues = cache.entryIssues?.filter(issue => issue.kind === 'setup') ?? [];
        if (mode === 'idle' && canOfferRequestSetup(controller.inspectConversation(target)) && setupIssues.length) {
            const choiceRevision = controller.getConversationModelChoice(target).revision;
            const language = controller.getConversationLanguage(target), locale = localeFor(target);
            const projectId = controller.inspectConversation(target).projectId;
            const currentSource = () => {
                if (closing || switchPending || selected !== target || views.get(target) !== cache) return false;
                const current = controller.inspectConversation(target);
                return current.generation === generation && current.projectId === projectId &&
                    current.draft.revision === revision && current.draft.text === text && canOfferRequestSetup(current) &&
                    controller.getConversationModelChoice(target).revision === choiceRevision &&
                    controller.getConversationLanguage(target).revision === language.revision &&
                    cache.localRevision === editRevision && cache.pane.editor.getExpandedText() === text;
            };
            await runHostInteraction(async () => { try {
                if (!currentSource()) return;
                const action = await chooseHost(uiText(locale, 'requestSetup.title') + '\n' + setupIssues.map(issue => issue.message).join('\n'), [
                    { value: 'request', label: uiText(locale, 'requestSetup.back') },
                    { value: 'setup', label: uiText(locale, 'requestSetup.open') },
                ]);
                if (!currentSource()) return;
                const outcome = action === 'setup' ? await slash.execute('/ready', target) : 'cancelled';
                // Setup owns its own source guards and may change the model/project.
                // It never receives a submission acknowledgement for this plain draft.
                if (outcome !== 'started' && !closing && selected === target && views.get(target) === cache &&
                    canOfferRequestSetup(controller.inspectConversation(target)) && cache.pane.editor.getExpandedText() === text)
                    setNotice(uiText(localeFor(target), 'requestSetup.kept'));
            } catch (error) { report(cache, error); } });
            render();
            return;
        }
        if (needsSentInputReview(cache)) return;
        cache.submitting = true;
        const preparation = prepareSend(cache);
        render();
        try {
            if (controller.inspectConversation(target).projectId && !controller.options.runtimeProfile)
                throw Object.assign(new Error('Project runtime is not configured. Your request is kept in the editor.'), { recovery: 'Open /ready to configure and apply the runtime, then send this request again.' });
            const selectedModel = await resolveTargetRequest(target);
            preparation.signal.throwIfAborted();
            if (needsSentInputReview(cache)) return;
            const received = await controller.queueConversationInputWithContext({ conversationId: target, expectedGeneration: generation, text, draftRevision: revision, mode }, preparation.signal);
            cache.error = null;
            cache.responseStatus = undefined;
            // A late acknowledgement cannot clear a newer editor/draft, even hidden.
            if (cache.revision === revision && cache.pane.editor.getExpandedText() === text) {
                const receipt = controller.setDraft({ conversationId: target, expectedRevision: revision, text: '' });
                cache.revision = receipt.revision;
                cache.localRevision = Math.max(cache.localRevision, receipt.revision);
                cache.applying = true;
                cache.pane.editor.setText('');
                cache.applying = false;
                cache.pane.editor.addToHistory(text);
            }
            if (cache.preparingSend === preparation.abort) cache.preparingSend = undefined;
            if (preparation.signal.aborted) {
                setNotice(uiText(localeFor(target), 'input.receivedCancelled'));
                return;
            }
            if (!cache.dispatching && !controller.getNativeHandle(target)) {
                const pending = controller.inspectConversationInputStatus(target);
                // Context capture and native routing can outlive the earlier response.
                // Never let a fresh send implicitly replay another retained original.
                if (!pending) return;
                if (pending.count !== 1 || pending.firstQueuedInputId !== received.inputId) {
                    setNotice(uiText(localeFor(target), 'input.receivedReview'));
                    return;
                }
                cache.startingResponse = preparation.abort;
                cache.startingInputId = received.inputId;
                cache.dispatching = (cache.dispatching ?? 0) + 1;
                void controller.runConversation({ conversationId: target, initialInputId: received.inputId, ...selectedModel, signal: preparation.signal }).then(result => reportConversationResult(cache, result)).catch(error => { if (preparation.signal.aborted) setNotice(uiText(localeFor(target), 'input.receivedCancelled')); else report(cache, error); }).finally(() => finishStartingResponse(cache, preparation.abort));
            }
        }
        catch (error) {
            if (preparation.signal.aborted) setNotice(uiText(localeFor(target), 'input.cancelled'));
            else report(cache, error);
        }
        finally {
            cache.submitting = false;
            if (cache.preparingSend === preparation.abort) cache.preparingSend = undefined;
            render();
        }
    };
    const submitAndTrack = (mode: 'idle' | 'steer' | 'follow-up') => {
        const cache = views.get(selected), task = submit(mode);
        interactionTasks.add(task);
        void task.then(() => interactionTasks.delete(task), error => { interactionTasks.delete(task); if (cache) report(cache, error); });
    };
    const switchDialog = async (mode: 'select' | 'split' | 'children' = 'select'): Promise<'completed' | 'cancelled'> => {
        if (hostDialog || switchPending || closing)
            return 'cancelled';
        const target = selected;
        const candidates = controller.listConversations().filter(view => !view.archived && !view.deleted);
        const childIds = new Set(candidates.filter(view => view.parentId === target).map(view => view.conversationId));
        if (mode === 'children' && !childIds.size) {
            setNotice(`This conversation has no accessible children. ${keyLabel} c opens all conversations.`);
            return 'cancelled';
        }
        const related = new Set(childIds);
        let ancestor: string | null = target;
        while (ancestor && !related.has(ancestor)) {
            related.add(ancestor);
            ancestor = candidates.find(view => view.conversationId === ancestor)?.parentId ?? null;
        }
        const roster = mode === 'children' ? candidates.filter(view => related.has(view.conversationId)) : candidates;
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
                        const accessible = controller.listConversations().filter(view => !view.archived && !view.deleted);
                        if (selected !== target || !accessible.some(view => view.conversationId === target) ||
                            !accessible.some(view => view.conversationId === id && (mode !== 'children' || view.parentId === target)))
                            throw new Error('Conversation selection changed or is no longer accessible; reopen /resume');
                        if (mode === 'split') {
                            if (id === target) {
                                setNotice('Choose a different conversation to split');
                                resolve('cancelled');
                                return;
                            }
                            controller.setConversationView({ selectedId: target, secondId: id });
                            selected = target;
                            second = id;
                            leftId = target;
                            await refreshHistory(controller.inspectConversation(id), cacheFor(controller.inspectConversation(id)), true);
                            if (!visibleSecond())
                                setNotice(`Split saved · side by side needs 100 columns · ${keyLabel} w switches panes`);
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
                const component = new ConversationNavigator(roster, target, Math.max(1, terminal.rows - 9), id => { void complete(id); }, () => { void complete(); }, mode === 'split' ? 'Conversations · choose the second pane' : mode === 'children' ? 'Conversations · children and ancestors' : 'Conversations', mode === 'children' ? [...childIds][0]! : target, mode === 'children' ? 'Ancestors give context. Enter opens an accessible direct child.' : undefined);
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
                    setNotice(`No accessible parent. ${keyLabel} c opens all conversations.`);
                    render();
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
        const cache = views.get(selected);
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
                await controller.restoreConversation({ conversationId: cid, expectedGeneration: v.generation });
                if (selected === captured.conversationId && !closing)
                    await selectConversation(cid);
                setNotice('Restored ' + cid);
                return;
            }
            if (value === 'Delete conversation permanently' && !await confirmDelete(captured.conversationId))
                return;
            const input = { conversationId: captured.conversationId, expectedGeneration: captured.generation };
            const receipt = value === 'Reclaim completed resource' ? await controller.reclaimConversationResource(input) : value === 'Archive conversation' ? await controller.archiveConversation(input) : await controller.deleteConversation(input);
            if (value !== 'Reclaim completed resource') {
                const fallback = controller.listConversations().find(v => !v.archived && v.conversationId !== captured.conversationId) ?? await newConversation();
                if (selected === captured.conversationId && !closing)
                    await selectConversation(fallback.conversationId);
                const old = views.get(captured.conversationId);
                if (old) {
                    old.dialogs.dispose();
                    old.pane.dispose();
                    views.delete(captured.conversationId);
                    presentation.delete(captured.conversationId);
                }
                if (second === captured.conversationId)
                    second = null;
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
        switchPending = true;
        try {
            const { ExtensionSelectorComponent } = await import('@earendil-works/pi-coding-agent');
            if (closing)
                return;
            const target = selected, notices = controller.inspectNotifications(target).filter(notice => notice.state !== 'ACKNOWLEDGED');
            if (!notices.length) {
                setNotice('No pending result notifications.');
                render();
                return;
            }
            const labels = notices.map(notice => `${notice.id} · ${notice.kind ?? 'result-ready'}${notice.resultId ? ' · result ' + notice.resultId : ''} · conversation ${notice.conversationId}`);
            const complete = (value: string | undefined) => {
                hostDialog = undefined;
                hostDialogCancel = undefined;
                component.dispose();
                render();
                if (value) {
                    const notice = notices[labels.indexOf(value)]!;
                    try {
                        if (notice.resultId) {
                            const observation = controller.inspectConversationResult(notice.resultId);
                            setNotice(JSON.stringify(observation));
                        }
                        controller.acknowledgeNotification({ conversationId: target, notificationId: notice.id });
                        void selectConversation(notice.conversationId).catch(error => report(views.get(selected)!, error));
                    }
                    catch (error) {
                        report(views.get(selected)!, error);
                    }
                }
                else
                    render();
            };
            const component = new ExtensionSelectorComponent('Coordination notices — select exact event/result to acknowledge and open conversation', labels, value => complete(value), () => complete(undefined), { tui: screen });
            hostDialog = component;
            hostDialogCancel = () => complete(undefined);
            render();
        }
        finally {
            switchPending = false;
        }
    };
    const manualHistory = async (kind: 'tree' | 'compact'): Promise<'completed' | 'cancelled'> => {
        if (hostDialog || switchPending || closing)
            return 'cancelled';
        const target = selected, cache = views.get(target)!, interaction = hostInteraction;
        if (cache.manualPending)
            return 'cancelled';
        persist(cache);
        if (cache.draftError)
            return 'cancelled';
        const generation = cache.generation, revision = cache.revision, text = cache.pane.editor.getExpandedText();
        if (kind === 'compact') {
            cache.manualPending = true;
            cache.manualStatus = 'Summary in progress…';
            // Native execution exposes its existing progress and interrupt controls.
            releaseHostInteraction(interaction);
            render();
            try {
                const result = await controller.compactConversation({ conversationId: target, expectedGeneration: generation, ...await resolveTargetRequest(target), ...(options.signal ? { signal: options.signal } : {}) });
                cache.manualStatus = summaryOutcome(result);
                await refreshHistory(controller.inspectConversation(target), cache);
                return result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? 'completed' : 'cancelled';
            }
            catch (error) {
                cache.manualStatus = `Summary failed: ${String(error)}`;
                report(cache, error);
                throw error;
            }
            finally {
                cache.manualPending = false;
                render();
                pruneViews();
            }
        }
        switchPending = true;
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
                cache.manualPending = true;
                cache.manualStatus = 'Opening history branch';
                releaseHostInteraction(interaction);
                render();
                void (async () => {
                    const result = await controller.navigateConversationTree({ conversationId: target, expectedGeneration: generation, ...await resolveTargetRequest(target), entryId, ...(options.signal ? { signal: options.signal } : {}) });
                    const native = result.nativeResult;
                    if (native && typeof native === 'object' && 'editorText' in native && typeof native.editorText === 'string' && views.get(target) === cache && cache.revision === revision && cache.pane.editor.getExpandedText() === text && !text) {
                        const receipt = controller.setDraft({ conversationId: target, expectedRevision: revision, text: native.editorText });
                        cache.revision = receipt.revision;
                        cache.applying = true;
                        cache.pane.editor.setText(native.editorText);
                        cache.applying = false;
                    }
                    await refreshHistory(controller.inspectConversation(target), cache);
                    cache.manualStatus = result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? 'History branch opened · files unchanged' : `History navigation · ${responseOutcome(result)}`;
                    render();
                    finish(result.status === 'delivered' && hasCleanCleanup(result.cleanup) ? 'completed' : 'cancelled');
                })().catch(error => { cache.manualStatus = 'History navigation failed'; report(cache, error); fail(error); })
                    .finally(() => { cache.manualPending = false; render(); });
            };
            hostDialog = new TreeSelectorComponent(history.sessionManager.getTree(), history.sessionManager.getLeafId(), terminal.rows, entryId => complete(entryId), () => complete());
            hostDialogCancel = () => complete();
            render();
            return await outcome;
        }
        finally {
            switchPending = false;
        }
    };
    const chooseHost = async (title: string, labels: readonly (string | UiChoice)[]): Promise<string | undefined> => {
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
            const component = new HostPicker(title, labels, value => complete(value), () => complete(), () => terminal.rows - 8, localeFor(dialogTarget));
            hostDialog = component;
            hostDialogCancel = () => complete();
            render();
        });
    };
    const runPreparation = async <T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T> => {
        if (hostDialog || closing || switchPending)
            throw Error('Finish the current dialog before preparation');
        const abort = new AbortController();
        const component = new PreparationProgress(title, () => abort.abort(), () => screen.requestRender(), presentation);
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
        const words = argument.split(/\s+/u).filter(Boolean);
        if (words.length > (operation === 'login' ? 2 : 1))
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
                    let settled = false;
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
                        render();
                        resolve(closing ? undefined : entryId);
                    };
                    const component = new TreeSelectorComponent(history.sessionManager.getTree(), history.sessionManager.getLeafId(), terminal.rows, entryId => complete(entryId), () => complete());
                    hostDialog = component;
                    hostDialogCancel = () => complete();
                    setNotice('Fork · choose a context point · Enter creates a conversation · Escape cancels');
                    render();
                }),
            }, kind, target);
        }
        finally {
            switchPending = false;
        }
    };
    const showInspection = async (title: string, text: string): Promise<void> => {
        if (hostDialog || closing || switchPending)
            throw Error('Finish the current dialog before opening details');
        await new Promise<void>(resolve => {
            const complete = () => { component.dispose(); hostDialog = undefined; hostDialogCancel = undefined; render(); resolve(); };
            const component = new InspectionDetails(title, text, complete, localeFor(selected));
            hostDialog = component;
            hostDialogCancel = complete;
            render();
        });
    };
    const executeHostCommand: HostCommandExecutor = async (command, target, context) => {
        const outcome = await slash.execute(command, target, context);
        return outcome === 'not-command' ? 'cancelled' : outcome;
    };
    const showFailureDetails = async (detail: string): Promise<void> => {
        await new Promise<void>(resolve => {
            const complete = () => { component.dispose(); hostDialog = undefined; hostDialogCancel = undefined; render(); resolve(); };
            const component = new FailureDetails(detail, complete);
            hostDialog = component;
            hostDialogCancel = complete;
            render();
        });
    };
    const updateManaged = () => {
        for (const [cid, entry] of managedTasks) {
            const current = controller.inspectConversation(cid);
            if (!entry.workId && current.workId && (current.workId !== entry.priorWork || current.generation !== entry.generation))
                entry.workId = current.workId;
            if (entry.workId) {
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
                        report(entry.cache, error, true);
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
        const entry = { task: undefined as unknown as Promise<void>, ...(workId ? { workId } : {}), priorWork: view.workId, generation: view.generation, cache,
            ...(submission?.conversationId === target && submission.text === text && submission.revision === cache.localRevision ? { command: { text: submission.text, revision: submission.revision } } : {}) };
        // Attach both outcomes to this exact owned task before any UI yield.
        entry.task = task.then(result => {
            entry.workId = result.workId;
            updateManaged();
            if (!closing && selected === target && controller.inspectConversation(target).workId === result.workId)
                setNotice(result.reviewReady ? uiText(localeFor(target), 'task.change.reviewRecorded') : `Stopped · ${result.phase} · ${result.nextAction}`);
        }, error => {
            if (error && typeof error === 'object' && typeof error.workId === 'string')
                entry.workId = error.workId;
            updateManaged();
            const failure = failurePresentation(error);
            cache.error = failure.summary;
            cache.failure = failure;
        }).catch(error => { const failure = failurePresentation(error); cache.error = failure.summary; cache.failure = failure; }).finally(() => {
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
    modelUI = modelCommands({ controller, hostLanguage, chooseItems: chooseHost, ...applicationAccounts ? { accounts: applicationAccounts } : {}, ...options.models ? { models: options.models } : {}, choose: chooseHost, show: showInspection, notice: setNotice, isCurrent: target => !closing && selected === target });
    localUI = localCommands({ controller, execute: executeHostCommand, choose: chooseHost, input: inputHost, show: showInspection, notice: setNotice, isCurrent: target => !closing && selected === target });
    repositoryUI = repositoryCommands({ controller, execute: executeHostCommand, ...model ? { model } : {}, choose: chooseHost, input: inputHost, show: showInspection, notice: setNotice, isCurrent: target => !closing && selected === target });
    const slash: HostCommands = new HostCommands([
        ...modelUI.commands,
        ...(options.onReset ? resetCommands({ controller, locale: localeFor, isCurrent: target => !closing && selected === target,
            choose: chooseHost, chooseItems: chooseHost, show: showInspection,
            request: (scope, locale, disposition) => { requestClose(); if (!closing)
                return false; options.onReset!(scope, locale, disposition); return true; },
        }) : []),
        ...languageCommands({ controller, hostLanguage, input: inputHost, notice: setNotice, isCurrent: target => !closing && selected === target }),
        ...localUI.commands,
        ...repositoryUI.commands,
        ...inputCommands({
            controller, choose: chooseHost, show: showInspection, notice: setNotice,
            inspectWork: (target, workId, context) => executeHostCommand('/work ' + workId, target, context),
            isCurrent: target => !closing && selected === target,
            retry: async (target, inputId, fingerprint) => {
                const cache = views.get(target)!;
                cache.submitting = true;
                const preparation = prepareSend(cache);
                // Review is finished; allow drafting while this original prepares.
                releaseHostInteraction(hostInteraction);
                render();
                try {
                    const selectedModel = await resolveTargetRequest(target);
                    preparation.signal.throwIfAborted();
                    if (controller.inspectConversation(target).projectId && !controller.options.runtimeProfile)
                        throw Error('Configure the project runtime through /ready before retrying. The sent request is retained.');
                    controller.recoverConversationInput({ conversationId: target, inputId, expectedContext: fingerprint, action: 'retry' });
                    cache.preparingSend = undefined;
                    cache.startingResponse = preparation.abort;
                    cache.startingInputId = inputId;
                    cache.dispatching = (cache.dispatching ?? 0) + 1;
                    void controller.runConversation({
                        conversationId: target, initialInputId: inputId, ...selectedModel, signal: preparation.signal,
                    }).then(result => reportConversationResult(cache, result)).catch(error => { if (preparation.signal.aborted) setNotice(uiText(localeFor(target), 'input.receivedCancelled')); else report(cache, error); }).finally(() => finishStartingResponse(cache, preparation.abort));
                } catch (error) {
                    if (!preparation.signal.aborted) throw error;
                    setNotice(uiText(localeFor(target), 'input.retryCancelled'));
                    return false;
                } finally {
                    cache.submitting = false;
                    if (cache.preparingSend === preparation.abort) cache.preparingSend = undefined;
                    render();
                }
            },
        }),
        ...workCommands({ controller, locale: localeFor, execute: executeHostCommand, choose: chooseHost, input: inputHost, show: showInspection, notice: setNotice, activate: selectConversation, isCurrent: target => !closing && selected === target }),
        ...changeCommands({ controller, execute: executeHostCommand, locale: localeFor, choose: chooseHost, show: showInspection, isCurrent: target => !closing && selected === target,
            controls: { ...(options.models ? { models: options.models } : {}), ...(model ? { model } : {}), input: inputHost, draft: target => views.get(target)?.pane.editor.getExpandedText() ?? controller.inspectConversation(target).draft.text, notice: setNotice, activateSource: selectConversation, launch: launchManaged } }),
        ...readinessCommands({ controller, restartArguments: options.restartArguments, hostLanguage, chooseItems: chooseHost, ...(model ? { externalModel: { provider: model.provider, modelId: model.modelId } } : {}), ...(applicationAccounts ? { accounts: applicationAccounts } : {}), ...(options.models ? { models: options.models } : {}),
            isCurrent: target => !closing && selected === target, choose: chooseHost, show: showInspection, execute: (command, target, context) => slash.execute(command, target, context) }),
        ...errorCommands({ controller, isCurrent: target => !closing && selected === target,
            assertAvailable: () => { if (hostDialog || closing || switchPending)
                throw Error('Finish the current dialog before opening error details'); },
            failure: target => views.get(target)?.failure ?? null, choose: chooseHost, showDetails: showFailureDetails, notice: setNotice, execute: executeHostCommand }),
        ...projectCommands({ controller, initialDirectory: options.initialDirectory, show: showInspection, hostLanguage, chooseItems: chooseHost, choose: chooseHost, input: inputHost, notice: setNotice,
            isCurrent: target => !closing && selected === target, refresh: async target => {
                const cache = views.get(target);
                if (cache?.failure && ['PROJECT_DEPENDENCY_PENDING','PROJECT_CONTINUATION_PENDING'].includes(cache.failure.code ?? '')) { cache.error = null; cache.failure = null; }
                await selectConversation(target);
            } }),
        ...goalCommands({ controller, show: showInspection, locale: localeFor, isCurrent: target => !closing && selected === target, input: inputHost, choose: chooseHost, resolve: resolveTargetRequest, notice: setNotice, work: (target, context) => executeHostCommand('/work', target, context) }),
        ...sessionCommands({ controller, choose: chooseHost, input: inputHost, copy: copyToClipboard, notice: setNotice, fork: forkContext,
            resume: async (id) => {
                if (!id)
                    return switchDialog();
                if (!controller.listConversations().some(view => view.conversationId === id && !view.archived && !view.deleted))
                    throw new Error('Choose an accessible conversation with /resume');
                await selectConversation(id);
                return 'completed';
            } }),
        commandDiscovery({ controller, registry: () => slash, choose: chooseHost, isCurrent: target => !closing && selected === target }),
        ...(applicationSettings && applicationAccounts && options.models ? configurationCommands({ controller, settings: applicationSettings, accounts: applicationAccounts, models: options.models,
            choose: chooseHost, chooseItems: chooseHost, uiLocale: localeFor, show: showInspection, runPreparation,
            operatorClaude: options.operatorClaude, restartArguments: options.restartArguments, execute: (command, target) => executeHostCommand(command, target),
            ...(options.onReset ? { reset: (target: string) => executeHostCommand('/reset', target) } : {}), input: inputHost, isCurrent: target => !closing && selected === target, notice: setNotice, apply: reloadPresentation, assertPresentationChange, commandKey: keyLabel, ...(applicationKeybindings ? { keybindingsFile: applicationKeybindings.file } : {}) }).map(command => ({ ...command, run: (...args: Parameters<HostCommand['run']>) => modelUI!.track(Promise.resolve(command.run(...args))) })) : []),
        { name: 'login', description: 'Sign in to a Pi-managed application account', argumentHint: '[provider [api_key|oauth]]', run: argument => accountCommand('login', argument) },
        { name: 'logout', description: 'Remove a selected application credential', argumentHint: '[provider]', run: argument => accountCommand('logout', argument) },
        { name: 'accounts', description: 'Inspect stored application account status', run: async () => {
                if (!applicationAccounts)
                    throw new Error('Account management requires the Gitjig application entry');
                const accounts = (await applicationAccounts.status()).filter(account => account.stored || account.configured);
                const labels = accounts.map(account => `${account.provider} · stored ${account.stored ?? 'none'} · configured ${account.configured ? 'yes' : 'no'}`);
                if (!await chooseHost('Pi accounts · availability not checked · Claude Code identity is managed separately', labels.length ? labels : ['No application credentials configured']))
                    return 'cancelled';
                setNotice('Account status closed; availability not checked');
                return 'completed';
            } },
        { name: 'new', description: 'Create an independent project or unbound conversation using saved defaults', argumentHint: '[project|root]', run: createAndSelectConversation },
        { name: 'tree', description: 'Browse current conversation history', run: async () => manualHistory('tree') },
        { name: 'compact', description: 'Summarize current conversation', run: async () => manualHistory('compact') },
        { name: 'notifications', description: 'Inspect conversation notices and result notifications', run: async () => notificationDialog() },
        { name: 'reclaim', description: 'Close this conversation’s retained idle client', run: async (_argument, target) => {
                const view = controller.inspectConversation(target);
                await controller.reclaimConversationResource({ conversationId: target, expectedGeneration: view.generation });
                setNotice('Completed client reclaimed');
            } },
        { name: 'quit', description: 'Exit Gitjig (quit)', run: async () => { requestClose(); } },
    ]);
    const unsubscribeGoals = controller.subscribeGoals(() => render());
    const unsubscribe = controller.subscribeInteraction(event => {
        if (event.type === 'native-settling')
            views.get(event.conversationId)?.dialogs.dispose();
        if (closing)
            return;
        try {
            const view = controller.inspectConversation(event.conversationId);
            const cache = cacheFor(view);
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
            throw new Error('Draft persistence unavailable: keep the second pane open and retry.');
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
            case 'p': {
                const parent = controller.inspectConversation(selected).parentId;
                const accessible = controller.listConversations().some(view => view.conversationId === parent && !view.archived && !view.deleted);
                if (parent && accessible)
                    await selectConversation(parent);
                else {
                    setNotice(`No accessible parent. ${keyLabel} c opens all conversations.`);
                    render();
                }
                return;
            }
            case 's': return toggleSplit();
            case 'w':
                if (second) {
                    activateConversation(second);
                    render();
                    pruneViews();
                }
                else {
                    setNotice(`No second pane. ${keyLabel} s opens a split.`);
                    render();
                }
                return;
            case 'j': return slash.execute('/project', selected);
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
        const complete = (command?: ConversationCommand) => {
            hostDialog = undefined;
            hostDialogCancel = undefined;
            if (command) {
                const cache = views.get(selected)!;
                void runHostInteraction(() => runCommand(command)).catch(error => report(cache, error));
            }
            else render();
        };
        hostDialog = new CommandMenu(command => complete(command), () => complete(), commandKey, localeFor(selected));
        hostDialogCancel = () => complete();
        render();
    };
    const removeInput = screen.addInputListener(data => {
        try {
            if (closing)
                return { consume: true };
            const cache = views.get(selected);
            if (!cache)
                return undefined;
            if (hostDialog instanceof CommandMenu) {
                if (!isKeyRelease(data)) {
                    hostDialog.handleInput(data);
                    screen.requestRender();
                }
                return { consume: true };
            }
            if (hostDialog)
                return undefined;
            if (hostInteraction) {
                // These bytes belong to the pending command, never to the hidden editor.
                if (matchesHostKey(data, 'ctrl+d') && !isKeyRelease(data)) requestClose();
                return { consume: true };
            }
            if (cache.dialogs.component)
                return undefined;
            if (switchPending && (([commandKey, 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'shift+up', 'shift+down', 'alt+enter'] as const).some(key => matchesHostKey(data, key)) || getKeybindings().matches(data, 'tui.input.submit')))
                return { consume: true };
            if (matchesKey(data, 'shift+up') || matchesKey(data, 'shift+down')) {
                if (screen.hasOverlay() || screen.getFocusedComponent() !== cache.pane.editor || cache.pane.editor.isShowingAutocomplete())
                    return undefined;
                // Kitty reports releases/repeats separately. Legacy repeat bytes cannot be distinguished.
                if (!isKeyRelease(data) && !isKeyRepeat(data))
                    void navigateHierarchy(matchesKey(data, 'shift+up') ? 'parent' : 'child').catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesHostKey(data, commandKey)) {
                if (!isKeyRelease(data)) commandMenu();
                return { consume: true };
            }
            if (matchesKey(data, 'f2')) {
                void runHostInteraction(() => switchDialog()).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f3')) {
                void runHostInteraction(() => createAndSelectConversation()).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f6')) {
                void runHostInteraction(() => manualHistory('tree')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f7')) {
                void runHostInteraction(() => manualHistory('compact')).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f8')) {
                void runHostInteraction(() => lifecycleDialog()).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f5')) {
                void runHostInteraction(() => notificationDialog()).catch(error => report(cache, error));
                return { consume: true };
            }
            if (matchesKey(data, 'f4')) {
                void runHostInteraction(() => toggleSplit()).catch(error => report(cache, error));
                return { consume: true };
            }
            if (getKeybindings().matches(data, 'tui.input.submit')) {
                if (screen.hasOverlay() || screen.getFocusedComponent() !== cache.pane.editor)
                    return undefined;
                if (isKeyRelease(data) || isKeyRepeat(data))
                    return { consume: true };
                if (prepareHostEditorSubmit(cache.pane.editor, data, slash.commands))
                    submitAndTrack(cache.registration || cache.dispatching ? 'steer' : 'idle');
                return { consume: true };
            }
            if (matchesKey(data, 'alt+enter')) {
                submitAndTrack(cache.registration || cache.dispatching ? 'follow-up' : 'idle');
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
        for (const view of controller.listConversations()) {
            const handle = controller.getNativeHandle(view.conversationId);
            if (handle)
                cacheFor(view);
        }
        await selectConversation(selected);
        if (options.entryNotice)
            setNotice(options.entryNotice);
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
                throw new Error(`Draft persistence unavailable: ${cache.error}`);
            saveScroll(cache);
        }
    }
    finally {
        closing = true;
        controller.quiesceInteractionHost();
        hostDialogCancel?.();
        if (managedTimer)
            clearInterval(managedTimer);
        process.stdout.removeListener('resize', onResize);
        if (retentionTimer)
            clearTimeout(retentionTimer);
        options.signal?.removeEventListener('abort', onAbort);
        removeInput();
        removeKeyNormalization();
        try {
            await settleHostCommands([() => applicationAccounts ? ApplicationStartup.open(controller).close() : Promise.resolve(), () => modelUI?.close() ?? Promise.resolve(), () => localUI?.close() ?? Promise.resolve(), () => repositoryUI?.close() ?? Promise.resolve()], () => controller.settleInteractionHost({ identities: [...owned.values()] }));
        }
        finally {
            await Promise.allSettled([...interactionTasks]);
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

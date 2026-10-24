import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
import { managedModelGuidance, managedModelRepairDetail } from './managed-model-guidance.js';
import { ContextAssignmentUnavailable } from '../controller/context-coordination.js';
import type { Controller } from '../controller/controller.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { ApplicationModels } from '../app/models.js';
import { ApplicationStartup } from '../app/startup.js';
import { restartCommand } from './startup-guidance.js';
import type { RuntimeProfile } from '../controller/types.js';
import type { HostCommand, HostCommandOutcome, HostCommandContext } from './host-commands.js';
interface ReadinessHost extends UiChoiceHost {
    controller: Controller;
    hostLanguage?: string;
    restartArguments?: readonly string[] | undefined;
    accounts?: ApplicationAccounts;
    models?: ApplicationModels;
    externalModel?: {
        provider: string;
        modelId: string;
    };
    isCurrent(target: string): boolean;
    show?(title: string, text: string): Promise<void>;
    execute(command: string, target: string, context?: HostCommandContext): Promise<HostCommandOutcome | 'not-command'>;
}
const loginCommand = (provider: string) => /\s/u.test(provider) ? '/login' : `/login ${provider}`;
const runtimeLabel = (runtime: RuntimeProfile | undefined, t: ReturnType<typeof translator>) => runtime ? t('value.configured', { value: runtime.dockerContext + ' · ' + runtime.image }) : t('value.notConfigured');
/** Metadata and explicit existing actions only: opening this surface never starts or resumes work. */
export function readinessCommands(host: ReadinessHost): HostCommand[] {
    return [{
            name: 'ready', description: 'Inspect project, account, model and runtime setup; choose a next action', run: async (_argument, target, context) => {
                let completedAction = false;
                let details: boolean = false;
                const systemLanguage = host.hostLanguage ?? hostUiLanguage();
                while (host.isCurrent(target)) {
                    const view = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
                    const language = host.controller.getConversationLanguage(target);
                    const interfaceLanguage = resolveUiLanguage(language.replyLanguage, systemLanguage), t = translator(interfaceLanguage.locale);
                    const externalRoute = choice.kind === 'legacy-external' || choice.kind === 'unbound' && !!host.externalModel;
                    const externalAvailable = !!host.externalModel && (choice.kind === 'unbound' || choice.kind === 'legacy-external' && choice.provider === host.externalModel.provider && choice.modelId === host.externalModel.modelId);
                    const assertCurrent = () => {
                        const now = host.controller.inspectConversation(target);
                        if (!host.isCurrent(target) || now.generation !== view.generation || now.projectId !== view.projectId || host.controller.getConversationLanguage(target).revision !== language.revision || now.deleted || now.archived ||
                            host.controller.getConversationModelChoice(target).revision !== choice.revision)
                            throw Error('Readiness target changed; return to the intended conversation and reopen /ready');
                    };
                    assertCurrent();
                    const [startup, accounts, catalogue] = await Promise.allSettled([
                        ApplicationStartup.open(host.controller).inspect(), host.accounts?.status() ?? Promise.resolve([]), host.models?.list() ?? Promise.resolve(undefined),
                    ]);
                    assertCurrent();
                    const startupView = startup.status === 'fulfilled' ? startup.value : undefined;
                    const modelList = catalogue.status === 'fulfilled' ? catalogue.value : undefined;
                    const configured = accounts.status === 'fulfilled' ? accounts.value.filter(account => account.stored || account.configured) : undefined;
                    const accountLabel = externalRoute || !host.accounts ? 'explicit external profile · use its declared account route' : choice.kind === 'managed' && choice.provider === 'claude-bridge' ? 'external Claude Code · account not verified' :
                        configured ? configured.length ? configured.map(account => `${account.provider}: ${account.stored ?? 'configured literal'}`).join(', ') + ' · ' + t('value.unchecked') : t('value.noneAccounts') : 'status unavailable';
                    const currentModel = choice.kind === 'unbound' ? host.externalModel ? `${host.externalModel.provider}/${host.externalModel.modelId} · explicit external invocation` : t('value.unselected') + ' · ' + choice.reason : `${choice.provider}/${choice.modelId} · ${choice.kind}`;
                    const future = modelList?.default;
                    const goal = host.controller.conversationGoal(target);
                    const unfinishedGoal = goal && !['COMPLETED', 'CANCELLED'].includes(goal.state);
                    const pendingInputs = host.controller.inspectConversationInputs(target);
                    const goalOwnsContinuation = unfinishedGoal && (pendingInputs.length > 0 || goal.state !== 'READY');
                    let original: string | null = null;
                    let heldSourceWork: string | undefined;
                    if (!goalOwnsContinuation) {
                        if (view.role) {
                            if (view.workId && host.controller.inspectChangeActivity(view.workId))
                                original = view.workId;
                        }
                        else {
                            try {
                                original = host.controller.conversationChange(target).workId;
                            }
                            catch (error) {
                                if (!(error instanceof ContextAssignmentUnavailable) || !error.workId)
                                    throw error;
                                heldSourceWork = error.workId;
                            }
                        }
                    }
                    type Row = {
                        label: string;
                        command?: string | undefined;
                        detail?: string;
                        alternatives?: {
                            label: string;
                            command: string;
                        }[];
                        requestMethods?: true;
                        accountConnection?: true;
                    };
                    const restart = t('ready.restartBody', { command: restartCommand(host.controller.applicationHome(), target, undefined, undefined, ApplicationStartup.open(host.controller).continuationArguments(host.restartArguments ?? [])) });
                    const idleOwner = !view.role && ['IDLE', 'WAITING'].includes(view.state);
                    const managedPrerequisites = original && idleOwner ? managedModelGuidance(host, original) : undefined;
                    const originalAssessment = managedPrerequisites ? JSON.stringify(managedPrerequisites) : undefined;
                    const originalEpoch = original ? host.controller.inspectWork(original).epoch : undefined;
                    const originalRepairs = (): {
                        label: string;
                        command: string;
                    }[] => {
                        if (!original || !managedPrerequisites)
                            return [];
                        const actions = [{ label: 'Inspect original work and recovery holds', command: `/work ${original}` }];
                        if (managedPrerequisites.issues.every(issue => issue.kind === 'external'))
                            return actions;
                        let held = false;
                        try {
                            host.controller.assertApplicationMutationAllowed();
                        }
                        catch {
                            held = true;
                        }
                        if (held) {
                            if (host.controller.inspectWork(original).state !== 'CANCELLED')
                                actions.push({ label: 'Review cancellation of original work and delegated executions', command: `/change cancel ${original}` });
                            return actions;
                        }
                        for (const issue of managedPrerequisites.issues) {
                            if (issue.kind === 'account' && issue.provider && host.accounts)
                                actions.push({ label: `${/\s/u.test(issue.provider) ? 'Choose account login for original provider' : 'Connect original provider'} ${issue.provider}`, command: loginCommand(issue.provider) });
                            if (issue.kind === 'account-config' && host.models)
                                actions.push({ label: 'Review model/account configuration repair', command: '/model-repair' });
                            if (issue.kind === 'bridge' && host.models)
                                actions.push({ label: 'Restore original model bridge', command: '/bridge' });
                            if (issue.kind === 'role-config' && host.models)
                                actions.push({ label: 'Inspect application role-model settings', command: '/role-model' });
                        }
                        return actions.filter((action, index) => actions.findIndex(other => other.command === action.command) === index);
                    };
                    const recommendNextAction = (): Row => {
                        if (heldSourceWork) {
                            return { label: 'Next step · Inspect original work and cleanup before retrying or withdrawing requests', command: `/work ${heldSourceWork}` };
                        }
                        if ((original || goalOwnsContinuation) && idleOwner && (!original || host.controller.inspectChangeActivity(original)?.state !== 'UNKNOWN') && view.projectId && !host.controller.options.runtimeProfile) {
                            if (startupView?.diagnostic || !startupView)
                                return { label: t('ready.setupNext'), command: host.models ? '/setup' : undefined };
                            if (startupView.saved?.runtime)
                                return { label: t('ready.applyRuntime'), command: host.models ? '/setup runtime' : undefined };
                            return { label: t('ready.runtimeNext'), command: host.models ? '/setup runtime' : undefined };
                        }
                        if (original && managedPrerequisites?.issues.length) {
                            if (managedPrerequisites.issues.every(issue => issue.kind === 'bridge') && startupView?.saved?.bridge && startupView.restartRequired)
                                return { label: t('ready.restartBridge'), detail: restart };
                            return {
                                label: 'Next step · Inspect original work model/account prerequisites',
                                detail: managedModelRepairDetail(host.controller, original, managedPrerequisites),
                                alternatives: originalRepairs(),
                            };
                        }
                        if (goalOwnsContinuation)
                            return { label: t('ready.goalNext'), command: '/goal' };
                        else if (original)
                            return { label: t('ready.originalNext'), command: `/work ${original}` };
                        else if (view.role)
                            return { label: 'Next step · Inspect the original task; return to its owner for continuation', ...(view.workId ? { command: `/work ${view.workId}` } : { detail: 'This role view cannot start owner work. Return to the parent conversation with Shift+Up and inspect its /goal or /change.' }) };
                        else if (['QUEUED', 'RUNNING', 'SETTLING'].includes(view.state))
                            return { label: t('ready.waitNext'), detail: 'The original response or cleanup is still active. Close this view to follow progress. Escape in the conversation interrupts the response; reopen /ready after cleanup settles.' };
                        else if (pendingInputs.some(input => input.eligible))
                            return { label: t('ready.inputsNext'), command: '/inputs' };
                        else if (pendingInputs.length)
                            return { label: t('ready.heldNext'), command: '/inputs' };
                        else if (!view.projectId && !unfinishedGoal)
                            return { label: t('ready.projectNext'), command: '/project' };
                        else if (language.diagnostic)
                            return { label: t('ready.languageNext'), command: '/language' };
                        else if (externalRoute && !externalAvailable)
                            return {
                                label: 'Next step · Reopen with the matching external model profile', detail: 'This conversation retains an external model source. Reopen the same application home and conversation with --model-profile pointing to its matching private profile file. Keep the original provider/model and credential route. Inspection does not need that profile and does not rebind this conversation to application defaults. Use /model only if you deliberately want to replace the external model choice.' + '\n\nRun in your terminal after replacing the example profile path with the original private profile:\n' + restartCommand(host.controller.applicationHome(), target, undefined, undefined, ApplicationStartup.open(host.controller).continuationArguments(host.restartArguments ?? [])) + " --model-profile '/absolute/path/to/original-profile.json'"
                            };
                        else if (!externalRoute && host.models && catalogue.status === 'rejected')
                            return { label: t('ready.repairNext'), command: '/model-repair' };
                        else if (!externalRoute && host.accounts && accounts.status === 'rejected')
                            return { label: 'Next step · Repair unavailable account configuration', command: '/model-repair' };
                        else if (choice.kind === 'managed' && choice.provider === 'claude-bridge' && !host.controller.applicationModelResource())
                            return startupView?.saved?.bridge && startupView.restartRequired ? { label: t('ready.restartBridge'), detail: restart } : { label: 'Next step · Restore Claude Code bridge or select another current model', ...(host.models ? { alternatives: [{ label: 'Restore Claude Code bridge', command: '/bridge' }, { label: 'Choose another current model', command: '/model' }] } : {}) };
                        else if (choice.kind === 'managed' && host.models && modelList && !modelList.models.some(model => model.provider === choice.provider && model.id === choice.modelId))
                            return { label: `Next step · Replace unavailable current model ${choice.provider}/${choice.modelId}`, command: '/model' };
                        else if (choice.kind === 'unbound' && !host.externalModel) {
                            if (startupView?.saved?.bridge && !startupView.effective?.bridge && startupView.restartRequired)
                                return { label: t('ready.restartBridge'), detail: restart };
                            else if (future?.provider && future.model && modelList?.models.some(model => model.provider === future.provider && model.id === future.model))
                                return { label: t('ready.defaultNext', { model: future.provider + '/' + future.model }), command: `/model ${future.provider}/${future.model}` };
                            else if (host.accounts && configured?.length === 0 && !startupView?.effective?.bridge && !startupView?.saved?.bridge)
                                return { label: t('ready.loginNext'), ...(host.models ? { accountConnection: true as const } : { command: '/login' }) };
                            else
                                return { label: t('ready.modelNext'), command: host.models ? '/model' : undefined };
                        }
                        else if (choice.kind === 'managed' && choice.provider !== 'claude-bridge' && host.accounts && configured && !configured.some(account => account.provider === choice.provider))
                            return { label: `Next step · ${/\s/u.test(choice.provider) ? 'Choose account login for' : 'Connect the account for'} ${choice.provider}`, command: loginCommand(choice.provider) };
                        else if (unfinishedGoal && !view.projectId)
                            return { label: t('ready.goalNext'), command: '/goal' };
                        else if (startupView?.diagnostic || !startupView)
                            return { label: t('ready.setupNext'), command: host.models ? '/setup' : undefined };
                        else if (!host.controller.options.runtimeProfile && startupView.saved?.runtime)
                            return { label: t('ready.applyRuntime'), command: host.models ? '/setup runtime' : undefined };
                        else if (!host.controller.options.runtimeProfile)
                            return { label: t('ready.runtimeNext'), command: host.models ? '/setup runtime' : undefined };
                        else if (startupView.restartRequired)
                            return { label: t('ready.restart'), detail: restart };
                        else
                            return unfinishedGoal ? { label: t('ready.goalNext'), command: '/goal' } : { label: t('request.next'), requestMethods: true };
                    };
                    const next = recommendNextAction();
                    const catalogueUnavailable = catalogue.status === 'rejected';
                    const accountAction = externalRoute || !host.accounts ? {
                        label: 'external account route', command: undefined,
                    } : accounts.status === 'rejected' ? {
                        label: t('value.repair'), command: '/model-repair',
                    } : choice.kind === 'managed' && choice.provider === 'claude-bridge' ? {
                        label: 'inspect bridge setup', command: '/setup inspect',
                    } : { label: t('value.login'), command: '/login' };
                    const modelAction = externalRoute ? {
                        label: ' · use its declared profile', command: undefined,
                    } : !host.models ? { label: '', command: undefined } : {
                        label: catalogueUnavailable ? ' · repair configuration' : t('value.select'),
                        command: catalogueUnavailable ? '/model-repair' : '/model',
                    };
                    const defaultAction = !host.models ? { label: '', command: undefined } : {
                        label: catalogueUnavailable ? ' · repair configuration' : t('value.select'),
                        command: catalogueUnavailable ? '/model-repair' : '/model-default',
                    };
                    const item = (id: string, row: Row) => ({ id, ...row });
                    const projectRow = item('project', { label: t('ready.project', { project: view.projectId ?? t('value.none') }), command: '/project' });
                    const modelRow = item('model', { label: t('ready.model', { model: currentModel, action: modelAction.label }), command: modelAction.command });
                    const accountRow = item('accounts', { label: t('ready.accounts', { accounts: accountLabel, action: accountAction.label }), command: accountAction.command });
                    const runtimeRow = item('runtime-active', {
                        label: t('ready.runtime', { runtime: runtimeLabel(host.controller.options.runtimeProfile, t), action: host.models ? t('value.inspect') : ' · CLI setup inspect' }), command: host.models ? '/setup inspect' : undefined
                    });
                    const startupRow = item('startup', {
                        label: t('ready.startup', { status: startupView?.diagnostic ?? t(startupView?.restartRequired ? 'value.restart' : 'value.currentProcess'), action: host.models ? t('value.inspect') : ' · CLI setup inspect' }), command: host.models ? '/setup inspect' : undefined
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
                            label: t('ready.savedRuntime', { runtime: startupView?.diagnostic ? t('value.savedRepair') : startupView ? runtimeLabel(startupView.saved?.runtime, t) : 'inspection unavailable', action: host.models ? t('value.edit') : ' · CLI setup' }), command: host.models ? startupView?.diagnostic || !startupView ? '/setup inspect' : '/setup runtime' : undefined
                        }),
                        startupRow,
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
                        ...(!host.models ? [item('external-profile', { label: 'Explicit external profile · manage startup with CLI setup inspect/save/clear; use its declared model source' })] : []),
                        ...(modelList?.routes ?? []).map(route => item('route:' + route.provider, { label: `Model route · ${route.provider} · ${route.status}`, command: host.models ? '/model' : undefined })),
                        ...(!modelList && host.models ? [item('catalogue-repair', { label: 'Model catalogue unavailable · repair model/account configuration', command: '/model-repair' })] : []),
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
                        ...(view.projectId || host.controller.options.runtimeProfile || startupView?.saved?.runtime ? [runtimeRow] : []),
                        ...(!startupView || startupView.diagnostic || startupView.restartRequired ? [startupRow] : []),
                        item('more-settings', { label: t('ready.more') }),
                        item('return-request', { label: t('ready.returnRequest') }),
                    ];
                    const selected: string | undefined = await chooseUiItem(host, t(details ? 'ready.detailsTitle' : 'ready.title'), rows.map(row => ({ value: row.id, label: row.label })));
                    if (!selected) {
                        if (details) { details = false; continue; }
                        return completedAction ? 'completed' : 'cancelled';
                    }
                    assertCurrent();
                    const row: (Row & {id: string}) | undefined = rows.find(row => row.id === selected);
                    if (!row)
                        throw Error('Unknown readiness action; reopen /ready');
                    if (row.id === 'more-settings' || row.id === 'back-current') {
                        details = row.id === 'more-settings';
                        continue;
                    }
                    if (row.id === 'return-request')
                        return completedAction ? 'completed' : 'cancelled';
                    if (row.detail && host.show) {
                        await host.show(row.label, row.detail);
                        assertCurrent();
                        if (!row.alternatives)
                            continue;
                    }
                    let command = row.command;
                    if (row.accountConnection) {
                        const source = await chooseUiItem(host, t('bridge.accountChoice'), [
                            { value: 'native', label: t('bridge.nativeAccount') },
                            { value: 'direct', label: t('bridge.directAccount') },
                            { value: 'back', label: t('request.back') },
                        ]);
                        assertCurrent();
                        if (!source || source === 'back')
                            continue;
                        command = source === 'native' ? '/bridge' : '/login';
                    }
                    if (row.requestMethods) {
                        const currentEntry = () => {
                            assertCurrent();
                            const now = host.controller.inspectConversation(target);
                            const currentGoal = host.controller.conversationGoal(target);
                            if (now.state !== view.state || host.controller.inspectConversationInputs(target).length ||
                                currentGoal && !['COMPLETED', 'CANCELLED'].includes(currentGoal.state) ||
                                host.controller.conversationChange(target).workId)
                                throw Error('Readiness changed; reopen /ready to inspect current requests and work');
                        };
                        while (true) {
                            const method = await chooseUiItem(host, t('request.title'), [
                                { value: 'prompt', label: t('request.prompt') },
                                { value: 'managed', label: t('request.managed') },
                                ...(host.show ? [{ value: 'help', label: t('request.help') }] : []),
                                { value: 'back', label: t('request.back') },
                            ]);
                            currentEntry();
                            if (!method || method === 'back')
                                break;
                            if (method === 'prompt')
                                return 'completed';
                            if (method === 'help' && host.show) {
                                await host.show(t('request.helpTitle'), t('request.helpBody'));
                                currentEntry();
                                continue;
                            }
                            if (method !== 'managed')
                                throw Error('Unknown request method');
                            command = '/change start';
                            break;
                        }
                    }
                    if (row.alternatives) {
                        const selected = await host.choose('Choose a recovery action', [t('request.back'), ...row.alternatives.map(action => action.label)]);
                        assertCurrent();
                        if (!selected || selected === t('request.back'))
                            continue;
                        command = row.alternatives.find(action => action.label === selected)?.command;
                        if (!command)
                            throw Error('Unknown readiness recovery action');
                        if (original && (host.controller.inspectWork(original).epoch !== originalEpoch || JSON.stringify(managedModelGuidance(host, original)) !== originalAssessment || (view.role ? host.controller.inspectConversation(target).workId : host.controller.conversationChange(target).workId) !== original))
                            throw Error('Original work prerequisites changed; reopen /ready');
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

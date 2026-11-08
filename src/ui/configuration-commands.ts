import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, uiText, type UiLocale } from './i18n.js';
import { parseUniqueJson } from '../workflow/json.js';
import { editRuntimeFields } from './runtime-fields.js';
import { editBridgeFields } from './bridge-fields.js';
import { editCombinedStartupFields } from './startup-settings.js';
import { connectBridge } from './bridge-setup.js';
import type { ClaudeOperatorEnvironment } from '../app/bridge-connection.js';
import { restartCommand, startupComponentLabel, startupSaveNotice } from './startup-guidance.js';
import { pickApplicationModel } from './model-picker.js';
import { parseModelReference, type ExternalModelReference } from './model-route-presentation.js';
import { editModelScope, editModelThinking } from './preference-editors.js';
import { getKeybindings } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
import type { ApplicationSettings } from '../app/settings.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { ApplicationModels } from '../app/models.js';
import { applicationModelRoles, type ApplicationModelRole } from '../app/models.js';
import { ApplicationStartup } from '../app/startup.js';
import type { HostCommand, HostCommandContext, HostCommandExecutor, HostCommandOutcome } from './host-commands.js';
interface ConfigurationCommands extends UiChoiceHost {
    controller: Controller;
    operatorClaude?: Readonly<ClaudeOperatorEnvironment> | undefined;
    restartArguments?: readonly string[] | undefined;
    execute?: HostCommandExecutor;
    reset?(target: string): Promise<HostCommandOutcome>;
    uiLocale?(target: string): UiLocale;
    externalModel?: ExternalModelReference;
    settings: ApplicationSettings;
    accounts: ApplicationAccounts;
    models: ApplicationModels;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show?(title: string, text: string, primary?: import('./exact-review.js').ReviewPrimaryAction): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
    isCurrent(target: string): boolean;
    notice(text: string, wrap?: boolean): void;
    apply(): void;
    assertPresentationChange(): void;
    commandKey: string;
    keybindingsFile?: string;
}
const parse = (value: string): unknown => {
    try {
        return JSON.parse(value);
    }
    catch {
        throw new Error('Enter a valid JSON value; the saved preference has not changed');
    }
};
function startupArgument(argument: string) {
    if (!argument)
        return null;
    const match = /^(inspect|runtime|bridge|combined|save|clear)(?:\s+([\s\S]+))?$/u.exec(argument);
    if (match && (match[1] === 'save' || match[1] === 'runtime' && match[2] === 'current' || !match[2]))
        return match;
}
export function configurationCommands(host: ConfigurationCommands): HostCommand[] {
    const { controller, settings, accounts, models } = host;
    const modelDefault: HostCommand = {
        name: 'model-default', descriptionId: 'command.description.model-default', argumentHint: '[provider/model]', acceptsArgument: argument => !!parseModelReference(argument), run: async (argument, target) => {
            const edit = preferenceEdit(target);
            let reference = argument;
            if (!reference) {
                const locale = host.uiLocale?.(target) ?? 'en';
                const choice = controller.getConversationModelChoice(target);
                const catalogue = await accounts.models(), accountStatus = await accounts.status();
                reference = await pickApplicationModel({ ...host, locale }, catalogue, {
                    guard: edit.assertCurrent, title: uiText(locale, 'model.defaultTitle'), choice, accounts: accountStatus,
                }) ?? '';
            }
            edit.assertCurrent();
            if (!reference)
                return 'cancelled';
            const selected = parseModelReference(reference);
            if (!selected)
                throw new Error('Use /model-default provider/model');
            await accounts.setDefault(selected.provider, selected.modelId, edit.assertCurrent);
            host.notice('Default model saved for new conversations; current choices kept' + (['defaultProvider', 'defaultModel'].some(key => edit.view.sources[key] === 'project') ? ' · approved project override remains effective' : ''));
        }
    };
    const sourceGuard = (target: string, changed = 'Startup form source changed; reopen /setup') => {
        const language = controller.getConversationLanguage(target);
        const source = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target);
        return () => {
            const now = controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || controller.getConversationLanguage(target).revision !== language.revision || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== choice.revision)
                throw Error(changed);
        };
    };
    const preferenceEdit = (target: string) => {
        const source = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target), edit = settings.prepareEdit(source.projectId ?? undefined);
        const language = controller.getConversationLanguage(target);
        const assertCurrent = () => {
            const now = controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== choice.revision || controller.getConversationLanguage(target).revision !== language.revision)
                throw Error('Preference target changed; reopen the setting');
            edit.assertCurrent();
        };
        return { ...edit, assertCurrent };
    };
    const scopeEdit = async (target: string, argument?: string) => {
        const edit = preferenceEdit(target);
        let patterns: unknown;
        if (argument)
            patterns = parse(argument);
        else {
            const catalogue = (await accounts.models()).models.map(model => `${model.provider}/${model.id}`);
            edit.assertCurrent();
            patterns = await editModelScope({ ...host, assertCurrent: edit.assertCurrent }, (edit.view.global.enabledModels ?? []) as string[], catalogue, edit.view.sources.enabledModels === 'project');
        }
        if (patterns === undefined)
            return 'cancelled' as const;
        if (!Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === 'string'))
            throw Error('Model scope requires an array of Pi model patterns');
        const guard = () => {
            edit.assertCurrent();
            host.assertPresentationChange();
        };
        guard();
        await accounts.setScope(patterns, guard);
        host.notice('Model scope saved; current conversation choices kept' + (edit.view.sources.enabledModels === 'project' ? ' · approved project override remains effective' : ''));
        return 'completed' as const;
    };
    const startup = ApplicationStartup.open(controller);
    const connectClaude = async (target: string, context?: HostCommandContext, guard = sourceGuard(target)) => {
        guard();
        const edit = await startup.prepareBridgeConnection(host.operatorClaude ?? {});
        guard();
        return connectBridge({ choose: host.choose, ...(host.chooseItems ? { chooseItems: host.chooseItems } : {}), ...(host.show ? { show: host.show } : {}), notice: host.notice, ...(host.runPreparation ? { runPreparation: host.runPreparation } : {}), locale: host.uiLocale?.(target) ?? 'en', guard,
            inspect: () => startup.inspect(), restartCommand: restartCommand(controller.applicationHome(), target, undefined, undefined, startup.continuationArguments(host.restartArguments ?? [])),
            ...(host.execute ? { execute: (command: string) => host.execute!(command, target, context) } : {}),
        }, edit);
    };
    return [
        modelDefault,
        {
            name: 'bridge', descriptionId: 'command.description.bridge', run: async (argument, target, context) => {
                if (argument)
                    throw Error('Use /bridge without arguments; /setup bridge opens advanced fields');
                return connectClaude(target, context);
            },
        },
        {
            name: 'setup', descriptionId: 'command.description.setup', argumentHint: '[inspect|runtime [current]|bridge|combined|save [JSON]|clear]', acceptsArgument: argument => startupArgument(argument) !== undefined, run: async (argument, target, context) => {
                const startupGuard = sourceGuard(target);
                startupGuard();
                const match = startupArgument(argument);
                if (match === undefined)
                    throw Error('Use /setup inspect, /setup runtime [current], /setup bridge, /setup combined, /setup save JSON, or /setup clear');
                const locale = host.uiLocale?.(target) ?? 'en', t = translator(locale);
                const actions = ['inspect', 'runtime', 'connect', 'bridge', 'combined', 'save', 'clear'] as const;
                const action = match?.[1] ?? await chooseUiItem(host, t('startup.menuTitle'), actions.map(value => ({
                    value, label: value === 'combined' ? t('setupCombined.entry') : t(`startup.menu.${value}`),
                })));
                startupGuard();
                if (!action)
                    return 'cancelled';
                if (action === 'connect')
                    return connectClaude(target, context, startupGuard);
                if (action === 'combined') {
                    const show = host.show;
                    if (!show) throw Error('Combined settings review requires an inspection view; use gitjig setup edit with the same --home');
                    return editCombinedStartupFields({ locale, guard: startupGuard,
                        choose: (title, rows) => host.choose(title, rows), input: (title, value, description) => host.input(title, value, description),
                        show: (title, text, primary) => show.call(host, title, text, primary), notice: text => {
                            try { startupGuard(); } catch { return; }
                            host.notice(text, text.includes('\n'));
                        },
                    }, startup);
                }
                if (action === 'bridge') {
                    const guard = startupGuard, edit = await startup.prepareBridgeEdit();
                    guard();
                    return editBridgeFields({ ...host, locale, guard }, edit);
                }
                if (action === 'runtime') {
                    const activeRuntime = controller.options.runtimeProfile;
                    const useCurrent = match?.[2] === 'current';
                    if (useCurrent && !activeRuntime)
                        throw Error(t('runtime.noActiveDraft'));
                    const edit = await startup.prepareRuntimeEdit();
                    const focusedRepair = context?.runtimeSetupFocus !== undefined;
                    const fromCurrent = useCurrent || !!activeRuntime &&
                        (focusedRepair || !edit.runtime && (await startup.inspect()).sources.runtime === 'invocation');
                    const guard = () => {
                        startupGuard();
                        if (controller.options.runtimeProfile !== activeRuntime)
                            throw Error(uiText(locale, 'runtime.activeChanged'));
                    };
                    guard();
                    return editRuntimeFields({ ...host, locale, guard, focus: context?.runtimeSetupFocus }, {
                        ...edit, runtime: fromCurrent ? structuredClone(activeRuntime) : edit.runtime,
                        draftSource: fromCurrent ? 'current' : edit.runtime ? 'saved' : undefined,
                        savedRuntime: edit.runtime,
                        activeRuntime: structuredClone(activeRuntime),
                    });
                }
                else if (action === 'inspect') {
                    const view = await startup.inspect();
                    startupGuard();
                    const title = t('startup.inspectTitle');
                    const status = view.activation.runtime === 'unknown' ? [view.diagnostic ?? t('value.activationUnknown')] :
                        (['runtime', 'bridge'] as const).map(component => startupComponentLabel(component, view.activation[component], t));
                    if (host.show)
                        await host.show(title, `${status.join('\n')}\n\n${t('startup.sources')} · ${JSON.stringify(view.sources)}\n\n${t('startup.saved')}\n${JSON.stringify(view.saved, null, 2)}\n\n${t('startup.effective')}\n${JSON.stringify(view.effective, null, 2)}`);
                    else
                        await host.choose(title, [
                            ...status,
                            `${t('startup.saved')} · ${JSON.stringify(view.saved)}`, `${t('startup.effective')} · ${JSON.stringify(view.effective)}`,
                            `${t('startup.sources')} · ${JSON.stringify(view.sources)}`,
                        ]);
                    startupGuard();
                }
                else {
                    const edit = await startup.prepareEdit(), guard = () => {
                        startupGuard();
                        edit.assertCurrent();
                    };
                    guard();
                    if (action === 'clear') {
                        const { activation } = await edit.save({ version: 1 }, guard);
                        if (host.isCurrent(target))
                            host.notice(startupSaveNotice('clear', activation, t), true);
                    }
                    else {
                        const view = await startup.inspect();
                        guard();
                        const value = match?.[2] ?? await host.input('Future startup · version1 JSON · runtime and bridge are optional', JSON.stringify(view.saved ?? { version: 1 }));
                        guard();
                        if (value === undefined)
                            return 'cancelled';
                        let configuration: unknown;
                        try {
                            configuration = parseUniqueJson(value);
                        }
                        catch {
                            throw Error('Enter valid unambiguous startup JSON; the saved setup has not changed');
                        }
                        const { activation } = await edit.save(configuration, guard);
                        if (host.isCurrent(target))
                            host.notice(startupSaveNotice('save', activation, t), true);
                    }
                }
            }
        },
        {
            name: 'role-model', descriptionId: 'command.description.role-model', argumentHint: '[role]', run: async (argument, target) => {
                const locale = host.uiLocale?.(target) ?? 'en', t = translator(locale);
                const source = sourceGuard(target, t('model.roleSourceChanged')), edit = models.prepareRoleEdit(), guard = () => {
                    source();
                    edit.assertCurrent();
                };
                guard();
                const givenRole = applicationModelRoles.find(role => role === argument);
                if (argument && !givenRole)
                    throw Error(t('model.roleArgument'));
                const role = givenRole ?? await chooseUiItem<ApplicationModelRole>(host, t('model.roleTitle'), applicationModelRoles.map(value => ({
                    value, label: `${value} · ${t(`model.roleName.${value}`)}`,
                })));
                guard();
                if (!role)
                    return 'cancelled';
                const name = t(`model.roleName.${role}`), current = edit.preferences[role];
                const title = t('model.roleSelection', {role: name, current: current ? current.provider + '/' + current.modelId + ' · ' + current.thinkingLevel : t('model.roleInherited')});
                if (current) {
                    const action = await chooseUiItem(host, title, [
                        {value: 'replace', label: t('model.roleReplace')},
                        {value: 'inherit', label: t('model.roleInherit')},
                    ]);
                    guard();
                    if (!action)
                        return 'cancelled';
                    if (action === 'inherit') {
                        await models.setRole(role, null, guard);
                        if (host.isCurrent(target))
                            host.notice(t('model.roleInheritanceSet', {role: name}));
                        return;
                    }
                }
                const catalogue = (await accounts.models()).models;
                guard();
                const referenceCounts = new Map<string, number>();
                for (const model of catalogue) {
                    const reference = `${model.provider}/${model.id}`;
                    referenceCounts.set(reference, (referenceCounts.get(reference) ?? 0) + 1);
                }
                const entries = catalogue.map(model => {
                    const tuple = JSON.stringify([model.provider, model.id]);
                    const reference = `${model.provider}/${model.id}`;
                    const display = referenceCounts.get(reference) === 1 ? reference : tuple;
                    const label = [model.contextWindow, model.maxTokens].every(value => Number.isSafeInteger(value) && value > 0)
                        ? t('model.roleCapacity', { model: display, context: model.contextWindow.toLocaleString(locale), output: model.maxTokens.toLocaleString(locale) })
                        : display;
                    return { value: `model:${tuple}`, label, model };
                });
                const selected = await chooseUiItem(host, t('model.catalogue', { title }), entries);
                guard();
                if (!selected)
                    return 'cancelled';
                const entry = entries.find(item => item.value === selected);
                if (!entry)
                    throw Error('Invalid application catalogue selection');
                const desired = await models.choice(entry.model.provider, entry.model.id);
                guard();
                const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
                const thinking = await chooseUiItem<(typeof levels)[number]>(host, t('model.roleThinking', {role: name}), levels.map(value => ({value, label: value})));
                guard();
                if (!thinking)
                    return 'cancelled';
                await models.setRole(role, { ...desired, thinkingLevel: thinking }, guard);
                if (host.isCurrent(target))
                    host.notice(t('model.roleSaved', {role: name}));
            }
        },
        {
            name: 'scoped-models', descriptionId: 'command.description.scoped-models', argumentHint: '[JSON array]', run: (argument, target) => scopeEdit(target, argument)
        },
        {
            name: 'model-next', descriptionId: 'command.description.model-next', run: async (_argument, target) => {
                const edit = preferenceEdit(target), view = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target);
                await models.next({ conversationId: target, expectedGeneration: view.generation, expectedRevision: choice.revision }, edit.assertCurrent);
                if (host.isCurrent(target))
                    host.notice('Next scoped model selected for this conversation');
            }
        },
        {
            name: 'settings', descriptionId: 'command.description.settings', argumentHint: '[inspect|key [JSON value]]', run: async (argument, target) => {
                const edit = preferenceEdit(target), inspected = edit.view;
                const inspect = 'Inspect effective values and sources';
                const reset = uiText(host.uiLocale?.(target) ?? 'en', 'reset.settingsEntry');
                const match = /^(\S+)(?:\s+([\s\S]+))?$/u.exec(argument);
                const key = match?.[1] || await host.choose('Application preferences · values may be overridden by approved project preferences', [...(host.show ? [inspect] : []), ...inspected.supportedPreferences, ...(host.reset ? [reset] : [])]);
                edit.assertCurrent();
                if (!key)
                    return 'cancelled';
                if (key === reset && host.reset)
                    return host.reset(target);
                if (key === 'inspect' || key === inspect) {
                    if (match?.[2])
                        throw Error('Use /settings inspect');
                    if (!host.show)
                        throw Error('Preference details are unavailable in this entry');
                    await host.show('Preferences · effective values and sources', JSON.stringify({
                        projectApproved: inspected.projectApproved, application: inspected.global, project: inspected.project, effective: inspected.effective, sources: inspected.sources, diagnostics: inspected.diagnostics
                    }, null, 2) + '\n\nOmitted preferences use product defaults. Editing changes application preferences; approved project values can remain effective.');
                    edit.assertCurrent();
                    return 'completed';
                }
                if (!inspected.supportedPreferences.includes(key))
                    throw new Error('Unsupported application preference; use /settings to select a supported setting');
                if (key === 'defaultProvider' || key === 'defaultModel') {
                    if (match?.[2] !== undefined)
                        throw new Error('Use /model-default provider/model to save a matching default pair');
                    return modelDefault.run('', target);
                }
                if (key === 'enabledModels')
                    return scopeEdit(target, match?.[2]);
                const manager = settings.manager();
                const defaults: Record<string, unknown> = {
                    defaultThinkingLevel: manager.getDefaultThinkingLevel() ?? 'off', modelThinkingLevels: manager.getAllModelThinkingLevels(), enabledModels: manager.getEnabledModels() ?? [],
                    theme: manager.getTheme() ?? 'dark', hideThinkingBlock: manager.getHideThinkingBlock(), editorPaddingX: manager.getEditorPaddingX(),
                    autocompleteMaxVisible: manager.getAutocompleteMaxVisible(), fullscreenCopyOnSelect: manager.getFullscreenCopyOnSelect(),
                    fullscreenScrollbar: manager.getFullscreenScrollbar(), fullscreenWheelScrollLines: manager.getFullscreenWheelScrollLines(),
                    steeringMode: manager.getSteeringMode(), followUpMode: manager.getFollowUpMode(),
                };
                // Only admitted preferences with actual connected consumers appear here.
                if (!Object.hasOwn(defaults, key))
                    throw new Error('This preference is not available in the interactive UI yet');
                const choices: Record<string, (string | boolean)[]> = {
                    theme: ['dark', 'light', 'system'], hideThinkingBlock: [false, true], fullscreenCopyOnSelect: [true, false],
                    fullscreenScrollbar: ['auto', 'always', 'hidden'], defaultThinkingLevel: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
                    steeringMode: ['all', 'one-at-a-time'], followUpMode: ['all', 'one-at-a-time']
                };
                const current = inspected.global[key] ?? defaults[key];
                let value: unknown;
                if (match?.[2] !== undefined)
                    value = parse(match[2]);
                else if (key === 'modelThinkingLevels') {
                    const catalogue = (await accounts.models()).models.map(model => `${model.provider}/${model.id}`);
                    edit.assertCurrent();
                    value = await editModelThinking({ ...host, assertCurrent: edit.assertCurrent }, (inspected.global[key] ?? {}) as Record<string, string>, catalogue, inspected.sources[key] === 'project');
                }
                else if (choices[key]) {
                    const selected = await host.choose(`${key} · application ${String(current)} · effective source ${inspected.sources[key] ?? 'product default'}`, choices[key]!.map(String));
                    edit.assertCurrent();
                    if (selected === undefined)
                        return 'cancelled';
                    if (!choices[key]!.some(v => String(v) === selected))
                        throw Error('Choose a listed preference value');
                    value = choices[key]!.find(v => String(v) === selected);
                }
                else {
                    const raw = await host.input(`${key} · application value · ${key === 'fullscreenWheelScrollLines' ? '1..100 or auto' : key === 'editorPaddingX' ? 'whole number 0..3' : 'whole number 3..20'} · effective source ${inspected.sources[key] ?? 'product default'}`, String(current));
                    edit.assertCurrent();
                    if (raw === undefined)
                        return 'cancelled';
                    value = key === 'fullscreenWheelScrollLines' && raw === 'auto' ? 'auto' : /^(?:0|[1-9][0-9]*)$/u.test(raw) ? Number(raw) : undefined;
                    if (value === undefined)
                        throw Error('Enter a whole number, or auto for wheel scrolling');
                }
                if (value === undefined)
                    return 'cancelled';
                const guard = () => {
                    edit.assertCurrent();
                    host.assertPresentationChange();
                };
                guard();
                const release = controller.beginApplicationMutation();
                try {
                    await settings.setPreference(key, value, guard);
                }
                finally {
                    release();
                }
                host.apply();
                host.notice(`Saved application preference: ${key}${inspected.sources[key] === 'project' ? ' · approved project override remains effective' : ''}`);
            }
        },
        {
            name: 'reload', descriptionId: 'command.description.reload', run: async () => {
                host.apply();
                host.notice('Application presentation reloaded; keybindings reloaded; conversation models and history kept');
            }
        },
        {
            name: 'hotkeys', descriptionId: 'command.description.hotkeys', run: async () => {
                const bindings = getKeybindings(), rows = Object.entries(bindings.getResolvedBindings()).filter(([, value]) => Array.isArray(value) ? value.length : !!value).map(([key, value]) => {
                    const definition = bindings.getDefinition(key as Parameters<typeof bindings.getDefinition>[0]);
                    return `${definition?.description ?? key} · ${Array.isArray(value) ? value.join(', ') || 'unassigned' : value ?? 'unassigned'}`;
                });
                const selected = await host.choose(`Gitjig keybindings · edit ${host.keybindingsFile ?? 'application config/keybindings.json'} then /reload · app/transcript controls fixed`, [
                    `${host.commandKey} · commands`, 'Shift+Up · parent', 'Shift+Down · child', 'Alt+Enter · follow-up / explicit submit',
                    'F2 · conversations', 'F3 · new conversation', 'F4 · split', 'F5 · notifications', 'F6 · history', 'F7 · summarize', 'F8 · lifecycle', ...rows
                ]);
                if (!selected)
                    return 'cancelled';
                host.notice('Keybindings closed');
                return 'completed';
            }
        },
    ];
}

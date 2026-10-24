import type { UiChoiceHost } from './choices.js';
import { uiText, type UiLocale } from './i18n.js';
import { parseUniqueJson } from '../workflow/json.js';
import { editRuntimeFields } from './runtime-fields.js';
import { editBridgeFields } from './bridge-fields.js';
import { connectBridge } from './bridge-setup.js';
import type { ClaudeOperatorEnvironment } from '../app/bridge-connection.js';
import { restartCommand } from './startup-guidance.js';
import { pickApplicationModel } from './model-picker.js';
import { editModelScope, editModelThinking } from './preference-editors.js';
import { getKeybindings } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
import type { ApplicationSettings } from '../app/settings.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { ApplicationModels } from '../app/models.js';
import { applicationModelRoles, type ApplicationModelRole } from '../app/models.js';
import { ApplicationStartup } from '../app/startup.js';
import type { HostCommand } from './host-commands.js';
interface ConfigurationCommands extends UiChoiceHost {
    controller: Controller;
    operatorClaude?: Readonly<ClaudeOperatorEnvironment> | undefined;
    restartArguments?: readonly string[] | undefined;
    execute?(command: string, target: string): Promise<unknown>;
    reset?(target: string): Promise<import('./host-commands.js').HostCommandOutcome>;
    uiLocale?(target: string): UiLocale;
    settings: ApplicationSettings;
    accounts: ApplicationAccounts;
    models: ApplicationModels;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show?(title: string, text: string): Promise<void>;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
    isCurrent(target: string): boolean;
    notice(text: string): void;
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
export function configurationCommands(host: ConfigurationCommands): HostCommand[] {
    const { controller, settings, accounts, models } = host;
    const modelDefault: HostCommand = {
        name: 'model-default', description: 'Save the model for new conversations', argumentHint: '[provider/model]', run: async (argument, target) => {
            const edit = preferenceEdit(target);
            const reference = argument || await pickApplicationModel(host, await accounts.models(), edit.assertCurrent, 'Default model for new conversations');
            edit.assertCurrent();
            if (!reference)
                return 'cancelled';
            const split = reference.indexOf('/');
            if (split <= 0 || split === reference.length - 1)
                throw new Error('Use /model-default provider/model');
            await accounts.setDefault(reference.slice(0, split), reference.slice(split + 1), edit.assertCurrent);
            host.notice('Default model saved for new conversations; current choices kept' + (['defaultProvider', 'defaultModel'].some(key => edit.view.sources[key] === 'project') ? ' · approved project override remains effective' : ''));
        }
    };
    const sourceGuard = (target: string) => {
        const language = controller.getConversationLanguage(target);
        const source = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target);
        return () => {
            const now = controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || controller.getConversationLanguage(target).revision !== language.revision || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== choice.revision)
                throw Error('Startup form source changed; reopen /setup');
        };
    };
    const preferenceEdit = (target: string) => {
        const source = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target), edit = settings.prepareEdit(source.projectId ?? undefined);
        const assertCurrent = () => {
            const now = controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== choice.revision)
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
    return [
        modelDefault,
        {
            name: 'bridge', description: 'Connect an existing native Claude Code login', run: async (argument, target) => {
                if (argument)
                    throw Error('Use /bridge without arguments; /setup bridge opens advanced fields');
                const guard = sourceGuard(target);
                guard();
                const edit = await startup.prepareBridgeConnection(host.operatorClaude ?? {});
                guard();
                return connectBridge({ choose: host.choose, ...(host.chooseItems ? { chooseItems: host.chooseItems } : {}), ...(host.show ? { show: host.show } : {}), notice: host.notice, ...(host.runPreparation ? { runPreparation: host.runPreparation } : {}), locale: host.uiLocale?.(target) ?? 'en', guard,
                    inspect: () => startup.inspect(), restartCommand: restartCommand(controller.applicationHome(), target, undefined, undefined, startup.continuationArguments(host.restartArguments ?? [])),
                    ...(host.execute ? { execute: (command: string) => host.execute!(command, target) } : {}),
                }, edit);
            },
        },
        {
            name: 'setup', description: 'Inspect or save future application startup', argumentHint: '[inspect|runtime|bridge|save JSON|clear]', run: async (argument, target) => {
                const startupGuard = sourceGuard(target);
                startupGuard();
                const match = /^(inspect|runtime|bridge|save|clear)(?:\s+([\s\S]+))?$/u.exec(argument);
                if (argument && (!match || match[1] !== 'save' && match[2]))
                    throw Error('Use /setup inspect, /setup runtime, /setup bridge, /setup save JSON, or /setup clear');
                const action = match?.[1] || await host.choose('Application startup · runtime fields apply now; bridge and JSON changes after relaunch', ['runtime', 'bridge', 'inspect', 'save', 'clear']);
                startupGuard();
                if (!action)
                    return 'cancelled';
                if (action === 'bridge') {
                    const guard = startupGuard, edit = await startup.prepareBridgeEdit();
                    guard();
                    return editBridgeFields({ ...host, guard }, edit);
                }
                if (action === 'runtime') {
                    const edit = await startup.prepareRuntimeEdit();
                    startupGuard();
                    return editRuntimeFields({ ...host, locale: host.uiLocale?.(target) ?? 'en', guard: startupGuard }, edit);
                }
                else if (action === 'inspect') {
                    const view = await startup.inspect();
                    startupGuard();
                    const title = `Startup · ${view.restartRequired ? 'restart required' : 'current process kept'}`;
                    if (host.show)
                        await host.show(title, `Sources · ${JSON.stringify(view.sources)}\n\nSaved for next launch\n${JSON.stringify(view.saved, null, 2)}\n\nEffective in this process\n${JSON.stringify(view.effective, null, 2)}\n\n${view.diagnostic ?? 'Runtime field Save applies now; bridge and whole-object changes apply next launch'}`);
                    else
                        await host.choose(title, [
                            `Saved · ${JSON.stringify(view.saved)}`, `Effective · ${JSON.stringify(view.effective)}`,
                            `Sources · ${JSON.stringify(view.sources)}`, view.diagnostic ?? 'Runtime field Save applies now; bridge and whole-object changes apply next launch',
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
                        await edit.save({ version: 1 }, guard);
                        if (host.isCurrent(target))
                            host.notice('Future startup cleared; close normally and relaunch to apply');
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
                        await edit.save(configuration, guard);
                        if (host.isCurrent(target))
                            host.notice('Future startup saved; close normally and relaunch to apply');
                    }
                }
            }
        },
        {
            name: 'role-model', description: 'Set or reset a workflow role model', argumentHint: '[role]', run: async (argument, target) => {
                const source = sourceGuard(target), edit = models.prepareRoleEdit(), guard = () => {
                    source();
                    edit.assertCurrent();
                };
                guard();
                if (argument && !(applicationModelRoles as readonly string[]).includes(argument))
                    throw Error('Choose a workflow role with /role-model');
                const selectedRole = argument || await host.choose('Workflow role model', [...applicationModelRoles]);
                guard();
                if (!selectedRole)
                    return 'cancelled';
                const role = selectedRole as ApplicationModelRole, current = edit.preferences[role];
                const reset = 'Inherit captured work baseline';
                const catalogue = (await accounts.models()).models;
                guard();
                const selected = await host.choose(`${role} · ${current ? current.provider + '/' + current.modelId + ' · ' + current.thinkingLevel : 'inherited work baseline'}`, [reset, ...catalogue.map(model => `${model.provider}/${model.id}`)]);
                guard();
                if (!selected)
                    return 'cancelled';
                if (selected === reset)
                    await models.setRole(role, null, guard);
                else {
                    const split = selected.indexOf('/');
                    if (split <= 0)
                        throw Error('Invalid application catalogue selection');
                    const provider = selected.slice(0, split), id = selected.slice(split + 1);
                    const desired = await models.choice(provider, id);
                    guard();
                    const thinking = await host.choose(`${role} · requested thinking level (clamped to model capability)`, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
                    guard();
                    if (!thinking)
                        return 'cancelled';
                    await models.setRole(role, { ...desired, thinkingLevel: thinking as typeof desired.thinkingLevel }, guard);
                }
                if (host.isCurrent(target))
                    host.notice(`Role model saved: ${role}; active bindings and work baselines kept`);
            }
        },
        {
            name: 'scoped-models', description: 'Edit the saved model cycling pool', argumentHint: '[JSON array]', run: (argument, target) => scopeEdit(target, argument)
        },
        {
            name: 'model-next', description: 'Select the next scoped model for this conversation', run: async (_argument, target) => {
                const edit = preferenceEdit(target), view = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target);
                await models.next({ conversationId: target, expectedGeneration: view.generation, expectedRevision: choice.revision }, edit.assertCurrent);
                if (host.isCurrent(target))
                    host.notice('Next scoped model selected for this conversation');
            }
        },
        {
            name: 'settings', description: 'Inspect and edit application preferences', argumentHint: '[inspect|key [JSON value]]', run: async (argument, target) => {
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
            name: 'reload', description: 'Reload application presentation and keybindings', run: async () => {
                host.apply();
                host.notice('Application presentation reloaded; keybindings reloaded; conversation models and history kept');
            }
        },
        {
            name: 'hotkeys', description: 'Show actual command and editor keybindings', run: async () => {
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

import type { UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { Controller } from '../controller/controller.js';
import type { ApplicationAccounts } from '../app/accounts.js';
import type { ApplicationModels } from '../app/models.js';
import type { HostCommand } from './host-commands.js';
import { pickApplicationModel } from './model-picker.js';
import { parseModelReference, type ExternalModelReference } from './model-route-presentation.js';
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
interface Host extends UiChoiceHost {
    controller: Controller;
    hostLanguage?: string;
    externalModel?: ExternalModelReference;
    accounts?: ApplicationAccounts;
    models?: ApplicationModels;
    isCurrent(target: string): boolean;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
}
/** Owned metadata/choice operations; actual model execution stays in the shared resolver. */
export function modelCommands(h: Host) {
    const owned = new Set<Promise<unknown>>();
    let closing = false;
    const track = <T>(task: Promise<T>) => {
        owned.add(task);
        void task.then(() => owned.delete(task), () => owned.delete(task));
        return task;
    };
    const snapshot = (target: string) => {
        const language = h.controller.getConversationLanguage(target);
        const locale = resolveUiLanguage(language.replyLanguage, h.hostLanguage ?? hostUiLanguage()).locale;
        const view = h.controller.inspectConversation(target), choice = h.controller.getConversationModelChoice(target);
        const isSourceCurrent = () => {
            if (closing || !h.isCurrent(target))
                return false;
            const now = h.controller.inspectConversation(target);
            return now.generation === view.generation && now.projectId === view.projectId &&
                h.controller.getConversationLanguage(target).revision === language.revision && !now.archived && !now.deleted;
        };
        const guard = () => {
            if (!isSourceCurrent() || h.controller.getConversationModelChoice(target).revision !== choice.revision)
                throw Error('Model selection source changed; reopen /model for the intended conversation');
        };
        guard();
        return { view, choice, guard, locale, isSourceCurrent };
    };
    const repairConfiguration: HostCommand['run'] = async (_argument, target) => {
        if (!h.accounts)
            throw Error('Model repair requires the Gitjig application entry');
        const { guard } = snapshot(target);
        let edit: Awaited<ReturnType<ApplicationAccounts['prepareConfigurationRepair']>>;
        try {
            edit = await h.accounts.prepareConfigurationRepair();
        }
        catch {
            guard();
            await h.show('Model/account recovery unavailable', `Inspect these files outside the application:\n${h.controller.applicationHome()}/config/models.json\n${h.controller.applicationHome()}/config/auth.json\n\nRecovery refuses symlinks, shared ownership/permissions and oversized files. Restore an owner-private regular file (at most 128 KiB), then reopen /model-repair. No file was reset.`);
            guard();
            return 'cancelled';
        }
        guard();
        await h.show('Model/account recovery · exact files', edit.files.map(file => `${file.file}\n${file.reason ?? 'Configuration shape is valid'}`).join('\n\n') + '\n\nA reset keeps an exact private backup before replacing only the selected file with its built-in defaults. Model-file reset removes custom endpoints, model definitions and any embedded API keys. Account-file reset removes stored credentials and requires login again. Original work, model choices and other settings are kept.');
        guard();
        const failed = edit.files.filter(file => file.reason);
        if (!failed.length)
            return 'completed';
        const selected = await h.choose('Select the unavailable file to repair', ['Back without changes', ...failed.map(file => 'Review reset · ' + file.file)]);
        guard();
        const file = failed.find(file => selected === 'Review reset · ' + file.file);
        if (!file)
            return 'cancelled';
        const accept = 'Back up and reset this ' + file.kind + ' file';
        const decision = await h.choose('Reset only ' + file.file + ' · original bytes remain in a private recovery backup', ['Back without changes', accept]);
        guard();
        if (decision !== accept)
            return 'cancelled';
        const result = await edit.reset(file.kind, guard);
        try {
            guard();
        }
        catch {
            return 'completed';
        }
        await h.show('Configuration repair saved', `${result.file}\n\nPrivate original backup: ${result.backup}\n\n${result.scope}\n\nReturn to /ready to select an available model or reconnect an account. No model request was sent.`);
        return 'completed';
    };
    const commands: HostCommand[] = [
        {
            name: 'model', descriptionId: 'command.description.model', argumentHint: '[provider/model]',
            acceptsArgument: argument => !!parseModelReference(argument),
            getArgumentCompletions: prefix => track((async () => {
                if (closing || !h.accounts)
                    return [];
                const catalogue = await h.accounts.models(prefix);
                return closing ? [] : catalogue.models.slice(0, 200).map(model => ({ value: model.provider + '/' + model.id, label: model.provider + '/' + model.id }));
            })()),
            run: async (argument, target, context) => {
                if (!h.models || !h.accounts)
                    throw Error('Model management requires the Gitjig application entry');
                const { view, choice, guard: assertChoice, locale, isSourceCurrent } = snapshot(target);
                const guard = () => { assertChoice(); context?.modelSelectionGuard?.(); };
                guard();
                let reference = argument;
                if (!reference) {
                    const catalogue = await h.accounts.models(), accounts = await h.accounts.status();
                    guard();
                    reference = await pickApplicationModel({ ...h, locale }, catalogue, { guard, title: translator(locale)('model.title'), choice, accounts }) ?? '';
                }
                guard();
                if (!reference)
                    return 'cancelled';
                const selected = parseModelReference(reference);
                if (!selected)
                    throw Error('Use /model provider/model');
                const receipt = await h.models.select({
                    conversationId: target, expectedGeneration: view.generation, expectedRevision: choice.revision, ...selected
                }, guard);
                if (isSourceCurrent() && h.controller.getConversationModelChoice(target).revision === receipt.revision)
                    h.notice(translator(locale)(context?.modelSelectionGuard ? 'input.recoveryModelSelected' : 'model.selected'));
                return 'completed';
            }
        }, {
            name: 'model-repair', descriptionId: 'command.description.model-repair',
            run: repairConfiguration
        }, {
            name: 'thinking', descriptionId: 'command.description.thinking', argumentHint: '[' + thinkingLevels.join('|') + ']',
            acceptsArgument: argument => thinkingLevels.includes(argument),
            getArgumentCompletions: prefix => thinkingLevels.filter(level => level.startsWith(prefix)).map(level => ({ value: level, label: level })),
            run: async (argument, target) => {
                const { view, choice, guard } = snapshot(target);
                if (!h.models || choice.kind !== 'managed')
                    throw Error('Select an application model with /model first');
                const level = argument || await h.choose('Thinking level (unsupported levels are clamped by Pi)', thinkingLevels);
                guard();
                if (!level)
                    return 'cancelled';
                const next = await h.models.select({
                    conversationId: target, expectedGeneration: view.generation, expectedRevision: choice.revision, provider: choice.provider, modelId: choice.modelId, thinkingLevel: level as ModelThinkingLevel
                }, guard);
                if (!closing && h.isCurrent(target))
                    h.notice('Thinking: ' + (next.kind === 'managed' ? next.thinkingLevel : 'unavailable'));
                return 'completed';
            }
        }
    ];
    return {
        commands: commands.map(command => ({ ...command, run: (...args: Parameters<HostCommand['run']>) => track(Promise.resolve(command.run(...args))) })), track, async close() {
            closing = true;
            while (owned.size)
                await Promise.allSettled([...owned]);
        }
    };
}

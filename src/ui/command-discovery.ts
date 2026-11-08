import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommands } from './host-commands.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
/** Reuse the actual slash registry and its original dispatch, including nested outcomes. */
export function commandDiscovery(host: UiChoiceHost & {
    controller: Controller;
    hostLanguage?: string;
    registry(): HostCommands;
    isCurrent(target: string): boolean;
}): HostCommand {
    return { name: 'help', descriptionId: 'command.description.help', run: async (_argument, target, context) => {
            const view = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
            const language = host.controller.getConversationLanguage(target), registry = host.registry();
            const { locale } = resolveUiLanguage(language.replyLanguage, host.hostLanguage ?? hostUiLanguage());
            const t = translator(locale);
            const selected = await chooseUiItem(host, t('command.discovery.title'), [
                { value: 'close', label: t('command.discovery.close') },
                ...registry.commands.filter(command => command.name !== 'help').map(command => ({
                    value: '/' + command.name, label: registry.label(command, locale),
                })),
            ]);
            const now = host.controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== view.generation || now.projectId !== view.projectId || now.archived || now.deleted ||
                host.controller.getConversationModelChoice(target).revision !== choice.revision || host.controller.getConversationLanguage(target).revision !== language.revision || host.registry() !== registry)
                throw Error(t('command.discovery.sourceChanged'));
            if (!selected || selected === 'close')
                return 'cancelled';
            const outcome = await registry.execute(selected, target, context);
            if (outcome === 'not-command')
                throw Error(t('command.discovery.unavailable'));
            return outcome;
        } };
}

import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommands } from './host-commands.js';
/** Reuse the actual slash registry and its original dispatch, including nested outcomes. */
export function commandDiscovery(host: {
    controller: Controller;
    registry(): HostCommands;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    isCurrent(target: string): boolean;
}): HostCommand {
    return { name: 'help', description: 'Search commands and run the selected action', run: async (_argument, target, context) => {
            const view = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target), commands = host.registry().commands.filter(command => command.name !== 'help');
            const labels = commands.map(command => `/${command.name}${command.argumentHint ? ' ' + command.argumentHint : ''} — ${command.description ?? ''}`);
            const selected = await host.choose('Gitjig commands · search, then Enter runs the selected action', ['Close · no command run', ...labels]);
            const now = host.controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== view.generation || now.projectId !== view.projectId || now.archived || now.deleted || host.controller.getConversationModelChoice(target).revision !== choice.revision)
                throw Error('Command target changed; reopen /help');
            if (!selected || selected === 'Close · no command run')
                return 'cancelled';
            const command = commands[labels.indexOf(selected)];
            if (!command)
                throw Error('Command selection changed; reopen /help');
            const outcome = await host.registry().execute('/' + command.name, target, context);
            if (outcome === 'not-command')
                throw Error('Selected command is unavailable; reopen /help');
            return outcome;
        } };
}

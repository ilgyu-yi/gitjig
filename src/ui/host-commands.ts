import { commandNameKeys } from './command-input.js';
import { CombinedAutocompleteProvider, type AutocompleteProvider, type SlashCommand } from '@earendil-works/pi-tui';
export type HostCommandOutcome = 'completed' | 'cancelled' | 'started';
export interface HostCommandContext {
    acknowledgeSubmission?: () => void;
    submission?: Readonly<{
        conversationId: string;
        text: string;
        revision: number;
    }>;
}
export type HostCommandExecutor = (command: string, target: string, context?: HostCommandContext) => Promise<HostCommandOutcome>;
export interface HostCommand extends SlashCommand {
    run(argument: string, target: string, context?: HostCommandContext): Promise<void | HostCommandOutcome>;
}
/** Discovery and dispatch share one registry. No native CLI private dispatcher or resource discovery. */
export class HostCommands {
    readonly autocomplete: AutocompleteProvider;
    constructor(readonly commands: readonly HostCommand[]) {
        if (new Set(commands.map(command => command.name)).size !== commands.length)
            throw new Error('Duplicate host command');
        const original = new CombinedAutocompleteProvider([...commands], '/', null);
        this.autocomplete = {
            triggerCharacters: ['/'],
            async getSuggestions(lines, line, column, options) {
                const text = lines[line]?.slice(0, column).trimStart() ?? '';
                // Public combined provider also handles @files/forced filesystem completion.
                // This facade selects only its original slash branch; file admission is separate.
                if (!text.startsWith('/') || text.startsWith('//') || /[@\r\n]/u.test(text))
                    return null;
                const match = /^\/([^\s/]*)$/u.exec(text);
                const normalized = match ? commandNameKeys(match[1]!) : undefined;
                if (match && normalized !== match[1]) {
                    const offset = (lines[line] ?? '').indexOf('/');
                    const translated = [...lines];
                    translated[line] = (lines[line] ?? '').slice(0, offset) + '/' + normalized + (lines[line] ?? '').slice(column);
                    const found = await original.getSuggestions(translated, line, offset + 1 + normalized!.length, { ...options, force: false });
                    return found ? { ...found, prefix: text } : null;
                }
                return original.getSuggestions(lines, line, column, { ...options, force: false });
            },
            applyCompletion: (...args) => original.applyCompletion(...args),
            shouldTriggerFileCompletion: () => false,
        };
    }
    help(): string { return this.commands.map(command => `/${command.name}${command.argumentHint ? ' ' + command.argumentHint : ''} — ${command.description ?? ''}`).join('\n'); }
    async execute(text: string, target: string, context?: HostCommandContext): Promise<'not-command' | HostCommandOutcome> {
        const commandText = text.trim();
        if (!commandText.startsWith('/') || commandText.startsWith('//'))
            return 'not-command';
        const match = /^\/([^\s]+)(?:[ \t]+([^\r\n]*))?$/u.exec(commandText);
        const command = this.commands.find(entry => entry.name === match?.[1] || entry.name === commandNameKeys(match?.[1] ?? ''));
        if (!command)
            throw new Error('Unknown command; use /help. Use // to send a literal leading slash');
        if (match?.[2] && !command.argumentHint)
            throw new Error(`/${command.name} does not accept arguments`);
        return await command.run(match?.[2] ?? '', target, context) ?? 'completed';
    }
}
/** Drain every owned command tail and settle interaction ownership before propagating failures. */
export async function settleHostCommands(close: readonly (() => Promise<unknown>)[], settle: () => Promise<unknown>) {
    const outcomes = await Promise.allSettled(close.map(end => Promise.resolve().then(end))), errors = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    try {
        await settle();
    }
    catch (error) {
        errors.push(error);
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message + ('recovery' in error ? ' · ' + String(error.recovery) : '') : String(error)).join('\n'));
}

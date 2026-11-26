import { commandNameKeys } from './command-input.js';
import { CombinedAutocompleteProvider, type AutocompleteItem, type AutocompleteProvider, type SlashCommand } from '@earendil-works/pi-tui';
import { uiText, type MessageId, type UiLocale } from './i18n.js';
import type { DelegatedRecovery } from './recorded-delegated-result.js';
export type HostCommandOutcome = 'completed' | 'cancelled' | 'started';
export interface HostCommandContext {
    delegatedRecovery?: { record: DelegatedRecovery; isCurrent(): boolean };
    delegatedSetupGuard?: () => void;
    acknowledgeSubmission?: () => void;
    runtimeSetupFocus?: 'context' | 'image';
    modelSelectionGuard?: () => void;
    submission?: Readonly<{
        conversationId: string;
        text: string;
        revision: number;
    }>;
}
export type HostCommandExecutor = (command: string, target: string, context?: HostCommandContext) => Promise<HostCommandOutcome>;
export interface HostCommand extends Omit<SlashCommand, 'description'> {
    descriptionId: Extract<MessageId, `command.description.${string}`>;
    /** Pure grammar check. Availability and authority belong to the handler. */
    acceptsArgument?(argument: string): boolean;
    /** The first successfully opened inspection fulfills this typed invocation. */
    opensInspection?(argument: string): boolean;
    run(argument: string, target: string, context?: HostCommandContext): Promise<void | HostCommandOutcome>;
}
type CommandInputIssue =
    | { kind: 'unknown'; suggestion?: string }
    | { kind: 'multiline' }
    | { kind: 'usage'; syntax: string }
    | { kind: 'arguments'; command: string };

export class HostCommandInputError extends Error {
    constructor(readonly issue: CommandInputIssue) {
        super(issue.kind === 'arguments' ? `/${issue.command} does not accept arguments`
            : issue.kind === 'multiline' ? 'Slash commands take one line'
            : issue.kind === 'usage' ? 'Use ' + issue.syntax
            : 'Unknown command');
    }
}

export function commandInputNotice(issue: CommandInputIssue, locale: UiLocale, key: string): string {
    const message = issue.kind === 'arguments' ? uiText(locale, 'command.inputArguments', { command: '/' + issue.command })
        : issue.kind === 'multiline' ? uiText(locale, 'command.inputMultiline')
        : issue.kind === 'usage' ? uiText(locale, 'command.inputUsage', { syntax: issue.syntax })
        : issue.suggestion ? uiText(locale, 'command.inputSuggestion', { command: '/' + issue.suggestion })
        : uiText(locale, 'command.inputUnknown');
    return [message, uiText(locale, 'command.inputSearch', { key }),
        ...(issue.kind === 'unknown' && !issue.suggestion ? [uiText(locale, 'command.inputLiteralSlash')] : [])].join(issue.kind === 'usage' ? '\n' : ' · ');
}

function oneEditApart(typed: string, registered: string): boolean {
    const [short, long] = typed.length <= registered.length ? [typed, registered] : [registered, typed];
    if (long.length - short.length > 1 || short === long)
        return false;
    let first = 0;
    while (first < short.length && short[first] === long[first])
        first++;
    if (short.length < long.length)
        return short.slice(first) === long.slice(first + 1);
    return short.slice(first + 1) === long.slice(first + 1) ||
        short[first] === long[first + 1] && short[first + 1] === long[first] && short.slice(first + 2) === long.slice(first + 2);
}

/** Discovery and dispatch share one registry. No native CLI private dispatcher or resource discovery. */
export class HostCommands {
    readonly autocomplete: AutocompleteProvider;
    private readonly nativeAutocomplete = new Map<UiLocale, CombinedAutocompleteProvider>();
    constructor(readonly commands: readonly HostCommand[]) {
        if (new Set(commands.map(command => command.name)).size !== commands.length)
            throw new Error('Duplicate host command');
        this.autocomplete = this.autocompleteFor(() => 'en');
    }
    autocompleteFor(locale: () => UiLocale): AutocompleteProvider {
        const provider = (current: UiLocale) => {
            const existing = this.nativeAutocomplete.get(current);
            if (existing)
                return existing;
            const original = new CombinedAutocompleteProvider(this.commands.map(command => ({
                ...command, description: uiText(current, command.descriptionId),
            })), '/', null);
            this.nativeAutocomplete.set(current, original);
            return original;
        };
        const owned = new WeakMap<AutocompleteItem, {
            text: string; line: number; column: number; locale: UiLocale; prefix: string;
        }>();
        return {
            triggerCharacters: ['/'],
            async getSuggestions(lines, line, column, options) {
                const text = lines[line]?.slice(0, column).trimStart() ?? '';
                // Public combined provider also handles @files/forced filesystem completion.
                // This facade selects only its original slash branch; file admission is separate.
                if (!text.startsWith('/') || text.startsWith('//') || /[@\r\n]/u.test(text))
                    return null;
                const sourceText = lines.join('\n'), language = locale(), original = provider(language);
                const match = /^\/([^\s/]*)$/u.exec(text);
                const normalized = match ? commandNameKeys(match[1]!) : '';
                const translate = match && normalized !== match[1];
                let queryLines = lines, queryColumn = column;
                if (translate) {
                    const offset = (lines[line] ?? '').indexOf('/');
                    queryLines = [...lines];
                    queryLines[line] = (lines[line] ?? '').slice(0, offset) + '/' + normalized + (lines[line] ?? '').slice(column);
                    queryColumn = offset + 1 + normalized.length;
                }
                const found = await original.getSuggestions(queryLines, line, queryColumn, { ...options, force: false });
                if (!found || options.signal.aborted || locale() !== language)
                    return null;
                const prefix = translate ? text : found.prefix;
                const source = { text: sourceText, line, column, locale: language, prefix };
                const items = found.items.map(item => {
                    const choice = { ...item };
                    owned.set(choice, source);
                    return choice;
                });
                return { items, prefix };
            },
            applyCompletion(lines, line, column, item, prefix) {
                const source = owned.get(item);
                if (!source || source.text !== lines.join('\n') || source.line !== line || source.column !== column ||
                    source.locale !== locale() || source.prefix !== prefix)
                    return { lines, cursorLine: line, cursorCol: column };
                return provider(source.locale).applyCompletion(lines, line, column, item, prefix);
            },
            shouldTriggerFileCompletion: () => false,
        };
    }
    help(locale: UiLocale = 'en'): string { return this.commands.map(command => this.label(command, locale)).join('\n'); }
    label(command: HostCommand, locale: UiLocale): string {
        return `/${command.name}${command.argumentHint ? ' ' + command.argumentHint : ''} — ${uiText(locale, command.descriptionId)}`;
    }
    private resolveCommand(text: string) {
        const match = /^\/([^\s]+)(?:[ \t]+([^\r\n]*))?$/u.exec(text.trim());
        const name = commandNameKeys(match?.[1] ?? '');
        const command = this.commands.find(entry => entry.name === match?.[1] || entry.name === name);
        return { command, name, argument: match?.[2] };
    }
    /** Presentation identity only; arguments and unknown input are never returned. */
    commandName(text: string): string | undefined { return this.resolveCommand(text).command?.name; }
    /** Validate syntax against this registry before taking ownership of an interaction. */
    prepare(text: string): { name: string; opensInspection: boolean; run(target: string, context?: HostCommandContext): Promise<HostCommandOutcome> } | undefined {
        const commandText = text.trim();
        if (!commandText.startsWith('/') || commandText.startsWith('//'))
            return;
        if (/[\r\n]/u.test(commandText))
            throw new HostCommandInputError({ kind: 'multiline' });
        const { command, name, argument } = this.resolveCommand(commandText);
        if (!command) {
            const matches = /^[a-z][a-z0-9-]{1,63}$/iu.test(name) ? this.commands.filter(entry => oneEditApart(name, entry.name)) : [];
            throw new HostCommandInputError({ kind: 'unknown', ...(matches.length === 1 ? { suggestion: matches[0]!.name } : {}) });
        }
        if (argument) {
            if (!command.argumentHint)
                throw new HostCommandInputError({ kind: 'arguments', command: command.name });
            if (command.acceptsArgument?.(argument) === false)
                throw new HostCommandInputError({ kind: 'usage', syntax: '/' + command.name + ' ' + command.argumentHint });
        }
        return { name: command.name, opensInspection: command.opensInspection?.(argument ?? '') === true,
            run: async (target, context) => await command.run(argument ?? '', target, context) ?? 'completed' };
    }
    async execute(text: string, target: string, context?: HostCommandContext): Promise<'not-command' | HostCommandOutcome> {
        // The original resolved command and its literal argument also drive nested dispatch.
        const prepared = this.prepare(text);
        return prepared ? prepared.run(target, context) : 'not-command';
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

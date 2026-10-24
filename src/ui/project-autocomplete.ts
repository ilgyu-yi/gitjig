import type { AutocompleteItem, AutocompleteProvider } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
function fileToken(line: string, column: number, force?: boolean) {
    for (let start = 0; start < line.length;) {
        if (/\s/u.test(line[start]!)) {
            start++;
            continue;
        }
        const explicit = line[start] === '@', quote = explicit ? start + 1 : start;
        let end = quote, quoted = line[quote] === '"';
        if (quoted) {
            end++;
            let escaped = false;
            for (; end < line.length; end++) {
                if (line[end] === '"' && !escaped) {
                    end++;
                    break;
                }
                escaped = line[end] === '\\' && !escaped;
            }
            if (end < line.length && !/\s/u.test(line[end]!))
                return undefined;
        }
        else
            while (end < line.length && !/\s/u.test(line[end]!))
                end++;
        if (column > start && column <= end) {
            if ((!explicit && !force) || line.slice(start, start + 2) === '@@')
                return undefined;
            const token = line.slice(start, column);
            let prefix = explicit ? token.slice(1) : token;
            if (quoted) {
                try {
                    prefix = JSON.parse(prefix + (prefix.endsWith('"') && prefix.length > 1 ? '' : '"'));
                }
                catch {
                    return undefined;
                }
            }
            else if (!explicit && prefix.includes('@'))
                return undefined;
            return { start, end, explicit, prefix, token };
        }
        start = end;
    }
    return undefined;
}
/** Original editor handles popup/cancellation. This resolver never calls Pi's filesystem branch. */
export function projectAutocomplete(host: {
    controller: Controller;
    conversationId: string;
    slash: AutocompleteProvider;
    isCurrent(): boolean;
    revision(): number;
    notice(message: string): void;
}): AutocompleteProvider {
    let pending: AbortController | undefined, serial = 0;
    const owned = new WeakMap<AutocompleteItem, {
        text: string;
        line: number;
        column: number;
        revision: number;
        serial: number;
        start: number;
        end: number;
        directory: boolean;
    }>();
    return {
        triggerCharacters: ['/', '@'],
        async getSuggestions(lines, line, column, options) {
            pending?.abort();
            const request = ++serial;
            const before = lines[line]?.slice(0, column) ?? '';
            if (before.trimStart().startsWith('/') || before.trimStart().startsWith('!'))
                return host.slash.getSuggestions(lines, line, column, options);
            if (!host.isCurrent())
                return null;
            const span = fileToken(lines[line] ?? '', column, options.force);
            if (!span)
                return null;
            const { token, prefix, explicit } = span;
            const view = host.controller.inspectConversation(host.conversationId);
            if (!view.projectId)
                return null;
            const revision = host.revision(), text = lines.join('\n');
            pending = new AbortController();
            const signal = AbortSignal.any([pending.signal, options.signal]);
            try {
                const result = await host.controller.completeConversationFiles({ conversationId: host.conversationId, expectedGeneration: view.generation,
                    draftRevision: view.draft.revision, prefix }, signal);
                if (signal.aborted || request !== serial || !host.isCurrent() || host.revision() !== revision)
                    return null;
                if (result.bounded)
                    host.notice('Showing first50 matches; narrow the path for more');
                const items = result.paths.map(file => {
                    const value = file.path + (file.directory ? '/' : ''), quoted = /[\s"\\]/u.test(value) ? JSON.stringify(value) : value;
                    const item = { value: (explicit ? '@' : '') + quoted + (file.directory ? '' : ' '), label: value, description: file.directory ? 'Project directory' : 'Project text reference (captured on submit)' };
                    owned.set(item, { text, line, column, revision, serial: request, start: span.start, end: span.end, directory: file.directory });
                    return item;
                });
                return items.length ? { items, prefix: token } : null;
            }
            catch (error) {
                if (!signal.aborted && request === serial && host.isCurrent() && host.revision() === revision)
                    host.notice(error instanceof Error && !('code' in error) ? error.message : 'File completion unavailable; check the registered project');
                return null;
            }
        },
        applyCompletion(lines, line, column, item, prefix) {
            const captured = owned.get(item);
            if (!captured)
                return host.slash.applyCompletion(lines, line, column, item, prefix);
            if (!host.isCurrent() || host.revision() !== captured.revision || serial !== captured.serial || lines.join('\n') !== captured.text || line !== captured.line || column !== captured.column)
                return { lines, cursorLine: line, cursorCol: column };
            const result = [...lines], before = result[line] ?? '';
            let suffix = before.slice(captured.end);
            if (item.value.endsWith(' ') && suffix.startsWith(' '))
                suffix = suffix.slice(1);
            result[line] = before.slice(0, captured.start) + item.value + suffix;
            return { lines: result, cursorLine: line, cursorCol: captured.start + item.value.length - (captured.directory && item.value.endsWith('"') ? 1 : 0) };
        },
        shouldTriggerFileCompletion: (lines, line, column) => !/^\s*[\/!]/u.test(lines[line]?.slice(0, column) ?? ''),
    };
}

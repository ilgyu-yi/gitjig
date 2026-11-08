import { join } from 'node:path';
import { Key, KeybindingsManager, type KeybindingsConfig, type KeybindingDefinitions, type KeyId } from '@earendil-works/pi-tui';
import type { Controller } from '../controller/controller.js';
import { directory, readObject } from './settings.js';
const modifiers = ['ctrl', 'alt', 'shift', 'super'];
const bases = new Set([...(Object.values(Key) as unknown[]).filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()), ...'abcdefghijklmnopqrstuvwxyz0123456789']);
const keys = (value: string | string[] | undefined): string[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
function canonical(value: unknown): string {
    if (typeof value !== 'string' || value.length > 64)
        throw Error('Invalid key identifier');
    let rest = value.toLowerCase();
    const found = new Set<string>();
    for (;;) {
        const modifier = modifiers.find(item => rest.startsWith(item + '+'));
        if (!modifier)
            break;
        if (found.has(modifier))
            throw Error('Repeated key modifier');
        found.add(modifier);
        rest = rest.slice(modifier.length + 1);
    }
    if (!bases.has(rest))
        throw Error('Unknown key identifier');
    if (rest === 'esc')
        rest = 'escape';
    if (rest === 'return')
        rest = 'enter';
    if (found.size && (rest === 'escape' || /^f\d+$/u.test(rest)))
        throw Error('Invalid key identifier');
    return [...modifiers.filter(item => found.has(item)), rest].join('+');
}
/** Conservative legacy transport aliases; never a replacement for Pi's decoder. */
function signatures(value: string): string[] {
    const key = canonical(value), result = [key];
    const controls: Record<string, number> = { tab: 9, enter: 13, escape: 27, backspace: 8, 'ctrl+space': 0 };
    if (key in controls)
        result.push('byte:' + controls[key]);
    if (key === 'enter' || key === 'ctrl+j' || key === 'shift+enter')
        result.push('byte:10');
    if (key === 'alt+enter' || key === 'shift+enter')
        result.push('byte:27,13');
    const control = /^(alt\+)?ctrl\+([a-z\[\]\\^_@])$/u.exec(key);
    // Canonical modifiers put ctrl before alt.
    const ctrlAlt = /^ctrl\+alt\+([a-z\[\]\\^_@])$/u.exec(key);
    if (control)
        result.push('byte:' + (control[1] ? '27,' : '') + (control[2]!.toUpperCase().charCodeAt(0) & 31));
    if (ctrlAlt)
        result.push('byte:27,' + (ctrlAlt[1]!.toUpperCase().charCodeAt(0) & 31));
    return result;
}
const overlap = (left: string[], right: string[]) => left.some(a => right.some(b => signatures(a).some(value => signatures(b).includes(value))));
const configurable = (id: string) => /^(?:tui\.editor\.|tui\.input\.|tui\.select\.)/u.test(id);
export class ApplicationKeybindings {
    readonly file: string;
    constructor(private readonly controller: Controller) {
        const folder = join(controller.applicationHome(), 'config');
        directory(folder, true, true);
        this.file = join(folder, 'keybindings.json');
    }
    load(definitions: KeybindingDefinitions, commandKey: string): KeybindingsConfig {
        try {
            this.controller.applicationHome();
            directory(join(this.controller.applicationHome(), 'config'), true);
            const raw = readObject(this.file, true), entries = Object.entries(raw);
            if (entries.length > 100)
                throw Error('Too many keybinding entries');
            const candidate: KeybindingsConfig = {};
            for (const [id, value] of entries) {
                if (!Object.hasOwn(definitions, id) || !configurable(id))
                    throw Error('Unsupported or fixed keybinding action');
                if (typeof value !== 'string' && !Array.isArray(value))
                    throw Error('A keybinding requires a string or array');
                const values = keys(value as string | string[]);
                if (values.length > 8)
                    throw Error('Too many keys for one action');
                const admitted = [...new Set(values.map(canonical))];
                if (!admitted.length && ['tui.select.confirm', 'tui.select.cancel', 'tui.input.submit'].includes(id))
                    throw Error('Confirmation and cancellation require a key');
                candidate[id] = admitted as KeyId[];
            }
            const defaults = new KeybindingsManager(definitions).getResolvedBindings();
            const resolved = new KeybindingsManager(definitions, candidate).getResolvedBindings();
            const host = [commandKey, 'shift+up', 'shift+down', 'alt+enter', ...Array.from({ length: 7 }, (_, i) => 'f' + (i + 2))];
            const secret = ['escape', 'ctrl+c', 'ctrl+d'];
            for (const [id, value] of Object.entries(candidate)) {
                for (const key of keys(value)) {
                    const original = keys(defaults[id]).some(value => canonical(value) === key);
                    if (!original && overlap([key], [...host, ...secret]))
                        throw Error('Key is reserved by a fixed host or account control');
                    if (id.startsWith('tui.select.') && overlap([key], ['c', 'j', 'p', 'd', 's', 'w', 'n', 'r', 'h', 'm', 'l', 'e', 't', '?']))
                        throw Error('Selector key is reserved by the command menu');
                }
            }
            const ids = Object.keys(definitions);
            for (let i = 0; i < ids.length; i++)
                for (let j = i + 1; j < ids.length; j++) {
                    const a = ids[i]!, b = ids[j]!;
                    if (!Object.hasOwn(candidate, a) && !Object.hasOwn(candidate, b))
                        continue;
                    // Transcript search-only actions have their own focus context. Other
                    // transcript chords are reserved where the original screen intercepts.
                    if ((a.startsWith('tui.altScreen.search') || b.startsWith('tui.altScreen.search')))
                        continue;
                    if (overlap(keys(resolved[a]), keys(resolved[b])) && !overlap(keys(defaults[a]), keys(defaults[b])))
                        throw Error('Key conflicts with another resolved action');
                }
            return structuredClone(candidate);
        }
        catch (error) {
            const reason = error instanceof Error && /^(Invalid key identifier|Repeated key modifier|Unknown key identifier|Too many keybinding entries|Unsupported or fixed keybinding action|A keybinding requires a string or array|Too many keys for one action|Confirmation and cancellation require a key|Key is reserved by a fixed host or account control|Selector key is reserved by the command menu|Key conflicts with another resolved action)$/u.test(error.message) ? error.message : 'Invalid or unsafe keybindings file';
            throw Error(`${reason}; repair ${this.file} and retry /reload or restart`);
        }
    }
}

import { matchesKey, parseKey } from '@earendil-works/pi-tui';
const leading = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
const vowels = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
const trailing = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
const compatibility = 'ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const keys = ['r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g', ...vowels];
const dubeolsikPhysicalKeys: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries([
    ...[...compatibility].map((character, index) => [character, keys[index]!] as const),
    ...leading.map((key, index) => [String.fromCodePoint(0x1100 + index), key] as const),
    ...vowels.map((key, index) => [String.fromCodePoint(0x1161 + index), key] as const),
    ...trailing.slice(1).map((key, index) => [String.fromCodePoint(0x11a8 + index), key] as const),
].filter(([, key]) => /^[a-zA-Z]$/.test(key))));
// English identity belongs to Pi. Additional qualified keyboard layouts extend
// this registry of single physical keys, independently of UI locale or decoding.
const shortcutKeyboardLayouts = Object.freeze([dubeolsikPhysicalKeys]);

function shortcutPhysicalKey(character: string): string | undefined {
    for (const layout of shortcutKeyboardLayouts) {
        const key = layout[character];
        if (key !== undefined)
            return key;
    }
    return undefined;
}
/** Interpret Dubeolsik key positions only where the host expects a command name. */
export function commandNameKeys(text: string): string {
    return [...text].map(c => {
        const code = c.codePointAt(0)!;
        if (code >= 0xac00 && code <= 0xd7a3) {
            const offset = code - 0xac00;
            return leading[Math.floor(offset / 588)]! + vowels[Math.floor(offset / 28) % 21]! + trailing[offset % 28]!;
        }
        const index = compatibility.indexOf(c);
        if (index >= 0)
            return keys[index]!;
        if (code >= 0x1100 && code <= 0x1112)
            return leading[code - 0x1100]!;
        if (code >= 0x1161 && code <= 0x1175)
            return vowels[code - 0x1161]!;
        if (code >= 0x11a8 && code <= 0x11c2)
            return trailing[code - 0x11a7]!;
        return c;
    }).join('');
}
export function matchesCommandLetter(data: string, letter: string): boolean {
    // Public SDK matching understands physical base-layout keys in Kitty input.
    if (matchesKey(data, letter as Parameters<typeof matchesKey>[1]))
        return true;
    if (matchesKey(commandEventKeys(data), letter as Parameters<typeof matchesKey>[1]))
        return true;
    return [...data].length === 1 && shortcutPhysicalKey(data) === letter;
}

/** Match host control chords without interpreting ordinary editor text as commands. */
export function matchesHostKey(data: string, key: Parameters<typeof matchesKey>[1]): boolean {
    return matchesKey(normalizeHostKeyEvent(data), key);
}

/** Share explicit modified-key identity with native Pi editors and dialogs. */
export function normalizeHostKeyEvent(data: string): string {
    const normalized = commandEventKeys(data);
    const key = normalized !== data ? parseKey(normalized) : undefined;
    return key && /(?:^|\+)(?:ctrl|alt|super)\+/.test(key) ? normalized : data;
}

/**
 * Fill the missing Dubeolsik identity only when Pi cannot identify the event.
 * Pi still validates the complete CSI-u/modifyOtherKeys sequence and retains
 * modifier, repeat/release and reported physical-layout semantics. Raw Korean
 * input, paste and multi-key syllables never enter this encoded-event bridge.
 */
function commandEventKeys(data: string): string {
    if (parseKey(data) !== undefined)
        return data;
    return data.replace(/^(\x1b\[27;\d+;)(\d+)(?=~$)|^(\x1b\[)(\d+)(?=[:;u])/, (prefix, modified: string | undefined, modifiedCode: string | undefined, csi: string | undefined, code: string | undefined) => {
        const codepoint = Number(code ?? modifiedCode);
        if (codepoint > 0x10ffff)
            return prefix;
        const character = String.fromCodePoint(codepoint);
        const key = shortcutPhysicalKey(character);
        return key ? `${csi ?? modified}${key.codePointAt(0)}` : prefix;
    });
}

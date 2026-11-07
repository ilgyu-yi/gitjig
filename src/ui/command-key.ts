/** Fixed Darwin profile; these chords have reliable control-byte transport.
 * Ctrl+G still belongs to native transcript search while that search is open. */
export const commandKeys = ['ctrl+g', 'ctrl+q', 'ctrl+p'] as const;
export type CommandKey = typeof commandKeys[number];
export const defaultCommandKey: CommandKey = 'ctrl+g';
export function isCommandKey(value: string): value is CommandKey {
    return (commandKeys as readonly string[]).includes(value);
}
export function commandKeyLabel(key: CommandKey): string { return `Ctrl+${key.slice(-1).toUpperCase()}`; }

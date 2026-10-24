import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Preserve installation identity in a copyable restart command; never invoke it here. */
export function restartCommand(home: string, conversation: string, node = process.execPath, entry = fileURLToPath(new URL('../cli/entry.js', import.meta.url)), continuation: readonly string[] = []) {
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    if ([home, conversation, node, entry, ...continuation].some(value => /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)))
        return 'Use the same launcher, application home and conversation. A copyable command is unavailable for control-bearing paths.';
    const payload = dirname(dirname(dirname(entry)));
    const bound = node === join(home, 'bootstrap/node') && dirname(payload) === join(home, 'versions') && /^[a-f0-9]{64}$/.test(basename(payload));
    const command = bound ? quote(join(home, 'gitjig')) : `${quote(node)} ${quote(entry)}`;
    return `${command} conversation ui --home ${quote(home)} --conversation ${quote(conversation)}${continuation.length ? ' ' + continuation.map(quote).join(' ') : ''}`;
}

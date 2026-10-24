import { chooseUiItem } from './choices.js';
import type { HostCommandOutcome } from './host-commands.js';
export interface RecoveryNavigation {
    navigate?(command: string): Promise<HostCommandOutcome>;
}
export interface RecoveryChoiceHost extends RecoveryNavigation {
    choose(title: string, rows: string[]): Promise<string | undefined>;
}
/** Open existing guarded controls only after an explicit, source-bound choice. */
export async function chooseRecoveryEntry(host: RecoveryChoiceHost, fresh: () => void, entries: readonly {
    command: string;
    label: string;
}[]): Promise<HostCommandOutcome | undefined> {
    if (!host.navigate)
        return;
    fresh();
    const command = await chooseUiItem(host, 'Choose a recovery entry', [
        { value: 'back', label: 'Back without action' },
        ...entries.map(entry => ({ value: entry.command, label: entry.label + ' · ' + entry.command })),
    ]);
    fresh();
    if (!command || command === 'back')
        return;
    return host.navigate(command);
}
export function openWorkRecovery(host: RecoveryChoiceHost, workId: string, fresh: () => void) {
    return chooseRecoveryEntry(host, fresh, [{ command: '/work ' + workId, label: 'Open original work recovery and allowances' }]);
}
/** Legacy hosts retain their explicit refusal when they cannot open recovery controls. */
export function chooseHeldWorkRecovery(host: RecoveryChoiceHost, workId: string, fresh: () => void, legacyRefusal: string) {
    if (!host.navigate)
        throw Error(legacyRefusal);
    return openWorkRecovery(host, workId, fresh);
}

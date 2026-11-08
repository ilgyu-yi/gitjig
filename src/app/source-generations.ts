import { join } from 'node:path';
import { readObject, writeObject } from './settings.js';
export function sourceEpoch(directory: string, provider: string): number {
    const values = readObject(join(directory, 'source-generations.json'), true);
    const value = Object.hasOwn(values, provider) ? values[provider] : 0;
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new Error('Invalid application account generation; repair source-generations.json');
    return Number(value);
}
export function advanceSourceEpoch(directory: string, provider: string, assertOwner: () => void): void {
    const file = join(directory, 'source-generations.json'), values = readObject(file, true), next = sourceEpoch(directory, provider) + 1;
    if (!Number.isSafeInteger(next))
        throw new Error('Application account generation exhausted');
    writeObject(file, { ...values, [provider]: next }, assertOwner);
}

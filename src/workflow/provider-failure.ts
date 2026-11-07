/** Recorded provider information for display only; never retry or acceptance authority. */
export interface ProviderUsageLimit {
    version: 1;
    kind: 'usage-limit';
    ownerSessionId: string;
    nativeSessionId: string;
    queryId: string;
    intentEntryId: string;
    eventEntryId: string;
    eventId: string;
    window?: string;
    resetsAt?: number;
}
export function validProviderReset(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value * 1000).getTime());
}
export function providerUsageLimit(value: unknown): ProviderUsageLimit | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const v = value as Record<string, unknown>;
    const ids = ['ownerSessionId', 'nativeSessionId', 'queryId', 'intentEntryId', 'eventEntryId', 'eventId'];
    if (v.version !== 1 || v.kind !== 'usage-limit' ||
        Object.keys(v).some(key => !['version', 'kind', ...ids, 'window', 'resetsAt'].includes(key)) ||
        ids.some(key => typeof v[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(v[key] as string)) ||
        (v.window !== undefined && (typeof v.window !== 'string' || !/^[a-z0-9_]{1,64}$/.test(v.window))) ||
        (v.resetsAt !== undefined && !validProviderReset(v.resetsAt))) return;
    return structuredClone(v) as unknown as ProviderUsageLimit;
}

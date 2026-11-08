/** Requests are bounded; elapsed time alone does not end a governed role.
 * Callers may supply a deadline. Cancellation and owned cleanup stay separate. */
export const defaultRoleBounds = Object.freeze({ timeoutMs: null, maxProviderRequests: 16 });
export const defaultNativeRoleTurns = 16;

/** Host-observed refusal of the next request; display only, never retry authority. */
export interface RoleRequestLimit {
    version: 1;
    kind: 'role-request-limit';
    used: number;
    limit: number;
}
export function roleRequestLimit(value: unknown): RoleRequestLimit | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'kind,limit,used,version' || v.version !== 1 || v.kind !== 'role-request-limit' ||
        !Number.isSafeInteger(v.limit) || (v.limit as number) < 1 || (v.limit as number) > 100 || v.used !== v.limit) return;
    return {version: 1, kind: 'role-request-limit', used: v.used as number, limit: v.limit as number};
}

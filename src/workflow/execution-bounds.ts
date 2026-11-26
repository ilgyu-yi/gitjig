/** Requests are bounded; elapsed time alone does not end a governed role.
 * Callers may supply a deadline. Cancellation and owned cleanup stay separate. */
export const defaultRoleBounds = Object.freeze({ timeoutMs: null, maxProviderRequests: 1000 });
// The owned Claude bridge accepts at most 100 turns per structured query.
export const maxNativeRoleTurns = 100;
export function nativeRoleTurnLimit(providerRequestLimit: number): number {
    return Math.min(providerRequestLimit, maxNativeRoleTurns);
}

export function validProviderRequestLimit(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= defaultRoleBounds.maxProviderRequests;
}

export function configuredProviderRequestLimit(explicit?: number): number {
    const raw = process.env.GITJIG_MAX_PROVIDER_REQUESTS;
    let limit = explicit;
    if (limit === undefined) {
        limit = raw === undefined ? defaultRoleBounds.maxProviderRequests :
            raw.length > 0 && !/[^0-9]/.test(raw) ? Number(raw) : NaN;
    }
    if (!validProviderRequestLimit(limit)) {
        const name = explicit === undefined ? 'GITJIG_MAX_PROVIDER_REQUESTS' : 'maxProviderRequests';
        throw Error(`${name} must be an integer from 1 to ${defaultRoleBounds.maxProviderRequests}`);
    }
    return limit;
}

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
        !validProviderRequestLimit(v.limit) || v.used !== v.limit) return;
    return {version: 1, kind: 'role-request-limit', used: v.limit, limit: v.limit};
}

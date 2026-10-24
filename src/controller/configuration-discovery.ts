import type { Store } from './store.js';
import { validateRepositoryConfigurationTarget } from '../platform/configuration-session.js';
const targetFamily = "json_extract(data,'$.kind') IN ('github-configuration','native-repository-configuration')";
const operationFamily = "json_extract(data,'$.kind')='configuration'";
const phases = ['PREVIEWING', 'PREVIEWED', 'APPLYING', 'PARTIAL', 'CONFIRMED', 'REFUSED', 'UNKNOWN', 'CANCELLED'];
export interface ConfigurationDiscoveryOptions {
    limit?: number;
    before?: string;
    targetId?: string;
}
function scope(store: Store, kind: 'targets' | 'plans', options: ConfigurationDiscoveryOptions) {
    const allowed = kind === 'targets' ? ['limit', 'before'] : ['limit', 'before', 'targetId'], limit = options.limit ?? 50;
    if (Object.keys(options).some(k => !allowed.includes(k)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('Repository discovery requires a limit from 1 to 100 and supported options');
    const table = kind === 'targets' ? 'effect_targets' : 'effect_operations', family = kind === 'targets' ? targetFamily : operationFamily, clauses = [family], values: (string | number)[] = [];
    if (options.targetId !== undefined) {
        if (typeof options.targetId !== 'string' || !store.one(`SELECT id FROM effect_targets WHERE id=? AND ${targetFamily}`, options.targetId))
            throw Error('Repository discovery target is unavailable');
        clauses.push('target=?');
        values.push(options.targetId);
    }
    if (options.before !== undefined) {
        if (typeof options.before !== 'string')
            throw Error('Repository discovery cursor must identify a retained record');
        const cursor = store.one(`SELECT rowid AS position FROM ${table} WHERE id=? AND ${clauses.join(' AND ')}`, options.before, ...values);
        if (!cursor)
            throw Error('Repository discovery cursor is unavailable in this scope; reopen its first page');
        clauses.push('rowid<?');
        values.push(cursor.position);
    }
    return { limit, table, where: clauses.join(' AND '), values };
}
function targetView(data: string, project: unknown) {
    try {
        const parsed = JSON.parse(data);
        if (project !== null || Buffer.byteLength(data) > 16384 || parsed.kind !== (Object.hasOwn(parsed.target, 'provider') ? 'native-repository-configuration' : 'github-configuration'))
            throw Error();
        return { state: 'RETAINED' as const, target: validateRepositoryConfigurationTarget(parsed.target) };
    }
    catch {
        return { state: 'UNAVAILABLE' as const, reason: 'Retained configuration target is malformed or unsupported; inspect the original record before dispatch' };
    }
}
/** Pure retained ledger reads: never instantiate configuration recovery or refresh permission. */
export function inspectConfigurationTarget(store: Store, targetId: string) {
    if (typeof targetId !== 'string' || !targetId || targetId.length > 200)
        throw Error('Retained repository target identity required');
    const row = store.one(`SELECT id,project,substr(data,1,16385) AS data FROM effect_targets WHERE id=? AND ${targetFamily}`, targetId);
    if (!row)
        throw Error('Retained repository target unavailable; reopen registered targets');
    return { targetId: row.id, ...targetView(row.data, row.project) };
}
export function listConfigurationTargets(store: Store, options: ConfigurationDiscoveryOptions = {}) {
    const s = scope(store, 'targets', options), rows = store.all(`SELECT id,project,substr(data,1,16385) AS data FROM ${s.table} WHERE ${s.where} ORDER BY rowid DESC LIMIT ?`, ...s.values, s.limit + 1);
    return { targets: rows.slice(0, s.limit).map(row => ({ targetId: row.id, ...targetView(row.data, row.project) })), nextCursor: rows.length > s.limit ? rows[s.limit - 1]!.id : null };
}
export function listConfigurationPlans(store: Store, options: ConfigurationDiscoveryOptions = {}) {
    const s = scope(store, 'plans', options), rows = store.all(`SELECT id,work,target,phase,json_extract(data,'$.revision') AS revision,substr(json_extract(data,'$.nextAction'),1,1025) AS nextAction FROM ${s.table} WHERE ${s.where} ORDER BY rowid DESC LIMIT ?`, ...s.values, s.limit + 1);
    return { plans: rows.slice(0, s.limit).map(row => {
            const target = store.one(`SELECT project,substr(data,1,16385) AS data FROM effect_targets WHERE id=? AND ${targetFamily}`, row.target), identity = target ? targetView(target.data, target.project) : { state: 'UNAVAILABLE' as const, reason: 'Original configuration target unavailable' };
            const base = { planId: row.id, workId: row.work, targetId: row.target };
            const work = store.one("SELECT w.project,json_extract(w.data,'$.kind') AS kind,json_extract(w.data,'$.operationId') AS operationId,json_extract(s.origin,'$.kind') AS sourceKind,json_extract(s.origin,'$.operationId') AS sourceOperation FROM works w JOIN sources s ON s.id=w.source WHERE w.id=?", row.work);
            if (identity.state === 'UNAVAILABLE' || !work || work.project !== null || work.kind !== 'repository-configuration' || work.operationId !== row.id || work.sourceKind !== 'owner-repository-configuration' || work.sourceOperation !== row.id || !phases.includes(row.phase) || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.nextAction !== 'string' || row.nextAction.length > 1024)
                return { ...base, state: 'UNAVAILABLE' as const, reason: identity.state === 'UNAVAILABLE' ? identity.reason : 'Retained configuration metadata is malformed or unsupported; inspect the original operation' };
            return { ...base, state: 'RETAINED' as const, target: identity.target, recordedPhase: row.phase, revision: row.revision, nextAction: row.nextAction };
        }), nextCursor: rows.length > s.limit ? rows[s.limit - 1]!.id : null };
}

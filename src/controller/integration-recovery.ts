import type { Store } from './store.js';
import type { EffectsProfile } from './effect-types.js';
import { hash } from './change-files.js';
/** Bounded owner read context; does not admit a producer or repair cleanup. */
export function integrationReadContext(store: Store, id: string, busy: boolean, capacityRoom: boolean, gitProfile: EffectsProfile | undefined, preparation = false) {
    const op = store.one('SELECT * FROM effect_operations WHERE id=?', id), data = JSON.parse(op.data), work = store.one('SELECT id,source,lineage,state,epoch,generation FROM works WHERE id=?', op.work);
    const budget = work && store.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', work.lineage, 'execution');
    if (!work || !budget || ![budget.limit, budget.consumed, budget.reserved].every(n => Number.isSafeInteger(n) && n >= 0) || budget.consumed + budget.reserved > budget.limit)
        throw Error('Original integration allowance unavailable');
    const format = data.kind === 'github-existing-ref' ? 'sha1' : JSON.parse(store.one('SELECT data FROM effect_targets WHERE id=?', op.target).data).target.objectFormat, oid = (v: unknown) => typeof v === 'string' && new RegExp('^[a-f0-9]{' + (format === 'sha256' ? 64 : 40) + '}$').test(v);
    if (!preparation && (!oid(data.expectedBase) || !oid(data.integrationCommit)))
        throw Error('Original integration commits unavailable for read reconciliation');
    const size = store.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM runs WHERE work=?', work.id);
    if (size.count > 128 || size.bytes > 1048576 || size.largest > 65536)
        throw Error('Bounded original integration producer history unavailable');
    const runs = store.all('SELECT id,phase,reservation,staging,data FROM runs WHERE work=? ORDER BY rowid', work.id).map(row => ({ ...row, value: JSON.parse(row.data) }));
    const leases = store.all('SELECT id,run,state FROM capacity_leases WHERE work=? ORDER BY sequence LIMIT 129', work.id);
    if (leases.length > 128)
        throw Error('Bounded original capacity history unavailable');
    const isolated = data.kind === 'github-existing-ref' && work.state === 'UNKNOWN' && op.phase === 'UNKNOWN';
    const originals = isolated ? runs.filter(row => row.phase === 'UNKNOWN' && row.value.kind === 'native-effect' && row.value.readOnlyObservation !== true && row.value.retainedIntegrationRead !== true && row.value.operationId === id && row.value.cleanup === 'quarantined' && row.staging === data.clientRoot && leases.some(lease => lease.run === row.id && lease.state === 'QUARANTINED')) : [];
    const candidate = originals.length === 1 ? originals[0] : undefined, originalLeases = candidate ? leases.filter(lease => lease.run === candidate.id && lease.state === 'QUARANTINED') : [], original = candidate && originalLeases.length === 1 && candidate.value.capacityId === originalLeases[0].id ? candidate : undefined, originalLease = original ? originalLeases[0] : undefined, reasons: string[] = [];
    if (busy)
        reasons.push('Original integration producer is active');
    if (!['ACTIVE', 'DELIVERED'].includes(work.state) && !original)
        reasons.push('Recover original work/cleanup explicitly before this read; cancelled, interrupted and unsupported local quarantine work cannot be revived here');
    if (isolated && !capacityRoom)
        reasons.push('Independent observation capacity unavailable; original quarantine remains held');
    if (budget.reserved !== 0)
        reasons.push('Original execution allowance has an unsettled reservation');
    for (const row of runs) {
        if (row.id === original?.id)
            continue;
        const cleanup = row.value?.cleanup;
        if (!['SETTLED', 'INTERRUPTED'].includes(row.phase) || !['consumed', 'released'].includes(row.reservation) || typeof cleanup === 'string' && (/quarantined/u.test(cleanup) || ['unknown', 'unavailable'].includes(cleanup)))
            reasons.push('Original run ' + row.id + ' requires settlement/cleanup');
    }
    for (const lease of leases)
        if (!['RELEASED', 'CANCELLED'].includes(lease.state) && !(original && lease.id === originalLease?.id && lease.run === original.id && lease.state === 'QUARANTINED'))
            reasons.push('Original capacity ' + lease.id + ' requires settlement/cleanup');
    const source = store.one('SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin,CASE WHEN length(CAST(raw AS BLOB))<=1048576 THEN raw ELSE NULL END AS raw FROM sources WHERE id=?', work.source);
    if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
        throw Error('Bounded original work source unavailable');
    const context = { operationId: id, workId: work.id, targetId: op.target, phase: op.phase, family: data.kind ?? 'local-git', expectedBase: data.expectedBase as string, integrationCommit: data.integrationCommit as string, workState: work.state as string, epoch: work.epoch as number, generation: work.generation as number, lineage: work.lineage as string, execution: budget as {
            limit: number;
            consumed: number;
            reserved: number;
        }, mode: original ? 'isolated-hosted-observation' : 'original-read', originalQuarantinedRun: original?.id ?? null, originalQuarantinedCapacity: originalLease?.id ?? null, capacityRoom, holds: reasons, gitProfile: gitProfile ? structuredClone(gitProfile) : null };
    const fingerprint = hash({ context, operation: op, work, source, runs: runs.map(({ value, ...row }) => row), leases, target: store.one('SELECT data FROM effect_targets WHERE id=?', op.target), grant: store.one('SELECT data FROM effect_delegations WHERE id=?', op.grant_id) });
    return { ...context, fingerprint };
}

/** Evidence fields already used by governed/native recovery to distinguish
 * a never-allocated producer from an attempt requiring original cleanup. */
const allocationFlags = ['attainedCapture', 'allocatedNative', 'attainedNative', 'modelDispatchAttempted', 'nativeInputObserved', 'nativeClientInitialized'] as const;
const allocationRecords = ['manifest', 'containerId', 'historyRef', 'nativeSessionId', 'nativeCheckpoint'] as const;
export function hasNoAllocatedProducer(data: Record<string, unknown>): boolean {
    return allocationFlags.every(key => data[key] === undefined || data[key] === null || data[key] === false) &&
        allocationRecords.every(key => data[key] === undefined || data[key] === null);
}
const unallocatedProducerSql = (column: string) => [
    ...allocationFlags.map(key => `COALESCE(json_type(${column},'$.${key}'),'null') IN ('null','false')`),
    ...allocationRecords.map(key => `json_extract(${column},'$.${key}') IS NULL`),
].join(' AND ');
/** Shared proof for historical queue refunds. Cancelled/released labels alone
 * do not establish cleanup. Admitted producers retain their family-specific
 * cleanup/recovery rules in their original consumers. Parameter: original work. */
export const cancelledCapacitySettlement = `WITH cancelled AS (
                SELECT r.id AS run,c.id AS lease FROM runs r JOIN capacity_leases c ON c.run=r.id AND c.work=r.work AND c.epoch=r.epoch
                WHERE r.work=? AND r.phase IN ('SETTLED','INTERRUPTED') AND r.reservation='released' AND c.state='CANCELLED'
                AND CASE WHEN json_valid(r.data) AND json_valid(c.data) THEN
                    json_extract(r.data,'$.admission')='never-admitted' AND json_extract(r.data,'$.capacityId')=c.id
                    AND (json_extract(r.data,'$.cleanup')='not-allocated' OR
                        json_extract(r.data,'$.cleanup')='unbound' AND json_extract(r.data,'$.kind')='publication-judgment' AND json_type(r.data,'$.unbound')='true') AND json_type(c.data,'$.admitted')='false'
                    AND ${unallocatedProducerSql('r.data')} ELSE 0 END
            )`;

import { parseUniqueJson } from '../workflow/json.js';

export type ProducerEvidenceView = 'exact' | 'semantic-v2' | 'formatter-v4' | 'formatter-v5' | 'formatter-v7' | 'formatter-v8' | 'formatter-v9';

/** Receipt recipes, not permission to accept a producer. Callers still bind the
 * complete run, output, history and stored receipt hashes. */
export function producerEvidence(row: Record<string, unknown> | null | undefined, view: ProducerEvidenceView): unknown {
    if (!row || view === 'exact') return row;
    if (typeof row.data !== 'string') throw Error('Producer metadata unavailable');
    const parsed = parseUniqueJson(row.data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Producer metadata unavailable');
    const data = parsed as Record<string, unknown>;
    if (view === 'semantic-v2') {
        const { materialAccounting, ...evidence } = data;
        return { ...row, data: evidence };
    }
    if (view !== 'formatter-v4' && view !== 'formatter-v5' && view !== 'formatter-v7' && view !== 'formatter-v8' && view !== 'formatter-v9') throw Error('Unsupported producer evidence view');
    // Reconstruct only known formatter cache versions. Keeping the original
    // string representation here is essential for exact legacy hash equality.
    const target = view === 'formatter-v4' ? 4 : view === 'formatter-v5' ? 5 : view === 'formatter-v7' ? 7 : view === 'formatter-v8' ? 8 : 9;
    const cache = data.materialAccounting as Record<string, unknown> | null | undefined;
    if (!cache || typeof cache !== 'object' || Array.isArray(cache) ||
        !(cache.version === 10 || cache.version === 9 && target < 9 || cache.version === 8 && target < 8 || cache.version === 7 && target < 7 || cache.version === 5 && target === 4)) return row;
    if (Object.keys(cache).sort().join(',') !== 'claimsDigest,historyIdentity,nativeSessionId,originalCheckpoint,producerDigest,version')
        throw Error('Unsupported historical accounting cache');
    return { ...row, data: JSON.stringify({ ...data, materialAccounting: { ...cache, version: target } }) };
}

import { historicalGrantRoot } from './historical-grant.js';
import type { Store } from './store.js';
import type { PublicationView } from './publication-types.js';
import { sealPublicationPayload, validatePublicationTargetPolicy } from '../platform/github-publication.js';
const prefix = `WITH catalogue AS (SELECT rowid AS position,id,work,target,grant_id,phase,
 CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data,
 CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS family,
 (SELECT CASE WHEN length(CAST(t.data AS BLOB))<=131072 AND json_valid(t.data) THEN json_extract(t.data,'$.kind') ELSE NULL END FROM effect_targets t WHERE t.id=effect_operations.target) AS targetFamily,
 (SELECT CASE WHEN length(CAST(g.data AS BLOB))<=65536 AND json_valid(g.data) THEN json_extract(g.data,'$.kind') ELSE NULL END FROM effect_delegations g WHERE g.id=effect_operations.grant_id) AS grantFamily FROM effect_operations)`;
const scope = "COALESCE((family='configuration' AND targetFamily IN ('github-configuration','native-repository-configuration') AND grantFamily='configuration') OR (family='local-git' AND targetFamily='local-git' AND grantFamily='local-git') OR (family='github-existing-ref' AND targetFamily='github-existing-ref' AND grantFamily='github-existing-ref'),0)=0";
const json = (value: unknown) => {
    if (typeof value !== 'string')
        throw Error('Unavailable bounded data');
    return JSON.parse(value);
};
/** Historical correspondence only. Current authority/eligibility and recovery remain separate. */
export function retainedPublication(store: Store, id: string, inspect: (id: string) => PublicationView) {
    const row = store.one(prefix + ' SELECT * FROM catalogue WHERE id=? AND ' + scope, id);
    if (!row)
        throw Error('Original publication or unavailable-family operation not found');
    const unavailable = { state: 'UNAVAILABLE' as const, operationId: row.id as string, workId: row.work as string, targetId: row.target as string, reason: 'Retained publication identity, bounded evidence or operation family unavailable; original records were kept' };
    try {
        const data = json(row.data), targetRow = store.one('SELECT id,project,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM effect_targets WHERE id=?', row.target), target = json(targetRow?.data);
        const grantRow = store.one('SELECT id,root,target,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM effect_delegations WHERE id=?', row.grant_id), grant = json(grantRow?.data);
        const work = store.one('SELECT id,project,source FROM works WHERE id=?', row.work);
        if (data.kind !== 'publication' || target.kind !== 'github-publication' || grant.kind !== 'publication' || grantRow.target !== row.target || !work || !store.one('SELECT id FROM sources WHERE id=?', work.source) ||
            JSON.stringify(data.target) !== JSON.stringify(target.target) || data.visibility !== target.visibility || !['public', 'private'].includes(target.visibility) || !['PREPARED', 'RESERVED', 'INVOKING', 'CONFIRMED', 'REFUSED', 'UNKNOWN'].includes(row.phase))
            throw Error('Contradictory original publication');
        validatePublicationTargetPolicy(target.target, target.carrierPolicy);
        const action = data.action?.kind === 'create-comment' ? 'create-comment:' + data.action.purpose : data.action?.kind;
        if (!Array.isArray(grant.actions) || !grant.actions.includes(action) || !Array.isArray(grant.projectIds) || !grant.projectIds.includes(work.project ?? null))
            throw Error('Original grant correspondence unavailable');
        historicalGrantRoot(store, row.work, grantRow.root, grant.scope);
        const sealed = sealPublicationPayload({ operationId: row.id, target: data.target, action: data.action, carrierPolicy: data.carrierPolicy });
        if (sealed.payloadHash !== data.payloadHash || typeof data.payloadBase64 !== 'string' || Buffer.from(data.payloadBase64, 'base64').toString('base64') !== data.payloadBase64 || !Buffer.from(data.payloadBase64, 'base64').equals(Buffer.from(sealed.payloadUtf8)))
            throw Error('Original payload correspondence unavailable');
        // Bound every collection consumed by the original inspector before transferring/parsing rows.
        const collections = [
            ['effect_receipts', 'operation=?', [row.id]], ['role_launches', 'work=?', [row.work]], ['finding_occurrences', 'work=?', [row.work]], ['obligations', 'work=? OR id IN (SELECT id FROM finding_occurrences WHERE work=?)', [row.work, row.work]],
            ['role_outputs', 'launch IN (SELECT id FROM role_launches WHERE work=?)', [row.work]],
            ['finding_dispositions', 'occurrence IN (SELECT id FROM finding_occurrences WHERE work=?)', [row.work]],
        ] as const;
        for (const [table, where, values] of collections) {
            const size = store.one(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM ${table} WHERE ${where}`, ...values);
            if (size.count > 256 || size.bytes > 2097152 || size.largest > 1048576)
                throw Error('Bounded original inspection unavailable');
        }
        if (store.one('SELECT id FROM obligations WHERE id IN (SELECT id FROM finding_occurrences WHERE work=?) AND work<>? LIMIT 1', row.work, row.work))
            throw Error('Foreign finding obligation unavailable');
        // Reject cross-work references before the inspector follows IDs embedded in findings/obligations.
        for (const finding of store.all('SELECT output,data FROM finding_occurrences WHERE work=?', row.work)) {
            const value = json(finding.data), output = store.one('SELECT launch FROM role_outputs WHERE id=?', finding.output), launch = output && store.one('SELECT work FROM role_launches WHERE id=?', output.launch);
            if (!launch || launch.work !== row.work || value.launchId !== output.launch)
                throw Error('Finding provenance unavailable');
        }
        for (const obligation of store.all('SELECT data FROM obligations WHERE work=?', row.work)) {
            const value = json(obligation.data);
            if (value.occurrence && !store.one('SELECT id FROM finding_occurrences WHERE id=? AND work=?', value.occurrence, row.work) || value.launchId && !store.one('SELECT id FROM role_launches WHERE id=? AND work=?', value.launchId, row.work))
                throw Error('Obligation provenance unavailable');
        }
        const view = inspect(row.id);
        if (view.operationId !== row.id || view.workId !== row.work || view.targetId !== row.target || view.phase !== row.phase || view.payloadHash !== data.payloadHash || typeof view.nextAction !== 'string' || view.nextAction.length > 4096)
            throw Error('Inspection correspondence unavailable');
        return { entry: { state: 'RETAINED' as const, operationId: row.id as string, workId: row.work as string, targetId: row.target as string, projectId: (work.project ?? null) as string | null, target: target.target as import('../platform/github-publication.js').PublicationTarget,
                recordedPhase: view.phase, action: view.action, purpose: view.purpose, payloadHash: view.payloadHash, transportOutcome: view.transportOutcome, observedOutcome: view.observedOutcome, nextAction: view.nextAction }, view };
    }
    catch {
        return { entry: unavailable, view: undefined };
    }
}
export function listRetainedPublications(store: Store, options: {
    limit?: number;
    before?: string;
}, inspect: (id: string) => PublicationView) {
    if (Object.keys(options).some(key => !['limit', 'before'].includes(key)))
        throw Error('Unknown publication-list option');
    const limit = options.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('Publication-list limit must be between1 and100');
    let position = Number.MAX_SAFE_INTEGER;
    if (options.before !== undefined) {
        const cursor = store.one(prefix + ' SELECT position FROM catalogue WHERE id=? AND ' + scope, options.before);
        if (!cursor)
            throw Error('Unknown publication-list cursor; reopen the first page');
        position = cursor.position;
    }
    const rows = store.all(prefix + ' SELECT id FROM catalogue WHERE ' + scope + ' AND position<? ORDER BY position DESC LIMIT ?', position, limit + 1);
    return { scope: 'Retained GitHub publications and unavailable-family records; no recovery, current authority or dispatch', operations: rows.slice(0, limit).map(row => retainedPublication(store, row.id, inspect).entry), nextCursor: rows.length > limit ? rows[limit - 1]!.id as string : null };
}

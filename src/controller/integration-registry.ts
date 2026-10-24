import { isAbsolute } from 'node:path';
import type { Store } from './store.js';
import type { EffectView } from './effect-types.js';
import { historicalGrantRoot } from './historical-grant.js';
export const integrationCatalogueSql = `WITH catalogue AS (SELECT rowid AS position,id,work,target,grant_id,phase,
 CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data,
 CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS family,
 (SELECT CASE WHEN length(CAST(t.data AS BLOB))<=131072 AND json_valid(t.data) THEN json_extract(t.data,'$.kind') ELSE NULL END FROM effect_targets t WHERE t.id=effect_operations.target) AS targetFamily,
 (SELECT CASE WHEN length(CAST(g.data AS BLOB))<=65536 AND json_valid(g.data) THEN json_extract(g.data,'$.kind') ELSE NULL END FROM effect_delegations g WHERE g.id=effect_operations.grant_id) AS grantFamily FROM effect_operations)`;
export const integrationScopeSql = "COALESCE((family='configuration' AND targetFamily IN ('github-configuration','native-repository-configuration') AND grantFamily='configuration') OR (family='publication' AND targetFamily='github-publication' AND grantFamily='publication'),0)=0";
const prefix = integrationCatalogueSql, scope = integrationScopeSql + " AND COALESCE(family='github-merge' AND targetFamily='github-merge' AND grantFamily='github-merge',0)=0";
const json = (value: unknown) => {
    if (typeof value !== 'string')
        throw Error('Unavailable bounded data');
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw Error('Unavailable object');
    return parsed;
};
const phases = ['PREPARED', 'REFRESHED', 'RESERVED', 'INVOKING', 'CONFIRMED', 'REFUSED', 'UNKNOWN'];
const finite = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(value);
/** Recorded correspondence only: no filesystem, credential, eligibility or native-client reads. */
export function retainedIntegration(store: Store, id: string, inspect: (id: string) => EffectView) {
    const row = store.one(prefix + ' SELECT * FROM catalogue WHERE id=? AND ' + scope, id);
    if (!row)
        throw Error('Original integration or unavailable-family operation not found');
    const unavailable = { state: 'UNAVAILABLE' as const, operationId: row.id as string, workId: row.work as string, targetId: row.target as string, reason: 'Retained integration identity, bounded evidence or operation family unavailable; original records were kept' };
    try {
        const data = json(row.data), targetRow = store.one('SELECT project,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM effect_targets WHERE id=?', row.target), target = json(targetRow?.data), grantRow = store.one('SELECT root,target,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM effect_delegations WHERE id=?', row.grant_id), grant = json(grantRow?.data), family = data.kind ?? 'local-git';
        if (!['local-git', 'github-existing-ref'].includes(family) || (target.kind ?? 'local-git') !== family || (grant.kind ?? 'local-git') !== family || grantRow.target !== row.target || !phases.includes(row.phase))
            throw Error('Integration family mismatch');
        const work = store.one('SELECT project,source FROM works WHERE id=?', row.work);
        if (!work || !store.one('SELECT id FROM sources WHERE id=?', work.source) || targetRow.project !== grant.projectId || !['work', 'delegation-lineage'].includes(grant.scope) || work.project !== targetRow.project || !['ordinary', ...(family === 'github-existing-ref' ? ['owner-override'] : [])].includes(grant.mode))
            throw Error('Original project/grant mismatch');
        historicalGrantRoot(store, row.work, grantRow.root, grant.scope);
        const endpoint = target.target;
        if (!endpoint || !finite(endpoint.ref) || !endpoint.ref.startsWith('refs/heads/'))
            throw Error('Original branch unavailable');
        const format = family === 'local-git' ? endpoint.objectFormat : 'sha1', oid = (value: unknown) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + (format === 'sha256' ? 64 : 40) + '}$').test(value);
        if (family === 'local-git') {
            if (!['sha1', 'sha256'].includes(format) || endpoint.targetId !== row.target || !finite(endpoint.canonicalPath) || !isAbsolute(endpoint.canonicalPath) || !finite(endpoint.device) || !finite(endpoint.inode) || !Number.isSafeInteger(endpoint.ownerUid))
                throw Error('Original local identity unavailable');
        }
        else {
            const repo = target.repository;
            if (endpoint.host !== 'github.com' || !repo || !finite(endpoint.owner) || !finite(endpoint.repository) || !Number.isSafeInteger(endpoint.repositoryId) || endpoint.repositoryId <= 0 || !finite(endpoint.repositoryNodeId) || endpoint.repositoryId !== repo.repositoryId || endpoint.repositoryNodeId !== repo.repositoryNodeId || endpoint.owner !== repo.owner || endpoint.repository !== repo.repository || !Number.isSafeInteger(target.expectedUserId) || target.expectedUserId <= 0)
                throw Error('Original hosted identity unavailable');
        }
        if (!oid(target.basisCommit) || data.evidence?.workId !== row.work || !finite(data.evidence?.versions?.candidate))
            throw Error('Original evidence/commit unavailable');
        for (const field of ['expectedBase', 'headCommit', 'integrationCommit'])
            if (data[field] != null && !oid(data[field]))
                throw Error('Recorded commit malformed');
        const size = store.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM effect_receipts WHERE operation=?', row.id);
        if (size.count > 256 || size.bytes > 2097152 || size.largest > 1048576)
            throw Error('Bounded original receipts unavailable');
        // Parse every bounded receipt so malformed hidden rows cannot look like a healthy original.
        for (const receipt of store.all('SELECT kind,data FROM effect_receipts WHERE operation=?', row.id)) {
            const value = JSON.parse(receipt.data);
            if (['send', 'readback', 'reconciliation'].includes(receipt.kind)) {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw Error('Malformed consumed receipt');
                if (receipt.kind === 'send' && (value.operationId !== row.id || !['not-started', 'started'].includes(value.handoff) || !['native-success', 'native-rejection', 'uncertain'].includes(value.transport)))
                    throw Error('Malformed send receipt');
                if (receipt.kind !== 'send') {
                    if (!['contains-integration', 'unknown'].includes(value.kind) || value.targetCommit !== null && !oid(value.targetCommit) || !Array.isArray(value.commands))
                        throw Error('Malformed containment observation');
                    if (value.kind === 'contains-integration' && (!oid(value.targetCommit) || !oid(data.integrationCommit)))
                        throw Error('Missing integration containment operands');
                    if (value.integrationCommit !== undefined && value.integrationCommit !== data.integrationCommit)
                        throw Error('Foreign integration observation');
                }
            }
        }
        const view = inspect(row.id);
        if (view.workId !== row.work || view.targetId !== row.target || view.operationId !== row.id || view.phase !== row.phase || typeof view.nextAction !== 'string' || view.nextAction.length > 4096 || !Array.isArray(view.blocked) || view.blocked.some(value => typeof value !== 'string') || ![null, 'not-started', 'native-success', 'native-rejection', 'uncertain'].includes(view.transportOutcome) || !['contains-integration', 'not-observed', 'unknown'].includes(view.observedOutcome))
            throw Error('Original inspection mismatch');
        return { entry: { state: 'RETAINED' as const, operationId: row.id as string, workId: row.work as string, targetId: row.target as string, projectId: work.project as string | null, family: family as 'local-git' | 'github-existing-ref', ref: endpoint.ref as string, endpoint: family === 'local-git' ? endpoint.canonicalPath as string : `${endpoint.owner}/${endpoint.repository}`, recordedPhase: view.phase, transportOutcome: view.transportOutcome, observedOutcome: view.observedOutcome, nextAction: view.nextAction }, view };
    }
    catch {
        return { entry: unavailable, view: undefined };
    }
}
export function listRetainedIntegrations(store: Store, options: {
    limit?: number;
    before?: string;
}, inspect: (id: string) => EffectView) {
    if (Object.keys(options).some(key => !['limit', 'before'].includes(key)))
        throw Error('Unknown integration-list option');
    const limit = options.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('Integration-list limit must be between1 and100');
    let position = Number.MAX_SAFE_INTEGER;
    if (options.before !== undefined) {
        const cursor = store.one(prefix + ' SELECT position FROM catalogue WHERE id=? AND ' + scope, options.before);
        if (!cursor)
            throw Error('Unknown integration-list cursor; reopen the first page');
        position = cursor.position;
    }
    const rows = store.all(prefix + ' SELECT id FROM catalogue WHERE ' + scope + ' AND position<? ORDER BY position DESC LIMIT ?', position, limit + 1);
    return { scope: 'Retained branch integrations and unavailable-family records; no recovery, current authority, send or hosted PR closure', operations: rows.slice(0, limit).map(row => retainedIntegration(store, row.id, inspect).entry), nextCursor: rows.length > limit ? rows[limit - 1]!.id as string : null };
}

import path from 'node:path';
import type { Store } from './store.js';
export interface IntegrationTargetPage {
    limit?: number;
    before?: string;
}
const catalogue = `WITH targets AS (SELECT rowid AS position,id,project,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data,CASE WHEN length(CAST(data AS BLOB))<=131072 AND json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS family FROM effect_targets)`;
const scope = "COALESCE(family IN ('github-configuration','native-repository-configuration','github-publication') AND project IS NULL,0)=0 AND COALESCE(family='github-merge',0)=0";
const literal = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(v);
function view(store: Store, row: any) {
    const unavailable = { state: 'UNAVAILABLE' as const, targetId: row.id as string, projectId: row.project as string | null, reason: 'Original bounded integration target identity unavailable; record retained without repair' };
    try {
        if (typeof row.data !== 'string' || !literal(row.project) || !store.one('SELECT id FROM projects WHERE id=?', row.project))
            throw Error();
        const data = JSON.parse(row.data), target = data.target, family = data.kind ?? 'local-git';
        if (!['local-git', 'github-existing-ref'].includes(family) || !target || !literal(target.ref) || !target.ref.startsWith('refs/heads/'))
            throw Error();
        const keys = family === 'local-git' ? ['kind', 'target', 'basisCommit', 'publicationInventory', 'authorizedDeltaPaths', 'ownerUid'] : ['kind', 'target', 'repository', 'expectedUserId', 'basisCommit', 'publicationInventory', 'authorizedDeltaPaths'];
        if (Object.keys(data).some(key => !keys.includes(key)))
            throw Error();
        const oid = family === 'local-git' && target.objectFormat === 'sha256' ? 64 : 40;
        if (typeof data.basisCommit !== 'string' || !new RegExp('^[a-f0-9]{' + oid + '}$').test(data.basisCommit))
            throw Error();
        for (const list of [data.publicationInventory, data.authorizedDeltaPaths])
            if (!Array.isArray(list) || !list.length || list.length > 100000 || new Set(list).size !== list.length || list.some(p => !literal(p) || p.startsWith('/') || p.includes('\\') || p.split('/').some((part: string) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')))
                throw Error();
        if (data.authorizedDeltaPaths.some((p: string) => !data.publicationInventory.includes(p)))
            throw Error();
        if (family === 'local-git') {
            if (target.targetId !== row.id || !literal(target.canonicalPath) || !path.isAbsolute(target.canonicalPath) || !literal(target.device) || !literal(target.inode) || !Number.isSafeInteger(target.ownerUid) || target.ownerUid < 0 || data.ownerUid !== target.ownerUid || !['sha1', 'sha256'].includes(target.objectFormat) || Object.keys(target).some(key => !['targetId', 'canonicalPath', 'device', 'inode', 'ownerUid', 'objectFormat', 'ref'].includes(key)))
                throw Error();
        }
        else {
            const r = data.repository;
            if (target.host !== 'github.com' || !r || !literal(target.owner) || !literal(target.repository) || !Number.isSafeInteger(target.repositoryId) || target.repositoryId < 1 || !literal(target.repositoryNodeId) || r.owner !== target.owner || r.repository !== target.repository || r.repositoryId !== target.repositoryId || r.repositoryNodeId !== target.repositoryNodeId || !['public', 'private'].includes(r.visibility) || !Number.isSafeInteger(data.expectedUserId) || data.expectedUserId < 1 || Object.keys(target).some(key => !['host', 'repositoryId', 'repositoryNodeId', 'owner', 'repository', 'ref'].includes(key)) || Object.keys(r).some(key => !['owner', 'repository', 'repositoryId', 'repositoryNodeId', 'visibility'].includes(key)))
                throw Error();
        }
        return { state: 'RETAINED' as const, targetId: row.id as string, projectId: row.project as string, family: family as 'local-git' | 'github-existing-ref', ref: target.ref as string, configuration: data };
    }
    catch {
        return unavailable;
    }
}
export function inspectIntegrationTarget(store: Store, id: string) {
    if (!literal(id))
        throw Error('Original integration target ID required');
    const row = store.one(catalogue + ' SELECT * FROM targets WHERE id=? AND ' + scope, id);
    if (!row)
        throw Error('Original integration target not found');
    return view(store, row);
}
export function listIntegrationTargets(store: Store, options: IntegrationTargetPage = {}) {
    const limit = options.limit ?? 25;
    if (Object.keys(options).some(key => !['limit', 'before'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw Error('Integration target discovery requires limit1..100 and a retained cursor');
    let position: number | undefined;
    if (options.before !== undefined) {
        if (!literal(options.before))
            throw Error('Original integration target cursor required');
        const row = store.one(catalogue + ' SELECT position FROM targets WHERE id=? AND ' + scope, options.before);
        if (!row)
            throw Error('Integration target cursor unavailable; reopen the first page');
        position = row.position;
    }
    const rows = store.all(catalogue + ' SELECT * FROM targets WHERE ' + scope + (position === undefined ? '' : ' AND position<?') + ' ORDER BY position DESC LIMIT ?', ...position === undefined ? [] : [position], limit + 1);
    return { targets: rows.slice(0, limit).map(row => view(store, row)), nextCursor: rows.length > limit ? rows[limit - 1].id as string : null };
}

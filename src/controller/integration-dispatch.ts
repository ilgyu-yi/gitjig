import type { Store } from './store.js';
import { hash } from './change-files.js';
/** Frozen send operands. Excludes the attempt's own run/reservation/client bookkeeping. */
export function integrationSendReview(store: Store, id: string, preparation = false) {
    const op = store.one('SELECT id,work,target,grant_id,phase,CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data FROM effect_operations WHERE id=?', id);
    if (!op || typeof op.data !== 'string')
        throw Error('Bounded original integration unavailable');
    const data = JSON.parse(op.data);
    if (!(preparation ? ['PREPARED', 'REFRESHED', 'REFUSED', 'RESERVED'] : ['RESERVED']).includes(op.phase) || Object.hasOwn(data, 'dispatchRun') || store.one("SELECT id FROM effect_receipts WHERE operation=? AND kind='send' LIMIT 1", id))
        throw Error(preparation ? 'Only an unsent original can use reviewed preparation; reconcile possible transmission first' : 'Only an unsent RESERVED original can use reviewed sending; inspect original reconciliation/preparation instead');
    const targetRow = store.one('SELECT project,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM effect_targets WHERE id=?', op.target), grant = store.one('SELECT id,root,target,epoch,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM effect_delegations WHERE id=?', op.grant_id);
    if (!targetRow || typeof targetRow.data !== 'string' || !grant || typeof grant.data !== 'string')
        throw Error('Bounded original integration target/grant unavailable');
    const target = JSON.parse(targetRow.data);
    const work = (key: string) => {
        const row = store.one('SELECT id,project,source,epoch,generation,CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data FROM works WHERE id=?', key);
        if (!row || typeof row.data !== 'string')
            throw Error('Bounded original integration work unavailable');
        const source = store.one('SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin,CASE WHEN length(CAST(raw AS BLOB))<=1048576 THEN raw ELSE NULL END AS raw FROM sources WHERE id=?', row.source);
        if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
            throw Error('Bounded original integration source unavailable');
        return { id: row.id, projectId: row.project, sourceId: row.source, epoch: row.epoch, generation: row.generation, workFingerprint: hash(row.data), sourceFingerprint: hash(source) };
    };
    const reviewed = { operationId: id, work: work(op.work), targetId: op.target, targetProjectId: targetRow.project, target, grant: { ...grant, data: JSON.parse(grant.data) }, ownerRoot: work(grant.root), expectedBase: data.expectedBase, headCommit: data.headCommit, integrationCommit: data.integrationCommit, evidence: data.evidence, origin: data.origin ?? null, ownerRootAuthority: data.ownerRoot ?? null, subjectContextFingerprint: data.subjectContextFingerprint ?? null, authorityPolicyFingerprint: data.authority?.policy?.fingerprint ?? null };
    return { reviewed, fingerprint: hash(reviewed) };
}

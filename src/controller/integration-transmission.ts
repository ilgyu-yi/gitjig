import type { Store } from './store.js';
import { inspectIntegrationTarget } from './integration-targets.js';
import { integrationCatalogueSql, integrationScopeSql } from './integration-registry.js';
/** A refused original whose latest well-formed send receipt proves no transmission is resolved; same predicate as Effects.canRenew. */
const definitelyUnsent = `(SELECT COUNT(*)<=256 AND COALESCE(SUM(length(CAST(data AS BLOB))),0)<=2097152 FROM effect_receipts WHERE operation=c.id) AND COALESCE((SELECT CASE WHEN length(CAST(r.data AS BLOB))<=1048576 AND json_valid(r.data) AND json_type(r.data)='object' AND json_extract(r.data,'$.operationId')=c.id AND json_extract(r.data,'$.transport') IN ('native-success','native-rejection','uncertain') AND json_extract(r.data,'$.handoff') IN ('not-started','started') THEN json_extract(r.data,'$.handoff')='not-started' OR json_extract(r.data,'$.transport')='native-rejection' ELSE 0 END FROM effect_receipts r WHERE r.operation=c.id AND r.kind='send' ORDER BY r.rowid DESC LIMIT 1),0)`;
/** Retained uncertainty is distinct from the native CAS and from operation authority. */
const transmissionHold = `(c.phase NOT IN ('PREPARED','REFRESHED','REFUSED','RESERVED','CONFIRMED') OR CASE WHEN c.data IS NOT NULL AND json_valid(c.data) THEN CASE WHEN json_type(c.data)!='object' OR c.phase!='CONFIRMED' AND json_type(c.data,'$.dispatchRun') IS NOT NULL AND NOT CASE WHEN c.phase='REFUSED' THEN ${definitelyUnsent} ELSE 0 END THEN 1 ELSE 0 END ELSE 1 END)`;
const literal = (field: string) => `(typeof(${field})='text' AND length(CAST(${field} AS BLOB)) BETWEEN 1 AND 4096 AND instr(${field},char(0))=0 AND ${field} NOT GLOB ('*['||char(1)||'-'||char(31)||char(127)||']*'))`;
const localIdentity = `recordedTargetId=id AND ${literal('ref')} AND ref LIKE 'refs/heads/%' AND ${literal('device')} AND ${literal('inode')} AND ${literal('path')} AND substr(path,1,1)='/'`;
const hostedIdentity = `repositoryId=observedId AND nodeId=observedNode AND owner=observedOwner AND repository=observedRepository AND ${literal('ref')} AND ref LIKE 'refs/heads/%' AND host='github.com' AND typeof(repositoryId)='integer' AND repositoryId BETWEEN 1 AND 9007199254740991 AND ${literal('nodeId')} AND ${literal('owner')} AND ${literal('repository')}`;
const identities = `, target_bytes AS (SELECT id,CASE WHEN length(CAST(data AS BLOB))<=131072 AND json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE NULL END ELSE NULL END AS targetData FROM effect_targets),
 native_fields AS (SELECT id,targetData,json_extract(targetData,'$.kind') AS kind,json_extract(targetData,'$.target.ref') AS ref,json_extract(targetData,'$.target.canonicalPath') AS path,json_extract(targetData,'$.target.device') AS device,json_extract(targetData,'$.target.inode') AS inode,json_extract(targetData,'$.target.host') AS host,json_extract(targetData,'$.target.repositoryId') AS repositoryId,json_extract(targetData,'$.target.repositoryNodeId') AS nodeId,json_extract(targetData,'$.target.owner') AS owner,json_extract(targetData,'$.target.repository') AS repository,json_extract(targetData,'$.target.targetId') AS recordedTargetId,json_extract(targetData,'$.repository.repositoryId') AS observedId,json_extract(targetData,'$.repository.repositoryNodeId') AS observedNode,json_extract(targetData,'$.repository.owner') AS observedOwner,json_extract(targetData,'$.repository.repository') AS observedRepository FROM target_bytes),
 native_targets AS (SELECT *,CASE WHEN targetData IS NOT NULL AND COALESCE(kind,'local-git')='local-git' AND ${localIdentity} THEN 'local-git' WHEN kind IN ('github-existing-ref','github-merge') AND ${hostedIdentity} THEN kind ELSE NULL END AS nativeKind FROM native_fields)`;
/** LIMIT follows overlap/unknown classification; no history or foreign payload enters JS. */
export function integrationTransmissionHolds(store: Store, targetId: string, except: string | null = null, limit = 129) {
    const current = inspectIntegrationTarget(store, targetId);
    if (current.state !== 'RETAINED')
        throw Error('Original bounded receiver identity unavailable; inspect target ' + targetId);
    return receiverTransmissionHolds(store, { family: current.family, target: current.configuration.target }, except, limit, targetId);
}
/** Trusted core receiver after its original family-specific identity validation. */
export function receiverTransmissionHolds(store: Store, current: {
    family: 'local-git' | 'github-existing-ref' | 'github-merge';
    target: Record<string, any>;
}, except: string | null = null, limit = 129, targetId: string | null = null) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 129)
        throw Error('Transmission hold limit must be1..129');
    const target = current.target;
    const overlap = current.family === 'local-git' ? `n.nativeKind='local-git' AND n.ref=? AND ((n.device=? AND n.inode=?) OR n.path=?)` : `n.nativeKind IN ('github-existing-ref','github-merge') AND n.host=? AND n.ref=? AND (n.repositoryId=? OR n.nodeId=? OR (lower(n.owner)=lower(?) AND lower(n.repository)=lower(?)))`;
    const values = current.family === 'local-git' ? [target.ref, target.device, target.inode, target.canonicalPath] : [target.host, target.ref, target.repositoryId, target.repositoryNodeId, target.owner, target.repository];
    const unavailable = `(n.nativeKind IS NULL OR COALESCE(c.family,'local-git')!=n.nativeKind OR COALESCE(c.grantFamily,'local-git')!=n.nativeKind)`;
    return store.all(integrationCatalogueSql + identities + ` SELECT c.id,c.work,c.target,CASE WHEN length(CAST(c.phase AS BLOB))<=128 THEN c.phase ELSE NULL END AS phase,CASE WHEN ${unavailable} THEN 1 ELSE 0 END AS unavailable FROM catalogue c LEFT JOIN native_targets n ON n.id=c.target WHERE ${integrationScopeSql} AND (? IS NULL OR c.id!=?) AND ${transmissionHold} AND (c.target=? OR ${unavailable} OR (${overlap})) ORDER BY c.position LIMIT ?`, except, except, targetId, ...values, limit);
}

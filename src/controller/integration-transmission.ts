import type { Store } from './store.js';
import { inspectIntegrationTarget } from './integration-targets.js';
import { integrationCatalogueSql, integrationScopeSql } from './integration-registry.js';
import path from 'node:path';
import { inspectSourceSnapshotRecord, sourceSnapshotOperationId } from './source-snapshot-records.js';
/** A refused original whose latest well-formed send receipt proves no transmission is resolved; same predicate as Effects.canRenew. */
const definitelyUnsent = `(SELECT COUNT(*)<=256 AND COALESCE(SUM(length(CAST(data AS BLOB))),0)<=2097152 FROM effect_receipts WHERE operation=c.id) AND COALESCE((SELECT CASE WHEN length(CAST(r.data AS BLOB))<=1048576 AND json_valid(r.data) AND json_type(r.data)='object' AND json_extract(r.data,'$.operationId')=c.id AND json_extract(r.data,'$.transport') IN ('native-success','native-rejection','uncertain') AND json_extract(r.data,'$.handoff') IN ('not-started','started') THEN json_extract(r.data,'$.handoff')='not-started' OR json_extract(r.data,'$.transport')='native-rejection' ELSE 0 END FROM effect_receipts r WHERE r.operation=c.id AND r.kind='send' ORDER BY r.rowid DESC LIMIT 1),0)`;
/** Retained uncertainty is distinct from the native CAS and from operation authority. */
const transmissionHold = `(c.phase NOT IN ('PREPARED','REFRESHED','REFUSED','RESERVED','CONFIRMED') OR CASE WHEN c.data IS NOT NULL AND json_valid(c.data) THEN CASE WHEN json_type(c.data)!='object' OR c.phase!='CONFIRMED' AND json_type(c.data,'$.dispatchRun') IS NOT NULL AND NOT CASE WHEN c.phase='REFUSED' THEN ${definitelyUnsent} ELSE 0 END THEN 1 ELSE 0 END ELSE 1 END)`;
// Only the closed initial adoption has affirmative no-attempt correspondence.
// Later source phases/receipts stay uncertain until their producer is qualified;
// legacy native-rejection scalars cannot establish source-specific no-launch.
const sourceUnsentAdoption = `CASE WHEN c.data IS NOT NULL AND json_valid(c.data) THEN CASE WHEN json_type(c.data)='object' THEN c.phase='PREPARED' AND json_extract(c.data,'$.version')=1 AND json_type(c.data,'$.adoption')='text' AND length(json_extract(c.data,'$.adoption'))=36 AND json_type(c.data,'$.bindingDigest')='text' AND length(json_extract(c.data,'$.bindingDigest'))=64 AND (SELECT COUNT(*) FROM json_each(c.data))=4 AND EXISTS(SELECT 1 FROM effect_delegations g JOIN effect_targets t ON t.id=g.target WHERE g.id=c.grant_id AND g.root=c.work AND g.target=c.target AND g.epoch=1 AND CASE WHEN length(CAST(g.data AS BLOB))<=65536 AND json_valid(g.data) THEN json_type(g.data)='object' AND json_extract(g.data,'$.kind')='source-snapshot' AND json_extract(g.data,'$.version')=1 AND json_extract(g.data,'$.scope')='work' AND json_extract(g.data,'$.mode')='ordinary' AND json_extract(g.data,'$.operationLimit')=1 AND json_extract(g.data,'$.adoption')=json_extract(c.data,'$.adoption') AND json_extract(g.data,'$.bindingDigest')=json_extract(c.data,'$.bindingDigest') AND (SELECT COUNT(*) FROM json_each(g.data))=7 ELSE 0 END AND CASE WHEN length(CAST(t.data AS BLOB))<=131072 AND json_valid(t.data) THEN json_type(t.data)='object' AND json_extract(t.data,'$.kind')='source-snapshot' AND json_extract(t.data,'$.version')=1 AND json_extract(t.data,'$.targetId')=t.id AND json_extract(t.data,'$.binding.operationId')=c.id AND json_extract(t.data,'$.binding.workId')=c.work AND json_extract(t.data,'$.binding.projectId')=t.project AND (SELECT COUNT(*) FROM json_each(t.data))=4 ELSE 0 END) AND (SELECT COUNT(*) FROM effect_receipts r WHERE r.operation=c.id)=1 AND EXISTS(SELECT 1 FROM effect_receipts r WHERE r.operation=c.id AND r.id=json_extract(c.data,'$.adoption') AND r.kind='source-snapshot-owner-adoption' AND CASE WHEN length(CAST(r.data AS BLOB))<=1048576 AND json_valid(r.data) THEN json_type(r.data)='object' AND json_extract(r.data,'$.kind')='source-snapshot-owner-adoption' AND json_extract(r.data,'$.version')=1 AND json_extract(r.data,'$.operationId')=c.id AND json_extract(r.data,'$.workId')=c.work AND json_extract(r.data,'$.targetId')=c.target AND json_extract(r.data,'$.grantId')=c.grant_id AND json_extract(r.data,'$.bindingDigest')=json_extract(c.data,'$.bindingDigest') ELSE 0 END) ELSE 0 END ELSE 0 END`;

const literal = (field: string) => `(typeof(${field})='text' AND length(CAST(${field} AS BLOB)) BETWEEN 1 AND 4096 AND instr(${field},char(0))=0 AND ${field} NOT GLOB ('*['||char(1)||'-'||char(31)||char(127)||']*'))`;
const localIdentity = `recordedTargetId=id AND ${literal('ref')} AND ref LIKE 'refs/heads/%' AND ${literal('device')} AND ${literal('inode')} AND ${literal('path')} AND substr(path,1,1)='/'`;
const sourceIdentity = `version=1 AND recordedTargetId=id AND ${literal('ref')} AND ref LIKE 'refs/heads/%' AND ${literal('device')} AND ${literal('inode')} AND ${literal('path')} AND substr(path,1,1)='/'`;
const hostedIdentity = `repositoryId=observedId AND nodeId=observedNode AND owner=observedOwner AND repository=observedRepository AND ${literal('ref')} AND ref LIKE 'refs/heads/%' AND host='github.com' AND typeof(repositoryId)='integer' AND repositoryId BETWEEN 1 AND 9007199254740991 AND ${literal('nodeId')} AND ${literal('owner')} AND ${literal('repository')}`;
const identities = `, target_bytes AS (SELECT id,CASE WHEN length(CAST(data AS BLOB))<=131072 AND json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE NULL END ELSE NULL END AS targetData FROM effect_targets),
 native_fields AS (SELECT id,targetData,json_extract(targetData,'$.kind') AS kind,json_extract(targetData,'$.version') AS version,
 CASE WHEN json_extract(targetData,'$.kind')='source-snapshot' THEN json_extract(targetData,'$.binding.destinationRef') ELSE json_extract(targetData,'$.target.ref') END AS ref,
 CASE WHEN json_extract(targetData,'$.kind')='source-snapshot' THEN json_extract(targetData,'$.binding.commonDirectory') ELSE json_extract(targetData,'$.target.canonicalPath') END AS path,
 CASE WHEN json_extract(targetData,'$.kind')='source-snapshot' THEN json_extract(targetData,'$.binding.device') ELSE json_extract(targetData,'$.target.device') END AS device,
 CASE WHEN json_extract(targetData,'$.kind')='source-snapshot' THEN json_extract(targetData,'$.binding.inode') ELSE json_extract(targetData,'$.target.inode') END AS inode,
 json_extract(targetData,'$.target.host') AS host,json_extract(targetData,'$.target.repositoryId') AS repositoryId,json_extract(targetData,'$.target.repositoryNodeId') AS nodeId,json_extract(targetData,'$.target.owner') AS owner,json_extract(targetData,'$.target.repository') AS repository,
 CASE WHEN json_extract(targetData,'$.kind')='source-snapshot' THEN json_extract(targetData,'$.targetId') ELSE json_extract(targetData,'$.target.targetId') END AS recordedTargetId,
 json_extract(targetData,'$.repository.repositoryId') AS observedId,json_extract(targetData,'$.repository.repositoryNodeId') AS observedNode,json_extract(targetData,'$.repository.owner') AS observedOwner,json_extract(targetData,'$.repository.repository') AS observedRepository FROM target_bytes),
 native_targets AS (SELECT *,CASE WHEN targetData IS NOT NULL AND COALESCE(kind,'local-git')='local-git' AND ${localIdentity} THEN 'local-git' WHEN kind='source-snapshot' AND ${sourceIdentity} THEN 'source-snapshot' WHEN kind IN ('github-existing-ref','github-merge') AND ${hostedIdentity} THEN kind ELSE NULL END AS nativeKind FROM native_fields)`;
/** LIMIT follows overlap/unknown classification; no history or foreign payload enters JS. */
export function integrationTransmissionHolds(store: Store, targetId: string, except: string | null = null, limit = 129) {
    const current = inspectIntegrationTarget(store, targetId);
    if (current.state !== 'RETAINED')
        throw Error('Original bounded receiver identity unavailable; inspect target ' + targetId);
    return receiverTransmissionHolds(store, { family: current.family, target: current.configuration.target }, except, limit, targetId);
}
/** Trusted core receiver after its original family-specific identity validation. */
export function receiverTransmissionHolds(store: Store, current: {
    family: 'local-git' | 'github-existing-ref' | 'github-merge' | 'source-snapshot';
    target: Record<string, any>;
}, except: string | null = null, limit = 129, targetId: string | null = null) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 129)
        throw Error('Transmission hold limit must be1..129');
    const target = current.target;
    const local = current.family === 'local-git' || current.family === 'source-snapshot';
    const overlap = local ? `n.nativeKind IN ('local-git','source-snapshot') AND n.ref=? AND ((n.device=? AND n.inode=?) OR n.path=?)` : `n.nativeKind IN ('github-existing-ref','github-merge') AND n.host=? AND n.ref=? AND (n.repositoryId=? OR n.nodeId=? OR (lower(n.owner)=lower(?) AND lower(n.repository)=lower(?)))`;
    const values = local ? [target.ref, target.device, target.inode, target.canonicalPath] : [target.host, target.ref, target.repositoryId, target.repositoryNodeId, target.owner, target.repository];
    const boundedIdentity = (name: string) => `${literal(name)} AND length(CAST(${name} AS BLOB))<=128`;
    const unavailable = `(n.nativeKind IS NULL OR COALESCE(c.family,'local-git')!=n.nativeKind OR COALESCE(c.grantFamily,'local-git')!=n.nativeKind OR NOT (${boundedIdentity('c.id')}) OR NOT (${boundedIdentity('c.work')}) OR NOT (${boundedIdentity('c.target')}))`;
    const familyTransmissionHold = `CASE WHEN c.family='source-snapshot' THEN (${unavailable} OR NOT COALESCE(${sourceUnsentAdoption},0)) ELSE ${transmissionHold} END`;
    const file=store.openedFile?.file,home=file&&path.basename(file)==='controller.sqlite'&&path.basename(path.dirname(file))==='state'?path.dirname(path.dirname(file)):null;
    const holds:{id:string;work:string|null;target:string|null;phase:string|null;unavailable:number}[]=[];let after=0;
    // Resolve source correspondence before the caller's LIMIT, while bounding
    // every SQL page and keeping payloads out of the receiver candidate roster.
    for(;;){
        const rows=store.all(integrationCatalogueSql + identities + ` SELECT c.position,CASE WHEN c.family='source-snapshot' AND n.nativeKind='source-snapshot' THEN 1 ELSE 0 END AS sourceFamily,CASE WHEN ${boundedIdentity('c.id')} THEN c.id ELSE 'rowid:'||c.position END AS id,CASE WHEN ${boundedIdentity('c.work')} THEN c.work ELSE NULL END AS work,CASE WHEN ${boundedIdentity('c.target')} THEN c.target ELSE NULL END AS target,CASE WHEN length(CAST(c.phase AS BLOB))<=128 THEN c.phase ELSE NULL END AS phase,CASE WHEN ${unavailable} THEN 1 ELSE 0 END AS unavailable FROM catalogue c LEFT JOIN native_targets n ON n.id=c.target WHERE c.position>? AND ${integrationScopeSql} AND (? IS NULL OR c.id!=?) AND ${familyTransmissionHold} AND (c.target=? OR ${unavailable} OR (${overlap})) ORDER BY c.position LIMIT 129`,after,except,except,targetId,...values);
        for(const row of rows){
            after=row.position;
            if(home&&row.sourceFamily===1&&row.unavailable===0&&sourceSnapshotOperationId(row.id)){
                const original=inspectSourceSnapshotRecord(store,home,row.id);
                if(original.state==='RETAINED'&&(original.recordedPhase==='CONFIRMED'&&(original.nativeAttempt?.settlement?.classification==='confirmed'||original.resolution?.settlement?.classification==='confirmed')||original.recordedPhase==='REFUSED'&&original.recordedOutcome==='definitely-unsent'))continue;
            }
            holds.push({id:row.id,work:row.work,target:row.target,phase:row.phase,unavailable:row.unavailable});
            if(holds.length===limit)return holds;
        }
        if(rows.length<129)return holds;
    }
}

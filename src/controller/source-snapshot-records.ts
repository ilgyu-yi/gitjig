import path from 'node:path';
import { hash } from './change-files.js';
import type { Store } from './store.js';
import { SourceBranchPreviews, sourcePreviewFactoryProtocol } from './source-branch-previews.js';
import { samePreviewDatabaseScope, validPreviewWriterWitness, type PreviewWriterWitness } from './source-preview-writer.js';
import { inspectSourceNativeAttempt, validSourceNativeAttempt } from './source-snapshot-execution.js';
import { inspectSourceReadHistory, validSourceReadPointers, type SourceReadRecord } from './source-snapshot-read-records.js';
import { integrationCatalogueSql } from './integration-registry.js';

export const sourceSnapshotFamily = 'source-snapshot' as const;
export const sourceSnapshotOwnerReceipt = 'source-snapshot-owner-adoption' as const;
export interface SourceSnapshotAnchor {
    workId: string; projectId: string; projectRoot: string; sourceId: string; epoch: number; generation: number;
    evidenceFingerprint: string; scopeDigest: string; baseVersion: string; candidateVersion: string;
    proposalId: string; previewId: string; artifact: { hash: string; bytes: number }; versionDigest: string; initializedDigest: string;
    operationId: string; basisCommit: string; projectedCommit: string; projectedTree: string;
    publicationBaselineProfile: 'k-absent-whole-file/v1'; objectFormat: 'sha1' | 'sha256';
    commonDirectory: string; device: string; inode: string; destinationRef: string;
    policyFingerprint: string; profileDigest: string; routeDigest: string;
}
export interface SourceSnapshotAdoption {
    kind: typeof sourceSnapshotOwnerReceipt; version: 1; workId: string; operationId: string; targetId: string; grantId: string;
    bindingDigest: string; sourceDigest: string; workContextDigest: string; reviewFingerprint: string;
    scope: 'work'; mode: 'ordinary'; operationLimit: 1; writer: PreviewWriterWitness;
}
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && Buffer.byteLength(v) > 0 && Buffer.byteLength(v) <= max && !/[\x00-\x1f\x7f]/u.test(v);
export const sourceSnapshotUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
export const sourceSnapshotOperationId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('source-preview-') && sourceSnapshotUuid(v.slice(15));
export const sourceSnapshotDigest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
export const sourceSnapshotFields = (v: unknown, names: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join();
const object = (v: unknown) => {
    if (typeof v !== 'string') throw Error('Original bounded source record unavailable');
    const parsed: unknown = JSON.parse(v);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Original source record object unavailable');
    return parsed as Record<string, any>;
};
export const sourceSnapshotBound = (name: string, max: number) => `CASE WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${max} THEN ${name} ELSE NULL END`;
export function validSourceSnapshotAnchor(v: any): v is SourceSnapshotAnchor {
    const names = ['workId','projectId','projectRoot','sourceId','epoch','generation','evidenceFingerprint','scopeDigest','baseVersion','candidateVersion','proposalId','previewId','artifact','versionDigest','initializedDigest','operationId','basisCommit','projectedCommit','projectedTree','publicationBaselineProfile','objectFormat','commonDirectory','device','inode','destinationRef','policyFingerprint','profileDigest','routeDigest'];
    const absolute = (s: unknown): s is string => text(s, 4096) && path.isAbsolute(s) && path.normalize(s) === s;
    const oid = (s: unknown) => typeof s === 'string' && new RegExp('^[a-f0-9]{' + (v?.objectFormat === 'sha256' ? 64 : 40) + '}$', 'u').test(s) && !/^0+$/u.test(s);
    return sourceSnapshotFields(v, names) && ['workId','projectId','sourceId','baseVersion','candidateVersion'].every(k => text(v[k])) &&
        ['epoch','generation'].every(k => Number.isSafeInteger(v[k]) && v[k] > 0) && ['evidenceFingerprint','scopeDigest','versionDigest','initializedDigest','policyFingerprint','profileDigest','routeDigest'].every(k => sourceSnapshotDigest(v[k])) &&
        sourceSnapshotUuid(v.proposalId) && sourceSnapshotUuid(v.previewId) && v.operationId === 'source-preview-' + v.previewId &&
        sourceSnapshotFields(v.artifact, ['hash','bytes']) && sourceSnapshotDigest(v.artifact.hash) && Number.isSafeInteger(v.artifact.bytes) && v.artifact.bytes >= 2 && v.artifact.bytes <= 16 * 1024 * 1024 &&
        ['sha1','sha256'].includes(v.objectFormat) && ['basisCommit','projectedCommit','projectedTree'].every(k => oid(v[k])) && v.publicationBaselineProfile === 'k-absent-whole-file/v1' &&
        absolute(v.projectRoot) && absolute(v.commonDirectory) && v.commonDirectory === path.join(v.projectRoot, '.git') && text(v.device, 4096) && text(v.inode, 4096) &&
        text(v.destinationRef, 1024) && v.destinationRef.startsWith('refs/heads/') && !/[\x00-\x20\x7f~^:?*\[\\]/u.test(v.destinationRef) && !v.destinationRef.includes('..') && !v.destinationRef.includes('@{') &&
        v.destinationRef.split('/').every((p: string) => p && !p.startsWith('.') && !p.endsWith('.') && !p.endsWith('.lock'));
}

/** Source historical correspondence only; no filesystem, native proof or current authority. */
export function inspectSourceSnapshotRecord(store: Store, home: string, operationId: string) {
    if (!sourceSnapshotOperationId(operationId)) throw Error('Exact original source operation required');
    const unavailable = (reason: string, phase: string | null = null) => ({ state: 'UNAVAILABLE' as const, operationId, recordedPhase: phase, reason });
    const row = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('work',128)} AS work,${sourceSnapshotBound('target',128)} AS target,${sourceSnapshotBound('grant_id',128)} AS grant_id,${sourceSnapshotBound('phase',128)} AS phase,${sourceSnapshotBound('data',1048576)} AS data FROM effect_operations WHERE id=?`, operationId);
    if (!row) return unavailable('Original source operation not found');
    try {
        const data = object(row.data);
        if (row.id !== operationId || ![1,2,3].includes(data.version) || !sourceSnapshotFields(data, ['kind','version','adoption','bindingDigest',...data.version>=2 ? ['attempt'] : [],...data.version===3?['creationPhase','reads']:[]]) || data.kind !== sourceSnapshotFamily || !sourceSnapshotUuid(data.adoption) || !sourceSnapshotDigest(data.bindingDigest) || data.version>=2 && !validSourceNativeAttempt(data.attempt) || data.version===3&&(!validSourceReadPointers(data.reads)||!['UNKNOWN','CONFIRMED'].includes(data.creationPhase))) throw Error('Original source operation family or version unavailable');
        const target = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('project',128)} AS project,${sourceSnapshotBound('data',131072)} AS data FROM effect_targets WHERE id=?`, row.target);
        const grant = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('root',128)} AS root,${sourceSnapshotBound('target',128)} AS target,epoch,${sourceSnapshotBound('data',65536)} AS data FROM effect_delegations WHERE id=?`, row.grant_id);
        const t = object(target?.data), g = object(grant?.data), a = t.binding;
        if (!sourceSnapshotFields(t, ['kind','version','targetId','binding']) || t.kind !== sourceSnapshotFamily || t.version !== 1 || t.targetId !== target.id || !sourceSnapshotUuid(target.id) || !validSourceSnapshotAnchor(a) || hash(a) !== data.bindingDigest || a.operationId !== row.id || a.workId !== row.work || a.projectId !== target.project) throw Error('Original source target or payload binding unavailable');
        if (!sourceSnapshotFields(g, ['kind','version','scope','mode','operationLimit','adoption','bindingDigest']) || g.kind !== sourceSnapshotFamily || g.version !== 1 || g.scope !== 'work' || g.mode !== 'ordinary' || g.operationLimit !== 1 || g.adoption !== data.adoption || g.bindingDigest !== data.bindingDigest || !sourceSnapshotUuid(grant.id) || grant.id !== row.grant_id || grant.root !== row.work || grant.target !== row.target || grant.epoch !== 1) throw Error('Original exact-work one-use source permission unavailable');
        if (store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n !== 1 || store.one('SELECT COUNT(*) AS n FROM effect_delegations WHERE target=?', target.id).n !== 1) throw Error('Original source operation/permission cardinality differs');
        const size = store.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(data AS BLOB))),0) AS largest FROM effect_receipts WHERE operation=?', operationId);
        if (size.n < 1 || size.n > (data.version === 1 ? 1 : data.version===2?6:22) || size.bytes > 1048576 || size.largest > 1048576) throw Error('Original source adoption receipt profile unavailable');
        const receipt = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('operation',128)} AS operation,${sourceSnapshotBound('kind',128)} AS kind,${sourceSnapshotBound('data',1048576)} AS data FROM effect_receipts WHERE operation=? AND id=?`, operationId,data.adoption), event = object(receipt?.data);
        if (receipt.id !== data.adoption || receipt.operation !== operationId || receipt.kind !== sourceSnapshotOwnerReceipt || !sourceSnapshotFields(event, ['kind','version','workId','operationId','targetId','grantId','bindingDigest','sourceDigest','workContextDigest','reviewFingerprint','scope','mode','operationLimit','writer']) ||
            event.kind !== sourceSnapshotOwnerReceipt || event.version !== 1 || event.workId !== row.work || event.operationId !== row.id || event.targetId !== row.target || event.grantId !== row.grant_id || event.bindingDigest !== data.bindingDigest || event.scope !== 'work' || event.mode !== 'ordinary' || event.operationLimit !== 1 || !['sourceDigest','workContextDigest','reviewFingerprint'].every(k => sourceSnapshotDigest(event[k])) || !validPreviewWriterWitness(event.writer, home)) throw Error('Original owner adoption event unavailable');
        const source = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('conversation',128)} AS conversation,${sourceSnapshotBound('origin',65536)} AS origin,${sourceSnapshotBound('raw',1048576)} AS raw FROM sources WHERE id=?`, a.sourceId);
        if (!source || !text(source.id) || !source.origin || !source.raw || hash(source) !== event.sourceDigest || !store.one('SELECT id FROM works WHERE id=?', row.work) || !store.one('SELECT id FROM projects WHERE id=?', a.projectId)) throw Error('Original source work/project provenance unavailable');
        const version = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('work',128)} AS work,${sourceSnapshotBound('kind',128)} AS kind,${sourceSnapshotBound('predecessor',128)} AS predecessor,${sourceSnapshotBound('artifact',4096)} AS artifact,${sourceSnapshotBound('hash',64)} AS hash,${sourceSnapshotBound('data',16384)} AS data FROM change_versions WHERE id=?`, a.proposalId);
        const header = object(version?.data), preview = new SourceBranchPreviews(store, home).inspect(a.previewId);
        if (!sourceSnapshotFields(header, ['protocol','initializedDigest','proposalId','status','publicationConsent','workId','sourceId','scopeDigest','evidenceFingerprint','previewId','admissionSourceId','rootSourceId','terminalSourceId','operationId','previewDigest','artifact','destinationRef']) || hash(version) !== a.versionDigest || version.work !== row.work || version.kind !== 'source-snapshot-proposal' || version.predecessor !== a.candidateVersion || version.hash !== a.artifact.hash || version.artifact !== path.join(home, 'artifacts/source-snapshot-proposals', a.artifact.hash + '.json') ||
            header.protocol !== 'source-snapshot-proposal/v2' || header.status !== 'prepared' || header.publicationConsent !== 'unconfirmed' || header.workId !== row.work || header.proposalId !== a.proposalId || header.previewId !== a.previewId || header.operationId !== row.id || header.sourceId !== a.sourceId || header.scopeDigest !== a.scopeDigest || header.evidenceFingerprint !== a.evidenceFingerprint || header.initializedDigest !== a.initializedDigest || header.destinationRef !== a.destinationRef || hash(header.artifact) !== hash(a.artifact) || hash(preview) !== header.previewDigest || preview.state !== 'SETTLED' || preview.terminal?.kind !== 'joined-owned-native' || preview.terminal.cleanup !== 'confirmed' || preview.admission.factoryProtocol !== sourcePreviewFactoryProtocol || !preview.root || !('protocol' in preview.root) || preview.root.protocol !== sourcePreviewFactoryProtocol || preview.admission_source !== header.admissionSourceId || preview.root_source !== header.rootSourceId || preview.terminal_source !== header.terminalSourceId || preview.admission.workId !== row.work || preview.admission.projectId !== a.projectId || preview.admission.sourceId !== a.sourceId || preview.admission.epoch !== a.epoch || preview.admission.generation !== a.generation || preview.admission.ownerUid !== event.writer.owner.ownerUid) throw Error('Original proposal/initialized cleanup correspondence unavailable');
        let nativeAttempt: ReturnType<typeof inspectSourceNativeAttempt> | null = null;
        let nativeReads:SourceReadRecord[]=[],resolution:SourceReadRecord|null=null;
        if (data.version === 1) {
            if (row.phase !== 'PREPARED') throw Error('Source attempt protocol unavailable; recorded phase is not native causal proof');
        } else {
            const { admissionSourceId: _admissionSourceId, ...namespace } = preview.root;
            const run = store.one(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('work',128)} AS work,epoch,generation,${sourceSnapshotBound('phase',128)} AS phase,${sourceSnapshotBound('staging',4096)} AS staging,${sourceSnapshotBound('reservation',128)} AS reservation,${sourceSnapshotBound('data',1048576)} AS data FROM runs WHERE id=?`,data.attempt.runId);
            const receipts = store.all(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('kind',128)} AS kind,${sourceSnapshotBound('data',1048576)} AS data FROM effect_receipts WHERE operation=? AND id!=? ${data.version===3?"AND kind NOT IN ('source-native-read-admission','source-native-read-settlement')":''} ORDER BY rowid`,operationId,data.adoption);
            const capacity = store.all(`SELECT ${sourceSnapshotBound('id',128)} AS id,${sourceSnapshotBound('work',128)} AS work,${sourceSnapshotBound('run',128)} AS run,epoch,${sourceSnapshotBound('state',128)} AS state,${sourceSnapshotBound('data',65536)} AS data FROM capacity_leases WHERE run=? LIMIT 2`,data.attempt.runId);
            nativeAttempt = inspectSourceNativeAttempt({home,anchor:a,adoptionId:data.adoption,attempt:data.attempt,namespace,phase:data.version===3?data.creationPhase:row.phase,receipts,run,capacity});
            if (!samePreviewDatabaseScope(event.writer,nativeAttempt.admission.writer)) throw Error('Source attempt differs from original adoption database scope');
            if(data.version===3){const history=inspectSourceReadHistory({store,home,anchor:a,adoptionId:data.adoption,creation:nativeAttempt,pointers:data.reads,phase:row.phase});nativeReads=history.reads;resolution=history.resolution;}
        }
        return { state: 'RETAINED' as const, operationId, workId: row.work as string, targetId: row.target as string, grantId: row.grant_id as string,
            recordedPhase: row.phase as string, binding: structuredClone(a as SourceSnapshotAnchor), adoption: structuredClone(event as SourceSnapshotAdoption), nativeAttempt,nativeReads,resolution,
            nativeOutcome: 'not-inspected' as const, recordedOutcome: resolution?'confirmed':nativeAttempt?.settlement?.classification ?? null,
            scope: 'Recorded correspondence only; no current authority, artifact-byte verification or independently verified native causal outcome' };
    } catch (error) { return unavailable(String(error instanceof Error ? error.message : error).slice(0,2048), row.phase); }
}

const boundedObject = (name: string, max: number) => `CASE WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${max} AND json_valid(${name}) THEN json_type(${name})='object' ELSE 0 END`;
const knownOther = `COALESCE((family IN ('local-git','github-existing-ref','github-merge') AND family=targetFamily AND family=grantFamily) OR (family IS NULL AND targetFamily IS NULL AND grantFamily IS NULL AND ${boundedObject('data',1048576)} AND EXISTS(SELECT 1 FROM effect_targets t WHERE t.id=catalogue.target AND ${boundedObject('t.data',131072)}) AND EXISTS(SELECT 1 FROM effect_delegations g WHERE g.id=catalogue.grant_id AND ${boundedObject('g.data',65536)})) OR (family='configuration' AND targetFamily IN ('github-configuration','native-repository-configuration') AND grantFamily='configuration') OR (family='publication' AND targetFamily='github-publication' AND grantFamily='publication'),0)`;
export function listSourceSnapshotRecords(store: Store, home: string, options: { after?: number; limit?: number } = {}) {
    const after = options.after ?? 0, limit = options.limit ?? 25;
    if (Object.keys(options).some(k => !['after','limit'].includes(k)) || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Bounded source record page required');
    const rows = store.all(integrationCatalogueSql + ` SELECT position,${sourceSnapshotBound('id',128)} AS id FROM catalogue WHERE position>? AND NOT ${knownOther} ORDER BY position LIMIT ?`, after, limit + 1);
    return { scope: 'Source originals and tagged/unknown families; untagged legacy unavailable records remain in listIntegrations', operations: rows.slice(0,limit).map(row => ({ position: row.position as number, ...sourceSnapshotOperationId(row.id) ? inspectSourceSnapshotRecord(store,home,row.id) : { state: 'UNAVAILABLE' as const, operationId: text(row.id) ? row.id as string : null, reason: 'Unavailable source-family identity at rowid ' + row.position } })), nextCursor: rows.length > limit ? rows[limit - 1]!.position as number : null };
}

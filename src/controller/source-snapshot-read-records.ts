import type { Store } from './store.js';
import type { SourceSnapshotAnchor } from './source-snapshot-records.js';
import type { inspectSourceNativeAttempt } from './source-snapshot-execution.js';
import { validCommand, validReadback } from './source-snapshot-execution.js';
import { hash } from './change-files.js';
import { validPreviewWriterWitness, samePreviewDatabaseScope, type PreviewWriterWitness } from './source-preview-writer.js';
import { sourceGitArguments } from '../effects/native-git.js';
import type { NativeGitNamespaceProof, SourceBranchPreparedReference, SourceBranchReconciliation } from '../effects/types.js';

export const sourceReadKinds=['source-native-read-admission','source-native-read-settlement'] as const;
export const sourceReadReceiptRoom=262144;
export interface SourceReadPointer { id:string;runId:string;admissionId:string;settlementId:string|null }
export interface SourceReadWork { id:string;project:string;source:string;lineage:string;state:string;epoch:number;generation:number;digest:string }
export interface SourceReadAdmission {
    protocol:'source-native-read/v1';kind:'source-native-read-admission';operationId:string;adoptionId:string;bindingDigest:string;
    readId:string;runId:string;writer:PreviewWriterWitness;work:SourceReadWork;creationIntentId:string;prepared:SourceBranchPreparedReference;
    originalAttemptDigest:string;initializedDigest:string;namespace:NativeGitNamespaceProof;profileDigest:string;reviewFingerprint:string;
}
export interface SourceReadSettlement {
    protocol:'source-native-read/v1';kind:'source-native-read-settlement';operationId:string;adoptionId:string;bindingDigest:string;
    readId:string;runId:string;writer:PreviewWriterWitness;admissionId:string;readback:SourceBranchReconciliation|null;
    policy:{fingerprint:string;commonDirectory:string;device:string;inode:string;ownerUid:number;routeDigest:string}|null;
    cleanup:'removed'|'not-allocated'|'quarantined';classification:'confirmed'|'unknown';reason:string;
}
export interface SourceReadRecord { pointer:SourceReadPointer;admission:SourceReadAdmission;settlement:SourceReadSettlement|null;
    run:{id:string;phase:string;reservation:string;nativeGate:string;cleanup:string|null} }
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const text=(v:unknown)=>typeof v==='string'&&Buffer.byteLength(v)>0&&Buffer.byteLength(v)<=128&&!/[\x00-\x1f\x7f]/u.test(v);
const states=['ACTIVE','DELIVERED','CANCELLED','INTERRUPTED','UNKNOWN'];
const bounded=(name:string,max:number)=>`CASE WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${max} THEN ${name} ELSE NULL END`;
export function validSourceReadPointers(v:any):v is SourceReadPointer[]{
    return Array.isArray(v)&&v.length>0&&v.length<=8&&v.every(p=>exact(p,['id','runId','admissionId','settlementId'])&&[p.id,p.runId,p.admissionId].every(uuid)&&(p.settlementId===null||uuid(p.settlementId)))&&
        new Set(v.flatMap(p=>[p.id,p.runId,p.admissionId,...p.settlementId?[p.settlementId]:[]])).size===v.reduce((n,p)=>n+3+Number(!!p.settlementId),0);
}
export function validSourceReadWork(v:any):v is SourceReadWork{
    return exact(v,['id','project','source','lineage','state','epoch','generation','digest'])&&[v.id,v.project,v.source,v.lineage].every(text)&&states.includes(v.state)&&
        ['epoch','generation'].every(k=>Number.isSafeInteger(v[k])&&v[k]>0)&&sha(v.digest);
}
/** Current metadata only. No procedure, grant, model or Native work is requested. */
export function sourceReadWork(store:Store,id:string):SourceReadWork{
    const work=store.one(`SELECT ${['id','project','source','predecessor','lineage','state'].map(k=>bounded(k,128)+' AS '+k).join(',')},epoch,generation,${bounded('current_result',128)} AS current_result,${bounded('data',1048576)} AS data FROM works WHERE id=?`,id);
    const source=work?.source&&store.one(`SELECT ${bounded('id',128)} AS id,${bounded('conversation',128)} AS conversation,${bounded('origin',65536)} AS origin,${bounded('raw',1048576)} AS raw FROM sources WHERE id=?`,work.source);
    if(!work?.data||!source?.id||!source.origin||typeof source.raw!=='string')throw Error('Bounded current historical-read work/source unavailable');
    const result={id:work.id,project:work.project,source:work.source,lineage:work.lineage,state:work.state,epoch:work.epoch,generation:work.generation,digest:hash({work,source})};
    if(!validSourceReadWork(result))throw Error('Current historical-read work identity unavailable');return result;
}
/** Historical closed correspondence only; actual Native journal truth is separate. */
export function inspectSourceReadHistory(input:{store:Store;home:string;anchor:SourceSnapshotAnchor;adoptionId:string;creation:ReturnType<typeof inspectSourceNativeAttempt>;pointers:unknown;phase:string}){
    const {store,home,anchor:a,creation}=input;
    if(!validSourceReadPointers(input.pointers)||!creation.intent)throw Error('Original source read pointers/creation intent unavailable');
    const rows=store.all(`SELECT ${bounded('id',128)} AS id,${bounded('kind',128)} AS kind,${bounded('data',1048576)} AS data FROM effect_receipts WHERE operation=? AND kind IN ('source-native-read-admission','source-native-read-settlement') ORDER BY rowid LIMIT 17`,a.operationId);
    if(rows.length>16)throw Error('Source read event roster exceeds bounded profile');
    const events=new Map(rows.map(r=>[r.id,r]));if(events.size!==rows.length)throw Error('Duplicate source read event');
    const referenced=new Set<string>(),reads:SourceReadRecord[]=[];
    for(const pointer of input.pointers){
        const ar=events.get(pointer.admissionId),sr=pointer.settlementId?events.get(pointer.settlementId):null;
        const admission=ar&&JSON.parse(ar.data),settlement=sr&&JSON.parse(sr.data);
        if(!ar||ar.kind!=='source-native-read-admission'||!exact(admission,['protocol','kind','operationId','adoptionId','bindingDigest','readId','runId','writer','work','creationIntentId','prepared','originalAttemptDigest','initializedDigest','namespace','profileDigest','reviewFingerprint'])||
            admission.protocol!=='source-native-read/v1'||admission.kind!==ar.kind||admission.operationId!==a.operationId||admission.adoptionId!==input.adoptionId||admission.bindingDigest!==hash(a)||admission.readId!==pointer.id||admission.runId!==pointer.runId||
            !validPreviewWriterWitness(admission.writer,home)||!samePreviewDatabaseScope(creation.admission.writer,admission.writer)||!validSourceReadWork(admission.work)||admission.work.id!==a.workId||admission.work.project!==a.projectId||
            admission.creationIntentId!==creation.attempt.intentId||hash(admission.prepared)!==hash(creation.intent.prepared)||admission.originalAttemptDigest!==hash(creation.attempt)||admission.initializedDigest!==a.initializedDigest||hash(admission.namespace)!==hash(creation.admission.namespace)||!sha(admission.profileDigest)||!sha(admission.reviewFingerprint))throw Error('Original source read admission unavailable');
        referenced.add(ar.id);
        const run=store.one(`SELECT ${bounded('id',128)} AS id,${bounded('work',128)} AS work,epoch,generation,${bounded('phase',128)} AS phase,${bounded('staging',4096)} AS staging,${bounded('reservation',128)} AS reservation,${bounded('data',1048576)} AS data FROM runs WHERE id=?`,pointer.runId),data=run&&JSON.parse(run.data);
        if(!run||run.work!==a.workId||run.epoch!==admission.work.epoch||run.generation!==admission.work.generation||run.staging!==admission.namespace.clientRoot||!['CREATED','WAITING_CAPACITY','RUNNING','SETTLED','INTERRUPTED','UNKNOWN'].includes(run.phase)||!['reserved','released','consumed'].includes(run.reservation)||
            data.kind!=='native-effect'||data.nativeFamily!=='source-snapshot'||data.familyVersion!==1||data.sourcePurpose!=='read'||data.operationId!==a.operationId||data.clientRoot!==run.staging||data.controllerPid!==admission.writer.owner.pid||data.nativeReadId!==pointer.id||data.nativeReadAdmissionId!==pointer.admissionId||data.bindingDigest!==hash(a)||data.readWorkDigest!==hash(admission.work)||
            !['unopened','enabled'].includes(data.nativeGate)||Object.hasOwn(data,'retainedIntegrationRead')||Object.hasOwn(data,'readOnlyObservation')||Object.hasOwn(data,'attemptRevision')||Object.hasOwn(data,'nativeAdmissionId'))throw Error('Original source read/run correspondence unavailable');
        const clean=['SETTLED','INTERRUPTED'].includes(run.phase)&&['removed','not-allocated'].includes(data.cleanup)&&['consumed','released'].includes(run.reservation);
        if(['SETTLED','INTERRUPTED'].includes(run.phase)&&!clean||data.nativeGate==='enabled'&&run.reservation==='released'||run.reservation==='released'&&data.admission!=='never-admitted')throw Error('Source read gate/reservation contradiction');
        const leases=store.all(`SELECT ${['id','work','run','state'].map(k=>bounded(k,128)+' AS '+k).join(',')},epoch,${bounded('data',65536)} AS data FROM capacity_leases WHERE run=? LIMIT 2`,run.id),lease=leases[0],ld=lease&&JSON.parse(lease.data);
        if(leases.length>1||lease&&(!uuid(lease.id)||data.capacityId!==lease.id||lease.work!==run.work||lease.epoch!==run.epoch||!['QUEUED','ADMITTED','SETTLING','QUARANTINED','RELEASED','CANCELLED'].includes(lease.state)||typeof ld?.admitted!=='boolean'||ld.kind!=='check'||ld.ownerPid!==admission.writer.owner.pid||
            (ld.admitted?data.admission!=='admitted'||['QUEUED','CANCELLED'].includes(lease.state)||run.reservation==='released':data.admission!=='never-admitted'||!['QUEUED','CANCELLED'].includes(lease.state))||data.nativeGate==='enabled'&&!ld.admitted||lease.state==='RELEASED'&&(ld.receipt?.settled!==true||!['removed','not-allocated'].includes(ld.receipt?.cleanup)||ld.receipt.cleanup!==data.cleanup))||
            !lease&&(Object.hasOwn(data,'capacityId')||data.nativeGate==='enabled'||data.admission==='admitted'||run.phase==='WAITING_CAPACITY'))throw Error('Original source read capacity unavailable');
        if(pointer.settlementId){
            if(!sr||sr.kind!=='source-native-read-settlement'||!exact(settlement,['protocol','kind','operationId','adoptionId','bindingDigest','readId','runId','writer','admissionId','readback','policy','cleanup','classification','reason'])||settlement.protocol!=='source-native-read/v1'||settlement.kind!==sr.kind||settlement.operationId!==a.operationId||settlement.adoptionId!==input.adoptionId||settlement.bindingDigest!==hash(a)||settlement.readId!==pointer.id||settlement.runId!==run.id||settlement.admissionId!==pointer.admissionId||
                !validPreviewWriterWitness(settlement.writer,home)||!samePreviewDatabaseScope(admission.writer,settlement.writer)||!['removed','not-allocated','quarantined'].includes(settlement.cleanup)||!['confirmed','unknown'].includes(settlement.classification)||typeof settlement.reason!=='string'||Buffer.byteLength(settlement.reason)>2048||
                settlement.readback!==null&&!validReadback(settlement.readback,a,admission.namespace.clientRoot)||settlement.policy!==null&&(!exact(settlement.policy,['fingerprint','commonDirectory','device','inode','ownerUid','routeDigest'])||!sha(settlement.policy.fingerprint)||settlement.policy.commonDirectory!==a.commonDirectory||settlement.policy.device!==a.device||settlement.policy.inode!==a.inode||settlement.policy.ownerUid!==admission.namespace.ownerUid||settlement.policy.routeDigest!==a.routeDigest)||
                data.nativeGate==='unopened'&&(settlement.readback!==null||settlement.policy!==null)||settlement.readback!==null&&settlement.policy===null)throw Error('Original source read settlement unavailable');
            if(settlement.cleanup==='quarantined'?(settlement.classification!=='unknown'||!(run.phase==='UNKNOWN'&&data.cleanup==='quarantined'||clean)):!clean||data.cleanup!==settlement.cleanup||lease&&!['RELEASED','CANCELLED'].includes(lease.state))throw Error('Source read physical settlement contradiction');
            if(settlement.classification==='confirmed'){
                const read=settlement.readback?.commands.at(-1),args=sourceGitArguments(a.commonDirectory,['show-ref','--verify','--hash',a.destinationRef]);
                if(settlement.cleanup!=='removed'||run.reservation!=='consumed'||run.phase!=='SETTLED'||settlement.readback?.kind!=='confirmed-creation'||settlement.readback.currentCommit!==a.projectedCommit||!read||!validCommand(read,admission.namespace.clientRoot)||read.exitCode!==0||!read.settled||read.cleanup!=='confirmed'||read.aborted||read.timedOut||read.truncated||read.stdoutExcerpted||!read.gitStarted||!Number.isSafeInteger(read.gitPid)||read.gitPid<1||!Number.isSafeInteger(read.launcherPid)||read.launcherPid<1||read.stdout.trim()!==a.projectedCommit||hash(read.argv)!==hash(args))throw Error('Recorded source read confirmation incomplete');
            }
            referenced.add(sr.id);
        }
        reads.push(structuredClone({pointer,admission,settlement:settlement??null,run:{id:run.id,phase:run.phase,reservation:run.reservation,nativeGate:data.nativeGate,cleanup:data.cleanup??null}}));
    }
    if(referenced.size!==events.size)throw Error('Unreferenced source read events retained');
    const resolution=reads.find(r=>r.settlement?.classification==='confirmed')??null;
    const phase=resolution?'CONFIRMED':creation.settlement?.classification==='confirmed'?'CONFIRMED':'UNKNOWN';
    if(input.phase!==phase)throw Error('Source read resolution/operation phase differs');
    return {reads,resolution};
}

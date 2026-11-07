import { captureSourceNativeProfile, type SourceNativeProfileControls } from './source-native-profile.js';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { OwnerLease } from './ownership.js';
import type { SourceSnapshotProposals } from './source-snapshot-proposals.js';
import { SourcePreviewWriter } from './source-preview-writer.js';
import { hash } from './change-files.js';
import { receiverTransmissionHolds } from './integration-transmission.js';
import { inspectSourceSnapshotRecord, listSourceSnapshotRecords, sourceSnapshotBound as bounded, sourceSnapshotDigest, sourceSnapshotFields,
    sourceSnapshotFamily, sourceSnapshotOwnerReceipt, sourceSnapshotUuid, validSourceSnapshotAnchor, type SourceSnapshotAnchor, type SourceSnapshotAdoption } from './source-snapshot-records.js';
import { ControllerError } from './types.js';
import type { SourceSaveInputSnapshot } from './effect-types.js';
import { samePreviewDatabaseScope } from './source-preview-writer.js';
import { assertSourceBranchPrepared, assertSourceBranchNoLaunch, reconcileOwnedGitProcesses } from '../effects/native-git.js';
import type { PreparedSourceBranchCreate } from '../effects/types.js';
import type { SourceSnapshotNativeClient, SourceNativeAdmission, SourceNativeIntent, SourceNativeSettlement, SourceNativeHold } from './source-snapshot-execution.js';
import { sourceAttemptReason } from './source-snapshot-execution.js';
import { sourceReadWork, sourceReadReceiptRoom, type SourceReadWork, type SourceReadAdmission, type SourceReadSettlement } from './source-snapshot-read-records.js';
import type { NativeGitClient } from '../effects/native-git.js';

interface Host {
    store: Store; home: string; owner: OwnerLease; proposals: SourceSnapshotProposals;
    capacityLimit: number; busy(workId: string): boolean; assertOpen(): void;
    ownsRun(workId: string, operationId: string, runId: string): boolean;
    assertSourceInput(input: SourceSaveInputSnapshot): void;
    settleBudget(runId:string):void;
    patchRun(runId:string,phase:string,data:Record<string,unknown>):void;
    cancelUnadmittedRun(runId:string):void;
}
type Request = { workId: string; proposalId: string };
type Original = Extract<ReturnType<typeof inspectSourceSnapshotRecord>,{state:'RETAINED'}>;
export interface SourceSnapshotDispatch {
    purpose:'create'|'read';
    original: Original; proof: Awaited<ReturnType<SourceSnapshotProposals['captureActionProposal']>>;
    signal: AbortSignal; validate(): void; runId: string | null;
    outcome: Pick<SourceNativeSettlement,'prepared'|'send'|'readback'|'reason'>;
    result: Original | null;
    read?:{id:string;work:SourceReadWork;reviewFingerprint:string;policy:SourceReadSettlement['policy']};
}
/** Internal owner adoption, not a public confirm/send entry or a model capability. */
export class SourceSnapshotActions {
    private readonly shutdown = new AbortController();
    private readonly tails = new Set<Promise<unknown>>();
    private readonly writer: SourcePreviewWriter;
    constructor(private readonly h: Host) { this.writer = new SourcePreviewWriter(h.store, h.home, h.owner); }
    private open() { this.shutdown.signal.throwIfAborted(); this.h.assertOpen(); this.h.owner.assertCurrent(); }
    private track<T>(task: () => Promise<T>) {
        this.open(); const result = Promise.resolve().then(task); this.tails.add(result);
        void result.then(() => this.tails.delete(result), () => this.tails.delete(result)); return result;
    }
    private request(input: Request) {
        if (!sourceSnapshotFields(input, ['workId','proposalId']) || typeof input.workId !== 'string' || !input.workId || Buffer.byteLength(input.workId) > 128 || /[\x00-\x1f\x7f]/u.test(input.workId) || !sourceSnapshotUuid(input.proposalId)) throw Error('Exact original source work and proposal required');
    }
    private original(input: Request) {
        const row = this.h.store.one(`SELECT ${bounded('data',16384)} AS data FROM change_versions WHERE id=? AND work=? AND kind='source-snapshot-proposal'`, input.proposalId, input.workId);
        if (!row?.data) throw Error('Original bounded source proposal unavailable');
        const header = JSON.parse(row.data);
        if (header?.proposalId !== input.proposalId || header.workId !== input.workId || !sourceSnapshotUuid(header.previewId) || header.operationId !== 'source-preview-' + header.previewId) throw Error('Original source proposal identity unavailable');
        if (!this.h.store.one('SELECT id FROM effect_operations WHERE id=?', header.operationId)) return null;
        const original = inspectSourceSnapshotRecord(this.h.store, this.h.home, header.operationId);
        if (original.state !== 'RETAINED' || original.binding.workId !== input.workId || original.binding.proposalId !== input.proposalId) throw Error('Original source operation ' + header.operationId + ' retained but unavailable; inspect it without replacement');
        return original;
    }
    private context(anchor: SourceSnapshotAnchor, runId?: string) {
        this.open(); const s = this.h.store;
        const ownRun = runId ? this.h.ownsRun(anchor.workId,anchor.operationId,runId) : false;
        if (runId && !ownRun) throw Error('Exact original source active handle unavailable');
        if (!validSourceSnapshotAnchor(anchor)) throw Error('Verified original source action binding unavailable');
        const work = s.one(`SELECT ${bounded('id',128)} AS id,${bounded('project',128)} AS project,${bounded('source',128)} AS source,${bounded('predecessor',128)} AS predecessor,${bounded('lineage',128)} AS lineage,${bounded('state',128)} AS state,epoch,generation,${bounded('data',1048576)} AS data FROM works WHERE id=?`, anchor.workId);
        const source = s.one(`SELECT ${bounded('id',128)} AS id,${bounded('conversation',128)} AS conversation,${bounded('origin',65536)} AS origin,${bounded('raw',1048576)} AS raw FROM sources WHERE id=?`, anchor.sourceId);
        const budgets = work?.lineage ? s.all("SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') ORDER BY kind", work.lineage) : [];
        const cleanup = s.one(`SELECT 1 AS present FROM runs WHERE work=? AND id!=? AND (phase NOT IN ('SETTLED','INTERRUPTED') OR reservation NOT IN ('consumed','released') OR NOT CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN COALESCE(json_extract(data,'$.cleanup') IN ('removed','not-allocated','unbound','confirmed'),0) ELSE 0 END) LIMIT 1`, anchor.workId,runId ?? '');
        const workCapacity = s.one("SELECT 1 AS present FROM capacity_leases WHERE work=? AND run!=? AND state NOT IN ('RELEASED','CANCELLED') LIMIT 1", anchor.workId,runId ?? '');
        const preview = s.one("SELECT 1 AS present FROM source_branch_previews WHERE work=? AND state!='SETTLED' LIMIT 1", anchor.workId);
        const capacity = s.one("SELECT SUM(CASE WHEN state IN ('ADMITTED','SETTLING','QUARANTINED') THEN 1 ELSE 0 END) AS used,SUM(CASE WHEN state='QUEUED' THEN 1 ELSE 0 END) AS queued,SUM(CASE WHEN state NOT IN ('ADMITTED','SETTLING','QUARANTINED','QUEUED','RELEASED','CANCELLED') THEN 1 ELSE 0 END) AS unavailable FROM capacity_leases");
        const endpoint = receiverTransmissionHolds(s, { family: sourceSnapshotFamily, target: { ref: anchor.destinationRef, canonicalPath: anchor.commonDirectory, device: anchor.device, inode: anchor.inode } }, anchor.operationId, 1);
        const busy = !ownRun && this.h.busy(anchor.workId), holds: string[] = [];
        if (!work?.data || !work.lineage || work.id !== anchor.workId || work.project !== anchor.projectId || work.source !== anchor.sourceId || work.epoch !== anchor.epoch || work.generation !== anchor.generation || !['ACTIVE','DELIVERED'].includes(work.state)) holds.push('Original work/source/epoch/generation is unavailable');
        if (!source?.id || !source.origin || !source.raw) holds.push('Original bounded work source unavailable');
        try {
            if ([JSON.parse(work?.data),JSON.parse(source?.origin)].some(value => !value || typeof value !== 'object' || Array.isArray(value))) holds.push('Original work/source provenance must be objects');
        } catch { holds.push('Original bounded work/source provenance unavailable'); }
        if (busy || cleanup || workCapacity || preview) holds.push('Original producer, preview, reservation or cleanup remains unsettled');
        if (budgets.length !== 2 || budgets.some(b => !['lim','consumed','reserved'].every(k => Number.isSafeInteger(b[k]) && b[k] >= 0) || b.reserved !== (ownRun && b.kind === 'execution' ? 1 : 0) || b.consumed + b.reserved > b.lim)) holds.push('Original execution/resolution allowance invalid or reserved');
        const execution = budgets.find(b => b.kind === 'execution');
        if (!ownRun && execution && execution.consumed + execution.reserved >= execution.lim) holds.push('Retained execution allowance exhausted; review remains free');
        if (!ownRun && ((capacity.used ?? 0) >= this.h.capacityLimit || (capacity.queued ?? 0)) || (capacity.unavailable ?? 0)) holds.push('Runnable capacity unavailable; no source attempt reserved');
        if (endpoint.length) holds.push('Original endpoint transmission requires reconciliation: ' + endpoint[0]!.id);
        return { work, source, budgets, cleanup, workCapacity, preview, capacity, endpoint, busy, holds };
    }
    review(input: Request, controls: SourceNativeProfileControls & { signal?: AbortSignal } = {}) {
        const selectedProfile = captureSourceNativeProfile(controls);
        const captured = structuredClone(input), signal = AbortSignal.any([this.shutdown.signal, ...controls.signal ? [controls.signal] : []]);
        this.request(captured);
        return this.track(async () => {
            signal.throwIfAborted();
            const original = this.original(captured);
            if (original) return { kind: 'original' as const, original };
            this.writer.prepare();
            const proof = await this.h.proposals.captureActionProposal(captured, signal, selectedProfile); signal.throwIfAborted();
            const context = this.context(proof.anchor), writer = this.writer.assertCurrent(); proof.assertCurrent();
            return { kind: 'review' as const, binding: structuredClone(proof.anchor), holds: [...context.holds], canAdopt: !context.holds.length,
                execution: context.budgets.find(b => b.kind === 'execution'), fingerprint: hash({ binding: proof.anchor, context, writer }),
                nativeFacts: 'Historical conditional native observations; adoption does not send' as const };
        });
    }
    adopt(input: Request & { expectedReviewFingerprint: string }, controls: SourceNativeProfileControls & { validate: () => void; signal?: AbortSignal; onAllocated?: (id: string) => void }) {
        const selectedProfile = captureSourceNativeProfile(controls);
        const captured = structuredClone(input), validate = controls.validate, allocated = controls.onAllocated;
        const signal = AbortSignal.any([this.shutdown.signal, ...controls.signal ? [controls.signal] : []]);
        if (!sourceSnapshotFields(captured, ['workId','proposalId','expectedReviewFingerprint']) || !sourceSnapshotDigest(captured.expectedReviewFingerprint) || typeof validate !== 'function') throw Error('Exact reviewed source adoption and synchronous owner decision required');
        const request = { workId: captured.workId, proposalId: captured.proposalId }; this.request(request);
        return this.track(async () => {
            const ownerDecision = () => { const result: unknown = validate(); if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('Source owner decision must be synchronous without a return value'); } signal.throwIfAborted(); this.open(); };
            signal.throwIfAborted(); this.open();
            const existing = this.original(request);
            if (existing) {
                if (existing.adoption.reviewFingerprint !== captured.expectedReviewFingerprint) throw Error('Original source operation already exists; inspect its exact owner decision');
                return existing;
            }
            this.writer.prepare();
            const proof = await this.h.proposals.captureActionProposal(request, signal, selectedProfile); signal.throwIfAborted();
            const targetId = randomUUID(), grantId = randomUUID(), receiptId = randomUUID(), anchor = proof.anchor, bindingDigest = hash(anchor);
            let inserted = false;
            const original = this.h.store.tx(() => {
                ownerDecision();
                const writer = this.writer.assertCurrent();
                const raced = this.original(request);
                if (raced) {
                    if (raced.adoption.reviewFingerprint !== captured.expectedReviewFingerprint) throw Error('Conflicting original source owner decision');
                    return raced;
                }
                proof.assertCurrent();
                const context = this.context(anchor);
                if (context.holds.length) throw Error(context.holds.join('; '));
                if (hash({ binding: anchor, context, writer }) !== captured.expectedReviewFingerprint) throw Error('Source adoption review changed; inspect the exact proposal again');
                const event: SourceSnapshotAdoption = { kind: sourceSnapshotOwnerReceipt, version: 1, workId: anchor.workId, operationId: anchor.operationId,
                    targetId, grantId, bindingDigest, sourceDigest: hash(context.source), workContextDigest: hash({ lineage: context.work.lineage, predecessor: context.work.predecessor, data: context.work.data }),
                    reviewFingerprint: captured.expectedReviewFingerprint, scope: 'work', mode: 'ordinary', operationLimit: 1, writer };
                const target = { kind: sourceSnapshotFamily, version: 1, targetId, binding: anchor };
                const grant = { kind: sourceSnapshotFamily, version: 1, scope: 'work', mode: 'ordinary', operationLimit: 1, adoption: receiptId, bindingDigest };
                const operation = { kind: sourceSnapshotFamily, version: 1, adoption: receiptId, bindingDigest };
                if (Buffer.byteLength(JSON.stringify(target)) > 131072 || Buffer.byteLength(JSON.stringify(event)) > 1048576) throw Error('Source adoption exceeds bounded record profile');
                this.h.store.run('INSERT INTO effect_targets VALUES(?,?,?)', targetId, anchor.projectId, JSON.stringify(target));
                this.h.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grantId, anchor.workId, targetId, 1, JSON.stringify(grant));
                this.h.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', anchor.operationId, anchor.workId, targetId, grantId, 'PREPARED', JSON.stringify(operation));
                this.h.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', receiptId, anchor.operationId, sourceSnapshotOwnerReceipt, JSON.stringify(event));
                // No external callback after the final owner decision/proofs.
                this.writer.assertCurrent(); proof.assertCurrent(); signal.throwIfAborted();
                const retained = inspectSourceSnapshotRecord(this.h.store, this.h.home, anchor.operationId);
                if (retained.state !== 'RETAINED') throw Error('Source owner adoption correspondence failed: ' + retained.reason);
                inserted = true;
                return retained;
            });
            if (inserted && allocated) try {
                const result: unknown = allocated(original.operationId);
                if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('Source allocation notification must be synchronous'); }
            } catch { throw new ControllerError('SOURCE_SNAPSHOT_ADOPTED', 'Original source operation ' + original.operationId + ' retained after owner notification failure', 'Inspect original source operation ' + original.operationId + '; no replacement permission or send occurred', anchor.workId); }
            return original;
        });
    }
    private retained(operationId: string): Original {
        const original = inspectSourceSnapshotRecord(this.h.store,this.h.home,operationId);
        if (original.state !== 'RETAINED') throw Error('Original source operation unavailable: ' + original.reason);
        return original;
    }
    private readContext(original:Original,runId?:string){
        this.open();const s=this.h.store,a=original.binding,work=sourceReadWork(s,original.workId),own=runId?this.h.ownsRun(work.id,a.operationId,runId):false;
        if(runId&&!own)throw Error('Exact original read handle unavailable');
        const budgets=s.all("SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') ORDER BY kind",work.lineage);
        const cleanup=s.one(`SELECT 1 AS present FROM runs r JOIN works w ON w.id=r.work WHERE w.lineage=? AND r.id!=? AND (r.phase NOT IN ('SETTLED','INTERRUPTED') OR r.reservation NOT IN ('released','consumed') OR NOT CASE WHEN json_valid(r.data) THEN COALESCE(json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','confirmed','unbound'),0) ELSE 0 END) LIMIT 1`,work.lineage,runId??'');
        const leases=s.one("SELECT 1 AS present FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.run!=? AND c.state NOT IN ('RELEASED','CANCELLED') LIMIT 1",work.lineage,runId??'');
        const previews=s.one("SELECT 1 AS present FROM source_branch_previews p JOIN works w ON w.id=p.work WHERE w.lineage=? AND p.state!='SETTLED' LIMIT 1",work.lineage);
        const room=s.one("SELECT COUNT(*) AS used FROM capacity_leases WHERE state IN ('ADMITTED','SETTLING','QUARANTINED')"),queued=s.one("SELECT 1 AS present FROM capacity_leases WHERE state='QUEUED' LIMIT 1");
        const unavailable=s.one("SELECT 1 AS present FROM capacity_leases WHERE state NOT IN ('ADMITTED','SETTLING','QUARANTINED','QUEUED','RELEASED','CANCELLED') LIMIT 1");
        const receipts=s.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?',a.operationId),holds:string[]=[];
        if(work.project!==a.projectId)holds.push('Original source project identity changed');
        if(!['UNKNOWN','CONFIRMED'].includes(original.recordedPhase))holds.push('Original creation is neither uncertain nor confirmed; result check unavailable');
        if(!original.nativeAttempt?.intent)holds.push('Original prepared send intent unavailable; read cannot manufacture causality');
        if(original.nativeReads.some(r=>r.pointer.runId!==runId&&!r.settlement))holds.push('Original read settlement requires owned recovery');
        if(!own&&this.h.busy(work.id)||cleanup||leases||previews)holds.push('Original resources remain unsettled');
        if(budgets.length!==2||budgets.some(b=>!['lim','consumed','reserved'].every(k=>Number.isSafeInteger(b[k])&&b[k]>=0)||b.reserved!==(own&&b.kind==='execution'?1:0)||b.consumed+b.reserved>b.lim)||!own&&budgets.some(b=>b.kind==='execution'&&b.consumed>=b.lim))holds.push('Original finite read allowance unavailable');
        if(!own&&(room.used>=this.h.capacityLimit||queued))holds.push('Runnable read capacity unavailable');
        if(unavailable)holds.push('Runnable capacity provenance unavailable');
        if(!own&&(original.nativeReads.length>=8||receipts.n>20||receipts.bytes+sourceReadReceiptRoom>1048576))holds.push('Original bounded read receipt room unavailable');
        return {work,budgets,cleanup,leases,previews,room,queued,unavailable,receipts,holds};
    }
    private readFingerprint(original:Original,proof:SourceSnapshotDispatch['proof'],context:ReturnType<SourceSnapshotActions['readContext']>){
        return hash({original,profile:proof.native.profile,context,writer:this.writer.assertCurrent()});
    }
    reviewReconciliation(operationId:string,controls:SourceNativeProfileControls & {signal?:AbortSignal}={}){
        const selectedProfile = captureSourceNativeProfile(controls);
        const signal=AbortSignal.any([this.shutdown.signal,...controls.signal?[controls.signal]:[]]);
        return this.track(async()=>{
            this.writer.prepare();const original=this.retained(operationId);
            const proof=await this.h.proposals.captureReadProposal({workId:original.workId,proposalId:original.binding.proposalId},original.binding,signal,selectedProfile);
            const context=this.readContext(original);proof.assertScope();
            if(original.nativeAttempt?.intent)assertSourceBranchPrepared(proof.native.initialized,proof.native.input,original.nativeAttempt.intent.prepared);
            return {operationId,workId:original.workId,original,holds:context.holds,canRead:!context.holds.length,execution:context.budgets.find(b=>b.kind==='execution'),fingerprint:this.readFingerprint(original,proof,context),nativeFacts:'Historical original only; this review does not query Native' as const};
        });
    }
    repeatedReconciliation(input:{operationId:string;expectedReviewFingerprint:string}){
        const original=this.retained(input.operationId);
        return original.nativeReads.some(r=>r.admission.reviewFingerprint===input.expectedReviewFingerprint)?original:null;
    }
    prepareReconciliation(input:{operationId:string;expectedReviewFingerprint:string},controls:SourceNativeProfileControls & {validate:()=>void;signal?:AbortSignal}){
        const selectedProfile = captureSourceNativeProfile(controls);
        const request=structuredClone(input),validate=controls.validate,signal=AbortSignal.any([this.shutdown.signal,...controls.signal?[controls.signal]:[]]);
        if(!sourceSnapshotFields(request,['operationId','expectedReviewFingerprint'])||!sourceSnapshotDigest(request.expectedReviewFingerprint)||typeof validate!=='function')throw Error('Exact original reviewed source read required');
        return this.track(async()=>{
            const repeated=this.repeatedReconciliation(request);if(repeated)return {kind:'original' as const,original:repeated};
            this.writer.prepare();const original=this.retained(request.operationId);
            const proof=await this.h.proposals.captureReadProposal({workId:original.workId,proposalId:original.binding.proposalId},original.binding,signal,selectedProfile);
            const raced=this.repeatedReconciliation(request);if(raced)return {kind:'original' as const,original:raced};
            const context=this.readContext(original);
            if(context.holds.length)throw Error(context.holds.join('; '));
            if(this.readFingerprint(original,proof,context)!==request.expectedReviewFingerprint)throw Error('Original source read review changed');
            const dispatch:SourceSnapshotDispatch={purpose:'read',original,proof,signal,validate,runId:null,outcome:{prepared:null,send:null,readback:null,reason:'Source read has not entered'},result:null,
                read:{id:randomUUID(),work:context.work,reviewFingerprint:request.expectedReviewFingerprint,policy:null}};
            this.assertDispatch(dispatch);return {kind:'ready' as const,dispatch};
        });
    }
    private reserveRead(d:SourceSnapshotDispatch,runId:string){
        if(!this.h.store.db.isTransaction||d.runId||!d.read)throw Error('Original source read reservation transaction required');
        this.assertDispatch(d);const current=this.bound(d),context=this.readContext(current);
        if(context.holds.length||this.readFingerprint(current,d.proof,context)!==d.read.reviewFingerprint)throw Error('Original source read review changed before reservation');
        const a=current.binding,intent=current.nativeAttempt!.intent!;
        assertSourceBranchPrepared(d.proof.native.initialized,d.proof.native.input,intent.prepared);
        const id=randomUUID(),writer=this.writer.assertCurrent(),event:SourceReadAdmission={protocol:'source-native-read/v1',kind:'source-native-read-admission',operationId:a.operationId,
            adoptionId:this.h.store.one("SELECT json_extract(data,'$.adoption') AS id FROM effect_operations WHERE id=?",a.operationId).id,bindingDigest:hash(a),readId:d.read.id,runId,writer,work:d.read.work,
            creationIntentId:current.nativeAttempt!.attempt.intentId!,prepared:structuredClone(intent.prepared),originalAttemptDigest:hash(current.nativeAttempt!.attempt),initializedDigest:a.initializedDigest,namespace:d.proof.native.initialized.namespace,profileDigest:hash(d.proof.native.profile),reviewFingerprint:d.read.reviewFingerprint};
        const row=this.h.store.one('SELECT phase,data FROM effect_operations WHERE id=?',a.operationId),data=JSON.parse(row.data);
        if(![2,3].includes(data.version)||!['UNKNOWN','CONFIRMED'].includes(row.phase))throw Error('Original source creation requires terminal uncertainty before read');
        const pointer={id:d.read.id,runId,admissionId:id,settlementId:null};
        this.h.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...data,version:3,creationPhase:data.version===3?data.creationPhase:row.phase,reads:[...(data.reads??[]),pointer]}),a.operationId);
        this.h.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,a.workId,event.work.epoch,event.work.generation,'CREATED',event.namespace.clientRoot,'reserved',JSON.stringify({kind:'native-effect',nativeFamily:'source-snapshot',familyVersion:1,sourcePurpose:'read',operationId:a.operationId,clientRoot:event.namespace.clientRoot,controllerPid:writer.owner.pid,bindingDigest:hash(a),nativeReadId:d.read.id,nativeReadAdmissionId:id,readWorkDigest:hash(event.work),nativeGate:'unopened',admission:'never-admitted'}));
        this.event(a.operationId,id,event);this.writer.assertCurrent();d.proof.assertScope();
    }
    async executeRead(d:SourceSnapshotDispatch,client:Pick<NativeGitClient,'observeSourceReadTarget'|'reconcileSourceBranchCreate'>,signal:AbortSignal){
        try{
            this.assertNativeDispatch(d);signal.throwIfAborted();const a=d.proof.anchor,original=d.proof.native.input;
            const target=await client.observeSourceReadTarget({targetId:original.target.targetId,path:a.projectRoot,destinationRef:a.destinationRef},original.target.environment,signal);
            const directory=target.identity.find(p=>p.path===a.commonDirectory&&p.kind==='directory');
            if(target.commonDirectory!==a.commonDirectory||directory?.device!==a.device||directory.inode!==a.inode||directory.ownerUid!==d.proof.native.initialized.namespace.ownerUid||hash(target.environment)!==a.routeDigest)throw Error('Original read receiver identity changed');
            d.read!.policy={fingerprint:target.policyFingerprint,commonDirectory:a.commonDirectory,device:a.device,inode:a.inode,ownerUid:directory.ownerUid,routeDigest:a.routeDigest};
            this.assertNativeDispatch(d);signal.throwIfAborted();
            d.outcome.readback=await client.reconcileSourceBranchCreate({...original,target},d.original.nativeAttempt!.intent!.prepared,signal);
            d.outcome.reason=d.outcome.readback.reason??'Original causal source read completed';
        }catch(error){d.outcome.reason=sourceAttemptReason(error);throw error;}
    }
    private settleRead(d:SourceSnapshotDispatch,cleanup:SourceReadSettlement['cleanup']){
        this.h.store.tx(()=>{
            this.writer.assertCurrent();const current=this.bound(d),read=current.nativeReads.find(r=>r.pointer.id===d.read!.id);
            if(!read||read.settlement)throw Error('Exact original unsettled read required');
            const classification=cleanup==='removed'&&d.outcome.readback?.kind==='confirmed-creation'?'confirmed':'unknown';
            const id=randomUUID(),event:SourceReadSettlement={protocol:'source-native-read/v1',kind:'source-native-read-settlement',operationId:current.operationId,adoptionId:read.admission.adoptionId,bindingDigest:hash(current.binding),readId:d.read!.id,runId:d.runId!,writer:this.writer.assertCurrent(),admissionId:read.pointer.admissionId,readback:d.outcome.readback,policy:d.read!.policy,cleanup,classification,reason:sourceAttemptReason(d.outcome.reason)};
            this.event(current.operationId,id,event);
            const row=this.h.store.one('SELECT phase,data FROM effect_operations WHERE id=?',current.operationId),data=JSON.parse(row.data);
            this.h.store.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?',classification==='confirmed'?'CONFIRMED':row.phase,JSON.stringify({...data,reads:data.reads.map((r:any)=>r.id===d.read!.id?{...r,settlementId:id}:r)}),current.operationId);
            this.writer.assertCurrent();d.result=this.retained(current.operationId);
        });
    }
    prepareDispatch(operationId: string, controls: SourceNativeProfileControls & { validate: () => void; signal?: AbortSignal }) {
        const selectedProfile = captureSourceNativeProfile(controls);
        const validate = controls.validate;
        if (typeof validate !== 'function') throw Error('Synchronous owner source decision required');
        const signal = AbortSignal.any([this.shutdown.signal,...controls.signal ? [controls.signal] : []]);
        return this.track(async () => {
            const original = this.retained(operationId);
            // Repetition is historical lookup, never an implicit next attempt.
            if (original.nativeAttempt) return { kind:'original' as const, original };
            this.writer.prepare(); signal.throwIfAborted();
            const proof = await this.h.proposals.captureActionProposal({workId:original.workId,proposalId:original.binding.proposalId},signal,selectedProfile);
            const dispatch: SourceSnapshotDispatch = { purpose:'create',original, proof, signal, validate, runId:null,
                outcome:{prepared:null,send:null,readback:null,reason:'Source send has not entered'},result:null };
            this.assertDispatch(dispatch);
            return {kind:'ready' as const,dispatch};
        });
    }
    private decision(d: SourceSnapshotDispatch) {
        const result: unknown = d.validate();
        if (result !== undefined) { void Promise.resolve(result).catch(()=>{}); throw Error('Source owner decision must be synchronous without a return value'); }
        d.signal.throwIfAborted(); this.open();
    }
    private bound(d: SourceSnapshotDispatch) {
        const current = this.retained(d.original.operationId);
        if (hash(current.binding) !== hash(d.original.binding) || hash(current.binding) !== hash(d.proof.anchor) || hash(current.adoption) !== hash(d.original.adoption) || current.targetId !== d.original.targetId || current.grantId !== d.original.grantId ||
            d.purpose==='create'&&(d.runId && current.nativeAttempt?.attempt.runId !== d.runId || !d.runId && current.nativeAttempt) ||
            d.purpose==='read'&&(hash(current.nativeAttempt)!==hash(d.original.nativeAttempt)||d.runId&&!current.nativeReads.some(r=>r.pointer.runId===d.runId&&r.pointer.id===d.read!.id))) throw Error('Original source operation/attempt changed');
        return current;
    }
    assertDispatch(d: SourceSnapshotDispatch, full = false) {
        // Every external callback precedes the final actual source/proof fence.
        this.decision(d);
        if(d.purpose==='read'){
            this.bound(d);const context=this.readContext(d.original,d.runId??undefined);
            if(context.holds.length)throw Error(context.holds.join('; '));
            if(hash(context.work)!==hash(d.read!.work))throw Error('Original historical read work/source changed');
            this.writer.assertCurrent();d.proof.assertScope();return;
        }
        const current = this.bound(d), context = this.context(d.proof.anchor,d.runId ?? undefined);
        if (context.holds.length) throw Error(context.holds.join('; '));
        if (hash(context.source) !== current.adoption.sourceDigest || hash({lineage:context.work.lineage,predecessor:context.work.predecessor,data:context.work.data}) !== current.adoption.workContextDigest) throw Error('Original owner work/source context changed');
        if (d.runId && !['RESERVED','INVOKING'].includes(current.recordedPhase)) throw Error('Source attempt is already settled');
        this.writer.assertCurrent();
        if (full) d.proof.assertCurrent(); else d.proof.assertScope();
    }
    assertNativeDispatch(d:SourceSnapshotDispatch){
        // Reads use logical standing. After a prepared send exists, repeat the
        // actual capture metadata fence AFTER the final owner callback too.
        this.assertDispatch(d,d.outcome.prepared!==null && d.outcome.send===null);
        const run=this.h.store.one('SELECT * FROM runs WHERE id=?',d.runId!),data=JSON.parse(run.data),lease=this.h.store.one('SELECT * FROM capacity_leases WHERE run=? AND id=?',run.id,data.capacityId);
        if(data.nativeGate!=='enabled' || data.admission!=='admitted' || run.reservation!=='reserved' || !['CREATED','RUNNING'].includes(run.phase) || !lease || lease.state!=='ADMITTED' || JSON.parse(lease.data).admitted!==true)throw Error('Actual original source Native gate/lease unavailable');
    }
    /** Called inside the shared execution-reservation transaction. */
    reserveDispatch(d: SourceSnapshotDispatch, runId: string) {
        if(d.purpose==='read')return this.reserveRead(d,runId);
        if (!this.h.store.db.isTransaction || d.runId) throw Error('Single original source reservation transaction required');
        this.assertDispatch(d,true);
        const s=this.h.store, a=d.proof.anchor, admissionId=randomUUID(), writer=this.writer.assertCurrent();
        const work=s.one('SELECT state FROM works WHERE id=?',a.workId);
        const event: SourceNativeAdmission = {protocol:'source-native-attempt/v1',kind:'source-native-admission',operationId:a.operationId,
            adoptionId:this.h.store.one('SELECT json_extract(data,\'$.adoption\') AS id FROM effect_operations WHERE id=?',a.operationId).id,
            bindingDigest:hash(a),revision:1,runId,writer,initializedDigest:a.initializedDigest,namespace:structuredClone(d.proof.native.initialized.namespace),
            originalWorkState:work.state,sourceId:a.sourceId,epoch:a.epoch,generation:a.generation};
        s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,a.workId,a.epoch,a.generation,'CREATED',event.namespace.clientRoot,'reserved',JSON.stringify({kind:'native-effect',nativeFamily:sourceSnapshotFamily,familyVersion:1,operationId:a.operationId,clientRoot:event.namespace.clientRoot,controllerPid:writer.owner.pid,bindingDigest:hash(a),attemptRevision:1,nativeAdmissionId:admissionId,nativeGate:'unopened',admission:'never-admitted'}));
        s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','RESERVED',JSON.stringify({kind:sourceSnapshotFamily,version:2,adoption:event.adoptionId,bindingDigest:hash(a),attempt:{revision:1,runId,admissionId,intentId:null,settlementId:null}}),a.operationId);
        this.event(a.operationId,admissionId,event);
        this.writer.assertCurrent(); d.proof.assertCurrent(); d.signal.throwIfAborted();
    }
    enableDispatch(d: SourceSnapshotDispatch) {
        this.h.store.tx(()=>{
            this.assertDispatch(d,true);
            const current=this.bound(d),run=this.h.store.one('SELECT * FROM runs WHERE id=?',d.runId!),data=JSON.parse(run.data);
            const lease=this.h.store.one('SELECT * FROM capacity_leases WHERE run=? AND id=?',run.id,data.capacityId);
            if (!current.nativeAttempt || d.purpose==='create'&&current.nativeAttempt.attempt.intentId || data.nativeGate!=='unopened' || !lease || lease.state!=='ADMITTED' || JSON.parse(lease.data).admitted!==true || data.admission!=='admitted') throw Error('Original admitted source Native gate unavailable');
            this.h.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...data,nativeGate:'enabled'}),run.id);
            this.writer.assertCurrent(); d.proof.assertCurrent();
        });
    }
    private event(operationId: string,id: string,event: unknown) {
        const data=JSON.stringify(event),size=this.h.store.one('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?',operationId);
        const version=this.h.store.one("SELECT json_extract(data,'$.version') AS v FROM effect_operations WHERE id=?",operationId).v;
        if (size.n>=(version===3?22:6) || Buffer.byteLength(data)+size.bytes>1048576) throw Error('Original source attempt receipt profile exhausted');
        this.h.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)',id,operationId,(event as {kind:string}).kind,data);
    }
    private common(d: SourceSnapshotDispatch) {
        const current=this.bound(d);
        if (!current.nativeAttempt) throw Error('Original admitted source attempt unavailable');
        return {protocol:'source-native-attempt/v1' as const,operationId:current.operationId,adoptionId:this.h.store.one('SELECT json_extract(data,\'$.adoption\') AS id FROM effect_operations WHERE id=?',current.operationId).id as string,
            bindingDigest:hash(current.binding),revision:1 as const,runId:current.nativeAttempt.attempt.runId,writer:this.writer.assertCurrent()};
    }
    async executeDispatch(d: SourceSnapshotDispatch, client: SourceSnapshotNativeClient, runSignal: AbortSignal) {
        const handoff=new AbortController(),signal=AbortSignal.any([d.signal,runSignal,handoff.signal]);
        const native=d.proof.native;let handle:PreparedSourceBranchCreate|undefined,invoked=false;
        try {
            this.assertDispatch(d,true);signal.throwIfAborted();
            handle=await client.prepareSourceBranchCreate(native.input,signal);
            d.outcome.prepared=client.preparedSourceReference(handle);
            this.h.store.tx(()=>{
                this.assertNativeDispatch(d);d.proof.assertCurrent();signal.throwIfAborted();
                const current=this.bound(d),attempt=current.nativeAttempt!.attempt;
                if (current.recordedPhase!=='RESERVED' || attempt.intentId || attempt.settlementId) throw Error('Original source already entered send intent');
                assertSourceBranchPrepared(native.initialized,native.input,d.outcome.prepared!);
                const id=randomUUID(),event:SourceNativeIntent={...this.common(d),kind:'source-native-send-intent',admissionId:attempt.admissionId,prepared:structuredClone(d.outcome.prepared!)};
                this.event(current.operationId,id,event);
                const data=JSON.parse(this.h.store.one('SELECT data FROM effect_operations WHERE id=?',current.operationId).data);
                this.h.store.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','INVOKING',JSON.stringify({...data,attempt:{...attempt,intentId:id}}),current.operationId);
                this.writer.assertCurrent();d.proof.assertCurrent();signal.throwIfAborted();
            });
            // No awaited work or external callback between durable intent and
            // once-only handoff. Native repeats its own final admission fence.
            invoked=true;d.outcome.send=await client.spawnPreparedSourceBranchCreate(handle);
            if (d.outcome.send.handoff==='started') d.outcome.readback=await client.reconcileSourceBranchCreate(native.input,d.outcome.send,signal);
            d.outcome.reason=d.outcome.send.reason ?? d.outcome.readback?.reason ?? 'Original source native observations retained';
        } catch(error) {
            handoff.abort(error); // Abort BEFORE settling an unused prepared handle.
            if (handle && !invoked) {
                invoked=true;
                try { d.outcome.send=await client.spawnPreparedSourceBranchCreate(handle); }
                catch(settlementError) { d.outcome.reason='Original source failure '+String(error)+'; unused handle settlement '+String(settlementError);throw new AggregateError([error,settlementError],'Source preparation and unused-handle settlement failed'); }
            }
            d.outcome.reason=sourceAttemptReason(error);
            throw error;
        }
    }
    /** Factual settlement deliberately does not invoke UI/standing/admission guards. */
    assertSettlementWriter(d:SourceSnapshotDispatch){this.writer.assertCurrent();this.bound(d);}
    settleDispatch(d: SourceSnapshotDispatch,cleanup:'removed'|'not-allocated'|'quarantined') {
        if(d.purpose==='read')return this.settleRead(d,cleanup);
        this.h.store.tx(()=>{
            this.writer.assertCurrent();const current=this.bound(d),attempt=current.nativeAttempt!.attempt,native=d.proof.native;
            if (attempt.settlementId) throw Error('Original source attempt already settled');
            let classification:SourceNativeSettlement['classification']='unknown';
            if (cleanup!=='quarantined') {
                if (d.outcome.send?.handoff==='started' && d.outcome.send.outcome==='created' && d.outcome.readback?.kind==='confirmed-creation') classification='confirmed';
                else if (!attempt.intentId && !d.outcome.prepared && !d.outcome.send) classification='definitely-unsent';
                else if (d.outcome.prepared && d.outcome.send?.handoff==='not-started' && d.outcome.send.notStarted) {
                    try {assertSourceBranchPrepared(native.initialized,native.input,d.outcome.prepared);assertSourceBranchNoLaunch(native.initialized,native.input,d.outcome.send.notStarted);classification='definitely-unsent';} catch { /* Original no-launch fact unavailable, never retry from a scalar. */ }
                }
            }
            const id=randomUUID(),event:SourceNativeSettlement={...this.common(d),kind:'source-native-settlement',admissionId:attempt.admissionId,intentId:attempt.intentId,
                ...structuredClone(d.outcome),reason:sourceAttemptReason(d.outcome.reason),cleanup,classification};
            this.event(current.operationId,id,event);
            const data=JSON.parse(this.h.store.one('SELECT data FROM effect_operations WHERE id=?',current.operationId).data);
            this.h.store.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?',classification==='confirmed'?'CONFIRMED':classification==='definitely-unsent'?'REFUSED':'UNKNOWN',JSON.stringify({...data,attempt:{...attempt,settlementId:id}}),current.operationId);
            if (cleanup==='quarantined') this.hold(current,attempt.admissionId);
            this.writer.assertCurrent();d.result=this.retained(current.operationId);
        });
    }
    private hold(current: Original,admissionId:string) {
        const a=current.binding,admission=current.nativeAttempt!.admission;
        const changed=this.h.store.run('UPDATE works SET state=? WHERE id=? AND state=? AND source=? AND epoch=? AND generation=?','UNKNOWN',a.workId,admission.originalWorkState,a.sourceId,a.epoch,a.generation);
        if (!changed.changes) return;
        const {protocol,operationId,adoptionId,bindingDigest,revision,runId}=admission;
        const event:SourceNativeHold={protocol,operationId,adoptionId,bindingDigest,revision,runId,kind:'source-native-resource-hold',admissionId,priorState:admission.originalWorkState,writer:this.writer.assertCurrent()};
        this.event(current.operationId,randomUUID(),event);
    }
    async cleanupDispatch(d: SourceSnapshotDispatch) {
        const proof=await reconcileOwnedGitProcesses(d.proof.native.initialized.namespace.clientRoot,2500,d.proof.native.initialized.namespace);
        const data=JSON.parse(this.h.store.one('SELECT data FROM runs WHERE id=?',d.runId!).data);
        return proof.cleanup==='confirmed' ? data.nativeGate==='unopened' ? 'not-allocated' as const : 'removed' as const : 'quarantined' as const;
    }
    releaseUnadmitted(d: SourceSnapshotDispatch) {
        this.writer.assertCurrent();const current=this.bound(d),run=this.h.store.one('SELECT * FROM runs WHERE id=?',d.runId!),data=JSON.parse(run.data);
        if (!current.nativeAttempt || d.purpose==='create'&&current.nativeAttempt.attempt.intentId || data.nativeGate!=='unopened' || data.admission!=='never-admitted' || this.h.store.one('SELECT id FROM capacity_leases WHERE run=?',run.id)) return;
        if (run.reservation==='reserved') {
            const work=this.h.store.one('SELECT lineage FROM works WHERE id=?',run.work);
            this.h.store.run('UPDATE budgets SET reserved=reserved-1 WHERE lineage=? AND kind=?',work.lineage,'execution');
            this.h.store.run('UPDATE runs SET reservation=? WHERE id=?','released',run.id);
        }
    }
    /** Startup process settlement only. It never opens Native or sends. */
    async recoverRun(run: any) {
        this.writer.prepare();
        const data=JSON.parse(run.data);let original:Original;
        try{original=this.retained(data.operationId);}
        catch(error){this.writer.assertCurrent();this.h.store.tx(()=>{this.h.patchRun(run.id,'UNKNOWN',{cleanup:'quarantined',sourceRecovery:'unavailable-original',sourceRecoveryReason:sourceAttemptReason(error)});this.writer.assertCurrent();});return 'quarantined' as const;}
        if(data.sourcePurpose==='read')return this.recoverReadRun(run,original);
        if(!original.nativeAttempt || original.nativeAttempt.attempt.runId!==run.id || this.h.busy(run.work) || !samePreviewDatabaseScope(original.nativeAttempt.admission.writer,this.writer.assertCurrent()))throw Error('Original inactive source run recovery required');
        const recorded=hash({operation:this.h.store.one('SELECT * FROM effect_operations WHERE id=?',original.operationId),run:this.h.store.one('SELECT * FROM runs WHERE id=?',run.id)});
        const physical=await reconcileOwnedGitProcesses(original.nativeAttempt.admission.namespace.clientRoot,2500,original.nativeAttempt.admission.namespace);
        this.writer.assertCurrent();
        if(recorded!==hash({operation:this.h.store.one('SELECT * FROM effect_operations WHERE id=?',original.operationId),run:this.h.store.one('SELECT * FROM runs WHERE id=?',run.id)}))throw Error('Original source recovery changed across process join');
        const cleanup=physical.cleanup==='confirmed'?data.nativeGate==='unopened'?'not-allocated':'removed':'quarantined';
        const lease=this.h.store.one('SELECT * FROM capacity_leases WHERE run=?',run.id);
        if(cleanup!=='quarantined' && data.nativeGate==='unopened' && data.admission==='never-admitted' && lease?.state==='QUEUED' && JSON.parse(lease.data).admitted===false)this.h.cancelUnadmittedRun(run.id);
        this.h.store.tx(()=>{
            this.writer.assertCurrent();
            const current=this.h.store.one('SELECT * FROM runs WHERE id=?',run.id);
            if(cleanup!=='quarantined' && !lease && data.nativeGate==='unopened' && data.admission==='never-admitted' && current.reservation==='reserved'){
                const work=this.h.store.one('SELECT lineage FROM works WHERE id=?',run.work);
                this.h.store.run('UPDATE budgets SET reserved=reserved-1 WHERE lineage=? AND kind=?',work.lineage,'execution');
                this.h.store.run('UPDATE runs SET reservation=? WHERE id=?','released',run.id);
            }
            this.h.settleBudget(run.id);this.h.patchRun(run.id,cleanup!=='quarantined'?'INTERRUPTED':'UNKNOWN',{cleanup,sourceRecovery:'original-process-join'});
            if(!original.nativeAttempt!.settlement)this.h.store.run('UPDATE effect_operations SET phase=? WHERE id=?','UNKNOWN',original.operationId);
            if(cleanup==='quarantined' && !original.nativeAttempt!.hold)this.hold(original,original.nativeAttempt!.attempt.admissionId);
            this.writer.assertCurrent();
        });
        return cleanup;
    }
    private async recoverReadRun(run:any,original:Original){
        const read=original.nativeReads.find(r=>r.pointer.runId===run.id);
        if(!read||this.h.busy(run.work)||!samePreviewDatabaseScope(read.admission.writer,this.writer.assertCurrent()))throw Error('Original inactive read recovery required');
        const before=hash({op:this.h.store.one('SELECT * FROM effect_operations WHERE id=?',original.operationId),run:this.h.store.one('SELECT * FROM runs WHERE id=?',run.id)});
        const proof=await reconcileOwnedGitProcesses(read.admission.namespace.clientRoot,2500,read.admission.namespace);
        this.writer.assertCurrent();
        if(before!==hash({op:this.h.store.one('SELECT * FROM effect_operations WHERE id=?',original.operationId),run:this.h.store.one('SELECT * FROM runs WHERE id=?',run.id)}))throw Error('Original read recovery changed across process join');
        const data=JSON.parse(run.data),cleanup=proof.cleanup==='confirmed'?data.nativeGate==='unopened'?'not-allocated':'removed':'quarantined';
        const lease=this.h.store.one('SELECT * FROM capacity_leases WHERE run=?',run.id);
        if(cleanup!=='quarantined'&&data.nativeGate==='unopened'&&data.admission==='never-admitted'&&lease?.state==='QUEUED'&&JSON.parse(lease.data).admitted===false)this.h.cancelUnadmittedRun(run.id);
        this.h.store.tx(()=>{
            this.writer.assertCurrent();const current=this.h.store.one('SELECT * FROM runs WHERE id=?',run.id);
            if(cleanup!=='quarantined'&&!lease&&data.nativeGate==='unopened'&&data.admission==='never-admitted'&&current.reservation==='reserved'){
                const work=this.h.store.one('SELECT lineage FROM works WHERE id=?',run.work);
                this.h.store.run('UPDATE budgets SET reserved=reserved-1 WHERE lineage=? AND kind=?',work.lineage,'execution');this.h.store.run('UPDATE runs SET reservation=? WHERE id=?','released',run.id);
            }
            this.h.settleBudget(run.id);this.h.patchRun(run.id,cleanup==='quarantined'?'UNKNOWN':'INTERRUPTED',{cleanup,sourceReadRecovery:'original-process-join'});this.writer.assertCurrent();
        });return cleanup;
    }
    /** After the whole run/capacity batch, normal standing decides restoration. */
    async restorePhysicalHolds() {
        this.writer.prepare();let after=0;const results:{operationId:string;restored:boolean}[]=[];
        for(;;){
            const rows=this.h.store.all(`SELECT rowid AS position,id FROM effect_operations WHERE rowid>? AND length(CAST(data AS BLOB))<=1048576 AND CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='source-snapshot' AND json_extract(data,'$.version') IN (2,3) ELSE 0 END ORDER BY rowid LIMIT 25`,after);
            if(!rows.length)break;
            for(const row of rows){
                after=row.position;const parsed=inspectSourceSnapshotRecord(this.h.store,this.h.home,row.id);
                if(parsed.state!=='RETAINED')continue;
                const original=parsed,attempt=original.nativeAttempt;
                for(const read of original.nativeReads.filter(r=>!r.settlement&&['SETTLED','INTERRUPTED'].includes(r.run.phase)))this.h.store.tx(()=>{
                    const current=this.retained(original.operationId),retained=current.nativeReads.find(r=>r.pointer.id===read.pointer.id);
                    if(!retained||retained.settlement||!['SETTLED','INTERRUPTED'].includes(retained.run.phase)||!['removed','not-allocated'].includes(retained.run.cleanup??'')||!samePreviewDatabaseScope(retained.admission.writer,this.writer.assertCurrent()))throw Error('Original terminal read recovery correspondence unavailable');
                    const id=randomUUID(),a=retained.admission,event:SourceReadSettlement={protocol:a.protocol,kind:'source-native-read-settlement',operationId:a.operationId,adoptionId:a.adoptionId,bindingDigest:a.bindingDigest,readId:a.readId,runId:a.runId,writer:this.writer.assertCurrent(),admissionId:retained.pointer.admissionId,readback:null,policy:null,cleanup:retained.run.cleanup as 'removed'|'not-allocated',classification:'unknown',reason:'Original read interrupted before factual settlement; no Native query or send was replayed'};
                    this.event(a.operationId,id,event);const data=JSON.parse(this.h.store.one('SELECT data FROM effect_operations WHERE id=?',a.operationId).data);
                    this.h.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...data,reads:data.reads.map((r:any)=>r.id===read.pointer.id?{...r,settlementId:id}:r)}),a.operationId);this.writer.assertCurrent();this.retained(a.operationId);
                });
                if(!original.nativeReads.length&&attempt && !attempt.settlement && ['RESERVED','INVOKING'].includes(original.recordedPhase)){
                    const run=this.h.store.one('SELECT phase FROM runs WHERE id=?',attempt.attempt.runId);
                    if(['SETTLED','INTERRUPTED'].includes(run.phase))this.h.store.tx(()=>{
                        const current=this.retained(original.operationId);
                        if(hash(current)!==hash(original))throw Error('Original terminal source checkpoint changed');
                        if(!samePreviewDatabaseScope(attempt.admission.writer,this.writer.assertCurrent()))throw Error('Original terminal source writer scope differs');
                        this.h.store.run('UPDATE effect_operations SET phase=? WHERE id=?','UNKNOWN',original.operationId);
                        this.writer.assertCurrent();
                    });
                }
                if(!attempt?.hold || attempt.restored)continue;
                let restored=false;
                try{
                    const recovery=await this.h.proposals.recoveryInput({workId:original.workId,proposalId:original.binding.proposalId});
                    this.h.store.tx(()=>{
                        const current=this.retained(original.operationId),a=current.binding,hold=current.nativeAttempt?.hold;
                        if(!hold || hold.id!==attempt.hold!.id || current.nativeAttempt?.restored || hash(current.binding)!==hash(original.binding))throw Error('Original physical recovery cause changed');
                        const witness=this.writer.assertCurrent();
                        if(!samePreviewDatabaseScope(hold.event.writer,witness) || this.h.busy(a.workId))throw Error('Current source recovery owner/scope unavailable');
                        const work=this.h.store.one('SELECT * FROM works WHERE id=?',a.workId);
                        if(work.state!=='UNKNOWN' || work.source!==a.sourceId || work.epoch!==a.epoch || work.generation!==a.generation)throw Error('Original held work/source changed');
                        const unsettled=this.h.store.one(`SELECT 1 AS present FROM runs r JOIN works w ON w.id=r.work WHERE w.lineage=? AND (r.phase NOT IN ('SETTLED','INTERRUPTED') OR r.reservation NOT IN ('consumed','released') OR NOT CASE WHEN json_valid(r.data) THEN COALESCE(json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','unbound','confirmed'),0) ELSE 0 END) LIMIT 1`,work.lineage);
                        const leases=this.h.store.one("SELECT 1 AS present FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.state NOT IN ('RELEASED','CANCELLED') LIMIT 1",work.lineage);
                        const previews=this.h.store.one("SELECT 1 AS present FROM source_branch_previews p JOIN works w ON w.id=p.work WHERE w.lineage=? AND p.state!='SETTLED' LIMIT 1",work.lineage);
                        const budgets=this.h.store.all('SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=?',work.lineage);
                        if(unsettled || leases || previews || budgets.length!==2 || budgets.some(b=>!['execution','resolution'].includes(b.kind) || !['lim','consumed','reserved'].every(k=>Number.isSafeInteger(b[k])&&b[k]>=0) || b.reserved!==0 || b.consumed>b.lim))throw Error('Relevant original resources remain unsettled');
                        recovery.assertOriginal();
                        const changed=this.h.store.run('UPDATE works SET state=? WHERE id=? AND state=? AND source=? AND epoch=? AND generation=?',hold.event.priorState,a.workId,'UNKNOWN',a.sourceId,a.epoch,a.generation);
                        if(changed.changes!==1)throw Error('Original physical hold compare-and-set failed');
                        this.h.assertSourceInput(recovery.input); // Normal full proof, inside the tentative-state transaction.
                        const {protocol,operationId,adoptionId,bindingDigest,revision,runId}=current.nativeAttempt!.admission;
                        this.event(operationId,randomUUID(),{protocol,kind:'source-native-resource-restored',operationId,adoptionId,bindingDigest,revision,runId,writer:this.writer.assertCurrent(),admissionId:current.nativeAttempt!.attempt.admissionId,holdId:hold.id});
                        this.writer.assertCurrent();restored=true;
                    });
                }catch{ /* TX rolls back before refusal; UNKNOWN and its original cause survive. */ }
                results.push({operationId:original.operationId,restored});
            }
        }
        return results;
    }
    inspect(operationId: string) { this.open(); return inspectSourceSnapshotRecord(this.h.store,this.h.home,operationId); }
    list(options?: { after?: number; limit?: number }) { this.open(); return listSourceSnapshotRecords(this.h.store,this.h.home,options); }
    quiesce() { this.shutdown.abort(Error('Source owner action host closing')); }
    async close() { this.quiesce(); await Promise.allSettled([...this.tails]); }
}

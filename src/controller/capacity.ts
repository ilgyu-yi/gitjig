import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { CapacityRequest, CapacityLease } from './interaction-types.js';
import { inspectSourceSnapshotRecord, sourceSnapshotOperationId } from './source-snapshot-records.js';
import { SourcePreviewWriter, samePreviewDatabaseScope } from './source-preview-writer.js';
import type { OwnerLease } from './ownership.js';
import { hasNoAllocatedProducer } from './capacity-settlement.js';
import { sourceReadWork } from './source-snapshot-read-records.js';
import { hash } from './change-files.js';
export class CapacityUnavailable extends Error {
    readonly neverAdmitted = true;
}
export class Capacity {
    private readonly sourceWriter:SourcePreviewWriter|undefined;
    private waiting = new Map<string, {
        resolve: (lease: CapacityLease) => void;
        reject: (error: Error) => void;
        detach: () => void;
    }>();
    constructor(private store: Store, readonly limit = 2, private installationHome?: string, sourceOwner?:OwnerLease) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16)
            throw new Error('Runnable capacity must be1..16');
        if(sourceOwner && installationHome)this.sourceWriter=new SourcePreviewWriter(store,installationHome,sourceOwner);
    }
    /** Reconsider existing waiters after a scoped recovery commits a released lease. */
    changed(): void {
        this.pump();
    }
    /** Internal immediate observation admission must not wait behind quarantined resources. */
    observationRoom(): boolean {
        return this.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','SETTLING','QUARANTINED')").n < this.limit && this.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state='QUEUED'").n === 0;
    }
    private admissible(work: any, run: any): boolean {
        if (!work || !run || run.work !== work.id || run.epoch !== work.epoch)
            return false;
        const data = JSON.parse(run.data);
        // Source runs retain their task state. Never let an unknown/malformed
        // source tag borrow the generic ACTIVE producer admission below.
        if (Object.hasOwn(data,'nativeFamily') || data.kind === 'native-effect' && sourceSnapshotOperationId(data.operationId)) {
            if (!this.installationHome || !this.sourceWriter || data.nativeFamily !== 'source-snapshot' || data.sourcePurpose!=='read'&&!['ACTIVE','DELIVERED'].includes(work.state) ||
                !['CREATED','WAITING_CAPACITY'].includes(run.phase) || run.reservation !== 'reserved' || data.nativeGate !== 'unopened' || run.generation !== work.generation) return false;
            const witness=this.sourceWriter.bindCurrent();
            const original = inspectSourceSnapshotRecord(this.store,this.installationHome,data.operationId);
            if(data.sourcePurpose==='read'){
                const read=original.state==='RETAINED'?original.nativeReads.find(r=>r.pointer.runId===run.id&&r.pointer.id===data.nativeReadId):null;
                return !!read&&!read.settlement&&samePreviewDatabaseScope(read.admission.writer,witness)&&hash(read.admission.work)===hash(sourceReadWork(this.store,work.id));
            }
            if(Object.hasOwn(data,'sourcePurpose'))return false;
            const attempt = original.state === 'RETAINED' ? original.nativeAttempt?.attempt : null;
            return original.state === 'RETAINED' && original.recordedPhase === 'RESERVED' && original.binding.workId === work.id && original.binding.projectId === work.project &&
                original.binding.sourceId === work.source && original.binding.epoch === work.epoch && original.binding.generation === work.generation &&
                !!attempt && !!original.nativeAttempt && samePreviewDatabaseScope(original.nativeAttempt.admission.writer,witness) && attempt.runId === run.id && attempt.intentId === null && attempt.settlementId === null;
        }
        if (data.retainedIntegrationRead === true && data.readOnlyObservation !== true) {
            if (!this.installationHome || !['ACTIVE', 'DELIVERED'].includes(work.state) || data.kind !== 'native-effect' || data.readPhase !== 'reconcile' || data.generation !== work.generation || run.generation !== work.generation)
                return false;
            const operation = this.store.one('SELECT * FROM effect_operations WHERE id=?', data.operationId), op = operation && JSON.parse(operation.data);
            if (!operation || operation.work !== work.id || !['UNKNOWN', 'INVOKING'].includes(operation.phase) || !['local-git', 'github-existing-ref'].includes(op.kind ?? 'local-git'))
                return false;
            const root = path.join(this.installationHome, 'effects', operation.id, 'observations', run.id);
            return run.staging === root && data.clientRoot === root;
        }
        if (data.readOnlyObservation !== true)
            return work.state === 'ACTIVE';
        if (work.state !== 'UNKNOWN' || data.kind !== 'native-effect' || data.generation !== work.generation || run.generation !== work.generation)
            return false;
        const operation = this.store.one('SELECT * FROM effect_operations WHERE id=?', data.operationId);
        if (!operation || operation.work !== work.id || operation.phase !== 'UNKNOWN')
            return false;
        const op = JSON.parse(operation.data), target = this.store.one('SELECT data FROM effect_targets WHERE id=?', operation.target);
        if (op.kind !== 'github-existing-ref' || !target || JSON.parse(target.data).kind !== 'github-existing-ref' || op.evidence?.epoch !== work.epoch || op.evidence?.generation !== work.generation || !op.clientRoot)
            return false;
        const original = this.store.one('SELECT * FROM runs WHERE id=?', data.originalRunId);
        if (!original || original.work !== work.id || original.epoch !== work.epoch || original.generation !== work.generation || original.phase !== 'UNKNOWN')
            return false;
        const old = JSON.parse(original.data);
        if (old.kind !== 'native-effect' || old.readOnlyObservation === true || old.retainedIntegrationRead === true || old.operationId !== operation.id || old.cleanup !== 'quarantined' || original.staging !== op.clientRoot || old.clientRoot !== op.clientRoot || !this.store.one("SELECT id FROM capacity_leases WHERE run=? AND state='QUARANTINED'", original.id))
            return false;
        const originalLeases = this.store.all("SELECT id FROM capacity_leases WHERE run=? AND state='QUARANTINED'", original.id);
        if (originalLeases.length !== 1 || old.capacityId !== originalLeases[0].id)
            return false;
        const root = data.retainedIntegrationRead === true && this.installationHome ? path.join(this.installationHome, 'effects', operation.id, 'observations', run.id) : path.join(path.dirname(op.clientRoot), 'observations', run.id);
        return run.staging === root && data.clientRoot === root;
    }
    acquire(request: CapacityRequest): Promise<CapacityLease> {
        const id = randomUUID();
        this.store.tx(() => {
            const work = this.store.one('SELECT * FROM works WHERE id=?', request.workId), run = this.store.one('SELECT * FROM runs WHERE id=?', request.runId);
            if (!this.admissible(work, run) || work.epoch !== request.epoch || run.epoch !== request.epoch)
                throw new Error('Capacity admission has stale work/run provenance');
            const data = JSON.parse(run.data);
            if (data.attainedCapture || data.manifest || data.allocatedNative || data.containerId)
                throw new Error('Capacity must precede capture/native/scope admission');
            const sequence = this.store.one('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM capacity_leases').next;
            this.store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', id, work.id, run.id, request.epoch, sequence, 'QUEUED', JSON.stringify({ admitted: false, kind: request.kind, ownerPid: process.pid }));
            this.store.run('UPDATE runs SET phase=?,data=? WHERE id=?', 'WAITING_CAPACITY', JSON.stringify({ ...data, capacityId: id, admission: 'never-admitted' }), run.id);
        });
        return new Promise((resolve, reject) => {
            const abort = () => this.cancelQueued(id, 'captured caller interrupted before capacity admission');
            request.signal?.addEventListener('abort', abort, { once: true });
            this.waiting.set(id, { resolve, reject, detach: () => request.signal?.removeEventListener('abort', abort) });
            if (request.signal?.aborted)
                abort();
            else
                this.pump();
        });
    }
    private refundUnstarted(row: any) {
        const run = this.store.one('SELECT * FROM runs WHERE id=?', row.run), data = JSON.parse(run.data), lease = JSON.parse(row.data);
        const source=Object.hasOwn(data,'nativeFamily') || sourceSnapshotOperationId(data.operationId);
        if(source){
            if(!this.installationHome || !this.sourceWriter || data.nativeFamily!=='source-snapshot' || data.familyVersion!==1 || data.nativeGate!=='unopened' || !hasNoAllocatedProducer(data))throw Error('Source Native gate cannot establish never-admitted refund');
            const witness=this.sourceWriter.bindCurrent();
            const original=inspectSourceSnapshotRecord(this.store,this.installationHome,data.operationId);
            const read=original.state==='RETAINED'&&data.sourcePurpose==='read'?original.nativeReads.find(r=>r.pointer.runId===run.id&&r.pointer.id===data.nativeReadId):null;
            if(read?read.settlement||!samePreviewDatabaseScope(read.admission.writer,witness):original.state!=='RETAINED' || !original.nativeAttempt || Object.hasOwn(data,'sourcePurpose') || !samePreviewDatabaseScope(original.nativeAttempt.admission.writer,witness) || original.nativeAttempt.attempt.runId!==run.id || original.nativeAttempt.attempt.intentId || original.nativeAttempt.attempt.settlementId)throw Error('Original qualified source queue unavailable');
        }
        if (row.state !== 'QUEUED' || lease.admitted !== false || run.phase !== 'WAITING_CAPACITY' || data.admission !== 'never-admitted' || data.attainedCapture || data.manifest || data.allocatedNative || data.containerId)
            throw new Error('No affirmative never-admitted receipt; reservation remains protected');
        const work = this.store.one('SELECT lineage FROM works WHERE id=?', row.work);
        if (run.reservation === 'reserved') {
            this.store.run('UPDATE budgets SET reserved=reserved-1 WHERE lineage=? AND kind=?', work.lineage, 'execution');
            if(source)this.store.run('UPDATE runs SET reservation=?,phase=?,data=? WHERE id=?','released','INTERRUPTED',JSON.stringify({...data,cleanup:'not-allocated',sourceQueueSettlement:'never-admitted-unopened'}),run.id);
            else this.store.run('UPDATE runs SET reservation=?,phase=? WHERE id=?', 'released', 'INTERRUPTED', run.id);
        }
        const launch = this.store.one('SELECT * FROM role_launches WHERE run=?', run.id);
        if (launch?.resolution_reservation === 'reserved') {
            this.store.run('UPDATE budgets SET reserved=reserved-1 WHERE lineage=? AND kind=?', work.lineage, 'resolution');
            this.store.run('UPDATE role_launches SET resolution_reservation=? WHERE id=?', 'released', launch.id);
        }
        if(source)this.sourceWriter!.assertCurrent();
    }
    private cancelQueued(id: string, reason: string) {
        const row = this.store.one('SELECT * FROM capacity_leases WHERE id=?', id);
        if (row?.state !== 'QUEUED')
            return;
        this.store.tx(() => {
            this.refundUnstarted(row);
            this.store.run('UPDATE capacity_leases SET state=?,data=? WHERE id=?', 'CANCELLED', JSON.stringify({ ...JSON.parse(row.data), reason }), id);
        });
        const waiter = this.waiting.get(id);
        this.waiting.delete(id);
        waiter?.detach();
        waiter?.reject(new CapacityUnavailable(reason));
        this.pump();
    }
    /** Join the existing refund path; callers cannot refund an admitted lease. */
    cancelUnadmittedRun(runId:string){
        const rows=this.store.all('SELECT id,state FROM capacity_leases WHERE run=? LIMIT 2',runId);
        if(rows.length!==1 || rows[0].state!=='QUEUED')throw Error('Exact original queued run required');
        this.cancelQueued(rows[0].id,'Original owner stopped before actual source admission');
    }
    private pumping = false;
    private pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            let used = this.store.one("SELECT COUNT(*) AS used FROM capacity_leases WHERE state IN ('ADMITTED','SETTLING','QUARANTINED')").used;
            for (const row of this.store.all("SELECT * FROM capacity_leases WHERE state='QUEUED' ORDER BY sequence")) {
                if (used >= this.limit)
                    return;
                const waiter = this.waiting.get(row.id);
                if (!waiter)
                    continue;
                const work = this.store.one('SELECT * FROM works WHERE id=?', row.work);
                const run = this.store.one('SELECT * FROM runs WHERE id=?', row.run);
                if (!this.admissible(work, run) || work.epoch !== row.epoch) {
                    this.cancelQueued(row.id, 'Work changed while queued');
                    continue;
                }
                this.store.tx(() => {
                    this.store.run('UPDATE capacity_leases SET state=?,data=? WHERE id=?', 'ADMITTED', JSON.stringify({ ...JSON.parse(row.data), admitted: true }), row.id);
                    const run = this.store.one('SELECT data FROM runs WHERE id=?', row.run);
                    this.store.run('UPDATE runs SET phase=?,data=? WHERE id=?', 'CREATED', JSON.stringify({ ...JSON.parse(run.data), admission: 'admitted' }), row.run);
                });
                used++;
                this.waiting.delete(row.id);
                waiter.detach();
                waiter.resolve({ id: row.id, runId: row.run, release: receipt => this.release(row.id, receipt) });
            }
        }
        finally {
            this.pumping = false;
        }
    }
    private release(id: string, receipt: {
        cleanup: string;
        settled: boolean;
    }) {
        const row = this.store.one('SELECT * FROM capacity_leases WHERE id=?', id);
        if (!row || ['RELEASED', 'CANCELLED'].includes(row.state))
            return;
        const clean = receipt.settled && ['removed', 'not-allocated', 'unbound'].includes(receipt.cleanup);
        this.store.run('UPDATE capacity_leases SET state=?,data=? WHERE id=?', clean ? 'RELEASED' : 'QUARANTINED', JSON.stringify({ ...JSON.parse(row.data), receipt }), id);
        this.pump();
    }
    recover() {
        for (const row of this.store.all("SELECT * FROM capacity_leases WHERE state IN ('QUEUED','ADMITTED','SETTLING','QUARANTINED')")) {
            if (row.state === 'QUEUED') {
                this.cancelQueued(row.id, 'Previous owner stopped before actual admission');
                continue;
            }
            const run = this.store.one('SELECT * FROM runs WHERE id=?', row.run), data = JSON.parse(run.data);
            this.release(row.id, { cleanup: data.cleanup ?? 'unknown', settled: run.phase === 'INTERRUPTED' || run.phase === 'SETTLED' });
        }
    }
}

import type { PiSession } from '../pi/session.js';
import type { NativeIdentity } from './interaction-types.js';
import type { Store } from './store.js';
export interface CompletedResourcePolicy {
    mode: 'immediate' | 'finite';
    idleMs: number;
    maxRetained: number;
}
/** Physical cleanup cannot establish delivery or replayability of an uncertain native input. */
export function nativeInputRecoveryRequired(s: Store, cid: string): boolean {
    const row = s.one('SELECT data FROM conversation_state WHERE conversation=?', cid);
    return !!row && (Object.hasOwn(JSON.parse(row.data), 'nativeInputRecovery') || !!s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED'", cid));
}
export function resourcePolicy(value?: CompletedResourcePolicy): Readonly<CompletedResourcePolicy> {
    const p: CompletedResourcePolicy = value ?? { mode: 'immediate', idleMs: 0, maxRetained: 0 };
    if (!['immediate', 'finite'].includes(p.mode) || !Number.isSafeInteger(p.idleMs) || p.idleMs < 0 || p.idleMs > 86400000 || !Number.isSafeInteger(p.maxRetained) || p.maxRetained < 0 || p.maxRetained > 16)
        throw Error('Invalid completed resource policy');
    return Object.freeze({ ...p });
}
export function assertConversationExecutable(s: Store, cid: string, allowArchived = false, allowNativeInputRecovery = false): void {
    const row = s.one('SELECT archived,data FROM conversation_state WHERE conversation=?', cid);
    if (!row || !s.one('SELECT id FROM conversations WHERE id=?', cid))
        throw Error('Unknown conversation');
    if (JSON.parse(row.data).lifecycle?.deleted)
        throw Error('CONVERSATION_DELETED: retained evidence only; create a new conversation for execution');
    if (row.archived && !allowArchived)
        throw Error('CONVERSATION_ARCHIVED: restore explicitly before execution');
    if (!allowNativeInputRecovery && nativeInputRecoveryRequired(s, cid))
        throw Error('NATIVE_INPUT_RECOVERY_REQUIRED: ' + cid + ' has unresolved native input disposition; inspect retained conversation/run/input evidence. Automatic reconciliation is unavailable; cleanup or restart does not clear this requirement.');
}
export function assertWorkConversation(s: Store, wid: string): void {
    const w = s.one('SELECT data FROM works WHERE id=?', wid);
    if (!w)
        return;
    const cid = JSON.parse(w.data).conversation;
    if (cid)
        assertConversationExecutable(s, cid);
}
/** No OS or client action here. Terminal ordinary ACTIVE is intentionally allowed. */
export function lifecycleReasons(s: Store, cid: string): string[] {
    const c = s.one('SELECT generation FROM conversations WHERE id=?', cid), st = s.one('SELECT * FROM conversation_state WHERE conversation=?', cid);
    if (!c || !st)
        return ['Unknown conversation'];
    const d = JSON.parse(st.data), reasons: string[] = [];
    if (nativeInputRecoveryRequired(s, cid))
        reasons.push('native input reconciliation required');
    if (st.resource !== 'IDLE')
        reasons.push('resource:' + st.resource);
    if (d.continuationAuthorized || d.dialogs?.length)
        reasons.push('authorized continuation/dialog pending');
    for (const r of s.all("SELECT id,state FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED')", cid))
        reasons.push('input:' + r.id + ':' + r.state);
    for (const r of s.all("SELECT id FROM conversation_dependencies WHERE (waiting=? OR target=?) AND state='PENDING'", cid, cid))
        reasons.push('dependency:' + r.id);
    for (const r of s.all("SELECT id,state FROM conversation_assignments WHERE (source_conversation=? OR target=?) AND state IN ('QUEUED','RUNNING','WAITING')", cid, cid))
        reasons.push('assignment:' + r.id + ':' + r.state);
    const runs = s.all("SELECT * FROM runs WHERE id=? OR json_extract(data,'$.conversation')=?", d.runId ?? null, cid);
    for (const r of runs) {
        const x = JSON.parse(r.data), cancelledLease = s.one("SELECT data FROM capacity_leases WHERE run=? AND state='CANCELLED'", r.id);
        const neverAdmitted = r.phase === 'INTERRUPTED' && r.reservation === 'released' && x.admission === 'never-admitted' && !x.attainedCapture && !x.manifest && !x.allocatedNative && !x.containerId && cancelledLease && JSON.parse(cancelledLease.data).admitted === false;
        if (!neverAdmitted && (!['SETTLED', 'INTERRUPTED'].includes(r.phase) || r.reservation === 'reserved' || String(x.cleanup ?? 'unknown').startsWith('quarantined') || !['removed', 'not-allocated', 'unbound'].includes(x.cleanup)))
            reasons.push('run:' + r.id + ':' + r.phase);
    }
    for (const r of s.all("SELECT l.id,l.state FROM capacity_leases l JOIN runs r ON r.id=l.run WHERE (r.id=? OR json_extract(r.data,'$.conversation')=?) AND l.state IN ('QUEUED','ADMITTED','SETTLING','QUARANTINED')", d.runId ?? null, cid))
        reasons.push('capacity:' + r.id + ':' + r.state);
    const governed = s.all("SELECT w.*,c.phase AS change_phase FROM works w JOIN change_state c ON c.work=w.id WHERE json_extract(w.data,'$.conversation')=? OR w.id IN (SELECT work FROM conversation_assignments WHERE target=?)", cid, cid);
    for (const w of governed)
        if (w.state === 'UNKNOWN' || w.state !== 'CANCELLED' && w.change_phase !== 'REVIEW_READY')
            reasons.push('governed:' + w.id + ':' + w.change_phase);
    for (const o of s.all('SELECT * FROM effect_operations')) {
        const x = JSON.parse(o.data), related = x.origin?.identity?.conversationId === cid || x.ownerRoot?.conversationId === cid || governed.some(w => w.id === o.work);
        if (!related || o.phase === 'CONFIRMED')
            continue;
        const w = s.one('SELECT state,epoch FROM works WHERE id=?', o.work);
        const cancelledSource = w?.state === 'CANCELLED' || Number.isSafeInteger(x.rootEpoch ?? x.evidence?.epoch) && (x.rootEpoch ?? x.evidence.epoch) < w?.epoch && Array.isArray(x.blocked) && x.blocked.some((v: unknown) => v === 'Owned work cancelled' || v === 'Publication work cancelled');
        const cancelledConfiguration = o.phase === 'CANCELLED' && x.kind === 'configuration' && Array.isArray(x.steps) && x.steps.every((step: any) => !['INVOKING', 'UNKNOWN'].includes(step.state));
        const sends = s.all("SELECT data FROM effect_receipts WHERE operation=? AND kind='send'", o.id).map(r => JSON.parse(r.data));
        const noHandoff = sends.length ? sends.every(r => r.handoff === 'not-started') : !x.dispatchRun;
        if (!(o.phase === 'REFUSED' && cancelledSource && noHandoff) && !cancelledConfiguration)
            reasons.push('effect:' + o.id + ':' + o.phase);
    }
    return reasons;
}
interface CompletedEntry {
    identity: NativeIdentity;
    pi: PiSession;
    completed: number;
    used: number;
    state: 'retained' | 'closing' | 'UNKNOWN';
    close?: Promise<void>;
}
/** One host-owned finite collection; no cross-conversation gates or runnable permits. */
export class CompletedResources {
    private entries = new Map<string, CompletedEntry>();
    private closing = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private failure: unknown;
    readonly policy: Readonly<CompletedResourcePolicy>;
    constructor(private s: Store, policy: CompletedResourcePolicy | undefined, private protectedNow: (cid: string) => boolean) { this.policy = resourcePolicy(policy); }
    get enabled() { return this.policy.mode === 'finite' && this.policy.idleMs > 0 && this.policy.maxRetained > 0; }
    inspect(cid: string) { const e = this.entries.get(cid); return e ? { state: e.state, runId: e.identity.runId, generation: e.identity.generation, completedAt: e.completed, lastHumanUse: e.used } : { state: 'absent' }; }
    touch(cid: string) {
        const e = this.entries.get(cid);
        if (e)
            e.used = Date.now();
        this.schedule();
    }
    private unknown(e: CompletedEntry, error: unknown) {
        e.state = 'UNKNOWN';
        this.failure = error;
        try {
            const r = this.s.one('SELECT data FROM conversation_state WHERE conversation=?', e.identity.conversationId);
            if (r)
                this.s.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'UNKNOWN', JSON.stringify({ ...JSON.parse(r.data), completedResourceUnknown: { runId: e.identity.runId, generation: e.identity.generation } }), e.identity.conversationId);
        }
        catch { /* Keep the actual in-memory UNKNOWN owner even when state recording is unavailable. */ }
    }
    private closeEntry(e: CompletedEntry): Promise<void> {
        if (e.close)
            return e.close;
        e.state = 'closing';
        return e.close = (async () => {
            try {
                await e.pi.closeOwned();
                if (this.entries.get(e.identity.conversationId) === e)
                    this.entries.delete(e.identity.conversationId);
            }
            catch (error) {
                this.unknown(e, error);
                throw error;
            }
            finally {
                this.schedule();
            }
        })();
    }
    async reclaim(cid: string, ownedAction = false) {
        const e = this.entries.get(cid);
        if (!e)
            return { conversationId: cid, outcome: 'absent' };
        if (!ownedAction && this.protectedNow(cid))
            throw Error('RESOURCE_PROTECTED: settle active interaction before reclaim');
        await this.closeEntry(e);
        return { conversationId: cid, outcome: 'closed', runId: e.identity.runId };
    }
    private async evictOne() {
        const e = [...this.entries.values()].filter(e => e.state === 'retained' && !this.protectedNow(e.identity.conversationId)).sort((a, b) => a.used - b.used || a.completed - b.completed || a.identity.conversationId.localeCompare(b.identity.conversationId))[0];
        if (!e)
            throw Error('COMPLETED_RESOURCES_PROTECTED: reclaim/settle an owned client before fresh admission');
        await this.closeEntry(e);
    }
    async beforeFresh(cid: string) {
        if (this.closing || this.failure)
            throw Error('Completed client cleanup UNKNOWN/closing; fresh admission unavailable');
        const old = this.entries.get(cid);
        if (old)
            await this.closeEntry(old);
        if (this.enabled)
            while (this.entries.size >= this.policy.maxRetained)
                await this.evictOne();
    }
    quarantine(identity: NativeIdentity, pi: PiSession, error: unknown) {
        let e = this.entries.get(identity.conversationId);
        if (!e) {
            e = { identity, pi, completed: Date.now(), used: Date.now(), state: 'UNKNOWN' };
            this.entries.set(identity.conversationId, e);
        }
        this.unknown(e, error);
    }
    async discardCandidate(identity: NativeIdentity, pi: PiSession) {
        const existing = this.entries.get(identity.conversationId);
        if (existing?.pi === pi) {
            await this.closeEntry(existing);
            return;
        }
        try {
            await pi.closeOwned();
        }
        catch (error) {
            this.quarantine(identity, pi, error);
            throw error;
        }
    }
    private eligible(identity: NativeIdentity, pi: PiSession) {
        if (!this.enabled || this.closing || this.failure || lifecycleReasons(this.s, identity.conversationId).length)
            return false;
        if (this.entries.has(identity.conversationId))
            throw Error('Duplicate completed owner');
        const c = this.s.one('SELECT generation FROM conversations WHERE id=?', identity.conversationId), st = this.s.one('SELECT * FROM conversation_state WHERE conversation=?', identity.conversationId), run = this.s.one('SELECT * FROM runs WHERE id=?', identity.runId), d = run ? JSON.parse(run.data) : null;
        return !!(c && c.generation === identity.generation && st && st.resource === 'IDLE' && st.work === identity.workId && JSON.parse(st.data).runId === identity.runId && run && run.work === identity.workId && run.phase === 'SETTLED' && run.reservation === 'consumed' && ['removed', 'not-allocated', 'unbound'].includes(d.cleanup) && d.nativeSessionId === pi.sessionManager.getSessionId() && d.nativeCheckpoint?.sessionId === pi.sessionManager.getSessionId() && this.s.one("SELECT id FROM capacity_leases WHERE run=? AND state='RELEASED'", identity.runId));
    }
    async admit(identity: NativeIdentity, pi: PiSession) {
        // Re-read current authority after every await; neither an earlier idle result
        // nor capacity eviction grants a reusable execution/retention permit.
        while (true) {
            if (!this.eligible(identity, pi)) {
                await this.discardCandidate(identity, pi);
                return;
            }
            if (this.entries.size < this.policy.maxRetained) {
                const recency = this.s.one('SELECT human_used FROM conversation_state WHERE conversation=?', identity.conversationId);
                this.entries.set(identity.conversationId, { identity, pi, completed: Date.now(), used: recency?.human_used || Date.now(), state: 'retained' });
                this.schedule();
                return;
            }
            try {
                await this.evictOne();
            }
            catch (error) {
                if (this.failure)
                    throw error;
                await this.discardCandidate(identity, pi);
                return;
            }
        }
    }
    private schedule() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        if (this.closing)
            return;
        const eligible = [...this.entries.values()].filter(e => e.state === 'retained' && !this.protectedNow(e.identity.conversationId));
        const expiry = Math.min(...eligible.map(e => Math.max(e.used, e.completed) + this.policy.idleMs));
        if (!Number.isFinite(expiry))
            return;
        this.timer = setTimeout(() => { void this.expire().catch(error => { this.failure = error; }); }, Math.max(1, expiry - Date.now()));
        this.timer.unref();
    }
    private async expire() {
        for (const e of [...this.entries.values()])
            if (e.state === 'retained' && !this.protectedNow(e.identity.conversationId) && Math.max(e.used, e.completed) + this.policy.idleMs <= Date.now())
                await this.closeEntry(e);
        this.schedule();
    }
    changed() { this.schedule(); }
    quiesce() {
        this.closing = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
    }
    async close() {
        this.quiesce();
        const settled = await Promise.allSettled([...this.entries.values()].map(e => this.closeEntry(e)));
        const errors = settled.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
        if (errors.length)
            throw new AggregateError(errors.map(x => x.reason), 'Completed resource cleanup UNKNOWN');
    }
}

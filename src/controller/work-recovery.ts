import { consumedWaitProof } from './consumed-wait.js';
import { isDeepStrictEqual } from 'node:util';
import type { Store } from './store.js';
import { hash } from './change-files.js';
// New conversational families must leave room for governed planning, checks and review.
// Retained and explicitly selected allowances are never migrated by this default.
export const defaultConversationExecutionLimit = 32;
export interface BudgetView {
    limit: number;
    consumed: number;
    reserved: number;
}
export interface WorkAllowanceSnapshot {
    workId: string;
    epoch: number;
    lineageRoot: string;
    execution: BudgetView;
    resolution: BudgetView;
    governed: boolean;
    family: {
        workIds: string[];
        count: number;
        latestPosition: number;
    };
}
export function workAllowance(s: Store, id: string): WorkAllowanceSnapshot {
    const work = s.one('SELECT epoch,lineage FROM works WHERE id=?', id);
    if (!work)
        throw Error('Unknown original work');
    const budget = (kind: string): BudgetView => {
        const row = s.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', work.lineage, kind);
        if (!row)
            throw Error('Original shared allowance is missing');
        return { limit: row.limit, consumed: row.consumed, reserved: row.reserved };
    };
    const family = s.one('SELECT COUNT(*) AS count,MAX(rowid) AS latestPosition FROM works WHERE lineage=?', work.lineage);
    return { workId: id, epoch: work.epoch, lineageRoot: work.lineage, execution: budget('execution'), resolution: budget('resolution'), governed: !!s.one('SELECT work FROM change_state WHERE work=?', id),
        family: { ...family, workIds: s.all('SELECT id FROM works WHERE lineage=? ORDER BY rowid DESC LIMIT 20', work.lineage).map(r => r.id) } };
}
/** Shared authoritative family hold predicate for owner recovery and evidence reads. */
export function workFamilyUnsettled(s: Store, lineage: string, busy: (id: string) => boolean): boolean {
    const ids = s.all('SELECT id,state FROM works WHERE lineage=?', lineage);
    return ids.some(w => busy(w.id) || ['UNKNOWN', 'QUARANTINED'].includes(w.state)) || !!s.one("SELECT r.id FROM runs r JOIN works w ON w.id=r.work WHERE w.lineage=? AND (r.reservation='reserved' OR r.phase NOT IN ('SETTLED','INTERRUPTED') OR json_extract(r.data,'$.cleanup') LIKE 'quarantined%') LIMIT 1", lineage) ||
        !!s.one("SELECT c.id FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.state IN ('ADMITTED','ACTIVE','QUEUED','SETTLING','QUARANTINED') LIMIT 1", lineage) || !!s.one('SELECT kind FROM budgets WHERE lineage=? AND reserved>0 LIMIT 1', lineage);
}
/** Pure recorded admission facts. History is validated again by ordinary dispatch. */
export function ordinaryWorkRecovery(s: Store, id: string, busy: (id: string) => boolean) {
    const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
    const unsettled = (lineage: string) => s.one('SELECT COUNT(*) AS n FROM works WHERE lineage=?', lineage).n > 128 || workFamilyUnsettled(s, lineage, busy) ||
        !!s.one("SELECT r.id FROM runs r JOIN works w ON w.id=r.work WHERE w.lineage=? AND (r.phase NOT IN ('SETTLED','INTERRUPTED') OR r.reservation NOT IN ('consumed','released') OR NOT COALESCE(CASE WHEN json_valid(r.data) THEN json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','unbound','confirmed') ELSE 0 END,0)) LIMIT 1", lineage) ||
        !!s.one("SELECT c.id FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.state NOT IN ('RELEASED','CANCELLED') LIMIT 1", lineage) ||
        s.one("SELECT COUNT(*) AS n FROM budgets WHERE lineage=? AND kind IN ('execution','resolution')", lineage).n !== 2 || !!s.one("SELECT kind FROM budgets WHERE lineage=? AND kind IN ('execution','resolution') AND (typeof(lim)!='integer' OR typeof(consumed)!='integer' OR typeof(reserved)!='integer' OR lim<0 OR lim>9007199254740991 OR consumed<0 OR consumed>lim OR reserved!=0) LIMIT 1", lineage);
    const work = s.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, id);
    if (!work)
        throw Error('Original ordinary work unavailable');
    const source = s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, work.source);
    let conversation: any = null, view: any = null, inputs: any[] = [], originalInputs: any[] = [], runs: any[] = [], waits: any[] = [], family: any[] = [], goal: any = null, allowance: WorkAllowanceSnapshot | null = null;
    const holds: string[] = [];
    let consumedWait: ReturnType<typeof consumedWaitProof> | null = null;
    try {
        const data = JSON.parse(work.data), origin = JSON.parse(source?.origin);
        if (data.kind !== 'ordinary-conversation' || work.lineage !== work.id || work.predecessor || data.assignmentId !== undefined && data.assignmentId !== null || Object.hasOwn(data, 'invocation') || Object.hasOwn(data, 'contextOrigin') || Object.hasOwn(data, 'contextContinuation'))
            throw Error('Select an independent original ordinary owner root; delegated/context work keeps its original recovery');
        if (origin.kind !== 'owner-conversation-input' || origin.uid !== process.getuid?.() || !source.raw?.trim() || typeof data.conversation !== 'string' || source.conversation !== data.conversation)
            throw Error('Original bounded owner conversation source unavailable');
        conversation = s.one('SELECT * FROM conversations WHERE id=?', data.conversation);
        view = s.one(`SELECT conversation,work,resource,direction,native_id,archived,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, data.conversation);
        if (!conversation || !view?.data || view.work !== work.id || conversation.project !== work.project || !Number.isSafeInteger(conversation.generation))
            throw Error('Original conversation/work/project correspondence changed');
        const state = JSON.parse(view.data);
        if (Object.hasOwn(state, 'nativeInputRecovery'))
            throw Error('Original native input requires explicit reconciliation before admission recovery');
        if (view.archived || state.lifecycle?.deleted || !['IDLE', 'WAITING'].includes(view.resource) || Object.hasOwn(state, 'role') || state.dialogs?.length)
            throw Error('Original conversation must be restored and settled outside a strict role or pending dialog');
        if (view.resource === 'WAITING') {
            if (work.state !== 'CANCELLED' || !Array.isArray(state.waitHandles) || !state.waitHandles.length || state.waitHandles.length > 64 || new Set(state.waitHandles).size !== state.waitHandles.length || state.waitHandles.some((id: unknown) => typeof id !== 'string') || state.continuationAuthorized !== true || state.sourceIdentity?.workId !== work.id || state.sourceIdentity?.conversationId !== data.conversation)
                throw Error('Only a settled cancelled original wait can be withdrawn');
            waits = state.waitHandles.map((id: string) => { const assignment = s.one(`SELECT id,source_conversation,target,work,state,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, id); return { assignment, child: assignment?.work ? s.one('SELECT id,state,lineage,epoch,generation FROM works WHERE id=?', assignment.work) : null, dependencies: s.all('SELECT id,waiting,target,state FROM conversation_dependencies WHERE assignment=? LIMIT 2', id) }; });
            if (waits.some(item => !item.assignment?.data || item.assignment.state !== 'CANCELLED' || item.assignment.source_conversation !== data.conversation || JSON.parse(item.assignment.data).source?.workId !== work.id || item.dependencies.length !== 1 || item.dependencies[0].waiting !== data.conversation || item.dependencies[0].state !== 'CANCELLED' || item.dependencies[0].target !== item.assignment.target))
                throw Error('Original cancelled wait correspondence is unavailable; preserve its dependencies for recovery');
            if (waits.some(item => item.assignment.work && (!item.child || item.child.state !== 'CANCELLED' || unsettled(item.child.lineage))))
                throw Error('Original cancelled child cleanup or shared family remains unsettled or exceeds the bounded profile');
        }
        else if (state.waitHandles?.length || state.continuationAuthorized || Object.hasOwn(state, 'sourceIdentity'))
            consumedWait = consumedWaitProof(s, data.conversation, work.id, state);
        if (!['CANCELLED', 'INTERRUPTED'].includes(work.state) || !Number.isSafeInteger(work.epoch) || work.epoch < 1 || !Number.isSafeInteger(work.epoch + 1) || !Number.isSafeInteger(work.generation) || work.generation < 1)
            throw Error('Select a cancelled or interrupted original with finite next epoch/generation');
        inputs = s.all("SELECT id,state,generation,source FROM conversation_inputs WHERE conversation=? AND state NOT IN ('CONSUMED','HANDLED','CONFLICTED','CANCELLED') LIMIT 2", data.conversation);
        originalInputs = s.all('SELECT id,work,state FROM conversation_inputs WHERE conversation=? AND source=? LIMIT 2', data.conversation, work.source);
        if (inputs.length || originalInputs.length !== 1 || originalInputs[0].work !== work.id || originalInputs[0].state !== 'CONSUMED')
            throw Error('Consume or explicitly reconcile original conversation input before admission recovery');
        goal = s.one("SELECT id,revision,state FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED') LIMIT 1", data.conversation);
        if (goal)
            throw Error('Recover or finish the original goal separately before conversation admission recovery');
        runs = s.all(`SELECT id,phase,reservation,epoch,generation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, id);
        if (!runs.length || runs.length > 128 || runs.reduce((n, row) => n + Buffer.byteLength(row.data ?? ''), 0) > 1048576 || runs.some(row => {
            if (!row.data || !['SETTLED', 'INTERRUPTED'].includes(row.phase) || !['consumed', 'released'].includes(row.reservation))
                return true;
            const run = JSON.parse(row.data), cp = run.nativeCheckpoint;
            return !['removed', 'not-allocated', 'unbound', 'confirmed'].includes(run.cleanup) || run.nativeInputObserved && !run.attainedNative || run.modelDispatchAttempted && !run.attainedNative || run.attainedNative && (typeof run.historyRef !== 'string' || !run.historyRef.startsWith('/') || typeof run.nativeSessionId !== 'string' || !cp || cp.sessionId !== run.nativeSessionId || typeof cp.leafId !== 'string' || !cp.leafId || !Number.isSafeInteger(cp.bytes) || cp.bytes < 1 || cp.bytes > 33554432 || typeof cp.sha256 !== 'string' || !(/^[a-f0-9]{64}$/u).test(cp.sha256));
        }))
            throw Error('Original producer, native input or cleanup is unsettled or exceeds the bounded history profile');
        const latestNative = [...runs].reverse().map(row => JSON.parse(row.data)).find(run => run.attainedNative);
        if (latestNative && (!conversation.history || !view.native_id || latestNative.historyRef !== conversation.history || latestNative.nativeSessionId !== view.native_id))
            throw Error('Original conversation history/session correspondence is unavailable; no silent history initialization');
        family = s.all('SELECT id,state,epoch,generation FROM works WHERE lineage=? ORDER BY rowid LIMIT 129', work.lineage);
        if (family.length > 128)
            throw Error('Original shared work family exceeds the bounded recovery profile');
        allowance = workAllowance(s, id);
        if ([allowance.execution, allowance.resolution].some(b => !b || !Number.isSafeInteger(b.limit) || b.limit < 0 || !Number.isSafeInteger(b.consumed) || b.consumed < 0 || !Number.isSafeInteger(b.reserved) || b.reserved !== 0 || b.consumed > b.limit) || unsettled(work.lineage))
            throw Error('Original shared allowance, producer or cleanup remains unsettled');
    }
    catch (error) {
        holds.push(error instanceof Error ? error.message : 'Original ordinary recovery facts unavailable');
    }
    return { workId: id, conversationId: conversation?.id ?? null, workState: work.state as string, workEpoch: work.epoch as number, workGeneration: work.generation as number, sourceId: work.source as string, request: source?.raw as string | null, withdrawCancelledWait: view?.resource === 'WAITING', withdrawConsumedWait: consumedWait, allowance, holds, eligible: holds.length === 0, fingerprint: hash({ work, source, conversation, view, inputs, originalInputs, runs, waits, family, goal, allowance, consumedWait }) };
}
/** Validate inside the existing extension transaction; never opens a nested transaction. */
export function assertAllowanceExtension(s: Store, expected: WorkAllowanceSnapshot, kind: 'execution' | 'resolution', additional: number, busy: (id: string) => boolean): void {
    const current = workAllowance(s, expected.workId);
    if (!isDeepStrictEqual(current, expected))
        throw Error('Work or shared allowance changed; reopen /work before extending');
    const budget = current[kind];
    if (kind === 'resolution' && !current.governed)
        throw Error('This work has no governed resolution allowance');
    if (!Number.isSafeInteger(additional) || additional < 1 || additional > 100 || !Number.isSafeInteger(budget.limit + additional))
        throw Error('Extension requires 1..100 units and a safe finite resulting limit');
    if (workFamilyUnsettled(s, current.lineageRoot, busy))
        throw Error('Shared work is active or cleanup is unsettled; stop/join and reconcile the original work before extending');
}

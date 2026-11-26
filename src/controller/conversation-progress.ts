import type { Store } from './store.js';
import { parseUniqueJson } from '../workflow/json.js';
import { isWorkSettlementUnconfirmed, workCleanupUnconfirmed } from './work-recovery.js';
import { currentAssignmentResultId } from './assignment-result-attempt.js';
import type { NativeIdentity } from './interaction-types.js';
import { createHash } from 'node:crypto';

const continuationFailureReasons = ['explicit-profile', 'model-binding', 'startup'] as const;
export type WaitContinuationFailure = typeof continuationFailureReasons[number];

export interface ConversationWait {
    conversationId: string;
    workId: string;
    runId: string;
    generation: number;
    directionRevision: number;
    targets: { assignmentId: string; conversationId: string; workId: string | null; state: string; resultId?: string; cleanupUnconfirmed?: true }[];
    omitted: number;
    settlementUnconfirmed?: true;
    continuationFailure?: {reason: WaitContinuationFailure; proof: string};
}

/** Additional proof for exact recovery selection after the accepted turn has settled. */
export function settledConversationWaitActor(s: Store, wait: ConversationWait): NativeIdentity | undefined {
    const row = s.one('SELECT CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data END AS data FROM conversation_state WHERE conversation=?',
        wait.conversationId);
    const actor = row?.data ? (parseUniqueJson(row.data) as {sourceIdentity?: NativeIdentity}).sourceIdentity : undefined;
    if (!actor || actor.conversationId !== wait.conversationId || actor.runId !== wait.runId || actor.workId !== wait.workId ||
        actor.generation !== wait.generation || actor.directionRevision !== wait.directionRevision) return;
    const settled = s.one(`SELECT 1 FROM runs r JOIN conversation_inputs i ON i.id=? AND i.work=r.work AND i.conversation=?
        WHERE r.id=? AND r.work=? AND r.phase='SETTLED' AND r.reservation='consumed' AND i.state='CONSUMED'`,
        actor.initialInputId, wait.conversationId, wait.runId, wait.workId);
    return settled ? actor : undefined;
}

/** Recorded accepted WAIT only. No settlement, scheduling or resume authority. */
export function inspectConversationWait(store: Store, conversationId: string): ConversationWait | undefined {
    return inspectWait(store, conversationId)?.wait;
}

export function captureWaitContinuationFailure(store: Store, conversationId: string, reason: WaitContinuationFailure) {
    const proof = inspectWait(store, conversationId, true)?.proof;
    return proof ? {version: 1, reason, proof} : undefined;
}

function inspectWait(store: Store, conversationId: string, captureFailure = false): {wait: ConversationWait; proof?: string} | undefined {
    const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 512;
    try {
        if (!id(conversationId)) return;
        const row = store.one(`SELECT s.work,s.direction,c.generation,
            CASE WHEN length(CAST(s.data AS BLOB))<=65536 THEN s.data END AS data
            FROM conversation_state s JOIN conversations c ON c.id=s.conversation
            WHERE s.conversation=? AND s.resource='WAITING' AND s.archived=0`, conversationId);
        if (!row?.data || !id(row.work) || !Number.isSafeInteger(row.generation) || row.generation < 0 || !Number.isSafeInteger(row.direction) || row.direction < 0) return;
        const data = parseUniqueJson(row.data) as any, actor = data?.sourceIdentity, handles = data?.waitHandles;
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.lifecycle?.deleted || data.continuationAuthorized !== true ||
            !actor || actor.conversationId !== conversationId || actor.workId !== row.work || actor.runId !== data.runId ||
            actor.generation !== row.generation || actor.directionRevision !== row.direction || !id(actor.runId) || !id(actor.initialInputId) ||
            !Array.isArray(handles) || !handles.length || handles.length > 64 || handles.some(value => !id(value)) || new Set(handles).size !== handles.length) return;
        const run = store.one(`SELECT r.work,r.epoch,r.generation,r.phase,r.reservation,w.state AS workState,w.epoch AS workEpoch,w.generation AS workGeneration,
            CASE WHEN length(CAST(r.data AS BLOB))<=65536 THEN r.data END AS data
            FROM runs r JOIN works w ON w.id=r.work
            WHERE r.id=? AND w.state NOT IN ('CANCELLED','INTERRUPTED')`, actor.runId);
        if (!run?.data || run.work !== row.work || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || !Number.isSafeInteger(run.generation) || run.generation < 1 ||
            run.epoch !== run.workEpoch || run.generation !== run.workGeneration) return;
        const runData = parseUniqueJson(run.data) as any;
        const initial = store.one('SELECT conversation,work,generation,state FROM conversation_inputs WHERE id=?', actor.initialInputId);
        if (actor.launchId !== null || runData?.kind !== 'ordinary-conversation' || runData.conversation !== conversationId ||
            runData.initialInputId !== actor.initialInputId || !initial || initial.conversation !== conversationId || initial.work !== row.work || initial.generation !== actor.generation) return;
        const identity = { conversationId, workId: row.work, runId: actor.runId, generation: row.generation, directionRevision: row.direction };
        if (isWorkSettlementUnconfirmed(run.workState))
            return initial.state === 'CONSUMED' ? {wait: { ...identity, targets: [], omitted: 0, settlementUnconfirmed: true }} : undefined;
        const targets = store.all(`SELECT a.id AS assignmentId,
            CASE WHEN length(CAST(a.target AS BLOB))<=512 THEN a.target END AS conversationId,
            CASE WHEN a.work IS NULL OR length(CAST(a.work AS BLOB))<=512 THEN a.work END AS workId,
            a.work IS NULL OR length(CAST(a.work AS BLOB))<=512 AS validWork,
            CASE WHEN (a.state='UNAVAILABLE' OR (?=1 AND a.state='COMPLETE')) AND length(CAST(a.data AS BLOB))<=65536 AND json_valid(a.data)
                THEN a.data END AS assignmentData,
            CASE WHEN length(CAST(a.state AS BLOB))<=64 THEN a.state END AS state,
            a.work IS t.work AS sameWork,
            a.source_conversation=? OR EXISTS(SELECT 1 FROM conversation_dependencies d
                WHERE d.waiting=? AND d.target=a.target AND d.assignment=a.id AND d.state='PENDING') AS related,
            CASE WHEN length(CAST(t.data AS BLOB))<=65536 THEN t.data END AS targetData
            FROM json_each(?) h LEFT JOIN conversation_assignments a ON a.id=h.value
            LEFT JOIN conversations c ON c.id=a.target LEFT JOIN conversation_state t ON t.conversation=c.id
            WHERE t.archived=0 ORDER BY CAST(h.key AS INTEGER)`, Number(captureFailure || !!data.continuationFailure), conversationId, conversationId, JSON.stringify(handles));
        if (targets.length !== handles.length || targets.some((target, index) => target.assignmentId !== handles[index] ||
            !id(target.conversationId) || !target.sameWork || !target.related || !target.validWork ||
            target.workId !== null && !id(target.workId) || !['QUEUED', 'RUNNING', 'WAITING', 'COMPLETE', 'UNAVAILABLE', 'CANCELLED', 'RECOVERY_READY'].includes(target.state))) return;
        for (const target of targets) {
            if (!target.targetData) return;
            const targetData = parseUniqueJson(target.targetData) as any;
            if (!targetData || typeof targetData !== 'object' || Array.isArray(targetData) || targetData.lifecycle?.deleted) return;
        }
        let proof: string | undefined;
        if ((captureFailure || data.continuationFailure) && run.phase === 'SETTLED' && run.reservation === 'consumed' &&
            runData.outcome === 'waiting' && initial.state === 'CONSUMED' && !store.one(
                "SELECT 1 FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') LIMIT 1", conversationId)) {
            proof = continuationFailureProof(store, [actor, run.epoch, run.generation], targets);
        }
        const failure = data.continuationFailure;
        const wait: ConversationWait = { ...identity,
            targets: targets.slice(0, 8).map(({ assignmentId, conversationId, workId, state, assignmentData }) => {
                const work = workId ? store.one('SELECT id,state FROM works WHERE id=?', workId) : undefined;
                let resultId: string | undefined;
                try {
                    if (state === 'UNAVAILABLE' && assignmentData)
                        resultId = currentAssignmentResultId(parseUniqueJson(assignmentData) as Parameters<typeof currentAssignmentResultId>[0]);
                } catch { /* An unreadable assignment result pointer is not current evidence. */ }
                return { assignmentId, conversationId, workId, state, ...(id(resultId) ? { resultId } : {}),
                    ...(work && workCleanupUnconfirmed(store, work) ? { cleanupUnconfirmed: true as const } : {}) };
            }), omitted: targets.length - Math.min(targets.length, 8),
            ...(proof && failure?.version === 1 && failure.proof === proof && continuationFailureReasons.includes(failure.reason)
                ? {continuationFailure:{reason:failure.reason as WaitContinuationFailure, proof}} : {}) };
        return proof ? {wait, proof} : {wait};
    } catch { return; }
}

/** The marker describes a refused attempt for these exact original outcome records. */
function continuationFailureProof(store: Store, owner: unknown, targets: {assignmentId: string; conversationId: string;
    workId: string | null; state: string; assignmentData: string | null}[]) {
    try {
        const digest = createHash('sha256').update(JSON.stringify(owner));
        let publicationBytes = 0;
        for (const target of targets) {
            if (!target.workId || !target.assignmentData || !['COMPLETE','UNAVAILABLE'].includes(target.state)) return;
            const work = store.one('SELECT id,state,epoch,generation FROM works WHERE id=?', target.workId);
            if (!work || workCleanupUnconfirmed(store, work)) return;
            const id = currentAssignmentResultId(parseUniqueJson(target.assignmentData) as Parameters<typeof currentAssignmentResultId>[0]);
            const publication = id && store.one(`SELECT data FROM conversation_results WHERE id=? AND conversation=? AND work=?
                AND length(CAST(data AS BLOB))<=131072`, id, target.conversationId, target.workId);
            if (!publication?.data || (publicationBytes += Buffer.byteLength(publication.data)) > 2 * 1024 * 1024 ||
                (parseUniqueJson(publication.data) as {assignmentId?: unknown})?.assignmentId !== target.assignmentId) return;
            digest.update(JSON.stringify([target.assignmentId, target.conversationId, target.state, work, id, publication.data]));
        }
        return digest.digest('hex');
    } catch { return undefined; }
}

export type ConversationStage = 'accepted' | 'capacity' | 'starting' | 'capture' | 'runtime' | 'session' | 'dispatch' | 'model';
export interface ConversationProgress {
    runId: string;
    initialInputId: string;
    stage: ConversationStage;
}

/** Current ordinary response only. These observations confer no execution authority. */
export function inspectConversationProgress(store: Store, conversationId: string): ConversationProgress | undefined {
    const stateData = "CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
    const runData = "CASE WHEN json_valid(r.data) THEN r.data ELSE '{}' END";
    const row = store.one(`SELECT r.id AS runId,r.phase,i.id AS initialInputId,
        json_extract(${runData},'$.admission') AS admission,
        json_extract(${runData},'$.allocatedNative') AS allocated,
        json_extract(${runData},'$.nativePromptAttempted') AS prompted,
        json_extract(${runData},'$.modelDispatchAttempted') AS dispatched
        FROM conversation_state s JOIN conversations c ON c.id=s.conversation
        JOIN runs r ON r.id=json_extract(${stateData},'$.runId') AND r.work=s.work
        JOIN works w ON w.id=r.work AND w.epoch=r.epoch AND w.generation=r.generation
        JOIN conversation_inputs i ON i.id=json_extract(${runData},'$.initialInputId')
            AND i.conversation=s.conversation AND i.work=r.work AND i.generation=c.generation
        WHERE s.conversation=? AND s.resource IN ('QUEUED','RUNNING') AND w.state='ACTIVE'
            AND json_extract(${runData},'$.kind')='ordinary-conversation'
            AND json_extract(${runData},'$.conversation')=s.conversation
            AND json_extract(${runData},'$.manualAction') IS NULL AND i.mode!='manual'`, conversationId);
    if (!row) return;
    let stage: ConversationStage;
    switch (row.phase) {
        // Capacity leaves a newly admitted run in CREATED until local preparation advances.
        case 'CREATED': stage = row.admission === 'admitted' ? 'starting' : 'accepted'; break;
        case 'WAITING_CAPACITY': stage = 'capacity'; break;
        case 'CAPTURING': stage = 'capture'; break;
        case 'CAPTURED':
        case 'RUNTIME_CREATING': stage = 'runtime'; break;
        case 'RUNNING': stage = row.dispatched === 1 ? 'model' : row.allocated === 1 || row.prompted === 1 ? 'dispatch' : 'session'; break;
        default: return;
    }
    return { runId: row.runId, initialInputId: row.initialInputId, stage };
}

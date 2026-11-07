import type { Store } from './store.js';
import type { NativeIdentity } from './interaction-types.js';
import { hash } from './change-files.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (raw: string) => {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original assignment object unavailable');
    return value;
};
const immutable = (data: Record<string, unknown>) => {
    const { authorityRecovery, cancellationSource, reentries, result, resultId, error, ...rest } = data;
    if (data.contextAssignment)
        delete rest.contextReentry;
    return rest;
};
export function originalGovernedAssignment(store: Store, id: string, archive = true) {
    const assignment = store.one(`SELECT id,source_conversation,target,work,state,${bounded(archive ? 'data' : "json_remove(data,'$.result','$.resultId','$.error')", 65536)} AS data FROM conversation_assignments WHERE id=?`, id);
    if (!assignment?.data || !assignment.work)
        throw Error('Original bounded governed assignment unavailable');
    const data = object(assignment.data), work = store.one(`SELECT id,project,source,lineage,predecessor,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, assignment.work);
    if (!work?.data)
        throw Error('Original bounded assigned work unavailable');
    const value = object(work.data), source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, work.source), instructions = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, data.instructionsSource);
    if (data.operation !== 'change' || value.kind !== 'governed-change' || value.invocation?.assignmentId !== id || value.invocation?.conversationId !== assignment.target || value.invocation?.sourceEvent !== data.instructionsSource || hash(value.invocation?.actor) !== hash(data.source) || data.source?.conversationId !== assignment.source_conversation || work.project !== data.projectId || !source?.origin || !source.raw?.trim() || !instructions?.origin || !instructions.raw?.trim() || hash(object(source.origin)) !== hash(value.invocation))
        throw Error('Original assigned task/source correspondence unavailable');
    const initial = store.one(`SELECT conversation,work,source,generation,state,${bounded('data', 65536)} AS data FROM conversation_inputs WHERE id=?`, data.inputId), instructionOrigin = object(instructions.origin);
    if (instructions.conversation !== assignment.target || instructionOrigin.kind !== 'agent-assignment' || instructionOrigin.event !== id || hash(instructionOrigin.actor) !== hash(data.source) || source.raw !== instructions.raw || !initial?.data || initial.conversation !== assignment.target || initial.work !== work.id || initial.source !== instructions.id || initial.state !== 'CONSUMED' || initial.generation !== data.targetGeneration || object(initial.data).assignment !== id)
        throw Error('Original assignment instructions/input correspondence unavailable');
    return { assignment, data, work, value, proof: hash({ source, instructions, invocation: value.invocation, model: value.applicationModelBaseline ?? null }) };
}
/** Historical operands only; never resolves or restores current caller authority. */
export function historicalGovernedAssignment(store: Store, id: string, archive = false) {
    const saved = originalGovernedAssignment(store, id, archive), actor = saved.data.source;
    const run = store.one(`SELECT work,epoch,generation,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE id=?`, actor?.runId), data = run?.data ? object(run.data) : null;
    const input = actor?.initialInputId ? store.one('SELECT conversation,work,generation,state FROM conversation_inputs WHERE id=?', actor.initialInputId) : null;
    if (!data || run.work !== actor.workId || run.generation !== actor.generation || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || data.kind !== 'ordinary-conversation' || data.conversation !== actor.conversationId || data.initialInputId !== actor.initialInputId || !data.attainedNative || data.ordinaryRoleBinding?.sourceRunId !== actor.runId || data.ordinaryRoleBinding?.conversationId !== actor.conversationId || !input || input.conversation !== actor.conversationId || input.work !== actor.workId || input.generation !== actor.generation || input.state !== 'CONSUMED' || saved.data.contextAssignment && saved.data.contextAssignment.targetOrigin?.effects?.sourceEpoch !== run.epoch)
        throw Error('Original assignment native caller/run/input correspondence unavailable');
    return saved;
}
export function readAssignmentAuthority(store: Store, id: string, allowRecoveryReady: boolean): {
    actor: NativeIdentity;
    saved?: ReturnType<typeof originalGovernedAssignment>;
    proof?: {
        sourceId: string;
        fingerprint: string;
        epoch: number;
        fromEpoch: number;
        toEpoch: number;
        context: any;
        events: number;
    };
} {
    const row = store.one(`SELECT state,CASE WHEN json_valid(data) THEN json_type(data,'$.authorityRecovery') IS NOT NULL ELSE 1 END AS recovered,CASE WHEN json_valid(data) THEN ${bounded("json_extract(data,'$.source')", 65536)} ELSE NULL END AS source FROM conversation_assignments WHERE id=?`, id);
    if (!row)
        throw Error('Original assignment unavailable');
    if (row.state === 'RECOVERY_READY' && !allowRecoveryReady)
        throw Error('Recovered assignment requires explicit same-assignment queued reentry before execution');
    if (!row.recovered) {
        if (!row.source)
            throw Error('Original assignment source unavailable');
        return { actor: object(row.source) as NativeIdentity };
    }
    const saved = originalGovernedAssignment(store, id, false), { assignment, work } = saved;
    let current = saved.data, bytes = 0, events = 0, latest: any = null, laterFrom = Infinity, laterRoot = Infinity;
    const seen = new Set<string>();
    while (Object.hasOwn(current, 'authorityRecovery')) {
        const pointer = current.authorityRecovery;
        if (!pointer || pointer.version !== 1 || typeof pointer.sourceId !== 'string' || seen.has(pointer.sourceId) || ++events > 64)
            throw Error('Original assignment authority history unavailable');
        seen.add(pointer.sourceId);
        const source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, pointer.sourceId);
        if (!source?.origin || !source.raw)
            throw Error('Original assignment authority event unavailable');
        bytes += Buffer.byteLength(source.origin) + Buffer.byteLength(source.raw);
        if (bytes > 1048576)
            throw Error('Original assignment authority history exceeds its bounded profile');
        const origin = object(source.origin), event = object(source.raw), previous = event.previous, actor = origin.actor as NativeIdentity;
        if (origin.kind !== 'agent-assignment-recovery' || source.conversation !== assignment.source_conversation || origin.assignmentId !== id || event.version !== 1 || event.assignmentId !== id || event.workId !== work.id || event.proof !== saved.proof || !previous || previous.id !== id || previous.work !== work.id || previous.target !== assignment.target || previous.source_conversation !== assignment.source_conversation || previous.state !== 'CANCELLED' || typeof previous.data !== 'string' || Buffer.byteLength(previous.data) > 65536 || typeof event.reason !== 'string' || !event.reason.trim() || Buffer.byteLength(event.reason) > 4096 || !Number.isSafeInteger(event.fromEpoch) || event.fromEpoch < 1 || event.toEpoch !== event.fromEpoch + 1 || event.root?.id !== saved.data.source?.workId || actor?.workId !== event.root.id || actor.conversationId !== assignment.source_conversation || !Number.isSafeInteger(event.root.direction) || event.root.direction < 0 || hash(event.delegation) !== hash(saved.data.delegation))
            throw Error('Original assignment authority event correspondence changed');
        if (!Number.isSafeInteger(event.toEpoch) || !Number.isSafeInteger(event.root.epoch) || event.root.epoch < 1 || event.toEpoch >= laterFrom || event.root.epoch > laterRoot)
            throw Error('Original assignment recovery transition order changed');
        laterFrom = event.fromEpoch;
        laterRoot = event.root.epoch;
        const prior = object(previous.data);
        if (hash(immutable(current)) !== hash(immutable(prior)))
            throw Error('Original assignment authority cannot change task operands');
        const run = store.one(`SELECT work,epoch,generation,${bounded('data', 65536)} AS data FROM runs WHERE id=?`, actor.runId), runData = run?.data ? object(run.data) : null, input = runData ? store.one('SELECT work,conversation,generation FROM conversation_inputs WHERE id=?', actor.initialInputId) : null;
        if (!runData || run.work !== event.root.id || run.epoch !== event.root.epoch || run.generation !== actor.generation || runData.kind !== 'ordinary-conversation' || runData.conversation !== actor.conversationId || runData.initialInputId !== actor.initialInputId || !input || input.work !== run.work || input.conversation !== actor.conversationId || input.generation !== actor.generation)
            throw Error('Original recovery caller admission unavailable');
        latest ??= { sourceId: source.id, origin, event };
        current = prior;
    }
    const root = store.one('SELECT state,epoch,source FROM works WHERE id=?', latest.event.root.id);
    if (!root || !['ACTIVE', 'DELIVERED'].includes(root.state) || root.epoch !== latest.event.root.epoch || root.source !== latest.event.root.source || assignment.state === 'CANCELLED' || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state) || work.epoch < latest.event.toEpoch)
        throw Error('Recovered assignment authority is stale; recover its original task');
    return { actor: latest.origin.actor as NativeIdentity, saved, proof: { sourceId: latest.sourceId, fingerprint: hash({ sourceId: latest.sourceId, origin: latest.origin, event: latest.event, original: saved.proof }), epoch: latest.event.root.epoch, fromEpoch: latest.event.fromEpoch, toEpoch: latest.event.toEpoch, context: latest.event.contextAuthority ?? null, events } };
}

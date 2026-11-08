import { parseUniqueJson } from '../workflow/json.js';
import type { Store } from './store.js';
import type { NativeIdentity } from './interaction-types.js';
import { hash } from './change-files.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (raw: string): Record<string, any> => {
    const value = parseUniqueJson(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original assignment object unavailable');
    return value as Record<string, any>;
};
const envelope = (column = 'data') => bounded(`json_remove(${column},'$.result','$.resultId','$.error')`,65536);
/** Run/work and actor/input generations belong to separate original ordinal domains. */
function ordinaryActorRun(store: Store, actor: NativeIdentity) {
    if (!Number.isSafeInteger(actor?.generation) || actor.generation < 1)
        throw Error('Original conversation input ordinal correspondence unavailable');
    const run = store.one(`SELECT id,work,epoch,generation,phase,reservation,${bounded('data',65536)} AS data FROM runs WHERE id=?`,actor?.runId);
    const work = run ? store.one(`SELECT epoch,generation,${bounded('data',1048576)} AS data FROM works WHERE id=?`,actor.workId) : null;
    if (!run?.data || !work?.data || run.work !== actor.workId ||
        !Number.isSafeInteger(run.generation) || run.generation < 1 || !Number.isSafeInteger(run.epoch) || run.epoch < 1 ||
        !Number.isSafeInteger(work.generation) || run.generation > work.generation || !Number.isSafeInteger(work.epoch) || run.epoch > work.epoch)
        throw Error('Original ordinary run ordinal correspondence unavailable');
    const original = object(work.data);
    if (original.kind !== 'ordinary-conversation' || original.conversation !== actor.conversationId ||
        work.epoch === run.epoch && original.ordinaryRoleBinding?.sourceRunId === actor.runId && work.generation !== run.generation)
        throw Error('Original ordinary work ordinal correspondence unavailable');
    // Other admitted operation kinds may legitimately reuse this work ordinal.
    // Only an unambiguous recognized nonordinary discriminator is ignored.
    const candidates = store.all(`SELECT id FROM runs r WHERE work=? AND epoch=? AND generation=? AND
        CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN
            (SELECT CASE WHEN count(*)=1 AND min(type)='text' AND min(value) IN ('native-effect','publication-http','governed-role','governed-check','publication-judgment')
             THEN 0 ELSE 1 END FROM json_each(r.data) WHERE key='kind')
        ELSE 1 END LIMIT 2`,actor.workId,run.epoch,run.generation);
    if (candidates.length !== 1 || candidates[0].id !== actor.runId)
        throw Error('Original ordinary run ordinal correspondence is ambiguous');
    return run;
}
const immutable = (data: Record<string, unknown>) => {
    const { authorityRecovery, cancellationSource, reentries, result, resultId, error, ...rest } = data;
    if (data.contextAssignment)
        delete rest.contextReentry;
    return rest;
};
export function originalGovernedAssignment(store: Store, id: string, archive = true) {
    const assignment = store.one(`SELECT id,source_conversation,target,work,state,${archive ? bounded('data',65536) : envelope()} AS data FROM conversation_assignments WHERE id=?`, id);
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
    return { assignment, data, work, value, instructions: instructions.raw as string,
        proof: hash({ source, instructions, invocation: value.invocation, model: value.applicationModelBaseline ?? null }) };
}
/** Historical operands only; never resolves or restores current caller authority. */
export function historicalGovernedAssignment(store: Store, id: string, archive = false) {
    const saved = originalGovernedAssignment(store, id, archive), actor = saved.data.source;
    const run = ordinaryActorRun(store, actor), data = object(run.data);
    const input = actor?.initialInputId ? store.one('SELECT conversation,work,generation,state FROM conversation_inputs WHERE id=?', actor.initialInputId) : null;
    if (!data || run.work !== actor.workId || !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.phase !== 'SETTLED' || run.reservation !== 'consumed' || data.kind !== 'ordinary-conversation' || data.conversation !== actor.conversationId || data.initialInputId !== actor.initialInputId || !data.attainedNative || data.ordinaryRoleBinding?.sourceRunId !== actor.runId || data.ordinaryRoleBinding?.conversationId !== actor.conversationId || !input || input.conversation !== actor.conversationId || input.work !== actor.workId || input.generation !== actor.generation || input.state !== 'CONSUMED' || saved.data.contextAssignment && saved.data.contextAssignment.targetOrigin?.effects?.sourceEpoch !== run.epoch)
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
    const row = store.one(`SELECT state,${envelope()} AS data FROM conversation_assignments WHERE id=?`, id);
    if (!row)
        throw Error('Original assignment unavailable');
    if (!row.data) throw Error('Original assignment source unavailable');
    const metadata = object(row.data);
    if (row.state === 'RECOVERY_READY' && !allowRecoveryReady)
        throw Error('Recovered assignment requires explicit same-assignment queued reentry before execution');
    if (!Object.hasOwn(metadata,'authorityRecovery')) {
        if (!metadata.source || typeof metadata.source !== 'object' || Array.isArray(metadata.source))
            throw Error('Original assignment source unavailable');
        return { actor: metadata.source as NativeIdentity };
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
        const run = ordinaryActorRun(store, actor), runData = object(run.data), input = store.one('SELECT work,conversation,generation FROM conversation_inputs WHERE id=?', actor.initialInputId);
        if (!runData || run.work !== event.root.id || run.epoch !== event.root.epoch || runData.kind !== 'ordinary-conversation' || runData.conversation !== actor.conversationId || runData.initialInputId !== actor.initialInputId || !input || input.work !== run.work || input.conversation !== actor.conversationId || input.generation !== actor.generation)
            throw Error('Original recovery caller admission unavailable');
        latest ??= { sourceId: source.id, origin, event };
        current = prior;
    }
    const root = store.one('SELECT state,epoch,source FROM works WHERE id=?', latest.event.root.id);
    if (!root || !['ACTIVE', 'DELIVERED'].includes(root.state) || root.epoch !== latest.event.root.epoch || root.source !== latest.event.root.source || assignment.state === 'CANCELLED' || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state) || work.epoch < latest.event.toEpoch)
        throw Error('Recovered assignment authority is stale; recover its original task');
    return { actor: latest.origin.actor as NativeIdentity, saved, proof: { sourceId: latest.sourceId, fingerprint: hash({ sourceId: latest.sourceId, origin: latest.origin, event: latest.event, original: saved.proof }), epoch: latest.event.root.epoch, fromEpoch: latest.event.fromEpoch, toEpoch: latest.event.toEpoch, context: latest.event.contextAuthority ?? null, events } };
}

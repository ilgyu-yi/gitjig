import type { Store } from './store.js';
import type { ContextOrigin, ContextFamily } from './context-origin.js';
import { hash } from './change-files.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (raw: string) => {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original context object unavailable');
    return value;
};
/** Historical identity only: this deliberately does not accept current authority. */
export function contextRecoveryIdentity(s: Store, cid: string, origin: ContextOrigin, family: ContextFamily) {
    if (!['fork', 'clone'].includes(origin.kind) || origin.sourceConversationId !== origin.familyRoot || family.rootConversationId !== origin.familyRoot ||
        !origin.sourceWorkId || family.budgetAnchorWorkId !== origin.sourceWorkId || family.budgetLineage !== origin.sourceWorkId || family.delegationRootWorkId !== origin.sourceWorkId ||
        origin.continuation.kind !== 'ordinary-source' || origin.continuation.workId !== origin.sourceWorkId)
        throw Error('Select a direct retained clone/fork of an independent ordinary owner root');
    const readWork = (id: string) => s.one(`SELECT id,project,source,predecessor,lineage,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, id);
    const view = s.one(`SELECT conversation,work,native_id,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, cid);
    const work = view?.work ? readWork(view.work) : null, root = readWork(origin.sourceWorkId);
    if (!work?.data || !root?.data)
        throw Error('Original admitted context and source work are required');
    const data = object(work.data), rootData = object(root.data);
    if (data.kind !== 'ordinary-conversation' || rootData.kind !== 'ordinary-conversation' || work.id === root.id || work.lineage !== root.id || root.lineage !== root.id ||
        work.predecessor || root.predecessor || data.conversation !== cid || rootData.conversation !== origin.sourceConversationId ||
        [data, rootData].some(value => value.assignmentId != null || Object.hasOwn(value, 'invocation')) || Object.hasOwn(rootData, 'contextOrigin') || Object.hasOwn(rootData, 'contextContinuation') ||
        hash(data.contextOrigin) !== hash(origin) || data.contextFamilyRoot !== origin.familyRoot || hash(data.contextContinuation) !== hash({ version: 1, sourceWorkId: origin.sourceWorkId, sourceConversationId: origin.sourceConversationId, sourceEventId: origin.sourceEventId, effects: origin.effects.ceiling, sourceEpoch: origin.effects.sourceEpoch }))
        throw Error('Original context work/source correspondence unavailable');
    const source = (id: string) => s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, id);
    const event = source(origin.sourceEventId), owner = source(work.source), rootOwner = source(root.source);
    if (!event?.origin || !event.raw || event.conversation !== cid || object(event.origin).kind !== 'controller-context-' + origin.kind || hash(object(event.origin).contextOrigin) !== hash(origin))
        throw Error('Original immutable context event unavailable');
    for (const [row, conversation] of [[owner, cid], [rootOwner, origin.sourceConversationId]] as const) {
        if (!row?.origin || !row.raw?.trim() || row.conversation !== conversation || object(row.origin).kind !== 'owner-conversation-input' || object(row.origin).uid !== process.getuid?.())
            throw Error('Original owner context source unavailable');
    }
    const delegation = data.delegation, ceiling = origin.delegationCeiling;
    if (!delegation || delegation.rootWorkId !== root.id || ceiling.rootWorkId !== root.id || !Array.isArray(delegation.projectIds) ||
        delegation.projectIds.some((p: unknown) => typeof p !== 'string' || !ceiling.projectIds.includes(p)) || !Number.isSafeInteger(delegation.maxAssignments) || delegation.maxAssignments < 0 || delegation.maxAssignments > ceiling.maxAssignments)
        throw Error('Original captured context ceiling unavailable');
    const conversation = s.one('SELECT id,project,history FROM conversations WHERE id=?', cid);
    if (!conversation?.history || !view.native_id || conversation.project !== work.project)
        throw Error('Original context native identity unavailable');
    const stableWork = (row: any) => ({ id: row.id, project: row.project, source: row.source, predecessor: row.predecessor, lineage: row.lineage });
    const rootConversation = s.one('SELECT history FROM conversations WHERE id=?', origin.sourceConversationId), rootView = s.one('SELECT work,native_id FROM conversation_state WHERE conversation=?', origin.sourceConversationId);
    if (!rootConversation?.history || !rootView?.native_id || rootView.work !== root.id)
        throw Error('Original source root native identity unavailable');
    const identity = { origin, family, event, owner, rootOwner, work: stableWork(work), root: stableWork(root), delegation, native: { historyRef: conversation.history, sessionId: view.native_id }, rootNative: { historyRef: rootConversation.history, sessionId: rootView.native_id }, seed: object(view.data).nativeSeed };
    return { work, root, data, identity, fingerprint: hash(identity) };
}
/** A separate owner decision can bridge one direct edge, never its immutable origin. */
export function contextAdmissionProof(s: Store, cid: string, origin: ContextOrigin, family: ContextFamily, historical = false) {
    const view = s.one('SELECT work FROM conversation_state WHERE conversation=?', cid), row = view?.work ? s.one(`SELECT ${bounded('data', 1048576)} AS data FROM works WHERE id=?`, view.work) : null;
    if (!row?.data || !Object.hasOwn(object(row.data), 'contextAdmissionRecoverySource')) {
        if (s.one("SELECT id FROM sources WHERE conversation=? AND json_extract(origin,'$.kind')='owner-context-admission-recovery' LIMIT 1", cid))
            throw Error('Original context admission pointer unavailable');
        return null;
    }
    const saved = contextRecoveryIdentity(s, cid, origin, family);
    let pointer = saved.data.contextAdmissionRecoverySource, count = 0, bytes = 0, newerFrom = Infinity, newerRoot = Infinity;
    const seen = new Set<string>();
    let latest: any = null;
    while (pointer != null) {
        if (typeof pointer !== 'string' || seen.has(pointer) || ++count > 64)
            throw Error('Original context admission history unavailable');
        seen.add(pointer);
        const source = s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, pointer);
        if (!source?.origin || !source.raw || (bytes += Buffer.byteLength(source.origin) + Buffer.byteLength(source.raw)) > 1048576)
            throw Error('Original context admission history exceeds its bounded profile');
        const actor = object(source.origin), event = object(source.raw);
        if (source.conversation !== cid || actor.kind !== 'owner-context-admission-recovery' || actor.uid !== process.getuid?.() || actor.workId !== saved.work.id ||
            event.version !== 1 || event.identity !== saved.fingerprint || event.workId !== saved.work.id || event.conversationId !== cid ||
            !Number.isSafeInteger(event.fromEpoch) || event.fromEpoch < 1 || event.toEpoch !== event.fromEpoch + 1 || !Number.isSafeInteger(event.toEpoch) || event.toEpoch > newerFrom ||
            !Number.isSafeInteger(event.sourceEpoch) || event.sourceEpoch <= origin.effects.sourceEpoch! || event.sourceEpoch > newerRoot ||
            typeof event.reason !== 'string' || !event.reason.trim() || Buffer.byteLength(event.reason) > 4096 || !Array.isArray(event.histories) || event.histories.length !== 2)
            throw Error('Original context admission event correspondence changed');
        for (const [index, h] of event.histories.entries()) {
            const expected = index === 0 ? saved.identity.rootNative : saved.identity.native;
            const run = s.one(`SELECT work,${bounded('data', 65536)} AS data FROM runs WHERE id=?`, h.runId), data = run?.data ? object(run.data) : null;
            if (h.workId !== (index === 0 ? saved.root.id : saved.work.id) || run?.work !== h.workId || h.historyRef !== expected.historyRef || data?.historyRef !== h.historyRef || data.nativeSessionId !== expected.sessionId || hash(data.nativeCheckpoint) !== hash(h.checkpoint) || h.verified?.sessionId !== expected.sessionId || !Number.isSafeInteger(h.verified?.bytes) || h.verified.bytes < h.checkpoint.bytes || !/^[a-f0-9]{64}$/u.test(h.verified.sha256))
                throw Error('Original context admission physical proof correspondence changed');
        }
        latest ??= { sourceId: pointer, event };
        newerFrom = event.fromEpoch;
        newerRoot = event.sourceEpoch;
        pointer = event.previousSource;
    }
    if (!latest || !historical && (latest.event.toEpoch !== saved.work.epoch || latest.event.sourceEpoch !== saved.root.epoch || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(saved.work.state)))
        throw Error('Original context admission epoch changed; recover this original context separately');
    return { sourceId: latest.sourceId, fingerprint: hash(latest.event), sourceEpoch: latest.event.sourceEpoch as number };
}

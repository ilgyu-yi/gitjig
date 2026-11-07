import { sameNativeIdentity } from './native-identity.js';
import type { Store } from './store.js';

const unfinished = ['QUEUED', 'RUNNING', 'WAITING', 'UNAVAILABLE'];
function object(raw: unknown, limit = 65536): Record<string, any> {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > limit)
        throw Error('Original assigned-task cancellation provenance is unavailable');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original assigned-task cancellation provenance is unavailable');
    return value;
}
function refuse(): never {
    throw Error('Original assigned-task cancellation correspondence changed; inspect the original assignment and dependency');
}

/** Read only the original work's incoming task obligations and pending waits.
 * Callers own cancellation or accepted-result reconciliation. The assigning parent
 * and native effect aliases are outside this reader's selected work obligations.
 */
export function inspectAssignedWorkObligations(store: Store, workId: string): string[] {
    const rows = store.all(`SELECT a.* FROM conversation_assignments a WHERE a.work=?
        AND (a.state IN (${unfinished.map(() => '?').join(',')}) OR
            (a.state='COMPLETE' AND EXISTS(SELECT 1 FROM conversation_dependencies d WHERE d.assignment=a.id AND d.state='PENDING')))
        AND CASE WHEN json_valid(a.data) THEN json_extract(a.data,'$.operation') IN ('change','investigate') ELSE 1 END
        ORDER BY a.rowid LIMIT 65`, workId, ...unfinished);
    if (rows.length > 64) refuse();
    if (!rows.length) return [];
    const work = store.one('SELECT * FROM works WHERE id=?', workId);
    if (!work) refuse();
    const workData = object(work.data, 1048576);
    const result: string[] = [];
    for (const row of rows) {
        // The assignment envelope also retains its bounded structured result;
        // individual source, input and dependency provenance stays at 64KiB.
        const data = object(row.data, 1048576);
        if (data.operation !== 'change' && data.operation !== 'investigate') continue;
        const source = data.source;
        if (workData.conversation !== row.target || !source || source.conversationId !== row.source_conversation ||
            typeof source.workId !== 'string' || data.projectId !== work.project)
            refuse();
        const parent = store.one('SELECT data FROM works WHERE id=?', source.workId);
        if (!parent || object(parent.data, 1048576).conversation !== row.source_conversation) refuse();
        const instruction = store.one('SELECT conversation,origin FROM sources WHERE id=?', data.instructionsSource ?? null);
        const input = store.one('SELECT conversation,source,data FROM conversation_inputs WHERE id=?', data.inputId ?? null);
        if (!instruction || instruction.conversation !== row.target || !input || input.conversation !== row.target ||
            input.source !== data.instructionsSource || object(input.data).assignment !== row.id)
            refuse();
        const origin = object(instruction.origin);
        if (origin.kind !== 'agent-assignment' || origin.event !== row.id ||
            origin.actor?.workId !== source.workId || origin.actor?.conversationId !== row.source_conversation)
            refuse();
        const original = store.one('SELECT origin FROM sources WHERE id=?', work.source);
        if (!original) refuse();
        const workOrigin = object(original.origin);
        if (data.operation === 'change') {
            if (workData.kind !== 'governed-change' || workOrigin.kind !== 'agent-governed-assignment' ||
                workOrigin.assignmentId !== row.id || workOrigin.conversationId !== row.target ||
                workOrigin.actor?.workId !== source.workId || workOrigin.actor?.conversationId !== row.source_conversation)
                refuse();
        }
        else if (workData.kind !== 'ordinary-conversation' || workOrigin.kind !== 'agent-assignment' || workOrigin.event !== row.id ||
            workOrigin.actor?.workId !== source.workId || workOrigin.actor?.conversationId !== row.source_conversation) refuse();
        const dependencies = store.all("SELECT waiting,target,data FROM conversation_dependencies WHERE assignment=? AND state='PENDING' LIMIT 65", row.id);
        if (dependencies.length > 64) refuse();
        for (const dependency of dependencies) {
            if (dependency.target !== row.target) refuse();
            if (dependency.waiting === row.source_conversation) continue;
            // A permitted later coordinator can reenter this same assignment.
            // Its wait must retain the actual reentry event and input, not just a shared target.
            const entries = data.reentries;
            if (!Array.isArray(entries) || entries.length > 64) refuse();
            const pendingActor = object(dependency.data).source;
            const reentry = entries.find(entry => entry?.actor?.conversationId === dependency.waiting && sameNativeIdentity(entry.actor, pendingActor));
            if (!reentry || data.operation !== 'change') refuse();
            const event = store.one('SELECT conversation,origin FROM sources WHERE id=?', reentry.source ?? null);
            const admitted = store.one('SELECT conversation,source,data FROM conversation_inputs WHERE id=?', reentry.inputId ?? null);
            const coordinator = store.one('SELECT data FROM works WHERE id=?', reentry.actor.workId ?? null);
            if (!event || event.conversation !== row.target || !admitted || admitted.conversation !== row.target ||
                admitted.source !== reentry.source || object(admitted.data).assignment !== row.id ||
                !coordinator || object(coordinator.data, 1048576).conversation !== dependency.waiting) refuse();
            const eventOrigin = object(event.origin);
            if (eventOrigin.kind !== 'agent-governed-reentry' || eventOrigin.assignmentId !== row.id ||
                eventOrigin.originalWork !== workId || !sameNativeIdentity(eventOrigin.actor, reentry.actor)) refuse();
        }
        result.push(row.id);
    }
    return result;
}

import type { Store } from './store.js';
import { inspectEffectAssignmentObligations, matchesEffectAssignmentProfile } from './effect-assignment-provenance.js';
import { publishConversationResult, inspectConversationResult } from './conversation-results.js';
/** Recover an already retained outcome, without dispatch or renewed authority.
 * Own the synchronous publication/alias/wait transaction. Provenance inspection
 * remains separate from this result publication and dependency transition.
 * Contradictory sibling aliases on the same subject conservatively retain the hold.
 */
export function settleRecoveredEffectAssignment(store: Store, operationId: string, result: {
    operationId: string;
    workId: string;
    phase: string;
}): boolean {
    return store.tx(() => {
        const op = store.one('SELECT * FROM effect_operations WHERE id=?', operationId);
        if (!op) return false;
        const metadata = JSON.parse(op.data), assignment = store.one('SELECT * FROM conversation_assignments WHERE id=?', metadata.assignmentId ?? null);
        if (!assignment || !['QUEUED', 'RUNNING'].includes(assignment.state)) return false;
        const data = JSON.parse(assignment.data);
        if (data.effectOperationId !== op.id || !matchesEffectAssignmentProfile(data.operation, metadata.kind) ||
            result.phase === 'CONFIRMED' && op.phase !== 'CONFIRMED') return false;
        const work = store.one('SELECT state FROM works WHERE id=?', op.work);
        if (!work || ['CANCELLED', 'UNKNOWN'].includes(work.state)) return false;
        let correspondence;
        try { correspondence = inspectEffectAssignmentObligations(store, new Set([op.work])).find(alias => alias.assignmentId === assignment.id); }
        catch { return false; }
        if (!correspondence || assignment.work !== op.work || assignment.target !== metadata.conversationId ||
            result.operationId !== op.id || result.workId !== op.work) return false;
        const resultId = publishConversationResult(store, assignment.target, assignment.id, result);
        const publication = inspectConversationResult(store, resultId), accepted = publication.result as typeof result;
        if (publication.assignmentId !== assignment.id || publication.conversationId !== assignment.target || publication.workId !== assignment.work ||
            accepted.operationId !== op.id || accepted.workId !== assignment.work)
            throw Error('Recovered effect result correspondence changed');
        const complete = op.phase === 'CONFIRMED' && accepted.phase === 'CONFIRMED';
        store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', complete ? 'COMPLETE' : 'UNAVAILABLE',
            JSON.stringify({ ...JSON.parse(assignment.data), recovered: true, result: accepted, resultId }), assignment.id);
        store.run('UPDATE conversation_state SET resource=? WHERE conversation=?',
            ['UNKNOWN', 'INVOKING'].includes(op.phase) || accepted.phase === 'UNKNOWN' ? 'UNKNOWN' : 'IDLE', assignment.target);
        if (complete)
            store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE assignment=? AND state='PENDING'", assignment.id);
        return true;
    });
}

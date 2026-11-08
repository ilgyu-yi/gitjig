import { originalGovernedAssignment as original, readAssignmentAuthority } from './assignment-recovery-history.js';
export { historicalGovernedAssignment } from './assignment-recovery-history.js';
import { validateRecoveredInheritedAssignment, contextAssignmentRecoveryScope } from './context-origin.js';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Interactions } from './interaction.js';
import type { NativeIdentity } from './interaction-types.js';
import type { Delegation } from './coordination.js';
import { hash } from './change-files.js';
import { workFamilyUnsettled } from './work-recovery.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (raw: string) => {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original assignment object unavailable');
    return value;
};
function resolveAuthority(store: Store, id: string, allowRecoveryReady: boolean) {
    const authority = readAssignmentAuthority(store, id, allowRecoveryReady);
    if (authority.saved?.data.contextAssignment)
        validateRecoveredInheritedAssignment(store, id, authority);
    return authority;
}
/** Later owner inputs on the original root conversation that the recovered task has not yet inherited. Raw bytes are read only when inserting. */
function ownerSourcesSince(store: Store, saved: ReturnType<typeof original>) {
    const from = saved.data.source?.directionRevision;
    if (!Number.isSafeInteger(from) || from < 0)
        throw Error('Original assignment root direction unavailable');
    const rows = store.all(`SELECT d.revision,d.source,s.conversation,length(CAST(s.raw AS BLOB)) AS bytes FROM conversation_directions d JOIN sources s ON s.id=d.source WHERE d.conversation=? AND d.revision>? AND CASE WHEN length(CAST(s.origin AS BLOB))<=65536 THEN json_extract(s.origin,'$.kind') ELSE NULL END LIKE 'owner-%' AND NOT EXISTS(SELECT 1 FROM conversation_inputs i WHERE i.work=? AND json_extract(i.data,'$.inheritedOwnerSource')=d.source) ORDER BY d.revision LIMIT 65`, saved.assignment.source_conversation, from, saved.work.id);
    if (rows.length > 64 || rows.some(row => row.bytes > 524288 || row.conversation !== saved.assignment.source_conversation) || rows.reduce((n, row) => n + row.bytes, 0) > 1048576)
        throw Error('Recovered assignment later owner input exceeds its bounded profile; start a separate assignment');
    return rows;
}
/** New authority never replaces the immutable original task source or invocation. */
export function effectiveAssignmentAuthority(store: Store, id: string, allowRecoveryReady = false) {
    const { actor, saved } = resolveAuthority(store, id, allowRecoveryReady);
    // A completed result is final; existing operation inheritance governs its later effects.
    if (saved && saved.assignment.state !== 'COMPLETE' && ownerSourcesSince(store, saved).length)
        throw Error('Recovered assignment has later owner input that is not yet held on its original task; reenter the original assignment');
    return actor;
}
/** Caller holds the store transaction. Later owner input becomes held, unclassified input on the same task; independent source-fit must account for it. */
function inheritOwnerSources(store: Store, id: string) {
    const { saved } = resolveAuthority(store, id, true);
    if (!saved || saved.assignment.state === 'COMPLETE')
        return null;
    const target = saved.assignment.target;
    for (const row of ownerSourcesSince(store, saved)) {
        const parent = store.one(`SELECT ${bounded('d.data', 65536)} AS direction,s.raw FROM conversation_directions d JOIN sources s ON s.id=d.source WHERE d.conversation=? AND d.revision=? AND d.source=?`, saved.assignment.source_conversation, row.revision, row.source);
        if (!parent?.direction || Buffer.byteLength(parent.raw) !== row.bytes)
            throw Error('Recovered assignment later owner input changed');
        const view = store.one('SELECT direction FROM conversation_state WHERE conversation=?', target), conversation = store.one('SELECT generation FROM conversations WHERE id=?', target), inputId = randomUUID(), revision = view.direction + 1;
        store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, target, conversation.generation, saved.work.id, row.source, 'DISPATCHED_WORKFLOW', 'inherited-owner-source', parent.raw, JSON.stringify({ inheritedOwnerSource: row.source, parentConversation: row.conversation, parentRevision: row.revision, parentInputId: object(parent.direction).inputId ?? null, assignment: id, recoveredAssignmentId: id }));
        store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)', target, revision, row.source, JSON.stringify({ inputId, classification: 'unknown', effectHold: true, inherited: true, affectedWorkId: saved.work.id, affectedGeneration: conversation.generation, affectedRunId: null, affectedAssignmentId: id }));
        store.run('UPDATE conversation_state SET direction=? WHERE conversation=?', revision, target);
    }
    return store.one('SELECT direction FROM conversation_state WHERE conversation=?', target).direction as number;
}
/** A recovered result cannot become COMPLETE while later owner input is not held on its task. */
export function recoveredCompletionHold(store: Store, id: string) {
    const row = store.one("SELECT CASE WHEN json_valid(data) THEN json_type(data,'$.authorityRecovery') IS NOT NULL ELSE 1 END AS recovered FROM conversation_assignments WHERE id=?", id);
    if (!row?.recovered)
        return null;
    try {
        effectiveAssignmentAuthority(store, id, true);
        return null;
    }
    catch (error) {
        return (error instanceof Error ? error.message : String(error)) + '. This review-ready result is held: cancel this assignment, recover it, then reenter it so later owner input is accounted for';
    }
}
/** Idempotent propagation for a recovered assignment whose effective authority is still current. */
export function propagateRecoveredOwnerSources(store: Store, id: string) { return store.tx(() => inheritOwnerSources(store, id)); }
export function recoverGovernedAssignment(h: {
    store: Store;
    interactions: Interactions;
    identity: NativeIdentity;
    delegation: Delegation;
    entry(): void;
    busy(id: string): boolean;
}, input: {
    assignmentId: string;
    expectedWorkEpoch: number;
    observedDirectionRevision: number;
    reason: string;
}) {
    if (typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 4096 || !Number.isSafeInteger(input.expectedWorkEpoch) || input.expectedWorkEpoch < 1 || !Number.isSafeInteger(input.observedDirectionRevision) || input.observedDirectionRevision < 0)
        throw Error('Explicit original assignment epoch, target direction and bounded reason required');
    const s = h.store, actor = { ...h.identity };
    const inspect = () => {
        h.entry();
        const handle = h.interactions.getHandle(actor.conversationId);
        if (!handle || hash(handle.identity) !== hash(actor))
            throw Error('Assignment recovery requires the exact live coordinator');
        const saved = original(s, input.assignmentId), { assignment, data, work, value } = saved, root = s.one(`SELECT id,project,source,lineage,predecessor,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, actor.workId), rootSource = root ? s.one(`SELECT conversation,${bounded('origin', 65536)} AS origin FROM sources WHERE id=?`, root.source) : null, rootData = root?.data ? object(root.data) : null;
        const inherited = data.contextAssignment ? contextAssignmentRecoveryScope(s, assignment.id) : null, authorityRoot = inherited?.identity.sourceRootWorkId ?? root?.id;
        const rootShape = inherited ? root?.id === inherited.coordinator.id && root.lineage === authorityRoot : root?.lineage === root?.id && !Object.hasOwn(rootData ?? {}, 'contextOrigin') && !Object.hasOwn(rootData ?? {}, 'contextContinuation');
        if (!rootData || !rootShape || rootData.kind !== 'ordinary-conversation' || root.predecessor || Object.hasOwn(rootData, 'invocation') || rootData.assignmentId || rootData.conversation !== actor.conversationId || rootSource?.conversation !== actor.conversationId || !rootSource.origin || object(rootSource.origin).kind !== 'owner-conversation-input' || object(rootSource.origin).uid !== process.getuid?.() || root.state !== 'ACTIVE' || data.source?.workId !== root.id || data.delegationRoot !== authorityRoot || h.delegation.rootWorkId !== authorityRoot || hash(rootData.delegation) !== hash(h.delegation) || hash(data.delegation) !== hash(h.delegation) || !h.delegation.projectIds.includes(work.project))
            throw Error('Assignment recovery requires the same original owner coordinator and captured authority root/delegation');
        if (s.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.delegationRoot')=?", authorityRoot).n > h.delegation.maxAssignments)
            throw Error('Original assignment use exceeds the captured ceiling');
        if (assignment.state !== 'CANCELLED' || work.state !== 'CANCELLED' || work.epoch !== input.expectedWorkEpoch || !Number.isSafeInteger(work.epoch + 1) || !Number.isSafeInteger(work.generation + 1) || work.lineage !== work.id || work.predecessor || (!inherited && (['contextOrigin', 'contextContinuation'].some(key => Object.hasOwn(value, key)) || data.contextAssignment || data.contextReentry)) || (inherited && (work.epoch !== inherited.withdrawal.childEpoch || Object.hasOwn(data, 'authorityRecovery') || Object.hasOwn(data, 'contextReentry'))))
            throw Error('Select the exact cancelled original governed assignment within its recovery profile');
        const view = s.one(`SELECT conversation,work,resource,direction,native_id,archived,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, assignment.target), conversation = s.one('SELECT * FROM conversations WHERE id=?', assignment.target), state = view?.data ? object(view.data) : null, change = s.one(`SELECT phase,epoch,${bounded('data', 65536)} AS data FROM change_state WHERE work=?`, work.id);
        if (!state || !conversation || conversation.project !== work.project || view.work !== work.id || view.direction !== input.observedDirectionRevision || view.archived || state.lifecycle?.deleted || !['IDLE', 'QUEUED'].includes(view.resource) || ['role', 'nativeInputRecovery', ...inherited ? [] : ['contextOrigin', 'contextFamily']].some(key => Object.hasOwn(state, key)) || state.dialogs?.length || state.waitHandles?.length || state.continuationAuthorized || !change?.data || h.interactions.getHandle(assignment.target))
            throw Error('Original assigned conversation requires separate input, context or scheduler recovery');
        const pending = s.all("SELECT id,state FROM conversation_inputs WHERE conversation=? AND state NOT IN ('CONSUMED','HANDLED','CANCELLED','CONFLICTED') AND NOT (state='DISPATCHED_WORKFLOW' AND mode='inherited-owner-source') LIMIT 2", assignment.target), goal = s.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED') LIMIT 1", assignment.target), runs = s.all(`SELECT id,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, work.id), dependencies = s.all(`SELECT id,waiting,target,assignment,state,${bounded('data', 65536)} AS data FROM conversation_dependencies WHERE assignment=? LIMIT 65`, assignment.id), budgets = s.all('SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? ORDER BY kind', work.lineage), family = s.all('SELECT id,epoch,generation,state FROM works WHERE lineage=? ORDER BY rowid LIMIT 129', work.lineage), familyHold = s.one("SELECT r.id FROM runs r JOIN works w ON w.id=r.work WHERE w.lineage=? AND (r.phase NOT IN ('SETTLED','INTERRUPTED') OR r.reservation NOT IN ('consumed','released') OR NOT COALESCE(CASE WHEN json_valid(r.data) THEN json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','confirmed','unbound') ELSE 0 END,0)) LIMIT 1", work.lineage), capacityHold = s.one("SELECT c.id FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.state NOT IN ('RELEASED','CANCELLED') LIMIT 1", work.lineage);
        if (pending.length || goal || familyHold || capacityHold || h.busy(work.id) || s.one('SELECT COUNT(*) AS n FROM works WHERE lineage=?', work.lineage).n > 128 || workFamilyUnsettled(s, work.lineage, h.busy) || runs.length > 128 || runs.reduce((n, row) => n + Buffer.byteLength(row.data ?? ''), 0) > 1048576 || runs.some(row => !row.data || !['SETTLED', 'INTERRUPTED'].includes(row.phase) || !['consumed', 'released'].includes(row.reservation) || !['removed', 'not-allocated', 'confirmed', 'unbound'].includes(object(row.data).cleanup)) || budgets.length !== 2 || hash(budgets.map(row => row.kind)) !== hash(['execution', 'resolution']) || budgets.some(row => !Number.isSafeInteger(row.lim) || row.lim < 0 || !Number.isSafeInteger(row.consumed) || row.consumed < 0 || row.consumed > row.lim || row.reserved !== 0) || dependencies.length > 64 || dependencies.some(row => !row.data || row.state !== 'CANCELLED' || row.waiting !== assignment.source_conversation || row.target !== assignment.target))
            throw Error('Original task input, goal, producer, cleanup, dependency or allowance remains unsettled');
        return { saved, root, view, conversation, change, runs, dependencies, budgets, family, inherited: inherited?.identity ?? null };
    };
    const captured = inspect(), fingerprint = hash(captured);
    return s.tx(() => {
        const current = inspect();
        if (hash(current) !== fingerprint)
            throw Error('Original assignment recovery context changed');
        const { saved, root, view, change } = current, sourceId = randomUUID(), fromEpoch = saved.work.epoch, toEpoch = fromEpoch + 1, event = { version: 1, assignmentId: saved.assignment.id, workId: saved.work.id, previous: saved.assignment, proof: saved.proof, root: { id: root.id, source: root.source, epoch: root.epoch, direction: h.interactions.inspect(actor.conversationId).directionRevision }, fromEpoch, toEpoch, delegation: h.delegation, targetDirection: view.direction, previousView: view, previousChange: change, reason: input.reason, ...current.inherited ? { contextAuthority: current.inherited } : {} }, raw = JSON.stringify(event);
        if (Buffer.byteLength(raw) > 131072)
            throw Error('Original assignment recovery event exceeds its bounded profile');
        s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, actor.conversationId, JSON.stringify({ kind: 'agent-assignment-recovery', assignmentId: saved.assignment.id, actor }), raw);
        const data = JSON.stringify({ ...saved.data, authorityRecovery: { version: 1, sourceId } });
        if (Buffer.byteLength(data) > 65536)
            throw Error('Original recovered assignment exceeds its bounded profile');
        s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'RECOVERY_READY', data, saved.assignment.id);
        s.run("UPDATE works SET state='ACTIVE',epoch=?,generation=generation+1 WHERE id=?", toEpoch, saved.work.id);
        s.run("UPDATE conversation_state SET resource='IDLE' WHERE conversation=?", saved.assignment.target);
        s.run("UPDATE change_state SET phase='BLOCKED',data=? WHERE work=?", JSON.stringify({ ...object(change.data), blocked: ['Recovered assignment requires current same-work planning and verification'], resumeStage: 'plan', nextAction: 'Explicit same-assignment reentry; preserve original findings and allowances' }), saved.work.id);
        const direction = inheritOwnerSources(s, saved.assignment.id);
        const restored = original(s, saved.assignment.id), state = s.one('SELECT resource FROM conversation_state WHERE conversation=?', saved.assignment.target), phase = s.one('SELECT phase,data FROM change_state WHERE work=?', saved.work.id);
        if (restored.assignment.state !== 'RECOVERY_READY' || restored.data.authorityRecovery?.sourceId !== sourceId || restored.work.epoch !== toEpoch || restored.work.generation !== saved.work.generation + 1 || restored.work.state !== 'ACTIVE' || state?.resource !== 'IDLE' || phase?.phase !== 'BLOCKED' || object(phase.data).resumeStage !== 'plan' || hash(effectiveAssignmentAuthority(s, saved.assignment.id, true)) !== hash(actor))
            throw Error('Restored original assignment correspondence unavailable');
        return { assignmentId: saved.assignment.id, workId: saved.work.id, conversationId: saved.assignment.target, state: 'RECOVERY_READY' as const, epoch: toEpoch, sourceId, directionRevision: direction, nextAction: 'Explicitly reenter this original assignment with this direction revision; later owner input remains held for independent source-fit; no task, dependency or integration was launched' };
    });
}
/** Ownership token for an asynchronous assignment tail; normal work capture may add work. */
export function assignmentDispatchToken(store: Store, id: string) {
    const operands = "json_object('authorityRecovery',json_extract(data,'$.authorityRecovery'),'cancellationSource',json_extract(data,'$.cancellationSource'),'reentryCount',COALESCE(json_array_length(data,'$.reentries'),0),'lastReentry',json_extract(data,'$.reentries[#-1]'),'modelBinding',json_extract(data,'$.modelBinding'),'inputId',json_extract(data,'$.inputId'),'instructionsSource',json_extract(data,'$.instructionsSource'))";
    const row = store.one(`SELECT source_conversation,target,CASE WHEN json_valid(data) THEN ${bounded(operands, 65536)} ELSE NULL END AS operands FROM conversation_assignments WHERE id=?`, id);
    if (!row?.operands)
        throw Error('Original bounded assignment dispatch unavailable');
    return hash({ source: row.source_conversation, target: row.target, operands: object(row.operands) });
}

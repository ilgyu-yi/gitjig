import type { Store } from './store.js';
import { historicalGovernedAssignment } from './assignment-authority.js';
import { workFamilyUnsettled } from './work-recovery.js';
import { hash } from './change-files.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
/** One original outgoing task; no current context authority or task is revived here. */
export function cancelledContextWait(s: Store, work: any, view: any, busy: (id: string) => boolean) {
    const state = JSON.parse(view.boundedData);
    if (work.state !== 'CANCELLED' || view.resource !== 'WAITING' || !Array.isArray(state.waitHandles) || state.waitHandles.length !== 1 || state.continuationAuthorized !== true)
        throw Error('Select one exact cancelled original context wait');
    const saved = historicalGovernedAssignment(s, state.waitHandles[0], true), { assignment, data, work: child, value } = saved;
    const dependency = s.all(`SELECT id,waiting,target,assignment,state,${bounded('data', 65536)} AS data FROM conversation_dependencies WHERE assignment=? LIMIT 2`, assignment.id);
    if (assignment.state !== 'CANCELLED' || child.state !== 'CANCELLED' || assignment.source_conversation !== view.conversation || data.source?.workId !== work.id || hash(data.source) !== hash(state.sourceIdentity) ||
        data.resultDependency !== true || data.operation !== 'change' || Object.hasOwn(data, 'authorityRecovery') || Object.hasOwn(data, 'contextReentry') || !data.contextAssignment || child.lineage !== child.id || child.predecessor ||
        dependency.length !== 1 || !dependency[0].data || dependency[0].state !== 'CANCELLED' || dependency[0].waiting !== view.conversation || dependency[0].target !== assignment.target || hash(JSON.parse(dependency[0].data).source) !== hash(data.source))
        throw Error('Original cancelled context task/wait correspondence unavailable');
    const original = JSON.parse(work.data).contextOrigin, context = data.contextAssignment, target = s.one(`SELECT conversation,work,resource,native_id,archived,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, assignment.target);
    const instructions = s.one(`SELECT ${bounded('origin', 65536)} AS origin FROM sources WHERE id=?`, data.instructionsSource);
    const targetData = target?.data ? JSON.parse(target.data) : null;
    if (hash(context.actor) !== hash(data.source) || hash(context.actorOrigin) !== hash(original) || context.sourceEventId !== data.instructionsSource || context.targetOrigin?.kind !== 'inherited-context' ||
        context.targetOrigin.sourceWorkId !== work.id || context.targetOrigin.sourceConversationId !== view.conversation || context.targetOrigin.sourceEventId !== data.instructionsSource || context.targetOrigin.familyRoot !== original.familyRoot ||
        hash(context.reference) !== hash(original.continuation) || hash(context.targetOrigin.continuation) !== hash(context.reference) || hash(context.delegation) !== hash(data.delegation) || !instructions?.origin || hash(JSON.parse(instructions.origin).contextOrigin) !== hash(context.targetOrigin) || value.contextFamilyRoot !== original.familyRoot || targetData?.contextFamilyRoot !== original.familyRoot ||
        hash(value.contextOrigin) !== hash(context.targetOrigin) || !targetData || target.work !== child.id || target.resource !== 'IDLE' || target.archived || targetData.lifecycle?.deleted || targetData.dialogs?.length || targetData.waitHandles?.length || targetData.continuationAuthorized || Object.hasOwn(targetData, 'nativeInputRecovery') || hash(targetData.contextOrigin) !== hash(context.targetOrigin))
        throw Error('Original inherited task context is unavailable; no adoption or replacement');
    const cancellation = s.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, data.cancellationSource);
    const cancelled = cancellation?.origin ? JSON.parse(cancellation.origin) : null, requested = cancelled?.requestedWork;
    if (!cancellation?.raw?.trim() || cancelled.kind !== 'owner-task-cancel' || cancelled.uid !== process.getuid?.() || requested?.version !== 1 || requested.id !== work.id || requested.sourceId !== work.source || requested.toEpoch !== work.epoch || requested.toState !== 'CANCELLED' ||
        !Number.isSafeInteger(requested.fromEpoch) || requested.fromEpoch < 1 || !['ACTIVE', 'DELIVERED', 'INTERRUPTED', 'CANCELLED'].includes(requested.fromState) || !(requested.fromState === 'CANCELLED' ? requested.toEpoch === requested.fromEpoch : requested.toEpoch === requested.fromEpoch + 1))
        throw Error('Explicit owner cancellation of this original coordinator is required; cancel it explicitly to retain its exact scope');
    if (s.one('SELECT id FROM conversation_assignments WHERE (source_conversation=? OR target=?) AND id!=? LIMIT 1', assignment.target, assignment.target, assignment.id) ||
        s.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED') LIMIT 1", assignment.target) ||
        s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state NOT IN ('CONSUMED','HANDLED','CANCELLED','CONFLICTED') LIMIT 1", assignment.target) ||
        s.one('SELECT id FROM effect_operations WHERE work=? LIMIT 1', child.id))
        throw Error('Original task descendants, pending input/goal or native operation require separate recovery');
    const family = s.all('SELECT id,state,epoch,generation FROM works WHERE lineage=? ORDER BY rowid LIMIT 129', child.lineage), budgets = s.all('SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage=? ORDER BY kind', child.lineage);
    const runs = s.all(`SELECT id,work,phase,reservation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, child.id);
    if (family.length > 128 || workFamilyUnsettled(s, child.lineage, busy) || budgets.length !== 2 || hash(budgets.map(b => b.kind)) !== hash(['execution', 'resolution']) || budgets.some(b => !Number.isSafeInteger(b.lim) || b.lim < 0 || !Number.isSafeInteger(b.consumed) || b.consumed < 0 || b.consumed > b.lim || b.reserved !== 0) ||
        runs.length > 128 || runs.reduce((n, r) => n + Buffer.byteLength(r.data ?? ''), 0) > 1048576 || runs.some(r => !r.data || !['SETTLED', 'INTERRUPTED'].includes(r.phase) || !['consumed', 'released'].includes(r.reservation) || !['removed', 'not-allocated', 'unbound', 'confirmed'].includes(JSON.parse(r.data).cleanup)) ||
        s.one("SELECT c.id FROM capacity_leases c JOIN works w ON w.id=c.work WHERE w.lineage=? AND c.state NOT IN ('RELEASED','CANCELLED') LIMIT 1", child.lineage))
        throw Error('Original inherited task cleanup, producer or finite allowance remains unsettled');
    const receipt = { assignmentId: assignment.id, workId: child.id, childEpoch: child.epoch, childSource: child.source, conversationId: assignment.target, coordinatorWorkId: work.id, proof: saved.proof, cancellationSource: cancellation.id, dependency: dependency[0], previousScheduler: { resource: view.resource, data: view.boundedData } };
    return { receipt, snapshot: { assignment, child, target, cancellation, dependency, family, budgets, runs } };
}

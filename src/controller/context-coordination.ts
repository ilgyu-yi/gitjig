import type { Store } from './store.js';
import type { NativeIdentity } from './interaction-types.js';
import type { Delegation } from './coordination.js';
import { executionContext, validatedContextOrigin, captureContextEffects, contextWorkContinuation, validateRecoveredInheritedAssignment, type ContextOrigin } from './context-origin.js';
import { readAssignmentAuthority } from './assignment-recovery-history.js';
import { conversationModelChoice } from './model-choice.js';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class ContextAssignmentUnavailable extends Error {
    readonly recovery: string;
    constructor(detail: string, readonly workId?: string) {
        super('Context assignment unavailable; recover original ' + detail);
        this.recovery = workId
            ? `Open /work ${workId} to inspect original work and cleanup. Review its recovery conditions there, then use /inputs for safe retry or withdrawal. No replacement work has been started.`
            : 'Inspect the original conversation and work before starting a replacement task.';
    }
}
const unavailable = (detail: string, workId?: string): never => { throw new ContextAssignmentUnavailable(detail, workId); };
type Ref = {
    kind: 'governed' | 'ordinary-source';
    workId: string;
};
export interface ContextAssignmentReceipt {
    version: 1;
    actor: NativeIdentity;
    actorOrigin: ContextOrigin | null;
    targetOrigin: ContextOrigin | null;
    reference: Ref;
    sourceEventId: string;
    delegation: Delegation;
}
export class ContextAssignmentRetained extends Error {
    constructor(readonly workId: string) { super('Original assignment already owns work ' + workId + '; inspect/resume it instead of fresh begin'); }
}
function originAt(store: Store, cid: string) {
    return validatedContextOrigin(store, cid);
}
function reference(store: Store, cid: string, origin: ContextOrigin): Ref {
    if (origin.continuation.kind !== 'first-family-work')
        return origin.continuation;
    const family = executionContext(store, cid)!.family;
    if (!family.budgetAnchorWorkId)
        return unavailable('first context work for ' + family.rootConversationId + '; start its ordinary dialogue first');
    return { kind: store.one('SELECT work FROM change_state WHERE work=?', family.budgetAnchorWorkId) ? 'governed' : 'ordinary-source', workId: family.budgetAnchorWorkId };
}
function actorOrigin(store: Store, actor: NativeIdentity) {
    if (!actor?.conversationId || !actor.workId)
        return unavailable('actor identity');
    const origin = originAt(store, actor.conversationId), state = store.one('SELECT work FROM conversation_state WHERE conversation=?', actor.conversationId);
    const work = store.one('SELECT data FROM works WHERE id=?', actor.workId);
    const hasWorkOrigin = work && Object.hasOwn(JSON.parse(work.data), 'contextOrigin');
    if (!origin) {
        if (hasWorkOrigin)
            return unavailable('retained actor origin ' + actor.workId);
        return null;
    }
    if (!work || !hasWorkOrigin || state?.work !== actor.workId || !same(JSON.parse(work.data).contextOrigin, origin))
        return unavailable('actor work/origin ' + actor.workId);
    return origin;
}
function candidate(store: Store, assignment: any) {
    const data = JSON.parse(assignment.data);
    if (data.operation !== 'change' || !store.one('SELECT id FROM conversations WHERE id=?', assignment.target))
        return unavailable('assignment target ' + assignment.id);
    const work = assignment.work ? store.one('SELECT * FROM works WHERE id=?', assignment.work) : null;
    if (assignment.work && (!work || work.project !== data.projectId || JSON.parse(work.data).conversation !== assignment.target || JSON.parse(work.data).invocation?.assignmentId !== assignment.id))
        return unavailable('assignment/work identity ' + assignment.id);
    return { assignment, work, data };
}
function ordinarySources(store: Store, wid: string) {
    const workAt = (id: string) => {
        const work = store.one('SELECT * FROM works WHERE id=?', id);
        if (!work || ['UNKNOWN', 'CANCELLED'].includes(work.state))
            return unavailable('ordinary source work ' + id);
        return { work, data: JSON.parse(work.data), governed: !!store.one('SELECT work FROM change_state WHERE work=?', id) };
    };
    const first = workAt(wid);
    if (first.governed || first.data.kind !== 'ordinary-conversation')
        return unavailable('ordinary reference kind ' + wid);
    const cid = first.data.conversation, binding = executionContext(store, cid);
    if (!binding)
        return unavailable('ordinary source family ' + wid);
    const root = binding.root, pending = [wid], found = new Set<string>(), parents = new Map<string, string>();
    const belongs = (item: ReturnType<typeof workAt>) => !item.governed && item.data.kind === 'ordinary-conversation' && item.data.conversation === cid &&
        (!Object.hasOwn(item.data, 'contextFamilyRoot') || item.data.contextFamilyRoot === root) && executionContext(store, cid)?.root === root;
    while (pending.length) {
        const current = pending.pop()!;
        if (found.has(current))
            continue;
        if (found.size >= 64)
            return unavailable('deep ordinary source incarnations');
        const item = workAt(current), edge = contextWorkContinuation(store, current);
        if (!belongs(item))
            return unavailable('ordinary source membership ' + current);
        found.add(current);
        if (edge?.kind === 'family-source') {
            const prior = workAt(edge.sourceWorkId!);
            if (belongs(prior)) {
                parents.set(current, prior.work.id);
                pending.push(prior.work.id);
            }
        }
        // Reciprocal controller events also discover a successor whose edge
        // was lost. Its validator must refuse instead of treating it as fresh.
        const successors = store.all("SELECT id FROM works WHERE json_extract(data,'$.contextContinuation.kind')='family-source' AND json_extract(data,'$.contextContinuation.sourceWorkId')=? UNION SELECT json_extract(origin,'$.targetWorkId') AS id FROM sources WHERE json_extract(origin,'$.kind')='controller-family-source-continuation' AND json_extract(origin,'$.contextContinuation.sourceWorkId')=? LIMIT 65", current, current);
        if (successors.length > 64)
            return unavailable('many ordinary source incarnations');
        for (const successor of successors) {
            const next = workAt(successor.id), nextEdge = contextWorkContinuation(store, successor.id);
            if (!nextEdge || nextEdge.kind !== 'family-source' || nextEdge.sourceWorkId !== current)
                return unavailable('ordinary source successor ' + successor.id);
            if (belongs(next))
                pending.push(successor.id);
        }
    }
    for (const start of found) {
        const seen = new Set<string>();
        let current: string | undefined = start;
        while (current) {
            if (seen.has(current))
                return unavailable('cyclic ordinary source incarnations');
            seen.add(current);
            current = parents.get(current);
        }
    }
    return [...found];
}
function candidates(store: Store, ref: Ref, project: string) {
    if (ref.kind === 'governed') {
        const work = store.one('SELECT * FROM works WHERE id=?', ref.workId);
        if (!work || work.project !== project)
            return unavailable('governed work/project ' + ref.workId);
        const id = JSON.parse(work.data).invocation?.assignmentId;
        const row = id ? store.one('SELECT * FROM conversation_assignments WHERE id=? AND work=?', id, ref.workId) : null;
        if (!row)
            return unavailable('owner resume entry for work ' + ref.workId);
        return [candidate(store, row)];
    }
    const sources = ordinarySources(store, ref.workId), slots = sources.map(() => '?').join(',');
    return store.all("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change' AND json_extract(data,'$.projectId')=? AND (json_extract(data,'$.source.workId') IN (" + slots + ") OR json_extract(data,'$.continuationSourceWorkId') IN (" + slots + ')) ORDER BY rowid', project, ...sources, ...sources).map(row => candidate(store, row));
}
function selectOriginal(store: Store, refs: Ref[], lists: ReturnType<typeof candidates>[], target?: string) {
    const first = new Map(lists[0]!.map(item => [item.assignment.id, item]));
    const eligible = [...first.values()].filter(item => lists.every(list => list.some(other => other.assignment.id === item.assignment.id)));
    if (!eligible.length) {
        if (lists.some(list => list.length) || refs.some(ref => !same(ref, refs[0])))
            return unavailable('incompatible original continuation references');
        return undefined;
    }
    // Exact work references constrain identity even when another work occupies
    // the same conversation. Never replace them with its current cursor.
    if (refs.some(ref => ref.kind === 'governed'))
        return eligible[0];
    const ambiguous = (items: typeof eligible): never => unavailable('ambiguous original targets: ' + items.map(item => item.assignment.target + '/' + item.assignment.id + '/' + (item.assignment.work ?? 'queued')).join(', '));
    const matches = target ? eligible.filter(item => item.assignment.target === target) : [];
    if (!matches.length) {
        if (eligible.length !== 1)
            return ambiguous(eligible);
        return eligible[0];
    }
    const current = store.one('SELECT work FROM conversation_state WHERE conversation=?', target!)?.work;
    // A queued next assignment may precede its work admission while the cursor
    // still names an older completed work. That cursor cannot settle intent.
    if (matches.length > 1 && matches.some(item => !item.assignment.work && ['QUEUED', 'RUNNING'].includes(item.assignment.state)))
        return ambiguous(matches);
    const bound = matches.filter(item => item.assignment.work && item.assignment.work === current);
    if (bound.length === 1)
        return bound[0];
    if (matches.length === 1 && !current)
        return matches[0];
    return ambiguous(matches);
}
export function planContextAssignment(store: Store, actor: NativeIdentity, target: string | undefined, project: string, operation: 'investigate' | 'change', delegation: Delegation) {
    const actorContext = actorOrigin(store, actor), targetContext = target ? originAt(store, target) : null;
    if (!actorContext && !targetContext)
        return null;
    const currentWork = store.one('SELECT lineage,data FROM works WHERE id=?', actor.workId), actual = currentWork ? JSON.parse(currentWork.data).delegation : null;
    if (!actual || actual.rootWorkId !== delegation.rootWorkId || actual.maxAssignments < delegation.maxAssignments || delegation.projectIds.some(p => !actual.projectIds.includes(p)))
        return unavailable('captured actor delegation ' + actor.workId);
    if (actorContext) {
        const binding = executionContext(store, actor.conversationId)!;
        if (currentWork.lineage !== binding.family.budgetLineage || JSON.parse(currentWork.data).contextFamilyRoot !== binding.root)
            return unavailable('actor family work ' + actor.workId);
    }
    const sides = [[actor.conversationId, actorContext], ...(target ? [[target, targetContext]] : [])] as Array<[
        string,
        ContextOrigin | null
    ]>;
    const known = sides.filter((item): item is [
        string,
        ContextOrigin
    ] => item[1] !== null);
    for (const [, origin] of known)
        if (origin.delegationCeiling.maxAssignments < 1 || !origin.delegationCeiling.projectIds.includes(project) ||
            origin.delegationCeiling.rootWorkId !== null && origin.delegationCeiling.rootWorkId !== delegation.rootWorkId)
            return unavailable('captured context delegation/root');
    const refs = known.map(([cid, origin]) => reference(store, cid, origin));
    if (known.some(([, origin]) => origin.familyRoot !== known[0]![1].familyRoot))
        return unavailable('incompatible context families');
    let selected: ReturnType<typeof candidate> | undefined;
    if (operation === 'change') {
        const lists = refs.map(ref => candidates(store, ref, project));
        selected = selectOriginal(store, refs, lists, target);
    }
    else if (refs.some(ref => !same(ref, refs[0])))
        return unavailable('incompatible investigate references');
    const ref = refs.find(value => value.kind === 'governed') ?? refs[0]!;
    if (!selected && refs.some(value => !same(value, ref)))
        return unavailable('unresolved mixed original references');
    const ceiling = known.reduce((value, [, origin]) => ({ projectIds: value.projectIds.filter(p => origin.delegationCeiling.projectIds.includes(p)),
        maxAssignments: Math.min(value.maxAssignments, origin.delegationCeiling.maxAssignments), rootWorkId: origin.delegationCeiling.rootWorkId ?? value.rootWorkId }), { ...delegation, projectIds: [...delegation.projectIds] });
    return { actorOrigin: actorContext, targetOrigin: targetContext, inherited: targetContext ?? actorContext!, reference: ref, delegation: ceiling, selected };
}
export function inheritContextTarget(store: Store, target: string, actor: NativeIdentity, plan: NonNullable<ReturnType<typeof planContextAssignment>>, sourceEventId: string) {
    const state = store.one('SELECT work,data,resource,native_id FROM conversation_state WHERE conversation=?', target), data = JSON.parse(state.data);
    if (plan.targetOrigin)
        return plan.targetOrigin;
    if (state.work || state.native_id || store.one('SELECT history FROM conversations WHERE id=?', target).history || Object.hasOwn(data, 'nativeSeed') || data.role || state.resource !== 'IDLE' ||
        store.one('SELECT id FROM conversation_assignments WHERE target=? OR source_conversation=?', target, target) || store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED')", target) ||
        store.one("SELECT id FROM conversation_dependencies WHERE (waiting=? OR target=?) AND state='PENDING'", target, target) || Object.hasOwn(data, 'contextFamilyRoot'))
        return unavailable('nonempty target adoption ' + target);
    const origin: ContextOrigin = { ...plan.inherited, kind: 'inherited-context', sourceConversationId: actor.conversationId, sourceGeneration: actor.generation, sourceWorkId: actor.workId,
        sourceChoiceRevision: conversationModelChoice(store, actor.conversationId).revision, sourceEventId, continuation: plan.reference,
        effects: captureContextEffects(store, actor.conversationId, actor.workId, actor),
        delegationCeiling: { ...plan.delegation, projectIds: [...plan.delegation.projectIds] } };
    if (plan.actorOrigin?.effects.ceiling === 'none')
        origin.effects.ceiling = 'none';
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...data, contextFamilyRoot: origin.familyRoot, contextOrigin: origin }), target);
    return origin;
}
/** Retained row validation, independent of a still-live native parent handle. */
export function validateContextAssignmentLaunch(store: Store, assignmentId: string, phase?: 'fresh-begin' | 'captured') {
    const assignment = store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
    if (!assignment)
        return unavailable('assignment ' + assignmentId);
    const data = JSON.parse(assignment.data), targetOrigin = originAt(store, assignment.target);
    const saved = data.contextReentry ?? data.contextAssignment;
    const sourceContext = actorOrigin(store, saved?.actor ?? data.source);
    if (!saved && !targetOrigin && !sourceContext)
        return null;
    if (phase === 'fresh-begin' && data.operation !== 'change')
        return unavailable('governed operation kind ' + assignmentId);
    if (!saved || saved.version !== 1 || !same(saved.actorOrigin, sourceContext) || !same(saved.targetOrigin, targetOrigin) || !['change', 'investigate'].includes(data.operation) || assignment.state === 'CANCELLED')
        return unavailable('retained assignment origin ' + assignmentId);
    // The original receipt remains historical. Only a separately validated
    // recovery event can supply a current caller before explicit reentry.
    let actor = saved.actor as NativeIdentity;
    if (Object.hasOwn(data, 'authorityRecovery') && data.contextAssignment) {
        const authority = readAssignmentAuthority(store, assignmentId, true);
        validateRecoveredInheritedAssignment(store, assignmentId, authority);
        if (!data.contextReentry)
            actor = authority.actor;
    }
    const work = store.one('SELECT * FROM works WHERE id=?', actor.workId), run = store.one('SELECT * FROM runs WHERE id=?', actor.runId);
    const event = store.one('SELECT origin FROM sources WHERE id=?', saved.sourceEventId);
    if (!work || ['CANCELLED', 'UNKNOWN'].includes(work.state) || !run || run.work !== work.id || run.epoch !== work.epoch || !event || !same(JSON.parse(event.origin).actor, saved.actor))
        return unavailable('original source epoch/event ' + assignmentId);
    const delegation = saved.delegation;
    if (!saved.targetOrigin && !saved.actorOrigin || !delegation || !Array.isArray(delegation.projectIds) || !Number.isSafeInteger(delegation.maxAssignments) || delegation.maxAssignments < 1 ||
        !delegation.projectIds.includes(data.projectId) || delegation.rootWorkId !== data.delegationRoot)
        return unavailable('retained assignment ceiling ' + assignmentId);
    const ceiling = JSON.parse(work.data).delegation;
    if (!ceiling || ceiling.rootWorkId !== delegation.rootWorkId || ceiling.maxAssignments < delegation.maxAssignments || delegation.projectIds.some((p: string) => !ceiling.projectIds.includes(p)))
        return unavailable('current original delegation ' + assignmentId);
    const plan = planContextAssignment(store, actor, assignment.target, data.projectId, data.operation, delegation);
    if (!plan || !same(plan.reference, saved.reference))
        return unavailable('changed continuation reference ' + assignmentId);
    if (phase === 'fresh-begin' && assignment.work)
        throw new ContextAssignmentRetained(assignment.work);
    if (!assignment.work || phase === 'captured') {
        const input = store.one('SELECT * FROM conversation_inputs WHERE id=?', data.inputId), state = store.one('SELECT direction FROM conversation_state WHERE conversation=?', assignment.target);
        const conversation = store.one('SELECT generation FROM conversations WHERE id=?', assignment.target);
        if (!input || input.conversation !== assignment.target || input.source !== data.instructionsSource || input.state !== 'QUEUED' || state.direction !== data.observedTargetRevision || conversation.generation !== data.targetGeneration ||
            plan.selected && plan.selected.assignment.id !== assignment.id)
            return unavailable('changed queued instructions ' + assignmentId);
    }
    else if (data.operation === 'change' && plan.selected?.assignment.id !== assignment.id)
        return unavailable('changed original governed assignment ' + assignmentId);
    return assignment;
}
/** Owner entry uses the retained graph too; it cannot relabel a continuation as fresh. */
export function ownerChangeRoute(store: Store, cid: string, project: string) {
    const view = store.one('SELECT work,data FROM conversation_state WHERE conversation=?', cid);
    if (!view)
        return unavailable('owner conversation ' + cid);
    const data = JSON.parse(view.data);
    if (Object.hasOwn(data, 'role') || store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND json_type(data,'$.launchId') IS NOT NULL", cid))
        return unavailable('strict role view; use its original owner conversation');
    const binding = executionContext(store, cid), origin = validatedContextOrigin(store, cid);
    const refs: Ref[] = [];
    if (origin) {
        if (origin.continuation.kind !== 'first-family-work')
            refs.push(origin.continuation);
        else if (binding!.family.budgetAnchorWorkId)
            refs.push({ kind: store.one('SELECT work FROM change_state WHERE work=?', binding!.family.budgetAnchorWorkId) ? 'governed' : 'ordinary-source', workId: binding!.family.budgetAnchorWorkId });
    }
    if (!origin && !view.work && binding?.family.budgetAnchorWorkId)
        refs.push({ kind: store.one('SELECT work FROM change_state WHERE work=?', binding.family.budgetAnchorWorkId) ? 'governed' : 'ordinary-source', workId: binding.family.budgetAnchorWorkId });
    if (view.work)
        refs.push({ kind: store.one('SELECT work FROM change_state WHERE work=?', view.work) ? 'governed' : 'ordinary-source', workId: view.work });
    const originals = new Map<string, any>(), receipts: unknown[] = [], sources = new Set<string>();
    const add = (wid: string) => {
        const work = store.one('SELECT * FROM works WHERE id=?', wid);
        if (!work || work.project !== project || !store.one('SELECT work FROM change_state WHERE work=?', wid))
            return unavailable('governed work/project ' + wid);
        contextWorkContinuation(store, wid);
        originals.set(wid, work);
    };
    for (const ref of refs) {
        const work = store.one('SELECT * FROM works WHERE id=?', ref.workId);
        if (!work || work.project !== project)
            return unavailable('source work/project/cleanup ' + ref.workId);
        receipts.push(work);
        if (ref.kind === 'governed') {
            add(ref.workId);
            continue;
        }
        if (['UNKNOWN', 'CANCELLED'].includes(work.state))
            return unavailable('source work cleanup ' + ref.workId, ref.workId);
        const sourceData = JSON.parse(work.data);
        if (sourceData.kind !== 'ordinary-conversation')
            return unavailable('ordinary owner source ' + ref.workId);
        if (executionContext(store, sourceData.conversation))
            for (const wid of ordinarySources(store, ref.workId))
                sources.add(wid);
        else
            sources.add(ref.workId);
    }
    // A prior owner task in this actual source view remains an original even
    // after an ordinary follow-up replaces conversation_state.work.
    const owned = store.all("SELECT w.id FROM works w JOIN change_state c ON c.work=w.id WHERE json_extract(w.data,'$.conversation')=? LIMIT 65", cid);
    if (owned.length > 64 || sources.size > 64)
        return unavailable('many owner source works');
    for (const work of owned)
        add(work.id);
    if (sources.size) {
        const ids = [...sources], slots = ids.map(() => '?').join(',');
        const assignments = store.all("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change' AND (json_extract(data,'$.source.workId') IN (" + slots + ") OR json_extract(data,'$.continuationSourceWorkId') IN (" + slots + ')) LIMIT 65', ...ids, ...ids);
        if (assignments.length > 64)
            return unavailable('many original governed assignments');
        for (const assignment of assignments) {
            const retained = candidate(store, assignment);
            receipts.push(assignment);
            if (!retained.work)
                return unavailable('queued original assignment ' + assignment.id + '; continue through its original child');
            add(retained.work.id);
        }
        const successors = store.all('SELECT w.id FROM works w JOIN change_state c ON c.work=w.id WHERE w.predecessor IN (' + slots + ") OR json_extract(w.data,'$.continuationSourceWorkId') IN (" + slots + ') LIMIT 65', ...ids, ...ids);
        if (successors.length > 64)
            return unavailable('many governed successors');
        for (const work of successors)
            add(work.id);
    }
    if (originals.size > 1)
        return unavailable('ambiguous governed originals ' + [...originals.keys()].join(', '));
    return { workId: [...originals.keys()][0] ?? null, snapshot: { view, binding, origin, refs, sources: [...sources], originals: [...originals.values()], receipts } };
}

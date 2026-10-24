import type { Store } from './store.js';
import type { Delegation } from './coordination.js';
import type { NativeIdentity } from './interaction-types.js';
import { randomUUID } from 'node:crypto';
import { contextAdmissionProof } from './context-admission-proof.js';
import { historicalGovernedAssignment, readAssignmentAuthority } from './assignment-recovery-history.js';
import { hash } from './change-files.js';
export interface ContextFamily {
    version: 1;
    rootConversationId: string;
    budgetAnchorWorkId: string | null;
    budgetLineage: string | null;
    delegationRootWorkId: string | null;
}
export interface ContextOrigin {
    version: 1;
    kind: 'fork' | 'clone' | 'inherited-context';
    familyRoot: string;
    sourceConversationId: string;
    sourceGeneration: number;
    sourceWorkId: string | null;
    sourceChoiceRevision: number;
    sourceEventId: string;
    effects: {
        ceiling: 'none' | 'original-lineage';
        sourceEpoch: number | null;
    };
    continuation: {
        kind: 'governed' | 'ordinary-source';
        workId: string;
    } | {
        kind: 'first-family-work';
    };
    delegationCeiling: {
        projectIds: readonly string[];
        maxAssignments: number;
        rootWorkId: string | null;
    };
}
const fail = (detail: string): never => { throw new Error('Context origin unavailable; recover original ' + detail); };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function fields(value: unknown, keys: string[]): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        fail('record shape');
}
function familyRecord(value: unknown): ContextFamily {
    fields(value, ['version', 'rootConversationId', 'budgetAnchorWorkId', 'budgetLineage', 'delegationRootWorkId']);
    if (value.version !== 1 || !id(value.rootConversationId) ||
        [value.budgetAnchorWorkId, value.budgetLineage, value.delegationRootWorkId].some(v => v !== null && !id(v)) ||
        [value.budgetLineage, value.delegationRootWorkId].some(v => (v === null) !== (value.budgetAnchorWorkId === null)))
        fail('family binding');
    return structuredClone(value) as ContextFamily;
}
function originRecord(value: unknown): ContextOrigin {
    fields(value, ['version', 'kind', 'familyRoot', 'sourceConversationId', 'sourceGeneration', 'sourceWorkId', 'sourceChoiceRevision', 'sourceEventId', 'effects', 'continuation', 'delegationCeiling']);
    fields(value.effects, ['ceiling', 'sourceEpoch']);
    if (!['none', 'original-lineage'].includes(value.effects.ceiling) || (value.sourceWorkId === null ? value.effects.sourceEpoch !== null || value.effects.ceiling !== 'none' : !integer(value.effects.sourceEpoch)))
        fail('effect source epoch/ceiling');
    fields(value.delegationCeiling, ['projectIds', 'maxAssignments', 'rootWorkId']);
    const ceiling = value.delegationCeiling;
    if (value.version !== 1 || !['fork', 'clone', 'inherited-context'].includes(value.kind) || !id(value.familyRoot) || !id(value.sourceConversationId) ||
        !integer(value.sourceGeneration) || !(value.sourceWorkId === null || id(value.sourceWorkId)) || !integer(value.sourceChoiceRevision) || !id(value.sourceEventId) ||
        !integer(ceiling.maxAssignments) || ceiling.maxAssignments > 100 || !Array.isArray(ceiling.projectIds) || ceiling.projectIds.length > 100 ||
        ceiling.projectIds.some((v: unknown) => !id(v)) || new Set(ceiling.projectIds).size !== ceiling.projectIds.length || !(ceiling.rootWorkId === null || id(ceiling.rootWorkId)))
        fail('context ceiling/source');
    if (value.continuation?.kind === 'first-family-work')
        fields(value.continuation, ['kind']);
    else {
        fields(value.continuation, ['kind', 'workId']);
        if (!['governed', 'ordinary-source'].includes(value.continuation.kind) || !id(value.continuation.workId))
            fail('continuation work');
    }
    return structuredClone(value) as ContextOrigin;
}
function state(store: Store, cid: string) {
    const row = store.one('SELECT data FROM conversation_state WHERE conversation=?', cid);
    if (!row || !store.one('SELECT id FROM conversations WHERE id=?', cid))
        return fail('conversation ' + cid);
    const data = JSON.parse(row.data);
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return fail('conversation data ' + cid);
    return data;
}
/** Direct retained root reference: never infer identity from mutable UI parents. */
export function contextBinding(store: Store, cid: string) {
    const data = state(store, cid), hasOrigin = Object.hasOwn(data, 'contextOrigin');
    const origin = hasOrigin ? originRecord(data.contextOrigin) : undefined;
    if (!Object.hasOwn(data, 'contextFamilyRoot')) {
        if (origin || Object.hasOwn(data, 'contextFamily'))
            return fail('family root for ' + cid);
        return null;
    }
    const root = data.contextFamilyRoot;
    if (!id(root) || origin && origin.familyRoot !== root)
        return fail('root reference for ' + cid);
    const rootData = state(store, root), family = familyRecord(rootData.contextFamily);
    if (family.rootConversationId !== root || rootData.contextFamilyRoot !== root || Object.hasOwn(rootData, 'contextOrigin') ||
        cid !== root && !origin || cid !== root && Object.hasOwn(data, 'contextFamily'))
        return fail('root/family membership ' + root);
    if (origin) {
        if (origin.sourceConversationId === cid || !store.one('SELECT id FROM conversations WHERE id=?', origin.sourceConversationId))
            return fail('source conversation');
        for (const project of origin.delegationCeiling.projectIds)
            if (!store.one('SELECT id FROM projects WHERE id=?', project))
                return fail('project ' + project);
        const seen = new Set([cid]);
        let source = origin.sourceConversationId;
        for (let depth = 0; source !== root; depth++) {
            if (depth >= 64 || seen.has(source))
                return fail('cyclic/deep source chain at ' + source);
            seen.add(source);
            const sourceData = state(store, source), prior = originRecord(sourceData.contextOrigin);
            if (sourceData.contextFamilyRoot !== root || prior.familyRoot !== root)
                return fail('source family ' + source);
            source = prior.sourceConversationId;
        }
    }
    return { family, root, rootData, origin };
}
function healthyWork(store: Store, wid: string) {
    const work = store.one('SELECT * FROM works WHERE id=?', wid);
    if (!work || ['CANCELLED', 'UNKNOWN'].includes(work.state))
        return fail('work ' + wid);
    const latest = store.one('SELECT data FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1', wid);
    if (store.one("SELECT id FROM capacity_leases WHERE work=? AND state='QUARANTINED'", wid) || latest && String(JSON.parse(latest.data).cleanup ?? '').startsWith('quarantined'))
        return fail('quarantined work ' + wid);
    return work;
}
function healthyFamily(store: Store, family: ContextFamily) {
    if (!family.budgetAnchorWorkId)
        return;
    const anchor = healthyWork(store, family.budgetAnchorWorkId);
    if (anchor.lineage !== family.budgetLineage || !family.delegationRootWorkId)
        return fail('anchor lineage ' + anchor.id);
    healthyWork(store, family.delegationRootWorkId);
    for (const kind of ['execution', 'resolution']) {
        const budget = store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?', family.budgetLineage, kind);
        if (!budget || !integer(budget.lim) || budget.lim < 1 || !integer(budget.consumed) || !integer(budget.reserved) || budget.consumed + budget.reserved > budget.lim)
            return fail('budget ' + family.budgetLineage + '/' + kind);
    }
}
export function executionContext(store: Store, cid: string) {
    const binding = contextBinding(store, cid);
    if (!binding)
        return null;
    healthyFamily(store, binding.family);
    if (binding.origin?.sourceWorkId)
        healthyWork(store, binding.origin.sourceWorkId);
    if (binding.origin && binding.origin.continuation.kind !== 'first-family-work')
        healthyWork(store, binding.origin.continuation.workId);
    if (binding.origin?.delegationCeiling.rootWorkId)
        healthyWork(store, binding.origin.delegationCeiling.rootWorkId);
    return binding;
}
/** One historical inherited task under a separately recovered direct coordinator.
 * This never validates the inherited edge by recursively asking it for authority. */
export function contextAssignmentRecoveryScope(store: Store, assignmentId: string) {
    const saved = historicalGovernedAssignment(store, assignmentId), { assignment, data, work, value } = saved;
    const source = contextBinding(store, assignment.source_conversation), target = contextBinding(store, assignment.target);
    const origin = source?.origin, child = target?.origin, receipt = data.contextAssignment;
    if (!origin || !['clone', 'fork'].includes(origin.kind) || !child || child.kind !== 'inherited-context' || !source || !target || source.root !== target.root || !receipt || data.contextReentry && !data.authorityRecovery ||
        data.source.workId !== child.sourceWorkId || data.source.conversationId !== assignment.source_conversation || child.sourceConversationId !== assignment.source_conversation || child.sourceGeneration !== data.source.generation || child.sourceEventId !== data.instructionsSource ||
        hash(receipt.actor) !== hash(data.source) || hash(receipt.actorOrigin) !== hash(origin) || hash(receipt.targetOrigin) !== hash(child) || receipt.sourceEventId !== data.instructionsSource || hash(receipt.reference) !== hash(origin.continuation) || hash(child.continuation) !== hash(receipt.reference) || hash(receipt.delegation) !== hash(data.delegation) ||
        hash(value.contextOrigin) !== hash(child) || hash(value.contextContinuation) !== hash(continuation(child)) || value.contextFamilyRoot !== source.root)
        return fail('original inherited assignment source/context');
    // Only C is resolved live. D deliberately remains historical/cancelled here.
    validatedContextOrigin(store, assignment.source_conversation);
    const approval = contextAdmissionProof(store, assignment.source_conversation, origin, source.family);
    const coordinator = healthyWork(store, data.source.workId), coordinatorData = JSON.parse(coordinator.data);
    if (!approval || coordinatorData.conversation !== assignment.source_conversation || hash(coordinatorData.contextOrigin) !== hash(origin) || coordinator.lineage !== source.family.budgetLineage || data.delegationRoot !== origin.sourceWorkId || hash(coordinatorData.delegation) !== hash(data.delegation) || hash(data.delegation) !== hash(receipt.delegation))
        return fail('current original coordinator admission/ceiling');
    const eventRow = store.one("SELECT CASE WHEN length(CAST(raw AS BLOB))<=131072 THEN raw ELSE NULL END AS raw FROM sources WHERE id=?", approval.sourceId);
    const event = eventRow?.raw ? JSON.parse(eventRow.raw) : null, withdrawal = event?.cancelledWait;
    const scheduler = withdrawal?.previousScheduler?.data && Buffer.byteLength(withdrawal.previousScheduler.data) <= 65536 ? JSON.parse(withdrawal.previousScheduler.data) : null;
    if (!withdrawal || withdrawal.assignmentId !== assignment.id || withdrawal.workId !== work.id || withdrawal.childSource !== work.source || !Number.isSafeInteger(withdrawal.childEpoch) || withdrawal.childEpoch < 1 || withdrawal.conversationId !== assignment.target || withdrawal.coordinatorWorkId !== coordinator.id || withdrawal.proof !== saved.proof || withdrawal.cancellationSource !== data.cancellationSource ||
        withdrawal.previousScheduler.resource !== 'WAITING' || !scheduler || hash(scheduler.contextOrigin) !== hash(origin) || hash(scheduler.sourceIdentity) !== hash(data.source) || scheduler.continuationAuthorized !== true || hash(scheduler.waitHandles) !== hash([assignment.id]) || event.histories?.[1]?.runId !== data.source.runId)
        return fail('archived original cancelled wait/native actor');
    const dependency = store.one("SELECT id,waiting,target,assignment,state,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM conversation_dependencies WHERE id=?", withdrawal.dependency?.id);
    if (!dependency?.data || dependency.state !== 'CANCELLED' || dependency.waiting !== assignment.source_conversation || dependency.target !== assignment.target || dependency.assignment !== assignment.id || hash(dependency) !== hash(withdrawal.dependency) || hash(JSON.parse(dependency.data).source) !== hash(data.source))
        return fail('retained original cancelled dependency');
    const cancellation = store.one("SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin FROM sources WHERE id=?", data.cancellationSource), cancelled = cancellation?.origin ? JSON.parse(cancellation.origin) : null, requested = cancelled?.requestedWork;
    if (cancelled?.kind !== 'owner-task-cancel' || cancelled.uid !== process.getuid?.() || requested?.version !== 1 || requested.id !== coordinator.id || requested.sourceId !== coordinator.source || requested.toEpoch !== event.fromEpoch || requested.toState !== 'CANCELLED' || !Number.isSafeInteger(requested.fromEpoch) || requested.fromEpoch < 1 || !['ACTIVE', 'DELIVERED', 'INTERRUPTED', 'CANCELLED'].includes(requested.fromState) || !(requested.fromState === 'CANCELLED' ? requested.fromEpoch === requested.toEpoch : requested.fromEpoch + 1 === requested.toEpoch))
        return fail('explicit original coordinator cancellation scope');
    const instructions = store.one("SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin FROM sources WHERE id=?", data.instructionsSource);
    if (!instructions?.origin || hash(JSON.parse(instructions.origin).contextOrigin) !== hash(child))
        return fail('immutable inherited source event');
    return { saved, coordinator, origin, child, withdrawal, identity: { coordinatorWorkId: coordinator.id, sourceRootWorkId: origin.sourceWorkId, coordinatorRecoverySource: approval.sourceId, coordinatorProof: approval.fingerprint, cancellationSource: data.cancellationSource, assignmentId: assignment.id, workId: work.id, original: saved.proof } };
}
/** Shared by assignment action/dispatch and inherited source-epoch consumers. */
export function validateRecoveredInheritedAssignment(store: Store, assignmentId: string, authority = readAssignmentAuthority(store, assignmentId, true)) {
    if (!authority.saved?.data.contextAssignment)
        return null;
    const scope = contextAssignmentRecoveryScope(store, assignmentId), proof = authority.proof;
    if (!proof || proof.events !== 1 || hash(proof.context) !== hash(scope.identity) || proof.fromEpoch !== scope.withdrawal.childEpoch || authority.actor.workId !== scope.coordinator.id || authority.actor.conversationId !== scope.saved.assignment.source_conversation || proof.epoch !== scope.coordinator.epoch)
        return fail('recovered inherited authority transition');
    return { assignmentId, sourceEpoch: proof.epoch, proof: proof.fingerprint, coordinatorProof: scope.identity.coordinatorProof };
}
function inheritedRecovery(store: Store, cid: string, origin: ContextOrigin) {
    if (origin.kind !== 'inherited-context')
        return null;
    const row = store.one("SELECT CASE WHEN length(CAST(w.data AS BLOB))<=1048576 THEN json_extract(w.data,'$.invocation.assignmentId') ELSE NULL END AS assignmentId FROM conversation_state c JOIN works w ON w.id=c.work WHERE c.conversation=?", cid);
    if (!row?.assignmentId)
        return null;
    const recovered = store.one("SELECT CASE WHEN json_valid(data) THEN json_type(data,'$.authorityRecovery') IS NOT NULL ELSE 1 END AS recovered FROM conversation_assignments WHERE id=?", row.assignmentId);
    return recovered?.recovered ? validateRecoveredInheritedAssignment(store, row.assignmentId) : null;
}
/** Validate immutable event/epoch operands; no grant or budget is created here. */
export function validatedContextOrigin(store: Store, cid: string): ContextOrigin | null {
    const binding = executionContext(store, cid);
    if (!binding?.origin)
        return null;
    let current = cid;
    for (let depth = 0; current !== binding.root; depth++) {
        if (depth >= 64)
            return fail('deep effect source chain');
        const item = executionContext(store, current)?.origin;
        if (!item)
            return fail('source origin ' + current);
        const event = store.one('SELECT conversation,origin FROM sources WHERE id=?', item.sourceEventId);
        if (!event || event.conversation !== current || JSON.stringify(JSON.parse(event.origin).contextOrigin) !== JSON.stringify(item))
            return fail('source event ' + item.sourceEventId);
        const recovery = contextAdmissionProof(store, current, item, binding.family);
        const inherited = inheritedRecovery(store, current, item);
        if (item.sourceWorkId && healthyWork(store, item.sourceWorkId).epoch !== (inherited?.sourceEpoch ?? recovery?.sourceEpoch ?? item.effects.sourceEpoch))
            return fail('effect source epoch ' + item.sourceWorkId);
        current = item.sourceConversationId;
    }
    return binding.origin;
}
const continuation = (origin: ContextOrigin) => ({ version: 1, sourceWorkId: origin.sourceWorkId, sourceConversationId: origin.sourceConversationId,
    sourceEventId: origin.sourceEventId, effects: origin.effects.ceiling, sourceEpoch: origin.effects.sourceEpoch });
type WorkContinuation = ReturnType<typeof continuation> & {
    kind?: 'family-source';
    familyRoot?: string;
};
/** Read-only projection: never shares ordinary budgets or delegates authority. */
export function contextWorkMetadata(store: Store, cid: string) {
    const origin = validatedContextOrigin(store, cid);
    return origin ? { contextFamilyRoot: origin.familyRoot, contextOrigin: origin, contextContinuation: continuation(origin) } : {};
}
export function contextWorkContinuation(store: Store, wid: string) {
    const work = store.one('SELECT * FROM works WHERE id=?', wid);
    if (!work)
        return fail('work ' + wid);
    const data = JSON.parse(work.data);
    const hasOrigin = Object.hasOwn(data, 'contextOrigin'), hasEdge = Object.hasOwn(data, 'contextContinuation');
    const origin = data.conversation ? validatedContextOrigin(store, data.conversation) : null;
    if (!hasOrigin && hasEdge && data.contextContinuation?.kind === 'family-source') {
        const edge = data.contextContinuation;
        fields(edge, ['version', 'kind', 'familyRoot', 'sourceWorkId', 'sourceConversationId', 'sourceEventId', 'effects', 'sourceEpoch']);
        const binding = executionContext(store, data.conversation);
        if (edge.version !== 1 || !id(edge.sourceWorkId) || !id(edge.sourceEventId) || !integer(edge.sourceEpoch) || !['none', 'original-lineage'].includes(edge.effects) ||
            !binding || binding.origin || binding.root !== data.conversation || data.contextFamilyRoot !== binding.root || edge.familyRoot !== binding.root || edge.sourceConversationId !== binding.root || work.predecessor !== edge.sourceWorkId || edge.sourceWorkId === wid)
            return fail('family source continuation ' + wid);
        const prior = healthyWork(store, edge.sourceWorkId), event = store.one('SELECT conversation,origin FROM sources WHERE id=?', edge.sourceEventId), proof = event ? JSON.parse(event.origin) : null;
        if (prior.epoch !== edge.sourceEpoch || edge.effects !== 'none' && JSON.parse(prior.data).conversation !== edge.sourceConversationId || event?.conversation !== binding.root || proof?.kind !== 'controller-family-source-continuation' ||
            proof.targetWorkId !== wid || proof.familyRoot !== binding.root || JSON.stringify(proof.contextContinuation) !== JSON.stringify(edge))
            return fail('family source event/epoch ' + wid);
        healthyWork(store, wid);
        return edge as WorkContinuation;
    }
    if (!hasEdge && store.one("SELECT id FROM sources WHERE json_extract(origin,'$.kind')='controller-family-source-continuation' AND json_extract(origin,'$.targetWorkId')=?", wid))
        return fail('missing retained family source continuation ' + wid);
    if (!hasOrigin && !hasEdge && !origin)
        return null;
    healthyWork(store, wid);
    if (!hasOrigin || !hasEdge || !origin || JSON.stringify(data.contextOrigin) !== JSON.stringify(origin) || JSON.stringify(data.contextContinuation) !== JSON.stringify(continuation(origin)))
        return fail('retained effect continuation ' + wid);
    return data.contextContinuation as WorkContinuation;
}
/** Capture from the SOURCE view, not from other role views sharing its W. */
export function captureContextEffects(store: Store, cid: string, wid: string | null, identity?: NativeIdentity): ContextOrigin['effects'] {
    const view = store.one('SELECT work,data FROM conversation_state WHERE conversation=?', cid), data = view ? JSON.parse(view.data) : null;
    if (!view || view.work !== wid || identity && (identity.conversationId !== cid || identity.workId !== wid))
        return fail('effect source allocation ' + cid);
    if (!wid)
        return { ceiling: 'none', sourceEpoch: null };
    const work = healthyWork(store, wid);
    const inputs = store.all("SELECT data FROM conversation_inputs WHERE conversation=? AND generation=(SELECT generation FROM conversations WHERE id=?) AND mode='initial'", cid, cid);
    const launchIds = inputs.map(row => JSON.parse(row.data).launchId).filter(value => value !== undefined);
    if (Object.hasOwn(data, 'role') || identity?.launchId || launchIds.length) {
        const run = data.runId ? store.one('SELECT * FROM runs WHERE id=?', data.runId) : null;
        const launch = run ? store.one('SELECT * FROM role_launches WHERE work=? AND run=? AND role=? AND epoch=?', wid, run.id, data.role, work.epoch) : null;
        if (!run || run.work !== wid || run.epoch !== work.epoch || !launch || launchIds.length !== 1 || launchIds[0] !== launch.id || identity && (identity.launchId !== launch.id || identity.runId !== run.id))
            return fail('strict role source allocation ' + cid);
        return { ceiling: 'none', sourceEpoch: work.epoch };
    }
    if (JSON.parse(work.data).conversation !== cid)
        return fail('ordinary effect source view ' + cid);
    const inherited = contextWorkContinuation(store, wid);
    return { ceiling: inherited?.effects === 'none' ? 'none' : 'original-lineage', sourceEpoch: work.epoch };
}
/** Only immutable authority operands: normal assignment progress is not drift. */
export function contextAuthoritySnapshot(store: Store, path: string[]) {
    const rows = path.map(wid => {
        const work = store.one('SELECT * FROM works WHERE id=?', wid), data = JSON.parse(work.data), edge = contextWorkContinuation(store, wid);
        const aid = data.invocation?.assignmentId ?? data.assignmentId, assignment = aid ? store.one('SELECT * FROM conversation_assignments WHERE id=?', aid) : null;
        const a = assignment ? JSON.parse(assignment.data) : null;
        const binding = data.conversation ? contextBinding(store, data.conversation) : null;
        const recovery = binding?.origin ? contextAdmissionProof(store, data.conversation, binding.origin, binding.family) : null;
        const inherited = binding?.origin ? inheritedRecovery(store, data.conversation, binding.origin) : null;
        return { workId: wid, epoch: work.epoch, context: edge ? { origin: data.contextOrigin, edge, sourceEvent: JSON.parse(store.one('SELECT origin FROM sources WHERE id=?', edge.sourceEventId).origin), ...(recovery ? { recovery } : {}), ...(inherited ? { inheritedRecovery: inherited } : {}) } : null,
            assignment: assignment ? { id: assignment.id, work: assignment.work, source: assignment.source_conversation, target: assignment.target, operation: a.operation, actor: a.source } : null };
    });
    return rows.some(row => row.context) ? rows : undefined;
}
/** Called ONLY inside Ordinary's existing admission transaction. Family claims
 * and source receipts share that transaction; this never grants action standing. */
export function admitContextWork(store: Store, cid: string, wid: string, baseline: Delegation, existing?: {
    lineage: string;
    data: string;
}, admittedKind?: 'governed') {
    const binding = contextBinding(store, cid);
    if (!binding)
        return { lineage: wid, delegation: baseline, initializeBudgets: true, metadata: {} };
    const { family, root, origin } = binding;
    const originMetadata = origin ? contextWorkMetadata(store, cid) : {};
    healthyFamily(store, family);
    if (origin?.sourceWorkId)
        healthyWork(store, origin.sourceWorkId);
    if (origin?.continuation.kind !== undefined && origin.continuation.kind !== 'first-family-work')
        healthyWork(store, origin.continuation.workId);
    if (origin?.delegationCeiling.rootWorkId)
        healthyWork(store, origin.delegationCeiling.rootWorkId);
    const old = existing ? JSON.parse(existing.data) : undefined;
    if (origin && existing && JSON.stringify(old.contextOrigin) !== JSON.stringify(origin))
        return fail('work origin ' + wid);
    if (existing)
        contextWorkContinuation(store, wid);
    if (existing && !old.delegation)
        return fail('retained delegation ' + wid);
    for (const value of [baseline, ...(old?.delegation ? [old.delegation] : [])]) {
        if (!value || !Array.isArray(value.projectIds) || value.projectIds.length > 100 || value.projectIds.some((v: unknown) => !id(v)) ||
            !integer(value.maxAssignments) || value.maxAssignments > 100 || !id(value.rootWorkId))
            return fail('captured delegation ' + wid);
    }
    let delegation: Delegation = { ...baseline, projectIds: [...baseline.projectIds] };
    if (origin) {
        const ceiling = origin.delegationCeiling;
        delegation = { projectIds: delegation.projectIds.filter(p => ceiling.projectIds.includes(p)), maxAssignments: Math.min(delegation.maxAssignments, ceiling.maxAssignments),
            rootWorkId: ceiling.rootWorkId ?? family.delegationRootWorkId ?? baseline.rootWorkId };
    }
    else
        delegation.rootWorkId = family.delegationRootWorkId ?? baseline.rootWorkId;
    if (old?.delegation) {
        delegation.projectIds = delegation.projectIds.filter(p => old.delegation.projectIds.includes(p));
        delegation.maxAssignments = Math.min(delegation.maxAssignments, old.delegation.maxAssignments);
        if (old.delegation.rootWorkId !== delegation.rootWorkId)
            return fail('captured delegation root ' + wid);
    }
    const initializeBudgets = family.budgetAnchorWorkId === null;
    if (initializeBudgets && (store.one('SELECT work FROM conversation_state WHERE conversation=?', root)?.work ||
        origin && (origin.sourceWorkId !== null || origin.continuation.kind !== 'first-family-work' || origin.delegationCeiling.rootWorkId !== null)))
        return fail('empty family/source binding ' + root);
    if (existing && (initializeBudgets || existing.lineage !== family.budgetLineage))
        return fail('retained work lineage ' + wid);
    if (initializeBudgets) {
        family.budgetAnchorWorkId = wid;
        family.budgetLineage = wid;
        family.delegationRootWorkId = delegation.rootWorkId;
        store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...binding.rootData, contextFamily: family }), root);
    }
    const metadata: Record<string, unknown> = { contextFamilyRoot: root, ...originMetadata };
    if (!origin && !existing) {
        const prior = store.one('SELECT work,data FROM conversation_state WHERE conversation=?', cid), priorData = JSON.parse(prior.data);
        if (prior.work) {
            if (prior.work === wid)
                return fail('unbound new family source ' + cid);
            const capability = captureContextEffects(store, cid, prior.work), sourceEventId = randomUUID();
            const edge: WorkContinuation = { version: 1, kind: 'family-source', familyRoot: root, sourceWorkId: prior.work, sourceConversationId: cid, sourceEventId, effects: capability.ceiling, sourceEpoch: capability.sourceEpoch };
            store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceEventId, cid, JSON.stringify({ kind: 'controller-family-source-continuation', targetWorkId: wid, familyRoot: root, contextContinuation: edge }), 'Retained actual predecessor capability; no new owner grant');
            metadata.contextContinuation = edge;
        }
        else if (store.one("SELECT id FROM works WHERE json_extract(data,'$.conversation')=?", cid) || Object.hasOwn(priorData, 'role') || Object.hasOwn(priorData, 'runId') ||
            store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND json_type(data,'$.launchId') IS NOT NULL", cid))
            return fail('missing original family source linkage ' + cid);
    }
    if (origin) {
        const reference = origin.continuation;
        const work = reference.kind === 'first-family-work' ? family.budgetAnchorWorkId! : reference.workId;
        const governed = reference.kind === 'governed' || reference.kind === 'first-family-work' && (admittedKind === 'governed' && work === wid || !!store.one('SELECT work FROM change_state WHERE work=?', work));
        metadata[governed ? 'continuationWorkId' : 'continuationSourceWorkId'] = work;
    }
    return { lineage: family.budgetLineage!, delegation, initializeBudgets, metadata };
}
/** Trusted owner transition shares the source family's original allowances and ceiling. */
export function admitOwnerChange(store: Store, cid: string, wid: string, baseline: Delegation) {
    if (!Array.isArray(baseline.projectIds) || baseline.projectIds.length > 100 || new Set(baseline.projectIds).size !== baseline.projectIds.length || baseline.projectIds.some(project => !store.one('SELECT id FROM projects WHERE id=?', project)) || !integer(baseline.maxAssignments) || baseline.maxAssignments > 100 || !id(baseline.rootWorkId))
        return fail('finite registered owner delegation');
    const prior = store.one('SELECT work,data FROM conversation_state WHERE conversation=?', cid);
    if (!prior)
        return fail('owner source conversation');
    if (!contextBinding(store, cid) && prior.work) {
        const work = healthyWork(store, prior.work), data = JSON.parse(work.data), delegation = data.delegation;
        if (data.kind !== 'ordinary-conversation' || data.conversation !== cid || !delegation || !id(delegation.rootWorkId))
            return fail('owner source delegation');
        const family: ContextFamily = { version: 1, rootConversationId: cid, budgetAnchorWorkId: work.id, budgetLineage: work.lineage, delegationRootWorkId: delegation.rootWorkId };
        store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...JSON.parse(prior.data), contextFamilyRoot: cid, contextFamily: family }), cid);
    }
    const binding = contextBinding(store, cid);
    const capturedRoots = [prior.work, binding?.family.delegationRootWorkId].filter((value): value is string => !!value);
    for (const root of new Set(capturedRoots)) {
        const work = healthyWork(store, root), ceiling = JSON.parse(work.data).delegation;
        if (!ceiling || !Array.isArray(ceiling.projectIds) || ceiling.projectIds.some((value: unknown) => !id(value)) || !integer(ceiling.maxAssignments) || ceiling.maxAssignments > 100 || !id(ceiling.rootWorkId))
            return fail('captured owner delegation ceiling');
        baseline = { ...baseline, projectIds: baseline.projectIds.filter(project => ceiling.projectIds.includes(project)), maxAssignments: Math.min(baseline.maxAssignments, ceiling.maxAssignments) };
    }
    const context = admitContextWork(store, cid, wid, baseline, undefined, 'governed');
    return { ...context, predecessor: prior.work ?? null };
}

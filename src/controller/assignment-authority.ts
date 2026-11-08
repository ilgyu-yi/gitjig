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
import { sameNativeIdentity } from './native-identity.js';
import { coordinationBytes } from './conversation-results.js';
import { parseUniqueJson } from '../workflow/json.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
const object = (raw: string, unique = false) => {
    const value = (unique ? parseUniqueJson(raw) : JSON.parse(raw)) as Record<string, any> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Original assignment object unavailable');
    return value;
};
function blockedResumeFingerprint(store: Store, resultId: string, conversation: string, work: string,
    admittedDirections?: { pendingResumeInput: string | undefined }) {
    const state = store.one(`SELECT c.epoch,c.base,c.candidate,c.plan,c.verification,w.epoch AS workEpoch,w.generation,w.source,
        ${bounded('c.data', 1024 * 1024)} AS data FROM change_state c JOIN works w ON w.id=c.work WHERE c.work=? AND c.phase='BLOCKED'`, work);
    if (!state?.data) return null;
    const result = store.one(`SELECT previous,${bounded('data', coordinationBytes)} AS data FROM conversation_results WHERE id=? AND conversation=? AND work=?`, resultId, conversation, work);
    if (!result?.data) return null;
    const held = store.all(`SELECT conversation,revision,source,${bounded('data',65536)} AS data FROM conversation_directions
        WHERE json_extract(data,'$.affectedWorkId')=? AND json_extract(data,'$.effectHold')=1 ORDER BY revision LIMIT 65`, work);
    if (!held.length) return hash([state, result]);
    if (!admittedDirections || held.length > 64) return null;
    try {
        const proof = admittedDirectionResumeProof(store, work, conversation, resultId, held, admittedDirections.pendingResumeInput);
        return proof ? hash(['admitted-direction-resume/v1', state, result, proof]) : null;
    } catch { return null; }
}

export function blockedAssignmentResumeFingerprint(store: Store, resultId: string, conversation: string, work: string) {
    return blockedResumeFingerprint(store, resultId, conversation, work);
}

/** Read the original failed publication and authenticate its direct assignment. */
function directFailedAssignment(store: Store, workId: string) {
    const work = store.one('SELECT source,state,epoch,generation FROM works WHERE id=?', workId);
    if (work?.state !== 'ACTIVE') return;
    const origin = store.one(`SELECT ${bounded('origin',65536)} AS origin FROM sources WHERE id=?`, work.source)?.origin;
    const invocation = origin && object(origin);
    if (invocation?.kind !== 'agent-governed-assignment' || typeof invocation.assignmentId !== 'string') return;
    const saved = original(store, invocation.assignmentId, false);
    const {assignment} = saved;
    if (assignment.work !== workId || saved.work.lineage !== workId || saved.work.predecessor ||
        saved.value.contextOrigin || saved.value.contextFamilyRoot || saved.data.contextAssignment || saved.data.contextReentry || saved.data.authorityRecovery) return;
    const resultId = store.one("SELECT json_extract(data,'$.resultId') AS resultId FROM conversation_assignments WHERE id=?", assignment.id)?.resultId;
    if (typeof resultId !== 'string' || !resultId || resultId.length > 512) return;
    const row = store.one(`SELECT previous,${bounded('data',coordinationBytes)} AS data FROM conversation_results WHERE id=? AND conversation=? AND work=?`,
        resultId, assignment.target, workId);
    if (!row?.data) return;
    const publication = object(row.data), result = publication.result;
    if (publication.assignmentId !== assignment.id || publication.projectId !== saved.work.project ||
        result?.kind !== 'governed-work-observation/v1' || result.workId !== workId || result.phase !== 'BLOCKED' ||
        result.reviewReady !== false || result.state === 'UNKNOWN' || result.recordedResult?.state === 'UNKNOWN' ||
        !Number.isSafeInteger(result.epoch) || result.epoch < 1 ||
        publication.publicationHash !== hash(result)) return;
    const state = store.one(`SELECT epoch,phase,base,candidate,plan,verification,${bounded('data',1024 * 1024)} AS data FROM change_state WHERE work=?`, workId);
    const target = store.one(`SELECT c.generation,s.direction,s.work FROM conversations c
        JOIN conversation_state s ON s.conversation=c.id WHERE c.id=?`, assignment.target);
    if (!state?.data || typeof state.base !== 'string' || target?.work !== workId) return;
    const proof = {resultId, fromEpoch: result.epoch, correspondence: hash([assignment.id, assignment.target, saved.proof, row,
        work.source, work.generation, state.base, state.candidate, target])};
    return {assignment, work, state, proof, result, target, data: saved.data};
}

function admittedDirectionResumeProof(store: Store, workId: string, conversation: string, resultId: string,
    held: { conversation: string; revision: number; source: string; data: string | null }[], pendingResumeInput?: string) {
    const saved = directFailedAssignment(store, workId);
    if (!saved || saved.proof.resultId !== resultId || saved.assignment.target !== conversation ||
        saved.state.epoch !== saved.work.epoch || saved.result.epoch !== saved.work.epoch ||
        saved.result.baseVersion !== saved.state.base || saved.result.candidateVersion !== saved.state.candidate ||
        saved.result.planVersion !== saved.state.plan || saved.result.verificationVersion !== saved.state.verification) return;
    if (store.one(`SELECT id FROM conversation_inputs WHERE conversation=? AND id<>COALESCE(?, '')
        AND state NOT IN ('CONSUMED','HANDLED','CANCELLED','CONFLICTED') LIMIT 1`, conversation, pendingResumeInput ?? null)) return;
    const requests = saved.data.reentries;
    if (!Array.isArray(requests) || requests.length > 64) return;
    const directions = [];
    const admittedInputs = new Set<string>();
    for (const row of held) {
        if (!row.data || row.conversation !== conversation || !Number.isSafeInteger(row.revision) ||
            row.revision < 1 || row.revision > saved.target.direction) return;
        const direction = object(row.data, true);
        if (direction.effectHold !== true || direction.inherited || direction.affectedRunId !== null ||
            direction.affectedAssignmentId !== saved.assignment.id || direction.affectedGeneration !== saved.target.generation ||
            typeof direction.inputId !== 'string' || admittedInputs.has(direction.inputId)) return;
        const matches = requests.filter(request => request?.inputId === direction.inputId);
        const request = matches[0];
        if (matches.length !== 1 || Object.hasOwn(request, 'resumeResultId') || request.source !== row.source ||
            request.actor?.conversationId !== saved.assignment.source_conversation ||
            request.actor?.workId !== saved.data.delegationRoot) return;
        const {input, source} = governedInputSource(store, direction.inputId, row.source);
        if (input.conversation !== conversation || input.generation !== saved.target.generation ||
            input.work !== workId || input.source !== row.source || input.state !== 'CONSUMED' ||
            input.mode !== 'reentry' || source.conversation !== conversation ||
            !input.text.trim() || Buffer.byteLength(input.text) > 128 * 1024) return;
        const admitted = object(input.data, true), origin = object(source.origin, true);
        if (admitted.assignment !== saved.assignment.id || admitted.governedWork !== workId ||
            origin.kind !== 'agent-governed-reentry' || origin.assignmentId !== saved.assignment.id ||
            origin.originalWork !== workId || Object.hasOwn(origin, 'resumeResultId') ||
            !sameNativeIdentity(origin.actor, request.actor)) return;
        admittedInputs.add(direction.inputId);
        directions.push(hash([row, input, source, request]));
    }
    return {original: saved.proof, directions};
}

export function captureCriteriaResume(store: Store, workId: string) {
    try {
        const saved = directFailedAssignment(store, workId);
        if (saved?.assignment.state !== 'UNAVAILABLE' || saved.work.epoch !== saved.proof.fromEpoch || saved.state.epoch !== saved.work.epoch ||
            saved.result.baseVersion !== saved.state.base || saved.result.candidateVersion !== saved.state.candidate ||
            saved.result.planVersion !== saved.state.plan || saved.result.verificationVersion !== saved.state.verification ||
            !blockedAssignmentResumeFingerprint(store, saved.proof.resultId, saved.assignment.target, workId)) return;
        return saved.proof;
    } catch { return; }
}

export function assignmentResumeFingerprint(store: Store, resultId: string, conversation: string, workId: string,
    observationEpoch?: number, pendingResumeInput?: string) {
    const blocked = blockedResumeFingerprint(store, resultId, conversation, workId, {pendingResumeInput});
    if (blocked)
        return observationEpoch === undefined || store.one('SELECT epoch FROM works WHERE id=?',workId)?.epoch === observationEpoch ? blocked : null;
    try {
        const saved = directFailedAssignment(store, workId);
        if (!saved || saved.proof.resultId !== resultId || saved.assignment.target !== conversation ||
            observationEpoch !== undefined && observationEpoch !== saved.proof.fromEpoch ||
            saved.work.epoch !== saved.proof.fromEpoch + 1 || saved.state.epoch !== saved.work.epoch ||
            saved.state.phase !== 'BASE_CAPTURED' || saved.state.plan !== null || saved.state.verification !== null ||
            store.one('SELECT id FROM runs WHERE work=? AND epoch>=? LIMIT 1', workId, saved.work.epoch) ||
            store.one("SELECT source FROM conversation_directions WHERE json_extract(data,'$.affectedWorkId')=? AND json_extract(data,'$.effectHold')=1 LIMIT 1", workId)) return null;
        const data = object(saved.state.data), refresh = data.criteriaRefresh;
        if (!refresh || data.resumeStage !== 'plan' || data.contractsVersion !== refresh.toContractsVersion) return null;
        const lastRequest = saved.data.reentries?.at(-1);
        const pendingResume = lastRequest?.resumeResultId === resultId ? lastRequest.inputId : null;
        if (store.one(`SELECT id FROM conversation_inputs WHERE conversation=? AND id<>COALESCE(?, '')
            AND state NOT IN ('CONSUMED','HANDLED','CANCELLED','CONFLICTED') LIMIT 1`, conversation, pendingResume)) return null;
        const source = store.one(`SELECT conversation,${bounded('origin',65536)} AS origin FROM sources WHERE id=?`, refresh.sourceId);
        const origin = source?.origin && object(source.origin);
        const criteria = store.one(`SELECT work,kind,hash,predecessor,
            CASE WHEN length(CAST(data AS BLOB))<=2097152 THEN json_extract(data,'$.refreshSource') END AS source
            FROM change_versions WHERE id=?`, refresh.toContractsVersion);
        if (!origin || source.conversation !== null || origin.kind !== 'owner-criteria-refresh' || origin.uid !== process.getuid?.() ||
            origin.work !== workId || origin.fromContractsVersion !== refresh.fromContractsVersion ||
            hash(origin.assignmentResume ?? null) !== hash(saved.proof) || criteria?.work !== workId || criteria.kind !== 'contracts' ||
            criteria.hash !== origin.toHash || criteria.source !== refresh.sourceId || criteria.predecessor !== refresh.fromContractsVersion ||
            !store.one("SELECT id FROM change_versions WHERE id=? AND work=? AND kind='contracts'",refresh.fromContractsVersion,workId)) return null;
        return hash(['criteria-resume/v1', saved.proof, saved.state, refresh.sourceId, source, criteria]);
    } catch { return null; }
}
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

function governedInputSource(store: Store, inputId: string, sourceId: string) {
    const input = store.one(`SELECT id,conversation,generation,work,source,state,mode,
        ${bounded('text', 524288)} AS text,${bounded('data', 65536)} AS data FROM conversation_inputs WHERE id=?`, inputId ?? null);
    const source = store.one(`SELECT id,conversation,${bounded('origin', 65536)} AS origin,
        ${bounded('raw', 524288)} AS raw FROM sources WHERE id=?`, sourceId ?? null);
    if (!input?.data || typeof input.text !== 'string' || !source?.origin || typeof source.raw !== 'string' || input.text !== source.raw)
        throw Error('Original assignment delivery bytes unavailable');
    return { input, source };
}

function governedAssignmentDelivery(store: Store, id: string) {
    const assignment = store.one(`SELECT ${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, id);
    if (!assignment?.data) throw Error('Original bounded assignment input unavailable');
    const data = object(assignment.data), entries = data.reentries ?? [];
    if (!Array.isArray(entries) || entries.length > 64) throw Error('Original bounded assignment input unavailable');
    const reentry = entries.at(-1), inputId = reentry ? reentry.inputId : data.inputId;
    const sourceId = reentry ? reentry.source : data.instructionsSource;
    return { dispatchToken: assignmentDispatchToken(store, id), ...governedInputSource(store, inputId, sourceId) };
}

/** Capture before asynchronous work capture; IDs alone do not bind delivered text. */
export function captureGovernedAssignmentInput(store: Store, id: string) {
    const delivery = governedAssignmentDelivery(store, id);
    return Object.freeze({ dispatchToken: delivery.dispatchToken, fingerprint: hash(delivery) });
}

/** Acknowledge delivery to the owned workflow, not source fit or task success.
 * Initial capture and same-task reentry consume only their exact dispatch input.
 */
export function consumeGovernedAssignmentInput(store: Store, id: string, workId: string, captured: ReturnType<typeof captureGovernedAssignmentInput>): void {
    store.tx(() => {
        const refuse = (): never => { throw Error('Original governed assignment input changed before admission'); };
        const delivery = governedAssignmentDelivery(store, id);
        if (delivery.dispatchToken !== captured.dispatchToken || hash(delivery) !== captured.fingerprint) refuse();
        const assignment = store.one(`SELECT target,work,state,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, id);
        const work = store.one('SELECT project,state FROM works WHERE id=?', workId);
        const target = assignment && store.one(`SELECT c.project,c.generation,s.work,s.direction,s.resource,s.archived,
            ${bounded('s.data', 65536)} AS data FROM conversations c JOIN conversation_state s ON s.conversation=c.id WHERE c.id=?`, assignment.target);
        if (!assignment?.data || assignment.work !== workId || !['QUEUED', 'RUNNING'].includes(assignment.state) ||
            !work || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state) || !target?.data || target.work !== workId ||
            target.project !== work.project || target.archived || target.resource !== 'IDLE' || object(target.data).lifecycle?.deleted) refuse();
        const data = object(assignment.data), entries = data.reentries ?? [];
        if (data.operation !== 'change' || data.projectId !== work.project || !Array.isArray(entries) || entries.length > 64) refuse();
        const reentry = entries.at(-1), inputId = reentry ? reentry.inputId : data.inputId;
        const sourceId = reentry ? reentry.source : data.instructionsSource;
        const {input, source} = delivery;
        if (!input?.data || !source?.origin || input.conversation !== assignment.target || source.conversation !== assignment.target ||
            input.source !== sourceId || input.generation !== target.generation || object(input.data).assignment !== id) refuse();
        const origin = object(source.origin);
        if (reentry) {
            const direction = store.one(`SELECT revision,${bounded('data', 65536)} AS data FROM conversation_directions WHERE conversation=? AND source=?`, assignment.target, sourceId);
            if (input.state !== 'DISPATCHED_WORKFLOW' || input.mode !== 'reentry' || input.work !== workId ||
                origin.kind !== 'agent-governed-reentry' || origin.assignmentId !== id || origin.originalWork !== workId ||
                !sameNativeIdentity(origin.actor, reentry.actor)) refuse();
            if (Object.hasOwn(reentry, 'resumeResultId')) {
                if (typeof reentry.resumeResultId !== 'string' || reentry.resumeResultId !== data.resultId || origin.resumeResultId !== reentry.resumeResultId ||
                    !Number.isSafeInteger(reentry.observedDirectionRevision) || origin.observedDirectionRevision !== target.direction ||
                    reentry.observedDirectionRevision !== target.direction || direction || work.state !== 'ACTIVE' ||
                    typeof reentry.resultFingerprint !== 'string' || origin.resultFingerprint !== reentry.resultFingerprint ||
                    assignmentResumeFingerprint(store, reentry.resumeResultId, assignment.target, workId, undefined, inputId) !== reentry.resultFingerprint ||
                    source.raw !== JSON.stringify({ resumeResult: reentry.resumeResultId })) refuse();
            } else {
                if (Object.hasOwn(origin,'resumeResultId') || !direction?.data || direction.revision > target.direction) refuse();
                const admitted = object(direction.data);
                if (admitted.inputId !== inputId || admitted.affectedAssignmentId !== id || admitted.affectedWorkId !== workId) refuse();
            }
        } else if (input.state !== 'QUEUED' || input.mode !== 'idle' || origin.kind !== 'agent-assignment' || origin.event !== id ||
            !sameNativeIdentity(origin.actor, data.source) || target.direction !== data.observedTargetRevision) refuse();
        store.run('UPDATE conversation_inputs SET state=?,work=?,data=? WHERE id=?', 'CONSUMED', workId,
            JSON.stringify({ ...object(input.data), governedWork: workId }), inputId);
        store.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'RUNNING', id);
    });
}

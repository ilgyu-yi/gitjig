import { inspectCapturedInputSource } from './input-context.js';
import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { coordinationBytes, coordinatorReportRequiredFailure, inspectConversationResult, inspectConversationRequestFailure } from './conversation-results.js';
import { sameNativeIdentity } from './native-identity.js';
import { inspectAssignedWorkObligations } from './assigned-work-provenance.js';
import { isWorkSettlementUnconfirmed } from './work-recovery.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (value: unknown) => ['removed', 'not-allocated', 'unbound'].includes(value as string);
const object = (value: unknown, maximum = 1048576): Record<string, any> => {
    if (typeof value !== 'string' || Buffer.byteLength(value) > maximum) throw Error('Bounded WAIT provenance unavailable');
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('WAIT provenance unavailable');
    return parsed;
};
export type OriginalFailedWaitOutcome = { state: 'held' | 'pending' } | {
    state: 'deliverable'; assignmentId: string; resultId: string; conversationId: string; workId: string; outcome: 'UNAVAILABLE';
    historicalDiagnostic?: {observationEpoch: number; currentMetadataEpoch: number; criteriaRefreshSourceId: string; meaning: string};
};

const waitBinding = (state: any) => {
    const data = object(state.data);
    return hash({work: state.work, direction: state.direction, runId: data.runId, sourceIdentity: data.sourceIdentity,
        continuationAuthorized: data.continuationAuthorized, waitHandles: data.waitHandles});
};
function runSet(s: Store, work: string) {
    const rows = s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid LIMIT 1025', work);
    if (!rows.length || rows.length > 1024) throw Error('Original diagnostic run census unavailable');
    return hash(rows);
}
/** Called only inside the final guarded owner refresh transaction, before changing epoch. */
export function captureCriteriaRefreshFailure(s: Store, workId: string, toEpoch: number, toHash: string, fromContractsVersion: string) {
    try {
        const work = s.one('SELECT * FROM works WHERE id=?', workId);
        if (!work || toEpoch !== work.epoch + 1 || !/^[a-f0-9]{64}$/.test(toHash)) return undefined;
        const source = s.one('SELECT origin FROM sources WHERE id=?', work.source), origin = source && object(source.origin);
        if (origin?.kind !== 'agent-governed-assignment' || typeof origin.assignmentId !== 'string') return undefined;
        const assignment = s.one('SELECT * FROM conversation_assignments WHERE id=? AND work=?', origin.assignmentId, workId);
        if (!assignment || originalFailedWaitOutcome(s, assignment.source_conversation, assignment.id).state !== 'deliverable') return undefined;
        const state = s.one('SELECT * FROM conversation_state WHERE conversation=?', assignment.source_conversation);
        const data = object(assignment.data), publication = s.one('SELECT data FROM conversation_results WHERE id=?', data.resultId);
        if (data.result?.epoch !== work.epoch) return undefined; // No implicit chain of historical epoch exceptions.
        const change = s.one('SELECT data FROM change_state WHERE work=?', workId), version = s.one('SELECT work,kind FROM change_versions WHERE id=?', fromContractsVersion);
        if (!state || !publication || !change || object(change.data).contractsVersion !== fromContractsVersion || version?.work !== workId || version.kind !== 'contracts') return undefined;
        return {kind: 'criteria-refresh-failed-wait/v1', assignmentId: assignment.id, parent: assignment.source_conversation,
            resultId: data.resultId, publicationHash: object(publication.data).publicationHash,
            fromEpoch: work.epoch, toEpoch, workId, workSource: work.source, workGeneration: work.generation,
            runSetDigest: runSet(s, workId), waitDigest: waitBinding(state), fromContractsVersion, toHash};
    } catch { return undefined; }
}
function retainedCriteriaFailure(s: Store, work: any, assignment: any, state: any, raw: any, resultId: string) {
    const change = s.one('SELECT data FROM change_state WHERE work=?', work.id), refresh = change && object(change.data).criteriaRefresh;
    if (!refresh) return false;
    const source = s.one('SELECT conversation,origin FROM sources WHERE id=?', refresh.sourceId), origin = source && object(source.origin), proof = origin?.failedWaitDiagnostic;
    const next = s.one('SELECT * FROM change_versions WHERE id=?', refresh.toContractsVersion), before = s.one('SELECT work,kind FROM change_versions WHERE id=?', refresh.fromContractsVersion);
    const publication = s.one('SELECT data FROM conversation_results WHERE id=?', resultId);
    return proof?.kind === 'criteria-refresh-failed-wait/v1' && source.conversation === null && origin.kind === 'owner-criteria-refresh' &&
        Number.isSafeInteger(origin.uid) && origin.uid === process.getuid?.() && origin.work === work.id &&
        proof.workId === work.id && proof.workSource === work.source && proof.workGeneration === work.generation &&
        proof.assignmentId === assignment.id && proof.parent === assignment.source_conversation && proof.resultId === resultId &&
        proof.fromEpoch === raw.epoch && proof.toEpoch === work.epoch && proof.toEpoch === proof.fromEpoch + 1 &&
        proof.fromContractsVersion === refresh.fromContractsVersion && origin.fromContractsVersion === refresh.fromContractsVersion &&
        proof.toHash === origin.toHash && next?.work === work.id && next.kind === 'contracts' && next.hash === proof.toHash &&
        next.predecessor === refresh.fromContractsVersion && before?.work === work.id && before.kind === 'contracts' &&
        object(next.data).refreshSource === refresh.sourceId && object(change.data).contractsVersion === next.id &&
        !!publication && proof.publicationHash === object(publication.data).publicationHash &&
        proof.runSetDigest === runSet(s, work.id) && proof.waitDigest === waitBinding(state);
}

/** Authenticate only the host's missing-report diagnostic, never the hidden human answer.
 * Ordinary v2 publicationHash belongs to the full original outcome, not this projection.
 */
function ordinaryMissingReport(s: Store, assignment: any, a: any, work: any, target: any, state: any, raw: any) {
    if (typeof raw.runId !== 'string' || !raw.runId) return false;
    const run = s.one('SELECT * FROM runs WHERE id=?', raw.runId);
    if (!run || run.work !== work.id || run.epoch !== work.epoch || run.generation !== work.generation ||
        run.generation !== target.generation || object(state.data).runId !== run.id) return false;
    const rd = object(run.data), cp = rd.nativeCheckpoint;
    if (['authorityRecovery', 'reentries'].some(key => Object.hasOwn(a, key))) return false;
    const input = s.one('SELECT * FROM conversation_inputs WHERE id=?', a.inputId);
    if (rd.kind !== 'ordinary-conversation' || rd.conversation !== assignment.target || rd.initialInputId !== a.inputId ||
        !input || input.conversation !== assignment.target || input.work !== work.id || input.source !== work.source ||
        input.generation !== run.generation || input.state !== 'CONSUMED' || object(input.data).assignment !== assignment.id ||
        work.source !== a.instructionsSource || object(work.data).assignmentId !== assignment.id ||
        rd.ordinaryCoordinatorReportRequired !== true || rd.outcome !== 'delivered' || !clean(rd.cleanup) ||
        ['ordinaryReportHash', 'ordinaryReportEntryId', 'ordinaryReportToolResultEntryId'].some(key => Object.hasOwn(rd, key)) ||
        typeof rd.ordinaryAnswerHash !== 'string' || !/^[a-f0-9]{64}$/.test(rd.ordinaryAnswerHash) ||
        typeof rd.ordinaryAnswerEntryId !== 'string' || !rd.ordinaryAnswerEntryId ||
        typeof rd.nativeSessionId !== 'string' || !rd.nativeSessionId || state.native_id !== rd.nativeSessionId ||
        !cp || cp.sessionId !== rd.nativeSessionId || typeof cp.leafId !== 'string' || !cp.leafId ||
        !Number.isSafeInteger(cp.bytes) || cp.bytes < 1 || cp.bytes > 32 * 1024 * 1024 ||
        typeof cp.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(cp.sha256)) return false;
    const expected = {conversationId: assignment.target, workId: work.id, runId: run.id, status: 'unavailable',
        cleanup: rd.cleanup, failure: coordinatorReportRequiredFailure};
    return hash(raw) === hash(expected);
}

/** A host admission refusal has no hidden human/report body to authenticate. */
function ordinaryRequestLimit(s: Store, assignment: any, a: any, work: any, raw: any) {
    if (['authorityRecovery', 'reentries'].some(key => Object.hasOwn(a, key))) return false;
    const view = inspectConversationRequestFailure(s, assignment.target);
    if (!view || view.workId !== work.id || view.runId !== raw.runId || !clean(view.cleanup)) return false;
    const run = s.one('SELECT data FROM runs WHERE id=?', view.runId), rd = run && object(run.data);
    const input = s.one('SELECT * FROM conversation_inputs WHERE id=?', a.inputId), cp = rd?.nativeCheckpoint;
    if (!rd || rd.initialInputId !== a.inputId || rd.ordinaryCoordinatorReportRequired !== true ||
        work.source !== a.instructionsSource || !input || input.source !== work.source || object(input.data).assignment !== assignment.id ||
        ['ordinaryAnswerHash', 'ordinaryAnswerEntryId', 'ordinaryReportHash', 'ordinaryReportEntryId', 'ordinaryReportToolResultEntryId'].some(key => Object.hasOwn(rd, key)) ||
        !cp || cp.sessionId !== rd.nativeSessionId || typeof cp.leafId !== 'string' || !cp.leafId ||
        !Number.isSafeInteger(cp.bytes) || cp.bytes < 1 || cp.bytes > 32 * 1024 * 1024 ||
        typeof cp.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(cp.sha256)) return false;
    return hash(raw) === hash({conversationId: assignment.target, workId: work.id, runId: view.runId,
        status: 'unavailable', cleanup: view.cleanup, ...(view.failure ? {failure: view.failure} : {}), requestLimit: {limit: view.limit}});
}

/** Read only a diagnostic already published for the direct task of this exact accepted WAIT.
 * This neither resolves its dependency nor grants child recovery, retry or successful standing.
 */
export function originalFailedWaitOutcome(s: Store, conversationId: string, assignmentId: string): OriginalFailedWaitOutcome {
    try {
        const parent = s.one('SELECT * FROM conversations WHERE id=?', conversationId), state = s.one('SELECT * FROM conversation_state WHERE conversation=?', conversationId);
        if (!parent || !state || state.resource !== 'WAITING' || state.archived) return { state: 'held' };
        const data = object(state.data), actor = data.sourceIdentity;
        if (!data.continuationAuthorized || !Array.isArray(data.waitHandles) || !data.waitHandles.includes(assignmentId) ||
            !actor || actor.conversationId !== conversationId || actor.workId !== state.work || actor.runId !== data.runId || actor.generation !== parent.generation ||
            actor.directionRevision !== state.direction || data.lifecycle?.deleted) return { state: 'held' };
        const owner = s.one('SELECT * FROM works WHERE id=?', state.work), waitRun = s.one('SELECT * FROM runs WHERE id=?', actor.runId);
        if (!owner || isWorkSettlementUnconfirmed(owner.state) || ['CANCELLED', 'INTERRUPTED'].includes(owner.state) || !waitRun || waitRun.work !== owner.id || waitRun.epoch !== owner.epoch || waitRun.generation !== owner.generation)
            return { state: 'held' };
        const ownerData = object(owner.data), delegation = ownerData.delegation;
        const waitData = object(waitRun.data), initial = typeof actor.initialInputId === 'string' && s.one('SELECT * FROM conversation_inputs WHERE id=?', actor.initialInputId);
        if (actor.launchId !== null || waitData.kind !== 'ordinary-conversation' || waitData.conversation !== conversationId || waitData.initialInputId !== actor.initialInputId ||
            !initial || initial.conversation !== conversationId || initial.work !== owner.id || initial.generation !== actor.generation || initial.state !== 'CONSUMED' ||
            data.contextOrigin || ownerData.contextOrigin || owner.predecessor !== null || owner.lineage !== owner.id || ownerData.kind !== 'ordinary-conversation' ||
            data.nativeInputRecovery || s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED' LIMIT 1", conversationId)) return { state: 'held' };
        if (ownerData.conversation !== conversationId || delegation?.rootWorkId !== owner.id || !Array.isArray(delegation.projectIds)) return { state: 'held' };
        const assignment = s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!assignment || assignment.state !== 'UNAVAILABLE' || assignment.source_conversation !== conversationId || !assignment.work) return { state: 'held' };
        const a = object(assignment.data), work = s.one('SELECT * FROM works WHERE id=?', assignment.work);
        const ordinary = a.operation === 'investigate';
        if ((!ordinary && a.operation !== 'change') || a.contextAssignment || a.contextReentry || a.delegationRoot !== delegation.rootWorkId ||
            !work || isWorkSettlementUnconfirmed(work.state) || ['CANCELLED', 'INTERRUPTED'].includes(work.state) || a.projectId !== work.project || !delegation.projectIds.includes(work.project)) return { state: 'held' };
        const wd = object(work.data), original = s.one('SELECT * FROM sources WHERE id=?', work.source), instruction = s.one('SELECT * FROM sources WHERE id=?', a.instructionsSource);
        if (work.predecessor !== null || work.lineage !== work.id || wd.contextOrigin || wd.contextAssignment || wd.contextFamilyRoot || wd.kind !== (ordinary ? 'ordinary-conversation' : 'governed-change') || wd.conversation !== assignment.target || !original || !instruction ||
            instruction.conversation !== assignment.target || !inspectAssignedWorkObligations(s, work.id).includes(assignmentId)) return { state: 'held' };
        const origin = object(original.origin), requested = object(instruction.origin);
        if ((ordinary ? origin.kind !== 'agent-assignment' || origin.event !== assignmentId :
            origin.kind !== 'agent-governed-assignment' || origin.assignmentId !== assignmentId || origin.conversationId !== assignment.target) ||
            requested.kind !== 'agent-assignment' || requested.event !== assignmentId || !sameNativeIdentity(origin.actor, a.source) || !sameNativeIdentity(requested.actor, a.source)) return { state: 'held' };
        const dependencies = s.all("SELECT target,data FROM conversation_dependencies WHERE assignment=? AND waiting=? AND state='PENDING' LIMIT 1025", assignmentId, conversationId);
        // An accepted WAIT also permits the coordinator's own nonblocking task.
        // Reading its failure must not create a completion dependency. Declared
        // dependencies and any retained edge still need their original proof.
        if (dependencies.length > 1024 || (a.resultDependency !== false || dependencies.length > 0) &&
            !dependencies.some(row => row.target === assignment.target && sameNativeIdentity(object(row.data).source, actor))) return { state: 'held' };
        if (!sameNativeIdentity(a.source, actor)) {
            if (ordinary) return { state: 'held' };
            if (!Array.isArray(a.reentries) || a.reentries.length > 1024 || !a.reentries.some((entry: any) => {
                if (!sameNativeIdentity(entry.actor, actor)) return false;
                const source = s.one('SELECT * FROM sources WHERE id=?', entry.source), input = s.one('SELECT * FROM conversation_inputs WHERE id=?', entry.inputId);
                if (!source || !input) return false;
                const provenance = object(source.origin);
                return source.conversation === assignment.target && input.conversation === assignment.target && input.work === work.id && input.source === source.id &&
                    object(input.data).assignment === assignmentId && provenance.kind === 'agent-governed-reentry' && provenance.assignmentId === assignmentId &&
                    provenance.originalWork === work.id && sameNativeIdentity(provenance.actor, actor);
            })) return { state: 'held' };
        }
        const target = s.one('SELECT * FROM conversations WHERE id=?', assignment.target), targetState = s.one('SELECT * FROM conversation_state WHERE conversation=?', assignment.target);
        if (!target || !targetState || target.project !== work.project || targetState.work !== work.id || targetState.archived || targetState.resource === 'UNKNOWN' || object(targetState.data).lifecycle?.deleted)
            return { state: 'held' };
        const targetData = object(targetState.data);
        if (targetData.contextOrigin || targetData.contextFamilyRoot || targetData.nativeInputRecovery ||
            s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED' LIMIT 1", assignment.target) ||
            ordinary && s.one("SELECT id FROM conversation_inputs WHERE conversation IN (?,?) AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING') LIMIT 1", conversationId, assignment.target) ||
            s.one('SELECT id FROM effect_operations WHERE work=? LIMIT 1', work.id)) return { state: 'held' };
        const raw = a.result;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > coordinationBytes || raw.assignmentHold || raw.workId !== work.id)
            return { state: 'held' };
        if (ordinary ? !(ordinaryMissingReport(s, assignment, a, work, target, targetState, raw) || ordinaryRequestLimit(s, assignment, a, work, raw)) :
            raw.runId || raw.reviewReady !== false || typeof raw.phase !== 'string' || ['REVIEW_READY', 'CANCELLED', 'UNKNOWN'].includes(raw.phase)) return { state: 'held' };
        const expected = 'result-' + hash([assignment.target, ordinary ? ['ordinary-run', raw.runId] : ['structured', assignmentId, raw]]);
        let historicalDiagnostic: Extract<OriginalFailedWaitOutcome, {state: 'deliverable'}>['historicalDiagnostic'];
        if (!ordinary && raw.epoch !== work.epoch) {
            if (!retainedCriteriaFailure(s, work, assignment, state, raw, expected)) return { state: 'held' };
            historicalDiagnostic = {observationEpoch: raw.epoch, currentMetadataEpoch: work.epoch,
                criteriaRefreshSourceId: object(s.one('SELECT data FROM change_state WHERE work=?', work.id).data).criteriaRefresh.sourceId,
                meaning: 'Previously settled failure retained across owner workflow-rule adoption. No current-epoch execution, successful standing or task retry is granted by this historical observation alone.'};
        }
        if (a.resultId !== expected || s.one("SELECT id FROM conversation_results WHERE conversation=? AND json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1", assignment.target, assignmentId)?.id !== expected)
            return { state: 'held' };
        const storedPublication = s.one('SELECT id,conversation,work FROM conversation_results WHERE id=?', expected);
        if (!storedPublication || storedPublication.id !== expected || storedPublication.conversation !== assignment.target || storedPublication.work !== work.id) return { state: 'held' };
        const publication = inspectConversationResult(s, expected, { identity: actor, delegation });
        if (publication.assignmentId !== assignmentId || publication.conversationId !== assignment.target || publication.workId !== work.id || publication.projectId !== work.project ||
            hash(publication.result) !== hash(raw) || (ordinary ? publication.version !== 2 ||
                typeof publication.publicationHash !== 'string' || !/^[a-f0-9]{64}$/.test(publication.publicationHash) : publication.publicationHash !== hash(raw))) return { state: 'held' };
        let pending = !['IDLE', 'WAITING'].includes(targetState.resource);
        const runs = s.all('SELECT phase,reservation,data FROM runs WHERE work=? LIMIT 1025', work.id);
        if (!runs.length || runs.length > 1024) return { state: 'held' };
        for (const run of [waitRun, ...runs]) {
            const rd = object(run.data);
            if (['UNKNOWN', 'INTERRUPTED'].includes(run.phase) || rd.cleanup && !clean(rd.cleanup)) return { state: 'held' };
            if (run.phase !== 'SETTLED' || run.reservation === 'reserved') pending = true;
            else if (!clean(rd.cleanup) || run.reservation !== 'consumed') return { state: 'held' };
        }
        if (waitRun.phase === 'SETTLED' && object(waitRun.data).outcome !== 'waiting') return { state: 'held' };
        const launches = s.all('SELECT status,data FROM role_launches WHERE work=? LIMIT 1025', work.id);
        if (launches.length > 1024) return { state: 'held' };
        for (const launch of launches) {
            const metadata = object(launch.data);
            if (metadata.cleanup && !clean(metadata.cleanup)) return { state: 'held' };
            if (['RUNNING', 'STARTING', 'QUEUED'].includes(launch.status)) pending = true;
            else if (!clean(metadata.cleanup)) return { state: 'held' };
        }
        const capacity = s.all('SELECT state FROM capacity_leases WHERE work=? LIMIT 1025', work.id);
        if (capacity.length > 1024 || capacity.some(row => !['QUEUED', 'ADMITTED', 'SETTLING', 'RELEASED', 'CANCELLED'].includes(row.state))) return { state: 'held' };
        if (capacity.some(row => ['QUEUED', 'ADMITTED', 'SETTLING'].includes(row.state))) pending = true;
        const budgets = s.all('SELECT reserved FROM budgets WHERE lineage=?', work.lineage);
        if (budgets.some(row => !Number.isSafeInteger(row.reserved) || row.reserved < 0)) return { state: 'held' };
        if (budgets.some(row => row.reserved > 0)) pending = true;
        return pending ? { state: 'pending' } : { state: 'deliverable', assignmentId, resultId: expected, conversationId: assignment.target, workId: work.id, outcome: 'UNAVAILABLE',
            ...(historicalDiagnostic ? {historicalDiagnostic} : {}) };
    }
    catch { return { state: 'held' }; }
}

export interface OrdinaryWaitDiagnosticFence {
    kind: 'ordinary-missing-report-wait/v1' | 'ordinary-failed-wait/v2';
    assignmentIds: string[];
    requestLimitAssignmentIds?: string[];
    digest: string;
}
/** Pure metadata custody across enqueue/cleanup/history awaits. Opaque stored bytes
 * are hashed, never interpreted as human answer or English coordinator report.
 */
export function ordinaryWaitDiagnosticDigest(s: Store, conversation: string, actor: any, ids: string[], ownInput?: string, requestLimitIds?: readonly string[]) {
    if (!actor || actor.conversationId !== conversation || !Array.isArray(ids) || !ids.length || ids.length > 64 ||
        ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw Error('Original diagnostic fence scope unavailable');
    let bytes = 0;
    const bounded = (value: unknown) => {
        bytes += Buffer.byteLength(JSON.stringify(value));
        if (bytes > 16 * 1024 * 1024) throw Error('Original diagnostic fence exceeds metadata bound');
        return value;
    };
    const rows = (sql: string, ...args: string[]) => {
        const result = s.all(sql + ' LIMIT 1025', ...args);
        if (result.length > 1024) throw Error('Original diagnostic fence census unavailable');
        return bounded(result);
    };
    const owner = s.one('SELECT * FROM works WHERE id=?', actor.workId), input = s.one('SELECT * FROM conversation_inputs WHERE id=?', actor.initialInputId);
    if (!owner || !input) throw Error('Original diagnostic owner unavailable');
    const root = bounded([actor, owner, input, s.one('SELECT * FROM sources WHERE id=?', input.source),
        s.one('SELECT * FROM runs WHERE id=?', actor.runId), s.one('SELECT id,project,generation FROM conversations WHERE id=?', conversation)]);
    const pending = rows("SELECT * FROM conversation_inputs WHERE conversation=? AND id<>? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') ORDER BY rowid", conversation, ownInput ?? '');
    const children = ids.map(id => {
        const a = s.one('SELECT * FROM conversation_assignments WHERE id=?', id), data = a && object(a.data);
        if (!a || a.source_conversation !== conversation || data?.operation !== 'investigate' || !sameNativeIdentity(data.source, actor))
            throw Error('Original diagnostic assignment scope changed');
        const w = s.one('SELECT * FROM works WHERE id=?', a.work);
        if (!w) throw Error('Original diagnostic work unavailable');
        const fixed = bounded([a, w, s.one('SELECT * FROM sources WHERE id=?', w.source), s.one('SELECT * FROM sources WHERE id=?', data.instructionsSource),
            s.one('SELECT * FROM conversations WHERE id=?', a.target), s.one('SELECT conversation,native_id,work,direction,resource,archived,data FROM conversation_state WHERE conversation=?', a.target),
            s.one('SELECT * FROM conversation_results WHERE id=?', data.resultId)]);
        return [fixed,
            rows('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid', a.target),
            rows("SELECT * FROM conversation_results WHERE conversation=? AND json_extract(data,'$.assignmentId')=? ORDER BY rowid", a.target, id),
            rows('SELECT * FROM runs WHERE work=? ORDER BY rowid', w.id), rows('SELECT * FROM role_launches WHERE work=? ORDER BY rowid', w.id),
            rows('SELECT * FROM capacity_leases WHERE work=? ORDER BY rowid', w.id), rows('SELECT * FROM budgets WHERE lineage=? ORDER BY rowid', w.lineage),
            rows('SELECT * FROM conversation_dependencies WHERE assignment=? ORDER BY rowid', id), rows('SELECT * FROM effect_operations WHERE work=? ORDER BY rowid', w.id)];
    });
    if (requestLimitIds === undefined) return hash([root, pending, children]); // Preserve the legacy receipt recipe exactly.
    if (!requestLimitIds.length || requestLimitIds.length > ids.length || new Set(requestLimitIds).size !== requestLimitIds.length ||
        requestLimitIds.some(id => !ids.includes(id))) throw Error('Original request-limit diagnostic roster unavailable');
    const capEvidence = ids.map(id => {
        const assignment = s.one('SELECT target,data FROM conversation_assignments WHERE id=?', id), data = object(assignment.data);
        if (!requestLimitIds.includes(id)) {
            if (data.result?.requestLimit !== undefined) throw Error('Original diagnostic family changed');
            return [id, 'missing-report'];
        }
        const view = inspectConversationRequestFailure(s, assignment.target);
        if (!view || view.runId !== data.result?.runId || view.limit !== data.result?.requestLimit?.limit)
            throw Error('Original request-limit diagnostic changed');
        const markers = rows("SELECT * FROM observations WHERE run=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='ordinary-request-limit' ELSE 0 END ORDER BY rowid", view.runId);
        if (!Array.isArray(markers) || markers.length !== 1) throw Error('Original request-limit observation census changed');
        const {relatedWorkIds: _links, relatedWorkIncomplete: _incomplete, ...original} = view;
        return bounded([id, 'request-limit', original, markers]);
    });
    return hash([root, pending, children, capEvidence]);
}
export function ordinaryWaitDiagnosticInputDigest(s: Store, inputId: string, normalize?: {admittedGeneration?: number; supersedingRevision?: number}) {
    const input = s.one('SELECT * FROM conversation_inputs WHERE id=?', inputId);
    if (!input) throw Error('Original diagnostic input unavailable');
    const directions = s.all('SELECT * FROM conversation_directions WHERE conversation=? AND source=? ORDER BY revision LIMIT 2', input.conversation, input.source);
    if (directions.length !== 1) throw Error('Original diagnostic direction unavailable');
    let original = normalize?.admittedGeneration === undefined ? input : {...input, generation: normalize.admittedGeneration, state: 'QUEUED'};
    if (normalize?.supersedingRevision !== undefined) {
        const data = object(input.data);
        if (input.state !== 'CONFLICTED' || data.reason !== 'New direct owner direction supersedes unconsumed parent input' || data.newRevision !== normalize.supersedingRevision)
            throw Error('Original diagnostic owner supersession unavailable');
        delete data.reason;
        delete data.newRevision;
        original = {...input, state: 'QUEUED', data: JSON.stringify(data)};
    }
    return hash([original, s.one('SELECT * FROM sources WHERE id=?', input.source), directions[0]]);
}
/** Reused on fresh resolution, stale queued receipt retries and inside reservation. */
export function assertOrdinaryWaitDiagnosticCurrent(s: Store, conversation: string, selectedInputId?: string) {
    const state = s.one('SELECT * FROM conversation_state WHERE conversation=?', conversation), data = state && object(state.data), receipt = data?.explicitContinuation;
    if (!receipt || !Object.hasOwn(receipt, 'ordinaryDiagnosticFence')) return;
    const fence = receipt.ordinaryDiagnosticFence as OrdinaryWaitDiagnosticFence;
    if (!['ordinary-missing-report-wait/v1', 'ordinary-failed-wait/v2'].includes(fence?.kind) ||
        (fence.kind === 'ordinary-failed-wait/v2' ? !Array.isArray(fence.assignmentIds) || !Array.isArray(fence.requestLimitAssignmentIds) ||
            !fence.requestLimitAssignmentIds.length || fence.requestLimitAssignmentIds.length > 64 ||
            new Set(fence.requestLimitAssignmentIds).size !== fence.requestLimitAssignmentIds.length ||
            fence.requestLimitAssignmentIds.some(id => typeof id !== 'string' || !fence.assignmentIds.includes(id)) : fence.requestLimitAssignmentIds !== undefined) ||
        typeof fence.digest !== 'string' || !/^[a-f0-9]{64}$/.test(fence.digest) ||
        typeof receipt.ordinaryDiagnosticInputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.ordinaryDiagnosticInputDigest)) throw Error('Original diagnostic receipt unavailable');
    const input = s.one('SELECT * FROM conversation_inputs WHERE id=?', receipt.inputId), actor = receipt.sourceIdentity;
    if (!input || input.conversation !== conversation || input.source !== receipt.sourceId || input.work !== actor?.workId)
        throw Error('Original diagnostic input binding changed');
    if (receipt.newRunId !== undefined) {
        const run = s.one('SELECT * FROM runs WHERE id=?', receipt.newRunId), rd = run && object(run.data);
        const original = s.one('SELECT * FROM runs WHERE id=?', receipt.runId), previous = original && object(original.data);
        if (original?.id === actor.runId && original.work === actor.workId && original.phase === 'SETTLED' && original.reservation === 'consumed' &&
            previous.kind === 'ordinary-conversation' && previous.conversation === conversation && previous.initialInputId === actor.initialInputId && previous.outcome === 'waiting' && clean(previous.cleanup) &&
            run?.work === actor.workId && run.epoch === original.epoch && run.generation === original.generation + 1 &&
            rd.kind === 'ordinary-conversation' && rd.conversation === conversation && rd.initialInputId === input.id &&
            input.state === 'CONSUMED' && input.generation === actor.generation + 1 && run.phase === 'SETTLED' && run.reservation === 'consumed' && clean(rd.cleanup) &&
            ordinaryWaitDiagnosticInputDigest(s, input.id, {admittedGeneration: actor.generation}) === receipt.ordinaryDiagnosticInputDigest) return;
        throw Error('Original diagnostic reservation correspondence unavailable');
    }
    if (input.state === 'CONFLICTED' && selectedInputId && selectedInputId !== input.id && state.resource === 'IDLE' && !state.archived &&
        !data.lifecycle?.deleted && state.direction > receipt.directionRevision) {
        const conflict = object(input.data), revision = conflict.newRevision;
        if (!Number.isSafeInteger(revision) || revision <= receipt.directionRevision || revision > state.direction)
            throw Error('Original diagnostic supersession revision unavailable');
        const firstDirection = s.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?', conversation, revision),
            firstData = firstDirection && object(firstDirection.data), firstInput = firstData && s.one('SELECT * FROM conversation_inputs WHERE id=?', firstData.inputId),
            firstSource = firstInput && s.one('SELECT * FROM sources WHERE id=?', firstInput.source), firstOrigin = firstSource && object(firstSource.origin);
        if (!firstInput || firstInput.conversation !== conversation || firstInput.source !== firstDirection.source || firstSource?.conversation !== conversation ||
            firstData.affectedWorkId !== actor.workId || firstData.affectedRunId !== actor.runId || firstData.affectedGeneration !== actor.generation ||
            firstOrigin?.kind !== 'owner-conversation-input' || !Number.isSafeInteger(firstOrigin.uid) || firstOrigin.uid !== process.getuid?.() ||
            ordinaryWaitDiagnosticInputDigest(s, input.id, {supersedingRevision: revision}) !== receipt.ordinaryDiagnosticInputDigest)
            throw Error('Original diagnostic owner supersession event changed');
        const owner = s.one('SELECT * FROM conversation_inputs WHERE id=?', selectedInputId),
            source = owner && s.one('SELECT * FROM sources WHERE id=?', owner.source), origin = source && object(source.origin),
            directions = owner ? s.all('SELECT * FROM conversation_directions WHERE conversation=? AND source=? ORDER BY revision LIMIT 2', conversation, owner.source) : [],
            direction = directions[0], current = s.one('SELECT generation FROM conversations WHERE id=?', conversation);
        if (owner?.conversation === conversation && owner.work === state.work && owner.generation === current?.generation && owner.state === 'QUEUED' &&
            directions.length === 1 && direction.revision >= revision && direction.revision <= state.direction && object(direction.data).inputId === owner.id &&
            source?.conversation === conversation && origin?.kind === 'owner-conversation-input' && Number.isSafeInteger(origin.uid) && origin.uid === process.getuid?.()) {
            const captured = inspectCapturedInputSource(s, owner.id);
            if (captured.value || source.raw === owner.text) return;
        }
        throw Error('Original diagnostic supersession requires the selected current owner input');
    }
    if (selectedInputId !== receipt.inputId || state.resource !== 'IDLE' || state.archived || state.work !== actor?.workId || data.lifecycle?.deleted ||
        state.direction !== receipt.directionRevision || receipt.directionRevision !== actor.directionRevision + 1 || input.generation !== actor.generation || input.state !== 'QUEUED' ||
        ordinaryWaitDiagnosticInputDigest(s, input.id) !== receipt.ordinaryDiagnosticInputDigest ||
        ordinaryWaitDiagnosticDigest(s, conversation, actor, fence.assignmentIds, input.id, fence.requestLimitAssignmentIds) !== fence.digest)
        throw Error('Original diagnostic source or child evidence changed before reservation');
}

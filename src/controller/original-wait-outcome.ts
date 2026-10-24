import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { coordinationBytes, inspectConversationResult } from './conversation-results.js';
import { sameNativeIdentity } from './native-identity.js';
import { inspectAssignedWorkObligations } from './assigned-work-provenance.js';

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
        if (!owner || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(owner.state) || !waitRun || waitRun.work !== owner.id || waitRun.epoch !== owner.epoch || waitRun.generation !== owner.generation)
            return { state: 'held' };
        const ownerData = object(owner.data), delegation = ownerData.delegation;
        const waitData = object(waitRun.data), initial = typeof actor.initialInputId === 'string' && s.one('SELECT * FROM conversation_inputs WHERE id=?', actor.initialInputId);
        if (actor.launchId !== null || waitData.kind !== 'ordinary-conversation' || waitData.conversation !== conversationId || waitData.initialInputId !== actor.initialInputId ||
            !initial || initial.conversation !== conversationId || initial.work !== owner.id || initial.generation !== actor.generation || initial.state !== 'CONSUMED' ||
            data.contextOrigin || ownerData.contextOrigin || owner.predecessor !== null || owner.lineage !== owner.id || ownerData.kind !== 'ordinary-conversation' ||
            data.nativeInputRecovery || s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED' LIMIT 1", conversationId)) return { state: 'held' };
        if (ownerData.conversation !== conversationId || delegation?.rootWorkId !== owner.id || !Array.isArray(delegation.projectIds) ||
            !s.one("SELECT id FROM works WHERE id=? AND state NOT IN ('CANCELLED','UNKNOWN','INTERRUPTED')", delegation.rootWorkId)) return { state: 'held' };
        const assignment = s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!assignment || assignment.state !== 'UNAVAILABLE' || assignment.source_conversation !== conversationId || !assignment.work) return { state: 'held' };
        const a = object(assignment.data), work = s.one('SELECT * FROM works WHERE id=?', assignment.work);
        if (a.operation !== 'change' || a.contextAssignment || a.contextReentry || a.delegationRoot !== delegation.rootWorkId ||
            !work || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state) || a.projectId !== work.project || !delegation.projectIds.includes(work.project)) return { state: 'held' };
        const wd = object(work.data), original = s.one('SELECT * FROM sources WHERE id=?', work.source), instruction = s.one('SELECT * FROM sources WHERE id=?', a.instructionsSource);
        if (work.predecessor !== null || work.lineage !== work.id || wd.contextOrigin || wd.contextAssignment || wd.contextFamilyRoot || wd.kind !== 'governed-change' || wd.conversation !== assignment.target || !original || !instruction ||
            instruction.conversation !== assignment.target || !inspectAssignedWorkObligations(s, work.id).includes(assignmentId)) return { state: 'held' };
        const origin = object(original.origin), requested = object(instruction.origin);
        if (origin.kind !== 'agent-governed-assignment' || origin.assignmentId !== assignmentId || origin.conversationId !== assignment.target ||
            requested.kind !== 'agent-assignment' || requested.event !== assignmentId || !sameNativeIdentity(origin.actor, a.source) || !sameNativeIdentity(requested.actor, a.source)) return { state: 'held' };
        const dependencies = s.all("SELECT data FROM conversation_dependencies WHERE assignment=? AND waiting=? AND target=? AND state='PENDING' LIMIT 1025", assignmentId, conversationId, assignment.target);
        if (dependencies.length > 1024 || !dependencies.some(row => sameNativeIdentity(object(row.data).source, actor))) return { state: 'held' };
        if (!sameNativeIdentity(a.source, actor)) {
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
            s.one('SELECT id FROM effect_operations WHERE work=? LIMIT 1', work.id)) return { state: 'held' };
        const raw = a.result;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > coordinationBytes || raw.runId || raw.assignmentHold ||
            raw.workId !== work.id || raw.reviewReady !== false || typeof raw.phase !== 'string' || ['REVIEW_READY', 'CANCELLED', 'UNKNOWN'].includes(raw.phase)) return { state: 'held' };
        const expected = 'result-' + hash([assignment.target, ['structured', assignmentId, raw]]);
        let historicalDiagnostic: Extract<OriginalFailedWaitOutcome, {state: 'deliverable'}>['historicalDiagnostic'];
        if (raw.epoch !== work.epoch) {
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
            publication.publicationHash !== hash(raw) || hash(publication.result) !== hash(raw)) return { state: 'held' };
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

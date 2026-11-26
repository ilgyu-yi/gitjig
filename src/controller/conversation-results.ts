import { originalGovernedAssignment } from './assignment-recovery-history.js';
import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { ConversationTurnResult, NativeIdentity } from './interaction-types.js';
import { captureOrdinaryRoleBinding } from './application-model.js';
import type { Delegation } from './coordination.js';
import { coordinatorReportCurrent } from './coordinator-report.js';
import { readGovernedDetail } from './governed-result.js';
import { projectProtection } from './protection.js';
import { inspectCapturedInputSource } from './input-context.js';
import { parseUniqueJson } from '../workflow/json.js';
import { unsupportedProjectLinkEntry } from './capture-links.js';
import { MissingDockerContextError, missingDockerContextRoute } from '../execution/create-rejection.js';
import { roleRequestLimit } from '../workflow/execution-bounds.js';
import { rolePresentationStage } from './interaction-types.js';
import type { RoleRequestLimitView } from './change-types.js';
import { providerUsageLimitRole, validProviderReset } from '../workflow/provider-failure.js';
import { inspectConversationWait, settledConversationWaitActor, type WaitContinuationFailure } from './conversation-progress.js';
import { workCleanupUnconfirmed } from './work-recovery.js';
import { sameNativeIdentity } from './native-identity.js';
import { currentAssignmentResultId } from './assignment-result-attempt.js';
import type { Role } from '../workflow/types.js';
export const coordinationBytes = 128 * 1024;
export const coordinatorReportRequiredFailure = 'COORDINATOR_REPORT_REQUIRED: submit an English conversation_report before the final human reply';
const nativeProfileMismatchReasons = ['plugins', 'tools', 'MCP-servers', 'duplicate-init'] as const;
export function nativeBridgeProfileMismatch(message: unknown) {
    return nativeProfileMismatchReasons.find(reason => message === 'BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: ' + reason);
}
const parse = (s: string) => JSON.parse(s);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type ConversationNotice = {
    kind: 'result-ready' | 'parent-changed' | 'owner-direction-changed';
    eventKey: string;
    conversationId: string;
    [key: string]: unknown;
};
export const coordinationNoticeType = 'gitjig.coordination-notice';

export function coordinationNoticeContent(id: string, stored: ConversationNotice) {
    const { delivery: _delivery, ...original } = stored;
    return JSON.stringify({ noticeId: id, ...original });
}

export function inspectCoordinationNoticePresentation(s: Store, recipient: string, details: unknown, content: unknown) {
    if (!details || typeof details !== 'object' || typeof content !== 'string' || Buffer.byteLength(content) > coordinationBytes)
        return;
    const { noticeId, eventKey } = details as Record<string, unknown>;
    if (typeof noticeId !== 'string' || !/^notice-[0-9a-f]{64}$/u.test(noticeId) || typeof eventKey !== 'string')
        return;
    const row = s.one(`SELECT data FROM conversation_notifications WHERE id=? AND target=? AND
        length(CAST(data AS BLOB))<=262144 AND json_valid(data)`, noticeId, recipient);
    if (!row) return;
    const stored = parse(row.data) as ConversationNotice | null;
    if (stored?.eventKey !== eventKey || !['result-ready', 'parent-changed', 'owner-direction-changed'].includes(stored.kind) ||
        coordinationNoticeContent(noticeId, stored) !== content)
        return;
    return { id: noticeId, kind: stored.kind };
}
export interface AnswerObservation {
    kind: 'ordinary-answer/v1';
    state: 'delivered' | 'unavailable';
    code?: string;
    producer: {
        runId: string;
        generation: number;
        inputId: string;
        sessionId: string;
        nativeEntryId: string;
        checkpoint: {
            sessionId: string;
            leafId: string;
            bytes: number;
            sha256: string;
        };
    };
    text?: readonly {
        type: 'text';
        text: string;
    }[];
    textSha256?: string;
}
export interface CoordinatorReportObservation {
    kind: 'ordinary-coordinator-report/v1';
    state: 'delivered' | 'unavailable';
    code?: string;
    producer: AnswerObservation['producer'] & {
        toolCallId: string;
        toolResultEntryId: string;
        inputEntryId: string;
        directionRevision: number;
    };
    text?: readonly {
        type: 'text';
        text: string;
    }[];
    textSha256?: string;
}
interface Audience {
    conversationId: string;
    rootWorkId: string;
    projectId: string | null;
}
/** Must be called in the committing caller's transaction. Delivery is a later, readonly-context action. */
export function writeNotice(s: Store, target: string, notice: ConversationNotice) {
    if (!s.one('SELECT id FROM conversations WHERE id=?', target))
        throw Error('Notice target unavailable');
    const id = 'notice-' + hash([target, notice.eventKey]);
    const old = s.one('SELECT target,data FROM conversation_notifications WHERE id=?', id);
    if (old) {
        const { delivery: _delivery, ...immutable } = parse(old.data);
        if (old.target !== target || hash(immutable) !== hash(notice))
            throw Error('Conflicting notice publication');
    }
    else
        s.run('INSERT INTO conversation_notifications VALUES(?,?,?,?)', id, target, 'PENDING', JSON.stringify(notice));
    return id;
}
export function relevantCoordinators(s: Store, cid: string, assignmentId?: string | null) {
    const assignments = assignmentId ? s.all('SELECT * FROM conversation_assignments WHERE id=? AND target=?', assignmentId, cid) : s.all("SELECT * FROM conversation_assignments WHERE target=? AND state IN ('QUEUED','RUNNING','WAITING')", cid);
    return [...new Set<string>([
            s.one('SELECT parent FROM conversation_relations WHERE child=?', cid)?.parent, ...assignments.map(a => a.source_conversation), ...assignments.flatMap(a => s.all('SELECT waiting FROM conversation_dependencies WHERE assignment=?', a.id).map(d => d.waiting))
        ].filter(Boolean))];
}
function captureAudience(s: Store, cid: string, project: string | null): Audience | null {
    const state = s.one('SELECT work FROM conversation_state WHERE conversation=?', cid), work = state?.work ? s.one('SELECT * FROM works WHERE id=?', state.work) : null;
    if (!work || ['CANCELLED', 'UNKNOWN'].includes(work.state))
        return null;
    const delegation = parse(work.data).delegation as Delegation | undefined;
    if (!delegation || !delegation.rootWorkId || !s.one("SELECT id FROM works WHERE id=? AND state NOT IN ('CANCELLED','UNKNOWN')", delegation.rootWorkId) || project !== null && !delegation.projectIds.includes(project))
        return null;
    return { conversationId: cid, rootWorkId: delegation.rootWorkId, projectId: project };
}
/** Called inside the existing settlement transaction; no model assertion can select this answer. */
export function publishConversationResult(s: Store, cid: string, assignmentId: string | null, result: unknown) {
    const outcome = result as {
        runId?: string;
        status?: string;
        answer?: AnswerObservation;
        coordinatorReport?: CoordinatorReportObservation;
    };
    const workId = s.one('SELECT work FROM conversation_state WHERE conversation=?', cid)?.work;
    const work = workId ? s.one('SELECT * FROM works WHERE id=?', workId) : null;
    const project = work?.project ?? null;
    const run = s.one('SELECT * FROM runs WHERE id=?', outcome.runId ?? ''), rd = run ? parse(run.data) : null;
    if (outcome.answer?.state === 'delivered') {
        if (!run || run.work !== workId || run.phase !== 'SETTLED' || !['removed', 'not-allocated', 'unbound'].includes(rd.cleanup) || rd.nativeSessionId !== outcome.answer.producer.sessionId || rd.ordinaryAnswerEntryId !== outcome.answer.producer.nativeEntryId || rd.ordinaryAnswerHash !== hash(outcome.answer) || outcome.answer.producer.runId !== run.id)
            throw Error('Delivered answer lacks exact settled producer');
    }
    if (outcome.coordinatorReport?.state === 'delivered') {
        const report = outcome.coordinatorReport;
        if (!run || run.work !== workId || run.phase !== 'SETTLED' || rd.outcome !== 'delivered' || outcome.status !== 'delivered' || !['removed', 'not-allocated', 'unbound'].includes(rd.cleanup) || rd.nativeSessionId !== report.producer.sessionId || rd.ordinaryReportEntryId !== report.producer.nativeEntryId || rd.ordinaryReportHash !== hash(report) || rd.ordinaryReportToolResultEntryId !== report.producer.toolResultEntryId || report.producer.runId !== run.id)
            throw Error('Coordinator report lacks exact settled producer');
    }
    const reportRequired = !!assignmentId && rd?.ordinaryCoordinatorReportRequired === true;
    let publication: unknown = result;
    if (reportRequired) {
        // Human prose remains in its original native history/run result, never in this coordinator projection.
        const { answer: _human, coordinatorReport: captured, ...metadata } = result as import('./interaction-types.js').ConversationTurnResult;
        const report = captured?.state === 'delivered' && !coordinatorReportCurrent(s, cid, captured) ? { kind: captured.kind, state: 'unavailable' as const, code: 'COORDINATOR_REPORT_STALE', producer: captured.producer } : captured;
        publication = {
            ...metadata, status: metadata.status === 'delivered' && report?.state === 'delivered' ? 'delivered' : 'unavailable', ...(report ? { coordinatorReport: report } : {}), ...(!report && (metadata.status === 'delivered' || !metadata.failure) ? { failure: coordinatorReportRequiredFailure } : {})
        };
    }
    const identity = outcome.runId ? ['ordinary-run', outcome.runId] : ['structured', assignmentId, result];
    const id = 'result-' + hash([cid, identity]);
    const recipients = relevantCoordinators(s, cid, assignmentId);
    const audience = [...new Set([cid, ...recipients])].map(target => captureAudience(s, target, project)).filter((a): a is Audience => !!a);
    const data: any = { version: reportRequired ? 2 : 1, assignmentId, projectId: project, result: publication, audience, publicationHash: hash(result) };
    const source = assignmentId ? s.one('SELECT source_conversation FROM conversation_assignments WHERE id=? AND target=?', assignmentId, cid) : null;
    if (assignmentId && (!source || !audience.some(a => a.conversationId === source.source_conversation))) {
        if (reportRequired)
            data.result = {
                ...(publication as object), status: 'unavailable', ...(outcome.coordinatorReport ? { coordinatorReport: { ...outcome.coordinatorReport, state: 'unavailable', code: 'RESULT_AUDIENCE_UNAVAILABLE', text: undefined, textSha256: undefined } } : {})
            };
        else if (outcome.answer)
            data.result = {
                ...outcome, status: 'unavailable', answer: { kind: 'ordinary-answer/v1', state: 'unavailable', code: 'RESULT_AUDIENCE_UNAVAILABLE', producer: outcome.answer.producer }
            };
    }
    const prior = s.one('SELECT * FROM conversation_results WHERE id=?', id);
    if (prior) {
        const before = parse(prior.data);
        // Audience reflects the immutable first publication, not today's graph.
        if (prior.conversation !== cid || prior.work !== workId || before.publicationHash !== hash(result) || before.assignmentId !== assignmentId)
            throw Error('Conflicting result publication');
        return id;
    }
    const previous = s.one('SELECT id FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1', cid)?.id ?? null;
    const view = { resultId: id, conversationId: cid, workId, previous, ...data };
    if (Buffer.byteLength(JSON.stringify(view)) > coordinationBytes) {
        if (reportRequired) {
            data.result = {
                conversationId: cid, workId, runId: outcome.runId, status: 'unavailable', cleanup: rd?.cleanup, failure: 'COORDINATOR_REPORT_TOTAL_BOUND'
            };
        }
        else {
            if (!outcome.answer)
                throw Error('Structured result exceeds bounded coordination output');
            data.result = {
                ...outcome, status: 'unavailable', answer: { kind: 'ordinary-answer/v1', state: 'unavailable', code: 'ANSWER_TOTAL_BOUND', producer: outcome.answer.producer }
            };
        }
    }
    if (Buffer.byteLength(JSON.stringify({ ...view, ...data })) > coordinationBytes)
        throw Error('Result provenance exceeds bounded coordination output');
    s.run('INSERT INTO conversation_results VALUES(?,?,?,?,?)', id, cid, workId, previous, JSON.stringify(data));
    const currentParent = s.one('SELECT parent FROM conversation_relations WHERE child=?', cid)?.parent;
    // Result-ID metadata is not a content grant. A same-project owner-bound idle
    // coordinator is informed, while the immutable reader still requires audience.
    const metadataRecipients = recipients.filter(target => audience.some(a => a.conversationId === target) || target === currentParent && project !== null && s.one('SELECT project FROM conversations WHERE id=?', target)?.project === project);
    for (const target of metadataRecipients)
        writeNotice(s, target, { kind: 'result-ready', eventKey: id, conversationId: cid, resultId: id, assignmentId });
    return id;
}
type PublicationRow = { id: string; conversation: string; work: string | null; previous: string | null; data: string };
type PublicationReader = {
    identity: NativeIdentity;
    delegation: Delegation;
};
function publicationView(s: Store, row: PublicationRow, data: ReturnType<typeof parse>, reader?: PublicationReader) {
    if (reader) {
        const { identity, delegation } = reader;
        if (!Array.isArray(data.audience) || !data.audience.some((a: Audience) => a.conversationId === identity.conversationId && a.rootWorkId === delegation.rootWorkId && a.projectId === data.projectId))
            throw Error('Result unavailable or outside captured scope');
        if (!s.one("SELECT id FROM works WHERE id=? AND state NOT IN ('CANCELLED','UNKNOWN')", delegation.rootWorkId) || data.projectId !== null && !delegation.projectIds.includes(data.projectId))
            throw Error('Result unavailable or outside captured scope');
        const producerWork = row.work ? s.one('SELECT project FROM works WHERE id=?', row.work) : null;
        if (!producerWork || producerWork.project !== data.projectId)
            throw Error('Result producer binding unavailable');
    }
    const view = { resultId: row.id, conversationId: row.conversation, workId: row.work, previous: row.previous, ...data };
    if (Buffer.byteLength(JSON.stringify(view)) > coordinationBytes)
        throw Error('Result exceeds bounded coordination output');
    return view;
}
export function inspectConversationResult(s: Store, resultId: string, reader?: PublicationReader) {
    const row = s.one('SELECT * FROM conversation_results WHERE id=?', resultId);
    if (!row)
        throw Error('Result unavailable or outside captured scope');
    return publicationView(s, row, parse(row.data), reader);
}

function boundedPublication(s: Store, assignment: { target: string; work: string | null }, resultId: string): PublicationRow | undefined {
    const row = s.one(`SELECT id,conversation,work,previous,CASE WHEN length(CAST(data AS BLOB))<=? THEN data END AS data
        FROM conversation_results WHERE id=?`, coordinationBytes, resultId);
    if (row?.data && row.conversation === assignment.target && row.work === assignment.work)
        return row;
}
function recordedAssignmentResult(publication: ReturnType<typeof publicationView>,
    assignment: { id: string; target: string; work: string | null }, resultId: string) {
    const snapshot = publication.result;
    if (publication.resultId !== resultId || publication.assignmentId !== assignment.id || publication.conversationId !== assignment.target ||
        publication.workId !== assignment.work || !snapshot || snapshot.kind !== 'governed-work-observation/v1' || snapshot.workId !== assignment.work ||
        !Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 1 || typeof snapshot.phase !== 'string' || typeof snapshot.reviewReady !== 'boolean' ||
        !/^[a-f0-9]{64}$/.test(publication.publicationHash) ||
        !['versions', 'launches', 'checks', 'occurrences', 'dispositions'].every(key => Number.isSafeInteger(snapshot.counts?.[key]) && snapshot.counts[key] >= 0))
        return;
    const payload = JSON.stringify(snapshot);
    if (Buffer.byteLength(payload) > 8 * 1024 || createHash('sha256').update(payload).digest('hex') !== publication.publicationHash)
        return;
    return { state: 'available' as const, assignmentId: assignment.id, resultId, publicationHash: publication.publicationHash, snapshot };
}

/** Optional recorded facts for one named status read, never current standing. */
export function inspectAssignmentResultMetadata(s: Store, assignment: { id: string; target: string; work: string | null }, resultId: unknown,
    reader: PublicationReader) {
    const unavailable = { state: 'unavailable' as const, assignmentId: assignment.id,
        resultId: typeof resultId === 'string' && resultId.length <= 512 ? resultId : null };
    try {
        if (!assignment.work || typeof resultId !== 'string' || !resultId || resultId.length > 512) return unavailable;
        const row = boundedPublication(s, assignment, resultId);
        if (!row) return unavailable;
        return recordedAssignmentResult(publicationView(s, row, parseUniqueJson(row.data), reader), assignment, resultId) ?? unavailable;
    } catch {
        // Failure of optional presentation cannot hide otherwise readable status
        // or turn missing evidence into a claim that no work was performed.
        return unavailable;
    }
}

export type DelegatedRequestFailure = {
    assignmentId: string;
    conversationId: string;
    workId: string;
    resultId: string;
    label?: string;
    waitAssignmentId?: string;
    currentWait?: true;
} & ({ limit: number } | { roleRequestLimit: RoleRequestLimitView });
export type DescendantGovernedStop = {
    assignmentId: string;
    conversationId: string;
    workId: string;
    resultId: string;
    waitAssignmentId: string;
    currentWait?: true;
    proof: string;
    stop: 'blocked' | 'provider-limit' | 'unconfirmed';
    providerUsageLimitReset?: number | null;
    providerUsageLimitRole?: Role;
    planningQuestion?: {outputId: string; questionCount: number};
};
export type DescendantContinuationFailure = {
    assignmentId: string;
    conversationId: string;
    workId: string;
    reason: WaitContinuationFailure;
    proof: string;
};
function delegatedFailureLabel(s: Store, conversationId: string) {
    const row = s.one(`SELECT CASE WHEN json_valid(data) AND length(CAST(data AS BLOB))<=65536 THEN
        CASE WHEN json_type(data,'$.userLabel')='text' THEN substr(json_extract(data,'$.userLabel'),1,80) END END AS label
        FROM conversation_state WHERE conversation=?`, conversationId);
    return typeof row?.label === 'string' && row.label.trim() ? { label: row.label } : {};
}
export interface RecordedDelegatedResults {
    entries: {assignmentId: string; conversationId: string; workId: string; resultId: string;
        assignmentProof: string; instructionPreview: string;
        publicationHash: string; candidateVersion: string | null; phase: string; reviewReady: boolean; uncertain: boolean; formalChecks: number;
        roleRequestLimit?: RoleRequestLimitView; providerUsageLimitReset?: number | null; providerUsageLimitRole?: Role;
        planningQuestion?: DescendantGovernedStop['planningQuestion']}[];
    omitted: boolean;
    unavailable: boolean;
    requestFailures?: DelegatedRequestFailure[];
    descendantStops?: DescendantGovernedStop[];
    descendantCoordinatorRoutes?: Readonly<Record<string, {conversationId: string; proof: string}>>;
    descendantWaitStops?: AcceptedWait['targets'];
    descendantContinuationFailures?: DescendantContinuationFailure[];
    waitReviewUnavailable?: true;
}

function matchesWaitDependency(s: Store, conversationId: string, target: string, assignmentId: string, actor: NativeIdentity,
    required: boolean, strict = false, cancelled = false, earlierActors: readonly NativeIdentity[] = []) {
    const allowed = strict ? 1 + earlierActors.length : 1024;
    const dependencies = s.all(`WITH retained AS (
        SELECT target,state,data FROM conversation_dependencies WHERE assignment=? AND waiting=?
        AND (state='PENDING' OR (?=1 AND state='CANCELLED')) LIMIT ?
        ) SELECT target,state,CASE WHEN length(CAST(data AS BLOB))<=65536 AND
            sum(length(CAST(data AS BLOB))) OVER ()<=262144 THEN data END AS data FROM retained`,
        assignmentId, conversationId, Number(cancelled), allowed + 1);
    if (dependencies.length > allowed) return false;
    let exact = 0;
    const historical = new Set<number>();
    for (const edge of dependencies) {
        const source = edge.data ? (parseUniqueJson(edge.data) as any)?.source : undefined;
        if (cancelled && (edge.state !== 'CANCELLED' || edge.target !== target || source?.conversationId !== conversationId ||
            source.workId !== actor.workId)) return false;
        if (edge.target === target && sameNativeIdentity(source, actor)) exact++;
        else if (strict) {
            const index = edge.target === target ? earlierActors.findIndex(prior => sameNativeIdentity(source, prior)) : -1;
            if (index < 0 || historical.has(index)) return false;
            historical.add(index);
        }
    }
    return !required && !dependencies.length || exact === 1;
}

type AcceptedWait = NonNullable<ReturnType<typeof inspectConversationWait>>;
type InterruptedDialog = { identity: NativeIdentity; requestId: string; settlement: 'unconfirmed' | 'interrupted' };
const dialogRequestId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,16}$/u.test(value);

/** Called in startup recovery's transaction. Retain only a dialog queue identity. */
export function captureInterruptedOrdinaryDialog(s: Store,
    run: {id: string; work: string; epoch: number; generation: number; phase: string; reservation: string},
    data: Record<string, any>) {
    const live = run.phase === 'RUNNING' && run.reservation === 'reserved';
    const recovered = ['UNKNOWN', 'INTERRUPTED'].includes(run.phase) && run.reservation === 'consumed' &&
        Number.isSafeInteger(data.recoveredAt) && data.recoveredAt > 0;
    if ((!live && !recovered) || data.interruptedOwnerDialog || data.outcome !== undefined ||
        data.kind !== 'ordinary-conversation' || data.attainedNative !== true ||
        data.ordinaryRoleBinding?.sourceRunId !== run.id || data.ordinaryRoleBinding.conversationId !== data.conversation ||
        typeof data.conversation !== 'string' || typeof data.initialInputId !== 'string') return;
    const state = s.one(`SELECT t.data,t.direction,c.generation FROM conversation_state t JOIN conversations c ON c.id=t.conversation
        JOIN works w ON w.id=t.work AND w.epoch=? AND w.generation=? AND w.state=?
        JOIN conversation_inputs i ON i.id=? AND i.work=t.work AND i.conversation=t.conversation AND i.generation=c.generation
            AND i.source=w.source AND (i.state='CONSUMED' OR (?=1 AND i.state='RECONCILIATION_REQUIRED'))
        JOIN conversation_assignments a ON a.target=t.conversation AND a.work=t.work AND a.state='RUNNING'
        WHERE t.conversation=? AND t.work=? AND (t.resource='RUNNING' OR (?=1 AND t.resource IN ('UNKNOWN','IDLE')))
        AND t.archived=0 AND length(CAST(t.data AS BLOB))<=65536
        AND CASE WHEN length(CAST(i.data AS BLOB))<=65536 AND json_valid(i.data) THEN json_extract(i.data,'$.assignment')=a.id END`,
        run.epoch, run.generation, live ? 'ACTIVE' : run.phase, data.initialInputId, Number(recovered),
        data.conversation, run.work, Number(recovered));
    if (!state) return;
    let value: any;
    try { value = parseUniqueJson(state.data); }
    catch { return; }
    if (value?.runId !== run.id || value.lifecycle?.deleted || !Array.isArray(value.dialogs) || !dialogRequestId(value.dialogs[0])) return;
    const identity: NativeIdentity = {conversationId:data.conversation, workId:run.work, runId:run.id, launchId:null,
        generation:state.generation, directionRevision:state.direction, initialInputId:data.initialInputId};
    s.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({...value, dialogs:[]}), data.conversation);
    return {identity, requestId:value.dialogs[0] as string};
}

function inspectInterruptedDialog(s: Store, conversationId: string, workId: string): InterruptedDialog | undefined {
    try {
        const row = s.one(`SELECT r.id,r.phase,r.data FROM conversation_state t JOIN works w ON w.id=t.work
            JOIN runs r ON r.id=json_extract(t.data,'$.runId') AND r.work=t.work AND r.epoch=w.epoch AND r.generation=w.generation
            WHERE t.conversation=? AND t.work=? AND t.archived=0 AND t.resource IN ('UNKNOWN','IDLE')
            AND r.phase IN ('UNKNOWN','INTERRUPTED') AND r.reservation='consumed' AND r.id=(SELECT id FROM runs WHERE work=w.id ORDER BY rowid DESC LIMIT 1)
            AND length(CAST(r.data AS BLOB))<=65536`, conversationId, workId);
        if (!row) return;
        const run = parseUniqueJson(row.data) as any, marker = run?.interruptedOwnerDialog;
        if (!marker?.identity || marker.identity.runId !== row.id || !dialogRequestId(marker.requestId) || !Number.isSafeInteger(run.recoveredAt)) return;
        if (row.phase === 'INTERRUPTED' && !['removed', 'not-allocated', 'unbound'].includes(run.cleanup)) return;
        return {identity:marker.identity, requestId:marker.requestId, settlement:row.phase === 'UNKNOWN' ? 'unconfirmed' : 'interrupted'};
    } catch { return; }
}

function originalOrdinaryWaitHop(s: Store, wait: AcceptedWait, actor: NativeIdentity, assignmentId: string,
    target: NativeIdentity, waiting: boolean, interrupted?: InterruptedDialog) {
    try {
        if (target.launchId !== null) return;
        const state = waiting ? 'WAITING' : 'RUNNING';
        const phase = interrupted ? interrupted.settlement === 'unconfirmed' ? 'UNKNOWN' : 'INTERRUPTED' : waiting ? 'SETTLED' : 'RUNNING';
        const row = s.one(`SELECT w.project,w.epoch,w.generation AS workGeneration,c.generation,t.direction,
            CASE WHEN length(CAST(a.data AS BLOB))<=65536 THEN a.data END AS assignment,
            CASE WHEN length(CAST(t.data AS BLOB))<=65536 THEN t.data END AS targetData,
            CASE WHEN length(CAST(w.data AS BLOB))<=1048576 THEN w.data END AS work,
            CASE WHEN length(CAST(o.origin AS BLOB))<=65536 THEN o.origin END AS origin,o.id AS sourceId
            FROM conversation_assignments a JOIN conversations c ON c.id=a.target
            JOIN conversation_state t ON t.conversation=a.target AND t.work=a.work
            JOIN works w ON w.id=a.work JOIN sources o ON o.id=w.source AND o.conversation=a.target
            WHERE a.id=? AND a.source_conversation=? AND a.target=? AND a.work=? AND a.state=?
            AND (t.resource=? OR (?=1 AND t.resource IN ('UNKNOWN','IDLE'))) AND t.archived=0
            AND w.state=? AND w.predecessor IS NULL AND w.lineage=w.id`,
            assignmentId, wait.conversationId, target.conversationId, target.workId, state, state, Number(!!interrupted),
            interrupted ? phase : 'ACTIVE');
        if (!row?.assignment || !row.targetData || !row.work || !row.origin ||
            row.generation !== target.generation || row.direction !== target.directionRevision) return;
        const data = parseUniqueJson(row.assignment) as any, source = parseUniqueJson(row.origin) as any;
        const work = parseUniqueJson(row.work) as any, targetState = parseUniqueJson(row.targetData) as any;
        const root = data.delegationRoot;
        if (data.operation !== 'investigate' || data.contextAssignment || data.contextReentry || !sameNativeIdentity(data.source, actor) ||
            typeof root !== 'string' || typeof row.project !== 'string' || data.projectId !== row.project ||
            data.delegation?.rootWorkId !== root || !Array.isArray(data.delegation?.projectIds) || !data.delegation.projectIds.includes(row.project) ||
            captureAudience(s, wait.conversationId, row.project)?.rootWorkId !== root ||
            !interrupted && captureAudience(s, target.conversationId, row.project)?.rootWorkId !== root || work?.delegation?.rootWorkId !== root ||
            !Array.isArray(work.delegation.projectIds) || !work.delegation.projectIds.includes(row.project) ||
            work?.kind !== 'ordinary-conversation' || work.conversation !== target.conversationId || work.assignmentId !== assignmentId ||
            source?.kind !== 'agent-assignment' || source.event !== assignmentId || !sameNativeIdentity(source.actor, data.source) ||
            data.instructionsSource !== row.sourceId || data.inputId !== target.initialInputId || targetState.lifecycle?.deleted || targetState.runId !== target.runId ||
            !Number.isSafeInteger(data.targetGeneration) || data.targetGeneration + 1 !== target.generation) return;
        const input = s.one(`SELECT i.data AS receipt,r.data AS run FROM conversation_inputs i JOIN runs r ON r.id=? AND r.work=i.work
            WHERE i.id=? AND i.conversation=? AND i.work=? AND i.generation=? AND i.source=?
            AND (i.state='CONSUMED' OR (?=1 AND i.state='RECONCILIATION_REQUIRED'))
            AND r.phase=? AND r.reservation=? AND r.epoch=? AND r.generation=?
            AND length(CAST(i.data AS BLOB))<=65536 AND length(CAST(r.data AS BLOB))<=65536`,
            target.runId, target.initialInputId, target.conversationId, target.workId, target.generation, row.sourceId,
            Number(!!interrupted), phase, waiting || interrupted ? 'consumed' : 'reserved', row.epoch, row.workGeneration);
        const run = input && parseUniqueJson(input.run) as any;
        if (!input || (parseUniqueJson(input.receipt) as any)?.assignment !== assignmentId ||
            run?.kind !== 'ordinary-conversation' || run.conversation !== target.conversationId ||
            run.initialInputId !== target.initialInputId || run.ordinaryRoleBinding?.sourceRunId !== target.runId ||
            run.ordinaryRoleBinding.conversationId !== target.conversationId || run.attainedNative !== true ||
            !matchesWaitDependency(s, wait.conversationId, target.conversationId, assignmentId, actor, data.resultDependency !== false, true)) return;
        const head = !waiting && Array.isArray(targetState.dialogs) ? targetState.dialogs[0] : undefined;
        const requestId = typeof head === 'string' && /^\d{1,16}$/u.test(head) ? head : undefined;
        return { actor, assignmentId, target, root, project: row.project, requestId };
    } catch { return; }
}

type WaitHop = NonNullable<ReturnType<typeof originalOrdinaryWaitHop>>;

/** Qualify a warning without disclosing a target or granting a work route. */
function scopedWaitTarget(s: Store, origin: string, wait: AcceptedWait, target: AcceptedWait['targets'][number],
    actor: NativeIdentity, path: readonly WaitHop[], operation: 'investigate' | 'change') {
    try {
        const row = s.one(`SELECT w.project,a.data FROM conversation_assignments a JOIN works w ON w.id=a.work
            WHERE a.id=? AND a.source_conversation=? AND a.target=? AND a.work=? AND a.state=?
            AND length(CAST(a.data AS BLOB))<=65536`,
        target.assignmentId, wait.conversationId, target.conversationId, target.workId, target.state);
        const data = row?.data ? parseUniqueJson(row.data) as any : undefined;
        const root = data?.delegationRoot, project = row?.project;
        return data?.operation === operation && !data.contextAssignment && !data.contextReentry &&
            typeof root === 'string' && typeof project === 'string' && data.projectId === project &&
            data.delegation?.rootWorkId === root && Array.isArray(data.delegation?.projectIds) && data.delegation.projectIds.includes(project) &&
            sameNativeIdentity(data.reentries?.at(-1)?.actor ?? data.source, actor) &&
            captureAudience(s, wait.conversationId, project)?.rootWorkId === root &&
            captureAudience(s, origin, project)?.rootWorkId === root &&
            path.every(hop => hop.root === root && captureAudience(s, hop.target.conversationId, project)?.rootWorkId === root);
    } catch { return false; }
}

function settledWaitWithoutActor(s: Store, wait: AcceptedWait) {
    return !!s.one("SELECT 1 FROM runs WHERE id=? AND work=? AND phase='SETTLED'", wait.runId, wait.workId);
}

/** Follow only the current consumed ordinary assignment at each accepted WAIT. */
function *acceptedOrdinaryWaitTargets(s: Store, conversationId: string, unavailable?: () => void) {
    const first = inspectConversationWait(s, conversationId);
    if (!first) {
        if (unavailable && s.one("SELECT 1 FROM conversation_state WHERE conversation=? AND resource='WAITING' AND archived=0", conversationId))
            unavailable();
        return;
    }
    const queue: {wait: AcceptedWait; path: readonly WaitHop[]}[] = [{wait:first,path:[]}];
    let remaining = 24;
    for (const {wait,path} of queue) {
        if (wait.omitted || wait.settlementUnconfirmed) continue;
        const actor = settledConversationWaitActor(s, wait);
        if (!actor) {
            if (unavailable && settledWaitWithoutActor(s, wait)) unavailable();
            continue;
        }
        for (const target of wait.targets) {
            if (remaining-- <= 0) return;
            if (!target.workId || target.conversationId === conversationId ||
                path.some(hop => hop.target.conversationId === target.conversationId)) continue;
            yield {wait,actor,target,path};
            if (target.state !== 'WAITING' || target.cleanupUnconfirmed || path.length >= 2) continue;
            const next = inspectConversationWait(s, target.conversationId);
            const matchingWait = next?.workId === target.workId ? next : undefined;
            const identity = matchingWait && settledConversationWaitActor(s, matchingWait);
            const hop = identity && originalOrdinaryWaitHop(s, wait, actor, target.assignmentId, identity, true);
            if (matchingWait && hop && (!path.length || path[0]?.root === hop.root && captureAudience(s, conversationId, hop.project)?.rootWorkId === hop.root))
                queue.push({wait:matchingWait,path:[...path,hop]});
            else if (unavailable && (!matchingWait || identity || settledWaitWithoutActor(s, matchingWait)) &&
                scopedWaitTarget(s, conversationId, wait, target, actor, path, 'investigate')) unavailable();
        }
    }
}

/** Review through settled accepted waits without answer or replay authority. */
export function inspectDelegatedWaitDialogs(s: Store, conversationId: string, live: (id: string) => NativeIdentity | undefined) {
    const dialogs: { assignmentId: string; conversationId: string; requestId: string; path: readonly WaitHop[]; interrupted?: InterruptedDialog }[] = [];
    for (const {wait,actor,target,path} of acceptedOrdinaryWaitTargets(s, conversationId)) {
        if (target.state !== 'RUNNING' || !target.workId) continue;
        const active = !target.cleanupUnconfirmed ? live(target.conversationId) : undefined;
        const interrupted = !active ? inspectInterruptedDialog(s, target.conversationId, target.workId) : undefined;
        const identity = active ?? interrupted?.identity;
        if (!identity || identity.conversationId !== target.conversationId || identity.workId !== target.workId) continue;
        const hop = originalOrdinaryWaitHop(s, wait, actor, target.assignmentId, identity, false, interrupted);
        if (!hop || path.length && (path[0]?.root !== hop.root || captureAudience(s, conversationId, hop.project)?.rootWorkId !== hop.root)) continue;
        const requestId = interrupted?.requestId ?? hop.requestId;
        if (requestId) dialogs.push({assignmentId:target.assignmentId,conversationId:target.conversationId,requestId,
            path:[...path,hop],...(interrupted ? {interrupted} : {})});
    }
    return dialogs;
}

function descendantWaitStop(target: AcceptedWait['targets'][number]) {
    return target.state === 'CANCELLED' || target.state === 'UNAVAILABLE' && (!target.resultId || target.cleanupUnconfirmed);
}

function waitWorkProof(s: Store, wait: AcceptedWait, target: AcceptedWait['targets'][number], actor: NativeIdentity,
    origin: string, path: readonly WaitHop[]) {
    try {
        if (!target.workId || !target.cleanupUnconfirmed && !['UNAVAILABLE', 'CANCELLED', 'RECOVERY_READY'].includes(target.state)) return;
        const original = originalGovernedAssignment(s, target.assignmentId);
        const project = original.work.project, root = original.data.delegationRoot;
        const assigningActor = original.data.reentries?.at(-1)?.actor ?? original.data.source;
        if (original.assignment.source_conversation !== wait.conversationId || original.assignment.target !== target.conversationId ||
            original.work.id !== target.workId || original.assignment.state !== target.state ||
            !sameNativeIdentity(assigningActor, actor) || original.data.contextAssignment || original.data.contextReentry ||
            original.data.delegation?.rootWorkId !== root ||
            typeof root !== 'string' || typeof project !== 'string' || captureAudience(s, wait.conversationId, project)?.rootWorkId !== root ||
            path.length && (captureAudience(s, origin, project)?.rootWorkId !== root ||
                path.some(hop => hop.root !== root || captureAudience(s, hop.target.conversationId, project)?.rootWorkId !== root))) return;
        const cleanupUnconfirmed = workCleanupUnconfirmed(s, original.work);
        if (!!target.cleanupUnconfirmed !== cleanupUnconfirmed) return;
        const currentResult = currentAssignmentResultId(original.data);
        if (path.length && (!descendantWaitStop(target) || target.state === 'UNAVAILABLE' &&
            !cleanupUnconfirmed && (original.data.launchResultUnavailable !== true || currentResult))) return;
        const cancelled = target.state === 'CANCELLED';
        const nestedUnavailable = path.length > 0 && !cancelled;
        if (nestedUnavailable && (!Array.isArray(original.data.delegation?.projectIds) ||
            !original.data.delegation.projectIds.includes(project) || original.value.invocation?.delegationRoot !== root)) return;
        const reentries = original.data.reentries ?? [];
        if (!Array.isArray(reentries) || reentries.length > 64) return;
        const earlierActors: NativeIdentity[] = nestedUnavailable && reentries.length
            ? [original.data.source, ...reentries.slice(0, -1).map(entry => entry?.actor)] : [];
        if (earlierActors.some(prior => !prior || prior.conversationId !== actor.conversationId || prior.workId !== actor.workId ||
            prior.launchId !== null || !Number.isSafeInteger(prior.generation) || prior.generation < 1 ||
            !Number.isSafeInteger(prior.directionRevision) || prior.directionRevision < 0 ||
            [prior.runId, prior.initialInputId].some(id => typeof id !== 'string' || !id.length || Buffer.byteLength(id) > 512))) return;
        const cancellation = cancelled ? originalOwnerCancellation(s, original) : undefined;
        if (cancelled && !cancellation) return;
        if (!matchesWaitDependency(s, wait.conversationId, target.conversationId, target.assignmentId, actor,
            original.data.resultDependency !== false, nestedUnavailable, cancelled, earlierActors)) return;
        const lastRun = path.length ? s.one('SELECT id,phase FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1', original.work.id) : undefined;
        return {workId:target.workId, proof:original.proof, epoch:original.work.epoch, state:original.work.state,
            cleanupUnconfirmed, ...(cancellation ? {cancellation} : {}),
            ...(target.state === 'UNAVAILABLE' && original.data.launchResultUnavailable === true ? {launchFailed: true as const} : {}),
            ...(path.length ? {pathProof:hash([path, target, original.data.reentries?.at(-1), original.data.launchResultUnavailable,
                original.data.resultId, currentResult, original.work.generation, lastRun])} : {})};
    } catch { return; }
}

/** Read a direct stopped work or a verified stop reached through current ordinary waits. */
export function inspectDelegatedWaitWork(s: Store, conversationId: string, assignmentId: string) {
    const wait = inspectConversationWait(s, conversationId);
    if (!wait || wait.settlementUnconfirmed) return;
    const direct = wait.targets.find(item => item.assignmentId === assignmentId);
    if (direct) {
        const actor = settledConversationWaitActor(s, wait);
        return actor && waitWorkProof(s, wait, direct, actor, conversationId, []);
    }
    for (const branch of acceptedOrdinaryWaitTargets(s, conversationId)) {
        if (branch.target.assignmentId !== assignmentId || !descendantWaitStop(branch.target)) continue;
        const proof = waitWorkProof(s, branch.wait, branch.target, branch.actor, conversationId, branch.path);
        if (proof) return proof;
    }
}

function originalOwnerCancellation(s: Store, original: ReturnType<typeof originalGovernedAssignment>) {
    const {data,work} = original;
    if (typeof data.cancellationSource !== 'string' || !['CANCELLED','UNKNOWN','QUARANTINED'].includes(work.state)) return;
    const source = s.one(`SELECT id,origin,raw FROM sources WHERE id=? AND conversation IS NULL
        AND length(CAST(origin AS BLOB))<=65536 AND length(CAST(raw AS BLOB))<=131072 AND length(trim(raw))>0`, data.cancellationSource);
    const origin = source?.origin && parseUniqueJson(source.origin) as any;
    const requested = origin?.requestedWork;
    if (origin?.kind !== 'owner-task-cancel' || !Number.isSafeInteger(origin.uid) || origin.uid !== process.getuid?.() ||
        requested?.version !== 1 || requested.id !== work.id || requested.sourceId !== work.source ||
        requested.toEpoch !== work.epoch || requested.toState !== work.state || !Number.isSafeInteger(requested.fromEpoch) ||
        requested.fromEpoch < 1 || !['ACTIVE','DELIVERED','INTERRUPTED','CANCELLED','UNKNOWN','QUARANTINED'].includes(requested.fromState) ||
        requested.fromEpoch + (requested.fromState === 'CANCELLED' ? 0 : 1) !== requested.toEpoch) return;
    const expectedState = ['UNKNOWN','QUARANTINED'].includes(requested.fromState) ? requested.fromState : 'CANCELLED';
    if (requested.toState !== expectedState) return;
    return hash(source);
}
/** Owner view of original receiver-bound publications, never current action eligibility. */
function directRecordedDelegatedResults(s: Store, conversationId: string): RecordedDelegatedResults {
    const result: RecordedDelegatedResults = {entries: [], omitted: false, unavailable: false};
    const rows = s.all(`SELECT id, CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data
        FROM conversation_notifications WHERE target=? ORDER BY rowid DESC LIMIT 33`, conversationId);
    result.omitted = rows.length > 32;
    const selected = new Set<string>();
    let proofCount = 0, ordinaryProofCount = 0, bytes = 0, exhausted = false;
    const charge = (size: number) => { bytes += size; if (bytes > 4 * 1024 * 1024) {exhausted = true; result.omitted = true; throw Error('Recorded result observation budget exceeded');} };
    for (const row of rows.slice(0, 32)) {
        let identified = false;
        try {
            if (!row.data) throw Error('Original notice unavailable');
            charge(Buffer.byteLength(row.data));
            const notice = parseUniqueJson(row.data) as any;
            if (!notice || typeof notice !== 'object' || Array.isArray(notice) || typeof notice.kind !== 'string') throw Error('Original notice unavailable');
            if (notice?.kind !== 'result-ready' || notice.assignmentId === null) continue;
            const id = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && Buffer.byteLength(v) <= 512 && !/[\x00-\x1f\x7f-\x9f]/u.test(v);
            if (!id(notice.assignmentId)) throw Error('Original assignment unavailable');
            // A corrupt newer original cannot fall back to an older favorable snapshot.
            if (selected.has(notice.assignmentId)) continue;
            selected.add(notice.assignmentId); identified = true;
            if (!id(notice.resultId) || notice.eventKey !== notice.resultId || row.id !== 'notice-' + hash([conversationId, notice.eventKey]))
                throw Error('Original notice correspondence unavailable');
            const assignment = s.one(`SELECT id,target,work,source_conversation,
                CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data
                FROM conversation_assignments WHERE id=?`, notice.assignmentId);
            if (!assignment?.data || assignment.source_conversation !== conversationId || assignment.target !== notice.conversationId)
                throw Error('Original receiver correspondence unavailable');
            charge(Buffer.byteLength(assignment.data));
            const data = parseUniqueJson(assignment.data) as any;
            if (data?.operation === 'investigate') {
                if (!s.one(`SELECT 1 FROM conversation_results WHERE id=? AND
                    CASE WHEN length(CAST(data AS BLOB))<=? AND json_valid(data)
                    THEN json_type(data,'$.result.requestLimit.limit')='integer' END`, notice.resultId, coordinationBytes)) continue;
                const original = boundedPublication(s, assignment, notice.resultId);
                if (!original) continue;
                charge(Buffer.byteLength(original.data));
                const publication = parseUniqueJson(original.data) as any;
                if (publication.assignmentId !== assignment.id || publication.result?.requestLimit === undefined) continue;
                if (ordinaryProofCount++ >= 4) { result.omitted = true; continue; }
                const binding = captureAudience(s, conversationId, publication.projectId);
                if (!binding || !id(data.delegationRoot) || binding.rootWorkId !== data.delegationRoot ||
                    data.projectId !== publication.projectId || data.source?.conversationId !== conversationId ||
                    !Array.isArray(publication.audience) || !publication.audience.some((audience: Audience) =>
                        audience?.conversationId === conversationId && audience.rootWorkId === data.delegationRoot && audience.projectId === publication.projectId))
                    continue;
                const failure = inspectConversationRequestFailure(s, assignment.target);
                if (failure && failure.resultId === notice.resultId && failure.workId === assignment.work &&
                    ['removed', 'not-allocated', 'unbound'].includes(failure.cleanup) &&
                    s.one(`SELECT 1 FROM runs r JOIN conversation_inputs i ON i.id=? AND i.work=r.work AND i.source=?
                        WHERE r.id=? AND i.conversation=? AND i.state='CONSUMED'
                        AND CASE WHEN json_valid(r.data) AND json_valid(i.data) THEN
                            json_extract(r.data,'$.initialInputId')=i.id AND json_extract(i.data,'$.assignment')=? END`,
                        data.inputId, data.instructionsSource, failure.runId, assignment.target, assignment.id))
                    (result.requestFailures ??= []).push({ assignmentId: assignment.id, conversationId: failure.conversationId,
                        workId: failure.workId, resultId: failure.resultId, limit: failure.limit, ...delegatedFailureLabel(s, failure.conversationId) });
                continue;
            }
            if (data?.operation !== 'change') continue;
            if (!id(assignment.work)) throw Error('Original work unavailable');
            if (proofCount++ >= 4) {result.omitted = true; continue;}
            // Reserve for the shared original reader's bounded source/input envelopes.
            charge(512 * 1024);
            if (!id(data.delegationRoot) || data.source?.conversationId !== conversationId || !id(data.source?.workId)) throw Error('Original result scope unavailable');
            const saved = originalGovernedAssignment(s, assignment.id, true);
            charge(Buffer.byteLength(saved.work.data));
            const childData = saved.value;
            const initial = s.one(`SELECT CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM conversation_inputs WHERE id=?`, data.inputId);
            if (!initial?.data) throw Error('Original assigned input unavailable');
            parseUniqueJson(initial.data);
            const actor = data.source;
            const run = s.one(`SELECT work,epoch,generation,phase,reservation,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data
                FROM runs WHERE id=?`, actor.runId);
            if (run?.data) charge(Buffer.byteLength(run.data));
            const runData = run?.data ? parseUniqueJson(run.data) as any : null;
            const ownerInput = s.one('SELECT conversation,work,generation,state FROM conversation_inputs WHERE id=?', actor.initialInputId);
            // Run generation is a work ordinal; actor/input generation belongs to the conversation.
            if (!runData || run.work !== actor.workId || !Number.isSafeInteger(run.generation) || run.generation < 1 ||
                !Number.isSafeInteger(run.epoch) || run.epoch < 1 || run.phase !== 'SETTLED' || run.reservation !== 'consumed' ||
                runData.kind !== 'ordinary-conversation' || runData.conversation !== conversationId || runData.initialInputId !== actor.initialInputId ||
                !runData.attainedNative || runData.ordinaryRoleBinding?.sourceRunId !== actor.runId || runData.ordinaryRoleBinding?.conversationId !== conversationId ||
                !Number.isSafeInteger(actor.generation) || actor.generation < 1 || !ownerInput || ownerInput.conversation !== conversationId ||
                ownerInput.work !== actor.workId || ownerInput.generation !== actor.generation || ownerInput.state !== 'CONSUMED')
                throw Error('Original assigning run/input correspondence unavailable');

            const parent = s.one(`SELECT CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data
                FROM works WHERE id=?`, data.source.workId);
            if (parent?.data) charge(Buffer.byteLength(parent.data));
            const parentData = parent?.data ? parseUniqueJson(parent.data) as any : null;
            const root = s.one('SELECT id FROM works WHERE id=?', data.delegationRoot);
            if (!root || parentData?.conversation !== conversationId || parentData?.delegation?.rootWorkId !== data.delegationRoot ||
                childData.invocation?.delegationRoot !== data.delegationRoot || hash(saved.data.source) !== hash(data.source))
                throw Error('Original assigning work/root correspondence unavailable');
            for (const sourceId of [saved.work.source, data.instructionsSource]) {
                const source = s.one(`SELECT CASE WHEN length(CAST(origin AS BLOB))<=65536 THEN origin ELSE NULL END AS origin FROM sources WHERE id=?`, sourceId);
                if (!source?.origin) throw Error('Original source unavailable');
                charge(Buffer.byteLength(source.origin));
                parseUniqueJson(source.origin);
            }
            const original = boundedPublication(s, assignment, notice.resultId);
            if (!original) throw Error('Original publication unavailable');
            // Keep the catalogue's existing observation budget across both read surfaces.
            charge(3 * Buffer.byteLength(original.data));
            const publication = parseUniqueJson(original.data) as any;
            const producer = s.one('SELECT project FROM works WHERE id=?', assignment.work);
            if (!producer || data.projectId !== producer.project || publication.projectId !== producer.project || !Array.isArray(publication.audience) ||
                !publication.audience.some((a: any) => a?.conversationId === conversationId && a.rootWorkId === data.delegationRoot && a.projectId === publication.projectId))
                throw Error('Original captured audience unavailable');
            const metadata = recordedAssignmentResult(publicationView(s, original, publication), assignment, notice.resultId);
            if (!metadata) throw Error('Original governed observation unavailable');
            const snapshot = metadata.snapshot;
            const summary = snapshot.recordedResult;
            if (snapshot.candidateVersion !== null && !id(snapshot.candidateVersion) ||
                !id(snapshot.phase))
                throw Error('Original recorded facts unavailable');
            const uncertain = snapshot.state === 'UNKNOWN' || (summary?.workId === snapshot.workId && summary?.recordedPhase === snapshot.phase && summary?.state === 'UNKNOWN');
            const role = !uncertain && !snapshot.reviewReady && snapshot.phase === 'BLOCKED' &&
                summary?.workId === snapshot.workId && summary?.recordedPhase === snapshot.phase ? summary.roleRequestLimit : undefined;
            const requestLimit = roleRequestLimit(role?.requestLimit);
            const stage = rolePresentationStage(role?.role, role?.roleStage);
            const attributedRole = requestLimit && id(role?.launchId) &&
                ['planner', 'challenger', 'adjudicator', 'implementer', 'reviewer', 'repairer', 'confirmer'].includes(role?.role)
                ? {role: role.role, ...(stage ? {roleStage: stage} : {}), launchId: role.launchId, requestLimit} : undefined;
            const quota = !uncertain && !snapshot.reviewReady && snapshot.phase === 'BLOCKED' &&
                summary?.workId === snapshot.workId && summary?.recordedPhase === snapshot.phase ? summary.providerUsageLimitReset : undefined;
            const recordedQuotaRole = providerUsageLimitRole(summary?.providerUsageLimitRole);
            const clarification = !uncertain && !snapshot.reviewReady && snapshot.phase === 'BLOCKED' &&
                summary?.workId === snapshot.workId && summary?.recordedPhase === snapshot.phase ? summary.planningClarification : undefined;
            const planningQuestion = id(clarification?.outputId) && Number.isSafeInteger(clarification?.questionCount) && clarification.questionCount > 0
                ? {outputId: clarification.outputId, questionCount: clarification.questionCount} : undefined;
            result.entries.push({assignmentId: assignment.id, conversationId: assignment.target, workId: assignment.work, resultId: notice.resultId,
                assignmentProof: saved.proof, instructionPreview: saved.instructions.trimStart().slice(0, 256).replace(/[\uD800-\uDBFF]$/u, ''),
                publicationHash: metadata.publicationHash, candidateVersion: snapshot.candidateVersion, phase: snapshot.phase, reviewReady: snapshot.reviewReady,
                uncertain, formalChecks: snapshot.counts.checks, ...(attributedRole ? {roleRequestLimit: attributedRole} : {}),
                ...(planningQuestion ? {planningQuestion} : {}),
                ...(quota === null || validProviderReset(quota) ? {providerUsageLimitReset: quota,
                    ...(recordedQuotaRole ? {providerUsageLimitRole: recordedQuotaRole} : {})} : {})});
        } catch { result.unavailable = true; if (!identified || exhausted) break; }
    }
    if (result.entries.length > 4) {result.entries.length = 4; result.omitted = true;}
    return result;
}

type CoordinatorDescendantFailure = {
    assignmentId: string;
    conversationId: string;
    workId: string;
    resultId: string;
    coordinatorConversationId: string;
    temporalScope: 'publication-only';
} & ({kind: 'local-model-request-limit'; limit: number; used?: number; role?: Role} |
    {kind: 'provider-usage-limit'; reset: number | null; role?: Role} | {kind: 'blocked' | 'unconfirmed'});

/** Exact original ordinary assignment hops can carry a display-only failure
 * up their captured delegation. Visual conversation ancestry grants nothing. */
function collectRecordedDescendantFailures(s: Store, conversationId: string, result: RecordedDelegatedResults,
    scoped?: {reader: PublicationReader; firstAssignmentId: string}) {
    const entries: CoordinatorDescendantFailure[] = [];
    const coordinatorRoutes: Record<string, {conversationId: string; proof: string}> = Object.create(null);
    const seen = new Set([conversationId]);
    const failures = new Set([...(result.requestFailures ?? []), ...result.entries].map(entry => entry.resultId));
    let descendantStops = 0;
    let remaining = 12;
    let descendantSearchBounded = false;
    const currentWaitTargets = (cid: string) => {
        const wait = inspectConversationWait(s, cid);
        return wait && !wait.omitted && !wait.settlementUnconfirmed && !wait.targets.some(target => target.cleanupUnconfirmed) &&
            settledConversationWaitActor(s, wait) ? wait.targets : [];
    };
    const activeView = (cid: string) => s.one(`SELECT c.project,c.generation,cs.work,cs.direction FROM conversations c
        JOIN conversation_state cs ON cs.conversation=c.id WHERE c.id=? AND cs.archived=0
        AND CASE WHEN json_valid(cs.data) THEN json_extract(cs.data,'$.lifecycle.deleted') IS NOT 1 END`, cid);
    type Hop = {conversationId: string; workId: string; projectId: string; proof: string};
    const visit = (parent: string, path: readonly Hop[], expectedRoot?: string, firstHop?: string, waitingChain = true) => {
        const depth = path.length;
        const parentTargets = waitingChain ? currentWaitTargets(parent) : [];
        const selected = depth === 0 ? scoped?.firstAssignmentId ?? null : null;
        const candidates = s.all(`SELECT a.id,a.target,a.work,
            CASE WHEN length(CAST(a.data AS BLOB))<=65536 THEN a.data END AS data
            FROM conversation_assignments a JOIN conversation_state c ON c.conversation=a.target AND c.work=a.work
            WHERE a.source_conversation=? AND c.archived=0 AND a.state IN ('RUNNING','WAITING','COMPLETE','UNAVAILABLE')
            AND (? IS NULL OR a.id=?)
            AND CASE WHEN json_valid(a.data) AND json_valid(c.data) THEN
                json_extract(a.data,'$.operation')='investigate' AND json_extract(c.data,'$.lifecycle.deleted') IS NOT 1 END
            ORDER BY a.rowid DESC LIMIT 5`, parent, selected, selected);
        if (candidates.length && depth === 3) { descendantSearchBounded = true; return; }
        if (candidates.length > 4) descendantSearchBounded = true;
        for (const assignment of candidates.slice(0, 4)) {
            if (seen.has(assignment.target)) continue;
            if (remaining-- <= 0) { descendantSearchBounded = true; return; }
            try {
                if (!assignment.data) continue;
                const data = parseUniqueJson(assignment.data) as any, actor = data?.source;
                const project = data?.projectId, root = data?.delegationRoot;
                if (typeof project !== 'string' || typeof root !== 'string' || !root || (expectedRoot && root !== expectedRoot) ||
                    data.delegation?.rootWorkId !== root || !Array.isArray(data.delegation.projectIds) ||
                    !data.delegation.projectIds.includes(project) ||
                    actor?.conversationId !== parent || actor.launchId !== null || data.contextAssignment || data.contextReentry ||
                    !Number.isSafeInteger(data.targetGeneration) || data.targetGeneration < 0 || data.targetGeneration >= Number.MAX_SAFE_INTEGER ||
                    captureAudience(s, parent, project)?.rootWorkId !== root || captureAudience(s, assignment.target, project)?.rootWorkId !== root) continue;
                if (scoped && (root !== scoped.reader.delegation.rootWorkId || !scoped.reader.delegation.projectIds.includes(project) ||
                    depth === 0 && actor.workId !== scoped.reader.identity.workId)) continue;
                const original = s.one(`SELECT o.conversation,
                    CASE WHEN length(CAST(o.origin AS BLOB))<=65536 THEN o.origin END AS origin,
                    CASE WHEN length(CAST(w.data AS BLOB))<=1048576 THEN w.data END AS workData
                    FROM works w JOIN sources o ON o.id=w.source
                    WHERE w.id=? AND w.project=? AND w.predecessor IS NULL AND w.lineage=w.id
                    AND w.state NOT IN ('CANCELLED','UNKNOWN') AND o.id=?`, assignment.work, project, data.instructionsSource);
                const origin = original?.origin ? parseUniqueJson(original.origin) as any : null;
                const work = original?.workData ? parseUniqueJson(original.workData) as any : null;
                if (original?.conversation !== assignment.target || origin?.kind !== 'agent-assignment' || origin.event !== assignment.id ||
                    hash(origin.actor) !== hash(actor) || work?.kind !== 'ordinary-conversation' || work.assignmentId !== assignment.id ||
                    work.conversation !== assignment.target || work.delegation?.rootWorkId !== root) continue;
                const bound = s.one(`SELECT 1 FROM runs r JOIN conversation_state p ON p.work=r.work AND p.conversation=?
                    JOIN conversation_inputs i ON i.id=? AND i.conversation=p.conversation AND i.work=r.work
                    JOIN conversation_inputs j ON j.id=? AND j.conversation=? AND j.work=? AND j.source=?
                    WHERE r.id=? AND r.work=? AND p.archived=0 AND r.reservation='consumed'
                    AND i.generation=? AND i.state='CONSUMED' AND j.state='CONSUMED' AND j.generation=?
                    AND CASE WHEN json_valid(r.data) AND json_valid(j.data) THEN
                        json_extract(r.data,'$.kind')='ordinary-conversation' AND json_extract(r.data,'$.conversation')=p.conversation
                        AND json_extract(r.data,'$.initialInputId')=i.id AND json_extract(r.data,'$.ordinaryRoleBinding.sourceRunId')=r.id
                        AND json_extract(r.data,'$.ordinaryRoleBinding.conversationId')=p.conversation
                        AND json_type(r.data,'$.attainedNative')='true'
                        AND json_extract(j.data,'$.assignment')=? END`, parent, actor.initialInputId, data.inputId,
                    assignment.target, assignment.work, data.instructionsSource, actor.runId, actor.workId, actor.generation, data.targetGeneration + 1, assignment.id);
                if (!bound) continue;
                const hop = {conversationId: assignment.target, workId:assignment.work, projectId:project, proof:hash([assignment.id, data])};
                seen.add(assignment.target);
                const waitingHere = parentTargets.some(target => target.assignmentId === assignment.id &&
                    target.conversationId === assignment.target && target.workId === assignment.work && target.state === 'WAITING');
                const childTargets = waitingHere ? currentWaitTargets(assignment.target) : [];
                const child = directRecordedDelegatedResults(s, assignment.target);
                if (child.omitted || child.unavailable) descendantSearchBounded = true;
                const childFailures = [...(child.requestFailures ?? []),
                    ...child.entries.filter(entry => entry.uncertain || entry.phase === 'BLOCKED' && !entry.reviewReady)];
                for (const failure of childFailures) {
                    if (failures.has(failure.resultId)) continue;
                    const original = boundedPublication(s, { target: failure.conversationId, work: failure.workId }, failure.resultId);
                    const publication = original ? parseUniqueJson(original.data) as any : null;
                    if (publication?.assignmentId !== failure.assignmentId || typeof publication.projectId !== 'string' ||
                        captureAudience(s, conversationId, publication.projectId)?.rootWorkId !== root ||
                        !Array.isArray(publication.audience) || !publication.audience.some((audience: Audience) =>
                            audience?.conversationId === assignment.target && audience.rootWorkId === root && audience.projectId === publication.projectId))
                        continue;
                    if (descendantStops >= 4) { result.omitted = true; break; }
                    const currentLeaf = () => {
                        if (path.some(hop => captureAudience(s, hop.conversationId, publication.projectId)?.rootWorkId !== root) ||
                            captureAudience(s, assignment.target, publication.projectId)?.rootWorkId !== root) return;
                        const current = s.one(`SELECT data FROM conversation_assignments WHERE id=? AND target=? AND work=?
                            AND source_conversation=? AND state='UNAVAILABLE' AND length(CAST(data AS BLOB))<=65536`,
                        failure.assignmentId, failure.conversationId, failure.workId, assignment.target);
                        const data = current && parseUniqueJson(current.data) as any;
                        if (!data || data.contextAssignment || data.contextReentry || data.delegationRoot !== root ||
                            data.delegation?.rootWorkId !== root || !Array.isArray(data.delegation.projectIds) ||
                            !data.delegation.projectIds.includes(publication.projectId) || data.projectId !== publication.projectId ||
                            data.source?.workId !== assignment.work || data.source.conversationId !== assignment.target ||
                            currentAssignmentResultId(data) !== failure.resultId) return;
                        const latest = s.one(`SELECT id FROM conversation_results WHERE conversation=? AND
                            CASE WHEN json_valid(data) THEN json_extract(data,'$.assignmentId')=? END ORDER BY rowid DESC LIMIT 1`,
                        failure.conversationId, failure.assignmentId);
                        if (latest?.id !== failure.resultId) return;
                        if ('limit' in failure && !originalOrdinaryAssignmentInput(s, failure.assignmentId, failure.conversationId,
                            publication.result?.runId, data)) return;
                        return data;
                    };
                    if (scoped) {
                        if (!scoped.reader.delegation.projectIds.includes(publication.projectId) || !currentLeaf()) continue;
                        const {assignmentId, conversationId, workId, resultId} = failure;
                        const observed = {assignmentId, conversationId, workId, resultId, coordinatorConversationId:assignment.target,
                            temporalScope:'publication-only' as const};
                        if ('limit' in failure) entries.push({...observed, kind:'local-model-request-limit', limit:failure.limit});
                        else if (failure.roleRequestLimit) entries.push({...observed, kind:'local-model-request-limit',
                            limit:failure.roleRequestLimit.requestLimit.limit, used:failure.roleRequestLimit.requestLimit.used,
                            role:failure.roleRequestLimit.role});
                        else if ('assignmentProof' in failure) entries.push(failure.uncertain ? {...observed, kind:'unconfirmed'} :
                            failure.providerUsageLimitReset !== undefined ? {...observed, kind:'provider-usage-limit',
                                reset:failure.providerUsageLimitReset, ...(failure.providerUsageLimitRole ? {role:failure.providerUsageLimitRole} : {})}
                                : {...observed, kind:'blocked'});
                        failures.add(failure.resultId);
                        descendantStops++;
                        continue;
                    }
                    // Keep historical display even when the current navigation route cannot be established.
                    try {
                        const current = currentLeaf();
                        const leaf = current && activeView(failure.conversationId);
                        if (leaf?.work === failure.workId && leaf.project === publication.projectId) {
                            const originView = activeView(conversationId);
                            const hops = [...path, hop];
                            const views = hops.map(step => activeView(step.conversationId));
                            if (originView && hops.every((step, index) =>
                                views[index]?.work === step.workId && views[index]?.project === step.projectId))
                                coordinatorRoutes[failure.resultId] = {
                                    conversationId:assignment.target,
                                    proof:hash([originView, hops, views, leaf, current, failure.assignmentId, failure.workId, failure.resultId, original?.data]),
                                };
                        }
                    } catch { /* Historical review remains available. */ }
                    failures.add(failure.resultId);
                    descendantStops++;
                    const waitAssignmentId = firstHop ?? assignment.id;
                    const matchesCurrentWait = childTargets.some(target => target.assignmentId === failure.assignmentId &&
                        target.conversationId === failure.conversationId && target.workId === failure.workId &&
                        target.state === 'UNAVAILABLE' && target.resultId === failure.resultId);
                    const currentWait = matchesCurrentWait ? {currentWait: true as const} : {};
                    if (!('assignmentProof' in failure)) {
                        (result.requestFailures ??= []).push({ ...failure, waitAssignmentId, ...currentWait });
                    } else {
                        const {assignmentId, conversationId, workId, resultId, roleRequestLimit, uncertain, providerUsageLimitReset,
                            providerUsageLimitRole, planningQuestion} = failure;
                        if (roleRequestLimit) {
                            (result.requestFailures ??= []).push({assignmentId, conversationId, workId, resultId, waitAssignmentId,
                                roleRequestLimit, ...currentWait, ...delegatedFailureLabel(s, conversationId)});
                        } else {
                            (result.descendantStops ??= []).push({assignmentId, conversationId, workId, resultId, waitAssignmentId,
                                proof: hash([failure.assignmentProof, failure.publicationHash]),
                                stop: uncertain ? 'unconfirmed' : providerUsageLimitReset !== undefined ? 'provider-limit' : 'blocked',
                                ...(providerUsageLimitReset !== undefined ? {providerUsageLimitReset} : {}),
                                ...(providerUsageLimitRole ? {providerUsageLimitRole} : {}),
                                ...(planningQuestion ? {planningQuestion} : {}), ...currentWait});
                        }
                    }
                }
                visit(assignment.target, [...path, hop], root, firstHop ?? assignment.id, waitingHere);
            } catch { /* Unknown authority supplies no descendant facts. */ }
        }
    };
    visit(conversationId, [], undefined, undefined, !scoped);
    if (Object.keys(coordinatorRoutes).length) result.descendantCoordinatorRoutes = coordinatorRoutes;
    if (failures.size && descendantSearchBounded) result.omitted = true;
    return {entries, omitted:result.omitted || descendantSearchBounded};
}

export function inspectCoordinatorDescendantRecovery(s: Store, firstAssignmentId: string, reader: PublicationReader) {
    if (reader.identity.launchId !== null) return;
    const report = collectRecordedDescendantFailures(s, reader.identity.conversationId, {entries:[], omitted:false, unavailable:false},
        {reader, firstAssignmentId});
    return report.entries.length || report.omitted ? report : undefined;
}

export function inspectRecordedDelegatedResults(s: Store, conversationId: string): RecordedDelegatedResults {
    const result = directRecordedDelegatedResults(s, conversationId);
    collectRecordedDescendantFailures(s, conversationId, result);
    const waitStops = new Map<string, AcceptedWait['targets'][number]>();
    const continuationFailures = new Map<string, DescendantContinuationFailure>();
    const unavailable = () => { result.waitReviewUnavailable = true; };
    for (const branch of acceptedOrdinaryWaitTargets(s, conversationId, unavailable)) {
        const hop = branch.path.at(-1), failure = branch.wait.continuationFailure;
        if (hop && failure && !continuationFailures.has(hop.assignmentId)) {
            if (continuationFailures.size < 4)
                continuationFailures.set(hop.assignmentId, {assignmentId:hop.assignmentId,
                    conversationId:branch.wait.conversationId, workId:branch.wait.workId,
                    reason:failure.reason, proof:hash([branch.path, failure.proof])});
            else result.omitted = true;
        }
        if (!branch.path.length || !descendantWaitStop(branch.target) || waitStops.has(branch.target.assignmentId)) continue;
        if (waitWorkProof(s, branch.wait, branch.target, branch.actor, conversationId, branch.path)) {
            if (waitStops.size < 4) waitStops.set(branch.target.assignmentId, branch.target);
            else result.omitted = true;
        } else if (scopedWaitTarget(s, conversationId, branch.wait, branch.target, branch.actor, branch.path, 'change')) unavailable();
    }
    if (waitStops.size) result.descendantWaitStops = [...waitStops.values()];
    if (continuationFailures.size) result.descendantContinuationFailures = [...continuationFailures.values()];
    return result;
}

export interface ConversationRequestFailure {
    conversationId: string;
    workId: string;
    runId: string;
    resultId: string;
    limit: number;
    cleanup: string;
    failure?: string;
    relatedWorkIds: string[];
    relatedWorkIncomplete: boolean;
}

/** Navigation from actual successful host receipts; not assignment or execution authority. */
function referencedAssignmentWork(s: Store, runId: string, projectIds: readonly string[]) {
    const relatedWorkIds: string[] = [], seen = new Set<string>();
    let relatedWorkIncomplete = false, bytes = 0;
    const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(value);
    try {
        if (s.one('SELECT id FROM observations WHERE run=? AND NOT json_valid(data) LIMIT 1', runId)) relatedWorkIncomplete = true;
        const rows = s.all(`SELECT CASE WHEN length(CAST(data AS BLOB))<=16384 THEN data ELSE NULL END AS data
            FROM observations WHERE run=? AND CASE WHEN json_valid(data) THEN
                json_extract(data,'$.type')='tool_execution_end' AND
                (json_extract(data,'$.toolName')='conversation_assign' OR json_extract(data,'$.toolName') IS NULL) ELSE 0 END
            ORDER BY rowid DESC LIMIT 33`, runId);
        if (rows.length > 32) relatedWorkIncomplete = true;
        for (const row of rows.slice(0, 32)) {
            if (!row.data || (bytes += Buffer.byteLength(row.data)) > 65536) { relatedWorkIncomplete = true; continue; }
            try {
                const event = parseUniqueJson(row.data) as any;
                if (event.toolName !== 'conversation_assign' || typeof event.isError !== 'boolean') { relatedWorkIncomplete = true; continue; }
                if (event.isError) continue;
                const content = event.result?.content;
                if (typeof event.toolCallId !== 'string' || !event.toolCallId || event.toolCallId.length > 512 || !Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text' || typeof content[0].text !== 'string') throw Error('Unsupported receipt');
                const receipt = parseUniqueJson(content[0].text) as any;
                if (!receipt || typeof receipt !== 'object' || typeof receipt.accepted !== 'boolean' || !identity(receipt.assignmentId) || !identity(receipt.conversationId)) throw Error('Unsupported assignment pointer');
                const assignment = s.one('SELECT * FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                if (!assignment || assignment.target !== receipt.conversationId || !identity(assignment.work) || receipt.workId !== undefined && receipt.workId !== assignment.work) throw Error('Changed assignment pointer');
                const data = parse(assignment.data), work = s.one('SELECT project,data FROM works WHERE id=?', assignment.work), actor = data.source;
                if (!work || !projectIds.includes(work.project) || data.projectId !== work.project || !actor || actor.launchId !== null ||
                    !identity(actor.conversationId) || actor.conversationId !== assignment.source_conversation || !identity(actor.workId) || !identity(actor.runId) ||
                    !identity(actor.initialInputId) || !Number.isSafeInteger(actor.generation) || actor.generation < 1 ||
                    !Number.isSafeInteger(actor.directionRevision) || actor.directionRevision < 0) throw Error('Original assignment source unavailable');
                const owned = parse(work.data);
                if (owned.conversation !== assignment.target ||
                    (owned.kind === 'governed-change' ? owned.invocation?.assignmentId !== assignment.id || hash(owned.invocation.actor) !== hash(actor)
                        : owned.kind !== 'ordinary-conversation' || owned.assignmentId !== assignment.id)) throw Error('Work is not bound to original assignment');
                const source = s.one('SELECT conversation,origin,raw FROM sources WHERE id=?', data.instructionsSource), input = s.one('SELECT conversation,source,text FROM conversation_inputs WHERE id=?', data.inputId);
                if (!source || !input || source.conversation !== assignment.target || input.conversation !== assignment.target || input.source !== data.instructionsSource || input.text !== source.raw) throw Error('Original instructions unavailable');
                const origin = parse(source.origin);
                if (origin.kind !== 'agent-assignment' || origin.event !== assignment.id || hash(origin.actor) !== hash(actor)) throw Error('Original actor changed');
                const originalRun = s.one(`SELECT work,json_extract(data,'$.kind') AS kind,json_extract(data,'$.conversation') AS conversation,
                    json_extract(data,'$.initialInputId') AS inputId,json_extract(data,'$.nativeSessionId') AS nativeSessionId
                    FROM runs WHERE id=?`, actor.runId);
                const originalInput = s.one('SELECT conversation,work,generation FROM conversation_inputs WHERE id=?', actor.initialInputId);
                if (!originalRun || originalRun.work !== actor.workId || originalRun.kind !== 'ordinary-conversation' || originalRun.conversation !== actor.conversationId ||
                    originalRun.inputId !== actor.initialInputId || !identity(originalRun.nativeSessionId) || !originalInput || originalInput.conversation !== actor.conversationId ||
                    originalInput.work !== actor.workId || originalInput.generation !== actor.generation) throw Error('Original native actor tuple changed');
                if (!seen.has(assignment.work)) {
                    if (relatedWorkIds.length >= 8) { relatedWorkIncomplete = true; continue; }
                    seen.add(assignment.work); relatedWorkIds.push(assignment.work);
                }
            } catch { relatedWorkIncomplete = true; }
        }
    } catch { relatedWorkIncomplete = true; }
    return { relatedWorkIds, relatedWorkIncomplete };
}
/** Owner display of an exact current host observation, never a generated assistant answer. */
export function inspectConversationRequestFailure(s: Store, conversationId: string): ConversationRequestFailure | null {
    try {
        const current = s.one(`SELECT c.project,c.generation,c.history,s.work,s.native_id,s.resource,s.direction,s.archived,s.data
            FROM conversations c JOIN conversation_state s ON s.conversation=c.id WHERE c.id=?`, conversationId);
        if (!current || current.archived || !['IDLE', 'UNKNOWN'].includes(current.resource)) return null;
        const state = parse(current.data);
        if (state.lifecycle?.deleted) return null;
        const run = s.one('SELECT * FROM runs WHERE id=? AND work=?', state.runId ?? '', current.work);
        if (!run || !['SETTLED', 'UNKNOWN'].includes(run.phase) || run.reservation !== 'consumed') return null;
        const data = parse(run.data);
        if (data.kind !== 'ordinary-conversation' || data.conversation !== conversationId || data.manualAction !== undefined || data.outcome !== 'unavailable') return null;
        const observations = s.all("SELECT data FROM observations WHERE run=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='ordinary-request-limit' ELSE 0 END ORDER BY rowid LIMIT 2", run.id);
        if (observations.length !== 1) return null;
        const observed = parseUniqueJson(observations[0].data) as Record<string, any>;
        if (observed?.kind !== 'ordinary-request-limit' || !Number.isSafeInteger(observed.limit) || observed.limit < 1 || observed.inputId !== data.initialInputId ||
            observed.generation !== current.generation || observed.directionRevision !== current.direction ||
            observed.nativeSessionId !== data.nativeSessionId || current.native_id !== data.nativeSessionId ||
            current.history !== data.historyRef) return null;
        const work = s.one('SELECT * FROM works WHERE id=?', run.work), input = s.one('SELECT * FROM conversation_inputs WHERE id=?', data.initialInputId);
        if (!work || !['ACTIVE', 'UNKNOWN'].includes(work.state) || work.project !== current.project || work.epoch !== run.epoch || work.generation !== run.generation ||
            !input || input.conversation !== conversationId || input.work !== run.work || input.generation !== current.generation || input.state !== 'CONSUMED' ||
            input.source !== observed.sourceId || input.text !== data.raw) return null;
        const owner = parse(work.data);
        if (owner.kind !== 'ordinary-conversation' || owner.conversation !== conversationId) return null;
        const captured = inspectCapturedInputSource(s, input.id);
        if (hash(captured.value ?? null) !== hash(data.inputContext ?? null)) return null;
        const source = s.one('SELECT conversation,raw FROM sources WHERE id=?', input.source);
        if (!source || source.conversation !== conversationId || (!captured.value && source.raw !== input.text) ||
            hash(projectProtection(s, current.project)) !== hash(data.projectProtection) ||
            s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND id!=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') LIMIT 1", conversationId, input.id)) return null;
        const resultId = 'result-' + hash([conversationId, ['ordinary-run', run.id]]), publication = inspectConversationResult(s, resultId), result = publication.result;
        if (publication.conversationId !== conversationId || publication.workId !== run.work || result?.conversationId !== conversationId || result.workId !== run.work ||
            result.runId !== run.id || result.status !== 'unavailable' || result.cleanup !== data.cleanup || result.requestLimit?.limit !== observed.limit ||
            result.answer?.state === 'delivered' || result.coordinatorReport?.state === 'delivered' || publication.publicationHash !== hash(result)) return null;
        return { conversationId, workId: run.work, runId: run.id, resultId, limit: observed.limit, cleanup: result.cleanup,
            ...(typeof result.failure === 'string' ? { failure: result.failure } : {}),
            ...referencedAssignmentWork(s, run.id, Array.isArray(owner.delegation?.projectIds) ? owner.delegation.projectIds : []) };
    } catch { return null; } // Missing, changed or unsupported provenance is not a current display fact.
}

/** A named coordinator read may diagnose only its own current ordinary assignment. */
export function inspectOrdinaryAssignmentRecovery(s: Store, assignment: {id: string; target: string; work: string | null; data: string},
    resultId: string, reader: PublicationReader) {
    try {
        const original = boundedPublication(s, assignment, resultId);
        const data = parseUniqueJson(assignment.data) as any;
        const source = data?.source;
        if (data?.operation !== 'investigate' || data.contextAssignment || data.contextReentry ||
            source?.conversationId !== reader.identity.conversationId || source.workId !== reader.identity.workId ||
            data.delegationRoot !== reader.delegation.rootWorkId || currentAssignmentResultId(data) !== resultId) return;
        if (!original) return {kind:'current-result-unreadable' as const};
        const publication = publicationView(s, original, parseUniqueJson(original.data) as any, reader);
        const result = publication.result;
        if (publication.assignmentId !== assignment.id || publication.workId !== assignment.work || publication.conversationId !== assignment.target ||
            publication.projectId !== data.projectId || result?.status !== 'unavailable' ||
            result.conversationId !== assignment.target || result.workId !== assignment.work ||
            typeof result.runId !== 'string' || resultId !== 'result-' + hash([assignment.target, ['ordinary-run', result.runId]]))
            return {kind:'current-result-unreadable' as const};
        const hasHostMarker = s.one(`SELECT 1 FROM observations o JOIN runs r ON r.id=o.run AND r.work=?
            WHERE o.run=? AND CASE WHEN json_valid(o.data) THEN json_extract(o.data,'$.kind')='ordinary-request-limit' END LIMIT 1`,
        assignment.work, result.runId);
        if (result.requestLimit === undefined && !hasHostMarker) return;
        // A host-cap result has no private delivered answer or report to redact.
        // Other assigned v2 results can legitimately differ from their full-outcome digest.
        if (publication.publicationHash !== hash(result)) return {kind:'current-result-unreadable' as const};
        const failure = inspectConversationRequestFailure(s, assignment.target);
        const unverified = {kind:'failure-cause-unverified' as const};
        if (!failure || failure.resultId !== resultId || failure.workId !== assignment.work ||
            !['removed','not-allocated','unbound'].includes(failure.cleanup)) return unverified;
        if (!originalOrdinaryAssignmentInput(s, assignment.id, assignment.target, failure.runId, data)) return unverified;
        return {kind:'local-model-request-limit' as const, limit:failure.limit};
    } catch { return {kind:'current-result-unreadable' as const}; }
}

function originalOrdinaryAssignmentInput(s: Store, assignmentId: string, target: string, runId: unknown,
    data: {inputId: string; instructionsSource: string; source: NativeIdentity}) {
    const actor = data.source;
    if (typeof runId !== 'string' || typeof data.inputId !== 'string' || typeof data.instructionsSource !== 'string' ||
        actor?.launchId !== null || typeof actor.runId !== 'string' || typeof actor.initialInputId !== 'string') return false;
    const input = s.one(`SELECT o.origin FROM runs r
        JOIN conversation_inputs i ON i.id=? AND i.work=r.work AND i.source=?
        JOIN sources o ON o.id=i.source AND o.conversation=i.conversation
        WHERE r.id=? AND i.conversation=? AND i.state='CONSUMED' AND json_valid(r.data) AND json_valid(i.data)
        AND length(CAST(o.origin AS BLOB))<=65536 AND json_valid(o.origin) AND json_extract(r.data,'$.initialInputId')=i.id
        AND json_extract(i.data,'$.assignment')=? AND json_extract(o.origin,'$.kind')='agent-assignment'
        AND json_extract(o.origin,'$.event')=?`, data.inputId, data.instructionsSource, runId, target, assignmentId, assignmentId);
    if (!input) return false;
    try {
        if (!sameNativeIdentity((parseUniqueJson(input.origin) as {actor?: NativeIdentity}).actor, actor)) return false;
        return !!s.one(`SELECT 1 FROM runs r JOIN conversation_inputs i ON i.id=? AND i.work=r.work
            WHERE r.id=? AND r.work=? AND i.conversation=? AND i.generation=? AND i.state='CONSUMED'
            AND CASE WHEN length(CAST(r.data AS BLOB))<=65536 AND json_valid(r.data) THEN
                json_extract(r.data,'$.kind')='ordinary-conversation'
                AND json_extract(r.data,'$.initialInputId')=i.id
                AND json_extract(r.data,'$.conversation')=i.conversation
                AND json_type(r.data,'$.attainedNative')='true' END`,
        actor.initialInputId, actor.runId, actor.workId, actor.conversationId, actor.generation);
    } catch { return false; }
}

function retainedBridgeProfileMismatch(s: Store, result: ConversationTurnResult, bindingJson: string | null) {
    const reason = nativeBridgeProfileMismatch(result.failure);
    if (!reason || reason !== result.bridgeProfileMismatch || !bindingJson) return;
    try {
        const binding = captureOrdinaryRoleBinding(parseUniqueJson(bindingJson));
        const provider = binding.mode.kind === 'application' ? binding.mode.baseline.choice.provider : binding.mode.provider;
        if (binding.sourceRunId !== result.runId || binding.conversationId !== result.conversationId || provider !== 'claude-bridge') return;
        const rows = s.all(`SELECT CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data END AS data FROM observations WHERE run=?
            AND CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='native-terminal-unavailable' ELSE 0 END LIMIT 2`, result.runId);
        if (rows.length !== 1 || !rows[0].data) return;
        const observed = parseUniqueJson(rows[0].data) as Record<string, unknown>;
        if (observed?.stopReason === 'error' && observed.errorMessage === result.failure) return reason;
    } catch { /* The generic original diagnostic remains available. */ }
}

// All three restored outcomes are facts about the same settled owner request.
const settledOwnerResponseSource = `FROM conversations c JOIN conversation_state st ON st.conversation=c.id
    JOIN runs r ON r.id=json_extract(st.data,'$.runId') AND r.work=st.work
    JOIN works w ON w.id=r.work AND w.epoch=r.epoch AND w.generation=r.generation AND w.project IS c.project
    JOIN conversation_inputs i ON i.id=json_extract(r.data,'$.initialInputId') AND i.conversation=c.id
        AND i.work=r.work AND i.generation=c.generation
    JOIN sources src ON src.id=i.source AND src.conversation=c.id`;
const settledOwnerResponseIdentity = `c.id=? AND st.resource='IDLE' AND st.archived=0
    AND COALESCE(json_extract(st.data,'$.lifecycle.deleted'),0)=0 AND json_extract(st.data,'$.role') IS NULL
    AND r.phase='SETTLED' AND json_extract(r.data,'$.kind')='ordinary-conversation' AND json_extract(r.data,'$.conversation')=c.id
    AND json_type(r.data,'$.manualAction') IS NULL AND w.state='ACTIVE'
    AND json_extract(w.data,'$.kind')='ordinary-conversation' AND json_extract(w.data,'$.conversation')=c.id
    AND json_extract(w.data,'$.assignmentId') IS NULL AND i.mode<>'manual' AND i.text=json_extract(r.data,'$.raw')
    AND json_extract(src.origin,'$.kind')='owner-conversation-input'`;

/** Read the current settled interruption and its exact requeued input, without granting recovery. */
export function inspectRetainedConversationInterruption(s: Store, conversationId: string) {
    try {
        const row = s.one(`SELECT r.id AS runId,r.work AS workId,json_extract(r.data,'$.cleanup') AS cleanup
            ${settledOwnerResponseSource}
            JOIN conversation_directions d ON d.conversation=c.id AND d.revision=st.direction AND d.source=i.source
                AND json_extract(d.data,'$.inputId')=i.id
            WHERE ${settledOwnerResponseIdentity}
                AND r.reservation IN ('consumed','released')
                AND json_extract(r.data,'$.outcome')='interrupted'
                AND json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','unbound')
                AND i.state='QUEUED' AND json_extract(i.data,'$.interruptedRun')=r.id
                AND json_type(i.data,'$.assignment') IS NULL AND json_type(i.data,'$.goalId') IS NULL`, conversationId);
        return row ? {status: 'interrupted' as const, cleanup: row.cleanup as string, workId: row.workId as string, runId: row.runId as string} : undefined;
    } catch { return undefined; }
}

function readRetainedOrdinaryPublication(s: Store, conversationId: string,
    current: { project: string | null; runId: string; workId: string; cleanup: string },
    status: 'delivered' | 'unavailable'): ConversationTurnResult | undefined {
    const resultId = 'result-' + hash([conversationId, ['ordinary-run', current.runId]]);
    const row = s.one(`SELECT data FROM conversation_results WHERE id=? AND conversation=? AND work=?
        AND length(CAST(data AS BLOB))<=?`, resultId, conversationId, current.workId, coordinationBytes);
    if (!row) return;
    const publication = parseUniqueJson(row.data) as any, result = publication?.result;
    if (publication?.version === 1 && publication.assignmentId === null && publication.projectId === current.project &&
        result?.conversationId === conversationId && result.workId === current.workId && result.runId === current.runId &&
        result.status === status && result.cleanup === current.cleanup && publication.publicationHash === hash(result))
        return result as ConversationTurnResult;
}

/** Display only the current clean owner response and its actual publication. */
export function inspectRetainedConversationCompletion(s: Store, conversationId: string) {
    try {
        const current = s.one(`SELECT c.project,c.generation,st.direction AS directionRevision,latest.id AS directionInputId,
            r.id AS runId,r.work AS workId,json_extract(r.data,'$.cleanup') AS cleanup
            ${settledOwnerResponseSource}
            JOIN conversation_directions d ON d.conversation=c.id AND d.revision=st.direction
            JOIN conversation_inputs latest ON latest.id=json_extract(d.data,'$.inputId') AND latest.source=d.source
                AND latest.conversation=c.id AND latest.work=r.work AND latest.generation=c.generation AND latest.state='CONSUMED'
            JOIN sources owner ON owner.id=latest.source AND owner.conversation=c.id
            WHERE ${settledOwnerResponseIdentity}
                AND r.reservation='consumed'
                AND json_type(r.data,'$.nativeUserBashAttempted') IS NULL
                AND json_extract(r.data,'$.outcome')='delivered' AND json_extract(r.data,'$.cleanup') IN ('removed','unbound')
                AND json_extract(r.data,'$.attainedNative')=1 AND json_extract(r.data,'$.modelDispatchAttempted')=1
                AND c.history=json_extract(r.data,'$.historyRef') AND st.native_id=json_extract(r.data,'$.nativeSessionId')
                AND i.state='CONSUMED'
                AND json_extract(owner.origin,'$.kind')='owner-conversation-input'
                AND json_type(i.data,'$.assignment') IS NULL AND json_type(i.data,'$.goalId') IS NULL
                AND json_type(latest.data,'$.assignment') IS NULL AND json_type(latest.data,'$.goalId') IS NULL
                AND (latest.id=i.id OR (latest.mode IN ('steer','follow-up')
                    AND json_extract(d.data,'$.affectedRunId')=r.id
                    AND json_type(r.data,'$.routedInputs')='array'
                    AND EXISTS (SELECT 1 FROM json_each(r.data,'$.routedInputs') route
                        WHERE json_extract(route.value,'$.inputId')=latest.id AND json_extract(route.value,'$.sourceId')=latest.source
                            AND json_extract(route.value,'$.generation')=latest.generation)))
                AND NOT EXISTS (SELECT 1 FROM conversation_inputs pending WHERE pending.conversation=c.id
                    AND pending.state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED'))`, conversationId);
        if (!current || !readRetainedOrdinaryPublication(s, conversationId, current, 'delivered')) return;
        const direction = inspectCapturedInputSource(s, current.directionInputId);
        if (!direction.value && direction.row.text !== direction.row.source_raw) return;
        const { workId, runId, cleanup, generation, directionRevision } = current;
        return { status: 'delivered' as const, workId: workId as string, runId: runId as string, cleanup: cleanup as string,
            generation: generation as number, directionRevision: directionRevision as number };
    } catch { return undefined; }
}

/** Restore the current owner's original diagnostic, without a new failure record or action eligibility. */
export function inspectConversationResponseFailure(s: Store, conversationId: string) {
    try {
        const current = s.one(`SELECT c.project,r.id AS runId,r.work AS workId,json_extract(r.data,'$.cleanup') AS cleanup,
            CASE WHEN length(CAST(json_extract(r.data,'$.ordinaryRoleBinding') AS BLOB))<=4096
                THEN json_extract(r.data,'$.ordinaryRoleBinding') END AS binding
            ${settledOwnerResponseSource}
            JOIN conversation_directions d ON d.conversation=c.id AND d.revision=st.direction AND d.source=i.source
                AND json_extract(d.data,'$.inputId')=i.id
            WHERE ${settledOwnerResponseIdentity}
                AND r.reservation='consumed'
                AND json_extract(r.data,'$.outcome')='unavailable'
                AND json_extract(r.data,'$.cleanup') IN ('removed','not-allocated','unbound')
                AND i.state IN ('INITIAL_RESERVED','RECONCILIATION_REQUIRED','CONSUMED')
                AND NOT EXISTS (SELECT 1 FROM conversation_inputs other WHERE other.conversation=c.id AND other.id<>i.id
                    AND other.state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED'))`, conversationId);
        if (!current) return null;
        const result = readRetainedOrdinaryPublication(s, conversationId, current, 'unavailable');
        if (!result || result.answer?.state === 'delivered' || result.coordinatorReport?.state === 'delivered' ||
            typeof result.failure !== 'string' || !result.failure.trim() || result.failure.length > 4096) return null;
        const mismatch = retainedBridgeProfileMismatch(s, result, current.binding);
        return { workId: current.workId as string, runId: current.runId as string, cleanup: current.cleanup as string,
            failure: result.failure as string, ...(mismatch ? { bridgeProfileMismatch: mismatch } : {}) };
    } catch { return null; }
}

/** Read the current original pre-dispatch failure without repeating its work. */
export function inspectConversationStartupFailure(s: Store, conversationId: string) {
    try {
        const current = s.one(`SELECT c.project,c.generation,s.work,s.direction,s.data FROM conversations c
            JOIN conversation_state s ON s.conversation=c.id WHERE c.id=? AND s.resource='IDLE' AND s.archived=0`, conversationId);
        if (!current?.project || !current.work) return null;
        const state = parse(current.data);
        if (state.role || state.lifecycle?.deleted) return null;
        const run = s.one("SELECT * FROM runs WHERE id=? AND work=? AND phase='SETTLED' AND reservation='consumed'", state.runId ?? '', current.work);
        if (!run) return null;
        const data = parse(run.data);
        if (data.kind !== 'ordinary-conversation' || data.conversation !== conversationId || data.manualAction !== undefined ||
            data.outcome !== 'unavailable' || !['not-allocated', 'removed'].includes(data.cleanup) || data.allocatedNative || data.nativePromptAttempted || data.modelDispatchAttempted) return null;
        const work = s.one("SELECT * FROM works WHERE id=? AND project=? AND state='ACTIVE' AND epoch=? AND generation=?", run.work, current.project, run.epoch, run.generation);
        const owner = work && parse(work.data);
        if (owner?.kind !== 'ordinary-conversation' || owner.conversation !== conversationId || owner.assignmentId) return null;
        const input = s.one(`SELECT i.*,src.conversation AS sourceConversation,src.origin AS sourceOrigin,src.raw AS sourceRaw
            FROM conversation_inputs i JOIN sources src ON src.id=i.source
            JOIN conversation_directions d ON d.conversation=i.conversation AND d.source=i.source AND d.revision=?
                AND json_extract(d.data,'$.inputId')=i.id
            WHERE i.id=? AND i.conversation=? AND i.work=? AND i.generation=? AND i.state IN ('INITIAL_RESERVED','RECONCILIATION_REQUIRED')`,
            current.direction, data.initialInputId, conversationId, run.work, current.generation);
        if (!input || input.mode === 'manual' || input.sourceConversation !== conversationId || input.text !== data.raw ||
            parse(input.sourceOrigin).kind !== 'owner-conversation-input') return null;
        const captured = inspectCapturedInputSource(s, input.id);
        if (hash(captured.value ?? null) !== hash(data.inputContext ?? null) || (!captured.value && input.sourceRaw !== input.text) ||
            s.one("SELECT id FROM conversation_inputs WHERE conversation=? AND id!=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') LIMIT 1", conversationId, input.id)) return null;
        const rows = s.all(`SELECT CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data END AS data FROM observations WHERE run=?
            AND CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='ordinary-response-unavailable' ELSE 0 END LIMIT 2`, run.id);
        if (rows.length !== 1 || !rows[0].data) return null;
        const observed = parseUniqueJson(rows[0].data) as { unsupportedCaptureLink?: unknown; runtimeHelperUnavailable?: unknown; error?: unknown };
        if (typeof observed?.error !== 'string') return null;
        const resultId = 'result-' + hash([conversationId, ['ordinary-run', run.id]]), publication = inspectConversationResult(s, resultId), result = publication.result;
        if (publication.conversationId !== conversationId || publication.workId !== run.work || publication.publicationHash !== hash(result) ||
            result?.conversationId !== conversationId || result.workId !== run.work || result.runId !== run.id || result.status !== 'unavailable' ||
            result.cleanup !== data.cleanup || result.failure !== observed.error.slice(0, 4096) ||
            result.answer?.state === 'delivered' || result.coordinatorReport?.state === 'delivered') return null;
        const original = { workId: run.work as string, runId: run.id as string, failure: result.failure as string };
        const entry = observed.unsupportedCaptureLink;
        if (data.cleanup === 'not-allocated' && unsupportedProjectLinkEntry(entry) && result.unsupportedCaptureLink === entry &&
            observed.runtimeHelperUnavailable === undefined && result.runtimeHelperUnavailable === undefined && result.missingRuntimeContext === undefined)
            return { ...original, kind: 'capture-link' as const, entry };
        if (data.cleanup === 'removed' && observed.runtimeHelperUnavailable === true && result.runtimeHelperUnavailable === true &&
            entry === undefined && result.unsupportedCaptureLink === undefined && result.missingRuntimeContext === undefined)
            return { ...original, kind: 'runtime-helper' as const };
        const context = result.missingRuntimeContext;
        if (data.cleanup === 'removed' && typeof context === 'string' && context === data.runtimeProfile?.dockerContext &&
            entry === undefined && result.unsupportedCaptureLink === undefined &&
            observed.runtimeHelperUnavailable === undefined && result.runtimeHelperUnavailable === undefined) {
            const prefix = String(new MissingDockerContextError(context, ''));
            if (observed.error.startsWith(prefix) && missingDockerContextRoute(observed.error.slice(prefix.length), {
                context, dockerConfigDirectory: data.runtimeProfile.dockerConfigDirectory,
            })) return { ...original, kind: 'runtime-context' as const, context };
        }
        return null;
    } catch { return null; }
}

/** The immutable publication grants the scope; a digest alone never grants file access. */
export async function inspectConversationResultDetail(s: Store, home: string, request: { resultId: string; cursor?: number; fingerprint?: string }, reader?: Parameters<typeof inspectConversationResult>[2], validate: () => void = () => {}) {
    const captured = inspectConversationResult(s, request.resultId, reader), fingerprint = hash(captured);
    const original = s.one('SELECT id,conversation,work FROM conversation_results WHERE id=?', request.resultId);
    const result = captured.result;
    if (!original || captured.workId !== original.work || captured.conversationId !== original.conversation ||
        result?.kind !== 'governed-work-observation/v1' || result.workId !== original.work || !result.detailRef)
        throw Error('Original governed detail reference unavailable');
    if (captured.resultId !== request.resultId || captured.publicationHash !== hash(result) ||
        original.id !== 'result-' + hash([original.conversation, ['structured', captured.assignmentId, result]]))
        throw Error('Original governed publication integrity unavailable');
    const guard = () => {
        validate();
        if (hash(inspectConversationResult(s, request.resultId, reader)) !== fingerprint) throw Error('Original result scope or content changed');
    };
    guard();
    const cursor = request.cursor ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= result.detailRef.bytes || request.fingerprint !== result.detailRef.sha256)
        throw Error('Governed detail fingerprint or UTF-8 cursor mismatch');
    const bytes = await readGovernedDetail(home, result.detailRef, guard);
    guard();
    const full = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (full.workId !== result.workId || full.epoch !== result.epoch || full.phase !== result.phase || full.reviewReady !== result.reviewReady)
        throw Error('Governed detail publication correspondence differs');
    if (cursor >= bytes.length || (bytes[cursor]! & 0xc0) === 0x80)
        throw Error('Governed detail fingerprint or UTF-8 cursor mismatch');
    let end = Math.min(bytes.length, cursor + 4096);
    for (;;) {
        while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
        const page = { kind: 'governed-work-detail-page/v1', resultId: request.resultId, fingerprint: result.detailRef.sha256,
            bytes: bytes.length, cursor, nextCursor: end === bytes.length ? null : end, encoding: 'utf8', text: bytes.subarray(cursor, end).toString('utf8') };
        if (Buffer.byteLength(JSON.stringify(page)) <= 8 * 1024) return page;
        end = cursor + Math.floor((end - cursor) * 0.75);
        if (end <= cursor) throw Error('Governed detail page envelope unavailable');
    }
}

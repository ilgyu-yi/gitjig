import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { NativeIdentity } from './interaction-types.js';
import type { Delegation } from './coordination.js';
import { coordinatorReportCurrent } from './coordinator-report.js';
import { readGovernedDetail } from './governed-result.js';
export const coordinationBytes = 128 * 1024;
const parse = (s: string) => JSON.parse(s);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type ConversationNotice = {
    kind: 'result-ready' | 'parent-changed' | 'owner-direction-changed';
    eventKey: string;
    conversationId: string;
    [key: string]: unknown;
};
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
            ...metadata, status: metadata.status === 'delivered' && report?.state === 'delivered' ? 'delivered' : 'unavailable', ...(report ? { coordinatorReport: report } : {}), ...(!report ? { failure: 'COORDINATOR_REPORT_REQUIRED: submit an English conversation_report before the final human reply' } : {})
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
export function inspectConversationResult(s: Store, resultId: string, reader?: {
    identity: NativeIdentity;
    delegation: Delegation;
}) {
    const row = s.one('SELECT * FROM conversation_results WHERE id=?', resultId);
    if (!row)
        throw Error('Result unavailable or outside captured scope');
    const data = parse(row.data);
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

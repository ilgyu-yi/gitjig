import { createHash } from 'node:crypto';

/** Native transport projection only. The scoped controller read remains authoritative. */
export const nativeResultBytes = 8 * 1024;
const fullResultBytes = 128 * 1024;
export interface ResultRead {
    resultId: string;
    detail?: 'governed-work-detail/v1';
    cursor?: number;
    fingerprint?: string;
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function nativeConversationResult(value: unknown, request: ResultRead): string {
    if (request.detail) {
        const page = record(value), encoded = JSON.stringify(value);
        if (page.kind !== 'governed-work-detail-page/v1' || page.resultId !== request.resultId || Buffer.byteLength(encoded) > nativeResultBytes)
            throw Error('Governed detail page unavailable');
        return encoded;
    }
    const body = JSON.stringify(value);
    if (typeof body !== 'string' || Buffer.byteLength(body) > fullResultBytes)
        throw new Error('Coordination result unavailable: JSON output exceeds128KiB or is undefined');
    const source = Buffer.from(body);
    const fingerprint = createHash('sha256').update(source).digest('hex');
    const paged = request.cursor !== undefined || request.fingerprint !== undefined;
    if (paged) {
        const offset = request.cursor;
        if (!Number.isSafeInteger(offset) || offset! < 0 || offset! >= source.length ||
            typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint) || request.fingerprint !== fingerprint ||
            (source[offset!]! & 0xc0) === 0x80)
            throw new Error('Result page unavailable: fingerprint or UTF-8 cursor mismatch');
        let end = Math.min(source.length, offset! + nativeResultBytes);
        while (end < source.length && (source[end]! & 0xc0) === 0x80) end--;
        for (;;) {
            const page = { kind: 'conversation-result-page/v1', resultId: request.resultId, fingerprint, bytes: source.length,
                cursor: offset, nextCursor: end === source.length ? null : end, encoding: 'utf8', hashAlgorithm: 'sha256', text: source.subarray(offset!, end).toString('utf8') };
            const encoded = JSON.stringify(page);
            if (Buffer.byteLength(encoded) <= nativeResultBytes) return encoded;
            end = offset! + Math.floor((end - offset!) * 0.75);
            while (end > offset! && (source[end]! & 0xc0) === 0x80) end--;
            if (end <= offset!) throw new Error('Result page unavailable: envelope exceeds native bound');
        }
    }
    if (source.length <= nativeResultBytes) return body;
    const publication = record(JSON.parse(body)), result = record(publication.result);
    const compact = result.kind === 'governed-work-observation/v1', recordedOmissions = record(result.omitted);
    const omitted = (key: string) => compact && Number.isSafeInteger(recordedOmissions[key]) && Number(recordedOmissions[key]) >= 0 ? Number(recordedOmissions[key]) : 0;
    const blockerCount = (Array.isArray(result.blocked) ? result.blocked.length : 0) + omitted('blocked');
    const summary = {
        kind: 'conversation-result-summary/v1', resultId: request.resultId,
        conversationId: publication.conversationId ?? null, workId: publication.workId ?? null,
        assignmentId: publication.assignmentId ?? null, previous: publication.previous ?? null,
        publicationHash: publication.publicationHash ?? null,
        result: { phase: result.phase ?? null, epoch: result.epoch ?? null, reviewReady: result.reviewReady ?? null,
            ...(result.kind === 'governed-work-observation/v1' && record(result.detailRef).kind === 'governed-work-detail/v1' &&
                /^[a-f0-9]{64}$/.test(String(record(result.detailRef).sha256)) && bytes(result.detailRef) < 256
                && Number.isSafeInteger(record(result.detailRef).bytes) && Number(record(result.detailRef).bytes) > 0 && Number(record(result.detailRef).bytes) <= 16 * 1024 * 1024
                ? {detailRef: result.detailRef, detailRead: {detail: 'governed-work-detail/v1', fingerprint: record(result.detailRef).sha256, cursor: 0}} : {}),
            outcome: {} as Record<string, unknown>, blockerCount, blocked: [] as unknown[], nextAction: null as unknown },
        omitted: { outcomeFields: ['status', 'failure', 'cleanup', 'coordinatorReport'].filter(key => Object.hasOwn(result, key)), blocked: blockerCount, nextAction: result.nextAction === undefined && !omitted('nextAction') ? 0 : 1,
            ...(compact ? {observationFields: {blocked: omitted('blocked'), nextAction: omitted('nextAction'), checkIds: omitted('checkIds'), reviewLaunchIds: omitted('reviewLaunchIds')}} : {}),
            publicationFields: Object.keys(publication).filter(key => !['resultId', 'conversationId', 'workId', 'assignmentId', 'previous', 'publicationHash', 'result'].includes(key)).length,
            resultFields: Object.keys(result).filter(key => !['phase', 'epoch', 'reviewReady', 'blocked', 'nextAction', 'status', 'failure', 'cleanup', 'coordinatorReport'].includes(key)).length },
        fullJSON: { fingerprint, hashAlgorithm: 'sha256', bytes: source.length, cursor: 0, encoding: 'utf8', instruction: 'Call conversation_result with the same resultId, fingerprint and cursor. Concatenate page text in cursor order for the exact full JSON; omissions are not successful evidence.' },
    };
    if (bytes(summary) > nativeResultBytes) throw new Error('Result summary unavailable: identity envelope exceeds native bound');
    if (result.nextAction !== undefined && !omitted('nextAction')) {
        summary.result.nextAction = result.nextAction;
        summary.omitted.nextAction = 0;
        if (bytes(summary) > nativeResultBytes) { summary.result.nextAction = null; summary.omitted.nextAction = 1; }
    }
    if (Array.isArray(result.blocked)) for (const entry of result.blocked) {
        summary.result.blocked.push(entry); summary.omitted.blocked--;
        if (bytes(summary) > nativeResultBytes) { summary.result.blocked.pop(); summary.omitted.blocked++; break; }
    }
    for (const key of [...summary.omitted.outcomeFields]) {
        const report = record(result.coordinatorReport);
        summary.result.outcome[key] = key === 'coordinatorReport'
            ? { state: report.state ?? null, code: report.code ?? null,
                omittedFields: Object.keys(report).filter(field => !['state', 'code'].includes(field)).length }
            : result[key];
        summary.omitted.outcomeFields = summary.omitted.outcomeFields.filter(field => field !== key);
        if (bytes(summary) > nativeResultBytes) {
            delete summary.result.outcome[key]; summary.omitted.outcomeFields.push(key);
        }
    }
    return JSON.stringify(summary);
}

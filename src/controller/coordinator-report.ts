import { createHash } from 'node:crypto';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AnswerObservation, CoordinatorReportObservation } from './conversation-results.js';
import type { Store } from './store.js';
export interface CoordinatorReportDraft {
    text: string;
    toolCallId: string;
    nativeEntryId: string;
    inputEntryId: string;
    directionRevision: number;
}
type NativeEntry = ReturnType<SessionManager['getBranch']>[number];
type NativeMessageEntry = Extract<NativeEntry, {
    type: 'message';
}>;
function matchesReportCall(entry: NativeEntry | undefined, text: string, toolCallId: string): entry is NativeMessageEntry {
    return entry?.type === 'message' && entry.message.role === 'assistant' &&
        entry.message.content.some(content => content.type === 'toolCall' &&
            content.name === 'conversation_report' && content.id === toolCallId &&
            JSON.stringify(content.arguments) === JSON.stringify({ text }));
}
/** Synchronous final guard: asynchronous native/container cleanup can admit a newer owner direction. */
export function coordinatorReportCurrent(store: Store, conversation: string, report: CoordinatorReportObservation) {
    return store.one('SELECT direction FROM conversation_state WHERE conversation=?', conversation)?.direction === report.producer.directionRevision && !store.one("SELECT i.id FROM conversation_inputs i JOIN sources s ON s.id=i.source AND s.conversation=i.conversation WHERE i.conversation=? AND i.state IN ('QUEUED','NATIVE_PENDING') AND json_extract(s.origin,'$.kind')='owner-conversation-input' LIMIT 1", conversation);
}
/** Capture actual native authorship, not worker-supplied producer or run labels. */
export function captureCoordinatorReport(manager: SessionManager, text: string, toolCallId: string, directionRevision: number): CoordinatorReportDraft {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 64 * 1024)
        throw Error('Coordinator report requires nonempty English text of at most 64 KiB');
    const entries = manager.getBranch(), entry = entries.filter(e => e.type === 'message' && e.message.role === 'assistant').at(-1);
    if (!matchesReportCall(entry, text, toolCallId))
        throw Error('Coordinator report lacks the actual native tool-call entry');
    const input = entries.filter(e => e.type === 'message' && e.message.role === 'user').at(-1);
    if (!input)
        throw Error('Coordinator report lacks native input provenance');
    return { text, toolCallId, nativeEntryId: entry.id, inputEntryId: input.id, directionRevision };
}
export function collectCoordinatorReport(manager: SessionManager, draft: CoordinatorReportDraft | undefined, proof: AnswerObservation['producer'], directionRevision: number, pendingOwnerInput: boolean): CoordinatorReportObservation | undefined {
    if (!draft)
        return;
    const entries = manager.getBranch(), index = entries.findIndex(e => e.id === draft.nativeEntryId), input = entries.filter(e => e.type === 'message' && e.message.role === 'user').at(-1);
    const call = entries[index];
    const result = entries.slice(index + 1).find(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolCallId === draft.toolCallId);
    const producer = {
        ...proof, nativeEntryId: draft.nativeEntryId, toolCallId: draft.toolCallId, toolResultEntryId: result?.id ?? '', inputEntryId: draft.inputEntryId, directionRevision: draft.directionRevision
    };
    const currentCall = matchesReportCall(call, draft.text, draft.toolCallId);
    const currentInput = input?.id === draft.inputEntryId;
    const currentDirection = directionRevision === draft.directionRevision && !pendingOwnerInput;
    if (!currentCall || !currentInput || !currentDirection)
        return { kind: 'ordinary-coordinator-report/v1', state: 'unavailable', code: 'COORDINATOR_REPORT_STALE', producer };
    if (result?.type !== 'message' || result.message.role !== 'toolResult' || result.message.isError || JSON.stringify(result.message.content) !== JSON.stringify([{ type: 'text', text: JSON.stringify({ recorded: true }) }]))
        return { kind: 'ordinary-coordinator-report/v1', state: 'unavailable', code: 'COORDINATOR_REPORT_RECEIPT_UNAVAILABLE', producer };
    const text = [{ type: 'text' as const, text: draft.text }];
    return {
        kind: 'ordinary-coordinator-report/v1', state: 'delivered', producer, text, textSha256: createHash('sha256').update(JSON.stringify(text)).digest('hex')
    };
}

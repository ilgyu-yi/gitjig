import type { Store } from './store.js';

export type ConversationStage = 'capacity' | 'capture' | 'runtime' | 'session' | 'dispatch' | 'model';
export interface ConversationProgress {
    runId: string;
    initialInputId: string;
    stage: ConversationStage;
}

/** Current ordinary response only. These observations confer no execution authority. */
export function inspectConversationProgress(store: Store, conversationId: string): ConversationProgress | undefined {
    const stateData = "CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
    const runData = "CASE WHEN json_valid(r.data) THEN r.data ELSE '{}' END";
    const row = store.one(`SELECT r.id AS runId,r.phase,i.id AS initialInputId,
        json_extract(${runData},'$.nativePromptAttempted') AS prompted,
        json_extract(${runData},'$.modelDispatchAttempted') AS dispatched
        FROM conversation_state s JOIN conversations c ON c.id=s.conversation
        JOIN runs r ON r.id=json_extract(${stateData},'$.runId') AND r.work=s.work
        JOIN works w ON w.id=r.work AND w.epoch=r.epoch AND w.generation=r.generation
        JOIN conversation_inputs i ON i.id=json_extract(${runData},'$.initialInputId')
            AND i.conversation=s.conversation AND i.work=r.work AND i.generation=c.generation
        WHERE s.conversation=? AND s.resource IN ('QUEUED','RUNNING') AND w.state='ACTIVE'
            AND json_extract(${runData},'$.kind')='ordinary-conversation'
            AND json_extract(${runData},'$.conversation')=s.conversation
            AND json_extract(${runData},'$.manualAction') IS NULL AND i.mode!='manual'`, conversationId);
    if (!row) return;
    let stage: ConversationStage;
    switch (row.phase) {
        case 'WAITING_CAPACITY':
        case 'CREATED': stage = 'capacity'; break;
        case 'CAPTURING': stage = 'capture'; break;
        case 'CAPTURED':
        case 'RUNTIME_CREATING': stage = 'runtime'; break;
        case 'RUNNING': stage = row.dispatched === 1 ? 'model' : row.prompted === 1 ? 'dispatch' : 'session'; break;
        default: return;
    }
    return { runId: row.runId, initialInputId: row.initialInputId, stage };
}

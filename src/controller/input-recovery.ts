import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { lifecycleReasons } from './completed-resources.js';
function recoveryExplanation(eligible: boolean, interrupted: boolean, undispatched: boolean, holds: string[]): string {
    if (!eligible)
        return (undispatched ? 'Not dispatched to the model. Recovery is held by retained obligations.' : 'Delivery or producer state needs reconciliation.') +
            (holds.length ? ' Current holds: ' + holds.join('; ') + '.' : '') +
            ' This input cannot be safely retried or withdrawn here. Inspect /work and /error; do not submit a replacement.';
    if (interrupted)
        return 'The response was interrupted and the original input was requeued after cleanup. Retry can send it again with the retained history, original work and remaining allowance. Withdrawal keeps the earlier history and attempts and does not undo prior activity.';
    return 'Not dispatched to the model. Retry uses the original work and remaining allowance; withdrawal retains the original text and attempts.';
}
/** Read the original admission; cleanup alone never proves a native send absent. */
export function inspectPendingInputs(store: Store, conversationId: string) {
    const conversation = store.one('SELECT * FROM conversations WHERE id=?', conversationId);
    if (!conversation)
        throw Error('Unknown conversation');
    const inputs = store.all("SELECT * FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') ORDER BY rowid", conversationId);
    if (!inputs.length)
        return [];
    const state = store.one('SELECT * FROM conversation_state WHERE conversation=?', conversationId);
    const stateData = JSON.parse(state.data);
    const reasons = lifecycleReasons(store, conversationId).filter(reason => !reason.startsWith('input:'));
    const goal = store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", conversationId);
    const conversationRecoverable = !reasons.length && !goal && !state.archived &&
        !Object.hasOwn(stateData, 'role') && !stateData.lifecycle?.deleted;
    return inputs.map(input => {
        const source = store.one('SELECT * FROM sources WHERE id=?', input.source);
        const runs = store.all("SELECT * FROM runs WHERE json_extract(data,'$.initialInputId')=? ORDER BY rowid", input.id);
        const data = JSON.parse(input.data);
        const origin = source && JSON.parse(source.origin);
        const work = input.work ? store.one('SELECT * FROM works WHERE id=?', input.work) : null;
        const workData = work ? JSON.parse(work.data) : null;
        const interrupted = input.state === 'QUEUED' && runs.some(run => JSON.parse(run.data).outcome === 'interrupted');
        const safeRuns = runs.every(run => {
            const proof = JSON.parse(run.data);
            const cleanInterruption = input.state === 'QUEUED' && proof.outcome === 'interrupted';
            const undispatched = proof.outcome === 'unavailable' && !proof.nativePromptAttempted;
            return run.phase === 'SETTLED' && run.reservation !== 'reserved' &&
                proof.kind === 'ordinary-conversation' && proof.conversation === conversationId &&
                (undispatched || cleanInterruption) &&
                ['removed', 'not-allocated', 'unbound'].includes(proof.cleanup) &&
                !proof.nativeManualAttempted && !proof.nativeUserBashAttempted;
        });
        const recoverableAdmission = input.state === 'QUEUED' && input.generation === conversation.generation ||
            input.state === 'INITIAL_RESERVED' && runs.length > 0;
        // Dispatch evidence is separate from permission to retry or withdraw.
        const undispatched = input.state === 'INITIAL_RESERVED' && runs.length > 0 && safeRuns;
        const holds = reasons.slice(0, 16);
        if (goal)
            holds.push('unfinished goal:' + goal.id);
        const blockingWorkIds = [...new Set(reasons.filter(reason => reason.startsWith('governed:')).map(reason => reason.split(':')[1]!))].slice(0, 16);
        const eligible = !!(conversationRecoverable &&
            origin?.kind === 'owner-conversation-input' && source.conversation === conversationId &&
            !data.assignment && !data.goalId && input.mode !== 'manual' &&
            (!work || work.id === state.work && workData.kind === 'ordinary-conversation' &&
                !workData.assignmentId && !['CANCELLED', 'UNKNOWN'].includes(work.state)) &&
            recoverableAdmission && safeRuns);
        const fingerprint = createHash('sha256').update(JSON.stringify({ conversation, state, input, source, work, runs, reasons, goal })).digest('hex');
        const lastRun = runs.at(-1);
        const diagnostic = lastRun ? store.one("SELECT data FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-response-unavailable' ORDER BY rowid DESC LIMIT 1", lastRun.id) : null;
        const observedFailure = diagnostic ? JSON.parse(diagnostic.data).error : undefined;
        const failure = typeof observedFailure === 'string' && observedFailure ? observedFailure : typeof data.routeError === 'string' && data.routeError ? data.routeError : undefined;
        return {
            inputId: input.id as string,
            text: (source?.raw ?? input.text) as string | null,
            state: input.state as string,
            workId: input.work as string | null,
            runId: lastRun?.id as string | undefined,
            failure: failure?.slice(0, 4096),
            eligible,
            undispatched,
            blockingWorkIds,
            interrupted,
            fingerprint,
            explanation: recoveryExplanation(eligible, interrupted, undispatched, holds),
        };
    });
}

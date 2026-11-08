import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { lifecycleReasons, runResourceColumns, runResourcesSettled } from './completed-resources.js';
import { legacyInputHistory, retiredLegacyInputHistory } from './legacy-input-history.js';
import { queuedWaitContinuation } from './consumed-wait.js';
import { availableWorkAllowance } from './work-recovery.js';
import { projectProtection } from './protection.js';
import type { ProjectProtectionBinding } from './protection-types.js';

function protectionAdvanced(store: Store, projectId: string, original?: ProjectProtectionBinding) {
    if (!original || original.version !== 1 || !Number.isSafeInteger(original.revision) || original.revision < 0 ||
        typeof original.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(original.hash))
        return false;
    try {
        const current = projectProtection(store, projectId);
        if (current.revision <= original.revision || current.hash === original.hash || !current.sourceEventId)
            return false;
        const event = store.one('SELECT conversation,origin,raw FROM sources WHERE id=?', current.sourceEventId);
        if (!event || event.conversation !== null)
            return false;
        const origin = JSON.parse(event.origin);
        return origin.kind === 'owner-project-protection' && origin.uid === process.getuid?.() && origin.projectId === projectId &&
            origin.previousRevision === current.revision - 1 && event.raw === JSON.stringify({ protectedPaths: current.protectedPaths });
    } catch {
        // A changed epoch alone does not identify the cause of the hold.
        return false;
    }
}
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
export function inspectPendingInputs(store: Store, stateRoot: string, conversationId: string, workBusy: (workId: string) => boolean) {
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
    const execution = state.work ? store.one(`SELECT b.lim AS "limit",b.consumed,b.reserved
        FROM works w JOIN budgets b ON b.lineage=w.lineage AND b.kind='execution'
        WHERE w.id=? AND w.project IS ? AND json_extract(w.data,'$.kind')='ordinary-conversation'`, state.work, conversation.project) : undefined;
    const exhaustedWork = execution && availableWorkAllowance(execution) === 0 ? state.work as string : undefined;
    const holds = reasons.slice(0, 16);
    if (goal)
        holds.push('unfinished goal:' + goal.id);
    const blockingWorkIds = [...new Set(reasons.filter(reason => reason.startsWith('governed:')).map(reason => reason.split(':')[1]!))].slice(0, 16);
    return inputs.map(input => {
        const source = store.one('SELECT * FROM sources WHERE id=?', input.source);
        const runs = store.all("SELECT * FROM runs WHERE json_extract(data,'$.initialInputId')=? ORDER BY rowid", input.id);
        const data = JSON.parse(input.data);
        const origin = source && JSON.parse(source.origin);
        const work = input.work ? store.one('SELECT * FROM works WHERE id=?', input.work) : null;
        const workData = work ? JSON.parse(work.data) : null;
        const legacyHistory = legacyInputHistory(store, stateRoot, conversation, state, input, work, runs[0]);
        const canRetireLegacyHistory = typeof legacyHistory === 'object';
        // Decode lazily so short-circuiting proofs keep their original read boundary.
        const proofs: Array<ReturnType<typeof JSON.parse>> = [];
        const proofAt = (index: number) => proofs[index] ??= JSON.parse(runs[index].data);
        const interrupted = input.state === 'QUEUED' && runs.some((_, index) => proofAt(index).outcome === 'interrupted');
        const safeRuns = runs.every((run, index) => {
            const proof = proofAt(index);
            const retired = data.retiredLegacyHistory?.runId === run.id;
            if (retired && !retiredLegacyInputHistory(store, stateRoot, run, input, data.retiredLegacyHistory))
                return false;
            const cleanInterruption = input.state === 'QUEUED' && proof.outcome === 'interrupted';
            const undispatched = proof.outcome === 'unavailable' && (!proof.nativePromptAttempted ||
                canRetireLegacyHistory && legacyHistory.runId === run.id || retired);
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
        const eligible = !!(conversationRecoverable && legacyHistory !== 'held' &&
            origin?.kind === 'owner-conversation-input' && source.conversation === conversationId &&
            !data.assignment && !data.goalId && input.mode !== 'manual' &&
            (!work || work.id === state.work && workData.kind === 'ordinary-conversation' &&
                !workData.assignmentId && !['CANCELLED', 'UNKNOWN'].includes(work.state)) &&
            recoverableAdmission && safeRuns);
        // Withdrawing delivery to a closed role does not withdraw the direction
        // from its governed task. Source-fit and Native delivery are separate.
        const roleLaunches = stateData.role && stateData.runId ? store.all('SELECT * FROM role_launches WHERE run=? AND work=? AND role=?', stateData.runId, input.work, stateData.role) : [];
        const roleLaunch = roleLaunches.length === 1 ? roleLaunches[0] : null;
        const direction = store.all("SELECT * FROM conversation_directions WHERE conversation=? AND json_extract(data,'$.inputId')=?", conversationId, input.id);
        const workRuns = roleLaunch ? store.all(`SELECT ${runResourceColumns('r')} FROM runs r WHERE r.work=?`, input.work) : [];
        const leases = roleLaunch ? store.all('SELECT * FROM capacity_leases WHERE work=?', input.work) : [];
        const busy = !!work && workBusy(work.id);
        const waitDelivery = stateData.explicitContinuation?.inputId === input.id && !goal && !busy &&
            queuedWaitContinuation(store, conversationId, input.id);
        const roleWithdrawable = !!(roleLaunch && ['COMPLETE', 'UNUSABLE'].includes(roleLaunch.status) &&
            work && workData.kind === 'governed-change' && !['UNKNOWN', 'CANCELLED'].includes(work.state) && state.work === work.id &&
            state.resource === 'IDLE' && !state.archived && !stateData.lifecycle?.deleted && !goal && !busy &&
            reasons.every(reason => reason.startsWith('governed:' + work.id + ':')) &&
            input.state === 'QUEUED' && input.mode === 'idle' && input.generation === conversation.generation && runs.length === 0 &&
            origin?.kind === 'owner-conversation-input' && origin.uid === process.getuid?.() && source.conversation === conversationId && source.raw === input.text &&
            !data.assignment && !data.goalId && direction.length === 1 && direction[0].source === input.source &&
            JSON.parse(direction[0].data).affectedWorkId === work.id &&
            workRuns.some(run => run.id === stateData.runId) && workRuns.every(run => runResourcesSettled(store, run)) &&
            leases.every(lease => ['RELEASED', 'CANCELLED'].includes(lease.state)));
        const lastRun = runs.at(-1);
        const settledAttempt = interrupted && lastRun?.id === data.interruptedRun && lastRun?.work === input.work &&
            lastRun.phase === 'SETTLED' && ['consumed', 'released'].includes(lastRun.reservation)
            ? proofAt(runs.length - 1) : undefined;
        const lastInterruption = settledAttempt?.outcome === 'interrupted' && settledAttempt.kind === 'ordinary-conversation' &&
            settledAttempt.conversation === conversationId
            ? { modelAttemptRecorded: settledAttempt.modelDispatchAttempted === true, executionCharged: lastRun.reservation === 'consumed' }
            : undefined;
        const heldRun = input.state === 'RECONCILIATION_REQUIRED' && lastRun && lastRun.work === input.work ? proofAt(runs.length - 1) : undefined;
        let interruptedBoundary: 'modelAttempt' | 'sessionInput' | 'captureChanged' | 'protectionChanged' | undefined;
        if (heldRun?.kind === 'ordinary-conversation' && heldRun.conversation === conversationId) {
            const currentOriginal = state.resource === 'UNKNOWN' && state.work === input.work && stateData.runId === lastRun.id &&
                input.generation === conversation.generation && work?.project && work.project === conversation.project && work.source === input.source;
            if (lastRun.phase === 'INTERRUPTED') {
                interruptedBoundary = heldRun.modelDispatchAttempted === true ? 'modelAttempt' : heldRun.nativeInputObserved === true ? 'sessionInput' : undefined;
                if (interruptedBoundary === 'sessionInput' && currentOriginal && runs.length === 1 && work.state === 'INTERRUPTED' &&
                    input.mode === 'idle' && work.generation === 1 &&
                    work.id === work.lineage && work.predecessor === null && workData.kind === 'ordinary-conversation' &&
                    workData.conversation === conversationId && !workData.assignmentId &&
                    origin?.kind === 'owner-conversation-input' && origin.uid === process.getuid?.() && source.conversation === conversationId &&
                    lastRun.reservation === 'consumed' && work.generation === lastRun.generation && work.epoch > lastRun.epoch &&
                    heldRun.cleanup === 'removed' && heldRun.allocatedNative === true && heldRun.nativePromptAttempted === true &&
                    heldRun.attainedCapture === true && heldRun.modelDispatchAttempted === undefined &&
                    heldRun.attainedNative === undefined && heldRun.nativeCheckpoint === undefined && heldRun.outcome === undefined &&
                    !heldRun.manualAction && !heldRun.nativeUserBashAttempted && !heldRun.routedInputs &&
                    protectionAdvanced(store, work.project, heldRun.projectProtection))
                    interruptedBoundary = 'protectionChanged';
            } else if (runs.length === 2 && currentOriginal && lastRun.phase === 'SETTLED' && lastRun.reservation === 'consumed' &&
                lastRun.epoch === work.epoch && lastRun.generation === work.generation &&
                heldRun.outcome === 'unavailable' && heldRun.cleanup === 'not-allocated' && heldRun.attainedCapture === true &&
                ['containerId', 'allocatedNative', 'nativePromptAttempted', 'nativeInputObserved', 'attainedNative',
                    'nativeCheckpoint', 'historyRef', 'nativeSessionId', 'modelDispatchAttempted'].every(key => !Object.hasOwn(heldRun, key)) &&
                heldRun.interruptedInputRetry?.sourceId === input.source) {
                const original = runs[0];
                const originalData = proofAt(0);
                const before = originalData.manifest?.digest, after = heldRun.manifest?.digest;
                if (original.id === heldRun.interruptedInputRetry.runId && original.work === input.work && original.phase === 'INTERRUPTED' &&
                    original.reservation === 'consumed' && original.epoch === lastRun.epoch && original.generation + 1 === lastRun.generation &&
                    originalData.kind === 'ordinary-conversation' && originalData.conversation === conversationId &&
                    originalData.modelDispatchAttempted === undefined && originalData.nativeInputObserved === true && originalData.attainedCapture === true &&
                    typeof before === 'string' && typeof after === 'string' && before !== after &&
                    /^[a-f0-9]{64}$/u.test(before) && /^[a-f0-9]{64}$/u.test(after))
                    interruptedBoundary = 'captureChanged';
            }
        }
        const diagnostic = lastRun ? store.one("SELECT data FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-response-unavailable' ORDER BY rowid DESC LIMIT 1", lastRun.id) : null;
        const observedFailure = diagnostic ? JSON.parse(diagnostic.data).error : undefined;
        const routeError = typeof data.routeError === 'string' && data.routeError ? data.routeError.slice(0, 4096) : undefined;
        const failure = typeof observedFailure === 'string' && observedFailure ? observedFailure.slice(0, 4096) : routeError;
        const fingerprint = createHash('sha256').update(JSON.stringify({ conversation, state, input, source, work, runs, reasons, goal, roleLaunch, direction,
            workRuns, leases, busy, legacyHistory, interruptedBoundary, ...(waitDelivery ? { waitDelivery } : {}) })).digest('hex');
        return {
            inputId: input.id as string,
            text: (source?.raw ?? input.text) as string | null,
            state: input.state as string,
            workId: input.work as string | null,
            runId: lastRun?.id as string | undefined,
            failure,
            queuedDeliveryIssue: input.state === 'QUEUED' ? routeError : undefined,
            eligible: eligible || roleWithdrawable || !!waitDelivery,
            retryEligible: eligible || !!waitDelivery,
            exhaustedRetryWorkId: eligible || waitDelivery ? exhaustedWork : undefined,
            withdrawEligible: eligible || roleWithdrawable,
            ...(waitDelivery ? { waitDelivery: true } : {}),
            undispatched,
            blockingWorkIds: [...blockingWorkIds],
            interrupted,
            ...(lastInterruption ? { lastInterruption } : {}),
            interruptedBoundary,
            legacyHistory,
            fingerprint,
            explanation: waitDelivery ? '' : roleWithdrawable ? 'Not dispatched to this closed role. You can withdraw this queued delivery; its original text and direction remain attached to the task for independent source-fit. Withdrawal does not resume the role, clear task obligations or undo activity. Continue the task from its owner.' : recoveryExplanation(eligible, interrupted, undispatched, holds),
        };
    });
}

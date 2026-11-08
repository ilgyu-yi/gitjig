import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { validateManifest } from './capture.js';
import { inspectCapturedInputSource } from './input-context.js';
import type { Store } from './store.js';

const noNativeInput = (data: Record<string, unknown>) =>
    ['nativeInputObserved', 'modelDispatchAttempted', 'attainedNative'].every(key => !Object.hasOwn(data, key) || data[key] === false) &&
    ['initialInputComparison', 'nativeCheckpoint', 'nativeManualAttempted', 'nativeUserBashAttempted', 'manualAction', 'routedInputs']
        .every(key => !Object.hasOwn(data, key));

function absentOwnedHistory(directory: string, file: string) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || realpathSync(directory) !== directory)
        return;
    try {
        lstatSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
        const current = lstatSync(directory);
        if (current.isDirectory() && current.dev === stat.dev && current.ino === stat.ino && current.mode === stat.mode && current.uid === stat.uid)
            return { device: stat.dev, inode: stat.ino };
    }
}

function nativeBoundaryRecorded(store: Store, runId: string) {
    return !!store.one(`SELECT id FROM observations WHERE run=? AND
        json_extract(data,'$.type') IN ('native-user-boundary','resolved-model') LIMIT 1`, runId);
}

/** Match only the former initial ordinary writer that committed a file comparison before calling Pi. */
export function legacyInputHistory(store: Store, stateRoot: string, conversation: any, state: any, input: any, work: any, run: any) {
    if (!run || state.work !== run.work || !conversation.history || !state.native_id) return;
    const data = JSON.parse(run.data), view = JSON.parse(state.data);
    if (view.runId !== run.id || data.historyRef !== conversation.history || data.nativeSessionId !== state.native_id ||
        data.allocatedNative !== true || data.nativePromptAttempted !== true || data.nativeCheckpoint)
        return;
    try {
        if (!work || work.source !== input.source || work.id !== input.work || work.id !== run.work || work.id !== work.lineage ||
            work.predecessor !== null || work.state !== 'ACTIVE' || work.project !== conversation.project ||
            run.generation !== 1 || work.generation !== run.generation || work.epoch !== run.epoch ||
            run.phase !== 'SETTLED' || run.reservation !== 'consumed' || input.mode !== 'idle' || input.generation !== conversation.generation ||
            !((input.state === 'INITIAL_RESERVED' && data.outcome === 'unavailable') || (input.state === 'QUEUED' && data.outcome === 'interrupted')) ||
            state.resource !== 'IDLE' || view.cleanup?.settled !== true || view.cleanup.cleanup !== data.cleanup ||
            !['removed', 'unbound'].includes(data.cleanup) || Object.hasOwn(view, 'nativeSeed') || Object.hasOwn(view, 'contextOrigin') ||
            data.kind !== 'ordinary-conversation' || data.conversation !== conversation.id || data.initialInputId !== input.id ||
            data.raw !== input.text || !noNativeInput(data) || data.attainedCapture !== true ||
            data.ordinaryRoleBinding?.version !== 1 || data.ordinaryRoleBinding.revision !== 1 ||
            data.ordinaryRoleBinding.sourceRunId !== run.id || data.ordinaryRoleBinding.conversationId !== conversation.id)
            return 'held';
        const recorded = store.all("SELECT id FROM runs WHERE work=? OR json_extract(data,'$.conversation')=? OR json_extract(data,'$.historyRef')=? LIMIT 2", work.id, conversation.id, conversation.history);
        const leases = store.all('SELECT work,epoch,state FROM capacity_leases WHERE run=? LIMIT 2', run.id);
        if (recorded.length !== 1 || recorded[0].id !== run.id || leases.length !== 1 || leases[0].work !== work.id ||
            leases[0].epoch !== run.epoch || leases[0].state !== 'RELEASED' || nativeBoundaryRecorded(store, run.id))
            return 'held';
        const { row, origin, value } = inspectCapturedInputSource(store, input.id);
        if (row.source !== input.source || origin.kind !== 'owner-conversation-input' || origin.uid !== process.getuid?.() ||
            !value?.files.length || !value.references.length || JSON.stringify(value) !== JSON.stringify(data.inputContext) ||
            !value.references.every(reference => value.files.some(file => file.path === reference.path)))
            return 'held';
        validateManifest(data.manifest);
        const directory = path.join(stateRoot, 'sessions'), file = conversation.history, sessionId = state.native_id;
        if (path.dirname(file) !== directory || !/^[a-f0-9-]{36}$/u.test(sessionId) ||
            !path.basename(file).endsWith('_' + sessionId + '.jsonl'))
            return 'held';
        const parent = absentOwnedHistory(directory, file);
        if (!parent) return 'held';
        return { runId: run.id as string, evidence: runEvidence(run, input), parent };
    } catch { return 'held'; }
}

function runEvidence(run: any, input: any) {
    return createHash('sha256').update(JSON.stringify([run, input.id, input.source, input.text, JSON.parse(input.data).context])).digest('hex');
}

/** A retirement qualifies only the unchanged original run in a later recovery review. */
export function retiredLegacyInputHistory(store: Store, stateRoot: string, run: any, input: any, receipt: any): boolean {
    if (receipt?.runId !== run.id || receipt.evidence !== runEvidence(run, input)) return false;
    try {
        const data = JSON.parse(run.data), directory = path.join(stateRoot, 'sessions');
        const parent = path.dirname(data.historyRef) === directory ? absentOwnedHistory(directory, data.historyRef) : undefined;
        return !!parent && parent.device === receipt.parent?.device && parent.inode === receipt.parent?.inode &&
            noNativeInput(data) && !nativeBoundaryRecorded(store, run.id);
    } catch { return false; }
}

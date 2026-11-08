import type { Store } from './store.js';
import { hasNoAllocatedProducer } from './capacity-settlement.js';
import { nativeInputRecoveryRequired } from './completed-resources.js';
import { parseUniqueJson } from '../workflow/json.js';

const object = (raw: string): Record<string, any> => {
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw Error('Unbounded role correspondence');
    const value = parseUniqueJson(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid role correspondence');
    return value as Record<string, any>;
};
const noNative = (data: Record<string, any>) =>
    ['allocatedNative', 'attainedNative', 'modelDispatchAttempted', 'nativeInputObserved', 'nativeClientInitialized', 'nativePromptAttempted']
        .every(key => !Object.hasOwn(data, key) || data[key] === false || data[key] === null) &&
    ['historyRef', 'nativeSessionId', 'nativeCheckpoint', 'nativeRoleIntent', 'nativeEntryId', 'nativeSource', 'nativeRecovery', 'nativeInputRecovery']
        .every(key => !Object.hasOwn(data, key) || data[key] === null);

/** Resource settlement is distinct from Native input delivery. A role can end
 * before requesting capacity, in an affirmatively cancelled queue, or after its
 * admitted resource was released. None of these facts establishes a model send. */
function roleResourcesSettled(store: Store, run: any, data: Record<string, any>): boolean {
    const unbound = data.kind === 'publication-judgment' && data.unbound === true && hasNoAllocatedProducer(data);
    const unallocated = data.cleanup === 'not-allocated' || data.cleanup === 'unbound' && unbound;
    if (data.cleanup !== 'removed' && !unallocated) return false;
    if (data.capacityId != null && (typeof data.capacityId !== 'string' || !data.capacityId)) return false;
    const leases = store.all('SELECT * FROM capacity_leases WHERE run=? OR id=? LIMIT 2', run.id, data.capacityId ?? null);
    if (!leases.length)
        return unallocated && data.capacityId == null && !Object.hasOwn(data, 'admission') &&
            run.reservation === 'consumed' && hasNoAllocatedProducer(data);
    if (leases.length !== 1) return false;
    const lease = leases[0], proof = object(lease.data);
    if (lease.id !== data.capacityId || lease.run !== run.id || lease.work !== run.work || lease.epoch !== run.epoch || proof.kind !== 'role') return false;
    if (lease.state === 'CANCELLED')
        return unallocated && run.reservation === 'released' && hasNoAllocatedProducer(data) && hasNoAllocatedProducer(proof) && proof.admitted === false &&
            data.admission === 'never-admitted' && (proof.receipt === undefined || proof.receipt === null);
    return lease.state === 'RELEASED' && run.reservation === 'consumed' && data.admission !== 'never-admitted' &&
        proof.admitted === true && proof.receipt?.cleanup === data.cleanup && proof.receipt?.settled === true &&
        (data.cleanup === 'removed' || unbound);
}
function roleAdmissionMatches(data: Record<string, any>, launch: any, captured: Record<string, any>, role: string): boolean {
    if (data.kind === 'governed-role') return data.role === role && data.launchId === launch.id;
    // The existing publication caller records its operation/source tuple rather
    // than duplicating role/launch IDs already bound by the sole launch row.
    return data.kind === 'publication-judgment' && data.unbound === true && role === 'adjudicator' &&
        captured.stage === 'publication-payload-fit' && typeof data.operationId === 'string' && !!data.operationId &&
        data.operationId === captured.operationId && typeof data.sourceFingerprint === 'string' && !!data.sourceFingerprint &&
        data.sourceFingerprint === captured.inputVersions?.sourceFingerprint &&
        (!Object.hasOwn(data, 'role') || data.role === role) && (!Object.hasOwn(data, 'launchId') || data.launchId === launch.id);
}

/** Retire an ended role's never-dispatched input, not a delivered owner message.
 * Call inside the lifecycle transaction or after actual role/capacity settlement.
 * Original run, output, findings, allowance and historical cleanup stay untouched.
 */
export function reconcileTerminalRoleInput(store: Store, conversationId: string, generation: number): boolean {
    let matched: { input: any; inputData: Record<string, any>; data: Record<string, any>; receipt: Record<string, any> };
    try {
        const conversation = store.one('SELECT * FROM conversations WHERE id=?', conversationId);
        const state = store.one('SELECT * FROM conversation_state WHERE conversation=?', conversationId);
        if (!conversation || !state || conversation.generation !== generation || conversation.state !== 'QUEUED' || conversation.history !== null ||
            state.resource !== 'IDLE' || state.native_id !== null || nativeInputRecoveryRequired(store, conversationId)) return false;
        const data = object(state.data);
        if (!data.role || !data.runId || !noNative(data) || Object.hasOwn(data, 'lifecycle') ||
            data.continuationAuthorized !== undefined && data.continuationAuthorized !== false ||
            data.dialogs !== undefined && (!Array.isArray(data.dialogs) || data.dialogs.length)) return false;
        const inputs = store.all('SELECT * FROM conversation_inputs WHERE conversation=?', conversationId);
        if (inputs.length !== 1) return false;
        const input = inputs[0], inputData = object(input.data);
        if (input.state !== 'INITIAL_RESERVED' || input.mode !== 'initial' || input.text !== null ||
            input.generation !== generation || input.work !== state.work || Object.keys(inputData).join(',') !== 'launchId') return false;
        const work = store.one('SELECT * FROM works WHERE id=?', state.work);
        const run = store.one('SELECT * FROM runs WHERE id=? AND work=?', data.runId, state.work);
        const launches = store.all('SELECT * FROM role_launches WHERE run=?', data.runId);
        if (!work || conversation.project !== work.project || input.source !== work.source || !run ||
            !['SETTLED', 'INTERRUPTED'].includes(run.phase) || !['consumed', 'released'].includes(run.reservation) || launches.length !== 1) return false;
        const launch = launches[0], runData = object(run.data), launchData = object(launch.data);
        if (!roleAdmissionMatches(runData, launch, launchData, data.role) || launch.id !== inputData.launchId || launch.work !== work.id ||
            launch.epoch !== run.epoch || launch.role !== data.role || launch.status !== 'UNUSABLE' ||
            !['none', 'consumed', 'released'].includes(launch.resolution_reservation) || !noNative(runData) || !noNative(launchData)) return false;
        if (!roleResourcesSettled(store, run, runData)) return false;
        const outputs = store.all('SELECT * FROM role_outputs WHERE launch=?', launch.id);
        if (outputs.length !== 1 || outputs[0].status !== 'unusable' || outputs[0].raw !== null) return false;
        const output = outputs[0], outputData = object(output.data);
        if (outputData.protocol !== null || outputData.providerRequests !== 0 || !['error', 'aborted'].includes(outputData.terminal) || !noNative(outputData)) return false;
        const receipt = { kind: 'terminal-role-before-dispatch', runId: run.id, launchId: launch.id, outputId: output.id, inputId: input.id, cleanup: runData.cleanup };
        matched = { input, inputData, data, receipt };
    } catch {
        // Unprovable or conflicting correspondence retains its existing hold.
        return false;
    }
    const { input, inputData, data, receipt } = matched;
    store.run("UPDATE conversation_inputs SET state='CONFLICTED',data=? WHERE id=?", JSON.stringify({ ...inputData, terminalRoleInput: receipt }), input.id);
    store.run("UPDATE conversations SET state='IDLE' WHERE id=?", conversationId);
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...data, terminalRoleInput: receipt }), conversationId);
    return true;
}

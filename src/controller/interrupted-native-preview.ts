import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { nativeHistoryIdentity, readNativeHistoryWitness } from './history.js';
import { inspectCapturedInputSource, retainedPreparedInput } from './input-context.js';
import { privateFile } from './ownership.js';
import type { Store } from './store.js';
import type { RuntimeProfile } from './types.js';
import { validateManifest } from './capture.js';
import { lifecycleReasons } from './completed-resources.js';

function firstRetainedInput(store: Store, id: string) {
    const conversation = store.one('SELECT * FROM conversations WHERE id=?', id);
    const state = store.one('SELECT * FROM conversation_state WHERE conversation=?', id);
    if (!conversation || conversation.history !== null || state?.native_id !== null || state.resource !== 'UNKNOWN' || state.archived)
        return;
    const view = JSON.parse(state.data);
    if (view.lifecycle?.deleted || view.role || view.continuationAuthorized ||
        ['nativeSeed', 'contextOrigin', 'nativeInputRecovery'].some(key => Object.hasOwn(view, key)))
        return;
    const run = store.one('SELECT * FROM runs WHERE id=? AND work=?', view.runId ?? null, state.work);
    if (!run || run.phase !== 'INTERRUPTED' || run.reservation !== 'consumed') return;
    const data = JSON.parse(run.data);
    if (data.kind !== 'ordinary-conversation' || data.conversation !== id || data.nativePromptAttempted !== true ||
        data.nativeInputObserved !== true || data.allocatedNative !== true || data.modelDispatchAttempted !== undefined ||
        data.attainedNative !== undefined || data.nativeCheckpoint !== undefined || data.manualAction || data.nativeUserBashAttempted ||
        data.routedInputs || data.outcome !== undefined)
        return;
    const work = store.one('SELECT * FROM works WHERE id=?', run.work);
    if (!work || work.project !== conversation.project || work.state !== 'INTERRUPTED' || work.id !== work.lineage ||
        work.predecessor !== null || work.epoch !== run.epoch || work.generation !== 1 || run.generation !== 1)
        return;
    // Startup records a missing runtime allocation as not-allocated even for a witnessed unbound run.
    const recoveredUnbound = data.cleanup === 'not-allocated' && data.unbound === true && work.project === null &&
        Number.isSafeInteger(data.recoveredAt) && data.containerId === undefined && data.attainedCapture === undefined && data.manifest === undefined;
    if (data.cleanup !== 'removed' && data.cleanup !== 'unbound' && !recoveredUnbound)
        return;
    const input = store.one('SELECT * FROM conversation_inputs WHERE id=? AND conversation=? AND work=?', data.initialInputId ?? null, id, work.id);
    if (!input || input.state !== 'RECONCILIATION_REQUIRED' || input.generation !== conversation.generation ||
        input.mode !== 'idle' || input.text !== data.raw || input.source !== work.source)
        return;
    const source = store.one('SELECT * FROM sources WHERE id=?', input.source);
    const { origin, value } = inspectCapturedInputSource(store, input.id);
    if (source?.conversation !== id || (!value && source.raw !== input.text) || origin.kind !== 'owner-conversation-input' || origin.uid !== process.getuid?.()) return;
    const lease = store.all('SELECT * FROM capacity_leases WHERE run=? LIMIT 2', run.id);
    const observed = store.all(`SELECT data FROM observations WHERE run=? AND
        json_extract(data,'$.type') IN ('native-user-boundary','resolved-model') LIMIT 2`, run.id);
    if (lease.length !== 1 || lease[0].work !== work.id || lease[0].epoch !== run.epoch || lease[0].state !== 'RELEASED' ||
        observed.length !== 1 || JSON.parse(observed[0].data).type !== 'native-user-boundary' || JSON.parse(observed[0].data).initialInputId !== input.id)
        return;
    if (store.one(`SELECT id FROM runs WHERE id<>? AND (work=? OR json_extract(data,'$.conversation')=? OR json_extract(data,'$.historyRef')=?) LIMIT 1`,
        run.id, work.id, id, data.historyRef ?? null) || store.one('SELECT id FROM goals WHERE conversation=? LIMIT 1', id) ||
        store.one('SELECT id FROM conversation_assignments WHERE source_conversation=? OR target=? LIMIT 1', id, id))
        return;
    return { run, data, input, work, source, generation: conversation.generation,
        fingerprint: JSON.stringify([conversation, state, run, work, input, source, lease, observed]) };
}

/** Evidence of the original first input. This does not grant admission or publish history. */
export async function readInterruptedNativeInput(store: Store, stateRoot: string, id: string, assertOpen: () => void) {
    try {
        const original = firstRetainedInput(store, id);
        if (!original) return;
        const { run, data, input } = original;
        const directory = path.join(stateRoot, 'sessions'), file = data.historyRef, sessionId = data.nativeSessionId;
        if (typeof file !== 'string' || typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/u.test(sessionId) ||
            path.dirname(file) !== directory || !path.basename(file).endsWith('_' + sessionId + '.jsonl'))
            return;
        const info = await fs.lstat(directory);
        if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || await fs.realpath(directory) !== directory)
            return;
        await privateFile(file);
        const expected = await retainedPreparedInput(store, stateRoot, input.id, run.id, data);
        const snapshot = await readNativeHistoryWitness(file);
        if (snapshot.checkpoint.sessionId !== sessionId || !firstNativeUserMatches(snapshot.entries, expected)) return;
        await privateFile(file);
        const assertCurrent = () => {
            assertOpen();
            if (firstRetainedInput(store, id)?.fingerprint !== original.fingerprint || nativeHistoryIdentity(file) !== snapshot.historyIdentity)
                throw Error('Original interrupted input changed during review');
        };
        assertCurrent();
        const fingerprint = createHash('sha256').update(JSON.stringify([original.fingerprint, snapshot.historyIdentity, snapshot.checkpoint])).digest('hex');
        return { ...original, ...snapshot, fingerprint, expected, file, assertCurrent };
    } catch { return undefined; }
}

/** Explicit recovery can use only the same first work and its remaining allowance. */
export async function inspectInterruptedInputRetry(store: Store, stateRoot: string, id: string, assertOpen: () => void) {
    const original = await readInterruptedNativeInput(store, stateRoot, id, assertOpen);
    if (!original) return;
    const { run, work, input, data, source, checkpoint, historyIdentity, file } = original;
    const context = () => {
        const budget = store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'", work.lineage);
        const holds = lifecycleReasons(store, id).filter(reason => !['native input reconciliation required', 'resource:UNKNOWN',
            'input:' + input.id + ':RECONCILIATION_REQUIRED'].includes(reason));
        const project = work.project ? store.one('SELECT * FROM projects WHERE id=?', work.project) : null;
        return { budget, holds, project };
    };
    const reviewed = context();
    const { budget, holds } = reviewed;
    const workData = JSON.parse(work.data);
    if (holds.length || !budget || budget.reserved !== 0 || !Number.isSafeInteger(budget.lim) || !Number.isSafeInteger(budget.consumed) ||
        budget.consumed < 1 || budget.consumed > budget.lim ||
        typeof data.modelIdentity !== 'string' || !/^[a-f0-9]{64}$/u.test(data.modelIdentity) ||
        workData.kind !== 'ordinary-conversation' || workData.conversation !== id || workData.assignmentId ||
        (work.project && (!reviewed.project || data.attainedCapture !== true || !data.runtimeProfile))) return;
    const captureDigest = work.project ? validateManifest(data.manifest).digest : null;
    const witness = createHash('sha256').update(JSON.stringify([original.fingerprint, reviewed.project])).digest('hex');
    const identity = { inputId: input.id as string, workId: work.id as string, witness };
    if (budget.consumed === budget.lim)
        return { ...identity, state: 'exhausted' as const };
    const fingerprint = createHash('sha256').update(JSON.stringify([original.fingerprint, reviewed])).digest('hex');
    const assertCurrent = () => {
        original.assertCurrent();
        if (JSON.stringify(context()) !== JSON.stringify(reviewed)) throw Error('Original work or remaining allowance changed during review');
    };
    const assertOriginal = async () => {
        if (await retainedPreparedInput(store, stateRoot, input.id, run.id, data, original.generation) !== original.expected)
            throw Error('Original captured input changed before model dispatch');
        const current = await readNativeHistoryWitness(file, checkpoint);
        if (current.historyIdentity !== historyIdentity || current.checkpoint.sha256 !== checkpoint.sha256 ||
            store.one('SELECT data FROM runs WHERE id=?', run.id)?.data !== run.data ||
            JSON.stringify(store.one('SELECT * FROM sources WHERE id=?', input.source)) !== JSON.stringify(source) ||
            nativeHistoryIdentity(file) !== historyIdentity)
            throw Error('Original native input evidence changed before model dispatch');
    };
    return { ...identity, state: 'ready' as const, fingerprint, captureDigest, modelIdentity: data.modelIdentity as string,
        runtimeProfile: data.runtimeProfile, projectProtection: data.projectProtection,
        receipt: { runId: run.id as string, sourceId: input.source as string, checkpoint, historyIdentity, fingerprint }, assertCurrent, assertOriginal };
}

export type InterruptedInputRetry = Extract<Awaited<ReturnType<typeof inspectInterruptedInputRetry>>, { state: 'ready' }>;

export function interruptedRuntimeMatches(original: InterruptedInputRetry, runtime: RuntimeProfile | undefined) {
    // Compare the durable profile, so omitted optional fields and key order do not create drift.
    return original.captureDigest === null || !!runtime && isDeepStrictEqual(original.runtimeProfile, JSON.parse(JSON.stringify(runtime)));
}

export function firstNativeUserMatches(entries: Awaited<ReturnType<typeof readNativeHistoryWitness>>['entries'], expected: string) {
    const header = entries[0], leaf = entries.at(-1);
    if (header?.type !== 'session' || Object.hasOwn(header, 'parentSession') || entries.length > 5 ||
        leaf?.type !== 'message' || leaf.message.role !== 'user') return false;
    const content = leaf.message.content;
    const text = typeof content === 'string' ? content : content?.length === 1 && content[0]?.type === 'text' ? content[0].text : undefined;
    if (text !== expected) return false;
    let parent: string | null = null;
    let setupOrder = -1;
    const seen = new Set([header.id]);
    for (const entry of entries.slice(1)) {
        if (entry.type === 'session' || !entry.id || seen.has(entry.id) || entry.parentId !== parent) return false;
        if (entry !== leaf) {
            const order = entry.type === 'model_change' ? 0 : entry.type === 'thinking_level_change' ? 1 :
                entry.type === 'message' && entry.message.role === 'system' ? 2 : -1;
            if (order <= setupOrder) return false;
            setupOrder = order;
        }
        seen.add(entry.id);
        parent = entry.id;
    }
    return true;
}

/** A display-only projection with no live session file. */
export async function openInterruptedNativePreview(store: Store, stateRoot: string, id: string, assertOpen: () => void) {
    try {
        const original = await readInterruptedNativeInput(store, stateRoot, id, assertOpen);
        if (!original) return;
        const { SessionManager } = await import('@earendil-works/pi-coding-agent');
        original.assertCurrent();
        return SessionManager.inMemory(stateRoot, undefined, original.entries);
    } catch { return undefined; }
}

import type { Store } from './store.js';
import { contextBinding } from './context-origin.js';
import { contextRecoveryIdentity, contextAdmissionProof } from './context-admission-proof.js';
import { workAllowance, workFamilyUnsettled } from './work-recovery.js';
import { hash } from './change-files.js';
import { conversationModelChoice } from './model-choice.js';
import { cancelledContextWait } from './context-cancelled-wait.js';
const bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
/** Recorded eligibility; physical history validation is owned by the final action. */
export function contextWorkRecovery(s: Store, workId: string, busy: (id: string) => boolean) {
    const work = s.one(`SELECT id,state,epoch,generation,${bounded('data', 1048576)} AS data FROM works WHERE id=?`, workId);
    if (!work)
        throw Error('Original context work unavailable');
    let captured: any = null;
    const holds: string[] = [];
    try {
        if (!work.data)
            throw Error('Original context work exceeds its bounded profile');
        const data = JSON.parse(work.data), cid = data.conversation, binding = contextBinding(s, cid);
        if (!binding?.origin)
            throw Error('Select the already admitted original clone/fork work');
        const saved = contextRecoveryIdentity(s, cid, binding.origin, binding.family);
        if (saved.work.id !== workId || !['ACTIVE', 'DELIVERED', 'CANCELLED', 'INTERRUPTED'].includes(work.state) || !Number.isSafeInteger(work.epoch) || work.epoch < 1 || !Number.isSafeInteger(work.epoch + 1))
            throw Error('Original context admission or next epoch unavailable');
        if (!['ACTIVE', 'DELIVERED'].includes(saved.root.state) || !Number.isSafeInteger(saved.root.epoch) || saved.root.epoch <= binding.origin.effects.sourceEpoch!)
            throw Error('Recover the same original source root separately before its stale clone/fork');
        const effective = contextAdmissionProof(s, cid, binding.origin, binding.family, true);
        if (effective?.sourceEpoch === saved.root.epoch && !['CANCELLED', 'INTERRUPTED'].includes(work.state))
            throw Error('Original context admission is already current');
        const family = s.all('SELECT id,state,epoch,generation FROM works WHERE lineage=? ORDER BY rowid LIMIT 129', saved.work.lineage);
        if (family.length > 128 || workFamilyUnsettled(s, saved.work.lineage, busy))
            throw Error('Original shared family producer, reservations or cleanup remains unsettled');
        const allowance = workAllowance(s, workId);
        if ([allowance.execution, allowance.resolution].some(b => !Number.isSafeInteger(b.limit) || !Number.isSafeInteger(b.consumed) || !Number.isSafeInteger(b.reserved) || b.limit < 0 || b.consumed < 0 || b.reserved !== 0 || b.consumed > b.limit))
            throw Error('Original shared finite allowance unavailable');
        const histories: any[] = [], views: any[] = [], inputs: any[] = [], runs: any[] = [];
        let cancelledWait: ReturnType<typeof cancelledContextWait> | null = null;
        for (const [wid, conversationId] of [[saved.root.id, binding.origin.sourceConversationId], [workId, cid]]) {
            const conversation = s.one('SELECT * FROM conversations WHERE id=?', conversationId), view = s.one(`SELECT conversation,work,resource,direction,native_id,archived,${bounded('data', 65536)} AS boundedData FROM conversation_state WHERE conversation=?`, conversationId);
            const state = view?.boundedData ? JSON.parse(view.boundedData) : null;
            if (wid === workId && view?.resource === 'WAITING')
                cancelledWait = cancelledContextWait(s, saved.work, view, busy);
            if (!conversation || !state || view.work !== wid || (view.resource !== 'IDLE' && !cancelledWait) || view.archived || state.lifecycle?.deleted || state.dialogs?.length || (!cancelledWait && (state.waitHandles?.length || state.continuationAuthorized)) || Object.hasOwn(state, 'role') || Object.hasOwn(state, 'nativeInputRecovery'))
                throw Error('Original root and context conversations must be restored, idle and settled');
            const pending = s.all("SELECT id FROM conversation_inputs WHERE conversation=? AND state NOT IN ('CONSUMED','HANDLED','CONFLICTED','CANCELLED') LIMIT 1", conversationId);
            const goal = s.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED') LIMIT 1", conversationId);
            const assignments = s.all('SELECT id FROM conversation_assignments WHERE source_conversation=? OR target=? LIMIT 2', conversationId, conversationId);
            if (pending.length || goal || assignments.length && !(cancelledWait && wid === workId && assignments.length === 1 && assignments[0].id === cancelledWait.receipt.assignmentId))
                throw Error('Pending input, goal or original assignments need their own recovery; no context adoption');
            const original = s.all('SELECT id,work,state FROM conversation_inputs WHERE conversation=? AND source=(SELECT source FROM works WHERE id=?) LIMIT 2', conversationId, wid);
            if (original.length !== 1 || original[0].work !== wid || original[0].state !== 'CONSUMED')
                throw Error('Original consumed owner input unavailable');
            const records = s.all(`SELECT id,work,phase,reservation,epoch,generation,${bounded('data', 65536)} AS data FROM runs WHERE work=? ORDER BY rowid LIMIT 129`, wid);
            if (!records.length || records.length > 128 || records.reduce((n, r) => n + Buffer.byteLength(r.data ?? ''), 0) > 1048576 || records.some(r => {
                if (!r.data || !['SETTLED', 'INTERRUPTED'].includes(r.phase) || !['consumed', 'released'].includes(r.reservation))
                    return true;
                const value = JSON.parse(r.data), cp = value.nativeCheckpoint;
                return !['removed', 'not-allocated', 'unbound', 'confirmed'].includes(value.cleanup) || (value.nativeInputObserved || value.modelDispatchAttempted) && !value.attainedNative ||
                    value.attainedNative && (typeof value.historyRef !== 'string' || !value.historyRef.startsWith('/') || typeof value.nativeSessionId !== 'string' || !cp || cp.sessionId !== value.nativeSessionId || typeof cp.leafId !== 'string' || !cp.leafId || !Number.isSafeInteger(cp.bytes) || cp.bytes < 1 || cp.bytes > 33554432 || typeof cp.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(cp.sha256));
            }))
                throw Error('Original native input, producers or cleanup remain unavailable; reconcile the original input before admission recovery');
            const latest = [...records].reverse().find(r => JSON.parse(r.data).attainedNative), native = latest ? JSON.parse(latest.data) : null, cp = native?.nativeCheckpoint;
            if (!cp || native.historyRef !== conversation.history || native.nativeSessionId !== view.native_id || cp.sessionId !== view.native_id || !Number.isSafeInteger(cp.bytes) || cp.bytes < 1 || cp.bytes > 33554432 || typeof cp.leafId !== 'string' || !cp.leafId || !/^[a-f0-9]{64}$/u.test(cp.sha256))
                throw Error('Original recorded native history/session/checkpoint unavailable');
            const project = conversation.project ? s.one(`SELECT id,root,${bounded('profile', 131072)} AS profile FROM projects WHERE id=?`, conversation.project) : null;
            if (conversation.project && (!project?.profile || Buffer.byteLength(project.root) > 4096))
                throw Error('Original bounded context project unavailable');
            histories.push({ workId: wid, conversationId, runId: latest.id, historyRef: conversation.history, checkpoint: cp });
            views.push({ conversation, view, project, choice: conversationModelChoice(s, conversationId) });
            inputs.push(original);
            runs.push(records);
        }
        const seed = JSON.parse(views[1].view.boundedData).nativeSeed;
        if (!seed || seed.source?.conversationId !== binding.origin.sourceConversationId || seed.source?.generation !== binding.origin.sourceGeneration || seed.source?.sessionId !== histories[0].checkpoint.sessionId || seed.source?.historyRef !== histories[0].historyRef || seed.destination?.sessionId !== histories[1].checkpoint.sessionId || seed.destination?.historyRef !== histories[1].historyRef || !seed.source?.checkpoint || !seed.destination?.checkpoint)
            throw Error('Original native fork/clone seed correspondence unavailable');
        captured = { work: saved.work, root: saved.root, identity: saved.fingerprint, origin: binding.origin, family: binding.family, views, inputs, runs, histories, seed, familyWorks: family, allowance, cancelledWait };
    }
    catch (error) {
        holds.push(error instanceof Error ? error.message : 'Original context recovery unavailable');
    }
    const physicalHistory = 'Unverified until the explicit recovery action validates both retained histories';
    const review = captured ? { workId, conversationId: captured.views[1].conversation.id, workEpoch: captured.work.epoch, nextEpoch: captured.work.epoch + 1, sourceRoot: { workId: captured.root.id, conversationId: captured.origin.sourceConversationId, originalEpoch: captured.origin.effects.sourceEpoch, currentEpoch: captured.root.epoch }, origin: { kind: captured.origin.kind, sourceEventId: captured.origin.sourceEventId, effectCeiling: captured.origin.effects.ceiling }, family: captured.family, delegation: JSON.parse(captured.work.data).delegation, allowance: captured.allowance, histories: captured.histories, models: captured.views.map((v: any) => ({ conversationId: v.conversation.id, choice: v.choice })), withdrawCancelledWait: captured.cancelledWait ? { assignmentId: captured.cancelledWait.receipt.assignmentId, workId: captured.cancelledWait.receipt.workId, cancellationSource: captured.cancelledWait.receipt.cancellationSource, scope: 'Withdraw only this cancelled scheduler wait; its original task/dependency stay cancelled and require separate same-assignment recovery' } : null, physicalHistory } : { workId, holds, physicalHistory };
    return { workId, conversationId: captured?.views[1].conversation.id ?? null, eligible: holds.length === 0, holds, physicalHistory, review, captured, fingerprint: hash({ work, captured, holds }) };
}

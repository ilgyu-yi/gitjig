import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Interactions } from './interaction.js';
import type { ControllerOptions } from './types.js';
import { lifecycleReasons, type CompletedResources } from './completed-resources.js';
import { captureContextEffects, executionContext, validatedContextOrigin, type ContextFamily, type ContextOrigin } from './context-origin.js';
import { conversationModelChoice, writeConversationModelChoice } from './model-choice.js';
import { currentNativeHeader, prepareNativeSeed, type NativeSeed } from './native-seed.js';
import { nativeCheckpoint } from './history.js';
export type ForkConversationInput = {
    conversationId: string;
    expectedGeneration: number;
    expectedModelRevision: number;
} & ({
    kind: 'clone';
} | {
    kind: 'fork';
    entryId: string;
});
interface Host {
    store: Store;
    interactions: Interactions;
    completed: CompletedResources;
    options: ControllerOptions;
    state: string;
    assertOpen(): void;
    assertTarget(cid: string): void;
    busy(cid: string): boolean;
    reserve(cid: string): void;
    release(cid: string): void;
}
const parse = (value: string) => JSON.parse(value);
const exact = (left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right))
        throw new Error('Fork source changed; inspect and retry the original conversation');
};
/** Only the trusted host exposes this operation; no agent independent-task entry. */
export async function forkConversation(h: Host, input: ForkConversationInput) {
    input = structuredClone(input);
    if (!input || !['clone', 'fork'].includes(input.kind) || typeof input.conversationId !== 'string' ||
        !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || !Number.isSafeInteger(input.expectedModelRevision) || input.expectedModelRevision < 0 ||
        input.kind === 'fork' && (typeof input.entryId !== 'string' || !input.entryId || input.entryId.length > 1024))
        throw new Error('Explicit fork source, generation, model revision and selection required');
    h.assertOpen();
    const cid = input.conversationId;
    h.assertTarget(cid);
    const snapshot = () => {
        h.assertOpen();
        const view = h.interactions.inspect(cid), state = h.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid), data = parse(state.data);
        if (view.deleted || view.archived || !['IDLE', 'WAITING'].includes(view.state) || h.busy(cid) || h.interactions.getHandle(cid) || data.dialogs?.length ||
            ['closing', 'UNKNOWN'].includes(h.completed.inspect(cid).state))
            throw new Error('Fork requires a settled source producer and known cleanup');
        const producerReasons = lifecycleReasons(h.store, cid).filter(reason => /^(input:|run:|capacity:)/u.test(reason));
        if (producerReasons.length)
            throw new Error('Fork source producer unsettled: ' + producerReasons.join(';'));
        if (view.generation !== input.expectedGeneration)
            throw new Error('Stale fork source generation');
        const choice = conversationModelChoice(h.store, cid);
        if (choice.revision !== input.expectedModelRevision)
            throw new Error('Stale fork source model revision');
        const binding = executionContext(h.store, cid), origin = validatedContextOrigin(h.store, cid);
        const work = view.workId ? h.store.one('SELECT * FROM works WHERE id=?', view.workId) : null;
        const effects = captureContextEffects(h.store, cid, view.workId);
        const workData = work ? parse(work.data) : null;
        const strict = Object.hasOwn(data, 'role');
        const delegatingWork = workData?.invocation?.actor?.workId ? h.store.one('SELECT data FROM works WHERE id=?', workData.invocation.actor.workId) : null;
        const actual = workData?.delegation ?? (delegatingWork ? parse(delegatingWork.data).delegation : null);
        if (work && !strict && !actual)
            throw new Error('Fork source captured delegation unavailable; recover original work');
        const configured = h.options.interactionDelegation;
        let ceiling = actual ? structuredClone(actual) : {
            projectIds: [...(configured?.projectIds ?? (view.projectId ? [view.projectId] : []))],
            maxAssignments: configured?.maxAssignments ?? 8, rootWorkId: work?.id ?? null,
        };
        if (strict)
            ceiling.maxAssignments = 0;
        if (origin)
            ceiling = { projectIds: ceiling.projectIds.filter((p: string) => origin.delegationCeiling.projectIds.includes(p)),
                maxAssignments: Math.min(ceiling.maxAssignments, origin.delegationCeiling.maxAssignments),
                rootWorkId: origin.delegationCeiling.rootWorkId ?? binding!.family.delegationRootWorkId ?? ceiling.rootWorkId };
        if (!Array.isArray(ceiling.projectIds) || ceiling.projectIds.length > 100 || new Set(ceiling.projectIds).size !== ceiling.projectIds.length ||
            ceiling.projectIds.some((p: unknown) => typeof p !== 'string' || !h.store.one('SELECT id FROM projects WHERE id=?', p)) ||
            !Number.isSafeInteger(ceiling.maxAssignments) || ceiling.maxAssignments < 0 || ceiling.maxAssignments > 100 ||
            work && typeof ceiling.rootWorkId !== 'string')
            throw new Error('Fork source delegation invalid');
        const assignmentId = workData?.invocation?.assignmentId ?? workData?.assignmentId;
        const assignment = assignmentId ? h.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId) : null;
        if (assignmentId && !assignment)
            throw new Error('Fork original assignment unavailable');
        const continuation: ContextOrigin['continuation'] = origin?.continuation ?? (work ? {
            kind: h.store.one('SELECT work FROM change_state WHERE work=?', work.id) ? 'governed' : 'ordinary-source', workId: work.id,
        } : { kind: 'first-family-work' });
        return { generation: view.generation, projectId: view.projectId, workId: view.workId, direction: view.directionRevision,
            historyRef: view.historyRef, nativeId: view.nativeSessionId, data, choice, binding, origin, effects, ceiling, continuation,
            work: work ? { id: work.id, epoch: work.epoch, state: work.state, lineage: work.lineage, data: workData } : null, assignment };
    };
    const captured = snapshot(), destination = randomUUID(), sourceEventId = randomUUID();
    h.reserve(cid);
    let staged: NativeSeed | undefined;
    try {
        await h.completed.reclaim(cid, true);
        exact(snapshot(), captured);
        if (!!captured.historyRef !== !!captured.nativeId)
            throw new Error('Fork source native identity incomplete');
        let checkpoint: Awaited<ReturnType<typeof nativeCheckpoint>> | undefined;
        if (captured.historyRef && captured.nativeId) {
            // A proof read must never let SessionManager migrate its source.
            await currentNativeHeader(captured.historyRef, captured.nativeId);
            exact(snapshot(), captured);
            checkpoint = await nativeCheckpoint(captured.historyRef);
            exact(snapshot(), captured);
            const history = await h.interactions.history(cid);
            exact(snapshot(), captured);
            if (!history)
                throw new Error('Fork verified history unavailable');
            exact(await nativeCheckpoint(captured.historyRef), checkpoint);
            exact(snapshot(), captured);
            const selectedLeaf = input.kind === 'fork' ? input.entryId : history.sessionManager.getLeafId();
            if (!selectedLeaf)
                throw new Error('Fork selected native entry unavailable');
            staged = await prepareNativeSeed({ stateRoot: h.state, cwd: history.cwd, kind: input.kind, destinationId: destination,
                source: { conversationId: cid, generation: captured.generation, projectId: captured.projectId, modelRevision: captured.choice.revision,
                    sessionId: captured.nativeId, historyRef: captured.historyRef, checkpoint, selectedLeaf } });
            exact(snapshot(), captured);
            exact(await nativeCheckpoint(captured.historyRef), checkpoint);
            exact(snapshot(), captured);
        }
        else if (input.kind === 'fork')
            throw new Error('Fork requires verified native history; clone an empty conversation instead');
        return h.store.tx(() => {
            exact(snapshot(), captured);
            const root = captured.binding?.root ?? cid;
            const family: ContextFamily = captured.binding?.family ?? { version: 1, rootConversationId: root,
                budgetAnchorWorkId: captured.workId, budgetLineage: captured.work?.lineage ?? null, delegationRootWorkId: captured.work ? captured.ceiling.rootWorkId : null };
            const origin: ContextOrigin = { version: 1, kind: input.kind, familyRoot: root, sourceConversationId: cid,
                sourceGeneration: captured.generation, sourceWorkId: captured.workId, sourceChoiceRevision: captured.choice.revision, sourceEventId,
                effects: captured.effects, continuation: captured.continuation, delegationCeiling: captured.ceiling };
            if (!captured.binding)
                h.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...captured.data, contextFamilyRoot: root, contextFamily: family }), cid);
            h.store.run('INSERT INTO conversations VALUES(?,?,?,0,?)', destination, captured.projectId, staged?.destination.historyRef ?? null, 'IDLE');
            h.store.run('INSERT INTO conversation_state(conversation,native_id,data) VALUES(?,?,?)', destination, staged?.destination.sessionId ?? null, JSON.stringify({ ...(captured.data.language === undefined ? {} : { language: captured.data.language }), contextFamilyRoot: root, contextOrigin: origin, ...(staged ? { nativeSeed: staged } : {}) }));
            h.store.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)', destination, cid);
            h.store.run('INSERT INTO conversation_views(conversation) VALUES(?)', destination);
            h.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceEventId, destination, JSON.stringify({ kind: 'controller-context-' + input.kind, contextOrigin: origin }), 'Explicit host context continuation; no procedural standing copied');
            writeConversationModelChoice(h.store, destination, captured.choice, 0);
            validatedContextOrigin(h.store, destination);
            return h.interactions.inspect(destination);
        });
    }
    catch (error) {
        if (staged)
            throw new Error('Fork registration unavailable; retained private preparation ' + staged.operationId, { cause: error });
        throw error;
    }
    finally {
        h.release(cid);
    }
}

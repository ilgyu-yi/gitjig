import { recoverGovernedAssignment } from './assignment-authority.js';
import { assertConversationExecutable } from './completed-resources.js';
import { inspectConversationResult, inspectConversationResultDetail } from './conversation-results.js';
import { randomUUID } from 'node:crypto';
import { planContextAssignment, inheritContextTarget, type ContextAssignmentReceipt } from './context-coordination.js';
import type { Store } from './store.js';
import type { Interactions } from './interaction.js';
import type { NativeIdentity } from './interaction-types.js';
import type { PiCoordination } from '../pi/coordination.js';
import { captureConversationMode } from './application-model.js';
import { conversationModelChoice, writeConversationModelChoice } from './model-choice.js';
import type { ConversationModelMode } from './interaction-types.js';
export interface Delegation {
    projectIds: readonly string[];
    maxAssignments: number;
    rootWorkId: string;
}
export function coordination(options: {
    store: Store;
    interactions: Interactions;
    identity: NativeIdentity;
    entry: () => void;
    delegation: Delegation;
    modelMode?: ConversationModelMode;
    installationHome?: string;
    launch: (conversation: string, assignmentId: string, operation: 'investigate' | 'change') => void;
    onWait: () => void;
    busyWork?: (id: string) => boolean;
    cancel?: (assignmentId: string, reason: string, actor: NativeIdentity) => Promise<unknown>;
}): PiCoordination {
    const { store, interactions, identity } = options;
    const entry = () => {
        options.entry();
        assertConversationExecutable(store, identity.conversationId);
        const current = interactions.inspect(identity.conversationId);
        if (current.generation !== identity.generation)
            throw new Error('Stale coordinator generation');
    };
    const permitted = (cid: string) => {
        assertConversationExecutable(store, cid);
        const v = interactions.inspect(cid), source = interactions.inspect(identity.conversationId);
        if (cid !== source.conversationId && (!v.projectId || !options.delegation.projectIds.includes(v.projectId)))
            throw new Error('Target outside explicit captured delegation');
        return v;
    };
    const assignmentOutcome = (assignment: { id: string; target: string; work: string | null; state: string; data: string }) => {
        const data = JSON.parse(assignment.data), work = assignment.work ? store.one('SELECT state,epoch,project,predecessor,lineage,data FROM works WHERE id=?', assignment.work) : null;
        let resultAvailable: boolean | undefined, publishedResultId: string | undefined;
        if (assignment.state === 'COMPLETE') {
            // Legacy accepted publications need not have the newer convenience
            // pointer. Availability is a scoped read, never new procedure standing.
            const row = store.one("SELECT id,work FROM conversation_results WHERE conversation=? AND json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1", assignment.target, assignment.id);
            resultAvailable = false;
            if (row && row.work === assignment.work) {
                try {
                    const result = inspectConversationResult(store, row.id, { identity, delegation: options.delegation });
                    resultAvailable = result.assignmentId === assignment.id && result.conversationId === assignment.target && result.workId === assignment.work;
                    if (resultAvailable) publishedResultId = row.id;
                }
                catch {
                    // A missing/unreadable retained result is a non-wait outcome,
                    // not successful completion or permission to fabricate a result.
                }
            }
        }
        const outcome = { assignmentId: assignment.id, state: assignment.state, operation: data.operation ?? null, resultId: publishedResultId ?? data.resultId ?? null,
            ...(resultAvailable === undefined ? {} : { resultAvailable }),
            conversationId: assignment.target, workId: assignment.work, workState: work?.state ?? null, workEpoch: work?.epoch ?? null };
        const recovery = assignment.state === 'CANCELLED' && work?.state === 'CANCELLED' && data.operation === 'change' &&
            data.delegationRoot === options.delegation.rootWorkId && data.source?.workId === identity.workId ? {
                tool: 'conversation_recover_assignment', assignmentId: assignment.id, expectedWorkEpoch: work.epoch,
                observedDirectionRevision: interactions.inspect(assignment.target).directionRevision,
                nextAction: 'Explicitly recover this original assignment, then separately reenter the same target using the returned direction revision; recovery eligibility is checked by the tool'
            } : null;
        const workData = work ? JSON.parse(work.data) : null;
        const target = assignment.state === 'UNAVAILABLE' && work?.state === 'ACTIVE' && data.operation === 'change' &&
            work.predecessor === null && work.lineage === assignment.work && workData?.kind === 'governed-change' &&
            workData.conversation === assignment.target && !workData.contextOrigin && !workData.contextFamilyRoot &&
            !data.contextAssignment && !data.contextReentry && data.delegationRoot === options.delegation.rootWorkId &&
            data.source?.conversationId === identity.conversationId && data.source?.workId === identity.workId
            ? interactions.inspect(assignment.target) : null;
        const requestReentry = target?.workId === assignment.work && target?.projectId === data.projectId;
        const reentry = assignment.state === 'RECOVERY_READY' || requestReentry ? {
            tool: 'conversation_assign', conversationId: assignment.target, observedDirectionRevision: interactions.inspect(assignment.target).directionRevision,
            projectId: data.projectId, operation: data.operation,
            nextAction: requestReentry
                ? 'Request same-task reentry of this original target using its retained task and observed direction for fresh independent governed procedure. This pointer grants no eligibility, supplies no independent judgment and launches nothing; conversation_assign checks current authority and procedure.'
                : 'Separately reenter this original target with its retained task and current direction; recovery restored admission but launched no child execution'
        } : null;
        return { ...outcome, ...(recovery ? { recovery } : {}), ...(reentry ? { reentry } : {}) };
    };
    const statusView = (view: ReturnType<Interactions['inspect']>) => {
        const assignments = store.all("SELECT * FROM conversation_assignments WHERE target=? AND source_conversation=? AND json_extract(data,'$.delegationRoot')=?", view.conversationId, identity.conversationId, options.delegation.rootWorkId).map(assignmentOutcome);
        if (view.workId === null)
            return { ...view, workEpoch: null, workState: null, assignments };
        const work = store.one('SELECT epoch,state FROM works WHERE id=?', view.workId);
        if (!work || !Number.isSafeInteger(work.epoch) || work.epoch < 1)
            throw new Error('Original conversation work epoch unavailable; inspect the retained work');
        return { ...view, workEpoch: work.epoch as number, workState: work.state as string, assignments };
    };
    return {
        recoverAssignment: input => recoverGovernedAssignment({ ...options, busy: options.busyWork ?? (() => false) }, input),
        ...(options.cancel ? { cancel: async (input: {
                assignmentId: string;
                reason: string;
            }) => {
                entry();
                const assignment = store.one('SELECT data FROM conversation_assignments WHERE id=?', input.assignmentId);
                if (!assignment || JSON.parse(assignment.data).delegationRoot !== options.delegation.rootWorkId)
                    throw new Error('Assignment cancellation outside originating delegated scope');
                return options.cancel!(input.assignmentId, input.reason, identity);
            } } : {}),
        result: input => {
            entry();
            if (input.detail) {
                if (!options.installationHome) throw Error('Governed detail storage unavailable');
                return inspectConversationResultDetail(store, options.installationHome, input, { identity, delegation: options.delegation }, entry);
            }
            return inspectConversationResult(store, input.resultId, { identity, delegation: options.delegation });
        },
        status: input => {
            entry();
            return input.conversationId ? statusView(permitted(input.conversationId)) : interactions.list().filter(v => v.conversationId === identity.conversationId || v.projectId && options.delegation.projectIds.includes(v.projectId)).map(statusView);
        },
        address: async (input) => {
            entry();
            const target = permitted(input.conversationId);
            if (target.directionRevision !== input.observedDirectionRevision)
                throw new Error('Target direction revision stale');
            return interactions.queue({ conversationId: input.conversationId, expectedGeneration: input.expectedGeneration, text: input.text, mode: input.mode }, identity);
        },
        assign: input => {
            entry();
            if (options.delegation.maxAssignments < 1)
                throw new Error('Assignments unavailable to this strict role');
            if (!options.delegation.projectIds.includes(input.projectId) || !store.one('SELECT id FROM projects WHERE id=?', input.projectId))
                throw new Error('Project assignment outside explicit registered delegation');
            if (!input.instructions.trim() || Buffer.byteLength(input.instructions) > 128 * 1024)
                throw new Error('Invalid bounded assignment instructions');
            const result = store.tx(() => {
                entry();
                const producer = store.one('SELECT data FROM runs WHERE id=?', identity.runId), producerData = producer ? JSON.parse(producer.data) : {};
                const sourceMode = Object.hasOwn(producerData, 'conversationModelMode') ? captureConversationMode(producerData.conversationModelMode) : undefined;
                if (sourceMode && JSON.stringify(sourceMode) !== JSON.stringify(options.modelMode))
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment source model binding changed');
                if (options.modelMode && !sourceMode)
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment source model binding absent');
                const sourceChoice = conversationModelChoice(store, identity.conversationId);
                if (sourceMode?.kind === 'application' && (sourceChoice.kind !== 'managed' || sourceChoice.revision !== sourceMode.choiceRevision))
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment source choice changed');
                let cid = input.conversationId;
                if (cid) {
                    const target = permitted(cid);
                    if (target.directionRevision !== input.observedDirectionRevision || target.projectId !== null && target.projectId !== input.projectId)
                        throw new Error('Existing assignment target binding stale/different project');
                }
                const operation = input.operation ?? 'investigate';
                const plan = planContextAssignment(store, identity, cid, input.projectId, operation, options.delegation);
                const delegation = plan?.delegation ?? options.delegation;
                if (plan?.selected) {
                    const { assignment, work } = plan.selected;
                    const original = interactions.inspect(assignment.target);
                    if (!work)
                        return { receipt: { accepted: false, state: ['QUEUED', 'RUNNING'].includes(assignment.state) ? 'queued-original' : 'original-recovery', assignmentId: assignment.id, conversationId: assignment.target, nextAction: 'Inspect this original assignment; new instructions were not accepted' } };
                    const phase = store.one('SELECT phase FROM change_state WHERE work=?', work.id)?.phase;
                    if (assignment.state === 'CANCELLED' || ['UNKNOWN', 'CANCELLED'].includes(work.state) || !phase || phase === 'REVIEW_READY')
                        return { receipt: { accepted: false, state: 'original-recovery', assignmentId: assignment.id, conversationId: assignment.target, workId: work.id, nextAction: 'Inspect the original work; a current same-root coordinator can explicitly recover its cancelled direct assignment before same-task reentry', recovery: { tool: 'conversation_recover_assignment', assignmentId: assignment.id, expectedWorkEpoch: work.epoch, observedDirectionRevision: interactions.inspect(assignment.target).directionRevision } } };
                    if (cid !== assignment.target)
                        return { receipt: { accepted: false, state: 'reentry-required', assignmentId: assignment.id, conversationId: assignment.target, workId: work.id, observedDirectionRevision: original.directionRevision, nextAction: 'Retry with this original target and its observed direction revision' } };
                    cid = assignment.target;
                }
                if (input.resultDependency && cid) {
                    const seen = new Set<string>();
                    const visit = (target: string): boolean => {
                        if (target === identity.conversationId)
                            return true;
                        if (seen.has(target))
                            return false;
                        seen.add(target);
                        return store.all("SELECT target FROM conversation_dependencies WHERE waiting=? AND state='PENDING'", target).some(row => visit(row.target));
                    };
                    if (visit(cid))
                        throw new Error('Result dependency cycle refused');
                }
                const unfinished = plan?.selected?.work ?? (cid && operation === 'change' ? store.one("SELECT w.* FROM works w JOIN change_state c ON c.work=w.id WHERE w.project=? AND (json_extract(w.data,'$.conversation')=? OR w.id=(SELECT work FROM conversation_state WHERE conversation=?)) AND c.phase!='REVIEW_READY' ORDER BY w.rowid DESC LIMIT 1", input.projectId, cid, cid) : null);
                if (unfinished) {
                    if (['UNKNOWN', 'CANCELLED'].includes(unfinished.state))
                        throw new Error('Retained governed work needs explicit cleanup/cancellation recovery before assignment retry');
                    if (store.one("SELECT id FROM runs WHERE work=? AND phase IN ('RUNNING','CAPTURING','RUNTIME_CREATING','CREATED','WAITING_CAPACITY')", unfinished.id))
                        throw new Error('Retained governed producer still active; address it or await settlement');
                    const old = store.one('SELECT * FROM conversation_assignments WHERE work=? AND target=? ORDER BY rowid DESC LIMIT 1', unfinished.id, cid!);
                    if (old) {
                        const retainedData = JSON.parse(unfinished.data);
                        if (sourceMode?.kind === 'application' && !Object.hasOwn(retainedData, 'applicationModelBaseline'))
                            throw Error('APPLICATION_MODEL_UNAVAILABLE: original governed assignment needs its explicit route');
                        const id = randomUUID(), source = randomUUID(), target = interactions.inspect(cid!), revision = target.directionRevision + 1;
                        const contextReentry = plan ? { version: 1 as const, actor: identity, actorOrigin: plan.actorOrigin, targetOrigin: plan.targetOrigin, reference: plan.reference, sourceEventId: source, delegation } : undefined;
                        store.run('INSERT INTO sources VALUES(?,?,?,?)', source, cid!, JSON.stringify({ kind: 'agent-governed-reentry', actor: identity, assignmentId: old.id, originalWork: unfinished.id }), input.instructions);
                        store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', id, cid!, target.generation, unfinished.id, source, 'DISPATCHED_WORKFLOW', 'reentry', input.instructions, JSON.stringify({ assignment: old.id }));
                        store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)', cid!, revision, source, JSON.stringify({ inputId: id, effectHold: true, classification: 'unknown', affectedWorkId: unfinished.id, affectedGeneration: target.generation, affectedAssignmentId: old.id, affectedRunId: null }));
                        store.run('UPDATE conversation_state SET direction=? WHERE conversation=?', revision, cid!);
                        const data = JSON.parse(old.data);
                        store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'QUEUED', JSON.stringify({ ...data, ...(contextReentry ? { contextReentry } : {}), reentries: [...(data.reentries ?? []), { source, inputId: id, actor: identity }] }), old.id);
                        if (input.resultDependency)
                            store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), identity.conversationId, cid!, old.id, 'PENDING', JSON.stringify({ source: identity }));
                        return { launch: { cid: cid!, operation: 'change' as const, assignmentId: old.id }, receipt: { assignmentId: old.id, conversationId: cid!, workId: unfinished.id, directionRevision: revision, accepted: true, reentry: true } };
                    }
                    if (plan)
                        throw new Error('Context assignment unavailable; recover original governed assignment');
                }
                const count = store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.delegationRoot')=?", delegation.rootWorkId).n;
                if (count >= delegation.maxAssignments)
                    throw new Error('Captured assignment allowance exhausted');
                const newTarget = !cid;
                if (!cid) {
                    cid = randomUUID();
                    store.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', cid, input.projectId, 'IDLE');
                    store.run('INSERT INTO conversation_state(conversation,data) VALUES(?,?)', cid, '{}');
                    store.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)', cid, identity.conversationId);
                    store.run('INSERT INTO conversation_views(conversation) VALUES(?)', cid);
                }
                let modelBinding: {
                    version: 1;
                    mode: ConversationModelMode;
                    inheritedFrom?: {
                        conversationId: string;
                        choiceRevision: number;
                    };
                } | undefined;
                if (sourceMode) {
                    if (newTarget) {
                        writeConversationModelChoice(store, cid, sourceMode.kind === 'application' ? sourceChoice : { kind: 'legacy-external', provider: sourceMode.provider, modelId: sourceMode.modelId }, 0);
                    }
                    const choice = conversationModelChoice(store, cid);
                    if (sourceMode.kind === 'application') {
                        if (choice.kind !== 'managed')
                            throw Error('APPLICATION_MODEL_UNAVAILABLE: choose an application model for the existing target');
                        modelBinding = { version: 1, mode: { kind: 'application', version: 1, choiceRevision: choice.revision }, ...(newTarget ? { inheritedFrom: { conversationId: identity.conversationId, choiceRevision: sourceMode.choiceRevision } } : {}) };
                    }
                    else {
                        if (choice.kind === 'managed' || choice.kind === 'legacy-external' && (choice.provider !== sourceMode.provider || choice.modelId !== sourceMode.modelId))
                            throw Error('APPLICATION_MODEL_UNAVAILABLE: existing target requires another model route');
                        modelBinding = { version: 1, mode: sourceMode };
                    }
                }
                if (plan && interactions.getHandle(cid))
                    throw new Error('Active target cannot adopt context assignment');
                const id = randomUUID(), source = randomUUID(), inputId = randomUUID();
                const targetOrigin = plan ? inheritContextTarget(store, cid, identity, plan, source) : null;
                store.run('UPDATE conversations SET project=? WHERE id=?', input.projectId, cid);
                const target = interactions.inspect(cid);
                const contextAssignment: ContextAssignmentReceipt | undefined = plan ? { version: 1, actor: identity, actorOrigin: plan.actorOrigin, targetOrigin, reference: plan.reference, sourceEventId: source, delegation } : undefined;
                store.run('INSERT INTO sources VALUES(?,?,?,?)', source, cid, JSON.stringify({ kind: 'agent-assignment', actor: identity, event: id, ...(targetOrigin?.sourceEventId === source ? { contextOrigin: targetOrigin } : {}) }), input.instructions);
                store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, cid, target.generation, target.workId, source, 'QUEUED', 'idle', input.instructions, JSON.stringify({ assignment: id }));
                store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', id, identity.conversationId, cid, null, 'QUEUED', JSON.stringify({ delegationRoot: delegation.rootWorkId, delegation, ...(modelBinding ? { modelBinding } : {}), projectId: input.projectId, operation, observedTargetRevision: target.directionRevision, targetGeneration: target.generation, source: identity, instructionsSource: source, inputId, resultDependency: input.resultDependency === true,
                    ...(contextAssignment ? { contextAssignment, contextFamilyRoot: targetOrigin!.familyRoot, ...(plan!.reference.kind === 'ordinary-source' ? { continuationSourceWorkId: plan!.reference.workId } : { continuationWorkId: plan!.reference.workId }) } : {}) }));
                if (input.resultDependency)
                    store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), identity.conversationId, cid, id, 'PENDING', JSON.stringify({ source: identity }));
                return { launch: { cid, assignmentId: id, operation }, receipt: { assignmentId: id, conversationId: cid, directionRevision: target.directionRevision, accepted: true } };
            });
            if (result.launch)
                options.launch(result.launch.cid, result.launch.assignmentId, result.launch.operation);
            return result.receipt;
        },
        acknowledgeInput: input => {
            entry();
            const raw = store.one('SELECT * FROM conversation_inputs WHERE id=? AND conversation=?', input.inputId, identity.conversationId);
            if (!raw)
                throw new Error('Input source is not bound to this conversation');
            const direction = store.one("SELECT * FROM conversation_directions WHERE conversation=? AND json_extract(data,'$.inputId')=?", identity.conversationId, input.inputId);
            if (!direction)
                throw new Error('No retained direction revision');
            store.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?', JSON.stringify({ ...JSON.parse(direction.data), claim: { ...input, actor: identity }, effectHold: true }), identity.conversationId, direction.revision);
            return { inputId: input.inputId, classification: input.classification, effectsHeld: true, requiredNext: 'independent source-fit decision before governed action' };
        },
        parent: input => {
            entry();
            permitted(input.childId);
            if (input.parentId)
                permitted(input.parentId);
            return interactions.parent({ childId: input.childId, parentId: input.parentId, expectedRevision: input.expectedRelationRevision, actor: identity });
        },
        wait: async (input) => {
            entry();
            const unavailable = () => {
                const outcomes = [];
                for (const handle of input.resultHandles) {
                    const assignment = store.one('SELECT * FROM conversation_assignments WHERE id=?', handle);
                    if (!assignment || assignment.source_conversation !== identity.conversationId && !store.one("SELECT id FROM conversation_dependencies WHERE waiting=? AND assignment=? AND state='PENDING'", identity.conversationId, handle))
                        throw new Error('Unknown result handle outside this coordinator');
                    const outcome = assignmentOutcome(assignment);
                    if (['CANCELLED', 'UNAVAILABLE', 'RECOVERY_READY'].includes(outcome.state) || outcome.workState === 'CANCELLED' || outcome.resultAvailable === false) outcomes.push(outcome);
                }
                return outcomes.length ? { waiting: false as const, state: 'original-recovery' as const, outcomes,
                    nextAction: 'Inspect these original assignment/work outcomes and explicitly reconcile them before waiting; no wait or recovery was admitted' } : null;
            };
            const refused = unavailable();
            if (refused) return refused;
            const native = interactions.getHandle(identity.conversationId);
            if (!native || native.identity.runId !== identity.runId)
                throw new Error('WAIT needs exact current native registration');
            interactions.quiesceNative(identity);
            store.tx(() => {
                // Quiescing can record recovery or observe newer ownership. Merge only
                // the current metadata after the physical queue operation succeeds.
                entry();
                const current = interactions.getHandle(identity.conversationId);
                const state = store.one('SELECT work,data FROM conversation_state WHERE conversation=?', identity.conversationId);
                const data = state && JSON.parse(state.data);
                if (current !== native || !data || typeof data !== 'object' || Array.isArray(data) ||
                    state.work !== identity.workId || data.runId !== identity.runId ||
                    (['conversationId', 'workId', 'runId', 'launchId', 'generation', 'directionRevision', 'initialInputId'] as const).some(key => current.identity[key] !== identity[key]))
                    throw new Error('WAIT needs exact current native ownership');
                if (unavailable()) throw new Error('Original assignment outcome changed while quiescing WAIT; inspect retained task and native settlement');
                store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'WAITING', JSON.stringify({ ...data, runId: identity.runId, waitHandles: input.resultHandles, continuationAuthorized: true, sourceIdentity: identity }), identity.conversationId);
            });
            options.onWait();
            return { waiting: true, resultHandles: input.resultHandles, capacityRelease: 'after actual native settlement and cleanup' };
        }
    };
}

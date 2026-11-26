import { assignmentResumeFingerprint, recoverGovernedAssignment } from './assignment-authority.js';
import { assertConversationExecutable } from './completed-resources.js';
import { inspectConversationResult, inspectConversationResultDetail, inspectAssignmentResultMetadata, inspectOrdinaryAssignmentRecovery,
    inspectCoordinatorDescendantRecovery, coordinationBytes } from './conversation-results.js';
import { randomUUID } from 'node:crypto';
import { planContextAssignment, inheritContextTarget, type ContextAssignmentReceipt } from './context-coordination.js';
import type { Store } from './store.js';
import type { Interactions } from './interaction.js';
import type { NativeIdentity } from './interaction-types.js';
import type { PiAssignment, PiAssignmentResume, PiCoordination } from '../pi/coordination.js';
import { captureConversationMode } from './application-model.js';
import { conversationModelChoice, matchesExternalModel, writeConversationModelChoice } from './model-choice.js';
import type { ConversationModelMode } from './interaction-types.js';
import type { AssignmentOwnerAction } from './change-types.js';
import { currentAssignmentResultId } from './assignment-result-attempt.js';
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
    assignmentOwnerAction?: (work: string, prospectiveHeldInput: boolean) => AssignmentOwnerAction | null;
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
    // A completed publication is historical; new explicit input still belongs
    // to its current original task and must pass the ordinary held-source path.
    const directReentryTarget = (assignment: { target: string; work: string | null; state: string }, work: any, data: any) => {
        const workData = work ? JSON.parse(work.data) : null;
        return ['UNAVAILABLE', 'COMPLETE'].includes(assignment.state) && work && ['ACTIVE', 'DELIVERED'].includes(work.state) && data.operation === 'change' &&
            work.predecessor === null && work.lineage === assignment.work && workData?.kind === 'governed-change' &&
            workData.conversation === assignment.target && !workData.contextOrigin && !workData.contextFamilyRoot &&
            !data.contextAssignment && !data.contextReentry && data.delegationRoot === options.delegation.rootWorkId &&
            data.source?.conversationId === identity.conversationId && data.source?.workId === identity.workId
            ? interactions.inspect(assignment.target) : null;
    };
    const resumeFingerprint = (assignment: { id: string; target: string; work: string | null; state: string }, resultId: string,
        work: { state: string; epoch: number }, target: ReturnType<Interactions['inspect']>, data: any, delegation: Delegation) => {
        if (!assignment.work || assignment.state !== 'UNAVAILABLE' || work.state !== 'ACTIVE' || target.state !== 'IDLE' ||
            currentAssignmentResultId(data) !== resultId || (data.reentries ?? []).some((entry: {resumeResultId?: string}) => entry.resumeResultId === resultId))
            return null;
        const recorded = inspectAssignmentResultMetadata(store, assignment, resultId, { identity, delegation });
        return recorded.state === 'available' && !recorded.snapshot.reviewReady
            ? assignmentResumeFingerprint(store, resultId, assignment.target, assignment.work, recorded.snapshot.epoch) : null;
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
        const currentResultId = currentAssignmentResultId(data);
        const stoppedBeforeResult = assignment.state === 'UNAVAILABLE' && !currentResultId;
        const outcome = { assignmentId: assignment.id, state: assignment.state, operation: data.operation ?? null,
            resultId: publishedResultId ?? currentResultId ?? null,
            ...(stoppedBeforeResult ? { resultAvailable: false } : {}),
            ...(resultAvailable === undefined ? {} : { resultAvailable }),
            conversationId: assignment.target, workId: assignment.work, workState: work?.state ?? null, workEpoch: work?.epoch ?? null };
        const recovery = assignment.state === 'CANCELLED' && work?.state === 'CANCELLED' && data.operation === 'change' &&
            data.delegationRoot === options.delegation.rootWorkId && data.source?.workId === identity.workId ? {
                tool: 'conversation_recover_assignment', assignmentId: assignment.id, expectedWorkEpoch: work.epoch,
                observedDirectionRevision: interactions.inspect(assignment.target).directionRevision,
                nextAction: 'Explicitly recover this original assignment, then separately reenter the same target using the returned direction revision; recovery eligibility is checked by the tool'
            } : null;
        const target = directReentryTarget(assignment, work, data);
        const requestReentry = target?.workId === assignment.work && target?.projectId === data.projectId;
        const reentry = assignment.state === 'RECOVERY_READY' || requestReentry ? {
            tool: 'conversation_assign', assignmentId: assignment.id, conversationId: assignment.target, observedDirectionRevision: interactions.inspect(assignment.target).directionRevision,
            projectId: data.projectId, operation: data.operation,
            nextAction: (requestReentry ? 'Use same-task reentry only when supplying new instructions to the original task.'
                : 'Recovery restored admission but launched no child execution.') +
                ' Call conversation_assign with the supplied assignmentId when present, this conversationId, observedDirectionRevision, projectId and operation, plus explicit bounded instructions. This reuses the original assignment rather than creating another one. Current authority, procedure and remaining original work allowance are rechecked. This pointer grants no eligibility, supplies no independent judgment and launches nothing.'
        } : null;
        const checkpoint = options.delegation.maxAssignments > 0 && target && work && typeof data.resultId === 'string'
            ? resumeFingerprint(assignment, data.resultId, work, target, data, options.delegation) : null;
        const resumeHold = checkpoint && assignment.work ? options.assignmentOwnerAction?.(assignment.work, false) : null;
        const reentryHold = reentry && assignment.work ? options.assignmentOwnerAction?.(assignment.work, true) : null;
        const resume = checkpoint && target && !resumeHold ? { assignmentId: assignment.id, conversationId: assignment.target, projectId: data.projectId,
            resultId: data.resultId, observedDirectionRevision: target.directionRevision, checkpoint } : undefined;
        const reentryAvailable = reentry && !reentryHold;
        const ownerAction = !resume && !reentryAvailable ? resumeHold ?? reentryHold : null;
        return { ...outcome, ...(recovery ? { recovery } : {}),
            ...(resume ? { nextAction: 'When the original instructions still apply, pass resume unchanged to conversation_resume_assignment. Resolve retained findings within the original scope.' +
                (reentryHold ? ' Sending new instructions requires the separate reentryOwnerAction.' : ' Use reentry only for new instructions.'), resume } : {}),
            ...(stoppedBeforeResult && !ownerAction ? {
                nextAction: 'This exact assignment stopped before a current result could be established. Report the stopped assignment to the owner and inspect its original recovery from the parent conversation. Historical results describe earlier attempts.',
            } : {}),
            ...(reentryAvailable ? { reentry } : {}), ...(ownerAction ? { ownerAction } : {}),
            ...(resume && reentryHold ? { reentryOwnerAction: reentryHold } : {}),
            ...(reentryAvailable && resumeHold ? { resumeOwnerAction: resumeHold } : {}) };
    };
    const statusView = (view: ReturnType<Interactions['inspect']>, includeRecordedResult = false) => {
        const work = view.workId === null ? null : store.one('SELECT epoch,state FROM works WHERE id=?', view.workId);
        if (view.workId !== null && (!work || !Number.isSafeInteger(work.epoch) || work.epoch < 1))
            throw new Error('Original conversation work epoch unavailable; inspect the retained work');
        const rows = store.all("SELECT * FROM conversation_assignments WHERE target=? AND source_conversation=? AND json_extract(data,'$.delegationRoot')=?", view.conversationId, identity.conversationId, options.delegation.rootWorkId);
        const assignments = rows.map(assignmentOutcome);
        const base = { ...view, workEpoch: work?.epoch ?? null, workState: work?.state ?? null, assignments };
        if (!includeRecordedResult || view.workId === null) return base;
        const matches = rows.filter(row => row.work === view.workId);
        if (!matches.length) return base;
        const assignment = matches[0]!, outcome = assignments[rows.indexOf(assignment)]!;
        const reader = {identity, delegation: options.delegation};
        const originalRecovery = (reason: {kind: 'local-model-request-limit'; limit: number} |
            {kind: 'current-result-unreadable' | 'failure-cause-unverified'}) => ({
            ...reason, assignmentId: assignment.id, workId: assignment.work, conversationId: assignment.target,
            ...(reason.kind === 'local-model-request-limit' ? {resultId:outcome.resultId,
                nextAction:'Report that this original investigation reached the gitjig model request limit. Use /result --delegated in this parent conversation to inspect the original work.'}
                : {nextAction:'Report that the current outcome could not be fully verified. Use /result --delegated in this parent conversation to check the retained evidence for the original assignment.'}),
        });
        if (outcome.operation === 'investigate') {
            const detail = matches.length === 1 && outcome.state === 'UNAVAILABLE' && outcome.resultId
                ? inspectOrdinaryAssignmentRecovery(store, assignment, outcome.resultId, reader) : undefined;
            const descendantRecovery = matches.length === 1 ? inspectCoordinatorDescendantRecovery(store, assignment.id, reader) : undefined;
            const observed = {...base, ...(detail ? {originalRecovery:originalRecovery(detail)} : {}),
                ...(descendantRecovery ? {descendantRecovery} : {})};
            return Buffer.byteLength(JSON.stringify(observed)) <= coordinationBytes ? observed : base;
        }
        if (outcome.operation !== 'change') return base;
        const recordedResult = matches.length === 1
            ? inspectAssignmentResultMetadata(store, assignment, outcome.resultId, reader)
            : { state: 'unavailable' as const, reason: 'ambiguous-original-assignment' };
        const delivered = { ...base, recordedResult: recordedResult.state === 'available'
            ? { temporalScope: 'publication-only' as const, ...recordedResult }
            : recordedResult,
            ...(matches.length === 1 && outcome.state === 'UNAVAILABLE' && outcome.resultId && recordedResult.state === 'unavailable' && !outcome.resume
                ? {originalRecovery:originalRecovery({kind:'current-result-unreadable'})} : {}) };
        if (Buffer.byteLength(JSON.stringify(delivered)) <= coordinationBytes) return delivered;
        const omitted = { ...base, recordedResult: { state: 'unavailable' as const, reason: 'status-output-bound' } };
        return Buffer.byteLength(JSON.stringify(omitted)) <= coordinationBytes ? omitted : base;
    };
    const controls = {
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
            return input.conversationId ? statusView(permitted(input.conversationId), true) : interactions.list().filter(v => v.conversationId === identity.conversationId || v.projectId && options.delegation.projectIds.includes(v.projectId)).map(view => statusView(view));
        },
        address: async (input) => {
            entry();
            const target = permitted(input.conversationId);
            if (target.directionRevision !== input.observedDirectionRevision)
                throw new Error('Target direction revision stale');
            return interactions.queue({ conversationId: input.conversationId, expectedGeneration: input.expectedGeneration, text: input.text, mode: input.mode }, identity);
        },
        assign: (input: PiAssignment | (PiAssignmentResume & {operation: 'change'; resultDependency: true})) => {
            entry();
            if (options.delegation.maxAssignments < 1)
                throw new Error('Assignments unavailable to this strict role');
            if (!options.delegation.projectIds.includes(input.projectId) || !store.one('SELECT id FROM projects WHERE id=?', input.projectId))
                throw new Error('Project assignment outside explicit registered delegation');
            const resume = 'resultId' in input ? input : undefined;
            if (resume && ('instructions' in input || typeof resume.resultId !== 'string' || !resume.resultId))
                throw Error('An unchanged resume requires an exact result and no new instructions');
            const instructions = 'instructions' in input ? input.instructions : JSON.stringify({ resumeResult: input.resultId });
            if (!instructions.trim() || Buffer.byteLength(instructions) > 128 * 1024)
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
                const requested = input.assignmentId === undefined ? null : store.one('SELECT * FROM conversation_assignments WHERE id=?', input.assignmentId);
                const requestedWork = requested?.work ? store.one('SELECT * FROM works WHERE id=?', requested.work) : null;
                const requestedData = requested ? JSON.parse(requested.data) : null;
                if (input.assignmentId !== undefined) {
                    if (typeof input.assignmentId !== 'string' || !cid || operation !== 'change' || !requested || !requestedWork ||
                        requested.target !== cid || requestedWork.project !== input.projectId || interactions.inspect(cid).workId !== requestedWork.id ||
                        requestedData.operation !== 'change' || JSON.parse(requestedWork.data).kind !== 'governed-change' ||
                        !store.one('SELECT work FROM change_state WHERE work=?', requestedWork.id) ||
                        !['COMPLETE', 'UNAVAILABLE', 'RECOVERY_READY'].includes(requested.state) ||
                        (plan ? plan.selected?.assignment.id !== requested.id :
                            requested.source_conversation !== identity.conversationId || requestedData.delegationRoot !== delegation.rootWorkId ||
                            requestedData.source?.workId !== identity.workId))
                        throw Error('Original assignment selector is outside this current task, coordinator or project; inspect the exact retained assignment');
                }
                if (plan?.selected) {
                    const { assignment, work } = plan.selected;
                    const original = interactions.inspect(assignment.target);
                    if (!work)
                        return { receipt: { accepted: false, state: ['QUEUED', 'RUNNING'].includes(assignment.state) ? 'queued-original' : 'original-recovery', assignmentId: assignment.id, conversationId: assignment.target, nextAction: 'Inspect this original assignment; new instructions were not accepted' } };
                    const phase = store.one('SELECT phase FROM change_state WHERE work=?', work.id)?.phase;
                    if (assignment.state === 'CANCELLED' || ['UNKNOWN', 'CANCELLED'].includes(work.state) || !phase ||
                        phase === 'REVIEW_READY' && (assignment.state !== 'COMPLETE' || work.state !== 'DELIVERED' || original.workId !== work.id)) {
                        const recovery = assignment.state === 'CANCELLED' && work.state === 'CANCELLED' ? {
                            tool: 'conversation_recover_assignment', assignmentId: assignment.id, expectedWorkEpoch: work.epoch, observedDirectionRevision: original.directionRevision
                        } : undefined;
                        return { receipt: { accepted: false, state: 'original-recovery', assignmentId: assignment.id, conversationId: assignment.target, workId: work.id,
                            nextAction: `Inspect /work ${work.id} and its original recovery requirements; new instructions were not accepted`, ...(recovery ? { recovery } : {}) } };
                    }
                    if (cid !== assignment.target || phase === 'REVIEW_READY' && input.assignmentId !== assignment.id)
                        return { receipt: { accepted: false, state: 'reentry-required', assignmentId: assignment.id, conversationId: assignment.target, workId: work.id, observedDirectionRevision: original.directionRevision, nextAction: 'Retry corrective continuation with this assignmentId, original target and observed direction revision' } };
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
                const unfinished = requestedWork ?? plan?.selected?.work ?? (cid && operation === 'change' ? store.one("SELECT w.* FROM works w JOIN change_state c ON c.work=w.id WHERE w.project=? AND (json_extract(w.data,'$.conversation')=? OR w.id=(SELECT work FROM conversation_state WHERE conversation=?)) AND c.phase!='REVIEW_READY' ORDER BY w.rowid DESC LIMIT 1", input.projectId, cid, cid) : null);
                if (unfinished) {
                    if (['UNKNOWN', 'CANCELLED'].includes(unfinished.state))
                        throw new Error('Retained governed work needs explicit cleanup/cancellation recovery before assignment retry');
                    if (store.one("SELECT id FROM runs WHERE work=? AND phase IN ('RUNNING','CAPTURING','RUNTIME_CREATING','CREATED','WAITING_CAPACITY')", unfinished.id))
                        throw new Error('Retained governed producer still active; address it or await settlement');
                    const old = requested ?? store.one('SELECT * FROM conversation_assignments WHERE work=? AND target=? ORDER BY rowid DESC LIMIT 1', unfinished.id, cid!);
                    if (old) {
                        const phase = store.one('SELECT phase FROM change_state WHERE work=?', unfinished.id)?.phase;
                        if (!plan && phase === 'REVIEW_READY') {
                            const current = directReentryTarget(old, unfinished, JSON.parse(old.data));
                            if (current?.workId !== unfinished.id || current?.projectId !== input.projectId)
                                throw Error('Completed original task is outside this coordinator or current target; inspect its owner before corrective reentry');
                        }
                        const retainedData = JSON.parse(unfinished.data);
                        if (sourceMode?.kind === 'application' && !Object.hasOwn(retainedData, 'applicationModelBaseline'))
                            throw Error('APPLICATION_MODEL_UNAVAILABLE: original governed assignment needs its explicit route');
                        const target = interactions.inspect(cid!), data = JSON.parse(old.data);
                        const resultFingerprint = resume && directReentryTarget(old, unfinished, data) &&
                            resumeFingerprint(old, resume.resultId, unfinished, target, data, delegation);
                        if (resume && (!resultFingerprint || resultFingerprint !== resume.checkpoint))
                            throw Error('Original blocked assignment is no longer eligible for resume without new instructions; inspect its current result');
                        const ownerAction = options.assignmentOwnerAction?.(unfinished.id, !resume);
                        if (ownerAction)
                            return { receipt: { accepted: false, instructionsAccepted: false, state: 'owner-action-required', assignmentId: old.id,
                                conversationId: cid!, workId: unfinished.id, observedDirectionRevision: target.directionRevision,
                                resultId: data.resultId ?? null, ownerAction,
                                nextAction: ownerAction.nextAction + (resume ? '' : ' These new instructions were not accepted; retain them for an explicit retry after the owner action.') } };
                        const id = randomUUID(), source = randomUUID();
                        const revision = target.directionRevision + (resume ? 0 : 1);
                        const contextReentry = plan ? { version: 1 as const, actor: identity, actorOrigin: plan.actorOrigin, targetOrigin: plan.targetOrigin, reference: plan.reference, sourceEventId: source, delegation } : undefined;
                        const originalResume = resume ? { resumeResultId: resume.resultId, resultFingerprint, observedDirectionRevision: revision } : {};
                        const reentries = [...(data.reentries ?? []), { source, inputId: id, actor: identity, ...originalResume }];
                        const next = JSON.stringify({ ...data, ...(contextReentry ? { contextReentry } : {}), reentries });
                        if (reentries.length > 64 || Buffer.byteLength(next) > 64 * 1024)
                            throw Error('Original assignment reentry history exceeds its dispatch bounds; inspect retained work');
                        store.run('INSERT INTO sources VALUES(?,?,?,?)', source, cid!, JSON.stringify({ kind: 'agent-governed-reentry', actor: identity, assignmentId: old.id, originalWork: unfinished.id, ...originalResume }), instructions);
                        store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', id, cid!, target.generation, unfinished.id, source, 'DISPATCHED_WORKFLOW', 'reentry', instructions, JSON.stringify({ assignment: old.id }));
                        if (!resume) {
                            store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)', cid!, revision, source, JSON.stringify({ inputId: id, effectHold: true, classification: 'unknown', affectedWorkId: unfinished.id, affectedGeneration: target.generation, affectedAssignmentId: old.id, affectedRunId: null }));
                            store.run('UPDATE conversation_state SET direction=? WHERE conversation=?', revision, cid!);
                        }
                        store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'QUEUED', next, old.id);
                        const dependent = input.resultDependency && (!resume || data.resultDependency !== false ||
                            store.one("SELECT id FROM conversation_dependencies WHERE assignment=? AND waiting=? AND state='PENDING'", old.id, identity.conversationId));
                        if (dependent)
                            store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), identity.conversationId, cid!, old.id, 'PENDING', JSON.stringify({ source: identity }));
                        return { launch: { cid: cid!, operation: 'change' as const, assignmentId: old.id }, receipt: { assignmentId: old.id, conversationId: cid!, workId: unfinished.id, directionRevision: revision, accepted: true, reentry: true } };
                    }
                    if (plan)
                        throw new Error('Context assignment unavailable; recover original governed assignment');
                }
                if (resume) throw Error('Original blocked assignment unavailable for resume');
                const count = store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.delegationRoot')=?", delegation.rootWorkId).n;
                if (count >= delegation.maxAssignments)
                    throw new Error('Captured assignment allowance exhausted: the new-assignment creation limit is reached. This does not report execution or resolution allowance for existing work. For retained governed work, inspect conversation_status. Use its resume fields when the original instructions still apply, or its reentry target with conversation_assign when you have new instructions. Current eligibility and original work allowance still apply.');
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
                        if (choice.kind === 'managed' || choice.kind === 'legacy-external' && !matchesExternalModel(choice, sourceMode))
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
                store.run('INSERT INTO sources VALUES(?,?,?,?)', source, cid, JSON.stringify({ kind: 'agent-assignment', actor: identity, event: id, ...(targetOrigin?.sourceEventId === source ? { contextOrigin: targetOrigin } : {}) }), instructions);
                store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, cid, target.generation, target.workId, source, 'QUEUED', 'idle', instructions, JSON.stringify({ assignment: id }));
                store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', id, identity.conversationId, cid, null, 'QUEUED', JSON.stringify({ delegationRoot: delegation.rootWorkId, delegation, ...(modelBinding ? { modelBinding } : {}), projectId: input.projectId, operation, observedTargetRevision: target.directionRevision, targetGeneration: target.generation, source: identity, instructionsSource: source, inputId, resultDependency: input.resultDependency === true,
                    ...(contextAssignment ? { contextAssignment, contextFamilyRoot: targetOrigin!.familyRoot, ...(plan!.reference.kind === 'ordinary-source' ? { continuationSourceWorkId: plan!.reference.workId } : { continuationWorkId: plan!.reference.workId }) } : {}) }));
                if (input.resultDependency)
                    store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), identity.conversationId, cid, id, 'PENDING', JSON.stringify({ source: identity }));
                return { launch: { cid, assignmentId: id, operation }, receipt: { assignmentId: id, conversationId: cid, directionRevision: target.directionRevision, accepted: true } };
            });
            if (result.launch)
                options.launch(result.launch.cid, result.launch.assignmentId, result.launch.operation);
            return result.receipt.accepted === true
                ? { ...result.receipt, wait: { resultHandles: [result.receipt.assignmentId] } }
                : result.receipt;
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
                        throw new Error('Unknown result handle outside this coordinator. Use assignmentId from an accepted assignment or resume receipt or its wait.resultHandles; conversationId is for conversation_status. No wait was admitted.');
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
                delete data.continuationError;
                delete data.continuationFailure;
                store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'WAITING', JSON.stringify({ ...data, runId: identity.runId, waitHandles: input.resultHandles, continuationAuthorized: true, sourceIdentity: identity }), identity.conversationId);
            });
            options.onWait();
            return { waiting: true, resultHandles: input.resultHandles, capacityRelease: 'after actual native settlement and cleanup' };
        }
    } satisfies PiCoordination;
    return {...controls, ...(options.delegation.maxAssignments > 0 ? {
        resumeAssignment: (input: PiAssignmentResume) => controls.assign({...input,operation:'change',resultDependency:true}),
    } : {})};
}

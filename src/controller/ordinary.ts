import { originalFailedWaitOutcome } from './original-wait-outcome.js';
import { prepareGovernedResult } from './governed-result.js';
import { matchesEffectAssignmentProfile } from './effect-assignment-provenance.js';
import { defaultConversationExecutionLimit } from './work-recovery.js';
import { pendingOwnerRoot, type OwnerRootProfile } from './owner-activation.js';
import { assignmentDispatchToken, recoveredCompletionHold } from './assignment-authority.js';
import { assertConversationExecutable, type CompletedResources } from './completed-resources.js';
import { modelConfigurationIdentity } from '../pi/model-identity.js';
import { captureConversationOptions, captureConversationMode, captureOrdinaryRoleBinding, subjectRoleModel, type OrdinaryRoleBinding } from './application-model.js';
import { conversationModelChoice } from './model-choice.js';
import { prepareCapturedInput, assertCapturedInputRun } from './input-context.js';
import { createHash } from 'node:crypto';
import { inspectConversationResult, type AnswerObservation, type CoordinatorReportObservation } from './conversation-results.js';
import { captureCoordinatorReport, collectCoordinatorReport, coordinatorReportCurrent, type CoordinatorReportDraft } from './coordinator-report.js';
import { projectProtection, scopeProtection } from './protection.js';
import { publishConversationResult } from './conversation-results.js';
import { coordination, type Delegation } from './coordination.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Interactions } from './interaction.js';
import type { Capacity } from './capacity.js';
import type { ControllerOptions } from './types.js';
import type { RunConversationOptions, ResolvedConversationOptions, ConversationModelRequest, ConversationModelMode, ConversationTurnResult, NativeIdentity } from './interaction-types.js';
import type { PiSession } from '../pi/session.js';
import type { PiProjectOperations } from '../pi/operations.js';
import { privateDirectory } from './ownership.js';
import { capture } from './capture.js';
import { createScope, type ContainerScope } from '../execution/container-scope.js';
import { nativeCheckpoint } from './history.js';
import { admitContextWork } from './context-origin.js';
import { validateContextAssignmentLaunch, ContextAssignmentRetained } from './context-coordination.js';
import { conversationLanguagePolicy } from './conversation-language.js';
interface OrdinaryHost {
    busyWork?(id: string): boolean;
    goals: Pick<import("./goals.js").Goals, "admit" | "context" | "assertCurrent" | "settled" | "canResume" | "isPendingReview" | "attach" | "observeDependencies" | "ownerRootProfileForInput">;
    assertApplicationSource?(model: ResolvedConversationOptions['model'], desired: Extract<import('./model-choice.js').ModelChoiceInput, {
        kind: 'managed';
    }>): void;
    store: Store;
    interactions: Interactions;
    capacity: Capacity;
    completed: CompletedResources;
    options: ControllerOptions;
    assertOpen(): void;
    assertTarget(cid: string): void;
    resolveOperation(options: RunConversationOptions, completeOnly?: boolean, validateRecipe?: () => void): Promise<ResolvedConversationOptions>;
    entry(run: string): void;
    patchRun(run: string, phase: string, data: Record<string, unknown>): void;
    register(work: string, handle: {
        abort: AbortController;
        scope?: ContainerScope;
        done?: Promise<unknown>;
    }): void;
    unregister(work: string): void;
    settleBudget(run: string): void;
    history(run: string, ref: string, id: string): void;
    checkpoint(run: string, cp: any): void;
    modelDispatch(run: string, cp: any): void;
    observe(run: string, data: Record<string, unknown>): void;
    validateHistory(work: string): Promise<void>;
    reconcile(run: string, work: string): Promise<string>;
    cancelAssignment(assignment: string, reason: string, actor: NativeIdentity): Promise<unknown>;
    assignmentModelRequest(assignment: string, fallback: ResolvedConversationOptions['model'], parentMode: ConversationModelMode): ConversationModelRequest;
    launchChange(assignment: string, model: ConversationModelRequest): Promise<unknown>;
    verificationEvidence?(work: string): ReturnType<import('./change-core.js').ChangeCore['inspectVerificationEvidence']>;
    ownerRootProfile(): OwnerRootProfile;
    activateEffects(work: string, inAdmission?: boolean): void;
    effectContext(work: string): unknown;
    effectControls(identity: NativeIdentity, onQueue: (receipt: {
        operationId: string;
        assignmentId: string;
        conversationId: string;
        state: 'QUEUED';
    }) => void): Record<string, unknown>;
    launchEffect(assignment: string, model: ResolvedConversationOptions['model']): Promise<import('./effect-types.js').EffectView | import('./publication-types.js').PublicationView | import('./merge-types.js').MergeView>;
}
export class Ordinary {
    constructor(private h: OrdinaryHost) {
    }
    private quiesced = false;
    private owned = new Set<Promise<unknown>>();
    private backgroundFailures: unknown[] = [];
    quiesce() { this.quiesced = true; }
    private own<T>(task: Promise<T>, background = false): Promise<T> {
        this.owned.add(task);
        void task.then(() => this.owned.delete(task), error => {
            if (background)
                this.backgroundFailures.push(error);
            this.owned.delete(task);
        });
        return task;
    }
    async drain(): Promise<void> {
        while (this.owned.size)
            await Promise.allSettled([...this.owned]);
        if (this.backgroundFailures.length)
            throw new AggregateError(this.backgroundFailures, 'Ordinary background settlement failed');
    }
    private running = new Set<string>();
    isBusy(cid: string) {
        return this.running.has(cid);
    }
    private models = new Map<string, ResolvedConversationOptions['model']>();
    private delegation(cid: string, wid: string, project: string | null, assignmentId: string | null): Delegation {
        const assignment = assignmentId ? this.h.store.one('SELECT data FROM conversation_assignments WHERE id=? AND target=?', assignmentId, cid) : null;
        if (assignment) {
            const inherited = JSON.parse(assignment.data).delegation;
            if (inherited)
                return inherited;
        }
        if (this.h.goals.isPendingReview(cid))
            return { projectIds: project ? [project] : [], maxAssignments: 0, rootWorkId: wid };
        const config = this.h.options.interactionDelegation, maxAssignments = config?.maxAssignments ?? 8, projectIds = [...(config?.projectIds ?? (project ? [project] : []))];
        if (!Number.isSafeInteger(maxAssignments) || maxAssignments < 1 || maxAssignments > 100 || projectIds.some(id => !this.h.store.one('SELECT id FROM projects WHERE id=?', id)))
            throw new Error('Invalid explicit conversation delegation');
        return { projectIds, maxAssignments, rootWorkId: wid };
    }
    run(options: RunConversationOptions): Promise<ConversationTurnResult> {
        if (this.quiesced)
            return Promise.reject(new Error('Ordinary admission quiesced'));
        const captured = captureConversationOptions(options);
        if (captured.signal?.aborted)
            return Promise.reject(captured.signal.reason);
        return this.own(this.h.resolveOperation(captured).then(resolved => this.runInner(resolved)));
    }
    private async runInner(options: ResolvedConversationOptions): Promise<ConversationTurnResult> {
        options.signal?.throwIfAborted();
        this.h.assertOpen();
        const cid = options.conversationId;
        this.h.assertTarget(cid);
        if (this.running.has(cid) || this.h.interactions.getHandle(cid))
            throw new Error('Conversation already has an active response');
        assertConversationExecutable(this.h.store, cid);
        const view = this.h.interactions.inspect(cid);
        if (view.archived || ['UNKNOWN', 'SETTLING'].includes(view.state))
            throw new Error('Conversation cleanup must settle before dispatch');
        if (view.projectId && !this.h.options.runtimeProfile)
            throw new Error('Explicit runtime profile required for project conversation');
        const pending = this.h.store.all("SELECT * FROM conversation_inputs WHERE conversation=? AND state='QUEUED' ORDER BY rowid", cid);
        const input = options.initialInputId ? pending.find(row => row.id === options.initialInputId) : pending[0];
        if (!input)
            throw new Error('No queued owner input');
        if (input.generation !== view.generation)
            throw new Error('Queued input generation needs explicit reconciliation');
        this.running.add(cid);
        if (options.modelMode.kind === 'explicit')
            this.models.set(cid, options.model);
        else
            this.models.delete(cid);
        let a: any, registeredWork: string | undefined;
        const handle: {
            abort: AbortController;
            scope?: ContainerScope;
            done?: Promise<unknown>;
        } = { abort: new AbortController() };
        try {
            await this.h.completed.beforeFresh(cid);
            options.signal?.throwIfAborted();
            assertConversationExecutable(this.h.store, cid);
            if (view.historyRef) {
                if (view.workId)
                    await this.h.validateHistory(view.workId);
                options.signal?.throwIfAborted();
                await this.h.interactions.history(cid);
            }
            this.h.assertOpen();
            a = this.h.store.tx(() => {
                // Cancellation during model resolution, cleanup or history must
                // not admit a new run after the caller has stopped preparing it.
                options.signal?.throwIfAborted();
                options.assertModelCurrent();
                this.h.assertTarget(cid);
                assertConversationExecutable(this.h.store, cid);
                const runtimeProfile = this.h.options.runtimeProfile ? Object.freeze({ ...this.h.options.runtimeProfile }) : undefined;
                if (view.projectId && !runtimeProfile)
                    throw new Error('Explicit runtime profile required for project conversation');
                const currentInput = this.h.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.id);
                if (this.h.interactions.inspect(cid).generation !== view.generation || currentInput?.state !== 'QUEUED' || currentInput.generation !== view.generation ||
                    currentInput.source !== input.source || currentInput.text !== input.text || currentInput.data !== input.data)
                    throw new Error('Selected conversation input changed before admission');
                if (options.manual && (this.h.interactions.inspect(cid).directionRevision !== view.directionRevision || input.mode !== 'manual' || JSON.stringify(JSON.parse(input.data).manual) !== JSON.stringify(options.manual) || this.h.store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND id<>? AND state IN ('QUEUED','NATIVE_PENDING','INITIAL_RESERVED','RECONCILIATION_REQUIRED')", cid, input.id)))
                    throw new Error('Pending input changed before manual history admission');
                const runId = randomUUID();
                options.supersedeWait?.(input.id, runId);
                const prior = view.workId ? this.h.store.one('SELECT * FROM works WHERE id=?', view.workId) : null, incomingAssignment = JSON.parse(input.data).assignment ?? null;
                if (incomingAssignment && this.h.store.one('SELECT state FROM conversation_assignments WHERE id=?', incomingAssignment)?.state === 'CANCELLED')
                    throw new Error('Assigned task cancelled before ordinary admission');
                if (incomingAssignment) {
                    const assigned = validateContextAssignmentLaunch(this.h.store, incomingAssignment);
                    if (assigned && JSON.parse(assigned.data).operation !== 'investigate')
                        throw new Error('Use the original governed assignment entry instead of ordinary dispatch');
                    const binding = this.h.assignmentModelRequest(incomingAssignment, options.model, options.modelMode);
                    if (binding.applicationConversation && (options.modelMode.kind !== 'application' || options.modelMode.choiceRevision !== binding.applicationConversation.choiceRevision) || binding.model && options.modelMode.kind !== 'explicit')
                        throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment operation lost its model binding');
                }
                let work = prior && prior.project === view.projectId && JSON.parse(prior.data).kind === 'ordinary-conversation' && (!incomingAssignment || JSON.parse(prior.data).assignmentId === incomingAssignment) ? prior : null;
                const previousRoleBinding = work ? subjectRoleModel(this.h.store, work.id).ordinary : undefined;
                if (work && ['UNKNOWN', 'CANCELLED'].includes(work.state))
                    throw new Error('Explicit retained work recovery required');
                if (!work) {
                    const wid = randomUUID();
                    const context = admitContextWork(this.h.store, cid, wid, this.delegation(cid, wid, view.projectId, incomingAssignment));
                    const origin = JSON.parse(this.h.store.one('SELECT origin FROM sources WHERE id=?', input.source).origin);
                    const ownerRoot = !prior && !incomingAssignment && context.lineage === wid && !Object.hasOwn(context.metadata, 'contextContinuation') && !this.h.goals.isPendingReview(cid) && origin.kind === 'owner-conversation-input' && origin.uid === process.getuid?.();
                    const ownerProfile = ownerRoot ? (this.h.goals.ownerRootProfileForInput(input.id) ?? this.h.ownerRootProfile()) : null;
                    this.h.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', wid, view.projectId, input.source, prior?.id ?? null, context.lineage, 'ACTIVE', 1, 1, null, JSON.stringify({ kind: 'ordinary-conversation', conversationModelMode: options.modelMode, conversation: cid, raw: input.text, scopeTransition: JSON.parse(this.h.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data).scopeTransition ?? null, assignmentId: incomingAssignment, delegation: context.delegation, ...context.metadata, ...(ownerRoot ? { ownerRootActivation: pendingOwnerRoot(ownerProfile!) } : {}) }));
                    if (context.initializeBudgets)
                        for (const kind of ['execution', 'resolution'])
                            this.h.store.run('INSERT INTO budgets VALUES(?,?,?,0,0)', context.lineage, kind, kind === 'execution' ? defaultConversationExecutionLimit : 8);
                    this.h.store.run('INSERT INTO requirements VALUES(?,?,?,?)', wid, 1, input.text, JSON.stringify({ status: 'unconfirmed', english: 'Ordinary dialogue; no implementation or external-action authority.' }));
                    // Activate before reserving a run, within this admission transaction.
                    // A fault rolls back the root, grants, sources and budgets together.
                    if (ownerRoot)
                        this.h.activateEffects(wid, true);
                    work = this.h.store.one('SELECT * FROM works WHERE id=?', wid);
                }
                else {
                    const context = admitContextWork(this.h.store, cid, work.id, this.delegation(cid, work.id, view.projectId, incomingAssignment), work);
                    this.h.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(work.data), ...context.metadata, delegation: context.delegation, conversationModelMode: options.modelMode }), work.id);
                    this.h.store.run('UPDATE works SET state=?,generation=generation+1 WHERE id=?', 'ACTIVE', work.id);
                    work = this.h.store.one('SELECT * FROM works WHERE id=?', work.id);
                    const version = this.h.store.one('SELECT MAX(version) AS n FROM requirements WHERE work=?', work.id).n + 1;
                    this.h.store.run('INSERT INTO requirements VALUES(?,?,?,?)', work.id, version, input.text, JSON.stringify({ status: 'unconfirmed', sourceId: input.source }));
                }
                if (incomingAssignment)
                    this.h.store.run('UPDATE conversation_assignments SET work=?,state=? WHERE id=?', work.id, 'RUNNING', incomingAssignment);
                const revision = (previousRoleBinding?.revision ?? 0) + 1;
                if (!Number.isSafeInteger(revision))
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: ordinary binding revision exhausted');
                let roleMode: OrdinaryRoleBinding['mode'];
                if (options.modelMode.kind === 'application') {
                    const choice = conversationModelChoice(this.h.store, cid);
                    if (choice.kind !== 'managed' || choice.revision !== options.modelMode.choiceRevision || options.model.provider !== choice.provider || options.model.modelId !== choice.modelId)
                        throw Error('APPLICATION_MODEL_UNAVAILABLE: ordinary admitted choice differs from selected source');
                    if (this.h.assertApplicationSource)
                        this.h.assertApplicationSource(options.model, choice);
                    else if (options.model.managed?.home !== this.h.options.installationHome || options.model.managed.thinkingLevel !== choice.thinkingLevel)
                        throw Error('APPLICATION_MODEL_UNAVAILABLE: ordinary admitted choice differs from selected source');
                    roleMode = { kind: 'application', baseline: { version: 1, revision, choice: { kind: 'managed', provider: choice.provider, modelId: choice.modelId, thinkingLevel: choice.thinkingLevel }, source: { kind: 'conversation', conversationId: cid, choiceRevision: choice.revision } } };
                }
                else
                    roleMode = { kind: 'explicit', provider: options.modelMode.provider, modelId: options.modelMode.modelId };
                const ordinaryRoleBinding = captureOrdinaryRoleBinding({ version: 1, revision, sourceRunId: runId, conversationId: cid, mode: roleMode });
                this.h.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...JSON.parse(work.data), ordinaryRoleBinding }), work.id);
                work = this.h.store.one('SELECT * FROM works WHERE id=?', work.id);
                const budget = this.h.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?', work.lineage, 'execution');
                if (budget.consumed + budget.reserved >= budget.lim)
                    throw new Error('Retained conversation allowance exhausted; extend same W explicitly');
                this.h.store.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', work.lineage, 'execution');
                const staging = path.join(this.h.options.installationHome, 'inputs', runId), generation = view.generation + 1;
                this.h.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, work.id, work.epoch, work.generation, 'CREATED', staging, 'reserved', JSON.stringify({ kind: 'ordinary-conversation', conversationModelMode: options.modelMode, ordinaryRoleBinding, modelIdentity: createHash('sha256').update(JSON.stringify(modelConfigurationIdentity(options.model))).digest('hex'), projectProtection: projectProtection(this.h.store, view.projectId), runtimeProfile, raw: input.text, inputContext: JSON.parse(input.data).context ?? null, ...(options.manual ? { manualAction: options.manual } : {}), conversation: cid, createdAt: Date.now(), initialInputId: input.id }));
                this.h.store.run('UPDATE conversations SET generation=?,state=? WHERE id=?', generation, 'QUEUED', cid);
                this.h.store.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?', work.id, 'QUEUED', JSON.stringify({ ...JSON.parse(this.h.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data), runId, effectHold: true }), cid);
                this.h.store.run('UPDATE conversation_inputs SET work=?,generation=?,state=? WHERE id=?', work.id, generation, 'INITIAL_RESERVED', input.id);
                // All inputs already admitted to this same old generation follow
                // this one authorized run transition. Submission provenance stays unchanged.
                this.h.store.run("UPDATE conversation_inputs SET generation=? WHERE conversation=? AND generation=? AND state='QUEUED'", generation, cid, view.generation);
                this.h.store.run("UPDATE conversation_directions SET data=json_set(data,'$.affectedWorkId',?,'$.affectedGeneration',?,'$.affectedRunId',?,'$.affectedAssignmentId',?) WHERE conversation=? AND json_extract(data,'$.inputId')=? AND json_extract(data,'$.affectedWorkId') IS NULL", work.id, generation, runId, incomingAssignment, cid, input.id);
                const identity = { conversationId: cid, workId: work.id, runId, launchId: null, generation, directionRevision: view.directionRevision, initialInputId: input.id } satisfies NativeIdentity;
                this.h.goals.admit(identity, options.model);
                // Registration is the admission's last step, so a busy refusal rolls the admission back.
                this.h.register(work.id, handle);
                registeredWork = work.id;
                return { work, runId, staging, identity, runtimeProfile };
            });
            this.h.goals.attach(a.identity, handle);
        }
        catch (error) {
            if (registeredWork)
                this.h.unregister(registeredWork);
            this.running.delete(cid);
            this.models.delete(cid);
            throw error;
        }
        const task = this.execute(options, a, input, view.historyRef, view.nativeSessionId, handle);
        let completedClient: PiSession | undefined, turnError: unknown, turnFailed = false, goalResult: ConversationTurnResult | undefined;
        try {
            const completed = await task;
            const result = completed.result;
            completedClient = completed.completedClient;
            const assignmentId = JSON.parse(a.work.data).assignmentId ?? null;
            if (!assignmentId || !options.manual && !options.userBash)
                this.settleAssignments(cid, result, assignmentId);
            if (completedClient) {
                await this.h.completed.admit(a.identity, completedClient);
                completedClient = undefined;
            }
            this.h.interactions.resultsCommitted(cid);
            await this.h.interactions.deliverNotices();
            goalResult = result;
            return result;
        }
        catch (error) {
            turnFailed = true;
            turnError = error;
            throw error;
        }
        finally {
            try {
                if (completedClient)
                    await this.h.completed.discardCandidate(a.identity, completedClient);
            }
            catch (cleanupError) {
                if (turnFailed)
                    throw new AggregateError([turnError, cleanupError], 'Ordinary result/retention failure and owned client cleanup UNKNOWN');
                throw cleanupError;
            }
            finally {
                this.running.delete(cid);
                this.h.unregister(a.work.id);
                const st = this.h.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', cid);
                if (st.resource !== 'WAITING' || !JSON.parse(st.data).continuationAuthorized)
                    this.models.delete(cid);
                this.h.completed.changed();
                this.h.goals.settled(a.identity, goalResult, turnError);
                this.resumeDependents();
            }
        }
    }
    private settleAssignments(cid: string, result: ConversationTurnResult, assignmentId: string | null) {
        this.h.store.tx(() => {
            const assignment = assignmentId ? this.h.store.one('SELECT * FROM conversation_assignments WHERE id=? AND target=?', assignmentId, cid) : null;
            if (result.status === 'waiting') {
                if (assignment && assignment.state !== 'CANCELLED')
                    this.h.store.run('UPDATE conversation_assignments SET state=?,work=? WHERE id=?', 'WAITING', result.workId, assignment.id);
                return;
            }
            const id = this.publishResult(cid, assignmentId, result);
            const published = inspectConversationResult(this.h.store, id).result as ConversationTurnResult;
            if (assignment && assignment.state !== 'CANCELLED') {
                const delivered = published.status === 'delivered' && (!published.answer || published.answer.state === 'delivered');
                this.h.store.run('UPDATE conversation_assignments SET state=?,work=?,data=? WHERE id=?', delivered ? 'COMPLETE' : 'UNAVAILABLE', result.workId, JSON.stringify({ ...JSON.parse(assignment.data), result: published, resultId: id }), assignment.id);
                if (delivered)
                    this.h.store.run('UPDATE conversation_dependencies SET state=? WHERE assignment=?', 'RESOLVED', assignment.id);
            }
        });
    }
    private publishResult(cid: string, assignmentId: string | null, result: unknown) { return publishConversationResult(this.h.store, cid, assignmentId, result); }
    private pendingResumes = new Set<string>();
    private waitFingerprint(cid: string): string {
        const row = this.h.store.one('SELECT work,resource,data,direction FROM conversation_state WHERE conversation=?', cid), view = this.h.interactions.inspect(cid);
        const data = JSON.parse(row.data);
        delete data.continuationError;
        const work = row.work ? this.h.store.one('SELECT state,epoch,generation FROM works WHERE id=?', row.work) : null;
        const results = Array.isArray(data.waitHandles) ? data.waitHandles.map((id: string) => { const a = this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', id); return [a, a ? this.h.store.one("SELECT id FROM conversation_results WHERE conversation=? AND json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1", a.target, id) : null]; }) : null;
        const inputs = this.h.store.all("SELECT id,state FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED') ORDER BY rowid", cid);
        return JSON.stringify([row.work, row.resource, row.direction, data, view.generation, view.historyRef, view.nativeSessionId, work, results, inputs]);
    }
    private resumeDependents(explicit?: {conversationId: string; request: RunConversationOptions; validate: () => void}) {
        if (this.quiesced)
            return;
        try {
            this.h.assertOpen();
        }
        catch {
            return;
        }
        this.h.goals.observeDependencies();
        for (const row of this.h.store.all("SELECT * FROM conversation_state WHERE resource='WAITING'")) {
            if (explicit && row.conversation !== explicit.conversationId) continue;
            if (this.pendingResumes.has(row.conversation) || this.running.has(row.conversation))
                continue;
            try {
                this.h.assertTarget(row.conversation);
            }
            catch {
                continue;
            }
            const data = JSON.parse(row.data), handles = data.waitHandles;
            if (data.lifecycle?.deleted)
                continue;
            if (!data.continuationAuthorized || !Array.isArray(handles) || !handles.length)
                continue;
            if (this.h.store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED')", row.conversation))
                continue;
            const results = handles.map((id: string) => this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', id));
            if (results.some((r: any) => !r || r.state !== 'COMPLETE' && originalFailedWaitOutcome(this.h.store, row.conversation, r.id).state !== 'deliverable'))
                continue;
            const cid = row.conversation;
            if (!this.h.goals.canResume(cid))
                continue;
            const token = this.waitFingerprint(cid);
            const diagnose = (message: string) => {
                if (this.quiesced)
                    return;
                try {
                    this.h.assertOpen();
                    this.h.assertTarget(cid);
                    if (this.waitFingerprint(cid) !== token)
                        return;
                    const current = this.h.store.one('SELECT data,resource FROM conversation_state WHERE conversation=?', cid);
                    if (current.resource === 'WAITING')
                        this.h.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...JSON.parse(current.data), continuationError: message }), cid);
                }
                catch { /* A changed or closed owner receives no stale write. */ }
            };
            let request: RunConversationOptions;
            try {
                const work = this.h.store.one('SELECT data FROM works WHERE id=?', row.work), workData = work ? JSON.parse(work.data) : {};
                if (!work)
                    throw Error('Missing retained continuation work');
                const mode = Object.hasOwn(workData, 'conversationModelMode') ? captureConversationMode(workData.conversationModelMode) : null;
                if (mode?.kind === 'application')
                    request = { conversationId: cid, applicationConversation: { version: 1, choiceRevision: mode.choiceRevision } };
                else {
                    const model = explicit ? explicit.request.model : this.models.get(cid);
                    if (!model) {
                        diagnose('EXPLICIT_MODEL_REQUIRED: resume this retained conversation with its original explicit profile');
                        continue;
                    }
                    if (mode?.kind === 'explicit' && (mode.provider !== model.provider || mode.modelId !== model.modelId))
                        throw Error('Explicit continuation recipe differs');
                    request = { conversationId: cid, model };
                }
            }
            catch {
                diagnose('APPLICATION_MODEL_UNAVAILABLE: repair the retained target model mode');
                continue;
            }
            this.pendingResumes.add(cid);
            this.own(this.h.resolveOperation(captureConversationOptions(request), true, explicit?.validate).then(resolved => {
                explicit?.validate();
                return this.runInner(resolved);
            }).catch(() => {
                diagnose('APPLICATION_CONTINUATION_UNAVAILABLE: inspect the retained model, runtime, native history and pending inputs; authorization is preserved');
            }).finally(() => {
                this.pendingResumes.delete(cid);
                if (this.quiesced)
                    return;
                try {
                    if (this.h.store.one('SELECT resource FROM conversation_state WHERE conversation=?', cid).resource === 'WAITING' && this.waitFingerprint(cid) !== token)
                        this.resumeDependents();
                }
                catch { /* No retry after owner release. */ }
            }), true);
        }
    }
    resumeAuthorized() { this.resumeDependents(); }
    /** Restore only a supplied recipe; original WAIT/model/source admission still owns authority. */
    prepareGoalContinuation(conversationId: string, request: ConversationModelRequest): (validateGoal: () => void) => void {
        const captured = captureConversationOptions({conversationId, ...request});
        if (!captured.model || captured.applicationConversation || captured.model.runtime || captured.model.bridge && !captured.model.bridgeProfile)
            throw Error('EXPLICIT_MODEL_REQUIRED: use the original identifiable owned explicit profile');
        const state = this.h.store.one('SELECT work,resource,data FROM conversation_state WHERE conversation=?', conversationId);
        const data = state && JSON.parse(state.data), run = data?.runId && this.h.store.one('SELECT work,data FROM runs WHERE id=?', data.runId);
        const work = state?.work && this.h.store.one('SELECT data FROM works WHERE id=?', state.work);
        const mode = work && captureConversationMode(JSON.parse(work.data).conversationModelMode), expected = run && JSON.parse(run.data).modelIdentity;
        if (!state || state.resource !== 'WAITING' || !run || run.work !== state.work || mode?.kind !== 'explicit' ||
            mode.provider !== captured.model.provider || mode.modelId !== captured.model.modelId || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
            throw Error('EXPLICIT_MODEL_REQUIRED: original WAIT profile identity unavailable or different');
        const validateRecipe = () => {
            this.h.assertOpen();
            this.h.assertTarget(conversationId);
            if (captured.model!.runtime || captured.model!.bridge && !captured.model!.bridgeProfile)
                throw Error('EXPLICIT_MODEL_REQUIRED: retained WAIT cannot borrow an unidentifiable runtime');
            const original = this.h.store.one('SELECT work,data FROM runs WHERE id=?', data.runId);
            if (!original || original.work !== state.work || JSON.parse(original.data).modelIdentity !== expected ||
                createHash('sha256').update(JSON.stringify(modelConfigurationIdentity(captured.model!))).digest('hex') !== expected)
                throw Error('EXPLICIT_MODEL_REQUIRED: retained WAIT needs its exact original profile configuration');
        };
        validateRecipe();
        const token = this.waitFingerprint(conversationId);
        return validateGoal => {
            validateGoal(); validateRecipe();
            if (this.waitFingerprint(conversationId) !== token) throw Error('Original goal WAIT changed before resume');
            this.resumeDependents({conversationId, request: captured, validate: () => {validateGoal(); validateRecipe();}});
        };
    }
    private async execute(options: ResolvedConversationOptions, a: any, input: any, historyRef: string | null, nativeId: string | null, handle: {
        abort: AbortController;
        scope?: ContainerScope;
    }) {
        let answer: AnswerObservation | undefined;
        let coordinatorReport: CoordinatorReportObservation | undefined, reportDraft: CoordinatorReportDraft | undefined;
        const assigned = !!JSON.parse(a.work.data).assignmentId;
        const assignedDialogue = assigned && !options.manual && !options.userBash;
        let retained = false, clientClean = true;
        let failure: string | undefined;
        let scope: ContainerScope | undefined, lease: Awaited<ReturnType<Capacity['acquire']>> | undefined, cleanup = 'not-allocated', runtimeAttempted = false, pi: Awaited<ReturnType<typeof import('../pi/index.js')['createPiSession']>> | undefined, unsubscribe: (() => void) | undefined, status: ConversationTurnResult['status'] = 'unavailable', nativeResult: unknown;
        const nativeAbort = () => {
            void pi?.session.abort();
        };
        handle.abort.signal.addEventListener('abort', nativeAbort);
        const abort = () => {
            handle.abort.abort();
            nativeAbort();
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted)
            abort();
        try {
            lease = await this.h.capacity.acquire({ workId: a.work.id, runId: a.runId, epoch: a.work.epoch, kind: 'conversation', signal: handle.abort.signal });
            this.h.entry(a.runId);
            let operations: PiProjectOperations;
            if (a.work.project) {
                const project = this.h.store.one('SELECT * FROM projects WHERE id=?', a.work.project);
                this.h.patchRun(a.runId, 'CAPTURING', {});
                await privateDirectory(a.staging);
                const manifest = await capture(project.root, a.staging, JSON.parse(project.profile), handle.abort.signal).result;
                this.h.patchRun(a.runId, 'CAPTURED', { manifest, attainedCapture: true });
                const protectedPaths = await scopeProtection(this.h.store, a.runId, a.staging);
                this.h.patchRun(a.runId, 'RUNTIME_CREATING', {});
                runtimeAttempted = true;
                scope = await createScope({ ...a.runtimeProfile!, workRoot: a.staging, stateRoot: path.join(this.h.options.installationHome, 'state/runtime'), workId: a.work.id, runId: a.runId, protectedPaths, readOnlyWork: true, signal: handle.abort.signal });
                handle.scope = scope;
                operations = scope;
                this.h.patchRun(a.runId, 'RUNNING', { containerId: scope.containerId });
            }
            else {
                await privateDirectory(path.join(this.h.options.installationHome, 'control'));
                const cwd = path.join(this.h.options.installationHome, 'control', a.identity.conversationId);
                await privateDirectory(cwd);
                const deny = () => {
                    throw new Error('PROJECT_UNBOUND: select an explicit registered project; no host execution fallback');
                };
                operations = { workspaceRoot: cwd, validatePath: p => {
                        if (path.resolve(p) !== cwd)
                            deny();
                        return cwd;
                    }, exec: async () => deny(), readFile: async () => deny(), access: async () => deny(), writeFile: async () => deny(), mkdir: async () => deny() };
                cleanup = 'unbound';
                this.h.patchRun(a.runId, 'RUNNING', { unbound: true });
            }
            const goal = this.h.goals.context(a.identity);
            if (assignedDialogue)
                this.h.patchRun(a.runId, 'RUNNING', { ordinaryCoordinatorReportRequired: true });
            if (!goal?.strict)
                this.h.activateEffects(a.work.id);
            const { initializePiHost, createPiSession } = await import('../pi/index.js');
            const { SessionManager } = await import('@earendil-works/pi-coding-agent');
            const host = await initializePiHost({ stateRoot: path.join(this.h.options.installationHome, 'state'), artifactRoot: path.join(this.h.options.installationHome, 'artifacts') });
            let sessionManager;
            if (historyRef) {
                await this.h.interactions.history(a.identity.conversationId);
                const { ensurePiSessionDirectory } = await import('../pi/host.js');
                sessionManager = SessionManager.open(historyRef, await ensurePiSessionDirectory(host), operations.workspaceRoot);
                if (sessionManager.getSessionId() !== nativeId)
                    throw new Error('Native conversation identity mismatch');
            }
            const pendingLaunches: Array<() => void> = [];
            let waiting = false;
            const recordCoordinatorReport = (value: {
                text: string;
            }, toolCallId: string) => {
                this.h.entry(a.runId);
                if (!pi)
                    throw Error('Native report session unavailable');
                const direction = this.h.interactions.inspect(a.identity.conversationId).directionRevision;
                reportDraft = captureCoordinatorReport(pi.sessionManager, value.text, toolCallId, direction);
                return { recorded: true };
            };
            const controls = goal?.strict ? undefined : { ...(assignedDialogue ? { report: recordCoordinatorReport } : {}), ...coordination({ installationHome: this.h.options.installationHome, store: this.h.store, interactions: this.h.interactions, identity: a.identity, modelMode: options.modelMode, entry: () => this.h.entry(a.runId), delegation: JSON.parse(a.work.data).delegation, busyWork: id => this.h.busyWork?.(id) ?? false, cancel: (id, reason, actor) => this.h.cancelAssignment(id, reason, actor), launch: (cid, assignmentId, operation) => {
                        const dispatchToken = operation === 'change' ? assignmentDispatchToken(this.h.store, assignmentId) : null;
                        const ownsAssignment = () => { const row = this.h.store.one('SELECT state FROM conversation_assignments WHERE id=?', assignmentId); return row && ['QUEUED', 'RUNNING'].includes(row.state) && assignmentDispatchToken(this.h.store, assignmentId) === dispatchToken; };
                        pendingLaunches.push(() => {
                            if (this.quiesced)
                                return;
                            const task = Promise.resolve().then(() => {
                                if (operation === 'change' && !ownsAssignment())
                                    throw Error('Original assignment dispatch ownership changed');
                                validateContextAssignmentLaunch(this.h.store, assignmentId);
                                const request = this.h.assignmentModelRequest(assignmentId, options.model, options.modelMode);
                                return operation === 'change' ? this.h.launchChange(assignmentId, request) : this.run({ conversationId: cid, initialInputId: JSON.parse(this.h.store.one('SELECT data FROM conversation_assignments WHERE id=?', assignmentId).data).inputId, ...request });
                            });
                            this.own(task.then(async result => {
                                if (operation !== 'change' || !ownsAssignment())
                                    return;
                                const subject = this.h.store.one('SELECT id,project,source,epoch,generation,state FROM works WHERE id=?', (result as {workId: string}).workId);
                                const originalChange = subject && this.h.store.one('SELECT * FROM change_state WHERE work=?', subject.id);
                                const targetContext = () => {
                                    const row = this.h.store.one('SELECT c.project,c.generation,s.work,s.direction,s.resource,s.archived,s.native_id,s.data FROM conversations c JOIN conversation_state s ON s.conversation=c.id WHERE c.id=?', cid);
                                    if (!row) return null;
                                    const data = JSON.parse(row.data);
                                    return {project: row.project, generation: row.generation, work: row.work, direction: row.direction,
                                        resource: row.resource, archived: row.archived, nativeId: row.native_id,
                                        effectHold: data.effectHold ?? false, deleted: data.lifecycle?.deleted ?? false,
                                        contextOrigin: data.contextOrigin ?? null, contextFamilyRoot: data.contextFamilyRoot ?? null,
                                        nativeInputRecovery: data.nativeInputRecovery ?? null};
                                };
                                const originalTarget = JSON.stringify(targetContext());
                                const sourceImpacts = () => JSON.stringify(this.h.interactions.impacts(subject.id));
                                const originalImpacts = subject && sourceImpacts();
                                const originalHold = (result as {reviewReady: boolean}).reviewReady ? recoveredCompletionHold(this.h.store, assignmentId) : null;
                                const validateResult = () => {
                                    this.h.assertOpen();
                                    const assignment = this.h.store.one('SELECT target,work FROM conversation_assignments WHERE id=?', assignmentId);
                                    const current = subject && this.h.store.one('SELECT id,project,source,epoch,generation,state FROM works WHERE id=?', subject.id);
                                    const target = targetContext();
                                    if (!ownsAssignment() || !subject || !current || assignment?.target !== cid || assignment.work !== subject.id ||
                                        !target || target.work !== subject.id || target.project !== subject.project ||
                                        JSON.stringify(current) !== JSON.stringify(subject) || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(current.state) ||
                                        current.epoch !== (result as {epoch: number}).epoch ||
                                        JSON.stringify(targetContext()) !== originalTarget || sourceImpacts() !== originalImpacts ||
                                        JSON.stringify(this.h.store.one('SELECT * FROM change_state WHERE work=?', subject.id)) !== JSON.stringify(originalChange))
                                        throw Error('Original governed result context changed before publication');
                                    if (((result as {reviewReady: boolean}).reviewReady ? recoveredCompletionHold(this.h.store, assignmentId) : null) !== originalHold)
                                        throw Error('Original governed completion hold changed before publication');
                                    if ((result as {reviewReady: boolean}).reviewReady && this.h.interactions.impacts(subject.id).some(input => input.data.effectHold))
                                        throw Error('Original governed result retains unconsumed owner input');
                                };
                                validateResult();
                                const change = originalChange;
                                const selection = change ? JSON.parse(change.data).selection ?? {} : {};
                                const checkIds = change ? this.h.store.all('SELECT id FROM check_runs WHERE work=? AND candidate=? AND verification=?', subject.id, change.candidate, change.verification).map(row => row.id) : [];
                                const verification = (result as {reviewReady: boolean}).reviewReady ? this.h.verificationEvidence?.(subject.id) : undefined;
                                const compact = await prepareGovernedResult(this.h.options.installationHome, { ...(result as object), state: subject.state,
                                    ...(originalHold ? {assignmentHold: originalHold} : {}),
                                    selectedEvidence: {selectionIdsDigest: createHash('sha256').update(JSON.stringify(selection)).digest('hex'), sourceImpactsDigest: createHash('sha256').update(originalImpacts).digest('hex'),
                                        ...(verification ? {verificationStrategyDigest: verification.digest} : {}), checkIds, reviewLaunchIds: Object.values(selection)} }, validateResult);
                                validateResult();
                                this.h.store.tx(() => {
                                    validateResult();
                                    const assignment = this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
                                    if ((result as { workId?: string }).workId !== assignment.work)
                                        throw Error('Assigned completion work correspondence changed');
                                    const reviewReady = (result as { reviewReady?: boolean }).reviewReady;
                                    const hold = reviewReady ? recoveredCompletionHold(this.h.store, assignmentId) : null;
                                    if (hold !== originalHold) throw Error('Original governed completion hold changed before settlement');
                                    const resultId = this.publishResult(cid, assignmentId, compact);
                                    const published = inspectConversationResult(this.h.store, resultId);
                                    if (published.assignmentId !== assignmentId || published.conversationId !== cid || published.workId !== assignment.work)
                                        throw Error('Assigned result publication correspondence changed');
                                    const complete = reviewReady && !hold && (published.result as { reviewReady?: boolean }).reviewReady === true;
                                    const data = JSON.stringify({ ...JSON.parse(assignment.data), result: published.result, resultId, ...(hold ? { error: hold } : {}) });
                                    if (Buffer.byteLength(data) > 64 * 1024) throw Error('Governed assignment metadata exceeds64KiB');
                                    this.h.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', complete ? 'COMPLETE' : 'UNAVAILABLE', data, assignmentId);
                                    if (complete)
                                        this.h.store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE assignment=? AND state='PENDING'", assignmentId);
                                });
                                this.resumeDependents();
                            }).catch(error => {
                                if (operation === 'change' && !ownsAssignment())
                                    return;
                                if (error instanceof ContextAssignmentRetained) {
                                    this.h.observe(a.runId, { kind: 'assignment-original-retained', assignmentId, workId: error.workId });
                                    return;
                                }
                                if (operation === 'change' && !ownsAssignment() || this.h.store.one('SELECT state FROM conversation_assignments WHERE id=?', assignmentId).state === 'CANCELLED')
                                    return;
                                this.h.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'UNAVAILABLE', JSON.stringify({ ...JSON.parse(this.h.store.one('SELECT data FROM conversation_assignments WHERE id=?', assignmentId).data), error: String(error) }), assignmentId);
                                this.h.observe(a.runId, { kind: 'assignment-launch-unavailable', conversationId: cid, error: String(error) });
                                this.h.goals.observeDependencies();
                            }), true);
                        });
                    }, onWait: () => {
                        waiting = true;
                    } }), ...this.h.effectControls(a.identity, receipt => {
                    const dispatchToken = assignmentDispatchToken(this.h.store, receipt.assignmentId);
                    const original = this.h.store.one('SELECT work,data FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                    const originalData = JSON.parse(original.data), source = JSON.stringify(originalData.source);
                    const effectResource = (resultPhase?: string) => {
                        const work = this.h.store.one('SELECT state FROM works WHERE id=?', original.work);
                        const operation = this.h.store.one('SELECT work,phase FROM effect_operations WHERE id=?', receipt.operationId);
                        return resultPhase === 'UNKNOWN' || work?.state === 'UNKNOWN' ||
                            operation?.work === original.work && ['UNKNOWN', 'INVOKING'].includes(operation.phase) ? 'UNKNOWN' : 'IDLE';
                    };
                    const ownsEffect = () => {
                        const row = this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                        if (!row || !['QUEUED', 'RUNNING'].includes(row.state) || row.target !== receipt.conversationId || row.work !== original.work) return false;
                        const data = JSON.parse(row.data);
                        return data.operation === originalData.operation && data.effectOperationId === receipt.operationId && JSON.stringify(data.source) === source &&
                            assignmentDispatchToken(this.h.store, receipt.assignmentId) === dispatchToken;
                    };
                    pendingLaunches.push(() => {
                        if (this.quiesced || !ownsEffect())
                            return;
                        this.own(this.h.launchEffect(receipt.assignmentId, options.model).then(result => {
                            this.h.store.tx(() => {
                                if (!ownsEffect()) return;
                                const assignment = this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                                const operation = this.h.store.one('SELECT * FROM effect_operations WHERE id=?', receipt.operationId);
                                const data = operation && JSON.parse(operation.data);
                                const matchingFamily = matchesEffectAssignmentProfile(originalData.operation, data?.kind);
                                if (!matchingFamily || result.operationId !== receipt.operationId || result.workId !== assignment.work || !operation || operation.work !== assignment.work ||
                                    data.assignmentId !== assignment.id || data.conversationId !== receipt.conversationId ||
                                    result.phase === 'CONFIRMED' && operation.phase !== 'CONFIRMED')
                                    throw Error('Effect completion operation correspondence changed');
                                const resultId = this.publishResult(receipt.conversationId, receipt.assignmentId, result);
                                const published = inspectConversationResult(this.h.store, resultId);
                                if (published.assignmentId !== receipt.assignmentId || published.conversationId !== receipt.conversationId || published.workId !== assignment.work)
                                    throw Error('Effect result publication correspondence changed');
                                const complete = (published.result as { phase?: string }).phase === 'CONFIRMED';
                                this.h.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', complete ? 'COMPLETE' : 'UNAVAILABLE', JSON.stringify({ ...JSON.parse(assignment.data), result: published.result, resultId }), receipt.assignmentId);
                                this.h.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', effectResource(result.phase), receipt.conversationId);
                                if (complete)
                                    this.h.store.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE assignment=? AND state='PENDING'", receipt.assignmentId);
                            });
                            this.resumeDependents();
                        }).catch(error => {
                            let published = false;
                            try {
                                this.h.store.tx(() => {
                                    if (!ownsEffect()) return;
                                    const assignment = this.h.store.one('SELECT * FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                                    const result = { status: 'unavailable', operationId: receipt.operationId, error: String(error) };
                                    const resultId = this.publishResult(receipt.conversationId, receipt.assignmentId, result);
                                    this.h.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'UNAVAILABLE', JSON.stringify({ ...JSON.parse(assignment.data), error: String(error), result, resultId }), receipt.assignmentId);
                                    this.h.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', effectResource(), receipt.conversationId);
                                    published = true;
                                });
                            } catch (publicationError) {
                                // Preserve a distinct failed publication without leaving an apparently
                                // running assignment or accepting an uncommitted completion/result.
                                this.h.store.tx(() => {
                                    if (!ownsEffect()) return;
                                    const assignment = this.h.store.one('SELECT data,work FROM conversation_assignments WHERE id=?', receipt.assignmentId);
                                    this.h.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'UNAVAILABLE', JSON.stringify({ ...JSON.parse(assignment.data), error: String(error), resultPublicationError: String(publicationError) }), receipt.assignmentId);
                                    this.h.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', effectResource(), receipt.conversationId);
                                    this.h.observe(a.runId, { kind: 'assignment-publication-unavailable', assignmentId: receipt.assignmentId, error: String(publicationError) });
                                });
                                throw publicationError;
                            }
                            if (published) this.h.goals.observeDependencies();
                        }), true);
                    });
                }) };
            let requests = 0;
            pi = await createPiSession({ host, operations, requestLanguagePolicy: () => conversationLanguagePolicy(this.h.store, a.identity.conversationId, !!JSON.parse(a.work.data).assignmentId, !!goal?.strict), ...(controls ? { coordination: controls } : {}), ...(goal ? { goal: goal.controls, readOnly: goal.strict } : {}), model: options.model, maxReadBytes: 1024 * 1024, systemPrompt: 'Configured integration grants (not proof of procedure or current authority): ' + JSON.stringify(goal?.strict ? { reviewOnly: true } : this.h.effectContext(a.work.id)) + '. Current host-bound scope: ' + JSON.stringify({ projectId: a.work.project, workId: a.work.id, scopeTransition: JSON.parse(a.work.data).scopeTransition ?? null }) + ' Older history may describe prior scopes; only current owned operations address current project. ' + ' This is an ordinary conversation and read-only investigation. Answer the retained owner input naturally; preserve uncertainty and earlier obligations. Project writes, governed implementation, review-ready standing, publication and merge require the separate governed workflow. Project-unbound conversations cannot execute or access project/host files.' + (goal ? '\n' + goal.systemPrompt : ''), beforeModelRequest: async (manager) => {
                    this.h.entry(a.runId);
                    this.h.goals.assertCurrent(a.identity);
                    if (handle.abort.signal.aborted || ++requests > 16)
                        throw new Error('Conversation request cancelled or finite16-request allowance exhausted');
                    const cp = await nativeCheckpoint(manager.getSessionFile()!);
                    this.h.goals.assertCurrent(a.identity);
                    this.h.modelDispatch(a.runId, cp);
                }, onModelDispatch: model => { this.h.entry(a.runId); this.h.observe(a.runId, { type: 'resolved-model', model }); }, ...(sessionManager ? { sessionManager } : {}) });
            this.h.history(a.runId, pi.sessionManager.getSessionFile()!, pi.sessionManager.getSessionId());
            let initial = true, settled = false;
            unsubscribe = pi.session.subscribe(event => {
                if (event.type === 'message_end' && event.message.role === 'user') {
                    this.h.patchRun(a.runId, 'RUNNING', { nativeInputObserved: true });
                    if (initial) {
                        initial = false;
                        this.h.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONSUMED', input.id);
                        this.h.interactions.inputConsumed(a.identity);
                    }
                    this.h.observe(a.runId, { type: 'native-user-boundary', initialInputId: input.id });
                }
                if (event.type === 'agent_settled') {
                    settled = true;
                    this.h.interactions.lifecycle.settling(a.identity);
                }
                if (event.type === 'tool_execution_end' && ['conversation_assign', 'conversation_integrate', 'conversation_merge', 'conversation_publish', 'conversation_publish_contribution'].includes(event.toolName))
                    pendingLaunches.shift()?.();
                if (event.type === 'tool_execution_end')
                    this.h.observe(a.runId, { type: event.type, toolCallId: event.toolCallId, result: event.result });
            });
            this.h.interactions.lifecycle.ready({ identity: a.identity, session: pi.session, sessionManager: pi.sessionManager, executeUserBash: pi.executeUserBash });
            const before = pi.session.messages.length;
            const beforeEntries = new Set(pi.sessionManager.getBranch().map(e => e.id));
            await this.h.interactions.deliverNotices(a.identity.conversationId);
            const timeout = setTimeout(abort, 180000);
            try {
                this.h.entry(a.runId);
                if (handle.abort.signal.aborted)
                    throw new Error('Response interrupted');
                this.h.patchRun(a.runId, 'RUNNING', options.manual ? { nativeManualAttempted: options.manual.kind } : options.userBash ? { nativeUserBashAttempted: true } : { nativePromptAttempted: true });
                if (options.manual) {
                    if (options.manual.kind === 'compact')
                        nativeResult = await pi.compactOwned(options.manual.instructions, handle.abort.signal);
                    else {
                        if (!pi.sessionManager.getEntry(options.manual.entryId))
                            throw new Error('Tree entry is not in owned native history');
                        const result = await pi.navigateTreeOwned(options.manual.entryId, handle.abort.signal);
                        if (result.cancelled || result.aborted)
                            throw new Error('Native tree navigation unavailable/cancelled');
                        const marker = pi.sessionManager.appendCustomEntry('gitjig.owner-tree-navigation', { sourceId: input.source, workId: a.work.id, runId: a.runId, targetEntryId: options.manual.entryId });
                        nativeResult = { ...result, marker, targetEntryId: options.manual.entryId };
                    }
                    this.h.observe(a.runId, { kind: 'native-manual-action', action: options.manual.kind, historyRef: pi.sessionManager.getSessionFile(), leafId: pi.sessionManager.getLeafId() });
                    this.h.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONSUMED', input.id);
                    settled = true;
                }
                else if (options.userBash) {
                    const receipt = await pi.executeUserBash(options.userBash.command, handle.abort.signal, { excludeFromContext: options.userBash.excludeFromContext, id: a.runId, onChunk: delta => this.h.observe(a.runId, { type: 'bash_execution_update', delta }) });
                    this.h.observe(a.runId, { kind: 'native-user-bash', command: options.userBash.command, excludeFromContext: options.userBash.excludeFromContext, receipt });
                    this.h.store.run('UPDATE conversation_inputs SET state=? WHERE id=?', 'CONSUMED', input.id);
                    settled = true;
                }
                else {
                    const prepared = await prepareCapturedInput(this.h.store, path.join(this.h.options.installationHome, 'state'), input.id, { identity: a.identity, kind: 'initial' });
                    this.h.entry(a.runId);
                    if (handle.abort.signal.aborted || this.h.store.one('SELECT state FROM conversation_inputs WHERE id=?', input.id)?.state !== 'INITIAL_RESERVED')
                        throw new Error('Initial captured input was cancelled or superseded before dispatch');
                    const bound = assertCapturedInputRun(this.h.store, input.id, a.identity, 'initial', prepared.comparison);
                    if (bound.row.source !== input.source || bound.row.text !== input.text || bound.row.data !== input.data)
                        throw new Error('Initial captured input changed before dispatch');
                    if (prepared.comparison)
                        this.h.store.run('UPDATE runs SET data=? WHERE id=?', JSON.stringify({ ...bound.data, initialInputComparison: prepared.comparison }), a.runId);
                    await pi.session.prompt(prepared.text);
                }
            }
            finally {
                clearTimeout(timeout);
            }
            this.h.interactions.lifecycle.settling(a.identity);
            await this.h.interactions.drainNativeInputs(a.identity);
            const cp = await nativeCheckpoint(pi.sessionManager.getSessionFile()!);
            this.h.checkpoint(a.runId, cp);
            const last = pi.session.messages.slice(before).filter(m => m.role === 'assistant').at(-1);
            status = handle.abort.signal.aborted ? 'interrupted' : waiting ? 'waiting' : (options.userBash || options.manual) && settled ? 'delivered' : settled && last?.stopReason === 'stop' ? 'delivered' : 'unavailable';
            if (!options.manual && !options.userBash && status === 'delivered') {
                const entries = pi.sessionManager.getBranch().filter(e => !beforeEntries.has(e.id));
                const current = entries.filter(e => e.type === 'message' && e.message.role === 'assistant').at(-1);
                const proof = { runId: a.runId, generation: a.identity.generation, inputId: input.id, sessionId: pi.sessionManager.getSessionId(), nativeEntryId: current?.id ?? '', checkpoint: cp };
                const body = last?.content;
                const valid = current?.type === 'message' && current.message.role === 'assistant' && JSON.stringify(current.message) === JSON.stringify(last) && entries.some(e => e.type === 'message' && e.message.role === 'user') && Array.isArray(body) && body.some(b => b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) && body.every(b => b.type === 'text' ? typeof b.text === 'string' : b.type === 'thinking' && typeof b.thinking === 'string');
                if (valid) {
                    const text = body.filter((b): b is {
                        type: 'text';
                        text: string;
                    } => b.type === 'text').map(b => ({ type: 'text' as const, text: b.text }));
                    answer = { kind: 'ordinary-answer/v1', state: 'delivered', producer: proof, text, textSha256: createHash('sha256').update(JSON.stringify(text)).digest('hex') };
                    // Leave room for the complete immutable result/audience/provenance envelope.
                    if (Buffer.byteLength(JSON.stringify(answer)) > 96 * 1024) {
                        answer = { kind: 'ordinary-answer/v1', state: 'unavailable', code: 'ANSWER_BOUND', producer: proof };
                        status = 'unavailable';
                    }
                }
                else {
                    answer = { kind: 'ordinary-answer/v1', state: 'unavailable', code: 'ANSWER_PRODUCER_UNAVAILABLE', producer: proof };
                    status = 'unavailable';
                }
                if (assigned && answer?.state === 'delivered')
                    coordinatorReport = collectCoordinatorReport(pi.sessionManager, reportDraft, proof, this.h.interactions.inspect(a.identity.conversationId).directionRevision, !!this.h.store.one("SELECT i.id FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.state IN ('QUEUED','NATIVE_PENDING') AND json_extract(s.origin,'$.kind')='owner-conversation-input' LIMIT 1", a.identity.conversationId));
            }
            if (answer?.state === 'delivered')
                this.h.patchRun(a.runId, 'RUNNING', { ordinaryAnswerHash: createHash('sha256').update(JSON.stringify(answer)).digest('hex'), ordinaryAnswerEntryId: answer.producer.nativeEntryId, ordinaryAnswerStartEntryId: [...beforeEntries].at(-1) ?? null });
            if (coordinatorReport?.state === 'delivered')
                this.h.patchRun(a.runId, 'RUNNING', { ordinaryReportHash: createHash('sha256').update(JSON.stringify(coordinatorReport)).digest('hex'), ordinaryReportEntryId: coordinatorReport.producer.nativeEntryId, ordinaryReportToolResultEntryId: coordinatorReport.producer.toolResultEntryId });
            if (status === 'unavailable')
                failure = (last?.errorMessage ?? 'The model response was unavailable; inspect the retained run diagnostics.').slice(0, 4096);
            if (status === 'unavailable')
                this.h.observe(a.runId, { kind: 'native-terminal-unavailable', settled, stopReason: last?.stopReason ?? 'no-current-assistant', errorMessage: last?.errorMessage ?? null });
        }
        catch (error) {
            failure = String(error).slice(0, 4096);
            this.h.observe(a.runId, { kind: 'ordinary-response-unavailable', error: String(error) });
            if (handle.abort.signal.aborted)
                status = 'interrupted';
        }
        finally {
            if (pi) {
                let checkpointReady = false;
                try {
                    this.h.interactions.lifecycle.settling(a.identity);
                    await this.h.interactions.drainNativeInputs(a.identity);
                    try {
                        const cp = await nativeCheckpoint(pi.sessionManager.getSessionFile()!);
                        this.h.checkpoint(a.runId, cp);
                        checkpointReady = true;
                    }
                    catch { }
                    unsubscribe?.();
                    pi.sealOwned();
                    if (this.h.completed.enabled && !pi.canRetainOwned)
                        this.h.observe(a.runId, { kind: 'completed-client-not-retained', reason: 'borrowed-runtime-not-owned' });
                    if (checkpointReady && this.h.completed.enabled && pi.canRetainOwned && status === 'delivered' && !options.manual && !options.userBash) {
                        try {
                            await pi.joinIdleOwned();
                            retained = true;
                        }
                        catch {
                            this.h.observe(a.runId, { kind: 'completed-client-not-retained', reason: 'idle-join-unavailable' });
                        }
                    }
                    if (!retained)
                        await pi.closeOwned();
                }
                catch (error) {
                    retained = false;
                    clientClean = false;
                    this.h.completed.quarantine(a.identity, pi, error);
                    try {
                        await pi.closeOwned();
                    }
                    catch { }
                }
                finally {
                    try {
                        this.h.interactions.lifecycle.released(a.identity);
                    }
                    catch (error) {
                        clientClean = false;
                        retained = false;
                        this.h.completed.quarantine(a.identity, pi, error);
                        try {
                            await pi.closeOwned();
                        }
                        catch { }
                    }
                }
            }
            if (scope) {
                try {
                    cleanup = (await scope.close()).state;
                }
                catch {
                    cleanup = 'quarantined';
                }
            }
            else if (runtimeAttempted) {
                try {
                    cleanup = await this.h.reconcile(a.runId, a.work.id);
                }
                catch {
                    cleanup = 'quarantined';
                }
            }
            try {
                if (!clientClean)
                    cleanup = 'quarantined-owned-client';
                this.h.store.tx(() => {
                    if (this.h.store.one('SELECT state FROM works WHERE id=?', a.work.id).state === 'CANCELLED')
                        status = 'cancelled';
                    if (status === 'interrupted')
                        this.h.store.run('UPDATE conversation_inputs SET state=?,data=? WHERE id=?', 'QUEUED', JSON.stringify({ ...JSON.parse(input.data), interruptedRun: a.runId }), input.id);
                    this.h.settleBudget(a.runId);
                    this.h.patchRun(a.runId, cleanup.startsWith('quarantined') ? 'UNKNOWN' : 'SETTLED', { cleanup, outcome: status });
                    if (options.manual)
                        this.h.interactions.settleManualInput(a.runId);
                    if (cleanup.startsWith('quarantined'))
                        this.h.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', a.work.id);
                });
                this.h.interactions.cleanup(a.identity, { cleanup, settled: true });
                lease?.release({ cleanup, settled: clientClean });
                if (retained && pi && !['removed', 'not-allocated', 'unbound'].includes(cleanup)) {
                    retained = false;
                    try {
                        await pi.closeOwned();
                    }
                    catch (error) {
                        this.h.completed.quarantine(a.identity, pi, error);
                    }
                }
                if (status === 'waiting' && ['removed', 'not-allocated', 'unbound'].includes(cleanup))
                    this.h.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'WAITING', a.identity.conversationId);
            }
            catch (error) {
                if (pi && retained) {
                    try {
                        await pi.closeOwned();
                    }
                    catch (cleanupError) {
                        this.h.completed.quarantine(a.identity, pi, cleanupError);
                    }
                }
                throw error;
            }
            options.signal?.removeEventListener('abort', abort);
            handle.abort.signal.removeEventListener('abort', nativeAbort);
        }
        if (!['removed', 'not-allocated', 'unbound'].includes(cleanup)) {
            status = 'unavailable';
            if (answer)
                answer = { kind: 'ordinary-answer/v1', state: 'unavailable', code: 'CLEANUP_UNAVAILABLE', producer: answer.producer };
        }
        if (coordinatorReport && status !== 'delivered')
            coordinatorReport = { kind: coordinatorReport.kind, state: 'unavailable', code: 'COORDINATOR_REPORT_RUN_UNAVAILABLE', producer: coordinatorReport.producer };
        else if (coordinatorReport?.state === 'delivered' && !coordinatorReportCurrent(this.h.store, a.identity.conversationId, coordinatorReport))
            coordinatorReport = { kind: coordinatorReport.kind, state: 'unavailable', code: 'COORDINATOR_REPORT_STALE', producer: coordinatorReport.producer };
        const result = { conversationId: a.identity.conversationId, workId: a.work.id, runId: a.runId, status, cleanup, ...(failure ? { failure: failure } : {}), ...(nativeResult !== undefined ? { nativeResult } : {}), ...(answer ? { answer } : {}), ...(coordinatorReport ? { coordinatorReport } : {}) } satisfies ConversationTurnResult;
        // Private physical ownership transfers to runInner only after actual cleanup.
        return { result, completedClient: retained ? pi : undefined };
    }
}

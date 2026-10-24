import { originalFailedWaitOutcome } from './original-wait-outcome.js';
import { inspectQueuedAssignmentCancellation, type QueuedAssignmentCancellationInput } from './queued-assignment-cancellation.js';
import { inspectEffectAssignmentObligations } from './effect-assignment-provenance.js';
import { inspectAssignedWorkObligations } from './assigned-work-provenance.js';
import { reconcileCompletedAssignmentResults } from './assignment-result-reconciliation.js';
import { inspectPendingInputs } from './input-recovery.js';
import { inspectConversationProgress } from './conversation-progress.js';
import { inspectStartupCleanupRecovery, assertStartupCleanupSnapshot, assertUniqueStartupJournal } from './startup-cleanup-recovery.js';
import { validCreateRejectionEvidence } from '../execution/create-rejection.js';
import { conversationLanguage, writeConversationLanguage } from './conversation-language.js';
import { effectiveAssignmentAuthority, propagateRecoveredOwnerSources } from './assignment-authority.js';
import { integrationGrantHistory } from './integration-grant-history.js';
import { integrationDelegation, integrationDelegationWorks } from './integration-delegation.js';
import { listIntegrationTargets, inspectIntegrationTarget, type IntegrationTargetPage } from './integration-targets.js';
import { initialWorkAllowance, listLocalChecks, inspectLocalCheck, type LocalCheckView } from './local-checks.js';
import { inspectConfigurationTarget, listConfigurationTargets, listConfigurationPlans, type ConfigurationDiscoveryOptions } from './configuration-discovery.js';
import { ordinaryWorkRecovery, workAllowance, assertAllowanceExtension, workFamilyUnsettled, type WorkAllowanceSnapshot } from './work-recovery.js';
import { contextWorkRecovery } from './context-admission-recovery.js';
import { contextAdmissionProof } from './context-admission-proof.js';
import { pendingOwnerRoot } from './owner-activation.js';
import { Goals } from './goals.js';
import { captureWorkModelBaseline, captureConversationOptions, captureConversationMode, captureAssignmentModelBinding, type WorkModelBaseline, type ApplicationModelResolver } from './application-model.js';
import { captureNativeModelSelection, modelConfigurationIdentity } from '../pi/model-identity.js';
import { assertOwnedClaudeApplicationSelection, ownedClaudeAuthorityRoots } from '../pi/claude-host.js';
import { captureApplicationModelOperation, subjectRoleModel } from './application-model.js';
import { captureSessionPreferences } from '../pi/session-preferences.js';
import { inspectContextStatus } from './context-status.js';
import { CompletedResources, resourcePolicy, lifecycleReasons, assertConversationExecutable, assertWorkConversation } from './completed-resources.js';
import { conversationModelChoice, writeConversationModelChoice, validateModelChoice, type ModelChoiceInput } from './model-choice.js';
import { inspectConversationResult, inspectConversationResultDetail } from './conversation-results.js';
import { Contributions } from './contributions.js';
import { ProjectProtection, projectProtection, assertRunProtection, scopeProtection } from './protection.js';
import { assertNoPendingActivation, assertNoPendingReset } from '../installation/gate.js';
import { hash } from './change-files.js';
import type { PublicationCredential, RegisterPublicationTarget, DelegatePublication, PrepareOwnerPublication, PublicationDelegationConfig } from './publication-types.js';
import { Effects } from './effects.js';
import type { RegisterLocalTarget, DelegateIntegration, PrepareIntegration } from './effect-types.js';
import { coordination } from './coordination.js';
import { Ordinary } from './ordinary.js';
import { ownerChangeRoute, validateContextAssignmentLaunch } from './context-coordination.js';
import { admitOwnerChange, contextWorkMetadata, contextBinding } from './context-origin.js';
import { forkConversation, type ForkConversationInput } from './context-producer.js';
import fs from 'node:fs/promises';
import { ChangeCore } from './change-core.js';
import type { BeginChangeOptions, ChangeOperation, DriveChangeOptions, StartConversationChangeOptions, ResumeConversationChangeOptions, ChangeView } from './change-types.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Capacity } from './capacity.js';
import { Interactions } from './interaction.js';
import { createScope, reconcileScope, settleRejectedScopeCreate, validateRuntimeProfile, trustedDockerBinary, trustedDockerConfiguration, type ContainerScope } from '../execution/container-scope.js';
import { Store } from './store.js';
import { capture, validateCaptureProfile, type Manifest } from './capture.js';
import { privateDirectory, privateFile, acquireOwner, inside } from './ownership.js';
import { ControllerError, type ControllerOptions, type Project, type LocalCheckOptions, type ConversationOptions, type InvestigationExecutionOptions, type ObservationResult, type WorkView, type CaptureProfile, type RuntimeProfile } from './types.js';
interface Active {
    retainedIntegrationRead?: true;
    abort: AbortController;
    scope?: ContainerScope;
    workerStop?: () => Promise<number>;
    done?: Promise<unknown>;
}
const parse = (value: string) => JSON.parse(value);
const id = (value: string) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(value))
        throw new ControllerError('INVALID_ID', 'Invalid explicit ID', 'Use letters, digits, dash and underscore');
    return value;
};
export class Controller {
    private assignmentPreparations = new Set<{ conversationId: string }>();
    private managedOperations = new Map<string, {
        token: symbol;
        workId: string | null;
        abort: AbortController;
        done: Promise<ChangeView>;
    }>();
    private assertManagedDispatch(workId: string) {
        if ([...this.managedOperations.values()].some(operation => operation.workId === workId))
            throw Error('Managed work supervisor active; wait for settlement or cancel the original work');
    }
    private goalCore?: Goals;
    private get goals(): Goals { return this.goalCore ??= new Goals({ store: this.store, interactions: this.interactions, assertOpen: () => this.assertOpen(), run: input => this.runConversation(input), reviewer: (run, model) => this.resolveGoalReviewer(run, model), evidence: work => this.changes.currentEvidence(work), assertEvidence: value => this.changes.assertCurrentEvidence(value), verificationEvidence: work => this.changes.inspectVerificationEvidence(work), ownerRootProfile: () => this.effects.ownerRootProfile(), prepareDependencyResume: (cid, request) => this.ordinary.prepareGoalContinuation(cid, request), resumeDependencies: () => this.ordinary.resumeAuthorized() }); }
    initializeGoalRecovery(): void { void this.goals; }
    createGoal(input: Parameters<Goals['create']>[0]) {
        this.assertOpen();
        this.assertManagedTarget(input.conversationId);
        assertConversationExecutable(this.store, input.conversationId);
        if (this.lifecycleBusy.has(input.conversationId))
            throw Error('Conversation lifecycle operation active');
        return this.goals.create(input);
    }
    inspectGoal(id: string) { this.assertOpen(); return this.goals.inspect(id); }
    conversationGoal(cid: string) { this.assertOpen(); this.interactions.inspect(cid); return this.goals.forConversation(cid); }
    listGoals() { this.assertOpen(); return this.goals.list(); }
    pendingGoalInput(id: string) { this.assertOpen(); return this.goals.pendingInputs(id); }
    reviseGoal(input: Parameters<Goals['revise']>[0]) { return this.goals.revise(input); }
    extendGoal(input: Parameters<Goals['extend']>[0]) { return this.goals.extend(input); }
    pauseGoal(input: Parameters<Goals['stop']>[0]) { return this.goals.stop(input); }
    startGoal(input: Parameters<Goals['start']>[0]) { this.assertExecutionAdmission(); return this.goals.start(input); }
    waitGoal(id: string) { return this.goals.wait(id); }
    interruptGoal(id: string) { return this.goals.interrupt(id); }
    subscribeGoals(fn: () => void) { return this.goals.subscribe(fn); }
    private async resolveGoalReviewer(runId: string, fallback: import('../pi/session.js').PiModelSelection) {
        this.assertOpen();
        this.assertExecutionAdmission();
        const run = this.store.one('SELECT * FROM runs WHERE id=?', runId);
        if (!run || run.phase !== 'SETTLED')
            throw Error('Exact settled author subject required');
        const work = this.work(run.work), subject = subjectRoleModel(this.store, work.id), before = hash([work.epoch, work.generation, subject]);
        if (subject.ordinary?.sourceRunId !== runId)
            throw Error('Goal author model baseline changed');
        const model = subject.baseline ? await this.applicationModelResolver?.resolveRole({ workId: work.id, epoch: work.epoch, generation: work.generation, role: 'reviewer', baseline: subject.baseline, ...(fallback.sessionPreferences ? { sessionPreferences: captureSessionPreferences(fallback.sessionPreferences)! } : {}) }) : captureNativeModelSelection(fallback);
        if (!model)
            throw Error('Original application reviewer resolver unavailable');
        this.assertOpen();
        const now = this.work(work.id);
        if (hash([now.epoch, now.generation, subjectRoleModel(this.store, work.id)]) !== before)
            throw Error('Goal author/source changed during reviewer model resolution');
        if (subject.explicit && (model.provider !== subject.explicit.provider || model.modelId !== subject.explicit.modelId))
            throw Error('Explicit goal reviewer route differs from originating subject');
        if (subject.baseline)
            this.assertApplicationModelSource(model);
        return model;
    }
    private applicationModelResolver?: Readonly<ApplicationModelResolver>;
    getWorkApplicationModelBaseline(workId: string): WorkModelBaseline | undefined {
        this.assertOpen();
        return subjectRoleModel(this.store, workId).baseline;
    }
    installApplicationModelResolver(resolver: ApplicationModelResolver, options: {
        resumeAuthorized?: boolean;
    } = {}): void {
        this.assertOpen();
        this.assertExecutionAdmission();
        if (this.applicationModelResolver || this.active.size)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: install the application resolver once before execution');
        if (!resolver || typeof resolver.resolveRole !== 'function' || typeof resolver.resolveConversation !== 'function')
            throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid resolver');
        if (Object.hasOwn(resolver, 'resolveBaseline') && typeof resolver.resolveBaseline !== 'function')
            throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid baseline resolver');
        this.applicationModelResolver = Object.freeze({ resolveRole: resolver.resolveRole.bind(resolver), resolveConversation: resolver.resolveConversation.bind(resolver),
            ...(typeof resolver.resolveBaseline === 'function' ? { resolveBaseline: resolver.resolveBaseline.bind(resolver) } : {}) });
        if (options.resumeAuthorized !== false)
            this.ordinary.resumeAuthorized();
    }
    private contextInputs = new Set<Promise<unknown>>();
    private contextAbort = new AbortController();
    completeConversationFiles(input: {
        conversationId: string;
        expectedGeneration: number;
        draftRevision: number;
        prefix: string;
    }, signal?: AbortSignal) {
        const task = (async () => {
            input = structuredClone(input);
            this.assertOpen();
            const before = this.interactions.inspect(input.conversationId);
            if (before.deleted || before.archived || before.generation !== input.expectedGeneration || before.draft.revision !== input.draftRevision || !before.projectId)
                throw new Error('Select a registered project with an unchanged draft for file completion');
            const project = this.store.one('SELECT root FROM projects WHERE id=?', before.projectId);
            const combined = signal ? AbortSignal.any([signal, this.contextAbort.signal]) : this.contextAbort.signal;
            const { listContextPaths } = await import('./input-context.js');
            const result = await listContextPaths({ root: project.root, privateRoot: this.options.installationHome }, input.prefix, combined);
            this.assertOpen();
            const now = this.interactions.inspect(input.conversationId);
            if (combined.aborted || now.deleted || now.archived || now.generation !== before.generation || now.projectId !== before.projectId || now.draft.revision !== before.draft.revision ||
                this.store.one('SELECT root FROM projects WHERE id=?', now.projectId)?.root !== project.root)
                throw new Error('File completion target changed; retry for the current draft');
            return result;
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    /** Trusted host entry. Agent coordination continues to use literal queue(). */
    queueConversationInputWithContext(options: import('./interaction-types.js').InputOptions, signal?: AbortSignal) {
        options = structuredClone(options);
        this.assertOpen();
        this.assertTarget(options.conversationId);
        this.interactions.assertInputReady(options.conversationId);
        const before = this.interactions.inspect(options.conversationId), project = before.projectId ? this.store.one('SELECT root FROM projects WHERE id=?', before.projectId) : null;
        const combined = signal ? AbortSignal.any([signal, this.contextAbort.signal]) : this.contextAbort.signal;
        if (before.archived || before.deleted || before.generation !== options.expectedGeneration ||
            options.draftRevision !== undefined && (before.draft.revision !== options.draftRevision || before.draft.text !== options.text))
            throw new Error('Input target or exact draft changed before file capture');
        const task = (async () => {
            const { captureInputContext } = await import('./input-context.js');
            const receipt = await captureInputContext({ options, projectId: before.projectId, stateRoot: this.state,
                ...(project ? { scope: { root: project.root, privateRoot: this.options.installationHome } } : {}),
                signal: combined });
            return this.interactions.queue(options, undefined, () => {
                if (combined.aborted)
                    throw new Error('File context cancelled before admission');
                this.assertOpen();
                this.assertTarget(before.conversationId);
                const now = this.interactions.inspect(before.conversationId), root = now.projectId ? this.store.one('SELECT root FROM projects WHERE id=?', now.projectId)?.root : null;
                if (now.projectId !== before.projectId || root !== (project?.root ?? null) || now.generation !== before.generation ||
                    now.deleted || now.archived || options.draftRevision !== undefined && (now.draft.revision !== before.draft.revision || now.draft.text !== options.text))
                    throw new Error('Input target or exact draft changed during file capture');
            }, receipt).then(value => { this.completed.touch(before.conversationId); return value; });
        })().catch(error => {
            if (typeof error?.code === 'string')
                throw new Error('File context unavailable; check project files and private input storage (' + String(error.code).replace(/[^A-Z0-9_]/gu, '') + ')');
            throw error;
        });
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    getConversationModelChoice(conversationId: string) {
        this.assertOpen();
        this.interactions.inspect(conversationId);
        return conversationModelChoice(this.store, conversationId);
    }
    forkConversation(input: ForkConversationInput) {
        return forkConversation({ store: this.store, interactions: this.interactions, completed: this.completed, options: this.options, state: this.state,
            assertOpen: () => this.assertOpen(), assertTarget: cid => this.assertTarget(cid),
            busy: cid => {
                const view = this.interactions.inspect(cid);
                return !!this.ordinaryCore?.isBusy(cid) || !!view.workId && this.active.has(view.workId);
            },
            reserve: cid => this.lifecycleBusy.add(cid), release: cid => this.releaseLifecycle(cid) }, input);
    }
    private releaseLifecycle(cid: string) {
        this.lifecycleBusy.delete(cid);
        this.completed.changed();
        if (!this.interactionQuiesced && !this.closing)
            this.ordinaryCore?.resumeAuthorized();
    }
    async setConversationModelChoice(input: {
        conversationId: string;
        expectedGeneration: number;
        expectedRevision: number;
        choice: ModelChoiceInput;
    }, assertCurrent?: () => unknown) {
        const guard = () => {
            if (assertCurrent && assertCurrent() !== undefined)
                throw Error('Synchronous model selection validation required');
        };
        guard();
        input = structuredClone(input);
        input.choice = validateModelChoice(input.choice);
        this.assertOpen();
        const cid = input.conversationId;
        this.assertTarget(cid);
        this.lifecycleSnapshot(cid, input.expectedGeneration);
        if (this.getConversationModelChoice(cid).revision !== input.expectedRevision)
            throw new Error('Stale conversation model revision');
        this.lifecycleBusy.add(cid);
        try {
            const desired = input.choice;
            let bridgeSelection: import('../pi/session.js').PiModelSelection | undefined;
            if (desired.kind === 'managed' && desired.provider === 'claude-bridge') {
                if (!this.modelResource)
                    throw Error('Bridge choice requires saved application startup setup and restart');
                bridgeSelection = await this.modelResource.selectModel(desired.modelId, desired.thinkingLevel);
                this.assertApplicationModelSource(bridgeSelection, desired);
                this.lifecycleSnapshot(cid, input.expectedGeneration);
            }
            guard();
            await this.completed.reclaim(cid, true);
            this.assertOpen();
            this.lifecycleSnapshot(cid, input.expectedGeneration);
            return this.store.tx(() => {
                guard();
                if (bridgeSelection && desired.kind === 'managed')
                    this.assertApplicationModelSource(bridgeSelection, desired);
                return writeConversationModelChoice(this.store, cid, input.choice, input.expectedRevision);
            });
        }
        finally {
            this.releaseLifecycle(cid);
        }
    }
    private applicationMutation = false;
    private assertNoApplicationMutation(): void {
        if (this.applicationMutation)
            throw new Error('Account/model configuration change is settling; retry execution or input after it finishes');
    }
    private assertExecutionAdmission(): void {
        if (this.managementOnly)
            throw new Error('MANAGEMENT_ONLY: close and reopen normally before execution or input');
        this.assertNoApplicationMutation();
    }
    beginApplicationMutation(): () => void {
        this.assertOpen();
        this.assertNoApplicationMutation();
        this.assertApplicationMutationAllowed();
        this.applicationMutation = true;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.applicationMutation = false;
            }
        };
    }
    private applicationResources = new Set<{
        close(): Promise<void>;
    }>();
    /** Trusted app resources settle before this home's writer is released. */
    adoptApplicationResource(resource: {
        close(): Promise<void>;
    }): void {
        this.assertOpen();
        this.applicationResources.add(resource);
    }
    private async closeApplicationResources(): Promise<void> {
        const results = await Promise.allSettled([...this.applicationResources].map(resource => Promise.resolve().then(() => resource.close())));
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (errors.length === 1)
            throw errors[0];
        if (errors.length)
            throw new AggregateError(errors, 'Application resource cleanup unavailable: ' + errors.map(error => error instanceof Error ? error.message + ('recovery' in error ? ' · ' + String(error.recovery) : '') : String(error)).join('; '));
    }
    private modelResource: import('../pi/claude-host.js').OwnedClaudeHost | undefined;
    async adoptModelResource(resource: import('../pi/claude-host.js').OwnedClaudeHost): Promise<void> {
        this.assertOpen();
        const { claimOwnedClaudeHost } = await import('../pi/claude-host.js');
        this.assertOpen();
        if (this.modelResource && this.modelResource !== resource)
            throw new Error('Controller already owns a different model resource');
        for (const project of this.listProjects())
            this.assertStartupRootDisjoint(project.sourceRoot, resource);
        claimOwnedClaudeHost(resource, this);
        this.modelResource = resource;
    }
    private assertStartupRootDisjoint(root: string, bridge = this.modelResource): void {
        const retained = this.store.all(`SELECT data FROM runs
            WHERE phase NOT IN ('SETTLED','INTERRUPTED')
            OR (json_extract(data,'$.cleanup') IS NOT NULL
                AND json_extract(data,'$.cleanup') NOT IN ('removed','not-allocated','unbound','confirmed'))
            OR EXISTS (SELECT 1 FROM capacity_leases WHERE run=runs.id
                AND state IN ('QUEUED','ADMITTED','SETTLING','QUARANTINED'))`);
        const profiles = [this.options.runtimeProfile, ...retained.map(run => {
            const data = parse(run.data);
            const legacyContainer = ['ordinary-conversation', 'command-observation', 'investigation', 'governed-change', 'governed-role', 'governed-check'].includes(data.kind);
            return data.runtimeProfile ?? data.profile ?? (legacyContainer ? this.initialRuntimeProfile : undefined);
        })];
        const roots = [...(bridge ? ownedClaudeAuthorityRoots(bridge) : []), ...profiles.flatMap(profile => [profile?.dockerBinary, profile?.dockerConfigDirectory]).filter((value): value is string => !!value && path.isAbsolute(value))];
        if (roots.some(file => inside(root, file) || inside(file, root)))
            throw Error('Project inputs must be disjoint from active startup authority paths');
    }
    /** Application-only explicit runtime replacement. Admitted runs retain their own profile. */
    applyRuntimeProfile(input: RuntimeProfile, commit?: () => void): Promise<void> {
        this.assertOpen();
        this.assertExecutionAdmission();
        const previous = this.options.runtimeProfile;
        const captured = structuredClone(input);
        const roots = () => this.listProjects().map(project => project.sourceRoot).sort();
        const originalRoots = JSON.stringify(roots());
        const task = (async () => {
            const profile = await validateRuntimeProfile({ ...captured, uid: captured.uid ?? process.getuid?.() ?? 1000, gid: captured.gid ?? process.getgid?.() ?? 1000 });
            this.assertExecutionAdmission();
            if (this.options.runtimeProfile !== previous || JSON.stringify(roots()) !== originalRoots)
                throw Error('Runtime or registered projects changed during runtime review');
            if (this.modelResource && !profile.dockerConfigDirectory)
                throw Error('Bridge plus execution requires explicit dockerConfigDirectory');
            const protectedRoots = [...roots(), ...['state', 'artifacts', 'inputs', 'control'].map(name => path.join(this.options.installationHome, name))];
            if ([profile.dockerBinary, profile.dockerConfigDirectory].some(file => file && protectedRoots.some(root => inside(root, file) || inside(file, root))))
                throw Error('Runtime authority paths must be disjoint from registered projects and execution state');
            // No await between the guarded durable save and the effective pointer change.
            if (commit && commit() !== undefined)
                throw Error('Runtime commit must be synchronous and return undefined');
            this.options.runtimeProfile = profile;
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    private recordedRuntime(data: Record<string, any>): RuntimeProfile | undefined {
        // Legacy records without a snapshot use only the original startup route.
        // A live replacement cannot redirect their cleanup to the new environment.
        return data.runtimeProfile ?? data.profile ?? this.initialRuntimeProfile;
    }
    private lifecycleBusy = new Set<string>();
    private humanViewed = new Set<string>();
    private completedCore: CompletedResources | undefined;
    private get completed() { return this.completedCore ??= new CompletedResources(this.store, this.options.completedResources, cid => this.humanViewed.has(cid) || this.lifecycleBusy.has(cid) || !!this.ordinaryCore?.isBusy(cid) || !!this.interactions.getHandle(cid) || this.interactions.inspect(cid).state !== 'IDLE' || lifecycleReasons(this.store, cid).length > 0); }
    private assertOperationTarget(id: string) {
        const row = this.store.one('SELECT work,data FROM effect_operations WHERE id=?', id);
        if (!row)
            return;
        this.assertWorkTarget(row.work);
        const d = JSON.parse(row.data);
        for (const cid of [d.origin?.identity?.conversationId, d.ownerRoot?.conversationId])
            if (cid)
                this.assertTarget(cid);
    }
    private assertTarget(cid: string, allowNativeInputRecovery = false, managedWork?: string, ownerToken?: symbol) {
        this.assertExecutionAdmission();
        assertConversationExecutable(this.store, cid, false, allowNativeInputRecovery);
        this.assertManagedTarget(cid, managedWork, ownerToken);
        if (this.lifecycleBusy.has(cid))
            throw Error('Conversation lifecycle operation active');
    }
    private assertManagedTarget(cid: string, managedWork?: string, ownerToken?: symbol) {
        const operation = this.managedOperations.get(cid);
        if (operation && !(ownerToken && operation.token === ownerToken) && !(managedWork && operation.workId === managedWork))
            throw Error('Managed conversation operation active');
    }
    private assertWorkTarget(work: string) {
        this.assertExecutionAdmission();
        this.assertWorkLifecycle(work);
    }
    private assertWorkLifecycle(work: string) {
        assertWorkConversation(this.store, work);
        const row = this.store.one('SELECT data FROM works WHERE id=?', work), cid = row ? parse(row.data).conversation : null;
        if (cid) {
            this.assertManagedTarget(cid, work);
            if (this.lifecycleBusy.has(cid))
                throw Error('Conversation lifecycle operation active');
        }
        for (const held of this.lifecycleBusy)
            if (this.store.one('SELECT work FROM conversation_state WHERE conversation=?', held)?.work === work)
                throw new Error('Conversation lifecycle operation active for retained work');
    }
    private lifecycleSnapshot(cid: string, generation: number) {
        const v = this.interactions.inspect(cid);
        if (v.generation !== generation)
            throw Error('Stale lifecycle generation');
        if (this.ordinaryCore?.isBusy(cid) || this.interactions.getHandle(cid))
            throw Error('Conversation producer active');
        const state = this.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid);
        if (v.workId && !JSON.parse(state.data).role && this.active.has(v.workId))
            throw Error('Owning work operation active');
        const reasons = lifecycleReasons(this.store, cid);
        if (reasons.length)
            throw Error('LIFECYCLE_HELD: ' + reasons.join(';'));
        return v;
    }
    private async lifecycleAction(input: {
        conversationId: string;
        expectedGeneration: number;
    }, kind: 'reclaim' | 'archive' | 'restore' | 'delete') {
        this.assertOpen();
        const cid = input.conversationId;
        this.assertManagedTarget(cid);
        if (kind !== 'reclaim' && kind !== 'restore' && this.store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", cid))
            throw Error('Finish or cancel the goal before archiving/deleting its conversation');
        if (this.lifecycleBusy.has(cid))
            throw Error('Lifecycle operation already active');
        assertConversationExecutable(this.store, cid, true);
        this.store.tx(() => {
            if (kind === 'reclaim') reconcileCompletedAssignmentResults(this.store, cid);
            this.lifecycleSnapshot(cid, input.expectedGeneration);
        });
        this.lifecycleBusy.add(cid);
        try {
            const resource = await this.completed.reclaim(cid, true);
            this.assertOpen();
            this.lifecycleSnapshot(cid, input.expectedGeneration);
            if (kind !== 'reclaim' && kind !== 'restore' && this.store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", cid))
                throw Error('Goal changed during conversation lifecycle action');
            return kind === 'reclaim' ? resource : this.interactions.lifecycleCommit(cid, input.expectedGeneration, kind);
        }
        finally {
            this.releaseLifecycle(cid);
        }
    }
    reclaimConversationResource(input: {
        conversationId: string;
        expectedGeneration: number;
    }) { return this.lifecycleAction(input, 'reclaim'); }
    restoreConversation(input: {
        conversationId: string;
        expectedGeneration: number;
    }) { return this.lifecycleAction(input, 'restore'); }
    deleteConversation(input: {
        conversationId: string;
        expectedGeneration: number;
    }) { return this.lifecycleAction(input, 'delete'); }
    private active = new Map<string, Active>();
    private closed = false;
    private closing: Promise<void> | undefined;
    private readonly initialRuntimeProfile: RuntimeProfile | undefined;
    constructor(readonly options: ControllerOptions, private store: Store, private releaseOwner: () => Promise<void>, private readonly managementOnly = false) {
        this.initialRuntimeProfile = options.runtimeProfile ? Object.freeze({ ...options.runtimeProfile }) : undefined;
    }
    private contributionsCore: Contributions | undefined;
    private get contributions() { return this.contributionsCore ??= new Contributions(this.store, () => this.assertOpen()); }
    configureContributionReader(options: import('../platform/github-contributions.js').ContributionReadOptions) { return this.contributions.configure(options); }
    trackRepositoryResource(input: import('../platform/github-contributions.js').ContributionResource, signal?: AbortSignal) { return this.contributions.track(input, signal); }
    setResourceSummaryParent(input: {
        childId: string;
        parentId: string | null;
        expectedRevision: number;
    }, signal?: AbortSignal) { return this.contributions.setParent(input, signal); }
    refreshContributions(input: {
        resourceIds?: readonly string[];
        signal?: AbortSignal;
    } = {}) { return this.contributions.refresh(input); }
    listTrackedResources() { return this.contributions.list(); }
    inspectContributions(input: {
        resourceId: string;
    }) { return this.contributions.inspect(input.resourceId); }
    inspectCurrentContributionSummary(resourceId: string) { return this.contributions.currentPublicationSummary(resourceId); }
    prepareContributionSummary(input: {
        resourceId: string;
        expectedRevision?: number;
    }) { return this.contributions.prepare(input); }
    startContributionRefresh() { return this.contributions.startRefresh(); }
    private get state() {
        return path.join(this.options.installationHome, 'state');
    }
    private assertOpen() {
        if (this.closed || this.closing)
            throw new ControllerError('CONTROLLER_CLOSING', 'Controller closed or closing', 'Wait for close then reopen retained state');
    }
    /** Trusted application composition shares this controller's held home owner.
     * Not exposed as a project/agent tool. Recheck on every management operation. */
    applicationHome(): string {
        this.assertOpen();
        return this.options.installationHome;
    }
    applicationModelResource(): import('../pi/claude-host.js').OwnedClaudeHost | undefined {
        this.applicationHome();
        return this.modelResource;
    }
    assertApplicationModelSource(model: import('../pi/session.js').PiModelSelection, desired?: Extract<ModelChoiceInput, {
        kind: 'managed';
    }>): void {
        this.applicationHome();
        let thinking: import('@earendil-works/pi-ai').ModelThinkingLevel;
        if (model.managed && model.managed.home === this.options.installationHome)
            thinking = model.managed.thinkingLevel;
        else if (model.bridge && model.bridge === this.modelResource)
            thinking = assertOwnedClaudeApplicationSelection(model, this).bridgeThinkingLevel!;
        else
            throw Error('APPLICATION_MODEL_UNAVAILABLE: incompatible application source; configure the selected account or restart with saved bridge setup');
        if (desired && (model.provider !== desired.provider || model.modelId !== desired.modelId || thinking !== desired.thinkingLevel))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: admitted source differs from the desired model or thinking');
    }
    assertApplicationMutationAllowed(): void {
        this.assertOpen();
        // Legacy runs do not retain a provider-source dependency. Until every
        // such run is attributable, refuse all account/config mutation while
        // any producer or retained queued/waiting obligation could use it.
        if (this.managedOperations.size)
            throw Error('Settle managed conversation operations before account/model configuration changes');
        if (this.lifecycleBusy.size)
            throw new Error('Settle conversation lifecycle/model changes before account configuration changes');
        const blocker = this.interactions.list().find(view => !view.deleted && !view.archived &&
            (view.state !== 'IDLE' || this.interactions.getHandle(view.conversationId) || this.ordinaryCore?.isBusy(view.conversationId) ||
                (this.completedCore?.inspect(view.conversationId).state ?? 'absent') !== 'absent' || lifecycleReasons(this.store, view.conversationId).length));
        if (this.active.size || blocker)
            throw new Error('Settle active, queued or retained conversation obligations before account/model configuration changes; ' +
                (blocker ? `conversation ${blocker.conversationId}. For a retained idle client use conversation reclaim --conversation ${blocker.conversationId} --generation ${blocker.generation}, then retry` : 'a governed operation is active; wait for settlement'));
    }
    private work(workId: string) {
        const work = this.store.one('SELECT * FROM works WHERE id=?', workId);
        if (!work)
            throw new ControllerError('MISSING_WORK', 'Unknown work ID', 'Inspect the retained work checkpoint');
        return work;
    }
    private changeCore: ChangeCore | undefined;
    private capacityCore: Capacity | undefined;
    private get capacity() {
        return this.capacityCore ??= new Capacity(this.store, this.options.capacityLimit ?? 2, this.options.installationHome);
    }
    private interactionCore: Interactions | undefined;
    private get interactions() {
        return this.interactionCore ??= new Interactions(this.store, () => this.assertOpen(), this.state, cid => this.assertTarget(cid));
    }
    createConversation(options: {
        projectId?: string | null;
    } = {}) {
        this.assertExecutionAdmission();
        return this.interactions.create(options);
    }
    async createApplicationConversation(input: {
        projectId?: string | null;
        choice: ModelChoiceInput;
    }, validate?: () => void) {
        this.assertExecutionAdmission();
        input = structuredClone(input);
        const choice = validateModelChoice(input.choice);
        this.applicationHome();
        validate?.();
        let selected: import('../pi/session.js').PiModelSelection | undefined;
        if (choice.kind === 'managed' && choice.provider === 'claude-bridge') {
            if (!this.modelResource)
                throw Error('Bridge choice requires saved application startup setup and restart');
            selected = await this.modelResource.selectModel(choice.modelId, choice.thinkingLevel);
        }
        return this.interactions.createWithModelChoice(input.projectId === undefined ? {} : { projectId: input.projectId }, choice, () => {
            this.applicationHome();
            validate?.();
            if (selected && choice.kind === 'managed')
                this.assertApplicationModelSource(selected, choice);
        });
    }
    listConversations() {
        return this.interactions.list();
    }
    /** Presentation entry only: do not resume dependencies or resolve a model. */
    inspectConversationEntry(): {
        conversationId: string;
        reason: 'last-view' | 'recent-view';
    } | undefined {
        this.assertOpen();
        return this.interactions.entry();
    }
    /** Bounded pane summary: reserved (in-flight) inputs are counted apart from inputs still waiting behind them. */
    inspectConversationInputStatus(id: string, activeInputId?: string): {
        count: number;
        preview: string;
        reserved: number;
        waiting: number;
        waitingPreviews: string[];
        waitingInputIds: string[];
        waitingModes: string[];
        firstQueuedInputId: string | null;
        activeInputWaiting: boolean;
        reconciliation: boolean;
        deliveryIssue?: {count: number; reason: string};
    } | undefined {
        this.assertOpen();
        // One statement per pane render: aggregates plus the first and first two waiting previews.
        const row = this.store.one(`WITH p AS (SELECT i.id,i.mode,i.rowid AS ord,i.state AS state,substr(s.raw,1,160) AS preview,CASE WHEN i.state IN ('QUEUED','RECONCILIATION_REQUIRED') AND json_valid(i.data) THEN CASE WHEN json_type(i.data,'$.routeError')='text' AND length(CAST(json_extract(i.data,'$.routeError') AS BLOB))>0 THEN substr(json_extract(i.data,'$.routeError'),1,160) END END AS routeError FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED'))
            SELECT COUNT(*) AS count,COALESCE(SUM(state='INITIAL_RESERVED'),0) AS reserved,COALESCE(SUM(state IN ('QUEUED','NATIVE_PENDING')),0) AS waiting,COALESCE(MAX(state='RECONCILIATION_REQUIRED'),0) AS reconciliation,
            (SELECT preview FROM p ORDER BY ord LIMIT 1) AS preview,(SELECT json_group_array(preview) FROM (SELECT preview FROM p WHERE state IN ('QUEUED','NATIVE_PENDING') ORDER BY ord LIMIT 2)) AS waitingPreviews,
            (SELECT json_group_array(id) FROM (SELECT id FROM p WHERE state IN ('QUEUED','NATIVE_PENDING') ORDER BY ord LIMIT 2)) AS waitingInputIds,
            (SELECT json_group_array(mode) FROM (SELECT mode FROM p WHERE state IN ('QUEUED','NATIVE_PENDING') ORDER BY ord LIMIT 2)) AS waitingModes,
            COUNT(routeError) AS deliveryIssueCount,(SELECT routeError FROM p WHERE routeError IS NOT NULL ORDER BY ord LIMIT 1) AS deliveryIssueReason,
            (SELECT id FROM p WHERE state='QUEUED' ORDER BY ord LIMIT 1) AS firstQueuedInputId,
            COALESCE(MAX(id=? AND state IN ('QUEUED','NATIVE_PENDING')),0) AS activeInputWaiting FROM p`, id, activeInputId ?? null);
        if (!row.count)
            return undefined;
        return { count: row.count, preview: row.preview, reserved: row.reserved, waiting: row.waiting, waitingPreviews: JSON.parse(row.waitingPreviews), waitingInputIds: JSON.parse(row.waitingInputIds), waitingModes: JSON.parse(row.waitingModes), firstQueuedInputId: row.firstQueuedInputId, activeInputWaiting: !!row.activeInputWaiting, reconciliation: !!row.reconciliation, ...(row.deliveryIssueCount ? {deliveryIssue: {count: row.deliveryIssueCount, reason: row.deliveryIssueReason}} : {}) };
    }
    inspectConversationProgress(id: string) {
        this.assertOpen();
        return inspectConversationProgress(this.store, id);
    }
    inspectConversationInputs(id: string) {
        this.assertOpen();
        return inspectPendingInputs(this.store, id);
    }
    recoverConversationInput(input: {
        conversationId: string;
        inputId: string;
        expectedContext: string;
        action: 'retry' | 'withdraw';
    }) {
        this.assertTarget(input.conversationId);
        if (this.lifecycleBusy.has(input.conversationId) || this.ordinaryCore?.isBusy(input.conversationId) || this.interactions.getHandle(input.conversationId))
            throw Error('Wait for the original response to settle, then reopen /inputs');
        if (!['retry', 'withdraw'].includes(input.action))
            throw Error('Unknown input recovery action');
        return this.store.tx(() => {
            const current = this.inspectConversationInputs(input.conversationId).find(row => row.inputId === input.inputId);
            if (!current?.eligible || current.fingerprint !== input.expectedContext)
                throw Error('Retained input changed or is not safe to recover; reopen /inputs');
            const row = this.store.one('SELECT * FROM conversation_inputs WHERE id=?', input.inputId);
            const generation = this.interactions.inspect(input.conversationId).generation;
            const data = {
                ...parse(row.data),
                ownerRecovery: {
                    action: input.action,
                    previousState: row.state,
                    previousGeneration: row.generation,
                    reviewedContext: input.expectedContext,
                },
            };
            this.store.run('UPDATE conversation_inputs SET state=?,generation=?,data=? WHERE id=?', input.action === 'retry' ? 'QUEUED' : 'CONFLICTED', generation, JSON.stringify(data), input.inputId);
            return current;
        });
    }
    inspectConversation(id: string) {
        return { ...this.interactions.inspect(id), completedResource: this.completed.inspect(id) };
    }
    inspectConversationContext(input: {
        conversationId: string;
        expectedGeneration: number;
    }) {
        this.assertTarget(input.conversationId, true);
        return inspectContextStatus(this.store, input.conversationId, input.expectedGeneration);
    }
    setConversationName(input: {
        conversationId: string;
        expectedGeneration: number;
        name: string | null;
    }) {
        this.assertTarget(input.conversationId);
        return this.interactions.name(input);
    }
    getConversationLanguage(id: string) {
        this.assertOpen();
        return conversationLanguage(this.store, id);
    }
    setConversationLanguage(input: {
        conversationId: string;
        expectedGeneration: number;
        expectedRevision: number;
        replyLanguage: string | null;
    }, assertCurrent?: () => void) {
        this.assertTarget(input.conversationId);
        return this.store.tx(() => {
            assertCurrent?.();
            const view = this.inspectConversation(input.conversationId);
            if (view.generation !== input.expectedGeneration || view.archived || view.deleted)
                throw Error('Reply language target changed');
            return writeConversationLanguage(this.store, input.conversationId, input.expectedRevision, input.replyLanguage);
        });
    }
    setConversationParent(options: {
        childId: string;
        parentId: string | null;
        expectedRevision: number;
    }) {
        this.assertTarget(options.childId);
        if (options.parentId)
            this.assertTarget(options.parentId);
        return this.interactions.parent(options);
    }
    archiveConversation(input: {
        conversationId: string;
        expectedGeneration: number;
    }) { return this.lifecycleAction(input, 'archive'); }
    setDraft(options: {
        conversationId: string;
        expectedRevision: number;
        text: string;
    }) {
        return this.interactions.draft(options);
    }
    getNativeHandle(id: string) {
        return this.interactions.getHandle(id);
    }
    subscribeInteraction(listener: (event: import('./interaction-types.js').InteractionEvent) => void) {
        return this.interactions.subscribe(listener);
    }
    /** Bounded task/wait recovery observations; lifecycle authority remains controller-owned. */
    inspectConversationProjectDependencies(input: { conversationId: string; expectedGeneration: number }) {
        this.assertOpen();
        const view = this.interactions.inspect(input.conversationId);
        if (view.generation !== input.expectedGeneration) throw Error('Project dependency source changed');
        const rows = this.store.all(`WITH holds AS (
            SELECT d.id,d.assignment,d.waiting,d.target,a.work,a.state AS assignmentState,w.state AS workState,0 AS kind,d.rowid AS ord
            FROM conversation_dependencies d LEFT JOIN conversation_assignments a ON a.id=d.assignment
            LEFT JOIN works w ON w.id=a.work
            WHERE (d.waiting=? OR d.target=?) AND d.state='PENDING'
            UNION ALL
            SELECT NULL,a.id,a.source_conversation,a.target,a.work,a.state,w.state,1,a.rowid
            FROM conversation_assignments a LEFT JOIN works w ON w.id=a.work
            WHERE (a.source_conversation=? OR a.target=?) AND a.state IN ('QUEUED','RUNNING','WAITING')
                AND NOT EXISTS (SELECT 1 FROM conversation_dependencies d WHERE d.assignment=a.id AND d.state='PENDING' AND (d.waiting=? OR d.target=?))
            ) SELECT * FROM holds ORDER BY kind,ord LIMIT 9`, ...Array<string>(6).fill(input.conversationId));
        return { more: rows.length > 8, items: rows.slice(0, 8).map(row => {
            const related = this.interactions.inspect(row.waiting === input.conversationId ? row.target : row.waiting);
            return { dependencyId: row.id as string | null, assignmentId: row.assignment as string | null, conversationId: related.conversationId,
                waitingFor: row.waiting === input.conversationId, taskConversationId: row.target as string,
                label: related.userLabel ?? related.label, workId: row.work as string | null,
                assignmentState: row.assignmentState as string | null, workState: row.workState as string | null };
        }) };
    }
    setConversationProject(options: {
        conversationId: string;
        projectId: string;
        expectedGeneration: number;
    }) {
        this.assertTarget(options.conversationId);
        if (this.store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", options.conversationId))
            throw Error('Finish or cancel the goal before changing its captured project scope');
        if (this.completed.inspect(options.conversationId).state !== 'absent')
            throw Error('RECLAIM_FIRST: reclaim completed resource before project transition');
        if (this.ordinaryCore?.isBusy(options.conversationId))
            throw new Error('Conversation admission active; settle before project change');
        return this.interactions.project(options);
    }
    setScroll(options: {
        conversationId: string;
        entryId: string | null;
        offset: number;
        followEnd: boolean;
    }) {
        return this.interactions.scroll(options);
    }
    setConversationView(options: {
        selectedId: string;
        secondId?: string | null;
    }) {
        const result = this.interactions.view(options);
        this.humanViewed = new Set([options.selectedId, ...(options.secondId ? [options.secondId] : [])]);
        this.completed.touch(options.selectedId);
        if (options.secondId)
            this.completed.touch(options.secondId);
        return result;
    }
    updateNativeDialogs(options: {
        identity: import('./interaction-types.js').NativeIdentity;
        requestIds: readonly string[];
    }) {
        return this.interactions.dialogs(options);
    }
    getConversationHistory(id: string) {
        this.assertOpen();
        if (this.lifecycleBusy.has(id))
            throw new Error('Conversation lifecycle operation active');
        return this.interactions.history(id);
    }
    queueConversationInput(options: import('./interaction-types.js').InputOptions) {
        this.assertTarget(options.conversationId);
        return this.interactions.queue(options).then(receipt => { this.completed.touch(options.conversationId); return receipt; });
    }
    async interruptConversation(options: {
        conversationId: string;
        expectedGeneration: number;
    }) {
        const view = this.interactions.inspect(options.conversationId);
        if (view.generation !== options.expectedGeneration)
            throw new Error('Stale interrupt target');
        const registration = this.interactions.getHandle(options.conversationId), handle = view.workId ? this.active.get(view.workId) : undefined;
        handle?.abort.abort();
        if (registration)
            await registration.session.abort();
        await handle?.done;
    }
    /** Synchronous host-exit barrier: no new admission or authorized dependent resumption. */
    quiesceInteractionHost() {
        this.interactionQuiesced = true;
        this.humanViewed.clear();
        this.ordinaryCore?.quiesce();
        this.completedCore?.quiesce();
        this.goalCore?.quiesceAdmission();
    }
    async settleInteractionHost(options: {
        identities: readonly import('./interaction-types.js').NativeIdentity[];
    }) {
        this.quiesceInteractionHost();
        const failures: unknown[] = [], attempt = async (action: () => unknown) => {
            try {
                await action();
            }
            catch (error) {
                failures.push(error);
            }
        };
        await attempt(() => this.goalCore?.quiesce());
        await attempt(() => this.settleConversationChanges());
        const handles = [...this.active.values()];
        const registrations = options.identities.map(identity => { const live = this.interactions.getHandle(identity.conversationId); return live?.identity.runId === identity.runId && live.identity.generation === identity.generation ? live : null; });
        for (const handle of handles)
            handle.abort.abort();
        await Promise.all(registrations.map(registration => attempt(() => registration?.session.abort())));
        await Promise.all(handles.map(handle => attempt(() => handle.done)));
        for (const identity of options.identities)
            await attempt(() => {
                const run = this.store.one('SELECT phase,data FROM runs WHERE id=?', identity.runId);
                if (run && (!['SETTLED', 'INTERRUPTED'].includes(run.phase) || JSON.parse(run.data).cleanup?.startsWith('quarantined')))
                    throw Error('Interaction producer cleanup unavailable; retained UNKNOWN checkpoint');
            });
        await attempt(() => this.goalCore?.drain());
        await attempt(() => this.completedCore?.close());
        if (failures.length === 1)
            throw failures[0];
        if (failures.length > 1)
            throw new AggregateError(failures, 'Interaction host cleanup unavailable: ' + failures.map(error => error instanceof Error ? error.message + ('recovery' in error ? ' · ' + String(error.recovery) : '') : String(error)).join(' | '));
    }
    inspectConversationResult(resultId: string) {
        this.assertOpen();
        return inspectConversationResult(this.store, resultId);
    }
    inspectConversationResultDetail(input: {resultId: string; cursor?: number; fingerprint?: string}) {
        this.assertOpen();
        return inspectConversationResultDetail(this.store, this.options.installationHome, input, undefined, () => this.assertOpen());
    }
    inspectNotifications(conversationId: string) {
        this.interactions.inspect(conversationId);
        return this.store.all('SELECT * FROM conversation_notifications WHERE target=? ORDER BY rowid', conversationId).map(row => ({ id: row.id, state: row.state, ...parse(row.data) }));
    }
    acknowledgeNotification(options: {
        conversationId: string;
        notificationId: string;
    }) {
        this.assertOpen();
        const row = this.store.one('SELECT * FROM conversation_notifications WHERE id=? AND target=?', options.notificationId, options.conversationId);
        if (!row)
            throw new Error('Unknown notification target');
        this.store.run('UPDATE conversation_notifications SET state=? WHERE id=?', 'ACKNOWLEDGED', row.id);
    }
    async executeConversationBash(options: import('./interaction-types.js').ConversationModelRequest & {
        conversationId: string;
        expectedGeneration: number;
        command: string;
        rawInput?: string;
        excludeFromContext?: boolean;
        signal?: AbortSignal;
    }): Promise<unknown> {
        const captured = captureConversationOptions(options);
        this.assertOpen();
        if (this.interactionQuiesced)
            throw new Error('Interaction admission quiesced');
        this.assertTarget(options.conversationId);
        const view = this.interactions.inspect(options.conversationId);
        if (view.generation !== options.expectedGeneration || !options.command.trim() || Buffer.byteLength(options.command) > 128 * 1024)
            throw new Error('Invalid/stale native Bash request');
        if (this.ordinaryCore?.isBusy(options.conversationId) || this.interactions.getHandle(options.conversationId) || ['RUNNING', 'SETTLING', 'QUEUED'].includes(view.state))
            throw new Error('USER_BASH_ACTIVE_UNAVAILABLE: wait for this response to settle; draft retained');
        if (!view.historyRef)
            throw new Error('USER_BASH_HISTORY_REQUIRED: send an ordinary first message or use standalone local check');
        const receipt = this.interactions.enqueue({ conversationId: view.conversationId, expectedGeneration: view.generation, text: options.rawInput ?? ((options.excludeFromContext ? '!!' : '!') + options.command), mode: 'idle' });
        return this.runConversation({ ...captured, initialInputId: receipt.inputId, userBash: { command: options.command, excludeFromContext: options.excludeFromContext ?? false } });
    }
    compactConversation(options: import('./interaction-types.js').ConversationModelRequest & {
        conversationId: string;
        expectedGeneration: number;
        instructions?: string;
        signal?: AbortSignal;
    }) {
        return this.manualConversation(options, { kind: 'compact', ...(options.instructions ? { instructions: options.instructions } : {}) });
    }
    navigateConversationTree(options: import('./interaction-types.js').ConversationModelRequest & {
        conversationId: string;
        expectedGeneration: number;
        entryId: string;
        signal?: AbortSignal;
    }) {
        return this.manualConversation(options, { kind: 'navigate-tree', entryId: options.entryId });
    }
    private manualConversation(options: import('./interaction-types.js').ConversationModelRequest & {
        conversationId: string;
        expectedGeneration: number;
        signal?: AbortSignal;
    }, manual: NonNullable<import('./interaction-types.js').RunConversationOptions['manual']>) {
        const captured = captureConversationOptions(options);
        this.assertOpen();
        this.assertTarget(options.conversationId);
        const view = this.interactions.inspect(options.conversationId);
        if (view.archived || this.interactionQuiesced || this.ordinaryCore?.isBusy(view.conversationId) || view.generation !== options.expectedGeneration || view.state !== 'IDLE' || !view.historyRef)
            throw new Error('MANUAL_NATIVE_UNAVAILABLE: requires exact idle conversation with validated history');
        const raw = JSON.stringify(manual);
        if (Buffer.byteLength(raw) > 128 * 1024)
            throw new Error('Manual native instructions exceed128KiB');
        const pending = this.store.all("SELECT i.*,s.conversation AS source_conversation,s.origin AS source_origin,s.raw AS source_raw FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.state IN ('QUEUED','NATIVE_PENDING','INITIAL_RESERVED','RECONCILIATION_REQUIRED')", view.conversationId);
        let inputId: string;
        if (pending.length) {
            const input = pending[0], origin = parse(input.source_origin);
            // Retry only the same owner request that never obtained a run. In particular,
            // interrupted/admitted operations and unrelated owner inputs remain pending.
            if (pending.length !== 1 || input.state !== 'QUEUED' || input.mode !== 'manual' || input.generation !== view.generation || input.work !== view.workId || input.text !== raw || JSON.stringify(parse(input.data).manual) !== raw || input.source_conversation !== view.conversationId || input.source_raw !== raw || origin.kind !== 'owner-native-history-action' || origin.action !== manual.kind || this.store.one("SELECT id FROM runs WHERE json_extract(data,'$.initialInputId')=? LIMIT 1", input.id))
                throw new Error('Pending input must be consumed or explicitly reconciled before manual history action');
            inputId = input.id;
        }
        else {
            inputId = randomUUID();
            const source = randomUUID();
            this.store.tx(() => {
                this.store.run('INSERT INTO sources VALUES(?,?,?,?)', source, view.conversationId, JSON.stringify({ kind: 'owner-native-history-action', uid: process.getuid?.(), action: manual.kind }), raw);
                this.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, view.conversationId, view.generation, view.workId, source, 'QUEUED', 'manual', raw, JSON.stringify({ manual }));
            });
        }
        this.store.run('UPDATE conversation_state SET human_used=? WHERE conversation=?', Date.now(), view.conversationId);
        this.completed.touch(view.conversationId);
        return this.runConversation({ ...captured, initialInputId: inputId, manual });
    }
    private ordinaryCore: Ordinary | undefined;
    private interactionQuiesced = false;
    private explicitWaitContinuation(conversationId: string, completeOnly = false) {
        const inspect = () => {
            this.assertOpen();
            if (this.interactionQuiesced)
                throw Error('Interaction admission quiesced');
            const view = this.interactions.inspect(conversationId), row = this.store.one('SELECT * FROM conversation_state WHERE conversation=?', conversationId), data = parse(row.data), identity = data.sourceIdentity;
            if (view.state !== 'WAITING' || !data.continuationAuthorized || !identity || identity.conversationId !== conversationId || identity.workId !== view.workId || identity.runId !== data.runId || identity.generation !== view.generation || this.active.has(identity.workId) || this.ordinaryCore?.isBusy(conversationId) || this.interactions.getHandle(conversationId))
                return null;
            if (this.store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state IN ('QUEUED','INITIAL_RESERVED','NATIVE_PENDING')", conversationId))
                return null;
            const work = this.work(identity.workId), run = this.store.one('SELECT * FROM runs WHERE id=?', identity.runId);
            if (!run || run.work !== work.id || run.phase !== 'SETTLED' || parse(run.data).outcome !== 'waiting' || run.epoch !== work.epoch || run.generation !== work.generation || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(work.state))
                return null;
            const handles = data.waitHandles;
            if (!Array.isArray(handles) || !handles.length || new Set(handles).size !== handles.length)
                return null;
            const results = handles.map((id: string) => {
                const a = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', id);
                if (!a || !['COMPLETE', 'UNAVAILABLE'].includes(a.state))
                    return null;
                if (a.state === 'UNAVAILABLE' && completeOnly) {
                    const outcome = originalFailedWaitOutcome(this.store, conversationId, id);
                    if (outcome.state !== 'deliverable') return null;
                    return { assignmentId: outcome.assignmentId, resultId: outcome.resultId, conversationId: outcome.conversationId, workId: outcome.workId, outcome: outcome.outcome,
                        ...(outcome.historicalDiagnostic ? {historicalDiagnostic: outcome.historicalDiagnostic} : {}) };
                }
                const result = this.store.one("SELECT id,conversation,work,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM conversation_results WHERE conversation=? AND json_valid(data) AND json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1", a.target, a.id);
                if (!result || result.work !== a.work || result.conversation !== a.target || typeof result.data !== 'string' || parse(result.data).assignmentId !== a.id)
                    return null;
                return { assignmentId: a.id, resultId: result.id, conversationId: a.target, workId: a.work, outcome: a.state };
            });
            if (results.some((r: unknown) => !r))
                return null;
            return { view, data, identity, results };
        };
        const before = inspect();
        if (!before)
            return null;
        return this.interactions.enqueue({ conversationId, expectedGeneration: before.view.generation, text: 'Explicitly resumed authorized dependency outcomes (outcome is not success): ' + JSON.stringify(before.results), mode: 'idle' }, before.identity, () => {
            const current = inspect();
            if (!current || hash(current) !== hash(before))
                throw Error('WAIT continuation token/source changed; retain actual owner input');
        }, undefined, undefined, receipt => {
            const data = parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', conversationId).data);
            delete data.waitHandles;
            delete data.sourceIdentity;
            this.store.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?', 'IDLE', JSON.stringify({ ...data, continuationAuthorized: false,
                explicitContinuation: { runId: before.identity.runId, sourceIdentity: before.identity, waitHandles: before.data.waitHandles,
                    inputId: receipt.inputId, sourceId: receipt.sourceId, directionRevision: receipt.directionRevision,
                    resultIds: before.results.map((r: any) => r.resultId) } }), conversationId);
        });
    }
    private assignmentModelRequest(id: string, fallback: import('../pi/session.js').PiModelSelection, parentMode: import('./interaction-types.js').ConversationModelMode): import('./interaction-types.js').ConversationModelRequest {
        this.assertOpen();
        const assignment = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', id);
        if (!assignment || assignment.state === 'CANCELLED')
            throw Error('APPLICATION_MODEL_UNAVAILABLE: assigned task unavailable');
        this.assertTarget(assignment.target);
        const data = parse(assignment.data), sourceRun = data.source?.runId ? this.store.one('SELECT data FROM runs WHERE id=?', data.source.runId) : null;
        const sourceData = sourceRun ? parse(sourceRun.data) : {};
        const sourceMode = Object.hasOwn(sourceData, 'conversationModelMode') ? captureConversationMode(sourceData.conversationModelMode) : undefined;
        if (!Object.hasOwn(data, 'modelBinding')) {
            if (sourceMode?.kind === 'application' || parentMode.kind === 'application')
                throw Error('APPLICATION_MODEL_UNAVAILABLE: retained assignment requires its original explicit route');
            return { model: fallback };
        }
        const binding = captureAssignmentModelBinding(data.modelBinding), mode = binding.mode;
        if (binding.inheritedFrom && (binding.inheritedFrom.conversationId !== assignment.source_conversation || sourceMode?.kind !== 'application' || sourceMode.choiceRevision !== binding.inheritedFrom.choiceRevision))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment model origin changed');
        if (mode.kind === 'application') {
            if (!this.applicationModelResolver)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment resolver absent');
            const retained = assignment.work && data.operation === 'change' ? this.getWorkApplicationModelBaseline(assignment.work) : undefined;
            const choice = this.getConversationModelChoice(assignment.target);
            if (!retained && (choice.kind !== 'managed' || choice.revision !== mode.choiceRevision))
                throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment target model changed');
            return { applicationConversation: { version: 1, choiceRevision: mode.choiceRevision } };
        }
        if (parentMode.kind !== 'explicit' || mode.provider !== fallback.provider || mode.modelId !== fallback.modelId)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: assignment needs its matching explicit model route');
        const choice = this.getConversationModelChoice(assignment.target);
        if (choice.kind === 'managed' || choice.kind === 'legacy-external' && (choice.provider !== mode.provider || choice.modelId !== mode.modelId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: external assignment target changed');
        return { model: fallback };
    }
    private async resolveConversationOperation(options: import('./interaction-types.js').RunConversationOptions, completeOnly = false, validateRecipe?: () => void): Promise<import('./interaction-types.js').ResolvedConversationOptions> {
        const cid = options.conversationId;
        this.assertOpen();
        this.assertTarget(cid);
        options.signal?.throwIfAborted();
        const snapshot = () => {
            const view = this.interactions.inspect(cid), choice = this.getConversationModelChoice(cid);
            const work = view.workId ? this.store.one('SELECT data,state,epoch,generation FROM works WHERE id=?', view.workId) : null, data = work ? parse(work.data) : {};
            const mode = Object.hasOwn(data, 'conversationModelMode') ? captureConversationMode(data.conversationModelMode) : null;
            const state = parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
            return { generation: view.generation, direction: view.directionRevision, project: view.projectId, state: view.state, work: view.workId, choice, mode,
                history: view.historyRef, native: view.nativeSessionId, workVersion: work ? [work.state, work.epoch, work.generation] : null,
                wait: view.state === 'WAITING' ? { runId: state.runId, identity: state.sourceIdentity, handles: state.waitHandles, authorized: state.continuationAuthorized,
                    results: Array.isArray(state.waitHandles) ? state.waitHandles.map((id: string) => { const a = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', id); return [a, a ? this.store.one("SELECT id FROM conversation_results WHERE conversation=? AND json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1", a.target, id) : null]; }) : null } : null,
                ownerDirection: this.store.one('SELECT * FROM conversation_directions WHERE conversation=? AND revision=?', cid, view.directionRevision),
                inputs: this.store.all("SELECT i.*,s.conversation AS sourceConversation,s.origin AS sourceOrigin FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.state IN ('QUEUED','NATIVE_PENDING','INITIAL_RESERVED','RECONCILIATION_REQUIRED') ORDER BY i.rowid", cid) };
        };
        const before = snapshot();
        let fingerprint = hash(before);
        if (before.project && !this.options.runtimeProfile)
            throw Error('Explicit runtime profile required for project conversation');
        const assertModelCurrent = () => {
            validateRecipe?.();
            this.assertOpen();
            this.assertTarget(cid);
            options.signal?.throwIfAborted();
            if (this.interactionQuiesced || hash(snapshot()) !== fingerprint)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: conversation target/model/input changed during resolution');
        };
        const { model: explicit, applicationConversation, ...common } = options;
        const finish = (model: import('../pi/session.js').PiModelSelection, modelMode: import('./interaction-types.js').ConversationModelMode): import('./interaction-types.js').ResolvedConversationOptions => {
            const assertBinding = () => {
                assertModelCurrent();
                if (modelMode.kind === 'application' && before.choice.kind === 'managed')
                    this.assertApplicationModelSource(model, before.choice);
            };
            assertBinding();
            let supersedeWait: import('./interaction-types.js').ResolvedConversationOptions['supersedeWait'];
            if (!options.manual && !options.userBash) {
                const selected = before.inputs.find(input => input.state === 'QUEUED' && (!options.initialInputId || input.id === options.initialInputId));
                const direction = before.ownerDirection, wait = before.wait;
                const owner = selected && selected.generation === before.generation && selected.sourceConversation === cid &&
                    parse(selected.sourceOrigin).kind === 'owner-conversation-input' && direction?.source === selected.source && parse(direction.data).inputId === selected.id;
                if (before.state === 'WAITING' && owner) {
                    if (!wait?.authorized || !wait.identity || wait.identity.conversationId !== cid || wait.identity.workId !== before.work || wait.identity.runId !== wait.runId || wait.identity.generation !== before.generation || !Array.isArray(wait.handles) || !wait.handles.length)
                        throw Error('WAIT owner supersession needs the original authorized wait token');
                    supersedeWait = (inputId, newRunId) => {
                        assertBinding();
                        if (inputId !== selected.id)
                            throw Error('WAIT owner input changed before reservation');
                        const data = parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
                        delete data.waitHandles;
                        delete data.sourceIdentity;
                        this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...data, continuationAuthorized: false,
                            supersededContinuation: { runId: wait.runId, sourceIdentity: wait.identity, waitHandles: wait.handles, inputId, sourceId: selected.source, directionRevision: before.direction, newRunId } }), cid);
                    };
                }
                else if (!options.initialInputId) {
                    const receipt = this.explicitWaitContinuation(cid, completeOnly);
                    if (before.state === 'WAITING' && !receipt)
                        throw Error('WAIT continuation unavailable; retain original authorization and results');
                    if (receipt) {
                        common.initialInputId = receipt.inputId;
                        fingerprint = hash(snapshot());
                        supersedeWait = (inputId, newRunId) => {
                            assertBinding();
                            const data = parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
                            if (inputId !== receipt.inputId || data.explicitContinuation?.inputId !== inputId || data.explicitContinuation.sourceId !== receipt.sourceId)
                                throw Error('WAIT successor input changed before reservation');
                            this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...data,
                                explicitContinuation: { ...data.explicitContinuation, newRunId } }), cid);
                        };
                    }
                }
                else if (before.state === 'WAITING')
                    throw Error('WAIT input lacks current owner attribution; retain original authorization');
            }
            return { ...common, model, modelMode, assertModelCurrent: assertBinding, ...(supersedeWait ? { supersedeWait } : {}) };
        };
        if (applicationConversation) {
            if (before.choice.kind !== 'managed' || before.choice.revision !== applicationConversation.choiceRevision || !this.applicationModelResolver)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: exact managed target choice and installed resolver required');
            const model = captureNativeModelSelection(await this.applicationModelResolver.resolveConversation({ conversationId: cid, generation: before.generation, choiceRevision: applicationConversation.choiceRevision }));
            assertModelCurrent();
            this.assertApplicationModelSource(model, before.choice);
            if (before.state === 'WAITING') {
                if (!before.history || !before.native || !before.work)
                    throw Error('WAIT native history unavailable; preserve pending continuation');
                await this.validatePredecessor(before.work);
                await this.interactions.history(cid);
                assertModelCurrent();
            }
            return finish(model, { kind: 'application', ...applicationConversation });
        }
        if (!explicit)
            throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit recipe required');
        if (before.choice.kind === 'managed' || before.mode?.kind === 'application' && !(before.choice.kind === 'legacy-external' && before.choice.revision > before.mode.choiceRevision))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: application target requires its exact binding; save a new external choice before changing mode');
        if (before.choice.kind === 'legacy-external' && (before.choice.provider !== explicit.provider || before.choice.modelId !== explicit.modelId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit recipe differs from selected external target');
        if (before.state === 'WAITING' && before.mode?.kind === 'explicit' && (before.mode.provider !== explicit.provider || before.mode.modelId !== explicit.modelId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: retained wait requires its matching explicit route');
        assertModelCurrent();
        if (before.state === 'WAITING') {
            if (!before.history || !before.native || !before.work)
                throw Error('WAIT native history unavailable; preserve pending continuation');
            await this.validatePredecessor(before.work);
            await this.interactions.history(cid);
            assertModelCurrent();
        }
        return finish(explicit, { kind: 'explicit', provider: explicit.provider, modelId: explicit.modelId });
    }
    runConversation(options: import('./interaction-types.js').RunConversationOptions) {
        this.assertOpen();
        this.assertExecutionAdmission();
        options = captureConversationOptions(options);
        this.assertOpen();
        this.assertTarget(options.conversationId);
        if (this.interactionQuiesced)
            throw new Error('Interaction host admission quiesced; input remains queued');
        return this.ordinary.run(options);
    }
    private get ordinary(): Ordinary {
        return this.ordinaryCore ??= new Ordinary({ busyWork: id => this.integrationGrantBusy(id), goals: this.goals, store: this.store, interactions: this.interactions, capacity: this.capacity, completed: this.completed, options: this.options,
            assertApplicationSource: (model, desired) => this.assertApplicationModelSource(model, desired),
            resolveOperation: (request, completeOnly, validateRecipe) => this.resolveConversationOperation(request, completeOnly, validateRecipe), assignmentModelRequest: (id, fallback, mode) => this.assignmentModelRequest(id, fallback, mode), assertOpen: () => {
                this.assertOpen();
                this.assertExecutionAdmission();
                if (this.interactionQuiesced)
                    throw new Error('Interaction admission quiesced');
            }, assertTarget: cid => this.assertTarget(cid), entry: r => this.entry(r), patchRun: (r, p, d) => this.patchRun(r, p, d), register: (w, h) => {
                if (this.active.has(w))
                    throw new Error('Work busy');
                let done: () => void;
                h.done = new Promise<void>(resolve => done = resolve);
                (h as typeof h & {
                    settle: () => void;
                }).settle = () => done();
                this.active.set(w, h);
            }, unregister: w => {
                (this.active.get(w) as Active & {
                    settle?: () => void;
                })?.settle?.();
                this.active.delete(w);
            }, ownerRootProfile: () => this.effects.ownerRootProfile(), activateEffects: (w, inAdmission) => this.effects.activateOwnerRoot(w, undefined, inAdmission), effectContext: w => ({ integration: this.effects.grantContext(w), publication: this.publicationEngine.grantContext(w), merge: this.effects.merges.grantContext(w) }), effectControls: (identity, onQueue) => ({ merge: async (input: {
                    reviewedAssignmentId: string;
                    targetId: string;
                    branchOperationId: string;
                }) => { const receipt = await this.effects.merges.queue(input, identity, () => this.entry(identity.runId)); onQueue(receipt); return receipt; }, publishContribution: (input: {
                    resourceId: string;
                    revisionId: string;
                    targetId: string;
                }) => {
                    const receipt = this.publicationEngine.queueContribution(input, identity, () => this.entry(identity.runId));
                    if (receipt.state === 'QUEUED')
                        onQueue(receipt);
                    return receipt;
                }, publish: (input: {
                    targetId: string;
                    action: import('../platform/github-publication.js').PublicationAction;
                    reviewedAssignmentId?: string;
                }) => {
                    const receipt = this.publicationEngine.queue(input, identity, () => this.entry(identity.runId));
                    if (receipt.state === 'QUEUED')
                        onQueue(receipt);
                    return receipt;
                }, ...(this.options.effectsProfile ? { integrate: async (input: {
                        reviewedAssignmentId: string;
                        targetId: string;
                    }) => {
                        const receipt = await this.effects.queueIntegration(input, identity, () => this.entry(identity.runId));
                        onQueue(receipt);
                        return receipt;
                    } } : {}), effectInspect: (input: {
                    operationId: string;
                }) => {
                    const row = this.store.one('SELECT data FROM effect_operations WHERE id=?', input.operationId);
                    if (row && parse(row.data).kind === 'github-merge')
                        return this.effects.merges.scopedInspect(input.operationId, identity, () => this.entry(identity.runId));
                    return row && parse(row.data).kind === 'publication' ? this.publicationEngine.scopedInspect(input.operationId, identity, () => this.entry(identity.runId)) : this.effects.scopedInspect(input.operationId, identity, () => this.entry(identity.runId));
                }, effectReconcile: (input: {
                    operationId: string;
                }, signal?: AbortSignal) => {
                    const row = this.store.one('SELECT data FROM effect_operations WHERE id=?', input.operationId);
                    if (row && parse(row.data).kind === 'github-merge')
                        return this.effects.merges.scopedReconcile(input.operationId, identity, () => this.entry(identity.runId), signal);
                    if (!row || parse(row.data).kind !== 'publication')
                        return this.effects.scopedReconcile(input.operationId, identity, () => this.entry(identity.runId));
                    const parent = this.active.get(identity.workId);
                    if (!parent)
                        throw Error('Actual live reconciliation caller required');
                    return this.publicationEngine.scopedReconcile(input.operationId, identity, () => this.entry(identity.runId), AbortSignal.any([parent.abort.signal, ...(signal ? [signal] : [])]));
                } }), launchEffect: async (assignment, model) => {
                const a = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignment);
                if (!a)
                    throw Error('Retained effect assignment required');
                this.assertTarget(a.target);
                const publication = parse(a.data).operation === 'effect-publication', merge = parse(a.data).operation === 'effect-merge';
                const subject = () => merge ? this.effects.merges.operationWork(assignment) : publication ? this.publicationEngine.operationWork(assignment) : this.effects.operationWork(assignment);
                const work = subject(), before = this.work(work);
                const token = hash([a, work, before.source, before.epoch, before.generation, subjectRoleModel(this.store, work)]);
                const current = publication ? this.active.get(work) : undefined;
                if (current?.done)
                    await current.done;
                if (this.interactionQuiesced)
                    throw Error('Interaction admission quiesced');
                const now = this.work(subject()), latest = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignment);
                if (hash([latest, now.id, now.source, now.epoch, now.generation, subjectRoleModel(this.store, now.id)]) !== token)
                    throw Error('Effect subject/assignment changed while waiting for its producer');
                if (merge)
                    return this.effects.merges.runQueued(assignment);
                const operation = this.retainedWorkModelOperation(work, model);
                return publication ? this.publicationEngine.runQueued(assignment, operation) : this.effects.runQueued(assignment, operation);
            }, settleBudget: r => this.settleBudget(r), history: (r, f, i) => this.recordHistory(r, f, i), checkpoint: (r, c) => this.recordNativeCheckpoint(r, c), modelDispatch: (r, c) => this.recordModelDispatch(r, c), observe: (r, d) => this.observeOperation(r, d), reconcile: (r, w) => this.reconcileRun(r, w), validateHistory: w => this.validatePredecessor(w), cancelAssignment: (assignmentId, reason, actor) => this.cancelProvenance({ assignmentId, reason, actor }), verificationEvidence: work => this.changes.inspectVerificationEvidence(work), launchChange: async (assignmentId, request) => {
                if (this.interactionQuiesced)
                    throw new Error('Interaction admission quiesced');
                const assignment = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
                this.assertTarget(assignment.target);
                const data = parse(assignment.data), source = this.store.one('SELECT raw FROM sources WHERE id=?', data.instructionsSource);
                validateContextAssignmentLaunch(this.store, assignmentId);
                if (['CANCELLED', 'RECOVERY_READY'].includes(assignment.state))
                    throw new Error('Assigned task requires explicit queued reentry before dispatch');
                propagateRecoveredOwnerSources(this.store, assignmentId);
                effectiveAssignmentAuthority(this.store, assignmentId);
                if (assignment.work) {
                    const retained = this.work(assignment.work);
                    if (retained.project !== data.projectId)
                        throw new Error('Retained assigned project changed');
                    const baseline = this.getWorkApplicationModelBaseline(retained.id);
                    if (!!baseline !== !!request.applicationConversation)
                        throw Error('APPLICATION_MODEL_UNAVAILABLE: retained governed model mode differs');
                    if (!baseline && !request.model)
                        throw Error('APPLICATION_MODEL_UNAVAILABLE: retained explicit recipe required');
                    this.store.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'RUNNING', assignmentId);
                    return baseline ? this.changes.drive({ workId: retained.id, applicationModel: { version: 1, baselineRevision: baseline.revision } }) : this.changes.drive({ workId: retained.id, model: request.model! });
                }
                const input = this.store.one('SELECT * FROM conversation_inputs WHERE id=?', data.inputId);
                if (!input || input.state !== 'QUEUED' || this.interactions.inspect(assignment.target).directionRevision !== data.observedTargetRevision)
                    throw new Error('Assigned instructions conflicted with newer target direction; revalidate actual source');
                const choice = this.getConversationModelChoice(assignment.target);
                const baseline = request.applicationConversation ? captureWorkModelBaseline({ version: 1, revision: 1, choice: validateModelChoice(choice), source: { kind: 'conversation', conversationId: assignment.target, choiceRevision: request.applicationConversation.choiceRevision } }) : undefined;
                const preparation = { conversationId: assignment.target };
                this.assignmentPreparations.add(preparation);
                let begun: Awaited<ReturnType<ChangeCore['begin']>>;
                try {
                    begun = await this.changes.begin({ projectId: data.projectId, request: source.raw, ...(baseline ? { applicationModelBaseline: baseline } : {}) }, { kind: 'agent-governed-assignment', actor: data.source, delegationRoot: data.delegationRoot, sourceEvent: data.instructionsSource, conversationId: assignment.target, assignmentId });
                } finally { this.assignmentPreparations.delete(preparation); }
                validateContextAssignmentLaunch(this.store, assignmentId, 'captured');
                if (this.store.one('SELECT work FROM conversation_assignments WHERE id=?', assignmentId)?.work !== begun.workId)
                    throw new Error('Original assignment work changed during capture; inspect retained work');
                if (this.store.one('SELECT state FROM conversation_assignments WHERE id=?', assignmentId).state === 'CANCELLED')
                    throw new Error('Assigned task cancelled during capture');
                this.store.run('UPDATE conversation_state SET work=? WHERE conversation=?', begun.workId, assignment.target);
                this.store.run('UPDATE conversation_inputs SET state=?,work=?,data=? WHERE id=?', 'CONSUMED', begun.workId, JSON.stringify({ ...parse(input.data), governedWork: begun.workId }), data.inputId);
                this.store.run('UPDATE conversation_assignments SET work=?,state=? WHERE id=?', begun.workId, 'RUNNING', assignmentId);
                if (baseline)
                    return this.changes.drive({ workId: begun.workId, applicationModel: { version: 1, baselineRevision: baseline.revision } });
                if (!request.model)
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: assigned explicit recipe absent');
                return this.changes.drive({ workId: begun.workId, model: request.model });
            } });
    }
    private get changes() {
        return this.changeCore ??= new ChangeCore({ store: this.store, options: this.options, state: this.state, assertApplicationSource: model => this.assertApplicationModelSource(model), assertOpen: () => this.assertOpen(), assertApplicationAdmission: work => {
                if (work) {
                    this.assertWorkTarget(work);
                    this.effects.assertActivated(work);
                }
                else
                    this.assertExecutionAdmission();
            }, admit: (p, k, r, invocation, baseline, initialize) => this.admit(p, k, r, undefined, 'work', invocation, baseline, undefined, initialize), applicationModelResolverInstalled: () => !!this.applicationModelResolver, resolveApplicationRole: request => {
                this.assertOpen();
                this.assertExecutionAdmission();
                if (!this.applicationModelResolver)
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: application model resolver is not installed');
                return this.applicationModelResolver.resolveRole(request);
            }, entry: id => this.entry(id), patchRun: (i, p, d) => this.patchRun(i, p, d), settleBudget: id => this.settleBudget(id), acquireCapacity: request => {
                if (this.interactionQuiesced)
                    throw new Error('Interaction admission quiesced');
                return this.capacity.acquire(request);
            }, allocateRole: options => this.interactions.allocateRole(options), nativeLifecycle: this.interactions.lifecycle, sourceImpacts: w => this.interactions.impacts(w), coordination: identity => {
                const project = this.work(identity.workId).project;
                const { wait, ...strict } = coordination({ store: this.store, interactions: this.interactions, identity, entry: () => this.entry(identity.runId), delegation: { projectIds: project ? [project] : [], maxAssignments: 0, rootWorkId: identity.workId }, launch: () => {
                        throw new Error('Strict roles do not dispatch unplanned assignments');
                    }, onWait: () => {
                        throw new Error('WAIT unavailable to strict roles');
                    } });
                return strict;
            }, nativeCleanup: (identity, receipt) => this.interactions.cleanup(identity, receipt), register: (w, h) => {
                this.assertWorkTarget(w);
                if (this.active.has(w))
                    throw new Error('Work busy');
                let settle: () => void;
                h.done = new Promise<void>(resolve => {
                    settle = resolve;
                });
                (h as typeof h & {
                    settle: () => void;
                }).settle = () => settle();
                this.active.set(w, h);
            }, unregister: w => {
                (this.active.get(w) as (Active & {
                    settle?: () => void;
                }) | undefined)?.settle?.();
                this.active.delete(w);
            }, busy: w => this.active.has(w), cancel: async (w) => {
                await this.cancelWork({ workId: w });
            }, reconcile: (r, w) => this.reconcileRun(r, w), recordHistory: (r, f, i) => this.recordHistory(r, f, i), recordModelDispatch: (r, c) => this.recordModelDispatch(r, c), observe: (r, d) => this.observeOperation(r, d) });
    }
    recoverChanges() {
        this.changes.recover();
        this.capacity.recover();
        this.interactions.recover();
        this.effects.recover();
    }
    private effectsCore: Effects | undefined;
    private get effects() {
        return this.effectsCore ??= new Effects({ currentContributionSnapshot: resourceId => this.contributions.currentPublicationSummary(resourceId), contributionSnapshot: input => this.contributions.resolvePublication(input), store: this.store, options: this.options, changes: this.changes, interactions: this.interactions, capacity: this.capacity, assertOpen: () => this.assertOpen(), assertInteractionAdmission: () => {
                this.assertOpen();
                this.assertExecutionAdmission();
                if (this.interactionQuiesced)
                    throw Error('Interaction admission quiesced');
            }, assertOwnerConfigurationAdmission: () => {
                this.assertOpen();
                this.assertNoApplicationMutation();
                if (this.interactionQuiesced)
                    throw Error('Interaction admission quiesced');
            }, busy: w => this.active.has(w), register: (w, h) => {
                if (this.active.has(w))
                    throw Error('Work busy');
                let settled: () => void;
                h.done = new Promise<void>(resolve => settled = resolve);
                (h as typeof h & {
                    settle: () => void;
                }).settle = () => settled();
                this.active.set(w, h);
            }, unregister: w => {
                (this.active.get(w) as Active & {
                    settle?: () => void;
                })?.settle?.();
                this.active.delete(w);
            }, settleBudget: r => this.settleBudget(r), patchRun: (r, p, d) => this.patchRun(r, p, d) });
    }
    private ownerConfigurationRecovered = false;
    private get configurationEngine() {
        const engine = this.effects.configurations;
        if (this.managementOnly && !this.ownerConfigurationRecovered) {
            for (const run of this.store.all("SELECT * FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')"))
                if (parse(run.data).kind === 'configuration-http')
                    engine.recoverRun(run);
            engine.recover();
            this.ownerConfigurationRecovered = true;
        }
        return engine;
    }
    inspectRepositoryConfigurationTarget(targetId: string) { this.assertOpen(); return inspectConfigurationTarget(this.store, targetId); }
    listRepositoryConfigurationTargets(options: ConfigurationDiscoveryOptions = {}) { this.assertOpen(); return listConfigurationTargets(this.store, options); }
    listRepositoryConfigurationPlans(options: ConfigurationDiscoveryOptions = {}) { this.assertOpen(); return listConfigurationPlans(this.store, options); }
    configureRepositoryConfigurationCredential(options: import('./configuration-types.js').RepositoryConfigurationCredential) { return this.configurationEngine.configure(options); }
    registerRepositoryConfigurationTarget(options: import('./configuration-types.js').RegisterRepositoryConfigurationTarget) { return this.configurationEngine.register(options); }
    previewRepositoryConfiguration(options: import('./configuration-types.js').PreviewRepositoryConfiguration) { return this.configurationEngine.preview(options); }
    applyRepositoryConfiguration(options: import('./configuration-types.js').RepositoryConfigurationOperation) { return this.configurationEngine.apply(options); }
    reconcileRepositoryConfiguration(options: import('./configuration-types.js').RepositoryConfigurationOperation) { return this.configurationEngine.reconcile(options); }
    auditRepositoryConfiguration(options: import('./configuration-types.js').RepositoryConfigurationOperation) { return this.configurationEngine.audit(options); }
    guideRepositoryConfiguration(options: {
        targetId: string;
        branch: string;
        signal?: AbortSignal;
    }) { return this.configurationEngine.guide(options); }
    inspectRepositoryConfiguration(planId: string) { return this.configurationEngine.inspect(planId); }
    private get publicationEngine() { return this.effects.publications; }
    configurePublicationDelegations(configs: readonly PublicationDelegationConfig[]) { return this.publicationEngine.configureDelegations(configs); }
    configurePublicationCredential(options: PublicationCredential) { return this.publicationEngine.configure(options); }
    listPublicationTargets() { return this.publicationEngine.listTargets(); }
    registerPublicationTarget(options: RegisterPublicationTarget) { return this.publicationEngine.register(options); }
    delegatePublication(options: DelegatePublication) { return this.publicationEngine.delegate(options); }
    prepareContributionSummaryPublication(options: {
        resourceId: string;
        revisionId: string;
        targetId: string;
        operationId?: string;
        signal?: AbortSignal;
    }) { return this.publicationEngine.prepareContributionOwner(options); }
    prepareOwnerPublication(options: PrepareOwnerPublication) {
        if (options.workId)
            this.assertWorkTarget(options.workId);
        return this.publicationEngine.prepareOwner(options);
    }
    dispatchPublication(options: {
        operationId: string;
        signal?: AbortSignal;
    }) { this.assertOperationTarget(options.operationId); return this.publicationEngine.dispatch(options); }
    reconcilePublication(options: {
        operationId: string;
        signal?: AbortSignal;
    }) { return this.publicationEngine.reconcile(options); }
    inspectPublication(operationId: string) { return this.publicationEngine.inspect(operationId); }
    listPublications(options: {
        limit?: number;
        before?: string;
    } = {}) { return this.publicationEngine.list(options); }
    inspectRetainedPublication(operationId: string) { return this.publicationEngine.inspectRetained(operationId); }
    inspectPublicationPreparation(operationId: string) { return this.publicationEngine.preparationContext(operationId); }
    inspectPublicationDispatch(operationId: string) { return this.publicationEngine.dispatchContext(operationId); }
    inspectPublicationReconciliation(operationId: string) { return this.publicationEngine.reconciliationContext(operationId); }
    configureHostedIntegrationCredential(options: {
        token: string;
        limits?: Partial<import('../platform/github-transport.js').ReadLimits>;
    }) { this.effects.configureNormalHosted(options); }
    configureMergeCredential(options: import('./merge-types.js').MergeCredential) { this.assertNoApplicationMutation(); this.effects.merges.configure(options); }
    inspectMergeRegistration(options: import('./merge-types.js').RegisterMergeTarget) { return this.effects.merges.inspectRegistration(options); }
    registerMergeTarget(options: import('./merge-types.js').RegisterMergeTarget, signal?: AbortSignal, validate?: () => void) { this.assertNoApplicationMutation(); return this.effects.merges.register(options, signal, validate); }
    delegateMerge(options: import('./merge-types.js').DelegateMerge, validate?: () => void) {
        this.assertWorkTarget(options.workId);
        this.assertNoApplicationMutation();
        const captured = this.inspectMergeDelegation(options.workId, options.targetId);
        return this.effects.merges.delegate(options, false, () => {
            if (validate?.() !== undefined)
                throw Error('Synchronous owner merge delegation validation required');
            const current = this.inspectMergeDelegation(options.workId, options.targetId);
            if (!current.eligible || current.fingerprint !== captured.fingerprint)
                throw Error('Original merge delegation context changed or is held');
        });
    }
    inspectMergeDelegation(workId: string, targetId: string) { this.assertOpen(); return this.effects.merges.inspectDelegation(workId, targetId, this.integrationGrantBusy(workId)); }
    inspectMergeGrantRenewal(workId: string, targetId: string) { this.assertOpen(); return this.effects.merges.inspectDelegation(workId, targetId, this.integrationGrantBusy(workId), 'renewal'); }
    renewOwnerMerge(input: {
        workId: string;
        targetId: string;
        expectedContext: string;
        reason: string;
    }, validate: () => void) { this.assertOpen(); this.assertNoApplicationMutation(); const captured = { ...input }; return this.effects.merges.renew(captured.workId, captured.targetId, captured.expectedContext, captured.reason, validate, () => this.integrationGrantBusy(captured.workId)); }
    inspectMergeReauthorization(operationId: string) { this.assertOpen(); const original = this.effects.merges.inspect(operationId); return this.effects.merges.inspectReauthorization(operationId, this.integrationGrantBusy(original.workId)); }
    reauthorizeOwnerMerge(input: {
        operationId: string;
        expectedContext: string;
        reason: string;
        signal?: AbortSignal;
    }, validate: () => void) { this.assertOpen(); this.assertOperationTarget(input.operationId); this.assertNoApplicationMutation(); const captured = { ...input }, original = this.effects.merges.inspect(captured.operationId); return this.effects.merges.reauthorize(captured.operationId, captured.expectedContext, captured.reason, captured.signal, validate, () => this.integrationGrantBusy(original.workId)); }
    listMergeDelegationWorks(targetId: string, options: {
        limit?: number;
        before?: string;
    } = {}) { return this.effects.merges.listDelegationWorks(targetId, options, id => this.integrationGrantBusy(id)); }
    delegateOwnerMerge(input: {
        workId: string;
        targetId: string;
        operationLimit: number;
        notifications: 'allow-merge-notifications';
        expectedContext: string;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const captured = { ...input };
        const check = () => {
            if (validate() !== undefined)
                throw Error('Synchronous owner merge delegation validation required');
            const context = this.inspectMergeDelegation(captured.workId, captured.targetId);
            if (!context.eligible || context.fingerprint !== captured.expectedContext)
                throw Error('Original merge delegation context changed or is held; inspect it before another action');
            if (context.existing && context.existing.operationLimit !== captured.operationLimit)
                throw Error('Original merge grant cannot be reset');
            return context;
        };
        const current = check(), result = this.delegateMerge({ workId: captured.workId, targetId: captured.targetId, operationLimit: captured.operationLimit, notifications: captured.notifications, scope: current.existing?.scope ?? 'work' }, () => { check(); });
        return { ...result, reused: current.existing !== null };
    }
    listOwnerMergeOriginals(workId: string, targetId: string) { return this.effects.merges.listOwnerOriginals(workId, targetId); }
    listOwnerMergePublications(workId: string, targetId: string, options: {
        limit?: number;
        before?: string;
    } = {}) { return this.effects.merges.listOwnerPublications(workId, targetId, options); }
    inspectOwnerMergePreparation(workId: string, targetId: string, branchOperationId: string) { this.assertOpen(); return this.effects.merges.inspectOwnerPreparation(workId, targetId, branchOperationId, this.integrationGrantBusy(workId)); }
    prepareOwnerMerge(workId: string, targetId: string, branchOperationId: string, signal?: AbortSignal, validate?: () => void) {
        this.assertWorkTarget(workId);
        this.assertNoApplicationMutation();
        return this.effects.merges.prepareOwner(workId, targetId, branchOperationId, signal, validate, () => {
            if (this.integrationGrantBusy(workId))
                throw Error('Original merge owner work busy');
        });
    }
    dispatchMerge(operationId: string, signal?: AbortSignal) { this.assertOperationTarget(operationId); this.assertNoApplicationMutation(); return this.effects.merges.dispatch(operationId, signal); }
    reconcileMerge(operationId: string, mergedCommit?: string, signal?: AbortSignal) { this.assertNoApplicationMutation(); return this.effects.merges.reconcile(operationId, mergedCommit, signal); }
    inspectMergeReconciliation(operationId: string) { this.assertOpen(); const original = this.effects.merges.inspect(operationId); return this.effects.merges.inspectReconciliation(operationId, this.integrationGrantBusy(original.workId)); }
    inspectRetainedMergePreparation(operationId: string) { this.assertOpen(); const original = this.effects.merges.inspect(operationId); return this.effects.merges.inspectPreparation(operationId, this.integrationGrantBusy(original.workId)); }
    inspectMergeDispatch(operationId: string) { this.assertOpen(); const original = this.effects.merges.inspect(operationId); return this.effects.merges.inspectDispatch(operationId, this.integrationGrantBusy(original.workId)); }
    prepareRetainedOwnerMerge(input: {
        operationId: string;
        expectedContext: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        this.assertOperationTarget(input.operationId);
        this.assertNoApplicationMutation();
        const captured = { ...input };
        const admission = () => {
            const context = this.inspectRetainedMergePreparation(captured.operationId);
            if (!context.eligible || context.fingerprint !== captured.expectedContext)
                throw Error('Original PR merge preparation context changed or is held; review again');
        };
        return this.effects.merges.prepareRetained(captured.operationId, captured.signal, () => {
            if (validate() !== undefined)
                throw Error('Synchronous original merge preparation validation required');
        }, admission);
    }
    dispatchOwnerMerge(input: {
        operationId: string;
        expectedContext: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        this.assertOperationTarget(input.operationId);
        this.assertNoApplicationMutation();
        const captured = { ...input };
        const admission = () => {
            const context = this.inspectMergeDispatch(captured.operationId);
            if (!context.eligible || context.fingerprint !== captured.expectedContext)
                throw Error('Original PR merge send context changed or is held; review again');
        };
        return this.effects.merges.dispatch(captured.operationId, captured.signal, () => {
            if (validate() !== undefined)
                throw Error('Synchronous original merge dispatch validation required');
        }, admission);
    }
    reconcileOwnerMerge(input: {
        operationId: string;
        expectedContext: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const captured = { ...input };
        const admission = () => {
            const context = this.inspectMergeReconciliation(captured.operationId);
            if (!context.eligible || context.fingerprint !== captured.expectedContext)
                throw Error('Original PR merge read context changed or is held; review again');
        };
        return this.effects.merges.reconcile(captured.operationId, undefined, captured.signal, () => {
            if (validate() !== undefined)
                throw Error('Synchronous original merge read validation required');
        }, admission);
    }
    listMerges(options: {
        limit?: number;
        before?: string;
    } = {}) { return this.effects.merges.list(options); }
    inspectMergeTarget(targetId: string) { return this.effects.merges.inspectTarget(targetId); }
    listMergeTargets(options: {
        limit?: number;
        before?: string;
    } = {}) { return this.effects.merges.listTargets(options); }
    inspectRetainedMerge(operationId: string) { return this.effects.merges.inspectRetained(operationId); }
    inspectMerge(operationId: string) { return this.effects.merges.inspect(operationId); }
    registerHostedIntegrationTarget(options: import('./hostedintegration.js').RegisterHostedIntegrationTarget, controls?: {
        gitProfile?: import('./effect-types.js').EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }) { return this.effects.registerHosted(options, controls); }
    delegateHostedIntegration(options: import('./hostedintegration.js').DelegateHostedIntegration) {
        const row = this.store.one('SELECT data FROM effect_targets WHERE id=?', options.targetId);
        if (!row || parse(row.data).kind !== 'github-existing-ref')
            throw Error('Hosted existing-ref target required');
        return this.effects.delegate(options);
    }
    listIntegrationTargets(options: IntegrationTargetPage = {}) { this.assertOpen(); return listIntegrationTargets(this.store, options); }
    inspectIntegrationTarget(targetId: string) { this.assertOpen(); return inspectIntegrationTarget(this.store, targetId); }
    private integrationGrantBusy(workId: string) { return this.active.has(workId) || [...this.managedOperations.values()].some(operation => operation.workId === workId) || (this.effectsCore?.hasActiveWork(workId) ?? false); }
    inspectIntegrationDelegation(workId: string, targetId: string) { this.assertOpen(); return integrationDelegation(this.store, workId, targetId, this.integrationGrantBusy(workId)); }
    listIntegrationDelegationWorks(targetId: string, options: {
        limit?: number;
        before?: string;
    } = {}) { this.assertOpen(); return integrationDelegationWorks(this.store, targetId, options, id => this.integrationGrantBusy(id)); }
    delegateOwnerIntegration(input: {
        workId: string;
        targetId: string;
        operationLimit: number;
        expectedContext: string;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const captured = { ...input };
        const check = () => {
            if (validate() !== undefined)
                throw Error('Synchronous owner delegation validation required');
            const current = this.inspectIntegrationDelegation(captured.workId, captured.targetId);
            if (!current.eligible || current.fingerprint !== captured.expectedContext)
                throw Error('Original integration delegation context changed or is held; inspect it before another action');
            if (!Number.isSafeInteger(captured.operationLimit) || captured.operationLimit < 1 || captured.operationLimit > 100)
                throw Error('Finite integration operation limit1..100 required');
            if (current.existing && current.existing.operationLimit !== captured.operationLimit)
                throw Error('Original grant cannot be replaced or reset');
            return current;
        };
        const current = check(), result = this.effects.delegate({ workId: captured.workId, targetId: captured.targetId, operationLimit: captured.operationLimit, mode: 'ordinary', scope: current.existing?.scope ?? 'work' }, () => { check(); });
        return { ...result, reused: current.existing !== null };
    }
    inspectIntegrationGrantRenewal(workId: string, targetId: string) { this.assertOpen(); return integrationDelegation(this.store, workId, targetId, this.integrationGrantBusy(workId), 'renewal'); }
    renewOwnerIntegration(input: {
        workId: string;
        targetId: string;
        expectedContext: string;
        reason: string;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const captured = { ...input };
        if (typeof captured.reason !== 'string' || !captured.reason.trim() || Buffer.byteLength(captured.reason) > 4096)
            throw Error('A bounded owner renewal reason of1..4096 bytes is required');
        const check = () => {
            this.assertOpen();
            if (validate() !== undefined)
                throw Error('Synchronous owner renewal validation required');
            const context = this.inspectIntegrationGrantRenewal(captured.workId, captured.targetId);
            if (!context.eligible || !context.existing || context.fingerprint !== captured.expectedContext)
                throw Error('Original integration renewal context changed or is held; inspect it before another action');
            return context;
        };
        check();
        return this.store.tx(() => {
            const context = check(), previous = this.store.one('SELECT id,root,target,epoch,data FROM effect_delegations WHERE id=?', context.existing!.delegationId), data = parse(previous.data), sourceId = randomUUID();
            const origin = { kind: 'owner-effect-grant-renewal', uid: process.getuid?.(), root: previous.root, grantId: previous.id, targetId: previous.target }, event = { version: 1, grantId: previous.id, workId: previous.root, targetId: previous.target, reason: captured.reason, used: context.existing!.used, fromRootEpoch: data.rootEpoch, toRootEpoch: context.workEpoch, previous }, raw = JSON.stringify(event), next = JSON.stringify({ ...data, rootEpoch: context.workEpoch, renewal: { version: 1, sourceId } });
            if (Buffer.byteLength(raw) > 131072 || Buffer.byteLength(next) > 65536)
                throw Error('Original bounded renewal record cannot be retained');
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify(origin), raw);
            this.store.run('UPDATE effect_delegations SET epoch=epoch+1,data=? WHERE id=?', next, previous.id);
            integrationGrantHistory(this.store, { ...previous, epoch: previous.epoch + 1, data: next });
            return { delegationId: previous.id, sourceId, previousEpoch: previous.epoch, epoch: previous.epoch + 1, workEpoch: context.workEpoch, used: context.existing!.used, operationLimit: context.existing!.operationLimit };
        });
    }
    registerLocalTarget(options: RegisterLocalTarget, controls?: {
        gitProfile?: import('./effect-types.js').EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }) {
        return this.effects.register(options, controls);
    }
    delegateIntegration(options: DelegateIntegration | import('./hostedintegration.js').DelegateHostedIntegration) {
        const row = this.store.one('SELECT data FROM effect_targets WHERE id=?', options.targetId);
        if (!row || ![undefined, 'local-git', 'github-existing-ref'].includes(parse(row.data).kind))
            throw Error('Known integration target required');
        return this.effects.delegate(options);
    }
    /** Subject W controls app selection; coordinator recipes are legacy fallback only. */
    retainedWorkModelOperation(workId: string, fallback?: import('../pi/session.js').PiModelSelection, sessionPreferences?: import('../pi/session-preferences.js').SessionQueuePreferences): import('./change-types.js').ChangeOperation {
        this.assertWorkTarget(workId);
        const subject = subjectRoleModel(this.store, workId);
        if (subject.explicit && (!fallback || fallback.provider !== subject.explicit.provider || fallback.modelId !== subject.explicit.modelId))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit recipe differs from ordinary subject');
        const baseline = this.getWorkApplicationModelBaseline(workId);
        const operation: import('./change-types.js').ChangeOperation = baseline ? { workId, applicationModel: { version: 1, baselineRevision: baseline.revision }, ...(sessionPreferences ? { sessionPreferences } : {}) } :
            fallback ? { workId, model: fallback } : (() => { throw Error('APPLICATION_MODEL_UNAVAILABLE: retained legacy work requires an explicit subject model profile'); })();
        return this.changes.captureModelOperation(operation);
    }
    prepareIntegration(options: PrepareIntegration) {
        this.assertWorkTarget(options.workId);
        return this.effects.prepare(options);
    }
    dispatchIntegration(options: {
        operationId: string;
        signal?: AbortSignal;
    }) {
        this.assertOperationTarget(options.operationId);
        return this.effects.dispatch(options);
    }
    reconcileEffect(options: {
        operationId: string;
        signal?: AbortSignal;
    }) {
        return this.effects.reconcile(options);
    }
    listIntegrations(options: {
        limit?: number;
        before?: string;
    } = {}) { return this.effects.list(options); }
    inspectRetainedIntegration(operationId: string) { return this.effects.inspectRetained(operationId); }
    inspectFirstIntegrationPreparation(workId: string, targetId: string) { this.assertOpen(); return this.effects.firstPreparationContext(workId, targetId); }
    prepareFirstIntegration(options: PrepareIntegration & {
        expectedContext: string;
        gitProfile?: import('./effect-types.js').EffectsProfile;
    }, validate?: () => void, onAllocated?: (operationId: string) => void) { this.assertWorkTarget(options.workId); return this.effects.prepareFirst(options, validate, onAllocated); }
    inspectIntegrationPreparation(operationId: string) { return this.effects.preparationContext(operationId); }
    prepareRetainedIntegration(options: PrepareIntegration & {
        operationId: string;
        expectedContext: string;
        gitProfile?: import('./effect-types.js').EffectsProfile;
    }, validate?: () => void) { this.assertWorkTarget(options.workId); return this.effects.prepareRetained(options, validate); }
    inspectIntegrationReauthorization(operationId: string) { this.assertOpen(); return this.effects.reauthorizationContext(operationId); }
    reauthorizeOwnerIntegration(input: {
        operationId: string;
        expectedContext: string;
        reason: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        this.assertOperationTarget(input.operationId);
        this.assertNoApplicationMutation();
        const work = this.store.one('SELECT work FROM effect_operations WHERE id=?', input.operationId)?.work;
        return this.effects.reauthorizeOwner(input, () => {
            if (this.integrationGrantBusy(work))
                throw Error('Original integration producer is busy');
            return validate();
        });
    }
    inspectIntegrationDispatch(operationId: string) { return this.effects.dispatchContext(operationId); }
    dispatchRetainedIntegration(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: import('./effect-types.js').EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) { this.assertOperationTarget(options.operationId); return this.effects.dispatchRetained(options, validate); }
    inspectIntegrationReconciliation(operationId: string) { return this.effects.reconciliationContext(operationId); }
    reconcileRetainedIntegration(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: import('./effect-types.js').EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) { return this.effects.reconcileRetained(options, validate); }
    inspectEffect(operationId: string) {
        return this.effects.inspect(operationId);
    }
    private assertOwnerChangeIdle(cid: string) {
        const view = this.interactions.inspect(cid);
        const state = parse(this.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
        if (this.lifecycleBusy.has(cid) || this.ordinaryCore?.isBusy(cid) || this.interactions.getHandle(cid) ||
            !['IDLE', 'WAITING'].includes(view.state) || state.dialogs?.length || Object.hasOwn(state, 'role'))
            throw Error('Settle the original conversation producer before managed work');
        const reasons = lifecycleReasons(this.store, cid)
            .filter(reason => /^(input:|run:|capacity:|dependency:|assignment:|effect:)/u.test(reason));
        if (reasons.length) {
            throw Object.assign(Error('Earlier conversation requests or work still need attention. Open /inputs to review sent requests before starting a project task.'), {
                recovery: 'Use /inputs to review safe retry or withdrawal. For unresolved execution, inspect /work. Original obligations: ' + reasons.join(';'),
            });
        }
        if (this.store.one("SELECT id FROM goals WHERE conversation=? AND state NOT IN ('COMPLETED','CANCELLED')", cid))
            throw Error('Finish or cancel the original goal before explicit managed work');
    }
    /** Read-only owner route; neither view selection nor inspection dispatches work. */
    conversationChange(conversationId: string) {
        this.assertOpen();
        const view = this.interactions.inspect(conversationId);
        if (!view.projectId)
            return { workId: null };
        return { workId: ownerChangeRoute(this.store, conversationId, view.projectId).workId };
    }
    private ownConversationChange(cid: string, workId: string | null, signal: AbortSignal | undefined, body: (operation: {
        token: symbol;
        workId: string | null;
        abort: AbortController;
        done: Promise<ChangeView>;
    }, signal: AbortSignal) => Promise<ChangeView>) {
        this.assertOpen();
        this.assertTarget(cid);
        this.assertOwnerChangeIdle(cid);
        if (this.interactionQuiesced)
            throw Error('Interaction host admission quiesced');
        if (workId)
            this.assertManagedDispatch(workId);
        signal?.throwIfAborted();
        const operation = { token: Symbol('managed-owner'), workId, abort: new AbortController(), done: undefined as unknown as Promise<ChangeView> };
        this.managedOperations.set(cid, operation);
        const combined = signal ? AbortSignal.any([signal, operation.abort.signal]) : operation.abort.signal;
        operation.done = Promise.resolve().then(() => body(operation, combined)).catch(error => {
            if (operation.workId && this.store.one('SELECT work FROM change_state WHERE work=?', operation.workId)) {
                if (error instanceof ControllerError && error.workId)
                    throw error;
                throw new ControllerError('MANAGED_CHANGE_FAILED', error instanceof Error ? error.message : 'Managed work unavailable', 'Inspect this original work and recover its retained state; do not create replacement work', operation.workId);
            }
            throw error;
        }).finally(() => {
            if (this.managedOperations.get(cid) === operation)
                this.managedOperations.delete(cid);
            this.completedCore?.changed();
            if (!this.interactionQuiesced && !this.closing)
                this.ordinaryCore?.resumeAuthorized();
        });
        return operation.done;
    }
    private ownerChangeSnapshot(input: {
        conversationId: string;
        expectedGeneration: number;
        expectedModelRevision: number;
    }) {
        this.assertOpen();
        const view = this.interactions.inspect(input.conversationId), choice = this.getConversationModelChoice(input.conversationId);
        if (!Number.isSafeInteger(input.expectedGeneration) || !Number.isSafeInteger(input.expectedModelRevision) || view.generation !== input.expectedGeneration || choice.revision !== input.expectedModelRevision || view.deleted || view.archived)
            throw Error('Managed work conversation or model selection changed; reopen its action');
        return view;
    }
    startConversationChange(input: StartConversationChangeOptions): Promise<ChangeView> {
        const captured = { ...input, ...(input.ownerRequirements ? { ownerRequirements: structuredClone(input.ownerRequirements) } : {}), ...(input.applicationModelBaseline ? { applicationModelBaseline: captureWorkModelBaseline(input.applicationModelBaseline) } : {}), ...(input.model ? { model: captureNativeModelSelection(input.model) } : {}) };
        const view = this.ownerChangeSnapshot(captured), cid = view.conversationId;
        if (!view.projectId || view.projectId !== captured.projectId)
            throw Error('Select the intended registered project before managed work');
        if (!this.options.runtimeProfile)
            throw Error('Configure and apply the execution runtime through /ready before managed work');
        if (!captured.request?.trim())
            throw Error('Explicit owner request required');
        if (captured.maximumSteps !== undefined && (!Number.isSafeInteger(captured.maximumSteps) || captured.maximumSteps < 1 || captured.maximumSteps > 100))
            throw Error('Managed drive steps must be 1..100');
        if (captured.applicationModelBaseline && captured.model)
            throw Error('Choose the captured application baseline or explicit external model, not both');
        if (!captured.applicationModelBaseline && !captured.model)
            throw Error('Select an application model or explicit external model for managed work');
        if (captured.applicationModelBaseline && (captured.applicationModelBaseline.source.kind !== 'conversation' || captured.applicationModelBaseline.source.conversationId !== cid || captured.applicationModelBaseline.source.choiceRevision !== captured.expectedModelRevision))
            throw Error('Managed owner admission requires the captured selected conversation model');
        const route = ownerChangeRoute(this.store, cid, view.projectId);
        if (route.workId)
            throw new ControllerError('RETAINED_CHANGE', 'This conversation already refers to governed work; a new request was not applied', 'Inspect and explicitly resume or amend the original work', route.workId);
        return this.ownConversationChange(cid, null, captured.signal, async (operation, signal) => {
            signal.throwIfAborted();
            this.ownerChangeSnapshot(captured);
            const begun = await this.changes.begin({ ...captured, signal }, { kind: 'owner-conversation-change', uid: process.getuid?.(), conversationId: cid, expectedGeneration: view.generation, expectedModelRevision: captured.expectedModelRevision, routeFingerprint: hash(route.snapshot), ownerToken: operation.token });
            operation.workId = begun.workId;
            if (signal.aborted || this.work(begun.workId).state !== 'ACTIVE')
                return this.changes.inspect(begun.workId);
            this.effects.activateOwnerRoot(begun.workId);
            if (signal.aborted)
                return this.changes.inspect(begun.workId);
            const model = this.getWorkApplicationModelBaseline(begun.workId);
            return this.changes.drive({ workId: begun.workId, signal, ...(captured.maximumSteps !== undefined ? { maximumSteps: captured.maximumSteps } : {}), ...(model ? { applicationModel: { version: 1, baselineRevision: model.revision } } : { model: captured.model! }) });
        });
    }
    resumeConversationChange(input: ResumeConversationChangeOptions): Promise<ChangeView> {
        const captured = { ...input, ...(input.model ? { model: captureNativeModelSelection(input.model) } : {}) }, view = this.ownerChangeSnapshot(captured), work = this.work(input.workId);
        if (work.epoch !== input.expectedEpoch)
            throw Error('Original work epoch changed; inspect before resume');
        if (work.state === 'UNKNOWN')
            throw new ControllerError('CLEANUP_UNKNOWN', 'Original work cleanup is unknown', 'Reconcile its original runtime/history before resuming', work.id);
        if (!this.options.runtimeProfile)
            throw Error('Configure and apply the execution runtime through /ready before managed work');
        if (!Number.isSafeInteger(captured.expectedEpoch) || captured.expectedEpoch < 1 || captured.resumeCancelled !== undefined && typeof captured.resumeCancelled !== 'boolean')
            throw Error('Resume requires the exact epoch and an explicit cancelled-work choice');
        if (captured.maximumSteps !== undefined && (!Number.isSafeInteger(captured.maximumSteps) || captured.maximumSteps < 1 || captured.maximumSteps > 100))
            throw Error('Managed drive steps must be 1..100');
        const assertRoute = () => {
            this.ownerChangeSnapshot(captured);
            const route = view.projectId ? ownerChangeRoute(this.store, view.conversationId, view.projectId) : { workId: null };
            if (route.workId !== work.id && !(route.workId === null && !view.workId && !parse(work.data).conversation))
                throw Error('Use the original source conversation for this retained work');
        };
        const baseline = this.getWorkApplicationModelBaseline(work.id);
        if (baseline && captured.model)
            throw Error('Retained application work cannot use a replacement external model');
        if (!baseline && !captured.model)
            throw Error('The original work requires its explicit external model profile');
        return this.ownConversationChange(view.conversationId, work.id, captured.signal, async (_operation, signal) => {
            signal.throwIfAborted();
            this.ownerChangeSnapshot(captured);
            if (this.work(work.id).epoch !== captured.expectedEpoch)
                throw Error('Original work epoch changed before resume');
            const activation = parse(this.work(work.id).data).ownerRootActivation;
            if (activation?.state === 'PENDING')
                this.effects.activateOwnerRoot(work.id, { expectedEpoch: work.epoch, resumeCancelled: captured.resumeCancelled ?? false, validate: assertRoute });
            else
                this.store.tx(() => {
                    const current = this.work(work.id);
                    if (current.state === 'CANCELLED' && !captured.resumeCancelled)
                        throw Error('Explicit resumeCancelled is required for cancelled work');
                    if (['CANCELLED', 'INTERRUPTED'].includes(current.state))
                        this.store.run("UPDATE works SET state='ACTIVE',epoch=epoch+1,generation=generation+1 WHERE id=?", work.id);
                    assertRoute();
                    this.effects.assertActivated(work.id);
                });
            signal.throwIfAborted();
            return this.changes.drive({ workId: work.id, signal, ...(captured.maximumSteps !== undefined ? { maximumSteps: captured.maximumSteps } : {}), ...(baseline ? { applicationModel: { version: 1, baselineRevision: baseline.revision } } : { model: captured.model! }) });
        });
    }
    async settleConversationChanges(conversationIds?: readonly string[]): Promise<void> {
        const held = [...this.managedOperations].filter(([cid]) => !conversationIds || conversationIds.includes(cid)).map(([, operation]) => operation);
        for (const operation of held)
            operation.abort.abort();
        await Promise.allSettled(held.map(operation => operation.done));
    }
    async beginChange(options: BeginChangeOptions) {
        const begun = await this.changes.begin(options);
        if (options.signal?.aborted || this.work(begun.workId).state !== 'ACTIVE')
            return this.changes.inspect(begun.workId);
        try {
            this.effects.activateOwnerRoot(begun.workId);
        }
        catch (error) {
            throw new ControllerError('OWNER_ACTIVATION_REQUIRED', `Work was created but owner activation failed: ${error instanceof Error ? error.message : 'unavailable'}`, 'Inspect this original work, restore its captured delegation profile and use change activate; do not start replacement work', begun.workId);
        }
        return this.changes.inspect(begun.workId);
    }
    activateChangeOwner(input: {
        workId: string;
        expectedEpoch: number;
        resumeCancelled?: boolean;
    }) {
        this.assertManagedDispatch(input.workId);
        this.assertOpen();
        this.assertNoApplicationMutation();
        this.assertWorkLifecycle(input.workId);
        if (this.active.has(input.workId))
            throw Error('Owning work operation active; settle capture before owner activation');
        if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1 || input.resumeCancelled !== undefined && typeof input.resumeCancelled !== 'boolean')
            throw Error('Activation requires an exact epoch and explicit cancelled-work recovery choice');
        try {
            this.effects.activateOwnerRoot(input.workId, { expectedEpoch: input.expectedEpoch, resumeCancelled: input.resumeCancelled ?? false });
        }
        catch (error) {
            throw new ControllerError('OWNER_ACTIVATION_REQUIRED', error instanceof Error ? error.message : 'Owner activation unavailable', 'Inspect this original work and retry its captured delegation profile with its current epoch; reconcile unknown cleanup before activation', input.workId);
        }
        return this.changes.inspect(input.workId);
    }
    /** Read the durable registry without resolving models, recovering work or creating a producer. */
    listChanges(options: {
        projectId?: string;
        limit?: number;
        before?: string;
    } = {}): import('./change-types.js').ChangePage {
        this.assertOpen();
        if (Object.keys(options).some(key => !['projectId', 'limit', 'before'].includes(key)))
            throw Error('Unknown change-list option');
        const limit = options.limit ?? 50;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Change-list limit must be between 1 and 100');
        const where: string[] = [], values: (string | number)[] = [];
        if (options.projectId !== undefined) {
            if (!this.store.one('SELECT id FROM projects WHERE id=?', options.projectId))
                throw new ControllerError('MISSING_PROJECT', 'Change-list project is not registered', 'Select a registered project or list all changes');
            where.push('w.project=?');
            values.push(options.projectId);
        }
        if (options.before !== undefined) {
            const cursor = this.store.one('SELECT w.rowid AS position FROM works w JOIN change_state c ON c.work=w.id WHERE w.id=?', options.before);
            if (!cursor)
                throw Error('Unknown change-list cursor; reopen the first page');
            where.push('w.rowid<?');
            values.push(cursor.position);
        }
        const rows = this.store.all(`SELECT w.id,w.project,w.state,json_extract(w.data,'$.applicationModelBaseline') AS baseline,c.phase,substr(s.raw,1,500) AS preview FROM works w JOIN change_state c ON c.work=w.id JOIN sources s ON s.id=w.source ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.rowid DESC LIMIT ?`, ...values, limit + 1);
        return { changes: rows.slice(0, limit).map(row => {
                const baseline = row.baseline === null ? undefined : captureWorkModelBaseline(parse(row.baseline));
                return { workId: row.id, projectId: row.project, state: row.state, recordedPhase: row.phase, requestPreview: row.preview,
                    originConversationId: baseline?.source.kind === 'conversation' ? baseline.source.conversationId : null,
                    model: baseline ? { provider: baseline.choice.provider, modelId: baseline.choice.modelId } : null };
            }), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    }
    listLocalChecks(projectId: string, options: {
        limit?: number;
        before?: string;
    } = {}) { this.assertOpen(); return listLocalChecks(this.store, projectId, options); }
    inspectLocalCheck(workId: string) { this.assertOpen(); return inspectLocalCheck(this.store, workId, id => this.active.has(id)); }
    startOwnerLocalCheck(options: LocalCheckOptions, assertCurrent: () => unknown) {
        if (options.continuationCheckpoint !== undefined)
            throw Error('Use explicit original-check continuation, not a new-check checkpoint');
        return this.runLocalCheckGuarded(options, () => {
            if (assertCurrent() !== undefined)
                throw Error('Synchronous owner local-check validation required');
        });
    }
    async resumeOwnerLocalCheck(input: {
        expected: LocalCheckView;
        resumeCancelled?: boolean;
        signal?: AbortSignal;
    }, assertCurrent: () => unknown) {
        const expected = structuredClone(input.expected), resumeCancelled = input.resumeCancelled === true, guard = () => {
            if (assertCurrent() !== undefined)
                throw Error('Synchronous owner local-check validation required');
            const current = this.inspectLocalCheck(expected.workId);
            if (hash(current) !== hash(expected))
                throw Error('Original local check changed; reopen its current details');
            if (current.unsettled || !['DELIVERED', 'BLOCKED', 'CANCELLED'].includes(current.state))
                throw Error('Original local check is unsettled; reconcile its exact original producer before resuming');
            if (current.state === 'CANCELLED' && !resumeCancelled)
                throw Error('Explicit cancelled-check continuation required');
        };
        guard();
        return this.runLocalCheckGuarded({ projectId: expected.projectId, command: expected.command, cwd: expected.cwd, continuationCheckpoint: expected.workId, ...input.signal ? { signal: input.signal } : {} }, guard);
    }
    /** Bounded management read across ordinary and governed original work. */
    listWorks(options: {
        limit?: number;
        before?: string;
    } = {}) {
        this.assertOpen();
        const limit = options.limit ?? 50;
        if (Object.keys(options).some(k => !['limit', 'before'].includes(k)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw Error('Work list requires a bounded limit 1..100');
        const cursor = options.before ? this.store.one('SELECT rowid AS position FROM works WHERE id=?', options.before) : undefined;
        if (options.before && !cursor)
            throw Error('Unknown work cursor; reopen /work');
        const rows = this.store.all(`SELECT w.id AS workId,w.project AS projectId,w.state,w.lineage AS lineageRoot,c.phase AS recordedPhase,substr(s.raw,1,500) AS requestPreview FROM works w JOIN sources s ON s.id=w.source LEFT JOIN change_state c ON c.work=w.id ${cursor ? 'WHERE w.rowid<?' : ''} ORDER BY w.rowid DESC LIMIT ?`, ...(cursor ? [cursor.position] : []), limit + 1);
        return { works: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.workId : null };
    }
    inspectWorkRecovery(workId: string) {
        this.assertOpen();
        const allowance = workAllowance(this.store, workId);
        const row = this.store.one("SELECT w.project AS projectId,w.state,json_extract(w.data,'$.kind') AS kind,json_type(w.data,'$.contextOrigin') IS NOT NULL AS contextDerived,substr(s.raw,1,32769) AS request,COALESCE(json_extract(s.origin,'$.conversationId'),json_extract(w.data,'$.applicationModelBaseline.source.conversationId'),json_extract(w.data,'$.conversation')) AS conversationId,c.phase AS recordedPhase,json_extract(c.data,'$.nextAction') AS nextAction FROM works w JOIN sources s ON s.id=w.source LEFT JOIN change_state c ON c.work=w.id WHERE w.id=?", workId);
        return { ...allowance, ...row, obligations: this.store.one('SELECT COUNT(*) AS n FROM obligations WHERE work=?', workId).n, findings: this.store.one('SELECT COUNT(*) AS n FROM finding_occurrences WHERE work=?', workId).n };
    }
    private startupCleanupContext(workId: string, ownConversation?: string) {
        return inspectStartupCleanupRecovery(this.store, this.options.installationHome, workId, id => {
            const cid = parse(this.work(id).data).conversation;
            return this.active.has(id) || !!this.ordinaryCore?.isBusy(cid) || !!this.interactions.getHandle(cid) ||
                !!this.managedOperations.get(cid) || this.lifecycleBusy.has(cid) && cid !== ownConversation;
        });
    }
    inspectStartupCleanup(workId: string) {
        this.assertOpen();
        const task = this.startupCleanupContext(workId);
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    recoverStartupCleanup(input: {
        workId: string;
        expectedContext: string;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const capturedInput = { ...input };
        const task = (async () => {
            const assertCurrent = () => {
                this.assertOpen();
                this.assertNoApplicationMutation();
                this.contextAbort.signal.throwIfAborted();
                if (validate() !== undefined)
                    throw Error('Synchronous original startup recovery validation required');
            };
            assertCurrent();
            const context = await this.startupCleanupContext(capturedInput.workId);
            assertCurrent();
            if (!context.eligible || !context.captured || !context.conversationId || context.fingerprint !== capturedInput.expectedContext)
                throw Error('Original startup cleanup changed or is held; reopen /work');
            const cid = context.conversationId;
            this.assertTarget(cid);
            this.lifecycleBusy.add(cid);
            try {
                const locked = await this.startupCleanupContext(capturedInput.workId, cid);
                assertCurrent();
                if (!locked.eligible || !locked.captured || locked.fingerprint !== capturedInput.expectedContext)
                    throw Error('Original startup cleanup changed; reopen /work');
                const saved = locked.captured;
                const check = (journalDigest = saved.journal.digest) => {
                    assertCurrent();
                    assertStartupCleanupSnapshot(this.store, saved, journalDigest);
                };
                check();
                const sourceId = randomUUID();
                const receipt = {
                    version: 1, workId: saved.work.id, runId: saved.run.id, conversationId: cid,
                    kind: 'original-create-rejection', observationId: saved.observation.id,
                    observationHash: hash(saved.observation.data), journalFile: saved.journal.file,
                    previousJournal: saved.journal.value, journalHash: saved.journal.digest,
                    evidence: saved.evidence, allowances: saved.budgets,
                };
                const raw = JSON.stringify(receipt);
                if (Buffer.byteLength(raw) > 131072)
                    throw Error('Original startup cleanup receipt exceeds its bounded profile');
                const settled = await settleRejectedScopeCreate(saved.journal.file, saved.journal.raw, saved.evidence, check);
                const result = this.store.tx(() => {
                    check(settled.journalHash);
                    this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, cid, JSON.stringify({ kind: 'owner-startup-cleanup-recovery', uid: process.getuid?.(), workId: saved.work.id, runId: saved.run.id }), raw);
                    this.patchRun(saved.run.id, 'SETTLED', { cleanup: 'removed', startupCleanupRecovery: sourceId });
                    this.store.run("UPDATE works SET state='ACTIVE' WHERE id=?", saved.work.id);
                    const viewData = parse(saved.view.data);
                    this.store.run("UPDATE conversation_state SET resource='IDLE',data=? WHERE conversation=?", JSON.stringify({ ...viewData, cleanup: { cleanup: 'removed', settled: true } }), cid);
                    const lease = saved.leases[0]!;
                    this.store.run("UPDATE capacity_leases SET state='RELEASED',data=? WHERE id=?", JSON.stringify({ ...parse(lease.data), receipt: { cleanup: 'removed', settled: true }, startupCleanupRecovery: sourceId }), lease.id);
                    return { workId: saved.work.id, runId: saved.run.id, conversationId: cid, sourceId, cleanup: 'removed', execution: 'not dispatched' };
                });
                this.capacityCore?.changed();
                return result;
            }
            finally {
                this.releaseLifecycle(cid);
            }
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    listWorkEvidence(workId: string, kind: 'obligations' | 'findings', before?: string) {
        this.assertOpen();
        this.work(workId);
        if (!['obligations', 'findings'].includes(kind))
            throw Error('Select obligations or finding occurrences');
        const table = kind === 'findings' ? 'finding_occurrences' : 'obligations';
        const cursor = before ? this.store.one(`SELECT rowid AS position FROM ${table} WHERE work=? AND id=?`, workId, before) : undefined;
        if (before && !cursor)
            throw Error('Unknown evidence cursor; reopen this original work');
        const rows = this.store.all(`SELECT rowid AS position,id,data FROM ${table} WHERE work=? ${cursor ? 'AND rowid<?' : ''} ORDER BY rowid DESC LIMIT 26`, workId, ...(cursor ? [cursor.position] : []));
        return { items: rows.slice(0, 25).map(row => {
                const data = parse(row.data), producer = kind === 'findings' ? this.store.one("SELECT l.id AS launchId,l.role,json_extract(l.data,'$.inputVersions.candidate') AS candidate FROM finding_occurrences f JOIN role_outputs o ON o.id=f.output JOIN role_launches l ON l.id=o.launch WHERE f.id=?", row.id) : null;
                const disposition = kind === 'findings' ? this.store.one('SELECT status,data FROM finding_dispositions WHERE occurrence=? ORDER BY rowid DESC LIMIT 1', row.id) : null;
                return { id: row.id, data, producer, disposition: disposition ? { status: disposition.status, data: parse(disposition.data) } : null };
            }), nextCursor: rows.length > 25 ? rows[24]!.id : null };
    }
    inspectWorkAllowance(workId: string) { this.assertOpen(); return workAllowance(this.store, workId); }
    inspectOrdinaryWorkRecovery(workId: string) { this.assertOpen(); return ordinaryWorkRecovery(this.store, workId, id => this.integrationGrantBusy(id)); }
    inspectContextWorkRecovery(workId: string) { this.assertOpen(); return contextWorkRecovery(this.store, workId, id => this.integrationGrantBusy(id)); }
    recoverContextWorkAdmission(input: {
        workId: string;
        expectedContext: string;
        reason: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        const captured = { ...input };
        const task = (async () => {
            this.assertOpen();
            this.assertNoApplicationMutation();
            if (typeof captured.reason !== 'string' || !captured.reason.trim() || Buffer.byteLength(captured.reason) > 4096)
                throw Error('A bounded owner context recovery reason of1..4096 bytes is required');
            const check = () => {
                this.assertOpen();
                this.assertNoApplicationMutation();
                this.contextAbort.signal.throwIfAborted();
                captured.signal?.throwIfAborted();
                if (validate() !== undefined)
                    throw Error('Synchronous owner context recovery validation required');
                this.assertOpen();
                this.assertNoApplicationMutation();
                this.contextAbort.signal.throwIfAborted();
                captured.signal?.throwIfAborted();
                const context = this.inspectContextWorkRecovery(captured.workId);
                if (!context.eligible || context.fingerprint !== captured.expectedContext)
                    throw Error('Original context recovery changed or is held; reopen /work');
                for (const view of context.captured.views) {
                    this.assertTarget(view.conversation.id);
                    if (this.interactions.getHandle(view.conversation.id))
                        throw Error('Original native response must settle before context recovery');
                }
                return context;
            };
            const context = check(), { nativeCheckpoint } = await import('./history.js');
            check();
            const { validateNativeSeed, currentNativeHeader } = await import('./native-seed.js');
            check();
            const clone = context.captured.views[1];
            validateNativeSeed(context.captured.seed, { conversationId: context.conversationId, nativeSessionId: clone.view.native_id, historyRef: clone.conversation.history }, this.state);
            const histories: {
                workId: string;
                conversationId: string;
                runId: string;
                historyRef: string;
                checkpoint: Awaited<ReturnType<typeof nativeCheckpoint>>;
                verified: Awaited<ReturnType<typeof nativeCheckpoint>>;
            }[] = [];
            for (const h of context.captured.histories) {
                await privateFile(h.historyRef);
                check();
                await currentNativeHeader(h.historyRef, h.checkpoint.sessionId);
                check();
                const seed = h.workId === context.captured.root.id ? context.captured.seed.source : context.captured.seed.destination;
                await nativeCheckpoint(h.historyRef, seed.checkpoint);
                check();
                const verified = await nativeCheckpoint(h.historyRef, h.checkpoint);
                check();
                histories.push({ ...h, verified });
            }
            return this.store.tx(() => {
                check();
                const sourceId = randomUUID(), saved = context.captured;
                const event = { version: 1, workId: captured.workId, conversationId: context.conversationId, identity: saved.identity, fromEpoch: saved.work.epoch, toEpoch: saved.work.epoch + 1, sourceEpoch: saved.root.epoch, previousSource: parse(saved.work.data).contextAdmissionRecoverySource ?? null, reason: captured.reason, histories, modelSource: parse(saved.work.data).ordinaryRoleBinding ?? null, ...(saved.cancelledWait ? { cancelledWait: saved.cancelledWait.receipt } : {}) };
                const raw = JSON.stringify(event), data = JSON.stringify({ ...parse(saved.work.data), contextAdmissionRecoverySource: sourceId });
                if (Buffer.byteLength(raw) > 131072 || Buffer.byteLength(data) > 1048576)
                    throw Error('Original context recovery exceeds its bounded profile');
                this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, context.conversationId, JSON.stringify({ kind: 'owner-context-admission-recovery', uid: process.getuid?.(), workId: captured.workId }), raw);
                this.store.run("UPDATE works SET state='ACTIVE',epoch=epoch+1,data=? WHERE id=?", data, captured.workId);
                if (saved.cancelledWait) {
                    const scheduler = parse(clone.view.boundedData);
                    delete scheduler.waitHandles;
                    delete scheduler.continuationAuthorized;
                    delete scheduler.sourceIdentity;
                    this.store.run("UPDATE conversation_state SET resource='IDLE',data=? WHERE conversation=?", JSON.stringify(scheduler), context.conversationId);
                }
                const proof = contextAdmissionProof(this.store, context.conversationId, saved.origin, saved.family);
                if (proof?.sourceId !== sourceId)
                    throw Error('Original context recovery result correspondence unavailable');
                return { workId: captured.workId, conversationId: context.conversationId, sourceId, epoch: event.toEpoch, state: 'ACTIVE' as const, physicalHistory: 'verified', execution: 'not dispatched', withdrawCancelledWait: !!saved.cancelledWait };
            });
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    recoverOrdinaryWorkAdmission(input: {
        workId: string;
        expectedContext: string;
        reason: string;
    }, validate: () => unknown) {
        this.assertOpen();
        this.assertNoApplicationMutation();
        const captured = { ...input };
        if (typeof captured.reason !== 'string' || !captured.reason.trim() || Buffer.byteLength(captured.reason) > 4096)
            throw Error('A bounded owner recovery reason of1..4096 bytes is required');
        const check = () => {
            this.assertOpen();
            if (validate() !== undefined)
                throw Error('Synchronous owner recovery validation required');
            const context = this.inspectOrdinaryWorkRecovery(captured.workId);
            if (!context.eligible || context.fingerprint !== captured.expectedContext || !context.conversationId)
                throw Error('Original ordinary recovery context changed or is held; reopen /work');
            this.assertTarget(context.conversationId);
            if (this.interactions.getHandle(context.conversationId))
                throw Error('Original native response must settle before admission recovery');
            return context;
        };
        check();
        return this.store.tx(() => {
            const context = check(), view = this.store.one('SELECT resource,data FROM conversation_state WHERE conversation=?', context.conversationId), sourceId = randomUUID(), data = parse(view.data);
            const raw = JSON.stringify({ version: 1, workId: context.workId, conversationId: context.conversationId, reason: captured.reason, previous: { state: context.workState, epoch: context.workEpoch, generation: context.workGeneration, conversation: view }, withdrawCancelledWait: context.withdrawCancelledWait, withdrawConsumedWait: context.withdrawConsumedWait });
            if (Buffer.byteLength(raw) > 131072)
                throw Error('Original recovery source exceeds its bounded profile');
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'owner-ordinary-admission-recovery', uid: process.getuid?.(), workId: context.workId, conversationId: context.conversationId }), raw);
            this.store.run("UPDATE works SET state='ACTIVE',epoch=epoch+1 WHERE id=?", context.workId);
            if (context.withdrawCancelledWait || context.withdrawConsumedWait) {
                delete data.waitHandles;
                delete data.continuationAuthorized;
                delete data.sourceIdentity;
                this.store.run("UPDATE conversation_state SET resource='IDLE',data=? WHERE conversation=?", JSON.stringify(data), context.conversationId);
            }
            const result = this.inspectWorkRecovery(context.workId);
            if (result.state !== 'ACTIVE' || result.epoch !== context.workEpoch + 1 || result.conversationId !== context.conversationId)
                throw Error('Original ordinary recovery result correspondence unavailable');
            return { workId: context.workId, conversationId: context.conversationId, sourceId, epoch: result.epoch, generation: context.workGeneration, withdrawCancelledWait: context.withdrawCancelledWait, withdrawConsumedWait: !!context.withdrawConsumedWait, state: 'ACTIVE' as const };
        });
    }
    extendWorkAllowance(input: {
        expected: WorkAllowanceSnapshot;
        kind: 'execution' | 'resolution';
        additional: number;
        reason: string;
    }) {
        this.assertOpen();
        input = structuredClone(input);
        if (!['execution', 'resolution'].includes(input.kind) || typeof input.reason !== 'string' || !input.reason.trim())
            throw Error('Select a work allowance and provide an explicit owner reason');
        const validate = () => {
            const heldWorks = new Set<string>(), preparingLineages = new Set<string>();
            for (const [cid, op] of this.managedOperations) {
                if (op.workId)
                    heldWorks.add(op.workId);
                else {
                    const source = this.store.one('SELECT w.lineage FROM conversation_state s JOIN works w ON w.id=s.work WHERE s.conversation=?', cid);
                    if (source)
                        preparingLineages.add(source.lineage);
                    const binding = contextBinding(this.store, cid);
                    if (binding?.family.budgetLineage)
                        preparingLineages.add(binding.family.budgetLineage);
                }
            }
            assertAllowanceExtension(this.store, input.expected, input.kind, input.additional, id => this.active.has(id) || heldWorks.has(id) || preparingLineages.has(input.expected.lineageRoot));
        };
        try {
            if (input.kind === 'execution')
                return this.extendExecutionAllowance({ workId: input.expected.workId, additional: input.additional, reason: input.reason }, validate);
            return this.changes.extend(input.expected.workId, input.additional, input.reason, validate);
        }
        catch (error) {
            throw new ControllerError('WORK_ALLOWANCE_REFUSED', error instanceof Error ? error.message : 'Original work allowance unavailable', 'Inspect /work ' + input.expected.workId + ' and its shared lineage; settle/reconcile retained work before a fresh explicit extension', input.expected.workId);
        }
    }
    goalRecoveryWorkIds(goalId: string) { this.assertOpen(); return this.goals.recoveryWorks(goalId); }
    /** Bounded recorded activity only; this is not current procedure eligibility. */
    inspectChangeActivity(workId: string): {
        workId: string;
        state: string;
        recordedPhase: string;
        activationPending: boolean;
    } | undefined {
        this.assertOpen();
        const row = this.store.one("SELECT w.id,w.state,c.phase,json_extract(w.data,'$.ownerRootActivation.state') AS activation FROM works w JOIN change_state c ON c.work=w.id WHERE w.id=?", workId);
        return row ? { workId: row.id, state: row.state, recordedPhase: row.phase, activationPending: row.activation === 'PENDING' } : undefined;
    }
    inspectChangeModelPrerequisites(workId: string) {
        this.assertOpen();
        if ([...this.managedOperations.values()].some(operation => operation.workId === workId))
            return { stage: 'busy', roles: [] as readonly import('../workflow/types.js').Role[] };
        return this.changes.inspectModelPrerequisites(workId);
    }
    inspectChange(workId: string) {
        return this.changes.inspect(workId);
    }
    inspectChangeResult(workId: string) {
        this.assertOpen();
        return this.changes.inspectResult(workId);
    }
    driveChange(options: DriveChangeOptions) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.drive(options);
    }
    inspectChangeCriteriaRefresh(workId: string) {
        this.assertOpen();
        this.assertWorkTarget(workId);
        return this.changes.inspectCriteriaRefresh(workId);
    }
    refreshChangeCriteria(options: {
        workId: string;
        reason: string;
        expectedEpoch?: number;
        expectedFingerprint?: string;
    }, validate?: () => void) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.refreshCriteria(options, validate);
    }
    planChange(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.plan(options);
    }
    implementChange(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.implement(options);
    }
    repairChange(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.implement(options, true);
    }
    checkChange(options: {
        workId: string;
        signal?: AbortSignal;
    }) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.checks(options);
    }
    reviewChange(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.review(options);
    }
    resolveChange(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.resolve(options);
    }
    confirmNit(options: ChangeOperation) {
        this.assertManagedDispatch(options.workId);
        this.assertWorkTarget(options.workId);
        return this.changes.confirm(options);
    }
    extendResolutionAllowance(options: {
        workId: string;
        additional: number;
        reason: string;
    }) {
        return this.changes.extend(options.workId, options.additional, options.reason);
    }
    private protectionCore: ProjectProtection | undefined;
    private get protection() {
        return this.protectionCore ??= new ProjectProtection(this.store, () => this.assertOpen(), async (works) => {
            const handles = works.map(work => this.active.get(work)).filter((handle): handle is NonNullable<typeof handle> => !!handle);
            for (const handle of handles)
                handle.abort.abort();
            await Promise.all(handles.map(handle => handle.done));
        });
    }
    inspectProjectProtection(projectId: string) { return this.protection.inspect(projectId); }
    setProjectProtection(input: import('./protection-types.js').SetProjectProtection) { return this.protection.set(input); }
    async registerProject(options: {
        id: string;
        sourceRoot: string;
        captureProfile?: CaptureProfile;
    }): Promise<Project> {
        this.assertOpen();
        this.assertExecutionAdmission();
        id(options.id);
        const root = await fs.realpath(options.sourceRoot);
        if (!(await fs.stat(root)).isDirectory() || inside(root, this.options.installationHome) || inside(this.options.installationHome, root))
            throw new ControllerError('PROJECT_ROOT', 'Project and private installation roots must be disjoint', 'Select an explicit source directory outside controller state');
        this.assertOpen();
        this.assertStartupRootDisjoint(root);
        const old = this.store.one('SELECT * FROM projects WHERE id=?', options.id);
        if (old && old.root !== root)
            throw new ControllerError('PROJECT_REBIND', 'Project ID already names another root', 'Register a different explicit project ID');
        const profile = validateCaptureProfile(options.captureProfile ?? this.options.captureProfile ?? {});
        this.store.run('INSERT OR IGNORE INTO projects(id,root,profile) VALUES(?,?,?)', options.id, root, JSON.stringify(profile));
        return { id: options.id, sourceRoot: root, captureProfile: old ? parse(old.profile) : profile };
    }
    listProjects(): Project[] {
        this.assertOpen();
        return this.store.all('SELECT * FROM projects ORDER BY id').map(row => ({ id: row.id, sourceRoot: row.root, captureProfile: parse(row.profile) }));
    }
    inspectWork(workId: string): WorkView {
        this.assertOpen();
        const w = this.work(workId), source = this.store.one('SELECT * FROM sources WHERE id=?', w.source), requirement = this.store.one('SELECT * FROM requirements WHERE work=? ORDER BY version DESC LIMIT 1', workId);
        return { workId: w.id, projectId: w.project, state: w.state, epoch: w.epoch, lineageRoot: w.lineage, source: { ...source, origin: parse(source.origin) }, interpretation: parse(requirement.interpretation), allowance: this.store.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'execution'), obligations: this.store.all('SELECT data FROM obligations WHERE work=?', workId).map(r => parse(r.data)), runs: this.store.all('SELECT * FROM runs WHERE work=?', workId).map(r => ({ ...r, data: parse(r.data) })), currentResult: w.current_result ? parse(this.store.one('SELECT data FROM results WHERE id=?', w.current_result).data) : null };
    }
    private readLocalCheckEvidence(projectId: string, workId: string, resultId?: string): import('./local-evidence.js').LocalEvidenceSource {
        this.assertOpen();
        const w = this.work(workId), project = this.listProjects().find(p => p.id === projectId);
        if (!project || w.project !== projectId)
            throw new ControllerError('LOCAL_EVIDENCE_UNAVAILABLE', 'Original check and selected registered project differ', 'Select the original check project and work; do not substitute another result', workId);
        const selected = resultId ?? w.current_result;
        const resultRow = selected ? this.store.one('SELECT * FROM results WHERE id=?', selected) : null;
        const run = resultRow ? this.store.one('SELECT * FROM runs WHERE id=?', resultRow.run) : null, data = run ? parse(run.data) : null;
        const capacity = run && data?.capacityId ? this.store.one('SELECT * FROM capacity_leases WHERE id=? AND work=? AND run=?', data.capacityId, w.id, run.id) : null;
        const pending = !capacity || capacity.state !== 'RELEASED' || workFamilyUnsettled(this.store, w.lineage, id => this.active.has(id));
        return { project, work: this.inspectWork(workId), workGeneration: w.generation, pending, capacityReleased: !!capacity && capacity.state === 'RELEASED', resultRow: resultRow ? { ...resultRow, data: parse(resultRow.data) } : null, run: run ? { ...run, data } : null,
            observations: run ? this.store.all('SELECT id,data FROM observations WHERE run=? ORDER BY rowid', run.id).map(row => ({ ...row, data: parse(row.data) })) : [] };
    }
    inspectLocalCheckEvidence(options: {
        projectId: string;
        workId: string;
        gitBinary: string;
        signal?: AbortSignal;
    }) {
        this.assertOpen();
        const { projectId, workId, gitBinary } = options, signal = AbortSignal.any([this.contextAbort.signal, AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]);
        const read = () => this.readLocalCheckEvidence(projectId, workId);
        const task = (async () => {
            try {
                const { inspectLocalEvidence } = await import('./local-evidence.js');
                return await inspectLocalEvidence({ read, installationHome: this.options.installationHome, projectRoots: this.listProjects().map(p => p.sourceRoot), gitBinary, signal });
            }
            catch (error) {
                if (error instanceof ControllerError)
                    throw error;
                throw new ControllerError('LOCAL_EVIDENCE_UNAVAILABLE', 'Local evidence inspection failed or was interrupted', 'Inspect the original work and native Git prerequisites, keep source/configuration stable and retry; this refusal is not a successful check', workId);
            }
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    localCommitCandidate(options: {
        projectId: string;
        workId: string;
        gitBinary: string;
        messageFile: string;
        signal?: AbortSignal;
    }, assertCurrent?: () => void) {
        const { projectId, workId, gitBinary, messageFile } = options;
        return this.localCommitObservation(options.signal, async (signal) => {
            const { createLocalCandidate } = await import('./local-candidate.js');
            return createLocalCandidate({ controller: this, projectId, workId, gitBinary, messageFile, signal, ...assertCurrent ? { assertCurrent } : {}, read: () => { assertCurrent?.(); return this.readLocalCheckEvidence(projectId, workId); } });
        });
    }
    auditLocalCommit(options: {
        projectId: string;
        candidateId: string;
        commitRef: string;
        gitBinary: string;
        signal?: AbortSignal;
    }, assertCurrent?: () => void) {
        const { projectId, candidateId, commitRef, gitBinary } = options;
        return this.localCommitObservation(options.signal, async (signal) => {
            const { auditLocalCommit } = await import('./local-candidate.js');
            assertCurrent?.();
            const result = await auditLocalCommit({ controller: this, projectId, candidateId, commitRef, gitBinary, signal, read: (workId, resultId) => { assertCurrent?.(); return this.readLocalCheckEvidence(projectId, workId, resultId); } });
            assertCurrent?.();
            return result;
        });
    }
    private localCommitObservation<T>(caller: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
        this.assertOpen();
        const signal = AbortSignal.any([this.contextAbort.signal, AbortSignal.timeout(30000), ...(caller ? [caller] : [])]);
        const task = (async () => {
            try {
                return await operation(signal);
            }
            catch (error) {
                if (error instanceof ControllerError)
                    throw error;
                throw new ControllerError('LOCAL_CANDIDATE_UNAVAILABLE', 'Local candidate observation failed or was interrupted', 'Inspect the original candidate, check and trusted Git prerequisites. No commit, rollback or approval was performed.');
            }
        })();
        this.contextInputs.add(task);
        void task.then(() => this.contextInputs.delete(task), () => this.contextInputs.delete(task));
        return task;
    }
    private admit(projectId: string, kind: string, raw: string, checkpoint?: string, cwd: 'work' | 'scratch' = 'work', invocation?: Record<string, unknown>, modelBaseline?: WorkModelBaseline, investigation?: {
        assertCurrent(): void;
        mode: Record<string, unknown>;
        identity: ReturnType<typeof modelConfigurationIdentity>;
    }, initialize?: (workId: string) => void, admissionGuard?: () => void) {
        const applicationModelBaseline = modelBaseline === undefined ? undefined : captureWorkModelBaseline(modelBaseline);
        this.assertOpen();
        this.assertExecutionAdmission();
        if (checkpoint)
            this.assertWorkTarget(checkpoint);
        const ownerEntry = invocation?.kind === 'owner-conversation-change';
        if (ownerEntry) {
            const cid = String(invocation!.conversationId), operation = this.managedOperations.get(cid);
            if (!operation || operation.token !== invocation!.ownerToken)
                throw Error('Original managed owner operation is unavailable');
            this.assertTarget(cid, false, undefined, operation.token);
        }
        else if (invocation) {
            if (invocation.conversationId)
                this.assertTarget(String(invocation.conversationId));
            const sourceActor = invocation.actor as import('./interaction-types.js').NativeIdentity | undefined;
            if (sourceActor)
                this.assertTarget(sourceActor.conversationId);
            if (this.interactionQuiesced)
                throw new Error('Interaction admission quiesced');
            const assignment = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', String(invocation.assignmentId));
            if (!assignment || assignment.state === 'CANCELLED')
                throw new Error('Assigned task cancelled before work admission');
            const actor = invocation.actor as import('./interaction-types.js').NativeIdentity;
            const parent = this.work(actor.workId);
            if (parent.state === 'CANCELLED' || parent.epoch !== this.store.one('SELECT epoch FROM runs WHERE id=?', actor.runId)?.epoch)
                throw new Error('Original assignment authority cancelled');
        }
        const project = this.store.one('SELECT * FROM projects WHERE id=?', projectId);
        if (!project)
            throw new ControllerError('MISSING_PROJECT', 'Explicit project is not registered', 'Register the project ID first');
        validateCaptureProfile(parse(project.profile));
        if (!this.options.runtimeProfile && kind !== 'governed-change')
            throw new ControllerError('MISSING_RUNTIME', 'Execution requires an explicit runtime profile', 'Supply absolute Docker client, context and immutable image');
        return this.store.tx(() => {
            admissionGuard?.();
            investigation?.assertCurrent();
            if (ownerEntry) {
                const cid = String(invocation!.conversationId), view = this.interactions.inspect(cid), choice = this.getConversationModelChoice(cid), route = ownerChangeRoute(this.store, cid, projectId);
                if (view.generation !== invocation!.expectedGeneration || view.projectId !== projectId || choice.revision !== invocation!.expectedModelRevision || hash(route.snapshot) !== invocation!.routeFingerprint || route.workId)
                    throw Error('Managed owner target or original continuation changed before admission');
                this.assertOwnerChangeIdle(cid);
            }
            if (invocation?.assignmentId) {
                validateContextAssignmentLaunch(this.store, String(invocation.assignmentId), 'fresh-begin');
                const assignment = this.store.one('SELECT target,data FROM conversation_assignments WHERE id=?', String(invocation.assignmentId));
                if (!assignment || invocation.conversationId !== assignment.target || projectId !== parse(assignment.data).projectId)
                    throw new Error('Assigned task invocation differs from retained target or project');
            }
            if (applicationModelBaseline?.source.kind === 'conversation') {
                const source = applicationModelBaseline.source, view = this.interactions.inspect(source.conversationId), choice = this.getConversationModelChoice(source.conversationId);
                this.assertTarget(source.conversationId, false, undefined, ownerEntry ? invocation!.ownerToken as symbol : undefined);
                if (view.projectId !== projectId || choice.revision !== source.choiceRevision || choice.kind !== 'managed' ||
                    choice.provider !== applicationModelBaseline.choice.provider || choice.modelId !== applicationModelBaseline.choice.modelId || choice.thinkingLevel !== applicationModelBaseline.choice.thinkingLevel)
                    throw Error('APPLICATION_MODEL_UNAVAILABLE: baseline conversation choice changed');
            }
            if (checkpoint && applicationModelBaseline)
                throw Error('APPLICATION_MODEL_UNAVAILABLE: continuation cannot replace its retained baseline');
            let w;
            const sourceId = randomUUID(), runId = randomUUID();
            let conversation: string | null = null;
            let previousHistory: string | undefined, previousSessionId: string | undefined;
            if (checkpoint) {
                w = this.work(checkpoint);
                for (const prior of this.store.all('SELECT data FROM runs WHERE work=? ORDER BY rowid DESC', w.id)) {
                    const data = parse(prior.data);
                    if (data.attainedNative) {
                        previousHistory = data.historyRef;
                        previousSessionId = data.nativeSessionId;
                        break;
                    }
                }
                if (parse(w.data).kind !== kind)
                    throw new ControllerError('RESUME_KIND', 'Checkpoint operation kind differs', 'Use the original kind or start independent new work', w.id);
                if (w.project !== projectId)
                    throw new ControllerError('CONTINUATION_PROJECT', 'Continuation names another project', 'Use its registered project ID', w.id);
                if (this.active.has(w.id))
                    throw new ControllerError('WORK_BUSY', 'Work already has an active attempt', 'Wait for settlement or cancel that work', w.id);
                if (['UNKNOWN', 'QUARANTINED'].includes(w.state))
                    throw new ControllerError('CLEANUP_UNKNOWN', 'Old producer cleanup is unresolved', 'Reconcile its exact retained producer before resume', w.id);
                this.store.run('UPDATE works SET state=?,epoch=epoch+1,generation=generation+1 WHERE id=?', 'ACTIVE', w.id);
                w = this.work(w.id);
                conversation = parse(w.data).conversation ?? null;
                this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, conversation, JSON.stringify({ kind: 'owner-host-continuation', uid: process.getuid?.(), pid: process.pid, event: randomUUID(), predecessor: w.id }), raw);
                const version = this.store.one('SELECT MAX(version) AS v FROM requirements WHERE work=?', w.id).v + 1;
                this.store.run('INSERT INTO requirements VALUES(?,?,?,?)', w.id, version, raw, JSON.stringify({ status: kind === 'investigation' ? 'unconfirmed' : 'not-applicable-local-command', sourceEvent: sourceId, english: kind === 'investigation' ? 'Read-only continuation; consequential implementation remains unavailable.' : null }));
                this.store.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...parse(w.data), latestRaw: raw, cwd }), w.id);
            }
            else {
                const workId = randomUUID();
                if (kind === 'investigation') {
                    conversation = randomUUID();
                    this.store.run('INSERT INTO conversations VALUES(?,?,NULL,1,?)', conversation, projectId, 'CREATED');
                    this.interactions.inspect(conversation);
                }
                if (ownerEntry)
                    conversation = String(invocation!.conversationId);
                this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, conversation, JSON.stringify(invocation ?? { kind: 'owner-host-invocation', uid: process.getuid?.(), pid: process.pid, event: randomUUID() }), raw);
                const context = ownerEntry ? admitOwnerChange(this.store, String(invocation!.conversationId), workId, {
                    projectIds: [...(this.options.interactionDelegation?.projectIds ?? [projectId])], maxAssignments: this.options.interactionDelegation?.maxAssignments ?? 8, rootWorkId: workId,
                }) : undefined;
                const metadata = context?.metadata ?? (kind === 'governed-change' && typeof invocation?.conversationId === 'string' ? contextWorkMetadata(this.store, invocation.conversationId) : {});
                const data = { kind, raw, conversation: invocation?.conversationId ?? conversation, cwd, invocation,
                    ...(applicationModelBaseline ? { applicationModelBaseline } : {}),
                    ...(kind === 'governed-change' && (!invocation || ownerEntry) && !Object.hasOwn(metadata, 'contextContinuation') ? { ownerRootActivation: pendingOwnerRoot(this.effects.ownerRootProfile()) } : {}),
                    ...metadata, ...(context ? { delegation: context.delegation } : {}) };
                this.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', workId, projectId, sourceId, context?.predecessor ?? null, context?.lineage ?? workId, 'ACTIVE', 1, 1, null, JSON.stringify(data));
                w = this.work(workId);
                if (invocation?.assignmentId)
                    this.store.run('UPDATE conversation_assignments SET work=?,state=? WHERE id=?', w.id, 'RUNNING', String(invocation.assignmentId));
                if (context?.initializeBudgets !== false)
                    for (const budgetKind of ['execution', 'resolution'])
                        this.store.run('INSERT INTO budgets VALUES(?,?,?,0,0)', w.lineage, budgetKind, initialWorkAllowance);
                if (ownerEntry) {
                    const cid = String(invocation!.conversationId);
                    this.store.run('UPDATE conversation_state SET work=? WHERE conversation=?', w.id, cid);
                    this.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?', cid);
                    this.managedOperations.get(cid)!.workId = w.id;
                }
                this.store.run('INSERT INTO requirements VALUES(?,?,?,?)', w.id, 1, raw, JSON.stringify(kind === 'investigation' ? { status: 'unconfirmed', english: 'Read-only investigation of the selected project according to the retained owner request; no implementation/publication authorized.' } : { status: 'not-applicable-local-command' }));
            }
            const budget = this.store.one('SELECT * FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'execution');
            if (budget.consumed + budget.reserved >= budget.lim)
                throw new ControllerError('BUDGET_EXHAUSTED', 'Retained execution allowance exhausted', 'Record an authorized bounded extension; renaming work does not reset it', w.id);
            this.store.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', w.lineage, 'execution');
            const runtimeProfile = this.options.runtimeProfile ? Object.freeze({ ...this.options.runtimeProfile }) : undefined;
            const staging = path.join(this.options.installationHome, 'inputs', runId);
            this.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, w.id, w.epoch, w.generation, 'CREATED', staging, 'reserved', JSON.stringify({ kind, raw, conversation, cwd, projectProtection: projectProtection(this.store, projectId), profile: runtimeProfile, createdAt: Date.now(), controllerPid: process.pid,
                ...(investigation ? { modelMode: investigation.mode, modelIdentity: investigation.identity } : {}) }));
            initialize?.(w.id);
            return { w, runId, staging, project, conversation, previousHistory, previousSessionId, runtimeProfile };
        });
    }
    private valid(runId: string) {
        const run = this.store.one('SELECT * FROM runs WHERE id=?', runId), w = this.work(run.work);
        return w.state === 'ACTIVE' && w.epoch === run.epoch && w.generation === run.generation;
    }
    private entry(runId: string) {
        this.assertExecutionAdmission();
        const producer = this.store.one('SELECT work,data FROM runs WHERE id=?', runId);
        if (producer) {
            this.assertWorkTarget(producer.work);
            const cid = parse(producer.data).conversation;
            if (cid)
                this.assertTarget(cid, false, producer.work);
            for (const allocation of this.store.all("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", runId))
                this.assertTarget(allocation.conversation, false, producer.work);
        }
        assertRunProtection(this.store, runId);
        if (!this.valid(runId))
            throw new ControllerError('STALE_EXECUTION', 'Run no longer has execution standing', 'Inspect/correct cancellation or resume checkpoint', this.store.one('SELECT work FROM runs WHERE id=?', runId).work, runId);
    }
    private patchRun(runId: string, phase: string, patch: Record<string, unknown>) {
        const row = this.store.one('SELECT data FROM runs WHERE id=?', runId);
        this.store.run('UPDATE runs SET phase=?,data=? WHERE id=?', phase, JSON.stringify({ ...parse(row.data), ...patch }), runId);
    }
    private settleBudget(runId: string) {
        const run = this.store.one('SELECT * FROM runs WHERE id=?', runId);
        if (run.reservation === 'reserved') {
            const w = this.work(run.work);
            this.store.run('UPDATE runs SET reservation=? WHERE id=? AND reservation=?', 'consumed', runId, 'reserved');
            this.store.run('UPDATE budgets SET reserved=reserved-1,consumed=consumed+1 WHERE lineage=? AND kind=?', w.lineage, 'execution');
        }
    }
    runLocalCheck(options: LocalCheckOptions): Promise<ObservationResult> { return this.runLocalCheckGuarded(options); }
    private async runLocalCheckGuarded(options: LocalCheckOptions, admissionGuard?: () => void): Promise<ObservationResult> {
        if (['model', 'applicationModel', 'applicationModelBaseline', 'sessionPreferences'].some(key => Object.hasOwn(options, key)))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: local command observation has no model operand');
        options = { ...options };
        admissionGuard?.();
        if (options.continuationCheckpoint)
            await this.validatePredecessor(options.continuationCheckpoint);
        admissionGuard?.();
        const admission = this.admit(options.projectId, 'command-observation', options.command, options.continuationCheckpoint, options.cwd ?? 'work', undefined, undefined, undefined, undefined, admissionGuard);
        try {
            return await this.perform(admission, options);
        }
        catch (error) {
            if (!admissionGuard)
                throw error;
            const failure = new ControllerError('LOCAL_CHECK_UNAVAILABLE', 'Original local check did not return a settled outcome', 'Inspect the retained work/run and original recovery; do not create replacement work to hide it.', admission.w.id, admission.runId);
            Object.assign(failure, { cause: error });
            throw failure;
        }
    }
    async startConversation(options: ConversationOptions): Promise<ObservationResult> {
        this.assertOpen();
        this.assertExecutionAdmission();
        const projectId = options.projectId, message = options.message, checkpoint = options.continuationCheckpoint;
        const signal = options.signal ? AbortSignal.any([options.signal, this.contextAbort.signal]) : this.contextAbort.signal;
        const fail = (reason: string): never => { throw Error('APPLICATION_MODEL_UNAVAILABLE: ' + reason); };
        const hasModel = Object.hasOwn(options, 'model'), hasNew = Object.hasOwn(options, 'applicationModelBaseline'), hasRetained = Object.hasOwn(options, 'applicationModel');
        if ([hasModel, hasNew, hasRetained].filter(Boolean).length !== 1)
            fail('choose exactly one investigation model operand');
        if (typeof message !== 'string' || !message.trim())
            fail('investigation message required');
        if (hasNew && checkpoint || hasRetained && !checkpoint)
            fail('new baseline and retained checkpoint modes differ');
        if (hasModel && Object.hasOwn(options, 'sessionPreferences'))
            fail('explicit recipe owns its queue preferences');
        let model = hasModel ? options.model && captureNativeModelSelection(options.model) : undefined;
        if (hasModel && !model)
            fail('explicit investigation recipe required');
        const preferences = hasModel ? undefined : captureSessionPreferences(options.sessionPreferences);
        const originalWork = checkpoint ? this.work(checkpoint) : undefined;
        if (originalWork) {
            this.assertWorkTarget(originalWork.id);
            if (parse(originalWork.data).kind !== 'investigation' || originalWork.project !== projectId)
                fail('checkpoint kind or project differs');
        }
        const retainedBaseline = checkpoint ? this.getWorkApplicationModelBaseline(checkpoint) : undefined;
        if (!!retainedBaseline !== hasRetained && checkpoint)
            fail('retained work requires its original model mode');
        const baseline = hasNew ? captureWorkModelBaseline(options.applicationModelBaseline) : retainedBaseline;
        const tag = hasRetained ? captureApplicationModelOperation(options.applicationModel) : undefined;
        if (hasRetained && (!baseline || tag!.baselineRevision !== baseline.revision))
            fail('retained baseline revision differs');
        const resolver = this.applicationModelResolver?.resolveBaseline;
        if (baseline && !resolver)
            fail('baseline resolver is not installed');
        const projectToken = () => JSON.stringify([this.store.one('SELECT * FROM projects WHERE id=?', projectId), projectProtection(this.store, projectId), this.options.runtimeProfile]);
        const projectBefore = projectToken(), workBefore = originalWork ? JSON.stringify(originalWork) : undefined;
        // Recovery may annotate old runs; the actual work and owner intent must remain unchanged.
        const assertIntent = () => {
            this.assertOpen();
            this.assertExecutionAdmission();
            signal.throwIfAborted();
            if (projectToken() !== projectBefore)
                fail('project or runtime changed during investigation preparation');
            if (checkpoint) {
                this.assertWorkTarget(checkpoint);
                if (JSON.stringify(this.work(checkpoint)) !== workBefore)
                    fail('retained investigation changed during preparation');
            }
        };
        assertIntent();
        const preparation = (async () => {
            if (checkpoint) {
                await this.validatePredecessor(checkpoint);
                assertIntent();
            }
            const historyToken = () => checkpoint ? JSON.stringify([
                this.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', checkpoint),
                this.store.one('SELECT * FROM conversations WHERE id=?', parse(this.work(checkpoint).data).conversation),
                this.store.one('SELECT * FROM sources WHERE id=?', this.work(checkpoint).source),
            ]) : undefined;
            const recoveredHistory = historyToken();
            const assertCurrent = () => {
                assertIntent();
                if (historyToken() !== recoveredHistory)
                    fail('retained history changed during model resolution');
                if (baseline && model)
                    this.assertApplicationModelSource(model, baseline.choice);
            };
            if (baseline) {
                model = captureNativeModelSelection(await resolver!({ baseline: structuredClone(baseline), ...(preferences ? { sessionPreferences: preferences } : {}),
                    ...(checkpoint ? { kind: 'retained', workId: checkpoint, epoch: originalWork!.epoch, generation: originalWork!.generation } : { kind: 'new', projectId }) }));
                assertCurrent();
                this.assertApplicationModelSource(model, baseline.choice);
            }
            assertCurrent();
            const executionOptions: InvestigationExecutionOptions = { projectId, message, model: model!, signal, ...(checkpoint ? { continuationCheckpoint: checkpoint } : {}) };
            const admission = this.admit(projectId, 'investigation', message, checkpoint, 'work', undefined, hasNew ? baseline : undefined, { assertCurrent, mode: baseline ? { kind: 'application', version: 1, baselineRevision: baseline.revision } : { kind: 'explicit' }, identity: modelConfigurationIdentity(model!) });
            // Synchronous handoff: close sees either preparation or the registered original active handle.
            return { execution: this.perform(admission, executionOptions) };
        })();
        this.contextInputs.add(preparation);
        void preparation.then(() => this.contextInputs.delete(preparation), () => this.contextInputs.delete(preparation));
        return (await preparation).execution;
    }
    private perform(admission: ReturnType<Controller['admit']>, options: LocalCheckOptions | InvestigationExecutionOptions): Promise<ObservationResult> {
        const handle: Active = { abort: new AbortController() };
        this.active.set(admission.w.id, handle);
        const operation = this.executeAttempt(admission, options, handle);
        handle.done = operation;
        return operation;
    }
    private async executeAttempt(a: ReturnType<Controller['admit']>, options: LocalCheckOptions | InvestigationExecutionOptions, handle: Active): Promise<ObservationResult> {
        const { w, runId, staging, project } = a;
        const externalAbort = () => {
            void this.cancelWork({ workId: w.id }).catch(() => {
            });
        };
        options.signal?.addEventListener('abort', externalAbort, { once: true });
        if (options.signal?.aborted)
            externalAbort();
        let lease: import('./interaction-types.js').CapacityLease | undefined;
        let manifest: Manifest | null = null, cleanup = 'not-allocated', scope: ContainerScope | undefined;
        let result: ObservationResult = { workId: w.id, runId, kind: 'command' in options ? 'command-observation' : 'investigation', status: 'unavailable', exitCode: null, captureRef: null, actualCwd: ('cwd' in options && options.cwd === 'scratch') ? '/scratch' : '/work', scratchInput: 'mutable-or-unknown', cleanup, limitations: ['No candidate verification, independent review or merge eligibility.', 'Captured modes are normalized to private owner access with file executable bits preserved; mode-sensitive original-environment guarantees are not certified.'], stdout: '', stderr: '' };
        try {
            if (this.interactionQuiesced)
                throw new Error('Interaction admission quiesced');
            lease = await this.capacity.acquire({ workId: w.id, runId, epoch: w.epoch, kind: 'local-check', signal: handle.abort.signal });
            this.entry(runId);
            await privateDirectory(staging);
            this.patchRun(runId, 'CAPTURING', { workerId: runId });
            const job = capture(project.root, staging, parse(project.profile), handle.abort.signal);
            handle.workerStop = job.stop;
            manifest = await job.result;
            delete handle.workerStop;
            this.entry(runId);
            this.patchRun(runId, 'CAPTURED', { manifest, attainedCapture: true, captureCompletedAt: Date.now() });
            result.captureRef = manifest.digest;
            const runtime = a.runtimeProfile!, protectedPaths = await scopeProtection(this.store, runId, staging);
            this.patchRun(runId, 'RUNTIME_CREATING', {});
            scope = await createScope({ ...runtime, workRoot: staging, stateRoot: path.join(this.state, 'runtime'), workId: w.id, runId, protectedPaths, readOnlyWork: true, signal: handle.abort.signal });
            handle.scope = scope;
            this.patchRun(runId, 'RUNNING', { containerId: scope.containerId });
            this.entry(runId);
            if ('command' in options) {
                const began = performance.now();
                const observed = await scope.execute(options.command, { cwd: options.cwd === 'scratch' ? '/scratch' : '/work', signal: handle.abort.signal });
                this.store.run('INSERT INTO observations VALUES(?,?,?)', randomUUID(), runId, JSON.stringify({ kind: 'owner-command', command: options.command, cwd: result.actualCwd, input: manifest.digest, scratchInput: 'mutable-or-unknown', durationMs: performance.now() - began, ...observed }));
                result = { ...result, ...observed, status: observed.exitCode === 0 ? 'succeeded' : 'failed' };
            }
            else {
                const { runConversation } = await import('./conversation.js');
                const response = await runConversation({ controller: this, runId, workId: w.id, scope, model: options.model, message: options.message, stateRoot: this.state, artifactRoot: path.join(this.options.installationHome, 'artifacts'), signal: handle.abort.signal, ...(a.previousHistory ? { historyRef: a.previousHistory } : {}), ...(a.previousSessionId ? { sessionId: a.previousSessionId } : {}) });
                result = { ...result, status: 'delivered', exitCode: null, stdout: response.text, historyRef: response.historyRef, limitations: [...result.limitations, ...response.limitations] };
                this.patchRun(runId, 'RUNNING', { historyRef: response.historyRef });
                if (a.conversation)
                    this.store.run('UPDATE conversations SET history=?,generation=?,state=? WHERE id=?', response.historyRef, w.generation, 'SETTLED', a.conversation);
            }
        }
        catch (error) {
            result.stderr = String(error);
            result.status = handle.abort.signal.aborted ? 'cancelled' : 'unavailable';
            if (String(error).includes('UNKNOWN_CAPTURE'))
                cleanup = 'quarantined-capture';
        }
        finally {
            if (scope) {
                try {
                    const receipt = await scope.close();
                    cleanup = receipt.state;
                }
                catch (error) {
                    cleanup = 'quarantined-cleanup';
                    result.stderr += '\n' + String(error);
                }
            }
            else if (this.store.one('SELECT phase FROM runs WHERE id=?', runId).phase === 'RUNTIME_CREATING') {
                try {
                    cleanup = await this.reconcileRun(runId, w.id);
                }
                catch (error) {
                    cleanup = 'quarantined-reconciliation';
                    result.stderr += '\n' + String(error);
                }
            }
            result.cleanup = cleanup;
            if (cleanup.startsWith('quarantined') && !handle.abort.signal.aborted)
                result.status = 'unavailable';
            if (handle.abort.signal.aborted)
                result.status = 'cancelled';
            options.signal?.removeEventListener('abort', externalAbort);
        }
        this.store.tx(() => {
            if (this.work(w.id).state === 'CANCELLED')
                result.status = 'cancelled';
            this.settleBudget(runId);
            const resultId = randomUUID();
            this.store.run('INSERT INTO results VALUES(?,?,?,?)', resultId, w.id, runId, JSON.stringify(result));
            this.patchRun(runId, cleanup.startsWith('quarantined') ? 'UNKNOWN' : 'SETTLED', { resultId, cleanup, settledAt: Date.now() });
            if (this.valid(runId) && !cleanup.startsWith('quarantined'))
                this.store.run('UPDATE works SET state=?,current_result=? WHERE id=?', result.status === 'delivered' || result.status === 'succeeded' ? 'DELIVERED' : 'BLOCKED', resultId, w.id);
            else if (cleanup.startsWith('quarantined'))
                this.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', w.id);
        });
        lease?.release({ cleanup, settled: true });
        this.active.delete(w.id);
        if (!manifest && !cleanup.startsWith('quarantined'))
            await fs.rm(staging, { recursive: true, force: true });
        return result;
    }
    /** Trusted observer used by the lazy adapter; no worker-supplied work identity. */
    recordHistory(runId: string, historyRef: string, nativeSessionId: string) {
        this.patchRun(runId, 'RUNNING', { historyRef, nativeSessionId, allocatedNative: true });
    }
    recordNativeCheckpoint(runId: string, checkpoint: {
        sessionId: string;
        leafId: string;
        bytes: number;
        sha256: string;
    }) {
        this.patchRun(runId, 'RUNNING', { nativeCheckpoint: checkpoint, attainedNative: true });
    }
    recordModelDispatch(runId: string, checkpoint: {
        sessionId: string;
        leafId: string;
        bytes: number;
        sha256: string;
    }) {
        this.store.tx(() => {
            this.entry(runId);
            this.patchRun(runId, 'RUNNING', { nativeCheckpoint: checkpoint, attainedNative: true, modelDispatchAttempted: true });
        });
    }
    recordNativePromptAttempt(runId: string) {
        this.patchRun(runId, 'RUNNING', { nativePromptAttempted: true });
    }
    recordNativeInput(runId: string) {
        this.patchRun(runId, 'RUNNING', { nativeInputObserved: true });
    }
    observeOperation(runId: string, record: Record<string, unknown>) {
        this.store.run('INSERT INTO observations VALUES(?,?,?)', randomUUID(), runId, JSON.stringify(record));
    }
    assertRunEntry(runId: string) {
        this.entry(runId);
    }
    async cancelWork(options: {
        workId: string;
        expectedEpoch?: number;
    }) {
        this.assertOpen();
        if (this.managementOnly) {
            const work = this.work(options.workId), source = this.store.one('SELECT origin FROM sources WHERE id=?', work.source);
            if (parse(work.data).kind !== 'repository-configuration' || !source || parse(source.origin).kind !== 'owner-repository-configuration')
                this.assertExecutionAdmission();
            this.assertNoApplicationMutation();
        }
        else
            this.assertExecutionAdmission();
        await this.cancelHandle({ ...options, explicitOwnerRequest: true });
        return this.inspectWork(options.workId);
    }
    private async cancelHandle(options: {
        workId: string;
        expectedEpoch?: number;
        explicitOwnerRequest?: true;
    }) {
        const w = this.work(options.workId);
        if (options.expectedEpoch !== undefined && options.expectedEpoch !== w.epoch)
            throw new ControllerError('EPOCH_CONFLICT', 'Work epoch changed', 'Inspect current work epoch', w.id);
        await this.cancelProvenance({ workId: w.id, reason: 'Owner cancelled retained work', ...(options.explicitOwnerRequest ? { explicitOwnerWork: true as const } : {}) });
    }
    inspectQueuedAssignmentCancellation(input: QueuedAssignmentCancellationInput) {
        this.assertOpen();
        const view = inspectQueuedAssignmentCancellation(this.store, input), target = view.targetConversationId;
        if ([...this.assignmentPreparations].some(preparation => preparation.conversationId === target) || this.managedOperations.has(target) || this.lifecycleBusy.has(target) || this.ordinaryCore?.isBusy(target) ||
            this.interactions.getHandle(target) || this.contextInputs.size)
            throw Error('Queued assignment preparation or execution is active; wait for original settlement');
        return view;
    }
    cancelQueuedAssignment(input: QueuedAssignmentCancellationInput & {
        expectedFingerprint: string;
        reason: string;
        validate?: () => void;
    }) {
        this.assertOpen();
        if (input.validate && input.validate() !== undefined) throw Error('Synchronous queued assignment cancellation validation required');
        const current = this.inspectQueuedAssignmentCancellation(input);
        if (current.fingerprint !== input.expectedFingerprint)
            throw Error('Queued assignment cancellation review changed; inspect and review the original again');
        // No awaited gap: original cancellation enters its transaction synchronously.
        return this.cancelAssignment({ assignmentId: current.assignmentId, reason: input.reason });
    }
    async cancelAssignment(options: {
        assignmentId: string;
        reason: string;
    }) {
        this.assertOpen();
        return this.cancelProvenance(options);
    }
    private async cancelProvenance(options: {
        workId?: string;
        assignmentId?: string;
        reason: string;
        actor?: import('./interaction-types.js').NativeIdentity;
        explicitOwnerWork?: true;
    }) {
        if (!options.reason.trim() || Buffer.byteLength(options.reason) > 128 * 1024)
            throw new Error('Cancellation requires a retained bounded reason');
        const works = new Set<string>(), assignments = new Set<string>();
        this.store.tx(() => {
            if (options.workId) {
                works.add(options.workId);
                if (options.explicitOwnerWork)
                    for (const id of inspectAssignedWorkObligations(this.store, options.workId)) assignments.add(id);
            }
            if (options.assignmentId) {
                const root = this.store.one('SELECT * FROM conversation_assignments WHERE id=?', options.assignmentId);
                if (!root)
                    throw new Error('Unknown assignment');
                assignments.add(root.id);
                if (root.work)
                    works.add(root.work);
            }
            let changed = true;
            while (changed) {
                changed = false;
                for (const row of this.store.all('SELECT * FROM conversation_assignments')) {
                    if (!works.has(parse(row.data).source?.workId) || assignments.has(row.id))
                        continue;
                    assignments.add(row.id);
                    if (row.work)
                        works.add(row.work);
                    changed = true;
                }
            }
            const aliases = inspectEffectAssignmentObligations(this.store, works);
            for (const alias of aliases) assignments.add(alias.assignmentId);
            const source = randomUUID();
            const requested = options.explicitOwnerWork && options.workId ? this.work(options.workId) : null;
            for (const assignmentId of assignments) {
                const row = this.store.one('SELECT state,data FROM conversation_assignments WHERE id=?', assignmentId), data = parse(row.data);
                this.store.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'CANCELLED', JSON.stringify({ ...data, ...(row.state === 'COMPLETE' ? { cancellationPreviousState: 'COMPLETE' } : {}), cancellationSource: source }), assignmentId);
                this.store.run('UPDATE conversation_dependencies SET state=? WHERE assignment=?', 'CANCELLED', assignmentId);
                this.store.run("UPDATE conversation_inputs SET state='CANCELLED' WHERE json_extract(data,'$.assignment')=? AND state NOT IN ('CONSUMED','CONFLICTED')", assignmentId);
            }
            for (const alias of aliases)
                this.store.run('UPDATE conversation_state SET resource=? WHERE conversation=? AND work=?', alias.resource, alias.conversationId, alias.workId);
            for (const work of works)
                this.store.run("UPDATE works SET state=CASE WHEN state='UNKNOWN' THEN 'UNKNOWN' ELSE 'CANCELLED' END,epoch=epoch+1 WHERE id=? AND state!='CANCELLED'", work);
            const after = requested ? this.work(requested.id) : null;
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', source, null, JSON.stringify(options.actor ? { kind: 'agent-assignment-cancel', actor: options.actor } : { kind: 'owner-task-cancel', uid: process.getuid?.(), event: randomUUID(), ...(requested ? { requestedWork: { version: 1, id: requested.id, sourceId: requested.source, fromEpoch: requested.epoch, toEpoch: after!.epoch, fromState: requested.state, toState: after!.state } } : {}) }), options.reason);
        });
        for (const operation of this.managedOperations.values())
            if (operation.workId && works.has(operation.workId))
                operation.abort.abort();
        this.effects.cancel(works);
        for (const work of works) {
            const handle = this.active.get(work);
            handle?.abort.abort();
            if (handle?.scope)
                await handle.scope.close();
            if (handle?.workerStop)
                await handle.workerStop();
        }
        return { assignmentId: options.assignmentId ?? null, workIds: [...works], assignmentIds: [...assignments], state: 'CANCELLED', settlement: 'Actual admitted producer cleanup remains separately observed' };
    }
    extendExecutionAllowance(options: {
        workId: string;
        additional: number;
        reason: string;
    }, validate?: () => void) {
        this.assertOpen();
        if (!Number.isSafeInteger(options.additional) || options.additional < 1 || options.additional > 100 || !options.reason.trim())
            throw new ControllerError('INVALID_EXTENSION', 'Extension needs1..100 units and retained owner reason', 'Provide a finite explicit owner extension', options.workId);
        return this.store.tx(() => {
            validate?.();
            const w = this.work(options.workId), sourceId = randomUUID();
            const budget = this.store.one('SELECT lim FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'execution');
            if (!budget || !Number.isSafeInteger(budget.lim + options.additional))
                throw Error('Execution allowance extension exceeds safe finite limit');
            this.store.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'owner-budget-extension', uid: process.getuid?.(), pid: process.pid, workId: w.id, lineage: w.lineage, additional: options.additional }), options.reason);
            this.store.run('UPDATE budgets SET lim=lim+? WHERE lineage=? AND kind=?', options.additional, w.lineage, 'execution');
            return this.inspectWork(w.id);
        });
    }
    async resumeWork(options: {
        workId: string;
        command?: string;
        message?: string;
        model?: ConversationOptions['model'];
        applicationModel?: import('./application-model.js').ApplicationModelOperation;
        sessionPreferences?: import('../pi/session-preferences.js').SessionQueuePreferences;
        signal?: AbortSignal;
    }) {
        const w = this.work(options.workId), data = parse(w.data);
        this.assertWorkTarget(w.id);
        if (data.kind === 'command-observation' && ['message', 'model', 'applicationModel', 'sessionPreferences', 'applicationModelBaseline'].some(key => Object.hasOwn(options, key)))
            throw new ControllerError('RESUME_KIND', 'Local command work cannot accept message/model overrides', 'Resume with command only, or start a new conversation', w.id);
        if (data.kind === 'investigation' && options.command !== undefined)
            throw new ControllerError('RESUME_KIND', 'Investigation cannot accept command override', 'Resume with message/model, or run a separate local check', w.id);
        const common = { projectId: w.project, continuationCheckpoint: w.id, ...(options.signal ? { signal: options.signal } : {}) };
        if (data.kind === 'command-observation')
            return this.runLocalCheck({ ...common, command: options.command ?? data.latestRaw ?? data.raw, cwd: data.cwd ?? 'work' });
        const request = { ...(Object.hasOwn(options, 'applicationModel') ? { applicationModel: options.applicationModel } : {}),
            ...(Object.hasOwn(options, 'sessionPreferences') ? { sessionPreferences: options.sessionPreferences } : {}),
            ...(Object.hasOwn(options, 'model') ? { model: options.model } : {}) };
        if (Object.hasOwn(options, 'applicationModelBaseline'))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: resume cannot replace its baseline');
        return this.startConversation({ ...common, message: options.message ?? data.latestRaw ?? data.raw, ...request } as ConversationOptions);
    }
    private async validatePredecessor(workId: string) {
        const w = this.work(workId);
        if (this.active.has(workId))
            throw new ControllerError('WORK_BUSY', 'Work is active', 'Wait or cancel', workId);
        const recoveries: (() => void)[] = [];
        for (const previous of this.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC', workId)) {
            const data = parse(previous.data);
            if (data.attainedCapture && (!data.manifest || !data.manifest.digest))
                throw new ControllerError('MISSING_MANIFEST', 'Required capture manifest omitted', 'Restore exact retained capture checkpoint', workId, previous.id);
            if (data.nativeInputObserved && !data.attainedNative && !data.modelDispatchAttempted) {
                const { nativeCheckpoint } = await import('./history.js');
                try {
                    await privateFile(data.historyRef);
                    const checkpoint = await nativeCheckpoint(data.historyRef, undefined, { sessionId: data.nativeSessionId, ownerInput: data.raw });
                    recoveries.push(() => this.patchRun(previous.id, previous.phase, { nativeCheckpoint: checkpoint, attainedNative: true, nativeRecovery: { kind: 'observed-partial-history', at: Date.now() } }));
                    Object.assign(data, { nativeCheckpoint: checkpoint, attainedNative: true });
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                        recoveries.push(() => this.patchRun(previous.id, previous.phase, { nativeRecovery: { kind: 'no-persisted-history-before-dispatch', at: Date.now() } }));
                        continue;
                    }
                    throw new ControllerError('MISSING_HISTORY', 'Partial native history cannot be safely recovered', 'Restore its exact owned session/input checkpoint', workId, previous.id);
                }
            }
            if (data.attainedNative || data.modelDispatchAttempted) {
                if (!data.historyRef || !data.nativeSessionId)
                    throw new ControllerError('MISSING_HISTORY', 'Required native history reference/identity omitted', 'Restore exact retained native checkpoint', workId, previous.id);
                await privateFile(data.historyRef);
                try {
                    if (!data.nativeCheckpoint)
                        throw new Error('required checkpoint omitted');
                    const { nativeCheckpoint } = await import('./history.js');
                    await nativeCheckpoint(data.historyRef, data.nativeCheckpoint);
                }
                catch {
                    throw new ControllerError('MISSING_HISTORY', 'Required native history is absent/invalid', 'Restore exact retained native history; no silent initialization', workId, previous.id);
                }
            }
        }
        if (w.state === 'UNKNOWN')
            throw new ControllerError('CLEANUP_UNKNOWN', 'Retained cleanup is unavailable', 'Repair runtime access then reopen to reconcile exact journal', workId);
        this.assertOpen();
        if (this.work(workId).epoch !== w.epoch)
            throw new ControllerError('EPOCH_CONFLICT', 'Work changed during recovery inspection', 'Inspect current retained work before retry', workId);
        this.store.tx(() => {
            for (const apply of recoveries)
                apply();
        });
    }
    private async reconcileRecordedScope(file: string, data: Record<string, any>): Promise<string> {
        const runtime = this.recordedRuntime(data);
        if (!runtime)
            return 'quarantined-missing-runtime';
        try {
            await trustedDockerBinary(runtime.dockerBinary);
            if (runtime.dockerConfigDirectory)
                await trustedDockerConfiguration(runtime.dockerConfigDirectory);
        }
        catch {
            // Keep offline or removed retired authority unresolved. Never route its
            // cleanup through the replacement, and do not block application startup.
            return 'quarantined-runtime-unavailable';
        }
        // Native cleanup uncertainty must retain its exact checkpoint and propagate.
        return (await reconcileScope(file, runtime.dockerBinary, runtime.dockerConfigDirectory)).state;
    }

    private async reconcileRun(runId: string, workId: string) {
        const directory = path.join(this.state, 'runtime');
        for (const file of await fs.readdir(directory)) {
            if (!file.endsWith('.json'))
                continue;
            await privateFile(path.join(directory, file));
            const saved = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
            if (saved.workId === workId && saved.runId === runId) {
                return this.reconcileRecordedScope(path.join(directory, file), parse(this.store.one('SELECT data FROM runs WHERE id=?', runId).data));
            }
        }
        return 'quarantined-missing-journal';
    }
    async recover() {
        for (const run of this.store.all("SELECT * FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')")) {
            if (parse(run.data).kind === 'configuration-http') {
                this.configurationEngine.recoverRun(run);
                continue;
            }
            if (parse(run.data).kind === 'publication-judgment') {
                await this.changes.recoverPublicationJudgment(run);
                continue;
            }
            if (parse(run.data).kind === 'publication-http') {
                this.publicationEngine.recoverRun(run);
                continue;
            }
            if (parse(run.data).kind === 'native-effect') {
                await this.effects.recoverNativeRun(run);
                continue;
            }
            if (parse(run.data).kind === 'merge-http') {
                this.effects.merges.recoverRun(run);
                continue;
            }
            let cleanup = 'not-allocated';
            let rejectedStartup = false;
            const journal = path.join(this.state, 'runtime');
            const files = await fs.readdir(journal);
            let found = false;
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                await privateFile(path.join(journal, file));
                const saved = JSON.parse(await fs.readFile(path.join(journal, file), 'utf8'));
                if (saved.workId === run.work && saved.runId === run.id) {
                    found = true;
                    const data = parse(run.data);
                    const work = this.work(run.work);
                    const recordedFailure = work.state === 'UNKNOWN' && data.outcome === 'unavailable';
                    const rejectedBeforeSettlement = work.state === 'ACTIVE' && run.phase === 'RUNTIME_CREATING' &&
                        data.outcome === undefined && saved.createRejection?.original?.kind === 'native-result';
                    rejectedStartup = data.kind === 'ordinary-conversation' && (recordedFailure || rejectedBeforeSettlement) &&
                        work.epoch === run.epoch && work.generation === run.generation &&
                        !data.containerId && !data.attainedNative && !data.allocatedNative && !data.nativePromptAttempted &&
                        !data.modelDispatchAttempted && !data.nativeInputObserved &&
                        saved.state === 'removed' && validCreateRejectionEvidence(saved.createRejection) &&
                        saved.createRejection.mountSource === run.staging &&
                        (saved.createRejection.original.kind !== 'legacy-controller-observation' ||
                            saved.createRejection.original.journalPath === path.join(journal, file) &&
                                this.store.one("SELECT COUNT(*) AS n FROM observations WHERE run=? AND json_extract(data,'$.kind')='ordinary-response-unavailable' AND json_extract(data,'$.error')=?", run.id, saved.createRejection.original.error).n === 1);
                    if (rejectedStartup) {
                        try {
                            assertUniqueStartupJournal(journal, run.work, run.id, path.join(journal, file));
                        }
                        catch {
                            cleanup = 'quarantined-rejection-correspondence';
                            rejectedStartup = false;
                            break;
                        }
                        cleanup = 'removed';
                        break;
                    }
                    cleanup = await this.reconcileRecordedScope(path.join(journal, file), data);
                    break;
                }
            }
            if (!found && ['RUNNING', 'RUNTIME_CREATING', 'UNKNOWN'].includes(run.phase) && !(parse(run.data).kind === 'ordinary-conversation' && parse(run.data).unbound === true))
                cleanup = 'quarantined-missing-journal';
            if (!cleanup.startsWith('quarantined') && !['governed-role', 'governed-check'].includes(parse(run.data).kind))
                await fs.rm(run.staging, { recursive: true, force: true });
            this.store.tx(() => {
                this.settleBudget(run.id);
                const rejected = rejectedStartup && cleanup === 'removed';
                this.patchRun(run.id, cleanup.startsWith('quarantined') ? 'UNKNOWN' : rejected ? 'SETTLED' : 'INTERRUPTED', {
                    cleanup, recoveredAt: Date.now(), ...(rejected ? { outcome: 'unavailable' } : {}),
                });
                this.store.run('UPDATE works SET state=? WHERE id=?', cleanup.startsWith('quarantined') ? 'UNKNOWN' : rejected ? 'ACTIVE' : 'INTERRUPTED', run.work);
                if (rejected) {
                    const data = parse(run.data), state = this.store.one('SELECT work,data FROM conversation_state WHERE conversation=?', data.conversation);
                    if (state?.work === run.work && parse(state.data).runId === run.id && !Object.hasOwn(parse(state.data), 'nativeInputRecovery')) {
                        this.store.run("UPDATE conversation_state SET resource='IDLE',data=? WHERE conversation=?", JSON.stringify({ ...parse(state.data), cleanup: { cleanup: 'removed', settled: true } }), data.conversation);
                    }
                }
            });
        }
    }
    close(): Promise<void> {
        if (this.closing)
            return this.closing;
        if (this.closed)
            return Promise.resolve();
        this.quiesceInteractionHost();
        const closingWorks = [...this.active].filter(([, handle]) => handle.retainedIntegrationRead !== true).map(([work]) => work);
        this.ordinaryCore?.quiesce();
        this.completedCore?.quiesce();
        this.contextAbort.abort();
        for (const operation of this.managedOperations.values())
            operation.abort.abort();
        const managedJoins = [...this.managedOperations.values()].map(operation => operation.done);
        this.closing = Promise.resolve().then(async () => {
            await Promise.allSettled(managedJoins);
            let modelCloseAttempted = false, failed = false;
            let applicationCloseAttempted = false;
            let inputJoinFailed = false;
            let earlierError: unknown;
            try {
                for (const workId of closingWorks)
                    this.active.get(workId)?.abort.abort();
                // Preparation callbacks may still own application resources. Abort admission first,
                // then join their actual tails before releasing those resources or the Store.
                await Promise.allSettled([...this.contextInputs]);
                applicationCloseAttempted = true;
                await this.closeApplicationResources();
                for (const workId of closingWorks)
                    await this.cancelHandle({ workId });
                await this.contributionsCore?.close();
                let settlementError: unknown;
                try {
                    await this.effectsCore?.close();
                }
                catch (error) {
                    // Registration reports this only after all effect-owned tails have joined.
                    // Earlier effect shutdown failures must retain their original owner/store.
                    if (!(error instanceof ControllerError) || error.code !== 'INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN')
                        throw error;
                    settlementError = error;
                }
                await Promise.all([...this.active.values()].map(h => h.done));
                await Promise.allSettled([...this.contextInputs]);
                try {
                    this.goalCore?.quiesce();
                }
                catch (error) {
                    settlementError = settlementError ? new AggregateError([settlementError, error], 'Integration cleanup and goal interruption unavailable') : error;
                }
                try {
                    await this.ordinaryCore?.drain();
                }
                catch (error) {
                    settlementError = settlementError ? new AggregateError([settlementError, error], 'Goal interruption and ordinary cleanup unavailable') : error;
                }
                await this.goalCore?.drain();
                await this.interactionCore?.drainNotices();
                try {
                    await this.interactionCore?.drainNativeInputs();
                }
                catch (error) {
                    inputJoinFailed = true;
                    throw error;
                }
                await this.completedCore?.close();
                modelCloseAttempted = true;
                try {
                    await this.modelResource?.close();
                }
                catch (error) {
                    settlementError = settlementError ? new AggregateError([settlementError, error], 'Controller settlement and model cleanup unavailable') : error;
                }
                this.closed = true;
                this.store.close();
                await this.releaseOwner();
                if (settlementError)
                    throw settlementError;
            }
            catch (error) {
                failed = true;
                earlierError = error;
                throw error;
            }
            finally {
                if (!applicationCloseAttempted)
                    await this.closeApplicationResources();
                // An earlier cancel/drain rejection retains the original store/owner
                // state, but cannot skip this explicitly adopted cleanup owner.
                if (!modelCloseAttempted) {
                    // Request every known producer's interruption before joining.
                    // A failed earlier close stage cannot jump over input tails.
                    for (const handle of this.active.values())
                        handle.abort.abort();
                    try {
                        await Promise.allSettled([...this.active.values()].map(handle => handle.done));
                        await Promise.allSettled([...this.contextInputs]);
                        if (inputJoinFailed)
                            throw new Error('Earlier native input join remains unavailable');
                        await this.interactionCore?.drainNativeInputs();
                    }
                    catch (joinError) {
                        throw new AggregateError([earlierError, joinError].filter(value => value !== undefined), 'Owned input cleanup unavailable; model resources and controller ownership retained');
                    }
                    let retainedCleanupError: unknown;
                    try {
                        await this.completedCore?.close();
                    }
                    catch (error) {
                        retainedCleanupError = error;
                    }
                    try {
                        await this.modelResource?.close();
                    }
                    catch (cleanupError) {
                        if (failed || retainedCleanupError)
                            throw new AggregateError([earlierError, retainedCleanupError, cleanupError].filter(x => x !== undefined), 'Controller close failed and model cleanup is unavailable', { cause: earlierError });
                        throw cleanupError;
                    }
                    if (retainedCleanupError)
                        throw new AggregateError([earlierError, retainedCleanupError].filter(x => x !== undefined), 'Completed cleanup remains UNKNOWN');
                }
            }
        });
        return this.closing;
    }
}
export async function openController(options: ControllerOptions, opening: import('./types.js').ControllerOpening = {}): Promise<Controller> {
    if (Object.keys(opening).some(key => !['managementOnly', 'prepareStartup'].includes(key)) ||
        opening.managementOnly !== undefined && typeof opening.managementOnly !== 'boolean' ||
        opening.prepareStartup !== undefined && typeof opening.prepareStartup !== 'function')
        throw Error('Invalid trusted controller opening');
    const completedResources = resourcePolicy(options.completedResources);
    const home = path.resolve(options.installationHome);
    await fs.mkdir(path.dirname(home), { recursive: true });
    let existing = false;
    try {
        await fs.lstat(home);
        existing = true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
    if (existing) {
        const files = await fs.readdir(home);
        if (files.length && !files.includes('controller.json'))
            throw new ControllerError('FOREIGN_HOME', `Application home ${home} is nonempty and has no controller ownership marker`, `Inspect ${home} before changing it. Existing contents were not adopted. To use a different home, run gitjig conversation ui --home /absolute/empty-gitjig-home with a new dedicated directory`);
    }
    await privateDirectory(home);
    const marker = path.join(home, 'controller.json');
    await privateFile(marker);
    try {
        const saved = JSON.parse(await fs.readFile(marker, 'utf8'));
        if (saved.format !== 'gitjig-controller-1')
            throw new Error('foreign marker');
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new ControllerError('FOREIGN_HOME', `Application home ownership marker ${marker} cannot be verified`, `Inspect the existing home and marker without overwriting them. To use a separate home, run gitjig conversation ui --home /absolute/empty-gitjig-home with a new dedicated directory`);
        await fs.writeFile(marker, JSON.stringify({ format: 'gitjig-controller-1' }), { mode: 0o600, flag: 'wx' });
    }
    await assertNoPendingReset(home);
    const state = path.join(home, 'state');
    await privateDirectory(state);
    const release = await acquireOwner(state);
    let store: Store | undefined;
    try {
        // Reset keeps this lock directory stable; do not recreate selected data before admission.
        await assertNoPendingReset(home);
        await assertNoPendingActivation(home);
        for (const name of ['artifacts', 'inputs'])
            await privateDirectory(path.join(home, name));
        await privateDirectory(path.join(state, 'runtime'));
        for (const suffix of ['', '-wal', '-shm'])
            await privateFile(path.join(state, 'controller.sqlite' + suffix));
        store = new Store(path.join(state, 'controller.sqlite'));
        const prepared = await opening.prepareStartup?.(Object.freeze({ installationHome: home,
            projectRoots: Object.freeze(store.all('SELECT root FROM projects ORDER BY id').map(row => String(row.root))) }));
        if (prepared !== undefined && (!prepared || typeof prepared !== 'object' || Array.isArray(prepared) || Object.keys(prepared).some(key => key !== 'runtimeProfile')))
            throw Error('Startup preparation accepts only runtimeProfile');
        const selectedRuntime = options.runtimeProfile ?? prepared?.runtimeProfile;
        const effective: ControllerOptions = { ...options, installationHome: home, completedResources };
        if (options.interactionDelegation) {
            const value = options.interactionDelegation, n = value.maxAssignments ?? 8;
            if (!Number.isSafeInteger(n) || n < 1 || n > 100 || value.projectIds?.some(project => !project || !/^[A-Za-z0-9_-]{1,100}$/.test(project)) || value.projectIds && new Set(value.projectIds).size !== value.projectIds.length)
                throw new Error('Invalid finite interaction delegation');
            effective.interactionDelegation = Object.freeze({ ...value, ...(value.projectIds ? { projectIds: Object.freeze([...value.projectIds]) } : {}) });
        }
        if (options.effectsProfile)
            effective.effectsProfile = Object.freeze({ ...options.effectsProfile });
        if (options.effectDelegations) {
            if (options.effectDelegations.some(v => !v.projectId || !v.targetId || !Number.isSafeInteger(v.operationLimit) || v.operationLimit < 1 || v.operationLimit > 100))
                throw Error('Invalid finite startup effects grants');
            for (const config of options.effectDelegations) {
                const target = store.one('SELECT project FROM effect_targets WHERE id=?', config.targetId);
                if (!target || target.project !== config.projectId)
                    throw Error('Startup effect grant requires actual registered matching target');
            }
            effective.effectDelegations = Object.freeze(options.effectDelegations.map(v => Object.freeze({ ...v })));
        }
        if (options.mergeDelegations) {
            const configs = structuredClone(options.mergeDelegations);
            if (!Array.isArray(configs) || configs.length > 100 || new Set(configs.map(value => value.targetId)).size !== configs.length || configs.some(value => Object.keys(value).some(key => !['projectId', 'targetId', 'operationLimit', 'notifications'].includes(key)) || typeof value.projectId !== 'string' || !value.projectId || typeof value.targetId !== 'string' || !value.targetId || !Number.isSafeInteger(value.operationLimit) || value.operationLimit < 1 || value.operationLimit > 100 || value.notifications !== 'allow-merge-notifications'))
                throw Error('Finite distinct startup ordinary merge grants and explicit notification permission required');
            for (const config of configs) {
                const target = store.one('SELECT project,data FROM effect_targets WHERE id=?', config.targetId);
                if (!target || target.project !== config.projectId || parse(target.data).kind !== 'github-merge')
                    throw Error('Startup merge grant requires original registered matching merge target');
            }
            effective.mergeDelegations = Object.freeze(configs.map(config => Object.freeze(config)));
        }
        if (selectedRuntime)
            effective.runtimeProfile = Object.freeze({ ...selectedRuntime, uid: selectedRuntime.uid ?? process.getuid?.() ?? 1000, gid: selectedRuntime.gid ?? process.getgid?.() ?? 1000 });
        const controller = new Controller(effective, store, release, opening.managementOnly === true);
        controller.initializeGoalRecovery();
        if (!opening.managementOnly) {
            await controller.recover();
            controller.recoverChanges();
        }
        if (effective.modelResource)
            await controller.adoptModelResource(effective.modelResource);
        return controller;
    }
    catch (error) {
        store?.close();
        await release();
        throw error;
    }
}

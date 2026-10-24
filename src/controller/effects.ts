import { hasNoAllocatedProducer } from './capacity-settlement.js';
import { effectiveAssignmentAuthority, propagateRecoveredOwnerSources } from './assignment-authority.js';
import { NativeGitCleanupError, NativeGitNotAllocatedError } from '../effects/native-git.js';
import { modelConfigurationIdentity } from '../pi/model-identity.js';
import { integrationDelegation } from './integration-delegation.js';
import { integrationGrantHistory } from './integration-grant-history.js';
import { integrationStart } from './integration-start.js';
import { integrationTransmissionHolds } from './integration-transmission.js';
import { integrationSendReview } from './integration-dispatch.js';
import { integrationReadContext } from './integration-recovery.js';
import { settleRecoveredEffectAssignment } from './effect-assignment-settlement.js';
import type { EffectsProfile } from './effect-types.js';
import { listRetainedIntegrations, retainedIntegration } from './integration-registry.js';
import { assertOwnerRootActivated, ownerRootActivation, ownerRootProfile } from './owner-activation.js';
import { assertNoPendingRulesetWrite } from './policy-handoff.js';
import { HostedIntegrationSession, hostedTarget, type RegisterHostedIntegrationTarget, type DelegateHostedIntegration, type OwnedHostedIntegrationFixture, type EffectGitClient } from './hostedintegration.js';
import { Configurations } from './configuration.js';
import { Publications } from './publication.js';
import { Merges } from './merge.js';
import { contextWorkContinuation, contextAuthoritySnapshot } from './context-origin.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { ControllerError, type ControllerOptions } from './types.js';
import type { ChangeCore } from './change-core.js';
import type { ChangeOperation } from './change-types.js';
import type { Interactions } from './interaction.js';
import type { Capacity } from './capacity.js';
import type { NativeIdentity } from './interaction-types.js';
import type { RegisterLocalTarget, DelegateIntegration, PrepareIntegration, EffectView, CurrentEvidence } from './effect-types.js';
import type { LocalBareTarget, ForwardSend } from '../effects/types.js';
import { hash } from './change-files.js';
import { privateDirectory, inside } from './ownership.js';
const parse = (value: string) => JSON.parse(value);
export interface EffectHost {
    store: Store;
    options: ControllerOptions;
    changes: ChangeCore;
    interactions: Interactions;
    capacity: Capacity;
    contributionSnapshot(input: {
        resourceId: string;
        revisionId: string;
    }): ReturnType<import('./contributions.js').Contributions['resolvePublication']>;
    currentContributionSnapshot(resourceId: string): ReturnType<import('./contributions.js').Contributions['currentPublicationSummary']>;
    assertOpen(): void;
    assertInteractionAdmission(): void;
    assertOwnerConfigurationAdmission(): void;
    busy(work: string): boolean;
    register(work: string, handle: {
        retainedIntegrationRead?: true;
        abort: AbortController;
        done?: Promise<unknown>;
    }): void;
    unregister(work: string): void;
    settleBudget(run: string): void;
    patchRun(run: string, phase: string, data: Record<string, unknown>): void;
}
export class Effects {
    private registeringHosted = 0;
    private hostedRegistrationAbort = new AbortController();
    private localRegistrationAbort = new AbortController();
    private firstPreparationAbort = new AbortController();
    private registrationCleanupFailures = new Set<unknown>();
    private hostedRegistrations = new Set<Promise<{
        targetId: string;
    }>>();
    private hostedSession: HostedIntegrationSession | undefined;
    configureNormalHosted(options: import('./hostedintegration.js').NormalHostedIntegrationCredential) {
        this.assertAcceptanceAdmission();
        this.hostedSession = new HostedIntegrationSession({ normal: structuredClone(options) });
    }
    configureOwnedNormalHosted(options: import('./hostedintegration.js').OwnedNormalHostedIntegrationFixture) {
        this.assertAcceptanceAdmission();
        this.hostedSession = new HostedIntegrationSession({ normal: { token: options.token, ...(options.limits ? { limits: options.limits } : {}) }, owned: { origin: options.origin, https: structuredClone(options.https) } });
    }
    private assertHostedCapture(session: HostedIntegrationSession | undefined, client?: EffectGitClient) {
        if (!session || session !== this.hostedSession)
            throw Error('Actual captured hosted session changed');
        if (client)
            session.assertClient(client);
    }
    configureOwnedHosted(options: OwnedHostedIntegrationFixture) {
        this.h.assertOpen();
        if (this.registeringHosted || this.drivers.size || this.activeNative.size)
            throw Error('Active integration must settle before credential replacement');
        this.hostedSession = new HostedIntegrationSession(options);
    }
    assertAcceptanceAdmission() {
        this.h.assertOpen();
        this.h.assertInteractionAdmission();
        if (this.registeringHosted || this.drivers.size || this.activeNative.size)
            throw Error('Active integration must settle before credential replacement');
    }
    configureCreatedAcceptance(context: import('../platform/hosted-context.js').CreatedAcceptanceContext) {
        this.assertAcceptanceAdmission();
        this.hostedSession = new HostedIntegrationSession(context);
    }
    registerHosted(options: RegisterHostedIntegrationTarget, controls?: {
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }): Promise<{
        targetId: string;
    }> {
        this.h.assertOpen();
        if (this.registrationCleanupFailures.size)
            return Promise.reject([...this.registrationCleanupFailures][0]);
        this.hostedRegistrationAbort.signal.throwIfAborted();
        this.registeringHosted++;
        const task = this.registerHostedInner(options, controls);
        this.hostedRegistrations.add(task);
        void task.then(() => { this.hostedRegistrations.delete(task); this.registeringHosted--; }, error => {
            this.hostedRegistrations.delete(task);
            this.registeringHosted--;
            if (error?.code === 'INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN')
                this.registrationCleanupFailures.add(error);
        });
        return task;
    }
    private async registerHostedInner(request: RegisterHostedIntegrationTarget, controls?: {
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }) {
        if (Buffer.byteLength(JSON.stringify(request)) > 131072)
            throw Error('Integration target input exceeds bounded128KiB registry limit');
        const options = structuredClone(request), profile = structuredClone(controls?.gitProfile ?? this.h.options.effectsProfile), validate = controls?.validate, signal = AbortSignal.any([this.hostedRegistrationAbort.signal, ...controls?.signal ? [controls.signal] : []]);
        const guard = () => { this.h.assertOpen(); signal.throwIfAborted(); validate?.(); };
        guard();
        if (!this.hostedSession)
            throw Error('HOSTED_GIT_DISABLED: owned fixture deployment required');
        const capturedSession = this.hostedSession;
        const data = hostedTarget(options);
        if (Buffer.byteLength(JSON.stringify(data)) > 131072)
            throw Error('Observed integration target exceeds bounded128KiB registry limit');
        const project = this.s.one('SELECT * FROM projects WHERE id=?', options.projectId);
        if (!project)
            throw Error('Registered project required');
        const projectScopes = hash(this.s.all('SELECT id,root FROM projects ORDER BY id')), projectFingerprint = hash(project), projectPath = await fs.realpath(project.root), projectIdentity = await fs.lstat(project.root);
        guard();
        if (projectPath !== project.root || !projectIdentity.isDirectory() || projectIdentity.isSymbolicLink())
            throw Error('Original project root unavailable');
        const currentProject = () => {
            guard();
            if (hash(this.s.all('SELECT id,root FROM projects ORDER BY id')) !== projectScopes)
                throw Error('Original project scopes changed during hosted integration registration');
            if (hash(this.s.one('SELECT * FROM projects WHERE id=?', options.projectId)) !== projectFingerprint)
                throw Error('Original project changed during hosted integration registration');
            const current = fsSync.lstatSync(project.root);
            if (fsSync.realpathSync(project.root) !== projectPath || current.dev !== projectIdentity.dev || current.ino !== projectIdentity.ino || !current.isDirectory() || current.isSymbolicLink())
                throw Error('Original project directory identity changed');
        };
        currentProject();
        const prior = this.s.all('SELECT * FROM effect_targets').find(row => { const d = parse(row.data); return d.kind === 'github-existing-ref' && d.target.repositoryId === data.target.repositoryId && d.target.ref === data.target.ref; });
        if (prior) {
            if (prior.project !== options.projectId || hash(parse(prior.data)) !== hash(data))
                throw Error('Hosted endpoint already bound to another immutable target scope');
            if (capturedSession.normal) {
                const identity = await capturedSession.observeReadIdentity(data, signal);
                this.assertHostedCapture(capturedSession);
                this.s.tx(() => {
                    currentProject();
                    if (hash(this.s.one('SELECT * FROM effect_targets WHERE id=?', prior.id)) !== hash(prior))
                        throw Error('Original hosted target changed during registration');
                    this.s.run('INSERT INTO sources VALUES(?,?,?,?)', randomUUID(), null, JSON.stringify({ kind: 'native-hosted-target-observation', uid: process.getuid?.() }), JSON.stringify({ targetId: prior.id, identity }));
                });
            }
            currentProject();
            return { targetId: prior.id as string };
        }
        const id = randomUUID(), root = path.join(this.h.options.installationHome, 'effects', 'registration-' + id, 'client');
        let client: EffectGitClient | undefined, retainedTargetId: string | undefined, operationError: unknown;
        try {
            try {
                if (!profile)
                    throw Error('Explicit trusted effectsProfile.gitBinary prerequisite unavailable');
                client = await this.client(root, false, true, capturedSession, profile, signal);
            }
            catch (error) {
                if (error instanceof NativeGitCleanupError) {
                    const failure = new ControllerError('INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN', 'Hosted integration registration initialization cleanup UNKNOWN; no target committed at ' + root, 'Inspect original registration client ' + root + '; preserve its native command journal and resolve uncertain cleanup before retrying');
                    failure.cause = error;
                    throw failure;
                }
                throw error;
            }
            this.assertHostedCapture(capturedSession, client);
            currentProject();
            const identity = await capturedSession.observeReadIdentity(data, signal);
            this.assertHostedCapture(capturedSession, client);
            currentProject();
            await client.fetchHttpsPinnedBasis(data.target, data.basisCommit, signal);
            currentProject();
            const concurrent = this.s.all('SELECT * FROM effect_targets').find(row => { const d = parse(row.data); return d.kind === 'github-existing-ref' && d.target.repositoryId === data.target.repositoryId && d.target.ref === data.target.ref; });
            if (concurrent) {
                if (concurrent.project !== options.projectId || hash(parse(concurrent.data)) !== hash(data))
                    throw Error('Hosted endpoint concurrently bound to different scope');
                retainedTargetId = concurrent.id as string;
                return { targetId: retainedTargetId };
            }
            this.assertHostedCapture(capturedSession, client);
            this.s.tx(() => { currentProject(); this.s.run('INSERT INTO effect_targets VALUES(?,?,?)', id, options.projectId, JSON.stringify(data)); this.s.run('INSERT INTO sources VALUES(?,?,?,?)', randomUUID(), null, JSON.stringify({ kind: 'native-hosted-target-registration', uid: process.getuid?.() }), JSON.stringify({ targetId: id, identity })); });
            retainedTargetId = id;
            return { targetId: id };
        }
        catch (error) {
            operationError = error;
            throw error;
        }
        finally {
            if (client)
                try {
                    await client.close();
                }
                catch (error) {
                    const failure = new ControllerError('INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN', (retainedTargetId ? 'Hosted integration target ' + retainedTargetId + ' remains registered; ' : 'Hosted integration registration was not committed; ') + 'native cleanup UNKNOWN at ' + root, 'Inspect original registration client ' + root + '; preserve its native command journal and resolve uncertain cleanup before retrying');
                    failure.cause = operationError === undefined ? error : new AggregateError([operationError, error], 'Hosted registration and cleanup both unavailable');
                    throw failure;
                }
        }
    }
    private configurationCore: Configurations | undefined;
    get configurations() { return this.configurationCore ??= new Configurations(this.h); }
    private publicationCore: Publications | undefined;
    get publications() { return this.publicationCore ??= new Publications(this.h, w => this.ancestry(w), op => this.inheritOwnerSources(op)); }
    private mergeCore: Merges | undefined;
    get merges() { return this.mergeCore ??= new Merges(this.h, { ancestry: w => this.ancestry(w), source: i => this.sourceToken(i), owner: w => this.ownerToken(w), subject: w => this.contextToken(w), validateOrigin: op => this.validateOrigin(op) }); }
    private drivers = new Map<string, {
        abort: AbortController;
        done: Promise<unknown>;
    }>();
    private nativeTasks = new Set<Promise<unknown>>();
    private activeNative = new Map<string, AbortController>();
    private unsubscribeSource: () => void;
    private unsubscribeRecovered: () => void;
    constructor(private h: EffectHost) {
        this.unsubscribeSource = h.interactions.subscribe(event => {
            if (event.type !== 'input-queued')
                return;
            for (const row of this.s.all("SELECT * FROM effect_operations WHERE phase!='CONFIRMED'")) {
                const op = { ...row, data: parse(row.data) };
                if (op.data.kind != null && !['local-git', 'github-existing-ref', 'publication', 'github-merge'].includes(op.data.kind))
                    continue;
                if (op.data.origin?.identity.conversationId === event.conversationId || op.data.ownerRoot?.conversationId === event.conversationId)
                    this.inheritOwnerSources(op);
            }
        });
        // Separate later listener: operation inheritance must insert first so it also holds or aborts its operation.
        // A refused propagation leaves the accepted parent input intact; launch and effective authority hold the recovered task.
        this.unsubscribeRecovered = h.interactions.subscribe(event => {
            if (event.type !== 'input-queued')
                return;
            for (const row of this.s.all("SELECT id FROM conversation_assignments WHERE source_conversation=? AND state IN ('RECOVERY_READY','QUEUED','RUNNING','UNAVAILABLE') AND json_valid(data) AND json_type(data,'$.authorityRecovery') IS NOT NULL LIMIT 64", event.conversationId))
                try {
                    propagateRecoveredOwnerSources(this.s, row.id);
                }
                catch { }
        });
    }
    private newerOwnerSources(op: any) {
        const parents = [{ conversation: op.data.origin.identity.conversationId, revision: op.data.origin.direction }, ...(op.data.ownerRoot?.conversationId ? [{ conversation: op.data.ownerRoot.conversationId, revision: op.data.ownerRoot.direction }] : [])];
        const received = new Map<string, any>();
        for (const parent of parents)
            for (const row of this.s.all("SELECT d.*,s.raw,s.origin FROM conversation_directions d JOIN sources s ON s.id=d.source WHERE d.conversation=? AND d.revision>? AND json_extract(s.origin,'$.kind') LIKE 'owner-%' ORDER BY d.revision", parent.conversation, parent.revision))
                received.set(row.source, row);
        return [...received.values()];
    }
    private inheritOwnerSources(op: any) {
        if (op.phase === 'CONFIRMED' || !op.data.origin || !op.data.reviewedAssignmentId)
            return;
        const original = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', op.data.reviewedAssignmentId), subject = this.work(op.work);
        if (!original || original.work !== op.work || parse(original.data).operation !== 'change' || subject.state === 'CANCELLED' || this.work(op.data.origin.identity.workId).epoch !== op.data.origin.workEpoch)
            return;
        const received = this.newerOwnerSources(op);
        if (!received.length)
            return;
        let changed = false;
        this.s.tx(() => {
            for (const source of received) {
                if (this.s.one("SELECT id FROM conversation_inputs WHERE work=? AND json_extract(data,'$.inheritedOwnerSource')=?", op.work, source.source))
                    continue;
                const view = this.h.interactions.inspect(original.target), inputId = randomUUID(), revision = view.directionRevision + 1;
                this.s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)', inputId, view.conversationId, view.generation, op.work, source.source, 'DISPATCHED_WORKFLOW', 'inherited-owner-source', source.raw, JSON.stringify({ inheritedOwnerSource: source.source, parentConversation: source.conversation, parentRevision: source.revision, parentInputId: parse(source.data).inputId, effectOperationId: op.id }));
                this.s.run('INSERT INTO conversation_directions VALUES(?,?,?,?)', view.conversationId, revision, source.source, JSON.stringify({ inputId, classification: 'unknown', effectHold: true, inherited: true, affectedWorkId: op.work, affectedGeneration: view.generation, affectedRunId: null, affectedAssignmentId: original.id }));
                this.s.run('UPDATE conversation_state SET direction=? WHERE conversation=?', revision, view.conversationId);
                this.receipt(op.id, 'inherited-owner-source', { sourceId: source.source, parentConversation: source.conversation, parentRevision: source.revision, childInputId: inputId, subjectWorkId: op.work });
                changed = true;
            }
            if (changed) {
                const row = this.s.one('SELECT * FROM change_state WHERE work=?', op.work), data = parse(row.data);
                this.s.run('UPDATE change_state SET phase=?,data=? WHERE work=?', 'BLOCKED', JSON.stringify({ ...data, inheritedPriorPhase: row.phase, blocked: ['Original parent owner input requires independent same-work source-fit'], nextAction: 'Re-enter the original governed assignment; consume ALL inherited owner sources before affected action', resumeStage: row.phase === 'REVIEW_READY' ? 'resolve' : data.resumeStage ?? ({ PLAN_READY: 'implement', CANDIDATE_CAPTURED: 'checks', CHECKED: 'review', REPAIR_REQUIRED: 'repair', BASE_CAPTURED: 'plan' } as Record<string, string>)[row.phase] ?? 'resolve' }), op.work);
                if (op.data.kind === 'publication')
                    this.publications.holdInheritedSource(op.id);
                else if (op.data.kind === 'github-merge')
                    this.merges.holdInheritedSource(op.id);
                else
                    this.patch(op.id, ['INVOKING', 'UNKNOWN'].includes(op.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Original parent owner source changed; inherited exact source held on same subject W'], nextAction: 'Same original child source-fit/replan then explicit retained operation recovery' });
            }
        });
        if (changed)
            this.activeNative.get(op.id)?.abort(new Error('Original parent owner source changed'));
    }
    private get s() {
        return this.h.store;
    }
    private work(id: string) {
        const row = this.s.one('SELECT * FROM works WHERE id=?', id);
        if (!row)
            throw Error('Unknown effect work');
        return row;
    }
    private target(id: string) {
        const row = this.s.one('SELECT * FROM effect_targets WHERE id=?', id);
        if (!row)
            throw Error('Unknown registered local target');
        const data = parse(row.data);
        if (data.kind != null && !['local-git', 'github-existing-ref'].includes(data.kind))
            throw Error('Branch integration target family required');
        if (data.kind == null && (!data.target || typeof data.target.canonicalPath !== 'string' || typeof data.target.ref !== 'string' || typeof data.basisCommit !== 'string'))
            throw Error('Unsupported legacy local target shape');
        return { ...row, data };
    }
    private op(id: string) {
        const row = this.s.one('SELECT * FROM effect_operations WHERE id=?', id);
        if (!row)
            throw Error('Unknown effect operation');
        const data = parse(row.data);
        if (data.kind != null && !['local-git', 'github-existing-ref'].includes(data.kind))
            throw Error('Branch integration operation family required');
        const target = this.target(row.target);
        if ((data.kind ?? 'local-git') !== (target.data.kind ?? 'local-git'))
            throw Error('Integration target/operation family mismatch');
        return { ...row, data };
    }
    private patch(id: string, phase: EffectView['phase'], patch: Record<string, unknown>) {
        const row = this.op(id);
        this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', phase, JSON.stringify({ ...row.data, ...patch }), id);
        return this.inspectInternal(id);
    }
    private receipt(id: string, kind: string, data: unknown) {
        const key = randomUUID();
        this.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', key, id, kind, JSON.stringify(data));
        return key;
    }
    inspect(id: string): EffectView { this.h.assertOpen(); return this.inspectInternal(id); }
    private inspectInternal(id: string): EffectView {
        const op = this.op(id), send = this.s.one("SELECT data FROM effect_receipts WHERE operation=? AND kind='send' ORDER BY rowid DESC LIMIT 1", id), observation = this.s.one("SELECT data FROM effect_receipts WHERE operation=? AND kind IN ('readback','reconciliation') ORDER BY rowid DESC LIMIT 1", id), transport = send ? parse(send.data) : null;
        return { operationId: id, workId: op.work, targetId: op.target, phase: op.phase, candidateVersion: op.data.evidence?.versions.candidate ?? null, expectedBase: op.data.expectedBase ?? null, headCommit: op.data.headCommit ?? null, integrationCommit: op.data.integrationCommit ?? null, receiptIds: this.s.all('SELECT id FROM effect_receipts WHERE operation=? ORDER BY rowid', id).map(r => r.id), transportOutcome: transport ? (transport.handoff === 'not-started' ? 'not-started' : transport.transport) : op.data.dispatchRun != null || op.phase === 'UNKNOWN' || op.phase === 'INVOKING' ? 'uncertain' : null, observedOutcome: observation ? (parse(observation.data).kind === 'contains-integration' ? 'contains-integration' : 'unknown') : 'not-observed', blocked: op.data.blocked ?? [], nextAction: op.data.nextAction ?? '' };
    }
    list(options: {
        limit?: number;
        before?: string;
    } = {}) { this.h.assertOpen(); return listRetainedIntegrations(this.s, options, id => this.inspect(id)); }
    inspectRetained(id: string) { this.h.assertOpen(); return retainedIntegration(this.s, id, operation => this.inspect(operation)); }
    private async trustedProfile(input: EffectsProfile | undefined): Promise<EffectsProfile> {
        const profile = input && structuredClone(input);
        if (profile && (Object.keys(profile).some(key => !['gitBinary', 'commandTimeoutMs', 'maxOutputBytes'].includes(key)) || profile.commandTimeoutMs !== undefined && (!Number.isSafeInteger(profile.commandTimeoutMs) || profile.commandTimeoutMs < 1 || profile.commandTimeoutMs > 120000) || profile.maxOutputBytes !== undefined && (!Number.isSafeInteger(profile.maxOutputBytes) || profile.maxOutputBytes < 1 || profile.maxOutputBytes > 16777216)))
            throw Error('Finite trusted Git limits required');
        if (!profile)
            throw Error('Explicit trusted effectsProfile.gitBinary prerequisite unavailable');
        if (!path.isAbsolute(profile.gitBinary))
            throw Error('Absolute trusted Git binary required');
        const binary = await fs.realpath(profile.gitBinary), binaryStat = await fs.stat(binary);
        if (!binaryStat.isFile() || !(binaryStat.mode & 0o111) || (binaryStat.mode & 0o022) || ![0, process.getuid?.()].includes(binaryStat.uid))
            throw Error('Trusted Git must be root/current-owner executable without group/other writes');
        if (inside(this.h.options.installationHome, binary) || this.s.all('SELECT root FROM projects').some(p => inside(p.root, binary)))
            throw Error('Trusted Git binary cannot originate from project or mutable installation scopes');
        return { ...profile, gitBinary: binary };
    }
    private async client(root: string, resume = false, hosted = false, capturedSession = this.hostedSession, readProfile?: EffectsProfile, initializationSignal?: AbortSignal): Promise<EffectGitClient> {
        let factoryEntered = false;
        try {
            const profile = await this.trustedProfile(readProfile ?? this.h.options.effectsProfile), binary = profile.gitBinary;
            const effectsRoot = path.join(this.h.options.installationHome, 'effects');
            if (!inside(effectsRoot, root))
                throw Error('Owned effects client root required');
            await privateDirectory(effectsRoot);
            let directory = effectsRoot;
            for (const segment of path.relative(effectsRoot, path.dirname(root)).split(path.sep).filter(Boolean)) {
                directory = path.join(directory, segment);
                await privateDirectory(directory);
            }
            const { openNativeGit } = await import('../effects/native-git.js');
            const captured = { ...profile, gitBinary: binary, ownedClientRoot: root, ...(resume ? { resumeOwned: true } : {}) };
            if (hosted) {
                if (!this.hostedSession)
                    throw Error('HOSTED_GIT_DISABLED: captured fixture session unavailable');
                this.assertHostedCapture(capturedSession);
                initializationSignal?.throwIfAborted();
                factoryEntered = true;
                const client = await capturedSession!.open(captured, [this.h.options.installationHome, ...this.s.all('SELECT root FROM projects').map(row => row.root)], initializationSignal);
                try {
                    this.assertHostedCapture(capturedSession, client);
                    return client;
                }
                catch (error) {
                    await client.close();
                    throw error;
                }
            }
            factoryEntered = true;
            return await openNativeGit(captured, initializationSignal);
        }
        catch (error) {
            if (!factoryEntered)
                throw new NativeGitNotAllocatedError(root, error);
            throw error;
        }
    }
    register(options: RegisterLocalTarget, controls?: {
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }) {
        if (this.registrationCleanupFailures.size)
            return Promise.reject([...this.registrationCleanupFailures][0]);
        const task = this.registerInner(options, controls);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), error => {
            this.nativeTasks.delete(task);
            if (error?.code === 'INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN')
                this.registrationCleanupFailures.add(error);
        });
        return task;
    }
    private async registerInner(request: RegisterLocalTarget, controls?: {
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
        validate?: () => void;
    }) {
        if (Buffer.byteLength(JSON.stringify(request)) > 131072)
            throw Error('Integration target input exceeds bounded128KiB registry limit');
        const options = structuredClone(request), profile = controls?.gitProfile ? structuredClone(controls.gitProfile) : undefined, signal = AbortSignal.any([this.localRegistrationAbort.signal, ...controls?.signal ? [controls.signal] : []]);
        const guard = () => { this.h.assertOpen(); signal.throwIfAborted(); controls?.validate?.(); };
        guard();
        this.h.assertOpen();
        const project = this.s.one('SELECT * FROM projects WHERE id=?', options.projectId);
        if (!project)
            throw Error('Target project must be registered');
        if (!Array.isArray(options.publicationInventory) || !Array.isArray(options.authorizedDeltaPaths) || !options.basisCommit)
            throw Error('Explicit basis/publication inventory/authorized delta required');
        for (const list of [options.publicationInventory, options.authorizedDeltaPaths]) {
            if (!list.length || new Set(list).size !== list.length || list.length > 100000 || list.some(p => typeof p !== 'string' || !p || p.length > 4096 || /[\x00-\x1f\x7f]/u.test(p) || p.includes('\\') || p.startsWith('/') || p.includes('\0') || p.split('/').some((v: string) => !v || v === '.' || v === '..' || v.toLowerCase() === '.git')))
                throw Error('Invalid explicit publication path inventory');
        }
        if (options.authorizedDeltaPaths.some(p => !options.publicationInventory.includes(p)))
            throw Error('Authorized delta must remain within publication inventory');
        const projectFingerprint = hash(project), projectPath = await fs.realpath(project.root), projectIdentity = await fs.lstat(project.root);
        guard();
        if (projectPath !== project.root || !projectIdentity.isDirectory() || projectIdentity.isSymbolicLink())
            throw Error('Original project root unavailable');
        const canonical = await fs.realpath(options.path);
        for (const p of this.s.all('SELECT root FROM projects'))
            if (inside(canonical, p.root) || inside(p.root, canonical))
                throw Error('Authenticated receiver must be outside all project scopes');
        if (inside(canonical, this.h.options.installationHome) || inside(this.h.options.installationHome, canonical))
            throw Error('Receiver and controller installation must be disjoint');
        const targetId = randomUUID(), root = path.join(this.h.options.installationHome, 'effects', 'registration-' + targetId, 'client');
        let client: EffectGitClient;
        try {
            guard();
            client = await this.client(root, false, false, undefined, profile, signal);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'NATIVE_GIT_CLEANUP_UNKNOWN')
                throw new ControllerError('INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN', 'Integration registration initialization cleanup UNKNOWN; no target committed at ' + root, 'Inspect original registration client ' + root + ' before retrying');
            throw Error('Integration registration initialization unavailable at original client ' + root + '; no target committed: ' + String(error), { cause: error });
        }
        let committed: string | undefined;
        try {
            guard();
            const target = await client.registerLocalTarget({ targetId, path: canonical, ref: options.ref }, signal);
            if (target.ownerUid !== process.getuid?.())
                throw Error('Initial local authority requires actual current owner UID');
            await client.fetchLocalBasis(target, options.basisCommit, signal);
            guard();
            if (hash(await client.registerLocalTarget({ targetId, path: canonical, ref: options.ref }, signal)) !== hash(target))
                throw Error('Receiver identity changed during registration');
            guard();
            const data = { kind: 'local-git', target, basisCommit: options.basisCommit, publicationInventory: [...options.publicationInventory], authorizedDeltaPaths: [...options.authorizedDeltaPaths], ownerUid: process.getuid?.() };
            if (Buffer.byteLength(JSON.stringify(data)) > 131072)
                throw Error('Observed integration target exceeds bounded128KiB registry limit');
            this.s.tx(() => {
                guard();
                if (hash(this.s.one('SELECT * FROM projects WHERE id=?', options.projectId)) !== projectFingerprint)
                    throw Error('Original project changed during integration registration');
                const current = fsSync.lstatSync(project.root);
                if (fsSync.realpathSync(project.root) !== projectPath || current.dev !== projectIdentity.dev || current.ino !== projectIdentity.ino || !current.isDirectory() || current.isSymbolicLink())
                    throw Error('Original project directory identity changed');
                for (const row of this.s.all('SELECT root FROM projects')) {
                    if (fsSync.realpathSync(row.root) !== row.root || inside(canonical, row.root) || inside(row.root, canonical))
                        throw Error('Receiver and all current project scopes must remain disjoint');
                }
                const receiver = fsSync.lstatSync(canonical);
                if (fsSync.realpathSync(canonical) !== canonical || String(receiver.dev) !== target.device || String(receiver.ino) !== target.inode || receiver.uid !== target.ownerUid || (receiver.mode & 0o022) || receiver.isSymbolicLink() || !receiver.isDirectory())
                    throw Error('Observed receiver identity changed before registration commit');
                this.s.run('INSERT INTO effect_targets VALUES(?,?,?)', targetId, options.projectId, JSON.stringify(data));
                this.s.run('INSERT INTO authority_observations VALUES(?,?,?)', randomUUID(), targetId, JSON.stringify({ kind: 'owner-local-bare', uid: process.getuid?.(), target, observedAt: Date.now() }));
            });
            committed = targetId;
            return { targetId };
        }
        finally {
            try {
                await client.close();
            }
            catch (error) {
                throw new ControllerError('INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN', (committed ? 'Integration target ' + committed + ' remains registered; ' : 'Integration registration was not committed; ') + 'native cleanup UNKNOWN at ' + root, 'Inspect original registration client ' + root + ' before retrying');
            }
        }
    }
    delegate(options: DelegateIntegration | DelegateHostedIntegration, validate?: () => void) {
        this.assertActivated(options.workId);
        return this.delegateInner(options, false, validate);
    }
    private delegateInner(options: DelegateIntegration | DelegateHostedIntegration, inTransaction: boolean, validate?: () => void) {
        this.h.assertOpen();
        if (contextWorkContinuation(this.s, options.workId))
            throw Error('Context work cannot create a grant; use the retained original owner root/delegate entry');
        const target = this.target(options.targetId), w = this.work(options.workId), source = this.s.one('SELECT origin FROM sources WHERE id=?', w.source), origin = parse(source.origin);
        if (!String(origin.kind).startsWith('owner-') || origin.uid !== process.getuid?.())
            throw Error('Grant root must be actual owner-origin work');
        const family = target.data.kind ?? 'local-git';
        if (!(family === 'github-existing-ref' ? ['ordinary', 'owner-override'].includes(options.mode) : options.mode === 'ordinary') || !Number.isSafeInteger(options.operationLimit) || options.operationLimit < 1 || options.operationLimit > 100 || !['work', 'delegation-lineage'].includes(options.scope ?? 'work'))
            throw Error('Invalid finite ordinary integration grant');
        if (options.scope !== 'delegation-lineage' && w.project !== target.project)
            throw Error('Grant work/project differs');
        if (['UNKNOWN', 'CANCELLED'].includes(w.state))
            throw Error('Grant root is unavailable');
        const existing = this.s.one('SELECT * FROM effect_delegations WHERE root=? AND target=?', w.id, target.id);
        if (existing) {
            const prior = parse(existing.data);
            if ((prior.kind ?? 'local-git') !== family || prior.mode !== options.mode)
                throw Error('Existing grant has another action family');
            if (prior.operationLimit !== options.operationLimit || prior.scope !== (options.scope ?? 'work'))
                throw Error('Existing root grant cannot be reset by redeclaration; use retained grant or an explicit future bounded extension');
            validate?.();
            return { delegationId: existing.id };
        }
        const key = randomUUID();
        const insert = () => {
            validate?.();
            const sid = randomUUID();
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', sid, null, JSON.stringify({ kind: 'owner-effect-grant', uid: process.getuid?.(), root: w.id }), JSON.stringify(options));
            this.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', key, w.id, target.id, 1, JSON.stringify({ kind: family, scope: options.scope ?? 'work', mode: options.mode, operationLimit: options.operationLimit, source: sid, rootEpoch: w.epoch, projectId: target.project }));
        };
        if (inTransaction)
            insert();
        else
            this.s.tx(insert);
        return { delegationId: key };
    }
    hasActiveWork(workId: string) { return this.drivers.has(workId) || [...this.activeNative.keys()].some(id => this.s.one('SELECT work FROM effect_operations WHERE id=?', id)?.work === workId); }
    ownerRootProfile() { return ownerRootProfile(this.h.options.effectDelegations ?? [], this.publications.ownerRootProfile(), this.h.options.mergeDelegations ?? []); }
    assertActivated(workId: string): void { this.ancestry(workId); }
    activateOwnerRoot(workId: string, recovery?: {
        expectedEpoch: number;
        resumeCancelled: boolean;
        validate?: () => void;
    }, inAdmission = false) {
        this.h.assertOpen();
        const work = this.work(workId), record = ownerRootActivation(parse(work.data));
        if (recovery && recovery.expectedEpoch !== work.epoch)
            throw Error('Work epoch changed; inspect the current original work before activation');
        if (record?.state === 'COMPLETE')
            return;
        if (!record && contextWorkContinuation(this.s, workId)) {
            if (recovery)
                throw Error('Context work inherits its retained owner root; activate the original root instead');
            return;
        }
        // Older ordinary roots keep their existing authority; current defaults
        // apply only to an original root that captured an activation profile.
        if (!record && parse(work.data).kind === 'ordinary-conversation') {
            if (recovery)
                throw Error('Legacy ordinary work has no captured activation profile');
            return;
        }
        if (recovery && !record)
            throw Error('Legacy work has no captured activation profile; keep its explicit existing route');
        if (record && this.s.all('SELECT phase,reservation,data FROM runs WHERE work=?', workId).some(run => !['SETTLED', 'INTERRUPTED'].includes(run.phase) || run.reservation === 'reserved' || String(parse(run.data).cleanup ?? '').startsWith('quarantined')))
            throw Error('Original work has unsettled capture or cleanup; close and reopen normally to reconcile its retained run, then inspect its current epoch before activation');
        const origin = parse(this.s.one('SELECT origin FROM sources WHERE id=?', work.source).origin);
        if (!String(origin.kind).startsWith('owner-') || origin.uid !== process.getuid?.()) {
            if (recovery)
                throw Error('Activation requires original work owned by this account');
            return;
        }
        if (work.state !== 'ACTIVE' && !(recovery?.resumeCancelled && ['CANCELLED', 'INTERRUPTED'].includes(work.state)))
            throw Error('Owner activation requires active work; for cancelled/interrupted work explicitly use --resume-cancelled true with its current epoch. Unknown cleanup must be reconciled first');
        if (record && record.fingerprint !== hash(this.ownerRootProfile()))
            throw Error('Selected delegation profile differs from the original captured profile; restore that profile before activation');
        const activate = () => {
            if (this.work(workId).epoch !== work.epoch)
                throw Error('Work changed during activation admission');
            if (work.state !== 'ACTIVE')
                this.s.run('UPDATE works SET state=\'ACTIVE\',epoch=epoch+1,generation=generation+1 WHERE id=?', workId);
            if (contextWorkContinuation(this.s, workId))
                throw Error('Context work inherits its retained owner root; activation cannot create a fresh grant');
            recovery?.validate?.();
            this.publications.activateOwnerRoot(workId, true);
            for (const config of this.h.options.effectDelegations ?? []) {
                const target = this.target(config.targetId);
                if (target.project !== config.projectId)
                    throw Error('Startup grant project/target mismatch');
                this.delegateInner({ workId, targetId: config.targetId, mode: 'ordinary', operationLimit: config.operationLimit, scope: 'delegation-lineage' }, true);
            }
            for (const config of record?.profile.merges ?? this.h.options.mergeDelegations ?? [])
                this.merges.activateOwnerRoot(workId, config);
            if (record) {
                const current = parse(this.work(workId).data);
                this.s.run('UPDATE works SET data=? WHERE id=?', JSON.stringify({ ...current, ownerRootActivation: { ...record, state: 'COMPLETE' } }), workId);
            }
        };
        if (inAdmission)
            activate();
        else
            this.s.tx(activate);
    }
    grantContext(work: string) {
        const ancestors = this.ancestry(work);
        return this.s.all('SELECT * FROM effect_delegations').filter(row => {
            const d = parse(row.data), target = this.s.one('SELECT data FROM effect_targets WHERE id=?', row.target), kind = target ? parse(target.data).kind : undefined;
            if (!target || !['local-git', 'github-existing-ref'].includes(kind ?? 'local-git') || (d.kind ?? 'local-git') !== (kind ?? 'local-git') || !['ordinary', 'owner-override'].includes(d.mode))
                return false;
            return row.root === work || d.scope === 'delegation-lineage' && ancestors.includes(row.root);
        }).map(row => ({ grantId: row.id, targetId: row.target, projectId: parse(row.data).projectId, action: 'integrateBranch', mode: parse(row.data).mode, remainingOperations: Math.max(0, parse(row.data).operationLimit - this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', row.id).n) }));
    }
    private ancestry(work: string) {
        const pathRows: string[] = [], seen = new Set<string>();
        let current = this.work(work);
        while (true) {
            if (seen.has(current.id) || seen.size >= 64)
                throw Error('Original task provenance cycle');
            assertOwnerRootActivated(this.s, current.id);
            seen.add(current.id);
            pathRows.push(current.id);
            const data = parse(current.data), assignmentId = data.invocation?.assignmentId ?? data.assignmentId;
            let parent: string | undefined;
            if (assignmentId) {
                const assignment = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
                if (!assignment || assignment.work !== current.id || assignment.state === 'CANCELLED')
                    throw Error('Original admitted assignment unavailable');
                const a = parse(assignment.data);
                if (a.operation === 'effect-prepare')
                    throw Error('Effect alias cannot create task descent');
                const origin = parse(this.s.one('SELECT origin FROM sources WHERE id=?', current.source).origin);
                const actor = data.invocation?.actor ?? a.source;
                if (!actor || a.source.workId !== actor.workId || origin.actor?.workId && origin.actor.workId !== a.source.workId)
                    throw Error('Original source/assignment provenance differs');
                parent = effectiveAssignmentAuthority(this.s, assignment.id).workId;
            }
            const context = contextWorkContinuation(this.s, current.id);
            if (context && (context.effects === 'none' || !context.sourceWorkId))
                break;
            parent ??= context?.sourceWorkId ?? undefined;
            if (!parent)
                break;
            current = this.work(parent);
        }
        return pathRows;
    }
    private contextToken(work: string): {
        contextFingerprint?: string;
    } {
        const snapshot = contextAuthoritySnapshot(this.s, this.ancestry(work));
        return snapshot ? { contextFingerprint: hash(snapshot) } : {};
    }
    private grant(work: string, target: string, grantId?: string) {
        const w = this.work(work), t = this.target(target);
        if (w.project !== t.project)
            throw Error('Reviewed W project differs from target');
        const ancestors = this.ancestry(work);
        const rows = this.s.all('SELECT id,root,target,epoch,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM effect_delegations WHERE target=? AND root IN (' + ancestors.map(() => '?').join(',') + ')' + (grantId ? ' AND id=?' : '') + ' ORDER BY rowid LIMIT 129', target, ...ancestors, ...grantId ? [grantId] : []);
        if (rows.length > 128 || rows.some(row => typeof row.data !== 'string') || rows.reduce((sum, row) => sum + Buffer.byteLength(row.data), 0) > 1048576)
            throw Error('Original applicable integration grant history exceeds the bounded admission profile');
        for (const row of rows) {
            const data = parse(row.data), root = this.work(row.root);
            if ((data.kind ?? 'local-git') !== (t.data.kind ?? 'local-git'))
                continue;
            if ((row.root === work || data.scope === 'delegation-lineage' && ancestors.includes(row.root)) && root.epoch === data.rootEpoch && !['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(root.state) && ((t.data.kind ?? 'local-git') === 'github-existing-ref' ? ['ordinary', 'owner-override'].includes(data.mode) : data.mode === 'ordinary')) {
                integrationGrantHistory(this.s, row);
                return { ...row, data };
            }
        }
        throw Error('No actual current owner grant covers this original reviewed W lineage/target');
    }
    private sourceToken(identity: NativeIdentity) {
        const root = this.work(identity.workId), view = this.h.interactions.inspect(identity.conversationId);
        return { identity, workEpoch: root.epoch, direction: view.directionRevision, sourceFingerprint: hash(this.h.interactions.impacts(root.id).map(i => ({ id: i.input_id, source: i.source, revision: i.revision, text: i.text }))), rootSource: root.source, ...this.contextToken(root.id) };
    }
    private validateOrigin(op: any) {
        if (this.contextToken(op.work).contextFingerprint !== op.data.subjectContextFingerprint)
            throw Error('Original subject context changed; inspect retained work');
        if (!op.data.origin)
            return;
        const before = op.data.origin, current = this.sourceToken(before.identity);
        if (current.workEpoch !== before.workEpoch || current.direction !== before.direction || current.sourceFingerprint !== before.sourceFingerprint || current.rootSource !== before.rootSource || current.contextFingerprint !== before.contextFingerprint || ['CANCELLED', 'UNKNOWN', 'INTERRUPTED'].includes(this.work(before.identity.workId).state))
            throw Error('Captured coordinator/owner source changed; same child source-fit/replan required before effect');
        if (op.data.ownerRoot && hash(this.ownerToken(op.data.ownerRoot.workId)) !== hash(op.data.ownerRoot))
            throw Error('Original owner root source/direction changed; child source-fit required');
        const original = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', op.data.reviewedAssignmentId);
        if (!original || original.work !== op.work || parse(original.data).operation !== 'change' || original.state === 'CANCELLED')
            throw Error('Original governed assignment no longer agrees');
    }
    private allocate(work: string, target: string, evidence: CurrentEvidence, extra: Record<string, unknown> = {}, queue?: {
        identity: NativeIdentity;
        reviewedAssignmentId: string;
    }, validate?: () => void) {
        const grant = this.grant(work, target);
        return this.s.tx(() => {
            validate?.();
            this.assertTargetTransmissionClear(target, null);
            const count = this.s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?', grant.id).n;
            if (count >= grant.data.operationLimit)
                throw Error('Cumulative original-root integration operation allowance exhausted');
            const id = randomUUID();
            let alias: Record<string, unknown> = {};
            if (queue) {
                const cid = randomUUID(), assignmentId = randomUUID();
                this.s.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)', cid, this.target(target).project, 'QUEUED');
                this.s.run('INSERT INTO conversation_state(conversation,work,resource,data) VALUES(?,?,?,?)', cid, work, 'QUEUED', JSON.stringify({ role: 'Integration', purpose: 'Conditional local branch integration' }));
                this.s.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)', cid, queue.identity.conversationId);
                this.s.run('INSERT INTO conversation_views(conversation) VALUES(?)', cid);
                this.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)', assignmentId, queue.identity.conversationId, cid, work, 'QUEUED', JSON.stringify({ operation: 'effect-prepare', effectOperationId: id, reviewedWorkId: work, reviewedAssignmentId: queue.reviewedAssignmentId, source: queue.identity, delegationRoot: grant.root }));
                this.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)', randomUUID(), queue.identity.conversationId, cid, assignmentId, 'PENDING', JSON.stringify({ source: queue.identity }));
                alias = { assignmentId, conversationId: cid };
            }
            const subject = this.contextToken(work);
            this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, work, target, grant.id, 'PREPARED', JSON.stringify({ kind: this.target(target).data.kind ?? 'local-git', evidence, grantEpoch: grant.epoch, rootEpoch: grant.data.rootEpoch, blocked: [], nextAction: 'prepareIntegration', ...extra, ...alias, ...(subject.contextFingerprint ? { subjectContextFingerprint: subject.contextFingerprint } : {}) }));
            return id;
        });
    }
    async queueIntegration(input: {
        reviewedAssignmentId: string;
        targetId: string;
    }, identity: NativeIdentity, entry: () => void) {
        const request = { reviewedAssignmentId: input.reviewedAssignmentId, targetId: input.targetId }, actor = { ...identity };
        const context = () => {
            this.h.assertOpen();
            entry();
            const live = this.h.interactions.getHandle(actor.conversationId);
            if (!live || (['conversationId', 'workId', 'runId', 'launchId', 'generation', 'directionRevision', 'initialInputId'] as const).some(key => live.identity[key] !== actor[key]))
                throw Error('Integration requires exact current native coordinator');
            const original = this.s.one('SELECT id,source_conversation,target,work,state,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM conversation_assignments WHERE id=?', request.reviewedAssignmentId);
            if (!original?.data || original.state !== 'COMPLETE' || parse(original.data).operation !== 'change' || !original.work)
                throw Error('Actual bounded completed governed reviewed assignment required');
            const subject = this.work(original.work), invocation = parse(subject.data).invocation, assignedSource = parse(original.data).source;
            if (invocation?.assignmentId !== original.id || !invocation.actor || !assignedSource || hash(invocation.actor) !== hash(assignedSource) || original.source_conversation !== assignedSource.conversationId || invocation.conversationId !== undefined && invocation.conversationId !== original.target)
                throw Error('Reviewed original source/invocation differs before alias allocation');
            const ancestors = this.ancestry(subject.id), grant = this.grant(subject.id, request.targetId), coordinator = this.ancestry(actor.workId), target = this.target(request.targetId);
            if (!coordinator.includes(grant.root) || !ancestors.includes(grant.root))
                throw Error('Captured coordinator outside original owner grant lineage');
            const origin = this.sourceToken(actor), ownerRoot = this.ownerToken(grant.root);
            return { original, subject, grant, origin, ownerRoot, fingerprint: hash({ original, subject: { id: subject.id, source: subject.source, project: subject.project, epoch: subject.epoch, generation: subject.generation, state: subject.state, invocation }, grant, ancestors, coordinator, target, origin, ownerRoot }) };
        };
        const captured = context(), { original, subject, grant } = captured;
        const current = () => {
            if (context().fingerprint !== captured.fingerprint)
                throw Error('Original agent integration context changed; inspect the retained assignment before retrying');
            this.h.changes.assertCurrentEvidence(evidence);
        };
        const evidence = await this.h.changes.currentEvidence(subject.id);
        current();
        const previous = this.s.one("SELECT id,phase,CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data FROM effect_operations WHERE work=? AND target=? AND json_extract(data,'$.reviewedAssignmentId')=? ORDER BY rowid DESC LIMIT 1", subject.id, request.targetId, original.id);
        if (previous && !previous.data)
            throw Error('Original integration exceeds the bounded agent reentry profile');
        if (previous && previous.phase === 'CONFIRMED' && parse(previous.data).evidence.fingerprint === evidence.fingerprint)
            throw Error('Exact current integration already confirmed; inspect retained operation instead of repeating');
        if (previous && previous.phase !== 'CONFIRMED') {
            if (previous.phase !== 'REFUSED')
                throw Error('Existing integration operation is active or uncertain; inspect/reconcile instead of retry');
            if (this.s.one('SELECT state FROM conversation_assignments WHERE id=?', parse(previous.data).assignmentId)?.state === 'CANCELLED')
                return this.reauthorizeCancelledAgent(previous.id, { actor, reviewedAssignmentId: original.id, evidence, current });
            return this.s.tx(() => {
                current();
                const old = this.op(previous.id);
                if (old.phase !== 'REFUSED' || hash(old.data) !== hash(parse(previous.data)) || old.data.reviewedAssignmentId !== original.id || old.grant_id !== grant.id || old.data.rootEpoch !== grant.data.rootEpoch)
                    throw Error('Original refused integration changed before reentry');
                this.assertPreparationGrant({ workId: subject.id, targetId: request.targetId, operationId: old.id });
                const alias = this.s.one('SELECT id,source_conversation,target,work,state,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM conversation_assignments WHERE id=?', old.data.assignmentId);
                if (!alias?.data || !['COMPLETE', 'UNAVAILABLE'].includes(alias.state))
                    throw Error('Retained integration assignment cancelled, unsettled or unavailable');
                const data = parse(alias.data), dependencies = this.s.all('SELECT id,waiting,target,assignment,state,CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data ELSE NULL END AS data FROM conversation_dependencies WHERE assignment=? LIMIT 2', alias.id), view = this.s.one('SELECT work,resource FROM conversation_state WHERE conversation=?', alias.target);
                if (alias.work !== old.work || alias.target !== old.data.conversationId || data.operation !== 'effect-prepare' || data.effectOperationId !== old.id || data.reviewedWorkId !== old.work || data.reviewedAssignmentId !== original.id || data.delegationRoot !== grant.root || data.source?.conversationId !== alias.source_conversation || !view || view.work !== old.work || view.resource !== 'IDLE' || dependencies.length !== 1 || !dependencies[0].data || dependencies[0].waiting !== alias.source_conversation || dependencies[0].target !== alias.target || !['PENDING', 'RESOLVED'].includes(dependencies[0].state) || hash(parse(dependencies[0].data).source) !== hash(data.source))
                    throw Error('Retained integration alias/dependency correspondence changed');
                if (!Array.isArray(data.reentries ?? []) || (data.reentries ?? []).length >= 64)
                    throw Error('Original integration reentry history reached its bounded limit');
                const updated = JSON.stringify({ ...data, reentries: [...(data.reentries ?? []), { source: actor }] });
                if (Buffer.byteLength(updated) > 65536)
                    throw Error('Original integration assignment exceeds the bounded reentry profile');
                this.patch(old.id, old.phase, { evidence });
                this.refreshSourceFit(this.op(old.id));
                this.validate(old.id);
                this.s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'QUEUED', updated, alias.id);
                this.s.run('UPDATE conversation_dependencies SET state=? WHERE assignment=?', 'PENDING', alias.id);
                this.s.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'QUEUED', alias.target);
                return { operationId: old.id, assignmentId: alias.id as string, conversationId: alias.target as string, state: 'QUEUED' as const };
            });
        }
        const id = this.allocate(subject.id, request.targetId, evidence, { origin: captured.origin, ownerRoot: captured.ownerRoot, reviewedAssignmentId: original.id }, { identity: actor, reviewedAssignmentId: original.id }, current), op = this.op(id);
        return { operationId: id, assignmentId: op.data.assignmentId as string, conversationId: op.data.conversationId as string, state: 'QUEUED' as const };
    }
    /** Same original native-origin integration after owner cancellation and explicit task recovery. This call never prepares or sends; the requeued alias then runs the normal agent preparation and conditional send. */
    private reauthorizeCancelledAgent(id: string, c: {
        actor: NativeIdentity;
        reviewedAssignmentId: string;
        evidence: CurrentEvidence;
        current: () => void;
    }) {
        const row = (sql: string, ...args: any[]) => this.s.one(sql, ...args), bounded = (column: string, max: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`;
        const inspect = () => {
            c.current();
            const raw = row(`SELECT id,work,target,grant_id,phase,${bounded('data', 1048576)} AS data FROM effect_operations WHERE id=?`, id), old = this.op(id), data = old.data, grant = this.grant(old.work, old.target), subject = this.work(old.work), root = this.work(c.actor.workId), rootData = parse(root.data);
            const reviewed = row(`SELECT id,source_conversation,target,work,state,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, c.reviewedAssignmentId), alias = row(`SELECT id,source_conversation,target,work,state,${bounded('data', 65536)} AS data FROM conversation_assignments WHERE id=?`, data.assignmentId);
            if (!raw?.data || !reviewed?.data || !alias?.data)
                throw Error('Original bounded integration, task or alias unavailable');
            const rdata = parse(reviewed.data), adata = parse(alias.data), recovery = rdata.authorityRecovery ? row(`SELECT ${bounded('raw', 131072)} AS raw FROM sources WHERE id=?`, rdata.authorityRecovery.sourceId) : null, event = recovery?.raw ? parse(recovery.raw) : null, prior = typeof event?.previous?.data === 'string' ? parse(event.previous.data) : null;
            const cancellation = typeof adata.cancellationSource === 'string' ? row(`SELECT ${bounded('origin', 65536)} AS origin FROM sources WHERE id=?`, adata.cancellationSource) : null, dependencies = this.s.all(`SELECT id,waiting,target,assignment,state,${bounded('data', 65536)} AS data FROM conversation_dependencies WHERE assignment=? LIMIT 2`, alias.id), view = row('SELECT work FROM conversation_state WHERE conversation=?', alias.target), rootView = row(`SELECT work,resource,${bounded('data', 65536)} AS data FROM conversation_state WHERE conversation=?`, c.actor.conversationId);
            const history = integrationGrantHistory(this.s, { ...grant, data: JSON.stringify(grant.data) }), receipts = row('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id), authority = effectiveAssignmentAuthority(this.s, reviewed.id);
            if (old.phase !== 'REFUSED' || data.reviewedAssignmentId !== reviewed.id || !data.origin || Object.hasOwn(data, 'subjectContextFingerprint') || ['dispatchRun', 'confirmed'].some(key => Object.hasOwn(data, key)) || row("SELECT id FROM effect_receipts WHERE operation=? AND kind IN ('send','native-preflight','readback','reconciliation') LIMIT 1", id) || this.inspectInternal(id).transportOutcome !== null || this.hasActiveWork(old.work))
                throw Error('Only a definitely-unsent refused original native integration can be reauthorized; inspect or reconcile it');
            if (reviewed.state !== 'COMPLETE' || reviewed.work !== old.work || !event || event.assignmentId !== reviewed.id || event.previous?.state !== 'CANCELLED' || !prior || prior.cancellationSource !== adata.cancellationSource || alias.state !== 'CANCELLED' || !cancellation?.origin || parse(cancellation.origin).kind !== 'owner-task-cancel')
                throw Error('Cancelled integration alias was not withdrawn by the owner cancellation that this task recovery restored');
            if (old.grant_id !== grant.id || grant.root !== root.id || grant.data.mode !== 'ordinary' || !Number.isSafeInteger(data.grantEpoch) || data.grantEpoch >= grant.epoch || !history.epochs.some(epoch => epoch.grantEpoch === data.grantEpoch && epoch.rootEpoch === data.rootEpoch))
                throw Error('Renew the same original ordinary grant before reauthorizing its native integration');
            // Completed WAIT keeps its handles for history; only the current running, non-waiting native owner may reauthorize.
            if (rootData.kind !== 'ordinary-conversation' || root.lineage !== root.id || root.predecessor || Object.hasOwn(rootData, 'invocation') || rdata.source?.workId !== root.id || reviewed.source_conversation !== c.actor.conversationId || authority.workId !== root.id || authority.conversationId !== c.actor.conversationId || !rootView?.data || rootView.work !== root.id || rootView.resource !== 'RUNNING' || parse(rootView.data).runId !== c.actor.runId || parse(rootView.data).continuationAuthorized)
                throw Error('Native integration reauthorization requires a current coordinator under the same original owner root');
            if (alias.work !== old.work || alias.target !== data.conversationId || alias.source_conversation !== c.actor.conversationId || adata.operation !== 'effect-prepare' || adata.effectOperationId !== id || adata.reviewedAssignmentId !== reviewed.id || adata.delegationRoot !== grant.root || dependencies.length !== 1 || !dependencies[0].data || dependencies[0].state !== 'CANCELLED' || dependencies[0].waiting !== alias.source_conversation || dependencies[0].target !== alias.target || view?.work !== old.work || this.h.interactions.getHandle(alias.target) || !Array.isArray(adata.reentries ?? []) || (adata.reentries ?? []).length >= 64)
                throw Error('Retained integration alias/dependency correspondence changed');
            if (c.evidence.workId !== old.work || c.evidence.epoch !== subject.epoch || !(c.evidence.epoch > (data.evidence?.epoch ?? Infinity)) || !(data.origin.workEpoch < root.epoch) || this.h.interactions.impacts(old.work).some(i => i.data.effectHold))
                throw Error('Recovered task requires current procedure evidence with every owner input accounted for');
            if (data.origin.identity?.workId !== root.id || adata.reviewedWorkId !== old.work || hash(parse(dependencies[0].data).source) !== hash(adata.source))
                throw Error('Retained integration alias/dependency correspondence changed');
            this.assertTargetTransmissionClear(old.target, id);
            if (receipts.count >= 256)
                throw Error('Original receipt history reached its bounded limit');
            return { raw, old, alias, dependency: dependencies[0], grant, receipts, recoverySourceId: rdata.authorityRecovery.sourceId as string, cancellationSourceId: adata.cancellationSource as string, adata };
        };
        return this.s.tx(() => {
            const ctx = inspect(), origin = this.sourceToken(c.actor), ownerRoot = this.ownerToken(ctx.grant.root);
            const event = { version: 1, actor: c.actor, cancellationSourceId: ctx.cancellationSourceId, recoverySourceId: ctx.recoverySourceId, previous: { operation: ctx.raw, alias: ctx.alias, dependency: ctx.dependency }, current: { grantEpoch: ctx.grant.epoch, rootEpoch: ctx.grant.data.rootEpoch, evidence: c.evidence, origin, ownerRoot } }, rawEvent = JSON.stringify(event);
            if (Buffer.byteLength(rawEvent) > 1048576 || ctx.receipts.bytes + Buffer.byteLength(rawEvent) > 2097152)
                throw Error('Original reauthorization receipt exceeds the bounded inspection profile');
            const receiptId = this.receipt(id, 'agent-reauthorization', event), old = ctx.old.data;
            // Rebuild from an allowlist: stale projection and authority remain only in the immutable receipt.
            const data = { kind: old.kind ?? 'local-git', evidence: c.evidence, grantEpoch: ctx.grant.epoch, rootEpoch: ctx.grant.data.rootEpoch, blocked: [], nextAction: 'Explicitly prepare this original integration; reauthorization never establishes send eligibility', origin, ownerRoot, reviewedAssignmentId: old.reviewedAssignmentId, assignmentId: old.assignmentId, conversationId: old.conversationId, ...Object.hasOwn(old, 'clientRoot') ? { clientRoot: old.clientRoot } : {}, ...Object.hasOwn(old, 'clientInitialized') ? { clientInitialized: old.clientInitialized } : {} };
            this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', 'PREPARED', JSON.stringify(data), id);
            this.validate(id);
            this.assertPreparationGrant({ workId: ctx.old.work, targetId: ctx.old.target, operationId: id });
            const updated = JSON.stringify({ ...ctx.adata, reentries: [...(ctx.adata.reentries ?? []), { source: c.actor, reauthorization: receiptId }] });
            if (Buffer.byteLength(updated) > 65536)
                throw Error('Original integration assignment exceeds the bounded reentry profile');
            this.s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?', 'QUEUED', updated, ctx.alias.id);
            this.s.run('UPDATE conversation_dependencies SET state=? WHERE id=?', 'PENDING', ctx.dependency.id);
            this.s.run('UPDATE conversation_state SET resource=? WHERE conversation=?', 'QUEUED', ctx.alias.target);
            if (!this.inspectRetained(id).view)
                throw Error('Reauthorized original cannot retain bounded historical correspondence');
            return { operationId: id, assignmentId: ctx.alias.id as string, conversationId: ctx.alias.target as string, state: 'QUEUED' as const, reauthorized: true, receiptId };
        });
    }
    private ownerToken(root: string) {
        const w = this.work(root), cid = parse(w.data).conversation;
        return { workId: root, epoch: w.epoch, source: w.source, conversationId: cid ?? null, direction: cid ? this.h.interactions.inspect(cid).directionRevision : null, chain: hash(this.h.interactions.impacts(root).map(i => ({ id: i.input_id, source: i.source, revision: i.revision, text: i.text }))), ...this.contextToken(root) };
    }
    operationWork(assignmentId: string) {
        const assignment = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!assignment || assignment.state === 'CANCELLED' || parse(assignment.data).operation !== 'effect-prepare')
            throw Error('Retained integration assignment required');
        const op = this.op(parse(assignment.data).effectOperationId);
        if (assignment.work !== op.work || op.data.assignmentId !== assignment.id || op.data.conversationId !== assignment.target)
            throw Error('Integration subject assignment binding changed');
        return op.work as string;
    }
    async runQueued(assignmentId: string, operation: ChangeOperation) {
        operation = this.h.changes.captureModelOperation(operation);
        if (this.operationWork(assignmentId) !== operation.workId)
            throw Error('Integration model operation subject changed');
        const assignment = this.s.one('SELECT * FROM conversation_assignments WHERE id=?', assignmentId);
        if (!assignment || assignment.state === 'CANCELLED')
            throw Error('Integration task cancelled before admission');
        const data = parse(assignment.data);
        if (data.operation !== 'effect-prepare')
            throw Error('Not a retained integration task');
        this.s.run('UPDATE conversation_assignments SET state=? WHERE id=?', 'RUNNING', assignmentId);
        const op = this.op(data.effectOperationId);
        this.inheritOwnerSources(op);
        this.validateOrigin(this.op(op.id));
        const prepared = await this.prepare({ ...operation, targetId: op.target, operationId: op.id });
        if (this.s.one('SELECT state FROM conversation_assignments WHERE id=?', assignmentId).state === 'CANCELLED')
            throw Error('Integration task cancelled');
        return prepared.phase === 'RESERVED' ? this.dispatch({ operationId: op.id }) : prepared;
    }
    scopedInspect(operationId: string, identity: NativeIdentity, entry: () => void) {
        entry();
        const op = this.op(operationId), grant = this.grant(op.work, op.target, op.grant_id);
        if (!this.ancestry(identity.workId).includes(grant.root))
            throw Error('Operation outside captured root grant');
        return this.inspect(operationId);
    }
    async scopedReconcile(operationId: string, identity: NativeIdentity, entry: () => void) {
        this.scopedInspect(operationId, identity, entry);
        return this.reconcile({ operationId });
    }
    private refreshSourceFit(op: any) {
        if (!op.data.origin)
            return;
        try {
            this.validateOrigin(op);
            return;
        }
        catch {
        }
        const old = op.data.origin, root = this.work(old.identity.workId), rootSnapshot = op.data.ownerRoot;
        if (root.epoch !== old.workEpoch || root.source !== old.rootSource || rootSnapshot && this.work(rootSnapshot.workId).epoch !== rootSnapshot.epoch)
            throw Error('Cancellation/root authority cannot be refreshed by source-fit');
        const sources = this.newerOwnerSources(op);
        if (!sources.length)
            throw Error('Changed source lacks actual owner direction');
        const impacts = this.h.interactions.impacts(op.work);
        const proofs = sources.map(source => {
            const inputId = parse(source.data).inputId;
            const proof = impacts.find(i => {
                const origin = this.s.one('SELECT origin FROM sources WHERE id=?', i.source), actor = parse(origin.origin).actor, decision = i.data.decision, producer = decision ? this.s.one('SELECT * FROM role_launches WHERE id=?', decision.launch) : null;
                const inherited = this.s.one('SELECT data FROM conversation_inputs WHERE id=?', i.input_id), link = inherited ? parse(inherited.data) : {};
                return ((actor?.workId === old.identity.workId && actor.initialInputId === inputId) || (i.data.inherited && i.source === source.source && link.inheritedOwnerSource === source.source && link.parentInputId === inputId)) && !i.data.effectHold && producer?.role === 'adjudicator' && producer.status === 'COMPLETE' && ['explanation', 'scope-change'].includes(decision.impact);
            });
            if (!proof)
                throw Error('Every changed parent/root owner source needs actual same-child independently consumed source-fit/replan');
            return { sourceId: source.source, parentConversation: source.conversation, parentRevision: source.revision, childInput: proof.input_id, decision: proof.data.decision };
        });
        this.h.changes.assertCurrentEvidence(op.data.evidence);
        const live = this.h.interactions.getHandle(old.identity.conversationId), renewalIdentity = live && live.identity.workId === root.id ? live.identity : old.identity;
        const renewed = this.sourceToken(renewalIdentity);
        this.receipt(op.id, 'source-fit-reentry', { previous: old, current: renewed, sourceProofs: proofs });
        this.patch(op.id, op.phase, { origin: renewed, ownerRoot: rootSnapshot ? this.ownerToken(rootSnapshot.workId) : null });
    }
    private validate(id: string, checkEvidence = true, renewal = false) {
        const op = this.op(id);
        const grant = this.grant(op.work, op.target, op.grant_id);
        if (grant.epoch !== op.data.grantEpoch)
            throw Error('Delegation epoch changed');
        this.validateOrigin(op);
        if (!renewal && op.data.kind === 'github-existing-ref' && op.data.authority && op.data.authority.credentialSessionId !== this.hostedSession?.identity)
            throw Error('Hosted credential session changed; fresh action observation required');
        if (checkEvidence)
            this.h.changes.assertCurrentEvidence(op.data.evidence);
        return op;
    }
    private nativeRun<T>(id: string, kind: string, signal: AbortSignal | undefined, body: (client: EffectGitClient, signal: AbortSignal, runId: string, capturedSession: HostedIntegrationSession | undefined) => Promise<T>, isolatedObservation = false, readProfile?: EffectsProfile, retainedRead = false): Promise<T> {
        const task = this.nativeRunInner(id, kind, signal, body, isolatedObservation, readProfile, retainedRead);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async nativeRunInner<T>(id: string, kind: string, signal: AbortSignal | undefined, body: (client: EffectGitClient, signal: AbortSignal, runId: string, capturedSession: HostedIntegrationSession | undefined) => Promise<T>, isolatedObservation = false, readProfile?: EffectsProfile, retainedRead = false): Promise<T> {
        const op = this.op(id), w = this.work(op.work);
        this.h.assertOpen();
        if (this.h.busy(w.id))
            throw Error('Effect work busy');
        if (w.state === 'CANCELLED' || w.state === 'UNKNOWN' && !isolatedObservation || w.state === 'INTERRUPTED' && kind !== 'reconcile')
            throw Error('Effect work unavailable');
        const original = isolatedObservation ? this.s.all("SELECT * FROM runs WHERE work=? AND phase='UNKNOWN'", w.id).find(row => { const d = parse(row.data); return d.kind === 'native-effect' && d.readOnlyObservation !== true && d.retainedIntegrationRead !== true && d.operationId === id && d.cleanup === 'quarantined' && row.staging === op.data.clientRoot && this.s.one("SELECT id FROM capacity_leases WHERE run=? AND state='QUARANTINED'", row.id); }) : null;
        const originalLeases = original ? this.s.all("SELECT id FROM capacity_leases WHERE run=? AND state='QUARANTINED'", original.id) : [];
        if (isolatedObservation && (!original || originalLeases.length !== 1 || parse(original.data).capacityId !== originalLeases[0]?.id || op.data.kind !== 'github-existing-ref' || op.phase !== 'UNKNOWN' || w.state !== 'UNKNOWN'))
            throw Error('Exact original hosted quarantine provenance required');
        if (isolatedObservation && !this.h.capacity.observationRoom())
            throw Error('Read-only observation unavailable: capacity occupied or prior queue pending; original quarantine retained, zero admission');
        const capturedSession = op.data.kind === 'github-existing-ref' ? this.hostedSession : undefined;
        if (op.data.kind === 'github-existing-ref')
            this.assertHostedCapture(capturedSession);
        const runId = randomUUID(), clientRoot = retainedRead ? path.join(this.h.options.installationHome, 'effects', id, 'observations', runId) : isolatedObservation ? path.join(path.dirname(op.data.clientRoot), 'observations', runId) : op.data.clientRoot ?? path.join(this.h.options.installationHome, 'effects', id, 'client');
        this.s.tx(() => {
            const b = this.s.one('SELECT * FROM budgets WHERE lineage=? AND kind=?', w.lineage, 'execution');
            if (b.consumed + b.reserved >= b.lim)
                throw Error('Retained execution allowance exhausted');
            this.s.run('UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind=?', w.lineage, 'execution');
            if (!isolatedObservation && !retainedRead)
                this.s.run('UPDATE works SET state=? WHERE id=?', 'ACTIVE', w.id);
            this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, w.id, w.epoch, w.generation, 'CREATED', clientRoot, 'reserved', JSON.stringify({ kind: 'native-effect', operationId: id, clientRoot, controllerPid: process.pid, ...(retainedRead ? { retainedIntegrationRead: true, readPhase: 'reconcile', generation: w.generation, originalWorkState: w.state } : {}), ...(isolatedObservation ? { readOnlyObservation: true, originalRunId: original!.id, generation: w.generation } : {}) }));
            if (!isolatedObservation && !retainedRead)
                this.patch(id, op.phase, { clientRoot });
        });
        const abort = new AbortController(), stop = () => abort.abort(signal?.reason);
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted)
            stop();
        const handle = { abort, ...retainedRead ? { retainedIntegrationRead: true as const } : {} };
        this.h.register(w.id, handle);
        this.activeNative.set(id, abort);
        let client: EffectGitClient | undefined, lease: Awaited<ReturnType<Capacity['acquire']>> | undefined, cleanup = 'not-allocated', factoryUnallocated = false;
        try {
            lease = await this.h.capacity.acquire({ workId: w.id, runId, epoch: w.epoch, kind: 'check', signal: abort.signal });
            try {
                client = await this.client(clientRoot, isolatedObservation || retainedRead ? false : !!op.data.clientInitialized, op.data.kind === 'github-existing-ref', capturedSession, readProfile, abort.signal);
            }
            catch (error) {
                // A fresh absent scope plus an affirmative factory outcome is not a missing cleanup journal.
                if (error instanceof NativeGitNotAllocatedError && error.clientRoot === clientRoot && (isolatedObservation || retainedRead || op.data.clientRoot === undefined && (op.data.clientInitialized === undefined || op.data.clientInitialized === false))) {
                    try {
                        await fs.lstat(clientRoot);
                    }
                    catch (missing) {
                        if ((missing as NodeJS.ErrnoException).code === 'ENOENT')
                            factoryUnallocated = true;
                    }
                }
                throw error;
            }
            abort.signal.throwIfAborted();
            if (!isolatedObservation && !retainedRead)
                this.patch(id, this.op(id).phase, { clientInitialized: true });
            this.h.patchRun(runId, 'RUNNING', { nativeClientInitialized: true });
            if (capturedSession)
                this.assertHostedCapture(capturedSession, client);
            const result = await body(client, abort.signal, runId, capturedSession);
            if (capturedSession)
                this.assertHostedCapture(capturedSession, client);
            abort.signal.throwIfAborted();
            if (this.work(w.id).epoch !== w.epoch)
                throw Error('Effect epoch changed');
            return result;
        }
        finally {
            try {
                if (client) {
                    await client.close();
                    cleanup = 'removed';
                }
                else if (factoryUnallocated) {
                    this.receipt(id, 'factory-failure-cleanup', { clientRoot, cleanup: 'not-allocated', reason: 'Fresh absent client; factory constructed no owner or command' });
                    cleanup = 'not-allocated';
                }
                else if (!lease && parse(this.s.one('SELECT data FROM runs WHERE id=?', runId).data).admission === 'never-admitted' &&
                    await this.nativeClientNotAllocated(parse(this.s.one('SELECT data FROM runs WHERE id=?', runId).data), clientRoot)) {
                    cleanup = 'not-allocated';
                }
                else {
                    const { reconcileOwnedGitProcesses } = await import('../effects/native-git.js');
                    const proof = await reconcileOwnedGitProcesses(clientRoot);
                    this.receipt(id, 'factory-failure-cleanup', proof);
                    if (proof.cleanup !== 'confirmed')
                        throw Error('Factory-owned process cleanup unknown');
                    cleanup = 'removed';
                }
            }
            catch {
                cleanup = 'quarantined';
            }
            this.s.tx(() => {
                this.h.settleBudget(runId);
                this.h.patchRun(runId, cleanup === 'quarantined' ? 'UNKNOWN' : 'SETTLED', { cleanup });
                if (!isolatedObservation && cleanup === 'quarantined')
                    this.s.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', w.id);
                else if (!isolatedObservation && !retainedRead && this.work(w.id).epoch === w.epoch && this.work(w.id).state === 'ACTIVE' && this.s.one('SELECT phase FROM change_state WHERE work=?', w.id).phase === 'REVIEW_READY')
                    this.s.run('UPDATE works SET state=? WHERE id=?', 'DELIVERED', w.id);
            });
            lease?.release({ cleanup, settled: true });
            this.activeNative.delete(id);
            this.h.unregister(w.id);
            signal?.removeEventListener('abort', stop);
        }
    }
    private projectionTargetFingerprint(target: {
        id: string;
        project: string;
        data: any;
    }): string {
        return hash({ targetId: target.id, project: target.project, kind: target.data.kind, target: target.data.target,
            repository: target.data.repository ?? null, basisCommit: target.data.basisCommit,
            publicationInventory: target.data.publicationInventory, authorizedDeltaPaths: target.data.authorizedDeltaPaths });
    }
    private projectionContinuation(id: string, target: ReturnType<Effects['target']>, evidence: CurrentEvidence) {
        const seen = new Set<string>();
        let key: string | null = evidence.versions.candidate;
        while (key && key !== evidence.versions.base) {
            if (seen.has(key))
                throw Error('Derived candidate predecessor cycle');
            seen.add(key);
            const row = this.s.one('SELECT * FROM change_versions WHERE id=? AND work=?', key, evidence.workId);
            if (!row || row.kind !== 'candidate')
                throw Error('Current candidate predecessor provenance unavailable');
            const data = parse(row.data);
            if (data.derived) {
                if (data.producer !== id)
                    throw Error('Derived candidate belongs to another operation; fresh scoped derivation required');
                const native = data.native;
                if (!native?.baseVersion || !native.targetId || !native.targetFingerprint)
                    throw Error('Derived continuation checkpoint unavailable: legacy base/target binding missing');
                if (native.baseVersion !== evidence.versions.base)
                    throw Error('Derived continuation original base version changed');
                if (native.targetId !== target.id || native.targetFingerprint !== this.projectionTargetFingerprint(target) || native.basisCommit !== target.data.basisCommit)
                    throw Error('Derived continuation target/inventory binding changed');
                const receipt = this.s.one("SELECT data FROM effect_receipts WHERE id=? AND operation=? AND kind='integration'", native.receiptId, id);
                const integration = receipt ? parse(receipt.data) : null;
                if (integration?.kind !== 'candidate' || integration.commit !== native.integrationCommit || integration.head !== native.headCommit || integration.tree !== native.tree || !Array.isArray(integration.files) || !integration.expectedBase)
                    throw Error('Derived continuation exact native integration receipt unavailable');
                return { version: { ...row, data }, integration };
            }
            key = row.predecessor;
        }
        return null;
    }
    private assertDerivedTree(manifest: any, files: readonly any[]): void {
        const normalize = (items: readonly any[], captured: boolean) => items.map(file => ({ path: file.path, sha256: file.sha256, executable: captured ? !!(file.effectiveMode & 0o111) : file.mode === '100755' })).sort((a, b) => a.path.localeCompare(b.path));
        if (!Array.isArray(files) || files.some(file => typeof file.path !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256) || !['100644', '100755'].includes(file.mode)))
            throw Error('Derived continuation native file receipt malformed');
        if (manifest?.dependencyLinks?.length || !Array.isArray(manifest?.files) || hash(normalize(manifest.files, true)) !== hash(normalize(files, false)))
            throw Error('Derived continuation manifest/native I tree differ');
    }
    firstPreparationContext(workId: string, targetId: string) { return integrationStart(this.s, workId, targetId, this.h.busy(workId) || this.hasActiveWork(workId), this.h.options.effectsProfile); }
    prepareFirst(options: PrepareIntegration & {
        expectedContext: string;
        gitProfile?: EffectsProfile;
    }, validate?: () => void, onAllocated?: (operationId: string) => void) {
        const task = this.prepareFirstInner(options, validate, onAllocated);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async prepareFirstInner(options: PrepareIntegration & {
        expectedContext: string;
        gitProfile?: EffectsProfile;
    }, validate?: () => void, onAllocated?: (operationId: string) => void) {
        this.h.assertInteractionAdmission();
        if (Object.hasOwn(options, 'operationId'))
            throw Error('First preparation cannot replace an original operation');
        const input = { ...options, ...options.gitProfile ? { gitProfile: structuredClone(options.gitProfile) } : {}, signal: AbortSignal.any([this.firstPreparationAbort.signal, ...options.signal ? [options.signal] : []]) };
        const captured = this.h.changes.captureModelOperation(input), modelIdentity = captured.model ? hash(modelConfigurationIdentity(captured.model)) : undefined;
        const modelCurrent = () => {
            if (captured.model && hash(modelConfigurationIdentity(captured.model)) !== modelIdentity)
                throw Error('First integration explicit model recipe changed during preparation');
            this.h.changes.captureModelOperation(captured);
        };
        const current = () => {
            modelCurrent();
            this.h.assertOpen();
            input.signal.throwIfAborted();
            validate?.();
            const context = this.firstPreparationContext(input.workId, input.targetId);
            if (context.contextFingerprint !== input.expectedContext)
                throw Error('First integration preparation context changed; inspect the original work and target');
            if (context.holds.length)
                throw Error(context.holds.join('; '));
            return context;
        };
        const expected = current(), hosted = expected.delegation.target.state === 'RETAINED' && expected.delegation.target.family === 'github-existing-ref', session = hosted ? this.hostedSession : undefined, profile = Object.freeze(await this.trustedProfile(input.gitProfile ?? this.h.options.effectsProfile));
        current();
        if (hosted)
            this.assertHostedCapture(session);
        const evidence = await this.h.changes.currentEvidence(input.workId);
        current();
        if (hosted)
            this.assertHostedCapture(session);
        const scope = (value: ReturnType<typeof integrationSendReview>['reviewed']) => ({ operationId: value.operationId, work: value.work, targetId: value.targetId, targetProjectId: value.targetProjectId, target: value.target, grant: value.grant, ownerRoot: value.ownerRoot });
        let allocated: string | undefined, fingerprint: string | undefined;
        const guard = () => {
            this.h.assertOpen();
            input.signal.throwIfAborted();
            validate?.();
            if (allocated && hash(scope(integrationSendReview(this.s, allocated, true).reviewed)) !== fingerprint)
                throw Error('Original first integration authority/source changed');
            modelCurrent();
        };
        try {
            return await this.prepare(captured, { profile, evidence, guard, beforeAllocate: () => { current(); guard(); }, allocated: id => { allocated = id; fingerprint = hash(scope(integrationSendReview(this.s, id, true).reviewed)); onAllocated?.(id); } });
        }
        catch (error) {
            if (allocated)
                throw new ControllerError('INTEGRATION_PREPARATION_FAILED', 'Original integration ' + allocated + ' retained after first preparation failure', 'Inspect original integration ' + allocated + ' for work ' + input.workId + '; do not allocate a replacement', input.workId);
            throw error;
        }
    }
    preparationContext(id: string) {
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded integration unavailable');
        const original = integrationSendReview(this.s, id, true), context = integrationReadContext(this.s, id, this.h.busy(retained.view.workId) || this.activeNative.has(id) || this.drivers.has(retained.view.workId), this.h.capacity.observationRoom(), this.h.options.effectsProfile, true), change = this.s.one('SELECT phase,base,candidate,plan,verification,epoch FROM change_state WHERE work=? AND length(CAST(phase AS BLOB))<=128 AND (base IS NULL OR length(CAST(base AS BLOB))<=4096) AND (candidate IS NULL OR length(CAST(candidate AS BLOB))<=4096) AND (plan IS NULL OR length(CAST(plan AS BLOB))<=4096) AND (verification IS NULL OR length(CAST(verification AS BLOB))<=4096)', retained.view.workId), resolution = this.s.one('SELECT lim AS "limit",consumed,reserved FROM budgets WHERE lineage=? AND kind=?', context.lineage, 'resolution');
        if (!change || !resolution || ![resolution.limit, resolution.consumed, resolution.reserved].every(n => Number.isSafeInteger(n) && n >= 0) || resolution.consumed + resolution.reserved > resolution.limit)
            throw Error('Original bounded preparation state unavailable');
        const current = { recordedPhase: change.phase, candidateVersion: change.candidate, baseVersion: change.base, planVersion: change.plan, verificationVersion: change.verification, epoch: change.epoch, execution: context.execution, resolution };
        return { ...original, context: { ...context, mode: 'original-preparation' }, current, contextFingerprint: hash({ original, context, current }) };
    }
    prepareRetained(options: PrepareIntegration & {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
    }, validate?: () => void) {
        const task = this.prepareRetainedInner(options, validate);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async prepareRetainedInner(options: PrepareIntegration & {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
    }, validate?: () => void) {
        this.h.assertInteractionAdmission();
        const input = { ...options, ...options.gitProfile ? { gitProfile: structuredClone(options.gitProfile) } : {} };
        const current = () => {
            this.h.assertOpen();
            input.signal?.throwIfAborted();
            validate?.();
            const context = this.preparationContext(input.operationId);
            if (context.reviewed.work.id !== input.workId || context.reviewed.targetId !== input.targetId || context.contextFingerprint !== input.expectedContext)
                throw Error('Original integration preparation context changed; reopen its review');
            if (context.context.holds.length)
                throw Error(context.context.holds.join('; '));
            this.assertPreparationGrant(input);
            if (context.context.execution.consumed + context.context.execution.reserved >= context.context.execution.limit)
                throw Error('Original integration execution allowance exhausted');
            return context;
        };
        const expected = current(), hosted = expected.context.family === 'github-existing-ref', session = hosted ? this.hostedSession : undefined, profile = Object.freeze(await this.trustedProfile(input.gitProfile ?? this.h.options.effectsProfile));
        current();
        if (hosted)
            this.assertHostedCapture(session);
        const captured = this.h.changes.captureModelOperation(input), evidence = await this.h.changes.currentEvidence(input.workId);
        current();
        if (hosted)
            this.assertHostedCapture(session);
        const scope = (value: ReturnType<typeof integrationSendReview>['reviewed']) => ({ operationId: value.operationId, work: value.work, targetId: value.targetId, targetProjectId: value.targetProjectId, target: value.target, grant: value.grant, ownerRoot: value.ownerRoot });
        const fingerprint = hash(scope(expected.reviewed)), guard = () => {
            this.h.assertOpen();
            input.signal?.throwIfAborted();
            validate?.();
            if (hash(scope(integrationSendReview(this.s, input.operationId, true).reviewed)) !== fingerprint)
                throw Error('Reviewed integration preparation authority/source changed');
            this.h.changes.captureModelOperation(captured);
        };
        guard();
        return this.prepare(captured, { profile, evidence, guard });
    }
    prepare(options: PrepareIntegration, reviewed?: {
        profile: EffectsProfile;
        evidence: CurrentEvidence;
        guard: () => void;
        beforeAllocate?: () => void;
        allocated?: (id: string) => void;
    }): Promise<EffectView> {
        options = this.h.changes.captureModelOperation(options);
        this.h.assertOpen();
        if (!reviewed && !this.h.options.effectsProfile)
            throw Error('Explicit trusted effectsProfile.gitBinary prerequisite unavailable');
        if (this.drivers.has(options.workId))
            return Promise.reject(Error('Effect preparation already active'));
        const abort = new AbortController();
        const stop = () => abort.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', stop, { once: true });
        if (options.signal?.aborted)
            stop();
        const task = this.prepareInner({ ...options, signal: abort.signal }, reviewed).finally(() => {
            this.drivers.delete(options.workId);
            options.signal?.removeEventListener('abort', stop);
        });
        this.drivers.set(options.workId, { abort, done: task });
        return task;
    }
    reauthorizationContext(id: string) {
        this.h.assertOpen();
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded integration unavailable');
        const preparation = this.preparationContext(id), previous = this.s.one('SELECT id,work,target,grant_id,phase,CASE WHEN length(CAST(data AS BLOB))<=1048576 THEN data ELSE NULL END AS data FROM effect_operations WHERE id=?', id), data = parse(previous.data), delegation = integrationDelegation(this.s, previous.work, previous.target, this.h.busy(previous.work) || this.hasActiveWork(previous.work)), holds = [...preparation.context.holds, ...delegation.holds];
        const grant = preparation.reviewed.grant, history = integrationGrantHistory(this.s, { ...grant, data: JSON.stringify(grant.data) });
        if (!history.events || !Number.isSafeInteger(data.grantEpoch) || data.grantEpoch >= grant.epoch || !history.epochs.some(epoch => epoch.grantEpoch === data.grantEpoch && epoch.rootEpoch === data.rootEpoch))
            holds.push('An older captured grant epoch and its retained renewal correspondence are required');
        if (grant.root !== previous.work || grant.data.scope !== 'work' || grant.data.mode !== 'ordinary')
            holds.push('Reauthorization currently supports ordinary independent owner work only');
        if (['origin', 'ownerRoot', 'assignmentId', 'conversationId', 'reviewedAssignmentId', 'subjectContextFingerprint'].some(key => Object.hasOwn(data, key)))
            holds.push('Native-origin, assignment or inherited authority cannot be reauthorized through the owner-original route');
        if (Object.hasOwn(data, 'clientInitialized') && typeof data.clientInitialized !== 'boolean' || Object.hasOwn(data, 'clientRoot') && (typeof data.clientRoot !== 'string' || !path.isAbsolute(data.clientRoot) || !inside(path.join(this.h.options.installationHome, 'effects', id), data.clientRoot)) || data.clientInitialized === true && !data.clientRoot)
            holds.push('Original native client identity is unavailable; keep its exact original artifacts');
        if (Object.hasOwn(data, 'confirmed') || this.s.one("SELECT id FROM effect_receipts WHERE operation=? AND kind IN ('readback','reconciliation') LIMIT 1", id))
            holds.push('Historical transport observations cannot be migrated as definitely-unsent work');
        const transmission = this.targetTransmissionHold(previous.target, id);
        if (transmission)
            holds.push(transmission);
        const receipts = this.s.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM effect_receipts WHERE operation=?', id);
        if (receipts.count >= 256)
            holds.push('Original receipt history reached its bounded limit');
        const context = { operationId: id, workId: previous.work, targetId: previous.target, previous: { ...previous, data }, delegation, preparation, history, receipts, holds, eligible: holds.length === 0 };
        return { ...context, fingerprint: hash(context) };
    }
    reauthorizeOwner(input: {
        operationId: string;
        expectedContext: string;
        reason: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        const task = this.reauthorizeOwnerInner({ ...input }, validate);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async reauthorizeOwnerInner(input: {
        operationId: string;
        expectedContext: string;
        reason: string;
        signal?: AbortSignal;
    }, validate: () => unknown) {
        if (typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 4096)
            throw Error('A bounded owner reauthorization reason of1..4096 bytes is required');
        const current = () => {
            this.h.assertOwnerConfigurationAdmission();
            input.signal?.throwIfAborted();
            if (validate() !== undefined)
                throw Error('Synchronous owner reauthorization validation required');
            const context = this.reauthorizationContext(input.operationId);
            if (!context.eligible || context.fingerprint !== input.expectedContext)
                throw Error('Original integration reauthorization context changed or is held; inspect it before another action');
            return context;
        };
        const captured = current(), evidence = await this.h.changes.currentEvidence(captured.workId);
        current();
        this.h.changes.assertCurrentEvidence(evidence);
        if (evidence.workId !== captured.workId || evidence.epoch !== captured.delegation.workEpoch || evidence.versions.candidate !== captured.preparation.current.candidateVersion)
            throw Error('Current procedure does not cover the reviewed original work/candidate');
        return this.s.tx(() => {
            const context = current();
            this.h.changes.assertCurrentEvidence(evidence);
            const old = context.previous.data, grant = context.preparation.reviewed.grant;
            const event = { version: 1, origin: { kind: 'owner-integration-reauthorization', uid: process.getuid?.(), sourceId: context.delegation.sourceId }, reason: input.reason, previous: context.previous, current: { grantEpoch: grant.epoch, rootEpoch: grant.data.rootEpoch, evidence } }, raw = JSON.stringify(event);
            if (Buffer.byteLength(raw) > 1048576 || context.receipts.bytes + Buffer.byteLength(raw) > 2097152)
                throw Error('Original reauthorization receipt exceeds the bounded inspection profile');
            // Rebuild from an explicit allowlist: prior projection/authority stays
            // in its immutable receipt, and cannot remain live send eligibility.
            const data = { kind: old.kind ?? 'local-git', evidence, grantEpoch: grant.epoch, rootEpoch: grant.data.rootEpoch, blocked: [], nextAction: 'Explicitly prepare this original integration; reauthorization never establishes send eligibility', ...Object.hasOwn(old, 'clientRoot') ? { clientRoot: old.clientRoot } : {}, ...Object.hasOwn(old, 'clientInitialized') ? { clientInitialized: old.clientInitialized } : {} };
            const receiptId = this.receipt(input.operationId, 'owner-reauthorization', event);
            this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', 'PREPARED', JSON.stringify(data), input.operationId);
            if (!this.inspectRetained(input.operationId).view)
                throw Error('Reauthorized original cannot retain bounded historical correspondence');
            this.assertPreparationGrant({ workId: context.workId, targetId: context.targetId, operationId: input.operationId });
            return { operationId: input.operationId, receiptId, workId: context.workId, targetId: context.targetId, grantId: grant.id, grantEpoch: grant.epoch, phase: 'PREPARED' as const };
        });
    }
    private assertPreparationGrant(options: Pick<PrepareIntegration, 'workId' | 'targetId' | 'operationId'>) {
        if (!options.operationId)
            return;
        const original = this.op(options.operationId);
        if (original.work !== options.workId || original.target !== options.targetId)
            throw Error('Original integration work/target differs');
        const grant = this.grant(original.work, original.target, original.grant_id);
        if (grant.epoch !== original.data.grantEpoch)
            throw Error('Delegation epoch changed; explicit same-original reauthorization required before preparation');
    }
    private async prepareInner(options: PrepareIntegration, reviewed?: {
        profile: EffectsProfile;
        evidence: CurrentEvidence;
        guard: () => void;
        beforeAllocate?: () => void;
        allocated?: (id: string) => void;
    }) {
        let id = options.operationId;
        this.assertPreparationGrant(options);
        const evidence = reviewed?.evidence ?? await this.h.changes.currentEvidence(options.workId);
        reviewed?.guard();
        this.assertPreparationGrant(options);
        try {
            if (id) {
                const old = this.op(id);
                if (old.work !== options.workId || old.target !== options.targetId || ['UNKNOWN', 'INVOKING', 'CONFIRMED'].includes(old.phase))
                    throw Error('Operation cannot be blindly re-prepared');
                this.patch(id, old.phase, { evidence });
                this.refreshSourceFit(this.op(id));
                this.grant(old.work, old.target, old.grant_id);
            }
            else {
                id = this.allocate(options.workId, options.targetId, evidence, {}, undefined, reviewed?.beforeAllocate);
                reviewed?.allocated?.(id);
            }
            const target = this.target(options.targetId), t = target.data.target as LocalBareTarget;
            const derived = await this.nativeRun(id, 'projection', options.signal, async (client, signal, _runId, session) => {
                reviewed?.guard();
                const hosted = target.data.kind === 'github-existing-ref';
                if (!hosted) {
                    const registered = await client.registerLocalTarget({ targetId: t.targetId, path: t.canonicalPath, ref: t.ref }, signal);
                    if (hash(registered) !== hash(t))
                        throw Error('Target identity/authority changed');
                }
                const version = (key: string) => (this.h.changes as any).version(key), b = version(evidence.versions.base), c = version(evidence.versions.candidate);
                if (target.data.authorizedDeltaPaths.some((p: string) => !target.data.publicationInventory.includes(p)))
                    throw Error('Original authorized paths must remain within original publication inventory');
                const continuation = this.projectionContinuation(id!, target, evidence);
                const pinned = continuation?.integration.expectedBase ?? target.data.basisCommit;
                // Continuation is forward-only relative to the actual old remote B,
                // not merely the original K. This prevents replaying old remote facts.
                let basis: {
                    commit: string;
                    observedBase: string;
                };
                try {
                    basis = hosted ? await client.fetchHttpsPinnedBasis(target.data.target, pinned, signal) : await client.fetchLocalBasis(t, pinned, signal);
                }
                catch (error) {
                    if (continuation)
                        throw Error('Derived continuation prior-B ancestry/current observation unavailable; no send: ' + String(error));
                    throw error;
                }
                let head: string, receipt: string | null = null, effectiveDifferences: readonly {
                    path: string;
                    reason: string;
                }[];
                if (continuation) {
                    const d = continuation.version, prior = continuation.integration;
                    const actual = await client.buildIntegration({ operationId: id!, head: prior.commit, expectedBase: prior.expectedBase }, signal);
                    if (actual.kind !== 'candidate' || actual.commit !== prior.commit || actual.tree !== prior.tree || actual.head !== prior.commit)
                        throw Error('Derived continuation retained native I unavailable');
                    this.assertDerivedTree(d.data.manifest, prior.files);
                    this.assertDerivedTree(d.data.manifest, actual.files);
                    if (c.hash === d.hash) {
                        head = prior.commit;
                        effectiveDifferences = [];
                    }
                    else {
                        const inventory = [...new Set<string>([...target.data.publicationInventory, ...actual.files.map(file => file.path)])];
                        const projected = await client.project({ operationId: id!, base: { versionId: d.id, digest: d.hash, root: d.artifact, manifest: d.data.manifest }, candidate: { versionId: c.id, digest: c.hash, root: c.artifact, manifest: c.data.manifest }, basisCommit: prior.commit, publicationInventory: inventory, authorizedDeltaPaths: target.data.authorizedDeltaPaths }, signal);
                        receipt = this.receipt(id!, 'projection', projected);
                        if (projected.kind !== 'projected' && projected.kind !== 'no-change')
                            throw Error(projected.reason);
                        head = projected.kind === 'projected' ? projected.receipt.projectedCommit : prior.commit;
                        effectiveDifferences = projected.kind === 'projected' ? projected.receipt.effectiveDifferences : projected.effectiveDifferences;
                    }
                }
                else {
                    const projected = await client.project({ operationId: id!, base: { versionId: b.id, digest: b.hash, root: b.artifact, manifest: b.data.manifest }, candidate: { versionId: c.id, digest: c.hash, root: c.artifact, manifest: c.data.manifest }, basisCommit: basis.commit, publicationInventory: target.data.publicationInventory, authorizedDeltaPaths: target.data.authorizedDeltaPaths }, signal);
                    receipt = this.receipt(id!, 'projection', projected);
                    if (projected.kind === 'no-change')
                        return { noChange: true };
                    if (projected.kind !== 'projected')
                        throw Error(projected.reason);
                    head = projected.receipt.projectedCommit;
                    effectiveDifferences = projected.receipt.effectiveDifferences;
                }
                reviewed?.guard();
                this.patch(id!, 'REFRESHED', { headCommit: head, projectionReceipt: receipt });
                const observed = hosted ? await client.observeHttpsRef(target.data.target, signal) : await client.fetchLocalBasis(t, undefined, signal);
                if (observed.commit !== basis.observedBase)
                    throw Error('Publication base changed after checked ancestry; explicitly prepare same operation again');
                if (hosted) {
                    await client.fetchHttpsBasis(target.data.target, observed.commit, signal);
                    const authority = await session!.observe(target.data, this.grant(options.workId, target.id).data.mode, observed.commit, signal);
                    this.assertHostedCapture(session, client);
                    this.patch(id!, 'REFRESHED', { authority });
                }
                const integration = await client.buildIntegration({ operationId: id!, head, expectedBase: observed.commit }, signal);
                const ir = this.receipt(id!, 'integration', integration);
                if (integration.kind !== 'candidate')
                    throw Error(integration.reason);
                const materialized = await client.materializeVerifiedTree(integration.tree, path.join(this.h.options.installationHome, 'effects', id!, randomUUID()), signal);
                reviewed?.guard();
                this.patch(id!, 'REFRESHED', { expectedBase: observed.commit, integrationCommit: integration.commit, tree: integration.tree, projectionReceipt: receipt, integrationReceipt: ir });
                return { noChange: false, materialized, native: { baseVersion: evidence.versions.base, targetId: target.id, targetFingerprint: this.projectionTargetFingerprint(target), basisCommit: target.data.basisCommit, headCommit: head, integrationCommit: integration.commit, tree: integration.tree, receiptId: ir }, effectiveDifferences };
            }, false, reviewed?.profile);
            reviewed?.guard();
            if (derived.noChange)
                return this.patch(id, 'REFUSED', { blocked: ['No agent publication delta; no transport was dispatched'], nextAction: 'Local procedure remains useful; no integration action needed', noChange: true });
            const d = derived as Exclude<typeof derived, {
                noChange: true;
            }>;
            if (d.materialized!.digest !== evidence.candidateDigest) {
                await this.h.changes.adoptDerivedCandidate({ workId: options.workId, expectedEvidence: evidence, kind: 'publication-projection', artifact: d.materialized!.root, manifest: d.materialized!.manifest, digest: d.materialized!.digest, producerOperationId: id, predecessorCandidate: evidence.versions.candidate, native: d.native!, effectiveDifferences: d.effectiveDifferences!, publicationInventory: target.data.publicationInventory }, reviewed ? { validate: reviewed.guard, ...options.signal ? { signal: options.signal } : {} } : undefined);
                reviewed?.guard();
                const current = await this.h.changes.drive(this.h.changes.captureModelOperation(options));
                if (!current.reviewReady)
                    throw Error('Actual derived context procedure incomplete: ' + current.blocked.join('; '));
            }
            const current = await this.h.changes.currentEvidence(options.workId);
            if (current.candidateDigest !== d.materialized!.digest)
                throw Error('Derived checks/review selected a repaired candidate; explicitly prepare the same operation to bind its actual current bytes');
            reviewed?.guard();
            this.patch(id, 'RESERVED', { evidence: current, blocked: [], nextAction: 'dispatchIntegration' });
            this.validate(id);
            return this.inspect(id);
        }
        catch (error) {
            if (!id)
                throw error;
            this.inheritOwnerSources(this.op(id));
            const retained = this.op(id);
            // An in-flight send stays subject to its own settlement or restart reconciliation.
            if (retained.work !== options.workId || retained.target !== options.targetId || retained.phase === 'INVOKING')
                throw error;
            if (retained.phase === 'CONFIRMED')
                return this.inspect(id);
            return this.patch(id, retained.phase === 'UNKNOWN' ? 'UNKNOWN' : 'REFUSED', { blocked: [String(error)], nextAction: 'Restore exact prerequisite and explicitly prepare same operation; retained findings/budget remain' });
        }
    }
    private canRenew(op: ReturnType<Effects['op']>): boolean {
        if (!this.hostedSession?.normal || op.data.kind !== 'github-existing-ref' || op.phase !== 'RESERVED')
            return false;
        if (op.data.dispatchRun != null) {
            const row = this.s.one("SELECT data FROM effect_receipts WHERE operation=? AND kind='send' ORDER BY rowid DESC LIMIT 1", op.id);
            const send = row ? parse(row.data) : null;
            if (!send || !(send.handoff === 'not-started' || send.transport === 'native-rejection'))
                throw Error('Unresolved possible transmission forbids authority renewal');
        }
        if (op.data.authority?.fixtureProfile !== 'public-personal-owner/v1' || op.data.authority?.action !== 'existing-ref-forward' || op.data.authority?.fingerprintVersion !== 'hosted-authority-fingerprint/v1' || op.data.authority?.policy?.normalVisibility?.profile !== 'public-personal-owner-no-classic/v1')
            throw Error('Explicit same-operation preparation required for authority profile/version');
        return true;
    }
    private targetTransmissionHold(target: string, except: string | null) {
        const other = integrationTransmissionHolds(this.s, target, except, 1)[0];
        return other ? 'Original integration ' + other.id + ' on registered target ' + other.target + ' has unresolved or unavailable receiver transmission; inspect/reconcile that original before sending' : undefined;
    }
    private assertTargetTransmissionClear(target: string, except: string | null) {
        const hold = this.targetTransmissionHold(target, except);
        if (hold)
            throw Error(hold);
    }
    dispatchContext(id: string) {
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded integration unavailable');
        const send = integrationSendReview(this.s, id), context = integrationReadContext(this.s, id, this.h.busy(retained.view.workId) || this.activeNative.has(id) || this.drivers.has(retained.view.workId), this.h.capacity.observationRoom(), this.h.options.effectsProfile);
        const hold = this.targetTransmissionHold(send.reviewed.targetId, id);
        if (hold)
            context.holds.push(hold);
        const { mode, originalQuarantinedRun, originalQuarantinedCapacity, fingerprint: ignored, ...admission } = context;
        return { ...send, context: { ...admission, mode: 'original-conditional-send' }, contextFingerprint: hash({ send: send.fingerprint, admission }) };
    }
    dispatchRetained(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) {
        const task = this.dispatchRetainedInner(options, validate);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async dispatchRetainedInner(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) {
        this.h.assertInteractionAdmission();
        const input = { ...options, ...options.gitProfile ? { gitProfile: structuredClone(options.gitProfile) } : {} };
        const current = () => {
            this.h.assertOpen();
            input.signal?.throwIfAborted();
            validate?.();
            const context = this.dispatchContext(input.operationId);
            if (context.contextFingerprint !== input.expectedContext)
                throw Error('Original integration send context changed; reopen its review');
            if (context.context.holds.length)
                throw Error(context.context.holds.join('; '));
            if (context.context.execution.consumed + context.context.execution.reserved >= context.context.execution.limit)
                throw Error('Original integration execution allowance exhausted; recover its original allowance');
            return context;
        };
        const expected = current(), hosted = expected.context.family === 'github-existing-ref', session = hosted ? this.hostedSession : undefined, profile = Object.freeze(await this.trustedProfile(input.gitProfile ?? this.h.options.effectsProfile));
        current();
        if (hosted)
            this.assertHostedCapture(session);
        const guard = () => {
            input.signal?.throwIfAborted();
            validate?.();
            if (integrationSendReview(this.s, input.operationId).fingerprint !== expected.fingerprint)
                throw Error('Reviewed integration operands changed during native preflight; no send');
        };
        return this.dispatch({ operationId: input.operationId, ...input.signal ? { signal: input.signal } : {} }, { profile, guard });
    }
    async dispatch(options: {
        operationId: string;
        signal?: AbortSignal;
    }, reviewed?: {
        profile: EffectsProfile;
        guard: () => void;
    }) {
        const id = options.operationId;
        try {
            const renew = this.canRenew(this.op(id));
            const op = this.validate(id, true, renew);
            if (op.phase !== 'RESERVED')
                throw Error('Prepared current operation required');
            this.assertTargetTransmissionClear(op.target, id);
            return await this.nativeRun(id, 'dispatch', options.signal, async (client, signal, _runId, session) => {
                const current = this.validate(id, true, renew), snapshot = hash(current), targetSnapshot = hash(this.target(current.target)), grantSnapshot = hash(this.grant(current.work, current.target, current.grant_id)), rootSnapshot = hash(this.work(this.grant(current.work, current.target, current.grant_id).root)), forward: ForwardSend = { operationId: id, target: this.target(current.target).data.target, expectedBase: current.data.expectedBase, integrationCommit: current.data.integrationCommit };
                const hosted = current.data.kind === 'github-existing-ref';
                const prepared = hosted ? await client.prepareHttpsForwardSend(forward as any, signal) : await client.prepareForwardSend(forward, signal);
                if (hosted) {
                    const authority = await session!.observe(this.target(current.target).data, this.grant(current.work, current.target, current.grant_id).data.mode, current.data.expectedBase, signal);
                    this.assertHostedCapture(session, client);
                    if (!('credentialSessionId' in prepared) || prepared.credentialSessionId !== session!.identity || authority.credentialSessionId !== session!.identity)
                        throw Error('Actual prepared native credential capture differs');
                    if ((!renew && authority.credentialSessionId !== current.data.authority?.credentialSessionId) || authority.policy.fingerprint !== current.data.authority?.policy.fingerprint)
                        throw Error('Hosted action authority/policy changed; reprepare current same operation');
                    this.s.tx(() => {
                        this.assertHostedCapture(session, client);
                        const latest = this.validate(id, true, renew);
                        if (latest.phase !== 'RESERVED' || hash(latest) !== snapshot || hash(this.target(latest.target)) !== targetSnapshot || hash(this.grant(latest.work, latest.target, latest.grant_id)) !== grantSnapshot || hash(this.work(this.grant(latest.work, latest.target, latest.grant_id).root)) !== rootSnapshot)
                            throw Error('Prepared reservation changed during native authority refresh');
                        assertNoPendingRulesetWrite(this.s, this.target(latest.target).data.target);
                        if (renew && !this.canRenew(latest))
                            throw Error('Reserved renewal no longer eligible');
                        this.receipt(id, 'hosted-authority-refresh', { previous: current.data.authority, current: authority });
                        this.patch(id, latest.phase, { authority });
                    });
                }
                this.receipt(id, 'native-preflight', 'commands' in prepared ? prepared.commands : { credentialSessionId: prepared.credentialSessionId });
                // Commit possible-effect intent before the irreversible launcher handoff.
                // There is no await or application callback between this commit and spawn.
                this.s.tx(() => {
                    this.validate(id);
                    this.assertTargetTransmissionClear(current.target, id);
                    reviewed?.guard();
                    if (hosted)
                        this.assertHostedCapture(session, client);
                    signal.throwIfAborted();
                    if (hosted)
                        assertNoPendingRulesetWrite(this.s, this.target(current.target).data.target);
                    this.patch(id, 'INVOKING', { dispatchRun: Date.now() });
                });
                signal.throwIfAborted();
                this.validate(id);
                if (hosted)
                    this.assertHostedCapture(session, client);
                if (hosted)
                    assertNoPendingRulesetWrite(this.s, this.target(current.target).data.target);
                const send = hosted ? client.spawnPreparedHttpsForwardSend(prepared as any) : client.spawnPreparedForwardSend(prepared as any);
                const result = await send;
                // The send receipt and the phase it establishes commit together, so a definite refusal is never left INVOKING.
                const refused = result.handoff === 'not-started' || result.transport === 'native-rejection';
                const settled = this.s.tx(() => {
                    this.receipt(id, 'send', result);
                    return refused ? this.patch(id, 'REFUSED', { blocked: [result.reason ?? result.command?.stderr ?? 'Native conditional send rejected'], nextAction: 'Inspect exact receiver/base; explicit reprepare without erasing old receipts' })
                        : this.patch(id, 'UNKNOWN', { blocked: ['Transport handed off; exact readback required'], nextAction: 'reconcileEffect no resend' });
                });
                if (refused)
                    return settled;
                const observed = hosted ? await client.reconcileHttpsForward(forward as any, signal) : await client.reconcileForward(forward, signal);
                this.receipt(id, 'readback', observed);
                return observed.kind === 'contains-integration' ? this.patch(id, 'CONFIRMED', { blocked: [], nextAction: 'Confirmed branch integration; no hosted PR closure claimed', confirmed: observed }) : this.inspect(id);
            }, false, reviewed?.profile);
        }
        catch (error) {
            this.inheritOwnerSources(this.op(id));
            const op = this.op(id);
            if (op.phase === 'CONFIRMED')
                return this.inspect(id);
            return this.patch(id, ['INVOKING', 'UNKNOWN'].includes(op.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: [String(error)], nextAction: op.phase === 'INVOKING' ? 'reconcileEffect without resend' : 'Restore current exact prerequisite; explicit preparation' });
        }
    }
    reconciliationContext(id: string) {
        const retained = this.inspectRetained(id);
        if (!retained.view)
            throw Error('Original bounded integration unavailable');
        if (!['UNKNOWN', 'INVOKING'].includes(retained.view.phase))
            throw Error('Only actual uncertain transmission can reconcile');
        return integrationReadContext(this.s, id, this.h.busy(retained.view.workId) || this.activeNative.has(id), this.h.capacity.observationRoom(), this.h.options.effectsProfile);
    }
    reconcileRetained(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) {
        const task = this.reconcileRetainedInner(options, validate);
        this.nativeTasks.add(task);
        void task.then(() => this.nativeTasks.delete(task), () => this.nativeTasks.delete(task));
        return task;
    }
    private async reconcileRetainedInner(options: {
        operationId: string;
        expectedContext: string;
        gitProfile?: EffectsProfile;
        signal?: AbortSignal;
    }, validate?: () => void) {
        this.h.assertInteractionAdmission();
        const input = { ...options, ...options.gitProfile ? { gitProfile: structuredClone(options.gitProfile) } : {} };
        const current = () => {
            this.h.assertOpen();
            input.signal?.throwIfAborted();
            validate?.();
            const context = this.reconciliationContext(input.operationId);
            if (context.fingerprint !== input.expectedContext)
                throw Error('Original integration read context changed; reopen its review');
            if (context.holds.length)
                throw Error(context.holds.join('; '));
            if (context.execution.consumed + context.execution.reserved >= context.execution.limit)
                throw Error('Original integration execution allowance exhausted; recover its original allowance');
            return context;
        };
        const capturedSession = this.op(input.operationId).data.kind === 'github-existing-ref' ? this.hostedSession : undefined;
        current();
        const profile = Object.freeze(await this.trustedProfile(input.gitProfile ?? this.h.options.effectsProfile));
        current();
        if (capturedSession)
            this.assertHostedCapture(capturedSession);
        else if (this.op(input.operationId).data.kind === 'github-existing-ref')
            throw Error('Explicit hosted read credential required');
        return this.reconcile({ operationId: input.operationId, ...input.signal ? { signal: input.signal } : {} }, profile, true);
    }
    async reconcile(options: {
        operationId: string;
        signal?: AbortSignal;
    }, readProfile?: EffectsProfile, retainedRead = false) {
        const op = this.op(options.operationId);
        if (op.phase === 'CONFIRMED')
            return this.inspect(op.id);
        if (!['UNKNOWN', 'INVOKING'].includes(op.phase))
            throw Error('Only actual uncertain transmission can reconcile');
        if (op.data.kind === 'github-existing-ref' && this.work(op.work).state === 'UNKNOWN') {
            try {
                return await this.nativeRun(op.id, 'reconcile', options.signal, async (client, signal, runId, session) => {
                    const identity = await session!.observeReadIdentity(this.target(op.target).data, signal);
                    this.assertHostedCapture(session, client);
                    this.receipt(op.id, 'isolated-read-identity', { runId, ...identity });
                    const observed = await client.reconcileHttpsForward({ operationId: op.id, target: this.target(op.target).data.target, expectedBase: op.data.expectedBase, integrationCommit: op.data.integrationCommit }, signal);
                    this.receipt(op.id, 'reconciliation', { ...observed, runId, originalCleanup: 'unknown', isolatedReadOnly: true });
                    return this.patch(op.id, 'UNKNOWN', { blocked: ['Original native command cleanup UNKNOWN; original W and capacity remain quarantined'], nextAction: 'Inspect retained original client/run/command cleanup receipts; read-only remote observation never permits resume or resend', originalCleanupRoot: op.data.clientRoot });
                }, true, readProfile, retainedRead);
            }
            catch (error) {
                this.receipt(op.id, 'isolated-observation-unavailable', { reason: String(error), originalClientRoot: op.data.clientRoot });
                return this.patch(op.id, 'UNKNOWN', { blocked: ['Original native cleanup remains UNKNOWN; read-only observation unavailable: ' + String(error)], nextAction: 'Inspect exact original client/run/command cleanup receipts; free independent capacity or restore supported read identity, then retry read-only reconciliation; no resume or resend', originalCleanupRoot: op.data.clientRoot });
            }
        }
        return this.nativeRun(op.id, 'reconcile', options.signal, async (client, signal, runId, session) => {
            if (op.data.kind === 'github-existing-ref') {
                const identity = await session!.observeReadIdentity(this.target(op.target).data, signal);
                this.assertHostedCapture(session, client);
                this.receipt(op.id, 'read-identity', { runId, ...identity });
            }
            const forward = { operationId: op.id, target: this.target(op.target).data.target, expectedBase: op.data.expectedBase, integrationCommit: op.data.integrationCommit };
            const result = op.data.kind === 'github-existing-ref' ? await client.reconcileHttpsForward(forward, signal) : await client.reconcileForward(forward, signal);
            this.receipt(op.id, 'reconciliation', result);
            return result.kind === 'contains-integration' ? this.patch(op.id, 'CONFIRMED', { blocked: [], nextAction: 'Confirmed exact integration without resend', confirmed: result }) : this.patch(op.id, 'UNKNOWN', { blocked: ['reason' in result ? result.reason : 'Exact integration containment unavailable'], nextAction: 'Bounded read/manual receiver observation; zero match cannot justify resend' });
        }, false, readProfile, retainedRead);
    }
    cancel(workIds: ReadonlySet<string>) {
        // Reopening a fully prepared merge need not initialize its driver.
        // Persisted subject operations still receive the same cancellation transition.
        if (this.mergeCore || this.s.all(`SELECT work FROM effect_operations
            WHERE CASE WHEN json_valid(data) THEN json_extract(data,'$.kind')='github-merge' ELSE 0 END`)
            .some(row => workIds.has(row.work)))
            this.merges.cancel(workIds);
        this.publicationCore?.cancel(workIds);
        this.configurationCore?.cancel(workIds);
        for (const row of this.s.all('SELECT * FROM effect_operations')) {
            if (parse(row.data).kind != null && !['local-git', 'github-existing-ref'].includes(parse(row.data).kind))
                continue;
            if (!workIds.has(row.work))
                continue;
            this.activeNative.get(row.id)?.abort();
            this.drivers.get(row.work)?.abort.abort();
            if (row.phase !== 'CONFIRMED')
                this.patch(row.id, ['INVOKING', 'UNKNOWN'].includes(row.phase) ? 'UNKNOWN' : 'REFUSED', { blocked: ['Owned work cancelled'], nextAction: ['INVOKING', 'UNKNOWN'].includes(row.phase) ? 'Reconcile exact possible effect; no rollback/resend claim' : 'Cancelled before dispatch' });
        }
    }
    async close() {
        this.firstPreparationAbort.abort(new Error('Integration host closing'));
        this.localRegistrationAbort.abort(new Error('Integration host closing'));
        this.hostedRegistrationAbort.abort(new Error('Integration host closing'));
        await Promise.allSettled([...this.hostedRegistrations]);
        this.unsubscribeSource();
        this.unsubscribeRecovered();
        await this.publicationCore?.close();
        await this.mergeCore?.close();
        await this.configurationCore?.close();
        for (const driver of this.drivers.values())
            driver.abort.abort();
        for (const abort of this.activeNative.values())
            abort.abort();
        await Promise.allSettled([...this.drivers.values()].map(d => d.done).concat([...this.nativeTasks]));
        if (this.registrationCleanupFailures.size === 1)
            throw [...this.registrationCleanupFailures][0];
        if (this.registrationCleanupFailures.size > 1)
            throw new ControllerError('INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN', 'Multiple original integration registrations have unconfirmed cleanup', [...this.registrationCleanupFailures].map(error => String((error as ControllerError).recovery)).join(' | '));
    }
    /** Missing scope alone is insufficient after native admission/initialization.
     * Use the same affirmative absence rule during immediate and restart cleanup. */
    private async nativeClientNotAllocated(value: unknown, root: string): Promise<boolean> {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const data = value as Record<string, unknown>;
        if (data.clientRoot !== root || !hasNoAllocatedProducer(data) || ![undefined, 'never-admitted'].includes(data.admission as string | undefined))
            return false;
        try {
            await fs.lstat(root);
            return false;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return true;
            throw error;
        }
    }
    async recoverNativeRun(run: any) {
        const data = parse(run.data), op = this.op(data.operationId);
        if (op.work !== run.work || data.clientRoot !== run.staging || !inside(path.join(this.h.options.installationHome, 'effects', op.id), data.clientRoot) || data.clientRoot !== (data.retainedIntegrationRead === true ? path.join(this.h.options.installationHome, 'effects', op.id, 'observations', run.id) : data.readOnlyObservation === true ? path.join(path.dirname(op.data.clientRoot), 'observations', run.id) : op.data.clientRoot))
            throw Error('Native run/client ownership checkpoint differs');
        let cleanup = 'quarantined';
        try {
            const { reconcileOwnedGitProcesses } = await import('../effects/native-git.js');
            const proof = await reconcileOwnedGitProcesses(data.clientRoot);
            this.receipt(op.id, 'restart-process-cleanup', proof);
            if (proof.cleanup === 'confirmed')
                cleanup = 'removed';
            else if (await this.nativeClientNotAllocated(data, data.clientRoot))
                cleanup = 'not-allocated';
        }
        catch (error) {
            this.receipt(op.id, 'restart-process-cleanup-error', { error: String(error) });
        }
        this.s.tx(() => {
            this.h.settleBudget(run.id);
            this.h.patchRun(run.id, cleanup === 'quarantined' ? 'UNKNOWN' : 'INTERRUPTED', { cleanup, recoveredAt: Date.now() });
            if (data.readOnlyObservation !== true && (!data.retainedIntegrationRead || cleanup === 'quarantined'))
                this.s.run('UPDATE works SET state=? WHERE id=?', cleanup === 'quarantined' ? 'UNKNOWN' : 'INTERRUPTED', run.work);
            if (op.phase === 'INVOKING')
                this.patch(op.id, 'UNKNOWN', { blocked: ['Restart after authorized launcher handoff; receiver readback required'], nextAction: 'reconcileEffect no resend' });
        });
        return cleanup;
    }
    recover() {
        this.publications.recover();
        this.configurations.recover();
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE phase!='CONFIRMED' AND (json_extract(data,'$.kind') IS NULL OR json_extract(data,'$.kind') IN ('local-git','github-existing-ref'))"))
            this.inheritOwnerSources({ ...row, data: parse(row.data) });
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE phase='INVOKING' AND (json_extract(data,'$.kind') IS NULL OR json_extract(data,'$.kind') IN ('local-git','github-existing-ref'))"))
            this.patch(row.id, 'UNKNOWN', { blocked: ['Owner restarted after possible transport handoff'], nextAction: 'Reconcile exact integration without resend' });
        // A crash can retain native confirmation before the ordinary callback
        // publishes its alias result. Inspect only; never prepare, send or retry.
        for (const row of this.s.all("SELECT id,data FROM effect_operations WHERE phase='CONFIRMED' AND (json_extract(data,'$.kind') IS NULL OR json_extract(data,'$.kind') IN ('local-git','github-existing-ref','github-merge')) AND json_extract(data,'$.assignmentId') IS NOT NULL")) {
            const metadata = parse(row.data);
            const result = metadata.kind === 'github-merge' ? this.merges.inspect(row.id) : this.inspectInternal(row.id);
            settleRecoveredEffectAssignment(this.s, row.id, result);
        }
    }
}

import { assertNativeResource } from '../platform/native-protection-creation.js';
import { accountedCreatedResource, buildCreatedResourceAccounting } from './configuration-provenance.js';
import { createdAcceptanceSession, type CreatedAcceptanceContext } from '../platform/hosted-context.js';
import { assertNoPendingBranchWrite } from './policy-handoff.js';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { hash } from './change-files.js';
import { loadCriteriaSync } from './criteria.js';
import type { EffectHost } from './effects.js';
import { parseRepositoryConfigurationProfile as parseConfigurationProfile, validateRepositoryConfigurationTarget as validateConfigurationTarget, nativeConfigurationTarget, legacyConfigurationSession, type ConfigurationSession as Session } from '../platform/configuration-session.js';
import { openNativeConfigurationSession, createOwnedNativeConfigurationSession } from '../platform/repository-configuration.js';
import { openGitHubConfigurationReader, createOwnedConfigurationFixture, createOwnedPublicOwnerConfigurationClient } from '../platform/github-configuration.js';
import type { OwnedRulesetIdentity } from '../platform/github-configuration-types.js';
import type { RepositoryConfigurationCredential, RegisterRepositoryConfigurationTarget, PreviewRepositoryConfiguration, RepositoryConfigurationView, RepositoryConfigurationOperation, RepositoryConfigurationAudit, RepositoryConfigurationGuidance } from './configuration-types.js';
const parse = (s: string) => JSON.parse(s);
/** Owner-only finite configuration actions on the existing controller ledger. */
export class Configurations {
    private session: Session | null = null;
    private nativeCredentials: RepositoryConfigurationCredential | null = null;
    private nativeSessions = new Map<string, Session>();
    private nativeFixtureOrigin: string | undefined;
    private owned = new Set<Promise<unknown>>();
    private aborts = new Map<string, AbortController>();
    private closing = false;
    constructor(private h: EffectHost) { }
    private get s() { return this.h.store; }
    private assertAdmission() {
        this.h.assertOpen();
        this.h.assertOwnerConfigurationAdmission();
        if (this.closing)
            throw Error('Configuration admission closing');
    }
    configure(options: RepositoryConfigurationCredential) { this.assertAdmission(); this.nativeCredentials = structuredClone(options); this.nativeSessions.clear(); this.nativeFixtureOrigin = undefined; this.session = legacyConfigurationSession(openGitHubConfigurationReader(structuredClone(options))); }
    configureOwned(options: RepositoryConfigurationCredential & {
        origin: string;
    }) { this.assertAdmission(); this.nativeCredentials = structuredClone(options); this.nativeSessions.clear(); this.nativeFixtureOrigin = options.origin; this.session = legacyConfigurationSession(createOwnedConfigurationFixture(structuredClone(options))); }
    configureOwnedPublicOwner(options: RepositoryConfigurationCredential & {
        origin: string;
    }) { this.assertAdmission(); this.nativeCredentials = null; this.nativeSessions.clear(); this.nativeFixtureOrigin = undefined; this.session = legacyConfigurationSession(createOwnedPublicOwnerConfigurationClient(structuredClone(options))); }
    configureCreatedAcceptance(context: CreatedAcceptanceContext) { this.assertAdmission(); this.nativeCredentials = null; this.nativeSessions.clear(); this.nativeFixtureOrigin = undefined; this.session = legacyConfigurationSession(createdAcceptanceSession(context).configuration); }
    private sessionFor(target: import('../platform/configuration-session.js').RepositoryTarget): Session | null {
        if (!nativeConfigurationTarget(target))
            return this.session;
        if (!this.nativeCredentials)
            return null;
        const key = hash(target);
        let session = this.nativeSessions.get(key);
        if (!session) {
            const options = { ...this.nativeCredentials, provider: target.provider, apiBase: target.apiBase };
            session = this.nativeFixtureOrigin ? createOwnedNativeConfigurationSession(options, target, this.nativeFixtureOrigin) : openNativeConfigurationSession(options, target);
            this.nativeSessions.set(key, session);
        }
        return session;
    }
    private pendingNativeWrite(id: string) {
        const target = this.op(id).data.target;
        if (!nativeConfigurationTarget(target))
            return;
        for (const row of this.s.all("SELECT id,data FROM effect_operations WHERE json_extract(data,'$.kind')='configuration'")) {
            const data = parse(row.data), other = data.target;
            if (!other || other.provider !== target.provider || other.apiBase !== target.apiBase || other.repositoryId !== target.repositoryId)
                continue;
            if (data.steps?.some((j: any) => j.intent && ['INVOKING', 'UNKNOWN'].includes(j.state) && j.transportOutcome !== 'not-started'))
                throw Error('Pending native repository setting write ' + row.id + '; reconcile its exact original intent before another write');
        }
    }
    private own<T>(task: Promise<T>): Promise<T> { this.owned.add(task); void task.then(() => this.owned.delete(task), () => this.owned.delete(task)); return task; }
    private target(id: string) {
        const row = this.s.one('SELECT * FROM effect_targets WHERE id=?', id);
        if (!row || !['github-configuration', 'native-repository-configuration'].includes(parse(row.data).kind) || row.project !== null)
            throw Error('Configuration target family/identity required');
        return { ...row, data: parse(row.data) };
    }
    private op(id: string) {
        const row = this.s.one('SELECT * FROM effect_operations WHERE id=?', id);
        if (!row || parse(row.data).kind !== 'configuration')
            throw Error('Configuration operation family required');
        this.target(row.target);
        return { ...row, data: parse(row.data) };
    }
    private work(id: string) {
        const w = this.s.one('SELECT * FROM works WHERE id=?', id);
        if (!w || parse(w.data).kind !== 'repository-configuration' || w.project !== null)
            throw Error('Owner configuration work required');
        return w;
    }
    private receipt(id: string, kind: string, data: unknown) { this.op(id); const receipt = randomUUID(); this.s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)', receipt, id, 'configuration-' + kind, JSON.stringify(data)); return receipt; }
    private patch(id: string, phase: RepositoryConfigurationView['phase'], values: Record<string, unknown>) { const row = this.op(id); this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', phase, JSON.stringify({ ...row.data, ...values }), id); return this.view(id); }
    register(input: RegisterRepositoryConfigurationTarget) {
        this.assertAdmission();
        const target = validateConfigurationTarget(input.target);
        const prior = this.s.all("SELECT * FROM effect_targets WHERE json_extract(data,'$.kind') IN ('github-configuration','native-repository-configuration')").find(t => hash(parse(t.data).target) === hash(target));
        if (prior)
            return { targetId: prior.id };
        const id = randomUUID();
        this.s.run('INSERT INTO effect_targets VALUES(?,NULL,?)', id, JSON.stringify({ kind: nativeConfigurationTarget(target) ? 'native-repository-configuration' : 'github-configuration', target, ownerUid: process.getuid?.() ?? null }));
        return { targetId: id };
    }
    private descriptor(profile: unknown) { return { version: 'repository-configuration/v1', criteriaHash: loadCriteriaSync().hash, profileHash: hash(profile), prerequisites: ['actual-owner-source-and-exact-target-profile', 'fresh-same-session-account-action-operands', 'current-relevant-native-basis-and-supported-preservation', 'sealed-exact-step-payload-and-finite-scope', 'durable-once-only-step-intent-before-native-handoff'] }; }
    private createdIdentity(operationId: string, target: any): OwnedRulesetIdentity {
        const source = this.op(operationId);
        if (hash(source.data.target) !== hash(target))
            throw Error('Owned creation chain belongs to another canonical repository');
        const candidates = source.data.steps.filter((j: any) => j.kind === 'create-ruleset' && j.state === 'CONFIRMED' && j.intent && j.creationHint && j.receiptIds.length);
        if (candidates.length !== 1) {
            const accounted = accountedCreatedResource(this.s, operationId, target);
            if (accounted)
                return accounted;
            throw Error('Actual retained confirmed or native-accounted ruleset creation chain required');
        }
        const j = candidates[0];
        if (!this.s.all('SELECT data FROM effect_receipts WHERE operation=?', operationId).some(r => { const x = parse(r.data); return x.stepJournalId === j.journalId && x.result?.outcome === 'confirmed' && x.result?.creationHint?.id === j.creationHint.id && x.result?.creationHint?.nodeId === j.creationHint.nodeId; }))
            throw Error('Actual creation/readback receipt missing');
        return structuredClone(j.creationHint);
    }
    preview(input: PreviewRepositoryConfiguration): Promise<RepositoryConfigurationView> {
        this.assertAdmission();
        const { signal, ...rest } = input, captured = structuredClone(rest), profile = parseConfigurationProfile(captured.profile), target = this.target(captured.targetId);
        validateConfigurationTarget(target.data.target);
        if (nativeConfigurationTarget(target.data.target) !== Object.hasOwn(profile, 'provider'))
            throw Error('Configuration profile/target provider families differ');
        if (nativeConfigurationTarget(target.data.target) && (!Object.hasOwn(profile, 'provider') || (profile as {
            provider: unknown;
        }).provider !== target.data.target.provider || captured.ownedCreationOperationId))
            throw Error('Native target requires its same-provider profile without GitHub creation identity');
        let prior = captured.continuationPlanId ? this.op(captured.continuationPlanId) : null;
        if (prior && nativeConfigurationTarget(target.data.target) && prior.data.steps.some((j: any) => ['INVOKING', 'UNKNOWN'].includes(j.state)))
            throw Error('Reconcile the exact original native setting transmission before revising its owner plan');
        if (prior && prior.target !== target.id)
            throw Error('Continuation target differs');
        if (prior && this.h.busy(prior.work))
            throw Error('Configuration work busy');
        if (prior && ['CANCELLED', 'UNKNOWN'].includes(this.work(prior.work).state))
            throw Error('Reconcile original configuration work before revised preview');
        if (prior?.data.steps.some((j: any) => j.state === 'INVOKING' || j.state === 'UNKNOWN' && !this.forwardable(prior, j)))
            throw Error('Read-only original step reconciliation with unchanged before/intended facts required before revised preview');
        const ownedId = captured.ownedCreationOperationId ?? prior?.data.ownedCreationOperationId ?? (prior?.data.steps.some((j: any) => j.kind === 'create-ruleset' && j.state === 'CONFIRMED') ? prior.id : null), ownedRuleset = ownedId ? this.createdIdentity(ownedId, target.data.target) : undefined;
        const id = prior?.id ?? randomUUID(), wid = prior?.work ?? randomUUID(), revision = (prior?.data.revision ?? 0) + 1, source = randomUUID(), grant = prior?.grant_id ?? randomUUID(), descriptor = this.descriptor(profile);
        this.s.tx(() => {
            this.s.run('INSERT INTO sources VALUES(?,?,?,?)', source, null, JSON.stringify({ kind: 'owner-repository-configuration', uid: process.getuid?.() ?? null, targetId: target.id, operationId: id, revision, ...(ownedId ? { ownedCreationOperationId: ownedId } : {}) }), JSON.stringify(profile));
            if (!prior) {
                this.s.run('INSERT INTO works VALUES(?,NULL,?,NULL,?,?,?,?,NULL,?)', wid, source, wid, 'ACTIVE', 1, 1, JSON.stringify({ kind: 'repository-configuration', operationId: id, raw: JSON.stringify(profile) }));
                for (const kind of ['execution', 'resolution'])
                    this.s.run('INSERT INTO budgets VALUES(?,?,8,0,0)', wid, kind);
            }
            const w = this.work(wid);
            this.s.run('INSERT INTO requirements VALUES(?,?,?,?)', wid, revision, JSON.stringify(profile), JSON.stringify({ status: 'owner-exact-configuration', sourceId: source }));
            const data = { kind: 'configuration', target: target.data.target, profile, source, revision, epoch: w.epoch, generation: w.generation, descriptor, ownedRuleset, ownedCreationOperationId: ownedId, revisions: prior?.data.revisions ?? [], steps: (prior?.data.steps ?? []).map((j: any) => j.state === 'UNKNOWN' ? { ...j, forwardRevision: revision } : j), blocked: [], activation: 'disabled', nextAction: 'Observe exact current target and preview retained profile' };
            const grantData = { kind: 'configuration', scope: 'exact-owner-plan', ownerUid: process.getuid?.() ?? null, targetId: target.id, operationId: id, revision, profileHash: hash(profile), descriptorHash: hash(descriptor), rootEpoch: w.epoch, operationLimit: 1 };
            if (prior) {
                this.s.run('UPDATE effect_delegations SET epoch=epoch+1,data=? WHERE id=?', JSON.stringify(grantData), grant);
                this.s.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?', 'PREVIEWING', JSON.stringify(data), id);
                this.s.run("UPDATE works SET state='ACTIVE' WHERE id=?", wid);
            }
            else {
                this.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)', grant, wid, target.id, 1, JSON.stringify(grantData));
                this.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)', id, wid, target.id, grant, 'PREVIEWING', JSON.stringify(data));
            }
        });
        return this.own(this.previewAdmitted(id, revision, signal));
    }
    private async previewAdmitted(id: string, revision: number, signal?: AbortSignal): Promise<RepositoryConfigurationView> {
        try {
            return await this.run(id, 'preview', signal, async (session, combined) => {
                const op = this.op(id), plan = await session.previewConfiguration({ operationId: id, target: op.data.target, desired: op.data.profile, ...(op.data.ownedRuleset ? { ownedRuleset: op.data.ownedRuleset } : {}) }, combined);
                this.assertEntry(id, revision, session);
                const actual = this.op(id);
                if (plan.operationId !== id || hash(plan.target) !== hash(actual.data.target))
                    throw Error('Native configuration preview identity differs');
                const revisionRecord = { revision, source: actual.data.source, plan: structuredClone(plan), planHash: hash(plan), descriptor: actual.data.descriptor };
                const steps = plan.steps.map(step => ({ journalId: randomUUID(), revision, stepId: step.id, kind: step.kind, state: 'PENDING', intent: null, transportOutcome: null, observations: [], creationHint: null, receiptIds: [] }));
                const view = this.patch(id, 'PREVIEWED', { revisions: [...actual.data.revisions, revisionRecord], steps: [...actual.data.steps, ...steps], plan: structuredClone(plan), planHash: hash(plan), activation: session.activation, blocked: plan.manual, nextAction: plan.manual.length ? 'Manual/unsupported selected settings remain incomplete' : 'applyRepositoryConfiguration' });
                this.receipt(id, 'preview', { revision, planHash: hash(plan), native: plan.receipts });
                return view;
            });
        }
        catch (error) {
            const op = this.op(id), cancelled = this.work(op.work).state === 'CANCELLED';
            return this.patch(id, cancelled ? 'CANCELLED' : 'REFUSED', { blocked: [String(error)], nextAction: 'Inspect retained plan/work; explicit same-operation preview after fixing prerequisite' });
        }
    }
    private async observeNoop(id: string, stage: 'audit' | 'reconcile', outer?: AbortSignal) {
        const op = this.op(id);
        this.pendingNativeWrite(id);
        if (!op.data.plan || op.data.plan.steps.length)
            throw Error('Actual complete no-op preview plan required');
        return this.run(id, stage, outer, async (session, signal) => {
            const fresh = await session.previewConfiguration({ operationId: id, target: op.data.target, desired: op.data.profile, ...(op.data.ownedRuleset ? { ownedRuleset: op.data.ownedRuleset } : {}) }, signal);
            this.pendingNativeWrite(id);
            if (this.sessionFor(op.data.target) !== session || this.op(id).data.revision !== op.data.revision)
                throw Error('No-op observation credential/plan changed');
            this.receipt(id, 'noop-' + stage, { revision: op.data.revision, native: fresh });
            return fresh;
        });
    }
    private forwardable(op: any, j: any): boolean {
        if (j.kind === 'create-ruleset' || !j.reconciledAt)
            return false;
        const revision = op.data.revisions.find((r: any) => r.revision === j.revision), step = revision?.plan.steps.find((s: any) => s.id === j.stepId);
        if (!step || j.observations.length !== step.fields.length)
            return false;
        return step.fields.every((f: any) => { const actual = j.observations.find((o: any) => o.path === f.path); return actual && actual.state !== 'unknown' && (hash(actual.actual) === hash(f.before) || hash(actual.actual) === hash(f.intended)); });
    }
    private journal(id: string, journalId: string, values: Record<string, unknown>) {
        const op = this.op(id);
        if (!op.data.steps.some((j: any) => j.journalId === journalId))
            throw Error('Exact owned configuration journal required');
        this.s.run('UPDATE effect_operations SET data=? WHERE id=?', JSON.stringify({ ...op.data, steps: op.data.steps.map((j: any) => j.journalId === journalId ? { ...j, ...values } : j) }), id);
    }
    private nativeResource(id: string, journalId: string, resource: import('../platform/configuration-session.js').NativeProtectionResource | undefined) {
        if (!resource)
            return;
        const op = this.op(id), step = op.data.steps.find((j: any) => j.journalId === journalId);
        if (!nativeConfigurationTarget(op.data.target) || step?.kind !== 'create-native-protection')
            throw Error('Native creation resource cannot enter another journal family');
        const original = op.data.revisions.find((r: any) => r.revision === step.revision);
        assertNativeResource(op.data.target, original.plan.profile.protection.name, resource);
        if (step.nativeResource && hash(step.nativeResource) !== hash(resource))
            throw Error('Retained native creation identity cannot be replaced');
        this.journal(id, journalId, { nativeResource: structuredClone(resource) });
    }
    private currentPlan(id: string) {
        const op = this.op(id), w = this.work(op.work), g = this.s.one('SELECT * FROM effect_delegations WHERE id=?', op.grant_id), gd = g ? parse(g.data) : null;
        if (!op.data.plan || hash(op.data.plan) !== op.data.planHash || hash(op.data.descriptor) !== hash(this.descriptor(op.data.profile)) || !gd || gd.kind !== 'configuration' || g.root !== w.id || g.target !== op.target || gd.operationId !== id || gd.revision !== op.data.revision || gd.profileHash !== hash(op.data.profile) || gd.descriptorHash !== hash(op.data.descriptor) || gd.rootEpoch !== w.epoch)
            throw Error('Current immutable configuration plan/source/grant/descriptor required');
        return op;
    }
    apply(input: RepositoryConfigurationOperation): Promise<RepositoryConfigurationView> { this.assertAdmission(); this.currentPlan(input.planId); return this.own(this.applyInner(input.planId, input.signal)); }
    private async applyInner(id: string, outer?: AbortSignal): Promise<RepositoryConfigurationView> {
        try {
            let op = this.currentPlan(id);
            if (op.phase === 'CONFIRMED')
                return this.view(id);
            this.pendingNativeWrite(id);
            if (op.data.plan.manual.length)
                throw Error('Selected unsupported/manual settings keep configuration incomplete');
            if (op.data.steps.some((j: any) => j.state === 'INVOKING' || j.state === 'UNKNOWN' && !j.forwardRevision))
                throw Error('Read-only original possible step reconciliation required');
            if (!this.sessionFor(op.data.target) || !['owned-fixture-only', 'created-private-local-acceptance', 'public-personal-owner/v1', 'explicit-owner-native/v1'].includes(this.sessionFor(op.data.target)!.activation))
                throw Error('HOSTED_CONFIGURATION_DISABLED: actual production write acceptance unavailable');
            if (!op.data.plan.steps.length) {
                return await this.run(id, 'confirm-noop', outer, async (session, signal) => {
                    const fresh = await session.previewConfiguration({ operationId: id, target: op.data.target, desired: op.data.profile, ...(op.data.ownedRuleset ? { ownedRuleset: op.data.ownedRuleset } : {}) }, signal);
                    this.assertEntry(id, op.data.revision, session);
                    this.pendingNativeWrite(id);
                    if (fresh.steps.length || fresh.manual.length)
                        throw Error('Current native no-op basis changed; revised preview required');
                    this.receipt(id, 'noop-observation', { revision: op.data.revision, native: fresh.receipts });
                    this.s.run("UPDATE works SET state='DELIVERED' WHERE id=?", op.work);
                    return this.patch(id, 'CONFIRMED', { blocked: [], nextAction: 'auditRepositoryConfiguration' });
                });
            }
            const revision = op.data.revision;
            for (const step of op.data.plan.steps) {
                op = this.currentPlan(id);
                const j = op.data.steps.find((x: any) => x.revision === revision && x.stepId === step.id);
                if (!j)
                    throw Error('Required owned step journal absent');
                if (j.state === 'CONFIRMED')
                    continue;
                if (j.state !== 'PENDING')
                    throw Error('Explicit revised owner preview required; no step replay');
                await this.run(id, 'apply-step', outer, async (session, signal, runId) => {
                    const account = await session.observeConfigurationAccount(op.data.target, signal);
                    this.assertEntry(id, revision, session);
                    if (account.credentialSessionId !== session.credentialSessionId || account.native.state !== 'matched')
                        throw Error('Actual current same-credential account/action operands unavailable');
                    this.receipt(id, 'account', { stepJournalId: j.journalId, account });
                    const handle = await session.prepareConfigurationStep({ plan: op.data.plan, stepId: step.id, revisionId: j.journalId }, signal), sealed = session.inspectPreparedConfigurationPayload(handle);
                    if (sealed.sha256 !== step.payloadHash || createHash('sha256').update(sealed.jsonUtf8).digest('hex') !== step.payloadHash)
                        throw Error('Native prepared bytes differ from retained exact owner plan');
                    // COMMIT first. No await/caller hook exists between this compare/intent and native invoke.
                    this.s.tx(() => {
                        signal.throwIfAborted();
                        this.assertAdmission();
                        this.assertEntry(id, revision, session);
                        this.pendingNativeWrite(id);
                        if (step.kind === 'create-ruleset' || step.kind === 'update-owned-ruleset')
                            assertNoPendingBranchWrite(this.s, this.target(op.target).data.target);
                        const current = this.currentPlan(id), now = current.data.steps.find((x: any) => x.journalId === j.journalId);
                        if (now.state !== 'PENDING' || hash(current.data.plan) !== hash(op.data.plan))
                            throw Error('Step already invoked or plan changed');
                        this.journal(id, j.journalId, { state: 'INVOKING', intent: { runId, revision, credentialSessionId: session.credentialSessionId, payloadHash: step.payloadHash, at: Date.now() }, transportOutcome: 'uncertain' });
                        this.patch(id, 'APPLYING', { blocked: [], nextAction: 'Await exact owned step response/readback' });
                    });
                    let result;
                    try {
                        if (step.kind === 'create-ruleset' || step.kind === 'update-owned-ruleset')
                            assertNoPendingBranchWrite(this.s, this.target(op.target).data.target);
                        result = await session.invokePreparedConfigurationStep(handle);
                    }
                    catch (error) {
                        this.journal(id, j.journalId, { state: 'UNKNOWN', transportOutcome: 'uncertain' });
                        throw error;
                    }
                    const receipt = this.receipt(id, 'step-attempt', { stepJournalId: j.journalId, revision, result });
                    this.nativeResource(id, j.journalId, result.nativeResource);
                    const matched = result.outcome === 'confirmed' && result.fieldObservations.length === step.fields.length && result.fieldObservations.every(f => f.state === 'matching');
                    this.journal(id, j.journalId, { state: matched ? 'CONFIRMED' : result.handoff === 'not-started' ? 'REFUSED' : 'UNKNOWN', transportOutcome: result.handoff === 'not-started' ? 'not-started' : matched ? 'native-success' : 'uncertain', observations: result.fieldObservations, creationHint: result.creationHint, receiptIds: [...j.receiptIds, receipt] });
                    const current = this.op(id);
                    if (this.work(current.work).state === 'CANCELLED')
                        throw Error('Configuration work cancelled; retain actual outcomes without scheduling later writes');
                    if (!matched)
                        throw Error(result.reason);
                });
            }
            op = this.currentPlan(id);
            if (op.data.steps.filter((j: any) => j.revision === revision).some((j: any) => j.state !== 'CONFIRMED'))
                throw Error('Selected configuration steps not all observed matching');
            this.s.run("UPDATE works SET state='DELIVERED' WHERE id=?", op.work);
            return this.patch(id, 'CONFIRMED', { blocked: [], nextAction: 'auditRepositoryConfiguration' });
        }
        catch (error) {
            const op = this.op(id), unknown = op.data.steps.some((j: any) => j.state === 'INVOKING' || j.state === 'UNKNOWN'), partial = op.data.steps.some((j: any) => j.state === 'CONFIRMED'), cancelled = this.work(op.work).state === 'CANCELLED';
            return this.patch(id, unknown ? 'UNKNOWN' : cancelled ? 'CANCELLED' : partial ? 'PARTIAL' : 'REFUSED', { blocked: [String(error)], nextAction: unknown ? nativeConfigurationTarget(op.data.target) ? 'Read-only reconcile of the exact original intent; if values remain conflicting/unavailable, inspect the native UI/API with its administrator. No automatic replay or revised native preview is allowed until the original intent is reconciled.' : 'reconcileRepositoryConfiguration (read-only; no replay)' : 'Explicit same-operation revised preview after resolving prerequisite' });
        }
    }
    private accountCreation(id: string, journalId: string, receiptId: string, runId: string): void {
        if (nativeConfigurationTarget(this.op(id).data.target))
            return;
        this.s.tx(() => {
            const proof = buildCreatedResourceAccounting(this.s, id, this.op(id).data.target, journalId, receiptId, runId);
            if (!proof)
                return;
            const prior = this.s.all("SELECT data FROM effect_receipts WHERE operation=? AND kind='configuration-native-resource-accounted'", id);
            if (prior.some(row => parse(row.data).journalId === journalId))
                return;
            this.receipt(id, 'native-resource-accounted', proof);
        });
    }
    reconcile(input: RepositoryConfigurationOperation): Promise<RepositoryConfigurationView> { this.assertAdmission(); this.op(input.planId); return this.own(this.reconcileInner(input.planId, input.signal)); }
    private async reconcileInner(id: string, outer?: AbortSignal): Promise<RepositoryConfigurationView> {
        try {
            const op = this.op(id);
            if (!op.data.plan)
                return this.patch(id, 'REFUSED', { blocked: ['Actual complete preview plan unavailable'], nextAction: 'Explicit same-operation preview with current observation' });
            if (!op.data.plan.steps.length) {
                const fresh = await this.observeNoop(id, 'reconcile', outer), complete = !fresh.steps.length && !fresh.manual.length, cancelled = this.work(op.work).state === 'CANCELLED';
                if (complete && !cancelled)
                    this.s.run("UPDATE works SET state='DELIVERED' WHERE id=?", op.work);
                return this.patch(id, complete && !cancelled ? 'CONFIRMED' : cancelled ? 'CANCELLED' : 'REFUSED', { blocked: complete ? [] : ['Current actual selected values differ or preservation is unavailable'], nextAction: complete ? 'auditRepositoryConfiguration' : 'Explicit same-operation revised preview' });
            }
            for (const j of op.data.steps.filter((x: any) => x.intent && ['INVOKING', 'UNKNOWN', 'CONFIRMED'].includes(x.state))) {
                const revision = op.data.revisions.find((r: any) => r.revision === j.revision);
                if (!revision)
                    throw Error('Actual original step plan revision missing');
                let receiptId: string | undefined, reconciliationRun: string | undefined;
                await this.run(id, 'reconcile', outer, async (session, signal, runId) => {
                    const result = await session.reconcileConfigurationStep({ plan: revision.plan, stepId: j.stepId, ...(j.creationHint ? { creationHint: j.creationHint } : {}), ...(j.nativeResource ? { nativeResource: j.nativeResource } : {}) }, signal);
                    if (this.sessionFor(op.data.target) !== session)
                        throw Error('Configured credential changed during read-only reconciliation');
                    this.s.tx(() => {
                        const receipt = this.receipt(id, 'step-reconciliation', { stepJournalId: j.journalId, revision: j.revision, runId, result });
                        this.nativeResource(id, j.journalId, result.nativeResource);
                        this.journal(id, j.journalId, { state: result.outcome === 'confirmed' ? 'CONFIRMED' : 'UNKNOWN', observations: result.fieldObservations, creationHint: result.creationHint ?? j.creationHint, reconciledAt: Date.now(), receiptIds: [...j.receiptIds, receipt] });
                        receiptId = receipt;
                        reconciliationRun = runId;
                    });
                });
                if (receiptId && reconciliationRun)
                    this.accountCreation(id, j.journalId, receiptId, reconciliationRun);
            }
            const current = this.op(id), active = current.data.steps.filter((j: any) => j.revision === current.data.revision), complete = !current.data.plan?.manual.length && active.every((j: any) => j.state === 'CONFIRMED'), cancelled = this.work(current.work).state === 'CANCELLED';
            if (complete && !cancelled)
                this.s.run("UPDATE works SET state='DELIVERED' WHERE id=?", current.work);
            return this.patch(id, complete && !cancelled ? 'CONFIRMED' : current.data.steps.some((j: any) => j.state === 'UNKNOWN' || j.state === 'INVOKING') ? 'UNKNOWN' : cancelled ? 'CANCELLED' : 'PARTIAL', { blocked: complete && !cancelled ? [] : ['Current intended settings not all observed matching; no old step replay'], nextAction: complete ? 'auditRepositoryConfiguration' : nativeConfigurationTarget(current.data.target) ? 'Inspect the original native intent and per-field observations with the administrator. Reconcile matching current values without replay; unchanged/conflicting or unavailable observations keep UNKNOWN and cannot be cleared by a revised native preview.' : accountedCreatedResource(this.s, id, current.data.target) ? 'Native resource accounted; desired settings differ. Explicit NEW owner preview with ownedCreationOperationId / --owned-creation-operation targets this exact resource' : 'Explicit same-operation revised owner preview or manual recovery' });
        }
        catch (error) {
            // A failed read-only reconciliation reports uncertainty only where a possible write exists.
            const current = this.op(id), uncertain = current.phase === 'UNKNOWN' || current.data.steps.some((j: any) => j.state === 'INVOKING' || j.state === 'UNKNOWN');
            return this.patch(id, uncertain ? 'UNKNOWN' : current.phase, { blocked: [String(error)], ...(uncertain ? { nextAction: 'Retain exact original steps; resolve read-only observation prerequisite' } : {}) });
        }
    }
    audit(input: RepositoryConfigurationOperation): Promise<RepositoryConfigurationAudit> {
        this.assertAdmission();
        this.op(input.planId);
        return this.own((async () => {
            const observations = [];
            let complete = true;
            const unknowns: string[] = [];
            const op = this.op(input.planId);
            try {
                if (!op.data.plan)
                    throw Error('Actual complete preview plan unavailable');
                if (!op.data.plan.steps.length) {
                    const actual = await this.observeNoop(op.id, 'audit', input.signal);
                    complete = !actual.steps.length && !actual.manual.length;
                    observations.push({ journalId: 'revision-' + op.data.revision + '-noop-observation', result: actual });
                    if (!complete)
                        unknowns.push('Actual selected desired values drifted or preservation is unavailable');
                }
                for (const j of op.data.steps.filter((x: any) => x.revision === op.data.revision)) {
                    if (!j.intent) {
                        complete = false;
                        unknowns.push(j.journalId + ': never invoked');
                        continue;
                    }
                    const revision = op.data.revisions.find((r: any) => r.revision === j.revision);
                    const result = await this.run(op.id, 'audit', input.signal, async (session, signal) => {
                        const result = await session.reconcileConfigurationStep({ plan: revision.plan, stepId: j.stepId, ...(j.creationHint ? { creationHint: j.creationHint } : {}), ...(j.nativeResource ? { nativeResource: j.nativeResource } : {}) }, signal);
                        if (this.sessionFor(op.data.target) !== session)
                            throw Error('Configured credential changed during configuration audit');
                        return result;
                    });
                    this.nativeResource(op.id, j.journalId, result.nativeResource);
                    this.receipt(op.id, 'audit', { stepJournalId: j.journalId, result });
                    observations.push({ journalId: j.journalId, result });
                    if (result.outcome !== 'confirmed') {
                        complete = false;
                        unknowns.push(result.reason);
                    }
                }
                if (op.data.plan?.manual.length) {
                    complete = false;
                    unknowns.push(...op.data.plan.manual);
                }
            }
            catch (error) {
                complete = false;
                unknowns.push(String(error));
            }
            return { planId: op.id, targetId: op.target, view: this.view(op.id), steps: observations, complete, unknowns };
        })());
    }
    guide(input: {
        targetId: string;
        branch: string;
        signal?: AbortSignal;
    }): Promise<RepositoryConfigurationGuidance> {
        this.assertAdmission();
        const target = this.target(input.targetId), session = this.sessionFor(this.target(input.targetId).data.target);
        if (!session)
            throw Error('Configure captured owner credential for actual guidance');
        if (typeof input.branch !== 'string' || !input.branch || input.branch.length > 1024)
            throw Error('Literal guidance branch required');
        const key = 'guide-' + randomUUID(), abort = new AbortController(), signal = AbortSignal.any([abort.signal, ...(input.signal ? [input.signal] : []), AbortSignal.timeout(30000)]);
        this.aborts.set(key, abort);
        return this.own((async () => {
            try {
                const observation = await session.observeConfigurationGuidance({ target: target.data.target, branch: input.branch }, signal);
                if (this.sessionFor(target.data.target) !== session || this.closing)
                    throw Error('Guidance credential/owner lifecycle changed');
                return { targetId: target.id, branch: input.branch, observation, limitations: ['Current visible native observations only; unsupported/hidden policies stay unknown', 'No server CAS or globally complete event coverage', 'Desired recommendations are not actual active enforcement'] };
            }
            finally {
                this.aborts.delete(key);
            }
        })());
    }
    private assertEntry(id: string, revision: number, session: Session) {
        if (this.closing)
            throw Error('Configuration closing');
        const op = this.op(id), w = this.work(op.work);
        if (this.sessionFor(op.data.target) !== session || op.data.revision !== revision || w.epoch !== op.data.epoch || w.generation !== op.data.generation || ['CANCELLED', 'UNKNOWN'].includes(w.state))
            throw Error('Configuration source/epoch/revision/credential changed');
    }
    inspect(id: string): RepositoryConfigurationView { this.h.assertOpen(); return this.view(id); }
    private view(id: string): RepositoryConfigurationView { const op = this.op(id); return { planId: id, operationId: id, workId: op.work, targetId: op.target, revision: op.data.revision, phase: op.phase, plan: op.data.plan ?? null, steps: op.data.steps ?? [], receiptIds: this.s.all('SELECT id FROM effect_receipts WHERE operation=? ORDER BY rowid', id).map(r => r.id), activation: op.data.activation ?? 'disabled', blocked: op.data.blocked ?? [], nextAction: op.data.nextAction ?? '' }; }
    private async run<T>(id: string, stage: string, outer: AbortSignal | undefined, body: (s: Session, signal: AbortSignal, runId: string) => Promise<T>): Promise<T> {
        this.assertAdmission();
        const op = this.op(id), w = this.work(op.work), session = this.sessionFor(this.op(id).data.target);
        if (!session)
            throw Error('Configure captured owner credential for actual repository observation');
        if (this.h.busy(w.id))
            throw Error('Configuration work busy');
        if (['CANCELLED', 'UNKNOWN'].includes(w.state) && !['reconcile', 'audit'].includes(stage))
            throw Error('Configuration work unavailable');
        const abort = new AbortController(), stop = () => abort.abort(outer?.reason);
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]), run = randomUUID();
        let registered = false;
        try {
            this.s.tx(() => {
                const b = this.s.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'", w.lineage);
                if (b.consumed + b.reserved >= b.lim)
                    throw Error('Retained configuration execution allowance exhausted');
                this.s.run("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'", w.lineage);
                this.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', run, w.id, w.epoch, w.generation, 'RUNNING', path.join(this.h.options.installationHome, 'state'), 'reserved', JSON.stringify({ kind: 'configuration-http', operationId: id, revision: op.data.revision, stage, controllerPid: process.pid }));
                // Registration is the reservation's last step, so a busy refusal rolls the reservation back.
                this.h.register(w.id, { abort });
                registered = true;
            });
        }
        catch (error) {
            if (registered)
                this.h.unregister(w.id);
            throw error;
        }
        outer?.addEventListener('abort', stop, { once: true });
        if (outer?.aborted)
            stop();
        this.aborts.set(id, abort);
        try {
            signal.throwIfAborted();
            return await body(session, signal, run);
        }
        finally {
            this.s.tx(() => { this.h.settleBudget(run); this.h.patchRun(run, 'SETTLED', { cleanup: 'in-process-configuration-http-settled' }); });
            this.aborts.delete(id);
            this.h.unregister(w.id);
            outer?.removeEventListener('abort', stop);
        }
    }
    cancel(workIds: ReadonlySet<string>) {
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='configuration'")) {
            if (!workIds.has(row.work))
                continue;
            this.aborts.get(row.id)?.abort(Error('Configuration work cancelled'));
            const data = parse(row.data), uncertain = data.steps.some((j: any) => j.state === 'INVOKING' || j.state === 'UNKNOWN');
            this.patch(row.id, uncertain ? 'UNKNOWN' : 'CANCELLED', { blocked: ['Owner configuration work cancelled'], nextAction: uncertain ? 'Read-only exact possible effect reconciliation' : 'No later setting writes permitted' });
        }
    }
    recoverRun(run: any) {
        const op = this.op(parse(run.data).operationId);
        if (op.work !== run.work)
            throw Error('Configuration restart work binding differs');
        this.s.tx(() => {
            this.h.settleBudget(run.id);
            this.h.patchRun(run.id, 'INTERRUPTED', { cleanup: 'in-process-owner-restarted' });
            if (this.work(run.work).state !== 'CANCELLED')
                this.s.run("UPDATE works SET state='INTERRUPTED' WHERE id=?", run.work);
            this.patch(op.id, op.data.steps.some((j: any) => j.state === 'INVOKING') ? 'UNKNOWN' : 'REFUSED', { blocked: ['Owner process interrupted; inspect original operation before any write'], nextAction: 'Read-only exact operation reconciliation or same-operation preview' });
        });
    }
    recover() {
        for (const row of this.s.all("SELECT * FROM effect_operations WHERE json_extract(data,'$.kind')='configuration' AND phase='APPLYING'"))
            this.patch(row.id, 'UNKNOWN', { blocked: ['Possible configuration step handoff before restart'], nextAction: 'Reconcile original exact step; do not replay' });
    }
    async close() {
        this.closing = true;
        for (const abort of this.aborts.values())
            abort.abort(Error('Controller configuration closing'));
        while (this.owned.size)
            await Promise.allSettled([...this.owned]);
    }
}

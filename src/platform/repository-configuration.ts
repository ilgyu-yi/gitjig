import { readGiteaProtectionInventory, giteaProtectionName } from './gitea-protection-inventory.js';
import { readGitLabCollection } from './repository-collection.js';
import { nativeCreationSettings, nativeCreationPayload, nativeProtectionResource, assertNativeResource, nativeCreationValue } from './native-protection-creation.js';
import { randomUUID, createHash } from 'node:crypto';
import { policyCanonical, policyHash } from './github-policy-schema.js';
import type { ConfigurationReconciliation, ConfigurationReceipt, PreparedConfigurationStep } from './github-configuration-types.js';
import { nativeConfigurationTarget, type ConfigurationSession, type RepositoryTarget, type RepositoryPreview, type RepositoryRetained, type RepositoryPlan, type RepositoryStep, type RepositoryAttempt, type RepositoryReconciliation, type NativeProtectionResource } from './configuration-session.js';
import { validateProviderConfigurationTarget, parseProviderConfigurationProfile, type ProviderConfigurationTarget, type ProviderConfigurationProfile } from './repository-configuration-profile.js';
import { repositoryConfigurationTransport, type RepositoryReadOptions } from './repository-inspect-transport.js';
import { openRepositoryInspector, createOwnedRepositoryInspectionFixture } from './repository-inspect.js';
type Row = Record<string, unknown>;
const object = (v: unknown): Row => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw Error('Native configuration object unavailable');
    return v as Row;
};
const same = (a: unknown, b: unknown) => policyHash(a) === policyHash(b);
const encode = (v: unknown) => Buffer.from(policyCanonical(v), 'utf8');
type Budget = {
    signal: AbortSignal;
    requests: number;
    bytes: number;
    items: number;
    receipts: ConfigurationReceipt[];
};
type Snapshot = {
    repository: Row;
    resources: Record<string, {
        identity: Row;
        selected: Row;
    }>;
};
class NativeConfigurationSession implements ConfigurationSession {
    readonly credentialSessionId = randomUUID();
    readonly activation: 'owned-fixture-only' | 'explicit-owner-native/v1';
    private readonly target: ProviderConfigurationTarget;
    private readonly transport: ReturnType<typeof repositoryConfigurationTransport>;
    private readonly options: RepositoryReadOptions;
    private readonly prepared = new WeakMap<object, {
        plan: RepositoryPlan;
        step: RepositoryStep;
        budget: Budget;
        bytes: Buffer;
        invoked: boolean;
    }>();
    constructor(options: RepositoryReadOptions, target: ProviderConfigurationTarget, fixtureOrigin?: string) {
        this.target = validateProviderConfigurationTarget(target);
        if (options.provider !== target.provider)
            throw Error('Native credential session provider differs');
        this.options = structuredClone({ ...options, apiBase: fixtureOrigin ? fixtureOrigin + new URL(this.target.apiBase).pathname : this.target.apiBase });
        this.transport = repositoryConfigurationTransport(this.options, !!fixtureOrigin);
        this.activation = fixtureOrigin ? 'owned-fixture-only' : 'explicit-owner-native/v1';
    }
    private checkTarget(input: RepositoryTarget) {
        if (!nativeConfigurationTarget(input) || !same(validateProviderConfigurationTarget(input), this.target))
            throw Error('Native configuration target/provider/base/actor differs from the captured session');
        return this.target;
    }
    private budget(signal?: AbortSignal): Budget { return { signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]), requests: 0, bytes: 0, items: 0, receipts: [] }; }
    private start(b: Budget, route: string, method: 'GET' | 'PATCH' | 'PUT' | 'POST', body?: Buffer) {
        b.signal.throwIfAborted();
        if (b.requests >= this.transport.limits.pages)
            throw Error('Native configuration operation request limit reached');
        b.requests++;
        const url = new URL(this.transport.base.href + route), pending = this.transport.start(url, method, body, b.signal, size => {
            b.bytes += size;
            if (b.bytes > this.transport.limits.collectionBytes)
                throw Error('Native configuration operation byte limit reached');
        });
        const response = pending.response.then(value => { b.receipts.push({ route, method, status: value.status, bodyHash: value.bodyHash, bodyBytes: value.bodyBytes, requestId: null }); return value; });
        return { handoff: pending.handoff, response };
    }
    private async read(b: Budget, route: string) {
        const r = await this.start(b, route, 'GET').response;
        if (r.status !== 200)
            throw Error('Native configuration read unavailable (HTTP ' + r.status + '); no absence or write permission is inferred');
        return object(r.data);
    }
    private route() { const t = this.target; return t.provider === 'gitea' ? '/repos/' + encodeURIComponent(t.owner) + '/' + encodeURIComponent(t.repository) : '/projects/' + t.repositoryId; }
    private async account(b: Budget, administration = true) {
        const t = this.target, user = await this.read(b, '/user'), repository = await this.read(b, this.route());
        if (user.id !== t.actorUserId || repository.id !== t.repositoryId || repository[t.provider === 'gitea' ? 'full_name' : 'path_with_namespace'] !== t.owner + '/' + t.repository || administration && repository.archived !== false)
            throw Error('Native account/repository identity or nonarchived state differs');
        if (!administration)
            return repository;
        const permissions = object(repository.permissions);
        if (t.provider === 'gitea') {
            if (permissions.admin !== true)
                throw Error('Observed native repository administration precondition unavailable');
        }
        else {
            const levels = ['project_access', 'group_access'].map(key => {
                const access = permissions[key];
                if (access === null)
                    return 0;
                const value = object(access).access_level;
                if (!Number.isSafeInteger(value) || Number(value) < 0)
                    throw Error('Native project permission operands unavailable');
                return Number(value);
            });
            if (Math.max(...levels) < 40)
                throw Error('Observed native project Maintainer/Owner precondition unavailable');
        }
        return repository;
    }
    private selected(row: Row, desired: Row, profile: ProviderConfigurationProfile, group: 'repository' | 'protection') {
        const result: Row = {};
        for (const key of Object.keys(desired).sort()) {
            if (!Object.hasOwn(row, key))
                throw Error('Selected native setting unavailable: ' + key);
            result[key] = structuredClone(row[key]);
        }
        // The same provider field schema validates observed values; no missing/nullable boolean defaults.
        parseProviderConfigurationProfile(group === 'repository' ? { provider: profile.provider, version: profile.version, repository: result } : { provider: profile.provider, version: profile.version, protection: { name: profile.protection!.name, fields: result } });
        return result;
    }
    private collectionRoute() { return this.route() + (this.target.provider === 'gitea' ? '/branch_protections' : '/protected_branches'); }
    private async absentProtection(b: Budget, name: string) {
        const get = (route: string) => this.start(b, route, 'GET').response, charge = (count: number) => {
            b.items += count;
            if (b.items > this.transport.limits.collectionItems)
                throw Error('Native configuration inventory item limit reached');
        };
        const rows = this.target.provider === 'gitea' ? await readGiteaProtectionInventory(get, this.collectionRoute(), charge) : await readGitLabCollection(get, this.transport.base, this.collectionRoute(), row => {
            if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || typeof row.name !== 'string' || !row.name)
                throw Error('Native inventory identity unavailable');
            return String(row.id);
        }, charge);
        const names = new Set<string>();
        for (const row of rows) {
            const actual = this.target.provider === 'gitea' ? giteaProtectionName(row) : row.name;
            if (typeof actual !== 'string' || !actual || names.has(actual))
                throw Error('Complete unambiguous native protection inventory required');
            names.add(actual);
            if (actual === name)
                throw Error('Native rule already exists; create mode never updates it. Use an explicit update profile');
        }
    }
    private async snapshot(b: Budget, profile: ProviderConfigurationProfile, write: boolean): Promise<Snapshot> {
        const repository = await this.account(b, write), resources: Snapshot['resources'] = {};
        if (profile.repository)
            resources.repository = { identity: { kind: 'repository', id: this.target.repositoryId }, selected: this.selected(repository, profile.repository, profile, 'repository') };
        if (profile.protection?.mode === 'create') {
            await this.absentProtection(b, profile.protection.name);
            resources.protection = { identity: { kind: 'protection', name: profile.protection.name, absent: true }, selected: {} };
        }
        else if (profile.protection) {
            const row = await this.read(b, this.route() + (this.target.provider === 'gitea' ? '/branch_protections/' : '/protected_branches/') + encodeURIComponent(profile.protection.name));
            const name = this.target.provider === 'gitea' ? row.rule_name ?? row.branch_name : row.name;
            if (name !== profile.protection.name)
                throw Error('Exact native protection rule key differs');
            const identity: Row = { kind: 'protection', name };
            if (this.target.provider === 'gitlab') {
                if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || row.inherited !== false)
                    throw Error('An identified explicitly project-owned GitLab rule is required; inherited or unknown ownership cannot be updated');
                identity.id = row.id;
            }
            resources.protection = { identity, selected: this.selected(row, profile.protection.fields, profile, 'protection') };
        }
        if (write) {
            const later = await this.account(b);
            if (profile.repository && !same(resources.repository!.selected, this.selected(later, profile.repository, profile, 'repository')))
                throw Error('Selected native repository settings changed during preflight; revise the original preview');
        }
        return { repository, resources };
    }
    private parseProfile(input: unknown) {
        const p = parseProviderConfigurationProfile(input);
        if (p.provider !== this.target.provider)
            throw Error('Native profile provider differs from target');
        return p;
    }
    async previewConfiguration(input: RepositoryPreview, signal?: AbortSignal): Promise<RepositoryPlan> {
        this.checkTarget(input.target);
        if (input.ownedRuleset)
            throw Error('GitHub owned creation cannot be used for a native provider');
        if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200)
            throw Error('Bounded original configuration operation required');
        const profile = this.parseProfile(input.desired), b = this.budget(signal), snapshot = await this.snapshot(b, profile, true), steps: RepositoryStep[] = [];
        for (const group of ['repository', 'protection'] as const) {
            const resource = snapshot.resources[group], desired = group === 'repository' ? profile.repository : profile.protection?.fields;
            if (!resource || !desired)
                continue;
            if (group === 'protection' && profile.protection?.mode === 'create') {
                const settings = nativeCreationSettings(profile), basis = { target: this.target, identity: resource.identity, selected: {} }, payload = nativeCreationPayload(profile);
                steps.push({ id: 'create-native-protection', kind: 'create-native-protection', route: this.collectionRoute(), method: 'POST', basis, basisHash: policyHash(basis), payload, payloadHash: policyHash(payload), fields: Object.keys(settings).sort().map(key => ({ path: 'protection.' + key, before: { state: 'not-present' }, intended: settings[key] })) });
                continue;
            }
            const fields = Object.keys(desired).sort().map(key => ({ path: group + '.' + key, before: resource.selected[key], intended: desired[key] })), payload = Object.fromEntries(fields.filter(f => !same(f.before, f.intended)).map(f => [f.path.slice(group.length + 1), f.intended]));
            if (!Object.keys(payload).length)
                continue;
            const kind = group === 'repository' ? 'patch-native-repository' : 'patch-native-protection', basis = { target: this.target, identity: resource.identity, selected: resource.selected }, route = this.route() + (group === 'repository' ? '' : (this.target.provider === 'gitea' ? '/branch_protections/' : '/protected_branches/') + encodeURIComponent(profile.protection!.name));
            steps.push({ id: kind, kind, route, method: this.target.provider === 'gitlab' && group === 'repository' ? 'PUT' : 'PATCH', basis, basisHash: policyHash(basis), payload, payloadHash: policyHash(payload), fields, ...(typeof resource.identity.id === 'number' ? { resourceId: resource.identity.id } : {}) });
        }
        return { operationId: input.operationId, target: structuredClone(this.target), profile, profileHash: policyHash(profile), steps, preserved: ['Unselected native settings are omitted from sparse requests; effective policy interactions can still change.', profile.protection?.mode === 'create' ? 'Only the explicitly selected new rule is created. Initial push/admin/role choices and fixed inactive allowlists are part of the recorded payload; unrelated native defaults and overlapping policies are not certified.' : 'No creation, deletion, rename, principal/access-level array update, inherited-rule update or agent approval is performed.'], manual: [], limitations: ['Native PATCH/PUT provide no claimed server CAS. Relevant preflight can race concurrent writes; same-name Gitea rule recreation cannot be atomically detected.', 'Observed admin/role metadata is a supported precondition, not token-write proof. Native endpoints enforce final permissions.', 'Readback confirms current selected settings, not causation, ownership or complete effective policy. Gitea natural-name identity cannot distinguish same-name recreation. Live provider/release qualification remains separate.'], receipts: b.receipts, activation: this.activation };
    }
    async observeConfigurationAccount(target: RepositoryTarget, signal?: AbortSignal) { this.checkTarget(target); const b = this.budget(signal); await this.account(b); return { credentialSessionId: this.credentialSessionId, native: { state: 'matched' }, scope: 'Fresh native actor/repository/administration preconditions only; no token-write or merge authorization proof', receipts: b.receipts }; }
    async observeConfigurationGuidance(input: {
        target: RepositoryTarget;
        branch: string;
    }, signal?: AbortSignal) {
        this.checkTarget(input.target);
        const factory = this.activation === 'owned-fixture-only' ? createOwnedRepositoryInspectionFixture : openRepositoryInspector;
        const observation = await factory(this.options).inspect({ owner: this.target.owner, repository: this.target.repository, branch: input.branch, ...(signal ? { signal } : {}) });
        if (observation.actor.id !== this.target.actorUserId || observation.repository.id !== this.target.repositoryId || observation.repository.fullName !== this.target.owner + '/' + this.target.repository)
            throw Error('Guidance native actor/repository differs from the registered target; register the intended current identity explicitly');
        return observation;
    }
    private step(input: RepositoryRetained) {
        if (input.creationHint)
            throw Error('GitHub creation hints cannot be used for native updates');
        const plan = structuredClone(input.plan);
        this.checkTarget(plan.target);
        const profile = this.parseProfile(plan.profile);
        if (plan.profileHash !== policyHash(profile) || plan.activation !== this.activation)
            throw Error('Native original profile/activation binding differs');
        const matches = plan.steps.filter(s => s.id === input.stepId);
        if (matches.length !== 1)
            throw Error('Exact original native step required');
        const step = matches[0]!, group = step.kind === 'patch-native-repository' ? 'repository' : step.kind === 'patch-native-protection' ? 'protection' : null;
        if (step.kind === 'create-native-protection') {
            if (profile.protection?.mode !== 'create' || step.id !== step.kind)
                throw Error('Frozen original native create mode required');
            const settings = nativeCreationSettings(profile), payload = nativeCreationPayload(profile), basis = { target: this.target, identity: { kind: 'protection', name: profile.protection.name, absent: true }, selected: {} }, fields = Object.keys(settings).sort().map(key => ({ path: 'protection.' + key, before: { state: 'not-present' }, intended: settings[key] }));
            if (!same(step.basis, basis) || step.basisHash !== policyHash(basis) || !same(step.payload, payload) || step.payloadHash !== policyHash(payload) || !same(step.fields, fields) || step.route !== this.collectionRoute() || step.method !== 'POST' || Object.hasOwn(step, 'resourceId'))
                throw Error('Native original create basis/payload/fields/route differs');
            if (input.nativeResource)
                assertNativeResource(this.target, profile.protection.name, input.nativeResource);
            return { plan, profile, step, group: 'protection' as const, basis };
        }
        if (group === 'protection' && profile.protection?.mode === 'create')
            throw Error('Native create mode cannot become an update');
        if (!group || step.id !== step.kind)
            throw Error('Native step family differs');
        const desired = group === 'repository' ? profile.repository : profile.protection?.fields;
        if (!desired)
            throw Error('Native step has no selected profile group');
        const basis = object(step.basis), identity = object(basis.identity), selected = object(basis.selected), fields = Object.keys(desired).sort().map(key => ({ path: group + '.' + key, before: selected[key], intended: desired[key] })), payload = Object.fromEntries(fields.filter(f => !same(f.before, f.intended)).map(f => [f.path.slice(group.length + 1), f.intended]));
        const route = this.route() + (group === 'repository' ? '' : (this.target.provider === 'gitea' ? '/branch_protections/' : '/protected_branches/') + encodeURIComponent(profile.protection!.name));
        if (!same(basis.target, this.target) || !same(step.fields, fields) || !same(step.payload, payload) || step.payloadHash !== policyHash(payload) || step.basisHash !== policyHash(basis) || step.route !== route || step.method !== (this.target.provider === 'gitlab' && group === 'repository' ? 'PUT' : 'PATCH') || Object.keys(selected).sort().join('\0') !== Object.keys(desired).sort().join('\0') || !Object.keys(payload).length)
            throw Error('Native sealed step basis/fields/payload/route differs');
        if (identity.kind !== (group === 'repository' ? 'repository' : 'protection') || group === 'repository' && identity.id !== this.target.repositoryId || group === 'protection' && identity.name !== profile.protection!.name || typeof identity.id === 'number' && step.resourceId !== identity.id)
            throw Error('Native step resource identity differs');
        this.selected(selected, desired, profile, group);
        return { plan, profile, step, group, basis };
    }
    async prepareConfigurationStep(input: RepositoryRetained & {
        revisionId: string;
    }, signal?: AbortSignal) {
        const captured = this.step(input);
        if (!input.revisionId || input.revisionId.length > 200)
            throw Error('Original native step journal revision required');
        const b = this.budget(signal), fresh = await this.snapshot(b, captured.profile, true), resource = fresh.resources[captured.group];
        if (!resource || !same(captured.basis, { target: this.target, identity: resource.identity, selected: resource.selected }))
            throw Error('Native relevant selected settings or resource changed; revise the original preview');
        const bytes = encode(captured.step.payload), handle = { operationId: captured.plan.operationId, stepId: captured.step.id, payloadHash: captured.step.payloadHash, credentialSessionId: this.credentialSessionId, revisionId: input.revisionId };
        this.prepared.set(handle, { plan: captured.plan, step: captured.step, budget: b, bytes, invoked: false });
        return handle;
    }
    inspectPreparedConfigurationPayload(handle: PreparedConfigurationStep) {
        const entry = this.prepared.get(handle);
        if (!entry || entry.invoked)
            throw Error('Exact unused original native handle required');
        return { jsonUtf8: Buffer.from(entry.bytes), sha256: createHash('sha256').update(entry.bytes).digest('hex') };
    }
    async invokePreparedConfigurationStep(handle: PreparedConfigurationStep): Promise<RepositoryAttempt> {
        const entry = this.prepared.get(handle);
        if (!entry || entry.invoked)
            throw Error('Exact unused native handle required');
        entry.invoked = true;
        let handoff: 'not-started' | 'request-created' = 'not-started', nativeResource: NativeProtectionResource | undefined;
        try {
            const pending = this.start(entry.budget, entry.step.route, entry.step.method as 'PATCH' | 'PUT' | 'POST', entry.bytes);
            handoff = pending.handoff;
            const response = await pending.response;
            if (response.status !== (entry.step.kind === 'create-native-protection' ? 201 : 200))
                throw Error('Native configuration response HTTP ' + response.status + '; retain the original intent and reconcile without replay');
            if (entry.step.kind === 'create-native-protection') {
                const candidate = nativeProtectionResource(this.target, object(response.data));
                assertNativeResource(this.target, (entry.plan.profile as ProviderConfigurationProfile).protection!.name, candidate);
                nativeResource = candidate;
            }
            const readback = entry.step.kind === 'create-native-protection' ? await this.reconcileCreated(entry.plan, entry.step, entry.budget, nativeResource) : await this.reconcile(entry.plan, entry.step, entry.budget);
            return { ...readback, handoff };
        }
        catch {
            return { ...nativeResource ? { nativeResource } : {}, operationId: entry.plan.operationId, stepId: entry.step.id, handoff, outcome: handoff === 'not-started' ? 'refused' : 'unknown', creationHint: null, fieldObservations: entry.step.fields.map(f => ({ path: f.path, state: 'unknown', actual: null })), observed: null, receipts: entry.budget.receipts, reason: handoff === 'not-started' ? 'Native request not started; inspect cancellation and retained prerequisites' : 'Native result or readback unavailable; reconcile the exact original step without replay' };
        }
    }
    private async reconcileCreated(plan: RepositoryPlan, step: RepositoryStep, b: Budget, known?: NativeProtectionResource): Promise<RepositoryReconciliation> {
        let resource = known;
        try {
            const profile = this.parseProfile(plan.profile), name = profile.protection!.name;
            if (known)
                assertNativeResource(this.target, name, known);
            await this.account(b, false);
            const row = await this.read(b, this.collectionRoute() + '/' + encodeURIComponent(name)), actual = nativeProtectionResource(this.target, row);
            assertNativeResource(this.target, name, actual);
            if (known && !same(known, actual))
                throw Error('Recorded native creation identity differs from the current same-name resource');
            resource = actual;
            if (this.target.provider === 'gitlab' && row.inherited !== false)
                throw Error('Explicit project-owned native creation readback unavailable');
            const settings = nativeCreationSettings(profile), fieldObservations = step.fields.map(field => {
                try {
                    const key = field.path.slice('protection.'.length), value = nativeCreationValue(this.target.provider, row, key, settings[key]);
                    return { path: field.path, state: same(value, field.intended) ? 'matching' as const : 'conflicting' as const, actual: value };
                }
                catch {
                    return { path: field.path, state: 'unknown' as const, actual: null };
                }
            });
            await this.account(b, false);
            const matching = fieldObservations.every(field => field.state === 'matching');
            return { operationId: plan.operationId, stepId: step.id, outcome: matching ? 'confirmed' : 'unknown', creationHint: null, nativeResource: resource, fieldObservations, observed: { identity: resource, selected: Object.fromEntries(fieldObservations.filter(f => f.state !== 'unknown').map(f => [f.path, f.actual])) }, receipts: b.receipts, reason: matching ? 'Current original named native configuration matches. This accounts for current settings, not product ownership or causation.' : 'Original created configuration is partial or unavailable; retain identity and reconcile without POST replay' };
        }
        catch {
            return { ...resource ? { nativeResource: resource } : {}, operationId: plan.operationId, stepId: step.id, outcome: 'unknown', creationHint: null, fieldObservations: step.fields.map(field => ({ path: field.path, state: 'unknown', actual: null })), observed: null, receipts: b.receipts, reason: 'Original native creation resource readback unavailable or identity differs; retain the original intent and any recorded native ID without replay' };
        }
    }
    private async reconcile(plan: RepositoryPlan, step: RepositoryStep, b: Budget): Promise<ConfigurationReconciliation> {
        const profile = this.parseProfile(plan.profile), group = step.kind === 'patch-native-repository' ? 'repository' : 'protection', selectedProfile = group === 'repository' ? { provider: profile.provider, version: profile.version, repository: profile.repository! } : { provider: profile.provider, version: profile.version, protection: profile.protection! }, snapshot = await this.snapshot(b, selectedProfile, false), resource = snapshot.resources[group];
        if (!resource || !same(resource.identity, object(step.basis).identity))
            throw Error('Native original resource identity differs during readback');
        const fieldObservations = step.fields.map(f => { const actual = resource.selected[f.path.slice(group.length + 1)]; return { path: f.path, state: same(actual, f.intended) ? 'matching' as const : 'conflicting' as const, actual }; });
        return { operationId: plan.operationId, stepId: step.id, outcome: fieldObservations.every(f => f.state === 'matching') ? 'confirmed' : 'unknown', creationHint: null, fieldObservations, observed: { identity: resource.identity, selected: resource.selected }, receipts: b.receipts, reason: fieldObservations.every(f => f.state === 'matching') ? 'Current original native resource settings observed matching; causation is not established' : 'Current original native settings differ; retain the exact step and inspect partial effects' };
    }
    async reconcileConfigurationStep(input: RepositoryRetained, signal?: AbortSignal) {
        const captured = this.step(input), b = this.budget(signal);
        if (captured.step.kind === 'create-native-protection')
            return this.reconcileCreated(captured.plan, captured.step, b, input.nativeResource);
        try {
            return await this.reconcile(captured.plan, captured.step, b);
        }
        catch {
            return { operationId: captured.plan.operationId, stepId: captured.step.id, outcome: 'unknown' as const, creationHint: null, fieldObservations: captured.step.fields.map(f => ({ path: f.path, state: 'unknown' as const, actual: null })), observed: null, receipts: b.receipts, reason: 'Original native readback unavailable; no replay or absence is inferred' };
        }
    }
}
export function openNativeConfigurationSession(options: RepositoryReadOptions, target: ProviderConfigurationTarget) { return new NativeConfigurationSession(options, target); }
/** Internal owned HTTP endpoint; target identity stays its original canonical HTTPS base. */
export function createOwnedNativeConfigurationSession(options: RepositoryReadOptions, target: ProviderConfigurationTarget, origin: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin)
        throw Error('Owned loopback configuration fixture required');
    return new NativeConfigurationSession(options, target, origin);
}

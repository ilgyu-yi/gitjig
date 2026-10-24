import { randomUUID } from 'node:crypto';
import { acceptanceContextResources, type CreatedAcceptanceContext } from './hosted-context.js';
import { GitHubReadClient } from './github-read-client.js';
import { nativeConfigurationTransport, type NativeConfigurationTransport, type ReadLimits, type ReadTransport } from './github-transport.js';
import { createNativeCapabilityObserver, createNativePublicOwnerCapabilityObserver } from './github-capability.js';
import { createNativePolicyObserver } from './github-policy.js';
import { normalizePolicyRule, normalizePolicySet, policyCanonical, policyHash, policyObject, policyText, policyId } from './github-policy-schema.js';
import { parseConfigurationProfile } from './github-configuration-profile.js';
import type { ConfigurationPlan, ConfigurationPreviewInput, ConfigurationStep, ConfigurationReceipt, ConfigurationTarget, ConfigurationProfile, PreparedConfigurationStep, ConfigurationAttempt, RetainedConfigurationStep, ConfigurationReconciliation, ConfigurationResourceHint, ConfigurationAccountObservation, ConfigurationResourceObservation } from './github-configuration-types.js';
const canonicalOrigin = 'https://api.github.com';
const mergeKeys = { merge: 'allow_merge_commit', squash: 'allow_squash_merge', rebase: 'allow_rebase_merge' } as const;
function limits(input?: Partial<ReadLimits>): ReadLimits {
    const value = { requestTimeoutMs: 10000, responseBytes: 1024 * 1024, pages: 100, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...input };
    const max = { requestTimeoutMs: 120000, responseBytes: 16 * 1024 * 1024, pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    for (const key of Object.keys(value) as (keyof ReadLimits)[])
        if (!Object.hasOwn(max, key) || !Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > max[key])
            throw Error('Finite configuration read limits required');
    return value;
}
function route(t: ConfigurationTarget) {
    if (t.host !== 'github.com' || !['public', 'private'].includes(t.visibility))
        throw Error('Canonical configuration host/visibility required');
    policyId(t.repositoryId);
    policyId(t.actorUserId);
    policyText(t.repositoryNodeId);
    for (const value of [t.owner, t.repository])
        if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value))
            throw Error('Canonical configuration repository required');
    return `/repos/${t.owner}/${t.repository}`;
}
function repoIdentity(value: unknown, t: ConfigurationTarget) {
    const r = policyObject(value), owner = policyObject(r.owner);
    if (r.id !== t.repositoryId || r.node_id !== t.repositoryNodeId || r.full_name !== t.owner + '/' + t.repository || r.url !== canonicalOrigin + route(t) || r.visibility !== t.visibility || r.private !== (t.visibility === 'private') || owner.id !== t.actorUserId || owner.type !== 'User' || owner.login !== t.owner)
        throw Error('Configuration repository identity/visibility differs');
    return { id: r.id, nodeId: r.node_id, fullName: r.full_name, visibility: r.visibility as string, ownerId: owner.id };
}
function mergeState(value: unknown) {
    const r = policyObject(value), out: Record<string, boolean> = {};
    for (const key of Object.values(mergeKeys)) {
        if (typeof r[key] !== 'boolean')
            throw Error('Observed merge-method tuple unavailable');
        out[key] = r[key] as boolean;
    }
    return out;
}
function rules(profile: NonNullable<ConfigurationProfile['ruleset']>, existing: unknown[] = []): unknown[] {
    const rows = new Map(existing.map(raw => { const r = policyObject(raw); return [policyText(r.type), structuredClone(r)] as const; }));
    for (const [type, enabled] of [['non_fast_forward', profile.nonFastForward], ['deletion', profile.deletion]] as const) {
        if (enabled)
            rows.set(type, { type });
        else
            rows.delete(type);
    }
    if (Object.hasOwn(profile, 'pullRequest')) {
        const p = profile.pullRequest;
        if (p) {
            const existingPr = rows.get('pull_request') as Record<string, unknown> | undefined;
            // Only a genuinely new PR rule receives explicit provider operands.
            // Existing understood values, including optional-field absence, remain intact.
            const parameters = existingPr ? existingPr.parameters as Record<string, unknown> : {
                required_reviewers: [], allowed_merge_methods: ['merge', 'squash', 'rebase'],
                require_extra_approval_for_unattributed_changes: true,
            };
            rows.set('pull_request', { type: 'pull_request', parameters: { ...parameters, required_approving_review_count: p.approvingCount, dismiss_stale_reviews_on_push: p.dismissStale, require_last_push_approval: p.lastPushApproval, require_code_owner_review: p.codeOwner, required_review_thread_resolution: p.threadResolution } });
        }
        else
            rows.delete('pull_request');
    }
    if (Object.hasOwn(profile, 'statusChecks')) {
        const c = profile.statusChecks;
        if (c)
            rows.set('required_status_checks', { type: 'required_status_checks', parameters: { ...((rows.get('required_status_checks') as Record<string, unknown> | undefined)?.parameters as Record<string, unknown> | undefined), required_status_checks: c.contexts.map(x => ({ context: x.context, ...(x.integrationId === undefined ? {} : { integration_id: x.integrationId }) })), strict_required_status_checks_policy: c.strict } });
        else
            rows.delete('required_status_checks');
    }
    return [...rows.values()];
}
function ownedWritable(value: unknown) {
    const raw = policyObject(value), normalized = normalizePolicySet(raw);
    const known = ['id', 'node_id', 'name', 'source', 'source_type', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors', 'current_user_can_bypass', 'created_at', 'updated_at', '_links'];
    if (Object.keys(raw).some(key => !known.includes(key)) || normalized.target !== 'branch' || normalized.sourceType !== 'Repository' || normalized.rules.some(r => !r.supported) || normalized.actors === null || normalized.actors.some(a => a.type !== 'User' || !['always', 'pull_request'].includes(a.mode)))
        throw Error('Owned ruleset has unsupported writable semantics; preview/manual preserves it');
    const conditions = policyObject(raw.conditions);
    if (Object.keys(conditions).some(k => k !== 'ref_name'))
        throw Error('Unsupported owned rule conditions');
    const refs = policyObject(conditions.ref_name);
    if (Object.keys(refs).some(k => !['include', 'exclude'].includes(k)) || !Array.isArray(refs.include) || !Array.isArray(refs.exclude) || [...refs.include, ...refs.exclude].some(v => typeof v !== 'string'))
        throw Error('Unsupported owned ref condition');
    policyText(raw.name);
    return Object.fromEntries(['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'].map(k => [k, structuredClone(raw[k])]));
}
/** Read/preview only in this first vertical. No production or fixture write entry yet. */
interface ConfigurationContext {
    signal: AbortSignal;
    receipts: ConfigurationReceipt[];
    read: ReadTransport;
    start: NativeConfigurationTransport;
}
interface SavedConfiguration {
    plan: ConfigurationPlan;
    step: ConfigurationStep;
    bytes: Uint8Array;
    context: ConfigurationContext;
    used: boolean;
    revisionId: string;
}
class ConfigurationReader {
    readonly credentialSessionId = randomUUID();
    private readonly prepared = new WeakMap<PreparedConfigurationStep, SavedConfiguration>();
    private readonly invoked = new Set<string>();
    readonly #fixtureWrites: boolean;
    readonly #publicOwner: boolean;
    constructor(private readonly native: NativeConfigurationTransport, private readonly bounds: ReadLimits, readonly activation: 'disabled' | 'owned-fixture-only' | 'created-private-local-acceptance' | 'public-personal-owner/v1') { this.#fixtureWrites = activation !== 'disabled'; this.#publicOwner = activation === 'public-personal-owner/v1'; }
    private context(callerSignal?: AbortSignal): ConfigurationContext {
        const signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(this.bounds.requestTimeoutMs)]), receipts: ConfigurationReceipt[] = [];
        let calls = 0, bytes = 0, items = 0;
        const start: NativeConfigurationTransport = (url, request, requestedSignal) => {
            signal.throwIfAborted();
            requestedSignal?.throwIfAborted();
            if (url.origin !== canonicalOrigin)
                throw Error('Configuration canonical endpoint changed');
            if (calls >= this.bounds.pages)
                throw Error('Configuration global request allowance exhausted');
            calls++;
            const result = this.native(url, request, signal);
            return { handoff: result.handoff, response: result.response.then(r => {
                    receipts.push({ route: url.pathname + url.search, method: request.method, status: r.status, bodyHash: r.bodyHash, bodyBytes: r.bodyBytes, requestId: r.requestId });
                    bytes += r.bodyBytes;
                    items += Array.isArray(r.data) ? r.data.length : 0;
                    if (bytes > this.bounds.collectionBytes || items > this.bounds.collectionItems)
                        throw Error('Configuration global byte/item allowance exhausted');
                    return r;
                }) };
        };
        return { signal, receipts, start, read: (url, s) => start(url, { method: 'GET' }, s).response };
    }
    async previewConfiguration(input: ConfigurationPreviewInput, callerSignal?: AbortSignal): Promise<ConfigurationPlan> { return this.preview(input, this.context(callerSignal)); }
    private async preview(input: ConfigurationPreviewInput, context: ConfigurationContext): Promise<ConfigurationPlan> {
        const captured = structuredClone(input), profile = parseConfigurationProfile(captured.desired), base = route(captured.target);
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(captured.operationId))
            throw Error('Host configuration operation identity required');
        const { signal, receipts, read } = context;
        const client = new GitHubReadClient(canonicalOrigin, read, this.bounds), user = await client.authenticatedUser(signal);
        if (user.status !== 200 || policyObject(user.data).id !== captured.target.actorUserId || policyObject(user.data).type !== 'User')
            throw Error('Actual configuration User identity unavailable');
        const response = await client.repository(captured.target.owner, captured.target.repository, signal);
        if (response.status !== 200)
            throw Error('Configuration repository unavailable');
        const identity = repoIdentity(response.data, captured.target), steps: ConfigurationStep[] = [], manual: string[] = [], preserved = ['Unselected repository fields are not transmitted', 'Third-party and parent rulesets are not writable through this plan'];
        if (profile.ruleset) {
            const inventory = await client.repositoryRulesets(captured.target.owner, captured.target.repository, signal);
            const ids = new Set<string>();
            for (const item of inventory.items) {
                const r = policyObject(item), key = policyCanonical([r.source_type, r.source, policyId(r.id)]);
                if (ids.has(key))
                    throw Error('Repeated configuration inventory identity');
                ids.add(key);
            }
            let writable: Record<string, unknown> | undefined, current: unknown = null;
            if (captured.ownedRuleset) {
                policyId(captured.ownedRuleset.id);
                policyText(captured.ownedRuleset.nodeId);
                const detail = await client.repositoryRuleset(captured.target.owner, captured.target.repository, captured.ownedRuleset.id, signal);
                if (detail.status !== 200)
                    throw Error('Owned configuration resource unavailable');
                const d = policyObject(detail.data);
                if (d.id !== captured.ownedRuleset.id || d.node_id !== captured.ownedRuleset.nodeId || d.source_type !== 'Repository' || d.source !== captured.target.owner + '/' + captured.target.repository || !inventory.items.some(x => { const m = policyObject(x); return m.id === d.id && m.node_id === d.node_id && m.source_type === d.source_type && m.source === d.source; }))
                    throw Error('Owned configuration resource identity differs');
                try {
                    writable = ownedWritable(d);
                    current = structuredClone(writable);
                }
                catch (error) {
                    manual.push(error instanceof Error ? error.message : 'Owned configuration unsupported');
                }
            }
            if (!captured.ownedRuleset || writable) {
                const p = profile.ruleset, payload = { ...(writable ?? {}), name: captured.ownedRuleset ? p.name : `gitjig/${p.name}/${captured.operationId}`, target: 'branch', enforcement: p.enforcement, conditions: { ref_name: { include: [...p.include], exclude: [...p.exclude] } }, rules: rules(p, (writable?.rules as unknown[] | undefined) ?? []), bypass_actors: p.bypassUsers.map(a => ({ actor_type: 'User', actor_id: a.userId, bypass_mode: a.mode })) };
                if (policyCanonical(current) !== policyCanonical(payload)) {
                    const kind = captured.ownedRuleset ? 'update-owned-ruleset' : 'create-ruleset';
                    const basis = { identity, owned: captured.ownedRuleset ?? null, writable: current };
                    steps.push({ id: kind, kind, route: base + '/rulesets' + (captured.ownedRuleset ? '/' + captured.ownedRuleset.id : ''), method: captured.ownedRuleset ? 'PUT' : 'POST', basis, basisHash: policyHash(basis), payload, payloadHash: policyHash(payload), fields: Object.keys(payload).filter(k => policyCanonical((current as Record<string, unknown> | null)?.[k] ?? null) !== policyCanonical(payload[k as keyof typeof payload])).map(k => ({ path: 'ruleset.' + k, before: (current as Record<string, unknown> | null)?.[k] ?? null, intended: payload[k as keyof typeof payload] })), ...(captured.ownedRuleset ? { ownedRuleset: captured.ownedRuleset } : {}) });
                }
            }
        }
        if (profile.mergeMethods) {
            const before = mergeState(response.data), payload: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(profile.mergeMethods))
                payload[mergeKeys[key as keyof typeof mergeKeys]] = value;
            const after = { ...before, ...payload };
            if (!Object.values(after).some(v => v === true))
                throw Error('At least one actual resulting merge method must remain enabled');
            const changes = Object.keys(payload).filter(k => payload[k] !== before[k]);
            if (changes.length) {
                const basis = { identity, mergeMethods: before };
                steps.push({ id: 'patch-merge-methods', kind: 'patch-merge-methods', route: base, method: 'PATCH', basis, basisHash: policyHash(basis), payload, payloadHash: policyHash(payload), fields: changes.map(k => ({ path: k, before: before[k], intended: payload[k] })) });
            }
        }
        return { operationId: captured.operationId, target: captured.target, profile, profileHash: policyHash(profile), steps, preserved, manual, limitations: ['Native PUT/PATCH have no claimed server CAS; same-object concurrent edits may race preflight', 'Visible metadata/granted scopes are not actual Administration-write acceptance', 'Actual effective guidance requires current native policy observation, not profile files', this.activation === 'public-personal-owner/v1' ? 'Normal writes require current PUBLIC personal nonfork User/admin/granted-scope operands; actual native server decides acceptance' : 'Only the declared fixture/context mutation profile is available'], receipts, activation: this.activation };
    }
    private step(plan: ConfigurationPlan, id: string): ConfigurationStep {
        route(plan.target);
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(plan.operationId) || plan.profileHash !== policyHash(parseConfigurationProfile(plan.profile)))
            throw Error('Configuration plan/profile identity differs');
        const matches = plan.steps.filter(step => step.id === id);
        if (matches.length !== 1)
            throw Error('Exact configuration step required');
        const step = matches[0]!;
        const base = route(plan.target), expected = step.kind === 'create-ruleset' ? { id: 'create-ruleset', method: 'POST', route: base + '/rulesets' } : step.kind === 'update-owned-ruleset' ? { id: 'update-owned-ruleset', method: 'PUT', route: base + '/rulesets/' + policyId(step.ownedRuleset?.id) } : step.kind === 'patch-merge-methods' ? { id: 'patch-merge-methods', method: 'PATCH', route: base } : null;
        if (!expected || step.id !== expected.id || step.method !== expected.method || step.route !== expected.route || step.basisHash !== policyHash(step.basis) || step.payloadHash !== policyHash(step.payload))
            throw Error('Configuration step family/route/basis/payload differs');
        configurationPayloadBytes(step);
        return step;
    }
    private async account(target: ConfigurationTarget, context: ConfigurationContext): Promise<ConfigurationAccountObservation> {
        const capability = (this.#publicOwner ? createNativePublicOwnerCapabilityObserver : createNativeCapabilityObserver)(context.read, this.bounds.requestTimeoutMs);
        const native = await capability.observePublicationCapability({ expectedUserId: target.actorUserId, target: { owner: target.owner, repository: target.repository, repositoryId: target.repositoryId, repositoryNodeId: target.repositoryNodeId, visibility: target.visibility }, action: 'create-comment' }, context.signal);
        return { kind: 'configuration-account-operands', credentialSessionId: this.credentialSessionId, native, writeAcceptance: 'unestablished', activation: 'disabled' };
    }
    observeConfigurationAccount(target: ConfigurationTarget, signal?: AbortSignal): Promise<ConfigurationAccountObservation> { const captured = structuredClone(target); route(captured); return this.account(captured, this.context(signal)); }
    async observeConfigurationGuidance(input: {
        target: ConfigurationTarget;
        branch: string;
    }, signal?: AbortSignal) {
        const captured = structuredClone(input), context = this.context(signal);
        route(captured.target);
        let policy: Awaited<ReturnType<ReturnType<typeof createNativePolicyObserver>['observeTargetPolicy']>> | null = null;
        let mergeMethods: Record<string, boolean> | null = null;
        const conditions: string[] = [];
        try {
            policy = await createNativePolicyObserver(context.start, this.bounds).observeTargetPolicy({ expectedUserId: captured.target.actorUserId, target: { owner: captured.target.owner, repository: captured.target.repository, repositoryId: captured.target.repositoryId, repositoryNodeId: captured.target.repositoryNodeId, visibility: captured.target.visibility }, branch: captured.branch, expectedBase: await this.guidanceBase(captured.target, captured.branch, context) }, context.signal);
        }
        catch (error) {
            conditions.push(String(error));
        }
        try {
            const response = await context.read(new URL(route(captured.target), canonicalOrigin), context.signal);
            if (response.status !== 200)
                throw Error('Merge-method guidance unavailable');
            repoIdentity(response.data, captured.target);
            mergeMethods = mergeState(response.data);
        }
        catch (error) {
            conditions.push(String(error));
        }
        return { credentialSessionId: this.credentialSessionId, policy, mergeMethods, receipts: context.receipts, conditions, activation: 'disabled' as const };
    }
    private async guidanceBase(target: ConfigurationTarget, branch: string, context: ConfigurationContext): Promise<string> {
        if (!branch || branch.length > 1024 || /[\x00-\x20\x7f]/.test(branch) || branch === '.' || branch === '..')
            throw Error('Literal guidance branch required');
        const result = await context.read(new URL(route(target) + '/git/ref/heads/' + encodeURIComponent(branch), canonicalOrigin), context.signal);
        if (result.status !== 200)
            throw Error('Current guidance base unavailable');
        const r = policyObject(result.data), o = policyObject(r.object);
        if (r.ref !== 'refs/heads/' + branch || o.type !== 'commit' || typeof o.sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(o.sha))
            throw Error('Current guidance head identity unavailable');
        return o.sha;
    }
    async prepareConfigurationStep(input: {
        plan: ConfigurationPlan;
        stepId: string;
        revisionId?: string;
    }, signal: AbortSignal): Promise<PreparedConfigurationStep> {
        if (!this.#fixtureWrites || this.#publicOwner && input.plan.target.visibility !== 'public')
            throw Error('HOSTED_CONFIGURATION_DISABLED: authorized Administration-write acceptance unavailable');
        const captured = structuredClone(input), step = this.step(captured.plan, captured.stepId), context = this.context(signal), revisionId = captured.revisionId ?? 'initial';
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(revisionId))
            throw Error('Host configuration revision identity required');
        const key = this.invocationKey(captured.plan, step, revisionId);
        if (captured.plan.manual.length || this.invoked.has(key))
            throw Error('Manual or previously invoked configuration cannot prepare; read-only reconcile');
        const account = await this.account(captured.plan.target, context);
        if (account.native.state !== 'matched')
            throw Error('Current same-credential User/admin/granted-scope operands unavailable');
        const desired: ConfigurationProfile = step.kind === 'patch-merge-methods' ? { version: captured.plan.profile.version, mergeMethods: captured.plan.profile.mergeMethods! } : { version: captured.plan.profile.version, ruleset: captured.plan.profile.ruleset! };
        const fresh = await this.preview({ operationId: captured.plan.operationId, target: captured.plan.target, desired, ...(step.ownedRuleset ? { ownedRuleset: step.ownedRuleset } : {}) }, context), now = fresh.steps.find(value => value.id === step.id);
        if (fresh.manual.length || !now || now.basisHash !== step.basisHash || now.payloadHash !== step.payloadHash || policyCanonical(now.fields) !== policyCanonical(step.fields))
            throw Error('Configuration relevant basis/desired delta drift; revised preview required');
        if (step.kind === 'create-ruleset') {
            const client = new GitHubReadClient(canonicalOrigin, context.read, this.bounds), list = await client.repositoryRulesets(captured.plan.target.owner, captured.plan.target.repository, context.signal);
            if (list.items.some(raw => policyObject(raw).name === step.payload.name))
                throw Error('Creation correlation already visible; reconcile without another POST');
        }
        context.signal.throwIfAborted();
        const handle = Object.freeze({ operationId: captured.plan.operationId, stepId: step.id, payloadHash: step.payloadHash, credentialSessionId: this.credentialSessionId, revisionId });
        this.prepared.set(handle, { plan: captured.plan, step, bytes: configurationPayloadBytes(step), context, used: false, revisionId });
        return handle;
    }
    private invocationKey(plan: ConfigurationPlan, step: ConfigurationStep, revisionId: string) { return plan.operationId + ':' + step.id + (step.kind === 'create-ruleset' ? '' : ':' + revisionId); }
    inspectPreparedConfigurationPayload(handle: PreparedConfigurationStep) {
        const saved = this.prepared.get(handle);
        if (!saved)
            throw Error('Foreign configuration handle');
        return { jsonUtf8: Uint8Array.from(saved.bytes), sha256: handle.payloadHash };
    }
    private unknownFields(step: ConfigurationStep) { return step.fields.map(field => ({ path: field.path, state: 'unknown' as const, actual: null })); }
    private compareFields(step: ConfigurationStep, value: Record<string, unknown>) { return step.fields.map(field => { const key = field.path.replace(/^ruleset\./, ''), actual = value[key]; return { path: field.path, state: actual === undefined ? 'unknown' as const : this.sameValue(key, actual, field.intended) ? 'matching' as const : 'conflicting' as const, actual: actual ?? null }; }); }
    private sameValue(key: string, a: unknown, b: unknown): boolean {
        const normalize = (v: unknown): unknown => {
            if (key === 'rules') {
                if (!Array.isArray(v))
                    throw Error('Configuration rules unavailable');
                return v.map(r => normalizePolicyRule(r).meaning).sort((x, y) => policyCanonical(x).localeCompare(policyCanonical(y)));
            }
            if (key === 'bypass_actors') {
                if (!Array.isArray(v))
                    throw Error('Configuration actors unavailable');
                return [...v].sort((x, y) => policyCanonical(x).localeCompare(policyCanonical(y)));
            }
            if (key === 'conditions') {
                const c = policyObject(v), r = policyObject(c.ref_name);
                if (!Array.isArray(r.include) || !Array.isArray(r.exclude))
                    throw Error('Configuration condition unavailable');
                return { ...c, ref_name: { ...r, include: [...r.include].sort(), exclude: [...r.exclude].sort() } };
            }
            return v;
        };
        try {
            return policyCanonical(normalize(a)) === policyCanonical(normalize(b));
        }
        catch {
            return false;
        }
    }
    private ruleHint(value: unknown, target: ConfigurationTarget): ConfigurationResourceHint {
        const r = policyObject(value);
        if (r.source_type !== 'Repository' || r.source !== target.owner + '/' + target.repository || r.target !== 'branch')
            throw Error('Configuration rule target/source differs');
        return { id: policyId(r.id), nodeId: policyText(r.node_id) };
    }
    private async get(context: ConfigurationContext, path: string): Promise<unknown> {
        const r = await context.read(new URL(path, canonicalOrigin), context.signal);
        if (r.status !== 200)
            throw Error('Configuration readback unavailable');
        return r.data;
    }
    private async readStep(plan: ConfigurationPlan, step: ConfigurationStep, context: ConfigurationContext, hint?: ConfigurationResourceHint) {
        const target = plan.target, base = route(target);
        let observed: Record<string, unknown>, creationHint: ConfigurationResourceHint | null = null, understood = true, resourceObservation: ConfigurationResourceObservation | undefined;
        if (step.kind === 'patch-merge-methods') {
            const value = await this.get(context, base);
            repoIdentity(value, target);
            observed = mergeState(value);
            understood = Object.values(observed).some(v => v === true);
        }
        else {
            let identity = hint ?? step.ownedRuleset;
            if (identity) {
                policyId(identity.id);
                policyText(identity.nodeId);
                if (step.ownedRuleset && (identity.id !== step.ownedRuleset.id || identity.nodeId !== step.ownedRuleset.nodeId))
                    throw Error('Known configuration resource identity differs');
            }
            else {
                const client = new GitHubReadClient(canonicalOrigin, context.read, this.bounds), list = await client.repositoryRulesets(target.owner, target.repository, context.signal);
                const candidates: Record<string, unknown>[] = [], seen = new Set<string>();
                for (const item of list.items) {
                    const r = policyObject(item);
                    policyId(r.id);
                    policyText(r.node_id);
                    policyText(r.name);
                    if (typeof r.source_type !== 'string' || !['Repository', 'Organization', 'Enterprise'].includes(r.source_type) || typeof r.source !== 'string')
                        throw Error('Configuration lookup incomplete native identity');
                    const key = policyCanonical([r.source_type, r.source, r.id]);
                    if (seen.has(key))
                        throw Error('Configuration lookup repeated identity');
                    seen.add(key);
                    if (r.source_type === 'Repository' && r.source === target.owner + '/' + target.repository && r.name === step.payload.name)
                        candidates.push(r);
                }
                if (candidates.length !== 1)
                    throw Error('Configuration lookup is zero/ambiguous; never resend POST');
                identity = { id: policyId(candidates[0]!.id), nodeId: policyText(candidates[0]!.node_id) };
            }
            const value = await this.get(context, base + '/rulesets/' + identity.id + '?includes_parents=true'), actual = this.ruleHint(value, target);
            if (actual.id !== identity.id || actual.nodeId !== identity.nodeId)
                throw Error('Configuration detail identity differs');
            creationHint = actual;
            const raw = policyObject(value);
            try {
                observed = ownedWritable(raw);
            }
            catch {
                understood = false;
                observed = Object.fromEntries(['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'].filter(k => Object.hasOwn(raw, k)).map(k => [k, raw[k]]));
            }
            // Observable same-path repo replacement cannot confirm even an exact rule ID/body.
            const repository = repoIdentity(await this.get(context, base), target);
            if (understood)
                resourceObservation = {
                    version: 'configuration-resource-observation/v1', kind: 'ruleset', identity: actual,
                    identitySource: hint ? 'retained-post-hint' : step.ownedRuleset ? 'owned-plan' : 'name-correlation',
                    sourceType: 'Repository', source: raw.source as string, target: 'branch', repository, supported: true,
                };
        }
        const fields = this.compareFields(step, observed), allPayload = Object.keys(step.payload).every(key => Object.hasOwn(observed, key) && this.sameValue(key, observed[key], step.payload[key]));
        return { observed, fieldObservations: fields, creationHint, ...(resourceObservation ? { resourceObservation } : {}), matched: understood && allPayload && fields.every(f => f.state === 'matching') };
    }
    invokePreparedConfigurationStep(handle: PreparedConfigurationStep): Promise<ConfigurationAttempt> {
        const saved = this.prepared.get(handle);
        if (!saved || saved.used)
            throw Error('Foreign or consumed configuration handle');
        saved.used = true;
        const { plan, step, context } = saved, key = this.invocationKey(plan, step, saved.revisionId), base = { operationId: plan.operationId, stepId: step.id, creationHint: null as ConfigurationResourceHint | null, observed: null as unknown, fieldObservations: this.unknownFields(step), receipts: context.receipts };
        if (!this.#fixtureWrites || this.#publicOwner && plan.target.visibility !== 'public')
            throw Error('HOSTED_CONFIGURATION_DISABLED');
        if (context.signal.aborted || this.invoked.has(key))
            return Promise.resolve({ ...base, handoff: 'not-started', outcome: 'refused', reason: 'Cancelled or previously invoked configuration; no resend' });
        let request: ReturnType<NativeConfigurationTransport>;
        try {
            request = context.start(new URL(step.route, canonicalOrigin), { method: step.method, body: saved.bytes }, context.signal);
            if (request.handoff === 'request-created')
                this.invoked.add(key);
        }
        catch {
            return Promise.resolve({ ...base, handoff: 'not-started', outcome: 'refused', reason: 'Native request was not created' });
        }
        // The native request/end above is synchronous. Caller MUST already COMMIT its intent.
        return (async () => {
            try {
                const response = await request.response;
                if (response.status !== (step.kind === 'create-ruleset' ? 201 : 200))
                    return { ...base, handoff: request.handoff, outcome: 'unknown', reason: 'Unsupported native status cannot prove absence or full application' } as ConfigurationAttempt;
                if (step.kind === 'create-ruleset')
                    base.creationHint = this.ruleHint(response.data, plan.target);
                else if (step.kind === 'update-owned-ruleset') {
                    const actual = this.ruleHint(response.data, plan.target);
                    if (actual.id !== step.ownedRuleset!.id || actual.nodeId !== step.ownedRuleset!.nodeId)
                        throw Error('Updated resource response identity differs');
                }
                else
                    repoIdentity(response.data, plan.target);
                const readback = await this.readStep(plan, step, context, base.creationHint ?? undefined);
                return { ...base, ...readback, handoff: request.handoff, outcome: readback.matched ? 'confirmed' : 'unknown', reason: readback.matched ? 'Exact current native values observed; no CAS/causality claim' : 'Partial/conflicting/unsupported native values observed' } as ConfigurationAttempt;
            }
            catch {
                return { ...base, handoff: request.handoff, outcome: 'unknown', reason: 'Native outcome/readback incomplete; read-only reconciliation, no resend' } as ConfigurationAttempt;
            }
        })();
    }
    async reconcileConfigurationStep(input: RetainedConfigurationStep, signal?: AbortSignal): Promise<ConfigurationReconciliation> {
        const captured = structuredClone(input), step = this.step(captured.plan, captured.stepId), context = this.context(signal), base = { operationId: captured.plan.operationId, stepId: step.id, creationHint: captured.creationHint ?? null, observed: null as unknown, fieldObservations: this.unknownFields(step), receipts: context.receipts };
        try {
            const current = await this.readStep(captured.plan, step, context, captured.creationHint);
            return { ...base, ...current, outcome: current.matched ? 'confirmed' : 'unknown', reason: current.matched ? 'Actual desired values observed; original transport uncertainty remains separate' : 'Current partial/conflicting/unsupported values require explicit revised recovery' };
        }
        catch {
            return { ...base, outcome: 'unknown', reason: 'Incomplete/ambiguous current read; no creation absence or resend proof' };
        }
    }
}
export function openGitHubConfigurationReader(options: {
    token: string;
    limits?: Partial<ReadLimits>;
}) { const b = limits(options.limits); return configurationFacade(new ConfigurationReader(nativeConfigurationTransport(options.token, b), b, 'public-personal-owner/v1')); }
/** Internal opaque context join; public configuration remains physically disabled. */
export function createContextConfigurationClient(context: CreatedAcceptanceContext) {
    const resources = acceptanceContextResources(context), client = new ConfigurationReader(resources.start, resources.limits, 'created-private-local-acceptance');
    const target = (t: ConfigurationTarget) => {
        resources.assertTarget(t);
        if (t.visibility !== 'private')
            throw Error('Exact private acceptance target required');
    };
    const profile = (p: ConfigurationProfile) => {
        const parsed = parseConfigurationProfile(p);
        if (parsed.ruleset) {
            for (const ref of [...parsed.ruleset.include, ...parsed.ruleset.exclude]) {
                if (!ref.startsWith('refs/heads/'))
                    throw Error('Literal fixture branch condition required');
                resources.assertBranch(ref.slice('refs/heads/'.length));
            }
            if (parsed.ruleset.bypassUsers.some(a => a.userId !== context.target.actorUserId || a.mode !== 'always'))
                throw Error('Exact fixture owning User/always required');
        }
    };
    return Object.freeze({
        credentialSessionId: client.credentialSessionId,
        activation: client.activation,
        previewConfiguration(input: ConfigurationPreviewInput, signal?: AbortSignal) { target(input.target); profile(input.desired); return client.previewConfiguration(input, signal); },
        observeConfigurationAccount(input: ConfigurationTarget, signal?: AbortSignal) { target(input); return client.observeConfigurationAccount(input, signal); },
        observeConfigurationGuidance(input: {
            target: ConfigurationTarget;
            branch: string;
        }, signal?: AbortSignal) { target(input.target); resources.assertBranch(input.branch); return client.observeConfigurationGuidance(input, signal); },
        prepareConfigurationStep(input: {
            plan: ConfigurationPlan;
            stepId: string;
            revisionId?: string;
        }, signal: AbortSignal) { target(input.plan.target); profile(input.plan.profile); return client.prepareConfigurationStep(input, signal); },
        inspectPreparedConfigurationPayload(handle: PreparedConfigurationStep) { resources.live(); return client.inspectPreparedConfigurationPayload(handle); },
        invokePreparedConfigurationStep(handle: PreparedConfigurationStep) { resources.live(); return client.invokePreparedConfigurationStep(handle); },
        reconcileConfigurationStep(input: RetainedConfigurationStep, signal?: AbortSignal) { target(input.plan.target); return client.reconcileConfigurationStep(input, signal); },
    });
}
/** Internal owned native HTTP fixture; never public/model alternate origin. */
export function createOwnedConfigurationFixture(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
        throw Error('Owned configuration fixture required');
    const b = limits(options.limits), native = nativeConfigurationTransport(options.token, b);
    return new ConfigurationReader((url, request, signal) => {
        if (url.origin !== canonicalOrigin)
            throw Error('Configuration canonical endpoint changed');
        return native(new URL(url.pathname + url.search, origin.origin), request, signal);
    }, b, 'owned-fixture-only');
}
/** Canonical final payload bytes; equality is a data identity, never an effect permit. */
export function configurationPayloadBytes(step: ConfigurationStep): Uint8Array {
    const bytes = Buffer.from(policyCanonical(step.payload));
    if (bytes.length > 132 * 1024)
        throw Error('Configuration payload exceeds native request byte limit');
    if (policyHash(step.payload) !== step.payloadHash)
        throw Error('Configuration payload hash differs');
    return Uint8Array.from(bytes);
}
/** Pure shape validation before owner allocation; never a permission observation. */
export function validateConfigurationTarget(target: ConfigurationTarget): void { route(structuredClone(target)); }
/** Internal localhost transport counterpart of the normal public owner profile. */
export function createOwnedPublicOwnerConfigurationClient(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
        throw Error('Owned public-owner fixture required');
    const bounds = limits(options.limits), native = nativeConfigurationTransport(options.token, bounds);
    return configurationFacade(new ConfigurationReader((url, request, signal) => {
        if (url.origin !== canonicalOrigin)
            throw Error('Configuration canonical endpoint changed');
        return native(new URL(url.pathname + url.search, origin), request, signal);
    }, bounds, 'public-personal-owner/v1'));
}
function configurationFacade(client: ConfigurationReader) {
    return Object.freeze({
        credentialSessionId: client.credentialSessionId, activation: client.activation,
        previewConfiguration: client.previewConfiguration.bind(client),
        observeConfigurationAccount: client.observeConfigurationAccount.bind(client),
        observeConfigurationGuidance: client.observeConfigurationGuidance.bind(client),
        prepareConfigurationStep: client.prepareConfigurationStep.bind(client),
        inspectPreparedConfigurationPayload: client.inspectPreparedConfigurationPayload.bind(client),
        invokePreparedConfigurationStep: client.invokePreparedConfigurationStep.bind(client),
        reconcileConfigurationStep: client.reconcileConfigurationStep.bind(client),
    });
}

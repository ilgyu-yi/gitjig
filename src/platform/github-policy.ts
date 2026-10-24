import { nativeJsonTransport, type NativeJsonTransport, type ReadLimits } from './github-transport.js';
import { GitHubReadClient } from './github-read-client.js';
import { fixedClassicTransport, type ClassicObservation } from './github-classic.js';
import { createNativeCapabilityObserver, type CapabilityTarget, type CapabilityObservation } from './github-capability.js';
import { normalizePolicyRule, normalizePolicySet, policyCanonical, policyHash, policyId, policyObject, policySetKey, policyText, type NativePolicySet } from './github-policy-schema.js';
export interface PolicyRequest {
    expectedUserId: number;
    target: CapabilityTarget;
    branch: string;
    expectedBase: string;
    referencedHead?: {
        branch: string;
        expectedCommit: string;
    };
}
export interface PolicyReceipt {
    route: string;
    method: 'GET' | 'POST';
    status: number;
    bodyHash: string;
    bodyBytes: number;
    requestId: string | null;
}
export interface PolicyRoute {
    /** Compatibility of the actually visible policy, not an absence/permission proof. */
    visiblePolicyFit: 'matched' | 'blocked' | 'unknown';
    state: 'blocked' | 'unknown';
    conditions: readonly string[];
}
export interface HostedPolicyObservation {
    normalVisibility?: {
        profile: 'public-personal-owner-no-classic/v1';
        fingerprintVersion: 'hosted-authority-fingerprint/v1';
        state: 'matched';
    };
    activation: 'disabled';
    profile: 'personal-nonfork-visible-branch-policy/v1';
    completeVisibleInputs: boolean;
    request: PolicyRequest;
    capability: CapabilityObservation | null;
    fingerprint: string | null;
    sets: readonly NativePolicySet[];
    applicableSetKeys: readonly string[];
    classic: {
        visibility: 'not-established';
        matchedRuleIds: readonly string[];
        completeVisibleConnections: boolean;
        viewerCanAdminister?: boolean;
        directRuleId?: string | null;
    };
    ordinary: PolicyRoute;
    override: PolicyRoute;
    receipts: readonly PolicyReceipt[];
    requests: number;
    bytes: number;
    items: number;
    conditions: readonly string[];
}
interface Options {
    token: string;
    limits?: Partial<ReadLimits>;
}
interface Collection {
    base: {
        id: string;
        commit: string;
    };
    head: {
        id: string;
        commit: string;
    } | null;
    sets: NativePolicySet[];
    applicable: string[];
    classic: ClassicObservation;
}
const origin = 'https://api.github.com';
function segment(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value) || value === '.' || value === '..')
        throw Error('Unsupported policy target segment');
    return encodeURIComponent(value);
}
function branch(value: string): string {
    if (!value || value.length > 1024 || /[\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.startsWith('/') || value.endsWith('/') || value.includes('..') || value.includes('@{') || value.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.') || p.endsWith('.lock')))
        throw Error('Unsupported literal policy branch');
    return encodeURIComponent(value);
}
function commit(value: string) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
        throw Error('Expected exact native commit identity');
}
export function policyReadLimits(input?: Partial<ReadLimits>): ReadLimits {
    const result: ReadLimits = { requestTimeoutMs: 10000, responseBytes: 1024 * 1024, pages: 100, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...input };
    const maxima: ReadLimits = { requestTimeoutMs: 120000, responseBytes: 16 * 1024 * 1024, pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    if (Object.keys(result).some(key => !Object.hasOwn(maxima, key)))
        throw Error('Unsupported policy read limit');
    for (const key of Object.keys(maxima) as (keyof ReadLimits)[])
        if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > maxima[key])
            throw Error('Finite policy read limits required');
    return result;
}
function arrayItems(value: unknown): number {
    if (Array.isArray(value))
        return value.length + value.reduce<number>((n, row) => n + arrayItems(row), 0);
    if (value && typeof value === 'object')
        return Object.values(value).reduce<number>((n, row) => n + arrayItems(row), 0);
    return 0;
}
export function openGitHubPolicyReader(options: Options) {
    const limits = policyReadLimits(options.limits), start = nativeJsonTransport(options.token, limits);
    return new PolicyReader(start, limits);
}
/** Internal owned fixture only; canonical validation still uses api.github.com identities. */
export function createOwnedPolicyFixture(options: Options & {
    origin: string;
}) {
    const url = new URL(options.origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash)
        throw Error('Owned loopback policy fixture required');
    const limits = policyReadLimits(options.limits), native = nativeJsonTransport(options.token, limits);
    return new PolicyReader((canonical, request, signal) => {
        if (canonical.origin !== origin)
            throw Error('Policy fixture canonical origin changed');
        return native(new URL(canonical.pathname + canonical.search, url.origin), request, signal);
    }, limits);
}
/** Internal same-capture normal composition; no public URL or authority input. */
export function createNativePublicOwnerPolicyObserver(start: NativeJsonTransport, limits?: Partial<ReadLimits>) {
    return new PolicyReader(start, policyReadLimits(limits), true);
}
/** Internal ordinary PR composition; branch-action capability and verdicts stay separate. */
export function createNativePublicOwnerMergePolicyObserver(start: NativeJsonTransport, limits?: Partial<ReadLimits>) {
    return new PolicyReader(start, policyReadLimits(limits), true, 'merge-pull-request');
}
class PolicyReader {
    constructor(private readonly native: NativeJsonTransport, private readonly limits: ReadLimits, private readonly normalPublic = false, private readonly normalAction: 'existing-ref-forward' | 'merge-pull-request' = 'existing-ref-forward') { }
    async observeTargetPolicy(input: PolicyRequest, callerSignal?: AbortSignal): Promise<HostedPolicyObservation> {
        const captured = structuredClone(input);
        segment(captured.target.owner);
        segment(captured.target.repository);
        branch(captured.branch);
        commit(captured.expectedBase);
        policyId(captured.expectedUserId);
        policyId(captured.target.repositoryId);
        policyText(captured.target.repositoryNodeId);
        if (captured.referencedHead) {
            branch(captured.referencedHead.branch);
            commit(captured.referencedHead.expectedCommit);
        }
        const signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(this.limits.requestTimeoutMs)]);
        const receipts: PolicyReceipt[] = [];
        let requests = 0, bytes = 0, items = 0, latestRepo: unknown, capability: CapabilityObservation | null = null, before: Collection | null = null;
        let budgetFailure: string | null = null;
        const bounded: NativeJsonTransport = (url, request, requestedSignal) => {
            signal.throwIfAborted();
            requestedSignal?.throwIfAborted();
            if (url.origin !== origin)
                throw Error('Policy native origin changed');
            if (requests >= this.limits.pages) {
                budgetFailure = 'Operation-global policy request allowance exhausted before native request';
                throw Error(budgetFailure);
            }
            requests++;
            const native = this.native(url, request, signal);
            return { handoff: native.handoff, response: native.response.then(response => {
                    receipts.push({ route: url.pathname + url.search, method: request.method, status: response.status, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes, requestId: response.requestId });
                    bytes += response.bodyBytes;
                    items += arrayItems(response.data);
                    if (bytes > this.limits.collectionBytes || items > this.limits.collectionItems) {
                        budgetFailure = 'Operation-global policy response byte/item allowance exhausted';
                        throw Error(budgetFailure);
                    }
                    if (url.pathname === repoPath && response.status === 200)
                        latestRepo = response.data;
                    return response;
                }) };
        };
        const read = (url: URL, requestedSignal?: AbortSignal) => bounded(url, { method: 'GET' }, requestedSignal).response;
        const client = new GitHubReadClient(origin, read, this.limits, fixedClassicTransport(origin, bounded));
        const cap = createNativeCapabilityObserver(read, this.limits.requestTimeoutMs);
        const repoPath = `/repos/${segment(captured.target.owner)}/${segment(captured.target.repository)}`;
        const capRequest = { expectedUserId: captured.expectedUserId, target: captured.target, action: this.normalPublic ? this.normalAction : 'create-comment' as const };
        const noRoute = (condition: string): PolicyRoute => ({ visiblePolicyFit: 'unknown', state: 'unknown', conditions: [condition] });
        const output = (ordinary: PolicyRoute, override: PolicyRoute, completeVisibleInputs: boolean, fingerprint: string | null, conditions: string[]): HostedPolicyObservation => ({ ...(this.normalPublic && completeVisibleInputs ? { normalVisibility: { profile: 'public-personal-owner-no-classic/v1' as const, fingerprintVersion: 'hosted-authority-fingerprint/v1' as const, state: 'matched' as const } } : {}), activation: 'disabled', profile: 'personal-nonfork-visible-branch-policy/v1', completeVisibleInputs, request: captured, capability, fingerprint, sets: before?.sets ?? [], applicableSetKeys: before?.applicable ?? [], classic: { visibility: 'not-established', matchedRuleIds: before?.classic.matchedRuleIds ?? [], completeVisibleConnections: before?.classic.completeVisibleConnections ?? false, ...(before?.classic.viewerCanAdminister === undefined ? {} : { viewerCanAdminister: before.classic.viewerCanAdminister }), ...(before?.classic.directRuleId === undefined ? {} : { directRuleId: before.classic.directRuleId }) }, ordinary, override, receipts, requests, bytes, items, conditions });
        const get = async (route: string) => {
            const result = await read(new URL(route, origin), signal);
            if (result.status !== 200)
                throw Error('Native policy identity/detail response unavailable');
            return result.data;
        };
        const ref = async (name: string, expected: string) => {
            const r = policyObject(await get(repoPath + '/git/ref/heads/' + branch(name))), value = policyObject(r.object);
            const url = new URL(policyText(r.url));
            if (r.ref !== 'refs/heads/' + name || value.type !== 'commit' || value.sha !== expected || url.origin !== origin || url.username || url.password || url.search || url.hash || decodeURIComponent(url.pathname) !== `${repoPath}/git/refs/heads/${name}`)
                throw Error('Policy target/head commit identity differs');
            return { id: policyText(r.node_id), commit: expected };
        };
        const collect = async (): Promise<Collection> => {
            const base = await ref(captured.branch, captured.expectedBase), head = captured.referencedHead ? await ref(captured.referencedHead.branch, captured.referencedHead.expectedCommit) : null;
            const list = await client.repositoryRulesets(captured.target.owner, captured.target.repository, signal), metadata = new Map<string, Record<string, unknown>>(), sets: NativePolicySet[] = [];
            for (const raw of list.items) {
                const row = policyObject(raw), key = policyCanonical([row.source_type, row.source, policyId(row.id)]);
                if (metadata.has(key))
                    throw Error('Ruleset inventory repeated an identity');
                metadata.set(key, row);
                if (!['Repository', 'Organization'].includes(String(row.source_type)))
                    throw Error('Ruleset source is outside the supported fixed detail routes');
                if (row.source_type === 'Repository' && row.source !== `${captured.target.owner}/${captured.target.repository}`)
                    throw Error('Ruleset repository source differs');
                if (row.source_type === 'Organization')
                    segment(policyText(row.source));
                const response = await client.repositoryRuleset(captured.target.owner, captured.target.repository, policyId(row.id), signal);
                if (response.status !== 200)
                    throw Error('Ruleset full detail unavailable');
                const detail = normalizePolicySet(response.data);
                if (policySetKey(detail) !== key || detail.nodeId !== policyText(row.node_id) || detail.enforcement !== row.enforcement)
                    throw Error('Ruleset list/detail identity or enforcement changed');
                if (detail.sourceType === 'Organization') {
                    const corroboration = await client.organizationRuleset(detail.source, detail.id, signal);
                    if (corroboration.status !== 200)
                        throw Error('Parent ruleset full detail unavailable');
                    const parent = normalizePolicySet(corroboration.data);
                    if (policyCanonical({ ...detail, currentBypass: null }) !== policyCanonical({ ...parent, currentBypass: null }))
                        throw Error('Parent ruleset details disagree across finite endpoints');
                }
                sets.push(detail);
            }
            const effective = await client.branchRules(captured.target.owner, captured.target.repository, captured.branch, signal), joined = new Map<string, string[]>();
            for (const raw of effective.items) {
                const r = policyObject(raw), sourceType = policyText(r.ruleset_source_type), source = policyText(r.ruleset_source), id = policyId(r.ruleset_id), key = policyCanonical([sourceType, source, id]);
                const set = sets.find(value => policySetKey(value) === key);
                if (!set || set.enforcement !== 'active' || (set.target !== 'branch' && set.target !== 'push'))
                    throw Error('Effective rule has no matching active full source set');
                const normalized = normalizePolicyRule(r, true), rows = joined.get(key) ?? [], signature = policyCanonical(normalized.meaning);
                if (!normalized.supported && set.rules.every(rule => rule.supported))
                    throw Error('Effective native rule has unsupported semantics absent from full detail');
                if (rows.includes(signature))
                    throw Error('Effective rules repeated one set obligation');
                rows.push(signature);
                joined.set(key, rows);
            }
            const applicable: string[] = [];
            for (const set of sets) {
                const key = policySetKey(set), rows = joined.get(key);
                if (rows && policyCanonical([...rows].sort()) !== policyCanonical(set.rules.map(r => policyCanonical(r.meaning)).sort()))
                    throw Error('Effective/full per-set rule multiset omitted or changed an obligation');
                if (set.enforcement !== 'active' || !set.rules.length)
                    continue;
                if (set.target === 'repository')
                    throw Error('Active repository-target rules unsupported for this landing profile');
                if (set.target === 'push' || rows)
                    applicable.push(key);
            }
            const classic = await client.classicTargetProtection(captured.target.owner, captured.target.repository, captured.branch, captured.target.repositoryNodeId, signal);
            if (this.normalPublic && (classic.viewerCanAdminister !== true || classic.directRuleId !== null || classic.matchedRuleIds.length))
                throw Error('Normal landing requires actual GraphQL admin and complete direct-null/no-classic agreement');
            if (this.normalPublic && sets.some(set => set.sourceType !== 'Repository'))
                throw Error('Normal landing inherited/unknown ruleset source unsupported');
            if (classic.target.oid !== captured.expectedBase)
                throw Error('Classic comparison target differs from expected B');
            const rest = await client.branchProtection(captured.target.owner, captured.target.repository, captured.branch, signal);
            if (![200, 404].includes(rest.status) || (rest.status === 200 && !classic.matchedRuleIds.length) || (rest.status === 404 && classic.matchedRuleIds.length))
                throw Error('Classic REST/visible matching observations unavailable or inconsistent');
            return { base, head, sets: sets.sort((a, b) => policySetKey(a).localeCompare(policySetKey(b))), applicable: applicable.sort(), classic };
        };
        try {
            capability = await cap.observePublicationCapability(capRequest, signal);
            if (capability.state !== 'matched')
                return output(noRoute('Actual native User/account/granted-scope operands unavailable'), noRoute('Actual native User/account/granted-scope operands unavailable'), false, null, [...capability.conditions, ...(budgetFailure ? [budgetFailure] : [])]);
            if (policyObject(latestRepo).fork !== false)
                throw Error('Initial landing profile requires explicit native nonfork repository; fork inheritance coverage unavailable');
            if (this.normalPublic && (captured.target.visibility !== 'public' || policyObject(latestRepo).private !== false))
                throw Error('Normal landing supports actual PUBLIC repositories only');
            before = await collect();
            const afterCap = await cap.observePublicationCapability(capRequest, signal);
            if (afterCap.state !== 'matched' || afterCap.credentialInstanceId !== capability.credentialInstanceId || policyCanonical(afterCap.grantedScopes) !== policyCanonical(capability.grantedScopes) || policyObject(latestRepo).fork !== false)
                throw Error('Native User/grants/visibility/fork state changed during policy observation');
            const after = await collect();
            const signature = (c: Collection) => ({ base: c.base, head: c.head, sets: c.sets, applicable: c.applicable, classic: { rules: c.classic.rules, target: c.classic.target, ...(this.normalPublic ? { admin: c.classic.viewerCanAdminister, direct: c.classic.directRuleId } : {}) } });
            if (policyCanonical(signature(before)) !== policyCanonical(signature(after)))
                throw Error('Observed policy/identity/base/head drift requires a fresh bounded observation');
            const applicable = before.sets.filter(set => before!.applicable.includes(policySetKey(set)));
            const route = (override: boolean): PolicyRoute => {
                const blockers: string[] = [], unknowns: string[] = [];
                if (before!.classic.matchedRuleIds.length)
                    blockers.push('Matching classic protection is outside both initial landing routes');
                for (const set of applicable) {
                    const label = policySetKey(set);
                    if (set.rules.some(rule => !rule.supported))
                        unknowns.push(`${label}: unsupported native rule/parameter semantics`);
                    if (!override) {
                        if (set.rules.some(rule => rule.type !== 'non_fast_forward' && rule.type !== 'deletion'))
                            blockers.push(`${label}: native PR/status or unsupported direct-branch obligation; intrinsic agent review is not platform approval`);
                        if (set.currentBypass !== 'never')
                            unknowns.push(`${label}: ordinary route cannot borrow automatic/unknown current actor bypass`);
                    }
                    else {
                        if (set.currentBypass !== 'always')
                            unknowns.push(`${label}: coherent native current actor always is absent`);
                        if (set.actors === null)
                            unknowns.push(`${label}: bypass actor visibility withheld`);
                        else if (!set.actors.some(actor => actor.type === 'User' && actor.id === captured.expectedUserId && actor.mode === 'always'))
                            blockers.push(`${label}: explicit actual User/always proof absent; Team/role/PR-only/exempt is not this override`);
                    }
                }
                const visiblePolicyFit = blockers.length ? 'blocked' : unknowns.length ? 'unknown' : 'matched';
                return { visiblePolicyFit, state: blockers.length ? 'blocked' : 'unknown', conditions: [...blockers, ...unknowns, this.normalPublic ? 'Bounded native public-owner policy observation is separate from current Controller standing and actual server decision' : 'Classic visibility/absence profile and real native action acceptance remain unestablished; activation disabled', ...(override ? ['Explicit owner override delegation/current intrinsic procedure remain core obligations'] : ['Forward-only B ancestry/expected-old lease and current intrinsic procedure remain core obligations'])] };
            };
            return output(route(false), route(true), true, policyHash({ ...(this.normalPublic ? { version: 'hosted-authority-fingerprint/v1', profile: 'public-personal-owner-no-classic/v1' } : {}), request: captured, nativeUser: capability.observedUserId, grantedScopes: capability.grantedScopes, policy: signature(before) }), [this.normalPublic ? 'Bounded public-owner native visibility profile is not universal visibility, permanent token authority or an effect permit' : 'Complete visible bounded inputs are not full visibility, token Contents-write or an effect permit', 'Best-current native observation only: expected-old B does not lease external policy/permissions or a separate PR head', 'No server policy CAS, native PR closure, self-account platform approval, or production activation is claimed']);
        }
        catch (error) {
            return output(noRoute('Required complete native policy input unavailable'), noRoute('Required complete native policy input unavailable'), false, null, [budgetFailure ?? (error instanceof Error ? error.message : 'Native policy observation unavailable')]);
        }
    }
}
/** Internal trusted fixed-origin seam: finite host clients share one captured transport/budget. */
export function createNativePolicyObserver(start: NativeJsonTransport, limits: ReadLimits) {
    return new PolicyReader(start, policyReadLimits(limits));
}

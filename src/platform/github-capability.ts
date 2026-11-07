import { randomUUID } from 'node:crypto';
import { nativeReadTransport, type ReadLimits, type ReadResponse, type ReadTransport } from './github-transport.js';
export interface CapabilityTarget {
    owner: string;
    repository: string;
    repositoryId: number;
    repositoryNodeId: string;
    visibility: 'public' | 'private';
}
export type CapabilityAction = 'create-issue' | 'create-draft-pr' | 'create-comment' | 'merge-pull-request';
export interface CapabilityRequest {
    expectedUserId: number;
    target: CapabilityTarget;
    action: CapabilityAction | 'existing-ref-forward';
}
export interface CapabilityReceipt {
    route: string;
    status: number;
    requestId: string | null;
    bodyHash: string;
    bodyBytes: number;
    grantedScopeHeader: string | null;
    acceptedScopeHeader: string | null;
    acceptedPermissionHeader: string | null;
}
export interface CapabilityObservation {
    profile: 'scope-bearing-user/personal-admin/v1' | 'existing-ruleset-history-gate/v1';
    credentialInstanceId: string;
    observedAt: string;
    state: 'matched' | 'denied' | 'unknown';
    activation: 'disabled';
    action: CapabilityAction | 'existing-ref-forward' | 'repository-ruleset-administration';
    target: CapabilityTarget;
    expectedUserId: number;
    observedUserId: number | null;
    grantedScopes: readonly string[] | null;
    receipts: readonly CapabilityReceipt[];
    conditions: readonly string[];
    ruleset?: {
        id: number;
        nodeId: string;
        versionId: number;
    };
}
interface Options {
    token: string;
    limits?: Partial<ReadLimits>;
}
interface Context {
    input: CapabilityRequest;
    receipts: CapabilityReceipt[];
    userId: number | null;
    scopes: string[] | null;
}
class ObservationFailure extends Error {
    constructor(readonly state: 'denied' | 'unknown', message: string) { super(message); }
}
function fail(message: string): never { throw new ObservationFailure('unknown', message); }
function denied(message: string): never { throw new ObservationFailure('denied', message); }
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail('Native identity object unavailable');
    return value as Record<string, unknown>;
}
function integer(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
        return fail('Native positive identity unavailable');
    return value as number;
}
function string(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 1024)
        return fail('Native text identity unavailable');
    return value;
}
function segment(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value) || value === '.' || value === '..')
        throw Error('Unsupported capability target segment');
    return encodeURIComponent(value);
}
function identityType(value: unknown): string {
    if (value !== 'User' && value !== 'Bot' && value !== 'Organization')
        return fail('Native identity type missing or unsupported');
    return value;
}
function login(value: unknown): string {
    const result = string(value);
    segment(result);
    return result;
}
function validate(input: CapabilityRequest) {
    integer(input.expectedUserId);
    integer(input.target.repositoryId);
    string(input.target.repositoryNodeId);
    segment(input.target.owner);
    segment(input.target.repository);
    if (!['public', 'private'].includes(input.target.visibility) || !['create-issue', 'create-draft-pr', 'create-comment', 'existing-ref-forward', 'merge-pull-request'].includes(input.action))
        throw Error('Unsupported finite capability request');
}
function limits(options: Options): ReadLimits {
    const result: ReadLimits = { requestTimeoutMs: 10000, responseBytes: 1024 * 1024, pages: 100, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...options.limits };
    const max: ReadLimits = { requestTimeoutMs: 120000, responseBytes: 16 * 1024 * 1024, pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    if (Object.keys(result).some(key => !Object.hasOwn(max, key)))
        throw Error('Unsupported capability read limit');
    for (const key of Object.keys(max) as (keyof ReadLimits)[])
        if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > max[key])
            throw Error('Finite capability read limits required');
    return result;
}
function scopes(header: string | null): string[] {
    if (header === null)
        return fail('Granted OAuth scopes header missing; accepted requirements cannot substitute');
    if (header.length > 8192)
        return fail('Granted OAuth scopes header exceeds supported bounds');
    if (!header.trim())
        return [];
    const parsed = header.split(',').map(value => value.trim());
    if (parsed.some(value => !/^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*$/.test(value)) || new Set(parsed).size !== parsed.length)
        return fail('Granted OAuth scopes header malformed/ambiguous');
    return parsed.sort();
}
function header(response: ReadResponse, name: string): string | null {
    return Object.hasOwn(response.visibility, name) ? response.visibility[name]! : null;
}
/** Read-only candidate observations. No writer or capability activation is returned. */
export function openGitHubCapabilityReader(options: Options) {
    const boundLimits = limits(options);
    return new CapabilityReader('https://api.github.com', nativeReadTransport(options.token, boundLimits), boundLimits.requestTimeoutMs);
}
/** Internal trusted policy composition: fixed canonical origin, same native validator.
 * Public options/CLI/model entries never accept this transport callback. */
export function createNativeCapabilityObserver(read: ReadTransport, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
        throw Error('Finite capability observation deadline required');
    return new CapabilityReader('https://api.github.com', read, timeoutMs);
}
/** Internal actual HTTP fixture entry; never routed from model/CLI input. */
export function createOwnedCapabilityFixture(options: Options & {
    origin: string;
}) {
    const url = new URL(options.origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash)
        throw Error('Owned loopback capability fixture required');
    const boundLimits = limits(options);
    return new CapabilityReader(url.origin, nativeReadTransport(options.token, boundLimits), boundLimits.requestTimeoutMs);
}
class CapabilityReader {
    private readonly credentialInstanceId = randomUUID();
    constructor(private readonly origin: string, private readonly read: ReadTransport, private readonly timeoutMs: number) { }
    private async get(route: string, context: Context, signal: AbortSignal) {
        const response = await this.read(new URL(route, this.origin), signal);
        context.receipts.push({ route, status: response.status, requestId: response.requestId, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes,
            grantedScopeHeader: header(response, 'x-oauth-scopes'), acceptedScopeHeader: header(response, 'x-accepted-oauth-scopes'), acceptedPermissionHeader: header(response, 'x-accepted-github-permissions') });
        if (response.status !== 200)
            return fail('Native identity/visibility response unavailable; status alone does not prove capability');
        return response;
    }
    private async personalTarget(context: Context, signal: AbortSignal) {
        const { target: t, expectedUserId } = context.input;
        const userResponse = await this.get('/user', context, signal), user = object(userResponse.data);
        context.userId = integer(user.id);
        const userType = identityType(user.type), userLogin = login(user.login);
        if (userType !== 'User' || user.id !== expectedUserId)
            return denied('Actual User does not match the selected owner profile');
        const repoPath = `/repos/${segment(t.owner)}/${segment(t.repository)}`;
        const repoResponse = await this.get(repoPath, context, signal), repo = object(repoResponse.data), owner = object(repo.owner);
        if (integer(repo.id) !== t.repositoryId || string(repo.node_id) !== t.repositoryNodeId || string(repo.full_name) !== `${t.owner}/${t.repository}` || repo.url !== `https://api.github.com${repoPath}`)
            return fail('Canonical repository identity differs from retained target');
        const ownerType = identityType(owner.type), ownerId = integer(owner.id), ownerLogin = login(owner.login);
        if (ownerType !== 'User' || ownerId !== expectedUserId || ownerLogin !== t.owner || userLogin !== t.owner)
            return denied('Target is outside the personally owned User profile');
        if (typeof repo.private !== 'boolean' || !['public', 'private'].includes(String(repo.visibility)) || repo.private !== (repo.visibility === 'private') || repo.visibility !== t.visibility)
            return fail('Repository visibility is missing/inconsistent/changed');
        const permissions = object(repo.permissions);
        if (typeof permissions.admin !== 'boolean' || typeof repo.archived !== 'boolean' || typeof repo.disabled !== 'boolean')
            return fail('Native account/target state unavailable');
        if (!permissions.admin)
            return denied('Native account admin operand is absent for this bounded profile');
        if (repo.archived || repo.disabled)
            return denied('Repository is archived or disabled');
        return { userResponse, repoResponse, repoPath, repo };
    }
    private result(context: Context, state: CapabilityObservation['state'], conditions: readonly string[], profile: CapabilityObservation['profile'] = 'scope-bearing-user/personal-admin/v1'): CapabilityObservation {
        return { profile, credentialInstanceId: this.credentialInstanceId, observedAt: new Date().toISOString(), state, activation: 'disabled', action: context.input.action, target: context.input.target, expectedUserId: context.input.expectedUserId, observedUserId: context.userId, grantedScopes: context.scopes, receipts: context.receipts, conditions };
    }
    async observePublicationCapability(input: CapabilityRequest, signal?: AbortSignal): Promise<CapabilityObservation> {
        const captured = structuredClone(input);
        validate(captured);
        const context: Context = { input: captured, receipts: [], userId: null, scopes: null };
        signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.timeoutMs)]);
        try {
            const actual = await this.personalTarget(context, signal);
            const userScopes = scopes(header(actual.userResponse, 'x-oauth-scopes')), repoScopes = scopes(header(actual.repoResponse, 'x-oauth-scopes'));
            if (JSON.stringify(userScopes) !== JSON.stringify(repoScopes))
                return fail('Fresh granted scope headers conflict');
            context.scopes = userScopes;
            const broad = userScopes.includes('repo') || (captured.target.visibility === 'public' && userScopes.includes('public_repo'));
            if (!broad)
                return denied('No native broad granted scope for the actual repository visibility');
            if (captured.action === 'create-issue') {
                if (typeof actual.repo.has_issues !== 'boolean')
                    return fail('Native issues-enabled state unavailable');
                if (!actual.repo.has_issues)
                    return denied('Issues are disabled on this repository');
            }
            return this.result(context, 'matched', ['Native scope/account/target operands match only; this is not canWrite or token-family classification', 'Authorized real same-User permitted/insufficient-token fixture for THIS action remains pending', 'Core authority/delegation/current procedure/source/payload and exact action head/base/parent prerequisites remain independent', 'External app restrictions/revocation/permission races remain unproved; hosted activation stays disabled']);
        }
        catch (error) {
            return this.result(context, error instanceof ObservationFailure ? error.state : 'unknown', [error instanceof ObservationFailure ? error.message : 'Native read cancelled/unavailable or unsupported response', 'Hosted activation remains disabled; obtain supported operands or use the manual path']);
        }
    }
    async observeRulesetAdministration(input: {
        expectedUserId: number;
        target: CapabilityTarget;
        rulesetId: number;
    }, signal?: AbortSignal): Promise<CapabilityObservation> {
        const captured = structuredClone(input);
        integer(captured.rulesetId);
        const ordinary: CapabilityRequest = { expectedUserId: captured.expectedUserId, target: captured.target, action: 'create-comment' };
        validate(ordinary);
        const context: Context = { input: ordinary, receipts: [], userId: null, scopes: null };
        signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.timeoutMs)]);
        const result = (state: CapabilityObservation['state'], conditions: string[]): CapabilityObservation => ({ ...this.result(context, state, conditions, 'existing-ruleset-history-gate/v1'), action: 'repository-ruleset-administration' });
        try {
            const actual = await this.personalTarget(context, signal), source = `${captured.target.owner}/${captured.target.repository}`;
            const route = actual.repoPath + `/rulesets/${captured.rulesetId}`;
            const rule = object((await this.get(route + '?includes_parents=true', context, signal)).data);
            if (integer(rule.id) !== captured.rulesetId || rule.source_type !== 'Repository' || rule.source !== source)
                return fail('Ruleset is not the existing selected repository-owned policy');
            const nodeId = string(rule.node_id);
            const history = (await this.get(route + '/history?per_page=1&page=1', context, signal)).data;
            if (!Array.isArray(history) || history.length !== 1)
                return fail('Usable selected ruleset history version unavailable');
            const versionId = integer(object(history[0]).version_id);
            const version = object((await this.get(route + `/history/${versionId}`, context, signal)).data), state = object(version.state);
            if (integer(version.version_id) !== versionId || integer(state.id) !== captured.rulesetId || state.source_type !== 'Repository' || state.source !== source)
                return fail('Selected ruleset history identity differs');
            return { ...result('matched', ['Documented history/version permission-gate response observed, not proven Administration write or full policy coverage', 'Actual same-User Administration:write vs Administration:read discriminator remains pending; if both pass the sensor is invalid', 'No policy was created; configuration activation and unrelated issue/PR/landing authority remain disabled']), ruleset: { id: captured.rulesetId, nodeId, versionId } };
        }
        catch (error) {
            return result(error instanceof ObservationFailure ? error.state : 'unknown', [error instanceof ObservationFailure ? error.message : 'Native ruleset read cancelled/unavailable or unsupported response', 'No policy creation probe; select an existing eligible rule/profile or use manual guidance']);
        }
    }
}
/** Normal action profile: PUBLIC personally owned nonfork repository. Read operands
 * do not establish branch bypass or a perpetual write permit. */
export function createNativePublicOwnerCapabilityObserver(read: ReadTransport, timeoutMs: number) {
    return {
        async observePublicationCapability(input: CapabilityRequest, signal?: AbortSignal): Promise<CapabilityObservation> {
            const captured = structuredClone(input);
            let repository: unknown;
            const wanted = `/repos/${segment(captured.target.owner)}/${segment(captured.target.repository)}`;
            const observer = createNativeCapabilityObserver(async (url, abort) => {
                const response = await read(url, abort);
                if (url.pathname === wanted && !url.search && response.status === 200)
                    repository = structuredClone(response.data);
                return response;
            }, timeoutMs);
            const observation = await observer.observePublicationCapability(captured, signal);
            if (observation.state !== 'matched')
                return observation;
            if (captured.target.visibility !== 'public')
                return { ...observation, state: 'denied', conditions: ['Normal hosted actions support PUBLIC personal repositories only; readonly/private acceptance paths remain separate'] };
            if (!repository || typeof repository !== 'object' || Array.isArray(repository) || typeof (repository as Record<string, unknown>).fork !== 'boolean')
                return { ...observation, state: 'unknown', conditions: ['Actual repository fork operand unavailable'] };
            if ((repository as Record<string, unknown>).fork)
                return { ...observation, state: 'denied', conditions: ['Fork repositories are outside the normal public personal profile'] };
            return { ...observation, conditions: ['Current PUBLIC personally owned nonfork User/admin and coherent native granted scopes match this finite action profile', 'Not branch-policy completeness, separate-account approval, permanent authority or guaranteed server acceptance'] };
        },
    };
}
export function openGitHubPublicOwnerCapabilityReader(options: Options) {
    const b = limits(options);
    return createNativePublicOwnerCapabilityObserver(nativeReadTransport(options.token, b), b.requestTimeoutMs);
}
/** Internal transport-only counterpart; applies the same normal public predicate. */
export function createOwnedPublicOwnerCapabilityReader(options: Options & {
    origin: string;
}) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
        throw Error('Owned public-owner fixture required');
    const b = limits(options), read = nativeReadTransport(options.token, b);
    return createNativePublicOwnerCapabilityObserver((url, signal) => read(new URL(url.pathname + url.search, origin), signal), b.requestTimeoutMs);
}

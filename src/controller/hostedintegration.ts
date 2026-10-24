import { randomUUID } from 'node:crypto';
import { nativeJsonTransport, type ReadLimits, type NativeJsonTransport } from '../platform/github-transport.js';
import { createNativePublicOwnerPolicyObserver, policyReadLimits } from '../platform/github-policy.js';
import { openGitHubHttpsGit, createOwnedHttpsGitFixture } from '../effects/native-git.js';
import { createdAcceptanceSession, type CreatedAcceptanceContext, type CreatedAcceptanceSession } from '../platform/hosted-context.js';
import { createOwnedPublicationSession, type OwnedPublicationSession, type OwnedNativeHttpsProfile } from '../platform/github-publication-session.js';
import { createOwnedPolicyFixture, type HostedPolicyObservation } from '../platform/github-policy.js';
import type { CapabilityTarget } from '../platform/github-capability.js';
import type { NativeGitProfile } from '../effects/types.js';
import type { NativeGitClient, HttpsGitTarget } from '../effects/native-git.js';
export type EffectGitClient = Pick<NativeGitClient, 'root' | 'gitBinary' | 'objectFormat' | 'project' | 'buildIntegration' | 'materializeVerifiedTree' | 'close' | 'registerLocalTarget' | 'fetchLocalBasis' | 'prepareForwardSend' | 'spawnPreparedForwardSend' | 'reconcileForward' | 'fetchHttpsPinnedBasis' | 'fetchHttpsBasis' | 'observeHttpsRef' | 'prepareHttpsForwardSend' | 'spawnPreparedHttpsForwardSend' | 'reconcileHttpsForward'>;
export interface NormalHostedIntegrationCredential {
    token: string;
    limits?: Partial<ReadLimits>;
}
export interface OwnedNormalHostedIntegrationFixture extends NormalHostedIntegrationCredential {
    origin: string;
    https: OwnedNativeHttpsProfile;
}
type Deployment = 'public-personal-owner/v1' | 'owned-disposable-complete-policy/v1' | 'created-private-isolated-policy/v1';
export interface RegisterHostedIntegrationTarget {
    projectId: string;
    repository: CapabilityTarget;
    expectedUserId: number;
    ref: string;
    basisCommit: string;
    publicationInventory: readonly string[];
    authorizedDeltaPaths: readonly string[];
}
export interface DelegateHostedIntegration {
    workId: string;
    targetId: string;
    mode: 'ordinary' | 'owner-override';
    operationLimit: number;
    scope?: 'work' | 'delegation-lineage';
}
/** Internal fixture constructor only: never accepted by public Controller/CLI/model options. */
export interface OwnedHostedIntegrationFixture {
    origin: string;
    token: string;
    https: OwnedNativeHttpsProfile;
    /** A private test deployment, not a GitHub visibility assertion. */
    fixtureProfile: 'owned-disposable-complete-policy/v1';
}
export interface HostedTargetData {
    kind: 'github-existing-ref';
    target: HttpsGitTarget;
    repository: CapabilityTarget;
    expectedUserId: number;
    basisCommit: string;
    publicationInventory: readonly string[];
    authorizedDeltaPaths: readonly string[];
}
export interface HostedAuthority {
    credentialSessionId: string;
    mode: DelegateHostedIntegration['mode'];
    policy: HostedPolicyObservation;
    fixtureProfile: Deployment;
    fingerprintVersion?: 'hosted-authority-fingerprint/v1';
    action?: 'existing-ref-forward';
}
/** No caller-supplied permission or observation enters this object. Normal
 * deployments require actual finite public-owner native operands; owned and
 * exact-created acceptance deployments retain their separate scoped premises. */
export class HostedIntegrationSession {
    readonly #session: Pick<OwnedPublicationSession, 'credentialSessionId' | 'observePublicationCapability'>;
    readonly #created: CreatedAcceptanceSession | undefined;
    readonly #policy: Pick<ReturnType<typeof createOwnedPolicyFixture>, 'observeTargetPolicy'>;
    readonly #open: (profile: NativeGitProfile, excludedRoots: readonly string[], signal?: AbortSignal) => Promise<EffectGitClient>;
    readonly #profile: Deployment;
    readonly #clients = new WeakSet<object>();
    readonly #normalRead: ((target: HostedTargetData, signal?: AbortSignal) => Promise<Record<string, unknown>>) | undefined;
    get normal(): boolean { return this.#profile === 'public-personal-owner/v1'; }
    constructor(options: OwnedHostedIntegrationFixture | CreatedAcceptanceContext | {
        normal: NormalHostedIntegrationCredential;
        owned?: {
            origin: string;
            https: OwnedNativeHttpsProfile;
        };
    }) {
        if ('normal' in options) {
            const token = options.normal.token, limits = policyReadLimits(options.normal.limits), identity = randomUUID();
            if (typeof token !== 'string' || !token || Buffer.byteLength(token) > 8192 || /[\x00-\x20\x7f]/.test(token))
                throw Error('Finite immutable hosted credential required');
            const native = nativeJsonTransport(token, limits);
            let read: NativeJsonTransport = native;
            if (options.owned) {
                const origin = new URL(options.owned.origin);
                if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
                    throw Error('Owned normal landing origin required');
                read = (url, request, signal) => {
                    if (url.origin !== 'https://api.github.com')
                        throw Error('Canonical read origin required');
                    return native(new URL(url.pathname + url.search, origin), request, signal);
                };
            }
            this.#session = { credentialSessionId: identity, observePublicationCapability: async () => { throw Error('Normal read identity is not publication permission'); } };
            this.#policy = createNativePublicOwnerPolicyObserver(read, limits);
            this.#profile = 'public-personal-owner/v1';
            const https = options.owned ? structuredClone(options.owned.https) : null;
            this.#open = (profile, excludedRoots, signal) => https ? createOwnedHttpsGitFixture(profile, { ...https, token, credentialSessionId: identity }, signal) : openGitHubHttpsGit(profile, { token, credentialSessionId: identity, excludedRoots }, signal);
            this.#normalRead = async (target, callerSignal) => {
                const signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(limits?.requestTimeoutMs ?? 10000)]), receipts: unknown[] = [];
                let bytes = 0;
                const get = async (route: string) => {
                    signal.throwIfAborted();
                    if (receipts.length >= limits.pages)
                        throw Error('Read identity global request allowance exhausted');
                    const r = await read(new URL(route, 'https://api.github.com'), { method: 'GET' }, signal).response;
                    receipts.push({ route, status: r.status, bodyHash: r.bodyHash, requestId: r.requestId });
                    bytes += r.bodyBytes;
                    if (bytes > limits.collectionBytes)
                        throw Error('Read identity global byte allowance exhausted');
                    if (r.status !== 200 || !r.data || typeof r.data !== 'object' || Array.isArray(r.data))
                        throw Error('Canonical native read identity unavailable');
                    return r.data as Record<string, any>;
                };
                const user = await get('/user'), repo = await get('/repos/' + encodeURIComponent(target.repository.owner) + '/' + encodeURIComponent(target.repository.repository));
                const wanted = target.repository;
                if (user.type !== 'User' || user.id !== target.expectedUserId || typeof user.login !== 'string' || !user.login || repo.id !== wanted.repositoryId || repo.node_id !== wanted.repositoryNodeId || repo.full_name?.toLowerCase() !== `${wanted.owner}/${wanted.repository}`.toLowerCase() || repo.name?.toLowerCase() !== wanted.repository.toLowerCase() || repo.owner?.type !== 'User' || repo.owner.id !== user.id || repo.owner.login?.toLowerCase() !== wanted.owner.toLowerCase() || user.login.toLowerCase() !== wanted.owner.toLowerCase() || repo.private !== false || repo.visibility !== 'public' || wanted.visibility !== 'public')
                    throw Error('Exact native public personal User/repository identity differs');
                const branch = target.target.ref.slice('refs/heads/'.length), ref = await get('/repos/' + encodeURIComponent(wanted.owner) + '/' + encodeURIComponent(wanted.repository) + '/git/ref/heads/' + encodeURIComponent(branch));
                if (ref.ref !== target.target.ref || ref.object?.type !== 'commit' || typeof ref.object.sha !== 'string' || !/^[a-f0-9]{40}$/.test(ref.object.sha))
                    throw Error('Exact current commit ref unavailable');
                return { credentialSessionId: identity, scope: 'read-only-identity-not-write-standing', userId: user.id, repositoryId: repo.id, repositoryNodeId: repo.node_id, ref: ref.ref, commit: ref.object.sha, receipts };
            };
            return;
        }
        if ('kind' in options) {
            const joined = createdAcceptanceSession(options);
            this.#created = joined;
            this.#session = joined;
            this.#policy = joined;
            this.#profile = 'created-private-isolated-policy/v1';
            this.#open = async (profile, _excludedRoots, signal) => {
                const native = await joined.openNativeGit(profile, signal);
                const refuse = (): never => { throw Error('Created acceptance Git session has no local receiver route'); };
                return Object.freeze({ ...native, registerLocalTarget: refuse, fetchLocalBasis: refuse, prepareForwardSend: refuse, spawnPreparedForwardSend: refuse, reconcileForward: refuse });
            };
            return;
        }
        const captured = structuredClone(options);
        if (captured.fixtureProfile !== 'owned-disposable-complete-policy/v1')
            throw Error('Owned complete-policy fixture profile required');
        this.#profile = captured.fixtureProfile;
        const session = createOwnedPublicationSession({ origin: captured.origin, token: captured.token });
        this.#session = session;
        this.#policy = createOwnedPolicyFixture({ origin: captured.origin, token: captured.token });
        this.#open = (profile, _excludedRoots, signal) => session.openOwnedNativeHttps(profile, captured.https, signal);
    }
    get identity(): string { return this.#session.credentialSessionId; }
    async open(profile: NativeGitProfile, excludedRoots: readonly string[] = [], signal?: AbortSignal): Promise<EffectGitClient> {
        const client = await this.#open(profile, [...excludedRoots], signal);
        try {
            signal?.throwIfAborted();
            this.#clients.add(client);
            return client;
        }
        catch (error) {
            await client.close();
            throw error;
        }
    }
    assertClient(client: EffectGitClient) {
        if (!this.#clients.has(client))
            throw Error('Actual native client capture differs');
    }
    private exactTarget(target: HostedTargetData) {
        if (this.#created) {
            const actual = this.#created.target, wanted = target.repository;
            if (target.expectedUserId !== actual.actorUserId || wanted.repositoryId !== actual.repositoryId || wanted.repositoryNodeId !== actual.repositoryNodeId || wanted.owner !== actual.owner || wanted.repository !== actual.repository || wanted.visibility !== 'private')
                throw Error('Exact newly created private acceptance repository required');
        }
    }
    async observeReadIdentity(target: HostedTargetData, signal?: AbortSignal) {
        this.exactTarget(target);
        if (this.#normalRead)
            return this.#normalRead(target, signal);
        const observation = await this.#session.observePublicationCapability({ expectedUserId: target.expectedUserId, target: target.repository, action: 'create-comment' }, signal);
        if (observation.state !== 'matched')
            throw Error('Supported same-account canonical read identity unavailable: ' + observation.conditions.join('; '));
        return { credentialSessionId: this.identity, observation, scope: 'read-only-identity-not-write-standing' as const };
    }
    async observe(target: HostedTargetData, mode: DelegateHostedIntegration['mode'], expectedBase: string, signal?: AbortSignal): Promise<HostedAuthority> {
        this.exactTarget(target);
        if (!['ordinary', 'owner-override'].includes(mode))
            throw Error('Unsupported hosted integration mode');
        const policy = await this.#policy.observeTargetPolicy({ expectedUserId: target.expectedUserId, target: target.repository, branch: target.target.ref.slice('refs/heads/'.length), expectedBase }, signal);
        if (!policy.completeVisibleInputs || !policy.fingerprint || policy.capability?.state !== 'matched')
            throw Error('Complete actual native hosted account/policy inputs unavailable: ' + policy.conditions.join('; '));
        if (this.normal && (!policy.normalVisibility || policy.normalVisibility.profile !== 'public-personal-owner-no-classic/v1' || policy.normalVisibility.fingerprintVersion !== 'hosted-authority-fingerprint/v1'))
            throw Error('Normal native visibility profile unavailable');
        // Normal deployments use the typed native-derived public-owner profile:
        // best-current bounded inference, never universal visibility or policy CAS.
        // Owned/exact-created fixtures instead retain their separate setup and
        // isolation premises; those premises are not normal deployment authority.
        // Neither context creation nor a reader label substitutes for actual
        // native permission operands, current core standing or the server decision.
        if (!policy.classic.completeVisibleConnections || policy.classic.matchedRuleIds.length)
            throw Error('Native classic coverage unavailable or matching protection unsupported');
        const route = mode === 'ordinary' ? policy.ordinary : policy.override;
        if (route.visiblePolicyFit !== 'matched')
            throw Error('Hosted ' + mode + ' policy incompatible: ' + route.conditions.join('; '));
        if (mode === 'owner-override' && !policy.applicableSetKeys.length)
            throw Error('No applicable override obligation; use ordinary delegation');
        return { credentialSessionId: this.identity, mode, policy, fixtureProfile: this.#profile, ...(this.normal ? { fingerprintVersion: 'hosted-authority-fingerprint/v1' as const, action: 'existing-ref-forward' as const } : {}) };
    }
}
export function hostedTarget(options: RegisterHostedIntegrationTarget): HostedTargetData {
    const captured = structuredClone(options), r = captured.repository;
    if (!r || !Number.isSafeInteger(captured.expectedUserId) || captured.expectedUserId < 1 || !Number.isSafeInteger(r.repositoryId) || r.repositoryId < 1 || typeof r.repositoryNodeId !== 'string' || !r.repositoryNodeId || !['public', 'private'].includes(r.visibility))
        throw Error('Exact hosted User/repository identity required');
    for (const part of [r.owner, r.repository])
        if (typeof part !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(part) || part === '.' || part === '..')
            throw Error('Literal hosted repository required');
    if (typeof captured.ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(captured.ref) || captured.ref.includes('..') || captured.ref.includes('@{') || captured.ref.split('/').some(x => !x || x.startsWith('.') || x.endsWith('.') || x.endsWith('.lock')))
        throw Error('Existing literal hosted branch required');
    if (typeof captured.basisCommit !== 'string' || !/^[a-f0-9]{40}$/.test(captured.basisCommit))
        throw Error('Initial hosted SHA1 basis required');
    for (const list of [captured.publicationInventory, captured.authorizedDeltaPaths])
        if (!Array.isArray(list) || !list.length || list.length > 100000 || new Set(list).size !== list.length || list.some(p => typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || p.includes('\0') || p.split('/').some(x => !x || x === '.' || x === '..' || x.toLowerCase() === '.git')))
            throw Error('Exact finite publication inventory/delta required');
    return { kind: 'github-existing-ref', target: { host: 'github.com', repositoryId: r.repositoryId, repositoryNodeId: r.repositoryNodeId, owner: r.owner, repository: r.repository, ref: captured.ref }, repository: r, expectedUserId: captured.expectedUserId, basisCommit: captured.basisCommit, publicationInventory: captured.publicationInventory, authorizedDeltaPaths: captured.authorizedDeltaPaths };
}

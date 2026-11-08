import { RepositoryReadError, repositoryReadTransport, type RepositoryReadOptions, type RepositoryProvider } from './repository-inspect-transport.js';
import type { ProviderConfigurationTarget } from './repository-configuration-profile.js';
import type { GitHubReadClient } from './github-read-client.js';
import type { ConfigurationTarget } from './github-configuration-types.js';
const fail = (message: string) => new RepositoryReadError(message);
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw fail('Native identity object unavailable');
    return value as Record<string, unknown>;
};
const text = (value: unknown) => {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 2048 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value))
        throw fail('Native identity text unavailable');
    return value;
};
const positive = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 1)
        throw fail('Native positive identity unavailable');
    return Number(value);
};
export function validateRepositoryIdentityPath(provider: RepositoryProvider, owner: string, repository: string, branch?: string) {
    const literal = (value: string) => {
        text(value);
        if (/[\s\\]/u.test(value) || value === '.' || value === '..')
            throw fail('Select a bounded literal repository identity without whitespace or controls');
        return value;
    };
    const namespace = literal(owner), name = literal(repository);
    if (name.includes('/') || namespace.split('/').some(s => !s || s === '.' || s === '..') || provider === 'gitea' && namespace.includes('/'))
        throw fail('Select a repository name and provider-supported namespace; only GitLab supports nested namespaces');
    if (branch !== undefined)
        literal(branch);
    return { owner: namespace, repository: name, branch };
}
export function nativeActorIdentity(provider: RepositoryProvider, value: unknown) { const row = object(value); return { id: positive(row.id), login: text(row[provider === 'gitea' ? 'login' : 'username']) }; }
export function nativeRepositoryIdentity(provider: RepositoryProvider, value: unknown, requested: string) {
    const row = object(value), fullName = text(row[provider === 'gitea' ? 'full_name' : 'path_with_namespace']);
    if (fullName !== requested)
        throw fail('Canonical repository path differs from the selected target; inspect its exact current namespace');
    return { id: positive(row.id), fullName };
}
/** Four bounded identity GETs only. No policy inventory or authority inference. */
export async function observeNativeConfigurationTarget(options: RepositoryReadOptions, input: {
    owner: string;
    repository: string;
    signal?: AbortSignal;
}, fixture = false): Promise<ProviderConfigurationTarget> {
    const client = repositoryReadTransport(options, fixture), { owner, repository } = validateRepositoryIdentityPath(client.provider, input.owner, input.repository), signal = AbortSignal.any([AbortSignal.timeout(30000), ...(input.signal ? [input.signal] : [])]);
    let bytes = 0, count = 0;
    const read = async (route: string) => {
        signal.throwIfAborted();
        if (count++ >= client.limits.pages)
            throw fail('Repository identity request limit reached');
        const response = await client.get(new URL(client.base.href + route), signal, size => {
            bytes += size;
            if (bytes > client.limits.collectionBytes)
                throw fail('Repository identity byte limit reached');
        });
        if (response.status !== 200)
            throw fail('Repository identity unavailable (HTTP ' + response.status + '); verify host, path and credential visibility');
        return response.data;
    };
    const actor = nativeActorIdentity(client.provider, await read('/user')), lookup = client.provider === 'gitea' ? '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repository) : '/projects/' + encodeURIComponent(owner + '/' + repository), repo = nativeRepositoryIdentity(client.provider, await read(lookup), owner + '/' + repository);
    const laterActor = nativeActorIdentity(client.provider, await read('/user')), laterRepo = nativeRepositoryIdentity(client.provider, await read(client.provider === 'gitea' ? lookup : '/projects/' + repo.id), owner + '/' + repository);
    if (actor.id !== laterActor.id || actor.login !== laterActor.login || repo.id !== laterRepo.id)
        throw fail('Repository or authenticated actor changed during registration; inspect and retry deliberately');
    return { provider: client.provider, apiBase: client.base.href, repositoryId: repo.id, owner, repository, actorUserId: actor.id };
}
export function validateGitHubConfigurationPath(owner: string, repository: string) {
    for (const value of [owner, repository])
        if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value))
            throw fail('Canonical GitHub owner and repository required');
}
/** Existing fixed-host client; registration does not activate its narrow write profile. */
export async function observeGitHubConfigurationTarget(client: Pick<GitHubReadClient, 'authenticatedUser' | 'repository'>, input: {
    owner: string;
    repository: string;
    signal?: AbortSignal;
}): Promise<ConfigurationTarget> {
    const { owner, repository } = input;
    validateGitHubConfigurationPath(owner, repository);
    const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(input.signal ? [input.signal] : [])]);
    const actorOf = (value: unknown) => {
        const row = object(value);
        if (row.type !== 'User')
            throw fail('Supported GitHub User identity required');
        return { id: positive(row.id), login: text(row.login) };
    };
    const repoOf = (value: unknown) => {
        const row = object(value);
        if (row.full_name !== owner + '/' + repository || row.url !== 'https://api.github.com/repos/' + owner + '/' + repository || typeof row.visibility !== 'string' || !['public', 'private'].includes(row.visibility) || row.private !== (row.visibility === 'private'))
            throw fail('Canonical GitHub repository identity/visibility unavailable');
        return { id: positive(row.id), nodeId: text(row.node_id), visibility: row.visibility as 'public' | 'private' };
    };
    const read = async (response: ReturnType<GitHubReadClient['authenticatedUser']>) => {
        signal.throwIfAborted();
        const result = await response;
        if (result.status !== 200)
            throw fail('GitHub identity unavailable (HTTP ' + result.status + '); verify host, path and credential visibility');
        return result.data;
    };
    const actor = actorOf(await read(client.authenticatedUser(signal))), repo = repoOf(await read(client.repository(owner, repository, signal))), laterActor = actorOf(await read(client.authenticatedUser(signal))), laterRepo = repoOf(await read(client.repository(owner, repository, signal)));
    if (JSON.stringify(actor) !== JSON.stringify(laterActor) || JSON.stringify(repo) !== JSON.stringify(laterRepo))
        throw fail('Repository or authenticated actor changed during registration; inspect and retry deliberately');
    return { host: 'github.com', owner, repository, repositoryId: repo.id, repositoryNodeId: repo.nodeId, actorUserId: actor.id, visibility: repo.visibility };
}

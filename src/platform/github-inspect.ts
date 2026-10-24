import type { GitHubReadClient } from './github-read-client.js';
/** Human-readable observations only; no effect permit or complete policy claim. */
export async function inspectGitHubRepository(client: GitHubReadClient, owner: string, name: string, branch?: string, signal?: AbortSignal) {
    const user = await client.authenticatedUser(signal);
    const repo = await client.repository(owner, name, signal);
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    if (user.status !== 200 || !record(user.data) || !Number.isSafeInteger(user.data.id) || Number(user.data.id) < 1 || typeof user.data.login !== 'string' || user.data.type !== 'User') {
        throw Error('Supported authenticated GitHub User identity unavailable');
    }
    if (repo.status !== 200 || !record(repo.data) || !Number.isSafeInteger(repo.data.id) || Number(repo.data.id) < 1 ||
        typeof repo.data.full_name !== 'string' || repo.data.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase() || typeof repo.data.default_branch !== 'string') {
        throw Error('Canonical GitHub repository identity unavailable');
    }
    const selected = branch ?? repo.data.default_branch;
    const rulesets = await client.repositoryRulesets(owner, name, signal);
    const rules = await client.branchRules(owner, name, selected, signal);
    const protection = await client.branchProtection(owner, name, selected, signal);
    let classicInventory: {
        status: 'observed';
        value: Awaited<ReturnType<GitHubReadClient['classicTargetProtection']>>;
    } | {
        status: 'unavailable';
        reason: string;
    };
    try {
        if (typeof repo.data.node_id !== 'string' || !repo.data.node_id)
            throw Error('Missing canonical repository node identity');
        classicInventory = { status: 'observed', value: await client.classicTargetProtection(owner, name, selected, repo.data.node_id, signal) };
    }
    catch {
        signal?.throwIfAborted();
        classicInventory = { status: 'unavailable', reason: 'Complete visible classic inventory unavailable; no absence or visibility proof.' };
    }
    return {
        kind: 'repository-observation' as const,
        provider: 'github.com', observedAt: new Date().toISOString(),
        actor: { id: user.data.id, login: user.data.login },
        repository: { id: repo.data.id, fullName: repo.data.full_name, branch: selected },
        observations: { user, repository: repo, rulesets, effectiveBranchRules: rules, classicTargetProtection: protection, classicInventory },
        limitations: [
            'Read-only observations; no action permission, approval, bypass or token-write capability is inferred.',
            'Ruleset details and typed policy remain pending; HTTP404 is not absence proof. Complete visible classic connections do not establish visibility or absence.',
            'Separate requests are not an atomic policy snapshot. Hosted effects remain unavailable.',
        ],
    };
}

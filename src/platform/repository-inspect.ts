import { readGitLabCollection } from './repository-collection.js';
import { readGiteaProtectionInventory } from './gitea-protection-inventory.js';
import { validateRepositoryIdentityPath, nativeActorIdentity, nativeRepositoryIdentity } from './repository-identity.js';
import { createHash } from 'node:crypto';
import { RepositoryReadError, repositoryReadTransport, type RepositoryReadOptions, type RepositoryResponse } from './repository-inspect-transport.js';
type Row = Record<string, unknown>;
export type RepositoryField<T = unknown> = {
    state: 'OBSERVED';
    value: T;
} | {
    state: 'UNAVAILABLE';
    reason: string;
};
const unavailable = (reason: string): RepositoryField<never> => ({ state: 'UNAVAILABLE', reason });
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (message: string) => new RepositoryReadError(message);
const text = (v: unknown): string => { if (typeof v !== 'string' || Buffer.byteLength(v) > 2048 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v))
    throw fail('Native text unavailable'); return v; };
const integer = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw fail('Native nonnegative integer unavailable'); return Number(v); };
const positive = (v: unknown): number => { const n = integer(v); if (!n)
    throw fail('Native positive identity unavailable'); return n; };
const boolean = (v: unknown): boolean => { if (typeof v !== 'boolean')
    throw fail('Native boolean unavailable'); return v; };
const texts = (v: unknown) => { if (!Array.isArray(v) || v.length > 10000)
    throw fail('Native text list unavailable'); return v.map(text); };
const fields = (row: Row, schema: Record<string, (v: unknown) => unknown>) => Object.fromEntries(Object.entries(schema).map(([key, parse]) => { try {
    if (!Object.hasOwn(row, key))
        throw Error();
    return [key, { state: 'OBSERVED', value: parse(row[key]) }];
}
catch {
    return [key, unavailable('Native field missing, withheld or unsupported; no default is inferred')];
} })) as Record<string, RepositoryField>;
const signature = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const validateRepositoryInspectionTarget = validateRepositoryIdentityPath;
const giteaRepository = { allow_merge_commits: boolean, allow_rebase: boolean, allow_rebase_explicit: boolean, allow_squash_merge: boolean, allow_fast_forward_only_merge: boolean, allow_manual_merge: boolean, default_merge_style: text, has_pull_requests: boolean, archived: boolean };
const gitlabRepository = { merge_method: text, squash_option: text, only_allow_merge_if_pipeline_succeeds: boolean, allow_merge_on_skipped_pipeline: boolean, only_allow_merge_if_all_discussions_are_resolved: boolean, archived: boolean };
const giteaRule = { rule_name: text, branch_name: text, priority: integer, enable_push: boolean, enable_push_whitelist: boolean, push_whitelist_usernames: texts, push_whitelist_teams: texts, push_whitelist_deploy_keys: boolean, enable_merge_whitelist: boolean, merge_whitelist_usernames: texts, merge_whitelist_teams: texts, required_approvals: integer, enable_approvals_whitelist: boolean, approvals_whitelist_username: texts, approvals_whitelist_teams: texts, enable_status_check: boolean, status_check_contexts: texts, dismiss_stale_approvals: boolean, ignore_stale_approvals: boolean, block_on_rejected_reviews: boolean, block_on_outdated_branch: boolean, block_on_official_review_requests: boolean, block_on_codeowner_reviews: boolean, block_admin_merge_override: boolean, require_signed_commits: boolean, protected_file_patterns: text, unprotected_file_patterns: text, enable_force_push: boolean, enable_force_push_allowlist: boolean, force_push_allowlist_usernames: texts, force_push_allowlist_teams: texts, force_push_allowlist_deploy_keys: boolean, enable_bypass_allowlist: boolean, bypass_allowlist_usernames: texts, bypass_allowlist_teams: texts, enable_deletion: boolean, enable_deletion_allowlist: boolean, deletion_allowlist_usernames: texts, deletion_allowlist_teams: texts };
const nullable = (parse: (v: unknown) => unknown) => (v: unknown) => v === null ? null : parse(v);
const accessLevels = (value: unknown) => { if (!Array.isArray(value) || value.length > 10000)
    throw fail('Native access-level list unavailable'); return value.map(row => { if (!record(row))
    throw fail('Native access-level record unavailable'); return fields(row, { id: positive, access_level: integer, access_level_description: text, user_id: nullable(positive), group_id: nullable(positive), deploy_key_id: nullable(positive), member_role_id: nullable(positive) }); }); };
const protectedBranches = (value: unknown) => { if (!Array.isArray(value) || value.length > 10000)
    throw fail('Native protected-branch list unavailable'); return value.map(row => { if (!record(row))
    throw fail('Native protected-branch record unavailable'); return fields(row, { id: positive, name: text, allow_force_push: boolean, code_owner_approval_required: boolean, inherited: boolean, push_access_levels: accessLevels, merge_access_levels: accessLevels, unprotect_access_levels: accessLevels }); }); };
const approvalRule = { id: positive, name: text, rule_type: text, approvals_required: integer, contains_hidden_groups: boolean, applies_to_all_protected_branches: boolean, protected_branches: protectedBranches };
const approvalSettings = { reset_approvals_on_push: boolean, selective_code_owner_removals: boolean, disable_overriding_approvers_per_merge_request: boolean, merge_requests_author_approval: boolean, merge_requests_disable_committers_approval: boolean, require_password_to_approve: boolean, require_reauthentication_to_approve: boolean };
export interface Receipt {
    path: string;
    method: 'GET';
    status: number;
    bodyHash: string;
    bodyBytes: number;
}
/** Native provider observations only; never used as an agent effect permit or policy evaluator. */
class RepositoryInspector {
    constructor(private readonly client: ReturnType<typeof repositoryReadTransport>) { }
    async inspect(options: {
        owner: string;
        repository: string;
        branch?: string;
        signal?: AbortSignal;
    }) {
        const { owner, repository, branch } = validateRepositoryInspectionTarget(this.client.provider, options.owner, options.repository, options.branch), { provider, base, limits } = this.client;
        const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]), receipts: Receipt[] = [];
        let count = 0, bytes = 0, items = 0, exhausted = false;
        const budgetFailure = (message: string): never => { exhausted = true; throw fail(message); };
        const get = async (route: string) => {
            signal.throwIfAborted();
            if (exhausted || count >= limits.pages)
                budgetFailure('Operation-global repository request limit reached');
            count++;
            const url = new URL(base.href + route), response = await this.client.get(url, signal, size => { bytes += size; if (bytes > limits.collectionBytes)
                budgetFailure('Operation-global repository byte limit reached'); });
            receipts.push({ path: url.pathname + url.search, method: 'GET', status: response.status, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes });
            return response;
        };
        const body = (response: RepositoryResponse) => { if (response.status !== 200 || !record(response.data))
            throw fail('Required repository identity unavailable; verify the selected host, token permissions and repository path'); return response.data; };
        const actorOf = (row: Row) => nativeActorIdentity(provider, row);
        const actor = actorOf(body(await get('/user'))), requested = owner + '/' + repository, lookup = provider === 'gitea' ? '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repository) : '/projects/' + encodeURIComponent(requested);
        const repositoryOf = (row: Row) => {
            const { id, fullName } = nativeRepositoryIdentity(provider, row, requested);
            const defaultBranch = row.default_branch === null ? null : text(row.default_branch);
            return { id, fullName, defaultBranch, settings: fields(row, provider === 'gitea' ? giteaRepository : gitlabRepository) };
        };
        const repo = repositoryOf(body(await get(lookup))), route = provider === 'gitea' ? lookup : '/projects/' + repo.id, selected = branch ?? repo.defaultBranch;
        const observe = async <T>(operation: () => Promise<T>): Promise<RepositoryField<T>> => { try {
            return { state: 'OBSERVED', value: await operation() };
        }
        catch (error) {
            signal.throwIfAborted();
            if (exhausted)
                throw error;
            return unavailable(error instanceof RepositoryReadError ? error.message : 'Native endpoint schema unavailable; inspect provider version and visibility');
        } };
        const endpoint = async (path: string, parse: (row: Row) => unknown) => { const response = await get(path); if (response.status !== 200)
            throw fail('Native endpoint unavailable (HTTP ' + response.status + '); inspect token permissions, provider version and feature availability'); if (!record(response.data))
            throw fail('Native endpoint object schema unavailable'); return parse(response.data); };
        const branchOf = (row: Row) => {
            if (text(row.name) !== selected || !record(row.commit))
                throw fail('Native branch identity differs or is unavailable');
            const head = text(row.commit.id);
            if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head))
                throw fail('Native branch commit identity unavailable');
            return { name: selected, head, fields: fields(row, provider === 'gitea' ? { protected: boolean, effective_branch_protection_name: text, required_approvals: integer, enable_status_check: boolean, status_check_contexts: texts, user_can_merge: boolean, user_can_push: boolean } : { protected: boolean, developers_can_push: boolean, developers_can_merge: boolean, can_push: boolean }) };
        };
        const branchRoute = selected ? route + (provider === 'gitea' ? '/branches/' : '/repository/branches/') + encodeURIComponent(selected) : null;
        const branchView = branchRoute ? await observe(() => endpoint(branchRoute, branchOf)) : unavailable('Repository has no default branch; select an existing explicit branch');
        const collection = async (path: string, key: (row: Row) => string, project: (row: Row) => unknown) => (await readGitLabCollection(get, base, path, key, count => { items += count; if (items > limits.collectionItems)
            budgetFailure('Operation-global repository item limit reached'); })).map(project);
        const inventory = await observe(() => provider === 'gitea' ? readGiteaProtectionInventory(get, route + '/branch_protections', count => { items += count; if (items > limits.collectionItems)
            budgetFailure('Operation-global repository item limit reached'); }).then(rows => rows.map(row => fields(row, giteaRule))) : collection(route + '/protected_branches', row => String(positive(row.id)), row => fields(row, { id: positive, name: text, allow_force_push: boolean, code_owner_approval_required: boolean, inherited: boolean, push_access_levels: accessLevels, merge_access_levels: accessLevels, unprotect_access_levels: accessLevels })));
        const approvals = provider === 'gitlab' ? await observe(() => collection(route + '/approval_rules', row => String(positive(row.id)), row => fields(row, approvalRule))) : undefined;
        const approvalConfiguration = provider === 'gitlab' ? await observe(() => endpoint(route + '/approvals', row => fields(row, approvalSettings))) : undefined;
        if (signature(repositoryOf(body(await get(route)))) !== signature(repo) || signature(actorOf(body(await get('/user')))) !== signature(actor))
            throw fail('Repository or authenticated identity changed during inspection; refresh the exact target');
        if (branchRoute) {
            const later = await observe(() => endpoint(branchRoute, branchOf));
            if (signature(later) !== signature(branchView))
                throw fail('Selected branch observation changed during inspection; refresh before using guidance');
        }
        signal.throwIfAborted();
        let effectiveRule: RepositoryField = unavailable('This provider does not expose Gitea effective-rule selection');
        if (provider === 'gitea' && branchView.state === 'OBSERVED' && inventory.state === 'OBSERVED') {
            const native = (branchView.value as ReturnType<typeof branchOf>).fields.effective_branch_protection_name;
            if (native?.state === 'OBSERVED' && typeof native.value === 'string' && native.value) {
                const matches = inventory.value.filter(raw => { const row = raw as Record<string, RepositoryField>; const name = row.rule_name?.state === 'OBSERVED' ? row.rule_name : row.branch_name; return name?.state === 'OBSERVED' && name.value === native.value; });
                effectiveRule = matches.length === 1 ? { state: 'OBSERVED', value: matches[0] } : unavailable('Native effective rule is missing or ambiguous in visible inventory');
                if (effectiveRule.state === 'OBSERVED') {
                    const rule = effectiveRule.value as Record<string, RepositoryField>, branchFields = (branchView.value as ReturnType<typeof branchOf>).fields;
                    if (['required_approvals', 'enable_status_check', 'status_check_contexts'].some(key => rule[key]?.state === 'OBSERVED' && branchFields[key]?.state === 'OBSERVED' && signature(rule[key]!.value) !== signature(branchFields[key]!.value)))
                        effectiveRule = unavailable('Native branch summary and selected rule disagree; refresh before using effective-rule guidance');
                }
            }
            else
                effectiveRule = unavailable('Native effective-rule name missing or empty; local wildcard precedence is not inferred');
        }
        const protectedFlag = branchView.state === 'OBSERVED' ? (branchView.value as ReturnType<typeof branchOf>).fields.protected : undefined;
        const endpoints = [branchView, inventory, ...(provider === 'gitea' && protectedFlag?.state === 'OBSERVED' && protectedFlag.value === true ? [effectiveRule] : []), ...(approvals ? [approvals] : []), ...(approvalConfiguration ? [approvalConfiguration] : [])];
        return { kind: 'repository-observation' as const, status: endpoints.some(e => e.state === 'UNAVAILABLE') ? 'PARTIAL' : 'OBSERVED', provider, apiBase: base.href, observedAt: new Date().toISOString(), actor, repository: repo, selectedBranch: selected,
            observations: { branch: branchView, protectionInventory: inventory, ...(provider === 'gitea' ? { effectiveRule } : {}), ...(approvals ? { approvalRules: approvals } : {}), ...(approvalConfiguration ? { approvalSettings: approvalConfiguration } : {}) }, receipts,
            scope: 'Read-only native observations for developer guidance. No merge permission, approval, bypass, agent standing, complete policy coverage or configuration-write capability is inferred.',
            limitations: ['Separate requests are non-atomic. Repository/actor/branch rechecks detect known drift, not all concurrent rule changes.', 'Unavailable, withheld, licensing-dependent and unrecognized fields remain unknown; HTTP 401/403/404 is not an empty-rule or absence proof.', 'Project inventory does not establish inherited/group policy visibility, CODEOWNERS applicability, pull/merge-request-specific conditions or external checks.', 'Native can-push/can-merge and access-level values are reported metadata, not effective authorization or agent procedural standing.', 'Provider-specific configuration mutation, contribution tracking and governed hosted effects are not supplied by this read-only adapter.'],
            nextAction: 'Read the selected branch and native rule/settings observations. Resolve unavailable endpoints or fields with the repository administrator and native UI; check applicable request-specific and inherited policies before work or integration. No write, approval or merge was attempted.' };
    }
}
export function openRepositoryInspector(options: RepositoryReadOptions) { return new RepositoryInspector(repositoryReadTransport(options)); }
/** Internal owned-service test seam; never exposed through CLI profiles. */
export function createOwnedRepositoryInspectionFixture(options: RepositoryReadOptions) { return new RepositoryInspector(repositoryReadTransport(options, true)); }

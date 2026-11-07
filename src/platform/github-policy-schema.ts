import { createHash } from 'node:crypto';
export function policyObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Native policy object unavailable');
    return value as Record<string, unknown>;
}
export function policyText(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('Native policy text identity unavailable');
    return value;
}
export function policyId(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
        throw Error('Native policy positive identity unavailable');
    return value as number;
}
export function policyCanonical(value: unknown): string {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
    return JSON.stringify(sorted(value));
}
export const policyHash = (value: unknown) => createHash('sha256').update(policyCanonical(value)).digest('hex');
export interface NativePolicyRule {
    type: string;
    supported: boolean;
    meaning: Record<string, unknown>;
    unsupported: readonly string[];
}
export interface NativePolicySet {
    id: number;
    nodeId: string;
    sourceType: 'Repository' | 'Organization' | 'Enterprise';
    source: string;
    target: 'branch' | 'tag' | 'push' | 'repository';
    enforcement: 'active' | 'evaluate' | 'disabled';
    currentBypass: 'always' | 'pull_requests_only' | 'never' | 'exempt' | null;
    actors: readonly {
        type: string;
        id: number | null;
        mode: string;
    }[] | null;
    rules: readonly NativePolicyRule[];
    conditions: unknown;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
function bool(value: unknown): boolean { return typeof value === 'boolean'; }
export function normalizePolicyRule(value: unknown, effective = false): NativePolicyRule {
    const raw = policyObject(value), type = policyText(raw.type), unsupported: string[] = [];
    const allowed = ['type', 'parameters', ...(effective ? ['ruleset_source_type', 'ruleset_source', 'ruleset_id'] : [])];
    if (!exactKeys(raw, allowed))
        unsupported.push('Unknown material rule field');
    const meaning: Record<string, unknown> = { type, ...(Object.hasOwn(raw, 'parameters') ? { parameters: structuredClone(raw.parameters) } : {}) };
    if (type === 'non_fast_forward' || type === 'deletion') {
        if (Object.hasOwn(raw, 'parameters'))
            unsupported.push('Unexpected parameters on invariant rule');
    }
    else if (type === 'pull_request') {
        let p: Record<string, unknown>;
        try {
            p = policyObject(raw.parameters);
        }
        catch {
            return { type, supported: false, meaning, unsupported: ['Missing PR parameters'] };
        }
        const required = ['dismiss_stale_reviews_on_push', 'require_code_owner_review', 'require_last_push_approval', 'required_review_thread_resolution'];
        const optional = ['allowed_merge_methods', 'dismissal_restriction', 'required_reviewers', 'require_extra_approval_for_unattributed_changes'];
        if (!exactKeys(p, [...required, 'required_approving_review_count', ...optional]) || required.some(key => !bool(p[key])) || !Number.isInteger(p.required_approving_review_count) || (p.required_approving_review_count as number) < 0 || (p.required_approving_review_count as number) > 10)
            unsupported.push('Missing/unsupported PR obligation fields');
        if ('require_extra_approval_for_unattributed_changes' in p && !bool(p.require_extra_approval_for_unattributed_changes))
            unsupported.push('Unsupported additional unattributed approval operand');
        if ('allowed_merge_methods' in p) {
            const methods = p.allowed_merge_methods;
            if (!Array.isArray(methods) || !methods.length || new Set(methods).size !== methods.length || methods.some(m => !['merge', 'squash', 'rebase'].includes(m)))
                unsupported.push('Unsupported allowed merge methods');
            else
                (meaning.parameters as Record<string, unknown>).allowed_merge_methods = [...methods].sort();
        }
        if ('required_reviewers' in p && (!Array.isArray(p.required_reviewers) || p.required_reviewers.length !== 0))
            unsupported.push('Named reviewer extension is outside this finite profile');
        if ('dismissal_restriction' in p) {
            try {
                const restriction = policyObject(p.dismissal_restriction);
                if (!exactKeys(restriction, ['enabled', 'allowed_actors']) || restriction.enabled !== false || ('allowed_actors' in restriction && (!Array.isArray(restriction.allowed_actors) || restriction.allowed_actors.length)))
                    unsupported.push('Review-dismissal actor semantics outside this finite profile');
            }
            catch {
                unsupported.push('Unsupported review-dismissal restriction');
            }
        }
    }
    else if (type === 'required_status_checks') {
        let p: Record<string, unknown>;
        try {
            p = policyObject(raw.parameters);
        }
        catch {
            return { type, supported: false, meaning, unsupported: ['Missing status parameters'] };
        }
        if (!exactKeys(p, ['required_status_checks', 'strict_required_status_checks_policy', 'do_not_enforce_on_create']) || !bool(p.strict_required_status_checks_policy) || ('do_not_enforce_on_create' in p && !bool(p.do_not_enforce_on_create)) || !Array.isArray(p.required_status_checks))
            unsupported.push('Missing/unsupported status obligation fields');
        else {
            const seen = new Set<string>();
            for (const value of p.required_status_checks) {
                try {
                    const check = policyObject(value);
                    policyText(check.context);
                    if (!exactKeys(check, ['context', 'integration_id']))
                        throw Error('Unknown check source');
                    if ('integration_id' in check)
                        policyId(check.integration_id);
                    const key = policyCanonical(check);
                    if (seen.has(key))
                        throw Error('Duplicate native check');
                    seen.add(key);
                }
                catch {
                    unsupported.push('Unsupported/ambiguous native status context/app identity');
                }
            }
            (meaning.parameters as Record<string, unknown>).required_status_checks = [...p.required_status_checks].sort((a, b) => policyCanonical(a).localeCompare(policyCanonical(b)));
        }
    }
    else
        unsupported.push('Unimplemented native rule type');
    return { type, supported: !unsupported.length, meaning, unsupported };
}
export function policySetKey(set: Pick<NativePolicySet, 'sourceType' | 'source' | 'id'>): string { return policyCanonical([set.sourceType, set.source, set.id]); }
export function normalizePolicySet(value: unknown): NativePolicySet {
    const r = policyObject(value), id = policyId(r.id), nodeId = policyText(r.node_id), source = policyText(r.source);
    if ((typeof r.source_type !== 'string' || !['Repository', 'Organization', 'Enterprise'].includes(r.source_type)) || (typeof r.target !== 'string' || !['branch', 'tag', 'push', 'repository'].includes(r.target)) || (typeof r.enforcement !== 'string' || !['active', 'evaluate', 'disabled'].includes(r.enforcement)) || !Array.isArray(r.rules))
        throw Error('Policy source/target/enforcement/rules schema unsupported');
    let currentBypass: NativePolicySet['currentBypass'] = null;
    if ('current_user_can_bypass' in r) {
        if ((typeof r.current_user_can_bypass !== 'string' || !['always', 'pull_requests_only', 'never', 'exempt'].includes(r.current_user_can_bypass)))
            throw Error('Native current actor bypass enum unsupported');
        currentBypass = r.current_user_can_bypass as NonNullable<NativePolicySet['currentBypass']>;
    }
    let actors: NativePolicySet['actors'] = null;
    if ('bypass_actors' in r) {
        if (!Array.isArray(r.bypass_actors))
            throw Error('Native bypass actor list unavailable');
        actors = r.bypass_actors.map(raw => {
            const actor = policyObject(raw), type = policyText(actor.actor_type), mode = policyText(actor.bypass_mode);
            if (!['User', 'Team', 'RepositoryRole', 'OrganizationAdmin', 'Integration', 'DeployKey'].includes(type) || !['always', 'pull_request', 'exempt'].includes(mode))
                throw Error('Native bypass actor type/mode unsupported');
            const actorId = ['User', 'Team', 'RepositoryRole', 'Integration'].includes(type) ? policyId(actor.actor_id) : actor.actor_id === null || actor.actor_id === undefined ? null : policyId(actor.actor_id);
            return { type, id: actorId, mode };
        });
        const identities = actors.map(actor => policyCanonical(actor));
        if (new Set(identities).size !== identities.length)
            throw Error('Native bypass actor repeated');
        actors = [...actors].sort((a, b) => policyCanonical(a).localeCompare(policyCanonical(b)));
    }
    const rules = r.rules.map(rule => normalizePolicyRule(rule));
    if (new Set(rules.map(rule => rule.type)).size !== rules.length)
        throw Error('Native ruleset has ambiguous repeated rule types');
    return { id, nodeId, sourceType: r.source_type as NativePolicySet['sourceType'], source, target: r.target as NativePolicySet['target'], enforcement: r.enforcement as NativePolicySet['enforcement'], currentBypass, actors, rules: [...rules].sort((a, b) => policyCanonical(a.meaning).localeCompare(policyCanonical(b.meaning))), conditions: structuredClone(r.conditions ?? null) };
}

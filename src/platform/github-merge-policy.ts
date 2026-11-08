import { policySetKey, policyCanonical } from './github-policy-schema.js';
import type { HostedPolicyObservation } from './github-policy.js';
export interface MergeCheckRequirement {
    context: string;
    integrationId: number | null;
}
export interface OrdinaryMergeRequirements {
    approvingAccounts: number;
    checks: readonly MergeCheckRequirement[];
    policyFingerprint: string;
    destinationFenceId: number;
}
/** A literal native restriction, not a guessed fnmatch implementation. This
 * rule is outside the landing branch, so it grants no branch-write standing. */
function destinationFence(policy: HostedPolicyObservation): number {
    const expected = { ref_name: { include: ['~ALL'], exclude: ['refs/heads/' + policy.request.branch] } };
    const fence = policy.sets.find(set => set.sourceType === 'Repository' && set.source === policy.request.target.owner + '/' + policy.request.target.repository &&
        set.target === 'branch' && set.enforcement === 'active' && set.currentBypass === 'never' &&
        policyCanonical(set.conditions) === policyCanonical(expected) &&
        ['creation', 'update'].every(type => set.rules.some(rule => rule.type === type &&
            policyCanonical(rule.unsupported) === policyCanonical(['Unimplemented native rule type']) &&
            policyCanonical(rule.meaning) === policyCanonical(type === 'creation' ? { type } : { type, parameters: { update_allows_fetch_and_merge: false } }))));
    if (!fence || policy.applicableSetKeys.includes(policySetKey(fence)))
        throw Error('Native destination restriction unavailable: ordinary unattended merge needs existing non-bypass creation/update restrictions on every branch except the literal authorized base; no repository policy was changed');
    return fence.id;
}
/** Consumes current native observations; a caller-supplied copy is never an authority token. */
export function ordinaryMergeRequirements(policy: HostedPolicyObservation): OrdinaryMergeRequirements {
    if (!policy.completeVisibleInputs || !policy.fingerprint || policy.normalVisibility?.profile !== 'public-personal-owner-no-classic/v1' ||
        policy.normalVisibility.state !== 'matched' || policy.capability?.state !== 'matched' || policy.capability.action !== 'merge-pull-request' ||
        policy.capability.expectedUserId !== policy.request.expectedUserId || policy.capability.observedUserId !== policy.request.expectedUserId ||
        policyCanonical(policy.capability.target) !== policyCanonical(policy.request.target) || policy.classic.viewerCanAdminister !== true ||
        policy.classic.directRuleId !== null || policy.classic.matchedRuleIds.length || !policy.classic.completeVisibleConnections)
        throw Error('Current ordinary merge policy visibility is unavailable');
    const destinationFenceId = destinationFence(policy);
    const applicable = policy.sets.filter(set => policy.applicableSetKeys.includes(policySetKey(set)));
    if (!applicable.length || applicable.length !== policy.applicableSetKeys.length)
        throw Error('Native strict up-to-date enforcement is unavailable for unattended merge');
    const checks = new Map<string, MergeCheckRequirement>();
    let strict = false, approvingAccounts = 0;
    for (const set of applicable) {
        if (set.sourceType !== 'Repository' || set.target !== 'branch' || set.enforcement !== 'active' || set.currentBypass !== 'never' || set.rules.some(rule => !rule.supported))
            throw Error('Applicable merge policy has unsupported or inherited semantics');
        for (const rule of set.rules) {
            if (rule.type === 'non_fast_forward' || rule.type === 'deletion')
                continue;
            const parameters = rule.meaning.parameters as Record<string, unknown> | undefined;
            if (rule.type === 'required_status_checks') {
                const required = parameters?.required_status_checks;
                if (parameters?.strict_required_status_checks_policy !== true || !Array.isArray(required) || !required.length)
                    throw Error('Ordinary merge requires native strict up-to-date checks; policy was not changed');
                strict = true;
                for (const raw of required) {
                    const row = raw as Record<string, unknown>;
                    if (typeof row.context !== 'string' || !row.context || Buffer.byteLength(row.context) > 4096 ||
                        Object.hasOwn(row, 'integration_id') && (!Number.isSafeInteger(row.integration_id) || Number(row.integration_id) < 1))
                        throw Error('Native required status identity unavailable');
                    const value = { context: row.context, integrationId: Object.hasOwn(row, 'integration_id') ? Number(row.integration_id) : null };
                    checks.set(JSON.stringify(value), value);
                }
            }
            else if (rule.type === 'pull_request') {
                const count = parameters?.required_approving_review_count;
                if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 10 ||
                    parameters?.require_extra_approval_for_unattributed_changes === true || parameters?.require_code_owner_review !== false || parameters.require_last_push_approval !== false || parameters.required_review_thread_resolution !== false ||
                    parameters.allowed_merge_methods !== undefined && (!Array.isArray(parameters.allowed_merge_methods) || !parameters.allowed_merge_methods.includes('merge')))
                    throw Error('Native PR review conditions exceed the initial ordinary merge profile');
                // Current-head, distinct non-author accounts are checked separately;
                // configured platform approvals never come from gitjig role records.
                approvingAccounts = Math.max(approvingAccounts, Number(count));
            }
            else
                throw Error('Applicable native merge rule is outside the initial profile');
        }
    }
    if (!strict || !checks.size)
        throw Error('Native strict up-to-date enforcement is unavailable for unattended merge');
    return { approvingAccounts, checks: [...checks.values()].sort((a, b) => a.context.localeCompare(b.context) || (a.integrationId ?? 0) - (b.integrationId ?? 0)), policyFingerprint: policy.fingerprint, destinationFenceId };
}

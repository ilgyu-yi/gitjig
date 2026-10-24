import { parseConfigurationProfile } from './github-configuration-profile.js';
import { parseProviderConfigurationProfile, giteaProtectionSettings } from './repository-configuration-profile.js';
import type { RepositoryProfile } from './configuration-session.js';
/** Editable starting point only. Applying it still needs owner preview and actual native authority. */
export function recommendedConfiguration(branch: string, provider: 'github' | 'gitea' | 'gitlab' = 'github', mode: 'update' | 'create' = 'update'): RepositoryProfile {
    if (!branch || Buffer.byteLength(branch) > 1024 || branch === '@' || /[\x00-\x20\x7f~^:?*\[\\\uD800-\uDFFF]/u.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.includes('..') || branch.includes('@{') || branch.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.') || p.endsWith('.lock')))
        throw Error('A literal branch name is required for the editable recommendation');
    if (!['update', 'create'].includes(mode))
        throw Error('Native recommendation mode must be update or create');
    if (mode === 'create') {
        if (provider === 'gitea')
            return parseProviderConfigurationProfile({ provider, version: 'editable-native-create/v1', protection: { mode, name: branch, initial: { priority: 1 }, fields: { ...Object.fromEntries(giteaProtectionSettings.map(key => [key, key === 'required_approvals' ? 0 : key === 'status_check_contexts' ? [] : false])), required_approvals: 1, dismiss_stale_approvals: true, block_on_rejected_reviews: true } } });
        if (provider === 'gitlab')
            return parseProviderConfigurationProfile({ provider, version: 'editable-native-create/v1', repository: { only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true }, protection: { mode, name: branch, initial: { push_access_level: 0, merge_access_level: 40, unprotect_access_level: 40 }, fields: { allow_force_push: false, code_owner_approval_required: false } } });
        throw Error('Explicit create recommendation mode belongs to Gitea/GitLab; GitHub retains its separate ruleset profile');
    }
    if (provider === 'gitea')
        return parseProviderConfigurationProfile({ provider, version: 'editable-existing-rule/v1', protection: { name: branch, fields: { required_approvals: 1, dismiss_stale_approvals: true, block_on_rejected_reviews: true, enable_force_push: false } } });
    if (provider === 'gitlab')
        return parseProviderConfigurationProfile({ provider, version: 'editable-existing-rule/v1', repository: { only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true }, protection: { name: branch, fields: { allow_force_push: false } } });
    if (provider !== 'github')
        throw Error('Supported recommendation provider required');
    return parseConfigurationProfile({ version: 'editable-review-first/v1', ruleset: { name: 'gitjig recommended review', enforcement: 'active', include: ['refs/heads/' + branch], exclude: [], pullRequest: { approvingCount: 1, dismissStale: true, lastPushApproval: true, codeOwner: false, threadResolution: true }, nonFastForward: true, deletion: true, bypassUsers: [] } });
}

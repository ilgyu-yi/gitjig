import type { ProviderConfigurationProfile, ProviderConfigurationTarget } from './repository-configuration-profile.js';
import type { NativeProtectionResource } from './configuration-session.js';
/** Fixed inactive allowlists never introduce undisplayed user/team/deploy-key grants. */
const giteaInitialFlags = { enable_push_whitelist: false, enable_merge_whitelist: false, enable_approvals_whitelist: false, enable_force_push_allowlist: false, enable_bypass_allowlist: false };
export function nativeCreationSettings(profile: ProviderConfigurationProfile): Record<string, unknown> {
    if (profile.protection?.mode !== 'create' || !profile.protection.initial)
        throw Error('Explicit native protection creation required');
    return { ...profile.protection.fields, ...profile.protection.initial, ...profile.provider === 'gitea' ? giteaInitialFlags : {} };
}
export function nativeCreationPayload(profile: ProviderConfigurationProfile) { return { ...profile.provider === 'gitea' ? { rule_name: profile.protection!.name } : { name: profile.protection!.name }, ...nativeCreationSettings(profile) }; }
export function nativeProtectionResource(target: ProviderConfigurationTarget, row: Record<string, unknown>): NativeProtectionResource {
    const name = target.provider === 'gitea' ? row.rule_name ?? row.branch_name : row.name;
    if (typeof name !== 'string' || !name)
        throw Error('Native protection identity unavailable');
    if (target.provider === 'gitlab' && (!Number.isSafeInteger(row.id) || Number(row.id) < 1))
        throw Error('Positive native protected-branch identity unavailable');
    return { provider: target.provider, apiBase: target.apiBase, repositoryId: target.repositoryId, name, ...target.provider === 'gitlab' ? { id: row.id as number } : {} };
}
export function assertNativeResource(target: ProviderConfigurationTarget, name: string, resource: NativeProtectionResource) {
    if (resource.provider !== target.provider || resource.apiBase !== target.apiBase || resource.repositoryId !== target.repositoryId || resource.name !== name || Object.keys(resource).some(k => !['provider', 'apiBase', 'repositoryId', 'name', 'id'].includes(k)) || target.provider === 'gitlab' && (!Number.isSafeInteger(resource.id) || Number(resource.id) < 1) || target.provider === 'gitea' && Object.hasOwn(resource, 'id'))
        throw Error('Original native creation resource binding differs');
}
/** Scalar initial role is verified against the entire native role array, never a prefix. */
export function nativeCreationValue(provider: 'gitea' | 'gitlab', row: Record<string, unknown>, key: string, expected: unknown): unknown {
    let actual = row[key];
    if (provider === 'gitlab' && ['push_access_level', 'merge_access_level', 'unprotect_access_level'].includes(key)) {
        const values = row[key.replace('_access_level', '_access_levels')];
        if (!Array.isArray(values) || values.length !== 1)
            throw Error('Exact single native role grant unavailable');
        const role = values[0];
        if (!role || typeof role !== 'object' || Array.isArray(role) || Object.keys(role).some(k => !['id', 'access_level', 'access_level_description', 'user_id', 'group_id', 'deploy_key_id', 'member_role_id'].includes(k)) || role.user_id !== null || role.group_id !== null || role.deploy_key_id != null || role.member_role_id != null || !Number.isSafeInteger(role.access_level))
            throw Error('Native role grant has unknown or additional principal scope');
        actual = role.access_level;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.some(value => typeof value !== 'string'))
            throw Error('Native selected list unavailable');
    }
    else if (typeof actual !== typeof expected || typeof actual === 'number' && (!Number.isSafeInteger(actual) || actual < 0))
        throw Error('Native selected initial value unavailable');
    return actual;
}

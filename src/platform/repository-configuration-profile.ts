import { parseUniqueJson } from '../workflow/json.js';
import { repositoryApiBase, type RepositoryProvider } from './repository-inspect-transport.js';
import { validateRepositoryInspectionTarget } from './repository-inspect.js';
export interface ProviderConfigurationTarget {
    provider: RepositoryProvider;
    apiBase: string;
    repositoryId: number;
    owner: string;
    repository: string;
    actorUserId: number;
}
export interface ProviderConfigurationProfile {
    provider: RepositoryProvider;
    version: string;
    repository?: Record<string, boolean | string>;
    protection?: {
        name: string;
        mode?: 'update' | 'create';
        initial?: Record<string, number>;
        fields: Record<string, boolean | number | string[]>;
    };
}
const object = (v: unknown, allowed: string[], required: string[] = []) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(v, k)))
        throw Error('Unsupported or missing native configuration fields');
    return v as Record<string, unknown>;
};
const text = (v: unknown, max = 1024) => {
    if (typeof v !== 'string' || !v || Buffer.byteLength(v) > max || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v))
        throw Error('Bounded literal native configuration text required');
    return v;
};
const boolean = (v: unknown) => {
    if (typeof v !== 'boolean')
        throw Error('Native configuration boolean required');
};
const positive = (v: unknown) => {
    if (!Number.isSafeInteger(v) || Number(v) < 1)
        throw Error('Positive native identity required');
};
export function validateProviderConfigurationTarget(input: unknown): ProviderConfigurationTarget {
    const t = object(input, ['provider', 'apiBase', 'repositoryId', 'owner', 'repository', 'actorUserId'], ['provider', 'apiBase', 'repositoryId', 'owner', 'repository', 'actorUserId']);
    if (t.provider !== 'gitea' && t.provider !== 'gitlab')
        throw Error('Gitea or GitLab target required');
    repositoryApiBase(t.provider, text(t.apiBase, 2048));
    validateRepositoryInspectionTarget(t.provider, text(t.owner), text(t.repository));
    positive(t.repositoryId);
    positive(t.actorUserId);
    return { ...structuredClone(t), apiBase: repositoryApiBase(t.provider, t.apiBase as string).href } as unknown as ProviderConfigurationTarget;
}
export const giteaRepositorySettings = ['allow_merge_commits', 'allow_rebase', 'allow_rebase_explicit', 'allow_squash_merge'] as const;
export const giteaProtectionSettings = ['required_approvals', 'enable_status_check', 'status_check_contexts', 'dismiss_stale_approvals', 'ignore_stale_approvals', 'block_admin_merge_override', 'block_on_rejected_reviews', 'block_on_outdated_branch', 'block_on_official_review_requests', 'block_on_codeowner_reviews', 'require_signed_commits', 'enable_force_push', 'enable_push'] as const;
export const gitlabRepositorySettings = ['merge_method', 'squash_option', 'only_allow_merge_if_pipeline_succeeds', 'allow_merge_on_skipped_pipeline', 'only_allow_merge_if_all_discussions_are_resolved'] as const;
export const gitlabProtectionSettings = ['allow_force_push', 'code_owner_approval_required'] as const;
export function parseProviderConfigurationProfile(input: unknown): ProviderConfigurationProfile {
    if (typeof input === 'string')
        input = parseUniqueJson(input);
    if (Buffer.byteLength(JSON.stringify(input) ?? '') > 32 * 1024)
        throw Error('Native configuration profile exceeds 32KiB');
    const p = object(structuredClone(input), ['provider', 'version', 'repository', 'protection'], ['provider', 'version']);
    if (p.provider !== 'gitea' && p.provider !== 'gitlab')
        throw Error('Gitea or GitLab profile required');
    text(p.version, 100);
    if (!Object.hasOwn(p, 'repository') && !Object.hasOwn(p, 'protection'))
        throw Error('Select native repository or protection settings');
    if (Object.hasOwn(p, 'repository')) {
        const r = object(p.repository, p.provider === 'gitea' ? [...giteaRepositorySettings] : [...gitlabRepositorySettings]);
        if (!Object.keys(r).length)
            throw Error('Selected repository settings are empty');
        for (const [key, value] of Object.entries(r)) {
            if (key === 'merge_method') {
                if (typeof value !== 'string' || !['merge', 'rebase_merge', 'ff'].includes(value))
                    throw Error('Unsupported GitLab merge method');
            }
            else if (key === 'squash_option') {
                if (typeof value !== 'string' || !['never', 'always', 'default_on', 'default_off'].includes(value))
                    throw Error('Unsupported GitLab squash option');
            }
            else
                boolean(value);
        }
    }
    if (Object.hasOwn(p, 'protection')) {
        const protection = object(p.protection, ['name', 'fields', 'mode', 'initial'], ['name', 'fields']);
        text(protection.name);
        if (protection.mode !== undefined && !['update', 'create'].includes(protection.mode as string))
            throw Error('Explicit native protection mode must be update or create');
        if (protection.mode === 'create') {
            const name = protection.name as string;
            if (name === '@' || /[\x00-\x20\x7f~^:?*\[\\]/u.test(name) || name.startsWith('/') || name.endsWith('/') || name.includes('..') || name.includes('@{') || name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')))
                throw Error('Native creation requires a literal branch rule name');
            if (p.provider === 'gitea') {
                const initial = object(protection.initial, ['priority'], ['priority']);
                if (!Number.isSafeInteger(initial.priority) || Number(initial.priority) < 1 || Number(initial.priority) > 100)
                    throw Error('Explicit Gitea initial priority from 1 to 100 required');
            }
            else {
                const initial = object(protection.initial, ['push_access_level', 'merge_access_level', 'unprotect_access_level'], ['push_access_level', 'merge_access_level', 'unprotect_access_level']);
                for (const [key, value] of Object.entries(initial))
                    if (typeof value !== 'number' || !(key === 'unprotect_access_level' ? [30, 40] : [0, 30, 40]).includes(value))
                        throw Error('Explicit supported GitLab initial role levels required; unprotect cannot be zero');
            }
        }
        else if (Object.hasOwn(protection, 'initial'))
            throw Error('Initial native values require explicit create mode');
        const fields = object(protection.fields, p.provider === 'gitea' ? [...giteaProtectionSettings] : [...gitlabProtectionSettings]);
        if (!Object.keys(fields).length)
            throw Error('Selected protection settings are empty');
        if (protection.mode === 'create' && (p.provider === 'gitea' ? ['enable_push', 'block_admin_merge_override'] : ['allow_force_push', 'code_owner_approval_required']).some(key => !Object.hasOwn(fields, key)))
            throw Error('Native creation requires explicit initial push/administrator or force-push/code-owner choices');
        for (const [key, value] of Object.entries(fields)) {
            if (key === 'required_approvals') {
                if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100)
                    throw Error('Supported Gitea required approvals are integers from0 to100');
            }
            else if (key === 'status_check_contexts') {
                if (!Array.isArray(value) || value.length > 100 || new Set(value.map(x => text(x, 256))).size !== value.length)
                    throw Error('Finite distinct native status contexts required');
            }
            else
                boolean(value);
        }
    }
    return p as unknown as ProviderConfigurationProfile;
}

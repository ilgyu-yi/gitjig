import { recommendedConfiguration } from '../platform/repository-recommendation.js';
import { parseRepositoryConfigurationProfile, type RepositoryProfile } from '../platform/configuration-session.js';
import { giteaRepositorySettings, giteaProtectionSettings, gitlabRepositorySettings, gitlabProtectionSettings } from '../platform/repository-configuration-profile.js';
interface Forms {
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    guard(): void;
    show(title: string, text: string): Promise<void>;
}
type Field = {
    path: string;
    kind: 'boolean' | 'text' | 'number' | 'list' | 'enum';
    values?: string[];
    required?: boolean;
    max?: number;
    min?: number;
    numeric?: boolean;
};
const read = (value: any, path: string): unknown => path.split('.').reduce((node, key) => node?.[key], value);
function set(value: any, path: string, next: unknown) {
    const keys = path.split('.');
    let node = value;
    for (const key of keys.slice(0, -1))
        node = node[key] ??= {};
    if (next === undefined)
        delete node[keys.at(-1)!];
    else
        node[keys.at(-1)!] = next;
}
function fields(provider: 'github' | 'gitea' | 'gitlab'): Field[] {
    if (provider === 'github')
        return [
            { path: 'ruleset.name', kind: 'text', required: true }, { path: 'ruleset.enforcement', kind: 'enum', values: ['active', 'disabled'], required: true },
            { path: 'ruleset.pullRequest.approvingCount', kind: 'number', required: true, max: 10 },
            ...['dismissStale', 'lastPushApproval', 'codeOwner', 'threadResolution'].map(key => ({ path: 'ruleset.pullRequest.' + key, kind: 'boolean' as const, required: true })),
            ...['nonFastForward', 'deletion'].map(key => ({ path: 'ruleset.' + key, kind: 'boolean' as const, required: true })),
            ...['merge', 'squash', 'rebase'].map(key => ({ path: 'mergeMethods.' + key, kind: 'boolean' as const })),
        ];
    const repository = provider === 'gitea' ? giteaRepositorySettings : gitlabRepositorySettings, protection = provider === 'gitea' ? giteaProtectionSettings : gitlabProtectionSettings;
    return [...repository.map(key => ({ path: 'repository.' + key, kind: key === 'merge_method' || key === 'squash_option' ? 'enum' as const : 'boolean' as const, ...(key === 'merge_method' ? { values: ['merge', 'rebase_merge', 'ff'] } : key === 'squash_option' ? { values: ['never', 'always', 'default_on', 'default_off'] } : {}) })), ...protection.map(key => ({ path: 'protection.fields.' + key, kind: key === 'required_approvals' ? 'number' as const : key === 'status_check_contexts' ? 'list' as const : 'boolean' as const }))];
}
/** Staged known fields only. Omission means unmanaged, never an inferred false/zero. */
export async function editRepositoryProfile(forms: Forms, provider: 'github' | 'gitea' | 'gitlab', branch: string, mode: 'update' | 'create' = 'update'): Promise<RepositoryProfile | undefined> {
    const profile: any = structuredClone(recommendedConfiguration(branch, provider, mode)), available = fields(provider);
    if (mode === 'create') {
        if (provider === 'gitea') {
            available.push({ path: 'protection.initial.priority', kind: 'number', required: true, min: 1, max: 100 });
            for (const field of available)
                if (['protection.fields.enable_push', 'protection.fields.block_admin_merge_override'].includes(field.path))
                    field.required = true;
        }
        else if (provider === 'gitlab') {
            for (const key of ['push_access_level', 'merge_access_level', 'unprotect_access_level'])
                available.push({ path: 'protection.initial.' + key, kind: 'enum', required: true, numeric: true, values: key === 'unprotect_access_level' ? ['30', '40'] : ['0', '30', '40'] });
            for (const field of available)
                if (field.path.startsWith('protection.fields.'))
                    field.required = true;
        }
    }
    while (true) {
        forms.guard();
        const labels = available.map(field => field.path + ' · ' + (read(profile, field.path) === undefined ? 'unmanaged' : JSON.stringify(read(profile, field.path)))), picked = await forms.choose('Repository profile · staged only · ' + provider + ' · ' + branch, [...labels, 'Use staged profile for preview', 'Cancel profile']);
        forms.guard();
        if (!picked || picked === 'Cancel profile')
            return;
        if (picked === 'Use staged profile for preview') {
            const candidate = structuredClone(profile);
            if (candidate.repository && !Object.keys(candidate.repository).length)
                delete candidate.repository;
            if (candidate.mergeMethods && !Object.keys(candidate.mergeMethods).length)
                delete candidate.mergeMethods;
            if (candidate.protection && !Object.keys(candidate.protection.fields).length)
                delete candidate.protection;
            let validated: RepositoryProfile;
            try {
                validated = parseRepositoryConfigurationProfile(candidate);
            }
            catch (error) {
                await forms.show('Profile not ready · staged values retained', error instanceof Error ? error.message : 'Invalid repository profile');
                forms.guard();
                continue;
            }
            return validated;
        }
        const field = available[labels.indexOf(picked)];
        if (!field)
            throw Error('Profile field selection changed');
        const current = read(profile, field.path), omit = 'Leave unmanaged';
        const choices = [...(field.kind === 'boolean' ? ['true', 'false'] : field.kind === 'enum' ? field.values! : ['Edit value']), ...(!field.required ? [omit] : []), 'Keep current value'];
        const decision = await forms.choose(field.path + ' · staged value', choices);
        forms.guard();
        if (!decision || decision === 'Keep current value')
            continue;
        if (decision === omit) {
            set(profile, field.path, undefined);
            continue;
        }
        if (field.kind === 'boolean') {
            if (!['true', 'false'].includes(decision))
                throw Error('Unknown boolean selection');
            set(profile, field.path, decision === 'true');
            continue;
        }
        if (field.kind === 'enum') {
            if (!field.values!.includes(decision))
                throw Error('Unknown enum selection');
            set(profile, field.path, field.numeric ? Number(decision) : decision);
            continue;
        }
        if (decision !== 'Edit value')
            throw Error('Unknown field action');
        if (field.kind === 'list') {
            const values: string[] = current === undefined ? [] : structuredClone(current as string[]);
            while (true) {
                const selected = await forms.choose(field.path + ' · exact contexts', [...values.map((v, i) => 'Remove ' + i + ' · ' + v), 'Add context', 'Save list', 'Cancel list']);
                forms.guard();
                if (!selected || selected === 'Cancel list')
                    break;
                if (selected === 'Save list') {
                    set(profile, field.path, values);
                    break;
                }
                if (selected === 'Add context') {
                    const text = await forms.input('Exact status context · no JSON', '');
                    forms.guard();
                    if (text !== undefined) {
                        if (!text || Buffer.byteLength(text) > 256 || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(text) || values.includes(text) || values.length >= 100) {
                            await forms.show('Context not staged', 'Use a distinct printable context up to 256 bytes; maximum 100. Staged values are retained.');
                            forms.guard();
                            continue;
                        }
                        values.push(text);
                    }
                }
                else {
                    const index = values.findIndex((v, i) => selected === 'Remove ' + i + ' · ' + v);
                    if (index < 0)
                        throw Error('Context selection changed');
                    values.splice(index, 1);
                }
            }
        }
        else {
            const input = await forms.input(field.path + ' · ' + (field.kind === 'number' ? 'whole number from ' + (field.min ?? 0) + ' to ' + (field.max ?? 100) : 'plain text'), current === undefined ? '' : String(current));
            forms.guard();
            if (input === undefined)
                continue;
            if (field.kind === 'number') {
                if (!/^(?:0|[1-9][0-9]?|100)$/u.test(input) || Number(input) > (field.max ?? 100) || Number(input) < (field.min ?? 0)) {
                    await forms.show('Value not staged', 'Use a whole number from ' + (field.min ?? 0) + ' to ' + (field.max ?? 100) + '. Staged values are retained.');
                    forms.guard();
                    continue;
                }
                set(profile, field.path, Number(input));
            }
            else
                set(profile, field.path, input);
        }
    }
}

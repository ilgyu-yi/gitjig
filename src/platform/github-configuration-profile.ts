import { parseUniqueJson } from '../workflow/json.js';
import { policyCanonical, policyHash } from './github-policy-schema.js';
import type { ConfigurationProfile } from './github-configuration-types.js';
const object = (value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Configuration object required');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(row, key)))
        throw Error('Unsupported or missing configuration field');
    return row;
};
const text = (value: unknown, limit = 256): string => {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > limit || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value))
        throw Error('Bounded configuration text required');
    return value;
};
const bool = (value: unknown): boolean => {
    if (typeof value !== 'boolean')
        throw Error('Configuration boolean required');
    return value;
};
const list = (value: unknown, check: (item: unknown) => unknown, max = 100): void => {
    if (!Array.isArray(value) || value.length > max)
        throw Error('Finite configuration list required');
    const keys = value.map(item => policyCanonical(check(item)));
    if (new Set(keys).size !== keys.length)
        throw Error('Duplicate configuration entry');
};
const id = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
        throw Error('Positive configuration actor/integration ID required');
    return value as number;
};
/** Raw JSON callers must use this entry before JSON.parse could lose duplicate keys. */
export function parseConfigurationProfile(input: unknown): ConfigurationProfile {
    if (typeof input === 'string') {
        if (Buffer.byteLength(input) > 32 * 1024)
            throw Error('Configuration profile byte limit exceeded');
        input = parseUniqueJson(input);
    }
    const captured = structuredClone(input);
    if (Buffer.byteLength(policyCanonical(captured)) > 32 * 1024)
        throw Error('Configuration profile byte limit exceeded');
    const p = object(captured, ['version', 'ruleset', 'mergeMethods'], ['version']);
    text(p.version, 100);
    if (!Object.hasOwn(p, 'ruleset') && !Object.hasOwn(p, 'mergeMethods'))
        throw Error('At least one selected configuration group required');
    if (Object.hasOwn(p, 'ruleset')) {
        const r = object(p.ruleset, ['name', 'enforcement', 'include', 'exclude', 'pullRequest', 'statusChecks', 'nonFastForward', 'deletion', 'bypassUsers'], ['name', 'enforcement', 'include', 'exclude', 'nonFastForward', 'deletion', 'bypassUsers']);
        text(r.name, 128);
        if (r.enforcement !== 'active' && r.enforcement !== 'disabled')
            throw Error('Unsupported configuration enforcement');
        list(r.include, item => text(item, 1024));
        list(r.exclude, item => text(item, 1024));
        if (!(r.include as unknown[]).length)
            throw Error('At least one native include pattern required');
        bool(r.nonFastForward);
        bool(r.deletion);
        if (Object.hasOwn(r, 'pullRequest') && r.pullRequest !== null) {
            const pr = object(r.pullRequest, ['approvingCount', 'dismissStale', 'lastPushApproval', 'codeOwner', 'threadResolution']);
            if (!Number.isSafeInteger(pr.approvingCount) || (pr.approvingCount as number) < 0 || (pr.approvingCount as number) > 10)
                throw Error('Unsupported approving count');
            for (const key of ['dismissStale', 'lastPushApproval', 'codeOwner', 'threadResolution'])
                bool(pr[key]);
        }
        if (Object.hasOwn(r, 'statusChecks') && r.statusChecks !== null) {
            const sc = object(r.statusChecks, ['contexts', 'strict']);
            bool(sc.strict);
            list(sc.contexts, item => {
                const c = object(item, ['context', 'integrationId'], ['context']);
                text(c.context, 256);
                if (Object.hasOwn(c, 'integrationId'))
                    id(c.integrationId);
                return c;
            });
        }
        list(r.bypassUsers, item => {
            const a = object(item, ['userId', 'mode']);
            id(a.userId);
            if (a.mode !== 'always' && a.mode !== 'pull_request')
                throw Error('Unsupported explicit User bypass mode');
            return a.userId;
        });
    }
    if (Object.hasOwn(p, 'mergeMethods')) {
        const m = object(p.mergeMethods, ['merge', 'squash', 'rebase'], []);
        if (!Object.keys(m).length)
            throw Error('Selected merge-method delta required');
        for (const value of Object.values(m))
            bool(value);
    }
    return captured as ConfigurationProfile;
}
export const configurationProfileHash = (profile: ConfigurationProfile): string => policyHash(parseConfigurationProfile(profile));

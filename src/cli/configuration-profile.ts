import { readOwnerJson } from '../app/owner-json.js';
import { parseRepositoryConfigurationProfile as parseConfigurationProfile, validateRepositoryConfigurationTarget as validateTarget, type RepositoryProfile as ConfigurationProfile, type RepositoryTarget as ConfigurationTarget } from '../platform/configuration-session.js';
export async function readConfigurationTarget(file: string, projects: readonly string[]): Promise<ConfigurationTarget> {
    const value = await readOwnerJson(file, projects, 'Repository configuration target', 16 * 1024);
    if (value && typeof value === 'object' && Object.hasOwn(value, 'provider'))
        return validateTarget(value);
    const fields = ['host', 'repositoryId', 'repositoryNodeId', 'owner', 'repository', 'actorUserId', 'visibility'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
        throw Error('Repository configuration target requires only the exact canonical identity and visibility');
    }
    return validateTarget(value);
}
export async function readConfigurationProfile(file: string, projects: readonly string[]): Promise<ConfigurationProfile> {
    return parseConfigurationProfile(await readOwnerJson(file, projects, 'Repository configuration profile', 32 * 1024));
}

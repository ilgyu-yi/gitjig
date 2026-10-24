import { readOwnerJson } from '../app/owner-json.js';
import { validateContributionResource, type ContributionRepository } from '../platform/github-contributions.js';
export async function readContributionRepository(file: string, projects: readonly string[]): Promise<ContributionRepository> {
    const value = await readOwnerJson(file, projects, 'Tracked repository profile', 16 * 1024);
    const keys = ['owner', 'repository', 'repositoryId', 'repositoryNodeId'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
        throw Error('Tracked repository profile requires only exact repository name and native ID/node');
    const repository = value as ContributionRepository;
    validateContributionResource({ repository, kind: 'issue', number: 1 });
    return repository;
}

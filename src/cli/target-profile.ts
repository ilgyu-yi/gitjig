import { isAbsolute } from 'node:path';
import { readOwnerJson } from '../app/owner-json.js';
import { hostedTarget, type RegisterHostedIntegrationTarget } from '../controller/hostedintegration.js';
export interface LocalTargetProfile {
    projectId: string;
    path: string;
    ref: string;
    basisCommit: string;
    publicationInventory: readonly string[];
    authorizedDeltaPaths: readonly string[];
}
export type HostedTargetProfile = RegisterHostedIntegrationTarget & {
    kind: 'github-existing-ref';
};
/** Native registration still observes actual endpoint identity/policy/authority. */
export async function readTargetProfile(file: string, projectRoots: readonly string[]): Promise<LocalTargetProfile | HostedTargetProfile> {
    const value = await readOwnerJson(file, projectRoots, 'Target profile', 8 * 1024 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Target profile requires an object');
    const row = value as Record<string, unknown>;
    if ('kind' in row) {
        const repository = row.repository;
        if (row.kind !== 'github-existing-ref' ||
            Object.keys(row).some(key => !['kind', 'projectId', 'repository', 'expectedUserId', 'ref', 'basisCommit', 'publicationInventory', 'authorizedDeltaPaths'].includes(key)) ||
            typeof row.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.projectId) ||
            typeof row.ref !== 'string' || typeof row.basisCommit !== 'string' ||
            !repository || typeof repository !== 'object' || Array.isArray(repository) ||
            Object.keys(repository).some(key => !['owner', 'repository', 'repositoryId', 'repositoryNodeId', 'visibility'].includes(key)) ||
            (repository as Record<string, unknown>).visibility !== 'public') {
            throw Error('Hosted target requires only PUBLIC canonical repository identity, registered project, branch, basis and explicit inventories');
        }
        for (const key of ['publicationInventory', 'authorizedDeltaPaths']) {
            if (!Array.isArray(row[key]) || row[key].some(p => typeof p !== 'string' || p.includes('\\'))) {
                throw Error('Hosted inventories require literal supported relative paths');
            }
        }
        const { kind, ...target } = row as unknown as HostedTargetProfile;
        hostedTarget(target); // Literal shape validation only; native identity is observed at registration.
        return { kind, ...target };
    }
    if (Object.keys(row).some(key => !['projectId', 'path', 'ref', 'basisCommit', 'publicationInventory', 'authorizedDeltaPaths'].includes(key)) ||
        typeof row.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.projectId) ||
        typeof row.path !== 'string' || !isAbsolute(row.path) || row.path.includes('\0') ||
        typeof row.ref !== 'string' || !row.ref.startsWith('refs/heads/') || row.ref.includes('\0') ||
        typeof row.basisCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(row.basisCommit)) {
        throw new Error('Target profile requires only registered project, absolute path, branch ref, basis and explicit path inventories');
    }
    for (const key of ['publicationInventory', 'authorizedDeltaPaths']) {
        const paths = row[key];
        if (!Array.isArray(paths) || paths.length > 100000 || paths.some(path => typeof path !== 'string' || !path || path.includes('\0')) || new Set(paths).size !== paths.length) {
            throw new Error('Target profile inventories require distinct literal paths within the supported entry limit');
        }
    }
    return row as unknown as LocalTargetProfile;
}

import { readOwnerJson } from '../app/owner-json.js';
import type { RegisterPublicationTarget, PublicationActionClass, PublicationDelegationConfig } from '../controller/publication-types.js';
import type { PublicationAction } from '../platform/github-publication.js';
function fields(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
        throw Error(`${label} contains missing or unsupported fields`);
    }
    return value as Record<string, unknown>;
}
export async function readPublicationTarget(file: string, projects: readonly string[]): Promise<RegisterPublicationTarget> {
    const value = fields(await readOwnerJson(file, projects, 'Publication target profile', 64 * 1024), ['projectId', 'target', 'visibility', 'carrierPolicy'], ['target', 'visibility'], 'Publication target profile');
    // The native controller validates identity, visibility, policy and project scope.
    return value as unknown as RegisterPublicationTarget;
}
export async function readPublicationAction(file: string): Promise<PublicationAction> {
    // Explicitly selected owner payload is data, including inside a project. It grants no credential/config authority.
    const value = await readOwnerJson(file, [], 'Exact owner publication payload', 132 * 1024);
    const row = fields(value, ['kind', 'title', 'body', 'headRef', 'headCommit', 'baseRef', 'parent', 'purpose'], ['kind', 'body'], 'Publication payload');
    const allowed = row.kind === 'create-issue' ? ['kind', 'title', 'body']
        : row.kind === 'create-draft-pr' ? ['kind', 'title', 'body', 'headRef', 'headCommit', 'baseRef']
            : row.kind === 'create-comment' ? ['kind', 'parent', 'body', 'purpose'] : null;
    if (!allowed)
        throw Error('Unsupported publication action');
    fields(row, allowed, allowed, 'Publication payload');
    return row as unknown as PublicationAction;
}
export async function readPublicationGrant(file: string, projects: readonly string[]): Promise<{
    actions: PublicationActionClass[];
    projectIds?: (string | null)[];
}> {
    return grantData(await readOwnerJson(file, projects, 'Publication grant profile', 16 * 1024));
}
function grantData(value: unknown): {
    actions: PublicationActionClass[];
    projectIds?: (string | null)[];
} {
    const row = fields(value, ['actions', 'projectIds'], ['actions'], 'Publication grant profile');
    const allowed = ['create-issue', 'create-draft-pr', 'create-comment:bootstrap', 'create-comment:reviewed-summary'];
    if (!Array.isArray(row.actions) || !row.actions.length || row.actions.some(action => !allowed.includes(action)) || new Set(row.actions).size !== row.actions.length) {
        throw Error('Publication grant requires distinct supported action classes');
    }
    if (row.projectIds !== undefined && (!Array.isArray(row.projectIds) || row.projectIds.some(id => id !== null && typeof id !== 'string') || new Set(row.projectIds).size !== row.projectIds.length)) {
        throw Error('Publication grant project scopes require distinct project IDs or null');
    }
    return row as unknown as {
        actions: PublicationActionClass[];
        projectIds?: (string | null)[];
    };
}
export async function readPublicationDelegations(file: string, projects: readonly string[]): Promise<PublicationDelegationConfig[]> {
    const value = await readOwnerJson(file, projects, 'Publication delegation configuration', 64 * 1024);
    if (!Array.isArray(value) || value.length > 100)
        throw Error('Publication configuration requires at most100 target grants');
    const result = value.map(item => {
        const row = fields(item, ['targetId', 'actions', 'projectIds', 'operationLimit'], ['targetId', 'actions', 'operationLimit'], 'Publication delegation configuration');
        if (typeof row.targetId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.targetId) || !Number.isSafeInteger(row.operationLimit) || Number(row.operationLimit) < 1 || Number(row.operationLimit) > 100) {
            throw Error('Publication configuration requires a target ID and operation limit1..100');
        }
        return { targetId: row.targetId, operationLimit: Number(row.operationLimit), ...grantData({ actions: row.actions, ...(row.projectIds !== undefined ? { projectIds: row.projectIds } : {}) }) };
    });
    if (new Set(result.map(row => row.targetId)).size !== result.length)
        throw Error('Publication configuration target grants must be distinct');
    return result;
}

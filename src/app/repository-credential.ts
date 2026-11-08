import { readOwnerJson } from './owner-json.js';
/** Explicit host file only; never a conversation or project input. No credential store. */
export async function readRepositoryCredential(file: string, projectRoots: readonly string[], label = 'Repository credential profile'): Promise<{
    token: string;
}> {
    const value = await readOwnerJson(file, projectRoots, label, 16 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'token') || typeof (value as {
        token: unknown;
    }).token !== 'string')
        throw Error(label + ' requires only an explicit token');
    return { token: (value as {
            token: string;
        }).token };
}

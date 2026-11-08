import { readOwnerJson } from '../app/owner-json.js';
/** Owner data only; no per-run or model configuration route. */
export async function readProtectionProfile(file: string, projects: readonly string[]): Promise<{
    protectedPaths: string[];
}> {
    const value = await readOwnerJson(file, projects, 'Project protection profile', 32 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'protectedPaths') || !Array.isArray((value as {
        protectedPaths: unknown;
    }).protectedPaths) || (value as {
        protectedPaths: unknown[];
    }).protectedPaths.some(path => typeof path !== 'string'))
        throw Error('Project protection profile requires only protectedPaths:string[]');
    return value as {
        protectedPaths: string[];
    };
}

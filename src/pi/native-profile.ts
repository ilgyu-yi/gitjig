import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { directProviderCapability } from './provider-capabilities.js';
/** Explicit host configuration, not a token snapshot or a model-owned resource. */
export interface NativeOAuthProfile {
    kind: 'pi-oauth';
    authPath: string;
    /** Added by the host profile reader; never accepted from profile JSON. */
    projectRoots: readonly string[];
}
export interface PiStoredProfile {
    kind: 'pi-stored';
    credentialType: 'api_key' | 'oauth';
    authPath: string;
    /** Host-derived scope, never accepted from profile JSON. */
    projectRoots: readonly string[];
}
export type NativeProviderProfile = NativeOAuthProfile | PiStoredProfile;
export async function assertNativeOAuthProfile(provider: string, modelId: string, value: NativeOAuthProfile, additionalRoots: readonly string[] = []): Promise<void> {
    if (provider !== 'openai-codex' || modelId !== 'gpt-6.1-sol' || !value || value.kind !== 'pi-oauth' ||
        Object.keys(value).some(key => !['kind', 'authPath', 'projectRoots'].includes(key)) ||
        typeof value.authPath !== 'string' || !isAbsolute(value.authPath) || !Array.isArray(value.projectRoots))
        throw new Error('Native profile requires the selected openai-codex/gpt-6.1-sol OAuth configuration');
    await assertPrivateAuthFile(value.authPath, [...value.projectRoots, ...additionalRoots]);
}
export async function assertNativeProviderProfile(provider: string, modelId: string, value: NativeProviderProfile, additionalRoots: readonly string[] = []): Promise<void> {
    if (value?.kind === 'pi-oauth')
        return assertNativeOAuthProfile(provider, modelId, value, additionalRoots);
    if (!value || value.kind !== 'pi-stored' || Object.keys(value).some(key => !['kind', 'credentialType', 'authPath', 'projectRoots'].includes(key)) ||
        !['api_key', 'oauth'].includes(value.credentialType) || typeof modelId !== 'string' || !modelId.trim() ||
        typeof value.authPath !== 'string' || !isAbsolute(value.authPath) || !Array.isArray(value.projectRoots))
        throw new Error('Stored Pi profile requires an explicit model, credential kind and canonical private auth file');
    directProviderCapability(provider, value.credentialType);
    await assertPrivateAuthFile(value.authPath, [...value.projectRoots, ...additionalRoots]);
}
async function assertPrivateAuthFile(authPath: string, projectRoots: readonly string[]): Promise<void> {
    if (await realpath(authPath) !== authPath)
        throw new Error('Native auth requires an existing canonical owner-private file');
    for (const root of projectRoots) {
        if (typeof root !== 'string' || !isAbsolute(root) || await realpath(root) !== root)
            throw new Error('Native profile project roots must be canonical absolute host inputs');
        const rel = relative(root, authPath);
        if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)))
            throw new Error('Native auth must be outside every project input');
    }
    const handle = await open(authPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 128 * 1024)
            throw new Error('Native auth requires an existing owner-only regular file within128KiB');
    }
    finally {
        await handle.close();
    }
}

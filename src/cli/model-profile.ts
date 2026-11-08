import { readOwnerJson } from '../app/owner-json.js';
import { assertNativeProviderProfile } from '../pi/native-profile.js';
import { parseNativeClaudeProfile, type NativeClaudeProfile } from '../pi/claude-profile.js';
import type { PiModelSelection } from '../pi/session.js';
/** Explicit host configuration only; this module imports no SDK at runtime. */
export async function readModelProfile(file: string, projectRoots: readonly string[]): Promise<PiModelSelection | {
    provider: string;
    modelId: string;
    bridgeProfile: NativeClaudeProfile;
}> {
    const value = await readOwnerJson(file, projectRoots, 'Model profile', 128 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Model profile must be a JSON object');
    const profile = value as Record<string, unknown>;
    if (profile.native !== undefined) {
        const native = profile.native as Record<string, unknown>;
        if (native && typeof native === 'object' && native.kind === 'installed-claude-bridge') {
            if (Object.keys(profile).some(key => !['provider', 'modelId', 'native'].includes(key)) || profile.provider !== 'claude-bridge' || profile.modelId !== 'claude-opus-5-5')
                throw new Error('Bridge profile requires the exact selected claude-bridge/claude-opus-5-5');
            return Object.freeze({ provider: profile.provider, modelId: profile.modelId, bridgeProfile: await parseNativeClaudeProfile(native, projectRoots) });
        }
        if (Object.keys(profile).some(key => !['provider', 'modelId', 'native'].includes(key)) || !native || typeof native !== 'object' || Array.isArray(native) ||
            typeof native.authPath !== 'string' || typeof profile.provider !== 'string' || typeof profile.modelId !== 'string')
            throw new Error('Native model profile requires provider, modelId and an explicit private credential source');
        const roots = Object.freeze([...projectRoots]);
        let admitted;
        if (native.kind === 'pi-oauth' && !Object.keys(native).some(key => !['kind', 'authPath'].includes(key)))
            admitted = Object.freeze({ kind: 'pi-oauth' as const, authPath: native.authPath, projectRoots: roots });
        else if (native.kind === 'pi-stored' && ['api_key', 'oauth'].includes(String(native.credentialType)) &&
            !Object.keys(native).some(key => !['kind', 'authPath', 'credentialType'].includes(key)))
            admitted = Object.freeze({ kind: 'pi-stored' as const, credentialType: native.credentialType as 'api_key' | 'oauth', authPath: native.authPath, projectRoots: roots });
        else
            throw new Error('Native model profile requires pi-oauth or pi-stored with an explicit credential kind');
        await assertNativeProviderProfile(profile.provider, profile.modelId, admitted);
        return Object.freeze({ provider: profile.provider, modelId: profile.modelId, native: admitted });
    }
    if (Object.keys(profile).some(key => !['provider', 'modelId', 'definition'].includes(key)) ||
        typeof profile.provider !== 'string' || !profile.provider.trim() ||
        typeof profile.modelId !== 'string' || !profile.modelId.trim() ||
        !profile.definition || typeof profile.definition !== 'object' || Array.isArray(profile.definition)) {
        throw new Error('Model profile requires provider, modelId and explicit definition only');
    }
    const definition = profile.definition as Record<string, unknown>;
    if (typeof definition.apiKey !== 'string' || !definition.apiKey || definition.apiKey.startsWith('!') || definition.apiKey.includes('$') ||
        typeof definition.baseUrl !== 'string' || !definition.baseUrl.trim() || !Array.isArray(definition.models) ||
        !definition.models.some(model => model && typeof model === 'object' && (model as Record<string, unknown>).id === profile.modelId)) {
        throw new Error('Model profile requires a literal key, explicit baseUrl and matching declared model');
    }
    return value as PiModelSelection;
}

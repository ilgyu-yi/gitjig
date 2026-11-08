import { InMemoryCredentialStore, type ProviderHeaders, type ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent';
import { assertNativeProviderProfile, type NativeProviderProfile } from './native-profile.js';
import { directProtocolPolicy, directProviderCapability } from './provider-capabilities.js';
import { ownChatRuntime } from './owned-runtime.js';
const headerRefusal = () => new Error('Selected native profile requires original Pi authentication headers; remove unsupported header customization and reopen');
function headerMap(headers: ProviderHeaders) {
    const entries = new Map<string, string | null>();
    for (const [name, value] of Object.entries(headers)) {
        const key = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(key) || entries.has(key) ||
            (value !== null && (typeof value !== 'string' || /[\r\n\u0000]/u.test(value))))
            throw headerRefusal();
        entries.set(key, value);
    }
    return entries;
}
/** Compare against original resolution, before caller headers can replace it. */
export function selectedHeaders(options: Pick<ModelsSimpleStreamOptions, 'headers' | 'transformHeaders'> | undefined, metadata: readonly string[]) {
    if (options?.headers !== undefined && (!options.headers || typeof options.headers !== 'object' || Array.isArray(options.headers)))
        throw headerRefusal();
    const supplied = headerMap({ ...options?.headers }), transform = options?.transformHeaders;
    if (transform !== undefined && typeof transform !== 'function')
        throw headerRefusal();
    return { headers: {}, transformHeaders: async (resolved: ProviderHeaders): Promise<ProviderHeaders> => {
            const original = { ...resolved }, baseline = headerMap(original);
            for (const [name, value] of supplied)
                if (!baseline.has(name) || baseline.get(name) !== value)
                    throw headerRefusal();
            const output = transform ? await transform({ ...original }) : original;
            if (!output || typeof output !== 'object' || Array.isArray(output))
                throw headerRefusal();
            // Snapshot before validation/return: a callback cannot retain the wire map.
            const snapshot = { ...output }, actual = headerMap(snapshot);
            for (const [name, value] of baseline)
                if (!actual.has(name) || actual.get(name) !== value)
                    throw headerRefusal();
            for (const name of actual.keys())
                if (!baseline.has(name) && !metadata.includes(name))
                    throw headerRefusal();
            return snapshot;
        } };
}
function literalCredential(provider: string, authPath: string): string {
    let value: ReturnType<typeof readStoredCredential>;
    try {
        value = readStoredCredential(provider, authPath);
    }
    catch {
        throw new Error('Selected stored credential is unreadable; repair the private authentication file');
    }
    if (!value || value.type !== 'api_key' || Object.keys(value).some(key => !['type', 'key'].includes(key)) ||
        typeof value.key !== 'string' || !value.key || /[\s\u0000-\u001f\u007f]/u.test(value.key) || value.key.startsWith('!') || value.key.includes('$'))
        throw new Error('Selected stored credential requires a nonempty literal API key; no environment/helper fallback is allowed');
    return value.key;
}
/** One selected builtin chat path; original Pi owns catalogue, auth and protocol. */
export async function createOwnedPiProvider(provider: string, modelId: string, requestedProfile: NativeProviderProfile, requestedRoots: readonly string[]) {
    const profile = Object.freeze({ ...structuredClone(requestedProfile), projectRoots: Object.freeze([...requestedProfile.projectRoots]) });
    const roots = Object.freeze([...requestedRoots]);
    await assertNativeProviderProfile(provider, modelId, profile, roots);
    const credentialType = profile.kind === 'pi-oauth' ? 'oauth' : profile.credentialType;
    const capability = directProviderCapability(provider, credentialType);
    let selectedKey: string | undefined, credentials: InMemoryCredentialStore | undefined;
    if (credentialType === 'api_key') {
        selectedKey = literalCredential(provider, profile.authPath);
        credentials = new InMemoryCredentialStore();
        await credentials.modify(provider, async () => ({ type: 'api_key', key: selectedKey! }));
    }
    const runtime = await ModelRuntime.create({ ...(credentials ? { credentials } : { authPath: profile.authPath }),
        modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    // Static catalogue access does not start auth; install ownership before any refresh/session.
    const selected = runtime.getModel(provider, modelId);
    const identity = selected && Object.freeze({ api: selected.api, baseUrl: selected.baseUrl });
    const assertModel = (model: {
        provider: string;
        id: string;
        api: string;
        baseUrl: string;
    }) => {
        if (!identity || model.provider !== provider || model.id !== modelId || model.api !== identity.api || model.baseUrl !== identity.baseUrl)
            throw new Error('Explicit native model is unavailable; no model or endpoint fallback is allowed');
    };
    const validateCredential = async () => {
        await assertNativeProviderProfile(provider, modelId, profile, roots);
        if (credentialType === 'api_key') {
            if (literalCredential(provider, profile.authPath) !== selectedKey)
                throw new Error('Selected stored credential changed; reopen a fresh execution with the intended profile');
        }
        else if ((await runtime.listCredentials()).find(item => item.providerId === provider)?.type !== 'oauth') {
            throw new Error('Selected native OAuth credential is unavailable; use the configured Pi login outside this workflow');
        }
    };
    // Unknown selection has no running tasks, but acquires the same cleanup owner.
    const policy = selected ? directProtocolPolicy(provider, credentialType, selected.api) : {};
    const owner = ownChatRuntime(runtime, {
        assertModel, streamOptions: policy, streamHeaders: options => selectedHeaders(options, capability.metadataHeaders),
        beforeAuth: async (target, options) => {
            if ((typeof target === 'string' ? target : target.provider) !== provider || options.env !== undefined)
                throw new Error('Native profile cannot select another credential or environment fallback');
            if (typeof target !== 'string')
                assertModel(target);
            await validateCredential();
            if (options.apiKey !== undefined) {
                // Native Pi summaries forward the already resolved key. Accept only
                // the same selected credential; this cannot select another source.
                let admitted = selectedKey;
                if (credentialType === 'oauth') {
                    let current: ReturnType<typeof readStoredCredential>;
                    try {
                        current = readStoredCredential(provider, profile.authPath);
                    }
                    catch {
                        throw new Error('Selected OAuth credential is unreadable');
                    }
                    admitted = current?.type === 'oauth' ? current.access : undefined;
                }
                if (!admitted || options.apiKey !== admitted)
                    throw new Error('Native profile cannot select another credential or environment fallback');
            }
        },
    });
    try {
        if (!selected)
            throw new Error('Selected native model is unavailable; choose an explicit model from the Pi catalogue');
        assertModel(selected);
        await validateCredential();
        return { ...owner, selected };
    }
    catch (error) {
        await owner.close();
        throw error;
    }
}

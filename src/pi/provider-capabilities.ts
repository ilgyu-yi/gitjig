import type { StreamOptions } from '@earendil-works/pi-ai';
/** Qualified source/protocol classes, not a replacement provider catalogue. */
const capabilities = Object.freeze({
    'openai-codex': Object.freeze({ credentialType: 'oauth', apis: Object.freeze(['openai-codex-responses']), metadataHeaders: Object.freeze([] as string[]) }),
    openai: Object.freeze({ credentialType: 'api_key', apis: Object.freeze(['openai-responses']), metadataHeaders: Object.freeze([] as string[]) }),
    openrouter: Object.freeze({ credentialType: 'api_key', apis: Object.freeze(['openai-completions']),
        metadataHeaders: Object.freeze(['http-referer', 'x-openrouter-title', 'x-openrouter-categories']) }),
});
const protocols: Readonly<Record<string, Readonly<Pick<StreamOptions, 'transport' | 'maxRetries'>>>> = Object.freeze({
    'openai-codex-responses': Object.freeze({ transport: 'sse', maxRetries: 0 }),
    'openai-responses': Object.freeze({ maxRetries: 0 }),
    'openai-completions': Object.freeze({ maxRetries: 0 }),
});
export function directProviderCapability(provider: string, credentialType: string) {
    if (!Object.hasOwn(capabilities, provider))
        throw new Error('Owned Pi provider capability is unavailable; select a documented provider/authentication profile');
    const capability = capabilities[provider as keyof typeof capabilities];
    if (capability.credentialType !== credentialType)
        throw new Error('Selected provider authentication kind is unavailable; select its documented credential source');
    return capability;
}
export function directProtocolPolicy(provider: string, credentialType: string, api: string) {
    const capability = directProviderCapability(provider, credentialType);
    if (!capability.apis.some(item => item === api) || !Object.hasOwn(protocols, api))
        throw new Error('Selected Pi API capability is unavailable; select a documented chat model/API family');
    return protocols[api]!;
}

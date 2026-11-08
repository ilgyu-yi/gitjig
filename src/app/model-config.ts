type ObjectValue = Record<string, unknown>;
export const isObject = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
/** Managed configuration is data, never a credential command or ambient lookup. */
export function literalValue(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.length || /[\u0000-\u001f\u007f$]/u.test(value) || value.startsWith('!'))
        throw new Error('Managed authentication requires literal values; credential helpers and environment references are not enabled');
}
export function admitModelConfiguration(value: ObjectValue): void {
    if (!Object.keys(value).length)
        return;
    if (!isObject(value.providers) || Object.keys(value).some(key => key !== 'providers' && key !== '$schema'))
        throw new Error('Model configuration requires a providers object');
    if (Object.hasOwn(value.providers, 'claude-bridge'))
        throw new Error('claude-bridge is reserved for the original Claude Code-backed route; remove its direct provider configuration and use bridge setup');
    for (const provider of Object.values(value.providers)) {
        if (!isObject(provider))
            throw new Error('Invalid provider configuration');
        if (provider.apiKey !== undefined)
            literalValue(provider.apiKey);
        if (provider.models !== undefined && (!Array.isArray(provider.models) || !provider.models.every(isObject)))
            throw new Error('Invalid model definitions');
        if (provider.modelOverrides !== undefined && (!isObject(provider.modelOverrides) || !Object.values(provider.modelOverrides).every(isObject)))
            throw new Error('Invalid model overrides');
        const entries = [provider, ...(provider.models as ObjectValue[] | undefined ?? []), ...Object.values(provider.modelOverrides as Record<string, ObjectValue> | undefined ?? {})];
        for (const entry of entries) {
            if (entry.headers !== undefined) {
                if (!isObject(entry.headers))
                    throw new Error('Invalid model headers');
                for (const header of Object.values(entry.headers))
                    literalValue(header);
            }
            if (entry.baseUrl !== undefined) {
                if (typeof entry.baseUrl !== 'string')
                    throw new Error('Invalid model endpoint');
                const url = new URL(entry.baseUrl);
                if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
                    throw new Error('Model endpoints require HTTP(S) without embedded credentials or fragments');
            }
        }
    }
}
export function admitCredentials(value: ObjectValue): void {
    for (const credential of Object.values(value)) {
        if (!isObject(credential))
            throw new Error('Invalid managed credential; repair the application auth file');
        if (credential.type === 'api_key') {
            if (credential.key !== undefined)
                literalValue(credential.key);
            if (credential.env !== undefined) {
                if (!isObject(credential.env))
                    throw new Error('Invalid managed credential values');
                for (const entry of Object.values(credential.env))
                    literalValue(entry);
            }
        }
        else if (credential.type !== 'oauth' || typeof credential.access !== 'string' || typeof credential.refresh !== 'string' || typeof credential.expires !== 'number' || !Number.isFinite(credential.expires)) {
            throw new Error('Invalid managed credential; repair the application auth file');
        }
    }
}
/** Local source presence after admission; no credential value leaves this classification. */
export function configuredCredentialType(config: ObjectValue, credentials: ObjectValue, provider: string): 'api_key' | 'oauth' | 'configured' | undefined {
    const credential = credentials[provider];
    if (isObject(credential))
        return credential.type as 'api_key' | 'oauth';
    const configured = isObject(config.providers) ? config.providers[provider] : undefined;
    return isObject(configured) && typeof configured.apiKey === 'string' ? 'configured' : undefined;
}

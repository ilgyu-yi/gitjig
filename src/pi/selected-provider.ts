import { isDeepStrictEqual } from 'node:util';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api, Model, AuthContext, ModelsRefreshResult, Provider } from '@earendil-works/pi-ai';
/** Original public provider composition, shared by account and execution owners. */
export function ownSelectedProvider(runtime: ModelRuntime, provider: string, assertSource: () => void, signal?: AbortSignal, onDispatch?: (model: Model<Api>) => void) {
    const original = runtime.getProvider(provider);
    if (!original)
        throw new Error('Unknown selected provider; choose an application catalogue entry');
    const modelsBefore = structuredClone(runtime.getModels(provider));
    const metadata = (entry: Provider) => ({ key: entry.auth.apiKey?.name, keyLogin: !!entry.auth.apiKey?.login,
        oauth: entry.auth.oauth?.name, oauthLabel: entry.auth.oauth?.loginLabel, subscription: entry.auth.oauth?.isSubscription });
    const metadataBefore = metadata(original);
    const pending = new Set<Promise<unknown>>();
    const track = <T>(task: Promise<T>): Promise<T> => {
        pending.add(task);
        void task.then(() => pending.delete(task), () => pending.delete(task));
        return task;
    };
    const drain = async () => {
        while (pending.size)
            await Promise.allSettled([...pending]);
    };
    const context: AuthContext = { env: async () => undefined, fileExists: async () => false };
    const api = original.auth.apiKey, oauth = original.auth.oauth;
    const decorated: Provider = { ...original,
        getModels: original.getModels.bind(original),
        stream: (model, context, options) => { assertSource(); onDispatch?.(model); return original.stream(model, context, options); },
        streamSimple: (model, context, options) => { assertSource(); onDispatch?.(model); return original.streamSimple(model, context, options); },
        ...(original.getAllModels ? { getAllModels: original.getAllModels.bind(original) } : {}),
        ...(original.refreshModels ? { refreshModels: (...args) => track(original.refreshModels!(...args)) } : {}),
        ...(original.filterModels ? { filterModels: original.filterModels.bind(original) } : {}),
        ...(original.filterAllModels ? { filterAllModels: original.filterAllModels.bind(original) } : {}),
        auth: {
            ...(api ? { apiKey: { ...api,
                    ...(api.login ? { login: (...args) => { assertSource(); return track(api.login!(...args)); } } : {}),
                    ...(api.check ? { check: input => { assertSource(); return track(api.check!({ ...input, ctx: context })); } } : {}),
                    resolve: input => { assertSource(); return track(api.resolve({ ...input, ctx: context })); },
                } } : {}),
            ...(oauth ? { oauth: { ...oauth,
                    login: (...args) => { assertSource(); return track(oauth.login(...args)); },
                    refresh: (...args) => { assertSource(); return track(oauth.refresh(...args)); },
                    toAuth: (...args) => { assertSource(); return track(oauth.toAuth(...args)); },
                } } : {}),
        },
    };
    const refresh = runtime.refresh.bind(runtime), registrations: Promise<ModelsRefreshResult>[] = [];
    runtime.refresh = options => {
        assertSource();
        const task = track(refresh({ ...options, providers: [provider], allowNetwork: false, ...(signal ? { signal } : {}) }));
        registrations.push(task);
        return task;
    };
    let registered = false;
    const register = async () => {
        if (registered)
            throw new Error('Selected provider already registered');
        registered = true;
        runtime.registerNativeProvider(decorated);
        await drain();
        for (const result of await Promise.all(registrations))
            if (result.aborted || result.errors.size)
                throw new Error('Selected provider registration could not settle');
        const selected = runtime.getProvider(provider);
        if (!selected || !isDeepStrictEqual(modelsBefore, runtime.getModels(provider)) || !isDeepStrictEqual(metadataBefore, metadata(selected)))
            throw new Error('Selected provider composition changed model or authentication configuration');
    };
    return { track, drain, register };
}

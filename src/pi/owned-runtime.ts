import type { AnyModel, Model, Api, StreamOptions, AssistantMessageEventStream, Context, ModelsApiStreamOptions, ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ModelRuntime, ModelRuntimeAuthOverrides } from '@earendil-works/pi-coding-agent';
/** Trusted host policy; no catalogue, auth protocol or native process implementation. */
export interface OwnedChatPolicy {
    assertModel(model: Model<Api>): void;
    assertRequest?(model: Model<Api>, options: {
        sessionId?: string;
    } | undefined): void;
    beforeAuth(target: string | AnyModel, options: ModelRuntimeAuthOverrides): void | Promise<void>;
    streamHeaders?(options: Pick<ModelsSimpleStreamOptions, 'headers' | 'transformHeaders'> | undefined): Pick<ModelsSimpleStreamOptions, 'headers' | 'transformHeaders'>;
    streamOptions?: Readonly<Pick<StreamOptions, 'transport' | 'maxRetries'>>;
}
const owned = new WeakSet<ModelRuntime>();
/** Install immediately on one fresh runtime, before registration can start refresh. */
export function ownChatRuntime(runtime: ModelRuntime, requestedPolicy: OwnedChatPolicy) {
    if (owned.has(runtime))
        throw new Error('Pi runtime already has an owner');
    owned.add(runtime);
    const policy = Object.freeze({ ...requestedPolicy, streamOptions: Object.freeze({ ...requestedPolicy.streamOptions }) });
    const controller = new AbortController(), pending = new Set<Promise<unknown>>();
    let sealed = false, closing: Promise<void> | undefined, failed = false, refreshFailure: unknown;
    let lastStopReason: string | undefined;
    const assertAdmission = () => {
        controller.signal.throwIfAborted();
        if (sealed)
            throw new Error('Owned Pi execution sealed');
    };
    const track = <T>(task: Promise<T>): Promise<T> => {
        pending.add(task);
        // Observe even fire-and-forget registration work; retain the original promise.
        void task.then(() => pending.delete(task), () => { failed = true; pending.delete(task); });
        return task;
    };
    const drain = async () => {
        while (pending.size)
            await Promise.allSettled([...pending]);
    };
    const seal = () => { sealed = true; };
    const join = async () => {
        await drain();
        if (refreshFailure || runtime.getError())
            throw new Error('Owned Pi registration refresh unavailable', { cause: refreshFailure });
    };
    const close = () => closing ??= (async () => { seal(); controller.abort(); await drain(); })();
    const joinIdle = async () => {
        if (!sealed)
            throw new Error('Seal owned Pi execution before idle join');
        await join();
        if (failed || lastStopReason !== 'stop')
            throw new Error('Owned Pi idle settlement unavailable: successful original terminal stop required');
    };
    const getAuth = runtime.getAuth.bind(runtime), checkAuth = runtime.checkAuth.bind(runtime);
    const streamSimple = runtime.streamSimple.bind(runtime), stream = runtime.stream.bind(runtime), refresh = runtime.refresh.bind(runtime);
    runtime.getAuth = (target, options = {}) => track((async () => {
        assertAdmission();
        options.signal?.throwIfAborted();
        await policy.beforeAuth(target, options);
        assertAdmission();
        options.signal?.throwIfAborted();
        const { signal, ...request } = options;
        // Do not abort-race an original OAuth rotation/persistence tail.
        const result = await (typeof target === 'string' ? getAuth(target, request) : getAuth(target, request));
        assertAdmission();
        signal?.throwIfAborted();
        return result;
    })());
    runtime.checkAuth = (provider, options = {}) => track((async () => {
        assertAdmission();
        options.signal?.throwIfAborted();
        await policy.beforeAuth(provider, options);
        assertAdmission();
        options.signal?.throwIfAborted();
        const { signal, ...request } = options;
        const result = await checkAuth(provider, request);
        assertAdmission();
        signal?.throwIfAborted();
        return result;
    })());
    const ownStream = (original: AssistantMessageEventStream) => {
        track(original.result().then(message => { lastStopReason = message.stopReason; return message; }));
        return original;
    };
    runtime.streamSimple = (model, context, options) => {
        assertAdmission();
        options?.signal?.throwIfAborted();
        policy.assertModel(model);
        policy.assertRequest?.(model, options);
        const headers = policy.streamHeaders?.(options);
        const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        return ownStream(streamSimple(model, context, { ...options, ...headers, ...policy.streamOptions, signal }));
    };
    runtime.stream = <TApi extends Api>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>) => {
        assertAdmission();
        options?.signal?.throwIfAborted();
        policy.assertModel(model);
        policy.assertRequest?.(model, options);
        const headers = policy.streamHeaders?.(options);
        const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        const request = Object.assign({}, options, headers, policy.streamOptions, { signal });
        return ownStream(stream(model, context, request));
    };
    runtime.refresh = (options = {}) => track((async () => {
        assertAdmission();
        options.signal?.throwIfAborted();
        const { signal, ...request } = options;
        try {
            const result = await refresh({ ...request, allowNetwork: false });
            if (result.aborted || result.errors.size || runtime.getError()) {
                refreshFailure ??= new Error('Original Pi refresh returned an unsuccessful outcome');
                failed = true;
            }
            signal?.throwIfAborted();
            return result;
        }
        catch (error) {
            refreshFailure ??= error;
            throw error;
        }
    })());
    // This is a finite chat profile. These independent async paths have no owned
    // consumer here; exposing them as if close could join them would be misleading.
    const unsupported = () => { throw new Error('Operation is unavailable in the owned Pi chat profile'); };
    runtime.streamDeferred = unsupported;
    runtime.fetchDeferred = unsupported;
    runtime.cancelDeferred = unsupported;
    runtime.generateImages = unsupported;
    runtime.classify = unsupported;
    runtime.resolveModel = unsupported;
    runtime.login = unsupported;
    runtime.logout = unsupported;
    runtime.setRuntimeApiKey = unsupported;
    runtime.removeRuntimeApiKey = unsupported;
    runtime.getAvailable = unsupported;
    runtime.getAllAvailable = unsupported;
    runtime.getAvailableOfType = unsupported;
    return { runtime, seal, assertAdmission, join, joinIdle, close };
}

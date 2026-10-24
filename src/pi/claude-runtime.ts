import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ownChatRuntime } from './owned-runtime.js';
/** Bridge identity policy only; native process and auxiliary ownership stay in the adapter. */
export async function createOwnedClaudeRuntime(selection: Readonly<{
    provider: string;
    modelId: string;
}>) {
    selection = Object.freeze({ provider: selection.provider, modelId: selection.modelId });
    if (selection.provider !== 'claude-bridge' || !selection.modelId)
        throw new Error('Exact bridge model required');
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
        allowModelNetwork: false, refreshOnCreate: false });
    let ownerId: string | undefined;
    const assertModel = (model: {
        provider: string;
        id: string;
    }) => {
        if (model.provider !== selection.provider || model.id !== selection.modelId)
            throw new Error('Bridge runtime cannot select another provider/model');
    };
    const owner = ownChatRuntime(runtime, {
        assertModel,
        beforeAuth: (target, options) => {
            if ((typeof target === 'string' ? target : target.provider) !== 'claude-bridge' || options.apiKey !== undefined || options.env !== undefined)
                throw new Error('Bridge runtime cannot select another provider credential');
            if (typeof target !== 'string')
                assertModel(target);
        },
        assertRequest: (_model, options) => {
            if (!ownerId || options?.sessionId !== ownerId)
                throw new Error('Bridge request requires the actual selected Pi owner; unknown auxiliary ownership is unavailable');
        },
    });
    let closing: Promise<void> | undefined;
    return { ...owner,
        close: () => closing ??= (async () => { await owner.close(); await owner.join(); })(),
        bindOwner(id: string) {
            owner.assertAdmission();
            if (!id || (ownerId && ownerId !== id))
                throw new Error('Bridge runtime owner cannot be retargeted');
            ownerId = id;
        },
    };
}

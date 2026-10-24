import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, InMemoryModelsStore, type Api, type Model, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import { directory, readObject } from '../app/settings.js';
import { admitCredentials, admitModelConfiguration, configuredCredentialType } from '../app/model-config.js';
import { ownChatRuntime } from './owned-runtime.js';
import { ownSelectedProvider } from './selected-provider.js';
import { selectedHeaders } from './native-provider.js';
import { sourceEpoch } from '../app/source-generations.js';
import { sdkMetadataHeaders } from './sdk-metadata.js';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface ManagedModelSource {
    home: string;
    /** Private control-state integrity only, excluded from model/run evidence. */
    configDigest: string;
    modelDigest: string;
    authEpoch: number;
    credentialType: 'api_key' | 'oauth' | 'configured';
    thinkingLevel: ModelThinkingLevel;
    evidence: Record<string, unknown>;
}
function snapshot(home: string, provider: string) {
    directory(home, true);
    const folder = join(home, 'config');
    directory(folder, true);
    let configDigest = '';
    const config = readObject(join(folder, 'models.json'), true, bytes => { configDigest = createHash('sha256').update(bytes).digest('hex'); });
    const credentials = readObject(join(folder, 'auth.json'), true);
    admitModelConfiguration(config);
    admitCredentials(credentials);
    const credential = credentials[provider], credentialType = configuredCredentialType(config, credentials, provider);
    if (!credentialType)
        throw new Error('Selected application account is missing; use /login or configure an explicit literal source');
    return { configDigest, credential, credentialType, authEpoch: sourceEpoch(folder, provider) };
}
export function managedModelEvidence(model: Model<Api>, thinking: ModelThinkingLevel, authEpoch: number): Record<string, unknown> {
    const endpoint = new URL(model.baseUrl);
    return { source: 'gitjig', authEpoch, provider: model.provider, modelId: model.id, api: model.api,
        endpoint: endpoint.origin + endpoint.pathname, thinkingLevel: thinking,
        capabilities: { reasoning: model.reasoning, input: model.input, contextWindow: model.contextWindow, maxTokens: model.maxTokens } };
}
async function catalogue(home: string) {
    const runtime = await ModelRuntime.create({ authPath: join(home, 'config/auth.json'), modelsPath: join(home, 'config/models.json'),
        modelsStore: new InMemoryModelsStore(), refreshOnCreate: false, allowModelNetwork: false });
    if (runtime.getError())
        throw new Error('Application model configuration is invalid; repair config/models.json');
    return runtime;
}
/** Capture one original catalogue model and source before asynchronous admission. */
export async function resolveManagedModel(home: string, provider: string, modelId: string, thinking: ModelThinkingLevel = 'off'): Promise<ManagedModelSource> {
    const before = snapshot(home, provider), runtime = await catalogue(home), model = runtime.getModel(provider, modelId);
    if (!model)
        throw new Error('Selected model is unavailable; choose an application catalogue model');
    if (!isDeepStrictEqual(before, snapshot(home, provider)))
        throw new Error('Application account/configuration changed during model resolution; retry');
    const level = clampThinkingLevel(model, thinking);
    return Object.freeze({ home, configDigest: before.configDigest, modelDigest: digest(model), authEpoch: before.authEpoch,
        credentialType: before.credentialType, thinkingLevel: level, evidence: managedModelEvidence(model, level, before.authEpoch) });
}
/** Fresh owned original Pi chat execution; no provider/model roster or protocol fork. */
export async function createOwnedManagedProvider(provider: string, modelId: string, source: ManagedModelSource, onDispatch?: (evidence: Record<string, unknown>) => void) {
    const initial = snapshot(source.home, provider);
    const assertSource = () => {
        const current = snapshot(source.home, provider);
        if (current.configDigest !== source.configDigest || current.authEpoch !== source.authEpoch || current.credentialType !== source.credentialType ||
            (source.credentialType === 'api_key' && !isDeepStrictEqual(current.credential, initial.credential)))
            throw new Error('Selected application source changed; resolve a fresh eligible execution');
    };
    assertSource();
    const runtime = await catalogue(source.home);
    assertSource();
    const selected = runtime.getModel(provider, modelId);
    if (!selected || digest(selected) !== source.modelDigest)
        throw new Error('Selected model configuration changed; resolve a fresh eligible execution');
    const selectedOwner = ownSelectedProvider(runtime, provider, assertSource, undefined, model => onDispatch?.(managedModelEvidence(model, source.thinkingLevel, source.authEpoch)));
    const originalAuth = runtime.getAuth.bind(runtime);
    const owner = ownChatRuntime(runtime, {
        assertModel(model) {
            if (model.provider !== provider || model.id !== modelId || digest(model) !== source.modelDigest)
                throw new Error('Managed execution cannot select another model or endpoint');
        },
        streamHeaders: options => selectedHeaders(options, sdkMetadataHeaders), streamOptions: { maxRetries: 0 },
        async beforeAuth(target, options) {
            assertSource();
            if ((typeof target === 'string' ? target : target.provider) !== provider || options.env !== undefined)
                throw new Error('Managed execution cannot select another account or ambient environment');
            if (options.apiKey !== undefined) {
                // Original summaries may forward original resolved request auth,
                // including an OAuth provider's transformed key/base URL.
                const actual = await selectedOwner.track(originalAuth(selected));
                if (!actual || options.apiKey !== actual.auth.apiKey)
                    throw new Error('Managed execution cannot substitute request credentials');
            }
        },
    });
    const close = async () => { await Promise.all([owner.close(), selectedOwner.drain()]); };
    try {
        await selectedOwner.register();
        await owner.join();
        assertSource();
        const auth = await runtime.getAuth(selected);
        if (!auth)
            throw new Error('Selected application account is not configured; use /login');
        const actualModel = auth.auth.baseUrl ? { ...selected, baseUrl: auth.auth.baseUrl } : selected;
        return { ...owner, close, selected, evidence: managedModelEvidence(actualModel, source.thinkingLevel, source.authEpoch) };
    }
    catch (error) {
        await close();
        throw error;
    }
}

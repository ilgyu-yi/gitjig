import type { PiModelSelection } from './session.js';
import { directProviderCapability, directProtocolPolicy } from './provider-capabilities.js';
import { captureSessionPreferences } from './session-preferences.js';
/** Capture the plain native selector before a controller's asynchronous admission. */
export function captureNativeModelSelection(model: PiModelSelection): PiModelSelection {
    const preferences = captureSessionPreferences(model.sessionPreferences);
    if (preferences) {
        const descriptors = Object.getOwnPropertyDescriptors(model);
        descriptors.sessionPreferences = { value: preferences, enumerable: true, writable: false, configurable: false };
        model = Object.create(Object.getPrototypeOf(model), descriptors) as PiModelSelection;
    }
    if (model.managed)
        return Object.freeze({ ...model, managed: Object.freeze(structuredClone(model.managed)) });
    if (!model.native)
        return model;
    const native = structuredClone(model.native);
    return Object.freeze({ ...model, native: Object.freeze({ ...native, projectRoots: Object.freeze([...native.projectRoots]) }) });
}
/** Configuration identity only. Actual launch/run identity is independently allocated. */
export function modelConfigurationIdentity(model: PiModelSelection) {
    return {
        provider: model.provider, modelId: model.modelId,
        ...(model.sessionPreferences ? { sessionPreferences: captureSessionPreferences(model.sessionPreferences) } : {}),
        // Full private config/model integrity hashes do not enter run evidence.
        ...(model.managed ? { managed: model.managed.evidence, thinkingLevel: model.managed.thinkingLevel } : {}),
        ...(model.bridgeProfile ? { bridgeProfile: model.bridgeProfile } : {}),
        ...(model.bridge ? model.bridgeThinkingLevel === undefined ? { thinkingLevelSource: 'original-sdk-default' } : { thinkingLevel: model.bridgeThinkingLevel } : {}),
        native: model.native ? {
            kind: model.native.kind, authPath: model.native.authPath, projectRoots: model.native.projectRoots,
            ...(model.native.kind === 'pi-stored' ? {
                credentialType: model.native.credentialType,
                capability: storedCapabilityIdentity(model.provider, model.native.credentialType),
            } : {}),
        } : null,
        definition: model.definition ? Object.fromEntries(Object.entries(model.definition).filter(([key]) => !['apiKey', 'headers'].includes(key))) : null,
    };
}
function storedCapabilityIdentity(provider: string, credentialType: string) {
    const capability = directProviderCapability(provider, credentialType);
    return { ...capability, protocols: capability.apis.map(api => ({ api, request: directProtocolPolicy(provider, credentialType, api) })) };
}

import type { ConfigurationTarget, ConfigurationProfile, ConfigurationPlan, ConfigurationStep, ConfigurationAttempt, ConfigurationReconciliation, ConfigurationPreviewInput, RetainedConfigurationStep, PreparedConfigurationStep } from './github-configuration-types.js';
import { validateConfigurationTarget } from './github-configuration.js';
import { parseConfigurationProfile } from './github-configuration-profile.js';
import { validateProviderConfigurationTarget, parseProviderConfigurationProfile, type ProviderConfigurationTarget, type ProviderConfigurationProfile } from './repository-configuration-profile.js';
export type RepositoryTarget = ConfigurationTarget | ProviderConfigurationTarget;
export type RepositoryProfile = ConfigurationProfile | ProviderConfigurationProfile;
export type RepositoryActivation = ConfigurationPlan['activation'] | 'explicit-owner-native/v1';
export type RepositoryStep = Omit<ConfigurationStep, 'kind'> & {
    kind: ConfigurationStep['kind'] | 'patch-native-repository' | 'patch-native-protection' | 'create-native-protection';
    resourceId?: number;
};
export type RepositoryPlan = Omit<ConfigurationPlan, 'target' | 'profile' | 'steps' | 'activation'> & {
    target: RepositoryTarget;
    profile: RepositoryProfile;
    steps: readonly RepositoryStep[];
    activation: RepositoryActivation;
};
export type RepositoryPreview = Omit<ConfigurationPreviewInput, 'target' | 'desired'> & {
    target: RepositoryTarget;
    desired: RepositoryProfile;
};
export interface NativeProtectionResource {
    provider: 'gitea' | 'gitlab';
    apiBase: string;
    repositoryId: number;
    name: string;
    id?: number;
}
export type RepositoryAttempt = ConfigurationAttempt & {
    nativeResource?: NativeProtectionResource;
};
export type RepositoryReconciliation = ConfigurationReconciliation & {
    nativeResource?: NativeProtectionResource;
};
export type RepositoryRetained = Omit<RetainedConfigurationStep, 'plan'> & {
    plan: RepositoryPlan;
    nativeResource?: NativeProtectionResource;
};
export interface ConfigurationSession {
    readonly credentialSessionId: string;
    readonly activation: RepositoryActivation;
    previewConfiguration(input: RepositoryPreview, signal?: AbortSignal): Promise<RepositoryPlan>;
    observeConfigurationAccount(target: RepositoryTarget, signal?: AbortSignal): Promise<{
        credentialSessionId: string;
        native: {
            state: string;
        };
    }>;
    observeConfigurationGuidance(input: {
        target: RepositoryTarget;
        branch: string;
    }, signal?: AbortSignal): Promise<unknown>;
    prepareConfigurationStep(input: RepositoryRetained & {
        revisionId: string;
    }, signal?: AbortSignal): Promise<PreparedConfigurationStep>;
    inspectPreparedConfigurationPayload(handle: PreparedConfigurationStep): {
        jsonUtf8: Uint8Array;
        sha256: string;
    };
    invokePreparedConfigurationStep(handle: PreparedConfigurationStep): Promise<RepositoryAttempt>;
    reconcileConfigurationStep(input: RepositoryRetained, signal?: AbortSignal): Promise<RepositoryReconciliation>;
}
export function nativeConfigurationTarget(target: RepositoryTarget): target is ProviderConfigurationTarget { return Object.hasOwn(target, 'provider'); }
export function validateRepositoryConfigurationTarget(input: unknown): RepositoryTarget {
    if (input && typeof input === 'object' && Object.hasOwn(input, 'provider'))
        return validateProviderConfigurationTarget(input);
    validateConfigurationTarget(input as ConfigurationTarget);
    return structuredClone(input) as ConfigurationTarget;
}
export function parseRepositoryConfigurationProfile(input: unknown): RepositoryProfile {
    if (input && typeof input === 'object' && Object.hasOwn(input, 'provider'))
        return parseProviderConfigurationProfile(input);
    return parseConfigurationProfile(input);
}
/** Exact legacy adapter; no optional/fabricated native node identities. */
export function legacyConfigurationSession(session: Pick<ReturnType<typeof import('./github-configuration.js').openGitHubConfigurationReader>, 'credentialSessionId' | 'activation' | 'previewConfiguration' | 'observeConfigurationAccount' | 'observeConfigurationGuidance' | 'prepareConfigurationStep' | 'inspectPreparedConfigurationPayload' | 'invokePreparedConfigurationStep' | 'reconcileConfigurationStep'>): ConfigurationSession {
    const target = (value: RepositoryTarget): ConfigurationTarget => {
        if (nativeConfigurationTarget(value))
            throw Error('GitHub configuration session cannot consume a native provider target');
        validateConfigurationTarget(value);
        return value;
    };
    const plan = (value: RepositoryPlan): ConfigurationPlan => {
        target(value.target);
        if (value.activation === 'explicit-owner-native/v1' || value.steps.some(s => s.kind.endsWith('native-protection') || s.kind === 'patch-native-repository'))
            throw Error('Legacy configuration plan family differs');
        return value as ConfigurationPlan;
    };
    return { credentialSessionId: session.credentialSessionId, activation: session.activation,
        previewConfiguration: (input, signal) => session.previewConfiguration({ ...input, target: target(input.target), desired: parseConfigurationProfile(input.desired) }, signal),
        observeConfigurationAccount: (input, signal) => session.observeConfigurationAccount(target(input), signal),
        observeConfigurationGuidance: (input, signal) => session.observeConfigurationGuidance({ ...input, target: target(input.target) }, signal),
        prepareConfigurationStep: (input, signal) => session.prepareConfigurationStep({ ...input, plan: plan(input.plan) }, signal ?? AbortSignal.timeout(30000)),
        inspectPreparedConfigurationPayload: handle => session.inspectPreparedConfigurationPayload(handle), invokePreparedConfigurationStep: handle => session.invokePreparedConfigurationStep(handle),
        reconcileConfigurationStep: (input, signal) => session.reconcileConfigurationStep({ ...input, plan: plan(input.plan) }, signal) };
}

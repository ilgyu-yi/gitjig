import type { QualificationSetup } from './qualification-types.js';
/** Opaque runtime membership shared by product consumers. Qualification execution lives outside dist. */
import type { NativeGitClient } from '../effects/native-git.js';
import type { NativeGitProfile } from '../effects/types.js';
import type { PublicationTarget } from './github-publication.js';
import type { NativeConfigurationTransport, ReadLimits } from './github-transport.js';
import type { PublicationSession, OwnedNativeHttpsProfile } from './github-publication-session.js';
import type { createContextConfigurationClient } from './github-configuration.js';
import type { createNativePolicyObserver } from './github-policy.js';
/** Identity is held privately; copying its JSON cannot instantiate a context. */
export interface CreatedAcceptanceContext {
    readonly kind: 'local-exact-created-acceptance/v1';
    readonly credentialSessionId: string;
    readonly target: Readonly<PublicationTarget>;
}
export interface AcceptanceResources {
    start: NativeConfigurationTransport;
    limits: ReadLimits;
    assertTarget(target: PublicationTarget | {
        repositoryId: number;
        repositoryNodeId: string;
        owner: string;
        repository: string;
    }): void;
    live(): void;
    assertBranch(branch: string): void;
    joined(): CreatedAcceptanceSession;
    assertNativeCapture(capture: object): void;
}
const contexts = new WeakMap<object, AcceptanceResources>();
const sessions = new WeakMap<object, CreatedAcceptanceSession>();
/** Existing native operations only; no raw command, local receiver or initializer. */
export type AcceptanceGitClient = Pick<NativeGitClient, 'root' | 'objectFormat' | 'gitBinary' | 'project' | 'buildIntegration' | 'materializeVerifiedTree' | 'observeHttpsRef' | 'fetchHttpsBasis' | 'fetchHttpsPinnedBasis' | 'prepareHttpsForwardSend' | 'spawnPreparedHttpsForwardSend' | 'reconcileHttpsForward' | 'close'>;
export type CreatedAcceptanceSession = Omit<PublicationSession, 'activation'> & {
    readonly activation: 'created-private-local-acceptance';
    readonly target: Readonly<PublicationTarget>;
    configuration: ReturnType<typeof createContextConfigurationClient>;
    observeTargetPolicy: ReturnType<typeof createNativePolicyObserver>['observeTargetPolicy'];
    openNativeGit(profile: NativeGitProfile, signal?: AbortSignal): Promise<AcceptanceGitClient>;
};
/** Sole internal Controller join: actual runtime context, never supplied clients/receipts. */
export function createdAcceptanceSession(context: CreatedAcceptanceContext): CreatedAcceptanceSession {
    const resources = acceptanceContextResources(context);
    let joined = sessions.get(context);
    if (!joined) {
        joined = resources.joined();
        sessions.set(context, joined);
    }
    return joined;
}
/** Internal finite-client constructor join. No token, receipt setter or callback is returned. */
export function acceptanceContextResources(input: CreatedAcceptanceContext): AcceptanceResources {
    const result = contexts.get(input);
    if (!result)
        throw Error('Actual created private acceptance context required');
    result.live();
    return result;
}
export interface HostedAcceptanceOptions {
    token: string;
    journalRoot: string;
    git: {
        gitBinary: string;
        execPath: string;
    };
}
export interface OwnedAcceptanceOptions {
    origin: string;
    token: string;
    journalRoot: string;
    lifetimeMs?: number;
    ownedHttps?: OwnedNativeHttpsProfile;
}
/** These factories are internal qualification entries, absent from public Controller/CLI options.
 * The fixed sidecar is optional and never shipped. No caller can select code or register a context. */
async function setupModule() {
    const location = new URL('../../.qualification/github-acceptance-setup.js', import.meta.url).href;
    return import(location) as Promise<{
        openHostedAcceptanceSetup(options: HostedAcceptanceOptions, register: (context: CreatedAcceptanceContext, resources: AcceptanceResources) => void): Promise<QualificationSetup>;
        createOwnedFixedAcceptanceSetup(options: OwnedAcceptanceOptions & {
            ownedHttps: OwnedNativeHttpsProfile;
        }, register: (context: CreatedAcceptanceContext, resources: AcceptanceResources) => void): Promise<QualificationSetup>;
        createOwnedAcceptanceSetup(options: OwnedAcceptanceOptions, register: (context: CreatedAcceptanceContext, resources: AcceptanceResources) => void): Promise<QualificationSetup>;
    }>;
}
const registerContext = (context: CreatedAcceptanceContext, resources: AcceptanceResources): void => {
    if (contexts.has(context))
        throw Error('Acceptance context already registered');
    contexts.set(context, resources);
};
export async function openHostedAcceptanceSetup(options: HostedAcceptanceOptions) {
    const captured = structuredClone(options);
    return (await setupModule()).openHostedAcceptanceSetup(captured, registerContext);
}
export async function createOwnedFixedAcceptanceSetup(options: OwnedAcceptanceOptions & {
    ownedHttps: OwnedNativeHttpsProfile;
}) {
    const captured = structuredClone(options);
    return (await setupModule()).createOwnedFixedAcceptanceSetup(captured, registerContext);
}
export async function createOwnedAcceptanceSetup(options: OwnedAcceptanceOptions) {
    const captured = structuredClone(options);
    return (await setupModule()).createOwnedAcceptanceSetup(captured, registerContext);
}

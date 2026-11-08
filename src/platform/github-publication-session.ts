import { createOwnedHttpsGitFixture, type NativeGitClient } from '../effects/native-git.js';
import type { NativeGitProfile } from '../effects/types.js';
import { randomUUID } from 'node:crypto';
import { openGitHubCapabilityReader, createOwnedCapabilityFixture, openGitHubPublicOwnerCapabilityReader, createOwnedPublicOwnerCapabilityReader } from './github-capability.js';
import { createOwnedPublicationFixture, openGitHubPublication, createOwnedPublicOwnerPublicationClient } from './github-publication.js';
import type { ReadLimits } from './github-transport.js';
type CapabilityReader = ReturnType<typeof openGitHubCapabilityReader>;
type Publisher = ReturnType<typeof createOwnedPublicationFixture>;
export interface PublicationSession {
    readonly credentialSessionId: string;
    readonly activation: 'disabled' | 'owned-fixture-only' | 'created-private-local-acceptance' | 'public-personal-owner/v1';
    observePublicationCapability: CapabilityReader['observePublicationCapability'];
    preparePublication: Publisher['preparePublication'];
    inspectPreparedPayload: Publisher['inspectPreparedPayload'];
    invokePreparedPublication: Publisher['invokePreparedPublication'];
    reconcilePublication: Publisher['reconcilePublication'];
}
function session(reader: Pick<CapabilityReader, 'observePublicationCapability'>, publisher: Pick<Publisher, 'preparePublication' | 'inspectPreparedPayload' | 'invokePreparedPublication' | 'reconcilePublication'>, activation: PublicationSession['activation']): PublicationSession {
    return Object.freeze({ credentialSessionId: randomUUID(), activation,
        observePublicationCapability: reader.observePublicationCapability.bind(reader),
        preparePublication: publisher.preparePublication.bind(publisher), inspectPreparedPayload: publisher.inspectPreparedPayload.bind(publisher),
        invokePreparedPublication: publisher.invokePreparedPublication.bind(publisher), reconcilePublication: publisher.reconcilePublication.bind(publisher) });
}
/** Captures one credential once. Production publication remains physically disabled. */
export function openPublicationSession(options: {
    token: string;
    limits?: Partial<ReadLimits>;
}): PublicationSession {
    const token = options.token, limits = options.limits ? { ...options.limits } : undefined;
    const captured = { token, ...(limits ? { limits } : {}) };
    return session(openGitHubPublicOwnerCapabilityReader(captured), openGitHubPublication(captured), 'public-personal-owner/v1');
}
/** Internal owned HTTP acceptance only; no production/model enabled flag or URL slot. */
export function createOwnedPublicationSession(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}): OwnedPublicationSession {
    const token = options.token, origin = options.origin, limits = options.limits ? { ...options.limits } : undefined;
    const captured = { origin, token, ...(limits ? { limits } : {}) };
    const base = session(createOwnedCapabilityFixture(captured), createOwnedPublicationFixture(captured), 'owned-fixture-only');
    return Object.freeze({ ...base, openOwnedNativeHttps: (profile: NativeGitProfile, https: OwnedNativeHttpsProfile, signal?: AbortSignal) => createOwnedHttpsGitFixture(profile, { ...structuredClone(https), token, credentialSessionId: base.credentialSessionId }, signal) });
}
export interface OwnedNativeHttpsProfile {
    origin: string;
    caFile: string;
    execPath: string;
}
export interface OwnedPublicationSession extends PublicationSession {
    openOwnedNativeHttps(profile: NativeGitProfile, https: OwnedNativeHttpsProfile, signal?: AbortSignal): Promise<NativeGitClient>;
}
/** Internal exact normal-profile HTTP counterpart; absent from public CLI options. */
export function createOwnedPublicOwnerPublicationSession(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}): PublicationSession {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
        throw Error('Owned public-owner fixture required');
    const observer = createOwnedPublicOwnerCapabilityReader(options);
    return session(observer, createOwnedPublicOwnerPublicationClient(options), 'public-personal-owner/v1');
}

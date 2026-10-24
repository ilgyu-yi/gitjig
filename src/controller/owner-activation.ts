import type { Store } from './store.js';
import type { EffectDelegationConfig } from './effect-types.js';
import type { PublicationDelegationConfig } from './publication-types.js';
import type { MergeDelegationConfig } from './merge-types.js';
import { ControllerError } from './types.js';
import { hash } from './change-files.js';
export interface OwnerRootProfile {
    version: 1;
    integrations: readonly EffectDelegationConfig[];
    publications: readonly PublicationDelegationConfig[];
    merges?: readonly MergeDelegationConfig[];
}
export interface OwnerRootActivation {
    version: 1;
    state: 'PENDING' | 'COMPLETE';
    profile: OwnerRootProfile;
    fingerprint: string;
}
export function ownerRootProfile(integrations: readonly EffectDelegationConfig[], publications: readonly PublicationDelegationConfig[], merges: readonly MergeDelegationConfig[] = []): OwnerRootProfile {
    if (integrations.length > 100 || publications.length > 100 || merges.length > 100)
        throw Error('Owner activation requires finite delegation profiles');
    return { version: 1,
        integrations: integrations.map(item => ({ projectId: item.projectId, targetId: item.targetId, operationLimit: item.operationLimit })).sort((a, b) => a.targetId.localeCompare(b.targetId)),
        publications: publications.map(item => ({ targetId: item.targetId, operationLimit: item.operationLimit, actions: [...item.actions].sort(),
            ...(item.projectIds ? { projectIds: [...item.projectIds].sort((a, b) => String(a).localeCompare(String(b))) } : {}) })).sort((a, b) => a.targetId.localeCompare(b.targetId)),
        ...(merges.length ? { merges: merges.map(item => ({ projectId: item.projectId, targetId: item.targetId, operationLimit: item.operationLimit, notifications: item.notifications })).sort((a, b) => a.targetId.localeCompare(b.targetId)) } : {}),
    };
}
export function pendingOwnerRoot(profile: OwnerRootProfile): OwnerRootActivation {
    return { version: 1, state: 'PENDING', profile: structuredClone(profile), fingerprint: hash(profile) };
}
export function ownerRootActivation(data: Record<string, unknown>): OwnerRootActivation | undefined {
    if (!Object.hasOwn(data, 'ownerRootActivation'))
        return undefined;
    const value = data.ownerRootActivation as OwnerRootActivation | null;
    if (!value || value.version !== 1 || !['PENDING', 'COMPLETE'].includes(value.state) || !value.profile || value.profile.version !== 1 ||
        !Array.isArray(value.profile.integrations) || !Array.isArray(value.profile.publications) || value.profile.integrations.length > 100 || value.profile.publications.length > 100 ||
        Object.hasOwn(value.profile, 'merges') && (!Array.isArray(value.profile.merges) || value.profile.merges.length > 100) ||
        typeof value.fingerprint !== 'string' || hash(value.profile) !== value.fingerprint)
        throw Error('Original owner activation record is invalid; restore its retained record before execution');
    return value;
}
export function assertOwnerRootActivated(store: Store, workId: string): void {
    const row = store.one('SELECT data FROM works WHERE id=?', workId);
    if (row && ownerRootActivation(JSON.parse(row.data))?.state === 'PENDING')
        throw new ControllerError('OWNER_ACTIVATION_REQUIRED', 'Original owner delegation activation is incomplete', 'Inspect this work and explicitly activate its captured profile before execution; do not create replacement work', workId);
}

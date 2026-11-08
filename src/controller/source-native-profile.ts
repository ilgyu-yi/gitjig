import type { EffectsProfile } from './effect-types.js';

export interface SourceNativeProfileControls { profile?: EffectsProfile }

/** Capture at the outer synchronous action boundary, before any task is queued. */
export function captureSourceNativeProfile(controls: SourceNativeProfileControls): SourceNativeProfileControls {
    if (!Object.hasOwn(controls, 'profile')) return Object.freeze({});
    const profile = structuredClone(controls.profile);
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
        Object.keys(profile).some(key => !['gitBinary', 'commandTimeoutMs', 'maxOutputBytes'].includes(key)) ||
        typeof profile.gitBinary !== 'string') throw Error('Explicit source Native profile requires a closed trusted Git recipe');
    return Object.freeze({ profile: Object.freeze(profile) });
}

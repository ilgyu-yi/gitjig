import type { NativeIdentity } from './interaction-types.js';

const fields = ['conversationId', 'workId', 'runId', 'launchId', 'generation', 'directionRevision', 'initialInputId'] as const;

/** Compare captured identity fields; callers validate their own provenance shape. */
export function sameNativeIdentity(a: Partial<NativeIdentity> | null | undefined, b: Partial<NativeIdentity> | null | undefined): boolean {
    return !!a && !!b && fields.every(key => a[key] === b[key]);
}

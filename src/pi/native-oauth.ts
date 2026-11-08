import type { NativeOAuthProfile } from './native-profile.js';
import { createOwnedPiProvider } from './native-provider.js';
/** Existing exact subscription profile remains a compatibility shorthand. */
export function createOwnedNativeOAuth(profile: NativeOAuthProfile, roots: readonly string[]) {
    return createOwnedPiProvider('openai-codex', 'gpt-6.1-sol', profile, roots);
}

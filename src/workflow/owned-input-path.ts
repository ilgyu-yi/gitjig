import path from 'node:path';

/** Positive projection using the native-schema regex subset: reject leading
 * separators and NUL. Drive-root and parent-segment checks remain authoritative
 * below; this pattern is guidance, not the complete ownership predicate. */
export const ownedInputPathSchemaPattern = path.sep === '\\'
    ? String.raw`^[^\\/\u0000][^\u0000]*$`
    : String.raw`^[^/\u0000][^\u0000]*$`;
/** Preserve existing platform/filename semantics without normalization.
 * Text bounds, list uniqueness, source identity and authority remain separate. */
export const isOwnedRelativeInputPath = (value: string): boolean =>
    !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..') && !value.includes('\0');

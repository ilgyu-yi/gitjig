import { lstat, realpath } from 'node:fs/promises';
import { uiText, type UiLocale } from './i18n.js';
import { quoteText } from './inspection-text.js';

export const projectSourceUnavailableCode = 'PROJECT_SOURCE_UNAVAILABLE';

export type ProjectSourceIdentity = { dev: bigint; ino: bigint };

export class ProjectSourceError extends Error {
    readonly code = projectSourceUnavailableCode;
    constructor(source: string, locale: UiLocale, readonly reason: 'unavailable' | 'replaced') {
        super(uiText(locale, reason === 'replaced' ? 'project.sourceReplaced' : 'project.sourceUnavailable', { source: quoteText(source) }));
    }
}

/** Check only the registered directory. File content belongs to the later capture. */
export async function readProjectSource(source: string, locale: UiLocale, expected?: ProjectSourceIdentity) {
    const identity = await lstat(source, { bigint: true }).catch(() => undefined);
    if (!identity?.isDirectory() || await realpath(source).catch(() => undefined) !== source)
        throw new ProjectSourceError(source, locale, 'unavailable');
    if (expected && (identity.dev !== expected.dev || identity.ino !== expected.ino))
        throw new ProjectSourceError(source, locale, 'replaced');
    return identity;
}

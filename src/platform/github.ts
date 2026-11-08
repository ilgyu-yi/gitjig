import { GitHubReadClient } from './github-read-client.js';
import { nativeJsonTransport, type ReadLimits } from './github-transport.js';
import { fixedClassicTransport } from './github-classic.js';
export type { ReadResponse, ReadLimits } from './github-transport.js';
export type { CompleteCollection } from './github-read-client.js';
export interface GitHubReadOptions {
    token: string;
    limits?: Partial<ReadLimits>;
}
/** Fixed GitHub.com read-only route set. These observations grant no write capability. */
export function openGitHubReadClient(options: GitHubReadOptions): GitHubReadClient {
    const limits: ReadLimits = {
        requestTimeoutMs: 10000, responseBytes: 1024 * 1024, pages: 100,
        collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...options.limits,
    };
    const maxima: ReadLimits = { requestTimeoutMs: 120000, responseBytes: 16 * 1024 * 1024,
        pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    if (Object.keys(limits).some(key => !Object.hasOwn(maxima, key)))
        throw Error('Unsupported GitHub read limit');
    for (const key of Object.keys(maxima) as (keyof ReadLimits)[]) {
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maxima[key])
            throw Error('GitHub read limits must be finite supported positive integers');
    }
    const start = nativeJsonTransport(options.token, limits);
    return new GitHubReadClient('https://api.github.com', (url, signal) => start(url, { method: 'GET' }, signal).response, limits, fixedClassicTransport('https://api.github.com', start));
}

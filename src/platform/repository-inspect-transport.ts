import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { parseUniqueJson } from '../workflow/json.js';
import type { ReadLimits } from './github-transport.js';
export type RepositoryProvider = 'gitea' | 'gitlab';
export interface RepositoryReadOptions {
    provider: RepositoryProvider;
    apiBase: string;
    token: string;
    limits?: Partial<ReadLimits>;
}
export interface RepositoryResponse {
    status: number;
    data: unknown;
    bodyHash: string;
    bodyBytes: number;
    link: string | null;
    nextPage: string | null;
    page: string | null;
    total: string | null;
    totalPages: string | null;
}
export class RepositoryReadError extends Error {
}
const fail = (message: string) => new RepositoryReadError(message);
export function repositoryApiBase(provider: RepositoryProvider, value: string, fixture = false): URL {
    if (!['gitea', 'gitlab'].includes(provider) || typeof value !== 'string' || value.length > 2048 || /[\s\\%?#]/u.test(value))
        throw fail('Select a supported provider and canonical API base without escapes, query or fragment');
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw fail('Select a canonical absolute HTTPS API base');
    }
    const suffix = provider === 'gitea' ? '/api/v1' : '/api/v4';
    const pathname = url.pathname.replace(/\/$/u, '');
    if (url.username || url.password || url.search || url.hash || url.href !== value || !pathname.endsWith(suffix) || pathname.split('/').some(p => p === '.' || p === '..') || !/^\/(?:[A-Za-z0-9_.~-]+\/)*api\/v[14]$/u.test(pathname) ||
        !(url.protocol === 'https:' || fixture && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
        throw fail('API base requires canonical HTTPS, the provider API suffix and an optional literal installation prefix');
    url.pathname = pathname;
    return url;
}
export function repositoryReadLimits(input?: Partial<ReadLimits>): ReadLimits {
    const limits = { requestTimeoutMs: 5000, responseBytes: 1024 * 1024, pages: 100, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...input };
    const max = { requestTimeoutMs: 30000, responseBytes: 16 * 1024 * 1024, pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    if (Object.keys(limits).some(k => !Object.hasOwn(max, k)))
        throw fail('Unsupported repository read limit');
    for (const key of Object.keys(max) as (keyof ReadLimits)[])
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max[key])
            throw fail('Repository inspection requires finite supported positive limits');
    return limits;
}
/** Provider-native headers and fixed base. No ambient credentials, redirects, retries or proxy helpers. */
function nativeRepositoryTransport(options: RepositoryReadOptions, fixture: boolean, configuration: boolean) {
    const { provider, token } = options, base = repositoryApiBase(provider, options.apiBase, fixture), limits = repositoryReadLimits(options.limits);
    if (typeof token !== 'string' || !token || token.length > 8192 || /[^\x21-\x7e]/u.test(token))
        throw fail('An explicit access token without header controls is required');
    const start = (url: URL, method: 'GET' | 'PATCH' | 'PUT' | 'POST', body: Uint8Array | undefined, signal: AbortSignal, charge: (bytes: number) => void) => {
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + '/') || url.username || url.password || url.hash)
            throw fail('Repository request changed the selected API base');
        if (!['GET', 'PATCH', 'PUT', 'POST'].includes(method) || method !== 'GET' && !configuration || method === 'GET' && body !== undefined || body && body.byteLength > 64 * 1024)
            throw fail('Unsupported native configuration request');
        let handed = false;
        const pending = new Promise<RepositoryResponse>((resolve, reject) => {
            if (signal.aborted) {
                reject(fail('Repository inspection cancelled'));
                return;
            }
            let request: http.ClientRequest | undefined, timer: ReturnType<typeof setTimeout> | undefined, finished = false;
            const finish = (error?: Error, response?: RepositoryResponse) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                if (error) {
                    request?.destroy();
                    reject(error);
                }
                else
                    resolve(response!);
            };
            const abort = () => finish(fail('Repository inspection cancelled'));
            try {
                request = (url.protocol === 'https:' ? https : http).request(url, { method, agent: false, ...(url.protocol === 'https:' ? { rejectUnauthorized: true } : {}), headers: { Accept: 'application/json', 'User-Agent': 'gitjig', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) } : {}), ...(provider === 'gitea' ? { Authorization: 'token ' + token } : { 'PRIVATE-TOKEN': token }) } }, response => {
                    let size = 0;
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => {
                        if (finished)
                            return;
                        size += chunk.length;
                        try {
                            charge(chunk.length);
                        }
                        catch (error) {
                            finish(error instanceof Error ? error : fail('Repository byte accounting unavailable'));
                            return;
                        }
                        if (size > limits.responseBytes)
                            finish(fail('Repository response exceeds its byte limit'));
                        else
                            chunks.push(chunk);
                    });
                    response.on('aborted', () => finish(fail('Repository response interrupted')));
                    response.on('error', () => finish(fail('Repository response unavailable')));
                    response.on('end', () => {
                        if (finished)
                            return;
                        const bytes = Buffer.concat(chunks), status = response.statusCode ?? 0;
                        // Do not return raw error bodies or redirect locations; they can contain credentials/private text.
                        if (!response.complete) {
                            finish(fail('Repository response incomplete'));
                            return;
                        }
                        const header = (key: string) => {
                            const value = response.headers[key];
                            if (value !== undefined && typeof value !== 'string')
                                throw fail('Ambiguous repository response headers');
                            return value ?? null;
                        };
                        try {
                            const encoding = header('content-encoding');
                            if (encoding !== null && encoding !== 'identity')
                                throw fail('Unsupported repository response encoding');
                            let data: unknown = null;
                            if (status === 200 || configuration && method === 'POST' && status === 201) {
                                if (!/^application\/json(?:\s*;|$)/iu.test(header('content-type') ?? '') || !isUtf8(bytes))
                                    throw fail('Repository response requires UTF-8 JSON');
                                try {
                                    data = parseUniqueJson(bytes.toString('utf8'));
                                }
                                catch {
                                    throw fail('Repository response contains invalid or ambiguous JSON');
                                }
                            }
                            finish(undefined, { status, data, bodyHash: createHash('sha256').update(bytes).digest('hex'), bodyBytes: bytes.length, link: header('link'), nextPage: header('x-next-page'), page: header('x-page'), total: header(provider === 'gitea' ? 'x-total-count' : 'x-total'), totalPages: header('x-total-pages') });
                        }
                        catch (error) {
                            finish(error instanceof RepositoryReadError ? error : fail('Repository response unavailable'));
                        }
                    });
                });
            }
            catch {
                finish(fail('Repository transport unavailable'));
                return;
            }
            timer = setTimeout(() => finish(fail('Repository request deadline exceeded')), limits.requestTimeoutMs);
            signal.addEventListener('abort', abort, { once: true });
            request.on('error', () => finish(fail('Repository transport unavailable')));
            handed = true;
            if (signal.aborted)
                abort();
            else
                request.end(body);
        });
        return { handoff: handed ? 'request-created' as const : 'not-started' as const, response: pending };
    };
    const get = (url: URL, signal: AbortSignal, charge: (bytes: number) => void) => start(url, 'GET', undefined, signal, charge).response;
    return { base, provider, limits, get, start };
}
/** GET-only public observer; it exposes no mutation start. */
export function repositoryReadTransport(options: RepositoryReadOptions, fixture = false) { const { start: _start, ...reader } = nativeRepositoryTransport(options, fixture, false); return reader; }
/** Internal finite configuration adapter owns every method/path/payload. Not a project tool. */
export function repositoryConfigurationTransport(options: RepositoryReadOptions, fixture = false) { return nativeRepositoryTransport(options, fixture, true); }

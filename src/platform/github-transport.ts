import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { parseUniqueJson } from '../workflow/json.js';
export interface ReadLimits {
    requestTimeoutMs: number;
    responseBytes: number;
    pages: number;
    collectionBytes: number;
    collectionItems: number;
}
export interface ReadResponse {
    status: number;
    data: unknown;
    bodyHash: string;
    bodyBytes: number;
    requestId: string | null;
    link: string | null;
    visibility: Readonly<Record<string, string>>;
}
export type ReadTransport = (url: URL, signal?: AbortSignal) => Promise<ReadResponse>;
export interface NativeJsonStart {
    handoff: 'not-started' | 'request-created';
    response: Promise<ReadResponse>;
}
export type NativeConfigurationTransport = (url: URL, request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    body?: Uint8Array;
}, signal?: AbortSignal) => NativeJsonStart;
export type NativeJsonTransport = (url: URL, request: {
    method: 'GET' | 'POST';
    body?: Uint8Array;
}, signal?: AbortSignal) => NativeJsonStart;
export type NativeMergeTransport = (url: URL, request: {
    method: 'GET' | 'POST' | 'PUT';
    body?: Uint8Array;
}, signal?: AbortSignal) => NativeJsonStart;
/** Internal transport seam. The public factory fixes the HTTPS origin. */
export function nativeReadTransport(token: string, limits: ReadLimits): ReadTransport {
    const start = nativeJsonTransport(token, limits);
    return (url, signal) => start(url, { method: 'GET' }, signal).response;
}
/** Internal only: finite clients own the URL/method/body; no custom headers or retries. */
export function nativeJsonTransport(token: string, limits: ReadLimits): NativeJsonTransport {
    return nativeFixedJsonTransport(token, limits, ['GET', 'POST']);
}
/** Internal finite configuration client only; existing read/publication transport stays GET/POST. */
export function nativeConfigurationTransport(token: string, limits: ReadLimits): NativeConfigurationTransport {
    return nativeFixedJsonTransport(token, limits, ['GET', 'POST', 'PUT', 'PATCH']);
}
/** Internal finite merge client only; public publication routes retain their GET/POST boundary. */
export function nativeMergeTransport(token: string, limits: ReadLimits): NativeMergeTransport {
    return nativeFixedJsonTransport(token, limits, ['GET', 'POST', 'PUT']);
}
function nativeFixedJsonTransport(token: string, limits: ReadLimits, allowed: readonly string[]): NativeConfigurationTransport {
    if (!token || token.length > 8192 || /[^\x21-\x7e]/.test(token))
        throw Error('An explicit credential without header controls is required');
    const timeoutMs = limits.requestTimeoutMs, byteLimit = limits.responseBytes;
    return (inputUrl, input, signal) => {
        const url = new URL(inputUrl.href);
        if (!['https:', 'http:'].includes(url.protocol) || !allowed.includes(input.method) ||
            (input.method === 'GET' && input.body !== undefined))
            throw Error('Unsupported internal GitHub request');
        const body = input.body === undefined ? undefined : Buffer.from(input.body);
        if (body && body.length > 132 * 1024)
            throw Error('GitHub request exceeds supported byte limit');
        let handed = false;
        const pending = new Promise<ReadResponse>((resolve, reject) => {
            if (signal?.aborted) {
                reject(Error('GitHub read cancelled'));
                return;
            }
            let finished = false;
            let request: http.ClientRequest | undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (error?: Error, result?: ReadResponse) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error) {
                    request?.destroy();
                    reject(error);
                }
                else
                    resolve(result!);
            };
            try {
                request = (url.protocol === 'https:' ? https : http).request(url, {
                    method: input.method, agent: false,
                    ...(url.protocol === 'https:' ? { rejectUnauthorized: true } : {}),
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2026-03-10',
                        'User-Agent': 'gitjig-next-private',
                        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {}),
                    },
                }, response => {
                    const chunks: Buffer[] = [];
                    let size = 0;
                    response.on('data', (chunk: Buffer) => {
                        if (finished)
                            return;
                        size += chunk.length;
                        if (size > byteLimit)
                            finish(Error('GitHub read response exceeds supported byte limit'));
                        else
                            chunks.push(chunk);
                    });
                    response.on('aborted', () => finish(Error('GitHub read response interrupted')));
                    response.on('error', () => finish(Error('GitHub read response unavailable')));
                    response.on('end', () => {
                        if (finished)
                            return;
                        if (!response.complete) {
                            finish(Error('GitHub read response incomplete'));
                            return;
                        }
                        const bytes = Buffer.concat(chunks);
                        const encoding = response.headers['content-encoding'];
                        if (encoding !== undefined && encoding !== 'identity') {
                            finish(Error('GitHub read returned unsupported content encoding'));
                            return;
                        }
                        const media = response.headers['content-type'];
                        if (typeof media !== 'string' || !/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(media)) {
                            finish(Error('GitHub read returned unsupported content type'));
                            return;
                        }
                        if (!isUtf8(bytes)) {
                            finish(Error('GitHub read returned invalid UTF-8'));
                            return;
                        }
                        let data: unknown;
                        try {
                            data = parseUniqueJson(bytes.toString('utf8'));
                        }
                        catch {
                            finish(Error('GitHub read returned invalid or ambiguous JSON'));
                            return;
                        }
                        const visibility: Record<string, string> = {};
                        for (const key of ['x-oauth-scopes', 'x-accepted-oauth-scopes', 'x-accepted-github-permissions']) {
                            const value = response.headers[key];
                            if (typeof value === 'string')
                                visibility[key] = value;
                        }
                        finish(undefined, {
                            status: response.statusCode ?? 0, data, bodyHash: createHash('sha256').update(bytes).digest('hex'),
                            bodyBytes: bytes.length, requestId: typeof response.headers['x-github-request-id'] === 'string' ? response.headers['x-github-request-id'] : null,
                            link: typeof response.headers.link === 'string' ? response.headers.link : null, visibility,
                        });
                    });
                });
            }
            catch {
                reject(Error('GitHub read transport unavailable before request creation'));
                return;
            }
            handed = true;
            const abort = () => finish(Error('GitHub read cancelled'));
            timer = setTimeout(() => finish(Error('GitHub read deadline exceeded')), timeoutMs);
            signal?.addEventListener('abort', abort, { once: true });
            request.on('error', () => finish(Error('GitHub read transport unavailable')));
            try {
                request.end(body);
            }
            catch {
                finish(Error('GitHub read transport unavailable after request creation'));
            }
        });
        return { handoff: handed ? 'request-created' : 'not-started', response: pending };
    };
}

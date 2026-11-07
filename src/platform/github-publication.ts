import { createNativePublicOwnerCapabilityObserver } from './github-capability.js';
import { createHash } from 'node:crypto';
import { nextGitHubPage } from './github-read-client.js';
import { nativeJsonTransport, type NativeJsonTransport, type ReadLimits, type ReadResponse } from './github-transport.js';
import { acceptanceContextResources, type CreatedAcceptanceContext } from './hosted-context.js';
export type PublicationAction = {
    kind: 'create-issue';
    title: string;
    body: string;
} | {
    kind: 'create-draft-pr';
    title: string;
    body: string;
    headRef: string;
    headCommit: string;
    baseRef: string;
} | {
    kind: 'create-comment';
    parent: {
        kind: 'issue' | 'pull-request';
        number: number;
        nodeId: string;
    };
    body: string;
    purpose: 'bootstrap' | 'reviewed-summary' | 'contribution-summary';
};
export interface PublicationTarget {
    host: 'github.com';
    repositoryId: number;
    repositoryNodeId: string;
    owner: string;
    repository: string;
    actorUserId: number;
}
export interface CarrierPolicy {
    version: string;
    allowedMentions: readonly string[];
    knownPrivateLiterals: readonly string[];
    maxTitleBytes: number;
    maxBodyBytes: number;
}
export interface PublicationInput {
    operationId: string;
    target: PublicationTarget;
    action: PublicationAction;
    carrierPolicy: CarrierPolicy;
}
export interface SealedPublicationPayload {
    payloadUtf8: Uint8Array;
    payloadHash: string;
    payloadBytes: number;
    targetDigest: string;
    policyVersion: string;
}
export interface PreparedPublication {
    readonly operationId: string;
    readonly actionKind: PublicationAction['kind'];
    readonly targetDigest: string;
    readonly payloadHash: string;
    readonly payloadBytes: number;
    readonly policyVersion: string;
}
export interface PublicationResource {
    id: number;
    nodeId: string;
    number?: number;
    parentNumber?: number;
    url: string;
}
export interface PublicationResponseReceipt {
    route: string;
    status: number;
    requestId: string | null;
    bodyHash: string;
    bodyBytes: number;
    data: unknown;
}
export interface PublicationAttempt {
    operationId: string;
    handoff: 'not-started' | 'request-created';
    outcome: 'confirmed' | 'refused' | 'unknown';
    request: {
        method: 'POST';
        route: string;
        payloadHash: string;
        payloadBytes: number;
        invokedAt: string;
    } | null;
    payloadHash: string;
    resource: PublicationResource | null;
    receipts: readonly PublicationResponseReceipt[];
    reason: string;
    creationHint: PublicationResource | null;
}
export interface RetainedPublicationOperation {
    input: PublicationInput;
    payloadUtf8: Uint8Array;
    payloadHash: string;
    creationHint?: PublicationResource;
}
export interface PublicationReconciliation {
    operationId: string;
    outcome: 'confirmed' | 'unknown';
    complete: boolean;
    exactMatches: number | null;
    resource: PublicationResource | null;
    receipts: readonly PublicationResponseReceipt[];
    reason: string;
}
interface Saved {
    input: PublicationInput;
    bytes: Buffer;
    body: string;
    route: string;
    signal: AbortSignal;
    preflight: PublicationResponseReceipt[];
    used: boolean;
}
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Publication identity object unavailable');
    return value as Record<string, unknown>;
};
const id = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
        throw Error('Publication numeric identity unavailable');
    return value as number;
};
const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value)
        throw Error('Publication text identity unavailable');
    return value;
};
const segment = (value: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value) || value === '.' || value === '..')
        throw Error('Unsupported publication repository segment');
    return encodeURIComponent(value);
};
function ref(value: string): string {
    if (!value || value.length > 1024 || /[\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.startsWith('/') || value.endsWith('/') || value.includes('..') || value.includes('@{') || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.')))
        throw Error('Unsupported publication branch ref');
    return value;
}
const repositoryPath = (t: PublicationTarget) => `/repos/${segment(t.owner)}/${segment(t.repository)}`;
const markerPrefix = '<!-- gitjig-operation:';
/** Validate registration operands without inventing action content or a send permit. */
export function validatePublicationTargetPolicy(t: PublicationTarget, p: CarrierPolicy): void {
    if (t.host !== 'github.com')
        throw Error('Publication host unsupported');
    id(t.repositoryId);
    id(t.actorUserId);
    text(t.repositoryNodeId);
    repositoryPath(t);
    if (!p.version || !Array.isArray(p.allowedMentions) || !Array.isArray(p.knownPrivateLiterals) || p.knownPrivateLiterals.some(s => typeof s !== 'string' || !s) || p.allowedMentions.some(s => !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(s)))
        throw Error('Publication carrier policy unavailable');
    if (!Number.isSafeInteger(p.maxTitleBytes) || p.maxTitleBytes < 1 || p.maxTitleBytes > 1024 || !Number.isSafeInteger(p.maxBodyBytes) || p.maxBodyBytes < 1 || p.maxBodyBytes > 128 * 1024)
        throw Error('Publication carrier limits unsupported');
}
function carrier(input: PublicationInput): {
    bytes: Buffer;
    body: string;
    route: string;
} {
    const { action: a, target: t, carrierPolicy: p } = input;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId))
        throw Error('Host operation identity unsupported');
    validatePublicationTargetPolicy(t, p);
    const check = (value: string, title = false) => {
        if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value) || /[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value) || (title && /[\n\t]/.test(value)))
            throw Error('Publication carrier has unsupported controls');
        if (Buffer.byteLength(value) > (title ? p.maxTitleBytes : p.maxBodyBytes))
            throw Error('Publication carrier exceeds supported bounds');
        if (p.knownPrivateLiterals.some(literal => value.includes(literal)))
            throw Error('Publication carrier contains a configured private literal');
        const allowed = new Set(p.allowedMentions.map(s => s.toLowerCase()));
        for (const match of value.matchAll(/@([A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)?)/g)) {
            if (!allowed.has(match[1]!.toLowerCase()))
                throw Error('Publication carrier notification is not allowed');
        }
    };
    if (typeof a.body !== 'string' || a.body.includes(markerPrefix))
        throw Error('Publication body/host marker unavailable');
    const body = a.body + `\n\n${markerPrefix} ${input.operationId} -->`;
    check(body);
    let payload: Record<string, unknown>, route: string;
    if (a.kind === 'create-issue') {
        check(a.title, true);
        if (!a.title)
            throw Error('Issue title required');
        payload = { title: a.title, body };
        route = repositoryPath(t) + '/issues';
    }
    else if (a.kind === 'create-draft-pr') {
        check(a.title, true);
        if (!a.title || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(a.headCommit))
            throw Error('Draft head/title unavailable');
        ref(a.headRef);
        ref(a.baseRef);
        if (a.headRef === a.baseRef)
            throw Error('Draft head/base must differ');
        payload = { title: a.title, body, head: a.headRef, base: a.baseRef, draft: true };
        route = repositoryPath(t) + '/pulls';
    }
    else if (a.kind === 'create-comment') {
        id(a.parent.number);
        text(a.parent.nodeId);
        if (!['issue', 'pull-request'].includes(a.parent.kind) || !['bootstrap', 'reviewed-summary', 'contribution-summary'].includes(a.purpose))
            throw Error('Comment scope unavailable');
        payload = { body };
        route = repositoryPath(t) + `/issues/${a.parent.number}/comments`;
    }
    else
        throw Error('Unsupported publication action');
    const bytes = Buffer.from(JSON.stringify(payload));
    if (bytes.length > 132 * 1024)
        throw Error('Publication request exceeds supported byte limit');
    return { bytes, body, route };
}
function receipt(route: string, response: ReadResponse): PublicationResponseReceipt {
    return { route, status: response.status, requestId: response.requestId, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes, data: structuredClone(response.data) };
}
/** Pure final carrier identity before owner/J authorization; never a send permit. */
export function sealPublicationPayload(input: PublicationInput): SealedPublicationPayload {
    const captured = structuredClone(input), sealed = carrier(captured);
    return { payloadUtf8: Uint8Array.from(sealed.bytes), payloadHash: digest(sealed.bytes), payloadBytes: sealed.bytes.length,
        targetDigest: digest(JSON.stringify(captured.target)), policyVersion: captured.carrierPolicy.version };
}
/** Normal fixed-canonical PUBLIC personal-owner action client; no origin/permit slot. */
export function openGitHubPublication(options?: {
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    if (!options)
        throw Error('HOSTED_PUBLICATION_DISABLED: explicit captured owner credential required');
    const limits = publicationLimits({ requestTimeoutMs: 10000, ...options.limits });
    return publicationFacade(new FinitePublisher('https://api.github.com', nativeJsonTransport(options.token, limits), limits, true));
}
/** Internal owned counterpart of the exact normal profile, never a CLI origin option. */
export function createOwnedPublicOwnerPublicationClient(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
        throw Error('Owned public-owner fixture required');
    const limits = publicationLimits(options.limits), native = nativeJsonTransport(options.token, limits);
    return publicationFacade(new FinitePublisher('https://api.github.com', (url, request, signal) => {
        if (url.origin !== 'https://api.github.com')
            throw Error('Canonical public-owner endpoint changed');
        return native(new URL(url.pathname + url.search, origin), request, signal);
    }, limits, true));
}
/** Internal exact-created local acceptance only; serialized context cannot enable this. */
export function createContextPublicationClient(context: CreatedAcceptanceContext) {
    const resources = acceptanceContextResources(context);
    const client = new FinitePublisher('https://api.github.com', resources.start, resources.limits);
    return Object.freeze({
        preparePublication(input: PublicationInput, signal: AbortSignal) {
            resources.assertTarget(input.target);
            if (input.action.kind === 'create-draft-pr') {
                resources.assertBranch(input.action.headRef);
                resources.assertBranch(input.action.baseRef);
                if (input.action.headRef !== 'fixture/head' || input.action.baseRef !== 'main')
                    throw Error('Exact acceptance draft head/base required');
            }
            return client.preparePublication(input, signal);
        },
        inspectPreparedPayload(handle: PreparedPublication) { resources.live(); return client.inspectPreparedPayload(handle); },
        invokePreparedPublication(handle: PreparedPublication) { resources.live(); return client.invokePreparedPublication(handle); },
        reconcilePublication(input: RetainedPublicationOperation, signal: AbortSignal) {
            resources.assertTarget(input.input.target);
            return client.reconcilePublication(input, signal);
        },
    });
}
/** Fixed production readback only. Mutating methods are physically unavailable. */
export function openDisabledPublicationClient(options: {
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const limits = publicationLimits({ requestTimeoutMs: 10000, ...options.limits });
    const client = new FinitePublisher('https://api.github.com', nativeJsonTransport(options.token, limits), limits);
    const disabled = (): never => { throw Error('HOSTED_PUBLICATION_DISABLED: authorized same-credential capability acceptance is unavailable'); };
    return {
        preparePublication(_input: PublicationInput, _signal: AbortSignal): Promise<PreparedPublication> { return Promise.reject(Error('HOSTED_PUBLICATION_DISABLED: authorized same-credential capability acceptance is unavailable')); },
        inspectPreparedPayload(_handle: PreparedPublication): {
            jsonUtf8: Uint8Array<ArrayBuffer>;
            sha256: string;
        } { return disabled(); },
        invokePreparedPublication(_handle: PreparedPublication): Promise<PublicationAttempt> { return disabled(); },
        reconcilePublication: client.reconcilePublication.bind(client),
    };
}
/** Internal owned HTTP consumer only, not exported through the public platform factory/CLI. */
export function createOwnedPublicationFixture(options: {
    origin: string;
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
        throw Error('Owned loopback fixture required');
    const limits = publicationLimits(options.limits);
    return new FinitePublisher(origin.origin, nativeJsonTransport(options.token, limits), limits);
}
function publicationLimits(input?: Partial<ReadLimits>): ReadLimits {
    const limits: ReadLimits = { requestTimeoutMs: 1000, responseBytes: 1024 * 1024, pages: 100, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000, ...input };
    const max: ReadLimits = { requestTimeoutMs: 120000, responseBytes: 16 * 1024 * 1024, pages: 1000, collectionBytes: 64 * 1024 * 1024, collectionItems: 100000 };
    if (Object.keys(limits).some(k => !Object.hasOwn(max, k)))
        throw Error('Unsupported publication limit');
    for (const key of Object.keys(max) as (keyof ReadLimits)[])
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max[key])
            throw Error('Finite publication limits required');
    return limits;
}
class FinitePublisher {
    readonly #publicOwner: boolean;
    private readonly prepared = new WeakMap<PreparedPublication, Saved>();
    constructor(private readonly origin: string, private readonly start: NativeJsonTransport, private readonly limits: ReadLimits, publicOwner = false) { this.#publicOwner = publicOwner; }
    private async get(route: string, receipts: PublicationResponseReceipt[], signal: AbortSignal): Promise<unknown> {
        const result = await this.start(new URL(route, this.origin), { method: 'GET' }, signal).response;
        receipts.push(receipt(route, result));
        if (result.status !== 200)
            throw Error('Publication identity/readback unavailable');
        return result.data;
    }
    private validateRepo(value: unknown, t: PublicationTarget) {
        const r = object(value);
        if (r.id !== t.repositoryId || r.node_id !== t.repositoryNodeId || r.full_name !== `${t.owner}/${t.repository}`)
            throw Error('Publication repository changed');
    }
    private async preflight(input: PublicationInput, receipts: PublicationResponseReceipt[], signal: AbortSignal, requireWriteProfile = true) {
        const t = input.target, a = input.action, repo = repositoryPath(t);
        if (this.#publicOwner && requireWriteProfile) {
            const observer = createNativePublicOwnerCapabilityObserver(async (url, abort) => {
                const result = await this.start(url, { method: 'GET' }, abort).response;
                receipts.push(receipt(url.pathname + url.search, result));
                return result;
            }, this.limits.requestTimeoutMs);
            const observation = await observer.observePublicationCapability({ expectedUserId: t.actorUserId, target: { ...t, visibility: 'public' }, action: a.kind }, signal);
            if (observation.state !== 'matched')
                throw Error('Normal public-owner publication unavailable: ' + observation.conditions.join('; '));
        }
        const user = object(await this.get('/user', receipts, signal));
        if (user.id !== t.actorUserId)
            throw Error('Publication credential actor changed');
        await this.refreshTarget(input, receipts, signal, requireWriteProfile);
        if (a.kind === 'create-draft-pr') {
            const head = object(await this.get(repo + '/git/ref/heads/' + encodeURIComponent(a.headRef), receipts, signal));
            const base = object(await this.get(repo + '/git/ref/heads/' + encodeURIComponent(a.baseRef), receipts, signal));
            if (head.ref !== 'refs/heads/' + a.headRef || object(head.object).sha !== a.headCommit || object(head.object).type !== 'commit' || base.ref !== 'refs/heads/' + a.baseRef || object(base.object).type !== 'commit' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(text(object(base.object).sha)))
                throw Error('Draft publication head/base unavailable');
        }
    }
    private async refreshTarget(input: PublicationInput, receipts: PublicationResponseReceipt[], signal: AbortSignal, requireWriteProfile = true) {
        const t = input.target, a = input.action, repo = repositoryPath(t);
        const current = object(await this.get(repo, receipts, signal));
        this.validateRepo(current, t);
        if (this.#publicOwner && requireWriteProfile && (current.visibility !== 'public' || current.private !== false || current.fork !== false || object(current.owner).type !== 'User' || object(current.owner).id !== t.actorUserId || object(current.owner).login !== t.owner || object(current.permissions).admin !== true || current.archived !== false || current.disabled !== false))
            throw Error('Normal PUBLIC personal nonfork repository profile changed');
        if (a.kind === 'create-comment') {
            const parent = object(await this.get(repo + `/${a.parent.kind === 'issue' ? 'issues' : 'pulls'}/${a.parent.number}`, receipts, signal));
            if (parent.number !== a.parent.number || parent.node_id !== a.parent.nodeId)
                throw Error('Publication comment parent changed');
            if (a.parent.kind === 'issue') {
                if (parent.repository_url !== `https://api.github.com${repo}` || parent.pull_request !== undefined)
                    throw Error('Publication comment issue parent changed');
            }
            else {
                this.validateRepo(object(parent.base).repo, t);
                if (parent.url !== `https://api.github.com${repo}/pulls/${a.parent.number}`)
                    throw Error('Publication comment PR parent changed');
                // A comment on a PR from a fork is legitimate: only base repo is the target.
            }
        }
    }
    async preparePublication(input: PublicationInput, signal: AbortSignal): Promise<PreparedPublication> {
        const captured = structuredClone(input), sealed = carrier(captured), preflight: PublicationResponseReceipt[] = [];
        await this.preflight(captured, preflight, AbortSignal.any([signal, AbortSignal.timeout(this.limits.requestTimeoutMs)]));
        if (signal.aborted)
            throw Error('Publication preparation cancelled');
        const handle: PreparedPublication = Object.freeze({ operationId: captured.operationId, actionKind: captured.action.kind, targetDigest: digest(JSON.stringify(captured.target)), payloadHash: digest(sealed.bytes), payloadBytes: sealed.bytes.length, policyVersion: captured.carrierPolicy.version });
        this.prepared.set(handle, { input: captured, ...sealed, signal, preflight, used: false });
        return handle;
    }
    inspectPreparedPayload(handle: PreparedPublication) {
        const saved = this.prepared.get(handle);
        if (!saved)
            throw Error('Foreign publication handle');
        return { jsonUtf8: Uint8Array.from(saved.bytes), sha256: handle.payloadHash };
    }
    invokePreparedPublication(handle: PreparedPublication): Promise<PublicationAttempt> {
        const saved = this.prepared.get(handle);
        if (!saved || saved.used)
            throw Error('Foreign or consumed publication handle');
        saved.used = true;
        const receipts = [...saved.preflight];
        const base = { operationId: saved.input.operationId, payloadHash: handle.payloadHash, resource: null, receipts, request: null as PublicationAttempt['request'], creationHint: null as PublicationResource | null };
        if (saved.signal.aborted)
            return Promise.resolve({ ...base, handoff: 'not-started', outcome: 'refused', reason: 'Cancelled before native invocation' });
        // No await or caller hook between handle consumption and the native request/end.
        const dispatchSignal = AbortSignal.any([saved.signal, AbortSignal.timeout(this.limits.requestTimeoutMs)]);
        const started = this.start(new URL(saved.route, this.origin), { method: 'POST', body: saved.bytes }, dispatchSignal);
        if (started.handoff === 'request-created')
            base.request = { method: 'POST', route: saved.route, payloadHash: handle.payloadHash, payloadBytes: saved.bytes.length, invokedAt: new Date().toISOString() };
        return (async () => {
            try {
                const result = await started.response;
                receipts.push(receipt(saved.route, result));
                if (result.status !== 201)
                    return { ...base, handoff: started.handoff, outcome: 'unknown', reason: 'Unsupported creation response; no numeric status proves absence' } as PublicationAttempt;
                const created = this.validateResource(result.data, saved.input, saved.body);
                base.creationHint = created;
                const detail = await this.get(this.detailRoute(saved.input, created), receipts, dispatchSignal);
                const readback = this.validateResource(detail, saved.input, saved.body);
                if (created.id !== readback.id || created.nodeId !== readback.nodeId)
                    throw Error('Created resource changed on readback');
                await this.refreshTarget(saved.input, receipts, dispatchSignal);
                return { ...base, handoff: started.handoff, outcome: 'confirmed', resource: readback, reason: 'Exact201 and typed resource readback observed' } as PublicationAttempt;
            }
            catch {
                return { ...base, handoff: started.handoff, outcome: 'unknown', reason: 'Publication response/readback incomplete or identity unavailable' } as PublicationAttempt;
            }
        })();
    }
    private detailRoute(input: PublicationInput, resource: PublicationResource) {
        const a = input.action, repo = repositoryPath(input.target);
        return a.kind === 'create-comment' ? repo + '/issues/comments/' + resource.id : repo + (a.kind === 'create-issue' ? '/issues/' : '/pulls/') + resource.number;
    }
    private validateHint(input: PublicationInput, value: PublicationResource): PublicationResource {
        const resource = object(value), a = input.action, t = input.target;
        const resourceId = id(resource.id), nodeId = text(resource.nodeId);
        if (a.kind === 'create-comment') {
            if (resource.parentNumber !== a.parent.number || resource.number !== undefined || resource.url !== `https://github.com/${t.owner}/${t.repository}/${a.parent.kind === 'issue' ? 'issues' : 'pull'}/${a.parent.number}#issuecomment-${resourceId}`)
                throw Error('Retained creation hint parent/target unavailable');
            return { id: resourceId, nodeId, parentNumber: a.parent.number, url: resource.url };
        }
        const number = id(resource.number);
        if (resource.parentNumber !== undefined || resource.url !== `https://github.com/${t.owner}/${t.repository}/${a.kind === 'create-issue' ? 'issues' : 'pull'}/${number}`)
            throw Error('Retained creation hint target unavailable');
        return { id: resourceId, nodeId, number, url: resource.url };
    }
    private validateResource(value: unknown, input: PublicationInput, body: string): PublicationResource {
        const r = object(value), t = input.target, a = input.action, repo = repositoryPath(t);
        const resourceId = id(r.id), nodeId = text(r.node_id);
        if (object(r.user).id !== t.actorUserId || r.body !== body)
            throw Error('Publication author/payload changed');
        if (a.kind === 'create-comment') {
            if (r.issue_url !== `https://api.github.com${repo}/issues/${a.parent.number}` || r.url !== `https://api.github.com${repo}/issues/comments/${resourceId}` || r.html_url !== `https://github.com/${t.owner}/${t.repository}/${a.parent.kind === 'issue' ? 'issues' : 'pull'}/${a.parent.number}#issuecomment-${resourceId}`)
                throw Error('Publication comment identity changed');
            return { id: resourceId, nodeId, parentNumber: a.parent.number, url: r.html_url };
        }
        const number = id(r.number), api = `https://api.github.com${repo}/${a.kind === 'create-issue' ? 'issues' : 'pulls'}/${number}`;
        if (r.title !== a.title || r.url !== api || r.html_url !== `https://github.com/${t.owner}/${t.repository}/${a.kind === 'create-issue' ? 'issues' : 'pull'}/${number}`)
            throw Error('Publication resource target changed');
        if (a.kind === 'create-issue') {
            if (r.pull_request !== undefined || r.repository_url !== `https://api.github.com${repo}`)
                throw Error('Publication issue kind/repository changed');
        }
        else {
            const head = object(r.head), base = object(r.base);
            this.validateRepo(head.repo, t);
            this.validateRepo(base.repo, t);
            if (r.draft !== true || head.ref !== a.headRef || head.sha !== a.headCommit || base.ref !== a.baseRef)
                throw Error('Draft head/base/draft identity changed');
        }
        return { id: resourceId, nodeId, number, url: r.html_url as string };
    }
    async reconcilePublication(retained: RetainedPublicationOperation, signal: AbortSignal): Promise<PublicationReconciliation> {
        const captured = structuredClone(retained), input = captured.input, operationId = input.operationId, receipts: PublicationResponseReceipt[] = [];
        signal = AbortSignal.any([signal, AbortSignal.timeout(this.limits.requestTimeoutMs)]);
        let complete = false;
        try {
            const sealed = carrier(input);
            if (digest(sealed.bytes) !== captured.payloadHash || !sealed.bytes.equals(Buffer.from(captured.payloadUtf8)))
                throw Error('Retained publication bytes changed');
            await this.preflight(input, receipts, signal, false);
            if (captured.creationHint !== undefined) {
                const hint = this.validateHint(input, captured.creationHint);
                const actual = this.validateResource(await this.get(this.detailRoute(input, hint), receipts, signal), input, sealed.body);
                if (actual.id !== hint.id || actual.nodeId !== hint.nodeId)
                    throw Error('Retained creation hint resource identity changed');
                await this.refreshTarget(input, receipts, signal, false);
                return { operationId, outcome: 'confirmed', complete: true, exactMatches: 1, resource: actual, receipts, reason: 'Validated native201 hint and exact full resource readback; collection not required' };
            }
            const a = input.action, repo = repositoryPath(input.target);
            const route = a.kind === 'create-comment' ? repo + `/issues/${a.parent.number}/comments?per_page=100&page=1` : repo + (a.kind === 'create-issue' ? '/issues' : '/pulls') + '?state=all&per_page=100&page=1';
            const initial = new URL(route, this.origin);
            let current: URL | null = initial, bytes = 0, items = 0, pages = 0;
            const candidates: unknown[] = [], ids = new Set<number>();
            while (current) {
                if (++pages > this.limits.pages)
                    throw Error('Publication lookup page limit');
                const r = await this.start(current, { method: 'GET' }, signal).response;
                receipts.push(receipt(current.pathname + current.search, r));
                if (r.status !== 200 || !Array.isArray(r.data))
                    throw Error('Publication lookup unavailable');
                bytes += r.bodyBytes;
                items += r.data.length;
                if (bytes > this.limits.collectionBytes || items > this.limits.collectionItems)
                    throw Error('Publication lookup size limit');
                for (const value of r.data) {
                    const entry = object(value), entryId = id(entry.id);
                    if (ids.has(entryId))
                        throw Error('Publication lookup changed during pagination');
                    ids.add(entryId);
                    if (entry.body !== null && typeof entry.body !== 'string')
                        throw Error('Publication lookup body unavailable');
                    if (a.kind === 'create-issue' && entry.pull_request !== undefined)
                        continue;
                    if (typeof entry.body === 'string' && entry.body.includes(`${markerPrefix} ${operationId} -->`))
                        candidates.push(value);
                }
                current = nextGitHubPage(r.link, current, initial);
            }
            complete = true;
            if (candidates.length > 2)
                return { operationId, outcome: 'unknown', complete, exactMatches: null, resource: null, receipts, reason: 'Multiple marker candidates; no unbounded detail scan or retry' };
            const matches: PublicationResource[] = [];
            let conflict = false;
            for (const candidate of candidates) {
                try {
                    const listed = this.validateResource(candidate, input, sealed.body);
                    const actual = this.validateResource(await this.get(this.detailRoute(input, listed), receipts, signal), input, sealed.body);
                    if (actual.id !== listed.id || actual.nodeId !== listed.nodeId)
                        throw Error('Publication lookup resource drift');
                    matches.push(actual);
                }
                catch {
                    conflict = true;
                }
            }
            if (conflict)
                return { operationId, outcome: 'unknown', complete, exactMatches: matches.length, resource: null, receipts, reason: 'Conflicting marker or detail/identity unavailable' };
            if (matches.length === 1) {
                await this.refreshTarget(input, receipts, signal, false);
                return { operationId, outcome: 'confirmed', complete, exactMatches: 1, resource: matches[0]!, receipts, reason: 'One exact resource in complete bounded lookup; no exclusive sender causality claim' };
            }
            return { operationId, outcome: 'unknown', complete, exactMatches: matches.length, resource: null, receipts, reason: 'Zero/multiple matches cannot authorize retry' };
        }
        catch {
            return { operationId, outcome: 'unknown', complete: false, exactMatches: null, resource: null, receipts, reason: 'Retained identity or complete targeted lookup unavailable' };
        }
    }
}
/** Normal clients expose only finite bound methods, never internal native transport. */
function publicationFacade(client: FinitePublisher) {
    return Object.freeze({
        preparePublication: client.preparePublication.bind(client),
        inspectPreparedPayload: client.inspectPreparedPayload.bind(client),
        invokePreparedPublication: client.invokePreparedPublication.bind(client),
        reconcilePublication: client.reconcilePublication.bind(client),
    });
}

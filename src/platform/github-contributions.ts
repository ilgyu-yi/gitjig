import { nativeReadTransport, type ReadResponse } from './github-transport.js';
import { nextGitHubPage } from './github-read-client.js';
export interface ContributionRepository {
    owner: string;
    repository: string;
    repositoryId: number;
    repositoryNodeId: string;
}
export interface ContributionResource {
    repository: ContributionRepository;
    kind: 'issue' | 'pull-request';
    number: number;
}
export interface ContributionReadOptions {
    token: string;
}
export interface ContributionFacet {
    kind: 'intent' | 'verification' | 'review' | 'acceptance';
    data: unknown;
}
export interface ContributionBundle {
    identity: {
        id: number;
        nodeId: string;
    };
    merged: boolean;
    mergeSha: string | null;
    facets: ContributionFacet[];
    missing: string[];
    receipts: {
        route: string;
        status: number;
        bodyHash: string;
    }[];
}
const obj = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw Error('Native contribution object missing');
    return v as Record<string, any>;
};
const positive = (v: unknown): number => {
    if (!Number.isSafeInteger(v) || (v as number) < 1)
        throw Error('Native contribution identity missing');
    return v as number;
};
const str = (v: unknown): string => {
    if (typeof v !== 'string' || !v || v.length > 1024)
        throw Error('Native contribution identity missing');
    return v;
};
const sha = (v: unknown): string => {
    const s = str(v);
    if (!/^[a-f0-9]{40}$/.test(s))
        throw Error('Native contribution SHA unsupported');
    return s;
};
function nativeTime(v: unknown): string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().replace('.000Z', 'Z') !== v)
        throw Error('Native timestamp missing/malformed; ordering unavailable');
    return v;
}
function optionalTime(v: unknown): string | null { return v === null || v === undefined ? null : nativeTime(v); }
const enumeration = (v: unknown, allowed: readonly string[]) => {
    const value = str(v);
    if (!allowed.includes(value))
        throw Error('Unsupported native contribution enum');
    return value;
};
function checkState(r: Record<string, any>) {
    const status = enumeration(r.status, ['queued', 'in_progress', 'requested', 'waiting', 'pending', 'completed']);
    if (r.conclusion === null && status !== 'completed')
        return { status, conclusion: null };
    const conclusion = enumeration(r.conclusion, ['action_required', 'cancelled', 'timed_out', 'failure', 'neutral', 'skipped', 'stale', 'startup_failure', 'success']);
    if (status !== 'completed' && conclusion !== 'stale')
        throw Error('Native check state/conclusion combination unsupported');
    return { status, conclusion };
}
export function validateContributionResource(input: ContributionResource) {
    for (const s of [input.repository.owner, input.repository.repository])
        if (typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(s) || s === '.' || s === '..')
            throw Error('Contribution repository segment unsupported');
    positive(input.repository.repositoryId);
    str(input.repository.repositoryNodeId);
    positive(input.number);
    if (!['issue', 'pull-request'].includes(input.kind))
        throw Error('Contribution resource kind unsupported');
}
/** Fixed native reader. It observes records, never grants write/agent standing. */
export interface ContributionReader {
    observe(request: ContributionResource, signal?: AbortSignal): Promise<ContributionBundle>;
}
class NativeContributionReader implements ContributionReader {
    #read: ReturnType<typeof nativeReadTransport>;
    constructor(private origin: string, options: ContributionReadOptions) {
        this.#read = nativeReadTransport(options.token, { requestTimeoutMs: 5000, responseBytes: 1024 * 1024, pages: 10, collectionBytes: 8 * 1024 * 1024, collectionItems: 10000 });
    }
    async observe(request: ContributionResource, signal?: AbortSignal): Promise<ContributionBundle> {
        const input = structuredClone(request);
        validateContributionResource(input);
        const root = `/repos/${encodeURIComponent(input.repository.owner)}/${encodeURIComponent(input.repository.repository)}`;
        const receipts: ContributionBundle['receipts'] = [];
        let bytes = 0, requests = 0;
        const deadline = AbortSignal.timeout(15000), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
        const get = async (route: string): Promise<ReadResponse> => {
            if (++requests > 16 || combined.aborted)
                throw Error('Contribution observation request/deadline budget exhausted');
            const r = await this.#read(new URL(route, this.origin), combined);
            bytes += r.bodyBytes;
            receipts.push({ route, status: r.status, bodyHash: r.bodyHash });
            if (bytes > 2 * 1024 * 1024)
                throw Error('Contribution observation byte budget exhausted');
            if (r.status !== 200)
                throw Error(`Contribution read unavailable (${r.status})`);
            return r;
        };
        const repo = (v: unknown) => {
            const r = obj(v);
            if (r.id !== input.repository.repositoryId || r.node_id !== input.repository.repositoryNodeId || r.full_name !== `${input.repository.owner}/${input.repository.repository}`)
                throw Error('Contribution repository identity changed');
        };
        const detailRoute = `${root}/${input.kind === 'issue' ? 'issues' : 'pulls'}/${input.number}`;
        const detail = (v: unknown) => {
            const r = obj(v);
            positive(r.id);
            str(r.node_id);
            if (r.number !== input.number)
                throw Error('Contribution number changed');
            if (input.kind === 'pull-request') {
                repo(obj(r.base).repo);
                sha(obj(r.head).sha);
                sha(obj(r.base).sha);
                if (typeof r.merged !== 'boolean')
                    throw Error('Native merge state missing');
                if (r.merged) {
                    sha(r.merge_commit_sha);
                    positive(obj(r.merged_by).id);
                    str(obj(r.merged_by).login);
                    str(r.merged_at);
                }
            }
            else if (r.pull_request !== undefined || r.repository_url !== `https://api.github.com${root}`)
                throw Error('Issue kind/repository changed');
            if (typeof r.title !== 'string' || !(r.body === null || typeof r.body === 'string'))
                throw Error('Native intent unavailable');
            return r;
        };
        await get(root).then(r => repo(r.data));
        const first = detail((await get(detailRoute)).data);
        const facets: ContributionFacet[] = [];
        const missing: string[] = [];
        try {
            facets.push({ kind: 'intent', data: { title: first.title, body: first.body, observedUpdatedAt: nativeTime(first.updated_at) } });
        }
        catch (e) {
            missing.push('intent: ' + String(e));
        }
        const collection = async (route: string, key?: string): Promise<unknown[]> => {
            const initial = new URL(route, this.origin);
            let current = initial;
            const all: unknown[] = [];
            for (let page = 0; page < 10; page++) {
                const r = await get(current.pathname + current.search);
                const values = key ? obj(r.data)[key] : r.data;
                if (!Array.isArray(values) || all.length + values.length > 10000)
                    throw Error('Contribution collection incomplete');
                if (values.some(v => all.some(old => obj(old).id === obj(v).id)) || new Set(values.map(v => positive(obj(v).id))).size !== values.length)
                    throw Error('Duplicate native contribution producer identity; collection incomplete');
                all.push(...values);
                const next = nextGitHubPage(r.link, current, initial);
                if (!next)
                    return all;
                current = next;
            }
            throw Error('Contribution collection page bound exhausted');
        };
        if (input.kind === 'pull-request') {
            const head = sha(first.head.sha);
            try {
                const rows = await collection(`${root}/pulls/${input.number}/reviews?per_page=100&page=1`);
                facets.push({ kind: 'review', data: { headSha: head, scope: 'native PR review list, not independent agent certification', rows: rows.map(v => { const r = obj(v); return { id: positive(r.id), nodeId: str(r.node_id), actorId: positive(obj(r.user).id), state: enumeration(r.state, ['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']), commitSha: sha(r.commit_id), submittedAt: optionalTime(r.submitted_at) }; }) } });
            }
            catch (e) {
                missing.push('review: ' + String(e));
            }
            try {
                const checks = await collection(`${root}/commits/${head}/check-runs?filter=all&per_page=100&page=1`, 'check_runs');
                const statuses = await collection(`${root}/commits/${head}/statuses?per_page=100&page=1`);
                facets.push({ kind: 'verification', data: { headSha: head, scope: 'observed reference check-run/status endpoints; native historical limits apply', checks: checks.map(v => {
                            const r = obj(v);
                            if (r.head_sha !== head)
                                throw Error('Check SHA differs');
                            return { id: positive(r.id), name: str(r.name), ...checkState(r), startedAt: optionalTime(r.started_at), completedAt: optionalTime(r.completed_at) };
                        }), statuses: statuses.map(v => { const r = obj(v); return { id: positive(r.id), context: str(r.context), state: enumeration(r.state, ['error', 'failure', 'pending', 'success']), createdAt: optionalTime(r.created_at) }; }) } });
            }
            catch (e) {
                missing.push('verification: ' + String(e));
            }
            if (first.merged)
                facets.push({ kind: 'acceptance', data: { mergeSha: first.merge_commit_sha, mergedAt: first.merged_at, actorId: first.merged_by.id, actorLogin: first.merged_by.login, authority: 'Platform-observed merge; historical permission/override basis unavailable; no agent-procedure certification' } });
        }
        const last = detail((await get(detailRoute)).data);
        await get(root).then(r => repo(r.data));
        const binding = (r: any) => JSON.stringify([r.id, r.node_id, r.title, r.body, r.updated_at, r.head?.sha, r.base?.sha, r.merged, r.merge_commit_sha, r.merged_at, r.merged_by?.id]);
        if (binding(first) !== binding(last))
            throw Error('Contribution bundle changed during observation; bounded refresh required');
        return { identity: { id: first.id, nodeId: first.node_id }, merged: input.kind === 'pull-request' && first.merged, mergeSha: input.kind === 'pull-request' && first.merged ? first.merge_commit_sha : null, facets, missing, receipts };
    }
}
export function openContributionReader(options: ContributionReadOptions) { return new NativeContributionReader('https://api.github.com', options); }
/** Internal fixture entry; no CLI/model origin route. */
export function createOwnedContributionReader(options: ContributionReadOptions & {
    origin: string;
}) {
    const u = new URL(options.origin);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password || u.pathname !== '/' || u.search || u.hash)
        throw Error('Owned contribution fixture origin unsupported');
    return new NativeContributionReader(u.origin, options);
}

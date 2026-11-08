import type { ReadLimits, ReadResponse, ReadTransport } from './github-transport.js';
import { readClassicTarget, type ClassicTransport } from './github-classic.js';
const segment = (value: string) => {
    if (!value || value.length > 200 || /[\x00-\x20\x7f/\\]/.test(value) || value === '.' || value === '..')
        throw Error('Unsupported GitHub identity segment');
    return encodeURIComponent(value);
};
const identifier = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 1)
        throw Error('GitHub resource ID must be a positive safe integer');
    return String(value);
};
const branch = (value: string) => {
    if (!value || value === '.' || value === '..' || value.length > 1024 || /[\x00-\x20\x7f]/.test(value))
        throw Error('Unsupported GitHub branch name');
    return encodeURIComponent(value);
};
function commit(value: string): string {
    if (!/^[a-f0-9]{40}$/.test(value))
        throw Error('Exact native GitHub commit identity required');
    return value;
}
export interface CompleteCollection {
    items: readonly unknown[];
    pages: readonly ReadResponse[];
}
/** Internal constructor allows an owned native HTTP fixture, never a project callback. */
export class GitHubReadClient {
    constructor(private origin: string, private read: ReadTransport, private limits: ReadLimits, private classic?: ClassicTransport) { }
    classicTargetProtection(owner: string, repo: string, name: string, repositoryNodeId: string, signal?: AbortSignal) {
        segment(owner);
        segment(repo);
        branch(name);
        if (!this.classic)
            throw Error('Fixed classic GraphQL reader unavailable');
        return readClassicTarget(this.classic, this.limits, { owner, name: repo, branch: name, repositoryNodeId }, signal);
    }
    authenticatedUser(signal?: AbortSignal) { return this.get('/user', signal); }
    repository(owner: string, repo: string, signal?: AbortSignal) { return this.get(this.repo(owner, repo), signal); }
    repositoryRulesets(owner: string, repo: string, signal?: AbortSignal) {
        return this.collection(`${this.repo(owner, repo)}/rulesets?includes_parents=true&per_page=100&page=1`, signal);
    }
    repositoryRuleset(owner: string, repo: string, id: number, signal?: AbortSignal) {
        return this.get(`${this.repo(owner, repo)}/rulesets/${identifier(id)}?includes_parents=true`, signal);
    }
    organizationRuleset(owner: string, id: number, signal?: AbortSignal) {
        return this.get(`/orgs/${segment(owner)}/rulesets/${identifier(id)}`, signal);
    }
    branchRules(owner: string, repo: string, name: string, signal?: AbortSignal) {
        return this.collection(`${this.repo(owner, repo)}/rules/branches/${branch(name)}?per_page=100&page=1`, signal);
    }
    branchProtection(owner: string, repo: string, name: string, signal?: AbortSignal) {
        return this.get(`${this.repo(owner, repo)}/branches/${branch(name)}/protection`, signal);
    }
    pullRequest(owner: string, repo: string, number: number, signal?: AbortSignal) {
        return this.get(`${this.repo(owner, repo)}/pulls/${identifier(number)}`, signal);
    }
    pullRequestReviews(owner: string, repo: string, number: number, signal?: AbortSignal) {
        return this.collection(`${this.repo(owner, repo)}/pulls/${identifier(number)}/reviews?per_page=100&page=1`, signal);
    }
    commitStatuses(owner: string, repo: string, sha: string, signal?: AbortSignal) {
        return this.collection(`${this.repo(owner, repo)}/commits/${commit(sha)}/statuses?per_page=100&page=1`, signal);
    }
    commitCheckRuns(owner: string, repo: string, sha: string, signal?: AbortSignal) {
        return this.checkRuns(`${this.repo(owner, repo)}/commits/${commit(sha)}/check-runs?filter=latest&per_page=100&page=1`, signal);
    }
    compareCommits(owner: string, repo: string, base: string, head: string, signal?: AbortSignal) {
        return this.get(`${this.repo(owner, repo)}/compare/${commit(base)}...${commit(head)}?per_page=1&page=1`, signal);
    }
    gitCommit(owner: string, repo: string, sha: string, signal?: AbortSignal) {
        return this.get(`${this.repo(owner, repo)}/git/commits/${commit(sha)}`, signal);
    }
    private async checkRuns(path: string, signal?: AbortSignal): Promise<CompleteCollection> {
        const initial = new URL(path, this.origin);
        let current = initial, total: number | null = null, bytes = 0;
        const pages: ReadResponse[] = [], items: unknown[] = [], seen = new Set<number>();
        for (;;) {
            if (pages.length >= this.limits.pages)
                throw Error('GitHub check inventory exceeds supported page bound');
            const response = await this.read(current, signal), body = response.data as {
                total_count?: unknown;
                check_runs?: unknown;
            };
            if (response.status !== 200 || !body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.total_count) || Number(body.total_count) < 0 || !Array.isArray(body.check_runs))
                throw Error('Complete native check inventory unavailable');
            if (total !== null && total !== body.total_count)
                throw Error('Native check inventory changed during pagination');
            total = Number(body.total_count);
            bytes += response.bodyBytes;
            if (total > this.limits.collectionItems || bytes > this.limits.collectionBytes || items.length + body.check_runs.length > total)
                throw Error('Native check inventory exceeds supported bounds');
            for (const value of body.check_runs) {
                const id = value && typeof value === 'object' && !Array.isArray(value) ? value.id : undefined;
                if (!Number.isSafeInteger(id) || id < 1 || seen.has(id))
                    throw Error('Native check inventory repeats or omits an identity');
                seen.add(id);
                items.push(value);
            }
            pages.push(response);
            const next = nextGitHubPage(response.link, current, initial);
            if (!next) {
                if (items.length !== total)
                    throw Error('Native check inventory is incomplete');
                return { items, pages };
            }
            if (!body.check_runs.length || items.length >= total)
                throw Error('Native check continuation contradicts its total');
            current = next;
        }
    }
    private repo(owner: string, repo: string) { return `/repos/${segment(owner)}/${segment(repo)}`; }
    private get(path: string, signal?: AbortSignal) { return this.read(new URL(path, this.origin), signal); }
    private async collection(path: string, signal?: AbortSignal): Promise<CompleteCollection> {
        const initial = new URL(path, this.origin);
        let current = initial;
        const pages: ReadResponse[] = [];
        const items: unknown[] = [];
        let bytes = 0;
        for (;;) {
            if (pages.length >= this.limits.pages)
                throw Error('GitHub collection exceeds supported page limit; complete observation unavailable');
            const response = await this.read(current, signal);
            if (response.status !== 200 || !Array.isArray(response.data))
                throw Error('GitHub collection page unavailable or unsupported; complete observation unavailable');
            bytes += response.bodyBytes;
            if (bytes > this.limits.collectionBytes || items.length + response.data.length > this.limits.collectionItems) {
                throw Error('GitHub collection exceeds supported size; complete observation unavailable');
            }
            pages.push(response);
            for (const item of response.data)
                items.push(item);
            const next = nextGitHubPage(response.link, current, initial);
            if (!next)
                return { items, pages };
            current = next;
        }
    }
}
/** Internal shared strict REST continuation; no request or permission side effect. */
export function nextGitHubPage(header: string | null, current: URL, initial: URL): URL | null {
    if (header === null)
        return null;
    if (!header.trim())
        throw Error('GitHub pagination header is empty');
    const relations = new Set<string>();
    let next: URL | null = null;
    const currentPage = Number(current.searchParams.get('page'));
    let lastPage: number | null = null;
    for (const link of header.split(',')) {
        const match = /^\s*<([^<>\s]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(link);
        if (!match || relations.has(match[2]!))
            throw Error('GitHub pagination header unsupported or ambiguous');
        relations.add(match[2]!);
        let url: URL;
        try {
            url = new URL(match[1]!);
        }
        catch {
            throw Error('GitHub pagination URL unsupported');
        }
        if (url.origin !== initial.origin || url.username || url.password || url.pathname !== initial.pathname || url.hash) {
            throw Error('GitHub pagination changed endpoint identity');
        }
        const expected = new URLSearchParams(initial.search);
        const keys = [...url.searchParams.keys()];
        if (new Set(keys).size !== keys.length || keys.length !== [...expected.keys()].length ||
            keys.some(key => !expected.has(key) || (key !== 'page' && expected.get(key) !== url.searchParams.get(key)))) {
            throw Error('GitHub pagination changed query scope');
        }
        const page = url.searchParams.get('page');
        if (!page || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))
            throw Error('GitHub pagination page unsupported');
        if (match[2] === 'next') {
            if (Number(page) !== currentPage + 1)
                throw Error('GitHub pagination did not advance exactly one page');
            next = url;
        }
        if (match[2] === 'last')
            lastPage = Number(page);
        if ((match[2] === 'first' && Number(page) !== 1) || (match[2] === 'prev' && Number(page) !== currentPage - 1)) {
            throw Error('GitHub pagination relation contradicts current page');
        }
    }
    if (lastPage !== null && (lastPage < currentPage || (lastPage > currentPage && !next) || (lastPage === currentPage && next))) {
        throw Error('GitHub pagination lacks consistent continuation');
    }
    return next;
}

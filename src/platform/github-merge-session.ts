import { mergeBranchName as ref } from './github-merge-protocol.js';
import { randomUUID } from 'node:crypto';
import { nativeMergeTransport, type NativeMergeTransport, type NativeJsonStart, type ReadLimits, type ReadResponse } from './github-transport.js';
import { GitHubReadClient } from './github-read-client.js';
import { fixedClassicTransport } from './github-classic.js';
import { createNativePublicOwnerMergePolicyObserver, policyReadLimits } from './github-policy.js';
import { ordinaryMergeRequirements, type OrdinaryMergeRequirements } from './github-merge-policy.js';
import { policyCanonical, policyHash, policyId, policyObject, policyText } from './github-policy-schema.js';
import { mergeCommitId, ordinaryMergeOptions, parseNativeMergeResult, type NativeMergeResult } from './github-merge-protocol.js';
import { createNativePublicOwnerCapabilityObserver, type CapabilityTarget } from './github-capability.js';
export interface NativeMergeIdentity {
    expectedUserId: number;
    target: CapabilityTarget;
    pullNumber: number;
    pullId: number;
    pullNodeId: string;
    baseRef: string;
    headRef: string;
}
export interface NativeMergeSubject extends NativeMergeIdentity {
    expectedBase: string;
    expectedHead: string;
    expectedTree: string;
}
export interface MergeNativeReceipt {
    route: string;
    method: 'GET' | 'POST' | 'PUT';
    status: number;
    bodyHash: string;
    bodyBytes: number;
    requestId: string | null;
}
export interface PreparedNativeMerge {
    readonly id: string;
    readonly fingerprint: string;
    readonly subject: Readonly<NativeMergeSubject>;
    readonly commitTitle: string;
    readonly options: ReturnType<typeof ordinaryMergeOptions>;
    readonly receipts: readonly MergeNativeReceipt[];
}
export interface NativeMergeAttempt {
    handoff: 'not-started' | 'request-created';
    responseStatus: number | null;
    result: NativeMergeResult | null;
    receipts: readonly MergeNativeReceipt[];
    unavailable: string | null;
}
interface Snapshot {
    subject: NativeMergeSubject;
    title: string;
    sourceHash: string;
    requirements: OrdinaryMergeRequirements;
    approvalIds: number[];
    checkIds: string[];
    fingerprint: string;
}
const origin = 'https://api.github.com';
function segment(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value) || ['.', '..'].includes(value))
        throw Error('Unsupported native merge repository segment');
    return encodeURIComponent(value);
}
function identity(input: NativeMergeIdentity): NativeMergeIdentity {
    const value = structuredClone(input);
    policyId(value.expectedUserId);
    policyId(value.target.repositoryId);
    policyId(value.pullNumber);
    policyId(value.pullId);
    policyText(value.target.repositoryNodeId);
    policyText(value.pullNodeId);
    segment(value.target.owner);
    segment(value.target.repository);
    if (value.target.visibility !== 'public')
        throw Error('Initial ordinary merge profile requires a public repository');
    ref(value.baseRef);
    ref(value.headRef);
    if (value.baseRef === value.headRef)
        throw Error('Distinct original PR head and base required');
    return value;
}
function subject(input: NativeMergeSubject): NativeMergeSubject {
    const value = structuredClone(input);
    identity(value);
    mergeCommitId(value.expectedBase);
    mergeCommitId(value.expectedHead);
    mergeCommitId(value.expectedTree);
    if (value.expectedBase === value.expectedHead)
        throw Error('Distinct original PR head and base required');
    return value;
}
function repoPath(value: NativeMergeIdentity) { return '/repos/' + segment(value.target.owner) + '/' + segment(value.target.repository); }
function pullPath(value: NativeMergeIdentity) { return repoPath(value) + '/pulls/' + value.pullNumber; }
function successful(response: ReadResponse) {
    if (response.status !== 200)
        throw Error('Required native merge observation unavailable');
    return policyObject(response.data);
}
function sync(action: () => void) {
    const value: unknown = action();
    if (value && typeof value === 'object' && 'then' in value)
        throw Error('Synchronous current-authority and durable-intent checks required');
}
function timestamp(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw Error('Native review/status ordering unavailable');
    return Date.parse(value);
}
/** Native protocol only. The Controller must independently bind current work, procedures, source and finite ordinary delegation. */
class OrdinaryMergeSession {
    readonly credentialSessionId = randomUUID();
    private stopped = new AbortController();
    private tasks = new Set<Promise<unknown>>();
    private prepared = new WeakMap<PreparedNativeMerge, Snapshot>();
    private sent = new WeakSet<PreparedNativeMerge>();
    constructor(private readonly start: NativeMergeTransport, private readonly limits: ReadLimits) { }
    private own<T>(task: Promise<T>): Promise<T> {
        this.tasks.add(task);
        void task.finally(() => this.tasks.delete(task)).catch(() => { });
        return task;
    }
    async close() { this.stopped.abort(); await Promise.allSettled([...this.tasks]); }
    private operation(signal?: AbortSignal) {
        const combined = AbortSignal.any([this.stopped.signal, ...(signal ? [signal] : []), AbortSignal.timeout(30000)]), receipts: MergeNativeReceipt[] = [];
        let requests = 0, bytes = 0;
        const native: NativeMergeTransport = (url, request, nested) => {
            combined.throwIfAborted();
            nested?.throwIfAborted();
            if (url.origin !== origin || url.username || url.password || url.hash || requests >= this.limits.pages)
                throw Error('Native merge origin or operation request bound unavailable');
            requests++;
            const started = this.start(url, request, AbortSignal.any([combined, ...(nested ? [nested] : [])]));
            return { handoff: started.handoff, response: started.response.then(response => {
                    bytes += response.bodyBytes;
                    if (bytes > this.limits.collectionBytes)
                        throw Error('Native merge operation response bound exceeded');
                    receipts.push({ route: url.pathname + url.search, method: request.method, status: response.status, bodyHash: response.bodyHash, bodyBytes: response.bodyBytes, requestId: response.requestId });
                    return response;
                }) };
        };
        const reader = new GitHubReadClient(origin, (url, abort) => native(url, { method: 'GET' }, abort).response, this.limits, fixedClassicTransport(origin, native));
        return { native, reader, signal: combined, receipts };
    }
    private async authority(value: NativeMergeIdentity, op: ReturnType<OrdinaryMergeSession['operation']>) {
        const observed = await createNativePublicOwnerCapabilityObserver((url, signal) => op.native(url, { method: 'GET' }, signal).response, this.limits.requestTimeoutMs)
            .observePublicationCapability({ expectedUserId: value.expectedUserId, target: value.target, action: 'merge-pull-request' }, op.signal);
        if (observed.state !== 'matched')
            throw Error('Original native merge account or repository unavailable');
    }
    /** Read identity for pre-work target registration; no policy or procedure standing. */
    observeIdentity(input: NativeMergeIdentity, guard: () => void, signal?: AbortSignal) {
        return this.own((async () => {
            const value = identity(input);
            const op = this.operation(signal);
            sync(guard);
            await this.authority(value, op);
            const read = async () => {
                const response = await op.reader.pullRequest(value.target.owner, value.target.repository, value.pullNumber, op.signal);
                const row = successful(response), head = policyObject(row.head), base = policyObject(row.base);
                const candidate = { ...value, expectedHead: mergeCommitId(head.sha), expectedBase: mergeCommitId(base.sha) };
                const checked = this.pull(response, candidate, false);
                if (row.state !== 'open' || row.merged !== false)
                    throw Error('Existing open native PR required');
                return { identity: structuredClone(input), head: candidate.expectedHead, base: candidate.expectedBase, sourceHash: checked.sourceHash };
            };
            const before = await read();
            await this.authority(value, op);
            const after = await read();
            sync(guard);
            op.signal.throwIfAborted();
            if (policyCanonical(before) !== policyCanonical(after))
                throw Error('Native PR identity or source changed during registration');
            return { ...after, receipts: op.receipts };
        })());
    }
    private pull(response: ReadResponse, wanted: NativeMergeIdentity & {
        expectedHead: string;
        expectedBase: string;
    }, open: boolean) {
        const row = successful(response), head = policyObject(row.head), base = policyObject(row.base), headRepo = policyObject(head.repo), baseRepo = policyObject(base.repo);
        if (row.id !== wanted.pullId || row.node_id !== wanted.pullNodeId || row.number !== wanted.pullNumber ||
            head.ref !== wanted.headRef || head.sha !== wanted.expectedHead || base.ref !== wanted.baseRef ||
            headRepo.id !== wanted.target.repositoryId || headRepo.node_id !== wanted.target.repositoryNodeId || baseRepo.id !== wanted.target.repositoryId || baseRepo.node_id !== wanted.target.repositoryNodeId ||
            headRepo.full_name !== wanted.target.owner + '/' + wanted.target.repository || baseRepo.full_name !== headRepo.full_name)
            throw Error('Original native PR identity, head or repository differs');
        if (open && row.stack != null)
            throw Error('Native stacked PR is outside the single-PR merge profile');
        if (open && (row.state !== 'open' || row.merged !== false || row.draft !== false || row.mergeable !== true || row.mergeable_state !== 'clean' || base.sha !== wanted.expectedBase))
            throw Error('Current original PR is not ready for ordinary direct merge');
        const title = policyText(row.title);
        if (Buffer.byteLength(title) > 1024 || typeof row.body !== 'string' && row.body !== null || typeof row.body === 'string' && Buffer.byteLength(row.body) > 512 * 1024)
            throw Error('Original bounded PR source unavailable');
        return { row, title, author: policyId(policyObject(row.user).id), sourceHash: policyHash({ title, body: row.body }) };
    }
    private approvals(rows: readonly unknown[], value: NativeMergeSubject, author: number, required: number) {
        const latest = new Map<number, {
            id: number;
            state: string;
            commit: string;
            time: number;
        }>(), seen = new Set<number>();
        for (const raw of rows) {
            const row = policyObject(raw), id = policyId(row.id), user = policyId(policyObject(row.user).id);
            if (seen.has(id))
                throw Error('Native PR reviews repeated an identity');
            seen.add(id);
            if (!['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(String(row.state)))
                throw Error('Native PR review state unavailable');
            if (row.state === 'PENDING' || row.state === 'COMMENTED')
                continue;
            const current = { id, state: String(row.state), commit: mergeCommitId(row.commit_id), time: timestamp(row.submitted_at) }, prior = latest.get(user);
            if (!prior || current.time > prior.time || current.time === prior.time && current.id > prior.id)
                latest.set(user, current);
        }
        const current = [...latest.entries()].filter(([, review]) => review.commit === value.expectedHead);
        if (current.some(([, review]) => review.state === 'CHANGES_REQUESTED'))
            throw Error('Current native change request remains unresolved');
        const approved = current.filter(([user, review]) => user !== author && user !== value.expectedUserId && review.state === 'APPROVED').map(([, review]) => review.id).sort((a, b) => a - b);
        if (approved.length < required)
            throw Error('Current-head separate-account platform approvals are missing');
        return approved;
    }
    private checks(statuses: readonly unknown[], runs: readonly unknown[], value: NativeMergeSubject, required: OrdinaryMergeRequirements['checks']) {
        const latest = new Map<string, {
            id: number;
            state: unknown;
            time: number;
        }>(), seen = new Set<number>();
        for (const raw of statuses) {
            const row = policyObject(raw), id = policyId(row.id), name = policyText(row.context), time = timestamp(row.created_at);
            if (seen.has(id))
                throw Error('Native commit statuses repeated an identity');
            seen.add(id);
            const prior = latest.get(name);
            if (!prior || time > prior.time || time === prior.time && id > prior.id)
                latest.set(name, { id, state: row.state, time });
        }
        const checked = runs.map(raw => {
            const row = policyObject(raw), app = policyObject(row.app);
            if (row.head_sha !== value.expectedHead)
                throw Error('Native check run is bound to another commit');
            return { id: policyId(row.id), name: policyText(row.name), app: policyId(app.id), status: row.status, conclusion: row.conclusion };
        });
        const identities: string[] = [];
        for (const requirement of required) {
            const matching = checked.filter(row => row.name === requirement.context && (requirement.integrationId === null || row.app === requirement.integrationId));
            if (new Set(matching.map(row => row.app)).size !== matching.length)
                throw Error('Latest native check name/app correspondence is ambiguous');
            const status = latest.get(requirement.context);
            if (status && requirement.integrationId !== null)
                throw Error('Commit status app identity cannot establish the selected native check source');
            if (!matching.length && !status || matching.some(row => row.status !== 'completed' || row.conclusion !== 'success') || status && status.state !== 'success')
                throw Error('Required native current-head checks are not successful');
            identities.push(...matching.map(row => 'check:' + row.app + ':' + row.id), ...(status ? ['status:' + status.id] : []));
        }
        return [...new Set(identities)].sort();
    }
    private async observe(value: NativeMergeSubject, op: ReturnType<OrdinaryMergeSession['operation']>) {
        const { reader, signal } = op, first = this.pull(await reader.pullRequest(value.target.owner, value.target.repository, value.pullNumber, signal), value, true);
        const policy = await createNativePublicOwnerMergePolicyObserver(op.native, this.limits).observeTargetPolicy({ expectedUserId: value.expectedUserId, target: value.target, branch: value.baseRef, expectedBase: value.expectedBase, referencedHead: { branch: value.headRef, expectedCommit: value.expectedHead } }, signal);
        const requirements = ordinaryMergeRequirements(policy);
        const commit = successful(await reader.gitCommit(value.target.owner, value.target.repository, value.expectedHead, signal));
        if (commit.sha !== value.expectedHead || policyObject(commit.tree).sha !== value.expectedTree)
            throw Error('Reviewed native head tree differs');
        const compared = successful(await reader.compareCommits(value.target.owner, value.target.repository, value.expectedBase, value.expectedHead, signal));
        if (policyObject(compared.base_commit).sha !== value.expectedBase || policyObject(compared.merge_base_commit).sha !== value.expectedBase || compared.status !== 'ahead' || compared.behind_by !== 0 || !Number.isSafeInteger(compared.ahead_by) || Number(compared.ahead_by) < 1)
            throw Error('Current native base is not an ancestor of the reviewed head');
        const reviews = await reader.pullRequestReviews(value.target.owner, value.target.repository, value.pullNumber, signal);
        const approvalIds = this.approvals(reviews.items, value, first.author, requirements.approvingAccounts);
        const statuses = await reader.commitStatuses(value.target.owner, value.target.repository, value.expectedHead, signal), checks = await reader.commitCheckRuns(value.target.owner, value.target.repository, value.expectedHead, signal);
        const checkIds = this.checks(statuses.items, checks.items, value, requirements.checks);
        const last = this.pull(await reader.pullRequest(value.target.owner, value.target.repository, value.pullNumber, signal), value, true);
        if (last.sourceHash !== first.sourceHash || last.author !== first.author)
            throw Error('Original PR source changed during preparation');
        const captured = { subject: value, title: first.title, sourceHash: first.sourceHash, requirements, approvalIds, checkIds };
        return { ...captured, fingerprint: policyHash(captured) };
    }
    prepare(input: NativeMergeSubject, guard: () => void, signal?: AbortSignal): Promise<PreparedNativeMerge> {
        return this.own((async () => {
            sync(guard);
            const value = subject(input), op = this.operation(signal), snapshot = await this.observe(value, op);
            sync(guard);
            op.signal.throwIfAborted();
            const witness = Object.freeze({ id: randomUUID(), fingerprint: snapshot.fingerprint, subject: Object.freeze({ ...structuredClone(value), target: Object.freeze(structuredClone(value.target)) }), commitTitle: 'gitjig: merge PR #' + value.pullNumber, options: ordinaryMergeOptions(value.expectedHead), receipts: Object.freeze(op.receipts.map(receipt => Object.freeze({ ...receipt }))) });
            this.prepared.set(witness, snapshot);
            return witness;
        })());
    }
    send(witness: PreparedNativeMerge, guard: () => void, intent: () => void, signal?: AbortSignal): Promise<NativeMergeAttempt> {
        return this.own((async () => {
            const saved = this.prepared.get(witness);
            if (!saved || this.sent.has(witness) || policyCanonical(witness.subject) !== policyCanonical(saved.subject) || witness.fingerprint !== saved.fingerprint)
                throw Error('Original unconsumed native merge preparation required');
            sync(guard);
            const op = this.operation(signal), current = await this.observe(saved.subject, op);
            sync(guard);
            if (current.fingerprint !== saved.fingerprint)
                throw Error('Native merge context changed; explicitly prepare the same original again');
            op.signal.throwIfAborted();
            // Observation yields. A concurrent caller may have consumed this
            // same genuine witness while its native reads were in flight.
            if (this.sent.has(witness))
                throw Error('Original unconsumed native merge preparation required');
            this.sent.add(witness);
            sync(intent);
            const body = Buffer.from(JSON.stringify({ ...ordinaryMergeOptions(saved.subject.expectedHead), commit_title: witness.commitTitle, commit_message: '' }));
            let started: NativeJsonStart | null = null;
            try {
                op.signal.throwIfAborted();
                started = op.native(new URL(pullPath(saved.subject) + '/merge', origin), { method: 'PUT', body }, op.signal);
                const response = await started.response;
                let result: NativeMergeResult | null = null;
                try {
                    result = parseNativeMergeResult(response.data, response.status);
                }
                catch { /* Preserve response and possible handoff; never invent a definitely-unsent result. */ }
                return { handoff: started.handoff, responseStatus: response.status, result, receipts: op.receipts, unavailable: result ? null : 'Native merge response did not establish its original result; retain and reconcile without replay' };
            }
            catch {
                return { handoff: started?.handoff ?? 'not-started', responseStatus: null, result: null, receipts: op.receipts, unavailable: started?.handoff === 'request-created' ? 'Native merge outcome unavailable; preserve original possible handoff and reconcile without replay' : 'Native merge stopped before request creation; inspect original admission before any explicit retry' };
            }
        })());
    }
    observeMergedCandidate(input: NativeMergeSubject, signal?: AbortSignal) {
        return this.own((async () => {
            const value = subject(input), op = this.operation(signal);
            await this.authority(value, op);
            const pull = this.pull(await op.reader.pullRequest(value.target.owner, value.target.repository, value.pullNumber, op.signal), value, false);
            if (pull.row.state !== 'closed' || pull.row.merged !== true)
                throw Error('Original PR has no observed native merge; uncertainty retained');
            return { commit: mergeCommitId(pull.row.merge_commit_sha), receipts: op.receipts };
        })());
    }
    inspectMergedCandidate(input: NativeMergeSubject, mergedCommit: string, signal?: AbortSignal) {
        return this.own((async () => {
            const value = subject(input), wanted = mergeCommitId(mergedCommit), op = this.operation(signal);
            await this.authority(value, op);
            const pull = this.pull(await op.reader.pullRequest(value.target.owner, value.target.repository, value.pullNumber, op.signal), value, false);
            const commit = successful(await op.reader.gitCommit(value.target.owner, value.target.repository, wanted, op.signal));
            if (pull.row.merged !== true || pull.row.state !== 'closed' || pull.row.merge_commit_sha !== wanted || commit.sha !== wanted || policyObject(commit.tree).sha !== value.expectedTree ||
                !Array.isArray(commit.parents) || commit.parents.length !== 2 || policyObject(commit.parents[0]).sha !== value.expectedBase || policyObject(commit.parents[1]).sha !== value.expectedHead)
                throw Error('Actual merged PR tree or parents do not match the reviewed native candidate');
            await this.authority(value, op);
            return { kind: 'merged-candidate-correspondence' as const, sendCausality: 'not-established-by-resource-observation' as const, mergedCommit: wanted, tree: value.expectedTree, parents: [value.expectedBase, value.expectedHead], receipts: op.receipts };
        })());
    }
}
export function openOrdinaryGitHubMergeSession(options: {
    token: string;
    limits?: Partial<ReadLimits>;
}) {
    const captured = structuredClone(options), limits = policyReadLimits(captured.limits);
    return Object.freeze(new OrdinaryMergeSession(nativeMergeTransport(captured.token, limits), Object.freeze(limits)));
}
/** Internal owned HTTP fixture only; never a public CLI/model origin or authority option. */
export function createOwnedOrdinaryMergeSession(options: {
    token: string;
    origin: string;
    limits?: Partial<ReadLimits>;
}) {
    const captured = structuredClone(options), endpoint = new URL(captured.origin), limits = policyReadLimits(captured.limits), native = nativeMergeTransport(captured.token, limits);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw Error('Owned ordinary merge loopback fixture required');
    return Object.freeze(new OrdinaryMergeSession((url, request, signal) => {
        if (url.origin !== origin)
            throw Error('Owned merge canonical origin differs');
        return native(new URL(url.pathname + url.search, endpoint.origin), request, signal);
    }, Object.freeze(limits)));
}

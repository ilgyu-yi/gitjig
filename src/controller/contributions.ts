import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { openContributionReader, createOwnedContributionReader, validateContributionResource, type ContributionReader, type ContributionResource, type ContributionReadOptions } from '../platform/github-contributions.js';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const parse = (v: string) => JSON.parse(v);
/** Compare only native identity/version operands; arrival time is never a version. */
function selectionConflict(kind: string, old: any, next: any): string | null {
    if (kind === 'intent') {
        const a = Date.parse(old.observedUpdatedAt), b = Date.parse(next.observedUpdatedAt);
        if (!Number.isFinite(a) || !Number.isFinite(b))
            return 'native intent ordering unavailable';
        if (b < a || b === a && hash([old.title, old.body]) !== hash([next.title, next.body]))
            return 'older/equal-conflicting native intent version';
        return null;
    }
    const compareRows = (before: any[], after: any[], checks = false): string | null => {
        const ids = new Set(after.map(r => r.id));
        if (before.some(r => !ids.has(r.id)))
            return 'known native IDs absent; list ordering/deletion unavailable';
        for (const a of before) {
            const b = after.find(r => r.id === a.id);
            if (hash(a) === hash(b))
                continue;
            if (!checks && a.state === 'PENDING' && ['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED'].includes(b.state) && !a.submittedAt && b.submittedAt && Number.isFinite(Date.parse(b.submittedAt)) && a.actorId === b.actorId && a.nodeId === b.nodeId && a.commitSha === b.commitSha)
                continue;
            if (checks && a.name === b.name && a.status !== 'completed' && b.status === 'completed' && b.completedAt && Number.isFinite(Date.parse(b.completedAt)) && (!a.startedAt || a.startedAt === b.startedAt) && (!b.startedAt || Date.parse(b.startedAt) <= Date.parse(b.completedAt)))
                continue;
            if (checks && ['queued', 'requested', 'waiting', 'pending'].includes(a.status) && b.status === 'in_progress' && b.startedAt && (!a.startedAt || a.startedAt === b.startedAt))
                continue;
            return 'same native producer ID changed without established forward version/lifecycle';
        }
        return null;
    };
    if (old.headSha && next.headSha && old.headSha !== next.headSha)
        return null;
    if (kind === 'review')
        return compareRows(old.rows, next.rows);
    if (kind === 'verification')
        return compareRows(old.checks, next.checks, true) ?? compareRows(old.statuses, next.statuses);
    return hash(old) === hash(next) ? null : 'immutable acceptance observation conflicts';
}
export class Contributions {
    private reader?: ContributionReader;
    private jobs = new Map<string, Promise<unknown>>();
    private abort = new AbortController();
    private timer?: NodeJS.Timeout;
    private stopped = false;
    constructor(private s: Store, private assertOpen: () => void) { }
    configure(options: ContributionReadOptions) {
        this.assertOpen();
        if (this.jobs.size)
            throw Error('Contribution reader busy; settle before replacing credential');
        this.reader = openContributionReader(options);
    }
    configureOwned(options: ContributionReadOptions & {
        origin: string;
    }) {
        this.assertOpen();
        if (this.jobs.size)
            throw Error('Contribution reader busy');
        this.reader = createOwnedContributionReader(options);
    }
    private resource(id: string) {
        const row = this.s.one('SELECT * FROM tracked_resources WHERE id=?', id);
        if (!row)
            throw Error('Unknown tracked resource');
        return { ...row, data: parse(row.data) };
    }
    private read(input: ContributionResource, signal?: AbortSignal) {
        if (!this.reader)
            throw Error('Contribution reader not configured; no network attempted');
        return this.reader.observe(input, signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal);
    }
    private own<T>(key: string, work: () => Promise<T>): Promise<T> {
        this.assertOpen();
        if (this.stopped)
            throw Error('Contribution collector stopping');
        const prior = this.jobs.get(key);
        if (prior)
            return prior as Promise<T>;
        const p = Promise.resolve().then(work).finally(() => this.jobs.delete(key));
        this.jobs.set(key, p);
        return p;
    }
    track(request: ContributionResource, signal?: AbortSignal) {
        const input = structuredClone(request);
        validateContributionResource(input);
        const existingPath = this.s.one('SELECT id FROM tracked_resources WHERE repository_id=? AND repository_node=? AND kind=? AND number=?', input.repository.repositoryId, input.repository.repositoryNodeId, input.kind, input.number);
        if (existingPath && hash(this.resource(existingPath.id).data.input) !== hash(input))
            throw Error('Tracked canonical request differs; explicit native rebind required');
        if (existingPath)
            return this.refresh({ resourceIds: [existingPath.id], ...(signal ? { signal } : {}) }).then(() => this.inspect(existingPath.id));
        return this.own('track:' + hash(input), async () => {
            const bundle = await this.read(input, signal);
            this.assertOpen();
            return this.s.tx(() => {
                let row = this.s.one('SELECT id FROM tracked_resources WHERE repository_id=? AND repository_node=? AND resource_id=? AND resource_node=? AND kind=?', input.repository.repositoryId, input.repository.repositoryNodeId, bundle.identity.id, bundle.identity.nodeId, input.kind);
                if (!row) {
                    if (this.s.one('SELECT id FROM tracked_resources WHERE repository_id=? AND repository_node=? AND kind=? AND number=?', input.repository.repositoryId, input.repository.repositoryNodeId, input.kind, input.number))
                        throw Error('Tracked path resource identity changed; explicit reconciliation required');
                    if (this.s.one('SELECT COUNT(*) AS n FROM tracked_resources').n >= 16)
                        throw Error('Tracked-resource profile limit16; inspect existing resources');
                    row = { id: randomUUID() };
                    const registrationSource = randomUUID();
                    this.s.run('INSERT INTO sources VALUES(?,?,?,?)', registrationSource, null, JSON.stringify({ kind: 'owner-resource-track', uid: process.getuid?.() ?? null }), JSON.stringify({ request: input, validatedIdentity: bundle.identity, repositoryId: input.repository.repositoryId, repositoryNodeId: input.repository.repositoryNodeId }));
                    this.s.run('INSERT INTO tracked_resources VALUES(?,?,?,?,?,?,?,?)', row.id, input.kind, input.repository.repositoryId, input.repository.repositoryNodeId, bundle.identity.id, bundle.identity.nodeId, input.number, JSON.stringify({ input, registrationSource, selected: {}, missing: [], merged: false }));
                }
                this.record(row.id, bundle);
                return this.inspect(row.id);
            });
        });
    }
    private record(id: string, bundle: Awaited<ReturnType<ContributionReader['observe']>>) {
        const row = this.resource(id);
        if (bundle.identity.id !== row.resource_id || bundle.identity.nodeId !== row.resource_node)
            throw Error('Tracked native resource replaced');
        const priorMerge = row.data.mergeSha;
        if (priorMerge && (!bundle.merged || priorMerge !== bundle.mergeSha))
            throw Error('Tracked merge identity conflict; explicit reconciliation needed');
        const missing = [...bundle.missing];
        const incomingIntent = bundle.facets.find(f => f.kind === 'intent');
        const oldIntent = row.data.selected.intent ? this.s.one('SELECT data FROM contribution_observations WHERE id=?', row.data.selected.intent) : null;
        const bundleConflict = oldIntent ? incomingIntent ? selectionConflict('intent', parse(oldIntent.data).value, incomingIntent.data) : 'native intent version unavailable for this bundle' : null;
        const selected = { ...row.data.selected }, key = hash([row.repository_id, row.repository_node, row.resource_id, row.resource_node, bundle.mergeSha ?? 'not-merged']);
        for (const facet of bundle.facets) {
            const payloadHash = hash(facet.data), producer = hash([row.id, key, facet.kind]);
            let existing = this.s.one('SELECT id FROM contribution_observations WHERE producer_key=? AND facet=? AND payload_hash=?', producer, facet.kind, payloadHash);
            if (!existing) {
                existing = { id: randomUUID() };
                this.s.run('INSERT INTO contribution_observations VALUES(?,?,?,?,?,?,?)', existing.id, id, key, producer, facet.kind, payloadHash, JSON.stringify({ value: facet.data, receipts: bundle.receipts }));
            }
            const previous = selected[facet.kind] ? this.s.one('SELECT data FROM contribution_observations WHERE id=?', selected[facet.kind]) : null;
            const conflict = bundleConflict ?? (previous ? selectionConflict(facet.kind, parse(previous.data).value, facet.data) : null);
            if (conflict)
                missing.push(facet.kind + ': ' + conflict);
            else
                selected[facet.kind] = existing.id;
        }
        this.s.run('UPDATE tracked_resources SET data=? WHERE id=?', JSON.stringify({ ...row.data, selected, merged: bundle.merged, mergeSha: bundle.mergeSha, missing, lastAttempt: Date.now(), readScope: 'tracked targeted refresh; not global/offline coverage' }), id);
    }
    refresh(input: {
        resourceIds?: readonly string[];
        signal?: AbortSignal;
    } = {}) {
        const ids = input.resourceIds ? [...new Set(input.resourceIds)] : this.s.all('SELECT id FROM tracked_resources ORDER BY COALESCE(json_extract(data,\'$.lastAttempt\'),0),id LIMIT 4').map(r => r.id);
        if (ids.length > 4)
            throw Error('Contribution refresh supports at most4 resources per round');
        return Promise.all(ids.map(id => this.own('resource:' + id, async () => {
            const row = this.resource(id);
            let bundle: Awaited<ReturnType<ContributionReader['observe']>> | undefined;
            try {
                bundle = await this.read(row.data.input, input.signal);
                this.assertOpen();
                this.s.tx(() => this.record(id, bundle!));
                return { resourceId: id, state: 'observed', view: this.inspect(id) };
            }
            catch (e) {
                this.assertOpen();
                this.s.tx(() => {
                    const latest = this.resource(id);
                    if (bundle) {
                        const payloadHash = hash(bundle), producer = hash([id, 'unselected-native-conflict']);
                        this.s.run('INSERT OR IGNORE INTO contribution_observations VALUES(?,?,?,?,?,?,?)', randomUUID(), id, hash([id, bundle.mergeSha]), producer, 'diagnostic', payloadHash, JSON.stringify({ reason: String(e), bundle, selected: false }));
                    }
                    this.s.run('UPDATE tracked_resources SET data=? WHERE id=?', JSON.stringify({ ...latest.data, lastAttempt: Date.now(), missing: ['bundle: ' + String(e)] }), id);
                });
                return { resourceId: id, state: 'unavailable', reason: String(e) };
            }
        })));
    }
    setParent(request: {
        childId: string;
        parentId: string | null;
        expectedRevision: number;
    }, signal?: AbortSignal) {
        const input = structuredClone(request);
        return this.own('parent:' + hash(input), async () => {
            this.assertOpen();
            const child = this.resource(input.childId), parent = input.parentId ? this.resource(input.parentId) : null;
            if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
                throw Error('Link revision invalid');
            if (parent && (child.repository_id !== parent.repository_id || child.repository_node !== parent.repository_node))
                throw Error('Summary parent must use same BASE repository');
            for (const row of [child, ...(parent ? [parent] : [])]) {
                const bundle = await this.read(row.data.input, signal);
                if (bundle.identity.id !== row.resource_id || bundle.identity.nodeId !== row.resource_node)
                    throw Error('Summary parent endpoint identity changed');
            }
            this.assertOpen();
            return this.s.tx(() => {
                signal?.throwIfAborted();
                const old = this.s.one('SELECT * FROM resource_links WHERE child=?', child.id);
                const revision = old?.revision ?? 0;
                if (revision !== input.expectedRevision || revision === Number.MAX_SAFE_INTEGER)
                    throw Error('Summary parent revision changed');
                const seen = new Set([child.id]);
                let p = parent?.id;
                for (let depth = 0; p; depth++) {
                    if (seen.has(p) || depth >= 16)
                        throw Error('Summary parent cycle/depth unsupported');
                    seen.add(p);
                    p = this.s.one('SELECT parent FROM resource_links WHERE child=?', p)?.parent;
                }
                const sourceId = randomUUID();
                this.s.run('INSERT INTO sources VALUES(?,?,?,?)', sourceId, null, JSON.stringify({ kind: 'owner-resource-parent', uid: process.getuid?.() ?? null, childNativeId: child.resource_id, childNodeId: child.resource_node, parentNativeId: parent?.resource_id ?? null, parentNodeId: parent?.resource_node ?? null }), JSON.stringify({ childId: child.id, oldParentId: old?.parent ?? null, newParentId: parent?.id ?? null, revision: revision + 1, predecessorSource: old ? parse(old.data).sourceId ?? null : null }));
                this.s.run('INSERT INTO resource_links VALUES(?,?,?,?) ON CONFLICT(child) DO UPDATE SET parent=excluded.parent,revision=excluded.revision,data=excluded.data', child.id, parent?.id ?? null, revision + 1, JSON.stringify({ kind: 'summary-parent', sourceId, priorRevision: old?.revision ?? 0 }));
                return { childId: child.id, parentId: parent?.id ?? null, revision: revision + 1 };
            });
        });
    }
    /** Complete bounded historical registry. Never refreshes or prepares a summary. */
    list() {
        this.assertOpen();
        const rows = this.s.all('SELECT id,kind,repository_id,repository_node,resource_id,resource_node,number,CASE WHEN length(CAST(data AS BLOB))<=131072 THEN data ELSE NULL END AS data FROM tracked_resources ORDER BY repository_id,repository_node,kind,number,id LIMIT 17');
        if (rows.length > 16)
            throw Error('Tracked-resource inventory exceeds the supported limit16; reconcile original records before discovery');
        return { scope: 'Retained GitHub resources only; not current remote state or workflow acceptance', resources: rows.map(row => {
                try {
                    if (typeof row.data !== 'string' || Buffer.byteLength(row.data) > 131072)
                        throw Error('Invalid retained data');
                    const data = parse(row.data);
                    validateContributionResource(data.input);
                    const input: ContributionResource = { repository: { owner: data.input.repository.owner, repository: data.input.repository.repository,
                            repositoryId: data.input.repository.repositoryId, repositoryNodeId: data.input.repository.repositoryNodeId }, kind: data.input.kind, number: data.input.number };
                    if (row.kind !== input.kind || row.number !== input.number || row.repository_id !== input.repository.repositoryId || row.repository_node !== input.repository.repositoryNodeId ||
                        !Number.isSafeInteger(row.resource_id) || row.resource_id < 1 || typeof row.resource_node !== 'string' || !row.resource_node || row.resource_node.length > 1024 ||
                        typeof data.merged !== 'boolean' || !Array.isArray(data.missing) || !data.missing.every((value: unknown) => typeof value === 'string') ||
                        data.merged && (typeof data.mergeSha !== 'string' || !/^[a-f0-9]{40}$/.test(data.mergeSha)) || !data.merged && data.mergeSha != null || typeof data.registrationSource !== 'string')
                        throw Error('Invalid retained identity');
                    const source = this.s.one('SELECT CASE WHEN length(CAST(origin AS BLOB))<=4096 THEN origin ELSE NULL END AS origin,CASE WHEN length(CAST(raw AS BLOB))<=131072 THEN raw ELSE NULL END AS raw FROM sources WHERE id=?', data.registrationSource);
                    if (!source || typeof source.origin !== 'string' || typeof source.raw !== 'string')
                        throw Error('Unavailable bounded registration provenance');
                    const registration = parse(source.raw);
                    if (!source || parse(source.origin).kind !== 'owner-resource-track' || hash(registration.request) !== hash(data.input) ||
                        registration.repositoryId !== row.repository_id || registration.repositoryNodeId !== row.repository_node ||
                        registration.validatedIdentity.id !== row.resource_id || registration.validatedIdentity.nodeId !== row.resource_node)
                        throw Error('Invalid registration provenance');
                    return { state: 'RETAINED' as const, resourceId: row.id as string, input, nativeId: row.resource_id as number, nodeId: row.resource_node as string,
                        merged: data.merged as boolean, mergeSha: (data.mergeSha ?? null) as string | null, missingCount: data.missing.length as number };
                }
                catch {
                    return { state: 'UNAVAILABLE' as const, resourceId: row.id as string, reason: 'Retained identity or registration provenance unavailable; original records were kept' };
                }
            }) };
    }
    inspect(id: string) { this.assertOpen(); const r = this.resource(id); return { resourceId: id, kind: r.kind, registrationSourceId: r.data.registrationSource ?? null, nativeId: r.resource_id, nodeId: r.resource_node, input: r.data.input, merged: r.data.merged, mergeSha: r.data.mergeSha ?? null, missing: r.data.missing, observations: this.s.all('SELECT * FROM contribution_observations WHERE resource=? ORDER BY rowid', id).map(o => ({ ...o, data: parse(o.data) })), parent: this.s.one('SELECT * FROM resource_links WHERE child=?', id) ?? null }; }
    private projection(resourceId: string) {
        const target = this.resource(resourceId), selected: string[] = [], missing: string[] = [], rows: string[] = [], links: unknown[] = [];
        for (const resource of this.s.all('SELECT id FROM tracked_resources ORDER BY id')) {
            const r = this.resource(resource.id);
            const pathLinks: unknown[] = [];
            let cursor: string | null = r.id, depth = 0;
            const seen = new Set<string>();
            let reaches = false;
            while (cursor) {
                if (seen.has(cursor) || depth++ >= 16)
                    throw Error('Summary route cycle/depth');
                seen.add(cursor);
                if (cursor === target.id) {
                    reaches = true;
                    break;
                }
                const link = this.s.one('SELECT * FROM resource_links WHERE child=?', cursor);
                if (link)
                    pathLinks.push(link);
                cursor = link?.parent ?? null;
            }
            if (!reaches || r.kind !== 'pull-request' || !r.data.merged)
                continue;
            links.push(...pathLinks);
            const obs = this.s.all('SELECT id FROM contribution_observations WHERE resource=? ORDER BY id', r.id);
            selected.push(...obs.map(o => o.id));
            missing.push(...r.data.missing.map((m: string) => r.id + ': ' + m));
            rows.push(`PR #${r.number} (${r.resource_node}), merge ${r.data.mergeSha}`);
            for (const kind of ['intent', 'verification', 'review', 'acceptance']) {
                const oid = r.data.selected[kind];
                const o = oid ? this.s.one('SELECT data FROM contribution_observations WHERE id=?', oid) : null;
                if (!o)
                    missing.push(`${r.id}: ${kind} unavailable`);
                rows.push(`${kind}: ${o ? JSON.stringify(parse(o.data).value) : 'unavailable'}`);
            }
        }
        selected.sort();
        const memberFingerprint = hash([selected, links, rows, missing]);
        return { target, selected, missing, rows, links, memberFingerprint };
    }
    currentPublicationSummary(resourceId: string) {
        this.assertOpen();
        const current = this.projection(resourceId), row = this.s.one('SELECT id FROM summary_revisions WHERE target_resource=? AND member_fingerprint=?', resourceId, current.memberFingerprint);
        if (!row)
            throw Error('No current local summary revision; prepare a local summary first');
        return this.resolvePublication({ resourceId, revisionId: row.id });
    }
    resolvePublication(input: {
        resourceId: string;
        revisionId: string;
    }) {
        this.assertOpen();
        const current = this.projection(input.resourceId), row = this.s.one('SELECT * FROM summary_revisions WHERE id=? AND target_resource=?', input.revisionId, input.resourceId);
        if (!row)
            throw Error('Retained contribution summary revision missing');
        const data = parse(row.data), members = this.s.all('SELECT observation FROM summary_members WHERE revision=? ORDER BY observation', row.id).map(r => r.observation);
        const bodyHash = createHash('sha256').update(data.body, 'utf8').digest('hex');
        if (!data.complete || current.missing.length || !current.rows.length || row.member_fingerprint !== current.memberFingerprint || data.memberFingerprint !== current.memberFingerprint || hash(members) !== hash(current.selected) || data.payloadHash !== bodyHash || hash(data.target) !== hash(current.target.data.input))
            throw Error('Contribution summary is incomplete/stale or immutable membership/bytes unavailable; prepare current revision');
        const r = current.target;
        return { resourceId: r.id, revisionId: row.id, revision: row.revision, lineageKey: hash(['github.com', r.repository_id, r.repository_node, r.kind, r.resource_id, r.resource_node]), repository: r.data.input.repository, parent: { kind: r.kind as 'issue' | 'pull-request', number: r.number, nodeId: r.resource_node }, memberFingerprint: current.memberFingerprint, body: data.body as string, bodyHash };
    }
    prepare(input: {
        resourceId: string;
        expectedRevision?: number;
    }) {
        this.assertOpen();
        return this.s.tx(() => {
            const { target, selected, missing, rows, memberFingerprint } = this.projection(input.resourceId);
            const latest = this.s.one('SELECT * FROM summary_revisions WHERE target_resource=? ORDER BY revision DESC LIMIT 1', target.id);
            if (input.expectedRevision !== undefined && input.expectedRevision !== (latest?.revision ?? 0))
                throw Error('Summary revision changed');
            const existing = this.s.one('SELECT * FROM summary_revisions WHERE target_resource=? AND member_fingerprint=?', target.id, memberFingerprint);
            if (existing)
                return { ...parse(existing.data), revisionId: existing.id, revision: existing.revision };
            const revision = (latest?.revision ?? 0) + 1, id = randomUUID(), body = rows.length ? `Tracked merge contribution summary revision ${revision}\n\n${rows.join('\n')}\n\nCoverage: tracked native observations only; no whole-workflow or historical authority certification.\n${missing.length ? 'Incomplete: ' + missing.join('; ') : 'All declared facets observed within the native endpoint scope.'}` : 'No merged tracked contributions observed; not a completion record.';
            const data = { resourceId: target.id, target: target.data.input, memberFingerprint, body, payloadHash: createHash('sha256').update(body, 'utf8').digest('hex'), complete: rows.length > 0 && missing.length === 0, missing, contributionCount: rows.filter(v => v.startsWith('PR #')).length, publication: 'not-prepared' };
            this.s.run('INSERT INTO summary_revisions VALUES(?,?,?,?,?)', id, target.id, revision, memberFingerprint, JSON.stringify(data));
            for (const oid of selected)
                this.s.run('INSERT INTO summary_members VALUES(?,?)', id, oid);
            return { ...data, revisionId: id, revision };
        });
    }
    startRefresh() {
        this.assertOpen();
        if (!this.reader)
            throw Error('Configure contribution reader before running refresh');
        if (!this.timer) {
            const refresh = () => {
                if (!this.jobs.size && !this.stopped)
                    void this.refresh().catch(() => { });
            };
            refresh();
            this.timer = setInterval(refresh, 60000);
        }
    }
    async close() {
        this.stopped = true;
        if (this.timer)
            clearInterval(this.timer);
        this.abort.abort();
        await Promise.allSettled([...this.jobs.values()]);
    }
}

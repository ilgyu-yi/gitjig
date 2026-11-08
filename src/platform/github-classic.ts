import { createHash } from 'node:crypto';
import type { NativeJsonTransport, ReadLimits, ReadResponse } from './github-transport.js';
const queries = {
    inventory: `query GitjigClassicInventory($owner:String!,$name:String!,$qualifiedName:String!,$after:String){repository(owner:$owner,name:$name){__typename id nameWithOwner viewerCanAdminister ref(qualifiedName:$qualifiedName){__typename id name prefix target{__typename oid} branchProtectionRule{id}} branchProtectionRules(first:100,after:$after){nodes{__typename id pattern repository{id}} totalCount pageInfo{hasNextPage endCursor}}}}`,
    matching: `query GitjigClassicMatching($id:ID!,$qualifiedName:String!,$after:String){node(id:$id){__typename ... on BranchProtectionRule{id pattern repository{id viewerCanAdminister ref(qualifiedName:$qualifiedName){__typename id name prefix target{__typename oid} branchProtectionRule{id}}} matchingRefs(first:100,after:$after){nodes{__typename id name prefix target{__typename oid}} totalCount pageInfo{hasNextPage endCursor}}}}}`,
} as const;
/** Internal scoped acceptance guard reuses the exact fixed read bodies. */
export function fixedClassicQueryKind(query: unknown): keyof typeof queries {
    for (const kind of ['inventory', 'matching'] as const)
        if (query === queries[kind])
            return kind;
    throw Error('Unsupported native classic query body');
}
export interface GraphQLResponse extends ReadResponse {
    queryHash: string;
}
export type ClassicTransport = (kind: keyof typeof queries, variables: Record<string, string | null>, signal?: AbortSignal) => Promise<GraphQLResponse>;
export function fixedClassicTransport(origin: string, start: NativeJsonTransport): ClassicTransport {
    return async (kind, variables, signal) => {
        if (!Object.hasOwn(queries, kind))
            throw Error('Unsupported fixed GraphQL read');
        const query = queries[kind];
        const response = await start(new URL('/graphql', origin), { method: 'POST', body: Buffer.from(JSON.stringify({ query, variables })) }, signal).response;
        return { ...response, queryHash: createHash('sha256').update(query).digest('hex') };
    };
}
const object = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Classic observation contains a missing or malformed object');
    return value as Record<string, any>;
};
const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('Classic observation contains an unsupported identifier');
    return value;
};
function ref(value: unknown) {
    const row = object(value), target = object(row.target);
    if (row.__typename !== 'Ref' || target.__typename !== 'Commit' || typeof target.oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(target.oid))
        throw Error('Classic target is not an observed commit ref');
    return { id: text(row.id), name: text(row.name), prefix: text(row.prefix), oid: target.oid };
}
export interface ClassicObservation {
    kind: 'visible-classic-inventory';
    repositoryNodeId: string;
    target: ReturnType<typeof ref>;
    viewerCanAdminister?: boolean;
    directRuleId?: string | null;
    rules: readonly {
        id: string;
        pattern: string;
        matchesTarget: boolean;
    }[];
    matchedRuleIds: readonly string[];
    completeVisibleConnections: true;
    visibility: 'not-established';
    absence: 'unknown' | 'present';
    responses: readonly GraphQLResponse[];
    limitations: readonly string[];
}
/** Complete bounded native connections, not an account/token visibility or authority sensor. */
export async function readClassicTarget(transport: ClassicTransport, limits: ReadLimits, input: {
    owner: string;
    name: string;
    branch: string;
    repositoryNodeId: string;
}, signal?: AbortSignal): Promise<ClassicObservation> {
    const repositoryId = text(input.repositoryNodeId), qualifiedName = `refs/heads/${input.branch}`;
    const responses: GraphQLResponse[] = [];
    let bytes = 0, items = 0;
    let selected: ReturnType<typeof ref> | null = null;
    let adminComplete = true, directComplete = true;
    let admin: boolean | undefined, directRuleId: string | null | undefined;
    const corroborate = (repo: Record<string, any>) => {
        if (Object.hasOwn(repo, 'viewerCanAdminister')) {
            if (typeof repo.viewerCanAdminister !== 'boolean' || admin !== undefined && admin !== repo.viewerCanAdminister)
                throw Error('Classic viewer administration changed or malformed');
            admin = repo.viewerCanAdminister;
        }
        else {
            adminComplete = false;
            if (admin !== undefined)
                throw Error('Classic viewer administration disappeared');
        }
        const raw = object(repo.ref);
        if (Object.hasOwn(raw, 'branchProtectionRule')) {
            const value = raw.branchProtectionRule === null ? null : text(object(raw.branchProtectionRule).id);
            if (directRuleId !== undefined && directRuleId !== value)
                throw Error('Classic direct effective rule changed');
            directRuleId = value;
        }
        else {
            directComplete = false;
            if (directRuleId !== undefined)
                throw Error('Classic direct effective rule disappeared');
        }
    };
    const target = (value: unknown) => {
        const valueRef = ref(value);
        if (valueRef.prefix !== 'refs/heads/' || valueRef.name !== input.branch)
            throw Error('Classic target ref identity changed');
        if (selected && JSON.stringify(valueRef) !== JSON.stringify(selected))
            throw Error('Classic target changed during observation');
        selected ??= valueRef;
    };
    const request = async (kind: keyof typeof queries, variables: Record<string, string | null>) => {
        if (responses.length >= limits.pages)
            throw Error('Classic global request allowance exhausted');
        const response = await transport(kind, variables, signal);
        responses.push(response);
        bytes += response.bodyBytes;
        if (bytes > limits.collectionBytes)
            throw Error('Classic global byte allowance exhausted');
        const envelope = object(response.data);
        if (response.status !== 200 || Object.hasOwn(envelope, 'errors'))
            throw Error('Classic GraphQL response incomplete or errored');
        return object(envelope.data);
    };
    const collect = async (page: (after: string | null) => Promise<unknown>, key: (node: Record<string, any>) => string) => {
        const result: Record<string, any>[] = [];
        const ids = new Set<string>(), cursors = new Set<string>();
        let cursor: string | null = null, total: number | null = null;
        for (;;) {
            const connection = object(await page(cursor)), info = object(connection.pageInfo);
            if (!Array.isArray(connection.nodes) || connection.nodes.length > 100 || !Number.isSafeInteger(connection.totalCount) || connection.totalCount < 0 || typeof info.hasNextPage !== 'boolean')
                throw Error('Classic connection shape unsupported');
            if (total !== null && total !== connection.totalCount)
                throw Error('Classic connection count changed');
            total ??= connection.totalCount;
            for (const raw of connection.nodes) {
                const node = object(raw), id = key(node);
                if (ids.has(id))
                    throw Error('Classic connection repeated an identity');
                ids.add(id);
                result.push(node);
                items++;
                if (items > limits.collectionItems || result.length > total!)
                    throw Error('Classic global item allowance or connection count exceeded');
            }
            if (!info.hasNextPage) {
                if (result.length !== total)
                    throw Error('Classic connection omitted advertised items');
                return result;
            }
            const next = text(info.endCursor);
            if (!connection.nodes.length || cursors.has(next))
                throw Error('Classic connection cursor failed to advance');
            cursors.add(next);
            cursor = next;
        }
    };
    const inventory = () => collect(async (after) => {
        const data = await request('inventory', { owner: input.owner, name: input.name, qualifiedName, after }), repo = object(data.repository);
        if (repo.__typename !== 'Repository' || repo.id !== repositoryId || typeof repo.nameWithOwner !== 'string' || repo.nameWithOwner.toLowerCase() !== `${input.owner}/${input.name}`.toLowerCase())
            throw Error('Classic repository identity changed');
        target(repo.ref);
        corroborate(repo);
        return repo.branchProtectionRules;
    }, node => {
        if (node.__typename !== 'BranchProtectionRule' || object(node.repository).id !== repositoryId)
            throw Error('Classic rule has a foreign parent or type');
        text(node.pattern);
        return text(node.id);
    });
    const before = await inventory();
    const rules: {
        id: string;
        pattern: string;
        matchesTarget: boolean;
    }[] = [];
    for (const rule of before) {
        const referenceIds = new Set<string>();
        const references = await collect(async (after) => {
            const data = await request('matching', { id: rule.id, qualifiedName, after }), node = object(data.node), repo = object(node.repository);
            if (node.__typename !== 'BranchProtectionRule' || node.id !== rule.id || node.pattern !== rule.pattern || repo.id !== repositoryId)
                throw Error('Classic matching rule identity changed');
            target(repo.ref);
            corroborate(repo);
            return node.matchingRefs;
        }, node => {
            const reference = ref(node);
            if (reference.prefix !== 'refs/heads/')
                throw Error('Classic matching ref is outside branch scope');
            if (referenceIds.has(reference.id))
                throw Error('Classic matching ref repeated its node identity');
            referenceIds.add(reference.id);
            return reference.prefix + reference.name;
        });
        const match = references.find(value => value.prefix === 'refs/heads/' && value.name === input.branch);
        if (match && JSON.stringify(ref(match)) !== JSON.stringify(selected))
            throw Error('Classic matching target differs from selected ref');
        rules.push({ id: rule.id, pattern: rule.pattern, matchesTarget: !!match });
    }
    const after = await inventory();
    const signature = (rows: Record<string, any>[]) => JSON.stringify(rows.map(row => [row.id, row.pattern, row.repository.id]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    if (signature(before) !== signature(after))
        throw Error('Classic rule inventory changed during observation');
    const matched = rules.filter(rule => rule.matchesTarget).map(rule => rule.id);
    if (directRuleId !== undefined && (directRuleId === null ? matched.length !== 0 : matched.length !== 1 || matched[0] !== directRuleId))
        throw Error('Classic direct/list matching disagreement');
    return { kind: 'visible-classic-inventory', repositoryNodeId: repositoryId, target: selected!, rules, matchedRuleIds: matched,
        ...(!adminComplete || admin === undefined ? {} : { viewerCanAdminister: admin }), ...(!directComplete || directRuleId === undefined ? {} : { directRuleId }), completeVisibleConnections: true, visibility: 'not-established', absence: matched.length ? 'present' : 'unknown', responses,
        limitations: ['Complete visible native connections do not prove visibility of every private rule or write-token authority.',
            'No matching visible rule is not absence proof without a separately demonstrated visibility profile.', 'Repeated reads detect observed drift; no server-atomic policy snapshot is claimed.'] };
}

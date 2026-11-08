import { effective, hash } from './change-files.js';
import type { Manifest } from './capture.js';
import type { Store } from './store.js';
import type { EvidenceVersion } from './verification-strategies.js';
import type { IntegrationResult, ProjectionResult } from '../effects/types.js';

interface NativeProjection {
    baseVersion: string;
    targetId: string;
    basisCommit: string;
    headCommit: string;
    integrationCommit: string;
    tree: string;
    receiptId: string;
}
interface Version extends EvidenceVersion {
    work: string;
    kind: string;
    predecessor: string | null;
    data: EvidenceVersion['data'] & {
        derived?: string;
        producer?: string;
        native?: NativeProjection;
    };
}
interface ReceiptRow {
    id: string;
    sequence: number;
    operation: string;
    kind: string;
    data: string;
}
export interface ProjectionRoot {
    candidate: string;
    digest: string;
    predecessor: string;
    predecessorDigest: string;
    operation: string;
    projectionReceipt: string;
    projectionReceiptHash: string;
    integrationReceipt: string;
    integrationReceiptHash: string;
    tree: string;
}
export interface ScopeBaseView {
    baseId: string;
    baseDigest: string;
    proof: {
        kind: 'native-administrative-elision/v1';
        roots: ProjectionRoot[];
        lineageDigest: string;
        omittedEntries: number;
    };
}
type StoreRead = Pick<Store, 'one' | 'all'>;
type VersionReader = (id: string) => Version;

const administrative = (name: string) => name === '.git' || name.startsWith('.git/');
function selectEntries(manifest: Manifest, administration: boolean) {
    return {
        files: manifest.files.filter(file => administrative(file.path) === administration),
        directories: manifest.directories.filter(directory => administrative(directory.path) === administration),
        dependencyLinks: (manifest.dependencyLinks ?? []).filter(link => administrative(link.path) === administration),
    };
}
function entryIdentity(manifest: Manifest, administration: boolean) {
    // Effective identity reads only these entries, not capture bookkeeping.
    return hash(effective(selectEntries(manifest, administration) as Manifest));
}
function hasAdministration(manifest: Manifest) {
    return [...manifest.files, ...manifest.directories, ...(manifest.dependencyLinks ?? [])]
        .some(entry => administrative(entry.path));
}
function candidateAncestry(work: string, base: Version, candidate: Version, version: VersionReader) {
    const chain: Version[] = [];
    const seen = new Set<string>();
    let node = candidate;
    while (node.id !== base.id) {
        if (seen.has(node.id) || node.work !== work || node.kind !== 'candidate')
            throw Error('Native scope projection ancestry unavailable');
        seen.add(node.id);
        chain.push(node);
        if (!node.predecessor) {
            if (chain.some(value => value.data.derived))
                throw Error('Native scope projection ancestry lacks original BASE');
            break;
        }
        node = version(node.predecessor);
    }
    return chain;
}
function matchingProjectionReceipts(store: StoreRead, projected: Version, previous: Version, base: Version, integration: ReceiptRow | undefined) {
    const native = projected.data.native;
    const receipts: ReceiptRow[] = integration && Number.isSafeInteger(integration.sequence) && integration.sequence > 0
        ? store.all("SELECT rowid AS sequence,* FROM effect_receipts WHERE operation=? AND kind='projection' AND rowid<? ORDER BY rowid", projected.data.producer!, integration.sequence)
        : [];
    // Parse every prior receipt before selecting the oldest match. Later malformed
    // prior records must still refuse; receipts after integration cannot rewrite it.
    return receipts.filter(row => {
        const result: ProjectionResult = JSON.parse(row.data);
        const receipt = result.kind === 'projected' ? result.receipt : undefined;
        return Number.isSafeInteger(row.sequence) && row.sequence > 0 && row.sequence < integration!.sequence
            && result.kind === 'projected' && receipt?.operationId === projected.data.producer
            && receipt!.sourceVersions?.base === base.id && receipt!.sourceVersions?.candidate === previous.id
            && receipt!.sourceDigests?.base === base.hash && receipt!.sourceDigests?.candidate === previous.hash
            && receipt!.basisCommit === native?.basisCommit && receipt!.projectedCommit === native?.headCommit
            && receipt!.projectedTree === native?.tree;
    });
}
function manifestFiles(manifest: Manifest) {
    return manifest.files.map(file => ({ path: file.path, sha256: file.sha256, executable: file.effectiveMode & 0o111 }))
        .sort((a, b) => a.path.localeCompare(b.path));
}
function integrationFiles(result: Extract<IntegrationResult, { kind: 'candidate' }>) {
    if (!Array.isArray(result.files)) return null;
    return result.files.map(file => {
        if (!['100644', '100755'].includes(file.mode))
            throw Error('Native scope projection regular-file profile unavailable');
        return { path: file.path, sha256: file.sha256, executable: Number.parseInt(file.mode, 8) & 0o111 };
    }).sort((a, b) => a.path.localeCompare(b.path));
}

/** Read immutable ancestry and receipts. Current operation phase cannot rewrite a historical projection. */
export function nativeAdministrativeScopeView(store: StoreRead, work: string, base: Version, candidate: Version, version: VersionReader, ordinarySatisfied = false): ScopeBaseView | undefined {
    if (base.work !== work || base.kind !== 'base' || candidate.work !== work || candidate.kind !== 'candidate')
        throw Error('Scope projection selected versions belong to another work or kind');
    const administration = hasAdministration(base.data.manifest);
    const chain = candidateAncestry(work, base, candidate, version);
    const projections = chain.filter(value => value.data.derived).reverse();
    if (!projections.length) return undefined;
    if (!administration) {
        if (projections.every(value => value.data.derived === 'base-integration'
            || ordinarySatisfied && value.data.derived === 'publication-projection')) return undefined;
        throw Error('Unqualified native context projection requires original evidence inspection; no author repair inferred');
    }

    const roots: ProjectionRoot[] = [];
    for (const projected of projections) {
        const previous = version(projected.predecessor!);
        const native = projected.data.native;
        const operation = store.one('SELECT * FROM effect_operations WHERE id=? AND work=?', projected.data.producer!, work);
        const integration: ReceiptRow | undefined = native && store.one('SELECT rowid AS sequence,* FROM effect_receipts WHERE id=?', native.receiptId);
        const result: IntegrationResult | undefined = integration && JSON.parse(integration.data);
        const matches = matchingProjectionReceipts(store, projected, previous, base, integration);
        if (projected.data.derived !== 'publication-projection' || previous.kind !== 'candidate' || previous.work !== work
            || !operation || operation.work !== work || !native || operation.target !== native.targetId || native.baseVersion !== base.id
            || !integration || integration.operation !== operation.id || integration.kind !== 'integration'
            || result?.kind !== 'candidate' || result.tree !== native.tree || result.commit !== native.integrationCommit
            || result.head !== native.headCommit || matches.length === 0)
            throw Error('Native scope projection receipt correspondence unavailable');

        if (hash(manifestFiles(projected.data.manifest)) !== hash(integrationFiles(result))
            || (projected.data.manifest.dependencyLinks?.length ?? 0)
            || entryIdentity(previous.data.manifest, false) !== entryIdentity(projected.data.manifest, false)
            || projected.data.manifest.files.some(file => administrative(file.path))
            || projected.data.manifest.directories.some(directory => administrative(directory.path)))
            throw Error('Native scope projection is not an exact administrative elision');
        if (!roots.length && (!base.data.manifest.directories.some(directory => directory.path === '.git')
            || entryIdentity(base.data.manifest, true) !== entryIdentity(previous.data.manifest, true)))
            throw Error('Native scope projection cannot hide an authored administrative change');
        if (roots.length && (previous.data.manifest.files.some(file => administrative(file.path))
            || previous.data.manifest.directories.some(directory => administrative(directory.path))))
            throw Error('Native scope projection cannot hide recreated administration');

        const projection = matches[0]!;
        roots.push({
            candidate: projected.id, digest: projected.hash,
            predecessor: previous.id, predecessorDigest: previous.hash, operation: operation.id,
            projectionReceipt: projection.id, projectionReceiptHash: hash(projection.data),
            integrationReceipt: integration.id, integrationReceiptHash: hash(integration.data), tree: native.tree,
        });
    }
    return {
        baseId: base.id, baseDigest: base.hash,
        proof: {
            kind: 'native-administrative-elision/v1', roots,
            lineageDigest: hash(chain.map(value => [value.id, value.hash, value.predecessor])),
            omittedEntries: base.data.manifest.files.filter(file => administrative(file.path)).length
                + base.data.manifest.directories.filter(directory => administrative(directory.path)).length,
        },
    };
}

/** Virtual comparison input only. The original captured BASE and actual candidate stay unchanged. */
export function administrativeScopeBaseline(base: Manifest) {
    const result = structuredClone(base);
    const selected = selectEntries(base, false);
    result.files = selected.files;
    result.directories = selected.directories;
    if (base.dependencyLinks) result.dependencyLinks = selected.dependencyLinks;
    result.entries = result.files.length + result.directories.length + (result.dependencyLinks?.length ?? 0);
    result.bytes = result.files.reduce((sum, file) => sum + file.size, 0)
        + (result.dependencyLinks ?? []).reduce((sum, link) => sum + Buffer.byteLength(link.target), 0);
    const { digest: _digest, passes: _passes, ...input } = result;
    result.digest = hash(input);
    return result;
}

import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';
import { parseUniqueJson } from './json.js';
import type { Role } from './types.js';
const names = ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md'] as const;
type AssetName = typeof names[number];
export interface CriteriaDefinition {
    id: string;
    hash: string;
    text: string;
    assets: Record<AssetName, {
        sha256: string;
        selected: string;
    }>;
}
export interface CriteriaDeliveryManifest {
    version: 1;
    kind: 'workflow-criteria';
    id: string;
    workId: string;
    epoch: number;
    role: Role;
    stage: string;
    path: string;
    sha256: string;
    bytes: number;
    records: number;
    arraySha256: string;
    encoding: 'utf8-json-chunks-v1';
    indexStartLine: 2;
    indexLines: number;
}
interface DefinitionRecord {
    id: string;
    side: 'current' | 'prior';
    asset: AssetName;
    section: string;
    text: string;
}
interface DefinitionIdentity {
    id: string;
    hash: string;
    textSha256: string;
    prefix: string;
    assets: Record<AssetName, string>;
}
interface Locator {
    id: string;
    ordinal: number;
    firstLine: number;
    lastLine: number;
    bytes: number;
    sha256: string;
}
export interface CriteriaDeliveryView {
    version: 1 | 2 | 3;
    profile: 'planning-v1' | 'verification-v1' | 'adjudication-v2' | 'planning-v3' | 'fresh-review-v3' | 'source-fit-v3' | 'authoring-v3';
    manifest: CriteriaDeliveryManifest;
    current: {
        id: string;
        hash: string;
        textSha256: string;
    };
    prior: {
        id: string;
        hash: string;
        textSha256: string;
    } | null;
    operatingSha256: string;
    catalogue: (Locator & {
        side: 'current' | 'prior';
        asset: AssetName;
        section: string;
        title: string;
        delivery: 'eager' | 'shared-current' | 'read';
        sharedWith?: string;
    })[];
    additionalChangedBlocks: {
        recordId: string;
        ordinal: number;
        text: string;
    }[];
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const encodedHash = (value: unknown) => hash(JSON.stringify(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = (): never => { throw Error('Original workflow criteria delivery unavailable or corrupt'); };
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function criteriaOperatingProfile(role: Role, stage: unknown, version: unknown = 1): CriteriaDeliveryView['profile'] | undefined {
    if (version === 3) {
        if (role === 'planner' && stage === 'planning' || role === 'challenger' && stage === 'planning-challenge') return 'planning-v3';
        if (role === 'implementer' && stage === 'implementation' || role === 'repairer' && stage === 'substantive-repair') return 'authoring-v3';
        if (role === 'reviewer' && (stage === 'fresh-review' || stage === 'consumer-control-proposal')) return 'fresh-review-v3';
        if (role === 'adjudicator' && stage === 'source-fit') return 'source-fit-v3';
        return;
    }
    if (version === 2)
        return role === 'adjudicator' && (stage === 'planning-adjudication' || stage === 'review-adjudication') ? 'adjudication-v2' : undefined;
    if (version !== 1) return;
    if (role === 'planner' && stage === 'planning' || role === 'challenger' && stage === 'planning-challenge' || role === 'adjudicator' && stage === 'planning-adjudication')
        return 'planning-v1';
    if (role === 'implementer' && stage === 'implementation' || role === 'repairer' && stage === 'substantive-repair' || role === 'reviewer' && stage === 'fresh-review' ||
        role === 'adjudicator' && stage === 'review-adjudication' || role === 'confirmer' && stage === 'exact-nit-confirmation')
        return 'verification-v1';
    return;
}
export function freshCriteriaDeliveryVersion(role: Role, stage: unknown): CriteriaDeliveryView['version'] | undefined {
    return ([3, 2, 1] as const).find(version => criteriaOperatingProfile(role, stage, version));
}
const operatingCores: Partial<Record<CriteriaDeliveryView['profile'], readonly string[]>> = {
    'adjudication-v2': ['C0', 'C2', 'C4'],
    'planning-v3': ['C0', 'C1', 'C2', 'C3'],
    'fresh-review-v3': ['C0', 'C3', 'C4'],
    'source-fit-v3': ['C0', 'C1', 'C2'],
    'authoring-v3': ['C0', 'C2', 'C3', 'C4'],
};
function records(definition: CriteriaDefinition, side: DefinitionRecord['side']) {
    if (!definition || typeof definition.id !== 'string' || !definition.id.trim() || !sha(definition.hash) || typeof definition.text !== 'string' ||
        !object(definition.assets) || !exact(definition.assets, names) || encodedHash(definition.assets) !== definition.hash)
        return invalid();
    const marker = '\n# MISSION.md\n', start = definition.text.indexOf(marker);
    if (start < 0)
        return invalid();
    const prefix = definition.text.slice(0, start), result: DefinitionRecord[] = [];
    for (const asset of names) {
        const data = definition.assets[asset];
        if (!object(data) || !exact(data, ['sha256', 'selected']) || !sha(data.sha256) || typeof data.selected !== 'string' || !data.selected.trim())
            return invalid();
        const pieces = asset === 'DESIGN.md' || asset === 'CONTRACTS.md' ? data.selected.split(/(?=^## [DC]\d+\.)/m) : [data.selected];
        const seen = new Set<string>();
        for (const text of pieces) {
            const section = asset === 'DESIGN.md' || asset === 'CONTRACTS.md' ? /^## ([DC]\d+)\./.exec(text)?.[1] ?? 'preamble' : 'all';
            if (seen.has(section))
                return invalid();
            seen.add(section);
            result.push({ id: `${side}:${asset}:${section}`, side, asset, section, text });
        }
    }
    if (prefix + names.map(name => `\n# ${name}\n${definition.assets[name].selected}`).join('\n') !== definition.text)
        return invalid();
    const identity: DefinitionIdentity = { id: definition.id, hash: definition.hash, textSha256: hash(definition.text), prefix,
        assets: Object.fromEntries(names.map(name => [name, definition.assets[name].sha256])) as DefinitionIdentity['assets'] };
    return { records: result, identity };
}
/** Exact blank-delimited blocks, keeping fenced examples whole. This is a byte
 * change detector, never a semantic relevance or dependency classifier. */
function blocks(text: string) {
    const result: string[] = [];
    let block = '', fence: string | undefined;
    for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length))
            fence = fence ? undefined : marker;
        block += line;
        if (!fence && !line.trim()) {
            result.push(block);
            block = '';
        }
    }
    if (block)
        result.push(block);
    if (fence || result.length > 1024)
        return invalid();
    return result;
}
function changedBlocks(current: string, prior: string) {
    const a = blocks(current), b = blocks(prior), width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    const sameA = new Set<number>(), sameB = new Set<number>();
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            sameA.add(i++);
            sameB.add(j++);
        }
        else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
            i++;
        else
            j++;
    }
    return { current: a.flatMap((text, ordinal) => sameA.has(ordinal) ? [] : [{ ordinal, text }]), prior: b.flatMap((text, ordinal) => sameB.has(ordinal) ? [] : [{ ordinal, text }]) };
}
export function captureCriteriaDeliveryManifest(input: unknown): CriteriaDeliveryManifest {
    const v = input as CriteriaDeliveryManifest;
    if (!object(v) || !exact(v, ['version', 'kind', 'id', 'workId', 'epoch', 'role', 'stage', 'path', 'sha256', 'bytes', 'records', 'arraySha256', 'encoding', 'indexStartLine', 'indexLines']) ||
        v.version !== 1 || v.kind !== 'workflow-criteria' || !uuid(v.id) || typeof v.workId !== 'string' || !v.workId.trim() || !Number.isSafeInteger(v.epoch) || v.epoch < 1 ||
        !freshCriteriaDeliveryVersion(v.role, v.stage) || typeof v.path !== 'string' || !isAbsolute(v.path) || basename(v.path) !== `role-criteria-${v.id}.jsonl` || !sha(v.sha256) || !sha(v.arraySha256) ||
        !Number.isSafeInteger(v.bytes) || v.bytes < 1 || v.bytes > INDEXED_INPUT_EVIDENCE_LIMIT || !Number.isSafeInteger(v.records) || v.records < 4 || v.records > 128 ||
        v.encoding !== 'utf8-json-chunks-v1' || v.indexStartLine !== 2 || v.indexLines !== v.records)
        return invalid();
    return Object.freeze({ ...v });
}
export function workflowCriteriaManifest(context: Record<string, unknown>): CriteriaDeliveryManifest | undefined {
    if (!Object.hasOwn(context, 'workflowCriteria')) {
        if (Object.hasOwn(context, 'workflowCriteriaInput'))
            return invalid();
        return;
    }
    const view = context.workflowCriteria, declaration = context.workflowCriteriaInput;
    if (!object(view) || !object(declaration) || !exact(declaration, ['version', 'id']) || typeof declaration.version !== 'number' || !uuid(declaration.id) || view.version !== declaration.version ||
        !exact(view, ['version', 'profile', 'manifest', 'current', 'prior', 'operatingSha256', 'catalogue', 'additionalChangedBlocks']))
        return invalid();
    const manifest = captureCriteriaDeliveryManifest(view.manifest);
    if (manifest.id !== declaration.id || manifest.stage !== context.stage || !criteriaOperatingProfile(manifest.role, manifest.stage, declaration.version) || view.profile !== criteriaOperatingProfile(manifest.role, manifest.stage, declaration.version) || !sha(view.operatingSha256) ||
        !Array.isArray(view.catalogue) || view.catalogue.length !== manifest.records || !Array.isArray(view.additionalChangedBlocks))
        return invalid();
    for (const identity of [view.current, ...(view.prior === null ? [] : [view.prior])])
        if (!object(identity) || !exact(identity, ['id', 'hash', 'textSha256']) || typeof identity.id !== 'string' || !identity.id.trim() || !sha(identity.hash) || !sha(identity.textSha256))
            return invalid();
    const ids = new Set<string>();
    for (const candidate of view.catalogue) {
        if (!object(candidate))
            return invalid();
        const row = candidate as unknown as CriteriaDeliveryView['catalogue'][number];
        if (!exact(candidate, ['id', 'ordinal', 'firstLine', 'lastLine', 'bytes', 'sha256', 'side', 'asset', 'section', 'title', 'delivery', ...(Object.hasOwn(row, 'sharedWith') ? ['sharedWith'] : [])]) ||
            typeof row.id !== 'string' || ids.has(row.id) || !Number.isSafeInteger(row.ordinal) || row.ordinal < 0 || row.ordinal >= manifest.records ||
            !Number.isSafeInteger(row.firstLine) || row.firstLine < manifest.records + 2 || !Number.isSafeInteger(row.lastLine) || row.lastLine < row.firstLine ||
            !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > manifest.bytes || !sha(row.sha256) || !['current', 'prior'].includes(row.side) ||
            !names.includes(row.asset) || typeof row.section !== 'string' || typeof row.title !== 'string' || !row.title.trim() || row.id !== `${row.side}:${row.asset}:${row.section}` ||
            !['eager', 'shared-current', 'read'].includes(row.delivery) || (row.delivery === 'shared-current') !== Object.hasOwn(row, 'sharedWith') ||
            row.delivery === 'shared-current' && (row.side !== 'prior' || row.sharedWith !== `current:${row.asset}:${row.section}`) ||
            row.delivery === 'eager' && row.side !== 'current')
            return invalid();
        ids.add(row.id);
    }
    const changed = new Set<string>();
    for (const candidate of view.additionalChangedBlocks) {
        if (!object(candidate))
            return invalid();
        const block = candidate as unknown as CriteriaDeliveryView['additionalChangedBlocks'][number];
        if (!exact(candidate, ['recordId', 'ordinal', 'text']) || typeof block.recordId !== 'string' || !ids.has(block.recordId) ||
            !Number.isSafeInteger(block.ordinal) || block.ordinal < 0 || block.ordinal >= 1024 || typeof block.text !== 'string' || !block.text ||
            changed.has(`${block.recordId}:${block.ordinal}`))
            return invalid();
        changed.add(`${block.recordId}:${block.ordinal}`);
    }
    return manifest;
}
export function prepareCriteriaDelivery(current: CriteriaDefinition, prior: CriteriaDefinition | null, input: {
    id: string;
    workId: string;
    epoch: number;
    role: Role;
    stage: string;
    artifactRoot: string;
    version?: CriteriaDeliveryView['version'];
}) {
    const version = input.version ?? 1, profile = criteriaOperatingProfile(input.role, input.stage, version);
    if (!profile || !uuid(input.id))
        return invalid();
    const c = records(current, 'current'), p = prior ? records(prior, 'prior') : null, all = [...c.records, ...(p?.records ?? [])];
    const core = operatingCores[profile];
    const eagerDesign = core ? [] : profile === 'planning-v1' ? ['D4', 'D5'] : ['D4', 'D5', 'D6'];
    if (eagerDesign.some(section => !c.records.some(record => record.asset === 'DESIGN.md' && record.section === section)))
        return invalid();
    const eager = c.records.filter(record => core
        ? record.asset === 'MISSION.md' || record.asset === 'PRINCIPLES.md' || record.asset === 'CONTRACTS.md' && core.includes(record.section)
        : record.asset !== 'DESIGN.md' || record.section === 'preamble' || eagerDesign.includes(record.section));
    if (core?.some(section => !eager.some(record => record.section === section))) return invalid();
    const supplied = core ? `Complete Mission, Principles and Contracts ${core.join('/')}` : `Complete Mission, Principles and selected Contracts, plus core Design ${eagerDesign.join('/')},`;
    const banner = `Workflow criteria operating profile ${profile}. ${supplied} are provided below. Other exact current/prior definitions remain in the registered owned Read artifact. Read every omitted definition or exception needed for your judgment, or hold; unchanged does not mean irrelevant. Availability and hashes do not prove delivery, understanding or compliance. Owner/project requirements remain separate and complete.\n`;
    const parts: (string | {
        record: string;
    })[] = [banner + c.identity.prefix];
    for (const name of names) {
        parts.push(`\n# ${name}\n`);
        for (const record of eager.filter(record => record.asset === name))
            parts.push({ record: record.id });
        if (name !== names.at(-1))
            parts.push('\n');
    }
    const byId = new Map(all.map(record => [record.id, record]));
    const operating = parts.map(part => typeof part === 'string' ? part : byId.get(part.record)!.text).join('');
    const additionalChangedBlocks: CriteriaDeliveryView['additionalChangedBlocks'] = [];
    if (p)
        for (const key of new Set(all.map(record => `${record.asset}:${record.section}`))) {
            const currentRecord = byId.get('current:' + key), priorRecord = byId.get('prior:' + key), change = changedBlocks(currentRecord?.text ?? '', priorRecord?.text ?? '');
            for (const [record, changed] of [[currentRecord, change.current], [priorRecord, change.prior]] as const)
                if (record && !eager.some(item => item.id === record.id))
                    for (const block of changed)
                        additionalChangedBlocks.push({ recordId: record.id, ...block });
        }
    const arraySha256 = encodedHash(all), common = { version: 1 as const, kind: 'workflow-criteria' as const, id: input.id, workId: input.workId, epoch: input.epoch, role: input.role, stage: input.stage,
        records: all.length, arraySha256, encoding: 'utf8-json-chunks-v1' as const, indexStartLine: 2 as const, indexLines: all.length };
    const delivery = all.map(record => {
        const shared = record.side === 'prior' ? c.records.find(other => other.asset === record.asset && other.section === record.section && other.text === record.text && eager.some(item => item.id === other.id)) : undefined;
        return { id: record.id, delivery: eager.some(item => item.id === record.id) ? 'eager' as const : shared ? 'shared-current' as const : 'read' as const, ...(shared ? { sharedWith: shared.id } : {}) };
    });
    const header = { ...common, definitions: { current: c.identity, prior: p?.identity ?? null }, operating: { parts, sha256: hash(operating) }, presentation: { profile, delivery, additionalChangedBlocks } };
    const encoded = indexedJsonRecords(all, record => record.id, header), manifest = captureCriteriaDeliveryManifest({ ...common, path: join(input.artifactRoot, `role-criteria-${input.id}.jsonl`), sha256: hash(encoded.contents), bytes: Buffer.byteLength(encoded.contents) });
    const view: CriteriaDeliveryView = { version, profile, manifest, current: { id: current.id, hash: current.hash, textSha256: hash(current.text) }, prior: prior ? { id: prior.id, hash: prior.hash, textSha256: hash(prior.text) } : null,
        operatingSha256: hash(operating), catalogue: encoded.index.map(locator => {
            const record = byId.get(locator.id)!, captured = delivery.find(item => item.id === record.id)!;
            return { ...locator, side: record.side, asset: record.asset, section: record.section, title: record.text.split('\n').find(line => line.trim()) ?? record.section, ...captured };
        }), additionalChangedBlocks };
    workflowCriteriaManifest({ stage: input.stage, workflowCriteriaInput: { version, id: input.id }, workflowCriteria: view });
    return { operating, view, evidence: { manifest, contents: encoded.contents } };
}
/** Decode the actual recorded recipe and records, never today's profile writer.
 * Returned full text is evidence resolution, not a claim it was initially inline. */
export function resolveCriteriaDelivery(contents: string, view: CriteriaDeliveryView) {
    const manifest = workflowCriteriaManifest({ stage: view.manifest.stage, workflowCriteriaInput: { version: view.version, id: view.manifest.id }, workflowCriteria: view })!;
    if (Buffer.byteLength(contents) !== manifest.bytes || hash(contents) !== manifest.sha256)
        return invalid();
    const lines = contents.split('\n'), header = parseUniqueJson(lines[0]!) as any;
    if (!object(header) || !exact(header, ['version', 'kind', 'id', 'workId', 'epoch', 'role', 'stage', 'records', 'arraySha256', 'encoding', 'indexStartLine', 'indexLines', 'definitions', 'operating', 'presentation']) ||
        !object(header.definitions) || !exact(header.definitions, ['current', 'prior']) || !object(header.operating) || !exact(header.operating, ['parts', 'sha256']) ||
        !object(header.presentation) || !exact(header.presentation, ['profile', 'delivery', 'additionalChangedBlocks']))
        return invalid();
    for (const key of ['version', 'kind', 'id', 'workId', 'epoch', 'role', 'stage', 'records', 'arraySha256', 'encoding', 'indexStartLine', 'indexLines'] as const)
        if (header[key] !== manifest[key])
            return invalid();
    const index = lines.slice(1, 1 + manifest.records).map(line => parseUniqueJson(line) as Locator), byOrdinal = [...index].sort((a, b) => a.ordinal - b.ordinal), decoded: DefinitionRecord[] = [];
    let next = manifest.records + 2;
    for (const [ordinal, locator] of byOrdinal.entries()) {
        if (!object(locator) || !exact(locator, ['id', 'ordinal', 'firstLine', 'lastLine', 'bytes', 'sha256']) || typeof locator.id !== 'string' || !sha(locator.sha256) ||
            !Number.isSafeInteger(locator.bytes) || locator.bytes < 1 || locator.bytes > manifest.bytes || locator.ordinal !== ordinal || locator.firstLine !== next || !Number.isSafeInteger(locator.lastLine) || locator.lastLine < next || locator.lastLine > lines.length)
            return invalid();
        const chunks = lines.slice(next - 1, locator.lastLine).map(line => parseUniqueJson(line) as any);
        next = locator.lastLine + 1;
        if (chunks.some((chunk, i) => !object(chunk) || !exact(chunk, ['ordinal', 'chunk', 'chunks', 'text']) || chunk.ordinal !== ordinal || chunk.chunk !== i + 1 || chunk.chunks !== chunks.length || typeof chunk.text !== 'string'))
            return invalid();
        const raw = chunks.map(chunk => chunk.text).join('');
        if (Buffer.byteLength(raw) !== locator.bytes || hash(raw) !== locator.sha256)
            return invalid();
        const record = parseUniqueJson(raw) as DefinitionRecord;
        if (!object(record) || !exact(record, ['id', 'side', 'asset', 'section', 'text']) || record.id !== locator.id || !['current', 'prior'].includes(record.side) || !names.includes(record.asset) || typeof record.section !== 'string' || typeof record.text !== 'string')
            return invalid();
        decoded.push(record);
    }
    if (next !== lines.length + 1 || encodedHash(decoded) !== manifest.arraySha256 || new Set(decoded.map(record => record.id)).size !== decoded.length)
        return invalid();
    const identities = header.definitions as {
        current: DefinitionIdentity;
        prior: DefinitionIdentity | null;
    }, lookup = new Map(decoded.map(record => [record.id, record]));
    const restore = (side: DefinitionRecord['side'], identity: DefinitionIdentity | null) => {
        if (!identity) {
            if (decoded.some(record => record.side === side))
                return invalid();
            return null;
        }
        if (!object(identity) || !exact(identity, ['id', 'hash', 'textSha256', 'prefix', 'assets']) || typeof identity.prefix !== 'string' || !sha(identity.textSha256) ||
            !object(identity.assets) || !exact(identity.assets, names) || names.some(name => !sha(identity.assets[name])))
            return invalid();
        const assets = Object.fromEntries(names.map(name => [name, { sha256: identity.assets[name], selected: decoded.filter(record => record.side === side && record.asset === name).map(record => record.text).join('') }])) as CriteriaDefinition['assets'];
        const text = identity.prefix + names.map(name => `\n# ${name}\n${assets[name].selected}`).join('\n');
        const definition = { id: identity.id, hash: identity.hash, text, assets }, canonical = records(definition, side);
        if (hash(text) !== identity.textSha256 || encodedHash(canonical.records) !== encodedHash(decoded.filter(record => record.side === side)))
            return invalid();
        return definition;
    };
    const current = restore('current', identities.current), prior = restore('prior', identities.prior);
    if (!current || !Array.isArray(header.operating.parts))
        return invalid();
    const operating = header.operating.parts.map((part: unknown) => typeof part === 'string' ? part : object(part) && exact(part, ['record']) && typeof part.record === 'string' && lookup.has(part.record) ? lookup.get(part.record)!.text : invalid()).join('');
    if (hash(operating) !== header.operating.sha256 || hash(operating) !== view.operatingSha256 || current.id !== view.current.id || current.hash !== view.current.hash || hash(current.text) !== view.current.textSha256 ||
        (prior === null) !== (view.prior === null) || prior && (!view.prior || prior.id !== view.prior.id || prior.hash !== view.prior.hash || hash(prior.text) !== view.prior.textSha256))
        return invalid();
    // Compare with the captured presentation, then verify what its recipe actually
    // supplied. This never calls the current operating-profile writer.
    if (header.presentation.profile !== view.profile || !Array.isArray(header.presentation.delivery) ||
        header.presentation.delivery.length !== decoded.length || encodedHash(header.presentation.additionalChangedBlocks) !== encodedHash(view.additionalChangedBlocks))
        return invalid();
    const eager = new Set<string>();
    for (const part of header.operating.parts)
        if (object(part)) {
            const record = lookup.get(part.record as string);
            if (!record || record.side !== 'current' || eager.has(record.id))
                return invalid();
            eager.add(record.id);
        }
    const delivered = new Set<string>();
    for (const captured of header.presentation.delivery) {
        if (!object(captured) || !exact(captured, ['id', 'delivery', ...(Object.hasOwn(captured, 'sharedWith') ? ['sharedWith'] : [])]) ||
            typeof captured.id !== 'string' || delivered.has(captured.id))
            return invalid();
        const row = view.catalogue.find(item => item.id === captured.id), record = lookup.get(captured.id), locator = index.find(item => item.id === captured.id);
        if (!row || !record || !locator || row.side !== record.side || row.asset !== record.asset || row.section !== record.section || row.title !== (record.text.split('\n').find(line => line.trim()) ?? record.section) ||
            row.delivery !== captured.delivery || row.sharedWith !== captured.sharedWith ||
            ['ordinal', 'firstLine', 'lastLine', 'bytes', 'sha256'].some(key => (row as any)[key] !== (locator as any)[key]) ||
            (captured.delivery === 'eager') !== eager.has(record.id))
            return invalid();
        if (captured.delivery === 'shared-current') {
            const shared = lookup.get(captured.sharedWith as string);
            if (!shared || !eager.has(shared.id) || record.side !== 'prior' || shared.side !== 'current' ||
                shared.asset !== record.asset || shared.section !== record.section || shared.text !== record.text)
                return invalid();
        }
        delivered.add(record.id);
    }
    for (const block of view.additionalChangedBlocks) {
        const record = lookup.get(block.recordId);
        if (!record || eager.has(record.id) || blocks(record.text)[block.ordinal] !== block.text)
            return invalid();
    }
    const expectedChanges: CriteriaDeliveryView['additionalChangedBlocks'] = [];
    if (prior)
        for (const key of new Set(decoded.map(record => `${record.asset}:${record.section}`))) {
            const currentRecord = lookup.get('current:' + key), priorRecord = lookup.get('prior:' + key), change = changedBlocks(currentRecord?.text ?? '', priorRecord?.text ?? '');
            for (const [record, changes] of [[currentRecord, change.current], [priorRecord, change.prior]] as const)
                if (record && !eager.has(record.id))
                    for (const block of changes)
                        expectedChanges.push({ recordId: record.id, ...block });
        }
    if (encodedHash(expectedChanges) !== encodedHash(view.additionalChangedBlocks))
        return invalid();
    return { current, prior, operating };
}

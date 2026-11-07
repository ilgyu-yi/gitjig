import path from 'node:path';
import { createHash } from 'node:crypto';
import type { InputBundle, SourceCatalogue } from './types.js';

function exactKeys(value: object, keys: string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Validate trusted captured metadata; membership alone certifies no source exposure. */
export function sourceCatalogue(bundle: InputBundle): SourceCatalogue | undefined {
    const catalogue = bundle.sourceCatalogue;
    if (catalogue === undefined)
        return undefined;
    if (!catalogue || typeof catalogue !== 'object' || !exactKeys(catalogue, ['format', 'version', 'side', 'files']) || catalogue.format !== 1 ||
        typeof catalogue.version !== 'string' || !catalogue.version || !['base', 'candidate'].includes(catalogue.side) ||
        !Array.isArray(catalogue.files) || catalogue.files.length > 100000)
        throw new Error('Invalid captured source catalogue');
    const expected = bundle.context.candidateVersion ?? bundle.context.baseVersion;
    if (catalogue.version !== expected || catalogue.side !== (bundle.context.candidateVersion ? 'candidate' : 'base'))
        throw new Error('Source catalogue does not describe the staged workspace');
    const files = new Map<string, SourceCatalogue['files'][number]>();
    let bytes = 0;
    for (const file of catalogue.files) {
        if (!file || typeof file !== 'object' || !exactKeys(file, ['path', 'sha256', 'size']) ||
            typeof file.path !== 'string' || !file.path || path.posix.isAbsolute(file.path) || file.path.includes('\\') || file.path.includes('\0') ||
            file.path.split('/').some(part => !part || part === '.' || part === '..') || files.has(file.path) ||
            typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0)
            throw new Error('Invalid captured source catalogue file');
        files.set(file.path, file);
        bytes += file.size;
        if (!Number.isSafeInteger(bytes) || bytes > 512 * 1024 * 1024)
            throw new Error('Source catalogue exceeds captured byte profile');
    }
    const inventory = bundle.context.sourceInventory;
    if (inventory && typeof inventory === 'object') {
        const count = (inventory as Record<string, unknown>)[catalogue.side === 'base' ? 'baseCount' : 'candidateCount'];
        if (count !== undefined && count !== catalogue.files.length)
            throw new Error('Incomplete source catalogue');
    }
    for (const source of bundle.sources) {
        const file = files.get(source.path), id = `${catalogue.side}:${source.path}`;
        if (source.side === catalogue.side || source.id.startsWith(`${catalogue.side}:`)) {
            if (!file || source.id !== id || source.side !== catalogue.side || source.version !== catalogue.version ||
                source.sha256 !== file.sha256 || Buffer.byteLength(source.content) !== file.size ||
                source.toolPath !== undefined && source.toolPath !== source.path)
                throw new Error('Inline source conflicts with captured catalogue');
        }
    }
    return catalogue;
}

export function sourceCatalogueHeader(catalogue: SourceCatalogue) {
    return { format: catalogue.format, version: catalogue.version, side: catalogue.side, count: catalogue.files.length,
        sha256: createHash('sha256').update(JSON.stringify(catalogue)).digest('hex'), idPrefix: `${catalogue.side}:`,
        semantics: 'Metadata for the captured native workspace, not read exposure. Discover project paths with existing tools; successful exact text reads can support assessedScope using idPrefix + relative path and actual inclusive 1-based LF line ranges. Other immutable versions are not mounted by this catalogue.' };
}

import { assessedLineCount, sourceScopeVersion } from '../workflow/source-scope.js';
import path from 'node:path';
import type { Manifest } from './capture.js';
import { effective, hash } from './change-files.js';
import { parseUniqueJson } from '../workflow/json.js';
import { historicalRoleInputBody } from '../workflow/role-input.js';
import { isOwnedRelativeInputPath } from '../workflow/owned-input-path.js';
import type { Role } from '../workflow/types.js';

interface RecordedSource {
    id: string;
    version: string;
    side: string;
    path: string;
    sha256: string;
    exposeInPrompt: boolean;
}
interface InitialBaseSourceInput {
    workId: string;
    role: Role;
    originalBaseVersion: string | null;
    initialText: string;
    initialTextSha256: string;
    source: RecordedSource;
    base: { id: string; work: string; kind: string; hash: string; manifest: Manifest };
    sourceText: string;
}
const unavailable = (reason: string): never => { throw Error('INITIAL_INLINE_BASE_SOURCE_UNAVAILABLE: ' + reason); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const utf8 = (text: unknown): text is string => typeof text === 'string' && Buffer.from(text).toString('utf8') === text;

/** Byte correspondence only. The caller must first authenticate the original
 * selected claim, Native initial message and checkpoint through its existing
 * custody reader. This does not create inputScope, semantic classification,
 * comprehension, carry eligibility or repair authority. No file reads/effects. */
export function qualifyInitialInlineBaseSource(input: InitialBaseSourceInput) {
    const { source, base } = input;
    if (!object(source) || !object(base) || typeof input.workId !== 'string' || !input.workId || base.work !== input.workId ||
        base.kind !== 'base' || typeof base.id !== 'string' || !base.id || base.id !== input.originalBaseVersion ||
        source.side !== 'base' || source.version !== base.id || typeof source.path !== 'string' || !source.path ||
        !isOwnedRelativeInputPath(source.path) || path.posix.normalize(source.path) !== source.path ||
        source.id !== `base:${source.path}` || source.exposeInPrompt !== true)
        return unavailable('original tuple/source/BASE identity');
    if (!utf8(input.initialText) || Buffer.byteLength(input.initialText) > 2 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(input.initialTextSha256) || hash(input.initialText) !== input.initialTextSha256)
        return unavailable('original initial-message bytes');
    if (!object(base.manifest) || !Array.isArray(base.manifest.files) || !Array.isArray(base.manifest.directories) ||
        hash(effective(base.manifest)) !== base.hash)
        return unavailable('immutable BASE manifest binding');
    const files = base.manifest.files.filter(file => file.path === source.path);
    if (files.length !== 1 || !/^[a-f0-9]{64}$/.test(source.sha256) || files[0]!.sha256 !== source.sha256 ||
        !Number.isSafeInteger(files[0]!.size) || files[0]!.size < 0 || !utf8(input.sourceText) ||
        Buffer.byteLength(input.sourceText) !== files[0]!.size || hash(input.sourceText) !== source.sha256)
        return unavailable('BASE file metadata/bytes');
    const body = historicalRoleInputBody(input.initialText, input.role);
    if (body === null) return unavailable('original role input header');
    let header: unknown;
    try { header = parseUniqueJson(body); }
    catch { return unavailable('original role input JSON'); }
    if (!object(header) || !Array.isArray(header.sources)) return unavailable('original source roster');
    const headers = header.sources.filter(row => object(row) && row.id === source.id);
    if (headers.length !== 1 || !object(headers[0]) ||
        ['id', 'version', 'side', 'path', 'sha256', 'exposeInPrompt'].some(key => headers[0]![key] !== source[key as keyof RecordedSource]))
        return unavailable('original source header correspondence');
    const lineCount = input.sourceText.split('\n').length;
    const originalLineCountDeclared = Object.hasOwn(headers[0], 'lineCount');
    if (originalLineCountDeclared && headers[0].lineCount !== lineCount)
        return unavailable('original declared line count');
    if (sourceScopeVersion(object(header.context) ? header.context : {}) === 2 &&
        headers[0].assessedLineCount !== assessedLineCount(input.sourceText, header.context as Record<string, unknown>))
        return unavailable('original declared assessment line count');
    // Walk the actual ordered frame. A delimiter-looking string inside another
    // file is data, and cannot stand in for this source's own inline block.
    const tail = input.initialText.slice(input.initialText.indexOf('\n') + 1 + body.length + 1);
    const ids = new Set<string>();
    let cursor = 0, targetSeen = false;
    for (const row of header.sources) {
        if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.exposeInPrompt !== 'boolean')
            return unavailable('original ordered source roster');
        ids.add(row.id);
        if (!row.exposeInPrompt) continue;
        const marker = `\nSOURCE ${JSON.stringify({ id: row.id })}\n`;
        if (!tail.startsWith(marker, cursor)) return unavailable('original ordered inline frame');
        const start = cursor + marker.length;
        const lines = Object.hasOwn(row, 'lineCount') ? row.lineCount : row.id === source.id ? lineCount : undefined;
        if (!Number.isSafeInteger(lines) || (lines as number) < 1 || (lines as number) > tail.length + 1)
            return unavailable('original inline frame line count');
        let end = start - 1;
        for (let line = 0; line < (lines as number); line++) {
            end = tail.indexOf('\n', end + 1);
            if (end < 0) return unavailable('incomplete original inline bytes');
        }
        if (!tail.startsWith('\nEND SOURCE\n', end)) return unavailable('original inline frame terminator');
        if (row.id === source.id) {
            if (tail.slice(start, end) !== input.sourceText) return unavailable('exact original inline BASE bytes');
            targetSeen = true;
        }
        cursor = end + '\nEND SOURCE\n'.length;
    }
    if (!targetSeen || cursor !== tail.length) return unavailable('complete original inline frame');
    return Object.freeze({ version: 1 as const, workId: input.workId, baseVersion: base.id, baseHash: base.hash,
        sourceId: source.id, sourcePath: source.path, sourceSha256: source.sha256, bytes: files[0]!.size,
        lineCount, originalLineCountDeclared, initialTextSha256: input.initialTextSha256 });
}

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AssessedScope, InputBundle, SourceInput, SourceExposure } from './types.js';
export const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
export const MAX_SOURCE_BYTES = 1024 * 1024;
export function validateBundle(bundle: InputBundle): void {
    const ids = new Set<string>();
    let bytes = 0;
    for (const source of bundle.sources) {
        if (!source.id || !source.version || ids.has(source.id))
            throw new Error('Invalid/duplicate source identity');
        ids.add(source.id);
        for (const p of [source.path, ...(source.toolPath ? [source.toolPath] : [])])
            if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..') || p.includes('\0'))
                throw new Error('Source path must be an owned relative path');
        if (!['base', 'candidate'].includes(source.side) || typeof source.content !== 'string' || source.content.includes('\0') || Buffer.from(source.content).toString('utf8') !== source.content || hashText(source.content) !== source.sha256)
            throw new Error('Source UTF-8/hash mismatch');
        bytes += Buffer.byteLength(source.content);
        if (bytes > MAX_SOURCE_BYTES)
            throw new Error('Source bundle exceeds1MiB text profile');
    }
    for (const scope of bundle.requiredScope) {
        const s = bundle.sources.find(s => s.id === scope.sourceId);
        if (!s || !validScope(scope, s))
            throw new Error('Required scope is outside supplied source');
    }
}
function validScope(scope: AssessedScope, source: SourceInput) { return Number.isSafeInteger(scope.startLine) && Number.isSafeInteger(scope.endLine) && scope.startLine >= 1 && scope.endLine >= scope.startLine && scope.endLine <= source.content.split('\n').length; }
function receipt(launchId: string, source: SourceInput, startLine: number, endLine: number, producer: 'prompt' | 'read', toolCallId?: string): SourceExposure {
    return { launchId, sourceId: source.id, version: source.version, side: source.side, path: source.path, startLine, endLine, sourceSha256: source.sha256, rangeSha256: hashText(source.content.split('\n').slice(startLine - 1, endLine).join('\n')), producer, ...(toolCallId ? { toolCallId } : {}) };
}
export function promptExposures(launchId: string, bundle: InputBundle): SourceExposure[] { return bundle.sources.filter(s => s.exposeInPrompt).map(s => receipt(launchId, s, 1, s.content.split('\n').length, 'prompt')); }
/** Deliberately narrow: only successful native text output matching selected
 * source lines after native rendering. Truncated rendering certifies no omitted bytes. */
export function readExposure(launchId: string, source: SourceInput, args: {
    offset?: unknown;
    limit?: unknown;
}, result: unknown, toolCallId: string): SourceExposure | null {
    if (!result || typeof result !== 'object')
        return null;
    const r = result as {
        content?: {
            type?: string;
            text?: string;
        }[];
        details?: {
            truncation?: {
                truncated?: boolean;
            };
        };
    };
    if (r.details?.truncation?.truncated || !Array.isArray(r.content) || r.content.length !== 1 || r.content[0]?.type !== 'text')
        return null;
    const lines = source.content.split('\n'), start = args.offset ?? 1, limit = args.limit ?? lines.length;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(limit) || (start as number) < 1 || (limit as number) < 1 || (start as number) > lines.length)
        return null;
    const end = Math.min((start as number) - 1 + (limit as number), lines.length);
    const text = lines.slice((start as number) - 1, end).join('\n');
    const expected = end < lines.length ? `${text}\n\n[${lines.length - end} more lines in file. Use offset=${end + 1} to continue.]` : text;
    if (r.content[0]?.text !== expected)
        return null;
    return receipt(launchId, source, start as number, end, 'read', toolCallId);
}
export function exposureIssues(claims: AssessedScope[], required: AssessedScope[], bundle: InputBundle, exposures: SourceExposure[]): string[] {
    const issues: string[] = [];
    function covered(target: AssessedScope, ranges: AssessedScope[]) {
        let next = target.startLine;
        for (const r of ranges.filter(r => r.sourceId === target.sourceId).sort((a, b) => a.startLine - b.startLine)) {
            if (r.startLine > next)
                break;
            if (r.endLine >= next)
                next = r.endLine + 1;
            if (next > target.endLine)
                return true;
        }
        return false;
    }
    for (const claim of claims) {
        const source = bundle.sources.find(s => s.id === claim.sourceId);
        if (!source || !validScope(claim, source) || !covered(claim, exposures.filter(e => e.version === source.version && e.sourceSha256 === source.sha256)))
            issues.push(`UNEXPOSED_SCOPE:${claim.sourceId}:${claim.startLine}-${claim.endLine}`);
    }
    for (const need of required)
        if (!covered(need, claims))
            issues.push(`MISSING_REQUIRED_SCOPE:${need.sourceId}:${need.startLine}-${need.endLine}`);
    return issues;
}

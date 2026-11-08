import { createHash } from 'node:crypto';
/** Exact native read rendering only. A truncated or failed result supplies no range. */
export function renderedReadRange(text: string, args: { offset?: unknown; limit?: unknown }, result: unknown) {
    if (!result || typeof result !== 'object') return null;
    const value = result as { isError?: boolean; content?: { type?: string; text?: string }[]; details?: { truncation?: { truncated?: boolean } } };
    if (value.isError || value.details?.truncation?.truncated || !Array.isArray(value.content) || value.content.length !== 1 || value.content[0]?.type !== 'text') return null;
    const lines = text.split('\n'), start = args.offset ?? 1, limit = args.limit ?? lines.length;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(limit) || (start as number) < 1 || (limit as number) < 1 || (start as number) > lines.length) return null;
    const end = Math.min((start as number) - 1 + (limit as number), lines.length);
    const supplied = lines.slice((start as number) - 1, end).join('\n');
    const expected = end < lines.length ? `${supplied}\n\n[${lines.length - end} more lines in file. Use offset=${end + 1} to continue.]` : supplied;
    if (value.content[0].text !== expected) return null;
    return { startLine: start as number, endLine: end, rangeSha256: createHash('sha256').update(supplied).digest('hex') };
}

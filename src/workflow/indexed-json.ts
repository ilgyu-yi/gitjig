import { createHash } from 'node:crypto';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const INDEXED_INPUT_EVIDENCE_LIMIT = 1024 * 1024;
/** Exact JSON records in bounded physical lines; this grants no file access. */
export function indexedJsonRecords<T>(records: readonly T[], identity: (record: T) => string, header: Record<string, unknown>, labels?: (record: T) => Record<string, string>) {
    const entries = records.map((record, ordinal) => {
        const raw = JSON.stringify(record), parts: string[] = [];
        let part = '', count = 0;
        for (const point of raw) {
            part += point;
            if (++count === 512) { parts.push(part); part = ''; count = 0; }
        }
        if (part) parts.push(part);
        return { id: identity(record), labels: labels?.(record), ordinal, raw, parts };
    });
    let nextLine = records.length + 2;
    const index = entries.map(entry => {
        const firstLine = nextLine; nextLine += entry.parts.length;
        return { id: entry.id, ...entry.labels, ordinal: entry.ordinal, firstLine, lastLine: nextLine - 1, bytes: Buffer.byteLength(entry.raw), sha256: digest(entry.raw) };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const lines = [JSON.stringify(header), ...index.map(row => JSON.stringify(row)),
        ...entries.flatMap(entry => entry.parts.map((text, chunk) => JSON.stringify({ ordinal: entry.ordinal, chunk: chunk + 1, chunks: entry.parts.length, text })))];
    return { contents: lines.join('\n'), index };
}

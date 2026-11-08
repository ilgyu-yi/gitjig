import { createHash } from 'node:crypto';

const format = 'shared-criteria-lines-v1';
const source = 'inputBundle.contracts';
const meaning = 'Previous text is the ordered concatenation of literal strings and exact currentLines ranges from inputBundle.contracts. Ranges are zero-based, end-exclusive; lines retain their original newline characters. Unchanged clauses are shared, not omitted or summarized.';
type Part = string | { currentLines: [number, number] };
interface SharedCriteriaText {
    format: typeof format;
    source: typeof source;
    meaning: typeof meaning;
    currentSha256: string;
    previousSha256: string;
    previousUtf8Bytes: number;
    parts: Part[];
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
const invalid = (): never => { throw Error('Previous criteria text sharing is malformed or does not match its captured definitions'); };

/** Decode only the declared lossless format; corrupt sharing never becomes plain text. */
export function restorePreviousCriteriaText(value: unknown, current: string): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const data = value as SharedCriteriaText;
    const keys = ['format', 'source', 'meaning', 'currentSha256', 'previousSha256', 'previousUtf8Bytes', 'parts'];
    if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key)) ||
        data.format !== format || data.source !== source || data.meaning !== meaning || data.currentSha256 !== digest(current) ||
        typeof data.previousSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(data.previousSha256) ||
        !Number.isSafeInteger(data.previousUtf8Bytes) || data.previousUtf8Bytes < 0 || !Array.isArray(data.parts)) return invalid();
    const currentLines = lines(current), byteOffsets = [0];
    for (const line of currentLines) byteOffsets.push(byteOffsets.at(-1)! + Buffer.byteLength(line));
    const chunks: string[] = [];
    let bytes = 0;
    for (const part of data.parts) {
        if (typeof part === 'string') {
            bytes += Buffer.byteLength(part);
            if (bytes > data.previousUtf8Bytes) return invalid();
            chunks.push(part);
        } else {
            if (!part || typeof part !== 'object' || Array.isArray(part) || Object.keys(part).length !== 1 ||
                !Array.isArray(part.currentLines) || part.currentLines.length !== 2) return invalid();
            const [start, end] = part.currentLines;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > currentLines.length) return invalid();
            bytes += byteOffsets[end]! - byteOffsets[start]!;
            if (bytes > data.previousUtf8Bytes) return invalid();
            chunks.push(currentLines.slice(start, end).join(''));
        }
    }
    const previous = chunks.join('');
    if (bytes !== data.previousUtf8Bytes || digest(previous) !== data.previousSha256) return invalid();
    return previous;
}

/** Linear line interning, not a diff engine. Full immutable versions remain unchanged. */
export function sharePreviousCriteriaText(previous: string, current: string): string | SharedCriteriaText {
    const currentLines = lines(current), first = new Map<string, number>(), parts: Part[] = [];
    currentLines.forEach((line, index) => { if (!first.has(line)) first.set(line, index); });
    let next = 0;
    for (const line of lines(previous)) {
        const index = currentLines[next] === line ? next : first.get(line);
        const last = parts.at(-1);
        if (index === undefined) {
            parts.push(line);
        } else {
            if (last && typeof last !== 'string' && last.currentLines[1] === index) last.currentLines[1]++;
            else parts.push({ currentLines: [index, index + 1] });
            next = index + 1;
        }
    }
    const shared: SharedCriteriaText = { format, source, meaning, currentSha256: digest(current), previousSha256: digest(previous),
        previousUtf8Bytes: Buffer.byteLength(previous), parts };
    if (restorePreviousCriteriaText(shared, current) !== previous) return invalid();
    return Buffer.byteLength(JSON.stringify(shared)) < Buffer.byteLength(JSON.stringify(previous)) ? shared : previous;
}

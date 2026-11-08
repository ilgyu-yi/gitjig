import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';
export const DISPOSITION_HISTORY_LIMIT = INDEXED_INPUT_EVIDENCE_LIMIT;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface DispositionRecord { id: string; occurrence: string; launch: string; status: string; data: unknown; }
export interface DispositionHistoryManifest {
    version: 1 | 2; id: string; workId: string; epoch: number; role: 'adjudicator'; stage: 'planning-adjudication' | 'review-adjudication';
    path: string; sha256: string; bytes: number; records: number; arraySha256: string;
    encoding: 'utf8-json-chunks-v1'; indexStartLine: 2; indexLines: number;
}
/** Detached exact role grammar; an unsupported manifest is never a host-file grant. */
export function captureDispositionHistoryManifest(input: unknown): DispositionHistoryManifest {
    const value = input as DispositionHistoryManifest | null;
    const keys = ['version','id','workId','epoch','role','stage','path','sha256','bytes','records','arraySha256','encoding','indexStartLine','indexLines'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
        !(value.version === 1 && value.stage === 'planning-adjudication' || value.version === 2 && value.stage === 'review-adjudication') || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id) ||
        typeof value.workId !== 'string' || !value.workId.trim() || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || value.role !== 'adjudicator' ||
        typeof value.path !== 'string' || !isAbsolute(value.path) || basename(value.path) !== `role-dispositions-${value.id}.jsonl` ||
        !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{64}$/.test(value.arraySha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > DISPOSITION_HISTORY_LIMIT ||
        !Number.isSafeInteger(value.records) || value.records < 0 || value.indexLines !== value.records || value.indexStartLine !== 2 || value.encoding !== 'utf8-json-chunks-v1') throw Error('Original disposition history manifest unavailable');
    return Object.freeze({ ...value });
}
/** Omit only obsolete diagnostic bookkeeping, never unknown or referenced evidence. */
export function relevantObligationStates(rows: readonly { id: string; data: unknown; [key: string]: unknown }[], referenced: ReadonlySet<string>, pending: ReadonlySet<string>) {
    return rows.filter(row => {
        const data = row.data as { state?: unknown; kind?: unknown } | null;
        return referenced.has(row.id) || pending.has(row.id) || data?.state !== 'resolved' || (data?.kind !== 'diagnostic' && data?.kind !== 'raw-findings-incomplete');
    }).map(row => ({ ...structuredClone(row), currentPending: pending.has(row.id) }));
}
/** Input order is the canonical database rowid order, never an inspection array order. */
export function buildDispositionHistory(input: { id: string; workId: string; epoch: number; artifactRoot: string; stage?: 'planning-adjudication' | 'review-adjudication'; records: readonly DispositionRecord[] }) {
    if (!/^[a-f0-9-]{36}$/.test(input.id) || !input.workId || !Number.isSafeInteger(input.epoch) || input.epoch < 1) throw Error('Disposition history identity unavailable');
    const stage = input.stage ?? 'planning-adjudication', version = stage === 'planning-adjudication' ? 1 : 2;
    if (!['planning-adjudication','review-adjudication'].includes(stage)) throw Error('Disposition history stage unavailable');
    const records = structuredClone(input.records), latest = new Map<string, DispositionRecord>(), seen = new Set<string>();
    for (const record of records) {
        if (!record || ['id', 'occurrence', 'launch', 'status'].some(key => typeof record[key as keyof DispositionRecord] !== 'string' || !String(record[key as keyof DispositionRecord]).trim()) || seen.has(record.id)) throw Error('Disposition history record identity unavailable');
        seen.add(record.id); latest.set(record.occurrence, record);
    }
    const arraySha256 = digest(JSON.stringify(records)), header = { version, kind: 'disposition-history', id: input.id, workId: input.workId, epoch: input.epoch, role: 'adjudicator', stage, encoding: 'utf8-json-chunks-v1', records: records.length, arraySha256, indexStartLine: 2, indexLines: records.length };
    const { contents } = indexedJsonRecords(records, record => record.id, header, record => ({ occurrence: record.occurrence }));
    const bytes = Buffer.byteLength(contents);
    if (bytes > DISPOSITION_HISTORY_LIMIT) throw Error('Disposition history exceeds the supported1MiB evidence read profile; original history retained, nothing clipped');
    const manifest: DispositionHistoryManifest = { version, id: input.id, workId: input.workId, epoch: input.epoch, role: 'adjudicator', stage, path: join(input.artifactRoot, `role-dispositions-${input.id}.jsonl`), sha256: digest(contents), bytes, records: records.length, arraySha256, encoding: 'utf8-json-chunks-v1', indexStartLine: 2, indexLines: records.length };
    captureDispositionHistoryManifest(manifest);
    return { manifest, contents, latest: [...latest.values()] };
}

const latestMeaning = 'Latest disposition data.reason and data.witnesses are read-bound, not absent or initially supplied. indexLines selects the exact original full-record locator in dispositionHistory for each latest row in order. All other fields remain literal. Read any explanation or witness needed for a reversal, shared remedy or conflicting premise, or hold. Availability proves no delivery, comprehension or closure.';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const latestInvalid = (): never => { throw Error('Original latest disposition delivery unavailable or changed'); };

/** A separate prospective view; physical history versions1/2 retain their recipes. */
function latestProfile(context: Record<string, unknown>, role: string | undefined) {
    if (!Object.hasOwn(context, 'latestDispositionInput')) return false;
    const input = context.latestDispositionInput;
    if (role !== 'adjudicator' || (context.stage !== 'planning-adjudication' && context.stage !== 'review-adjudication') ||
        !object(input) || Object.keys(input).join(',') !== 'version' || input.version !== 1) return latestInvalid();
    return true;
}

/** Validate the partial delivery itself, without claiming an unread explanation. */
export function latestDispositionFootprint(context: Record<string, unknown>, role: string | undefined): string | undefined {
    if (!latestProfile(context, role)) return;
    const manifest = captureDispositionHistoryManifest(context.dispositionHistory), rows = context.dispositions;
    const declaration = context.dispositionHistoryInput;
    if (manifest.stage !== context.stage || !Array.isArray(rows) || !object(declaration) || Object.keys(declaration).sort().join(',') !== 'id,version' || declaration.id !== manifest.id || declaration.version !== manifest.version || rows.length > manifest.records || Array.from(rows).some(row => !object(row) || ['id','occurrence','launch','status'].some(key => typeof row[key] !== 'string' || !(row[key] as string).trim())) || new Set(rows.map(row => row.id)).size !== rows.length) return latestInvalid();
    const view = context.latestDispositionView;
    if (Object.hasOwn(context, 'latestDispositionView')) {
        if (!object(view) || Object.keys(view).sort().join(',') !== 'indexLines,meaning,version' || view.version !== 1 || view.meaning !== latestMeaning ||
            !Array.isArray(view.indexLines) || view.indexLines.length !== rows.length || new Set(view.indexLines).size !== rows.length ||
            Array.from(view.indexLines).some(line => !Number.isSafeInteger(line) || line < 2 || line >= manifest.records + 2) ||
            Array.from(rows).some(row => !object(row) || !object(row.data) || Object.hasOwn(row.data, 'reason') || Object.hasOwn(row.data, 'witnesses'))) return latestInvalid();
    }
    return digest(JSON.stringify({ input: context.latestDispositionInput, view: view ?? null, manifest, rows }));
}

/** Only known explanation fields become read-bound; every original record stays exact. */
export function prepareLatestDispositions(context: Record<string, unknown>, role: string | undefined, history: ReturnType<typeof buildDispositionHistory>): Record<string, unknown> {
    if (!latestProfile(context, role)) return context;
    if (Object.hasOwn(context, 'latestDispositionView') || JSON.stringify(context.dispositions) !== JSON.stringify(history.latest) ||
        JSON.stringify(context.dispositionHistory) !== JSON.stringify(history.manifest)) return latestInvalid();
    latestDispositionFootprint(context, role);
    if (!history.latest.length || history.latest.some(row => !object(row.data) || !Object.hasOwn(row.data, 'reason') || !Object.hasOwn(row.data, 'witnesses'))) return context;
    if (Buffer.byteLength(history.contents) !== history.manifest.bytes || digest(history.contents) !== history.manifest.sha256) return latestInvalid();
    const lines = history.contents.split('\n'), index = lines.slice(1, 1 + history.manifest.records).map(line => JSON.parse(line) as { id: string; occurrence: string; ordinal: number; firstLine: number; lastLine: number; bytes: number; sha256: string });
    const indexLines: number[] = [];
    const dispositions = history.latest.map(row => {
        const position = index.findIndex(entry => entry.id === row.id), locator = index[position];
        if (!locator || locator.occurrence !== row.occurrence || index.some(entry => entry.occurrence === row.occurrence && entry.ordinal > locator.ordinal) ||
            !Number.isSafeInteger(locator.firstLine) || !Number.isSafeInteger(locator.lastLine) || locator.firstLine <= index.length + 1 || locator.lastLine < locator.firstLine || locator.lastLine > lines.length) return latestInvalid();
        const chunks = lines.slice(locator.firstLine - 1, locator.lastLine).map(line => JSON.parse(line) as { ordinal: number; chunk: number; chunks: number; text: string });
        if (chunks.some((chunk, i) => chunk.ordinal !== locator.ordinal || chunk.chunk !== i + 1 || chunk.chunks !== chunks.length || typeof chunk.text !== 'string')) return latestInvalid();
        const raw = chunks.map(chunk => chunk.text).join('');
        if (digest(raw) !== locator.sha256 || Buffer.byteLength(raw) !== locator.bytes || raw !== JSON.stringify(row)) return latestInvalid();
        indexLines.push(position + 2);
        return { ...row, data: Object.fromEntries(Object.entries(row.data as Record<string, unknown>).filter(([key]) => key !== 'reason' && key !== 'witnesses')) };
    });
    const projected = { ...context, dispositions, latestDispositionView: { version: 1, meaning: latestMeaning, indexLines } };
    latestDispositionFootprint(projected, role);
    return Buffer.byteLength(JSON.stringify(projected)) < Buffer.byteLength(JSON.stringify(context)) ? projected : context;
}

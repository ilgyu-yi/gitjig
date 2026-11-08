import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';
export const DISPOSITION_HISTORY_LIMIT = INDEXED_INPUT_EVIDENCE_LIMIT;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface DispositionRecord { id: string; occurrence: string; launch: string; status: string; data: unknown; }
export interface DispositionHistoryManifest {
    version: 1; id: string; workId: string; epoch: number; role: 'adjudicator'; stage: 'planning-adjudication';
    path: string; sha256: string; bytes: number; records: number; arraySha256: string;
    encoding: 'utf8-json-chunks-v1'; indexStartLine: 2; indexLines: number;
}
/** Detached exact role grammar; an unsupported manifest is never a host-file grant. */
export function captureDispositionHistoryManifest(input: unknown): DispositionHistoryManifest {
    const value = input as DispositionHistoryManifest | null;
    const keys = ['version','id','workId','epoch','role','stage','path','sha256','bytes','records','arraySha256','encoding','indexStartLine','indexLines'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
        value.version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id) ||
        typeof value.workId !== 'string' || !value.workId.trim() || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || value.role !== 'adjudicator' || value.stage !== 'planning-adjudication' ||
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
export function buildDispositionHistory(input: { id: string; workId: string; epoch: number; artifactRoot: string; records: readonly DispositionRecord[] }) {
    if (!/^[a-f0-9-]{36}$/.test(input.id) || !input.workId || !Number.isSafeInteger(input.epoch) || input.epoch < 1) throw Error('Disposition history identity unavailable');
    const records = structuredClone(input.records), latest = new Map<string, DispositionRecord>(), seen = new Set<string>();
    for (const record of records) {
        if (!record || ['id', 'occurrence', 'launch', 'status'].some(key => typeof record[key as keyof DispositionRecord] !== 'string' || !String(record[key as keyof DispositionRecord]).trim()) || seen.has(record.id)) throw Error('Disposition history record identity unavailable');
        seen.add(record.id); latest.set(record.occurrence, record);
    }
    const arraySha256 = digest(JSON.stringify(records)), header = { version: 1, kind: 'disposition-history', id: input.id, workId: input.workId, epoch: input.epoch, role: 'adjudicator', stage: 'planning-adjudication', encoding: 'utf8-json-chunks-v1', records: records.length, arraySha256, indexStartLine: 2, indexLines: records.length };
    const { contents } = indexedJsonRecords(records, record => record.id, header, record => ({ occurrence: record.occurrence }));
    const bytes = Buffer.byteLength(contents);
    if (bytes > DISPOSITION_HISTORY_LIMIT) throw Error('Disposition history exceeds the supported1MiB evidence read profile; original history retained, nothing clipped');
    const manifest: DispositionHistoryManifest = { version: 1, id: input.id, workId: input.workId, epoch: input.epoch, role: 'adjudicator', stage: 'planning-adjudication', path: join(input.artifactRoot, `role-dispositions-${input.id}.jsonl`), sha256: digest(contents), bytes, records: records.length, arraySha256, encoding: 'utf8-json-chunks-v1', indexStartLine: 2, indexLines: records.length };
    captureDispositionHistoryManifest(manifest);
    return { manifest, contents, latest: [...latest.values()] };
}

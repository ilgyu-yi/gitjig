import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export interface HistoricalPlanManifest {
    version: 1; kind: 'historical-plans'; id: string; workId: string; epoch: number;
    role: 'adjudicator'; stage: 'planning-adjudication'; path: string; sha256: string; bytes: number;
    records: number; arraySha256: string; encoding: 'utf8-json-chunks-v1'; indexStartLine: 2; indexLines: number;
}
export function captureHistoricalPlanManifest(input: unknown): HistoricalPlanManifest {
    const v = input as HistoricalPlanManifest;
    const keys = ['version','kind','id','workId','epoch','role','stage','path','sha256','bytes','records','arraySha256','encoding','indexStartLine','indexLines'];
    if (!object(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) ||
        v.version !== 1 || v.kind !== 'historical-plans' || !uuid(v.id) || typeof v.workId !== 'string' || !v.workId.trim() ||
        !Number.isSafeInteger(v.epoch) || v.epoch < 1 || v.role !== 'adjudicator' || v.stage !== 'planning-adjudication' ||
        typeof v.path !== 'string' || !isAbsolute(v.path) || basename(v.path) !== `role-plans-${v.id}.jsonl` ||
        !/^[a-f0-9]{64}$/.test(v.sha256) || !/^[a-f0-9]{64}$/.test(v.arraySha256) ||
        !Number.isSafeInteger(v.bytes) || v.bytes < 1 || v.bytes > INDEXED_INPUT_EVIDENCE_LIMIT ||
        !Number.isSafeInteger(v.records) || v.records < 1 || v.indexLines !== v.records || v.indexStartLine !== 2 || v.encoding !== 'utf8-json-chunks-v1')
        throw Error('Original historical plan manifest unavailable');
    return Object.freeze({ ...v });
}
/** The declaration is prospective, not inferred from old plan presence. */
export function historicalPlanInputId(context: Record<string, unknown>): string | undefined {
    if (!Object.hasOwn(context, 'historicalPlansInput')) return;
    const value = context.historicalPlansInput;
    if (context.stage !== 'planning-adjudication' || !object(value) || Object.keys(value).sort().join(',') !== 'id,version' || value.version !== 1 || !uuid(value.id))
        throw Error('Historical plan input declaration unavailable');
    return value.id;
}
export function historicalPlanManifest(context: Record<string, unknown>): HistoricalPlanManifest | undefined {
    const id = historicalPlanInputId(context), historical = context.historicalPlanningOperands;
    if (!object(historical) || !Object.hasOwn(historical, 'planBodyEncoding')) return;
    const format = historical.planBodyEncoding;
    if (!id || !object(format) || Object.keys(format).sort().join(',') !== 'manifest,version' || format.version !== 1)
        throw Error('Historical plan body encoding unavailable');
    const manifest = captureHistoricalPlanManifest(format.manifest);
    if (manifest.id !== id) throw Error('Historical plan input identity changed');
    return manifest;
}
/** Keep criteria, source mappings, strategies and unknown fields inline. Only
 * old narrative alternatives and concrete check declarations are read-bound. */
export function prepareHistoricalPlans<T extends { plans: { planHash: string; plan: Record<string, unknown> }[] }>(
    canonical: T, input: { id: string; workId: string; epoch: number; artifactRoot: string }) {
    if (!uuid(input.id) || !input.workId.trim() || !Number.isSafeInteger(input.epoch) || input.epoch < 1 ||
        Object.hasOwn(canonical, 'planBodyEncoding') || Buffer.byteLength(JSON.stringify(canonical)) > 2 * 1024 * 1024)
        throw Error('Historical plans require bounded canonical input');
    const records = structuredClone(canonical.plans), seen = new Set<string>();
    for (const record of records) {
        if (!object(record) || Object.keys(record).sort().join(',') !== 'plan,planHash' || !object(record.plan) ||
            record.planHash !== digest(JSON.stringify(record.plan)) || seen.has(record.planHash)) throw Error('Historical plan identity unavailable');
        seen.add(record.planHash);
    }
    if (!records.length) return { value: canonical, evidence: undefined };
    // An old unknown field must not be overwritten by a new locator grammar.
    if (records.some(({ plan }) => object(plan.verification) && Object.hasOwn(plan.verification, 'checkIndex')))
        return { value: canonical, evidence: undefined };
    const arraySha256 = digest(JSON.stringify(records));
    const header = { version: 1, kind: 'historical-plans', id: input.id, workId: input.workId, epoch: input.epoch,
        role: 'adjudicator', stage: 'planning-adjudication', encoding: 'utf8-json-chunks-v1', records: records.length, arraySha256, indexStartLine: 2, indexLines: records.length };
    const { contents, index } = indexedJsonRecords(records, record => record.planHash, header);
    const manifest: HistoricalPlanManifest = { version: 1, kind: 'historical-plans', id: input.id, workId: input.workId, epoch: input.epoch,
        role: 'adjudicator', stage: 'planning-adjudication', path: join(input.artifactRoot, `role-plans-${input.id}.jsonl`), sha256: digest(contents),
        bytes: Buffer.byteLength(contents), records: records.length, arraySha256, encoding: 'utf8-json-chunks-v1', indexStartLine: 2, indexLines: records.length };
    const locators = new Map(index.map(row => [row.id, row]));
    const plans = records.map(({ planHash, plan }) => {
        const { approach: _approach, simplerAlternative: _alternative, verification, ...inline } = plan;
        let inlinePlan = inline;
        if (object(verification)) {
            const { checks, ...rest } = verification;
            const projectedVerification = Array.isArray(checks) && checks.every(object)
                ? { ...rest, checkIndex: checks.map(check => {
                    const { command: _command, cases: _cases, ...identityAndMapping } = check;
                    return identityAndMapping;
                }) }
                : verification;
            inlinePlan = { ...inline, verification: projectedVerification };
        } else if (Object.hasOwn(plan, 'verification')) inlinePlan = { ...inline, verification };
        return { planHash, inlinePlan, record: locators.get(planHash)! };
    });
    const value = { ...canonical, plans, planBodyEncoding: { version: 1 as const, manifest } };
    if (Buffer.byteLength(JSON.stringify(value)) >= Buffer.byteLength(JSON.stringify(canonical))) return { value: canonical, evidence: undefined };
    // A smaller eager view cannot make an unreadable artifact acceptable.
    captureHistoricalPlanManifest(manifest);
    return { value, evidence: { manifest, contents } };
}

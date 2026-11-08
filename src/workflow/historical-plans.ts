import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export interface HistoricalPlanManifest {
    version: 1 | 2; kind: 'historical-plans'; id: string; workId: string; epoch: number;
    role: 'adjudicator'; stage: 'planning-adjudication' | 'review-adjudication'; path: string; sha256: string; bytes: number;
    records: number; arraySha256: string; encoding: 'utf8-json-chunks-v1'; indexStartLine: 2; indexLines: number;
}
export function captureHistoricalPlanManifest(input: unknown): HistoricalPlanManifest {
    const v = input as HistoricalPlanManifest;
    const keys = ['version','kind','id','workId','epoch','role','stage','path','sha256','bytes','records','arraySha256','encoding','indexStartLine','indexLines'];
    if (!object(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) ||
        !(v.version === 1 && v.stage === 'planning-adjudication' || v.version === 2 && v.stage === 'review-adjudication') || v.kind !== 'historical-plans' || !uuid(v.id) || typeof v.workId !== 'string' || !v.workId.trim() ||
        !Number.isSafeInteger(v.epoch) || v.epoch < 1 || v.role !== 'adjudicator' ||
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
    if (!object(value) || Object.keys(value).sort().join(',') !== 'id,version' || !(context.stage === 'planning-adjudication' && [1, 2, 4].includes(value.version as number) || context.stage === 'review-adjudication' && value.version === 3) || !uuid(value.id))
        throw Error('Historical plan input declaration unavailable');
    return value.id;
}
export function historicalPlanManifest(context: Record<string, unknown>): HistoricalPlanManifest | undefined {
    const id = historicalPlanInputId(context), historical = context.historicalPlanningOperands;
    if (!object(historical) || !Object.hasOwn(historical, 'planBodyEncoding')) return;
    const format = historical.planBodyEncoding;
    if (!id || !object(format))
        throw Error('Historical plan body encoding unavailable');
    if (context.stage === 'review-adjudication' ? format.version !== 3 : format.version === 3) throw Error('Historical plan receiver version changed');
    if ((context.historicalPlansInput as {version:number}).version === 4 && format.version !== 4) throw Error('Historical plan receiver version changed');
    if (format.version === 4) {
        if ((context.historicalPlansInput as {version:number}).version !== 4 || context.stage !== 'planning-adjudication' ||
            Object.keys(format).sort().join(',') !== 'manifest,version' || !Array.isArray(historical.plans) ||
            Array.from(historical.plans).some(row => !object(row) || Object.keys(row).sort().join(',') !== 'inlinePlan,planHash,readBoundFields,record' ||
                typeof row.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.planHash) ||
                !object(row.inlinePlan) || !object(row.record) || row.record.id !== row.planHash ||
                !Array.isArray(row.readBoundFields) || new Set(row.readBoundFields).size !== row.readBoundFields.length ||
                Array.from(row.readBoundFields).some(field => !planFieldReadBound(row.inlinePlan as Record<string,unknown>,field))))
            throw Error('Historical plan read-bound field map unavailable');
    } else if (format.version === 1 || format.version === 3) {
        if (Object.keys(format).sort().join(',') !== 'manifest,version') throw Error('Historical plan body encoding unavailable');
    } else if (format.version === 2) {
        const declaration = context.historicalPlansInput as { version: number };
        const census = format.neverAdoptedWork;
        const hashes = format.readBoundPlanHashes;
        if (declaration.version !== 2 || Object.keys(format).sort().join(',') !== 'manifest,neverAdoptedWork,readBoundPlanHashes,version' ||
            !object(census) || Object.keys(census).sort().join(',') !== 'censusSha256,version' || census.version !== 1 ||
            typeof census.censusSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(census.censusSha256) ||
            !Array.isArray(hashes) || !hashes.length ||
            !Array.isArray(historical.plans) || historical.plans.length !== hashes.length ||
            new Set(hashes).size !== hashes.length ||
            historical.plans.some((row, index) => !object(row) || row.planHash !== hashes[index] ||
                typeof row.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.planHash) ||
                Object.keys(row).some(key => !['planHash', 'recordedIntent', 'record'].includes(key)) || !object(row.record) || row.record.id !== row.planHash))
            throw Error('Historical plan body encoding unavailable');
    } else throw Error('Historical plan body encoding unavailable');
    const manifest = captureHistoricalPlanManifest(format.manifest);
    if (manifest.id !== id || manifest.stage !== context.stage) throw Error('Historical plan input identity changed');
    if(format.version===4 && ((historical.plans as unknown[]).length!==manifest.records || new Set((historical.plans as {planHash:string}[]).map(row=>row.planHash)).size!==manifest.records)) throw Error('Historical plan record census changed');
    return manifest;
}
/** Keep criteria, source mappings, strategies and unknown fields inline. Only
 * old narrative alternatives and concrete check declarations are read-bound in
 * v1. A host-proved wholly pre-adoption work may use v2 for full old records. */
export function prepareHistoricalPlans<T extends { plans: { planHash: string; plan: Record<string, unknown> }[] }>(
    canonical: T, input: { id: string; workId: string; epoch: number; artifactRoot: string; stage?: 'planning-adjudication' | 'review-adjudication'; deliveryVersion?: 4; neverAdoptedWork?: { version: 1; censusSha256: string } }) {
    if (!uuid(input.id) || !input.workId.trim() || !Number.isSafeInteger(input.epoch) || input.epoch < 1 ||
        Object.hasOwn(canonical, 'planBodyEncoding') || Buffer.byteLength(JSON.stringify(canonical)) > 2 * 1024 * 1024)
        throw Error('Historical plans require bounded canonical input');
    const stage = input.stage ?? 'planning-adjudication', version = stage === 'planning-adjudication' ? 1 : 2;
    if (input.deliveryVersion !== undefined && (input.deliveryVersion !== 4 || stage !== 'planning-adjudication' || input.neverAdoptedWork)) throw Error('Historical plan delivery version unavailable');
    if (!['planning-adjudication','review-adjudication'].includes(stage) || stage === 'review-adjudication' && input.neverAdoptedWork) throw Error('Historical plan receiver stage unavailable');
    if (input.neverAdoptedWork && (Object.keys(input.neverAdoptedWork).sort().join(',') !== 'censusSha256,version' ||
        input.neverAdoptedWork.version !== 1 || !/^[a-f0-9]{64}$/.test(input.neverAdoptedWork.censusSha256)))
        throw Error('Historical plan adoption census unavailable');
    const records = structuredClone(canonical.plans), seen = new Set<string>();
    for (const record of records) {
        if (!object(record) || Object.keys(record).sort().join(',') !== 'plan,planHash' || !object(record.plan) ||
            record.planHash !== digest(JSON.stringify(record.plan)) || seen.has(record.planHash)) throw Error('Historical plan identity unavailable');
        seen.add(record.planHash);
    }
    if (!records.length) return { value: canonical, evidence: undefined };
    // An old unknown field must not be overwritten by a new locator grammar.
    if (!input.neverAdoptedWork && records.some(({ plan }) => object(plan.verification) && Object.hasOwn(plan.verification, 'checkIndex')))
        return { value: canonical, evidence: undefined };
    const arraySha256 = digest(JSON.stringify(records));
    const header = { version, kind: 'historical-plans', id: input.id, workId: input.workId, epoch: input.epoch,
        role: 'adjudicator', stage, encoding: 'utf8-json-chunks-v1', records: records.length, arraySha256, indexStartLine: 2, indexLines: records.length };
    const { contents, index } = indexedJsonRecords(records, record => record.planHash, header);
    const manifest: HistoricalPlanManifest = { version, kind: 'historical-plans', id: input.id, workId: input.workId, epoch: input.epoch,
        role: 'adjudicator', stage, path: join(input.artifactRoot, `role-plans-${input.id}.jsonl`), sha256: digest(contents),
        bytes: Buffer.byteLength(contents), records: records.length, arraySha256, encoding: 'utf8-json-chunks-v1', indexStartLine: 2, indexLines: records.length };
    const locators = new Map(index.map(row => [row.id, row]));
    const plans = records.map(({ planHash, plan }) => {
        if (input.neverAdoptedWork) return { planHash,
            ...(Object.hasOwn(plan, 'intent') ? { recordedIntent: plan.intent } : {}), record: locators.get(planHash)! };
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
        if (input.deliveryVersion === 4) {
            // Begin again from the full record so empty and malformed values
            // remain distinguishable from an explicitly deferred field.
            inlinePlan = structuredClone(plan);
            const readBoundFields: string[] = [];
            const defer = (parent: Record<string,unknown>, key: string, field: string) => {
                const value = parent[key];
                if (typeof value === 'string' && value.length > 0 || Array.isArray(value) && value.length > 0 && Array.from(value.keys()).every(index => Object.hasOwn(value,index)) &&
                    (key === 'cases' || Array.from(value).every(item => typeof item === 'string' && item.length > 0))) {
                    delete parent[key]; readBoundFields.push(field);
                }
            };
            for (const key of ['intent','factualSources','approach','simplerAlternative']) defer(inlinePlan,key,'/'+key);
            if (object(inlinePlan.verification)) {
                const v = inlinePlan.verification;
                if (Array.isArray(v.checks) && v.checks.every(object)) {
                    v.checkIndex = v.checks.map((check,i) => {
                        const copy = structuredClone(check);
                        for (const key of ['command','cases']) defer(copy,key,`/verification/checks/${i}/${key}`);
                        return copy;
                    });
                    delete v.checks;
                }
                if (Array.isArray(v.reviewRoles)) v.reviewRoles.forEach((role,i) => {
                    if (object(role)) defer(role,'purpose',`/verification/reviewRoles/${i}/purpose`);
                });
            }
            return { planHash, inlinePlan, record: locators.get(planHash)!, readBoundFields };
        }
        return { planHash, inlinePlan, record: locators.get(planHash)! };
    });
    const planBodyEncoding = input.neverAdoptedWork
        ? { version: 2 as const, manifest, readBoundPlanHashes: records.map(row => row.planHash), neverAdoptedWork: { ...input.neverAdoptedWork } }
        : { version: input.deliveryVersion ?? (stage === 'review-adjudication' ? 3 as const : 1 as const), manifest };
    const value = { ...canonical, plans, planBodyEncoding };
    if (Buffer.byteLength(JSON.stringify(value)) >= Buffer.byteLength(JSON.stringify(canonical))) return { value: canonical, evidence: undefined };
    // A smaller eager view cannot make an unreadable artifact acceptable.
    captureHistoricalPlanManifest(manifest);
    return { value, evidence: { manifest, contents } };
}

/** Only fixed old-plan positions may be absent under the new field map. */
function planFieldReadBound(plan: Record<string,unknown>, field: unknown): boolean {
    if (typeof field !== 'string') return false;
    if (['/intent','/factualSources','/approach','/simplerAlternative'].includes(field)) return !Object.hasOwn(plan,field.slice(1));
    const match = /^\/verification\/(checks|reviewRoles)\/(0|[1-9]\d*)\/(command|cases|purpose)$/.exec(field);
    if (!match || match[1] === 'checks' && match[3] === 'purpose' || match[1] === 'reviewRoles' && match[3] !== 'purpose' || !object(plan.verification)) return false;
    const rows = plan.verification[match[1] === 'checks' ? 'checkIndex' : 'reviewRoles'], index = Number(match[2]);
    return Array.isArray(rows) && Number.isSafeInteger(index) && index < rows.length && object(rows[index]) && !Object.hasOwn(rows[index],match[3]!);
}

const requirementLimit = 2 * 1024 * 1024;
const requirementMeaning = 'Each sole-key requirementsRef at plans[].inlinePlan.requirements selects its exact zero-based array in values. All original definitions are inline once; expand before interpreting historical requirements or source mappings. Plan identities, provenance, applicability and independent decisions stay separate. Shared bytes imply no adopted authority, equivalence or closure.';
const requirementInvalid = (): never => { throw Error('Historical requirement presentation unavailable or changed'); };
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
/** New receiver only; existing physical plan/body profiles retain their meanings. */
export function historicalRequirementsInput(role: string | undefined, context: Record<string, unknown>): boolean {
    if (!Object.hasOwn(context, 'historicalRequirementsInput')) return false;
    const input = context.historicalRequirementsInput;
    if (role !== 'adjudicator' || (context.stage !== 'planning-adjudication' && context.stage !== 'review-adjudication') ||
        !object(input) || Object.keys(input).join(',') !== 'version' || input.version !== 1) return requirementInvalid();
    return true;
}
function requirementSlots(context: Record<string, unknown>): Record<string, unknown>[] {
    const history = context.historicalPlanningOperands;
    if (!object(history) || !Array.isArray(history.plans)) return [];
    return history.plans.flatMap(plan => object(plan) && object(plan.inlinePlan) && Object.hasOwn(plan.inlinePlan, 'requirements') ? [plan.inlinePlan] : []);
}
/** Exact eager JSON-array sharing, never a summary or an old-plan exemption. */
export function presentHistoricalRequirements(context: Record<string, unknown>, role: string | undefined): Record<string, unknown> {
    if (!historicalRequirementsInput(role, context)) return context;
    if (jsonBytes(context) > requirementLimit) return requirementInvalid();
    const history = context.historicalPlanningOperands;
    if (!object(history)) return context;
    if (Object.hasOwn(history, 'requirementsEncoding')) return requirementInvalid();
    const slots = requirementSlots(context);
    if (slots.some(slot => object(slot.requirements) && Object.hasOwn(slot.requirements, 'requirementsRef'))) return context;
    const counts = new Map<string, number>();
    for (const slot of slots) if (Array.isArray(slot.requirements)) {
        const text = JSON.stringify(slot.requirements); counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    const values: unknown[][] = [], indices = new Map<string, number>();
    for (const [text, count] of counts) {
        const refBytes = jsonBytes({ requirementsRef: values.length });
        if (count > 1 && count * (Buffer.byteLength(text) - refBytes) > Buffer.byteLength(text) + 1) {
            indices.set(text, values.length); values.push(JSON.parse(text) as unknown[]);
        }
    }
    if (!values.length) return context;
    const projected = structuredClone(context);
    for (const slot of requirementSlots(projected)) if (Array.isArray(slot.requirements)) {
        const index = indices.get(JSON.stringify(slot.requirements));
        if (index !== undefined) slot.requirements = { requirementsRef: index };
    }
    (projected.historicalPlanningOperands as Record<string, unknown>).requirementsEncoding = { version: 1, meaning: requirementMeaning, values };
    return jsonBytes(projected) < jsonBytes(context) ? projected : context;
}
/** Bound complete expansion before parsing any repeated array. */
export function restoreHistoricalRequirements(context: Record<string, unknown>, role: string | undefined): Record<string, unknown> {
    const declared = historicalRequirementsInput(role, context), history = context.historicalPlanningOperands;
    if (!object(history) || !Object.hasOwn(history, 'requirementsEncoding')) {
        if (declared && jsonBytes(context) > requirementLimit) return requirementInvalid();
        return context;
    }
    if (!declared || jsonBytes(context) > requirementLimit || !Array.isArray(history.plans)) return requirementInvalid();
    const encoding = history.requirementsEncoding;
    if (!object(encoding) || Object.keys(encoding).sort().join(',') !== 'meaning,values,version' || encoding.version !== 1 || encoding.meaning !== requirementMeaning ||
        !Array.isArray(encoding.values) || !encoding.values.length || Array.from(encoding.values).some(value => !Array.isArray(value))) return requirementInvalid();
    const literals = encoding.values.map(value => JSON.stringify(value)), lengths = literals.map(text => Buffer.byteLength(text));
    if (new Set(literals).size !== literals.length) return requirementInvalid();
    const { requirementsEncoding: _encoding, ...literalHistory } = history;
    const literalContext = { ...context, historicalPlanningOperands: literalHistory }, used = new Set<number>();
    const indexOf = (value: unknown): number | undefined => {
        if (!object(value) || !Object.hasOwn(value, 'requirementsRef')) return;
        const index = value.requirementsRef;
        if (Object.keys(value).join(',') !== 'requirementsRef' || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= literals.length) return requirementInvalid();
        used.add(index); return index;
    };
    let expandedBytes = jsonBytes(literalContext);
    for (const slot of requirementSlots(context)) {
        const index = indexOf(slot.requirements);
        if (index !== undefined) expandedBytes += lengths[index]! - jsonBytes(slot.requirements);
        if (expandedBytes > requirementLimit) return requirementInvalid();
    }
    if (used.size !== literals.length) return requirementInvalid();
    // JSON wire values cannot retain shared object aliases between plan positions.
    const restored = JSON.parse(JSON.stringify(literalContext)) as Record<string, unknown>;
    for (const slot of requirementSlots(restored)) {
        const index = indexOf(slot.requirements);
        if (index !== undefined) slot.requirements = JSON.parse(literals[index]!);
    }
    return restored;
}

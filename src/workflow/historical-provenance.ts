import { createHash } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { indexedJsonRecords, INDEXED_INPUT_EVIDENCE_LIMIT } from './indexed-json.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
const invalid = (): never => { throw Error('Historical producer provenance unavailable or changed'); };
const meaning = 'Known run/session/raw-digest, checkpoint and initial-message size/hash proof details may be read-bound. Missing proof fields mean read-bound, never absent or verified by the reader. Native/user entry IDs, full materialSource, roles/status/epochs/version tuples, presentation modes, all INITIAL source/body/normative memberships and unknown fields remain literal. indexLines maps each producer in order to its exact original full-record locator. Records use the unchanged common census representation, bound by censusSha256, not raw Native messages. Read any needed proof detail or hold; availability proves no comprehension, validity, independence or closure.';
const membershipMeaning = 'Version2 keeps producer/source/role/status/version tuples, materialSource, user entry, source-set correspondence and unknown fields literal. Each producer.readBoundFields contains zero-based positions in readBoundPaths naming its exact omitted original fields; an absent field without that map entry is original absence, and a literal empty array stays empty. Known INITIAL body rosters and normative-membership lists may be read-bound along with custody proof. Read any needed original exposure or normative membership from that exact full record or hold. Decode retrieved index vectors only against the unchanged ordered census/dictionaries bound by censusSha256. No unread field was initially supplied, understood, validated or resolved; never infer old exposure from current claims. indexLines locates unchanged full derived records, not raw Native messages.';
const custodyFields = ['/runId','/nativeSessionId','/outputRawSha256','/checkpoint','/initialView/textUtf8Bytes','/initialView/textSha256','/initialView/metadataIdentities/fieldFootprintSha256','/initialView/workflowCriteria/sha256','/initialView/workflowCriteria/operatingSha256'];
const membershipFields = ['/initialView/occurrenceIndexes','/initialView/findingBodySuppliedIndexes','/initialView/findingBodyOmittedIndexes','/initialView/workflowCriteria/eagerRecordIds','/initialView/workflowCriteria/readBoundRecordIds','/initialView/workflowCriteria/sharedCurrentRecords'];
const readBoundPaths = [...custodyFields,...membershipFields];
function fieldAt(value: Record<string,unknown>, path: string): {parent:Record<string,unknown>;key:string} | undefined {
    const parts=path.slice(1).split('/');let parent=value;
    for(const key of parts.slice(0,-1)){if(!object(parent[key]))return;parent=parent[key];}
    return {parent,key:parts.at(-1)!};
}
export interface HistoricalProvenanceManifest {
    version: 1 | 2; kind: 'historical-producer-provenance'; id: string; workId: string; epoch: number;
    role: 'adjudicator'; stage: 'planning-adjudication' | 'review-adjudication'; path: string;
    sha256: string; bytes: number; records: number; arraySha256: string; censusSha256: string;
    encoding: 'utf8-json-chunks-v1'; indexStartLine: 2; indexLines: number;
}
const censusHash = (history: Record<string, unknown>) => hash({ present: Object.hasOwn(history, 'censusEncoding') && history.censusEncoding !== undefined, value: history.censusEncoding ?? null });
export function historicalProvenanceInputId(context: Record<string, unknown>): string | undefined {
    if (!Object.hasOwn(context, 'historicalProvenanceInput')) return;
    const value = context.historicalProvenanceInput;
    if ((context.stage !== 'planning-adjudication' && context.stage !== 'review-adjudication') || !object(value) || !exact(value, ['version', 'id']) ||
        !(value.version === 1 || value.version === 2 && context.stage === 'planning-adjudication') || !uuid(value.id)) return invalid();
    return value.id;
}
export function captureHistoricalProvenanceManifest(input: unknown): HistoricalProvenanceManifest {
    const value = input as HistoricalProvenanceManifest;
    if (!object(value) || !exact(value, ['version','kind','id','workId','epoch','role','stage','path','sha256','bytes','records','arraySha256','censusSha256','encoding','indexStartLine','indexLines']) ||
        !(value.version === 1 || value.version === 2 && value.stage === 'planning-adjudication') || value.kind !== 'historical-producer-provenance' || !uuid(value.id) || typeof value.workId !== 'string' || !value.workId.trim() || !Number.isSafeInteger(value.epoch) || value.epoch < 1 ||
        value.role !== 'adjudicator' || (value.stage !== 'planning-adjudication' && value.stage !== 'review-adjudication') || typeof value.path !== 'string' || !isAbsolute(value.path) || basename(value.path) !== `role-provenance-${value.id}.jsonl` ||
        !sha(value.sha256) || !sha(value.arraySha256) || !sha(value.censusSha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > INDEXED_INPUT_EVIDENCE_LIMIT ||
        !Number.isSafeInteger(value.records) || value.records < 1 || value.indexStartLine !== 2 || value.indexLines !== value.records || value.encoding !== 'utf8-json-chunks-v1') return invalid();
    return Object.freeze({ ...value });
}
/** Partial delivery is explicit. This never restores unread original proof. */
export function historicalProvenanceManifest(context: Record<string, unknown>): HistoricalProvenanceManifest | undefined {
    const id = historicalProvenanceInputId(context), history = context.historicalPlanningOperands;
    // Unknown legacy keys without the new declaration keep their literal meaning.
    if (!id || !object(history) || !Object.hasOwn(history, 'producerProvenance')) return;
    const view = history.producerProvenance;
    const version=(context.historicalProvenanceInput as {version:1|2}).version;
    if (!object(view) || !exact(view, version===2?['version','meaning','manifest','indexLines','readBoundPaths']:['version','meaning','manifest','indexLines']) || view.version !== version || view.meaning !== (version===2?membershipMeaning:meaning) || !Array.isArray(history.producers) || !Array.isArray(view.indexLines)) return invalid();
    const manifest = captureHistoricalProvenanceManifest(view.manifest), rows = Array.from(history.producers);
    if (manifest.id !== id || manifest.version !== version || manifest.stage !== context.stage || manifest.censusSha256 !== censusHash(history) || rows.length !== manifest.records || view.indexLines.length !== rows.length ||
        new Set(view.indexLines).size !== rows.length || Array.from(view.indexLines).some(line => !Number.isSafeInteger(line) || line < 2 || line >= manifest.records + 2) ||
        rows.some(row => !object(row) || typeof row.outputId !== 'string' || !row.outputId || !object(row.initialView) || ['runId','nativeSessionId','outputRawSha256'].some(key => Object.hasOwn(row,key)) ||
            ['textUtf8Bytes','textSha256'].some(key => Object.hasOwn(row.initialView as Record<string,unknown>,key))) || new Set(rows.map(row => (row as Record<string,unknown>).outputId)).size !== rows.length) return invalid();
    if(version===2 && (JSON.stringify(view.readBoundPaths)!==JSON.stringify(readBoundPaths)||rows.some(row=>{
        const fields=(row as Record<string,unknown>).readBoundFields;
        return !Array.isArray(fields)||new Set(fields).size!==fields.length||Array.from(fields).some(index=>{
            if(!Number.isSafeInteger(index)||index<0||index>=readBoundPaths.length)return true;
            const slot=fieldAt(row as Record<string,unknown>,readBoundPaths[index]!);
            return !slot||Object.hasOwn(slot.parent,slot.key);
        });
    })))return invalid();
    return manifest;
}
function header(producer: unknown): Record<string, unknown> | undefined {
    if (!object(producer) || !['outputId','launchId','nativeEntryId','role','stage','producerStatus','launchStatus','runId','nativeSessionId'].every(key => typeof producer[key] === 'string' && !!producer[key]) ||
        !sha(producer.outputRawSha256) || !object(producer.initialView) || typeof producer.initialView.userEntryId !== 'string' || !producer.initialView.userEntryId ||
        !Number.isSafeInteger(producer.initialView.textUtf8Bytes) || (producer.initialView.textUtf8Bytes as number) < 0 || !sha(producer.initialView.textSha256)) return;
    const result = structuredClone(producer), initial = result.initialView as Record<string,unknown>;
    for (const key of ['runId','nativeSessionId','outputRawSha256']) delete result[key];
    const checkpoint = result.checkpoint;
    // Unknown checkpoint fields are never deleted or assigned new meaning.
    if (object(checkpoint) && exact(checkpoint, ['sessionId','leafId','bytes','sha256']) && typeof checkpoint.sessionId === 'string' && checkpoint.sessionId && typeof checkpoint.leafId === 'string' && checkpoint.leafId &&
        Number.isSafeInteger(checkpoint.bytes) && (checkpoint.bytes as number) >= 0 && sha(checkpoint.sha256)) delete result.checkpoint;
    delete initial.textUtf8Bytes; delete initial.textSha256;
    if (object(initial.metadataIdentities) && sha(initial.metadataIdentities.fieldFootprintSha256)) delete initial.metadataIdentities.fieldFootprintSha256;
    if (object(initial.workflowCriteria)) for (const key of ['sha256','operatingSha256']) if (sha(initial.workflowCriteria[key])) delete initial.workflowCriteria[key];
    return result;
}
function captured(value: unknown, evidence: {manifest:HistoricalProvenanceManifest;contents:string} | undefined, canonical: unknown) {
    const delivered = hash({value:value??null}), source = hash({value:canonical??null});
    const artifact = hash(evidence ?? null);
    return {value,evidence,assertCurrent:(current: unknown)=>{
        if(hash({value:current??null})!==delivered || hash({value:value??null})!==delivered || hash({value:canonical??null})!==source || hash(evidence??null)!==artifact) return invalid();
    }};
}
/** Same derived records/census, one authenticated artifact; no second authority store. */
export function prepareHistoricalProvenance(canonical: unknown, input: { id: string; workId: string; epoch: number; stage: string; artifactRoot: string; version?:1|2 }) {
    if (!uuid(input.id) || !input.workId.trim() || !Number.isSafeInteger(input.epoch) || input.epoch < 1 || (input.stage !== 'planning-adjudication' && input.stage !== 'review-adjudication')) return invalid();
    const version=input.version??1;
    if(version!==1&&(version!==2||input.stage!=='planning-adjudication'))return invalid();
    if (!object(canonical) || !Array.isArray(canonical.producers) || !canonical.producers.length) return captured(canonical,undefined,canonical);
    if (Object.hasOwn(canonical, 'producerProvenance')) return invalid();
    const records = Array.from(canonical.producers, producer => structuredClone(producer)), producers = records.map(header);
    if (producers.some(row => row === undefined) || new Set(records.map(row => row.outputId)).size !== records.length) return captured(canonical,undefined,canonical);
    if(version===2){
        if(records.some(row=>Object.hasOwn(row,'readBoundFields')))return captured(canonical,undefined,canonical);
        const census=object(canonical.censusEncoding)?canonical.censusEncoding:undefined, dictionary=census?.occurrenceIdDictionary;
        producers.forEach((row,i)=>{
            for(const path of membershipFields){
                const slot=fieldAt(row!,path);if(!slot)continue;const value=slot.parent[slot.key];
                if(!Array.isArray(value)||!value.length)continue;
                const safe=path.endsWith('Indexes') ? Array.isArray(dictionary)&&Array.from(value).every(v=>Number.isSafeInteger(v)&&v>=0&&v<dictionary.length)
                    : path.endsWith('sharedCurrentRecords') ? Array.from(value).every(v=>object(v)&&exact(v,['id','sharedWith'])&&typeof v.id==='string'&&!!v.id&&typeof v.sharedWith==='string'&&!!v.sharedWith)
                    : Array.from(value).every(v=>typeof v==='string'&&!!v);
                if(safe)delete slot.parent[slot.key];
            }
            row!.readBoundFields=readBoundPaths.flatMap((path,index)=>{
                const before=fieldAt(records[i],path),after=fieldAt(row!,path);
                return before&&Object.hasOwn(before.parent,before.key)&&(!after||!Object.hasOwn(after.parent,after.key))?[index]:[];
            });
        });
    }
    const common = { version, kind: 'historical-producer-provenance' as const, id: input.id, workId: input.workId, epoch: input.epoch, role: 'adjudicator' as const, stage: input.stage,
        records: records.length, arraySha256: hash(records), censusSha256: censusHash(canonical), encoding: 'utf8-json-chunks-v1' as const, indexStartLine: 2 as const, indexLines: records.length };
    const encoded = indexedJsonRecords(records, record => record.outputId, common), bytes = Buffer.byteLength(encoded.contents);
    // An optional representation must not make an existing literal input unavailable.
    if (bytes > INDEXED_INPUT_EVIDENCE_LIMIT) return captured(canonical,undefined,canonical);
    const manifest = captureHistoricalProvenanceManifest({ ...common, path: join(input.artifactRoot, `role-provenance-${input.id}.jsonl`), bytes, sha256: createHash('sha256').update(encoded.contents).digest('hex') });
    const indexLines = records.map(record => encoded.index.findIndex(locator => locator.id === record.outputId) + 2);
    const value = { ...canonical, producers, producerProvenance: { version, meaning:version===2?membershipMeaning:meaning, manifest, indexLines, ...(version===2?{readBoundPaths}: {}) } };
    if (Buffer.byteLength(JSON.stringify(value)) >= Buffer.byteLength(JSON.stringify(canonical))) return captured(canonical,undefined,canonical);
    historicalProvenanceManifest({ stage: input.stage, historicalProvenanceInput: {version,id:input.id}, historicalPlanningOperands:value });
    return captured(value,{manifest,contents:encoded.contents},canonical);
}

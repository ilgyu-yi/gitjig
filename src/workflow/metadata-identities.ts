import { createHash } from 'node:crypto';
import type { Role } from './types.js';

const limit = 2 * 1024 * 1024;
// Frozen v1 discriminator: clarify current guidance elsewhere. Changing this
// grammar or the field positions below requires a separately supported version.
const meaning = 'Version1 host metadata identities: {ref:index} selects the exact full string in ids, only in declared identity fields. All original identities and field positions remain. Finding bodies, reasons, witnesses, raw diagnostics, owner intent, proposals and normative text stay literal. Use full original IDs in role output, never indexes or reference wrappers.';
const reviewMeaning = 'Version2 host metadata identities and digests: {ref:index} selects the exact full string in ids, only at declared metadata positions. Finding bodies, reasons, witnesses, raw observations, owner intent, historical definitions and normative text remain literal. Select full original strings for outputs; indexes and reference wrappers are not output IDs or evidence of equivalence, validity or closure.';
const actionMeaning = 'Version3 host metadata uses the same stage-specific lossless identity positions as version1 planning or version2 review. {ref:index} selects the exact original string in ids, not an output subject key. The prospective subjectActionsView supplies the separate sN action namespace: each displayed subjectKey selects exactly one fresh body or its captured retain choice. Equivalent targets use ordinary subject keys. All other identity/evidence operands stay original literal strings. Reasons, witnesses, owner intent, source bodies and normative text are never rewritten. Original raw replies and canonical host identities remain distinct and source-bound.';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
// The wire has JSON value semantics. structuredClone preserves aliases, which
// could let a metadata edit also change an unselected semantic array/object.
const cloneJson = (value: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(value));
const invalid = (): never => { throw Error('Original metadata identity presentation unavailable or corrupt'); };
type Location = (string | number)[];
type Container = Record<string, any> | any[];

type IdentityVersion = 1 | 2 | 3 | 4;
export function metadataIdentityInput(role: Role, context: Record<string, unknown>): { version: IdentityVersion } | undefined {
    if (!Object.hasOwn(context, 'metadataIdentityInput')) return;
    const value = context.metadataIdentityInput;
    if (!object(value) || Object.keys(value).join(',') !== 'version' ||
        !(value.version === 1 && (role === 'planner' && context.stage === 'planning' || role === 'challenger' && context.stage === 'planning-challenge' || role === 'adjudicator' && context.stage === 'planning-adjudication') ||
          value.version === 2 && role === 'adjudicator' && context.stage === 'review-adjudication' ||
          value.version === 3 && role === 'adjudicator' && (context.stage === 'planning-adjudication' || context.stage === 'review-adjudication') &&
          object(context.subjectActionsInput) && Object.keys(context.subjectActionsInput).join(',') === 'version' && context.subjectActionsInput.version === 1 ||
          value.version === 4 && role === 'adjudicator' && context.stage === 'planning-adjudication' && !Object.hasOwn(context,'subjectActionsInput'))) return invalid();
    return Object.freeze({ version: value.version as IdentityVersion });
}
const fieldVersion = (input: {version:IdentityVersion}, context: Record<string,unknown>): 1|2 => input.version === 4 ? 1 : input.version === 3 ? context.stage === 'review-adjudication' ? 2 : 1 : input.version;
const inputMeaning = (version:1|2|3) => version === 1 ? meaning : version === 2 ? reviewMeaning : actionMeaning;

/** Frozen v1 metadata positions, never arbitrary keys or semantic text. */
function visit(context: Record<string, unknown>, act: (container: Container, key: string | number, path: Location) => void, version: 1 | 2 = 1) {
    const fields = (value: any, path: Location, keys: string[]) => {
        if (object(value)) for (const key of keys) if (Object.hasOwn(value, key)) act(value, key, [...path, key]);
    };
    const each = (value: any, path: Location, key: string, consume: (row: any, path: Location) => void) => {
        if (Array.isArray(value?.[key])) value[key].forEach((row: any, index: number) => consume(row, [...path, key, index]));
    };
    const ids = (value: any, path: Location, key: string) => {
        if (Array.isArray(value?.[key])) value[key].forEach((_: unknown, index: number) => act(value[key], index, [...path, key, index]));
    };
    const versions = (value: any, path: Location) => fields(value, path, ['contracts', 'requirements', 'base', 'candidate', 'plan', 'verification']);
    const scope = (value: any, path: Location) => {
        fields(value, path, ['workId', 'launchId', 'runId', 'outputId']);
        versions(value?.inputVersions, [...path, 'inputVersions']);
        for (const key of ['occurrenceIds', 'findingBodyOmittedIds', 'findingBodySuppliedIds']) ids(value, path, key);
        each(value, path, 'selectedSources', (row, p) => fields(row, p, ['version']));
    };
    each(context, [], 'occurrences', (row, p) => { fields(row, p, ['id', 'output', 'work']); fields(row?.data, [...p, 'data'], ['launchId']); });
    each(context, [], 'dispositions', (row, p) => { fields(row, p, ['id', 'occurrence', 'launch']); fields(row?.data, [...p, 'data'], ['occurrenceId', 'equivalentTo']); });
    each(context, [], 'pendingObligations', (row, p) => fields(row, p, ['id', 'occurrence']));
    each(context, [], 'obligationStates', (row, p) => { fields(row, p, ['id', 'work']); fields(row?.data, [...p, 'data'], ['occurrence']); });
    for (const key of ['plannerInputScope', 'challengerInputScope']) scope(context[key], [key]);
    const h = context.historicalPlanningOperands as any, path = ['historicalPlanningOperands'];
    each(h, path, 'links', (row, p) => fields(row, p, ['occurrenceId', 'observationOutputId', 'producerOutputId', 'plannerOutputId']));
    each(h, path, 'producers', (row, p) => {
        fields(row, p, ['outputId', 'launchId', 'runId', 'nativeSessionId']);
        versions(row?.inputVersions, [...p, 'inputVersions']);
        fields(row?.checkpoint, [...p, 'checkpoint'], ['sessionId']);
        scope(row?.initialView, [...p, 'initialView']);
    });
    ids(h?.censusEncoding, [...path, 'censusEncoding'], 'occurrenceIds');
    each(h?.censusEncoding, [...path, 'censusEncoding'], 'sourceSets', (set, p) => {
        if (Array.isArray(set)) set.forEach((row, index) => fields(row, [...p, index], ['version']));
    });

    if (version !== 2) return;
    // Frozen review-v2 additions: host identity/digest positions only. Never
    // descend by arbitrary key names into raw, findings or plan definitions.
    fields(context, [], ['ownerSource','baseVersion','candidateVersion','planVersion','verificationVersion']);
    ids(context, [], 'requirementSourceIds');
    const manifest = (value: any, p: Location) => fields(value,p,['id','workId','sha256','arraySha256']);
    for (const key of ['historicalPlansInput','dispositionHistoryInput','workflowCriteriaInput']) fields(context[key],[key],['id']);
    manifest(context.dispositionHistory,['dispositionHistory']);
    manifest(h?.planBodyEncoding?.manifest,[...path,'planBodyEncoding','manifest']);
    each(h,path,'links',(row,p)=>fields(row,p,['planHash']));
    each(h,path,'plans',(row,p)=>{fields(row,p,['planHash']);fields(row?.record,[...p,'record'],['id','sha256']);});
    each(h,path,'producers',(row,p)=>{
        fields(row,p,['outputRawSha256']);fields(row?.checkpoint,[...p,'checkpoint'],['sha256']);
        fields(row?.initialView,[...p,'initialView'],['textSha256']);
        fields(row?.initialView?.metadataIdentities,[...p,'initialView','metadataIdentities'],['fieldFootprintSha256']);
        fields(row?.materialSource,[...p,'materialSource'],['corroboratingOutputId']);
        fields(row?.materialSource?.source,[...p,'materialSource','source'],['nativeSessionId','rawSha256']);
    });
    ids(h?.censusEncoding,[...path,'censusEncoding'],'occurrenceIdDictionary');
    each(h?.censusEncoding,[...path,'censusEncoding'],'sourceSets',(set,p)=>{
        if(Array.isArray(set))set.forEach((row,index)=>fields(row,[...p,index],['sha256']));
    });
    const inventory=context.sourceInventory as any;
    ids(inventory,['sourceInventory'],'completeManifestRefs');
    for(const key of ['baseSample','candidateSample'])each(inventory,['sourceInventory'],key,(row,p)=>fields(row,p,['sha256']));
    const receipt=(row:any,p:Location)=>{
        fields(row,p,['id','work','run','candidate','verification']);
        fields(row?.data,[...p,'data'],['inputHash']);versions(row?.data?.boundVersions,[...p,'data','boundVersions']);
        fields(row?.data?.target,[...p,'data','target'],['versionId','digest','candidateAtDispatch']);
        fields(row?.data?.caseResults,[...p,'data','caseResults'],['checkBinding','descriptorHash']);
        fields(row?.data?.caseDescriptor,[...p,'data','caseDescriptor'],['checkBinding']);
        for(const key of ['consumerFiles','fixtureFiles'])each(row?.data?.caseDescriptor,[...p,'data','caseDescriptor'],key,(file,q)=>fields(file,q,['sha256']));
    };
    each(context,[],'checks',receipt);each(context,[],'verificationEvidence',receipt);
    const selected=context.selectedReviewEvidence as any;
    fields(selected,['selectedReviewEvidence'],['binding']);
    each(selected,['selectedReviewEvidence'],'reviews',(row,p)=>{
        fields(row,p,['launchId','runId','outputId','rawSha256']);versions(row?.inputVersions,[...p,'inputVersions']);
        fields(row?.native,[...p,'native'],['sessionId']);fields(row?.native?.checkpoint,[...p,'native','checkpoint'],['sessionId','sha256']);
    });
}


/** Canonical current identities for the prospective literal keyed composition.
 * Reuse the owned positions; never inspect arbitrary claim/evidence values. */
export function assertLiteralMetadataIdentities(role: Role, context: Record<string, unknown>): void {
    if (role !== 'adjudicator' || !(context.stage === 'planning-adjudication' || context.stage === 'review-adjudication') ||
        Object.hasOwn(context, 'metadataIdentityInput') || Object.hasOwn(context, 'metadataIdentityEncoding') || bytes(context) > limit) return invalid();
    visit(cloneJson(context), (container, key) => {
        const value = (container as any)[key];
        if (value !== null && typeof value !== 'string') return invalid();
    }, context.stage === 'review-adjudication' ? 2 : 1);
}

/** Private source capture includes exact field positions, not only dictionary membership. */
export function metadataIdentityFootprint(role: Role, context: Record<string, unknown>): string | undefined {
    const input = metadataIdentityInput(role, context);
    const literal = object(context.subjectActionsInput) && context.subjectActionsInput.version === 2;
    if (!input && !literal) return;
    if (literal) assertLiteralMetadataIdentities(role, context);
    if (Object.hasOwn(context, 'metadataIdentityEncoding') || bytes(context) > limit) return invalid();
    const fields: unknown[] = [];
    visit(cloneJson(context), (container, key, path) => fields.push([path, (container as any)[key]]),
        literal ? context.stage === 'review-adjudication' ? 2 : 1 : fieldVersion(input!,context));
    return createHash('sha256').update(JSON.stringify({ version: literal ? 'literal-subject-actions2' : input!.version, fields })).digest('hex');
}

/** Wire only: unchanged semantic literals and schema/output IDs are never rewritten. */
export function presentMetadataIdentities(role: Role, context: Record<string, unknown>): Record<string, unknown> {
    const input = metadataIdentityInput(role, context);
    if (!input) return context;
    if (Object.hasOwn(context, 'metadataIdentityEncoding')) return invalid();
    const originalBytes = bytes(context);
    if (originalBytes > limit) return invalid();
    if (input.version === 4) return context;
    const counts = new Map<string, number>(); let collision = false;
    visit(context, (container, key) => {
        const value = (container as any)[key];
        if (object(value) && Object.hasOwn(value, 'ref')) collision = true;
        if (typeof value === 'string' && value.length >= 16) counts.set(value, (counts.get(value) ?? 0) + 1);
    }, fieldVersion(input,context));
    // Original unknown metadata must never silently acquire reference semantics.
    if (collision) return context;
    const ids = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    if (!ids.length) return context;
    const positions = new Map(ids.map((id, index) => [id, index])), projected = cloneJson(context);
    visit(projected, (container, key) => {
        const value = (container as any)[key];
        if (typeof value === 'string' && positions.has(value)) (container as any)[key] = { ref: positions.get(value) };
    }, fieldVersion(input,context));
    projected.metadataIdentityEncoding = { version: input.version, meaning: inputMeaning(input.version), ids };
    return bytes(projected) < originalBytes ? projected : context;
}

/** Decode before other semantic interpretation. Bound expansion before cloning. */
export function restoreMetadataIdentities(role: Role, context: Record<string, unknown>): Record<string, unknown> {
    if (!Object.hasOwn(context, 'metadataIdentityEncoding')) {
        if (object(context.metadataIdentityInput) && context.metadataIdentityInput.version === 4) {
            metadataIdentityInput(role,context);
            if (bytes(context) > limit) return invalid();
        }
        return context;
    }
    const input = metadataIdentityInput(role, context);
    if (!input) return context;
    if (input.version === 4 || bytes(context) > limit) return invalid();
    const encoding = context.metadataIdentityEncoding;
    if (!object(encoding) || Object.keys(encoding).sort().join(',') !== 'ids,meaning,version' || encoding.version !== input.version || encoding.meaning !== inputMeaning(input.version) ||
        !Array.isArray(encoding.ids) || !encoding.ids.length || Array.from(encoding.ids).some(id => typeof id !== 'string' || !id.length) || new Set(encoding.ids).size !== encoding.ids.length) return invalid();
    const ids = encoding.ids as string[], identities = new Set(ids), lengths = ids.map(id => bytes(id)), used = new Set<number>();
    const { metadataIdentityEncoding: _encoding, ...literal } = context;
    let expanded = bytes(literal);
    const reference = (value: unknown): number | undefined => {
        if (!object(value) || !Object.hasOwn(value, 'ref')) return;
        if (Object.keys(value).join(',') !== 'ref' || typeof value.ref !== 'number' || !Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= ids.length) return invalid();
        return value.ref;
    };
    visit(literal, (container, key) => {
        const value = (container as any)[key], index = reference(value);
        if (typeof value === 'string' && identities.has(value)) return invalid();
        if (index === undefined) return;
        used.add(index); expanded += lengths[index]! - bytes(value);
    }, fieldVersion(input,context));
    if (used.size !== ids.length || expanded > limit) return invalid();
    const restored = cloneJson(literal);
    visit(restored, (container, key) => {
        const index = reference((container as any)[key]);
        if (index !== undefined) (container as any)[key] = ids[index];
    }, fieldVersion(input,context));
    return restored;
}

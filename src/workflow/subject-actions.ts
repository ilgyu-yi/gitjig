import { createHash } from 'node:crypto';
import { parseUniqueJson } from './json.js';
import { assertLiteralMetadataIdentities } from './metadata-identities.js';
import { restoreFindingBodies } from './finding-body-presentation.js';
import { adjudicationDecisionReferences, captureDecisionReferences } from './role-input.js';
import type { DecisionReferences, Role } from './types.js';

/** Prospective wire recipe only. Callers must still bind the original request,
 * source tuple and schema, then run the complete canonical protocol validators.
 * Selection requires a prospective declaration; historical absence stays literal. */
export interface SubjectActionProfile {
    readonly version: 1 | 2;
    readonly role: 'adjudicator';
    readonly stage: 'planning-adjudication' | 'review-adjudication';
    readonly referencesSha256: string;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (reason: string): never => { throw Error('Subject action recipe unavailable: ' + reason); };
const impossible = () => ({ type: 'object', not: { type: 'object' } });
const isImpossible = (value: unknown) => object(value) && value.type === 'object' && object(value.not) && value.not.type === 'object' && Object.keys(value).length === 2 && Object.keys(value.not).length === 1;

function references(input: DecisionReferences) {
    const refs = captureDecisionReferences(input);
    if (refs.version !== 3 || Array.from(refs.occurrenceIds).some(id => typeof id !== 'string')) return invalid('version3 dense domain required');
    return refs;
}
export function createSubjectActionProfile(stage: SubjectActionProfile['stage'], input: DecisionReferences, version: SubjectActionProfile['version'] = 1): SubjectActionProfile {
    return captureSubjectActionProfile({ version, role: 'adjudicator', stage, referencesSha256: digest(references(input)) }, input);
}
export function captureSubjectActionProfile(input: unknown, domain: DecisionReferences): SubjectActionProfile {
    if (!object(input) || Object.keys(input).sort().join(',') !== 'referencesSha256,role,stage,version' || ![1, 2].includes(input.version as number) || input.role !== 'adjudicator' ||
        !(input.stage === 'planning-adjudication' || input.stage === 'review-adjudication') || typeof input.referencesSha256 !== 'string' || input.referencesSha256 !== digest(references(domain)))
        return invalid('profile or original reference domain changed');
    return Object.freeze({ version: input.version as 1 | 2, role: 'adjudicator', stage: input.stage, referencesSha256: input.referencesSha256 });
}
/** Original raw output commits to its exact map, even for synchronous consumers
 * which do not reopen the complete Native input at every canonical decode. */
export function subjectActionResponseHash(profile: SubjectActionProfile, input: DecisionReferences): string {
    return digest(captureSubjectActionProfile(profile, input));
}
function domain(profile: SubjectActionProfile, input: DecisionReferences) {
    const refs = references(input);
    captureSubjectActionProfile(profile, refs);
    const keys = refs.occurrenceIds.map((_, index) => 's' + index);
    const subjects = new Map(keys.map((key, index) => [key, refs.occurrenceIds[index]!]));
    const byId = new Map(refs.occurrenceIds.map((id, index) => [id, keys[index]!]));
    const synthetic = new Set(refs.diagnosisOccurrenceIds);
    const targets = new Map([...subjects].filter(([, id]) => !synthetic.has(id)));
    const retention = new Map(refs.retentionChoices.map(row => [row.occurrenceId, row.dispositionId]));
    return { refs, keys, subjects, byId, targets, retention };
}

/** A small, exact model-facing lookup; absence is not a retention choice. */
export function subjectActionView(profile: SubjectActionProfile, input: DecisionReferences, baseVersion?: string) {
    const { refs, keys, retention } = domain(profile, input);
    return Object.freeze({
        version: profile.version, referencesSha256: profile.referencesSha256,
        responseHash: subjectActionResponseHash(profile,input),
        subjects: Object.freeze(refs.occurrenceIds.map((occurrenceId, index) => Object.freeze({ key: keys[index]!, occurrenceId,
            ...(retention.has(occurrenceId) ? { retainDispositionId: retention.get(occurrenceId)! } : {}) }))),
        pendingOrdinaryKeys: Object.freeze(refs.pendingOrdinaryIndexes.map(index => keys[index]!)),
        ...(baseVersion !== undefined ? { implementationBaseVersion: baseVersion } : {}),
    });
}

export function subjectActionInputVersion(role: Role, context: ObjectValue): 1 | 2 | undefined {
    if (!Object.hasOwn(context, 'subjectActionsInput')) return;
    const value = context.subjectActionsInput;
    if (role !== 'adjudicator' || !(context.stage === 'planning-adjudication' || context.stage === 'review-adjudication') ||
        !object(value) || Object.keys(value).join(',') !== 'version' || ![1, 2].includes(value.version as number))
        return invalid('assigned declaration requires ordinary adjudication');
    if (value.version === 1) {
        if (!object(context.metadataIdentityInput) || Object.keys(context.metadataIdentityInput).join(',') !== 'version' || context.metadataIdentityInput.version !== 3)
            return invalid('assigned declaration requires ordinary adjudication and metadata3');
    } else assertLiteralMetadataIdentities(role, context);
    return value.version as 1 | 2;
}
function originalBase(context: ObjectValue): string | undefined {
    const value = Object.hasOwn(context, 'baseVersion') ? context.baseVersion : object(context.inputVersions) ? context.inputVersions.base : undefined;
    if (value === undefined) return;
    if (typeof value !== 'string' || !value.length) return invalid('original base unavailable');
    return value;
}
function literalSubjects(role: Role, context: ObjectValue) {
    const rows = JSON.parse(JSON.stringify(restoreFindingBodies(context, role).occurrences ?? null));
    if (!Array.isArray(rows) || rows.some(row => !object(row) || !object(row.data) || !Object.hasOwn(row.data, 'finding')))
        return invalid('complete literal subject bodies unavailable');
    return rows;
}
export function prepareSubjectActionInput(role: Role, context: ObjectValue): ObjectValue {
    const version = subjectActionInputVersion(role, context);
    if (!version) return context;
    if (Object.hasOwn(context, 'subjectActionsProfile') || Object.hasOwn(context, 'subjectActionsView')) return invalid('reserved input view collision');
    const refs = adjudicationDecisionReferences(role, context);
    if (!refs) return invalid('original decision references missing');
    const profile = createSubjectActionProfile(context.stage as SubjectActionProfile['stage'], refs, version);
    const view = subjectActionView(profile, refs, originalBase(context));
    const keys = new Map(view.subjects.map(row => [row.occurrenceId, row.key]));
    if (!Array.isArray(context.occurrences) || context.occurrences.length !== keys.size ||
        new Set(context.occurrences.map(row => object(row) ? row.id : undefined)).size !== keys.size)
        return invalid('complete subject display unavailable');
    const occurrences = Array.from(context.occurrences).map(row => {
        if (!object(row) || typeof row.id !== 'string' || !keys.has(row.id) || Object.hasOwn(row, 'subjectKey')) return invalid('subject display collision or foreign row');
        return { ...row, subjectKey: keys.get(row.id)! };
    });
    const prepared = { ...context, occurrences, subjectActionsProfile: profile, subjectActionsView: view };
    if (version === 2) adjudicationSubjectActions(role, prepared);
    return prepared;
}
/** Read original captured operands, never synthesize a missing historical recipe. */
export function adjudicationSubjectActions(role: Role, context: ObjectValue): SubjectActionProfile | undefined {
    const version = subjectActionInputVersion(role, context);
    if (!version) return;
    const refs = adjudicationDecisionReferences(role, context);
    if (!refs) return invalid('original decision references missing');
    const profile = captureSubjectActionProfile(context.subjectActionsProfile, refs);
    if (profile.version !== version || profile.stage !== context.stage || !object(context.subjectActionsView) || digest(context.subjectActionsView) !== digest(subjectActionView(profile, refs, originalBase(context))))
        return invalid('original subject view changed');
    if (version === 2 && !Object.hasOwn(context, 'occurrences')) return invalid('complete literal subjects unavailable');
    if (Object.hasOwn(context, 'occurrences')) {
        const keys = new Map(refs.occurrenceIds.map((id, index) => [id, 's' + index]));
        if (!Array.isArray(context.occurrences) || context.occurrences.length !== keys.size ||
            new Set(context.occurrences.map(row => object(row) ? row.id : undefined)).size !== keys.size ||
            Array.from(context.occurrences).some(row => !object(row) || typeof row.id !== 'string' || !keys.has(row.id) || row.subjectKey !== keys.get(row.id)))
            return invalid('original subject display changed');
    }
    if (version === 2) literalSubjects(role, context);
    return profile;
}
export function subjectActionFootprint(role: Role, context: ObjectValue): string | undefined {
    const profile = adjudicationSubjectActions(role, context);
    if (!profile) return;
    return digest({ profile, view: context.subjectActionsView,
        ...(profile.version === 2 ? { occurrences: literalSubjects(role, context) } : {}) });
}

/** A known subject is present in the canonical decision even though the new
 * wire body omits it. Bind its predicates before erasing that field. */
function matchesSubject(rule: unknown, id: string): boolean {
    if (!object(rule) || Object.keys(rule).some(key => !['type', 'enum', 'const', 'minLength', 'maxLength', 'description'].includes(key)) || rule.type !== 'string')
        return invalid('unsupported subject predicate');
    if (Object.hasOwn(rule, 'const') && rule.const !== id) return false;
    if (Object.hasOwn(rule, 'enum') && (!Array.isArray(rule.enum) || !rule.enum.includes(id))) return false;
    if (typeof rule.minLength === 'number' && id.length < rule.minLength) return false;
    if (typeof rule.maxLength === 'number' && id.length > rule.maxLength) return false;
    return true;
}
function bindSubject(value: unknown, id: string): unknown {
    if (Array.isArray(value)) return value.map(child => bindSubject(child, id));
    if (!object(value)) return value;
    const result: ObjectValue = {};
    for (const [key, child] of Object.entries(value)) {
        if (['enum', 'const', 'description'].includes(key)) result[key] = clone(child);
        else if (key === 'properties' && object(child)) {
            if (Object.hasOwn(child, 'occurrenceId') && !matchesSubject(child.occurrenceId, id)) return impossible();
            result.properties = Object.fromEntries(Object.entries(child).filter(([name]) => name !== 'occurrenceId').map(([name, schema]) => [name, bindSubject(schema, id)]));
        } else if (key === 'required' && Array.isArray(child)) result.required = child.filter(name => name !== 'occurrenceId');
        else result[key] = bindSubject(child, id);
    }
    if (isImpossible(result.if)) {
        if (Object.hasOwn(result, 'else')) return invalid('unsupported subject else predicate');
        delete result.if; delete result.then;
    }
    return result;
}
function shortTargets(value: unknown, byId: ReadonlyMap<string, string>): unknown {
    if (Array.isArray(value)) return value.map(child => shortTargets(child, byId));
    if (!object(value)) return value;
    const result: ObjectValue = {};
    for (const [key, child] of Object.entries(value)) {
        if (['enum', 'const', 'description'].includes(key)) result[key] = clone(child);
        else if (key === 'properties' && object(child) && Object.hasOwn(child, 'equivalentTo')) {
            const target = child.equivalentTo;
            if (!object(target) || target.type !== 'string' || !Array.isArray(target.enum) || target.enum.some(id => typeof id !== 'string' || !byId.has(id)))
                return invalid('finite equivalent target domain required');
            const members = target.enum as string[];
            result.properties = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, name === 'equivalentTo'
                ? { ...clone(target), enum: members.map(id => byId.get(id)!), description: 'Exact ordinary subject key from subjectActionsView, not a literal identity or metadata dictionary index. Independent equivalence, cycle and source checks still apply.' }
                : shortTargets(schema, byId)]));
        } else result[key] = shortTargets(child, byId);
    }
    return result;
}

/** Nonrecursive draft07 definitions share only fully identical bound bodies.
 * The returned schema is guidance; canonical parsing remains mandatory. */
export function subjectActionSchema(canonical: ObjectValue, profile: SubjectActionProfile, input: DecisionReferences): ObjectValue {
    const d = domain(profile, input), result = clone(canonical);
    if (result.type !== 'object' || !object(result.properties) || !Array.isArray(result.required) || !object(result.properties.decisions) ||
        !object(result.properties.decisions.items) || Object.hasOwn(result.properties, 'decisionActions') || Object.hasOwn(result.properties,'subjectActionsHash') || Object.hasOwn(result, 'definitions') || Object.hasOwn(result, '$defs'))
        return invalid('canonical decision schema required');
    const item = result.properties.decisions.items, definitions: ObjectValue = {}, bodies = new Map<string, string>();
    const define = (body: unknown) => {
        const text = JSON.stringify(body);
        let name = bodies.get(text);
        if (!name) { name = 'SubjectDecision' + bodies.size; bodies.set(text, name); definitions[name] = body; }
        return { type: 'object', $ref: '#/definitions/' + name };
    };
    const properties: ObjectValue = {};
    for (const [key, id] of d.subjects) {
        const fresh = define(shortTargets(bindSubject(item, id), d.byId));
        properties[key] = d.retention.has(id) ? { anyOf: [fresh, { type: 'string', const: 'retain' }] } : fresh;
    }
    delete result.properties.decisions;
    delete result.properties.retainedDispositions;
    if (object(result.properties.findings))
        result.properties.findings.description = 'Report genuinely new findings only. Use decisionActions for already supplied subjects; do not reissue a retained judgment as a new finding.';
    result.properties.decisionActions = { type: 'object', properties, additionalProperties: false };
    result.properties.subjectActionsHash = { type: 'string', const: subjectActionResponseHash(profile,input), description: 'Echo the exact original subjectActionsView.responseHash constant. It binds these short keys to their original captured subjects and choices; it is not a verdict.' };
    result.required = [...result.required.map(name => name === 'decisions' ? 'decisionActions' : name).filter(name => name !== 'retainedDispositions'),'subjectActionsHash'];
    // Acceptance predicates can be nested inside then/allOf, not just the
    // first then. Leaving a predicate on the erased array would make it vacuous.
    const rewriteConditions = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rewriteConditions);
        if (!object(value)) return value;
        const rewritten: ObjectValue = {};
        for (const [key, child] of Object.entries(value)) {
            if (['enum', 'const', 'description'].includes(key)) rewritten[key] = clone(child);
            else if (key === 'properties' && object(child)) {
                if (Object.hasOwn(child, 'retainedDispositions')) return invalid('unsupported conditional retention constraint');
                const fields = { ...child };
                if (Object.hasOwn(fields, 'decisions')) {
                    const acceptance = fields.decisions;
                    if (!object(acceptance) || Object.keys(acceptance).some(name => !['type', 'minItems', 'items', 'description'].includes(name)) ||
                        acceptance.type !== 'array' || acceptance.minItems !== d.refs.pendingOrdinaryIndexes.length || !object(acceptance.items))
                        return invalid('unsupported acceptance decision constraint');
                    const accepted: ObjectValue = {};
                    for (const [subject, id] of d.subjects) accepted[subject] = { if: { type: 'object' }, then: define(shortTargets(bindSubject(acceptance.items, id), d.byId)) };
                    delete fields.decisions;
                    fields.decisionActions = { type: 'object', required: d.refs.pendingOrdinaryIndexes.map(index => d.keys[index]!), properties: accepted };
                }
                rewritten.properties = fields;
            } else if (key === 'required' && Array.isArray(child)) rewritten.required = child.map(name => name === 'decisions' ? 'decisionActions' : name);
            else rewritten[key] = rewriteConditions(child);
        }
        return rewritten;
    };
    for (const key of ['if', 'then', 'allOf', 'anyOf', 'not']) if (Object.hasOwn(result, key)) result[key] = rewriteConditions(result[key]);
    if (Object.keys(definitions).length) result.definitions = definitions;
    return result;
}

/** Raw bytes remain the producer's evidence. This derived value alone grants
 * no standing and must pass the complete canonical parser/accounting checks. */
export function decodeSubjectActionOutput(raw: string, profile: SubjectActionProfile, input: DecisionReferences, maxBytes: number): ObjectValue {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || Buffer.byteLength(raw) > maxBytes) return invalid('wire output bound');
    const d = domain(profile, input), value = parseUniqueJson(raw);
    if (!object(value) || !object(value.decisionActions) || Object.hasOwn(value, 'decisions') || Object.hasOwn(value, 'retainedDispositions'))
        return invalid('single action map required');
    if(value.subjectActionsHash!==subjectActionResponseHash(profile,input))return invalid('raw output does not bind the original subject map');
    const actions = value.decisionActions;
    if (Object.keys(actions).some(key => !d.subjects.has(key))) return invalid('foreign subject key');
    const { decisionActions: _actions, subjectActionsHash: _responseHash, ...result } = value;
    const decisions: ObjectValue[] = [], retained: string[] = [];
    const hasRetention = Object.values(actions).some(action => action === 'retain');
    let bytes = Buffer.byteLength(JSON.stringify({ ...result, decisions: [], ...(hasRetention ? { retainedDispositions: [] } : {}) }));
    for (const [key, id] of d.subjects) {
        if (!Object.hasOwn(actions, key)) continue;
        const action = actions[key];
        if (action === 'retain') {
            const row = d.retention.get(id);
            if (!row) return invalid('retention is not an original eligible choice');
            bytes += Buffer.byteLength(JSON.stringify(row)) + (retained.length ? 1 : 0);
            if (bytes > maxBytes) return invalid('canonical output bound');
            retained.push(row);
        } else {
            if (!object(action) || Object.hasOwn(action, 'occurrenceId')) return invalid('fresh action cannot choose a second subject');
            const decision: ObjectValue = { ...clone(action), occurrenceId: id };
            if (Object.hasOwn(decision, 'equivalentTo')) {
                if (typeof decision.equivalentTo !== 'string' || !d.targets.has(decision.equivalentTo)) return invalid('foreign equivalent subject key');
                decision.equivalentTo = d.targets.get(decision.equivalentTo)!;
            }
            bytes += Buffer.byteLength(JSON.stringify(decision)) + (decisions.length ? 1 : 0);
            if (bytes > maxBytes) return invalid('canonical output bound');
            decisions.push(decision);
        }
    }
    const canonical = { ...result, decisions, ...(retained.length ? { retainedDispositions: retained } : {}) };
    if (Buffer.byteLength(JSON.stringify(canonical)) > maxBytes) return invalid('canonical output bound');
    return canonical;
}

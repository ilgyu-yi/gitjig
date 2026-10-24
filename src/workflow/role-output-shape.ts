import type { Role, SourceFitRequirement, RoleOutputConstraints } from './types.js';
/** Structural guidance only. Strict protocol checks retain byte/path/identity and cross-field semantics. */
export type Shape = Readonly<{
    type: string;
    anyOf?: readonly Shape[];
    if?: Shape;
    then?: Shape;
    description?: string;
    properties?: Readonly<Record<string, Shape>>;
    required?: readonly string[];
    additionalProperties?: false;
    items?: Shape;
    enum?: readonly unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    maxItems?: number;
    minItems?: number;
    pattern?: string;
}>;
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value;
}
const text: Shape = { type: 'string', minLength: 1, maxLength: 32768 };
// Byte and UTF16 constraints are intentionally still enforced by the strict parser.
const literal: Shape = { type: 'string' };
const bool: Shape = { type: 'boolean' };
const integer = (maximum = Number.MAX_SAFE_INTEGER): Shape => ({ type: 'integer', minimum: 1, maximum });
const list = (items: Shape, maxItems = 1024): Shape => ({ type: 'array', items, maxItems });
const texts = list(text);
const enumeration = (values: readonly unknown[]): Shape => ({ type: 'string', enum: values });
const object = (properties: Record<string, Shape>, required = Object.keys(properties)): Shape => ({ type: 'object', properties, required, additionalProperties: false });
export const protocolEnums = freeze({
    roles: ['planner', 'challenger', 'adjudicator', 'implementer', 'reviewer', 'repairer', 'confirmer'],
    observation: ['return', 'rejection'], caseKind: ['healthy', 'adverse'], reviewer: ['reviewer'],
    amendmentBasis: ['fixture-defect', 'owner-requirement-revision'],
    checkDisposition: ['corrected-fixture', 'authorized-requirement-revision'], criteriaVerdict: ['adopt', 'needs-owner'],
    severity: ['blocking', 'optional'], repair: ['mechanical', 'substantive', 'unknown'],
    disposition: ['upheld', 'rejected', 'deferred', 'unresolved', 'equivalent'],
    impact: ['explanation', 'scope-change', 'ambiguous'], payloadVerdict: ['fit', 'needs-owner-scope'], outcome: ['clear', 'findings'],
} as const);
const requirement = object({ id: text, text, source: text });
const observation = object({ kind: enumeration(protocolEnums.observation), value: literal });
const caseInput = object({ literalUtf8: literal, fixturePaths: texts });
const verificationCase = object({ id: text, kind: enumeration(protocolEnums.caseKind), guaranteeIds: texts, derivation: text, consumerPaths: texts, input: caseInput, expected: observation });
const check = object({ id: text, guaranteeIds: texts, command: text, assertions: texts, timeoutMs: integer(300000), fixturePaths: texts, expectationPaths: texts, cases: list(verificationCase, 64) }, ['id', 'guaranteeIds', 'command', 'assertions', 'timeoutMs', 'fixturePaths']);
const checkAmendment = object({ obligationId: text, failedCheckRunId: text, basis: enumeration(protocolEnums.amendmentBasis), correctedCheckId: text, fixturePaths: texts, negativeAssertions: texts, caseIds: texts, negativeCaseIds: texts, ownerInputId: text, reason: text }, ['obligationId', 'failedCheckRunId', 'basis', 'correctedCheckId', 'fixturePaths', 'negativeAssertions', 'reason']);
const reviewPosition = object({ key: text, kind: enumeration(protocolEnums.reviewer), purpose: text, requiredPaths: texts });
const strategyShapes = {
    'consumer-cases': object({ requirementId: text, kind: { type: 'string', const: 'consumer-cases' }, checkIds: texts }),
    'base-execution-duty': object({ requirementId: text, kind: { type: 'string', const: 'base-execution-duty' }, checkId: text, caseIds: texts, reviewKey: text }),
    'manifest-scope-duty': object({ requirementId: text, kind: { type: 'string', const: 'manifest-scope-duty' }, allowedChangePaths: texts, unchangedPaths: texts, reviewKey: text }),
};
const verificationStrategy: Shape = { type: 'object', anyOf: Object.values(strategyShapes) };
const verification = object({ strategies: list(verificationStrategy), checks: list(check), requiredPaths: texts, reviewRoles: list(reviewPosition), checkAmendments: list(checkAmendment) }, ['checks', 'requiredPaths', 'reviewRoles']);
const plan = object({ intent: text, requirements: list(requirement), approach: text, simplerAlternative: text, factualSources: texts, verification, ambiguities: { ...texts, description: 'Only unresolved consequential questions about owner intent, scope or acceptance that require clarification before implementation. Use [] when none remain; do not hide consequential unknowns or invent an owner answer. Record selected engineering conventions in approach/simplerAlternative, factual assumptions with provenance in factualSources, and future verification conditions or limits in verification or existing explanatory text. Such notes belong here only if a consequential owner choice genuinely remains. Any nonempty list blocks implementation even if planAccepted is true or ownerDecisionRequired is absent or empty.' } });
const checkResolution = object({ amendmentId: text, disposition: enumeration(protocolEnums.checkDisposition), reason: text, witnesses: texts });
const criteriaDecision = object({ sourceId: text, fromContractsVersion: text, toContractsVersion: text, verdict: enumeration(protocolEnums.criteriaVerdict), reason: text });
const reproduction = object({ toolCallId: text, command: text, assertions: texts, expectationPaths: texts }, ['toolCallId', 'command', 'assertions']);
const mechanicalPatch = object({ path: text, oldText: text, newText: { type: 'string', maxLength: 32768 } });
const finding = object({ requirementId: text, severity: enumeration(protocolEnums.severity), repair: enumeration(protocolEnums.repair), description: text, evidence: texts, mechanicalPatch, reproduction }, ['requirementId', 'severity', 'repair', 'description', 'evidence']);
const scope = object({ sourceId: text, startLine: integer(), endLine: integer() });
const diagnosis = object({ outputId: text, rawSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, inputReceiptHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, materialOccurrenceIds: texts });
const decision = object({ occurrenceId: text, disposition: enumeration(protocolEnums.disposition), reason: text, witnesses: texts, equivalentTo: text, resolution: enumeration(['repaired', 'diagnosed']), diagnosis }, ['occurrenceId', 'disposition', 'reason', 'witnesses']);
const inputDecision = object({ inputId: text, directionRevision: integer(), impact: enumeration(protocolEnums.impact), reason: text, requirementIds: texts });
const sha: Shape = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const payloadDecision = object({ payloadHash: sha, sourceFingerprint: sha, verdict: enumeration(protocolEnums.payloadVerdict), reason: text });
const implementationCarry = object({ occurrenceId: text, baselineVersion: text, requirementIds: texts, reason: text });
const nit = object({ beforeCandidate: text, afterDigest: text, deltaHash: text, consumerCheckIds: texts });
const verificationDecision = object({ requirementId: text, strategyDigest: sha, witnessIds: texts, verdict: enumeration(['satisfied', 'unavailable']), reason: text });
const assertion = object({ id: text, passed: bool, actual: text }, ['id', 'passed']);
const caseResult = object({ id: text, inputDigest: sha, observed: observation });
const checkOutput = object({ version: { type: 'integer', const: 1 }, assertions: list(assertion), cases: list(caseResult, 64) }, ['version', 'assertions']);
export const protocolShapes = freeze({ requirement, observation, caseInput, verificationCase, check, plan, verification, reviewPosition, checkAmendment, checkResolution, criteriaDecision, finding, reproduction, mechanicalPatch, scope, decision, diagnosis, inputDecision, strategyShapes, verificationStrategy, verificationDecision, payloadDecision, implementationCarry, nit, assertion, caseResult, checkOutput });
const common = { version: { type: 'integer', const: 1 } as Shape, summary: text, findings: list(finding), assessedScope: list(scope) };
export const roleShapes: Readonly<Record<Role, Shape>> = freeze({
    planner: object({ ...common, plan }),
    challenger: object({ ...common, alternatives: texts }),
    adjudicator: object({ ...common, verificationDecisions: list(verificationDecision), decisions: list(decision), planAccepted: bool, acceptedPlan: plan, implementationCarries: list(implementationCarry), ownerDecisionRequired: texts, nitAuthorization: nit, inputDecisions: list(inputDecision), payloadDecision, checkResolutions: list(checkResolution), criteriaDecision }, [...Object.keys(common), 'decisions']),
    implementer: object({ ...common }), reviewer: object({ ...common, verificationDecisions: list(verificationDecision), outcome: enumeration(protocolEnums.outcome) }, Object.keys(common)),
    repairer: object({ ...common }), confirmer: object({ ...common, confirmed: bool, witnesses: texts }),
});
/** Fresh copy: caller changes cannot alter parser field admission or subsequent prompts. */
export function roleOutputSchema(role: Role, stage?: string, sourceFit: readonly SourceFitRequirement[] = [], constraints: RoleOutputConstraints = {}): Shape {
    const { verificationFit, sourceIds, planningProfile, criteriaRefresh } = constraints;
    let schema = structuredClone(roleShapes[role]);
    if (sourceIds) {
        const field = role === 'planner' ? 'plan' : role === 'adjudicator' ? 'acceptedPlan' : null;
        if (field) {
            const proposal = schema.properties![field]!, requirements = proposal.properties!.requirements!, item = requirements.items!;
            schema = { ...schema, properties: { ...schema.properties, [field]: { ...proposal, properties: { ...proposal.properties,
                requirements: { ...requirements, items: { ...item, properties: { ...item.properties, source: { ...item.properties!.source!, enum: sourceIds,
                    description: 'Use one exact supplied retained owner-source identity, never prose composites or invented file aliases.' } } } } } } } };
        }
    }
    if (criteriaRefresh && role === 'adjudicator' && stage === 'planning-adjudication') {
        const field = schema.properties!.criteriaDecision!;
        schema = { ...schema, properties: { ...schema.properties, criteriaDecision: { ...field,
            properties: { ...field.properties, ...Object.fromEntries((['sourceId', 'fromContractsVersion', 'toContractsVersion'] as const).map(key =>
                [key, { ...field.properties![key]!, const: criteriaRefresh[key] }])) },
            description: 'Independently assess the actual previous/current criteria. An accepting plan without an explicit owner-decision request requires this decision. Echo the supplied identities exactly; choose adopt or needs-owner honestly. This never changes task requirements or grants execution.' } },
            if: { type: 'object', required: ['planAccepted'], properties: { planAccepted: { type: 'boolean', const: true },
                ownerDecisionRequired: { type: 'array', maxItems: 0 } } },
            then: { type: 'object', required: ['criteriaDecision'] } };
    }
    if (verificationFit !== undefined) {
        if (role !== 'reviewer' && role !== 'adjudicator') throw new Error('Verification fit schema requires independent inspection role');
        const entry = schema.properties!.verificationDecisions!;
        schema = { ...schema, required: [...schema.required!, 'verificationDecisions'], properties: { ...schema.properties,
            verificationDecisions: { ...entry, minItems: verificationFit.length, maxItems: verificationFit.length,
                ...(verificationFit.length ? { items: { type: 'object', anyOf: verificationFit.map(required => ({ ...verificationDecision,
                    properties: { ...verificationDecision.properties, requirementId: { type: 'string', const: required.requirementId },
                        strategyDigest: { type: 'string', const: required.strategyDigest }, witnessIds: { ...texts, items: { type: 'string', enum: required.witnessIds } } } })) } } : {}),
                description: 'Return one independent fit decision for each exact requirement/strategy and actual supplied witness set, no duplicate or invented identities. Choose unavailable when fit/evidence cannot be established. Satisfied needs the complete actual witness set. The host identity contract never chooses a verdict or supplies semantic judgment.' } } };
    }
    if (role === 'adjudicator' && stage === 'planning-adjudication' && sourceFit.length) {
        schema = { ...schema, required: [...schema.required!, 'inputDecisions'], properties: { ...schema.properties,
            inputDecisions: { ...schema.properties!.inputDecisions!, minItems: sourceFit.length,
                description: `Return one independent inputDecisions entry for every held tuple, exactly once: ${JSON.stringify(sourceFit)}. Read each actual sourceInputChain text; bind its inputId and directionRevision exactly. Classify impact honestly with a reason and requirementIds from your accepted plan. Do not infer a verdict from the hold, copy author acknowledgement as proof, invent requirements or omit an inconvenient input. Use ambiguous when consequential owner clarification is needed. These required identities do not select any classification or release effects; the host separately checks current source and accepted requirements.` }
        } };
    }
    if (role === 'adjudicator' && stage === 'review-adjudication') {
        const decisions = schema.properties!.decisions!, item = decisions.items!;
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...decisions, items: { ...item, properties: { ...item.properties, witnesses: { ...item.properties!.witnesses!, description: "When choosing disposition upheld with resolution repaired, include as a separate unchanged witnesses array element the id of an actually supplied passing context.checks record for the current candidate and verification. Use that check-run record id, not its logical check_id, assertion id, case id, a prefix/suffix or constructed locator. Case-qualified evidence may be supplementary but cannot replace the bare check-run id. Include only existing evidence; if the required current passing record is absent, do not invent an id or claim repaired. This instruction does not select a verdict, certify semantic repair, authorize another resolution or close an obligation." } } } } } };
    }
    if (role === 'adjudicator' && stage !== undefined && !['planning-adjudication', 'review-adjudication'].includes(stage)) {
        const decisions = schema.properties!.decisions!, item = decisions.items!;
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...decisions, items: { ...item, properties: Object.fromEntries(Object.entries(item.properties!).filter(([key]) => key !== 'diagnosis').map(([key, value]) => [key, key === 'resolution' ? enumeration(['repaired']) : value])) } } } };
    }
    if (role === 'adjudicator' && stage !== undefined && stage !== 'planning-adjudication')
        schema = { ...schema, properties: Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => key !== 'implementationCarries')) };
    if (planningProfile && (role === 'planner' && stage === 'planning' || role === 'adjudicator' && stage === 'planning-adjudication')) {
        const field = role === 'planner' ? 'plan' : 'acceptedPlan', proposal = schema.properties![field]!, verification = proposal.properties!.verification!;
        const constrained = { ...proposal, properties: { ...proposal.properties, verification: planningProfile.supported
            ? { ...verification, properties: { ...verification.properties, strategies: { ...verification.properties!.strategies!, items: { type: 'object', anyOf: planningProfile.allowedKinds.map(kind => strategyShapes[kind]) } } }, required: [...verification.required!, 'strategies'], description: 'Account for every accepted requirement using the supported closed strategies. A planner may retain an incomplete proposal only with an explicit blocking finding; do not invent a strategy or remove owner requirements. Acceptance requires complete accounting.' }
            : { ...verification, properties: Object.fromEntries(Object.entries(verification.properties!).filter(([key]) => key !== 'strategies')), description: planningProfile.reason ?? 'Finite mixed planning capability unavailable' } } };
        if (role === 'planner') schema = { ...schema, properties: { ...schema.properties, plan: constrained } };
        else if (planningProfile.supported && !(planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation)) schema = { type: 'object', anyOf: [
            { ...schema, required: [...schema.required!, 'planAccepted', 'acceptedPlan'], properties: { ...schema.properties, planAccepted: { type: 'boolean', const: true }, acceptedPlan: constrained } },
            { ...schema, required: [...schema.required!, 'planAccepted'], properties: { ...schema.properties, planAccepted: { type: 'boolean', const: false } }, description: 'Declining an unavailable or unfit plan is valid without acceptedPlan. Retain actual blockers; no authoring is admitted.' },
        ] };
        else if (planningProfile.supported) schema = { ...schema, required: [...schema.required!, 'planAccepted'], properties: { ...schema.properties, planAccepted: { type: 'boolean', const: false } }, description: 'The retained before-edit duty has no supported cross-plan historical mapping. Decline acceptance without inventing or removing that duty.' };
        else schema = { ...schema, properties: { ...schema.properties, acceptedPlan: constrained } };
    }
    return schema;
}

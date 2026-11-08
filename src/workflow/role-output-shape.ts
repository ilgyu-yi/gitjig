import { assertPlanningRepairSubjects, capturePlanningRepair, planningRepairSubjects } from './planning-repair.js';
import { captureScopeAmendment, scopeAmendmentActions, type ScopeAmendmentProfile } from './scope-amendment.js';
import { optionalReviewSubjects, assertSupportedRoleProfile, captureDecisionCarry, captureDiagnosisEligibility, captureDecisionReferences, captureProposalApproval, captureReviewResolution, captureSourceFitReferences, assertSourceFitTuples } from './role-input.js';
import { ownedInputPathSchemaPattern } from './owned-input-path.js';
import { subjectActionSchema } from './subject-actions.js';
import type { PlanningGrammar, Role, SourceFitRequirement, RoleOutputConstraints } from './types.js';
/** Structural guidance only. Strict protocol checks retain byte/path/identity and cross-field semantics. */
export type Shape = Readonly<{
    type: string;
    $ref?: string;
    definitions?: Readonly<Record<string, Shape>>;
    anyOf?: readonly Shape[];
    allOf?: readonly Shape[];
    if?: Shape;
    then?: Shape;
    not?: Shape;
    description?: string;
    properties?: Readonly<Record<string, Shape>>;
    required?: readonly string[];
    additionalProperties?: false;
    items?: Shape;
    contains?: Shape;
    enum?: readonly unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    maxItems?: number;
    minItems?: number;
    uniqueItems?: boolean;
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
const ownedPath: Shape = { ...text, pattern: ownedInputPathSchemaPattern,
    description: 'Project-relative owned input path, for example check.cjs or src/mode.cjs. Do not include /work/, /input/ or a host absolute directory prefix, parent traversal segments or NUL. Shell command strings have a separate domain and may use execution paths. Syntax alone grants no file access or authority.' };
const ownedPaths = list(ownedPath);
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
const observation = object({ kind: enumeration(protocolEnums.observation), value: { ...literal, description: 'Exact string emitted by the check command in decoded CheckOutput.cases[].observed.value. JSON transport quoting is not extra data. If the command emits an empty string, use an empty value, not two quote characters. Do not JSON.stringify an observed string unless the command itself emits that serialized text.' } });
const caseInput = object({ literalUtf8: { ...literal, description: 'Exact input text consumed by the declared check command. Inspect its decoder: JSON.parse requires one JSON value encoded here; a raw-text consumer need not use JSON. This input encoding does not determine expected.value encoding.' }, fixturePaths: ownedPaths });
const verificationCase = object({ id: { ...text, description: 'Unique across all cases in every check in this plan, including baseline and candidate checks.' }, kind: enumeration(protocolEnums.caseKind), guaranteeIds: { ...texts, description: 'Exact requirement IDs declared in this plan and also included in this containing check.guaranteeIds.' }, derivation: text, consumerPaths: ownedPaths, input: caseInput, expected: observation });
const check = object({ id: text, guaranteeIds: { ...texts, description: 'Exact IDs from this plan.requirements. A check may cover several actual requirements; each case declares its relevant subset.' }, command: text, assertions: { ...texts, description: 'Actual logical assertion IDs emitted by this executable command in CheckOutput.assertions. Case membership alone does not establish an assertion; identical spelling is valid only when the command actually emits that ID in both domains. Inspect an existing command before naming its assertions. One logical assertion may cover multiple cases; do not invent one assertion per case.' }, timeoutMs: integer(300000), fixturePaths: ownedPaths, expectationPaths: ownedPaths, cases: list(verificationCase, 64) }, ['id', 'guaranteeIds', 'command', 'assertions', 'timeoutMs', 'fixturePaths']);
const checkAmendment = object({ obligationId: text, failedCheckRunId: text, basis: enumeration(protocolEnums.amendmentBasis), correctedCheckId: text, fixturePaths: ownedPaths, negativeAssertions: texts, caseIds: texts, negativeCaseIds: texts, ownerInputId: text, reason: text }, ['obligationId', 'failedCheckRunId', 'basis', 'correctedCheckId', 'fixturePaths', 'negativeAssertions', 'reason']);
const candidateProbeAmendment = {...checkAmendment, properties: {...checkAmendment.properties,
    negativeReplacement: {...object({path: ownedPath, text: {...literal, minLength:1, maxLength:65536}}),
        description: 'For a fixture defect whose BASE plus declared fixture overlay lacks a required case file, specify the exact complete UTF-8 text of one deliberately faulty consumer replacement in an isolated candidate copy. Keep the checker and its fixed inputs identical. The replacement must exhibit the named negative assertion and case sets.'},
}};
export function checkAmendmentShape(grammar: PlanningGrammar): Shape {
    return grammar >= 12 ? candidateProbeAmendment : checkAmendment;
}
const reviewPosition = object({ key: text, kind: enumeration(protocolEnums.reviewer), purpose: text, requiredPaths: ownedPaths });
const strategyRequirementId: Shape = { ...text, description: 'One exact ID from this plan.requirements. Do not repeat that requirementId in another strategy, even with a different kind.' };
const strategyReviewKey: Shape = { ...text, description: 'Exact key of an actual declared verification.reviewRoles entry in this plan. Use the declared key; do not substitute the role kind unless it is also that exact key.' };
const atomicStrategyShapes = {
    'consumer-cases': object({ requirementId: strategyRequirementId, kind: { type: 'string', const: 'consumer-cases' }, checkIds: { ...texts, description: 'Distinct IDs of declared candidate checks whose guaranteeIds include this requirementId. Together they need healthy and adverse cases for that same requirement. One strategy may use multiple checks; do not select a baseline-duty check.' } }),
    'base-execution-duty': object({ requirementId: strategyRequirementId, kind: { type: 'string', const: 'base-execution-duty' }, checkId: { ...text, description: 'ID of a declared original-base check whose guaranteeIds include this requirementId. Before editing, that command must succeed with all declared assertions passing and matching case observations of a specific actual BASE fact. A desired-candidate correctness oracle that necessarily fails on defective BASE cannot establish this duty.' }, caseIds: { ...texts, description: 'Distinct actual case IDs declared inside the selected checkId, each with this requirementId in its guaranteeIds.' }, reviewKey: strategyReviewKey }),
    'manifest-scope-duty': object({ requirementId: strategyRequirementId, kind: { type: 'string', const: 'manifest-scope-duty' }, allowedChangePaths: { ...ownedPaths, description: 'Exact owned paths allowed to change; no duplicates within this list or overlap with unchangedPaths.' }, unchangedPaths: { ...ownedPaths, description: 'Exact owned paths required unchanged; no duplicates within this list or overlap with allowedChangePaths.' }, reviewKey: strategyReviewKey }),
};
const strategyPartShape = (shape:Shape):Shape => ({...shape,
    properties:Object.fromEntries(Object.entries(shape.properties!).filter(([key])=>key!=='requirementId')),
    required:shape.required!.filter(key=>key!=='requirementId')});
const strategyPartShapes = {
    'consumer-cases':strategyPartShape(atomicStrategyShapes['consumer-cases']),
    'base-execution-duty':strategyPartShape(atomicStrategyShapes['base-execution-duty']),
    'manifest-scope-duty':strategyPartShape(atomicStrategyShapes['manifest-scope-duty']),
};
const strategyShapes = {...atomicStrategyShapes,'all-of':object({requirementId:strategyRequirementId,kind:{type:'string',const:'all-of'},
    parts:{type:'array',minItems:2,maxItems:3,items:{type:'object',anyOf:Object.values(strategyPartShapes)},
        description:'All parts are mandatory: two or three DIFFERENT supported atomic families, with no nesting. Parts inherit this parent requirementId; do not repeat it inside parts. Use all-of when one actual owner requirement needs behavior AND scope or original-base evidence, instead of splitting or repeating that requirement merely to fit a strategy kind.'}})};
const verificationStrategy: Shape = { type: 'object', anyOf: Object.values(atomicStrategyShapes) };
const verification = object({ strategies: { ...list(verificationStrategy), description: 'At most one strategy per normalized requirement ID; an accepted complete plan accounts for every requirement exactly once. Supported kinds are capabilities, not a checklist: select only strategies needed for actual requirements. Do not invent a requirement or baseline duty merely to use an available kind. Missing necessary accounting may be retained only as an explicitly incomplete planner proposal with a blocking finding; it cannot be accepted.' }, checks: list(check), requiredPaths: ownedPaths, reviewRoles: list(reviewPosition), checkAmendments: list(checkAmendment) }, ['checks', 'requiredPaths', 'reviewRoles']);
const plan = object({ intent: text, requirements: { ...list(requirement), description: 'Normalize the actual owner obligations with unique IDs and their original sources. Separate independently verifiable obligations when necessary without changing their meaning or losing constraints. Do not split or add requirements merely to use strategy kinds.' }, approach: text, simplerAlternative: text, factualSources: texts, verification, ambiguities: { ...texts, description: 'Only unresolved consequential questions about owner intent, scope or acceptance that require clarification before implementation. Use [] when none remain; do not hide consequential unknowns or invent an owner answer. Record selected engineering conventions in approach/simplerAlternative, factual assumptions with provenance in factualSources, and future verification conditions or limits in verification or existing explanatory text. Such notes belong here only if a consequential owner choice genuinely remains. Any nonempty list blocks implementation even if planAccepted is true or ownerDecisionRequired is absent or empty.' } });
const checkResolution = object({ amendmentId: text, disposition: enumeration(protocolEnums.checkDisposition), reason: text, witnesses: { ...texts, minItems: 1, uniqueItems: true, description: 'Distinct actual evidence for this check resolution; cite the supplied current receipts. A nonempty list alone proves no repair or closure.' } });
const criteriaDecision = object({ sourceId: text, fromContractsVersion: text, toContractsVersion: text, verdict: enumeration(protocolEnums.criteriaVerdict), reason: text });
const reproduction = object({ toolCallId: text, command: text, assertions: texts, expectationPaths: ownedPaths }, ['toolCallId', 'command', 'assertions']);
const mechanicalPatch = object({ path: ownedPath, oldText: text, newText: { type: 'string', maxLength: 32768 } });
const finding = object({ requirementId: text, severity: enumeration(protocolEnums.severity), repair: enumeration(protocolEnums.repair), description: text, evidence: texts, mechanicalPatch, reproduction }, ['requirementId', 'severity', 'repair', 'description', 'evidence']);
const scope = object({ sourceId: text, startLine: integer(), endLine: integer() });
const diagnosis = object({ outputId: text, rawSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, inputReceiptHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, materialOccurrenceIds: texts });
const decisionImplementationCarry = object({ baselineVersion: text, requirementIds: texts });
const noImplementation = object({ kind: { type: 'string', const: 'none' } });
const assignedImplementation = object({ kind: { type: 'string', const: 'assign-to-plan' }, baselineVersion: text, requirementIds: { ...texts, minItems: 1, uniqueItems: true } });
const implementationAction: Shape = { type: 'object', anyOf: [assignedImplementation, noImplementation], description: 'Choose an explicit action for THIS member. assign-to-plan requests its own BASE/current requirement mapping. none makes no assignment and closes nothing; it can accompany equivalence to a rejected, genuinely repaired or optional terminal target. Every pending equivalent of a newly assigned target needs its own assign-to-plan choice.' };
export function sourceQualifiedImplementationShape(baselineVersion: string, baseSourceIds: readonly string[]): Shape {
    return {...assignedImplementation,properties:{...assignedImplementation.properties,baselineVersion:{...text,const:baselineVersion},
        baseSourceIds:{...texts,minItems:1,uniqueItems:true,items:baseSourceIds.length?{...text,enum:[...baseSourceIds]}:{...text,not:{type:'string'}}}},
        required:[...assignedImplementation.required!,'baseSourceIds'],
        description:'Independently classify THIS original claim as an implementation defect in the exact initial BASE, citing its actual inline BASE sources. Preserve separate candidate, proposal, intent and unavailable-source objections. Source availability is not understanding, repair or closure.'};
}
const planRepair = object({ kind: {type:'string', const:'plan'}, proposalHash: text }, ['kind','proposalHash']);
const coveragePlanRepair = object({ kind: enumeration(['plan', 'verification-plan']), proposalHash: text }, ['kind','proposalHash']);
const decision = object({ occurrenceId: text, disposition: enumeration(protocolEnums.disposition), reason: text, witnesses: texts, equivalentTo: text, resolution: enumeration(['repaired', 'diagnosed']), diagnosis }, ['occurrenceId', 'disposition', 'reason', 'witnesses']);
const inputDecision = object({ inputId: text, directionRevision: integer(), impact: enumeration(protocolEnums.impact), reason: text, requirementIds: texts });
const sha: Shape = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const payloadDecision = object({ payloadHash: sha, sourceFingerprint: sha, verdict: enumeration(protocolEnums.payloadVerdict), reason: text });
const implementationCarry = object({ occurrenceId: text, baselineVersion: text, requirementIds: texts, reason: text });
const implementationCarryGroup = object({ occurrenceIds: { ...texts, minItems: 1, description: 'Every explicitly carried member ID; no inferred equivalents. One shared BASE, requirement mapping and rationale must apply to every named member. Individual decisions and later repair proofs remain required. Combined single/group members cannot exceed1024 or overlap.' }, baselineVersion: text, requirementIds: texts, reason: text });
const nit = object({ beforeCandidate: text, afterDigest: text, deltaHash: text, consumerCheckIds: texts });
const verificationDecision = object({ requirementId: text, strategyDigest: sha, witnessIds: texts, verdict: enumeration(['satisfied', 'unavailable']), reason: text });
const assertion = object({ id: text, passed: bool, actual: text }, ['id', 'passed']);
const caseResult = object({ id: text, inputDigest: sha, observed: observation });
const checkOutput = object({ version: { type: 'integer', const: 1 }, assertions: list(assertion), cases: list(caseResult, 64) }, ['version', 'assertions']);
const baselineCheck = { ...check, properties: { ...check.properties, baselineExpectedFailures: { ...texts, minItems: 1, uniqueItems: true, description: 'Original BASE-only observation: exact declared assertion IDs expected to report false. All other assertions must report true; command must exit zero and all declared case observations must match. Omit for all-true observations. Forbidden on candidate or unreferenced checks; this does not accept candidate failures.' } } };
const expectationCheck = { ...baselineCheck, required: [...baselineCheck.required!, 'expectationPaths'], properties: { ...baselineCheck.properties,
    expectationPaths: { ...ownedPaths, uniqueItems: true, description: 'Explicit complete owned file paths that define this command’s assertions, oracle or expected data, for example check.cjs. Use [] only when there is no file-based expectation input. Omission means unknown, never empty. fixturePaths lists execution inputs and may include the implementation; expectationPaths must not include a consumer merely because it executes or changes. Inspect the actual command to identify its expectation inputs. Declared files must exist in the frozen check target before execution; declaration alone does not prove semantic completeness.' } } };
const caseDeclarationCheck = { ...expectationCheck, required: [...expectationCheck.required!, 'cases'], properties: { ...expectationCheck.properties,
    cases: { ...check.properties!.cases!, description: 'Explicit actual consumer-observation declarations for this command. Consumer-cases strategies require healthy and adverse coverage across their referenced checks. A BASE-only duty can have one actual case; an auxiliary assertion check can declare [] but cannot supply consumer coverage. Never invent consumer cases to prove workflow, authority or command-configuration obligations; retain those in their actual definitions, scope strategies and captured delegation.' } } };
const consumerControl = object({path: text, replacementPath: text, failedAssertions: {...texts, uniqueItems: true}, observations: {...list(object({id: text, observed: observation}), 64), minItems: 1}});
const controlCheck = {...caseDeclarationCheck, properties: {...caseDeclarationCheck.properties,
    consumerControl: {...consumerControl, description: 'Select an existing original BASE file with a known deliberate defect. Name one consumer source path to replace in an isolated candidate copy and the exact changed typed observations. Check and oracle inputs stay fixed. Omit when no suitable independently accepted replacement exists.'}}};
const reviewerControl = {...consumerControl, required: consumerControl.required!.filter(key => key !== 'replacementPath')};
const reviewerControlCheck = {...controlCheck, properties: {...controlCheck.properties,
    consumerControl: {...reviewerControl, description:'An existing BASE replacement path or, when omitted, one proposed by the independent reviewer after candidate capture. The same planned consumer path and predicted observations apply.'}}};
const conformingControlCheck = {...reviewerControlCheck, properties: {...reviewerControlCheck.properties, consumerControl: {
    ...reviewerControl,
    description: 'Use an independently justified isolated replacement. For a conforming variation that should pass the unchanged checker, both observations and failedAssertions are empty. For a fault, name exactly the changed observations and false assertions. An omitted replacementPath requests an independent proposal for the same planned outcome.',
    properties: {...reviewerControl.properties, observations: {...reviewerControl.properties!.observations!, minItems: 0}},
    allOf: [{type: 'object', if: {type: 'object', properties: {observations: {type: 'array', maxItems: 0}}},
        then: {type: 'object', properties: {failedAssertions: {type: 'array', maxItems: 0}}}}],
}}};
export function checkShape(grammar: PlanningGrammar): Shape {
    return grammar >= 11 ? conformingControlCheck : grammar >= 10 ? reviewerControlCheck : grammar >= 9 ? controlCheck :
        grammar >= 5 ? caseDeclarationCheck : grammar >= 4 ? expectationCheck : grammar === 3 ? baselineCheck : check;
}
const consumerReplacement = {...literal, minLength:1, maxLength:65536, description:'The exact complete replacement UTF-8 text of the single indicated consumer file. Introduce the predicted defect without changing unrelated behavior.'};
export const protocolShapes = freeze({ requirement, observation, caseInput, verificationCase, check, baselineCheck, expectationCheck, caseDeclarationCheck, controlCheck, reviewerControlCheck, consumerControl, reviewerControl, consumerReplacement, plan, verification, reviewPosition, checkAmendment, checkResolution, criteriaDecision, finding, reproduction, mechanicalPatch, scope, decision, planRepair, coveragePlanRepair, decisionImplementationCarry, noImplementation, assignedImplementation, implementationAction, diagnosis, inputDecision, strategyShapes, strategyPartShapes, verificationStrategy, verificationDecision, payloadDecision, implementationCarry, implementationCarryGroup, nit, assertion, caseResult, checkOutput });
const common = { version: { type: 'integer', const: 1 } as Shape, summary: text, findings: list(finding), assessedScope: list(scope) };
export const roleShapes: Readonly<Record<Role, Shape>> = freeze({
    planner: object({ ...common, plan }),
    challenger: object({ ...common, alternatives: texts }),
    adjudicator: object({ ...common, verificationDecisions: list(verificationDecision), decisions: list(decision), retainedDispositions: texts, planAccepted: bool, acceptedPlan: plan, implementationCarries: list(implementationCarry), implementationCarryGroups: list(implementationCarryGroup), ownerDecisionRequired: texts, nitAuthorization: nit, inputDecisions: list(inputDecision), payloadDecision, checkResolutions: list(checkResolution), criteriaDecision }, [...Object.keys(common), 'decisions']),
    implementer: object({ ...common }), reviewer: object({ ...common, verificationDecisions: list(verificationDecision), outcome: enumeration(protocolEnums.outcome) }, Object.keys(common)),
    repairer: object({ ...common }), confirmer: object({ ...common, confirmed: bool, witnesses: texts }),
});
export function scopeAmendmentShape(schema: Shape, profile: ScopeAmendmentProfile): Shape {
    const ids = profile.subjects.map(subject => subject.evidenceId);
    const decisions = list(object({
        evidenceId: { ...text, enum: ids },
        action: enumeration(scopeAmendmentActions),
        reason: { ...text, maxLength: 2048 },
    }), ids.length);
    return { ...schema, properties: { ...schema.properties, scopeAmendments: { ...decisions, minItems: ids.length } } };
}

/** Fresh copy: caller changes cannot alter parser field admission or subsequent prompts. */
export function roleOutputSchema(role: Role, stage?: string, sourceFit: readonly SourceFitRequirement[] = [], constraints: RoleOutputConstraints = {}): Shape {
    assertSupportedRoleProfile(constraints as Record<string, unknown>);
    const { verificationFit, sourceIds, planningProfile, criteriaRefresh } = constraints;
    const sourceFitReferences = constraints.sourceFitReferences === undefined ? undefined : captureSourceFitReferences(constraints.sourceFitReferences);
    if (sourceFitReferences && (role !== 'adjudicator' || stage !== sourceFitReferences.stage)) throw Error('Source-fit reference schema requires its captured adjudicator stage');
    if (sourceFitReferences) {
        if (sourceFit.length) assertSourceFitTuples(sourceFit, sourceFitReferences.inputs);
        sourceFit = sourceFitReferences.inputs;
    }
    const reviewResolution = constraints.reviewResolution === undefined ? undefined : captureReviewResolution(constraints.reviewResolution);
    if (reviewResolution && (role !== 'adjudicator' || stage !== reviewResolution.stage)) throw Error('Review resolution schema requires its captured stage');
    const decisionReferences = constraints.decisionReferences === undefined ? undefined : captureDecisionReferences(constraints.decisionReferences);
    const diagnosisEligibility = constraints.diagnosisEligibility === undefined ? undefined : captureDiagnosisEligibility(constraints.diagnosisEligibility, decisionReferences);
    const approval = constraints.proposalApproval === undefined ? undefined : captureProposalApproval(constraints.proposalApproval);
    if (approval && (role !== 'adjudicator' || stage !== 'planning-adjudication')) throw Error('Bound proposal schema requires planning adjudication');
    let schema = structuredClone(roleShapes[role]);
    if (constraints.scopeAmendment !== undefined) {
        if (role !== 'adjudicator' || stage !== 'planning-adjudication')
            throw Error('Scope amendment schema requires planning adjudication');
        schema = scopeAmendmentShape(schema, captureScopeAmendment(constraints.scopeAmendment));
    }
    if (constraints.consumerControlProposal) {
        if (role !== 'reviewer' || stage !== 'consumer-control-proposal') throw Error('Consumer replacement requires its independent proposal stage');
        const replacement = constraints.consumerControlProposal === 'pass' ? { ...consumerReplacement,
            description: 'Complete replacement UTF-8 text for the one consumer file. It must conform to the same requirements while varying the intended unspecified property.' } : consumerReplacement;
        return object({...common, consumerReplacement: replacement});
    }

    if (role === 'adjudicator' && decisionReferences?.version !== 3) schema = { ...schema, properties: Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => key !== 'retainedDispositions')) };
    if (decisionReferences) {
        if (role !== 'adjudicator' || !['planning-adjudication', 'review-adjudication', 'raw-assessment'].includes(String(stage))) throw Error('Decision references require their assigned adjudication stage');
        const entries = schema.properties!.decisions!, item = entries.items!;
        const ids = [...decisionReferences.occurrenceIds], synthetic = [...decisionReferences.diagnosisOccurrenceIds];
        const syntheticIds = new Set(synthetic), targets = ids.filter(id => !syntheticIds.has(id));
        const nonEquivalent = protocolEnums.disposition.filter(value => value !== 'equivalent');
        const properties: Record<string, Shape> = { ...item.properties,
            disposition: { ...item.properties!.disposition!, description: 'Choose an independent current judgment. A host diagnosis cannot use equivalent. Upheld alone does not resolve an obligation; use the actual required diagnosis, BASE implementation carry or current repair evidence. Deferred/unresolved judgments retain their holds.' },
            resolution: { ...item.properties!.resolution!, description: 'Diagnosed requires upheld plus the actual producerDiagnosticReceipt.eligible tuple and independent raw assessment; the old producer remains unusable and its material claims remain separate. Repaired needs its required current witnesses. Do not treat a historical flaw in a discarded proposal as a new owner requirement.' },
            diagnosis: { ...item.properties!.diagnosis!, description: 'Use only the exact eligible outputId/rawSha256, producerDiagnosticReceipt.receiptHash and original materialOccurrenceIds. Identity membership alone does not prove raw availability, comprehension or completeness. Missing operands require a hold, not invented values.' },
            occurrenceId: { ...text, enum: ids, description: 'One exact supplied decisionReferences.occurrenceIds identity. Membership does not prove body exposure, validity, diagnosis eligibility or resolution.' },
            ...(targets.length ? { equivalentTo: { ...text, enum: targets,
                description: 'An actual retained ordinary occurrence ID, never a requirement ID, prose alias or synthetic producer diagnosis. Independently assess meaning; the host still checks full chains and cycles.' } }
                : { disposition: enumeration(nonEquivalent) }) };
        if (!targets.length) delete properties.equivalentTo;
        schema = { ...schema, properties: { ...schema.properties, findings: { ...schema.properties!.findings!, description: 'Report genuinely new meaningful material claims here. Use decisions for already supplied occurrences; do not repeat their findings arrays merely to discuss them. Every received new claim retains its own accountability; do not suppress a necessary new observation to make diagnosis pass.' }, decisions: ids.length
            ? { ...entries, items: { ...item, properties,
                ...(targets.length ? {
                    if: { type: 'object', required: ['disposition'], properties: { disposition: { type: 'string', const: 'equivalent' } } },
                    then: { type: 'object', required: ['equivalentTo'], properties: { occurrenceId: { type: 'string', enum: [...targets] } } },
                } : {}) } }
            : { ...entries, maxItems: 0 } } };
        if (stage === 'planning-adjudication') {
            const carries = schema.properties!.implementationCarries!, carry = carries.items!;
            schema = { ...schema, properties: { ...schema.properties, implementationCarries: targets.length
                ? { ...carries, items: { ...carry, properties: { ...carry.properties, occurrenceId: { ...text, enum: [...targets],
                    description: 'Exact retained ordinary occurrence ID. Only a qualified original BASE implementation defect can be carried; a diagnosis, plan objection or missing input is not a BASE repair. The host independently checks origin and every equivalent member/current requirement mapping.' } } } }
                : { ...carries, maxItems: 0 } } };
            const groups = schema.properties!.implementationCarryGroups!, group = groups.items!;
            schema = { ...schema, properties: { ...schema.properties, implementationCarryGroups: targets.length
                ? { ...groups, items: { ...group, properties: { ...group.properties, occurrenceIds: { ...group.properties!.occurrenceIds!, items: { ...text, enum: [...targets] } } } } }
                : { ...groups, maxItems: 0 } } };
        }
    }
    if (diagnosisEligibility) {
        if (role !== 'adjudicator' || !['planning-adjudication', 'review-adjudication', 'raw-assessment'].includes(String(stage))) throw Error('Current diagnosis eligibility requires its assigned adjudication stage');
        const entries = schema.properties!.decisions!, item = entries.items!;
        let constrained: Shape;
        if (!diagnosisEligibility.eligible.length) {
            const properties = { ...item.properties, resolution: { ...enumeration(['repaired']), description: 'No current diagnosis operand is eligible. Preserve committed historical diagnoses; never reissue their old resolution or receipt.' } };
            delete (properties as Record<string, Shape>).diagnosis;
            constrained = { ...item, properties };
        } else {
            const choices = diagnosisEligibility.eligible.map(operand => ({ type: 'object', required: ['occurrenceId', 'disposition', 'diagnosis'], properties: {
                occurrenceId: { ...text, const: operand.occurrenceId }, disposition: { type: 'string', const: 'upheld' },
                diagnosis: object({ outputId: { ...text, const: operand.outputId }, rawSha256: { ...text, const: operand.rawSha256 },
                    inputReceiptHash: { ...text, const: diagnosisEligibility.receiptHash }, materialOccurrenceIds: { type: 'array', description: 'Exact bound sibling ID set. Each ID also requires its separate current decision, including an already resolved sibling; an unrelated historical diagnosis must not be reissued.' + (diagnosisEligibility.version === 2 ? ' The complete typed current diagnosis is the witness. Free-text witnesses may be empty.' : ''), items: operand.materialOccurrenceIds.length ? { ...text, enum: [...operand.materialOccurrenceIds] } : text,
                        minItems: operand.materialOccurrenceIds.length, maxItems: operand.materialOccurrenceIds.length, uniqueItems: true } }),
            } } satisfies Shape));
            constrained = { ...item, allOf: [{ type: 'object', if: { type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', const: 'diagnosed' } } },
                then: { type: 'object', anyOf: choices } }] };
        }
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...entries, ...(entries.items ? { items: constrained } : {}) } } };
    }
    if (decisionReferences && decisionReferences.version >= 2 && decisionReferences.diagnosisOccurrenceIds.length) {
        const entries = schema.properties!.decisions!, item = entries.items!;
        const inactive = decisionReferences.version === 3 && diagnosisEligibility
            ? decisionReferences.diagnosisOccurrenceIds.filter(id => !diagnosisEligibility.eligible.some(operand => operand.occurrenceId === id)) : [];
        const active = decisionReferences.diagnosisOccurrenceIds.filter(id => !inactive.includes(id));
        const conditions: Shape[] = [];
        if (active.length) conditions.push({ type: 'object',
            if: { type: 'object', required: ['occurrenceId'], properties: { occurrenceId: { type: 'string', enum: active } } },
            then: { type: 'object', properties: { resolution: { ...enumeration(reviewResolution ? ['pending', 'diagnosed'] : ['diagnosed']), description: 'A synthetic producer duty has no code repair. A new diagnosis requires the exact current eligible operand.' } } } });
        if (inactive.length) conditions.push({ type: 'object',
            if: { type: 'object', required: ['occurrenceId'], properties: { occurrenceId: { type: 'string', enum: inactive } } },
            then: { type: 'object', ...(reviewResolution ? { properties: { resolution: enumeration(['pending']) } } : { not: { type: 'object', required: ['resolution'] } }), description: 'No new resolution is available for this subject. To retain its committed old row, use retainedDispositions with its exact supplied record ID, or omit the unchanged subject.' } });
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...entries, items: { ...item, allOf: [...item.allOf ?? [], ...conditions] } } } };
    }
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
    if (role === 'adjudicator' && (stage === 'planning-adjudication' || stage === 'source-fit' || sourceFitReferences?.stage === 'review-adjudication') && sourceFit.length) {
        schema = { ...schema, required: [...schema.required!, 'inputDecisions'], properties: { ...schema.properties,
            inputDecisions: { ...schema.properties!.inputDecisions!, minItems: sourceFit.length,
                description: `Return one independent inputDecisions entry for every held tuple, exactly once: ${JSON.stringify(sourceFit)}. Read each actual sourceInputChain text; bind its inputId and directionRevision exactly. Classify impact honestly with a reason and requirementIds from your accepted plan. Compare the actual direction with the accepted requirements, constraints and verification premises. Use explanation when they remain unchanged, including a request to repair a checker so it emits already-required results. Use scope-change when an authorized direction changes one of those obligations or premises. Do not infer a verdict from the hold, copy author acknowledgement as proof, invent requirements or omit an inconvenient input. Use ambiguous when consequential owner clarification is needed. These required identities do not select any classification or release effects; the host separately checks current source and accepted requirements.` +
                    (sourceFitReferences ? ` Captured reference contract: ${JSON.stringify(sourceFitReferences)}. Requirement IDs are distinct from input/source locators. Accepting planning without an owner decision uses only the explicit acceptedPlan.requirements IDs or the qualified unchanged proposal's IDs. Rejected/owner-decision planning does not apply this membership rule. Dedicated source-fit uses only the captured retained IDs and defers membership when asking for an owner decision. Review adjudication always uses the captured retained IDs, including when requesting an owner decision. A stray acceptedPlan never replaces a retained domain. The original submission validator checks these references before provisional acknowledgment; no classification or authority is supplied by this contract.` : '') }
        } };
    }
    if (role === 'adjudicator' && stage === 'review-adjudication') {
        const decisions = schema.properties!.decisions!, item = decisions.items!;
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...decisions, items: { ...item, properties: { ...item.properties, witnesses: { ...item.properties!.witnesses!, description: "When choosing disposition upheld with resolution repaired, include as a separate unchanged witnesses array element the id of an actually supplied passing context.checks record for the current candidate and verification. Use that check-run record id, not its logical check_id, assertion id, case id, a prefix/suffix or constructed locator. Case-qualified evidence may be supplementary but cannot replace the bare check-run id. Include only existing evidence; if the required current passing record is absent, do not invent an id or claim repaired. This instruction does not select a verdict, certify semantic repair, authorize another resolution or close an obligation." } } } } } };
    }
    if (constraints.currentRepairWitnessIds !== undefined) {
        const ids = constraints.currentRepairWitnessIds;
        if (role !== 'adjudicator' || stage !== 'review-adjudication' || !Array.isArray(ids) ||
            ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
            throw Error('Current repair witness schema requires distinct review check identities');
        const entries = schema.properties!.decisions!, item = entries.items!;
        const repaired: Shape = { type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', const: 'repaired' } } };
        const currentCheck: Shape = ids.length
            ? { type: 'object', properties: { witnesses: { type: 'array', contains: { type: 'string', enum: [...ids] } } } }
            : { type: 'object', not: { type: 'object' } };
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...entries, items: { ...item,
            properties: { ...item.properties, witnesses: { ...item.properties!.witnesses!,
                description: 'Proof belongs to this action in the final decision graph. Repaired needs a separate literal current passing check ID from the supplied enum. Equivalence that reaches a resolved target also needs meaningful witnesses in this output; empty witnesses are legal only when its entire final target chain stays pending. Prior verification versions, execution run IDs and a satisfied verificationDecisions entry do not substitute for this decision’s repair witnesses. Evidence membership does not establish equivalence or semantic repair.' } },
            allOf: [...(item.allOf ?? []), { type: 'object', if: repaired, then: currentCheck }],
        } } } };
    }
    if (role === 'adjudicator' && stage !== undefined && !['planning-adjudication', 'review-adjudication', 'raw-assessment'].includes(stage)) {
        const decisions = schema.properties!.decisions!, item = decisions.items!;
        schema = { ...schema, properties: { ...schema.properties, decisions: { ...decisions, items: { ...item, properties: Object.fromEntries(Object.entries(item.properties!).filter(([key]) => key !== 'diagnosis').map(([key, value]) => [key, key === 'resolution' ? enumeration(['repaired']) : value])) } } } };
    }
    if (role === 'adjudicator' && stage !== undefined && stage !== 'planning-adjudication')
        schema = { ...schema, properties: Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => !['implementationCarries', 'implementationCarryGroups'].includes(key))) };
    if (planningProfile && (role === 'planner' && stage === 'planning' || role === 'adjudicator' && stage === 'planning-adjudication')) {
        const field = role === 'planner' ? 'plan' : 'acceptedPlan';
        const originalProposal=schema.properties![field]!,originalVerification=originalProposal.properties!.verification!;
        const baseShape = { ...strategyShapes['base-execution-duty'], properties: { ...strategyShapes['base-execution-duty'].properties,
            checkId: { ...strategyShapes['base-execution-duty'].properties!.checkId!, description: 'ID of an original immutable BASE-only check. It must exit zero and match every declared case and assertion state: default all true; captured grammar3 may name a nonempty baselineExpectedFailures subset whose actual states must be false, with all other states true. Record actual states truthfully. Candidate checks always require all true.' } } };
        const profileStrategies = planningProfile.version >= 3 ? { ...strategyShapes, 'base-execution-duty': baseShape } : strategyShapes;
        const profileParts = planningProfile.version >= 3 ? { ...strategyPartShapes, 'base-execution-duty': strategyPartShape(baseShape) } : strategyPartShapes;
        let proposal: Shape=planningProfile.version>=2?{...originalProposal,properties:{...originalProposal.properties,verification:{...originalVerification,properties:{...originalVerification.properties,strategies:{...originalVerification.properties!.strategies!,items:{type:'object',anyOf:Object.values(profileStrategies)}}}}}}:originalProposal;
        if (planningProfile.version >= 3) {
            const current = proposal.properties!.verification!;
            proposal = { ...proposal, properties: { ...proposal.properties, verification: { ...current, properties: { ...current.properties, checks: { ...current.properties!.checks!, items: checkShape(planningProfile.version) },
                ...(planningProfile.version >= 12 ? {checkAmendments:list(checkAmendmentShape(planningProfile.version))} : {}) } } } };
        }
        if (planningProfile.version >= 6) {
            const { requirements, ...properties } = proposal.properties!;
            proposal = { ...proposal, properties: { ...properties, verificationRequirements: { ...requirements!,
                description: 'Actual requirements needing the supported consumer, immutable BASE-observation or file-scope evidence. Preserve every original owner obligation. Put mandated commands/time limits in check definitions, required independent review in reviewRoles and managed procedures, final-report language in the conversation/source obligations, and action limits in original delegation. Those operating duties are not consumer or BASE guarantees; do not invent a verification requirement or BASE strategy merely to repeat them. A genuine owner-required before-first-edit BASE observation belongs here. Sources and independent completeness judgment remain mandatory.' } },
                required: proposal.required!.map(key => key === 'requirements' ? 'verificationRequirements' : key) };
        }
        if (planningProfile.version >= 8) {
            // Advertise the minima already required by the host for every supplied
            // plan. Older captured schema recipes remain byte-for-byte unchanged.
            const current = proposal.properties!.verification!;
            proposal = { ...proposal, properties: { ...proposal.properties,
                verificationRequirements: { ...proposal.properties!.verificationRequirements!, minItems: 1 },
                verification: { ...current, properties: { ...current.properties,
                    reviewRoles: { ...current.properties!.reviewRoles!, minItems: 1 } } } } };
        }
        const verification=proposal.properties!.verification!;
        if(role==='adjudicator'&&planningProfile.version>=2)schema={...schema,properties:{...schema.properties,acceptedPlan:proposal}};
        const constrained = { ...proposal, properties: { ...proposal.properties, verification: planningProfile.supported
            ? { ...verification, properties: { ...verification.properties, strategies: { ...verification.properties!.strategies!, items: { type: 'object', anyOf: planningProfile.allowedKinds.map(kind => kind !== 'all-of' ? profileStrategies[kind] : {...profileStrategies['all-of'],properties:{...profileStrategies['all-of'].properties,parts:{...profileStrategies['all-of'].properties!.parts!,items:{type:'object',anyOf:planningProfile.allowedKinds.filter(kind=>kind!=='all-of').map(kind=>profileParts[kind as keyof typeof profileParts])}}}}) } } }, required: [...verification.required!, 'strategies'], description: planningProfile.version >= 6 ? 'Account for every verificationRequirements entry using the supported closed strategies. Operating duties remain in the original source and their actual check/review/report/delegation channels; do not manufacture BASE or consumer evidence for them. A well-formed partial proposal still needs a blocking finding and independent correction. Acceptance requires complete accounting and preservation of all owner intent.' : 'Account for every accepted requirement using the supported closed strategies. A planner may retain an incomplete proposal only with an explicit blocking finding; do not invent a strategy or remove owner requirements. Acceptance requires complete accounting.' }
            : { ...verification, properties: Object.fromEntries(Object.entries(verification.properties!).filter(([key]) => key !== 'strategies')), description: planningProfile.reason ?? 'Finite mixed planning capability unavailable' } } };
        if (role === 'planner') schema = { ...schema, properties: { ...schema.properties, plan: constrained } };
        else if (planningProfile.supported && !(planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation)) {
            // Native tool input rejects root unions. Factor the same two boolean
            // branches into the existing conditional vocabulary: only acceptance
            // requires a constrained plan and the captured criteria decision.
            const { if: criteriaCondition, then: criteriaRequirement, ...common } = schema;
            schema = { ...common, required: [...schema.required!, 'planAccepted'],
                if: { type: 'object', required: ['planAccepted'], properties: { planAccepted: { type: 'boolean', const: true } } },
                // The root already validates the complete plan and each strategy.
                // Acceptance adds presence and the captured strategy-kind domain.
                then: { type: 'object', required: approval ? [] : ['acceptedPlan'], properties: { acceptedPlan: { type: 'object', properties: {
                    verification: { type: 'object', required: ['strategies'], properties: {
                        strategies: { type: 'array', items: planningProfile.version>=2?constrained.properties.verification.properties!.strategies!.items!:{ type: 'object', properties: { kind: enumeration(planningProfile.allowedKinds) } } },
                    }, description: constrained.properties.verification.description },
                }, ...(approval ? { description: 'Omit only to approve the exact supplied version1 bound proposal unchanged. Any supplied amendment must be a complete valid plan; null never means approval.' } : {}) } },
                    ...(criteriaCondition ? { if: criteriaCondition, then: criteriaRequirement } : {}) } };
        }
        else if (planningProfile.supported) schema = { ...schema, required: [...schema.required!, 'planAccepted'], properties: { ...schema.properties, planAccepted: { type: 'boolean', const: false } }, description: 'The retained before-edit duty has no supported cross-plan historical mapping. Decline acceptance without inventing or removing that duty.' };
        else schema = { ...schema, properties: { ...schema.properties, acceptedPlan: constrained } };
        if (planningProfile.version >= 6) {
            // Transform the final shape, including constrained strategy variants
            // and adjudicator conditionals, without mutating historical recipes.
            const describe = (value: unknown): unknown => Array.isArray(value) ? value.map(describe)
                : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) =>
                    [key, key === 'description' && typeof item === 'string' ? item.replaceAll('this plan.requirements', 'this plan.verificationRequirements') : describe(item)])) : value;
            schema = describe(schema) as Shape;
        }
    }
    if (planningProfile && planningProfile.version >= 7 && (role === 'planner' && stage === 'planning' || role === 'challenger' && stage === 'planning-challenge' || role === 'adjudicator' && stage === 'planning-adjudication')) {
        const findings = schema.properties!.findings!, item = findings.items!;
        schema = { ...schema, properties: { ...schema.properties, findings: { ...findings, items: { ...item,
            properties: { ...item.properties, requirementId: { ...item.properties!.requirementId!,
                description: 'Identity of the actual current, original or historical task obligation alleged by this finding. It is not an enum over the current plan verificationRequirements: operating and historical allegations may lie outside that verification subset. Preserve original identity and judge relevance independently. This does not loosen exact check/case/strategy/current carry references.' } } } } } };
    }
    if (decisionReferences?.version === 3) {
        const ids = decisionReferences.retentionChoices.map(choice => choice.dispositionId);
        schema = { ...schema, properties: { ...schema.properties, retainedDispositions: { ...texts,
            ...(ids.length ? { items: { ...text, enum: ids }, uniqueItems: true } : { maxItems: 0 }),
            description: 'Optionally name exact supplied retentionChoices.dispositionId values to acknowledge their immutable old rows, instead of reissuing old diagnosed/repaired/upheld decisions. No new disposition, diagnosis, assignment or standing is created. Normal derived pending-state changes still apply. Never combine retention with a new decision for the same occurrence.' } } };
    }
    if (constraints.planningRepair !== undefined) {
        const profile = capturePlanningRepair(constraints.planningRepair);
        if (role !== 'adjudicator' || stage !== 'planning-adjudication')
            throw Error('Plan repair schema needs its original ordinary planning subjects');
        assertPlanningRepairSubjects(profile, decisionReferences);
        const decisions = schema.properties!.decisions!, item = decisions.items!;
        const repairs = planningRepairSubjects(profile).map(subject => {
            const coverage = profile.version === 2 && subject === profile.verification;
            return {type:'object' as const, properties:{occurrenceId:{type:'string' as const,const:subject.occurrenceId},
                resolution:{type:'string' as const,const:coverage?'pending':'repaired'},
                repair:{type:'object' as const,properties:{kind:{type:'string' as const,const:coverage?'verification-plan':'plan'},proposalHash:{type:'string' as const,const:subject.proposalHash}}}}};
        });
        const resolution = item.properties!.resolution!;
        schema = {...schema, properties: {...schema.properties, decisions: {...decisions, items: {...item,
            properties: {...item.properties, repair:profile.version === 2 ? coveragePlanRepair : planRepair,
                ...(profile.version === 2 ? {resolution:{...resolution,enum:[...resolution.enum!, 'pending']}} : {})}, allOf: [...(item.allOf ?? []), {
                type:'object', if:{type:'object',required:['repair']}, then: repairs.length ? {
                    type:'object', required:['resolution'], properties:{disposition:{type:'string',const:'upheld'},
                        ...(profile.version === 1 ? {resolution:{type:'string' as const,const:'repaired'}} : {}),witnesses:{...texts,minItems:1}},
                    anyOf:profile.version === 2 ? repairs : profile.subjects.map(subject=>({type:'object',properties:{occurrenceId:{type:'string',const:subject.occurrenceId},repair:{type:'object',properties:{proposalHash:{type:'string',const:subject.proposalHash}}}}})),
                    allOf:['implementation','implementationCarry','diagnosis'].map(field=>({type:'object',not:{type:'object',required:[field]}})),
                } : {type:'object',not:{type:'object'}},
            }, ...(profile.version === 2 ? [{type:'object' as const, if:{type:'object' as const,required:['resolution'],
                properties:{resolution:{type:'string' as const,const:'pending'}}}, then:{type:'object' as const,required:['repair']}}] : [])],
        }}}};
    }
    if (constraints.decisionCarry !== undefined) {
        const format = captureDecisionCarry(constraints.decisionCarry);
        if (role !== 'adjudicator' || stage !== 'planning-adjudication') throw Error('Decision-local carry requires planning adjudication');
        if (format.version >= 2 && decisionReferences?.version !== 3) throw Error('Implementation actions require version3 reference capture');
        const assigned = format.version === 3 ? sourceQualifiedImplementationShape(format.baselineVersion,format.baseSourceIds) : assignedImplementation;
        const action = format.version === 3 ? {...implementationAction,anyOf:[assigned,noImplementation]} : implementationAction;
        const entries = schema.properties!.decisions!, item = entries.items!;
        const ordinary = decisionReferences?.occurrenceIds.filter(id => !decisionReferences.diagnosisOccurrenceIds.includes(id));
        const key = format.version === 1 ? 'implementationCarry' : 'implementation';
        const field = format.version === 1 ? { ...decisionImplementationCarry,
            properties: { ...decisionImplementationCarry.properties, requirementIds: { ...texts, minItems: 1, uniqueItems: true } },
            description: "Explicitly assign THIS decision's occurrenceId to implementation using its own reason as the BASE/current-requirement rationale. Every pending equivalent needs its own explicit field; equivalence alone is not carry." } : { ...action, description: 'ORDINARY occurrences only: never include implementation on diagnosisOccurrenceIds, even {kind:"none"}. For an unchanged committed diagnostic, use its retainedDispositions choice without a fresh decision. ' + action.description };
        const properties = { ...item.properties, ...(ordinary?.length === 0 ? {} : { [key]: field }) };
        const localItem: Shape = { ...item, properties,
            allOf: [...(item.allOf ?? []), { type: 'object', if: { type: 'object', required: [key] },
                // Root properties stay closed. A carry only narrows validity,
                // ordinary membership and the separate absence of each resolution field.
                then: { type: 'object', properties: {
                    disposition: enumeration(['upheld', 'equivalent']), ...(ordinary?.length ? { occurrenceId: { ...text, enum: ordinary } } : {}) },
                    allOf: ['resolution', 'diagnosis'].map(field => ({ type: 'object', not: { type: 'object', required: [field] } })),
                } }],
        };
        schema = { ...schema, properties: {
            ...Object.fromEntries(Object.entries(schema.properties!).filter(([name]) => !['implementationCarries', 'implementationCarryGroups'].includes(name))),
            decisions: { ...entries, items: localItem },
        } };
        if (format.version >= 2 && decisionReferences?.version === 3) {
            const refs = decisionReferences, blocking = refs.blockingOrdinaryIndexes.map(index => refs.occurrenceIds[index]!);
            const noResolution: Shape = { type: 'object', not: { type: 'object', required: ['resolution'] } };
            const currentChoices: Shape[] = ordinary?.length ? [{ type: 'object',
                if: { ...noResolution, required: ['occurrenceId', 'disposition'], properties: { occurrenceId: { ...text, enum: ordinary }, disposition: enumeration(['upheld', 'equivalent']) } },
                then: { type: 'object', required: ['implementation'] } }] : [];
            if (blocking.length) currentChoices.push({ type: 'object',
                if: { ...noResolution, required: ['occurrenceId', 'disposition'], properties: { occurrenceId: { ...text, enum: blocking }, disposition: { type: 'string', const: 'upheld' } } },
                then: { type: 'object', properties: { implementation: assigned }, required: ['implementation'] } });
            // Native formatter tools refuse root combinators. Preserve both
            // independent conditions inside an object-root conditional instead.
            const { if: priorCondition, then: priorRequirement, allOf: priorConjunction, ...root } = schema;
            schema = { ...root, if: { type: 'object' }, then: { type: 'object', allOf: [
                ...(priorCondition ? [{ type: 'object', if: priorCondition, ...(priorRequirement ? { then: priorRequirement } : {}) }] : []),
                ...(priorConjunction ?? []), { type: 'object',
                if: { type: 'object', required: ['planAccepted'], properties: { planAccepted: { type: 'boolean', const: true }, ownerDecisionRequired: { ...texts, maxItems: 0 } } },
                // The unconditional items already enforce localItem. Add only
                // acceptance-specific constraints rather than repeating its schema.
                then: { type: 'object', properties: { decisions: { type: 'array', minItems: refs.pendingOrdinaryIndexes.length,
                    items: { type: 'object', ...(currentChoices.length ? { allOf: currentChoices } : {}) },
                    description: 'Account for EVERY captured pendingOrdinaryIndexes member using occurrenceIds as the original dictionary. Each ordinary upheld/equivalent member chooses implementation explicitly. none is not inherited carry or proof of closure. A newly assigned target needs assign-to-plan on each equivalent member. Fresh target judgments override historical closure.' } } } }] } };
        }
    }
    if (role === 'adjudicator' && stage === 'raw-assessment') {
        const fields = new Set(['version','summary','findings','assessedScope','decisions','ownerDecisionRequired']);
        schema = {...schema,properties:Object.fromEntries(Object.entries(schema.properties!).filter(([key])=>fields.has(key)))};
    }
    if (reviewResolution) {
        const optionalSubjects = optionalReviewSubjects(reviewResolution, decisionReferences);
        const excluded = new Set(['acceptedPlan', 'planAccepted', 'criteriaDecision', 'payloadDecision', 'implementationCarries', 'implementationCarryGroups']);
        const entries = schema.properties!.decisions!, item = entries.items!, resolution = item.properties!.resolution!;
        schema = { ...schema, properties: { ...Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => !excluded.has(key))),
            decisions: { ...entries, items: { ...item, properties: { ...item.properties,
                resolution: { ...resolution, enum: [...resolution.enum!, 'pending'], description: reviewResolution.version === 4 ? 'For an upheld optional observation that needs no further action, omit resolution and cite retained evidence. Otherwise choose pending, repaired or diagnosed.' : reviewResolution.version === 3 ? 'Every upheld decision chooses pending, repaired or diagnosed. Pending remains open regardless of severity and conveys no completion authority. Ordinary pending validity can use retained finding evidence with empty witnesses; synthetic duties still require retained witnesses. Repair and diagnosis require actual current eligible evidence.' : 'For every upheld decision explicitly choose pending, repaired or diagnosed. Pending keeps the obligation open. Repaired requires actual current repair witnesses. Diagnosed requires the eligible original producer evidence. Validity and completion are separate choices.' } },
                allOf: [...item.allOf ?? [],
                    { type: 'object', if: { type: 'object', required: ['disposition'], properties: { disposition: { type: 'string', const: 'upheld' } },
                        ...(optionalSubjects.length ? { not: { type: 'object', properties: { occurrenceId: { type: 'string', enum: optionalSubjects } }, required: ['occurrenceId'] } } : {}) }, then: { type: 'object', required: ['resolution'] } },
                    ...(optionalSubjects.length ? [{ type: 'object', if: { type: 'object', required: ['disposition', 'occurrenceId'],
                        properties: { disposition: { type: 'string', const: 'upheld' }, occurrenceId: { type: 'string', enum: optionalSubjects } },
                        not: { type: 'object', required: ['resolution'] } }, then: { type: 'object', properties: { witnesses: { type: 'array', minItems: 1 } } } } satisfies Shape] : []),
                    { type: 'object', if: { type: 'object', required: ['resolution'] }, then: { type: 'object', properties: { disposition: { type: 'string', const: 'upheld' } } } },
                    { type: 'object', if: { type: 'object', required: ['diagnosis'] }, then: { type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', const: 'diagnosed' } } } },
                    { type: 'object', if: { type: 'object', required: ['resolution'], properties: { resolution: { type: 'string', const: 'diagnosed' } } }, then: { type: 'object', required: ['diagnosis'] } },
                ] } } } };
    }
    if (constraints.subjectActions) {
        if (role !== 'adjudicator' || constraints.subjectActions.stage !== stage || !decisionReferences) throw Error('Subject action schema requires its captured ordinary adjudication');
        return subjectActionSchema(schema as unknown as Record<string, unknown>, constraints.subjectActions, decisionReferences) as unknown as Shape;
    }
    return schema;
}

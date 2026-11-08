import { isPlanningGrammar, type PlanningGrammar } from './types.js';
import { assertPlanningRepairSubjects, capturePlanningRepair, isVerificationPlanRepair } from './planning-repair.js';
import { captureScopeAmendment, validateScopeAmendmentDecisions } from './scope-amendment.js';
import {hasCompleteStrategyAccounting,verificationStrategyLeaves,verificationStrategySupported} from './verification-strategy.js';
import { optionalReviewSubjects, assertSupportedRoleProfile, captureDecisionCarry, captureDiagnosisEligibility, captureDecisionReferences, captureProposalApproval, captureReviewResolution, captureSourceFitReferences, assertSourceFitTuples, sourceFitRequirementDomain } from './role-input.js';
import { isOwnedRelativeInputPath } from './owned-input-path.js';
import { roleOutputSchema, checkShape, checkAmendmentShape, protocolShapes as shapes, roleShapes, protocolEnums, scopeAmendmentShape, sourceQualifiedImplementationShape, type Shape } from './role-output-shape.js';
import { parseUniqueJson, wholeJsonFence } from './json.js';
import { captureSubjectActionProfile, decodeSubjectActionOutput } from './subject-actions.js';
import { assertImplementationAccounting, retainedDispositionRequests } from './adjudication-accounting.js';
import type { Role, RoleResult, CheckOutput, PlanProposal, Finding, SourceFitRequirement, RoleOutputConstraints, ImplementationCarry, VerificationStrategy, Disposition } from './types.js';
export const MAX_FINAL_BYTES = 128 * 1024;
const roles = protocolEnums.roles;
type ObjectValue = Record<string, unknown>;
function fail(message: string): never { throw new Error(message); }
function missingStrategyDetails(proposal: PlanProposal, collection: string): string {
    const covered = new Set(proposal.verification.strategies?.map(strategy => strategy.requirementId));
    const missing = proposal.requirements.filter(requirement => !covered.has(requirement.id));
    const shown = missing.slice(0, 8).map(({id}) => {
        const points = Array.from(id);
        return { value: points.slice(0, 64).join(''), omittedCodePoints: Math.max(0, points.length - 64) };
    });
    // JSON escapes C0 controls; escape terminal direction and line controls too.
    const encoded = JSON.stringify(shown).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
        char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
    return `${collection}: missingRequirementIds=${encoded}; omittedRequirementIds=${missing.length - shown.length}. Values with omittedCodePoints>0 are previews, not complete IDs.`;
}
function objectIssue(value: unknown, shape: Shape, field?: string): string | undefined {
    const location = field ? field + ': ' : '';
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return location + 'Expected object';
    const unexpected = Object.keys(value).filter(key => !Object.hasOwn(shape.properties!, key));
    const missing = shape.required!.filter(key => !(key in value));
    if (unexpected.length || missing.length) {
        const names = (keys: string[]) => JSON.stringify(keys.slice(0, 6).map(key => key.length > 80 ? key.slice(0, 80) + '…' : key))
            .replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
                char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')) +
            (keys.length > 6 ? ` (${keys.length - 6} more)` : '');
        const details = [
            ...(missing.length ? ['missing ' + names(missing)] : []),
            ...(unexpected.length ? ['unexpected ' + names(unexpected)] : []),
        ];
        return location + 'Unexpected or missing fields: ' + details.join(', ');
    }
}
function object(value: unknown, shape: Shape, field?: string): ObjectValue {
    const issue = objectIssue(value, shape, field);
    if (issue) fail(issue);
    return value as ObjectValue;
}
/** Prospective wire names do not apply to already canonical stored proposals. */
function planRequirementsIssue(value: unknown, key: 'plan' | 'acceptedPlan', grammar: number, hasApproval: boolean): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return `${key} must be an object`;
    const wire = value as ObjectValue;
    if (Object.hasOwn(wire, 'requirements'))
        return `Planning grammar${grammar} forbids ${key}.requirements on the wire; emit only ${key}.verificationRequirements. Canonical historical requirements are not a second wire alias.`;
    if (!Object.hasOwn(wire, 'verificationRequirements')) {
        if (key === 'acceptedPlan' && hasApproval && !Object.keys(wire).length)
            return 'acceptedPlan is empty. Omit acceptedPlan to approve the bound unchanged proposal, or supply the full corrected plan.';
        return `Planning grammar${grammar}: missing ${key}.verificationRequirements. Declare the nonempty list of actual verification requirements (id, text, source) before referencing requirement IDs in checks or strategies.`;
    }
    return objectIssue(wire.verification, shapes.verification, key + '.verification');
}
function text(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 32768)
        fail('Expected bounded nonempty text');
}
function array(value: unknown, check: (v: unknown, index: number) => void): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > 1024)
        fail('Expected bounded array');
    value.forEach(check);
}
function texts(value: unknown) { array(value, text); }
function uniqueIds(value: unknown, label: string) {
    const seen = new Set<string>();
    array(value, item => {
        const id = (item as ObjectValue).id as string;
        if (seen.has(id))
            fail(`Duplicate ${label} ID`);
        seen.add(id);
    });
}
function uniqueTexts(value: unknown, label: string) {
    texts(value);
    if (new Set(value as string[]).size !== (value as string[]).length)
        fail(`Duplicate ${label}`);
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
        fail('Expected positive bounded integer');
}
function one(value: unknown, allowed: readonly unknown[]) {
    if (!allowed.includes(value))
        fail('Unexpected enum value');
}
function requirement(value: unknown) { const r = object(value, shapes.requirement); Object.values(r).forEach(text); }
function relativePaths(value: unknown, field: string) {
    uniqueTexts(value, 'expectation path');
    for (const [index, p] of (value as string[]).entries())
        if (!isOwnedRelativeInputPath(p))
            fail(`Expected relative owned input path at ${field}[${index}]`);
}
function machineText(value: unknown, maximum = 16384) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > maximum || Buffer.from(value, 'utf8').toString('utf8') !== value)
        fail('Expected bounded exact UTF8 value');
}
function observation(value: unknown) {
    const r = object(value, shapes.observation);
    one(r.kind, protocolEnums.observation);
    machineText(r.value);
}
function verificationCase(value: unknown) {
    const r = object(value, shapes.verificationCase);
    text(r.id);
    one(r.kind, protocolEnums.caseKind);
    uniqueTexts(r.guaranteeIds, 'case guarantee');
    text(r.derivation);
    relativePaths(r.consumerPaths, 'case.consumerPaths');
    const input = object(r.input, shapes.caseInput);
    machineText(input.literalUtf8);
    relativePaths(input.fixturePaths, 'case.input.fixturePaths');
    observation(r.expected);
    if (!(r.guaranteeIds as unknown[]).length || !(r.consumerPaths as unknown[]).length)
        fail('Case needs guarantee and actual consumer');
}
function check(value: unknown, grammar: PlanningGrammar = 1) {
    const shape = checkShape(grammar);
    const r = object(value, shape);
    if ('cases' in r) {
        array(r.cases, verificationCase);
        uniqueIds(r.cases, 'case');
        if ((r.cases as unknown[]).length > 64)
            fail('Case roster exceeds64');
    }
    if ('consumerControl' in r) {
        const control = object(r.consumerControl, shape.properties!.consumerControl!);
        relativePaths([control.path, ...(Object.hasOwn(control, 'replacementPath') ? [control.replacementPath] : [])], 'consumerControl paths');
        uniqueTexts(control.failedAssertions, 'control failed assertion');
        array(control.observations, value => {
            const item = object(value, shapes.consumerControl.properties!.observations!.items!);
            text(item.id);
            observation(item.observed);
        });
        uniqueIds(control.observations, 'control observation');
        const observations = (control.observations as unknown[]).length;
        if (observations > 64 || grammar < 11 && !observations)
            fail('Control requires 1–64 exact case observations');
        if (!observations && (control.failedAssertions as unknown[]).length)
            fail('An expected-pass consumer control requires empty observations and failedAssertions');
    }
    text(r.id);
    texts(r.guaranteeIds);
    text(r.command);
    uniqueTexts(r.assertions, 'check assertion ID');
    integer(r.timeoutMs, 300000);
    texts(r.fixturePaths);
    if ('baselineExpectedFailures' in r) {
        uniqueTexts(r.baselineExpectedFailures, 'expected BASE failure assertion ID');
        if (!(r.baselineExpectedFailures as string[]).length || (r.baselineExpectedFailures as string[]).some(id => !(r.assertions as string[]).includes(id))) fail('Expected BASE failures require a nonempty subset of declared assertions');
    }
    if ('expectationPaths' in r)
        relativePaths(r.expectationPaths, 'check.expectationPaths');
    if (!(r.assertions as unknown[]).length || !(r.guaranteeIds as unknown[]).length)
        fail('Check needs guarantees and assertions');
}
function plan(value: unknown, grammar: PlanningGrammar = 1, field = 'plan'): asserts value is PlanProposal {
    const r = object(value, shapes.plan, field);
    text(r.intent);
    array(r.requirements, requirement);
    uniqueIds(r.requirements, 'requirement');
    text(r.approach);
    text(r.simplerAlternative);
    texts(r.factualSources);
    texts(r.ambiguities);
    const v = object(r.verification, shapes.verification, field + '.verification');
    if ('checkAmendments' in v) {
        const seen = new Set<string>();
        array(v.checkAmendments, item => {
            checkAmendment(item, grammar);
            const id = (item as ObjectValue).obligationId as string;
            if (seen.has(id))
                fail('Duplicate amended obligation');
            seen.add(id);
        });
    }
    if ('strategies' in v) {
        array(v.strategies, value=>verificationStrategy(value,grammar));
        const requirements = new Set((r.requirements as { id: string }[]).map(requirement => requirement.id)), seen = new Set<string>();
        for (const [index, strategy] of (v.strategies as { requirementId: string }[]).entries()) {
            if (seen.has(strategy.requirementId)) fail(`verification.strategies[${index}].requirementId repeats an earlier strategy requirement`);
            if (!requirements.has(strategy.requirementId)) fail(`verification.strategies[${index}].requirementId is not declared in this plan.requirements`);
            seen.add(strategy.requirementId);
        }
    }
    array(v.checks, value => check(value, grammar));
    uniqueIds(v.checks, 'check');
    const leaves = ((v.strategies ?? []) as VerificationStrategy[]).flatMap(verificationStrategyLeaves);
    for (const check of v.checks as PlanProposal['verification']['checks'])
        if (Object.hasOwn(check, 'baselineExpectedFailures') &&
            (!leaves.some(strategy => strategy.kind === 'base-execution-duty' && strategy.checkId === check.id) ||
                leaves.some(strategy => strategy.kind === 'consumer-cases' && strategy.checkIds.includes(check.id))))
            fail('Expected assertion failures require a BASE-only check');
    texts(v.requiredPaths);
    const rosterKeys = new Set<string>();
    array(v.reviewRoles, x => {
        const position = object(x, shapes.reviewPosition);
        text(position.key);
        one(position.kind, protocolEnums.reviewer);
        text(position.purpose);
        texts(position.requiredPaths);
        if (rosterKeys.has(position.key))
            fail('Duplicate review roster key');
        rosterKeys.add(position.key);
    });
    if (!(r.requirements as unknown[]).length || !(v.reviewRoles as unknown[]).length)
        fail('Plan needs requirements and review roster');
}
function verificationStrategy(value: unknown, grammar: PlanningGrammar = 1) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected verification strategy');
    const kind = (value as ObjectValue).kind;
    if (typeof kind !== 'string' || !Object.hasOwn(shapes.strategyShapes, kind)) fail('Unsupported verification strategy');
    const r = object(value, shapes.strategyShapes[kind as keyof typeof shapes.strategyShapes]);
    text(r.requirementId);
    if (kind === 'all-of') { if(grammar<2)fail('Composite strategy requires captured version2 grammar');for (const leaf of verificationStrategyLeaves(r as unknown as VerificationStrategy)) verificationStrategy(leaf,grammar); return; }
    if (kind === 'consumer-cases') { uniqueTexts(r.checkIds, 'strategy check'); if (!(r.checkIds as unknown[]).length) fail('Strategy requires actual checks'); }
    else if (kind === 'base-execution-duty') { text(r.checkId); uniqueTexts(r.caseIds, 'baseline case'); text(r.reviewKey); if (!(r.caseIds as unknown[]).length) fail('Baseline requires concrete subject cases'); }
    else { relativePaths(r.allowedChangePaths, 'strategy.allowedChangePaths'); relativePaths(r.unchangedPaths, 'strategy.unchangedPaths'); text(r.reviewKey); }
}
function verificationDecision(value: unknown) {
    const r = object(value, shapes.verificationDecision);
    text(r.requirementId); text(r.reason);
    if (typeof r.strategyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.strategyDigest)) fail('Expected strategy SHA256');
    uniqueTexts(r.witnessIds, 'strategy witness');
    one(r.verdict, ['satisfied', 'unavailable']);
    if (!(r.witnessIds as unknown[]).length && r.verdict === 'satisfied') fail('Satisfied strategy needs actual witnesses');
}
function checkAmendment(value: unknown, grammar: PlanningGrammar) {
    const shape = checkAmendmentShape(grammar);
    const r = object(value, shape);
    for (const key of ['obligationId', 'failedCheckRunId', 'correctedCheckId', 'reason'])
        text(r[key]);
    one(r.basis, protocolEnums.amendmentBasis);
    relativePaths(r.fixturePaths, 'checkAmendment.fixturePaths');
    uniqueTexts(r.negativeAssertions, 'negative assertion');
    for (const key of ['caseIds', 'negativeCaseIds'])
        if (key in r)
            uniqueTexts(r[key], key);
    if (!(r.fixturePaths as unknown[]).length && !(r.caseIds as unknown[] | undefined)?.length)
        fail('Amendment needs exact changed files or case operands');
    if (!(r.negativeAssertions as unknown[]).length && !(r.negativeCaseIds as unknown[] | undefined)?.length)
        fail('Amendment needs actual negative assertion or case');
    if ('ownerInputId' in r)
        text(r.ownerInputId);
    if ('negativeReplacement' in r) {
        const replacement = object(r.negativeReplacement, shape.properties!.negativeReplacement!);
        relativePaths([replacement.path], 'checkAmendment.negativeReplacement.path');
        boundedReplacement(replacement.text);
        if (r.basis !== 'fixture-defect')
            fail('Candidate-derived negative replacement is available only for a fixture defect');
    }
    if (r.basis === 'owner-requirement-revision' && !r.ownerInputId)
        fail('Requirement revision needs actual owner input');
}
function boundedReplacement(value: unknown) {
    machineText(value, 65536);
    if (!(value as string).length || Buffer.byteLength(value as string) > 65536 || (value as string).includes('\0'))
        fail('Invalid bounded consumer replacement');
}
function checkResolution(value: unknown) {
    const r = object(value, shapes.checkResolution);
    text(r.amendmentId);
    one(r.disposition, protocolEnums.checkDisposition);
    text(r.reason);
    uniqueTexts(r.witnesses, 'check resolution witness');
    if (!(r.witnesses as unknown[]).length)
        fail('Check resolution needs actual witnesses');
}
function criteriaDecision(value: unknown) {
    const r = object(value, shapes.criteriaDecision);
    for (const key of ['sourceId', 'fromContractsVersion', 'toContractsVersion', 'reason'])
        text(r[key]);
    one(r.verdict, protocolEnums.criteriaVerdict);
}
/** Only mandatory claim meaning; optional invalid raw extras acquire no proof/patch authority. */
export function assertFindingCore(value: unknown): asserts value is Pick<Finding, 'requirementId' | 'severity' | 'repair' | 'description' | 'evidence'> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('Expected finding core object');
    const r = value as ObjectValue;
    if (shapes.finding.required!.some(key => !(key in r)))
        fail('Missing finding core field');
    text(r.requirementId);
    one(r.severity, protocolEnums.severity);
    one(r.repair, protocolEnums.repair);
    text(r.description);
    texts(r.evidence);
}
/** Current disposition mechanics shared by fresh feedback and effect admission.
 * This is not historical syntax decoding, source proof or semantic acceptance. */
export function assertDispositionEvidence(decision: Disposition, finding: unknown, synthetic: boolean, diagnosisWitness?: Disposition['diagnosis']): void {
    const pendingJudgment = !synthetic && (decision.disposition === 'equivalent' ||
        decision.disposition === 'upheld' && (decision.resolution === 'pending' ||
            (finding as {severity?:unknown} | null)?.severity === 'blocking' && decision.resolution === undefined));
    if (!decision.witnesses.length && pendingJudgment) {
        try { assertFindingCore(finding); }
        catch { throw Error(`Pending disposition requires retained ordinary finding: ${decision.occurrenceId}`); }
    }
    const typedWitness = synthetic && decision.disposition === 'upheld' && decision.resolution === 'diagnosed' &&
        matchesDiagnosisWitness(decision.diagnosis, diagnosisWitness);
    if (!decision.reason.trim() || !decision.witnesses.length && !pendingJudgment && !typedWitness)
        throw Error(`Disposition needs retained reason/witness: ${decision.occurrenceId}. Supply actual retained evidence for this outcome; a reason alone is not a witness. Do not invent evidence.`);
}

function matchesDiagnosisWitness(diagnosis: Disposition['diagnosis'], witness?: ReadonlyDiagnosisWitness): boolean {
    return !!diagnosis && !!witness && diagnosis.outputId === witness.outputId && diagnosis.rawSha256 === witness.rawSha256 &&
        diagnosis.inputReceiptHash === witness.inputReceiptHash && diagnosis.materialOccurrenceIds.length === witness.materialOccurrenceIds.length &&
        witness.materialOccurrenceIds.every(id => diagnosis.materialOccurrenceIds.includes(id));
}
type ReadonlyDiagnosisWitness = Omit<NonNullable<Disposition['diagnosis']>, 'materialOccurrenceIds'> & { materialOccurrenceIds: readonly string[] };
/** Local accounting only: equivalence propagation and action eligibility still
 * require the complete host graph. Missing proof is unknown, never false. */
export function dispositionAccountingState(decision: Disposition, finding: unknown,
    proof: { repair?: boolean; diagnosis?: boolean }): 'pending' | 'resolved' | 'unknown' {
    if (decision.disposition === 'upheld' && decision.resolution === 'pending') return 'pending';
    const optional = (finding as {severity?: unknown} | null)?.severity === 'optional';
    if (decision.disposition === 'rejected' || decision.disposition === 'deferred' && optional ||
        decision.disposition === 'upheld' && optional && !decision.repair) return 'resolved';
    const effective = decision.disposition === 'upheld' && decision.resolution === 'diagnosed' ? proof.diagnosis :
        decision.disposition === 'upheld' && decision.resolution === 'repaired' ? proof.repair : false;
    return effective === undefined ? 'unknown' : effective ? 'resolved' : 'pending';
}
/** Full claim shape before using optional reproduction/patch fields as evidence. */
export function assertFinding(value: unknown): asserts value is Finding {
    finding(value);
}
function finding(value: unknown) {
    const r = object(value, shapes.finding);
    assertFindingCore(value);
    if ('reproduction' in r) {
        const repro = object(r.reproduction, shapes.reproduction);
        text(repro.toolCallId);
        text(repro.command);
        uniqueTexts(repro.assertions, 'reproduction assertion ID');
        if (!(repro.assertions as unknown[]).length)
            fail('Reproduction needs assertions');
        if ('expectationPaths' in repro)
            relativePaths(repro.expectationPaths, 'finding.reproduction.expectationPaths');
    }
    if ('mechanicalPatch' in r) {
        if (r.repair !== 'mechanical')
            fail('Only mechanical finding can propose exact replacement');
        const patch = object(r.mechanicalPatch, shapes.mechanicalPatch);
        text(patch.path);
        text(patch.oldText);
        if (!isOwnedRelativeInputPath(patch.path))
            fail('Invalid mechanical path');
        if (typeof patch.newText !== 'string' || patch.newText.length > 32768)
            fail('Invalid replacement text');
    }
}
function scope(value: unknown) {
    const r = object(value, shapes.scope);
    text(r.sourceId);
    integer(r.startLine);
    integer(r.endLine);
    if ((r.startLine as number) > (r.endLine as number))
        fail('Reversed scope');
}
function decision(value: unknown, localCarry?: RoleOutputConstraints['decisionCarry'], planningRepair?: RoleOutputConstraints['planningRepair'], reviewResolution?: RoleOutputConstraints['reviewResolution'], field = 'decision') {
    const repairShape = planningRepair?.version === 2 ? shapes.coveragePlanRepair : shapes.planRepair;
    const r = object(value, { ...shapes.decision, properties: { ...shapes.decision.properties,
        ...(localCarry ? localCarry.version === 1 ? { implementationCarry: shapes.decisionImplementationCarry } : { implementation: shapes.implementationAction } : {}),
        ...(planningRepair ? { repair: repairShape } : {}) } }, field);
    const verificationRepair = isVerificationPlanRepair(r as unknown as Disposition, planningRepair);
    if (Object.hasOwn(r, 'repair')) {
        const repair = object(r.repair, repairShape);
        const proposalRepair = repair.kind === 'plan' && r.disposition === 'upheld' && r.resolution === 'repaired' &&
            planningRepair?.subjects.some(subject => subject.occurrenceId === r.occurrenceId && subject.proposalHash === repair.proposalHash);
        if ((!proposalRepair && !verificationRepair) ||
            Object.hasOwn(r, 'implementation') || Object.hasOwn(r, 'implementationCarry') || Object.hasOwn(r, 'diagnosis') ||
            !Array.isArray(r.witnesses) || !r.witnesses.length)
            fail('Plan repair requires an exact captured subject and its applicable upheld resolution');
    }
    if (Object.hasOwn(r, 'implementationCarry')) {
        if (!['upheld', 'equivalent'].includes(String(r.disposition)) || Object.hasOwn(r, 'resolution')) fail('Implementation carry needs independent validity without repair or diagnosis');
        const carry = object(r.implementationCarry, shapes.decisionImplementationCarry);
        text(carry.baselineVersion); uniqueTexts(carry.requirementIds, 'implementation carry requirement');
        if (!(carry.requirementIds as string[]).length) fail('Implementation carry needs current requirements');
    }
    if (Object.hasOwn(r, 'implementation')) {
        if (!['upheld', 'equivalent'].includes(String(r.disposition)) || Object.hasOwn(r, 'resolution')) fail('Omit implementation unless this decision is upheld or equivalent and has no resolution');
        const action = r.implementation as Record<string, unknown>;
        const choice = object(action, action?.kind === 'none' ? shapes.noImplementation : localCarry?.version === 3
            ? sourceQualifiedImplementationShape(localCarry.baselineVersion,localCarry.baseSourceIds) : shapes.assignedImplementation);
        one(choice.kind, ['none', 'assign-to-plan']);
        if (choice.kind === 'assign-to-plan') {
            text(choice.baselineVersion); uniqueTexts(choice.requirementIds, 'implementation action requirement');
            if (!(choice.requirementIds as string[]).length) fail('Implementation assignment needs current requirements');
            if (localCarry?.version === 3) {
                uniqueTexts(choice.baseSourceIds,'BASE source');
                if (choice.baselineVersion !== localCarry.baselineVersion || !(choice.baseSourceIds as string[]).length ||
                    (choice.baseSourceIds as string[]).some(id=>!localCarry.baseSourceIds.includes(id))) fail('Implementation assignment needs original inline BASE sources');
            }
        }
    }
    text(r.occurrenceId);
    one(r.disposition, protocolEnums.disposition);
    text(r.reason);
    texts(r.witnesses);
    if ('equivalentTo' in r)
        text(r.equivalentTo);
    if ('resolution' in r && (r.disposition !== 'upheld' || ![...((reviewResolution?.version ?? 0) >= 3 || verificationRepair ? ['pending'] : []), 'repaired', 'diagnosed'].includes(String(r.resolution))))
        fail('Resolution lifecycle requires upheld validity');
    const diagnosisField = field === 'decisionActions entry' ? 'Diagnosis in a decisionActions entry' : field + '.diagnosis';
    if (r.resolution === 'diagnosed') {
        const d = object(r.diagnosis, shapes.diagnosis, diagnosisField);
        text(d.outputId);
        for (const key of ['rawSha256', 'inputReceiptHash'])
            if (typeof d[key] !== 'string' || !/^[a-f0-9]{64}$/.test(d[key] as string))
                fail('Diagnosis requires exact SHA256 operands');
        uniqueTexts(d.materialOccurrenceIds, 'diagnosis material occurrence');
    }
    else if ('diagnosis' in r)
        fail(diagnosisField + ': Diagnosis operand requires diagnosed resolution. Omit diagnosis for other outcomes. Use an upheld, diagnosed decision only for an eligible original producer diagnosis.');
    if (r.disposition === 'equivalent' && !r.equivalentTo)
        fail('Equivalent disposition needs target');
}
function inputDecision(value: unknown) { const r = object(value, shapes.inputDecision); text(r.inputId); integer(r.directionRevision); one(r.impact, protocolEnums.impact); text(r.reason); uniqueTexts(r.requirementIds, 'input decision requirement ID'); }
function payloadDecision(value: unknown) {
    const r = object(value, shapes.payloadDecision);
    if (typeof r.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.payloadHash) || typeof r.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.sourceFingerprint))
        fail('Payload decision needs exact SHA256 identities');
    one(r.verdict, protocolEnums.payloadVerdict);
    text(r.reason);
}
function nit(value: unknown) {
    const r = object(value, shapes.nit);
    text(r.beforeCandidate);
    text(r.afterDigest);
    text(r.deltaHash);
    texts(r.consumerCheckIds);
    if (!(r.consumerCheckIds as unknown[]).length)
        fail('Nit needs consumer checks');
}
/** Explicit wire members only; keep the original protocol untouched. */
export function implementationCarryProposals(result: Pick<RoleResult, 'implementationCarries' | 'implementationCarryGroups' | 'decisions'>, decisionCarry?: RoleOutputConstraints['decisionCarry']): ImplementationCarry[] {
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Implementation carry declarations unavailable');
    if (decisionCarry !== undefined) captureDecisionCarry(decisionCarry);
    const proposals: ImplementationCarry[] = [], seen = new Set<string>();
    let expandedBytes = 2;
    const add = (occurrenceId: unknown, shared: Record<string, unknown>) => {
        text(occurrenceId); text(shared.baselineVersion); text(shared.reason);
        uniqueTexts(shared.requirementIds, 'implementation carry requirement');
        if (!(shared.requirementIds as string[]).length || seen.has(occurrenceId as string) || proposals.length >= 1024)
            fail('Implementation carry needs unique members, current requirements and at most1024 total members');
        seen.add(occurrenceId as string);
        const proposal = { occurrenceId: occurrenceId as string, baselineVersion: shared.baselineVersion as string,
            requirementIds: [...shared.requirementIds as string[]], reason: shared.reason as string,
            ...(decisionCarry?.version===3?{baseSourceIds:[...shared.baseSourceIds as string[]]}:{}) };
        expandedBytes += Buffer.byteLength(JSON.stringify(proposal)) + (proposals.length ? 1 : 0);
        if (expandedBytes > MAX_FINAL_BYTES) fail('Expanded implementation carry proposals exceed128KiB');
        proposals.push(proposal);
    };
    if (result.implementationCarries !== undefined) array(result.implementationCarries, value => {
        const carry = object(value, shapes.implementationCarry); add(carry.occurrenceId, carry);
    });
    if (result.implementationCarryGroups !== undefined) array(result.implementationCarryGroups, value => {
        const group = object(value, shapes.implementationCarryGroup);
        uniqueTexts(group.occurrenceIds, 'implementation carry group member');
        if (!(group.occurrenceIds as string[]).length) fail('Implementation carry group requires explicit members');
        for (const id of group.occurrenceIds as string[]) add(id, group);
    });
    if (result.decisions !== undefined) array(result.decisions, value => {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'implementationCarry') && !Object.hasOwn(value, 'implementation')) return;
        if (!decisionCarry) fail('Decision-local implementation carry requires its captured format');
        decision(value, decisionCarry);
        const item = value as NonNullable<RoleResult['decisions']>[number];
        if (item.implementationCarry) add(item.occurrenceId, { ...item.implementationCarry, reason: item.reason });
        if (item.implementation?.kind === 'assign-to-plan') add(item.occurrenceId, { ...item.implementation, reason: item.reason });
    });
    return proposals;
}
/** Validate the frozen approval operand, not a manufactured producer result. */
export function assertApprovedProposal(approval: NonNullable<RoleOutputConstraints['proposalApproval']>, constraints: RoleOutputConstraints): void {
    plan(approval.proposal,constraints.planningProfile?.version??constraints.strategyGrammarVersion??1,'bound proposal');
    const proposal = approval.proposal, profile = constraints.planningProfile, strategies = proposal.verification.strategies;
    if (!profile?.supported || profile.baseline.priorDuty && !profile.baseline.newObservation || proposal.ambiguities.length ||
        !strategies || strategies.length !== proposal.requirements.length || new Set(strategies.map(s => s.requirementId)).size !== proposal.requirements.length ||
        proposal.requirements.some(r => !strategies.some(s => s.requirementId === r.id)) || strategies.some(s => !verificationStrategySupported(s,profile)) ||
        constraints.sourceIds && proposal.requirements.some(r => !constraints.sourceIds!.includes(r.source)))
        fail('Bound proposal approval requires a complete current proposal and supported source/strategy domains');
}
export function parseRoleOutput(raw: string, role: Role, sourceFit: readonly SourceFitRequirement[] = [], constraints: RoleOutputConstraints = {}): {
    value: RoleResult | null;
    issues: string[];
} {
    try {
        const { verificationFit, sourceIds, planningProfile, criteriaRefresh } = constraints;
        const sourceFitReferences = constraints.sourceFitReferences === undefined ? undefined : captureSourceFitReferences(constraints.sourceFitReferences);
        if (sourceFitReferences && role !== 'adjudicator') fail('Source-fit references require adjudication');
        if (sourceFitReferences) {
            if (sourceFit.length) assertSourceFitTuples(sourceFit, sourceFitReferences.inputs);
            sourceFit = sourceFitReferences.inputs;
        }
        const grammar=planningProfile?.version??constraints.strategyGrammarVersion??1;
        if(!isPlanningGrammar(grammar)||constraints.strategyGrammarVersion!==undefined&&constraints.strategyGrammarVersion!==grammar)fail('Strategy grammar capture unavailable or conflicting');
        const planningRepair = constraints.planningRepair === undefined ? undefined : capturePlanningRepair(constraints.planningRepair);
        if (planningRepair && role !== 'adjudicator') fail('Planning repair requires adjudication');
        const scopeAmendment = constraints.scopeAmendment === undefined ? undefined : captureScopeAmendment(constraints.scopeAmendment);
        if (scopeAmendment && role !== 'adjudicator') fail('Scope amendment requires adjudication');
        const decisionCarry = constraints.decisionCarry === undefined ? undefined : captureDecisionCarry(constraints.decisionCarry);
        if (decisionCarry && role !== 'adjudicator') fail('Decision-local carry requires adjudication');
        const approval = constraints.proposalApproval === undefined ? undefined : captureProposalApproval(constraints.proposalApproval);
        if (approval) { if (role !== 'adjudicator') fail('Bound proposal approval requires adjudication'); assertApprovedProposal(approval, constraints); }
        const decisionReferences = constraints.decisionReferences === undefined ? undefined : captureDecisionReferences(constraints.decisionReferences);
        if (decisionReferences && role !== 'adjudicator') fail('Decision references require adjudication');
        if (decisionCarry && decisionCarry.version >= 2 && decisionReferences?.version !== 3) fail('Implementation action grammar needs original version3 references');
        if (planningRepair) assertPlanningRepairSubjects(planningRepair, decisionReferences);
        const diagnosisEligibility = constraints.diagnosisEligibility === undefined ? undefined : captureDiagnosisEligibility(constraints.diagnosisEligibility, decisionReferences);
        if (diagnosisEligibility && role !== 'adjudicator') fail('Current diagnosis eligibility requires adjudication');
        one(role, roles);
        assertSupportedRoleProfile(constraints as Record<string, unknown>);
        if (Buffer.byteLength(raw) > MAX_FINAL_BYTES)
            fail('Role final exceeds128KiB');
        const subjectActions = constraints.subjectActions;
        const decisionField = (index: number) => subjectActions ? 'decisionActions entry' : `decisions[${index}]`;
        if (subjectActions && (role !== 'adjudicator' || !decisionReferences)) fail('Subject actions require captured adjudicator references');
        if (subjectActions) captureSubjectActionProfile(subjectActions, decisionReferences!);
        const reviewResolution = constraints.reviewResolution === undefined ? undefined : captureReviewResolution(constraints.reviewResolution);
        if (reviewResolution && role !== 'adjudicator') fail('Review resolution requires adjudication');
        const optionalSubjects = new Set(optionalReviewSubjects(reviewResolution, decisionReferences));
        const body = reviewResolution && reviewResolution.version >= 2 ? wholeJsonFence(raw)?.body ?? raw : raw;
        const decoded = subjectActions ? decodeSubjectActionOutput(body, subjectActions, decisionReferences!, MAX_FINAL_BYTES) : parseUniqueJson(body);
        const validateDecision = (value: unknown, index: number) => decision(value, decisionCarry, planningRepair, reviewResolution, decisionField(index));
        let checkedPlanningDecisions = false;
        const rootShape = constraints.consumerControlProposal ? roleOutputSchema(role, 'consumer-control-proposal', [], constraints)
            : scopeAmendment ? scopeAmendmentShape(roleShapes[role], scopeAmendment) : roleShapes[role];
        if (grammar >= 6 && decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
            const root = decoded as ObjectValue;
            const plans = (['plan', 'acceptedPlan'] as const)
                .filter(key => Object.hasOwn(rootShape.properties!, key) && Object.hasOwn(root, key));
            const issues = [
                objectIssue(root, rootShape, 'RoleOutput'),
                ...plans.map(key => planRequirementsIssue(root[key], key, grammar, !!approval)),
            ];
            const failures = issues.filter(issue => issue !== undefined);
            if (role === 'adjudicator' && !reviewResolution && !subjectActions && Array.isArray(root.decisions) && root.decisions.length <= 1024) {
                for (const [index, value] of root.decisions.entries()) {
                    try {
                        validateDecision(value, index);
                    } catch (error) {
                        const field = decisionField(index);
                        const message = error instanceof Error ? error.message : String(error);
                        failures.push(message.startsWith(field + ':') || message.startsWith(field + '.') ? message : field + ': ' + message);
                        if (failures.length === 8) break;
                    }
                }
                checkedPlanningDecisions = failures.length === 0;
            }
            if (failures.length)
                return { value: null, issues: failures.map(issue => 'PROTOCOL: Error: ' + issue) };
            for (const key of plans) {
                const { verificationRequirements, ...rest } = root[key] as ObjectValue;
                root[key] = { ...rest, requirements: verificationRequirements };
            }
        }
        if (reviewResolution) {
            const wire = object(decoded, roleShapes[role]);
            if (['acceptedPlan', 'planAccepted', 'criteriaDecision', 'payloadDecision', 'implementationCarries', 'implementationCarryGroups'].some(key => Object.hasOwn(wire, key)))
                fail('Review resolution output contains another stage field');
            if (!Array.isArray(wire.decisions)) fail('Review resolution requires decisions');
            for (const [index, value] of wire.decisions.entries()) {
                const row = object(value, shapes.decision, decisionField(index));
                if (row.disposition === 'upheld' && !Object.hasOwn(row, 'resolution')) {
                    if (!optionalSubjects.has(row.occurrenceId as string)) fail('Upheld review decision requires explicit pending, repaired or diagnosed resolution');
                    if (!Array.isArray(row.witnesses) || !row.witnesses.length) fail('Optional upheld observation without further action requires retained witnesses');
                }
                if (row.resolution === 'pending') {
                    if (row.disposition !== 'upheld') fail('Pending resolution requires upheld validity');
                    if (reviewResolution.version < 3) delete row.resolution;
                }
            }
        }
        const r = object(decoded, rootShape);
        if (Object.hasOwn(r, 'scopeAmendments') && r.planAccepted !== true)
            fail('Scope amendment decisions require acceptance of the plan');
        if (constraints.consumerControlProposal) {
            boundedReplacement(r.consumerReplacement);
            if (!Array.isArray(r.findings) || r.findings.length) fail('A consumer proposal cannot record findings or a review verdict');
        }
        one(r.version, [1]);
        text(r.summary);
        array(r.findings, finding);
        array(r.assessedScope, scope);
        if ('verificationDecisions' in r) {
            array(r.verificationDecisions, verificationDecision);
            const ids = (r.verificationDecisions as { requirementId: string }[]).map(x => x.requirementId);
            if (new Set(ids).size !== ids.length) fail('Duplicate verification decision');
        }
        if (verificationFit !== undefined) {
            if (!Object.hasOwn(r, 'verificationDecisions') || !Array.isArray(r.verificationDecisions) || r.verificationDecisions.length !== verificationFit.length) fail('Required independent verification decisions incomplete');
            for (const [index, required] of verificationFit.entries()) {
                const decision = (r.verificationDecisions as RoleResult['verificationDecisions'])!.find(item => item.requirementId === required.requirementId);
                const source = `context.verificationReviewRequirements[${index}]`;
                if (!decision || decision.strategyDigest !== required.strategyDigest || decision.witnessIds.some(id => !required.witnessIds.includes(id)))
                    fail(`Verification fit identity/witness binding changed. Use the requirementId, strategyDigest and supplied witnessIds from ${source}.`);
                if (decision.verdict === 'satisfied' && decision.witnessIds.length !== required.witnessIds.length)
                    fail(`Verification fit witness list incomplete: expected ${required.witnessIds.length}, received ${decision.witnessIds.length}. For satisfied, copy the complete ${source}.witnessIds array.`);
            }
        }
        if (sourceIds) for (const candidate of [r.plan, r.acceptedPlan, approval?.proposal]) {
            if (candidate && typeof candidate === 'object' && Array.isArray((candidate as ObjectValue).requirements))
                for (const requirement of (candidate as { requirements: { source: string }[] }).requirements) if (!sourceIds.includes(requirement.source)) fail('Requirement source is not an exact supplied identity');
        }
        if (planningProfile && (role === 'planner' || role === 'adjudicator')) {
            const field = role === 'planner' ? 'plan' : Object.hasOwn(r, 'acceptedPlan') ? 'acceptedPlan' : 'bound proposal';
            const proposal = (field === 'bound proposal' ? approval?.proposal : r[field]) as PlanProposal | undefined;
            // Report malformed proposals before contextual coverage: a blocking finding
            // cannot repair duplicate strategies or an invalid plan shape.
            if (proposal) plan(proposal,grammar,field);
            if (role === 'adjudicator' && planningProfile.supported && typeof r.planAccepted !== 'boolean') fail('Current planning adjudication requires an explicit decision');
            if (planningProfile.supported && (role === 'planner' || r.planAccepted === true)) {
                if (!proposal || !Object.hasOwn(proposal.verification ?? {}, 'strategies')) fail('Current supported planning requires explicit strategy accounting');
                const strategies = proposal.verification.strategies;
                if (Array.isArray(strategies) && strategies.some(strategy => !verificationStrategySupported(strategy,planningProfile))) fail('Verification strategy kind is unavailable in this current capability');
                if (role === 'adjudicator' && planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation) fail('Original before-edit duty lacks supported historical mapping; acceptance unavailable');
                const complete = hasCompleteStrategyAccounting(proposal);
                if (!complete && (role !== 'planner' || !(r.findings as RoleResult['findings']).some(finding => finding.severity === 'blocking'))) {
                    const collection = role === 'planner' ? `plan.${grammar >= 6 ? 'verificationRequirements' : 'requirements'}`
                        : Object.hasOwn(r, 'acceptedPlan') ? `acceptedPlan.${grammar >= 6 ? 'verificationRequirements' : 'requirements'}`
                        : 'proposalApproval.proposal.requirements (canonical retained proposal)';
                    fail(`Accepted strategy accounting incomplete; ${missingStrategyDetails(proposal, collection)} Acceptance requires complete coverage; unavailable planner proposals need a retained blocking finding.`);
                }
            } else if (!planningProfile.supported && proposal && Object.hasOwn(proposal.verification ?? {}, 'strategies')) fail('Current mixed planning capability unavailable; historical records are not migrated');
        }
        if (role === 'planner') {
            plan(r.plan,grammar);
        }
        if (role === 'challenger') {
            texts(r.alternatives);
        }
        if (role === 'adjudicator') {
            if (decisionCarry && (Object.hasOwn(r, 'implementationCarries') || Object.hasOwn(r, 'implementationCarryGroups'))) fail('Decision-local format uses each decision, not legacy carry arrays');
            if (!checkedPlanningDecisions) array(r.decisions, validateDecision);
            retainedDispositionRequests(r as unknown as RoleResult, decisionReferences);
            const known = decisionReferences ? new Set(decisionReferences.occurrenceIds) : null, synthetic = new Set(decisionReferences?.diagnosisOccurrenceIds ?? []);
            if (known) {
                for (const [index, value] of (r.decisions as NonNullable<RoleResult['decisions']>).entries()) {
                    if (!known.has(value.occurrenceId)) fail(`decisions[${index}].occurrenceId is not a supplied identity`);
                    if (value.equivalentTo !== undefined && (!known.has(value.equivalentTo) || synthetic.has(value.equivalentTo)))
                        fail(`decisions[${index}].equivalentTo is not a supplied ordinary identity`);
                    if (value.disposition === 'equivalent' && synthetic.has(value.occurrenceId))
                        fail(`decisions[${index}] cannot equate a producer diagnosis with a material claim`);
                    if (synthetic.has(value.occurrenceId) && value.repair !== undefined) fail('A synthetic diagnosis cannot declare plan repair');
                    if (synthetic.has(value.occurrenceId) && value.implementation !== undefined) fail('A synthetic diagnosis cannot declare an implementation action');
                    if (decisionReferences && decisionReferences.version >= 2 && synthetic.has(value.occurrenceId) && value.resolution === 'repaired')
                        fail(`decisions[${index}] cannot repair a synthetic diagnosis with code changes; preserve prior diagnoses or use an exact current eligible diagnosis`);
                    if (diagnosisEligibility && value.resolution === 'diagnosed') {
                        const operand = diagnosisEligibility.eligible.find(row => row.occurrenceId === value.occurrenceId);
                        if (!operand || !matchesDiagnosisWitness(value.diagnosis, { ...operand, inputReceiptHash: diagnosisEligibility.receiptHash }))
                            fail(`decisions[${index}].diagnosis is not an exact current eligible operand; preserve historical committed diagnoses`);
                        if (operand.materialOccurrenceIds.some(id => !(r.decisions as NonNullable<RoleResult['decisions']>).some(d => d.occurrenceId === id)))
                            fail(`decisions[${index}].diagnosis needs every bound material sibling decision, including resolved siblings`);
                    }
                }
            }
            const carryProposals = implementationCarryProposals(r as unknown as RoleResult, decisionCarry);
            if (decisionCarry && decisionCarry.version >= 2) assertImplementationAccounting(r as unknown as RoleResult, decisionReferences!, planningRepair);
            if (known && carryProposals.some(carry => !known.has(carry.occurrenceId) || synthetic.has(carry.occurrenceId)))
                fail('Implementation carry is not a supplied ordinary occurrence identity');
            if ('payloadDecision' in r)
                payloadDecision(r.payloadDecision);
            if ('criteriaDecision' in r)
                criteriaDecision(r.criteriaDecision);
            if ('checkResolutions' in r) {
                const seen = new Set<string>();
                array(r.checkResolutions, item => {
                    checkResolution(item);
                    const id = (item as ObjectValue).amendmentId as string;
                    if (seen.has(id))
                        fail('Duplicate check resolution');
                    seen.add(id);
                });
            }
            if ('inputDecisions' in r) {
                const seen = new Set<string>();
                array(r.inputDecisions, item => {
                    inputDecision(item);
                    const id = (item as ObjectValue).inputId as string;
                    if (seen.has(id))
                        fail('Duplicate input decision ID');
                    seen.add(id);
                });
            }
            for (const required of sourceFit) {
                if (!(r.inputDecisions as RoleResult['inputDecisions'])?.some(decision => decision.inputId === required.inputId && decision.directionRevision === required.directionRevision))
                    fail(`Missing source-fit decision for held input ${required.inputId} at direction ${required.directionRevision}`);
            }
            if ('planAccepted' in r && typeof r.planAccepted !== 'boolean')
                fail('planAccepted must be boolean');
            if ('acceptedPlan' in r)
                plan(r.acceptedPlan,grammar,'acceptedPlan');
            if ('ownerDecisionRequired' in r)
                texts(r.ownerDecisionRequired);
            if (sourceFitReferences) {
                const domain = sourceFitRequirementDomain(sourceFitReferences, r as unknown as RoleResult, approval);
                if (domain) for (const required of sourceFit) {
                    const index = (r.inputDecisions as RoleResult['inputDecisions'])!.findIndex(decision => decision.inputId === required.inputId && decision.directionRevision === required.directionRevision);
                    const decision = (r.inputDecisions as NonNullable<RoleResult['inputDecisions']>)[index]!;
                    if (decision.requirementIds.some(id => !domain.includes(id)))
                        fail(`inputDecisions[${index}].requirementIds must name effective plan requirements, not input/source locators`);
                }
            }
            if (criteriaRefresh) {
                const decision = r.criteriaDecision as RoleResult['criteriaDecision'];
                if (decision && (decision.sourceId !== criteriaRefresh.sourceId || decision.fromContractsVersion !== criteriaRefresh.fromContractsVersion ||
                    decision.toContractsVersion !== criteriaRefresh.toContractsVersion))
                    fail('Criteria decision does not match the captured refresh identities');
                if (r.planAccepted === true && !(r.ownerDecisionRequired as string[] | undefined)?.length && !decision)
                    fail('Accepting planning output omitted the captured criteria refresh decision');
            }
            if ('nitAuthorization' in r)
                nit(r.nitAuthorization);
        }
        if ('outcome' in r)
            one(r.outcome, protocolEnums.outcome);
        if (role === 'confirmer') {
            if (typeof r.confirmed !== 'boolean')
                fail('confirmed must be boolean');
            texts(r.witnesses);
        }
        if (scopeAmendment && r.planAccepted === true)
            validateScopeAmendmentDecisions(r.scopeAmendments, scopeAmendment, (r.acceptedPlan ?? approval?.proposal) as PlanProposal | undefined);
        return { value: r as unknown as RoleResult, issues: [] };
    }
    catch (error) {
        const issue = `PROTOCOL: ${String(error)}`;
        return { value: null, issues: [issue] };
    }
}
export function parseCheckOutput(raw: string): {
    value: CheckOutput | null;
    issues: string[];
} {
    try {
        if (Buffer.byteLength(raw) > MAX_FINAL_BYTES)
            fail('Check output exceeds128KiB');
        const r = object(parseUniqueJson(raw), shapes.checkOutput);
        one(r.version, [1]);
        if ('cases' in r) {
            array(r.cases, item => {
                const c = object(item, shapes.caseResult);
                text(c.id);
                if (typeof c.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(c.inputDigest))
                    fail('Expected case input SHA256');
                observation(c.observed);
            });
            uniqueIds(r.cases, 'case result');
            if ((r.cases as unknown[]).length > 64)
                fail('Case result roster exceeds64');
        }
        const seen = new Set<string>();
        array(r.assertions, item => {
            const a = object(item, shapes.assertion);
            text(a.id);
            if (seen.has(a.id))
                fail('Duplicate assertion');
            seen.add(a.id);
            if (typeof a.passed !== 'boolean')
                fail('Assertion must have boolean passed');
            if ('actual' in a)
                text(a.actual);
        });
        return { value: r as unknown as CheckOutput, issues: [] };
    }
    catch (error) {
        return { value: null, issues: [`CHECK_PROTOCOL: ${String(error)}`] };
    }
}

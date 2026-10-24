import path from 'node:path';
import { protocolShapes as shapes, roleShapes, protocolEnums, type Shape } from './role-output-shape.js';
import { parseUniqueJson } from './json.js';
import type { Role, RoleResult, CheckOutput, PlanProposal, Finding, SourceFitRequirement, RoleOutputConstraints } from './types.js';
export const MAX_FINAL_BYTES = 128 * 1024;
const roles = protocolEnums.roles;
type ObjectValue = Record<string, unknown>;
function fail(message: string): never { throw new Error(message); }
function object(value: unknown, shape: Shape): ObjectValue {
    const allowed = Object.keys(shape.properties!);
    const required = shape.required!;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('Expected object');
    const row = value as ObjectValue;
    if (Object.keys(row).some(key => !allowed.includes(key)) || required.some(key => !(key in row)))
        fail('Unexpected or missing fields');
    return row;
}
function text(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 32768)
        fail('Expected bounded nonempty text');
}
function array(value: unknown, check: (v: unknown) => void): asserts value is unknown[] {
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
function relativePaths(value: unknown) {
    uniqueTexts(value, 'expectation path');
    for (const p of value as string[])
        if (path.isAbsolute(p) || p.split(/[\\/]/).includes('..') || p.includes('\0'))
            fail('Expected relative owned input path');
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
    relativePaths(r.consumerPaths);
    const input = object(r.input, shapes.caseInput);
    machineText(input.literalUtf8);
    relativePaths(input.fixturePaths);
    observation(r.expected);
    if (!(r.guaranteeIds as unknown[]).length || !(r.consumerPaths as unknown[]).length)
        fail('Case needs guarantee and actual consumer');
}
function check(value: unknown) {
    const r = object(value, shapes.check);
    if ('cases' in r) {
        array(r.cases, verificationCase);
        uniqueIds(r.cases, 'case');
        if ((r.cases as unknown[]).length > 64)
            fail('Case roster exceeds64');
    }
    text(r.id);
    texts(r.guaranteeIds);
    text(r.command);
    uniqueTexts(r.assertions, 'check assertion ID');
    integer(r.timeoutMs, 300000);
    texts(r.fixturePaths);
    if ('expectationPaths' in r)
        relativePaths(r.expectationPaths);
    if (!(r.assertions as unknown[]).length || !(r.guaranteeIds as unknown[]).length)
        fail('Check needs guarantees and assertions');
}
function plan(value: unknown): asserts value is PlanProposal {
    const r = object(value, shapes.plan);
    text(r.intent);
    array(r.requirements, requirement);
    uniqueIds(r.requirements, 'requirement');
    text(r.approach);
    text(r.simplerAlternative);
    texts(r.factualSources);
    texts(r.ambiguities);
    const v = object(r.verification, shapes.verification);
    if ('checkAmendments' in v) {
        const seen = new Set<string>();
        array(v.checkAmendments, item => {
            checkAmendment(item);
            const id = (item as ObjectValue).obligationId as string;
            if (seen.has(id))
                fail('Duplicate amended obligation');
            seen.add(id);
        });
    }
    if ('strategies' in v) {
        array(v.strategies, verificationStrategy);
        const ids = (v.strategies as { requirementId: string }[]).map(x => x.requirementId);
        if (new Set(ids).size !== ids.length || ids.some(id => !(r.requirements as { id: string }[]).some(requirement => requirement.id === id))) fail('Strategies need unique actual requirement identities');
    }
    array(v.checks, check);
    uniqueIds(v.checks, 'check');
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
function verificationStrategy(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected verification strategy');
    const kind = (value as ObjectValue).kind;
    if (typeof kind !== 'string' || !Object.hasOwn(shapes.strategyShapes, kind)) fail('Unsupported verification strategy');
    const r = object(value, shapes.strategyShapes[kind as keyof typeof shapes.strategyShapes]);
    text(r.requirementId);
    if (kind === 'consumer-cases') { uniqueTexts(r.checkIds, 'strategy check'); if (!(r.checkIds as unknown[]).length) fail('Strategy requires actual checks'); }
    else if (kind === 'base-execution-duty') { text(r.checkId); uniqueTexts(r.caseIds, 'baseline case'); text(r.reviewKey); if (!(r.caseIds as unknown[]).length) fail('Baseline requires concrete subject cases'); }
    else { relativePaths(r.allowedChangePaths); relativePaths(r.unchangedPaths); text(r.reviewKey); }
}
function verificationDecision(value: unknown) {
    const r = object(value, shapes.verificationDecision);
    text(r.requirementId); text(r.reason);
    if (typeof r.strategyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.strategyDigest)) fail('Expected strategy SHA256');
    uniqueTexts(r.witnessIds, 'strategy witness');
    one(r.verdict, ['satisfied', 'unavailable']);
    if (!(r.witnessIds as unknown[]).length && r.verdict === 'satisfied') fail('Satisfied strategy needs actual witnesses');
}
function checkAmendment(value: unknown) {
    const r = object(value, shapes.checkAmendment);
    for (const key of ['obligationId', 'failedCheckRunId', 'correctedCheckId', 'reason'])
        text(r[key]);
    one(r.basis, protocolEnums.amendmentBasis);
    relativePaths(r.fixturePaths);
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
    if (r.basis === 'owner-requirement-revision' && !r.ownerInputId)
        fail('Requirement revision needs actual owner input');
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
            relativePaths(repro.expectationPaths);
    }
    if ('mechanicalPatch' in r) {
        if (r.repair !== 'mechanical')
            fail('Only mechanical finding can propose exact replacement');
        const patch = object(r.mechanicalPatch, shapes.mechanicalPatch);
        text(patch.path);
        text(patch.oldText);
        if (path.isAbsolute(patch.path) || patch.path.split(/[\\/]/).includes('..') || patch.path.includes('\0'))
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
function decision(value: unknown) {
    const r = object(value, shapes.decision);
    text(r.occurrenceId);
    one(r.disposition, protocolEnums.disposition);
    text(r.reason);
    texts(r.witnesses);
    if ('equivalentTo' in r)
        text(r.equivalentTo);
    if ('resolution' in r && (r.disposition !== 'upheld' || !['repaired', 'diagnosed'].includes(String(r.resolution))))
        fail('Resolution lifecycle requires upheld validity');
    if (r.resolution === 'diagnosed') {
        const d = object(r.diagnosis, shapes.diagnosis);
        text(d.outputId);
        for (const key of ['rawSha256', 'inputReceiptHash'])
            if (typeof d[key] !== 'string' || !/^[a-f0-9]{64}$/.test(d[key] as string))
                fail('Diagnosis requires exact SHA256 operands');
        uniqueTexts(d.materialOccurrenceIds, 'diagnosis material occurrence');
    }
    else if ('diagnosis' in r)
        fail('Diagnosis operand requires diagnosed resolution');
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
export function parseRoleOutput(raw: string, role: Role, sourceFit: readonly SourceFitRequirement[] = [], constraints: RoleOutputConstraints = {}): {
    value: RoleResult | null;
    issues: string[];
} {
    try {
        const { verificationFit, sourceIds, planningProfile, criteriaRefresh } = constraints;
        one(role, roles);
        if (Buffer.byteLength(raw) > MAX_FINAL_BYTES)
            fail('Role final exceeds128KiB');
        const r = object(parseUniqueJson(raw), roleShapes[role]);
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
            for (const required of verificationFit) {
                const decision = (r.verificationDecisions as RoleResult['verificationDecisions'])!.find(item => item.requirementId === required.requirementId);
                if (!decision || decision.strategyDigest !== required.strategyDigest || decision.witnessIds.some(id => !required.witnessIds.includes(id)) ||
                    decision.verdict === 'satisfied' && (decision.witnessIds.length !== required.witnessIds.length || required.witnessIds.some(id => !decision.witnessIds.includes(id)))) fail('Verification fit identity/witness binding changed');
            }
        }
        if (sourceIds) for (const candidate of [r.plan, r.acceptedPlan]) {
            if (candidate && typeof candidate === 'object' && Array.isArray((candidate as ObjectValue).requirements))
                for (const requirement of (candidate as { requirements: { source: string }[] }).requirements) if (!sourceIds.includes(requirement.source)) fail('Requirement source is not an exact supplied identity');
        }
        if (planningProfile && (role === 'planner' || role === 'adjudicator')) {
            const proposal = (role === 'planner' ? r.plan : r.acceptedPlan) as PlanProposal | undefined;
            if (role === 'adjudicator' && planningProfile.supported && typeof r.planAccepted !== 'boolean') fail('Current planning adjudication requires an explicit decision');
            if (planningProfile.supported && (role === 'planner' || r.planAccepted === true)) {
                if (!proposal || !Object.hasOwn(proposal.verification ?? {}, 'strategies')) fail('Current supported planning requires explicit strategy accounting');
                const strategies = proposal.verification.strategies;
                if (Array.isArray(strategies) && strategies.some(strategy => !planningProfile.allowedKinds.includes(strategy.kind))) fail('Verification strategy kind is unavailable in this current capability');
                if (role === 'adjudicator' && planningProfile.baseline.priorDuty && !planningProfile.baseline.newObservation) fail('Original before-edit duty lacks supported historical mapping; acceptance unavailable');
                const complete = Array.isArray(strategies) && strategies.length === proposal.requirements.length && new Set(strategies.map(item => item.requirementId)).size === proposal.requirements.length &&
                    proposal.requirements.every(requirement => strategies.some(item => item.requirementId === requirement.id));
                if (!complete && (role !== 'planner' || !(r.findings as RoleResult['findings']).some(finding => finding.severity === 'blocking'))) fail('Accepted strategy accounting incomplete; unavailable proposals need a retained blocking finding');
            } else if (!planningProfile.supported && proposal && Object.hasOwn(proposal.verification ?? {}, 'strategies')) fail('Current mixed planning capability unavailable; historical records are not migrated');
        }
        if (role === 'planner') {
            plan(r.plan);
        }
        if (role === 'challenger') {
            texts(r.alternatives);
        }
        if (role === 'adjudicator') {
            array(r.decisions, decision);
            if ('implementationCarries' in r) {
                const seen = new Set<string>();
                array(r.implementationCarries, value => {
                    const carry = object(value, shapes.implementationCarry);
                    text(carry.occurrenceId);
                    text(carry.baselineVersion);
                    text(carry.reason);
                    uniqueTexts(carry.requirementIds, 'implementation carry requirement');
                    if (!(carry.requirementIds as string[]).length || seen.has(carry.occurrenceId as string))
                        fail('Implementation carry needs unique occurrence and current requirements');
                    seen.add(carry.occurrenceId as string);
                });
            }
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
                plan(r.acceptedPlan);
            if ('ownerDecisionRequired' in r)
                texts(r.ownerDecisionRequired);
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
        return { value: r as unknown as RoleResult, issues: [] };
    }
    catch (error) {
        return { value: null, issues: [`PROTOCOL: ${String(error)}`] };
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

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DecisionReferences, Disposition, PlanProposal, Role } from './types.js';

interface PlanningRepairSubject {
    readonly occurrenceId: string;
    readonly proposalHash: string;
    readonly producerOutputId: string;
}
export type PlanningRepairProfile =
    | { readonly version: 1; readonly subjects: readonly PlanningRepairSubject[] }
    | { readonly version: 2; readonly subjects: readonly PlanningRepairSubject[]; readonly verification: PlanningRepairSubject };

/** Compare the selected canonical plan with authenticated repair subjects. */
export function changedPlanningRepairHash(plan: PlanProposal, decisions: readonly Disposition[]): string {
    const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    if (decisions.some(decision => decision.repair?.proposalHash === digest))
        throw Error('Plan repair requires a changed accepted plan. An unchanged accepted proposal cannot be its repair.');
    return digest;
}

/** A source domain, not a verdict that any allegation concerns the plan. */
export function capturePlanningRepair(input: unknown): PlanningRepairProfile {
    const value = input as PlanningRepairProfile | null;
    const identity = (v: unknown): v is string => typeof v === 'string' && !!v.trim() &&
        Buffer.byteLength(v) <= 32768 && Buffer.from(v).toString('utf8') === v;
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![1,2].includes(value.version) ||
        Object.keys(value).sort().join(',') !== (value.version === 2 ? 'subjects,verification,version' : 'subjects,version') ||
        !Array.isArray(value.subjects) || value.subjects.length > 1024)
        throw Error('Original planning repair profile unavailable');
    const seen = new Set<string>();
    const capture = (subject: PlanningRepairSubject) => {
        if (!subject || typeof subject !== 'object' || Array.isArray(subject) ||
            Object.keys(subject).sort().join(',') !== 'occurrenceId,producerOutputId,proposalHash' ||
            !identity(subject.occurrenceId) || !identity(subject.producerOutputId) ||
            typeof subject.proposalHash !== 'string' || !/^[a-f0-9]{64}$/.test(subject.proposalHash) || seen.has(subject.occurrenceId))
            throw Error('Original planning repair subject unavailable');
        seen.add(subject.occurrenceId);
        return Object.freeze({ ...subject });
    };
    const subjects = Object.freeze(value.subjects.map(capture));
    return value.version === 2 ? Object.freeze({ version: 2, subjects, verification: capture(value.verification) })
        : Object.freeze({ version: 1, subjects });
}

export function planningRepairSubjects(profile: PlanningRepairProfile) {
    return profile.version === 2 ? [...profile.subjects, profile.verification] : profile.subjects;
}
export function assertPlanningRepairSubjects(profile: PlanningRepairProfile, references?: DecisionReferences) {
    if (!references || planningRepairSubjects(profile).some(subject => !references.occurrenceIds.includes(subject.occurrenceId) ||
        references.diagnosisOccurrenceIds.includes(subject.occurrenceId)))
        throw Error('Planning repair needs captured ordinary subjects');
    if (profile.version === 2) {
        const index = references.occurrenceIds.indexOf(profile.verification.occurrenceId);
        if (references.version !== 3 || !references.pendingOrdinaryIndexes.includes(index) || !references.blockingOrdinaryIndexes.includes(index))
            throw Error('Verification correction needs its captured pending blocking subject');
    }
}

export function isVerificationPlanRepair(decision: Disposition, profile?: PlanningRepairProfile): boolean {
    return profile?.version === 2 && decision.repair?.kind === 'verification-plan' &&
        decision.occurrenceId === profile.verification.occurrenceId &&
        decision.repair.proposalHash === profile.verification.proposalHash &&
        decision.disposition === 'upheld' && decision.resolution === 'pending' &&
        !decision.implementation && !decision.implementationCarry && !decision.diagnosis;
}

/** The retained candidate qualifies only for additions to its existing consumer check declarations. */
export function verificationCaseAdditions(original: PlanProposal, accepted: PlanProposal, requirementId: string): string[] {
    const strategy = original.verification.strategies?.find(item => item.requirementId === requirementId);
    const before = original.verification.checks, after = accepted.verification.checks;
    const withoutChecks = (plan: PlanProposal) => ({ ...plan, verification: { ...plan.verification, checks: [] } });
    if (strategy?.kind !== 'consumer-cases' || before.length !== after.length ||
        !isDeepStrictEqual(withoutChecks(original), withoutChecks(accepted)))
        throw Error('Verification correction must preserve the original plan and selected consumer checks');
    const addedChecks: string[] = [];
    for (const [index, oldCheck] of before.entries()) {
        const next = after[index]!;
        if (isDeepStrictEqual(oldCheck, next)) continue;
        const originalCases = oldCheck.cases ?? [], cases = next.cases ?? [];
        if (!strategy.checkIds.includes(oldCheck.id) || !isDeepStrictEqual(oldCheck, { ...next, cases: oldCheck.cases }) ||
            cases.length <= originalCases.length || !isDeepStrictEqual(cases.slice(0, originalCases.length), originalCases))
            throw Error('Verification correction may only append cases to the original affected checks');
        const literals = new Set(originalCases.map(example => example.input.literalUtf8));
        for (const example of cases.slice(originalCases.length)) {
            if (example.guaranteeIds.length !== 1 || example.guaranteeIds[0] !== requirementId || literals.has(example.input.literalUtf8))
                throw Error('Added verification cases need distinct inputs for the original affected requirement');
            literals.add(example.input.literalUtf8);
        }
        addedChecks.push(oldCheck.id);
    }
    if (!addedChecks.length) throw Error('Verification correction needs an added case');
    return addedChecks;
}

/** Historical absence keeps code-repair semantics and its original decoder. */
export function planningRepairProfile(role: Role, context: Record<string, unknown>) {
    if (!Object.hasOwn(context, 'planningRepair')) return undefined;
    if (role !== 'adjudicator' || context.stage !== 'planning-adjudication')
        throw Error('Planning repair belongs to its assigned planning adjudicator');
    return capturePlanningRepair(context.planningRepair);
}

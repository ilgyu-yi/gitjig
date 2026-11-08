import { captureDecisionReferences } from './role-input.js';
import { isVerificationPlanRepair, type PlanningRepairProfile } from './planning-repair.js';
import type { DecisionReferences, Disposition, RoleResult } from './types.js';

export type AccountingState = 'pending' | 'resolved' | 'unknown';
export type DispositionHead = Pick<Disposition, 'disposition' | 'equivalentTo'>;

/** Current pending duties, distinct from the historical diagnosis identity set.
 * Absence of the original current projection supplies no new intake premise. */
export function captureCurrentPendingSubjects(references: DecisionReferences | undefined, diagnostics: unknown): readonly string[] | undefined {
    if (!references || references.version !== 3 || diagnostics === undefined) return;
    const refs = captureDecisionReferences(references), projection = diagnostics as { occurrences?: unknown } | null;
    if (refs.version !== 3) throw Error('Original current pending reference domain unavailable');
    if (!projection || typeof projection !== 'object' || Array.isArray(projection) || !Array.isArray(projection.occurrences) || projection.occurrences.length > 64)
        throw Error('Original current pending diagnosis domain unavailable');
    const diagnosticIds = new Set(refs.diagnosisOccurrenceIds), pending = new Set(refs.pendingOrdinaryIndexes.map(index => refs.occurrenceIds[index]!));
    const seen = new Set<string>();
    for (const row of projection.occurrences) {
        const id = row && typeof row === 'object' && !Array.isArray(row) ? (row as { occurrenceId?: unknown }).occurrenceId : undefined;
        if (typeof id !== 'string' || !diagnosticIds.has(id) || seen.has(id)) throw Error('Original current pending diagnosis subject unavailable');
        seen.add(id); pending.add(id);
    }
    return Object.freeze(refs.occurrenceIds.filter(id => pending.has(id)));
}

/** Fresh accepting planning only. A decision is not diagnosis, repair or adoption.
 * Historical decoding retains its original implementation-accounting recipe. */
export function assertCurrentPendingAccounting(result: RoleResult, subjects: readonly string[] | undefined): void {
    if (!subjects || !result.planAccepted || result.ownerDecisionRequired?.length) return;
    const decisions = new Set(result.decisions?.map(decision => decision.occurrenceId));
    const missing = subjects.filter(id => !decisions.has(id));
    if (missing.length) {
        const occurrencePreviews = missing.slice(0, 8).map(id => {
            const points = Array.from(id);
            return { value: points.slice(0, 64).join(''), omittedCodePoints: Math.max(0, points.length - 64) };
        });
        const detail = JSON.stringify({ occurrencePreviews, omittedSubjects: Math.max(0, missing.length - 8) })
            .replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
        throw Error('Accepted plan needs explicit accounting for originally pending subjects: ' + detail + '. Truncated previews are not exact operands; use the original supplied subject domain.');
    }
}

/** Follow current heads, not cached closure of an older equivalence. Callers
 * supply only the local states they can prove at their own boundary. */
export function equivalenceAccounting(heads: ReadonlyMap<string, DispositionHead | undefined>,
    localState: (id: string, head: DispositionHead | undefined) => AccountingState): ReadonlyMap<string, AccountingState> {
    const states = new Map<string, AccountingState>();
    for (const [start, first] of heads) {
        if (first?.disposition !== 'equivalent' || states.has(start)) continue;
        const path: string[] = [], seen = new Set<string>();
        let id = start, state: AccountingState;
        for (;;) {
            if (states.has(id)) { state = states.get(id)!; break; }
            if (seen.has(id)) throw Error('Finding equivalence cycle remains unresolved');
            seen.add(id); path.push(id);
            const head = heads.get(id);
            if (!head || head.disposition !== 'equivalent') { state = localState(id, head); break; }
            if (!head.equivalentTo) { state = 'unknown'; break; }
            id = head.equivalentTo;
        }
        for (const member of path) states.set(member, state);
    }
    return states;
}

/** Existing effect law: only a fresh resolving edge needs its own witness.
 * Unknown proof is neither closure nor permission to invent evidence. */
export function assertResolvedEquivalenceEvidence(decisions: readonly Disposition[], states: ReadonlyMap<string, AccountingState>): void {
    for (const decision of decisions)
        if (decision.disposition === 'equivalent' && states.get(decision.occurrenceId) === 'resolved' && !decision.witnesses.length)
            throw Error(`Resolved equivalence needs retained witness: ${decision.occurrenceId}`);
}

/** References acknowledge original rows, never new verdicts or derived closure. */
export function retainedDispositionRequests(result: Pick<RoleResult, 'retainedDispositions' | 'decisions'>, references?: DecisionReferences) {
    const refs = references && captureDecisionReferences(references);
    if (result.retainedDispositions === undefined) return [];
    if (refs?.version !== 3 || !Array.isArray(result.retainedDispositions) || result.retainedDispositions.length > 1024)
        throw Error('Retained dispositions require their original version3 capture');
    const seen = new Set<string>(), decisions = new Set(result.decisions?.map(decision => decision.occurrenceId));
    return result.retainedDispositions.map(id => {
        const choice = refs.retentionChoices.find(row => row.dispositionId === id);
        if (typeof id !== 'string' || !choice || seen.has(id) || decisions.has(choice.occurrenceId))
            throw Error('Retained disposition is unknown, duplicated or overlaps a new decision');
        seen.add(id);
        return choice;
    });
}


/** Structural accounting for the captured planning request. Actual BASE origins,
 * current repairs, mappings and effect eligibility still require host proof. */
export function assertImplementationAccounting(result: RoleResult, references: DecisionReferences, planningRepair?: PlanningRepairProfile) {
    const refs = captureDecisionReferences(references);
    if (refs.version !== 3) throw Error('Implementation action choices require version3 decision references');
    if (!result.planAccepted || result.ownerDecisionRequired?.length) return;
    const decisions = new Map<string, Disposition>();
    for (const decision of result.decisions ?? []) {
        if (decisions.has(decision.occurrenceId)) throw Error('Duplicate current decision');
        decisions.set(decision.occurrenceId, decision);
    }
    const pending = refs.pendingOrdinaryIndexes.map(index => refs.occurrenceIds[index]!);
    if (pending.some(id => !decisions.has(id))) throw Error('Accepted plan needs an explicit decision for every captured pending ordinary occurrence');
    const synthetic = new Set(refs.diagnosisOccurrenceIds);
    const blocking = new Set(refs.blockingOrdinaryIndexes.map(index => refs.occurrenceIds[index]!));
    const retained = new Set(refs.retentionChoices.map(choice => choice.occurrenceId));
    for (const [index, decision] of (result.decisions ?? []).entries()) {
        if (synthetic.has(decision.occurrenceId) || !['upheld', 'equivalent'].includes(decision.disposition)) continue;
        if (decision.resolution === 'repaired' || isVerificationPlanRepair(decision, planningRepair)) continue; // The host proves the current or pending repair.
        if (!decision.implementation) throw Error(`decisions[${index}].implementation is required for an accepted ordinary upheld or equivalent finding`);
        if (decision.disposition === 'upheld' && blocking.has(decision.occurrenceId) && decision.implementation.kind !== 'assign-to-plan')
            throw Error(`decisions[${index}].implementation.kind must be assign-to-plan for an accepted upheld blocking finding unless it has a current repair. Supply the captured baselineVersion, applicable requirementIds and any baseSourceIds required by the tool schema`);
    }
    const endpoint = (id: string, seen = new Set<string>()): 'assigned' | 'terminal' | 'planned-verification' | 'held' => {
        if (seen.has(id)) throw Error('Current decision equivalence cycle');
        seen.add(id);
        const decision = decisions.get(id);
        // A fresh judgment overrides captured historical closure.
        if (!decision) return retained.has(id) ? 'terminal' : 'held';
        if (decision.disposition === 'equivalent') return endpoint(decision.equivalentTo!, seen);
        if (isVerificationPlanRepair(decision, planningRepair)) return 'planned-verification';
        if (decision.disposition === 'rejected' || decision.disposition === 'upheld' && decision.resolution === 'repaired' ||
            !blocking.has(id) && ['upheld', 'deferred'].includes(decision.disposition)) return 'terminal';
        return decision.disposition === 'upheld' && decision.implementation?.kind === 'assign-to-plan' ? 'assigned' : 'held';
    };
    for (const decision of decisions.values()) if (decision.disposition === 'equivalent') {
        const target = endpoint(decision.occurrenceId);
        if (target === 'held') throw Error('Accepted equivalent finding needs a currently accounted target');
        if (target === 'assigned' && decision.implementation?.kind !== 'assign-to-plan')
            throw Error('Every equivalent member of a new BASE assignment needs its own explicit assignment');
        if (target === 'planned-verification' && decision.implementation?.kind !== 'none')
            throw Error('An equivalent member of a pending verification plan remains open without a BASE assignment');
    }
}

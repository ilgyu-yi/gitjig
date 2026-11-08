import { captureDecisionReferences } from './role-input.js';
import type { DecisionReferences, Disposition, RoleResult } from './types.js';

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
export function assertImplementationAccounting(result: RoleResult, references: DecisionReferences) {
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
    for (const decision of decisions.values()) {
        if (synthetic.has(decision.occurrenceId) || !['upheld', 'equivalent'].includes(decision.disposition)) continue;
        if (decision.resolution === 'repaired') continue; // The host must prove the actual current repair.
        if (!decision.implementation) throw Error('Accepted ordinary decision needs an explicit implementation action');
        if (decision.disposition === 'upheld' && blocking.has(decision.occurrenceId) && decision.implementation.kind !== 'assign-to-plan')
            throw Error('Accepted upheld blocking finding needs an explicit BASE assignment or current repair');
    }
    const endpoint = (id: string, seen = new Set<string>()): 'assigned' | 'terminal' | 'held' => {
        if (seen.has(id)) throw Error('Current decision equivalence cycle');
        seen.add(id);
        const decision = decisions.get(id);
        // A fresh judgment overrides captured historical closure.
        if (!decision) return retained.has(id) ? 'terminal' : 'held';
        if (decision.disposition === 'equivalent') return endpoint(decision.equivalentTo!, seen);
        if (decision.disposition === 'rejected' || decision.disposition === 'upheld' && decision.resolution === 'repaired' ||
            !blocking.has(id) && ['upheld', 'deferred'].includes(decision.disposition)) return 'terminal';
        return decision.disposition === 'upheld' && decision.implementation?.kind === 'assign-to-plan' ? 'assigned' : 'held';
    };
    for (const decision of decisions.values()) if (decision.disposition === 'equivalent') {
        const target = endpoint(decision.occurrenceId);
        if (target === 'held') throw Error('Accepted equivalent finding needs a currently accounted target');
        if (target === 'assigned' && decision.implementation?.kind !== 'assign-to-plan')
            throw Error('Every equivalent member of a new BASE assignment needs its own explicit assignment');
    }
}

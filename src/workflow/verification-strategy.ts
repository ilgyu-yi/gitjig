import type { AtomicVerificationStrategy, CheckSpec, VerificationStrategy, PlanningVerificationProfile, PlanProposal } from './types.js';

export function pendingCheckForAmendment<T extends {id: string; kind: string}>(obligations: readonly T[], obligationId: string): T {
    const obligation = obligations.find(item => item?.kind === 'check' && item.id === obligationId);
    if (!obligation)
        throw Error('Amendment must name current pending check obligation. For a check that has only been proposed, correct the check directly in the plan.');
    return obligation;
}

export function fixedCheckInputRoles(checks: readonly CheckSpec[], path: string): string[] {
    return [
        ...(checks.some(check => check.expectationPaths?.includes(path)) ? ['expectationPaths'] : []),
        ...(checks.some(check => check.cases?.some(entry => entry.input.fixturePaths.includes(path))) ? ['case.input.fixturePaths'] : []),
    ];
}

/** Substitution changes only the consumer, never an input the check must hold fixed. */
export function consumerControlInputConflict(plan: PlanProposal): string | undefined {
    const checks = plan.verification.checks;
    const cases = checks.flatMap(check => check.cases ?? []);
    for (const {consumerControl: control} of checks) {
        if (!control) continue;
        const consumer = fixedCheckInputRoles(checks, control.path);
        if (consumer.length)
            return `Controlled consumer ${JSON.stringify(control.path.slice(0, 64))} is also in ${consumer.join(' and ')}. The control may replace the consumer, but must hold real oracle and case inputs fixed.`;
        const replacement = control.replacementPath;
        if (replacement === undefined) continue;
        if (replacement === control.path) return 'A consumer control needs distinct consumer and BASE replacement paths.';
        const inputs = fixedCheckInputRoles(checks, replacement);
        if (checks.some(check => check.fixturePaths.includes(replacement))) inputs.push('check.fixturePaths');
        if (cases.some(entry => entry.consumerPaths.includes(replacement))) inputs.push('case.consumerPaths');
        if (inputs.length)
            return `BASE replacement ${JSON.stringify(replacement.slice(0, 64))} is also in ${inputs.join(', ')}. Use replacement bytes from a file outside the declared check inputs.`;
    }
}

/** A single bounded conjunction, never a recursive/general qualitative strategy. */
export function verificationStrategyLeaves(strategy: VerificationStrategy): AtomicVerificationStrategy[] {
    if (strategy.kind !== 'all-of') return [strategy];
    if (!Array.isArray(strategy.parts) || strategy.parts.length < 2 || strategy.parts.length > 3 ||
        new Set(strategy.parts.map(part => part?.kind)).size !== strategy.parts.length ||
        strategy.parts.some(part => !part || typeof part !== 'object' || Array.isArray(part) ||
            !['consumer-cases', 'base-execution-duty', 'manifest-scope-duty'].includes(part.kind) || Object.hasOwn(part, 'requirementId')))
        throw Error('all-of requires two or three distinct atomic strategy families with inherited requirement ID');
    return strategy.parts.map(part => ({ requirementId: strategy.requirementId, ...part }));
}

export function verificationStrategySupported(strategy: VerificationStrategy, profile: PlanningVerificationProfile): boolean {
    return profile.allowedKinds.includes(strategy.kind) && (strategy.kind !== 'all-of' || profile.version >= 2 &&
        verificationStrategyLeaves(strategy).every(part => profile.allowedKinds.includes(part.kind)));
}

function missingConsumerCaseKinds(plan: PlanProposal, requirementId: string, checkIds?: readonly string[]) {
    return (['healthy', 'adverse'] as const).filter(kind => !plan.verification.checks.some(check =>
        (!checkIds || checkIds.includes(check.id)) && check.cases?.some(item => item.kind === kind && item.guaranteeIds.includes(requirementId))));
}

/** Bounded structural observations, never semantic coverage or a repaired declaration. */
export function verificationReferenceDiagnostics(plan: PlanProposal, maxBytes = 4096) {
    const bounded = (value: string) => ({ value: value.slice(0, 96), omittedCodeUnits: Math.max(0, value.length - 96) });
    type Problem = { kind: string; pointer: string; checkId?: ReturnType<typeof bounded>; caseId?: ReturnType<typeof bounded>; reference: ReturnType<typeof bounded>; expectedPointer: string };
    const requirements = new Set(plan.requirements.map(row => row.id));
    const checks = plan.verification.checks;
    const problems: Problem[] = []; let total = 0;
    const add = (kind: string, pointer: string, checkId: string | undefined, reference: string, expectedPointer: string, caseId?: string) => {
        total++;
        const problem = { kind, pointer, ...(checkId === undefined ? {} : {checkId: bounded(checkId)}), ...(caseId === undefined ? {} : { caseId: bounded(caseId) }), reference: bounded(reference), expectedPointer };
        if (problems.length < 12 && Buffer.byteLength(JSON.stringify({ version: 1, pointerDomain: 'canonical-plan', problems: [...problems, problem], omittedProblems: 1000000 })) <= maxBytes) problems.push(problem);
    };
    for (const [ci, check] of checks.entries()) {
        for (const [gi, id] of check.guaranteeIds.entries()) if (!requirements.has(id))
            add('check-requirement-undeclared', `/verification/checks/${ci}/guaranteeIds/${gi}`, check.id, id, '/requirements');
        for (const [ki, item] of (check.cases ?? []).entries()) for (const [gi, id] of item.guaranteeIds.entries()) {
            const pointer = `/verification/checks/${ci}/cases/${ki}/guaranteeIds/${gi}`;
            if (!requirements.has(id)) add('case-requirement-undeclared', pointer, check.id, id, '/requirements', item.id);
            else if (!check.guaranteeIds.includes(id)) add('case-requirement-not-in-check', pointer, check.id, id, `/verification/checks/${ci}/guaranteeIds`, item.id);
        }
    }
    const strategies = plan.verification.strategies;
    if (Array.isArray(strategies)) {
        const leaves = strategies.flatMap(strategy => { try { return verificationStrategyLeaves(strategy); } catch { return []; } });
        const base = new Set(leaves.filter(row => row.kind === 'base-execution-duty').map(row => row.checkId));
        for (const [si, strategy] of strategies.entries()) {
            let parts: ReturnType<typeof verificationStrategyLeaves>;
            try { parts = verificationStrategyLeaves(strategy); } catch { continue; }
            for (const [pi, part] of parts.entries()) {
                const path = `/verification/strategies/${si}` + (strategy.kind === 'all-of' ? `/parts/${pi}` : '');
                if (part.kind === 'consumer-cases') for (const kind of missingConsumerCaseKinds(plan,part.requirementId,part.checkIds))
                    add(`consumer-case-${kind}-missing`, path, undefined, part.requirementId, '/verification/checks');
                const refs = part.kind === 'consumer-cases' ? part.checkIds : part.kind === 'base-execution-duty' ? [part.checkId] : [];
                for (const [ri, id] of refs.entries()) {
                    const checkIndex = checks.findIndex(row => row.id === id), check = checks[checkIndex];
                    const pointer = path + (part.kind === 'consumer-cases' ? `/checkIds/${ri}` : '/checkId');
                    if (!check) add('strategy-check-undeclared', pointer, id, id, '/verification/checks');
                    else {
                        if (!check.guaranteeIds.includes(part.requirementId)) add('strategy-check-requirement-missing', pointer, id, part.requirementId, `/verification/checks/${checkIndex}/guaranteeIds`);
                        if (part.kind === 'consumer-cases' && base.has(id)) add('base-candidate-check-conflict', pointer, id, id, '/verification/strategies');
                        if (part.kind === 'base-execution-duty') for (const [ki, caseId] of part.caseIds.entries()) {
                            const selected = check.cases?.find(row => row.id === caseId);
                            if (!selected) add('baseline-case-undeclared', path + `/caseIds/${ki}`, id, caseId, `/verification/checks/${checkIndex}/cases`);
                            else if (!selected.guaranteeIds.includes(part.requirementId)) add('baseline-case-requirement-missing', path + `/caseIds/${ki}`, id, part.requirementId, `/verification/checks/${checkIndex}/cases`, caseId);
                        }
                    }
                }
                if (part.kind !== 'consumer-cases' && !plan.verification.reviewRoles.some(row => row.key === part.reviewKey))
                    add('strategy-reviewer-undeclared', path + '/reviewKey', part.kind === 'base-execution-duty' ? part.checkId : '', part.reviewKey, '/verification/reviewRoles');
            }
        }
    } else if (!Object.hasOwn(plan.verification, 'strategies')) for (const [ri, requirement] of plan.requirements.entries())
        for (const kind of missingConsumerCaseKinds(plan,requirement.id))
            add(`consumer-case-${kind}-missing`, `/requirements/${ri}`, undefined, requirement.id, '/verification/checks');
    return total ? { version: 1 as const, pointerDomain: 'canonical-plan' as const, problems, omittedProblems: total - problems.length } : undefined;
}

/** Complete requirement/strategy membership, not complete or meaningful verification. */
export function hasCompleteStrategyAccounting(plan: PlanProposal): boolean {
    const strategies = plan.verification.strategies;
    return Array.isArray(strategies) && strategies.length === plan.requirements.length &&
        new Set(strategies.map(strategy => strategy.requirementId)).size === strategies.length &&
        strategies.every(strategy => plan.requirements.some(requirement => requirement.id === strategy.requirementId));
}

/** Retained declarations and actual runner output, not an attestation of internal routing. */
export function coverageIssue(plan: PlanProposal): string | null {
    const seen = new Set<string>();
    let count = 0, bytes = 0;
    for (const [checkIndex, check] of plan.verification.checks.entries()) {
        for (const [caseIndex, c] of (check.cases ?? []).entries()) {
            count++;
            bytes += Buffer.byteLength(JSON.stringify(c));
            if (seen.has(c.id))
                return 'Duplicate verification case ID';
            seen.add(c.id);
            const invalid = c.guaranteeIds.findIndex(id => !check.guaranteeIds.includes(id) || !plan.requirements.some(r => r.id === id));
            if (invalid >= 0) {
                const id = c.guaranteeIds[invalid]!;
                const display = (value: string) => JSON.stringify(value.slice(0, 96)) + (value.length > 96 ? ' [truncated; use pointer for exact value]' : '');
                return `Case guarantee is not accepted check/owner requirement at /verification/checks/${checkIndex}/cases/${caseIndex}/guaranteeIds/${invalid}: ${display(id)} ` +
                    (plan.requirements.some(r => r.id === id) ? `is absent from containing check ${display(check.id)} guaranteeIds` : 'is not a declared verification requirement') + `; case ${display(c.id)}`;
            }
        }
    }
    if (count > 128 || bytes > 131072)
        return 'Verification case descriptor exceeds bounded profile';
    const strategies = plan.verification.strategies;
    if (Object.hasOwn(plan.verification, 'strategies')) {
        if (!Array.isArray(strategies) || !hasCompleteStrategyAccounting(plan))
            return 'Verification strategies must account for every requirement exactly once';
        let leaves;
        try { leaves = strategies.flatMap(verificationStrategyLeaves); } catch { return 'Invalid bounded all-of strategy'; }
        const baseChecks = new Set(leaves.filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
        for (const check of plan.verification.checks)
            if (Object.hasOwn(check, 'baselineExpectedFailures') && (!baseChecks.has(check.id) ||
                !Array.isArray(check.baselineExpectedFailures) || !check.baselineExpectedFailures.length ||
                new Set(check.baselineExpectedFailures).size !== check.baselineExpectedFailures.length ||
                check.baselineExpectedFailures.some(id => !check.assertions.includes(id))))
                return 'Expected assertion failures require an explicit BASE-only check and a nonempty distinct subset of its declared assertions';
        for (const strategy of leaves) {
            if (strategy.kind === 'consumer-cases') {
                if (!strategy.checkIds.length || new Set(strategy.checkIds).size !== strategy.checkIds.length || strategy.checkIds.some(id => baseChecks.has(id) || !plan.verification.checks.some(check => check.id === id && check.guaranteeIds.includes(strategy.requirementId))))
                    return 'Consumer strategy requires distinct actual candidate checks with its requirement';
                for (const kind of missingConsumerCaseKinds(plan,strategy.requirementId,strategy.checkIds))
                    return `verification-cases-required: ${strategy.requirementId} lacks ${kind} actual consumer case`;
            }
            else if (strategy.kind === 'base-execution-duty') {
                const check = plan.verification.checks.find(check => check.id === strategy.checkId);
                if (!check || !strategy.caseIds.length || new Set(strategy.caseIds).size !== strategy.caseIds.length ||
                    !check.guaranteeIds.includes(strategy.requirementId) || strategy.caseIds.some(id => !check.cases?.some(c => c.id === id && c.guaranteeIds.includes(strategy.requirementId))))
                    return 'Baseline duty needs actual declared subject-observation cases';
                if (!plan.verification.reviewRoles.some(role => role.key === strategy.reviewKey)) return 'Baseline duty needs its required independent reviewer';
            }
            else if (strategy.kind === 'manifest-scope-duty') {
                const paths = [...strategy.allowedChangePaths, ...strategy.unchangedPaths];
                if (new Set(paths).size !== paths.length || !plan.verification.reviewRoles.some(role => role.key === strategy.reviewKey))
                    return 'Manifest duty needs distinct exact scope paths and its required independent reviewer';
            }
            else return 'Unsupported verification strategy; no qualitative waiver';
        }
    }
    else if (plan.verification.checks.some(check => Object.hasOwn(check, 'baselineExpectedFailures')))
        return 'Expected assertion failures require typed BASE-only verification';
    else for (const requirement of plan.requirements)
        for (const kind of missingConsumerCaseKinds(plan,requirement.id))
            return `verification-cases-required: ${requirement.id} lacks ${kind} case; material qualitative oracle unsupported in this finite profile`;
    return null;
}

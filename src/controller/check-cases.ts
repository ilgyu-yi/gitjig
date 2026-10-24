import { buildCaseDescriptor } from '../workflow/verification-contract.js';
import type { CheckSpec, PlanProposal, CheckOutput } from '../workflow/types.js';
import { hash } from './change-files.js';
/** Retained declarations and actual runner output, not an attestation of internal routing. */
export function coverageIssue(plan: PlanProposal): string | null {
    const seen = new Set<string>();
    let count = 0, bytes = 0;
    for (const check of plan.verification.checks) {
        for (const c of check.cases ?? []) {
            count++;
            bytes += Buffer.byteLength(JSON.stringify(c));
            if (seen.has(c.id))
                return 'Duplicate verification case ID';
            seen.add(c.id);
            if (c.guaranteeIds.some(id => !check.guaranteeIds.includes(id) || !plan.requirements.some(r => r.id === id)))
                return 'Case guarantee is not accepted check/owner requirement';
        }
    }
    if (count > 128 || bytes > 131072)
        return 'Verification case descriptor exceeds bounded profile';
    const strategies = plan.verification.strategies;
    if (Object.hasOwn(plan.verification, 'strategies')) {
        if (!Array.isArray(strategies) || strategies.length !== plan.requirements.length ||
            new Set(strategies.map(strategy => strategy.requirementId)).size !== strategies.length ||
            strategies.some(strategy => !plan.requirements.some(requirement => requirement.id === strategy.requirementId)))
            return 'Verification strategies must account for every requirement exactly once';
        const baseChecks = new Set(strategies.filter(strategy => strategy.kind === 'base-execution-duty').map(strategy => strategy.checkId));
        for (const strategy of strategies) {
            if (strategy.kind === 'consumer-cases') {
                if (!strategy.checkIds.length || new Set(strategy.checkIds).size !== strategy.checkIds.length || strategy.checkIds.some(id => baseChecks.has(id) || !plan.verification.checks.some(check => check.id === id && check.guaranteeIds.includes(strategy.requirementId))))
                    return 'Consumer strategy requires distinct actual candidate checks with its requirement';
                for (const kind of ['healthy', 'adverse'])
                    if (!plan.verification.checks.some(check => strategy.checkIds.includes(check.id) && check.cases?.some(c => c.kind === kind && c.guaranteeIds.includes(strategy.requirementId))))
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
    else for (const requirement of plan.requirements)
        for (const kind of ['healthy', 'adverse'])
            if (!plan.verification.checks.some(check => check.cases?.some(c => c.kind === kind && c.guaranteeIds.includes(requirement.id))))
                return `verification-cases-required: ${requirement.id} lacks ${kind} case; material qualitative oracle unsupported in this finite profile`;
    return null;
}
export const caseDescriptor = buildCaseDescriptor;
export function compareCases(check: CheckSpec, descriptor: ReturnType<typeof caseDescriptor>, output: CheckOutput | null) {
    const actual = output?.cases ?? [], expected = descriptor.cases;
    const complete = actual.length === expected.length && expected.every(c => actual.some(r => r.id === c.id && r.inputDigest === c.inputDigest));
    const mismatches = complete ? expected.filter(c => (actual.find(r => r.id === c.id)!.observed.kind !== c.declaration.expected.kind || actual.find(r => r.id === c.id)!.observed.value !== c.declaration.expected.value)).map(c => ({ id: c.id, inputDigest: c.inputDigest, expected: c.declaration.expected, observed: actual.find(r => r.id === c.id)!.observed })) : [];
    return { version: 1, checkBinding: hash(check), descriptorHash: hash(descriptor), complete, mismatches };
}
/** The finite amendment profile preserves ordered routing and changes only literal/expected bytes. */
export function changedCaseIds(before: CheckSpec, after: CheckSpec): string[] {
    const old = before.cases ?? [], next = after.cases ?? [];
    if (!old.length)
        return next.map(c => c.id); // Explicit legacy coverage adoption, never receipt promotion.
    if (old.length !== next.length)
        throw new Error('Case amendment preserves ordered roster');
    const stable = (c: NonNullable<CheckSpec['cases']>[number]) => ({ id: c.id, kind: c.kind, guaranteeIds: c.guaranteeIds, consumerPaths: c.consumerPaths, fixturePaths: c.input.fixturePaths });
    return old.flatMap((c, i) => {
        const n = next[i]!;
        if (hash(stable(c)) !== hash(stable(n)))
            throw new Error('Case amendment preserves ordered IDs/kinds/guarantees/consumer/fixture paths');
        return c.input.literalUtf8 !== n.input.literalUtf8 || c.expected.kind !== n.expected.kind || c.expected.value !== n.expected.value ? [c.id] : [];
    });
}

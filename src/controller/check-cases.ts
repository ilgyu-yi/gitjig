import type { Manifest } from './capture.js';
import { buildCaseDescriptor } from '../workflow/verification-contract.js';
import type { CheckSpec, CheckOutput, CheckOutputCase } from '../workflow/types.js';
import { hash } from './change-files.js';
/** Bind declared oracle files to the actual frozen target; absent coverage stays unknown. */
export function bindCheckExpectations(manifest: Manifest, check: Pick<CheckSpec, 'expectationPaths'>) {
    if (!Array.isArray(check.expectationPaths)) return null;
    const inputs = [];
    for (const path of check.expectationPaths) {
        const file = manifest.files.find(file => file.path === path);
        if (!file) return null;
        inputs.push({ path, sha256: file.sha256, executable: file.effectiveMode & 0o111 });
    }
    return inputs;
}
export class CheckExpectationInputError extends Error {
    readonly repairableProbe: boolean;
    constructor(readonly target: 'base' | 'candidate') {
        super(target === 'base'
            ? 'Declared expectation inputs are missing from the original immutable BASE check target; independently replan before authoring while preserving the required BASE duty'
            : 'Declared expectation inputs are missing from the frozen check target; repair the planned files before retrying this check');
        this.repairableProbe = target !== 'base';
    }
}

/** Exact BASE observations; no assertion is rewritten into a passing result. */
export function baselineAssertionsMatch(check: Pick<CheckSpec, 'assertions' | 'baselineExpectedFailures'>, assertions: CheckOutput['assertions']): boolean {
    const failed = check.baselineExpectedFailures ?? [];
    if (!Array.isArray(failed) || Object.hasOwn(check, 'baselineExpectedFailures') && !failed.length ||
        new Set(failed).size !== failed.length || failed.some(id => !check.assertions.includes(id)) ||
        new Set(check.assertions).size !== check.assertions.length || assertions.length !== check.assertions.length ||
        new Set(assertions.map(assertion => assertion.id)).size !== assertions.length) return false;
    return check.assertions.every(id => assertions.some(assertion => assertion.id === id && assertion.passed === !failed.includes(id)));
}
export {coverageIssue, verificationReferenceDiagnostics} from '../workflow/verification-strategy.js';

export const caseDescriptor = buildCaseDescriptor;
type OutputContractProblem = {kind: 'assertion-roster-size' | 'assertion-missing' | 'assertion-unexpected' | 'case-roster-size' | 'case-missing' | 'case-unexpected' | 'case-input-digest'; id?: string};
export type CheckOutputProblemCounts = Partial<Record<OutputContractProblem['kind'], number>>;
function caseBindings(descriptor: ReturnType<typeof caseDescriptor>, output: CheckOutput | null) {
    const actual = output?.cases ?? [], expected = descriptor.cases;
    const firstById = new Map<string, typeof actual[number]>();
    let repeated: Set<string> | undefined;
    for (const row of actual) {
        if (firstById.has(row.id))
            (repeated ??= new Set()).add(row.id);
        else
            firstById.set(row.id, row);
    }
    // Preserve the original v1 acceptance law, including its stored comparison.
    const bound = ({ id, inputDigest }: typeof expected[number]) => {
        const first = firstById.get(id);
        return !!first && (first.inputDigest === inputDigest ||
            repeated?.has(id) === true && actual.some(row => row.id === id && row.inputDigest === inputDigest));
    };
    const complete = actual.length === expected.length && expected.every(bound);
    return { actual, expected, firstById, bound, complete };
}
function diagnoseOutput(check: CheckSpec, output: CheckOutput | null, bindings: ReturnType<typeof caseBindings>, maxBytes: number) {
    const assertions = output?.assertions ?? [];
    const assertedIds = new Set(assertions.map(row => row.id));
    const rosterComplete = assertions.length === check.assertions.length && check.assertions.every(id => assertedIds.has(id));
    const problems: OutputContractProblem[] = [];
    if (!rosterComplete) {
        const expectedIds = new Set(check.assertions);
        if (assertions.length !== check.assertions.length) problems.push({ kind: 'assertion-roster-size' });
        for (const id of check.assertions)
            if (!assertedIds.has(id)) problems.push({ kind: 'assertion-missing', id });
        for (const { id } of assertions)
            if (!expectedIds.has(id)) problems.push({ kind: 'assertion-unexpected', id });
    }
    const { actual, expected, firstById, bound } = bindings;
    if (!bindings.complete) {
        const expectedIds = new Set(expected.map(row => row.id));
        if (actual.length !== expected.length) problems.push({ kind: 'case-roster-size' });
        for (const item of expected) {
            if (!firstById.has(item.id)) problems.push({ kind: 'case-missing', id: item.id });
            else if (!bound(item)) problems.push({ kind: 'case-input-digest', id: item.id });
        }
        for (const { id } of actual)
            if (!expectedIds.has(id)) problems.push({ kind: 'case-unexpected', id });
    }
    const counts: CheckOutputProblemCounts = {};
    for (const { kind } of problems) counts[kind] = (counts[kind] ?? 0) + 1;
    const complete = rosterComplete && bindings.complete;
    const visible: (OutputContractProblem & { omittedIdCharacters?: number })[] = [];
    // Keep the existing omission-count allowance and count only each added array member.
    if (problems.length) {
        let bytes = Buffer.byteLength(JSON.stringify({ version: 1, complete, counts, problems: [], omittedProblems: 1000000 }));
        for (const { kind, id } of problems) {
            const item = id === undefined ? { kind } : { kind, id: id.slice(0, 96), ...(id.length > 96 ? { omittedIdCharacters: id.length - 96 } : {}) };
            const extra = Buffer.byteLength(JSON.stringify(item)) + Number(visible.length > 0);
            if (bytes + extra <= maxBytes) {
                visible.push(item);
                bytes += extra;
            }
        }
    }
    return { version: 1, complete, counts, problems: visible, omittedProblems: problems.length - visible.length };
}
function compareBoundCases(check: CheckSpec, descriptor: ReturnType<typeof caseDescriptor>, { complete, firstById }: ReturnType<typeof caseBindings>) {
    const mismatches: (CheckOutputCase & { expected: CheckOutputCase['observed'] })[] = [];
    if (complete)
        for (const { id, inputDigest, declaration: { expected } } of descriptor.cases) {
            const observed = firstById.get(id)!.observed;
            if (observed.kind !== expected.kind || observed.value !== expected.value)
                mismatches.push({ id, inputDigest, expected, observed });
        }
    return { version: 1, checkBinding: hash(check), descriptorHash: hash(descriptor), complete, mismatches };
}
/** Structural producer diagnosis only. It certifies neither actual behavior nor repair. */
export function checkOutputDiagnosis(check: CheckSpec, descriptor: ReturnType<typeof caseDescriptor>, output: CheckOutput | null, maxBytes = 4096) {
    return diagnoseOutput(check, output, caseBindings(descriptor, output), maxBytes);
}
export function compareCases(check: CheckSpec, descriptor: ReturnType<typeof caseDescriptor>, output: CheckOutput | null) {
    return compareBoundCases(check, descriptor, caseBindings(descriptor, output));
}
export function observeCheckOutput(check: CheckSpec, descriptor: ReturnType<typeof caseDescriptor>, output: CheckOutput | null) {
    const bindings = caseBindings(descriptor, output);
    return { comparison: compareBoundCases(check, descriptor, bindings), diagnosis: diagnoseOutput(check, output, bindings, 4096) };
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

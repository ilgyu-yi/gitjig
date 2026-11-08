import { createHash } from 'node:crypto';
import type { CheckSpec } from './types.js';
import { protocolShapes } from './role-output-shape.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function consumerControlExpectsPass(value: unknown): boolean {
    const control = value as CheckSpec['consumerControl'];
    return Array.isArray(control?.observations) && control.observations.length === 0 &&
        Array.isArray(control.failedAssertions) && control.failedAssertions.length === 0;
}
/** The managed runner supplies no stdin. Recognize only a whole literal command. */
export function assertCheckHasProgram(check: Pick<CheckSpec, 'id' | 'command'>) {
    const command = check.command.trim();
    if (command === 'node' || /^node[ \t]+-$/u.test(command))
        throw new Error(`Check ${JSON.stringify(check.id)} has no Node program. The runner supplies no standard input. Name an executable checker file or include the complete inline program in the command.`);
}
/** One descriptor factory serves the actual check runner and its producer contract. */
export function buildCaseDescriptor(check: CheckSpec, target: {
    hash: string;
    data: { manifest: { files: readonly { path: string; sha256: string; effectiveMode: number }[] } };
}, boundVersions: unknown, runId: string) {
    check = structuredClone(check);
    boundVersions = structuredClone(boundVersions);
    const checkBinding = digest(check);
    const located = new Map<string, typeof target.data.manifest.files[number]>();
    const files = (paths: string[]) => paths.map(path => {
        const file = located.get(path) ?? target.data.manifest.files.find(file => file.path === path);
        if (!file) throw new Error('Case consumer/fixture is not captured regular input: ' + path);
        located.set(path, file);
        return { path, sha256: file.sha256, executable: file.effectiveMode & 0o111 };
    });
    return { version: 1, runId, candidateDigest: target.hash, boundVersions, checkBinding, cases: (check.cases ?? []).map(declaration => {
        const operands = { declaration, consumerFiles: files(declaration.consumerPaths), fixtureFiles: files(declaration.input.fixturePaths) };
        return { ...operands, id: declaration.id, inputDigest: digest({ version: 1, runId, candidateDigest: target.hash, boundVersions, checkBinding, operands }) };
    }) };
}
export function buildAssertionRoster(check: CheckSpec, descriptor: ReturnType<typeof buildCaseDescriptor>) {
    const { runId, candidateDigest, boundVersions, checkBinding } = descriptor;
    if (digest(check) !== checkBinding)
        throw Error('Assertion roster does not match the check binding');
    return { version: 1, runId, candidateDigest, boundVersions: structuredClone(boundVersions), checkBinding,
        caseDescriptorHash: digest(descriptor), assertionIds: [...check.assertions] };
}
export const verificationCommandContract = Object.freeze({
    descriptorPath: '/input/verification-cases.json',
    assertionRosterPath: '/input/verification-assertions.json',
    invocation: 'The host invokes check.command once per CheckSpec, not once per case. It supplies no implicit stdin input. At check time the read-only descriptor file contains all cases for that check. The harness reads that file, iterates its cases, invokes the real consumer through its declared decoder and emits one strict CheckOutput containing the complete assertion and case roster. Do not expect a case or descriptor to arrive on stdin; explicitly supply any stdin required by the consumer.',
    source: "A file-backed checker needs its actual source on the selected check target. Declare its oracle source in expectationPaths and respect every accepted scope, including any new directories. When the owner excludes adding that file and BASE has no checker, put the complete harness in check.command itself, including its program body. Bare node and node - have no program and are rejected. A quoted heredoc can supply the full program to node -; the harness calls the actual project consumer from /work and reads the runtime inputs from /input.",
    descriptor: Object.freeze({
        fields: Object.freeze(['version', 'runId', 'candidateDigest', 'boundVersions', 'checkBinding', 'cases']),
        caseFields: Object.freeze(['declaration', 'consumerFiles', 'fixtureFiles', 'id', 'inputDigest']),
        declaration: protocolShapes.verificationCase,
        fileFields: Object.freeze(['path', 'sha256', 'executable']),
        meaning: 'Read case.declaration.input.literalUtf8 and case.declaration.expected; id and inputDigest are top-level case fields. candidateDigest identifies the actual execution target, including an explicitly selected original base. Never invent inputDigest or observations. A declaration is not the executed result. literalUtf8 follows the real consumer input decoder. expected.value equals the decoded observed.value string, not an added JSON representation: an emitted empty string expects an empty value, not quote characters. If the consumer intentionally emits serialized text, match that actual text.',
    }),
    assertionRoster: 'The separate read-only assertionIds array names the accepted check assertions. Match its runId, candidateDigest, boundVersions and checkBinding to the case descriptor; caseDescriptorHash is the SHA-256 of its compact JSON. Evaluate the actual assertion for each exact ID. Case IDs and positions supply no assertion mapping or verdict.',
    coverage: 'Observe each required behavior directly. An acceptance predicate must allow conforming implementations that differ only in unspecified properties. For a required fresh result, compare identities across calls in the same process and report the result in an executed assertion. Equal serialized results can hide reuse, and mutability is a separate requirement. If rejection must leave input unchanged, snapshot its relevant state before the call and inspect that same input after rejection, even when it throws the expected error. Report the state comparison as a case observation or an executed assertion. During planning and independent review, consider what the checker observes on a violation and on a plausible conforming alternative where the predicate could confuse the two.',
    checkOutput: Object.freeze({
        ...protocolShapes.checkOutput,
        required: Object.freeze([...protocolShapes.checkOutput.required!, 'cases']),
    }),
    meaning: 'Only the managed check harness prints this strict CheckOutput on stdout. Emit an empty cases array when the descriptor has no cases. No extra fields: per-case passed, top-level hashes and command diagnostics are not admitted. A harness that demonstrates a declared subject rejection/defect can itself succeed; crash, timeout or unrelated nonzero exit is not a subject observation. Candidate checks require exit zero, all declared assertions true and matching cases. A before-edit BASE observation requires exit zero, matching cases and exact accepted assertion states: default all true; a plan captured with grammar3 or a supported later grammar may name baselineExpectedFailures whose actual states must be false, with every other declared state true. Record actual booleans truthfully. A matched BASE observation never qualifies candidate correctness, a crash or a nonzero exit. Never infer an expectation from narrative or retrofit an old receipt. RoleOutput is a separate protocol.',
});

export const verificationReportExample = `function report(observeCase, assertionChecks) {
    const {readFileSync} = require('node:fs');
    const {cases: inputs} = JSON.parse(readFileSync('${verificationCommandContract.descriptorPath}', 'utf8'));
    const {assertionIds} = JSON.parse(readFileSync('${verificationCommandContract.assertionRosterPath}', 'utf8'));
    const cases = inputs.map(({id, inputDigest, declaration}) =>
        ({id, inputDigest, observed: observeCase(declaration.input.literalUtf8, declaration.input.fixturePaths)}));
    const assertions = assertionIds.map(id => {
        const check = assertionChecks.get(id);
        if (!check) throw Error('Missing assertion implementation: ' + id);
        return {id, passed: check(cases)};
    });
    console.log(JSON.stringify({version: 1, assertions, cases}));
}`;

import { createHash } from 'node:crypto';
import type { CheckSpec } from './types.js';
import { protocolShapes } from './role-output-shape.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** One descriptor factory serves the actual check runner and its producer contract. */
export function buildCaseDescriptor(check: CheckSpec, target: {
    hash: string;
    data: { manifest: { files: readonly { path: string; sha256: string; effectiveMode: number }[] } };
}, boundVersions: unknown, runId: string) {
    check = structuredClone(check);
    boundVersions = structuredClone(boundVersions);
    const files = (paths: string[]) => paths.map(path => {
        const file = target.data.manifest.files.find(file => file.path === path);
        if (!file) throw new Error('Case consumer/fixture is not captured regular input: ' + path);
        return { path, sha256: file.sha256, executable: file.effectiveMode & 0o111 };
    });
    return { version: 1, runId, candidateDigest: target.hash, boundVersions, checkBinding: digest(check), cases: (check.cases ?? []).map(declaration => {
        const operands = { declaration, consumerFiles: files(declaration.consumerPaths), fixtureFiles: files(declaration.input.fixturePaths) };
        return { ...operands, id: declaration.id, inputDigest: digest({ version: 1, runId, candidateDigest: target.hash, boundVersions, checkBinding: digest(check), operands }) };
    }) };
}
export const verificationCommandContract = Object.freeze({
    descriptorPath: '/input/verification-cases.json',
    descriptor: Object.freeze({
        fields: Object.freeze(['version', 'runId', 'candidateDigest', 'boundVersions', 'checkBinding', 'cases']),
        caseFields: Object.freeze(['declaration', 'consumerFiles', 'fixtureFiles', 'id', 'inputDigest']),
        declaration: protocolShapes.verificationCase,
        fileFields: Object.freeze(['path', 'sha256', 'executable']),
        meaning: 'Read case.declaration.input.literalUtf8 and case.declaration.expected; id and inputDigest are top-level case fields. candidateDigest identifies the actual execution target, including an explicitly selected original base. Never invent inputDigest or observations. A declaration is not the executed result.',
    }),
    checkOutput: protocolShapes.checkOutput,
    meaning: 'Only the check harness prints this strict CheckOutput on stdout. No extra fields: per-case passed, top-level hashes and command diagnostics are not admitted. A harness that demonstrates a declared subject rejection/defect can itself succeed; crash, timeout or unrelated nonzero exit is not a subject observation. RoleOutput is a separate protocol.',
});

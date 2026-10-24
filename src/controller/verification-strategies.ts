import path from 'node:path';
import { validateCaptureProfile } from './capture.js';
import type { CaptureProfile } from './types.js';
import type { Manifest } from './capture.js';
import { captureNormalization, dependencyLinkNormalization, validateDependencyLinks } from './capture-links.js';
import { effective, hash } from './change-files.js';
import type { VerificationStrategy } from '../workflow/types.js';

export const scopePredicateVersion = 'complete-effective-manifest-scope/v1';
export type ScopeStrategy = Extract<VerificationStrategy, { kind: 'manifest-scope-duty' }>;
export interface EvidenceVersion { id: string; hash: string; data: { manifest: Manifest } }

function ownedPath(value: string) {
    if (!value || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/u.test(value))
        throw new Error('Manifest scope requires exact owned relative paths');
}
function manifest(version: EvidenceVersion, profile: CaptureProfile): Manifest {
    const limits = validateCaptureProfile(profile);
    const value = version.data.manifest;
    if (!value || ![captureNormalization, dependencyLinkNormalization].includes(value.normalization) || value.passes !== 2 ||
        value.normalization !== ((value.dependencyLinks?.length ?? 0) ? dependencyLinkNormalization : captureNormalization) ||
        !Array.isArray(value.files) || !Array.isArray(value.directories) || !Array.isArray(value.dependencyLinks ?? []) ||
        value.entries !== value.files.length + value.directories.length + (value.dependencyLinks?.length ?? 0) || value.entries > limits.maxEntries || !Number.isSafeInteger(value.bytes) || value.bytes > limits.maxBytes ||
        value.bytes !== value.files.reduce((sum, file) => sum + file.size, 0) + (value.dependencyLinks ?? []).reduce((sum, link) => sum + Buffer.byteLength(link.target), 0)) throw new Error('Complete supported manifest unavailable');
    const names = new Set<string>();
    for (const entry of [...value.files, ...value.directories, ...(value.dependencyLinks ?? [])]) {
        ownedPath(entry.path);
        if (names.has(entry.path)) throw new Error('Complete manifest has duplicate entries');
        names.add(entry.path);
    }
    const directories = new Set(value.directories.map(directory => directory.path));
    for (const name of names) if (name.includes('/') && !directories.has(path.posix.dirname(name))) throw new Error('Complete manifest parent directory missing');
    for (const file of value.files)
        if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777 ||
            file.effectiveMode !== (0o600 | (file.mode & 0o111))) throw new Error('Effective file normalization unavailable');
    for (const directory of value.directories)
        if (directory.effectiveMode !== 0o700) throw new Error('Effective directory normalization unavailable');
    validateDependencyLinks(value.dependencyLinks ?? [], value.files, value.directories);
    if (hash(effective(value)) !== version.hash) throw new Error('Complete manifest digest changed');
    return value;
}
/** The actual host scope consumer; no source/project mutation or worker judgment. */
export function compareManifestScope(base: Manifest, candidate: Manifest, strategy: ScopeStrategy) {
    const entries = (value: Manifest) => new Map<string, unknown>([
        ...value.files.map(file => [file.path, { kind: 'file', sha256: file.sha256, executable: file.effectiveMode & 0o111 }] as const),
        ...value.directories.map(directory => [directory.path, { kind: 'directory', effectiveMode: directory.effectiveMode }] as const),
        ...(value.dependencyLinks ?? []).map(link => [link.path, { kind: 'dependency-link', target: link.target }] as const),
    ]);
    const before = entries(base), after = entries(candidate);
    const changed = [...new Set([...before.keys(), ...after.keys()])].sort().filter(name => hash(before.get(name) ?? null) !== hash(after.get(name) ?? null));
    const allowed = new Set(strategy.allowedChangePaths), unchanged = new Set(strategy.unchangedPaths);
    const violations = changed.filter(name => !allowed.has(name) || unchanged.has(name));
    for (const name of unchanged) if (!before.has(name) || !after.has(name)) violations.push(name);
    return { satisfied: violations.length === 0, changedCount: changed.length, deltaDigest: hash(changed.map(name => [name, before.get(name) ?? null, after.get(name) ?? null])),
        violationCount: new Set(violations).size, violationDigest: hash([...new Set(violations)].sort()) };
}
export function manifestScopeEvidence(baseVersion: EvidenceVersion, candidateVersion: EvidenceVersion, strategy: ScopeStrategy, premises: unknown, profile: CaptureProfile = {}) {
    for (const name of [...strategy.allowedChangePaths, ...strategy.unchangedPaths]) ownedPath(name);
    if (new Set([...strategy.allowedChangePaths, ...strategy.unchangedPaths]).size !== strategy.allowedChangePaths.length + strategy.unchangedPaths.length)
        throw new Error('Scope paths overlap or repeat');
    const base = manifest(baseVersion, profile), candidate = manifest(candidateVersion, profile);
    let adverse = structuredClone(candidate);
    const disallowed = adverse.files.find(file => !strategy.allowedChangePaths.includes(file.path));
    let derivation: string, adversePath: string;
    if (disallowed) {
        adversePath = disallowed.path;
        const original = base.files.find(file => file.path === disallowed.path);
        const executable = ((original?.effectiveMode ?? disallowed.effectiveMode) ^ 0o100) & 0o111;
        disallowed.mode = (disallowed.mode & ~0o111) | executable;
        disallowed.effectiveMode = 0o600 | (disallowed.mode & 0o111);
        derivation = 'Set a disallowed regular file normalized owner executable bit opposite the original base (or its existing new entry); preserve captured bytes, SHA, size, directories and dependency links.';
    } else {
        adversePath = '__gitjig_scope_adverse__';
        for (let suffix = 0; strategy.allowedChangePaths.includes(adversePath); suffix++) adversePath = '__gitjig_scope_adverse__' + suffix;
        adverse = { digest: '', entries: 1, bytes: 0, passes: 2,
            files: [{ path: adversePath, sha256: hash(''), size: 0, mode: 0o600, effectiveMode: 0o600 }], directories: [], normalization: captureNormalization };
        derivation = 'Construct a complete virtual minimal counterexample with one disallowed empty regular file and no directories/links; omitted old entries are deletions, not a sampled census. No physical capture or project edit is claimed.';
    }
    const { digest: _oldDigest, passes: _capturePasses, ...captureInput } = adverse;
    adverse.digest = hash(captureInput);
    manifest({ id: 'host-derived-adverse-input', hash: hash(effective(adverse)), data: { manifest: adverse } }, profile);
    const actual = compareManifestScope(base, candidate, strategy), negative = compareManifestScope(base, adverse, strategy);
    if (negative.satisfied) throw new Error('Scope predicate did not reject its host-derived adverse delta');
    return { kind: 'manifest-scope-evidence/v1', predicate: scopePredicateVersion, strategyDigest: hash(strategy), premises,
        base: { id: baseVersion.id, digest: baseVersion.hash, normalization: base.normalization },
        candidate: { id: candidateVersion.id, digest: candidateVersion.hash, normalization: candidate.normalization },
        actual, captureLimits: validateCaptureProfile(profile), adverse: { derivation, path: adversePath, normalization: adverse.normalization, inputDigest: hash(effective(adverse)), observation: negative },
        meaning: 'Complete host comparison and host-derived adverse input; no source mutation, semantic scope approval or application correctness claim.' };
}

/** Shared capability facts, not a requirement classifier or an admission grant. */
export function finiteVerificationSupport(owner: { id: string; lineage: string; predecessor: string | null; data: string }, hasEditingProducer: boolean, typedMode = false, priorBaselineDuty = false) {
    const origin = JSON.parse(owner.data);
    const originalIndependent = owner.predecessor === null && owner.lineage === owner.id && !origin.contextOrigin && !origin.contextFamilyRoot && !origin.contextAssignment;
    const beforeFirstAuthor = !hasEditingProducer;
    const supported = originalIndependent && (beforeFirstAuthor || typedMode);
    const allowedKinds: VerificationStrategy['kind'][] = supported ? ['consumer-cases', ...(beforeFirstAuthor ? ['base-execution-duty' as const] : []), 'manifest-scope-duty'] : [];
    return { originalIndependent, beforeFirstAuthor, capability: {
        version: 1 as const, supported, allowedKinds,
        baseline: { newObservation: supported && beforeFirstAuthor, crossPlanReuse: false as const, priorDuty: priorBaselineDuty },
        ...(!originalIndependent ? { reason: 'Finite mixed planning is unavailable for inherited/context-derived work; historical witness mapping is unsupported.' }
            : !beforeFirstAuthor ? { reason: typedMode ? 'Typed consumer/scope accounting remains required. New before-edit observations and cross-plan historical baseline mapping are unavailable after an editing producer.' : 'Fresh mixed planning is unavailable for genuine legacy work after editing; historical witness mapping is unsupported.' } : {}),
    } };
}

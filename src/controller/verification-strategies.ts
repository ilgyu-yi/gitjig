import path from 'node:path';
import { validateCaptureProfile } from './capture.js';
import type { CaptureProfile } from './types.js';
import type { Manifest } from './capture.js';
import { captureNormalization, dependencyLinkNormalization, validateDependencyLinks } from './capture-links.js';
import { effective, hash } from './change-files.js';
import { administrativeScopeBaseline, type ScopeBaseView } from './scope-projection.js';
import type { PlanProposal, VerificationStrategy } from '../workflow/types.js';

export const scopePredicateVersion = 'complete-effective-manifest-scope/v1';
export type ScopeStrategy = Extract<VerificationStrategy, { kind: 'manifest-scope-duty' }>;
export interface EvidenceVersion { id: string; hash: string; data: { manifest: Manifest } }

function* parentPaths(name: string) {
    for (let parent = path.posix.dirname(name); parent !== '.' && parent !== '/'; parent = path.posix.dirname(parent))
        yield parent;
}

// This recognizes one whole shell command, without interpreting shell syntax.
function literalNodeEntry(command: string): string | undefined {
    return /^[ \t]*node[ \t]+(?:\.\/)?((?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.[cm]?js)[ \t]*$/u.exec(command)?.[1];
}

export function verificationSourcePaths(verification?: PlanProposal['verification']) {
    return [...(verification?.requiredPaths ?? []), ...(verification?.checks.flatMap(check => check.fixturePaths) ?? [])];
}

/** Required candidate check files and review sources must be possible under all exact scopes. */
export function assertVerificationScopeFeasible(base: Manifest, verification: PlanProposal['verification'], baselineIds: ReadonlySet<string>,
    scopes: readonly ScopeStrategy[]) {
    type EntryKind = 'regular file' | 'directory';
    const required = new Map<string, {kind: EntryKind; consumer: string}>();
    const requireEntry = (name: string, kind: EntryKind, consumer: string) => {
        ownedPath(name);
        const prior = required.get(name);
        if (prior && prior.kind !== kind)
            throw Error(`Verification inputs require both a regular file and directory at ${JSON.stringify(name)}`);
        if (!prior) required.set(name, {kind, consumer});
    };
    const requireFile = (file: string, consumer: string) => {
        requireEntry(file, 'regular file', consumer);
        for (const parent of parentPaths(file)) requireEntry(parent, 'directory', consumer);
    };
    const baseEntries = new Map<string, EntryKind | 'dependency link'>([
        ...base.files.map(entry => [entry.path, 'regular file'] as const),
        ...base.directories.map(entry => [entry.path, 'directory'] as const),
        ...(base.dependencyLinks ?? []).map(entry => [entry.path, 'dependency link'] as const),
    ]);
    const possibleEntries = [...baseEntries.keys(), ...scopes.flatMap(scope => scope.allowedChangePaths)];
    for (const check of verification.checks) {
        if (baselineIds.has(check.id)) continue;
        const consumer = `Candidate check ${JSON.stringify(check.id)}`;
        for (const file of new Set([...(check.expectationPaths ?? []), ...(check.cases ?? [])
            .flatMap(item => [...item.consumerPaths, ...item.input.fixturePaths])])) requireFile(file, consumer);
        const entry = literalNodeEntry(check.command);
        if (!entry || baseEntries.has(entry) || entry.split('/').includes('node_modules')) continue;
        // Directory entries and extra extensions can also resolve in Node.
        if (possibleEntries.some(name => name.startsWith(entry + '.') || name.startsWith(entry + '/'))) continue;
        requireFile(entry, consumer);
    }
    const reviewSources = verification.reviewRoles.flatMap(role => typeof role === 'string' ? [] : role.requiredPaths);
    for (const file of new Set([...verificationSourcePaths(verification), ...reviewSources])) {
        // Fresh review can receive the original BASE text even if its candidate path changes type.
        if (baseEntries.get(file) !== 'regular file') requireFile(file, `Required review source ${JSON.stringify(file)}`);
    }
    const permissions = scopes.map(scope => ({id: scope.requirementId,
        allowed: new Set(scope.allowedChangePaths), unchanged: new Set(scope.unchangedPaths)}));
    for (const scope of permissions)
        for (const name of scope.unchanged)
            if (!baseEntries.has(name))
                throw Error(`Declared manifest scope ${JSON.stringify(scope.id)} requires ${JSON.stringify(name)} to remain unchanged, but it is absent from BASE`);
    const blocking = (name: string) => permissions.find(scope => !scope.allowed.has(name) || scope.unchanged.has(name));
    const replacedDirectories = new Set<string>();
    for (const [name, input] of required) {
        const existing = baseEntries.get(name);
        if (existing === input.kind) continue;
        const scope = blocking(name);
        if (scope) throw Error(`${input.consumer} requires a ${input.kind} ${JSON.stringify(name)}. Declared manifest scope ${JSON.stringify(scope.id)} forbids the necessary BASE entry change`);
        if (existing === 'directory') replacedDirectories.add(name);
    }
    if (replacedDirectories.size) {
        for (const name of baseEntries.keys()) {
            for (const parent of parentPaths(name)) {
                if (!replacedDirectories.has(parent)) continue;
                const scope = blocking(name);
                if (scope) throw Error(`${required.get(parent)!.consumer} requires a regular file at ${JSON.stringify(parent)}. Declared manifest scope ${JSON.stringify(scope.id)} forbids removing its BASE descendant ${JSON.stringify(name)}`);
            }
        }
    }
}

function ownedPath(value: string) {
    if (!value || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/u.test(value))
        throw new Error('Manifest scope requires exact owned relative paths');
}
export function validateScopeManifest(version: EvidenceVersion, profile: CaptureProfile): Manifest {
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
type ScopeEntry = 'file' | 'directory' | 'dependency-link' | 'absent';
type ScopeManifestEntry = {kind: 'file'; sha256: string; executable: number} |
    {kind: 'directory'; effectiveMode: number} | {kind: 'dependency-link'; target: string};
interface ScopeViolation {
    path: string;
    before: ScopeEntry;
    after: ScopeEntry;
    reason: 'outside-scope' | 'protected-changed' | 'protected-missing';
}
export interface ScopeViolationSample {
    entries: ScopeViolation[];
    omitted: number;
}

/** The actual host scope consumer; no source/project mutation or worker judgment. */
function compareManifestScope(base: Manifest, candidate: Manifest, strategy: ScopeStrategy) {
    const entries = (value: Manifest) => new Map<string, ScopeManifestEntry>([
        ...value.files.map(file => [file.path, { kind: 'file', sha256: file.sha256, executable: file.effectiveMode & 0o111 }] as const),
        ...value.directories.map(directory => [directory.path, { kind: 'directory', effectiveMode: directory.effectiveMode }] as const),
        ...(value.dependencyLinks ?? []).map(link => [link.path, { kind: 'dependency-link', target: link.target }] as const),
    ]);
    const before = entries(base), after = entries(candidate);
    const changed = [...new Set([...before.keys(), ...after.keys()])].sort().filter(name => hash(before.get(name) ?? null) !== hash(after.get(name) ?? null));
    const allowed = new Set(strategy.allowedChangePaths), unchanged = new Set(strategy.unchangedPaths);
    const violations = changed.filter(name => !allowed.has(name) || unchanged.has(name));
    for (const name of unchanged) if (!before.has(name) || !after.has(name)) violations.push(name);
    const names = [...new Set(violations)].sort();
    const sample: ScopeViolation[] = [];
    for (const name of names) {
        if (sample.length === 4) break;
        if (Buffer.byteLength(JSON.stringify(name)) > 160) continue;
        const original = before.get(name)?.kind ?? 'absent', current = after.get(name)?.kind ?? 'absent';
        sample.push({path: name, before: original, after: current, reason: !unchanged.has(name) ? 'outside-scope' :
            original === 'absent' || current === 'absent' ? 'protected-missing' : 'protected-changed'});
    }
    const observation = {satisfied: violations.length === 0, changedCount: changed.length,
        deltaDigest: hash(changed.map(name => [name, before.get(name) ?? null, after.get(name) ?? null])),
        violationCount: names.length, violationDigest: hash(names)};
    return {observation, violationSample: {entries: sample, omitted: names.length - sample.length}};
}
export function manifestScopeComparison(baseVersion: EvidenceVersion, candidateVersion: EvidenceVersion, strategy: ScopeStrategy,
    premises: unknown, profile: CaptureProfile = {}, scopeView?: ScopeBaseView) {
    for (const name of [...strategy.allowedChangePaths, ...strategy.unchangedPaths]) ownedPath(name);
    if (new Set([...strategy.allowedChangePaths, ...strategy.unchangedPaths]).size !== strategy.allowedChangePaths.length + strategy.unchangedPaths.length)
        throw new Error('Scope paths overlap or repeat');
    const originalBase = validateScopeManifest(baseVersion, profile), candidate = validateScopeManifest(candidateVersion, profile);
    if (scopeView && (scopeView.baseId !== baseVersion.id || scopeView.baseDigest !== baseVersion.hash)) throw Error('Scope comparison view belongs to another original BASE');
    const base = scopeView ? administrativeScopeBaseline(originalBase) : originalBase;
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
    validateScopeManifest({ id: 'host-derived-adverse-input', hash: hash(effective(adverse)), data: { manifest: adverse } }, profile);
    const {observation: actual, violationSample} = compareManifestScope(base, candidate, strategy);
    const {observation: negative} = compareManifestScope(base, adverse, strategy);
    if (negative.satisfied) throw new Error('Scope predicate did not reject its host-derived adverse delta');
    const evidence = { kind: 'manifest-scope-evidence/v1', predicate: scopeView ? 'complete-native-administrative-manifest-scope/v1' : scopePredicateVersion, strategyDigest: hash(strategy), premises,
        base: { id: baseVersion.id, digest: baseVersion.hash, normalization: originalBase.normalization, ...(scopeView ? { scopeView: { digest: hash(effective(base)), derivation: 'Explicit virtual original-BASE comparison view; not a new capture or rewritten original version', proof: scopeView.proof } } : {}) },
        candidate: { id: candidateVersion.id, digest: candidateVersion.hash, normalization: candidate.normalization },
        actual, captureLimits: validateCaptureProfile(profile), adverse: { derivation, path: adversePath, normalization: adverse.normalization, inputDigest: hash(effective(adverse)), observation: negative },
        meaning: 'Complete host comparison and host-derived adverse input; no source mutation, semantic scope approval or application correctness claim.' };
    return {evidence, violationSample};
}

export function manifestScopeEvidence(...operands: Parameters<typeof manifestScopeComparison>) {
    return manifestScopeComparison(...operands).evidence;
}

/** Shared capability facts, not a requirement classifier or an admission grant. */
export function finiteVerificationSupport(owner: { id: string; lineage: string; predecessor: string | null; data: string }, hasEditingProducer: boolean, typedMode = false, priorBaselineDuty = false, legacyBaselineDeclarations = false, grammar: 10 | 11 | 12 = 10) {
    const origin = JSON.parse(owner.data);
    const originalIndependent = owner.predecessor === null && owner.lineage === owner.id && !origin.contextOrigin && !origin.contextFamilyRoot && !origin.contextAssignment;
    const beforeFirstAuthor = !hasEditingProducer;
    const supported = originalIndependent && (beforeFirstAuthor || typedMode);
    const allowedKinds: VerificationStrategy['kind'][] = supported ? ['consumer-cases', ...(beforeFirstAuthor ? ['base-execution-duty' as const] : []), 'manifest-scope-duty','all-of'] : [];
    return { originalIndependent, beforeFirstAuthor, capability: {
        version: legacyBaselineDeclarations ? 3 as const : grammar, supported, allowedKinds,
        baseline: { newObservation: supported && beforeFirstAuthor, crossPlanReuse: false as const, priorDuty: priorBaselineDuty },
        ...(!originalIndependent ? { reason: 'Finite mixed planning is unavailable for inherited/context-derived work; historical witness mapping is unsupported.' }
            : !beforeFirstAuthor ? { reason: typedMode ? 'Typed consumer/scope accounting remains required. New before-edit observations and cross-plan historical baseline mapping are unavailable after an editing producer.' : 'Fresh mixed planning is unavailable for genuine legacy work after editing; historical witness mapping is unsupported.' } : {}),
        ...(legacyBaselineDeclarations && supported ? { reason: 'Retained exact original BASE checks have unknown expectation-input declarations; grammar3 preserves their history without adding coverage.' } : {}),
    } };
}

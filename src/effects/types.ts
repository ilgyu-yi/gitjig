import type { Manifest } from '../controller/capture.js';
export type ObjectFormat = 'sha1' | 'sha256';
export interface NativeGitProfile {
    gitBinary: string;
    ownedClientRoot: string;
    objectFormat?: ObjectFormat;
    resumeOwned?: boolean;
    maxEntries?: number;
    maxBytes?: number;
    commandTimeoutMs?: number;
    operationTimeoutMs?: number;
    maxOutputBytes?: number;
}
/** Actual fresh factory namespace, captured before its first command admission. */
export interface NativeGitNamespaceProof {
    protocol: 'owned-native-git-prebirth/v1';
    clientRoot: string;
    device: string;
    inode: string;
    ownerUid: number;
    runsDirectory: string;
    runsDevice: string;
    runsInode: string;
    runsOwnerUid: number;
    gitBinary: string;
}
/** Trusted host callbacks, never serialized profile data or model arguments. */
export interface NativeGitLifecycle {
    exclusiveRoot: true;
    beforeFirstCommand(proof: Readonly<NativeGitNamespaceProof>): void;
    assertCurrent(): void;
}
/** Existing initialized marker identity; namespace data is not action authority. */
export interface NativeGitOwnerIdentity {
    version: 1;
    root: string; rootDevice: string; rootInode: string;
    repoDevice: string; repoInode: string;
    gitBinary: string; binaryDevice: string; binaryInode: string;
    objectFormat: ObjectFormat; metadataDate: string; configHash: string; attributesHash: string;
}
export interface NativeGitDirectoryMetadata {
    device: string; inode: string; ownerUid: number; mode: number;
}
export interface NativeGitFileMetadata extends NativeGitDirectoryMetadata {
    nlink: number; size: number; mtimeMs: number; ctimeMs: number;
}
export interface NativeGitControlLeaf extends NativeGitFileMetadata { sha256: string }
export interface NativeGitInitializedProof {
    protocol: 'owned-native-git-initialized/v1';
    namespace: NativeGitNamespaceProof;
    owner: NativeGitOwnerIdentity;
    repository: NativeGitDirectoryMetadata;
    marker: NativeGitControlLeaf;
    config: NativeGitControlLeaf;
    attributes: NativeGitControlLeaf;
    binary: NativeGitFileMetadata;
    home: NativeGitDirectoryMetadata;
    hooks: NativeGitDirectoryMetadata;
}
export interface NativeGitInitializedResume {
    kind: 'initialized-resume/v1';
    initialized: Readonly<NativeGitInitializedProof>;
    assertCurrent(): void;
}
export type NativeGitOpenLifecycle = NativeGitLifecycle | NativeGitInitializedResume;
export interface CapturedTree {
    versionId: string;
    digest: string;
    root: string;
    manifest: Manifest;
}
export interface LocalBareTarget {
    targetId: string;
    canonicalPath: string;
    device: string;
    inode: string;
    ownerUid: number;
    objectFormat: ObjectFormat;
    ref: string;
}
/** Captured before any application HOME/config projection. No credentials or arbitrary Git environment. */
export interface SourceGitEnvironment {
    home: string;
    xdgConfigHome?: string;
}
export interface SourceBranchTarget {
    kind: 'source-new-branch';
    targetId: string;
    canonicalPath: string;
    gitDirectory: string;
    commonDirectory: string;
    objectFormat: ObjectFormat;
    destinationRef: string;
    observedHead: string;
    observedHeadRef: string | null;
    environment: SourceGitEnvironment;
    policyFingerprint: string;
    /** Private ownership/config metadata only, never configuration contents. */
    identity: readonly SourcePolicyFile[];
}
export interface SourcePolicyFile {
    path: string;
    kind: 'directory' | 'file' | 'absent';
    /** Observed parent of selected Git configuration, not a private directory claim. */
    configurationAncestor?: true;
    device?: string;
    inode?: string;
    ownerUid?: number;
    mode?: number;
    sha256?: string;
}
export interface SourceBranchCreate {
    operationId: string;
    target: SourceBranchTarget;
    integrationCommit: string;
    /** Required by initialized-resume source actions; absent legacy calls retain their meaning. */
    expectedSnapshot?: { tree: string; basisCommit: string };
}
export interface PreparedSourceBranchCreate {
    readonly operationId: string;
    readonly target: SourceBranchTarget;
    readonly integrationCommit: string;
    readonly commands: readonly CommandReceipt[];
}
/** Original prepared descriptor fact only; no execution, retry or publication authority. */
export interface SourceBranchPreparedReference {
    protocol: 'source-branch-prepared/v1';
    clientRoot: string; commandId: string; descriptorSha256: string;
    descriptorIdentity: string; commandDirectoryIdentity: string;
    operationId: string; integrationCommit: string; destinationRef: string;
    tree: string; basisCommit: string;
}
export interface SourceBranchNoLaunchReference {
    commandId: string;
    descriptorSha256: string;
    terminalSha256: string;
}
export interface SourceBranchCreationReceipt {
    operationId: string;
    handoff: 'not-started' | 'started';
    outcome: 'created' | 'refused' | 'unknown';
    integrationCommit: string;
    destinationRef: string;
    command?: CommandReceipt;
    notStarted?: SourceBranchNoLaunchReference;
    reason?: string;
}
export interface SourceBranchReconciliation {
    kind: 'confirmed-creation' | 'observed-desired-state' | 'unknown';
    currentCommit: string | null;
    commands: readonly CommandReceipt[];
    reason?: string;
}
/** Pinned Git metadata only. Object IDs are not capture SHA256 byte hashes. */
export interface SourceBasisEntry {
    path: string;
    mode: '100644' | '100755' | '120000' | '160000';
    type: 'blob' | 'commit';
    objectId: string;
    size: number | null;
}
export interface SourceBasisTree {
    basisCommit: string;
    objectFormat: ObjectFormat;
    tree: string;
    /** Complete recursive leaf entries; explicit empty tree/directory objects are not enumerated. */
    entries: readonly SourceBasisEntry[];
    commands: readonly CommandReceipt[];
}
/** Closed source-family projection facts; this is not CurrentEvidence or publication authority. */
export interface SourceSnapshotProjectionInput {
    operationId: string;
    previewId: string;
    sourceInputDigest: string;
    base: CapturedTree;
    candidate: CapturedTree;
    basisCommit: string;
    authorizedDeltaPaths: readonly string[];
}
export interface SourceSnapshotBlob {
    side: 'base' | 'candidate';
    path: string;
    objectId: string;
    sha256: string;
    size: number;
    effectiveMode: number;
}
export interface SourceWholeFileAddition {
    path: string;
    capturedBasePresent: boolean;
    baseBlob: string | null;
    baseSha256: string | null;
    candidateBlob: string;
    candidateSha256: string;
    size: number;
    effectiveMode: number;
}
export interface SourceSnapshotProjectionReceipt {
    protocol: 'source-context-projection/v2';
    publicationBaselineProfile: 'k-absent-whole-file/v1';
    publicationBaseTree: string;
    wholeFileAdditions: readonly SourceWholeFileAddition[];
    operationId: string;
    previewId: string;
    sourceInputDigest: string;
    objectFormat: ObjectFormat;
    sourceVersions: { base: string; candidate: string };
    sourceDigests: { base: string; candidate: string };
    manifestDigests: { base: string; candidate: string };
    basisCommit: string;
    basisTree: string;
    syntheticBase: string;
    syntheticCandidate: string;
    projectedTree: string;
    projectedCommit: string;
    product: readonly { path: string; tracked: boolean; implementationDelta: boolean }[];
    basisEntries: readonly SourceBasisEntry[];
    projectedEntries: readonly SourceBasisEntry[];
    blobs: readonly SourceSnapshotBlob[];
    effectiveDifferences: readonly { path: string; reason: string }[];
    relation: {
        kind: 'identical' | 'nonidentity' | 'structural-conflict';
        modeProfile: 'retain-c-exec-mask-when-git-bit-agrees/v1';
        candidateDigest: string;
        productDigest: string;
        contextDigest: string;
        differences: readonly { path: string; reason: string }[];
    };
    metrics: { spoolPeakBytes: number; elapsedMs: number; sampledPeakRssBytes: number };
    commands: readonly CommandReceipt[];
}
export type SourceSnapshotProjectionResult = { kind: 'projected'; receipt: SourceSnapshotProjectionReceipt } | {
    kind: 'unavailable' | 'conflict' | 'unsupported-scope';
    reason: string;
    sourceVersions: { base: string; candidate: string };
    commands: readonly CommandReceipt[];
};
export interface GitFile {
    path: string;
    mode: '100644' | '100755';
    blob: string;
    sha256: string;
    size: number;
}
export interface CommandReceipt {
    sanitizedAuthDiagnostics?: true;
    sanitizedPolicyDiagnostics?: true;
    argv: readonly string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    timedOut: boolean;
    aborted: boolean;
    settled: boolean;
    stdoutBytes: number;
    stdoutSha256: string;
    stdoutExcerpted: boolean;
    commandId: string;
    journalPath: string;
    launcherPid: number | null;
    gitPid: number | null;
    gitStarted: boolean;
    cleanup: 'confirmed' | 'unknown';
}
export interface ProjectionInput {
    operationId: string;
    base: CapturedTree;
    candidate: CapturedTree;
    basisCommit: string;
    authorizedDeltaPaths: readonly string[];
    publicationInventory: readonly string[];
}
export interface ProjectionReceipt {
    operationId: string;
    sourceVersions: {
        base: string;
        candidate: string;
    };
    sourceDigests: {
        base: string;
        candidate: string;
    };
    basisCommit: string;
    syntheticBase: string;
    projectedTree: string;
    projectedCommit: string;
    files: readonly GitFile[];
    effectiveDifferences: readonly {
        path: string;
        reason: string;
    }[];
    commands: readonly CommandReceipt[];
}
export type ProjectionResult = {
    kind: 'projected';
    receipt: ProjectionReceipt;
} | {
    kind: 'no-change';
    basisCommit: string;
    tree: string;
    files: readonly GitFile[];
    effectiveDifferences: readonly {
        path: string;
        reason: string;
    }[];
    commands: readonly CommandReceipt[];
} | {
    kind: 'unavailable' | 'conflict';
    reason: string;
    sourceVersions: {
        base: string;
        candidate: string;
    };
    commands: readonly CommandReceipt[];
};
export type IntegrationResult = {
    kind: 'candidate';
    commit: string;
    tree: string;
    expectedBase: string;
    head: string;
    parents: readonly string[];
    files: readonly GitFile[];
    commands: readonly CommandReceipt[];
} | {
    kind: 'conflict' | 'unavailable';
    reason: string;
    commands: readonly CommandReceipt[];
};
export interface ForwardSend {
    operationId: string;
    target: LocalBareTarget;
    expectedBase: string;
    integrationCommit: string;
}
export interface PreparedForwardSend {
    readonly operationId: string;
    readonly expectedBase: string;
    readonly integrationCommit: string;
    readonly targetIdentity: LocalBareTarget;
    readonly commands: readonly CommandReceipt[];
}
export interface SendReceipt {
    operationId: string;
    handoff: 'not-started' | 'started';
    transport: 'native-success' | 'native-rejection' | 'uncertain';
    command?: CommandReceipt;
    reason?: string;
}
export interface LocalRefObservation {
    target: LocalBareTarget;
    commit: string | null;
    commands: readonly CommandReceipt[];
}
export type ForwardReconciliation = {
    kind: 'contains-integration';
    targetCommit: string;
    integrationCommit: string;
    laterAdvancement: boolean;
    commands: readonly CommandReceipt[];
} | {
    kind: 'unknown';
    targetCommit: string | null;
    reason: string;
    commands: readonly CommandReceipt[];
};

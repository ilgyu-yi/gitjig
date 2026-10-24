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
export interface GitFile {
    path: string;
    mode: '100644' | '100755';
    blob: string;
    sha256: string;
    size: number;
}
export interface CommandReceipt {
    sanitizedAuthDiagnostics?: true;
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

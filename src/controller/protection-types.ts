export interface ProjectProtectionPolicy {
    version: 1;
    revision: number;
    protectedPaths: string[];
    sourceEventId: string;
}
export interface ProjectProtectionBinding {
    version: 1;
    configured: boolean;
    revision: number;
    hash: string;
    protectedPaths: string[];
    sourceEventId: string | null;
}
export interface ProjectProtectionView extends ProjectProtectionBinding {
    projectId: string;
    boundRuns: {
        runId: string;
        revision: number;
        hash: string;
        phase: string;
    }[];
    limitations: string[];
}
export interface SetProjectProtection {
    projectId: string;
    expectedRevision: number;
    protectedPaths: readonly string[];
}

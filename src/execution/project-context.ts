/** Executor facts for tool presentation. They grant no access or verification standing. */
export interface ProjectExecutionContext {
    readonly projectRoot: string;
    readonly shellCwd: string;
    readonly projectAccess: 'read-only' | 'read-write';
    readonly readOnlyPaths: readonly string[];
    readonly scratchRoots: readonly string[];
    readonly inputMountRoot: string | null;
}

export function captureProjectExecutionContext(value: ProjectExecutionContext): ProjectExecutionContext {
    return Object.freeze({ projectRoot: value.projectRoot, shellCwd: value.shellCwd, projectAccess: value.projectAccess,
        readOnlyPaths: Object.freeze([...value.readOnlyPaths]), scratchRoots: Object.freeze([...value.scratchRoots]),
        inputMountRoot: value.inputMountRoot });
}

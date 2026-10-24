/** Mandatory project I/O seam. Implementations must enforce effective paths in
 * their owned execution scope, including aliases; this is not a sandbox itself. */
export interface PiProjectOperations {
    readonly workspaceRoot: string;
    validatePath(path: string): string;
    exec(command: string, cwd: string, options: {
        onData(data: Buffer): void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
    }): Promise<{
        exitCode: number | null;
    }>;
    readFile(path: string, options: {
        maxBytes: number;
        signal?: AbortSignal;
    }): Promise<Buffer>;
    access(path: string, mode: "read" | "read-write", signal?: AbortSignal): Promise<void>;
    writeFile(path: string, content: string, signal?: AbortSignal): Promise<void>;
    mkdir(path: string, signal?: AbortSignal): Promise<void>;
}

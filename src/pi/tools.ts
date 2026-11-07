import { createBashToolDefinition, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, DEFAULT_MAX_BYTES, type BashOperations, type ToolDefinition, } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { PiProjectOperations } from "./operations.js";
import { PiArtifacts } from "./host.js";
import { captureProjectExecutionContext } from '../execution/project-context.js';
const projectCoordinates = "Project file paths and shell commands use the captured project workspace. Use project-relative paths; the native connection directory is a separate host context.";
function textOnly(bytes: Buffer, maxBytes: number): Buffer {
    if (bytes.length > maxBytes)
        throw new Error("Read exceeds declared byte limit");
    if (bytes.includes(0))
        throw new Error("Binary/image reads are not supported by this text-only profile");
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        throw new Error("Binary/image reads are not supported by this text-only profile");
    }
    return bytes;
}
export function projectBash(operations: PiProjectOperations, outerSignal?: AbortSignal, checkEnvironment?: () => void): BashOperations {
    return { exec: (command, cwd, options) => {
            checkEnvironment?.();
            return operations.exec(command, operations.validatePath(cwd), {
                onData: options.onData,
                ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
                ...(options.signal || outerSignal ? {
                    signal: options.signal && outerSignal ? AbortSignal.any([options.signal, outerSignal]) : (options.signal ?? outerSignal)!,
                } : {}),
                // Native Pi gathers host shell environment. Do not forward it to project code.
            });
        } };
}
export interface ProjectReadObservation {
    readonly toolCallId: string;
    readonly args: { readonly path: string; readonly offset?: number; readonly limit?: number };
    readonly path: string;
    readonly text: string;
    readonly result: unknown;
}
/** Trusted synchronous host observer; never a project extension. */
export type ProjectReadObserver = (observation: ProjectReadObservation) => unknown;
export function createProjectTools(operations: PiProjectOperations, artifacts: PiArtifacts, maxReadBytes: number, admitHistoryArtifact?: (path: string) => Promise<void>, onProjectRead?: ProjectReadObserver): ToolDefinition[] {
    const cwd = operations.workspaceRoot;
    const execution = operations.executionContext && captureProjectExecutionContext(operations.executionContext);
    const checkEnvironment = () => artifacts.assertEnvironment(cwd);
    const bash = createBashToolDefinition(cwd, { operations: projectBash(operations, undefined, checkEnvironment), exposeSessionEnvironment: false });
    bash.description = "Execute a shell command in the captured project workspace. Returns bounded standard output and error; large output is retained as a registered tool-output artifact. An optional timeout is in seconds.";
    bash.promptSnippet = "Run shell commands in the captured project workspace using project-relative paths.";
    if (execution) {
        const input = execution.inputMountRoot === null
            ? 'No host input mount is supplied to this execution. Host verification descriptors are supplied only to a separate admitted check; do not recreate them here.'
            : `A read-only host input mount is supplied at ${JSON.stringify(execution.inputMountRoot)}. Its presence alone establishes no verification result.`;
        bash.description += ` Executor shell cwd: ${JSON.stringify(execution.shellCwd)}; project root: ${JSON.stringify(execution.projectRoot)}. Disposable scratch roots: ${JSON.stringify(execution.scratchRoots)}. Scratch experiments are not host-attested checks or an accepted candidate. ${input}`;
    }
    const executeBash = bash.execute;
    bash.execute = async (...args) => {
        checkEnvironment();
        const result = await executeBash(...args);
        const structured = result.structuredContent;
        const path = structured && typeof structured === "object" && !Array.isArray(structured)
            ? (structured as Record<string, unknown>).full_output_path : undefined;
        if (typeof path === "string")
            await artifacts.admit(path);
        if (result.details?.fullOutputPath && result.details.fullOutputPath !== path) {
            await artifacts.admit(result.details.fullOutputPath);
        }
        return result;
    };
    const read = createReadToolDefinition(cwd, { autoResizeImages: false });
    read.description = `Read UTF-8 text through the owned project executor (maximum ${maxReadBytes} bytes, with Pi's native rendering limits). Binary and image inputs are unsupported. Registered native tool-output artifacts are readable within those limits; artifact lines beyond ${DEFAULT_MAX_BYTES} bytes are unsupported.`;
    read.promptSnippet = "Read bounded UTF-8 text; binary/images are unsupported.";
    read.execute = async (id, input, signal, update, context) => {
        const captured = { path: input.path, ...(input.offset === undefined ? {} : { offset: input.offset }), ...(input.limit === undefined ? {} : { limit: input.limit }) };
        const observer = onProjectRead;
        let text: string | undefined;
        checkEnvironment();
        const requested = resolve(cwd, captured.path);
        await admitHistoryArtifact?.(requested);
        const artifact = artifacts.has(requested);
        const selected = artifact ? requested : operations.validatePath(requested);
        const same = (path: string): string => {
            if (resolve(path) !== selected)
                throw new Error("Native path normalization changed the admitted read target");
            return selected;
        };
        const tool = createReadToolDefinition(cwd, { autoResizeImages: false, operations: {
                access: async (path) => {
                    if (artifact) {
                        same(path);
                    }
                    else {
                        await operations.access(same(path), "read", signal);
                    }
                },
                detectImageMimeType: async () => null,
                readFile: async (path) => {
                    const bytes = textOnly(artifact ? await artifacts.read(same(path)) :
                        await operations.readFile(same(path), { maxBytes: maxReadBytes, ...(signal ? { signal } : {}) }), maxReadBytes);
                    if (artifact && bytes.toString("utf8").split("\n").some(line => Buffer.byteLength(line) > DEFAULT_MAX_BYTES)) {
                        throw new Error("Helper artifact has a line beyond Pi's native read limit; host-artifact shell access is unsupported. Produce a bounded multiline result or inspect the retained local artifact as its owner.");
                    }
                    // Copy before yielding: executor buffers may be reused by another call.
                    const snapshot = Buffer.from(bytes);
                    if (!artifact)
                        text = snapshot.toString("utf8");
                    return snapshot;
                },
            } });
        if (context && resolve(context.cwd) !== resolve(cwd))
            throw new Error("Tool context changed its owned workspace");
        const result = await tool.execute(id, { ...captured, path: selected }, signal, update, context);
        checkEnvironment();
        signal?.throwIfAborted();
        if (!artifact && text !== undefined && observer) {
            const observed = observer({ toolCallId: id, args: structuredClone(captured), path: selected, text, result: structuredClone(result) });
            if (observed !== undefined) {
                // Consume a rejected unsupported async callback without accepting it.
                void Promise.resolve(observed).catch(() => {});
                throw new Error("Project read observer must return undefined synchronously");
            }
        }
        return result;
    };
    const write = createWriteToolDefinition(cwd);
    write.execute = async (id, input, signal, update, context) => {
        checkEnvironment();
        if (context && resolve(context.cwd) !== resolve(cwd))
            throw new Error("Tool context changed its owned workspace");
        const selected = operations.validatePath(resolve(cwd, input.path));
        const tool = createWriteToolDefinition(cwd, { operations: {
                mkdir: (path) => operations.mkdir(operations.validatePath(path), signal),
                writeFile: (path, content) => operations.writeFile(operations.validatePath(path), content, signal),
            } });
        return tool.execute(id, { ...input, path: selected }, signal, update, context);
    };
    const edit = createEditToolDefinition(cwd);
    edit.execute = async (id, input, signal, update, context) => {
        checkEnvironment();
        if (context && resolve(context.cwd) !== resolve(cwd))
            throw new Error("Tool context changed its owned workspace");
        const selected = operations.validatePath(resolve(cwd, input.path));
        const tool = createEditToolDefinition(cwd, { operations: {
                access: (path) => operations.access(operations.validatePath(path), "read-write", signal),
                readFile: async (path) => textOnly(await operations.readFile(operations.validatePath(path), {
                    maxBytes: maxReadBytes, ...(signal ? { signal } : {}),
                }), maxReadBytes),
                writeFile: (path, content) => operations.writeFile(operations.validatePath(path), content, signal),
            } });
        return tool.execute(id, { ...input, path: selected }, signal, update, context);
    };
    // SDK customTools erases each tool's schema/render generic at its registry
    // boundary. These native definitions retain their own validated schemas.
    for (const tool of [read, write, edit, bash]) {
        tool.description += " " + projectCoordinates;
        if (execution) tool.description += ` Executor project access: ${execution.projectAccess}. Read-only project paths: ${JSON.stringify(execution.readOnlyPaths)}.`;
        tool.promptGuidelines = [...(tool.promptGuidelines ?? []), projectCoordinates];
    }
    return [read, write, edit, bash] as unknown as ToolDefinition[];
}

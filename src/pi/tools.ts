import { createBashToolDefinition, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, DEFAULT_MAX_BYTES, type BashOperations, type ToolDefinition, } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { PiProjectOperations } from "./operations.js";
import { PiArtifacts } from "./host.js";
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
export function createProjectTools(operations: PiProjectOperations, artifacts: PiArtifacts, maxReadBytes: number, admitHistoryArtifact?: (path: string) => Promise<void>): ToolDefinition[] {
    const cwd = operations.workspaceRoot;
    const checkEnvironment = () => artifacts.assertEnvironment(cwd);
    const bash = createBashToolDefinition(cwd, { operations: projectBash(operations, undefined, checkEnvironment), exposeSessionEnvironment: false });
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
        checkEnvironment();
        const requested = resolve(cwd, input.path);
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
                    return bytes;
                },
            } });
        if (context && resolve(context.cwd) !== resolve(cwd))
            throw new Error("Tool context changed its owned workspace");
        return tool.execute(id, { ...input, path: selected }, signal, update, context);
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
    return [read, write, edit, bash] as unknown as ToolDefinition[];
}

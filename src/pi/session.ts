import { assertNativeFormatterSchema, freezeStructuredOutput, structuredOutputContext, structuredOutputMetadataKey, type StructuredOutputIntent } from './structured-output.js';
import { assertModelContextBudget, ModelContextBudgetError } from './context-budget.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { clampThinkingLevel } from '@earendil-works/pi-ai';
import { isAbsolute, join, resolve } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager, type ProviderConfig, type ResourceLoader, type AgentSession, } from "@earendil-works/pi-coding-agent";
import { assertPiHost, assertOwnedStateFile, assertPiHistoryPath, ensurePiSessionDirectory, inside, PiArtifacts, type PiHostEnvironment } from "./host.js";
import { createOwnedPiProvider } from './native-provider.js';
import { createOwnedResources, inlineExtension } from './resources.js';
import { ownChatRuntime } from './owned-runtime.js';
import { assertNativeProviderProfile, type NativeProviderProfile } from './native-profile.js';
import type { PiProjectOperations } from "./operations.js";
import { captureProjectExecutionContext } from '../execution/project-context.js';
import { createGoalTools, type PiGoalControls } from "./goal-tools.js";
import { createCoordinationTools, type PiCoordination } from './coordination.js';
import { createProjectTools, projectBash, type ProjectReadObserver } from "./tools.js";
import { captureSessionPreferences, type SessionQueuePreferences } from './session-preferences.js';
import { internalResultLanguage } from './language-policy.js';
export type PiModelSelection = {
    provider: string;
    modelId: string;
    bridgeProfile?: import('./claude-profile.js').NativeClaudeProfile;
    /** Used only by an admitted bridge selection; direct thinking stays in its owned recipe. */
    bridgeThinkingLevel?: import('@earendil-works/pi-ai').ModelThinkingLevel;
    sessionPreferences?: SessionQueuePreferences;
} & ({
    managed?: never;
    definition: ProviderConfig;
    bridge?: never;
    runtime?: never;
    native?: never;
} | {
    managed?: never;
    runtime: ModelRuntime;
    definition?: never;
    native?: never;
    bridge?: never;
} | {
    managed?: never;
    bridge: import('./claude-host.js').OwnedClaudeHost;
    native?: never;
    definition?: never;
    runtime?: never;
} | {
    managed?: never;
    native: NativeProviderProfile;
    bridge?: never;
    definition?: never;
    runtime?: never;
} | {
    managed: import('./managed-provider.js').ManagedModelSource;
    native?: never;
    bridge?: never;
    definition?: never;
    runtime?: never;
});
export interface CreatePiSessionOptions {
    host: PiHostEnvironment;
    operations: PiProjectOperations;
    model: PiModelSelection;
    systemPrompt: string;
    /** Host-owned guidance refreshed before every conversational request projection. */
    requestLanguagePolicy?: () => string;
    maxReadBytes: number;
    onProjectRead?: ProjectReadObserver;
    /** Trusted original-role evidence only; never ambient/user-file admission. */
    inputEvidence?: { artifacts: readonly { path: string; sha256: string; bytes: number }[]; onRead: ProjectReadObserver };
    /** Governed conversational requests only; ordinary/auxiliary policy is unchanged. */
    roleContextBudget?: {
        assertEntry(): void;
        structuredOutput?: { intent: StructuredOutputIntent; observe(data: unknown, manager: SessionManager): void };
    };
    sessionManager?: SessionManager;
    /** Finite installed host controls only; never ambient/project extension code. */
    coordination?: PiCoordination;
    /** Capability reduction only; controller-private review admission owns identity. */
    readOnly?: boolean;
    goal?: PiGoalControls;
    /** Trusted host guard awaited before each native model dispatch; never a project resource. */
    beforeModelRequest?: (sessionManager: SessionManager) => Promise<void>;
    /** Actual original provider receives the resolved model, with secrets removed. */
    onModelDispatch?: (evidence: Record<string, unknown>) => void;
}
export interface PiUserBashOptions {
    excludeFromContext?: boolean;
    id?: string;
    onChunk?: (chunk: string) => void;
}
/** These are ordinary native sessions, not workflow approval or action authority. */
export interface PiSession {
    readonly session: AgentSession;
    readonly sessionManager: SessionManager;
    readonly resourceLoader: ResourceLoader;
    readonly modelRuntime: ModelRuntime;
    /** Stop admission and await this session's original auth/stream tails. Borrowed runtimes remain caller-owned. */
    closeOwned(): Promise<void>;
    /** Irreversibly stop this execution; does not dispose its original client. */
    sealOwned(): void;
    /** Only owned clients can prove quiescence while preserving the real object. */
    readonly canRetainOwned: boolean;
    joinIdleOwned(): Promise<void>;
    compactOwned(instructions?: string, signal?: AbortSignal): ReturnType<AgentSession["compact"]>;
    navigateTreeOwned(entryId: string, signal?: AbortSignal): ReturnType<AgentSession["navigateTree"]>;
    executeUserBash(command: string, signal?: AbortSignal, options?: PiUserBashOptions): ReturnType<AgentSession["executeBash"]>;
}
export async function createPiSession(options: CreatePiSessionOptions): Promise<PiSession> {
    const { host, onProjectRead } = options;
    if (onProjectRead !== undefined && typeof onProjectRead !== "function")
        throw new Error("Project read observer must be a function");
    const beforeModelRequest = options.beforeModelRequest;
    const budgetOwner = options.roleContextBudget;
    const inputEvidence = options.inputEvidence;
    if (inputEvidence && (!budgetOwner || !Array.isArray(inputEvidence.artifacts) || typeof inputEvidence.onRead !== 'function')) throw Error('Input evidence requires its captured governed role owner and observer');
    const evidence = inputEvidence && Object.freeze({ artifacts: Object.freeze(inputEvidence.artifacts.map(a => Object.freeze({ path: a.path, sha256: a.sha256, bytes: a.bytes }))), onRead: inputEvidence.onRead });
    if (budgetOwner !== undefined && typeof beforeModelRequest !== "function")
        throw new Error("Role context budget requires the original request checkpoint");
    const structuredOwner = budgetOwner?.structuredOutput;
    const structuredIntent = structuredOwner ? freezeStructuredOutput(structuredOwner.intent) : undefined;
    if (structuredIntent) assertNativeFormatterSchema(structuredIntent.schema);
    const observeStructured = structuredOwner?.observe;
    if (structuredOwner && (typeof observeStructured !== 'function' || !options.model.bridge && !options.model.bridgeProfile))
        throw new Error('Structured role output requires an owned bridge and original observer');
    const assertBudgetEntry: (() => unknown) | undefined = budgetOwner?.assertEntry;
    if (budgetOwner !== undefined && typeof assertBudgetEntry !== 'function')
        throw new Error('Role context budget requires a synchronous entry guard');
    const budgetEntry = assertBudgetEntry ? () => {
        const returned = assertBudgetEntry.call(budgetOwner);
        if (returned !== undefined) {
            void Promise.resolve(returned).catch(() => {});
            throw new Error('Role context entry guard must return undefined synchronously');
        }
    } : undefined;
    let executionSealed = false;
    const assertExecution = () => {
        if (executionSealed)
            throw new Error('Pi execution is sealed; admit a fresh execution');
    };
    const actions = new Set<Promise<unknown>>();
    const ownAction = <T>(task: Promise<T>): Promise<T> => {
        actions.add(task);
        void task.then(() => actions.delete(task), () => actions.delete(task));
        return task;
    };
    const originalOperations = options.operations;
    if (!originalOperations || ["validatePath", "exec", "readFile", "access", "writeFile", "mkdir"].some(key => typeof originalOperations[key as keyof PiProjectOperations] !== 'function'))
        throw new Error('A complete owned project executor is required; no local fallback is available');
    const assertWrite = () => {
        if (options.readOnly)
            throw new Error("Independent goal review is read-only; exec/write are unavailable");
    };
    const operations: PiProjectOperations = {
        ...(originalOperations.executionContext ? { executionContext: captureProjectExecutionContext({ ...originalOperations.executionContext,
            projectAccess: options.readOnly ? 'read-only' : originalOperations.executionContext.projectAccess }) } : {}),
        workspaceRoot: originalOperations.workspaceRoot,
        validatePath: path => { assertExecution(); return originalOperations.validatePath(path); },
        exec: (command, cwd, request) => { assertExecution(); assertWrite(); return ownAction(originalOperations.exec(command, cwd, request)); },
        readFile: (path, request) => { assertExecution(); return ownAction(originalOperations.readFile(path, request)); },
        access: (path, mode, signal) => {
            assertExecution();
            if (mode !== "read")
                assertWrite();
            return ownAction(originalOperations.access(path, mode, signal));
        },
        writeFile: (path, content, signal) => { assertExecution(); assertWrite(); return ownAction(originalOperations.writeFile(path, content, signal)); },
        mkdir: (path, signal) => { assertExecution(); assertWrite(); return ownAction(originalOperations.mkdir(path, signal)); },
    };
    const guardedCoordination = options.coordination ? Object.fromEntries(Object.entries(options.coordination).map(([key, value]) => [key, typeof value === 'function' ? (...args: unknown[]) => { assertExecution(); const result: unknown = Reflect.apply(value, options.coordination, args); return result instanceof Promise ? ownAction(result) : result; } : value])) as PiCoordination : undefined;
    // Snapshot host configuration before the first asynchronous admission. Trusted
    // callback functions retain identity; their JSON configuration cannot drift.
    const sessionPreferences = captureSessionPreferences(options.model.sessionPreferences);
    let model = options.model.native || options.model.managed ? structuredClone(options.model) :
        (options.model.bridge || options.model.bridgeProfile ? options.model : { ...options.model });
    if (model.definition)
        model = { ...model, definition: snapshotDefinition(model.definition) };
    if (model.bridge || model.bridgeProfile) {
        const { admitOwnedClaudeSelection } = await import('./claude-host.js');
        if (sessionPreferences) {
            // Queue behavior is outside the bridge's closed provider capability.
            // Preserve its non-enumerable owner while removing only that envelope field.
            const descriptors = Object.getOwnPropertyDescriptors(model);
            delete descriptors.sessionPreferences;
            model = Object.create(Object.getPrototypeOf(model), descriptors) as PiModelSelection;
        }
        model = admitOwnedClaudeSelection(model);
    }
    let waitPending = false;
    const coordinationTools = [...(guardedCoordination ? createCoordinationTools(guardedCoordination, () => { waitPending = true; }) : []), ...(options.goal ? createGoalTools(options.goal) : [])];
    const supportsWait = coordinationTools.some(tool => tool.name === 'conversation_wait');
    if (!operations || !isAbsolute(operations.workspaceRoot) ||
        ["validatePath", "exec", "readFile", "access", "writeFile", "mkdir"].some(key => typeof operations[key as keyof PiProjectOperations] !== "function")) {
        throw new Error("A complete owned project executor is required; no local fallback is available");
    }
    const cwd = operations.validatePath(operations.workspaceRoot);
    if (await realpath(cwd) !== cwd)
        throw new Error("Executor workspace must be its canonical real path");
    assertPiHost(host, cwd);
    if (!Number.isSafeInteger(options.maxReadBytes) || options.maxReadBytes < 1 || options.maxReadBytes > 32 * 1024 * 1024) {
        throw new Error("maxReadBytes must be an explicit positive bound no larger than 32MiB");
    }
    if (!options.systemPrompt.trim() || !model.provider || !model.modelId)
        throw new Error("Explicit prompt/provider/model are required");
    let modelRuntime: ModelRuntime;
    let ownedRuntime: ReturnType<typeof ownChatRuntime> | undefined;
    let bridgeSession: Awaited<ReturnType<typeof import('./claude-host.js')['prepareOwnedClaudeSession']>> | undefined;
    let bridgeOwnerId: string | undefined;
    let nativeSession: AgentSession | undefined;
    let resources: ReturnType<typeof createOwnedResources> | undefined;
    let closing: Promise<void> | undefined;
    let extensionErrors = 0;
    const sealOwned = () => { executionSealed = true; ownedRuntime?.seal(); bridgeSession?.seal(); };
    const closeOwned = (): Promise<void> => closing ??= (async () => {
        sealOwned();
        const tail = ownedRuntime?.close();
        const bridgeTail = bridgeSession?.closeSession(bridgeOwnerId ?? '');
        try {
            await nativeSession?.abort();
        }
        finally {
            try {
                if (bridgeSession && nativeSession)
                    await nativeSession.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
            }
            finally {
                try {
                    nativeSession?.dispose();
                }
                finally {
                    try { resources?.close(); }
                    finally {
                        const results = await Promise.allSettled([tail, bridgeTail, ...actions]);
                        if (extensionErrors || results.some(result => result.status === 'rejected'))
                            throw new Error('Owned model cleanup unavailable');
                    }
                }
            }
        }
    })();
    try {
        if (model.bridgeThinkingLevel !== undefined && !model.bridge)
            throw new Error('Bridge thinking requires an admitted bridge selection');
        if (Number(Boolean(model.native)) + Number(Boolean(model.runtime)) + Number(Boolean(model.definition)) + Number(Boolean(model.bridge)) + Number(Boolean(model.managed)) !== 1)
            throw new Error("Model selection requires exactly one explicit native, runtime or definition choice");
        if (model.bridge) {
            const { prepareOwnedClaudeSession } = await import('./claude-host.js');
            bridgeSession = await prepareOwnedClaudeSession(model, cwd, host);
            modelRuntime = bridgeSession.runtime;
        }
        else if (model.managed) {
            const { createOwnedManagedProvider } = await import('./managed-provider.js');
            ownedRuntime = await createOwnedManagedProvider(model.provider, model.modelId, model.managed, options.onModelDispatch);
            modelRuntime = ownedRuntime.runtime;
        }
        else if (model.native) {
            await assertNativeProviderProfile(model.provider, model.modelId, model.native, [cwd]);
            ownedRuntime = await createOwnedPiProvider(model.provider, model.modelId, model.native, [cwd]);
            modelRuntime = ownedRuntime.runtime;
        }
        else if (model.runtime) {
            // Only trusted host composition supplies this explicit instance. It owns the
            // selected credential/model profile; no ambient factory is substituted.
            modelRuntime = model.runtime;
        }
        else {
            const key = model.definition.apiKey;
            if (typeof key !== "string" || !key || key.startsWith("!") || key.includes("$")) {
                throw new Error("This initial provider profile requires an explicit literal key, not command/env discovery");
            }
            for (const name of ["auth.json", "models.json", "model-catalog.json"]) {
                await assertOwnedStateFile(join(host.stateRoot, name));
            }
            modelRuntime = await ModelRuntime.create({
                authPath: join(host.stateRoot, "auth.json"), modelsPath: join(host.stateRoot, "models.json"),
                modelsStorePath: join(host.stateRoot, "model-catalog.json"), allowModelNetwork: false, refreshOnCreate: false,
            });
            const provider = model.provider, modelId = model.modelId;
            const assertModel = (selected: {
                provider: string;
                id: string;
                api: string;
            }) => {
                const admitted = modelRuntime.getModel(provider, modelId);
                if (!admitted || selected.provider !== provider || selected.id !== modelId || selected.api !== admitted.api)
                    throw new Error('Explicit model is unavailable; no model fallback is allowed');
            };
            ownedRuntime = ownChatRuntime(modelRuntime, {
                assertModel,
                beforeAuth: (selected, request) => {
                    if ((typeof selected === 'string' ? selected : selected.provider) !== provider || request.env !== undefined ||
                        (request.apiKey !== undefined && request.apiKey !== key))
                        throw new Error('Explicit provider cannot select another credential or environment fallback');
                    if (typeof selected !== 'string')
                        assertModel(selected);
                },
            });
            modelRuntime.registerProvider(model.provider, model.definition);
        }
        const selectedModel = modelRuntime.getModel(model.provider, model.modelId);
        if (!selectedModel)
            throw new Error("Explicit model is unavailable; no model fallback is allowed");
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false },
            ...sessionPreferences,
            ...(model.managed ? { enableInstallTelemetry: false } : {}) });
        resources = createOwnedResources([
            ...(bridgeSession ? [inlineExtension('claude-bridge', bridgeSession.handlers)] : []),
            inlineExtension('project-bash', new Map([['user_bash', [async () => ({operations: projectBash(operations, undefined, () => assertPiHost(host, cwd))})]]])),
        ], options.systemPrompt);
        const {resourceLoader} = resources;
        const sessionDir = await ensurePiSessionDirectory(host);
        const sessionManager = options.sessionManager ?? SessionManager.create(cwd, sessionDir);
        if (resolve(sessionManager.getCwd()) !== resolve(cwd) || !sessionManager.getSessionFile() ||
            !inside(host.stateRoot, resolve(sessionManager.getSessionFile()!))) {
            throw new Error("Native session history must belong to the explicit workspace and host state root");
        }
        await assertPiHistoryPath(host, sessionManager.getSessionFile()!);
        bridgeOwnerId = sessionManager.getSessionId();
        bridgeSession?.bindOwner(bridgeOwnerId);
        const artifacts = new PiArtifacts(host, options.maxReadBytes);
        for (const artifact of evidence?.artifacts ?? []) await artifacts.admit(artifact.path, artifact);
        const tools = createProjectTools(operations, artifacts, options.maxReadBytes, async (path) => {
            // Public user-bash records are written by native session machinery, not by
            // project tools. Only the same conversation's actually recorded outputs
            // may enter the helper artifact namespace on a later read.
            for (const entry of sessionManager.getEntries()) {
                if (entry.type === "message" && entry.message.role === "bashExecution" &&
                    entry.message.fullOutputPath && resolve(entry.message.fullOutputPath) === path) {
                    await artifacts.admit(entry.message.fullOutputPath);
                }
            }
        }, onProjectRead, evidence?.onRead);
        const admittedTools = options.readOnly ? tools.filter(tool => tool.name === "read") : tools;
        // Own the complete project-tool callback before native Pi captures it.
        // Registered helper-artifact reads may bypass the project operations layer.
        for (const tool of admittedTools) {
            const execute = tool.execute;
            tool.execute = (...args) => {
                assertExecution();
                return ownAction(execute.apply(tool, args));
            };
        }
        const { session } = await createAgentSession({
            cwd, agentDir: host.stateRoot, modelRuntime, ...(selectedModel ? { model: selectedModel } : {}), thinkingLevel: model.managed?.thinkingLevel ?? model.bridgeThinkingLevel ?? 'off',
            settingsManager, resourceLoader, sessionManager, noTools: "all", tools: [...admittedTools.map(tool => tool.name), ...coordinationTools.map(tool => tool.name)],
            customTools: [...admittedTools, ...coordinationTools],
        });
        nativeSession = session;
        await session.bindExtensions({ mode: "json", onError: () => { extensionErrors++; } });
        if (bridgeSession) {
            await bridgeSession.registered();
            const exact = modelRuntime.getModel(model.provider, model.modelId);
            if (!exact || extensionErrors)
                throw new Error('Exact full bridge registration unavailable');
            await session.setModel(exact);
            const thinking = model.bridgeThinkingLevel ?? clampThinkingLevel(exact, 'off');
            session.setThinkingLevel(thinking);
            if (session.model?.provider !== model.provider || session.model.id !== model.modelId || session.thinkingLevel !== thinking)
                throw new Error('Original bridge model or thinking differs from the admitted selection');
            if (extensionErrors)
                throw new Error('Full bridge selection unavailable');
        }
        {
            const nativePrepare = session.agent.prepareRequest;
            type PreparedRequest = Exclude<Awaited<ReturnType<NonNullable<typeof nativePrepare>>>, void>;
            session.agent.prepareRequest = (request, signal) => {
                const prepare = async (): Promise<PreparedRequest | undefined> => {
                    assertExecution();
                    budgetEntry?.();
                    assertExecution();
                    const update = await nativePrepare?.call(session.agent, request, signal);
                    assertExecution();
                    if (waitPending)
                        throw new Error('Conversation dependencies pending: no new provider dispatch');
                    budgetEntry?.();
                    assertExecution();
                    if (!budgetEntry)
                        await beforeModelRequest?.(sessionManager);
                    assertExecution();
                    if (options.requestLanguagePolicy) {
                        const context = update?.context ?? request.context, policy = options.requestLanguagePolicy();
                        const sections = context.messages.filter(message => message.role === 'system').flatMap(message => message.sections && Object.hasOwn(message.sections, 'gitjig-language') ? [message.sections['gitjig-language']] : []);
                        if (sections.at(-1) !== policy)
                            return {
                                ...update, context: {
                                    ...context, messages: [...context.messages, { role: 'system' as const, content: '', sections: { 'gitjig-language': policy }, timestamp: Date.now() }]
                                }
                            };
                    }
                    if (update)
                        return update;
                    return undefined;
                };
                // Role guards can reenter close: own their tail before invoking them.
                return ownAction<PreparedRequest | undefined>(budgetEntry ? Promise.resolve().then(prepare) : prepare());
            };
        }
        const originalConversationalStream = session.agent.streamFunction;
        if (budgetEntry) {
            session.agent.streamFunction = (selected, context, requestOptions) => {
                const identity = [selected.provider, selected.id, selected.api, selected.baseUrl, selected.contextWindow, selected.maxTokens];
                const signal = requestOptions?.signal;
                const assertRequest = () => {
                    assertExecution();
                    signal?.throwIfAborted();
                    if (requestOptions?.signal !== signal)
                        throw new Error('Original request cancellation signal changed during admission');
                    if (structuredIntent && requestOptions?.metadata && Object.hasOwn(requestOptions.metadata, structuredOutputMetadataKey) &&
                        JSON.stringify(requestOptions.metadata[structuredOutputMetadataKey]) !== JSON.stringify(structuredIntent))
                        throw new Error('Conflicting original structured role intent');
                    const current = [selected.provider, selected.id, selected.api, selected.baseUrl, selected.contextWindow, selected.maxTokens];
                    if (current.some((value, index) => value !== identity[index]))
                        throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'The selected request model changed during admission; review the original task before retrying.');
                };
                return ownAction(Promise.resolve().then(async () => {
                    try {
                        assertRequest();
                        budgetEntry();
                        assertRequest();
                        assertModelContextBudget(selected, structuredIntent ? structuredOutputContext(context, structuredIntent) : context);
                        await beforeModelRequest!(sessionManager);
                        assertRequest();
                        budgetEntry();
                        assertRequest();
                        assertModelContextBudget(selected, structuredIntent ? structuredOutputContext(context, structuredIntent) : context);
                    }
                    catch (error) {
                        // Host refusal is an error stream, never a provider response or success.
                        const stream = createAssistantMessageEventStream(), reason = signal?.aborted ? 'aborted' as const : 'error' as const;
                        const message = { role: 'assistant' as const, content: [], api: selected.api, provider: selected.provider, model: selected.id,
                            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                            stopReason: reason, errorMessage: `HOST_CONTEXT_GUARD:${String(error)}`, timestamp: Date.now() };
                        stream.push({ type: 'error', reason, error: message });
                        stream.end(message);
                        return stream;
                    }
                    // Once dispatch begins, preserve the original provider's result or failure.
                    const observer = requestOptions?.onProviderStreamEvent;
                    const providerOptions = structuredIntent ? { ...requestOptions,
                        metadata: { ...requestOptions?.metadata, [structuredOutputMetadataKey]: structuredIntent },
                        onProviderStreamEvent: async (data: unknown, dispatched: Parameters<NonNullable<typeof observer>>[1]) => {
                            const captured = structuredClone(data);
                            if (observer) await observer.call(requestOptions, structuredClone(data), dispatched);
                            assertExecution();
                            observeStructured!.call(structuredOwner, captured, sessionManager);
                        },
                    } : requestOptions;
                    return await originalConversationalStream.call(session.agent, selected, context, providerOptions);
                }));
            };
        }

        if (supportsWait) {
            const nativeFinish = session.agent.finishTurn;
            session.agent.finishTurn = async (turn, signal) => {
                const decision = await nativeFinish?.call(session.agent, turn, signal);
                return waitPending ? { action: 'end' } : (decision || undefined);
            };
        }
        const guardCommand = (owner: object, key: string) => {
            const target = owner as Record<string, unknown>, original = target[key];
            if (typeof original !== 'function')
                throw new Error('Pinned public Pi command unavailable: ' + key);
            target[key] = (...args: unknown[]) => {
                assertExecution();
                const value = Reflect.apply(original, owner, args);
                return value && typeof value.then === 'function' ? ownAction(value) : value;
            };
        };
        for (const key of ['prompt', 'steer', 'followUp', 'sendCustomMessage', 'sendUserMessage', 'executeBash', 'recordBashResult', 'compact', 'navigateTree', 'setModel', 'cycleModel', 'setThinkingLevel', 'cycleThinkingLevel', 'setScopedModels', 'setActiveToolsByName', 'setSteeringMode', 'setFollowUpMode', 'setAutoCompactionEnabled', 'setAutoRetryEnabled', 'setCacheWarmingMode', 'refreshContext', 'reload', 'bindExtensions', 'setSessionName', 'exportToHtml', 'exportToJsonl', 'summarizeForBugReport'])
            guardCommand(session, key);
        for (const key of ['prompt', 'continue', 'steer', 'followUp'])
            guardCommand(session.agent, key);
        const streamFunction = session.agent.streamFunction;
        session.agent.streamFunction = (...args) => { assertExecution(); return streamFunction(...args); };
        const canRetainOwned = !model.runtime && !model.managed;
        const joinIdleOwned = async () => {
            if (!executionSealed)
                throw new Error('Seal Pi execution before idle join');
            if (!canRetainOwned)
                throw new Error('Borrowed runtime has no owned idle settlement; reclaim immediately');
            await session.waitForIdle();
            while (actions.size)
                await Promise.allSettled([...actions]);
            await ownedRuntime?.joinIdle();
            await bridgeSession?.joinIdle();
            if (!session.isIdle || session.isCompacting || session.isBashRunning || session.isRetrying || session.pendingMessageCount || extensionErrors)
                throw new Error('Pi idle settlement unavailable');
        };
        return {
            session, sessionManager, resourceLoader, modelRuntime, closeOwned, sealOwned, canRetainOwned, joinIdleOwned,
            compactOwned: (instructions, outerSignal) => ownAction((async () => {
                assertExecution();
                assertPiHost(host, cwd);
                if (!session.isIdle)
                    throw new Error('Owned manual compaction requires an idle conversation');
                if (!beforeModelRequest)
                    throw new Error('Owned compaction requires a durable dispatch checkpoint callback');
                const deadline = new AbortController(), signal = outerSignal ? AbortSignal.any([outerSignal, deadline.signal]) : deadline.signal;
                signal.throwIfAborted();
                const timer = setTimeout(() => deadline.abort(new Error('Owned compaction deadline180s exceeded')), 180000);
                timer.unref();
                const restoreStream = session.agent.streamFunction;
                const nativeStream = budgetEntry ? originalConversationalStream : restoreStream;
                let requests = 0;
                const abort = () => session.abortCompaction();
                signal.addEventListener('abort', abort, { once: true });
                const admitSummary = async () => {
                    assertExecution();
                    assertPiHost(host, cwd);
                    signal.throwIfAborted();
                    if (requests >= 2)
                        throw new Error('Owned compaction summary request cap2 exceeded');
                    requests++; // Claim synchronously before checkpoint awaits; no refund/retry escape.
                    await beforeModelRequest(sessionManager);
                    assertExecution();
                    signal.throwIfAborted();
                };
                let summaryScope: {
                    close(): Promise<void>;
                } | undefined;
                try {
                    summaryScope = bridgeSession?.openSummaryOperation(signal, admitSummary);
                }
                catch (error) {
                    clearTimeout(timer);
                    signal.removeEventListener('abort', abort);
                    throw error;
                }
                session.agent.streamFunction = async (selected, context, requestOptions) => {
                    const requestSignal = requestOptions?.signal ? AbortSignal.any([signal, requestOptions.signal]) : signal;
                    try {
                        assertPiHost(host, cwd);
                        requestSignal.throwIfAborted();
                        // Hosted summaries are admitted by the owner-bound isolated hook.
                        if (!bridgeSession)
                            await admitSummary();
                        requestSignal.throwIfAborted();
                        return await nativeStream.call(session.agent, selected, context, { ...requestOptions, signal: requestSignal });
                    }
                    catch (error) {
                        // Public StreamFn requires a terminal error stream rather than a
                        // rejection. This is a host admission failure, not a provider receipt.
                        const stream = createAssistantMessageEventStream(), reason = requestSignal.aborted ? 'aborted' as const : 'error' as const;
                        const message = { role: 'assistant' as const, content: [], api: selected.api, provider: selected.provider, model: selected.id,
                            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                            stopReason: reason, errorMessage: `HOST_COMPACTION_GUARD:${String(error)}`, timestamp: Date.now() };
                        stream.push({ type: 'error', reason, error: message });
                        stream.end(message);
                        return stream;
                    }
                };
                try {
                    return await session.compact([instructions, internalResultLanguage, 'Retain the human conversation language and explicit reply-language preferences in the English summary so later human-facing replies can preserve them.'].filter(Boolean).join('\n\n'));
                }
                finally {
                    session.agent.streamFunction = restoreStream;
                    clearTimeout(timer);
                    signal.removeEventListener('abort', abort);
                    await summaryScope?.close();
                }
            })()),
            navigateTreeOwned: (entryId, signal) => ownAction((async () => {
                assertExecution();
                assertPiHost(host, cwd);
                signal?.throwIfAborted();
                if (!session.isIdle)
                    throw new Error('Owned history navigation requires an idle conversation');
                const result = await session.navigateTree(entryId, { summarize: false });
                signal?.throwIfAborted();
                return result;
            })()),
            executeUserBash: (command, signal, bashOptions) => ownAction((async () => {
                assertWrite();
                assertExecution();
                assertPiHost(host, cwd);
                const result = await session.executeBash(command, bashOptions?.onChunk, { operations: projectBash(operations, signal, () => assertPiHost(host, cwd)), ...(bashOptions?.excludeFromContext === undefined ? {} : { excludeFromContext: bashOptions.excludeFromContext }), ...(bashOptions?.id === undefined ? {} : { id: bashOptions.id }) });
                if (result.fullOutputPath)
                    await artifacts.admit(result.fullOutputPath);
                return result;
            })()),
        };
    }
    catch (error) {
        try {
            await closeOwned();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Pi session construction failed and owned cleanup is unavailable', { cause: error });
        }
        throw error;
    }
}
import { realpath } from "node:fs/promises";
function snapshotDefinition<T>(value: T): T {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return Object.freeze(value.map(item => snapshotDefinition(item))) as T;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        throw new Error('Provider configuration must use plain host data');
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotDefinition(item)]))) as T;
}

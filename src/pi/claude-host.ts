import type { ModelRuntime, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { PiModelSelection } from './session.js';
import { realpath, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type { PiHostEnvironment } from './host.js';
import { inside } from '../controller/ownership.js';
import { readOwnerJson } from '../app/owner-json.js';
import { claudeStartupEnvironment, nativeClaudeEnvironment, assertNativeClaudeAccountRoute, validateNativeClaudeAccountHome } from './claude-profile.js';
import type { NativeProcessIdentity } from './native-process.js';
import { captureSessionPreferences } from './session-preferences.js';
export async function validateClaudeHostConfiguration(input: {
    cwd: string;
    agentDir: string;
}): Promise<void> {
    const expected = { askClaude: { enabled: false }, provider: { strictMcpConfig: true, autoMemoryEnabled: false } };
    for (const file of new Set([resolve(input.agentDir, 'claude-bridge.json'), resolve(input.cwd, '.pi/claude-bridge.json')])) {
        let value: unknown;
        try {
            value = await readOwnerJson(file, [], 'Bridge fixed configuration', 16 * 1024);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' && file !== resolve(input.agentDir, 'claude-bridge.json'))
                continue;
            throw error;
        }
        const data = value as Record<string, unknown>;
        if (!data || Object.keys(data).some(key => !['askClaude', 'provider', 'startupNoticeShown'].includes(key)) ||
            JSON.stringify(data.askClaude) !== JSON.stringify(expected.askClaude) || JSON.stringify(data.provider) !== JSON.stringify(expected.provider))
            throw new Error('Bridge requires the fixed no-helper host configuration');
    }
}
export interface OwnedClaudeHost {
    readonly modelSelection: PiModelSelection;
    models(): Promise<readonly Model<Api>[]>;
    selectModel(modelId: string, thinkingLevel?: ModelThinkingLevel): Promise<PiModelSelection>;
    close(): Promise<void>;
}
interface BridgeSession {
    runtime: ModelRuntime;
    extension: ExtensionFactory;
    bindOwner(id: string): void;
    registered(): Promise<void>;
    seal(): void;
    joinIdle(): Promise<void>;
    closeSession(id: string): Promise<void>;
    openSummaryOperation(signal: AbortSignal, admit: () => Promise<void>): {
        close(): Promise<void>;
    };
}
const owned = new WeakMap<object, {
    prepare(selection: PiModelSelection, projectRoot: string, environment: PiHostEnvironment): Promise<BridgeSession>;
    assertOpen(): void;
    authorityRoots: readonly string[];
}>();
const controllerOwners = new WeakMap<object, object>();
const selectionAuthority = Symbol('owned Claude selection');
const issued = new WeakMap<object, PiModelSelection>();
let configured = false;
/** Explicit trusted process-startup contract. No mutation of process cwd/env or ambient discovery. */
export async function createOwnedClaudeHost(input: {
    cwd: string;
    agentDir: string;
    executable: NativeProcessIdentity;
    nativeAccountHome?: string;
}): Promise<OwnedClaudeHost> {
    input = Object.freeze({ ...input, executable: Object.freeze({ ...input.executable }) });
    const { assertPiHost } = await import('./host.js');
    if (Object.keys(input).some(key => !['cwd', 'agentDir', 'executable', 'nativeAccountHome'].includes(key)) || Object.keys(input.executable).some(key => !['file', 'sha256'].includes(key)) || configured)
        throw new Error('One fixed explicit bridge host is supported per process');
    if (await realpath(input.cwd) !== input.cwd || await realpath(input.agentDir) !== input.agentDir ||
        process.cwd() !== input.cwd || process.env.PI_CODING_AGENT_DIR !== input.agentDir)
        throw new Error('Bridge requires the explicit controlled CLI startup cwd and agent directory');
    for (const folder of [input.cwd, input.agentDir]) {
        const info = await stat(folder);
        if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
            throw new Error('Bridge startup directories must be owner-private');
    }
    // Refuse ambient provider/routing/helper selection BEFORE SDK import/registration.
    const admittedEnvironment = new Set(claudeStartupEnvironment);
    for (const [name, value] of Object.entries(process.env)) {
        if (name === 'CLAUDE_AGENT_SDK_VERSION' && value && value !== '0.3.284')
            throw new Error('Controlled SDK version marker differs');
        if ((name === 'NoDefaultCurrentDirectoryInExePath' || name === 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') && value && value !== '1')
            throw new Error('Controlled SDK marker differs');
        if (value && !admittedEnvironment.has(name))
            throw new Error('Ambient provider or helper selector is unavailable in the controlled bridge process');
    }
    const accountDirectory = process.env.CLAUDE_CONFIG_DIR;
    const validateConfiguration = async () => {
        await validateClaudeHostConfiguration(input);
        await validateNativeClaudeAccountHome(input.nativeAccountHome, accountDirectory);
    };
    await validateConfiguration();
    const nativeEnvironment = nativeClaudeEnvironment(process.env);
    if (input.nativeAccountHome) {
        // The explicit default login route differs from CLAUDE_CONFIG_DIR routing.
        // Keep Pi's process HOME isolated; project only the native child's auth home.
        nativeEnvironment.HOME = input.nativeAccountHome;
        delete nativeEnvironment.CLAUDE_CONFIG_DIR;
    }
    const env = Object.freeze(nativeEnvironment);
    const executable = Object.freeze({ ...input.executable });
    configured = true;
    let closing: Promise<void> | undefined, closed = false;
    const preparations = new Set<Promise<unknown>>();
    const slots = new Set<Awaited<ReturnType<typeof import('./claude-runtime.js')['createOwnedClaudeRuntime']>>>();
    let host: ReturnType<typeof import('@gitjig/pi-claude-bridge-host')['createClaudeBridgeHost']> | undefined;
    let producer: Awaited<ReturnType<typeof import('./native-process.js')['createOwnedNativeProducer']>> | undefined;
    const startupEnvironment = Object.freeze(Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'CLAUDE_AGENT_SDK_VERSION')));
    const assertOpen = () => {
        if (closed)
            throw new Error('Bridge host closing');
        if (process.cwd() !== input.cwd)
            throw new Error('Bridge startup cwd changed');
        for (const [name, value] of Object.entries(process.env)) {
            if (!value)
                continue;
            if (name === 'CLAUDE_AGENT_SDK_VERSION' && value !== '0.3.284')
                throw new Error('Controlled SDK version marker changed');
            if ((name === 'NoDefaultCurrentDirectoryInExePath' || name === 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') && value !== '1')
                throw new Error('Controlled SDK marker changed');
            if (!admittedEnvironment.has(name) || (name !== 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' && name !== 'NoDefaultCurrentDirectoryInExePath' && name !== 'CLAUDE_AGENT_SDK_VERSION' && value !== startupEnvironment[name]))
                throw new Error('Bridge startup environment changed: ' + name);
        }
        for (const [name, value] of Object.entries(startupEnvironment))
            if (name !== 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' && name !== 'NoDefaultCurrentDirectoryInExePath' && process.env[name] !== value)
                throw new Error('Bridge startup environment changed');
    };
    let nativeStateRoot: string | undefined;
    const sealedOwners = new Set<string>();
    const nativeTails = new Map<string, Set<Promise<unknown>>>(), nativeFailures = new Set<string>();
    let initializing: Promise<void> | undefined;
    const initialize = () => initializing ??= (async () => {
        const { createClaudeBridgeHost } = await import('@gitjig/pi-claude-bridge-host');
        assertOpen();
        host = createClaudeBridgeHost({ cwd: input.cwd, env, pathToClaudeCodeExecutable: executable.file, settingSources: [],
            assertNativeLaunch: () => {
                assertOpen();
                assertNativeClaudeAccountRoute(input.nativeAccountHome, accountDirectory);
            }, settings: {
                disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
                enabledPlugins: { 'bento-slides@bento': false, 'drop@drop': false, 'agents-md@builtin': false, 'plugin-authoring@builtin': false },
            }, spawnNative: ({ options, ownerSessionId, purpose }) => {
                if (!producer)
                    throw new Error('Bridge native producer has no admitted session state');
                if (sealedOwners.has(ownerSessionId))
                    throw new Error('Owned Claude execution sealed before native birth');
                const launch = producer!.launch(options, { ownerSessionId, purpose });
                const pending = nativeTails.get(ownerSessionId) ?? new Set<Promise<unknown>>();
                nativeTails.set(ownerSessionId, pending);
                pending.add(launch.settled);
                void launch.settled.then(receipt => {
                    if (receipt.cleanup !== 'confirmed' || !receipt.exited || !receipt.pipesClosed || !receipt.scopeJoined)
                        nativeFailures.add(ownerSessionId);
                    pending.delete(launch.settled);
                }, () => { nativeFailures.add(ownerSessionId); pending.delete(launch.settled); });
                return launch;
            }, observeNative: () => {
                // The derivative validates the captured role-filtered tools, MCP
                // correspondence and finite native plugin policy before admission.
            } });
    })();
    let producerInitialization: Promise<void> | undefined;
    const initializeProducer = () => producerInitialization ??= (async () => {
        const { createOwnedNativeProducer } = await import('./native-process.js');
        assertOpen();
        producer = await createOwnedNativeProducer(executable, undefined, nativeStateRoot);
        assertOpen();
    })();
    let catalogue: Promise<readonly Model<Api>[]> | undefined;
    let initializationMode: 'catalogue' | 'legacy' | undefined;
    const models = (): Promise<readonly Model<Api>[]> => {
        assertOpen();
        if (initializationMode === 'legacy')
            throw new Error('Bridge legacy startup already entered; restart with application setup for catalogue models');
        if (catalogue)
            return catalogue;
        initializationMode = 'catalogue';
        const task = (async () => {
            // Public Pi discovery scans HOME/.agents even with resource loading
            // disabled. Never run it against an unspecified or nonprivate home.
            const discoveryHome = process.env.HOME;
            if (discoveryHome !== resolve(input.agentDir, 'home') || await realpath(discoveryHome) !== discoveryHome)
                throw new Error('Bridge catalogue requires the fixed application agentDir/home startup HOME; restart with application setup');
            const homeInfo = await stat(discoveryHome);
            if (!homeInfo.isDirectory() || homeInfo.uid !== process.getuid?.() || homeInfo.mode & 0o077)
                throw new Error('Bridge catalogue requires a fixed private startup HOME; restart with application setup');
            await validateConfiguration();
            await initialize();
            assertOpen();
            const { DefaultResourceLoader, SettingsManager, ModelRuntime } = await import('@earendil-works/pi-coding-agent');
            const { InMemoryCredentialStore, InMemoryModelsStore } = await import('@earendil-works/pi-ai');
            const { ownChatRuntime } = await import('./owned-runtime.js');
            assertOpen();
            const loader = new DefaultResourceLoader({ cwd: input.cwd, agentDir: input.agentDir,
                settingsManager: SettingsManager.inMemory(), extensionFactories: [host!.extension],
                noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
            const loaded = await loader.loadProjectTrustExtensions();
            let owner: ReturnType<typeof ownChatRuntime> | undefined;
            try {
                assertOpen();
                if (loaded.errors.length || loaded.extensions.length !== 1 || loaded.runtime.pendingNativeProviderRegistrations.length ||
                    loaded.runtime.pendingVirtualModelRegistrations.length || loaded.runtime.pendingProviderRegistrations.length !== 1)
                    throw new Error('Original bridge catalogue registration unavailable');
                const registration = loaded.runtime.pendingProviderRegistrations[0]!;
                if (registration.name !== 'claude-bridge')
                    throw new Error('Foreign bridge catalogue registration');
                const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
                    modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
                owner = ownChatRuntime(runtime, { assertModel() { throw new Error('Catalogue cannot dispatch'); },
                    beforeAuth(target) {
                        if ((typeof target === 'string' ? target : target.provider) !== 'claude-bridge')
                            throw new Error('Foreign catalogue auth');
                    } });
                runtime.registerProvider(registration.name, registration.config);
                await owner.join();
                assertOpen();
                const roster = structuredClone(runtime.getModels('claude-bridge'));
                if (!roster.length || roster.some(model => model.provider !== 'claude-bridge' || model.api !== 'claude-bridge'))
                    throw new Error('Original bridge models unavailable');
                const freeze = <T>(value: T): T => {
                    if (value && typeof value === 'object') {
                        for (const child of Object.values(value))
                            freeze(child);
                        Object.freeze(value);
                    }
                    return value;
                };
                return freeze(roster);
            }
            finally {
                loaded.runtime.invalidate();
                if (owner) {
                    await owner.close();
                    await owner.join();
                }
            }
        })();
        catalogue = task;
        preparations.add(task);
        void task.then(() => preparations.delete(task), () => preparations.delete(task));
        return task;
    };
    const result: OwnedClaudeHost = {
        modelSelection: undefined as unknown as PiModelSelection,
        models,
        async selectModel(modelId, thinkingLevel) {
            const roster = await models(), model = roster.find(model => model.id === modelId);
            if (!model)
                throw new Error('Model is absent from the original bridge catalogue');
            const { getSupportedThinkingLevels, clampThinkingLevel } = await import('@earendil-works/pi-ai');
            const level = thinkingLevel ?? clampThinkingLevel(model, 'off');
            if (!getSupportedThinkingLevels(model).includes(level))
                throw new Error('Thinking level is unsupported by the registered bridge model');
            assertOpen();
            return issue(modelId, level);
        },
        close() {
            return closing ??= (async () => {
                closed = true;
                while (preparations.size)
                    await Promise.allSettled([...preparations]);
                if (initializing)
                    await Promise.allSettled([initializing]);
                const tasks = [...slots].map(slot => slot.close());
                try {
                    if (host && (await host.close()).cleanup !== 'confirmed')
                        throw new Error('Bridge native cleanup unknown');
                }
                finally {
                    const results = await Promise.allSettled(tasks);
                    const processResult = await producer?.close();
                    if (processResult?.cleanup === 'unknown' || results.some(result => result.status === 'rejected'))
                        throw new Error('Bridge resource cleanup unknown');
                }
            })();
        },
    };
    const profile = Object.freeze({ kind: 'installed-claude-bridge' as const, cwd: input.cwd, agentDir: input.agentDir, executable });
    const issue = (modelId: string, thinkingLevel: ModelThinkingLevel, legacy = false): PiModelSelection => {
        const authority = Object.freeze({});
        const selection = { provider: 'claude-bridge', modelId, bridgeProfile: profile,
            ...(legacy ? {} : { bridgeThinkingLevel: thinkingLevel }) };
        Object.defineProperty(selection, 'bridge', { value: result, enumerable: false });
        Object.defineProperty(selection, selectionAuthority, { value: authority, enumerable: false });
        const captured = Object.freeze(selection) as PiModelSelection;
        issued.set(authority, captured);
        return captured;
    };
    (result as {
        modelSelection: PiModelSelection;
    }).modelSelection = issue('claude-opus-5-5', 'off', true);
    const prepare = (selection: PiModelSelection, projectRoot: string, environment: PiHostEnvironment): Promise<BridgeSession> => {
        assertOpen();
        assertPiHost(environment, projectRoot);
        if (nativeStateRoot && nativeStateRoot !== environment.stateRoot)
            throw new Error('Bridge native state root changed');
        nativeStateRoot = environment.stateRoot;
        if ([input.cwd, input.agentDir].some(root => inside(root, projectRoot) || inside(projectRoot, root)))
            throw new Error('Bridge host roots must be outside the actual project');
        // Reserve the one-way startup mode before the first preparation await.
        initializationMode ??= selection === result.modelSelection ? 'legacy' : 'catalogue';
        const task = (async (): Promise<BridgeSession> => {
            let slot: Awaited<ReturnType<typeof import('./claude-runtime.js')['createOwnedClaudeRuntime']>> | undefined;
            // All acquisition lives under this cleanup owner, including construction failures.
            try {
                await validateConfiguration();
                assertOpen();
                // Explicit legacy startup remains a separate route without picker
                // discovery. Application startup and issued choices use catalogue first.
                if (initializationMode === 'catalogue')
                    await models();
                else
                    await initialize();
                await initializeProducer();
                assertOpen();
                const { createOwnedClaudeRuntime } = await import('./claude-runtime.js');
                assertOpen();
                const acquired = await createOwnedClaudeRuntime(selection);
                slot = acquired;
                slots.add(acquired);
                assertOpen();
                let ownerId: string | undefined;
                const summaryScopes = new Set<{
                    close(): Promise<void>;
                }>();
                return { runtime: acquired.runtime, bindOwner: id => { acquired.bindOwner(id); ownerId = id; }, seal: () => {
                        acquired.seal();
                        if (ownerId)
                            sealedOwners.add(ownerId);
                    }, joinIdle: async () => {
                        await acquired.joinIdle();
                        if (!ownerId || nativeTails.get(ownerId)?.size || nativeFailures.has(ownerId) || summaryScopes.size)
                            throw new Error('Bridge idle owner has unsettled native or summary work');
                    }, openSummaryOperation: (signal, admit) => {
                        assertOpen();
                        acquired.assertAdmission();
                        if (!ownerId)
                            throw new Error('Bridge summary owner unavailable');
                        const original = host!.openSummaryOperation(ownerId, signal, admit);
                        let closing: Promise<void> | undefined;
                        const scope = { close: () => closing ??= original.close().then(() => { summaryScopes.delete(scope); }) };
                        summaryScopes.add(scope);
                        return scope;
                    }, extension: host!.extension, registered: async () => {
                        await acquired.join();
                        assertOpen();
                        const selected = acquired.runtime.getModel(selection.provider, selection.modelId);
                        if (!selected || acquired.runtime.getAvailableSnapshot().some(model => model.provider !== 'claude-bridge'))
                            throw new Error('Exact bridge registration unavailable or another provider configured');
                    }, closeSession: async (id) => {
                        const tails = acquired.close();
                        try {
                            const result = id ? await host!.closeSession(id) : { cleanup: 'confirmed' };
                            if (result.cleanup !== 'confirmed')
                                throw new Error('Bridge native cleanup unknown');
                            if (id) {
                                nativeTails.delete(id);
                                nativeFailures.delete(id);
                                sealedOwners.delete(id);
                            }
                        }
                        finally {
                            try {
                                await tails;
                            }
                            finally {
                                slots.delete(acquired);
                            }
                        }
                    } };
            }
            catch (error) {
                if (slot) {
                    try {
                        await slot.close();
                    }
                    finally {
                        slots.delete(slot);
                    }
                }
                if (!host)
                    await producer?.close();
                throw error;
            }
        })();
        preparations.add(task);
        void task.then(() => preparations.delete(task), () => preparations.delete(task));
        return task;
    };
    const authorityRoots = Object.freeze([
        input.cwd, input.agentDir, input.executable.file,
        ...(accountDirectory && isAbsolute(accountDirectory) ? [accountDirectory] : []),
        ...(input.nativeAccountHome ? [resolve(input.nativeAccountHome, '.claude.json')] : []),
    ]);
    owned.set(result, { prepare, assertOpen, authorityRoots });
    return Object.freeze(result);
}
export function assertOwnedClaudeHost(value: OwnedClaudeHost): void {
    if (!owned.has(value))
        throw new Error('Explicit owned bridge resource required');
}
/** Captured actual host authority, not its caller's desired future configuration. */
export function ownedClaudeAuthorityRoots(owner: OwnedClaudeHost): readonly string[] { assertOwnedClaudeHost(owner); return owned.get(owner)!.authorityRoots; }
export function prepareOwnedClaudeSession(selection: PiModelSelection, projectRoot: string, environment: PiHostEnvironment): Promise<BridgeSession> {
    selection = admitOwnedClaudeSelection(selection);
    return owned.get(selection.bridge!)!.prepare(selection, projectRoot, environment);
}
export function claimOwnedClaudeHost(value: OwnedClaudeHost, controller: object): void {
    assertOwnedClaudeHost(value);
    const previous = controllerOwners.get(value);
    if (previous && previous !== controller)
        throw new Error('Bridge resource already belongs to another controller');
    controllerOwners.set(value, controller);
}
/** Application ownership is stronger than a still-recognized historical host token. */
export function assertOwnedClaudeApplicationSelection(selection: PiModelSelection, controller: object): PiModelSelection {
    if (captureSessionPreferences(selection.sessionPreferences)) {
        const descriptors = Object.getOwnPropertyDescriptors(selection);
        delete descriptors.sessionPreferences;
        selection = Object.create(Object.getPrototypeOf(selection), descriptors) as PiModelSelection;
    }
    const admitted = admitOwnedClaudeSelection(selection), owner = admitted.bridge!;
    owned.get(owner)!.assertOpen();
    if (controllerOwners.get(owner) !== controller || admitted.bridgeThinkingLevel === undefined)
        throw new Error('Application bridge selection requires its live controller owner and explicit supported thinking');
    return admitted;
}
/** Bind both execution selector and persistable identity to the same admitted capability. */
export function admitOwnedClaudeSelection(selection: PiModelSelection): PiModelSelection {
    const preferences = captureSessionPreferences(selection.sessionPreferences);
    if (preferences) {
        const descriptors = Object.getOwnPropertyDescriptors(selection);
        delete descriptors.sessionPreferences;
        selection = Object.create(Object.getPrototypeOf(selection), descriptors) as PiModelSelection;
    }
    const owner = selection.bridge;
    if (!owner)
        throw new Error('Bridge selector does not match admitted owner');
    assertOwnedClaudeHost(owner);
    const authority = (selection as unknown as Record<symbol, object>)[selectionAuthority];
    const expected = authority && issued.get(authority);
    if (!expected || expected.bridge !== owner)
        throw new Error('Bridge selector was not issued by its admitted owner');
    if (selection.provider !== expected.provider || selection.modelId !== expected.modelId || selection.native || selection.runtime || selection.definition ||
        selection.bridgeThinkingLevel !== expected.bridgeThinkingLevel || selection.managed ||
        Object.keys(selection).some(key => !['provider', 'modelId', 'bridge', 'bridgeProfile', 'bridgeThinkingLevel'].includes(key)))
        throw new Error('Bridge selector does not match admitted owner');
    if (selection.bridgeProfile !== undefined) {
        const supplied = selection.bridgeProfile, actual = expected.bridgeProfile!;
        if (!supplied || Object.keys(supplied).some(key => !['kind', 'cwd', 'agentDir', 'executable'].includes(key)) || !supplied.executable ||
            Object.keys(supplied.executable).some(key => !['file', 'sha256'].includes(key)) || supplied.kind !== actual.kind || supplied.cwd !== actual.cwd ||
            supplied.agentDir !== actual.agentDir || supplied.executable.file !== actual.executable.file || supplied.executable.sha256 !== actual.executable.sha256)
            throw new Error('Bridge selector does not match admitted owner');
    }
    // Queue behavior is a finite envelope, not bridge authority. Preserve it
    // across every admission while retaining only the factory-issued selector.
    if (!preferences)
        return expected;
    const descriptors = Object.getOwnPropertyDescriptors(expected);
    descriptors.sessionPreferences = { value: preferences, enumerable: true, writable: false, configurable: false };
    return Object.freeze(Object.create(Object.getPrototypeOf(expected), descriptors)) as PiModelSelection;
}

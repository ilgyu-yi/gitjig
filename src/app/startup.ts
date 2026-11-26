import { prepareClaudeBridgeConnection, type ClaudeOperatorEnvironment } from './bridge-connection.js';
import { homedir } from 'node:os';
import { realpath, lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Controller } from '../controller/controller.js';
import type { RuntimeProfile } from '../controller/types.js';
import type { LocalRuntimeConfiguration } from '../controller/local-inspection.js';
import { inside } from '../controller/ownership.js';
import { validateRuntimeProfile, trustedDockerBinary } from '../execution/container-scope.js';
import { suggestRuntimePaths } from '../execution/runtime-paths.js';
import { parseNativeClaudeProfile, parseNativeClaudeProfileShape, validateNativeClaudeAccountHome, type NativeClaudeProfile } from '../pi/claude-profile.js';
import { assertNativeExecutableIdentity } from '../pi/native-process.js';
import { validateClaudeHostConfiguration } from '../pi/claude-host.js';
import { parseUniqueJson } from '../workflow/json.js';
import { discoverRuntimeCandidates, resolveRuntimeRoute, type RuntimeDiscoveryInput } from '../execution/runtime-discovery.js';
import type { UiLocale } from '../ui/i18n.js';
import type { UiChoice } from '../ui/choices.js';
import { quoteText } from '../ui/inspection-text.js';
import { directory, readConfigurationBytes, writeObject } from './storage.js';
export interface StartupConfiguration {
    version: 1;
    runtime?: RuntimeProfile;
    bridge?: {
        profile: NativeClaudeProfile;
        nativeAccountDirectory: string;
        nativeAccountHome?: string;
    };
}
export interface PreparedStartup {
    configuration: StartupConfiguration;
    sources: {
        runtime: 'invocation' | 'saved' | 'none';
        bridge: 'saved' | 'none';
    };
}
export type StartupActivationAction = 'unknown' | 'current' | 'apply' | 'relaunch';
export interface StartupActivation {
    runtime: StartupActivationAction;
    bridge: StartupActivationAction;
}
type StartupActivationStep = 'inspect' | 'apply-runtime' | 'remove-runtime' | 'relaunch-bridge';
export function startupActivationSteps({ runtime, bridge }: StartupActivation): StartupActivationStep[] {
    if (runtime === 'unknown' || bridge === 'unknown')
        return ['inspect'];
    const steps: StartupActivationStep[] = [];
    if (runtime === 'apply')
        steps.push('apply-runtime');
    else if (runtime === 'relaunch')
        steps.push('remove-runtime');
    if (bridge === 'relaunch')
        steps.push('relaunch-bridge');
    return steps;
}
const startupStepText: Record<StartupActivationStep, string> = {
    inspect: 'Check activation with /setup inspect in a normal gitjig session.',
    'apply-runtime': 'Apply the saved runtime now with /setup runtime.',
    'remove-runtime': 'Restart to remove the active runtime.',
    'relaunch-bridge': 'Restart to apply the bridge settings.',
};
/** Optional unset fields have the same persisted meaning as absent fields. */
function sameSelection(left: object | undefined, right: object | undefined): boolean {
    const present = (value: object | undefined) => value && Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
    return isDeepStrictEqual(present(left), present(right));
}
/** One observation of validated saved intent against the captured process selection. */
function activationFor(saved: StartupConfiguration | undefined, prepared: PreparedStartup | undefined): StartupActivation {
    if (!saved || !prepared)
        return { runtime: 'unknown', bridge: 'unknown' };
    return {
        runtime: prepared.sources.runtime === 'invocation' || sameSelection(saved.runtime, prepared.configuration.runtime)
            ? 'current' : saved.runtime ? 'apply' : 'relaunch',
        bridge: sameSelection(saved.bridge, prepared.configuration.bridge) ? 'current' : 'relaunch',
    };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const runtimeFields = ['dockerBinary', 'dockerContext', 'dockerConfigDirectory', 'image', 'uid', 'gid', 'memoryMiB', 'cpus', 'pidsLimit', 'scratchMiB', 'maxOutputBytes', 'defaultTimeoutMs'];
type AuthorityPathLabel = 'runtime.dockerBinary' | 'runtime.dockerConfigDirectory' | 'bridge.profile.cwd' | 'bridge.profile.agentDir' |
    'bridge.profile.executable.file' | 'bridge.nativeAccountDirectory' | 'bridge.nativeAccountHome (.claude.json)' |
    'runtime setup path' | 'bridge connection path';
class StartupAuthorityOverlap extends Error {
    readonly code = 'STARTUP_AUTHORITY_OVERLAP';
    constructor(field: AuthorityPathLabel, path: string, scope: 'registered project' | 'application execution storage', root: string) {
        super(`Startup authority overlap: ${field} ${quoteText(path)} overlaps ${scope} ${quoteText(root)}`);
    }
}
function assertStartupAuthorityDisjoint(field: AuthorityPathLabel, file: string, projectRoots: readonly string[], home: string) {
    const overlaps = (root: string) => inside(root, file) || inside(file, root);
    const project = projectRoots.find(overlaps);
    if (project)
        throw new StartupAuthorityOverlap(field, file, 'registered project', project);
    const storage = ['state', 'artifacts', 'inputs', 'control'].map(name => join(home, name)).find(overlaps);
    if (storage)
        throw new StartupAuthorityOverlap(field, file, 'application execution storage', storage);
}
async function privateDirectory(file: string) {
    if (!isAbsolute(file) || await realpath(file) !== file)
        throw Error('Startup directories must be canonical absolute paths');
    const info = await lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o077)
        throw Error('Startup directories must be owner-private');
}
/** Supported stored fields, not evidence that their external prerequisites are available. */
function startupFields(value: unknown): StartupConfiguration {
    value = structuredClone(value);
    if (!object(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'runtime', 'bridge'].includes(key)))
        throw Error('Startup setup requires version1 and only optional runtime/bridge');
    const result: StartupConfiguration = { version: 1 };
    if (value.runtime !== undefined) {
        const runtime = value.runtime;
        if (!object(runtime) || Object.keys(runtime).some(key => !runtimeFields.includes(key)) || typeof runtime.dockerBinary !== 'string' || typeof runtime.dockerContext !== 'string' || typeof runtime.image !== 'string' ||
            runtime.dockerConfigDirectory !== undefined && typeof runtime.dockerConfigDirectory !== 'string' ||
            runtimeFields.slice(4).some(key => runtime[key] !== undefined && typeof runtime[key] !== 'number'))
            throw Error('Invalid finite execution startup setup');
        result.runtime = Object.freeze({ ...runtime }) as unknown as RuntimeProfile;
    }
    if (value.bridge !== undefined) {
        const bridge = value.bridge;
        if (!object(bridge) || Object.keys(bridge).some(key => !['profile', 'nativeAccountDirectory', 'nativeAccountHome'].includes(key)) || typeof bridge.nativeAccountDirectory !== 'string' ||
            bridge.nativeAccountHome !== undefined && typeof bridge.nativeAccountHome !== 'string')
            throw Error('Bridge startup requires profile and explicit nativeAccountDirectory');
        result.bridge = Object.freeze({ profile: parseNativeClaudeProfileShape(bridge.profile), nativeAccountDirectory: bridge.nativeAccountDirectory,
            ...(bridge.nativeAccountHome !== undefined ? { nativeAccountHome: bridge.nativeAccountHome } : {}) });
    }
    return Object.freeze(result);
}
/** Finite local validation only; never authenticates, imports native SDK or executes a client. */
export async function validateStartupConfiguration(value: unknown, projectRoots: readonly string[], home: string): Promise<StartupConfiguration> {
    const fields = startupFields(value), result: StartupConfiguration = { version: 1 };
    const disjoint = (field: AuthorityPathLabel, file: string) => assertStartupAuthorityDisjoint(field, file, projectRoots, home);
    if (fields.runtime) {
        const runtime = await validateRuntimeProfile(fields.runtime);
        disjoint('runtime.dockerBinary', runtime.dockerBinary);
        if (runtime.dockerConfigDirectory)
            disjoint('runtime.dockerConfigDirectory', runtime.dockerConfigDirectory);
        result.runtime = runtime;
    }
    if (fields.bridge) {
        // Application startup checks both directions for every authority path.
        const profile = await parseNativeClaudeProfile(fields.bridge.profile, []), account = fields.bridge.nativeAccountDirectory;
        disjoint('bridge.profile.cwd', profile.cwd);
        disjoint('bridge.profile.agentDir', profile.agentDir);
        disjoint('bridge.profile.executable.file', profile.executable.file);
        await privateDirectory(join(profile.agentDir, 'home'));
        const accountHome = await validateNativeClaudeAccountHome(fields.bridge.nativeAccountHome, account);
        disjoint('bridge.nativeAccountDirectory', account);
        if (accountHome)
            disjoint('bridge.nativeAccountHome (.claude.json)', join(accountHome, '.claude.json'));
        assertNativeExecutableIdentity(profile.executable);
        await validateClaudeHostConfiguration(profile);
        if (result.runtime && !result.runtime.dockerConfigDirectory)
            throw Error('Bridge plus execution startup requires explicit dockerConfigDirectory');
        result.bridge = Object.freeze({ profile, nativeAccountDirectory: account, ...(accountHome ? { nativeAccountHome: accountHome } : {}) });
    }
    return Object.freeze(result);
}
function readStartupBytes(home: string): Buffer | undefined {
    const folder = join(home, 'config');
    try {
        directory(folder, true);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
    return readConfigurationBytes(join(folder, 'startup.json'), true);
}
function snapshot(home: string): { bytes: Buffer | undefined; value?: Record<string, unknown>; invalid?: boolean } {
    const bytes = readStartupBytes(home);
    if (bytes === undefined)
        return { bytes };
    try {
        const value = parseUniqueJson(bytes.toString('utf8'));
        if (object(value))
            return { bytes, value };
    }
    catch { /* Invalid saved content remains available for exact repair. */ }
    return { bytes, invalid: true };
}
function sameStartupFile(current: Buffer | undefined, before: Buffer | undefined): boolean {
    return current === before || (current !== undefined && before !== undefined && current.equals(before));
}
function sameProjectRoots(controller: Controller, roots: readonly string[]): boolean {
    const projects = controller.listProjects();
    return projects.length === roots.length && projects.every((project, index) => project.sourceRoot === roots[index]);
}
/** Called only under the original home owner before Controller construction/recovery. */
export async function prepareApplicationStartup(home: string, projectRoots: readonly string[], options: {
    runtime?: RuntimeProfile;
    bridge?: boolean;
    ignoreRuntime?: boolean;
} = {}): Promise<PreparedStartup> {
    const saved = snapshot(home);
    if (saved.invalid)
        throw Error('Saved startup setup requires repair; use setup inspect/save/clear');
    const value = saved.value ?? { version: 1 };
    if (!object(value))
        throw Error('Saved startup setup requires repair; use setup inspect/save/clear');
    const selected: Record<string, unknown> = { ...value, ...(options.runtime ? { runtime: options.runtime } : {}) };
    if (options.bridge === false)
        delete selected.bridge;
    if (options.ignoreRuntime)
        delete selected.runtime;
    const configuration = await validateStartupConfiguration(selected, projectRoots, home);
    return Object.freeze({ configuration, sources: Object.freeze({ runtime: configuration.runtime ? options.runtime ? 'invocation' : 'saved' : 'none', bridge: configuration.bridge ? 'saved' : 'none' }) });
}
/** Optional execution metadata for local rule inspection; never prepares a bridge or applies a runtime. */
export async function inspectRuntimeConfiguration(home: string, projectRoots: readonly string[], invocation?: RuntimeProfile): Promise<LocalRuntimeConfiguration> {
    if (invocation) {
        // An explicit invalid operand is an invocation failure, not missing optional settings.
        const selected = await validateStartupConfiguration({ version: 1, runtime: invocation }, projectRoots, home);
        return { state: 'configured', source: 'invocation', profile: selected.runtime!, reason: null, recovery: null };
    }
    try {
        const selected = await prepareApplicationStartup(home, projectRoots, { bridge: false });
        return selected.configuration.runtime
            ? { state: 'configured', source: 'saved', profile: selected.configuration.runtime, reason: null, recovery: null }
            : { state: 'unconfigured', source: 'none', profile: null, reason: null, recovery: null };
    }
    catch {
        return { state: 'unavailable', source: 'saved', profile: null,
            reason: 'Saved runtime configuration could not be read or validated.',
            recovery: 'Inspect saved settings with setup inspect and repair them with setup edit/save, or provide a complete explicit runtime profile.' };
    }
}
const instances = new WeakMap<Controller, ApplicationStartup>();
/** Startup storage and explicit runtime application; model/account sources keep their own lifecycle. */
export class ApplicationStartup {
    private tail: Promise<unknown> = Promise.resolve();
    private closing = false;
    private discoveries = new Set<AbortController>();
    private discoveryCleanupFailure: unknown;
    /** Original operator environment is private to owner-operated preparation children. */
    private readonly runtimeEnvironment: Readonly<NodeJS.ProcessEnv>;
    private constructor(private controller: Controller, private prepared: PreparedStartup | undefined, environment: Readonly<NodeJS.ProcessEnv>) {
        this.runtimeEnvironment = Object.freeze({ ...environment, HOME: environment.HOME ?? homedir() });
        controller.adoptApplicationResource(this);
    }
    static open(controller: Controller, prepared?: PreparedStartup, environment: Readonly<NodeJS.ProcessEnv> = process.env): ApplicationStartup {
        let value = instances.get(controller);
        if (!value) {
            value = new ApplicationStartup(controller, prepared, environment);
            instances.set(controller, value);
        }
        return value;
    }
    async close(): Promise<void> { this.closing = true; for (const discovery of this.discoveries)
        discovery.abort(); await this.tail.catch(() => { }); if (this.discoveryCleanupFailure)
        throw this.discoveryCleanupFailure; }
    private serial<T>(action: () => Promise<T>): Promise<T> {
        if (this.closing)
            return Promise.reject(Error('Startup setup is closing'));
        const task = this.tail.catch(() => { }).then(action);
        this.tail = task;
        return task;
    }
    async inspect() {
        return (await this.captureInspection()).view;
    }
    async captureInspection() {
        const home = this.controller.applicationHome(), saved = snapshot(home), roots = this.controller.listProjects().map(project => project.sourceRoot);
        const preparedAtCapture = this.prepared;
        const prepared = structuredClone(preparedAtCapture);
        const activeRuntime = this.controller.options.runtimeProfile;
        let configuration: StartupConfiguration | undefined, diagnostic: string | undefined;
        try {
            if (saved.invalid)
                throw Error('invalid');
            if (saved.value !== undefined)
                configuration = await validateStartupConfiguration(saved.value, roots, home);
        }
        catch (error) {
            diagnostic = error instanceof StartupAuthorityOverlap ? error.message : 'Saved startup setup requires repair; use setup save or clear';
        }
        this.controller.applicationHome();
        const activation = activationFor(diagnostic ? undefined : configuration ?? { version: 1 }, prepared);
        const view = {
            path: join(home, 'config/startup.json'), saved: configuration ?? null, diagnostic: diagnostic ?? null,
            effective: prepared?.configuration ?? null, sources: prepared?.sources ?? { runtime: 'none' as const, bridge: 'none' as const },
            activation, restartRequired: Object.values(activation).includes('relaunch'),
            activeExecutionChanged: false
        };
        const isCurrent = () => {
            if (this.closing || this.prepared !== preparedAtCapture || this.controller.options.runtimeProfile !== activeRuntime)
                return false;
            try {
                return this.controller.applicationHome() === home &&
                    sameProjectRoots(this.controller, roots) &&
                    sameStartupFile(readStartupBytes(home), saved.bytes);
            }
            catch {
                return false;
            }
        };
        return { view, activeRuntime, isCurrent };
    }
    /** Runtime field Save supersedes invocation selectors; other explicit launch choices survive relaunch. */
    continuationArguments(arguments_: readonly string[]): readonly string[] {
        const runtime = new Set(['--docker-binary', '--docker-context', '--docker-config-directory', '--image']);
        const result: string[] = [];
        for (let index = 0; index < arguments_.length; index += 2) {
            const key = arguments_[index], value = arguments_[index + 1];
            if (key === undefined || value === undefined)
                throw Error('Restart continuation requires complete option pairs');
            if (this.prepared?.sources.runtime !== 'invocation' && runtime.has(key))
                continue;
            result.push(key, value);
        }
        return result;
    }
    private captureEdit() {
        const home = this.controller.applicationHome(), before = snapshot(home), roots = this.controller.listProjects().map(project => project.sourceRoot);
        const assertCurrent = () => {
            const current = readStartupBytes(home);
            if (this.closing || this.controller.applicationHome() !== home || !sameProjectRoots(this.controller, roots) || !sameStartupFile(current, before.bytes))
                throw Error('Saved startup changed while editing; reopen /setup before saving');
        };
        assertCurrent();
        return { value: before.value, invalid: before.invalid, assertCurrent,
            save: (value: unknown, guard?: () => unknown, reviewed?: StartupConfiguration) => this.saveChecked(value, before, () => { assertCurrent(); return guard?.(); }, false, reviewed),
            saveRuntime: (value: unknown, guard?: () => unknown, reviewed?: StartupConfiguration) => this.saveChecked(value, before, () => { assertCurrent(); return guard?.(); }, true, reviewed),
            validate: async (value: unknown, guard?: () => unknown) => { assertCurrent(); if (guard && guard() !== undefined)
                throw Error('Synchronous startup validation required'); const valid = await validateStartupConfiguration(value, roots, home); assertCurrent(); if (guard && guard() !== undefined)
                throw Error('Synchronous startup validation required'); return valid; } };
    }
    /** Explicit whole-object replacement/repair; invalid JSON is not unsafe file ownership. */
    prepareEdit() {
        return this.serial(async () => { const edit = this.captureEdit(); return { assertCurrent: edit.assertCurrent, save: edit.save }; });
    }
    private prepareFields(kind: 'runtime' | 'bridge' | 'startup') {
        return this.serial(async () => {
            const edit = this.captureEdit();
            if (edit.invalid)
                throw Error('Saved startup setup requires explicit repair with /setup save JSON or /setup clear before editing ' + kind + ' fields');
            let configuration: StartupConfiguration;
            try {
                configuration = startupFields(edit.value ?? { version: 1 });
                edit.assertCurrent();
            }
            catch (error) {
                edit.assertCurrent();
                throw Error('Saved startup setup requires explicit repair with /setup save JSON or /setup clear before editing ' + kind + ' fields');
            }
            return { ...edit, configuration };
        });
    }
    /** One captured complete draft review; staging remains in the caller, Save stays fully validated. */
    async prepareCombinedEdit() {
        const edit = await this.prepareFields('startup');
        return { configuration: edit.configuration, assertCurrent: edit.assertCurrent, validate: edit.validate, save: edit.save };
    }
    /** Field edits preserve unedited startup selections and exact original setup bytes. */
    async prepareRuntimeEdit(options: { applyRuntime?: boolean } = {}) {
        const appliesRuntime = options.applyRuntime !== false;
        const edit = await this.prepareFields('runtime');
        const checkPath = (file: string) => {
            edit.assertCurrent();
            assertStartupAuthorityDisjoint('runtime setup path', file,
                this.controller.listProjects().map(project => project.sourceRoot), this.controller.applicationHome());
        };
        const guarded = (guard: () => void) => () => {
            edit.assertCurrent();
            if (guard() !== undefined)
                throw Error('Synchronous runtime setup guard required');
        };
        const suggestPaths = (guard: () => void) => this.serial(async () => suggestRuntimePaths({ guard: guarded(guard), checkPath }, undefined, join(this.runtimeEnvironment.HOME!, '.docker')));
        const discoveryRouteInputs = (kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, guard: () => void) => {
            const captured = structuredClone(input);
            return this.serial(() => resolveRuntimeRoute(kind, captured, { guard: guarded(guard), checkPath }));
        };
        const runtimeRouteInputs = async (input: RuntimeDiscoveryInput, guard: () => void) => {
            const route = await discoveryRouteInputs('images', input, guard);
            return { ...route, dockerContext: route.dockerContext! };
        };
        const checkRuntimeInputs = async (input: RuntimeDiscoveryInput & { image: string }, guard: () => void) => {
            const captured = { ...input };
            const helper = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
            guarded(guard)();
            const image = helper.runtimeCheckImage(captured.image);
            const route = await runtimeRouteInputs(captured, guard);
            return { ...route, image };
        };
        const prepareNative = async (input: RuntimeDiscoveryInput & {
            image?: string;
        }, guard: () => void, signal: AbortSignal, output: (text: string) => void, inspectOnly = false, extraPackages = '',
        onCheckedRoute?: (verify: () => Promise<void>) => void) => {
            const reviewed = structuredClone(input);
            const captured = await runtimeRouteInputs(reviewed, guard);
            return this.serial(async () => {
                if (this.discoveryCleanupFailure)
                    throw this.discoveryCleanupFailure;
                const abort = new AbortController();
                this.discoveries.add(abort);
                try {
                    const file = fileURLToPath(new URL('../../runtime/setup.mjs', import.meta.url));
                    const helper = await import(pathToFileURL(file).href);
                    const check = guarded(() => {
                        const current = guard();
                        helper.assertReviewedDockerRoute(reviewed, captured.dockerBinary, captured.dockerConfigDirectory);
                        return current;
                    });
                    check();
                    const result: RuntimeProfile = await helper[inspectOnly ? 'checkRuntime' : 'buildImage']({ ...captured, ...(inspectOnly ? { image: reviewed.image } : {}) }, {
                        home: this.controller.applicationHome(), cwd: this.controller.applicationHome(), extraPackages,
                        env: helper.preparationEnvironment(this.runtimeEnvironment),
                        signal: AbortSignal.any([signal, abort.signal]), guard: check, onOutput: output, checkPath, reviewedDockerRoute: reviewed,
                        onCheckedRoute: onCheckedRoute && ((verify: (guards: { guard: () => void; checkPath: (file: string) => void }) => Promise<void>) => {
                            onCheckedRoute(() => verify({ guard: check, checkPath }));
                        }),
                    });
                    check();
                    return result;
                }
                catch (error) {
                    if ((error as {
                        code?: string;
                    })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                        this.discoveryCleanupFailure = error;
                    throw error;
                }
                finally {
                    this.discoveries.delete(abort);
                }
            });
        };
        const buildImage = (input: RuntimeDiscoveryInput, guard: () => void, signal: AbortSignal, output: (text: string) => void, extraPackages = '') => prepareNative(input, guard, signal, output, false, extraPackages);
        const checkRuntime = (input: RuntimeDiscoveryInput & {
            image: string;
        }, guard: () => void, signal: AbortSignal, output: (text: string) => void, onCheckedRoute?: (verify: () => Promise<void>) => void) =>
            prepareNative(input, guard, signal, output, true, '', onCheckedRoute);
        const prepareInteractive = (initialRuntime: Partial<RuntimeProfile>, guard: () => void, host: {
            extraPackages?: string;
            locale?: UiLocale;
            choose?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
            ask(question: string, value: string): Promise<string>;
            output(text: string): void;
            checkStarted?(): void;
            checked?(verify: () => Promise<void>): void;
            execute(file: string, args: string[], options: Record<string, unknown>): Promise<unknown>;
        }) => {
            const captured = structuredClone(initialRuntime), { extraPackages, locale, checkStarted, checked } = host;
            return this.serial(async () => {
                if (this.discoveryCleanupFailure)
                    throw this.discoveryCleanupFailure;
                const abort = new AbortController();
                this.discoveries.add(abort);
                const check = guarded(guard);
                try {
                    const helper = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
                    const execute = async (file: string, args: string[], options: Record<string, unknown>) => {
                        check();
                        checkPath(await trustedDockerBinary(file));
                        return host.execute(file, args, options);
                    };
                    check();
                    const result: RuntimeProfile | undefined = await helper.interactiveSetup({
                        initialRuntime: captured, extraPackages, locale, stageOnly: true, home: this.controller.applicationHome(), signal: abort.signal,
                        ownerHome: this.runtimeEnvironment.HOME, env: this.runtimeEnvironment,
                        guard: check, checkPath, choose: host.choose, ask: host.ask, output: host.output, execute,
                        checkStarted,
                        onCheckedRoute: checked && ((verify: (guards: { checkPath: (file: string) => void }) => Promise<void>) => {
                            checked(() => verify({ checkPath }));
                        }),
                    });
                    check();
                    return result;
                }
                catch (error) {
                    if ((error as {
                        code?: string;
                    })?.code === 'RUNTIME_PREPARATION_CLEANUP_UNKNOWN')
                        this.discoveryCleanupFailure = error;
                    throw error;
                }
                finally {
                    this.discoveries.delete(abort);
                }
            });
        };
        const discover = (kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, guard: () => void,
            { reviewed, signal }: { reviewed?: true; signal?: AbortSignal } = {}) => {
            const captured = structuredClone(input);
            return this.serial(async () => {
                if (this.discoveryCleanupFailure)
                    throw this.discoveryCleanupFailure;
                const abort = new AbortController();
                this.discoveries.add(abort);
                const check = () => {
                    edit.assertCurrent();
                    if (guard() !== undefined)
                        throw Error('Synchronous runtime discovery guard required');
                };
                try {
                    return await discoverRuntimeCandidates(kind, captured, {
                        home: this.controller.applicationHome(), signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
                        guard: check, checkPath, ...(reviewed ? { reviewed } : {}),
                    });
                }
                catch (error) {
                    if ((error as {
                        code?: string;
                    })?.code === 'RUNTIME_DISCOVERY_CLEANUP_UNKNOWN')
                        this.discoveryCleanupFailure = error;
                    throw error;
                }
                finally {
                    this.discoveries.delete(abort);
                }
            });
        };
        return {
            defaultDockerConfigDirectory: join(this.runtimeEnvironment.HOME!, '.docker'),
            runtime: edit.configuration.runtime, appliesRuntime, assertCurrent: edit.assertCurrent, checkPath, discoveryRouteInputs, discover, suggestPaths, runtimeRouteInputs, checkRuntimeInputs, buildImage, checkRuntime, prepareInteractive,
            validate: (runtime: RuntimeProfile, guard?: () => unknown) => edit.validate({ ...edit.configuration, runtime }, guard),
            save: (runtime: RuntimeProfile, guard?: () => unknown, reviewed?: StartupConfiguration) => (appliesRuntime ? edit.saveRuntime : edit.save)({ ...edit.configuration, runtime }, guard, reviewed),
        };
    }
    /** Guided replacement owns native observations through the same startup close barrier. */
    async prepareBridgeConnection(operator: Readonly<ClaudeOperatorEnvironment>) {
        const prepared = await this.serial(async () => {
            const edit = this.captureEdit();
            if (edit.invalid || edit.value !== undefined && !object(edit.value))
                throw Error('Saved setup requires explicit JSON repair with /setup save or /setup clear');
            const raw = edit.value ?? { version: 1 };
            const { bridge: savedBridge, ...remaining } = raw as Record<string, unknown>;
            const configuration = await edit.validate(remaining);
            edit.assertCurrent();
            return { edit, configuration, savedBridge };
        });
        const { edit, configuration } = prepared;
        const home = this.controller.applicationHome();
        const assertCurrent = (guard?: () => void) => {
            edit.assertCurrent();
            if (guard && guard() !== undefined)
                throw Error('Synchronous bridge setup guard required');
        };
        const activeRuntime = this.prepared?.configuration.runtime;
        const runtimeConfigurationRequired = configuration.runtime && !configuration.runtime.dockerConfigDirectory ? 'saved' :
            activeRuntime && !activeRuntime.dockerConfigDirectory ? 'current' : undefined;
        return prepareClaudeBridgeConnection({
            home, operator: Object.freeze({ ...operator }),
            savedBridge: prepared.savedBridge as StartupConfiguration['bridge'],
            runtimeConfigurationRequired,
            assertCurrent: () => assertCurrent(),
            checkPath: file => {
                assertCurrent();
                assertStartupAuthorityDisjoint('bridge connection path', file,
                    this.controller.listProjects().map(project => project.sourceRoot), home);
            },
            run: (action, guard) => this.serial(async () => {
                assertCurrent(guard);
                if (this.discoveryCleanupFailure)
                    throw this.discoveryCleanupFailure;
                const abort = new AbortController();
                this.discoveries.add(abort);
                try {
                    const result = await action(abort.signal);
                    assertCurrent(guard);
                    return result;
                } catch (error) {
                    if ((error as { code?: string })?.code === 'CLAUDE_SETUP_CLEANUP_UNKNOWN')
                        this.discoveryCleanupFailure = error;
                    throw error;
                } finally {
                    this.discoveries.delete(abort);
                }
            }),
            save: (bridge, guard) => edit.save({ ...configuration, bridge }, () => assertCurrent(guard)),
        });
    }
    async prepareBridgeEdit() {
        const edit = await this.prepareFields('bridge'), value = (bridge: StartupConfiguration['bridge']) => { const result = { ...edit.configuration }; if (bridge)
            result.bridge = bridge;
        else
            delete result.bridge; return result; };
        return { bridge: edit.configuration.bridge, runtime: edit.configuration.runtime, assertCurrent: edit.assertCurrent, validate: (bridge: StartupConfiguration['bridge'], guard?: () => unknown) => edit.validate(value(bridge), guard), save: (bridge: StartupConfiguration['bridge'], guard?: () => unknown) => edit.save(value(bridge), guard) };
    }
    save(value: unknown) { return this.saveChecked(value); }
    private saveChecked(value: unknown, expected?: ReturnType<typeof snapshot>, validate?: () => unknown, applyRuntime = false, reviewed?: StartupConfiguration) {
        const captured = structuredClone(value);
        const reviewedValues = reviewed && structuredClone(reviewed);
        return this.serial(async () => {
            if (validate && validate() !== undefined)
                throw Error('Synchronous startup validation required');
            const home = this.controller.applicationHome(), before = readStartupBytes(home), roots = this.controller.listProjects().map(project => project.sourceRoot);
            if (expected && !sameStartupFile(before, expected.bytes))
                throw Error('Saved startup changed while editing; reopen /setup before saving');
            const configuration = await validateStartupConfiguration(captured, roots, home);
            if (reviewedValues && !isDeepStrictEqual(configuration, reviewedValues))
                throw Error('Startup settings resolved differently after review. Review the current settings before saving.');
            const assertOwner = () => {
                if (this.closing)
                    throw Error('Startup setup is closing');
                if (validate && validate() !== undefined)
                    throw Error('Synchronous startup validation required');
                const current = readStartupBytes(home);
                if (this.controller.applicationHome() !== home || !sameProjectRoots(this.controller, roots) || !sameStartupFile(current, before))
                    throw Error('Startup setup changed during validation; inspect and retry');
            };
            const commit = () => {
                assertOwner();
                directory(join(home, 'config'), true, true);
                writeObject(join(home, 'config/startup.json'), configuration as unknown as Record<string, unknown>, assertOwner);
            };
            if (applyRuntime) {
                const runtime = configuration.runtime;
                if (!runtime)
                    throw Error('Runtime application requires a complete execution profile');
                await this.controller.applyRuntimeProfile(runtime, validated => {
                    if (validated.dockerBinary !== runtime.dockerBinary)
                        throw Error('Docker executable path changed before application. Review the current runtime before saving.');
                    commit();
                });
                this.prepared = Object.freeze({
                    configuration: Object.freeze({ ...(this.prepared?.configuration ?? { version: 1 as const }), runtime }),
                    sources: Object.freeze({ runtime: 'saved' as const, bridge: this.prepared?.sources.bridge ?? 'none' }),
                });
            } else commit();
            const activation = activationFor(configuration, this.prepared);
            const guidance = startupActivationSteps(activation).map(step => startupStepText[step]);
            if (applyRuntime)
                guidance.unshift('Runtime saved and applied for subsequent operations. Existing operations retain their captured runtime.');
            return { savedScope: 'application', activeExecutionChanged: false, runtimeApplied: applyRuntime, activation,
                nextAction: guidance.join(' ') || 'Current startup selections are unchanged.' };
        });
    }
    clear() { return this.save({ version: 1 }); }
}

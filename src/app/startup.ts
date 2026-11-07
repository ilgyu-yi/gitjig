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
import { validateRuntimeProfile, trustedDockerBinary, trustedDockerConfiguration } from '../execution/container-scope.js';
import { suggestRuntimePaths } from '../execution/runtime-paths.js';
import { parseNativeClaudeProfile, parseNativeClaudeProfileShape, validateNativeClaudeAccountHome, type NativeClaudeProfile } from '../pi/claude-profile.js';
import { assertNativeExecutableIdentity } from '../pi/native-process.js';
import { validateClaudeHostConfiguration } from '../pi/claude-host.js';
import { parseUniqueJson } from '../workflow/json.js';
import { discoverRuntimeCandidates, type RuntimeDiscoveryInput } from '../execution/runtime-discovery.js';
import { directory, readObject, writeObject, InvalidConfigurationJsonError } from './storage.js';
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
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const runtimeFields = ['dockerBinary', 'dockerContext', 'dockerConfigDirectory', 'image', 'uid', 'gid', 'memoryMiB', 'cpus', 'pidsLimit', 'scratchMiB', 'maxOutputBytes', 'defaultTimeoutMs'];
function disjoint(file: string, roots: readonly string[]) {
    if (roots.some(root => inside(root, file) || inside(file, root)))
        throw Error('Startup authority paths must be disjoint from registered projects');
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
    if (fields.runtime) {
        const runtime = await validateRuntimeProfile(fields.runtime);
        for (const file of [runtime.dockerBinary, ...(runtime.dockerConfigDirectory ? [runtime.dockerConfigDirectory] : [])]) {
            disjoint(file, projectRoots);
            disjoint(file, ['state', 'artifacts', 'inputs', 'control'].map(name => join(home, name)));
        }
        result.runtime = runtime;
    }
    if (fields.bridge) {
        const profile = await parseNativeClaudeProfile(fields.bridge.profile, projectRoots), account = fields.bridge.nativeAccountDirectory;
        await privateDirectory(join(profile.agentDir, 'home'));
        const accountHome = await validateNativeClaudeAccountHome(fields.bridge.nativeAccountHome, account);
        const authorityPaths = [profile.cwd, profile.agentDir, profile.executable.file, account, ...(accountHome ? [join(accountHome, '.claude.json')] : [])];
        for (const file of authorityPaths)
            disjoint(file, projectRoots);
        for (const file of authorityPaths)
            disjoint(file, ['state', 'artifacts', 'inputs', 'control'].map(name => join(home, name)));
        assertNativeExecutableIdentity(profile.executable);
        await validateClaudeHostConfiguration(profile);
        if (result.runtime && !result.runtime.dockerConfigDirectory)
            throw Error('Bridge plus execution startup requires explicit dockerConfigDirectory');
        result.bridge = Object.freeze({ profile, nativeAccountDirectory: account, ...(accountHome ? { nativeAccountHome: accountHome } : {}) });
    }
    return Object.freeze(result);
}
function snapshot(home: string): {
    bytes: Buffer;
    present: boolean;
    value?: unknown;
    invalid?: boolean;
} {
    const folder = join(home, 'config');
    try {
        directory(folder, true);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return { bytes: Buffer.alloc(0), present: false };
        throw error;
    }
    let bytes = Buffer.alloc(0);
    try {
        readObject(join(folder, 'startup.json'), true, raw => { bytes = Buffer.from(raw); });
    }
    catch (error) {
        if (error instanceof InvalidConfigurationJsonError)
            return { bytes, present: true, invalid: true };
        throw error;
    }
    if (!bytes.length)
        return { bytes, present: false };
    try {
        return { bytes, present: true, value: parseUniqueJson(bytes.toString('utf8')) };
    }
    catch {
        return { bytes, present: true, invalid: true };
    }
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
        const home = this.controller.applicationHome(), saved = snapshot(home);
        let configuration: StartupConfiguration | undefined, diagnostic: string | undefined;
        try {
            if (saved.invalid)
                throw Error('invalid');
            if (saved.value !== undefined)
                configuration = await validateStartupConfiguration(saved.value, this.controller.listProjects().map(project => project.sourceRoot), home);
        }
        catch {
            diagnostic = 'Saved startup setup requires repair; use setup save or clear';
        }
        this.controller.applicationHome();
        // An explicit runtime remains authoritative in this process and on a
        // relaunch with that same invocation. It is not an unapplied saved edit.
        const next = this.prepared?.sources.runtime === 'invocation' ? { ...(configuration ?? { version: 1 }), runtime: this.prepared.configuration.runtime } : configuration ?? { version: 1 };
        return {
            path: join(home, 'config/startup.json'), saved: configuration ?? null, diagnostic: diagnostic ?? null,
            effective: this.prepared?.configuration ?? null, sources: this.prepared?.sources ?? { runtime: 'none', bridge: 'none' },
            restartRequired: !!this.prepared && (diagnostic !== undefined || !isDeepStrictEqual(next, this.prepared.configuration)),
            activeExecutionChanged: false
        };
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
            const current = snapshot(home);
            if (this.closing || this.controller.applicationHome() !== home || JSON.stringify(this.controller.listProjects().map(project => project.sourceRoot)) !== JSON.stringify(roots) || current.present !== before.present || current.invalid !== before.invalid || !current.bytes.equals(before.bytes))
                throw Error('Saved startup changed while editing; reopen /setup before saving');
        };
        assertCurrent();
        return { value: before.value, invalid: before.invalid, assertCurrent,
            save: (value: unknown, guard?: () => unknown) => this.saveChecked(value, before, () => { assertCurrent(); return guard?.(); }),
            saveRuntime: (value: unknown, guard?: () => unknown) => this.saveChecked(value, before, () => { assertCurrent(); return guard?.(); }, true),
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
            disjoint(file, this.controller.listProjects().map(project => project.sourceRoot));
            disjoint(file, ['state', 'artifacts', 'inputs', 'control'].map(name => join(this.controller.applicationHome(), name)));
        };
        const guarded = (guard: () => void) => () => {
            edit.assertCurrent();
            if (guard() !== undefined)
                throw Error('Synchronous runtime setup guard required');
        };
        const suggestPaths = (guard: () => void) => this.serial(async () => suggestRuntimePaths({ guard: guarded(guard), checkPath }, undefined, join(this.runtimeEnvironment.HOME!, '.docker')));
        const imageBuildInputs = (input: RuntimeDiscoveryInput, guard: () => void) => {
            const captured = structuredClone(input);
            return this.serial(async () => {
                const check = guarded(guard);
                check();
                const dockerBinary = await trustedDockerBinary(captured.dockerBinary);
                check();
                checkPath(dockerBinary);
                const dockerConfigDirectory = await trustedDockerConfiguration(captured.dockerConfigDirectory);
                check();
                checkPath(dockerConfigDirectory);
                if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(captured.dockerContext ?? ''))
                    throw Error('Choose an explicit Docker context before preparing image build commands');
                return { dockerBinary, dockerConfigDirectory, dockerContext: captured.dockerContext! };
            });
        };
        const prepareNative = async (input: RuntimeDiscoveryInput & {
            image?: string;
        }, guard: () => void, signal: AbortSignal, output: (text: string) => void, inspectOnly = false, extraPackages = '') => {
            const captured = await imageBuildInputs(input, guard);
            return this.serial(async () => {
                if (this.discoveryCleanupFailure)
                    throw this.discoveryCleanupFailure;
                const abort = new AbortController();
                this.discoveries.add(abort);
                const check = guarded(guard);
                try {
                    const file = fileURLToPath(new URL('../../runtime/setup.mjs', import.meta.url));
                    const helper = await import(pathToFileURL(file).href);
                    check();
                    const result: RuntimeProfile = await helper[inspectOnly ? 'checkRuntime' : 'buildImage']({ ...captured, ...(inspectOnly ? { image: input.image } : {}) }, {
                        home: this.controller.applicationHome(), cwd: this.controller.applicationHome(), extraPackages,
                        env: helper.preparationEnvironment(this.runtimeEnvironment),
                        signal: AbortSignal.any([signal, abort.signal]), guard: check, onOutput: output, checkPath,
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
        }, guard: () => void, signal: AbortSignal, output: (text: string) => void) => prepareNative(input, guard, signal, output, true);
        const prepareInteractive = (initialRuntime: Partial<RuntimeProfile>, guard: () => void, host: {
            extraPackages?: string;
            choose?(title: string, labels: string[]): Promise<string | undefined>;
            ask(question: string, value: string): Promise<string>;
            output(text: string): void;
            execute(file: string, args: string[], options: Record<string, unknown>): Promise<unknown>;
        }) => this.serial(async () => {
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
                    initialRuntime, extraPackages: host.extraPackages, stageOnly: true, home: this.controller.applicationHome(), signal: abort.signal,
                    ownerHome: this.runtimeEnvironment.HOME, env: this.runtimeEnvironment,
                    guard: check, checkPath, choose: host.choose, ask: host.ask, output: host.output, execute,
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
        const discover = (kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, guard: () => void) => {
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
                        home: this.controller.applicationHome(), signal: abort.signal, guard: check, checkPath: file => {
                            disjoint(file, this.controller.listProjects().map(project => project.sourceRoot));
                            disjoint(file, ['state', 'artifacts', 'inputs', 'control'].map(name => join(this.controller.applicationHome(), name)));
                        }
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
            runtime: edit.configuration.runtime, appliesRuntime, assertCurrent: edit.assertCurrent, checkPath, discover, suggestPaths, imageBuildInputs, buildImage, checkRuntime, prepareInteractive, validate: (runtime: RuntimeProfile, guard?: () => unknown) => edit.validate({ ...edit.configuration, runtime }, guard), save: (runtime: RuntimeProfile, guard?: () => unknown) => (appliesRuntime ? edit.saveRuntime : edit.save)({ ...edit.configuration, runtime }, guard)
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
        return prepareClaudeBridgeConnection({
            home, operator: Object.freeze({ ...operator }),
            savedBridge: prepared.savedBridge as StartupConfiguration['bridge'],
            runtimeCompatible: (!configuration.runtime || !!configuration.runtime.dockerConfigDirectory)
                && (!this.prepared?.configuration.runtime || !!this.prepared.configuration.runtime.dockerConfigDirectory),
            assertCurrent: () => assertCurrent(),
            checkPath: file => {
                assertCurrent();
                disjoint(file, this.controller.listProjects().map(project => project.sourceRoot));
                disjoint(file, ['state', 'artifacts', 'inputs', 'control'].map(name => join(home, name)));
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
    private saveChecked(value: unknown, expected?: ReturnType<typeof snapshot>, validate?: () => unknown, applyRuntime = false) {
        const captured = structuredClone(value);
        return this.serial(async () => {
            if (validate && validate() !== undefined)
                throw Error('Synchronous startup validation required');
            const home = this.controller.applicationHome(), before = snapshot(home), roots = this.controller.listProjects().map(project => project.sourceRoot);
            if (expected && (before.present !== expected.present || before.invalid !== expected.invalid || !before.bytes.equals(expected.bytes)))
                throw Error('Saved startup changed while editing; reopen /setup before saving');
            const configuration = await validateStartupConfiguration(captured, roots, home);
            const assertOwner = () => {
                if (this.closing)
                    throw Error('Startup setup is closing');
                if (validate && validate() !== undefined)
                    throw Error('Synchronous startup validation required');
                const current = snapshot(home);
                if (this.controller.applicationHome() !== home || JSON.stringify(this.controller.listProjects().map(project => project.sourceRoot)) !== JSON.stringify(roots) || current.present !== before.present || current.invalid !== before.invalid || !current.bytes.equals(before.bytes))
                    throw Error('Startup setup changed during validation; inspect and retry');
            };
            const commit = () => {
                assertOwner();
                directory(join(home, 'config'), true, true);
                writeObject(join(home, 'config/startup.json'), configuration as unknown as Record<string, unknown>, assertOwner);
            };
            if (applyRuntime) {
                if (!configuration.runtime)
                    throw Error('Runtime application requires a complete execution profile');
                await this.controller.applyRuntimeProfile(configuration.runtime, commit);
                this.prepared = Object.freeze({
                    configuration: Object.freeze({ ...(this.prepared?.configuration ?? { version: 1 as const }), runtime: configuration.runtime }),
                    sources: Object.freeze({ runtime: 'saved' as const, bridge: this.prepared?.sources.bridge ?? 'none' }),
                });
            } else commit();
            return { savedScope: 'application', activeExecutionChanged: false, runtimeApplied: applyRuntime, nextAction: applyRuntime
                ? 'Runtime saved and applied for subsequent operations; existing operations retain their captured runtime. Bridge changes still require relaunch.'
                : 'Close normally and relaunch to apply startup changes' };
        });
    }
    clear() { return this.save({ version: 1 }); }
}

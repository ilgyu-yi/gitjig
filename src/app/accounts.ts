import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, constants, openSync, writeFileSync, fsyncSync, closeSync, lstatSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { ModelRuntime, CredentialSynchronizationError } from '@earendil-works/pi-coding-agent';
import { InMemoryModelsStore, type AuthInteraction, type AuthType } from '@earendil-works/pi-ai';
import type { Controller } from '../controller/controller.js';
import { ApplicationSettings, InvalidConfigurationJsonError, directory, readObject, writeObject } from './settings.js';
import { ownSelectedProvider } from '../pi/selected-provider.js';
import { advanceSourceEpoch } from './source-generations.js';
import { admitCredentials, admitModelConfiguration, isObject, literalValue, configuredCredentialType } from './model-config.js';
import { ApplicationModels } from './models.js';
export interface AccountView {
    provider: string;
    methods: {
        type: AuthType;
        label: string;
    }[];
    stored: 'api_key' | 'oauth' | null;
    configured: boolean;
    verification: 'not-checked';
}
export interface AccountResult {
    provider: string;
    operation: 'login' | 'logout';
    committed: boolean;
    synchronized: boolean;
    account: AccountView;
}
type RepairFileKind = 'models' | 'auth';
function readRepairFile(folder: string, kind: RepairFileKind) {
    const file = join(folder, kind + '.json');
    let bytes = Buffer.alloc(0);
    let value: Record<string, unknown> = {};
    let reason: string | undefined;
    try {
        value = readObject(file, true, raw => { bytes = Buffer.from(raw); });
    }
    catch (error) {
        if (!(error instanceof InvalidConfigurationJsonError))
            throw error;
        reason = 'Invalid JSON or object shape';
    }
    if (!reason) {
        try {
            if (kind === 'models')
                admitModelConfiguration(value);
            else
                admitCredentials(value);
        }
        catch {
            reason = 'Unsupported or invalid configuration values';
        }
    }
    return { kind, file, bytes, reason };
}
function writeRepairBackup(file: string, bytes: Buffer): void {
    let handle: number | undefined;
    try {
        handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(handle, bytes);
        fsyncSync(handle);
    }
    finally {
        if (handle !== undefined)
            closeSync(handle);
    }
}
/** App-owned composition of original Pi account operations. No transport or OAuth implementation. */
export class ApplicationAccounts {
    private readonly settings: ApplicationSettings;
    private readonly directory: string;
    private readonly stopping = new AbortController();
    private closed = false;
    private tail: Promise<unknown> = Promise.resolve();
    private constructor(private readonly controller: Controller) {
        this.settings = ApplicationSettings.open(controller);
        this.directory = this.settings.directory;
        controller.adoptApplicationResource(this);
    }
    static open(controller: Controller): ApplicationAccounts { return new ApplicationAccounts(controller); }
    private assertOwner = () => {
        if (this.closed)
            throw new Error('Account manager is closing');
        this.controller.applicationHome();
        directory(this.directory, true);
    };
    private inputs() {
        this.assertOwner();
        const config = readObject(join(this.directory, 'models.json'), true);
        const credentials = readObject(join(this.directory, 'auth.json'), true);
        admitModelConfiguration(config);
        admitCredentials(credentials);
        return { config, credentials };
    }
    private async catalogue(modelsPath = join(this.directory, 'models.json')) {
        const runtime = await ModelRuntime.create({
            authPath: join(this.directory, 'auth.json'), modelsPath,
            modelsStore: new InMemoryModelsStore(), refreshOnCreate: false, allowModelNetwork: false
        });
        if (runtime.getError())
            throw new Error('Invalid application model configuration; repair config/models.json');
        return runtime;
    }
    private serial<T>(operation: () => Promise<T>, mutation = false): Promise<T> {
        this.assertOwner();
        const result = this.tail.then(async () => {
            this.assertOwner();
            const release = mutation ? this.controller.beginApplicationMutation() : undefined;
            try {
                return await operation();
            }
            finally {
                release?.();
            }
        });
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
    private account(runtime: ModelRuntime, provider: string, inputs: ReturnType<ApplicationAccounts['inputs']>): AccountView {
        const entry = runtime.getProvider(provider);
        if (!entry)
            throw new Error('Unknown provider; list accounts to select a configured or built-in provider');
        const credential = inputs.credentials[provider];
        const providerConfig = isObject(inputs.config.providers) ? inputs.config.providers[provider] : undefined;
        return {
            provider, methods: [
                ...(entry.auth.apiKey?.login ? [{ type: 'api_key' as const, label: entry.auth.apiKey.name }] : []),
                ...(entry.auth.oauth ? [{ type: 'oauth' as const, label: entry.auth.oauth.loginLabel ?? entry.auth.oauth.name }] : []),
            ], stored: isObject(credential) ? credential.type as 'api_key' | 'oauth' : null,
            configured: isObject(providerConfig) && typeof providerConfig.apiKey === 'string', verification: 'not-checked'
        };
    }
    /** Current local metadata only; does not initialize a model runtime or probe authentication. */
    accountPresence(provider: string): boolean {
        return this.accountPresences([provider])[provider]!;
    }
    accountPresences(providers: readonly string[]): Record<string, boolean> {
        const inputs = this.inputs();
        return Object.fromEntries([...new Set(providers)].map(provider => [provider, configuredCredentialType(inputs.config, inputs.credentials, provider) !== undefined]));
    }
    status(): Promise<AccountView[]> {
        return this.serial(async () => {
            const inputs = this.inputs(), runtime = await this.catalogue();
            return runtime.getProviders().map(provider => this.account(runtime, provider.id, inputs));
        });
    }
    models(search = '') {
        return this.serial(async () => {
            this.inputs();
            return new ApplicationModels(this.controller).list(search);
        });
    }
    setDefault(provider: string, model: string, validate?: () => void) {
        return this.serial(async () => {
            this.controller.assertApplicationMutationAllowed();
            this.inputs();
            validate?.();
            const models = new ApplicationModels(this.controller), choice = await models.choice(provider, model), sourceCurrent = await models.prepareChoiceGuard(choice);
            const assertCurrent = () => {
                sourceCurrent();
                validate?.();
            };
            const manager = this.settings.manager(undefined, assertCurrent);
            assertCurrent();
            manager.setDefaultModelAndProvider(provider, model);
            await this.settings.flush(manager);
            return { savedScope: 'application', provider, model, activeExecutionChanged: false };
        }, true);
    }
    setScope(patterns: string[], validate?: () => void) {
        patterns = [...patterns];
        return this.serial(async () => {
            this.controller.assertApplicationMutationAllowed();
            this.inputs();
            validate?.();
            const { models, assertCurrent } = await new ApplicationModels(this.controller).scope(patterns);
            const guard = () => {
                assertCurrent();
                validate?.();
            };
            guard();
            await this.settings.setPreference('enabledModels', patterns, guard);
            return { savedScope: 'application', patterns, models, activeExecutionChanged: false };
        }, true);
    }
    configure(config: Record<string, unknown>) {
        return this.serial(async () => {
            this.controller.assertApplicationMutationAllowed();
            admitCredentials(readObject(join(this.directory, 'auth.json'), true));
            // A broken previous model file must be replaceable by a validated
            // candidate. Still reject unsafe files/links and oversized sources.
            try {
                readObject(join(this.directory, 'models.json'), true);
            }
            catch (error) {
                if (!(error instanceof InvalidConfigurationJsonError))
                    throw error;
            }
            admitModelConfiguration(config);
            // Validate through original Pi composition before committing. A bad
            // endpoint/model must not destroy the previous usable configuration.
            const staged = join(this.directory, `models.${randomUUID()}.tmp`);
            try {
                writeObject(staged, config, this.assertOwner);
                await this.catalogue(staged);
                this.controller.assertApplicationMutationAllowed();
                writeObject(join(this.directory, 'models.json'), config, this.assertOwner);
            }
            finally {
                try {
                    unlinkSync(staged);
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw error;
                }
            }
            return { savedScope: 'application', activeExecutionChanged: false };
        }, true);
    }
    /** Recovery must remain callable when either catalogue input is invalid. No secret bytes leave this owner. */
    prepareConfigurationRepair() {
        return this.serial(async () => {
            const folder = lstatSync(this.directory);
            const take = (kind: RepairFileKind) => readRepairFile(this.directory, kind);
            const captured = { models: take('models'), auth: take('auth') };
            if (!captured.models.reason && !captured.auth.reason)
                try {
                    await this.catalogue();
                }
                catch {
                    captured.models.reason = 'Model catalogue cannot load this configuration';
                }
            const check = () => {
                this.assertOwner();
                const now = lstatSync(this.directory);
                if (now.dev !== folder.dev || now.ino !== folder.ino)
                    throw Error('Model/account configuration directory changed while reviewing repair; reopen /model-repair');
                for (const kind of ['models', 'auth'] as const)
                    if (!take(kind).bytes.equals(captured[kind].bytes))
                        throw Error('Model/account configuration changed while reviewing repair; reopen /model-repair');
            };
            check();
            return {
                files: Object.values(captured).map(({ kind, file, reason }) => ({ kind, file, reason: reason ?? null })),
                reset: (kind: 'models' | 'auth', guard: () => void) => this.serial(async () => {
                    check();
                    guard();
                    this.controller.assertApplicationMutationAllowed();
                    const selected = captured[kind];
                    if (!selected.reason)
                        throw Error('Only an unavailable configuration can be reset through recovery');
                    const backup = selected.file + '.recovery-' + randomUUID() + '.bak';
                    const assertCurrent = () => {
                        check();
                        guard();
                    };
                    assertCurrent();
                    writeRepairBackup(backup, selected.bytes);
                    // Exact private backup precedes the guarded atomic replacement. No catalogue/account startup is required.
                    writeObject(selected.file, kind === 'models' ? { providers: {} } : {}, assertCurrent);
                    return {
                        file: selected.file, backup, scope: kind === 'models' ? 'Custom model endpoints, model definitions and embedded keys removed; built-in catalogue restored. Stored accounts and current model choice are kept.' : 'Stored account credentials removed. Model definitions and current model choice are kept; log in again before execution.'
                    };
                }, true)
            };
        });
    }
    private deviceId(): string {
        const file = join(this.directory, 'device.json'), current = readObject(file, true);
        if (current.id !== undefined && (typeof current.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(current.id)))
            throw new Error('Invalid application device identity; repair config/device.json');
        if (typeof current.id === 'string')
            return current.id;
        const id = randomUUID();
        writeObject(file, { id }, this.assertOwner);
        return id;
    }
    login(provider: string, type: AuthType, interaction: AuthInteraction): Promise<AccountResult> {
        return this.changeAccount(provider, 'login', type, interaction);
    }
    logout(provider: string, signal?: AbortSignal): Promise<AccountResult> {
        return this.changeAccount(provider, 'logout', undefined, signal ? { signal, prompt: async () => { throw Error('No logout prompt'); }, notify() { } } : undefined);
    }
    private changeAccount(provider: string, operation: 'login' | 'logout', type?: AuthType, interaction?: AuthInteraction): Promise<AccountResult> {
        return this.serial(async () => {
            if (provider === 'claude-bridge')
                throw new Error('Claude Code-backed login/logout is managed through the explicitly selected external Claude Code account; use bridge startup setup');
            this.controller.assertApplicationMutationAllowed();
            const initial = this.inputs();
            const runtime = await this.catalogue(), original = runtime.getProvider(provider);
            if (!original)
                throw new Error('Unknown provider; list accounts first');
            if (operation === 'login' && !this.account(runtime, provider, initial).methods.some(method => method.type === type))
                throw new Error('This provider does not support the requested managed login method');
            const signal = interaction?.signal ? AbortSignal.any([this.stopping.signal, interaction.signal]) : this.stopping.signal;
            const assertSource = () => {
                // Auth can intentionally change during original login/logout;
                // validate its current shape, but config is an immutable input.
                const current = this.inputs();
                if (!isDeepStrictEqual(initial.config, current.config))
                    throw new Error('Model configuration changed during account operation; retry after settlement');
            };
            const { track, drain, register } = ownSelectedProvider(runtime, provider, assertSource, signal);
            let committed = false, synchronized = true;
            try {
                await register();
                signal.throwIfAborted();
                assertSource();
                this.controller.assertApplicationMutationAllowed();
                advanceSourceEpoch(this.directory, provider, this.assertOwner);
                if (operation === 'login') {
                    const guarded: AuthInteraction = {
                        ...interaction!, signal, prompt: async (prompt) => {
                            const answer = await interaction!.prompt(prompt);
                            if (prompt.type === 'secret' || type === 'api_key')
                                literalValue(answer);
                            return answer;
                        }
                    };
                    await track(runtime.login(provider, type!, guarded, { agentName: 'gitjig', getDeviceId: () => this.deviceId() }));
                }
                else
                    await track(runtime.logout(provider, { signal }));
                committed = true;
            }
            catch (error) {
                if (error instanceof CredentialSynchronizationError) {
                    committed = true;
                    synchronized = false;
                }
                else
                    throw new Error(signal.aborted ? 'Account operation cancelled; original authentication and storage are settling' : 'Account operation failed; inspect application account state before retrying');
            }
            finally {
                await drain();
            }
            return { provider, operation, committed, synchronized, account: this.account(runtime, provider, this.inputs()) };
        }, true);
    }
    close(): Promise<void> {
        if (!this.closed) {
            this.closed = true;
            this.stopping.abort();
        }
        return this.tail.then(() => undefined);
    }
}

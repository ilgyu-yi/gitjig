import type { ChangeOperation } from '../controller/change-types.js';
import { captureWorkModelBaseline, type ApplicationRoleModelRequest, type WorkModelBaseline } from '../controller/application-model.js';
import { join } from 'node:path';
import { ModelRuntime, resolveModelScopeWithDiagnostics } from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, InMemoryModelsStore, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { Controller } from '../controller/controller.js';
import type { ModelChoiceInput } from '../controller/model-choice.js';
import type { PiModelSelection } from '../pi/session.js';
import { resolveManagedModel } from '../pi/managed-provider.js';
import { ApplicationSettings, directory, readObject, writeObject } from './settings.js';
import { admitCredentials, admitModelConfiguration } from './model-config.js';
import { captureSessionPreferences } from '../pi/session-preferences.js';
import { captureNativeModelSelection } from '../pi/model-identity.js';
import { applicationModelRoles, type ApplicationModelRole } from './model-roles.js';
export { applicationModelRoles, type ApplicationModelRole } from './model-roles.js';
const roles = applicationModelRoles;
type ManagedChoice = Extract<ModelChoiceInput, {
    kind: 'managed';
}>;
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const desiredRoleChoice = (baseline: WorkModelBaseline, role: ApplicationModelRole, preferences: Partial<Record<ApplicationModelRole, ManagedChoice>>) => preferences[role] ?? baseline.choice;
/** One app-owned resolver for desired choices; credentials are resolved only at execution admission. */
export class ApplicationModels {
    private readonly settings: ApplicationSettings;
    constructor(private readonly controller: Controller) { this.settings = ApplicationSettings.open(controller); }
    /** Trusted application composition; the controller owns one resolver for this home. */
    install(options: {
        resumeAuthorized?: boolean;
    } = {}): void {
        this.controller.installApplicationModelResolver({
            resolveRole: request => this.resolveWorkRole(request),
            resolveBaseline: request => {
                const baseline = captureWorkModelBaseline(request.baseline);
                const project = request.kind === 'new' ? request.projectId : this.controller.inspectWork(request.workId).projectId;
                const preferences = this.settings.manager(project ?? undefined);
                return this.resolveDesiredChoice(baseline.choice, request.sessionPreferences ?? captureSessionPreferences({ steeringMode: preferences.getSteeringMode(), followUpMode: preferences.getFollowUpMode() }));
            },
            resolveConversation: async (request) => {
                const view = this.controller.inspectConversation(request.conversationId), choice = this.controller.getConversationModelChoice(request.conversationId);
                if (view.generation !== request.generation || choice.revision !== request.choiceRevision)
                    throw Error('Application conversation choice changed');
                return this.resolve(request.conversationId);
            },
        }, options);
    }
    async baseline(projectId?: string, explicit?: ManagedChoice): Promise<WorkModelBaseline> {
        const preferences = this.settings.manager(projectId), provider = explicit?.provider ?? preferences.getDefaultProvider(), modelId = explicit?.modelId ?? preferences.getDefaultModel();
        if (!provider || !modelId)
            throw Error('Save an application default model or select an explicit application choice before starting governed work');
        const choice = await this.choice(provider, modelId, explicit?.thinkingLevel, projectId);
        return captureWorkModelBaseline({ version: 1, revision: 1, choice, source: { kind: explicit ? 'explicit-app-entry' : 'application-default' } });
    }
    workOperation(workId: string): Extract<ChangeOperation, {
        applicationModel: object;
    }> {
        const baseline = this.controller.getWorkApplicationModelBaseline(workId);
        if (!baseline)
            throw Error('Work has no application baseline; keep its explicitly selected external model route');
        const projectId = this.controller.inspectWork(workId).projectId, preferences = this.settings.manager(projectId ?? undefined);
        const sessionPreferences = captureSessionPreferences({ steeringMode: preferences.getSteeringMode(), followUpMode: preferences.getFollowUpMode() })!;
        // Desired selector only: the actual role callback resolves credentials at its own launch.
        return { workId, applicationModel: { version: 1, baselineRevision: baseline.revision }, sessionPreferences };
    }
    conversationOperation(conversationId: string): Extract<import('../controller/interaction-types.js').ConversationModelRequest, {
        applicationConversation: object;
    }> {
        const choice = this.controller.getConversationModelChoice(conversationId);
        if (choice.kind !== 'managed')
            throw Error('APPLICATION_MODEL_UNAVAILABLE: select a managed conversation model first');
        return { applicationConversation: { version: 1, choiceRevision: choice.revision } };
    }
    private async resolveDesiredChoice(choice: ManagedChoice, sessionPreferences?: PiModelSelection['sessionPreferences']): Promise<PiModelSelection> {
        const preferences = captureSessionPreferences(sessionPreferences);
        if (choice.provider === 'claude-bridge') {
            const selected = await this.bridge().selectModel(choice.modelId, choice.thinkingLevel);
            const descriptors = Object.getOwnPropertyDescriptors(selected);
            if (preferences)
                descriptors.sessionPreferences = { value: preferences, enumerable: true };
            const captured = captureNativeModelSelection(Object.create(Object.getPrototypeOf(selected), descriptors));
            this.controller.assertApplicationModelSource(captured, choice);
            return captured;
        }
        return captureNativeModelSelection({ provider: choice.provider, modelId: choice.modelId,
            ...(preferences ? { sessionPreferences: preferences } : {}),
            managed: await resolveManagedModel(this.controller.applicationHome(), choice.provider, choice.modelId, choice.thinkingLevel) });
    }
    private async resolveWorkRole(request: ApplicationRoleModelRequest): Promise<PiModelSelection> {
        request = structuredClone(request);
        if (!roles.includes(request.role))
            throw Error('Unknown application model role');
        const baseline = captureWorkModelBaseline(request.baseline), selected = desiredRoleChoice(baseline, request.role, this.rolePreferences());
        const project = this.controller.inspectWork(request.workId).projectId, preferences = this.settings.manager(project ?? undefined);
        const queue = request.sessionPreferences ?? captureSessionPreferences({ steeringMode: preferences.getSteeringMode(), followUpMode: preferences.getFollowUpMode() });
        return this.resolveDesiredChoice(selected, queue);
    }
    private async catalogue() {
        this.controller.applicationHome();
        admitModelConfiguration(readObject(join(this.settings.directory, 'models.json'), true));
        admitCredentials(readObject(join(this.settings.directory, 'auth.json'), true));
        const runtime = await ModelRuntime.create({ authPath: join(this.settings.directory, 'auth.json'),
            modelsPath: join(this.settings.directory, 'models.json'), modelsStore: new InMemoryModelsStore(),
            refreshOnCreate: false, allowModelNetwork: false });
        this.controller.applicationHome();
        if (runtime.getError())
            throw new Error('Application model configuration is invalid; repair config/models.json');
        const models = [...runtime.getModels()], diagnostics: {
            provider: string;
            status: string;
        }[] = [];
        const bridge = this.controller.applicationModelResource();
        if (bridge) {
            try {
                models.push(...await bridge.models());
                diagnostics.push({ provider: 'claude-bridge', status: 'initialized; external Claude Code account not verified' });
            }
            catch {
                diagnostics.push({ provider: 'claude-bridge', status: 'restart/setup required; direct models remain usable' });
            }
        }
        else
            diagnostics.push({ provider: 'claude-bridge', status: 'restart/setup required; external Claude Code account route' });
        this.controller.applicationHome();
        const identities = new Set<string>();
        for (const model of models) {
            const key = JSON.stringify([model.provider, model.id]);
            if (identities.has(key))
                throw new Error('Conflicting application model sources; repair direct models configuration');
            identities.add(key);
        }
        // Metadata only. No bridge provider/auth/stream is installed into this
        // direct runtime, and public scope resolution never resolves credentials.
        runtime.getAvailable = async () => models;
        return { runtime, models, diagnostics };
    }
    private bridge() {
        const host = this.controller.applicationModelResource();
        if (!host)
            throw new Error('Bridge model requires saved startup setup and restart; current choices and drafts are unchanged');
        return host;
    }
    async list(search = '') {
        const { runtime, models, diagnostics } = await this.catalogue(), preferences = this.settings.manager();
        const scope = await resolveModelScopeWithDiagnostics(preferences.getEnabledModels() ?? [], runtime), filter = search.toLowerCase();
        return { models: models.filter(model => `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(filter)).map(model => ({
                provider: model.provider, id: model.id, name: model.name, api: model.api, reasoning: model.reasoning,
                contextWindow: model.contextWindow, maxTokens: model.maxTokens,
            })), default: { provider: preferences.getDefaultProvider() ?? null, model: preferences.getDefaultModel() ?? null, thinking: preferences.getDefaultThinkingLevel() },
            scope: { patterns: preferences.getEnabledModels() ?? [], models: scope.scopedModels.map(entry => `${entry.model.provider}/${entry.model.id}`), diagnostics: scope.diagnostics },
            routes: diagnostics, verification: 'catalogue-only' as const };
    }
    async scope(patterns: string[]) {
        const { runtime } = await this.catalogue(), result = await resolveModelScopeWithDiagnostics(patterns, runtime);
        if (result.diagnostics.length)
            throw new Error('One or more model scope patterns cannot be resolved; list models and repair the scope or restart bridge setup');
        const bridge = result.scopedModels.find(entry => entry.model.provider === 'claude-bridge');
        const assertCurrent = bridge ? await this.prepareChoiceGuard({ kind: 'managed', provider: bridge.model.provider, modelId: bridge.model.id,
            thinkingLevel: bridge.thinkingLevel ?? clampThinkingLevel(bridge.model, 'off') }) : () => { this.controller.applicationHome(); };
        return { models: result.scopedModels.map(entry => `${entry.model.provider}/${entry.model.id}`), assertCurrent };
    }
    /** Finite metadata/source receipt, rechecked by the original save boundary. */
    async prepareChoiceGuard(choice: ManagedChoice): Promise<() => void> {
        choice = structuredClone(choice);
        const selected = choice.provider === 'claude-bridge' ? await this.bridge().selectModel(choice.modelId, choice.thinkingLevel) : undefined;
        const assertCurrent = () => {
            this.controller.applicationHome();
            if (selected)
                this.controller.assertApplicationModelSource(selected, choice);
        };
        assertCurrent();
        return assertCurrent;
    }
    async choice(provider: string, modelId: string, thinking?: ModelThinkingLevel, projectId?: string): Promise<ManagedChoice> {
        if (provider === 'claude-bridge')
            await this.bridge().models();
        const { runtime, models } = await this.catalogue(), model = models.find(model => model.provider === provider && model.id === modelId);
        if (!model)
            throw new Error('Model is absent from the application catalogue; list models or repair config/models.json');
        if (thinking !== undefined && !levels.has(thinking))
            throw new Error('Invalid thinking level');
        const settings = this.settings.manager(projectId);
        // Scope resolution is catalogue-only: choosing a model must work before login.
        const scope = await resolveModelScopeWithDiagnostics(settings.getEnabledModels() ?? [], runtime);
        const scoped = scope.scopedModels.find(entry => entry.model.provider === provider && entry.model.id === modelId);
        const level = thinking ?? scoped?.thinkingLevel ?? settings.getModelThinkingLevel(provider, modelId) ?? settings.getDefaultThinkingLevel() ?? 'off';
        const choice: ManagedChoice = { kind: 'managed', provider, modelId, thinkingLevel: clampThinkingLevel(model, level) };
        (await this.prepareChoiceGuard(choice))();
        return choice;
    }
    async newConversation(options: {
        projectId?: string | null;
        choice?: ManagedChoice;
    } = {}, validate?: () => void) {
        const preferences = this.settings.manager(options.projectId ?? undefined);
        const provider = preferences.getDefaultProvider(), model = preferences.getDefaultModel();
        // Capture preferences before creating. A missing/stale default leaves an explicit unbound conversation.
        let choice: ModelChoiceInput = { kind: 'unbound', reason: 'Choose a model with /model before sending input' };
        if (options.choice)
            choice = await this.choice(options.choice.provider, options.choice.modelId, options.choice.thinkingLevel, options.projectId ?? undefined);
        else if (provider && model) {
            try {
                const catalogue = await this.catalogue();
                choice = catalogue.models.some(entry => entry.provider === provider && entry.id === model) ? await this.choice(provider, model, undefined, options.projectId ?? undefined) :
                    { kind: 'unbound', reason: 'Saved default model is unavailable; select an application catalogue model' };
            }
            catch {
                choice = { kind: 'unbound', reason: 'Saved default model configuration is unavailable; open /model-repair, then select a model. No fallback model was selected.' };
            }
        }
        validate?.();
        return this.controller.createApplicationConversation({ ...(options.projectId === undefined ? {} : { projectId: options.projectId }), choice }, validate);
    }
    async select(input: {
        conversationId: string;
        expectedGeneration: number;
        expectedRevision: number;
        provider: string;
        modelId: string;
        thinkingLevel?: ModelThinkingLevel;
    }, assertCurrent?: () => unknown) {
        input = { ...input };
        if (assertCurrent && assertCurrent() !== undefined)
            throw Error('Synchronous model selection validation required');
        const projectId = this.controller.inspectConversation(input.conversationId).projectId ?? undefined;
        const choice = await this.choice(input.provider, input.modelId, input.thinkingLevel, projectId);
        return this.controller.setConversationModelChoice({ ...input, choice }, assertCurrent);
    }
    async resolve(conversationId: string): Promise<PiModelSelection> {
        const view = this.controller.inspectConversation(conversationId);
        if (view.deleted || view.archived)
            throw new Error('Restore the conversation before resolving its model');
        const choice = this.controller.getConversationModelChoice(conversationId);
        if (choice.kind !== 'managed')
            throw new Error(choice.kind === 'unbound' ? choice.reason : 'Conversation requires its explicitly selected external runtime profile');
        const settings = this.settings.manager(view.projectId ?? undefined);
        const sessionPreferences = captureSessionPreferences({ steeringMode: settings.getSteeringMode(), followUpMode: settings.getFollowUpMode() })!;
        const selected = await this.resolveDesiredChoice(choice, sessionPreferences);
        const current = this.controller.inspectConversation(conversationId);
        if (this.controller.getConversationModelChoice(conversationId).revision !== choice.revision || current.generation !== view.generation ||
            current.projectId !== view.projectId || current.deleted || current.archived)
            throw new Error('Conversation model or target changed during resolution; retry');
        return selected;
    }
    async next(input: {
        conversationId: string;
        expectedGeneration: number;
        expectedRevision: number;
    }, assertCurrent?: () => unknown) {
        input = { ...input };
        const view = this.controller.inspectConversation(input.conversationId), current = this.controller.getConversationModelChoice(input.conversationId);
        const { runtime } = await this.catalogue(), settings = this.settings.manager(view.projectId ?? undefined);
        const scope = await resolveModelScopeWithDiagnostics(settings.getEnabledModels() ?? [], runtime);
        if (scope.diagnostics.length || !scope.scopedModels.length)
            throw new Error('Configure a valid cycling pool with /scoped-models first');
        const index = current.kind === 'unbound' ? -1 : scope.scopedModels.findIndex(entry => entry.model.provider === current.provider && entry.model.id === current.modelId);
        const entry = scope.scopedModels[(index + 1) % scope.scopedModels.length]!;
        return this.select({ ...input, provider: entry.model.provider, modelId: entry.model.id,
            ...(entry.thinkingLevel ? { thinkingLevel: entry.thinkingLevel } : {}) }, assertCurrent);
    }
    /** Same desired source as role execution, without SDK or credential resolution. */
    workRoleChoices(workId: string, requested: readonly ApplicationModelRole[]) {
        const baseline = this.controller.getWorkApplicationModelBaseline(workId);
        if (!baseline)
            return null;
        const preferences = this.rolePreferences();
        return requested.map(role => ({ role, choice: desiredRoleChoice(baseline, role, preferences) }));
    }
    rolePreferences(): Partial<Record<ApplicationModelRole, ManagedChoice>> {
        this.controller.applicationHome();
        const raw = readObject(join(this.settings.directory, 'role-models.json'), true);
        const selected: Partial<Record<ApplicationModelRole, ManagedChoice>> = {};
        for (const [role, entry] of Object.entries(raw)) {
            const value = entry as ManagedChoice;
            if (!roles.includes(role as ApplicationModelRole) || !value || value.kind !== 'managed' ||
                typeof value.provider !== 'string' || !value.provider || typeof value.modelId !== 'string' || !value.modelId || !levels.has(value.thinkingLevel))
                throw new Error('Invalid role model preferences; repair config/role-models.json');
            selected[role as ApplicationModelRole] = { kind: 'managed', provider: value.provider, modelId: value.modelId, thinkingLevel: value.thinkingLevel };
        }
        return selected;
    }
    prepareRoleEdit() {
        const take = () => {
            this.controller.applicationHome();
            directory(this.settings.directory, true);
            let bytes = Buffer.alloc(0);
            readObject(join(this.settings.directory, 'role-models.json'), true, raw => { bytes = Buffer.from(raw); });
            return bytes;
        };
        const before = take(), preferences = this.rolePreferences();
        const assertCurrent = () => {
            if (!take().equals(before))
                throw Error('Role model preferences changed; reopen /role-model');
        };
        assertCurrent();
        return { preferences, assertCurrent };
    }
    async setRole(role: ApplicationModelRole, choice: ManagedChoice | null, validate?: () => void) {
        if (!roles.includes(role))
            throw new Error('Unknown model role');
        const release = this.controller.beginApplicationMutation();
        try {
            const edit = this.prepareRoleEdit(), next = edit.preferences;
            const guard = () => {
                edit.assertCurrent();
                validate?.();
            };
            guard();
            if (choice)
                next[role] = await this.choice(choice.provider, choice.modelId, choice.thinkingLevel);
            else
                delete next[role];
            const assertCurrent = next[role] ? await this.prepareChoiceGuard(next[role]!) : () => { this.controller.applicationHome(); };
            writeObject(join(this.settings.directory, 'role-models.json'), next, () => {
                guard();
                assertCurrent();
            });
        }
        finally {
            release();
        }
    }
    async resolveRole(role: ApplicationModelRole, baseline: PiModelSelection): Promise<PiModelSelection> {
        const preferences = captureSessionPreferences(baseline.sessionPreferences);
        const captured = captureNativeModelSelection(baseline);
        if (!baseline.managed)
            return captured;
        const choice = this.rolePreferences()[role];
        if (!choice)
            return captured;
        return this.resolveDesiredChoice(choice, preferences);
    }
}

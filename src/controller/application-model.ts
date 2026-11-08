import type { PiModelSelection } from '../pi/session.js';
import type { SessionQueuePreferences } from '../pi/session-preferences.js';
import type { Role } from '../workflow/types.js';
import { validateModelChoice, type ModelChoiceInput } from './model-choice.js';
import { captureNativeModelSelection } from '../pi/model-identity.js';
import type { RunConversationOptions, ApplicationConversationOperation, ConversationModelMode } from './interaction-types.js';
import type { Store } from './store.js';
export interface ApplicationModelOperation {
    version: 1;
    baselineRevision: number;
}
export interface WorkModelBaseline {
    version: 1;
    revision: number;
    choice: Extract<ModelChoiceInput, {
        kind: 'managed';
    }>;
    source: {
        kind: 'conversation';
        conversationId: string;
        choiceRevision: number;
    } | {
        kind: 'explicit-app-entry' | 'application-default';
    };
}
export interface OrdinaryRoleBinding {
    version: 1;
    revision: number;
    sourceRunId: string;
    conversationId: string;
    mode: {
        kind: 'application';
        baseline: WorkModelBaseline;
    } | {
        kind: 'explicit';
        provider: string;
        modelId: string;
    };
}
export interface ApplicationRoleModelRequest {
    workId: string;
    epoch: number;
    generation: number;
    role: Role;
    baseline: WorkModelBaseline;
    sessionPreferences?: SessionQueuePreferences;
}
export type ApplicationBaselineModelRequest = {
    baseline: WorkModelBaseline;
    sessionPreferences?: SessionQueuePreferences;
} & ({
    kind: 'new';
    projectId: string;
} | {
    kind: 'retained';
    workId: string;
    epoch: number;
    generation: number;
});
export interface ApplicationModelResolver {
    resolveRole(request: ApplicationRoleModelRequest): Promise<PiModelSelection>;
    resolveConversation(request: {
        conversationId: string;
        generation: number;
        choiceRevision: number;
    }): Promise<PiModelSelection>;
    resolveBaseline?(request: ApplicationBaselineModelRequest): Promise<PiModelSelection>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
export function captureOrdinaryRoleBinding(value: unknown): OrdinaryRoleBinding {
    const fail = (): never => { throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid ordinary role binding'); };
    if (!record(value) || !keys(value, ['version', 'revision', 'sourceRunId', 'conversationId', 'mode']) || value.version !== 1 || !positive(value.revision) || !uuid(value.sourceRunId) || !uuid(value.conversationId) || !record(value.mode))
        return fail();
    const common = { version: 1 as const, revision: value.revision, sourceRunId: value.sourceRunId, conversationId: value.conversationId };
    if (value.mode.kind === 'application' && keys(value.mode, ['kind', 'baseline'])) {
        const baseline = captureWorkModelBaseline(value.mode.baseline);
        if (baseline.revision !== value.revision || baseline.source.kind !== 'conversation' || baseline.source.conversationId !== value.conversationId)
            return fail();
        return { ...common, mode: { kind: 'application', baseline } };
    }
    const mode = captureConversationMode(value.mode);
    if (mode.kind !== 'explicit')
        return fail();
    return { ...common, mode };
}
/** Read configuration provenance only; this grants no execution or publication standing. */
export function subjectRoleModel(store: Store, workId: string): {
    baseline?: WorkModelBaseline;
    ordinary?: OrdinaryRoleBinding;
    explicit?: {
        provider: string;
        modelId: string;
    };
    fingerprint?: string;
} {
    const fail = (): never => { throw Error('APPLICATION_MODEL_UNAVAILABLE: ordinary role source missing or changed'); };
    const work = store.one('SELECT * FROM works WHERE id=?', workId);
    if (!work)
        return fail();
    const data = JSON.parse(work.data);
    if (data.kind !== 'ordinary-conversation') {
        if (Object.hasOwn(data, 'ordinaryRoleBinding'))
            return fail();
        return Object.hasOwn(data, 'applicationModelBaseline') ? { baseline: captureWorkModelBaseline(data.applicationModelBaseline) } : {};
    }
    if (Object.hasOwn(data, 'applicationModelBaseline'))
        return fail();
    const mode = Object.hasOwn(data, 'conversationModelMode') ? captureConversationMode(data.conversationModelMode) : undefined;
    if (!Object.hasOwn(data, 'ordinaryRoleBinding')) {
        if (mode?.kind === 'application')
            return fail();
        return mode?.kind === 'explicit' ? { explicit: { provider: mode.provider, modelId: mode.modelId } } : {};
    }
    const binding = captureOrdinaryRoleBinding(data.ordinaryRoleBinding), run = store.one('SELECT * FROM runs WHERE id=?', binding.sourceRunId);
    if (!run || run.work !== work.id || run.generation !== work.generation || data.conversation !== binding.conversationId || !mode)
        return fail();
    const sourceData = JSON.parse(run.data), input = store.one('SELECT * FROM conversation_inputs WHERE id=?', sourceData.initialInputId ?? null);
    const source = input ? store.one('SELECT * FROM sources WHERE id=?', input.source) : undefined;
    if (sourceData.kind !== 'ordinary-conversation' || sourceData.conversation !== binding.conversationId ||
        JSON.stringify(captureOrdinaryRoleBinding(sourceData.ordinaryRoleBinding)) !== JSON.stringify(binding) || JSON.stringify(captureConversationMode(sourceData.conversationModelMode)) !== JSON.stringify(mode) ||
        !input || input.work !== work.id || input.conversation !== binding.conversationId || !positive(input.generation) || !source || source.conversation !== binding.conversationId || sourceData.raw !== input.text)
        return fail();
    let baseline: WorkModelBaseline | undefined, explicit: {
        provider: string;
        modelId: string;
    } | undefined;
    if (binding.mode.kind === 'application') {
        baseline = binding.mode.baseline;
        if (mode.kind !== 'application' || baseline.source.kind !== 'conversation' || mode.choiceRevision !== baseline.source.choiceRevision)
            return fail();
    }
    else {
        if (mode.kind !== 'explicit' || mode.provider !== binding.mode.provider || mode.modelId !== binding.mode.modelId)
            return fail();
        explicit = { provider: mode.provider, modelId: mode.modelId };
    }
    return { ...(baseline ? { baseline } : {}), ...(explicit ? { explicit } : {}), ordinary: binding,
        fingerprint: JSON.stringify([work.id, work.project, work.source, work.state, work.epoch, work.generation, binding, run.id, run.epoch, run.generation, sourceData.initialInputId, input.id, input.source, input.generation, input.text, input.data, sourceData.inputContext, sourceData.modelIdentity, source]) };
}
/** Queued ordinary effects stay attached to the actual originating admission. */
export function assertOrdinaryEffectSource(store: Store, workId: string, identity: {
    workId: string;
    runId: string;
    conversationId: string;
    generation: number;
    initialInputId: string;
}): void {
    const work = store.one('SELECT data FROM works WHERE id=?', workId);
    if (!work || JSON.parse(work.data).kind !== 'ordinary-conversation')
        return;
    if (!record(identity) || !uuid(identity.runId) || !uuid(identity.conversationId) || !uuid(identity.initialInputId) || !positive(identity.generation))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: queued ordinary role identity missing');
    const selected = subjectRoleModel(store, workId), run = store.one('SELECT * FROM runs WHERE id=?', identity.runId), data = run ? JSON.parse(run.data) : null;
    const input = data ? store.one('SELECT * FROM conversation_inputs WHERE id=?', data.initialInputId ?? null) : undefined;
    if (identity.workId !== workId || !run || run.work !== workId || !input || input.generation !== identity.generation || input.work !== workId || input.conversation !== identity.conversationId || data?.conversation !== identity.conversationId || data.initialInputId !== identity.initialInputId ||
        selected.ordinary && (selected.ordinary.sourceRunId !== identity.runId || selected.ordinary.conversationId !== identity.conversationId || JSON.stringify(captureOrdinaryRoleBinding(data.ordinaryRoleBinding)) !== JSON.stringify(selected.ordinary)) ||
        !selected.ordinary && Object.hasOwn(data ?? {}, 'ordinaryRoleBinding'))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: queued ordinary role source changed');
}
export function captureApplicationConversation(value: unknown): ApplicationConversationOperation {
    if (!record(value) || !keys(value, ['version', 'choiceRevision']) || value.version !== 1 || !positive(value.choiceRevision))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid conversation model binding');
    return Object.freeze({ version: 1, choiceRevision: value.choiceRevision });
}
export function captureConversationMode(value: unknown): ConversationModelMode {
    if (record(value) && value.kind === 'application' && keys(value, ['kind', 'version', 'choiceRevision']))
        return { kind: 'application', ...captureApplicationConversation({ version: value.version, choiceRevision: value.choiceRevision }) };
    if (record(value) && value.kind === 'explicit' && keys(value, ['kind', 'provider', 'modelId'])) {
        const choice = validateModelChoice({ kind: 'legacy-external', provider: value.provider as string, modelId: value.modelId as string });
        if (choice.kind === 'legacy-external')
            return { kind: 'explicit', provider: choice.provider, modelId: choice.modelId };
    }
    throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid retained conversation model mode');
}
export function captureAssignmentModelBinding(value: unknown): {
    version: 1;
    mode: ConversationModelMode;
    inheritedFrom?: {
        conversationId: string;
        choiceRevision: number;
    };
} {
    if (!record(value) || value.version !== 1 || !keys(value, Object.hasOwn(value, 'inheritedFrom') ? ['version', 'mode', 'inheritedFrom'] : ['version', 'mode']))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid assignment model binding');
    const mode = captureConversationMode(value.mode);
    if (!Object.hasOwn(value, 'inheritedFrom'))
        return { version: 1, mode };
    const source = value.inheritedFrom;
    if (mode.kind !== 'application' || !record(source) || !keys(source, ['conversationId', 'choiceRevision']) || typeof source.conversationId !== 'string' || !positive(source.choiceRevision))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid assignment model origin');
    return { version: 1, mode, inheritedFrom: { conversationId: source.conversationId, choiceRevision: source.choiceRevision } };
}
export function captureConversationOptions(options: RunConversationOptions): RunConversationOptions {
    if (Object.hasOwn(options, 'supersedeWait') || Object.hasOwn(options, 'ordinaryRoleBinding'))
        throw Error('Internal admission binding is not a public conversation option');
    const { model, applicationConversation, ...rest } = options;
    const common = { ...rest, ...(rest.manual ? { manual: structuredClone(rest.manual) } : {}), ...(rest.userBash ? { userBash: { ...rest.userBash } } : {}) };
    if (Object.hasOwn(options, 'applicationConversation')) {
        if (Object.hasOwn(options, 'model'))
            throw Error('APPLICATION_MODEL_UNAVAILABLE: choose application binding or explicit recipe');
        return { ...common, applicationConversation: captureApplicationConversation(applicationConversation) };
    }
    if (!model)
        throw Error('APPLICATION_MODEL_UNAVAILABLE: explicit model recipe required');
    return { ...common, model: captureNativeModelSelection(model) };
}
export function captureApplicationModelOperation(value: unknown): ApplicationModelOperation {
    if (!record(value) || !keys(value, ['version', 'baselineRevision']) || value.version !== 1 || !positive(value.baselineRevision))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid operation model binding');
    return Object.freeze({ version: 1, baselineRevision: value.baselineRevision });
}
/** Finite desired choice only; never serialize a runtime recipe or credential into work data. */
export function captureWorkModelBaseline(value: unknown): WorkModelBaseline {
    if (!record(value) || !keys(value, ['version', 'revision', 'choice', 'source']) || value.version !== 1 || !positive(value.revision) || !record(value.choice) ||
        !keys(value.choice, ['kind', 'provider', 'modelId', 'thinkingLevel']) || !record(value.source))
        throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid work model baseline');
    const choice = validateModelChoice(value.choice as ModelChoiceInput);
    if (choice.kind !== 'managed')
        throw Error('APPLICATION_MODEL_UNAVAILABLE: work baseline requires a managed desired choice');
    const source = value.source;
    if (source.kind === 'conversation' && keys(source, ['kind', 'conversationId', 'choiceRevision']) &&
        typeof source.conversationId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(source.conversationId) && positive(source.choiceRevision))
        return { version: 1, revision: value.revision, choice, source: { kind: source.kind, conversationId: source.conversationId, choiceRevision: source.choiceRevision } };
    if ((source.kind === 'explicit-app-entry' || source.kind === 'application-default') && keys(source, ['kind']))
        return { version: 1, revision: value.revision, choice, source: { kind: source.kind } };
    throw Error('APPLICATION_MODEL_UNAVAILABLE: invalid baseline attribution');
}

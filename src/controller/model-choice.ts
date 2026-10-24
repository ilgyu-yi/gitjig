import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { Store } from './store.js';
export type ModelChoiceInput = {
    kind: 'managed';
    provider: string;
    modelId: string;
    thinkingLevel: ModelThinkingLevel;
} | {
    kind: 'legacy-external';
    provider: string;
    modelId: string;
} | {
    kind: 'unbound';
    reason: string;
};
export type ConversationModelChoice = ModelChoiceInput & {
    revision: number;
};
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value);
export function validateModelChoice(input: ModelChoiceInput): ModelChoiceInput {
    if (!input || typeof input !== 'object')
        throw new Error('Invalid conversation model choice');
    if (input.kind === 'unbound' && text(input.reason))
        return { kind: input.kind, reason: input.reason };
    if ((input.kind === 'managed' || input.kind === 'legacy-external') && text(input.provider) && text(input.modelId)) {
        if (input.kind === 'legacy-external')
            return { kind: input.kind, provider: input.provider, modelId: input.modelId };
        if (levels.has(input.thinkingLevel))
            return { kind: input.kind, provider: input.provider, modelId: input.modelId, thinkingLevel: input.thinkingLevel };
    }
    throw new Error('Invalid conversation model choice');
}
export function conversationModelChoice(store: Store, id: string): ConversationModelChoice {
    const row = store.one('SELECT data FROM conversation_state WHERE conversation=?', id);
    if (!row)
        throw new Error('Unknown conversation');
    const data = JSON.parse(row.data), choice = data.modelChoice;
    if (!Object.hasOwn(data, 'modelChoice'))
        return { kind: 'unbound', revision: 0, reason: 'Select a model; old conversations do not inherit a new application default' };
    if (!choice || typeof choice !== 'object' || !Number.isSafeInteger(choice.revision) || choice.revision < 1)
        throw new Error('Invalid retained conversation model revision');
    return { ...validateModelChoice(choice), revision: choice.revision };
}
/** Caller holds existing controller lifecycle/admission exclusion and transaction. */
export function writeConversationModelChoice(store: Store, id: string, input: ModelChoiceInput, expectedRevision: number): ConversationModelChoice {
    const previous = conversationModelChoice(store, id);
    if (previous.revision !== expectedRevision)
        throw new Error('Stale conversation model revision');
    const revision = previous.revision + 1;
    if (!Number.isSafeInteger(revision))
        throw new Error('Conversation model revision exhausted');
    const next = { ...validateModelChoice(input), revision }, row = store.one('SELECT data FROM conversation_state WHERE conversation=?', id);
    store.run('UPDATE conversation_state SET data=? WHERE conversation=?', JSON.stringify({ ...JSON.parse(row.data), modelChoice: next }), id);
    return next;
}

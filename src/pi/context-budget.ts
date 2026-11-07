import { ModelContextBudgetError, type ModelContextBudget } from './context-budget-error.js';
export { ModelContextBudgetError, modelContextFailureCode, type ModelContextBudget, type ModelContextFailureCode } from './context-budget-error.js';
import { normalizeContext, type Api, type Context, type Model } from '@earendil-works/pi-ai';
import { estimateContextTokens, estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';

/** The SDK request margin is independent of the model's retained output reserve. */
export const MODEL_CONTEXT_MARGIN = 4096;
/** SDK heuristic over the complete normalized request, not provider tokenization.
 * Earlier assistant usage must never hide an immutable prefix or later tool data. */
export function assertModelContextBudget(model: Pick<Model<Api>, 'contextWindow' | 'maxTokens'>, context: Context): ModelContextBudget {
    const contextWindow = model.contextWindow, outputReserve = model.maxTokens;
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 || !Number.isSafeInteger(outputReserve) || outputReserve < 1)
        throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'The selected model needs declared context and output limits; review its original configuration before retrying.');
    const normalized = normalizeContext(context);
    let fullMessageEstimate = 0;
    for (const message of normalized.messages) {
        if (message.role === 'assistant' && (!message.usage ||
            [message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite, message.usage.totalTokens]
                .some(value => !Number.isSafeInteger(value) || value < 0)))
            throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'The request contains invalid token usage; no context fit is established.');
        fullMessageEstimate += estimateMessageTokens(message);
        if (!Number.isSafeInteger(fullMessageEstimate) || fullMessageEstimate < 0)
            throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'The complete request could not be estimated; no context fit is established.');
    }
    const sdkContextEstimate = estimateContextTokens(normalized).tokens;
    if (!Number.isSafeInteger(sdkContextEstimate) || sdkContextEstimate < 0)
        throw new ModelContextBudgetError('MODEL_CONTEXT_UNAVAILABLE', 'The SDK context estimate is invalid; no context fit is established.');
    const estimatedInput = Math.max(fullMessageEstimate, sdkContextEstimate);
    const budget = Object.freeze({ contextWindow, outputReserve, margin: MODEL_CONTEXT_MARGIN, fullMessageEstimate, sdkContextEstimate, estimatedInput,
        availableInput: contextWindow - outputReserve - MODEL_CONTEXT_MARGIN });
    if (estimatedInput > budget.availableInput)
        throw new ModelContextBudgetError('MODEL_CONTEXT_LIMIT', `SDK-estimated input ${estimatedInput} + output reserve ${outputReserve} + margin ${MODEL_CONTEXT_MARGIN} exceeds context ${contextWindow}. Required inputs were not shortened; review the original task and model before retrying.`, budget);
    return budget;
}

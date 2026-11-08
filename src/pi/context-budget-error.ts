/** SDK-free retained budget diagnostics for execution and offline inspection. */
export interface ModelContextBudget {
    readonly contextWindow: number;
    readonly outputReserve: number;
    readonly margin: number;
    readonly fullMessageEstimate: number;
    readonly sdkContextEstimate: number;
    readonly estimatedInput: number;
    readonly availableInput: number;
}
export type ModelContextFailureCode = 'MODEL_CONTEXT_UNAVAILABLE' | 'MODEL_CONTEXT_LIMIT';
/** Recognize only original host budget failures, never quoted or provider prose. */
export function modelContextFailureCode(cause: unknown): ModelContextFailureCode | undefined {
    if (typeof cause !== 'string')
        return undefined;
    const match = /^(?:ModelContextBudgetError: |ControllerError: PROVIDER:HOST_CONTEXT_GUARD:ModelContextBudgetError: )(MODEL_CONTEXT_(?:LIMIT|UNAVAILABLE)):/.exec(cause);
    return match?.[1] as ModelContextFailureCode | undefined;
}
export class ModelContextBudgetError extends Error {
    constructor(readonly code: ModelContextFailureCode, message: string, readonly budget?: ModelContextBudget) {
        super(`${code}: ${message}`);
        this.name = 'ModelContextBudgetError';
    }
}

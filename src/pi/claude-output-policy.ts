/** Owned response policy, not the upstream model's intrinsic output capacity. */
export const OWNED_CLAUDE_OUTPUT_TOKENS = 32000;

export function ownedClaudeOutputLimit(modelMaximum: unknown): number {
    if (typeof modelMaximum !== 'number' || !Number.isSafeInteger(modelMaximum) || modelMaximum < 1)
        throw Error('BRIDGE_HOST_OUTPUT_LIMIT_UNAVAILABLE');
    return Math.min(modelMaximum, OWNED_CLAUDE_OUTPUT_TOKENS);
}

/** Apply only the owned policy field; preserve the SDK's other launch operands. */
export function ownedClaudeOutputEnvironment(environment: Readonly<NodeJS.ProcessEnv>, limit: number): NodeJS.ProcessEnv {
    if (ownedClaudeOutputLimit(limit) !== limit) throw Error('BRIDGE_HOST_OUTPUT_LIMIT_UNAVAILABLE');
    return { ...environment, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(limit) };
}

/** Contradictory served metadata refuses success; absent metrics prove nothing. */
export function assertOwnedClaudeOutputCapacity(message: unknown, limit: number): void {
    const result = message as { type?: string; modelUsage?: Record<string, { maxOutputTokens?: unknown }> };
    if (result?.type !== 'result' || !result.modelUsage) return;
    for (const usage of Object.values(result.modelUsage)) {
        const maximum = usage?.maxOutputTokens;
        if (maximum === undefined) continue;
        if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > limit)
            throw Error('BRIDGE_HOST_OUTPUT_LIMIT_MISMATCH');
    }
}

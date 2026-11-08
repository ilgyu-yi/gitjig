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

/** Observe individual root responses, never model capacity or query totals.
 * Native modelUsage.maxOutputTokens reports a model default, not our request
 * limit. Assistant envelopes may repeat a message's provisional usage; do not
 * sum them. Absent observations do not prove that the native cap was enforced. */
export function assertOwnedClaudeResponseOutput(message: unknown, limit: number): void {
    const envelope = message as { type?: string; parent_tool_use_id?: unknown;
        message?: { usage?: { output_tokens?: unknown } };
        event?: { type?: string; usage?: { output_tokens?: unknown } } } | null;
    if (!envelope || envelope.parent_tool_use_id != null) return;
    const count = envelope.type === 'assistant' ? envelope.message?.usage?.output_tokens :
        envelope.type === 'stream_event' && envelope.event?.type === 'message_delta' ? envelope.event.usage?.output_tokens : undefined;
    if (count !== undefined && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > limit))
        throw Error('BRIDGE_HOST_OUTPUT_LIMIT_MISMATCH');
}

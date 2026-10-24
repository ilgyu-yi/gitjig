import type { SessionEntry } from '@earendil-works/pi-coding-agent';
/** Recorded native-file totals, including abandoned branches and copied seeds.
 * Matches Pi 1.3.0 AgentSession.getSessionStats' entry categories, not its private
 * reducer implementation. No context estimate or billing inference is made.
 */
export function recordedSessionUsage(entries: readonly SessionEntry[]) {
    const counts = { userMessages: 0, assistantMessages: 0, toolResults: 0, totalMessages: 0, toolCalls: 0 };
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let records = 0, cost = 0, validTokens = true, validCost = true;
    const add = (value: unknown) => {
        records++;
        const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
            const n = usage[key];
            if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(tokens[key] + n))
                validTokens = false;
            else
                tokens[key] += n;
        }
        const recordedCost = usage.cost && typeof usage.cost === 'object' ? (usage.cost as Record<string, unknown>).total : undefined;
        if (typeof recordedCost !== 'number' || !Number.isFinite(recordedCost) || recordedCost < 0 || !Number.isFinite(cost + recordedCost))
            validCost = false;
        else
            cost += recordedCost;
    };
    for (const entry of entries) {
        if (entry.type === 'usage')
            add(entry.usage);
        else if ((entry.type === 'branch_summary' || entry.type === 'compaction') && entry.usage !== undefined)
            add(entry.usage);
        if (entry.type !== 'message')
            continue;
        counts.totalMessages++;
        const message = entry.message;
        if (message.role === 'user')
            counts.userMessages++;
        else if (message.role === 'toolResult') {
            counts.toolResults++;
            if (message.usage !== undefined)
                add(message.usage);
        }
        else if (message.role === 'assistant') {
            counts.assistantMessages++;
            if (Array.isArray(message.content))
                counts.toolCalls += message.content.filter(part => part?.type === 'toolCall').length;
            add(message.usage);
        }
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (!Number.isSafeInteger(tokens.total))
        validTokens = false;
    return { ...counts, records, tokens: records && validTokens ? tokens : undefined, cost: records && validCost ? cost : undefined,
        invalidTokens: !validTokens, invalidCost: !validCost };
}

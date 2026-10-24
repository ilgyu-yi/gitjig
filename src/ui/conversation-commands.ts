import type { AgentSession } from '@earendil-works/pi-coding-agent';
type AgentMessage = AgentSession['messages'][number];
import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandOutcome } from './host-commands.js';
import { recordedSessionUsage } from './session-usage.js';
/** The same last-assistant convention as Pi's public live session helper. */
export function lastAssistantText(messages: readonly AgentMessage[]): string | undefined {
    const message = [...messages].reverse().find(value => value.role === 'assistant' && !(value.stopReason === 'aborted' && value.content.length === 0));
    if (!message || message.role !== 'assistant')
        return undefined;
    return message.content.filter(value => value.type === 'text').map(value => value.text).join('').trim() || undefined;
}
interface ConversationCommands {
    controller: Controller;
    resume(id?: string): Promise<HostCommandOutcome>;
    fork(kind: 'fork' | 'clone', target: string): Promise<HostCommandOutcome>;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    copy(text: string): Promise<void>;
    notice(text: string): void;
}
export function conversationCommands(host: ConversationCommands): HostCommand[] {
    const { controller } = host;
    return [
        { name: 'resume', description: 'Select an existing conversation without retrying work', argumentHint: '[conversation-id]', run: async (argument) => host.resume(argument || undefined) },
        { name: 'fork', description: 'Create a conversation from a selected history point', run: async (_argument, target) => host.fork('fork', target) },
        { name: 'clone', description: 'Create a conversation from the current context', run: async (_argument, target) => host.fork('clone', target) },
        { name: 'name', description: 'Set this conversation display name', argumentHint: '[name | --reset]', run: async (argument, target) => {
                const view = controller.inspectConversation(target);
                const value = argument === '--reset' ? null : argument || await host.input('Conversation display name · 1..120 UTF-16 code units', view.userLabel ?? '');
                if (value === undefined)
                    return 'cancelled';
                controller.setConversationName({ conversationId: target, expectedGeneration: view.generation, name: value });
                host.notice(value === null ? 'Conversation name reset; role and history kept' : 'Conversation name saved; role and history kept');
            } },
        { name: 'session', description: 'Inspect this conversation and native session identity', run: async (_argument, target) => {
                const view = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target), live = controller.getNativeHandle(target);
                const history = await controller.getConversationHistory(target), current = controller.inspectConversation(target);
                if (current.generation !== view.generation || current.historyRef !== view.historyRef || current.nativeSessionId !== view.nativeSessionId ||
                    current.projectId !== view.projectId || current.deleted || current.archived ||
                    controller.getConversationModelChoice(target).revision !== choice.revision || controller.getNativeHandle(target) !== live)
                    throw new Error('Conversation history or model changed during session inspection; retry for the intended target');
                const rows = [`Conversation · ${view.conversationId}`, `Generation · ${view.generation}`, `Name · ${view.userLabel ?? 'derived label'}`, `Role · ${view.role ?? 'none'}`,
                    `State · ${view.state}`, `Project · ${view.projectId ?? 'none'}`, `Parent · ${view.parentId ?? 'none'}`, `Native session · ${view.nativeSessionId ?? 'not created'}`,
                    `History · ${view.historyRef ? 'available' : 'not created'}`, `Input needed · ${view.inputNeeded ? 'yes' : 'no'}`,
                    `Model · ${choice.kind === 'unbound' ? 'not selected' : `${choice.provider}/${choice.modelId}${choice.kind === 'managed' ? ' · ' + choice.thinkingLevel : ' · external'}`}`];
                rows.push(...controller.inspectConversationContext({ conversationId: target, expectedGeneration: view.generation }).rows);
                if (history) {
                    const stats = recordedSessionUsage(history.sessionManager.getEntries());
                    rows.push('Usage scope · native-file history, including copied context; not new conversation spend or billing', `Messages · ${stats.totalMessages} total · ${stats.userMessages} user · ${stats.assistantMessages} assistant · ${stats.toolResults} tool results · ${stats.toolCalls} tool calls`, stats.tokens ? `Recorded tokens · ${stats.tokens.total} total · ${stats.tokens.input} input · ${stats.tokens.output} output · ${stats.tokens.cacheRead} cache read · ${stats.tokens.cacheWrite} cache write` :
                        `Recorded tokens · unavailable (${stats.invalidTokens ? 'invalid usage record' : 'no usage records'})`, stats.cost !== undefined ? `Recorded cost · ${stats.cost}` : `Recorded cost · unavailable (${stats.invalidCost ? 'invalid usage record' : 'no usage records'})`);
                }
                else
                    rows.push('Recorded usage · unavailable (no native history)');
                if (live) {
                    const context = live.session.getContextUsage();
                    rows.push(`Live context estimate · ${context?.tokens ?? 'unavailable'} / ${context?.contextWindow ?? 'unavailable'}`);
                }
                else
                    rows.push('Current context · unavailable without a live measurement');
                if (!await host.choose('Gitjig session · inspection only', rows))
                    return 'cancelled';
                host.notice('Session information closed');
            } },
        { name: 'copy', description: 'Copy this conversation’s last assistant text', run: async (_argument, target) => {
                const before = controller.inspectConversation(target), history = await controller.getConversationHistory(target);
                const current = controller.inspectConversation(target);
                if (current.generation !== before.generation || current.historyRef !== before.historyRef || current.nativeSessionId !== before.nativeSessionId || current.deleted || current.archived)
                    throw new Error('Conversation history changed during copy; retry for the intended target');
                if (!history)
                    throw new Error('No assistant text to copy; this conversation has no native history');
                const text = lastAssistantText(history.sessionManager.buildSessionProjection().messages);
                if (!text)
                    throw new Error('No assistant text to copy in the current branch');
                if (Buffer.byteLength(text, 'utf8') > 1024 * 1024)
                    throw new Error('Assistant text exceeds the 1MiB clipboard limit');
                await host.copy(text);
                host.notice('Last assistant text copied');
            } },
    ];
}

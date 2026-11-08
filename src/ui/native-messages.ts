import type { AgentSession } from '@earendil-works/pi-coding-agent';
type AgentMessage = AgentSession['messages'][number];
import { UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent, BashExecutionComponent, CustomMessageComponent, BranchSummaryMessageComponent, CompactionSummaryMessageComponent, } from '@earendil-works/pi-coding-agent';
import { Container, Text, type TUI } from '@earendil-works/pi-tui';
/** Mount native message components from actual native state; no stored transcript. */
export function nativeMessageGroups(messages: readonly AgentMessage[], tui: TUI, cwd: string, expanded = false, hideThinking = false,
    userText?: (message: Extract<AgentMessage, { role: 'user' }>) => string | {hostText: string} | undefined,
    customText?: (message: Extract<AgentMessage, { role: 'custom' }>) => string | undefined,
    assistantLabel?: string): {
    content: Container;
    groups: Container[];
} {
    const content = new Container();
    const groups: Container[] = [];
    const calls = new Map<string, ToolExecutionComponent[]>();
    for (const message of messages) {
        const group = new Container();
        groups.push(group);
        content.addChild(group);
        switch (message.role) {
            case 'system':
                // Runtime instructions remain in native context/history, outside the conversation display.
                break;
            case 'user': {
                const text = userText?.(message) ?? (typeof message.content === 'string' ? message.content : message.content.map(c => c.type === 'text' ? c.text : '[Image input unavailable in this profile]').join('\n'));
                group.addChild(typeof text === 'string' ? new UserMessageComponent(text) : new Text(text.hostText, 0, 0));
                break;
            }
            case 'assistant': {
                if (assistantLabel && message.content.some(block => block.type === 'text' && block.text.trim()))
                    group.addChild(new Text(assistantLabel, 0, 0));
                group.addChild(new AssistantMessageComponent(message, hideThinking));
                for (const call of message.content)
                    if (call.type === 'toolCall') {
                        const component = new ToolExecutionComponent(call.name, call.id, call.arguments, { showImages: false }, undefined, tui, cwd);
                        component.setArgsComplete();
                        component.setExpanded(expanded);
                        group.addChild(component);
                        const matching = calls.get(call.id) ?? [];
                        matching.push(component);
                        calls.set(call.id, matching);
                    }
                break;
            }
            case 'toolResult': {
                // Rendering repeated IDs is separate from proof joins. Match only an
                // actual preceding call; no host execution or semantic certification.
                const component = calls.get(message.toolCallId)?.shift();
                if (component)
                    component.updateResult({ content: message.content, isError: message.isError });
                else
                    group.addChild(new Text(`Unmatched native tool result ${message.toolCallId}`, 0, 0));
                break;
            }
            case 'bashExecution': {
                const component = new BashExecutionComponent(message.command, tui, message.excludeFromContext);
                component.appendOutput(message.output);
                component.setComplete(message.exitCode, message.cancelled, undefined, message.fullOutputPath);
                component.setExpanded(expanded);
                group.addChild(component);
                break;
            }
            case 'custom':
                if (message.display) {
                    const text = customText?.(message);
                    group.addChild(text === undefined ? new CustomMessageComponent(message) : new Text(text, 0, 0));
                }
                break;
            case 'branchSummary':
                group.addChild(new BranchSummaryMessageComponent(message));
                break;
            case 'compactionSummary':
                group.addChild(new CompactionSummaryMessageComponent(message));
                break;
            default: group.addChild(new Text('Native message type unavailable in this presentation profile', 0, 0));
        }
    }
    return { content, groups };
}
export function nativeMessages(messages: readonly AgentMessage[], tui: TUI, cwd: string, expanded = false): Container { return nativeMessageGroups(messages, tui, cwd, expanded).content; }

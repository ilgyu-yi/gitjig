import type { Controller } from '../controller/controller.js';
import type { HostCommandOutcome } from './host-commands.js';
type History = NonNullable<Awaited<ReturnType<Controller['getConversationHistory']>>>;
interface ForkHost {
    controller: Controller;
    isCurrent(): boolean;
    chooseEntry(history: History): Promise<string | undefined>;
    activate(id: string): Promise<void>;
    notice(text: string): void;
}
/** Target and desired choice are captured before any dialog or controller await. */
export async function forkCommand(host: ForkHost, kind: 'fork' | 'clone', target: string): Promise<HostCommandOutcome> {
    const { controller } = host, before = controller.inspectConversation(target), choice = controller.getConversationModelChoice(target);
    const current = () => {
        if (!host.isCurrent())
            throw new Error('Fork source pane changed; return to the intended conversation');
        const view = controller.inspectConversation(target);
        if (view.generation !== before.generation || view.historyRef !== before.historyRef || view.nativeSessionId !== before.nativeSessionId ||
            view.archived || view.deleted || controller.getConversationModelChoice(target).revision !== choice.revision)
            throw new Error('Fork source history or model changed; reopen the command');
    };
    current();
    let entryId: string | undefined;
    if (kind === 'fork') {
        const history = await controller.getConversationHistory(target);
        current();
        if (!history)
            throw new Error('Fork requires native history; use /clone for an empty conversation');
        entryId = await host.chooseEntry(history);
        if (!entryId)
            return 'cancelled';
        current();
    }
    const input = { conversationId: target, expectedGeneration: before.generation, expectedModelRevision: choice.revision };
    const created = await controller.forkConversation(kind === 'fork' ? { ...input, kind, entryId: entryId! } : { ...input, kind });
    if (!host.isCurrent()) {
        host.notice(`Created conversation ${created.conversationId}; open it with /resume ${created.conversationId}`);
        return 'completed';
    }
    try {
        await host.activate(created.conversationId);
        host.notice(`Created ${kind} · ${created.conversationId}`);
        return 'completed';
    }
    catch (error) {
        const message = `Created conversation ${created.conversationId}; opening failed. Use /resume ${created.conversationId}`;
        host.notice(message);
        throw new Error(message, { cause: error });
    }
}

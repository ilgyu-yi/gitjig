import type { Controller } from '../controller/controller.js';
interface NewConversationHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    ready(): boolean;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    create(projectId: string | null, validate: () => void): Promise<{
        conversationId: string;
    }>;
    activate(id: string): Promise<void>;
    notice(text: string): void;
}
/** Explicit independent owner context; no history, parentage or work is copied. */
export async function newConversationAction(host: NewConversationHost, argument: string, target: string): Promise<'completed' | 'cancelled'> {
    if (!host.ready())
        return 'cancelled';
    if (argument && !['project', 'root'].includes(argument))
        throw Error('Use /new, /new project or /new root');
    const source = host.controller.inspectConversation(target), model = host.controller.getConversationModelChoice(target);
    const current = () => {
        const now = host.controller.inspectConversation(target);
        if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || host.controller.getConversationModelChoice(target).revision !== model.revision)
            throw Error('New-conversation source changed; reopen /new');
    };
    current();
    let projectId: string | null = null;
    if (argument === 'project') {
        if (!source.projectId)
            throw Error('Select a project with /project before /new project');
        projectId = source.projectId;
    }
    else if (!argument && source.projectId) {
        const project = 'Current project · ' + source.projectId + ' · saved project model defaults', root = 'Unbound control conversation · saved application model defaults';
        const selected = await host.choose('New independent conversation · choose scope', [project, root, 'Cancel']);
        current();
        if (!selected || selected === 'Cancel')
            return 'cancelled';
        if (selected !== project && selected !== root)
            throw Error('Unknown new-conversation scope');
        projectId = selected === project ? source.projectId : null;
    }
    current();
    const created = await host.create(projectId, current);
    try {
        current();
        await host.activate(created.conversationId);
    }
    catch (error) {
        const message = 'Conversation ' + created.conversationId + ' was created; use /resume ' + created.conversationId + ' rather than create it again. ' + String(error);
        throw Object.assign(new Error(message), { code: 'CONVERSATION_CREATED', recovery: 'Open the retained conversation with /resume ' + created.conversationId });
    }
    host.notice('Independent conversation opened · ' + (projectId ?? 'unbound') + ' · saved defaults; original work remains retained');
    return 'completed';
}

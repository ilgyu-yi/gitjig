import type { Controller } from '../controller/controller.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
export interface IndependentProjectTarget {
    readonly id: string;
    readonly sourceRoot: string;
}
export type NewConversationScope = string | { project: IndependentProjectTarget; validateSource: () => void };
export interface RetainedIndependentConversation {
    readonly sourceConversationId: string;
    readonly conversationId: string;
    readonly projectId: string | null;
}
export class IndependentConversationCreated extends Error {
    constructor(message: string, readonly recovery: string, readonly created: RetainedIndependentConversation) {
        super(message);
    }
    readonly code = 'CONVERSATION_CREATED';
}
interface NewConversationHost extends UiChoiceHost {
    hostLanguage?: string;
    controller: Controller;
    isCurrent(target: string): boolean;
    ready(): boolean;
    create(projectId: string | null, validate: () => void): Promise<{
        conversationId: string;
    }>;
    activate(id: string): Promise<void>;
    notice(text: string, wrap?: boolean): void;
}
/** Explicit independent owner context; no history, parentage or work is copied. */
export async function newConversationAction(host: NewConversationHost, scope: NewConversationScope, target: string): Promise<'completed' | 'cancelled'> {
    if (!host.ready())
        return 'cancelled';
    const source = host.controller.inspectConversation(target), model = host.controller.getConversationModelChoice(target), language = host.controller.getConversationLanguage(target);
    const t = translator(resolveUiLanguage(language.replyLanguage, host.hostLanguage ?? hostUiLanguage()).locale);
    const argument = typeof scope === 'string' ? scope : '';
    if (argument && !['project', 'root'].includes(argument))
        throw Error(t('newConversation.usage'));
    const current = () => {
        const now = host.controller.inspectConversation(target);
        // Independent entry copies no source turns; ordinary response progress
        // does not change the selected scope or the new context's defaults.
        if (!host.isCurrent(target) || now.projectId !== source.projectId || now.archived || now.deleted || host.controller.getConversationLanguage(target).revision !== language.revision || host.controller.getConversationModelChoice(target).revision !== model.revision)
            throw Error(t('newConversation.sourceChanged'));
        if (typeof scope !== 'string') {
            scope.validateSource();
            const { id, sourceRoot } = scope.project;
            if (!host.controller.listProjects().some(p => p.id === id && p.sourceRoot === sourceRoot))
                throw Error(t('project.targetChanged'));
        }
    };
    current();
    let projectId: string | null = null;
    if (typeof scope !== 'string') {
        projectId = scope.project.id;
    }
    else if (argument === 'project') {
        if (!source.projectId)
            throw Error(t('newConversation.projectRequired'));
        projectId = source.projectId;
    }
    else if (!argument && source.projectId) {
        const selected = await chooseUiItem(host, t('newConversation.title'), [
            { value: 'project', label: t('newConversation.project', { project: source.projectId }) },
            { value: 'root', label: t('newConversation.root') },
            { value: 'cancel', label: t('newConversation.cancel') },
        ]);
        current();
        if (!selected || selected === 'cancel')
            return 'cancelled';
        projectId = selected === 'project' ? source.projectId : null;
    }
    current();
    const created = await host.create(projectId, current);
    try {
        current();
        await host.activate(created.conversationId);
        if (!host.isCurrent(created.conversationId))
            throw Error(t('newConversation.activationChanged'));
    }
    catch (error) {
        const message = t('newConversation.createdRecovery', { conversation: created.conversationId }) + ' ' + String(error);
        throw new IndependentConversationCreated(message, t('newConversation.resume', { conversation: created.conversationId }),
            Object.freeze({ sourceConversationId: target, conversationId: created.conversationId, projectId }));
    }
    const opened = t('newConversation.opened', { project: projectId ?? t('newConversation.unbound') });
    if (typeof scope === 'string')
        host.notice(opened);
    else
        host.notice(opened + '\n' + t('newConversation.returnToSource', { conversation: target }), true);
    return 'completed';
}

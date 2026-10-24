import { resolveUiLanguage, hostUiLanguage, uiText } from './i18n.js';
import type { Controller } from '../controller/controller.js';
import type { HostCommand } from './host-commands.js';
interface LanguageHost {
    controller: Controller;
    hostLanguage?: string;
    isCurrent(target: string): boolean;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    notice(text: string): void;
}
export function languageCommands(host: LanguageHost): HostCommand[] {
    const setReplyLanguage: HostCommand['run'] = async (argument, target) => {
        const view = host.controller.inspectConversation(target), language = host.controller.getConversationLanguage(target);
        const guard = () => {
            const now = host.controller.inspectConversation(target);
            if (!host.isCurrent(target) || now.generation !== view.generation || now.projectId !== view.projectId || now.archived || now.deleted)
                throw Error('Reply language target changed; reopen /language');
        };
        guard();
        const ui = resolveUiLanguage(language.replyLanguage, host.hostLanguage ?? hostUiLanguage());
        const value = argument || await host.input(uiText(ui.locale, 'language.title', { language: language.diagnostic ?? language.replyLanguage ?? 'auto' }), language.replyLanguage ?? 'auto', uiText(ui.locale, 'language.description'));
        guard();
        if (value === undefined)
            return 'cancelled';
        const next = host.controller.setConversationLanguage({
            conversationId: target, expectedGeneration: view.generation, expectedRevision: language.revision, replyLanguage: value === 'auto' ? null : value
        }, guard);
        const nextUi = resolveUiLanguage(next.replyLanguage, host.hostLanguage ?? hostUiLanguage());
        host.notice(uiText(nextUi.locale, 'language.notice', { language: next.replyLanguage ?? uiText(nextUi.locale, 'language.auto') }) + '\n' + uiText(nextUi.locale, 'language.interface', { locale: nextUi.locale, source: uiText(nextUi.locale, `language.source.${nextUi.source}`), requested: nextUi.requested }));
        return 'completed';
    };
    return [{
            name: 'language', description: 'Inspect or save this conversation reply language; working language stays English', argumentHint: '[auto|language tag]', run: setReplyLanguage
        }];
}

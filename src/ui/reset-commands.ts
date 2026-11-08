import type { ResetScope, ResetDisposition } from '../app/reset.js';
import type { Controller } from '../controller/controller.js';
import type { HostCommand } from './host-commands.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import { showReviewAction, type ReviewPageHost } from './exact-review.js';
export type ResetHandoff =
    | { action: 'reset'; scope: ResetScope; disposition: ResetDisposition }
    | { action: 'backups' };
interface ResetHost extends UiChoiceHost, ReviewPageHost {
    controller: Controller;
    locale(target: string): UiLocale;
    isCurrent(target: string): boolean;
    request(handoff: ResetHandoff, locale: UiLocale): boolean;
}
/** Closing is only a handoff: the CLI obtains final consent over a fresh, locked preview. */
export function resetCommands(host: ResetHost): HostCommand[] {
    return [{ name: 'reset', descriptionId: 'command.description.reset', run: async (_argument, target) => {
                const source = host.controller.inspectConversation(target);
                const language = host.controller.getConversationLanguage(target);
                const locale = host.locale(target), t = translator(locale);
                const current = () => {
                    const now = host.controller.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || host.controller.getConversationLanguage(target).revision !== language.revision)
                        throw Error(t('reset.stale'));
                };
                current();
                const scope = await chooseUiItem<'back' | 'backups' | ResetScope>(host, t('reset.title'), [
                    { value: 'back', label: t('reset.back') },
                    { value: 'settings', label: t('reset.settings') },
                    { value: 'all', label: t('reset.all') },
                    { value: 'backups', label: t('reset.manageBackups') },
                ]);
                current();
                if (!scope || scope === 'back')
                    return 'cancelled';
                if (scope === 'backups') {
                    const choice = await chooseUiItem(host, t('reset.backupsCloseTitle'), [
                        { value: 'back', label: t('reset.back') },
                        { value: 'close', label: t('reset.backupsClose') },
                    ]);
                    current();
                    return choice === 'close' && host.request({ action: 'backups' }, locale) ? 'completed' : 'cancelled';
                }
                const disposition = await chooseUiItem<'back' | ResetDisposition>(host, t('reset.policyTitle'), [
                    { value: 'back', label: t('reset.back') },
                    { value: 'backup', label: t('reset.backup') },
                    { value: 'delete', label: t('reset.delete') },
                ]);
                current();
                if (!disposition || disposition === 'back')
                    return 'cancelled';
                const advance = await showReviewAction(host, t('reset.review'), t('reset.body', {
                    home: host.controller.applicationHome(),
                    scope: t(scope === 'all' ? 'reset.all' : 'reset.settings'),
                    policy: t(disposition === 'backup' ? 'reset.backupPolicy' : 'reset.deletePolicy'),
                }), t('reset.openShutdown'));
                current();
                if (!advance)
                    return 'cancelled';
                const choice = await chooseUiItem(host, t('reset.closeTitle'), [
                    { value: 'back', label: t('reset.back') },
                    { value: 'close', label: t('reset.close') },
                ]);
                current();
                if (choice !== 'close')
                    return 'cancelled';
                return host.request({ action: 'reset', scope, disposition }, locale) ? 'completed' : 'cancelled';
            } }];
}

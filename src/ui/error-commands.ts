import type { Controller } from '../controller/controller.js';
import type { FailurePresentation } from './failure-details.js';
import type { HostCommand, HostCommandExecutor } from './host-commands.js';
import { inspectQueuedTaskRecovery, recoverQueuedTask } from './queued-assignment-recovery.js';
import { hostUiLanguage, resolveUiLanguage, translator, type UiLocale } from './i18n.js';
interface ErrorHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    assertAvailable(): void;
    failure(target: string): FailurePresentation | null;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    showDetails(detail: string, locale: UiLocale): Promise<void>;
    notice(text: string): void;
    execute: HostCommandExecutor;
}
/** Original facts select existing recovery controls; this command never invents a remedy. */
export function errorCommands(host: ErrorHost): HostCommand[] {
    return [{ name: 'error', description: 'Inspect the last error or choose setup and retained-request recovery', run: async (_argument, target, context) => {
                host.assertAvailable();
                const failure = host.failure(target), detail = failure?.detail;
                const view = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target);
                const language = host.controller.getConversationLanguage(target);
                const locale = resolveUiLanguage(language.replyLanguage, hostUiLanguage()).locale, t = translator(locale);
                const current = () => {
                    const now = host.controller.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== view.generation || now.projectId !== view.projectId || now.workId !== view.workId || now.archived || now.deleted || host.controller.getConversationModelChoice(target).revision !== choice.revision || host.controller.getConversationLanguage(target).revision !== language.revision || host.failure(target) !== failure)
                        throw Error(t('error.sourceChanged'));
                };
                const pending = host.controller.inspectConversationInputs(target);
                const ids = [...new Set([failure?.workId, view.workId, ...pending.flatMap(input => input.blockingWorkIds)].filter((id): id is string => !!id))];
                const works = new Map<string, number>();
                for (const id of ids) {
                    try {
                        works.set(id, host.controller.inspectWork(id).epoch);
                    }
                    catch { /* Unavailable identity still has all-work discovery below. */ }
                }
                const goal = host.controller.conversationGoal(target);
                const queued = inspectQueuedTaskRecovery(host.controller, target, view.generation);
                const details = t('error.details'), back = t('error.back');
                const queuedRoutes = new Map(queued.map(entry => [t(entry.review ? 'queuedTask.entry' : 'queuedTask.unavailable', { id: entry.assignmentId }), entry]));
                current();
                if (!detail && !pending.length && !works.size && !goal && !queued.length) {
                    host.notice(t('error.empty'));
                    return;
                }
                const routes = new Map<string, string>([
                    [t('error.ready'), '/ready'],
                    ...(pending.length ? [[t('error.inputs'), '/inputs'] as [
                            string,
                            string
                        ]] : []),
                    ...[...works.keys()].map(id => [t('error.work', { id }), '/work ' + id] as [
                        string,
                        string
                    ]),
                    [t('error.allWork'), '/work'],
                    ...(goal ? [[t('error.goal'), '/goal'] as [
                            string,
                            string
                        ]] : []),
                ]);
                const action = await host.choose(t('error.title'), [
                    ...(detail ? [details] : []), ...queuedRoutes.keys(), ...routes.keys(), back,
                ]);
                current();
                if (!action || action === back)
                    return 'cancelled';
                const queuedEntry = queuedRoutes.get(action);
                if (queuedEntry)
                    return recoverQueuedTask({ controller: host.controller, locale, guard: current, choose: host.choose,
                        show: (title, text) => host.showDetails(title + '\n\n' + text, locale), notice: host.notice,
                    }, queuedEntry);
                if (action === details && detail) {
                    await host.showDetails(detail, locale);
                    current();
                    return 'completed';
                }
                const command = routes.get(action);
                if (!command)
                    throw Error(t('error.unknownAction'));
                for (const [id, epoch] of works)
                    if (command === '/work ' + id && host.controller.inspectWork(id).epoch !== epoch)
                        throw Error(t('error.workChanged'));
                if (command === '/goal' && host.controller.conversationGoal(target)?.revision !== goal?.revision)
                    throw Error(t('error.goalChanged'));
                return host.execute(command, target, context);
            } }];
}

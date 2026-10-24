import type { Controller } from '../controller/controller.js';
import type { FailurePresentation } from './failure-details.js';
import type { HostCommand, HostCommandExecutor } from './host-commands.js';
import { inspectQueuedTaskRecovery, recoverQueuedTask } from './queued-assignment-recovery.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
interface ErrorHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    assertAvailable(): void;
    failure(target: string): FailurePresentation | null;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    showDetails(detail: string): Promise<void>;
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
                        throw Error('Error source changed; reopen /error for the current conversation');
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
                const queuedRoutes = new Map(queued.map(entry => [t(entry.review ? 'queuedTask.entry' : 'queuedTask.unavailable', { id: entry.assignmentId }), entry]));
                if (!detail && !pending.length && !works.size && !goal && !queued.length) {
                    host.notice('No retained error details for this conversation · /ready for setup and next actions');
                    return;
                }
                current();
                const routes = new Map<string, string>([
                    ['Open setup and readiness', '/ready'],
                    ...(pending.length ? [['Review retained sent requests', '/inputs'] as [
                            string,
                            string
                        ]] : []),
                    ...[...works.keys()].map(id => ['Open original work recovery · /work ' + id, '/work ' + id] as [
                        string,
                        string
                    ]),
                    ['Find original work and allowances · /work', '/work'],
                    ...(goal ? [['Open goal recovery · /goal', '/goal'] as [
                            string,
                            string
                        ]] : []),
                ]);
                const action = await host.choose('Error recovery · choose a next step', [
                    ...(detail ? ['Error details · inspect'] : []), ...queuedRoutes.keys(), ...routes.keys(), 'Back to conversation',
                ]);
                current();
                if (!action || action === 'Back to conversation')
                    return 'cancelled';
                const queuedEntry = queuedRoutes.get(action);
                if (queuedEntry)
                    return recoverQueuedTask({ controller: host.controller, locale, guard: current, choose: host.choose,
                        show: (title, text) => host.showDetails(title + '\n\n' + text), notice: host.notice,
                    }, queuedEntry);
                if (action === 'Error details · inspect' && detail) {
                    await host.showDetails(detail);
                    current();
                    return 'completed';
                }
                const command = routes.get(action);
                if (!command)
                    throw Error('Unknown error recovery action');
                for (const [id, epoch] of works)
                    if (command === '/work ' + id && host.controller.inspectWork(id).epoch !== epoch)
                        throw Error('Original error work changed; reopen /error');
                if (command === '/goal' && host.controller.conversationGoal(target)?.revision !== goal?.revision)
                    throw Error('Original goal changed; reopen /error');
                return host.execute(command, target, context);
            } }];
}

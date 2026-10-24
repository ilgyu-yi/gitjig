import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
import { basename, isAbsolute } from 'node:path';
import type { Controller } from '../controller/controller.js';
import type { HostCommand } from './host-commands.js';
interface ProjectHost extends UiChoiceHost {
    controller: Controller;
    hostLanguage?: string;
    initialDirectory?: string | undefined;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show?(title: string, text: string): Promise<void>;
    isCurrent(target: string): boolean;
    refresh(target: string): Promise<void>;
    notice(text: string): void;
}
/** Human project selection uses the same scope transition as the public CLI. */
export function projectCommands(host: ProjectHost): HostCommand[] {
    const { controller } = host;
    return [{ name: 'project', description: 'Select or register the project for this conversation', argumentHint: '[project-id]', run: async (argument, target) => {
                const before = controller.inspectConversation(target), language = controller.getConversationLanguage(target);
                const t = translator(resolveUiLanguage(language.replyLanguage, host.hostLanguage ?? hostUiLanguage()).locale);
                const assertCurrent = () => {
                    const now = controller.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== before.generation || now.projectId !== before.projectId || controller.getConversationLanguage(target).revision !== language.revision || now.deleted || now.archived)
                        throw Error('Project selection target changed; return to the intended conversation and reopen /project');
                };
                assertCurrent();
                const projects = controller.listProjects();
                const register = t('project.register');
                const labels = projects.map(p => `${p.id} · ${p.sourceRoot}${p.id === before.projectId ? t('project.current') : ''}`);
                const items = [
                    ...projects.map((project, index) => ({ value: 'project:' + project.id, label: labels[index]! })),
                    { value: 'register', label: register },
                ];
                const selected = argument ? 'project:' + argument : await chooseUiItem(host, t('project.title', { project: before.projectId ?? t('value.none') }), items);
                if (!selected)
                    return 'cancelled';
                assertCurrent();
                let projectId = selected.startsWith('project:') ? selected.slice('project:'.length) : undefined;
                if (selected === 'register') {
                    let root = await host.input(t('project.directory'), host.initialDirectory ?? '', t('project.directoryHelp'));
                    if (root === undefined)
                        return 'cancelled';
                    assertCurrent();
                    const base = basename(root).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'project';
                    let suggested = base, suffix = 2;
                    while (projects.some(p => p.id === suggested))
                        suggested = `${base}-${suffix++}`;
                    let id = await host.input(t('project.id'), suggested, t('project.idHelp'));
                    if (id === undefined)
                        return 'cancelled';
                    assertCurrent();
                    while (true) {
                        let failure = '', registered: Awaited<ReturnType<Controller['registerProject']>> | undefined;
                        try {
                            assertCurrent();
                            if (!isAbsolute(root))
                                throw Error('Enter an absolute project directory; no project was registered');
                            registered = await controller.registerProject({ id, sourceRoot: root });
                        }
                        catch (error) {
                            assertCurrent();
                            failure = error instanceof Error ? error.message : String(error);
                            const recovery = (error as { recovery?: unknown } | null)?.recovery;
                            if (typeof recovery === 'string' && recovery)
                                failure += '\n\n' + recovery;
                        }
                        assertCurrent();
                        if (registered) {
                            projectId = registered.id;
                            host.notice(t('project.registered', { id: projectId, path: registered.sourceRoot }));
                            break;
                        }
                        if (host.show) {
                            await host.show(t('project.registrationFailed'), failure);
                            assertCurrent();
                        }
                        while (true) {
                            const action = await chooseUiItem(host, t('project.registrationFailed') + (host.show ? '' : '\n' + failure), [
                                { value: 'directory', label: t('project.editDirectory') },
                                { value: 'id', label: t('project.editId') },
                                { value: 'retry', label: t('project.retryRegistration') },
                                { value: 'cancel', label: t('project.cancelRegistration') },
                            ]);
                            assertCurrent();
                            if (!action || action === 'cancel')
                                return 'cancelled';
                            if (action === 'retry')
                                break;
                            if (action === 'directory') {
                                const value = await host.input(t('project.directory'), root, t('project.directoryHelp'));
                                assertCurrent();
                                if (value !== undefined)
                                    root = value;
                            }
                            else if (action === 'id') {
                                const value = await host.input(t('project.id'), id, t('project.idHelp'));
                                assertCurrent();
                                if (value !== undefined)
                                    id = value;
                            }
                        }
                    }
                }
                if (!projectId || !controller.listProjects().some(p => p.id === projectId))
                    throw Error('Unknown registered project; open /project to select or register one');
                if (projectId === before.projectId) {
                    host.notice(t('project.already', { id: projectId }));
                    return;
                }
                try {
                    await controller.reclaimConversationResource({ conversationId: target, expectedGeneration: before.generation });
                    assertCurrent();
                    controller.setConversationProject({ conversationId: target, projectId, expectedGeneration: before.generation });
                } catch (error) {
                    assertCurrent();
                    if (!(error instanceof Error) || !/^(LIFECYCLE_HELD:|PROJECT_SCOPE_UNAVAILABLE:)/u.test(error.message)) throw error;
                    const pending = controller.inspectConversationProjectDependencies({ conversationId: target, expectedGeneration: before.generation });
                    if (!pending.items.length) {
                        const current = controller.inspectConversation(target);
                        if (current.state !== 'WAITING') throw error;
                        throw Object.assign(new Error(t('project.authorizedWait')), {
                            code: 'PROJECT_CONTINUATION_PENDING', ...(current.workId ? { workId: current.workId } : {}),
                            recovery: t('project.authorizedWaitRecovery') + '\n' + String(error),
                        });
                    }
                    const blocker = pending.items[0]!;
                    const records = pending.items.map(item => `${item.label} · related conversation ${item.conversationId} · task conversation ${item.taskConversationId} · work ${item.workId ?? 'unavailable'} · ${item.assignmentState ?? 'unavailable'} · assignment ${item.assignmentId ?? 'unavailable'} · dependency ${item.dependencyId ?? 'none'}`);
                    throw Object.assign(new Error(blocker.waitingFor ? t('project.waitingChild', { child: blocker.label }) : t('project.waitedOn', { parent: blocker.label })), {
                        code: 'PROJECT_DEPENDENCY_PENDING',
                        ...(blocker.workId ? { workId: blocker.workId } : {}),
                        recovery: t(blocker.workId ? 'project.waitingRecovery' : 'project.waitingNoWork') + '\n' + records.join('\n') +
                            (pending.more ? '\n' + t('project.moreDependencies') : '') + '\n' + String(error),
                    });
                }
                host.notice(t('project.selected', { id: projectId }));
                if (host.isCurrent(target))
                    await host.refresh(target);
            } }];
}

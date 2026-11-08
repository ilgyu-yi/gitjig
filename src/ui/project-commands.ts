import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { hostUiLanguage, resolveUiLanguage, translator } from './i18n.js';
import { basename, isAbsolute } from 'node:path';
import type { Controller } from '../controller/controller.js';
import { ControllerError, ConversationLifecycleHeld, ManagedConversationOperationActive, type LifecycleEffectHold, type Project } from '../controller/types.js';
import type { HostCommand } from './host-commands.js';
import type { IndependentProjectTarget } from './new-conversation.js';
import { conversationDisplayIdentity } from './chrome.js';
import { quoteIdentity } from './inspection-text.js';
import { observeRecovery } from './recovery-navigation.js';
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
export function isProjectChangeHold(code: string | undefined): boolean {
    return code === 'PROJECT_DEPENDENCY_PENDING' || code === 'PROJECT_CONTINUATION_PENDING' ||
        code === 'PROJECT_WORK_PENDING' || code === 'PROJECT_EXECUTION_UNCERTAIN' || code === 'PROJECT_INPUT_PENDING' ||
        code === 'PROJECT_INPUT_UNCERTAIN' || code === 'PROJECT_GOAL_PENDING' ||
        code === 'PROJECT_RESPONSE_ACTIVE' || code === 'PROJECT_MANAGED_ACTIVE' ||
        code === 'PROJECT_EFFECT_PENDING' || code === 'PROJECT_LIFECYCLE_HELD';
}
type ProjectDependency = ReturnType<Controller['inspectConversationProjectDependencies']>['items'][number];
type ProjectDependencySnapshot = Readonly<Pick<ProjectDependency, 'dependencyId' | 'assignmentId' | 'conversationId' |
    'taskConversationId' | 'waitingFor' | 'workId' | 'assignmentState'>>;
export type ProjectDependencyHold = Readonly<{
    sourceConversationId: string;
    sourceGeneration: number;
    sourceProjectId: string | null;
} & (
    { relationships: readonly ProjectDependencySnapshot[]; originalReasons?: never } |
    { originalReasons: readonly string[]; relationships?: never }
)>;
export const captureProjectDependencies = (items: readonly ProjectDependency[]) => Object.freeze(items.map(
    ({ dependencyId, assignmentId, conversationId, taskConversationId, waitingFor, workId, assignmentState }) =>
        Object.freeze({ dependencyId, assignmentId, conversationId, taskConversationId, waitingFor, workId, assignmentState })));
export function sameProjectDependency(a: ProjectDependencySnapshot, b: ProjectDependencySnapshot): boolean {
    return a.dependencyId === b.dependencyId && a.assignmentId === b.assignmentId && a.conversationId === b.conversationId &&
        a.taskConversationId === b.taskConversationId && a.waitingFor === b.waitingFor;
}
const assignmentStates = ['QUEUED', 'RUNNING', 'WAITING'] as const;
export const projectAssignmentReasons = (id: string | null) => assignmentStates.map(state => 'assignment:' + id + ':' + state);
const assignmentReason = /^assignment:(.+):(?:QUEUED|RUNNING|WAITING)$/u;
const dependencyReasons = (reasons: readonly string[]) => reasons.filter(reason =>
    reason.startsWith('dependency:') || assignmentReason.test(reason));
export type ProjectEffectHold = LifecycleEffectHold & Readonly<{
    sourceConversationId: string;
    sourceGeneration: number;
    sourceProjectId: string | null;
}>;
/** Exact destination of a held host project change. */
export class ProjectChangeHeld extends ControllerError {
    readonly relatedWorkIds: readonly string[] | undefined;
    readonly dependency: ProjectDependencyHold | undefined;
    readonly isOriginalActive: (() => boolean) | undefined;
    readonly effect: ProjectEffectHold | undefined;

    constructor(message: string, readonly projectTarget: IndependentProjectTarget,
        code: string, recovery: string, workId?: string, original: {
            relatedWorkIds?: readonly string[];
            dependency?: ProjectDependencyHold;
            runId?: string | undefined;
            isOriginalActive?: () => boolean;
            effect?: ProjectEffectHold | undefined;
        } = {}) {
        super(code, message, recovery, workId, original.runId);
        this.relatedWorkIds = original.relatedWorkIds;
        this.dependency = original.dependency;
        this.isOriginalActive = original.isOriginalActive;
        this.effect = original.effect;
    }
}
/** Human project selection uses the same scope transition as the public CLI. */
export function projectCommands(host: ProjectHost): HostCommand[] {
    const { controller } = host;
    return [{ name: 'project', descriptionId: 'command.description.project', argumentHint: '[project-id]', run: async (argument, target) => {
                const before = controller.inspectConversation(target), language = controller.getConversationLanguage(target);
                const t = translator(resolveUiLanguage(language.replyLanguage, host.hostLanguage ?? hostUiLanguage()).locale);
                const assertCurrent = () => {
                    const now = controller.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== before.generation || now.projectId !== before.projectId || controller.getConversationLanguage(target).revision !== language.revision || now.deleted || now.archived)
                        throw Error('Project selection target changed; return to the intended conversation and reopen /project');
                };
                const reviewRegistration = async (projects: Project[]): Promise<Project | undefined> => {
                    let root = await host.input(t('project.directory'), host.initialDirectory ?? '', t('project.directoryHelp'));
                    if (root === undefined)
                        return;
                    assertCurrent();
                    const base = basename(root).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'project';
                    let suggested = base, suffix = 2;
                    while (projects.some(p => p.id === suggested))
                        suggested = `${base}-${suffix++}`;
                    let id = await host.input(t('project.id'), suggested, t('project.idHelp'));
                    if (id === undefined)
                        return;
                    assertCurrent();
                    while (true) {
                        let failure = '', registered: Project | undefined;
                        try {
                            assertCurrent();
                            if (!isAbsolute(root))
                                throw Error('Enter an absolute project directory; no project was registered');
                            registered = await controller.registerProject({ id, sourceRoot: root }, assertCurrent);
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
                            host.notice(t('project.registered', { id: registered.id, path: registered.sourceRoot }));
                            return registered;
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
                                return;
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
                };
                let project: Project | undefined;
                while (!project) {
                    assertCurrent();
                    const projects = controller.listProjects();
                    const items = [
                        ...projects.map(p => ({ value: 'project:' + p.id, label: `${p.id} · ${p.sourceRoot}${p.id === before.projectId ? t('project.current') : ''}` })),
                        { value: 'register', label: t('project.register') },
                    ];
                    const selected = argument ? 'project:' + argument : await chooseUiItem(host, t('project.title', { project: before.projectId ?? t('value.none') }), items);
                    if (!selected)
                        return 'cancelled';
                    assertCurrent();
                    if (selected === 'register') {
                        project = await reviewRegistration(projects);
                        if (!project && !host.isCurrent(target))
                            return 'cancelled';
                    }
                    else {
                        project = projects.find(p => 'project:' + p.id === selected);
                        if (!project)
                            throw Error('Unknown registered project; open /project to select or register one');
                    }
                }
                const { id: projectId, sourceRoot } = project;
                const assertRegistered = () => {
                    if (!controller.listProjects().some(p => p.id === projectId && p.sourceRoot === sourceRoot))
                        throw Error(t('project.targetChanged'));
                };
                assertRegistered();
                if (projectId === before.projectId) {
                    host.notice(t('project.already', { id: projectId }));
                    return;
                }
                try {
                    await controller.changeConversationProject({ conversationId: target, projectId, expectedGeneration: before.generation }, assertCurrent);
                } catch (error) {
                    assertCurrent();
                    const destination = { id: projectId, sourceRoot };
                    const guidance = t('project.independentRecovery', { project: projectId });
                    if (error instanceof ControllerError && error.code === 'CONVERSATION_PRODUCER_ACTIVE') {
                        assertRegistered();
                        throw new ProjectChangeHeld(t('project.responseActive'), destination, 'PROJECT_RESPONSE_ACTIVE',
                            t('project.responseActiveRecovery') + '\n' + guidance + '\n' + String(error),
                            error.workId, { runId: error.runId });
                    }
                    if (error instanceof ManagedConversationOperationActive) {
                        assertRegistered();
                        throw new ProjectChangeHeld(t('project.managedActive'), destination, 'PROJECT_MANAGED_ACTIVE',
                            t('project.managedActiveRecovery') + '\n' + guidance + '\n' + String(error),
                            error.workId, { isOriginalActive: error.isOriginalActive });
                    }
                    if (error instanceof ControllerError && error.code === 'PROJECT_GOAL_PENDING')
                        throw new ProjectChangeHeld(t('project.goalPending'), destination, error.code,
                            t('project.goalPendingRecovery') + '\n' + guidance + '\n' + String(error));
                    if (error instanceof ControllerError && error.code === 'NATIVE_INPUT_RECOVERY_REQUIRED') {
                        assertRegistered();
                        throw new ProjectChangeHeld(t('project.inputUncertain'), destination, 'PROJECT_INPUT_UNCERTAIN',
                            t('project.inputUncertainRecovery') + '\n' + guidance + '\n' + String(error));
                    }
                    const prefix = 'LIFECYCLE_HELD: ';
                    if (!(error instanceof Error) || !error.message.startsWith(prefix)) throw error;
                    const reasons = error instanceof ConversationLifecycleHeld ? error.reasons : error.message.slice(prefix.length).split(';');
                    const relatedReasons = dependencyReasons(reasons);
                    const scope = { sourceConversationId: target, sourceGeneration: before.generation, sourceProjectId: before.projectId };
                    let pending: ReturnType<Controller['inspectConversationProjectDependencies']> = { items: [], more: false };
                    if (error instanceof ConversationLifecycleHeld && relatedReasons.length) {
                        try {
                            pending = controller.inspectConversationProjectDependencies({
                                conversationId: target, expectedGeneration: before.generation, lifecycleHolds: relatedReasons, exactRelationshipReasons: true,
                            });
                        } catch {
                            assertCurrent();
                            assertRegistered();
                            const originalReasons = Object.freeze(relatedReasons.flatMap(reason => {
                                const assignment = assignmentReason.exec(reason);
                                return assignment ? projectAssignmentReasons(assignment[1]!) : [reason];
                            }));
                            throw new ProjectChangeHeld(t('project.lifecycleHeld'), destination, 'PROJECT_DEPENDENCY_PENDING',
                                [t('error.projectDependenciesUnavailable'), guidance, String(error)].join('\n'), undefined,
                                { dependency: Object.freeze({ ...scope, originalReasons }) });
                        }
                    }
                    if (!pending.items.length) {
                        const current = controller.inspectConversation(target);
                        if (current.state === 'WAITING' && reasons.includes('authorized continuation/dialog pending')) {
                            const wait = controller.inspectConversationWait(target);
                            if (wait?.settlementUnconfirmed) {
                                throw new ProjectChangeHeld(t('project.workUnknown'), destination, 'PROJECT_WORK_PENDING',
                                    [guidance, t('project.workUnknownRecovery', {work: wait.workId}), String(error)].join('\n'), wait.workId);
                            }
                            throw new ProjectChangeHeld(t('project.continuationPending'), destination, 'PROJECT_CONTINUATION_PENDING',
                                guidance + '\n' + t('project.continuationPendingRecovery') + '\n' + String(error), current.workId ?? undefined);
                        }
                        let workHolds: ReturnType<Controller['inspectConversationProjectWorkHolds']> = [];
                        if (error instanceof ConversationLifecycleHeld && reasons.some(reason => reason.startsWith('governed:'))) {
                            try {
                                workHolds = controller.inspectConversationProjectWorkHolds({
                                    conversationId: target, expectedGeneration: before.generation, refusal: error,
                                });
                            } catch {
                                assertCurrent();
                                assertRegistered();
                                throw new ProjectChangeHeld(t('project.workObservationUnavailable'), destination, 'PROJECT_WORK_PENDING',
                                    [t('project.lifecycleHeldRecovery'), guidance, String(error)].join('\n'));
                            }
                        }
                        const [work, ...related] = workHolds;
                        if (work) {
                            assertRegistered();
                            const detail = t(work.settlementUnconfirmed ? 'project.workUnknownRecovery' : 'project.workPendingRecovery', {work: work.workId});
                            throw new ProjectChangeHeld(t(work.settlementUnconfirmed ? 'project.workUnknown' : 'project.workPending'), destination,
                                'PROJECT_WORK_PENDING', [guidance, detail, String(error)].join('\n'), work.workId,
                                {relatedWorkIds: related.map(hold => hold.workId)});
                        }
                        if (current.state === 'UNKNOWN' && reasons.includes('resource:UNKNOWN')) {
                            assertRegistered();
                            throw new ProjectChangeHeld(t('project.executionUncertain'), destination, 'PROJECT_EXECUTION_UNCERTAIN',
                                t('project.executionUncertainRecovery') + '\n' + guidance + '\n' + String(error));
                        }
                        if (reasons.some(reason => reason.startsWith('input:'))) {
                            const inputs = observeRecovery(() => controller.inspectConversationInputs(target));
                            // The Controller's typed denial still holds when its optional input review is unreadable.
                            const inputHeld = inputs ? inputs.some(input => reasons.includes(`input:${input.inputId}:${input.state}`)) :
                                error instanceof ConversationLifecycleHeld;
                            if (inputHeld) {
                                assertRegistered();
                                const detail = t(inputs ? 'project.inputPendingRecovery' : 'error.inputsUnavailable');
                                throw new ProjectChangeHeld(t('project.inputPending'), destination, 'PROJECT_INPUT_PENDING',
                                    [detail, guidance, String(error)].join('\n'));
                            }
                        }
                        if (error instanceof ConversationLifecycleHeld) {
                            assertRegistered();
                            const effect = reasons.some(reason => reason.startsWith('effect:'));
                            throw new ProjectChangeHeld(t(effect ? 'project.effectPending' : 'project.lifecycleHeld'), destination,
                                effect ? 'PROJECT_EFFECT_PENDING' : 'PROJECT_LIFECYCLE_HELD',
                                t(effect ? 'project.effectPendingRecovery' : 'project.lifecycleHeldRecovery') + '\n' + guidance + '\n' + String(error),
                                undefined, { effect: error.effect && Object.freeze({ ...error.effect, sourceConversationId: target,
                                    sourceGeneration: before.generation, sourceProjectId: before.projectId }) });
                        }
                        throw error;
                    }
                    const blocker = pending.items[0]!;
                    const recordedCompletion = blocker.assignmentState === 'COMPLETE' && !!blocker.dependencyId &&
                        reasons.includes('dependency:' + blocker.dependencyId);
                    const queuedBeforeWork = blocker.assignmentState === 'QUEUED' && blocker.workId === null;
                    const related = conversationDisplayIdentity(blocker);
                    const message = recordedCompletion ? t('project.completionUnconfirmed') : blocker.waitingFor
                        ? t(queuedBeforeWork ? 'project.childQueued' : 'project.waitingChild', { child: related })
                        : t('project.waitedOn', { parent: related });
                    const explanation = t(recordedCompletion ? 'project.completionRecovery' : queuedBeforeWork
                        ? 'project.waitingQueued' : blocker.workId ? 'project.waitingRecovery' : 'project.waitingNoWork');
                    const recorded = (value: string | null) => value === null ? t('value.none') : quoteIdentity(value);
                    const records = pending.items.map(item => t('project.dependencyRecord', {
                        conversation: conversationDisplayIdentity(item), task: recorded(item.taskConversationId),
                        work: recorded(item.workId), state: recorded(item.assignmentState),
                        assignment: recorded(item.assignmentId), dependency: recorded(item.dependencyId),
                    }));
                    const recovery = [explanation, ...records, ...(pending.more ? [t('project.moreDependencies')] : []), guidance, String(error)].join('\n');
                    throw new ProjectChangeHeld(message, destination, 'PROJECT_DEPENDENCY_PENDING', recovery, blocker.workId ?? undefined,
                        { relatedWorkIds: pending.items.flatMap(item => item.workId && item.workId !== blocker.workId ? [item.workId] : []),
                            dependency: Object.freeze({ ...scope, relationships: captureProjectDependencies(pending.items) }) });
                }
                host.notice(t('project.selected', { id: projectId }));
                if (host.isCurrent(target))
                    await host.refresh(target);
            } }];
}

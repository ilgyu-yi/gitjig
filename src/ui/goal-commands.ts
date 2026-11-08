import { goalAllowance, maximumGoalTurns } from '../controller/goal-allowance.js';
import type { Controller } from '../controller/controller.js';
import type { ConversationModelRequest, ConversationTurnResult } from '../controller/interaction-types.js';
import { uiText, translator, type UiLocale } from './i18n.js';
import type { GoalSummary } from '../controller/goal-types.js';
import type { HostCommand, HostCommandOutcome, HostCommandContext } from './host-commands.js';
import { showReviewAction, showReviewText, type ReviewPageHost } from './exact-review.js';
import { quoteText } from './inspection-text.js';
import { plainTerminalText } from './chrome.js';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { observeRecovery } from './recovery-navigation.js';
interface GoalCommandHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    resolve(target: string): Promise<ConversationModelRequest>;
    configureRuntime?(target: string): Promise<boolean>;
    notice(text: string): void;
    show?: ReviewPageHost['show'];
    locale?(target: string): UiLocale;
    work?(target: string, context?: HostCommandContext, workId?: string): Promise<HostCommandOutcome>;
    inputs?(target: string, context?: HostCommandContext): Promise<HostCommandOutcome>;
}
type GoalView = ReturnType<Controller['inspectGoal']>;

function goalActivity(view: GoalView, conversation: ReturnType<Controller['inspectConversation']>) {
    const terminal = ['COMPLETED', 'CANCELLED'].includes(view.state);
    // Dependency continuation can own a live runner without a RUNNING attempt.
    const coordinating = !terminal && (['ACTIVE', 'REVIEWING'].includes(view.state) || view.state === 'WAITING_DEPENDENCY' && !view.externalWait || view.attempts.some(a => a.state === 'RUNNING'));
    const canStart = !terminal && !coordinating && view.startedAttempts < view.turnLimit && !['RUNNING', 'SETTLING', 'UNKNOWN'].includes(conversation.state);
    return { terminal, coordinating, canStart };
}

export function goalCommands(host: GoalCommandHost): HostCommand[] {
    const { controller } = host;
    const definition = async (t: ReturnType<typeof translator>, old?: GoalSummary, initial?: string, guard: () => void = () => { }) => {
        guard();
        const objective = initial || await host.input(t('goal.objectiveInput'), old?.objective ?? '');
        guard();
        if (objective === undefined)
            return;
        const values: string[] = [];
        let index = 0;
        do {
            const criterion = await host.input(t('goal.criterionInput', { index: index + 1 }), old?.criteria[index] ?? '');
            guard();
            if (criterion === undefined)
                return;
            values.push(criterion);
            index++;
            if (old && index < old.criteria.length)
                continue;
            const action = await host.choose(t('goal.criteriaInput'), [t('goal.criteriaUse'), t('goal.criteriaAdd')]);
            guard();
            if (!action)
                return;
            if (action === t('goal.criteriaUse'))
                break;
        } while (index < 16);
        return {
            objective,
            criteria: values
        };
    };
    const act = async (action: string, target: string, argument = '', context?: HostCommandContext): Promise<HostCommandOutcome> => {
        const before = controller.inspectConversation(target), goal = controller.conversationGoal(target);
        const model = controller.getConversationModelChoice(target), language = controller.getConversationLanguage(target);
        const locale = host.locale?.(target) ?? 'en', t = translator(locale);
        const current = () => { const now = controller.inspectConversation(target); if (!host.isCurrent(target) || now.generation !== before.generation || now.projectId !== before.projectId || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== model.revision || controller.getConversationLanguage(target).revision !== language.revision)
            throw Error(t('goal.sourceChanged')); };
        const choose = async (title: string, rows: string[]) => { current(); const selected = await host.choose(title, rows); current(); return selected; };
        const input = async (title: string, value: string, description?: string) => { current(); const text = await host.input(title, value, description); current(); return text; };
        const allowanceInput = async (title: string, initial: string, maximum: number, validate: (value: number) => number) => {
            let staged = '';
            const unchangedGoal = () => {
                current();
                const now = controller.conversationGoal(target);
                if (now?.goalId !== goal?.goalId || now?.revision !== goal?.revision || now?.turnLimit !== goal?.turnLimit || now?.startedAttempts !== goal?.startedAttempts)
                    throw Error(t('goal.allowanceChanged'));
            };
            while (true) {
                unchangedGoal();
                const raw = await input(title, staged, t('allowance.default', { value: initial, maximum }));
                unchangedGoal();
                if (raw === undefined) return;
                staged = raw;
                try {
                    const selected = raw.trim() || initial;
                    return validate(/^[0-9]+$/u.test(selected) ? Number(selected) : Number.NaN);
                }
                catch {
                    current();
                    host.notice(t('goal.allowanceInvalid', { maximum }));
                }
            }
        };
        current();
        if (action === 'create') {
            const draft = await definition(t, undefined, argument || undefined, current);
            if (!draft)
                return 'cancelled';
            const limit = await allowanceInput(t('goal.allowanceInput'), '8', maximumGoalTurns, goalAllowance);
            if (limit === undefined)
                return 'cancelled';
            current();
            controller.createGoal({
                conversationId: target,
                ...draft,
                turnLimit: limit
            });
            host.notice(t('goal.saved'));
            return 'completed';
        }
        if (!goal && action !== 'inspect')
            throw Error(t('goal.missing'));
        if (!goal) {
            const assertEmpty = () => {
                if (controller.conversationGoal(target)) throw Error(t('goal.sourceChanged'));
            };
            while (true) {
                assertEmpty();
                const chosen = await choose(t('goal.empty'), [t('goal.emptyBack'), t('goal.createEntry')]);
                assertEmpty();
                if (!chosen || chosen === t('goal.emptyBack'))
                    return 'cancelled';
                if (chosen !== t('goal.createEntry'))
                    throw Error(t('goal.unknownChoice'));
                const outcome = await act('create', target, '', context);
                if (outcome !== 'cancelled' || !host.isCurrent(target))
                    return outcome;
            }
        }
        const control = {
            goalId: goal.goalId,
            expectedRevision: goal.revision
        };
        const unchanged = () => {
            current();
            const now = controller.conversationGoal(target);
            if (now?.goalId !== goal.goalId || now.revision !== goal.revision)
                throw Error(t('goal.definitionChanged'));
        };
        const runtimeRequired = () => !!before.projectId && !controller.options.runtimeProfile;
        const configureRuntime = host.configureRuntime;
        const runtimeAction = t('requestSetup.openRuntime');
        const pendingGoalInputs = () => observeRecovery(() => controller.pendingGoalInput(goal.goalId));
        const pendingInput = () => {
            const pending = pendingGoalInputs();
            const [receipt, another] = pending ?? [];
            const inputs = receipt && !another && host.show
                ? observeRecovery(() => controller.inspectConversationInputs(target)) : [];
            const input = inputs?.find(row => row.inputId === receipt?.inputId);
            const original = input?.state === 'QUEUED' && input.text !== null ? input : undefined;
            const unavailable = pending === undefined || inputs === undefined;
            return { original, unavailable, blocked: unavailable || !!receipt && !original };
        };
        const checkGoalState = (view: GoalView) => {
            unchanged();
            const latest = controller.inspectGoal(goal.goalId);
            if (latest.state !== view.state || latest.externalWait !== view.externalWait || latest.startedAttempts !== view.startedAttempts || latest.turnLimit !== view.turnLimit ||
                latest.attempts.some(a => a.state === 'RUNNING') !== view.attempts.some(a => a.state === 'RUNNING'))
                throw Error(t('goal.stateChanged'));
            return latest;
        };
        const applyRuntime = async (view: GoalView) => {
            const latest = checkGoalState(view);
            if (!goalActivity(latest, controller.inspectConversation(target)).canStart)
                throw Error(t('goal.stateChanged'));
            if (pendingInput().blocked) return false;
            if (!runtimeRequired()) return true;
            const applied = await configureRuntime?.(target);
            checkGoalState(view);
            return applied && !runtimeRequired();
        };
        if (action === 'start' || action === 'resume') {
            const view = controller.inspectGoal(goal.goalId);
            const {original, blocked} = pendingInput();
            if (blocked) {
                const {terminal, coordinating} = goalActivity(view, before);
                if (host.inputs && !terminal && !coordinating)
                    return host.inputs(target, context);
                throw Error(t('goal.inputHeld'));
            }
            if (runtimeRequired()) {
                if (!goalActivity(view, before).canStart)
                    throw Error(t('goal.startUnavailable'));
                if (!configureRuntime)
                    throw Error(t('goal.runtimeHelp'));
                const selected = await choose(t('goal.runtimeRequired'), [t('input.recoveryBackUnchanged'), runtimeAction]);
                if (selected === runtimeAction) {
                    const applied = await applyRuntime(view);
                    if (applied || pendingInput().blocked)
                        return act('inspect', target, '', context);
                }
                return 'cancelled';
            }
            const fresh = () => {
                checkGoalState(view);
                const now = pendingInput();
                if (now.blocked || now.original?.inputId !== original?.inputId ||
                    now.original?.fingerprint !== original?.fingerprint)
                    throw Error(t('goal.inputChanged'));
                if (runtimeRequired())
                    throw Error(t('goal.runtimeHelp'));
            };
            if (original?.text != null && host.show) {
                const review = [
                    t('goal.inputScope'), t('goal.turns', {used:view.startedAttempts, limit:view.turnLimit}),
                    `${t('input.recoveryRequest')}\n${quoteText(original.text)}`,
                    t('input.recoveryReference', {input:quoteText(original.inputId), work:original.workId ? quoteText(original.workId) : '—',
                        run:original.runId ? quoteText(original.runId) : '—'}),
                ].join('\n\n');
                fresh();
                if (!await showReviewText({show:host.show.bind(host)}, t('goal.inputReview'), review, fresh, t('input.recoveryNoAction'), locale,
                    {next:t('review.nextPage'), finish:t('review.openConfirmation')}))
                    return 'cancelled';
                const selected = await choose(t('goal.inputConfirmTitle'), [t('input.recoveryBackUnchanged'), t('goal.inputConfirm')]);
                fresh();
                if (selected !== t('goal.inputConfirm')) return 'cancelled';
            }
            const request = await host.resolve(target);
            fresh();
            controller.startGoal({
                ...control,
                ...request,
                ...(original ? {reconcileInputId:original.inputId} : {})
            });
            host.notice(t('goal.startedNotice'));
            return 'completed';
        }
        if (action === 'pause' || action === 'cancel') {
            await controller.pauseGoal({
                ...control,
                reason: action === 'pause' ? 'Owner requested pause from /goal' : 'Owner cancelled goal coordination from /goal',
                cancel: action === 'cancel'
            });
            host.notice(t(action === 'pause' ? 'goal.pausedNotice' : 'goal.cancelledNotice'));
            return 'completed';
        }
        if (action === 'revise') {
            const draft = await definition(t, goal, undefined, current);
            if (!draft)
                return 'cancelled';
            const reason = await input(t('goal.revisionReason'), '');
            if (reason === undefined)
                return 'cancelled';
            controller.reviseGoal({
                ...control,
                ...draft,
                reason
            });
            host.notice(t('goal.revisedNotice'));
            return 'completed';
        }
        if (action === 'extend') {
            const maximum = maximumGoalTurns - goal.turnLimit;
            if (maximum < 1) throw Error(t('goal.allowanceMaximum'));
            const units = await allowanceInput(t('goal.additionalTurnsInput'), String(Math.min(4, maximum)), maximum, value => {
                const units = goalAllowance(value);
                goalAllowance(goal.turnLimit + units);
                return units;
            });
            if (units === undefined)
                return 'cancelled';
            const reason = await input(t('goal.extensionReason'), '');
            if (reason === undefined)
                return 'cancelled';
            controller.extendGoal({
                ...control,
                units,
                reason
            });
            host.notice(t('goal.extendedNotice'));
            return 'completed';
        }
        if (action !== 'inspect')
            throw Error(t('goal.usage'));
        const pendingSourceWork = () => {
            try {
                return controller.goalPendingSourceWork(goal.goalId);
            } catch {
                // The linked work registry exposes unavailable provenance separately.
                return undefined;
            }
        };
        let detail: { text: string; work: string | undefined; scrollTop: number } | undefined;
        while (true) {
            unchanged();
            const view = controller.inspectGoal(goal.goalId);
            const conversation = controller.inspectConversation(target);
            const { terminal, coordinating, canStart } = goalActivity(view, conversation);
            const status = view.externalWait ? t('goal.externalWait') : t(`goal.state.${view.state}`);
            if (detail) {
                const last = view.attempts.at(-1);
                const result = (last?.data as {result?: ConversationTurnResult} | null)?.result;
                const recorded = view.state === 'BLOCKED' && last?.state === 'UNAVAILABLE' && result?.runId === last.runId &&
                    result.conversationId === last.conversationId && typeof result.failure === 'string'
                    ? {run: last.runId, value: plainTerminalText(result.failure.slice(0, 4096)).trim()} : undefined;
                const text = [
                    status,
                    uiText(locale, 'goal.objective', {value:view.objective}),
                    t('goal.criteria'), ...view.criteria.map((value, index) => `${index + 1}. ${value}`),
                    uiText(locale, 'goal.recordedNext', {value:view.nextAction}),
                    uiText(locale, 'goal.reason', {value:view.reason}),
                    ...(recorded?.value ? [uiText(locale, 'goal.recordedFailure', recorded)] : []),
                    uiText(locale, 'goal.turns', {used:view.startedAttempts, limit:view.turnLimit}),
                    t('goal.budgets'), t('goal.completion'), t('goal.scope'),
                    ...(coordinating ? [t('goal.pauseFirst')] : []),
                    t('goal.admission'),
                    uiText(locale, 'goal.plan', {value:view.plan}),
                    uiText(locale, 'goal.findings', {count:view.findings.filter(f => f.state === 'pending').length}),
                    ...view.findings.filter(f => f.state === 'pending').map(f => `• ${f.description}`),
                    uiText(locale, 'goal.attempts', {value:view.attempts.map(a => `${a.ordinal}: ${a.kind} · ${a.state} · ${a.attemptId}`).join('\n') || t('goal.none')}),
                    uiText(locale, 'goal.review', {value:view.reviewConversationId ?? t('goal.none')}),
                    t('goal.identity', { id: view.goalId, revision: view.revision }),
                ].join('\n\n');
                const work = view.state === 'BLOCKED' && host.show && host.work ? pendingSourceWork() : undefined;
                if (detail.text !== text || detail.work !== work)
                    detail = { text, work, scrollTop: 0 };
                if (work && host.show && host.work) {
                    if (await showReviewAction({show: host.show.bind(host)}, t('goal.details'), text, t('goal.openPendingWork'), detail)) {
                        checkGoalState(view);
                        if (pendingSourceWork() !== work)
                            throw Error(t('goal.pendingWorkChanged'));
                        const outcome = await host.work(target, context, work);
                        if (outcome !== 'cancelled' || !host.isCurrent(target))
                            return outcome;
                        continue;
                    }
                } else if (host.show) {
                    await host.show(t('goal.details'), text, undefined, detail);
                } else {
                    host.notice(text);
                }
                detail = undefined;
                continue;
            }
            const pending = !terminal && !coordinating ? pendingInput() : undefined;
            const blockedInput = pending?.blocked ?? false;
            const needsRuntime = canStart && !blockedInput && runtimeRequired();
            const routes = new Map<string, string>();
            routes.set(t('goal.details'), 'details');
            if (terminal) {
                if (conversation.state === 'IDLE' && pendingGoalInputs()?.length === 0)
                    routes.set(t('goal.new'), 'create');
            } else if (coordinating) {
                routes.set(t('goal.pause'), 'pause');
                routes.set(t('goal.cancel'), 'cancel');
            } else {
                if (blockedInput && host.inputs) {
                    routes.set(t('goal.inspectInputs'), 'inputs');
                } else if (canStart && !blockedInput) {
                    if (configureRuntime && needsRuntime) routes.set(runtimeAction, 'runtime');
                    else routes.set(t(view.state === 'READY' ? 'goal.start' : 'goal.resume'), view.state === 'READY' ? 'start' : 'resume');
                }
                if (view.startedAttempts >= view.turnLimit && view.turnLimit < maximumGoalTurns) routes.set(t('goal.extend'), 'extend');
                routes.set(t('goal.revise'), 'revise');
                if (view.startedAttempts < view.turnLimit && view.turnLimit < maximumGoalTurns) routes.set(t('goal.extend'), 'extend');
                routes.set(t('goal.cancel'), 'cancel');
            }
            if (host.work && !terminal) routes.set(t('goal.work'), 'work');
            routes.set(t('goal.close'), 'close');
            const excerpt = (value: string) => truncateToWidth(plainTerminalText(value).replace(/\s+/gu, ' ').trim(), 82, '…');
            const exhausted = !terminal && !coordinating && view.startedAttempts >= view.turnLimit;
            const explain = ['WAITING_DEPENDENCY', 'WAITING_INPUT', 'BLOCKED'].includes(view.state);
            const guidance = [
                ...(explain ? [t('goal.reason', {value: excerpt(view.reason)})] : []),
                ...(blockedInput ? [t(pending?.unavailable ? 'input.recoveryListUnavailable' : 'goal.inputHeld')] : []),
                ...(exhausted ? [
                    t('goal.turns', {used: view.startedAttempts, limit: view.turnLimit}),
                    t(routes.has(t('goal.extend')) ? 'goal.exhaustedExtend' : 'goal.exhaustedMaximum')
                ] : explain && !blockedInput
                    ? [t('goal.next', {value: excerpt(view.nextAction)})] : []),
            ];
            const title = [t('goal.menu', {state: status, objective: excerpt(view.objective)}),
                ...(needsRuntime ? [t('goal.runtimeRequired')] : []), ...guidance].join('\n');
            const chosen = await choose(title, [...routes.keys()]);
            unchanged();
            if (!chosen || routes.get(chosen) === 'close') return 'cancelled';
            const next = routes.get(chosen);
            if (!next) throw Error(t('goal.unknownChoice'));
            if (next === 'runtime') {
                await applyRuntime(view);
                continue;
            }
            checkGoalState(view);
            if (next === 'inputs' && host.inputs) {
                if (!pendingInput().blocked) continue;
                const outcome = await host.inputs(target, context);
                if (outcome !== 'cancelled' || !host.isCurrent(target)) return outcome;
                continue;
            }
            if ((next === 'start' || next === 'resume') && (pendingInput().blocked || runtimeRequired())) continue;
            if (next === 'details') {
                detail = { text: '', work: undefined, scrollTop: 0 };
                continue;
            }
            if (next === 'cancel') {
                const confirmed = await choose(t('goal.cancelScope'), [t('goal.back'), t('goal.confirmCancel')]);
                unchanged();
                if (!confirmed || confirmed === t('goal.back')) continue;
                if (confirmed !== t('goal.confirmCancel')) throw Error(t('goal.unknownChoice'));
            }
            const outcome = next === 'work' && host.work ? await host.work(target, context) : await act(next, target, '', context);
            if (outcome !== 'cancelled' || !host.isCurrent(target)) return outcome;
        }
    };
    return [{
            name: 'goal',
            descriptionId: 'command.description.goal',
            argumentHint: '[create|start|resume|pause|inspect|revise|extend|cancel]',
            run: async (argument, target, context) => {
                const [action, ...rest] = argument.trim().split(/\s+/u);
                return act(action || 'inspect', target, rest.join(' '), context);
            }
        }];
}

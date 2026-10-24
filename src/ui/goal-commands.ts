import { goalAllowance, maximumGoalTurns } from '../controller/goal-allowance.js';
import type { Controller } from '../controller/controller.js';
import type { ConversationModelRequest } from '../controller/interaction-types.js';
import { uiText, translator, type UiLocale } from './i18n.js';
import type { GoalSummary } from '../controller/goal-types.js';
import type { HostCommand, HostCommandOutcome, HostCommandContext } from './host-commands.js';
interface GoalCommandHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    resolve(target: string): Promise<ConversationModelRequest>;
    notice(text: string): void;
    show?(title: string, text: string): Promise<void>;
    locale?(target: string): UiLocale;
    work?(target: string, context?: HostCommandContext): Promise<HostCommandOutcome>;
}
export function goalCommands(host: GoalCommandHost): HostCommand[] {
    const { controller } = host;
    const definition = async (old?: GoalSummary, initial?: string, guard: () => void = () => { }) => {
        guard();
        const objective = initial || await host.input('Goal objective · preserve owner intent', old?.objective ?? '');
        guard();
        if (objective === undefined)
            return;
        const values: string[] = [];
        let index = 0;
        do {
            const criterion = await host.input(`Completion criterion ${index + 1} · observable outcome`, old?.criteria[index] ?? '');
            guard();
            if (criterion === undefined)
                return;
            values.push(criterion);
            index++;
            if (old && index < old.criteria.length)
                continue;
            const action = await host.choose('Goal completion criteria', ['Use these criteria', 'Add another criterion']);
            guard();
            if (!action)
                return;
            if (action === 'Use these criteria')
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
        const current = () => { const now = controller.inspectConversation(target); if (!host.isCurrent(target) || now.generation !== before.generation || now.projectId !== before.projectId || now.archived || now.deleted || controller.getConversationModelChoice(target).revision !== model.revision || controller.getConversationLanguage(target).revision !== language.revision)
            throw Error('Goal source changed; reopen /goal'); };
        const choose = async (title: string, rows: string[]) => { current(); const selected = await host.choose(title, rows); current(); return selected; };
        const input = async (title: string, value: string, description?: string) => { current(); const text = await host.input(title, value, description); current(); return text; };
        const allowanceInput = async (title: string, initial: string, maximum: number, validate: (value: number) => number) => {
            let staged = '';
            const unchangedGoal = () => {
                current();
                const now = controller.conversationGoal(target);
                if (now?.goalId !== goal?.goalId || now?.revision !== goal?.revision || now?.turnLimit !== goal?.turnLimit || now?.startedAttempts !== goal?.startedAttempts)
                    throw Error('Goal changed; reopen /goal before editing its allowance');
            };
            while (true) {
                unchangedGoal();
                const raw = await input(title, staged, uiText(host.locale?.(target) ?? 'en', 'goal.allowanceDefault', { value: initial, maximum }));
                unchangedGoal();
                if (raw === undefined) return;
                staged = raw;
                try {
                    const selected = raw.trim() || initial;
                    return validate(/^[0-9]+$/u.test(selected) ? Number(selected) : Number.NaN);
                }
                catch {
                    current();
                    host.notice(uiText(host.locale?.(target) ?? 'en', 'goal.allowanceInvalid', { maximum }));
                }
            }
        };
        current();
        if (action === 'create') {
            const draft = await definition(undefined, argument || undefined, current);
            if (!draft)
                return 'cancelled';
            const limit = await allowanceInput('Goal turn allowance · author + completion review; child/work budgets separate', '8', maximumGoalTurns, goalAllowance);
            if (limit === undefined)
                return 'cancelled';
            const now = controller.inspectConversation(target);
            if (now.generation !== before.generation || now.projectId !== before.projectId)
                throw Error('Goal conversation changed; create again for the intended target');
            controller.createGoal({
                conversationId: target,
                ...draft,
                turnLimit: limit
            });
            host.notice(uiText(host.locale?.(target) ?? 'en', 'goal.saved'));
            return 'completed';
        }
        if (!goal && action !== 'inspect')
            throw Error('No goal on this conversation; use /goal create');
        if (!goal) {
            const chosen = await choose('No goal on this conversation', ['Back without action', 'Create a goal · /goal create']);
            const now = controller.inspectConversation(target);
            if (now.generation !== before.generation || now.projectId !== before.projectId || controller.conversationGoal(target))
                throw Error('Goal source changed; reopen /goal');
            if (!chosen || chosen === 'Back without action')
                return 'cancelled';
            if (chosen !== 'Create a goal · /goal create')
                throw Error('Unknown goal entry');
            return act('create', target, '', context);
        }
        const control = {
            goalId: goal.goalId,
            expectedRevision: goal.revision
        };
        if (action === 'start' || action === 'resume') {
            const request = await host.resolve(target);
            current();
            const pending = controller.pendingGoalInput(goal.goalId);
            let reconcileInputId: string | undefined;
            if (pending.length) {
                const choice = await choose('Explicitly reconcile retained goal input', pending.map(p => `${p.inputId} · ${p.kind} · ${p.preview}`));
                if (!choice)
                    return 'cancelled';
                reconcileInputId = choice.split(' · ')[0]!;
            }
            controller.startGoal({
                ...control,
                ...request,
                ...(reconcileInputId ? {
                    reconcileInputId
                } : {})
            });
            host.notice('Goal started · continue navigating; /goal pause stops its current turn');
            return 'completed';
        }
        if (action === 'pause' || action === 'cancel') {
            await controller.pauseGoal({
                ...control,
                reason: action === 'pause' ? 'Owner requested pause from /goal' : 'Owner cancelled goal coordination from /goal',
                cancel: action === 'cancel'
            });
            host.notice(action === 'pause' ? 'Goal PAUSED · explicit resume required' : 'Goal CANCELLED · delegated work retained; use its explicit work cancellation if needed');
            return 'completed';
        }
        if (action === 'revise') {
            const draft = await definition(goal, undefined, current);
            if (!draft)
                return 'cancelled';
            const reason = await input('Reason for changing owner goal criteria', '');
            if (reason === undefined)
                return 'cancelled';
            controller.reviseGoal({
                ...control,
                ...draft,
                reason
            });
            host.notice('Goal definition revised · prior findings retained with owner supersession; start explicitly');
            return 'completed';
        }
        if (action === 'extend') {
            const maximum = maximumGoalTurns - goal.turnLimit;
            if (maximum < 1) throw Error(uiText(host.locale?.(target) ?? 'en', 'goal.allowanceMaximum'));
            const units = await allowanceInput('Additional goal turns · does not extend original work/child budgets', String(Math.min(4, maximum)), maximum, value => {
                const units = goalAllowance(value);
                goalAllowance(goal.turnLimit + units);
                return units;
            });
            if (units === undefined)
                return 'cancelled';
            const reason = await input('Reason for allowance extension', '');
            if (reason === undefined)
                return 'cancelled';
            controller.extendGoal({
                ...control,
                units,
                reason
            });
            host.notice('Goal allowance extended · consumed turns retained; resume explicitly');
            return 'completed';
        }
        if (action !== 'inspect')
            throw Error('Supported /goal actions: create, start, resume, pause, cancel, revise, extend, inspect');
        const locale = host.locale?.(target) ?? 'en';
        const t = translator(locale);
        const unchanged = () => {
            current();
            const now = controller.conversationGoal(target);
            if (now?.goalId !== goal.goalId || now.revision !== goal.revision)
                throw Error('Goal changed; reopen /goal to review its current definition and state');
        };
        while (true) {
            unchanged();
            const view = controller.inspectGoal(goal.goalId), terminal = ['COMPLETED', 'CANCELLED'].includes(view.state);
            // Dependency continuation can still own a live runner without a RUNNING attempt.
            // Only the controller can settle that runner; offer pause before definition edits.
            const coordinating = !terminal && (['ACTIVE', 'REVIEWING', 'WAITING_DEPENDENCY'].includes(view.state) || view.attempts.some(a => a.state === 'RUNNING'));
            const conversation = controller.inspectConversation(target);
            const canStart = !terminal && !coordinating && view.startedAttempts < view.turnLimit && !['RUNNING', 'SETTLING', 'UNKNOWN'].includes(conversation.state);
            const routes = new Map<string, string>();
            routes.set(t('goal.details'), 'details');
            if (terminal) {
                if (conversation.state === 'IDLE' && !controller.pendingGoalInput(goal.goalId).length)
                    routes.set(t('goal.new'), 'create');
            } else if (coordinating) {
                routes.set(t('goal.pause'), 'pause');
                routes.set(t('goal.cancel'), 'cancel');
            } else {
                if (canStart) routes.set(t(view.state === 'READY' ? 'goal.start' : 'goal.resume'), view.state === 'READY' ? 'start' : 'resume');
                if (view.startedAttempts >= view.turnLimit && view.turnLimit < maximumGoalTurns) routes.set(t('goal.extend'), 'extend');
                routes.set(t('goal.revise'), 'revise');
                if (view.startedAttempts < view.turnLimit && view.turnLimit < maximumGoalTurns) routes.set(t('goal.extend'), 'extend');
                routes.set(t('goal.cancel'), 'cancel');
            }
            if (host.work && !terminal) routes.set(t('goal.work'), 'work');
            routes.set(t('goal.close'), 'close');
            const title = uiText(locale, 'goal.menu', {state: uiText(locale, `goal.state.${view.state}`), objective: view.objective.slice(0, 120)});
            const chosen = await choose(title, [...routes.keys()]);
            unchanged();
            if (!chosen || routes.get(chosen) === 'close') return 'cancelled';
            const next = routes.get(chosen);
            if (!next) throw Error('Unknown goal entry');
            const latest = controller.inspectGoal(goal.goalId);
            if (latest.state !== view.state || latest.startedAttempts !== view.startedAttempts ||
                latest.attempts.some(a => a.state === 'RUNNING') !== view.attempts.some(a => a.state === 'RUNNING'))
                throw Error('Goal state changed; reopen /goal to review current actions');
            if (next === 'details') {
                const text = [
                    uiText(locale, `goal.state.${view.state}`),
                    uiText(locale, 'goal.objective', {value:view.objective}),
                    t('goal.criteria'), ...view.criteria.map((value, index) => `${index + 1}. ${value}`),
                    uiText(locale, 'goal.next', {value:view.nextAction}),
                    uiText(locale, 'goal.reason', {value:view.reason}),
                    uiText(locale, 'goal.turns', {used:view.startedAttempts, limit:view.turnLimit}),
                    t('goal.budgets'), t('goal.completion'), t('goal.scope'),
                    ...(coordinating ? [t('goal.pauseFirst')] : []),
                    t('goal.admission'),
                    uiText(locale, 'goal.plan', {value:view.plan}),
                    uiText(locale, 'goal.findings', {count:view.findings.filter(f => f.state === 'pending').length}),
                    ...view.findings.filter(f => f.state === 'pending').map(f => `• ${f.description}`),
                    uiText(locale, 'goal.attempts', {value:view.attempts.map(a => `${a.ordinal}: ${a.kind} · ${a.state} · ${a.attemptId}`).join('\n') || t('goal.none')}),
                    uiText(locale, 'goal.review', {value:view.reviewConversationId ?? t('goal.none')}),
                    `Goal ID: ${view.goalId} · revision ${view.revision}`,
                ].join('\n\n');
                if (host.show) await host.show(t('goal.details'), text);
                else host.notice(text);
                unchanged();
                continue;
            }
            if (next === 'cancel') {
                const confirmed = await choose(t('goal.cancelScope'), [t('goal.back'), t('goal.confirmCancel')]);
                unchanged();
                if (!confirmed || confirmed === t('goal.back')) return 'cancelled';
                if (confirmed !== t('goal.confirmCancel')) throw Error('Unknown goal cancellation choice');
            }
            if (next === 'work' && host.work) return host.work(target, context);
            return act(next, target, '', context);
        }
    };
    return [{
            name: 'goal',
            description: 'Create and drive a durable goal with bounded continuation and independent completion review',
            argumentHint: '[create|start|resume|pause|inspect|revise|extend|cancel]',
            run: async (argument, target, context) => {
                const [action, ...rest] = argument.trim().split(/\s+/u);
                return act(action || 'inspect', target, rest.join(' '), context);
            }
        }];
}

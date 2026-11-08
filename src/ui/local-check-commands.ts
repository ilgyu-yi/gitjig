import { chooseRecoveryEntry, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { initialWorkAllowance } from '../controller/local-checks.js';
import { localCheckResultText, localCheckReviewText, localCheckHistoryText, localCheckResumeHold, offersLocalCheckEvidence, isLocalCheckUnallocated } from './local-check-result.js';
import { appendObservation } from './inspection-text.js';
import { translator, uiText, type UiLocale } from './i18n.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { showReviewAction, type ReviewPrimaryAction } from './exact-review.js';
import { readSingleLineInput } from './product-input.js';
interface Host extends RecoveryNavigation {
    evidence?(original: import('../controller/local-checks.js').LocalCheckView, action: 'inspect' | 'record'): Promise<boolean>;
    controller: Controller;
    projectId: string;
    signal: AbortSignal;
    locale?: UiLocale;
    runCheck?<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
    guard(): void;
    hasSource(): boolean;
    guardSource(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value?: string, description?: string): Promise<string | undefined>;
    show(title: string, value: unknown, primary?: ReviewPrimaryAction): Promise<void>;
    notice(text: string): void;
    track<T>(task: Promise<T>): Promise<T>;
}
/** Owner command observations only: no model baseline, agent ceremony or replacement journal. */
export function localCheckCommands(h: Host) {
    const c = h.controller, runtime = () => JSON.stringify(c.options.runtimeProfile ?? null);
    const locale = h.locale ?? 'en';
    const t = translator(locale);
    const option = <Value extends string>(value: Value, label: string): UiChoice<Value> => ({ value, label });
    const pick = <Value extends string>(title: string, items: readonly UiChoice<Value>[]) => chooseUiItem<Value>(h, title, items);
    const returnToTools = Symbol('return-to-local-tools');
    const evidenceActions = [option('correspondence', t('localCheck.actions.correspondence')), option('record', t('localCheck.actions.record'))];
    const workRecovery = option('work', t('localCheck.actions.work'));
    const directories = {
        work: option('work', t('localCheck.directoryWork')),
        scratch: option('scratch', t('localCheck.directoryScratch')),
    };
    let originalWork: string | undefined;
    const checkDraft: { command: string; directory: keyof typeof directories } = { command: '', directory: 'work' };
    const annotate = (error: unknown) => {
        if (!originalWork)
            return error;
        const failure = Error('Local check outcome belongs to original work ' + originalWork + '. Reopen /local retained checks or /work ' + originalWork + '. ' + (error instanceof Error ? error.message : 'Operation unavailable'), { cause: error });
        Object.assign(failure, { workId: originalWork });
        if (error && typeof error === 'object')
            for (const key of ['code', 'runId', 'recovery'] as const)
                if (key in error)
                    Object.assign(failure, { [key]: (error as Record<string, unknown>)[key] });
        return failure;
    };
    const perform = async (task: (signal: AbortSignal, admit: () => void) => Promise<import('../controller/types.js').ObservationResult>,
        command: string, guard: () => void) => {
        const run = async (localSignal: AbortSignal) => {
            const signal = AbortSignal.any([h.signal, localSignal]);
            const admit = () => { guard(); signal.throwIfAborted(); };
            try {
                admit();
                return await h.track(task(signal, admit));
            } catch (error) {
                if (!h.signal.aborted && signal.aborted && error === signal.reason)
                    return;
                throw error;
            }
        };
        try {
            const result = await (h.runCheck ? h.runCheck(run) : run(h.signal));
            if (!result) {
                h.notice(uiText(h.locale ?? 'en', 'localCheck.cancelledBeforeAdmission'));
                return false;
            }
            originalWork = result.workId;
            h.guard();
            h.notice(t('localCheck.result.retainedNotice', { work: result.workId, run: result.runId, status: result.status }));
            const original = c.inspectLocalCheck(result.workId), snapshot = JSON.stringify(original);
            const fresh = () => {
                h.guard();
                if (JSON.stringify(c.inspectLocalCheck(result.workId)) !== snapshot)
                    throw Error('Original local check changed while its result was open. Reopen this retained check before choosing a next action; no replacement attempt was started.');
            };
            const sameAttempt = original.projectId === h.projectId && original.result?.runId === result.runId &&
                original.result.status === result.status && original.result.exitCode === result.exitCode &&
                original.result.cleanup === result.cleanup && original.result.actualCwd === result.actualCwd &&
                original.command === command;
            const applicable = !!h.evidence && sameAttempt && offersLocalCheckEvidence(original);
            const evidenceAvailable = applicable && h.hasSource();
            if (!await showReviewAction(h, t('localCheck.result.title'), localCheckResultText(result, command, locale, { evidenceAvailable }), t('localCheck.openActions')))
                return returnToTools;
            fresh();
            const canReviewAnother = sameAttempt && original.latestRun?.runId === result.runId &&
                (['failed', 'cancelled'].includes(result.status) || isLocalCheckUnallocated(result)) && !localCheckResumeHold(original, locale);
            while (true) {
                const available = h.hasSource();
                const action = await pick(t('localCheck.actions.title'), [
                    option('back', t('localCheck.actions.return')), option('receipt', t('localCheck.actions.receipt')),
                    ...(canReviewAnother && available ? [option('retry', t('localCheck.reviewAnother'))] : []),
                    ...(applicable && available ? evidenceActions : []),
                    ...(h.navigate ? [workRecovery] : []),
                ]);
                fresh();
                if (!action || action === 'back') return returnToTools;
                if (action === 'receipt') {
                    await h.show(t('localCheck.result.receiptTitle'), result);
                    fresh();
                    continue;
                }
                if (action === 'work' && h.navigate) {
                    const outcome = await h.navigate('/work ' + result.workId);
                    if (outcome !== 'cancelled') return outcome;
                    fresh();
                    continue;
                }
                if (action === 'retry' && canReviewAnother && available) {
                    h.guardSource();
                    return { reviewWorkId: result.workId };
                }
                if (h.evidence && applicable && available && (action === 'correspondence' || action === 'record')) {
                    const recorded = await h.evidence(original, action === 'record' ? 'record' : 'inspect');
                    if (recorded) return returnToTools;
                    fresh();
                    continue;
                }
                throw Error('Unknown local check result action');
            }
        }
        catch (error) {
            if (error && typeof error === 'object' && 'workId' in error && typeof error.workId === 'string')
                originalWork = error.workId;
            throw annotate(error);
        }
    };
    const active = async () => {
        h.guardSource();
        if (c.options.runtimeProfile)
            return true;
        const title = uiText(locale, 'localCheck.runtimeRequired'), guidance = uiText(locale, 'localCheck.runtimeGuidance');
        if (!h.navigate) {
            await h.show(title, guidance);
            return false;
        }
        const outcome = await chooseRecoveryEntry(h, h.guardSource, [
            { command: '/setup runtime', label: uiText(locale, 'requestSetup.openRuntime') },
            { command: '/ready', label: uiText(locale, 'localCheck.inspectSetup') },
        ], { title: `${title}\n${guidance}`, back: uiText(locale, 'localCheck.backToTools') });
        if (outcome === 'started') return outcome;
        h.guardSource();
        return outcome === 'completed' && !!c.options.runtimeProfile;
    };
    const newCheck = async () => {
        h.guard();
        originalWork = undefined;
        const ready = await active();
        if (ready !== true)
            return ready;
        const profile = runtime();
        const guard = () => {
            h.guardSource();
            if (runtime() !== profile)
                throw Error('Active runtime changed; reopen local check review');
        };
        const readCommand = () => readSingleLineInput(async (value, issue) => {
            guard();
            const entered = await h.input('Isolated check command · exact single line · no host shell', value, issue);
            guard();
            return entered;
        }, checkDraft.command, t('localCheck.commandSingleLine'), value =>
            value.trim() && Buffer.byteLength(value) <= 32768 ? undefined : t('localCheck.commandRequired'));
        const readDirectory = async () => {
            guard();
            const current = checkDraft.directory;
            const selected = await pick(t('localCheck.directoryTitle'), [
                directories[current], directories[current === 'work' ? 'scratch' : 'work'],
                option('cancel', t('localCheck.directoryCancel')),
            ]);
            guard();
            return selected === 'cancel' ? undefined : selected;
        };
        const entered = await readCommand();
        if (entered === undefined)
            return false;
        checkDraft.command = entered;
        const directory = await readDirectory();
        if (!directory)
            return false;
        checkDraft.directory = directory;
        while (true) {
            guard();
            const { command, directory } = checkDraft;
            const review = localCheckReviewText({ projectId: h.projectId, command, cwd: '/' + directory, nextAttemptRuntime: JSON.parse(profile), executionAllowance: initialWorkAllowance, scope: 'New independent owner check, not agent procedure or commit approval. /scratch cannot establish source correspondence. Project code executes only in the configured restricted runtime.' });
            if (!await showReviewAction(h, 'Review new independent local check', review, uiText(locale, 'localCheck.openConfirmation')))
                return false;
            guard();
            const choice = await pick('Explicit local check action', [
                option('back', 'Back without starting'), option('run', 'Run new independent check'),
                option('command', t('localCheck.editCommand')), option('directory', t('localCheck.editDirectory')),
            ]);
            guard();
            if (!choice || choice === 'back') return false;
            if (choice === 'command') {
                checkDraft.command = await readCommand() ?? command;
                continue;
            }
            if (choice === 'directory') {
                checkDraft.directory = await readDirectory() ?? directory;
                continue;
            }
            h.notice('Running isolated local check · ' + h.projectId + ' · /' + directory + ' · no model turn');
            const outcome = await perform((signal, admit) => c.startOwnerLocalCheck({ projectId: h.projectId, command, cwd: directory, signal }, admit), command, guard);
            if (outcome !== false) {
                checkDraft.command = '';
                checkDraft.directory = 'work';
            }
            const next = typeof outcome === 'object' ? await detail(outcome.reviewWorkId) : outcome;
            return next === returnToTools ? true : next ?? true;
        }
    };
    const browse = async () => {
        let cursor: string | undefined;
        const back: (string | undefined)[] = [];
        while (true) {
            h.guard();
            const page = c.listLocalChecks(h.projectId, { limit: 25, ...cursor ? { before: cursor } : {} });
            const picked = await pick(t('localCheck.history.list', { project: h.projectId }), [
                ...page.checks.map((check, index) => option(`check:${index}`, check.state === 'RETAINED'
                    ? `${check.recordedState} · /${check.cwd} · ${check.commandPreview} · ${check.workId}`
                    : t('localCheck.history.unavailableRow', { work: check.workId }))),
                ...page.nextCursor ? [option('older', t('localCheck.history.older'))] : [],
                ...back.length ? [option('newer', t('localCheck.history.newer'))] : [],
                option('back', t('localCheck.actions.back')),
            ]);
            if (!picked || picked === 'back')
                return;
            if (picked === 'older' && page.nextCursor) {
                back.push(cursor);
                cursor = page.nextCursor;
                continue;
            }
            if (picked === 'newer' && back.length) {
                cursor = back.pop();
                continue;
            }
            const selected = page.checks[Number(picked.slice('check:'.length))];
            if (!selected)
                throw Error('Local check selection changed');
            if (selected.state === 'UNAVAILABLE') {
                await h.show(t('localCheck.history.unavailableTitle'), selected);
                continue;
            }
            const outcome = await detail(selected.workId);
            if (outcome === returnToTools) return;
            if (outcome)
                return outcome;
        }
    };
    const detail = async (id: string) => {
        while (true) {
            h.guard();
            const original = c.inspectLocalCheck(id);
            if (original.projectId !== h.projectId)
                throw Error('Original check belongs to another project');
            const captured = JSON.stringify(original);
            const guard = () => {
                h.guard();
                if (JSON.stringify(c.inspectLocalCheck(id)) !== captured)
                    throw Error('Original check changed; reopen its current details');
            };
            const applicable = !!h.evidence && offersLocalCheckEvidence(original);
            const available = h.hasSource();
            const evidenceAvailable = applicable && available;
            const resumeHold = localCheckResumeHold(original, locale);
            const { result, latestRun } = original;
            const canReviewSetup = available && h.navigate && !resumeHold && result && latestRun?.phase === 'SETTLED' &&
                latestRun.reservation === 'consumed' && latestRun.runId === result.runId && latestRun.resultId === result.resultId &&
                latestRun.command === original.command && latestRun.cleanup === result.cleanup &&
                typeof latestRun.captureDigest === 'string' && latestRun.captureDigest.length > 0 && isLocalCheckUnallocated(result);
            const title = [
                t('localCheck.history.originalTitle', { state: original.state, work: id }),
                ...(!available ? [uiText(locale, 'local.sourceUnavailable')] : []),
                ...(resumeHold ? [resumeHold] : []),
                ...(h.evidence && !applicable ? [uiText(locale, 'localCheck.evidenceUnavailable')] : []),
            ].join('\n');
            const choice = await pick(title, [
                option('history', t('localCheck.actions.history')), ...(original.result ? [option('output', t('localCheck.actions.output'))] : []),
                ...(h.navigate ? [workRecovery] : []), ...(evidenceAvailable ? evidenceActions : []),
                ...(canReviewSetup ? [option('setup', t('localCheck.reviewExecutionSetup'))] : []),
                ...(!resumeHold && available ? [option('resume', t('localCheck.actions.resume'))] : []), option('back', t('localCheck.actions.back')),
            ]);
            guard();
            if (!choice || choice === 'back')
                return;
            if (choice === 'setup' && canReviewSetup && h.navigate) {
                h.guardSource();
                const outcome = await h.navigate(c.options.runtimeProfile ? '/setup runtime current' : '/setup runtime');
                if (outcome === 'started') return outcome;
                h.guardSource();
                guard();
                continue;
            }
            if (choice === 'work') {
                const outcome = await h.navigate!('/work ' + id);
                if (outcome !== 'cancelled') return outcome;
                guard();
                continue;
            }
            if (choice === 'history') {
                await h.show(t('localCheck.history.title'), localCheckHistoryText(original, c.options.runtimeProfile ?? null, locale, applicable && h.hasSource()));
                guard();
                continue;
            }
            if (choice === 'output') {
                const work = c.inspectWork(id), result = work.currentResult;
                const run = work.runs.find((value): value is { id: string; data: { kind: 'command-observation'; raw: string } } => {
                    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== original.result?.runId || !('data' in value)) return false;
                    const data = value.data;
                    return !!data && typeof data === 'object' && 'kind' in data && data.kind === 'command-observation' && 'raw' in data && typeof data.raw === 'string';
                });
                if (!result || result.kind !== 'command-observation' || result.workId !== id || result.runId !== original.result?.runId ||
                    !run ||
                    typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
                    throw Error('Original result/run correspondence is unavailable. Reopen the retained work; no check was started.');
                guard();
                const summary = localCheckResultText(result, run.data.raw, locale, { surface: 'retained', evidenceAvailable: applicable && h.hasSource() });
                await h.show(t('localCheck.history.outputTitle'), appendObservation(summary, result));
                guard();
                continue;
            }
            if (h.evidence && evidenceAvailable && (choice === 'correspondence' || choice === 'record')) {
                await h.evidence(original, choice === 'record' ? 'record' : 'inspect');
                continue;
            }
            if (choice !== 'resume' || resumeHold || !available)
                throw Error('Unknown original-check action');
            const ready = await active();
            if (ready === 'started') return ready;
            if (!ready) continue;
            const profile = runtime();
            const guardResume = () => {
                h.guardSource();
                guard();
                if (runtime() !== profile)
                    throw Error('Active runtime changed; reopen local check review');
            };
            guardResume();
            const review = localCheckReviewText({ workId: id, projectId: original.projectId, command: original.command, cwd: '/' + original.cwd, epoch: original.epoch, state: original.state, allowance: original.allowance, previousRuntime: original.latestRun?.runtime ?? null, nextAttemptRuntime: JSON.parse(profile), scope: 'Same original work, command and cwd. Consumed allowance remains spent; this action creates a new bounded attempt, not a replacement work or an agent approval.' });
            if (!await showReviewAction(h, 'Review original local check continuation', review, uiText(h.locale ?? 'en', 'localCheck.openConfirmation')))
                continue;
            guardResume();
            const label = original.state === 'CANCELLED' ? 'Resume cancelled original check' : 'Resume original command';
            const decision = await h.choose('Explicit original-check action', ['Back without resuming', label]);
            guardResume();
            if (!decision || decision === 'Back without resuming')
                continue;
            if (decision !== label)
                throw Error('Unknown original continuation action');
            originalWork = id;
            const outcome = await perform((signal, admit) => c.resumeOwnerLocalCheck({ expected: original, resumeCancelled: original.state === 'CANCELLED', signal }, admit), original.command, guardResume);
            if (typeof outcome === 'object') {
                if (outcome.reviewWorkId !== id) throw Error('Original check identity changed');
                continue;
            }
            return outcome;
        }
    };
    return { newCheck, browse };
}

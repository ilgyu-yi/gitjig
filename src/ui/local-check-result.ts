import type { ObservationResult, RuntimeProfile } from '../controller/types.js';
import { localCheckNeedsRecovery, type LocalCheckView } from '../controller/local-checks.js';
import { availableWorkAllowance } from './work-allowance-presentation.js';
import { appendObservation, quoteIdentity, quoteText } from './inspection-text.js';
import { translator, uiText, type UiLocale } from './i18n.js';

export function isLocalCheckUnallocated(result: Pick<ObservationResult, 'status' | 'exitCode' | 'cleanup'>): boolean {
    return result.status === 'unavailable' && result.exitCode === null && result.cleanup === 'not-allocated';
}

/** The returned attempt only; command success is not current source/index correspondence. */
export function localCheckResultText(result: ObservationResult, command: string, locale: UiLocale = 'en',
    { surface = 'result', evidenceAvailable = false }: { surface?: 'result' | 'retained' | 'candidate'; evidenceAvailable?: boolean } = {}): string {
    const t = translator(locale);
    const commandText = quoteText(command);
    const success = result.status === 'succeeded' && result.exitCode === 0 && result.cleanup === 'removed';
    const cleanupKnown = ['removed', 'not-allocated'].includes(result.cleanup);
    const unallocated = isLocalCheckUnallocated(result);
    const preparation = !unallocated ? undefined : result.captureRef === null
        ? { title: uiText(locale, 'localCheck.resultWithoutSnapshot'), next: uiText(locale, 'localCheck.resultBeforeSnapshotNext') }
        : result.captureRef ? { title: uiText(locale, 'localCheck.resultUnallocated'), next: uiText(locale, 'localCheck.resultBeforeAllocationNext') }
        : undefined;
    const status = !cleanupKnown ? t('localCheck.result.cleanup') : success
        ? t('localCheck.result.success')
        : result.status === 'failed' && result.cleanup === 'removed' && Number.isInteger(result.exitCode) && result.exitCode !== 0 ? t('localCheck.result.failed')
        : result.status === 'cancelled' ? t('localCheck.result.cancelled')
        : preparation?.title ?? t('localCheck.result.unavailable');
    const next = surface === 'candidate' ? t('localEvidence.candidateCheckHistorical') :
        !cleanupKnown ? t('localCheck.result.cleanupNext') :
        preparation?.next ?? (result.actualCwd === '/scratch' ? t('localCheck.result.scratch') :
        evidenceAvailable ? t('localCheck.result.evidenceNext') :
        surface === 'result' && !success ? t('localCheck.result.reviewFailure') : undefined);
    return [status,
        t('localCheck.result.exitAndCleanup', { exit: result.exitCode ?? t('localCheck.result.valueUnavailable'), cleanup: result.cleanup }),
        t('localCheck.result.locator', { work: result.workId, run: result.runId }),
        ...(next ? [next] : []),
        ...(success ? ['stdout', 'stderr'] as const : ['stderr', 'stdout'] as const).flatMap(name => {
            const output = result[name];
            if (!output) return [];
            const text = quoteText(output);
            const preview = text.length <= 2000 ? text : text.slice(0, 2000) + '\n' +
                t(surface === 'result' ? 'localCheck.result.outputReceipt' : 'localCheck.result.outputDetails');
            return [t(name === 'stdout' ? 'localCheck.result.stdout' : 'localCheck.result.stderr', { output: preview })];
        }),
        t('localCheck.result.cwd', { cwd: quoteText(result.actualCwd) }),
        t('localCheck.result.sourceScope'),
        t('localCheck.result.verificationScope'),
        ...(surface === 'result' ? [t('localCheck.result.receiptNext')] : []),
        t('localCheck.result.command', { command: commandText.length > 4000 ? commandText.slice(0, 4000) + '\n' + t('localCheck.result.commandShortened') : commandText }),
    ].join('\n\n');
}

const runtimeLabels: Record<string, string> = {
    dockerBinary: 'Docker executable', dockerContext: 'Docker context', dockerConfigDirectory: 'Private Docker configuration',
    image: 'Execution image', uid: 'User ID', gid: 'Group ID', memoryMiB: 'Memory limit (MiB)', cpus: 'CPU limit',
    pidsLimit: 'Process limit', scratchMiB: 'Scratch limit (MiB)', maxOutputBytes: 'Output limit (bytes)', defaultTimeoutMs: 'Default timeout (ms)',
};
const runtimeLines = (runtime: RuntimeProfile | null) => runtime === null ? ['Runtime not recorded.'] :
    Object.entries(runtime).map(([key, value]) => `${runtimeLabels[key] ?? key}: ${typeof value === 'string' ? quoteText(value) : String(value)}`);
interface CheckReviewInput {
    projectId: string;
    command: string;
    cwd: string;
    nextAttemptRuntime: RuntimeProfile;
    scope: string;
}
interface NewCheckReview extends CheckReviewInput {
    executionAllowance: number;
    workId?: never;
}
interface ResumedCheckReview extends CheckReviewInput {
    workId: string;
    state: string;
    epoch: number;
    allowance: LocalCheckView['allowance'];
    previousRuntime: RuntimeProfile | null;
    executionAllowance?: never;
}
type CheckReview = NewCheckReview | ResumedCheckReview;

/** Consequential review must show the entire exact command and execution route. */
export function localCheckReviewText(view: CheckReview): string {
    const resume = view.workId !== undefined;
    const text = [
        resume ? 'Run another attempt of this original check.' : 'Run one new independent local check.',
        'Project: ' + quoteText(view.projectId), 'Exact command: ' + quoteText(view.command), 'Isolated directory: ' + view.cwd,
        view.cwd === '/work' ? 'The command reads a captured project snapshot. Your project files and Git index stay unchanged.' : 'The command uses mutable scratch space. This cannot establish staged-source correspondence.',
        ...(resume ? ['Original work: ' + quoteText(view.workId), 'Original state: ' + view.state,
            `Execution allowance: ${view.allowance.execution.consumed} used · ${view.allowance.execution.reserved} reserved · ${view.allowance.execution.limit} total. Existing spend is retained.`] : ['Execution allowance: ' + view.executionAllowance + ' total attempts; this action starts one.']),
        '', 'Active runtime for the next attempt', ...runtimeLines(view.nextAttemptRuntime),
        ...(resume ? ['', 'Previous attempt runtime · historical only', ...runtimeLines(view.previousRuntime)] : []),
        '', view.scope,
        'Open confirmation to choose Run or Resume. Closing this review or choosing Back starts no new attempt. No model turn or native Git commit is requested.',
    ].join('\n');
    if (text.length > 36000)
        throw Error('The exact check command and runtime exceed the terminal review limit. No attempt started. Inspect and use the explicit local check/resume CLI for these full inputs.');
    return appendObservation(text, view);
}

/** Recorded prerequisites for presenting evidence actions. The controller verifies correspondence. */
export function offersLocalCheckEvidence(view: LocalCheckView): boolean {
    const { result, latestRun } = view;
    return !view.unsettled && view.state === 'DELIVERED' && view.cwd === 'work' &&
        result?.status === 'succeeded' && result.exitCode === 0 && result.cleanup === 'removed' && result.actualCwd === '/work' &&
        !!latestRun && latestRun.runId === result.runId && latestRun.resultId === result.resultId && latestRun.phase === 'SETTLED' &&
        latestRun.reservation === 'consumed' && latestRun.cleanup === 'removed' && latestRun.command === view.command;
}

export function localCheckResumeHold(view: LocalCheckView, locale: UiLocale): string | undefined {
    if (localCheckNeedsRecovery(view))
        return uiText(locale, 'localCheck.resumeRecovery');
    if (!availableWorkAllowance(view.allowance.execution))
        return uiText(locale, 'localCheck.resumeExhausted');
    if (Buffer.byteLength(view.command) > 32768)
        return uiText(locale, 'localCheck.resumeCommandBound');
}

export function localCheckHistoryText(view: LocalCheckView, runtime: RuntimeProfile | null, locale: UiLocale = 'en', evidenceAvailable = false): string {
    const t = translator(locale);
    const resumeHold = localCheckResumeHold(view, locale);
    const { result, latestRun } = view;
    const { consumed, reserved, limit } = view.allowance.execution;
    return appendObservation([
        t('localCheck.history.lead'),
        t('localCheck.history.state', { state: view.state }),
        ...(resumeHold ? [resumeHold] : []),
        t('localCheck.history.command', { command: quoteIdentity(view.command), cwd: view.cwd }),
        t('localCheck.history.allowance', { consumed, reserved, limit }),
        result ? t('localCheck.history.result', { status: result.status, exit: result.exitCode ?? t('localCheck.result.valueUnavailable'), cleanup: result.cleanup }) : t('localCheck.history.noResult'),
        t('localCheck.history.locator', { work: quoteIdentity(view.workId), attempt: latestRun ? quoteIdentity(latestRun.runId) : t('localCheck.history.none'), result: result ? quoteIdentity(result.runId) : t('localCheck.history.none') }),
        ...(evidenceAvailable ? [t('localCheck.evidenceNext')] : []),
        t('localCheck.history.runtime', { image: runtime ? quoteIdentity(runtime.image) : t('localCheck.history.notConfigured') }),
        t('localCheck.history.historicalRuntime'),
    ].join('\n\n'), { ...view, nextAttemptRuntime: runtime });
}

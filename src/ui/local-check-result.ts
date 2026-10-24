import type { ObservationResult, RuntimeProfile } from '../controller/types.js';
import type { LocalCheckView } from '../controller/local-checks.js';
import { appendObservation, quoteIdentity, quoteText } from './inspection-text.js';

/** The returned attempt only; command success is not current source/index correspondence. */
export function localCheckResultText(result: ObservationResult, command: string): string {
    const commandText = quoteText(command);
    const status = result.status === 'succeeded' && result.exitCode === 0 && result.cleanup === 'removed'
        ? 'The check command finished successfully.'
        : result.status === 'failed' ? 'The check command failed.'
        : result.status === 'cancelled' ? 'The check was cancelled.'
        : 'The check did not produce a usable successful result.';
    return [status,
        `Exit code: ${result.exitCode ?? 'unavailable'} · cleanup: ${result.cleanup}`,
        ...(['stdout', 'stderr'] as const).flatMap(name => {
            const output = result[name];
            if (!output) return [];
            const text = quoteText(output);
            return [`${name === 'stdout' ? 'Output' : 'Error output'}: ${text.length <= 2000 ? text : text.slice(0, 2000) + '\n[Output preview shortened; inspect original receipt for retained output]'}`];
        }),
        `Isolated working directory: ${quoteText(result.actualCwd)}`,
        'Your project files and Git index were not changed by this check.',
        result.actualCwd === '/work'
            ? 'Before recording a commit candidate, inspect whether the current project and staged files still match this checked snapshot.'
            : 'A scratch-directory result does not establish correspondence with staged project files.',
        'A successful command does not establish test adequacy, independent review or commit approval. Native Git retains commit, hooks and signing.',
        `Original work: ${result.workId}\nResult run: ${result.runId}`,
        'Inspect original receipt for retained stdout, stderr and limitations. Long displays are shortened.',
        `Requested command for this attempt: ${commandText.length > 4000 ? commandText.slice(0, 4000) + '\n[Command preview shortened; inspect the original work for the complete command]' : commandText}`,
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
        'Next: close this review, then explicitly choose Run or Resume. Back starts no new attempt. No model turn or native Git commit is requested.',
    ].join('\n');
    if (text.length > 36000)
        throw Error('The exact check command and runtime exceed the terminal review limit. No attempt started. Inspect and use the explicit local check/resume CLI for these full inputs.');
    return appendObservation(text, view);
}

export function localCheckHistoryText(view: LocalCheckView, runtime: RuntimeProfile | null): string {
    return appendObservation([
        'Retained local check · opening this view does not run it.',
        'State: ' + view.state + (view.unsettled ? ' · original work still needs recovery' : ''),
        'Command: ' + quoteIdentity(view.command), 'Isolated directory: /' + view.cwd,
        `Execution allowance: ${view.allowance.execution.consumed} used · ${view.allowance.execution.reserved} reserved · ${view.allowance.execution.limit} total`,
        view.result ? `Retained result: ${view.result.status} · exit ${view.result.exitCode ?? 'unavailable'} · cleanup ${view.result.cleanup}` : 'No result retained.',
        'Original work: ' + quoteIdentity(view.workId),
        'Latest attempt: ' + (view.latestRun ? quoteIdentity(view.latestRun.runId) : 'none'),
        'Result run: ' + (view.result ? quoteIdentity(view.result.runId) : 'none'),
        'Next: return to this check menu to inspect current correspondence or explicitly resume. A retained success is not current source correspondence or commit approval.',
        'Active runtime for a future attempt: ' + (runtime ? quoteIdentity(runtime.image) : 'not configured'),
        'Original runtime and result are historical; a resume uses the separately reviewed active runtime.',
    ].join('\n\n'), { ...view, nextAttemptRuntime: runtime });
}

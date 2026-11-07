import { chooseRecoveryEntry, openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { initialWorkAllowance } from '../controller/local-checks.js';
import { localCheckResultText, localCheckReviewText, localCheckHistoryText } from './local-check-result.js';
import { appendObservation } from './inspection-text.js';
interface Host extends RecoveryNavigation {
    evidence?(original: import('../controller/local-checks.js').LocalCheckView, action: 'inspect' | 'record'): Promise<void>;
    controller: Controller;
    projectId: string;
    signal: AbortSignal;
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    input(title: string, value?: string): Promise<string | undefined>;
    show(title: string, value: unknown): Promise<void>;
    notice(text: string): void;
    track<T>(task: Promise<T>): Promise<T>;
}
/** Owner command observations only: no model baseline, agent ceremony or replacement journal. */
export function localCheckCommands(h: Host) {
    const c = h.controller, runtime = () => JSON.stringify(c.options.runtimeProfile ?? null);
    const returnToTools = Symbol('return-to-local-tools');
    let originalWork: string | undefined;
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
    const perform = async (task: () => Promise<import('../controller/types.js').ObservationResult>, command: string) => {
        const profile = runtime();
        try {
            const result = await h.track(task());
            originalWork = result.workId;
            h.guard();
            h.notice('Local check retained · work ' + result.workId + ' · run ' + result.runId + ' · ' + result.status);
            const original = c.inspectLocalCheck(result.workId), snapshot = JSON.stringify(original);
            const fresh = () => {
                h.guard();
                if (runtime() !== profile || JSON.stringify(c.inspectLocalCheck(result.workId)) !== snapshot)
                    throw Error('Original local check changed while its result was open. Reopen this retained check before choosing a next action; no replacement attempt was started.');
            };
            await h.show('Local check result', localCheckResultText(result, command));
            fresh();
            const applicable = !original.unsettled && original.state === 'DELIVERED' && original.cwd === 'work' &&
                result.status === 'succeeded' && result.exitCode === 0 && result.cleanup === 'removed' && result.actualCwd === '/work' &&
                original.result?.runId === result.runId && original.latestRun?.runId === result.runId &&
                original.latestRun.resultId === original.result.resultId && original.latestRun.phase === 'SETTLED' &&
                original.latestRun.cleanup === 'removed' && original.result.status === result.status &&
                original.result.exitCode === result.exitCode && original.result.cleanup === result.cleanup &&
                original.latestRun.command === command;
            while (true) {
                const action = await h.choose('Next step for this check', [
                    'Return to local tools', 'Inspect original receipt',
                    ...(h.evidence && applicable ? ['Inspect current check correspondence', 'Record exact commit candidate'] : []),
                    ...(h.navigate ? ['Open original work recovery and allowances'] : []),
                ]);
                fresh();
                if (!action || action === 'Return to local tools') return returnToTools;
                if (action === 'Inspect original receipt') {
                    await h.show('Original local check receipt · retained attempt', result);
                    fresh();
                    continue;
                }
                if (action === 'Open original work recovery and allowances' && h.navigate)
                    return await h.navigate('/work ' + result.workId);
                if (h.evidence && applicable && ['Inspect current check correspondence', 'Record exact commit candidate'].includes(action)) {
                    await h.evidence(original, action === 'Record exact commit candidate' ? 'record' : 'inspect');
                    if (action === 'Record exact commit candidate') return returnToTools;
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
        if (c.options.runtimeProfile)
            return true;
        await h.show('Local check unavailable · no work admitted', 'No active execution runtime. Configure /setup runtime and choose Save and apply runtime. Model selection is not required. No check was started.');
        return await chooseRecoveryEntry(h, h.guard, [{ command: '/setup runtime', label: 'Configure execution runtime' }, { command: '/ready', label: 'Inspect setup and next steps' }]) ?? false;
    };
    const newCheck = async () => {
        h.guard();
        originalWork = undefined;
        const ready = await active();
        if (ready !== true)
            return ready;
        const profile = runtime(), command = await h.input('Isolated check command · exact single line · no host shell', '');
        if (command === undefined)
            return false;
        if (!command.trim() || Buffer.byteLength(command) > 32768)
            throw Error('Enter a nonempty check command up to 32 KiB');
        const cwd = await h.choose('Isolated check working directory', ['/work · captured project, read only', '/scratch · mutable scratch, not source verification', 'Cancel']);
        if (!cwd || cwd === 'Cancel')
            return false;
        const selected = cwd.startsWith('/work ') ? 'work' : cwd.startsWith('/scratch ') ? 'scratch' : undefined;
        if (!selected)
            throw Error('Unknown check working directory');
        const guard = () => {
            h.guard();
            if (runtime() !== profile)
                throw Error('Active runtime changed; reopen local check review');
        };
        guard();
        await h.show('Review new independent local check', localCheckReviewText({ projectId: h.projectId, command, cwd: '/' + selected, nextAttemptRuntime: JSON.parse(profile), executionAllowance: initialWorkAllowance, scope: 'New independent owner check, not agent procedure or commit approval. /scratch cannot establish source correspondence. Project code executes only in the configured restricted runtime.' }));
        guard();
        const choice = await h.choose('Explicit local check action', ['Back without starting', 'Run new independent check']);
        guard();
        if (!choice || choice === 'Back without starting')
            return false;
        if (choice !== 'Run new independent check')
            throw Error('Unknown check admission action');
        h.notice('Running isolated local check · ' + h.projectId + ' · /' + selected + ' · no model turn');
        const outcome = await perform(() => c.startOwnerLocalCheck({ projectId: h.projectId, command, cwd: selected, signal: h.signal }, guard), command);
        return outcome === returnToTools ? true : outcome ?? true;
    };
    const browse = async () => {
        let cursor: string | undefined;
        const back: (string | undefined)[] = [];
        while (true) {
            h.guard();
            const page = c.listLocalChecks(h.projectId, { limit: 25, ...cursor ? { before: cursor } : {} }), labels = page.checks.map(check => check.state === 'RETAINED' ? `${check.recordedState} · /${check.cwd} · ${check.commandPreview} · ${check.workId}` : `Unavailable local check · ${check.workId}`), picked = await h.choose('Retained local checks · ' + h.projectId + ' · opening does not resume', [...labels, ...page.nextCursor ? ['Older checks'] : [], ...back.length ? ['Newer checks'] : [], 'Back']);
            if (!picked || picked === 'Back')
                return;
            if (picked === 'Older checks' && page.nextCursor) {
                back.push(cursor);
                cursor = page.nextCursor;
                continue;
            }
            if (picked === 'Newer checks' && back.length) {
                cursor = back.pop();
                continue;
            }
            const selected = page.checks[labels.indexOf(picked)];
            if (!selected)
                throw Error('Local check selection changed');
            if (selected.state === 'UNAVAILABLE') {
                await h.show('Unavailable original check', selected);
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
            const captured = JSON.stringify(original), profile = runtime(), guard = () => {
                h.guard();
                if (JSON.stringify(c.inspectLocalCheck(id)) !== captured || runtime() !== profile)
                    throw Error('Original check or active runtime changed; reopen its current details');
            };
            const choice = await h.choose('Original local check · ' + original.state + ' · ' + id, ['Inspect original check and allowance', ...(original.result ? ['Inspect original result and output'] : []), ...(h.navigate ? ['Open original work recovery and allowances'] : []), ...h.evidence ? ['Inspect current check correspondence', 'Record exact commit candidate'] : [], 'Resume original check', 'Back']);
            guard();
            if (!choice || choice === 'Back')
                return;
            if (choice === 'Open original work recovery and allowances') {
                guard();
                return h.navigate!('/work ' + id);
            }
            if (choice === 'Inspect original check and allowance') {
                await h.show('Original command observation · history, not current candidate approval', localCheckHistoryText(original, JSON.parse(profile)));
                guard();
                continue;
            }
            if (choice === 'Inspect original result and output') {
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
                await h.show('Original local check result and output · retained attempt', appendObservation(localCheckResultText(result, run.data.raw), result));
                guard();
                continue;
            }
            if (choice === 'Inspect current check correspondence' || choice === 'Record exact commit candidate') {
                await h.evidence!(original, choice === 'Inspect current check correspondence' ? 'inspect' : 'record');
                continue;
            }
            if (choice !== 'Resume original check')
                throw Error('Unknown original-check action');
            if (Buffer.byteLength(original.command) > 32768) {
                await h.show('Original check exceeds terminal command bound', 'Use the explicit work resume CLI after inspecting the complete original command. No attempt started.');
                continue;
            }
            if (original.unsettled || !['DELIVERED', 'BLOCKED', 'CANCELLED'].includes(original.state)) {
                await h.show('Original check requires recovery', { workId: id, state: original.state, nextAction: 'Use /work ' + id + ' and its original producer recovery. UNKNOWN, active or unsettled work cannot be replaced or resumed here.' });
                const outcome = await openWorkRecovery(h, id, guard);
                if (outcome)
                    return outcome;
                continue;
            }
            const ready = await active();
            if (ready !== true)
                return ready || undefined;
            guard();
            await h.show('Review original local check continuation', localCheckReviewText({ workId: id, projectId: original.projectId, command: original.command, cwd: '/' + original.cwd, epoch: original.epoch, state: original.state, allowance: original.allowance, previousRuntime: original.latestRun?.runtime ?? null, nextAttemptRuntime: JSON.parse(profile), scope: 'Same original work, command and cwd. Consumed allowance remains spent; this action creates a new bounded attempt, not a replacement work or an agent approval.' }));
            guard();
            const label = original.state === 'CANCELLED' ? 'Resume cancelled original check' : 'Resume original command';
            const decision = await h.choose('Explicit original-check action', ['Back without resuming', label]);
            guard();
            if (!decision || decision === 'Back without resuming')
                continue;
            if (decision !== label)
                throw Error('Unknown original continuation action');
            originalWork = id;
            const outcome = await perform(() => c.resumeOwnerLocalCheck({ expected: original, resumeCancelled: original.state === 'CANCELLED', signal: h.signal }, guard), original.command);
            return outcome;
        }
    };
    return { newCheck, browse };
}

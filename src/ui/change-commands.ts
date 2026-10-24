import type { Controller } from '../controller/controller.js';
import type { ApplicationModels } from '../app/models.js';
import type { PiModelSelection } from '../pi/session.js';
import type { ChangeView } from '../controller/change-types.js';
import type { HostCommand, HostCommandContext, HostCommandExecutor } from './host-commands.js';
import { captureResultDelivery } from './result-delivery.js';
import { ContextAssignmentUnavailable } from '../controller/context-coordination.js';
import { changeResultText } from './change-result.js';
import { uiText, type UiLocale } from './i18n.js';
interface ChangeHost {
    execute?: HostCommandExecutor;
    controller: Controller;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    isCurrent(target: string): boolean;
    locale?(target: string): UiLocale;
    controls?: {
        models?: ApplicationModels;
        model?: PiModelSelection;
        input(title: string, value: string): Promise<string | undefined>;
        draft(target: string): string;
        notice(text: string): void;
        activateSource(target: string): Promise<void>;
        launch(target: string, task: Promise<ChangeView>, workId?: string, submission?: HostCommandContext['submission']): void;
    };
}
const bounded = (text: string, limit: number) => text.length <= limit ? text : text.slice(0, limit) + '\n[Display shortened; inspect the original retained work for full text]';
/** Inspection is read-only; execution requires a separate, snapshot-bound owner action. */
export function changeCommands(host: ChangeHost): HostCommand[] {
    const result = async (id: string, target: string, sourceGuard: () => void, context?: HostCommandContext) => {
        const locale = host.locale?.(target) ?? 'en';
        const captured = captureResultDelivery(host.controller, id);
        const fresh = () => { sourceGuard(); captured.assertCurrent(); };
        fresh();
        await host.show(uiText(locale, 'result.title'), changeResultText(captured.result, locale));
        fresh();
        if (!host.execute)
            return;
        const back = uiText(locale, 'result.back'), delivery = uiText(locale, 'result.reviewDelivery'), recovery = uiText(locale, 'result.recovery');
        const action = await host.choose(uiText(locale, 'result.nextTitle') + '\n' + uiText(locale, 'result.nextScope', { work: id, project: captured.projectId }),
            [back, ...(captured.result.reviewReady ? [delivery] : []), recovery]);
        fresh();
        if (!action || action === back)
            return;
        if (action !== recovery && action !== delivery)
            throw Error('Unknown result action; reopen /result');
        return host.execute(action === delivery ? '/repo deliver ' + id : '/work ' + id, target, context);
    };
    const inspect = async (id: string) => {
        const work = host.controller.inspectWork(id), change = host.controller.inspectChange(id), baseline = host.controller.getWorkApplicationModelBaseline(id);
        const request = work.source as {
            raw?: string;
        };
        const allowance = (name: string, value: {
            limit: number;
            consumed: number;
            reserved: number;
        }) => `${name}: ${value.consumed} consumed + ${value.reserved} reserved / ${value.limit}`;
        const text = [
            `Work: ${id}`, `Project: ${work.projectId}`, `State: ${work.state}`, `Owner activation: ${change.ownerActivation}`, `Phase: ${change.phase}`, `Next action: ${change.nextAction}`,
            `Review-ready: ${change.reviewReady ? 'yes; publication and merge are separate' : 'no'}`,
            `Captured model: ${baseline ? baseline.choice.provider + '/' + baseline.choice.modelId + ' · ' + baseline.choice.thinkingLevel : 'explicit external model profile required'}`,
            `Origin conversation: ${baseline?.source.kind === 'conversation' ? baseline.source.conversationId : 'owner entry or retained assignment'}`,
            allowance('Execution', change.execution), allowance('Resolution', change.resolution),
            `Findings: ${change.occurrences.length} occurrences · ${change.dispositions.length} dispositions`,
            `Blocked: ${change.blocked.length ? bounded(change.blocked.join('\n'), 8192) : 'none reported'}`,
            `Limits: ${bounded(change.limitations.join('\n'), 8192)}`, `Original request\n${bounded(request.raw ?? '(unavailable)', 32768)}`,
            `Terminal commands (in this chat):\n/work ${id} — choose recovery actions and allowances\n/change resume ${id} — review original resume\n/change cancel ${id} — review original cancellation`,
            'Inspection does not retry work or change allowances. Fix the retained cause before resuming; resume can use model credits after confirmation.',
        ].join('\n\n');
        await host.show('Managed change · inspection only', text);
    };
    const command: HostCommand = { name: 'change', description: 'Find retained managed changes and inspect their original state', argumentHint: '[start [REQUEST] | result/inspect/resume/cancel WORK_ID]', run: async (argument, target, context) => {
                const before = host.controller.inspectConversation(target), choice = host.controller.getConversationModelChoice(target), language = host.controller.getConversationLanguage(target);
                const assertCurrent = () => {
                    const now = host.controller.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== before.generation || now.projectId !== before.projectId || host.controller.getConversationModelChoice(target).revision !== choice.revision || host.controller.getConversationLanguage(target).revision !== language.revision || now.archived || now.deleted)
                        throw Error('Change inspection target changed; reopen /change');
                };
                assertCurrent();
                const controls = host.controls;
                const confirm = async (title: string, accept: string, details: string) => {
                    while (true) {
                        const selected = await host.choose(title, [accept, 'Inspect full request and limits', 'Cancel']);
                        assertCurrent();
                        if (!selected || selected === 'Cancel')
                            return false;
                        if (selected === 'Inspect full request and limits') {
                            await host.show(title, details);
                            assertCurrent();
                            continue;
                        }
                        if (selected !== accept)
                            throw Error('Unknown managed action; reopen /change');
                        return true;
                    }
                };
                const start = async (request?: string) => {
                    if (!controls)
                        throw Error('Work controls are not available in this host');
                    if (!before.projectId)
                        throw Error('Select a project with /project before starting managed work');
                    if (!host.controller.options.runtimeProfile)
                        throw Error('Configure the execution runtime with /setup runtime and choose Save and apply runtime before starting managed work');
                    const original = host.controller.conversationChange(target).workId;
                    if (original)
                        throw Error('This conversation already refers to work ' + original + '; use /change Resume a retained change. The new request was not applied');
                    if (!request) {
                        const draft = controls.draft(target), useDraft = 'Use current draft as the owner request';
                        const picked = await host.choose('Managed owner request', [...(!draft.trimStart().startsWith('/') && draft.trim() ? [useDraft] : []), 'Write a request', 'Cancel']);
                        assertCurrent();
                        if (!picked || picked === 'Cancel')
                            return 'cancelled' as const;
                        if (picked === useDraft)
                            request = draft;
                        else if (picked === 'Write a request')
                            request = await controls.input('Managed owner request · task intent', '');
                        else
                            throw Error('Unknown request source');
                        assertCurrent();
                    }
                    if (request === undefined)
                        return 'cancelled' as const;
                    if (!request.trim())
                        throw Error('An explicit owner request is required');
                    const baseline = choice.kind === 'managed' && controls.models ? { ...await controls.models.baseline(before.projectId, choice), source: { kind: 'conversation' as const, conversationId: target, choiceRevision: choice.revision } } : undefined;
                    assertCurrent();
                    if (!baseline && (!controls.model || choice.kind === 'legacy-external' && (choice.provider !== controls.model.provider || choice.modelId !== controls.model.modelId)))
                        throw Error('Select /model or use the matching explicit external profile before managed work');
                    const model = baseline?.choice ?? controls.model!, label = model.provider + '/' + model.modelId;
                    const details = `Project: ${before.projectId}\nModel: ${label}\nEndpoint: review-ready; publication and merge are separate.\nCapture and subsequent attempts consume the retained work/family allowance.\nOwner request\n${request}`;
                    if (!await confirm('Start managed work · ' + before.projectId + ' · ' + label, 'Start workflow to review-ready · capture uses allowance · ' + request.replace(/\s+/gu, ' ').slice(0, 80), details))
                        return 'cancelled' as const;
                    assertCurrent();
                    const task = host.controller.startConversationChange({ conversationId: target, expectedGeneration: before.generation, expectedModelRevision: choice.revision, projectId: before.projectId, request, ...(baseline ? { applicationModelBaseline: baseline } : { model: controls.model! }) });
                    controls.launch(target, task, undefined, context?.submission);
                    return 'started' as const;
                };
                const act = async (action: 'resume' | 'cancel', id: string) => {
                    if (!controls)
                        throw Error('Work controls are not available in this host');
                    const work = host.controller.inspectWork(id), change = host.controller.inspectChange(id), baseline = host.controller.getWorkApplicationModelBaseline(id), source = work.source as {
                        raw?: string;
                        origin?: {
                            conversationId?: string;
                        };
                    };
                    const assertWork = () => {
                        assertCurrent();
                        if (host.controller.inspectWork(id).epoch !== work.epoch)
                            throw Error('Original work changed; inspect it before another action');
                    };
                    if (action === 'resume' && source.origin?.conversationId && source.origin.conversationId !== target) {
                        const cid = source.origin.conversationId, view = host.controller.inspectConversation(cid);
                        const sourceModel = host.controller.getConversationModelChoice(cid);
                        if (view.deleted || view.archived)
                            throw Error('Restore the original source conversation before resuming this work');
                        const open = 'Open original conversation and review resume · ' + cid;
                        const selected = await host.choose('Resume uses its original conversation · no execution yet · ' + work.projectId, [open, 'Cancel']);
                        assertWork();
                        if (!selected || selected === 'Cancel')
                            return 'cancelled' as const;
                        if (selected !== open)
                            throw Error('Unknown source action');
                        const current = host.controller.inspectConversation(cid);
                        if (current.deleted || current.archived || current.generation !== view.generation)
                            throw Error('Original source changed; reopen its action');
                        await controls.activateSource(cid);
                        const activated = host.controller.inspectConversation(cid);
                        if (!host.isCurrent(cid) || activated.deleted || activated.archived || activated.generation !== view.generation || activated.projectId !== view.projectId || host.controller.getConversationModelChoice(cid).revision !== sourceModel.revision || host.controller.inspectWork(id).epoch !== work.epoch)
                            throw Error('Original source or work changed while opening resume; reopen /change');
                        // Carry the chosen intent, never the prior form's permission or draft acknowledgement.
                        // The original owner gets a fresh review and final admission checks.
                        return command.run('resume ' + id, cid);
                    }
                    const label = baseline ? baseline.choice.provider + '/' + baseline.choice.modelId : controls.model ? controls.model.provider + '/' + controls.model.modelId : 'explicit external profile required';
                    const details = `Work: ${id}\nProject: ${work.projectId}\nState: ${work.state}\n${baseline ? 'Original model' : 'Explicit invocation model; original external profile required'}: ${label}\nEpoch: ${work.epoch}\nNext action: ${change.nextAction}\nExecution: ${change.execution.consumed} consumed + ${change.execution.reserved} reserved / ${change.execution.limit}\nResolution: ${change.resolution.consumed} consumed + ${change.resolution.reserved} reserved / ${change.resolution.limit}\nOriginal request\n${source.raw ?? '(unavailable)'}\n${action === 'cancel' ? 'Cancellation covers this work and its delegated executions. Its unfinished original assignment and result wait are cancelled as well; parent and sibling work are kept. History and cleanup obligations remain; prior external effects are not undone.' : 'Resume preserves original identity, model and allowances. Pending activation uses its captured profile. The endpoint is review-ready; publication and merge are separate.'}`;
                    const accept = action === 'cancel' ? 'Cancel this work and its delegated executions' : ['CANCELLED', 'INTERRUPTED'].includes(work.state) ? 'Recover and resume this original work' : 'Resume this original work';
                    if (!await confirm((action === 'cancel' ? 'Cancel' : 'Resume') + ' · ' + work.projectId + ' · #' + id + ' · ' + work.state + ' · ' + label, accept, details))
                        return 'cancelled' as const;
                    assertWork();
                    if (action === 'cancel') {
                        await host.controller.cancelWork({ workId: id, expectedEpoch: work.epoch });
                        controls.notice('Cancellation recorded · ' + id + ' · history and cleanup obligations retained');
                        return 'completed' as const;
                    }
                    const task = host.controller.resumeConversationChange({ conversationId: target, expectedGeneration: before.generation, expectedModelRevision: choice.revision, workId: id, expectedEpoch: work.epoch, resumeCancelled: ['CANCELLED', 'INTERRUPTED'].includes(work.state), ...(!baseline && controls.model ? { model: controls.model } : {}) });
                    controls.launch(target, task, id, context?.submission);
                    return 'started' as const;
                };
                let action: 'inspect' | 'result' | 'resume' | 'cancel' = 'inspect';
                if (argument) {
                    const match = /^(result|inspect|resume|cancel)\s+(\S+)$/u.exec(argument);
                    if (match) {
                        if (match[1] === 'result') {
                            return result(match[2]!, target, assertCurrent, context);
                        }
                        if (match[1] === 'inspect') {
                            await inspect(match[2]!);
                            return;
                        }
                        return act(match[1] as 'resume' | 'cancel', match[2]!);
                    }
                    const beginning = /^start(?:\s+([\s\S]+))?$/u.exec(argument);
                    if (beginning)
                        return start(beginning[1]);
                    if (argument === 'result' || argument === 'resume' || argument === 'cancel')
                        action = argument;
                    else
                        throw Error('Use /change to find work, or /change start, result, inspect, resume or cancel');
                }
                if (action === 'result') {
                    let linked = before.workId && host.controller.inspectChangeActivity(before.workId) ? before.workId : null;
                    if (!linked && !before.role) {
                        try { linked = host.controller.conversationChange(target).workId; }
                        catch (error) {
                            if (!(error instanceof ContextAssignmentUnavailable) || !error.workId) throw error;
                            linked = error.workId;
                        }
                    }
                    if (linked) { return result(linked, target, assertCurrent, context); }
                }
                let projectId: string | undefined = action === 'result' ? before.projectId ?? undefined : undefined, cursor: string | undefined;
                const newer: (string | undefined)[] = [];
                while (true) {
                    assertCurrent();
                    const page = host.controller.listChanges({ limit: 50, ...(projectId ? { projectId } : {}), ...(cursor ? { before: cursor } : {}) });
                    const labels = page.changes.map(work => `${work.projectId} · #${work.workId} · ${work.state} · recorded ${work.recordedPhase} · ${work.requestPreview.replace(/\s+/gu, ' ').slice(0, 90)}`);
                    const startNew = 'Start a new managed change', resume = 'Resume a retained change', cancel = 'Cancel a retained change';
                    const all = 'All projects · first page', current = 'Current project only · first page', more = 'Older changes · next page', back = 'Newer changes · previous page', refresh = 'Refresh this page', close = 'Close · inspection only';
                    const selected = await host.choose(`${action === 'result' ? uiText(host.locale?.(target) ?? 'en', 'result.title') : action === 'inspect' ? 'Managed changes' : action === 'resume' ? 'Resume managed change' : 'Cancel managed change'} · ${projectId ?? 'all projects'}${cursor ? ' · older page' : ''}${page.changes.length ? '' : ' · none retained'}`, [...labels, ...(controls && action === 'inspect' ? [startNew, resume, cancel] : []), ...(page.nextCursor ? [more] : []), ...(newer.length ? [back] : []), refresh, ...(before.projectId && projectId !== before.projectId ? [current] : []), ...(projectId || cursor ? [all] : []), close]);
                    if (!selected || selected === close)
                        return 'cancelled';
                    assertCurrent();
                    if (selected === startNew)
                        return start();
                    if (selected === resume) {
                        action = 'resume';
                        continue;
                    }
                    if (selected === cancel) {
                        action = 'cancel';
                        continue;
                    }
                    if (selected === more && page.nextCursor) {
                        newer.push(cursor);
                        cursor = page.nextCursor;
                        continue;
                    }
                    if (selected === refresh)
                        continue;
                    if (selected === back && newer.length) {
                        cursor = newer.pop();
                        continue;
                    }
                    if (selected === current && before.projectId) {
                        projectId = before.projectId;
                        cursor = undefined;
                        newer.length = 0;
                        continue;
                    }
                    if (selected === all) {
                        projectId = undefined;
                        cursor = undefined;
                        newer.length = 0;
                        continue;
                    }
                    const chosen = page.changes[labels.indexOf(selected)];
                    if (!chosen)
                        throw Error('Unknown retained change selection; reopen /change');
                    if (action === 'inspect') {
                        await inspect(chosen.workId);
                        return;
                    }
                    if (action === 'result') { return result(chosen.workId, target, assertCurrent, context); }
                    return act(action, chosen.workId);
                }
            } };
    return [command, { name: 'result', description: 'See changed files, checks, review and the saved task output', argumentHint: '[WORK_ID]',
        run: (argument, target, context) => command.run(argument ? 'result ' + argument : 'result', target, context) }];
}

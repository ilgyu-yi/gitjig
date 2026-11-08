import type { Controller } from '../controller/controller.js';
import type { HostCommand } from './host-commands.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { captureResultDelivery } from './result-delivery.js';
import { inspectSourceSave, prepareSourceSave, saveSourceProposal, type SourceSaveHost } from './source-save.js';
import { quoteIdentity } from './inspection-text.js';
import { uiText, type UiLocale } from './i18n.js';

interface Host {
    controller: Controller;
    locale(target: string): UiLocale;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
}

/** Owner-only terminal entry. Core action records own permission and settlement. */
export function sourceSaveCommands(host: Host) {
    const c = host.controller, abort = new AbortController(), pending = new Set<Promise<unknown>>();
    let closing = false;
    const commands: HostCommand[] = [{ name: 'save', description: 'Review and save a result to a new source branch, or inspect its original request',
        argumentHint: '[WORK_ID | list | operation OPERATION_ID | proposal WORK_ID PROPOSAL_ID]',
        async run(argument, target) {
            const captured = c.inspectConversation(target), language = c.getConversationLanguage(target).revision,
                model = c.getConversationModelChoice(target).revision, locale = host.locale(target);
            const guard = () => {
                abort.signal.throwIfAborted();
                const now = c.inspectConversation(target);
                if (closing || !host.isCurrent(target) || now.generation !== captured.generation || now.projectId !== captured.projectId ||
                    now.archived || now.deleted || c.getConversationLanguage(target).revision !== language || c.getConversationModelChoice(target).revision !== model)
                    throw Error(uiText(locale, 'save.sourceChanged'));
            };
            guard();
            const ui: SourceSaveHost = { locale, signal: abort.signal, guard,
                choose: host.choose, ...host.chooseItems ? { chooseItems: host.chooseItems } : {}, input: host.input, show: host.show, notice: host.notice,
                progress<T>(title: string, task: (signal: AbortSignal) => Promise<T>) {
                    // Register before a callback can close the host; never track a picker.
                    const result = Promise.resolve().then(() => {
                        guard();
                        return host.runPreparation ? host.runPreparation(title, signal => task(AbortSignal.any([abort.signal, signal])), {
                            running: uiText(locale, 'save.progressRunning'), cancelling: uiText(locale, 'save.progressCancelling'), cancelHint: uiText(locale, 'save.progressCancelHint'),
                        }) : task(abort.signal);
                    });
                    pending.add(result); void result.then(() => pending.delete(result), () => pending.delete(result)); return result;
                },
            };
            const pick = async (title: string, items: UiChoice[]) => { guard(); const selected = await chooseUiItem(host, title, items); guard(); return selected; };
            const back = () => ({ value: 'back', label: uiText(locale, 'save.back') });
            const inspectOriginal = async (id: string) => {
                try { return await inspectSourceSave(ui, c, id); }
                catch (error) { throw Error(uiText(locale, 'save.retainedError', { id }) + ' ' + (error instanceof Error ? error.message : String(error)), { cause: error }); }
            };
            const browseWork = async (workId: string) => {
                if (!c.inspectChangeActivity(workId)) { await host.show(uiText(locale, 'save.notManagedWork'), quoteIdentity(workId)); guard(); return; }
                const result = captureResultDelivery(c, workId);
                if (captured.projectId !== result.projectId) {
                    await host.show(uiText(locale, 'save.foreignScope'), uiText(locale, 'save.foreignReview', { work: workId, project: result.projectId, conversationProject: captured.projectId ?? '—', source: quoteIdentity(result.result.registeredSourceRoot) })); guard(); result.assertCurrent();
                }
                let cursor: string | undefined; const previous: (string | undefined)[] = [];
                while (true) {
                    guard();
                    const page = c.listSourceSnapshotProposals({ workId, limit: 25, ...cursor ? { after: cursor } : {} });
                    const selected = await pick(uiText(locale, 'save.workMenu', { work: workId, project: result.projectId, conversationProject: captured.projectId ?? '—' }), [back(),
                        ...result.result.reviewReady ? [{ value: 'new', label: uiText(locale, 'save.new') }] : [],
                        ...page.proposals.map((proposal, index) => ({ value: 'proposal:' + index, label: uiText(locale, 'save.proposalRow', { id: proposal.proposalId }) })),
                        ...page.nextCursor ? [{ value: 'next', label: uiText(locale, 'save.nextPage') }] : [],
                        ...previous.length ? [{ value: 'previous', label: uiText(locale, 'save.previousPage') }] : [],
                    ]);
                    if (!selected || selected === 'back') return;
                    if (selected === 'next' && page.nextCursor) { previous.push(cursor); cursor = page.nextCursor; continue; }
                    if (selected === 'previous' && previous.length) { cursor = previous.pop(); continue; }
                    result.assertCurrent();
                    const actionUi = { ...ui, guard: () => { guard(); result.assertCurrent(); } };
                    const outcome = selected === 'new' ? await prepareSourceSave(actionUi, c, workId) : await saveSourceProposal(actionUi, c, { workId, proposalId: page.proposals[Number(selected.slice(9))]?.proposalId ?? '' });
                    guard();
                    if (outcome) { await inspectOriginal(outcome.operationId); return; }
                }
            };
            const browse = async () => {
                let after: number | undefined, workBefore: string | undefined;
                const older: (number | undefined)[] = [], newerWorks: (string | undefined)[] = [];
                let works = false;
                while (true) {
                    guard();
                    const operations = works ? null : c.listSourceSnapshotOperations({ limit: 25, ...after !== undefined ? { after } : {} });
                    const workPage = works ? c.listWorks({ limit: 25, ...workBefore ? { before: workBefore } : {} }) : null;
                    const entries: UiChoice[] = [back(), { value: 'mode', label: uiText(locale, works ? 'save.operations' : 'save.findWork') }];
                    if (operations) operations.operations.forEach((row, i) => entries.push({ value: 'operation:' + i, label: row.state === 'RETAINED'
                        ? `${row.recordedPhase} · ${quoteIdentity(row.binding.destinationRef)} · ${row.operationId}`
                        : uiText(locale, 'save.unavailableRow', { ordinal: i + 1 }) }));
                    if (workPage) workPage.works.forEach((row, i) => entries.push({ value: 'work:' + i, label: `${quoteIdentity(row.projectId)} · ${quoteIdentity(row.workId)} · ${quoteIdentity(row.requestPreview)}` }));
                    const next = operations?.nextCursor ?? workPage?.nextCursor;
                    if (next != null) entries.push({ value: 'next', label: uiText(locale, 'save.nextPage') });
                    if ((works ? newerWorks : older).length) entries.push({ value: 'previous', label: uiText(locale, 'save.previousPage') });
                    const selected = await pick(uiText(locale, works ? 'save.findWork' : 'save.operations'), entries);
                    if (!selected || selected === 'back') return;
                    if (selected === 'mode') { works = !works; continue; }
                    if (selected === 'next') { if (workPage?.nextCursor) { newerWorks.push(workBefore); workBefore = workPage.nextCursor; } else if (operations?.nextCursor != null) { older.push(after); after = operations.nextCursor; } continue; }
                    if (selected === 'previous') { if (works) workBefore = newerWorks.pop(); else after = older.pop(); continue; }
                    if (selected.startsWith('work:') && workPage) { const work = workPage.works[Number(selected.slice(5))]!; if (work.recordedPhase) await browseWork(work.workId); else { await host.show(uiText(locale, 'save.notManagedWork'), quoteIdentity(work.workId)); guard(); } }
                    else if (selected.startsWith('operation:') && operations) {
                        const original = operations.operations[Number(selected.slice(10))]!;
                        if (original.operationId) await inspectOriginal(original.operationId);
                        else if (original.state === 'UNAVAILABLE') { await host.show(uiText(locale, 'save.unavailable'), quoteIdentity(original.reason)); guard(); }
                    }
                }
            };
            const words = argument.trim().split(/\s+/u).filter(Boolean);
            if (!words.length) { if (captured.workId && c.inspectChangeActivity(captured.workId)) await browseWork(captured.workId); else await browse(); }
            else if (words.length === 1 && words[0] === 'list') await browse();
            else if (words.length === 2 && words[0] === 'operation') await inspectOriginal(words[1]!);
            else if (words.length === 3 && words[0] === 'proposal') {
                const result = captureResultDelivery(c, words[1]!);
                const outcome = await saveSourceProposal({ ...ui, guard: () => { guard(); result.assertCurrent(); } }, c, { workId: words[1]!, proposalId: words[2]! });
                guard(); if (outcome) await inspectOriginal(outcome.operationId);
            } else if (words.length === 1 && !['operation', 'proposal'].includes(words[0]!)) await browseWork(words[0]!);
            else throw Error(uiText(locale, 'save.usage'));
        },
    }];
    return { commands, async close() { closing = true; abort.abort(); await Promise.allSettled([...pending]); } };
}

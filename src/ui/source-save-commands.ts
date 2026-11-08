import type { Controller } from '../controller/controller.js';
import type { HostCommand } from './host-commands.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { captureDeliveryWork, captureResultDelivery } from './result-delivery.js';
import { inspectSourceSave, prepareSourceSave, saveSourceProposal, sourceSaveStatus, type SaveSelection, type SourceSaveHistoryScope, type SourceSaveHost } from './source-save.js';
import { escapeDisplayControls, quoteIdentity } from './inspection-text.js';
import { uiText, type UiLocale } from './i18n.js';
import { observeRecovery } from './recovery-navigation.js';
import { showReviewAction } from './exact-review.js';

interface Host {
    controller: Controller;
    locale(target: string): UiLocale;
    isCurrent(target: string): boolean;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show: SourceSaveHost['show'];
    notice(text: string): void;
    runPreparation?<T>(title: string, task: (signal: AbortSignal, output: (text: string) => void) => Promise<T>, presentation?: { running: string; cancelling: string; cancelHint: string }): Promise<T>;
}

type WorkHistory = SourceSaveHistoryScope & { projectId: string; assertCurrent(): void };
type OriginalSave = ReturnType<Controller['inspectSourceSnapshotOperation']>;
type RetainedSave = Extract<OriginalSave, { state: 'RETAINED' }>;

function originalActionAdmitted(before: RetainedSave, after: OriginalSave) {
    return after.state === 'RETAINED' && ((!before.nativeAttempt && !!after.nativeAttempt) ||
        after.nativeReads.length > before.nativeReads.length);
}

/** Owner-only terminal entry. Core action records own permission and settlement. */
export function sourceSaveCommands(host: Host) {
    const c = host.controller, abort = new AbortController(), pending = new Set<Promise<unknown>>();
    let closing = false;
    const commands: HostCommand[] = [{ name: 'save', descriptionId: 'command.description.save',
        argumentHint: '[WORK_ID | list | history WORK_ID | operation OPERATION_ID | proposal WORK_ID PROPOSAL_ID]',
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
                progress<T>(title: string, task: (signal: AbortSignal, output?: (line: string) => void) => Promise<T>) {
                    // Register before a callback can close the host; never track a picker.
                    const result = Promise.resolve().then(() => {
                        guard();
                        return host.runPreparation ? host.runPreparation(title, (signal, output) => task(AbortSignal.any([abort.signal, signal]), output), {
                            running: uiText(locale, 'save.progressRunning'), cancelling: uiText(locale, 'save.progressCancelling'), cancelHint: uiText(locale, 'save.progressCancelHint'),
                        }) : task(abort.signal);
                    });
                    pending.add(result); void result.then(() => pending.delete(result), () => pending.delete(result)); return result;
                },
            };
            const forResult = (result: ReturnType<typeof captureResultDelivery>): SourceSaveHost => ({
                ...ui, guard: () => { guard(); result.assertCurrent(); },
                guardOriginal: () => { guard(); result.assertWorkCurrent(); },
            });
            const pick = async (title: string, items: UiChoice[], check = guard, initialValue?: string) => {
                check();
                const selected = await chooseUiItem(host, title, items, initialValue);
                check();
                return selected;
            };
            const back = () => ({ value: 'back', label: uiText(locale, 'save.back') });
            const inspectOriginal = async (id: string, announceOutcome = false, historyScope?: SourceSaveHistoryScope, actionUi = ui) => {
                try { return await inspectSourceSave(actionUi, c, id, announceOutcome, historyScope); }
                catch (error) { throw Error(uiText(locale, 'save.retainedError', { id }) + ' ' + (error instanceof Error ? error.message : String(error)), { cause: error }); }
            };
            const finishSave = async (selection: SaveSelection, result: ReturnType<typeof captureResultDelivery>) => {
                const { original } = selection;
                if (selection.kind === 'admitted') {
                    await inspectOriginal(original.operationId, true);
                    return 'completed' as const;
                }
                const historyUi = { ...ui, guard: () => { guard(); result.assertWorkCurrent(); } };
                const latest = await inspectOriginal(original.operationId, false, { workId: result.workId, expectedOriginal: original }, historyUi);
                return originalActionAdmitted(original, latest) ? 'completed' as const : 'cancelled' as const;
            };
            const readWork = (workId: string) => observeRecovery(() => c.inspectChangeActivity(workId)
                ? { kind: 'retained' as const, result: captureResultDelivery(c, workId, { locale }) }
                : { kind: 'other' as const }) ?? { kind: 'unavailable' as const };
            const unavailableWork = async (workId: string): Promise<'completed' | 'cancelled'> => {
                const history = observeRecovery(() => {
                    const scope = captureDeliveryWork(c, workId, locale);
                    if (c.listSourceSnapshotOperations({ workId, limit: 1 }).operations.length)
                        return { ...scope, historyOnly: true };
                });
                const title = uiText(locale, 'result.workUnavailable', { work: escapeDisplayControls(workId) });
                const detail = uiText(locale, 'save.workResultUnavailableBody');
                if (!history) {
                    await host.show(title, detail);
                    guard();
                    return 'cancelled';
                }
                const open = await showReviewAction({ show: host.show }, title, detail, uiText(locale, 'save.workHistory'));
                guard();
                return open ? browse(history) : 'cancelled';
            };
            const browseWork = async (workId: string, observed = readWork(workId)): Promise<'completed' | 'cancelled'> => {
                if (observed.kind === 'unavailable')
                    return unavailableWork(workId);
                if (observed.kind === 'other') {
                    await host.show(uiText(locale, 'save.notManagedWork'), quoteIdentity(workId));
                    guard();
                    return 'completed';
                }
                const { result } = observed;
                if (captured.projectId !== result.projectId) {
                    const open = await showReviewAction({ show: host.show }, uiText(locale, 'save.foreignScope'),
                        uiText(locale, 'save.foreignReview', { work: workId, project: result.projectId,
                            conversationProject: captured.projectId ?? '—', source: quoteIdentity(result.result.registeredSourceRoot) }),
                        uiText(locale, 'save.foreignOpen'));
                    guard();
                    if (!open) return 'cancelled';
                    result.assertCurrent();
                }
                let cursor: string | undefined, focusedProposal: string | undefined;
                const previous: (string | undefined)[] = [];
                while (true) {
                    guard();
                    const page = c.listSourceSnapshotProposals({ workId, limit: 25, ...cursor ? { after: cursor } : {} });
                    const hasOriginals = c.listSourceSnapshotOperations({workId, limit: 1}).operations.length > 0;
                    const selected = await pick(uiText(locale, 'save.workMenu', { work: workId, project: result.projectId, conversationProject: captured.projectId ?? '—' }), [back(),
                        ...hasOriginals ? [{ value: 'history', label: uiText(locale, 'save.workHistory') }] : [],
                        ...result.result.reviewReady ? [{ value: 'new', label: uiText(locale, 'save.new') }] : [],
                        ...page.proposals.map(proposal => ({
                            value: 'proposal:' + proposal.proposalId,
                            label: proposal.metadata === 'retained'
                                ? uiText(locale, 'save.proposalRow', { branch: quoteIdentity(proposal.destinationRef), id: proposal.proposalId })
                                : uiText(locale, 'save.proposalUnavailableRow', { id: proposal.proposalId }),
                        })),
                        ...page.nextCursor ? [{ value: 'next', label: uiText(locale, 'save.nextPage') }] : [],
                        ...previous.length ? [{ value: 'previous', label: uiText(locale, 'save.previousPage') }] : [],
                    ], guard, focusedProposal);
                    if (!selected || selected === 'back') return 'cancelled';
                    if (selected === 'history') {
                        if (await browse({ workId, projectId: result.projectId, assertCurrent: result.assertWorkCurrent }) === 'completed')
                            return 'completed';
                        continue;
                    }
                    if (selected === 'next' && page.nextCursor) { previous.push(cursor); cursor = page.nextCursor; continue; }
                    if (selected === 'previous' && previous.length) { cursor = previous.pop(); continue; }
                    result.assertCurrent();
                    const actionUi = forResult(result);
                    const proposal = page.proposals.find(row => 'proposal:' + row.proposalId === selected);
                    if (proposal) focusedProposal = selected;
                    if (proposal?.metadata === 'unavailable') {
                        await host.show(uiText(locale, 'save.unavailable'), uiText(locale, 'save.proposalUnavailableRow', { id: proposal.proposalId }));
                        actionUi.guard();
                        continue;
                    }
                    if (selected !== 'new' && !proposal) throw Error(uiText(locale, 'save.sourceChanged'));
                    const outcome = proposal
                        ? await saveSourceProposal(actionUi, c, { workId, proposalId: proposal.proposalId, expectedArtifactHash: proposal.artifactHash })
                        : await prepareSourceSave(actionUi, c, workId);
                    guard();
                    if (outcome && await finishSave(outcome, result) === 'completed')
                        return 'completed';
                }
            };
            const browse = async (scope?: WorkHistory) => {
                const check = scope ? () => { guard(); scope.assertCurrent(); } : guard;
                const actionUi = { ...ui, guard: check };
                let after: number | undefined, workBefore: string | undefined, focused: string | undefined;
                const older: (number | undefined)[] = [], newerWorks: (string | undefined)[] = [];
                let works = false, admitted = false;
                while (true) {
                    check();
                    const operations = works ? null : c.listSourceSnapshotOperations({ limit: 25,
                        ...scope ? { workId: scope.workId } : {}, ...after !== undefined ? { after } : {} });
                    const workPage = works ? c.listWorks({ limit: 25, ...workBefore ? { before: workBefore } : {} }) : null;
                    const entries: UiChoice[] = [back()];
                    if (!scope) entries.push({ value: 'mode', label: uiText(locale, works ? 'save.operations' : 'save.findWork') });
                    const operationRows = operations?.operations.map(row => {
                        const label = row.state === 'RETAINED'
                            ? [uiText(locale, `save.history.${sourceSaveStatus(row)}`), quoteIdentity(row.binding.destinationRef), row.operationId].join(' · ')
                            : row.operationId
                                ? [uiText(locale, 'save.history.unavailable'), quoteIdentity(row.operationId)].join(' · ')
                                : uiText(locale, 'save.unavailableRow', { ordinal: row.position });
                        const value = row.operationId ? 'operation:' + row.operationId : 'unavailable:' + row.position;
                        return { row, choice: { value, label } };
                    }) ?? [];
                    const workRows = workPage?.works.map(row => {
                        const preview = typeof row.requestPreview === 'string' ? quoteIdentity(row.requestPreview) : uiText(locale, 'workRecovery.requestUnavailable');
                        return { row, choice: { value: 'work:' + row.workId, label: `${quoteIdentity(row.projectId)} · ${quoteIdentity(row.workId)} · ${preview}` } };
                    }) ?? [];
                    entries.push(...operationRows.map(item => item.choice), ...workRows.map(item => item.choice));
                    const next = operations?.nextCursor ?? workPage?.nextCursor;
                    if (next != null) entries.push({ value: 'next', label: uiText(locale, 'save.nextPage') });
                    if ((works ? newerWorks : older).length) entries.push({ value: 'previous', label: uiText(locale, 'save.previousPage') });
                    const title = scope ? uiText(locale, 'save.workHistoryTitle', {work: scope.workId, project: scope.projectId})
                        : uiText(locale, works ? 'save.findWork' : 'save.operations');
                    const selected = await pick(title, entries, check, focused);
                    if (!selected || selected === 'back') return admitted ? 'completed' : 'cancelled';
                    if (selected === 'mode') { works = !works; continue; }
                    if (selected === 'next') { if (workPage?.nextCursor) { newerWorks.push(workBefore); workBefore = workPage.nextCursor; } else if (operations?.nextCursor != null) { older.push(after); after = operations.nextCursor; } continue; }
                    if (selected === 'previous') { if (works) workBefore = newerWorks.pop(); else after = older.pop(); continue; }
                    const work = workRows.find(item => item.choice.value === selected)?.row;
                    if (work) {
                        focused = selected;
                        if (work.recordedPhase) {
                            await browseWork(work.workId);
                        } else {
                            await host.show(uiText(locale, 'save.notManagedWork'), quoteIdentity(work.workId));
                            guard();
                        }
                    }
                    const original = operationRows.find(item => item.choice.value === selected)?.row;
                    if (original) {
                        focused = original.operationId ? selected : undefined;
                        if (original.state === 'RETAINED') {
                            const latest = await inspectOriginal(original.operationId, false, scope, actionUi);
                            // A new attempt can change the caller's displayed allowance.
                            if (scope)
                                admitted ||= originalActionAdmitted(original, latest);
                        }
                        else {
                            const details = [original.operationId ?? uiText(locale, 'save.unavailableRow', {ordinal: original.position}), original.reason];
                            await host.show(uiText(locale, 'save.unavailable'), details.map(value => quoteIdentity(value)).join('\n'));
                            check();
                        }
                    }
                }
            };
            const words = argument.trim().split(/\s+/u).filter(Boolean);
            if (!words.length) {
                if (captured.workId) {
                    const observed = readWork(captured.workId);
                    if (observed.kind !== 'other')
                        return browseWork(captured.workId, observed);
                }
                await browse();
            }
            else if (words.length === 1 && words[0] === 'list') await browse();
            else if (words.length === 2 && words[0] === 'history') {
                const workId = words[1]!;
                const work = captureDeliveryWork(c, workId, locale, uiText(locale, 'save.historyScopeUnavailable'));
                return browse({ ...work, historyOnly: true });
            }
            else if (words.length === 2 && words[0] === 'operation') await inspectOriginal(words[1]!);
            else if (words.length === 3 && words[0] === 'proposal') {
                const result = captureResultDelivery(c, words[1]!, { locale });
                const outcome = await saveSourceProposal(forResult(result), c, { workId: words[1]!, proposalId: words[2]! });
                guard();
                return outcome ? finishSave(outcome, result) : 'cancelled';
            } else if (words.length === 1 && !['history', 'operation', 'proposal'].includes(words[0]!)) return browseWork(words[0]!);
            else throw Error(uiText(locale, 'save.usage'));
        },
    }];
    return { commands, async close() { closing = true; abort.abort(); await Promise.allSettled([...pending]); } };
}

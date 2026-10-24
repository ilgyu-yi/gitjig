import type { Controller } from '../controller/controller.js';
import type { HostCommand, HostCommandOutcome, HostCommandExecutor } from './host-commands.js';
import { showExactReview } from './exact-review.js';
import { changeResultText } from './change-result.js';
import { uiText, type UiLocale } from './i18n.js';
import { reviewCriteriaRefresh } from './criteria-refresh.js';
interface WorkHost {
    controller: Controller;
    isCurrent(target: string): boolean;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    notice(text: string): void;
    activate(target: string): Promise<void>;
    execute?: HostCommandExecutor;
    locale?(target: string): UiLocale;
}
const shorten = (value: unknown, max = 32768) => { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return text.length > max ? text.slice(0, max) + '\n[Display shortened; use CLI work inspect / change inspect for retained detail]' : text; };
export function workCommands(host: WorkHost): HostCommand[] {
    const c = host.controller;
    return [{ name: 'work', description: 'Inspect original work and choose explicit recovery, resume or cancellation', argumentHint: '[WORK_ID]', run: async (argument, target, context) => {
                const source = c.inspectConversation(target), choice = c.getConversationModelChoice(target);
                const current = () => {
                    const now = c.inspectConversation(target);
                    if (!host.isCurrent(target) || now.generation !== source.generation || now.projectId !== source.projectId || now.archived || now.deleted || c.getConversationModelChoice(target).revision !== choice.revision)
                        throw Error('Recovery source changed; reopen /work');
                };
                const evidence = async (id: string, kind: 'obligations' | 'findings') => {
                    let cursor: string | undefined;
                    const back: (string | undefined)[] = [];
                    while (true) {
                        current();
                        const page = c.listWorkEvidence(id, kind, cursor), labels = page.items.map(item => `${item.id} · ${kind === 'findings' ? (item.producer?.role ?? 'producer unavailable') + ' · ' + (item.disposition?.status ?? 'undisposed') : (item.data.state ?? 'state unavailable') + ' · ' + (item.data.kind ?? 'obligation')}`);
                        const picked = await host.choose(`${kind === 'findings' ? 'Finding occurrences' : 'Obligations and diagnostics'} · #${id}`, [...labels, ...(page.nextCursor ? ['Older evidence'] : []), ...(back.length ? ['Newer evidence'] : []), 'Close evidence']);
                        current();
                        if (!picked || picked === 'Close evidence')
                            return;
                        if (picked === 'Older evidence' && page.nextCursor) {
                            back.push(cursor);
                            cursor = page.nextCursor;
                            continue;
                        }
                        if (picked === 'Newer evidence' && back.length) {
                            cursor = back.pop();
                            continue;
                        }
                        const item = page.items[labels.indexOf(picked)];
                        if (!item)
                            throw Error('Evidence selection changed; reopen /work');
                        await host.show('Original ' + kind + ' · ' + item.id, shorten(item));
                        current();
                    }
                };
                const inspect = async (id: string): Promise<HostCommandOutcome | 'registry'> => {
                    while (true) {
                        current();
                        const work = c.inspectWorkRecovery(id), budget = (name: string, b: {
                            limit: number;
                            consumed: number;
                            reserved: number;
                        } | null) => `${name}: ${b ? `${b.consumed} consumed + ${b.reserved} reserved / ${b.limit}` : 'not applicable'}`;
                        const managedCommands = work.governed ? work.state === 'DELIVERED'
                            ? `\n/result ${id} — inspect saved output, changed files and current procedure assessment. Publication and merge remain separate operations.`
                            : `\nTerminal commands (in this chat):\n/work ${id} — recovery actions and allowances\n/change inspect ${id} — retained failure details\n/change resume ${id} — review original resume; may use model credits after confirmation\n/change cancel ${id} — review cancellation of this work and delegated executions\nFix any retained cause before resuming. Opening a review does not resolve a blocker.` : '';
                        const routes = new Map<string, string>();
                        if (host.execute && work.governed) {
                            routes.set(`Review managed change · /change inspect ${id}`, `/change inspect ${id}`);
                            if (['ACTIVE', 'BLOCKED', 'INTERRUPTED', 'CANCELLED'].includes(work.state))
                                routes.set(`Review resume · /change resume ${id}`, `/change resume ${id}`);
                            if (['ACTIVE', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN', 'QUARANTINED'].includes(work.state))
                                routes.set(`Review cancellation · /change cancel ${id}`, `/change cancel ${id}`);
                        }
                        const details = `Work: ${id}\nProject: ${work.projectId ?? 'none'}\nState: ${work.state}\nRecorded phase: ${work.recordedPhase ?? 'ordinary/local work'}\nNext: ${work.nextAction ?? 'Inspect original conversation and retained obligations before explicit resume'}\nShared lineage: ${work.lineageRoot}\nAffected works: ${work.family.count} (including later continuations)\n${budget('Execution', work.execution)}\n${budget('Resolution', work.resolution)}\nGoal turn allowance is separate and remains unchanged.\nOriginal conversation: ${work.conversationId ?? 'not retained'}\nObligations: ${work.obligations} · findings: ${work.findings}\nOwner request\n${shorten(work.request)}\nInspection and allowance extension do not resume work, resolve findings or reconcile unknown cleanup. Use /change for managed resume, /goal for goal execution, or CLI work resume with original work inputs.${managedCommands}`;
                        const locale = host.locale?.(target) ?? 'en', viewResult = uiText(locale, 'result.view'), refreshCriteria = uiText(locale, 'criteria.entry');
                        const action = await host.choose(`Work recovery · #${id} · ${work.state}`, ['Back to all works', ...(work.governed ? [viewResult] : []), ...routes.keys(), ...(work.governed && !source.role ? [refreshCriteria] : []), 'Inspect retained work and limits', `Obligations and diagnostics (${work.obligations})`, `Finding occurrences (${work.findings})`, ...(work.conversationId ? ['Open original conversation'] : []), ...(!work.governed && ['ordinary-conversation','investigation'].includes(work.kind) && work.state !== 'CANCELLED' ? ['Review cancellation of this original work'] : []), ...(work.kind === 'ordinary-conversation' && work.state === 'UNKNOWN' ? ['Review failed startup cleanup'] : []), ...(work.kind === 'ordinary-conversation' && ['CANCELLED', 'INTERRUPTED'].includes(work.state) ? ['Review original conversation admission recovery'] : []), ...(work.kind === 'ordinary-conversation' && work.contextDerived ? ['Review retained context admission recovery'] : []), 'Extend shared execution allowance', ...(work.governed ? ['Extend shared resolution allowance'] : [])]);
                        current();
                        if (!action)
                            return 'cancelled';
                        if (action === 'Back to all works')
                            return 'registry';
                        if (action === refreshCriteria && work.governed)
                            return reviewCriteriaRefresh({ ...host, locale, guard: current }, id, target);
                        if (action === viewResult && work.governed) {
                            await host.show(uiText(locale, 'result.title'), changeResultText(c.inspectChangeResult(id), locale));
                            continue;
                        }
                        const route = routes.get(action);
                        if (route) {
                            if (c.inspectWorkRecovery(id).epoch !== work.epoch)
                                throw Error('Original work changed; reopen /work');
                            const outcome = await host.execute!(route, target, context);
                            if (route.startsWith('/change inspect ')) {
                                current();
                                continue;
                            }
                            return outcome;
                        }
                        if (action === 'Review cancellation of this original work') {
                            const original = c.inspectWork(id);
                            const originalConversation = work.conversationId ? c.inspectConversation(work.conversationId) : null;
                            const token = (value: typeof original) => JSON.stringify({ id: value.workId, epoch: value.epoch, project: value.projectId, source: value.source, state: value.state });
                            const fresh = () => {
                                current();
                                if (token(c.inspectWork(id)) !== token(original)) throw Error('Original cancellation source changed; reopen /work');
                                if (originalConversation) {
                                    const now = c.inspectConversation(originalConversation.conversationId);
                                    if (now.generation !== originalConversation.generation || now.directionRevision !== originalConversation.directionRevision ||
                                        now.projectId !== originalConversation.projectId || now.workId !== originalConversation.workId)
                                        throw Error('Original conversation changed; reopen cancellation review');
                                }
                            };
                            await showExactReview(host, 'Review original work cancellation', {
                                workId: id, epoch: original.epoch, project: original.projectId, state: original.state, source: original.source,
                                scope: 'Cancel this exact work and tasks delegated by it, including its unfinished original assignment wait. Parent and sibling work are kept. Preserve input, history, spent allowance and cleanup obligations. Existing external effects are not undone.',
                            }, fresh, 'no cancellation yet');
                            fresh();
                            const choice = await host.choose('Cancel original work · #' + id, ['Back without cancellation', 'Cancel this original work and its delegated tasks']);
                            fresh();
                            if (!choice || choice === 'Back without cancellation') continue;
                            if (choice !== 'Cancel this original work and its delegated tasks') throw Error('Unknown original cancellation action');
                            await c.cancelWork({ workId: id, expectedEpoch: original.epoch });
                            host.notice('Work cancellation recorded · original history, spent allowance and cleanup obligations retained');
                            return 'completed';
                        }
                        if (action === 'Inspect retained work and limits') {
                            await host.show('Original work · inspection only', details);
                            continue;
                        }
                        if (action.startsWith('Obligations')) {
                            await evidence(id, 'obligations');
                            continue;
                        }
                        if (action.startsWith('Finding occurrences')) {
                            await evidence(id, 'findings');
                            continue;
                        }
                        if (action === 'Review failed startup cleanup') {
                            const context = await c.inspectStartupCleanup(id);
                            current();
                            if (!context.eligible) {
                                await showExactReview(host, 'Original startup cleanup still held', {
                                    ...context.review,
                                    holds: context.holds,
                                    nextAction: 'Preserve this work and its original runtime journal. Restore the original runtime route for normal reconciliation. A current missing-container message cannot clear an uncertain create or native process. No replacement task or forced reset is performed here.',
                                }, current, 'no recovery or dispatch');
                                continue;
                            }
                            await showExactReview(host, 'Review original startup rejection', {
                                workId: id, ...context.review,
                                evidence: 'The complete original controller observation identifies Docker rejecting this exact bind source before container allocation. This is not an inference from a current missing-container response.',
                                effects: 'Settle only this original failed run and release its quarantined capacity. Keep all spent allowance, requests, history and model choices. No grant renewal, model invocation, request withdrawal or retry occurs.',
                            }, current, 'no recovery yet');
                            current();
                            const decision = await host.choose('Confirm original startup cleanup recovery', [
                                'Back without recovery', 'Recover this rejected startup',
                            ]);
                            current();
                            if (decision !== 'Recover this rejected startup')
                                continue;
                            const result = await c.recoverStartupCleanup({ workId: id, expectedContext: context.fingerprint }, current);
                            const next = result.conversationId === target
                                ? 'open /inputs to review safe retry or withdrawal'
                                : `open /resume ${result.conversationId}, then /inputs to review the original requests`;
                            host.notice(`Original startup ${result.runId} reconciled · no execution · ${next}`);
                            return 'completed';
                        }
                        if (action === 'Review retained context admission recovery') {
                            const context = c.inspectContextWorkRecovery(id), fresh = () => {
                                current();
                                if (c.inspectContextWorkRecovery(id).fingerprint !== context.fingerprint)
                                    throw Error('Retained context recovery changed; reopen /work');
                            };
                            if (!context.eligible) {
                                await showExactReview(host, 'Retained context admission held', context.review, fresh, 'no recovery or dispatch');
                                continue;
                            }
                            const reason = await host.input('Owner reason to recover this retained context · 1..4096 bytes', '');
                            fresh();
                            if (reason === undefined)
                                continue;
                            if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                                throw Error('Enter a bounded owner recovery reason');
                            await showExactReview(host, 'Review exact retained context admission', { scope: 'Recover only this same direct ordinary clone/fork after separately restoring its original source root. Validate both retained native histories before committing. Preserve immutable context origin, ceiling, shared allowances, model source and original work. Create no input, model run, child, grant, grant renewal or send. If this review identifies one original cancelled outgoing task, archive and withdraw only its cancelled wait; that task and dependency stay cancelled. Restore that same assignment separately from this coordinator, then inspect its current direction before reentry. Other descendants require their own recovery.', context: context.review, reason }, fresh, 'no execution');
                            const decision = await host.choose('Confirm retained context admission recovery', ['Back without recovery', 'Recover this retained context admission']);
                            fresh();
                            if (!decision || decision === 'Back without recovery')
                                continue;
                            if (decision !== 'Recover this retained context admission')
                                throw Error('Unknown retained context recovery decision');
                            const result = await c.recoverContextWorkAdmission({ workId: id, expectedContext: context.fingerprint, reason }, fresh);
                            try {
                                host.notice('Original context work ' + result.workId + ' admission recovered · retained histories verified · no execution · continue explicitly');
                            }
                            catch (error) {
                                throw Error('Original context work ' + result.workId + ' admission recovered; no execution or grant renewal started', { cause: error });
                            }
                            return 'completed';
                        }
                        if (action === 'Review original conversation admission recovery') {
                            const context = c.inspectOrdinaryWorkRecovery(id), fresh = () => {
                                current();
                                if (c.inspectOrdinaryWorkRecovery(id).fingerprint !== context.fingerprint)
                                    throw Error('Original conversation recovery changed; reopen /work');
                            };
                            if (!context.eligible) {
                                await showExactReview(host, 'Original conversation admission held', context, fresh, 'no recovery or dispatch');
                                continue;
                            }
                            const reason = await host.input('Owner reason to recover original conversation admission · 1..4096 bytes', '');
                            fresh();
                            if (reason === undefined)
                                continue;
                            if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                                throw Error('Enter a bounded owner recovery reason');
                            await showExactReview(host, 'Review exact original conversation admission', { scope: 'Restore admission on the same ordinary owner work. Preserve original source, model, history, allowances, dependencies and grants. Withdraw only a settled cancelled wait or a consumed continuation supported by retained records, archiving its scheduler state without resolving child obligations. No input, model run, child, grant renewal or send is created. Physical history verification remains pending until a separate explicit ordinary input dispatch.', context, reason }, fresh, 'no execution');
                            const decision = await host.choose('Confirm original conversation admission recovery', ['Back without recovery', 'Recover this original conversation admission']);
                            fresh();
                            if (!decision || decision === 'Back without recovery')
                                continue;
                            if (decision !== 'Recover this original conversation admission')
                                throw Error('Unknown ordinary admission recovery decision');
                            const result = c.recoverOrdinaryWorkAdmission({ workId: id, expectedContext: context.fingerprint, reason }, fresh);
                            try {
                                host.notice('Original work ' + result.workId + ' admission recovered · no execution · history verification and grant recovery remain separate');
                            }
                            catch (error) {
                                throw Error('Original work ' + result.workId + ' admission recovered; no execution or grant renewal started', { cause: error });
                            }
                            return 'completed';
                        }
                        if (action === 'Open original conversation') {
                            const origin = c.inspectConversation(work.conversationId);
                            if (origin.archived || origin.deleted)
                                throw Error('Restore the original conversation before opening it');
                            await host.activate(origin.conversationId);
                            host.notice('Original source opened · work was not resumed');
                            return 'completed';
                        }
                        if (!action.startsWith('Extend shared '))
                            throw Error('Unknown work recovery action');
                        const kind = action === 'Extend shared execution allowance' ? 'execution' : 'resolution', expected = c.inspectWorkAllowance(id);
                        const raw = await host.input('Additional ' + kind + ' units · shared work lineage, not goal turns', '4');
                        current();
                        if (raw === undefined)
                            return 'cancelled';
                        if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(raw))
                            throw Error('Use a whole number from 1 to 100');
                        const reason = await host.input('Owner reason for this bounded work allowance extension', '');
                        current();
                        if (reason === undefined)
                            return 'cancelled';
                        if (!reason.trim())
                            throw Error('An explicit owner reason is required');
                        const allowance = expected[kind]!, accept = `Add ${raw} ${kind} units · limit ${allowance.limit}→${allowance.limit + Number(raw)} · used ${allowance.consumed}+${allowance.reserved} · ${expected.family.count} shared works · goal unchanged`;
                        const selected = await host.choose(`Extend ${kind} · #${id} · shared lineage ${expected.lineageRoot}`, [accept, 'Inspect scope and counters', 'Cancel']);
                        current();
                        if (selected === 'Inspect scope and counters') {
                            await host.show('Shared allowance · inspection only', shorten(expected) + '\nLater continuations share this allowance. Goal turns remain unchanged. Reopen the action to confirm.');
                            return 'cancelled';
                        }
                        if (!selected || selected === 'Cancel')
                            return 'cancelled';
                        if (selected !== accept)
                            throw Error('Unknown allowance decision');
                        c.extendWorkAllowance({ expected, kind, additional: Number(raw), reason });
                        host.notice('Shared ' + kind + ' allowance extended · consumed usage/findings retained · resume explicitly');
                        return 'completed';
                    }
                };
                current();
                if (argument) {
                    const outcome = await inspect(argument.trim());
                    if (outcome !== 'registry')
                        return outcome;
                }
                let cursor: string | undefined;
                const back: (string | undefined)[] = [];
                while (true) {
                    current();
                    const page = c.listWorks({ limit: 50, ...(cursor ? { before: cursor } : {}) });
                    let linked: string[] = [], linkFailure: string | undefined;
                    try {
                        const goal = c.conversationGoal(target);
                        if (goal)
                            linked = c.goalRecoveryWorkIds(goal.goalId);
                    }
                    catch (error) {
                        linkFailure = String(error);
                    }
                    const preferred = [...new Set([...(source.workId ? [source.workId] : []), ...linked])];
                    const linkedRows = preferred.map(id => ({ id, label: `Linked original work · #${id}${id === source.workId ? ' · current conversation' : ' · goal dependency/attempt'}` }));
                    const rows = page.works.map(w => ({ id: w.workId, label: `${w.state} · ${w.requestPreview.replace(/\s+/gu, ' ').slice(0, 48)} · ${w.projectId ?? 'none'} · #${w.workId} · ${w.recordedPhase ?? 'ordinary/local'}` }));
                    const selected = await host.choose('Original work and allowances · all projects', [...(linkFailure ? ['Goal links unavailable · inspect diagnostic'] : []), ...linkedRows.map(r => r.label), ...rows.map(r => r.label), ...(page.nextCursor ? ['Older works'] : []), ...(back.length ? ['Newer works'] : []), 'Close work registry']);
                    current();
                    if (selected === 'Goal links unavailable · inspect diagnostic') {
                        await host.show('Goal work linkage unavailable', shorten(linkFailure) + '\nAll-work discovery remains available. No missing link is treated as resolved.');
                        continue;
                    }
                    if (!selected || selected === 'Close work registry')
                        return 'cancelled';
                    if (selected === 'Older works' && page.nextCursor) {
                        back.push(cursor);
                        cursor = page.nextCursor;
                        continue;
                    }
                    if (selected === 'Newer works' && back.length) {
                        cursor = back.pop();
                        continue;
                    }
                    const row = [...linkedRows, ...rows].find(r => r.label === selected);
                    if (!row)
                        throw Error('Work selection changed; reopen /work');
                    const outcome = await inspect(row.id);
                    // A reviewed resume may open its original owner. Cancelling that fresh
                    // review ends this old-source registry instead of reopening it as stale.
                    if (outcome === 'completed' || outcome === 'started' || outcome === 'cancelled' && !host.isCurrent(target))
                        return outcome;
                }
            } }];
}

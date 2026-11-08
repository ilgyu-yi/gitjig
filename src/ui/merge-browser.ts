import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { recoverMergeAuthority, type MergeOwnerRecoveryHost } from './merge-owner-recovery.js';
import type { ReviewPageHost } from './exact-review.js';
import { showMergeReview } from './merge-review.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { uiText, type UiLocale } from './i18n.js';
import { integrationStatus, integrationTransportText } from './integration-presentation.js';
import type { MergeView } from '../controller/merge-types.js';
import { escapeJsonControls, quoteIdentity } from './inspection-text.js';
interface Host extends RecoveryNavigation, UiChoiceHost, ReviewPageHost {
    locale?: UiLocale;
    input?: MergeOwnerRecoveryHost['input'];
    reauthorize?: MergeOwnerRecoveryHost['reauthorize'];
    guard(): void;
    prepare?(context: ReturnType<Controller['inspectRetainedMergePreparation']>, fresh: () => void): Promise<MergeView | undefined>;
    dispatch?(context: ReturnType<Controller['inspectMergeDispatch']>, fresh: () => void): Promise<MergeView | undefined>;
    reconcile?(context: ReturnType<Controller['inspectMergeReconciliation']>, fresh: () => void): Promise<MergeView | 'interrupted' | undefined>;
}
function mergeRecordedState(view: MergeView, locale: UiLocale) {
    return view.phase === 'CONFIRMED'
        ? uiText(locale, 'merge.record.confirmed', { commit: view.mergedCommit ?? uiText(locale, 'value.none') })
        : integrationStatus(view, locale);
}
function mergeRecordedFacts(view: MergeView, locale: UiLocale): string[] {
    const transport = integrationTransportText(view.transportOutcome, locale);
    const refusal = view.phase === 'REFUSED' && view.transportOutcome === 'native-rejection';
    return [
        mergeRecordedState(view, locale),
        uiText(locale, 'integration.field.transport') + ' · ' + (refusal && view.rejectionStatus !== undefined
            ? uiText(locale, 'merge.record.rejectionStatus', { outcome: transport, status: view.rejectionStatus }) : transport),
        uiText(locale, 'integration.field.observed') + ' · ' + uiText(locale,
            view.observedOutcome === 'merged-candidate-matches' ? 'merge.record.observedMatch' : 'merge.record.unobserved'),
        ...(refusal ? [uiText(locale, 'merge.record.rejectionGuide')] : []),
        uiText(locale, 'merge.record.operation', { id: view.operationId }),
    ];
}
type RetainedMerge = Extract<ReturnType<Controller['inspectRetainedMerge']>, { state: 'RETAINED' }>;
function retainedMergeIdentity(record: RetainedMerge) {
    const { view, ...identity } = record;
    return JSON.stringify({ ...identity, headCommit: view.headCommit });
}
function canReadMerge(phase: MergeView['phase']) {
    return phase === 'CONFIRMED' || phase === 'UNKNOWN' || phase === 'INVOKING';
}
function hasRecordedMergeOutcome(view: MergeView) {
    return canReadMerge(view.phase) || view.transportOutcome !== null ||
        view.mergedCommit !== null || view.observedOutcome !== 'not-observed';
}
/** Historical PR-merge discovery. Opening a record never resumes or sends. */
export async function browseMerges(host: Host, controller: Controller, initialOperationId?: string, pinned = false) {
    let completed = false;
    let before: string | undefined;
    let focusedOperation: string | undefined;
    const locale = host.locale ?? 'en';
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const initial = initialOperationId;
        if (!pinned) initialOperationId = undefined;
        const page = initial ? { operations: [controller.inspectRetainedMerge(initial)], nextCursor: null } : controller.listMerges({ limit: 25, ...before ? { before } : {} });
        const catalogue = page.operations.map(row => ({
            value: 'operation:' + row.operationId,
            label: row.state === 'RETAINED'
                ? [row.repository.owner + '/' + row.repository.repository + ' #' + row.pullNumber, mergeRecordedState(row.view, locale),
                    quoteIdentity(row.baseRef), row.operationId].join(' · ')
                : uiText(locale, 'merge.record.unavailableRow', { id: row.operationId }),
        }));
        const action = initial ? catalogue[0]?.value : await chooseUiItem(host,
            uiText(locale, 'merge.record.list') + (catalogue.length ? '' : ' · ' + uiText(locale, 'merge.record.listEmpty')), [
                ...catalogue,
                ...(page.nextCursor ? [{ value: 'older', label: uiText(locale, 'merge.record.older') }] : []),
                ...(newer.length ? [{ value: 'newer', label: uiText(locale, 'merge.record.newer') }] : []),
                { value: 'refresh', label: uiText(locale, 'merge.record.refresh') },
                { value: 'back', label: uiText(locale, 'merge.record.back') },
            ], focusedOperation);
        host.guard();
        if (!action || action === 'back')
            return completed;
        if (action === 'refresh')
            continue;
        if (action === 'older' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (action === 'newer' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.operations.find(row => 'operation:' + row.operationId === action);
        if (!selected)
            throw Error('Unknown original PR merge selection');
        focusedOperation = action;
        const changed = () => Error(uiText(locale, 'merge.record.contextChanged', { id: selected.operationId }));
        const opened = controller.inspectRetainedMerge(selected.operationId);
        let snapshot = JSON.stringify(opened);
        if (snapshot !== JSON.stringify(selected))
            throw changed();
        const current = () => {
            host.guard();
            if (JSON.stringify(controller.inspectRetainedMerge(selected.operationId)) !== snapshot)
                throw changed();
        };
        if (opened.state !== 'RETAINED') {
            await host.show(uiText(locale, 'merge.record.unavailable'), JSON.stringify(opened, null, 2));
            current();
            if (pinned) return completed;
            continue;
        }
        let original = opened;
        const identity = retainedMergeIdentity(opened);
        const refreshOriginal = (outcome: MergeView = original.view) => {
            host.guard();
            const updated = controller.inspectRetainedMerge(opened.operationId);
            if (updated.state !== 'RETAINED' || retainedMergeIdentity(updated) !== identity ||
                outcome.receiptIds.some(id => !updated.view.receiptIds.includes(id)) ||
                (hasRecordedMergeOutcome(outcome) && !hasRecordedMergeOutcome(updated.view)))
                throw Error(uiText(locale, 'merge.record.outcomeChanged', { id: opened.operationId }));
            original = updated;
            snapshot = JSON.stringify(updated);
        };
        while (true) {
            const { phase, mergedCommit } = original.view;
            const confirmed = phase === 'CONFIRMED';
            const canRead = canReadMerge(phase);
            const beforeSend = !hasRecordedMergeOutcome(original.view);
            const targetHeading = uiText(locale, 'merge.record.title', {
                repository: original.repository.owner + '/' + original.repository.repository,
                pull: original.pullNumber, base: quoteIdentity(original.baseRef),
            });
            const title = [targetHeading, ...mergeRecordedFacts(original.view, locale)].join('\n');
            const decisions = [
                { value: 'back', label: uiText(locale, 'merge.record.back') },
                { value: 'details', label: uiText(locale, 'merge.record.inspect') },
                ...confirmed ? [{ value: 'next', label: uiText(locale, 'merge.record.next') }] : [],
                ...host.navigate ? [{ value: 'work', label: uiText(locale, 'integration.choice.work') }] : [],
                ...canRead && host.reconcile ? [{ value: 'read', label: uiText(locale, 'merge.record.read') }] : [],
                ...beforeSend && host.input && host.reauthorize ? [
                    { value: 'renew', label: uiText(locale, 'merge.record.renew') },
                    { value: 'reauthorize', label: uiText(locale, 'merge.record.reauthorize') },
                ] : [],
                ...beforeSend && host.prepare ? [{ value: 'prepare', label: uiText(locale, 'merge.record.prepare') }] : [],
                ...beforeSend && phase === 'RESERVED' && host.dispatch ? [{ value: 'send', label: uiText(locale, 'merge.record.send') }] : [],
            ];
            const recovery = await chooseUiItem(host, title, decisions);
            current();
            if (!recovery || recovery === 'back') {
                if (pinned)
                    return completed;
                break;
            }
            if (recovery === 'details') {
                await host.show(uiText(locale, 'merge.record.details'), JSON.stringify(original, null, 2));
                current();
                continue;
            }
            if (recovery === 'next') {
                await host.show(uiText(locale, 'merge.record.nextTitle'), [
                    targetHeading,
                    uiText(locale, 'result.project', { id: quoteIdentity(original.projectId) }),
                    uiText(locale, 'merge.record.confirmed', { commit: mergedCommit ?? uiText(locale, 'value.none') }),
                    uiText(locale, 'merge.record.nextGuide'),
                ].join('\n\n'));
                current();
                continue;
            }
            if (recovery === 'work') {
                const outcome = await openWorkRecovery(host, original.view.workId, current);
                if (outcome && outcome !== 'cancelled')
                    return outcome;
                current();
                continue;
            }
            if ((recovery === 'renew' || recovery === 'reauthorize') && host.input && host.reauthorize) {
                const outcome = await recoverMergeAuthority({ ...host, input: host.input, reauthorize: host.reauthorize }, controller, original.operationId, recovery);
                if (typeof outcome === 'string' && outcome !== 'cancelled')
                    return outcome;
                if (outcome === true) {
                    completed = true;
                    refreshOriginal();
                    continue;
                }
                current();
                continue;
            }
            const mode = recovery === 'read' || recovery === 'prepare' || recovery === 'send' ? recovery : null;
            if (!mode)
                throw Error('Unknown original PR merge recovery action');
            const inspect = () => mode === 'read' ? controller.inspectMergeReconciliation(original.operationId) : mode === 'prepare' ? controller.inspectRetainedMergePreparation(original.operationId) : controller.inspectMergeDispatch(original.operationId);
            const context = inspect(), fresh = () => {
                host.guard();
                if (inspect().fingerprint !== context.fingerprint)
                    throw changed();
            };
            const scope = mode === 'read' ? 'One original execution allowance for native GET requests only. No send replay, new work, grant, procedure or model call. Historical cancelled, stale or exhausted merge grants do not authorize sending. A matching resource alone preserves UNKNOWN when the original response was lost. Remaining receipt bytes are a limit; response persistence can still fail if it exceeds that limit.' : mode === 'prepare' ? 'One original execution allowance to recheck current procedure/native eligibility and prepare this same definitely-unsent original with an explicit fresh credential. Preserve its exact published head/tree, work, grant and cumulative operation usage. Current native base must be an ancestor of that same head; the retained result shows previous and current base. No send, model, new work, renewed authority or replacement.' : 'One original execution allowance to recheck the current native merge conditions, send one synchronous merge request and read its exact result. Use the currently prepared credential session; no new credential profile or session replacement. Preserve original IDs and all uncertain outcomes. This can merge the PR and produce native notifications under its original finite grant. No replay, new work, model, renewed authority or changed candidate.';
            const reviewed = await showMergeReview(host, locale, mode, {
                repository: original.repository, pullNumber: original.pullNumber, baseRef: original.baseRef,
                operationId: original.operationId, headCommit: original.view.headCommit,
            }, { scope, ...context }, fresh);
            if (!reviewed) {
                current();
                continue;
            }
            if (!context.eligible) {
                const outcome = await openWorkRecovery(host, original.view.workId, fresh);
                if (outcome && outcome !== 'cancelled')
                    return outcome;
                current();
                continue;
            }
            const back = mode === 'read' ? 'Back without reading' : mode === 'prepare' ? 'Back without preparation' : 'Back without sending', confirm = mode === 'read' ? 'Read this original PR merge' : mode === 'prepare' ? 'Prepare this same original PR merge' : 'Send this prepared original PR merge';
            const decision = await host.choose(mode === 'read' ? 'Confirm original PR merge read' : mode === 'prepare' ? 'Confirm original PR merge preparation' : 'Confirm original PR merge send', [back, confirm]);
            fresh();
            if (!decision || decision === back) {
                current();
                continue;
            }
            if (decision !== confirm)
                throw Error('Unknown original PR merge ' + mode + ' decision');
            const perform = mode === 'read' ? host.reconcile : mode === 'prepare' ? host.prepare : host.dispatch;
            if (!perform)
                throw Error('Original PR merge action unavailable');
            const outcome = await perform(context, fresh);
            host.guard();
            if (outcome !== undefined) {
                const interrupted = outcome === 'interrupted';
                if (interrupted)
                    refreshOriginal();
                const result = interrupted ? original.view : outcome;
                completed = true;
                if (result.operationId !== original.operationId || result.workId !== original.view.workId || result.targetId !== original.view.targetId || result.headCommit !== original.view.headCommit)
                    throw Error('Original PR merge outcome does not match its reviewed record');
                const title = interrupted ? 'merge.outcome.readInterrupted' : `merge.outcome.${mode}` as const;
                await host.show(uiText(locale, title),
                    mergeRecordedFacts(result, locale).join('\n') + '\n\n' + escapeJsonControls(JSON.stringify(result, null, 2)));
                if (interrupted)
                    current();
                else
                    refreshOriginal(result);
                continue;
            }
            current();
        }
    }
}

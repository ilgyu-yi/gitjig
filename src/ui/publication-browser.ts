import { openWorkRecovery, chooseHeldWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import { showExactReview } from './exact-review.js';
import type { Controller } from '../controller/controller.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    reconcile?(id: string, fresh: () => void): Promise<unknown | undefined>;
    dispatch?(id: string, fresh: () => void): Promise<unknown | undefined>;
    resumePreparation?(input: {
        operationId: string;
        resourceId: string;
        revisionId: string;
        targetId: string;
    }, fresh: () => void): Promise<unknown | undefined>;
}
/** Inspection stays offline. Read reconciliation and reviewed original send are distinct explicit actions. */
export async function browsePublications(host: Host, controller: Controller) {
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const page = controller.listPublications({ limit: 25, ...before ? { before } : {} });
        const labels = page.operations.map(row => row.state === 'RETAINED' ? `${row.target.owner}/${row.target.repository} · ${row.action}:${row.purpose} · recorded ${row.recordedPhase} · ${row.operationId}` : `Unavailable retained operation · ${row.operationId}`);
        const picked = await host.choose('Retained publications · recorded facts, no recovery or send' + (labels.length ? '' : ' · none on this page'), [...labels, ...page.nextCursor ? ['Older publications'] : [], ...newer.length ? ['Newer publications'] : [], 'Refresh retained list', 'Back']);
        host.guard();
        if (!picked || picked === 'Back')
            return completed;
        if (picked === 'Refresh retained list')
            continue;
        if (picked === 'Older publications' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (picked === 'Newer publications' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.operations[labels.indexOf(picked)];
        if (!selected)
            throw Error('Unknown retained publication selection');
        const original = controller.inspectRetainedPublication(selected.operationId);
        if (JSON.stringify(original.entry) !== JSON.stringify(selected))
            throw Error('Original publication changed; reopen its retained list');
        if (!original.view) {
            await host.show('Unavailable original publication · no repair performed', JSON.stringify(original.entry, null, 2));
            host.guard();
            continue;
        }
        const fresh = () => {
            host.guard();
            if (JSON.stringify(controller.inspectRetainedPublication(selected.operationId)) !== JSON.stringify(original))
                throw Error('Original publication facts changed; inspect the retained operation again');
        };
        const reconcile = 'Reconcile original publication · read requests only', dispatch = 'Review and send original prepared publication', resume = 'Resume original owner summary preparation · no send';
        const action = await host.choose('Original publication · ' + selected.operationId, ['Back without action', ...(host.navigate ? ['Open original work recovery and allowances'] : []), 'Inspect original publication facts', ...host.reconcile && ['UNKNOWN', 'INVOKING'].includes(original.view.phase) ? [reconcile] : [], ...host.dispatch && original.view.phase === 'RESERVED' && original.view.transportOutcome === null ? [dispatch] : [], ...host.resumePreparation && original.view.phase === 'REFUSED' && original.view.purpose === 'contribution-summary' && original.view.transportOutcome === null ? [resume] : []]);
        fresh();
        if (!action || action === 'Back without action')
            continue;
        if (action === 'Open original work recovery and allowances') {
            const outcome = await openWorkRecovery(host, original.view.workId, fresh);
            if (outcome)
                return outcome;
            continue;
        }
        if (action === resume && host.resumePreparation) {
            const context = controller.inspectPublicationPreparation(selected.operationId), current = () => {
                fresh();
                if (JSON.stringify(controller.inspectPublicationPreparation(selected.operationId)) !== JSON.stringify(context))
                    throw Error('Original summary preparation revision, scope or allowance changed; reopen its recovery review');
            };
            await showExactReview(host, 'Review original summary preparation recovery', { scope: 'Resume the same unsent owner operation/work/target/grant. The current complete host summary may be a newer revision on the same native parent. One admitted preflight consumes remaining original execution allowance. No allowance reset, work revival or POST. Sending requires separate review.', ...context }, current, 'preflight only · no send');
            if (context.context.unsettled) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication producer is unsettled; resolve recovery/cleanup before preparation');
                if (outcome)
                    return outcome;
                continue;
            }
            if (context.context.execution.consumed + context.context.execution.reserved >= context.context.execution.limit) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication execution allowance exhausted; recover its original allowance without resetting usage');
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await host.choose('Explicit original preparation recovery', ['Back without preparing', 'Prepare current summary on this original']);
            current();
            if (!decision || decision === 'Back without preparing')
                continue;
            if (decision !== 'Prepare current summary on this original')
                throw Error('Unknown original summary recovery decision');
            const result = await host.resumePreparation({ operationId: selected.operationId, resourceId: context.current.resourceId, revisionId: context.current.revisionId, targetId: context.targetId }, current);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original summary preparation recovery retained · inspect phase · not sent', JSON.stringify(result, null, 2));
                host.guard();
            }
            continue;
        }
        if (action === dispatch && host.dispatch) {
            const context = controller.inspectPublicationDispatch(selected.operationId), current = () => {
                fresh();
                if (JSON.stringify(controller.inspectPublicationDispatch(selected.operationId)) !== JSON.stringify(context))
                    throw Error('Original publication payload, authorization or allowance changed; reopen its send review');
            };
            // Each page stays below the shared inspection component's display bound.
            const { action, payloadUtf8, ...metadata } = context, { body: omittedBody, ...operands } = action;
            await showExactReview(host, 'Review exact original publication', { scope: 'Creates the specified remote resource/comment and may notify people. This is publication only, not reviewed software completion or landing. One admitted dispatch consumes the original execution allowance, including no-handoff refusal or uncertain outcome. Never automatically resend an uncertain attempt.', ...metadata, action: operands, payloadUtf8 }, current, 'remote write');
            if (context.context.unsettled) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication producer is unsettled; resolve its original recovery/cleanup before sending');
                if (outcome)
                    return outcome;
                continue;
            }
            if (context.context.execution.consumed + context.context.execution.reserved >= context.context.execution.limit) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication execution allowance exhausted; inspect original work recovery');
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await host.choose('Confirm exact original publication write', ['Back without sending', 'Send this original prepared publication']);
            current();
            if (!decision || decision === 'Back without sending')
                continue;
            if (decision !== 'Send this original prepared publication')
                throw Error('Unknown original publication send decision');
            const result = await host.dispatch(selected.operationId, current);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original publication send outcome retained · inspect phase and transport', JSON.stringify(result, null, 2));
                host.guard();
            }
            continue;
        }
        if (action === reconcile && host.reconcile) {
            const context = controller.inspectPublicationReconciliation(selected.operationId), current = () => {
                fresh();
                if (JSON.stringify(controller.inspectPublicationReconciliation(selected.operationId)) !== JSON.stringify(context))
                    throw Error('Original publication allowance or producer state changed; reopen its reconciliation action');
            };
            await host.show('Review original read-only reconciliation', JSON.stringify({ entry: original.entry, context, scope: 'Native reads only. One accepted attempt consumes the original execution allowance even if cancelled or unavailable. No resend, replacement operation, new grant, work revival or allowance reset. Confirmed resource correspondence does not change original transport uncertainty.' }, null, 2));
            current();
            if (context.unsettled) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication producer is unsettled; resolve its original recovery/cleanup before another request');
                if (outcome)
                    return outcome;
                continue;
            }
            if (context.execution.consumed + context.execution.reserved >= context.execution.limit) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, current, 'Original publication execution allowance exhausted; inspect the original work allowance without resetting usage');
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await host.choose('Explicit original-publication action', ['Back without reconciliation', 'Reconcile original with read requests']);
            current();
            if (!decision || decision === 'Back without reconciliation')
                continue;
            if (decision !== 'Reconcile original with read requests')
                throw Error('Unknown original reconciliation action');
            const result = await host.reconcile(selected.operationId, current);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original publication reconciliation retained · inspect actual outcome', JSON.stringify(result, null, 2));
                host.guard();
            }
            continue;
        }
        if (action !== 'Inspect original publication facts')
            throw Error('Unknown retained publication action');
        const text = JSON.stringify({ scope: 'Recorded original publication only. Matching resource and confirmed phase do not establish current authority, causal transport success or software completion. Reconciliation requires its separate explicit read action; dispatch requires its separate exact-carrier review action.', entry: original.entry, publication: original.view }, null, 2);
        await host.show('Original publication · phase, transport and observation remain separate', text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use publication inspect --operation ' + selected.operationId + ' for full bounded detail]' : text);
        host.guard();
    }
}

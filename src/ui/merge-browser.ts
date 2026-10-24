import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { recoverMergeAuthority, type MergeOwnerRecoveryHost } from './merge-owner-recovery.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    input?: MergeOwnerRecoveryHost['input'];
    reauthorize?: MergeOwnerRecoveryHost['reauthorize'];
    guard(): void;
    choose(title: string, labels: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    prepare?(context: ReturnType<Controller['inspectRetainedMergePreparation']>, fresh: () => void): Promise<unknown | undefined>;
    dispatch?(context: ReturnType<Controller['inspectMergeDispatch']>, fresh: () => void): Promise<unknown | undefined>;
    reconcile?(context: ReturnType<Controller['inspectMergeReconciliation']>, fresh: () => void): Promise<unknown | undefined>;
}
/** Historical PR-merge discovery. Opening a record never resumes or sends. */
export async function browseMerges(host: Host, controller: Controller, initialOperationId?: string) {
    let completed = false;
    let before: string | undefined;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const initial = initialOperationId;
        initialOperationId = undefined;
        const page = initial ? { operations: [controller.inspectRetainedMerge(initial)], nextCursor: null } : controller.listMerges({ limit: 25, ...before ? { before } : {} });
        const labels = page.operations.map(row => row.state === 'RETAINED' ? `${row.repository.owner}/${row.repository.repository} #${row.pullNumber} · ${row.baseRef} · recorded ${row.view.phase} · ${row.operationId}` : `Unavailable original PR merge · ${row.operationId}`);
        const action = initial ? labels[0] : await host.choose('Retained PR merges · opening does not resume or send' + (labels.length ? '' : ' · none on this page'), [...labels, ...page.nextCursor ? ['Older PR merges'] : [], ...newer.length ? ['Newer PR merges'] : [], 'Refresh retained list', 'Back']);
        host.guard();
        if (!action || action === 'Back')
            return completed;
        if (action === 'Refresh retained list')
            continue;
        if (action === 'Older PR merges' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (action === 'Newer PR merges' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.operations[labels.indexOf(action)];
        if (!selected)
            throw Error('Unknown original PR merge selection');
        const original = controller.inspectRetainedMerge(selected.operationId);
        if (JSON.stringify(original) !== JSON.stringify(selected))
            throw Error('Original PR merge changed; refresh its retained list');
        await host.show(original.state === 'RETAINED' ? 'Original PR merge · recorded outcome and recovery' : 'Unavailable original PR merge · records preserved', JSON.stringify(original, null, 2));
        host.guard();
        if (original.state !== 'RETAINED' || original.view.phase !== 'CONFIRMED' && !host.navigate && !host.reconcile && !host.prepare && !host.dispatch && !host.reauthorize)
            continue;
        const recovery = await host.choose('Original PR merge recovery · separate actions', ['Back', ...(original.view.phase === 'CONFIRMED' ? ['Before another hosted change'] : []), ...(host.navigate ? ['Open original work recovery and allowances'] : []), ...host.input && host.reauthorize ? ['Review original merge grant renewal', 'Review original merge reauthorization'] : [], ...host.reconcile ? ['Review original merge reconciliation'] : [], ...host.prepare ? ['Review original merge preparation'] : [], ...host.dispatch ? ['Review original merge send'] : []]);
        host.guard();
        if (!recovery || recovery === 'Back')
            continue;
        if (recovery === 'Before another hosted change' && original.view.phase === 'CONFIRMED') {
            await host.show('Before another hosted change · external owner and administrator steps', [
                `Recorded merged commit: ${original.view.mergedCommit ?? 'unavailable'}`,
                'Opening this record neither rechecks the remote destination nor synchronizes your original project folder.',
                '1. Settle the previous work and inspect current repository policy. If the destination fence remains active, it blocks source-branch creation and updates. A repository administrator must separately review and perform the policy transition; Gitjig does not disable it.',
                '2. Using native Git, synchronize your project with the confirmed merged base while preserving local changes. A later base change must also be accounted for; a successful prior merge alone does not establish current ancestry.',
                '3. For the new base, create a new source branch and PR and register their exact target identities. An existing target has an immutable pinned basis and cannot be silently retargeted. Obtain the needed finite delegation, then run fresh checks/review and publish the new candidate.',
                '4. The administrator must restore the same required destination fence before merge preparation and sending. Keep the authorized base checks and approvals effective. Reconcile uncertain originals; do not resend them.',
                'These are manual prerequisites of the restricted hosted profile. This screen performs none of them. Read docs/integrations.md for scope and operating limits.',
            ].join('\n\n'));
            host.guard();
            continue;
        }
        if (recovery === 'Open original work recovery and allowances') {
            const outcome = await openWorkRecovery(host, original.view.workId, () => {
                host.guard();
                if (JSON.stringify(controller.inspectRetainedMerge(original.operationId)) !== JSON.stringify(original))
                    throw Error('Original merge changed; reopen recovery');
            });
            if (outcome)
                return outcome;
            continue;
        }
        if ((recovery === 'Review original merge grant renewal' || recovery === 'Review original merge reauthorization') && host.input && host.reauthorize) {
            const outcome = await recoverMergeAuthority({ ...host, input: host.input, reauthorize: host.reauthorize }, controller, original.operationId, recovery === 'Review original merge grant renewal' ? 'renew' : 'reauthorize');
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            continue;
        }
        const mode = recovery === 'Review original merge reconciliation' ? 'read' : recovery === 'Review original merge preparation' ? 'prepare' : recovery === 'Review original merge send' ? 'send' : null;
        if (!mode)
            throw Error('Unknown original PR merge recovery action');
        const inspect = () => mode === 'read' ? controller.inspectMergeReconciliation(original.operationId) : mode === 'prepare' ? controller.inspectRetainedMergePreparation(original.operationId) : controller.inspectMergeDispatch(original.operationId);
        const context = inspect(), fresh = () => {
            host.guard();
            if (inspect().fingerprint !== context.fingerprint)
                throw Error('Original PR merge ' + mode + ' context changed; review again');
        };
        const scope = mode === 'read' ? 'One original execution allowance for native GET requests only. No send replay, new work, grant, procedure or model call. Historical cancelled, stale or exhausted merge grants do not authorize sending. A matching resource alone preserves UNKNOWN when the original response was lost. Remaining receipt bytes are a limit; response persistence can still fail if it exceeds that limit.' : mode === 'prepare' ? 'One original execution allowance to recheck current procedure/native eligibility and prepare this same definitely-unsent original with an explicit fresh credential. Preserve its exact published head/tree, work, grant and cumulative operation usage. Current native base must be an ancestor of that same head; the retained result shows previous and current base. No send, model, new work, renewed authority or replacement.' : 'One original execution allowance to recheck the current native merge conditions, send one synchronous merge request and read its exact result. Use the currently prepared credential session; no new credential profile or session replacement. Preserve original IDs and all uncertain outcomes. This can merge the PR and produce native notifications under its original finite grant. No replay, new work, model, renewed authority or changed candidate.';
        await showExactReview(host, mode === 'read' ? 'Review original PR merge reconciliation' : mode === 'prepare' ? 'Review retained PR merge preparation' : 'Review original PR merge send', { scope, ...context }, fresh, mode === 'read' ? 'GET only' : mode === 'prepare' ? 'no merge send' : 'explicit native merge');
        if (!context.eligible) {
            const outcome = await openWorkRecovery(host, original.view.workId, fresh);
            if (outcome)
                return outcome;
            continue;
        }
        const back = mode === 'read' ? 'Back without reading' : mode === 'prepare' ? 'Back without preparation' : 'Back without sending', confirm = mode === 'read' ? 'Read this original PR merge' : mode === 'prepare' ? 'Prepare this same original PR merge' : 'Send this prepared original PR merge';
        const decision = await host.choose(mode === 'read' ? 'Confirm original PR merge read' : mode === 'prepare' ? 'Confirm original PR merge preparation' : 'Confirm original PR merge send', [back, confirm]);
        fresh();
        if (!decision || decision === back)
            continue;
        if (decision !== confirm)
            throw Error('Unknown original PR merge ' + mode + ' decision');
        const perform = mode === 'read' ? host.reconcile : mode === 'prepare' ? host.prepare : host.dispatch;
        if (!perform)
            throw Error('Original PR merge action unavailable');
        const result = await perform(context, fresh);
        host.guard();
        if (result !== undefined) {
            completed = true;
            await host.show(mode === 'read' ? 'Original PR merge read retained · no resend' : mode === 'prepare' ? 'Original PR merge preparation retained · sending remains separate' : 'Original PR merge send retained · inspect actual outcome', JSON.stringify(result, null, 2));
            host.guard();
        }
    }
}

import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { showExactReview } from './exact-review.js';
export interface MergeOwnerRecoveryHost extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    reauthorize(context: ReturnType<Controller['inspectMergeReauthorization']>, reason: string, fresh: () => void): Promise<unknown>;
}
/** Separate local authority decisions; native preparation and sending remain explicit actions. */
export async function recoverMergeAuthority(host: MergeOwnerRecoveryHost, c: Controller, id: string, mode: 'renew' | 'reauthorize', grantRoot?: {
    workId: string;
    targetId: string;
}) {
    const original = grantRoot ?? c.inspectMerge(id), inspect = () => mode === 'renew' ? c.inspectMergeGrantRenewal(original.workId, original.targetId) : c.inspectMergeReauthorization(id), context = inspect();
    const fresh = () => {
        host.guard();
        if (inspect().fingerprint !== context.fingerprint)
            throw Error('Original PR merge ' + id + ' authority context changed; review again');
    };
    const action = mode === 'renew' ? 'renewal' : 'reauthorization';
    if (!context.eligible) {
        await showExactReview(host, 'Original PR merge ' + action + ' held', context, fresh, 'no mutation');
        return await openWorkRecovery(host, original.workId, fresh) ?? false;
    }
    const reason = await host.input('Owner reason for original PR merge ' + action + ' · 1..4096 bytes', '');
    fresh();
    if (reason === undefined)
        return false;
    if (!reason.trim() || Buffer.byteLength(reason) > 4096)
        throw Error('Enter a bounded owner ' + action + ' reason');
    const scope = mode === 'renew' ? 'Renew this same work-only ordinary merge grant for the revived original work epoch. Preserve issuer, target, notification policy, finite limit and cumulative usage. Existing originals retain their old authority until separately reauthorized. No work, operation, model call, execution spend, native request, preparation or send.' : 'Reauthorize this definitely-unsent original using current procedure evidence for the exact originally captured candidate, published head/tree and original owner source. Preserve original operation/work/grant and spent allowances; archive previous authority and clear native preparation and credential readiness. PREPARED only; fresh native preparation and a separate Send remain required. No native request, model call or execution spend.';
    await showExactReview(host, 'Review original PR merge ' + action, { scope, ...grantRoot ? {} : { operationId: id }, workId: original.workId, targetId: original.targetId, context, reason }, fresh, 'authority only');
    const back = 'Back without ' + action, accept = mode === 'renew' ? 'Renew this original PR merge grant' : 'Reauthorize this unsent original PR merge', decision = await host.choose('Confirm original PR merge ' + action, [back, accept]);
    fresh();
    if (!decision || decision === back)
        return false;
    if (decision !== accept)
        throw Error('Unknown original PR merge ' + action + ' decision');
    const retainedGrant = mode === 'renew' ? c.renewOwnerMerge({ workId: original.workId, targetId: original.targetId, expectedContext: context.fingerprint, reason }, fresh) : undefined;
    const result = retainedGrant ?? await host.reauthorize(context as ReturnType<Controller['inspectMergeReauthorization']>, reason, fresh);
    try {
        host.guard();
        await host.show('Original PR merge ' + action + ' retained · prepare and send separately', JSON.stringify(result, null, 2));
        host.guard();
    }
    catch (error) {
        throw Error('Original PR merge ' + id + ' ' + action + ' retained' + (retainedGrant ? ' · grant ' + retainedGrant.delegationId + ' · source ' + retainedGrant.sourceId : '') + ' for work ' + original.workId + ' and target ' + original.targetId + '; inspect the original outcome', { cause: error });
    }
    return true;
}

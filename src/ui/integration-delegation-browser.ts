import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
}
/** A separately recorded owner ceiling, never workflow completion or a send. */
export async function browseIntegrationDelegation(host: Host, c: Controller, targetId: string, initialWorkId?: string, pinned = false) {
    const pinnedWorkId = pinned ? initialWorkId : undefined;
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const initial = pinnedWorkId ?? initialWorkId;
        initialWorkId = undefined;
        const page = initial ? { works: [c.inspectIntegrationDelegation(initial, targetId)], nextCursor: null } : c.listIntegrationDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} }), labels = page.works.map(work => `${work.eligible ? 'Owner work' : 'Held work'} · ${work.recordedPhase} · ${work.workId}`), pick = initial ? labels[0] : await host.choose(page.works.length ? 'Integration delegation · select original owner work' : 'Integration delegation · no retained work; use /change start', [...labels, ...(!page.works.length && !before && host.navigate ? ['Review a new managed change · /change start'] : []), ...page.nextCursor ? ['Older work'] : [], ...newer.length ? ['Newer work'] : [], 'Refresh work list', 'Back']);
        host.guard();
        if (!pick || pick === 'Back')
            return completed;
        if (pick === 'Review a new managed change · /change start')
            return host.navigate!('/change start');
        if (pick === 'Refresh work list')
            continue;
        if (pick === 'Older work' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (pick === 'Newer work' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.works[labels.indexOf(pick)];
        if (!selected)
            throw Error('Unknown original delegation work');
        const context = c.inspectIntegrationDelegation(selected.workId, targetId);
        if (context.fingerprint !== selected.fingerprint)
            throw Error('Original delegation work changed; refresh its list');
        const fresh = () => {
            host.guard();
            if (c.inspectIntegrationDelegation(context.workId, targetId).fingerprint !== context.fingerprint)
                throw Error('Original work, target or grant changed; inspect it again');
        };
        if (!context.eligible) {
            await showExactReview(host, 'Original integration delegation held', context, fresh, 'no grant created');
            const renewal = c.inspectIntegrationGrantRenewal(context.workId, targetId);
            if (renewal.eligible && renewal.existing) {
                const review = await host.choose('Original grant is stale · separate owner renewal', ['Back without renewal', 'Review renewal of this original grant']);
                fresh();
                if (!review || review === 'Back without renewal') {
                    if (pinnedWorkId) return completed;
                    continue;
                }
                if (review !== 'Review renewal of this original grant')
                    throw Error('Unknown grant renewal selection');
                const reason = await host.input('Owner reason to renew the same integration grant · 1..4096 bytes', '');
                fresh();
                if (reason === undefined) {
                    if (pinnedWorkId) return completed;
                    continue;
                }
                if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                    throw Error('Enter a bounded owner renewal reason');
                const renewalFresh = () => {
                    host.guard();
                    if (c.inspectIntegrationGrantRenewal(context.workId, targetId).fingerprint !== renewal.fingerprint)
                        throw Error('Original grant renewal context changed; inspect it again');
                };
                await showExactReview(host, 'Review exact original grant renewal', { scope: 'Renew the same ordinary ' + renewal.existing.scope + ' grant for the current original work epoch. Preserve original issuer, target project, scope, limit and cumulative usage. Advance grant epoch and retain the owner decision. Existing operations remain bound to their old grant epoch; inspect their own recovery eligibility separately. This does not revive native identities or old assignment/context standing. No work, operation, model run, preparation, native request or send is created.', rootProject: renewal.projectId ?? 'unbound', receiverProject: renewal.receiverProjectId, context: renewal, reason }, renewalFresh, 'no native request');
                const accept = await host.choose('Confirm exact original grant renewal', ['Back without renewal', 'Renew this original grant']);
                renewalFresh();
                if (!accept || accept === 'Back without renewal') {
                    if (pinnedWorkId) return completed;
                    continue;
                }
                if (accept !== 'Renew this original grant')
                    throw Error('Unknown grant renewal decision');
                const result = c.renewOwnerIntegration({ workId: context.workId, targetId, expectedContext: renewal.fingerprint, reason }, host.guard);
                completed = true;
                try {
                    await host.show('Original integration grant renewed · existing operations still require reauthorization', JSON.stringify(result, null, 2));
                    host.guard();
                }
                catch (error) {
                    throw Error('Original integration grant ' + result.delegationId + ' renewed; work ' + context.workId + ' and target ' + targetId + ' retained; no preparation or send started', { cause: error });
                }
                if (pinnedWorkId) return completed;
                continue;
            }
            const outcome = await openWorkRecovery(host, context.workId, fresh);
            if (outcome)
                return outcome;
            if (pinnedWorkId) return completed;
            continue;
        }
        let operationLimit = context.existing?.operationLimit;
        if (operationLimit === undefined) {
            const value = await host.input('Finite integration operation limit · 1..100 · this work only', '4');
            fresh();
            if (value === undefined) {
                if (pinnedWorkId) return completed;
                continue;
            }
            if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > 100)
                throw Error('Enter a finite integration operation limit1..100');
            operationLimit = Number(value);
        }
        await showExactReview(host, 'Review exact owner integration delegation', { scope: 'A new explicit owner decision, separate from the captured startup activation profile. Ordinary integration only. New grants cover this work only, never descendants or an approval override. Existing grants retain their original scope, epoch, operation count and limit. Delegation is a conditional ceiling; actual native authority and current procedure still gate preparation and sending. No work, operation, model run, preparation or send is created.', context, requested: { workId: context.workId, targetId, operationLimit, mode: 'ordinary', scope: context.existing?.scope ?? 'work' } }, fresh, 'no native request');
        const accept = context.existing ? 'Keep this original grant' : 'Delegate ordinary integration to this work', decision = await host.choose('Confirm exact owner delegation', ['Back without delegation', accept]);
        fresh();
        if (!decision || decision === 'Back without delegation') {
            if (pinnedWorkId) return completed;
            continue;
        }
        if (decision !== accept)
            throw Error('Unknown owner delegation decision');
        const result = c.delegateOwnerIntegration({ workId: context.workId, targetId, operationLimit, expectedContext: context.fingerprint }, host.guard);
        completed = true;
        try {
            await host.show('Integration grant retained · no preparation or send', JSON.stringify({ ...result, workId: context.workId, targetId, operationLimit }, null, 2));
            host.guard();
        }
        catch (error) {
            throw Error('Original integration grant ' + result.delegationId + ' retained for work ' + context.workId + ' and target ' + targetId + '; no preparation or send started', { cause: error });
        }
        if (pinnedWorkId) return completed;
    }
}

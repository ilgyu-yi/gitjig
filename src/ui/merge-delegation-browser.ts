import { openWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { recoverMergeAuthority } from './merge-owner-recovery.js';
import { showExactReview } from './exact-review.js';
interface Host extends RecoveryNavigation {
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
}
/** A separate finite ceiling only; no preparation, native activity or merge. */
export async function browseMergeDelegation(host: Host, c: Controller, targetId: string) {
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const page = c.listMergeDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} }), labels = page.works.map(work => `${work.eligible ? 'Owner work' : 'Held work'} · ${work.recordedPhase} · ${work.workId}`);
        const picked = await host.choose('PR merge delegation · select original owner governed work', [...labels, ...(!page.works.length && !before && host.navigate ? ['Review a new managed change · /change start'] : []), ...page.nextCursor ? ['Older work'] : [], ...newer.length ? ['Newer work'] : [], 'Refresh work list', 'Back']);
        host.guard();
        if (!picked || picked === 'Back')
            return completed;
        if (picked === 'Review a new managed change · /change start')
            return host.navigate!('/change start');
        if (picked === 'Refresh work list')
            continue;
        if (picked === 'Older work' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (picked === 'Newer work' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.works[labels.indexOf(picked)];
        if (!selected)
            throw Error('Unknown original merge delegation work');
        const context = c.inspectMergeDelegation(selected.workId, targetId);
        if (context.fingerprint !== selected.fingerprint)
            throw Error('Original merge delegation work changed; refresh its list');
        const fresh = () => {
            host.guard();
            if (c.inspectMergeDelegation(context.workId, targetId).fingerprint !== context.fingerprint)
                throw Error('Original work, PR target or merge grant changed; inspect it again');
        };
        if (!context.eligible) {
            await showExactReview(host, 'Original PR merge delegation held', context, fresh, 'no grant or native request');
            const renewal = c.inspectMergeGrantRenewal(context.workId, targetId);
            if (renewal.eligible) {
                const decision = await host.choose('Original PR merge grant is stale · separate owner renewal', ['Back without renewal', 'Review renewal of this original PR merge grant']);
                fresh();
                if (decision === 'Review renewal of this original PR merge grant') {
                    const outcome = await recoverMergeAuthority({ ...host, reauthorize: async () => { throw Error('Grant renewal cannot reauthorize an operation'); } }, c, '', 'renew', { workId: context.workId, targetId });
                    if (typeof outcome === 'string')
                        return outcome;
                    if (outcome) {
                        completed = true;
                        continue;
                    }
                }
                else if (decision && decision !== 'Back without renewal')
                    throw Error('Unknown PR merge grant renewal choice');
            }
            const outcome = await openWorkRecovery(host, context.workId, fresh);
            if (outcome)
                return outcome;
            continue;
        }
        let operationLimit = context.existing?.operationLimit;
        if (operationLimit === undefined) {
            const value = await host.input('Finite PR merge operation limit · 1..100 · this work only', '1');
            fresh();
            if (value === undefined)
                continue;
            if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > 100)
                throw Error('Enter a finite PR merge operation limit1..100');
            operationLimit = Number(value);
        }
        await showExactReview(host, 'Review exact owner PR merge delegation', { scope: 'Separate conditional ordinary merge ceiling for this original governed work. New grants cover this work only; existing grants keep their original scope, epoch, limit and cumulative usage. Explicitly permits native merge notifications. Does not change policy, grant bypass, establish procedure standing, create work/operations, read credentials, prepare or send. Current procedure, exact published candidate, native CI/approvals and restrictive destination fence remain separate merge gates.', context, requested: { workId: context.workId, targetId, operationLimit, scope: context.existing?.scope ?? 'work', notifications: 'allow-merge-notifications' } }, fresh, 'no native request');
        const accept = context.existing ? 'Keep this original merge grant' : 'Delegate PR merge and its notifications to this work', decision = await host.choose('Confirm separate PR merge authority', ['Back without delegation', accept]);
        fresh();
        if (!decision || decision === 'Back without delegation')
            continue;
        if (decision !== accept)
            throw Error('Unknown PR merge delegation decision');
        const result = c.delegateOwnerMerge({ workId: context.workId, targetId, operationLimit, notifications: 'allow-merge-notifications', expectedContext: context.fingerprint }, host.guard);
        completed = true;
        try {
            await host.show('PR merge grant retained · no preparation or send', JSON.stringify({ ...result, workId: context.workId, targetId, operationLimit }, null, 2));
            host.guard();
        }
        catch (error) {
            throw Error('Original PR merge grant ' + result.delegationId + ' retained for work ' + context.workId + ' and target ' + targetId + '; no preparation or send started', { cause: error });
        }
    }
}

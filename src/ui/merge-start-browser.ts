import { openWorkRecovery, chooseRecoveryEntry, type RecoveryNavigation } from './recovery-navigation.js';
import type { Controller } from '../controller/controller.js';
import { showExactInspection, type ReviewPageHost } from './exact-review.js';
import { showMergeReview } from './merge-review.js';
import { translator, type UiLocale } from './i18n.js';
import { mergeWorkPicker } from './merge-work-picker.js';
import { chooseUiItem, type UiChoice, type UiChoiceHost } from './choices.js';
interface Host extends RecoveryNavigation, ReviewPageHost, UiChoiceHost {
    locale?: UiLocale;
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    prepare(context: ReturnType<Controller['inspectOwnerMergePreparation']>, fresh: () => void): Promise<unknown | undefined>;
}
/** Explicit first preparation only. Any retained original owns its later recovery. */
export async function browseFirstOwnerMerge(host: Host, c: Controller, target: Extract<ReturnType<Controller['inspectMergeTarget']>, { state: 'RETAINED' }>) {
    const { targetId, configuration } = target;
    const locale = host.locale ?? 'en';
    const t = translator(locale);
    const selectWork = mergeWorkPicker(host, c, targetId, 'merge.work.prepare');
    let completed = false;
    async function recoverOriginals(workId: string, retained: ReturnType<Controller['listOwnerMergeOriginals']>) {
        const fresh = () => {
            host.guard();
            if (JSON.stringify(c.listOwnerMergeOriginals(workId, targetId)) !== JSON.stringify(retained))
                throw Error('Original merges changed; reopen first preparation');
        };
        for (const original of retained.originals)
            await showExactInspection(host, 'Original PR merge retained · no replacement preparation', original, fresh, 'no native request', locale);
        return chooseRecoveryEntry(host, fresh, retained.originals.map(original => ({
            command: '/repo merge ' + original.operationId,
            label: 'Open this retained PR merge recovery',
        })));
    }
    async function publication(workId: string) {
        let cursor: string | undefined;
        const previous: (string | undefined)[] = [];
        while (true) {
            host.guard();
            const page = c.listOwnerMergePublications(workId, targetId, { limit: 25, ...cursor ? { before: cursor } : {} });
            const items: UiChoice[] = page.publications.map(row => ({
                value: 'publication:' + row.operationId,
                label: [t(row.state === 'RECORDED' ? 'merge.publication.recorded' : 'merge.publication.held'),
                    row.headCommit, JSON.stringify(row.recordedPhase).replace(/\p{Bidi_Control}/gu, ''), row.operationId].filter(Boolean).join(' · '),
            }));
            if (page.nextCursor)
                items.push({ value: 'older', label: t('merge.publication.older') });
            if (previous.length)
                items.push({ value: 'newer', label: t('merge.publication.newer') });
            items.push({ value: 'back', label: t('merge.record.back') });
            const pick = await chooseUiItem(host, t('merge.publication.title') + '\n' + t('integration.field.work') + ' · ' + workId, items);
            host.guard();
            if (!pick || pick === 'back')
                return;
            if (pick === 'older' && page.nextCursor) {
                previous.push(cursor);
                cursor = page.nextCursor;
                continue;
            }
            if (pick === 'newer' && previous.length) {
                cursor = previous.pop();
                continue;
            }
            return page.publications.find(row => pick === 'publication:' + row.operationId)!;
        }
    }
    while (true) {
        const work = await selectWork();
        if (typeof work === 'string')
            return work;
        if (!work)
            return completed;
        let retained = c.listOwnerMergeOriginals(work.workId, targetId);
        let selectedBranch: Awaited<ReturnType<typeof publication>>;
        let preparation: ReturnType<Controller['inspectOwnerMergePreparation']> | undefined;
        if (!retained.originals.length) {
            if (c.inspectMergeDelegation(work.workId, targetId).fingerprint !== work.fingerprint)
                throw Error(t('merge.work.changed'));
            selectedBranch = await publication(work.workId);
            if (!selectedBranch)
                continue;
            retained = c.listOwnerMergeOriginals(work.workId, targetId);
            if (!retained.originals.length) {
                preparation = c.inspectOwnerMergePreparation(work.workId, targetId, selectedBranch.operationId);
                if (preparation.originals.length)
                    retained = c.listOwnerMergeOriginals(work.workId, targetId);
            }
        }
        if (retained.originals.length) {
            const outcome = await recoverOriginals(work.workId, retained);
            if (outcome)
                return outcome;
            continue;
        }
        if (!preparation || preparation.originals.length)
            continue;
        const context = preparation;
        if (context.delegation.fingerprint !== work.fingerprint)
            throw Error(t('merge.work.changed'));
        const { recordedBranch, ...reviewContext } = context;
        if (JSON.stringify(recordedBranch) !== JSON.stringify(selectedBranch))
            throw Error(t('merge.publication.changed'));
        const fresh = () => {
            host.guard();
            if (c.inspectOwnerMergePreparation(work.workId, targetId, context.branchOperationId).fingerprint !== context.fingerprint)
                throw Error('Original owner preparation context changed; review this work and publication again');
        };
        if (JSON.stringify(context.delegation.target) !== JSON.stringify(target))
            throw Error('Original PR target changed; reopen its first preparation');
        const scope = 'Read current procedure and native eligibility for this exact published candidate, then retain and prepare one original merge under its existing finite grant. This may spend one original execution allowance. No new work or grant, no model call, policy change or merge send. Any admitted original remains the recovery identity on failure.';
        const { repository, identity } = configuration;
        const reviewed = await showMergeReview(host, locale, 'first', {
            repository, pullNumber: identity.pullNumber, baseRef: identity.baseRef,
            ...(context.published ? { headCommit: context.published.headCommit } : {}),
        }, { scope, ...reviewContext, execution: context.allowances.find(row => row.kind === 'execution') ?? null }, fresh);
        if (!reviewed)
            continue;
        if (!context.eligible) {
            const outcome = await openWorkRecovery(host, work.workId, fresh);
            if (outcome)
                return outcome;
            continue;
        }
        const decision = await host.choose('Confirm first PR merge preparation', ['Back without preparation', 'Prepare this original PR merge']);
        fresh();
        if (!decision || decision === 'Back without preparation')
            continue;
        if (decision !== 'Prepare this original PR merge')
            throw Error('Unknown owner merge preparation decision');
        const result = await host.prepare(context, fresh);
        host.guard();
        if (result !== undefined) {
            completed = true;
            await host.show('Original PR merge preparation retained · sending remains separate', JSON.stringify(result, null, 2));
            host.guard();
        }
    }
}

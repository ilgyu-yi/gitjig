import type { Controller } from '../controller/controller.js';
import type { WorkflowCriteriaHold } from '../controller/change-types.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { showExactInspection, showExactReview, type ReviewPageHost } from './exact-review.js';
import { translator, type UiLocale } from './i18n.js';
import { quoteText } from './inspection-text.js';
import { limitedSharedAllowanceText } from './work-allowance-presentation.js';

export function workflowCriteriaNextAction(locale: UiLocale, hold: WorkflowCriteriaHold, work: string): string {
    const t = translator(locale);
    return hold === 'changed' ? t('criteria.recovery.changedAction', { work, action: t('criteria.entry') })
        : t('criteria.recovery.unavailableAction');
}

interface Host extends UiChoiceHost, ReviewPageHost {
    controller: Controller;
    locale: UiLocale;
    guard(): void;
    input(title: string, value: string): Promise<string | undefined>;
    notice(text: string): void;
}
/** One exact owner rule adoption; task purpose and independent adoption stay separate. */
export async function reviewCriteriaRefresh(host: Host, workId: string, target: string): Promise<'completed' | 'cancelled'> {
    const c = host.controller, t = translator(host.locale), source = c.inspectConversation(target), model = c.getConversationModelChoice(target), language = c.getConversationLanguage(target);
    const sourceCurrent = () => {
        host.guard();
        const now = c.inspectConversation(target);
        if (source.role || now.role || now.generation !== source.generation || now.directionRevision !== source.directionRevision || now.workId !== source.workId ||
            now.projectId !== source.projectId || now.archived || now.deleted || c.getConversationModelChoice(target).revision !== model.revision || c.getConversationLanguage(target).revision !== language.revision)
            throw new Error(t('criteria.sourceChanged'));
    };
    sourceCurrent();
    const reviewed = c.inspectChangeCriteriaRefresh(workId);
    const balances = reviewed.eligible && reviewed.sharedAllowance ? limitedSharedAllowanceText(host.locale, reviewed.sharedAllowance) : [];
    const planningAllowance = balances.length ? [...balances, t('criteria.planningAllowanceHint', {work:workId})] : [];
    const current = () => {
        sourceCurrent();
        if (c.inspectChangeCriteriaRefresh(workId).fingerprint !== reviewed.fingerprint) throw new Error(t('criteria.changed'));
    };
    const holdLabels: Record<string, string> = { busy: t('criteria.busy'), 'work-state': t('criteria.workHeld'), 'current-unavailable': t('criteria.currentUnavailable'), 'retained-unavailable': t('criteria.retainedUnavailable') };
    const summary = {
        ...(reviewed.holds.length ? { [t('criteria.held')]: reviewed.holds.map(hold => holdLabels[hold] ?? hold) }
            : { [t('criteria.scope')]: t(reviewed.changed ? 'criteria.explanation' : 'criteria.alreadyCurrent') }),
        ...(planningAllowance.length ? {[t('criteria.nextPlanning')]:planningAllowance} : {}),
        [t('criteria.work')]: { workId, projectId: reviewed.projectId, sourceId: reviewed.sourceId, epoch: reviewed.epoch },
        [t('criteria.previous')]: { version: reviewed.fromContractsVersion, hash: reviewed.previousHash },
        [t('criteria.installed')]: { hash: reviewed.currentHash },
        [t('criteria.assets')]: reviewed.assets.map(asset => ({ name: asset.name, previousSha256: asset.previousSha256, currentSha256: asset.currentSha256,
            change: t(asset.currentSha256 === null ? 'criteria.currentUnavailable' : asset.selectedChanged ? 'criteria.selectedChanged' : asset.provenanceChanged ? 'criteria.provenanceOnly' : 'criteria.unchanged') })),
    };
    if (!reviewed.eligible) {
        await showExactInspection(host, t('criteria.title'), summary, current, t('criteria.noExecution'), host.locale);
        return 'cancelled';
    }
    if (!await showExactReview(host, t('criteria.title'), summary, current, t('criteria.noExecution'), host.locale, {
        next: t('review.next'), finish: t('criteria.reviewOptions'),
    })) return 'cancelled';
    while (true) {
        const action = await chooseUiItem(host, t('criteria.title'), [
            { value: 'back', label: t('criteria.back') },
            { value: 'changes', label: t('criteria.inspectChanges') },
            { value: 'complete', label: t('criteria.inspectComplete') },
            { value: 'adopt', label: t('criteria.reviewAdoption') },
        ]);
        current();
        if (!action || action === 'back') return 'cancelled';
        if (action === 'changes') {
            await showExactInspection(host, t('criteria.inspectChanges'), reviewed.assets.filter(asset => asset.selectedChanged).map(asset => {
                const previous = asset.previousSelected.split('\n'), installed = asset.currentSelected!.split('\n');
                let start = 0, end = 0;
                while (start < previous.length && start < installed.length && previous[start] === installed[start]) start++;
                while (end < previous.length - start && end < installed.length - start && previous[previous.length - end - 1] === installed[installed.length - end - 1]) end++;
                return { name: asset.name, previousStartLine: start + 1, installedStartLine: start + 1,
                    [t('criteria.previous')]: previous.slice(start, previous.length - end), [t('criteria.installed')]: installed.slice(start, installed.length - end) };
            }), current, t('criteria.noExecution'), host.locale);
            continue;
        }
        if (action === 'complete') {
            await showExactInspection(host, t('criteria.inspectComplete'), { [t('criteria.scope')]: t('criteria.retainedTextNote'),
                [t('criteria.assets')]: reviewed.assets.map(asset => ({ name: asset.name,
                    [t('criteria.previous')]: asset.previousSelected.split('\n'), [t('criteria.installed')]: asset.currentSelected!.split('\n') })) }, current, t('criteria.noExecution'), host.locale);
            continue;
        }
        let reason = '';
        while (true) {
            const entered = await host.input(t('criteria.reason'), reason);
            current();
            if (entered === undefined) return 'cancelled';
            reason = entered;
            if (reason.trim() && Buffer.byteLength(reason) <= 4096) break;
            await host.show(t('criteria.reason'), t('criteria.invalidReason'));
            current();
        }
        const reasonPoints = Array.from(reason), preview = reasonPoints.slice(0, 160).join('') + (reasonPoints.length > 160 ? '…' : '');
        const confirmation = [t('criteria.confirm'), `${t('criteria.work')}: ${workId}`,
            t('criteria.epochChange', { from: reviewed.epoch, to: reviewed.epoch + 1 }), `${t('criteria.installed')}: ${reviewed.currentHash}`,
            ...planningAllowance,
            `${t('criteria.reasonPreview')}: ${quoteText(preview)}`].join('\n');
        const confirm = await chooseUiItem(host, confirmation, [{ value: 'back', label: t('criteria.back') }, { value: 'adopt', label: t('criteria.adopt') }]);
        current();
        if (!confirm || confirm === 'back') return 'cancelled';
        const saved = await c.refreshChangeCriteria({ workId, expectedEpoch: reviewed.epoch, expectedFingerprint: reviewed.fingerprint, reason }, current);
        try {
            sourceCurrent();
            const fresh = c.inspectChangeCriteriaRefresh(workId);
            if (saved.workId !== workId || saved.epoch !== reviewed.epoch + 1 || fresh.epoch !== saved.epoch || fresh.previousHash !== reviewed.currentHash || fresh.fromContractsVersion === reviewed.fromContractsVersion)
                throw new Error(t('criteria.changed'));
            sourceCurrent();
            host.notice(t('criteria.savedNotice', { work: workId, epoch: fresh.epoch, version: fresh.fromContractsVersion, hash: fresh.previousHash }));
        } catch (error) { throw new Error(t('criteria.committed', { work: workId, epoch: saved.epoch, hash: reviewed.currentHash! }), { cause: error }); }
        return 'completed';
    }
}

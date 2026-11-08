import type { RecoveryNavigation } from './recovery-navigation.js';
import type { HostCommandOutcome } from './host-commands.js';
import type { Controller } from '../controller/controller.js';
import { showReviewAction, showReviewText, type ReviewPageHost } from './exact-review.js';
import { escapeJsonControls, quoteText } from './inspection-text.js';
import { translator, type UiLocale } from './i18n.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { integrationText } from './integration-presentation.js';
import { captureDeliveryWork } from './result-delivery.js';
type PreparationContext = ReturnType<Controller['inspectFirstIntegrationPreparation']>;
type PreparedIntegration = Awaited<ReturnType<Controller['prepareFirstIntegration']>>;
interface Host extends RecoveryNavigation, ReviewPageHost, UiChoiceHost {
    locale?: UiLocale;
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    delegate?(workId: string, targetId: string): Promise<boolean | HostCommandOutcome>;
    operationRecovery?(operation: PreparationContext['targetHolds'][number]): string | undefined;
    preparationModel?: {
        provider: string;
        modelId: string;
    };
    prepare(workId: string, targetId: string, context: PreparationContext, fresh: () => void): Promise<PreparedIntegration | undefined>;
    openOriginal(id: string, targetId: string, exact?: true): Promise<boolean | HostCommandOutcome>;
}
/** First preparation is explicit; an existing original always owns recovery. */
export async function browseFirstIntegration(host: Host, c: Controller, targetId: string, workId?: string, expectedContextFingerprint?: string) {
    const locale = host.locale ?? 'en', t = translator(locale);
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const page = workId ? { works: [c.inspectIntegrationDelegation(workId, targetId)], nextCursor: null } : c.listIntegrationDelegationWorks(targetId, { limit: 25, ...before ? { before } : {} }), labels = page.works.map(work => `${work.recordedPhase} · ${work.workId}`), pick = workId ? labels[0] : await host.choose(page.works.length ? 'First integration · select original owner work' : 'First integration · no retained work; use /change start', [...labels, ...(!page.works.length && !before && host.navigate ? ['Review a new managed change · /change start'] : []), ...page.nextCursor ? ['Older work'] : [], ...newer.length ? ['Newer work'] : [], 'Refresh work list', 'Back']);
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
            throw Error('Unknown first integration work');
        const context = c.inspectFirstIntegrationPreparation(selected.workId, targetId);
        if (context.delegation.fingerprint !== selected.fingerprint)
            throw Error('Original integration work changed; refresh its list');
        if (expectedContextFingerprint !== undefined && context.contextFingerprint !== expectedContextFingerprint)
            throw Error('First integration context changed; reopen the receiver actions');
        const fresh = () => {
            host.guard();
            if (c.inspectFirstIntegrationPreparation(selected.workId, targetId).contextFingerprint !== context.contextFingerprint)
                throw Error('First integration context changed; inspect the original work and target');
        };
        if (context.originals.length) {
            // A scoped receiver action already selected its one exact original.
            const direct = expectedContextFingerprint !== undefined && context.originals.length === 1 && !context.originalOverflow;
            const rows = context.originals.map(row => `${row.phase ?? 'Unavailable'} · ${row.id}`), action = direct ? rows[0] : await host.choose('Existing original integration · no new allocation', [...rows, 'Back']);
            fresh();
            if (!action || action === 'Back') {
                if (workId) return completed;
                continue;
            }
            const original = context.originals[rows.indexOf(action)];
            if (!original)
                throw Error('Unknown original integration');
            const outcome = await host.openOriginal(original.id, targetId);
            if (typeof outcome === 'string')
                return outcome;
            if (outcome)
                completed = true;
            if (workId)
                return completed;
            continue;
        }
        const baseline = c.getWorkApplicationModelBaseline(selected.workId);
        const subjectModel = baseline
            ? { binding: 'captured application baseline', provider: baseline.choice.provider, modelId: baseline.choice.modelId, thinkingLevel: baseline.choice.thinkingLevel }
            : host.preparationModel ? { binding: 'Explicit legacy invocation recipe; historical identity not verified for unbound work', ...host.preparationModel }
                : 'Explicit legacy model profile required';
        const { holds, ...record } = context;
        const blocking = context.targetHolds[0];
        const detail = [
            t('integration.firstReviewScope', { work: selected.workId, target: targetId }),
            ...(holds.length ? [
                t('integration.firstReviewHeld'),
                ...(blocking ? [t('integration.firstBlocker', { id: quoteText(blocking.id) })] : []),
                ...holds.map(quoteText),
            ] : []),
            t('integration.firstReviewEffect'),
            escapeJsonControls(JSON.stringify({ subjectModel, ...record }, null, 2)),
        ].join('\n\n');
        const reviewed = await showReviewText(host, t('integration.firstReviewTitle'), detail, fresh, t('integration.reviewSuffix'), locale, {
            next: t('integration.reviewNext'),
            finish: t(holds.length ? 'integration.reviewRecovery' : 'integration.firstReviewProceed'),
        });
        if (!reviewed) {
            if (workId) return completed;
            continue;
        }
        if (context.holds.length) {
            const command = host.navigate && blocking && host.operationRecovery?.(blocking);
            const canDelegate = host.delegate && context.delegation.eligible && !context.delegation.existing;
            if (host.navigate || canDelegate) {
                const action = await chooseUiItem(host, t('integration.firstRecoveryTitle'), [
                    { value: 'back', label: t('integration.choice.back') },
                    ...(command ? [{ value: 'operation', label: t('integration.firstBlockerOpen', { id: quoteText(blocking.id) }) }] : []),
                    ...(canDelegate ? [{ value: 'delegate', label: t('integration.receiverDelegate') }] : []),
                    ...(host.navigate ? [{ value: 'work', label: t('integration.choice.work') }] : []),
                ]);
                fresh();
                if (action === 'operation' && command && host.navigate) {
                    if (host.operationRecovery?.(blocking) !== command)
                        throw Error(t('integration.firstBlockerChanged'));
                    const outcome = await host.navigate(command);
                    if (outcome !== 'cancelled')
                        return outcome;
                }
                if (action === 'work' && host.navigate)
                    return host.navigate('/work ' + selected.workId);
                if (action === 'delegate' && host.delegate) {
                    const outcome = await host.delegate(selected.workId, targetId);
                    if (typeof outcome === 'string')
                        return outcome;
                    completed ||= outcome;
                }
            }
            if (workId)
                return completed;
            continue;
        }
        const back = t('integration.firstConfirmBack'), prepare = t('integration.firstConfirmProceed');
        const decision = await host.choose(t('integration.firstConfirmTitle'), [back, prepare]);
        fresh();
        if (!decision || decision === back) {
            if (workId) return completed;
            continue;
        }
        if (decision !== prepare)
            throw Error('Unknown first integration decision');
        const result = await host.prepare(selected.workId, targetId, context, fresh);
        host.guard();
        if (result !== undefined) {
            completed = true;
            const read = () => c.inspectRetainedIntegration(result.operationId);
            if (result.workId !== selected.workId || result.targetId !== targetId)
                throw Error(t('integration.firstOutcomeChanged'));
            const original = read();
            if (original.entry.operationId !== result.operationId || original.entry.workId !== selected.workId || original.entry.targetId !== targetId)
                throw Error(t('integration.firstOutcomeChanged'));
            const title = t('integration.firstOutcomeTitle');
            const body = integrationText(original, locale);
            if (!original.view || original.entry.state !== 'RETAINED') {
                await host.show(title, body);
                host.guard();
            } else {
                const work = captureDeliveryWork(c, selected.workId, locale);
                const open = await showReviewAction(host, title, body, t('integration.firstOutcomeOpen'));
                host.guard();
                if (open) {
                    work.assertCurrent();
                    if (JSON.stringify(read()) !== JSON.stringify(original))
                        throw Error(t('integration.firstOutcomeChanged'));
                    const outcome = await host.openOriginal(result.operationId, targetId, true);
                    if (typeof outcome === 'string' && outcome !== 'cancelled')
                        return outcome;
                }
            }
        }
        if (workId)
            return completed;
    }
}

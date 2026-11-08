import { openWorkRecovery, chooseHeldWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import { showReviewText, type ReviewPageHost } from './exact-review.js';
import { availableWorkAllowance, workAllowanceText } from './work-allowance-presentation.js';
import type { Controller } from '../controller/controller.js';
import type { HostCommandOutcome } from './host-commands.js';
import type { BudgetView } from '../controller/work-recovery.js';
import type { PublicationView } from '../controller/publication-types.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { uiText, type MessageId, type UiLocale } from './i18n.js';
import { escapeDisplayControls, escapeJsonControls, quoteText } from './inspection-text.js';
interface Host extends RecoveryNavigation, UiChoiceHost, ReviewPageHost {
    locale?: UiLocale;
    guard(): void;
    reopenCommand?(view: PublicationView): string | undefined;
    reconcile?(id: string, fresh: () => void): Promise<{ view: PublicationView; interrupted: boolean } | undefined>;
    dispatch?(id: string, fresh: () => void): Promise<PublicationView | undefined>;
    resumePreparation?(input: {
        operationId: string;
        resourceId: string;
        revisionId: string;
        targetId: string;
    }, fresh: () => void): Promise<PublicationView | undefined>;
}
const transport = {
    'not-started': 'integration.transport.notStarted',
    'native-success': 'integration.transport.success',
    uncertain: 'integration.transport.uncertain',
} as const satisfies Record<NonNullable<PublicationView['transportOutcome']>, MessageId>;
const observation = {
    'resource-matches': 'publication.observed.matches',
    'not-observed': 'publication.observed.none',
    unknown: 'publication.observed.unknown',
} as const satisfies Record<PublicationView['observedOutcome'], MessageId>;
type RetainedPublication = ReturnType<Controller['inspectRetainedPublication']>;
type PublicationEntry = Extract<RetainedPublication['entry'], { state: 'RETAINED' }>;
function publicationIdentity(entry: PublicationEntry) {
    return JSON.stringify([entry.operationId, entry.workId, entry.targetId, entry.projectId, entry.target, entry.action, entry.purpose]);
}
function publicationOutcome(view: PublicationView) {
    return JSON.stringify([view.payloadHash, view.phase, view.transportOutcome, view.observedOutcome, view.resource]);
}
/** Inspection stays offline. Read reconciliation and reviewed original send are distinct explicit actions. */
export async function browsePublications(host: Host, controller: Controller, operationId?: string) {
    let before: string | undefined, focusedOperation: string | undefined, completed = false;
    const locale = host.locale ?? 'en';
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const page = operationId ? { operations: [controller.inspectRetainedPublication(operationId).entry], nextCursor: null } :
            controller.listPublications({ limit: 25, ...before ? { before } : {} });
        const rows = page.operations.map(row => ({
            value: 'operation:' + row.operationId,
            label: row.state === 'RETAINED' ? `${row.target.owner}/${row.target.repository} · ${row.action}:${row.purpose} · recorded ${row.recordedPhase} · ${row.operationId}` : `Unavailable retained operation · ${row.operationId}`,
        }));
        const picked = operationId ? rows[0]?.value : await chooseUiItem(host,
            'Retained publications · recorded facts, no recovery or send' + (rows.length ? '' : ' · none on this page'), [
                ...rows,
                ...(page.nextCursor ? [{ value: 'older', label: 'Older publications' }] : []),
                ...(newer.length ? [{ value: 'newer', label: 'Newer publications' }] : []),
                { value: 'refresh', label: 'Refresh retained list' },
                { value: 'back', label: 'Back' },
            ], focusedOperation);
        host.guard();
        if (!picked || picked === 'back')
            return completed;
        if (picked === 'refresh')
            continue;
        if (picked === 'older' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            focusedOperation = undefined;
            continue;
        }
        if (picked === 'newer' && newer.length) {
            before = newer.pop();
            focusedOperation = undefined;
            continue;
        }
        const selected = page.operations.find(row => 'operation:' + row.operationId === picked);
        if (!selected)
            throw Error('Unknown retained publication selection');
        focusedOperation = picked;
        const inspect = () => controller.inspectRetainedPublication(selected.operationId);
        const { entry, view: opened } = inspect();
        if (JSON.stringify(entry) !== JSON.stringify(selected))
            throw Error('Original publication changed; reopen its retained list');
        if (!opened || entry.state !== 'RETAINED') {
            await host.show('Unavailable original publication · no repair performed', JSON.stringify(entry, null, 2));
            host.guard();
            if (operationId) return completed;
            continue;
        }
        let original = { entry, view: opened };
        let snapshot = JSON.stringify(original);
        const fresh = () => {
            host.guard();
            if (JSON.stringify(inspect()) !== snapshot)
                throw Error('Original publication facts changed; inspect the retained operation again');
        };
        const identity = publicationIdentity(entry);
        const repository = entry.target;
        const recordedFacts = (view: PublicationView) => {
            const resource = view.resource?.id;
            const observed = view.observedOutcome === 'resource-matches' && typeof resource === 'number' && Number.isSafeInteger(resource) && resource > 0
                ? uiText(locale, 'publication.observed.resource', { id: resource })
                : uiText(locale, observation[view.observedOutcome]);
            return [
                uiText(locale, 'publication.record.title', { id: escapeDisplayControls(selected.operationId) }),
                `${escapeDisplayControls(repository.owner + '/' + repository.repository)} · ${view.action}:${view.purpose}`,
                uiText(locale, 'publication.field.phase', { phase: view.phase }),
                uiText(locale, 'publication.field.transport', { outcome: uiText(locale, view.transportOutcome === null ? 'integration.transport.none' : transport[view.transportOutcome]) }),
                uiText(locale, 'publication.field.observation', { outcome: observed }),
            ];
        };
        const canReadResult = (view: PublicationView) => !!host.reconcile && ['UNKNOWN', 'INVOKING'].includes(view.phase);
        const showOutcome = async (title: string, result: PublicationView | undefined, mayRevisePayload = false) => {
            if (!result) {
                fresh();
                return;
            }
            completed = true;
            const previous = original.view;
            const expected = publicationOutcome(result);
            const receipts = [...previous.receiptIds, ...result.receiptIds];
            const changed = () => Error(uiText(locale, 'publication.outcomeChanged', { id: selected.operationId }));
            if (result.operationId !== entry.operationId || result.workId !== entry.workId || result.targetId !== entry.targetId ||
                result.action !== entry.action || result.purpose !== entry.purpose ||
                (!mayRevisePayload && result.payloadHash !== previous.payloadHash) ||
                (previous.transportOutcome !== null && result.transportOutcome !== previous.transportOutcome))
                throw changed();
            const read = () => {
                host.guard();
                const { entry, view } = inspect();
                if (entry.state !== 'RETAINED' || !view || publicationIdentity(entry) !== identity ||
                    publicationOutcome(view) !== expected || receipts.some(id => !view.receiptIds.includes(id)))
                    throw changed();
                return { entry, view };
            };
            read();
            const reopenCommand = host.reopenCommand?.(result);
            const facts = [
                ...recordedFacts(result),
                uiText(locale, 'publication.reviewWork', { id: quoteText(result.workId) }),
                canReadResult(result)
                    ? uiText(locale, 'publication.returnToRead', { action: uiText(locale, 'publication.choice.read') })
                    : uiText(locale, 'publication.returnToOriginal'),
                reopenCommand ? uiText(locale, 'publication.reopenRoute', { command: reopenCommand }) : uiText(locale, 'publication.reopenBrowse'),
            ];
            await host.show(title, facts.join('\n'));
            original = read();
            snapshot = JSON.stringify(original);
        };
        while (true) {
            const { view } = original;
            const title = recordedFacts(view).join('\n');
            const confirmAction = async (kind: 'send' | 'prepare' | 'read', effect: string, context: {
                unsettled: boolean;
                execution: BudgetView;
            }, details: object, current: () => void, confirmation: {
                title: string;
                back: string;
                proceed: string;
                invalid: string;
            }): Promise<HostCommandOutcome | 'confirmed' | undefined> => {
                const hold = context.unsettled ? uiText(locale, 'publication.reviewUnsettled')
                    : !availableWorkAllowance(context.execution) ? uiText(locale, 'publication.reviewExhausted') : undefined;
                const summary = [
                    ...(hold ? [hold] : []),
                    uiText(locale, 'publication.reviewDestination', { repository: quoteText(`${repository.host}/${repository.owner}/${repository.repository}`) }),
                    uiText(locale, 'publication.originalOperation', { id: quoteText(selected.operationId) }),
                    uiText(locale, 'publication.reviewWork', { id: quoteText(view.workId) }),
                    effect,
                    workAllowanceText(locale, 'execution', context.execution),
                ];
                const accepted = await showReviewText(host, uiText(locale, `publication.reviewTitle.${kind}`),
                    summary.join('\n') + '\n\n' + escapeJsonControls(JSON.stringify(details, null, 2)), current,
                    uiText(locale, 'review.only'), locale, {
                        next: uiText(locale, 'review.next'),
                        finish: uiText(locale, hold ? 'review.recovery' : 'review.confirm'),
                    });
                if (!accepted)
                    return;
                if (hold)
                    return chooseHeldWorkRecovery(host, view.workId, current, hold);
                const { title, back, proceed, invalid } = confirmation;
                const decision = await host.choose(title, [back, proceed]);
                if (decision === proceed)
                    return 'confirmed';
                current();
                if (decision && decision !== back)
                    throw Error(invalid);
            };
            const unsent = view.transportOutcome === null && view.observedOutcome === 'not-observed';
            const action = await chooseUiItem(host, title, [
                { value: 'back', label: uiText(locale, 'integration.choice.back') },
                ...host.navigate ? [{ value: 'work', label: uiText(locale, 'integration.choice.work') }] : [],
                { value: 'inspect', label: uiText(locale, 'publication.choice.inspect') },
                ...canReadResult(view) ? [{ value: 'read', label: uiText(locale, 'publication.choice.read') }] : [],
                ...host.dispatch && view.phase === 'RESERVED' && unsent ? [{ value: 'send', label: uiText(locale, 'publication.choice.send') }] : [],
                ...host.resumePreparation && view.phase === 'REFUSED' && view.purpose === 'contribution-summary' && unsent ? [{ value: 'resume', label: uiText(locale, 'publication.choice.resume') }] : [],
            ]);
            fresh();
            if (!action || action === 'back') {
                break;
            }
            if (action === 'work') {
                const outcome = await openWorkRecovery(host, view.workId, fresh);
                if (outcome)
                    return outcome;
                continue;
            }
            if (action === 'resume' && host.resumePreparation) {
                const context = controller.inspectPublicationPreparation(selected.operationId), current = () => {
                    fresh();
                    if (JSON.stringify(controller.inspectPublicationPreparation(selected.operationId)) !== JSON.stringify(context))
                        throw Error('Original summary preparation revision, scope or allowance changed; reopen its recovery review');
                };
                const scope = 'Resume the same unsent owner operation/work/target/grant. The current complete host summary may be a newer revision on the same native parent. One admitted preflight consumes remaining original execution allowance. No allowance reset, work revival or POST. Sending requires separate review.';
                const decision = await confirmAction('prepare', uiText(locale, 'publication.reviewEffect.prepare'), context.context, { scope, ...context }, current, {
                    title: 'Explicit original preparation recovery',
                    back: 'Back without preparing',
                    proceed: 'Prepare current summary on this original',
                    invalid: 'Unknown original summary recovery decision',
                });
                if (decision !== 'confirmed') {
                    if (decision) return decision;
                    continue;
                }
                current();
                const result = await host.resumePreparation({ operationId: selected.operationId, resourceId: context.current.resourceId, revisionId: context.current.revisionId, targetId: context.targetId }, current);
                await showOutcome('Original summary preparation recovery retained · inspect phase · not sent', result, true);
                continue;
            }
            if (action === 'send' && host.dispatch) {
                const context = controller.inspectPublicationDispatch(selected.operationId), current = () => {
                    fresh();
                    if (JSON.stringify(controller.inspectPublicationDispatch(selected.operationId)) !== JSON.stringify(context))
                        throw Error('Original publication payload, authorization or allowance changed; reopen its send review');
                };
                // The sealed carrier already contains the exact approved body.
                const { action, payloadUtf8, ...metadata } = context, { body: omittedBody, ...operands } = action;
                const scope = 'Creates the specified remote resource/comment and may notify people. This is publication only, not reviewed software completion or landing. One admitted dispatch consumes the original execution allowance, including no-handoff refusal or uncertain outcome. Never automatically resend an uncertain attempt.';
                const verb = uiText(locale, `publication.reviewAction.${view.action}`);
                const destination = action.kind === 'create-comment' ? `${verb} #${action.parent.number}` : verb;
                const visibility = uiText(locale, context.visibility === 'public' ? 'publication.reviewVisibility.public' : 'publication.reviewVisibility.private');
                const effect = uiText(locale, 'publication.reviewEffect.send', { action: destination, visibility });
                const decision = await confirmAction('send', effect, context.context, { scope, ...metadata, action: operands, payloadUtf8 }, current, {
                    title: 'Confirm exact original publication write',
                    back: 'Back without sending',
                    proceed: 'Send this original prepared publication',
                    invalid: 'Unknown original publication send decision',
                });
                if (decision !== 'confirmed') {
                    if (decision) return decision;
                    continue;
                }
                current();
                const result = await host.dispatch(selected.operationId, current);
                await showOutcome('Original publication send outcome retained · inspect phase and transport', result);
                continue;
            }
            if (action === 'read' && host.reconcile) {
                const context = controller.inspectPublicationReconciliation(selected.operationId), current = () => {
                    fresh();
                    if (JSON.stringify(controller.inspectPublicationReconciliation(selected.operationId)) !== JSON.stringify(context))
                        throw Error('Original publication allowance or producer state changed; reopen its reconciliation action');
                };
                const scope = 'Native reads only. One accepted attempt consumes the original execution allowance even if cancelled or unavailable. No resend, replacement operation, new grant, work revival or allowance reset. Confirmed resource correspondence does not change original transport uncertainty.';
                const decision = await confirmAction('read', uiText(locale, 'publication.reviewEffect.read'), context, { scope, entry: original.entry, context }, current, {
                    title: 'Explicit original-publication action',
                    back: 'Back without reconciliation',
                    proceed: 'Reconcile original with read requests',
                    invalid: 'Unknown original reconciliation action',
                });
                if (decision !== 'confirmed') {
                    if (decision) return decision;
                    continue;
                }
                current();
                const result = await host.reconcile(selected.operationId, current);
                const title = result?.interrupted && result.view.phase === 'UNKNOWN'
                    ? uiText(locale, 'publication.readInterrupted')
                    : 'Original publication reconciliation retained · inspect actual outcome';
                await showOutcome(title, result?.view);
                continue;
            }
            if (action !== 'inspect')
                throw Error('Unknown retained publication action');
            const text = JSON.stringify({ scope: 'Recorded original publication only. Matching resource and confirmed phase do not establish current authority, causal transport success or software completion. Reconciliation requires its separate explicit read action; dispatch requires its separate exact-carrier review action.', entry: original.entry, publication: original.view }, null, 2);
            await host.show('Original publication · phase, transport and observation remain separate', text.length > 32768 ? text.slice(0, 32768) + '\n[Shortened; use publication inspect --operation ' + selected.operationId + ' for full bounded detail]' : text);
            fresh();
        }
        if (operationId) return completed;
    }
}

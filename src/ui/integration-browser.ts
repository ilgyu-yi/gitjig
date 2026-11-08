import { truncateToWidth } from '@earendil-works/pi-tui';
import { plainTerminalText } from './chrome.js';
import { escapeDisplayControls, escapeJsonControls, quoteText } from './inspection-text.js';
import { integrationStatus, integrationText } from './integration-presentation.js';
import { uiText, type UiLocale, type MessageId } from './i18n.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { openWorkRecovery, chooseHeldWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import { showExactInspection, showExactReview, showReviewText, type ReviewPageHost } from './exact-review.js';
import { availableWorkAllowance, workAllowanceText } from './work-allowance-presentation.js';
import type { EffectView } from '../controller/effect-types.js';
import type { Controller } from '../controller/controller.js';
type Reauthorization = Awaited<ReturnType<Controller['reauthorizeOwnerIntegration']>>;
const retained = ({ entry, view }: ReturnType<Controller['inspectRetainedIntegration']>) =>
    entry.state === 'RETAINED' && view ? { entry, view } : undefined;
type IntegrationRecord = NonNullable<ReturnType<typeof retained>>;
function receiverIdentity(entry: IntegrationRecord['entry']) {
    return JSON.stringify([entry.operationId, entry.workId, entry.targetId, entry.projectId, entry.family, entry.endpoint, entry.ref]);
}
function projection(view: EffectView) {
    return JSON.stringify([view.candidateVersion, view.expectedBase, view.headCommit, view.integrationCommit]);
}
function hasHandoff(view: EffectView) {
    return view.transportOutcome !== null || view.observedOutcome !== 'not-observed' ||
        ['INVOKING', 'UNKNOWN', 'CONFIRMED'].includes(view.phase);
}
interface Host extends RecoveryNavigation, ReviewPageHost, UiChoiceHost {
    locale?: UiLocale;
    input?(title: string, value: string): Promise<string | undefined>;
    reauthorize?(id: string, context: ReturnType<Controller['inspectIntegrationReauthorization']>, reason: string, fresh: () => void): Promise<Reauthorization>;
    preparationModel?: {
        provider: string;
        modelId: string;
    };
    prepare?(id: string, context: ReturnType<Controller['inspectIntegrationPreparation']>, fresh: () => void): Promise<EffectView | undefined>;
    dispatch?(id: string, context: ReturnType<Controller['inspectIntegrationDispatch']>, fresh: () => void): Promise<EffectView | undefined>;
    guard(): void;
    notice?(message: string): void;
    reconcile?(id: string, context: ReturnType<Controller['inspectIntegrationReconciliation']>, fresh: () => void): Promise<EffectView | 'interrupted' | undefined>;
}
/** Retained facts only. Selecting a record never opens Git or settles a producer. */
export async function browseIntegrations(host: Host, controller: Controller, initialOperationId?: string, {
    pinned = false, workId,
}: { pinned?: boolean; workId?: string } = {}) {
    const locale = host.locale ?? 'en';
    const choiceMessages: Partial<Record<string, Extract<MessageId, `integration.choice.${string}`>>> = {
        "Back without action": "integration.choice.back",
        "Open original work recovery and allowances": "integration.choice.work",
        "Inspect original integration facts": "integration.choice.inspect",
        "Review original authority reauthorization": "integration.choice.reauthorizeReview",
        "Review original integration preparation": "integration.choice.prepareReview",
        "Review and send original prepared integration": "integration.choice.sendReview",
        "Reconcile original integration · read only": "integration.choice.readReview",
        "Back without reauthorization": "integration.choice.reauthorizeBack",
        "Reauthorize this unsent original": "integration.choice.reauthorize",
        "Back without preparation": "integration.choice.prepareBack",
        "Prepare this original integration": "integration.choice.prepare",
        "Back without sending": "integration.choice.sendBack",
        "Send this original prepared integration": "integration.choice.send",
        "Back without reconciliation": "integration.choice.readBack",
        "Reconcile original receiver with read requests": "integration.choice.read"
    };
    const boundedDisplay = (value: string) => {
        if (Buffer.byteLength(value) > 8192) return null;
        const escaped = escapeDisplayControls(value).replace(/[\p{Bidi_Control}\u2028\u2029]/gu,
            character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
        return Buffer.byteLength(escaped) <= 8192 ? escaped : null;
    };
    const choose = (title: string, values: string[], context: readonly string[] = []) => chooseUiItem(host,
        [title, ...context].map(line => boundedDisplay(line) ?? uiText(locale, 'integration.pickerTitleOmitted')).join('\n'),
        values.map((value, index) => ({ value,
            label: boundedDisplay(choiceMessages[value] ? uiText(locale, choiceMessages[value]) : value)
                ?? uiText(locale, 'integration.pickerRowOmitted', { ordinal: index + 1 }),
        })));

    const inspect = (id: string) => controller.inspectRetainedIntegration(id, true);
    const pinnedOperationId = pinned ? initialOperationId : undefined;
    let before: string | undefined, focusedOperation: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const initial = pinnedOperationId ?? initialOperationId;
        initialOperationId = undefined;
        const page = initial ? { operations: [inspect(initial).entry], nextCursor: null }
            : controller.listIntegrations({ limit: 25, includeRequestPreview: true, ...before ? { before } : {}, ...(workId === undefined ? {} : { workId }) });
        const rowLabel = (row: typeof page.operations[number]) => {
            if (row.state !== 'RETAINED')
                return uiText(locale, 'integration.unavailable', { id: row.operationId });
            const request = truncateToWidth(plainTerminalText(row.requestPreview ?? '').replace(/\p{Bidi_Control}/gu, '').replace(/\s+/gu, ' ').trim(), 42, '…');
            const status = integrationStatus({ phase: row.recordedPhase }, locale);
            const prefix = [status, row.operationId, row.family, ...(request ? [request] : [])];
            const branch = [...prefix, row.ref].join(' · ');
            const label = [branch, row.endpoint].join(' · ');
            if (boundedDisplay(label) !== null)
                return label;
            return boundedDisplay(branch) !== null ? branch : prefix.join(' · ');
        };
        const rows = page.operations.map((row, index) => ({
            value: 'operation:' + row.operationId,
            label: boundedDisplay(rowLabel(row)) ?? uiText(locale, 'integration.pickerRowOmitted', { ordinal: index + 1 }),
        }));
        const title = workId === undefined ? uiText(locale, 'integration.list') : uiText(locale, 'integration.workList', { id: workId });
        const listTitle = title + (rows.length ? '' : ' · ' + uiText(locale, 'integration.empty'));
        const picked = initial ? rows[0]?.value : await chooseUiItem(host, boundedDisplay(listTitle) ?? uiText(locale, 'integration.pickerTitleOmitted'), [
            ...rows,
            ...(page.nextCursor ? [{ value: 'Older integrations', label: uiText(locale, 'integration.choice.older') }] : []),
            ...(newer.length ? [{ value: 'Newer integrations', label: uiText(locale, 'integration.choice.newer') }] : []),
            { value: 'Refresh retained list', label: uiText(locale, 'integration.choice.refresh') },
            { value: 'Back', label: uiText(locale, 'integration.choice.listBack') },
        ], focusedOperation);
        host.guard();
        if (!picked || picked === 'Back')
            return completed;
        if (picked === 'Refresh retained list')
            continue;
        if (picked === 'Older integrations' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            focusedOperation = undefined;
            continue;
        }
        if (picked === 'Newer integrations' && newer.length) {
            before = newer.pop();
            focusedOperation = undefined;
            continue;
        }
        const selected = page.operations.find(row => 'operation:' + row.operationId === picked);
        if (!selected || workId !== undefined && selected.workId !== workId)
            throw Error('Unknown retained integration selection');
        if (!initial)
            focusedOperation = picked;
        const inspected = inspect(selected.operationId);
        const entry = inspected.entry;
        if (JSON.stringify(entry) !== JSON.stringify(selected)) {
            if (!initial && selected.state === 'RETAINED' && entry.state === 'RETAINED' &&
                receiverIdentity(entry) === receiverIdentity(selected)) {
                const id = boundedDisplay(entry.operationId) ?? uiText(locale, 'integration.pickerTitleOmitted');
                await host.show(uiText(locale, 'integration.selectionChanged'), uiText(locale, 'integration.selectAgain', { id }));
                host.guard();
                continue;
            }
            const becameUnavailable = selected.state === 'RETAINED' && entry.state === 'UNAVAILABLE' &&
                entry.operationId === selected.operationId && entry.workId === selected.workId && entry.targetId === selected.targetId;
            if (!becameUnavailable)
                throw Error('Original integration changed; reopen its retained list');
        }
        const opened = retained(inspected);
        if (!opened) {
            await host.show(uiText(locale, 'integration.unavailableTitle'), integrationText(inspected, locale));
            host.guard();
            if (pinnedOperationId) return completed;
            continue;
        }
        let original = opened;
        let snapshot = JSON.stringify(original);
        const current = () => {
            host.guard();
            if (JSON.stringify(inspect(selected.operationId)) !== snapshot)
                throw Error('Original integration facts changed; inspect the retained operation again');
        };
        const showOutcome = async (title: string, result: EffectView | Reauthorization, notice = false) => {
            const { operationId, workId: originalWorkId, targetId } = opened.entry;
            const changed = () => Error(uiText(locale, 'integration.outcomeChanged', { id: operationId }));
            if (result.operationId !== operationId || result.workId !== originalWorkId || result.targetId !== targetId)
                throw changed();
            const effect = 'receiptIds' in result ? result : undefined;
            const receipts = [...original.view.receiptIds, ...('receiptIds' in result ? result.receiptIds : [result.receiptId])];
            const read = () => {
                host.guard();
                const recorded = inspect(operationId), entry = recorded.entry, next = retained(recorded);
                if (entry.operationId !== operationId || entry.workId !== originalWorkId || entry.targetId !== targetId ||
                    next && (receiverIdentity(next.entry) !== receiverIdentity(opened.entry) ||
                        receipts.some(id => !next.view.receiptIds.includes(id)) ||
                        (hasHandoff(original.view) || effect && hasHandoff(effect)) && !hasHandoff(next.view) ||
                        effect && projection(next.view) !== projection(effect)))
                    throw changed();
                return recorded;
            };
            const recorded = read(), source = controller.inspectDeliveryWork(originalWorkId)?.fingerprint;
            await host.show(title, integrationText(recorded, locale, result));
            host.guard();
            if (controller.inspectDeliveryWork(originalWorkId)?.fingerprint !== source)
                throw Error(uiText(locale, 'result.workChanged'));
            const refreshed = read(), next = retained(refreshed);
            if (notice && host.notice) {
                const omitted = uiText(locale, 'integration.pickerTitleOmitted');
                const id = boundedDisplay(operationId) ?? omitted;
                host.notice(next
                    ? uiText(locale, 'integration.editorOutcome', {
                        status: next.view.phase === 'CONFIRMED' && next.view.transportOutcome === 'uncertain'
                            ? uiText(locale, 'integration.editorUncertainSend') : integrationStatus(next.view, locale),
                        branch: boundedDisplay(next.entry.ref) ?? omitted, id,
                    })
                    : uiText(locale, 'integration.unavailable', { id }));
            }
            if (!retained(recorded)) return false;
            if (!next) {
                if (!notice || !host.notice) throw changed();
                return false;
            }
            original = next;
            snapshot = JSON.stringify(next);
            return true;
        };
        while (true) {
            const status = integrationStatus(original.view, locale);
            const menu = pinnedOperationId ? uiText(locale, 'integration.pinnedMenu', {id: selected.operationId}) :
                uiText(locale, 'integration.menu', {status, id: selected.operationId});
            const workLine = uiText(locale, 'integration.field.work') + ' · ' + original.view.workId;
            const refLine = uiText(locale, 'integration.field.ref') + ' · ' + original.entry.ref;
            const receiverLine = uiText(locale, 'integration.field.receiver') + ' · ' + original.entry.endpoint;
            const operationLine = uiText(locale, 'integration.field.operation') + ' · ' + selected.operationId;
            const context = [...(pinnedOperationId ? [status] : []), workLine, refLine, receiverLine];
            const confirm = (kind: 'send' | 'read', values: string[]) => choose(uiText(locale, `integration.${kind}ConfirmTitle`),
                values, [uiText(locale, `integration.${kind}ConfirmEffect`), refLine, workLine, operationLine, receiverLine]);
            const { phase } = original.view;
            const unsent = !hasHandoff(original.view);
            const mayPrepare = unsent && ['PREPARED', 'REFRESHED', 'REFUSED', 'RESERVED'].includes(phase);
            const action = await choose(menu, [
                'Back without action',
                ...(host.navigate ? ['Open original work recovery and allowances'] : []),
                'Inspect original integration facts',
                ...(host.reauthorize && host.input && mayPrepare ? ['Review original authority reauthorization'] : []),
                ...(host.prepare && mayPrepare ? ['Review original integration preparation'] : []),
                ...(host.dispatch && unsent && phase === 'RESERVED' ? ['Review and send original prepared integration'] : []),
                ...(host.reconcile && ['UNKNOWN', 'INVOKING'].includes(phase) ? ['Reconcile original integration · read only'] : []),
            ], context);
            current();
            if (!action || action === 'Back without action') {
                if (pinnedOperationId) return completed;
                break;
            }
            if (action === 'Open original work recovery and allowances') {
                const outcome = await openWorkRecovery(host, original.view.workId, current);
                if (outcome)
                    return outcome;
                current();
                continue;
            }
            if (action === 'Review original authority reauthorization' && host.reauthorize && host.input) {
                const context = controller.inspectIntegrationReauthorization(selected.operationId), fresh = () => {
                    host.guard();
                    if (controller.inspectIntegrationReauthorization(selected.operationId).fingerprint !== context.fingerprint)
                        throw Error('Original reauthorization context changed; reopen its review');
                };
                if (!context.eligible) {
                    await showExactInspection(host, 'Original authority reauthorization held', context, fresh, 'no mutation', locale);
                    const outcome = await openWorkRecovery(host, original.view.workId, fresh);
                    if (outcome)
                        return outcome;
                    current();
                    continue;
                }
                const reason = await host.input('Owner reason to reauthorize this unsent original · 1..4096 bytes', '');
                fresh();
                if (reason === undefined) {
                    current();
                    continue;
                }
                if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                    throw Error('Enter a bounded owner reauthorization reason');
                if (!await showExactReview(host, 'Review exact original authority reauthorization', { scope: 'Retain the same original operation, work, renewed grant, client identity and spent allowances. Archive the previous complete operation and authority as history. Require genuine current procedure evidence. Clear old live projection and hosted authority, then record PREPARED only. No native request, preparation, model turn or send. Explicit native preparation and a separate send decision remain required.', context, reason }, fresh, 'reauthorization only', locale)) {
                    current();
                    continue;
                }
                const decision = await choose('Confirm exact original authority reauthorization', ['Back without reauthorization', 'Reauthorize this unsent original']);
                fresh();
                if (!decision || decision === 'Back without reauthorization') {
                    current();
                    continue;
                }
                if (decision !== 'Reauthorize this unsent original')
                    throw Error('Unknown original reauthorization decision');
                const result = await host.reauthorize(selected.operationId, context, reason, fresh);
                completed = true;
                if (!await showOutcome('Original integration reauthorized · PREPARED only; prepare and send separately', result))
                    break;
                continue;
            }
            if (action === 'Review original integration preparation' && host.prepare) {
                const context = controller.inspectIntegrationPreparation(selected.operationId), baseline = controller.getWorkApplicationModelBaseline(context.reviewed.work.id), fresh = () => {
                    host.guard();
                    if (controller.inspectIntegrationPreparation(selected.operationId).contextFingerprint !== context.contextFingerprint)
                        throw Error('Original integration preparation context changed; reopen its review');
                };
                if (!await showExactReview(host, 'Review original integration preparation', { scope: 'Prepare only; never sends a branch update. Uses original work/grant and retained subject model binding where available; unbound legacy work needs an explicitly supplied invocation recipe. Native projection may adopt a derived candidate and run actual model-backed checks/review, consuming original execution and resolution allowances. Failed or incomplete procedure does not become ready. No new work/grant or allowance reset. Existing initialized client identity must match.', subjectModel: baseline ? { binding: 'captured application baseline', provider: baseline.choice.provider, modelId: baseline.choice.modelId, thinkingLevel: baseline.choice.thinkingLevel } : host.preparationModel ? { binding: 'Explicit legacy invocation recipe; historical match checked only where a subject binding exists', ...host.preparationModel } : 'Explicit legacy model profile required', ...context }, fresh, 'candidate preparation', locale)) {
                    current();
                    continue;
                }
                if (context.context.holds.length) {
                    const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, context.context.holds.join('; '));
                    if (outcome)
                        return outcome;
                    current();
                    continue;
                }
                const decision = await choose('Confirm original integration preparation', ['Back without preparation', 'Prepare this original integration']);
                fresh();
                if (!decision || decision === 'Back without preparation') {
                    current();
                    continue;
                }
                if (decision !== 'Prepare this original integration')
                    throw Error('Unknown original integration preparation decision');
                const result = await host.prepare(selected.operationId, context, fresh);
                host.guard();
                if (result !== undefined) {
                    completed = true;
                    if (!await showOutcome('Original integration preparation retained · sending remains separate', result))
                        break;
                }
                else current();
                continue;
            }
            if (action === 'Review and send original prepared integration' && host.dispatch) {
                const context = controller.inspectIntegrationDispatch(selected.operationId), fresh = () => {
                    host.guard();
                    if (JSON.stringify(inspect(selected.operationId)) !== snapshot || controller.inspectIntegrationDispatch(selected.operationId).contextFingerprint !== context.contextFingerprint)
                        throw Error('Original integration send context changed; reopen its review');
                };
                const { reviewed } = context, { execution, holds } = context.context;
                const blockers = availableWorkAllowance(execution) > 0 ? holds
                    : [...holds, uiText(locale, 'integration.reviewAllowanceExhausted')];
                const operands = [
                    [uiText(locale, 'integration.field.operation'), reviewed.operationId],
                    [uiText(locale, 'integration.field.work'), reviewed.work.id],
                    [uiText(locale, 'integration.field.receiver'), original.entry.endpoint],
                    [uiText(locale, 'integration.field.ref'), original.entry.ref],
                    [uiText(locale, 'integration.sendReviewBase'), reviewed.expectedBase],
                    [uiText(locale, 'integration.sendReviewHead'), reviewed.headCommit],
                    [uiText(locale, 'integration.sendReviewCommit'), reviewed.integrationCommit],
                ].map(([label, value]) => label + ' · ' + (typeof value === 'string' ? quoteText(value) : '—'));
                const detail = [
                    ...(blockers.length ? [uiText(locale, 'integration.sendReviewHeld'), ...blockers.map(quoteText)] : []),
                    ...operands,
                    workAllowanceText(locale, 'execution', execution),
                    uiText(locale, 'integration.sendReviewEffect'),
                ].join('\n') + '\n\n' + escapeJsonControls(JSON.stringify(context, null, 2));
                const continueReview = await showReviewText(host, uiText(locale, 'integration.sendReviewTitle'), detail, fresh,
                    uiText(locale, 'integration.reviewSuffix'), locale, {
                        next: uiText(locale, 'integration.reviewNext'),
                        finish: uiText(locale, blockers.length ? 'integration.reviewRecovery' : 'integration.sendReviewProceed'),
                    });
                if (!continueReview) {
                    current();
                    continue;
                }
                if (blockers.length) {
                    const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, blockers.join('; '));
                    if (outcome)
                        return outcome;
                    current();
                    continue;
                }
                const decision = await confirm('send', ['Back without sending', 'Send this original prepared integration']);
                fresh();
                if (!decision || decision === 'Back without sending') {
                    current();
                    continue;
                }
                if (decision !== 'Send this original prepared integration')
                    throw Error('Unknown original integration send decision');
                const result = await host.dispatch(selected.operationId, context, fresh);
                host.guard();
                if (result !== undefined) {
                    completed = true;
                    if (!await showOutcome(uiText(locale, 'integration.sendOutcomeTitle'), result, true))
                        break;
                }
                else current();
                continue;
            }
            if (action === 'Reconcile original integration · read only' && host.reconcile) {
                const context = controller.inspectIntegrationReconciliation(selected.operationId), fresh = () => {
                    host.guard();
                    if (JSON.stringify(inspect(selected.operationId)) !== snapshot || controller.inspectIntegrationReconciliation(selected.operationId).fingerprint !== context.fingerprint)
                        throw Error('Original integration read context changed; reopen its review');
                };
                const { execution, holds } = context;
                const blockers = availableWorkAllowance(execution) > 0 ? holds
                    : [...holds, uiText(locale, 'integration.reviewAllowanceExhausted')];
                const summary = [
                    ...(blockers.length ? [uiText(locale, 'integration.readReviewHeld'), ...blockers.map(quoteText)] : []),
                    uiText(locale, 'integration.field.operation') + ' · ' + quoteText(selected.operationId),
                    uiText(locale, 'integration.field.work') + ' · ' + quoteText(original.view.workId),
                    uiText(locale, 'integration.field.receiver') + ' · ' + quoteText(original.entry.endpoint),
                    uiText(locale, 'integration.field.ref') + ' · ' + quoteText(original.entry.ref),
                    uiText(locale, 'integration.sendReviewBase') + ' · ' + quoteText(context.expectedBase),
                    uiText(locale, 'integration.readReviewCommit') + ' · ' + quoteText(context.integrationCommit),
                    workAllowanceText(locale, 'execution', execution),
                    uiText(locale, 'integration.readReviewEffect'),
                ].join('\n');
                const scope = 'Read receiver history through private controller-owned Git artifacts. One admitted attempt consumes original execution allowance; a never-admitted cancellation may release its reservation. No push, resend, new grant, replacement work or allowance reset. Isolated observation never clears original quarantine. A matching branch does not prove hosted PR closure or causal transport success. Interrupted/cancelled work requires its own explicit recovery.';
                const { requestPreview: _preview, ...entry } = original.entry;
                const detail = summary + '\n\n' + escapeJsonControls(JSON.stringify({ scope, entry, context }, null, 2));
                const reviewed = await showReviewText(host, uiText(locale, 'integration.readReviewTitle'), detail, fresh,
                    uiText(locale, 'integration.reviewSuffix'), locale, {
                        next: uiText(locale, 'integration.reviewNext'),
                        finish: uiText(locale, blockers.length ? 'integration.reviewRecovery' : 'integration.readReviewProceed'),
                    });
                if (!reviewed) {
                    current();
                    continue;
                }
                if (blockers.length) {
                    const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, blockers.join('; '));
                    if (outcome)
                        return outcome;
                    current();
                    continue;
                }
                const decision = await confirm('read', ['Back without reconciliation', 'Reconcile original receiver with read requests']);
                fresh();
                if (!decision || decision === 'Back without reconciliation') {
                    current();
                    continue;
                }
                if (decision !== 'Reconcile original receiver with read requests')
                    throw Error('Unknown original integration read decision');
                const result = await host.reconcile(selected.operationId, context, fresh);
                host.guard();
                if (result !== undefined) {
                    completed = true;
                    const interrupted = result === 'interrupted';
                    if (!await showOutcome(uiText(locale, interrupted ? 'integration.readInterrupted' : 'integration.readOutcomeTitle'), interrupted ? original.view : result, true))
                        break;
                }
                else current();
                continue;
            }
            if (action !== 'Inspect original integration facts')
                throw Error('Unknown retained integration action');
            await host.show(uiText(locale, 'integration.inspectTitle'), integrationText(original, locale));
            current();
        }
        if (pinnedOperationId) return completed;
    }
}

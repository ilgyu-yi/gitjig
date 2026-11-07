import { escapeDisplayControls } from './inspection-text.js';
import { integrationStatus, integrationText } from './integration-presentation.js';
import { uiText, type UiLocale, type MessageId } from './i18n.js';
import { chooseUiItem, type UiChoice } from './choices.js';
import { openWorkRecovery, chooseHeldWorkRecovery, type RecoveryNavigation } from './recovery-navigation.js';
import { showExactReview } from './exact-review.js';
import type { Controller } from '../controller/controller.js';
interface Host extends RecoveryNavigation {
    locale?: UiLocale;
    chooseItems?(title: string, items: readonly UiChoice[]): Promise<string | undefined>;
    input?(title: string, value: string): Promise<string | undefined>;
    reauthorize?(id: string, context: ReturnType<Controller['inspectIntegrationReauthorization']>, reason: string, fresh: () => void): Promise<unknown>;
    preparationModel?: {
        provider: string;
        modelId: string;
    };
    prepare?(id: string, context: ReturnType<Controller['inspectIntegrationPreparation']>, fresh: () => void): Promise<unknown | undefined>;
    dispatch?(id: string, context: ReturnType<Controller['inspectIntegrationDispatch']>, fresh: () => void): Promise<unknown | undefined>;
    guard(): void;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    reconcile?(id: string, context: ReturnType<Controller['inspectIntegrationReconciliation']>, fresh: () => void): Promise<unknown | undefined>;
}
/** Retained facts only. Selecting a record never opens Git or settles a producer. */
export async function browseIntegrations(host: Host, controller: Controller, initialOperationId?: string, pinned = false) {
    const locale = host.locale ?? 'en';
    const choiceMessages: Partial<Record<string, Extract<MessageId, `integration.choice.${string}`>>> = {
        "Back without action": "integration.choice.back",
        "Open original work recovery and allowances": "integration.choice.work",
        "Inspect original integration facts": "integration.choice.inspect",
        "Review original authority reauthorization": "integration.choice.reauthorizeReview",
        "Review original integration preparation": "integration.choice.prepareReview",
        "Review and send original prepared integration": "integration.choice.sendReview",
        "Reconcile original integration · read only": "integration.choice.readReview",
        "Older integrations": "integration.choice.older",
        "Newer integrations": "integration.choice.newer",
        "Refresh retained list": "integration.choice.refresh",
        "Back": "integration.choice.listBack",
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
        const escaped = escapeDisplayControls(value);
        return Buffer.byteLength(escaped) <= 8192 ? escaped : null;
    };
    const choose = (title: string, values: string[]) => chooseUiItem(host,
        boundedDisplay(title) ?? uiText(locale, 'integration.pickerTitleOmitted'),
        values.map((value, index) => ({ value,
            label: boundedDisplay(choiceMessages[value] ? uiText(locale, choiceMessages[value]) : value)
                ?? uiText(locale, 'integration.pickerRowOmitted', { ordinal: index + 1 }),
        })));

    const pinnedOperationId = pinned ? initialOperationId : undefined;
    let before: string | undefined, completed = false;
    const newer: (string | undefined)[] = [];
    while (true) {
        host.guard();
        const initial = pinnedOperationId ?? initialOperationId;
        initialOperationId = undefined;
        const page = initial ? { operations: [controller.inspectRetainedIntegration(initial).entry], nextCursor: null } : controller.listIntegrations({ limit: 25, ...before ? { before } : {} });
        const labels = page.operations.map(row => row.state === 'RETAINED' ? `${row.family} · ${integrationStatus({ phase: row.recordedPhase }, locale)} · ${row.endpoint} · ${row.ref} · recorded ${row.recordedPhase} · ${row.operationId}` : uiText(locale, 'integration.unavailable', {id: row.operationId}));
        const picked = initial ? labels[0] : await choose(uiText(locale, 'integration.list') + (labels.length ? '' : ' · ' + uiText(locale, 'integration.empty')), [...labels, ...page.nextCursor ? ['Older integrations'] : [], ...newer.length ? ['Newer integrations'] : [], 'Refresh retained list', 'Back']);
        host.guard();
        if (!picked || picked === 'Back')
            return completed;
        if (picked === 'Refresh retained list')
            continue;
        if (picked === 'Older integrations' && page.nextCursor) {
            newer.push(before);
            before = page.nextCursor;
            continue;
        }
        if (picked === 'Newer integrations' && newer.length) {
            before = newer.pop();
            continue;
        }
        const selected = page.operations[labels.indexOf(picked)];
        if (!selected)
            throw Error('Unknown retained integration selection');
        const original = controller.inspectRetainedIntegration(selected.operationId);
        if (JSON.stringify(original.entry) !== JSON.stringify(selected))
            throw Error('Original integration changed; reopen its retained list');
        if (!original.view) {
            await host.show(uiText(locale, 'integration.unavailableTitle'), integrationText(original, locale));
            host.guard();
            if (pinnedOperationId) return completed;
            continue;
        }
        const action = await choose(uiText(locale, 'integration.menu', {status: integrationStatus(original.view, locale), id: selected.operationId}), ['Back without action', ...(host.navigate ? ['Open original work recovery and allowances'] : []), 'Inspect original integration facts', ...host.reauthorize && host.input && ['PREPARED', 'REFRESHED', 'REFUSED', 'RESERVED'].includes(original.view.phase) && original.view.transportOutcome === null ? ['Review original authority reauthorization'] : [], ...host.prepare && ['PREPARED', 'REFRESHED', 'REFUSED', 'RESERVED'].includes(original.view.phase) && original.view.transportOutcome === null ? ['Review original integration preparation'] : [], ...host.dispatch && original.view.phase === 'RESERVED' && original.view.transportOutcome === null ? ['Review and send original prepared integration'] : [], ...host.reconcile && ['UNKNOWN', 'INVOKING'].includes(original.view.phase) ? ['Reconcile original integration · read only'] : []]);
        host.guard();
        if (JSON.stringify(controller.inspectRetainedIntegration(selected.operationId)) !== JSON.stringify(original))
            throw Error('Original integration facts changed; inspect the retained operation again');
        if (!action || action === 'Back without action') {
            if (pinnedOperationId) return completed;
            continue;
        }
        if (action === 'Open original work recovery and allowances') {
            const outcome = await openWorkRecovery(host, original.view.workId, () => {
                host.guard();
                if (JSON.stringify(controller.inspectRetainedIntegration(selected.operationId)) !== JSON.stringify(original))
                    throw Error('Original integration changed; reopen recovery');
            });
            if (outcome)
                return outcome;
            continue;
        }
        if (action === 'Review original authority reauthorization' && host.reauthorize && host.input) {
            const context = controller.inspectIntegrationReauthorization(selected.operationId), fresh = () => {
                host.guard();
                if (controller.inspectIntegrationReauthorization(selected.operationId).fingerprint !== context.fingerprint)
                    throw Error('Original reauthorization context changed; reopen its review');
            };
            if (!context.eligible) {
                await showExactReview(host, 'Original authority reauthorization held', context, fresh, 'no mutation');
                const outcome = await openWorkRecovery(host, original.view.workId, fresh);
                if (outcome)
                    return outcome;
                continue;
            }
            const reason = await host.input('Owner reason to reauthorize this unsent original · 1..4096 bytes', '');
            fresh();
            if (reason === undefined)
                continue;
            if (!reason.trim() || Buffer.byteLength(reason) > 4096)
                throw Error('Enter a bounded owner reauthorization reason');
            await showExactReview(host, 'Review exact original authority reauthorization', { scope: 'Retain the same original operation, work, renewed grant, client identity and spent allowances. Archive the previous complete operation and authority as history. Require genuine current procedure evidence. Clear old live projection and hosted authority, then record PREPARED only. No native request, preparation, model turn or send. Explicit native preparation and a separate send decision remain required.', context, reason }, fresh, 'reauthorization only');
            const decision = await choose('Confirm exact original authority reauthorization', ['Back without reauthorization', 'Reauthorize this unsent original']);
            fresh();
            if (!decision || decision === 'Back without reauthorization')
                continue;
            if (decision !== 'Reauthorize this unsent original')
                throw Error('Unknown original reauthorization decision');
            const result = await host.reauthorize(selected.operationId, context, reason, fresh);
            completed = true;
            host.guard();
            await host.show('Original integration reauthorized · PREPARED only; prepare and send separately', integrationText(controller.inspectRetainedIntegration(selected.operationId), locale, result));
            host.guard();
            continue;
        }
        if (action === 'Review original integration preparation' && host.prepare) {
            const context = controller.inspectIntegrationPreparation(selected.operationId), baseline = controller.getWorkApplicationModelBaseline(context.reviewed.work.id), fresh = () => {
                host.guard();
                if (controller.inspectIntegrationPreparation(selected.operationId).contextFingerprint !== context.contextFingerprint)
                    throw Error('Original integration preparation context changed; reopen its review');
            };
            await showExactReview(host, 'Review original integration preparation', { scope: 'Prepare only; never sends a branch update. Uses original work/grant and retained subject model binding where available; unbound legacy work needs an explicitly supplied invocation recipe. Native projection may adopt a derived candidate and run actual model-backed checks/review, consuming original execution and resolution allowances. Failed or incomplete procedure does not become ready. No new work/grant or allowance reset. Existing initialized client identity must match.', subjectModel: baseline ? { binding: 'captured application baseline', provider: baseline.choice.provider, modelId: baseline.choice.modelId, thinkingLevel: baseline.choice.thinkingLevel } : host.preparationModel ? { binding: 'Explicit legacy invocation recipe; historical match checked only where a subject binding exists', ...host.preparationModel } : 'Explicit legacy model profile required', ...context }, fresh, 'candidate preparation');
            if (context.context.holds.length) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, context.context.holds.join('; '));
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await choose('Confirm original integration preparation', ['Back without preparation', 'Prepare this original integration']);
            fresh();
            if (!decision || decision === 'Back without preparation')
                continue;
            if (decision !== 'Prepare this original integration')
                throw Error('Unknown original integration preparation decision');
            const result = await host.prepare(selected.operationId, context, fresh);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original integration preparation retained · sending remains separate', integrationText(controller.inspectRetainedIntegration(selected.operationId), locale, result));
                host.guard();
            }
            continue;
        }
        if (action === 'Review and send original prepared integration' && host.dispatch) {
            const context = controller.inspectIntegrationDispatch(selected.operationId), fresh = () => {
                host.guard();
                if (JSON.stringify(controller.inspectRetainedIntegration(selected.operationId)) !== JSON.stringify(original) || controller.inspectIntegrationDispatch(selected.operationId).contextFingerprint !== context.contextFingerprint)
                    throw Error('Original integration send context changed; reopen its review');
            };
            await showExactReview(host, 'Review exact original integration send', { scope: 'Conditional branch write from exact expected base to integration commit. May publish code and trigger receiver hooks/CI. One admitted native attempt consumes original execution allowance, including refusal or uncertain handoff. Current procedure, original grant, source and native authority must still pass. No new work, grant, replacement client or allowance reset. Unknown transmission requires read reconciliation, never automatic resend. Branch containment does not establish hosted PR closure.', ...context }, fresh, 'branch write');
            if (context.context.holds.length) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, context.context.holds.join('; '));
                if (outcome)
                    return outcome;
                continue;
            }
            if (context.context.execution.consumed + context.context.execution.reserved >= context.context.execution.limit) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, 'Original integration execution allowance exhausted; recover its original allowance');
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await choose('Confirm exact original integration write', ['Back without sending', 'Send this original prepared integration']);
            fresh();
            if (!decision || decision === 'Back without sending')
                continue;
            if (decision !== 'Send this original prepared integration')
                throw Error('Unknown original integration send decision');
            const result = await host.dispatch(selected.operationId, context, fresh);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original integration send outcome retained · inspect phase and transport', integrationText(controller.inspectRetainedIntegration(selected.operationId), locale, result));
                host.guard();
            }
            continue;
        }
        if (action === 'Reconcile original integration · read only' && host.reconcile) {
            const context = controller.inspectIntegrationReconciliation(selected.operationId), fresh = () => {
                host.guard();
                if (JSON.stringify(controller.inspectRetainedIntegration(selected.operationId)) !== JSON.stringify(original) || controller.inspectIntegrationReconciliation(selected.operationId).fingerprint !== context.fingerprint)
                    throw Error('Original integration read context changed; reopen its review');
            };
            await host.show('Review original integration reconciliation', JSON.stringify({ entry: original.entry, context, scope: 'Read receiver history through private controller-owned Git artifacts. One admitted attempt consumes original execution allowance; a never-admitted cancellation may release its reservation. No push, resend, new grant, replacement work or allowance reset. Isolated observation never clears original quarantine. A matching branch does not prove hosted PR closure or causal transport success. Interrupted/cancelled work requires its own explicit recovery.' }, null, 2));
            fresh();
            if (context.holds.length) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, context.holds.join('; '));
                if (outcome)
                    return outcome;
                continue;
            }
            if (context.execution.consumed + context.execution.reserved >= context.execution.limit) {
                const outcome = await chooseHeldWorkRecovery(host, original.view.workId, fresh, 'Original integration execution allowance exhausted; recover its original allowance');
                if (outcome)
                    return outcome;
                continue;
            }
            const decision = await choose('Explicit original integration read', ['Back without reconciliation', 'Reconcile original receiver with read requests']);
            fresh();
            if (!decision || decision === 'Back without reconciliation')
                continue;
            if (decision !== 'Reconcile original receiver with read requests')
                throw Error('Unknown original integration read decision');
            const result = await host.reconcile(selected.operationId, context, fresh);
            host.guard();
            if (result !== undefined) {
                completed = true;
                await host.show('Original integration reconciliation retained · inspect actual phase and cleanup', integrationText(controller.inspectRetainedIntegration(selected.operationId), locale, result));
                host.guard();
            }
            continue;
        }
        if (action !== 'Inspect original integration facts')
            throw Error('Unknown retained integration action');
        await host.show(uiText(locale, 'integration.inspectTitle'), integrationText(original, locale));
        host.guard();
    }
}

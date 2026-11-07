import type { Controller } from '../controller/controller.js';
import type { EffectView } from '../controller/effect-types.js';
import { escapeDisplayControls, escapeJsonControls } from './inspection-text.js';
import { uiText, type UiLocale, type MessageId } from './i18n.js';

const phaseMessages = {
    PREPARED: 'integration.phase.prepared', REFRESHED: 'integration.phase.prepared',
    RESERVED: 'integration.phase.reserved', INVOKING: 'integration.phase.invoking',
    UNKNOWN: 'integration.phase.unknown', REFUSED: 'integration.phase.refused',
    CONFIRMED: 'integration.phase.confirmed',
} as const satisfies Record<EffectView['phase'], MessageId>;
/** Retained facts only. This projection neither observes Native nor evaluates authority. */
export function integrationStatus(view: Pick<EffectView, 'phase'>, locale: UiLocale = 'en') {
    return uiText(locale, phaseMessages[view.phase]);
}
function nextMessage(view: EffectView): Extract<MessageId, `integration.next.${string}`> {
    if (['UNKNOWN', 'INVOKING'].includes(view.phase)) return 'integration.next.read';
    if (view.phase === 'CONFIRMED') return view.transportOutcome === 'uncertain' ? 'integration.next.confirmedUncertain' : 'integration.next.confirmed';
    if (view.transportOutcome === 'uncertain') return 'integration.next.uncertainFacts';
    if (view.phase === 'REFUSED') return 'integration.next.refused';
    if (view.transportOutcome !== null) return 'integration.next.transport';
    return view.phase === 'RESERVED' ? 'integration.next.send' : 'integration.next.prepare';
}
const transportMessages = {
    'not-started': 'integration.transport.notStarted', 'native-success': 'integration.transport.success',
    'native-rejection': 'integration.transport.rejection', uncertain: 'integration.transport.uncertain',
} as const;
const observationMessages = {
    'contains-integration': 'integration.observed.contains', 'not-observed': 'integration.observed.none', unknown: 'integration.observed.unknown',
} as const;
export function integrationText(original: ReturnType<Controller['inspectRetainedIntegration']>, locale: UiLocale = 'en', result?: unknown) {
    const { view, entry } = original;
    const escapedId = Buffer.byteLength(entry.operationId) <= 4096 ? escapeDisplayControls(entry.operationId) : null;
    const recoveryId = escapedId !== null && Buffer.byteLength(escapedId) <= 4096 ? escapedId : null;
    const omitted = recoveryId === null ? uiText(locale, 'integration.idOmitted') : uiText(locale, 'integration.omitted', {id: recoveryId});
    const detail = (value: unknown) => {
        const text = escapeJsonControls(JSON.stringify(value, null, 2));
        return ['', uiText(locale, 'integration.details'), Buffer.byteLength(text) <= 24576 ? text : omitted].join('\n');
    };
    if (!view || entry.state !== 'RETAINED') return [
        uiText(locale, 'integration.unavailable', {id: recoveryId ?? uiText(locale, 'integration.idOmitted')}),
        uiText(locale, 'integration.unavailableNext'),
    ].join('\n') + detail({entry, ...result === undefined ? {} : {result}});
    const field = (id: Extract<MessageId, `integration.field.${string}`>, value: string) => uiText(locale, id) + ': ' + (Buffer.byteLength(value) <= 8192 ? escapeDisplayControls(value) : omitted);
    const lines = [integrationStatus(view, locale), uiText(locale, nextMessage(view)),
        field('integration.field.transport', uiText(locale, view.transportOutcome === null ? 'integration.transport.none' : transportMessages[view.transportOutcome])),
        field('integration.field.observed', uiText(locale, observationMessages[view.observedOutcome])), uiText(locale, 'integration.limits'), uiText(locale, 'integration.blockerCount', {count: view.blocked.length}),
        field('integration.field.phase', view.phase), field('integration.field.receiver', entry.endpoint), field('integration.field.ref', entry.ref),
        field('integration.field.operation', view.operationId), field('integration.field.work', view.workId),
        ...view.blocked.slice(0, 8).map(reason => field('integration.field.blocker', reason)),
        ...view.blocked.length > 8 ? [uiText(locale, 'integration.moreBlockers', { count: view.blocked.length - 8 })] : [],
        ...view.nextAction ? [field('integration.field.guidance', view.nextAction)] : []];
    // Preserve whole identities. The CLI retains the complete original when a
    // summary field or the exact detail block exceeds this existing display scale.
    const shown: string[] = []; let bytes = 0, omittedFields = 0;
    for (const line of lines) {
        const size = Buffer.byteLength(line) + 1;
        if (bytes + size > 24576) { omittedFields++; continue; }
        shown.push(line); bytes += size;
    }
    if (omittedFields) shown.push(recoveryId === null ? omitted : uiText(locale, 'integration.moreFields', {count: omittedFields, id: recoveryId}));
    return shown.join('\n') + detail({entry, integration: view, ...result === undefined ? {} : {result}});
}

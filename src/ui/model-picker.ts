import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { ApplicationAccounts } from '../app/accounts.js';
type Catalogue = Awaited<ReturnType<ApplicationAccounts['models']>>;
/** Diagnostic actions never enter the model-reference channel. No authentication probe. */
export async function pickApplicationModel(host: UiChoiceHost & {
    locale?: UiLocale;
    show?(title: string, text: string): Promise<void>;
}, catalogue: Catalogue, guard: () => void, title: string, connectedProviders: readonly string[] = []) {
    const t = translator(host.locale ?? 'en');
    const diagnostic = t('model.diagnostic');
    const preferred = new Set(connectedProviders);
    const defaultReference = catalogue.default.provider + '/' + catalogue.default.model;
    const priority = (reference: string) => reference === defaultReference ? 0 : preferred.has(reference.slice(0, reference.indexOf('/'))) ? 1 : 2;
    const references = catalogue.models.map(model => model.provider + '/' + model.id).sort((a, b) => priority(a) - priority(b));
    while (true) {
        guard();
        const items = [
            ...references.map(reference => ({ value: 'model:' + reference, label: reference })),
            ...(host.show ? [{ value: 'diagnostic', label: diagnostic }] : []),
            { value: 'cancel', label: t('runtime.cancel') },
        ];
        const selected = await chooseUiItem(host, t('model.catalogue', { title }), items);
        guard();
        if (!selected || selected === 'cancel')
            return undefined;
        if (selected === 'diagnostic' && host.show) {
            await host.show(t('model.routes'), JSON.stringify({
                routes: catalogue.routes, applicationDefault: catalogue.default, applicationScope: catalogue.scope, verification: catalogue.verification, scope: 'Application metadata only. Approved project overrides can change effective defaults, thinking and cycling scope. Manual model selection remains available before login.', nextAction: 'Use /login for direct accounts, /setup bridge for existing bridge prerequisites, then restart, /scoped-models for application cycling patterns, and /settings to inspect effective preference sources. Catalogue membership is not account entitlement or successful execution.'
            }, null, 2));
            guard();
            continue;
        }
        const reference = selected.startsWith('model:') ? selected.slice('model:'.length) : '';
        if (!references.includes(reference))
            throw Error('Unknown model selection; reopen /model');
        return reference;
    }
}

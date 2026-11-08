import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { AccountView } from '../app/accounts.js';
import { ApplicationStartup } from '../app/startup.js';
import type { Controller } from '../controller/controller.js';
import type { ConversationModelChoice } from '../controller/model-choice.js';
import { modelRouteDetails, type ExternalModelReference, type ModelCatalogue } from './model-route-presentation.js';
/** Diagnostic actions never enter the model-reference channel. No authentication probe. */
export async function pickApplicationModel(host: UiChoiceHost & {
    controller: Controller;
    locale?: UiLocale;
    externalModel?: ExternalModelReference;
    show?(title: string, text: string): Promise<void>;
}, catalogue: ModelCatalogue, options: {
    guard(): void;
    title: string;
    choice: ConversationModelChoice;
    accounts: readonly AccountView[];
    preferConfigured?: boolean;
}) {
    const { guard, title, choice, accounts } = options;
    const locale = host.locale ?? 'en', t = translator(locale);
    const diagnostic = t('model.diagnostic');
    const preferred = new Set(options.preferConfigured ? accounts.filter(account => account.stored || account.configured).map(account => account.provider) : []);
    const defaultReference = catalogue.default.provider + '/' + catalogue.default.model;
    const priority = (reference: string) => reference === defaultReference ? 0 : preferred.has(reference.slice(0, reference.indexOf('/'))) ? 1 : 2;
    const references = catalogue.models.map(model => model.provider + '/' + model.id).sort((a, b) => priority(a) - priority(b));
    const models = references.map(reference => ({ value: 'model:' + reference, label: reference }));
    if (host.show)
        models.splice(1, 0, { value: 'diagnostic', label: diagnostic });
    while (true) {
        guard();
        const items = [
            ...models,
            { value: 'cancel', label: t('runtime.cancel') },
        ];
        const selected = await chooseUiItem(host, t('model.catalogue', { title }), items);
        guard();
        if (!selected || selected === 'cancel')
            return undefined;
        if (selected === 'diagnostic' && host.show) {
            const startup = await ApplicationStartup.open(host.controller).inspect();
            guard();
            await host.show(t('model.routes'), modelRouteDetails(catalogue, choice, accounts, startup, locale, host.externalModel));
            guard();
            continue;
        }
        const reference = selected.startsWith('model:') ? selected.slice('model:'.length) : '';
        if (!references.includes(reference))
            throw Error('Unknown model selection; reopen /model');
        return reference;
    }
}

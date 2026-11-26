import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';
import type { AccountView } from '../app/accounts.js';
import { ApplicationStartup } from '../app/startup.js';
import type { Controller } from '../controller/controller.js';
import type { ConversationModelChoice } from '../controller/model-choice.js';
import { directModelAccount, modelRouteDetails, type ExternalModelReference, type ModelCatalogue } from './model-route-presentation.js';
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
}) {
    const { guard, title, choice, accounts } = options;
    const locale = host.locale ?? 'en', t = translator(locale);
    const diagnostic = t('model.diagnostic');
    const preferred = new Set(accounts.filter(account => account.stored || account.configured).map(account => account.provider));
    const priority = (provider: string) => preferred.has(provider) ? 0 : provider === 'claude-bridge' && catalogue.bridgeCatalogue === 'listed' ? 1 : 2;
    const isDefault = (model: ModelCatalogue['models'][number]) => model.provider === catalogue.default.provider && model.id === catalogue.default.model;
    const ranked = [...catalogue.models].sort((a, b) => priority(a.provider) - priority(b.provider) || Number(isDefault(b)) - Number(isDefault(a)));
    const references = new Set(ranked.map(model => model.provider + '/' + model.id));
    const models = ranked.map(model => {
        const reference = model.provider + '/' + model.id;
        const account = model.provider === 'claude-bridge' ? t('model.route.bridgeListedUnchecked') : directModelAccount(model.provider, accounts, t).status;
        return { value: 'model:' + reference, label: host.chooseItems ? reference + ' · ' + account : reference };
    });
    if (host.show)
        models.splice(1, 0, { value: 'diagnostic', label: diagnostic });
    const selectableRoute = ranked.some(model => priority(model.provider) < 2);
    const opening = !selectableRoute && host.show ? 'diagnostic' : undefined;
    const caption = t('model.catalogue', { title });
    const heading = !selectableRoute && host.chooseItems ? caption + '\n' + t('model.route.noConnectedAccounts') : caption;
    while (true) {
        guard();
        const items = [
            ...models,
            { value: 'cancel', label: t('runtime.cancel') },
        ];
        const selected = await chooseUiItem(host, heading, items, opening);
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
        if (!references.has(reference))
            throw Error('Unknown model selection; reopen /model');
        return reference;
    }
}

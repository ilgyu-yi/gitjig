import type { AccountView, ApplicationAccounts } from '../app/accounts.js';
import type { BridgeCatalogueState } from '../app/models.js';
import type { ApplicationStartup } from '../app/startup.js';
import type { ConversationModelChoice } from '../controller/model-choice.js';
import { translator, type UiLocale } from './i18n.js';

export type ModelCatalogue = Awaited<ReturnType<ApplicationAccounts['models']>>;
type StartupView = Awaited<ReturnType<ApplicationStartup['inspect']>>;
export interface ExternalModelReference {
    provider: string;
    modelId: string;
}
export function parseModelReference(reference: string): ExternalModelReference | undefined {
    const separator = reference.indexOf('/');
    if (separator > 0 && separator < reference.length - 1)
        return { provider: reference.slice(0, separator), modelId: reference.slice(separator + 1) };
}
type T = ReturnType<typeof translator>;

export function providerLoginCommand(provider: string): string {
    return /\s/u.test(provider) ? '/login' : `/login ${provider}`;
}

export function directModelAccount(provider: string, accounts: readonly AccountView[] | undefined, t: T) {
    const account = accounts?.find(entry => entry.provider === provider);
    const state = account?.stored ?? (account?.configured ? 'configured' : account ? 'missing' : 'unknown');
    const status = t(`model.route.account.${state}`);
    return { status, label: `${provider} · ${status}`, needsLogin: state === 'missing' };
}

export function bridgeCatalogueLabel(state: BridgeCatalogueState, t: T): string {
    return t(`model.route.bridge.${state}`);
}

/** Present catalogue and account metadata without resolving credentials or starting a session. */
export function modelRouteDetails(catalogue: ModelCatalogue, choice: ConversationModelChoice, accounts: readonly AccountView[] | undefined,
    startup: StartupView, locale: UiLocale, external?: ExternalModelReference): string {
    const t = translator(locale);
    const current = choice.kind === 'unbound' ? external : choice;
    const reference = current ? `${current.provider}/${current.modelId}` : t('value.unselected');
    const externalRoute = choice.kind === 'legacy-external' || choice.kind === 'unbound' && external;
    const direct = choice.kind === 'managed' && choice.provider !== 'claude-bridge' ? directModelAccount(choice.provider, accounts, t) : undefined;
    const route = externalRoute ? t('model.route.external') : choice.kind === 'unbound' ? t('model.route.choose') :
        direct?.label ?? t('model.route.claudeAccount');
    const future = catalogue.default.provider && catalogue.default.model ? `${catalogue.default.provider}/${catalogue.default.model}` : t('value.unselected');
    const bridge = startup.activation.bridge;
    const bridgeAction = external ? t('model.route.bridgeExternalLaunch') : bridge === 'relaunch' ? t('model.route.bridgeRelaunch') :
        bridge === 'unknown' || catalogue.bridgeCatalogue === 'unavailable' || catalogue.bridgeCatalogue === 'inactive' && startup.effective?.bridge
            ? t('model.route.bridgeInspect') :
            catalogue.bridgeCatalogue === 'inactive' ? t('model.route.bridgeConnect') : undefined;
    const missingDirectModel = direct && choice.kind === 'managed' &&
        !catalogue.models.some(model => model.provider === choice.provider && model.id === choice.modelId);
    const action = missingDirectModel ? t('model.route.selectListed') : direct?.needsLogin ? t('model.route.directLogin') : undefined;
    const scope = catalogue.scope;
    return [
        [t('model.route.current', { model: reference }), t('model.route.account', { route }), action].filter(Boolean).join('\n'),
        [t('model.route.future', { model: future }), t('model.route.projectScope')].join('\n'),
        [bridgeCatalogueLabel(catalogue.bridgeCatalogue, t), bridgeAction].filter(Boolean).join('\n'),
        [t('model.route.scope'), scope.patterns.length ? scope.patterns.join('\n') : t('value.none'),
            t('model.route.matches', { count: scope.models.length }), ...scope.models, ...scope.diagnostics.map(diagnostic => diagnostic.message)].join('\n'),
    ].join('\n\n');
}

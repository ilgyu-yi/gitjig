import { isReceiverLiteralPath } from '../controller/integration-registration-input.js';
import { chooseUiItem, type UiChoiceHost } from './choices.js';
import { translator, type UiLocale } from './i18n.js';

interface Host extends UiChoiceHost {
    locale?: UiLocale;
    guard(): void;
    input(title: string, value: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
}
/** Literal inventories shared by local and hosted receiver forms. No filesystem expansion. */
export async function editIntegrationPaths(host: Host, initial: readonly string[], title: string): Promise<string[]> {
    let paths = [...initial];
    const t = translator(host.locale ?? 'en');
    while (true) {
        host.guard();
        const action = await chooseUiItem(host, t('integration.pathList', { title }), [
            { value: 'add', label: t('integration.pathAdd') },
            ...paths.map((p, index) => ({ value: 'path:' + index, label: t('integration.pathRow', { index: index + 1, path: JSON.stringify(p) }) })),
            { value: 'done', label: t('integration.pathDone') },
        ]);
        host.guard();
        if (!action || action === 'done')
            return paths;
        let index = -1;
        if (action !== 'add') {
            index = Number(action.slice('path:'.length));
            const choice = await chooseUiItem(host, t('integration.pathSelected'), [
                { value: 'edit', label: t('integration.pathEdit') },
                { value: 'remove', label: t('integration.pathRemove') },
                { value: 'back', label: t('integration.choice.listBack') },
            ]);
            host.guard();
            if (!choice || choice === 'back')
                continue;
            if (choice === 'remove') {
                paths = paths.filter((_, i) => i !== index);
                continue;
            }
        }
        const value = await host.input(t('integration.pathInput'), index < 0 ? '' : paths[index]!);
        host.guard();
        if (value === undefined)
            continue;
        if (!isReceiverLiteralPath(value) || paths.some((p, i) => i !== index && p === value)) {
            await host.show(t('integration.pathInvalidTitle'), t('integration.pathInvalid'));
            host.guard();
            continue;
        }
        if (index < 0)
            paths.push(value);
        else
            paths[index] = value;
    }
}

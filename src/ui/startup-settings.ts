import { isDeepStrictEqual } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { ProcessTerminal, Text, VStack, isKeyRelease, matchesKey, type Component } from '@earendil-works/pi-tui';
import type { ApplicationStartup, StartupConfiguration } from '../app/startup.js';
import { createNativeScreen } from './native-screen.js';
import { createNativeEditorFactory } from './native-editor.js';
import { normalizeHostKeyEvent } from './command-input.js';
import { HostPicker } from './host-picker.js';
import { productInput } from './product-input.js';
import { InspectionDetails } from './inspection-details.js';
import { editRuntimeFields } from './runtime-fields.js';
import { editBridgeFields } from './bridge-fields.js';
import { showExactReview } from './exact-review.js';
import { hostUiLanguage, resolveUiLanguage, translator, type UiLocale } from './i18n.js';

/** Explicit management-only entry: existing forms, no conversation or execution owner. */
export async function editStartupSettings(startup: ApplicationStartup, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const locale = resolveUiLanguage(null, hostUiLanguage()).locale, t = translator(locale);
    initTheme('dark', false);
    createNativeEditorFactory();
    const terminal = new ProcessTerminal(), screen = createNativeScreen(terminal);
    type Dialog = Component & { dispose?(): void };
    let closing: boolean = false;
    let dialog: Dialog | undefined, cancel: (() => void) | undefined;
    let rejectDialog: ((error: unknown) => void) | undefined, notice = '', started = false;
    const guard = () => { if (closing) throw Error('Startup settings are closing'); };
    const waiting = () => { screen.setFocus(null); screen.setLayoutRoot(new Text(t('setupEditor.waiting'), 0, 0)); screen.requestRender(); };
    const interact = <T>(create: (complete: (value?: T) => void) => Dialog): Promise<T | undefined> => {
        guard();
        if (dialog) throw Error('Startup settings interaction already active');
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (value?: T, error?: unknown) => {
                if (settled) return;
                settled = true;
                const previous = dialog; dialog = undefined; cancel = undefined; rejectDialog = undefined;
                try { previous?.dispose?.(); waiting(); } catch (failure) { error ??= failure; }
                if (error !== undefined) reject(error); else resolve(value);
            };
            dialog = create(value => finish(value));
            cancel = () => finish(); rejectDialog = error => finish(undefined, error);
            screen.setLayoutRoot(new VStack([
                { component: new Text(t('setupEditor.scope') + (notice ? '\n' + notice : ''), 0, 0), basis: 'auto', shrink: 0 },
                { component: dialog, basis: 0, grow: 1, minSize: 1 },
            ]));
            screen.setFocus(dialog); screen.requestRender();
        });
    };
    const choose = (title: string, rows: string[]) => interact<string>(complete => new HostPicker(title, rows, complete, () => complete(), () => Math.max(1, terminal.rows - 6), locale));
    const input = (title: string, value: string, description?: string) => interact<string>(complete => productInput(title, value, complete, () => complete(), screen, description));
    const show = async (title: string, text: string) => { await interact<void>(complete => new InspectionDetails(title, text, () => complete(), locale)); };
    const onAbort = () => { closing = true; cancel?.(); };
    const removeInput = screen.addInputListener(raw => {
        if (closing || isKeyRelease(raw)) return { consume: true };
        const data = normalizeHostKeyEvent(raw);
        if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'ctrl+d')) onAbort();
        else {
            try { dialog?.handleInput?.(data); }
            catch (error) { rejectDialog?.(error); }
        }
        screen.requestRender(); return { consume: true };
    });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        if (closing) return;
        started = true; screen.start();
        const host = { choose, input, show, guard, notice: (text: string) => { notice = text; } };
        while (!closing) {
            const action = await choose(t('setupEditor.title'), [t('setupEditor.runtime'), t('setupEditor.bridge'), t('setupCombined.entry'), t('setupEditor.exit')]);
            if (closing || !action || action === t('setupEditor.exit')) break;
            try {
                if (action === t('setupEditor.runtime')) {
                    const edit = await startup.prepareRuntimeEdit({ applyRuntime: false });
                    guard();
                    await editRuntimeFields({ ...host, locale, fieldsOnly: true }, edit);
                } else if (action === t('setupEditor.bridge')) {
                    const edit = await startup.prepareBridgeEdit();
                    guard();
                    await editBridgeFields(host, edit);
                } else if (action === t('setupCombined.entry')) {
                    await editCombinedStartupFields({ ...host, locale }, startup);
                } else throw Error('Unknown startup settings action');
            } catch (error) {
                if (closing) break;
                await show(t('setupEditor.unavailable'), error instanceof Error ? error.message : 'Settings action unavailable');
            }
        }
    } finally {
        closing = true; cancel?.(); signal.removeEventListener('abort', onAbort); removeInput(); if (started) screen.stop();
    }
}


interface CombinedHost {
    locale?: UiLocale;
    choose(title: string, rows: string[]): Promise<string | undefined>;
    input(title: string, value: string, description?: string): Promise<string | undefined>;
    show(title: string, text: string): Promise<void>;
    guard(): void;
    notice(text: string): void;
}
/** Component review stages only; the original complete transaction owns the single Save. */
export async function editCombinedStartupFields(host: CombinedHost, startup: ApplicationStartup) {
    host.guard();
    const original = await startup.prepareCombinedEdit(), t = translator(host.locale ?? 'en');
    let draft: StartupConfiguration = { ...original.configuration };
    const guard = () => { host.guard(); original.assertCurrent(); };
    guard();
    const stageHost = { locale: host.locale ?? 'en', guard,
        choose: (title: string, rows: string[]) => host.choose(title, rows),
        input: (title: string, value: string, description?: string) => host.input(title, value, description),
        show: (title: string, text: string) => host.show(title, text),
        notice: (text: string) => host.notice(text),
    };
    while (true) {
        guard();
        const action = await host.choose(t('setupCombined.title'), [t('setupEditor.runtime'), t('setupEditor.bridge'), t('setupCombined.review'), t('setupCombined.back')]);
        guard();
        if (!action || action === t('setupCombined.back')) {
            if (!isDeepStrictEqual(draft, original.configuration)) {
                const choice = await host.choose(t('setupCombined.discardTitle'), [t('setupCombined.keepEditing'), t('setupCombined.discard')]);
                guard();
                if (!choice || choice === t('setupCombined.keepEditing')) continue;
                if (choice !== t('setupCombined.discard')) throw Error('Unknown combined settings discard action');
            }
            host.notice(t('setupCombined.discarded'));
            return 'cancelled' as const;
        }
        if (action === t('setupEditor.runtime')) {
            const base = await startup.prepareRuntimeEdit({ applyRuntime: false });
            guard();
            const validate = async (runtime: Parameters<typeof base.validate>[0], extra?: () => unknown) => {
                const valid = await original.validate({ version: 1, runtime }, extra);
                guard();
                if (!valid.runtime) throw Error('Runtime draft requires explicit fields');
                return { ...draft, runtime: valid.runtime };
            };
            await editRuntimeFields({ ...stageHost, fieldsOnly: true }, { ...base, runtime: draft.runtime, stageForReview: true,
                assertCurrent: guard, validate, save: async (runtime, extra) => { draft = await validate(runtime, extra); },
            });
            continue;
        }
        if (action === t('setupEditor.bridge')) {
            const base = await startup.prepareBridgeEdit();
            guard();
            const validate = async (bridge: StartupConfiguration['bridge'], extra?: () => unknown) => {
                const valid = await original.validate({ version: 1, ...(bridge ? { bridge } : {}) }, extra);
                guard();
                const candidate = { ...draft };
                if (valid.bridge) candidate.bridge = valid.bridge; else delete candidate.bridge;
                return candidate;
            };
            await editBridgeFields(stageHost, { ...base, bridge: draft.bridge, stageForReview: true,
                assertCurrent: guard, validate, save: async (bridge, extra) => { draft = await validate(bridge, extra); },
            });
            continue;
        }
        if (action !== t('setupCombined.review')) throw Error('Unknown combined settings action');
        let valid: StartupConfiguration;
        try { valid = await original.validate(draft, () => host.guard()); }
        catch (error) {
            guard();
            await host.show(t('setupCombined.unavailable'), error instanceof Error ? error.message : t('setupCombined.unavailable'));
            continue;
        }
        guard();
        await showExactReview(host, t('setupCombined.reviewTitle'), { before: original.configuration, after: valid, scope: t('setupCombined.scope') }, guard, t('setupCombined.reviewSuffix'));
        const choice = await host.choose(t('setupCombined.saveTitle'), [t('setupCombined.keepEditing'), t('setupCombined.save')]);
        guard();
        if (!choice || choice === t('setupCombined.keepEditing')) continue;
        if (choice !== t('setupCombined.save')) throw Error('Unknown combined settings save action');
        try { await original.save(valid, () => host.guard()); }
        catch (error) {
            guard();
            await host.show(t('setupCombined.saveUnavailable'), error instanceof Error ? error.message : t('setupCombined.saveUnavailable'));
            continue;
        }
        host.notice(t('setupCombined.saved'));
        return 'completed' as const;
    }
}

import { en } from './locales/en.js';
import { ko } from './locales/ko.js';
/** Product copy only. Opaque source data and protocol values are not translated. */
export type UiLocale = 'en' | 'ko';
export interface UiLanguage {
    locale: UiLocale;
    source: 'conversation' | 'system' | 'fallback';
    requested: string;
}
export function hostUiLanguage(env: Readonly<Record<string, string | undefined>> = process.env): string {
    const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
    return raw.split('.')[0]!.split('@')[0]!.replaceAll('_', '-');
}
export function resolveUiLanguage(replyLanguage: string | null, hostLanguage = hostUiLanguage()): UiLanguage {
    const requested = replyLanguage ?? hostLanguage;
    const base = requested.split('-')[0]!.toLowerCase();
    if (base === 'ko' || base === 'en')
        return { locale: base, source: replyLanguage ? 'conversation' : 'system', requested };
    if (!replyLanguage && ['c', 'posix'].includes(base))
        return { locale: 'en', source: 'system', requested };
    return { locale: 'en', source: 'fallback', requested };
}
export type MessageId = keyof typeof en;
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
type MessageValues<K extends MessageId> = [
    Placeholders<typeof en[K]>
] extends [
    never
] ? [
] : [
    Record<Placeholders<typeof en[K]>, string | number>
];
export function uiText<K extends MessageId>(locale: UiLocale, id: K, ...values: MessageValues<K>): string {
    const args = values[0] as Record<string, string | number> | undefined;
    return (locale === 'ko' ? ko[id] : en[id]).replace(/\{(\w+)\}/gu, (_match, name: string) => {
        if (!args || !Object.hasOwn(args, name))
            throw Error('Missing UI message argument: ' + name);
        return String(args[name]);
    });
}
/** Kept public for catalogue completeness and placeholder parity checks. */
export const uiCatalogues = { en, ko } as const;
export function translator(locale: UiLocale) {
    return <K extends MessageId>(id: K, ...values: MessageValues<K>) => uiText(locale, id, ...values);
}

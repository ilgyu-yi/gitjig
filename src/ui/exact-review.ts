import { uiText, type UiLocale } from './i18n.js';
import { escapeJsonControls } from './inspection-text.js';

export interface ReviewPrimaryAction {
    label: string;
    run(): Promise<void>;
}

export interface ReviewPageHost {
    show(title: string, text: string, primary?: ReviewPrimaryAction, position?: InspectionPosition): Promise<void>;
}
export interface InspectionPosition { scrollTop: number }

/** Show one inspection and report whether the named action was selected. */
export async function showReviewAction(host: ReviewPageHost, title: string, text: string, label: string, position?: InspectionPosition): Promise<boolean> {
    let selected = false;
    await host.show(title, text, { label, run: async () => { selected = true; } }, position);
    return selected;
}

type Advance = { next: string; finish: string; mayAdvance?: () => Promise<boolean> };

/** The caller may continue only when the named final action was selected. */
export function showExactReview(host: ReviewPageHost, title: string, value: unknown, fresh: () => void, suffix: string, locale: UiLocale = 'en',
    advance: Advance = { next: uiText(locale, 'review.next'), finish: uiText(locale, 'review.confirm') }) {
    return showReviewText(host, title, escapeJsonControls(JSON.stringify(value, null, 2)), fresh, suffix, locale, advance);
}

/** A read-only inspection closes on Escape on any page. */
export async function showExactInspection(host: ReviewPageHost, title: string, value: unknown, fresh: () => void, suffix: string, locale: UiLocale = 'en'): Promise<void> {
    await showInspectionText(host, title, escapeJsonControls(JSON.stringify(value, null, 2)), fresh, suffix, locale);
}

export async function showInspectionText(host: ReviewPageHost, title: string, text: string, fresh: () => void, suffix: string, locale: UiLocale,
    next = uiText(locale, 'review.next')): Promise<void> {
    await showPages(host, title, text, fresh, suffix, locale, { next });
}

export function showReviewText(host: ReviewPageHost, title: string, text: string, fresh: () => void, suffix: string, locale: UiLocale, advance: Advance): Promise<boolean> {
    return showPages(host, title, text, fresh, suffix, locale, advance);
}

async function showPages(host: ReviewPageHost, title: string, text: string, fresh: () => void, suffix: string, locale: UiLocale,
    advance: { next: string; finish?: string; mayAdvance?: () => Promise<boolean> }): Promise<boolean> {
    const offsets = [0];
    for (let offset = 0; offset < text.length;) {
        let end = Math.min(offset + 32000, text.length);
        const trailing = text.charCodeAt(end - 1);
        if (end < text.length && trailing >= 0xd800 && trailing <= 0xdbff)
            end--;
        offsets.push(end);
        offset = end;
    }
    const pages = offsets.length - 1;
    for (let page = 0; page < pages; page++) {
        const label = page + 1 < pages ? advance.next : advance.finish;
        const pageTitle = uiText(locale, 'review.pageTitle', { title, page: page + 1, pages, suffix });
        const content = text.slice(offsets[page], offsets[page + 1]);
        if (!label) {
            await host.show(pageTitle, content);
            fresh();
            return false;
        }
        const selected = await showReviewAction(host, pageTitle, content, label);
        fresh();
        if (!selected)
            return false;
        if (advance.mayAdvance) {
            const allowed = await advance.mayAdvance();
            fresh();
            if (!allowed)
                return false;
        }
    }
    return pages > 0;
}

import { escapeJsonControls } from './inspection-text.js';

/** Complete JSON review through the shared bounded inspection component. */
export async function showExactReview(host: {
    show(title: string, text: string): Promise<void>;
}, title: string, value: unknown, fresh: () => void, suffix: string) {
    const text = escapeJsonControls(JSON.stringify(value, null, 2)), pages: string[] = [];
    for (let offset = 0; offset < text.length;) {
        let end = Math.min(offset + 32000, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!))
            end--;
        pages.push(text.slice(offset, end));
        offset = end;
    }
    for (let page = 0; page < pages.length; page++) {
        await host.show(`${title} · page ${page + 1} of ${pages.length} · ${suffix}`, pages[page]!);
        fresh();
    }
}

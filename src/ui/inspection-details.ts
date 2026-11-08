import { uiText, type UiLocale } from './i18n.js';
import { Text, VStack, getKeybindings } from '@earendil-works/pi-tui';
import { LayoutScrollView } from './layout-scroll-view.js';
import { chrome, plainTerminalText } from './chrome.js';
/** Public Pi scrolling/layout primitives keep long recovery text out of the toolbar. */
export class InspectionDetails extends VStack {
    private readonly scroll: LayoutScrollView;
    private done = false;
    constructor(title: string, detail: string, private readonly close: () => void, locale: UiLocale = 'en',
        private readonly primary?: {label: string; confirm: () => void}, scrollTop = 0) {
        const clean = plainTerminalText(detail);
        const text = clean.length > 65536 ? clean.slice(0, 65536) + '\n' + uiText(locale, 'common.inspectionShortened') : clean;
        const scroll = new LayoutScrollView(new Text(text, 0, 0), { follow: 'none', scrollbar: 'auto' });
        if (scrollTop > 0)
            scroll.afterNextLayout = () => scroll.scrollTo(scrollTop);
        const bindings = getKeybindings();
        const confirm = bindings.getKeys('tui.select.confirm').join('/');
        const cancel = bindings.getKeys('tui.select.cancel').join('/');
        const closeHint = primary ? `${cancel} ${uiText(locale, 'common.closes')}` :
            `${cancel} ${uiText(locale, 'common.or')} ${confirm} ${uiText(locale, 'common.closes')}`;
        super([{ component: new Text(chrome('active', title.slice(0, 200).replace(/[\r\n]/gu, ' ')), 0, 0), basis: 'auto', shrink: 0 },
            ...(primary ? [{ component: new Text(chrome('key', `${confirm} · ${primary.label}`), 0, 0), basis: 'auto' as const, shrink: 0 }] : []),
            { component: scroll, basis: 0, grow: 1, minSize: 1 },
            { component: new Text(`${bindings.getKeys('tui.select.up').join('/')} / ${bindings.getKeys('tui.select.down').join('/')} ${uiText(locale, 'common.scroll')} · ${bindings.getKeys('tui.select.pageUp').join('/')} / ${bindings.getKeys('tui.select.pageDown').join('/')} ${uiText(locale, 'common.page')} · ${closeHint}`, 0, 0), basis: 'auto', shrink: 0 }]);
        this.scroll = scroll;
    }
    get scrollTop(): number { return this.scroll.scrollTop; }
    handleInput(data: string): void {
        if (this.done)
            return;
        const keys = getKeybindings();
        if (keys.matches(data, 'tui.select.cancel')) {
            this.dispose();
            this.close();
        }
        else if (keys.matches(data, 'tui.select.confirm')) {
            this.dispose();
            if (this.primary) this.primary.confirm();
            else this.close();
        }
        else if (keys.matches(data, 'tui.select.up'))
            this.scroll.scrollBy(-1);
        else if (keys.matches(data, 'tui.select.down'))
            this.scroll.scrollBy(1);
        else if (keys.matches(data, 'tui.select.pageUp'))
            this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight));
        else if (keys.matches(data, 'tui.select.pageDown'))
            this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight));
    }
    dispose(): void { this.done = true; this.scroll.setScrollbarActive(false); }
}

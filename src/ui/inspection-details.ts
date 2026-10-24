import { uiText, type UiLocale } from './i18n.js';
import { ScrollView, Text, VStack, getKeybindings } from '@earendil-works/pi-tui';
import { chrome, plainTerminalText } from './chrome.js';
/** Public Pi scrolling/layout primitives keep long recovery text out of the toolbar. */
export class InspectionDetails extends VStack {
    private readonly scroll: ScrollView;
    private done = false;
    constructor(title: string, detail: string, private readonly close: () => void, locale: UiLocale = 'en') {
        const clean = plainTerminalText(detail);
        const text = clean.length > 65536 ? clean.slice(0, 65536) + '\n[Display shortened; inspect the original retained work for full details]' : clean;
        const scroll = new ScrollView(new Text(text, 0, 0), { follow: 'none', primary: true, scrollbar: 'auto' });
        const bindings = getKeybindings();
        super([{ component: new Text(chrome('active', title.slice(0, 200).replace(/[\r\n]/gu, ' ')), 0, 0), basis: 'auto', shrink: 0 },
            { component: scroll, basis: 0, grow: 1, minSize: 1 },
            { component: new Text(`${bindings.getKeys('tui.select.up').join('/')} / ${bindings.getKeys('tui.select.down').join('/')} ${uiText(locale, 'common.scroll')} · ${bindings.getKeys('tui.select.pageUp').join('/')} / ${bindings.getKeys('tui.select.pageDown').join('/')} ${uiText(locale, 'common.page')} · ${bindings.getKeys('tui.select.cancel').join('/')} or ${bindings.getKeys('tui.select.confirm').join('/')} ${uiText(locale, 'common.closes')}`, 0, 0), basis: 'auto', shrink: 0 }]);
        this.scroll = scroll;
    }
    handleInput(data: string): void {
        if (this.done)
            return;
        const keys = getKeybindings();
        if (keys.matches(data, 'tui.select.cancel') || keys.matches(data, 'tui.select.confirm')) {
            this.dispose();
            this.close();
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

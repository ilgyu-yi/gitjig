import type { UiChoice } from './choices.js';
import { plainTerminalText } from './chrome.js';
import { uiText, type UiLocale } from './i18n.js';
import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Input, SelectList, fuzzyFilter, getKeybindings, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type Component, type Focusable } from '@earendil-works/pi-tui';
/** Bounded searchable composition of original public input/list components. */
export class HostPicker implements Component, Focusable {
    private readonly input: Input;
    private readonly options: UiChoice[];
    private list: SelectList;
    private filtered: UiChoice[];
    private maximum: number;
    private done = false;
    constructor(private readonly title: string, private readonly labels: readonly (string | UiChoice)[], private readonly select: (value: string) => void, private readonly cancel: () => void, private readonly visibleRows: () => number, private readonly locale: UiLocale = 'en', initialValue?: string) {
        this.input = new Input({ prompt: uiText(locale, 'common.search') });
        this.options = labels.map(item => typeof item === 'string' ? { value: item, label: item } : item);
        if (labels.some(item => typeof item !== 'string') && new Set(this.options.map(item => item.value)).size !== labels.length)
            throw Error('Duplicate picker value');
        this.filtered = this.options;
        this.maximum = this.rows();
        this.list = this.makeList(initialValue);
    }
    private rows(available = this.visibleRows()): number { return Math.max(1, Math.min(8, available)); }
    private makeList(initialValue?: string): SelectList {
        const list = new SelectList(this.filtered.map(({ value, label }) => ({ value, label: stripTerminalSequences(label).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ') })), this.maximum, getSelectListTheme());
        if (initialValue !== undefined) {
            const index = this.filtered.findIndex(item => item.value === initialValue);
            if (index >= 0)
                list.setSelectedIndex(index);
        }
        list.onSelect = item => {
            if (!this.done) {
                this.done = true;
                this.select(item.value);
            }
        };
        list.onCancel = () => {
            if (!this.done) {
                this.done = true;
                this.cancel();
            }
        };
        return list;
    }
    get focused(): boolean { return this.input.focused; }
    set focused(value: boolean) { this.input.focused = value; }
    handleInput(data: string): void {
        if (this.done)
            return;
        const keys = getKeybindings();
        const pageUp = keys.matches(data, 'tui.select.pageUp'), pageDown = keys.matches(data, 'tui.select.pageDown');
        if (pageUp || pageDown) {
            const selected = this.list.getSelectedItem();
            if (selected)
                this.list.setSelectedIndex(this.filtered.findIndex(item => item.value === selected.value) + (pageUp ? -this.maximum : this.maximum));
            return;
        }
        if ((['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'] as const).some(key => keys.matches(data, key))) {
            this.list.handleInput(data);
            return;
        }
        const before = this.input.getValue();
        this.input.handleInput(data);
        if (before !== this.input.getValue()) {
            if (this.input.getValue().length > 4096)
                this.input.setValue(this.input.getValue().slice(0, 4096));
            this.filtered = fuzzyFilter(this.options, this.input.getValue(), item => item.label);
            this.list = this.makeList();
        }
    }
    invalidate(): void { this.input.invalidate(); this.list.invalidate(); }
    render(width: number): string[] {
        const available = this.visibleRows();
        const [heading, ...paragraphs] = plainTerminalText(this.title).replace(/[\u2028\u2029]/gu, ' ').split('\n');
        const context: string[] = [], contextLimit = Math.max(0, available - 1);
        let shortened = false;
        for (const paragraph of paragraphs) {
            const lines = wrapTextWithAnsi(paragraph, width);
            const remaining = contextLimit - context.length;
            if (lines.length > remaining) {
                context.push(...lines.slice(0, remaining));
                shortened = true;
                break;
            }
            context.push(...lines);
        }
        const maximum = this.rows(available - context.length);
        if (maximum !== this.maximum) {
            const selected = this.list.getSelectedItem()?.value;
            this.maximum = maximum;
            this.list = this.makeList(selected);
        }
        const header = [heading ?? '', ...context];
        if (shortened) {
            const last = header.length - 1;
            header[last] = header[last]! + ' …';
        }
        const bindings = getKeybindings();
        const hint = `${uiText(this.locale, 'common.items', { shown: this.filtered.length, total: this.labels.length })} · ${bindings.getKeys('tui.select.cancel').join('/')} ${uiText(this.locale, 'common.cancel')} · ${uiText(this.locale, 'common.filter')} · ${bindings.getKeys('tui.select.up').join('/')} / ${bindings.getKeys('tui.select.down').join('/')} ${uiText(this.locale, 'common.select')} · ${bindings.getKeys('tui.select.confirm').join('/')} ${uiText(this.locale, 'common.confirm')}`;
        const items = this.filtered.length ? this.list.render(width) : [truncateToWidth(uiText(this.locale, this.labels.length ? 'common.noMatches' : 'common.noItems'), width, '…')];
        return [...header.map(line => truncateToWidth(line, width, '…')), ...this.input.render(width), ...items, truncateToWidth(hint, width, '…')];
    }
    dispose(): void { this.done = true; }
}

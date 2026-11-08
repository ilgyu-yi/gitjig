import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Container, Input, SelectList, Text, getKeybindings, matchesKey, sliceByColumn, visibleWidth, truncateToWidth, stripTerminalSequences, type SelectItem } from '@earendil-works/pi-tui';
import type { ConversationView } from '../controller/interaction-types.js';
import { uiText, type UiLocale } from './i18n.js';
type Conversation = Pick<ConversationView, 'conversationId' | 'parentId' | 'label' | 'projectId' | 'state' | 'inputNeeded'>;
type NavigationConversation = Conversation & Partial<Pick<ConversationView, 'archived' | 'deleted'>>;
export type ConversationNavigationMode = 'select' | 'split' | 'children';
export function isNavigationTarget(view: NavigationConversation, currentId: string, mode: ConversationNavigationMode = 'select'): boolean {
    if (view.archived || view.deleted) return false;
    if (mode === 'children') return view.parentId === currentId;
    if (mode === 'split') return view.conversationId !== currentId;
    return true;
}
function navigationRoster(roster: readonly NavigationConversation[], currentId: string, mode?: ConversationNavigationMode): Conversation[] {
    const accessible = roster.filter(view => isNavigationTarget(view, currentId));
    if (mode !== 'children') return accessible;
    const byId = new Map(accessible.map(view => [view.conversationId, view]));
    const visible = new Set(accessible.filter(view => isNavigationTarget(view, currentId, mode)).map(view => view.conversationId));
    let id: string | null = currentId;
    while (id && !visible.has(id)) {
        const view = byId.get(id);
        if (!view) break;
        visible.add(id);
        id = view.parentId;
    }
    return accessible.filter(view => visible.has(view.conversationId));
}
/** A bounded path over the accessible roster. Missing parents are not invented. */
export function conversationPath(roster: readonly Conversation[], id: string, locale: UiLocale = 'en'): string {
    const byId = new Map(roster.map(view => [view.conversationId, view]));
    const parts: string[] = [], seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const view = byId.get(cursor);
        if (!view) {
            parts.unshift(`[${uiText(locale, 'relations.unavailable')} #${cursor.slice(0, 8)}]`);
            break;
        }
        parts.unshift(`${view.label} #${view.conversationId.slice(0, 8)}`);
        cursor = view.parentId;
    }
    if (cursor && seen.has(cursor) && byId.has(cursor))
        parts.unshift(`[${uiText(locale, 'navigation.relationshipCycle')}]`);
    return parts.join(' > ');
}
/** One display row, keeping the current end of a long path visible. */
export function compactConversationPath(roster: readonly Conversation[], id: string, width: number, locale: UiLocale = 'en'): string {
    const path = conversationPath(roster, id, locale).replace(/[\r\n]/g, ' '), size = Math.max(1, width);
    const columns = visibleWidth(path);
    return columns <= size ? path : size < 3 ? '…' : '… ' + sliceByColumn(path, columns - size + 2, size - 2, true);
}
/** Two bounded rows over actual accessible relationships. ! means input needed. */
export function conversationRelations(roster: readonly (Conversation & {
    archived?: boolean;
    deleted?: boolean;
})[], id: string, width: number, statusFor?: (id: string) => string, locale: UiLocale = 'en'): [
    string,
    string
] {
    const size = Math.max(1, width), clean = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    const fit = (value: string, columns = size) => stripTerminalSequences(truncateToWidth(clean(value), Math.max(1, columns), '…'));
    const current = roster.find(view => view.conversationId === id);
    const accessible = roster.filter(view => !view.archived && !view.deleted);
    const summary = (view: Conversation, columns: number) => {
        const marker = view.inputNeeded ? '!' : '';
        const budget = columns - 3 - visibleWidth(marker);
        if (budget < 3) return null;
        const identity = columns >= 36 ? ` #${view.conversationId.slice(0, 8)}` : '';
        const labelWidth = Math.min(8, Math.floor(budget / 3));
        const statusWidth = Math.max(1, budget - visibleWidth(identity) - labelWidth);
        const state = ` [${fit(statusFor?.(view.conversationId) ?? view.state, statusWidth)}${marker}]`;
        const remaining = columns - visibleWidth(state);
        return fit(view.label, remaining - visibleWidth(identity)) + identity + state;
    };
    const parent = accessible.find(view => view.conversationId === current?.parentId);
    const prefix = uiText(locale, 'relations.parent');
    const parentRow = !current ? prefix + uiText(locale, 'relations.unavailable') : !current.parentId ? uiText(locale, 'relations.root') : parent
        ? prefix + (summary(parent, size - visibleWidth(prefix)) ?? `[${parent.state}${parent.inputNeeded ? '!' : ''}]`)
        : prefix + uiText(locale, 'relations.unavailable') + ` #${current.parentId.slice(0, 8)}`;
    const children = accessible.filter(view => view.parentId === id), count = children.length;
    const childPrefix = uiText(locale, 'relations.children', { count });
    let childRow = childPrefix + (count ? uiText(locale, 'relations.more', { count }) : uiText(locale, 'relations.none'));
    for (let shown = Math.min(3, count); shown > 0; shown--) {
        const suffix = count > shown ? ' · ' + uiText(locale, 'relations.more', { count: count - shown }) : '';
        const remaining = size - visibleWidth(childPrefix + suffix) - 3 * (shown - 1);
        const perItem = Math.floor(remaining / shown);
        const entries = children.slice(0, shown).map(view => summary(view, perItem));
        if (entries.every((entry): entry is string => entry !== null)) {
            childRow = childPrefix + entries.join(' · ') + suffix;
            break;
        }
    }
    return [fit(parentRow), fit(childRow)];
}
/** Presentation only: values are actual IDs, never label-derived relationships. */
export class ConversationNavigator extends Container {
    private readonly input: Input;
    private readonly locale: UiLocale;
    private readonly hint = new Text('', 0, 0);
    private readonly path = new Text('', 0, 0);
    private selectedSummary = '';
    private readonly detail = { invalidate() { }, render: (width: number) => [truncateToWidth(this.selectedSummary, Math.max(1, width), '…')] };
    private list!: SelectList;
    private readonly collapsed = new Set<string>();
    private roster: readonly Conversation[];
    private byId: Map<string, Conversation>;
    private rows: SelectItem[] = [];
    private summaries: ReadonlyMap<string, string> = new Map();
    private selectionChanged = false;
    get focused(): boolean { return this.input.focused; }
    set focused(value: boolean) { this.input.focused = value; }
    constructor(roster: readonly NavigationConversation[], private readonly currentId: string, private readonly maxVisible: number, private readonly choose: (id: string) => void, private readonly cancel: () => void,
        private readonly options: { mode?: ConversationNavigationMode; locale?: UiLocale; initialFocusId?: string } = {}) {
        super();
        this.locale = options.locale ?? 'en';
        this.input = new Input({ prompt: uiText(this.locale, 'navigation.search'), placeholder: uiText(this.locale, 'navigation.searchPlaceholder') });
        this.roster = navigationRoster(roster, currentId, options.mode);
        this.byId = new Map(this.roster.map(view => [view.conversationId, view]));
        const title = options.mode === 'children' ? 'navigation.childrenTitle' : options.mode === 'split' ? 'navigation.splitTitle' : 'navigation.title';
        this.addChild(new Text(uiText(this.locale, title), 0, 0));
        this.addChild(this.input);
        this.rebuild(options.initialFocusId ?? currentId);
    }
    /** A fresh display snapshot preserves search, branches and the exact visible selection. */
    updateRoster(roster: readonly NavigationConversation[], summaries: ReadonlyMap<string, string>): void {
        const next = navigationRoster(roster, this.currentId, this.options.mode);
        if (next.length === this.roster.length && next.every((view, index) => {
            const previous = this.roster[index]!;
            return view.conversationId === previous.conversationId && view.parentId === previous.parentId &&
                view.label === previous.label && view.projectId === previous.projectId && view.state === previous.state &&
                view.inputNeeded === previous.inputNeeded && this.summaries.get(view.conversationId) === summaries.get(view.conversationId);
        })) return;
        const selected = this.list.getSelectedItem()?.value;
        const wasSelectable = !!selected && this.selectable(selected);
        this.roster = next;
        this.byId = new Map(next.map(view => [view.conversationId, view]));
        this.summaries = summaries;
        this.rebuild(selected, true);
        if (selected && (this.list.getSelectedItem()?.value !== selected || wasSelectable && !this.selectable(selected))) {
            this.selectionChanged = true;
            this.updatePath();
        }
    }
    private selectable(id: string): boolean {
        const view = this.byId.get(id);
        return !!view && isNavigationTarget(view, this.currentId, this.options.mode);
    }
    private canOpen(id: string): boolean {
        return !this.selectionChanged && this.selectable(id);
    }
    private rebuild(preferred?: string, preserveVisible = false): void {
        const query = this.input.getValue().trim().toLocaleLowerCase();
        const included = new Set<string>(), matches = new Set<string>();
        if (query) {
            for (const view of this.roster) {
                if (!`${view.label} ${view.conversationId} ${view.projectId ?? ''}`.toLocaleLowerCase().includes(query))
                    continue;
                matches.add(view.conversationId);
                let id: string | null = view.conversationId;
                const seen = new Set<string>();
                while (id && !seen.has(id) && this.byId.has(id)) {
                    seen.add(id);
                    included.add(id);
                    id = this.byId.get(id)!.parentId;
                }
            }
        }
        const children = new Map<string | null, Conversation[]>();
        for (const view of this.roster) {
            const parent = view.parentId && this.byId.has(view.parentId) ? view.parentId : null;
            const siblings = children.get(parent) ?? [];
            siblings.push(view);
            children.set(parent, siblings);
        }
        const visited = new Set<string>(), rows: SelectItem[] = [];
        const walk = (root: Conversation) => {
            const pending = [{ view: root, depth: 0 }];
            while (pending.length) {
                const { view, depth } = pending.pop()!;
                if (visited.has(view.conversationId))
                    continue;
                visited.add(view.conversationId);
                if (query && !included.has(view.conversationId))
                    continue;
                const descendants = children.get(view.conversationId) ?? [];
                const marker = descendants.length ? (!query && this.collapsed.has(view.conversationId) ? '[+]' : '[-]') : '   ';
                const relation = view.conversationId === this.currentId ? 'navigation.current' :
                    view.conversationId === this.byId.get(this.currentId)?.parentId ? 'navigation.parent' :
                        view.parentId === this.currentId ? 'navigation.child' : undefined;
                const identity = (relation ? uiText(this.locale, relation) + ' ' : '') + view.label;
                const status = this.summaries.get(view.conversationId) ?? uiText(this.locale, `task.resource.${view.state}`) +
                    (view.inputNeeded ? ' · ' + uiText(this.locale, 'pane.inputNeeded') : '');
                rows.push({ value: view.conversationId, label: `${'  '.repeat(Math.min(depth, 12))}${marker} ${identity} #${view.conversationId.slice(0, 8)}`,
                    description: `${status} · ${view.projectId ?? uiText(this.locale, 'pane.noProject')}` });
                if (query || !this.collapsed.has(view.conversationId)) {
                    // Reverse the stack insertion to retain the original sibling order.
                    for (let index = descendants.length - 1; index >= 0; index--)
                        pending.push({ view: descendants[index]!, depth: depth + 1 });
                }
            }
        };
        for (const root of children.get(null) ?? [])
            walk(root);
        // Malformed cycles cannot hide or endlessly traverse otherwise accessible IDs.
        for (const view of this.roster)
            if (!visited.has(view.conversationId))
                walk(view);
        // A collapsed subtree was intentionally skipped, not an orphan.
        if (!query && this.collapsed.size) {
            const hidden = new Set<string>();
            for (const view of this.roster) {
                let id = view.parentId;
                const seen = new Set<string>([view.conversationId]);
                while (id && !seen.has(id)) {
                    seen.add(id);
                    if (this.collapsed.has(id)) {
                        hidden.add(view.conversationId);
                        break;
                    }
                    id = this.byId.get(id)?.parentId ?? null;
                }
            }
            this.rows = rows.filter(row => !hidden.has(row.value));
        }
        else
            this.rows = rows;
        if (this.list) {
            this.removeChild(this.list);
            this.removeChild(this.path);
            this.removeChild(this.detail);
            this.removeChild(this.hint);
        }
        this.list = new SelectList(this.rows, Math.max(1, this.maxVisible), getSelectListTheme(), { minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 52 });
        const focus = query && !(preserveVisible && this.rows.some(row => row.value === preferred))
            ? (matches.has(preferred ?? '') ? preferred : this.rows.find(row => matches.has(row.value))?.value) : preferred;
        this.list.setSelectedIndex(Math.max(0, this.rows.findIndex(row => row.value === focus)));
        this.list.onSelect = item => { if (this.canOpen(item.value)) this.choose(item.value); };
        this.list.onCancel = this.cancel;
        this.list.onSelectionChange = () => this.updatePath();
        this.addChild(this.list);
        this.addChild(this.path);
        this.addChild(this.detail);
        this.addChild(this.hint);
        this.updatePath();
    }
    private updatePath(): void {
        const item = this.list.getSelectedItem();
        this.selectedSummary = item?.description ?? '';
        const locale = this.locale, bindings = getKeybindings();
        this.path.setText(item ? conversationPath(this.roster, item.value, locale) : uiText(locale, 'navigation.noMatches'));
        const select = `${bindings.getKeys('tui.select.up').join('/')} / ${bindings.getKeys('tui.select.down').join('/')} ${uiText(locale, 'common.select')}`;
        const cancel = `${bindings.getKeys('tui.select.cancel').join('/')} ${uiText(locale, 'common.cancel')}`;
        const actions = [select, cancel, uiText(locale, 'navigation.branches')];
        if (item && this.canOpen(item.value)) {
            const key = bindings.getKeys('tui.select.confirm').map(key => key === 'enter' ? 'Enter' : key).join('/');
            actions.splice(1, 0, uiText(locale, 'navigation.open', { key }));
        }
        const guidance = this.selectionChanged ? uiText(locale, 'navigation.selectionChanged')
            : item && !this.selectable(item.value) ? uiText(locale, this.options.mode === 'split' ? 'navigation.splitCurrent' : 'navigation.contextOnly')
                : this.options.mode === 'split' ? '' : uiText(locale, this.options.mode === 'children' ? 'navigation.childScope' : 'navigation.scope');
        this.hint.setText([actions.join(' · '), guidance].filter(Boolean).join('\n'));
    }
    handleInput(data: string): void {
        const keys = getKeybindings(), id = this.list.getSelectedItem()?.value;
        if (keys.matches(data, 'tui.select.cancel')) {
            this.cancel();
            return;
        }
        if ((['tui.select.up', 'tui.select.down', 'tui.select.pageUp', 'tui.select.pageDown', 'tui.select.confirm'] as const).some(key => keys.matches(data, key))) {
            if (!keys.matches(data, 'tui.select.confirm')) this.selectionChanged = false;
            this.list.handleInput(data);
            this.updatePath();
            return;
        }
        if (!this.input.getValue() && id && matchesKey(data, 'left')) {
            this.selectionChanged = false;
            if (this.roster.some(view => view.parentId === id) && !this.collapsed.has(id)) {
                this.collapsed.add(id);
                this.rebuild(id);
            }
            else {
                const parent = this.byId.get(id)?.parentId;
                if (parent) {
                    this.list.setSelectedIndex(Math.max(0, this.rows.findIndex(row => row.value === parent)));
                    this.updatePath();
                }
            }
            return;
        }
        if (!this.input.getValue() && id && matchesKey(data, 'right')) {
            this.selectionChanged = false;
            if (this.collapsed.delete(id))
                this.rebuild(id);
            else {
                const child = this.roster.find(view => view.parentId === id);
                if (child) {
                    this.list.setSelectedIndex(Math.max(0, this.rows.findIndex(row => row.value === child.conversationId)));
                    this.updatePath();
                }
            }
            return;
        }
        const before = this.input.getValue();
        this.input.handleInput(data);
        if (this.input.getValue() !== before) {
            this.selectionChanged = false;
            this.rebuild(id);
        }
    }
}

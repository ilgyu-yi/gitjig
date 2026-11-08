import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { Container, Input, SelectList, Text, getKeybindings, matchesKey, sliceByColumn, visibleWidth, truncateToWidth, stripTerminalSequences, type SelectItem } from '@earendil-works/pi-tui';
import type { ConversationView } from '../controller/interaction-types.js';
type Conversation = Pick<ConversationView, 'conversationId' | 'parentId' | 'label' | 'projectId' | 'state' | 'inputNeeded'>;
/** A bounded path over the accessible roster. Missing parents are not invented. */
export function conversationPath(roster: readonly Conversation[], id: string): string {
    const byId = new Map(roster.map(view => [view.conversationId, view]));
    const parts: string[] = [], seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const view = byId.get(cursor);
        if (!view) {
            parts.unshift(`[unavailable #${cursor.slice(0, 8)}]`);
            break;
        }
        parts.unshift(`${view.label} #${view.conversationId.slice(0, 8)}`);
        cursor = view.parentId;
    }
    if (cursor && seen.has(cursor) && byId.has(cursor))
        parts.unshift('[relationship cycle]');
    return parts.join(' > ');
}
/** One display row, keeping the current end of a long path visible. */
export function compactConversationPath(roster: readonly Conversation[], id: string, width: number): string {
    const path = conversationPath(roster, id).replace(/[\r\n]/g, ' '), size = Math.max(1, width);
    const columns = visibleWidth(path);
    return columns <= size ? path : size < 3 ? '…' : '… ' + sliceByColumn(path, columns - size + 2, size - 2, true);
}
/** Two bounded rows over actual accessible relationships. ! means input needed. */
export function conversationRelations(roster: readonly (Conversation & {
    archived?: boolean;
    deleted?: boolean;
})[], id: string, width: number, statusFor?: (id: string) => string): [
    string,
    string
] {
    const size = Math.max(1, width), clean = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    const fit = (value: string, columns = size) => stripTerminalSequences(truncateToWidth(clean(value), Math.max(1, columns), '…'));
    const current = roster.find(view => view.conversationId === id);
    const accessible = roster.filter(view => !view.archived && !view.deleted);
    const summary = (view: Conversation, columns: number) => {
        const state = ` [${clean(statusFor?.(view.conversationId) ?? view.state)}${view.inputNeeded ? '!' : ''}]`;
        const remaining = columns - visibleWidth(state);
        if (remaining < 2)
            return null;
        const identity = remaining >= 20 ? ` #${view.conversationId.slice(0, 8)}` : '';
        return fit(view.label, remaining - visibleWidth(identity)) + identity + state;
    };
    const parent = accessible.find(view => view.conversationId === current?.parentId);
    const prefix = '↑ Parent: ';
    const parentRow = !current ? '↑ Parent: unavailable' : !current.parentId ? '↑ Root · no parent' : parent
        ? prefix + (summary(parent, size - visibleWidth(prefix)) ?? `[${parent.state}${parent.inputNeeded ? '!' : ''}]`)
        : `↑ Parent: unavailable #${current.parentId.slice(0, 8)}`;
    const children = accessible.filter(view => view.parentId === id), count = children.length;
    const childPrefix = `↓ Children (${count}): `;
    let childRow = childPrefix + (count ? `+${count} more` : 'none');
    for (let shown = Math.min(3, count); shown > 0; shown--) {
        const suffix = count > shown ? ` · +${count - shown} more` : '';
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
    private readonly input = new Input({ prompt: 'Search: ', placeholder: 'name, ID or project' });
    private readonly hint = new Text('', 0, 0);
    private readonly path = new Text('', 0, 0);
    private selectedSummary = '';
    private readonly detail = { invalidate() { }, render: (width: number) => [truncateToWidth(this.selectedSummary, Math.max(1, width), '…')] };
    private list!: SelectList;
    private readonly collapsed = new Set<string>();
    private readonly byId: Map<string, Conversation>;
    private rows: SelectItem[] = [];
    private readonly current: Conversation | undefined;
    private summaries: ReadonlyMap<string, string> = new Map();
    get focused(): boolean { return this.input.focused; }
    set focused(value: boolean) { this.input.focused = value; }
    constructor(private readonly roster: readonly Conversation[], private readonly currentId: string, private readonly maxVisible: number, private readonly choose: (id: string) => void, private readonly cancel: () => void, title = 'Conversations', initialFocusId = currentId, private readonly contextHint = 'Search retains ancestors; all shown rows can be opened.') {
        super();
        this.byId = new Map(roster.map(view => [view.conversationId, view]));
        this.current = this.byId.get(currentId);
        this.addChild(new Text(title, 0, 0));
        this.addChild(this.input);
        this.rebuild(initialFocusId);
    }
    /** Refresh state descriptions without changing the user's search, branch or selection. */
    updateSummaries(summaries: ReadonlyMap<string, string>): void {
        if (this.roster.every(view => this.summaries.get(view.conversationId) === summaries.get(view.conversationId))) return;
        this.summaries = summaries;
        this.rebuild(this.list.getSelectedItem()?.value);
    }
    private rebuild(preferred?: string): void {
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
                const relation = view.conversationId === this.currentId ? 'CURRENT ' : view.conversationId === this.current?.parentId ? 'PARENT ' : view.parentId === this.currentId ? 'CHILD ' : '';
                rows.push({ value: view.conversationId, label: `${'  '.repeat(Math.min(depth, 12))}${marker} ${relation}${view.label} #${view.conversationId.slice(0, 8)}`,
                    description: `${this.summaries.get(view.conversationId) ?? view.state + (view.inputNeeded ? ' · INPUT NEEDED' : '')} · ${view.projectId ?? 'no project'}` });
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
        const focus = query ? (matches.has(preferred ?? '') ? preferred : this.rows.find(row => matches.has(row.value))?.value) : preferred;
        this.list.setSelectedIndex(Math.max(0, this.rows.findIndex(row => row.value === focus)));
        this.list.onSelect = item => this.choose(item.value);
        this.list.onCancel = this.cancel;
        this.list.onSelectionChange = () => this.updatePath();
        this.addChild(this.list);
        this.addChild(this.path);
        this.addChild(this.detail);
        this.addChild(this.hint);
        this.hint.setText('Up/Down select · Enter open · Esc cancel · empty search: Left/Right collapse/expand\n' + this.contextHint);
        this.updatePath();
    }
    private updatePath(): void {
        const item = this.list.getSelectedItem();
        this.selectedSummary = item?.description ?? '';
        this.path.setText(item ? conversationPath(this.roster, item.value) : 'No matching conversations. Clear the search to show all.');
    }
    handleInput(data: string): void {
        const keys = getKeybindings(), id = this.list.getSelectedItem()?.value;
        if (keys.matches(data, 'tui.select.cancel')) {
            this.cancel();
            return;
        }
        if ((['tui.select.up', 'tui.select.down', 'tui.select.pageUp', 'tui.select.pageDown', 'tui.select.confirm'] as const).some(key => keys.matches(data, key))) {
            this.list.handleInput(data);
            return;
        }
        if (!this.input.getValue() && id && matchesKey(data, 'left')) {
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
        if (this.input.getValue() !== before)
            this.rebuild(id);
    }
}

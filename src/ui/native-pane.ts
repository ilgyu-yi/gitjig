import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import type { CustomEditor, AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { Container, ScrollView, VStack, Text, type TUI } from '@earendil-works/pi-tui';
import { nativeMessageGroups } from './native-messages.js';
import { ConversationActivity } from './conversation-activity.js';
/** Qualified against Pi 1.3.0: the host owns the active-pane flag.
 * Keep the original ScrollView identity for native search and scroll anchors. */
class PaneScrollView extends ScrollView {
    override primary = true;
    afterNextLayout: (() => void) | undefined;
    override updateLayout(...args: Parameters<ScrollView['updateLayout']>): void {
        super.updateLayout(...args);
        const restore = this.afterNextLayout;
        this.afterNextLayout = undefined;
        restore?.();
    }
}
/** Disposable view cache over the actual native session/history, never its owner. */
export class NativePane {
    readonly editor: CustomEditor;
    readonly body = new Container();
    readonly scroll: PaneScrollView;
    readonly status = new Text('', 0, 0);
    readonly goalStatus = new Text('', 0, 0);
    readonly activity: ConversationActivity;
    readonly layout: VStack;
    private session: AgentSession | undefined;
    private unsubscribe: (() => void) | undefined;
    private expanded = false;
    private hideThinking = false;
    private pendingPresentationAnchor: ReturnType<NativePane['scrollAnchor']> | undefined;
    private renderedGroups: Container[] = [];
    private entryIds: (string | null)[] = [];
    private history: Pick<SessionManager, 'buildSessionProjection' | 'getCwd' | 'getBranch'> | undefined;
    constructor(readonly conversationId: string, private readonly tui: TUI, createEditor: (tui: TUI) => CustomEditor) {
        this.editor = createEditor(tui);
        this.activity = new ConversationActivity(() => tui.requestRender());
        this.scroll = new PaneScrollView(this.body, { follow: 'end', overscroll: 'contain' });
        this.layout = new VStack([{ component: this.status, basis: 'auto', shrink: 0 }, { component: this.goalStatus, basis: 'auto', shrink: 0 }, { component: new DynamicBorder(), basis: 'auto', shrink: 0 }, { component: this.scroll, basis: 0, grow: 1, minSize: 1 }, { component: this.activity, basis: 'auto', shrink: 0 }, { component: this.editor, basis: 'auto', shrink: 0 }]);
        this.editor.onAction('app.tools.expand', () => { this.expanded = !this.expanded; this.refresh(); });
    }
    setActive(active: boolean): void { this.scroll.primary = active; }
    setPresentation(options: {
        hideThinking: boolean;
        padding: number;
        autocomplete: number;
        scrollbar: 'hidden' | 'auto' | 'always';
    }, width: number | (() => number)): void {
        const currentWidth = () => typeof width === 'function' ? width() : width;
        const anchor = this.pendingPresentationAnchor ?? this.scrollAnchor(currentWidth());
        this.pendingPresentationAnchor = anchor;
        this.editor.setPaddingX(options.padding);
        this.editor.setAutocompleteMaxVisible(options.autocomplete);
        this.scroll.setScrollbar(options.scrollbar);
        if (this.hideThinking !== options.hideThinking) {
            this.hideThinking = options.hideThinking;
            this.refresh();
        }
        this.scroll.afterNextLayout = () => { this.pendingPresentationAnchor = undefined; this.resolveScroll(anchor.entryId, anchor.offset, anchor.followEnd, currentWidth()); };
        this.tui.requestRender();
    }
    attach(session: AgentSession, history: SessionManager): void {
        if (this.session === session)
            return;
        this.unsubscribe?.();
        this.session = session;
        this.history = history;
        this.unsubscribe = session.subscribe(event => { this.activity.observe(event); this.refresh(); });
        this.refresh();
    }
    setHistory(history: Pick<SessionManager, 'buildSessionProjection' | 'getCwd' | 'getBranch'> | undefined): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.session = undefined;
        this.history = history;
        this.refresh();
    }
    refresh(): void {
        const messages = this.session ? [...this.session.messages] : this.history?.buildSessionProjection().messages ?? [];
        const streaming = this.session?.agent.state.streamingMessage;
        if (streaming)
            messages.push(streaming);
        const rendered = nativeMessageGroups(messages, this.tui, this.history?.getCwd() ?? '', this.expanded, this.hideThinking);
        this.renderedGroups = rendered.groups;
        this.entryIds = this.history?.buildSessionProjection().entries.flatMap(entry => entry.messages.map(() => entry.sourceEntry.id)) ?? [];
        this.body.clear();
        this.body.addChild(rendered.content);
        this.tui.requestRender();
    }
    /** Entry anchors resolve against actual native active-branch IDs at this width. */
    resolveScroll(entryId: string | null, offset: number, followEnd: boolean, width: number): void {
        width = this.scroll.getContentWidth(width);
        if (followEnd) {
            this.scroll.scrollToEnd();
            return;
        }
        let before = 0, found = false, targetHeight = 0;
        for (let i = 0; i < this.renderedGroups.length; i++) {
            if (this.entryIds[i] === entryId) {
                found = true;
                targetHeight = this.renderedGroups[i]!.render(width).length;
                break;
            }
            before += this.renderedGroups[i]!.render(width).length;
        }
        this.scroll.scrollTo((found ? before : 0) + (found ? Math.min(Math.max(0, targetHeight - 1), Math.max(0, offset)) : Math.max(0, offset)), { disableFollow: true });
    }
    /** Store an actual native entry ID and a rendered relative offset, not screen coordinates. */
    scrollAnchor(width: number): {
        entryId: string | null;
        offset: number;
        followEnd: boolean;
    } {
        width = this.scroll.getContentWidth(width);
        let before = 0, lastId: string | null = null;
        for (let i = 0; i < this.renderedGroups.length; i++) {
            const height = this.renderedGroups[i]!.render(width).length;
            const entryId = this.entryIds[i] ?? null;
            if (before + height > this.scroll.scrollTop)
                return { entryId, offset: Math.max(0, this.scroll.scrollTop - before), followEnd: this.scroll.isFollowingEnd };
            before += height;
            lastId = entryId ?? lastId;
        }
        return { entryId: lastId, offset: 0, followEnd: this.scroll.isFollowingEnd };
    }
    detach(): void { this.unsubscribe?.(); this.unsubscribe = undefined; this.session = undefined; }
    dispose(): void { this.activity.dispose(); this.detach(); this.history = undefined; this.renderedGroups = []; this.entryIds = []; this.body.clear(); }
}

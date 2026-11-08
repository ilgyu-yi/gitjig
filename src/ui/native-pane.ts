import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import type { CustomEditor, AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { Container, VStack, Text, type TUI } from '@earendil-works/pi-tui';
import { LayoutScrollView } from './layout-scroll-view.js';
import { nativeMessageGroups } from './native-messages.js';
import { ConversationActivity } from './conversation-activity.js';
import type { NativeInputPresentation } from '../controller/captured-input-presentation.js';
import { coordinationNoticeType, type inspectCoordinationNoticePresentation } from '../controller/conversation-results.js';
import { uiText, type UiLocale } from './i18n.js';
import { plainTerminalText } from './chrome.js';
type NativeHistory = Pick<SessionManager, 'buildSessionProjection' | 'getCwd' | 'getBranch' | 'getSessionId'>;
type UserMessage = Extract<AgentSession['messages'][number], { role: 'user' }>;
type CustomMessage = Extract<AgentSession['messages'][number], { role: 'custom' }>;
type NoticePresentation = ReturnType<typeof inspectCoordinationNoticePresentation>;
type NoticeView = {content: string; noticeId: unknown; eventKey: unknown; summary: NoticePresentation};
type ScrollAnchor = { entryId: string | null; offset: number; followEnd: boolean };
const timelineNotice = {
    'result-ready': 'notice.timelineResult',
    'parent-changed': 'notice.timelineParent',
    'owner-direction-changed': 'notice.timelineDirection',
} as const;
/** Disposable view cache over the actual native session/history, never its owner. */
export class NativePane {
    readonly editor: CustomEditor;
    readonly body = new Container();
    readonly scroll: LayoutScrollView;
    readonly status = new Text('', 0, 0);
    readonly recordedResultStatus = new Text('', 0, 0);
    readonly activity: ConversationActivity;
    readonly layout: VStack;
    private session: AgentSession | undefined;
    private unsubscribe: (() => void) | undefined;
    private expanded = false;
    private hideThinking = false;
    private pendingScroll: ScrollAnchor | undefined;
    private renderedGroups: Container[] = [];
    private entryIds: (string | null)[] = [];
    private history: NativeHistory | undefined;
    private inputViews = new WeakMap<object, {nativeText: string | undefined; view: NativeInputPresentation | undefined}>();
    private noticeViews = new WeakMap<CustomMessage, NoticeView>();
    private locale: UiLocale = 'en';
    constructor(readonly conversationId: string, private readonly tui: TUI, createEditor: (tui: TUI) => CustomEditor,
        private readonly nativeInput?: (sessionId: string, entryId: string, nativeText: string) => NativeInputPresentation | undefined,
        private readonly coordinationNotice?: (details: unknown, content: unknown) => NoticePresentation,
        private readonly activityChanged?: (session: AgentSession) => void) {
        this.editor = createEditor(tui);
        this.activity = new ConversationActivity(() => tui.requestRender());
        this.scroll = new LayoutScrollView(this.body, { follow: 'end', overscroll: 'contain' });
        this.scroll.beforeGeometryChange = () => {
            if (!this.pendingScroll)
                this.restoreScroll(this.scrollAnchor());
        };
        this.layout = new VStack([{ component: this.status, basis: 'auto', shrink: 0 }, { component: this.recordedResultStatus, basis: 'auto', shrink: 0 }, { component: new DynamicBorder(), basis: 'auto', shrink: 0 }, { component: this.scroll, basis: 0, grow: 1, minSize: 1 }, { component: this.activity, basis: 'auto', shrink: 0 }, { component: this.editor, basis: 'auto', shrink: 0 }]);
        this.editor.onAction('app.tools.expand', () => { this.expanded = !this.expanded; this.refresh(); });
    }
    setActive(active: boolean): void { this.scroll.primary = active; }
    setLocale(locale: UiLocale): void {
        if (this.locale === locale) return;
        this.locale = locale;
        this.refresh();
    }
    setPresentation(options: {
        hideThinking: boolean;
        padding: number;
        autocomplete: number;
        scrollbar: 'hidden' | 'auto' | 'always';
    }): void {
        this.restoreScroll(this.scrollAnchor());
        this.editor.setPaddingX(options.padding);
        this.editor.setAutocompleteMaxVisible(options.autocomplete);
        this.scroll.setScrollbar(options.scrollbar);
        if (this.hideThinking !== options.hideThinking) {
            this.hideThinking = options.hideThinking;
            this.refresh();
        }
        this.tui.requestRender();
    }
    attach(session: AgentSession, history: SessionManager, runId?: string, requestOwner?: object): void {
        if (runId) this.activity.bindRun(runId, requestOwner);
        if (this.session === session)
            return;
        this.unsubscribe?.();
        this.session = session;
        this.inputViews = new WeakMap();
        this.noticeViews = new WeakMap();
        this.history = history;
        this.unsubscribe = session.subscribe(event => {
            if (this.activity.observe(event))
                this.activityChanged?.(session);
            if (event.type === 'message_end' && event.message.role === 'user') {
                queueMicrotask(() => { if (this.session === session) this.refresh(); });
            }
            else if (event.type !== 'message_start' || event.message.role !== 'user') this.refresh();
        });
        this.refresh();
    }
    setHistory(history: NativeHistory | undefined): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.session = undefined;
        this.inputViews = new WeakMap();
        this.noticeViews = new WeakMap();
        this.history = history;
        this.refresh();
    }
    refresh(): void {
        const projection = this.history?.buildSessionProjection();
        const messages = this.session ? [...this.session.messages] : projection?.messages ?? [];
        const streaming = this.session?.agent.state.streamingMessage;
        if (streaming)
            messages.push(streaming);
        const inputs = new Map<UserMessage, string | {hostText: string}>();
        if (this.nativeInput && this.history && projection) {
            const sessionId = this.history.getSessionId(), seen = new Set<UserMessage>();
            for (const { sourceEntry, messages: projected } of projection.entries) {
                if (sourceEntry.type !== 'message' || sourceEntry.message.role !== 'user' || projected[0] !== sourceEntry.message)
                    continue;
                const message = sourceEntry.message, content = message.content;
                if (seen.has(message)) {
                    inputs.delete(message);
                    continue;
                }
                seen.add(message);
                const text = typeof content === 'string' ? content : content?.length === 1 && content[0]?.type === 'text' ? content[0].text : undefined;
                let input = this.inputViews.get(sourceEntry);
                if (!input || input.nativeText !== text) {
                    input = {nativeText: text, view: text === undefined ? undefined : this.nativeInput(sessionId, sourceEntry.id, text)};
                    this.inputViews.set(sourceEntry, input);
                }
                const view = input.view;
                if (!view) continue;
                if ('fileCount' in view) inputs.set(message, view.text + '\n' + uiText(this.locale, 'pane.capturedFiles', {count: view.fileCount}));
                else inputs.set(message, {hostText: view.kind === 'goal-start'
                    ? uiText(this.locale, 'pane.goalStarted', {objective: plainTerminalText(view.objective)})
                    : uiText(this.locale, 'pane.waitResumed')});
            }
        }
        const rendered = nativeMessageGroups(messages, this.tui, this.history?.getCwd() ?? '', this.expanded, this.hideThinking,
            message => inputs.get(message), message => {
                if (!this.coordinationNotice || message.customType !== coordinationNoticeType || typeof message.content !== 'string')
                    return;
                const {noticeId, eventKey} = (message.details ?? {}) as Record<string, unknown>;
                let cached = this.noticeViews.get(message);
                if (!cached || cached.content !== message.content || cached.noticeId !== noticeId || cached.eventKey !== eventKey) {
                    cached = {content: message.content, noticeId, eventKey, summary: this.coordinationNotice(message.details, message.content)};
                    this.noticeViews.set(message, cached);
                }
                const notice = cached.summary;
                return notice ? uiText(this.locale, timelineNotice[notice.kind], {id: notice.id.slice(-6)}) : undefined;
            }, uiText(this.locale, 'pane.modelResponse'));
        this.renderedGroups = rendered.groups;
        this.entryIds = projection?.entries.flatMap(entry => entry.messages.map(() => entry.sourceEntry.id)) ?? [];
        this.body.clear();
        this.body.addChild(rendered.content);
        this.tui.requestRender();
    }
    /** Keep the anchor while hidden and apply it after Pi measures this pane. */
    restoreScroll(anchor: ScrollAnchor): void {
        this.pendingScroll = anchor;
        this.scroll.afterNextLayout = () => {
            const width = this.scroll.contentWidth;
            if (width === undefined)
                return;
            this.pendingScroll = undefined;
            this.resolveScroll(anchor, width);
        };
    }
    private resolveScroll({ entryId, offset, followEnd }: ScrollAnchor, width: number): void {
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
    scrollAnchor(): ScrollAnchor {
        if (this.pendingScroll)
            return this.pendingScroll;
        const width = this.scroll.contentWidth;
        if (width === undefined)
            return { entryId: null, offset: 0, followEnd: this.scroll.isFollowingEnd };
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

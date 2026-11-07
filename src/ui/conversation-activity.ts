import { submitKeyLabel } from './native-editor.js';
import type { ConversationStage } from '../controller/conversation-progress.js';
import { uiText, type UiLocale } from './i18n.js';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import type { ConversationResourceState, ConversationTurnResult } from '../controller/interaction-types.js';
import { chrome } from './chrome.js';
/** UI settlement only; a clean response does not establish task completion. */
export function hasCleanCleanup(cleanup: string): boolean {
    return ['removed', 'not-allocated', 'unbound'].includes(cleanup);
}
export function responseOutcome(result: Pick<ConversationTurnResult, 'status' | 'cleanup'>, locale: UiLocale = 'en'): string {
    if (!hasCleanCleanup(result.cleanup))
        return uiText(locale, 'response.cleanup', { cleanup: result.cleanup });
    return uiText(locale, `response.${result.status}`);
}
export function shellOutcome(result: unknown): {
    message: string;
    completed: boolean;
} {
    if (!result || typeof result !== 'object' || !('status' in result) || !('cleanup' in result) ||
        typeof result.status !== 'string' || typeof result.cleanup !== 'string' ||
        !['delivered', 'interrupted', 'cancelled', 'waiting', 'unavailable'].includes(result.status))
        return { message: 'Shell outcome unavailable · inspect error details', completed: false };
    const clean = hasCleanCleanup(result.cleanup);
    return { completed: result.status === 'delivered' && clean,
        message: !clean ? `Shell command needs attention · cleanup: ${result.cleanup}` : result.status === 'delivered' ?
            'Shell command finished · inspect its output' : `Shell command ${result.status} · draft kept` };
}
export function preparationLabel(locale: UiLocale, stage: ConversationStage): string {
    return uiText(locale, `activity.stage.${stage}`);
}
interface ActivityOptions {
    stage?: ConversationStage | undefined;
    locale?: UiLocale;
    preparing?: boolean;
    cancelling?: boolean;
    cancellingSend?: boolean;
    interruptible?: boolean;
    setupNeeded?: boolean;
    setupHandoff?: boolean;
    context?: string | null;
    operation?: string | null;
    outcome?: string | null;
    pending?: boolean;
    inputNeeded?: boolean;
    error?: boolean;
}
/** Ephemeral feedback only; the controller and native session own execution. */
export class ConversationActivity extends Text {
    private state: ConversationResourceState = 'IDLE';
    private options: ActivityOptions = {};
    private phase: 'response' | 'thinking' | 'writing' | 'toolcall' | 'tool' | 'compact' | 'retry' = 'response';
    get hasNativeActivity(): boolean { return this.state === 'RUNNING' && this.phase !== 'response'; }
    private toolName = '';
    private retry = { attempt: 0, max: 0 };
    private get locale(): UiLocale { return this.options.locale ?? 'en'; }
    private phaseLabel(): string {
        if (this.phase === 'tool')
            return uiText(this.locale, 'activity.tool', { name: this.toolName });
        if (this.phase === 'retry')
            return uiText(this.locale, 'activity.retry', this.retry);
        return uiText(this.locale, `activity.${this.phase}`);
    }
    private started = performance.now();
    private lastOutput = this.started;
    private timer: ReturnType<typeof setInterval> | undefined;
    constructor(private readonly redraw: () => void) { super('', 0, 0); }
    update(state: ConversationResourceState, options: ActivityOptions = {}): void {
        const wasActive = this.active;
        if (state === 'RUNNING' && this.state !== 'RUNNING')
            this.phase = 'response';
        this.state = state;
        this.options = options;
        if (this.active && !wasActive)
            this.started = this.lastOutput = performance.now();
        if (this.active && !this.timer)
            this.timer = setInterval(() => this.redraw(), 1000);
        if (!this.active)
            this.stop();
    }
    private get active(): boolean { return this.state !== 'UNKNOWN' && (!!this.options.preparing || !!this.options.operation || ['QUEUED', 'RUNNING', 'SETTLING'].includes(this.state)); }
    observe(event: AgentSessionEvent): void {
        if (event.type === 'turn_start') {
            this.phase = 'response';
            this.lastOutput = performance.now();
        }
        if (event.type === 'message_update') {
            const type = event.assistantMessageEvent.type;
            if (type === 'thinking_delta')
                this.phase = 'thinking';
            if (type === 'text_delta')
                this.phase = 'writing';
            if (type === 'toolcall_delta')
                this.phase = 'toolcall';
            this.lastOutput = performance.now();
        }
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
            this.phase = 'tool';
            this.toolName = event.toolName;
            this.lastOutput = performance.now();
        }
        if (event.type === 'tool_execution_end' || event.type === 'compaction_end' || event.type === 'auto_retry_end') {
            this.phase = 'response';
            this.lastOutput = performance.now();
        }
        if (event.type === 'compaction_start')
            this.phase = 'compact';
        if (event.type === 'auto_retry_start') {
            this.phase = 'retry';
            this.retry = { attempt: event.attempt, max: event.maxAttempts };
        }
        ;
    }
    private statusLabel(): string {
        if (this.state === 'UNKNOWN')
            return uiText(this.locale, 'activity.unknown');
        if (this.options.cancelling)
            return uiText(this.locale, 'activity.cancelling');
        if (this.options.cancellingSend && this.state !== 'RUNNING')
            return uiText(this.locale, 'input.cancelling');
        if (this.options.operation != null)
            return this.options.operation;
        if (this.state === 'SETTLING')
            return uiText(this.locale, 'activity.settling');
        if (this.state === 'RUNNING' && this.phase !== 'response')
            return this.phaseLabel();
        if (this.options.stage && ['QUEUED', 'RUNNING'].includes(this.state))
            return preparationLabel(this.locale, this.options.stage);
        if (this.options.preparing)
            return uiText(this.locale, 'activity.preparing');
        switch (this.state) {
            case 'IDLE':
                if (this.options.inputNeeded)
                    return uiText(this.locale, 'activity.inputNeeded');
                if (this.options.error)
                    return uiText(this.locale, 'activity.error');
                if (this.options.pending)
                    return uiText(this.locale, 'activity.retained');
                if (this.options.context)
                    return this.options.context;
                if (this.options.setupNeeded)
                    return uiText(this.locale, this.options.setupHandoff ? 'activity.setup' : 'activity.setupBlocked');
                return this.options.outcome ?? uiText(this.locale, 'activity.ready', { submit: submitKeyLabel() });
            case 'QUEUED': return uiText(this.locale, 'activity.queued');
            case 'RUNNING': return this.phaseLabel();
            case 'WAITING': return uiText(this.locale, 'activity.waiting');
            case 'ARCHIVED': return uiText(this.locale, 'activity.archived');
        }
    }
    override render(width: number): string[] {
        const now = performance.now(), elapsed = Math.floor((now - this.started) / 1000);
        const silence = Math.floor((now - this.lastOutput) / 1000);
        const label = this.statusLabel();
        const busy = this.active;
        const text = busy ? `${['◐', '◓', '◑', '◒'][elapsed % 4]} ${uiText(this.locale, 'activity.elapsed', { label, seconds: elapsed })}${silence >= 15 && (!this.options.stage || this.options.stage === 'model') ? uiText(this.locale, 'activity.silence', { seconds: silence }) : ''}${!this.options.cancelling && (this.state === 'RUNNING' || this.options.interruptible) ? uiText(this.locale, 'activity.interrupt') : ''}` : label;
        this.setText(truncateToWidth(chrome(busy ? 'active' : this.state === 'UNKNOWN' || this.state === 'WAITING' ? 'attention' : 'secondary', text.replace(/[\r\n]/gu, ' ')), width, '…'));
        return super.render(width);
    }
    private stop(): void {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
    }
    dispose(): void { this.stop(); }
}

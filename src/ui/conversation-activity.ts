import { submitKeyLabel } from './native-editor.js';
import type { ConversationStage } from '../controller/conversation-progress.js';
import { uiText, type UiLocale } from './i18n.js';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { ConversationResourceState, ConversationTurnResult } from '../controller/interaction-types.js';
import { chrome, plainTerminalText } from './chrome.js';
import type { NativeProviderActivity } from '../pi/native-provider-activity.js';
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
export type RequestPreparationStatus = 'activity.preparing' | 'activity.queued' | 'activity.finishing' |
    `input.stage.${'source' | 'model' | 'context' | 'received' | 'routing'}`;
const compactLabels = {
    'activity.preparing': 'activity.preparing',
    'activity.queued': 'activity.short.queued',
    'activity.finishing': 'activity.finishing',
    'activity.settling': 'activity.short.settling',
    'activity.stage.capacity': 'activity.short.capacity',
    'activity.stage.starting': 'activity.stage.starting',
    'activity.stage.capture': 'activity.short.capture',
    'activity.stage.runtime': 'activity.short.runtime',
    'activity.stage.session': 'activity.short.session',
    'activity.stage.dispatch': 'activity.short.dispatch',
    'activity.stage.model': 'activity.short.model',
    'input.stage.source': 'input.stage.source',
    'input.stage.model': 'input.stage.model',
    'input.stage.context': 'activity.short.context',
    'input.stage.received': 'input.stage.received',
    'input.stage.routing': 'activity.short.routing',
} as const;
function activityLabel(locale: UiLocale, id: keyof typeof compactLabels, compact: boolean): string {
    return uiText(locale, compact ? compactLabels[id] : id);
}
export function preparationLabel(locale: UiLocale, stage: ConversationStage, compact = false): string {
    return activityLabel(locale, stage === 'accepted' ? 'activity.queued' : `activity.stage.${stage}`, compact);
}
export function providerActivityLabel(locale: UiLocale, activity?: NativeProviderActivity): string | undefined {
    if (activity?.kind === 'retry')
        return uiText(locale, 'activity.providerRetry', { attempt: activity.attempt, max: activity.maxAttempts });
    if (activity?.kind !== 'rate-limit') return;
    if (activity.resetsAt === undefined) return uiText(locale, 'activity.providerLimit');
    const reset = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(activity.resetsAt * 1000));
    return uiText(locale, 'activity.providerLimitReset', { reset });
}
interface ActivityOptions {
    providerActivity?: NativeProviderActivity | undefined;
    runId?: string | undefined;
    requestOwner?: object | undefined;
    preparationOwner?: object | undefined;
    stage?: ConversationStage | undefined;
    locale?: UiLocale;
    preparing?: boolean;
    preparingStatus?: RequestPreparationStatus | undefined;
    cancelling?: boolean;
    cancellationLabel?: string | undefined;
    cancellingSend?: string | undefined;
    showResponseInterrupt?: boolean;
    editorKeyOwner?: () => 'completion' | 'composer' | undefined;
    setupNeeded?: boolean;
    setupHandoff?: boolean;
    context?: string | null;
    operation?: string | null;
    outcome?: Pick<ConversationTurnResult, 'status' | 'cleanup'> | undefined;
    pending?: boolean;
    inputNeeded?: boolean;
    error?: string | undefined;
    waitingStatus?: string | undefined;
    waitAttention?: boolean | undefined;
}
/** Ephemeral feedback only; the controller and native session own execution. */
export class ConversationActivity extends Text {
    private state: ConversationResourceState = 'IDLE';
    private options: ActivityOptions = {};
    private phase: 'response' | 'thinking' | 'writing' | 'toolcall' | 'tool' | 'compact' | 'retry' = 'response';
    private toolName = '';
    private retry = { attempt: 0, max: 0 };
    private get locale(): UiLocale { return this.options.locale ?? 'en'; }
    private phaseLabel(locale = this.locale): string {
        if (this.phase === 'tool')
            return uiText(locale, 'activity.tool', { name: this.toolName });
        if (this.phase === 'retry')
            return uiText(locale, 'activity.retry', this.retry);
        return uiText(locale, `activity.${this.phase}`);
    }
    /** Navigator observation for the identified run, independent of the last pane render. */
    observedPhaseLabel(runId: string, locale: UiLocale): string | undefined {
        if (this.runId === runId && this.phase !== 'response')
            return this.phaseLabel(locale);
    }
    private runId: string | undefined;
    private requestClock: { owner: object; started: number; runId?: string } | undefined;
    private preparation: { owner: object; started: number } | undefined;
    /** Record a new send without changing an earlier response still on screen. */
    beginPreparation(owner: object): void {
        if (this.preparation?.owner !== owner)
            this.preparation = { owner, started: performance.now() };
    }
    /** Retain an acknowledged send's clock while its native run is starting. */
    bindPreparation(owner: object): void {
        if (this.preparation?.owner !== owner) return;
        this.started = this.preparation.started;
        this.requestClock = { owner, started: this.preparation.started };
        this.preparation = undefined;
    }
    hasBoundRequest(owner: object): boolean {
        return this.requestClock?.owner === owner && this.requestClock.runId !== undefined;
    }
    /** Bind before native events; absent observations never erase a known owner. */
    bindRun(runId: string, requestOwner?: object): void {
        if (this.runId === runId) return;
        const preparation = requestOwner && this.preparation?.owner === requestOwner ? this.preparation : undefined;
        const sameClock = requestOwner !== undefined && this.requestClock?.owner === requestOwner && this.requestClock.runId === undefined;
        if (preparation) this.bindPreparation(preparation.owner);
        else if (sameClock) this.started = this.requestClock!.started;
        else if (!sameClock && (this.runId || this.preparation || this.requestClock || !this.active)) {
            this.started = performance.now();
            this.requestClock = undefined;
        }
        this.phase = 'response';
        this.lastOutput = undefined;
        this.runId = runId;
        if (this.requestClock) this.requestClock.runId = runId;
    }
    private started = performance.now();
    // Local preparation counts toward elapsed time, but no native output is expected yet.
    private lastOutput: number | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;
    constructor(private readonly redraw: () => void) { super('', 0, 0); }
    update(state: ConversationResourceState, options: ActivityOptions = {}): void {
        const wasActive = this.active;
        if (state === 'RUNNING' && this.state !== 'RUNNING' && !this.runId && !options.runId)
            this.phase = 'response';
        this.state = state;
        this.options = options;
        if (this.active && !wasActive && !this.runId && !this.requestClock)
            this.started = performance.now();
        if (options.runId) this.bindRun(options.runId, options.requestOwner);
        if (state === 'RUNNING' && options.stage === 'model')
            this.lastOutput ??= performance.now();
        if (this.state === 'IDLE' && options.preparing && options.operation == null && this.preparation &&
            this.preparation.owner === options.preparationOwner &&
            this.started !== this.preparation.started) {
            this.started = this.preparation.started;
        }
        if (this.active && !this.timer)
            this.timer = setInterval(() => this.redraw(), 1000);
        if (!this.active) {
            this.stop();
            this.runId = undefined;
            this.lastOutput = undefined;
            this.requestClock = undefined;
            this.preparation = undefined;
        }
    }
    private get active(): boolean { return this.state !== 'UNKNOWN' && (!!this.options.preparing || !!this.options.operation || ['QUEUED', 'RUNNING', 'SETTLING'].includes(this.state)); }
    observe(event: AgentSessionEvent): boolean {
        const { phase, toolName, retry } = this;
        if (event.type === 'turn_start') {
            this.phase = 'response';
            if (this.lastOutput !== undefined)
                this.lastOutput = performance.now();
        }
        if (event.type === 'message_update') {
            const type = event.assistantMessageEvent.type;
            if (type === 'thinking_start' || type === 'thinking_delta')
                this.phase = 'thinking';
            if (type === 'text_start' || type === 'text_delta')
                this.phase = 'writing';
            if (type === 'toolcall_start' || type === 'toolcall_delta')
                this.phase = 'toolcall';
            this.lastOutput = performance.now();
        }
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
            this.phase = 'tool';
            this.toolName = plainTerminalText(event.toolName).replace(/\n/gu, ' ');
            this.lastOutput = performance.now();
        }
        if (event.type === 'tool_execution_end' || event.type === 'compaction_end' || event.type === 'auto_retry_end') {
            this.phase = 'response';
            if (event.type === 'tool_execution_end' || this.lastOutput !== undefined)
                this.lastOutput = performance.now();
        }
        if (event.type === 'compaction_start')
            this.phase = 'compact';
        if (event.type === 'auto_retry_start') {
            this.phase = 'retry';
            this.retry = { attempt: event.attempt, max: event.maxAttempts };
        }
        return phase !== this.phase || toolName !== this.toolName ||
            retry.attempt !== this.retry.attempt || retry.max !== this.retry.max;
    }
    statusLabel(compact = false): string {
        if (this.state === 'UNKNOWN')
            return uiText(this.locale, 'activity.unknown');
        if (this.options.cancelling)
            return this.options.cancellationLabel ?? uiText(this.locale, 'activity.cancelling');
        if (this.options.cancellingSend && this.state !== 'RUNNING')
            return this.options.cancellingSend;
        const reported = this.state === 'RUNNING' ? providerActivityLabel(this.locale, this.options.providerActivity) : undefined;
        if (this.options.operation != null)
            return reported ? this.options.operation + ' · ' + reported : this.options.operation;
        if (this.state === 'SETTLING')
            return activityLabel(this.locale, 'activity.settling', compact);
        if (reported) return reported;
        if (this.state === 'RUNNING' && this.phase !== 'response')
            return this.phaseLabel();
        if (this.options.stage && ['QUEUED', 'RUNNING'].includes(this.state))
            return preparationLabel(this.locale, this.options.stage, compact);
        if (this.options.preparing)
            return activityLabel(this.locale, this.options.preparingStatus ?? 'activity.preparing', compact);
        switch (this.state) {
            case 'IDLE': {
                if (this.options.inputNeeded)
                    return uiText(this.locale, 'activity.inputNeeded');
                if (this.options.error)
                    return this.options.error;
                const outcome = this.options.outcome;
                if (this.options.pending) {
                    if (outcome && hasCleanCleanup(outcome.cleanup) && (outcome.status === 'interrupted' || outcome.status === 'cancelled'))
                        return uiText(this.locale, 'activity.stoppedWithRetained', { outcome: responseOutcome(outcome, this.locale) });
                    return uiText(this.locale, 'activity.retained');
                }
                if (this.options.context)
                    return this.options.context;
                if (this.options.setupNeeded)
                    return this.options.setupHandoff && this.options.editorKeyOwner?.() !== 'completion'
                        ? uiText(this.locale, 'activity.setup', { submit: submitKeyLabel() })
                        : uiText(this.locale, 'activity.setupBlocked');
                return outcome ? responseOutcome(outcome, this.locale) : (this.options.editorKeyOwner?.() === 'completion'
                    ? uiText(this.locale, 'activity.readyWithoutSubmit')
                    : uiText(this.locale, 'activity.ready', { submit: submitKeyLabel() }));
            }
            case 'QUEUED': return activityLabel(this.locale, 'activity.queued', compact);
            case 'RUNNING': return this.phaseLabel();
            case 'WAITING':
                if (this.options.inputNeeded) return uiText(this.locale, 'activity.inputNeeded');
                if (this.options.error) return this.options.error;
                return this.options.waitingStatus ?? uiText(this.locale, 'activity.waiting');
            case 'ARCHIVED': return uiText(this.locale, 'activity.archived');
        }
    }
    statusLabelForWidth(width: number): string {
        const label = this.statusLabel();
        return visibleWidth(label) <= width ? label : this.statusLabel(true);
    }
    override render(width: number): string[] {
        const now = performance.now(), elapsed = Math.floor((now - this.started) / 1000);
        const silence = this.state === 'RUNNING' && !this.options.cancelling && this.options.operation == null && this.lastOutput !== undefined
            ? Math.floor((now - this.lastOutput) / 1000) : 0;
        const label = this.statusLabel().replace(/[\r\n]/gu, ' ');
        const busy = this.active;
        const showInterrupt = busy && !this.options.cancelling && this.options.showResponseInterrupt &&
            (!this.options.editorKeyOwner || this.options.editorKeyOwner() === 'composer');
        const spinner = busy ? `${['◐', '◓', '◑', '◒'][elapsed % 4]} ` : '';
        const timed = (label: string) => busy ? spinner + uiText(this.locale, 'activity.elapsed', { label, seconds: elapsed }) : label;
        const status = timed(label);
        const detail = silence >= 15 ? uiText(this.locale, 'activity.silence', { seconds: silence }) : '';
        const interrupt = showInterrupt ? uiText(this.locale, 'activity.interrupt') : '';
        const fits = (text: string) => visibleWidth(text) <= width;
        let text = status + detail + interrupt;
        if (!fits(text)) {
            const compact = this.statusLabel(true).replace(/[\r\n]/gu, ' ');
            const compactStatus = timed(compact);
            const statusWidth = width - visibleWidth(interrupt);
            // Dynamic tool and provider labels have no short translation. Keep their original shortcut.
            const shortened = compact === label && interrupt && statusWidth > 0
                ? truncateToWidth(status, statusWidth, '…') + interrupt : undefined;
            text = [status + interrupt, compactStatus + interrupt, spinner + compact + interrupt].find(fits) ??
                shortened ?? [compactStatus, spinner + compact].find(fits) ?? compact;
        }
        this.setText(truncateToWidth(chrome(busy ? 'active' : this.state === 'UNKNOWN' || this.state === 'WAITING' && (this.options.waitAttention || this.options.inputNeeded || this.options.error) ? 'attention' : 'secondary', text), width, '…'));
        return super.render(width);
    }
    private stop(): void {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
    }
    dispose(): void { this.stop(); }
}

import { uiText, type UiLocale } from './i18n.js';
import { authBrowserNotifications, type openAuthBrowser } from '../app/auth-browser.js';
import { ExtensionSelectorComponent } from '@earendil-works/pi-coding-agent';
import { Input, Text, matchesKey, stripTerminalSequences, type Component, type Focusable, type TUI } from '@earendil-works/pi-tui';
import type { AuthInteraction, AuthPrompt, AuthEvent } from '@earendil-works/pi-ai';
const cancelled = () => new DOMException('Account prompt cancelled', 'AbortError');
const clean = (value: string) => stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ').slice(0, 4096);
interface Pending {
    component: Component;
    input: Input | undefined;
    masked: boolean;
    label: string;
    finish(value?: string, error?: unknown): void;
}
/** Same-screen original Pi auth interaction. Never a conversation editor or second terminal reader. */
export class AccountDialog implements Component, Focusable {
    private readonly stopping = new AbortController();
    private pending: Pending | undefined;
    private disposed = false;
    private activeFocus = false;
    private messages: string[] = [];
    private authMessages = new Map<string, string>();
    private secrets = new Set<string>();
    private status = 'Waiting for account provider…';
    private readonly externalAbort = () => this.cancel();
    readonly interaction: AuthInteraction;
    private readonly browser: (event: AuthEvent) => void;
    constructor(private readonly tui: TUI, private readonly changed: () => void, private readonly options: {
        locale?: UiLocale;
        forceSecret: boolean;
        onLeave(): void;
        signal?: AbortSignal;
        openBrowser?: typeof openAuthBrowser;
    }) {
        this.status = uiText(options.locale ?? 'en', 'account.waiting');
        this.browser = authBrowserNotifications(this.stopping.signal, () => {
            if (!this.disposed) {
                this.messages = [...this.messages.slice(-3), uiText(this.options.locale ?? 'en', 'account.browser')];
                this.changed();
            }
        }, options.openBrowser);
        this.interaction = { signal: this.stopping.signal, prompt: prompt => this.prompt(prompt), notify: event => this.notify(event) };
        options.signal?.addEventListener('abort', this.externalAbort, { once: true });
        if (options.signal?.aborted)
            this.cancel();
    }
    get signal(): AbortSignal { return this.stopping.signal; }
    get focused(): boolean { return this.activeFocus; }
    set focused(value: boolean) {
        this.activeFocus = value;
        if (this.pending?.input)
            this.pending.input.focused = value;
    }
    private redact(value: string): string {
        let result = value;
        // Match complete literal operands before control removal or truncation.
        // Longer values win when a later prompt extends a previous secret.
        for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
            result = result.replaceAll(secret, '[hidden]');
        return clean(result);
    }
    private notify(event: AuthEvent): void {
        if (this.disposed || this.signal.aborted)
            return;
        const text = event.type === 'auth_url' ? `${event.instructions ?? 'Open this sign-in URL:'} ${event.url}` :
            event.type === 'device_code' ? `Open ${event.verificationUri} · Code: ${event.userCode}` :
                event.type === 'info' ? `${event.message} ${(event.links ?? []).map(link => `${link.label ?? 'Link'}: ${link.url}`).join(' ')}` : event.message;
        // Retain bounded raw text only inside this ephemeral dialog so later
        // known values can still be redacted in full. Never truncate a raw secret.
        const retained = text.length <= 64 * 1024 ? text : 'Account notification exceeds the display limit';
        if (event.type === 'auth_url' || event.type === 'device_code')
            this.authMessages.set(event.type, retained);
        else
            this.messages = [...this.messages.slice(-3), retained];
        this.changed();
        if (!this.options.forceSecret)
            this.browser(event);
    }
    private prompt(prompt: AuthPrompt): Promise<string> {
        if (this.disposed || this.signal.aborted || prompt.signal?.aborted)
            return Promise.reject(cancelled());
        if (this.pending)
            return Promise.reject(new Error('Another account prompt is pending'));
        const signal = prompt.signal ? AbortSignal.any([this.signal, prompt.signal]) : this.signal;
        return new Promise<string>((resolve, reject) => {
            let done = false;
            const abort = () => entry.finish(undefined, cancelled());
            const masked = prompt.type !== 'select' && (this.options.forceSecret || prompt.type === 'secret' || prompt.type === 'manual_code');
            const input = prompt.type === 'select' ? undefined : new Input();
            const entry: Pending = { component: input ?? new Text(''), input, masked,
                label: masked ? (prompt.type === 'manual_code' ? uiText(this.options.locale ?? 'en', 'account.code') : uiText(this.options.locale ?? 'en', 'account.secret')) : clean(prompt.message),
                finish: (value, error) => {
                    if (done)
                        return;
                    done = true;
                    signal.removeEventListener('abort', abort);
                    if (masked && value)
                        this.secrets.add(value);
                    // Drop the entire original Input: setValue alone leaves undo/killring/paste state.
                    if (entry.component instanceof ExtensionSelectorComponent)
                        entry.component.dispose();
                    entry.input = undefined;
                    entry.component = new Text('');
                    if (this.pending === entry)
                        this.pending = undefined;
                    this.status = this.signal.aborted ? 'Cancellation requested; waiting for account storage…' : 'Completing account operation…';
                    this.changed();
                    if (error !== undefined)
                        reject(error);
                    else
                        resolve(value ?? '');
                } };
            if (prompt.type === 'select') {
                const labels = prompt.options.map((option, index) => `${index + 1}. ${clean(option.label)}`);
                entry.component = new ExtensionSelectorComponent(clean(prompt.message), labels, label => {
                    const index = labels.indexOf(label);
                    if (index < 0)
                        entry.finish(undefined, cancelled());
                    else
                        entry.finish(prompt.options[index]!.id);
                }, () => this.cancel(), { tui: this.tui });
            }
            else if (input) {
                input.focused = this.activeFocus;
                input.onSubmit = value => entry.finish(value);
                input.onEscape = () => this.cancel();
            }
            this.pending = entry;
            signal.addEventListener('abort', abort, { once: true });
            // Recheck after listener registration; prompt abort never aborts the operation.
            if (signal.aborted)
                abort();
            this.changed();
        });
    }
    cancel(): void {
        if (this.disposed)
            return;
        this.status = 'Cancellation requested; waiting for account storage…';
        this.stopping.abort();
        this.changed();
    }
    handleInput(data: string): void {
        if (this.disposed)
            return;
        if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
            this.cancel();
            return;
        }
        if (matchesKey(data, 'ctrl+d')) {
            this.cancel();
            this.options.onLeave();
            return;
        }
        this.pending?.component.handleInput?.(data);
        if (this.pending?.input && this.pending.input.getValue().length > 16 * 1024)
            this.pending.finish(undefined, new Error('Account input exceeds 16KiB'));
        this.changed();
    }
    invalidate(): void { this.pending?.component.invalidate(); }
    render(width: number): string[] {
        const lines = new Text(uiText(this.options.locale ?? 'en', 'account.header'), 0, 0).render(width);
        for (const message of [...this.authMessages.values(), ...this.messages])
            lines.push(...new Text(this.redact(message), 0, 0).render(width));
        const pending = this.pending;
        if (!pending)
            return [...lines, ...new Text(this.status, 0, 0).render(width)];
        lines.push(...new Text(pending.label, 0, 0).render(width));
        // Never call original Input.render for sensitive input, including submitted state.
        if (pending.masked)
            lines.push(...new Text('> ' + '•'.repeat(Math.min(64, Array.from(pending.input?.getValue() ?? '').length)), 0, 0).render(width));
        else
            lines.push(...pending.component.render(width));
        return lines;
    }
    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;
        this.stopping.abort();
        this.options.signal?.removeEventListener('abort', this.externalAbort);
        this.pending?.finish(undefined, cancelled());
        this.pending = undefined;
        this.messages = [];
        this.authMessages.clear();
        this.secrets.clear();
    }
}

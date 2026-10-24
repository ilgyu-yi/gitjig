import { ExtensionSelectorComponent, ExtensionInputComponent, ExtensionEditorComponent, type ExtensionUIContext, type ExtensionUIDialogOptions, type CustomEditor } from '@earendil-works/pi-coding-agent';
import { Text, getKeybindings, type Component, type TUI } from '@earendil-works/pi-tui';
type DialogComponent = Component & {
    dispose?(): void;
};
interface Pending {
    id: number;
    component: DialogComponent | undefined;
    finish(value: unknown, error?: unknown): void;
}
/** One conversation's bounded actual native requests; selecting another view never answers it. */
export class NativeDialogs {
    private queue: Pending[] = [];
    private serial = 0;
    private disposed = false;
    constructor(private readonly tui: TUI, private readonly bindings: ConstructorParameters<typeof CustomEditor>[2], private readonly changed: () => void) { }
    get requestIds(): string[] { return this.queue.map(entry => String(entry.id)); }
    get component(): DialogComponent | undefined { return this.queue[0]?.component; }
    private request<T>(build: (done: (value: T | undefined) => void) => DialogComponent | Promise<DialogComponent>, opts?: ExtensionUIDialogOptions): Promise<T | undefined> {
        if (this.disposed)
            return Promise.reject(new Error('Native dialog target released'));
        if (this.queue.length >= 16)
            return Promise.reject(new Error('Native dialog queue exceeds16 requests'));
        if (opts?.signal?.aborted)
            return Promise.resolve(undefined);
        return new Promise<T | undefined>((resolve, reject) => {
            let timer: NodeJS.Timeout | undefined, done = false;
            const abort = () => entry.finish(undefined);
            const entry: Pending = { id: ++this.serial, component: undefined, finish: (value, error) => {
                    if (done)
                        return;
                    done = true;
                    if (timer)
                        clearTimeout(timer);
                    opts?.signal?.removeEventListener('abort', abort);
                    entry.component?.dispose?.();
                    this.queue = this.queue.filter(item => item !== entry);
                    if (error !== undefined)
                        reject(error);
                    else
                        resolve(value as T | undefined);
                    this.changed();
                } };
            const opening = new Text(`Opening dialog… · ${getKeybindings().getKeys('tui.select.cancel').join('/')} cancels`, 0, 0);
            entry.component = {
                render: width => opening.render(width), invalidate: () => opening.invalidate(),
                handleInput: data => {
                    if (getKeybindings().matches(data, 'tui.select.cancel'))
                        entry.finish(undefined);
                },
            };
            this.queue.push(entry);
            this.changed();
            opts?.signal?.addEventListener('abort', abort, { once: true });
            if (opts?.timeout !== undefined) {
                if (!Number.isFinite(opts.timeout) || opts.timeout < 1) {
                    entry.finish(undefined);
                    return;
                }
                timer = setTimeout(abort, Math.min(opts.timeout, 600000));
                timer.unref();
            }
            Promise.resolve().then(() => build(value => entry.finish(value))).then(component => {
                if (done)
                    component.dispose?.();
                else {
                    entry.component = component;
                    this.changed();
                }
            }).catch(error => {
                if (done)
                    return;
                entry.finish(undefined, error);
            });
        });
    }
    context(base: ExtensionUIContext, editor: CustomEditor, notify: (message: string) => void, onTerminalInput: ExtensionUIContext['onTerminalInput']): ExtensionUIContext {
        const unavailable = () => { throw new Error('This fixed native UI profile does not support custom editor/theme/widget replacement'); };
        return { ...base, theme: base.theme,
            select: (title, options, opts) => this.request<string>(done => new ExtensionSelectorComponent(title, options, done, () => done(undefined), { tui: this.tui }), opts),
            confirm: async (title, message, opts) => (await this.request<string>(done => new ExtensionSelectorComponent(`${title}\n${message}`, ['Confirm', 'Cancel'], done, () => done(undefined), { tui: this.tui }), opts)) === 'Confirm',
            input: (title, placeholder, opts) => this.request<string>(done => new ExtensionInputComponent(title, placeholder, done, () => done(undefined), { tui: this.tui }), opts),
            editor: (title, prefill) => this.request<string>(done => new ExtensionEditorComponent(this.tui, this.bindings, title, prefill, done, () => done(undefined))),
            custom: async (factory) => await this.request<unknown>(done => factory(this.tui, base.theme, this.bindings, value => done(value))) as never,
            notify: message => notify(message), onTerminalInput,
            setStatus: (key, value) => notify(value === undefined ? '' : `${key}: ${value}`),
            setWorkingMessage: message => notify(message ?? ''), setWorkingVisible: () => { }, setWorkingIndicator: () => { }, setHiddenThinkingLabel: () => { },
            setTitle: () => { }, // Hidden agents cannot change the host terminal title.
            pasteToEditor: text => editor.insertTextAtCursor(text), setEditorText: text => editor.setText(text), getEditorText: () => editor.getExpandedText(),
            setWidget: unavailable, setFooter: unavailable, setHeader: unavailable, addAutocompleteProvider: unavailable, setEditorComponent: unavailable, getEditorComponent: () => undefined,
            getAllThemes: () => [], getTheme: () => undefined, setTheme: () => ({ success: false, error: 'Theme changes unavailable in fixed native profile' }),
        };
    }
    dispose(): void {
        this.disposed = true;
        for (const entry of [...this.queue])
            entry.finish(undefined);
    }
}

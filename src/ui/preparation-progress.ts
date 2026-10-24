import { ScrollView, Text, VStack, getKeybindings } from '@earendil-works/pi-tui';
import { plainTerminalText } from './chrome.js';
/** The operation owns cancellation/settlement; this view only renders a bounded tail. */
export class PreparationProgress extends VStack {
    private readonly status: Text;
    private readonly output: Text;
    private readonly timer: ReturnType<typeof setInterval>;
    private readonly began = performance.now();
    private tail = '';
    private cancelling = false;
    constructor(title: string, private readonly cancel: () => void, private readonly redraw: () => void, private readonly presentation?: { running: string; cancelling: string; cancelHint: string }) {
        const status = new Text('', 0, 0), output = new Text('', 0, 0);
        super([{ component: new Text(title, 0, 0), basis: 'auto', shrink: 0 },
            { component: status, basis: 'auto', shrink: 0 },
            { component: new ScrollView(output, { follow: 'end', primary: true, scrollbar: 'auto' }), basis: 0, grow: 1, minSize: 1 },
            { component: new Text(presentation?.cancelHint ?? 'Esc cancels local execution · packages, VM or engine build state may remain', 0, 0), basis: 'auto', shrink: 0 }]);
        this.status = status;
        this.output = output;
        this.timer = setInterval(() => this.update(), 1000);
        this.update();
    }
    private update(): void {
        this.status.setText(`${this.cancelling ? this.presentation?.cancelling ?? 'Cancelling · waiting for local cleanup' : this.presentation?.running ?? 'Running'} · ${((performance.now() - this.began) / 1000).toFixed(0)}s`);
        this.redraw();
    }
    append(text: string): void {
        this.tail = (this.tail + plainTerminalText(text)).slice(-16384);
        this.output.setText(this.tail);
        this.update();
    }
    handleInput(data: string): void {
        if (getKeybindings().matches(data, 'tui.select.cancel'))
            this.requestCancel();
    }
    requestCancel(): void {
        if (!this.cancelling) {
            this.cancelling = true;
            this.cancel();
            this.update();
        }
    }
    dispose(): void { clearInterval(this.timer); }
}

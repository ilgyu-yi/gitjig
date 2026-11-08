import { copyToClipboard } from '@earendil-works/pi-coding-agent';
import { ProcessTerminal, TuiAltScreen, type Terminal } from '@earendil-works/pi-tui';
import { normalizeHostKeyEvent } from './command-input.js';

export class NativeTerminal extends ProcessTerminal {
    interceptInput?: (data: string) => boolean;
    override start(onInput: (data: string) => void, onResize: () => void): void {
        // Normalize framed input before the native viewport handles shortcuts.
        super.start(data => {
            const normalized = normalizeHostKeyEvent(data);
            if (!this.interceptInput?.(normalized)) onInput(normalized);
        }, onResize);
    }
}

/** Keep native selection; use Pi's platform clipboard instead of bare OSC 52. */
export function createNativeScreen(terminal: Terminal, copy = copyToClipboard): TuiAltScreen {
    return new TuiAltScreen(terminal, true, undefined, {
        copySelection: async (text) => {
            try {
                await copy(text);
                return true;
            }
            catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
    });
}

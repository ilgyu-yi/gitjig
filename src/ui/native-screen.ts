import { copyToClipboard } from '@earendil-works/pi-coding-agent';
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui';
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

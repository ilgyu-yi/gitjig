import { ExtensionInputComponent } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
/** Public paste admission sets the cursor after a literal default, regardless of cursor-key remaps. */
export function productInput(title: string, value: string, submit: (value: string) => void, cancel: () => void, tui: TUI, description?: string): ExtensionInputComponent {
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value))
        throw Error('This single-line form cannot edit a default containing control characters or line breaks; use the explicit CLI or advanced configuration path');
    const component = new ExtensionInputComponent(title, undefined, submit, cancel, { tui, ...(description === undefined ? {} : { description }) });
    if (value)
        component.handleInput(`\x1b[200~${value}\x1b[201~`);
    return component;
}

import { ExtensionInputComponent } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
export function acceptsSingleLineInput(value: string): boolean {
    return !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value);
}

export async function readSingleLineInput(
    open: (value: string, description?: string) => Promise<string | undefined>,
    initial: string, singleLineIssue: string, validate?: (value: string) => string | undefined,
) {
    let value = acceptsSingleLineInput(initial) ? initial : '';
    let issue = value === initial ? undefined : singleLineIssue;
    while (true) {
        const entered = await open(value, issue);
        if (entered === undefined) return;
        if (!acceptsSingleLineInput(entered)) {
            issue = singleLineIssue;
            continue;
        }
        issue = validate?.(entered);
        if (issue === undefined) return entered;
        value = entered;
    }
}

/** Public paste admission sets the cursor after a literal default, regardless of cursor-key remaps. */
export function productInput(title: string, value: string, submit: (value: string) => void, cancel: () => void, tui: TUI, description?: string): ExtensionInputComponent {
    if (!acceptsSingleLineInput(value))
        throw Error('This single-line form cannot edit a default containing control characters or line breaks; use the explicit CLI or advanced configuration path');
    const component = new ExtensionInputComponent(title, undefined, submit, cancel, { tui, ...(description === undefined ? {} : { description }) });
    if (value)
        component.handleInput(`\x1b[200~${value}\x1b[201~`);
    return component;
}

import { authBrowserNotifications } from '../app/auth-browser.js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { AuthInteraction } from '@earendil-works/pi-ai';
/** Terminal-only account interaction. Secrets never enter argv, history or output. */
export function terminalAccountInteraction(signal: AbortSignal): {
    interaction: AuthInteraction;
    close(): void;
} {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
        throw new Error('Login requires an interactive terminal; use gitjig in a terminal');
    let hidden = false;
    const cancelled = new AbortController();
    const interactionSignal = AbortSignal.any([signal, cancelled.signal]);
    const output = new Writable({ write(chunk, _encoding, callback) {
            if (!hidden)
                process.stderr.write(chunk);
            callback();
        } });
    // readline uses terminal cursor/echo handling; suppress all its secret-step
    // output, including submitted text. Do not use a persistent history file.
    const reader = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
    let closed = false;
    const close = () => {
        if (!closed) {
            closed = true;
            cancelled.abort();
            hidden = false;
            reader.close();
            output.end();
        }
    };
    reader.on('SIGINT', () => cancelled.abort());
    reader.on('close', () => cancelled.abort());
    const browser = authBrowserNotifications(interactionSignal, () => process.stderr.write('Browser could not open. Copy the sign-in URL above to continue.\n'));
    return { close, interaction: {
            signal: interactionSignal,
            async prompt(prompt) {
                const selectedSignal = prompt.signal ? AbortSignal.any([interactionSignal, prompt.signal]) : interactionSignal;
                selectedSignal.throwIfAborted();
                if (prompt.type === 'select') {
                    process.stderr.write(prompt.message + '\n' + prompt.options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ': ' + option.description : ''}`).join('\n') + '\n');
                    const answer = await reader.question('Choice: ', { signal: selectedSignal });
                    const option = prompt.options[Number(answer) - 1];
                    if (!option)
                        throw new Error('Invalid account choice; start login again');
                    return option.id;
                }
                hidden = prompt.type === 'secret';
                try {
                    if (hidden)
                        process.stderr.write(prompt.message + ': ');
                    return await reader.question(hidden ? '' : prompt.message + ': ', { signal: selectedSignal });
                }
                finally {
                    if (hidden)
                        process.stderr.write('\n');
                    hidden = false;
                }
            },
            notify(event) {
                browser(event);
                if (event.type === 'auth_url')
                    process.stderr.write(`${event.instructions ?? 'Open this URL to sign in:'}\n${event.url}\n`);
                else if (event.type === 'device_code')
                    process.stderr.write(`Open ${event.verificationUri}\nCode: ${event.userCode}\n`);
                else
                    process.stderr.write(event.message + '\n' + (event.type === 'info' ? (event.links ?? []).map(link => `${link.label ?? 'Link'}: ${link.url}\n`).join('') : ''));
            },
        } };
}

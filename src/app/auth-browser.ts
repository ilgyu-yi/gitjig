import { spawn } from 'node:child_process';
import type { AuthEvent } from '@earendil-works/pi-ai';
/** Desktop integration is best-effort; the provider's original URL remains visible. */
export function openAuthBrowser(url: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || url.length > 16384 || /[\x00-\x20\x7f]/u.test(url))
        return Promise.resolve(false);
    try {
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
            return Promise.resolve(false);
    }
    catch {
        return Promise.resolve(false);
    }
    const executable = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'linux' ? 'xdg-open' : undefined;
    if (!executable)
        return Promise.resolve(false);
    return new Promise(resolve => {
        const child = spawn(executable, [url], { shell: false, stdio: 'ignore' });
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            resolve(ok);
        };
        const abort = () => { child.kill('SIGKILL'); finish(false); };
        const timer = setTimeout(abort, 5000);
        signal.addEventListener('abort', abort, { once: true });
        child.on('error', () => finish(false));
        child.on('exit', code => finish(code === 0));
        if (signal.aborted)
            abort();
    });
}
export function authBrowserNotifications(signal: AbortSignal, fallback: () => void, open: typeof openAuthBrowser = openAuthBrowser): (event: AuthEvent) => void {
    const attempted = new Set<string>();
    return event => {
        if (signal.aborted || !['auth_url', 'device_code'].includes(event.type))
            return;
        const url = event.type === 'auth_url' ? event.url : event.type === 'device_code' ? event.verificationUri : undefined;
        if (!url || attempted.has(url))
            return;
        attempted.add(url);
        void open(url, signal).then(ok => {
            if (!ok && !signal.aborted)
                fallback();
        }, () => {
            if (!signal.aborted)
                fallback();
        });
    };
}

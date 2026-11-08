import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Identify the current launcher for guidance. Admission verifies the binding separately. */
export function boundLauncher(home: string, node = process.execPath, payload = fileURLToPath(new URL('../../', import.meta.url))): string | undefined {
    if (node === join(home, 'bootstrap/node') && dirname(payload) === join(home, 'versions') && /^[a-f0-9]{64}$/.test(basename(payload)))
        return join(home, 'gitjig');
}

export function quoteShellOperand(value: string): string {
    return "'" + value.replaceAll("'", "'\\''") + "'";
}

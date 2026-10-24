import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
/** No SDK import or Pi application selector participates in home resolution. */
export function resolveApplicationHome(explicit?: string, environment: Readonly<Record<string, string | undefined>> = process.env): string {
    const selected = explicit ?? environment.GITJIG_HOME ?? join(homedir(), '.gitjig');
    if (!isAbsolute(selected))
        throw new Error('gitjig home must be absolute');
    return resolve(selected);
}

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Metadata from this entry's actual package resolution, never the current project. */
export function applicationIdentity(): {
    application: 'gitjig';
    version: string;
    piSdkVersion: string;
} {
    const own = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        name: string;
        version: string;
    };
    const entry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
    const pi = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8')) as {
        name: string;
        version: string;
    };
    if (own.name !== 'gitjig' || pi.name !== '@earendil-works/pi-coding-agent' || typeof own.version !== 'string' || typeof pi.version !== 'string')
        throw new Error('Application/runtime package identity unavailable');
    return { application: 'gitjig', version: own.version, piSdkVersion: pi.version };
}

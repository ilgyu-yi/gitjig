import { stat } from 'node:fs/promises';
import { trustedDockerBinary, trustedDockerConfiguration } from './container-scope.js';
import { readNativeObservation } from './native-observation.js';
import { parseUniqueJson } from '../workflow/json.js';
export interface RuntimeDiscoveryInput {
    dockerBinary: string;
    dockerConfigDirectory: string;
    dockerContext?: string;
}
/** Explicit native reads only. No ambient Docker route, provisioning or runtime qualification. */
export async function discoverRuntimeCandidates(kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, options: {
    home: string;
    signal: AbortSignal;
    guard(): void;
    checkPath(file: string): void;
}) {
    const guard = () => {
        if (options.signal.aborted)
            throw Error('Runtime discovery cancelled');
        options.guard();
    };
    guard();
    const dockerBinary = await trustedDockerBinary(input.dockerBinary);
    guard();
    options.checkPath(dockerBinary);
    if (!input.dockerConfigDirectory)
        throw Error('Choose an explicit Docker configuration directory for discovery; ambient configuration is not used');
    const dockerConfigDirectory = await trustedDockerConfiguration(input.dockerConfigDirectory);
    guard();
    options.checkPath(dockerConfigDirectory);
    if (kind === 'images' && !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.dockerContext ?? ''))
        throw Error('Choose an explicit Docker context before listing images');
    const identity = async () => Promise.all([dockerBinary, dockerConfigDirectory].map(async (file) => { const value = await stat(file, { bigint: true }); return [value.dev, value.ino, value.mode, value.uid, value.size, value.mtimeNs].map(String).join(':'); }));
    const before = await identity();
    guard();
    const { routeIdentity } = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
    guard();
    const routeBefore = await routeIdentity({ dockerBinary, dockerConfigDirectory });
    guard();
    const route = ['--config', dockerConfigDirectory], args = kind === 'contexts' ? [...route, 'context', 'ls', '--quiet'] : [...route, '--context', input.dockerContext!, 'image', 'ls', '--no-trunc', '--format', '{{json .}}'];
    const raw = await readNativeObservation(dockerBinary, args, { cwd: options.home, env: { HOME: options.home, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, signal: options.signal, kind: 'Docker discovery' });
    guard();
    const after = await identity();
    guard();
    const routeAfter = await routeIdentity({ dockerBinary, dockerConfigDirectory });
    guard();
    if (JSON.stringify(after) !== JSON.stringify(before) || routeAfter !== routeBefore)
        throw Error('Docker discovery executable or configuration directory changed; reopen discovery');
    guard();
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    }
    catch {
        throw Error('Docker discovery returned non-UTF-8 output');
    }
    if (text && !text.endsWith('\n'))
        throw Error('Docker discovery returned incomplete output');
    const rows = text ? text.slice(0, -1).split('\n').map(row => row.endsWith('\r') ? row.slice(0, -1) : row) : [];
    if (rows.length > 256)
        throw Error('Docker discovery exceeds 256 rows; use explicit runtime fields to select from a larger inventory');
    const entries = new Map<string, Set<string>>();
    try {
        for (const row of rows) {
            if (kind === 'contexts') {
                if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(row))
                    throw Error('context');
                entries.set(row, new Set([row]));
            }
            else {
                const value = parseUniqueJson(row) as {
                    ID?: unknown;
                    Repository?: unknown;
                    Tag?: unknown;
                };
                if (!value || typeof value.ID !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.ID) || typeof value.Repository !== 'string' || !(/^[!-~]{1,512}$/).test(value.Repository) || typeof value.Tag !== 'string' || !(/^[!-~]{1,128}$/).test(value.Tag))
                    throw Error('image');
                const references = entries.get(value.ID) ?? new Set<string>();
                references.add(value.Repository + ':' + value.Tag);
                entries.set(value.ID, references);
            }
        }
    }
    catch {
        throw Error('Docker discovery returned unsupported candidate values; no partial inventory is shown');
    }
    const candidates = [...entries.keys()], labels = candidates.map(id => kind === 'contexts' ? id : [...entries.get(id)!][0] + ' · ' + id + (entries.get(id)!.size > 1 ? ' · +' + (entries.get(id)!.size - 1) + ' references' : ''));
    guard();
    return { kind, dockerBinary, dockerConfigDirectory, ...(kind === 'images' ? { dockerContext: input.dockerContext } : {}), candidates, labels };
}

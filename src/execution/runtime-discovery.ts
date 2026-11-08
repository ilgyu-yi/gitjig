import { trustedDockerBinary, trustedDockerConfiguration } from './container-scope.js';
import { assertDockerPreparationRoute } from './docker-environment.js';
import { readNativeObservation } from './native-observation.js';
import { parseUniqueJson } from '../workflow/json.js';
export interface RuntimeDiscoveryInput {
    dockerBinary: string;
    dockerConfigDirectory: string;
    dockerContext?: string;
}
interface RuntimeRouteGuard {
    guard(): void;
    checkPath(file: string): void;
}
const imageId = /^sha256:[a-f0-9]{64}$/;
function inventoryRows(raw: Uint8Array): string[] {
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    }
    catch {
        throw Error('Docker discovery returned non-UTF-8 output');
    }
    if (text && !text.endsWith('\n'))
        throw Error('Docker discovery returned incomplete output');
    return text ? text.slice(0, -1).split('\n').map(row => row.endsWith('\r') ? row.slice(0, -1) : row) : [];
}
/** Resolve local paths for review without starting a Docker process. */
export async function resolveRuntimeRoute(kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, { guard, checkPath }: RuntimeRouteGuard) {
    input = { ...input };
    guard();
    const dockerBinary = await trustedDockerBinary(input.dockerBinary);
    guard();
    checkPath(dockerBinary);
    if (!input.dockerConfigDirectory)
        throw Error('Choose an explicit Docker configuration directory for discovery; ambient configuration is not used');
    const dockerConfigDirectory = await trustedDockerConfiguration(input.dockerConfigDirectory);
    guard();
    checkPath(dockerConfigDirectory);
    if (kind === 'images' && !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.dockerContext ?? ''))
        throw Error('Choose an explicit Docker context');
    if (kind === 'images')
        assertDockerPreparationRoute(input.dockerContext);
    return { dockerBinary, dockerConfigDirectory, ...(kind === 'images' ? { dockerContext: input.dockerContext! } : {}) };
}

/** Explicit native reads only. No ambient Docker route, provisioning or runtime qualification. */
export async function discoverRuntimeCandidates(kind: 'contexts' | 'images', input: RuntimeDiscoveryInput, options: RuntimeRouteGuard & {
    home: string;
    signal: AbortSignal;
    reviewed?: true;
}) {
    input = { ...input };
    const guard = () => {
        options.signal.throwIfAborted();
        options.guard();
    };
    const captured = await resolveRuntimeRoute(kind, input, { guard, checkPath: options.checkPath });
    const { routeIdentity, assertReviewedDockerRoute } = await import(new URL('../../runtime/setup.mjs', import.meta.url).href);
    const { dockerBinary, dockerConfigDirectory } = captured;
    const assertRoute = (file: string, directory: string | undefined) => {
        guard();
        assertDockerPreparationRoute(captured.dockerContext);
        if (options.reviewed)
            assertReviewedDockerRoute(input, file, directory);
    };
    const env = { HOME: options.home, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
    const observe = (file: string, args: string[]) => {
        assertRoute(file, args[0] === '--config' ? args[1] : undefined);
        return readNativeObservation(file, args, { cwd: options.home, env, signal: options.signal, kind: 'Docker discovery' });
    };
    assertRoute(dockerBinary, dockerConfigDirectory);
    const snapshot = () => routeIdentity(captured, { cwd: options.home, env, signal: options.signal, guard: () => assertRoute(dockerBinary, dockerConfigDirectory), checkPath: options.checkPath,
        execute: async (file: string, args: string[]) => ({ stdout: new TextDecoder('utf-8', { fatal: true }).decode(await observe(file, args)) }),
    });
    const before = await snapshot();
    const recheck = async () => {
        assertRoute(dockerBinary, dockerConfigDirectory);
        if (await snapshot() !== before)
            throw Error('Docker discovery executable or route metadata changed; reopen discovery');
    };
    const route = ['--config', dockerConfigDirectory];
    const imageList = [...route, '--context', captured.dockerContext!, 'image', 'ls', '--no-trunc', '--format', '{{json .}}'];
    const raw = await observe(dockerBinary, kind === 'contexts' ? [...route, 'context', 'ls', '--quiet'] : imageList);
    await recheck();
    const rows = inventoryRows(raw);
    if (kind === 'images') {
        // The ordinary listing may omit untagged final images. The dangling filter excludes intermediates.
        const dangling = await observe(dockerBinary, [...imageList, '--filter', 'dangling=true']);
        await recheck();
        if (raw.byteLength + dangling.byteLength > 1024 * 1024)
            throw Error('Docker discovery exceeds 1 MiB of combined output');
        rows.push(...inventoryRows(dangling));
    }
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
                if (!value || typeof value.ID !== 'string' || !imageId.test(value.ID) || typeof value.Repository !== 'string' || !(/^[!-~]{1,512}$/).test(value.Repository) || typeof value.Tag !== 'string' || !(/^[!-~]{1,128}$/).test(value.Tag))
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
    const marked = new Set<string>();
    if (kind === 'images' && entries.size) {
        // Query the marker by immutable ID, while keeping candidate membership from the original inventory.
        const markerRows = inventoryRows(await observe(dockerBinary, [...route, '--context', captured.dockerContext!, 'image', 'ls',
            '--all', '--no-trunc', '--quiet', '--filter', 'label=io.gitjig.runtime.recipe=1']));
        await recheck();
        if (markerRows.some(id => !imageId.test(id)))
            throw Error('Docker discovery returned invalid image marker IDs');
        for (const id of markerRows)
            if (entries.has(id))
                marked.add(id);
    }
    const candidates = [...entries.keys()].sort((a, b) => Number(marked.has(b)) - Number(marked.has(a)));
    const labels = candidates.map(id => kind === 'contexts' ? id : [...entries.get(id)!][0] + ' · ' + id + (entries.get(id)!.size > 1 ? ' · +' + (entries.get(id)!.size - 1) + ' references' : ''));
    assertRoute(dockerBinary, dockerConfigDirectory);
    return { kind, ...captured, candidates, labels, recipeImages: [...marked] };
}

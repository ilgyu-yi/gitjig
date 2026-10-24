import { captureNormalization, dependencyLinkNormalization, validateDependencyLinks, type DependencyLink } from './capture-links.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { CaptureProfile } from './types.js';
export interface Manifest {
    digest: string;
    entries: number;
    bytes: number;
    passes: number;
    files: {
        path: string;
        sha256: string;
        size: number;
        mode: number;
        effectiveMode: number;
    }[];
    directories: {
        path: string;
        mode: number;
        effectiveMode: number;
    }[];
    dependencyLinks?: DependencyLink[];
    normalization: string;
}
export function validateCaptureProfile(profile: CaptureProfile) {
    const result = { maxEntries: profile.maxEntries ?? 100000, maxBytes: profile.maxBytes ?? 512 * 1024 * 1024, timeoutMs: profile.timeoutMs ?? 30000 };
    for (const [label, value, max] of [['entries', result.maxEntries, 100000], ['bytes', result.maxBytes, 512 * 1024 * 1024], ['timeout', result.timeoutMs, 30000]] as const)
        if (!Number.isSafeInteger(value) || value < 1 || value > max)
            throw new Error(`invalid capture ${label}`);
    return result;
}
export function capture(source: string, target: string, profile: CaptureProfile, signal?: AbortSignal): {
    result: Promise<Manifest>;
    stop: () => Promise<number>;
} {
    const { maxEntries, maxBytes, timeoutMs } = validateCaptureProfile(profile);
    const worker = new Worker(new URL('./capture-worker.js', import.meta.url), { workerData: { source, target, maxEntries, maxBytes } });
    const stop = () => worker.terminate();
    const result = new Promise<Manifest>((resolve, reject) => {
        let payload: {
            ok: boolean;
            manifest?: Manifest;
            error?: string;
        } | undefined, error: Error | undefined, exited = false, cleanupTimer: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => abort('capture deadline'), timeoutMs);
        const onAbort = () => abort('capture cancelled');
        signal?.addEventListener('abort', onAbort, { once: true });
        function clean() {
            clearTimeout(deadline);
            if (cleanupTimer)
                clearTimeout(cleanupTimer);
            signal?.removeEventListener('abort', onAbort);
        }
        function abort(message: string) {
            if (exited || error)
                return;
            error = new Error(message);
            void stop().catch(e => {
                error = e;
            });
            cleanupTimer = setTimeout(() => {
                if (!exited) {
                    clean();
                    reject(new Error('UNKNOWN_CAPTURE: worker termination unconfirmed'));
                }
            }, 2000);
        }
        worker.once('message', data => {
            payload = data;
        });
        worker.once('error', e => {
            error = e;
        });
        worker.once('exit', code => {
            exited = true;
            clean();
            if (error)
                reject(error);
            else if (code === 0 && payload?.ok && payload.manifest)
                resolve(payload.manifest);
            else
                reject(new Error(payload?.error ?? `capture worker exited without usable manifest: ${code}`));
        });
        if (signal?.aborted)
            onAbort();
        else
            worker.postMessage('GO');
    });
    return { result, stop };
}
/** Validate the ORIGINAL worker payload and digest, without rereading a later worktree. */
export function validateManifest(value: unknown): Manifest {
    const m = value as Manifest, fail = () => { throw new Error('Execution capture manifest unavailable or invalid'); };
    if (!m || m.passes !== 2 || !Array.isArray(m.files) || !Array.isArray(m.directories) ||
        !Number.isSafeInteger(m.entries) || m.entries < 0 || m.entries > 100000 || m.entries !== m.files.length + m.directories.length + (m.dependencyLinks?.length ?? 0) ||
        !Number.isSafeInteger(m.bytes) || m.bytes < 0 || m.bytes > 512 * 1024 * 1024 ||
        (m.dependencyLinks === undefined ? m.normalization !== captureNormalization : !Array.isArray(m.dependencyLinks) || !m.dependencyLinks.length || m.normalization !== dependencyLinkNormalization))
        return fail();
    const seen = new Set<string>();
    let bytes = 0;
    const entry = (p: string, mode: number) => {
        if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split('/').some(part => !part || part === '.' || part === '..') ||
            p.includes('\\') || seen.has(p) || !Number.isInteger(mode) || mode < 0 || mode > 0o777)
            fail();
        seen.add(p);
    };
    for (const file of m.files) {
        entry(file.path, file.mode);
        if (!/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.effectiveMode !== (0o600 | (file.mode & 0o111)))
            fail();
        bytes += file.size;
    }
    for (const directory of m.directories) {
        entry(directory.path, directory.mode);
        if (directory.effectiveMode !== 0o700)
            fail();
    }
    for (const link of m.dependencyLinks ?? []) {
        entry(link.path, 0);
        if (typeof link.target !== 'string')
            fail();
        bytes += Buffer.byteLength(link.target);
    }
    try {
        validateDependencyLinks(m.dependencyLinks ?? [], m.files, m.directories);
    }
    catch {
        return fail();
    }
    const payload = { entries: m.entries, bytes: m.bytes, files: m.files, directories: m.directories, ...(m.dependencyLinks ? { dependencyLinks: m.dependencyLinks } : {}), normalization: m.normalization };
    if (bytes !== m.bytes || createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== m.digest)
        fail();
    return m;
}

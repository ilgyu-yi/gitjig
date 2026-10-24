import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { classifyCreateRejection, validCreateRejectionEvidence, type CreateRejectionEvidence } from './create-rejection.js';
export interface ScopeConfig {
    dockerContext: string;
    dockerConfigDirectory?: string;
    image: string;
    workRoot: string;
    stateRoot: string;
    workId: string;
    runId: string;
    signal?: AbortSignal;
    uid?: number;
    gid?: number;
    inputRoot?: string;
    protectedPaths?: string[];
    readOnlyWork?: boolean;
    memoryMiB?: number;
    cpus?: number;
    pidsLimit?: number;
    scratchMiB?: number;
    maxOutputBytes?: number;
    defaultTimeoutMs?: number;
    dockerBinary: string;
}
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    termination?: 'timeout' | 'aborted' | 'output-limit';
}
export interface CleanupResult {
    state: 'removed' | 'quarantined';
    containerId: string;
    reason?: string;
}
interface RunOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    stdin?: Buffer;
    onData?: (data: Buffer) => void;
    limit?: number;
}
const inside = (p: string, r: string) => p === r || p.startsWith(r + path.sep);
const finite = (n: number, min: number, max: number, label: string) => { if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`invalid ${label}`); return n; };
export async function trustedDockerBinary(binary: string) { if (!binary || !path.isAbsolute(binary))
    throw new Error('absolute trusted Docker client required'); const canonical = await fs.realpath(binary), stat = await fs.stat(canonical); if (!stat.isFile() || (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0 || (stat.uid !== 0 && stat.uid !== process.getuid?.()))
    throw new Error('Docker client must be trusted owner executable'); return canonical; }
export async function trustedDockerConfiguration(directory: string) {
    if (!path.isAbsolute(directory) || await fs.realpath(directory) !== directory)
        throw Error('Docker configuration directory must be canonical and absolute');
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== process.getuid?.()))
        throw Error('Docker configuration directory must be trusted');
    return directory;
}
const dockerRoute = (directory?: string) => directory ? ['--config', directory] : [];
/** Local metadata validation only; never invokes Docker or resolves a context. */
export async function validateRuntimeProfile(value: import('../controller/types.js').RuntimeProfile): Promise<import('../controller/types.js').RuntimeProfile> {
    const dockerBinary = await trustedDockerBinary(value.dockerBinary);
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(value.dockerContext))
        throw Error('explicit Docker context required');
    if (!/^(?:[^\s]+@)?sha256:[a-f0-9]{64}$/.test(value.image))
        throw Error('immutable image ID/digest required');
    for (const key of ['uid', 'gid'] as const) {
        const n = finite(value[key] ?? 1000, 1, 2 ** 31 - 1, key);
        if (!Number.isInteger(n))
            throw Error('uid/gid must be integers');
    }
    finite(value.memoryMiB ?? 512, 32, 65536, 'memory');
    finite(value.cpus ?? 1, 0.1, 64, 'cpu');
    finite(value.pidsLimit ?? 128, 8, 4096, 'pids');
    finite(value.scratchMiB ?? 64, 1, 4096, 'scratch');
    finite(value.maxOutputBytes ?? 2 * 1024 * 1024, 1024, 32 * 1024 * 1024, 'output');
    finite(value.defaultTimeoutMs ?? 60000, 1, 3600000, 'timeout');
    const dockerConfigDirectory = value.dockerConfigDirectory === undefined ? undefined : await trustedDockerConfiguration(value.dockerConfigDirectory);
    return Object.freeze({ ...value, dockerBinary, ...(dockerConfigDirectory ? { dockerConfigDirectory } : {}) });
}
async function journalWrite(file: string, value: unknown, exclusive = false) {
    const text = JSON.stringify(value) + '\n';
    const handle = await fs.open(exclusive ? file : file + '.next', exclusive ? 'wx' : 'w', 0o600);
    try {
        await handle.writeFile(text);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    if (!exclusive)
        await fs.rename(file + '.next', file);
    const directory = await fs.open(path.dirname(file), 'r');
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
    return createHash('sha256').update(text).digest('hex');
}
/** Host-only recovery after separately validating original run/observation provenance. */
export async function settleRejectedScopeCreate(journal: string, expectedRaw: string, evidence: CreateRejectionEvidence, validate?: () => void): Promise<CleanupResult & {
    journalHash: string;
}> {
    if (!validCreateRejectionEvidence(evidence) ||
        evidence.original.kind === 'legacy-controller-observation' && evidence.original.journalPath !== journal)
        throw Error('Original create rejection evidence is unavailable');
    const stat = await fs.lstat(journal);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 || stat.size > 65536 || await fs.realpath(journal) !== journal)
        throw Error('Original scope journal is not owned regular storage');
    if (await fs.readFile(journal, 'utf8') !== expectedRaw)
        throw Error('Original scope journal changed; inspect recovery again');
    const saved = JSON.parse(expectedRaw);
    identity(saved.workId);
    identity(saved.runId);
    if (saved.version !== 1 || !/^[a-zA-Z0-9_.-]{1,100}$/.test(saved.context) ||
        !/^[a-f0-9-]{36}$/.test(saved.nonce) || saved.name !== `gitjig-${saved.nonce}` ||
        saved.id !== undefined || saved.nativeCleanupUnknown || saved.absenceEvidence ||
        !['creating', 'quarantined'].includes(saved.state) ||
        saved.creationBinding !== undefined && saved.creationBinding?.state !== 'UNAVAILABLE')
        throw Error('Original scope is not an unallocated rejected create');
    validate?.();
    const journalHash = await journalWrite(journal, {
        ...saved,
        state: 'removed',
        reason: 'Original Docker create rejected before allocation',
        createRejection: evidence,
    });
    return { state: 'removed', containerId: '', reason: 'Original Docker create rejected before allocation', journalHash };
}
const identity = (s: string) => { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(s))
    throw new Error('invalid identity'); return s; };
type CreationBinding = {
    version: 1;
    state: 'UNAVAILABLE';
    reason: string;
} | {
    version: 1;
    state: 'VERIFIED';
    client: string;
    daemonId: string;
    routeIdentity: string[];
    scopeHash: string;
    createSettled: true;
};
type DaemonObservation = {
    state: 'observed';
    id: string;
    routeIdentity: string[];
} | {
    state: 'unavailable' | 'changed';
    reason: string;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeHash = (value: {
    context: string;
    dockerConfigDirectory?: string;
    id: string;
    nonce: string;
    workId: string;
    runId: string;
}) => digest(JSON.stringify([value.context, value.dockerConfigDirectory ?? null, value.id, value.nonce, value.workId, value.runId]));
const daemonId = (value: unknown): value is string => typeof value === 'string' && /^[!-~]{1,256}$/.test(value);
async function routeIdentity(binary: string, directory: string): Promise<string[]> {
    return Promise.all([binary, directory].map(async (file) => {
        const value = await fs.stat(file, { bigint: true });
        return [value.dev, value.ino, value.mode, value.uid, value.size, value.mtimeNs].map(String).join(':');
    }));
}
/** Optional original-daemon proof; lack of info permission does not disable normal owned execution. */
async function observeDaemon(binary: string, directory: string | undefined, context: string, signal?: AbortSignal): Promise<DaemonObservation> {
    if (!directory)
        return { state: 'unavailable', reason: 'Explicit Docker configuration required for absence proof' };
    let before: string[];
    try {
        before = await routeIdentity(binary, directory);
    }
    catch {
        return { state: 'unavailable', reason: 'Docker route metadata unavailable' };
    }
    let result: ExecutionResult;
    try {
        result = await processRun(binary, [...dockerRoute(directory), '--context', context, 'info', '--format', '{{json .ID}}'], { timeoutMs: 5000, limit: 4096, ...(signal ? { signal } : {}) });
    }
    catch (error) {
        if (error instanceof NativeCleanupError)
            throw error;
        return { state: 'unavailable', reason: 'Native daemon observation unavailable' };
    }
    try {
        if (JSON.stringify(await routeIdentity(binary, directory)) !== JSON.stringify(before))
            return { state: 'changed', reason: 'Docker executable or configuration directory changed' };
    }
    catch {
        return { state: 'changed', reason: 'Docker route metadata changed during observation' };
    }
    if (result.exitCode !== 0 || result.termination || result.stderr)
        return { state: 'unavailable', reason: 'Native daemon observation unavailable' };
    let id: unknown;
    try {
        id = JSON.parse(result.stdout);
    }
    catch {
        return { state: 'unavailable', reason: 'Native daemon identity malformed' };
    }
    if (!daemonId(id))
        return { state: 'unavailable', reason: 'Native daemon identity unavailable' };
    return { state: 'observed', id, routeIdentity: before };
}
function creationBinding(saved: Record<string, any>): CreationBinding | undefined {
    if (!Object.hasOwn(saved, 'creationBinding'))
        return undefined;
    const value = saved.creationBinding;
    if (value?.version === 1 && value.state === 'UNAVAILABLE' && typeof value.reason === 'string' && value.reason.length <= 1024)
        return value;
    if (!value || value.version !== 1 || value.state !== 'VERIFIED' || value.createSettled !== true || typeof saved.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(saved.id) || !saved.dockerConfigDirectory || typeof value.client !== 'string' || !path.isAbsolute(value.client) ||
        !daemonId(value.daemonId) || !Array.isArray(value.routeIdentity) || value.routeIdentity.length !== 2 ||
        !value.routeIdentity.every((item: unknown) => typeof item === 'string' && item.length <= 512) || value.scopeHash !== scopeHash(saved as any))
        throw Error('Invalid retained scope creation binding; restore its original record');
    return value;
}
/** Never accepts name-only creation uncertainty or a newly inferred daemon binding. */
async function absentKnownScope(saved: Record<string, any>, binding: CreationBinding | undefined, binary: string, directory: string | undefined) {
    if (binding?.state !== 'VERIFIED' || binding.client !== binary || !directory)
        return undefined;
    const before = await observeDaemon(binary, directory, saved.context);
    if (before.state !== 'observed' || before.id !== binding.daemonId)
        return undefined;
    const listed = await processRun(binary, [...dockerRoute(directory), '--context', saved.context, 'container', 'ls', '--all', '--no-trunc', '--quiet'], { timeoutMs: 5000, limit: 1024 * 1024 });
    if (listed.exitCode !== 0 || listed.termination || listed.stderr || listed.stdout && !listed.stdout.endsWith('\n'))
        return undefined;
    const ids = listed.stdout ? listed.stdout.slice(0, -1).split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line) : [];
    if (ids.some(id => !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length || ids.includes(saved.id))
        return undefined;
    const after = await observeDaemon(binary, directory, saved.context);
    if (after.state !== 'observed' || after.id !== binding.daemonId || JSON.stringify(after.routeIdentity) !== JSON.stringify(before.routeIdentity))
        return undefined;
    return { version: 1, kind: 'known-container-absent', containerId: saved.id, daemonId: binding.daemonId, client: binary,
        inventoryCount: ids.length, inventoryHash: digest(listed.stdout), observedAt: Date.now() };
}
/** A native transport cannot report a settled result while its owned group survives. */
type NativeCleanupUnknown = {
    version: 1;
    processGroup: number | null;
    reason: string;
    persistenceFailure?: string;
};
class NativeCleanupError extends Error {
    readonly checkpoint: NativeCleanupUnknown;
    constructor(pid: number | undefined) { super(`Native process cleanup unconfirmed; inspect original process group ${pid ?? 'not-started'} and inherited native helpers`); this.checkpoint = { version: 1, processGroup: pid ?? null, reason: this.message }; }
}
/** The explicit --context (and --config) select the route; ambient Docker/Node overrides must not redirect it. */
export function dockerEnvironment(args: readonly string[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    // Unlike runtime/setup.mjs, keep the owner's DOCKER_CONFIG without --config: it locates the named context store.
    // Docker's built-in `default` context is itself defined by the ambient endpoint/TLS variables.
    // Only the leading route (dockerRoute + --context) selects the client; container/command payload arguments never do.
    const route = args.slice(0, args[0] === '--config' ? 4 : 2), result = { ...env }, explicitConfig = route[0] === '--config', context = route[route.indexOf('--context') + 1];
    const keep = (key: string) => !explicitConfig && key === 'DOCKER_CONFIG' || context === 'default' && /^DOCKER_(HOST|CERT_PATH|TLS|TLS_VERIFY)$/u.test(key);
    for (const key of Object.keys(result))
        if (/^(DOCKER_|BUILDX_|BUILDKIT_|COLIMA_|LIMA_)/u.test(key) && !keep(key))
            delete result[key];
    delete result.NODE_OPTIONS;
    delete result.NODE_PATH;
    return result;
}
async function processRun(binary: string, args: string[], options: RunOptions = {}): Promise<ExecutionResult> {
    const timeout = finite(options.timeoutMs ?? 15000, 1, 3600000, 'timeout');
    const limit = finite(options.limit ?? 2 * 1024 * 1024, 1024, 32 * 1024 * 1024, 'output limit');
    if (process.platform === 'win32')
        throw Error('Native Windows process-group ownership unavailable');
    return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
            resolve({ stdout: '', stderr: 'aborted', exitCode: 130, termination: 'aborted' });
            return;
        }
        const child = spawn(binary, args, { shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: dockerEnvironment(args) });
        const out: Buffer[] = [], err: Buffer[] = [];
        let total = 0, closed = false, finished = false, exitCode: number | null = null, failure: Error | undefined, termination: ExecutionResult['termination'];
        let cleanup: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
        const gone = () => { if (!child.pid)
            return true; try {
            process.kill(-child.pid, 0);
            return false;
        }
        catch (error) {
            return (error as NodeJS.ErrnoException).code === 'ESRCH';
        } };
        const kill = () => { if (child.pid)
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                    failure ??= error as Error;
            } };
        const detach = () => { clearTimeout(timer); clearTimeout(cleanup); clearInterval(poll); options.signal?.removeEventListener('abort', abort); };
        const finish = () => {
            if (finished || !closed || !gone())
                return;
            finished = true;
            detach();
            if (failure) {
                reject(failure);
                return;
            }
            const result: ExecutionResult = { stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString(), exitCode: termination === 'timeout' ? 124 : termination === 'aborted' ? 130 : termination ? 125 : exitCode ?? 125 };
            if (termination)
                result.termination = termination;
            resolve(result);
        };
        const boundCleanup = () => {
            if (cleanup)
                return;
            poll = setInterval(finish, 20);
            cleanup = setTimeout(() => {
                kill();
                finish();
                if (finished)
                    return;
                finished = true;
                detach();
                child.stdin.destroy();
                child.stdout.destroy();
                child.stderr.destroy();
                child.unref();
                reject(new NativeCleanupError(child.pid));
            }, 2000);
        };
        const stop = (why: NonNullable<ExecutionResult['termination']> | Error) => {
            if (finished)
                return;
            if (why instanceof Error)
                failure ??= why;
            else
                termination ??= why;
            kill();
            boundCleanup();
            finish();
        };
        const timer = setTimeout(() => stop('timeout'), timeout), abort = () => stop('aborted');
        const collect = (list: Buffer[], b: Buffer) => {
            const take = Math.max(0, Math.min(b.length, limit - total));
            total += b.length;
            if (take) {
                list.push(b.subarray(0, take));
                try {
                    options.onData?.(b.subarray(0, take));
                }
                catch (error) {
                    stop(error instanceof Error ? error : Error(String(error)));
                }
            }
            if (total > limit)
                stop('output-limit');
        };
        child.stdout.on('data', (b: Buffer) => collect(out, b));
        child.stderr.on('data', (b: Buffer) => collect(err, b));
        child.on('error', error => stop(error));
        child.stdin.on('error', () => { });
        child.on('exit', (code) => { exitCode = code; if (!gone())
            stop(termination ?? failure ?? Error('Native client left an unsettled process group'));
        else
            boundCleanup(); });
        child.on('close', (code) => { closed = true; exitCode = code; if (!gone())
            stop(termination ?? failure ?? Error('Native client left an unsettled process group')); finish(); });
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted)
            abort();
        child.stdin.end(options.stdin);
    });
}
export class ContainerScope {
    readonly workspaceRoot: string;
    readonly containerId: string;
    private closed = false;
    private closing: Promise<CleanupResult> | undefined;
    private nativeCleanupUnknown: NativeCleanupUnknown | undefined;
    constructor(private config: ScopeConfig, id: string, private nonce: string, private journal: string, private creationBinding?: CreationBinding) { this.workspaceRoot = config.workRoot; this.containerId = id; }
    private async docker(args: string[], o: RunOptions = {}) {
        try {
            return await processRun(this.config.dockerBinary, [...dockerRoute(this.config.dockerConfigDirectory), '--context', this.config.dockerContext, ...args], o);
        }
        catch (error) {
            await this.retainNativeCleanup(error);
            throw error;
        }
    }
    async retainNativeCleanup(error: unknown) {
        if (error instanceof NativeCleanupError) {
            this.nativeCleanupUnknown ??= error.checkpoint;
            try {
                await this.record('quarantined', error.message);
            }
            catch (persistenceError) {
                this.nativeCleanupUnknown.persistenceFailure = String(persistenceError);
                error.cause = persistenceError;
            }
        }
    }
    private async record(state: string, reason?: string) { await journalWrite(this.journal, { version: 1, context: this.config.dockerContext, ...(this.config.dockerConfigDirectory ? { dockerConfigDirectory: this.config.dockerConfigDirectory } : {}), id: this.containerId, nonce: this.nonce, workId: this.config.workId, runId: this.config.runId, state, reason, ...(this.nativeCleanupUnknown ? { nativeCleanupUnknown: this.nativeCleanupUnknown } : {}), ...(this.creationBinding ? { creationBinding: this.creationBinding } : {}) }); }
    private async inspect() { const r = await this.docker(['inspect', this.containerId]); if (r.exitCode !== 0)
        throw new Error(`scope inspection failed: ${r.stderr}`); const item = JSON.parse(r.stdout)[0]; if (item?.Id !== this.containerId || item?.Config?.Labels?.['gitjig.scope'] !== this.nonce || item?.Config?.Labels?.['gitjig.work'] !== this.config.workId || item?.Config?.Labels?.['gitjig.run'] !== this.config.runId)
        throw new Error('scope ownership mismatch'); return item; }
    validatePath(value: string): string { const p = path.resolve(value.startsWith('/work/') || value === '/work' ? path.join(this.workspaceRoot, path.relative('/work', value)) : path.isAbsolute(value) ? value : path.join(this.workspaceRoot, value)); if (!inside(p, this.workspaceRoot))
        throw new Error('path outside workspace'); return p; }
    private mapped(value: string) { if (value === '/input' || value.startsWith('/input/') || value === '/scratch' || value.startsWith('/scratch/'))
        return path.resolve(value); return '/work' + path.relative(this.workspaceRoot, this.validatePath(value)).split(path.sep).map(p => p ? '/' + p : '').join(''); }
    async execute(command: string, options: {
        cwd?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
        onData?: (data: Buffer) => void;
    } = {}): Promise<ExecutionResult> {
        if (this.closed)
            throw new Error('scope is not reusable');
        await this.inspect();
        if (this.closed)
            throw new Error('scope is not reusable');
        const opts: RunOptions = { timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs ?? 60000, limit: this.config.maxOutputBytes ?? 2 * 1024 * 1024 };
        if (options.signal)
            opts.signal = options.signal;
        if (options.onData)
            opts.onData = options.onData;
        let result: ExecutionResult;
        try {
            result = await this.docker(['exec', '--workdir', this.mapped(options.cwd ?? this.workspaceRoot), this.containerId, '/bin/bash', '-lc', command], opts);
        }
        catch (error) {
            try {
                await this.close();
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Native execution and owned scope cleanup failed');
            }
            throw error;
        }
        if (result.termination) {
            const cleanup = await this.close();
            result.stderr += `\nscope ${cleanup.state}: ${result.termination}`;
        }
        return result;
    }
    async exec(command: string, cwd: string, options: {
        onData: (data: Buffer) => void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
    }): Promise<{
        exitCode: number | null;
    }> {
        if (options.env && Object.keys(options.env).length)
            throw new Error('per-command environment unsupported in initial profile');
        const opts: {
            cwd: string;
            timeoutMs?: number;
            signal?: AbortSignal;
            onData: (data: Buffer) => void;
        } = { cwd, onData: options.onData };
        if (options.timeout !== undefined)
            opts.timeoutMs = options.timeout * 1000;
        if (options.signal)
            opts.signal = options.signal;
        return { exitCode: (await this.execute(command, opts)).exitCode };
    }
    private async io(request: Record<string, unknown>, signal?: AbortSignal, limit = 2 * 1024 * 1024) {
        if (this.closed)
            throw new Error('scope is not reusable');
        await this.inspect();
        if (this.closed)
            throw new Error('scope is not reusable');
        const opts: RunOptions = { stdin: Buffer.from(JSON.stringify(request)), limit, timeoutMs: 30000 };
        if (signal)
            opts.signal = signal;
        const r = await this.docker(['exec', '-i', this.containerId, '/usr/local/bin/node', '/opt/gitjig/io-helper.mjs'], opts);
        if (r.termination) {
            await this.close();
            throw new Error(`I/O ${r.termination}`);
        }
        let response;
        try {
            response = JSON.parse(r.stdout);
        }
        catch {
            throw new Error(`invalid helper output: ${r.stderr}`);
        }
        if (r.exitCode !== 0 || response.ok !== true)
            throw new Error(`${response.code ?? 'IO_ERROR'}: ${response.error ?? r.stderr}`);
        return response;
    }
    async readFile(file: string, options: {
        maxBytes: number;
        signal?: AbortSignal;
    }) { const max = finite(options.maxBytes, 1, 16 * 1024 * 1024, 'read limit'); const result = await this.io({ op: 'read', path: this.mapped(file), maxBytes: max }, options.signal, Math.max(1024, Math.ceil(max * 4 / 3) + 1024)); return Buffer.from(result.data, 'base64'); }
    async access(file: string, mode: 'read' | 'read-write', signal?: AbortSignal) { await this.io({ op: 'access', path: this.mapped(file), mode }, signal); }
    async writeFile(file: string, content: Buffer | string, signal?: AbortSignal) { const data = Buffer.from(content); if (data.length > 16 * 1024 * 1024)
        throw new Error('write exceeds limit'); await this.io({ op: 'write', path: this.mapped(file), data: data.toString('base64') }, signal); }
    async mkdir(file: string, signal?: AbortSignal) { await this.io({ op: 'mkdir', path: this.mapped(file) }, signal); }
    close(): Promise<CleanupResult> {
        this.closed = true;
        this.closing ??= this.cleanup();
        // A later in-flight native failure must also override an earlier cached
        // positive container removal; callers cannot use it as clean settlement.
        return this.closing.then(result => this.nativeCleanupUnknown ?
            { state: 'quarantined', containerId: this.containerId, reason: this.nativeCleanupUnknown.reason } : result);
    }
    private async confirmedRemoval() { try {
        const saved = JSON.parse(await fs.readFile(this.journal, 'utf8'));
        return !saved.nativeCleanupUnknown && !this.nativeCleanupUnknown && saved.state === 'removed' && saved.context === this.config.dockerContext && saved.dockerConfigDirectory === this.config.dockerConfigDirectory && saved.id === this.containerId && saved.nonce === this.nonce && saved.workId === this.config.workId && saved.runId === this.config.runId;
    }
    catch {
        return false;
    } }
    private async cleanup(): Promise<CleanupResult> {
        if (await this.confirmedRemoval())
            return { state: 'removed', containerId: this.containerId };
        try {
            let item = await this.inspect();
            if (item.State.Running) {
                await this.docker(['stop', '--time', '2', this.containerId], { timeoutMs: 10000 });
                item = await this.inspect();
                if (item.State.Running) {
                    await this.docker(['kill', this.containerId]);
                    item = await this.inspect();
                }
            }
            if (item.State.Running)
                throw new Error('scope remains running');
            const removed = await this.docker(['rm', this.containerId]);
            if (removed.exitCode !== 0)
                throw new Error(`remove failed: ${removed.stderr}`);
            if (this.nativeCleanupUnknown) {
                const reason = this.nativeCleanupUnknown.reason;
                await this.record('quarantined', reason);
                return { state: 'quarantined', containerId: this.containerId, reason };
            }
            await this.record('removed');
            return { state: 'removed', containerId: this.containerId };
        }
        catch (error) {
            if (await this.confirmedRemoval())
                return { state: 'removed', containerId: this.containerId };
            const reason = String(error);
            await this.record('quarantined', reason);
            return { state: 'quarantined', containerId: this.containerId, reason };
        }
    }
}
export async function createScope(config: ScopeConfig): Promise<ContainerScope> {
    if (config.signal?.aborted)
        throw new Error('scope creation aborted');
    config = { ...config, ...await validateRuntimeProfile(config) };
    const dockerBinary = config.dockerBinary;
    identity(config.workId);
    identity(config.runId);
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(config.dockerContext))
        throw new Error('explicit Docker context required');
    if (!/^(?:[^\s]+@)?sha256:[a-f0-9]{64}$/.test(config.image))
        throw new Error('immutable image ID/digest required');
    const workRoot = await fs.realpath(config.workRoot), stateRoot = await fs.realpath(config.stateRoot);
    const stateStat = await fs.stat(stateRoot);
    if (!stateStat.isDirectory() || stateStat.uid !== process.getuid?.() || (stateStat.mode & 0o022) !== 0)
        throw new Error('state root must be controller-owned and not writable by others');
    if (!(await fs.stat(workRoot)).isDirectory())
        throw new Error('work root must be a directory');
    if (inside(os.homedir(), workRoot))
        throw new Error('workspace must not contain host home/auth root');
    if (inside(stateRoot, workRoot) || inside(workRoot, stateRoot))
        throw new Error('state and work roots must be disjoint');
    const inputRoot = config.inputRoot ? await fs.realpath(config.inputRoot) : undefined;
    if (inputRoot && !(await fs.stat(inputRoot)).isDirectory())
        throw new Error('input root must be a directory');
    if (inputRoot && inside(os.homedir(), inputRoot))
        throw new Error('input must not contain host home/auth root');
    if (inputRoot && (inside(stateRoot, inputRoot) || inside(inputRoot, stateRoot) || inside(inputRoot, workRoot) || inside(workRoot, inputRoot)))
        throw new Error('input, work and state roots must be disjoint');
    const uid = finite(config.uid ?? 1000, 1, 2 ** 31 - 1, 'uid'), gid = finite(config.gid ?? 1000, 1, 2 ** 31 - 1, 'gid');
    if (!Number.isInteger(uid) || !Number.isInteger(gid))
        throw new Error('uid/gid must be integers');
    const memory = finite(config.memoryMiB ?? 512, 32, 65536, 'memory'), cpus = finite(config.cpus ?? 1, 0.1, 64, 'cpu'), pids = finite(config.pidsLimit ?? 128, 8, 4096, 'pids'), scratch = finite(config.scratchMiB ?? 64, 1, 4096, 'scratch');
    finite(config.maxOutputBytes ?? 2 * 1024 * 1024, 1024, 32 * 1024 * 1024, 'output');
    finite(config.defaultTimeoutMs ?? 60000, 1, 3600000, 'timeout');
    // A bind carries existing socket/device inodes too: network-none alone does not
    // prevent an AF_UNIX relay through an ordinary project directory.
    let scanned = 0;
    async function validateBindTree(root: string): Promise<void> {
        const directory = await fs.opendir(root);
        for await (const entry of directory) {
            if (++scanned > 100000)
                throw new Error('bound input population exceeds initial profile');
            const candidate = path.join(root, entry.name), stat = await fs.lstat(candidate);
            if (stat.isSymbolicLink() || stat.isFile())
                continue;
            if (stat.isDirectory())
                await validateBindTree(candidate);
            else
                throw new Error('preexisting socket/device/special file in bound root unsupported');
        }
    }
    await validateBindTree(workRoot);
    if (inputRoot)
        await validateBindTree(inputRoot);
    const mounts: string[] = [], mountSources: string[] = [];
    const mount = (source: string, target: string, ro: boolean) => { if (source.includes(',') || target.includes(','))
        throw new Error('mount path comma unsupported'); mountSources.push(source); mounts.push('--mount', `type=bind,source=${source},target=${target}${ro ? ',readonly' : ''}`); };
    mount(workRoot, '/work', !!config.readOnlyWork);
    if (inputRoot)
        mount(inputRoot, '/input', true);
    let entries = 0;
    async function validateProtected(target: string, root: string): Promise<void> { if (++entries > 10000)
        throw new Error('protected population exceeds initial profile'); const stat = await fs.lstat(target); if (stat.isSymbolicLink()) {
        const resolved = await fs.realpath(target);
        if (!inside(resolved, root))
            throw new Error('protected subtree outward symlink unsupported');
        return;
    } if (stat.isFile()) {
        if (stat.nlink > 1)
            throw new Error('protected hardlink aliases unsupported');
        return;
    } if (!stat.isDirectory())
        throw new Error('protected special file unsupported'); for (const child of await fs.readdir(target))
        await validateProtected(path.join(target, child), root); }
    for (const name of config.protectedPaths ?? []) {
        const lexical = path.resolve(workRoot, name);
        if (!inside(lexical, workRoot) || lexical === workRoot)
            throw new Error('invalid protected path');
        const target = await fs.realpath(lexical);
        if (!inside(target, workRoot))
            throw new Error('protected target outside workspace');
        await validateProtected(target, target);
        mount(target, '/work/' + path.relative(workRoot, target), true);
    }
    const nonce = randomUUID(), name = `gitjig-${nonce}`, journal = path.join(stateRoot, `${nonce}.json`);
    const original = { version: 1, context: config.dockerContext, ...(config.dockerConfigDirectory ? { dockerConfigDirectory: config.dockerConfigDirectory } : {}), name, nonce, workId: config.workId, runId: config.runId };
    let binding: CreationBinding = { version: 1, state: 'UNAVAILABLE', reason: 'Original daemon binding not yet confirmed' };
    await journalWrite(journal, { ...original, state: 'creating', creationBinding: binding }, true);
    if (inside(dockerBinary, workRoot) || (inputRoot && inside(dockerBinary, inputRoot)))
        throw new Error('Docker client must not be project controlled');
    const normalized: ScopeConfig = { ...config, workRoot, stateRoot };
    if (inputRoot)
        normalized.inputRoot = inputRoot;
    const docker = (args: string[]) => processRun(config.dockerBinary, [...dockerRoute(config.dockerConfigDirectory), '--context', config.dockerContext, ...args]);
    let before: DaemonObservation;
    try {
        before = await observeDaemon(config.dockerBinary, config.dockerConfigDirectory, config.dockerContext, config.signal);
    }
    catch (error) {
        if (error instanceof NativeCleanupError)
            try {
                await journalWrite(journal, { ...original, state: 'quarantined', creationBinding: binding, nativeCleanupUnknown: error.checkpoint, reason: error.message });
            }
            catch (persistenceError) {
                error.checkpoint.persistenceFailure = String(persistenceError);
                error.cause = persistenceError;
            }
        throw error;
    }
    if (before.state === 'changed') {
        await journalWrite(journal, { ...original, id: '', state: 'removed', reason: 'Docker route changed before native allocation', creationBinding: binding });
        throw Error('Docker route changed before native allocation');
    }
    if (before.state === 'unavailable')
        binding = { version: 1, state: 'UNAVAILABLE', reason: before.reason };
    if (config.signal?.aborted) {
        await journalWrite(journal, { ...original, id: '', state: 'removed', reason: 'aborted-before-create', creationBinding: binding });
        throw new Error('scope creation aborted before allocation');
    }
    let created: ExecutionResult;
    try {
        created = await docker(['create', '--name', name, '--label', `gitjig.scope=${nonce}`, '--label', `gitjig.work=${config.workId}`, '--label', `gitjig.run=${config.runId}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', String(pids), '--memory', `${memory}m`, '--cpus', String(cpus), '--user', `${uid}:${gid}`, '--tmpfs', `/scratch:rw,nosuid,nodev,size=${scratch}m,mode=1777`, '--tmpfs', `/tmp:rw,nosuid,nodev,size=${scratch}m,mode=1777`, ...mounts, '--workdir', '/work', '--entrypoint', '/usr/local/bin/node', config.image, '-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]);
    }
    catch (error) {
        if (error instanceof NativeCleanupError)
            try {
                await journalWrite(journal, { ...original, state: 'quarantined', creationBinding: binding, nativeCleanupUnknown: error.checkpoint, reason: error.message });
            }
            catch (persistenceError) {
                error.checkpoint.persistenceFailure = String(persistenceError);
                error.cause = persistenceError;
            }
        throw error;
    }
    const id = created.stdout.trim();
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(id)) {
        const createRejection = classifyCreateRejection(created, mountSources);
        await journalWrite(journal, {
            ...original,
            state: createRejection ? 'removed' : 'quarantined',
            reason: created.stderr,
            creationBinding: binding,
            createOutcome: created,
            ...(createRejection ? { createRejection } : {}),
        });
        throw new Error(`scope create uncertain/failed; retained ${journal}: ${created.stderr}`);
    }
    // The full ID is durable only after the actual create process has closed.
    await journalWrite(journal, { ...original, id, state: 'created', creationBinding: binding });
    let scope = new ContainerScope(normalized, id, nonce, journal, binding);
    try {
        const after = before.state === 'observed' ? await observeDaemon(config.dockerBinary, config.dockerConfigDirectory, config.dockerContext, config.signal) : before;
        if (after.state === 'changed' || before.state === 'observed' && after.state === 'observed' &&
            (before.id !== after.id || JSON.stringify(before.routeIdentity) !== JSON.stringify(after.routeIdentity)))
            throw Error('Docker route or daemon changed during scope creation');
        if (before.state === 'observed' && after.state === 'observed')
            binding = { version: 1, state: 'VERIFIED', client: config.dockerBinary,
                daemonId: before.id, routeIdentity: before.routeIdentity, scopeHash: scopeHash({ ...original, id }), createSettled: true };
        else if (after.state === 'unavailable')
            binding = { version: 1, state: 'UNAVAILABLE', reason: after.reason };
        scope = new ContainerScope(normalized, id, nonce, journal, binding);
        await journalWrite(journal, { ...original, id, state: 'created', creationBinding: binding });
        if (config.signal?.aborted)
            throw new Error('scope creation aborted before start');
        const started = await docker(['start', id]);
        if (config.signal?.aborted)
            throw new Error('scope creation aborted after start');
        if (started.exitCode !== 0)
            throw new Error(`scope start failed: ${started.stderr}`);
    }
    catch (error) {
        await scope.retainNativeCleanup(error);
        try {
            await scope.close();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Scope creation and owned cleanup failed');
        }
        throw error;
    }
    return scope;
}
/** Reconcile one controller-owned journal after a crash; never broad engine cleanup. */
export async function reconcileScope(journal: string, dockerBinary: string, dockerConfigDirectory?: string): Promise<CleanupResult> {
    dockerBinary = await trustedDockerBinary(dockerBinary);
    const saved = JSON.parse(await fs.readFile(journal, 'utf8'));
    if (saved.version !== 1 || !saved.context || !saved.nonce || !saved.workId || !saved.runId)
        throw new Error('invalid scope journal');
    identity(saved.workId);
    identity(saved.runId);
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(saved.context) || !/^[a-f0-9-]{36}$/.test(saved.nonce))
        throw new Error('invalid retained scope identity');
    if (saved.nativeCleanupUnknown)
        return { state: 'quarantined', containerId: saved.id ?? saved.name, reason: 'Original native process cleanup remains unconfirmed; inspect retained nativeCleanupUnknown checkpoint' };
    if (saved.state === 'removed')
        return { state: 'removed', containerId: saved.id ?? '' };
    if (dockerConfigDirectory !== undefined)
        dockerConfigDirectory = await trustedDockerConfiguration(dockerConfigDirectory);
    if (saved.dockerConfigDirectory !== dockerConfigDirectory)
        throw Error('Retained Docker configuration route differs; restore its selected setup before reconciliation');
    const binding = creationBinding(saved);
    const reference = saved.id ?? saved.name;
    if (!reference || (!/^[a-f0-9]{64}$/.test(reference) && reference !== `gitjig-${saved.nonce}`))
        throw new Error('invalid retained scope reference');
    const inspected = await processRun(dockerBinary, [...dockerRoute(dockerConfigDirectory), '--context', saved.context, 'inspect', reference]);
    if (inspected.exitCode !== 0) {
        let absence;
        try {
            absence = await absentKnownScope(saved, binding, dockerBinary, dockerConfigDirectory);
        }
        catch { /* No complete affirmative observation. */ }
        if (absence) {
            await journalWrite(journal, { ...saved, state: 'removed', absenceEvidence: absence, reason: 'Known container ID absent on original daemon' });
            return { state: 'removed', containerId: saved.id };
        }
        await journalWrite(journal, { ...saved, state: 'quarantined', reason: 'retained scope not conclusively inspected' });
        return { state: 'quarantined', containerId: saved.id ?? '', reason: 'retained scope not conclusively inspected' };
    }
    const item = JSON.parse(inspected.stdout)[0];
    if (saved.id && item?.Id !== saved.id || item?.Config?.Labels?.['gitjig.scope'] !== saved.nonce || item?.Config?.Labels?.['gitjig.work'] !== saved.workId || item?.Config?.Labels?.['gitjig.run'] !== saved.runId)
        throw new Error('retained scope ownership mismatch');
    return new ContainerScope({ dockerContext: saved.context, dockerBinary, ...(dockerConfigDirectory ? { dockerConfigDirectory } : {}), image: item.Image, workRoot: '/unavailable', stateRoot: path.dirname(journal), workId: saved.workId, runId: saved.runId }, item.Id, saved.nonce, journal, binding).close();
}

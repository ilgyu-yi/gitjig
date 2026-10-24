import { validateDependencyLinks } from '../controller/capture-links.js';
import fs from 'node:fs/promises';
import fsSync, { constants } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { acceptanceContextResources, type CreatedAcceptanceContext } from '../platform/hosted-context.js';
import { privateDirectory } from '../controller/ownership.js';
import { effective } from '../controller/change-files.js';
import { freeze } from '../controller/change-files.js';
import type { Manifest } from '../controller/capture.js';
import type { CapturedTree, NativeGitProfile, ObjectFormat, LocalBareTarget, GitFile, CommandReceipt, ProjectionInput, ProjectionResult, IntegrationResult, ForwardSend, PreparedForwardSend, SendReceipt, LocalRefObservation, ForwardReconciliation } from './types.js';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const contains = (root: string, target: string) => target === root || target.startsWith(root + path.sep);
const text = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
/** Affirmative factory outcome: this invocation constructed no client and launched no owned command. */
export class NativeGitNotAllocatedError extends Error {
    constructor(readonly clientRoot: string, cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
}
export class NativeGitCleanupError extends Error {
    readonly code = 'NATIVE_GIT_CLEANUP_UNKNOWN';
    constructor(readonly recovery: string, cause: unknown) { super('Owned Git cleanup UNKNOWN; ' + recovery, { cause }); }
}
const EMPTY = Buffer.alloc(0);
type BytesFile = GitFile & {
    bytes: Buffer;
};
type Run = {
    receipt: CommandReceipt;
    bytes: Buffer;
};
const positive = (value: number | undefined, fallback: number, max: number, name: string) => {
    const chosen = value ?? fallback;
    if (!Number.isSafeInteger(chosen) || chosen < 1 || chosen > max)
        throw new Error(`Invalid finite Git ${name}`);
    return chosen;
};
/** Definite rejection is one complete native porcelain result, never exit/stderr inference. */
function sendTransport(command: CommandReceipt, integration: string, ref: string): SendReceipt['transport'] {
    const complete = command.settled && !command.aborted && !command.timedOut && !command.truncated;
    if (!complete)
        return 'uncertain';
    if (command.exitCode === 0)
        return 'native-success';
    if (command.stdoutExcerpted)
        return 'uncertain';
    const lines = command.stdout.split('\n').filter(line => line.length > 0);
    const rows = lines.filter(line => line.includes('\t'));
    if (typeof command.exitCode !== 'number' || rows.length !== 1 || lines.at(-1) !== 'Done')
        return 'uncertain';
    const row = rows[0]!.split('\t');
    return row.length === 3 && row[0] === '!' && row[1] === `${integration}:${ref}` && /^(\[rejected\]|\[remote rejected\])(?: |$)/.test(row[2]!) ? 'native-rejection' : 'uncertain';
}
function relativeFile(value: string): void {
    if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..') || value.includes('\\'))
        throw new Error('Unsupported publication path');
    // Match Git's protectNTFS/protectHFS spellings of .git, not only the literal name.
    if (value.split('/').some(p => { const name = p.replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '').toLowerCase(); return /^(\.git|git~\d+)[. ]*(:|$)/.test(name); }))
        throw new Error('Git administration is not publication product');
}
/** Object IDs of `ls-remote --refs` rows naming exactly `ref`; undefined for malformed output. */
function exactRefRows(output: string, ref: string): string[] | undefined {
    const rows = output.trim() ? output.trim().split('\n').map(row => row.split('\t')) : [];
    if (rows.some(fields => fields.length !== 2 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(fields[0]!) || !fields[1] || /[\r\0]/.test(fields[1])))
        return undefined;
    return rows.filter(fields => fields[1] === ref).map(fields => fields[0]!);
}
function sameTarget(a: LocalBareTarget, b: LocalBareTarget) {
    return a.targetId === b.targetId && a.canonicalPath === b.canonicalPath && a.device === b.device && a.inode === b.inode && a.ownerUid === b.ownerUid && a.objectFormat === b.objectFormat && a.ref === b.ref;
}
interface PolicyIdentity {
    configHash: string;
    hooksHash: string;
}
interface PreparedCommand {
    directory: string;
    descriptor: string;
    argv: string[];
    signal: AbortSignal;
    commandId: string;
    maxBytes: number;
    auth?: Buffer;
}
interface Prepared {
    input: ForwardSend;
    signal: AbortSignal;
    policy: PolicyIdentity;
    used: boolean;
    command: PreparedCommand;
}
/** Native plumbing only. No effect authority, evidence selection, retries or ledger writer. */
class OwnedNativeGit {
    readonly objectFormat: ObjectFormat;
    readonly gitBinary: string;
    readonly root: string;
    private readonly repo: string;
    private readonly home: string;
    private readonly hooks: string;
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly timeout: number;
    private readonly outputLimit: number;
    private readonly operationTimeout: number;
    private readonly env: NodeJS.ProcessEnv;
    private readonly shutdown = new AbortController();
    private readonly prepared = new WeakMap<PreparedForwardSend, Prepared>();
    private closed = false;
    private closeResult: Promise<void> | undefined;
    private readonly running = new Set<Promise<unknown>>();
    private readonly unlaunched = new Set<PreparedCommand>();
    constructor(profile: NativeGitProfile, binary: string, private readonly https?: OwnedHttpsOptions) {
        this.root = profile.ownedClientRoot;
        this.repo = path.join(this.root, 'client.git');
        this.home = path.join(this.root, 'home');
        this.hooks = path.join(this.root, 'no-hooks');
        this.gitBinary = binary;
        this.objectFormat = profile.objectFormat ?? 'sha1';
        if (!['sha1', 'sha256'].includes(this.objectFormat))
            throw new Error('Unsupported Git object format');
        this.maxEntries = positive(profile.maxEntries, 100000, 100000, 'entries');
        this.maxBytes = positive(profile.maxBytes, 512 * 1024 * 1024, 512 * 1024 * 1024, 'bytes');
        this.timeout = positive(profile.commandTimeoutMs, 10000, 120000, 'timeout');
        this.operationTimeout = positive(profile.operationTimeoutMs, 30000, 120000, 'phase timeout');
        this.outputLimit = positive(profile.maxOutputBytes, 1024 * 1024, 16 * 1024 * 1024, 'output');
        // Allowlists, not process.env minus some known spellings. Git's own
        // installed helpers may use these fixed system/tool directories only.
        this.env = { PATH: `${path.dirname(binary)}:/usr/bin:/bin`, HOME: this.home, XDG_CONFIG_HOME: this.home, LANG: 'C', LC_ALL: 'C',
            GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1',
            GIT_AUTHOR_NAME: 'Gitjig owned projection', GIT_AUTHOR_EMAIL: 'projection@example.invalid',
            GIT_COMMITTER_NAME: 'Gitjig owned projection', GIT_COMMITTER_EMAIL: 'projection@example.invalid',
            GIT_AUTHOR_DATE: new Date().toISOString(), GIT_COMMITTER_DATE: '' };
        this.env.GIT_COMMITTER_DATE = this.env.GIT_AUTHOR_DATE;
    }
    private args(args: readonly string[], repo = this.repo): string[] {
        return [`--git-dir=${repo}`, '-c', `core.hooksPath=${this.hooks}`, '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false',
            '-c', 'core.pager=cat', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'protocol.allow=never',
            '-c', 'protocol.file.allow=always', '-c', 'submodule.recurse=false', '-c', 'fetch.recurseSubmodules=false',
            '-c', 'core.attributesFile=/dev/null', ...args];
    }
    private finite(signal?: AbortSignal): AbortSignal { return AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.operationTimeout), ...(signal ? [signal] : [])]); }
    private assertOpen() {
        if (this.closed)
            throw new Error('Owned Git client is closed');
    }
    private oid(value: string): string {
        if (!(this.objectFormat === 'sha1' ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/).test(value))
            throw new Error('Malformed Git object identity');
        return value;
    }
    private async prepareCommand(args: readonly string[], signal: AbortSignal, stdin: Buffer | undefined, maxBytes: number, repo?: string, authenticated = false): Promise<PreparedCommand> {
        this.assertOpen();
        signal.throwIfAborted();
        const commandId = randomUUID(), directory = path.join(this.root, 'runs', commandId), argv = this.args(args, repo);
        if (authenticated) {
            if (!this.https)
                throw Error('Native HTTPS profile unavailable');
            argv.splice(argv.length - args.length, 0, '-c', 'protocol.file.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'core.fsmonitor=false', '-c', 'http.extraHeader=', '--config-env=http.extraHeader=GITJIG_HTTP_AUTH', ...(this.https.caFile ? ['-c', `http.sslCAInfo=${this.https.caFile}`] : []));
        }
        const runRoot = path.dirname(directory), runStat = await fs.lstat(runRoot);
        if (!runStat.isDirectory() || runStat.isSymbolicLink() || runStat.uid !== process.getuid?.() || (runStat.mode & 0o077) || await fs.realpath(runRoot) !== runRoot)
            throw new Error('Owned command namespace changed');
        await privateDirectory(directory);
        const input = stdin ?? EMPTY, descriptor = path.join(directory, 'descriptor.json');
        const write = async (file: string, bytes: Buffer | string) => {
            const handle = await fs.open(path.join(directory, file), 'wx', 0o600);
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
        };
        await write('stdin.bin', input);
        await write('descriptor.json', JSON.stringify({ version: 1, parentPid: process.pid, commandId, directory, binary: this.gitBinary, argv, cwd: this.root, env: authenticated ? { ...this.env, GIT_EXEC_PATH: this.https!.execPath } : this.env, ...(authenticated ? { authProfile: 'fd4-config-env-v1' } : {}), timeoutMs: this.timeout, maxStdout: maxBytes, excerptBytes: this.outputLimit, inputBytes: input.length, inputSha256: digest(input) }));
        const admissionDirectory = await fs.open(directory, 'r');
        try {
            await admissionDirectory.sync();
        }
        finally {
            await admissionDirectory.close();
        }
        if (signal.aborted || this.closed) {
            await write('terminal.json', JSON.stringify({ commandId, producer: 'controller-no-launch', pid: null, gitPid: null, gitStarted: false, cleanup: 'confirmed' }));
            signal.throwIfAborted();
            throw new Error('Owned Git client closed before launcher');
        }
        const command: PreparedCommand = { directory, descriptor, argv, signal, commandId, maxBytes, ...(authenticated ? { auth: Buffer.from(this.https!.token) } : {}) };
        this.unlaunched.add(command);
        return command;
    }
    private noLaunch(command: PreparedCommand): void {
        const file = path.join(command.directory, 'terminal.json');
        if (!fsSync.existsSync(file)) {
            const fd = fsSync.openSync(file, 'wx', 0o600);
            try {
                fsSync.writeFileSync(fd, JSON.stringify({ commandId: command.commandId, producer: 'controller-no-launch', pid: null, gitPid: null, gitStarted: false, cleanup: 'confirmed' }));
                fsSync.fsyncSync(fd);
            }
            finally {
                fsSync.closeSync(fd);
            }
        }
        command.auth?.fill(0);
        this.unlaunched.delete(command);
    }
    private launch(command: PreparedCommand): Promise<Run> {
        this.assertOpen();
        command.signal.throwIfAborted();
        // Exact final handoff is this synchronous installed LAUNCHER spawn.
        // Actual Git start is separately journalled by that supervisor.
        const child = spawn(process.execPath, [fileURLToPath(new URL('./git-process-child.js', import.meta.url)), command.descriptor], { cwd: this.root, env: this.env, stdio: command.auth ? ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'] : ['ignore', 'ignore', 'pipe', 'ipc'] });
        if (command.auth) {
            const pipe = child.stdio[4] as import('node:stream').Writable;
            pipe.on('error', () => {
                if (child.connected)
                    child.send({ type: 'cancel' }, () => { });
            });
            const frame = Buffer.alloc(4 + command.auth.length);
            frame.writeUInt32BE(command.auth.length);
            command.auth.copy(frame, 4);
            pipe.end(frame, () => frame.fill(0));
            command.auth.fill(0);
            delete command.auth;
        }
        this.unlaunched.delete(command);
        const result = new Promise<Run>(resolve => {
            let errors = '', forced: NodeJS.Timeout | undefined, done = false;
            const abort = () => {
                if (child.connected)
                    child.send({ type: 'cancel' }, () => { });
            };
            command.signal.addEventListener('abort', abort, { once: true });
            const finish = async () => {
                if (done)
                    return;
                done = true;
                if (forced)
                    clearTimeout(forced);
                command.signal.removeEventListener('abort', abort);
                try {
                    const rawBytes = await this.boundedFile(path.join(command.directory, 'result.json'), this.outputLimit * 2 + 65536);
                    const raw = JSON.parse(text(rawBytes));
                    const bytes = await this.boundedFile(path.join(command.directory, 'stdout.bin'), command.maxBytes);
                    const identity = raw.identity;
                    if (identity.commandId !== command.commandId || identity.pid !== child.pid || raw.cleanup !== 'confirmed' && raw.cleanup !== 'unknown' || raw.stdoutBytes < bytes.length || raw.stdoutSha256 !== digest(bytes) && !raw.truncated)
                        throw new Error('Supervisor result identity/output mismatch');
                    const ack = await fs.open(path.join(command.directory, 'parent-closed.json'), 'wx', 0o600);
                    try {
                        await ack.writeFile(JSON.stringify({ commandId: command.commandId, pid: child.pid, resultHash: digest(rawBytes) }));
                        await ack.sync();
                    }
                    finally {
                        await ack.close();
                    }
                    resolve({ bytes, receipt: { ...(raw.sanitizedAuthDiagnostics === true ? { sanitizedAuthDiagnostics: true as const } : {}), argv: command.argv, exitCode: raw.exitCode, stdout: raw.stdout, stderr: raw.stderr, truncated: raw.truncated, timedOut: raw.timedOut, aborted: raw.aborted, settled: raw.settled && raw.cleanup === 'confirmed', stdoutBytes: raw.stdoutBytes, stdoutSha256: raw.stdoutSha256, stdoutExcerpted: raw.stdoutExcerpted, commandId: command.commandId, journalPath: command.directory, launcherPid: child.pid ?? null, gitPid: raw.gitPid, gitStarted: raw.gitStarted, cleanup: raw.cleanup } });
                }
                catch (error) {
                    resolve({ bytes: EMPTY, receipt: { argv: command.argv, exitCode: null, stdout: '', stderr: errors + ' Supervisor outcome unavailable: ' + String(error), truncated: false, timedOut: false, aborted: command.signal.aborted, settled: false, stdoutBytes: 0, stdoutSha256: digest(EMPTY), stdoutExcerpted: false, commandId: command.commandId, journalPath: command.directory, launcherPid: child.pid ?? null, gitPid: null, gitStarted: false, cleanup: 'unknown' } });
                }
            };
            child.stderr!.on('data', (bytes: Buffer) => {
                if (errors.length < this.outputLimit)
                    errors += bytes.toString('utf8');
            });
            child.once('error', error => { errors += String(error); });
            child.once('close', () => void finish());
            // The supervisor owns its Git deadline even after controller death.
            // Parent fallback reports UNKNOWN; it does not kill the supervisor
            // and orphan its separately owned native process group.
            forced = setTimeout(() => { abort(); void finish(); }, this.timeout + 4000);
            if (command.signal.aborted)
                abort();
        });
        this.running.add(result);
        void result.then(() => this.running.delete(result), () => this.running.delete(result));
        return result;
    }
    private start(args: readonly string[], signal?: AbortSignal, stdin?: Buffer, maxBytes = this.outputLimit, repo?: string): Promise<Run> {
        const combined = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
        const result = (async () => this.launch(await this.prepareCommand(args, combined, stdin, maxBytes, repo)))();
        this.running.add(result);
        void result.then(() => this.running.delete(result), () => this.running.delete(result));
        return result;
    }
    private async run(args: readonly string[], commands: CommandReceipt[], signal?: AbortSignal, stdin?: Buffer, limit?: number, repo?: string): Promise<Buffer> {
        const result = await this.start(args, signal, stdin, limit, repo);
        commands.push(result.receipt);
        if (result.receipt.exitCode !== 0 || result.receipt.truncated || !result.receipt.settled || result.receipt.timedOut || result.receipt.aborted)
            throw new Error(`Native Git command unavailable: ${args[0]} (${result.receipt.exitCode}): ${result.receipt.stderr}`);
        return result.bytes;
    }
    async initialize(resume = false, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        await privateDirectory(this.root);
        if (resume) {
            await this.validateOwnedClient();
            return;
        }
        if ((await fs.readdir(this.root)).length)
            throw new Error('Owned Git client directory must be empty');
        for (const directory of [this.home, this.hooks, path.join(this.root, 'runs')])
            await privateDirectory(directory);
        const commands: CommandReceipt[] = [];
        const version = await this.run(['--version'], commands, signal);
        if (!/^git version 2\.55\.[0-9]+(?:\s|$)/.test(text(version)))
            throw new Error('Initial native Git profile requires observed Git2.55.x');
        await this.run(['init', '--bare', '--template=', `--object-format=${this.objectFormat}`, this.repo], commands, signal);
        signal?.throwIfAborted();
        await fs.mkdir(path.join(this.repo, 'info'), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(this.repo, 'info', 'attributes'), '* merge=text\n', { flag: 'wx', mode: 0o600 });
        const identity = await this.clientIdentity();
        await fs.writeFile(path.join(this.root, 'native-owner.json'), JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
    }
    private async clientIdentity() {
        const root = await fs.lstat(this.root), repo = await fs.lstat(this.repo), binary = await fs.stat(this.gitBinary);
        return { version: 1, root: this.root, rootDevice: String(root.dev), rootInode: String(root.ino), repoDevice: String(repo.dev), repoInode: String(repo.ino), gitBinary: this.gitBinary, binaryDevice: String(binary.dev), binaryInode: String(binary.ino), objectFormat: this.objectFormat, metadataDate: this.env.GIT_AUTHOR_DATE, configHash: digest(await this.boundedFile(path.join(this.repo, 'config'), 256 * 1024)), attributesHash: digest(await this.boundedFile(path.join(this.repo, 'info', 'attributes'), 1024)) };
    }
    private async validateOwnedClient() {
        const names = (await fs.readdir(this.root)).sort();
        if (JSON.stringify(names) !== JSON.stringify(['client.git', 'home', 'native-owner.json', 'no-hooks', 'runs']))
            throw new Error('Owned Git root inventory changed');
        for (const directory of [this.home, this.hooks, path.join(this.root, 'runs')]) {
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || await fs.realpath(directory) !== directory)
                throw new Error('Owned Git support directory changed');
        }
        if ((await fs.readdir(this.hooks)).length || (await fs.readdir(this.home)).length)
            throw new Error('Owned Git support resources changed');
        const repo = await fs.lstat(this.repo);
        if (!repo.isDirectory() || repo.isSymbolicLink() || repo.uid !== process.getuid?.() || (repo.mode & 0o022) || await fs.realpath(this.repo) !== this.repo)
            throw new Error('Owned bare client identity changed');
        const markerPath = path.join(this.root, 'native-owner.json'), markerStat = await fs.lstat(markerPath);
        if (markerStat.uid !== process.getuid?.() || (markerStat.mode & 0o077))
            throw new Error('Owned Git marker permissions changed');
        const marker = JSON.parse(text(await this.boundedFile(markerPath, 64 * 1024)));
        if (typeof marker.metadataDate !== 'string' || !Number.isFinite(Date.parse(marker.metadataDate)) || new Date(marker.metadataDate).toISOString() !== marker.metadataDate)
            throw new Error('Owned Git metadata date unavailable');
        this.env.GIT_AUTHOR_DATE = marker.metadataDate;
        this.env.GIT_COMMITTER_DATE = marker.metadataDate;
        if (JSON.stringify(marker) !== JSON.stringify(await this.clientIdentity()))
            throw new Error('Owned Git marker/config/binary identity mismatch');
        const recovery = await reconcileOwnedGitProcesses(this.root);
        if (recovery.cleanup !== 'confirmed')
            throw new Error('Owned Git subprocess cleanup UNKNOWN; client quarantined: ' + JSON.stringify(recovery));
        const commands: CommandReceipt[] = [];
        const version = text(await this.run(['--version'], commands));
        if (!/^git version 2\.55\.[0-9]+(?:\s|$)/.test(version))
            throw new Error('Native Git version changed');
        if (text(await this.run(['rev-parse', '--show-object-format'], commands)).trim() !== this.objectFormat)
            throw new Error('Owned Git format changed');
    }
    private async boundedFile(file: string, max: number): Promise<Buffer> {
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > max)
                throw new Error('Unsafe or oversized immutable regular input');
            const bytes = Buffer.alloc(stat.size + 1);
            let count = 0;
            while (count < bytes.length) {
                const read = await handle.read(bytes, count, bytes.length - count, count);
                if (!read.bytesRead)
                    break;
                count += read.bytesRead;
            }
            const after = await handle.stat();
            if (count !== stat.size || after.size !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs)
                throw new Error('Immutable input changed during read');
            return bytes.subarray(0, count);
        }
        finally {
            await handle.close();
        }
    }
    private async captured(input: CapturedTree, selected: Set<string>, signal?: AbortSignal): Promise<Map<string, BytesFile>> {
        signal?.throwIfAborted();
        if (!path.isAbsolute(input.root) || await fs.realpath(input.root) !== input.root)
            throw new Error('Capture root must be canonical');
        const stat = await fs.lstat(input.root);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o022))
            throw new Error('Capture root is not owned immutable storage');
        if (digest(JSON.stringify(effective(input.manifest))) !== input.digest)
            throw new Error('Capture digest disagrees with effective manifest');
        const links = input.manifest.dependencyLinks ?? [];
        validateDependencyLinks(links, input.manifest.files, input.manifest.directories);
        const linkTargets = new Map(links.map(link => [link.path, link.target]));
        if (links.some(link => selected.has(link.path)))
            throw Error('Dependency link publication unsupported');
        const expected = new Set([...input.manifest.files.map(f => f.path), ...input.manifest.directories.map(d => d.path), ...links.map(link => link.path)]);
        if (expected.size !== input.manifest.files.length + input.manifest.directories.length + links.length || expected.size > this.maxEntries)
            throw new Error('Capture census duplicate/limit');
        const actual = new Set<string>();
        const walk = async (directory: string, relative: string) => {
            for (const name of await fs.readdir(directory)) {
                signal?.throwIfAborted();
                const rel = relative ? `${relative}/${name}` : name;
                actual.add(rel);
                if (!expected.has(rel) || actual.size > this.maxEntries)
                    throw new Error('Capture census changed');
                const entry = await fs.lstat(path.join(directory, name));
                if (entry.isSymbolicLink()) {
                    if (!linkTargets.has(rel) || await fs.readlink(path.join(directory, name)) !== linkTargets.get(rel))
                        throw new Error('Capture dependency link changed');
                    continue;
                }
                if (linkTargets.has(rel))
                    throw Error('Capture dependency link replaced');
                if (entry.isDirectory())
                    await walk(path.join(directory, name), rel);
                else if (!entry.isFile())
                    throw new Error('Capture special file unsupported');
            }
        };
        await walk(input.root, '');
        if (actual.size !== expected.size)
            throw new Error('Capture census incomplete');
        const result = new Map<string, BytesFile>();
        let total = 0;
        for (const entry of input.manifest.files) {
            signal?.throwIfAborted();
            // Metadata may legitimately occur in capture. Only selected product
            // paths undergo publication-path/text validation.
            if (!entry.path || path.isAbsolute(entry.path) || entry.path.split('/').some(v => !v || v === '.' || v === '..'))
                throw new Error('Invalid capture path');
            const bytes = await this.boundedFile(path.join(input.root, entry.path), this.maxBytes - total);
            total += bytes.length;
            const actualStat = await fs.lstat(path.join(input.root, entry.path));
            if (bytes.length !== entry.size || digest(bytes) !== entry.sha256 || !!(actualStat.mode & 0o111) !== !!(entry.effectiveMode & 0o111))
                throw new Error('Captured bytes/mode changed');
            if (selected.has(entry.path)) {
                relativeFile(entry.path);
                if (bytes.includes(0))
                    throw new Error('Binary publication unsupported');
                text(bytes);
                result.set(entry.path, { path: entry.path, mode: entry.effectiveMode & 0o111 ? '100755' : '100644', blob: '', sha256: entry.sha256, size: bytes.length, bytes });
            }
        }
        return result;
    }
    private async makeTree(files: Map<string, BytesFile>, commands: CommandReceipt[], signal?: AbortSignal): Promise<string> {
        if (files.size > this.maxEntries)
            throw new Error('Publication entry limit');
        const nested = new Map<string, Map<string, {
            mode: string;
            kind: string;
            oid: string;
        }>>();
        nested.set('', new Map());
        for (const file of files.values()) {
            relativeFile(file.path);
            const parts = file.path.split('/'), name = parts.pop()!, parent = parts.join('/');
            let dir = '';
            for (const part of parts) {
                const next = dir ? `${dir}/${part}` : part;
                nested.get(dir)!.set(part, { mode: '040000', kind: 'tree', oid: next });
                if (!nested.has(next))
                    nested.set(next, new Map());
                dir = next;
            }
            if (nested.get(parent)!.has(name))
                throw new Error('File/directory publication collision');
            const blob = this.oid(text(await this.run(['hash-object', '-w', '--stdin'], commands, signal, file.bytes)).trim());
            nested.get(parent)!.set(name, { mode: file.mode, kind: 'blob', oid: blob });
        }
        const build = async (directory: string): Promise<string> => {
            const rows: Buffer[] = [];
            for (const [name, item] of nested.get(directory)!) {
                const oid = item.kind === 'tree' ? await build(item.oid) : item.oid;
                rows.push(Buffer.concat([Buffer.from(`${item.mode} ${item.kind} ${oid}\t`), Buffer.from(name), Buffer.from([0])]));
            }
            return this.oid(text(await this.run(['mktree', '-z'], commands, signal, Buffer.concat(rows))).trim());
        };
        return build('');
    }
    private operationId(value: string): string {
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value))
            throw new Error('Invalid host operation identity');
        return value;
    }
    private async operationCommit(commit: string, operationId: string, commands: CommandReceipt[], signal?: AbortSignal): Promise<void> {
        const raw = text(await this.run(['cat-file', 'commit', this.oid(commit)], commands, signal));
        const body = raw.slice(raw.indexOf('\n\n') + 2);
        if (body !== `Owned Gitjig integration\nOperation: ${this.operationId(operationId)}\n`)
            throw new Error('Commit does not bind the exact operation identity');
    }
    private async commit(tree: string, parents: readonly string[], commands: CommandReceipt[], signal?: AbortSignal, operationId?: string): Promise<string> {
        return this.oid(text(await this.run(['commit-tree', this.oid(tree), ...parents.flatMap(parent => ['-p', this.oid(parent)])], commands, signal, Buffer.from(operationId ? `Owned Gitjig integration\nOperation: ${this.operationId(operationId)}\n` : 'Owned Gitjig projection\n'))).trim());
    }
    private async commitTree(commit: string, commands: CommandReceipt[], signal?: AbortSignal): Promise<string> {
        this.oid(commit);
        if (text(await this.run(['cat-file', '-t', commit], commands, signal)).trim() !== 'commit')
            throw new Error('Expected commit object');
        return this.oid(text(await this.run(['rev-parse', `${commit}^{tree}`], commands, signal)).trim());
    }
    private async treeFiles(tree: string, commands: CommandReceipt[], signal?: AbortSignal): Promise<Map<string, BytesFile>> {
        const listing = await this.run(['ls-tree', '-rz', '--full-tree', this.oid(tree)], commands, signal, undefined, this.maxBytes);
        const files = new Map<string, BytesFile>();
        let total = 0;
        for (const row of text(listing.subarray(0, -1)).split('\0')) {
            if (!row && !listing.length)
                break;
            const tab = row.indexOf('\t'), fields = row.slice(0, tab).split(' '), filename = row.slice(tab + 1);
            if (tab < 0 || fields.length !== 3 || !['100644', '100755'].includes(fields[0]!) || fields[1] !== 'blob')
                throw new Error('Unsupported Git tree record');
            relativeFile(filename);
            if (files.has(filename) || files.size >= this.maxEntries)
                throw new Error('Git tree duplicate/limit');
            const blob = this.oid(fields[2]!);
            const sizeText = text(await this.run(['cat-file', '-s', blob], commands, signal)).trim();
            if (!/^[0-9]+$/.test(sizeText) || Number(sizeText) + total > this.maxBytes)
                throw new Error('Git blob byte limit');
            const bytes = await this.run(['cat-file', 'blob', blob], commands, signal, undefined, Number(sizeText) + 1);
            total += bytes.length;
            if (bytes.length !== Number(sizeText) || bytes.includes(0))
                throw new Error('Unsupported binary/incorrect Git blob size');
            text(bytes);
            files.set(filename, { path: filename, mode: fields[0]! as '100644' | '100755', blob, sha256: digest(bytes), size: bytes.length, bytes });
        }
        if (listing.length && listing.at(-1) !== 0)
            throw new Error('Incomplete NUL tree listing');
        return files;
    }
    private async merge(base: string, ours: string, theirs: string, commands: CommandReceipt[], signal?: AbortSignal): Promise<string | null> {
        const result = await this.start(['merge-tree', '--write-tree', `--merge-base=${this.oid(base)}`, '-Xno-renames', this.oid(ours), this.oid(theirs)], signal);
        commands.push(result.receipt);
        if (result.receipt.exitCode === 1 && !result.receipt.truncated && result.receipt.settled && !result.receipt.aborted && !result.receipt.timedOut)
            return null;
        if (result.receipt.exitCode !== 0 || result.receipt.truncated || !result.receipt.settled || result.receipt.aborted || result.receipt.timedOut)
            throw new Error('Native merge unavailable');
        const output = text(result.bytes).trim();
        return this.oid(output); // successful clean merge is one complete tree OID
    }
    async project(input: ProjectionInput, signal?: AbortSignal): Promise<ProjectionResult> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [], sourceVersions = { base: input.base.versionId, candidate: input.candidate.versionId };
        try {
            this.operationId(input.operationId);
            const inventory = new Set(input.publicationInventory), allowed = new Set(input.authorizedDeltaPaths);
            if (inventory.size > this.maxEntries || allowed.size > this.maxEntries || inventory.size !== input.publicationInventory.length || allowed.size !== input.authorizedDeltaPaths.length)
                throw new Error('Duplicate publication/authorized path');
            for (const filename of [...inventory, ...allowed])
                relativeFile(filename);
            if (digest(JSON.stringify(input.base.manifest.dependencyLinks ?? [])) !== digest(JSON.stringify(input.candidate.manifest.dependencyLinks ?? [])))
                throw Error('Dependency link publication delta unsupported');
            const before = new Map(input.base.manifest.files.map(f => [f.path, f])), after = new Map(input.candidate.manifest.files.map(f => [f.path, f]));
            for (const filename of new Set([...before.keys(), ...after.keys()])) {
                if (before.get(filename)?.sha256 !== after.get(filename)?.sha256 || !!(before.get(filename)?.effectiveMode! & 0o111) !== !!(after.get(filename)?.effectiveMode! & 0o111)) {
                    if (!allowed.has(filename) || !inventory.has(filename))
                        throw new Error(`Unauthorized publication delta: ${filename}`);
                }
            }
            const sFiles = await this.captured(input.base, inventory, signal), cFiles = await this.captured(input.candidate, inventory, signal);
            const kTree = await this.commitTree(input.basisCommit, commands, signal), kFiles = await this.treeFiles(kTree, commands, signal);
            if ([...kFiles.keys()].some(filename => !inventory.has(filename)))
                throw new Error('Basis contains product outside explicit publication inventory');
            const sTree = await this.makeTree(sFiles, commands, signal), cTree = await this.makeTree(cFiles, commands, signal);
            const s = await this.commit(sTree, [], commands, signal), c = await this.commit(cTree, [s], commands, signal), k = await this.commit(kTree, [s], commands, signal);
            const projectedTree = await this.merge(s, c, k, commands, signal);
            if (!projectedTree)
                return { kind: 'conflict', reason: 'Native S/C/K projection conflicts; attributed replan and current checks/review required', sourceVersions, commands };
            const projected = await this.treeFiles(projectedTree, commands, signal);
            const differences: {
                path: string;
                reason: string;
            }[] = [];
            for (const filename of new Set([...after.keys(), ...projected.keys()])) {
                const a = after.get(filename), b = projected.get(filename);
                if (a?.sha256 !== b?.sha256 || !!(a?.effectiveMode! & 0o111) !== (b?.mode === '100755'))
                    differences.push({ path: filename, reason: !b ? 'Captured input excluded from publication' : !a ? 'Basis product retained outside captured candidate' : 'Publication bytes/executable bit differ from reviewed effective input' });
            }
            // Git cannot carry empty directories; disclose rather than silently
            // preserving a stronger effective input/guarantee claim.
            for (const dir of input.candidate.manifest.directories)
                if (![...projected.keys()].some(filename => filename.startsWith(dir.path + '/')))
                    differences.push({ path: dir.path, reason: 'Captured directory presence not represented in Git tree' });
            for (const link of input.candidate.manifest.dependencyLinks ?? [])
                differences.push({ path: link.path, reason: 'Captured dependency link excluded from regular-file publication' });
            const files = [...projected.values()].map(({ bytes, ...file }) => file);
            if (projectedTree === kTree)
                return { kind: 'no-change', basisCommit: input.basisCommit, tree: projectedTree, files, effectiveDifferences: differences, commands };
            const head = await this.commit(projectedTree, [input.basisCommit], commands, signal, input.operationId);
            if (await this.commitTree(head, commands, signal) !== projectedTree)
                throw new Error('Publication commit tree round-trip mismatch');
            return { kind: 'projected', receipt: { operationId: input.operationId, sourceVersions, sourceDigests: { base: input.base.digest, candidate: input.candidate.digest }, basisCommit: input.basisCommit, syntheticBase: s, projectedTree, projectedCommit: head, files, effectiveDifferences: differences, commands } };
        }
        catch (error) {
            return { kind: 'unavailable', reason: String(error), sourceVersions, commands };
        }
    }
    async buildIntegration(input: {
        operationId: string;
        head: string;
        expectedBase: string;
    }, signal?: AbortSignal): Promise<IntegrationResult> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        try {
            await this.operationCommit(input.head, input.operationId, commands, signal);
            const hTree = await this.commitTree(input.head, commands, signal);
            await this.commitTree(input.expectedBase, commands, signal);
            const ancestor = await this.start(['merge-base', '--is-ancestor', input.expectedBase, input.head], signal);
            commands.push(ancestor.receipt);
            if (ancestor.receipt.truncated || !ancestor.receipt.settled || ancestor.receipt.aborted || ancestor.receipt.timedOut || ![0, 1].includes(ancestor.receipt.exitCode!))
                throw new Error('Ancestry unavailable');
            let tree = hTree, commit = input.head, parents: readonly string[] = [];
            if (ancestor.receipt.exitCode !== 0) {
                const bases = text(await this.run(['merge-base', input.expectedBase, input.head], commands, signal)).trim();
                this.oid(bases);
                const merged = await this.merge(bases, input.expectedBase, input.head, commands, signal);
                if (!merged)
                    return { kind: 'conflict', reason: 'Native B/H integration conflicts; current integration candidate/review required', commands };
                tree = merged;
                parents = [input.expectedBase, input.head];
                commit = await this.commit(tree, parents, commands, signal, input.operationId);
            }
            const parentLine = text(await this.run(['rev-list', '--parents', '-n', '1', commit], commands, signal)).trim().split(' ');
            if (parentLine.shift() !== commit)
                throw new Error('Integration parent readback mismatch');
            parents = parentLine.map(parent => this.oid(parent));
            const files = [...(await this.treeFiles(tree, commands, signal)).values()].map(({ bytes, ...file }) => file);
            return { kind: 'candidate', commit, tree, expectedBase: input.expectedBase, head: input.head, parents, files, commands };
        }
        catch (error) {
            return { kind: 'unavailable', reason: String(error), commands };
        }
    }
    async materializeVerifiedTree(tree: string, targetRoot: string, signal?: AbortSignal): Promise<{
        root: string;
        manifest: Manifest;
        digest: string;
        commands: readonly CommandReceipt[];
    }> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        const files = await this.treeFiles(tree, commands, signal);
        if (!path.isAbsolute(targetRoot) || path.resolve(targetRoot) !== targetRoot || contains(this.root, targetRoot))
            throw new Error('Materialization needs a separate explicit owned path');
        const parent = path.dirname(targetRoot), parentStat = await fs.lstat(parent);
        if (await fs.realpath(parent) !== parent || !parentStat.isDirectory() || parentStat.uid !== process.getuid?.() || (parentStat.mode & 0o022))
            throw new Error('Materialization parent alias/ownership');
        await privateDirectory(targetRoot);
        if ((await fs.readdir(targetRoot)).length)
            throw new Error('Materialization destination not empty');
        for (const file of files.values()) {
            signal?.throwIfAborted();
            const destination = path.join(targetRoot, file.path);
            await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            const handle = await fs.open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, file.mode === '100755' ? 0o755 : 0o644);
            try {
                await handle.writeFile(file.bytes);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
        }
        // Reuse actual existing capture/normalization rather than minting a fake
        // Manifest from Git labels. A separate frozen output remains core-owned.
        const capturedRoot = targetRoot + '.captured';
        const captured = await freeze(targetRoot, capturedRoot, { maxEntries: this.maxEntries, maxBytes: this.maxBytes, timeoutMs: 30000 }, signal);
        const actual = new Map(captured.manifest.files.map(f => [f.path, f]));
        if (actual.size !== files.size || [...files.values()].some(f => actual.get(f.path)?.sha256 !== f.sha256 || !!(actual.get(f.path)?.effectiveMode! & 0o111) !== (f.mode === '100755')))
            throw new Error('Materialized tree byte/exec round-trip mismatch');
        return { root: capturedRoot, ...captured, commands };
    }
    private async refName(ref: string, commands: CommandReceipt[], signal?: AbortSignal): Promise<void> {
        if (!ref.startsWith('refs/heads/') || ref === 'refs/heads/' || ref.includes('\0'))
            throw new Error('Only one explicit branch ref is supported');
        await this.run(['check-ref-format', ref], commands, signal);
    }
    private targetIdentitySync(target: LocalBareTarget): PolicyIdentity {
        const directory = fsSync.lstatSync(target.canonicalPath);
        if (!directory.isDirectory() || directory.isSymbolicLink() || fsSync.realpathSync(target.canonicalPath) !== target.canonicalPath || String(directory.dev) !== target.device || String(directory.ino) !== target.inode || directory.uid !== target.ownerUid || directory.uid !== process.getuid?.() || (directory.mode & 0o022))
            throw new Error('Registered owned receiver identity changed');
        const configPath = path.join(target.canonicalPath, 'config'), config = fsSync.lstatSync(configPath);
        if (!config.isFile() || config.isSymbolicLink() || config.nlink !== 1 || config.uid !== target.ownerUid || (config.mode & 0o022) || config.size > 256 * 1024)
            throw new Error('Receiver config ownership/size unsupported');
        const hooksPath = path.join(target.canonicalPath, 'hooks');
        let hooks = '';
        if (fsSync.existsSync(hooksPath)) {
            const dir = fsSync.lstatSync(hooksPath);
            if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== target.ownerUid || (dir.mode & 0o022))
                throw new Error('Receiver hooks identity unsupported');
            const names = fsSync.readdirSync(hooksPath).sort();
            if (names.length > 256)
                throw new Error('Receiver hook inventory limit');
            for (const name of names) {
                const st = fsSync.lstatSync(path.join(hooksPath, name));
                if (!st.isFile() || st.isSymbolicLink() || st.uid !== target.ownerUid || (st.mode & 0o022))
                    throw new Error('Receiver hook file unsupported');
                if (!name.endsWith('.sample') && (st.mode & 0o111))
                    throw new Error('Initial local profile has no active receiver hooks');
                hooks += `${name}:${st.mode}:${st.size}:${st.ino}\n`;
            }
        }
        return { configHash: digest(fsSync.readFileSync(configPath)), hooksHash: digest(hooks) };
    }
    async registerLocalTarget(input: {
        targetId: string;
        path: string;
        ref: string;
    }, signal?: AbortSignal): Promise<LocalBareTarget> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        await this.refName(input.ref, commands, signal);
        if (!input.targetId || Buffer.byteLength(input.targetId) > 512 || !path.isAbsolute(input.path) || await fs.realpath(input.path) !== input.path || contains(this.root, input.path) || contains(input.path, this.root))
            throw new Error('Explicit separate canonical target required');
        const stat = await fs.lstat(input.path);
        const target: LocalBareTarget = { targetId: input.targetId, canonicalPath: input.path, device: String(stat.dev), inode: String(stat.ino), ownerUid: stat.uid, objectFormat: this.objectFormat, ref: input.ref };
        this.targetIdentitySync(target);
        if (text(await this.run(['rev-parse', '--is-bare-repository'], commands, signal, undefined, undefined, input.path)).trim() !== 'true')
            throw new Error('Only local bare receivers supported');
        const format = text(await this.run(['rev-parse', '--show-object-format'], commands, signal, undefined, undefined, input.path)).trim();
        if (format !== this.objectFormat)
            throw new Error('Receiver/client object format mismatch');
        // No includes/command-valued receiver config in initial finite profile.
        const config = text(await this.run(['config', '--no-includes', '--local', '--null', '--list'], commands, signal, undefined, undefined, input.path));
        const accepted = new Set(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'extensions.objectformat', 'receive.denynonfastforwards', 'receive.denydeletes', 'receive.fsckobjects']);
        for (const record of config.split('\0').filter(Boolean)) {
            const newline = record.indexOf('\n'), key = record.slice(0, newline);
            if (newline < 0 || !accepted.has(key))
                throw new Error(`Receiver config outside initial finite profile: ${key}`);
            const value = record.slice(newline + 1);
            if (key === 'extensions.objectformat' ? value !== this.objectFormat : key === 'core.repositoryformatversion' ? !['0', '1'].includes(value) : !['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'].includes(value))
                throw new Error(`Receiver config value outside finite profile: ${key}`);
        }
        return Object.freeze(target);
    }
    async observeLocalRef(target: LocalBareTarget, signal?: AbortSignal): Promise<LocalRefObservation> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        this.targetIdentitySync(target);
        await this.refName(target.ref, commands, signal);
        const result = await this.start(['ls-remote', '--refs', '--', target.canonicalPath, target.ref], signal);
        commands.push(result.receipt);
        if (result.receipt.exitCode !== 0 || result.receipt.truncated || !result.receipt.settled || result.receipt.aborted || result.receipt.timedOut)
            throw new Error('Receiver ref observation unavailable');
        // ls-remote patterns match ref name tails, so keep only the exact ref.
        const exact = exactRefRows(text(result.bytes), target.ref);
        if (!exact || exact.length > 1)
            throw new Error('Unexpected receiver ref identity');
        if (!exact.length)
            return { target, commit: null, commands };
        return { target, commit: this.oid(exact[0]!), commands };
    }
    async fetchLocalBasis(target: LocalBareTarget, expectedCommit?: string, signal?: AbortSignal): Promise<{
        commit: string;
        observedBase: string;
        tree: string;
        commands: readonly CommandReceipt[];
    }> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        const observed = await this.observeLocalRef(target, signal);
        commands.push(...observed.commands);
        if (!observed.commit)
            throw new Error('Registered target commit absent');
        const basis = expectedCommit ? this.oid(expectedCommit) : observed.commit;
        await this.run(['fetch', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--', target.canonicalPath, target.ref], commands, signal);
        if (basis !== observed.commit) {
            const ancestry = await this.start(['merge-base', '--is-ancestor', basis, observed.commit], signal);
            commands.push(ancestry.receipt);
            if (ancestry.receipt.exitCode !== 0 || ancestry.receipt.truncated || !ancestry.receipt.settled || ancestry.receipt.aborted || ancestry.receipt.timedOut)
                throw new Error('Pinned publication basis is not established within current target ancestry');
        }
        return { commit: basis, observedBase: observed.commit, tree: await this.commitTree(basis, commands, signal), commands };
    }
    async prepareForwardSend(input: ForwardSend, signal: AbortSignal): Promise<PreparedForwardSend> {
        signal = this.finite(signal);
        signal.throwIfAborted();
        const owned = structuredClone(input);
        const commands: CommandReceipt[] = [];
        this.operationId(owned.operationId);
        this.oid(owned.expectedBase);
        this.oid(owned.integrationCommit);
        if (owned.expectedBase === owned.integrationCommit)
            throw new Error('No forward update: desired commit already equals base');
        await this.refName(owned.target.ref, commands, signal);
        await this.operationCommit(owned.integrationCommit, owned.operationId, commands, signal);
        await this.commitTree(owned.integrationCommit, commands, signal);
        await this.commitTree(owned.expectedBase, commands, signal);
        const ancestor = await this.start(['merge-base', '--is-ancestor', owned.expectedBase, owned.integrationCommit], signal);
        commands.push(ancestor.receipt);
        signal.throwIfAborted();
        if (ancestor.receipt.exitCode !== 0 || ancestor.receipt.truncated || !ancestor.receipt.settled || ancestor.receipt.aborted || ancestor.receipt.timedOut)
            throw new Error('Forward ancestry condition not established');
        const observed = await this.observeLocalRef(owned.target, signal);
        if (observed.commit !== owned.expectedBase)
            throw new Error('Expected target base changed before preparation');
        const validated = await this.registerLocalTarget({ targetId: owned.target.targetId, path: owned.target.canonicalPath, ref: owned.target.ref }, signal);
        if (!sameTarget(validated, owned.target))
            throw new Error('Registered target changed');
        const policy = this.targetIdentitySync(owned.target);
        signal.throwIfAborted();
        const handle = Object.freeze({ operationId: owned.operationId, expectedBase: owned.expectedBase, integrationCommit: owned.integrationCommit, targetIdentity: Object.freeze({ ...owned.target }), commands: Object.freeze(commands.map(command => Object.freeze({ ...command, argv: Object.freeze([...command.argv]) }))) });
        const command = await this.prepareCommand(['push', '--porcelain', '--no-verify', '--recurse-submodules=no', `--force-with-lease=${owned.target.ref}:${owned.expectedBase}`, '--', owned.target.canonicalPath, `${owned.integrationCommit}:${owned.target.ref}`], signal, undefined, this.outputLimit);
        signal.throwIfAborted();
        this.prepared.set(handle, { input: owned, signal, policy, used: false, command });
        return handle;
    }
    spawnPreparedForwardSend(handle: PreparedForwardSend): Promise<SendReceipt> {
        const state = this.prepared.get(handle);
        const notStarted = (reason: string): Promise<SendReceipt> => Promise.resolve({ operationId: state?.input.operationId ?? handle.operationId, handoff: 'not-started', transport: 'native-rejection', reason });
        if (!state || state.used)
            return notStarted('Unknown/already-consumed prepared handle');
        state.used = true;
        try {
            this.assertOpen();
            state.signal.throwIfAborted();
            if (!sameTarget(handle.targetIdentity, state.input.target) || JSON.stringify(this.targetIdentitySync(state.input.target)) !== JSON.stringify(state.policy))
                throw new Error('Prepared target/policy identity changed');
            const { input } = state;
            // NO await between captured cancellation/endpoint comparison and
            // actual start(), which performs spawn synchronously.
            const running = this.launch(state.command);
            return running.then(({ receipt: command }) => {
                return { operationId: input.operationId, handoff: 'started' as const, transport: sendTransport(command, input.integrationCommit, input.target.ref), command };
            });
        }
        catch (error) {
            try {
                this.noLaunch(state.command);
            }
            catch (journalError) {
                return notStarted('No launcher started; durable no-launch receipt unavailable: ' + String(journalError));
            }
            return notStarted(String(error));
        }
    }
    async reconcileForward(input: ForwardSend, signal?: AbortSignal): Promise<ForwardReconciliation> {
        signal = this.finite(signal);
        const commands: CommandReceipt[] = [];
        let targetCommit: string | null = null;
        try {
            this.oid(input.integrationCommit);
            const observed = await this.observeLocalRef(input.target, signal);
            commands.push(...observed.commands);
            targetCommit = observed.commit;
            if (!targetCommit)
                return { kind: 'unknown', targetCommit, reason: 'Target absent does not establish never-accepted outcome', commands };
            await this.run(['fetch', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--', input.target.canonicalPath, input.target.ref], commands, signal);
            await this.operationCommit(input.integrationCommit, input.operationId, commands, signal);
            const ancestry = await this.start(['merge-base', '--is-ancestor', input.integrationCommit, targetCommit], signal);
            commands.push(ancestry.receipt);
            if (ancestry.receipt.exitCode === 0 && !ancestry.receipt.truncated && ancestry.receipt.settled && !ancestry.receipt.aborted && !ancestry.receipt.timedOut)
                return { kind: 'contains-integration', targetCommit, integrationCommit: input.integrationCommit, laterAdvancement: targetCommit !== input.integrationCommit, commands };
            return { kind: 'unknown', targetCommit, reason: 'Target does not prove the operation integration is contained; no automatic resend', commands };
        }
        catch (error) {
            return { kind: 'unknown', targetCommit, reason: String(error), commands };
        }
    }
    private httpsUrl(target: HttpsGitTarget): string {
        if (!this.https || target.host !== 'github.com' || !Number.isSafeInteger(target.repositoryId) || target.repositoryId < 1 || !target.repositoryNodeId || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(target.ref) || target.ref.includes('..') || target.ref.includes('@{') || target.ref.split('/').some(x => !x || x.startsWith('.') || x.endsWith('.') || x.endsWith('.lock')))
            throw Error('Existing-ref HTTPS target unsupported');
        for (const value of [target.owner, target.repository])
            if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value))
                throw Error('Canonical HTTPS repository unsupported');
        return `${this.https.origin}/${target.owner}/${target.repository}.git`;
    }
    private ownAdmission<T>(pending: Promise<T>): Promise<T> {
        this.running.add(pending);
        void pending.then(() => this.running.delete(pending), () => this.running.delete(pending));
        return pending;
    }
    private httpsRun(args: string[], signal: AbortSignal, commands: CommandReceipt[]): Promise<Buffer> {
        return this.ownAdmission((async () => {
            const result = await this.launch(await this.prepareCommand(args, signal, undefined, this.outputLimit, undefined, true));
            commands.push(result.receipt);
            if (result.receipt.exitCode !== 0 || !result.receipt.settled || result.receipt.truncated || result.receipt.aborted || result.receipt.timedOut)
                throw Error('Native HTTPS operation unavailable: ' + result.receipt.stderr);
            return result.bytes;
        })());
    }
    /** SETUP only: authority is installed solely by the context-bound constructor. */
    observeAcceptanceInventory(target: HttpsGitTarget, signal?: AbortSignal) {
        if (!this.https?.acceptanceSetup)
            return Promise.reject(Error('Fixed acceptance setup unavailable'));
        const commands: CommandReceipt[] = [];
        return this.httpsRun(['ls-remote', '--refs', '--', this.httpsUrl(target)], this.finite(signal), commands).then(bytes => {
            const refs = text(bytes).trim() ? text(bytes).trim().split('\n').map(line => {
                const [oid, ref, extra] = line.split('\t');
                if (!ref || extra !== undefined || !/^refs\/heads\//.test(ref))
                    throw Error('Unexpected acceptance ref inventory');
                return { commit: this.oid(oid!), ref };
            }) : [];
            return { refs, commands };
        });
    }
    prepareAcceptanceSetup(input: AcceptanceSetupInput, signal: AbortSignal): Promise<PreparedHttpsSend & {
        tree: string;
    }> {
        return this.ownAdmission((async () => {
            if (!this.https?.acceptanceSetup)
                throw Error('Fixed acceptance setup unavailable');
            const captured = structuredClone(input);
            const location = new URL('../../.qualification/native-git-setup.js', import.meta.url).href;
            const setup = await import(location) as {
                prepareAcceptanceSetup(operations: AcceptanceSetupOperations, input: AcceptanceSetupInput, signal: AbortSignal): Promise<PreparedHttpsSend & {
                    tree: string;
                }>;
            };
            return setup.prepareAcceptanceSetup({
                observeInventory: (target, signal) => this.observeAcceptanceInventory(target, signal),
                oid: value => this.oid(value),
                fetchBasis: (target, parent, signal) => this.fetchHttpsBasis(target, parent, signal),
                makeTree: (files, commands, signal) => this.makeTree(files, commands, signal),
                run: (args, commands, signal, input) => this.run(args, commands, signal, input),
                prepare: async (owned, operationId, parent, commit, tree, signal) => {
                    if (!this.https?.acceptanceSetup)
                        throw Error('Fixed acceptance setup unavailable');
                    const command = await this.prepareCommand(['push', '--porcelain', '--no-verify', '--recurse-submodules=no', `--force-with-lease=${owned.target.ref}:${parent ?? ''}`, '--', this.httpsUrl(owned.target), `${commit}:${owned.target.ref}`], signal, undefined, this.outputLimit, undefined, true);
                    const handle = Object.freeze({ operationId, expectedBase: parent ?? '', integrationCommit: commit, credentialSessionId: this.https.credentialSessionId, tree });
                    this.httpsPrepared.set(handle, { input: { operationId, target: owned.target, expectedBase: parent ?? '', integrationCommit: commit }, command, used: false });
                    return handle;
                },
            }, captured, signal);
        })());
    }
    async observeHttpsRef(target: HttpsGitTarget, signal?: AbortSignal) {
        target = structuredClone(target);
        const commands: CommandReceipt[] = [], url = this.httpsUrl(target);
        const bytes = await this.httpsRun(['ls-remote', '--refs', '--', url, target.ref], this.finite(signal), commands);
        const exact = exactRefRows(text(bytes), target.ref);
        if (!exact)
            throw Error('HTTPS ref identity differs');
        if (exact.length !== 1)
            throw Error('Exact existing HTTPS ref unavailable');
        return { commit: this.oid(exact[0]!), commands, credentialSessionId: this.https!.credentialSessionId };
    }
    async fetchHttpsBasis(target: HttpsGitTarget, expectedBase: string, signal?: AbortSignal) {
        target = structuredClone(target);
        const combined = this.finite(signal), before = await this.observeHttpsRef(target, combined), commands = [...before.commands];
        if (before.commit !== this.oid(expectedBase))
            throw Error('HTTPS expected existing base changed');
        await this.httpsRun(['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--', this.httpsUrl(target), target.ref], combined, commands);
        // Post-transfer object-store admission, not a hard wire/disk download quota.
        let stored = 0;
        const census = async (directory: string): Promise<void> => {
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                combined.throwIfAborted();
                const file = path.join(directory, entry.name);
                if (entry.isDirectory())
                    await census(file);
                else {
                    const stat = await fs.lstat(file);
                    if (!stat.isFile() || stat.isSymbolicLink())
                        throw Error('HTTPS object store entry unsupported');
                    stored += stat.size;
                    if (stored > this.maxBytes)
                        throw Error('HTTPS fetched object store exceeds post-transfer admission bound');
                }
            }
        };
        await census(path.join(this.repo, 'objects'));
        const after = await this.observeHttpsRef(target, combined);
        commands.push(...after.commands);
        if (after.commit !== expectedBase)
            throw Error('HTTPS base changed during fetch');
        await this.run(['cat-file', '-e', expectedBase + '^{commit}'], commands, combined);
        return { commit: expectedBase, commands };
    }
    async fetchHttpsPinnedBasis(target: HttpsGitTarget, basisCommit: string, signal?: AbortSignal) {
        const observed = await this.observeHttpsRef(target, signal);
        const fetched = await this.fetchHttpsBasis(target, observed.commit, signal);
        const commands = [...observed.commands, ...fetched.commands], basis = this.oid(basisCommit);
        await this.run(['cat-file', '-e', basis + '^{commit}'], commands, this.finite(signal));
        await this.run(['merge-base', '--is-ancestor', basis, observed.commit], commands, this.finite(signal));
        return { commit: basis, observedBase: observed.commit, commands };
    }
    prepareHttpsForwardSend(input: HttpsForwardSend, signal: AbortSignal): Promise<PreparedHttpsSend> {
        return this.ownAdmission((async () => {
            const owned = structuredClone(input), commands: CommandReceipt[] = [];
            this.httpsUrl(owned.target);
            this.oid(owned.expectedBase);
            this.oid(owned.integrationCommit);
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(owned.operationId))
                throw Error('HTTPS operation identity unsupported');
            await this.run(['merge-base', '--is-ancestor', owned.expectedBase, owned.integrationCommit], commands, signal);
            const observed = await this.observeHttpsRef(owned.target, signal);
            commands.push(...observed.commands);
            if (observed.commit !== owned.expectedBase)
                throw Error('HTTPS base changed before preparation');
            const command = await this.prepareCommand(['push', '--porcelain', '--no-verify', '--recurse-submodules=no', `--force-with-lease=${owned.target.ref}:${owned.expectedBase}`, '--', this.httpsUrl(owned.target), `${owned.integrationCommit}:${owned.target.ref}`], signal, undefined, this.outputLimit, undefined, true);
            const handle = Object.freeze({ operationId: owned.operationId, expectedBase: owned.expectedBase, integrationCommit: owned.integrationCommit, credentialSessionId: this.https!.credentialSessionId });
            this.httpsPrepared.set(handle, { input: owned, command, used: false });
            return handle;
        })());
    }
    private readonly httpsPrepared = new WeakMap<PreparedHttpsSend, {
        input: HttpsForwardSend;
        command: PreparedCommand;
        used: boolean;
    }>();
    spawnPreparedHttpsForwardSend(handle: PreparedHttpsSend): Promise<SendReceipt> {
        const saved = this.httpsPrepared.get(handle);
        if (!saved || saved.used)
            throw Error('Foreign or consumed HTTPS send');
        saved.used = true;
        try {
            this.assertOpen();
            saved.command.signal.throwIfAborted();
            const running = this.launch(saved.command);
            return running.then(({ receipt: command }) => ({ operationId: saved.input.operationId, handoff: 'started' as const, transport: sendTransport(command, saved.input.integrationCommit, saved.input.target.ref), command }));
        }
        catch (error) {
            this.noLaunch(saved.command);
            return Promise.resolve({ operationId: saved.input.operationId, handoff: 'not-started', transport: 'native-rejection', reason: String(error) });
        }
    }
    async reconcileHttpsForward(input: HttpsForwardSend, signal?: AbortSignal) {
        input = structuredClone(input);
        this.oid(input.expectedBase);
        this.oid(input.integrationCommit);
        const commands: CommandReceipt[] = [];
        try {
            const observed = await this.observeHttpsRef(input.target, signal);
            commands.push(...observed.commands);
            if (observed.commit === input.integrationCommit)
                return { kind: 'contains-integration' as const, targetCommit: observed.commit, commands };
            const fetched = await this.fetchHttpsBasis(input.target, observed.commit, signal);
            commands.push(...fetched.commands);
            const result = await this.start(['merge-base', '--is-ancestor', input.integrationCommit, observed.commit], this.finite(signal));
            commands.push(result.receipt);
            if (result.receipt.exitCode === 0 && result.receipt.settled && !result.receipt.truncated)
                return { kind: 'contains-integration' as const, targetCommit: observed.commit, commands };
            return { kind: 'unknown' as const, targetCommit: observed.commit, commands };
        }
        catch {
            return { kind: 'unknown' as const, targetCommit: null, commands };
        }
    }
    close(): Promise<void> {
        if (this.closeResult)
            return this.closeResult;
        this.closed = true;
        this.shutdown.abort(new Error('Owned Git client closed'));
        this.closeResult = (async () => {
            await Promise.allSettled([...this.running]);
            for (const command of this.unlaunched)
                this.noLaunch(command);
            const recovery = await reconcileOwnedGitProcesses(this.root);
            if (recovery.cleanup !== 'confirmed')
                throw new NativeGitCleanupError('Inspect original client ' + this.root + '; retain/quarantine its command journal', recovery);
        })();
        return this.closeResult;
    }
}
export type NativeGitClient = OwnedNativeGit;
export async function openNativeGit(profile: NativeGitProfile, signal?: AbortSignal): Promise<NativeGitClient> {
    let binary: string;
    try {
        signal?.throwIfAborted();
        if (!path.isAbsolute(profile.gitBinary) || !path.isAbsolute(profile.ownedClientRoot) || path.resolve(profile.ownedClientRoot) !== profile.ownedClientRoot)
            throw new Error('Explicit absolute trusted Git/client paths required');
        binary = await fs.realpath(profile.gitBinary);
        const stat = await fs.stat(binary);
        if (!stat.isFile() || !(stat.mode & 0o111) || (stat.mode & 0o022) || (stat.uid !== 0 && stat.uid !== process.getuid?.()))
            throw new Error('Trusted Git executable ownership unsupported');
        const clientRoot = await fs.realpath(profile.ownedClientRoot).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT')
                return profile.ownedClientRoot;
            throw error;
        });
        if (contains(clientRoot, binary))
            throw new Error('Trusted Git executable must be outside owned client root');
        // Trust reads do not allocate a client or an owned process.
        signal?.throwIfAborted();
    }
    catch (error) {
        throw new NativeGitNotAllocatedError(profile.ownedClientRoot, error);
    }
    const client = new OwnedNativeGit({ ...profile }, binary);
    try {
        await client.initialize(profile.resumeOwned ?? false, signal);
        signal?.throwIfAborted();
        return client;
    }
    catch (error) {
        try {
            await client.close();
        }
        catch (cleanupError) {
            throw new NativeGitCleanupError('Inspect original client ' + profile.ownedClientRoot + '; initialization failed and cleanup remains unknown', new AggregateError([error, cleanupError]));
        }
        throw error;
    }
}
export interface OwnedGitProcessReconciliation {
    cleanup: 'confirmed' | 'unknown';
    commands: readonly {
        commandId: string;
        directory: string;
        cleanup: 'confirmed' | 'unknown';
        reason?: string;
    }[];
}
/** Inspect only this admitted client journal. Never a process scan or arbitrary PID kill. */
export async function reconcileOwnedGitProcesses(root: string, waitMs = 2500): Promise<OwnedGitProcessReconciliation> {
    const commands: {
        commandId: string;
        directory: string;
        cleanup: 'confirmed' | 'unknown';
        reason?: string;
    }[] = [];
    const json = (file: string, max = 65536) => {
        const fd = fsSync.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = fsSync.fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > max)
                throw new Error('Unowned journal leaf');
            const bytes = Buffer.alloc(stat.size + 1);
            const count = fsSync.readSync(fd, bytes, 0, bytes.length, 0);
            if (count !== stat.size)
                throw new Error('Journal changed');
            return JSON.parse(text(bytes.subarray(0, count)));
        }
        finally {
            fsSync.closeSync(fd);
        }
    };
    try {
        const stat = await fs.lstat(root);
        if (!path.isAbsolute(root) || await fs.realpath(root) !== root || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))
            throw new Error('Unowned command root');
        const runRoot = path.join(root, 'runs'), runs = await fs.readdir(runRoot);
        if (runs.length > 10000)
            throw new Error('Owned command journal census exceeds finite profile');
        const end = Date.now() + Math.min(5000, Math.max(0, waitMs));
        for (const commandId of runs) {
            const directory = path.join(runRoot, commandId);
            let result: {
                commandId: string;
                directory: string;
                cleanup: 'confirmed' | 'unknown';
                reason?: string;
            } = { commandId, directory, cleanup: 'unknown', reason: 'Owned terminal receipt absent' };
            try {
                if (!/^[-a-z0-9]+$/.test(commandId))
                    throw new Error('Invalid command journal name');
                const dir = await fs.lstat(directory);
                if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o077))
                    throw new Error('Unsafe command journal');
                const descriptor = json(path.join(directory, 'descriptor.json'), 1024 * 1024);
                if (descriptor.commandId !== commandId || descriptor.directory !== directory)
                    throw new Error('Command descriptor identity mismatch');
                for (;;) {
                    try {
                        const terminal = json(path.join(directory, 'terminal.json'));
                        if (terminal.commandId !== commandId || terminal.cleanup !== 'confirmed')
                            throw new Error('Owned cleanup remains unknown');
                        if (terminal.producer === 'controller-no-launch') {
                            if (terminal.pid !== null || terminal.gitStarted !== false || fsSync.existsSync(path.join(directory, 'lifecycle.json')))
                                throw new Error('No-launch record conflicts with actual supervisor');
                        }
                        else {
                            const lifecycle = json(path.join(directory, 'lifecycle.json')), outcome = json(path.join(directory, 'result.json'), 32 * 1024 * 1024 + 65536);
                            if (terminal.pid !== lifecycle.pid || outcome.identity.pid !== lifecycle.pid || outcome.identity.commandId !== commandId || outcome.cleanup !== 'confirmed' || !Number.isSafeInteger(lifecycle.pid) || lifecycle.pid < 1)
                                throw new Error('Supervisor identity/result mismatch');
                            let acknowledged = false;
                            try {
                                const ack = json(path.join(directory, 'parent-closed.json'));
                                acknowledged = ack.commandId === commandId && ack.pid === lifecycle.pid && ack.resultHash === digest(fsSync.readFileSync(path.join(directory, 'result.json')));
                                if (!acknowledged)
                                    throw new Error('Parent closure receipt mismatch');
                            }
                            catch (error) {
                                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                                    throw error;
                            }
                            let alive = false;
                            try {
                                if (!acknowledged) {
                                    const observed = await promisify(execFile)('/bin/ps', ['-p', String(lifecycle.pid), '-o', 'lstart=', '-o', 'command='], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 1000, maxBuffer: 65536 });
                                    alive = observed.stdout.trim() === lifecycle.startIdentity;
                                }
                            }
                            catch (error) {
                                if ((error as {
                                    code?: number;
                                }).code !== 1)
                                    throw error;
                            }
                            if (alive) {
                                if (Date.now() < end) {
                                    await new Promise(resolve => setTimeout(resolve, 20));
                                    continue;
                                }
                                throw new Error('Exact owned supervisor is still alive');
                            }
                        }
                        result = { commandId, directory, cleanup: 'confirmed' };
                        break;
                    }
                    catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && Date.now() < end) {
                            await new Promise(resolve => setTimeout(resolve, 20));
                            continue;
                        }
                        throw error;
                    }
                }
            }
            catch (error) {
                result.reason = String(error);
            }
            commands.push(result);
        }
        return { cleanup: commands.every(c => c.cleanup === 'confirmed') ? 'confirmed' : 'unknown', commands };
    }
    catch (error) {
        return { cleanup: 'unknown', commands: [...commands, { commandId: 'unavailable', directory: root, cleanup: 'unknown', reason: String(error) }] };
    }
}
export interface HttpsGitTarget {
    host: 'github.com';
    repositoryId: number;
    repositoryNodeId: string;
    owner: string;
    repository: string;
    ref: string;
}
export interface HttpsForwardSend {
    operationId: string;
    target: HttpsGitTarget;
    expectedBase: string;
    integrationCommit: string;
}
export interface PreparedHttpsSend {
    readonly operationId: string;
    readonly expectedBase: string;
    readonly integrationCommit: string;
    readonly credentialSessionId: string;
}
interface OwnedHttpsOptions {
    origin: string;
    caFile?: string | undefined;
    acceptanceSetup?: boolean;
    token: string;
    credentialSessionId: string;
    execPath: string;
}
/** Fixed canonical normal transport. No ambient search or helper-discovery subprocess. */
export async function openGitHubHttpsGit(profile: NativeGitProfile, capture: {
    token: string;
    credentialSessionId: string;
    excludedRoots?: readonly string[];
}, signal?: AbortSignal): Promise<NativeGitClient> {
    let execPath: string;
    try {
        signal?.throwIfAborted();
        if (!profile || !capture || typeof profile.gitBinary !== 'string' || typeof profile.ownedClientRoot !== 'string' || typeof capture.token !== 'string' || typeof capture.credentialSessionId !== 'string')
            throw Error('Explicit normal Git profile and captured credential required');
        const binary = await fs.realpath(profile.gitBinary), stat = await fs.stat(binary), roots = [...(capture.excludedRoots ?? []), profile.ownedClientRoot];
        if (!stat.isFile() || !(stat.mode & 0o111) || stat.mode & 0o022 || ![0, process.getuid?.()].includes(stat.uid) || roots.some(root => contains(path.resolve(root), binary)))
            throw Error('Trusted canonical HTTPS Git required');
        const candidate = binary === '/usr/bin/git' ? '/usr/lib/git-core' : path.resolve(path.dirname(binary), '../libexec/git-core');
        let helper: string;
        try {
            execPath = await fs.realpath(candidate);
            helper = await fs.realpath(path.join(execPath, 'git-remote-https'));
        }
        catch {
            throw Error('Unsupported installed Git HTTPS helper layout; no subprocess launched');
        }
        for (const entry of [execPath, helper]) {
            const item = await fs.stat(entry);
            if ((entry === execPath ? !item.isDirectory() : !item.isFile() || !(item.mode & 0o111)) || item.mode & 0o022 || ![0, process.getuid?.()].includes(item.uid) || roots.some(root => contains(path.resolve(root), entry)))
                throw Error('Trusted installed HTTPS helper outside mutable project/installation scopes required');
        }
        if (!contains(execPath, helper))
            throw Error('HTTPS helper escaped fixed installed directory');
        signal?.throwIfAborted();
    }
    catch (error) {
        throw new NativeGitNotAllocatedError(profile?.ownedClientRoot, error);
    }
    return constructHttps(profile, { origin: 'https://github.com', token: capture.token, credentialSessionId: capture.credentialSessionId, execPath }, true, signal);
}
/** Internal owned TLS/backend fixture only, never a CLI/model URL/token route. */
async function constructHttps(profile: NativeGitProfile, options: OwnedHttpsOptions, canonical = false, signal?: AbortSignal): Promise<NativeGitClient> {
    let captured: OwnedHttpsOptions, url: URL, binary: string, exec: string, ca: string | undefined;
    try {
        signal?.throwIfAborted();
        captured = structuredClone(options);
        url = new URL(captured.origin);
        if (!path.isAbsolute(profile.gitBinary) || !path.isAbsolute(profile.ownedClientRoot) || path.resolve(profile.ownedClientRoot) !== profile.ownedClientRoot)
            throw Error('Explicit canonical trusted Git/client paths required');
        if (canonical ? url.origin !== 'https://github.com' || url.pathname !== '/' : url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || !!url.search || !!url.hash || !!url.username || !!url.password)
            throw Error('Owned TLS fixture required');
        if (!captured.token || Buffer.byteLength(captured.token) > 8192 || /[\x00-\x20\x7f]/.test(captured.token) || !captured.credentialSessionId)
            throw Error('Finite captured HTTPS credential required');
        binary = await fs.realpath(profile.gitBinary);
        const stat = await fs.stat(binary), root = path.resolve(profile.ownedClientRoot);
        if (!path.isAbsolute(profile.ownedClientRoot) || !stat.isFile() || !(stat.mode & 0o111) || (stat.mode & 0o022) || (stat.uid !== 0 && stat.uid !== process.getuid?.()) || contains(root, binary))
            throw Error('Trusted HTTPS Git binary required');
        exec = await fs.realpath(captured.execPath);
        const helper = await fs.realpath(path.join(exec, 'git-remote-https'));
        for (const entry of [exec, helper]) {
            const item = await fs.stat(entry);
            if ((entry === exec ? !item.isDirectory() : !item.isFile() || !(item.mode & 0o111)) || (item.mode & 0o022) || (item.uid !== 0 && item.uid !== process.getuid?.()) || contains(root, entry))
                throw Error('Trusted installed HTTPS helper required');
        }
        if (!contains(exec, helper))
            throw Error('HTTPS helper escaped installed exec directory');
        if (!canonical) {
            ca = await fs.realpath(captured.caFile!);
            const caStat = await fs.lstat(ca);
            if (!caStat.isFile() || (caStat.mode & 0o022) || caStat.uid !== process.getuid?.())
                throw Error('Owned fixture CA required');
        }
        signal?.throwIfAborted();
    }
    catch (error) {
        throw new NativeGitNotAllocatedError(profile.ownedClientRoot, error);
    }
    const client = new OwnedNativeGit({ ...profile }, binary, { ...captured, origin: url.origin, execPath: exec, caFile: ca });
    try {
        await client.initialize(profile.resumeOwned ?? false, signal);
        signal?.throwIfAborted();
        return client;
    }
    catch (error) {
        try {
            await client.close();
        }
        catch (cleanupError) {
            throw new NativeGitCleanupError('Inspect original client ' + profile.ownedClientRoot + '; HTTPS initialization failed and cleanup remains unknown', new AggregateError([error, cleanupError]));
        }
        throw error;
    }
}
/** Original finite localhost fixture; extra caller properties cannot install setup authority. */
export function createOwnedHttpsGitFixture(profile: NativeGitProfile, options: OwnedHttpsOptions, signal?: AbortSignal): Promise<NativeGitClient> {
    return constructHttps(profile, { origin: options.origin, caFile: options.caFile, token: options.token, credentialSessionId: options.credentialSessionId, execPath: options.execPath }, false, signal);
}
const acceptanceCredentials = new WeakMap<object, string>();
/** Internal capture, never a token getter or a production activation. */
export function captureAcceptanceCredential(token: string): object {
    if (!token || Buffer.byteLength(token) > 8192 || /[\x00-\x20\x7f]/.test(token))
        throw Error('Finite captured credential required');
    const handle = Object.freeze({});
    acceptanceCredentials.set(handle, token);
    return handle;
}
export function openCreatedAcceptanceGit(context: CreatedAcceptanceContext, capture: object, profile: NativeGitProfile, execPath: string, owned?: {
    origin: string;
    caFile: string;
}, signal?: AbortSignal): Promise<NativeGitClient> {
    const resources = acceptanceContextResources(context);
    resources.assertNativeCapture(capture);
    const token = acceptanceCredentials.get(capture);
    if (!token)
        throw Error('Actual native credential capture required');
    return constructHttps(profile, { origin: owned?.origin ?? 'https://github.com', caFile: owned?.caFile, token, credentialSessionId: context.credentialSessionId, execPath, acceptanceSetup: true }, !owned, signal);
}
/** Internal fixed-sidecar protocol; no runtime capability is exported by these types. */
export interface AcceptanceSetupInput {
    target: HttpsGitTarget;
    step: 'bootstrap-main' | 'race-peer';
    expectedBase?: string;
    retainedCommit?: string;
}
export interface AcceptanceSetupOperations {
    observeInventory(target: HttpsGitTarget, signal: AbortSignal): Promise<{
        refs: {
            commit: string;
            ref: string;
        }[];
        commands: CommandReceipt[];
    }>;
    oid(value: string): string;
    fetchBasis(target: HttpsGitTarget, parent: string, signal: AbortSignal): Promise<unknown>;
    makeTree(files: Map<string, GitFile & {
        bytes: Buffer;
    }>, commands: CommandReceipt[], signal: AbortSignal): Promise<string>;
    run(args: string[], commands: CommandReceipt[], signal: AbortSignal, input?: Buffer): Promise<Buffer>;
    prepare(input: AcceptanceSetupInput, operationId: string, parent: string | undefined, commit: string, tree: string, signal: AbortSignal): Promise<PreparedHttpsSend & {
        tree: string;
    }>;
}

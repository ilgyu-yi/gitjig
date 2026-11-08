import { assertInitializedNativeGitProof, assertInitializedProofShape, captureInitializedNativeGitProof } from './native-initialized.js';
export { assertInitializedNativeGitProof } from './native-initialized.js';
import { inspectSourceCapture, assertSourceCapture, copySourceBlob, parseSourceOids, parseSourceTree, sourceContextRelation, sourcePublicationBaseline, sourceCaptureLimits, sourceHash, sourceStat, administration } from './source-snapshot-projection.js';
import { performance } from 'node:perf_hooks';
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
import { captureSourceGitEnvironment, sourcePolicyFile, type SourceConfigFacts } from './source-policy.js';
import type { SourceGitEnvironment, SourceBranchTarget, SourcePolicyFile, SourceBranchCreate, PreparedSourceBranchCreate, SourceBranchCreationReceipt, SourceBranchReconciliation, NativeGitLifecycle, NativeGitNamespaceProof, NativeGitInitializedProof, NativeGitInitializedResume, NativeGitOpenLifecycle, NativeGitOwnerIdentity, SourceBranchNoLaunchReference, SourceBranchPreparedReference, SourceBasisTree, SourceBasisEntry, SourceSnapshotProjectionInput, SourceSnapshotProjectionResult, SourceSnapshotBlob } from './types.js';
import type { CapturedTree, NativeGitProfile, ObjectFormat, LocalBareTarget, GitFile, CommandReceipt, ProjectionInput, ProjectionResult, IntegrationResult, ForwardSend, PreparedForwardSend, SendReceipt, LocalRefObservation, ForwardReconciliation } from './types.js';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const contains = (root: string, target: string) => target === root || target.startsWith(root + path.sep);
const text = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
function sourceReceivePack(binary: string): string {
    const executable = `'${binary.replaceAll("'", "'\\''")}'`;
    return `--receive-pack=${executable} -c gc.auto=0 -c maintenance.auto=false -c receive.autogc=false receive-pack`;
}
export function sourceGitArguments(repository: string, args: readonly string[]): string[] {
    return [`--git-dir=${repository}`, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'receive.autogc=false', ...args];
}
export function sourcePushArguments(binary: string, input: Pick<SourceBranchCreate,'integrationCommit'> & { target: Pick<SourceBranchTarget,'canonicalPath'|'destinationRef'> }): string[] {
    return ['push', '--porcelain', sourceReceivePack(binary), '--no-follow-tags', '--recurse-submodules=no',
        `--force-with-lease=${input.target.destinationRef}:`, '--', input.target.canonicalPath,
        `${input.integrationCommit}:${input.target.destinationRef}`];
}
function sourceCreationBinding(input: SourceBranchCreate) {
    return { operationId: input.operationId, integrationCommit: input.integrationCommit, destinationRef: input.target.destinationRef,
        ...(input.expectedSnapshot ? { expectedSnapshot: { tree: input.expectedSnapshot.tree, basisCommit: input.expectedSnapshot.basisCommit } } : {}) };
}
function sourceCommandEnvironment(binary: string, environment: SourceGitEnvironment): NodeJS.ProcessEnv {
    const captured = captureSourceGitEnvironment({ HOME: environment.home, ...(Object.hasOwn(environment, 'xdgConfigHome') ? { XDG_CONFIG_HOME: environment.xdgConfigHome } : {}) });
    return { HOME: captured.home, ...(captured.xdgConfigHome ? { XDG_CONFIG_HOME: captured.xdgConfigHome } : {}),
        PATH: `${path.dirname(binary)}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' };
}
function assertNamespace(proof: Readonly<NativeGitNamespaceProof>, root: string): void {
    if (proof.protocol !== 'owned-native-git-prebirth/v1' || proof.clientRoot !== root || proof.runsDirectory !== path.join(root, 'runs'))
        throw Error('Original native namespace correspondence differs');
    for (const [directory, device, inode, owner] of [[root, proof.device, proof.inode, proof.ownerUid],
        [proof.runsDirectory, proof.runsDevice, proof.runsInode, proof.runsOwnerUid]] as const) {
        const stat = fsSync.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || fsSync.realpathSync(directory) !== directory || stat.uid !== process.getuid?.() ||
            stat.uid !== owner || String(stat.dev) !== device || String(stat.ino) !== inode || stat.mode & 0o077)
            throw Error('Original native namespace identity changed');
    }
}
function synchronous(callback: () => unknown): void {
    const returned = callback();
    if (returned !== undefined) {
        void Promise.resolve(returned).catch(() => {});
        throw Error('Native lifecycle guard must return synchronously without a value');
    }
}
const sourceDirectoryIdentity = (s: fsSync.Stats) => JSON.stringify([s.dev,s.ino,s.uid,s.mode]);
function sourceCommandJournal(proof: NativeGitInitializedProof, commandId: string) {
    const root = proof.namespace.clientRoot, binary = proof.owner.gitBinary;
    assertInitializedProofShape(proof, { clientRoot: root, gitBinary: binary, objectFormat: proof.owner.objectFormat });
    assertNamespace(proof.namespace, root);
    if (!/^[a-f0-9-]{36}$/u.test(commandId)) throw Error('Exact prepared source command identity required');
    const directory = path.join(root, 'runs', commandId), initial = fsSync.lstatSync(directory);
    if (!initial.isDirectory() || initial.isSymbolicLink() || initial.uid !== process.getuid?.() || initial.mode & 0o077 || fsSync.realpathSync(directory) !== directory)
        throw Error('Original prepared source namespace unavailable');
    const readBytes = (name: string, max: number) => {
        const file = path.join(directory, name), named = fsSync.lstatSync(file);
        const fd = fsSync.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const stat = fsSync.fstatSync(fd);
            const same = (other: fsSync.Stats) => stat.dev === other.dev && stat.ino === other.ino && stat.mode === other.mode && stat.uid === other.uid && stat.nlink === other.nlink && stat.size === other.size && stat.mtimeMs === other.mtimeMs && stat.ctimeMs === other.ctimeMs;
            if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > max || !same(named))
                throw Error('Original prepared source journal leaf unavailable');
            const bytes = Buffer.alloc(stat.size + 1); let count = 0;
            while (count < bytes.length) { const n = fsSync.readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
            if (count !== stat.size || !same(fsSync.fstatSync(fd)) || !same(fsSync.lstatSync(file))) throw Error('Prepared source journal changed');
            const raw = bytes.subarray(0, count);
            return { bytes: raw, sha256: digest(raw), identity: sourceStat(stat) };
        } finally { fsSync.closeSync(fd); }
    };
    const assertCurrent = () => {
        if (sourceDirectoryIdentity(fsSync.lstatSync(directory)) !== sourceDirectoryIdentity(initial)) throw Error('Prepared source namespace changed');
        assertNamespace(proof.namespace, root);
    };
    return { directory, readBytes, read(name: string, max: number) { const observed = readBytes(name,max); return { ...observed, value: JSON.parse(text(observed.bytes)) }; }, assertCurrent, identity: sourceDirectoryIdentity(initial) };
}
function sourceDescriptor(proof: NativeGitInitializedProof, input: SourceBranchCreate, commandId: string) {
    const journal = sourceCommandJournal(proof, commandId), descriptor = journal.read('descriptor.json', 1024 * 1024);
    const d = descriptor.value, root = proof.namespace.clientRoot, binary = proof.owner.gitBinary;
    const argv = sourceGitArguments(path.join(root, 'client.git'),sourcePushArguments(binary, input));
    if (d.version !== 1 || d.commandId !== commandId || d.directory !== journal.directory || d.binary !== binary || d.cwd !== root || d.sourceDiagnostics !== true ||
        JSON.stringify(d.argv) !== JSON.stringify(argv) || JSON.stringify(d.env) !== JSON.stringify(sourceCommandEnvironment(binary, input.target.environment)) ||
        JSON.stringify(d.sourceCreation) !== JSON.stringify(sourceCreationBinding(input)) || d.inputBytes !== 0 || d.inputSha256 !== digest(EMPTY))
        throw Error('Original prepared source descriptor correspondence differs');
    journal.assertCurrent(); return { journal, descriptor };
}
/** Historical prepared-command correspondence only, never no-launch, success or authority. */
export function assertSourceBranchPrepared(proof: NativeGitInitializedProof, input: SourceBranchCreate, reference: SourceBranchPreparedReference): void {
    if (!reference || Object.keys(reference).sort().join() !== 'basisCommit,clientRoot,commandDirectoryIdentity,commandId,descriptorIdentity,descriptorSha256,destinationRef,integrationCommit,operationId,protocol,tree' ||
        reference.protocol !== 'source-branch-prepared/v1' || reference.clientRoot !== proof.namespace.clientRoot || !/^[a-f0-9]{64}$/u.test(reference.descriptorSha256) ||
        typeof reference.descriptorIdentity !== 'string' || Buffer.byteLength(reference.descriptorIdentity) > 1024 || typeof reference.commandDirectoryIdentity !== 'string' || Buffer.byteLength(reference.commandDirectoryIdentity) > 512 ||
        !input.expectedSnapshot || reference.operationId !== input.operationId || reference.integrationCommit !== input.integrationCommit || reference.destinationRef !== input.target.destinationRef ||
        reference.tree !== input.expectedSnapshot.tree || reference.basisCommit !== input.expectedSnapshot.basisCommit)
        throw Error('Original prepared source reference differs');
    const { journal, descriptor } = sourceDescriptor(proof, input, reference.commandId);
    if (descriptor.sha256 !== reference.descriptorSha256 || descriptor.identity !== reference.descriptorIdentity || journal.identity !== reference.commandDirectoryIdentity)
        throw Error('Original prepared source descriptor identity/reference differs');
}
function sourceNoLaunchReference(proof: NativeGitInitializedProof, input: SourceBranchCreate, commandId: string): SourceBranchNoLaunchReference {
    const { journal, descriptor } = sourceDescriptor(proof, input, commandId), terminal = journal.read('terminal.json', 16384), t = terminal.value;
    if (Object.keys(t).sort().join() !== 'cleanup,commandId,gitPid,gitStarted,pid,producer' || t.commandId !== commandId ||
        t.producer !== 'controller-no-launch' || t.pid !== null || t.gitPid !== null || t.gitStarted !== false || t.cleanup !== 'confirmed')
        throw Error('Original prepared source no-launch correspondence differs');
    for (const leaf of ['lifecycle.json', 'result.json']) {
        try { fsSync.lstatSync(path.join(journal.directory, leaf)); throw Error('No-launch record conflicts with actual native admission'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    journal.assertCurrent();
    return { commandId, descriptorSha256: descriptor.sha256, terminalSha256: terminal.sha256 };
}
/** Process-free no-send proof, not permission to retry. Source-policy drift does not erase an original no-launch fact. */
export function assertSourceBranchNoLaunch(proof: NativeGitInitializedProof, input: SourceBranchCreate, reference: SourceBranchNoLaunchReference): void {
    const actual = sourceNoLaunchReference(proof, input, reference.commandId);
    if (Object.keys(reference).sort().join() !== 'commandId,descriptorSha256,terminalSha256' ||
        !/^[a-f0-9]{64}$/u.test(reference.descriptorSha256) || !/^[a-f0-9]{64}$/u.test(reference.terminalSha256) ||
        actual.descriptorSha256 !== reference.descriptorSha256 || actual.terminalSha256 !== reference.terminalSha256)
        throw Error('Original prepared source no-launch reference differs');
}
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
/** Closed recorded porcelain predicate; caller must separately verify original journals and readback. */
export function createdSourceBranch(command: Pick<CommandReceipt,'settled'|'cleanup'|'exitCode'|'aborted'|'timedOut'|'truncated'|'stdoutExcerpted'|'stdout'>, commit: string, ref: string): boolean {
    if (typeof command.stdout !== 'string') return false;
    const rows = command.stdout.split('\n').filter(line => line.includes('\t')).map(line => line.split('\t'));
    return command.settled === true && command.cleanup === 'confirmed' && command.exitCode === 0 && command.aborted === false && command.timedOut === false &&
        command.truncated === false && command.stdoutExcerpted === false && rows.length === 1 && rows[0]!.length === 3 && rows[0]![0] === '*' &&
        rows[0]![1] === `${commit}:${ref}` && rows[0]![2] === '[new branch]' && command.stdout.trimEnd().endsWith('\nDone');
}
interface PolicyIdentity {
    configHash: string;
    hooksHash: string;
}
interface SourceCommandContext { environment: SourceGitEnvironment; repository: string; cwd: string; configTarget?: string; sourceCreation?: ReturnType<typeof sourceCreationBinding> }
interface SourceCommandProof {
    directories: readonly { directory: string; identity: string }[];
    leaves: readonly { file: string; identity: string }[];
}
function assertSourceCommandProof(proof: SourceCommandProof): void {
    for (const item of proof.directories) {
        const stat = fsSync.lstatSync(item.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || fsSync.realpathSync(item.directory) !== item.directory ||
            JSON.stringify([stat.dev, stat.ino, stat.uid, stat.mode]) !== item.identity)
            throw Error('Original projection command namespace changed before launcher');
    }
    for (const item of proof.leaves) if (sourceStat(fsSync.lstatSync(item.file)) !== item.identity)
        throw Error('Original projection spool leaf changed before launcher');
}
interface PreparedCommand {
    directory: string;
    descriptor: string;
    argv: string[];
    signal: AbortSignal;
    commandId: string;
    maxBytes: number;
    auth?: Buffer;
    projection?: SourceCommandProof;
    sourceDescriptor?: { sha256: string; identity: string; directoryIdentity: string };
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
    private readonly preparedSource = new WeakMap<PreparedSourceBranchCreate, { input: SourceBranchCreate; signal: AbortSignal; command: PreparedCommand; used: boolean }>();
    private namespace: Readonly<NativeGitNamespaceProof> | undefined;
    private nativeEnabled = false;
    private initialized: NativeGitInitializedProof | undefined;
    private repositoryIdentity: string | undefined;
    private readonly sourceProjections = new Set<symbol>();
    private closed = false;
    private closeResult: Promise<void> | undefined;
    private readonly running = new Set<Promise<unknown>>();
    private readonly unlaunched = new Set<PreparedCommand>();
    constructor(profile: NativeGitProfile, binary: string, private readonly https?: OwnedHttpsOptions, private readonly lifecycle?: NativeGitLifecycle, private readonly initializedResume?: NativeGitInitializedResume) {
        this.root = profile.ownedClientRoot;
        if (initializedResume) {
            this.namespace = structuredClone(initializedResume.initialized.namespace);
            this.initialized = structuredClone(initializedResume.initialized);
        }
        this.repo = path.join(this.root, 'client.git');
        this.home = path.join(this.root, 'home');
        this.hooks = path.join(this.root, 'no-hooks');
        this.gitBinary = binary;
        this.objectFormat = profile.objectFormat ?? 'sha1';
        if (!['sha1', 'sha256'].includes(this.objectFormat))
            throw new Error('Unsupported Git object format');
        this.maxEntries = positive(profile.maxEntries, sourceCaptureLimits.maxEntries, sourceCaptureLimits.maxEntries, 'entries');
        this.maxBytes = positive(profile.maxBytes, sourceCaptureLimits.maxBytes, sourceCaptureLimits.maxBytes, 'bytes');
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
    private sourceEnvironment(environment: SourceGitEnvironment): NodeJS.ProcessEnv {
        return sourceCommandEnvironment(this.gitBinary, environment);
    }
    /** Same durable command admission and native lifetime, with a closed policy-preserving route. */
    private sourceRun(args: readonly string[], context: SourceCommandContext, commands: CommandReceipt[], signal: AbortSignal): Promise<Run> {
        const pending = (async () => {
            const result = await this.launch(await this.prepareCommand(args, signal, undefined, this.outputLimit, undefined, false, context));
            commands.push(result.receipt);
            if (!result.receipt.settled || result.receipt.truncated || result.receipt.timedOut || result.receipt.aborted)
                throw Error('Source Git observation unavailable; retain original command journal');
            return result;
        })();
        this.running.add(pending);
        void pending.then(() => this.running.delete(pending), () => this.running.delete(pending));
        return pending;
    }
    private sourceFile(file: string, configurationAncestor = false): SourcePolicyFile { return sourcePolicyFile(file, configurationAncestor); }
    private assertSourceSnapshot(target: SourceBranchTarget, creating = true): void {
        this.assertOpen();
        if (target.kind !== 'source-new-branch' || target.objectFormat !== this.objectFormat ||
            target.gitDirectory !== path.join(target.canonicalPath, '.git') || target.commonDirectory !== target.gitDirectory ||
            !/^refs\/heads\//u.test(target.destinationRef)) throw Error('Unsupported source branch target');
        if (digest(JSON.stringify(target.identity)) !== target.policyFingerprint ||
            JSON.stringify(target.identity.map(entry => this.sourceFile(entry.path, entry.configurationAncestor === true))) !== JSON.stringify(target.identity))
            throw Error('Source Git policy identity changed');
        this.assertSourceHeads(target.commonDirectory, creating ? target.destinationRef : undefined);
    }
    private assertSourceHeads(common: string, destination: string | undefined): void {
        const roots = [common], worktrees = path.join(common, 'worktrees');
        try {
            const entries = fsSync.readdirSync(worktrees);
            if (entries.length > 128) throw Error('Source worktree census exceeds profile');
            for (const entry of entries) {
                const directory = path.join(worktrees, entry);
                if (this.sourceFile(directory).kind !== 'directory') throw Error('Source worktree metadata unavailable');
                roots.push(directory);
            }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        for (const root of roots) {
            const head = path.join(root, 'HEAD'); this.sourceFile(head);
            const fd = fsSync.openSync(head, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const stat = fsSync.fstatSync(fd), bytes = Buffer.alloc(4097);
                if (!stat.isFile() || stat.size > 4096) throw Error('Source worktree HEAD unavailable');
                const count = fsSync.readSync(fd, bytes, 0, bytes.length, 0);
                if (count !== stat.size) throw Error('Source worktree HEAD changed');
                if (destination && text(bytes.subarray(0, count)).trim() === `ref: ${destination}`)
                    throw Error('Destination is attached to an existing or unborn worktree');
            } finally { fsSync.closeSync(fd); }
        }
    }
    /** Observes a normal root repository. No permission, work admission or source ref write. */
    async observeSourceBranchTarget(input: { targetId: string; path: string; destinationRef: string }, environment: SourceGitEnvironment, signal?: AbortSignal): Promise<SourceBranchTarget> {
        return this.observeSourceTarget(input,environment,true,signal);
    }
    /** Current policy for an original read. Presence/checkout is not creation eligibility. */
    async observeSourceReadTarget(input: {targetId:string;path:string;destinationRef:string},environment:SourceGitEnvironment,signal?:AbortSignal):Promise<SourceBranchTarget>{
        return this.observeSourceTarget(input,environment,false,signal);
    }
    private async observeSourceTarget(input:{targetId:string;path:string;destinationRef:string},environment:SourceGitEnvironment,creating:boolean,signal?:AbortSignal):Promise<SourceBranchTarget>{
        if (typeof input.destinationRef !== 'string' || !input.destinationRef.startsWith('refs/heads/') ||
            Buffer.byteLength(input.destinationRef) > 1024 || /[\x00-\x20\x7f]/u.test(input.destinationRef))
            throw Error('Destination must be a bounded literal new branch');
        const bounded = this.finite(signal), commands: CommandReceipt[] = [];
        const canonicalPath = await fs.realpath(input.path), gitDirectory = path.join(canonicalPath, '.git');
        if (!input.targetId || input.targetId.length > 128 || canonicalPath !== path.resolve(input.path) || /[\x00-\x1f\x7f]/u.test(canonicalPath))
            throw Error('Source repository must be an exact canonical root');
        if (this.sourceFile(gitDirectory).kind !== 'directory') throw Error('Initial source profile requires a root .git directory');
        const selected = structuredClone(environment); this.sourceEnvironment(selected);
        const context: SourceCommandContext = { environment: selected, repository: gitDirectory, cwd: canonicalPath };
        const configCaptures: { context: SourceCommandContext; hash: string }[] = [];
        const read = async (args: string[], ctx = context) => {
            const result = await this.sourceRun(args, ctx, commands, bounded);
            if (result.receipt.exitCode !== 0) throw Error('Source Git metadata observation refused');
            return text(result.bytes).trim();
        };
        const paths = new Set([canonicalPath, gitDirectory, selected.home, this.gitBinary]), configPaths = new Set<string>();
        if (selected.xdgConfigHome) paths.add(selected.xdgConfigHome);
        for (const ctx of [context, { ...context, repository: this.repo, cwd: this.root }]) {
            const config = await this.sourceRun(['config', '--null', '--show-origin', '--show-scope', '--list', '--includes'], { ...ctx, configTarget: canonicalPath }, commands, bounded);
            const facts = JSON.parse(text(config.bytes)) as SourceConfigFacts;
            if (config.receipt.exitCode !== 0 || !config.receipt.sanitizedPolicyDiagnostics || facts.state !== 'observed' || facts.unsupported.length ||
                facts.denyCurrentBranch !== null && !['true', 'refuse'].includes(facts.denyCurrentBranch))
                throw Error('Source Git effective policy is outside the supported profile');
            configCaptures.push({ context: ctx, hash: facts.rawSha256 });
            if (facts.origins.length > 128) throw Error('Source config census exceeds profile');
            for (const origin of facts.origins) { const file = path.resolve(ctx.cwd, origin); paths.add(file); configPaths.add(file); }
            for (const variable of ['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL']) {
                const defaults = await read(['var', variable], ctx);
                for (const file of defaults.split('\n').filter(Boolean)) { const selectedFile = path.resolve(ctx.cwd, file); paths.add(selectedFile); configPaths.add(selectedFile); }
            }
            paths.add(path.join(ctx.repository, 'config'));
            const hookRoot = await read(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], ctx);
            paths.add(hookRoot);
            for (const name of ['pre-push', 'pre-receive', 'update', 'post-receive', 'post-update', 'reference-transaction', 'push-to-checkout']) {
                const file = path.join(hookRoot, name), fact = this.sourceFile(file); paths.add(file);
                if (fact.kind === 'file' && fact.mode! & 0o111) throw Error('Applicable Git hooks require a separately qualified profile');
            }
        }
        if (await read(['rev-parse', '--show-toplevel']) !== canonicalPath || await read(['rev-parse', '--is-bare-repository']) !== 'false' ||
            await read(['rev-parse', '--path-format=absolute', '--git-common-dir']) !== gitDirectory ||
            await read(['rev-parse', '--show-object-format']) !== this.objectFormat) throw Error('Source root/object/common-directory profile differs');
        await read(['check-ref-format', input.destinationRef]);
        if (!input.destinationRef.startsWith('refs/heads/')) throw Error('Destination must be a literal new branch');
        if(creating){
            const absent = await this.sourceRun(['show-ref', '--verify', '--quiet', input.destinationRef], context, commands, bounded);
            if (absent.receipt.exitCode !== 1) throw Error('Destination branch is present or unavailable');
        }
        for (const relative of ['objects/info/alternates', 'shallow', 'info/grafts']) {
            const file = path.join(gitDirectory, relative), fact = this.sourceFile(file); paths.add(file);
            if (fact.kind !== 'absent' && fsSync.statSync(file).size) throw Error('Source object indirection is outside this profile');
        }
        if (await read(['for-each-ref', '--format=%(refname)', 'refs/replace/'])) throw Error('Source replacement objects are outside this profile');
        const observedHead = this.oid(await read(['rev-parse', '--verify', 'HEAD']));
        const headRef = await this.sourceRun(['symbolic-ref', '--quiet', 'HEAD'], context, commands, bounded);
        if (![0, 1].includes(headRef.receipt.exitCode!)) throw Error('Source HEAD observation unavailable');
        const observedHeadRef = headRef.receipt.exitCode === 0 ? text(headRef.bytes).trim() : null;
        const directPaths = new Set(paths), configurationAncestors = new Set<string>();
        for (const file of [...paths]) {
            let parent = path.dirname(file);
            while (!fsSync.existsSync(parent)) parent = path.dirname(parent);
            if (fsSync.realpathSync(parent) !== parent) throw Error('Source policy ancestor is not canonical');
            if (parent !== path.parse(parent).root && !['/private/tmp', '/tmp'].includes(parent)) {
                paths.add(parent);
                if (configPaths.has(file) && !directPaths.has(parent)) configurationAncestors.add(parent);
            }
        }
        const identity = [...paths].sort().map(file => this.sourceFile(file, configurationAncestors.has(file)));
        const target: SourceBranchTarget = { kind: 'source-new-branch', targetId: input.targetId, canonicalPath, gitDirectory, commonDirectory: gitDirectory,
            objectFormat: this.objectFormat, destinationRef: input.destinationRef, observedHead, observedHeadRef, environment: selected,
            identity, policyFingerprint: digest(JSON.stringify(identity)) };
        // Bind the parsed effective policy to the captured files, rather than
        // accepting a file replacement between the first query and snapshot.
        for (const captured of configCaptures) {
            const again = await this.sourceRun(['config', '--null', '--show-origin', '--show-scope', '--list', '--includes'],
                { ...captured.context, configTarget: canonicalPath }, commands, bounded);
            const facts = JSON.parse(text(again.bytes)) as SourceConfigFacts;
            if (again.receipt.exitCode !== 0 || facts.state !== 'observed' || facts.rawSha256 !== captured.hash)
                throw Error('Source Git effective policy changed during observation');
            this.assertSourceSnapshot(target,creating);
        }
        this.assertSourceSnapshot(target,creating); bounded.throwIfAborted();
        return structuredClone(target);
    }
    async fetchSourceBasis(target: SourceBranchTarget, basis: string, signal?: AbortSignal): Promise<void> {
        const bounded = this.finite(signal), commands: CommandReceipt[] = [];
        await this.fetchSourceBasisInner(target, basis, commands, bounded);
    }
    private async fetchSourceBasisInner(target: SourceBranchTarget, basis: string, commands: CommandReceipt[], bounded: AbortSignal): Promise<void> {
        this.assertSourceSnapshot(target); this.oid(basis);
        const result = await this.sourceRun(['fetch', '--no-tags', '--no-recurse-submodules', '--', target.canonicalPath, basis],
            { environment: target.environment, repository: this.repo, cwd: this.root }, commands, bounded);
        this.assertSourceSnapshot(target);
        if (result.receipt.exitCode !== 0) throw Error('Source basis fetch refused');
        await this.commitTree(basis, commands, bounded);
    }
    async inspectSourceBasis(target: SourceBranchTarget, basisCommit: string, signal?: AbortSignal): Promise<SourceBasisTree> {
        const owned = structuredClone(target), bounded = this.finite(signal), commands: CommandReceipt[] = [];
        await this.fetchSourceBasisInner(owned, basisCommit, commands, bounded);
        const tree = await this.commitTree(basisCommit, commands, bounded);
        const bytes = await this.run(['ls-tree', '-r', '-l', '-z', '--full-tree', tree], commands, bounded);
        if (bytes.length && bytes.at(-1) !== 0) throw Error('Pinned source tree metadata is incomplete');
        const entries: SourceBasisEntry[] = [], seen = new Set<string>();
        for (const row of text(bytes).split('\0').slice(0, -1)) {
            const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]+) +([0-9]+|-)\t([\s\S]+)$/u.exec(row);
            if (!match || entries.length >= this.maxEntries) throw Error('Pinned source tree metadata is unsupported or exceeds its bound');
            const [, mode, type, objectId, sizeText, name] = match;
            this.oid(objectId!);
            if (!name || path.posix.isAbsolute(name) || Buffer.byteLength(name) > 4096 || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name))
                throw Error('Pinned source tree path is unsafe or duplicated');
            const size = sizeText === '-' ? null : Number(sizeText);
            if (mode === '160000' ? type !== 'commit' || size !== null : type !== 'blob' || size === null || !Number.isSafeInteger(size) || size < 0)
                throw Error('Pinned source tree type/size correspondence unavailable');
            seen.add(name);
            entries.push({ path: name, mode: mode as SourceBasisEntry['mode'], type: type as SourceBasisEntry['type'], objectId: objectId!, size });
        }
        this.assertSourceSnapshot(owned); bounded.throwIfAborted();
        return { basisCommit, objectFormat: this.objectFormat, tree, entries, commands };
    }
    async prepareSourceBranchCreate(input: SourceBranchCreate, signal: AbortSignal): Promise<PreparedSourceBranchCreate> {
        const bounded = this.finite(signal), owned = structuredClone(input), commands: CommandReceipt[] = [];
        this.assertSourceSnapshot(owned.target); await this.sourceSnapshotCommit(owned, commands, bounded);
        const current = await this.observeSourceBranchTarget({ targetId: owned.target.targetId, path: owned.target.canonicalPath, destinationRef: owned.target.destinationRef }, owned.target.environment, bounded);
        if (current.policyFingerprint !== owned.target.policyFingerprint) throw Error('Reviewed source policy changed');
        const command = await this.prepareCommand(sourcePushArguments(this.gitBinary, owned), bounded, undefined, this.outputLimit, undefined, false,
            { environment: owned.target.environment, repository: this.repo, cwd: this.root, ...(this.initialized ? { sourceCreation: sourceCreationBinding(owned) } : {}) });
        const handle = Object.freeze({ operationId: owned.operationId, target: structuredClone(owned.target), integrationCommit: owned.integrationCommit, commands: Object.freeze(commands) });
        this.preparedSource.set(handle, { input: owned, signal: bounded, command, used: false });
        return handle;
    }
    preparedSourceReference(handle: PreparedSourceBranchCreate): Readonly<SourceBranchPreparedReference> {
        const state = this.preparedSource.get(handle);
        if (!state || state.used || !this.initialized || !state.input.expectedSnapshot || !state.command.sourceDescriptor)
            throw Error('Original unused initialized source preparation required');
        this.assertAdmission(); state.signal.throwIfAborted();
        if (state.used) throw Error('Original unused initialized source preparation required after host guard');
        const reference: SourceBranchPreparedReference = { protocol: 'source-branch-prepared/v1', clientRoot: this.root,
            commandId: state.command.commandId, descriptorSha256: state.command.sourceDescriptor.sha256,
            descriptorIdentity: state.command.sourceDescriptor.identity, commandDirectoryIdentity: state.command.sourceDescriptor.directoryIdentity,
            operationId: state.input.operationId, integrationCommit: state.input.integrationCommit, destinationRef: state.input.target.destinationRef,
            tree: state.input.expectedSnapshot.tree, basisCommit: state.input.expectedSnapshot.basisCommit };
        assertSourceBranchPrepared(this.initialized, state.input, reference);
        return Object.freeze(reference);
    }
    spawnPreparedSourceBranchCreate(handle: PreparedSourceBranchCreate): Promise<SourceBranchCreationReceipt> {
        const state = this.preparedSource.get(handle);
        const refused = (reason: string): SourceBranchCreationReceipt => ({ operationId: handle.operationId, integrationCommit: handle.integrationCommit,
            destinationRef: handle.target.destinationRef, handoff: 'not-started', outcome: 'refused', reason });
        if (!state || state.used) return Promise.resolve(refused('Unknown or consumed prepared source handle'));
        state.used = true;
        try {
            state.signal.throwIfAborted(); this.assertSourceSnapshot(state.input.target);
            return this.launch(state.command).then(({ receipt: command }) => {
                const rows = command.stdout.split('\n').filter(line => line.includes('\t')).map(line => line.split('\t'));
                const complete = command.settled && !command.aborted && !command.timedOut && !command.truncated && !command.stdoutExcerpted;
                const exact = rows.length === 1 && rows[0]![1] === `${state.input.integrationCommit}:${state.input.target.destinationRef}` && command.stdout.trimEnd().endsWith('\nDone');
                const outcome: SourceBranchCreationReceipt['outcome'] = createdSourceBranch(command, state.input.integrationCommit, state.input.target.destinationRef) ? 'created' :
                    complete && exact && command.exitCode !== 0 && rows[0]![0] === '!' ? 'refused' : 'unknown';
                return { operationId: state.input.operationId, integrationCommit: state.input.integrationCommit, destinationRef: state.input.target.destinationRef, handoff: 'started' as const, outcome, command };
            });
        } catch {
            this.noLaunch(state.command);
            const result = refused('Source policy/cancellation changed before native birth');
            if (this.initialized) {
                const directory = fsSync.openSync(state.command.directory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { fsSync.fsyncSync(directory); } finally { fsSync.closeSync(directory); }
                // A changed descriptor cannot mint original no-launch evidence.
                // The scalar refusal still grants no retry permission.
                try {
                    this.assertPreparedSourceDescriptor(state.command);
                    result.notStarted = sourceNoLaunchReference(this.initialized, state.input, state.command.commandId);
                } catch { /* Original descriptor unavailable; keep its evidence held. */ }
            }
            return Promise.resolve(result);
        }
    }
    private preparedSourceCausal(input: SourceBranchCreate, reference: SourceBranchPreparedReference): boolean {
        if (!this.initialized) return false;
        assertSourceBranchPrepared(this.initialized,input,reference);
        const { journal, descriptor } = sourceDescriptor(this.initialized,input,reference.commandId), bounds = descriptor.value;
        if (![bounds.maxStdout,bounds.excerptBytes].every(v => Number.isSafeInteger(v) && v > 0 && v <= 16 * 1024 * 1024)) return false;
        const lifecycle = journal.read('lifecycle.json',16384).value, start = journal.read('git-start.json',16384).value;
        const result = journal.read('result.json',bounds.excerptBytes * 2 + 65536), terminal = journal.read('terminal.json',16384).value;
        const stdout = journal.readBytes('stdout.bin',Math.min(bounds.maxStdout,bounds.excerptBytes)), raw = result.value;
        const identity = (value: any) => value && value.commandId === reference.commandId && value.pid === lifecycle.pid && value.uid === lifecycle.uid && value.startIdentity === lifecycle.startIdentity;
        if (!lifecycle || !Number.isSafeInteger(lifecycle.pid) || lifecycle.pid < 1 || lifecycle.uid !== process.getuid?.() || typeof lifecycle.startIdentity !== 'string' || !lifecycle.startIdentity ||
            lifecycle.phase !== 'HELPER_READY' || lifecycle.gitPid !== null || !identity(start) || !Number.isSafeInteger(start.gitPid) || start.gitPid < 1 || start.gitStarted !== true ||
            !identity(raw?.identity) || raw.gitPid !== start.gitPid || raw.gitStarted !== true || !identity(terminal) || terminal.gitPid !== start.gitPid || terminal.gitStarted !== true || terminal.cleanup !== 'confirmed' ||
            raw.stdoutBytes !== stdout.bytes.length || raw.stdoutSha256 !== stdout.sha256 || raw.stdout !== text(stdout.bytes) || !createdSourceBranch(raw,input.integrationCommit,input.target.destinationRef)) return false;
        // A parent can die before acknowledging its already complete result.
        // Only ENOENT permits absence; present contradictory acknowledgments hold.
        try {
            const ack = journal.read('parent-closed.json',16384).value;
            if (!ack || Object.keys(ack).sort().join() !== 'commandId,pid,resultHash' || ack.commandId !== reference.commandId || ack.pid !== lifecycle.pid || ack.resultHash !== result.sha256) return false;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        journal.assertCurrent(); assertSourceBranchPrepared(this.initialized,input,reference);
        return true;
    }
    async reconcileSourceBranchCreate(input: SourceBranchCreate, receipt?: SourceBranchCreationReceipt | SourceBranchPreparedReference, signal?: AbortSignal): Promise<SourceBranchReconciliation> {
        const bounded = this.finite(signal), commands: CommandReceipt[] = [];
        this.assertSourceSnapshot(input.target, false); this.oid(input.integrationCommit);
        await this.sourceSnapshotCommit(input, commands, bounded);
        const result = await this.sourceRun(['show-ref', '--verify', '--hash', input.target.destinationRef],
            { environment: input.target.environment, repository: input.target.gitDirectory, cwd: input.target.canonicalPath }, commands, bounded);
        this.assertSourceSnapshot(input.target, false);
        const currentCommit = result.receipt.exitCode === 0 ? this.oid(text(result.bytes).trim()) : null;
        let causal = false;
        if (receipt && 'protocol' in receipt) {
            try { causal = this.preparedSourceCausal(input,receipt); } catch { /* Missing/contradictory causal evidence is not creation. */ }
        } else if (receipt?.handoff === 'started' && receipt.outcome === 'created' && receipt.operationId === input.operationId &&
            receipt.integrationCommit === input.integrationCommit && receipt.destinationRef === input.target.destinationRef && receipt.command) {
            const command = receipt.command, directory = path.join(this.root, 'runs', command.commandId);
            if (command.journalPath === directory && /^[-a-z0-9]+$/u.test(command.commandId)) {
                const descriptor = JSON.parse(text(await this.boundedFile(path.join(directory, 'descriptor.json'), 1024 * 1024)));
                const retained = JSON.parse(text(await this.boundedFile(path.join(directory, 'result.json'), this.outputLimit * 2 + 65536)));
                const bytes = await this.boundedFile(path.join(directory, 'stdout.bin'), this.outputLimit);
                const expected = sourcePushArguments(this.gitBinary, input);
                causal = descriptor.commandId === command.commandId && descriptor.binary === this.gitBinary && descriptor.sourceDiagnostics === true &&
                    JSON.stringify(descriptor.argv) === JSON.stringify(sourceGitArguments(this.repo,expected)) &&
                    JSON.stringify(descriptor.env) === JSON.stringify(this.sourceEnvironment(input.target.environment)) && descriptor.cwd === this.root &&
                    retained.identity?.commandId === command.commandId && retained.identity?.pid === command.launcherPid && retained.gitPid === command.gitPid &&
                    retained.cleanup === 'confirmed' && retained.stdoutSha256 === digest(bytes) && retained.stdoutBytes === bytes.length &&
                    retained.stdout === text(bytes) && retained.stdout === command.stdout && createdSourceBranch({ ...command, ...retained }, input.integrationCommit, input.target.destinationRef);
            }
        }
        this.assertSourceSnapshot(input.target, false); bounded.throwIfAborted();
        return { kind: currentCommit === input.integrationCommit ? causal ? 'confirmed-creation' : 'observed-desired-state' : 'unknown', currentCommit, commands,
            ...(receipt && 'protocol' in receipt && (!causal || currentCommit !== input.integrationCommit) ? { reason: !causal ? 'Original prepared-send journals are unavailable or contradictory; desired state alone is not creation' : 'Source ref no longer names the original snapshot' } : {}) };
    }
    private assertOpen() {
        if (this.closed)
            throw new Error('Owned Git client is closed');
    }
    private assertAdmission(): void {
        this.assertOpen();
        if (this.lifecycle || this.initializedResume) {
            if (!this.nativeEnabled || !this.namespace) throw Error('Original native factory gate is not enabled');
            assertNamespace(this.namespace, this.root);
            synchronous(() => (this.initializedResume ?? this.lifecycle)!.assertCurrent());
            this.assertOpen();
            assertNamespace(this.namespace, this.root);
            if (this.initializedResume) assertInitializedNativeGitProof(this.initializedResume.initialized, { clientRoot: this.root, gitBinary: this.gitBinary, objectFormat: this.objectFormat });
        }
        if (this.sourceProjections.size) {
            const stat = fsSync.lstatSync(this.repo);
            if (!this.repositoryIdentity || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022 ||
                fsSync.realpathSync(this.repo) !== this.repo || JSON.stringify([String(stat.dev), String(stat.ino)]) !== this.repositoryIdentity)
                throw Error('Original source projection repository changed before native admission');
        }
    }
    private oid(value: string): string {
        if (!(this.objectFormat === 'sha1' ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/).test(value))
            throw new Error('Malformed Git object identity');
        return value;
    }
    private async prepareCommand(args: readonly string[], signal: AbortSignal, stdin: Buffer | undefined, maxBytes: number, repo?: string, authenticated = false, source?: SourceCommandContext, projectionProof?: SourceCommandProof): Promise<PreparedCommand> {
        const projection = projectionProof ? structuredClone(projectionProof) : undefined;
        this.assertAdmission();
        if (projection) assertSourceCommandProof(projection);
        signal.throwIfAborted();
        const commandId = randomUUID(), directory = path.join(this.root, 'runs', commandId), argv = source ? sourceGitArguments(source.repository,args) : this.args(args, repo);
        if (authenticated) {
            if (!this.https)
                throw Error('Native HTTPS profile unavailable');
            argv.splice(argv.length - args.length, 0, '-c', 'protocol.file.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'core.fsmonitor=false', '-c', 'http.extraHeader=', '--config-env=http.extraHeader=GITJIG_HTTP_AUTH', ...(this.https.caFile ? ['-c', `http.sslCAInfo=${this.https.caFile}`] : []));
        }
        const runRoot = path.dirname(directory), runStat = await fs.lstat(runRoot);
        if (!runStat.isDirectory() || runStat.isSymbolicLink() || runStat.uid !== process.getuid?.() || (runStat.mode & 0o077) || await fs.realpath(runRoot) !== runRoot)
            throw new Error('Owned command namespace changed');
        await privateDirectory(directory);
        const sourceDirectory = source?.sourceCreation ? sourceDirectoryIdentity(await fs.lstat(directory)) : undefined;
        const input = stdin ?? EMPTY, descriptor = path.join(directory, 'descriptor.json');
        const write = async (file: string, bytes: Buffer | string) => {
            const handle = await fs.open(path.join(directory, file), 'wx', 0o600);
            try {
                await handle.writeFile(bytes);
                await handle.sync();
                if (sourceDirectory && file === 'descriptor.json') return sourceStat(await handle.stat());
            }
            finally {
                await handle.close();
            }
        };
        await write('stdin.bin', input);
        const descriptorBytes = JSON.stringify({ version: 1, parentPid: process.pid, commandId, directory, binary: this.gitBinary, argv, cwd: source?.cwd ?? this.root, env: source ? this.sourceEnvironment(source.environment) : authenticated ? { ...this.env, GIT_EXEC_PATH: this.https!.execPath } : this.env, ...(authenticated ? { authProfile: 'fd4-config-env-v1' } : {}), ...(source ? { sourceDiagnostics: true } : {}), ...(source?.sourceCreation ? { sourceCreation: source.sourceCreation } : {}), ...(source?.configTarget ? { sourcePolicyOutput: { targetPath: source.configTarget } } : {}), timeoutMs: this.timeout, maxStdout: maxBytes, excerptBytes: this.outputLimit, inputBytes: input.length, inputSha256: digest(input) });
        const descriptorIdentity = await write('descriptor.json', descriptorBytes);
        const admissionDirectory = await fs.open(directory, 'r');
        try {
            await admissionDirectory.sync();
        }
        finally {
            await admissionDirectory.close();
        }
        if (this.lifecycle || this.initializedResume) {
            const parent = await fs.open(runRoot, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try { await parent.sync(); }
            finally { await parent.close(); }
        }
        if (signal.aborted || this.closed) {
            await write('terminal.json', JSON.stringify({ commandId, producer: 'controller-no-launch', pid: null, gitPid: null, gitStarted: false, cleanup: 'confirmed' }));
            signal.throwIfAborted();
            throw new Error('Owned Git client closed before launcher');
        }
        const command: PreparedCommand = { directory, descriptor, argv, signal, commandId, maxBytes, ...(projection ? { projection } : {}), ...(authenticated ? { auth: Buffer.from(this.https!.token) } : {}),
            ...(sourceDirectory && descriptorIdentity ? { sourceDescriptor: { sha256: digest(descriptorBytes), identity: descriptorIdentity, directoryIdentity: sourceDirectory } } : {}) };
        this.unlaunched.add(command);
        if (this.lifecycle || this.initializedResume) {
            try { this.assertAdmission(); if (projection) assertSourceCommandProof(projection); signal.throwIfAborted(); }
            catch (error) { this.noLaunch(command); throw error; }
        }
        return command;
    }
    private assertPreparedSourceDescriptor(command: PreparedCommand): void {
        if (!command.sourceDescriptor) return;
        if (!this.initialized) throw Error('Original initialized source descriptor proof unavailable');
        const journal = sourceCommandJournal(this.initialized, command.commandId), descriptor = journal.read('descriptor.json', 1024 * 1024);
        if (journal.identity !== command.sourceDescriptor.directoryIdentity || descriptor.identity !== command.sourceDescriptor.identity || descriptor.sha256 !== command.sourceDescriptor.sha256)
            throw Error('Original prepared source descriptor identity/bytes changed before launcher');
        journal.assertCurrent();
    }
    private noLaunch(command: PreparedCommand): void {
        if (this.namespace) assertNamespace(this.namespace, this.root);
        if (command.sourceDescriptor && sourceDirectoryIdentity(fsSync.lstatSync(command.directory)) !== command.sourceDescriptor.directoryIdentity)
            throw Error('Original source command directory changed; no terminal written');
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
        this.assertAdmission();
        command.signal.throwIfAborted();
        if (command.projection) assertSourceCommandProof(command.projection);
        this.assertPreparedSourceDescriptor(command);
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
                    resolve({ bytes, receipt: { ...(raw.sanitizedPolicyDiagnostics === true ? { sanitizedPolicyDiagnostics: true as const } : {}), ...(raw.sanitizedAuthDiagnostics === true ? { sanitizedAuthDiagnostics: true as const } : {}), argv: command.argv, exitCode: raw.exitCode, stdout: raw.stdout, stderr: raw.stderr, truncated: raw.truncated, timedOut: raw.timedOut, aborted: raw.aborted, settled: raw.settled && raw.cleanup === 'confirmed', stdoutBytes: raw.stdoutBytes, stdoutSha256: raw.stdoutSha256, stdoutExcerpted: raw.stdoutExcerpted, commandId: command.commandId, journalPath: command.directory, launcherPid: child.pid ?? null, gitPid: raw.gitPid, gitStarted: raw.gitStarted, cleanup: raw.cleanup } });
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
    private start(args: readonly string[], signal?: AbortSignal, stdin?: Buffer, maxBytes = this.outputLimit, repo?: string, projection?: SourceCommandProof): Promise<Run> {
        const combined = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
        const result = (async () => this.launch(await this.prepareCommand(args, combined, stdin, maxBytes, repo, false, undefined, projection)))();
        this.running.add(result);
        void result.then(() => this.running.delete(result), () => this.running.delete(result));
        return result;
    }
    private async run(args: readonly string[], commands: CommandReceipt[], signal?: AbortSignal, stdin?: Buffer, limit?: number, repo?: string, projection?: SourceCommandProof): Promise<Buffer> {
        const result = await this.start(args, signal, stdin, limit, repo, projection);
        commands.push(result.receipt);
        if (result.receipt.exitCode !== 0 || result.receipt.truncated || !result.receipt.settled || result.receipt.timedOut || result.receipt.aborted)
            throw new Error(`Native Git command unavailable: ${args[0]} (${result.receipt.exitCode}): ${result.receipt.stderr}`);
        return result.bytes;
    }
    initializedProof(): Readonly<NativeGitInitializedProof> {
        this.assertAdmission();
        if (!this.initialized) throw Error('Original gated initialized proof unavailable');
        assertInitializedNativeGitProof(this.initialized, { clientRoot: this.root, gitBinary: this.gitBinary, objectFormat: this.objectFormat });
        return Object.freeze(structuredClone(this.initialized));
    }
    async initialize(resume = false, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.initializedResume) {
            if (!resume) throw Error('Initialized lifecycle requires existing resume profile');
            // This branch precedes privateDirectory: never create or repair a missing original.
            assertInitializedNativeGitProof(this.initializedResume.initialized, { clientRoot: this.root, gitBinary: this.gitBinary, objectFormat: this.objectFormat });
            synchronous(() => this.initializedResume!.assertCurrent());
            assertInitializedNativeGitProof(this.initializedResume.initialized, { clientRoot: this.root, gitBinary: this.gitBinary, objectFormat: this.objectFormat });
            await this.validateOwnedClient(signal);
            return;
        }
        if (this.lifecycle) {
            if (resume || this.lifecycle.exclusiveRoot !== true) throw Error('Gated native factory requires a fresh exclusive root');
            await fs.mkdir(this.root, { mode: 0o700 });
        }
        await privateDirectory(this.root);
        if (resume) {
            await this.validateOwnedClient();
            return;
        }
        if ((await fs.readdir(this.root)).length)
            throw new Error('Owned Git client directory must be empty');
        for (const directory of [this.home, this.hooks, path.join(this.root, 'runs')])
            await privateDirectory(directory);
        if (this.lifecycle) {
            const runsDirectory = path.join(this.root, 'runs');
            for (const directory of [runsDirectory, this.root, path.dirname(this.root)]) {
                const handle = await fs.open(directory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { await handle.sync(); }
                finally { await handle.close(); }
            }
            const root = fsSync.lstatSync(this.root), runs = fsSync.lstatSync(runsDirectory);
            this.namespace = Object.freeze({ protocol: 'owned-native-git-prebirth/v1', clientRoot: this.root,
                device: String(root.dev), inode: String(root.ino), ownerUid: root.uid, runsDirectory,
                runsDevice: String(runs.dev), runsInode: String(runs.ino), runsOwnerUid: runs.uid, gitBinary: this.gitBinary });
            assertNamespace(this.namespace, this.root);
            synchronous(() => this.lifecycle!.assertCurrent());
            synchronous(() => this.lifecycle!.beforeFirstCommand(this.namespace!));
            this.nativeEnabled = true;
            this.assertAdmission(); signal?.throwIfAborted();
        }
        const commands: CommandReceipt[] = [];
        const version = await this.run(['--version'], commands, signal);
        if (!/^git version 2\.55\.[0-9]+(?:\s|$)/.test(text(version)))
            throw new Error('Initial native Git profile requires observed Git2.55.x');
        await this.run(['init', '--bare', '--template=', `--object-format=${this.objectFormat}`, this.repo], commands, signal);
        signal?.throwIfAborted();
        await fs.mkdir(path.join(this.repo, 'info'), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(this.repo, 'info', 'attributes'), '* merge=text\n', { flag: 'wx', mode: 0o600 });
        const identity = await this.clientIdentity();
        this.repositoryIdentity = JSON.stringify([identity.repoDevice, identity.repoInode]);
        await fs.writeFile(path.join(this.root, 'native-owner.json'), JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
        if (this.lifecycle && this.namespace) {
            this.assertAdmission();
            this.initialized = captureInitializedNativeGitProof(this.namespace, identity);
            this.assertAdmission(); signal?.throwIfAborted();
        }
    }
    private async clientIdentity(): Promise<NativeGitOwnerIdentity> {
        const root = await fs.lstat(this.root), repo = await fs.lstat(this.repo), binary = await fs.stat(this.gitBinary);
        return { version: 1, root: this.root, rootDevice: String(root.dev), rootInode: String(root.ino), repoDevice: String(repo.dev), repoInode: String(repo.ino), gitBinary: this.gitBinary, binaryDevice: String(binary.dev), binaryInode: String(binary.ino), objectFormat: this.objectFormat, metadataDate: this.env.GIT_AUTHOR_DATE!, configHash: digest(await this.boundedFile(path.join(this.repo, 'config'), 256 * 1024)), attributesHash: digest(await this.boundedFile(path.join(this.repo, 'info', 'attributes'), 1024)) };
    }
    private async validateOwnedClient(signal?: AbortSignal) {
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
        if (this.initializedResume && JSON.stringify(marker) !== JSON.stringify(this.initializedResume.initialized.owner)) throw Error('Current marker is not the original initialized identity');
        const originalDate = this.initializedResume?.initialized.owner.metadataDate ?? marker.metadataDate;
        this.env.GIT_AUTHOR_DATE = originalDate;
        this.env.GIT_COMMITTER_DATE = originalDate;
        if (JSON.stringify(marker) !== JSON.stringify(await this.clientIdentity()))
            throw new Error('Owned Git marker/config/binary identity mismatch');
        this.repositoryIdentity = JSON.stringify([marker.repoDevice, marker.repoInode]);
        const recovery = await reconcileOwnedGitProcesses(this.root, 2500, this.initializedResume ? this.namespace : undefined);
        if (recovery.cleanup !== 'confirmed')
            throw new Error('Owned Git subprocess cleanup UNKNOWN; client quarantined: ' + JSON.stringify(recovery));
        if (this.initializedResume) {
            assertInitializedNativeGitProof(this.initializedResume.initialized, { clientRoot: this.root, gitBinary: this.gitBinary, objectFormat: this.objectFormat });
            signal?.throwIfAborted(); this.nativeEnabled = true; this.assertAdmission();
        }
        const commands: CommandReceipt[] = [];
        const version = text(await this.run(['--version'], commands, signal));
        if (!/^git version 2\.55\.[0-9]+(?:\s|$)/.test(version))
            throw new Error('Native Git version changed');
        if (text(await this.run(['rev-parse', '--show-object-format'], commands, signal)).trim() !== this.objectFormat)
            throw new Error('Owned Git format changed');
    }
    private async boundedFile(file: string, max: number): Promise<Buffer> {
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
    private async sourceSnapshotCommit(input: SourceBranchCreate, commands: CommandReceipt[], signal?: AbortSignal): Promise<void> {
        const expected = input.expectedSnapshot;
        if (!expected) {
            if (this.initializedResume) throw Error('Original initialized source snapshot tree/basis required');
            return this.operationCommit(input.integrationCommit, input.operationId, commands, signal);
        }
        if (Object.keys(expected).sort().join() !== 'basisCommit,tree') throw Error('Invalid expected source snapshot tuple');
        this.oid(expected.tree); this.oid(expected.basisCommit);
        const raw = await this.run(['cat-file', 'commit', this.oid(input.integrationCommit)], commands, signal, undefined, 16384);
        const actual = createHash(this.objectFormat).update(Buffer.from(`commit ${raw.length}\0`)).update(raw).digest('hex');
        const decoded = text(raw), separator = decoded.indexOf('\n\n'), headers = decoded.slice(0, separator).split('\n');
        if (actual !== input.integrationCommit || separator < 0 || headers.filter(line => line.startsWith('tree ')).join() !== `tree ${expected.tree}` ||
            headers.filter(line => line.startsWith('parent ')).join() !== `parent ${expected.basisCommit}` ||
            decoded.slice(separator + 2) !== `Owned Gitjig integration\nOperation: ${this.operationId(input.operationId)}\n`)
            throw Error('Original source snapshot commit/tree/sole-parent/operation correspondence differs');
    }
    private async commit(tree: string, parents: readonly string[], commands: CommandReceipt[], signal?: AbortSignal, operationId?: string, projection?: SourceCommandProof): Promise<string> {
        return this.oid(text(await this.run(['commit-tree', this.oid(tree), ...parents.flatMap(parent => ['-p', this.oid(parent)])], commands, signal, Buffer.from(operationId ? `Owned Gitjig integration\nOperation: ${this.operationId(operationId)}\n` : 'Owned Gitjig projection\n'), undefined, undefined, projection)).trim());
    }
    private async commitTree(commit: string, commands: CommandReceipt[], signal?: AbortSignal, projection?: SourceCommandProof): Promise<string> {
        this.oid(commit);
        if (text(await this.run(['cat-file', '-t', commit], commands, signal, undefined, undefined, undefined, projection)).trim() !== 'commit')
            throw new Error('Expected commit object');
        return this.oid(text(await this.run(['rev-parse', `${commit}^{tree}`], commands, signal, undefined, undefined, undefined, projection)).trim());
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
    private async merge(base: string, ours: string, theirs: string, commands: CommandReceipt[], signal?: AbortSignal, projection?: SourceCommandProof): Promise<string | null> {
        const result = await this.start(['merge-tree', '--write-tree', `--merge-base=${this.oid(base)}`, '-Xno-renames', this.oid(ours), this.oid(theirs)], signal, undefined, this.outputLimit, undefined, projection);
        commands.push(result.receipt);
        if (result.receipt.exitCode === 1 && !result.receipt.truncated && result.receipt.settled && !result.receipt.aborted && !result.receipt.timedOut)
            return null;
        if (result.receipt.exitCode !== 0 || result.receipt.truncated || !result.receipt.settled || result.receipt.aborted || result.receipt.timedOut)
            throw new Error('Native merge unavailable');
        const output = text(result.bytes).trim();
        return this.oid(output); // successful clean merge is one complete tree OID
    }
    projectSourceSnapshot(input: SourceSnapshotProjectionInput, signal?: AbortSignal): Promise<SourceSnapshotProjectionResult> {
        const captured = structuredClone(input), bounded = this.finite(signal);
        const commands: CommandReceipt[] = [], sourceVersions = { base: captured.base.versionId, candidate: captured.candidate.versionId };
        const token = Symbol('source-projection'); this.sourceProjections.add(token);
        // Track the complete filesystem/native tail before the first async action.
        // The tail never calls close() or awaits this.running (which contains itself).
        const task = Promise.resolve().then(async (): Promise<SourceSnapshotProjectionResult> => {
            try {
                const result = await this.sourceSnapshot(captured, bounded, commands);
                this.assertAdmission(); bounded.throwIfAborted();
                return result;
            }
            catch (error) { return { kind: 'unavailable', reason: String(error), sourceVersions, commands }; }
            finally { this.sourceProjections.delete(token); }
        });
        this.running.add(task);
        void task.then(() => this.running.delete(task), () => this.running.delete(task));
        return task;
    }
    private async sourceSnapshot(input: SourceSnapshotProjectionInput, signal: AbortSignal, commands: CommandReceipt[]): Promise<SourceSnapshotProjectionResult> {
        const started = performance.now(), sourceVersions = { base: input.base.versionId, candidate: input.candidate.versionId };
        this.assertAdmission(); signal.throwIfAborted(); this.operationId(input.operationId);
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input.previewId) || input.operationId !== 'source-preview-' + input.previewId || !/^[a-f0-9]{64}$/u.test(input.sourceInputDigest))
            throw Error('Original source preview identity unavailable');
        const allowed = new Set(input.authorizedDeltaPaths);
        if (allowed.size !== input.authorizedDeltaPaths.length || allowed.size > this.maxEntries) throw Error('Duplicate/oversized authorized delta');
        for (const name of allowed) relativeFile(name);
        const kTree = await this.commitTree(input.basisCommit, commands, signal);
        const metadata = async (tree: string, proof?: SourceCommandProof) => parseSourceTree(await this.run(['ls-tree', '-r', '-t', '-l', '-z', '--full-tree', this.oid(tree)], commands, signal, undefined, undefined, undefined, proof), this.objectFormat, this.maxEntries);
        const basisEntries = await metadata(kTree);
        const k = new Map(basisEntries.map(f => [f.path, f]));
        for (const entry of basisEntries) {
            relativeFile(entry.path);
            if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw Error('Source product link/gitlink unsupported');
        }
        const base = await inspectSourceCapture(input.base, this.maxEntries, this.maxBytes, signal);
        const candidate = await inspectSourceCapture(input.candidate, this.maxEntries, this.maxBytes, signal);
        const changed = new Set<string>();
        for (const name of new Set([...base.files.keys(), ...candidate.files.keys()])) {
            const a = base.files.get(name), b = candidate.files.get(name);
            if (a?.sha256 !== b?.sha256 || a?.effectiveMode !== b?.effectiveMode) {
                if (administration(name)) continue;
                relativeFile(name);
                if (!allowed.has(name)) return { kind: 'unsupported-scope', reason: 'Unconsented implementation delta: ' + name, sourceVersions, commands };
                changed.add(name);
            }
        }
        if (sourceHash(input.base.manifest.dependencyLinks ?? []) !== sourceHash(input.candidate.manifest.dependencyLinks ?? []))
            return { kind: 'unsupported-scope', reason: 'Changed dependency-link context unsupported in first source profile', sourceVersions, commands };
        const beforeDirs = new Set(input.base.manifest.directories.map(d => d.path)), afterDirs = new Set(input.candidate.manifest.directories.map(d => d.path));
        for (const dir of new Set([...beforeDirs, ...afterDirs])) if (beforeDirs.has(dir) !== afterDirs.has(dir) && !administration(dir) && ![...changed].some(name => name.startsWith(dir + '/')))
            return { kind: 'unsupported-scope', reason: 'Directory-only implementation change: ' + dir, sourceVersions, commands };
        for (const name of changed) if (!k.has(name) &&
            (base.files.has(name) && afterDirs.has(name) || candidate.files.has(name) && beforeDirs.has(name)))
            return { kind: 'unsupported-scope', reason: 'Untracked file/directory conversion unsupported: ' + name, sourceVersions, commands };
        const product = new Set([...k.keys(), ...changed]);
        if (product.size > this.maxEntries) throw Error('Source product inventory exceeds bound');
        for (const name of product) relativeFile(name);
        const directories: { directory: string; identity: string }[] = [];
        const captureDirectory = async (directory: string) => {
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022 || await fs.realpath(directory) !== directory)
                throw Error('Owned spool namespace unavailable');
            if (directory === this.repo && JSON.stringify([String(stat.dev), String(stat.ino)]) !== this.repositoryIdentity)
                throw Error('Original owned repository was replaced');
            directories.push({ directory, identity: JSON.stringify([stat.dev, stat.ino, stat.uid, stat.mode]) });
        };
        // Check each ancestor before creating any descendant. In particular an
        // EEXIST symlink parent never permits mkdir through a foreign target.
        await captureDirectory(this.root); await captureDirectory(this.repo);
        const pureNamespace = async (withoutInvocation = false) => {
            for (const item of directories) {
                if (withoutInvocation && item.directory === spool) continue;
                const stat = await fs.lstat(item.directory);
                if (!stat.isDirectory() || stat.isSymbolicLink() || JSON.stringify([stat.dev, stat.ino, stat.uid, stat.mode]) !== item.identity || await fs.realpath(item.directory) !== item.directory)
                    throw Error('Owned spool namespace changed; inert residue retained');
            }
        };
        const namespace = async () => { this.assertAdmission(); signal.throwIfAborted(); await pureNamespace(); };
        const parent = path.join(this.repo, 'gitjig-source-spool');
        await namespace();
        await fs.mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        await captureDirectory(parent); await namespace();
        const spool = path.join(parent, randomUUID());
        await fs.mkdir(spool, { mode: 0o700 });
        await captureDirectory(spool);
        const live = new Map<string, string>();
        const commandProof = (): SourceCommandProof => ({ directories: directories.map(item => ({ ...item })), leaves: [...live].map(([file, identity]) => ({ file, identity })) });
        const assertLeaves = async () => { for (const [file, identity] of live) if (sourceStat(await fs.lstat(file)) !== identity) throw Error('Owned spool leaf changed'); };
        const syncDir = async (directory: string) => {
            const handle = await fs.open(directory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try { await handle.sync(); } finally { await handle.close(); }
        };
        let spoolPeakBytes = 0, sampledPeakRssBytes = process.memoryUsage().rss;
        const blobs: SourceSnapshotBlob[] = [], byBody = new Map<string, string>(), imported = new Set(basisEntries.map(e => e.objectId));
        const sides = [{ side: 'base' as const, capture: base }, { side: 'candidate' as const, capture: candidate }];
        const records = sides.flatMap(({ side, capture }) => [...capture.files.values()].filter(f => product.has(f.path)).map(file => ({ side, capture, file })));
        let successful = false, failed = false, failure: unknown;
        try {
            let cursor = 0, serial = 0;
            while (cursor < records.length) {
                await namespace();
                const chunk: { record: typeof records[number]; aliases: typeof records; file: string; operand: string }[] = [];
                const stagedBodies = new Map<string, typeof chunk[number]>();
                let bytes = 0, pathBytes = 0;
                while (cursor < records.length) {
                    const record = records[cursor]!, key = record.file.sha256 + ':' + record.file.size;
                    const known = byBody.get(key);
                    if (known) {
                        blobs.push({ side: record.side, path: record.file.path, objectId: known, sha256: record.file.sha256, size: record.file.size, effectiveMode: record.file.effectiveMode });
                        cursor++; continue;
                    }
                    const staged = stagedBodies.get(key);
                    if (staged) { staged.aliases.push(record); cursor++; continue; }
                    if (chunk.length && (bytes + record.file.size > 8 * 1024 * 1024 || chunk.length >= 4096 || pathBytes + 128 > 256 * 1024)) break;
                    const file = path.join(spool, String(serial++));
                    const operand = path.relative(this.root, file).split(path.sep).join('/');
                    if (!/^client\.git\/gitjig-source-spool\/[a-f0-9-]+\/[0-9]+$/u.test(operand)) throw Error('Closed spool operand differs');
                    const identity = await copySourceBlob(record.capture, record.file, file, signal, pureNamespace);
                    live.set(file, identity);
                    const item = { record, aliases: [] as typeof records, file, operand };
                    chunk.push(item); stagedBodies.set(key, item);
                    bytes += record.file.size; pathBytes += Buffer.byteLength(operand) + 1; cursor++;
                }
                if (!chunk.length) continue;
                spoolPeakBytes = Math.max(spoolPeakBytes, bytes); sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
                await syncDir(spool); await syncDir(parent); await namespace(); await assertLeaves();
                const frame = Buffer.from(chunk.map(item => item.operand + '\n').join(''));
                const ids = parseSourceOids(await this.run(['hash-object', '--no-filters', '--stdin-paths'], commands, signal, frame, undefined, undefined, commandProof()), chunk.length, this.objectFormat);
                await assertLeaves(); await namespace();
                const write: number[] = [];
                for (let index = 0; index < chunk.length; index++) {
                    const { record } = chunk[index]!, objectId = ids[index]!;
                    const entry = record.file;
                    byBody.set(entry.sha256 + ':' + entry.size, objectId);
                    for (const original of [record, ...chunk[index]!.aliases])
                        blobs.push({ side: original.side, path: original.file.path, objectId, sha256: original.file.sha256, size: original.file.size, effectiveMode: original.file.effectiveMode });
                    if (!entry.opaque && !imported.has(objectId)) write.push(index);
                }
                if (write.length) {
                    await assertLeaves();
                    const importedIds = parseSourceOids(await this.run(['hash-object', '-w', '--no-filters', '--stdin-paths'], commands, signal,
                        Buffer.from(write.map(index => chunk[index]!.operand + '\n').join('')), undefined, undefined, commandProof()), write.length, this.objectFormat);
                    await assertLeaves(); await namespace();
                    write.forEach((index, position) => { if (importedIds[position] !== ids[index]) throw Error('Spool import hash differs'); imported.add(ids[index]!); });
                }
                for (const item of chunk) { await pureNamespace(); if (sourceStat(await fs.lstat(item.file)) !== live.get(item.file)) throw Error('Spool cleanup identity changed'); await fs.unlink(item.file); live.delete(item.file); }
            }
            const mappings = { base: new Map<string, string>(), candidate: new Map<string, string>() };
            for (const blob of blobs) mappings[blob.side].set(blob.path, blob.objectId);
            for (const { side, capture } of sides) for (const file of capture.files.values()) if (product.has(file.path) && file.opaque) {
                const original = k.get(file.path), other = (side === 'base' ? candidate : base).files.get(file.path);
                if (!original || original.objectId !== mappings[side].get(file.path) || original.mode !== (file.effectiveMode & 0o111 ? '100755' : '100644') ||
                    !other || other.sha256 !== file.sha256 || other.effectiveMode !== file.effectiveMode)
                    return { kind: 'unsupported-scope', reason: 'New/changed opaque product unsupported: ' + file.path, sourceVersions, commands };
            }
            const publication = sourcePublicationBaseline(product, new Set(k.keys()), blobs);
            const trees = await this.sourceTrees(sides.map(({ side, capture }) => ({ files: [...capture.files.values()].filter(f => product.has(f.path) && (side !== 'base' || !publication.omittedBasePaths.has(f.path))).map(file => ({ path: file.path, mode: file.effectiveMode & 0o111 ? '100755' : '100644', oid: mappings[side].get(file.path)! })) })), commands, signal, commandProof());
            const s = await this.commit(trees[0]!, [], commands, signal, undefined, commandProof()), c = await this.commit(trees[1]!, [s], commands, signal, undefined, commandProof()), syntheticK = await this.commit(kTree, [s], commands, signal, undefined, commandProof());
            const projectedTree = await this.merge(s, c, syntheticK, commands, signal, commandProof());
            if (!projectedTree) return { kind: 'conflict', reason: 'Native S/C/K source projection conflicts', sourceVersions, commands };
            const projectedEntries = await metadata(projectedTree, commandProof());
            for (const entry of projectedEntries) if (!['100644', '100755'].includes(entry.mode)) throw Error('Projected product representation unsupported');
            const relation = sourceContextRelation(input.candidate, product, projectedEntries, mappings.candidate);
            // Opaque carried K must remain the exact same object in H.
            for (const entry of projectedEntries) if (candidate.files.get(entry.path)?.opaque && entry.objectId !== k.get(entry.path)?.objectId) throw Error('Opaque projected identity changed');
            await assertSourceCapture(base, signal); await assertSourceCapture(candidate, signal); await namespace();
            const projectedCommit = await this.commit(projectedTree, [input.basisCommit], commands, signal, input.operationId, commandProof());
            if (await this.commitTree(projectedCommit, commands, signal, commandProof()) !== projectedTree) throw Error('Source projection commit roundtrip differs');
            await assertSourceCapture(base, signal); await assertSourceCapture(candidate, signal); await namespace();
            const effectiveDifferences = [];
            const h = new Map(projectedEntries.map(e => [e.path, e]));
            for (const name of new Set([...candidate.files.keys(), ...h.keys()])) {
                const a = candidate.files.get(name), b = h.get(name);
                if (!a || !b || mappings.candidate.get(name) !== b.objectId || !!(a.effectiveMode & 0o111) !== (b.mode === '100755'))
                    effectiveDifferences.push({ path: name, reason: !b ? 'Captured context excluded from Git product' : !a ? 'Git product absent from C' : 'Git product differs from C' });
            }
            for (const dir of input.candidate.manifest.directories) if (!projectedEntries.some(e => e.path.startsWith(dir.path + '/'))) effectiveDifferences.push({ path: dir.path, reason: 'Captured directory presence not delivered by Git' });
            for (const link of input.candidate.manifest.dependencyLinks ?? []) effectiveDifferences.push({ path: link.path, reason: 'Private dependency link not delivered by regular Git product' });
            const result: SourceSnapshotProjectionResult = { kind: 'projected', receipt: {
                protocol: 'source-context-projection/v2', publicationBaselineProfile: 'k-absent-whole-file/v1',
                publicationBaseTree: trees[0]!, wholeFileAdditions: publication.wholeFileAdditions, operationId: input.operationId, previewId: input.previewId, sourceInputDigest: input.sourceInputDigest,
                objectFormat: this.objectFormat, sourceVersions, sourceDigests: { base: input.base.digest, candidate: input.candidate.digest },
                manifestDigests: { base: input.base.manifest.digest, candidate: input.candidate.manifest.digest }, basisCommit: input.basisCommit, basisTree: kTree,
                syntheticBase: s, syntheticCandidate: c, projectedTree, projectedCommit,
                product: [...product].sort().map(name => ({ path: name, tracked: k.has(name), implementationDelta: changed.has(name) })),
                basisEntries, projectedEntries, blobs, effectiveDifferences,
                relation: { ...relation, modeProfile: 'retain-c-exec-mask-when-git-bit-agrees/v1', candidateDigest: input.candidate.digest,
                    productDigest: sourceHash([...product].sort()), contextDigest: sourceHash({ files: input.candidate.manifest.files.filter(f => !product.has(f.path)), directories: input.candidate.manifest.directories, links: input.candidate.manifest.dependencyLinks ?? [] }) },
                metrics: { spoolPeakBytes, elapsedMs: performance.now() - started, sampledPeakRssBytes }, commands
            } };
            if (Buffer.byteLength(JSON.stringify(result)) > this.maxBytes) throw Error('Source projection receipt exceeds existing finite metadata bound');
            successful = true;
            return result;
        } catch (error) { failed = true; failure = error; throw error; } finally {
            try {
                // An unresolved native reader may still reference its input files.
                if (commands.some(command => command.cleanup !== 'confirmed' || !command.settled))
                    throw Error('Original command cleanup UNKNOWN; retain its spool namespace');
                // Inert residue is distinct from process cleanup. Never delete a replacement leaf.
                await pureNamespace();
                for (const [file, identity] of live) { await pureNamespace(); if (sourceStat(await fs.lstat(file)) !== identity) throw Error('Owned spool residue identity changed'); await fs.unlink(file); }
                await pureNamespace();
                await fs.rmdir(spool);
                if (successful) {
                    await assertSourceCapture(base, signal); await assertSourceCapture(candidate, signal);
                    await pureNamespace(true); this.assertAdmission(); signal.throwIfAborted();
                }
            } catch (cleanupError) {
                throw new AggregateError(failed ? [failure, cleanupError] : [cleanupError],
                    'Source spool cleanup failed; ' + (failed ? 'original: ' + String(failure).slice(0, 2048) + '; ' : '') +
                    'residue: ' + String(cleanupError).slice(0, 2048));
            }
        }
    }
    private async sourceTrees(trees: { files: { path: string; mode: string; oid: string }[] }[], commands: CommandReceipt[], signal: AbortSignal, proof: SourceCommandProof): Promise<string[]> {
        const all: { tree: number; directory: string; rows: Map<string, { mode: string; kind: string; oid: string }> }[] = [];
        for (let tree = 0; tree < trees.length; tree++) {
            const nodes = new Map<string, Map<string, { mode: string; kind: string; oid: string }>>([['', new Map()]]);
            for (const file of trees[tree]!.files) {
                const parts = file.path.split('/'), name = parts.pop()!;
                let directory = '';
                for (const part of parts) {
                    const next = directory ? directory + '/' + part : part;
                    const prior = nodes.get(directory)!.get(part);
                    if (prior && prior.kind !== 'tree') throw Error('Product file/directory collision');
                    nodes.get(directory)!.set(part, { mode: '040000', kind: 'tree', oid: next });
                    if (!nodes.has(next)) nodes.set(next, new Map());
                    directory = next;
                }
                if (nodes.get(directory)!.has(name)) throw Error('Duplicate/colliding product leaf');
                nodes.get(directory)!.set(name, { mode: file.mode, kind: 'blob', oid: this.oid(file.oid) });
            }
            for (const [directory, rows] of nodes) all.push({ tree, directory, rows });
        }
        const ids = new Map<string, string>();
        const depth = (name: string) => name ? name.split('/').length : 0;
        for (let level = Math.max(...all.map(item => depth(item.directory))); level >= 0; level--) {
            const pending = all.filter(item => depth(item.directory) === level);
            while (pending.length) {
                const selected: typeof pending = [], frames: Buffer[] = [];
                let size = 0;
                while (pending.length && selected.length < 4096) {
                    const item = pending[0]!, rows: Buffer[] = [];
                    for (const [name, entry] of item.rows) {
                        const oid = entry.kind === 'tree' ? ids.get(item.tree + ':' + entry.oid) : entry.oid;
                        if (!oid) throw Error('Child tree batch mapping unavailable');
                        rows.push(Buffer.from(`${entry.mode} ${entry.kind} ${oid}\t${name}\0`));
                    }
                    const frame = Buffer.concat([...rows, Buffer.from([0])]);
                    if (frame.length > this.maxBytes) throw Error('Tree frame exceeds finite input bound');
                    if (selected.length && size + frame.length > 8 * 1024 * 1024) break;
                    pending.shift(); selected.push(item); frames.push(frame); size += frame.length;
                }
                const output = parseSourceOids(await this.run(['mktree', '--batch', '-z'], commands, signal, Buffer.concat(frames), undefined, undefined, proof), selected.length, this.objectFormat);
                selected.forEach((item, index) => ids.set(item.tree + ':' + item.directory, output[index]!));
            }
        }
        return trees.map((_, index) => ids.get(index + ':')!);
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
            const recovery = await reconcileOwnedGitProcesses(this.root, 2500, this.namespace);
            if (recovery.cleanup !== 'confirmed')
                throw new NativeGitCleanupError('Inspect original client ' + this.root + '; retain/quarantine its command journal', recovery);
        })();
        return this.closeResult;
    }
}
export type NativeGitClient = OwnedNativeGit;
export async function openNativeGit(profile: NativeGitProfile, signal?: AbortSignal, lifecycle?: NativeGitOpenLifecycle): Promise<NativeGitClient> {
    let binary: string;
    let capturedLifecycle: NativeGitLifecycle | undefined, capturedResume: NativeGitInitializedResume | undefined;
    try {
        signal?.throwIfAborted();
        if (lifecycle !== undefined && (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)))
            throw Error('Malformed present native lifecycle mode');
        if (lifecycle && 'kind' in lifecycle) {
            if (lifecycle.kind !== 'initialized-resume/v1' || Object.keys(lifecycle).sort().join() !== 'assertCurrent,initialized,kind' ||
                profile.resumeOwned !== true || typeof lifecycle.assertCurrent !== 'function') throw Error('Exact initialized resume lifecycle required');
            // New mode recipes and trusted callbacks are captured before the first await.
            profile = Object.freeze(structuredClone(profile));
            capturedResume = Object.freeze({ kind: 'initialized-resume/v1', initialized: structuredClone(lifecycle.initialized), assertCurrent: lifecycle.assertCurrent });
            assertInitializedProofShape(capturedResume.initialized, { clientRoot: profile.ownedClientRoot, gitBinary: capturedResume.initialized.owner.gitBinary, objectFormat: profile.objectFormat ?? 'sha1' });
        } else {
            if (lifecycle && (profile.resumeOwned || lifecycle.exclusiveRoot !== true || typeof lifecycle.beforeFirstCommand !== 'function' || typeof lifecycle.assertCurrent !== 'function'))
                throw Error('Fresh trusted native lifecycle callbacks required');
            if (lifecycle) capturedLifecycle = Object.freeze({ exclusiveRoot: true, beforeFirstCommand: lifecycle.beforeFirstCommand, assertCurrent: lifecycle.assertCurrent });
        }
        if (!path.isAbsolute(profile.gitBinary) || !path.isAbsolute(profile.ownedClientRoot) || path.resolve(profile.ownedClientRoot) !== profile.ownedClientRoot)
            throw new Error('Explicit absolute trusted Git/client paths required');
        binary = await fs.realpath(profile.gitBinary);
        const stat = await fs.stat(binary);
        if (!stat.isFile() || !(stat.mode & 0o111) || (stat.mode & 0o022) || (stat.uid !== 0 && stat.uid !== process.getuid?.()))
            throw new Error('Trusted Git executable ownership unsupported');
        const clientRoot = await fs.realpath(profile.ownedClientRoot).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return profile.ownedClientRoot;
            throw error;
        });
        if (contains(clientRoot, binary)) throw new Error('Trusted Git executable must be outside owned client root');
        if (capturedResume) assertInitializedNativeGitProof(capturedResume.initialized, { clientRoot: profile.ownedClientRoot, gitBinary: binary, objectFormat: profile.objectFormat ?? 'sha1' });
        signal?.throwIfAborted();
    } catch (error) {
        throw new NativeGitNotAllocatedError(profile.ownedClientRoot, error);
    }
    const client = new OwnedNativeGit({ ...profile }, binary, undefined, capturedLifecycle, capturedResume);
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
export async function reconcileOwnedGitProcesses(root: string, waitMs = 2500, expectedNamespace?: Readonly<NativeGitNamespaceProof>): Promise<OwnedGitProcessReconciliation> {
    const commands: {
        commandId: string;
        directory: string;
        cleanup: 'confirmed' | 'unknown';
        reason?: string;
    }[] = [];
    const readJson = (file: string, max = 65536) => {
        const fd = fsSync.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const stat = fsSync.fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > max)
                throw new Error('Unowned journal leaf');
            const bytes = Buffer.alloc(stat.size + 1);
            const count = fsSync.readSync(fd, bytes, 0, bytes.length, 0);
            if (count !== stat.size)
                throw new Error('Journal changed');
            const captured = bytes.subarray(0, count);
            return { value: JSON.parse(text(captured)), sha256: digest(captured) };
        }
        finally {
            fsSync.closeSync(fd);
        }
    };
    const json = (file: string, max = 65536) => readJson(file, max).value;
    try {
        if (expectedNamespace) assertNamespace(expectedNamespace, root);
        const stat = await fs.lstat(root);
        if (!path.isAbsolute(root) || await fs.realpath(root) !== root || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))
            throw new Error('Unowned command root');
        const runRoot = path.join(root, 'runs'), runStat = await fs.lstat(runRoot);
        if (!runStat.isDirectory() || runStat.isSymbolicLink() || runStat.uid !== process.getuid?.() || runStat.mode & 0o077 || await fs.realpath(runRoot) !== runRoot)
            throw Error('Unowned command namespace');
        const runs = await fs.readdir(runRoot);
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
                            const lifecycle = json(path.join(directory, 'lifecycle.json')), outcomeRead = readJson(path.join(directory, 'result.json'), 32 * 1024 * 1024 + 65536), outcome = outcomeRead.value;
                            if (terminal.pid !== lifecycle.pid || outcome.identity.pid !== lifecycle.pid || outcome.identity.commandId !== commandId || outcome.cleanup !== 'confirmed' || !Number.isSafeInteger(lifecycle.pid) || lifecycle.pid < 1)
                                throw new Error('Supervisor identity/result mismatch');
                            let acknowledged = false;
                            try {
                                const ack = json(path.join(directory, 'parent-closed.json'));
                                acknowledged = ack.commandId === commandId && ack.pid === lifecycle.pid && ack.resultHash === outcomeRead.sha256;
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
        if (expectedNamespace) assertNamespace(expectedNamespace, root);
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

import { createHash } from 'node:crypto';
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
export interface PiHostEnvironment {
    readonly stateRoot: string;
    readonly artifactRoot: string;
}
const environments = new WeakSet<PiHostEnvironment>();
let fixedArtifactRoot: string | undefined;
let fixedTemporaryPath: string | undefined;
export function inside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
async function ownedDirectory(path: string): Promise<string> {
    if (!isAbsolute(path))
        throw new Error("Pi host roots must be absolute");
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())) {
        throw new Error("Pi host roots must be owner-only real directories");
    }
    return realpath(path);
}
/** Call after setting one process-startup TMPDIR, before creating any session.
 * Never changes process environment, and never accepts a per-conversation temp. */
export async function initializePiHost(options: PiHostEnvironment): Promise<PiHostEnvironment> {
    const stateRoot = await ownedDirectory(options.stateRoot);
    const artifactRoot = await ownedDirectory(options.artifactRoot);
    if (inside(stateRoot, artifactRoot) || inside(artifactRoot, stateRoot)) {
        throw new Error("Pi state and helper artifact roots must be separate");
    }
    if (await realpath(tmpdir()) !== artifactRoot) {
        throw new Error("Start the process with TMPDIR set to the owned Pi artifact root");
    }
    if (fixedArtifactRoot && fixedArtifactRoot !== artifactRoot) {
        throw new Error("Pi helper artifact root is fixed for this process");
    }
    fixedArtifactRoot = artifactRoot;
    fixedTemporaryPath = resolve(tmpdir());
    const result = Object.freeze({ stateRoot, artifactRoot });
    environments.add(result);
    return result;
}
export function assertPiHost(host: PiHostEnvironment, workspace: string): void {
    if (!environments.has(host))
        throw new Error("Initialize the explicit Pi host environment first");
    if (resolve(tmpdir()) !== fixedTemporaryPath)
        throw new Error("Pi process helper temp routing changed after initialization");
    if (inside(workspace, host.stateRoot) || inside(workspace, host.artifactRoot) ||
        inside(host.stateRoot, workspace) || inside(host.artifactRoot, workspace)) {
        throw new Error("Pi host state/artifacts cannot be inside project work");
    }
}
export async function assertOwnedStateFile(path: string): Promise<void> {
    let info;
    try {
        info = await lstat(path);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return;
        throw error;
    }
    if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid()))
        throw new Error("Pi state files must be owner-only real files");
}
export async function ensurePiSessionDirectory(host: PiHostEnvironment): Promise<string> {
    const directory = join(host.stateRoot, "sessions");
    try {
        await lstat(directory);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
        // The direct parent is already validated. Recursive mkdir would follow an
        // existing sessions symlink and could create directories in project work.
        const { mkdir } = await import("node:fs/promises");
        try {
            await mkdir(directory, { mode: 0o700 });
        }
        catch (mkdirError) {
            if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
                throw mkdirError;
        }
    }
    const actual = await ownedDirectory(directory);
    if (actual !== directory)
        throw new Error("Native session directory cannot use path aliases");
    return actual;
}
export async function assertPiHistoryPath(host: PiHostEnvironment, path: string): Promise<void> {
    const absolute = resolve(path);
    if (!inside(host.stateRoot, absolute))
        throw new Error("Native history is outside the owned state root");
    const parent = await ownedDirectory(dirname(absolute));
    if (parent !== dirname(absolute) || !inside(host.stateRoot, parent)) {
        throw new Error("Native history parent must be canonical owned state, not a project alias");
    }
    let file;
    try {
        file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return;
        throw error;
    }
    try {
        const info = await file.stat();
        // Native Pi creates normal0644 leaves. A0700 canonical parent protects
        // their reads; reject mutable/linked leaves rather than breaking native
        // persistence or pretending an author-worktree alias is controller state.
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o022) !== 0 ||
            (process.getuid && info.uid !== process.getuid()))
            throw new Error("Native history leaf is not exclusively owned state");
    }
    finally {
        await file.close();
    }
}
/** Only native helper outputs actually returned by this session are readable.
 * There is no host-file fallback for ordinary project paths. */
export interface PiArtifactBinding { readonly sha256: string; readonly bytes: number; }
export class PiArtifacts {
    private readonly evidence = new Map<string, PiArtifactBinding>();
    private readonly artifactNames = new Map<string, string>();
    private readonly admitted = new Set<string>();
    constructor(private readonly host: PiHostEnvironment, private readonly maxBytes: number) { }
    assertEnvironment(workspace: string): void { assertPiHost(this.host, workspace); }
    async admit(path: string, expected?: PiArtifactBinding): Promise<void> {
        const binding = expected && Object.freeze({ sha256: expected.sha256, bytes: expected.bytes });
        if (binding && (!/^[a-f0-9]{64}$/.test(binding.sha256) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 1 || binding.bytes > this.maxBytes)) throw Error("Evidence artifact binding unavailable or exceeds read limit");
        const absolute = resolve(path);
        if (await realpath(dirname(absolute)) !== this.host.artifactRoot)
            throw new Error("Native helper output escaped its flat artifact root");
        const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await file.stat();
            if (!info.isFile() || (info.mode & 0o077) !== 0 ||
                (process.getuid && info.uid !== process.getuid()))
                throw new Error("Invalid native helper artifact");
        }
        finally {
            await file.close();
        }
        const canonical = await realpath(absolute);
        if (dirname(canonical) !== this.host.artifactRoot) throw Error('Artifact identity escaped its flat root');
        const inherited = this.binding(absolute), prior = this.evidence.get(canonical) ?? inherited;
        if (inherited && prior && (inherited.sha256 !== prior.sha256 || inherited.bytes !== prior.bytes)) throw Error('Evidence artifact aliases disagree');
        if (prior && binding && (prior.sha256 !== binding.sha256 || prior.bytes !== binding.bytes)) throw Error("Evidence artifact binding changed");
        if (binding) await this.readSnapshot(absolute, binding);
        if (binding ?? prior) this.evidence.set(canonical, (binding ?? prior)!);
        for (const spelling of [absolute, join(this.host.artifactRoot, basename(absolute))]) {
            this.artifactNames.set(spelling, canonical);
            this.admitted.add(spelling);
        }
    }
    has(path: string): boolean { return this.admitted.has(resolve(path)); }
    binding(path: string): PiArtifactBinding | undefined {
        const canonical = this.artifactNames.get(resolve(path));
        return this.has(path) && canonical ? this.evidence.get(canonical) : undefined;
    }
    async read(path: string): Promise<Buffer> {
        const absolute = resolve(path);
        if (!this.has(absolute))
            throw new Error("Unregistered host artifact");
        return this.readSnapshot(absolute, this.binding(absolute));
    }
    private async readSnapshot(absolute: string, binding?: PiArtifactBinding): Promise<Buffer> {
        if (await realpath(dirname(absolute)) !== this.host.artifactRoot)
            throw new Error("Artifact parent changed");
        const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await file.stat();
            if (!info.isFile() || info.size > this.maxBytes || (info.mode & 0o077) !== 0 ||
                (process.getuid && info.uid !== process.getuid()))
                throw new Error("Artifact unavailable or over read limit");
            if (binding && (info.nlink !== 1 || info.size !== binding.bytes)) throw Error("Evidence artifact identity changed");
            const bytes = Buffer.alloc(Math.min(info.size + 1, this.maxBytes + 1));
            let count = 0;
            while (count < bytes.length) {
                const read = await file.read(bytes, count, bytes.length - count, count);
                if (!read.bytesRead)
                    break;
                count += read.bytesRead;
            }
            const after = await file.stat();
            if (count > this.maxBytes || count !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
                throw new Error("Artifact exceeds read limit or changed during read");
            }
            const snapshot = bytes.subarray(0, count);
            if (binding && createHash("sha256").update(snapshot).digest("hex") !== binding.sha256) throw Error("Evidence artifact content changed");
            return snapshot;
        }
        finally {
            await file.close();
        }
    }
}

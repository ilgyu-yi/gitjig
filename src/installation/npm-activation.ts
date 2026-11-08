import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireOwner, privateDirectory, type OwnerLease } from '../controller/ownership.js';
import { inventoryTree, assetIdentity, type Asset } from './tree.js';

type Snapshot = { kind: 'missing' } | { kind: 'directory' | 'link'; dev: number; ino: number; mode: number; target?: string };
interface Candidate { format: 1; prefix: string; id: string; artifact: string; inventory: string; root: Snapshot }
interface Pending { format: 1; prefix: string; candidate: Candidate; previous: Snapshot; bin: Snapshot; next: Snapshot; nextBin: Snapshot }
export interface NpmActivationOptions {
    prefix: string;
    artifactHash: string;
    /** Confirms the one-time legacy stop/no-concurrent-launch precondition; no process census is implied. */
    migrateLegacy: boolean;
    install(prefix: string): Promise<void>;
    verify(entry: string): Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unavailable = (message: string) => Error('SOURCE_INSTALLATION_HELD: ' + message);
async function directory(file: string, owned = false) {
    let created = false;
    try { await fs.mkdir(file, { mode: 0o755 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (created) await fs.chmod(file, 0o755);
    const stat = await fs.lstat(file);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file || (owned && (stat.uid !== process.getuid?.() || stat.mode & 0o022)))
        throw unavailable('Unsafe installation directory: ' + file);
}
async function snapshot(file: string): Promise<Snapshot> {
    let stat;
    try { stat = await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }; throw error; }
    if (stat.uid !== process.getuid?.()) throw unavailable('Installation path has another owner: ' + file);
    if (stat.isSymbolicLink()) return { kind: 'link', dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777, target: await fs.readlink(file) };
    if (stat.isDirectory()) return { kind: 'directory', dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 };
    throw unavailable('Unexpected installation path type: ' + file);
}
async function readJson(file: string, maximumBytes = 16384): Promise<unknown> {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o022 || stat.size > maximumBytes)
            throw unavailable('Unsafe installation metadata: ' + file);
        const text = await handle.readFile('utf8');
        try { return JSON.parse(text); }
        catch { throw unavailable('Invalid JSON installation metadata: ' + file + '. Preserve the original file and inspect this path before retrying.'); }
    } finally { await handle.close(); }
}
async function syncDirectory(file: string) {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
}
/** Flush only the fresh npm prefix; retained versions and caller files remain untouched. */
async function syncVersion(root: string, assets: readonly Asset[]) {
    for (const asset of assets) {
        if (asset.kind !== 'file') continue;
        const handle = await fs.open(path.join(root, asset.path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size !== asset.bytes) throw unavailable('Staged asset changed before flush');
            await handle.sync();
        } finally { await handle.close(); }
    }
    for (const asset of [...assets].reverse()) if (asset.kind === 'directory') await syncDirectory(path.join(root, asset.path));
    await syncDirectory(root);
    await syncDirectory(path.dirname(root));
}
async function writeJson(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID();
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
}
function validSnapshot(value: unknown): value is Snapshot {
    const v = value as Snapshot | undefined;
    return !!v && (v.kind === 'missing' || (['directory', 'link'].includes(v.kind) &&
        Number.isSafeInteger((v as {mode: number}).mode) && (v as {mode: number}).mode >= 0 && (v as {mode: number}).mode <= 0o777 && Number.isSafeInteger((v as {dev: number}).dev) && Number.isSafeInteger((v as {ino: number}).ino) &&
        (v.kind !== 'link' || typeof v.target === 'string')));
}
function validCandidate(value: unknown, prefix: string): value is Candidate {
    const v = value as Candidate | undefined;
    return !!v && v.format === 1 && v.prefix === prefix && uuid.test(v.id) && digest.test(v.artifact) && digest.test(v.inventory) &&
        validSnapshot(v.root) && v.root.kind === 'directory';
}

/** Source/npm activation only. It never opens application data or changes the bound offline installation. */
export async function activateNpmPayload(options: NpmActivationOptions) {
    if (!digest.test(options.artifactHash)) throw unavailable('Invalid source archive identity');
    if (!path.isAbsolute(options.prefix)) throw unavailable('Installation prefix must be absolute');
    await fs.mkdir(options.prefix, {recursive: true});
    const prefix = await fs.realpath(options.prefix);
    await directory(prefix);
    for (const relative of ['lib', 'lib/node_modules', 'bin']) await directory(path.join(prefix, relative));
    const root = path.join(prefix, 'lib/gitjig-versions'), state = path.join(root, 'state');
    const marker = { format: 1, prefix, kind: 'gitjig-source-npm' };
    // mkdir is the no-overwrite claim. A partial/foreign namespace is refused,
    // rather than being adopted or replaced after an interrupted initialization.
    let created = false;
    try { await fs.mkdir(root, {mode: 0o755}); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (created) {
        await fs.chmod(root, 0o755);
        await fs.mkdir(state, {mode: 0o700});
        await writeJson(path.join(root, 'marker.json'), marker);
        await syncDirectory(path.dirname(root));
    }
    await directory(root, true);
    if (!equal(await readJson(path.join(root, 'marker.json')), marker)) throw unavailable('Foreign version namespace: ' + root);
    await privateDirectory(state);
    const release = await acquireOwner(state);
    try { return await activateOwned(options, prefix, root, state, release); }
    finally { await release(); }
}
async function activateOwned(options: NpmActivationOptions, prefix: string, root: string, state: string, owner: OwnerLease) {
    const active = path.join(prefix, 'lib/node_modules/gitjig'), bin = path.join(prefix, 'bin/gitjig');
    const pendingFile = path.join(state, 'pending.json');
    const version = (id: string) => path.join(root, id);
    const payload = (id: string) => path.join(version(id), 'lib/node_modules/gitjig');
    const registration = (id: string) => path.join(version(id), 'command');
    const receiptFile = (id: string) => path.join(state, id + '.json');
    const activeTemp = (id: string) => path.join(state, id + '.active');
    const binTemp = (id: string) => path.join(state, id + '.bin');
    const legacy = (id: string) => path.join(root, 'legacy-' + id);
    const binTarget = '../lib/node_modules/gitjig/dist/cli/entry.js';
    const assertLayout = async () => {
        owner.assertCurrent();
        for (const directoryPath of [prefix, path.join(prefix, 'lib'), path.join(prefix, 'lib/node_modules'), path.join(prefix, 'bin'), root])
            if (await fs.realpath(directoryPath) !== directoryPath) throw unavailable('Installation layout changed: ' + directoryPath);
        if (!equal(await readJson(path.join(root, 'marker.json')), {format: 1, prefix, kind: 'gitjig-source-npm'})) throw unavailable('Version namespace changed');
    };
    const validateCandidate = async (candidate: Candidate) => {
        try {
            if (!equal(await readJson(receiptFile(candidate.id)), candidate) || !equal(await snapshot(version(candidate.id)), candidate.root) ||
                await fs.realpath(payload(candidate.id)) !== payload(candidate.id) ||
                assetIdentity(await inventoryTree(version(candidate.id))) !== candidate.inventory)
                throw Error('Receipt, directory or full payload inventory differs');
        } catch (error) {
            throw unavailable('Staged payload unavailable or changed: ' + version(candidate.id) + '. Retain the pending activation and restore its exact candidate before retrying. ' + String(error));
        }
        await assertLayout();
    };
    const finish = async (pending: Pending) => {
        const candidate = pending.candidate, id = candidate.id;
        if (pending.next.kind !== 'link' || ![payload(id), registration(id)].some(target => pending.next.kind === 'link' && pending.next.target === path.relative(path.dirname(active), target)) ||
            pending.nextBin.kind !== 'link' || pending.nextBin.target !== binTarget)
            throw unavailable('Invalid pending installation links');
        await validateCandidate(candidate);
        const selectedPackage = path.resolve(path.dirname(active), pending.next.target!);
        if (await fs.realpath(selectedPackage) !== selectedPackage ||
            await fs.realpath(path.join(selectedPackage, 'dist/cli/entry.js')) !== path.join(payload(id), 'dist/cli/entry.js'))
            throw unavailable('Pending command registration differs from the recorded program');
        let current = await snapshot(active);
        const currentBin = await snapshot(bin);
        if (!equal(currentBin, pending.bin) && !equal(currentBin, pending.nextBin)) throw unavailable('Command path changed during activation: ' + bin);
        if (!equal(current, pending.next)) {
            if (pending.previous.kind === 'directory') {
                const saved = await snapshot(legacy(id));
                if (equal(current, pending.previous) && saved.kind === 'missing') {
                    // Legacy migration alone has an explicit no-concurrent-launch precondition.
                    await fs.rename(active, legacy(id));
                    await syncDirectory(path.dirname(active));
                    await syncDirectory(root);
                    current = {kind: 'missing'};
                } else if (!(current.kind === 'missing' && equal(saved, pending.previous))) throw unavailable('Legacy package changed during migration');
            } else if (!equal(current, pending.previous)) throw unavailable('Active package changed during activation');
            if (!equal(await snapshot(activeTemp(id)), pending.next)) throw unavailable('Prepared package link changed');
            await assertLayout();
            await fs.rename(activeTemp(id), active);
            await syncDirectory(path.dirname(active));
            await syncDirectory(state);
        }
        if (!equal(await snapshot(bin), pending.nextBin)) {
            if (!equal(await snapshot(bin), pending.bin) || !equal(await snapshot(binTemp(id)), pending.nextBin)) throw unavailable('Prepared command link changed');
            await assertLayout();
            await fs.rename(binTemp(id), bin);
            await syncDirectory(path.dirname(bin));
            await syncDirectory(state);
        }
        await assertLayout();
        if (!equal(await snapshot(active), pending.next) || !equal(await snapshot(bin), pending.nextBin)) throw unavailable('Activation readback changed');
        await fs.unlink(pendingFile);
        await syncDirectory(state);
    };
    let recovered: string | undefined, retainedPending: unknown;
    try { retainedPending = await readJson(pendingFile); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (retainedPending !== undefined) {
        const pending = retainedPending as Pending;
        if (!pending || pending.format !== 1 || pending.prefix !== prefix || !validCandidate(pending.candidate, prefix) ||
            ![pending.previous, pending.bin, pending.next, pending.nextBin].every(validSnapshot)) throw unavailable('Invalid pending activation: ' + pendingFile);
        await finish(pending); recovered = pending.candidate.id;
    }
    const previous = await snapshot(active), previousBin = await snapshot(bin);
    if (previousBin.kind !== 'missing' && (previousBin.kind !== 'link' || previousBin.target !== binTarget))
        throw unavailable('Refusing to replace an unrelated command: ' + bin);
    if (previous.kind === 'directory') {
        if (!options.migrateLegacy) throw unavailable('Legacy npm package found. Close all sessions using this prefix and rerun with --migrate-legacy; the flag confirms they are stopped and no new session will start until migration finishes.');
        const pkg = await readJson(path.join(active, 'package.json'), 1024 * 1024) as {name?: unknown};
        if (pkg?.name !== 'gitjig') throw unavailable('Legacy package identity unavailable or different at ' + path.join(active, 'package.json') + '; inspect the original package or select another prefix.');
    } else if (previous.kind === 'link') {
        const target = path.resolve(path.dirname(active), previous.target!);
        const id = path.relative(root, target).split(path.sep)[0]!;
        if (!uuid.test(id) || target !== payload(id) && target !== registration(id)) throw unavailable('Refusing to replace an unrelated package link: ' + active);
        const receipt = await readJson(receiptFile(id));
        if (!validCandidate(receipt, prefix) || receipt.id !== id) throw unavailable('Active version has no matching receipt');
    }
    const id = randomUUID();
    await fs.mkdir(version(id), {mode: 0o755});
    await fs.chmod(version(id), 0o755);
    const stagedRoot = await snapshot(version(id));
    await options.install(version(id));
    if (!equal(await snapshot(version(id)), stagedRoot)) throw unavailable('Staging directory changed');
    await assertLayout();
    if (!equal(await snapshot(active), previous) || !equal(await snapshot(bin), previousBin)) throw unavailable('Installation paths changed while staging; original paths were not replaced');
    if (await fs.realpath(payload(id)) !== payload(id)) throw unavailable('Staged package is not canonical');
    // npm may sweep nested dependency .bin links while removing a linked package.
    // Expose only command metadata to npm; keep the actual dependency tree separate.
    const pkg = await readJson(path.join(payload(id), 'package.json'), 1024 * 1024) as {name?: unknown; version?: unknown};
    if (pkg?.name !== 'gitjig' || typeof pkg.version !== 'string' || !pkg.version) throw unavailable('Staged package identity is unavailable');
    await fs.mkdir(registration(id), {mode: 0o755});
    await fs.chmod(registration(id), 0o755);
    for (const relative of ['dist', 'dist/cli']) await directory(path.join(registration(id), relative), true);
    const metadata = await fs.open(path.join(registration(id), 'package.json'), 'wx', 0o644);
    try {
        await metadata.chmod(0o644);
        await metadata.writeFile(JSON.stringify({name: 'gitjig', version: pkg.version, private: true, type: 'module', bin: {gitjig: 'dist/cli/entry.js'}}));
    } finally { await metadata.close(); }
    await fs.symlink(path.relative(path.join(registration(id), 'dist/cli'), path.join(payload(id), 'dist/cli/entry.js')), path.join(registration(id), 'dist/cli/entry.js'));
    for (const name of ['runtime', 'docs', 'vendor', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        try { await fs.lstat(path.join(payload(id), name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        await fs.symlink(path.relative(registration(id), path.join(payload(id), name)), path.join(registration(id), name));
    }
    const assets = await inventoryTree(version(id));
    await syncVersion(version(id), assets);
    const candidate: Candidate = {format: 1, prefix, id, artifact: options.artifactHash, root: stagedRoot, inventory: assetIdentity(assets)};
    await options.verify(path.join(payload(id), 'dist/cli/entry.js'));
    await writeJson(receiptFile(id), candidate);
    await fs.symlink(path.relative(path.dirname(active), registration(id)), activeTemp(id));
    await fs.symlink(binTarget, binTemp(id));
    const pending: Pending = {format: 1, prefix, candidate, previous, bin: previousBin, next: await snapshot(activeTemp(id)), nextBin: await snapshot(binTemp(id))};
    await assertLayout();
    if (!equal(await snapshot(active), previous) || !equal(await snapshot(bin), previousBin)) throw unavailable('Installation paths changed before activation');
    await writeJson(pendingFile, pending);
    await finish(pending);
    return {prefix, entry: path.join(payload(id), 'dist/cli/entry.js'), versions: root, versionId: id, ...(recovered ? {recovered} : {})};
}

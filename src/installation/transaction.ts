import { assertNoPendingReset } from './gate.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { privateDirectory, privateFile, acquireOwner } from '../controller/ownership.js';
import { copyAssetTree, inventoryTree, assetIdentity } from './tree.js';
import { nodeProfile, requiredPayload, type BundleManifest } from './bundle.js';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function syncDirectory(directory: string) {
    const h = await fs.open(directory, 'r');
    try {
        await h.sync();
    }
    finally {
        await h.close();
    }
}
export async function writeOwnedJson(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    const h = await fs.open(temporary, 'wx', 0o600);
    try {
        await h.writeFile(JSON.stringify(value, null, 2) + '\n');
        await h.sync();
    }
    finally {
        await h.close();
    }
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
}
export async function validateBundle(root: string): Promise<BundleManifest> {
    if (await fs.realpath(root) !== root)
        throw Error('Canonical bundle directory required');
    const file = path.join(root, 'bundle.json');
    await privateFile(file);
    const s = await fs.lstat(file);
    if (s.size > 16 * 1024 * 1024)
        throw Error('Bundle manifest byte limit exceeded');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as BundleManifest;
    if (manifest.format !== 1 || manifest.platform?.platform !== process.platform || manifest.platform?.arch !== process.arch || manifest.platform?.version !== '24.22.0' || process.version !== 'v24.22.0')
        throw Error('Unsupported bundle/runtime platform');
    const installer = path.join(root, 'install');
    await privateFile(installer);
    const installerStat = await fs.lstat(installer);
    if (manifest.installer?.path !== 'install' || manifest.installer.mode !== 0o500 || (installerStat.mode & 0o777) !== manifest.installer.mode || hash(await fs.readFile(installer)) !== manifest.installer.sha256)
        throw Error('Owned offline installer differs');
    const actual = await inventoryTree(path.join(root, 'payload')), bootstrap = await inventoryTree(path.join(root, 'bootstrap'));
    if (JSON.stringify(manifest.platform) !== JSON.stringify(nodeProfile))
        throw Error('Bundle runtime provenance differs from pinned profile');
    for (const file of requiredPayload)
        if (!actual.some(a => a.path === file && a.kind === 'file' && a.bytes > 0))
            throw Error('Required bundle asset missing: ' + file);
    for (const file of ['node', 'NODE-LICENSE', 'bootstrap.js', 'tree.js', 'package.json', 'launcher', 'child.js', 'private-files.js', 'child-supervisor.js'])
        if (!bootstrap.some(a => a.path === file && a.kind === 'file' && a.bytes > 0))
            throw Error('Required bootstrap asset missing: ' + file);
    if (assetIdentity(actual) !== manifest.payloadId || JSON.stringify(actual) !== JSON.stringify(manifest.assets) || JSON.stringify(bootstrap) !== JSON.stringify(manifest.bootstrap))
        throw Error('Bundle asset inventory differs');
    if (hash(await fs.readFile(path.join(root, 'bootstrap/node'))) !== manifest.platform.sha256)
        throw Error('Bundle Node identity differs');
    return manifest;
}
/** A real consistent SQLite backup, including committed WAL; caller holds existing owner lock. */
export async function backupOwnedDatabase(live: string, destination: string): Promise<{
    exists: boolean;
    sha256: string | null;
}> {
    await privateFile(live);
    try {
        await fs.lstat(live);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return { exists: false, sha256: null };
        throw e;
    }
    const output = await fs.open(destination, 'wx', 0o600);
    await output.close();
    const source = new DatabaseSync(live, { readOnly: true });
    try {
        await backup(source, destination);
    }
    finally {
        source.close();
    }
    const h = await fs.open(destination, 'r+');
    try {
        await h.sync();
    }
    finally {
        await h.close();
    }
    await syncDirectory(path.dirname(destination));
    return { exists: true, sha256: hash(await fs.readFile(destination)) };
}
/** Stage immutable version assets only while holding the same Controller owner lock.
 * No binding/schema promotion or live eligibility is performed by this function. */
export async function stageBundle(input: {
    bundleRoot: string;
    installationHome: string;
}) {
    const home = input.installationHome;
    await assertNoPendingReset(home);
    const manifest = await validateBundle(input.bundleRoot);
    if (!path.isAbsolute(home))
        throw Error('Absolute installation home required');
    await privateDirectory(home);
    const entries = await fs.readdir(home);
    if (entries.length && !entries.includes('controller.json'))
        throw Error('Nonempty home has no Controller ownership marker');
    const marker = path.join(home, 'controller.json');
    await privateFile(marker);
    try {
        const m = JSON.parse(await fs.readFile(marker, 'utf8'));
        if (m.format !== 'gitjig-controller-1')
            throw Error('Foreign Controller marker');
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
        await writeOwnedJson(marker, { format: 'gitjig-controller-1' });
    }
    await privateDirectory(path.join(home, 'state'));
    const release = await acquireOwner(path.join(home, 'state'));
    try {
        await assertNoPendingReset(home);
        try {
            await fs.lstat(path.join(home, 'activation.json'));
            throw Error('Recover undecided activation before staging');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        for (const name of ['versions', 'manifests', 'config', 'artifacts', 'inputs'])
            await privateDirectory(path.join(home, name));
        const version = path.join(home, 'versions', manifest.payloadId);
        let exists = false;
        try {
            await fs.lstat(version);
            exists = true;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        if (exists) {
            if (assetIdentity(await inventoryTree(version)) !== manifest.payloadId)
                throw Error('Existing owned version changed');
        }
        else {
            const staging = path.join(home, 'versions', '.stage-' + randomUUID());
            const copied = await copyAssetTree(path.join(input.bundleRoot, 'payload'), staging);
            if (assetIdentity(copied) !== manifest.payloadId)
                throw Error('Bundle changed while staging; staged version not promoted');
            await fs.rename(staging, version);
            await syncDirectory(path.join(home, 'versions'));
        }
        const manifestFile = path.join(home, 'manifests', manifest.payloadId + '.json');
        await privateFile(manifestFile);
        try {
            const old = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
            if (JSON.stringify(old) !== JSON.stringify(manifest))
                throw Error('Existing version manifest differs');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
            await writeOwnedJson(manifestFile, manifest);
        }
        return { installationHome: home, payloadId: manifest.payloadId, version, staged: true, active: false, nextAction: 'Run explicit activation with clone migration and loaded handshake; staged assets grant no live eligibility' };
    }
    finally {
        await release();
    }
}

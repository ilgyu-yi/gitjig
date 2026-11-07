import { assertNoPendingReset } from './gate.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, privateFile, acquireOwner } from '../controller/ownership.js';
import { inventoryTree, assetIdentity, type Asset } from './tree.js';
import { writeOwnedJson } from './transaction.js';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function exists(file: string) {
    try {
        await fs.lstat(file);
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return false;
        throw e;
    }
}
async function matchingFile(file: string, expected: Extract<Asset, {
    kind: 'file';
}>) { const s = await fs.lstat(file); return s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === expected.mode && s.size === expected.bytes && hash(await fs.readFile(file)) === expected.sha256; }
/** Delete only the exact individually rechecked inventory, never recursively delete an owner-supplied root. */
async function removeMatchingTree(root: string, expected: readonly Asset[]) {
    const actual = await inventoryTree(root);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        return false;
    const rootInfo = await fs.lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid?.() || (rootInfo.mode & 0o077) !== 0)
        return false;
    await fs.chmod(root, 0o700);
    for (const a of actual)
        if (a.kind === 'directory') {
            const directory = path.join(root, a.path), s = await fs.lstat(directory);
            if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o777) !== a.mode)
                throw Error('Owned directory changed during removal; retained');
            await fs.chmod(directory, 0o700);
        }
    for (const a of [...actual].reverse()) {
        const file = path.join(root, a.path);
        if (a.kind === 'file') {
            if (!await matchingFile(file, a))
                throw Error('Owned file changed during removal; retained');
            await fs.unlink(file);
        }
        else if (a.kind === 'symlink') {
            const s = await fs.lstat(file);
            if (!s.isSymbolicLink() || s.uid !== process.getuid?.() || await fs.readlink(file) !== a.target)
                throw Error('Owned link changed during removal; retained');
            await fs.unlink(file);
        }
        else
            await fs.rmdir(file); // A foreign concurrent entry makes this fail rather than being deleted.
    }
    await fs.rmdir(root);
    return true;
}
export async function removeInstallation(home: string) {
    await privateDirectory(home);
    await privateDirectory(path.join(home, 'state'));
    const release = await acquireOwner(path.join(home, 'state'));
    const removed: string[] = [], preserved: {
        path: string;
        reason: string;
    }[] = [];
    try {
        await assertNoPendingReset(home);
        if (await exists(path.join(home, 'activation.json')))
            throw Error('Recover undecided activation before removing assets');
        await privateFile(path.join(home, 'controller.json'));
        const marker = JSON.parse(await fs.readFile(path.join(home, 'controller.json'), 'utf8'));
        if (marker.format !== 'gitjig-controller-1')
            throw Error('Foreign owner marker; no assets removed');
        await privateFile(path.join(home, 'binding.json'));
        const binding = JSON.parse(await fs.readFile(path.join(home, 'binding.json'), 'utf8'));
        if (binding.format !== 1 || typeof binding.payloadId !== 'string' || !/^[a-f0-9]{64}$/.test(binding.payloadId) || typeof binding.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.manifestSha256))
            throw Error('Missing exact active binding; no asset removal');
        const manifestFile = path.join(home, 'manifests', binding.payloadId + '.json');
        await privateFile(manifestFile);
        const bytes = await fs.readFile(manifestFile);
        if (hash(bytes) !== binding.manifestSha256)
            throw Error('Bound ownership manifest changed; no asset removal');
        const activeManifest = JSON.parse(bytes.toString());
        // Revoke managed admission before any unlink. Delayed old processes remain blocked after this owner exits.
        await writeOwnedJson(path.join(home, 'controller.json'), { ...marker, installation: { format: 1, state: 'removed' } });
        const versions = path.join(home, 'versions');
        for (const id of await fs.readdir(versions)) {
            const version = path.join(versions, id), manifestPath = path.join(home, 'manifests', id + '.json');
            try {
                if (!/^[a-f0-9]{64}$/.test(id))
                    throw Error('Foreign version entry');
                await privateFile(manifestPath);
                const m = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                const actual = await inventoryTree(version);
                if (m.format !== 1 || m.payloadId !== id || assetIdentity(actual) !== id || JSON.stringify(actual) !== JSON.stringify(m.assets))
                    throw Error('Version contains changed or foreign assets');
                if (!await removeMatchingTree(version, m.assets))
                    throw Error('Version differs from owned inventory');
                removed.push(version);
            }
            catch (e) {
                preserved.push({ path: version, reason: (e as Error).message });
            }
        }
        const launcher = activeManifest.bootstrap?.find((a: Asset) => a.path === 'launcher' && a.kind === 'file');
        const launcherPath = path.join(home, 'gitjig');
        if (launcher && await exists(launcherPath)) {
            if (await matchingFile(launcherPath, launcher)) {
                await fs.unlink(launcherPath);
                removed.push(launcherPath);
            }
            else
                preserved.push({ path: launcherPath, reason: 'Changed or foreign launcher retained' });
        }
        const bootstrap = path.join(home, 'bootstrap');
        try {
            if (!Array.isArray(activeManifest.bootstrap) || !await removeMatchingTree(bootstrap, activeManifest.bootstrap))
                throw Error('Bootstrap contains changed or foreign assets');
            removed.push(bootstrap);
        }
        catch (e) {
            preserved.push({ path: bootstrap, reason: (e as Error).message });
        }
        // Retain exact binding, manifests and all user data as recovery evidence; the removed marker is authoritative.
        const receipt = { removed, preserved, managedState: 'removed', retained: ['state', 'artifacts', 'inputs', 'config', 'manifests', 'binding.json', 'controller.json', 'activation-history'], nextAction: 'Reinstall a compatible owned bundle to use retained state; modified/foreign assets need explicit owner reconciliation' };
        await writeOwnedJson(path.join(home, 'state', 'removal-' + randomUUID() + '.json'), receipt);
        return receipt;
    }
    finally {
        await release();
    }
}

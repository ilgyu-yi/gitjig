// Stable diagnostic/launch entry. Imports only Node built-ins and the owned tree primitive.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { runInstallationCommand } from './child.js';
import { inventoryTree, assetIdentity } from './tree.js';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function privateRoot(root: string) {
    const s = await fs.lstat(root);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0 || await fs.realpath(root) !== root)
        throw Error('Installation root must be canonical owner-only storage');
}
async function readJson(file: string) {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o022) !== 0 || s.size > 16 * 1024 * 1024)
        throw Error('Unsafe owned installation metadata');
    return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function inspectInstallation(root: string) {
    await privateRoot(root);
    const marker = await readJson(path.join(root, 'controller.json'));
    if (marker.format !== 'gitjig-controller-1')
        throw Error('Owned Controller marker differs');
    if (marker.installation !== undefined && (marker.installation.format !== 1 || !['active', 'removed'].includes(marker.installation.state)))
        throw Error('Managed installation marker differs');
    const binding = await readJson(path.join(root, 'binding.json'));
    if (binding.format !== 1 || !Number.isSafeInteger(binding.generation) || binding.generation < 1 || typeof binding.payloadId !== 'string' || !/^[a-f0-9]{64}$/.test(binding.payloadId) || typeof binding.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.manifestSha256))
        throw Error('Unsupported installation binding');
    const manifestFile = path.join(root, 'manifests', binding.payloadId + '.json');
    await readJson(manifestFile);
    const bytes = await fs.readFile(manifestFile);
    if (hash(bytes) !== binding.manifestSha256)
        throw Error('Bound manifest changed');
    const manifest = JSON.parse(bytes.toString());
    if (manifest.format !== 1 || manifest.payloadId !== binding.payloadId || manifest.platform?.version !== '24.22.0' || manifest.platform?.platform !== process.platform || manifest.platform?.arch !== process.arch || process.version !== 'v24.22.0')
        throw Error('Installation/runtime profile differs');
    const payload = path.join(root, 'versions', binding.payloadId), actual = await inventoryTree(payload), bootstrap = await inventoryTree(path.join(root, 'bootstrap'));
    if (assetIdentity(actual) !== binding.payloadId || JSON.stringify(actual) !== JSON.stringify(manifest.assets))
        throw Error('Installed payload assets missing or changed');
    const launcherStat = await fs.lstat(path.join(root, 'gitjig'));
    if (!launcherStat.isFile() || launcherStat.isSymbolicLink() || launcherStat.nlink !== 1 || launcherStat.uid !== process.getuid?.())
        throw Error('Owned launcher type/identity differs');
    const launcher = manifest.bootstrap.find((a: {
        path: string;
        kind: string;
    }) => a.path === 'launcher' && a.kind === 'file');
    if (!launcher || (launcherStat.mode & 0o777) !== launcher.mode || hash(await fs.readFile(path.join(root, 'gitjig'))) !== launcher.sha256)
        throw Error('Owned launcher differs');
    if (JSON.stringify(bootstrap) !== JSON.stringify(manifest.bootstrap))
        throw Error('Installed bootstrap assets missing or changed');
    if (await fs.realpath(process.execPath) !== path.join(root, 'bootstrap/node') || hash(await fs.readFile(process.execPath)) !== manifest.platform.sha256)
        throw Error('Actual loaded Node differs from bound bootstrap');
    let activation: unknown = null;
    try {
        activation = await readJson(path.join(root, 'activation.json'));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw e;
    }
    return { format: 1, root, managedState: marker.installation?.state ?? 'legacy-bound', payloadId: binding.payloadId, generation: binding.generation, payload, source: { current: 'unavailable-without-source-inspection', recorded: manifest.source }, installed: 'matching-manifest', bound: 'matching', loaded: { node: process.execPath, version: process.version, sdk: 'not-loaded-by-stable-health' }, activation, customization: path.join(root, 'config'), state: path.join(root, 'state'), artifacts: path.join(root, 'artifacts'), externalPrerequisites: { git: 'not-probed', executionEngine: 'not-probed' }, liveEligibility: 'not-established-by-health' };
}
export async function bootstrapMain(args: readonly string[]): Promise<number> {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    if (['NODE_OPTIONS', 'NODE_PATH', 'PI_PACKAGE_DIR'].some(name => process.env[name]))
        throw Error('Use owned launcher which clears ambient preload/package overrides before Node startup');
    const report = await inspectInstallation(root);
    if (args[0] === 'health') {
        if (args.length !== 1 && (args.length !== 2 || args[1] !== '--loaded'))
            throw Error('Use health [--loaded]');
        if (args[1] === '--loaded' && !report.activation && report.managedState !== 'removed') {
            const actual = await runInstallationCommand({ home: root, ownerId: randomUUID(), payloadId: report.payloadId, kind: 'loaded-health' });
            console.log(JSON.stringify({ ...report, loaded: JSON.parse(actual.stdout) }, null, 2));
        }
        else
            console.log(JSON.stringify(report, null, 2));
        return report.activation || report.managedState === 'removed' ? 2 : 0;
    }
    if (report.activation)
        throw Error('Installation activation is undecided; recover it before admitting work');
    if (report.managedState === 'removed')
        throw Error('Installed assets were removed; reinstall a compatible owned bundle before product entry');
    if (args.length === 1 && args[0] === '--resolve') {
        await privateRoot(report.artifacts);
        console.log(report.payloadId);
        return 0;
    }
    throw Error('Use the owned launcher for product commands, or health [--loaded]');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = await bootstrapMain(process.argv.slice(2));
    }
    catch (e) {
        console.error(JSON.stringify({ error: 'INSTALLATION_UNAVAILABLE', message: (e as Error).message, recovery: 'Inspect owned installation health or recover the retained activation; no work admitted by bootstrap' }));
        process.exitCode = 2;
    }
}

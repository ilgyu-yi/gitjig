import { isCompatibleNode, requiredNodeRange } from '../app/runtime-requirements.js';
import fs from 'node:fs/promises';
import { assertProductAssets } from './product-assets.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyAssetTree, inventoryTree, assetIdentity, type Asset } from './tree.js';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const nodeProfile = { version: '24.22.0', platform: 'darwin', arch: 'arm64', sha256: 'b468fb9c67427c9d3aec07ee1105e63020923a631a9a2a00beb71a7ba3768bfd', licenseSha256: '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace' } as const;
export const requiredPayload = [
    'package.json', 'package-lock.json', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md', 'THIRD_PARTY_NOTICES.md', 'docs/README.md', 'docs/installation.md', 'docs/requirements.md', 'docs/capabilities.md', 'docs/providers.md', 'docs/usage.md', 'docs/startup.md', 'docs/runtime-image.md', 'docs/goals.md', 'docs/keybindings.md', 'docs/session-commands.md', 'docs/session-preferences.md', 'docs/file-context.md',
    'runtime/Dockerfile', 'runtime/Dockerfile.dockerignore', 'runtime/io-helper.mjs', 'runtime/setup.mjs',
    'dist/cli/main.js', 'dist/installation/entry.js', 'dist/installation/cli.js', 'dist/installation/removal.js', 'dist/installation/child.js', 'dist/installation/loaded-health.js', 'dist/installation/handshake.js', 'dist/installation/migrate.js', 'dist/controller/capture-worker.js', 'dist/effects/git-process-child.js', 'dist/pi/session.js', 'dist/workflow/adapter.js',
    'node_modules/@earendil-works/pi-coding-agent/package.json', 'node_modules/@earendil-works/pi-coding-agent/dist/index.js',
    'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json', 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/light.json',
] as const;
export interface BundleManifest {
    format: 1;
    platform: typeof nodeProfile;
    payloadId: string;
    assets: Asset[];
    bootstrap: Asset[];
    source: {
        lockSha256: string;
        criteria: Record<string, string>;
    };
    installer: {
        path: 'install';
        sha256: string;
        mode: number;
    };
    distribution: 'MIT' | 'private-local-fixture-no-product-license-selected';
}
async function copyFile(from: string, to: string, mode = 0o400) {
    const stat = await fs.lstat(from);
    if (!stat.isFile() || stat.isSymbolicLink())
        throw Error('Regular explicit bundle input required');
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.chmod(to, mode);
}
/** Trusted build-host operation, not adopter startup/network dependency installation. */
export async function buildBundle(input: {
    sourceRoot: string;
    productionRoot: string;
    nodeBinary: string;
    nodeLicense: string;
    destination: string;
}): Promise<BundleManifest> {
    if (process.platform !== nodeProfile.platform || process.arch !== nodeProfile.arch)
        throw Error('First bundle supports darwin-arm64 only');
    for (const directory of [input.sourceRoot, input.productionRoot])
        if (await fs.realpath(directory) !== directory)
            throw Error('Canonical bundle input root required');
    const node = await fs.readFile(input.nodeBinary), license = await fs.readFile(input.nodeLicense);
    if (digest(node) !== nodeProfile.sha256 || digest(license) !== nodeProfile.licenseSha256)
        throw Error('Bundled runtime differs from exact official provenance');
    const lock = await fs.readFile(path.join(input.sourceRoot, 'package-lock.json'));
    if (!lock.equals(await fs.readFile(path.join(input.productionRoot, 'package-lock.json'))))
        throw Error('Production closure must use exact source lock');
    const productionLock = JSON.parse(await fs.readFile(path.join(input.productionRoot, 'node_modules/.package-lock.json'), 'utf8'));
    if (productionLock.lockfileVersion !== 3 || !productionLock.packages || Object.entries(productionLock.packages).some(([name, value]) => name === 'node_modules/typescript' || (value as {
        dev?: boolean;
    }).dev === true))
        throw Error('Production closure contains development packages or unsupported lock');
    await fs.mkdir(input.destination, { mode: 0o700 });
    const payload = path.join(input.destination, 'payload'), bootstrap = path.join(input.destination, 'bootstrap');
    await fs.mkdir(payload, { mode: 0o700 });
    await fs.mkdir(bootstrap, { mode: 0o700 });
    assertProductAssets(await inventoryTree(path.join(input.sourceRoot, 'dist')));
    await copyAssetTree(path.join(input.sourceRoot, 'dist'), path.join(payload, 'dist'));
    await copyAssetTree(path.join(input.productionRoot, 'node_modules'), path.join(payload, 'node_modules'));
    await copyAssetTree(path.join(input.sourceRoot, 'docs'), path.join(payload, 'docs'));
    await copyAssetTree(path.join(input.sourceRoot, 'runtime'), path.join(payload, 'runtime'));
    const criteria: Record<string, string> = {};
    for (const name of ['package.json', 'package-lock.json', 'MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md', 'README.md']) {
        await copyFile(path.join(input.sourceRoot, name), path.join(payload, name));
        if (name.endsWith('.md') && name !== 'README.md')
            criteria[name] = digest(await fs.readFile(path.join(payload, name)));
    }
    for (const name of ['THIRD_PARTY_NOTICES.md'])
        await copyFile(path.join(input.sourceRoot, name), path.join(payload, name));
    const packageData = JSON.parse(await fs.readFile(path.join(payload, 'package.json'), 'utf8'));
    if (packageData.engines?.node !== requiredNodeRange || !isCompatibleNode(nodeProfile.version))
        throw Error('Bundled runtime must satisfy product Node requirements');
    if (packageData.license !== undefined && packageData.license !== 'MIT')
        throw Error('Unsupported declared product license');
    const distribution = packageData.license === 'MIT' ? 'MIT' : 'private-local-fixture-no-product-license-selected';
    if (distribution === 'MIT') {
        await copyFile(path.join(input.sourceRoot, 'LICENSE'), path.join(payload, 'LICENSE'));
        if (!(await fs.readFile(path.join(payload, 'LICENSE'), 'utf8')).trim())
            throw Error('Nonempty product LICENSE required for MIT distribution');
    }
    for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', '@earendil-works/pi-tui']) {
        const p = JSON.parse(await fs.readFile(path.join(payload, 'node_modules', name, 'package.json'), 'utf8'));
        if (p.version !== packageData.dependencies?.[name])
            throw Error('Loaded production dependency pin differs');
    }
    const assets = await inventoryTree(payload);
    for (const required of requiredPayload)
        if (!assets.some(a => a.path === required && a.kind === 'file' && a.bytes > 0))
            throw Error('Required bundle asset missing: ' + required);
    await fs.writeFile(path.join(bootstrap, 'node'), node, { flag: 'wx', mode: 0o500 });
    await fs.writeFile(path.join(bootstrap, 'NODE-LICENSE'), license, { flag: 'wx', mode: 0o400 });
    // These fixed modules must use built-ins only, so broken active payloads remain diagnosable.
    for (const name of ['bootstrap.js', 'tree.js', 'child.js', 'private-files.js', 'child-supervisor.js'])
        await copyFile(path.join(input.sourceRoot, 'dist/installation', name), path.join(bootstrap, name));
    await fs.writeFile(path.join(bootstrap, 'launcher'), `#!/bin/sh
unset NODE_OPTIONS NODE_PATH PI_PACKAGE_DIR
root=$(CDPATH= cd -P -- "$(/usr/bin/dirname -- "$0")" && pwd -P) || exit 2
if [ ! -x "$root/bootstrap/node" ]; then
  echo 'INSTALLATION_UNAVAILABLE: restore the owned pinned bootstrap Node runtime' >&2
  exit 2
fi
case "\${1-}" in
  health) exec "$root/bootstrap/node" "$root/bootstrap/bootstrap.js" "$@" ;;
esac
payload=$("$root/bootstrap/node" "$root/bootstrap/bootstrap.js" --resolve) || exit 2
case "$payload" in *[!0-9a-f]*|'') echo 'INSTALLATION_UNAVAILABLE: invalid owned payload identity' >&2; exit 2 ;; esac
if [ "\${#payload}" -ne 64 ]; then echo 'INSTALLATION_UNAVAILABLE: invalid owned payload length' >&2; exit 2; fi
TMPDIR="$root/artifacts"
export TMPDIR
exec "$root/bootstrap/node" "$root/versions/$payload/dist/installation/entry.js" "$@"
`, { flag: 'wx', mode: 0o500 });
    await fs.writeFile(path.join(bootstrap, 'package.json'), '{"type":"module"}\n', { flag: 'wx', mode: 0o400 });
    const installer = `#!/bin/sh
unset NODE_OPTIONS NODE_PATH PI_PACKAGE_DIR
root=$(CDPATH= cd -P -- "$(/usr/bin/dirname -- "$0")" && pwd -P) || exit 2
if [ ! -x "$root/bootstrap/node" ]; then
  echo 'INSTALLATION_UNAVAILABLE: pinned bundle Node missing' >&2
  exit 2
fi
exec "$root/bootstrap/node" "$root/payload/dist/installation/cli.js" "$@"
`;
    await fs.writeFile(path.join(input.destination, 'install'), installer, { flag: 'wx', mode: 0o500 });
    const manifest: BundleManifest = { format: 1, platform: nodeProfile, payloadId: assetIdentity(assets), assets, bootstrap: await inventoryTree(bootstrap), source: { lockSha256: digest(lock), criteria }, installer: { path: 'install', sha256: digest(Buffer.from(installer)), mode: 0o500 }, distribution };
    await fs.writeFile(path.join(input.destination, 'bundle.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
    return manifest;
}

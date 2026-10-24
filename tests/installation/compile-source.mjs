import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

// Emit to a fresh directory; never package an existing development dist tree.
export async function compileSource(source, output) {
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const inputs = async () => {
        const result = [];
        async function visit(relative) {
            const file = path.join(source, relative), stat = await fs.lstat(file);
            assert.ok(!stat.isSymbolicLink(), 'Build input symlink unavailable');
            if (stat.isDirectory()) for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name));
            else { assert.ok(stat.isFile()); result.push([relative, digest(await fs.readFile(file))]); }
        }
        for (const name of ['src', 'runtime', 'tsconfig.json', 'package.json', 'package-lock.json', '.node-version']) await visit(name);
        return result;
    };
    const before = await inputs(), pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    assert.equal(process.versions.node, (await fs.readFile(path.join(source, '.node-version'), 'utf8')).trim(), 'Reproducible bundle build uses the development reference runtime');
    const compiler = path.join(source, 'node_modules/typescript');
    assert.equal(JSON.parse(await fs.readFile(path.join(compiler, 'package.json'), 'utf8')).version, pkg.devDependencies.typescript);
    await fs.mkdir(output, { mode: 0o700 });
    await promisify(execFile)(process.execPath, [path.join(compiler, 'bin/tsc'), '-p', path.join(source, 'tsconfig.json'), '--outDir', output], {
        cwd: source, timeout: 60000, maxBuffer: 2 ** 20, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    assert.deepEqual(await inputs(), before, 'Build inputs changed during compilation');
    const { buildBundle } = await import(pathToFileURL(path.join(output, 'installation/bundle.js')).href);
    const { inventoryTree, assetIdentity } = await import(pathToFileURL(path.join(output, 'installation/tree.js')).href);
    return { buildBundle, inventoryTree, assetIdentity, inputs: before,
        assertSourceCurrent: async () => assert.deepEqual(await inputs(), before, 'Build inputs changed after compilation') };
}

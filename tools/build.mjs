#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertCompatibleNode} from '../src/app/runtime-requirements.js';
assertCompatibleNode();
const root = fileURLToPath(new URL('../', import.meta.url));
for (const directory of ['dist', '.qualification']) await fs.rm(path.join(root, directory), {recursive:true, force:true});
for (const project of ['tsconfig.json', 'tsconfig.qualification.json']) {
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project], {cwd:root, stdio:'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
const {inventoryTree} = await import('../dist/installation/tree.js');
const {assertProductAssets} = await import('../dist/installation/product-assets.js');
assertProductAssets(await inventoryTree(path.join(root,'dist')));

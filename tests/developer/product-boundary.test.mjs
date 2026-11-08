import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {inventoryTree} from '../../dist/installation/tree.js';
import {assertProductAssets} from '../../dist/installation/product-assets.js';
const execute=promisify(execFile);
test('actual product output and Controller startup contain no qualification implementation',async()=>{
 const root=await fs.realpath('.'), assets=await inventoryTree(path.join(root,'dist'));
 assertProductAssets(assets);
 for(const name of ['controller/testing.js','controller/acceptance.js','platform/github-acceptance.js','effects/acceptance-synthetic.js','.qualification/setup.js']) assert.throws(()=>assertProductAssets([{path:name,kind:'directory',mode:0o700}]),/Qualification artifact/);
 const script=`import {registerHooks} from 'node:module';const loaded=[];registerHooks({resolve(s,c,n){const r=n(s,c);if(r.url?.includes('/.qualification/'))throw Error('Qualification loaded by product');loaded.push(r.url);return r;}});const {openController}=await import(${JSON.stringify(pathToFileURL(path.join(root,'dist/controller/index.js')).href)});const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-boundary-')));try{const c=await openController({installationHome:home});await c.close();console.log(JSON.stringify({closed:true,modules:loaded.length}));}finally{await fs.rm(home,{recursive:true,force:true});}`;
 const {stdout}=await execute(process.execPath,['--input-type=module','-e',script],{timeout:10000});
 const result=JSON.parse(stdout);assert.equal(result.closed,true);assert.ok(result.modules>10);
});

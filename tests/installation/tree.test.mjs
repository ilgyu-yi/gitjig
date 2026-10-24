import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {inventoryTree,copyAssetTree,assetIdentity} from '../../dist/installation/tree.js';
async function writable(root){for(const e of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory()){await fs.chmod(file,0o700);await writable(file);}}}
test('explicit inventory copies untracked bytes/internal bins and breaks hardlinks; refuses outward/cyclic/special/case-colliding paths',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig asset tree '))),source=path.join(root,'source'),destination=path.join(root,'copy');await fs.mkdir(source);await fs.mkdir(path.join(source,'lib'));await fs.writeFile(path.join(source,'lib/untracked-worker.js'),'worker bytes',{mode:0o700});await fs.link(path.join(source,'lib/untracked-worker.js'),path.join(source,'hardlink-copy.js'));await fs.mkdir(path.join(source,'bin'));await fs.symlink('../lib/untracked-worker.js',path.join(source,'bin/worker'));
 let passed=false;t.after(async()=>{if(passed){await writable(root);await fs.rm(root,{recursive:true,force:true});}else t.diagnostic('Retained asset tree '+root);});
 const original=await inventoryTree(source),copied=await copyAssetTree(source,destination);assert.equal(copied.length,original.length);assert.match(assetIdentity(copied),/^[a-f0-9]{64}$/);assert.equal(await fs.readFile(path.join(destination,'bin/worker'),'utf8'),'worker bytes');
 assert.equal((await fs.stat(path.join(destination,'hardlink-copy.js'))).nlink,1);assert.equal((await fs.stat(path.join(destination,'lib/untracked-worker.js'))).nlink,1);assert.notEqual((await fs.stat(path.join(source,'lib/untracked-worker.js'))).ino,(await fs.stat(path.join(destination,'lib/untracked-worker.js'))).ino);
 for(const target of ['/etc/passwd','../outside','self']){await fs.writeFile(path.join(root,'outside'),'foreign');await fs.symlink(target,path.join(source,'self'));await assert.rejects(inventoryTree(source));await fs.unlink(path.join(source,'self'));}
 await fs.writeFile(path.join(source,'Case'),'a');await fs.writeFile(path.join(source,'case'),'b');
 // Case-sensitive volumes retain both names; case-insensitive hosts already collapse them.
 if((await fs.readdir(source)).includes('Case')&&(await fs.readdir(source)).includes('case'))await assert.rejects(inventoryTree(source),/Case-colliding/);
 await fs.rm(path.join(source,'Case'),{force:true});await fs.rm(path.join(source,'case'),{force:true});
 await fs.symlink('lib',path.join(source,'directory-alias'));assert.ok((await inventoryTree(source)).some(a=>a.path==='directory-alias'&&a.kind==='symlink'));passed=true;
});

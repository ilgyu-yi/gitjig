// Offline builder: argv[2] is a fresh output root; argv[3] is an explicit verified bundle supplying dependencies.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {compileSource} from './compile-source.mjs';
const source=fileURLToPath(new URL('../../',import.meta.url)),root=await fs.realpath(process.argv[2]),oldBundle=await fs.realpath(process.argv[3]),productionRoot=path.join(oldBundle,'payload'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const emitted=path.join(root,'compiled-dist'),{buildBundle,inventoryTree,assetIdentity,inputs:compileInputs,assertSourceCurrent}=await compileSource(source,emitted);
const oldManifest=JSON.parse(await fs.readFile(path.join(oldBundle,'bundle.json'),'utf8')),oldInventory=await inventoryTree(productionRoot);assert.deepEqual(oldInventory,oldManifest.assets);assert.equal(assetIdentity(oldInventory),oldManifest.payloadId);assert.ok((await fs.readFile(path.join(source,'package-lock.json'))).equals(await fs.readFile(path.join(productionRoot,'package-lock.json'))));
const frozen=path.join(root,'frozen-source');await fs.mkdir(frozen,{mode:0o700});const inputs=[];
for(const name of['src','runtime','dist','docs','package.json','package-lock.json','tsconfig.json','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','README.md','THIRD_PARTY_NOTICES.md','LICENSE']){
 const from=name==='dist'?emitted:path.join(source,name),to=path.join(frozen,name);await fs.cp(from,to,{recursive:true,errorOnExist:true,force:false});
}
for(const item of await inventoryTree(frozen))if(item.kind==='file'){const original=await fs.readFile(item.path.startsWith('dist/')?path.join(emitted,item.path.slice(5)):path.join(source,item.path));assert.equal(sha(original),item.sha256);inputs.push({path:item.path,sha256:item.sha256});}
const destination=path.join(root,'bundle'),manifest=await buildBundle({sourceRoot:frozen,productionRoot,nodeBinary:process.execPath,nodeLicense:path.resolve(path.dirname(process.execPath),'../LICENSE'),destination});
for(const item of inputs)assert.equal(sha(await fs.readFile(item.path.startsWith('dist/')?path.join(emitted,item.path.slice(5)):path.join(source,item.path))),item.sha256,item.path);assert.deepEqual(await inventoryTree(productionRoot),oldInventory);
await assertSourceCurrent();
const receipt={root,destination,payloadId:manifest.payloadId,source,sourceInputs:inputs,compileInputs,frozenInputCount:inputs.length,oldProduction:{root:productionRoot,payloadId:oldManifest.payloadId,manifestSha256:sha(await fs.readFile(path.join(oldBundle,'bundle.json'))),lockSha256:sha(await fs.readFile(path.join(source,'package-lock.json'))),verifiedFullInventory:true},manifestSha256:sha(await fs.readFile(path.join(destination,'bundle.json')))};
await fs.writeFile(path.join(root,'build-receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify({complete:true,root,destination,payloadId:manifest.payloadId,files:manifest.assets.length,frozenInputCount:inputs.length}));

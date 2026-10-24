import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {stageBundle,validateBundle} from '../../dist/installation/transaction.js';
test('actual omitted capture/Git/supervisor/theme/criteria assets refuse staging before allocating an owner home, restored bundle remains valid',{timeout:60000},async()=>{
 if(!process.env.GITJIG_BUNDLE_RECEIPT)throw Error('Actual built bundle receipt required');const {destination:bundleRoot}=JSON.parse(await fs.readFile(process.env.GITJIG_BUNDLE_RECEIPT,'utf8'));const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig missing assets ')));
 const cases=['payload/dist/controller/capture-worker.js','payload/dist/effects/git-process-child.js','payload/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json','payload/CONTRACTS.md','bootstrap/child-supervisor.js'];
 try{for(let i=0;i<cases.length;i++){const file=path.join(bundleRoot,cases[i]),directory=path.dirname(file),held=path.join(root,'held-'+i),mode=(await fs.stat(directory)).mode&0o777;await fs.chmod(directory,0o700);await fs.rename(file,held);await fs.chmod(directory,mode);
  try{const home=path.join(root,'must-not-allocate-'+i);await assert.rejects(stageBundle({bundleRoot,installationHome:home}),e=>e.message.includes('Required bundle asset missing')||e.message.includes('Required bootstrap asset missing'));await assert.rejects(fs.access(home),{code:'ENOENT'});}
  finally{await fs.chmod(directory,0o700);await fs.rename(held,file);await fs.chmod(directory,mode);}
 }await validateBundle(bundleRoot);}finally{await fs.rm(root,{recursive:true,force:true});}
});

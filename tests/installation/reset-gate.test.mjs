import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {prepareApplicationReset,applyApplicationReset,recoverApplicationReset} from '../../dist/app/reset.js';
import {stageBundle} from '../../dist/installation/transaction.js';
import {activateBundle,recoverActivation} from '../../dist/installation/activation.js';
import {removeInstallation} from '../../dist/installation/removal.js';

// Exercise original maintenance admission, not bundle/runtime qualification.
test('installation maintenance preserves interrupted reset and permits its original recovery',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-install-gate-'))),home=path.join(root,'app');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset gate fixture '+root);});
 const c=await openController({installationHome:home});c.createConversation();await c.close();
 assert.deepEqual(await recoverActivation(home),{recovered:'nothing-pending'});
 await fs.mkdir(path.join(home,'config'),{mode:0o700});const original='{"owner":"retained"}';await fs.writeFile(path.join(home,'config/settings.json'),original,{mode:0o600});
 const preview=await prepareApplicationReset(home,'all'),rename=fs.rename;let moves=0;
 fs.rename=async(...args)=>{if(String(args[1]).includes('reset-backups')&&!String(args[1]).endsWith('.json')&&++moves===2)throw Error('Fixture interruption');return rename(...args);};
 try{await assert.rejects(applyApplicationReset(home,'all',preview.fingerprint),/Fixture interruption/);}finally{fs.rename=rename;}
 const pending=await fs.readFile(path.join(home,'reset-pending.json')),plan=JSON.parse(pending),backup=path.join(home,'reset-backups',plan.backup);
 await assert.rejects(fs.stat(path.join(home,'config')),{code:'ENOENT'});
 // Missing bundle is deliberate: reset refusal precedes bundle loading and staging side effects.
 const input={installationHome:home,bundleRoot:path.join(root,'not-loaded-bundle')};
 for(const operation of [()=>stageBundle(input),()=>activateBundle(input),()=>recoverActivation(home),()=>removeInstallation(home)]){
  await assert.rejects(operation(),error=>error.code==='RESET_PENDING');
  await assert.rejects(fs.stat(path.join(home,'config')),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(path.join(home,'reset-pending.json')),pending);
  assert.equal(await fs.readFile(path.join(backup,'config/settings.json'),'utf8'),original);
  await assert.rejects(fs.stat(path.join(home,'state/owner.json')),{code:'ENOENT'});
 }
 const result=await recoverApplicationReset(home);assert.equal(result.backup,backup);
 const reopened=await openController({installationHome:home});await reopened.close();
 assert.deepEqual(await recoverActivation(home),{recovered:'nothing-pending'});passed=true;
});

test('invalid bundle still leaves a new installation home absent',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-invalid-reset-bundle-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const home=path.join(root,'app');
 await assert.rejects(stageBundle({installationHome:home,bundleRoot:path.join(root,'missing-bundle')}),{code:'ENOENT'});
 await assert.rejects(fs.stat(home),{code:'ENOENT'});
});

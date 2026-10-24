import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {NativeGitNotAllocatedError,openGitHubHttpsGit} from '../../dist/effects/native-git.js';
import {createOwnedPublicationSession} from '../../dist/platform/github-publication-session.js';
import {createOwnedAcceptanceSetup, createdAcceptanceSession} from '../../dist/platform/hosted-context.js';
import {fixture} from '../controller/hosted-integration-fixture.mjs';
import {gitFixture,git} from './acceptance-git-fixture.mjs';
import {heldInitializer,assertGone} from '../ui/integration-initialization-fixture.mjs';
import {waitFile} from '../ui/integration-send-fixture.mjs';
test('canonical HTTPS helper trust cancellation constructs no client or process',async t=>{
 const f=await fixture(),root=path.join(f.root,'canonical-trust'),abort=new AbortController(),realpath=fs.realpath,spawn=cp.spawn;let launches=0;
 cp.spawn=(...args)=>{launches++;return spawn(...args);};syncBuiltinESMExports();
 fs.realpath=async(file,...args)=>{const value=await realpath(file,...args);if(String(file).endsWith('/git-remote-https'))abort.abort(Error('Owner cancelled canonical helper trust'));return value;};
 try{await assert.rejects(openGitHubHttpsGit({gitBinary:git,ownedClientRoot:root},{token:f.token,credentialSessionId:'canonical-trust'},abort.signal),error=>error instanceof NativeGitNotAllocatedError&&error.clientRoot===root&&/cancelled/.test(error.message));}
 finally{fs.realpath=realpath;cp.spawn=spawn;syncBuiltinESMExports();await f.close();}
 assert.equal(launches,0);await assert.rejects(fs.lstat(root),{code:'ENOENT'});await fs.rm(f.root,{recursive:true,force:true});
});
test('owned publication session forwards initialization cancellation',async t=>{
 const f=await fixture(),held=await heldInitializer({...f,git},'init'),session=createOwnedPublicationSession({origin:'http://127.0.0.1:1',token:f.token}),abort=new AbortController();
 const task=session.openOwnedNativeHttps({gitBinary:held.binary,ownedClientRoot:path.join(f.root,'publication-init'),commandTimeoutMs:20000},{origin:f.origin,caFile:f.ca,execPath:f.execPath},abort.signal);void task.catch(()=>{});
 try{await waitFile(held.marker);const started=Date.now();abort.abort(Error('Cancel publication native init'));await assert.rejects(task);assert.ok(Date.now()-started<3000);await assertGone(held.pids);assert.equal(f.requests.length,0);await f.close();await fs.rm(f.root,{recursive:true,force:true});}catch(error){await f.close();t.diagnostic('Retained native fixture '+f.root);throw error;}
});
for(const stage of ['before-intent','expired-before-intent','during-trust','during-init','after-init'])test('created acceptance initialization cancellation '+stage+' preserves counters and cleanup',{timeout:12000},async t=>{
 const f=await gitFixture();let setup,passed=false;const realpath=fs.realpath,now=Date.now;
 try{
  setup=await createOwnedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps});const context=await setup.create(),session=createdAcceptanceSession(context),profile=f.profile('cancel-'+stage),abort=new AbortController(),before=setup.inspect().counters.nativeOperations;
  let held;
  if(stage==='expired-before-intent')Date.now=()=>now()+3600001;
  if(stage==='before-intent')abort.abort(Error('Cancelled before acceptance native intent'));
  if(stage==='during-trust')fs.realpath=async(file,...args)=>{const value=await realpath(file,...args);if(String(file)===f.ownedHttps.caFile)abort.abort(Error('Cancelled during acceptance CA trust'));return value;};
  if(stage==='after-init')Date.now=()=>{if(fsSync.existsSync(path.join(profile.ownedClientRoot,'native-owner.json')))abort.abort(Error('Cancelled at acceptance postinitialization lifecycle check'));return now();};
  if(stage==='during-init'){held=await heldInitializer({root:f.gitRoot,git},'init');profile.gitBinary=held.binary;profile.commandTimeoutMs=20000;}
  const task=Promise.resolve().then(()=>session.openNativeGit(profile,abort.signal));void task.catch(()=>{});
  if(held){await waitFile(held.marker);abort.abort(Error('Cancelled acceptance init'));}
  await assert.rejects(task);fs.realpath=realpath;Date.now=now;
  if(held)await assertGone(held.pids);else if(stage==='after-init'){const {reconcileOwnedGitProcesses}=await import('../../dist/effects/native-git.js');assert.equal(abort.signal.aborted,true);assert.ok(await fs.stat(path.join(profile.ownedClientRoot,'native-owner.json')));assert.equal((await reconcileOwnedGitProcesses(profile.ownedClientRoot)).cleanup,'confirmed');}else await assert.rejects(fs.lstat(profile.ownedClientRoot),{code:'ENOENT'});
  assert.equal(setup.inspect().counters.nativeOperations,before+(stage.endsWith('before-intent')?0:1));assert.equal(setup.inspect().counters.nativePushes,0);
  await setup.close();passed=true;
 }finally{fs.realpath=realpath;Date.now=now;await setup?.close();await f.close({preserve:!passed});}
});

test('owned backend fixture captures open options before its lazy product import',async t=>{
 const f=await fixture(),patch={token:f.token};let client,passed=false;
 try{const task=f.open(patch,'captured-lazy-open');patch.token='late-wrong-token';client=await task;await client.fetchHttpsPinnedBasis(f.target,f.B);assert.ok(f.requests.length>0);assert.ok(f.requests.every(row=>row.authorized));passed=true;}
 finally{await client?.close();await f.close();if(passed)await fs.rm(f.root,{recursive:true,force:true});else t.diagnostic('Retained lazy-open fixture '+f.root);}
});

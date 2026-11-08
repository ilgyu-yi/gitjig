import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {registrationWorld,domain} from './hosted-registration-cleanup-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';

// All native/API effects stay in owned fixtures. No successful procedure seam,
// work admission, remote mutation, live provider or installed-entry claim.
test('hosted registration captures an explicit per-attempt Git profile and request without changing defaults',async t=>{
 const f=await registrationWorld(t),before=domain(f.c),profile={gitBinary:f.git};delete f.c.options.effectsProfile;
 const task=f.c.registerHostedIntegrationTarget(f.request,{gitProfile:profile});profile.gitBinary='/not-the-captured-git';f.request.publicationInventory.push('late.txt');
 const result=await task,target=f.c.inspectIntegrationTarget(result.targetId);assert.equal(target.state,'RETAINED');assert.deepEqual(target.configuration.publicationInventory,['file.txt']);assert.equal(f.c.options.effectsProfile,undefined);
 const after=domain(f.c);for(const table of ['works','budgets','runs','effect_operations','effect_delegations'])assert.deepEqual(after[table],before[table]);assert.equal(after.sources.length,before.sources.length+1);f.pass();
});

test('pre-aborted, stale-source and oversized hosted registration allocate no native client or observation',async t=>{
 const f=await registrationWorld(t),before=domain(f.c),client=f.c.effects.client.bind(f.c.effects),abort=new AbortController();let opened=0;f.c.effects.client=(...args)=>{opened++;return client(...args);};abort.abort(Error('Caller cancelled'));
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request,{signal:abort.signal}),/Caller cancelled/);
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request,{validate:()=>{throw Error('Original source changed');}}),/Original source changed/);
 await assert.rejects(f.c.registerHostedIntegrationTarget({...f.request,publicationInventory:['x'.repeat(131072)]}),/bounded128KiB/);assert.equal(opened,0);assert.deepEqual(domain(f.c),before);f.pass();
});

for(const stage of ['--version','fetch'])test('caller cancellation joins hosted '+stage+' descendants and remains explicitly retryable',{timeout:12000},async t=>{
 const f=await registrationWorld(t),before=domain(f.c),held=await heldInitializer(f,stage),abort=new AbortController(),defaults=structuredClone(f.c.options.effectsProfile);
 const task=f.c.registerHostedIntegrationTarget(f.request,{gitProfile:{gitBinary:held.binary,commandTimeoutMs:20000},signal:abort.signal});void task.catch(()=>{});await waitFile(held.marker);abort.abort(Error('Caller registration cancelled'));await assert.rejects(task);await assertGone(held.pids);
 assert.deepEqual(domain(f.c),before);assert.deepEqual(f.c.options.effectsProfile,defaults);const result=await f.c.registerHostedIntegrationTarget(f.request);assert.equal(f.c.inspectIntegrationTarget(result.targetId).state,'RETAINED');f.pass();
});

for(const drift of ['source','project-row','project-directory','new-scope'])test('hosted registration refuses '+drift+' drift after actual pinned fetch',async t=>{
 const f=await registrationWorld(t),before=domain(f.c),client=f.c.effects.client.bind(f.c.effects);let current=true;
 f.c.effects.client=async(...args)=>{const native=await client(...args),fetch=native.fetchHttpsPinnedBasis.bind(native);native.fetchHttpsPinnedBasis=async(...input)=>{const result=await fetch(...input);if(drift==='source')current=false;if(drift==='project-row')f.c.store.run("UPDATE projects SET profile='{} ' WHERE id='P'");if(drift==='new-scope'){const root=f.root+'/new-project';await fs.mkdir(root);await f.c.registerProject({id:'NewScope',sourceRoot:root});}if(drift==='project-directory'){await fs.rename(f.source,f.source+'-original');await fs.mkdir(f.source);}return result;};return native;};
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request,{validate:()=>{if(!current)throw Error('Original source changed');}}),/Original (source|project)/);assert.deepEqual(domain(f.c),before);f.pass();
});

for(const reuse of [false,true])test('hosted '+(reuse?'existing-target observation':'new-target insertion')+' rechecks source inside its final transaction',async t=>{
 const f=await registrationWorld(t);if(reuse)await f.c.registerHostedIntegrationTarget(f.request);const before=domain(f.c),tx=f.c.store.tx.bind(f.c.store);let current=true,entered=0;
 f.c.store.tx=fn=>tx(()=>{entered++;current=false;return fn();});
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request,{validate:()=>{if(!current)throw Error('Source changed inside final transaction');}}),/Source changed inside final transaction/);assert.equal(entered,1);assert.deepEqual(domain(f.c),before);f.c.store.tx=tx;f.pass();
});

test('exact hosted target reuse refuses retained target drift during native identity observation',async t=>{
 const f=await registrationWorld(t),registered=await f.c.registerHostedIntegrationTarget(f.request),before=domain(f.c),session=f.c.effects.hostedSession,observe=session.observeReadIdentity.bind(session);
 session.observeReadIdentity=async(...args)=>{const result=await observe(...args);f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.basisCommit',?) WHERE id=?",'f'.repeat(40),registered.targetId);return result;};
 await assert.rejects(f.c.registerHostedIntegrationTarget(f.request),/Original hosted target changed/);assert.deepEqual(f.c.store.all('SELECT * FROM sources ORDER BY rowid'),before.sources);for(const table of ['works','budgets','runs','effect_operations','effect_delegations'])assert.deepEqual(domain(f.c)[table],before[table]);f.pass();
});

for(const configured of [true,false])test('credential and default-profile capture from the first awaited project read; original profile='+configured,async t=>{
 const f=await registrationWorld(t),before=domain(f.c),realpath=fs.realpath;if(!configured)delete f.c.options.effectsProfile;let release,entered;const gate=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>entered=resolve);let once=true;
 fs.realpath=async(...args)=>{if(once&&args[0]===f.source){once=false;entered();await gate;}return realpath(...args);};
 let task;try{task=f.c.registerHostedIntegrationTarget(f.request);void task.catch(()=>{});await reading;assert.throws(()=>f.configure('replacement'),/Active integration must settle/);f.c.options.effectsProfile={gitBinary:configured?'/not-the-original-default':f.git};}finally{release();fs.realpath=realpath;}
 if(configured){const result=await task;assert.equal(f.c.inspectIntegrationTarget(result.targetId).state,'RETAINED');assert.equal(f.c.options.effectsProfile.gitBinary,'/not-the-original-default');}else{await assert.rejects(task,/Explicit trusted effectsProfile/);assert.deepEqual(domain(f.c),before);}f.pass();
});

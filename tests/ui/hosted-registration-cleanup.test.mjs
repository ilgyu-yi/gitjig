import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {registrationWorld,denyTerminal,domain,stickyGuards} from './hosted-registration-cleanup-fixture.mjs';
import {heldInitializer,assertGone} from './integration-initialization-fixture.mjs';
import {waitFile} from './integration-send-fixture.mjs';
import {receiverSnapshot} from './integration-read-fixture.mjs';
for(const stage of ['--version','fetch'])test('hosted registration '+stage+' cleanup uncertainty survives task and full host close',{timeout:12000},async t=>{
 const f=await registrationWorld(t),held=await heldInitializer(f,stage),before=domain(f.c),receiver=await receiverSnapshot(f.native.receiver);
 f.c.options.effectsProfile={gitBinary:held.binary,commandTimeoutMs:20000};
 const task=f.c.registerHostedIntegrationTarget(f.request);void task.catch(()=>{});await waitFile(held.marker);const restore=denyTerminal(f.home);let failure;
 try{
  const closing=f.c.effects.close();void closing.catch(()=>{});
  await assert.rejects(task,error=>{failure=error;return error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN'&&/no target committed|was not committed/.test(error.message)&&error.recovery.includes('/effects/registration-');});
  await assert.rejects(closing,error=>error===failure);
 }finally{restore();}
 await assertGone(held.pids);assert.deepEqual(domain(f.c),before);assert.deepEqual(await receiverSnapshot(f.native.receiver),receiver);await stickyGuards(f,failure);
 await assert.rejects(f.c.close(),error=>error===failure);assert.throws(()=>f.c.store.one('SELECT 1'),/database is not open/);f.c.close=async()=>{};
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),rows);}finally{db.close();}f.pass();
});

test('postcommit cleanup failure retains its exact target and prevents fresh registration without quarantining work',async t=>{
 const f=await registrationWorld(t),before=domain(f.c),client=f.c.effects.client.bind(f.c.effects);let root;
 f.c.effects.client=async(...args)=>{const actual=await client(...args);root=actual.root;const close=actual.close.bind(actual);actual.close=async()=>{await close();throw Error('Controlled postcommit close failure');};return actual;};
 let failure;await assert.rejects(f.c.registerHostedIntegrationTarget(f.request),error=>{failure=error;return error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN';});
 const target=f.c.store.one("SELECT id FROM effect_targets WHERE json_extract(data,'$.kind')='github-existing-ref'");assert.ok(target);assert.match(failure.message,new RegExp(target.id+' remains registered'));assert.ok(failure.recovery.includes(root));assert.ok(root.includes('registration-'+target.id));
 const after=domain(f.c);for(const table of ['effect_delegations','effect_operations','works','budgets','runs'])assert.deepEqual(after[table],before[table]);assert.equal(after.sources.length,before.sources.length+1);await stickyGuards(f,failure);
 await assert.rejects(f.c.close(),error=>error===failure);f.c.close=async()=>{};f.pass();
});

test('concurrent exact endpoint reuse reports the retained target rather than its unused registration UUID',{timeout:12000},async t=>{
 const f=await registrationWorld(t),client=f.c.effects.client.bind(f.c.effects);let count=0,unusedRoot,release;const firstDone=new Promise(resolve=>release=resolve);
 f.c.effects.client=async(...args)=>{const ordinal=++count,actual=await client(...args);if(ordinal===2){unusedRoot=actual.root;const fetch=actual.fetchHttpsPinnedBasis.bind(actual);actual.fetchHttpsPinnedBasis=async(...input)=>{const result=await fetch(...input);await firstDone;return result;};const close=actual.close.bind(actual);actual.close=async()=>{await close();throw Error('Controlled reused-target cleanup failure');};}return actual;};
 const first=f.c.registerHostedIntegrationTarget(f.request);void first.then(release,release);const results=await Promise.allSettled([first,f.c.registerHostedIntegrationTarget(f.request)]),accepted=results.find(row=>row.status==='fulfilled'),refused=results.find(row=>row.status==='rejected');assert.ok(accepted);assert.ok(refused);
 const target=accepted.value.targetId;assert.ok(!unusedRoot.includes('registration-'+target));assert.match(refused.reason.message,new RegExp(target+' remains registered'));assert.ok(refused.reason.recovery.includes(unusedRoot));assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_targets WHERE json_extract(data,'$.kind')='github-existing-ref'").n,1);
 await stickyGuards(f,refused.reason);await assert.rejects(f.c.close(),error=>error===refused.reason);f.c.close=async()=>{};f.pass();
});

test('multiple hosted cleanup-unknown registrations retain both recovery roots after all descendants join',{timeout:12000},async t=>{
 const f=await registrationWorld(t),dirs=[path.join(f.root,'first-initializer'),path.join(f.root,'second-initializer')];for(const dir of dirs)await fs.mkdir(dir);
 const held=await Promise.all(dirs.map(root=>heldInitializer({...f,root},'--version'))),client=f.c.effects.client.bind(f.c.effects);let count=0;
 f.c.effects.client=(root,resume,hosted,session,_profile,signal)=>client(root,resume,hosted,session,{gitBinary:held[count++].binary,commandTimeoutMs:20000},signal);
 const tasks=[f.c.registerHostedIntegrationTarget(f.request),f.c.registerHostedIntegrationTarget(f.request)];for(const task of tasks)void task.catch(()=>{});await Promise.all(held.map(item=>waitFile(item.marker)));
 const restore=denyTerminal(f.home);let failures;
 try{const closing=f.c.effects.close();void closing.catch(()=>{});failures=(await Promise.allSettled(tasks)).map(row=>{assert.equal(row.status,'rejected');return row.reason;});assert.notEqual(failures[0].recovery,failures[1].recovery);await assert.rejects(closing,error=>error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN'&&failures.every(failure=>error.recovery.includes(failure.recovery)));}finally{restore();}
 for(const item of held)await assertGone(item.pids);await assert.rejects(f.c.close(),error=>error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN'&&failures.every(failure=>error.recovery.includes(failure.recovery)));f.c.close=async()=>{};f.pass();
});

test('ordinary trust failure and actual HTTP401 remain nonsticky and permit a successful explicit registration',async t=>{
 const f=await registrationWorld(t),trust=f.c.effects.trustedProfile.bind(f.c.effects),before=domain(f.c);let once=true;
 f.c.effects.trustedProfile=async(...args)=>{if(once){once=false;throw Error('Controlled unavailable trusted Git');}return trust(...args);};await assert.rejects(f.c.registerHostedIntegrationTarget(f.request),/unavailable trusted Git/);assert.deepEqual(domain(f.c),before);
 f.configure('fixture-invalid-credential');await assert.rejects(f.c.registerHostedIntegrationTarget(f.request),error=>error.code!=='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN');assert.ok(f.rest.requests.some(row=>!row.authorized));assert.deepEqual(domain(f.c),before);
 f.configure(f.native.token);const result=await f.c.registerHostedIntegrationTarget(f.request);assert.equal(f.c.inspectIntegrationTarget(result.targetId).state,'RETAINED');for(const table of ['works','budgets','runs','effect_delegations','effect_operations'])assert.deepEqual(domain(f.c)[table],before[table]);f.pass();
});

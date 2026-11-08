import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {targetWorld,registrationChoices,registrationInputs} from './integration-target-fixture.mjs';
import {snapshot} from '../controller/integration-registry-fixture.mjs';
import {readCommand as readRepositoryCommand} from './integration-command-fixture.mjs';
import {receiverSnapshot} from './integration-read-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const readCommand=(f,choices,inputs=[],extra={})=>readRepositoryCommand(f,choices,inputs,{acceptReviewPages:true,...extra});

test('Korean local registration keeps literal fields through path edits and confirmation Back',async t=>{
 const f=await targetWorld(t), tr=(key,args)=>uiText('ko','integration.'+key,args), bytes=await receiverSnapshot(f.receiver);
 const choices=['통합 대상','Register local bare receiver',tr('localPath',{value:''}).trim(),tr('localBasis',{value:''}).trim(),
  tr('localPublication',{value:0}),tr('pathAdd'),tr('pathAdd'),tr('pathAdd'),tr('pathRow',{index:2,path:'"extra.txt"'}),tr('pathEdit'),
  tr('pathRow',{index:2,path:'"renamed.txt"'}),tr('pathRemove'),tr('pathDone'),tr('localDelta',{value:0}),tr('pathAdd'),tr('pathDone'),
  tr('localReview'),tr('localConfirmBack'),tr('localReview'),tr('localConfirm'),'Back','닫기'];
 const h=readCommand(f,choices,[f.receiver,f.basis,'file.txt','file.txt','extra.txt','renamed.txt','file.txt'],{uiLocale:()=> 'ko'});
 try { await h.run(); } finally { await h.ui.close(); }
 const [registered]=f.c.listIntegrationTargets().targets;
 assert.equal(registered.state,'RETAINED');assert.notEqual(registered.targetId,f.target);
 assert.equal(registered.ref,'refs/heads/main');assert.deepEqual(registered.configuration.publicationInventory,['file.txt']);
 assert.deepEqual(registered.configuration.authorizedDeltaPaths,['file.txt']);
 assert.equal(h.shown.filter(row=>row.title===tr('pathInvalidTitle')).length,1);
 assert.equal(h.shown.filter(row=>row.title.startsWith(tr('localReviewTitle'))).length,2);
 assert.ok(h.shown.some(row=>row.title===tr('localRegistered')));
 assert.equal(choices.length,0);assert.deepEqual(await receiverSnapshot(f.receiver),bytes);
 for(const table of ['works','effect_operations','effect_delegations','budgets','runs'])assert.equal(f.c.store.one('SELECT COUNT(*) n FROM '+table).n,0);
 f.pass();
});
test('closing registration review returns to staged fields without native work',async t=>{
 const f=await targetWorld(t),before=snapshot(f.c);
 const h=readCommand(f,[...registrationChoices.slice(0,11),title=>{assert.match(title,/^Local bare receiver · staged fields/);return 'Back without registration';},'Back','Close'],registrationInputs(f),{acceptReviewPages:false});
 await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);f.pass();
});
test('invalid staged delta is corrected in place before the only native registration',async t=>{
 const f=await targetWorld(t),before=snapshot(f.c),client=f.c.effects.client.bind(f.c.effects);
 let calls=0;
 f.c.effects.client=(...args)=>{calls++;return client(...args);};
 const choices=[
  ...registrationChoices.slice(0,11),
  (_title,rows)=>{
   assert.equal(calls,0);
   assert.equal(snapshot(f.c),before);
   assert.ok(rows.includes('Receiver path · '+f.receiver));
   assert.ok(rows.includes('Pinned basis commit · '+f.basis));
   return 'Authorized delta paths · 1';
  },
  'Path 1','Edit literal path','Done','Review registration',
  ...registrationChoices.slice(11),
 ];
 const h=readCommand(f,choices,[f.receiver,f.basis,'file.txt','another.txt','file.txt']);
 await h.run();
 await h.ui.close();
 assert.equal(choices.length,0);
 assert.equal(calls,1);
 assert.equal(h.shown.filter(row=>row.title==='Review the receiver fields').length,1);
 const targets=f.c.listIntegrationTargets().targets;
 assert.equal(targets.length,2);
 assert.deepEqual(targets[0].configuration.authorizedDeltaPaths,['file.txt']);
 f.pass();
});
test('sparse local inventory refuses before native admission and keeps the target list intact',async t=>{
 const f=await targetWorld(t),before=snapshot(f.c);
 f.c.effects.client=()=>assert.fail('Invalid inventory cannot open a native client');
 await assert.rejects(f.c.registerLocalTarget({...f.request,authorizedDeltaPaths:Array(1)}),/Authorized delta paths/);
 assert.equal(snapshot(f.c),before);
 f.pass();
});
for(const configured of [true,false])test('actual UI local receiver registration is independently useful and creates no work/grant/send; configured='+configured,async t=>{const f=await targetWorld(t),bytes=await receiverSnapshot(f.receiver);if(!configured)f.c.options.effectsProfile=undefined;const h=readCommand(f,[...registrationChoices],[...registrationInputs(f),...configured?[]:[f.git]]);await h.run();await h.ui.close();const targets=f.c.listIntegrationTargets();assert.equal(targets.targets.length,2);const current=targets.targets[0];assert.equal(current.state,'RETAINED');assert.equal(current.projectId,'P');assert.deepEqual(current.configuration.publicationInventory,['file.txt']);assert.deepEqual(current.configuration.authorizedDeltaPaths,['file.txt']);assert.notEqual(current.targetId,f.target);for(const table of ['works','effect_operations','effect_delegations','budgets','runs'])assert.equal(f.c.store.one('SELECT COUNT(*) n FROM '+table).n,0);assert.equal(f.c.options.effectsProfile===undefined,!configured);assert.deepEqual(await receiverSnapshot(f.receiver),bytes);assert.equal(h.shown.length,2);f.pass();});
test('target registration default Back and executable cancellation create no native client or record',async t=>{const f=await targetWorld(t),before=snapshot(f.c),client=f.c.effects.client.bind(f.c.effects);let calls=0;f.c.effects.client=async(...args)=>{calls++;return client(...args);};const back=readCommand(f,[...registrationChoices.slice(0,11),'Back without registering','Back without registration','Back','Close'],registrationInputs(f));await back.run();await back.ui.close();assert.equal(snapshot(f.c),before);f.c.options.effectsProfile=undefined;const cancel=readCommand(f,[...registrationChoices.slice(0,12),'Back without registration','Back','Close'],registrationInputs(f));await cancel.run();await cancel.ui.close();assert.equal(snapshot(f.c),before);assert.equal(calls,0);f.pass();});
for(const drift of ['source','project-row','project-directory','new-scope','receiver','config'])test('registration refuses '+drift+' drift after actual native fetch before authority commit',async t=>{const f=await targetWorld(t),client=f.c.effects.client.bind(f.c.effects),targets=f.c.store.all('SELECT * FROM effect_targets'),observations=f.c.store.all('SELECT * FROM authority_observations');let current=true;f.c.effects.client=async(...args)=>{const native=await client(...args),fetch=native.fetchLocalBasis.bind(native);native.fetchLocalBasis=async(...input)=>{const result=await fetch(...input);if(drift==='source')current=false;if(drift==='project-row')f.c.store.run("UPDATE projects SET profile='{} ' WHERE id='P'");if(drift==='project-directory'){await fs.rename(f.source,f.source+'-original');await fs.mkdir(f.source);}if(drift==='new-scope')await f.c.registerProject({id:'ReceiverAsProject',sourceRoot:f.receiver});if(drift==='receiver'){await fs.rename(f.receiver,f.receiver+'-original');await fs.cp(f.receiver+'-original',f.receiver,{recursive:true});}if(drift==='config')await fs.appendFile(path.join(f.receiver,'config'),'\n[include]\n path = /nonexistent/owned-fixture\n');return result;};return native;};await assert.rejects(f.c.registerLocalTarget(f.request,{validate:()=>{if(!current)throw Error('Original source changed');}}));assert.deepEqual(f.c.store.all('SELECT * FROM effect_targets'),targets);assert.deepEqual(f.c.store.all('SELECT * FROM authority_observations'),observations);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);f.pass();});
test('registration captures mutable request arrays and rejects uninspectable oversized inventories before native opening',async t=>{const f=await targetWorld(t),client=f.c.effects.client.bind(f.c.effects);let calls=0;f.c.effects.client=async(...args)=>{calls++;const native=await client(...args),fetch=native.fetchLocalBasis.bind(native);native.fetchLocalBasis=async(...input)=>{const result=await fetch(...input);f.request.publicationInventory.push('late.txt');return result;};return native;};const result=await f.c.registerLocalTarget(f.request);assert.deepEqual(f.c.inspectIntegrationTarget(result.targetId).configuration.publicationInventory,['file.txt']);const before=snapshot(f.c),oversized={...f.request,publicationInventory:Array.from({length:2000},(_,i)=>i+'x'.repeat(100))};await assert.rejects(f.c.registerLocalTarget(oversized),/128KiB/);assert.equal(calls,1);assert.equal(snapshot(f.c),before);f.pass();});
test('a committed target survives reported cleanup failure and names its original identity',async t=>{const f=await targetWorld(t),client=f.c.effects.client.bind(f.c.effects);f.c.effects.client=async(...args)=>{const native=await client(...args),close=native.close.bind(native);native.close=async()=>{await close();throw Error('Synthetic unavailable cleanup report after real close');};return native;};await assert.rejects(f.c.registerLocalTarget(f.request),error=>{const id=/Integration target ([a-f0-9-]+) remains registered/u.exec(error.message)?.[1];assert.ok(id);assert.equal(f.c.inspectIntegrationTarget(id).state,'RETAINED');assert.match(error.message,/registration-/);return true;});assert.equal(f.c.listIntegrationTargets().targets.length,2);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM effect_delegations').n,0);let retried=0;f.c.effects.client=async()=>{retried++;throw Error('Retry must not reach native factory');};await assert.rejects(f.c.registerLocalTarget(f.request),error=>error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN');assert.equal(retried,0);assert.equal(f.c.listIntegrationTargets().targets.length,2);await assert.rejects(f.c.close(),error=>error.code==='INTEGRATION_REGISTRATION_CLEANUP_UNKNOWN');f.c.close=async()=>{};f.pass();});

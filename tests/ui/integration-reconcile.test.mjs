import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {integrationReadWorld,receiverSnapshot,originalSnapshot} from './integration-read-fixture.mjs';
import {snapshot} from '../controller/integration-registry-fixture.mjs';
import {readCommand as readRepositoryCommand,choices} from './integration-command-fixture.mjs';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
const readCommand=(f,choices,inputs=[],extra={})=>readRepositoryCommand(f,choices,inputs,{acceptReviewPages:true,...extra});
test('held result admission reads the original receiver without sending or reopening stale result',async t=>{
 const f=await integrationReadWorld(t),workId=f.op.workId,operationId=f.op.operationId;
 const cid=f.conversation=f.c.createConversation().conversationId, history='Review prior branch delivery for this work';
 assert.equal(f.c.inspectChangeResult(workId).reviewReady,false);
 const marker='Request catalogue only';
 f.c.store.run('UPDATE sources SET raw=? WHERE id=(SELECT source FROM works WHERE id=?)',marker,workId);
 const before=originalSnapshot(f), receiver=await receiverSnapshot(f.receiver),notices=[];
 const h=readCommand(f,['local-git','Reconcile original integration','Reconcile original receiver','Back without action','Back'],[],{notice:text=>notices.push(text)});
 let resultViews=0;
 const result=new HostCommands(changeCommands({
  controller:f.c,isCurrent:()=>true,
  choose:async(_title,rows)=>{
   assert.ok(rows.includes(history));
   return history;
  },
  show:async(_title,_text,primary)=>{
   assert.equal(++resultViews,1,'A completed observation must not reopen the previous result snapshot');
   await primary.run();
  },
  execute:async(command,target,context)=>{
   assert.equal(command,'/repo deliver '+workId+' history');
   assert.equal(target,cid);
   return h.ui.commands[0].run('deliver '+workId+' history',target,context);
  },
 }));
 try {assert.equal(await result.execute('/result '+workId,cid),'completed');}
 finally {await h.ui.close();}
 const actual=f.c.inspectEffect(operationId);
 assert.equal(actual.phase,'CONFIRMED');
 assert.equal(actual.transportOutcome,'uncertain');
 assert.equal(actual.observedOutcome,'contains-integration');
 assert.deepEqual(notices,['Branch delivery · Integration recorded as confirmed, original send uncertain · refs/heads/main · '+operationId]);
 assert.ok(h.shown.every(({text})=>!text.includes(marker)));
 assert.deepEqual(await receiverSnapshot(f.receiver),receiver);
 assert.deepEqual(f.c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'),before.grants);
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);
 assert.equal(f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",workId).consumed,before.budget.consumed+1);
 f.pass();
});

for(const changed of ['pane','work source','receiver ref'])
test('retained result check keeps the write-free outcome without a new notice when '+changed+' changes',async t=>{
 const f=await integrationReadWorld(t),before=await receiverSnapshot(f.receiver),notices=[];
 f.conversation=f.c.createConversation().conversationId;
 let current=true;
 const h=readCommand(f,[...choices],[],{isCurrent:()=>current,notice:text=>notices.push(text),show:async(title,_body,primary)=>{
  if(title.startsWith('Original integration reconciliation retained')) {
   if(changed==='pane')current=false;
   if(changed==='work source')f.c.store.run("UPDATE sources SET origin=origin||' ' WHERE id=(SELECT source FROM works WHERE id=?)",f.op.workId);
   if(changed==='receiver ref')f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.ref','refs/heads/other') WHERE id=?",f.target);
   return;
  }
  await primary?.run();
 }});
 try {await assert.rejects(h.run(),changed==='receiver ref'?/original integration.*changed/i:/source changed/i);}
 finally {await h.ui.close();}
 assert.equal(f.c.inspectEffect(f.op.operationId).phase,'CONFIRMED');
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='reconciliation'").n,1);
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);
 assert.deepEqual(await receiverSnapshot(f.receiver),before);
 assert.deepEqual(notices,[]);
 f.pass();
});

for(const [locale,drift] of [['en',false],['ko',false],['en',true]])
test(locale+' receiver check confirmation retains exact scope · '+(drift?'allowance changed':'default Back'),async t=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');
 const {uiText}=await import('../../dist/ui/i18n.js');
 const f=await integrationReadWorld(t),baseline=snapshot(f.c),{operationId,workId}=f.op;
 const before=await receiverSnapshot(f.receiver);
 let opened=false;
 const titleText=locale==='ko'?'기존 브랜치 전달 결과 확인':'Explicit original integration read';
 const action=browseIntegrations({
  locale,guard(){},choose:async()=>assert.fail('Typed choice required'),
  chooseItems:async(title,items)=>{
   if(!title.startsWith(titleText)) return opened?'Back without action':'Reconcile original integration · read only';
   opened=true;
   assert.ok(items[0].value==='Back without reconciliation');
   assert.ok(title.includes('refs/heads/main') && title.includes(operationId) && title.includes(workId));
   assert.ok(title.includes(f.receiver) && title.includes(locale==='ko'?'실행 한도 1회':'one execution unit'));
   if(!drift)return items[0].value;
   f.c.store.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='execution'",workId);
   return items[1].value;
  },
  show:async(_title,body,primary)=>{
   assert.ok(body.includes(uiText(locale,'integration.field.work'))&&body.includes(workId));
   await primary?.run();
  },
  reconcile:async()=>assert.fail('Declined or stale confirmation must not read or reserve allowance'),
 },f.c,operationId,{pinned:true});
 if(drift){
  await assert.rejects(action,/Original integration read context changed/);
  f.c.store.run("UPDATE budgets SET lim=lim-1 WHERE lineage=? AND kind='execution'",workId);
 }else assert.equal(await action,false);
 assert.equal(opened,true);
 assert.equal(snapshot(f.c),baseline);
 assert.deepEqual(await receiverSnapshot(f.receiver),before);
 f.pass();
});

test('closing reconciliation returns to the same retained original without reading or spending',async t=>{
 const f=await integrationReadWorld(t);f.conversation=f.c.createConversation().conversationId;const before=snapshot(f.c),receiver=await receiverSnapshot(f.receiver);
 const picks=choices.slice(0,3).concat([title=>{assert.ok(title.includes(f.op.operationId));return 'Back without action';},'Back','Close']);
 const h=readCommand(f,picks,[],{acceptReviewPages:false,input:async()=>assert.fail('Closing review cannot ask for Git')});
 await h.run();await h.ui.close();assert.match(h.shown[0].text,/Integration commit to look for/);assert.match(h.shown[0].text,/Execution:.*available/);assert.equal(snapshot(f.c),before);assert.deepEqual(await receiverSnapshot(f.receiver),receiver);f.pass();
});
for(const [contained,later] of [[true,false],[true,true],[false,false]])test('original native local read preserves IDs/receiver without resend, contained='+contained+' later='+later,async t=>{
 const f=await integrationReadWorld(t,{contained,later});f.conversation=f.c.createConversation().conversationId;const prior=originalSnapshot(f),native=await receiverSnapshot(f.receiver),h=readCommand(f,[...choices]);await h.run();await h.ui.close();const result=f.c.inspectEffect(f.op.operationId);assert.equal(result.phase,contained?'CONFIRMED':'UNKNOWN');assert.match(h.shown.at(-1).text,contained?/Next: inspect the recorded receiver result and original send facts/:/Next: review the original result check/);assert.equal(result.observedOutcome,contained?'contains-integration':'unknown');assert.equal(result.transportOutcome,'uncertain');assert.equal(result.operationId,f.op.operationId);assert.equal(result.workId,f.op.workId);assert.equal(await receiverSnapshot(f.receiver).then(JSON.stringify),JSON.stringify(native));
 const row=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.op.operationId),data=JSON.parse(row.data),old=JSON.parse(prior.op.data);for(const field of ['target','grant_id','work'])assert.equal(row[field],prior.op[field]);for(const field of ['evidence','expectedBase','integrationCommit','headCommit'])assert.deepEqual(data[field],old[field]);assert.deepEqual(f.c.store.all('SELECT * FROM effect_delegations ORDER BY rowid'),prior.grants);assert.deepEqual(f.c.store.one('SELECT * FROM works WHERE id=?',f.op.workId),prior.work);assert.deepEqual(f.c.store.all('SELECT * FROM sources ORDER BY rowid'),prior.sources);const budget=f.c.store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'",f.op.workId);assert.equal(budget.consumed,prior.budget.consumed+1);assert.equal(budget.reserved,0);assert.equal(f.c.store.all('SELECT * FROM effect_operations').length,1);assert.equal(f.c.store.one("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING' OR reservation='reserved'").n,0);assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);assert.equal(h.shown.length,2);f.pass();
});
test('DELIVERED native read preserves work state during admission and settlement',async t=>{const f=await integrationReadWorld(t);f.c.store.run("UPDATE works SET state='DELIVERED' WHERE id=?",f.op.workId);const state=()=>f.c.store.one('SELECT state FROM works WHERE id=?',f.op.workId).state,client=f.c.effects.client.bind(f.c.effects);f.c.effects.client=async(...args)=>{assert.equal(state(),'DELIVERED');return client(...args);};const context=f.c.inspectIntegrationReconciliation(f.op.operationId),result=await f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint});assert.equal(result.phase,'CONFIRMED');assert.equal(state(),'DELIVERED');const run=f.c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.op.workId).at(-1),data=JSON.parse(run.data);assert.equal(data.retainedIntegrationRead,true);assert.equal(data.readPhase,'reconcile');assert.equal(data.cleanup,'removed');assert.equal(JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',f.op.operationId).data).clientRoot,undefined);f.pass();});
test('default Back and cancelled executable prompt are pure; absent configured Git uses per-attempt profile only',async t=>{
 const f=await integrationReadWorld(t);f.conversation=f.c.createConversation().conversationId;const before=snapshot(f.c),h=readCommand(f,[...choices.slice(0,3),'Back without reconciliation','Back without action','Back','Close']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);
 const configured=f.c.effects.h.options.effectsProfile;f.c.effects.h.options.effectsProfile=undefined;const no=readCommand(f,[...choices],[]);await no.run();await no.ui.close();assert.equal(snapshot(f.c),before);
 const yes=readCommand(f,[...choices],[f.git]);await yes.run();await yes.ui.close();assert.equal(f.c.inspectEffect(f.op.operationId).phase,'CONFIRMED');assert.equal(f.c.effects.h.options.effectsProfile,undefined);f.c.effects.h.options.effectsProfile=configured;f.pass();
});
test('stale context, exhausted allowance, pending producers and unsupported work states refuse before native admission',async t=>{
 const f=await integrationReadWorld(t),context=f.c.inspectIntegrationReconciliation(f.op.operationId);f.c.store.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='execution'",f.op.workId);let before=snapshot(f.c);await assert.rejects(f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint}),/context changed/);assert.equal(snapshot(f.c),before);
 for(const state of ['CANCELLED','INTERRUPTED','UNKNOWN']){f.c.store.run('UPDATE works SET state=? WHERE id=?',state,f.op.workId);const current=f.c.inspectIntegrationReconciliation(f.op.operationId);assert.ok(current.holds.length);before=snapshot(f.c);await assert.rejects(f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:current.fingerprint}),/Recover original work/);assert.equal(snapshot(f.c),before);}
 f.c.store.run("UPDATE works SET state='ACTIVE' WHERE id=?",f.op.workId);f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','pending',f.op.workId,1,1,'RUNNING',f.root,'reserved','{"kind":"native-effect"}');let current=f.c.inspectIntegrationReconciliation(f.op.operationId);before=snapshot(f.c);await assert.rejects(f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:current.fingerprint}),/requires settlement/);assert.equal(snapshot(f.c),before);f.c.store.run('DELETE FROM runs WHERE id=?','pending');f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",f.op.workId);current=f.c.inspectIntegrationReconciliation(f.op.operationId);before=snapshot(f.c);await assert.rejects(f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:current.fingerprint}),/allowance exhausted/);assert.equal(snapshot(f.c),before);f.pass();
});
test('untrusted executable refuses without allocation; profile/context are captured across asynchronous trust validation',async t=>{
 const f=await integrationReadWorld(t),helper=path.join(f.source,'helper'),marker=path.join(f.root,'executed');await fs.writeFile(helper,'#!/bin/sh\ntouch '+marker+'\n',{mode:0o700});let context=f.c.inspectIntegrationReconciliation(f.op.operationId),before=snapshot(f.c);await assert.rejects(f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint,gitProfile:{gitBinary:helper}}),/cannot originate/);assert.equal(snapshot(f.c),before);await assert.rejects(fs.access(marker));
 const trusted=f.c.effects.trustedProfile.bind(f.c.effects);let enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);f.c.effects.trustedProfile=async profile=>{const actual=await trusted(profile);enter();await held;return actual;};const input={operationId:f.op.operationId,expectedContext:context.fingerprint,gitProfile:{gitBinary:f.git}},task=f.c.reconcileRetainedIntegration(input);await entered;input.gitProfile.gitBinary=helper;f.c.store.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='execution'",f.op.workId);before=snapshot(f.c);release();await assert.rejects(task,/context changed/);assert.equal(snapshot(f.c),before);await assert.rejects(fs.access(marker));f.pass();
});
test('late source navigation retains accepted original result and reports its identity',async t=>{
 const f=await integrationReadWorld(t);f.conversation=f.c.createConversation().conversationId;let current=true;const reconcile=f.c.reconcileRetainedIntegration.bind(f.c);f.c.reconcileRetainedIntegration=async options=>{const result=await reconcile(options);current=false;return result;};const h=readCommand(f,[...choices],[],{isCurrent:()=>current});await assert.rejects(h.run(),error=>error.message.includes(f.op.operationId));await h.ui.close();assert.equal(f.c.inspectEffect(f.op.operationId).phase,'CONFIRMED');assert.equal(h.shown.length,1);f.pass();
});

test('source movement during asynchronous executable validation refuses before allocation',async t=>{const f=await integrationReadWorld(t);f.conversation=f.c.createConversation().conversationId;let current=true,enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve),trusted=f.c.effects.trustedProfile.bind(f.c.effects);f.c.effects.trustedProfile=async profile=>{const result=await trusted(profile);enter();await held;return result;};const h=readCommand(f,[...choices],[],{isCurrent:()=>current}),before=snapshot(f.c),task=h.run();void task.catch(()=>{});await entered;current=false;release();await assert.rejects(task,/source changed/);await h.ui.close();assert.equal(snapshot(f.c),before);f.pass();});

test('clean restart of an actual retained read journal preserves DELIVERED work and owned path',async t=>{
 const f=await integrationReadWorld(t);f.c.store.run("UPDATE works SET state='DELIVERED' WHERE id=?",f.op.workId);const context=f.c.inspectIntegrationReconciliation(f.op.operationId);await f.c.reconcileRetainedIntegration({operationId:f.op.operationId,expectedContext:context.fingerprint});const run=f.c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',f.op.workId).at(-1);f.c.store.run("UPDATE runs SET phase='RUNNING',data=json_remove(data,'$.cleanup') WHERE id=?",run.id);await f.c.close();const {openController}=await import('../../dist/controller/index.js'),reopened=await openController({installationHome:f.home});t.after(()=>reopened.close());assert.equal(reopened.store.one('SELECT state FROM works WHERE id=?',f.op.workId).state,'DELIVERED');const recovered=reopened.store.one('SELECT * FROM runs WHERE id=?',run.id);assert.equal(recovered.phase,'INTERRUPTED');assert.equal(JSON.parse(recovered.data).cleanup,'removed');assert.equal(recovered.reservation,'consumed');assert.equal(reopened.store.one('SELECT state FROM capacity_leases WHERE run=?',run.id).state,'RELEASED');await reopened.close();f.pass();
});
test('forged retained-read tags cannot admit wrong state/path/generation/phase through capacity',async t=>{
 const f=await integrationReadWorld(t),root=path.join(f.home,'effects',f.op.operationId,'observations','tagged-run');for(const bad of ['path','generation','phase','state']){const state=bad==='state'?'CANCELLED':'DELIVERED';f.c.store.run('UPDATE works SET state=? WHERE id=?',state,f.op.workId);const data={kind:'native-effect',operationId:f.op.operationId,retainedIntegrationRead:true,readPhase:bad==='phase'?'dispatch':'reconcile',generation:bad==='generation'?2:1,clientRoot:bad==='path'?path.join(f.root,'wrong'):root};f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','tagged-run',f.op.workId,1,1,'CREATED',data.clientRoot,'released',JSON.stringify(data));assert.throws(()=>f.c.capacity.acquire({workId:f.op.workId,runId:'tagged-run',epoch:1,kind:'check'}),/stale work\/run provenance/);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM capacity_leases WHERE run=?','tagged-run').n,0);f.c.store.run('DELETE FROM runs WHERE id=?','tagged-run');}f.pass();
});

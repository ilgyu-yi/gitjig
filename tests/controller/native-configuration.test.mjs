import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
async function fixture(t,provider,options={}){
 const server=await nativeConfigurationFixture(provider,options),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-native-config-'))),home=path.join(root,'home');let controller=await openController({installationHome:home},{managementOnly:true});
 t.after(async()=>{await controller.close();await server.close();await fs.rm(root,{recursive:true,force:true});});
 const configure=()=>configureOwnedRepositoryConfigurationFixture(controller,{origin:server.origin,token:'fixture-native-token'});configure();
 const {targetId}=controller.registerRepositoryConfigurationTarget({target:server.target});
 return {server,home,targetId,get controller(){return controller;},async reopen(){await controller.close();controller=await openController({installationHome:home},{managementOnly:true});configure();return controller;},preview:profile=>controller.previewRepositoryConfiguration({targetId,profile:profile??server.profile}),writes:()=>server.requests.filter(r=>r.method!=='GET')};
}
test('original model-free owner engine applies native provider plans, preserves work/budget and audits exact settings after reopening',async t=>{
 for(const provider of ['gitea','gitlab']){
  const f=await fixture(t,provider),plan=await f.preview();assert.equal(plan.phase,'PREVIEWED',JSON.stringify(plan));assert.equal(f.writes().length,0);const applied=await f.controller.applyRepositoryConfiguration({planId:plan.planId});assert.equal(applied.phase,'CONFIRMED',JSON.stringify(applied));assert.equal(f.writes().length,2);assert.ok(applied.steps.every(s=>s.state==='CONFIRMED'));assert.equal(f.server.state.repository.description,'preserve-unrelated');
  const consumed=f.controller.inspectWork(plan.workId).allowance.consumed;assert.equal(consumed,3);await f.reopen();assert.equal(f.controller.inspectRepositoryConfiguration(plan.planId).workId,plan.workId);assert.equal(f.controller.inspectWork(plan.workId).allowance.consumed,consumed);const audit=await f.controller.auditRepositoryConfiguration({planId:plan.planId});assert.equal(audit.complete,true,JSON.stringify(audit));assert.equal(f.writes().length,2);assert.equal(f.controller.inspectWork(plan.workId).allowance.consumed,5);assert.equal(f.controller.store.one('SELECT COUNT(*) AS n FROM works').n,1);
  await assert.rejects(f.controller.runLocalCheck({projectId:'unbound',command:'true'}),/MANAGEMENT_ONLY/);
 }
});
test('lost native response keeps UNKNOWN across restart; read-only original reconciliation admits remaining step without replay',async t=>{
 let drop=true;const f=await fixture(t,'gitlab',{intercept:({req,res,relative,body,state})=>{if(drop&&req.method==='PUT'){Object.assign(state.repository,body);res.destroy();return true;}}}),plan=await f.preview(),first=await f.controller.applyRepositoryConfiguration({planId:plan.planId});assert.equal(first.phase,'UNKNOWN');assert.equal(f.writes().length,1);const used=f.controller.inspectWork(plan.workId).allowance.consumed;await f.reopen();assert.equal(f.controller.inspectWork(plan.workId).allowance.consumed,used);assert.throws(()=>f.controller.previewRepositoryConfiguration({targetId:f.targetId,continuationPlanId:plan.planId,profile:f.server.profile}),/Reconcile.*native/);
 const reconciled=await f.controller.reconcileRepositoryConfiguration({planId:plan.planId});assert.equal(reconciled.steps[0].state,'CONFIRMED');assert.equal(f.writes().length,1);drop=false;const complete=await f.controller.applyRepositoryConfiguration({planId:plan.planId});assert.equal(complete.phase,'CONFIRMED',JSON.stringify(complete));assert.equal(f.writes().length,2);assert.equal(f.writes().filter(r=>r.method==='PUT').length,1);assert.equal(f.controller.inspectWork(plan.workId).allowance.reserved,0);
});
test('partially ignored field and another operation cannot replace a pending native intent or falsely confirm a no-op',async t=>{
 const f=await fixture(t,'gitea',{intercept:({req,relative,body,state,send})=>{if(req.method==='PATCH'&&relative.endsWith('/main')){state.protection.required_approvals=body.required_approvals;send(state.protection);return true;}}});
 const onlyRule={...f.server.profile,repository:undefined};delete onlyRule.repository;const plan=await f.preview(onlyRule),unknown=await f.controller.applyRepositoryConfiguration({planId:plan.planId});assert.equal(unknown.phase,'UNKNOWN');assert.equal(f.writes().length,1);const observed=await f.controller.reconcileRepositoryConfiguration({planId:plan.planId});assert.equal(observed.phase,'UNKNOWN');assert.ok(observed.steps[0].observations.some(o=>o.state==='matching'));assert.ok(observed.steps[0].observations.some(o=>o.state==='conflicting'));
 const other=await f.preview({provider:'gitea',version:'other-owner',repository:{allow_merge_commits:false}}),blocked=await f.controller.applyRepositoryConfiguration({planId:other.planId});assert.equal(blocked.phase,'REFUSED');assert.match(blocked.blocked.join(' '),/Pending native/);assert.equal(f.writes().length,1);
 const noop=await f.preview({provider:'gitea',version:'noop',repository:{allow_merge_commits:true}});assert.equal(noop.plan.steps.length,0);assert.equal((await f.controller.applyRepositoryConfiguration({planId:noop.planId})).phase,'REFUSED');assert.equal((await f.controller.auditRepositoryConfiguration({planId:noop.planId})).complete,false);assert.equal(f.writes().length,1);
});
test('owner cancellation after actual native effect retains UNKNOWN and joins original run; later reconciliation is read-only',async t=>{
 let enter;const entered=new Promise(resolve=>{enter=resolve;});const f=await fixture(t,'gitlab',{intercept:({req,body,state})=>{if(req.method==='PUT'){Object.assign(state.repository,body);enter();return true;}}}),plan=await f.preview(),task=f.controller.applyRepositoryConfiguration({planId:plan.planId});await entered;await f.controller.cancelWork({workId:plan.workId});const result=await task;assert.equal(result.phase,'UNKNOWN');assert.equal(f.writes().length,1);assert.equal(f.controller.inspectWork(plan.workId).allowance.reserved,0);await f.reopen();const reconciled=await f.controller.reconcileRepositoryConfiguration({planId:plan.planId});assert.equal(reconciled.steps[0].state,'CONFIRMED');assert.equal(reconciled.phase,'CANCELLED');assert.equal(f.writes().length,1);assert.equal(f.controller.inspectWork(plan.workId).state,'CANCELLED');
});
test('invalid native enum arrays are refused before work, source or request allocation',async t=>{
 const f=await fixture(t,'gitlab');
 for(const key of ['merge_method','squash_option'])assert.throws(()=>f.preview({provider:'gitlab',version:'invalid',repository:{[key]:[key==='merge_method'?'merge':'always']}}));
 for(const table of ['works','sources','runs','effect_operations'])assert.equal(f.controller.store.one('SELECT COUNT(*) AS n FROM '+table).n,0,table);
 assert.equal(f.server.requests.length,0);
});
test('a pending native intent appearing during a no-op read prevents stale confirmation and audit',async t=>{
 for(const action of ['apply','audit']){
  let hold=false,entered,release;const reached=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,'gitlab',{intercept:async({req,res,relative,state,body})=>{
   if(hold&&req.method==='GET'&&relative==='/projects/9'){hold=false;entered();await gate;}
   if(req.method==='PATCH'){Object.assign(state.protection,body);res.destroy();return true;}return false;
  }});
  const noop=await f.preview({provider:'gitlab',version:'noop-race',repository:{merge_method:'merge'}}),writer=await f.preview({provider:'gitlab',version:'writer',protection:f.server.profile.protection});hold=true;
  const reading=action==='apply'?f.controller.applyRepositoryConfiguration({planId:noop.planId}):f.controller.auditRepositoryConfiguration({planId:noop.planId});await reached;
  try{assert.equal((await f.controller.applyRepositoryConfiguration({planId:writer.planId})).phase,'UNKNOWN');}finally{release();}
  const result=await reading;if(action==='apply'){assert.equal(result.phase,'REFUSED');assert.match(result.blocked.join(' '),/Pending native/);}else{assert.equal(result.complete,false);assert.match(JSON.stringify(result),/Pending native/);}
  assert.equal(f.writes().length,1);
 }
});

test('management reopen recovers only configuration HTTP reservations once and retries a failed recovery',async t=>{
 const f=await fixture(t,'gitlab'),plan=await f.preview(),used=f.controller.inspectWork(plan.workId).allowance.consumed;
 await f.controller.close();
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'));
 try{
  db.prepare("UPDATE budgets SET reserved=reserved+1 WHERE lineage=? AND kind='execution'").run(plan.workId);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('crashed-config',plan.workId,1,1,'RUNNING',path.join(f.home,'state'),'reserved',JSON.stringify({kind:'configuration-http',operationId:'missing-before-recovery',stage:'apply-step'}));
  const operation=db.prepare('SELECT data FROM effect_operations WHERE id=?').get(plan.planId),data=JSON.parse(operation.data);data.steps[0].state='INVOKING';data.steps[0].intent={runId:'crashed-config',revision:1};data.steps[0].transportOutcome='uncertain';db.prepare("UPDATE effect_operations SET phase='APPLYING',data=? WHERE id=?").run(JSON.stringify(data),plan.planId);
  db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run('ordinary-source',null,JSON.stringify({kind:'ordinary'}),'ordinary');
  db.prepare('INSERT INTO works VALUES(?,NULL,?,NULL,?,?,?,?,NULL,?)').run('ordinary-work','ordinary-source','ordinary-work','ACTIVE',1,1,JSON.stringify({kind:'ordinary'}));
  db.prepare('INSERT INTO budgets VALUES(?,?,8,0,1)').run('ordinary-work','execution');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run('ordinary-run','ordinary-work',1,1,'RUNNING',path.join(f.home,'state'),'reserved',JSON.stringify({kind:'ordinary'}));
 }finally{db.close();}
 const requests=f.server.requests.length;await assert.rejects(f.reopen(),/Configuration operation family required/);
 f.controller.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({kind:'configuration-http',operationId:plan.planId,stage:'apply-step'}),'crashed-config');
 configureOwnedRepositoryConfigurationFixture(f.controller,{origin:f.server.origin,token:'fixture-native-token'});
 for(let i=0;i<2;i++)assert.equal(f.controller.inspectRepositoryConfiguration(plan.planId).phase,'UNKNOWN');
 assert.equal(f.controller.store.one('SELECT phase FROM runs WHERE id=?','crashed-config').phase,'INTERRUPTED');assert.equal(f.controller.inspectWork(plan.workId).allowance.consumed,used+1);assert.equal(f.controller.inspectWork(plan.workId).allowance.reserved,0);
 assert.equal(f.controller.store.one('SELECT phase FROM runs WHERE id=?','ordinary-run').phase,'RUNNING');assert.deepEqual({...f.controller.store.one('SELECT consumed,reserved FROM budgets WHERE lineage=?','ordinary-work')},{consumed:0,reserved:1});assert.equal(f.server.requests.length,requests);assert.equal(f.writes().length,0);
 await assert.rejects(f.controller.cancelWork({workId:'ordinary-work'}),/MANAGEMENT_ONLY/);
});

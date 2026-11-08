import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {openController} from '../../dist/controller/index.js';import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';import {configurationServer,configurationTarget,configurationProfile} from './configuration-fixture.mjs';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';

for(const exhausted of [false,true]) test('a stopped current-values read resumes from the same plan with '+(exhausted?'no units left':'no historical reread'), {timeout:8000}, async t=>{
 const fixture=await configurationServer();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-noop-stop-')));
 const c=await openController({installationHome:path.join(root,'home')});
 const configure=()=>configureOwnedRepositoryConfigurationFixture(c,{origin:fixture.origin,token:'fixture-original'});
 t.after(async()=>{await c.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});});
 configure();
 const {targetId}=c.registerRepositoryConfigurationTarget({target:configurationTarget});
 const original=await c.previewRepositoryConfiguration({targetId,profile:{version:'original',mergeMethods:{rebase:true}}});
 fixture.setPatchRefused(true);
 assert.equal((await c.applyRepositoryConfiguration({planId:original.planId})).phase,'UNKNOWN');
 assert.equal((await c.reconcileRepositoryConfiguration({planId:original.planId})).phase,'UNKNOWN');
 const revised=await c.previewRepositoryConfiguration({targetId,continuationPlanId:original.planId,profile:{version:'no-op',mergeMethods:{merge:true}}});
 assert.equal(revised.plan.steps.length,0);
 assert.equal(revised.steps[0].forwardRevision,revised.revision);
 fixture.repo.allow_rebase_merge=true;
 const before=c.inspectWork(original.workId).allowance.consumed;
 const abort=new AbortController(), held=fixture.holdNext('/user','GET');
 const pending=c.reconcileRepositoryConfiguration({planId:original.planId,signal:abort.signal});
 let committed;
 try {
  await held.entered;
  committed=c.inspectRepositoryConfiguration(original.planId);
  assert.equal(committed.steps[0].state,'CONFIRMED');
  assert.equal(committed.steps[0].receiptIds.length,revised.steps[0].receiptIds.length+1);
 } finally {
  abort.abort();
  held.release();
 }
 const stopped=await pending;
 assert.deepEqual(stopped,committed);
 assert.deepEqual([stopped.planId,stopped.workId,stopped.revision],[original.planId,original.workId,revised.revision]);
 assert.equal(c.inspectWork(original.workId).allowance.consumed,before+2);
 assert.equal(c.inspectWork(original.workId).allowance.reserved,0);
 assert.equal(c.store.one("SELECT count(*) n FROM effect_receipts WHERE operation=? AND kind='configuration-noop-reconcile'",original.planId).n,0);
 if(exhausted)c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",original.workId);
 const credential=path.join(root,'credential.json');
 await fs.writeFile(credential,'{"token":"fixture-original"}',{mode:0o600});
 c.configureRepositoryConfigurationCredential=configure;
 const source=c.createConversation().conversationId,requests=fixture.requests.length;
 const choices=['plans','plan:'+original.planId,'reconcile','back','back','close'];
 const ui=repositoryCommands({controller:c,isCurrent:()=>true,choose:async()=>assert.fail('Use exact choices'),chooseItems:async(title,items)=>{
  const selected=choices.shift();
  if(selected==='reconcile'){
   const action=items.find(item=>item.value===selected);
   assert.equal(action?.label,'Confirm current selected settings (read only)');
   assert.ok(title.includes(action.label));
   assert.ok(!items.some(item=>item.value==='apply'));
  }
  if(exhausted&&selected==='back'&&items.some(item=>item.value==='audit')){
   assert.ok(title.includes('Audit selected settings'));
   assert.ok(!items.some(item=>item.value==='reconcile'||item.value==='apply'));
  }
  return selected;
 },input:async()=>credential,show:async()=>{},notice:()=>{}});
 t.after(()=>ui.close());
 await ui.commands[0].run('',source);
 assert.deepEqual(choices,[]);
 const resumed=c.inspectRepositoryConfiguration(original.planId);
 assert.equal(resumed.phase,exhausted?'REFUSED':'CONFIRMED');
 assert.deepEqual(resumed.steps,stopped.steps);
 assert.equal(c.inspectWork(original.workId).allowance.consumed,before+(exhausted?2:3));
 assert.equal(c.inspectWork(original.workId).allowance.reserved,0);
 assert.deepEqual(fixture.requests.slice(requests).map(({method,path})=>[method,path]),exhausted?[]:[['GET','/user'],['GET','/repos/owner/repo']]);
 assert.deepEqual(fixture.requests.filter(request=>request.method==='PATCH').map(request=>request.method),['PATCH']);
});

for (const lastUnit of [false,true]) test('a no-op revision observes forwarded transport with '+(lastUnit?'one unit left':'allowance for a current read'),async t=>{
 const fixture=await configurationServer();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-forwarded-')));
 const c=await openController({installationHome:path.join(root,'home')});
 t.after(async()=>{await c.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});});
 configureOwnedRepositoryConfigurationFixture(c,{origin:fixture.origin,token:'fixture-original'});
 const {targetId}=c.registerRepositoryConfigurationTarget({target:configurationTarget});
 const original=await c.previewRepositoryConfiguration({targetId,profile:{version:'original',mergeMethods:{rebase:true}}});
 fixture.setPatchRefused(true);
 assert.equal((await c.applyRepositoryConfiguration({planId:original.planId})).phase,'UNKNOWN');
 assert.equal((await c.reconcileRepositoryConfiguration({planId:original.planId})).phase,'UNKNOWN');
 const revised=await c.previewRepositoryConfiguration({targetId,continuationPlanId:original.planId,
  profile:{version:'no-op',mergeMethods:{rebase:false}}});
 assert.equal(revised.plan.steps.length,0);
 assert.equal(revised.steps[0].forwardRevision,revised.revision);
 const priorAllowance=c.inspectWork(original.workId).allowance, priorRequests=fixture.requests.length;
 assert.deepEqual(await c.reconcileRepositoryConfiguration({planId:original.planId,signal:AbortSignal.abort(Error('Owner stopped before read'))}),revised);
 assert.deepEqual(c.inspectWork(original.workId).allowance,priorAllowance);
 assert.equal(fixture.requests.length,priorRequests);
 let held=await c.reconcileRepositoryConfiguration({planId:original.planId});
 assert.equal(held.phase,'UNKNOWN');
 assert.equal(held.steps[0].state,'UNKNOWN');
 if (lastUnit) {
  for (let index=0;index<2;index++) held=await c.reconcileRepositoryConfiguration({planId:original.planId});
  const allowance=c.inspectWork(original.workId).allowance;
  assert.equal(allowance.limit-allowance.consumed,1);
 }
 fixture.repo.allow_rebase_merge=true;
 const recovered=await c.reconcileRepositoryConfiguration({planId:original.planId});
 assert.equal(recovered.phase,'REFUSED');
 assert.equal(recovered.planId,original.planId);
 assert.equal(recovered.workId,original.workId);
 assert.equal(recovered.steps[0].journalId,revised.steps[0].journalId);
 assert.equal(recovered.steps[0].state,'CONFIRMED');
 assert.equal(recovered.steps[0].transportOutcome,'uncertain');
 assert.equal(recovered.steps[0].receiptIds.length,held.steps[0].receiptIds.length+1);
 if (lastUnit) {
  assert.match(recovered.blocked.join('\n'),/execution allowance exhausted/);
  assert.equal(recovered.nextAction,'auditRepositoryConfiguration');
 }
 assert.deepEqual(fixture.requests.filter(request=>request.method!=='GET').map(request=>request.method),['PATCH']);
});
for(const world of ['lost-create','partial-patch','third-value'])test('owner configuration '+world+' retains once-only original step and exact compare-forward recovery',{timeout:8000},async()=>{const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-recovery-'))),home=path.join(root,'home');let c=await openController({installationHome:home}),passed=false;try{const t=c.registerRepositoryConfigurationTarget({target:configurationTarget});configureOwnedRepositoryConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const profile=configurationProfile();if(world==='third-value'){profile.ruleset.name='old-name';delete profile.mergeMethods;}const p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile});if(world==='lost-create')f.setDrop(true);if(world==='partial-patch')f.setPatchRefused(true);let result=await c.applyRepositoryConfiguration({planId:p.planId});assert.equal(result.phase,world==='third-value'?'CONFIRMED':'UNKNOWN',JSON.stringify(result));const before=c.inspectWork(p.workId).allowance.consumed;if(world==='third-value'){
 const updateProfile={version:'rename',ruleset:{...profile.ruleset,name:'desired-name'}};const update=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:updateProfile,ownedCreationOperationId:p.planId});f.setDrop(true);const resource=[...f.rules.values()].find(r=>r.id!==99);result=await c.applyRepositoryConfiguration({planId:update.planId});assert.equal(result.phase,'UNKNOWN');assert.equal(resource.name,'desired-name');resource.name='concurrent-third-name';const reconciled=await c.reconcileRepositoryConfiguration({planId:update.planId});assert.equal(reconciled.phase,'UNKNOWN');assert.ok(reconciled.steps.some(j=>j.observations.some(o=>o.path==='ruleset.name'&&o.actual==='concurrent-third-name')));const sends=f.requests.filter(r=>r.method==='PUT').length;assert.throws(()=>c.previewRepositoryConfiguration({targetId:t.targetId,continuationPlanId:update.planId,profile:updateProfile}),/before\/intended/);assert.equal(f.requests.filter(r=>r.method==='PUT').length,sends);assert.equal(sends,1);passed=true;return;
 }
 await c.close();c=await openController({installationHome:home});configureOwnedRepositoryConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const opCount=c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,sendCount=f.requests.filter(r=>r.method!=='GET').length;assert.equal(c.inspectWork(p.workId).allowance.consumed,before);assert.equal(c.inspectWork(p.workId).allowance.reserved,0);assert.throws(()=>c.previewRepositoryConfiguration({targetId:t.targetId,continuationPlanId:p.planId,profile}),/reconciliation/);result=await c.reconcileRepositoryConfiguration({planId:p.planId});assert.equal(f.requests.filter(r=>r.method!=='GET').length,sendCount);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,opCount);
 if(world==='lost-create'){assert.equal(result.steps[0].state,'CONFIRMED');assert.equal(result.steps[0].transportOutcome,'uncertain');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);f.setDrop(false);const remaining={version:'remaining-merge',mergeMethods:{rebase:true}};result=await c.previewRepositoryConfiguration({targetId:t.targetId,continuationPlanId:p.planId,profile:remaining});assert.equal(result.planId,p.planId);assert.equal(result.workId,p.workId);assert.equal((await c.applyRepositoryConfiguration({planId:p.planId})).phase,'CONFIRMED');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
 }else{assert.equal(result.phase,'UNKNOWN');const oldStep=result.steps.find(j=>j.kind==='patch-merge-methods');assert.equal(oldStep.observations[0].actual,false);assert.equal(oldStep.transportOutcome,'uncertain');f.setPatchRefused(false);result=await c.previewRepositoryConfiguration({targetId:t.targetId,continuationPlanId:p.planId,profile:{version:'explicit-remaining',mergeMethods:{rebase:true}}});assert.equal(result.phase,'PREVIEWED',JSON.stringify(result));assert.equal(result.planId,p.planId);const next=await c.applyRepositoryConfiguration({planId:p.planId});assert.equal(next.phase,'CONFIRMED',JSON.stringify(next));assert.equal(next.steps.find(j=>j.journalId===oldStep.journalId).transportOutcome,'uncertain');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.requests.filter(r=>r.method==='PATCH').length,2);}
 assert.ok(c.inspectWork(p.workId).allowance.consumed>before);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_delegations').n,1);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);passed=true;}finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained configuration recovery '+root);}});

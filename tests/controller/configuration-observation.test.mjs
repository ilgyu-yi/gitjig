import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {openController} from '../../dist/controller/index.js';import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';import {configurationServer,configurationTarget} from './configuration-fixture.mjs';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';

test('stopping the second audit read preserves only the completed observation', {timeout:5000}, async t=>{
 let hold=false, enter, close;
 const entered=new Promise(resolve=>{enter=resolve;}), closed=new Promise(resolve=>{close=resolve;});
 const fixture=await nativeConfigurationFixture('gitea',{intercept({req,res,relative}){
  if(!hold||req.method!=='GET'||relative!=='/repos/owner/repo/branch_protections/main')return false;
  hold=false;
  res.once('close',close);
  enter();
  return true;
 }});
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-audit-stop-')));
 const c=await openController({installationHome:path.join(root,'home')});
 t.after(async()=>{await c.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});});
 const {targetId}=c.registerRepositoryConfigurationTarget({target:fixture.target});
 configureOwnedRepositoryConfigurationFixture(c,{origin:fixture.origin,token:'fixture-native-token'});
 const prepared=await c.previewRepositoryConfiguration({targetId,profile:fixture.profile});
 const original=await c.applyRepositoryConfiguration({planId:prepared.planId});
 assert.equal(original.phase,'CONFIRMED');
 assert.equal(original.steps.length,2);
 const before=c.inspectWork(original.workId).allowance, requests=fixture.requests.length;
 const refused=await c.auditRepositoryConfiguration({planId:original.planId,signal:AbortSignal.abort(Error('Stopped before audit'))});
 assert.equal(refused.complete,false);
 assert.deepEqual(refused.view,original);
 assert.deepEqual(c.inspectWork(original.workId).allowance,before);
 assert.equal(fixture.requests.length,requests);
 const count=()=>c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='configuration-audit'",original.planId).n;
 const startCount=count(),abort=new AbortController();
 hold=true;
 const pending=c.auditRepositoryConfiguration({planId:original.planId,signal:abort.signal});
 await entered;
 try {assert.equal(count(),startCount+1);} finally {abort.abort();}
 const result=await pending;
 await closed;
 assert.equal(result.complete,false);
 assert.equal(result.steps.length,1);
 assert.equal(result.steps[0].journalId,original.steps[0].journalId);
 assert.equal(result.steps[0].result.outcome,'confirmed');
 assert.equal(count(),startCount+1);
 assert.deepEqual(result.view.steps,original.steps);
 assert.deepEqual([result.view.phase,result.view.workId,result.view.revision],['CONFIRMED',original.workId,original.revision]);
 assert.deepEqual({...c.inspectWork(original.workId).allowance},{...before,consumed:before.consumed+2});
 assert.ok(fixture.requests.slice(requests).every(request=>request.method==='GET'));
});

test('stopping a no-op audit creates no new observation receipt', {timeout:5000}, async t=>{
 const fixture=await configurationServer();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-noop-audit-stop-')));
 const c=await openController({installationHome:path.join(root,'home')});
 t.after(async()=>{await c.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});});
 const {targetId}=c.registerRepositoryConfigurationTarget({target:configurationTarget});
 configureOwnedRepositoryConfigurationFixture(c,{origin:fixture.origin,token:'fixture-original'});
 const plan=await c.previewRepositoryConfiguration({targetId,profile:{version:'no-op',mergeMethods:{merge:true}}});
 assert.equal(plan.plan.steps.length,0);
 const hold=fixture.holdNext('/user','GET'), abort=new AbortController();
 const before=c.inspectWork(plan.workId).allowance,requests=fixture.requests.length;
 const pending=c.auditRepositoryConfiguration({planId:plan.planId,signal:abort.signal});
 await hold.entered;
 let result;
 try {abort.abort(Error('Owner stopped no-op audit'));result=await pending;} finally {hold.release();}
 assert.deepEqual(result.view,plan);
 assert.deepEqual(result.steps,[]);
 assert.equal(result.complete,false);
 assert.deepEqual({...c.inspectWork(plan.workId).allowance},{...before,consumed:before.consumed+1});
 assert.deepEqual(fixture.requests.slice(requests).map(({method,path})=>[method,path]),[['GET','/user']]);
});
test('absent actual preview is never complete and no-op configuration completion requires fresh actual selected values',{timeout:5000},async()=>{const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-observation-'))),c=await openController({installationHome:path.join(root,'home')});let passed=false;try{const t=c.registerRepositoryConfigurationTarget({target:configurationTarget}),profile={version:'desired-noop',mergeMethods:{merge:true}};const unavailable=await c.previewRepositoryConfiguration({targetId:t.targetId,profile});assert.equal(unavailable.phase,'REFUSED');assert.equal(unavailable.plan,null);const audit=await c.auditRepositoryConfiguration({planId:unavailable.planId});assert.equal(audit.complete,false,JSON.stringify(audit));assert.notEqual((await c.reconcileRepositoryConfiguration({planId:unavailable.planId})).phase,'CONFIRMED');configureOwnedRepositoryConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile,continuationPlanId:unavailable.planId});assert.equal(p.phase,'PREVIEWED');assert.equal(p.plan.steps.length,0);assert.equal((await c.auditRepositoryConfiguration({planId:p.planId})).complete,true);f.repo.allow_merge_commit=false;const drift=await c.auditRepositoryConfiguration({planId:p.planId});assert.equal(drift.complete,false);assert.notEqual((await c.reconcileRepositoryConfiguration({planId:p.planId})).phase,'CONFIRMED');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);passed=true;}finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained config observation '+root);}});
test('an unsupported selected owned group remains incomplete even when executable step list is empty',{timeout:5000},async()=>{const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-config-manual-'))),c=await openController({installationHome:path.join(root,'home')});let passed=false;try{const t=c.registerRepositoryConfigurationTarget({target:configurationTarget});configureOwnedRepositoryConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const profile={version:'supported-rule',ruleset:{name:'owner-branch',enforcement:'active',include:['refs/heads/main'],exclude:[],nonFastForward:true,deletion:true,bypassUsers:[]}},created=await c.previewRepositoryConfiguration({targetId:t.targetId,profile});assert.equal((await c.applyRepositoryConfiguration({planId:created.planId})).phase,'CONFIRMED');[...f.rules.values()].find(r=>r.id!==99).rules.push({type:'unsupported_future_rule'});const p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile,ownedCreationOperationId:created.planId});assert.equal(p.plan.steps.length,0);assert.ok(p.plan.manual.length);const before=f.requests.filter(r=>r.method!=='GET').length;assert.equal((await c.applyRepositoryConfiguration({planId:p.planId})).phase,'REFUSED');assert.equal((await c.auditRepositoryConfiguration({planId:p.planId})).complete,false);assert.notEqual((await c.reconcileRepositoryConfiguration({planId:p.planId})).phase,'CONFIRMED');assert.equal(f.requests.filter(r=>r.method!=='GET').length,before);passed=true;}finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained unsupported selected config '+root);}});

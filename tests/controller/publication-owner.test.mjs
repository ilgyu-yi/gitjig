import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
import {publicationServer,target,issue} from './publication-fixture.mjs';
async function setup(server){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-publication-'))),home=path.join(root,'home'),c=await openController({installationHome:home});return {root,home,c};}
async function cleanup(f,c,root,passed){let clean=false;try{await c.close();await f.close();clean=true;}finally{if(passed&&clean)await fs.rm(root,{recursive:true,force:true});else console.error('Retained publication fixture: '+root);}}
test('full Controller exact-owner issue requires no project/model; disabled preparation sends0 then same retained operation observes same-credential authority and publishes exact bytes once',async()=>{
 const f=await publicationServer(),fixture=await setup(f);let {c}=fixture,passed=false;try{
  const t=c.registerPublicationTarget({target,visibility:'public'});assert.equal(c.listProjects().length,0);const original=issue(),disabled=await c.prepareOwnerPublication({targetId:t.targetId,action:original});assert.equal(disabled.phase,'REFUSED');assert.equal(disabled.activation,'disabled');assert.equal(f.requests.length,0);assert.equal(c.inspectWork(disabled.workId).projectId,null);assert.equal(c.store.one('PRAGMA user_version').user_version,8);
  configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const prepared=await c.prepareOwnerPublication({targetId:t.targetId,operationId:disabled.operationId,action:original});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));original.body='mutated outside authorization';assert.equal(f.requests.filter(r=>r.method==='POST').length,0);await c.close();
  c=await openController({installationHome:fixture.home});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const result=await c.dispatchPublication({operationId:prepared.operationId});assert.equal(result.phase,'CONFIRMED',JSON.stringify(result));assert.equal(result.transportOutcome,'native-success');assert.equal(result.observedOutcome,'resource-matches');assert.equal(f.rows.length,1);assert.equal(f.rows[0].title,issue().title);assert.equal(f.rows[0].body,issue().body+'\n\n<!-- gitjig-operation: '+prepared.operationId+' -->');assert.ok(f.requests.every(r=>r.auth==='Bearer fixture-original'));assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM projects').n,0);const count=f.requests.filter(r=>r.method==='POST').length;await c.dispatchPublication({operationId:prepared.operationId});await c.reconcilePublication({operationId:prepared.operationId});assert.equal(f.requests.filter(r=>r.method==='POST').length,count);passed=true;
 }finally{await cleanup(f,c,fixture.root,passed);}
});
test('same powerful User with a weak fresh credential cannot consume old strong capability; absent exact owner authorization and changed payload/source are refusals',async()=>{
 const f=await publicationServer(),fixture=await setup(f);let {c}=fixture,passed=false;try{const t=c.registerPublicationTarget({target,visibility:'public'});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.prepareOwnerPublication({targetId:t.targetId,action:issue()});assert.equal(p.phase,'RESERVED');await c.close();c=await openController({installationHome:fixture.home});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-weak'});const denied=await c.dispatchPublication({operationId:p.operationId});assert.equal(denied.phase,'REFUSED');assert.equal(f.requests.filter(r=>r.method==='POST').length,0);configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const row=c.store.one('SELECT data FROM effect_operations WHERE id=?',p.operationId),data=JSON.parse(row.data);delete data.ownerAuthorization;c.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify(data),p.operationId);assert.equal((await c.dispatchPublication({operationId:p.operationId})).phase,'REFUSED');assert.equal(f.requests.filter(r=>r.method==='POST').length,0);passed=true;}finally{await cleanup(f,c,fixture.root,passed);}
});
test('actual commit then dropped response retains UNKNOWN across full Controller restart and reconciles READ ONLY without fresh POST or grant reset',async()=>{
 const f=await publicationServer({drop:true}),fixture=await setup(f);let {c}=fixture,passed=false;try{const t=c.registerPublicationTarget({target,visibility:'public'});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.prepareOwnerPublication({targetId:t.targetId,action:issue()}),sent=await c.dispatchPublication({operationId:p.operationId});assert.equal(sent.phase,'UNKNOWN');assert.equal(f.rows.length,1);await c.close();c=await openController({installationHome:fixture.home});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-weak'});const observed=await c.reconcilePublication({operationId:p.operationId});assert.equal(observed.phase,'CONFIRMED',JSON.stringify(observed));assert.equal(observed.transportOutcome,'uncertain');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);passed=true;}finally{await cleanup(f,c,fixture.root,passed);}
});
test('owner bootstrap admission is atomic before immediate close, and invalid payload leaves no work/grant/operation',async()=>{
 const f=await publicationServer(),fixture=await setup(f);let {c}=fixture,passed=false;
 try{
  const t=c.registerPublicationTarget({target,visibility:'public'});
  await assert.rejects(c.prepareOwnerPublication({targetId:t.targetId,action:{kind:'create-issue',title:'invalid @everyone',body:''}}));
  for(const table of ['works','effect_operations','effect_delegations'])assert.equal(c.store.one(`SELECT COUNT(*) AS n FROM ${table}`).n,0,table);
  const pending=c.prepareOwnerPublication({targetId:t.targetId,action:issue()});
  const closing=c.close();
  const result=await pending;await closing;
  assert.ok(result.workId);assert.ok(result.operationId);assert.equal(result.phase,'REFUSED');assert.equal(f.requests.length,0);
  c=await openController({installationHome:fixture.home});
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);
  assert.equal(c.inspectPublication(result.operationId).workId,result.workId);
  assert.equal(c.inspectWork(result.workId).projectId,null);passed=true;
 }finally{await cleanup(f,c,fixture.root,passed);}
});
test('target policy registration accepts content-independent one-byte title bounds and private literal unrelated to actual payload',async()=>{
 const f=await publicationServer(),fixture=await setup(f);let {c}=fixture,passed=false;
 try{
  const carrierPolicy={version:'small-title/v1',allowedMentions:[],knownPrivateLiterals:['Target validation'],maxTitleBytes:1,maxBodyBytes:1024};
  const t=c.registerPublicationTarget({target,visibility:'public',carrierPolicy});
  await assert.rejects(c.prepareOwnerPublication({targetId:t.targetId,action:{kind:'create-issue',title:'AB',body:''}}));
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM works').n,0);
  configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});
  const p=await c.prepareOwnerPublication({targetId:t.targetId,action:{kind:'create-issue',title:'A',body:'safe'}});
  assert.equal(p.phase,'RESERVED',JSON.stringify(p));assert.equal((await c.dispatchPublication({operationId:p.operationId})).phase,'CONFIRMED');
  assert.equal(f.rows.length,1);assert.equal(f.rows[0].title,'A');passed=true;
 }finally{await cleanup(f,c,fixture.root,passed);}
});
test('missing/stale/wrong-purpose installed action descriptor refuses without POST; explicit exact-owner preparation restores the same retained operation',async()=>{
 const f=await publicationServer(),fixture=await setup(f);let {c}=fixture,passed=false;
 try{const t=c.registerPublicationTarget({target,visibility:'public'});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.prepareOwnerPublication({targetId:t.targetId,action:issue()});const original=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.operationId).data);
  for(const bad of [undefined,{...original.actionDescriptor,version:'obsolete'}, {...original.actionDescriptor,action:'create-comment:reviewed-summary'}, {...original.actionDescriptor,prerequisites:[] }]){const data={...original};if(bad===undefined)delete data.actionDescriptor;else data.actionDescriptor=bad;c.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify(data),p.operationId);const denied=await c.dispatchPublication({operationId:p.operationId});assert.equal(denied.phase,'REFUSED');assert.match(denied.blocked.join(),/descriptor/);assert.equal(f.rows.length,0);}
  const restored=await c.prepareOwnerPublication({targetId:t.targetId,operationId:p.operationId,action:issue()});assert.equal(restored.operationId,p.operationId);assert.equal(restored.workId,p.workId);assert.equal((await c.dispatchPublication({operationId:p.operationId})).phase,'CONFIRMED');assert.equal(f.rows.length,1);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);passed=true;
 }finally{await cleanup(f,c,fixture.root,passed);}
});
test('complete201 creationHint survives failed readback/restart and exact resource read recovers without collection scan or POST retry',async()=>{
 const f=await publicationServer({readbackFailure:true}),fixture=await setup(f);let {c}=fixture,passed=false;
 try{const t=c.registerPublicationTarget({target,visibility:'public'});configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-original'});const p=await c.prepareOwnerPublication({targetId:t.targetId,action:issue()}),unknown=await c.dispatchPublication({operationId:p.operationId});assert.equal(unknown.phase,'UNKNOWN');const data=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.operationId).data);assert.equal(data.creationHint.id,100);assert.equal(f.rows.length,1);await c.close();c=await openController({installationHome:fixture.home});f.allowReadback();configureOwnedPublicationFixture(c,{origin:f.origin,token:'fixture-weak'});const before=f.requests.length,result=await c.reconcilePublication({operationId:p.operationId});assert.equal(result.phase,'CONFIRMED');assert.equal(result.transportOutcome,'uncertain');const reads=f.requests.slice(before);assert.ok(reads.some(r=>r.path==='/repos/owner/repo/issues/1'));assert.ok(!reads.some(r=>r.path.includes('/issues?')));assert.equal(f.requests.filter(r=>r.method==='POST').length,1);passed=true;
 }finally{await cleanup(f,c,fixture.root,passed);}
});

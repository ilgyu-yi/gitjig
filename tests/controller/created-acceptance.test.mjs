import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {configureCreatedAcceptance} from '../../.qualification/controller-acceptance.js';
import {createOwnedAcceptanceSetup} from '../../dist/platform/hosted-context.js';
import {fixture} from '../platform/acceptance-fixture.mjs';
test('runtime exact-created context joins useful existing Controller publication/configuration without replacing source grants/intents/native observations',async()=>{
 const f=await fixture();let setup,c,success=false;
 try{
  setup=await createOwnedAcceptanceSetup(f.setupOptions);const context=await setup.create();c=await openController({installationHome:path.join(f.directory,'controller')});
  assert.throws(()=>configureCreatedAcceptance(c,JSON.parse(JSON.stringify(context))),/context/);assert.equal(c.store.one('SELECT COUNT(*) n FROM works').n,0);
  const joined=configureCreatedAcceptance(c,context);assert.equal(joined.activation,'created-private-local-acceptance');assert.equal(joined.credentialSessionId,context.credentialSessionId);
  const target=c.registerPublicationTarget({target:context.target,visibility:'private'}),action={kind:'create-issue',title:'Synthetic Controller acceptance',body:'한국어 owner bytes.\nNo project data or notification mentions.'};
  const prepared=await c.prepareOwnerPublication({targetId:target.targetId,action});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));assert.equal(prepared.activation,joined.activation);
  const confirmed=await c.dispatchPublication({operationId:prepared.operationId});assert.equal(confirmed.phase,'CONFIRMED',JSON.stringify(confirmed));assert.equal(f.state.issues.length,1);assert.match(f.state.issues[0].body,/한국어 owner bytes/);
  const op=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',prepared.operationId).data);assert.ok(op.dispatchIntent);assert.ok(c.store.one('SELECT id FROM effect_delegations WHERE id=?',c.store.one('SELECT grant_id FROM effect_operations WHERE id=?',prepared.operationId).grant_id));
  const configTarget=c.registerRepositoryConfigurationTarget({target:{...context.target,visibility:'private'}}),preview=await c.previewRepositoryConfiguration({targetId:configTarget.targetId,profile:{version:'014-controller',mergeMethods:{squash:false}}});assert.equal(preview.phase,'PREVIEWED',JSON.stringify(preview));assert.equal(preview.plan.steps.length,1);
  const applied=await c.applyRepositoryConfiguration({planId:preview.planId});assert.equal(applied.phase,'CONFIRMED',JSON.stringify(applied));assert.equal(f.state.repository.allow_squash_merge,false);assert.equal(f.state.repository.allow_rebase_merge,true);
  assert.ok(f.state.calls.every(x=>x.auth==='Bearer fixture-literal-original'));const posts=f.state.calls.filter(x=>x.method==='POST').length;await setup.close();setup=null;assert.throws(()=>configureCreatedAcceptance(c,context),/closed/);
  const closed=await c.prepareOwnerPublication({targetId:target.targetId,action});assert.equal(closed.phase,'REFUSED');assert.equal(f.state.calls.filter(x=>x.method==='POST').length,posts);success=true;
 }finally{await c?.close();await setup?.close();await f.close({preserve:!success});if(!success)console.error('Preserved '+f.directory);}
});
test('exact-created Controller UNKNOWN survives setup and Controller restart; same operation reconciles read-only without second POST',async()=>{
 const f=await fixture({dropIssueResponse:true});let setup,c,success=false;
 try{
  setup=await createOwnedAcceptanceSetup(f.setupOptions);let context=await setup.create();const home=path.join(f.directory,'controller');c=await openController({installationHome:home});configureCreatedAcceptance(c,context);
  const {targetId}=c.registerPublicationTarget({target:context.target,visibility:'private'}),prepared=await c.prepareOwnerPublication({targetId,action:{kind:'create-issue',title:'Synthetic unknown acceptance',body:'한국어 원문 그대로\nAccepted once; readonly recovery.'}}),unknown=await c.dispatchPublication({operationId:prepared.operationId});assert.equal(unknown.phase,'UNKNOWN',JSON.stringify(unknown));assert.equal(f.state.issues.length,1);await c.close();c=null;await setup.close();
  setup=await createOwnedAcceptanceSetup(f.setupOptions);context=await setup.reopen();c=await openController({installationHome:home});configureCreatedAcceptance(c,context);const before=f.state.calls.length,confirmed=await c.reconcilePublication({operationId:prepared.operationId});assert.equal(confirmed.phase,'CONFIRMED',JSON.stringify(confirmed));assert.equal(confirmed.transportOutcome,'uncertain');assert.equal(confirmed.workId,prepared.workId);assert.ok(f.state.calls.slice(before).every(x=>x.method==='GET'));assert.equal(f.state.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/issues')).length,1);assert.equal(setup.inspect().counters.issueCreates,1);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,1);success=true;
 }finally{await c?.close();await setup?.close();await f.close({preserve:!success});if(!success)console.error('Preserved '+f.directory);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedNormalPublicConfigurationFixture} from '../../.qualification/controller-testing.js';
import {assertNoPendingRulesetWrite} from '../../dist/controller/policy-handoff.js';
import {configurationServer,configurationTarget,configurationProfile} from './configuration-fixture.mjs';

const proofs=(c,id)=>c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='configuration-native-resource-accounted'",id);
const profile=()=>{const p=configurationProfile();delete p.mergeMethods;return p;};
const parse=JSON.parse;
async function world(body){
 const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-accounting-'))),home=path.join(root,'home');
 let c=await openController({installationHome:home}),passed=false;
 const configure=()=>configureOwnedNormalPublicConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});
 try{configure();const t=c.registerRepositoryConfigurationTarget({target:configurationTarget});
 const p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:profile()});
 const held=f.holdNext('/repos/owner/repo/rulesets/41?includes_parents=true');
 const applying=c.applyRepositoryConfiguration({planId:p.planId});await held.entered;
 f.rules.get(41).enforcement='disabled';held.release();
 const unknown=await applying;assert.equal(unknown.phase,'UNKNOWN');assert.equal(unknown.steps[0].creationHint.id,41);
 const attempt=c.store.one("SELECT * FROM effect_receipts WHERE operation=? AND kind='configuration-step-attempt'",p.planId);
 assert.equal(parse(attempt.data).result.resourceObservation.supported,true);
 assert.equal(parse(attempt.data).result.matched,false);
 const initial=parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.planId).data);
 assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/);
 assert.throws(()=>c.previewRepositoryConfiguration({targetId:t.targetId,profile:profile(),ownedCreationOperationId:p.planId}),/creation chain/);
 await c.close();c=await openController({installationHome:home});configure();
 await body({get c(){return c;},f,p,t,initial,attempt,home,reopen:async()=>{await c.close();c=await openController({installationHome:home});configure();}});passed=true;
 }finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained accounting world '+root);}
}

test('native-created identity accounting survives reopen, preserves UNKNOWN, and admits only fresh same-ID owner PUT',async()=>world(async w=>{
 let c=w.c;const {f,p,t,initial,attempt}=w;
 const held=f.holdNext('/repos/owner/repo/rulesets/41?includes_parents=true');
 const reading=c.reconcileRepositoryConfiguration({planId:p.planId});await held.entered;
 assert.equal(proofs(c,p.planId).length,0);assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/);held.release();
 const r=await reading;assert.equal(r.phase,'UNKNOWN',JSON.stringify(r));assert.match(r.nextAction,/NEW owner preview/);
 assert.equal(proofs(c,p.planId).length,1,JSON.stringify(c.store.all('SELECT * FROM effect_receipts WHERE operation=?',p.planId)));
 const proof=proofs(c,p.planId)[0],data=parse(proof.data),run=c.store.one('SELECT * FROM runs WHERE id=?',data.reconciliationRunId);
 assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.equal(data.attemptReceiptId,attempt.id);
 assertNoPendingRulesetWrite(c.store,configurationTarget);
 const retained=parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.planId).data);
 for(const key of ['source','profile','plan','revisions'])assert.deepEqual(retained[key],initial[key]);
 assert.deepEqual(retained.steps[0].intent,initial.steps[0].intent);assert.equal(retained.steps[0].transportOutcome,'uncertain');
 assert.deepEqual(c.store.one('SELECT * FROM effect_receipts WHERE id=?',attempt.id),attempt);
 await c.reconcileRepositoryConfiguration({planId:p.planId});assert.deepEqual(proofs(c,p.planId),[proof]);
 await w.reopen();c=w.c;assertNoPendingRulesetWrite(c.store,configurationTarget);
 const fresh=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:profile(),ownedCreationOperationId:p.planId});
 assert.equal(fresh.phase,'PREVIEWED',JSON.stringify(fresh));assert.equal(fresh.plan.steps[0].method,'PUT');assert.match(fresh.plan.steps[0].route,/\/41$/);
 configureOwnedNormalPublicConfigurationFixture(c,{origin:f.origin,token:'weak'});
 assert.equal((await c.applyRepositoryConfiguration({planId:fresh.planId})).phase,'REFUSED');assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);
 configureOwnedNormalPublicConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});
 assert.equal((await c.applyRepositoryConfiguration({planId:fresh.planId})).phase,'CONFIRMED');
 assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.requests.filter(r=>r.method==='PUT').length,1);
 assert.equal(c.inspectRepositoryConfiguration(p.planId).phase,'UNKNOWN');
 // A new uncertain PUT is not exempted by the old create's accounting proof.
 const next=profile();next.ruleset.enforcement='disabled';const update=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:next,ownedCreationOperationId:p.planId});
 f.setDrop(true);assert.equal((await c.applyRepositoryConfiguration({planId:update.planId})).phase,'UNKNOWN');
 assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/);
}));

test('damaged provenance and unsettled reconciliation cannot credit identity or release the exact pending guard',async()=>world(async({c,p,t})=>{
 await c.reconcileRepositoryConfiguration({planId:p.planId});const row=proofs(c,p.planId)[0];assert.ok(row);
 const proof=parse(row.data),attempt=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.attemptReceiptId);
 const cases=[
 ['proof identity',()=>{const d=parse(row.data);d.resource.id++;c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),row.id);}],
 ['missing original POST201',()=>{const d=parse(attempt.data);d.result.receipts.find(r=>r.method==='POST').status=200;c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),attempt.id);}],
 ['foreign journal',()=>{const d=parse(row.data);d.journalId='wrong';c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),row.id);}],
 ['original apply still active',()=>{const op=parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.planId).data);c.store.run("UPDATE runs SET phase='RUNNING' WHERE id=?",op.steps[0].intent.runId);}],
 ['wrong durable intent',()=>{const op=parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',p.planId).data);op.steps[0].intent.payloadHash='0'.repeat(64);c.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify(op),p.planId);}],
 ['wrong fresh repository',()=>{const rr=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.reconciliationReceiptId),d=parse(rr.data);d.result.resourceObservation.repository.id++;c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),rr.id);}],
 ['wrong fresh source',()=>{const rr=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.reconciliationReceiptId),d=parse(rr.data);d.result.resourceObservation.source='foreign/repo';c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),rr.id);}],
 ['missing completed repository read',()=>{const rr=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.reconciliationReceiptId),d=parse(rr.data);d.result.receipts.pop();c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),rr.id);}],
 ['fresh run active',()=>c.store.run("UPDATE runs SET phase='RUNNING' WHERE id=?",proof.reconciliationRunId)],
 ['fresh reservation unconsumed',()=>c.store.run("UPDATE runs SET reservation='reserved' WHERE id=?",proof.reconciliationRunId)],
 ['unsupported fresh read',()=>{const rr=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.reconciliationReceiptId),d=parse(rr.data);delete d.result.resourceObservation;c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),rr.id);}],
 ['name correlation',()=>{const rr=c.store.one('SELECT * FROM effect_receipts WHERE id=?',proof.reconciliationReceiptId),d=parse(rr.data);d.result.resourceObservation.identitySource='name-correlation';c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify(d),rr.id);}]
 ];
 const count=c.store.one('SELECT COUNT(*) n FROM effect_operations').n;
 for(const [name,damage]of cases){c.store.run('SAVEPOINT damaged_ledger');try{damage();assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/,name);assert.throws(()=>c.previewRepositoryConfiguration({targetId:t.targetId,profile:profile(),ownedCreationOperationId:p.planId}),/creation chain/,name);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,count);}finally{c.store.run('ROLLBACK TO damaged_ledger');c.store.run('RELEASE damaged_ledger');}}
 assertNoPendingRulesetWrite(c.store,configurationTarget);
}));

test('unsupported or wrong-source fresh reads cannot account a known native-created resource',async()=>world(async({c,f,p})=>{
 f.rules.get(41).rules.push({type:'unknown_future_rule'});
 assert.equal((await c.reconcileRepositoryConfiguration({planId:p.planId})).phase,'UNKNOWN');assert.equal(proofs(c,p.planId).length,0);assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/);
 f.rules.get(41).rules.pop();f.rules.get(41).source='foreign/repo';
 await c.reconcileRepositoryConfiguration({planId:p.planId});assert.equal(proofs(c,p.planId).length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
}));

for(const mode of ['201-lost-detail','EOF-no-201'])test(mode+' requires original parsed 201 and a fresh fully supported exact-ID read',async()=>{
 const f=await configurationServer(),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-accounting-loss-')));let c=await openController({installationHome:path.join(root,'home')}),passed=false;
 try{configureOwnedNormalPublicConfigurationFixture(c,{origin:f.origin,token:'fixture-original'});const t=c.registerRepositoryConfigurationTarget({target:configurationTarget}),p=await c.previewRepositoryConfiguration({targetId:t.targetId,profile:profile()});
 if(mode==='201-lost-detail')f.failNextDetail();else f.setDrop(true);
 assert.equal((await c.applyRepositoryConfiguration({planId:p.planId})).phase,'UNKNOWN');f.setDrop(false);f.rules.get(41).enforcement='disabled';
 await c.close();c=await openController({installationHome:path.join(root,'home')});configureOwnedNormalPublicConfigurationFixture(c,{origin:f.origin,token:'weak'});
 const before=f.requests.length;assert.equal((await c.reconcileRepositoryConfiguration({planId:p.planId})).phase,'UNKNOWN');assert.ok(f.requests.slice(before).every(r=>r.method==='GET'));
 assert.equal(proofs(c,p.planId).length,mode==='201-lost-detail'?1:0);
 if(mode==='201-lost-detail')assertNoPendingRulesetWrite(c.store,configurationTarget);else assert.throws(()=>assertNoPendingRulesetWrite(c.store,configurationTarget),/Pending/);
 assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);passed=true;
 }finally{await c.close();await f.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained accounting loss '+root);}
});

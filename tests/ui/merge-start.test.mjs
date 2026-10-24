import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {readCommand} from './integration-command-fixture.mjs';
const tables=['works','sources','effect_operations','effect_delegations','effect_receipts','runs','budgets'];
const snapshot=c=>JSON.stringify(tables.map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
async function world(t,options={}){const f=await subject(t,options);f.grant();const credential=path.join(f.native.root,'prepare-credential.json');await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});f.c.configureMergeCredential=options=>configureOwnedMergeFixture(f.c,{...options,origin:f.native.origin});return {...f,credential,conversation:f.c.createConversation().conversationId};}
const choices=(f,decision='Prepare this original PR merge')=>['PR merge targets','P · owner/repo','Prepare first PR merge',(_title,rows)=>rows.find(row=>row.includes(f.workId)),(_title,rows)=>rows.find(row=>row.includes(f.branchOperationId)),decision,'Back','Back','Close'];

test('first owner preparation defaults Back without credentials, standing lookup, native requests or allocation',async t=>{
 const f=await world(t),before=snapshot(f.c),requests=f.native.requests.length;f.c.changes.currentEvidence=()=>{throw Error('Back cannot recheck standing');};const h=readCommand(f,choices(f,'Back without preparation'));await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.ok(h.shown.some(row=>row.title.startsWith('Review first PR merge preparation')&&row.text.includes('NOT RECHECKED')));f.native.pass();
});
test('public first owner preparation uses existing work/grant and actual native eligibility without merge send; repeat opens original',async t=>{
 const f=await world(t),before=f.c.store.one('SELECT * FROM effect_delegations WHERE target=?',f.targetId),execution=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,h=readCommand(f,choices(f),[f.credential]);assert.equal(await h.run(),'completed');await h.ui.close();const op=f.c.store.one('SELECT * FROM effect_operations WHERE target=?',f.targetId);assert.equal(op.phase,'RESERVED');assert.equal(op.work,f.workId);assert.equal(op.grant_id,before.id);assert.deepEqual(f.c.store.one('SELECT * FROM effect_delegations WHERE target=?',f.targetId),before);assert.equal(f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,execution+1);assert.equal(f.native.puts(),0);
 const frozen=snapshot(f.c),requests=f.native.requests.length,repeat=choices(f);repeat.splice(4,2);const again=readCommand(f,repeat);await again.run();await again.ui.close();assert.ok(again.shown.some(row=>row.title.startsWith('Original PR merge retained')&&row.text.includes(op.id)));assert.equal(snapshot(f.c),frozen);assert.equal(f.native.requests.length,requests);f.native.pass();
});
test('genuine missing procedure refuses without operation, run, spend or native read',async t=>{
 const f=await world(t);delete f.c.changes.currentEvidence;delete f.c.changes.assertCurrentEvidence;const before=snapshot(f.c),requests=f.native.requests.length,h=readCommand(f,choices(f),[f.credential]);await assert.rejects(h.run());await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});
for(const drift of ['source','project','grant','publication'])test('private credential input cannot refresh reviewed '+drift+' operands',async t=>{
 const f=await world(t),requests=f.native.requests.length;const h=readCommand(f,choices(f),[],{input:async()=>{if(drift==='source')f.c.store.run("UPDATE sources SET raw=raw||' changed' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);if(drift==='project')f.c.store.run("UPDATE projects SET profile=json_set(profile,'$.controlledDrift',true) WHERE id='P'");if(drift==='grant')f.c.store.run("UPDATE effect_delegations SET data=json_set(data,'$.operationLimit',2) WHERE target=?",f.targetId);if(drift==='publication')f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.integrationCommit',?) WHERE id=?",'b'.repeat(40),f.branchOperationId);return path.join(f.native.root,'MUST_NOT_READ_CREDENTIAL.json');}});await assert.rejects(h.run(),/context changed/);await h.ui.close();assert.equal(f.native.requests.length,requests);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,0);f.native.pass();
});
test('held and malformed original publications remain discoverable without checking procedure or repairing records',async t=>{
 const f=await world(t),s=f.c.store;for(const [id,phase,data]of [['held','REFUSED','{}'],['invalid','CONFIRMED','{broken']])s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',id,f.workId,f.registration.sourceBranchTargetId,s.one('SELECT grant_id FROM effect_operations WHERE id=?',f.branchOperationId).grant_id,phase,data);
 const before=snapshot(f.c),page=f.c.listOwnerMergePublications(f.workId,f.targetId,{limit:1});assert.equal(page.publications[0].operationId,'invalid');assert.equal(page.publications[0].state,'HELD');assert.equal(page.nextCursor,'invalid');assert.equal(f.c.listOwnerMergePublications(f.workId,f.targetId,{limit:1,before:page.nextCursor}).publications[0].operationId,'held');assert.throws(()=>f.c.listOwnerMergePublications(f.workId,f.targetId,{before:'missing'}),/cursor/);assert.equal(f.c.inspectOwnerMergePreparation(f.workId,f.targetId,'invalid').eligible,false);assert.equal(snapshot(f.c),before);f.native.pass();
});
test('closing the form during preallocation standing joins the original and admits no late preparation',async t=>{
 const f=await world(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),actual=f.c.changes.currentEvidence.bind(f.c.changes);f.c.changes.currentEvidence=async id=>{entered.resolve();await release.promise;return actual(id);};const before=snapshot(f.c),h=readCommand(f,choices(f),[f.credential]),pending=h.run();void pending.catch(()=>{});await entered.promise;let settled=false;const closing=h.ui.close().then(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release.resolve();await assert.rejects(pending);await closing;assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});
test('postallocation native refusal reports original operation/work/target and never replaces it',async t=>{
 const f=await world(t,{head:'f'.repeat(40)}),h=readCommand(f,choices(f),[f.credential]);await assert.rejects(h.run(),error=>{const op=f.c.store.one('SELECT id,phase FROM effect_operations WHERE target=?',f.targetId);assert.ok(op);assert.equal(op.phase,'REFUSED');return error.message.includes(op.id)&&error.message.includes(f.workId)&&error.message.includes(f.targetId);});await h.ui.close();assert.equal(f.native.puts(),0);f.native.pass();
});

test('same-work original remains the route beyond a full global history page',async t=>{
 const f=await world(t),prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),other=await f.c.beginChange({projectId:'P',request:'Controlled unrelated historical discovery cohort'}),grant=f.c.delegateMerge({workId:other.workId,targetId:f.targetId,operationLimit:100,notifications:'allow-merge-notifications'});
 // Controlled unrelated historical records exercise pagination, not actual merges.
 for(let i=0;i<100;i++)f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','unrelated-history-'+i,other.workId,f.targetId,grant.delegationId,'CONFIRMED',JSON.stringify({kind:'github-merge',evidence:{workId:other.workId},headCommit:'a'.repeat(40)}));
 assert.equal(f.c.listMerges({limit:100}).operations.some(row=>row.operationId===prepared.operationId),false);const before=snapshot(f.c),requests=f.native.requests.length,picks=choices(f);picks.splice(4,2);const h=readCommand(f,picks);await h.run();await h.ui.close();assert.ok(h.shown.some(row=>row.title.startsWith('Original PR merge retained')&&row.text.includes(prepared.operationId)));assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});

test('navigation after successful native preparation names retained original instead of losing its result',async t=>{
 const f=await world(t);let current=true;const h=readCommand(f,choices(f),[f.credential],{isCurrent:()=>current,show:async title=>{if(title.startsWith('Original PR merge preparation retained'))current=false;}});await assert.rejects(h.run(),error=>{const op=f.c.store.one('SELECT id,phase FROM effect_operations WHERE target=?',f.targetId);assert.equal(op.phase,'RESERVED');return error.message.includes(op.id);});await h.ui.close();assert.equal(f.native.puts(),0);f.native.pass();
});
test('form close after native preparation admission aborts and joins while preserving original IDs and spend',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false;const f=await world(t,{intercept:async({req})=>{if(hold&&req.url==='/repos/owner/repo/pulls/12'){hold=false;entered.resolve();await release.promise;}return false;}}),h=readCommand(f,choices(f),[f.credential]);hold=true;const pending=h.run();void pending.catch(()=>{});await entered.promise;
 const closing=h.ui.close();release.resolve();await assert.rejects(pending,error=>{const op=f.c.store.one('SELECT id,phase FROM effect_operations WHERE target=?',f.targetId);assert.equal(op.phase,'REFUSED');return error.message.includes(op.id)&&error.message.includes(f.workId)&&error.message.includes(f.targetId);});await closing;assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").n,0);assert.equal(f.native.puts(),0);f.native.pass();
});

test('review exposes original finite allowances and exhausted preparation refuses before credentials or allocation',async t=>{
 const f=await world(t),context=f.c.inspectOwnerMergePreparation(f.workId,f.targetId,f.branchOperationId);assert.deepEqual(context.allowances,[{kind:'execution',limit:20,consumed:1,reserved:0,remaining:19},{kind:'resolution',limit:8,consumed:0,reserved:0,remaining:8}]);f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='execution'",f.workId);const before=snapshot(f.c),picks=choices(f);picks.splice(5,1);const h=readCommand(f,picks,[],{input:()=>{throw Error('Exhausted preparation cannot read credentials');}});await h.run();await h.ui.close();assert.ok(h.shown.some(row=>row.title.startsWith('Review first PR merge preparation')&&row.text.includes('extend the same work separately')));await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),/allowance exhausted before allocation/);assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});

import {HostCommands} from '../../dist/ui/host-commands.js';
test('first merge with an existing original opens that exact retained recovery through nested registry without replacement',async t=>{
 const f=await world(t),original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),before=snapshot(f.c),requests=f.native.requests.length;
 let h;const steps=['PR merge targets','P · owner/repo','Prepare first PR merge',(_title,rows)=>rows.find(row=>row.includes(f.workId)),(_title,rows)=>{const row=rows.find(row=>row.includes('/repo merge '+original.operationId));assert.ok(row);return row;},(title,rows)=>{assert.match(title,/Original PR merge recovery/);return rows[0];},'Back','Close'];
 h=readCommand(f,steps,[],{execute:(command,target,context)=>new HostCommands(h.ui.commands).execute(command,target,context)});
 assert.equal(await h.run(),'cancelled');await h.ui.close();assert.equal(steps.length,0);assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});

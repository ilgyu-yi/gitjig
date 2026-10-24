import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveredMerge} from '../controller/merge-owner-recovery-fixture.mjs';
import {readCommand} from './integration-command-fixture.mjs';
const tables=['works','sources','effect_operations','effect_delegations','effect_receipts','runs','budgets'];
const snapshot=c=>JSON.stringify(tables.map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
const picks=(mode,accept)=>['Retained PR merges','owner/repo',mode==='renew'?'Review original merge grant renewal':'Review original merge reauthorization',accept??'Back without '+(mode==='renew'?'renewal':'reauthorization'),'Back','Close'];
for(const mode of ['renew','reauthorize'])test('owner '+mode+' defaults Back without procedure, spend or native requests',async t=>{
 const f=await recoveredMerge(t,{candidate:true});if(mode==='reauthorize')f.renew();const before=snapshot(f.c),requests=f.native.requests.length;f.c.changes.currentEvidence=()=>{throw Error('Back cannot read procedures');};const h=readCommand(f,picks(mode),['Explicit bounded owner reason']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.ok(h.shown.some(row=>row.title.includes('Review original PR merge')));f.native.pass();
});
test('repository owner separately renews and reauthorizes the same original without native preparation or spend',async t=>{
 const f=await recoveredMerge(t,{candidate:true}),requests=f.native.requests.length,budgets=f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),runs=f.c.store.all('SELECT * FROM runs ORDER BY rowid'),sequence=['Retained PR merges','owner/repo','Review original merge grant renewal','Renew this original PR merge grant','owner/repo','Review original merge reauthorization','Reauthorize this unsent original PR merge','Back','Close'],h=readCommand(f,sequence,['Explicit same finite authority renewal','Explicit same published candidate reauthorization']);assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(f.c.inspectMerge(f.original.operationId).phase,'PREPARED');assert.equal(f.c.inspectMergeDispatch(f.original.operationId).eligible,false);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);assert.deepEqual(f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),budgets);assert.deepEqual(f.c.store.all('SELECT * FROM runs ORDER BY rowid'),runs);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,1);f.native.pass();
});
for(const mode of ['renew','reauthorize'])test('owner '+mode+' rejects source drift after exact review before confirmation',async t=>{
 const f=await recoveredMerge(t,{candidate:true});if(mode==='reauthorize')f.renew();let before;const h=readCommand(f,picks(mode,mode==='renew'?'Renew this original PR merge grant':'Reauthorize this unsent original PR merge'),['Owner reason'],{show:async(title)=>{if(title.startsWith('Review original PR merge')){f.c.store.run("UPDATE sources SET raw=raw||' drift' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);before=snapshot(f.c);}}});await assert.rejects(h.run(),/context changed/);await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});
for(const mode of ['renew','reauthorize'])test('cancelled '+mode+' reason changes no original, grant, allowance or native state',async t=>{
 const f=await recoveredMerge(t,{candidate:true});if(mode==='reauthorize')f.renew();const before=snapshot(f.c),sequence=picks(mode);sequence.splice(3,1);const h=readCommand(f,sequence);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});
test('grant-only renewal late presentation failure retains returned grant and owner source IDs',async t=>{
 const {recoverMergeAuthority}=await import('../../dist/ui/merge-owner-recovery.js'),f=await recoveredMerge(t,{candidate:true});let error;try{await recoverMergeAuthority({guard(){},choose:async(_title,rows)=>rows[1],input:async()=> 'Explicit original finite authority renewal',show:async title=>{if(title.startsWith('Original PR merge renewal retained'))throw Error('Owner navigation changed after commit');},reauthorize:async()=>{throw Error('Grant-only renewal cannot reauthorize');}},f.c,'','renew',{workId:f.workId,targetId:f.targetId});}catch(value){error=value;}assert.ok(error);const grant=f.c.store.one('SELECT * FROM effect_delegations WHERE target=?',f.targetId),source=JSON.parse(grant.data).renewal.sourceId;for(const id of [grant.id,source,f.workId,f.targetId])assert.ok(error.message.includes(id),id);assert.equal(grant.epoch,2);assert.equal(f.native.puts(),0);f.native.pass();
});
test('owner form close joins held reauthorization and preserves original IDs with no late mutation',async t=>{
 const f=await recoveredMerge(t,{candidate:true});f.renew();const before=snapshot(f.c);let enter,release;const entered=new Promise(r=>{enter=r;}),released=new Promise(r=>{release=r;});f.c.changes.currentEvidence=async()=>{enter();await released;return structuredClone(f.evidence);};const h=readCommand(f,picks('reauthorize','Reauthorize this unsent original PR merge'),['Explicit owner same-original decision']),pending=h.run();void pending.catch(()=>{});await entered;const closing=h.ui.close();release();await assert.rejects(pending,error=>[f.original.operationId,f.workId,f.targetId].every(id=>error.message.includes(id)));await closing;assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});


test('successful merge grant renewal through delegation returns to refreshed choices with navigation enabled',async t=>{
 const f=await recoveredMerge(t,{candidate:true}),budgets=f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),original=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId);
 const sequence=['PR merge targets','P · owner/repo','Delegate ordinary PR merge to owner work',(_title,rows)=>rows.find(row=>row.includes(f.workId)),'Review renewal of this original PR merge grant','Renew this original PR merge grant','Back','Back','Close'];
 const h=readCommand(f,sequence,['Explicit same-original grant renewal'],{execute:async()=>assert.fail('Successful renewal must not check stale pre-renewal recovery')});
 assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(sequence.length,0);
 assert.equal(f.c.inspectMergeDelegation(f.workId,f.targetId).existing.epoch,2);assert.deepEqual(f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId),original);assert.deepEqual(f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),budgets);assert.equal(f.native.puts(),0);f.native.pass();
});

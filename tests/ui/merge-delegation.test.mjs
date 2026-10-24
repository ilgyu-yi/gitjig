import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {readCommand} from './integration-command-fixture.mjs';
const tables=['works','change_state','runs','sources','budgets','capacity_leases','effect_operations','effect_delegations','effect_receipts','authority_observations'];
const snapshot=c=>JSON.stringify(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')]));
async function world(t){const f=await subject(t);return {...f,conversation:f.c.createConversation().conversationId};}
const choices=(f,decision='Delegate PR merge and its notifications to this work')=>['PR merge targets','P · owner/repo','Delegate ordinary PR merge to owner work',(_title,rows)=>rows.find(row=>row.includes(f.workId)),decision,'Back','Back','Close'];
const request=(f,context=f.c.inspectMergeDelegation(f.workId,f.targetId),limit=2)=>({workId:f.workId,targetId:f.targetId,operationLimit:limit,notifications:'allow-merge-notifications',expectedContext:context.fingerprint});

test('public /repo records only separate finite merge authority and keeps exact used original on repeat',async t=>{
 const f=await world(t),before=Object.fromEntries(tables.filter(n=>!['sources','effect_delegations'].includes(n)).map(n=>[n,f.c.store.all('SELECT * FROM '+n+' ORDER BY rowid')])),sources=f.c.store.all('SELECT * FROM sources ORDER BY rowid'),requests=f.native.requests.length;
 f.c.configureMergeCredential=()=>{throw Error('Delegation cannot read/configure credentials');};f.c.prepareOwnerMerge=()=>{throw Error('Delegation cannot prepare');};f.c.changes.drive=()=>{throw Error('Delegation cannot run a model');};
 const h=readCommand(f,choices(f),['2']);assert.equal(await h.run(),'completed');await h.ui.close();const g=f.c.store.one('SELECT * FROM effect_delegations WHERE root=? AND target=?',f.workId,f.targetId),data=JSON.parse(g.data);assert.equal(data.operationLimit,2);assert.equal(data.scope,'work');assert.equal(data.notifications,'allow-merge-notifications');assert.equal(data.rootEpoch,1);assert.equal(f.c.store.all('SELECT * FROM sources').length,sources.length+1);assert.deepEqual(f.c.store.all('SELECT * FROM sources ORDER BY rowid').slice(0,sources.length),sources);for(const [n,rows] of Object.entries(before))assert.deepEqual(f.c.store.all('SELECT * FROM '+n+' ORDER BY rowid'),rows,n);
 // Explicit adverse retained usage, not successful merge evidence.
 f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','retained-merge-use',f.workId,f.targetId,g.id,'REFUSED',JSON.stringify({kind:'github-merge'}));const existing=f.c.inspectMergeDelegation(f.workId,f.targetId);assert.equal(existing.existing.used,1);assert.equal(existing.existing.remaining,1);
 const frozen=snapshot(f.c),again=readCommand(f,choices(f,'Keep this original merge grant'));await again.run();await again.ui.close();assert.equal(snapshot(f.c),frozen);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);assert.ok(h.shown.some(row=>row.text.includes('Export three, publish and merge this exact PR')));f.native.pass();
});
test('default Back and cancelled finite limit record no grant, credentials, native requests or producer',async t=>{
 const f=await world(t),before=snapshot(f.c),requests=f.native.requests.length;
 for(const cancel of [false,true]){const picks=choices(f,'Back without delegation');if(cancel)picks.splice(4,1);const h=readCommand(f,picks,cancel?[]:['1']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);}
 assert.equal(f.native.requests.length,requests);assert.equal(f.c.options.mergeDelegations,undefined);f.native.pass();
});
for(const drift of ['navigation','work','target','source','grant','budget'])test('review refuses '+drift+' drift before recording merge authority',async t=>{
 const f=await world(t);let current=true;const h=readCommand(f,choices(f),['2'],{isCurrent:()=>current,show:async title=>{if(!title.startsWith('Review exact owner PR'))return;if(drift==='navigation')current=false;if(drift==='work')f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId);if(drift==='target')f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.identity.expectedUserId',8) WHERE id=?",f.targetId);if(drift==='source')f.c.store.run("UPDATE sources SET raw=raw||' changed' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);if(drift==='grant')f.grant();if(drift==='budget')f.c.store.run("UPDATE budgets SET reserved=1 WHERE lineage=? AND kind='resolution'",f.workId);}});
 await assert.rejects(h.run(),/changed/);await h.ui.close();assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM effect_delegations WHERE target=?",f.targetId).n,drift==='grant'?1:0);assert.equal(f.native.puts(),0);if(drift==='budget')f.c.store.run('UPDATE budgets SET reserved=0 WHERE lineage=?',f.workId);f.native.pass();
});
for(const held of ['cancelled','unknown','interrupted','agent','ordinary','context','assignment','predecessor','pending','running','cleanup','reservation','capacity','budget','oversized','stale-grant','uncertain-receiver'])test('bounded preview holds '+held+' and refuses direct and reviewed grants without mutation',async t=>{
 const f=await world(t),s=f.c.store;
 if(['cancelled','unknown','interrupted'].includes(held))s.run('UPDATE works SET state=? WHERE id=?',held.toUpperCase(),f.workId);
 if(held==='ordinary')s.run("UPDATE works SET data=json_set(data,'$.kind','ordinary-conversation') WHERE id=?",f.workId);
 if(held==='agent')s.run("UPDATE sources SET origin=json_set(origin,'$.kind','agent-governed-assignment') WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);
 if(held==='context')s.run("UPDATE works SET data=json_set(data,'$.contextOrigin',json('null')) WHERE id=?",f.workId);
 if(held==='assignment')s.run("UPDATE works SET data=json_set(data,'$.invocation.assignmentId','controlled-assignment') WHERE id=?",f.workId);
 if(held==='predecessor')s.run('UPDATE works SET predecessor=? WHERE id=?',f.workId,f.workId);
 if(held==='pending')s.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?",f.workId);
 if(held==='running')s.run("UPDATE runs SET phase='RUNNING' WHERE work=?",f.workId);
 if(held==='cleanup')s.run("UPDATE runs SET data=json_set(data,'$.cleanup','unknown') WHERE work=?",f.workId);
 if(held==='reservation')s.run("UPDATE runs SET reservation='unavailable' WHERE work=?",f.workId);
 if(held==='capacity'){const run=s.one('SELECT id FROM runs WHERE work=?',f.workId);s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','held-capacity',f.workId,run.id,1,1,'ACTIVE','{}');}
 if(held==='budget')s.run("UPDATE budgets SET reserved=1 WHERE lineage=? AND kind='resolution'",f.workId);
 if(held==='oversized')s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({padding:'x'.repeat(1048576)}),f.workId);
 if(held==='stale-grant'){f.grant();s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId);}
 if(held==='uncertain-receiver'){s.run("UPDATE effect_targets SET data=json_set(data,'$.target.ref','refs/heads/main') WHERE id=(SELECT target FROM effect_operations WHERE id=?)",f.branchOperationId);s.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",f.branchOperationId);}
 const before=snapshot(f.c),context=f.c.inspectMergeDelegation(f.workId,f.targetId);assert.equal(context.eligible,false,JSON.stringify(context));assert.ok(context.holds.length);assert.throws(()=>f.c.delegateOwnerMerge(request(f,context),()=>{}),/held/);assert.throws(()=>f.grant());assert.equal(snapshot(f.c),before);
 if(['running','cleanup','reservation'].includes(held))s.run("UPDATE runs SET phase='SETTLED',reservation='consumed',data=json_set(data,'$.cleanup','not-allocated') WHERE work=?",f.workId);
 if(held==='capacity')s.run("UPDATE capacity_leases SET state='RELEASED' WHERE work=?",f.workId);
 if(held==='budget')s.run('UPDATE budgets SET reserved=0 WHERE lineage=?',f.workId);
 f.native.pass();
});
test('transaction rechecks complete context after callback, rolls back drift and refuses async validation',async t=>{
 const f=await world(t),before=snapshot(f.c);let checks=0;
 assert.throws(()=>f.c.delegateOwnerMerge(request(f),()=>{if(++checks===2)f.c.store.run("UPDATE sources SET raw=raw||' changed inside transaction' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);}),/changed/);assert.equal(checks,2);assert.equal(snapshot(f.c),before);
 assert.throws(()=>f.c.delegateOwnerMerge(request(f),async()=>{}),/Synchronous/);assert.equal(snapshot(f.c),before);
 assert.throws(()=>f.c.delegateMerge({workId:f.workId,targetId:f.targetId,operationLimit:2,notifications:'allow-merge-notifications'},()=>{f.c.store.run("UPDATE sources SET raw=raw||' changed direct' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);}),/changed/);assert.equal(snapshot(f.c),before);f.native.pass();
});
test('original exhausted and lineage ceilings keep exact identity without renewal or limit reset',async t=>{
 const f=await world(t);f.c.delegateMerge({workId:f.workId,targetId:f.targetId,scope:'delegation-lineage',operationLimit:1,notifications:'allow-merge-notifications'});const g=f.c.store.one('SELECT * FROM effect_delegations WHERE target=?',f.targetId);f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','used',f.workId,f.targetId,g.id,'REFUSED',JSON.stringify({kind:'github-merge'}));const context=f.c.inspectMergeDelegation(f.workId,f.targetId),before=snapshot(f.c);assert.equal(context.existing.remaining,0);assert.equal(context.eligible,true);f.c.delegateOwnerMerge(request(f,context,1),()=>{});assert.equal(snapshot(f.c),before);assert.throws(()=>f.c.delegateOwnerMerge(request(f,context,2),()=>{}),/reset/);assert.equal(snapshot(f.c),before);f.native.pass();
});
test('bounded work pages retain held originals and reject foreign cursors',async t=>{
 const f=await world(t),other=await f.c.beginChange({projectId:'P',request:'Second original owner work'});f.c.store.run("UPDATE works SET state='CANCELLED' WHERE id=?",other.workId);const before=snapshot(f.c),page=f.c.listMergeDelegationWorks(f.targetId,{limit:1});assert.equal(page.works[0].workId,other.workId);assert.equal(page.works[0].eligible,false);assert.equal(page.nextCursor,other.workId);assert.equal(f.c.listMergeDelegationWorks(f.targetId,{limit:1,before:page.nextCursor}).works[0].workId,f.workId);assert.throws(()=>f.c.listMergeDelegationWorks(f.targetId,{before:'foreign'}),/cursor/);assert.equal(snapshot(f.c),before);f.native.pass();
});
test('postcommit navigation retains original grant and work IDs in the error',async t=>{
 const f=await world(t);let current=true;const h=readCommand(f,choices(f),['1'],{isCurrent:()=>current,show:async title=>{if(title.startsWith('PR merge grant retained'))current=false;}});await assert.rejects(h.run(),error=>{const grant=f.c.store.one('SELECT id FROM effect_delegations WHERE target=?',f.targetId);return error.message.includes(grant.id)&&error.message.includes(f.workId)&&error.message.includes(f.targetId);});await h.ui.close();assert.equal(f.native.puts(),0);f.native.pass();
});

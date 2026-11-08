import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from './merge-controller-fixture.mjs';
const tables=['effect_operations','effect_delegations','effect_receipts','runs','budgets','sources'];
const snapshot=c=>JSON.stringify(tables.map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
for(const drift of ['abort','source'])test('owner preparation refuses '+drift+' during standing before operation or native admission',async t=>{
 const f=await subject(t);f.grant();const entered=Promise.withResolvers(),release=Promise.withResolvers(),actual=f.c.changes.currentEvidence.bind(f.c.changes),abort=new AbortController();f.c.changes.currentEvidence=async id=>{entered.resolve();await release.promise;return actual(id);};
 const pending=f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId,abort.signal);void pending.catch(()=>{});await entered.promise;
 if(drift==='abort')abort.abort(Error('Owner preparation cancelled before allocation'));
 if(drift==='source')f.c.store.run("UPDATE sources SET raw=raw||' changed owner direction' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);
 const before=snapshot(f.c),requests=f.native.requests.length;release.resolve();await assert.rejects(pending);assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,0);f.native.pass();
});

test('awaited owner preparation owns credential session until joined',async t=>{
 const f=await subject(t);f.grant();const entered=Promise.withResolvers(),release=Promise.withResolvers(),actual=f.c.changes.currentEvidence.bind(f.c.changes);f.c.changes.currentEvidence=async id=>{entered.resolve();await release.promise;return actual(id);};
 const pending=f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);void pending.catch(()=>{});await entered.promise;
 try{assert.throws(()=>f.c.configureMergeCredential({token:'another-session'}),/Settle original merge activity/);}finally{release.resolve();}
 const result=await pending;assert.equal(result.phase,'RESERVED');assert.equal(f.native.puts(),0);f.native.pass();
});

test('controller close joins preallocation standing and permits no late operation, run or native request',async t=>{
 const f=await subject(t);f.grant();const {DatabaseSync}=await import('node:sqlite'),entered=Promise.withResolvers(),release=Promise.withResolvers(),actual=f.c.changes.currentEvidence.bind(f.c.changes);f.c.changes.currentEvidence=async id=>{entered.resolve();await release.promise;return actual(id);};
 const pending=f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);void pending.catch(()=>{});await entered.promise;const before=snapshot(f.c),requests=f.native.requests.length;let settled=false;const closing=f.c.close().then(()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release.resolve();await assert.rejects(pending,/clos|quiesc/i);await closing;
 const db=new DatabaseSync(f.home+'/state/controller.sqlite',{readOnly:true});try{assert.equal(JSON.stringify(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),before);}finally{db.close();}assert.equal(f.native.requests.length,requests);f.native.pass();
});
test('host source validation inside allocation rolls back and native failure retains admitted original IDs',async t=>{
 const f=await subject(t);f.grant();const before=snapshot(f.c);let checkedTransaction=false;
 await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId,undefined,()=>{if(f.c.store.db.isTransaction){checkedTransaction=true;f.c.store.run("UPDATE sources SET raw=raw||' rejected transaction source' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);throw Error('Final form source changed');}}),/Final form/);assert.equal(checkedTransaction,true);assert.equal(snapshot(f.c),before);
 let admitted=false;await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId,undefined,()=>{const op=f.c.store.one('SELECT id FROM effect_operations WHERE target=?',f.targetId);if(op){admitted=true;throw Error('Form left after original admission');}}),error=>{const op=f.c.store.one('SELECT id,phase FROM effect_operations WHERE target=?',f.targetId);assert.ok(op);assert.equal(op.phase,'REFUSED');assert.ok(error.message.includes(op.id));assert.ok(error.message.includes(f.workId));assert.ok(error.message.includes(f.targetId));return true;});assert.equal(admitted,true);assert.equal(f.native.puts(),0);assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").n,0);f.native.pass();
});

test('cancellation raised by the final host callback cannot admit an original after its callback returns',async t=>{
 const f=await subject(t);f.grant();const before=snapshot(f.c),abort=new AbortController();await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId,abort.signal,()=>{if(f.c.store.db.isTransaction)abort.abort(Error('Final owner callback cancelled'));}),/Final owner callback cancelled/);assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),0);f.native.pass();
});

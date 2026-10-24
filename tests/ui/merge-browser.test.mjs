import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {browseMerges} from '../../dist/ui/merge-browser.js';
test('owner PR merge browser preserves pending original and all authority while opening recorded facts',async t=>{
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),tables=['effect_operations','effect_delegations','effect_receipts','budgets','runs'],snapshot=()=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]))),before=snapshot();let choices=0,shown=0;
 await browseMerges({guard(){},async choose(title,labels){assert.match(title,/does not resume or send/);return choices++===0?labels[0]:'Back';},async show(title,text){shown++;assert.match(title,/recorded outcome/);const record=JSON.parse(text);assert.equal(record.operationId,original.operationId);assert.equal(record.view.phase,'RESERVED');}},f.c);
 assert.equal(shown,1);assert.equal(snapshot(),before);assert.equal(f.native.puts(),0);f.native.pass();
});

test('merge original-work recovery remains reachable and forwards navigation instead of reporting action completion',async t=>{
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),before=f.c.store.all('SELECT * FROM runs');let choices=0;
 const outcome=await browseMerges({guard(){},choose:async(_title,rows)=>{choices++;return choices===1?rows[0]:rows.find(row=>row.startsWith('Open original work recovery'));},show:async()=>{},navigate:async command=>{assert.equal(command,'/work '+f.workId);return 'started';}},f.c);
 assert.equal(outcome,'started');assert.equal(choices,3);assert.equal(f.c.inspectMerge(original.operationId).phase,'RESERVED');assert.deepEqual(f.c.store.all('SELECT * FROM runs'),before);assert.equal(f.native.puts(),0);f.native.pass();
});

test('confirmed-record next-cycle guidance is a pure retained read with explicit external prerequisites',async t=>{
 // Controlled CONFIRMED UI metadata only. Genuine two-cycle SDK/runtime/native
 // evidence belongs to normal-landing-repeat-runtime.test.mjs, not this fixture.
 const f=await subject(t);f.grant();
 const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 const row=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',original.operationId),recordedCommit='c'.repeat(40);
 f.c.store.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','CONFIRMED',JSON.stringify({...JSON.parse(row.data),mergedCommit:recordedCommit,transportOutcome:'native-success',blocked:[]}),original.operationId);
 assert.equal(f.c.inspectRetainedMerge(original.operationId).view.phase,'CONFIRMED');
 const tables=['effect_operations','effect_targets','effect_delegations','effect_receipts','budgets','runs','works','sources','goals','conversation_inputs'];
 const snapshot=()=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));
 const before=snapshot(),requests=f.native.requests.length;let choices=0,guards=0;const shown=[];
 const result=await browseMerges({guard(){guards++;},choose:async(title,rows)=>{
  if(++choices===1){assert.match(title,/Original PR merge recovery/);assert.ok(rows.includes('Before another hosted change'));return 'Before another hosted change';}
  assert.match(title,/Retained PR merges/);return 'Back';
 },show:async(title,text)=>shown.push({title,text}),navigate:async()=>assert.fail('Guidance navigated to a mutating recovery flow'),prepare:async()=>assert.fail('Guidance prepared a native operation'),dispatch:async()=>assert.fail('Guidance sent a native operation'),reconcile:async()=>assert.fail('Guidance refreshed native facts')},f.c,original.operationId);
 assert.equal(result,false,'Reading guidance does not report completion of an action');
 assert.equal(shown.length,2);assert.match(shown[0].title,/recorded outcome/);
 assert.match(shown[1].title,/external owner and administrator steps/);
 assert.ok(shown[1].text.includes('Recorded merged commit: '+recordedCommit));
 assert.match(shown[1].text,/neither rechecks the remote destination nor synchronizes your original project folder/);
 assert.match(shown[1].text,/repository administrator must separately review/);
 assert.match(shown[1].text,/preserving local changes/);
 assert.match(shown[1].text,/immutable pinned basis/);
 assert.match(shown[1].text,/fresh checks\/review/);
 assert.match(shown[1].text,/restore the same required destination fence/);
 assert.match(shown[1].text,/manual prerequisites/);
 assert.ok(guards>=5,'Original source guards still surround choices and inspection');
 assert.equal(snapshot(),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);
 f.native.pass();
});

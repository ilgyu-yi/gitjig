import test from 'node:test';
import assert from 'node:assert/strict';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {browseMerges} from '../../dist/ui/merge-browser.js';
import {uiText} from '../../dist/ui/i18n.js';
test('owner PR merge browser preserves pending original and all authority while opening recorded facts',async t=>{
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),tables=['effect_operations','effect_delegations','effect_receipts','budgets','runs'],snapshot=()=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]))),before=snapshot();let choices=0,shown=0;
 await browseMerges({guard(){},async choose(title,labels){
  if(choices++===0){assert.match(title,/does not resume or send/);return labels[0];}
  if(shown)return 'Back';
  assert.match(title,/PR merge record.*owner\/repo #12/);
  assert.ok(title.includes(original.operationId));
  assert.ok(title.includes('Original send · No dispatch outcome recorded'));
  assert.ok(title.includes('Recorded receiver observation · No PR observation recorded'));
  assert.equal(labels[0],'Back');return 'Inspect recorded details';
 },async show(title,text){shown++;assert.match(title,/recorded details/);const record=JSON.parse(text);assert.equal(record.operationId,original.operationId);assert.equal(record.view.phase,'RESERVED');}},f.c);
 assert.equal(shown,1);assert.equal(snapshot(),before);assert.equal(f.native.puts(),0);f.native.pass();
});

test('merge original-work recovery remains reachable and forwards navigation instead of reporting action completion',async t=>{
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),before=f.c.store.all('SELECT * FROM runs');let choices=0;
 const outcome=await browseMerges({guard(){},choose:async(_title,rows)=>{choices++;return choices===1?rows[0]:rows.find(row=>row.startsWith('Open original work recovery'));},show:async()=>{},navigate:async command=>{assert.equal(command,'/work '+f.workId);return 'started';}},f.c);
 assert.equal(outcome,'started');assert.equal(choices,3);assert.equal(f.c.inspectMerge(original.operationId).phase,'RESERVED');assert.deepEqual(f.c.store.all('SELECT * FROM runs'),before);assert.equal(f.native.puts(),0);f.native.pass();
});

for(const locale of ['en','ko'])test(locale+' confirmed-record guidance is a pure retained read with explicit external prerequisites',async t=>{
 // Controlled CONFIRMED UI metadata only. Genuine two-cycle SDK/runtime/native
 // evidence belongs to normal-landing-repeat-runtime.test.mjs, not this fixture.
 const f=await subject(t);f.grant();
 const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 const row=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',original.operationId),recordedCommit='c'.repeat(40);
 f.c.store.run('UPDATE effect_operations SET phase=?,data=? WHERE id=?','CONFIRMED',JSON.stringify({...JSON.parse(row.data),mergedCommit:recordedCommit,transportOutcome:'native-success',blocked:[]}),original.operationId);
 assert.equal(f.c.inspectRetainedMerge(original.operationId).view.phase,'CONFIRMED');
 const tables=['effect_operations','effect_targets','effect_delegations','effect_receipts','budgets','runs','works','sources','goals','conversation_inputs'];
 const snapshot=()=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));
 const before=snapshot(),requests=f.native.requests.length;let choices=0,guards=0,originalMenu;const shown=[];
 const tr=(id,values)=>uiText(locale,id,values);
 const result=await browseMerges({locale,guard(){guards++;},choose:async(title,rows)=>{
  if(++choices===1){
   assert.ok(title.startsWith(tr('merge.record.list')));
   return rows.find(row=>row.includes(original.operationId));
  }
  if(choices===2){
   originalMenu=title;
   assert.ok(title.includes(tr('merge.record.confirmed',{commit:recordedCommit})));
   assert.ok(rows.includes(tr('merge.record.next')));
   assert.ok(rows.includes(tr('merge.record.read')));
   assert.ok(!rows.includes(tr('merge.record.send'))&&!rows.includes(tr('merge.record.prepare')));
   return tr('merge.record.next');
  }
  if(choices===3){
   assert.equal(title,originalMenu,'Closing guidance must return to this exact retained merge');
   return tr('merge.record.back');
  }
  assert.ok(title.startsWith(tr('merge.record.list')));return tr('merge.record.back');
 },show:async(title,text)=>shown.push({title,text}),navigate:async()=>assert.fail('Guidance navigated to a mutating recovery flow'),prepare:async()=>assert.fail('Guidance prepared a native operation'),dispatch:async()=>assert.fail('Guidance sent a native operation'),reconcile:async()=>assert.fail('Guidance refreshed native facts')},f.c);
 assert.equal(result,false,'Reading guidance does not report completion of an action');
 assert.equal(choices,4);
 assert.equal(shown.length,1);assert.equal(shown[0].title,tr('merge.record.nextTitle'));
 for(const line of [tr('merge.record.confirmed',{commit:recordedCommit}),tr('result.project',{id:'"P"'}),tr('merge.record.nextGuide')])
  assert.ok(shown[0].text.includes(line));
 assert.match(shown[0].text,/owner\/repo #12/);
 assert.match(shown[0].text,locale==='en'?/preserving local changes/:/로컬 변경을 보존/);
 assert.ok(guards>=5,'Original source guards still surround choices and inspection');
 assert.equal(snapshot(),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);
 f.native.pass();
});

test('Korean merge catalogue keeps unknown transport separate from PR observation and uses exact choices',async t=>{
 const f=await subject(t,{dropAcceptance:true});f.grant();
 const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 const sent=await f.c.dispatchMerge(prepared.operationId);
 assert.equal(sent.phase,'UNKNOWN');
 assert.equal(sent.transportOutcome,'uncertain');
 const before=f.native.requests.length,rows=f.c.store.all('SELECT * FROM effect_operations ORDER BY rowid');
 const tr=(id,values)=>uiText('ko',id,values);
 const choices=['operation:'+prepared.operationId,'back','back'];
 const outcome=await browseMerges({locale:'ko',guard(){},choose:async()=>assert.fail('Use exact values'),
  chooseItems:async(title,items)=>{
   const action=choices.shift();
   assert.ok(items.some(item=>item.value===action));
   if(title.startsWith(tr('merge.record.list'))){
    assert.ok(items.some(item=>item.label.includes(tr('integration.phase.unknown'))&&item.label.includes('owner/repo #12')));
   }else{
    assert.ok(title.includes(tr('integration.transport.uncertain')));
    assert.ok(title.includes(tr('merge.record.unobserved')));
    assert.equal(items[0].value,'back');
    assert.ok(items.some(item=>item.value==='read'));
    assert.ok(!items.some(item=>['send','prepare','renew','reauthorize'].includes(item.value)));
   }
   return action;
  },
  show:async()=>assert.fail('Back cannot inspect details'),
  reconcile:async()=>assert.fail('Opening is a pure read'),
  dispatch:async()=>assert.fail('Possible handoff cannot resend'),
 },f.c);
 assert.equal(outcome,false);
 assert.equal(choices.length,0);
 assert.equal(f.native.requests.length,before);
 assert.deepEqual(f.c.store.all('SELECT * FROM effect_operations ORDER BY rowid'),rows);
 f.native.pass();
});

test('invalid merge outcome fields stay unavailable without losing the adjacent original',async t=>{
 const f=await subject(t);f.grant();
 const {operationId}=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 const malformed='unavailable-facts',row=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',operationId),before=f.native.requests.length;
 f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',malformed,row.work,row.target,row.grant_id,'CONFIRMED',row.data);
 const retained=JSON.parse(row.data),mergedCommit='a'.repeat(40);
 const {expectedBase,expectedHead,expectedTree}=retained.subject;
 const reversedParents={kind:'merged-candidate-correspondence',sendCausality:'not-established-by-resource-observation',
  mergedCommit,tree:expectedTree,parents:[expectedHead,expectedBase]};
 for(const data of [{transportOutcome:'malformed'}, {mergedCommit:'x'.repeat(20000)},
  {mergedCommit,correspondence:{kind:'other'}}, {mergedCommit,correspondence:reversedParents}]){
  f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...retained,...data}),malformed);
  const page=f.c.listMerges();
  assert.deepEqual(page.operations.map(record=>[record.operationId,record.state]),[[malformed,'UNAVAILABLE'],[operationId,'RETAINED']]);
 }
 let visits=0;
 await browseMerges({guard(){},choose:async(_title,rows)=>{
  if(visits++>0)return 'Back';
  return rows.find(row=>row.includes(malformed));
 },show:async(title,body,primary)=>{
  assert.equal(title,uiText('en','merge.record.unavailable'));
  assert.ok(body.includes(malformed));
  assert.equal(primary,undefined);
 },dispatch:async()=>assert.fail('Unavailable cannot send')},f.c);
 assert.equal(visits,2);
 assert.equal(f.native.requests.length,before);
 f.native.pass();
});

test('dismissing a review after original record drift names the original and cannot prepare', async t => {
 const f = await subject(t);
 f.grant();
 const { operationId } = await f.c.prepareOwnerMerge(f.workId, f.targetId, f.branchOperationId);
 const requests = f.native.requests.length;
 const budgets = f.c.store.all('SELECT * FROM budgets');
 const runs = f.c.store.all('SELECT * FROM runs');
 await assert.rejects(browseMerges({
  guard() {},
  choose: async () => 'Prepare this same original without sending',
  chooseItems: async (_title, items) => {
   assert.ok(items.some(item => item.value === 'prepare'));
   return 'prepare';
  },
  show: async () => {
   f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.transportOutcome','invalid') WHERE id=?", operationId);
   return false;
  },
  prepare: async () => assert.fail('A stale review cannot prepare'),
 }, f.c, operationId, true), { message: new RegExp('original PR merge ' + operationId + ' context changed') });
 assert.equal(f.native.requests.length, requests);
 assert.deepEqual(f.c.store.all('SELECT * FROM runs'), runs);
 assert.deepEqual(f.c.store.all('SELECT * FROM budgets'), budgets);
 f.native.pass();
});

test('the exact repository operation opens the original PR merge and Back skips the registry',async t=>{
 const {repositoryCommands}=await import('../../dist/ui/repository-commands.js');
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);
 const source=f.c.createConversation().conversationId,calls=f.native.requests.length,shown=[],titles=[];
 const ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{titles.push(title);return rows[0];},
  input:async()=>assert.fail('No credentials for retained read'),show:async(title,text)=>shown.push({title,text}),notice(){}});
 assert.equal(await ui.commands[0].run('operation '+original.operationId+' '+f.workId,source),'cancelled');
 assert.deepEqual(shown,[]);
 assert.equal(titles.length,1);assert.match(titles[0],/PR merge record/);assert.ok(titles[0].includes(original.operationId));
 assert.equal(f.native.requests.length,calls);await ui.close();f.native.pass();
});

test('retained merge selection refuses if recorded state changes before an action review',async t=>{
 const f=await subject(t);f.grant();const original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),calls=f.native.requests.length;
 const host={guard(){},show:async()=>assert.fail('Stale selection cannot open a review'),dispatch:async()=>assert.fail('Stale selection cannot send'),choose:async(_title,rows)=>{
  assert.ok(rows.includes('Review original merge send'));
  f.c.store.run("UPDATE effect_operations SET phase='UNKNOWN' WHERE id=?",original.operationId);
  return 'Review original merge send';
 }};
 await assert.rejects(browseMerges(host,f.c,original.operationId,true),/changed/);
 assert.equal(f.native.requests.length,calls);f.native.pass();
});

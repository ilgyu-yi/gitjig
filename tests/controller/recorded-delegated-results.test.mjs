import {randomUUID} from 'node:crypto';
import {scripted} from './effect-fixture.mjs';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedResultWorld} from './recorded-delegated-results-fixture.mjs';
import {publishConversationResult} from '../../dist/controller/conversation-results.js';
import {openController} from '../../dist/controller/index.js';
import {recordedDelegatedResultText} from '../../dist/ui/recorded-delegated-result.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
const ledger=c=>JSON.stringify(Object.fromEntries(['conversation_results','conversation_notifications','conversation_assignments','runs','budgets','change_state'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));

test('owner reads exact failed delegated partial work independently of misleading parent and cold native state',async t=>{
 const refreshes=[];
 const f=await recordedResultWorld(t,{beforeAssignment({c,parent}){
  const stop=c.subscribeInteraction(event=>{
   if(event.type!=='coordination-notice'||event.conversationId===parent)return;
   const entry=c.inspectRecordedDelegatedResults(parent).entries.find(row=>row.conversationId===event.conversationId);
   if(entry)refreshes.push({entry,inTransaction:c.store.db.isTransaction,
    assignmentState:c.store.one('SELECT state FROM conversation_assignments WHERE id=?',entry.assignmentId)?.state});
  });t.after(stop);
 }}),c=f.c,child=f.children[0],before=ledger(c);
 const sourceBefore=await fs.readFile(path.join(f.root,'source/file.txt'),'utf8');
 const view=c.inspectRecordedDelegatedResults(f.parent);assert.equal(view.unavailable,false);assert.equal(view.omitted,false);assert.equal(view.entries.length,1);
 const entry=view.entries[0];assert.equal(entry.assignmentId,child.assignmentId);assert.equal(entry.workId,child.workId);assert.ok(entry.candidateVersion);assert.equal(entry.formalChecks,0);assert.equal(entry.phase,'BLOCKED');
 assert.equal(entry.instructionPreview,'Owned original failed-WAIT task 0');
 assert.match(entry.assignmentProof,/^[a-f0-9]{64}$/);
 assert.deepEqual(refreshes,[{entry,inTransaction:false,assignmentState:'UNAVAILABLE'}],'Publish one refresh after result and assignment are committed');
 for(const locale of ['en','ko'])for(const width of [32,80]){
  const text=recordedDelegatedResultText(view,locale,width);assert.match(text,locale==='ko'?/격리된 변경본 보관됨/:/Isolated candidate retained/);assert.match(text,locale==='ko'?/공식 검사 기록: 0건/:/Formal check records: 0/);
 }
 assert.equal(await fs.readFile(path.join(f.root,'source/file.txt'),'utf8'),sourceBefore);
 assert.equal(ledger(c),before,'Reading facts cannot acknowledge, execute, spend or edit originals');
 for(const notice of c.inspectNotifications(f.parent))c.acknowledgeNotification({conversationId:f.parent,notificationId:notice.id});
 assert.deepEqual(c.inspectRecordedDelegatedResults(f.parent),view,'Acknowledgment does not erase recorded work');
 await c.close();const cold=await openController({installationHome:f.home});try{assert.deepEqual(cold.inspectRecordedDelegatedResults(f.parent),view);}finally{await cold.close();}f.pass();
});

test('original notice, audience, project, hash and bounds are required; corrupt newest never falls back',async t=>{
 const f=await recordedResultWorld(t),c=f.c,child=f.children[0];const original=c.inspectRecordedDelegatedResults(f.parent).entries[0];assert.ok(original);
 const row=c.store.one('SELECT * FROM conversation_results WHERE id=?',original.resultId),publication=JSON.parse(row.data);
 for(const mutate of [v=>{v.audience=[];},v=>{v.projectId='foreign';},v=>{v.assignmentId='foreign';},v=>{v.result.candidateVersion='foreign';},v=>{v.result.counts.checks=-1;}]){
  const value=structuredClone(publication);mutate(value);c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(value),row.id);
  const before=ledger(c),view=c.inspectRecordedDelegatedResults(f.parent);assert.equal(view.entries.length,0);assert.equal(view.unavailable,true);assert.equal(ledger(c),before);
 }
 c.store.run('UPDATE conversation_results SET data=? WHERE id=?',row.data,row.id);
 // A second controlled original publication belongs to the same canonical assignment.
 const later={...publication.result,nextAction:'Retain the original child task',state:'UNKNOWN'};
 const latest=c.store.tx(()=>publishConversationResult(c.store,child.conversationId,child.assignmentId,later));
 assert.notEqual(latest,row.id);assert.equal(c.inspectRecordedDelegatedResults(f.parent).entries.length,1);assert.equal(c.inspectRecordedDelegatedResults(f.parent).entries[0].resultId,latest);
 assert.match(recordedDelegatedResultText(c.inspectRecordedDelegatedResults(f.parent),'en',80),/Execution outcome needs recovery/);
 c.store.run('UPDATE conversation_results SET data=? WHERE id=?','x'.repeat(128*1024+1),latest);
 const held=c.inspectRecordedDelegatedResults(f.parent);assert.equal(held.entries.length,0);assert.equal(held.unavailable,true,'Do not display an older favorable record as latest');
 f.pass();
});

test('the parent result command opens an acknowledged publication and rechecks its identity before the work menu', async t => {
 const f = await recordedResultWorld(t), c = f.c, child = f.children[0];
 const entry = c.inspectRecordedDelegatedResults(f.parent).entries[0];
 const notice = c.inspectNotifications(f.parent).find(row => row.resultId === entry.resultId);
 c.acknowledgeNotification({conversationId: f.parent, notificationId: notice.id});
 const before = ledger(c), executions = [];
 const instructions = JSON.parse(c.store.one('SELECT data FROM conversation_assignments WHERE id=?',child.assignmentId).data).instructionsSource;
 const workSource = c.store.one('SELECT source FROM works WHERE id=?',child.workId).source;
 const raw = c.store.one('SELECT raw FROM sources WHERE id=?',instructions).raw;
 let mode = 'back', shown = 0, returned = false;
 const command = changeCommands({controller: c, isCurrent: id => id === f.parent,
  choose: () => assert.fail('expected a stable result choice'),
  async chooseItems(title, items) {
   assert.equal(title, 'Recorded delegated results');
   assert.deepEqual(items.map(item => item.value), ['back', entry.resultId, 'registry']);
   if (mode === 'instructions-changed')
    c.store.run('UPDATE sources SET raw=raw||? WHERE id IN (?,?)',' changed',workSource,instructions);
   return items[mode === 'back' || mode === 'return' && returned ? 0 : 1].value;
  },
  async show(title, body, action, position) {
   shown++;
   assert.equal(title, 'Recorded delegated result');
   assert.match(body, /Recorded result: blocked/);
   assert.ok(body.includes(entry.resultId));
   if (mode === 'return') {
    if (returned) { assert.equal(position.scrollTop,7); return; }
    position.scrollTop=7;
   }
   await action.run();
  },
  async execute(command, target) {
   executions.push([command, target]);
   if (mode === 'return') { returned=true; return 'cancelled'; }
   if (mode === 'replaced') {
    const publication = c.inspectConversationResult(entry.resultId);
    c.store.tx(() => publishConversationResult(c.store, child.conversationId, child.assignmentId,
     {...publication.result, nextAction: 'Replacement publication'}));
    return 'cancelled';
   }
   return 'completed';
  },
 }).find(command => command.name === 'result');
 assert.equal(await command.run('', f.parent), 'cancelled');
 assert.equal(shown, 0);
 mode = 'inspect';
 assert.equal(await command.run('', f.parent), 'completed');
 assert.deepEqual(executions, [['/work ' + child.workId, f.parent]]);
 assert.equal(ledger(c), before);
 mode = 'return';
 assert.equal(await command.run('', f.parent), 'cancelled');
 assert.equal(shown,3);
 assert.equal(ledger(c), before);
 mode = 'instructions-changed';
 try { await assert.rejects(command.run('', f.parent), /Delegated result changed/); }
 finally { c.store.run('UPDATE sources SET raw=? WHERE id IN (?,?)',raw,workSource,instructions); }
 assert.equal(shown,3);
 mode = 'replaced';
 await assert.rejects(command.run('', f.parent), /Delegated result changed/);
 assert.equal(executions.length, 3);
 f.pass();
});

test('owner projection refuses changed original assigning work, root, invocation and duplicate captured records',async t=>{
 const f=await recordedResultWorld(t),c=f.c,child=f.children[0],s=c.store;
 const assignment=s.one('SELECT * FROM conversation_assignments WHERE id=?',child.assignmentId),data=JSON.parse(assignment.data);
 const mutations=[
  ['conversation_assignments',assignment.id,'data',v=>{v.source.workId='00000000-0000-4000-8000-000000000001';}],
  ['conversation_assignments',assignment.id,'data',v=>{v.delegationRoot='00000000-0000-4000-8000-000000000001';}],
  ['conversation_assignments',assignment.id,'data',v=>{v.source.runId='00000000-0000-4000-8000-000000000001';}],
  ['works',child.workId,'data',v=>{v.invocation.sourceEvent='foreign';}],
  ['works',data.source.workId,'data',v=>{v.delegation.rootWorkId='foreign';}],
  ['runs',data.source.runId,'data',v=>{v.initialInputId='foreign';}]
 ];
 for(const [table,id,column,mutate]of mutations){
  const row=s.one('SELECT '+column+' AS raw FROM '+table+' WHERE id=?',id),value=JSON.parse(row.raw);mutate(value);s.run('UPDATE '+table+' SET '+column+'=? WHERE id=?',JSON.stringify(value),id);
  const view=c.inspectRecordedDelegatedResults(f.parent);assert.equal(view.entries.length,0,table);assert.equal(view.unavailable,true,table);s.run('UPDATE '+table+' SET '+column+'=? WHERE id=?',row.raw,id);
 }
 const notice=s.one('SELECT id,data FROM conversation_notifications WHERE target=? ORDER BY rowid DESC LIMIT 1',f.parent);
 for(const [table,id]of [['conversation_notifications',notice.id],['conversation_assignments',assignment.id],['runs',data.source.runId],['conversation_inputs',data.inputId]]){
  const row=s.one('SELECT data FROM '+table+' WHERE id=?',id);
  for(const raw of [row.data.replace('{','{"duplicate":1,"duplicate":2,'),'x'.repeat(65537)]){
   s.run('UPDATE '+table+' SET data=? WHERE id=?',raw,id);const view=c.inspectRecordedDelegatedResults(f.parent);assert.equal(view.entries.length,0,table);assert.equal(view.unavailable,true,table);
  }
  s.run('UPDATE '+table+' SET data=? WHERE id=?',row.data,id);
 }
 assert.equal(c.inspectRecordedDelegatedResults(f.parent).entries.length,1);f.pass();
});


test('cached owner facts cannot be changed by a caller or survive an external publication change',async t=>{
 const f=await recordedResultWorld(t),original=f.c.inspectRecordedDelegatedResults(f.parent);assert.equal(original.entries.length,1);
 const caller=f.c.inspectRecordedDelegatedResults(f.parent);caller.entries[0].formalChecks=999;
 assert.deepEqual(f.c.inspectRecordedDelegatedResults(f.parent),original);
 const row=f.c.store.one('SELECT data FROM conversation_results WHERE id=?',original.entries[0].resultId);
 assert.throws(()=>f.c.store.tx(()=>{
  f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?','{}',original.entries[0].resultId);
  assert.equal(f.c.inspectRecordedDelegatedResults(f.parent).unavailable,true);
  throw Error('CONTROLLED_ROLLBACK');
 }),/CONTROLLED_ROLLBACK/);
 assert.deepEqual(f.c.inspectRecordedDelegatedResults(f.parent),original,'Rolled-back provisional facts cannot survive in the display cache');
 const other=new DatabaseSync(path.join(f.home,'state/controller.sqlite'));
 try{
  other.prepare('UPDATE conversation_results SET data=? WHERE id=?').run('{}',original.entries[0].resultId);
  assert.equal(f.c.inspectRecordedDelegatedResults(f.parent).unavailable,true);
  other.prepare('UPDATE conversation_results SET data=? WHERE id=?').run(row.data,original.entries[0].resultId);
  assert.deepEqual(f.c.inspectRecordedDelegatedResults(f.parent),original);
 }finally{other.close();}f.pass();
});

test('bounded owner roster keeps distinct original assignments and reports omitted results',async t=>{
 const f=await recordedResultWorld(t,{resultDependency:false});
 for(let i=0;i<4;i++){
  const model=scripted((_context,turn)=>turn?{text:'Retained original assignment.'}:{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Another original governed task '+i,resultDependency:false}}});
  model.provider='recorded-roster-'+randomUUID();model.definition.api='recorded-roster-api-'+randomUUID();
  await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Assign another original task '+i,mode:'idle'});
  await f.c.runConversation({conversationId:f.parent,model});await f.c.ordinaryCore.drain();
 }
 assert.equal(f.children.length,5);
 const view=f.c.inspectRecordedDelegatedResults(f.parent);assert.equal(view.entries.length,4);assert.equal(view.omitted,true);assert.equal(view.unavailable,false);assert.equal(new Set(view.entries.map(e=>e.assignmentId)).size,4);
 // More than the cheap notice scan profile is explicit, never an unbounded read.
 for(let i=0;i<33;i++)f.c.store.run('INSERT INTO conversation_notifications VALUES(?,?,?,?)','control-notice-'+i,f.parent,'ACKNOWLEDGED',JSON.stringify({kind:'parent-changed'}));
 const bounded=f.c.inspectRecordedDelegatedResults(f.parent);assert.equal(bounded.omitted,true);assert.equal(bounded.entries.length,0);f.pass();
});

test('actual same-project metadata-only parent notice grants no original result contents',async t=>{
 const f=await recordedResultWorld(t),child=f.children[0],c=f.c;
 const other=c.createConversation({projectId:'P'}).conversationId;
 c.setConversationParent({childId:child.conversationId,parentId:other,expectedRevision:c.inspectConversation(child.conversationId).relationRevision});
 const original=c.inspectRecordedDelegatedResults(f.parent).entries[0],publication=c.inspectConversationResult(original.resultId);
 c.store.tx(()=>publishConversationResult(c.store,child.conversationId,child.assignmentId,{...publication.result,nextAction:'Recorded child result after relationship change'}));
 const notice=c.inspectNotifications(other).find(n=>n.kind==='result-ready');assert.ok(notice);
 const view=c.inspectRecordedDelegatedResults(other);assert.equal(view.entries.length,0);assert.equal(view.unavailable,true);
 assert.equal(c.inspectRecordedDelegatedResults(f.parent).entries.length,1,'The original receiver retains its own historical observation');f.pass();
});

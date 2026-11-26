/** Actual SDK receipts and assignment/source records. Governed execution stops before models/engine. */
import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{structuredAssignmentWorld}from'./structured-assignment-fixture.mjs';import{scripted}from'./effect-fixture.mjs';
const snapshot=c=>JSON.stringify(Object.fromEntries(['works','sources','runs','budgets','conversation_inputs','conversation_assignments','conversation_dependencies','observations','effect_operations'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])));
async function fixture(t){const f=await structuredAssignmentWorld(t,{maxProviderRequests:16});f.onGoverned(()=>{throw Error('CONTROLLED_STOP_BEFORE_GOVERNED_MODELS');});await f.assign();f.c.store.run('UPDATE budgets SET consumed=lim WHERE lineage=? AND kind=?',f.child.workId,'execution');return f;}
async function capped(f,cid=f.parent){
 const c=f.c,request={conversationId:f.child.conversationId,observedDirectionRevision:c.inspectConversation(f.child.conversationId).directionRevision,projectId:'P',operation:'change',instructions:'Inspect and continue the same original task after allowance recovery.'};
 await c.queueConversationInput({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,text:'Continue the original assigned task without replacing it.',mode:'idle'});let requests=0;
 const model=scripted((_context,turn)=>{requests++;return turn?{tool:{name:'conversation_status',arguments:{}}}:{tool:{name:'conversation_assign',arguments:request}};});model.provider='related-limit-'+randomUUID();model.definition.api='related-limit-api-'+randomUUID();
 const result=await c.runConversation({conversationId:cid,model});await c.ordinaryCore.drain();assert.equal(requests,16);assert.deepEqual(result.requestLimit,{limit:16});assert.equal(result.status,'unavailable');return result;
}
test('a deliberately unaccepted same-task receipt links the actual retained child without creating a reentry',async t=>{
 const f=await fixture(t),before=f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),result=await capped(f);
 assert.deepEqual(f.c.store.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),before);
 const state=snapshot(f.c),view=f.c.inspectConversationRequestFailure(f.parent);assert.ok(view);assert.deepEqual(view.relatedWorkIds,[f.child.workId],JSON.stringify(view));assert.equal(view.relatedWorkIncomplete,false);assert.equal(snapshot(f.c),state);assert.equal(view.runId,result.runId);f.pass();
});
test('context reentry references the original child even when its original creator is another conversation',async t=>{
 const f=await fixture(t),source=f.c.inspectConversation(f.parent),clone=await f.c.forkConversation({conversationId:f.parent,expectedGeneration:source.generation,expectedModelRevision:f.c.getConversationModelChoice(f.parent).revision,kind:'clone'});
 const result=await capped(f,clone.conversationId),view=f.c.inspectConversationRequestFailure(clone.conversationId);assert.ok(view);assert.notEqual(f.c.store.one('SELECT source_conversation FROM conversation_assignments WHERE id=?',f.child.assignmentId).source_conversation,clone.conversationId);
 assert.deepEqual(view.relatedWorkIds,[f.child.workId],JSON.stringify(view));assert.equal(view.relatedWorkIncomplete,false);assert.equal(view.runId,result.runId);f.pass();
});
test('changed or unsupported receipt/source tuples omit only links and retain the original cap diagnostic',async t=>{
 const f=await fixture(t),{runId}=await capped(f),s=f.c.store;
 const row=s.one("SELECT id,data FROM observations WHERE run=? AND json_extract(data,'$.toolName')='conversation_assign'",runId);assert.ok(row);
 const assignment=s.one('SELECT * FROM conversation_assignments WHERE id=?',f.child.assignmentId),sourceId=JSON.parse(assignment.data).instructionsSource,source=s.one('SELECT origin FROM sources WHERE id=?',sourceId);
 const cases=[
  ['observations','data',row.id,()=>'{malformed receipt'],
  ['observations','data',row.id,data=>data.replace('{','{"toolName":"conversation_assign",')],
  ['observations','data',row.id,data=>{const v=JSON.parse(data);delete v.toolName;return JSON.stringify(v);}],
  ['observations','data',row.id,data=>JSON.stringify({...JSON.parse(data),isError:true})],
  ['observations','data',row.id,data=>{const v=JSON.parse(data);v.result.content[0].text='Example: '+v.result.content[0].text;return JSON.stringify(v);}],
  ['observations','data',row.id,data=>{const v=JSON.parse(data),body=JSON.parse(v.result.content[0].text);body.workId='FOREIGN_WORK';v.result.content[0].text=JSON.stringify(body);return JSON.stringify(v);}],
  ['sources','origin',sourceId,data=>{const v=JSON.parse(data);v.actor={...v.actor,initialInputId:'FOREIGN_INPUT'};return JSON.stringify(v);}],
 ];
 for(const[table,column,id,change]of cases){const old=table==='observations'?row.data:source.origin;s.run(`UPDATE ${table} SET ${column}=? WHERE id=?`,change(old),id);try{const before=snapshot(f.c),view=f.c.inspectConversationRequestFailure(f.parent);assert.ok(view);assert.deepEqual(view.relatedWorkIds,[]);assert.equal(snapshot(f.c),before);}finally{s.run(`UPDATE ${table} SET ${column}=? WHERE id=?`,old,id);}}
 assert.deepEqual(f.c.inspectConversationRequestFailure(f.parent).relatedWorkIds,[f.child.workId]);f.pass();
});
test('bounded duplicate or oversized receipts declare incomplete links without hiding the original failure',async t=>{
 const f=await fixture(t),{runId}=await capped(f),s=f.c.store;
 const row=s.one("SELECT id,data FROM observations WHERE run=? AND json_extract(data,'$.toolName')='conversation_assign'",runId);assert.ok(row);
 const inspect=()=>{const before=snapshot(f.c),view=f.c.inspectConversationRequestFailure(f.parent);assert.ok(view);assert.equal(view.relatedWorkIncomplete,true);assert.equal(snapshot(f.c),before);return view;};
 const ids=[];try{
  for(let i=0;i<33;i++){const id=randomUUID();ids.push(id);s.run('INSERT INTO observations(id,run,data) VALUES(?,?,?)',id,runId,row.data);}
  assert.deepEqual(inspect().relatedWorkIds,[f.child.workId]);
 }finally{for(const id of ids)s.run('DELETE FROM observations WHERE id=?',id);}
 const oversized=JSON.parse(row.data);oversized.result.content[0].text+=' '.repeat(16384);
 s.run('UPDATE observations SET data=? WHERE id=?',JSON.stringify(oversized),row.id);
 try{assert.deepEqual(inspect().relatedWorkIds,[]);}finally{s.run('UPDATE observations SET data=? WHERE id=?',row.data,row.id);}
 assert.equal(f.c.inspectConversationRequestFailure(f.parent).relatedWorkIncomplete,false);f.pass();
});

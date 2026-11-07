import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredAssignmentWorld } from './structured-assignment-fixture.mjs';
import { scripted } from './effect-fixture.mjs';
const result=(context,name)=>JSON.parse(context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1).content.filter(p=>p.type==='text').map(p=>p.text).join(''));
test('original publication scoped native Pi pages reproduce full immutable observation without filesystem fallback',async t=>{
 const f=await structuredAssignmentWorld(t);f.onGoverned((_child,view)=>{view.phase='BLOCKED';view.reviewReady=false;view.blocked=['Independent source-fit decision omitted actual input original-input'];view.nextAction='Request current same-task independent planning';view.diagnostic='한😀\\\"\u0000'.repeat(3000)});await f.assign();
 const a=f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?',f.child.assignmentId),id=JSON.parse(a.data).resultId,full=JSON.stringify(f.c.inspectConversationResult(id));let summary,pages=0,body='',done=false;
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Read this original result through bounded native result pages',mode:'idle'});
 const model=scripted((context,turn)=>{
  if(turn===0)return{tool:{name:'conversation_result',arguments:{resultId:id}}};
  const last=result(context,'conversation_result');assert.ok(Buffer.byteLength(JSON.stringify(last))<=8192);
  if(turn===1){summary=last;assert.equal(summary.kind,'conversation-result-summary/v1');assert.equal(summary.result.phase,'BLOCKED');assert.equal(summary.result.reviewReady,false);assert.deepEqual(summary.result.blocked,['Independent source-fit decision omitted actual input original-input']);return{tool:{name:'conversation_result',arguments:{resultId:id,cursor:0,fingerprint:summary.fullJSON.fingerprint}}};}
  assert.equal(last.kind,'conversation-result-page/v1');body+=last.text;pages++;
  if(last.nextCursor!==null)return{tool:{name:'conversation_result',arguments:{resultId:id,cursor:last.nextCursor,fingerprint:summary.fullJSON.fingerprint}}};
  done=true;return{text:'Read the original failed observation, without claiming success or replacing its task.'};
 });
 const outcome=await f.c.runConversation({conversationId:f.parent,model});assert.equal(outcome.status,'delivered');assert.equal(done,true);assert.equal(body,full);assert.ok(pages>1);assert.equal(JSON.stringify(f.c.inspectConversationResult(id)),full);assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignmentId).state,'UNAVAILABLE');f.pass();
});
test('original unavailable active governed assignment exposes only a scoped same-task reentry request',async t=>{
 const f=await structuredAssignmentWorld(t);f.onGoverned(()=>{throw Error('Owned unavailable procedure')});await f.assign();const before=f.c.store.one('SELECT * FROM works WHERE id=?',f.child.workId);let observed;
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Inspect request pointer without starting work',mode:'idle'});
 const model=scripted((context,turn)=>{if(!turn)return{tool:{name:'conversation_status',arguments:{conversationId:f.child.conversationId}}};observed=result(context,'conversation_status');return{text:'Retained the original task, without automatic retry.'}});
 await f.c.runConversation({conversationId:f.parent,model});const pointer=observed.assignments[0].reentry;assert.equal(pointer.tool,'conversation_assign');assert.equal(pointer.conversationId,f.child.conversationId);assert.equal(pointer.projectId,'P');assert.equal(pointer.observedDirectionRevision,observed.directionRevision);assert.match(pointer.nextAction,/Request same-task/);assert.match(pointer.nextAction,/no eligibility/);assert.deepEqual(f.c.store.one('SELECT * FROM works WHERE id=?',f.child.workId),before);f.pass();
});
test('a later original native page rechecks captured audience before its stale fingerprint',async t=>{
 const f=await structuredAssignmentWorld(t);f.onGoverned((_child,view)=>{view.reviewReady=false;view.phase='BLOCKED';view.diagnostic='owned large result '.repeat(1000)});await f.assign();const id=JSON.parse(f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?',f.child.assignmentId).data).resultId;let refused=false;
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Verify original scoped page refusal',mode:'idle'});
 const model=scripted((context,turn)=>{
  if(!turn)return{tool:{name:'conversation_result',arguments:{resultId:id}}};
  if(turn===1){const summary=result(context,'conversation_result');assert.equal(summary.kind,'conversation-result-summary/v1');const row=f.c.store.one('SELECT data FROM conversation_results WHERE id=?',id),data=JSON.parse(row.data);data.audience=[];f.c.store.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify(data),id);return{tool:{name:'conversation_result',arguments:{resultId:id,cursor:0,fingerprint:summary.fullJSON.fingerprint}}};}
  const r=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='conversation_result').at(-1);assert.equal(r.isError,true);const text=r.content.map(x=>x.text??'').join('');assert.match(text,/outside captured scope/);assert.doesNotMatch(text,/fingerprint mismatch/);refused=true;return{text:'The original scope was revoked; no page is available.'};
 });
 await f.c.runConversation({conversationId:f.parent,model});assert.equal(refused,true);f.pass();
});

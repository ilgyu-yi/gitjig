/** Actual Controller/Pi assignment/result admission; physical execution and model decisions are controlled. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';

const root=await temporaryDirectory('completed-assignment-feedback'),shim=path.join(root,'scope.mjs'),scopes=[];
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__completedFeedbackScope(options)}');
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/controller/change-core.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};
 return next(specifier,context);
}});
globalThis.__completedFeedbackScope=async options=>{
 const safe=p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;};
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:safe,
  readFile:p=>fs.readFile(safe(p),'utf8'),access:(p,m)=>fs.access(safe(p),m),writeFile:(p,c)=>fs.writeFile(safe(p),c),mkdir:p=>fs.mkdir(safe(p),{recursive:true}),exec:()=>assert.fail('No host execution of authored code'),closed:false,
  async execute(command){assert.equal(command,'node check.cjs');const descriptor=JSON.parse(await fs.readFile(path.join(options.inputRoot,'verification-cases.json'),'utf8')),value=Number((await fs.readFile(safe('consumer.cjs'),'utf8')).match(/exports=(\d+)/)[1]),expected=Number(descriptor.cases[0].declaration.expected.value);return{exitCode:0,stdout:JSON.stringify({version:1,assertions:[{id:expected===4?'four':'three',passed:value===expected}],cases:descriptor.cases.map(c=>({id:c.id,inputDigest:c.inputDigest,observed:{kind:Number(c.declaration.input.literalUtf8)===value?'return':'rejection',value:String(value)}}))}),stderr:''};},
  async close(){scope.closed=true;return{state:'removed'}}};scopes.push(scope);return scope;
};
const {structuredAssignmentWorld}=await import('./structured-assignment-fixture.mjs');
after(async()=>{assert.ok(scopes.every(scope=>scope.closed));delete globalThis.__completedFeedbackScope;await fs.rm(root,{recursive:true,force:true});});
const toolResult=(context,name)=>{const row=context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1);assert.ok(row);const text=row.content.filter(p=>p.type==='text').map(p=>p.text).join('');return{isError:!!row.isError,value:row.isError?text:JSON.parse(text)};};

async function readyFixture(t){
 const f=await structuredAssignmentWorld(t,{originalGovernedDispatch:true,maxAssignments:1,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}}),c=f.c,s=c.store;
 await fs.writeFile(path.join(f.root,'source/consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(f.root,'source/check.cjs'),'// controlled physical check\n');
 let step=0,assignment,action;
 const model=scripted(context=>{
  return action(context);
 });
 action=()=>step++===0?{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3 using its existing checker; obtain checks and independent review.'}}}:{text:'Original task allocated.'};
 // Isolate reentry from the synthetic model's context ceiling; no live capacity claim.
 model.definition.models[0].contextWindow=200000;
 model.provider='completed-feedback-'+randomUUID();model.definition.api='completed-feedback-api-'+randomUUID();
 const turn=async(text,conversationId=f.parent)=>{await c.queueConversationInput({conversationId,expectedGeneration:c.inspectConversation(conversationId).generation,text,mode:'idle'});const result=await c.runConversation({conversationId,model});await c.ordinaryCore.drain();assert.equal(result.status,'delivered');};
 await turn('Delegate one code change through real governed checks and independent review.');
 assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',f.parent);assert.equal(assignment.state,'COMPLETE');
 const ready=c.inspectChange(assignment.work);assert.equal(ready.phase,'REVIEW_READY',JSON.stringify(ready.blocked));assert.equal(ready.reviewReady,true);assert.ok(s.one("SELECT id FROM check_runs WHERE work=? AND status='pass'",assignment.work));assert.ok(s.one("SELECT id FROM role_launches WHERE work=? AND role='reviewer' AND status='COMPLETE'",assignment.work));
 return{f,c,s,assignment,ready,model,turn,setAction(fn){action=fn;}};
}

test('completed original accepts explicit corrective feedback through the same assignment at its creation ceiling',async t=>{
 const {f,c,s,assignment,turn,setAction}=await readyFixture(t);let step=0,status,acceptance,drives=0;
 const originalResults=s.all('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid',assignment.target),originalChecks=s.all('SELECT * FROM check_runs WHERE work=? ORDER BY rowid',assignment.work),originalVersions=s.all('SELECT * FROM change_versions WHERE work=? ORDER BY rowid',assignment.work),budget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',assignment.work);
 // Stop only the new procedure after original Controller dispatch acknowledges
 // its exact input. This control proves admission, not corrective task success.
 c.changeCore.drive=async()=>{drives++;throw Error('CONTROLLED_STOP_AFTER_CORRECTIVE_INPUT_ADMISSION');};f.expectBackgroundFailure();
 setAction(context=>{if(step++===0)return{tool:{name:'conversation_status',arguments:{conversationId:assignment.target}}};
  if(step===2){status=toolResult(context,'conversation_status');assert.equal(status.isError,false);assert.equal(status.value.assignments[0].reentry.conversationId,assignment.target);return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:assignment.target,assignmentId:status.value.assignments[0].reentry.assignmentId,observedDirectionRevision:status.value.directionRevision,instructions:'Independently assess corrective feedback on this SAME task; retain the prior result and used allowance.'}}};}
  acceptance=toolResult(context,'conversation_assign');return{text:'Feedback admission observed.'};});
 await turn('A subsequent owner review found verification evidence missing. Correct this same existing work, not a replacement.');
 assert.equal(acceptance?.isError,false,JSON.stringify(acceptance));assert.equal(acceptance.value.accepted,true);assert.equal(acceptance.value.reentry,true);assert.equal(acceptance.value.assignmentId,assignment.id);assert.equal(acceptance.value.workId,assignment.work);assert.equal(drives,1);
 assert.equal(s.one('SELECT COUNT(*) n FROM conversation_assignments').n,1);assert.deepEqual(s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',assignment.work),budget);
 for(const row of originalResults)assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',row.id),row);
 for(const row of originalChecks)assert.deepEqual(s.one('SELECT * FROM check_runs WHERE id=?',row.id),row);
 for(const row of originalVersions)assert.deepEqual(s.one('SELECT * FROM change_versions WHERE id=?',row.id),row);
 const reentry=JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?',assignment.id).data).reentries.at(-1);
 assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',reentry.inputId).state,'CONSUMED');assert.equal(JSON.parse(s.one('SELECT data FROM conversation_directions WHERE source=?',reentry.source).data).effectHold,true);
 f.pass();
});

function targetSnapshot(f){
 const {s,assignment:a}=f;
 return JSON.stringify({work:s.one('SELECT * FROM works WHERE id=?',a.work),assignment:s.one('SELECT * FROM conversation_assignments WHERE id=?',a.id),
  inputs:s.all('SELECT * FROM conversation_inputs WHERE conversation=? ORDER BY rowid',a.target),sources:s.all('SELECT * FROM sources WHERE conversation=? ORDER BY rowid',a.target),directions:s.all('SELECT * FROM conversation_directions WHERE conversation=? ORDER BY rowid',a.target),
  budgets:s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',a.work),target:s.one('SELECT * FROM conversation_state WHERE conversation=?',a.target),versions:s.all('SELECT * FROM change_versions WHERE work=? ORDER BY rowid',a.work),
  assignmentIds:s.all('SELECT id FROM conversation_assignments ORDER BY rowid')});
}
for(const held of ['stale-direction','cancelled','unknown','active-producer','obsolete-target','wrong-assignment','coerced-assignment','wrong-operation','wrong-original-operation','wrong-work-kind','execution','resolution'])test('completed feedback preserves original state on '+held,async t=>{
 const f=await readyFixture(t),{c,s,assignment:a}=f;let step=0,before,answer;
 if(held==='cancelled'){s.run("UPDATE works SET state='CANCELLED' WHERE id=?",a.work);s.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?",a.id);}
 if(held==='unknown')s.run("UPDATE works SET state='UNKNOWN' WHERE id=?",a.work);
 if(held==='wrong-original-operation')s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...JSON.parse(a.data),operation:'investigate'}),a.id);
 if(held==='wrong-work-kind'){const row=s.one('SELECT data FROM works WHERE id=?',a.work);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),kind:'ordinary-conversation'}),a.work);}
 if(held==='active-producer')s.run("UPDATE runs SET phase='RUNNING' WHERE id=(SELECT id FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1)",a.work);
 if(held==='obsolete-target')s.run('UPDATE conversation_state SET work=? WHERE conversation=?',c.inspectConversation(f.f.parent).workId,a.target);
 if(['execution','resolution'].includes(held))s.run('UPDATE budgets SET consumed=lim WHERE lineage=? AND kind=?',a.work,held);
 const controlledRun=held==='active-producer'?s.one('SELECT id FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1',a.work):null;
 try{
 f.setAction(context=>{if(step++===0){before=targetSnapshot(f);return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:held==='wrong-operation'?'investigate':'change',conversationId:a.target,assignmentId:held==='wrong-assignment'?randomUUID():held==='coerced-assignment'?17:a.id,observedDirectionRevision:c.inspectConversation(a.target).directionRevision+(held==='stale-direction'?1:0),instructions:'Correct this same original result without replacement or allowance extension.'}}};}answer=toolResult(context,'conversation_assign');return{text:'Original refusal observed.'};});
 await f.turn('Owner corrective feedback; preserve every original hold.');
 assert.equal(targetSnapshot(f),before);
 if(['execution','resolution'].includes(held)){assert.equal(answer.isError,false);assert.equal(answer.value.accepted,false);assert.equal(answer.value.instructionsAccepted,false);assert.deepEqual(answer.value.ownerAction.exhausted,[held]);assert.equal(answer.value.wait,undefined);}
 else assert.equal(answer.isError,true,JSON.stringify(answer));
 f.f.pass();
 }finally{if(controlledRun)s.run("UPDATE runs SET phase='SETTLED' WHERE id=?",controlledRun.id);}
});

test('completed feedback reaches a new reviewed publication with a separately reviewed owner allowance extension',async t=>{
 const f=await readyFixture(t),{c,s,assignment:a}=f,oldCandidate=f.ready.candidateVersion,oldResult=s.one('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1',a.target),oldChecks=s.all('SELECT * FROM check_runs WHERE work=? ORDER BY rowid',a.work);let step=0,accepted;
 // A second complete planning/review cycle costs more than the remaining
 // default resolution allowance. Exercise the public owner action explicitly;
 // this is not evidence of two rounds completing inside the original limit8.
 const beforeAllowance=c.inspectWorkAllowance(a.work);
 c.extendWorkAllowance({expected:beforeAllowance,kind:'resolution',additional:2,reason:'Owner explicitly authorizes another bounded full verification/review cycle; retain all original spent usage.'});
 assert.equal(c.inspectWorkAllowance(a.work).resolution.consumed,beforeAllowance.resolution.consumed);
 assert.equal(c.inspectWorkAllowance(a.work).resolution.limit,beforeAllowance.resolution.limit+2);
 f.setAction(context=>{if(step++===0)return{tool:{name:'conversation_status',arguments:{conversationId:a.target}}};if(step===2){const status=toolResult(context,'conversation_status').value;return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:a.target,assignmentId:a.id,observedDirectionRevision:status.directionRevision,instructions:'Owner now requires value4 on this SAME existing task and checker. Independently assess changed source, preserve all original records and obtain fresh checks and review.'}}};}accepted=toolResult(context,'conversation_assign');return{text:'The same task has received the new owner input.'};});
 await f.turn('Please change the same retained result to value4 and independently verify it.');
 assert.equal(accepted.isError,false,JSON.stringify(accepted));assert.equal(accepted.value.reentry,true);assert.equal(accepted.value.assignmentId,a.id);
 const current=c.inspectChange(a.work);assert.equal(current.reviewReady,true,JSON.stringify(current.blocked));assert.notEqual(current.candidateVersion,oldCandidate);assert.ok(current.checks.some(x=>x.check_id==='value4'&&x.status==='pass'));
 assert.ok(s.one("SELECT id FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit' AND status='COMPLETE'",a.work));
 const publication=s.one('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1',a.target);assert.notEqual(publication.id,oldResult.id);assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',oldResult.id),oldResult);for(const row of oldChecks)assert.deepEqual(s.one('SELECT * FROM check_runs WHERE id=?',row.id),row);
 assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',a.id).state,'COMPLETE');assert.equal(s.one('SELECT COUNT(*) n FROM conversation_assignments WHERE source_conversation=?',f.f.parent).n,1);assert.equal(s.one('SELECT COUNT(*) n FROM budgets WHERE consumed>lim OR reserved<>0').n,0);
 f.f.pass();
});

for(const related of [false,true])test('completed feedback '+(related?'retains context-clone authority':'refuses an unrelated coordinator'),async t=>{
 const f=await readyFixture(t),{c,s,assignment:a}=f;let step=0,answer,before,drives=0;
 const source=c.inspectConversation(f.f.parent);
 const actor=related?(await c.forkConversation({conversationId:f.f.parent,expectedGeneration:source.generation,expectedModelRevision:c.getConversationModelChoice(f.f.parent).revision,kind:'clone'})).conversationId:c.createConversation().conversationId;
 if(related){c.changeCore.drive=async()=>{drives++;throw Error('CONTROLLED_STOP_AFTER_CORRECTIVE_CONTEXT_ADMISSION');};f.f.expectBackgroundFailure();}
 f.setAction(context=>{if(step++===0){before=targetSnapshot(f);return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:a.target,assignmentId:a.id,observedDirectionRevision:c.inspectConversation(a.target).directionRevision,instructions:'Assess corrective feedback on the retained original result, preserving captured authority and allowance.'}}};}answer=toolResult(context,'conversation_assign');return{text:'Only the original feedback boundary was inspected.'};});
 await f.turn('Correct the existing result under the current captured owner scope.',actor);
 if(related){assert.equal(answer.isError,false,JSON.stringify(answer));assert.equal(answer.value.reentry,true);assert.equal(answer.value.assignmentId,a.id);assert.equal(drives,1);}
 else{assert.equal(answer.isError,true);assert.equal(targetSnapshot(f),before);assert.equal(drives,0);}
 f.f.pass();
});

test('exact corrective selector cannot be replaced by a later assignment alias',async t=>{
 const f=await readyFixture(t),{c,s,assignment:a}=f;const alias={...a,id:randomUUID(),data:JSON.stringify({...JSON.parse(a.data),delegationRoot:'different-controlled-root'})};
 s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',alias.id,alias.source_conversation,alias.target,alias.work,alias.state,alias.data);
 const originalAlias=s.one('SELECT * FROM conversation_assignments WHERE id=?',alias.id);
 let step=0,answer,drives=0;c.changeCore.drive=async()=>{drives++;throw Error('CONTROLLED_STOP_AFTER_EXACT_SELECTOR_ADMISSION');};f.f.expectBackgroundFailure();
 f.setAction(context=>{if(step++===0)return{tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:a.target,assignmentId:a.id,observedDirectionRevision:c.inspectConversation(a.target).directionRevision,instructions:'Only correct this exact original assignment; preserve unrelated aliases.'}}};answer=toolResult(context,'conversation_assign');return{text:'Exact identity observed.'};});
 await f.turn('Correct only the originally selected task.');assert.equal(answer.isError,false,JSON.stringify(answer));assert.equal(answer.value.assignmentId,a.id);assert.equal(answer.value.reentry,true);assert.equal(drives,1);assert.deepEqual(s.one('SELECT * FROM conversation_assignments WHERE id=?',alias.id),originalAlias);f.f.pass();
});
